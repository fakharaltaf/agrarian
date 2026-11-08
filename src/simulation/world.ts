// The map: where every field and building stands, which forest is cleared, and clearing work in progress.
// Positions are in tiles. The region is a fixed square of forest split into 4×4-tile patches ("chunks").
import { BUILDING_TYPES, type BuildingType, type RegionId } from './config';
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
export interface RegionWorld { cleared: number[]; pos: Record<string, [number, number]>; queue: ClearJob[] }
export type WorldState = Partial<Record<RegionId, RegionWorld>>;

/** Tiles each building occupies (x × y). */
export const FOOTPRINT: Record<BuildingType | 'house' | 'shed', [number, number]> = {
  house: [3, 3], shed: [2, 2], barn: [3, 2], silo: [2, 2], coldStore: [3, 2], warehouse: [5, 3], flourMill: [2, 2], bakery: [2, 2],
  feedMill: [3, 2], ranch: [5, 4], dairy: [5, 3], creamery: [3, 2], oilPress: [3, 2], sugarMill: [3, 2], biogas: [3, 3], solar: [5, 3],
  verticalFarm: [2, 2], distribution: [5, 3], lab: [3, 2], lab2: [4, 3], coop: [3, 3], pigsty: [4, 3], cowshed: [5, 4], sheepfold: [5, 4], winery: [3, 3],
};
/** Side length in tiles: area grows with hectares but stays legible (1 ha = 2×2 tiles … capped at 16×16). */
export const plotSide = (ha: number) => Math.max(2, Math.min(16, Math.round(2 * Math.sqrt(ha))));
/** Home blocks stand in rows of four (each house 3×3 with a one-tile path): 1 house is 3×3, 8 houses 15×7. */
export const HOME_BLOCKS = (h: CommunityHome) => Math.min(h.count, 8);
export const homeFootprint = (h: CommunityHome): Footprint => { const n = HOME_BLOCKS(h); return { w: Math.min(n, 4) * 4 - 1, d: Math.ceil(n / 4) * 4 - 1 }; };
export const SERVICE_FOOTPRINT: Footprint = { w: 3, d: 3 };

export const worldOf = (s: GameState, r: RegionId): RegionWorld => ((s.world ??= {})[r] ??= { cleared: [], pos: {}, queue: [] });
export const chunkAt = (x: number, y: number) => {
  const cx = Math.floor((x - MAP.x0) / CHUNK), cy = Math.floor((y - MAP.y0) / CHUNK);
  return cx < 0 || cy < 0 || cx >= CHUNKS_X || cy >= CHUNKS_Y ? -1 : cy * CHUNKS_X + cx;
};
export const chunkOrigin = (c: number): [number, number] => [MAP.x0 + (c % CHUNKS_X) * CHUNK, MAP.y0 + Math.floor(c / CHUNKS_X) * CHUNK];
const clearedSets = new WeakMap<number[], Set<number>>();
export function clearedSet(w: RegionWorld) {
  let set = clearedSets.get(w.cleared);
  if (!set || set.size !== w.cleared.length) { set = new Set(w.cleared); clearedSets.set(w.cleared, set); }
  return set;
}
export const isRoad = (y: number) => y >= ROAD_Y && y < ROAD_Y + ROAD_H;

/** Everything that stands on the map, with the key its position is saved under. */
export interface Placed { key: string; x: number; y: number; w: number; d: number }
export function footprintOf(s: GameState, key: string): Footprint | null {
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

/** Occupancy grid with a summed-area table: O(1) rectangle checks for placement and free-spot search. */
function occupancy(s: GameState, r: RegionId, ignore?: string, allowForest = false) {
  const W = MAP.w, H = MAP.h, grid = new Uint8Array(W * H), w = worldOf(s, r), cleared = clearedSet(w);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x + MAP.x0, wy = y + MAP.y0;
    if (isRoad(wy) || (!allowForest && !cleared.has(chunkAt(wx, wy)))) grid[y * W + x] = 1;
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
export type PlaceProblem = 'forest' | 'occupied' | 'road' | 'outside' | null;
/** Why a footprint cannot stand at (x, y), or null when it can. */
export function placeProblem(s: GameState, r: RegionId, x: number, y: number, fp: Footprint, ignore?: string): PlaceProblem {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'outside';
  if (x < MAP.x0 || y < MAP.y0 || x + fp.w > MAP.x0 + MAP.w || y + fp.d > MAP.y0 + MAP.h) return 'outside';
  for (let yy = y; yy < y + fp.d; yy++) if (isRoad(yy)) return 'road';
  const cleared = clearedSet(worldOf(s, r));
  for (let yy = y; yy < y + fp.d; yy++) for (let xx = x; xx < x + fp.w; xx++) if (!cleared.has(chunkAt(xx, yy))) return 'forest';
  if (!occupancy(s, r, ignore)(x, y, fp.w, fp.d)) return 'occupied';
  return null;
}
export const PROBLEM_TEXT: Record<Exclude<PlaceProblem, null>, string> = {
  forest: 'That spot is forest. Clear it first.', occupied: 'Something already stands there.', road: 'You cannot build on the road.', outside: 'That is off the map.',
};
/** First free cleared spot, searched outward from the farmhouse. */
export function findSpot(s: GameState, r: RegionId, fp: Footprint, allowForest = false): [number, number] | null {
  const fits = occupancy(s, r, undefined, allowForest);
  const [cx, cy] = worldOf(s, r).pos[r === 'heartland' ? 'farmhouse' : 'shed'] ?? [1, 1];
  for (let ring = 0; ring < Math.max(MAP.w, MAP.h); ring++) {
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
export function placeNew(s: GameState, r: RegionId, key: string, at?: [number, number]): string | null {
  const fp = footprintOf(s, key);
  if (!fp) return 'Nothing to place.';
  if (at) { const p = placeProblem(s, r, at[0], at[1], fp); if (p) return PROBLEM_TEXT[p]; worldOf(s, r).pos[key] = [at[0], at[1]]; return null; }
  const spot = findSpot(s, r, fp);
  if (!spot) return 'No cleared land is free. Clear forest to make room.';
  worldOf(s, r).pos[key] = spot;
  return null;
}
/** Check before money changes hands; the caller places after creating the object. */
export function canPlaceNew(s: GameState, r: RegionId, fp: Footprint, at?: [number, number]): string | null {
  if (at) { const p = placeProblem(s, r, at[0], at[1], fp); return p ? PROBLEM_TEXT[p] : null; }
  return findSpot(s, r, fp) ? null : 'No cleared land is free. Clear forest to make room.';
}
export const forget = (s: GameState, r: RegionId, key: string) => { delete worldOf(s, r).pos[key]; };

// ---------------------------------------------------------------- legacy layout (positions for saves made before the map)

const LOT_W = 7, LOT_D = 5, LOTS_PER_ROW = 5, FIELD_ROW_W = 46;
/** Rebuild the old automatic arrangement once, so existing farms look the same, then clear around it. */
export function seedWorld(s: GameState, r: RegionId) {
  const w = worldOf(s, r);
  if (Object.keys(w.pos).length) return;
  const put = (key: string, x: number, y: number) => { const fp = footprintOf(s, key); if (!fp) return; w.pos[key] = [x, y]; clearRect(w, x, y, fp.w, fp.d, 2); };
  put(r === 'heartland' ? 'farmhouse' : 'shed', 1, 1);
  if (r === 'heartland') { put('market', 1 * LOT_W + 1, 1); put('crew', 2 * LOT_W + 1, 1); put('office', 3 * LOT_W + 1, 1); }
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
    if (s.stageState.town?.active) put('hall', -31, 1);
    const order = ['school', 'well', 'clinic', 'road', 'hospital', 'waterworks', 'park', 'sanitation', 'lighting', 'police', 'watchtower', 'barracks'];
    for (const v of services) put(`svc:${v.id}`, -7 - DISTRICT_IDS.indexOf(v.district) * 8, -6 - order.indexOf(v.type) * 5);
  }
  // Second and later buildings of a type used to share one picture; give each its own spot nearby.
  for (const b of extra) { const fp = footprintOf(s, `b:${b.id}`)!; const spot = findSpot(s, r, fp, true); if (spot) { w.pos[`b:${b.id}`] = spot; clearRect(w, spot[0], spot[1], fp.w, fp.d, 1); } }
  // A new farm starts with room for the first chapter.
  if (r === 'heartland' && s.fields.length <= 1) clearRect(w, -8, -8, 40, 32);
}

// ---------------------------------------------------------------- clearing work

export const clearCost = (s: GameState) => Math.round(60 * s.macro.cpi * 100) / 100;
export function forestNextToClearing(w: RegionWorld, c: number) {
  const set = clearedSet(w), cx = c % CHUNKS_X, cy = Math.floor(c / CHUNKS_X);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const x = cx + dx, y = cy + dy; return x >= 0 && y >= 0 && x < CHUNKS_X && y < CHUNKS_Y && set.has(y * CHUNKS_X + x); });
}
/** Patches in a size×size block around a tile that are still forest. */
export function patchesAround(s: GameState, r: RegionId, x: number, y: number, size: number) {
  const w = worldOf(s, r), set = clearedSet(w), queued = new Set(w.queue.map((j) => j.chunk)), c0 = chunkAt(x, y), out: number[] = [];
  if (c0 < 0) return out;
  const cx = c0 % CHUNKS_X, cy = Math.floor(c0 / CHUNKS_X), half = Math.floor(size / 2);
  for (let dy = -half; dy < size - half; dy++) for (let dx = -half; dx < size - half; dx++) {
    const xx = cx + dx, yy = cy + dy;
    if (xx < 0 || yy < 0 || xx >= CHUNKS_X || yy >= CHUNKS_Y) continue;
    const c = yy * CHUNKS_X + xx;
    if (!set.has(c) && !queued.has(c)) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- reconcile

/** Every object that exists should stand somewhere. Landmarks appear with their chapter; anything else missing a spot
 *  (older saves, automation) gets the nearest free spot, clearing forest under it if there is no room. */
export function reconcileWorld(s: GameState, wanted: { farmMarket: boolean; crew: boolean; office: boolean; hall: boolean }) {
  for (const r of Object.keys(s.regions) as RegionId[]) {
    if (!s.regions[r].unlocked) continue;
    const w = worldOf(s, r);
    if (!Object.keys(w.pos).length) seedWorld(s, r);
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
    for (const k of Object.keys(w.pos)) if (!live.has(k)) delete w.pos[k];
    for (const k of keys) {
      if (w.pos[k]) continue;
      const fp = footprintOf(s, k);
      if (!fp) continue;
      const spot = findSpot(s, r, fp) ?? findSpot(s, r, fp, true);
      if (spot) { w.pos[k] = spot; clearRect(w, spot[0], spot[1], fp.w, fp.d); }
    }
  }
}

/** Forest patches on the edge of the clearing, nearest the farmhouse first: where a player would clear next. */
export function frontierPatches(s: GameState, r: RegionId, n: number) {
  const w = worldOf(s, r), set = clearedSet(w), queued = new Set(w.queue.map((j) => j.chunk));
  const [hx, hy] = w.pos[r === 'heartland' ? 'farmhouse' : 'shed'] ?? [1, 1], home = chunkAt(hx, hy);
  const hcx = home % CHUNKS_X, hcy = Math.floor(home / CHUNKS_X), out: [number, number][] = [];
  for (let c = 0; c < CHUNKS_X * CHUNKS_Y; c++) {
    if (set.has(c) || queued.has(c) || !forestNextToClearing(w, c)) continue;
    const cx = c % CHUNKS_X, cy = Math.floor(c / CHUNKS_X);
    out.push([c, (cx - hcx) ** 2 + (cy - hcy) ** 2]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, n).map((x) => x[0]);
}
