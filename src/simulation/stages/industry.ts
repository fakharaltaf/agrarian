import type { StageModule } from './types';
import { factoryCount, lifetimeSales, noStageAction } from './shared';

export const industry: StageModule = {
  id: 'industry', title: 'Industry', legacyEras: [4, 5],
  eraUnlocks: {
    4: (s) => s.machines.length > 0 && lifetimeSales(s) >= 500_000,
    5: (s) => lifetimeSales(s) >= 3_000_000 || (factoryCount(s) >= 2 && lifetimeSales(s) >= 1_500_000),
  },
  actionTypes: ['buyMachine','upgradeMachine','assignDriver','service','build','toggleBuilding','upgradeBuilding','research','choosePerk'],
  tips: ['era3','loans','automation','era4','research','machineUpgrades'], discoveries: [],
  tick: () => {}, handleAction: noStageAction, createState: () => ({}),
};
