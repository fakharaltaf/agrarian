// Factories, energy and building upkeep. One production model for every industry:
// batches = min(capacity, scarcest input, output room, power) — Leontief, like a real line.
import { BUILDINGS, GOODS, REGIONS, REGION_IDS, WORK_START, type GoodId, type RegionId } from './config';
import { buildingDivision, clamp, electricityPrice, execOn, freeSpace, has, hour, levelMult, post, priceUsd, reservedStock, severity } from './core';
import { addGoods } from './agriculture';
import type { Building, GameState } from './types';

export const EMA = 0.05;

export function solarOutput(s: GameState, r: RegionId) {
  const h = hour(s);
  if (h < WORK_START || h >= 18) return 0;
  return Math.sin(((h - WORK_START + 0.5) / 12) * Math.PI) * REGIONS[r].solar * (1 - 0.3 * Math.min(1, s.regions[r].rainToday));
}

export function buildingsTick(s: GameState) {
  for (const r of REGION_IDS) {
    const reg = s.regions[r];
    let gen = 0;
    for (const b of s.buildings) {
      if (b.region !== r) continue;
      const def = BUILDINGS[b.type];
      if (!b.active) {
        b.util *= 1 - EMA;
        b.reason = 'Paused';
        b.stats = { out: 0, inCost: 0, outValue: 0, opCost: 0 }; // a paused factory pays no staff and makes nothing
        continue;
      }
      const staff = def.staffPerHour * s.macro.cpi * (execOn(s, buildingDivision(b.type)) ? 0.92 : 1) * (1 + 0.3 * ((b.level || 1) - 1));
      if (staff) post(s, 'staff', -staff, `${def.name} staff`, r, buildingDivision(b.type));
      if (def.coldKwh) reg.powerUse += def.coldKwh * (has(s, 'coldChain') ? 1.3 : 1);
      if (def.solarKw) gen += def.solarKw * solarOutput(s, r);
      if (def.recipe) produce(s, b, staff);
    }
    // settle electricity: own generation first, buy the rest, sell surplus at half price
    gen += reg.powerGen;
    const price = electricityPrice(s, r);
    const net = reg.powerUse - gen;
    if (net > 0) post(s, 'electricity', -net * price, 'Grid electricity', r, 'energy');
    else if (net < 0) post(s, 'grid', -net * price * 0.5, 'Power sold to grid', r, 'energy');
    reg.powerUse = 0;
    reg.powerGen = 0;
  }
}

function produce(s: GameState, b: Building, staff: number) {
  const def = BUILDINGS[b.type];
  const rec = def.recipe!;
  const reg = s.regions[b.region];
  const inv = reg.inventory;
  const cap = rec.batchesPerHour * levelMult(b.level);
  let batches = cap;
  let reason = '';
  if ((b.type === 'ranch' || b.type === 'dairy') && severity(s, 'livestockDisease', b.region) > 0) {
    batches = 0;
    reason = 'Disease outbreak: production halted';
  }
  for (const [g, q] of Object.entries(rec.inputs) as [GoodId, number][]) {
    const can = Math.max(0, inv[g] - reservedStock(s, b.region, g, b)) / q; // other factories' reserved stock is off limits
    if (can < batches) {
      batches = can;
      reason = `Not enough ${GOODS[g].name.toLowerCase()}`;
    }
  }
  const outMult = has(s, 'processEfficiency') ? 1.1 : 1;
  const outUnits = Object.values(rec.outputs).reduce((a, q) => a + q! * outMult, 0);
  if (outUnits > 0) {
    // all outputs share storage; use the tightest one as the cap
    let room = Infinity;
    for (const [g, q] of Object.entries(rec.outputs) as [GoodId, number][]) room = Math.min(room, freeSpace(s, b.region, g) / (q * outMult));
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
    b.reserved = Math.max(0, Math.min(b.reserved - q * batches, inv[g])); // own reserve is used first
    inCost += q * batches * priceUsd(s, b.region, g);
  }
  for (const [g, q] of Object.entries(rec.outputs) as [GoodId, number][]) {
    addGoods(s, b.region, g, q * outMult * batches, quality);
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
  const st = b.stats;
  st.out = st.out * (1 - EMA) + batches * EMA;
  st.inCost = st.inCost * (1 - EMA) + inCost * EMA;
  st.outValue = st.outValue * (1 - EMA) + outValue * EMA;
  st.opCost = st.opCost * (1 - EMA) + opCost * EMA;
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
