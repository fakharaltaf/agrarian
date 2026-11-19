// Banking, hedging, contracts, insurance and tax. All flows go through the ledger.
import { CROPS, DAYS_PER_YEAR, GOODS, MACHINES, REGIONS, REGION_IDS, TICKS_PER_DAY, type CropId, type GoodId, type RegionId } from './config';
import { avgPrice, executeSell, haulCost } from './markets';
import { clamp, day, debt, fixedAssets, inventoryValue, log, nextId, pick, post, random, round2, sumBooks, totalAssets } from './core';
import { warnOnce } from './agriculture';
import type { FuturesPosition, GameState, SupplyContract } from './types';
import { featureEra } from './stages';

export const FUTURES_GOODS: GoodId[] = ['wheat', 'corn', 'soybeans', 'rice', 'sugar', 'cotton', 'coffee', 'fuel', 'fertilizer'];
export const CONTRACT_SIZE = 100;

// ---------------------------------------------------------------- credit

export function creditSpread(s: GameState) {
  const ta = Math.max(1, totalAssets(s));
  return 0.03 + 0.08 * clamp(debt(s) / ta, 0, 1) + (50 - s.corp.reputation) * 0.0004 + s.macro.crunch * 0.6;
}
export const loanRate = (s: GameState, spread: number) => s.macro.baseRate + spread;

/** Banks lend against collateral: land, machinery, buildings and part of inventory. */
export function creditLimit(s: GameState) {
  const fa = fixedAssets(s);
  const collateral = 0.6 * fa.land + 0.5 * fa.machines + 0.4 * fa.buildings + 0.3 * inventoryValue(s);
  const income = Math.max(0, sumBooks(s, 30)) * 2; // some cash-flow lending
  const outstanding = s.loans.reduce((a, l) => a + l.balance, 0);
  return Math.max(0, (collateral + income) * (1 - s.macro.crunch * 5) - outstanding);
}

export const overdraftLimit = (s: GameState) => Math.max(500, 0.08 * totalAssets(s));

export function takeLoan(s: GameState, amount: number, termDays: number) {
  const spread = creditSpread(s) + (termDays > 120 ? 0.01 : 0);
  s.loans.push({ id: nextId(s), principal: amount, balance: amount, spread, termDays, daysLeft: termDays, missed: 0, taken: s.tick });
  post(s, 'loanIn', amount, `Loan: ${termDays}-day term`, 'heartland', 'corporate');
}

export function financeDaily(s: GameState) {
  // loans: variable rate, daily interest + straight-line principal
  for (const l of [...s.loans]) {
    const rate = loanRate(s, l.spread);
    const interest = (l.balance * rate) / DAYS_PER_YEAR;
    const principal = l.daysLeft > 0 ? l.balance / l.daysLeft : l.balance;
    if (s.cash + overdraftLimit(s) < interest + principal) {
      l.missed++;
      l.balance += interest * 1.5; // unpaid interest capitalises with a penalty
      warnOnce(s, `missed-${l.id}`, 'critical', `Missed a loan payment (${l.missed}/5). Raise cash or restructure before the bank calls the loan.`, 'finance', 1);
      s.corp.reputation = clamp(s.corp.reputation - 1, 0, 100);
      if (l.missed >= 5) s.bankrupt = { reason: 'Five missed loan payments: the bank has called in your loans.' };
      continue;
    }
    post(s, 'interest', -interest, 'Loan interest', 'heartland', 'corporate');
    post(s, 'loanRepay', -principal, 'Loan principal', 'heartland', 'corporate');
    l.balance = round2(l.balance - principal);
    l.daysLeft--;
    if (l.balance <= 0.01) s.loans.splice(s.loans.indexOf(l), 1);
  }
  // overdraft: negative cash accrues interest; persistent breach of the limit is insolvency
  if (s.cash < 0) post(s, 'interest', (s.cash * (s.macro.baseRate + 0.12)) / DAYS_PER_YEAR, 'Overdraft interest', 'heartland', 'corporate');
  if (s.cash < -overdraftLimit(s)) {
    s.overdraftDays++;
    warnOnce(s, 'overdraft', 'critical', `Your overdraft is over its $${Math.round(overdraftLimit(s))} limit (day ${s.overdraftDays}/3). Sell assets or inventory now.`, 'finance', 1);
    if (s.overdraftDays >= 3) s.bankrupt = { reason: 'Your overdraft stayed above its limit for three days.' };
  } else s.overdraftDays = 0;

  // Reputation heals slowly toward neutral when nothing new goes wrong.
  s.corp.reputation = clamp(s.corp.reputation + (50 - s.corp.reputation) * 0.01, 0, 100);
  insuranceDaily(s);
  futuresDaily(s);
  contractsDaily(s);
}

// ---------------------------------------------------------------- insurance

export function insurancePremium(s: GameState, r: RegionId) {
  const ha = s.fields.reduce((a, f) => a + (f.region === r ? f.ha : 0), 0);
  const risk = 0.6 + (0.55 - Math.min(0.55, REGIONS[r].rain)) * 2 + s.macro.climate * 0.1 + (1 - REGIONS[r].stability);
  return ha * 0.9 * risk * s.macro.cpi;
}
function insuranceDaily(s: GameState) {
  for (const r of REGION_IDS) if (s.regions[r].insured) post(s, 'insurance', -insurancePremium(s, r), 'Crop insurance premium', r);
}

// ---------------------------------------------------------------- futures

/** Futures trade at spot plus storage carry. Cash-settled; marked to market daily. */
export const futuresPrice = (s: GameState, g: GoodId, expiry: number) => (s.bench[g] ?? avgPrice(s, g)) * (1 + 0.04 * Math.max(0, expiry - s.tick) / (DAYS_PER_YEAR * TICKS_PER_DAY));
/** Exchange position limit: 5% of a month of world consumption. */
export const positionLimit = (s: GameState, g: GoodId) => Math.max(10, Math.floor((REGION_IDS.reduce((a, r) => a + (s.markets[r][g]?.d0 ?? 0), 0) * 24 * 30 * 0.05) / CONTRACT_SIZE));
export const initialMargin = (s: GameState, g: GoodId, contracts: number, expiry: number) => Math.abs(contracts) * CONTRACT_SIZE * futuresPrice(s, g, expiry) * 0.12;

export function openFutures(s: GameState, g: GoodId, contracts: number, days: number): string | null {
  const expiry = s.tick + days * TICKS_PER_DAY;
  const held = s.futures.filter((p) => p.good === g).reduce((a, p) => a + p.contracts, 0);
  if (Math.abs(held + contracts) > positionLimit(s, g)) return `Exchange position limit for ${GOODS[g].name} is ${positionLimit(s, g)} contracts.`;
  const margin = initialMargin(s, g, contracts, expiry);
  if (margin > s.cash) return `Initial margin of $${Math.round(margin)} exceeds your cash.`;
  const price = futuresPrice(s, g, expiry);
  post(s, 'margin', -margin, `Margin: ${contracts > 0 ? 'long' : 'short'} ${Math.abs(contracts)} ${GOODS[g].name}`, 'heartland', 'trading');
  s.marginAccount += margin;
  s.futures.push({ id: nextId(s), good: g, contracts, entry: price, mark: price, expiry, margin });
  return null;
}

export function closeFutures(s: GameState, p: FuturesPosition, settle = futuresPrice(s, p.good, p.expiry)) {
  const pnl = p.contracts * CONTRACT_SIZE * (settle - p.mark);
  post(s, 'futures', pnl, `Futures settlement ${GOODS[p.good].name}`, 'heartland', 'trading');
  post(s, 'margin', p.margin, 'Margin returned', 'heartland', 'trading');
  s.marginAccount -= p.margin;
  s.futures.splice(s.futures.indexOf(p), 1);
  return pnl;
}

function futuresDaily(s: GameState) {
  for (const p of [...s.futures]) {
    if (s.tick >= p.expiry) {
      const pnl = closeFutures(s, p, s.bench[p.good] ?? avgPrice(s, p.good));
      log(s, 'info', `${GOODS[p.good].name} futures expired: ${pnl >= 0 ? 'gain' : 'loss'} of $${Math.abs(Math.round(pnl)).toLocaleString()}.`, 'markets');
      continue;
    }
    const f = futuresPrice(s, p.good, p.expiry);
    const vm = p.contracts * CONTRACT_SIZE * (f - p.mark);
    post(s, 'futures', vm, `Daily settlement ${GOODS[p.good].name}`, 'heartland', 'trading');
    p.mark = f;
    if (s.cash < -overdraftLimit(s) * 0.5) {
      closeFutures(s, p, f);
      log(s, 'critical', `Margin call: your ${GOODS[p.good].name} futures position was liquidated.`, 'markets');
    }
  }
}

// ---------------------------------------------------------------- supply contracts

const BUYERS = ['Harvest Table Grocers', 'Northline Mills', 'City Schools Board', 'Ministry of Food Reserves', 'Bluewater Foods', 'Grand Market Co-op', 'Granary Export Ltd', 'Sunrise Bakeries'];

function contractsDaily(s: GameState) {
  // offers arrive every few days, scaled to what you actually produce
  if (featureEra(s, 5) && day(s) % 3 === 0 && s.contracts.filter((c) => !c.accepted).length < 5) {
    const regions = REGION_IDS.filter((r) => s.regions[r].unlocked);
    const produced = Object.entries(s.stats.produced).filter(([, q]) => q! > 0).map(([g]) => g as GoodId).filter((g) => GOODS[g].tradeable);
    if (produced.length) {
      const g = pick(s, produced);
      const r = pick(s, regions);
      const weekly = Math.max(50, recentOutput(s, g) * 7);
      const govt = random(s) < 0.25;
      const premium = govt ? random(s) * 0.03 : 0.02 + random(s) * 0.06 + (s.corp.reputation - 50) / 1000;
      const premiumBuyer = !govt && s.discovered.includes('quality') && GOODS[g].kind !== 'input' && random(s) < 0.3;
      const price = s.markets[r][g]!.price * (1 + premium + (premiumBuyer ? 0.08 : 0));
      const qty = Math.round(weekly * (0.3 + random(s) * (govt ? 1.5 : 0.8)));
      s.contracts.push({
        id: nextId(s), buyer: govt ? 'Ministry of Food Reserves' : pick(s, BUYERS), region: r, good: g, qty, delivered: 0,
        price: round2(price), deadline: s.tick + (10 + Math.floor(random(s) * 20)) * TICKS_PER_DAY, penalty: round2(price * (govt ? 0.5 : 0.3)),
        expires: s.tick + 4 * TICKS_PER_DAY, accepted: false, ...(premiumBuyer ? { minQuality: 0.8 } : {}),
      });
    }
  }
  for (const c of [...s.contracts]) {
    if (!c.accepted && s.tick >= c.expires) s.contracts.splice(s.contracts.indexOf(c), 1);
    else if (c.accepted && s.tick < c.deadline) deliver(s, c); // ship what is in store each day, not all on the last one
    else if (c.accepted && s.tick >= c.deadline) {
      deliver(s, c);
      const short = c.qty - c.delivered;
      if (short > 0) {
        post(s, 'fines', -short * c.penalty, `Contract shortfall: ${c.buyer}`, c.region, 'trading');
        s.corp.reputation = clamp(s.corp.reputation - 2, 0, 100);
        log(s, 'warning', `Missed ${Math.round(short)} ${GOODS[c.good].name.toLowerCase()} on a contract with ${c.buyer}: $${Math.round(short * c.penalty).toLocaleString()} penalty.`, 'markets');
      } else {
        s.corp.reputation = clamp(s.corp.reputation + 0.5, 0, 100);
        log(s, 'info', `Contract with ${c.buyer} fulfilled.`, 'markets');
      }
      s.contracts.splice(s.contracts.indexOf(c), 1);
    }
  }
}

function recentOutput(s: GameState, g: GoodId) {
  // what the farm has really produced per day over its life (labour, weather and selling all included), never more than plans could grow
  const fromFields = s.fields.reduce((a, f) => a + (f.plan === g || f.crop === g ? (f.ha * 10 * (CROPS[g as CropId]?.yieldPerSeed ?? 0)) / ((CROPS[g as CropId]?.growthTicks ?? 24) / 24) : 0), 0);
  const actual = (s.stats.produced[g] ?? 0) / Math.max(1, day(s));
  return Math.max(30, fromFields ? Math.min(fromFields, actual * 1.5) : actual);
}

/** Delivers what the contract's region has in stock; deliveries use haulage like a sale. */
export function deliver(s: GameState, c: SupplyContract) {
  const inv = s.regions[c.region].inventory;
  if (c.minQuality && (s.regions[c.region].quality[c.good] ?? 0.65) < c.minQuality) return 0; // premium buyer refuses lower grades
  const q = Math.min(inv[c.good], c.qty - c.delivered);
  if (q <= 0) return 0;
  const sent = Math.min(q, haulCost(s, c.region, q).possible);
  if (sent <= 0) return 0;
  const h = haulCost(s, c.region, sent);
  inv[c.good] -= sent;
  c.delivered += sent;
  s.regions[c.region].truckToday += h.viaTruck;
  s.regions[c.region].haulToday += h.viaHired;
  post(s, 'contract', sent * c.price, `Contract delivery to ${c.buyer}`, c.region, 'trading');
  post(s, 'haulage', -h.cost, 'Contract haulage', c.region);
  s.stats.peopleFed += (sent * GOODS[c.good].kcal) / (2000 * 365);
  return sent;
}

// No profit tax: the farm starts from scratch with no government to pay.

// ---------------------------------------------------------------- distress

/**
 * Restructuring: inventory is liquidated, staff cut to what the remaining land needs, and debt
 * consolidated into one 360-day loan. Fixed assets are fire-sold only until what is owed fits
 * within what the bank will lend against the assets that remain.
 */
export function restructure(s: GameState) {
  for (const p of [...s.futures]) closeFutures(s, p);
  for (const r of REGION_IDS) for (const g in s.regions[r].inventory) {
    const q = s.regions[r].inventory[g as GoodId];
    if (q > 1 && s.markets[r][g as GoodId]) executeSell(s, r, g as GoodId, q, 'Liquidation sale', 'sale', true);
  }
  const owed = () => s.loans.reduce((a, l) => a + l.balance, 0) - s.cash; // positive cash counts against debt
  const lendable = () => { const fa = fixedAssets(s); return 0.6 * fa.land + 0.5 * fa.machines + 0.4 * fa.buildings; };
  const sales: (() => void)[] = [
    ...[...s.machines].sort((a, b) => b.cost - a.cost).map((m) => () => {
      if (!m.leased) post(s, 'assetSale', Math.max(0, m.cost - m.depreciated) * 0.5, `Liquidated ${MACHINES[m.type].name}`, m.region);
      s.machines.splice(s.machines.indexOf(m), 1);
    }),
    ...[...s.buildings].sort((a, b) => b.cost - a.cost).map((b) => () => {
      post(s, 'assetSale', Math.max(0, b.cost - b.depreciated) * 0.4, 'Liquidated building', b.region);
      s.buildings.splice(s.buildings.indexOf(b), 1);
    }),
    ...[...s.fields].sort((a, b) => b.ha - a.ha).map((f) => () => {
      if (s.fields.length <= 1) return;
      post(s, 'assetSale', f.cost * 0.6, `Liquidated field ${f.id}`, f.region);
      s.fields.splice(s.fields.indexOf(f), 1);
    }),
  ];
  for (const sell of sales) {
    if (owed() <= lendable() + 1000) break;
    sell();
  }
  // Downsizing: keep one hand per 3 ha and one manager per region that still has land.
  const ha = (r: RegionId) => s.fields.reduce((a, f) => a + (f.region === r ? f.ha : 0), 0);
  for (const r of REGION_IDS) {
    const hands = s.workers.filter((w) => w.region === r && w.role === 'hand');
    const keep = Math.ceil(ha(r) / 3);
    for (const w of hands.slice(keep)) s.workers.splice(s.workers.indexOf(w), 1);
    const mgrs = s.workers.filter((w) => w.region === r && w.role === 'manager');
    for (const w of mgrs.slice(ha(r) >= 20 ? 1 : 0)) s.workers.splice(s.workers.indexOf(w), 1);
  }
  // Spare cash pays loans down first; any overdraft becomes part of the new loan.
  const loans = s.loans.reduce((a, l) => a + l.balance, 0);
  const paydown = Math.min(loans, Math.max(0, s.cash - 2000));
  if (paydown > 0) post(s, 'loanRepay', -paydown, 'Restructuring paydown', 'heartland', 'corporate');
  const overdraft = Math.max(0, -s.cash);
  if (overdraft > 0) post(s, 'loanIn', overdraft, 'Overdraft converted to restructured loan', 'heartland', 'corporate');
  const owedNow = round2(loans - paydown + overdraft);
  s.loans = owedNow > 0 ? [{ id: nextId(s), principal: owedNow, balance: owedNow, spread: 0.08, termDays: 360, daysLeft: 360, missed: 0, taken: s.tick }] : [];
  s.corp.reputation = clamp(s.corp.reputation - 25, 0, 100);
  s.overdraftDays = 0;
  s.bankrupt = null;
  log(s, 'critical', 'Restructured: stock sold, staff cut, assets sold only as far as the bank required, and all debt consolidated into one 360-day loan.', 'finance');
}
