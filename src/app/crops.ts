// Shared crop economics for the picker and the on-farm Plant button.
import { CONFIG, CROPS, type CropId } from '../simulation/config';
import { seedCost } from '../simulation/core';
import { canGrow, expectedYield } from '../simulation/engine';
import { dayPrice } from '../simulation/lines';
import type { Field, GameState } from '../simulation/types';

/** Expected profit of one planting at the 24h average price, and per hour of growing (orchards: per harvest cycle once mature). */
export function cropReturn(s: GameState, f: Field, id: CropId) {
  const units = expectedYield(s, f, id), seed = f.ha * CONFIG.seedsPerHa * seedCost(s, id), value = units * dayPrice(s, f.region, id);
  const profit = value - (CROPS[id].perennial ? 0 : seed);
  return { units, seed, value, profit, perHour: canGrow(f, id) ? profit / CROPS[id].growthTicks : -Infinity };
}
export const rankCrops = (s: GameState, f: Field) => [...s.unlockedCrops].sort((a, b) => cropReturn(s, f, b).perHour - cropReturn(s, f, a).perHour);
/** The best-paying crop this field can grow; wheat if nothing pays. */
export function bestCrop(s: GameState, f: Field): CropId {
  const top = rankCrops(s, f)[0];
  return top && cropReturn(s, f, top).perHour > 0 ? top : 'wheat';
}
