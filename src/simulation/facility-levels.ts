// Shared operational capacity rules for facilities without a goods recipe.
// No financial postings or state mutation: simulation and forecasts use the same rules.
import { BUILDINGS, GOODS, type GoodId, type RegionId } from './config';
import { levelMult } from './core';
import type { Building, GameState } from './types';

export function solarCapacity(b: Pick<Building, 'type' | 'level'>): number {
  return (BUILDINGS[b.type].solarKw ?? 0) * levelMult(b.level);
}

/** A region has one retail channel. Duplicating centres never stacks their premiums. */
export function retailRate(level: number): number {
  return .12 + .03 * Math.max(0, Math.min(2, (level || 1) - 1));
}

export function bestRetailCentre(list: readonly Building[]): Building | undefined {
  return list.filter(b => b.type === 'distribution' && b.active)
    .sort((a,b) => b.level - a.level || a.id - b.id)[0];
}

export function retailChannel(s: GameState, region: RegionId): number {
  let rate = 0;
  for (const b of s.buildings) {
    if (b.type === 'distribution' && b.region === region && b.active) rate = Math.max(rate, retailRate(b.level));
  }
  return rate;
}

/** Retail shoppers are finite. Repeating a same-tick buy/resell cannot create unlimited markup. */
export function retailAllowance(s:GameState,region:RegionId,good:GoodId) {
  if(GOODS[good].kind!=='processed')return {limit:0,left:0};
  const limit=(s.markets[region][good]?.d0??0)*24;
  return {limit,left:Math.max(0,limit-(s.regions[region].retailToday[good]??0))};
}
