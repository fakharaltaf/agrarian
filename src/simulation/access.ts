// Getting there by road: how long it takes from a building's door to each tile of road, by the road's
// grade (dirt, gravel, paved), its width, and the traffic on it. Town services reach homes by this travel,
// not as the crow flies: a school three streets away up a dirt track serves less than one down a paved avenue.
import type { GameState } from './types';
import type { RegionId } from './config';
import { doorstep, footprintOf, isRoad, MAP, revOf, tileAt, tileId, worldOf, type RegionWorld } from './world';

/** Time to cross one tile, by grade (0 the main road): dirt is slow, paved is quick. */
const GRADE_COST = [1, 1.8, 1.35, 1];
/** Cars a tile of road carries at ease, per tile of width, by grade. */
const GRADE_CAP = [40, 8, 14, 20];

export const roadTile = (w: RegionWorld, id: number) => id >= 0 && id < MAP.w * MAP.h && (w.roads[id] !== undefined || isRoad(Math.floor(id / MAP.w) + MAP.y0));
const gradeOf = (w: RegionWorld, id: number) => (w.roads[id] !== undefined ? w.roads[id] : 0);

/** How many tiles wide the road is here: the narrower of its runs across and along (a junction is as wide as its street). */
export function roadWidth(w: RegionWorld, id: number) {
  const [x, y] = tileAt(id), run = (dx: number, dy: number) => { let n = 1; for (let k = 1; k < 6 && roadTile(w, tileId(x + dx * k, y + dy * k)); k++) n++; for (let k = 1; k < 6 && roadTile(w, tileId(x - dx * k, y - dy * k)); k++) n++; return n; };
  return Math.max(1, Math.min(5, run(1, 0), run(0, 1)));
}

/** Who makes the traffic: each home by its families, offices by their desks, shops and malls by their custom. */
export interface TripSource { door: number[]; trips: number }
/** A parking complex: takes this share of the cars off the streets within its reach. */
export interface Parking { door: number[]; reach: number; share: number }

/** Load on each road tile from everyone's trips (spread over the streets near their door), less what car parks take off them, against what the road carries. Returns tiles that are slow: a multiplier above 1. */
export function trafficOf(w: RegionWorld, sources: TripSource[], parks: Parking[]) {
  const load = new Map<number, number>();
  for (const src of sources) {
    const near = spread(w, src.door, 5);
    if (!near.length) continue;
    for (const id of near) load.set(id, (load.get(id) ?? 0) + src.trips / near.length * 4);
  }
  for (const p of parks) for (const id of spread(w, p.door, p.reach)) { const l = load.get(id); if (l) load.set(id, l * (1 - p.share)); }
  const slow: Record<number, number> = {};
  for (const [id, l] of load) {
    const cap = GRADE_CAP[gradeOf(w, id)] * roadWidth(w, id), x = l / cap;
    if (x > 0.6) slow[id] = Math.round(Math.min(4, 1 + 2 * (x - 0.6)) * 100) / 100; // free-flowing up to 60% of what the road carries, then slower and slower
  }
  return slow;
}
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
