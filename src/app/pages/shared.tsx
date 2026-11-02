// Helpers shared by pages.
import { BUILDINGS, GOODS, REGIONS, REGION_IDS, type GoodId, type RegionId } from '../../simulation/config';
import { fixedAssets } from '../../simulation/core';
import type { GameState } from '../../simulation/types';
import { useState } from 'react';
import { buildingPrice } from '../../simulation/engine';
import { act } from '../../stores/game';
import { money } from '../format';
import { Seg, Swatch } from '../ui';

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

/** Build one, five or ten of a building at once. */
export function BuildMany({ s, r, t, className = 'btn primary sm' }: { s: GameState; r: RegionId; t: keyof typeof BUILDINGS; className?: string }) {
  const [n, setN] = useState(1);
  const cost = buildingPrice(s, t, r) * n;
  return (
    <div className="row" style={{ gap: 6 }}>
      <Seg label="How many to build" value={n} onChange={setN} options={[1, 5, 10].map((v) => ({ v, label: `×${v}` }))} />
      <button className={className} disabled={cost > s.cash} onClick={() => act({ type: 'build', region: r, building: t, count: n }, `${n > 1 ? `${n} × ` : ''}${BUILDINGS[t].name} built.`)}>Build{n > 1 ? ` ${n}` : ''} · {money(cost)}</button>
    </div>
  );
}
