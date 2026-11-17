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

it('moving costs a fee, idles a building briefly, and a planted field moves with its crop', () => {
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
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key: `field:${f.id}`, at: findSpot(s, 'heartland', { w: 2, d: 2 })! }).ok).toBe(true);
  expect(f.crop).toBe('wheat');
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

it('fields move with what stands on them: a growing crop, orchards and greenhouses, each for a higher fee', () => {
  const s = createGame(1008); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const [plain, orch, glass] = [0, 1, 2].map(() => { dispatch(s, { type: 'buyPlot' }); return s.fields[s.fields.length - 1]; });
  plain.crop = 'wheat'; orch.crop = 'apples'; glass.crop = 'wheat'; glass.greenhouse = true;
  const move = (f: typeof plain) => dispatch(s, { type: 'moveObject', region: 'heartland', key: `field:${f.id}`, at: findSpot(s, 'heartland', { w: 2, d: 2 })! });
  for (const [f, fee] of [[plain, 100], [orch, 220], [glass, 300]] as const) { // $20/ha, plus $80 for a growing crop, $200 for trees, $200 for glass
    const cash = s.cash;
    expect(move(f).ok).toBe(true);
    expect(cash - s.cash).toBeCloseTo(fee * f.ha * s.macro.cpi, 0);
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

it('buildings can be turned when placed or moved; the footprint turns and the track leaves from the front door', async () => {
  const { ROAD_Y, frontDoor, footprintOf, rotOf, tileId } = await import('../simulation/world');
  const s = createGame(1013); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = worldOf(s, 'heartland');
  const spot = (fw: number, fd: number) => { for (let y = ROAD_Y + 4; y < ROAD_Y + 14; y++) for (let x = -8; x < 12; x++) if (!placeProblem(s, 'heartland', x, y, { w: fw, d: fd })) return [x, y] as [number, number]; return null; };
  // a barn is 3×2; a quarter turn makes it 2×3, facing +x
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: spot(2, 3)!, rot: 1 }).ok).toBe(true);
  const key = `b:${s.buildings.at(-1)!.id}`;
  expect(rotOf(s, key)).toBe(1);
  expect(footprintOf(s, key)).toEqual({ w: 2, d: 3 });
  const [x, y] = w.pos[key];
  expect(frontDoor(x, y, { w: 2, d: 3 }, 1).some(([tx, ty]) => w.roads[tileId(tx, ty)])).toBe(true); // the track starts at the door
  // moving it with a new turn: back to 3×2, facing −y (away from the road), and the track still comes to the door
  const to = spot(3, 2)!;
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key, at: to, rot: 2 }).ok).toBe(true);
  expect(footprintOf(s, key)).toEqual({ w: 3, d: 2 });
  expect(frontDoor(to[0], to[1], { w: 3, d: 2 }, 2).some(([tx, ty]) => w.roads[tileId(tx, ty)])).toBe(true);
  // the map draws it turned
  expect(layoutRegion(s, 'heartland').lots.find((l) => l.place === key)).toMatchObject({ w: 3, d: 2, rot: 2 });
});

it('two tracks side by side are one wide road: upgrading it takes the whole width and length, not a branching track', async () => {
  const W = await import('../simulation/world');
  const { post } = await import('../simulation/core');
  const s = createGame(2026); post(s, 'prize', 500000, 'fixture'); step(s);
  for (const y of [-6, -5]) expect(dispatch(s, { type: 'buildRoad', region: 'heartland', from: [-10, y], to: [6, y] }).ok).toBe(true);
  const w = W.worldOf(s, 'heartland'), wide = Object.keys(w.roads).map(Number).filter((id) => { const y = W.tileAt(id)[1]; return y === -6 || y === -5; });
  expect(dispatch(s, { type: 'upgradeRoad', region: 'heartland', at: [0, -6] }).ok).toBe(true);
  expect(wide.every((id) => w.roads[id] === 2)).toBe(true);
});

it('bigger fields pack more hectares per tile (capped at 16×16 from 64 ha), and 500 ha fields stand 30×30', async () => {
  const { plotSide } = await import('../simulation/world');
  expect([1, 5, 25, 100, 500].map(plotSide)).toEqual([2, 4, 10, 16, 30]);
});

it('a placement on forest you do not own can be bought and cleared for; it goes up by itself when the crew finishes', async () => {
  const W = await import('../simulation/world');
  const { planQuote } = await import('../simulation/engine');
  const s = createGame(1014); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = W.worldOf(s, 'heartland'), owned = W.ownedSet(w);
  // the first barn-sized spot that is neither owned nor cleared but joins the farm
  let at: [number, number] | null = null;
  for (let y = W.MAP.y0; y < W.MAP.y0 + W.MAP.h - 3 && !at; y++) for (let x = W.MAP.x0; x < W.MAP.x0 + W.MAP.w - 3 && !at; x++) { const q = planQuote(s, 'heartland', [x, y], 3, 2, { type: 'build', region: 'heartland', building: 'barn' }); if (q.ok && q.buy.length && q.clear.length) at = [x, y]; }
  expect(at).not.toBeNull();
  const q = planQuote(s, 'heartland', at!, 3, 2, { type: 'build', region: 'heartland', building: 'barn' }), cash = s.cash, n = s.buildings.length;
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: at! }).ok).toBe(false);
  expect(dispatch(s, { type: 'planPlacement', region: 'heartland', action: { type: 'build', region: 'heartland', building: 'barn' }, at: at!, w: 3, d: 2, label: 'Barn' }).ok).toBe(true);
  expect(cash - s.cash).toBeCloseTo(q.cost, 1); expect(q.buy.every((c) => owned.has(c) || W.ownedSet(w).has(c))).toBe(true); expect(w.plans!.length).toBe(1); expect(s.buildings.length).toBe(n);
  for (let i = 0; i < q.hours + 30 && w.plans!.length; i++) step(s);
  expect(w.plans!.length).toBe(0); expect(s.buildings.length).toBe(n + 1); expect(w.pos[`b:${s.buildings.at(-1)!.id}`]).toEqual(at);
});

it('a field climbs from polytunnels to a greenhouse to a hydroponic house: frost stops, then soil stops mattering and yield rises', async () => {
  const A = await import('../simulation/agriculture');
  const s = createGame(1015); s.legacyProgression = true; s.era = 6; post(s, 'prize', 1e6, 'fixture'); s.discovered = [...new Set([...(s.discovered ?? []), 'frost', 'upgrades'])];
  const f = s.fields[0]; f.crop = 'potatoes'; f.plantedAt = s.tick - 200;
  const cash = s.cash, price1 = A.coverPrice(s, f);
  expect(dispatch(s, { type: 'coverField', fieldId: f.id }).ok).toBe(true); expect(A.coverOf(f)).toBe(1); expect(f.greenhouse).toBe(false); expect(cash - s.cash).toBe(price1);
  A.frostNight(s, f.region); expect(f.frost).toBe(0); // tunnels keep the frost off
  expect(dispatch(s, { type: 'coverField', fieldId: f.id }).ok).toBe(true); expect(f.greenhouse).toBe(true);
  f.soil = { n: 0.2, p: 0.2, k: 0.2, organic: 0.1 }; const poor = A.soilFactor(f, 'potatoes');
  expect(dispatch(s, { type: 'coverField', fieldId: f.id }).ok).toBe(true); expect(A.coverOf(f)).toBe(3); expect(A.soilFactor(f, 'potatoes')).toBe(1.3); expect(poor).toBeLessThan(1);
  expect(dispatch(s, { type: 'coverField', fieldId: f.id }).ok).toBe(false);
});

it('two level-3 factories side by side merge into a works, two works into a plant: more output on fewer hands, and undo splits them', async () => {
  const W = await import('../simulation/world');
  const { factoryMerge } = await import('../simulation/engine');
  const { throughput, sizeStaff } = await import('../simulation/core');
  const { dispatchEdit, undoEdit } = await import('../simulation/undo');
  const s = createGame(1016); s.legacyProgression = true; s.era = 6; post(s, 'prize', 5e6, 'fixture');
  const w = W.worldOf(s, 'heartland'), o: [number, number] = [W.MAP.x0 + 40, W.MAP.y0 + 8];
  const chunks = [...new Set(Array.from({ length: 144 }, (_, i) => W.chunkAt(o[0] + (i % 12), o[1] + Math.floor(i / 12))))];
  w.owned = [...new Set([...w.owned, ...chunks])]; w.cleared = [...new Set([...w.cleared, ...chunks])]; for (const c of chunks) w.zones[c] = 'ind'; W.touch(w);
  const ids: number[] = [];
  for (const at of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) { expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill', at: [o[0] + at[0], o[1] + at[1]] }).ok).toBe(true); ids.push(s.buildings.at(-1)!.id); }
  expect(dispatch(s, { type: 'mergeBuilding', buildingId: ids[0] }).ok).toBe(false); // level 1 will not merge
  for (const b of s.buildings) if (ids.includes(b.id)) b.level = 3;
  const g = factoryMerge(s, ids[0])!, cash = s.cash; expect(g.ready).toBe(true);
  const { r, edit } = dispatchEdit(s, { type: 'mergeBuilding', buildingId: ids[0] }); expect(r.ok).toBe(true);
  const works = s.buildings.find((b) => b.id === ids[0])!;
  expect(works.size).toBe(2); expect(cash - s.cash).toBe(g.price); expect(W.footprintOf(s, `b:${works.id}`)).toEqual({ w: 5, d: 2 }); expect(throughput(works)).toBeCloseTo(4 * 2.2, 5); expect(sizeStaff(works)).toBe(1.8);
  expect(s.buildings.some((b) => b.id === ids[1])).toBe(false);
  undoEdit(s, edit!); expect(s.buildings.filter((b) => ids.includes(b.id)).length).toBe(4); expect(s.cash).toBeCloseTo(cash, 2); expect(W.footprintOf(s, `b:${ids[0]}`)).toEqual({ w: 2, d: 2 });
  expect(dispatch(s, { type: 'mergeBuilding', buildingId: ids[0] }).ok).toBe(true);
  expect(dispatch(s, { type: 'mergeBuilding', buildingId: s.buildings.find((b) => b.type === 'flourMill' && !b.size)!.id }).ok).toBe(true); // the other pair
  expect(dispatch(s, { type: 'mergeBuilding', buildingId: ids[0] }).ok).toBe(true); // two works make a plant
  const plant = s.buildings.find((b) => b.id === ids[0])!;
  expect(plant.size).toBe(4); expect(W.footprintOf(s, `b:${plant.id}`)).toEqual({ w: 5, d: 5 }); expect(s.buildings.filter((b) => b.type === 'flourMill').length).toBe(1);
  for (let i = 0; i < 30; i++) step(s); // it runs
});

it('oil land prices rush after a strike and cool back to normal when nothing new is struck nearby', async () => {
  const { oilOf, oilPremium, rush } = await import('../simulation/oil');
  const W = await import('../simulation/world');
  const s = createGame(1021), key = 'heartland:0', O = oilOf(s);
  O.drawn[key] = 1; O.struck![key] = s.tick; // a field struck today
  const { oilFields } = await import('../simulation/oil'); const f = oilFields('heartland')[0], c = W.chunkAt(Math.floor(f.x), Math.floor(f.y));
  const hot = oilPremium(s, 'heartland', c); expect(hot).toBeGreaterThan(2);
  s.tick += 24 * 29; expect(rush(s, key)).toBe(1); // still a rush within the month
  s.tick += 24 * 46; expect(oilPremium(s, 'heartland', c)).toBeLessThan(hot); expect(oilPremium(s, 'heartland', c)).toBeGreaterThan(1);
  s.tick += 24 * 60; expect(oilPremium(s, 'heartland', c)).toBe(1); // cooled right down
  O.struck![key] = s.tick; expect(oilPremium(s, 'heartland', c)).toBeCloseTo(hot, 5); // a new strike starts it again
});

it('tree lines are planted like roads on open cleared land, keep buildings and roads off their tiles, and can be felled', async () => {
  const W = await import('../simulation/world');
  const s = createGame(1022); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = W.worldOf(s, 'heartland'), spot = W.findSpot(s, 'heartland', { w: 8, d: 3 })!, y = spot[1] + 1;
  const cash = s.cash;
  expect(dispatch(s, { type: 'buildBelt', region: 'heartland', from: [spot[0], y], to: [spot[0] + 7, y] }).ok).toBe(true);
  expect(Object.keys(w.belts!).length).toBe(8); expect(cash - s.cash).toBe(Math.round(30 * s.macro.cpi * 8));
  expect(W.placeProblem(s, 'heartland', spot[0] + 2, y - 1, { w: 2, d: 2 })).toBe('occupied'); // no building on the trees
  expect(W.roadRoute(s, 'heartland', [spot[0] + 3, y], [spot[0] + 3, y])).toBeNull(); // no road through them
  expect(dispatch(s, { type: 'removeBelt', region: 'heartland', at: [spot[0] + 4, y] }).ok).toBe(true); expect(Object.keys(w.belts!).length).toBe(0);
});
