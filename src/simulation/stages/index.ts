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

export function eraUnlockAvailable(s: GameState, targetEra: number) {
  const stage = Object.values(STAGES).find((candidate) => candidate.eraUnlocks[targetEra] !== undefined);
  return stage?.eraUnlocks[targetEra]?.(s) ?? false;
}

export function tickActiveStage(s: GameState) {
  const stage = STAGES[s.stageId] ?? STAGES[stageIdForEra(s.era)];
  const state = (s.stageState[stage.id] ??= stage.createState());
  stage.tick(s, state);
}

export function handleActiveStageAction(s: GameState, action: Action) {
  const stage = STAGES[s.stageId] ?? STAGES[stageIdForEra(s.era)];
  const state = (s.stageState[stage.id] ??= stage.createState());
  return stage.handleAction(s, action, state);
}
