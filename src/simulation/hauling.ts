// Hauling: goods sold at the village market travel there by road. A sale loads the goods onto the farm's own
// vehicles; the money arrives when the vehicle reaches the market. Buyers who come to the farm (the village trader,
// the mill buyer, contracts) and the clearing crew's timber are paid on the spot.
import { GOODS, type GoodId, type RegionId } from './config';
import { log, post, round2 } from './core';
import { STAGE_IDS } from './stages/types'; // not './stages': that index pulls in every chapter and makes an import cycle
import type { Division, GameState } from './types';
import { MAP, ROAD_Y, footprintOf, hasAccess, isRoad, tileAt, tileId, worldOf } from './world';

/** Where the village market stands: on the main road, east of the farm's valley. */
export const MARKET_X = 36;
export const VEHICLES = {
  cart: { name: 'Dog cart', icon: '🐕', cap: 150, speed: 10, price: 0 },
  horse: { name: 'Horse cart', icon: '🐴', cap: 400, speed: 16, price: 2500 },
  truck: { name: 'Truck', icon: '🚚', cap: 2000, speed: 30, price: 0 }, // bought as machines on the Equipment page
} as const;
export type VehicleKind = keyof typeof VEHICLES;
/** Road grade speeds things up: gravel half as fast again, paved more than twice. */
const GRADE_SPEED = [1, 1, 1.5, 2.2];

export interface HaulItem { good: GoodId; qty: number; value: number; kind: 'sale' | 'contract'; memo: string; division: Division }
export interface Trip { vehicle: string; kind: VehicleKind; items: HaulItem[]; depart: number; arrive: number; back: number }
export interface HaulState { horses: number; pending: HaulItem[]; trips: Trip[] }

export const haulOf = (s: GameState): HaulState => (s.haul ??= { horses: 0, pending: [], trips: [] });
/** From Market Town on, the open market is down the road and goods must be carried there. */
export const usesCarts = (s: GameState, r: RegionId) => r === 'heartland' && !s.legacyProgression && STAGE_IDS.indexOf(s.stageId) >= STAGE_IDS.indexOf('market-town');

export function fleet(s: GameState): { id: string; kind: VehicleKind }[] {
  const out: { id: string; kind: VehicleKind }[] = [];
  for (const m of s.machines) if (m.region === 'heartland' && m.type === 'truck' && !m.broken) out.push({ id: `truck:${m.id}`, kind: 'truck' });
  for (let i = 0; i < haulOf(s).horses; i++) out.push({ id: `horse:${i}`, kind: 'horse' });
  out.push({ id: 'cart', kind: 'cart' });
  return out;
}

/** The route from the farm's store to the market: the yard's track to the main road, then east along it. Each step has a speed factor. */
const routes = new WeakMap<object, { sig: string; tiles: [number, number, number][] }>();
export function marketRoute(s: GameState): [number, number, number][] {
  const w = worldOf(s, 'heartland'), ids = Object.keys(w.roads);
  // carts load at a store that has a road (the farmhouse yard if none does)
  const store = s.buildings.find((b) => b.region === 'heartland' && (b.type === 'barn' || b.type === 'silo' || b.type === 'warehouse' || b.type === 'coldStore') && hasAccess(s, 'heartland', `b:${b.id}`));
  const key = store ? `b:${store.id}` : 'farmhouse', p = w.pos[key], fp = footprintOf(s, key);
  const sig = `${key}:${p}:${w.main}:${ids.length}:${ids.reduce((a, k) => a + ((Number(k) * 31) % 1000003) * w.roads[Number(k)], 0)}`;
  const hit = routes.get(w);
  if (hit && hit.sig === sig) return hit.tiles;
  const tiles: [number, number, number][] = [];
  if (p && fp) {
    // breadth-first over road tiles from the store's doorstep to the main road
    const starts: [number, number][] = [];
    for (let i = 0; i < fp.w; i++) starts.push([p[0] + i, p[1] - 1], [p[0] + i, p[1] + fp.d]);
    for (let j = 0; j < fp.d; j++) starts.push([p[0] - 1, p[1] + j], [p[0] + fp.w, p[1] + j]);
    const prev = new Map<number, number>(), q: number[] = [];
    let end = -1;
    for (const [x, y] of starts) { if (isRoad(y)) { end = tileId(x, y); prev.set(end, -1); break; } if (w.roads[tileId(x, y)]) { const id = tileId(x, y); prev.set(id, -1); q.push(id); } }
    for (let h = 0; h < q.length && end < 0; h++) {
      const [x, y] = tileAt(q[h]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nid = tileId(nx, ny);
        if (prev.has(nid) || nx < MAP.x0 || ny < MAP.y0 || nx >= MAP.x0 + MAP.w || ny >= MAP.y0 + MAP.h) continue;
        if (isRoad(ny)) { prev.set(nid, q[h]); end = nid; break; }
        if (w.roads[nid]) { prev.set(nid, q[h]); q.push(nid); }
      }
    }
    if (end >= 0) {
      const back: [number, number, number][] = [];
      for (let c = end; c !== -1; c = prev.get(c)!) { const [x, y] = tileAt(c); back.push([x, y, isRoad(y) ? GRADE_SPEED[w.main] : GRADE_SPEED[w.roads[c] ?? 1]]); }
      tiles.push(...back.reverse());
      const [mx] = tiles[tiles.length - 1], dir = MARKET_X >= mx ? 1 : -1;
      for (let x = mx + dir; x !== MARKET_X + dir; x += dir) tiles.push([x, ROAD_Y + 1, GRADE_SPEED[w.main]]);
    }
  }
  // no road from the store to the main road: the market is cut off (tiles stays empty)
  routes.set(w, { sig, tiles });
  return tiles;
}
/** Hours one way to the market for a vehicle. */
export const oneWay = (s: GameState, kind: VehicleKind) => Math.max(1, Math.round(marketRoute(s).reduce((a, t) => a + 1 / (VEHICLES[kind].speed * t[2]), 0)));

/** A market sale: the goods leave the store now and wait for the next vehicle. */
export function queueSale(s: GameState, item: HaulItem) { haulOf(s).pending.push(item); }

/** Every hour: deliveries are paid, vehicles come home, and free vehicles set off with whatever is waiting. */
export function haulTick(s: GameState) {
  const H = haulOf(s);
  if (!H.trips.length && !H.pending.length) return;
  for (const t of H.trips) if (t.arrive === s.tick) for (const it of t.items) post(s, it.kind, it.value, it.memo, 'heartland', it.division);
  H.trips = H.trips.filter((t) => t.back > s.tick);
  const busy = new Set(H.trips.map((t) => t.vehicle));
  if (H.pending.length && !marketRoute(s).length) { // nothing can leave: say so once a day
    if (s.tick % 24 === 8) log(s, 'warning', 'No road leads from your store to the market, so goods wait at the gate. Draw a road (🛤) to the main road.', 'farm');
    return;
  }
  for (const v of fleet(s)) {
    if (!H.pending.length) break;
    if (busy.has(v.id)) continue;
    let room: number = VEHICLES[v.kind].cap;
    const items: HaulItem[] = [];
    while (room > 0.5 && H.pending.length) {
      const it = H.pending[0];
      if (it.qty <= room) { items.push(it); room -= it.qty; H.pending.shift(); continue; }
      const share = room / it.qty;
      items.push({ ...it, qty: room, value: round2(it.value * share) });
      it.qty -= room; it.value = round2(it.value * (1 - share)); room = 0;
    }
    const hours = oneWay(s, v.kind);
    if (v.kind === 'truck') post(s, 'fuel', -round2(items.reduce((a, x) => a + x.qty, 0) * 0.015 * (s.markets.heartland.fuel?.price ?? 1)), 'Truck fuel to market', 'heartland');
    H.trips.push({ vehicle: v.id, kind: v.kind, items, depart: s.tick, arrive: s.tick + hours, back: s.tick + hours * 2 });
  }
}
/** Daily upkeep: horses eat. */
export function haulDaily(s: GameState) {
  const H = haulOf(s);
  if (H.horses) post(s, 'maintenance', -round2(H.horses * 12 * s.macro.cpi), `Feed for ${H.horses} cart horse${H.horses === 1 ? '' : 's'}`, 'heartland');
}
/** True when goods are waiting but no road leads from the farm's store to the market. */
export const marketCut = (s: GameState) => haulOf(s).pending.length > 0 && !marketRoute(s).length;
export const onTheWay = (s: GameState) => {
  const H = haulOf(s);
  return { waiting: H.pending.reduce((a, x) => a + x.value, 0), waitingQty: H.pending.reduce((a, x) => a + x.qty, 0), moving: H.trips.filter((t) => t.arrive > s.tick).reduce((a, t) => a + t.items.reduce((b, x) => b + x.value, 0), 0), next: Math.min(...H.trips.filter((t) => t.arrive > s.tick).map((t) => t.arrive - s.tick)) };
};
/** Hours until everything waiting would be at the market with the current fleet. */
export function backlogHours(s: GameState) {
  const H = haulOf(s), qty = H.pending.reduce((a, x) => a + x.qty, 0);
  if (!qty) return 0;
  const perHour = fleet(s).reduce((a, v) => a + VEHICLES[v.kind].cap / (oneWay(s, v.kind) * 2), 0);
  return qty / Math.max(1e-6, perHour);
}
export const goodName = (g: GoodId) => GOODS[g].name;
