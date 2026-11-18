import { expect, it } from 'vitest';
import { anotherQuote, buildingPrice, createGame, dispatch, landFits, upgradeCost } from '../simulation/engine';
import { post } from '../simulation/core';

function ready(cash = 1e6) {
  const s = createGame(2001); s.legacyProgression = true; s.era = 8; s.research.done.push('solar'); s.discovered.push('upgrades');
  post(s, 'sharesIssued', cash, 'Test capital');
  return s;
}

it('Add another builds one more at the same level, paying the build and each upgrade', () => {
  const s = ready();
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'solar' }).ok).toBe(true);
  const src = s.buildings[0];
  dispatch(s, { type: 'upgradeBuilding', buildingId: src.id }); dispatch(s, { type: 'upgradeBuilding', buildingId: src.id });
  expect(src.level).toBe(3);
  const want = buildingPrice(s, 'solar', 'heartland') + upgradeCost(s, { type: 'solar', level: 1, region: 'heartland' }) + upgradeCost(s, { type: 'solar', level: 2, region: 'heartland' });
  const q = anotherQuote(s, `b:${src.id}`)!;
  expect(q.why).toBeUndefined();
  expect(q.price).toBe(want);
  const cash = s.cash;
  expect(dispatch(s, { type: 'addAnother', key: `b:${src.id}` }).ok).toBe(true);
  expect(s.buildings).toHaveLength(2);
  expect(s.buildings[1].level).toBe(3);
  expect(cash - s.cash).toBeCloseTo(want, 0);
});

it('Add another changes nothing when it cannot afford the whole copy', () => {
  const s = ready();
  dispatch(s, { type: 'build', region: 'heartland', building: 'solar' });
  const src = s.buildings[0];
  dispatch(s, { type: 'upgradeBuilding', buildingId: src.id });
  // enough for the bare building, not for its upgrade
  post(s, 'sharesIssued', buildingPrice(s, 'solar', 'heartland') + 1 - s.cash, 'Trim');
  const before = JSON.stringify(s);
  expect(dispatch(s, { type: 'addAnother', key: `b:${src.id}` }).ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});

it('Land fit and the copy rehearsal leave the real farm untouched, and give the same answer each time', () => {
  const s = ready();
  const before = JSON.stringify(s);
  const a = landFits(s, 'flourMill', 'heartland', 50), b = landFits(s, 'flourMill', 'heartland', 50);
  expect(a).toBe(b);
  expect(a).toBeGreaterThan(0);
  expect(a).toBeLessThanOrEqual(50);
  expect(JSON.stringify(s)).toBe(before);
});
