import { expect, it } from 'vitest';
import { advance, buildingPrice, createGame, dispatch, expectedYield, harvestField } from '../simulation/engine';
import { post, throughput, recipeOf } from '../simulation/core';
import { CROPS, BUILDINGS } from '../simulation/config';
import { techFactor } from '../simulation/agriculture';
import { FIELD_LEVELS, fieldUpgradePrice } from '../simulation/field-levels';
import { goodBalance } from '../simulation/lines';
import type { GameState } from '../simulation/types';

function ready(seed = 3001) {
  const s = createGame(seed); s.legacyProgression = true; s.era = 8; s.discovered.push('upgrades');
  post(s, 'sharesIssued', 1e7, 'Test capital');
  return s;
}
const research = (s: GameState, ...ids: string[]) => s.research.done.push(...ids);

it('A field goes up a level only with its research and irrigation, and is paid for by the hectare', () => {
  const s = ready(), f = s.fields[0];
  expect(dispatch(s, { type: 'upgradeField', fieldIds: [f.id] }).ok).toBe(false); // no research
  research(s, 'improvedSeeds', 'dripIrrigation');
  f.irrigated = false;
  const r = dispatch(s, { type: 'upgradeField', fieldIds: [f.id] });
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error).toMatch(/Irrigate/);
  f.irrigated = true;
  const price = fieldUpgradePrice(s, f), cash = s.cash, book = f.cost;
  expect(price).toBe(Math.round(f.ha * FIELD_LEVELS[1].pricePerHa * s.macro.cpi));
  expect(dispatch(s, { type: 'upgradeField', fieldIds: [f.id] }).ok).toBe(true);
  expect(f.level).toBe(2);
  expect(cash - s.cash).toBeCloseTo(price, 0);
  expect(f.cost).toBeCloseTo(book + price, 0);
  expect(dispatch(s, { type: 'upgradeField', fieldIds: [f.id] }).ok).toBe(false); // level 3 needs hybrids and precision irrigation
  research(s, 'hybrids', 'soilTesting', 'precisionIrrigation');
  expect(dispatch(s, { type: 'upgradeField', fieldIds: [f.id] }).ok).toBe(true);
  expect(f.level).toBe(3);
  expect(dispatch(s, { type: 'upgradeField', fieldIds: [f.id] }).ok).toBe(false);
});

it('Each level multiplies the harvest, and takes more out of the soil', () => {
  const s = ready(), f = s.fields[0];
  f.crop = 'wheat'; f.plantedAt = s.tick - CROPS.wheat.growthTicks - 1; f.irrigated = true;
  const a = structuredClone(s), b = structuredClone(s);
  b.fields[0].level = 3;
  expect(expectedYield(b, b.fields[0], 'wheat') / expectedYield(a, a.fields[0], 'wheat')).toBeCloseTo(3, 5);
  const ha = harvestField(a, a.fields[0])!, hb = harvestField(b, b.fields[0])!;
  expect(hb.units / ha.units).toBeCloseTo(3, 1);
  expect(hb.level).toBe(3);
  expect(b.fields[0].soil.n).toBeLessThan(a.fields[0].soil.n);
});

it('With its research, a level-N field feeds a level-N food factory from the same land', () => {
  const s = ready();
  research(s, 'improvedSeeds');
  const l2 = FIELD_LEVELS[1].yield * techFactor(s);
  research(s, 'hybrids');
  const l3 = FIELD_LEVELS[2].yield * techFactor(s);
  const mill = (level: number) => throughput({ type: 'flourMill', level });
  expect(l2 / (mill(2) / mill(1))).toBeGreaterThan(0.95);
  expect(l2 / (mill(2) / mill(1))).toBeLessThan(1.05);
  expect(l3 / (mill(3) / mill(1))).toBeGreaterThan(0.95);
  expect(l3 / (mill(3) / mill(1))).toBeLessThan(1.05);
});

it('Field upgrades are deterministic: the same seed and actions give the same farm', () => {
  const run = () => {
    const s = ready(4242);
    research(s, 'improvedSeeds', 'dripIrrigation');
    for (const f of s.fields) f.irrigated = true;
    dispatch(s, { type: 'upgradeField', fieldIds: s.fields.map((f) => f.id) });
    dispatch(s, { type: 'plant', fieldId: s.fields[0].id, crop: 'wheat' });
    advance(s, 24 * 5);
    return s;
  };
  const a = run(), b = run();
  expect(a.fields.map((f) => [f.level, f.yields])).toEqual(b.fields.map((f) => [f.level, f.yields]));
  expect(a.cash).toBe(b.cash);
});

it('A vertical farm grows the crop you choose, worth the same as greens, held for your mills', () => {
  const s = ready();
  research(s, 'verticalFarming', 'solar', 'robotics', 'mech2', 'farmSoftware');
  s.unlockedCrops = [...new Set([...s.unlockedCrops, 'wheat'])] as typeof s.unlockedCrops;
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill', grows: 'wheat' }).ok).toBe(false); // only vertical farms grow
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'silo' }).ok).toBe(true);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'verticalFarm', grows: 'wheat' }).ok).toBe(true);
  const vf = s.buildings.find((b) => b.type === 'verticalFarm')!, mill = s.buildings.find((b) => b.type === 'flourMill')!;
  expect(vf.grows).toBe('wheat');
  expect(recipeOf(vf)!.outputs.wheat).toBe(27); // $80 a batch: 13 greens at $6, or 27 wheat at $3
  advance(s, 3);
  expect(mill.reserved).toBe(0); // not assigned: its wheat is for the market
  expect(dispatch(s, { type: 'setGrows', buildingId: vf.id, grows: 'greens' }).ok).toBe(true);
  expect(dispatch(s, { type: 'farmSupplies', farmId: vf.id, buildingId: mill.id }).ok).toBe(true);
  expect(vf.grows).toBe('wheat'); // assigning it sets the crop the house takes
  expect(vf.supplies).toBe(mill.id);
  const before = s.regions.heartland.inventory.wheat;
  advance(s, 3);
  expect(s.regions.heartland.inventory.wheat).toBeGreaterThan(before);
  expect(mill.reserved).toBeGreaterThan(0);
  expect(dispatch(s, { type: 'setGrows', buildingId: vf.id, grows: 'greens' }).ok).toBe(true);
  expect(vf.grows).toBeUndefined();
  expect(vf.supplies).toBeUndefined(); // the mill doesn't take greens, so the link ends
  expect(throughput({ type: 'verticalFarm', level: 3 })).toBe(3);
  expect(BUILDINGS.verticalFarm.recipe!.kwh).toBeGreaterThan(0);
});

it('Supply and demand counts what fields grow and what mills use, including mills not yet built', () => {
  const s = ready();
  const f = s.fields[0]; f.crop = 'wheat'; f.plantedAt = s.tick;
  const none = goodBalance(s, 'heartland', 'wheat');
  expect(none.grown).toBeGreaterThan(0);
  expect(none.used).toBe(0);
  const three = goodBalance(s, 'heartland', 'wheat', { type: 'flourMill', n: 3 });
  expect(three.used).toBeCloseTo(3 * BUILDINGS.flourMill.recipe!.inputs.wheat! * BUILDINGS.flourMill.recipe!.batchesPerHour * 24, 0);
});

it('The advisor suggests upgrading the fields that feed a short factory', async () => {
  const { diagnose } = await import('../simulation/advisor');
  const s = ready(5150);
  research(s, 'improvedSeeds', 'dripIrrigation');
  dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
  const mill = s.buildings.find((b) => b.type === 'flourMill')!;
  mill.reason = 'Not enough wheat';
  s.fields[0].irrigated = true; s.fields[0].supplies = mill.id;
  expect(diagnose(s).advice.some((a) => a.id === 'fieldLevels')).toBe(true);
});

it('A vertical farm climbs five levels, each twice the price of the last, to six times its first output', () => {
  const s = ready();
  research(s, 'verticalFarming');
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'verticalFarm' }).ok).toBe(true);
  const vf = s.buildings.find((b) => b.type === 'verticalFarm')!, price = buildingPrice(s, 'verticalFarm', 'heartland');
  const paid: number[] = [];
  for (let l = 1; l < 5; l++) { const c = s.cash; expect(dispatch(s, { type: 'upgradeBuilding', buildingId: vf.id }).ok).toBe(true); paid.push(c - s.cash); }
  expect(vf.level).toBe(5);
  expect(paid.map((p) => Math.round(p / price))).toEqual([1, 2, 4, 8]);
  expect(throughput(vf)).toBe(6);
  expect(dispatch(s, { type: 'upgradeBuilding', buildingId: vf.id }).ok).toBe(false);
});

it('A horse cart in the yard sells for half a new one; one on the road keeps its trip', async () => {
  const { haulOf, horseCartValue } = await import('../simulation/hauling');
  const s = ready();
  s.legacyProgression = false; s.stageId = 'market-town' as typeof s.stageId;
  expect(dispatch(s, { type: 'sellHorseCart' }).ok).toBe(false);
  dispatch(s, { type: 'buyHorseCart' }); dispatch(s, { type: 'buyHorseCart' });
  const H = haulOf(s);
  H.trips.push({ vehicle: 'horse:1', kind: 'horse', items: [], depart: s.tick, arrive: s.tick + 2, back: s.tick + 4 });
  const cash = s.cash;
  expect(dispatch(s, { type: 'sellHorseCart' }).ok).toBe(true);
  expect(s.cash - cash).toBeCloseTo(horseCartValue(s), 0);
  expect(H.horses).toBe(1);
  expect(H.trips[0].vehicle).toBe('horse:0'); // the cart on the road is still counted busy
  expect(dispatch(s, { type: 'sellHorseCart' }).ok).toBe(false); // the last one is out on the road
});
