// Helpers shared by pages.
import { BUILDINGS, GOODS, REGIONS, REGION_IDS, type GoodId, type RegionId } from '../../simulation/config';
import { fixedAssets } from '../../simulation/core';
import type { GameState } from '../../simulation/types';
import { Swatch } from '../ui';

export const unlockedRegions = (s: GameState) => REGION_IDS.filter((r) => s.regions[r].unlocked);
export const regionOptions = (s: GameState) => unlockedRegions(s).map((r) => ({ v: r, label: REGIONS[r].name }));
export const GoodName = ({ g }: { g: GoodId }) => <span className="crop-name"><Swatch color={GOODS[g].color} />{GOODS[g].name}</span>;
export const RegionName = ({ r }: { r: RegionId }) => <span>{REGIONS[r].name}</span>;
export const buildingName = (t: keyof typeof BUILDINGS) => BUILDINGS[t].name;

/** What restructuring would face, for the insolvency dialog. */
export function restructurePreview(s: GameState) {
  const fa = fixedAssets(s);
  return { owed: s.loans.reduce((a, l) => a + l.balance, 0) - s.cash, lendable: 0.6 * fa.land + 0.5 * fa.machines + 0.4 * fa.buildings };
}
