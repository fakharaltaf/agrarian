// Scenario planner: runs the real engine forward twice from the same state and random seed —
// once as-is, once with the player's assumptions — so differences come only from the assumptions.
import { GOODS, TICKS_PER_DAY, type GoodId, type RegionId } from './config';
import { equity, post } from './core';
import { advance, parcelPrice } from './engine';
import { chooseCrop } from './automation';
import { newField } from './agriculture';
import { incomeStatement } from './statements';
import type { GameState } from './types';

export interface ScenarioInput {
  days: number;
  priceGood?: GoodId;
  pricePct?: number; // e.g. -0.2 = prices 20% lower
  energyPct?: number; // fuel, fertiliser, electricity
  wagePct?: number;
  buyRegion?: RegionId;
  buyHa?: number;
}

export interface ScenarioResult {
  days: number;
  base: { cash: number[]; equity: number[]; revenue: number; opex: number; net: number };
  scen: { cash: number[]; equity: number[]; revenue: number; opex: number; net: number };
  assumptions: string[];
}

function apply(s: GameState, i: ScenarioInput): string[] {
  const notes: string[] = [];
  if (i.priceGood && i.pricePct) {
    const k = 1 + i.pricePct;
    for (const r in s.markets) {
      const m = s.markets[r as RegionId][i.priceGood];
      if (!m) continue;
      // a persistent price change is modelled as a change in supply that clears at the new price
      const shift = k ** -(GOODS[i.priceGood].elasticity + 0.25);
      m.bg0 *= shift;
      m.bg *= shift;
      m.sent += Math.log(k);
    }
    notes.push(`${GOODS[i.priceGood].name} prices ${pct(i.pricePct)} through a supply shift`);
  }
  if (i.energyPct) {
    s.macro.energy *= 1 + i.energyPct;
    notes.push(`Energy ${pct(i.energyPct)} (fuel, fertiliser, electricity follow)`);
  }
  if (i.wagePct) {
    for (const r in s.regions) s.regions[r as RegionId].cpi *= 1 + i.wagePct;
    notes.push(`Local wages and land ${pct(i.wagePct)}`);
  }
  if (i.buyRegion && i.buyHa) {
    const price = parcelPrice(s, i.buyRegion, i.buyHa);
    post(s, 'land', -price, 'Scenario land purchase', i.buyRegion);
    const f = newField(s, i.buyRegion, i.buyHa, price);
    f.plan = chooseCrop(s, f);
    s.fields.push(f);
    notes.push(`Buy ${i.buyHa} ha in ${i.buyRegion} for $${Math.round(price).toLocaleString()}, planted by your current workforce and policies`);
  }
  notes.push('No new player decisions: only workers, managers, policies and rules act');
  return notes;
}
const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

function run(s: GameState, days: number) {
  const cash: number[] = [], eq: number[] = [];
  const startDay = s.books.length;
  for (let d = 0; d < days; d++) {
    advance(s, TICKS_PER_DAY);
    cash.push(Math.round(s.cash));
    eq.push(Math.round(equity(s)));
  }
  const used = Math.min(days, s.books.length - startDay + 1);
  const is = incomeStatement(s, used);
  return { cash, equity: eq, revenue: is.revenue, opex: is.opex, net: is.net };
}

export function runScenario(state: GameState, input: ScenarioInput): ScenarioResult {
  const days = Math.max(1, Math.min(120, Math.round(input.days)));
  const base = structuredClone(state);
  const scen = structuredClone(state);
  const assumptions = apply(scen, input);
  return { days, base: run(base, days), scen: run(scen, days), assumptions };
}
