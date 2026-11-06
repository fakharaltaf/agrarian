import type { StageModule } from './types';
import { noStageAction } from './shared';

export const homestead: StageModule = {
  id: 'homestead', title: 'Homestead', legacyEras: [1], eraUnlocks: { 1: () => true },
  actionTypes: ['plant','harvest','sell','buyPlot'],
  tips: ['plant','time','harvest','sell','impact','replant','speed','land'], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
