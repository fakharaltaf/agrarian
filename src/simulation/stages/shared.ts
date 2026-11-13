import type { GameState } from '../types';
import { BUILDINGS } from '../config';
import { FOOD_FACTORY } from '../core';

export const noStageAction = () => null;

export const lifetimeSales = (s: GameState) => (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);
export const totalHa = (s: GameState) => s.fields.reduce((n, f) => n + f.ha, 0);
/** Food production houses actually at work: running, with a road, and busy at least a quarter of the time. */
export const workingFactories = (s: GameState) => s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing' && b.type !== 'oilWell' && b.type !== 'refinery' && b.active && b.util >= 0.25).length;
/** The farm's own energy: oil (wells, a refinery) or clean (wind, solar, biogas), counted by working buildings. */
export function energyMix(s: GameState) {
  const on = s.buildings.filter((b) => b.active);
  return { oil: on.filter((b) => b.type === 'oilWell' || b.type === 'refinery').length, clean: on.filter((b) => b.type === 'windTurbine' || b.type === 'solar' || b.type === 'biogas').length };
}
const LATER = new Set(['settlement', 'town', 'city', 'region', 'nation', 'frontier']);
/** Oil comes after the production houses: exploration opens with two of them working (and stays open once found, or in later chapters). */
export const oilOpen = (s: GameState) => s.legacyProgression ? s.era >= 4
  : LATER.has(s.stageId) || (s.stageId === 'industry' && (workingFactories(s) >= 2 || s.buildings.some((b) => b.type === 'oilWell')));
/** Why a food production house cannot grow past its first level yet: it needs the farm's own energy. Null when it may. */
export const upgradeNeedsPower = (s: GameState, b: { type: string }) => {
  if (s.legacyProgression || !FOOD_FACTORY.has(b.type)) return null;
  const m = energyMix(s);
  return m.oil + m.clean ? null : 'Needs your own power: drill for oil, or build a wind turbine, solar farm or biogas plant.';
};
export const factoryCount = (s: GameState) => s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').length;
