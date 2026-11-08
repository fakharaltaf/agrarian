import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { parseSave } from '../simulation/persistence';
import { layoutRegion } from '../app/world/layout';
import { clearedSet, findSpot, frontierPatches, placeProblem, worldOf } from '../simulation/world';

it('building and buying never move what is already placed', () => {
  const s = createGame(1003), before = layoutRegion(s, 'heartland');
  s.legacyProgression = true; s.era = 4;
  post(s, 'prize', 1e6, 'Layout fixture capital');
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
  expect(dispatch(s, { type: 'buyPlot' }).ok).toBe(true);
  const after = layoutRegion(s, 'heartland');
  for (const p of before.plots) expect(after.plots.find((q) => q.field.id === p.field.id)).toMatchObject({ x: p.x, y: p.y, s: p.s });
  expect(after.lots.find((l) => l.key === 'house')).toMatchObject({ x: before.lots[0].x, y: before.lots[0].y });
  expect(after.lots.some((l) => l.buildings[0]?.type === 'flourMill')).toBe(true);
});

it('a chosen spot must be cleared, free and off the road; forest can be cleared and sold as timber', () => {
  const s = createGame(1004); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = worldOf(s, 'heartland');
  expect(placeProblem(s, 'heartland', 1, 1, { w: 3, d: 2 })).toBe('occupied'); // the farmhouse
  expect(placeProblem(s, 'heartland', 10, 5, { w: 3, d: 2 })).toBe('road');
  expect(placeProblem(s, 'heartland', 60, 60, { w: 3, d: 2 })).toBe('forest');
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: [60, 60] }).ok).toBe(false);
  const cash = s.cash, chunks = frontierPatches(s, 'heartland', 4);
  expect(dispatch(s, { type: 'clearForest', region: 'heartland', chunks }).ok).toBe(true);
  expect(s.cash).toBeLessThan(cash);
  const sales = s.lifetime.sale ?? 0;
  while (w.queue.length) step(s);
  for (const c of chunks) expect(clearedSet(w).has(c)).toBe(true);
  expect((s.lifetime.sale ?? 0)).toBeGreaterThan(sales); // timber sold by the crew
  const spot = findSpot(s, 'heartland', { w: 3, d: 2 })!;
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: spot }).ok).toBe(true);
  const barn = s.buildings.find((b) => b.type === 'barn')!;
  expect(w.pos[`b:${barn.id}`]).toEqual(spot);
});

it('moving costs a fee, idles a building briefly, and fields must be empty', () => {
  const s = createGame(1005); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
  const mill = s.buildings[0], key = `b:${mill.id}`, to = findSpot(s, 'heartland', { w: 2, d: 2 })!;
  const cash = s.cash;
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key, at: to }).ok).toBe(true);
  expect(s.cash).toBeLessThan(cash);
  expect(worldOf(s, 'heartland').pos[key]).toEqual(to);
  expect(mill.movedUntil).toBeGreaterThan(s.tick);
  const f = s.fields[0];
  expect(dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' }).ok).toBe(true);
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key: `field:${f.id}`, at: findSpot(s, 'heartland', { w: 2, d: 2 })! }).ok).toBe(false);
});

it('old saves keep their arrangement and start with their farm cleared; the map survives a save', () => {
  const s = createGame(1006); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  for (let i = 0; i < 3; i++) dispatch(s, { type: 'build', region: 'heartland', building: 'barn' });
  const old = JSON.parse(JSON.stringify(s)); delete old.world; old.version = 12;
  const g = parseSave(JSON.stringify({ game: old })).game;
  const w = worldOf(g, 'heartland');
  for (const b of g.buildings) expect(w.pos[`b:${b.id}`]).toBeDefined();
  for (const f of g.fields) expect(w.pos[`field:${f.id}`]).toBeDefined();
  for (const [k, [x, y]] of Object.entries(w.pos)) expect(clearedSet(w).has(Math.floor((y + 72) / 4) * 48 + Math.floor((x + 80) / 4)), k).toBe(true);
  expect(parseSave(JSON.stringify({ game: g })).game.world).toEqual(g.world);
});
