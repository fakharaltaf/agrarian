import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { CHAPTER_SALES } from '../simulation/config';
import { post } from '../simulation/core';
import { communityOf, familiesHere, familySize, population } from '../simulation/community-state';
import { wageOf } from '../simulation/operations';
import { canStartSettlement } from '../simulation/stages/settlement';
import { chunkAt, chunksIn, findSpot, placeProblem, worldOf } from '../simulation/world';

/** A farm ready for Settlement: sales, a mill and two hands. */
function ready() {
  const s = createGame(1001); s.legacyProgression = true; s.era = 4; s.stageId = 'industry';
  post(s, 'sale', CHAPTER_SALES.industry, 'Established business fixture');
  post(s, 'prize', 200_000, 'fixture');
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
  for (let i = 0; i < 2; i++) expect(dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 }).ok).toBe(true);
  return s;
}
const day = (s: ReturnType<typeof createGame>, n = 1) => { for (let i = 0; i < 24 * n; i++) step(s); };
const zoneBlock = (s: ReturnType<typeof createGame>) => {
  const res = chunksIn(-12, -8, 8, 8); // two patches square in the valley's north-west corner
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: res, zone: 'res' }).ok).toBe(true);
  return res;
};

it('Settlement opens without a charter fork: your hands want their families here', () => {
  const s = ready();
  expect(canStartSettlement(s)).toBe(true);
  expect(dispatch(s, { type: 'startSettlement' }).ok).toBe(true);
  expect(communityOf(s).active).toBe(true);
  expect(communityOf(s).charter).toBeNull();
  expect(s.stageId).toBe('settlement');
});

it('homes only go in a residential zone, and residential land cannot be farmed', () => {
  const s = ready(); dispatch(s, { type: 'startSettlement' });
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 }).ok).toBe(false); // nowhere zoned yet
  const res = zoneBlock(s);
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 }).ok).toBe(true);
  expect(chunkAt(-12, -8)).toBe(res[0]);
  expect(placeProblem(s, 'heartland', -8, -4, { w: 2, d: 2 }, undefined, 'field')).toBe('zone');
  expect(findSpot(s, 'heartland', { w: 2, d: 2 }, false, 'home')).not.toBeNull();
  // land with a field on it cannot be zoned residential
  const f = worldOf(s, 'heartland').pos[`field:${s.fields[0].id}`];
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: [chunkAt(f[0], f[1])], zone: 'res' }).ok).toBe(false);
});

it("only your employees' families move in, one per free home, and leave with their worker", () => {
  const s = ready(); dispatch(s, { type: 'startSettlement' }); zoneBlock(s);
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 }).ok).toBe(true);
  day(s);
  expect(familiesHere(s)).toBe(1); // one cottage, one family, though two hands are waiting
  const worker = s.workers.find((w) => w.resident)!;
  expect(population(s)).toBe(familySize(worker.id));
  expect(familySize(worker.id)).toBeGreaterThanOrEqual(3);
  expect(familySize(worker.id)).toBeLessThanOrEqual(5);
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 }).ok).toBe(true);
  day(s);
  expect(familiesHere(s)).toBe(2);
  day(s, 3);
  expect(familiesHere(s)).toBe(2); // no strangers: everyone here belongs to a worker
  dispatch(s, { type: 'fire', workerId: worker.id });
  day(s);
  expect(familiesHere(s)).toBe(1);
});

it('a pay cut or housing tax pays for the settlement, at a cost in morale that a home and food make up', () => {
  const s = ready(); dispatch(s, { type: 'startSettlement' }); zoneBlock(s);
  dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 2 });
  s.regions.heartland.inventory.wheat = 5000; // the larder is full
  day(s, 2);
  const w = s.workers.find((x) => x.resident)!, wage = wageOf(s, w);
  expect(dispatch(s, { type: 'setSettlementPay', payCut: 0.1 }).ok).toBe(true);
  expect(wageOf(s, w)).toBeCloseTo(wage * 0.9, 6);
  const rent = s.lifetime.rent ?? 0;
  expect(dispatch(s, { type: 'setSettlementPay', housingTax: 0.1 }).ok).toBe(true);
  day(s);
  expect((s.lifetime.rent ?? 0) - rent).toBeGreaterThan(0);
  expect(dispatch(s, { type: 'setSettlementPay', payCut: 0.3 }).ok).toBe(false);
  // morale: with a home and food and no deductions it rises; heavy deductions pull it down
  const c = communityOf(s);
  c.payCut = 0; c.housingTax = 0; day(s, 10); const free = w.morale;
  c.payCut = 0.2; c.housingTax = 0.2; day(s, 10);
  expect(w.morale).toBeLessThan(free);
  expect(c.fed).toBeGreaterThan(0.9); // families eat from the farm's stores
});
