import type { StageModule } from './types';
import { noStageAction } from './shared';

export const settlement: StageModule = {
  id: 'settlement', title: 'Settlement', legacyEras: [], eraUnlocks: {},
  actionTypes: [], tips: [], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
