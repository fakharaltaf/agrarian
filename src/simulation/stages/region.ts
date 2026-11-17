import type { StageModule } from './types';
import type { Action, ActionResult, GameState } from '../types';
import { GOOD_IDS, GOODS, REGIONS, type GoodId } from '../config';
import { clamp, log, nextId, post, priceUsd, random, reservedStock, round2 } from '../core';
import { addGoods } from '../agriculture';
import { shipGoods } from '../logistics';
import { cityActive, cityOf } from '../city-state';
import { levelOf, serviceJobs, townOf } from '../town-state';
import { ROAD_H, ROAD_Y, riverX, worldOf } from '../world';
import type { ServiceType } from '../types';
import { larderReserve } from './settlement';
import { nationActive, nationOf } from '../nation-state';
import { closedTo, pathGuard } from './nation';
import { lifetimeSales } from './shared';
import { createRegionState, isNeighbour, NEIGHBOUR_IDS, NEIGHBOURS, regionActive, regionOf, ROUTE_SIDE, type BorderCharter, type NeighbourId, type NeighbourRequest, type RouteSide } from '../region-state';

export const canStartRegion = (s: GameState) => cityActive(s) && cityOf(s).threatAt >= 0 && !regionActive(s);
export const borderChangeCost = (s: GameState) => round2(30000 * s.macro.cpi);
export const giftValue = (s: GameState) => round2(10000 * s.macro.cpi);
export const treatyCost = (s: GameState) => round2(25000 * s.macro.cpi);
export const pursuitCost = (s: GameState) => round2(8000 * s.macro.cpi);
export const tributeAmount = (s: GameState) => round2(100000 * s.macro.cpi);
export const TREATY_TRUST = 60;
const day = (s: GameState) => Math.floor(s.tick / 24);
const spendable = (s: GameState, g: GoodId) => Math.max(0, s.regions.heartland.inventory[g] - reservedStock(s, 'heartland', g) - larderReserve(s, g));

const staffedShare = (s: GameState, b: { type: ServiceType; staffed: number; count: number }) => b.staffed / Math.max(1, serviceJobs(s, b.type) * b.count);
/** Staffed, funded watchtowers (fractional when short of staff), each counted by its level. */
export function staffedTowers(s: GameState) {
  return townOf(s).services.filter(b => b.type === 'watchtower' && b.active && b.funded).reduce((n, b) => n + b.count * staffedShare(s, b) * levelOf(b), 0);
}
/** The sides of the farm a watchtower watches over: the main road to the west or east of the farmhouse, or the river below it. */
export function towerSides(s: GameState, b: { id: number }): RouteSide[] {
  const w = worldOf(s, 'heartland'), p = w.pos[`svc:${b.id}`], home = w.pos.farmhouse ?? [0, ROAD_Y];
  if (!p) return [];
  const x = p[0] + 1.5, y = p[1] + 1.5, out: RouteSide[] = [];
  if (Math.abs(y - (ROAD_Y + ROAD_H / 2)) <= TOWER_REACH) out.push(x < home[0] ? 'west' : 'east');
  if (y > ROAD_Y + ROAD_H && Math.abs(x - (riverX('heartland', Math.floor(y)) + 1)) <= TOWER_REACH) out.push('south');
  return out;
}
/** How near a road or the river a watchtower must stand to watch it. */
export const TOWER_REACH = 10;
/** Watchtowers on one side, staffed share × level. */
export function towersOn(s: GameState, side: RouteSide) {
  return townOf(s).services.filter(b => b.type === 'watchtower' && b.active && b.funded && towerSides(s, b).includes(side)).reduce((n, b) => n + b.count * staffedShare(s, b) * levelOf(b), 0);
}
/** Militia halls ride out with every caravan: escort strength from staffed halls by level, up to 0.35. */
export const MILITIA_ESCORT = [.1, .18, .25];
export function militiaEscort(s: GameState) {
  return Math.min(.35, townOf(s).services.filter(b => b.type === 'militia' && b.active && b.funded).reduce((n, b) => n + b.count * staffedShare(s, b) * MILITIA_ESCORT[levelOf(b) - 1], 0));
}
/** How well caravans to a neighbour are guarded: the city's police, the militia's escorts, your path, and watchtowers on that side (half again as strong behind walls). Without a neighbour: the average over your routes. */
export function protection(s: GameState, to?: NeighbourId): number {
  if (!to) { const ids = NEIGHBOUR_IDS.filter(id => regionOf(s).neighbours[id].route), list = ids.length ? ids : NEIGHBOUR_IDS; return list.reduce((n, id) => n + protection(s, id), 0) / list.length; }
  const towers = Math.min(.6, towersOn(s, ROUTE_SIDE[to]) * .25 * (regionOf(s).border === 'walls' ? 1.5 : 1));
  return clamp(.35 * (cityActive(s) ? cityOf(s).police : 0) + militiaEscort(s) + towers + pathGuard(s), 0, .9);
}
/** Daily chance that a caravan on the road to this neighbour is raided. */
export function raidRisk(s: GameState, to?: NeighbourId) {
  const v = regionOf(s);
  return clamp((.04 + .12 * v.bandits) * (1 - protection(s, to)) * (v.border === 'walls' ? .7 : 1) * (s.tick < v.defiantUntil ? 1.5 : 1), 0, .6);
}
/** A neighbour's order: the good they want (or one you trade), about $25k of it, inside 15 days, for 30% on top. */
export const REQUEST_DAYS = 15, REQUEST_BONUS = .3;
function newRequest(s: GameState, id: NeighbourId): NeighbourRequest | null {
  const want = NEIGHBOURS[id].wants, held = GOOD_IDS.filter(g => GOODS[g].kind !== 'input' && s.markets[id][g] && s.regions.heartland.inventory[g] >= 1);
  const good = random(s) < .5 || !held.length ? want : held[Math.floor(random(s) * held.length)];
  if (!s.markets[id][good]) return null;
  const price = Math.max(.01, priceUsd(s, id, good)), qty = Math.max(50, Math.round(25000 * s.macro.cpi / price / 50) * 50);
  return { good, qty, done: 0, deadline: s.tick + REQUEST_DAYS * 24, bonus: round2(qty * price * REQUEST_BONUS) };
}
function requestsDaily(s: GameState) {
  const v = regionOf(s), today = day(s);
  for (const id of NEIGHBOUR_IDS) {
    const n = v.neighbours[id], r = n.request, who = NEIGHBOURS[id];
    if (!r) continue;
    if (r.done >= r.qty) {
      post(s, 'contract', r.bonus, `${who.leader}'s order filled: ${GOODS[r.good].name}`, 'heartland', 'trading');
      n.trust = Math.min(100, n.trust + 10); n.request = null; v.filled = (v.filled ?? 0) + 1;
      log(s, 'opportunity', `${who.leader} is delighted: ${num0(r.qty)} ${GOODS[r.good].name.toLowerCase()} delivered. +$${Math.round(r.bonus).toLocaleString()} bonus and +10 trust.`, 'region');
    } else if (s.tick >= r.deadline) {
      n.trust = Math.max(0, n.trust - 6); n.request = null; v.missed = (v.missed ?? 0) + 1;
      log(s, 'warning', `${who.leader}'s order ran out: ${num0(r.done)} of ${num0(r.qty)} ${GOODS[r.good].name.toLowerCase()} arrived. −6 trust.`, 'region');
    }
  }
  if (today < (v.nextRequest ?? Math.floor(v.enteredAt / 24) + 7)) return;
  const free = NEIGHBOUR_IDS.filter(id => !v.neighbours[id].request);
  v.nextRequest = today + 10 + Math.floor(random(s) * 8);
  if (!free.length) return;
  const id = free[Math.floor(random(s) * free.length)], r = newRequest(s, id);
  if (!r) return;
  v.neighbours[id].request = r;
  log(s, 'opportunity', `${NEIGHBOURS[id].leader} of ${REGIONS[id].name} asks for ${num0(r.qty)} ${GOODS[r.good].name.toLowerCase()} within ${REQUEST_DAYS} days: +$${Math.round(r.bonus).toLocaleString()} on top of the market price. Send it by caravan.`, 'region');
}
const num0 = (n: number) => Math.round(n).toLocaleString();
export const tollIncome = (s: GameState) => regionOf(s).border === 'walls' ? round2(400 * s.macro.cpi * staffedTowers(s)) : 0;

function resolveRaid(s: GameState, answer: 'pursue' | 'absorb'): ActionResult {
  const v = regionOf(s), raid = v.raid;
  if (!raid) return { ok: false, error: 'There is no open raid.' };
  if (answer === 'pursue') {
    const cost = pursuitCost(s);
    if (s.cash < cost) return { ok: false, error: `A pursuit costs $${cost.toLocaleString()}.` };
    post(s, 'civic', -cost, 'Raid pursuit', 'heartland', 'corporate');
    const back = Math.floor(raid.lost * clamp(.3 + .7 * protection(s, raid.to), 0, 1));
    if (back > 0) addGoods(s, 'heartland', raid.good, back);
    v.bandits = Math.max(.1, v.bandits - .15); v.pursued++;
    log(s, 'info', `Your patrol recovered ${back} of ${raid.lost} ${GOODS[raid.good].name.toLowerCase()}.`, 'region');
  } else v.bandits = Math.min(1, v.bandits + .1);
  v.raid = null;
  return { ok: true };
}
function answerDemand(s: GameState, answer: 'pay' | 'refuse'): ActionResult {
  const v = regionOf(s), d = v.demand;
  if (!d) return { ok: false, error: 'No neighbour is making demands.' };
  const n = v.neighbours[d.from];
  if (answer === 'pay') {
    if (s.cash < d.amount) return { ok: false, error: 'You cannot afford the tribute.' };
    post(s, 'diplomacy', -d.amount, `Tribute to ${NEIGHBOURS[d.from].leader}`);
    n.trust = Math.min(100, n.trust + 25); v.answered = 'paid';
  } else { n.trust = Math.max(0, n.trust - 20); v.answered = 'refused'; v.defiantUntil = s.tick + 60 * 24; }
  v.demand = null;
  log(s, 'opportunity', 'Your answer will shape how the region sees you. A future Nation chapter will build on it.', 'region');
  return { ok: true };
}

export function regionDaily(s: GameState) {
  if (!regionActive(s) || s.tick % 24 !== 0) return;
  const v = regionOf(s), today = day(s);
  if (v.lastDay === today) return;
  v.lastDay = today;
  const walls = v.border === 'walls', towers = staffedTowers(s);
  for (const id of NEIGHBOUR_IDS) {
    const n = v.neighbours[id], base = NEIGHBOURS[id].trust0 - (NEIGHBOURS[id].fears === v.border ? 15 : 0);
    n.trust = clamp(n.trust + (base - n.trust) * .01 - (walls ? .05 * towers : 0), 0, 100);
    if (n.treaty && n.trust < TREATY_TRUST - 20) { n.treaty = false; log(s, 'warning', `${NEIGHBOURS[id].leader} has torn up your trade treaty. Rebuild trust to sign again.`, 'region'); }
  }
  const toll = tollIncome(s);
  if (toll > 0) post(s, 'tolls', toll, 'Border tolls', 'heartland', 'corporate');
  // Raids hit caravans still on the road; the loss is real goods.
  // One bandit band: at most one caravan on the road is hit per day.
  const road = s.shipments.filter(sh => sh.caravan && s.tick < sh.arrives), pick = road.length ? road[Math.floor(random(s) * road.length)] : undefined;
  const sh = pick && random(s) < raidRisk(s, isNeighbour(pick.to) ? pick.to : undefined) ? pick : undefined;
  if (sh && Math.floor(sh.qty * .3) >= 1) {
    const lost = Math.floor(sh.qty * .3);
    sh.qty -= lost; v.raids++; v.bandits = Math.min(1, v.bandits + .02);
    const to = sh.to as NeighbourId;
    log(s, 'warning', `Bandits raided your caravan to ${REGIONS[to].name}: ${lost} ${GOODS[sh.good].name.toLowerCase()} lost.`, 'region');
    if (!v.raid) v.raid = { id: nextId(s), to, good: sh.good, lost, opened: s.tick, deadline: s.tick + 3 * 24 };
  }
  requestsDaily(s);
  if (v.raid && s.tick >= v.raid.deadline) {
    const r = resolveRaid(s, 'pursue');
    if (!r.ok) resolveRaid(s, 'absorb');
  }
  v.bandits = Math.max(.1, v.bandits - .002);
  // Today's caravans leave at dawn and are batched per route.
  for (const id of NEIGHBOUR_IDS) {
    const n = v.neighbours[id];
    if (!n.route) continue;
    if (nationActive(s) && nationOf(s).campaign?.target === id) { n.note = 'Halted: your army is at war here'; continue; }
    if (closedTo(s, id)) { n.note = 'Halted: sanction or embargo'; continue; }
    const qty = Math.floor(Math.min(n.route.qty, spendable(s, n.route.good)));
    n.note = qty < 1 ? 'No spare stock today' : shipGoods(s, n.route.good, qty, 'heartland', id, s.cash - s.automation.policies.cashReserve, true, true, true) ?? '';
    if (qty >= 1 && !n.note) v.caravans++;
  }
  if (!v.demand && !v.answered && (v.raids > 0 || v.caravans >= 1) && today - Math.floor(v.enteredAt / 24) >= 60) {
    const from = [...NEIGHBOUR_IDS].sort((a, b) => v.neighbours[a].trust - v.neighbours[b].trust)[0];
    v.demand = { from, amount: tributeAmount(s), opened: s.tick, deadline: s.tick + 14 * 24 };
    log(s, 'warning', `${NEIGHBOURS[from].leader} of ${REGIONS[from].name} demands tribute. Pay, or refuse and expect more raids.`, 'region');
  }
  if (v.demand && s.tick >= v.demand.deadline) answerDemand(s, 'refuse');
}

function action(s: GameState, a: Action): ActionResult | null {
  const types = ['startRegion', 'setBorder', 'setRoute', 'giftNeighbour', 'signTreaty', 'resolveRaid', 'answerDemand'];
  if (!types.includes(a.type)) return null;
  const v = regionOf(s), fail = (error: string): ActionResult => ({ ok: false, error });
  if (a.type === 'startRegion') {
    if (a.border !== 'open' && a.border !== 'walls') return fail('Choose open borders or walls & tolls.');
    if (!canStartRegion(s)) return fail('Keep your city safe until neighbouring caravans arrive.');
    v.active = true; v.enteredAt = s.tick; v.border = a.border; s.stageId = 'region'; s.eraReady = false;
    s.values.orderFreedom = clamp(s.values.orderFreedom + (a.border === 'walls' ? 6 : -6), 0, 100);
    log(s, 'opportunity', 'Your neighbours are watching. Send a caravan of something they want to earn their trust.', 'region');
    return { ok: true };
  }
  if (!v.active) return fail('Begin the Region chapter first.');
  if (a.type === 'setBorder') {
    if (a.border !== 'open' && a.border !== 'walls') return fail('Choose open borders or walls & tolls.');
    if (a.border === v.border) return fail('That is already your border policy.');
    const cost = borderChangeCost(s);
    if (s.cash < cost) return fail(`The border works cost $${cost.toLocaleString()}.`);
    post(s, 'civic', -cost, 'Border works', 'heartland', 'corporate');
    v.border = a.border; return { ok: true };
  }
  if (a.type === 'resolveRaid') return a.answer === 'pursue' || a.answer === 'absorb' ? resolveRaid(s, a.answer) : fail('Pursue or absorb the loss.');
  if (a.type === 'answerDemand') return a.answer === 'pay' || a.answer === 'refuse' ? answerDemand(s, a.answer) : fail('Pay or refuse.');
  if (a.type !== 'setRoute' && a.type !== 'giftNeighbour' && a.type !== 'signTreaty') return null;
  if (!isNeighbour(a.to)) return fail('Choose a neighbour.');
  const n = v.neighbours[a.to], who = NEIGHBOURS[a.to];
  if (a.type === 'setRoute') {
    if (a.good === null) { n.route = null; n.note = ''; return { ok: true }; }
    if (!GOOD_IDS.includes(a.good) || !s.markets[a.to][a.good] || GOODS[a.good].kind === 'input') return fail(`${REGIONS[a.to].name} does not trade that.`);
    if (!Number.isFinite(a.qty) || a.qty < 1) return fail('Send at least one unit a day.');
    n.route = { good: a.good, qty: Math.floor(a.qty) }; return { ok: true };
  }
  if (a.type === 'giftNeighbour') {
    if (day(s) - n.giftDay < 7) return fail(`${who.leader} received a gift this week.`);
    const value = giftValue(s);
    if (a.kind === 'goods') {
      const qty = Math.ceil(value / Math.max(.01, priceUsd(s, 'heartland', who.wants)));
      if (spendable(s, who.wants) < qty) return fail(`You need ${qty} spare ${GOODS[who.wants].name.toLowerCase()}.`);
      s.regions.heartland.inventory[who.wants] -= qty; n.trust = Math.min(100, n.trust + 8);
    } else {
      if (s.cash < value) return fail('Not enough cash.');
      post(s, 'diplomacy', -value, `Gift to ${who.leader}`); n.trust = Math.min(100, n.trust + 5);
    }
    n.giftDay = day(s); return { ok: true };
  }
  if (a.type === 'signTreaty') {
    if (n.treaty) return fail('You already have a treaty.');
    if (n.trust < TREATY_TRUST) return fail(`${who.leader} needs trust ${TREATY_TRUST} first.`);
    const cost = treatyCost(s);
    if (s.cash < cost) return fail('Not enough cash.');
    post(s, 'diplomacy', -cost, `Trade treaty with ${REGIONS[a.to].name}`); n.treaty = true; return { ok: true };
  }
  return null;
}

export const region: StageModule = {
  id: 'region', title: 'Region', legacyEras: [6],
  eraUnlocks: { 6: (s) => lifetimeSales(s) >= 12_000_000 },
  actionTypes: ['unlockRegion', 'buyParcel', 'ship', 'startRegion', 'setBorder', 'setRoute', 'giftNeighbour', 'signTreaty', 'resolveRaid', 'answerDemand'],
  tips: ['era6', 'analytics', 'region-route', 'region-defence'], discoveries: ['regionReady', 'regionRaid', 'regionDemand'],
  tick: regionDaily, handleAction: action, createState: () => createRegionState() as unknown as Record<string, unknown>,
};
export type { BorderCharter };
