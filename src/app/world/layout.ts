// What stands where in a region's isometric world. Positions come from the saved map (simulation/world.ts);
// this module only turns them into drawable lots and plots. Deterministic: same state, same picture.
import { STAGE_IDS } from '../../simulation/stages/types';
import { BUILDINGS, CROPS, type BuildingType, type RegionId } from '../../simulation/config';
import { newField } from '../../simulation/agriculture';
import { isNeighbour } from '../../simulation/region-state';
import { neighbourTown } from '../../simulation/neighbour-towns';
import type { Building, CivicService, Field, GameState } from '../../simulation/types';
import { svcSide } from '../../simulation/town-state';
import { townOf } from '../../simulation/town-state';
import { communityOf } from '../../simulation/community-state';
import { CONFIG } from '../../simulation/config';
import { baseFootprint, FOOTPRINT, HOME_BLOCKS, MAP, ROAD_Y, findSpot, placeProblem, plotSide, worldOf } from '../../simulation/world';

/** Where each region's for-sale sign stands: it stays put until something is built on its spot. */
const saleSpot = new Map<RegionId, [number, number]>();
export { FOOTPRINT, plotSide } from '../../simulation/world';

/** `place` is the saved-map key this lot moves with (several home blocks share one). */
/** w and d are as it stands on the map (already turned); rot is its quarter turns, the front facing +y at 0. */
export interface Lot { /** a home's level (apartments grow upward) */ level?: number; /** a neighbour's, seen on a visit: not yours to work */ neighbour?: boolean; name?: string; key: string; place: string; type: BuildingType | 'house' | 'shed'; buildings: Building[]; service?: CivicService; x: number; y: number; w: number; d: number; rot: number }
/** The engine key for "add another" of what a lot holds: a building, a town service, or an apartment block. */
export const anotherKey = (lot: Lot) => lot.neighbour ? null : lot.service ? `svc:${lot.service.id}` : lot.key.startsWith('community:apartment:') ? `home:${parseInt(lot.key.split(':')[2])}` : lot.key.startsWith('b:') ? lot.key : null;
export interface Plot { field: Field; x: number; y: number; s: number }
export interface Layout { lots: Lot[]; plots: Plot[]; roadY: number; buy: { x: number; y: number; s: number } | null; maxX: number; maxY: number; minX: number; minY: number }

/** The farmhouse grows with each chapter: 1 the homestead's cottage … 7 the City's mansion. */
export const farmhouseTier = (s: GameState) => Math.max(1, Math.min(7, (STAGE_IDS as readonly string[]).indexOf(s.stageId) + 1));
export function layoutRegion(s: GameState, r: RegionId): Layout {
  const w = worldOf(s, r), at = (k: string) => w.pos[k];
  const lots: Lot[] = [];
  const add = (key: string, place: string, type: Lot['type'], bs: Building[], extra: Partial<Lot> = {}) => {
    const p = at(place);
    if (!p) return;
    const [fw, fd] = FOOTPRINT[type], rot = w.rot?.[place] ?? 0, base = { w: fw, d: fd, ...extra };
    lots.push({ key, place, type, buildings: bs, x: p[0], y: p[1], ...extra, w: rot % 2 ? base.d : base.w, d: rot % 2 ? base.w : base.d, rot });
  };
  const yours = !isNeighbour(r) || s.fields.some((f) => f.region === r) || s.buildings.some((b) => b.region === r); // a neighbour's map has your office and trader only once you farm there
  if (yours) {
    add(r === 'heartland' ? 'house' : 'shed', r === 'heartland' ? 'farmhouse' : 'shed', r === 'heartland' ? 'house' : 'shed', [], r === 'heartland' ? { level: farmhouseTier(s), w: s.farmhouseSide ?? 3, d: s.farmhouseSide ?? 3 } : {});
    add('market', 'market', 'shed', []);
    add('crew', 'crew', 'house', []);
    add('office', 'office', 'house', []);
  }
  for (const b of s.buildings) if (b.region === r && BUILDINGS[b.type]) add(`b:${b.id}`, `b:${b.id}`, b.type, [b], (() => { const f = baseFootprint(s, `b:${b.id}`); return f ? { w: f.w, d: f.d } : {}; })()); // as built: merged spans, a vertical farm's level
  if (r === 'heartland' && communityOf(s).active) {
    for (const home of communityOf(s).homes) {
      const p = at(`home:${home.id}`);
      if (!p) continue;
      // blocks stand in rows of four inside the home's footprint
      const rot = w.rot?.[`home:${home.id}`] ?? 0; // a turned home lays its rows of blocks the other way
      for (let i = 0; i < HOME_BLOCKS(home); i++) { const a = (i % 4) * 4, b = Math.floor(i / 4) * 4; lots.push({ key: `community:${home.tier}:${home.id}-${i}`, place: `home:${home.id}`, type: 'house', buildings: [], x: p[0] + (rot % 2 ? b : a), y: p[1] + (rot % 2 ? a : b), w: 3, d: 3, rot, level: home.level ?? 1 }); }
    }
  }
  if (r === 'heartland' && townOf(s).active) {
    add('civic:hall', 'hall', 'house', [], { w: 4, d: 3 });
    for (const service of townOf(s).services) if (service.type !== 'road') add(`civic:${service.type}:${service.id}`, `svc:${service.id}`, 'house', [], { service, w: svcSide(service), d: svcSide(service) });
  }
  const plots: Plot[] = [];
  if (isNeighbour(r)) { // the neighbour's own town on its map
    const nt = neighbourTown(r);
    for (const l of nt.lots) lots.push({ key: l.key, place: l.key, type: 'house', buildings: [], x: l.x, y: l.y, w: l.rot % 2 ? l.d : l.w, d: l.rot % 2 ? l.w : l.d, rot: l.rot, level: l.level, neighbour: true, name: l.name || undefined });
    nt.fields.forEach((nf, i) => { const c = CROPS[nf.crop], ago = Math.round(nf.phase * c.growthTicks); plots.push({ field: { ...newField(s, r, 2, 0), id: -1000 - i, crop: nf.crop, plantedAt: c.perennial ? s.tick - 1e6 : s.tick - ago, cycleAt: s.tick - ago }, x: nf.x, y: nf.y, s: nf.s }); });
  }
  for (const f of s.fields) {
    if (f.region !== r) continue;
    const p = at(`field:${f.id}`);
    if (p) plots.push({ field: f, x: p[0], y: p[1], s: plotSide(f.ha) });
  }
  // The "for sale" plot sits on the nearest free cleared spot; buying it lets the player choose where it goes.
  let buy: Layout['buy'] = null;
  if (r === 'heartland' && s.stats.sales > 0 && s.regions.heartland.homePlotsBought < CONFIG.homePlots) {
    const kept = saleSpot.get(r), fp = { w: 4, d: 4 }; // a tile of space all round, so the sign never stands on a building's yard props
    const spot = kept && !placeProblem(s, r, kept[0], kept[1], fp) ? kept : findSpot(s, r, fp);
    if (spot) saleSpot.set(r, spot);
    if (spot) buy = { x: spot[0] + 1, y: spot[1] + 1, s: 2 };
  }
  const xs = [...lots.map((l) => [l.x, l.x + l.w]), ...plots.map((p) => [p.x, p.x + p.s])].flat(), ys = [...lots.map((l) => [l.y, l.y + l.d]), ...plots.map((p) => [p.y, p.y + p.s])].flat();
  return { lots, plots, roadY: ROAD_Y, buy, maxX: Math.max(35, ...xs), maxY: Math.max(ROAD_Y + 4, ...ys), minX: Math.min(0, ...xs), minY: Math.min(0, ...ys) };
}
export { MAP };
