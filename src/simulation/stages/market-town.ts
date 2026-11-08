import type { StageModule } from './types';
import { lifetimeSales, noStageAction } from './shared';
import { startMarketDay } from '../events';
import { CROPS, CROP_IDS } from '../config';
import { log } from '../core';
import type { GameState } from '../types';

type MarketTownState = { lastMarketDay: number };
const marketGood = (s: GameState, day: number) => {
  const candidates = CROP_IDS.filter((g) => s.unlockedCrops.includes(g) && !CROPS[g].perennial);
  return candidates[Math.floor(day / 7) % candidates.length] ?? 'wheat';
};
/** The weekly market day: days until it (0 = today), the good buyers will want, and whether it is running now. */
export function nextMarketDay(s: GameState) {
  const day = Math.floor(s.tick / 24), inDays = (7 - (day % 7)) % 7;
  const state = s.stageState['market-town'] as MarketTownState | undefined;
  return { inDays, good: marketGood(s, day + inDays), running: inDays === 0 && state?.lastMarketDay === day && s.tick < day * 24 + 12 };
}
function tickMarketTown(s: GameState, state: Record<string, unknown>) {
  if (s.legacyProgression) return;
  const day = Math.floor(s.tick / 24);
  if (day % 7 === 6 && s.tick === day * 24 + 8) log(s, 'opportunity', `Tomorrow is market day for ${marketGood(s, day + 1)}. Hold some back to sell while buyers are in town.`, 'markets');
  if (day % 7 !== 0 || (state.lastMarketDay as number) === day) return;
  const good = marketGood(s, day);
  if (!startMarketDay(s, good)) return;
  state.lastMarketDay = day;
  log(s, 'opportunity', `Market day: extra local demand for ${good}. Sell while buyers are in town.`, 'markets');
}

export const marketTown: StageModule = {
  id: 'market-town', title: 'Market Town', legacyEras: [2],
  eraUnlocks: { 2: (s) => s.fields.length >= 4 && lifetimeSales(s) >= 12_000 },
  actionTypes: ['sell','buy','openFutures','closeFutures','acceptContract','ship'],
  tips: ['era2','crops'], discoveries: ['marketDay','forecast','chickens','frost','quality','upgrades'],
  tick: tickMarketTown, handleAction: noStageAction, createState: () => ({ lastMarketDay: -1 } satisfies MarketTownState),
};
