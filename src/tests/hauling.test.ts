import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { haulOf, oneWay, onTheWay } from '../simulation/hauling';

it('market sales travel by cart and are paid on arrival; a horse cart adds a faster, bigger vehicle', () => {
  const s = createGame(501); post(s, 'prize', 50_000, 'fixture');
  s.stageId = 'market-town';
  s.regions.heartland.inventory.wheat = 400;
  const sales = s.lifetime.sale ?? 0, cash = s.cash;
  expect(dispatch(s, { type: 'sell', region: 'heartland', good: 'wheat', qty: 300 }).ok).toBe(true);
  expect(s.regions.heartland.inventory.wheat).toBeCloseTo(100, 0); // loaded and gone from the store
  expect(s.cash).toBe(cash); // not paid yet
  const owed = onTheWay(s).waiting;
  expect(owed).toBeGreaterThan(0);
  step(s); // the dog cart sets off with what fits
  expect(haulOf(s).trips.length).toBe(1);
  const hours = oneWay(s, 'cart');
  for (let i = 0; i < hours; i++) step(s);
  expect((s.lifetime.sale ?? 0) - sales).toBeGreaterThan(0); // first load paid on arrival
  expect(haulOf(s).pending.length).toBe(1); // the rest waits for the cart to come back
  expect(dispatch(s, { type: 'buyHorseCart' }).ok).toBe(true);
  for (let i = 0; i < hours * 4; i++) step(s);
  expect(haulOf(s).pending.length).toBe(0);
  expect((s.lifetime.sale ?? 0) - sales).toBeCloseTo(owed, 0);
});

it('homestead sales to the trader and the mill are paid on the spot', () => {
  const s = createGame(502);
  expect(haulOf(s).pending.length).toBe(0);
  s.regions.heartland.inventory.wheat = 10;
  const cash = s.cash;
  dispatch(s, { type: 'sellToMill', qty: 5 });
  expect(s.cash).toBeGreaterThan(cash);
});

it('water lines: irrigation is just the kit; you dig a ditch to the river, upgrade it to pipe then bury it, and the tier sets the moisture', async () => {
  const W = await import('../simulation/world');
  const s = createGame(504); post(s, 'prize', 100_000, 'fixture'); s.stageId = 'farm-business';
  const f = s.fields[0], key = `field:${f.id}`, w = W.worldOf(s, 'heartland'), r = 'heartland' as const;
  W.own(w, W.chunksIn(-40, -8, 52, 24)); W.clearRect(w, -40, -8, 52, 24);
  const cash = s.cash, res = dispatch(s, { type: 'irrigate', fieldIds: [f.id] });
  expect(res.ok && res.note).toMatch(/ditch/); // installed, but no water until a line reaches it
  expect(cash - s.cash).toBe(Math.round(f.ha * 300 * s.macro.cpi));
  expect(Object.keys(w.canals).length).toBe(0); // nothing laid by itself
  expect(W.fieldWater(s, r, key).points).toBe(0);
  // dig from a tile beside the river to the field's edge
  const [px, py] = w.pos[key], to: [number, number] = [px - 1, py], river = W.riverTiles(r);
  let from: [number, number] | undefined;
  for (const id of river) { const [x, y] = W.tileAt(id); for (const [dx, dy] of [[1, 0], [-1, 0]]) if (!from && !river.has(W.tileId(x + dx, y + dy)) && W.pipeRoute(s, r, [x + dx, y + dy], to)) from = [x + dx, y + dy]; }
  expect(from).toBeDefined();
  expect(dispatch(s, { type: 'buildPipe', region: r, from: from!, to }).ok).toBe(true);
  const fw = W.fieldWater(s, r, key);
  expect(fw.tier).toBe(1); expect(fw.points).toBeGreaterThan(0);
  expect(fw.need).toBe(Math.ceil(W.plotSide(f.ha) / 6));
  expect(W.placeProblem(s, r, to[0], to[1], { w: 1, d: 1 })).toBe('water'); // a ditch takes its tile
  expect(dispatch(s, { type: 'upgradePipe', region: r, at: to }).ok).toBe(true);
  expect(W.fieldWater(s, r, key).tier).toBe(2);
  expect(W.placeProblem(s, r, to[0], to[1], { w: 1, d: 1 })).toBe('water'); // so does a pipe
  expect(dispatch(s, { type: 'upgradePipe', region: r, at: to }).ok).toBe(true);
  expect(W.fieldWater(s, r, key).tier).toBe(3);
  expect(W.placeProblem(s, r, to[0], to[1], { w: 1, d: 1 })).not.toBe('water'); // buried: the land is free
  expect(dispatch(s, { type: 'upgradePipe', region: r, at: to }).ok).toBe(false);
  // the tier sets how wet the field is kept
  const { CROPS } = await import('../simulation/config');
  const was = f.crop;
  f.crop = Object.keys(CROPS).find((c) => !CROPS[c as keyof typeof CROPS].perennial) as typeof f.crop; f.moisture = 0;
  for (let i = 0; i < 48; i++) step(s);
  expect(f.moisture).toBeGreaterThan(W.WATER_LEVEL[3] - 0.1);
  f.crop = was; // empty again, so it can move
  // a moved field leaves its line behind and has to be joined up again
  const lines = Object.keys(w.canals).length, side = W.plotSide(f.ha), spot = W.findSpot(s, r, { w: side, d: side })!;
  expect(dispatch(s, { type: 'moveObject', region: r, key, at: spot }).ok).toBe(true);
  expect(Object.keys(w.canals).length).toBe(lines);
  if (!W.hasWater(s, r, key)) expect(W.fieldWater(s, r, key).points).toBe(0);
  // removing the line warns about the fields it fed
  dispatch(s, { type: 'moveObject', region: r, key, at: [px, py] });
  const rm = dispatch(s, { type: 'removePipe', region: r, at: to });
  expect(rm.ok && rm.note).toMatch(/no water/);
  expect(W.hasWater(s, r, key)).toBe(false);
});

it('a ditch started on the river bank (the drawn river is wider than its tiles) still takes water', async () => {
  const W = await import('../simulation/world');
  const s = createGame(504); post(s, 'prize', 100_000, 'fixture'); s.stageId = 'farm-business';
  const f = s.fields[0], key = `field:${f.id}`, w = W.worldOf(s, 'heartland'), r = 'heartland' as const;
  W.own(w, W.chunksIn(-40, -8, 52, 24)); W.clearRect(w, -40, -8, 52, 24);
  const [px, py] = w.pos[key], to: [number, number] = [px - 1, py], river = W.riverTiles(r);
  let from: [number, number] | undefined; // two tiles out from the water, nothing beside it is river
  for (const id of river) { const [x, y] = W.tileAt(id); if (!from && !river.has(W.tileId(x + 1, y)) && !river.has(W.tileId(x + 2, y + 1)) && !river.has(W.tileId(x + 2, y - 1)) && W.pipeRoute(s, r, [x + 2, y], to)) from = [x + 2, y]; }
  expect(dispatch(s, { type: 'buildPipe', region: r, from: from!, to }).ok).toBe(true);
  expect(W.fieldWater(s, r, key).points).toBeGreaterThan(0);
  expect(W.fieldWater({ ...s }, r, key).need).toBe(Math.ceil(W.plotSide(f.ha) / 8));
});

it('land on the main road is for sale even away from the farm, and land joining it after that', async () => {
  const W = await import('../simulation/world');
  const s = createGame(505); post(s, 'prize', 1_000_000, 'fixture');
  const w = W.worldOf(s, 'heartland'), far = W.chunkAt(W.MAP.x0 + W.MAP.w - 6, W.ROAD_Y + 4), inland = W.chunkAt(W.MAP.x0 + W.MAP.w - 6, W.ROAD_Y + 20);
  expect(W.onMainRoad(far)).toBe(true);
  expect(W.ownedSet(w).has(far)).toBe(false);
  expect(dispatch(s, { type: 'buyLand', region: 'heartland', chunks: [inland] }).ok).toBe(false); // off the road and away from the farm
  expect(dispatch(s, { type: 'buyLand', region: 'heartland', chunks: [far] }).ok).toBe(true);
  expect(W.ownedSet(w).has(far)).toBe(true);
  const next = far + W.CHUNKS_X; // the patch behind it, away from the road
  expect(W.onMainRoad(next)).toBe(false);
  expect(dispatch(s, { type: 'buyLand', region: 'heartland', chunks: [next] }).ok).toBe(true); // joins the new roadside patch
});
