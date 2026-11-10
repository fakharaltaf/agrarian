import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { MAP, chunksIn, clearRect, own, worldOf } from '../simulation/world';
import { oilChance, oilOf } from '../simulation/oil';

const industry = (seed: number) => { const s = createGame(seed); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture'); const w = worldOf(s, 'heartland'); own(w, chunksIn(MAP.x0, MAP.y0, MAP.w, MAP.h)); clearRect(w, MAP.x0, MAP.y0, MAP.w, MAP.h); return s; };

it('a wind turbine makes power day and night', () => {
  const s = industry(601);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'windTurbine' }).ok).toBe(true);
  const grid = s.lifetime.grid ?? 0;
  for (let i = 0; i < 48; i++) step(s);
  expect((s.lifetime.grid ?? 0) - grid).toBeGreaterThan(0); // nothing else uses power: it all sells
});

it('oil wells are found by drilling: the survey shows where, and a strike pumps crude', () => {
  const s = industry(602);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'oilWell' }).ok).toBe(false);
  expect(dispatch(s, { type: 'surveyOil', region: 'heartland' }).ok).toBe(true);
  expect(dispatch(s, { type: 'surveyOil', region: 'heartland' }).ok).toBe(false);
  let best: [number, number] = [0, 0], c = 0;
  for (let y = MAP.y0 + 2; y < MAP.y0 + MAP.h - 4; y += 2) for (let x = MAP.x0 + 2; x < MAP.x0 + MAP.w - 4; x += 2) { const v = oilChance('heartland', x + 1, y + 1); if (v > c) { c = v; best = [x, y]; } }
  expect(c).toBeGreaterThan(0.6);
  let wells = 0;
  for (let i = 0; i < 6 && !wells; i++) { dispatch(s, { type: 'drillOil', region: 'heartland', at: [best[0] + i * 3, best[1]] }); wells = s.buildings.filter((b) => b.type === 'oilWell').length; }
  expect(wells).toBe(1);
  for (let i = 0; i < 24; i++) step(s);
  expect(s.regions.heartland.inventory.oil).toBeGreaterThan(0);
  expect(oilChance('heartland', 1, 1)).toBeLessThan(0.2); // never rich right under the starting valley
  expect(oilOf(s).surveyed).toContain('heartland');
});

it('clean energy pulls the farm green and earns a better price; oil pulls it industrial and cheapens power', async () => {
  const { leaning, electricityPrice } = await import('../simulation/core');
  const { quoteSell } = await import('../simulation/markets');
  const s = industry(603); s.regions.heartland.inventory.wheat = 100;
  const before = quoteSell(s, 'heartland', 'wheat', 10).gross, power = electricityPrice(s, 'heartland');
  for (let i = 0; i < 4; i++) expect(dispatch(s, { type: 'build', region: 'heartland', building: 'windTurbine' }).ok).toBe(true);
  expect(leaning(s).clean).toBe(true);
  expect(quoteSell(s, 'heartland', 'wheat', 10).gross).toBeGreaterThan(before);
  s.values.cleanIndustrial = 80;
  expect(leaning(s).industrial).toBe(true);
  expect(electricityPrice(s, 'heartland')).toBeLessThan(power);
});
