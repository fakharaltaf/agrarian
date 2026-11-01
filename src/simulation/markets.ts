// Regional commodity markets. Price is a function of market-held inventory:
//   price = ref × (target / inventory)^γ × e^sentiment
// Inventory moves with supply (background + competitors, weather, seasons, input costs)
// minus demand (elastic in price, income, substitutes). Player trades move inventory,
// so price impact and its slow recovery fall out of the same model.
import {
  CONFIG, CROPS, DAYS_PER_YEAR, GOODS, GRAINS, REGIONS, REGION_IDS, SAME_COUNTRY, TICKS_PER_DAY, TICKS_PER_YEAR, TRADEABLE,
  distance, type CropId, type GoodId, type RegionId,
} from './config';
import { activeEvents, buildingsIn, clamp, day, fuelPrice, gauss, has, hour, log, post, random, refPrice, round2, severity } from './core';
import { qualityMult } from './agriculture';
import type { GameState, Market } from './types';

const gamma = (g: GoodId) => clamp(0.3 / GOODS[g].elasticity, 0.4, 1.2);
const minInv = (m: Market) => m.target * 0.25;
const maxInv = (m: Market) => m.target * 4;

export function priceFromInv(s: GameState, g: GoodId, m: Market, inv = m.inv, impact = m.impact) {
  const p = refPrice(s, g) * (m.target / Math.max(inv, minInv(m))) ** gamma(g) * Math.exp(m.sent - clamp(impact, -MAX_IMPACT, MAX_IMPACT));
  return clamp(p, refPrice(s, g) * FLOOR, refPrice(s, g) * 4);
}
const depth = (m: Market) => m.d0 * CONFIG.marketDepth;

export function createMarkets(): GameState['markets'] {
  const out = {} as GameState['markets'];
  for (const r of REGION_IDS) {
    out[r] = {};
    for (const g of TRADEABLE) {
      const def = GOODS[g];
      const d0 = def.demand * CONFIG.demandScale * REGIONS[r].population;
      let share = 1;
      if (def.kind === 'crop') {
        // Local farms supply in proportion to how well the crop grows here; the rest is imported by traders.
        const suit = REGIONS[r].suitability[g as CropId] ?? 0;
        const avg = REGION_IDS.reduce((a, x) => a + (REGIONS[x].suitability[g as CropId] ?? 0) * REGIONS[x].population, 0) / REGION_IDS.reduce((a, x) => a + REGIONS[x].population, 0);
        share = suit > 0 && avg > 0 ? clamp(0.85 + 0.3 * (suit / avg - 1), 0.7, 1.2) : 0.15;
      }
      if (def.kind === 'processed') share = r === 'coastal' ? 1.1 : 0.95;
      const target = d0 * CONFIG.marketBuffer;
      out[r][g] = { price: def.basePrice, inv: target, target, d0, bg0: d0 * share, bg: d0 * share, comp: 0, sent: 0, impact: 0, history: [def.basePrice], daily: [def.basePrice], demandToday: 0, playerSold: 0, totalSold: d0 * 720 };
    }
  }
  return out;
}

// ---------------------------------------------------------------- per tick

export function marketsTick(s: GameState) {
  const t = s.tick;
  const yearPhase = (2 * Math.PI * (t % TICKS_PER_YEAR)) / TICKS_PER_YEAR;
  const grainRel = Object.fromEntries(GRAINS.map((g) => [g, avgPrice(s, g) / refPrice(s, g)])) as Record<string, number>;
  const grainAvg = GRAINS.reduce((a, g) => a + grainRel[g], 0) / GRAINS.length;

  for (const r of REGION_IDS) {
    const reg = s.regions[r];
    for (const g of TRADEABLE) {
      const m = s.markets[r][g]!;
      const def = GOODS[g];
      const ref = refPrice(s, g);
      // ---- demand
      let demand = m.d0 * s.macro.income ** def.incomeElasticity * (m.price / ref) ** -def.elasticity;
      if (GRAINS.includes(g)) demand *= (grainRel[g] / grainAvg) ** -0.6; // substitution between grains
      if (g === 'fuel' || g === 'fertilizer') demand = m.d0 * (m.price / ref) ** -def.elasticity;
      demand *= 1 + 0.8 * severity(s, 'demandSurge', r, g);
      // ---- supply
      let supply = m.bg + m.comp;
      if (def.kind === 'crop') {
        supply *= 1 + 0.06 * Math.sin(yearPhase - 1.2); // harvest season glut, spring scarcity
        supply *= weatherSupply(s, r);
        supply *= 1 - 0.35 * severity(s, 'pests', r, g);
        supply *= 1 - 0.6 * severity(s, 'cropFailureAbroad', r);
        supply *= 1 - 0.3 * severity(s, 'foodCrisis');
      }
      // NPC stockholders absorb gluts and release stock in shortages, damping (not removing) swings.
      const stockFlow = 0.002 * (m.target - m.inv);
      m.inv = clamp(m.inv + supply - demand + stockFlow, minInv(m), maxInv(m));
      m.demandToday += demand;
      m.totalSold = m.totalSold * (1 - 1 / 720) + demand;
      m.playerSold *= 1 - 1 / 720;
      m.sent = m.sent * 0.97 + 0.004 * gauss(s) / REGIONS[r].stability;
      m.impact *= CONFIG.impactDecay;
      m.price = priceFromInv(s, g, m);
      if (t % CONFIG.priceHistoryEvery === 0) push(m.history, round2(m.price), CONFIG.priceHistoryLength);
    }
    void reg;
  }
  if (t % 3 === 0) arbitrage(s);
  // 24-hour average benchmark: futures settle on it, so a burst of selling cannot move settlement much.
  for (const g of TRADEABLE) {
    const p = avgPrice(s, g);
    s.bench[g] = s.bench[g] === undefined ? p : s.bench[g]! + (p - s.bench[g]!) / 24;
  }
}

function weatherSupply(s: GameState, r: RegionId) {
  const rain = s.regions[r].rain30 / REGIONS[r].rain;
  return clamp(0.55 + 0.45 * Math.min(rain, 1.25), 0.4, 1.12) * (1 - 0.5 * severity(s, 'drought', r)) * (1 - 0.3 * severity(s, 'flood', r));
}

const push = (a: number[], v: number, n: number) => {
  a.push(v);
  if (a.length > n) a.shift();
};

/** NPC traders move goods from cheap to dear regions when the gap beats freight + tariff. */
function arbitrage(s: GameState) {
  for (const g of TRADEABLE) {
    for (const a of REGION_IDS)
      for (const b of REGION_IDS) {
        if (a === b) continue;
        const ma = s.markets[a][g]!, mb = s.markets[b][g]!;
        const cost = freightPerUnit(s, a, b, false) + tariffRate(s, a, b) * ma.price;
        const gap = mb.price - ma.price - cost;
        if (gap <= 0 || closedPort(s, a, b)) continue;
        const q = Math.min(ma.inv * 0.01, mb.target * 0.01 * (gap / mb.price) * 3);
        ma.inv -= q;
        mb.inv += q;
      }
  }
}

export function closedPort(s: GameState, a: RegionId, b: RegionId) {
  const sea = a === 'tropics' || b === 'tropics';
  return (sea && activeEvents(s, 'portClosure').length > 0) || activeEvents(s, 'embargo').some((e) => (e.region === a && e.region2 === b) || (e.region === b && e.region2 === a));
}

export function tariffRate(s: GameState, from: RegionId, to: RegionId) {
  if (SAME_COUNTRY.some((c) => c.includes(from) && c.includes(to))) return 0;
  const embargo = activeEvents(s, 'embargo').some((e) => (e.region === from && e.region2 === to) || (e.region === to && e.region2 === from));
  return embargo ? 1 : REGIONS[to].importTariff;
}

export function freightPerUnit(s: GameState, a: RegionId, b: RegionId, player = true) {
  const km = distance(a, b);
  const sea = a === 'tropics' || b === 'tropics';
  const rate = sea ? CONFIG.seaFreightPerUnitKm : CONFIG.freightPerUnitKm;
  return km * rate * (fuelPrice(s, a) / 1) * (player && has(s, 'routeOptimization') ? 0.8 : 1) + (sea ? 0.05 : 0);
}

export function transitTicks(s: GameState, a: RegionId, b: RegionId) {
  const km = distance(a, b);
  const sea = a === 'tropics' || b === 'tropics';
  const customs = a === b || SAME_COUNTRY.some((c) => c.includes(a) && c.includes(b)) ? 0 : REGIONS[b].customsDays * (has(s, 'portLogistics') ? 0.5 : 1);
  return Math.ceil(km / (sea ? 600 : 900) * TICKS_PER_DAY + customs * TICKS_PER_DAY);
}

// ---------------------------------------------------------------- daily

export function marketsDaily(s: GameState) {
  for (const r of REGION_IDS)
    for (const g of TRADEABLE) {
      const m = s.markets[r][g]!;
      const def = GOODS[g];
      push(m.daily, round2(m.price), CONFIG.dailyHistoryLength);
      const avg30 = m.daily.slice(-30).reduce((a, x) => a + x, 0) / Math.min(30, m.daily.length);
      // Supply responds to sustained prices with a lag (cobweb dynamics), and to input costs.
      // Supply is less price-elastic than demand in the short run, so the cobweb converges.
      let target = m.bg0 * clamp((avg30 / refPrice(s, g)) ** 0.25, 0.5, 1.8);
      if (g === 'fuel') target = m.bg0 / s.macro.energy;
      if (g === 'fertilizer') target = m.bg0 / s.macro.energy ** 0.8;
      if (def.inputs) {
        const costIdx = Object.entries(def.inputs).reduce((a, [ig, q]) => a + (avgPrice(s, ig as GoodId) * q!) / (GOODS[g].basePrice * s.macro.cpi), 0);
        const refIdx = Object.entries(def.inputs).reduce((a, [ig, q]) => a + (GOODS[ig as GoodId].basePrice * q!) / GOODS[g].basePrice, 0);
        target *= clamp((avg30 / refPrice(s, g) / (costIdx / refIdx)) ** 0.8, 0.3, 2);
      }
      m.bg += (target - m.bg) * 0.06;
      m.demandToday = 0;
    }
}

export function macroDaily(s: GameState) {
  const M = s.macro;
  M.energy = Math.exp(Math.log(M.energy) * 0.97 + 0.025 * gauss(s)) * (1 + 0.012 * severity(s, 'energyShock'));
  M.energy = clamp(M.energy, 0.5, 3.5);
  M.inflation = clamp(M.inflation * 0.97 + 0.03 * 0.025 + 0.0015 * gauss(s) + 0.004 * (M.energy - 1), -0.01, 0.15);
  M.cpi *= 1 + M.inflation / DAYS_PER_YEAR;
  M.crunch = 0.03 * severity(s, 'creditCrunch');
  M.baseRate = clamp(0.01 + 1.4 * M.inflation + M.crunch, 0.005, 0.2);
  const recession = severity(s, 'recession');
  M.income = clamp(M.income + (1 + 0.01 * (day(s) / DAYS_PER_YEAR) - M.income) * 0.02 - 0.004 * recession + 0.002 * gauss(s), 0.7, 2.5);
  M.climate += (0.035 + M.emissions * 5e-8) / DAYS_PER_YEAR;
  M.emissions *= 0.99;
  for (const r of REGION_IDS) {
    const reg = s.regions[r];
    const def = REGIONS[r];
    reg.cpi *= 1 + (M.inflation + def.inflationOffset) / DAYS_PER_YEAR;
    if (def.fx0 !== 1) reg.fx = clamp(reg.fx * Math.exp(-def.inflationOffset / DAYS_PER_YEAR + 0.008 * gauss(s) * (1.2 - def.stability)), def.fx0 * 0.2, def.fx0 * 3);
    // weather: today's random variation was drawn days ago (that is what the forecast showed);
    // the seasonal baseline and any drought or flood apply on the day itself.
    const today = reg.forecast.shift() ?? drawWeather(s);
    while (reg.forecast.length < 4) reg.forecast.push(drawWeather(s));
    const w = weatherFor(s, r, day(s), today);
    reg.rainToday = w.rain;
    reg.rain30 = reg.rain30 * (29 / 30) + reg.rainToday / 30;
    reg.temp = w.temp;
    reg.frostTonight = w.frost;
    reg.haulToday = 0;
    reg.truckToday = 0;
    reg.portToday = 0;
    reg.waterToday = 0;
  }
  if (random(s) < 0.02) newsFlash(s);
}

function newsFlash(s: GameState) {
  const r = REGION_IDS[Math.floor(random(s) * REGION_IDS.length)];
  if (!s.regions[r].unlocked && s.era < 5) return;
  const goods = TRADEABLE.filter((g) => s.markets[r][g]!.daily.length > 10);
  let best: GoodId | null = null, move = 0;
  for (const g of goods) {
    const d = s.markets[r][g]!.daily;
    const ch = d[d.length - 1] / d[d.length - 10] - 1;
    if (Math.abs(ch) > Math.abs(move)) (best = g), (move = ch);
  }
  if (best && Math.abs(move) > 0.12) log(s, 'info', `Market report: ${GOODS[best].name} in ${REGIONS[r].name} ${move > 0 ? 'up' : 'down'} ${Math.abs(move * 100).toFixed(0)}% over 10 days.`, 'markets');
}

/** Random part of a day's weather, drawn ahead so the forecast can show it. */
export const drawWeather = (s: GameState) => ({ temp: 2 * gauss(s), rain: gauss(s) });

/** A day's weather in a region: seasonal baseline + climate + events + the pre-drawn variation. */
export function weatherFor(s: GameState, r: RegionId, d: number, noise: { temp: number; rain: number }) {
  const def = REGIONS[r];
  const M = s.macro;
  const season = Math.sin((2 * Math.PI * ((((d % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) - 15)) / DAYS_PER_YEAR); // peak mid-summer, low mid-winter
  const swing = r === 'tropics' ? 2.5 : r === 'arid' ? 7 : 9;
  const vol = 0.35 + 0.05 * M.climate;
  const rainMean = def.rain * (1 - 0.6 * severity(s, 'drought', r)) * (1 + 1.5 * severity(s, 'flood', r)) * (1 - 0.03 * M.climate * (def.rain < 0.4 ? 1 : 0));
  const temp = def.temp + swing * season + M.climate + noise.temp + 3 * severity(s, 'drought', r);
  return { temp, rain: clamp(rainMean * Math.exp(vol * noise.rain - (vol * vol) / 2), 0, 2), frost: temp < 4 }; // nights run ~5°C below the daily mean
}

/** The next days as players see them (index 0 = tomorrow). */
export const forecast = (s: GameState, r: RegionId) => s.regions[r].forecast.map((n, i) => weatherFor(s, r, day(s) + 1 + i, n));

export function avgPrice(s: GameState, g: GoodId) {
  let w = 0, t = 0;
  for (const r of REGION_IDS) {
    const m = s.markets[r][g];
    if (!m) continue;
    t += m.price * m.d0;
    w += m.d0;
  }
  return w ? t / w : GOODS[g].basePrice;
}

export function avg30(s: GameState, r: RegionId, g: GoodId) {
  const d = s.markets[r][g]!.daily.slice(-30);
  return d.reduce((a, x) => a + x, 0) / d.length;
}

// ---------------------------------------------------------------- player trades

export interface Quote { qty: number; gross: number; avgPrice: number; priceAfter: number; haul: number; net: number; limitedBy?: string }

/** Revenue (sign 1) or cost (sign −1) of trading q now: price moves exponentially through order-book depth. */
function integral(P: number, D: number, q: number, sign: 1 | -1) {
  return sign === 1 ? P * D * (1 - Math.exp(-q / D)) : P * D * (Math.exp(q / D) - 1);
}
/** Sale revenue with a buyer of last resort: no unit ever fills below the market's floor price. */
function sellRevenue(s: GameState, g: GoodId, P: number, D: number, q: number) {
  const floor = refPrice(s, g) * FLOOR;
  if (P <= floor) return floor * q;
  const toFloor = D * Math.log(P / floor); // units until the walk-down reaches the floor
  return q <= toFloor ? integral(P, D, q, 1) : integral(P, D, toFloor, 1) + floor * (q - toFloor);
}
const FLOOR = 0.25;
const MAX_IMPACT = 1.2; // order-book impact saturates; beyond it the floor buyer takes the rest

export function haulCost(s: GameState, r: RegionId, qty: number) {
  const reg = s.regions[r];
  const trucks = s.machines.filter((m) => m.region === r && m.type === 'truck' && !m.broken).length;
  const truckLeft = Math.max(0, trucks * 1500 - reg.truckToday);
  const hiredCap = CONFIG.haulCapacityPerDay * REGIONS[r].infra * (1 - 0.8 * severity(s, 'strike', r));
  const hiredLeft = Math.max(0, hiredCap - reg.haulToday);
  const viaTruck = Math.min(qty, truckLeft);
  const viaHired = Math.min(qty - viaTruck, hiredLeft);
  const opt = has(s, 'routeOptimization') ? 0.8 : 1;
  const cost = viaTruck * 0.015 * fuelPrice(s, r) + viaHired * (CONFIG.haulPerUnit / REGIONS[r].infra) * fuelPrice(s, r) * opt;
  return { cost, viaTruck, viaHired, possible: viaTruck + viaHired };
}

export function retailPremium(s: GameState, r: RegionId, g: GoodId) {
  return GOODS[g].kind === 'processed' && buildingsIn(s, r, 'distribution').some((b) => b.active) ? 1.12 : 1;
}

export function quoteSell(s: GameState, r: RegionId, g: GoodId, qty: number): Quote {
  const m = s.markets[r][g];
  if (!m || qty <= 0) return { qty: 0, gross: 0, avgPrice: m?.price ?? 0, priceAfter: m?.price ?? 0, haul: 0, net: 0 };
  const h = haulCost(s, r, qty);
  let limitedBy: string | undefined;
  if (h.possible < qty) {
    qty = Math.floor(h.possible);
    limitedBy = 'Haulage capacity for today is used up. Buy trucks or sell tomorrow.';
  }
  const gross = sellRevenue(s, g, m.price, depth(m), qty) * retailPremium(s, r, g) * qualityMult(s.regions[r].quality[g] ?? 0.65);
  const priceAfter = priceFromInv(s, g, m, m.inv + qty, m.impact + qty / depth(m));
  const hc = haulCost(s, r, qty).cost;
  return { qty, gross: round2(gross), avgPrice: qty ? gross / qty : m.price, priceAfter, haul: round2(hc), net: round2(gross - hc), limitedBy };
}

export function quoteBuy(s: GameState, r: RegionId, g: GoodId, qty: number): Quote {
  const m = s.markets[r][g];
  if (!m || qty <= 0) return { qty: 0, gross: 0, avgPrice: m?.price ?? 0, priceAfter: m?.price ?? 0, haul: 0, net: 0 };
  let limitedBy: string | undefined;
  const maxQ = Math.floor(Math.min(m.inv * 0.5, depth(m) * 3));
  if (qty > maxQ) (qty = maxQ), (limitedBy = 'The market does not hold that much stock.');
  const h = haulCost(s, r, qty);
  if (h.possible < qty) (qty = Math.floor(h.possible)), (limitedBy = 'Haulage capacity for today is used up.');
  const gross = integral(m.price, depth(m), qty, -1);
  const priceAfter = priceFromInv(s, g, m, m.inv - qty, m.impact - qty / depth(m));
  const hc = haulCost(s, r, qty).cost;
  return { qty, gross: round2(gross), avgPrice: qty ? gross / qty : m.price, priceAfter, haul: round2(hc), net: round2(gross + hc), limitedBy };
}

function useHaul(s: GameState, r: RegionId, qty: number) {
  const h = haulCost(s, r, qty);
  s.regions[r].truckToday += h.viaTruck;
  s.regions[r].haulToday += h.viaHired;
  if (h.cost > 0) post(s, 'haulage', -h.cost, h.viaTruck >= qty ? 'Own trucks' : 'Hired haulage', r);
  return h;
}

/** Executes a sale; caller has validated inventory. Returns USD received net of haulage. */
export function executeSell(s: GameState, r: RegionId, g: GoodId, qty: number, memo?: string, kind: 'sale' | 'contract' = 'sale') {
  const q = quoteSell(s, r, g, qty);
  if (q.qty <= 0) return q;
  const m = s.markets[r][g]!;
  s.regions[r].inventory[g] -= q.qty;
  m.inv += q.qty;
  m.impact = Math.min(MAX_IMPACT, m.impact + q.qty / depth(m));
  m.playerSold += q.qty;
  m.price = priceFromInv(s, g, m);
  post(s, kind, q.gross, memo ?? `Sold ${Math.round(q.qty)} ${GOODS[g].name} @ $${q.avgPrice.toFixed(2)}`, r, g === 'meat' || g === 'milk' ? 'livestock' : GOODS[g].kind === 'processed' ? 'processing' : 'crops');
  useHaul(s, r, q.qty);
  s.stats.sales++;
  s.stats.peopleFed += (q.qty * GOODS[g].kcal) / (2000 * 365);
  return q;
}

export function executeBuy(s: GameState, r: RegionId, g: GoodId, qty: number, memo?: string) {
  const q = quoteBuy(s, r, g, qty);
  if (q.qty <= 0) return q;
  const m = s.markets[r][g]!;
  m.inv -= q.qty;
  m.impact = Math.max(-MAX_IMPACT, m.impact - q.qty / depth(m));
  m.price = priceFromInv(s, g, m);
  const reg = s.regions[r];
  reg.quality[g] = ((reg.quality[g] ?? 0.65) * reg.inventory[g] + 0.65 * q.qty) / (reg.inventory[g] + q.qty); // market stock is average grade
  reg.inventory[g] += q.qty;
  post(s, g === 'fertilizer' ? 'fertilizer' : g === 'fuel' ? 'fuel' : 'purchases', -q.gross, memo ?? `Bought ${Math.round(q.qty)} ${GOODS[g].name} @ $${q.avgPrice.toFixed(2)}`, r);
  useHaul(s, r, q.qty);
  return q;
}

/** 10-day outlook from the market's own supply–demand balance (Market intelligence research). */
export function outlook(s: GameState, r: RegionId, g: GoodId) {
  const m = s.markets[r][g]!;
  const demand = m.d0 * s.macro.income ** GOODS[g].incomeElasticity * (m.price / refPrice(s, g)) ** -GOODS[g].elasticity;
  const inv10 = clamp(m.inv + (m.bg + m.comp - demand) * 240, minInv(m), maxInv(m));
  return priceFromInv(s, g, { ...m, sent: m.sent * 0.97 ** 240 }, inv10, m.impact * CONFIG.impactDecay ** 240) / m.price - 1;
}

export const cropMarketHint = (c: CropId) => CROPS[c];
void hour;
