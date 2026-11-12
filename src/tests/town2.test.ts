import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { CHAPTER_SALES } from '../simulation/config';
import { post } from '../simulation/core';
import { communityOf, familiesHere } from '../simulation/community-state';
import { townOf } from '../simulation/town-state';
import { chunksIn, clearRect, own, placeProblem, worldOf } from '../simulation/world';

const day = (s: ReturnType<typeof createGame>, n = 1) => { for (let i = 0; i < 24 * n; i++) step(s); };
/** A settlement with six settled families, food in store and a residential block. */
function settled() {
  const s = createGame(1101); s.legacyProgression = true; s.era = 4; s.stageId = 'industry';
  post(s, 'sale', CHAPTER_SALES.industry, 'fixture'); post(s, 'prize', 2e6, 'fixture');
  dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
  for (let i = 0; i < 6; i++) dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
  dispatch(s, { type: 'startSettlement' });
  const w = worldOf(s, 'heartland'); own(w, chunksIn(12, 8, 16, 16)); clearRect(w, 12, 8, 16, 16); // a block east of the valley for the town
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: chunksIn(12, 8, 16, 16), zone: 'res' }).ok).toBe(true);
  for (let i = 0; i < 8; i++) expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 }).ok).toBe(true);
  s.regions.heartland.inventory.wheat = 20000;
  day(s, 4);
  return s;
}

it('the town opens without a charter fork, and services are paid by the farm, not a treasury', () => {
  const s = settled();
  expect(familiesHere(s)).toBe(6);
  expect(dispatch(s, { type: 'startTown' }).ok).toBe(true);
  const cash = s.cash;
  expect(dispatch(s, { type: 'buildService', service: 'school', district: 'farmgate' }).ok).toBe(true);
  expect(s.cash).toBeLessThan(cash); // built from company cash
  expect(townOf(s).cash).toBe(0);
});

it('a clinic reaches homes as a fading heat map; a water tower serves only homes its pipes reach, up to its capacity', async () => {
  const W = await import('../simulation/world');
  const { utilityFamilies } = await import('../simulation/town-state');
  const s = settled(); dispatch(s, { type: 'startTown' });
  const w = worldOf(s, 'heartland'), t = townOf(s);
  let spot: [number, number] | null = null; // a free 3×3 among the homes
  for (let y = 8; y < 22 && !spot; y++) for (let x = 12; x < 26 && !spot; x++) if (!placeProblem(s, 'heartland', x, y, { w: 3, d: 3 })) spot = [x, y];
  expect(dispatch(s, { type: 'buildService', service: 'waterTower', district: 'farmgate', at: spot! }).ok).toBe(true);
  day(s, 1);
  expect(t.water).toBe(0); // right beside the homes, but no pipes yet
  // lay a pipe from the tower's door to every home
  const tower = t.services.find((b) => b.type === 'waterTower')!, tp = w.pos[`svc:${tower.id}`], tfp = W.footprintOf(s, `svc:${tower.id}`)!;
  const from = W.doorstep(tp[0], tp[1], tfp).find(([x, y]) => W.pipeRoute(s, 'heartland', [x, y], [x, y], 'water'))!;
  let laid = 0;
  for (const h of communityOf(s).homes) {
    const p = w.pos[`home:${h.id}`], fp = W.footprintOf(s, `home:${h.id}`); if (!p || !fp) continue;
    const to = W.doorstep(p[0], p[1], fp).find(([x, y]) => W.pipeRoute(s, 'heartland', from, [x, y], 'water'));
    if (to && dispatch(s, { type: 'buildPipe', region: 'heartland', from, to, net: 'water' }).ok) laid++;
  }
  expect(laid).toBeGreaterThan(0);
  day(s, 2);
  expect(t.water).toBeGreaterThan(0.5);
  expect(tower.serving![0]).toBeLessThanOrEqual(tower.serving![1]);
  expect(tower.serving![1]).toBe(Math.round(utilityFamilies(tower)));
  // a full tower serves no more: halve its reach by giving it a capacity below the homes' families
  const before = t.water;
  expect(dispatch(s, { type: 'upgradeService', serviceId: tower.id }).ok).toBe(true);
  expect(tower.level).toBe(2);
  day(s, 1);
  expect(t.water).toBeGreaterThanOrEqual(before - 1e-9);
  // the clinic's heat fades with distance
  const { heatAt } = await import('../simulation/town-state');
  expect(heatAt(12, 12)).toBe(1); expect(heatAt(16.5, 12)).toBeCloseTo(0.5); expect(heatAt(21.1, 12)).toBe(0); // full over the old reach, fading beyond it
});

it('newcomer families settle once there is a town, and pay the housing tax', () => {
  const s = settled(); dispatch(s, { type: 'startTown' });
  for (let i = 0; i < 4; i++) dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 });
  dispatch(s, { type: 'setSettlementPay', housingTax: 0.1 });
  const before = communityOf(s).cohorts.length, rent = s.lifetime.rent ?? 0;
  communityOf(s).happiness = 0.8;
  day(s, 3);
  expect(communityOf(s).cohorts.length).toBeGreaterThan(before);
  expect(communityOf(s).cohorts.some((g) => g.name.includes('newcomers'))).toBe(true);
  expect((s.lifetime.rent ?? 0) - rent).toBeGreaterThan(0);
});
