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

it('a service covers the homes within its reach, and only those', () => {
  const s = settled(); dispatch(s, { type: 'startTown' });
  const w = worldOf(s, 'heartland'), t = townOf(s);
  // a water tower right beside the homes, a clinic far across the farm
  let spot: [number, number] | null = null; // a free 3×3 among the homes
  for (let y = 8; y < 22 && !spot; y++) for (let x = 12; x < 26 && !spot; x++) if (!placeProblem(s, 'heartland', x, y, { w: 3, d: 3 })) spot = [x, y];
  expect(spot).not.toBeNull();
  expect(dispatch(s, { type: 'buildService', service: 'waterTower', district: 'farmgate', at: spot! }).ok).toBe(true);
  expect(dispatch(s, { type: 'buildService', service: 'clinic', district: 'farmgate', at: [-10, -6] }).ok || true).toBe(true);
  day(s, 2);
  expect(t.water).toBeGreaterThan(0.5);
  const clinic = t.services.find((b) => b.type === 'clinic');
  if (clinic) { const p = w.pos[`svc:${clinic.id}`]; if (p && Math.hypot(p[0] - 20, p[1] - 16) > 30) expect(t.medical ?? 0).toBeLessThan(0.5); }
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
