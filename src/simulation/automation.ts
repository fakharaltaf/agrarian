// Levels 3–5 of automation: managers run field cycles, rules react to conditions,
// policies steer everything toward strategic objectives. Automation spends real money
// through the same primitives as the player, and never below the cash reserve.
import { ANIMALS, BUILDINGS, CONFIG, CROPS, DAYS_PER_YEAR, GOODS, GOOD_IDS, MACHINES, REGIONS, REGION_IDS, TICKS_PER_DAY, WORK_END, WORK_START, type CropId, type GoodId, type RegionId } from './config';
import { canGrow, expectedYield, fertility, fertilizeField, soilAdequacy } from './agriculture';
import { buildingsIn, clamp, levelMult, reservedStock, debt, execOn, has, hour, log, nextId, post, priceUsd, seasonOf, seedCost, stored, totalAssets } from './core';
import { avg30, closedPort, executeBuy, executeSell, forecast, marketDepth, quoteBuy } from './markets';
import { CONTRACT_SIZE, FUTURES_GOODS, openFutures, futuresPrice, closeFutures } from './finance';
import { autoBudget, machineRate, serviceCost, service } from './operations';
import { FEEDS } from './livestock';
import { buildingMargin } from './processing';
import { exportGain, shipGoods } from './logistics';
import type { GameState, Rule } from './types';

export const hasManager = (s: GameState, r: RegionId) => s.workers.some((w) => w.region === r && w.role === 'manager') || execOn(s, 'crops');
const spendable = (s: GameState) => Math.max(0, s.cash - s.automation.policies.cashReserve);

// ---------------------------------------------------------------- rules

export function metricValue(s: GameState, r: Rule): number {
  switch (r.metric) {
    case 'price': return s.markets[r.region][r.good]?.price ?? 0;
    case 'inventory': return s.regions[r.region].inventory[r.good];
    case 'cash': return s.cash;
    case 'storageUtil': { const st = stored(s, r.region); return st.cap.dry ? (st.dry / st.cap.dry) * 100 : 0; }
    case 'minFertility': return Math.min(100, ...s.fields.filter((f) => f.region === r.region).map((f) => fertility(f) * 100));
    case 'minCondition': return Math.min(100, ...s.machines.filter((m) => m.region === r.region).map((m) => (m.broken ? 0 : m.condition * 100)));
    case 'facilityMargin': return buildingsIn(s, r.region).filter((b) => BUILDINGS[b.type].recipe).reduce((a, b) => a + buildingMargin(b), 0);
  }
}

export function rulesTick(s: GameState) {
  if (!has(s, 'farmSoftware')) return;
  const rules = s.automation.rules.filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
  for (const r of rules) {
    if (s.tick - r.lastRun < r.cooldown) continue;
    const v = metricValue(s, r);
    if (!(r.op === '>' ? v > r.value : v < r.value)) continue;
    const note = runRule(s, r);
    if (!note) continue;
    r.lastRun = s.tick;
    r.history.unshift({ tick: s.tick, note: `${metricLabel(r)} was ${fmt(v)} ${r.op} ${fmt(r.value)} → ${note}` });
    if (r.history.length > 10) r.history.pop();
  }
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2));
export const metricLabel = (r: Pick<Rule, 'metric' | 'good' | 'region'>) =>
  ({ price: `${GOODS[r.good].name} price`, inventory: `${GOODS[r.good].name} stock`, cash: 'Cash', storageUtil: 'Dry storage %', minFertility: 'Lowest fertility %', minCondition: 'Lowest machine condition %', facilityMargin: 'Factory margin $/h' })[r.metric];

function runRule(s: GameState, r: Rule): string | null {
  const inv = s.regions[r.region].inventory;
  const budget = Math.min(spendable(s), r.maxSpend || Infinity);
  switch (r.action) {
    case 'sell': {
      const q = Math.floor((inv[r.actionGood] - reservedStock(s, r.region, r.actionGood)) * (r.amountPct / 100));
      if (q <= 0 || !s.markets[r.region][r.actionGood]) return null;
      const done = executeSell(s, r.region, r.actionGood, q);
      return done.qty ? `sold ${Math.round(done.qty)} ${GOODS[r.actionGood].name} for $${Math.round(done.net)}` : null;
    }
    case 'buy': {
      if (GOODS[r.actionGood].kind !== 'input' && s.era < 5) return null; // exchange opens in Era 5
      let q = Math.floor(r.amountPct);
      const quote = quoteBuy(s, r.region, r.actionGood, q);
      if (quote.net > budget) q = Math.floor(q * (budget / quote.net));
      if (q <= 0) return null;
      const done = executeBuy(s, r.region, r.actionGood, q);
      return done.qty ? `bought ${Math.round(done.qty)} ${GOODS[r.actionGood].name} for $${Math.round(done.net)}` : null;
    }
    case 'fertilizeLow': {
      let n = 0;
      for (const f of s.fields) if (f.region === r.region && !f.crop && !f.spreading && fertility(f) < 0.6 && !fertilizeField(s, f, 'fertilizer')) n++;
      return n ? `fertilised ${n} field(s)` : null;
    }
    case 'repairAll': {
      let n = 0, spent = 0;
      for (const m of s.machines) {
        if (m.region !== r.region || (m.condition > 0.6 && !m.broken)) continue;
        const c = serviceCost(s, m);
        if (spent + c > budget) break;
        service(s, m);
        spent += c;
        n++;
      }
      return n ? `serviced ${n} machine(s) for $${Math.round(spent)}` : null;
    }
    case 'pauseFacilities':
    case 'resumeFacilities': {
      const want = r.action === 'resumeFacilities';
      const bs = buildingsIn(s, r.region).filter((b) => (!r.buildingType || b.type === r.buildingType) && BUILDINGS[b.type].recipe && b.active !== want);
      bs.forEach((b) => (b.active = want));
      return bs.length ? `${want ? 'resumed' : 'paused'} ${bs.length} facilit${bs.length === 1 ? 'y' : 'ies'}` : null;
    }
    case 'ship': {
      const q = Math.floor(inv[r.actionGood] * (r.amountPct / 100));
      if (q <= 0 || r.actionRegion === r.region) return null;
      const err = shipGoods(s, r.actionGood, q, r.region, r.actionRegion, budget);
      return err ? null : `shipped ${q} ${GOODS[r.actionGood].name} to ${REGIONS[r.actionRegion].name}`;
    }
    case 'setPlan': {
      const c = r.actionGood as CropId;
      if (!CROPS[c] || !s.unlockedCrops.includes(c)) return null;
      const fs = s.fields.filter((f) => f.region === r.region && !f.planLocked && f.plan !== c && canGrow(f, c));
      fs.forEach((f) => (f.plan = c));
      return fs.length ? `planned ${GOODS[c].name} on ${fs.length} field(s)` : null;
    }
  }
}

export function newRule(s: GameState, rule: Omit<Rule, 'id' | 'lastRun' | 'history'>): Rule {
  return { ...rule, id: nextId(s), lastRun: -1e9, history: [] }; // finite so it survives JSON saves
}

// ---------------------------------------------------------------- managers & policies

/** Hectares per working hour the region's crew can plant or harvest a crop: drivable machines (one per hand) plus hands left over working by hand. */
export function crewRate(s: GameState, r: RegionId, kind: 'plant' | 'harvest', c: CropId) {
  const hands = s.workers.filter((w) => w.region === r && w.role === 'hand').length;
  const rates = s.machines.filter((m) => m.region === r && !m.broken && MACHINES[m.type].task === kind && MACHINES[m.type].haPerHour
    && (MACHINES[m.type].crops ? MACHINES[m.type].crops!.includes(c) : kind === 'plant' || CROPS[c].machineHarvest))
    .map((m) => ({ auto: !!MACHINES[m.type].autonomous, ha: machineRate(s, m) * (MACHINES[m.type].autonomous ? 2 : 1) })) // autonomous run round the clock
    .sort((a, b) => Number(b.auto) - Number(a.auto) || b.ha - a.ha);
  let drivers = hands, ha = 0;
  for (const m of rates) if (m.auto) ha += m.ha; else if (drivers > 0) (ha += m.ha), drivers--;
  return ha + drivers / (kind === 'plant' ? CONFIG.plantHours : CROPS[c].harvestHours);
}

/** Expected profit per hour per ha of a crop on this field at today's prices, over a whole cycle: growing plus the crew's time to plant and harvest it. */
export function cropScore(s: GameState, f: import('./types').Field, c: CropId, price = s.markets[f.region][c]!.price) {
  const y = expectedYield(s, f, c) / f.ha;
  const seed = CONFIG.seedsPerHa * seedCost(s, c);
  const area = Math.max(f.ha, s.fields.reduce((a, x) => a + (x.region === f.region && x.plan ? x.ha : 0), 0)); // one crew works every planned field in the region
  const work = area * ((CROPS[c].perennial ? 0 : 1) / Math.max(0.01, crewRate(s, f.region, 'plant', c)) + 1 / Math.max(0.01, crewRate(s, f.region, 'harvest', c)));
  return (y * price - seed) / (CROPS[c].growthTicks + work * (24 / (WORK_END - WORK_START)));
}

/** What one unit of a crop is worth to your own running factories here (outputs at market, less staff), while they are short of it. 0 if none. */
export function millValue(s: GameState, r: RegionId, c: CropId) {
  let best = 0;
  for (const b of buildingsIn(s, r)) {
    const rec = BUILDINGS[b.type].recipe;
    const per = rec?.inputs[c];
    if (!b.active || !rec || !per) continue;
    const perHour = per * rec.batchesPerHour * levelMult(b.level);
    if (s.regions[r].inventory[c] > perHour * 48) continue; // two days of stock already waiting
    const out = Object.entries(rec.outputs).reduce((a, [g, q]) => a + (s.markets[r][g as GoodId]?.price ?? 0) * q!, 0);
    best = Math.max(best, (out - BUILDINGS[b.type].staffPerHour * s.macro.cpi / rec.batchesPerHour) / per);
  }
  return best;
}

/** Tender crop, outdoors, in a region whose coming days (or season) bring frost. */
export function frostRisk(s: GameState, f: import('./types').Field, c: CropId) {
  if (CROPS[c].frostHardy || f.greenhouse) return false;
  const season = seasonOf(s);
  if (season === 'Winter' || (season === 'Autumn' && forecast(s, f.region).some((d) => d.frost))) return true;
  if (season !== 'Autumn') return false;
  // a big field takes days to sow: would the crop still be in the ground when winter comes?
  const daysToWinter = 30 - ((Math.floor(s.tick / TICKS_PER_DAY) % DAYS_PER_YEAR) % 30);
  const sowDays = (f.ha / Math.max(0.01, crewRate(s, f.region, 'plant', c))) * (24 / (WORK_END - WORK_START)) / 24;
  return sowDays + CROPS[c].growthTicks / 24 > daysToWinter;
}

export function chooseCrop(s: GameState, f: import('./types').Field): CropId | null {
  const smart = has(s, 'agAI');
  let best: CropId | null = null, bestV = -Infinity;
  for (const c of s.unlockedCrops) {
    if (!canGrow(f, c)) continue;
    let v = s.automation.policies.supplyFactories ? Math.max(cropScore(s, f, c), cropScore(s, f, c, millValue(s, f.region, c))) : cropScore(s, f, c);
    if (frostRisk(s, f, c)) v *= 0.25; // a sensible manager doesn't sow tender crops into frost season
    if (CROPS[c].perennial) v = -Infinity; // orchards are a long-term decision for the owner, not a rotation choice
    if (f.lastCrop === c && f.streak >= 1) v *= smart ? 0.75 : 0.9; // monoculture pest risk
    if (smart) {
      if (soilAdequacy(f, c) < 0.75) v *= 0.8; // spare depleted nutrients
      if (c === 'soybeans' && f.soil.n < 0.6) v *= 1.4; // nitrogen-fixing rotation
    }
    if (v > bestV) (bestV = v), (best = c);
  }
  return best;
}

export function policiesTick(s: GameState) {
  const P = s.automation.policies;
  const h = hour(s);
  // Managers set rotation each time a field is empty.
  if (P.autoRotate) for (const f of s.fields) if (!f.crop && !f.planLocked && f.work === 0 && hasManager(s, f.region)) f.plan = chooseCrop(s, f) ?? f.plan;
  // Storage is watched every hour (harvests land any time); price-led selling waits for the midday round.
  if (P.sellDiscipline > 0) for (const r of REGION_IDS) if (hasManager(s, r)) sellRound(s, r, h === 12);
  if (h !== 12) return;
  // Midday rounds: fertiliser and selling discipline.
  for (const r of REGION_IDS) {
    if (!hasManager(s, r)) continue;
    // manure is free fertiliser: managers spread it on empty fields that would benefit instead of letting it pile up
    for (const f of s.fields) {
      if (f.region !== r || f.crop || f.spreading || f.soil.organic >= 0.7 || Math.max(f.soil.n, f.soil.p, f.soil.k) > 1.1) continue;
      if (s.regions[r].inventory.manure >= f.ha * CONFIG.manurePerHa) fertilizeField(s, f, 'manure');
    }
    if (P.autoFertilize) {
      for (const f of s.fields) {
        if (f.region !== r || f.crop || f.spreading || fertility(f) >= P.soilTarget) continue;
        // a competent manager never overdoses: skip if any nutrient would exceed the runoff threshold
        if (Math.max(f.soil.n, f.soil.p, f.soil.k) + CONFIG.fertilizerDose > 1.2 && !has(s, 'precisionFert')) {
          if (f.soil.organic < 0.7 && s.regions[r].inventory.manure >= f.ha * CONFIG.manurePerHa) fertilizeField(s, f, 'manure');
          continue;
        }
        const need = f.ha * CONFIG.fertilizerPerHa;
        const inv = s.regions[r].inventory;
        if (inv.fertilizer < need) {
          const q = quoteBuy(s, r, 'fertilizer', need - inv.fertilizer);
          if (q.net > spendable(s)) continue;
          executeBuy(s, r, 'fertilizer', need - inv.fertilizer, 'Manager bought fertiliser');
        }
        fertilizeField(s, f, 'fertilizer');
      }
    }
  }
}

/** Manager selling: storage over the cap → sell 25% of each good now; perishables are sold every hour as they are made
 *  (one daily dump crashed the price); at midday export surplus and sell anything priced well. Keeps contract stock and 3 days of animal feed. */
function sellRound(s: GameState, r: RegionId, midday: boolean) {
  const P = s.automation.policies;
  const st = stored(s, r);
  const full = st.cap.dry > 0 && st.dry / st.cap.dry > P.sellStorageCap;
  const coldSpill = st.coldOverflow > 1; // chilled goods out of the cold store rot fast: sell them every hour until they fit
  const feedKeep = s.herds.reduce((a, h) => a + (h.region === r ? h.count * ANIMALS[h.animal].feedPerDay * 3 : 0), 0);
  for (const g of GOOD_IDS) {
    const q = s.regions[r].inventory[g] - contractsNeed(s, r, g) - reservedStock(s, r, g) - (FEEDS.includes(g) ? feedKeep : 0);
    if (q < 1 || !s.markets[r][g] || GOODS[g].kind === 'input') continue;
    const perishable = GOODS[g].spoilProper > 0.02;
    // midday: send surplus to whichever region pays at least 10% more after freight and tariff, sold there on arrival
    if (midday && P.autoExport && s.era >= 6) {
      const home = priceUsd(s, r, g);
      const to = REGION_IDS.filter((x) => x !== r && s.regions[x].unlocked && s.markets[x][g] && !closedPort(s, r, x))
        .sort((a, b) => exportGain(s, g, r, b) - exportGain(s, g, r, a))[0];
      if (to && home > 0 && exportGain(s, g, r, to) > home * 0.1) {
        const moving = s.shipments.filter((x) => x.to === to && x.good === g).reduce((a, x) => a + x.qty, 0);
        const amount = Math.floor(Math.min(q * 0.5, marketDepth(s, to, g) * 3 - moving));
        if (amount >= 50 && !shipGoods(s, g, amount, r, to, autoBudget(s), true)) {
          log(s, 'info', `Manager exported ${amount.toLocaleString('en-US')} ${GOODS[g].name.toLowerCase()} to ${REGIONS[to].name}: it pays about ${Math.round((exportGain(s, g, r, to) / home) * 100)}% more there after freight.`, 'logistics');
          continue;
        }
      }
    }
    const good = s.markets[r][g]!.price >= P.sellDiscipline * avg30(s, r, g);
    if (perishable || full || (coldSpill && GOODS[g].storage === 'cold') || (midday && good)) executeSell(s, r, g, q * (perishable ? 1 : 0.25), undefined);
  }
}

const contractsNeed = (s: GameState, r: RegionId, g: GoodId) => s.contracts.filter((c) => c.accepted && c.region === r && c.good === g).reduce((a, c) => a + c.qty - c.delivered, 0);

export function policiesDaily(s: GameState) {
  const P = s.automation.policies;
  if (P.autoRepair > 0)
    for (const m of s.machines) if ((m.broken || m.condition < P.autoRepair) && serviceCost(s, m) < spendable(s)) service(s, m);
  if (P.debtCeiling > 0 && has(s, 'agAI')) {
    const ratio = debt(s) / Math.max(1, totalAssets(s));
    for (const l of s.loans) {
      if (ratio <= P.debtCeiling) break;
      const pay = Math.min(l.balance, spendable(s) * 0.5);
      if (pay <= 0) break;
      post(s, 'loanRepay', -pay, 'Early repayment (debt ceiling policy)', 'heartland', 'corporate');
      l.balance -= pay;
    }
    s.loans = s.loans.filter((l) => l.balance > 0.01);
  }
  if (P.hedgeRatio > 0 && execOn(s, 'trading')) hedge(s, P.hedgeRatio);
}

/** Trading head keeps a rolling short hedge against expected crop output for the next 30 days. */
function hedge(s: GameState, ratio: number) {
  for (const g of FUTURES_GOODS) {
    if (!CROPS[g as CropId]) continue;
    const c = g as CropId;
    const perDay = s.fields.reduce((a, f) => a + (f.plan === c ? (expectedYield(s, f, c) * 24) / CROPS[c].growthTicks : 0), 0);
    const want = -Math.floor((perDay * 30 * ratio) / CONTRACT_SIZE);
    const have = s.futures.filter((p) => p.good === g).reduce((a, p) => a + p.contracts, 0);
    if (want < have) openFutures(s, g, want - have, 30);
    else if (want > have) {
      const p = s.futures.find((x) => x.good === g && x.contracts < 0);
      if (p) closeFutures(s, p, futuresPrice(s, g, p.expiry));
    }
  }
}

export const DEFAULT_POLICIES = {
  cashReserve: 0, autoFertilize: false, soilTarget: 0.6, autoRepair: 0, autoRotate: false, supplyFactories: false, sellDiscipline: 0, sellStorageCap: 0.85, debtCeiling: 0, irrigateMin: 0.5, hedgeRatio: 0, autoFeed: true, autoExport: true,
};
export const clampPolicy = (v: number) => clamp(v, 0, 1e12);
void TICKS_PER_DAY;
void post;
