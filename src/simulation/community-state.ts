// Structural helpers only: no engine, UI or accounting dependencies.
import type {CityState} from './city-state';
import type { GameState, HomeTier, SettlementState, TownState } from './types';
export const HOME_DEFS: Record<HomeTier, { name: string; families: number; cost: number }> = {
  cottage: { name: 'Cottage', families: 1, cost: 5000 },
  terrace: { name: 'Terrace', families: 3, cost: 13000 },
  apartment: { name: 'Apartment', families: 8, cost: 35000 },
};
export function createSettlementState(): SettlementState {
  return { active: false, charter: null, homes: [], cohorts: [], householdCash: 0, happiness: 0.7, fed: 1, warm: 1, autoLarder: true, larderHold: {}, lastDay: -1, enteredAt: -1, hardshipDays: 0, payCut: 0, housingTax: 0, families: {} };
}
export function communityOf(s: GameState): SettlementState {
  return (s.stageState.settlement ??= createSettlementState() as unknown as Record<string, unknown>) as unknown as SettlementState;
}
export const households = (s: GameState) => communityOf(s).cohorts.reduce((n, c) => n + c.households, 0);
export const workingAdults = (s: GameState) => communityOf(s).cohorts.reduce((n,c)=>n+c.adults,0);
export const children = (s: GameState) => communityOf(s).cohorts.reduce((n,c)=>n+c.children,0);
export const population = (s: GameState) => workingAdults(s) + children(s);
export const homeCapacity = (s: GameState) => communityOf(s).homes.reduce((n, h) => n + HOME_DEFS[h.tier].families * h.count * 4, 0);
/** Families the homes can take (one family per cottage, three per terrace, eight per apartment block). */
export const homeFamilies = (s: GameState) => communityOf(s).homes.reduce((n, h) => n + HOME_DEFS[h.tier].families * h.count, 0);
/** A worker's family: 3–5 people including the worker (two adults and their children). */
export const familySize = (workerId: number) => 3 + ((Math.imul(workerId, 2654435761) >>> 0) % 3);
export const familiesHere = (s: GameState) => Object.keys(communityOf(s).families ?? {}).length;
export const residentWorkers = (s: GameState) => s.workers.filter(w => w.resident && w.region === 'heartland').length;
export const civicJobs = (s: GameState) => {
  const t = s.stageState.town as unknown as TownState | undefined;
  return t?.active ? t.publicJobs + t.industrialJobs + neighbourJobs(s) : 0;
};
export const availableResidents = (s: GameState) => Math.max(0, workingAdults(s) - residentWorkers(s) - civicJobs(s));
export const housingAssets = (s: GameState) => ((s.stageState.settlement as unknown as SettlementState | undefined)?.homes ?? []).reduce((n, h) => n + h.cost, 0);
export const residentPayFactor = (s: GameState, additional = 0) => Math.max(0.85, Math.min(1.25, 0.85 + (residentWorkers(s) + civicJobs(s) + additional) / Math.max(1, workingAdults(s)) * 0.4));
export const homePrice = (s: GameState, tier: HomeTier) => Math.round(HOME_DEFS[tier].cost * s.macro.cpi * 100) / 100;

export const neighbourJobs=(s:GameState)=>{const c=s.stageState.city as unknown as CityState|undefined;return c?.active?c.neighbourJobs:0;};
/** A premium offer can attract an already-employed adult; no extra person is created. */
export const recruitableResidents=(s:GameState,wageFactor:number)=>availableResidents(s)+(wageFactor>=1.1?neighbourJobs(s):0);
