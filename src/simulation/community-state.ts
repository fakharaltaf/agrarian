// Structural helpers only: no engine, UI or accounting dependencies.
import type { GameState, HomeTier, SettlementState } from './types';
export const HOME_DEFS: Record<HomeTier, { name: string; families: number; cost: number }> = {
  cottage: { name: 'Cottage', families: 1, cost: 5000 },
  terrace: { name: 'Terrace', families: 4, cost: 13000 },
  apartment: { name: 'Apartment', families: 12, cost: 35000 },
};
export function createSettlementState(): SettlementState {
  return { active: false, charter: null, homes: [], cohorts: [], householdCash: 0, happiness: 0.7, fed: 1, warm: 1, autoLarder: true, larderHold: {}, lastDay: -1, enteredAt: -1, hardshipDays: 0 };
}
export function communityOf(s: GameState): SettlementState {
  return (s.stageState.settlement ??= createSettlementState() as unknown as Record<string, unknown>) as unknown as SettlementState;
}
export const households = (s: GameState) => communityOf(s).cohorts.reduce((n, c) => n + c.households, 0);
export const population = (s: GameState) => households(s) * 4;
export const homeCapacity = (s: GameState) => communityOf(s).homes.reduce((n, h) => n + HOME_DEFS[h.tier].families * h.count * 4, 0);
export const residentWorkers = (s: GameState) => s.workers.filter(w => w.resident && w.region === 'heartland').length;
export const availableResidents = (s: GameState) => Math.max(0, households(s) * 2 - residentWorkers(s));
export const housingAssets = (s: GameState) => ((s.stageState.settlement as unknown as SettlementState | undefined)?.homes ?? []).reduce((n, h) => n + h.cost, 0);
export const residentPayFactor = (s: GameState, additional = 0) => Math.max(0.85, Math.min(1.25, 0.85 + (residentWorkers(s) + additional) / Math.max(1, households(s) * 2) * 0.4));
export const homePrice = (s: GameState, tier: HomeTier) => Math.round(HOME_DEFS[tier].cost * s.macro.cpi * (communityOf(s).charter === 'free' ? 0.6 : 1) * 100) / 100;
