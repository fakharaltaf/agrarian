// Fields, soil, water, pests, growth, yield and storage.
import { CONFIG, CROPS, GOODS, MACHINES, REGIONS, TICKS_PER_DAY, TICKS_PER_YEAR, type CropId, type GoodId, type RegionId } from './config';
import { buildingsIn, clamp, factoryCrop, reserveCap, freeSpace, has, log, post, round2, seasonOf, seedCost, severity, stored, todayBook } from './core';
import { executeSell } from './markets';
import type { Field, GameState, HarvestBreakdown } from './types';

export function newField(s: GameState, region: RegionId, ha: number, cost: number): Field {
  const q = REGIONS[region].soil;
  return {
    id: s.fields.reduce((m, f) => Math.max(m, f.id), 0) + 1, cost, region, ha, crop: null, plantedAt: 0, plan: null,
    soil: { n: clamp(q, 0.3, 1.3), p: clamp(q, 0.3, 1.3), k: clamp(q, 0.3, 1.3), organic: clamp(0.8 * q, 0.2, 1) },
    moisture: REGIONS[region].rain, planLocked: false, supplies: null, spreading: null, spreadWork: 0, irrigated: false, greenhouse: false, frost: 0, cycleAt: 0, pest: 0, lastCrop: null, streak: 0, work: 0, acc: { temp: 0, water: 0, n: 0 }, yields: [],
  };
}

// ---------------------------------------------------------------- queries

const matureTicks = (c: CropId) => (CROPS[c].perennial?.matureDays ?? 0) * TICKS_PER_DAY;
/** Orchards: true once the trees bear fruit. */
export const isMature = (s: GameState, f: Field) => !!f.crop && s.tick - f.plantedAt >= matureTicks(f.crop);
/** Annuals: share of the way to harvest. Orchards: maturity until they bear, then the current fruiting cycle. */
export function growth(s: GameState, f: Field) {
  if (!f.crop) return 0;
  const c = CROPS[f.crop];
  if (c.perennial && !isMature(s, f)) return Math.min(1, (s.tick - f.plantedAt) / matureTicks(f.crop)) * 0.999;
  return Math.min(1, (s.tick - (c.perennial ? f.cycleAt : f.plantedAt)) / c.growthTicks);
}
export const isReady = (s: GameState, f: Field) =>
  f.crop !== null && (CROPS[f.crop].perennial ? isMature(s, f) && s.tick - f.cycleAt >= CROPS[f.crop].growthTicks : s.tick - f.plantedAt >= CROPS[f.crop].growthTicks);
export const readyAt = (f: Field) => (f.crop ? (CROPS[f.crop].perennial ? f.cycleAt : f.plantedAt) + CROPS[f.crop].growthTicks : 0);
export const canGrow = (f: Field, c: CropId) => (REGIONS[f.region].suitability[c] ?? 0) > 0;
export const isManual = (f: Field) => f.ha <= 1;

/** How well the soil supplies what this crop needs, 0..1. */
export function soilAdequacy(f: Field, c: CropId) {
  const u = CROPS[c].uptake;
  const w = { n: Math.max(0, u.n), p: Math.max(0, u.p), k: Math.max(0, u.k) };
  const tot = w.n + w.p + w.k || 1;
  const a = (x: number) => Math.min(1, x / 0.7);
  return (w.n * a(f.soil.n) + w.p * a(f.soil.p) + w.k * a(f.soil.k)) / tot;
}
export const soilFactor = (f: Field, c: CropId) => (0.35 + 0.65 * soilAdequacy(f, c)) * (0.75 + 0.25 * f.soil.organic);
/** Simple fertility % shown before soil testing: average nutrient adequacy. */
export const fertility = (f: Field) => (Math.min(1, f.soil.n / 0.7) + Math.min(1, f.soil.p / 0.7) + Math.min(1, f.soil.k / 0.7)) / 3;

export function waterFactor(s: GameState, f: Field, c: CropId) {
  if (f.greenhouse) return 1; // watered by hand under glass
  const need = CROPS[c].water;
  let wf = clamp(1 - 1.6 * Math.max(0, need - f.moisture) - 0.8 * Math.max(0, f.moisture - Math.min(1, need + 0.35)), 0.15, 1);
  if ((has(s, 'droughtResistant') || s.research.licensed.includes('droughtLicense')) && c !== 'rice') wf = Math.max(wf, 0.7);
  if (f.irrigated && has(s, 'precisionIrrigation')) wf = Math.max(wf, 0.85);
  return wf;
}
export function tempFactor(s: GameState, f: Field, c: CropId) {
  if (f.greenhouse) return 1; // heated glass keeps the crop near its ideal
  const d = (s.regions[f.region].temp - CROPS[c].optTemp) / (CROPS[c].tempTol * 2.2);
  return clamp(1.03 - d * d, 0.2, 1.03);
}
export const techFactor = (s: GameState) => (has(s, 'improvedSeeds') ? 1.1 : 1) * (has(s, 'hybrids') ? 1.2 : 1) * (s.research.licensed.includes('droughtLicense') ? 1.03 : 1);
export const timingFactor = (s: GameState, f: Field) => {
  if (!f.crop) return 1;
  // fruit is picked steadily, so a long harvest counts its average lateness, not the last hour's
  const picking = f.pickStart !== undefined && f.work > 0 ? (s.tick - Math.max(f.pickStart, readyAt(f))) / 2 : 0;
  const late = s.tick - readyAt(f) - CONFIG.overripeGrace - picking;
  return late > 0 ? Math.max(0.4, 1 - late * CONFIG.overripeLoss) : 1;
};

/** Forecast for a field if planted now under current conditions (used by UI and managers). */
export function expectedYield(s: GameState, f: Field, c: CropId) {
  const base = f.ha * CONFIG.seedsPerHa * CROPS[c].yieldPerSeed;
  return base * soilFactor(f, c) * waterFactor(s, f, c) * tempFactor(s, f, c) * techFactor(s) * (REGIONS[f.region].suitability[c] ?? 0) * (1 - 0.6 * f.pest) * (1 - f.frost) * ageFactor(s, f, c);
}

/** Old orchards bear less: full yield until two years before the end of their life, then a decline to 40%. */
export function ageFactor(s: GameState, f: Field, c: CropId) {
  const per = CROPS[c].perennial;
  if (!per || f.crop !== c) return 1;
  const years = (s.tick - f.plantedAt) / TICKS_PER_YEAR;
  return clamp(1 - Math.max(0, years - (per.lifeYears - 2)) * 0.3, 0.4, 1);
}

/** Price multiplier for a stock's quality: 0.65 (grade B, mid) is the market's reference. */
export const qualityMult = (q: number) => clamp(1 + 0.4 * (q - 0.65), 0.74, 1.14);
export const grade = (q: number) => (q >= 0.8 ? 'A' : q >= 0.6 ? 'B' : 'C');

export function seedShortfall(s: GameState, f: Field, c: CropId) {
  const need = f.ha * CONFIG.seedsPerHa;
  const short = Math.max(0, need - s.seeds[c]);
  return { need, short, cost: round2(short * seedCost(s, c)) };
}

// ---------------------------------------------------------------- operations

/** Plants a field. `budget` is cash the caller may spend (player: all cash; automation: above reserve). */
export function plantField(s: GameState, f: Field, c: CropId, budget: number): string | null {
  if (f.crop) return 'Field is already planted.';
  if (!s.unlockedCrops.includes(c)) return `${GOODS[c].name} is not available yet.`;
  if (!canGrow(f, c)) return `${GOODS[c].name} cannot grow in ${REGIONS[f.region].name}.`;
  const { need, short, cost } = seedShortfall(s, f, c);
  if (cost > budget) return `Need $${cost.toFixed(2)} for ${Math.ceil(short)} ${GOODS[c].name.toLowerCase()} seeds.`;
  if (short > 0) {
    post(s, 'seeds', -cost, `${GOODS[c].name} seed`, f.region);
    s.seeds[c] += short;
  }
  s.seeds[c] -= need;
  s.stats.plantings++;
  f.crop = c;
  f.plantedAt = s.tick;
  f.cycleAt = s.tick + matureTicks(c); // orchards start fruiting once mature
  f.frost = 0;
  f.work = 0;
  f.acc = { temp: 0, water: 0, n: 0 };
  return null;
}

export function harvestField(s: GameState, f: Field, bruise = 0): HarvestBreakdown | null {
  if (!f.crop || !isReady(s, f)) return null;
  const c = f.crop;
  const def = CROPS[c];
  const n = Math.max(1, f.acc.n);
  const b: HarvestBreakdown = {
    crop: c,
    units: 0,
    base: f.ha * CONFIG.seedsPerHa * def.yieldPerSeed,
    soil: soilFactor(f, c),
    water: f.acc.water / n || waterFactor(s, f, c),
    weather: f.acc.temp / n || tempFactor(s, f, c),
    pest: 1 - 0.6 * f.pest,
    tech: techFactor(s),
    suitability: REGIONS[f.region].suitability[c] ?? 0,
    timing: timingFactor(s, f) * ageFactor(s, f, c),
    frost: 1 - f.frost,
    quality: 0,
  };
  b.units = Math.max(0, Math.round(b.base * b.soil * b.water * b.weather * b.pest * b.tech * b.suitability * b.timing * b.frost));
  // Quality: good soil, steady water and weather, few pests, timely picking. An agronomist lifts it a grade step.
  const agronomist = s.workers.some((w) => w.region === f.region && w.perk === 'agronomist');
  b.quality = clamp(0.2 + 0.35 * soilAdequacy(f, c) + 0.25 * Math.min(b.water, b.weather) + 0.2 * b.pest - 0.4 * (1 - timingFactor(s, f)) - 0.3 * f.frost + (agronomist ? 0.1 : 0) + (f.greenhouse ? 0.05 : 0) - bruise, 0, 1);
  // Nutrient removal; rotation and soybeans matter.
  const u = def.uptake;
  const hy = has(s, 'hybrids') ? 1.4 : 1;
  const nf = has(s, 'nitrogenFixing') && ['wheat', 'corn', 'rice'].includes(c) ? 0.5 : 1;
  f.soil.n = clamp(f.soil.n - (u.n > 0 ? u.n * hy * nf : u.n), 0, 1.5);
  f.soil.p = clamp(f.soil.p - u.p * hy, 0, 1.5);
  f.soil.k = clamp(f.soil.k - u.k * hy, 0, 1.5);
  f.soil.organic = clamp(f.soil.organic - 0.004, 0.05, 1);
  f.streak = f.lastCrop === c ? f.streak + 1 : 0;
  f.lastCrop = c;
  f.pest *= 0.5;
  f.frost = 0;
  if (def.perennial) f.cycleAt = s.tick; // trees stay; the next fruiting cycle starts now
  else f.crop = null;
  f.work = 0;
  f.lastHarvest = b;
  f.yields.push(round2(b.units / f.ha));
  if (f.yields.length > 12) f.yields.shift();
  s.stats.harvests++;
  s.stats.produced[c] = (s.stats.produced[c] ?? 0) + b.units;
  todayBook(s).produced += b.units;
  // Crop insurance pays when growing conditions (not management) cut the yield.
  const conditions = b.water * b.weather * b.pest;
  if (s.regions[f.region].insured && s.tick >= s.regions[f.region].insuredFrom && conditions < 0.75) {
    const payout = (0.75 - conditions) * b.base * b.suitability * b.tech * s.markets[f.region][c]!.price * 0.8;
    post(s, 'insurancePayout', payout, `Crop insurance: field ${f.id}`, f.region);
  }
  if (s.research.licensed.includes('droughtLicense')) post(s, 'royalties', -0.05 * b.units * s.markets[f.region][c]!.price, 'Seed licence royalty', f.region);
  const before = s.regions[f.region].inventory[c];
  addGoods(s, f.region, c, b.units, b.quality);
  // a dedicated field's harvest is held for its factory (only what actually fitted in storage)
  const mill = f.supplies ? s.buildings.find((x) => x.id === f.supplies) : undefined;
  if (mill && factoryCrop(mill) === c) mill.reserved = Math.min(reserveCap(mill), mill.reserved + Math.max(0, s.regions[f.region].inventory[c] - before));
  return b;
}

/** Uproot an orchard (or abandon a crop) to free the field. */
export function clearField(f: Field) {
  f.crop = null;
  f.work = 0;
  f.frost = 0;
}

export function fertilizeField(s: GameState, f: Field, source: 'fertilizer' | 'manure'): string | null {
  const inv = s.regions[f.region].inventory;
  const need = f.ha * (source === 'fertilizer' ? CONFIG.fertilizerPerHa * (has(s, 'precisionFert') ? 0.7 : 1) : CONFIG.manurePerHa);
  if (inv[source] < need) return `Need ${Math.ceil(need)} ${GOODS[source].name.toLowerCase()} in ${REGIONS[f.region].name} storage.`;
  if (f.spreading) return `Field ${f.id} is already waiting to be spread.`;
  inv[source] -= need;
  // with a crew in the region it's field work for them (tractors spread fastest); with none, a contractor does it at once
  if (s.workers.some((w) => w.region === f.region && w.role === 'hand') || s.machines.some((m) => m.region === f.region && MACHINES[m.type].autonomous && MACHINES[m.type].task === 'plant')) {
    f.spreading = source;
    f.spreadWork = 0;
    return null;
  }
  applySpread(s, f, source);
  post(s, 'maintenance', -4 * f.ha * s.macro.cpi, 'Spreading contractor', f.region);
  return null;
}

/** The soil effect of fertiliser or manure once it is on the field. */
export function applySpread(s: GameState, f: Field, source: 'fertilizer' | 'manure') {
  const dose = source === 'fertilizer' ? CONFIG.fertilizerDose : 0.12;
  const cap = has(s, 'precisionFert') ? 1.1 : 1.5;
  let overdose = false;
  for (const k of ['n', 'p', 'k'] as const) {
    const v = f.soil[k] + dose;
    if (v > 1.25) overdose = true;
    f.soil[k] = Math.min(cap, v);
  }
  if (source === 'manure') f.soil.organic = clamp(f.soil.organic + 0.04, 0, 1);
  if (overdose && !has(s, 'precisionFert')) {
    f.soil.organic = clamp(f.soil.organic - 0.03, 0.05, 1);
    s.corp.runoff++;
    s.corp.reputation = clamp(s.corp.reputation - 0.3, 0, 100);
  }
}

// ---------------------------------------------------------------- hourly field physics

export function fieldsTick(s: GameState) {
  const precision = has(s, 'precisionIrrigation');
  const drip = has(s, 'dripIrrigation');
  const winter = seasonOf(s) === 'Winter';
  for (const f of s.fields) {
    const reg = s.regions[f.region];
    const crop = f.crop;
    const resting = !!crop && !!CROPS[crop].perennial && winter && !f.greenhouse; // orchards sleep through winter
    const growing = !!crop && !resting; // only a growing crop needs water, sensors or heat
    if (f.greenhouse) {
      f.moisture = 0.6;
      if (crop && reg.temp < 12) reg.powerUse += f.ha * 5 * (12 - reg.temp) / 6; // heating
    }
    // orchards rest through winter: the fruiting cycle pauses
    if (crop && CROPS[crop].perennial && winter && !f.greenhouse && isMature(s, f) && !isReady(s, f)) f.cycleAt++;
    // water balance
    // Soil water relaxes toward a level set by today's rain, heat, crop demand and organic matter (retention).
    const eq = clamp(0.12 + reg.rainToday * 0.8 - (crop ? 0.08 : 0) - (reg.temp - 15) * 0.008 + (f.soil.organic - 0.5) * 0.1, 0, 1);
    f.moisture = clamp(f.moisture + (eq - f.moisture) * 0.04, 0, 1);
    if (growing && f.irrigated && f.moisture < s.automation.policies.irrigateMin) {
      const want = (s.automation.policies.irrigateMin - f.moisture) * f.ha;
      const capLeft = REGIONS[f.region].waterCap === Infinity ? Infinity : REGIONS[f.region].waterCap * irrigatedHa(s, f.region) - reg.waterToday;
      const units = Math.max(0, Math.min(want * CONFIG.irrigationWaterPerHa * 4, capLeft));
      if (units > 0) {
        const use = units * (precision ? 0.4 : drip ? 0.65 : 1);
        reg.waterToday += units;
        f.moisture = clamp(f.moisture + units / f.ha / (CONFIG.irrigationWaterPerHa * 4), 0, 1); // fills the gap this hour
        post(s, 'water', -use * REGIONS[f.region].waterPrice * s.macro.cpi, 'Irrigation water', f.region);
        reg.powerUse += units * 0.5;
      }
    }
    if (growing && f.irrigated && precision) reg.powerUse += f.ha;
    // orchards resting in winter, or still too young to fruit, have nothing for pests to eat: they shed them like a fallow field
    const dormant = crop && CROPS[crop].perennial && ((winter && !f.greenhouse) || !isMature(s, f));
    if (crop && !dormant) {
      f.acc.temp += tempFactor(s, f, crop);
      f.acc.water += waterFactor(s, f, crop);
      f.acc.n++;
      // trees are meant to stay, so orchards get no repeat-crop penalty
      const pressure = 0.0006 * (1 + (CROPS[crop].perennial ? 0 : Math.min(f.streak, 5)) * 0.5) * (reg.temp > 18 ? 1.3 : 1) * (has(s, 'pestResistant') ? 0.4 : 1) * (1 + 0.04 * s.macro.climate);
      f.pest = clamp(f.pest + pressure + 0.008 * severity(s, 'pests', f.region, crop), 0, 1);
      // regen while growing is slow
      regen(f, 0.00008);
      if (s.tick === readyAt(f) && f.ha <= 1) log(s, 'info', `Field ${f.id}: ${GOODS[crop].name} is ready to harvest.`, 'fields');
    } else {
      f.pest = Math.max(0, f.pest - 0.01);
      regen(f, has(s, 'coverCrops') ? 0.0008 : 0.0004);
      f.soil.organic = clamp(f.soil.organic + (has(s, 'coverCrops') ? 0.0001 : 0.00004), 0, 0.9);
    }
  }
}

/** Frost night: tender crops outdoors are damaged; seedlings die. Returns fields hit. */
export function frostNight(s: GameState, r: RegionId) {
  let hit = 0, killed = 0;
  for (const f of s.fields) {
    if (f.region !== r || !f.crop || f.greenhouse || CROPS[f.crop].frostHardy) continue;
    if (growth(s, f) < 0.25) (clearField(f), killed++);
    else f.frost = Math.min(0.8, f.frost + 0.2);
    hit++;
  }
  return { hit, killed };
}

function regen(f: Field, rate: number) {
  const ceiling = 0.55 + 0.35 * f.soil.organic;
  for (const k of ['n', 'p', 'k'] as const) if (f.soil[k] < ceiling) f.soil[k] += (ceiling - f.soil[k]) * rate * 10;
}

export const irrigatedHa = (s: GameState, r: RegionId) => s.fields.reduce((a, f) => a + (f.region === r && f.irrigated ? f.ha : 0), 0);

// ---------------------------------------------------------------- storage

/** Adds produced goods to regional storage. Overflow is sold immediately or, failing that, lost. */
export function addGoods(s: GameState, r: RegionId, g: GoodId, qty: number, quality = 0.65) {
  if (qty <= 0) return;
  const room = freeSpace(s, r, g);
  const keep = Math.min(qty, room);
  // stock quality is the running average of everything that went in
  const reg = s.regions[r];
  const held = reg.inventory[g];
  reg.quality[g] = held + keep > 0 ? ((reg.quality[g] ?? 0.65) * held + quality * keep) / (held + keep) : quality;
  s.regions[r].inventory[g] += keep;
  const over = qty - keep;
  if (over <= 0) return;
  if (s.markets[r][g]) {
    s.regions[r].inventory[g] += over;
    const q = executeSell(s, r, g, over, `Forced sale: storage full (${Math.round(over)} ${GOODS[g].name})`);
    s.stats.forcedSales++;
    const lost = over - q.qty;
    if (lost > 0) {
      s.regions[r].inventory[g] -= lost;
      s.stats.overflowLost += lost;
    }
    warnOnce(s, `overflow-${r}`, 'warning', `${REGIONS[r].name} storage is full — ${Math.round(over)} ${GOODS[g].name.toLowerCase()} had to be sold at once${lost > 0 ? ` (${Math.round(lost)} lost)` : ''}. Build storage or sell sooner.`, 'storage');
  } else {
    s.stats.overflowLost += over;
    warnOnce(s, `overflow-${r}`, 'warning', `${REGIONS[r].name} storage is full — ${Math.round(over)} ${GOODS[g].name.toLowerCase()} was lost.`, 'storage');
  }
}

export function warnOnce(s: GameState, key: string, level: 'warning' | 'critical' | 'info' | 'opportunity', text: string, page?: string, every = 24) {
  if ((s.warned[key] ?? -Infinity) > s.tick - every) return;
  s.warned[key] = s.tick;
  log(s, level, text, page);
}

/** Share of each good in a region's store that spoils today (cold goods out of the cold store rot much faster). */
export function spoilRates(s: GameState, r: RegionId) {
  const coldChain = has(s, 'coldChain') ? 0.5 : 1;
  const silo = buildingsIn(s, r, 'silo').length > 0 ? 0.5 : 1;
  const st = stored(s, r);
  const coldTotal = st.cold + st.coldOverflow;
  const improperShare = coldTotal > 0 ? st.coldOverflow / coldTotal : 0;
  const rate = (g: GoodId) => {
    const def = GOODS[g];
    if (def.storage === 'cold') return (1 - improperShare) * def.spoilProper * coldChain + improperShare * def.spoilImproper;
    return def.kind === 'crop' ? def.spoilProper * silo : def.spoilProper;
  };
  return { rate, coldOverflow: st.coldOverflow };
}

/** Value of stock expected to spoil per day at today's prices, across all regions. */
export function spoilValue(s: GameState) {
  let v = 0;
  for (const reg of Object.values(s.regions)) {
    if (!reg.unlocked) continue;
    const { rate } = spoilRates(s, reg.id);
    for (const g in reg.inventory) v += reg.inventory[g as GoodId] * rate(g as GoodId) * (s.markets[reg.id][g as GoodId]?.price ?? GOODS[g as GoodId].basePrice);
  }
  return v;
}

export function spoilageDaily(s: GameState) {
  for (const r of Object.values(s.regions)) {
    if (!r.unlocked) continue;
    const { rate, coldOverflow } = spoilRates(s, r.id);
    if (coldOverflow > 1) warnOnce(s, `coldspill-${r.id}`, 'warning', `${Math.round(coldOverflow).toLocaleString('en-US')} units of chilled goods don't fit in your cold stores in ${REGIONS[r.id].name} and are rotting fast. Sell milk, eggs and other chilled stock first; build cold stores only for what you can't sell.`, 'storage', 48);
    for (const g in r.inventory) {
      const q = r.inventory[g as GoodId];
      if (!q) continue;
      const lost = q * rate(g as GoodId);
      if (lost <= 0) continue;
      r.inventory[g as GoodId] = q - lost;
      s.stats.spoiled += lost * (s.markets[r.id][g as GoodId]?.price ?? GOODS[g as GoodId].basePrice);
    }
  }
}
