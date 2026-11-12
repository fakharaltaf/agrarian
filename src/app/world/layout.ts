// What stands where in a region's isometric world. Positions come from the saved map (simulation/world.ts);
// this module only turns them into drawable lots and plots. Deterministic: same state, same picture.
import { BUILDINGS, type BuildingType, type RegionId } from '../../simulation/config';
import type { Building, CivicService, Field, GameState } from '../../simulation/types';
import { townOf } from '../../simulation/town-state';
import { communityOf } from '../../simulation/community-state';
import { CONFIG } from '../../simulation/config';
import { FOOTPRINT, HOME_BLOCKS, MAP, ROAD_Y, findSpot, placeProblem, plotSide, worldOf } from '../../simulation/world';

/** Where each region's for-sale sign stands: it stays put until something is built on its spot. */
const saleSpot = new Map<RegionId, [number, number]>();
export { FOOTPRINT, plotSide } from '../../simulation/world';

/** `place` is the saved-map key this lot moves with (several home blocks share one). */
export interface Lot { key: string; place: string; type: BuildingType | 'house' | 'shed'; buildings: Building[]; service?: CivicService; x: number; y: number; w: number; d: number }
export interface Plot { field: Field; x: number; y: number; s: number }
export interface Layout { lots: Lot[]; plots: Plot[]; roadY: number; buy: { x: number; y: number; s: number } | null; maxX: number; maxY: number; minX: number; minY: number }

export function layoutRegion(s: GameState, r: RegionId): Layout {
  const w = worldOf(s, r), at = (k: string) => w.pos[k];
  const lots: Lot[] = [];
  const add = (key: string, place: string, type: Lot['type'], bs: Building[], extra: Partial<Lot> = {}) => {
    const p = at(place);
    if (!p) return;
    const [fw, fd] = FOOTPRINT[type];
    lots.push({ key, place, type, buildings: bs, x: p[0], y: p[1], w: fw, d: fd, ...extra });
  };
  add(r === 'heartland' ? 'house' : 'shed', r === 'heartland' ? 'farmhouse' : 'shed', r === 'heartland' ? 'house' : 'shed', []);
  add('market', 'market', 'shed', []);
  add('crew', 'crew', 'house', []);
  add('office', 'office', 'house', []);
  for (const b of s.buildings) if (b.region === r && BUILDINGS[b.type]) add(`b:${b.id}`, `b:${b.id}`, b.type, [b]);
  if (r === 'heartland' && communityOf(s).active) {
    for (const home of communityOf(s).homes) {
      const p = at(`home:${home.id}`);
      if (!p) continue;
      // blocks stand in rows of four inside the home's footprint
      for (let i = 0; i < HOME_BLOCKS(home); i++) lots.push({ key: `community:${home.tier}:${home.id}-${i}`, place: `home:${home.id}`, type: 'house', buildings: [], x: p[0] + (i % 4) * 4, y: p[1] + Math.floor(i / 4) * 4, w: 3, d: 3 });
    }
  }
  if (r === 'heartland' && townOf(s).active) {
    add('civic:hall', 'hall', 'house', [], { w: 4, d: 3 });
    for (const service of townOf(s).services) if (service.type !== 'road') add(`civic:${service.type}:${service.id}`, `svc:${service.id}`, 'house', [], { service, w: 3, d: 3 });
  }
  const plots: Plot[] = [];
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
