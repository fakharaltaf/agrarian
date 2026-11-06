import type { StageModule } from './types';
import { lifetimeSales, noStageAction } from './shared';

export const marketTown: StageModule = {
  id: 'market-town', title: 'Market Town', legacyEras: [2],
  eraUnlocks: { 2: (s) => s.fields.length >= 4 && lifetimeSales(s) >= 12_000 },
  actionTypes: ['sell','buy','openFutures','closeFutures','acceptContract','ship'],
  tips: ['era2','crops'], discoveries: ['forecast','chickens','frost','quality','upgrades'],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
