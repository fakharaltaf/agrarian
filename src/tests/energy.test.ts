import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { MAP, chunksIn, clearRect, own, worldOf } from '../simulation/world';
import { drawOil, fieldState, oilChance, oilFields, oilOf, struckFields, SURVEY_R, surveyedAt } from '../simulation/oil';

const industry = (seed: number) => { const s = createGame(seed); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture'); const w = worldOf(s, 'heartland'); own(w, chunksIn(MAP.x0, MAP.y0, MAP.w, MAP.h)); clearRect(w, MAP.x0, MAP.y0, MAP.w, MAP.h); return s; };

it('a wind turbine makes power day and night', () => {
  const s = industry(601);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'windTurbine' }).ok).toBe(true);
  const grid = s.lifetime.grid ?? 0;
  for (let i = 0; i < 48; i++) step(s);
  expect((s.lifetime.grid ?? 0) - grid).toBeGreaterThan(0); // nothing else uses power: it all sells
});

it('oil wells are found by drilling: a survey reads one area roughly, and a strike pumps crude from its field', () => {
  const s = industry(602);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'oilWell' }).ok).toBe(false);
  const f = oilFields('heartland')[0];
  expect(dispatch(s, { type: 'surveyOil', region: 'heartland', at: [f.x, f.y] }).ok).toBe(true);
  expect(dispatch(s, { type: 'surveyOil', region: 'heartland', at: [f.x + 2, f.y] }).ok).toBe(false); // already read
  expect(surveyedAt(s, 'heartland', f.x + SURVEY_R - 1, f.y)).toBe(true);
  expect(surveyedAt(s, 'heartland', f.x + SURVEY_R + 2, f.y)).toBe(false); // only the area around the pick
  let wells = 0;
  for (let i = 0; i < 12 && !wells; i++) { dispatch(s, { type: 'drillOil', region: 'heartland', at: [f.x - 1 + (i % 4) * 3, f.y - 1 + Math.floor(i / 4) * 3] }); wells = s.buildings.filter((b) => b.type === 'oilWell').length; }
  expect(wells).toBe(1);
  for (let i = 0; i < 24; i++) step(s);
  expect(s.regions.heartland.inventory.oil).toBeGreaterThan(0);
  const st = struckFields(s, 'heartland')[0];
  expect(st.left).toBeLessThan(st.reserve);
  expect(oilChance('heartland', 1, 1)).toBeLessThan(0.1); // never rich right under the starting valley
  // blind odds are poor almost everywhere
  let poor = 0, n = 0;
  for (let y = MAP.y0; y < MAP.y0 + MAP.h; y += 8) for (let x = MAP.x0; x < MAP.x0 + MAP.w; x += 8) { n++; if (oilChance('heartland', x, y) < 0.1) poor++; }
  expect(poor / n).toBeGreaterThan(0.85);
});

it('a field runs dry, and over-drilling it wastes oil so it runs dry sooner than a balanced number of wells', () => {
  const s = industry(605), r = 'heartland' as const, f = oilFields(r)[0], key = `${r}:0`;
  const well = (dx: number) => { const id = 9000 + dx; s.buildings.push({ id, type: 'oilWell', region: r, active: true, level: 1, cost: 0, depreciated: 0, util: 0, reserved: 0, reason: '', productionReport: s.buildings[0]?.productionReport ?? (undefined as never), stats: { out: 0, inCost: 0, outValue: 0, opCost: 0 } }); worldOf(s, r).pos[`b:${id}`] = [Math.round(f.x) - 1, Math.round(f.y) - 1]; }; // all on the field's heart
  const bal = fieldState(s, r, 0).balanced;
  for (let i = 0; i < bal; i++) well(i * 2);
  expect(fieldState(s, r, 0).drain).toBe(1);
  for (let i = 0; i < bal * 2; i++) well(100 + i);
  const st = fieldState(s, r, 0);
  expect(st.wells.length).toBe(bal * 3);
  expect(st.drain).toBeGreaterThan(2); // three times the wells: the field loses more than it gives
  drawOil(s, st.wells[0], 100);
  expect(oilOf(s).drawn[key]).toBeCloseTo(100 * st.drain);
  oilOf(s).drawn[key] = f.reserve; // pumped out
  expect(fieldState(s, r, 0).left).toBe(0);
});

it('industry zoning: plants need industrial land from the start; workshops start anywhere but grow only on industrial land', async () => {
  const { chunkAt, findSpot, footprintOf, placeProblem } = await import('../simulation/world');
  const s = industry(606); s.legacyProgression = false; s.stageId = 'industry'; if (!s.discovered.includes('upgrades')) s.discovered.push('upgrades');
  const t = dispatch(s, { type: 'build', region: 'heartland', building: 'windTurbine' });
  expect(t).toMatchObject({ ok: false, error: expect.stringMatching(/industrial/) });
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true); // a first-stage workshop goes on farmland
  const mill = s.buildings.find((b) => b.type === 'flourMill')!, w = worldOf(s, 'heartland');
  const up = dispatch(s, { type: 'upgradeBuilding', buildingId: mill.id });
  if (up.ok) throw new Error('a workshop on farmland must not grow');
  expect(up.error).toMatch(/industrial/);
  // zone the land under it industrial and it may grow; a turbine fits there too
  const [mx, my] = w.pos[`b:${mill.id}`];
  const fp = footprintOf(s, `b:${mill.id}`)!;
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: chunksIn(mx, my, fp.w, fp.d), zone: 'ind' })).toMatchObject({ ok: true });
  expect(w.zones[chunkAt(mx, my)]).toBe('ind');
  expect(placeProblem(s, 'heartland', mx, my, { w: 1, d: 1 }, `b:${mill.id}`)).not.toBe('zone');
  const grown = dispatch(s, { type: 'upgradeBuilding', buildingId: mill.id });
  if (!grown.ok) expect(grown.error).not.toMatch(/industrial/); // any other limit (research) is fine here
  const lot = findSpot(s, 'heartland', { w: 8, d: 8 }, false, 'building')!; // fresh farmland for an industrial patch
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: chunksIn(lot[0], lot[1], 8, 8), zone: 'ind' })).toMatchObject({ ok: true });
  expect(findSpot(s, 'heartland', { w: 2, d: 2 }, false, 'industry')).not.toBeNull();
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'windTurbine' }).ok).toBe(true);
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

it('an older save loads into the new rules: whole-region surveys become surveys over its wells, and plants stand on industrial land', async () => {
  const { parseSave, SAVE_VERSION } = await import('../simulation/persistence');
  const { emptyProductionReport } = await import('../simulation/production-report');
  const { buildingUse, chunksIn: cin, footprintOf } = await import('../simulation/world');
  const s = industry(607); s.legacyProgression = false; s.stageId = 'industry';
  const f = oilFields('heartland')[0], id = 8000;
  s.buildings.push({ id, type: 'oilWell', region: 'heartland', active: true, level: 1, cost: 0, depreciated: 0, util: 0, reserved: 0, reason: '', productionReport: emptyProductionReport(), stats: { out: 0, inCost: 0, outValue: 0, opCost: 0 } });
  worldOf(s, 'heartland').pos[`b:${id}`] = [Math.round(f.x) - 1, Math.round(f.y) - 1];
  (s as { oil?: unknown }).oil = { surveyed: ['heartland'], dry: {} }; // the old shape
  const g = parseSave(JSON.stringify({ version: SAVE_VERSION, savedAt: 0, game: s })).game;
  const o = oilOf(g);
  expect(o.surveys.heartland?.length).toBe(1);
  expect(o.drawn).toEqual({});
  expect(struckFields(g, 'heartland')[0].left).toBe(f.reserve);
  const w = worldOf(g, 'heartland'), [px, py] = w.pos[`b:${id}`], fp = footprintOf(g, `b:${id}`)!;
  expect(buildingUse(g, 'oilWell')).toBe('industry');
  expect(cin(px, py, fp.w, fp.d).every((c) => w.zones[c] === 'ind')).toBe(true);
});

it('a well off its field pumps nothing, and wells stay where they were drilled', async () => {
  const { emptyProductionReport } = await import('../simulation/production-report');
  const s = industry(608), r = 'heartland' as const, f = oilFields(r)[0], id = 8100;
  s.buildings.push({ id, type: 'oilWell', region: r, active: true, level: 1, cost: 0, depreciated: 0, util: 0, reserved: 0, reason: '', productionReport: emptyProductionReport(), stats: { out: 0, inCost: 0, outValue: 0, opCost: 0 } });
  const far: [number, number] = [Math.round(f.x + f.r * 4), Math.round(f.y)];
  worldOf(s, r).pos[`b:${id}`] = far;
  expect(oilChance(r, far[0] + 1, far[1] + 1)).toBe(0);
  const oil = s.regions.heartland.inventory.oil;
  for (let i = 0; i < 24; i++) step(s);
  const b = s.buildings.find((x) => x.id === id)!;
  expect(s.regions.heartland.inventory.oil).toBe(oil);
  expect(b.reason).toMatch(/No oil|road/);
  expect(dispatch(s, { type: 'moveObject', region: r, key: `b:${id}`, at: [Math.round(f.x) - 1, Math.round(f.y) - 1] })).toMatchObject({ ok: false });
});

it('a refinery is huge, turns crude into diesel, pulls the farm industrial, and smokes out the homes near it', async () => {
  const { smokedShare, SMOKE_R, footprintOf } = await import('../simulation/world');
  const s = industry(609), r = 'heartland' as const;
  s.regions.heartland.inventory.oil = 200;
  const lean = s.values.cleanIndustrial ?? 50;
  expect(dispatch(s, { type: 'build', region: r, building: 'refinery' }).ok).toBe(true);
  const ref = s.buildings.find((b) => b.type === 'refinery')!, fp = footprintOf(s, `b:${ref.id}`)!;
  expect(fp.w * fp.d).toBeGreaterThanOrEqual(90); // a real refinery's sprawl
  expect(s.values.cleanIndustrial).toBeGreaterThan(lean);
  const fuel = s.regions.heartland.inventory.fuel;
  for (let i = 0; i < 6; i++) step(s);
  if (ref.reason !== 'No road access') { expect(s.regions.heartland.inventory.oil).toBeLessThan(200); expect(s.regions.heartland.inventory.fuel).toBeGreaterThan(fuel); }
  const [px, py] = worldOf(s, r).pos[`b:${ref.id}`], cx = px + fp.w / 2, cy = py + fp.d / 2;
  expect(smokedShare(s, [{ x: cx + 5, y: cy, families: 3 }, { x: cx + SMOKE_R + 10, y: cy, families: 1 }])).toBeCloseTo(0.75);
  ref.active = false; // a closed refinery stops smoking
  expect(smokedShare(s, [{ x: cx + 5, y: cy, families: 3 }])).toBe(0);
});

it('oil comes after the production houses, factories grow only on the farm\'s own power, and that power sets which way the farm leans', async () => {
  const { oilOpen } = await import('../simulation/stages/shared');
  const { chunkAt, footprintOf } = await import('../simulation/world');
  const s = industry(610); s.legacyProgression = false; s.stageId = 'industry'; if (!s.discovered.includes('upgrades')) s.discovered.push('upgrades');
  expect(oilOpen(s)).toBe(false);
  expect(dispatch(s, { type: 'surveyOil', region: 'heartland', at: [0, 0] })).toMatchObject({ ok: false, error: expect.stringMatching(/production houses/) });
  // two production houses at work open oil
  for (const t of ['flourMill', 'bakery'] as const) expect(dispatch(s, { type: 'build', region: 'heartland', building: t }).ok).toBe(true);
  const mills = s.buildings.filter((b) => b.type === 'flourMill' || b.type === 'bakery');
  for (const b of mills) b.util = 0.9;
  expect(oilOpen(s)).toBe(true);
  // the mill stands on industrial land so only power is in the way
  const mill = mills[0], w = worldOf(s, 'heartland'), [mx, my] = w.pos[`b:${mill.id}`], fp = footprintOf(s, `b:${mill.id}`)!;
  dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: chunksIn(mx, my, fp.w, fp.d), zone: 'ind' });
  expect(w.zones[chunkAt(mx, my)]).toBe('ind');
  expect(dispatch(s, { type: 'upgradeBuilding', buildingId: mill.id })).toMatchObject({ ok: false, error: expect.stringMatching(/own power/) });
  // a wind turbine powers it, and a factory run on clean power pulls the farm green
  const { findSpot } = await import('../simulation/world');
  const lot = findSpot(s, 'heartland', { w: 8, d: 8 }, false, 'building')!;
  dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: chunksIn(lot[0], lot[1], 8, 8), zone: 'ind' });
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'windTurbine' }).ok).toBe(true);
  const lean = s.values.cleanIndustrial ?? 50;
  const up = dispatch(s, { type: 'upgradeBuilding', buildingId: mill.id });
  expect(up).toMatchObject({ ok: true, note: expect.stringMatching(/green/) });
  expect(s.values.cleanIndustrial).toBeLessThan(lean);
  // run on oil instead and it pulls the other way
  for (let i = 0; i < 2; i++) s.buildings.push({ ...s.buildings.find((b) => b.type === 'windTurbine')!, id: 9900 + i, type: 'oilWell' });
  const lean2 = s.values.cleanIndustrial ?? 50;
  expect(dispatch(s, { type: 'upgradeBuilding', buildingId: mill.id })).toMatchObject({ ok: true, note: expect.stringMatching(/industrial/) });
  expect(s.values.cleanIndustrial).toBeGreaterThan(lean2);
});
