// A competent player, used by balancing tests to drive the real engine through every era.
import { CONFIG, CROPS, REGION_IDS, type BuildingType, type CropId, type GoodId, type RegionId } from '../simulation/config';
import { avg30, dispatch, homePlotPrice, isManual, isReady, parcelPrice, totalHa } from '../simulation/engine';
import { seasonOf, stored } from '../simulation/core';
import type { GameState } from '../simulation/types';

export type Strategy = 'balanced' | 'volume' | 'processor' | 'idle';

const count = (s: GameState, r: RegionId, t: string) => s.machines.filter((m) => m.region === r && m.type === t).length;
const haIn = (s: GameState, r: RegionId) => s.fields.reduce((a, f) => a + (f.region === r ? f.ha : 0), 0);
const hasB = (s: GameState, r: RegionId, t: BuildingType) => s.buildings.some((b) => b.region === r && b.type === t);

export function botAct(s: GameState, strategy: Strategy = 'balanced') {
  if (strategy === 'idle') return;
  if (s.bankrupt) {
    dispatch(s, { type: 'restructure' });
    return;
  }
  const P = s.automation.policies;
  if (s.eraReady) {
    if (!s.legacyProgression && s.stageId === 'homestead' && !s.charters.trader) dispatch(s, { type: 'chooseCharter', charter: 'fair' });
    dispatch(s, { type: 'advanceEra' });
  }
  // Homestead: work small plots by hand until there are workers.
  if (!s.workers.some((w) => w.role === 'hand')) for (const f of s.fields) {
    if (!isManual(f)) continue;
    if (isReady(s, f)) dispatch(s, { type: 'harvest', fieldId: f.id });
    if (!f.crop) dispatch(s, { type: 'plant', fieldId: f.id, crop: bestCrop(s, 'heartland') });
  }
  if (s.tick % 3 === 0) sell(s);
  if (s.era < 3 && s.regions.heartland.homePlotsBought < 16 && s.cash > homePlotPrice(s) * 1.3 && homePlotPrice(s) < 6000) dispatch(s, { type: 'buyPlot' });
  if (s.tick % 6 !== 0) return; // management decisions a few times a day

  for (const r of REGION_IDS) {
    if (!s.regions[r].unlocked) continue;
    const ha = haIn(s, r);
    if (s.era >= 2 && ha > 0) {
      for (const f of s.fields) if (f.region === r && !f.plan) dispatch(s, { type: 'setPlan', fieldIds: [f.id], crop: bestCrop(s, r) });
      const mech = count(s, r, 'tractor') > 0 && count(s, r, 'harvester') > 0;
      const hands = s.workers.filter((w) => w.region === r && w.role === 'hand').length;
      const want = Math.ceil(ha / (mech ? 18 : 3.5));
      if (hands < want && s.cash > 500) dispatch(s, { type: 'hire', region: r, role: 'hand', wageFactor: 1.05 });
      const st = stored(s, r);
      if (st.dry > st.cap.dry * 0.7) dispatch(s, { type: 'build', region: r, building: s.cash > 40000 ? 'silo' : 'barn' });
    }
    if (s.era >= 3 && ha > 0) {
      if (ha >= 15 && !s.workers.some((w) => w.region === r && w.role === 'manager') && s.cash > 8000) dispatch(s, { type: 'hire', region: r, role: 'manager', wageFactor: 1 });
      if (ha >= 12 && count(s, r, 'tractor') < Math.ceil(ha / 80)) dispatch(s, { type: 'buyMachine', region: r, machine: 'tractor', lease: s.cash < 30000 });
      if (ha >= 12 && count(s, r, 'harvester') < Math.ceil(ha / 70)) dispatch(s, { type: 'buyMachine', region: r, machine: 'harvester', lease: s.cash < 80000 });
    }
  }
  if (s.era >= 3) {
    Object.assign(P, { autoRotate: true, autoFertilize: true, autoRepair: 0.45, sellDiscipline: 0, cashReserve: 0 });
    const parcel = strategy === 'volume' ? 25 : s.cash > 300000 ? 25 : 5;
    const cap = strategy === 'volume' ? 3000 : 1200;
    if (s.cash > parcelPrice(s, 'heartland', parcel) * 1.5 + 15000 && totalHa(s) < cap) dispatch(s, { type: 'buyParcel', region: 'heartland', ha: parcel });
    for (const l of s.loans) if (s.cash > 100000) dispatch(s, { type: 'repayLoan', loanId: l.id, amount: Math.min(l.balance, s.cash - 80000) });
  }
  if (s.era >= 4) {
    if (!hasB(s, 'heartland', 'lab') && s.cash > 60000) dispatch(s, { type: 'build', region: 'heartland', building: 'lab' });
    if (!s.research.active) for (const t of ['farmSoftware', 'improvedSeeds', 'soilTesting', 'mech2', 'solar', 'processEfficiency', 'routeOptimization', 'dripIrrigation', 'predictiveMaintenance', 'coldChain', 'advancedLab'])
      if (dispatch(s, { type: 'research', tech: t }).ok) break;
    if (strategy !== 'volume') {
      if (!hasB(s, 'heartland', 'flourMill') && s.cash > 60000) dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
      if (strategy === 'processor') for (const b of ['feedMill', 'warehouse', 'bakery', 'ranch'] as BuildingType[]) if (!hasB(s, 'heartland', b) && s.cash > 150000) dispatch(s, { type: 'build', region: 'heartland', building: b });
    }
    if (s.tick % 24 === 12) for (const g of ['flour', 'feed', 'bread', 'meat', 'milk'] as GoodId[]) if (s.regions.heartland.inventory[g] > 10) dispatch(s, { type: 'sell', region: 'heartland', good: g, qty: Math.min(s.regions.heartland.inventory[g], s.markets.heartland[g]!.d0) });
  }
  if (s.era >= 6) {
    for (const r of ['river', 'tropics'] as RegionId[]) if (!s.regions[r].unlocked && s.cash > 250000) dispatch(s, { type: 'unlockRegion', region: r });
    for (const r of ['river', 'tropics'] as RegionId[]) if (s.regions[r].unlocked && s.cash > parcelPrice(s, r, 25) * 2 + 50000 && haIn(s, r) < 600) dispatch(s, { type: 'buyParcel', region: r, ha: 25 });
  }
  if (s.era >= 7 && !s.corp.incorporated) dispatch(s, { type: 'incorporate' });
}

function bestCrop(s: GameState, r: RegionId): CropId {
  let best: CropId = 'wheat', v = -Infinity;
  const cold = seasonOf(s) === 'Winter' || seasonOf(s) === 'Autumn';
  for (const c of s.unlockedCrops) {
    if ((c === 'coffee' && r !== 'tropics') || CROPS[c].perennial || (cold && !CROPS[c].frostHardy)) continue;
    const m = s.markets[r][c]!;
    const val = (CROPS[c].yieldPerSeed * m.price - CROPS[c].seedCost) / CROPS[c].growthTicks;
    if (val > v) (v = val), (best = c);
  }
  return best;
}

/** Sells in slices no bigger than a fifth of market depth, and only near or above the monthly average. */
function sell(s: GameState) {
  if (!s.legacyProgression && s.stageId === 'homestead') {
    const q = Math.floor(s.regions.heartland.inventory.wheat);
    if (q >= 1) dispatch(s, { type: 'sellToMill', qty: q });
    return;
  }
  for (const r of REGION_IDS) {
    if (!s.regions[r].unlocked) continue;
    const st = stored(s, r);
    const full = st.dry > st.cap.dry * 0.8 || s.cash < 5000; // short of cash or space: sell regardless of price
    for (const c of Object.keys(CROPS) as CropId[]) {
      const q = s.regions[r].inventory[c];
      const m = s.markets[r][c]!;
      if (q < 5 || (c === 'wheat' && hasB(s, r, 'flourMill') && q < 2000)) continue;
      if (!full && m.price < avg30(s, r, c) * 0.92) continue;
      dispatch(s, { type: 'sell', region: r, good: c, qty: Math.min(q, m.d0 * CONFIG.marketDepth * 0.2) });
    }
  }
}
