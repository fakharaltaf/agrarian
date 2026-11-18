// Field upgrades: a field is improved in levels, as a factory is, each unlocked by research.
// Balance rule: with the research that unlocks it, a level-N field grows what a level-N food factory uses
// (level 2 ≈ 2× and level 3 ≈ 4× today's harvest), so the land that fed a mill keeps feeding it as the mill grows.
import { TECH } from './config';
import { has } from './core';
import type { Field, GameState } from './types';

export interface FieldLevel { name: string; yield: number; /** research it needs */ needs: string[]; /** USD per hectare at today's prices */ pricePerHa: number; /** nutrients taken per harvest, and irrigation water billed, as multiples of level 1 */ uptake: number; water: number; does: string }
export const FIELD_LEVELS: FieldLevel[] = [
  { name: 'Field', yield: 1, needs: [], pricePerHa: 0, uptake: 1, water: 1, does: '' },
  { name: 'Improved field', yield: 1.8, needs: ['improvedSeeds', 'dripIrrigation'], pricePerHa: 2000, uptake: 1.3, water: 1.2, does: 'Raised beds, drip lines and a better seedbed: ×1.8 yield. Takes 30% more nutrients and 20% more water.' },
  { name: 'Intensive field', yield: 3, needs: ['hybrids', 'precisionIrrigation'], pricePerHa: 3200, uptake: 1.6, water: 1.4, does: 'Sensors, variable-rate feeding and controlled traffic: ×3 yield. Takes 60% more nutrients and 40% more water.' },
];
export const fieldLevel = (f: Pick<Field, 'level'>) => Math.max(1, Math.min(3, f.level ?? 1));
export const levelOfField = (f: Pick<Field, 'level'>) => FIELD_LEVELS[fieldLevel(f) - 1];
export const fieldUpgradePrice = (s: GameState, f: Field) => Math.round(f.ha * FIELD_LEVELS[Math.min(2, fieldLevel(f))].pricePerHa * s.macro.cpi);
/** Why this field can't go up a level now (money aside), or null when it can. */
export function fieldUpgradeProblem(s: GameState, f: Field): string | null {
  const lv = fieldLevel(f);
  if (lv >= 3) return 'Already an intensive field.';
  const next = FIELD_LEVELS[lv], missing = next.needs.filter((t) => !has(s, t));
  if (missing.length) return `Research ${missing.map((t) => TECH[t].name).join(' and ')} first.`;
  if (!f.irrigated && !f.greenhouse && (f.cover ?? 0) < 3) return 'Irrigate it first.';
  return null;
}
/** The research the farm has done that lifts every harvest, as the "Included:" line shows it. */
export function fieldResearchIncluded(s: GameState): string[] {
  return [has(s, 'improvedSeeds') && 'Improved seeds +10% yield', has(s, 'hybrids') && 'High-yield hybrids +20% yield', has(s, 'precisionFert') && 'Precision fertilisation −30% fertiliser', has(s, 'dripIrrigation') && 'Drip irrigation −35% water', has(s, 'precisionIrrigation') && 'Precision irrigation −60% water', has(s, 'mech2') && 'Efficient drivetrains: machines 30% faster'].filter(Boolean) as string[];
}
