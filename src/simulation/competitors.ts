// AI companies. Their output is the market's competitor supply, so they compete with you
// for prices, react to margins, borrow, expand, fail and can be bought.
import { ARCHETYPES, COMPETITOR_SEEDS, CROPS, DAYS_PER_YEAR, GOODS, REGIONS, REGION_IDS, type CropId, type GoodId } from './config';
import { clamp, landPricePerHa, log, marketWage, nextId, post, random, refPrice, seedCost } from './core';
import { avg30 } from './markets';
import { newField } from './agriculture';
import type { Competitor, GameState } from './types';

export function createCompetitors(s: GameState): Competitor[] {
  return COMPETITOR_SEEDS.map((c) => {
    const crops = (Object.keys(REGIONS[c.region].suitability) as CropId[]).filter((x) => (REGIONS[c.region].suitability[x] ?? 0) >= 0.6);
    const mix = Object.fromEntries(crops.map((x) => [x, 1 / crops.length]));
    const land = c.ha * REGIONS[c.region].landPrice;
    const lev = ARCHETYPES[c.archetype].leverage;
    return {
      id: nextId(s), name: c.name, archetype: c.archetype, region: c.region, ha: c.ha, mix, mech: ARCHETYPES[c.archetype].mech,
      cash: land * 0.08, debt: land * lev * 0.6, hiddenDebt: land * (0.02 + random(s) * 0.25) * (c.archetype === 'speculator' ? 2 : 1),
      stock: {}, status: 'active', revenue30: 0, profit30: 0, diligence: 'none', diligenceDone: 0, share: 0,
    } satisfies Competitor;
  });
}

const yieldPerHaDay = (s: GameState, c: Competitor, crop: CropId) =>
  (10 * CROPS[crop].yieldPerSeed * (REGIONS[c.region].suitability[crop] ?? 0) * (0.85 + 0.25 * c.mech) * weather(s, c)) / (CROPS[crop].growthTicks / 24);
const weather = (s: GameState, c: Competitor) => clamp(0.55 + 0.45 * Math.min(1.2, s.regions[c.region].rain30 / REGIONS[c.region].rain), 0.4, 1.1);

export function competitorsDaily(s: GameState) {
  for (const r of REGION_IDS) for (const g in s.markets[r]) s.markets[r][g as GoodId]!.comp = 0;
  for (const c of s.competitors) {
    if (c.status === 'acquired' || c.status === 'bankrupt') continue;
    const A = ARCHETYPES[c.archetype];
    let revenue = 0;
    const margins: Partial<Record<CropId, number>> = {};
    for (const crop in c.mix) {
      const cr = crop as CropId;
      const share = c.mix[cr]!;
      const perHa = yieldPerHaDay(s, c, cr);
      const units = c.ha * share * perHa;
      const m = s.markets[c.region][cr]!;
      m.comp += units / 24;
      const price = m.price;
      revenue += units * price * 0.95;
      margins[cr] = perHa * price - (10 * seedCost(s, cr)) / (CROPS[cr].growthTicks / 24);
    }
    // Costs scale with output at reference prices, indexed to the real input prices everyone faces.
    const refRev = Object.entries(c.mix).reduce((a, [cr, sh]) => a + c.ha * sh! * yieldPerHaDay(s, c, cr as CropId) * refPrice(s, cr as CropId), 0);
    const wageIdx = marketWage(s, c.region) / (REGIONS[c.region].wage * REGIONS[c.region].fx0 * s.macro.cpi);
    const energy = s.macro.energy;
    const costShare = 0.4 * wageIdx * (1 - 0.6 * c.mech) + 0.18 * energy * c.mech + 0.13 * energy ** 0.8 + 0.12 + 0.2; // labour, fuel, fertiliser, seed, land rent & overhead
    const interest = (c.debt * (s.macro.baseRate + 0.04)) / DAYS_PER_YEAR;
    const profit = revenue - refRev * costShare - interest;
    c.cash += profit;
    c.revenue30 = c.revenue30 * (29 / 30) + revenue;
    c.profit30 = c.profit30 * (29 / 30) + profit;
    // Supply response: shift land toward the crops that pay best right now.
    const best = (Object.keys(margins) as CropId[]).sort((a, b) => margins[b]! - margins[a]!)[0];
    if (best) {
      for (const cr in c.mix) c.mix[cr as CropId] = c.mix[cr as CropId]! * 0.97;
      c.mix[best] = c.mix[best]! + 0.03;
    }
    // Speculators hoard when cheap and dump when dear, moving market inventory.
    if (c.archetype === 'speculator') speculate(s, c);
    // Finance & expansion
    const landVal = c.ha * landPricePerHa(s, c.region);
    const assets = landVal + c.cash + stockValue(s, c);
    if (c.cash < 0) {
      c.debt += -c.cash;
      c.cash = 0;
    }
    const lev = c.debt / Math.max(1, assets);
    if (c.status === 'active' && c.profit30 > 0 && c.cash > landVal * 0.05 && lev < A.leverage && random(s) < 0.5) {
      const add = c.ha * A.expandRate * (1 + random(s));
      const cost = add * landPricePerHa(s, c.region);
      const fromCash = Math.min(c.cash, cost * (1 - A.leverage));
      c.cash -= fromCash;
      c.debt += cost - fromCash;
      c.ha += add;
    }
    if (lev > Math.max(0.85, A.leverage + 0.3)) {
      if (c.status !== 'distressed') log(s, 'opportunity', `${c.name} is in financial distress and selling land. It may be a cheap acquisition.`, 'competitors');
      c.status = 'distressed';
      const sell = c.ha * 0.03;
      c.ha -= sell;
      c.debt = Math.max(0, c.debt - sell * landPricePerHa(s, c.region) * 0.8);
    } else if (c.status === 'distressed' && lev < 0.6) c.status = 'active';
    if (assets - c.debt - c.hiddenDebt < 0 || c.ha < 10) {
      c.status = 'bankrupt';
      log(s, 'warning', `${c.name} has gone bankrupt. Its production has left the market.`, 'competitors');
    }
  }
  // share of regional consumption of the crops each competitor grows
  for (const c of s.competitors) {
    if (c.status === 'acquired' || c.status === 'bankrupt') { c.share = 0; continue; }
    let out = 0, demand = 0;
    for (const cr in c.mix) {
      out += c.ha * c.mix[cr as CropId]! * yieldPerHaDay(s, c, cr as CropId);
      demand += s.markets[c.region][cr as CropId]!.d0 * 24;
    }
    c.share = demand ? Math.min(1, out / demand) : 0;
  }
}

function speculate(s: GameState, c: Competitor) {
  for (const g of ['wheat', 'corn', 'soybeans'] as GoodId[]) {
    const m = s.markets[c.region][g]!;
    const a = avg30(s, c.region, g);
    const held = c.stock[g] ?? 0;
    if (m.price < a * 0.93 && c.cash > 0) {
      const q = Math.min(m.inv * 0.03, c.cash / m.price);
      m.inv -= q;
      c.cash -= q * m.price;
      c.stock[g] = held + q;
    } else if (m.price > a * 1.07 && held > 0) {
      const q = held * 0.3;
      m.inv += q;
      c.cash += q * m.price;
      c.stock[g] = held - q;
    }
  }
}

const stockValue = (s: GameState, c: Competitor) => Object.entries(c.stock).reduce((a, [g, q]) => a + q! * s.markets[c.region][g as GoodId]!.price, 0);

export function valuation(s: GameState, c: Competitor) {
  const assets = c.ha * landPricePerHa(s, c.region) + c.cash + stockValue(s, c);
  const equity = assets - c.debt;
  const earnings = Math.max(0, c.profit30 * 4);
  return Math.max(assets * 0.15, equity + earnings * 4) * (c.status === 'distressed' ? 0.75 : c.status === 'bankrupt' ? 0.5 : 1);
}
/** Asking price: control premium, plus hidden liabilities the seller knows about. */
export const askingPrice = (s: GameState, c: Competitor) => valuation(s, c) * (c.status === 'active' ? 1.25 : 1);
/** Cash price. After due diligence the hidden liabilities come off the price (you still assume them as debt); never below $1. */
export const acquisitionPrice = (s: GameState, c: Competitor) => Math.max(1, askingPrice(s, c) - (c.diligence === 'done' ? c.hiddenDebt : 0));
export const diligenceCost = (s: GameState, c: Competitor) => Math.max(5000, valuation(s, c) * 0.015);

export function acquire(s: GameState, c: Competitor) {
  const price = acquisitionPrice(s, c);
  const integration = Math.max(5000, askingPrice(s, c) * 0.05);
  post(s, 'acquisition', -price, `Acquired ${c.name}`, c.region, 'corporate');
  post(s, 'legal', -integration, `Integration costs: ${c.name}`, c.region, 'corporate');
  const debt = c.debt + c.hiddenDebt;
  if (debt > 0) {
    s.loans.push({ id: nextId(s), principal: debt, balance: debt, spread: 0.05, termDays: 240, daysLeft: 240, missed: 0, taken: s.tick });
    if (c.diligence !== 'done' && c.hiddenDebt > 0) log(s, 'critical', `Surprise: ${c.name} carried $${Math.round(c.hiddenDebt).toLocaleString()} of undisclosed liabilities. Due diligence would have caught it.`, 'corporation');
  }
  s.regions[c.region].unlocked = true;
  const ha = Math.max(5, Math.round(c.ha));
  for (const size of [Math.round(ha * 0.5), Math.round(ha * 0.3), ha - Math.round(ha * 0.5) - Math.round(ha * 0.3)]) {
    if (size <= 0) continue;
    const f = newField(s, c.region, size, (price * size) / ha);
    s.fields.push(f);
  }
  for (const [g, q] of Object.entries(c.stock)) s.regions[c.region].inventory[g as GoodId] += q!;
  c.status = 'acquired';
  c.ha = 0;
  log(s, 'opportunity', `${c.name} is now part of your company: ${ha} ha in ${REGIONS[c.region].name}. Staff and equip it to bring it into production.`, 'fields');
}

export const competitorRef = (s: GameState, g: GoodId) => refPrice(s, g);
void GOODS;
