import {releaseNeighbourJob} from '../employment';
import type { StageModule } from './types';
import type { Action, ActionResult, GameState } from '../types';
import { CHAPTER_SALES, BUILDINGS, GOODS, type GoodId } from '../config';
import { clamp, freeSpace, log, nextId, pick, post, reservedStock, round2 } from '../core';
import { localEmployment } from '../town-state';
import { executeBuy, quoteBuy } from '../markets';
import { communityOf, createSettlementState, HOME_DEFS, homePrice, homeCapacity, households, population, residentWorkers, availableResidents, recruitableResidents, workingAdults } from '../community-state';

export const COMMUNITY_FOOD: GoodId[] = ['bread', 'wheat', 'corn', 'rice', 'potatoes', 'apples', 'grapes', 'milk', 'eggs', 'meat', 'cheese', 'flour'];
/** Happiness ingredients (food, homes, warmth, jobs), each 0..1. */
export function wellbeing(s: GameState) {
  const c = communityOf(s), people = population(s);
  return { fed: c.fed, housed: people ? Math.min(1, homeCapacity(s) / people) : 1, warm: c.warm, jobs: people ? Math.min(1, localEmployment(s) / Math.max(1, households(s))) : 1 };
}
/** Families that move in on a good day, before the free-homes limit. */
export const dailyArrivals = (s: GameState) => Math.max(1, Math.floor(households(s) * 0.015));
export function canStartSettlement(s: GameState) {
  return !communityOf(s).active && (s.legacyProgression ? s.era >= 4 : s.stageId === 'industry')
    && (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0) >= CHAPTER_SALES.industry
    && s.workers.filter(w => w.role === 'hand').length >= 2
    && (s.machines.some(m => m.type !== 'truck') || s.buildings.some(b => BUILDINGS[b.type].category === 'processing'));
}
const available = (s: GameState, g: GoodId) => Math.max(0, s.regions.heartland.inventory[g] - reservedStock(s, 'heartland', g));
/** Policy allocation is updated by the engine, never by UI reads. */
export function prepareLarder(s: GameState) {
  const c = communityOf(s);
  if (!c.active || !c.autoLarder) return;
  let need = population(s) * 2000 * 3;
  const hold: Partial<Record<GoodId, number>> = {};
  for (const g of COMMUNITY_FOOD) {
    if (need <= 1e-6) break;
    const take = Math.min(available(s, g), need / GOODS[g].kcal);
    if (take > 0) hold[g] = take;
    need -= take * GOODS[g].kcal;
  }
  c.larderHold = hold;
}
export function larderReserve(s: GameState, good: GoodId) {
  const c = communityOf(s);
  return c.active && c.autoLarder ? Math.max(0, Math.min(c.larderHold[good] ?? 0, s.regions.heartland.inventory[good])) : 0;
}
export function foodDays(s: GameState) {
  const kcal = COMMUNITY_FOOD.reduce((n, g) => n + available(s, g) * GOODS[g].kcal, 0);
  return population(s) ? kcal / (population(s) * 2000) : 0;
}
function buyWithinCash(s: GameState, g: GoodId, desired: number) {
  let lo = 0, hi = Math.floor(Math.min(desired, freeSpace(s, 'heartland', g)));
  for (let i = 0; i < 28 && hi > lo; i++) {
    const mid = Math.ceil((lo + hi) / 2), q = quoteBuy(s, 'heartland', g, mid);
    if (q.net <= Math.max(0, s.cash)) lo = mid; else hi = mid - 1;
  }
  if (lo > 0) executeBuy(s, 'heartland', g, lo, 'Community larder', 'corporate');
}
function eat(s: GameState, desired: number) {
  let need = desired;
  for (const g of COMMUNITY_FOOD) {
    const take = Math.min(available(s, g), need / GOODS[g].kcal);
    s.regions.heartland.inventory[g] -= take;
    need -= take * GOODS[g].kcal;
    if (need <= 1e-6) break;
  }
  return desired > 0 ? clamp(1 - need / desired, 0, 1) : 1;
}
function addFamily(s: GameState) {
  const c = communityOf(s), named = c.cohorts.filter(x => x.households === 1 && !x.name.startsWith('Newcomer')).length;
  if (named < 50) { const id = nextId(s); c.cohorts.push({ id, name: `${pick(s, ['Silva', 'Patel', 'Brook', 'Okafor', 'Tan', 'Reyes', 'Ito', 'Costa', 'Haddad', 'Varga'])} family #${id}`, households: 1, adults: 2, children: 2 }); }
  else {
    let group = c.cohorts.find(x => x.name === 'Newcomer families');
    if (!group) { group = { id: nextId(s), name: 'Newcomer families', households: 0, adults: 0, children: 0 }; c.cohorts.push(group); }
    group.households++;group.adults+=2;group.children+=2;
  }
}
export function settlementTick(s: GameState) {
  const c = communityOf(s), day = Math.floor(s.tick / 24);
  if (!c.active || s.tick % 24 !== 0 || c.lastDay === day) return;
  c.lastDay = day;
  const people = population(s);
  if (c.autoLarder && people) buyWithinCash(s, 'wheat', Math.max(0, people * 2000 * 4 - foodDays(s) * people * 2000) / GOODS.wheat.kcal);
  c.fed = eat(s, people * 2000);
  s.stats.peopleFed += people * c.fed / 365;
  const fuelNeed = s.regions.heartland.temp < 10 ? people * 0.02 : 0;
  if (c.autoLarder && fuelNeed > s.regions.heartland.inventory.fuel) buyWithinCash(s, 'fuel', Math.ceil(fuelNeed - s.regions.heartland.inventory.fuel));
  const fuel = Math.min(fuelNeed, s.regions.heartland.inventory.fuel);
  s.regions.heartland.inventory.fuel -= fuel;
  c.warm = fuelNeed ? fuel / fuelNeed : 1;
  const { housed, jobs } = wellbeing(s);
  const target = clamp(0.45 * c.fed + 0.2 * housed + 0.15 * c.warm + 0.2 * jobs + (c.charter === 'free' ? 0.04 : -0.04), 0, 1);
  c.happiness += (target - c.happiness) * 0.2;
  if (c.homes.length) post(s, 'maintenance', -c.homes.reduce((n, h) => n + HOME_DEFS[h.tier].families * h.count * 0.5, 0) * s.macro.cpi, 'Community homes', 'heartland', 'corporate');
  if (c.charter === 'company') {
    const rent = Math.floor(Math.min(c.householdCash, people * 2 * s.macro.cpi) * 100) / 100;
    if (rent > 0) { c.householdCash = Math.max(0, round2(c.householdCash - rent)); post(s, 'rent', rent, 'Resident housing rent', 'heartland', 'corporate'); }
  }
  if (c.happiness >= 0.65 && homeCapacity(s) - people >= 4) {
    const arrivals = Math.min(Math.floor((homeCapacity(s) - people) / 4), dailyArrivals(s));
    for (let i = 0; i < arrivals; i++) addFamily(s);
    if (!people) log(s, 'opportunity', 'The first family has arrived. Keep the larder stocked.', 'community');
  }
  c.hardshipDays = c.happiness < 0.35 ? c.hardshipDays + 1 : 0;
  if (c.hardshipDays >= 3 && c.cohorts.length) {
    const old = households(s), group = c.cohorts[c.cohorts.length - 1];
    group.households--;group.adults=Math.max(0,group.adults-2);group.children=Math.max(0,group.children-2); if (!group.households) c.cohorts.pop();
    c.householdCash = round2(c.householdCash * Math.max(0, (old - 1) / old));
    while (residentWorkers(s) > workingAdults(s)) {
      const w = [...s.workers].reverse().find(x => x.resident && x.region === 'heartland')!;
      s.workers.splice(s.workers.indexOf(w), 1);
      for (const m of s.machines) if (m.driver === w.id) m.driver = null;
    }
    log(s, 'warning', 'A family left after prolonged hardship. Check food, warmth and jobs.', 'community');
  }
}
function action(s: GameState, a: Action): ActionResult | null {
  const c = communityOf(s), fail = (error: string): ActionResult => ({ ok: false, error });
  if (a.type === 'startSettlement') {
    if (!canStartSettlement(s)) return fail(`Mechanise or process your harvest, employ two hands and reach $${CHAPTER_SALES.industry.toLocaleString()} in sales first.`);
    c.active = true; c.charter = a.charter; c.enteredAt = s.tick;
    s.stageId = 'settlement'; if (!s.legacyProgression) s.era = 5;
    s.eraReady = false;
    s.values.prosperityFairness = clamp(s.values.prosperityFairness + (a.charter === 'free' ? 8 : -8), 0, 100);
    s.values.orderFreedom = clamp(s.values.orderFreedom + (a.charter === 'free' ? 8 : -8), 0, 100);
    log(s, 'opportunity', 'Your workers can bring their families. Build their first home.', 'community');
    return { ok: true };
  }
  if (a.type !== 'buildHomes' && a.type !== 'setLarder' && a.type !== 'settleWorker') return null;
  if (!c.active) return fail('Begin the Settlement chapter first.');
  if (a.type === 'settleWorker') {
    const w=s.workers.find(w=>w.id===a.workerId&&w.region==='heartland');
    if(!w||w.resident)return fail('Choose a commuting Heartland worker.');
    if(recruitableResidents(s,w.wageFactor)<1)return fail('Make room for another working adult or offer 1.1× pay to attract an employed neighbour.');
    const cost=round2(150*s.macro.cpi);if(s.cash<cost)return fail('The company cannot afford relocation.');
    if(availableResidents(s)<1&&!releaseNeighbourJob(s))return fail('No employed resident can move into this job.');
    post(s,'training',-cost,'Resident staff relocation','heartland','corporate');w.resident=true;return {ok:true};
  }
  if (a.type === 'setLarder') { c.autoLarder = a.enabled; prepareLarder(s); return { ok: true }; }
  if (!HOME_DEFS[a.tier] || !Number.isInteger(a.count) || a.count < 1 || a.count > 50) return fail('Choose 1–50 homes.');
  if (a.tier === 'terrace' && population(s) < 40) return fail('Terraces become useful at 40 residents.');
  if (a.tier === 'apartment' && population(s) < 200) return fail('Apartments arrive at 200 residents.');
  const cost = homePrice(s, a.tier);
  if (cost * a.count > s.cash) return fail('Not enough cash for these homes.');
  post(s, 'building', -cost * a.count, `${a.count} community ${a.tier} homes`, 'heartland', 'corporate');
  const group = c.homes.find(h => h.tier === a.tier);
  if (group) { group.count += a.count; group.cost += cost * a.count; }
  else c.homes.push({ id: nextId(s), tier: a.tier, count: a.count, cost: cost * a.count });
  return { ok: true };
}
export const settlement: StageModule = {
  id: 'settlement', title: 'Settlement', legacyEras: [], eraUnlocks: {},
  actionTypes: ['startSettlement', 'buildHomes', 'setLarder', 'settleWorker'], tips: [], discoveries: [],
  tick: settlementTick, handleAction: action, createState: () => createSettlementState() as unknown as Record<string, unknown>,
};
