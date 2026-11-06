import type { StageModule } from './types';
import { noStageAction } from './shared';

export const town: StageModule = {
  id: 'town', title: 'Town', legacyEras: [], eraUnlocks: {},
  actionTypes: [], tips: [], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
