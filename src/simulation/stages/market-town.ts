import type { StageModule } from './types';
import { lifetimeSales, noStageAction } from './shared';
import { startMarketDay } from '../events';
import { CROPS, CROP_IDS } from '../config';
import { log } from '../core';
import type { GameState } from '../types';

type MarketTownState = { lastMarketDay: number };
function tickMarketTown(s: GameState, state: Record<string, unknown>) {
  if (s.legacyProgression) return;
  const day = Math.floor(s.tick / 24);
  if (day % 7 !== 0 || (state.lastMarketDay as number) === day) return;
  const candidates = CROP_IDS.filter((g) => s.unlockedCrops.includes(g) && !CROPS[g].perennial);
  const good = candidates[Math.floor(day / 7) % candidates.length] ?? 'wheat';
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
