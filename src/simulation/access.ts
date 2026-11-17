// Getting there by road: how long it takes from a building's door to each tile of road, by the road's
// grade (dirt, gravel, paved), its width, and the traffic on it. Town services reach homes by this travel,
// not as the crow flies: a school three streets away up a dirt track serves less than one down a paved avenue.
import type { GameState } from './types';
import type { RegionId } from './config';
import { doorstep, footprintOf, isRoad, MAP, revOf, tileAt, tileId, worldOf, type RegionWorld } from './world';

/** Time to cross one tile, by grade (0 the main road): dirt is slow, paved is quick. */
const GRADE_COST = [1, 1.8, 1.35, 1];
/** Cars a tile of road carries at ease, per tile of width, by grade. */
const GRADE_CAP = [80, 12, 25, 40];

export const roadTile = (w: RegionWorld, id: number) => id >= 0 && id < MAP.w * MAP.h && (w.roads[id] !== undefined || isRoad(Math.floor(id / MAP.w) + MAP.y0));
const gradeOf = (w: RegionWorld, id: number) => (w.roads[id] !== undefined ? w.roads[id] : 0);

/** How many tiles wide the road is here: the narrower of its runs across and along (a junction is as wide as its street). */
export function roadWidth(w: RegionWorld, id: number) {
  const [x, y] = tileAt(id), run = (dx: number, dy: number) => { let n = 1; for (let k = 1; k < 6 && roadTile(w, tileId(x + dx * k, y + dy * k)); k++) n++; for (let k = 1; k < 6 && roadTile(w, tileId(x - dx * k, y - dy * k)); k++) n++; return n; };
  return Math.max(1, Math.min(5, run(1, 0), run(0, 1)));
}

/** Who makes the traffic: homes by their families (each trip out and back). */
export interface TripSource { door: number[]; trips: number }
/** Where trips go: shops, markets and the mall draw the most, offices their workers, schools and clinics some. */
export interface TripSink { door: number[]; pull: number }
/** A parking complex: takes this share of the cars off the streets within its reach. */
export interface Parking { door: number[]; reach: number; share: number }

/** Each home's trips go to the places that draw them, split by how strongly each draws and how near it is by road, along the quickest way there.
 *  The cars counted on each tile, less what car parks take off the streets around them, against what the road carries, give how slow it is. */
export function trafficOf(w: RegionWorld, sources: TripSource[], sinks: TripSink[], parks: Parking[]) {
  const load = new Map<number, number>();
  const maps = sinks.map((k) => ({ pull: k.pull, ...paths(w, k.door, 160) }));
  for (const src of sources) {
    const reach = maps.map((m) => { let best = Infinity, at = -1; for (const id of src.door) { const c = m.best.get(id); if (c !== undefined && c < best) { best = c; at = id; } } return { m, at, w: at < 0 ? 0 : m.pull / (4 + best) ** 2 }; }).filter((x) => x.w > 0);
    const sum = reach.reduce((a, b) => a + b.w, 0);
    for (const r of reach) { const cars = src.trips * r.w / sum; for (let id = r.at; id >= 0; id = r.m.prev.get(id) ?? -1) load.set(id, (load.get(id) ?? 0) + cars); }
  }
  for (const p of parks) for (const id of spread(w, p.door, p.reach)) { const l = load.get(id); if (l) load.set(id, l * (1 - p.share)); }
  // the cars share out across the street's lanes: pool each tile's load over the row of tiles across the street
  const lanes = new Map<number, number>();
  for (const [id, l] of load) { const across = crossing(w, id); for (const a of across) lanes.set(a, (lanes.get(a) ?? 0) + l / across.length); }
  const slow: Record<number, number> = {}, flow: Record<number, number> = {};
  for (const [id, l] of lanes) {
    if (l >= 0.5) flow[id] = Math.round(l);
    const f = slowdown(l / GRADE_CAP[gradeOf(w, id)]);
    if (f > 1.02) slow[id] = Math.round(f * 100) / 100;
  }
  return { slow, flow };
}
/** Quickest routes back to a door: travel time to every road tile, and the next tile on the way. */
function paths(w: RegionWorld, door: number[], budget: number) {
  const best = new Map<number, number>(), prev = new Map<number, number>(), heap: [number, number][] = [];
  const push = (c: number, id: number) => { heap.push([c, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const id of door) if (roadTile(w, id)) { best.set(id, 0); push(0, id); }
  while (heap.length) {
    const [c, id] = pop();
    if (c > (best.get(id) ?? Infinity)) continue;
    const [x, y] = tileAt(id);
    for (const n of [tileId(x + 1, y), tileId(x - 1, y), tileId(x, y + 1), tileId(x, y - 1)]) {
      if (!roadTile(w, n)) continue;
      const nc = c + GRADE_COST[gradeOf(w, n)] / (1 + 0.08 * (roadWidth(w, n) - 1));
      if (nc > budget || nc >= (best.get(n) ?? Infinity)) continue;
      best.set(n, nc); prev.set(n, id); push(nc, n);
    }
  }
  return { best, prev };
}

/** How much longer a tile takes to cross at this load (cars over what one lane carries): barely slower when quiet, sharply slower past capacity (the classic road-traffic curve). */
export const slowdown = (x: number) => Math.min(5, 1 + 0.6 * x ** 4);
/** Cars a lane of this tile carries at ease. */
export const laneCapacity = (w: RegionWorld, id: number) => GRADE_CAP[gradeOf(w, id)];
/** How hard a road tile is pressed: the cars on it over what it carries (1 = at capacity). */
export const pressureOf = (s: GameState, w: RegionWorld, id: number) => ((s.stageState.town as { flow?: Record<number, number> } | undefined)?.flow?.[id] ?? 0) / laneCapacity(w, id);
/** The street at a spot before anything stands there is jammed. */
export function streetJammedAt(s: GameState, w: RegionWorld, x: number, y: number, fw: number, fd: number) {
  const slow = (s.stageState.town as { traffic?: Record<number, number> } | undefined)?.traffic ?? {};
  return spread(w, doorstep(x, y, { w: fw, d: fd }).map(([a, b]) => tileId(a, b)), 2).some((id) => (slow[id] ?? 1) >= JAM);
}
/** The tiles across the street at this tile: the narrower of its runs (its width). */
function crossing(w: RegionWorld, id: number) {
  const [x, y] = tileAt(id), run = (dx: number, dy: number) => { const out = [id]; for (let k = 1; k < 6 && roadTile(w, tileId(x + dx * k, y + dy * k)); k++) out.push(tileId(x + dx * k, y + dy * k)); for (let k = 1; k < 6 && roadTile(w, tileId(x - dx * k, y - dy * k)); k++) out.push(tileId(x - dx * k, y - dy * k)); return out; };
  const a = run(1, 0), b = run(0, 1);
  return a.length <= b.length ? a : b;
}
/** The street outside a placed thing can't keep up: traffic at or near its door is slowed to well under half speed. Nothing there may grow until it is widened or eased. */
export const JAM = 1.6;
export function streetJammed(s: GameState, r: RegionId, key: string) {
  if (r !== 'heartland') return false;
  const slow = (s.stageState.town as { traffic?: Record<number, number> } | undefined)?.traffic ?? {};
  return spread(worldOf(s, r), doorTiles(s, r, key), 2).some((id) => (slow[id] ?? 1) >= JAM);
}
export const JAM_TEXT = 'The street outside is jammed: widen it, pave it, add another route or a parking complex nearby before this grows.';
// ---------------------------------------------------------------- frontage: the street a building stands on
/** The widest street within a short drive of these door tiles, and its grade: what a building fronts onto. */
export function frontageOf(w: RegionWorld, door: number[]) {
  let lanes = 0, grade = 0;
  for (const id of spread(w, door, 3)) { const g = gradeOf(w, id) || 3, l = roadWidth(w, id); if (l > lanes || (l === lanes && g > grade)) { lanes = l; grade = g; } }
  return { lanes, grade };
}
/** What a building needs to front onto, by how many people it brings: lanes, and whether paved. */
export interface LaneNeed { lanes: number; paved: boolean }
export const NO_NEED: LaneNeed = { lanes: 1, paved: false };
export const APARTMENT_NEED: LaneNeed[] = [{ lanes: 2, paved: false }, { lanes: 2, paved: true }, { lanes: 3, paved: true }];
export const OFFICE_NEED: LaneNeed[] = [{ lanes: 2, paved: false }, { lanes: 3, paved: true }, { lanes: 4, paved: true }];
export const MARKET_NEED: LaneNeed = { lanes: 2, paved: false }, MALL_NEED: LaneNeed = { lanes: 4, paved: true }, COMPLEX_NEED: LaneNeed = { lanes: 2, paved: false }, PARKING_NEED: LaneNeed = { lanes: 2, paved: false };
export const meets = (f: { lanes: number; grade: number }, n: LaneNeed) => f.lanes >= n.lanes && (!n.paved || f.grade >= 3);
export const needText = (n: LaneNeed) => `${n.lanes > 1 ? `a ${n.lanes}-lane` : 'a'}${n.paved ? ' paved' : ''} road at its door`;
/** The frontage of a footprint at (x, y) before anything stands there. */
export const frontageAt = (w: RegionWorld, x: number, y: number, fw: number, fd: number) => frontageOf(w, doorstep(x, y, { w: fw, d: fd }).map(([a, b]) => tileId(a, b)));

/** Road tiles within this many steps of a door. */
function spread(w: RegionWorld, door: number[], steps: number) {
  const seen = new Set<number>(), out: number[] = [];
  let edge = door.filter((id) => roadTile(w, id));
  for (const id of edge) seen.add(id);
  for (let k = 0; k <= steps && edge.length; k++) {
    out.push(...edge);
    const next: number[] = [];
    for (const id of edge) { const [x, y] = tileAt(id); for (const n of [tileId(x + 1, y), tileId(x - 1, y), tileId(x, y + 1), tileId(x, y - 1)]) if (!seen.has(n) && roadTile(w, n)) { seen.add(n); next.push(n); } }
    edge = next;
  }
  return out;
}

/** Travel time from these doors to every road tile within the budget (Dijkstra; paved and wide is quick, dirt and jammed is slow). */
export function travelFrom(w: RegionWorld, door: number[], budget: number, slow: Record<number, number> = {}) {
  const best = new Map<number, number>(), heap: [number, number][] = [];
  const push = (c: number, id: number) => { heap.push([c, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const id of door) if (roadTile(w, id)) { best.set(id, 0); push(0, id); }
  while (heap.length) {
    const [c, id] = pop();
    if (c > (best.get(id) ?? Infinity)) continue;
    const [x, y] = tileAt(id);
    for (const n of [tileId(x + 1, y), tileId(x - 1, y), tileId(x, y + 1), tileId(x, y - 1)]) {
      if (!roadTile(w, n)) continue;
      const step = GRADE_COST[gradeOf(w, n)] * (slow[n] ?? 1) / (1 + 0.08 * (roadWidth(w, n) - 1)), nc = c + step;
      if (nc > budget || nc >= (best.get(n) ?? Infinity)) continue;
      best.set(n, nc); push(nc, n);
    }
  }
  return best;
}

/** The road tiles at a placed thing's door. */
export function doorTiles(s: GameState, r: RegionId, key: string) {
  const w = worldOf(s, r), p = w.pos[key], fp = footprintOf(s, key);
  return p && fp ? doorstep(p[0], p[1], fp).map(([x, y]) => tileId(x, y)) : [];
}
/** How long it takes to reach one of these doors from a travel map (Infinity when no road joins them). */
export const reachTime = (map: Map<number, number>, door: number[]) => Math.min(Infinity, ...door.map((id) => map.get(id) ?? Infinity));

/** Travel maps are kept until the roads, the traffic or the doors change. */
const cache = new WeakMap<RegionWorld, { sig: string; maps: Map<string, Map<number, number>> }>();
export function travelCached(w: RegionWorld, door: number[], budget: number, slow: Record<number, number>, slowSig: string) {
  const sig = `${revOf(w)}|${slowSig}`;
  let c = cache.get(w);
  if (!c || c.sig !== sig) { c = { sig, maps: new Map() }; cache.set(w, c); }
  const key = `${door.join(',')}@${budget.toFixed(2)}`;
  let m = c.maps.get(key);
  if (!m) { m = travelFrom(w, door, budget, slow); c.maps.set(key, m); }
  return m;
}
