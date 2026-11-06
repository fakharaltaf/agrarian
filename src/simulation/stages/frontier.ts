import type { StageModule } from './types';
import { noStageAction } from './shared';

export const frontier: StageModule = {
  id: 'frontier', title: 'Frontier', legacyEras: [], eraUnlocks: {},
  actionTypes: [], tips: [], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
