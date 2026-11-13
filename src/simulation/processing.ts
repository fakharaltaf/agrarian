import { solarCapacity } from './facility-levels';
import { hasAccess } from './world';
import { recordProductionHour } from './production-report';
import { payHouseholds, townOf, townIndustryFactor } from './town-state';
import { larderReserve } from './stages/settlement';
// Factories, energy and building upkeep. One production model for every industry:
// batches = min(capacity, scarcest input, output room, power) — Leontief, like a real line.
import { BUILDINGS, COWS_PER_DAIRY_BATCH, GOODS, REGIONS, REGION_IDS, SUNRISE, SUNSET, type GoodId, type RegionId } from './config';
import { buildingDivision, clamp, electricityPrice, execOn, freeSpace, has, hour, levelMult, throughput, post, priceUsd, round2, reserveCap, reservedStock, severity } from './core';
import { addGoods } from './agriculture';
import { avg30 } from './markets';
import { drawOil, wellField } from './oil';
import type { Building, GameState } from './types';

export const EMA = 0.05;

/** How windy each region is (1 = average); the coast is windiest, the tropics calmest. */
export const WIND: Record<RegionId, number> = { heartland: 0.9, river: 0.8, arid: 1.2, coastal: 1.45, tropics: 0.7 };
/** Wind this hour, 0.3–1.5× the regional average: gusty days and still ones, a little stronger in storms. */
export function windOutput(s: GameState, r: RegionId) {
  const d = Math.floor(s.tick / 24);
  return WIND[r] * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(s.tick * 0.11 + d * 1.7))) * (1 + 0.3 * Math.min(1, s.regions[r].rainToday));
}
export function solarOutput(s: GameState, r: RegionId) {
  const h = hour(s);
  if (h < SUNRISE || h >= SUNSET) return 0;
  return Math.sin(((h - SUNRISE + 0.5) / (SUNSET - SUNRISE)) * Math.PI) * REGIONS[r].solar * (1 - 0.3 * Math.min(1, s.regions[r].rainToday));
}

export function buildingsTick(s: GameState) {
  for (const r of REGION_IDS) {
    const reg = s.regions[r];
    let gen = 0;
    const energySources:{b:Building;kwh:number}[]=[];
    let cows = s.herds.find((h) => h.region === r && h.animal === 'cows')?.count ?? 0; // dairies share the region's herd
    for (const b of s.buildings) {
      if (b.region !== r) continue;
      const def = BUILDINGS[b.type];
      if (!b.active || (b.movedUntil ?? 0) > s.tick) {
        b.util *= 1 - EMA;
        b.reason = b.active ? 'Moving' : 'Paused';
        recordProductionHour(s,b,0,0,0,0,0);
        b.stats = { out: 0, inCost: 0, outValue: 0, opCost: 0 }; // a paused factory pays no staff and makes nothing
        continue;
      }
      if (!hasAccess(s, r, `b:${b.id}`)) { // no road, no work: nothing gets in or out
        b.util *= 1 - EMA; b.reason = 'No road access'; recordProductionHour(s,b,0,0,0,0,0); b.stats = { out: 0, inCost: 0, outValue: 0, opCost: 0 };
        continue;
      }
      if (b.reason === 'Moving' || b.reason === 'Paused' || b.reason === 'No road access') b.reason = ''; // back at work (barns and stores have no recipe to reset it)
      const staff = def.staffPerHour * s.macro.cpi * (execOn(s, buildingDivision(b.type)) ? 0.92 : 1) * (1 + 0.3 * ((b.level || 1) - 1));
      if (staff) {
        post(s, 'staff', -staff, `${def.name} staff`, r, buildingDivision(b.type));
        if (r === 'heartland' && townOf(s).active) payHouseholds(s, staff * townOf(s).factoryShare);
      }
      if (def.coldKwh) reg.powerUse += def.coldKwh * (has(s, 'coldChain') ? 1.3 : 1);
      const solar=(def.solarKw?solarCapacity(b)*solarOutput(s,r):0)+(def.windKw?def.windKw*levelMult(b.level)*windOutput(s,r):0);
      gen+=solar;
      if(solar>0)energySources.push({b,kwh:solar});
      if(!def.recipe&&(def.category==='energy'||def.category==='commerce')) {
        b.reason='';b.util=b.util*(1-EMA)+EMA;
        recordProductionHour(s,b,1,solar*electricityPrice(s,r),0,round2(staff),0);
      }
      if (def.recipe) {const made=produce(s,b,staff,cows);cows-=made.cows;if(made.generated>0)energySources.push({b,kwh:made.generated});}
    }
    // settle electricity: own generation first, buy the rest, sell surplus at half price
    gen += reg.powerGen;
    const price = electricityPrice(s, r);
    const net = reg.powerUse - gen;
    // Attribute actual avoided purchases / half-price grid sales, not a fictitious full retail sale.
    const unitValue=gen>0?price*(Math.min(reg.powerUse,gen)+Math.max(0,gen-reg.powerUse)*.5)/gen:price;
    for(const source of energySources)if(source.b.productionReport.open)source.b.productionReport.open.earn+=source.kwh*(unitValue-price);
    if (net > 0) post(s, 'electricity', -net * price, 'Grid electricity', r, 'energy');
    else if (net < 0) post(s, 'grid', -net * price * 0.5, 'Power sold to grid', r, 'energy');
    reg.powerUse = 0;
    reg.powerGen = 0;
  }
}

/** Runs one factory hour; returns cows milked and actual electricity generated. */
function produce(s: GameState, b: Building, staff: number, cows = 0) {
  const def = BUILDINGS[b.type];
  const rec = def.recipe!;
  const reg = s.regions[b.region];
  const inv = reg.inventory;
  const cap = rec.batchesPerHour * throughput(b) * townIndustryFactor(s, b.region);
  let batches = cap;
  let reason = '';
  if ((b.type === 'ranch' || b.type === 'dairy') && severity(s, 'livestockDisease', b.region) > 0) {
    batches = 0;
    reason = 'Disease outbreak: production halted';
  }
  if (b.type === 'dairy' && cows / COWS_PER_DAIRY_BATCH < batches) {
    batches = Math.max(0, cows / COWS_PER_DAIRY_BATCH);
    reason = 'Not enough cows';
  }
  for (const [g, q] of Object.entries(rec.inputs) as [GoodId, number][]) {
    const can = Math.max(0, inv[g] - reservedStock(s, b.region, g, b) - (b.region === 'heartland' ? larderReserve(s, g) : 0)) / q; // other factories' reserved stock is off limits
    if (can < batches) {
      batches = can;
      reason = `Not enough ${GOODS[g].name.toLowerCase()}`;
    }
  }
  const outMult = has(s, 'processEfficiency') ? 1.1 : 1;
  const oil = b.type === 'oilWell' ? wellField(s, b) : null; // a well pumps only what its field has left
  if (b.type === 'oilWell' && !oil) { batches = 0; reason = 'No oil under this well'; }
  if (oil) { const most = oil.left / (oil.drain * (rec.outputs.oil ?? 1) * outMult); if (most < batches) { batches = Math.max(0, most); reason = 'The oil field is pumped dry'; } }
  const outUnits = Object.values(rec.outputs).reduce((a, q) => a + q! * outMult, 0);
  if (outUnits > 0) {
    // A batch uses up its inputs before the outputs need room, so only the net growth per storage
    // type needs free space (a mill turning 10 wheat into 8 flour frees space, it never needs it).
    const net = { dry: 0, cold: 0 };
    for (const [g, q] of Object.entries(rec.outputs) as [GoodId, number][]) net[GOODS[g].storage === 'cold' ? 'cold' : 'dry'] += q * outMult;
    for (const [g, q] of Object.entries(rec.inputs) as [GoodId, number][]) net[GOODS[g].storage === 'cold' ? 'cold' : 'dry'] -= q;
    let room = Infinity;
    for (const [g] of Object.entries(rec.outputs) as [GoodId, number][]) {
      const k = GOODS[g].storage === 'cold' ? 'cold' : 'dry';
      if (net[k] > 0) room = Math.min(room, freeSpace(s, b.region, g) / net[k]);
    }
    if (room < batches) {
      batches = Math.max(0, room);
      reason = 'Output storage full';
    }
  }
  batches = Math.max(0, batches);
  let inCost = 0, outValue = 0;
  // finished goods inherit the average quality of what went in
  const ins = Object.keys(rec.inputs) as GoodId[];
  const quality = ins.length ? ins.reduce((a, g) => a + (reg.quality[g] ?? 0.65), 0) / ins.length : 0.7;
  for (const [g, q] of Object.entries(rec.inputs) as [GoodId, number][]) {
    inv[g] -= q * batches;
    // the shared pool of same-type factories is used first, own share before siblings'
    let used = q * batches;
    for (const x of [b, ...s.buildings.filter((x) => x !== b && x.type === b.type && x.region === b.region)]) {
      const take = Math.min(x.reserved, used);
      x.reserved = Math.max(0, Math.min(x.reserved - take, inv[g], reserveCap(x)));
      used -= take;
    }
    inCost += q * batches * (s.markets[b.region][g] ? avg30(s, b.region, g) : priceUsd(s, b.region, g)); // inputs at their 30-day average, so a line's verdict does not flip red and green with each day's crop price
  }
  for (const [g, q] of Object.entries(rec.outputs) as [GoodId, number][]) {
    addGoods(s, b.region, g, q * outMult * batches, quality);
    s.stats.produced[g] = (s.stats.produced[g] ?? 0) + q * outMult * batches;
    if (oil && g === 'oil') drawOil(s, b, q * outMult * batches);
    outValue += q * outMult * batches * priceUsd(s, b.region, g);
  }
  const kwh = rec.kwh * batches * (has(s, 'foodTech') && rec.kwh > 0 ? 0.7 : 1);
  if (kwh > 0) reg.powerUse += kwh;
  else {
    reg.powerGen += -kwh;
    outValue += -kwh * electricityPrice(s, b.region);
  }
  const opCost = staff + Math.max(0, kwh) * electricityPrice(s, b.region);
  b.util = b.util * (1 - EMA) + (batches / cap) * EMA;
  b.reason = batches >= cap - 1e-9 ? '' : reason || 'Idle';
  recordProductionHour(s,b,batches,outValue,inCost,round2(staff),Math.max(0,kwh)*electricityPrice(s,b.region));
  const st = b.stats;
  st.out = st.out * (1 - EMA) + batches * EMA;
  st.inCost = st.inCost * (1 - EMA) + inCost * EMA;
  st.outValue = st.outValue * (1 - EMA) + outValue * EMA;
  st.opCost = st.opCost * (1 - EMA) + opCost * EMA;
  return {cows:b.type === 'dairy'?batches*COWS_PER_DAIRY_BATCH:0,generated:Math.max(0,-kwh)};
}

/** Hourly operating margin at market prices (inputs valued at what you could have sold them for). */
export const buildingMargin = (b: Building) => b.stats.outValue - b.stats.inCost - b.stats.opCost;

export function buildingsDaily(s: GameState) {
  for (const b of s.buildings) {
    const dep = b.cost / 2400; // 20-year straight line
    if (b.depreciated < b.cost) {
      b.depreciated = Math.min(b.cost, b.depreciated + dep);
      post(s, 'depreciation', -dep, 'Building depreciation', b.region, buildingDivision(b.type));
    }
  }
}

export const clampUtil = (u: number) => clamp(u, 0, 1);
