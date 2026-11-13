// The map: where every field and building stands, which forest is cleared, and clearing work in progress.
// Positions are in tiles. The region is a fixed square of forest split into 4×4-tile patches ("chunks").
import { BUILDING_TYPES, REGIONS, type BuildingType, type RegionId } from './config';
import { DISTRICT_IDS } from './types';
import type { Building, CivicService, CommunityHome, GameState } from './types';

export const CHUNK = 4;
export const MAP = { x0: -80, y0: -72, w: 192, h: 192 };
export const CHUNKS_X = MAP.w / CHUNK, CHUNKS_Y = MAP.h / CHUNK;
export const ROAD_Y = 6, ROAD_H = 2; // the main road crosses the whole map on rows 6–7
export const CLEAR_HOURS = 3; // contractor time per forest patch
export const TIMBER_PER_PATCH = 15;
export const MOVE_DOWNTIME = 6; // hours a moved building stands idle

export type Footprint = { w: number; d: number };
export interface ClearJob { chunk: number; hours: number }
/** owned: patches the farm has bought (you can only clear, farm and build on your own land). */
/** roads: grade (1 dirt, 2 gravel, 3 paved) by tile id; main: grade of the main road through the map. */
export interface RegionWorld { /** the town's utility lines by tier, like canals: power, water and sewer */ nets?: Partial<Record<UtilityNet, Record<number, number>>>; cleared: number[]; owned: number[]; pos: Record<string, [number, number]>; queue: ClearJob[]; roads: Record<number, number>; main: number; /** water lines by tier (WATER_TIERS): 1 ditch, 2 pipe, 3 buried; the first two take the tile */ canals: Record<number, number>; zones: Record<number, Zone>; links: Record<string, number[]>; /** quarter turns (0–3) of each placed thing; its front faces +y at 0, then +x, −y, −x */ rot?: Record<string, number> }
/** res: homes only (no farming); ind: industrial plants. Unzoned land is farmland. */
export type Zone = 'res' | 'ind';
/** What a placement is, for zoning: homes need a residential zone; fields stay out of zones; farm buildings stay out of residential; industry needs an industrial zone. */
export type Use = 'home' | 'field' | 'building' | 'industry';
/** Plants that belong on industrial land from the start. */
export const INDUSTRY_ONLY: ReadonlySet<BuildingType> = new Set(['biogas', 'windTurbine', 'oilWell', 'refinery', 'solar', 'distribution']);
/** Workshops that start anywhere off residential land, but grow past their first level only on industrial land. */
export const INDUSTRY_TO_GROW: ReadonlySet<BuildingType> = new Set(['flourMill', 'bakery', 'feedMill', 'ranch', 'dairy', 'creamery', 'oilPress', 'sugarMill', 'winery']);
/** The zoning a building at this level needs (the older progression keeps the plain farm rule). */
export const buildingUse = (s: GameState, type: BuildingType, level = 1): Use => (!s.legacyProgression && (INDUSTRY_ONLY.has(type) || (INDUSTRY_TO_GROW.has(type) && level > 1)) ? 'industry' : 'building');
export const useOf = (key?: string, s?: GameState): Use | undefined => {
  if (!key) return undefined;
  if (key.startsWith('home:')) return 'home';
  if (key.startsWith('field:')) return 'field';
  if (!key.startsWith('b:')) return undefined;
  const b = s?.buildings.find((x) => x.id === +key.slice(2));
  return s && b ? buildingUse(s, b.type, b.level) : 'building';
};
const zoneOk = (use: Use | undefined, z: Zone | undefined) => !use || (use === 'home' ? z === 'res' : use === 'field' ? !z : use === 'industry' ? z === 'ind' : z !== 'res');
const NO_ROOM = { home: 'No free residential land: zone more of your cleared land as residential.', industry: 'No free industrial land: zone some of your cleared land as industrial first (🏘 Zones).' } as Partial<Record<Use, string>>;
export type WorldState = Partial<Record<RegionId, RegionWorld>>;

/** Tiles each building occupies (x × y). */
export const FOOTPRINT: Record<BuildingType | 'house' | 'shed', [number, number]> = {
  house: [3, 3], shed: [2, 2], barn: [3, 2], silo: [2, 2], coldStore: [3, 2], warehouse: [5, 3], flourMill: [2, 2], bakery: [2, 2],
  feedMill: [3, 2], ranch: [5, 4], dairy: [5, 3], creamery: [3, 2], oilPress: [3, 2], sugarMill: [3, 2], biogas: [3, 3], solar: [5, 3],
  verticalFarm: [2, 2], windTurbine: [2, 2], oilWell: [2, 2], refinery: [12, 8], distribution: [5, 3], lab: [3, 2], lab2: [4, 3], coop: [3, 3], pigsty: [4, 3], cowshed: [5, 4], sheepfold: [5, 4], winery: [3, 3],
};
/** Side length in tiles: area grows with hectares but stays legible (1 ha = 2×2 tiles … capped at 16×16). */
export const plotSide = (ha: number) => Math.max(2, Math.min(16, Math.round(2 * Math.sqrt(ha))));
/** Home blocks stand in rows of four (each house 3×3 with a one-tile path): 1 house is 3×3, 8 houses 15×7. */
export const HOME_BLOCKS = (h: CommunityHome) => Math.min(h.count, 8);
export const homeFootprint = (h: CommunityHome): Footprint => { const n = HOME_BLOCKS(h); return { w: Math.min(n, 4) * 4 - 1, d: Math.ceil(n / 4) * 4 - 1 }; };
export const SERVICE_FOOTPRINT: Footprint = { w: 3, d: 3 };

export const worldOf = (s: GameState, r: RegionId): RegionWorld => { const w = ((s.world ??= {})[r] ??= { cleared: [], owned: [], pos: {}, queue: [], roads: {}, main: 1, canals: {}, zones: {}, links: {} }); w.owned ??= []; w.links ??= {}; w.roads ??= {}; w.main ??= 1; w.canals ??= {}; w.zones ??= {}; return w; };
export const chunkAt = (x: number, y: number) => {
  const cx = Math.floor((x - MAP.x0) / CHUNK), cy = Math.floor((y - MAP.y0) / CHUNK);
  return cx < 0 || cy < 0 || cx >= CHUNKS_X || cy >= CHUNKS_Y ? -1 : cy * CHUNKS_X + cx;
};
export const chunkOrigin = (c: number): [number, number] => [MAP.x0 + (c % CHUNKS_X) * CHUNK, MAP.y0 + Math.floor(c / CHUNKS_X) * CHUNK];
const sets = new WeakMap<number[], Set<number>>();
const setOf = (list: number[]) => { let set = sets.get(list); if (!set || set.size !== list.length) { set = new Set(list); sets.set(list, set); } return set; };
export const clearedSet = (w: RegionWorld) => setOf(w.cleared);
export const ownedSet = (w: RegionWorld) => setOf(w.owned);
/** Patches (cx, cy) in a rectangle of tiles, clipped to the map. */
export function chunksIn(x: number, y: number, fw: number, fd: number) {
  const out: number[] = [];
  for (let yy = y; yy < y + fd; yy += CHUNK) for (let xx = x; xx < x + fw; xx += CHUNK) { const c = chunkAt(xx, yy); if (c >= 0) out.push(c); }
  return out;
}
export function own(w: RegionWorld, chunks: number[]) { const set = ownedSet(w); for (const c of chunks) if (!set.has(c)) { set.add(c); w.owned.push(c); } }
/** A new farm owns a 24×24-tile valley around its yard (the main road runs through it); everything else is for sale. */
export const START_LAND = { x: -12, y: -8, w: 24, h: 24 };
/** Price of one 4×4-tile patch (about 4 ha): the region's land price, a little dearer for every patch already bought. */
export const LAND_HA_PER_PATCH = 4;
export const landPrice = (s: GameState, r: RegionId, already = 0) => {
  const bought = Math.max(0, worldOf(s, r).owned.length - 36) + already;
  return Math.round((REGIONS[r].landPrice / REGIONS[r].fx0) * s.regions[r].cpi * s.regions[r].fx * LAND_HA_PER_PATCH * (1 + 0.02 * bought));
};
const neighbours = (c: number) => { const cx = c % CHUNKS_X, cy = Math.floor(c / CHUNKS_X); return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < CHUNKS_X && y < CHUNKS_Y).map(([x, y]) => y * CHUNKS_X + x); };
/** Patches for sale next to the farm's land, nearest the yard first. */
export function landFrontier(s: GameState, r: RegionId, n: number) {
  const w = worldOf(s, r), owned = ownedSet(w), [hx, hy] = w.pos[r === 'heartland' ? 'farmhouse' : 'shed'] ?? [1, 1], home = chunkAt(hx, hy);
  const out: [number, number][] = [];
  for (let c = 0; c < CHUNKS_X * CHUNKS_Y; c++) if (!owned.has(c) && neighbours(c).some((x) => owned.has(x))) out.push([c, ((c % CHUNKS_X) - (home % CHUNKS_X)) ** 2 + (Math.floor(c / CHUNKS_X) - Math.floor(home / CHUNKS_X)) ** 2]);
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, n).map((x) => x[0]);
}
/** Which of these patches can be bought together: each must join land already owned (or another patch in the same deal). */
export function buyable(w: RegionWorld, chunks: number[]) {
  const owned = new Set(w.owned), want = new Set(chunks.filter((c) => c >= 0 && c < CHUNKS_X * CHUNKS_Y && !owned.has(c))), out: number[] = [];
  for (let grew = true; grew;) { grew = false; for (const c of want) if (neighbours(c).some((x) => owned.has(x))) { owned.add(c); want.delete(c); out.push(c); grew = true; } }
  return out;
}
export const isRoad = (y: number) => y >= ROAD_Y && y < ROAD_Y + ROAD_H;
export const tileId = (x: number, y: number) => (y - MAP.y0) * MAP.w + (x - MAP.x0);
export const tileAt = (id: number): [number, number] => [MAP.x0 + (id % MAP.w), MAP.y0 + Math.floor(id / MAP.w)];

/** Everything that stands on the map, with the key its position is saved under. */
export interface Placed { key: string; x: number; y: number; w: number; d: number }
/** How many quarter turns a placed thing stands at (keys are unique to one region, or square). */
export const rotOf = (s: GameState, key: string) => { for (const w of Object.values(s.world ?? {})) { const r = w?.rot?.[key]; if (r) return r; } return 0; };
/** A footprint after quarter turns: odd turns swap width and depth. */
export const turned = (fp: Footprint, rot: number): Footprint => (rot % 2 ? { w: fp.d, d: fp.w } : fp);
export function footprintOf(s: GameState, key: string): Footprint | null {
  const fp = baseFootprint(s, key);
  return fp && !key.startsWith('field:') ? turned(fp, rotOf(s, key)) : fp;
}
/** The footprint as built, before any turn. */
export function baseFootprint(s: GameState, key: string): Footprint | null {
  const [kind, id] = key.split(':');
  if (kind === 'field') { const f = s.fields.find((x) => x.id === +id); return f ? { w: plotSide(f.ha), d: plotSide(f.ha) } : null; }
  if (kind === 'b') { const b = s.buildings.find((x) => x.id === +id); if (!b) return null; const [w, d] = FOOTPRINT[b.type]; return { w, d }; }
  if (kind === 'home') { const h = (s.stageState.settlement?.homes as CommunityHome[] | undefined)?.find((x) => x.id === +id); return h ? homeFootprint(h) : null; }
  if (kind === 'svc') return SERVICE_FOOTPRINT;
  if (key === 'farmhouse') return { w: 3, d: 3 };
  if (key === 'shed') return { w: 2, d: 2 };
  if (key === 'market' || key === 'crew' || key === 'office') return { w: key === 'market' ? 2 : 3, d: key === 'market' ? 2 : 3 };
  if (key === 'hall') return { w: 4, d: 3 };
  return null;
}
export function placedIn(s: GameState, r: RegionId): Placed[] {
  const w = worldOf(s, r), out: Placed[] = [];
  for (const [key, [x, y]] of Object.entries(w.pos)) { const f = footprintOf(s, key); if (f) out.push({ key, x, y, ...f }); }
  return out;
}

/** How far a refinery's smoke reaches (tiles from its middle): families living inside it lose health. */
export const SMOKE_R = 30;
/** Share of the town's families living in a working refinery's smoke. */
export function smokedShare(s: GameState, homes: { x: number; y: number; families: number }[]) {
  const total = homes.reduce((n, h) => n + h.families, 0), w = worldOf(s, 'heartland');
  if (!total) return 0;
  const stacks = s.buildings.filter((b) => b.type === 'refinery' && b.active && b.region === 'heartland' && w.pos[`b:${b.id}`]).map((b) => { const p = w.pos[`b:${b.id}`], fp = footprintOf(s, `b:${b.id}`)!; return [p[0] + fp.w / 2, p[1] + fp.d / 2]; });
  return homes.reduce((n, h) => n + (stacks.some(([x, y]) => (x - h.x) ** 2 + (y - h.y) ** 2 <= SMOKE_R * SMOKE_R) ? h.families : 0), 0) / total;
}
/** Saves from before industrial zoning: land under plants already standing becomes industrial, unless homes or fields share it. */
export function zoneStandingIndustry(s: GameState) {
  for (const b of s.buildings) {
    if (buildingUse(s, b.type, b.level) !== 'industry') continue;
    const w = worldOf(s, b.region), p = w.pos[`b:${b.id}`], fp = footprintOf(s, `b:${b.id}`);
    if (!p || !fp) continue;
    const chunks = chunksIn(p[0], p[1], fp.w, fp.d);
    if (chunks.every((c) => w.zones[c] === 'ind')) continue;
    const shared = placedIn(s, b.region).some((q) => { const u = useOf(q.key, s); return (u === 'home' || u === 'field') && chunksIn(q.x, q.y, q.w, q.d).some((c) => chunks.includes(c)); });
    if (!shared) { for (const c of chunks) w.zones[c] = 'ind'; touch(w); }
  }
}
/** Occupancy grid with a summed-area table: O(1) rectangle checks for placement and free-spot search. */
function occupancy(s: GameState, r: RegionId, ignore?: string, allowForest = false, use?: Use) {
  const W = MAP.w, H = MAP.h, grid = new Uint8Array(W * H), w = worldOf(s, r), cleared = clearedSet(w), owned = ownedSet(w), river = riverTiles(r);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x + MAP.x0, wy = y + MAP.y0;
    const c = chunkAt(wx, wy);
    if (isRoad(wy) || w.roads[y * W + x] || waterBlocks(w, y * W + x) || river.has(y * W + x) || !owned.has(c) || (!allowForest && !cleared.has(c)) || !zoneOk(use, w.zones[c])) grid[y * W + x] = 1;
  }
  for (const p of placedIn(s, r)) {
    if (p.key === ignore) continue;
    // a one-tile path around everything already placed
    for (let y = p.y - 1; y < p.y + p.d + 1; y++) for (let x = p.x - 1; x < p.x + p.w + 1; x++) {
      const gx = x - MAP.x0, gy = y - MAP.y0;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) grid[gy * W + gx] = 1;
    }
  }
  const sat = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sat[(y + 1) * (W + 1) + x + 1] = grid[y * W + x] + sat[y * (W + 1) + x + 1] + sat[(y + 1) * (W + 1) + x] - sat[y * (W + 1) + x];
  return (x: number, y: number, fw: number, fd: number) => {
    const gx = x - MAP.x0, gy = y - MAP.y0;
    if (gx < 0 || gy < 0 || gx + fw > W || gy + fd > H) return false;
    const a = sat[gy * (W + 1) + gx], b = sat[gy * (W + 1) + gx + fw], c = sat[(gy + fd) * (W + 1) + gx], d = sat[(gy + fd) * (W + 1) + gx + fw];
    return d - b - c + a === 0;
  };
}
export type PlaceProblem = 'unowned' | 'forest' | 'occupied' | 'road' | 'water' | 'zone' | 'outside' | null;
/** Why a footprint cannot stand at (x, y), or null when it can. */
export function placeProblem(s: GameState, r: RegionId, x: number, y: number, fp: Footprint, ignore?: string, use: Use | undefined = useOf(ignore, s)): PlaceProblem {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'outside';
  if (x < MAP.x0 || y < MAP.y0 || x + fp.w > MAP.x0 + MAP.w || y + fp.d > MAP.y0 + MAP.h) return 'outside';
  const roads = worldOf(s, r).roads;
  const river = riverTiles(r), w = worldOf(s, r);
  for (let yy = y; yy < y + fp.d; yy++) for (let xx = x; xx < x + fp.w; xx++) if (river.has(tileId(xx, yy)) || waterBlocks(w, tileId(xx, yy))) return 'water';
  for (let yy = y; yy < y + fp.d; yy++) { if (isRoad(yy)) return 'road'; for (let xx = x; xx < x + fp.w; xx++) if (roads[tileId(xx, yy)]) return 'road'; }
  const cleared = clearedSet(worldOf(s, r)), owned = ownedSet(worldOf(s, r));
  for (let yy = y; yy < y + fp.d; yy++) for (let xx = x; xx < x + fp.w; xx++) if (!owned.has(chunkAt(xx, yy))) return 'unowned';
  for (let yy = y; yy < y + fp.d; yy++) for (let xx = x; xx < x + fp.w; xx++) if (!cleared.has(chunkAt(xx, yy))) return 'forest';
  const zones = worldOf(s, r).zones;
  for (let yy = y; yy < y + fp.d; yy++) for (let xx = x; xx < x + fp.w; xx++) if (!zoneOk(use, zones[chunkAt(xx, yy)])) return 'zone';
  if (!occupancy(s, r, ignore, false, use)(x, y, fp.w, fp.d)) return 'occupied';
  return null;
}
export const PROBLEM_TEXT: Record<Exclude<PlaceProblem, null>, string> = {
  unowned: 'You do not own that land. Buy it first.', zone: 'Wrong zone: homes go in a residential zone, plants and grown workshops in an industrial zone; fields and farm buildings stay out of residential.', water: 'That is the river or a water line. Upgrade the line until it is buried to build over it.', forest: 'That spot is forest. Clear it first.', occupied: 'Something already stands there.', road: 'You cannot build on the road.', outside: 'That is off the map.',
};
/** First free cleared spot, searched outward from the farmhouse. */
/** Where homes cluster: the middle of the placed homes, if any. */
export function homesCentre(w: RegionWorld): [number, number] | null {
  const hs = Object.entries(w.pos).filter(([k]) => k.startsWith('home:')).map(([, p]) => p);
  return hs.length ? [Math.round(hs.reduce((n, p) => n + p[0], 0) / hs.length), Math.round(hs.reduce((n, p) => n + p[1], 0) / hs.length)] : null;
}
/** The free spot nearest `near` (the farmhouse by default). */
export function findSpot(s: GameState, r: RegionId, fp: Footprint, allowForest = false, use?: Use, near?: [number, number] | null): [number, number] | null {
  const fits = occupancy(s, r, undefined, allowForest, use), w = worldOf(s, r);
  const [cx, cy] = near ?? w.pos[r === 'heartland' ? 'farmhouse' : 'shed'] ?? [1, 1];
  // nothing can stand off the farm's own land, so search no further than the far corner of what it owns
  let far = 0;
  for (const c of w.owned) { const [ox, oy] = chunkOrigin(c); far = Math.max(far, Math.abs(ox - cx), Math.abs(ox + CHUNK - cx), Math.abs(oy - cy), Math.abs(oy + CHUNK - cy)); }
  for (let ring = 0; ring <= far; ring++) {
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = cx + dx, y = cy + dy;
      if (fits(x, y, fp.w, fp.d)) return [x, y];
    }
  }
  return null;
}
export function clearRect(w: RegionWorld, x: number, y: number, fw: number, fd: number, margin = 0) {
  const set = clearedSet(w);
  for (let yy = y - margin; yy < y + fd + margin; yy++) for (let xx = x - margin; xx < x + fw + margin; xx++) {
    const c = chunkAt(xx, yy);
    if (c >= 0 && !set.has(c)) { set.add(c); w.cleared.push(c); }
  }
}
/** Place a new thing: at the player's chosen spot, or (automation, bulk builds) the first free spot. */
export function placeNew(s: GameState, r: RegionId, key: string, at?: [number, number], rot = 0): string | null {
  const w0 = worldOf(s, r);
  if (rot % 4) (w0.rot ??= {})[key] = rot % 4; else if (w0.rot) delete w0.rot[key];
  const fp = footprintOf(s, key);
  if (!fp) return 'Nothing to place.';
  const use = useOf(key, s);
  if (at) { const p = placeProblem(s, r, at[0], at[1], fp, undefined, use); if (p) return PROBLEM_TEXT[p]; worldOf(s, r).pos[key] = [at[0], at[1]]; touch(worldOf(s, r)); connect(s, r, key); return null; }
  const spot = findSpot(s, r, fp, false, use);
  if (!spot) return (use && NO_ROOM[use]) ?? 'No free cleared land of yours. Clear forest or buy more land.';
  worldOf(s, r).pos[key] = spot;
  touch(worldOf(s, r));
  connect(s, r, key); // a dirt track to the nearest road comes with every building
  return null;
}
/** Check before money changes hands; the caller places after creating the object. */
export function canPlaceNew(s: GameState, r: RegionId, fp0: Footprint, at?: [number, number], use?: Use, rot = 0): string | null {
  const fp = turned(fp0, rot);
  if (at) { const p = placeProblem(s, r, at[0], at[1], fp, undefined, use); return p ? PROBLEM_TEXT[p] : null; }
  return findSpot(s, r, fp, false, use) ? null : (use && NO_ROOM[use]) ?? 'No free cleared land of yours. Clear forest or buy more land.';
}
export const forget = (s: GameState, r: RegionId, key: string) => { const w = worldOf(s, r); delete w.pos[key]; if (w.rot) delete w.rot[key]; unlink(s, r, key); };

// ---------------------------------------------------------------- legacy layout (positions for saves made before the map)

const LOT_W = 7, LOT_D = 5, LOTS_PER_ROW = 5, FIELD_ROW_W = 46;
/** Rebuild the old automatic arrangement once, so existing farms look the same, then clear around it. */
export type Wanted = { farmMarket: boolean; crew: boolean; office: boolean; hall: boolean };
const NONE: Wanted = { farmMarket: false, crew: false, office: false, hall: false };
export function seedWorld(s: GameState, r: RegionId, wanted: Wanted = NONE) {
  const w = worldOf(s, r);
  if (Object.keys(w.pos).length) return;
  const put = (key: string, x: number, y: number) => { const fp = footprintOf(s, key); if (!fp) return; w.pos[key] = [x, y]; clearRect(w, x, y, fp.w, fp.d, 2); };
  put(r === 'heartland' ? 'farmhouse' : 'shed', 1, 1);
  // landmarks only once their chapter has arrived; later ones appear beside the farmhouse when it does
  if (r === 'heartland') { if (wanted.farmMarket) put('market', 1 * LOT_W + 1, 1); if (wanted.crew) put('crew', 2 * LOT_W + 1, 1); if (wanted.office) put('office', 3 * LOT_W + 1, 1); }
  const extra: Building[] = [];
  for (const t of BUILDING_TYPES) {
    const bs = s.buildings.filter((b) => b.region === r && b.type === t);
    if (!bs.length) continue;
    const i = BUILDING_TYPES.indexOf(t);
    put(`b:${bs[0].id}`, (i % LOTS_PER_ROW) * LOT_W + 1, -LOT_D * (1 + Math.floor(i / LOTS_PER_ROW)));
    extra.push(...bs.slice(1));
  }
  let x = 0, y = ROAD_Y + 2, rowH = 0;
  for (const f of s.fields.filter((f) => f.region === r)) {
    const side = plotSide(f.ha);
    if (x > 0 && x + side > FIELD_ROW_W) (x = 0), (y += rowH + 1), (rowH = 0);
    put(`field:${f.id}`, x, y); x += side + 1; rowH = Math.max(rowH, side);
  }
  if (r === 'heartland') {
    const homes = (s.stageState.settlement?.homes as CommunityHome[] | undefined) ?? [];
    const street = { cottage: 0, terrace: 1, apartment: 2 } as const;
    const used = [0, 0, 0];
    for (const h of homes) { const st = street[h.tier as keyof typeof street] ?? 0; put(`home:${h.id}`, -7 - st * 8, 1 + used[st]); used[st] += homeFootprint(h).d + 1; }
    const services = ((s.stageState.town?.services as CivicService[] | undefined) ?? []).filter((v) => v.type !== 'road');
    if (wanted.hall) put('hall', -31, 1);
    const order = ['school', 'well', 'clinic', 'road', 'hospital', 'waterworks', 'park', 'sanitation', 'lighting', 'police', 'watchtower', 'barracks'];
    for (const v of services) put(`svc:${v.id}`, -7 - DISTRICT_IDS.indexOf(v.district) * 8, -6 - order.indexOf(v.type) * 5);
  }
  // Second and later buildings of a type used to share one picture; give each its own spot nearby.
  for (const b of extra) { const fp = footprintOf(s, `b:${b.id}`)!; const spot = findSpot(s, r, fp, true); if (spot) { w.pos[`b:${b.id}`] = spot; clearRect(w, spot[0], spot[1], fp.w, fp.d, 1); } }
  // A new farm owns its valley, cleared and ready; a new region starts with the same block around its shed.
  if (s.fields.filter((f) => f.region === r).length <= 1) { const L = START_LAND; own(w, chunksIn(L.x, L.y, L.w, L.h)); clearRect(w, L.x, L.y, L.w, L.h); }
  own(w, w.cleared); // a farm laid out before land ownership owns everything it had cleared
  for (const k of Object.keys(w.pos)) connect(s, r, k);
}

// ---------------------------------------------------------------- clearing work

export const clearCost = (s: GameState) => Math.round(60 * s.macro.cpi * 100) / 100;
export function forestNextToClearing(w: RegionWorld, c: number) {
  const set = clearedSet(w), cx = c % CHUNKS_X, cy = Math.floor(c / CHUNKS_X);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const x = cx + dx, y = cy + dy; return x >= 0 && y >= 0 && x < CHUNKS_X && y < CHUNKS_Y && set.has(y * CHUNKS_X + x); });
}
/** Patches in a size×size block around a tile that are still forest. */
export function patchesAround(s: GameState, r: RegionId, x: number, y: number, size: number) {
  const w = worldOf(s, r), set = clearedSet(w), owned = ownedSet(w), queued = new Set(w.queue.map((j) => j.chunk)), c0 = chunkAt(x, y), out: number[] = [];
  if (c0 < 0) return out;
  const cx = c0 % CHUNKS_X, cy = Math.floor(c0 / CHUNKS_X), half = Math.floor(size / 2);
  for (let dy = -half; dy < size - half; dy++) for (let dx = -half; dx < size - half; dx++) {
    const xx = cx + dx, yy = cy + dy;
    if (xx < 0 || yy < 0 || xx >= CHUNKS_X || yy >= CHUNKS_Y) continue;
    const c = yy * CHUNKS_X + xx;
    if (owned.has(c) && !set.has(c) && !queued.has(c)) out.push(c);
  }
  return out;
}

/** Patches in a size×size block around a tile that are for sale and join the farm's land. */
export function forSaleAround(s: GameState, r: RegionId, x: number, y: number, size: number) {
  const c0 = chunkAt(x, y), out: number[] = [];
  if (c0 < 0) return out;
  const cx = c0 % CHUNKS_X, cy = Math.floor(c0 / CHUNKS_X), half = Math.floor(size / 2);
  for (let dy = -half; dy < size - half; dy++) for (let dx = -half; dx < size - half; dx++) { const xx = cx + dx, yy = cy + dy; if (xx >= 0 && yy >= 0 && xx < CHUNKS_X && yy < CHUNKS_Y) out.push(yy * CHUNKS_X + xx); }
  return buyable(worldOf(s, r), out);
}
export const landCost = (s: GameState, r: RegionId, n: number) => Array.from({ length: n }, (_, i) => landPrice(s, r, i)).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- reconcile

/** Every object that exists should stand somewhere. Landmarks appear with their chapter; anything else missing a spot
 *  (older saves, automation) gets the nearest free spot, clearing forest under it if there is no room. */
export function reconcileWorld(s: GameState, wanted: Wanted) {
  for (const r of Object.keys(s.regions) as RegionId[]) {
    if (!s.regions[r].unlocked) continue;
    const w = worldOf(s, r);
    if (!Object.keys(w.pos).length) seedWorld(s, r, wanted);
    const keys: string[] = [r === 'heartland' ? 'farmhouse' : 'shed'];
    if (r === 'heartland') {
      if (wanted.farmMarket) keys.push('market');
      if (wanted.crew) keys.push('crew');
      if (wanted.office) keys.push('office');
      if (wanted.hall) keys.push('hall');
      for (const h of (s.stageState.settlement?.homes as CommunityHome[] | undefined) ?? []) keys.push(`home:${h.id}`);
      for (const v of (s.stageState.town?.services as CivicService[] | undefined) ?? []) if (v.type !== 'road') keys.push(`svc:${v.id}`);
    }
    for (const f of s.fields) if (f.region === r) keys.push(`field:${f.id}`);
    for (const b of s.buildings) if (b.region === r) keys.push(`b:${b.id}`);
    const live = new Set(keys);
    for (const k of Object.keys(w.pos)) if (!live.has(k)) { delete w.pos[k]; unlink(s, r, k); }
    for (const k of keys) {
      if (w.pos[k]) continue;
      const fp = footprintOf(s, k);
      if (!fp) continue;
      const spot = findSpot(s, r, fp, false, useOf(k, s)) ?? findSpot(s, r, fp, true, useOf(k, s));
      if (spot) { w.pos[k] = spot; clearRect(w, spot[0], spot[1], fp.w, fp.d); connect(s, r, k); }
    }
  }
}

/** Forest patches on the edge of the clearing, nearest the farmhouse first: where a player would clear next. */
export function frontierPatches(s: GameState, r: RegionId, n: number) {
  const w = worldOf(s, r), set = clearedSet(w), owned = ownedSet(w), queued = new Set(w.queue.map((j) => j.chunk));
  const [hx, hy] = w.pos[r === 'heartland' ? 'farmhouse' : 'shed'] ?? [1, 1], home = chunkAt(hx, hy);
  const hcx = home % CHUNKS_X, hcy = Math.floor(home / CHUNKS_X), out: [number, number][] = [];
  for (let c = 0; c < CHUNKS_X * CHUNKS_Y; c++) {
    if (!owned.has(c) || set.has(c) || queued.has(c) || !forestNextToClearing(w, c)) continue;
    const cx = c % CHUNKS_X, cy = Math.floor(c / CHUNKS_X);
    out.push([c, (cx - hcx) ** 2 + (cy - hcy) ** 2]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, n).map((x) => x[0]);
}

// ---------------------------------------------------------------- roads

export const ROAD_GRADES = ['', 'Dirt track', 'Gravel road', 'Paved road'] as const;
/** Cost per tile to build (dirt) or bring a tile up to a grade. */
export const roadTilePrice = (s: GameState, grade: number) => Math.round([0, 5, 40, 150][grade] * s.macro.cpi * 100) / 100;
const BUILT = /^(b:|home:|svc:)/;
/** Everything built gets a track, landmarks too (the farmhouse's is where carts load); only BUILT things stop working without one. */
const TRACKED = /^(b:|home:|svc:|farmhouse$|shed$|market$|crew$|office$|hall$)/;
/** Things that need a road to work (fields don't). */
export const needsRoad = (key: string) => BUILT.test(key);
const inMap = (x: number, y: number) => x >= MAP.x0 && y >= MAP.y0 && x < MAP.x0 + MAP.w && y < MAP.y0 + MAP.h;
const isRoadTile = (w: RegionWorld, x: number, y: number) => inMap(x, y) && (isRoad(y) || !!w.roads[tileId(x, y)]);
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Tiles a road may be laid on: your own cleared land that nothing stands on. */
function openGround(s: GameState, r: RegionId) {
  const w = worldOf(s, r), cleared = clearedSet(w), owned = ownedSet(w), blocked = new Uint8Array(MAP.w * MAP.h);
  for (const p of placedIn(s, r)) for (let y = p.y; y < p.y + p.d; y++) for (let x = p.x; x < p.x + p.w; x++) if (inMap(x, y)) blocked[tileId(x, y)] = 1;
  const river = riverTiles(r);
  return (x: number, y: number) => { if (!inMap(x, y) || blocked[tileId(x, y)] || river.has(tileId(x, y))) return false; const c = chunkAt(x, y); return owned.has(c) && cleared.has(c); };
}
/** Tiles just outside a footprint, where a road would give it access. */
/** The tile(s) just outside the middle of a thing's front, where its door is. */
export function frontDoor(x: number, y: number, fp: Footprint, rot: number): [number, number][] {
  const along = rot % 2 ? fp.d : fp.w, mid = along % 2 ? [Math.floor(along / 2)] : [along / 2 - 1, along / 2];
  return mid.map((i): [number, number] => [[x + i, y + fp.d], [x + fp.w, y + i], [x + i, y - 1], [x - 1, y + i]][rot % 4] as [number, number]);
}
/** The whole front side (the door can't be reached straight on, but nearby is better than round the back). */
function frontSide(x: number, y: number, fp: Footprint, rot: number): [number, number][] {
  const n = rot % 2 ? fp.d : fp.w;
  return Array.from({ length: n }, (_, i): [number, number] => [[x + i, y + fp.d], [x + fp.w, y + i], [x + i, y - 1], [x - 1, y + i]][rot % 4] as [number, number]);
}
export function doorstep(x: number, y: number, fp: Footprint): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < fp.w; i++) out.push([x + i, y - 1], [x + i, y + fp.d]);
  for (let j = 0; j < fp.d; j++) out.push([x - 1, y + j], [x + fp.w, y + j]);
  return out;
}
/** Shortest route over open ground from any start tile to a tile where done() is true (that tile is not included). */
function route(open: (x: number, y: number) => boolean, starts: [number, number][], done: (x: number, y: number) => boolean, limit = 4000): [number, number][] | null {
  const prev = new Map<number, number>(), q: number[] = [];
  for (const [x, y] of starts) { if (!inMap(x, y)) continue; if (done(x, y)) return []; if (!open(x, y)) continue; const id = tileId(x, y); if (!prev.has(id)) { prev.set(id, -1); q.push(id); } }
  for (let h = 0; h < q.length && h < limit * 8; h++) {
    const id = q[h], [x, y] = tileAt(id);
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const nid = tileId(nx, ny);
      if (prev.has(nid)) continue;
      if (done(nx, ny)) { const path: [number, number][] = []; for (let c = id; c !== -1; c = prev.get(c)!) path.push(tileAt(c)); return path.reverse(); }
      if (!open(nx, ny)) continue;
      prev.set(nid, id); q.push(nid);
    }
  }
  return null;
}
/** Lay a free dirt track from a building to the nearest road (placing a building does this). Returns false if no route exists. */
export function connect(s: GameState, r: RegionId, key: string) {
  if (!TRACKED.test(key)) return true;
  const w = worldOf(s, r), p = w.pos[key], fp = footprintOf(s, key);
  if (!p || !fp) return false;
  const net = accessCache(s, w).net; // a stub that goes nowhere does not count
  // the track starts at the front door; only when that is boxed in does it leave from the side or the back
  const rot = key.startsWith('field:') ? 0 : rotOf(s, key), open = openGround(s, r), done = (x: number, y: number) => inMap(x, y) && (isRoad(y) || net.has(tileId(x, y)));
  const path = route(open, frontDoor(p[0], p[1], fp, rot), done) ?? route(open, frontSide(p[0], p[1], fp, rot), done) ?? route(open, doorstep(p[0], p[1], fp), done);
  if (!path) return false;
  const added = path.map(([x, y]) => tileId(x, y)).filter((id) => !w.roads[id]);
  for (const id of added) w.roads[id] = 1;
  if (added.length) w.links[key] = [...(w.links[key] ?? []), ...added]; // remembered, so the track goes when the building does
  touch(w);
  return true;
}
/** A building left or moved: lift the dirt track that was laid for it, unless the player upgraded it or another building's track uses it. Anything that loses its road gets a fresh track. */
export function unlink(s: GameState, r: RegionId, key: string) {
  const w = worldOf(s, r), mine = w.links[key];
  delete w.links[key];
  touch(w);
  if (!mine?.length) return;
  const used = new Set(Object.values(w.links).flat()), before = Object.keys(w.pos).filter((k) => hasAccess(s, r, k));
  for (const id of mine) if (!used.has(id) && w.roads[id] === 1) delete w.roads[id];
  touch(w);
  for (const k of before) if (!hasAccess(s, r, k)) connect(s, r, k);
}
/** Road access is cached per region: recomputed every game hour and straight away when roads or buildings change (touch). */
const revs = new WeakMap<RegionWorld, number>();
export const touch = (w: RegionWorld) => { revs.set(w, (revs.get(w) ?? 0) + 1); };
const access = new WeakMap<RegionWorld, { sig: string; net: Set<number>; seen: Map<string, boolean> }>();
function accessCache(s: GameState, w: RegionWorld) {
  const sig = `${s.tick}|${revs.get(w) ?? 0}`, hit = access.get(w);
  if (hit && hit.sig === sig) return hit;
  const net = new Set<number>(), q: number[] = [];
  for (const k of Object.keys(w.roads)) { const id = Number(k), [x, y] = tileAt(id); if (STEPS.some(([dx, dy]) => isRoad(y + dy) && inMap(x + dx, y + dy))) { net.add(id); q.push(id); } }
  for (let h = 0; h < q.length; h++) { const [x, y] = tileAt(q[h]); for (const [dx, dy] of STEPS) { const nid = tileId(x + dx, y + dy); if (inMap(x + dx, y + dy) && w.roads[nid] && !net.has(nid)) { net.add(nid); q.push(nid); } } }
  const fresh = { sig, net, seen: new Map<string, boolean>() };
  access.set(w, fresh);
  return fresh;
}
/** Does this building touch a road that leads to the main road? */
export function hasAccess(s: GameState, r: RegionId, key: string) {
  if (!needsRoad(key)) return true;
  const w = worldOf(s, r), c = accessCache(s, w), known = c.seen.get(key);
  if (known !== undefined) return known;
  const p = w.pos[key], fp = footprintOf(s, key);
  const ok = !p || !fp || doorstep(p[0], p[1], fp).some(([x, y]) => inMap(x, y) && (isRoad(y) || c.net.has(tileId(x, y)))); // not on the map yet: nothing to cut off
  c.seen.set(key, ok);
  return ok;
}
/** Said when something was placed but could not be given a track: the player must draw one. */
export const accessNote = (s: GameState, r: RegionId, key: string) => hasAccess(s, r, key) ? undefined : 'No route to a road from there: draw one with 🛤, or it won\'t work.';
/** Route for a player-drawn road between two tiles, over open ground and existing roads. */
export function roadRoute(s: GameState, r: RegionId, from: [number, number], to: [number, number]) {
  const w = worldOf(s, r), open = openGround(s, r);
  const can = (x: number, y: number) => open(x, y) || isRoadTile(w, x, y);
  if (!can(from[0], from[1]) || !can(to[0], to[1])) return null;
  const path = route(can, [from], (x, y) => x === to[0] && y === to[1]);
  return path ? [...path, to].filter(([x, y]) => !isRoadTile(w, x, y)) : null;
}
/** Names of the things that would lose their road if these road tiles went. */
export function cutsOff(s: GameState, r: RegionId, ids: number[]): string[] {
  const w = worldOf(s, r), keep = ids.map((id) => [id, w.roads[id]] as const), before = new Set(Object.keys(w.pos).filter((k) => hasAccess(s, r, k)));
  for (const id of ids) delete w.roads[id];
  touch(w);
  const lost = [...before].filter((k) => !hasAccess(s, r, k));
  for (const [id, g] of keep) w.roads[id] = g;
  touch(w);
  return lost;
}
/** The stretch of road at a tile: runs along the track until a junction or the main road. */
export function roadStretch(w: RegionWorld, x: number, y: number): number[] {
  const start = tileId(x, y);
  if (!inMap(x, y) || !w.roads[start]) return [];
  const degree = (id: number) => { const [a, b] = tileAt(id); return STEPS.filter(([dx, dy]) => isRoadTile(w, a + dx, b + dy)).length; };
  if (STEPS.filter(([dx, dy]) => isRoadTile(w, x + dx, y + dy)).length >= 3) return [start]; // a junction: just this tile
  const out = [start], seen = new Set(out);
  for (let h = 0; h < out.length; h++) {
    if (h > 0 && degree(out[h]) >= 3) continue; // stop at junctions (the junction tile itself stays)
    const [a, b] = tileAt(out[h]);
    for (const [dx, dy] of STEPS) { const nid = tileId(a + dx, b + dy); if (inMap(a + dx, b + dy) && w.roads[nid] && !seen.has(nid)) { seen.add(nid); out.push(nid); } }
  }
  return out.filter((id, i) => i === 0 || degree(id) < 3);
}

// ---------------------------------------------------------------- the river and irrigation channels

const rivers = new Map<RegionId, Set<number>>();
/** The river's west tile at row y; it keeps going past the map edges, where it is only scenery. */
export function riverX(r: RegionId, y: number) {
  const k = [...r].reduce((a, ch) => a + ch.charCodeAt(0), 0), base = r === 'heartland' ? -27 : -27 + ((k * 37) % 21) - 10;
  return Math.round(base + 5 * Math.sin(y * 0.06 + k) + 2 * Math.sin(y * 0.17 + 1));
}
/** Each region's river: two tiles wide, winding north to south. In Heartland it runs just west of the starting valley. */
export function riverTiles(r: RegionId): Set<number> {
  const hit = rivers.get(r);
  if (hit) return hit;
  const set = new Set<number>();
  let prev: number | null = null;
  for (let y = MAP.y0; y < MAP.y0 + MAP.h; y++) {
    const x = riverX(r, y);
    const from = prev === null ? x : Math.min(prev, x), to = prev === null ? x : Math.max(prev, x);
    for (let xx = from; xx <= to; xx++) for (const dx of [0, 1]) if (inMap(xx + dx, y)) set.add(tileId(xx + dx, y)); // no gaps where it bends
    prev = x;
  }
  rivers.set(r, set);
  return set;
}
/** Water lines by tier: 1 a ditch dug in the soil, 2 a pipe on posts, 3 a buried pipe (its tile is free again). Each tier keeps the fields it feeds wetter. */
export const WATER_TIERS = ['', 'Ditch', 'Pipe', 'Buried pipe'] as const, WATER_PRICE = [0, 5, 15, 25], WATER_LEVEL = [0, 0.6, 0.7, 0.8];
/** Does a water line on this tile take the ground (ditches and surface pipes do, buried pipe does not)? */
/** Line networks: irrigation from the river, and the town's utilities from their buildings. Each has its own tiers; the top tier is underground and frees the land. */
export type UtilityNet = 'power' | 'water' | 'sewer';
export type NetKind = 'irrigation' | UtilityNet;
export const UTILITY_NETS: UtilityNet[] = ['power', 'water', 'sewer'];
export const NET_TOP: Record<NetKind, number> = { irrigation: 3, power: 2, water: 2, sewer: 3 };
export const NET_TIERS: Record<NetKind, readonly string[]> = { irrigation: WATER_TIERS, power: ['', 'Power line on pylons', 'Underground cable'], water: ['', 'Water pipe', 'Buried water main'], sewer: ['', 'Sewage ditch', 'Drainage pipe', 'Underground sewer'] };
export const NET_PRICE: Record<NetKind, number[]> = { irrigation: WATER_PRICE, power: [0, 20, 60], water: [0, 15, 45], sewer: [0, 8, 25, 60] };
/** How well a home on a utility line is served, by the weakest tier on its way to the building. */
export const NET_QUALITY: Record<UtilityNet, number[]> = { power: [0, 0.8, 1], water: [0, 0.8, 1], sewer: [0, 0.6, 0.8, 1] };
export const linesOf = (w: RegionWorld, kind: NetKind): Record<number, number> => (kind === 'irrigation' ? w.canals : ((w.nets ??= {})[kind] ??= {}));
/** Does a line on this tile take the ground (every tier below underground does)? */
export const waterBlocks = (w: RegionWorld, id: number) => (w.canals[id] ?? 3) < 3 || UTILITY_NETS.some((k) => { const t = w.nets?.[k]?.[id]; return !!t && t < NET_TOP[k]; });
/** Where a pipe may run: your own cleared open land, under roads, and along other pipes. */
function pipeGround(s: GameState, r: RegionId, kind: NetKind) {
  const w = worldOf(s, r), open = openGround(s, r), owned = ownedSet(w), own = linesOf(w, kind);
  return (x: number, y: number) => open(x, y) || (inMap(x, y) && owned.has(chunkAt(x, y)) && (isRoad(y) || !!w.roads[tileId(x, y)] || !!own[tileId(x, y)]));
}
/** A pipe drawn by hand, from one tile to another, over ground a pipe may cross. New tiles only; null if there is no way. */
export function pipeRoute(s: GameState, r: RegionId, from: [number, number], to: [number, number], kind: NetKind = 'irrigation') {
  const own = linesOf(worldOf(s, r), kind), can = pipeGround(s, r, kind);
  // a tap on a building or a field means its edge: the line starts beside it, or runs up to it
  const lotAt = (p: [number, number]) => (can(p[0], p[1]) ? null : placedIn(s, r).find((q) => p[0] >= q.x && p[0] < q.x + q.w && p[1] >= q.y && p[1] < q.y + q.d) ?? null);
  const fromLot = lotAt(from), toLot = lotAt(to);
  if ((!can(from[0], from[1]) && !fromLot) || (!can(to[0], to[1]) && !toLot)) return null;
  const starts = fromLot ? doorstep(fromLot.x, fromLot.y, fromLot).filter(([x, y]) => inMap(x, y) && can(x, y)) : [from];
  const arrived = (x: number, y: number) => (toLot ? x >= toLot.x && x < toLot.x + toLot.w && y >= toLot.y && y < toLot.y + toLot.d : x === to[0] && y === to[1]);
  if (fromLot && toLot && fromLot.key === toLot.key) return starts.length ? [] : null; // tapped the building it starts from
  const path = route(can, starts, arrived);
  return path ? (toLot ? path : [...path, to]).filter(([x, y]) => !own[tileId(x, y)]) : null;
}
/** The run of pipe at a tile, up to the next junction (like a stretch of road). */
export function pipeStretch(w: RegionWorld, x: number, y: number, kind: NetKind = 'irrigation'): number[] {
  const own = linesOf(w, kind), start = tileId(x, y), has = (a: number, b: number) => inMap(a, b) && !!own[tileId(a, b)];
  if (!has(x, y)) return [];
  const degree = (id: number) => { const [a, b] = tileAt(id); return STEPS.filter(([dx, dy]) => has(a + dx, b + dy)).length; };
  if (degree(start) >= 3) return [start];
  const out = [start], seen = new Set(out);
  for (let h = 0; h < out.length; h++) {
    if (h > 0 && degree(out[h]) >= 3) continue;
    const [a, b] = tileAt(out[h]);
    for (const [dx, dy] of STEPS) { const nid = tileId(a + dx, b + dy); if (has(a + dx, b + dy) && !seen.has(nid)) { seen.add(nid); out.push(nid); } }
  }
  return out.filter((id, i) => i === 0 || degree(id) < 3);
}
/** Land within 2 tiles of the river: the drawn river and its banks are wider than its tiles, so a line started on the bank takes water. */
const banks = new Map<RegionId, Set<number>>();
export function riverBank(r: RegionId): Set<number> {
  const hit = banks.get(r);
  if (hit) return hit;
  const river = riverTiles(r), set = new Set<number>();
  for (const id of river) { const [x, y] = tileAt(id); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const n = tileId(x + dx, y + dy); if (inMap(x + dx, y + dy) && !river.has(n)) set.add(n); } }
  banks.set(r, set);
  return set;
}
/** The tier of water each line tile carries: the weakest stretch on its best way back to the river. Cached until lines change (touch). */
const wetCache = new WeakMap<RegionWorld, { rev: number; tiers: Map<number, number> }>();
export function wetTiers(s: GameState, r: RegionId): Map<number, number> {
  const w = worldOf(s, r), rev = revs.get(w) ?? 0, hit = wetCache.get(w);
  if (hit && hit.rev === rev) return hit.tiers;
  const bank = riverBank(r), tiers = new Map<number, number>();
  for (const t of [3, 2, 1]) { // flood the best tier first; a tile keeps the first (best) tier that reaches it
    const q: number[] = [], seen = new Set<number>();
    for (const k of Object.keys(w.canals)) { const id = Number(k); if (w.canals[id] >= t && bank.has(id)) { seen.add(id); q.push(id); } }
    for (let h = 0; h < q.length; h++) { const [x, y] = tileAt(q[h]); for (const [dx, dy] of STEPS) { const nid = tileId(x + dx, y + dy); if (inMap(x + dx, y + dy) && w.canals[nid] >= t && !seen.has(nid)) { seen.add(nid); q.push(nid); } } }
    for (const id of seen) if (!tiers.has(id)) tiers.set(id, t);
  }
  wetCache.set(w, { rev, tiers });
  return tiers;
}
/** How a field gets water: the joins where a wet line (or the river itself, like a ditch) meets its edge (a line running along one side is one join), how many it needs for full flow (bigger fields need more), and the best tier reaching it. */
export function fieldWater(s: GameState, r: RegionId, key: string) {
  const w = worldOf(s, r), p = w.pos[key], fp = footprintOf(s, key);
  if (!p || !fp) return { points: 1, need: 1, tier: 1 }; // not on the map: leave it be
  const river = riverTiles(r), wet = wetTiers(s, r);
  let points = 0, tier = 0;
  const tierAt = (x: number, y: number) => (inMap(x, y) ? wet.get(tileId(x, y)) ?? (river.has(tileId(x, y)) ? 1 : 0) : 0);
  for (const [x, y] of doorstep(p[0], p[1], fp)) {
    const t = tierAt(x, y);
    if (!t) continue;
    tier = Math.max(tier, t);
    const along = y < p[1] || y >= p[1] + fp.d ? x > p[0] && tierAt(x - 1, y) : y > p[1] && tierAt(x, y - 1); // the tile before it on the same side
    if (!along) points++;
  }
  return { points, need: Math.ceil(Math.max(fp.w, fp.d) / 8), tier };
}
export const hasWater = (s: GameState, r: RegionId, key: string) => fieldWater(s, r, key).points > 0;

/** A utility network seen from its building's doorstep: each line tile it reaches, with the weakest tier on the best way there and how far along the line it is. */
export function netReach(w: RegionWorld, kind: UtilityNet, starts: [number, number][]) {
  const own = linesOf(w, kind), tier = new Map<number, number>(), dist = new Map<number, number>();
  for (let t = NET_TOP[kind]; t >= 1; t--) {
    const q: number[] = [], d = new Map<number, number>();
    for (const [x, y] of starts) { const id = tileId(x, y); if (inMap(x, y) && own[id] >= t && !d.has(id)) { d.set(id, 0); q.push(id); } }
    for (let h = 0; h < q.length; h++) { const [x, y] = tileAt(q[h]); for (const [dx, dy] of STEPS) { const n = tileId(x + dx, y + dy); if (inMap(x + dx, y + dy) && own[n] >= t && !d.has(n)) { d.set(n, d.get(q[h])! + 1); q.push(n); } } }
    for (const [id, v] of d) { if (!tier.has(id)) tier.set(id, t); if (t === 1) dist.set(id, v); }
  }
  return { tier, dist };
}
