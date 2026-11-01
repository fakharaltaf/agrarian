// Levels 3–5 of automation: managers run field cycles, rules react to conditions,
// policies steer everything toward strategic objectives. Automation spends real money
// through the same primitives as the player, and never below the cash reserve.
import { BUILDINGS, CONFIG, CROPS, GOODS, REGIONS, REGION_IDS, TICKS_PER_DAY, type CropId, type GoodId, type RegionId } from './config';
import { canGrow, expectedYield, fertility, fertilizeField, soilAdequacy } from './agriculture';
import { buildingsIn, clamp, debt, execOn, has, hour, nextId, post, seasonOf, seedCost, stored, totalAssets } from './core';
import { avg30, executeBuy, executeSell, forecast, quoteBuy } from './markets';
import { CONTRACT_SIZE, FUTURES_GOODS, openFutures, futuresPrice, closeFutures } from './finance';
import { serviceCost, service } from './operations';
import { buildingMargin } from './processing';
import { shipGoods } from './logistics';
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
      const q = Math.floor(inv[r.actionGood] * (r.amountPct / 100));
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
      for (const f of s.fields) if (f.region === r.region && !f.crop && fertility(f) < 0.6 && !fertilizeField(s, f, 'fertilizer')) n++;
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
      const fs = s.fields.filter((f) => f.region === r.region && f.plan !== c && canGrow(f, c));
      fs.forEach((f) => (f.plan = c));
      return fs.length ? `planned ${GOODS[c].name} on ${fs.length} field(s)` : null;
    }
  }
}

export function newRule(s: GameState, rule: Omit<Rule, 'id' | 'lastRun' | 'history'>): Rule {
  return { ...rule, id: nextId(s), lastRun: -1e9, history: [] }; // finite so it survives JSON saves
}

// ---------------------------------------------------------------- managers & policies

/** Expected profit per hour per ha of a crop on this field at today's prices. */
export function cropScore(s: GameState, f: import('./types').Field, c: CropId) {
  const y = expectedYield(s, f, c) / f.ha;
  const price = s.markets[f.region][c]!.price;
  const seed = CONFIG.seedsPerHa * seedCost(s, c);
  return (y * price - seed) / CROPS[c].growthTicks;
}

/** Tender crop, outdoors, in a region whose coming days (or season) bring frost. */
export function frostRisk(s: GameState, f: import('./types').Field, c: CropId) {
  if (CROPS[c].frostHardy || f.greenhouse) return false;
  const season = seasonOf(s);
  return season === 'Winter' || (season === 'Autumn' && forecast(s, f.region).some((d) => d.frost));
}

export function chooseCrop(s: GameState, f: import('./types').Field): CropId | null {
  const smart = has(s, 'agAI');
  let best: CropId | null = null, bestV = -Infinity;
  for (const c of s.unlockedCrops) {
    if (!canGrow(f, c)) continue;
    let v = cropScore(s, f, c);
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
  if (P.autoRotate) for (const f of s.fields) if (!f.crop && f.work === 0 && hasManager(s, f.region)) f.plan = chooseCrop(s, f) ?? f.plan;
  if (h !== 12) return;
  // Midday rounds: fertiliser and selling discipline.
  for (const r of REGION_IDS) {
    if (!hasManager(s, r)) continue;
    if (P.autoFertilize) {
      for (const f of s.fields) {
        if (f.region !== r || f.crop || fertility(f) >= P.soilTarget) continue;
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
    if (P.sellDiscipline > 0) {
      const st = stored(s, r);
      const full = st.cap.dry > 0 && st.dry / st.cap.dry > P.sellStorageCap;
      for (const g in s.regions[r].inventory) {
        const q = s.regions[r].inventory[g as GoodId];
        if (q < 1 || !s.markets[r][g as GoodId] || GOODS[g as GoodId].kind === 'input') continue;
        if (contractsNeed(s, r, g as GoodId) >= q) continue;
        const perishable = GOODS[g as GoodId].spoilProper > 0.02;
        const good = s.markets[r][g as GoodId]!.price >= P.sellDiscipline * avg30(s, r, g as GoodId);
        if (perishable || good || full) executeSell(s, r, g as GoodId, Math.max(0, q - contractsNeed(s, r, g as GoodId)) * (perishable ? 1 : 0.25), undefined);
      }
    }
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
  cashReserve: 0, autoFertilize: false, soilTarget: 0.6, autoRepair: 0, autoRotate: false, sellDiscipline: 0, sellStorageCap: 0.85, debtCeiling: 0, irrigateMin: 0.5, hedgeRatio: 0, autoFeed: true,
};
export const clampPolicy = (v: number) => clamp(v, 0, 1e12);
void TICKS_PER_DAY;
void post;
