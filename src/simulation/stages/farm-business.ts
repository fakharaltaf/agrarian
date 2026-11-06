import type { StageModule } from './types';
import { lifetimeSales, noStageAction } from './shared';

export const farmBusiness: StageModule = {
  id: 'farm-business', title: 'Farm Business', legacyEras: [3],
  eraUnlocks: { 3: (s) => lifetimeSales(s) >= 60_000 && s.workers.length >= 2 },
  actionTypes: ['hire','fire','setPlan','lockPlan','buyAnimals','sellAnimals','upgradeBuilding','fertilize','irrigate','greenhouse'],
  tips: ['hire','plan','advisorHire','soil','storage','books','parcels'], discoveries: ['perks','livestock','orchards'],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
