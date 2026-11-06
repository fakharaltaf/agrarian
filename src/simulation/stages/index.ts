import type { GameState } from '../types';
import type { Action } from '../types';
import { city } from './city';
import { farmBusiness } from './farm-business';
import { frontier } from './frontier';
import { homestead } from './homestead';
import { industry } from './industry';
import { marketTown } from './market-town';
import { nation } from './nation';
import { region } from './region';
import { settlement } from './settlement';
import { town } from './town';
import type { StageId, StageModule } from './types';

export { STAGE_IDS, type StageId, type StageModule } from './types';
export const STAGES: Readonly<Record<StageId, StageModule>> = Object.fromEntries(
  [homestead, marketTown, farmBusiness, industry, settlement, town, city, region, nation, frontier].map((stage) => [stage.id, stage]),
) as Record<StageId, StageModule>;

/** Map saves on today's eight eras into the narrative stage without changing their era. */
export function stageIdForEra(era: number): StageId {
  if (era <= 1) return 'homestead';
  if (era === 2) return 'market-town';
  if (era === 3) return 'farm-business';
  if (era <= 5) return 'industry';
  if (era === 6) return 'region';
  if (era === 7) return 'city';
  return 'nation';
}

const ORDERED_STAGES: readonly StageId[] = ['homestead','market-town','farm-business','industry','settlement','town','city','region','nation','frontier'];
export const NEXT_STAGE: Readonly<Partial<Record<StageId, StageId>>> = Object.fromEntries(
  ORDERED_STAGES.slice(0, -1).map((id, i) => [id, ORDERED_STAGES[i + 1]]),
) as Partial<Record<StageId, StageId>>;

/** Capability gates: old saves retain their original era gates; new farms follow the chapter path. */
export function stageAtLeast(s: GameState, target: StageId) {
  if (!s.legacyProgression) return ORDERED_STAGES.indexOf(s.stageId) >= ORDERED_STAGES.indexOf(target);
  const oldEra: Partial<Record<StageId, number>> = {
    homestead: 1, 'market-town': 1, 'farm-business': 2, industry: 4,
    settlement: 99, town: 6, city: 7, region: 6, nation: 8, frontier: 99,
  };
  if (target === 'market-town') return s.stats.harvests > 0;
  return s.era >= (oldEra[target] ?? 99);
}

/** Translate existing numeric feature gates into the new chapter path. */
export function featureEra(s: GameState, era: number) {
  if (s.legacyProgression) return s.era >= era;
  const target: StageId = era <= 1 ? 'homestead' : era === 2 ? 'farm-business' : era <= 5 ? 'industry' : era === 6 ? 'region' : era === 7 ? 'city' : 'nation';
  return stageAtLeast(s, target);
}

export function eraUnlockAvailable(s: GameState, targetEra: number) {
  const stage = Object.values(STAGES).find((candidate) => candidate.eraUnlocks[targetEra] !== undefined);
  return stage?.eraUnlocks[targetEra]?.(s) ?? false;
}

export function tickActiveStage(s: GameState) {
  const stage = STAGES[s.stageId] ?? STAGES[stageIdForEra(s.era)];
  const state = (s.stageState[stage.id] ??= stage.createState());
  for (const [key, value] of Object.entries(stage.createState())) if (state[key] === undefined) state[key] = value;
  stage.tick(s, state);
}

export function handleActiveStageAction(s: GameState, action: Action) {
  if (action.type === 'sellToMill' || action.type === 'barter' || action.type === 'haggle' || action.type === 'chooseCharter') {
    const stage = STAGES.homestead;
    const state = (s.stageState.homestead ??= stage.createState());
    for (const [key, value] of Object.entries(stage.createState())) if (state[key] === undefined) state[key] = value;
    return stage.handleAction(s, action, state);
  }
  const stage = STAGES[s.stageId] ?? STAGES[stageIdForEra(s.era)];
  const state = (s.stageState[stage.id] ??= stage.createState());
  for (const [key, value] of Object.entries(stage.createState())) if (state[key] === undefined) state[key] = value;
  return stage.handleAction(s, action, state);
}
