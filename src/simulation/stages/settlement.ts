import { nuisanceHappiness, settlementExposure } from '../nuisance';
import { workingFactories } from './shared';
import { accessNote, canPlaceNew, doorstep, footprintOf, hasAccess, homeFootprint, linesOf, NET_TOP, placeNew, tileId, worldOf } from '../world';
import type { CommunityHome } from '../types';
import {releaseNeighbourJob} from '../employment';
import type { StageModule } from './types';
import type { Action, ActionResult, GameState } from '../types';
import { CHAPTER_SALES, BUILDINGS, GOODS, type GoodId, INDUSTRY_FACTORY_SALES } from '../config';
import { clamp, freeSpace, log, marketWage, nextId, post, reservedStock, round2 } from '../core';
import { factoryJobs, localEmployment, townOf } from '../town-state';
import { executeBuy, quoteBuy } from '../markets';
import { shopMood } from '../city-state';
import { homeUnits, homeLevel, homeUpgradePrice, APARTMENT_FAMILIES } from '../community-state';
import { JAM_TEXT, streetJammedAt, trafficRoom, APARTMENT_NEED, doorTiles, frontageAt, frontageOf, meets, needText } from '../access';
import { communityOf, createSettlementState, familySize, HOME_DEFS, homePrice, homeCapacity, households, population, availableResidents, recruitableResidents } from '../community-state';
import { CONFIG, WORK_HOURS } from '../config';

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
    && (s.legacyProgression ? s.machines.some(m => m.type !== 'truck') || s.buildings.some(b => BUILDINGS[b.type].category === 'processing')
      : workingFactories(s) >= 2 && (s.stats.factoryMade ?? 0) >= INDUSTRY_FACTORY_SALES); // Industry is about factories: a working chain and what it makes
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
/** What a day's food for everyone is worth, at the price of grain. */
export const foodBill = (s: GameState) => (population(s) * 2000 / GOODS.wheat.kcal) * (s.markets.heartland.wheat?.price ?? GOODS.wheat.basePrice);
/** The best line of each kind passing a home's door (0 none). */
export function doorLines(s: GameState, homeId: number) {
  const w = worldOf(s, 'heartland'), p = w.pos[`home:${homeId}`], fp = footprintOf(s, `home:${homeId}`);
  const door = p && fp ? doorstep(p[0], p[1], fp).map(([x, y]) => tileId(x, y)) : [];
  const best = (net: 'power' | 'water' | 'sewer') => Math.max(0, ...door.map((id) => linesOf(w, net)[id] ?? 0));
  return { power: best('power'), water: best('water'), sewer: best('sewer') };
}
/** What stands between an apartment building and its next level: each need, and whether it is met. */
export function homeUpgradeNeeds(s: GameState, h: CommunityHome) {
  const next = homeLevel(h) + 1, l = doorLines(s, h.id), city = !!(s.stageState.city as { active?: boolean } | undefined)?.active;
  if (h.tier !== 'apartment' || next > 3) return [];
  const street = APARTMENT_NEED[next - 1], road = { need: needText(street)[0].toUpperCase() + needText(street).slice(1), met: meets(frontageOf(worldOf(s, 'heartland'), doorTiles(s, 'heartland', `home:${h.id}`)), street) };
  const room = trafficRoom(s, 'heartland', `home:${h.id}`, next), flowing = { need: room.need, met: room.ok };
  return next === 2
    ? [road, flowing, { need: 'Your town is a City', met: city }, { need: 'A power line at the door', met: l.power >= 1 }, { need: 'A water pipe at the door', met: l.water >= 1 }]
    : [road, flowing, { need: '800 residents', met: population(s) >= 800 }, { need: 'Underground power cable at the door', met: l.power >= NET_TOP.power }, { need: 'Buried water main at the door', met: l.water >= NET_TOP.water }, { need: 'Underground sewer at the door', met: l.sewer >= NET_TOP.sewer }];
}
export function larderReserve(s: GameState, good: GoodId) {
  const c = communityOf(s);
  return c.active && c.autoLarder ? Math.max(0, Math.min(c.larderHold[good] ?? 0, s.regions.heartland.inventory[good])) : 0;
}
export function foodDays(s: GameState) {
  const kcal = COMMUNITY_FOOD.reduce((n, g) => n + available(s, g) * GOODS[g].kcal, 0);
  return population(s) ? kcal / (population(s) * 2000) : 0;
}
/** Buy up to `desired` with the cash on hand. Heating fuel burned the same day needs no room in the barns. */
function buyWithinCash(s: GameState, g: GoodId, desired: number, burnNow = false) {
  let lo = 0, hi = Math.floor(burnNow ? desired : Math.min(desired, freeSpace(s, 'heartland', g)));
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
const SURNAMES = ['Silva', 'Patel', 'Brook', 'Okafor', 'Tan', 'Reyes', 'Ito', 'Costa', 'Haddad', 'Varga'];
const isStaff = (g: { name: string }) => g.name.endsWith('(factory staff)');
export function settlementTick(s: GameState) {
  const c = communityOf(s), day = Math.floor(s.tick / 24);
  if (!c.active || s.tick % 24 !== 0 || c.lastDay === day) return;
  c.lastDay = day;
  const people = population(s);
  if (c.autoLarder && people) buyWithinCash(s, 'wheat', Math.max(0, people * 2000 * 4 - foodDays(s) * people * 2000) / GOODS.wheat.kcal);
  c.fed = eat(s, people * 2000);
  // Families pay for what they eat out of their savings (wages from the farm, its factories and neighbours), at the price of grain.
  // What they cannot pay, the farm carries: a settlement of a few hands' families costs you, a working town feeds itself.
  const bill = foodBill(s) * c.fed; c.foodPaid = round2(Math.min(bill, c.householdCash));
  if (c.foodPaid > 0) { c.householdCash = round2(c.householdCash - c.foodPaid); post(s, 'sale', c.foodPaid, 'Families paid for their food', 'heartland', 'corporate'); }
  s.stats.peopleFed += people * c.fed / 365;
  const fuelNeed = s.regions.heartland.temp < 10 ? people * 0.02 : 0;
  if (c.autoLarder && fuelNeed > s.regions.heartland.inventory.fuel) buyWithinCash(s, 'fuel', Math.ceil(fuelNeed - s.regions.heartland.inventory.fuel), true);
  const fuel = Math.min(fuelNeed, s.regions.heartland.inventory.fuel);
  s.regions.heartland.inventory.fuel -= fuel;
  c.warm = fuelNeed ? fuel / fuelNeed : 1;
  const { housed } = wellbeing(s);
  c.nuisance = settlementExposure(s); // smell and noise from the farm's buildings near the homes cost happiness; fresh bread lifts it
  const town = s.stageState.town as { active?: boolean; jammed?: number } | undefined;
  const target = clamp(0.55 * c.fed + 0.25 * housed + 0.2 * c.warm - nuisanceHappiness(c.nuisance) + shopMood(s) - (town?.active ? 0.12 * (town.jammed ?? 0) : 0) - 0.08 * (c.serviceFee ?? 0), 0, 1);
  c.happiness += (target - c.happiness) * 0.2;
  if (c.homes.length) post(s, 'maintenance', -c.homes.reduce((n, h) => n + homeUnits(h) * 0.5, 0) * s.macro.cpi, 'Community homes', 'heartland', 'corporate');
  // the housing tax: a share of the pay of every worker whose family lives here
  const fam = (c.families ??= {}), tax = c.housingTax ?? 0;
  if (tax > 0) {
    // a day's pay (after any pay cut); computed here rather than imported, to keep the chapter modules free of cycles
    const pay = s.workers.filter((w) => w.resident && fam[w.id] !== undefined).reduce((n, w) => n + (w.role === 'manager' ? CONFIG.managerWage * s.macro.cpi : marketWage(s, 'heartland')) * w.wageFactor * (1 - (c.payCut ?? 0)) * WORK_HOURS, 0);
    if (pay > 0) post(s, 'rent', round2(pay * tax), 'Settlement housing tax', 'heartland', 'corporate');
  }
  // a family leaves with its worker
  for (const [id, cohort] of Object.entries(fam)) if (!s.workers.some((w) => w.id === Number(id))) { c.cohorts = c.cohorts.filter((g) => g.id !== cohort); delete fam[Number(id)]; }
  // families of your employees move in while there are free homes (two a day)
  // a home nobody can reach by road takes no family
  const reachable = c.homes.filter((h) => hasAccess(s, 'heartland', `home:${h.id}`)).reduce((n, h) => n + homeUnits(h), 0);
  // every family takes a home; when homes are lost, newcomers leave first, then factory staff (your workers' families keep theirs)
  const workerFams = new Set(Object.values(fam));
  for (const staff of [false, true]) for (let over = households(s) - reachable, i = c.cohorts.length - 1; over > 0 && i >= 0; i--) if (!workerFams.has(c.cohorts[i].id) && isStaff(c.cohorts[i]) === staff) { over -= c.cohorts[i].households; c.cohorts.splice(i, 1); if (over <= 0) log(s, 'warning', `${staff ? 'Factory staff' : 'Newcomer'} families moved away: there are not enough homes for them.`, 'community'); }
  let free = reachable - households(s), moved = 0;
  for (const w of s.workers) {
    if (free <= 0 || moved >= 2) break;
    if (w.region !== 'heartland' || fam[w.id] !== undefined) continue;
    const id = nextId(s), size = familySize(w.id), surname = w.name.split(' ').slice(-1)[0];
    c.cohorts.push({ id, name: `The ${surname} family`, households: 1, adults: 2, children: size - 2 });
    fam[w.id] = id; w.resident = true; free--; moved++;
    log(s, 'opportunity', `${w.name}'s family has moved into the settlement (${size} people).`, 'community');
  }
  // employees first: then the families of your factory staff (two a day, one family per staff job)
  for (let need = factoryJobs(s) - c.cohorts.filter(isStaff).length; need > 0 && free > 0 && moved < 2; need--) {
    const id = nextId(s), size = 3 + (id % 3), name = SURNAMES[id % 10];
    c.cohorts.push({ id, name: `The ${name} family (factory staff)`, households: 1, adults: 2, children: size - 2 });
    free--; moved++;
    log(s, 'opportunity', `The ${name}s, who work at your factories, have moved into the settlement (${size} people).`, 'community');
  }
  // once there is a town and every employee has a home, families from outside settle too: one a day while homes are free and life is good
  if (townOf(s).active && free > 0 && moved === 0 && c.happiness >= 0.6) {
    const id = nextId(s), size = 3 + (id % 3), name = SURNAMES[id % 10];
    c.cohorts.push({ id, name: `The ${name} family (newcomers)`, households: 1, adults: 2, children: size - 2 });
    log(s, 'opportunity', `A new family, the ${name}s, has settled in town (${size} people).`, 'community');
  }
  // newcomers pay the housing tax on what they earn in town
  const newcomers = c.cohorts.filter((g) => !Object.values(fam).includes(g.id)).length;
  if (tax > 0 && newcomers) post(s, 'rent', round2(newcomers * marketWage(s, 'heartland') * WORK_HOURS * tax), 'Housing tax: newcomer families', 'heartland', 'corporate');
  c.hardshipDays = c.happiness < 0.35 ? c.hardshipDays + 1 : 0;
  if (c.hardshipDays >= 3) { // a family gives up and moves back; the worker stays on, unhappier
    const last = Object.entries(fam).pop();
    if (last) {
      const [wid, cohort] = last, w = s.workers.find((x) => x.id === Number(wid));
      c.cohorts = c.cohorts.filter((g) => g.id !== cohort); delete fam[Number(wid)];
      if (w) { w.resident = false; w.morale = clamp(w.morale - 0.2, 0, 1); }
      log(s, 'warning', 'A family moved away after days of hardship. Check food and warmth.', 'community');
    }
    c.hardshipDays = 0;
  }
}
function action(s: GameState, a: Action): ActionResult | null {
  const c = communityOf(s), fail = (error: string): ActionResult => ({ ok: false, error });
  if (a.type === 'startSettlement') {
    if (!canStartSettlement(s)) return fail(s.legacyProgression ? `Mechanise or process your harvest, employ two hands and reach $${CHAPTER_SALES.industry.toLocaleString()} in sales first.` : `Get two production houses working, make $${INDUSTRY_FACTORY_SALES.toLocaleString()} of factory goods, employ two hands and reach $${CHAPTER_SALES.industry.toLocaleString()} in sales first.`);
    c.active = true; c.charter = null; c.enteredAt = s.tick;
    s.stageId = 'settlement'; if (!s.legacyProgression) s.era = 5;
    s.eraReady = false;
    log(s, 'opportunity', 'Your hands miss their families. Zone some land as residential and build homes, and the families will move in.', 'community');
    return { ok: true };
  }
  if (a.type !== 'buildHomes' && a.type !== 'setLarder' && a.type !== 'settleWorker' && a.type !== 'setSettlementPay' && a.type !== 'upgradeHome') return null;
  if (a.type === 'upgradeHome') { // an apartment block grows upward on its own ground
    const fail0 = (error: string): ActionResult => ({ ok: false, error }), h = communityOf(s).homes.find((x) => x.id === a.homeId);
    if (!h || h.tier !== 'apartment') return fail0('Only apartments grow taller.');
    if (homeLevel(h) >= 3) return fail0('This is already a tower.');
    const street = APARTMENT_NEED[homeLevel(h)], f = frontageOf(worldOf(s, 'heartland'), doorTiles(s, 'heartland', `home:${h.id}`));
    if (!meets(f, street)) return fail0(`A ${homeLevel(h) === 1 ? 'mid-rise' : 'tower'} needs ${needText(street)}: widen or pave the street it stands on.`);
    const missing = homeUpgradeNeeds(s, h).find((n) => !n.met); if (missing) return fail0(`Needs: ${missing.need.toLowerCase()}.`);
    const cost = homeUpgradePrice(s, h); if (cost > s.cash) return fail0(`That costs $${cost.toLocaleString()}.`);
    post(s, 'building', -cost, homeLevel(h) === 1 ? 'Apartments to a mid-rise' : 'Mid-rise to a tower', 'heartland', 'corporate');
    h.level = homeLevel(h) + 1; h.cost += cost;
    return { ok: true, note: `${homeLevel(h) === 3 ? '🎉 A tower rises' : 'A mid-rise rises'}: room for ${APARTMENT_FAMILIES[homeLevel(h) - 1]} families.` };
  }
  if (!c.active) return fail('Begin the Settlement chapter first.');
  if (a.type === 'settleWorker') {
    const w=s.workers.find(w=>w.id===a.workerId&&w.region==='heartland');
    if(!w||w.resident)return fail('Choose a commuting Heartland worker.');
    if(recruitableResidents(s,w.wageFactor)<1)return fail('Make room for another working adult or offer 1.1× pay to attract an employed neighbour.');
    const cost=round2(150*s.macro.cpi);if(s.cash<cost)return fail('The company cannot afford relocation.');
    if(availableResidents(s)<1&&!releaseNeighbourJob(s))return fail('No employed resident can move into this job.');
    post(s,'training',-cost,'Resident staff relocation','heartland','corporate');w.resident=true;return {ok:true};
  }
  if (a.type === 'setSettlementPay') {
    const ok = (v: number | undefined) => v === undefined || [0, 0.05, 0.1, 0.15, 0.2].includes(v);
    if (!ok(a.payCut) || !ok(a.housingTax)) return fail('Choose 0% to 20% in steps of 5.');
    if (a.serviceFee !== undefined && ![0, 0.25, 0.5, 0.75, 1].includes(a.serviceFee)) return fail('Choose none, a quarter, half, three quarters or the full cost.');
    if (a.payCut !== undefined) c.payCut = a.payCut;
    if (a.housingTax !== undefined) c.housingTax = a.housingTax;
    if (a.serviceFee !== undefined) c.serviceFee = a.serviceFee;
    return { ok: true };
  }
  if (a.type === 'setLarder') { c.autoLarder = a.enabled; prepareLarder(s); return { ok: true }; }
  if (!HOME_DEFS[a.tier] || !Number.isInteger(a.count) || a.count < 1 || a.count > 50) return fail('Choose 1–50 homes.');
  if (a.tier === 'terrace' && population(s) < 40) return fail('Terraces become useful at 40 residents.');
  if (a.tier === 'apartment' && population(s) < 200) return fail('Apartments arrive at 200 residents.');
  const cost = homePrice(s, a.tier);
  if (cost * a.count > s.cash) return fail('Not enough cash for these homes.');
  if (a.at && a.count > 1) return fail('Place homes one at a time.');
  // Every home is its own plot on the map: it moves on its own and leaves no unused space around it.
  let built = 0;
  for (let i = 0; i < a.count; i++) {
    const home = { id: nextId(s), tier: a.tier, count: 1, cost };
    const room = canPlaceNew(s, 'heartland', homeFootprint(home), a.at, 'home', a.rot);
    if (!room && a.tier === 'apartment') { const fp = homeFootprint(home), at = a.at; if (!at || !meets(frontageAt(worldOf(s, 'heartland'), at[0], at[1], (a.rot ?? 0) % 2 ? fp.d : fp.w, (a.rot ?? 0) % 2 ? fp.w : fp.d), APARTMENT_NEED[0])) return built ? { ok: true } : { ok: false, error: `Apartments need ${needText(APARTMENT_NEED[0])}.` }; } if (!room && a.tier === 'apartment' && a.at) { const fp = homeFootprint(home); if (streetJammedAt(s, worldOf(s, 'heartland'), a.at[0], a.at[1], fp.w, fp.d)) return built ? { ok: true } : { ok: false, error: JAM_TEXT }; }
    if (room) { if (!i) return fail(room); log(s, 'warning', `Only ${i} homes fitted. Clear forest to make room for more.`, 'community'); break; }
    c.homes.push(home);
    placeNew(s, 'heartland', `home:${home.id}`, a.at, a.rot);
    built++;
  }
  const cut = c.homes.slice(-built).map((h) => accessNote(s, 'heartland', `home:${h.id}`)).find(Boolean);
  post(s, 'building', -cost * built, `${built} community ${a.tier} home${built === 1 ? '' : 's'}`, 'heartland', 'corporate');
  return { ok: true, note: cut };
}
export const settlement: StageModule = {
  id: 'settlement', title: 'Settlement', legacyEras: [], eraUnlocks: {},
  actionTypes: ['startSettlement', 'buildHomes', 'setLarder', 'settleWorker', 'setSettlementPay', 'upgradeHome'], tips: [], discoveries: [],
  tick: settlementTick, handleAction: action, createState: () => createSettlementState() as unknown as Record<string, unknown>,
};
