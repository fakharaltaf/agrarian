import type { StageModule } from './types';
import { lifetimeSales, noStageAction, totalHa } from './shared';

export const city: StageModule = {
  id: 'city', title: 'City', legacyEras: [7],
  eraUnlocks: { 7: (s) => lifetimeSales(s) >= 60_000_000 || totalHa(s) >= 3000 },
  actionTypes: ['incorporate','issueShares','buyback','payDividend','acquire','diligence'],
  tips: ['era7'], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
