// Region chapter: today's other regions become neighbouring settlements. Compact state, no engine imports.
import type { GoodId, RegionId } from './config';
import type { GameState } from './types';
export type BorderCharter = 'open' | 'walls';
export type NeighbourId = Exclude<RegionId, 'heartland'>;
export const NEIGHBOUR_IDS: readonly NeighbourId[] = ['river', 'arid', 'coastal', 'tropics'];
export interface NeighbourDef { leader: string; icon: string; wants: GoodId; fears: BorderCharter; trust0: number }
/** Fixed leaders and comparative wants. `fears` is the border charter that cools them over time. */
export const NEIGHBOURS: Record<NeighbourId, NeighbourDef> = {
  river: { leader: 'Elder Maren', icon: '🌊', wants: 'flour', fears: 'walls', trust0: 55 },
  arid: { leader: 'Khan Tarek', icon: '🏜', wants: 'bread', fears: 'open', trust0: 35 },
  coastal: { leader: 'Harbourmaster Ines', icon: '⚓', wants: 'cheese', fears: 'walls', trust0: 50 },
  tropics: { leader: 'Queen Asha', icon: '🌴', wants: 'wheat', fears: 'open', trust0: 40 },
};
/** A neighbour's order: deliver this much of a good by caravan before the deadline for a bonus on top of the market price, and their trust. */
export interface NeighbourRequest { good: GoodId; qty: number; done: number; deadline: number; bonus: number }
export interface Neighbour { trust: number; route: { good: GoodId; qty: number } | null; note: string; treaty: boolean; delivered: number; giftDay: number; request?: NeighbourRequest | null }
/** Which way each neighbour lies: west and east along the main road, south down the river. A watchtower guards the side it stands on. */
export type RouteSide = 'west' | 'east' | 'south';
export const ROUTE_SIDE: Record<NeighbourId, RouteSide> = { arid: 'west', coastal: 'east', river: 'south', tropics: 'south' };
export const SIDE_NAME: Record<RouteSide, string> = { west: 'the west road', east: 'the east road', south: 'the river' };
export interface RaidCase { id: number; to: NeighbourId; good: GoodId; lost: number; opened: number; deadline: number }
export interface Demand { from: NeighbourId; amount: number; opened: number; deadline: number }
export interface RegionState {
  active: boolean; enteredAt: number; border: BorderCharter | null; lastDay: number;
  neighbours: Record<NeighbourId, Neighbour>;
  bandits: number; raid: RaidCase | null; raids: number; pursued: number; caravans: number;
  demand: Demand | null; demandDay: number; answered: 'paid' | 'refused' | null; defiantUntil: number;
  /** the day the next neighbour order comes in */ nextRequest?: number; /** orders filled and missed */ filled?: number; missed?: number;
}
export function createRegionState(): RegionState {
  const n = (id: NeighbourId): Neighbour => ({ trust: NEIGHBOURS[id].trust0, route: null, note: '', treaty: false, delivered: 0, giftDay: -99 });
  return { active: false, enteredAt: -1, border: null, lastDay: -1,
    neighbours: { river: n('river'), arid: n('arid'), coastal: n('coastal'), tropics: n('tropics') },
    bandits: .3, raid: null, raids: 0, pursued: 0, caravans: 0, demand: null, demandDay: -1, answered: null, defiantUntil: -1 };
}
export const regionOf = (s: GameState): RegionState => (s.stageState.region ??= createRegionState() as unknown as Record<string, unknown>) as unknown as RegionState;
export const regionActive = (s: GameState) => !!(s.stageState.region as unknown as RegionState | undefined)?.active;
export const isNeighbour = (r: string): r is NeighbourId => (NEIGHBOUR_IDS as readonly string[]).includes(r);
export const attitude = (trust: number) => trust >= 70 ? 'Friendly' : trust >= 45 ? 'Cordial' : trust >= 25 ? 'Wary' : 'Hostile';
/** A treaty waives this neighbour's tariff on your caravans. */
export const treatyWith = (s: GameState, to: RegionId) => regionActive(s) && isNeighbour(to) && regionOf(s).neighbours[to].treaty;
/** Trust follows real delivered value: +1 per $5k (inflation-adjusted) sold (double for the good they want), at most +2 per sale slice. */
export function creditCaravan(s: GameState, to: RegionId, good: GoodId, value: number, qty = 0) {
  if (!regionActive(s) || !isNeighbour(to) || value <= 0) return;
  const n = regionOf(s).neighbours[to];
  if (n.request && n.request.good === good && qty > 0) n.request.done = Math.min(n.request.qty, n.request.done + qty);
  n.delivered = Math.round((n.delivered + value) * 100) / 100;
  const gain = value / (5000 * s.macro.cpi) * (NEIGHBOURS[to].wants === good ? 2 : 1) * (regionOf(s).border === 'open' ? 1.5 : 1);
  n.trust = Math.min(100, n.trust + Math.min(2, gain));
}
/** Managers hold back tomorrow's caravan loads, so routes are not starved by hourly selling. */
export function caravanReserve(s: GameState, good: GoodId) {
  if (!regionActive(s)) return 0;
  return Math.min(s.regions.heartland.inventory[good], Object.values(regionOf(s).neighbours).reduce((n, x) => n + (x.route?.good === good ? x.route.qty : 0), 0));
}
