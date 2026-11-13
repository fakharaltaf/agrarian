import { retailAllowance, retailChannel } from './facility-levels';
import { queueSale, usesCarts } from './hauling';
import { recordRetailPremium } from './production-report';
import { townOf } from './town-state';
import type { Division } from './types';
// Regional commodity markets. Price is a function of market-held inventory:
//   price = ref × (target / inventory)^γ × e^sentiment
// Inventory moves with supply (background + competitors, weather, seasons, input costs)
// minus demand (elastic in price, income, substitutes). Player trades move inventory,
// so price impact and its slow recovery fall out of the same model.
import {
  CONFIG, CROPS, DAYS_PER_YEAR, GOODS, GRAINS, REGIONS, REGION_IDS, SAME_COUNTRY, TICKS_PER_DAY, TICKS_PER_YEAR, TRADEABLE,
  distance, type CropId, type GoodId, type RegionId, FACTORY_GOODS } from './config';
import { activeEvents, clamp, day, fuelPrice, freeSpace, gauss, has, hour, log, post, random, refPrice, round2, severity, leaning } from './core';
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
export const marketDepth = (s: GameState, r: RegionId, g: GoodId) => (s.markets[r][g] ? depth(s.markets[r][g]!) : 0);

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
    reg.retailToday = {};
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

export interface Quote { qty: number; gross: number; avgPrice: number; priceAfter: number; haul: number; net: number; limitedBy?: string; retailQty?: number; retailValue?: number }

const FLOOR = .25;
const MAX_IMPACT = 1.2;
/** Half a percent on each side: dealers quote a bid and ask, not an exploitable midpoint. */
export const DEALER_SPREAD = .005;
const bidCents=(n:number)=>Math.floor(n*100+1e-8)/100;
const askCents=(n:number)=>Math.ceil(n*100-1e-8)/100;

/** Integrate the very same inventory/impact curve that sets the post-trade price.
 * Break at impact/floor kinks and inventory doublings; eight Simpson substeps per
 * smooth piece keep work bounded by price changes rather than the number of goods.
 * Bid/ask rounding is directional, so splitting orders cannot farm fractional cents.
 */
function bookValue(s:GameState,g:GoodId,m:Market,qty:number,direction:1|-1) {
  if(qty<=0)return 0;
  const D=depth(m),reference=refPrice(s,g),bound=reference*(direction===1?FLOOR:4);
  const at=(x:number)=>priceFromInv(s,g,m,m.inv+direction*x,m.impact+direction*x/D);
  if(at(0)===bound)return qty*bound;
  let end=qty,tail=0;
  if(at(qty)===bound) {
    let lo=0,hi=qty;
    for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(at(mid)===bound)hi=mid;else lo=mid;}
    end=(lo+hi)/2;tail=(qty-end)*bound;
  }
  const cuts=[0,end];
  const cut=(n:number)=>{if(n>0&&n<end)cuts.push(n);};
  cut(direction===1?(MAX_IMPACT-m.impact)*D:(MAX_IMPACT+m.impact)*D);
  cut((minInv(m)-m.inv)/direction);
  if(direction===1)for(let inv=Math.max(minInv(m),m.inv)*2,n=0;inv<m.inv+end&&n<64;inv*=2,n++)cut(inv-m.inv);
  cuts.sort((a,b)=>a-b);
  let value=tail;
  for(let piece=1;piece<cuts.length;piece++) {
    const a=cuts[piece-1],b=cuts[piece],h=(b-a)/8;
    let sum=at(a)+at(b);
    for(let i=1;i<8;i++)sum+=(i%2?4:2)*at(a+h*i);
    value+=sum*h/3;
  }
  return value;
}

export function haulCost(s: GameState, r: RegionId, qty: number) {
  const reg = s.regions[r];
  const trucks = s.machines.filter((m) => m.region === r && m.type === 'truck' && !m.broken).length;
  const truckLeft = Math.max(0, trucks * 1500 - reg.truckToday);
  const hiredCap = CONFIG.haulCapacityPerDay * REGIONS[r].infra * (1 - 0.8 * severity(s, 'strike', r));
  const hiredLeft = Math.max(0, hiredCap - reg.haulToday);
  const viaTruck = Math.min(qty, truckLeft);
  const viaHired = Math.min(qty - viaTruck, hiredLeft);
  const viaSpot = qty - viaTruck - viaHired; // short-notice lorries: always available, at 3× the rate
  const opt = has(s, 'routeOptimization') ? 0.8 : 1;
  const hired = (CONFIG.haulPerUnit / REGIONS[r].infra) * fuelPrice(s, r) * opt;
  const cost = viaTruck * 0.015 * fuelPrice(s, r) + viaHired * hired + viaSpot * hired * 3;
  return { cost: cost * (r === 'heartland' && townOf(s).active ? 1 - 0.15 * townOf(s).roads : 1), viaTruck, viaHired: viaHired + viaSpot, viaSpot, possible: qty };
}

export function retailPremium(s: GameState, r: RegionId, g: GoodId) {
  return 1 + (GOODS[g].kind === 'processed' ? retailChannel(s,r) : 0);
}

export function quoteSell(s: GameState, r: RegionId, g: GoodId, qty: number): Quote {
  const m = s.markets[r][g];
  if (!m || qty <= 0) return { qty: 0, gross: 0, avgPrice: m?.price ?? 0, priceAfter: m?.price ?? 0, haul: 0, net: 0 };
  const h = haulCost(s, r, qty);
  let limitedBy: string | undefined;
  if (h.viaSpot > 0) limitedBy = `Regular haulage is full today: ${Math.round(h.viaSpot).toLocaleString('en-US')} units go by short-notice lorry at 3× the rate. Own trucks are cheapest.`;
  const rate=retailPremium(s,r,g)-1,retailQty=rate>0?Math.min(qty,retailAllowance(s,r,g).left):0;
  const quality=qualityMult(s.regions[r].quality[g]??.65)*(leaning(s).clean&&GOODS[g].kind!=='input'?1.05:1); // a clean farm's good name
  const retailValue=bookValue(s,g,m,retailQty,1)*(1-DEALER_SPREAD)*rate*quality;
  const gross=bookValue(s,g,m,qty,1)*(1-DEALER_SPREAD)*quality+retailValue;
  const priceAfter = priceFromInv(s, g, m, m.inv + qty, m.impact + qty / depth(m));
  const hc = haulCost(s, r, qty).cost;
  return { qty, gross: bidCents(gross), avgPrice: qty ? bidCents(gross) / qty : m.price, priceAfter, haul: round2(hc), net: round2(bidCents(gross) - round2(hc)), limitedBy, retailQty, retailValue:round2(retailValue) };
}

export function quoteBuy(s: GameState, r: RegionId, g: GoodId, qty: number): Quote {
  const m = s.markets[r][g];
  if (!m || qty <= 0) return { qty: 0, gross: 0, avgPrice: m?.price ?? 0, priceAfter: m?.price ?? 0, haul: 0, net: 0 };
  let limitedBy: string | undefined;
  const maxQ = Math.floor(Math.min(m.inv * 0.5, depth(m) * 3));
  if (qty > maxQ) (qty = maxQ), (limitedBy = 'The market does not hold that much stock.');
  const h = haulCost(s, r, qty);
  if (h.viaSpot > 0) limitedBy = 'Regular haulage is full today: part comes by short-notice lorry at 3× the rate.';
  const priceAfter = priceFromInv(s, g, m, m.inv - qty, m.impact - qty / depth(m));
  const gross = askCents(bookValue(s,g,m,qty,-1)*(1+DEALER_SPREAD));
  const hc = haulCost(s, r, qty).cost;
  return { qty, gross: round2(gross), avgPrice: qty ? gross / qty : m.price, priceAfter, haul: round2(hc), net: round2(gross + round2(hc)), limitedBy };
}

/** Real order size after market depth, storage and the caller's explicit spending budget. */
export function affordableBuy(s:GameState,r:RegionId,g:GoodId,desired:number,budget:number):Quote {
  if(!Number.isFinite(desired)||desired<=0||!Number.isFinite(budget)||budget<=0)return quoteBuy(s,r,g,0);
  const limit=Math.max(0,Math.min(Math.ceil(desired),Math.floor(freeSpace(s,r,g))));
  const quote=quoteBuy(s,r,g,limit);
  if(quote.net<=budget)return quote;
  let lo=0,hi=Math.floor(quote.qty);
  for(let i=0;i<32&&hi>lo;i++) {
    const mid=Math.ceil((lo+hi)/2);
    if(quoteBuy(s,r,g,mid).net<=budget)lo=mid;else hi=mid-1;
  }
  return quoteBuy(s,r,g,lo);
}

function useHaul(s: GameState, r: RegionId, qty: number) {
  const h = haulCost(s, r, qty);
  s.regions[r].truckToday += h.viaTruck;
  s.regions[r].haulToday += h.viaHired;
  // trucks that carried today's loads count as in use (their wear and utilisation follow)
  let load = s.regions[r].truckToday;
  for (const m of s.machines) if (m.region === r && m.type === 'truck' && !m.broken && load > 0) (m.usedThisTick = true), (load -= 1500);
  if (h.cost > 0) post(s, 'haulage', -h.cost, h.viaTruck >= qty ? 'Own trucks' : 'Hired haulage', r);
  return h;
}

/** Executes a sale; caller has validated inventory. Returns USD received net of haulage. */
/** direct: the buyer pays on the spot (timber at the clearing, liquidation); otherwise market sales travel by cart from Market Town on. */
export function executeSell(s: GameState, r: RegionId, g: GoodId, qty: number, memo?: string, kind: 'sale' | 'contract' = 'sale', direct = false) {
  const q = quoteSell(s, r, g, qty);
  if (q.qty <= 0) return q;
  const m = s.markets[r][g]!;
  s.regions[r].inventory[g] -= q.qty;
  m.inv += q.qty;
  m.impact = Math.min(MAX_IMPACT, m.impact + q.qty / depth(m));
  m.playerSold += q.qty;
  m.price = priceFromInv(s, g, m);
  const label = memo ?? `Sold ${Math.round(q.qty)} ${GOODS[g].name} @ $${q.avgPrice.toFixed(2)}`, division = g === 'meat' || g === 'milk' ? 'livestock' : GOODS[g].kind === 'processed' ? 'processing' : 'crops';
  const carted = !direct && usesCarts(s, r);
  if (carted) queueSale(s, { good: g, qty: q.qty, value: q.gross, kind, memo: label, division }); // paid when the cart reaches the market
  else post(s, kind, q.gross, label, r, division);
  if((q.retailQty??0)>0){s.regions[r].retailToday[g]=(s.regions[r].retailToday[g]??0)+q.retailQty!;recordRetailPremium(s,r,q.retailValue??0);}
  if (!carted) useHaul(s, r, q.qty); // your own vehicles replace hired haulage
  s.stats.sales++;
  if (FACTORY_GOODS.has(g)) s.stats.factorySales = (s.stats.factorySales ?? 0) + q.gross; // the Industry chapter's goal
  s.stats.peopleFed += (q.qty * GOODS[g].kcal) / (2000 * 365);
  return q;
}

export function executeBuy(s: GameState, r: RegionId, g: GoodId, qty: number, memo?: string, division?: Division) {
  const q = quoteBuy(s, r, g, qty);
  if (q.qty <= 0) return q;
  const m = s.markets[r][g]!;
  m.inv -= q.qty;
  m.impact = Math.max(-MAX_IMPACT, m.impact - q.qty / depth(m));
  m.price = priceFromInv(s, g, m);
  const reg = s.regions[r];
  reg.quality[g] = ((reg.quality[g] ?? 0.65) * reg.inventory[g] + 0.65 * q.qty) / (reg.inventory[g] + q.qty); // market stock is average grade
  reg.inventory[g] += q.qty;
  post(s, g === 'fertilizer' ? 'fertilizer' : g === 'fuel' ? 'fuel' : 'purchases', -q.gross, memo ?? `Bought ${Math.round(q.qty)} ${GOODS[g].name} @ $${q.avgPrice.toFixed(2)}`, r, division);
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
