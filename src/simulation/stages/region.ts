import type { StageModule } from './types';
import { lifetimeSales, noStageAction } from './shared';

export const region: StageModule = {
  id: 'region', title: 'Region', legacyEras: [6],
  eraUnlocks: { 6: (s) => lifetimeSales(s) >= 12_000_000 },
  actionTypes: ['unlockRegion','buyParcel','ship'],
  tips: ['era6','analytics'], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
