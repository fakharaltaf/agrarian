import type { StageModule } from './types';
import { lifetimeSales, noStageAction } from './shared';

export const nation: StageModule = {
  id: 'nation', title: 'Nation', legacyEras: [8],
  eraUnlocks: { 8: (s) => lifetimeSales(s) >= 300_000_000 },
  actionTypes: ['chooseEvent','takeLoan','repayLoan'],
  tips: ['era8'], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
