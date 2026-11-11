import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { layoutRegion } from '../app/world/layout';
import { chunkAt, chunkOrigin, clearedSet, findSpot, frontierPatches, landFrontier, placeProblem, worldOf } from '../simulation/world';

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
  expect(placeProblem(s, 'heartland', 60, 60, { w: 3, d: 2 })).toBe('unowned');
  expect(dispatch(s, { type: 'clearForest', region: 'heartland', chunks: [chunkAt(60, 60)] }).ok).toBe(false); // not yours to clear
  expect(dispatch(s, { type: 'buyLand', region: 'heartland', chunks: [chunkAt(60, 60)] }).ok).toBe(false); // must join your land
  const land = landFrontier(s, 'heartland', 4), before = s.cash;
  expect(dispatch(s, { type: 'buyLand', region: 'heartland', chunks: land }).ok).toBe(true);
  expect(s.cash).toBeLessThan(before);
  const [lx, ly] = chunkOrigin(land[0]);
  expect(placeProblem(s, 'heartland', lx, ly, { w: 2, d: 2 })).toBe('forest'); // yours now, but still woodland
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


it('a new farm starts with just its farmhouse; landmarks appear with their chapter and then stay', () => {
  const s = createGame(1007), w = worldOf(s, 'heartland');
  expect(Object.keys(w.pos).sort()).toEqual(['farmhouse', `field:${s.fields[0].id}`].sort());
  const home = findSpot(s, 'heartland', { w: 3, d: 3 })!;
  post(s, 'prize', 1000, 'fixture');
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key: 'farmhouse', at: home }).ok).toBe(true);
  s.stats.harvests = 1;
  for (let i = 0; i < 8; i++) step(s);
  expect(w.pos.market).toBeDefined();
  const market = w.pos.market;
  for (let i = 0; i < 48; i++) step(s);
  expect(w.pos.market).toEqual(market);
  expect(w.pos.farmhouse).toEqual(home);
});

it('orchards, vineyards and greenhouse fields move with what stands on them, for a higher fee', () => {
  const s = createGame(1008); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const [plain, orch, glass] = [0, 1, 2].map(() => { dispatch(s, { type: 'buyPlot' }); return s.fields[s.fields.length - 1]; });
  plain.crop = 'wheat'; orch.crop = 'apples'; glass.crop = 'wheat'; glass.greenhouse = true;
  const move = (f: typeof plain) => dispatch(s, { type: 'moveObject', region: 'heartland', key: `field:${f.id}`, at: findSpot(s, 'heartland', { w: 2, d: 2 })! });
  expect(move(plain).ok).toBe(false); // ordinary crops are harvested first
  for (const f of [orch, glass]) {
    const cash = s.cash;
    expect(move(f).ok).toBe(true);
    expect(cash - s.cash).toBeCloseTo(220 * f.ha * s.macro.cpi, 0);
    expect(f.crop).toBeTruthy();
  }
});


it('building several homes makes separate homes, each on its own plot', async () => {
  const { communityOf } = await import('../simulation/community-state');
  const s = createGame(1009); s.legacyProgression = true; s.era = 5; post(s, 'prize', 1e7, 'fixture');
  const c = communityOf(s); c.active = true;
  const { chunksIn } = await import('../simulation/world');
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: chunksIn(-12, -8, 12, 12), zone: 'res' }).ok).toBe(true); // homes need a residential zone
  const before = c.homes.length;
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 3 }).ok).toBe(true);
  const made = c.homes.slice(before);
  expect(made.map((h) => h.count)).toEqual([1, 1, 1]);
  const w = worldOf(s, 'heartland');
  expect(new Set(made.map((h) => String(w.pos[`home:${h.id}`]))).size).toBe(3);
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 2, at: [0, 0] }).ok).toBe(false); // placed one at a time
});

it('buildings get a dirt track to the road and stop working without one; roads can be drawn, upgraded and removed', async () => {
  const W = await import('../simulation/world');
  const { stored } = await import('../simulation/core');
  const { marketCut, marketRoute } = await import('../simulation/hauling');
  const s = createGame(1010); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = W.worldOf(s, 'heartland');
  expect(W.hasAccess(s, 'heartland', 'b:999')).toBe(true); // nothing placed: nothing to cut off
  // a dead-end stub must not count as a road: the barn's track has to reach the main road
  w.roads[W.tileId(-6, -6)] = 1; w.roads[W.tileId(-5, -6)] = 1; W.touch(w);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: [-6, -5] }).ok).toBe(true);
  const barn = s.buildings[0], key = `b:${barn.id}`;
  expect(W.hasAccess(s, 'heartland', key)).toBe(true);
  const cap = stored(s, 'heartland').cap.dry;
  // removing the barn's track cuts it off: the result says so, and the barn stores nothing
  const track = Object.keys(w.roads).map(Number).filter((id) => { const [x, y] = W.tileAt(id); return y > -6 && y < 6 && x >= -7 && x <= -3; });
  expect(track.length).toBeGreaterThan(0);
  const [tx, ty] = W.tileAt(track[0]);
  const removed = dispatch(s, { type: 'removeRoad', region: 'heartland', at: [tx, ty] });
  expect(removed.ok && removed.note).toMatch(/no road/);
  expect(W.hasAccess(s, 'heartland', key)).toBe(false);
  expect(stored(s, 'heartland').cap.dry).toBeLessThan(cap);
  // with the only store cut off, the carts load at the farmhouse yard; draw the barn a road back
  expect(dispatch(s, { type: 'buildRoad', region: 'heartland', from: [-6, -3], to: [-6, 5] }).ok).toBe(true); // from the barn's doorstep down to the main road
  W.touch(w);
  expect(W.hasAccess(s, 'heartland', key)).toBe(true);
  expect(marketRoute(s).length).toBeGreaterThan(0);
  expect(marketCut(s)).toBe(false);
  // upgrades: a stretch to gravel, then the whole main road at its real price
  const before = s.cash;
  expect(dispatch(s, { type: 'upgradeRoad', region: 'heartland', at: [-6, 0] }).ok).toBe(true);
  expect(s.cash).toBeLessThan(before);
  expect(W.roadStretch(w, -6, 0).every((id) => w.roads[id] === 2)).toBe(true);
  const cash = s.cash;
  expect(dispatch(s, { type: 'upgradeRoad', region: 'heartland', at: [0, 6] }).ok).toBe(true);
  expect(cash - s.cash).toBeCloseTo(W.roadTilePrice(s, 2) * W.MAP.w * W.ROAD_H, 0);
  expect(w.main).toBe(2);
  expect(dispatch(s, { type: 'removeRoad', region: 'heartland', at: [0, 6] }).ok).toBe(false); // the main road stays
  // at a junction, Remove takes only that tile
  for (const [x, y] of [[20, -6], [21, -6], [22, -6], [21, -7], [21, -5]]) w.roads[W.tileId(x, y)] = 1;
  W.touch(w);
  expect(W.roadStretch(w, 21, -6)).toEqual([W.tileId(21, -6)]);
});

it('a building\'s dirt track goes with it when it is demolished or moved, but never strands a neighbour', async () => {
  const { hasAccess, ROAD_Y } = await import('../simulation/world');
  const s = createGame(1012); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = worldOf(s, 'heartland'), roads = () => Object.keys(w.roads).length;
  const far = (dy: number) => { for (let x = -8; x < 10; x++) if (!placeProblem(s, 'heartland', x, ROAD_Y + dy, { w: 3, d: 3 })) return [x, ROAD_Y + dy] as [number, number]; return null; };
  const before = roads();
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: far(6)! }).ok).toBe(true);
  const barn = s.buildings.at(-1)!;
  expect(roads()).toBeGreaterThan(before);
  expect(dispatch(s, { type: 'demolish', buildingId: barn.id }).ok).toBe(true);
  expect(roads()).toBe(before); // no stub left behind

  // a second barn further out joins the first one's track; demolishing the first keeps the second on the road
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: far(6)! }).ok).toBe(true);
  const a = s.buildings.at(-1)!;
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: far(11)! }).ok).toBe(true);
  const b = s.buildings.at(-1)!;
  expect(dispatch(s, { type: 'demolish', buildingId: a.id }).ok).toBe(true);
  expect(hasAccess(s, 'heartland', `b:${b.id}`)).toBe(true);

  // moving lifts the old track and lays a new one
  const oldTiles = [...(w.links[`b:${b.id}`] ?? [])];
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key: `b:${b.id}`, at: far(3)! }).ok).toBe(true);
  for (const id of oldTiles) if (!(w.links[`b:${b.id}`] ?? []).includes(id)) expect(w.roads[id]).toBeUndefined();
  expect(hasAccess(s, 'heartland', `b:${b.id}`)).toBe(true);
});
