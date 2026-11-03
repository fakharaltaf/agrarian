// Production-line economics for the UI: one source of truth for what a group of same-type
// facilities in a region earns per day, what pausing it really saves, the prices it needs
// to break even, and whether upgrading would pay. Everything is valued at today's prices.
import { ANIMALS, BUILDINGS, CONFIG, COWS_PER_DAIRY_BATCH, type BuildingType, type GoodId, type RegionId } from './config';
import { buildingDivision, electricityPrice, execOn, has, levelMult, priceUsd } from './core';
import { upgradeCost } from './engine';
import { MANURE } from './livestock';
import type { Building, GameState } from './types';

/** One facility as the economics see it: its level and how many batches an hour it runs. */
interface Unit { level: number; bph: number }

export interface LineEcon {
  earn: number; inputs: number; staff: number; power: number;
  /** Profit of the facilities themselves, per day. */
  profit: number;
  /** What the inputs would earn anyway if the line stopped (a dairy's cows go back to the cowshed). */
  alt: number;
  /** profit − alt: what running the line is actually worth over pausing it, per day. */
  worth: number;
  /** Net units per day of each good that moves `worth` with its price (outputs +, inputs −). */
  qty: Partial<Record<GoodId, number>>;
}

/** Average price over the last 24 hours: the cards value lines on it so one sale's dip doesn't flip them red. */
export function dayPrice(s: GameState, r: RegionId, g: GoodId) {
  const h = s.markets[r][g]?.history.slice(-24 / CONFIG.priceHistoryEvery);
  return h?.length ? h.reduce((a, x) => a + x, 0) / h.length : priceUsd(s, r, g);
}

const outMult = (s: GameState) => (has(s, 'processEfficiency') ? 1.1 : 1);
const kwhMult = (s: GameState, kwh: number) => (has(s, 'foodTech') && kwh > 0 ? 0.7 : 1);
const staffDay = (s: GameState, t: BuildingType, level: number) =>
  BUILDINGS[t].staffPerHour * s.macro.cpi * (execOn(s, buildingDivision(t)) ? 0.92 : 1) * (1 + 0.3 * ((level || 1) - 1)) * 24;

function cowsheds(s: GameState, r: RegionId) {
  const h = s.herds.find((x) => x.region === r && x.animal === 'cows');
  return { count: h?.count ?? 0, yieldK: h ? h.health * h.fed : 1 };
}

function econOf(s: GameState, t: BuildingType, r: RegionId, units: Unit[]): LineEcon {
  const rec = BUILDINGS[t].recipe!;
  const p = (g: GoodId) => dayPrice(s, r, g);
  const elec = electricityPrice(s, r);
  const batches = units.reduce((a, u) => a + u.bph, 0) * 24; // per day
  const qty: Partial<Record<GoodId, number>> = {};
  const add = (g: GoodId, q: number) => (qty[g] = (qty[g] ?? 0) + q);
  let earn = 0, inputs = 0;
  for (const [g, q] of Object.entries(rec.outputs) as [GoodId, number][]) { earn += q * outMult(s) * batches * p(g); add(g, q * outMult(s) * batches); }
  for (const [g, q] of Object.entries(rec.inputs) as [GoodId, number][]) { inputs += q * batches * p(g); add(g, -q * batches); }
  const kwh = rec.kwh * kwhMult(s, rec.kwh) * batches;
  if (kwh < 0) earn += -kwh * elec;
  const power = Math.max(0, kwh) * elec;
  const staff = units.reduce((a, u) => a + staffDay(s, t, u.level), 0);
  const profit = earn - inputs - staff - power;
  let alt = 0;
  if (t === 'dairy') {
    // paused, these cows live in the cowshed: they eat the same feed and give milk at the cowshed rate
    const c = ANIMALS.cows;
    const cows = Math.min(cowsheds(s, r).count, (batches / 24) * COWS_PER_DAIRY_BATCH);
    const k = cowsheds(s, r).yieldK;
    alt = cows * (c.perDay * k * p('milk') + MANURE.cows * p('manure') - c.feedPerDay * p('feed'));
    add('milk', -cows * c.perDay * k);
    add('manure', -cows * MANURE.cows);
    add('feed', cows * c.feedPerDay);
  }
  return { earn, inputs, staff, power, profit, alt, worth: profit - alt, qty };
}

const units = (list: Building[], full = false): Unit[] =>
  list.filter((b) => b.active || full).map((b) => ({ level: b.level || 1, bph: full ? BUILDINGS[b.type].recipe!.batchesPerHour * levelMult(b.level) : b.stats.out }));

/** A dairy can only run as many batches as there are cows to milk. */
function capByCows(s: GameState, t: BuildingType, r: RegionId, us: Unit[]): Unit[] {
  if (t !== 'dairy') return us;
  let cows = cowsheds(s, r).count;
  return us.map((u) => { const bph = Math.min(u.bph, cows / COWS_PER_DAIRY_BATCH); cows -= bph * COWS_PER_DAIRY_BATCH; return { ...u, bph: Math.max(0, bph) }; });
}

/** The line at its current pace (smoothed batches), or, if `full`, flat out with every unit running. */
export function lineEcon(s: GameState, list: Building[], full = false): LineEcon {
  const t = list[0].type, r = list[0].region;
  return econOf(s, t, r, full ? capByCows(s, t, r, units(list, true)) : units(list));
}

export interface Target { good: GoodId; side: 'sell' | 'buy'; now: number; need: number; change: number }

/** Prices that would make a losing line break even, one at a time with everything else held. */
export function breakEven(s: GameState, e: LineEcon, r: RegionId): Target[] {
  if (e.worth >= 0) return [];
  const out: Target[] = [];
  for (const [g, q] of Object.entries(e.qty) as [GoodId, number][]) {
    if (g === 'manure' || Math.abs(q) < 1e-6) continue;
    const now = dayPrice(s, r, g);
    const need = now - e.worth / q; // worth + (need − now)·q = 0
    if (need <= 0 || now <= 0) continue; // no positive price fixes it
    out.push({ good: g, side: q > 0 ? 'sell' : 'buy', now, need, change: need / now - 1 });
  }
  return out.sort((a, b) => Math.abs(a.change) - Math.abs(b.change));
}

export interface Upgrade { cost: number; worthAfter: number; gain: number; level: number; blocked?: string }

/** One level up for every unit below the top level, at the current pace scaled by capacity. Null when maxed. */
export function upgradeOutlook(s: GameState, list: Building[]): Upgrade | null {
  const t = list[0].type, r = list[0].region;
  const up = list.filter((b) => b.active && (b.level || 1) < 3);
  if (!up.length || !BUILDINGS[t].recipe) return null;
  const level = Math.min(...up.map((b) => b.level || 1)) + 1;
  const cost = up.reduce((a, b) => a + upgradeCost(s, b), 0);
  const now = lineEcon(s, list).worth;
  const short = list.some((b) => b.active && b.reason && b.reason !== 'Not enough cows' && b.util < 0.85);
  if (short) return { cost, worthAfter: now, gain: 0, level, blocked: 'It already runs short of inputs, so more capacity would sit idle.' };
  // capacity grows with the level multiplier; staff by 30% a level
  const after = capByCows(s, t, r, list.filter((b) => b.active).map((b) => {
    const L = (b.level || 1) < 3 ? (b.level || 1) + 1 : b.level || 1;
    return { level: L, bph: b.stats.out * (levelMult(L) / levelMult(b.level)) };
  }));
  const worthAfter = econOf(s, t, r, after).worth;
  const blocked = t === 'dairy' && after.reduce((a, u) => a + u.bph, 0) < list.filter((b) => b.active).reduce((a, b) => a + b.stats.out * levelMult(Math.min(3, (b.level || 1) + 1)) / levelMult(b.level), 0) - 1e-6
    ? 'You would need more cows to fill the bigger dairy.' : undefined;
  return { cost, worthAfter, gain: worthAfter - now, level, blocked };
}
