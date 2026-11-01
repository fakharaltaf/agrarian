// Orchestrates every system. Pure: no React, no DOM. Functions mutate the GameState passed in.
import {
  BUILDINGS, CONFIG, CROPS, GOODS, GOOD_IDS, MACHINES, PERKS, REGIONS, REGION_IDS, TECH, TICKS_PER_DAY, type CropId, type GoodId, type RegionId,
} from './config';
import { clamp, debt, equity, freeSpace, has, known, log, marketWage, nextId, post, round2, todayBook } from './core';
import { addGoods, canGrow, clearField, fertilizeField, fieldsTick, frostNight, harvestField, isManual, isReady, newField, plantField, spoilageDaily } from './agriculture';
import { buyAnimals, livestockDaily, sellAnimals } from './livestock';
import { createMarkets, drawWeather, executeBuy, executeSell, macroDaily, marketsDaily, marketsTick, priceFromInv } from './markets';
import { hire, laborTick, service, serviceCost, wageOf, workforceDaily } from './operations';
import { buildingsDaily, buildingsTick } from './processing';
import { closeFutures, creditLimit, deliver, financeDaily, openFutures, restructure, takeLoan, insurancePremium } from './finance';
import { canResearch, researchDaily, startResearch } from './research';
import { DEFAULT_POLICIES, newRule, policiesDaily, policiesTick, rulesTick } from './automation';
import { acquire, acquisitionPrice, askingPrice, competitorsDaily, createCompetitors, diligenceCost } from './competitors';
import { antitrustCheck, chooseEvent, eventsDaily, expireChoices } from './events';
import { buyback, execTick, issueShares, marketShare, payDividend } from './corporate';
import { advanceEra, discover, milestonesDaily, progressionTick } from './progression';
import { shipGoods, shipmentsTick } from './logistics';
import type { Action, ActionResult, GameState, RegionState } from './types';

export * from './agriculture';
export { quoteSell, quoteBuy, avgPrice, avg30, outlook } from './markets';
export { objective, PAGES, MILESTONES, lifetimeSales, totalHa, canAdvance, DISCOVERIES, ERA_UNLOCK_TEXT, ERA_SALES } from './progression';
export { forecast } from './markets';
export { herdOf, housing, animalPrice } from './livestock';

const zeroGoods = () => Object.fromEntries(GOOD_IDS.map((g) => [g, 0])) as Record<GoodId, number>;

export function createGame(seed = (Date.now() % 2147483646) + 1): GameState {
  const regions = Object.fromEntries(REGION_IDS.map((r): [RegionId, RegionState] => [r, {
    id: r, unlocked: r === 'heartland', inventory: zeroGoods(), fx: REGIONS[r].fx0, cpi: 1, rainToday: REGIONS[r].rain, temp: REGIONS[r].temp, rain30: REGIONS[r].rain,
    haulToday: 0, truckToday: 0, portToday: 0, insured: false, insuredFrom: 0, forecast: [], frostTonight: false, quality: {}, homePlotsBought: 1, parcelsBought: 0, waterToday: 0, powerGen: 0, powerUse: 0, backlog: 0,
  }])) as Record<RegionId, RegionState>;
  const s: GameState = {
    version: 2, seed, rng: seed, tick: 0, cash: CONFIG.startingCash, marginAccount: 0,
    fields: [], workers: [], machines: [], buildings: [], regions, markets: createMarkets(),
    seeds: Object.fromEntries(Object.keys(CROPS).map((c) => [c, c === 'wheat' ? 10 : 0])) as Record<CropId, number>,
    macro: { cpi: 1, inflation: 0.025, baseRate: 0.045, energy: 1, income: 1, climate: 0, crunch: 0, emissions: 0 },
    bench: {}, loans: [], futures: [], contracts: [], shipments: [], research: { done: [], active: null, licensed: [] },
    automation: { rules: [], policies: { ...DEFAULT_POLICIES } }, competitors: [], events: [],
    corp: { incorporated: false, shares: CONFIG.sharesOutstanding, playerShares: CONFIG.sharesOutstanding, execs: [], reputation: 50, dividends: 0, runoff: 0 },
    ledger: [], lifetime: {}, books: [], overdraftDays: 0, bankrupt: null, era: 1,
    stats: { harvests: 0, sales: 0, produced: {}, spoiled: 0, peopleFed: 0, forcedSales: 0, overflowLost: 0, maxEquity: 0, crisisSurvived: false },
    unlockedCrops: ['wheat'], milestones: [], seenTips: [], discovered: [], eraReady: false, herds: [], warned: {}, log: [], nextId: 1,
  };
  const f = newField(s, 'heartland', 1, 0);
  f.soil = { n: 1, p: 1, k: 1, organic: 0.8 };
  s.fields.push(f);
  s.competitors = createCompetitors(s);
  competitorsDaily(s);
  // Background supply fills whatever competitors do not, so markets start balanced.
  for (const r of REGION_IDS) for (const g in s.markets[r]) {
    const m = s.markets[r][g as GoodId]!;
    if (GOODS[g as GoodId].kind !== 'crop') continue;
    m.bg0 = m.bg = Math.max(m.d0 * 0.25, m.bg0 - m.comp);
  }
  // Let traders and supply settle into a regional equilibrium before the player arrives.
  // Runs up to tick 0 from the past so seasons line up when play starts.
  for (s.tick = -30 * TICKS_PER_DAY; s.tick < 0; s.tick++) {
    marketsTick(s);
    if (s.tick % TICKS_PER_DAY === 0) marketsDaily(s);
  }
  // Keep the settled supply rates and regional price spreads, but start each market from a full buffer.
  for (const r of REGION_IDS) for (const g in s.markets[r]) {
    const m = s.markets[r][g as GoodId]!;
    m.bg0 = m.bg;
    m.inv = m.target * Math.min(1.3, Math.max(0.85, m.inv / m.target));
    m.sent = 0;
    m.price = priceFromInv(s, g as GoodId, m);
    m.history = [round2(m.price)];
    m.daily = [round2(m.price)];
  }
  s.tick = 6; // the first morning: the farm opens at sunrise
  for (const r of REGION_IDS) while (s.regions[r].forecast.length < 4) s.regions[r].forecast.push(drawWeather(s));
  todayBook(s);
  log(s, 'info', 'You have $250, one hectare, ten wheat seeds and a hoe. Plant your first crop.', 'fields');
  return s;
}

// ---------------------------------------------------------------- time

export function step(s: GameState) {
  if (s.bankrupt) return;
  s.tick++;
  if (s.tick % TICKS_PER_DAY === 0) daily(s);
  fieldsTick(s);
  laborTick(s);
  buildingsTick(s);
  execTick(s);
  marketsTick(s);
  shipmentsTick(s);
  rulesTick(s);
  policiesTick(s);
  progressionTick(s);
}

function daily(s: GameState) {
  const b = todayBook(s);
  b.cash = s.cash;
  macroDaily(s);
  frostDaily(s);
  livestockDaily(s);
  marketsDaily(s);
  competitorsDaily(s);
  workforceDaily(s);
  spoilageDaily(s);
  buildingsDaily(s);
  financeDaily(s);
  researchDaily(s);
  eventsDaily(s);
  expireChoices(s);
  policiesDaily(s);
  antitrustCheck(s, (r, c) => marketShare(s, r, c));
  milestonesDaily(s);
  const nb = todayBook(s);
  nb.debt = debt(s);
  nb.equity = equity(s);
}

function frostDaily(s: GameState) {
  for (const r of REGION_IDS) {
    if (!s.regions[r].frostTonight) continue;
    const { hit, killed } = frostNight(s, r);
    if (!hit) continue;
    discover(s, 'frost');
    log(s, 'warning', `Frost in ${REGIONS[r].name}: ${hit} field(s) damaged${killed ? `, ${killed} young crop(s) killed` : ''}.`, 'fields');
  }
}

export function advance(s: GameState, ticks: number) {
  for (let i = 0; i < ticks && !s.bankrupt; i++) step(s);
}

// ---------------------------------------------------------------- actions

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (note?: string): ActionResult => ({ ok: true, note });
const field = (s: GameState, id: number) => s.fields.find((f) => f.id === id);
const finite = (n: number) => Number.isFinite(n);

export const homePlotPrice = (s: GameState) => Math.round(CONFIG.homePlotBase * CONFIG.homePlotGrowth ** (s.regions.heartland.homePlotsBought - 1) * s.macro.cpi);
export const parcelPrice = (s: GameState, r: RegionId, ha: number) => {
  const per = (REGIONS[r].landPrice / REGIONS[r].fx0) * s.regions[r].cpi * s.regions[r].fx * (1 + 0.02 * s.regions[r].parcelsBought);
  return Math.round(per * ha);
};
export const hireCost = (s: GameState, r: RegionId) => Math.round(marketWage(s, r) * 8); // recruiting: one day's pay
export const trainCost = (s: GameState) => Math.round(300 * s.macro.cpi);
export const buildingPrice = (s: GameState, t: keyof typeof BUILDINGS, r: RegionId) => Math.round(BUILDINGS[t].price * s.macro.cpi * (r === 'coastal' ? 1.2 : r === 'arid' || r === 'tropics' ? 0.85 : 1));
export const machinePrice = (s: GameState, t: keyof typeof MACHINES) => Math.round(MACHINES[t].price * s.macro.cpi);
export const irrigationPrice = (s: GameState, ha: number) => Math.round(ha * (CONFIG.irrigationCostPerHa + (has(s, 'dripIrrigation') ? 200 : 0)) * s.macro.cpi);
export const regionEntryCost = (s: GameState) => Math.round(25000 * s.macro.cpi);
export const upgradeCost = (s: GameState, b: { type: keyof typeof BUILDINGS; level: number; region: RegionId }) => Math.round(buildingPrice(s, b.type, b.region) * (b.level === 1 ? 0.8 : 1.4));
export const machineUpgradeCost = (s: GameState, m: { type: keyof typeof MACHINES; tier: number }) => Math.round(machinePrice(s, m.type) * 0.5 * m.tier);
export const greenhousePrice = (s: GameState, ha: number) => Math.round(2000 * ha * s.macro.cpi);
const BUILDING_GATE: Partial<Record<keyof typeof BUILDINGS, string>> = { coop: 'chickens', pigsty: 'livestock', sheepfold: 'livestock', cowshed: 'livestock' };

export function dispatch(s: GameState, a: Action): ActionResult {
  if (s.bankrupt && a.type !== 'restructure' && a.type !== 'seeTip') return fail('The business is insolvent. Restructure or start over.');
  for (const v of Object.values(a)) if (typeof v === 'number' && !finite(v)) return fail('Invalid number.');
  switch (a.type) {
    case 'plant': {
      const f = field(s, a.fieldId);
      if (!f) return fail('No such field.');
      if (!isManual(f)) return fail('This field is too large to plant by hand — give it a crop plan and hire workers.');
      const err = plantField(s, f, a.crop, s.cash);
      return err ? fail(err) : ok();
    }
    case 'harvest': {
      const f = field(s, a.fieldId);
      if (!f || !f.crop) return fail('Nothing to harvest.');
      if (!isManual(f)) return fail('This field is too large to harvest by hand — workers and harvesters do it.');
      if (!isReady(s, f)) return fail('Crop has not matured yet.');
      harvestField(s, f);
      return ok();
    }
    case 'setPlan': {
      if (s.era < 2) return fail('Crop plans arrive with your first workers.');
      if (a.crop && !s.unlockedCrops.includes(a.crop)) return fail('That crop is not available.');
      let n = 0;
      for (const id of a.fieldIds) {
        const f = field(s, id);
        if (f && (!a.crop || canGrow(f, a.crop))) (f.plan = a.crop), n++;
      }
      return n ? ok() : fail('That crop cannot grow on the selected fields.');
    }
    case 'fertilize': {
      if (s.era < 2) return fail('Fertiliser is not available yet.');
      const errs: string[] = [];
      for (const id of a.fieldIds) {
        const f = field(s, id);
        if (!f) continue;
        const e = fertilizeField(s, f, a.source);
        if (e) errs.push(e);
      }
      return errs.length === a.fieldIds.length ? fail(errs[0] ?? 'Nothing fertilised.') : ok(errs.length ? `${errs.length} field(s) skipped: ${errs[0]}` : undefined);
    }
    case 'irrigate': {
      if (s.era < 2) return fail('Irrigation is not available yet.');
      const fs = a.fieldIds.map((id) => field(s, id)).filter((f) => f && !f.irrigated) as NonNullable<ReturnType<typeof field>>[];
      const ha = fs.reduce((x, f) => x + f.ha, 0);
      if (!ha) return fail('Those fields are already irrigated.');
      const cost = irrigationPrice(s, ha);
      if (cost > s.cash) return fail(`Irrigation for ${ha} ha costs $${cost.toLocaleString()}.`);
      post(s, 'irrigation', -cost, `Irrigation for ${ha} ha`, fs[0].region);
      fs.forEach((f) => (f.irrigated = true));
      // equipment is part of the land's book value
      fs.forEach((f) => (f.cost += cost * (f.ha / ha)));
      return ok();
    }
    case 'sell': {
      const qty = Math.floor(a.qty);
      if (qty <= 0) return fail('Nothing to sell.');
      if (!s.regions[a.region].unlocked) return fail('You have no operations in that region.');
      if (!s.markets[a.region][a.good]) return fail('There is no market for that.');
      if (qty > s.regions[a.region].inventory[a.good] + 1e-6) return fail('Not enough inventory.');
      const q = executeSell(s, a.region, a.good, qty);
      if (!q.qty) return fail(q.limitedBy ?? 'Could not sell.');
      return ok(q.limitedBy);
    }
    case 'buy': {
      const qty = Math.floor(a.qty);
      if (qty <= 0) return fail('Enter a quantity.');
      if (s.era < 2 && a.good !== 'fertilizer') return fail('Not available yet.');
      if (!s.regions[a.region].unlocked) return fail('You have no operations in that region.');
      if (GOODS[a.good].kind !== 'input' && a.good !== 'feed' && s.era < 5) return fail('The commodity exchange opens in Era 5.');
      const space = Math.floor(spaceFor(s, a.region, a.good));
      if (space <= 0) return fail('No storage space for that.');
      const want = Math.min(qty, space);
      const pre = (s.markets[a.region][a.good]!.price * want) * 1.2;
      if (pre > s.cash) return fail(`That costs about $${Math.round(pre).toLocaleString()}.`);
      const q = executeBuy(s, a.region, a.good, want);
      if (!q.qty) return fail(q.limitedBy ?? 'Could not buy.');
      return ok(want < qty ? 'Limited by storage space.' : q.limitedBy);
    }
    case 'buyPlot': {
      const n = s.regions.heartland.homePlotsBought;
      if (n >= CONFIG.homePlots) return fail('No more small plots for sale — buy larger parcels instead.');
      const price = homePlotPrice(s);
      if (price > s.cash) return fail(`Need $${price.toLocaleString()} to buy another hectare.`);
      post(s, 'land', -price, `Field plot (1 ha)`);
      const f = newField(s, 'heartland', 1, price);
      s.fields.push(f);
      s.regions.heartland.homePlotsBought++;
      log(s, 'info', `Bought field ${f.id} for $${price.toLocaleString()}.`, 'fields');
      return ok();
    }
    case 'buyParcel': {
      if (s.era < 3) return fail('Parcels become available in the Mechanization era.');
      if (!s.regions[a.region].unlocked) return fail('Expand into this region first.');
      if (!CONFIG.parcelSizes.includes(a.ha)) return fail('Invalid parcel size.');
      const price = parcelPrice(s, a.region, a.ha);
      if (price > s.cash) return fail(`A ${a.ha} ha parcel costs $${price.toLocaleString()}.`);
      post(s, 'land', -price, `${a.ha} ha parcel`, a.region);
      const f = newField(s, a.region, a.ha, price);
      s.fields.push(f);
      s.regions[a.region].parcelsBought++;
      log(s, 'info', `Bought a ${a.ha} ha parcel in ${REGIONS[a.region].name} (field ${f.id}).`, 'fields');
      return ok();
    }
    case 'sellField': {
      const f = field(s, a.fieldId);
      if (!f) return fail('No such field.');
      if (s.fields.length <= 1) return fail('You cannot sell your last field.');
      const value = Math.round(f.cost * 0.85);
      post(s, 'assetSale', value, `Sold field ${f.id}`, f.region);
      s.fields.splice(s.fields.indexOf(f), 1);
      return ok(`Sold for $${value.toLocaleString()}.`);
    }
    case 'hire': {
      if (s.era < 2) return fail('Workers arrive in Era 2.');
      if (!s.regions[a.region].unlocked) return fail('Expand into this region first.');
      if (a.role === 'manager' && s.era < 3) return fail('Managers become available in Era 3.');
      const c = hireCost(s, a.region);
      if (c > s.cash) return fail(`Recruiting costs $${c}.`);
      post(s, 'training', -c, 'Recruitment', a.region);
      const w = hire(s, a.region, a.role, a.wageFactor);
      log(s, 'info', `Hired ${w.name} as a ${a.role === 'hand' ? 'farm hand' : 'farm manager'} in ${REGIONS[a.region].name}.`, 'workers');
      return ok();
    }
    case 'fire': {
      const w = s.workers.find((x) => x.id === a.workerId);
      if (!w) return fail('No such worker.');
      post(s, w.role === 'manager' ? 'salaries' : 'wages', -wageOf(s, w) * 12, `Severance: ${w.name}`, w.region);
      s.workers.splice(s.workers.indexOf(w), 1);
      for (const o of s.workers) if (o.region === w.region) o.morale = clamp(o.morale - 0.05, 0, 1);
      return ok();
    }
    case 'setWage': {
      const w = s.workers.find((x) => x.id === a.workerId);
      if (!w) return fail('No such worker.');
      w.wageFactor = clamp(a.wageFactor, 0.7, 1.6);
      return ok();
    }
    case 'train': {
      const w = s.workers.find((x) => x.id === a.workerId);
      if (!w) return fail('No such worker.');
      if (w.skill >= 1.6) return fail('Already at maximum skill.');
      if (w.trainingUntil > s.tick) return fail('Already in training.');
      const c = trainCost(s);
      if (c > s.cash) return fail(`Training costs $${c}.`);
      post(s, 'training', -c, `Training: ${w.name}`, w.region);
      w.skill = Math.min(1.6, w.skill + 0.15);
      w.trainingUntil = s.tick + TICKS_PER_DAY;
      return ok();
    }
    case 'buyMachine': {
      const d = MACHINES[a.machine];
      if (!d) return fail('Unknown machine.');
      if (s.era < d.minEra) return fail('Not available yet.');
      if (d.research && !has(s, d.research)) return fail(`Requires research: ${TECH[d.research].name}.`);
      if (!s.regions[a.region].unlocked) return fail('Expand into this region first.');
      const price = a.lease ? Math.round(d.leasePerDay * s.macro.cpi * 3) : machinePrice(s, a.machine);
      if (price > s.cash) return fail(a.lease ? `The lease needs a 3-day deposit of $${price.toLocaleString()}.` : `Costs $${price.toLocaleString()}.`);
      post(s, a.lease ? 'lease' : 'machine', -price, a.lease ? `${d.name} lease deposit` : d.name, a.region);
      s.machines.push({ id: nextId(s), type: a.machine, region: a.region, condition: 1, hours: 0, util: 0, task: 0, tier: 1, broken: false, leased: a.lease, cost: a.lease ? 0 : price, depreciated: 0, usedThisTick: false });
      return ok();
    }
    case 'sellMachine': {
      const m = s.machines.find((x) => x.id === a.machineId);
      if (!m) return fail('No such machine.');
      if (!m.leased) post(s, 'assetSale', Math.round(Math.max(0, m.cost - m.depreciated) * 0.8 * (m.broken ? 0.5 : 1)), `Sold ${MACHINES[m.type].name}`, m.region);
      s.machines.splice(s.machines.indexOf(m), 1);
      return ok(m.leased ? 'Lease returned.' : undefined);
    }
    case 'service': {
      const m = s.machines.find((x) => x.id === a.machineId);
      if (!m) return fail('No such machine.');
      if (serviceCost(s, m) > s.cash) return fail(`Costs $${Math.round(serviceCost(s, m))}.`);
      service(s, m);
      return ok();
    }
    case 'build': {
      const d = BUILDINGS[a.building];
      if (!d) return fail('Unknown building.');
      if (s.era < d.minEra) return fail('Not available yet.');
      if (d.research && !has(s, d.research)) return fail(`Requires research: ${TECH[d.research].name}.`);
      if (!s.regions[a.region].unlocked) return fail('Expand into this region first.');
      const gate = BUILDING_GATE[a.building];
      if (gate && !known(s, gate)) return fail('Not available yet.');
      if (a.building === 'cowshed' && s.era < 3) return fail('Cowsheds arrive with mechanisation (Era 3).');
      const price = buildingPrice(s, a.building, a.region);
      if (price > s.cash) return fail(`Costs $${price.toLocaleString()}.`);
      post(s, 'building', -price, d.name, a.region);
      s.buildings.push({ id: nextId(s), type: a.building, region: a.region, active: true, level: 1, cost: price, depreciated: 0, util: 0, reason: '', stats: { out: 0, inCost: 0, outValue: 0, opCost: 0 } });
      log(s, 'info', `Built a ${d.name.toLowerCase()} in ${REGIONS[a.region].name}.`, BUILDINGS[a.building].category === 'storage' ? 'storage' : 'production');
      return ok();
    }
    case 'demolish': {
      const b = s.buildings.find((x) => x.id === a.buildingId);
      if (!b) return fail('No such building.');
      s.buildings.splice(s.buildings.indexOf(b), 1);
      post(s, 'assetSale', Math.round(Math.max(0, b.cost - b.depreciated) * 0.5), `Sold ${BUILDINGS[b.type].name}`, b.region);
      // contents that no longer fit are sold or lost through the normal overflow rule
      for (const g of GOOD_IDS) {
        const q = s.regions[b.region].inventory[g];
        if (!q) continue;
        s.regions[b.region].inventory[g] = 0;
        addGoods(s, b.region, g, q);
      }
      return ok();
    }
    case 'toggleBuilding': {
      const b = s.buildings.find((x) => x.id === a.buildingId);
      if (!b) return fail('No such building.');
      b.active = !b.active;
      return ok();
    }
    case 'ship': {
      if (s.era < 6) return fail('Shipping opens with regional expansion.');
      const e = shipGoods(s, a.good, Math.floor(a.qty), a.from, a.to);
      return e ? fail(e) : ok();
    }
    case 'takeLoan': {
      if (s.era < 3) return fail('Banks lend from the Mechanization era.');
      if (![30, 120, 360].includes(a.termDays)) return fail('Invalid term.');
      if (a.amount <= 0) return fail('Enter an amount.');
      if (a.amount > creditLimit(s)) return fail(`Your credit limit is $${Math.floor(creditLimit(s)).toLocaleString()}.`);
      takeLoan(s, Math.round(a.amount), a.termDays);
      return ok();
    }
    case 'repayLoan': {
      const l = s.loans.find((x) => x.id === a.loanId);
      if (!l) return fail('No such loan.');
      const amt = Math.min(a.amount, l.balance);
      if (amt <= 0 || amt > s.cash) return fail('Not enough cash.');
      post(s, 'loanRepay', -amt, 'Early repayment', 'heartland', 'corporate');
      l.balance = round2(l.balance - amt);
      if (l.balance <= 0.01) s.loans.splice(s.loans.indexOf(l), 1);
      return ok();
    }
    case 'openFutures': {
      if (s.era < 5) return fail('Futures open in Era 5.');
      if (!Number.isInteger(a.contracts) || a.contracts === 0) return fail('Enter a whole number of contracts.');
      if (![30, 60, 120].includes(a.days)) return fail('Invalid expiry.');
      const e = openFutures(s, a.good, a.contracts, a.days);
      return e ? fail(e) : ok();
    }
    case 'closeFutures': {
      const p = s.futures.find((x) => x.id === a.positionId);
      if (!p) return fail('No such position.');
      closeFutures(s, p);
      return ok();
    }
    case 'acceptContract': {
      const c = s.contracts.find((x) => x.id === a.contractId);
      if (!c || c.accepted) return fail('Offer no longer available.');
      if (!s.regions[c.region].unlocked) return fail(`You need operations in ${REGIONS[c.region].name} to deliver there.`);
      c.accepted = true;
      return ok();
    }
    case 'deliverContract': {
      const c = s.contracts.find((x) => x.id === a.contractId);
      if (!c?.accepted) return fail('No such contract.');
      const q = deliver(s, c);
      if (!q) return fail(`No ${GOODS[c.good].name.toLowerCase()} in ${REGIONS[c.region].name} storage.`);
      if (c.delivered >= c.qty) {
        s.contracts.splice(s.contracts.indexOf(c), 1);
        s.corp.reputation = clamp(s.corp.reputation + 0.5, 0, 100);
        log(s, 'info', `Contract with ${c.buyer} fulfilled early.`, 'markets');
      }
      return ok(`Delivered ${Math.round(q)}.`);
    }
    case 'setInsurance': {
      if (s.era < 5) return fail('Insurance arrives in Era 5.');
      const reg = s.regions[a.region];
      if (a.on && !reg.insured) reg.insuredFrom = s.tick + 10 * TICKS_PER_DAY;
      reg.insured = a.on;
      return ok(a.on ? `Premium about $${Math.round(insurancePremium(s, a.region))}/day. Cover starts in 10 days.` : undefined);
    }
    case 'research': {
      const e = canResearch(s, a.tech);
      if (e) return fail(e);
      startResearch(s, a.tech);
      return ok();
    }
    case 'unlockRegion': {
      if (s.era < 6) return fail('Regional expansion opens in Era 6.');
      if (s.regions[a.region].unlocked) return fail('Already operating there.');
      const c = regionEntryCost(s);
      if (c > s.cash) return fail(`Setting up costs $${c.toLocaleString()} (permits, office, local bank).`);
      post(s, 'legal', -c, `Entry: ${REGIONS[a.region].name}`, a.region, 'corporate');
      s.regions[a.region].unlocked = true;
      log(s, 'opportunity', `You now operate in ${REGIONS[a.region].name}. Buy land, hire locally and build storage there.`, 'world');
      return ok();
    }
    case 'addRule': {
      if (!has(s, 'farmSoftware')) return fail('Research Farm management software first.');
      if (s.automation.rules.length >= 40) return fail('Rule limit reached.');
      s.automation.rules.push(newRule(s, a.rule));
      return ok();
    }
    case 'updateRule': {
      const r = s.automation.rules.find((x) => x.id === a.ruleId);
      if (!r) return fail('No such rule.');
      const { id: _i, history: _h, lastRun: _l, ...patch } = a.patch;
      void _i; void _h; void _l;
      Object.assign(r, patch);
      return ok();
    }
    case 'deleteRule': {
      s.automation.rules = s.automation.rules.filter((r) => r.id !== a.ruleId);
      return ok();
    }
    case 'setPolicies': {
      const P = s.automation.policies;
      for (const [k, v] of Object.entries(a.patch)) {
        if (!(k in P)) continue;
        if (typeof v === 'number' && (!finite(v) || v < 0)) return fail('Invalid value.');
        (P as unknown as Record<string, unknown>)[k] = v;
      }
      if (a.patch.debtCeiling && !has(s, 'agAI')) return fail('The debt-ceiling objective needs Agricultural AI.');
      if (a.patch.hedgeRatio && !s.corp.execs.includes('trading')) return fail('Hedging policy needs a head of commodity trading.');
      return ok();
    }
    case 'incorporate': {
      if (s.era < 7) return fail('Incorporation opens in Era 7.');
      if (s.corp.incorporated) return fail('Already incorporated.');
      const c = CONFIG.incorporateCost * s.macro.cpi;
      if (c > s.cash) return fail(`Legal costs are $${Math.round(c).toLocaleString()}.`);
      post(s, 'legal', -c, 'Incorporation', 'heartland', 'corporate');
      s.corp.incorporated = true;
      return ok();
    }
    case 'hireExec': {
      if (!s.corp.incorporated) return fail('Incorporate first.');
      if (s.corp.execs.includes(a.division)) return fail('That division already has a head.');
      s.corp.execs.push(a.division);
      return ok();
    }
    case 'fireExec': {
      s.corp.execs = s.corp.execs.filter((d) => d !== a.division);
      return ok();
    }
    case 'issueShares': {
      if (!s.corp.incorporated) return fail('Incorporate first.');
      if (a.pct <= 0 || a.pct > 0.25) return fail('Issue between 1% and 25%.');
      if (equityValue(s) <= 0) return fail('Investors will not buy shares in a company with negative equity.');
      const after = s.corp.playerShares / (s.corp.shares * (1 + a.pct));
      if (after < 0.51) return fail(`That would cut your stake to ${Math.round(after * 100)}%. You must keep at least 51% to stay in control.`);
      const p = issueShares(s, a.pct);
      return ok(`Raised $${Math.round(p).toLocaleString()}.`);
    }
    case 'buyback': {
      if (!s.corp.incorporated) return fail('Incorporate first.');
      const e = buyback(s, a.pct);
      return e ? fail(e) : ok();
    }
    case 'payDividend': {
      if (!s.corp.incorporated) return fail('Incorporate first.');
      if (a.amount <= 0 || a.amount > s.cash) return fail('Not enough cash.');
      payDividend(s, a.amount);
      return ok();
    }
    case 'diligence': {
      const c = s.competitors.find((x) => x.id === a.competitorId);
      if (!c || c.status === 'acquired') return fail('Not available.');
      if (s.era < 7) return fail('Acquisitions open in Era 7.');
      if (c.diligence !== 'none') return fail('Due diligence already done.');
      const cost = diligenceCost(s, c);
      if (cost > s.cash) return fail(`Due diligence costs $${Math.round(cost).toLocaleString()}.`);
      post(s, 'legal', -cost, `Due diligence: ${c.name}`, c.region, 'corporate');
      c.diligence = 'done';
      log(s, 'info', `Due diligence on ${c.name}: hidden liabilities of $${Math.round(c.hiddenDebt).toLocaleString()}. Their price is adjusted accordingly.`, 'competitors');
      return ok();
    }
    case 'acquire': {
      const c = s.competitors.find((x) => x.id === a.competitorId);
      if (!c || c.status === 'acquired') return fail('Not available.');
      if (!s.corp.incorporated) return fail('Incorporate before making acquisitions.');
      const price = acquisitionPrice(s, c) + Math.max(5000, askingPrice(s, c) * 0.05);
      if (price > s.cash) return fail(`You need $${Math.round(price).toLocaleString()} including integration costs.`);
      acquire(s, c);
      return ok();
    }
    case 'chooseEvent': {
      const e = chooseEvent(s, a.eventId, a.option);
      return e ? fail(e) : ok();
    }
    case 'restructure': {
      if (!s.bankrupt) return fail('Nothing to restructure.');
      restructure(s);
      return ok();
    }
    case 'advanceEra': {
      const e = advanceEra(s);
      return e ? fail(e) : ok();
    }
    case 'buyAnimals': {
      if (!known(s, a.animal === 'chickens' ? 'chickens' : 'livestock') || (a.animal === 'cows' && s.era < 3)) return fail('Not available yet.');
      if (!Number.isInteger(a.count) || a.count <= 0) return fail('Enter a number of animals.');
      const e = buyAnimals(s, a.region, a.animal, a.count);
      return e ? fail(e) : ok();
    }
    case 'sellAnimals': {
      const e = sellAnimals(s, a.region, a.animal, Math.floor(a.count));
      return e ? fail(e) : ok();
    }
    case 'upgradeBuilding': {
      const b = s.buildings.find((x) => x.id === a.buildingId);
      if (!b) return fail('No such building.');
      if (!known(s, 'upgrades')) return fail('Upgrades are not available yet.');
      if (b.level >= 3) return fail('Already at the highest level.');
      const cost = upgradeCost(s, b);
      if (cost > s.cash) return fail(`Upgrading costs $${Math.round(cost).toLocaleString()}.`);
      post(s, 'building', -cost, `Upgrade ${BUILDINGS[b.type].name} to level ${b.level + 1}`, b.region);
      b.level++;
      b.cost += cost;
      return ok(`${BUILDINGS[b.type].name} is now level ${b.level}.`);
    }
    case 'upgradeMachine': {
      const m = s.machines.find((x) => x.id === a.machineId);
      if (!m) return fail('No such machine.');
      if (!known(s, 'machineUpgrades')) return fail('Machine upgrades are not available yet.');
      if (m.leased) return fail('Leased machines cannot be modified.');
      if (m.tier >= 3) return fail('Already at the highest tier.');
      const cost = machineUpgradeCost(s, m);
      if (cost > s.cash) return fail(`Upgrading costs $${Math.round(cost).toLocaleString()}.`);
      post(s, 'machine', -cost, `Upgrade ${MACHINES[m.type].name} to tier ${m.tier + 1}`, m.region);
      m.tier++;
      m.cost += cost;
      return ok();
    }
    case 'choosePerk': {
      const w = s.workers.find((x) => x.id === a.workerId);
      if (!w || w.role !== 'hand') return fail('No such farm hand.');
      if (!known(s, 'perks') || w.skill < 1.05) return fail('This worker is not skilled enough to specialise yet.');
      if (w.perk) return fail('Already specialised.');
      w.perk = a.perk;
      return ok(`${w.name} is now a ${PERKS[a.perk].name.toLowerCase()}.`);
    }
    case 'greenhouse': {
      if (!known(s, 'frost')) return fail('Not available yet.');
      const fs = a.fieldIds.map((id) => field(s, id)).filter((f) => f && !f.greenhouse) as NonNullable<ReturnType<typeof field>>[];
      if (fs.some((f) => f.ha > 5)) return fail('Greenhouses can only cover fields of 5 ha or less.');
      const ha = fs.reduce((x, f) => x + f.ha, 0);
      if (!ha) return fail('Those fields already have greenhouses.');
      const cost = greenhousePrice(s, ha);
      if (cost > s.cash) return fail(`Greenhouses for ${ha} ha cost $${Math.round(cost).toLocaleString()}.`);
      post(s, 'irrigation', -cost, `Greenhouse over ${ha} ha`, fs[0].region);
      fs.forEach((f) => ((f.greenhouse = true), (f.cost += cost * (f.ha / ha))));
      return ok();
    }
    case 'clearField': {
      const f = field(s, a.fieldId);
      if (!f?.crop) return fail('Nothing to clear.');
      clearField(f);
      return ok();
    }
    case 'seeTip': {
      if (a.tip === '__reset') s.seenTips = [];
      else if (a.tip === '__on') s.seenTips = s.seenTips.filter((t) => t !== '__off');
      else if (!s.seenTips.includes(a.tip)) s.seenTips.push(a.tip);
      return ok();
    }
  }
}

const equityValue = (s: GameState) => equity(s);
const spaceFor = (s: GameState, r: RegionId, g: GoodId) => freeSpace(s, r, g);
export { creditLimit, insurancePremium };
export const wageQuote = (s: GameState, r: RegionId) => marketWage(s, r);
