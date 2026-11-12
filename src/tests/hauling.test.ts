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

it('irrigation needs a channel from the river, dug over your own land', async () => {
  const { chunksIn, clearRect, own, riverTiles, worldOf, placeProblem, tileAt } = await import('../simulation/world');
  const s = createGame(503); post(s, 'prize', 100_000, 'fixture'); s.stageId = 'farm-business';
  const f = s.fields[0];
  expect(dispatch(s, { type: 'irrigate', fieldIds: [f.id] }).ok).toBe(false); // the river is beyond the valley
  const w = worldOf(s, 'heartland');
  own(w, chunksIn(-40, -8, 52, 24)); clearRect(w, -40, -8, 52, 24); // land down to the river
  const cash = s.cash;
  expect(dispatch(s, { type: 'irrigate', fieldIds: [f.id] }).ok).toBe(true);
  expect(f.irrigated).toBe(true);
  expect(Object.keys(w.canals).length).toBeGreaterThan(5);
  expect(s.cash).toBeLessThan(cash);
  const [rx, ry] = tileAt([...riverTiles('heartland')][100]);
  expect(placeProblem(s, 'heartland', rx, ry, { w: 1, d: 1 })).not.toBeNull(); // nothing is built on the river
});

it('pipes follow their field, can be buried to free the land, and a field cut off from the river gets no water', async () => {
  const W = await import('../simulation/world');
  const s = createGame(504); post(s, 'prize', 100_000, 'fixture'); s.stageId = 'farm-business';
  const f = s.fields[0], key = `field:${f.id}`, w = W.worldOf(s, 'heartland');
  W.own(w, W.chunksIn(-40, -8, 52, 24)); W.clearRect(w, -40, -8, 52, 24);
  expect(dispatch(s, { type: 'irrigate', fieldIds: [f.id] }).ok).toBe(true);
  const laid = [...(w.plinks?.[key] ?? [])];
  expect(laid.length).toBeGreaterThan(3);
  expect(W.hasWater(s, 'heartland', key)).toBe(true);
  // a surface pipe takes its tile; buried, the tile is free again
  const [px, py] = W.tileAt(laid[Math.floor(laid.length / 2)]);
  expect(W.placeProblem(s, 'heartland', px, py, { w: 1, d: 1 })).toBe('water');
  expect(dispatch(s, { type: 'buryPipe', region: 'heartland', at: [px, py] }).ok).toBe(true);
  expect(w.canals[W.tileId(px, py)]).toBe(2);
  expect(W.placeProblem(s, 'heartland', px, py, { w: 1, d: 1 })).not.toBe('water');
  expect(W.hasWater(s, 'heartland', key)).toBe(true); // water still flows underground
  // moving the field lifts its old pipe and lays a new one to where it went
  const side = W.plotSide(f.ha), to = W.findSpot(s, 'heartland', { w: side, d: side })!;
  expect(dispatch(s, { type: 'moveObject', region: 'heartland', key, at: to }).ok).toBe(true);
  for (const id of laid) if (!(w.plinks?.[key] ?? []).includes(id)) expect(w.canals[id]).toBeUndefined();
  expect(W.hasWater(s, 'heartland', key)).toBe(true);
  // removing its pipe cuts it off, and the result says so
  const mine = w.plinks?.[key] ?? [];
  if (mine.length) {
    const [mx, my] = W.tileAt(mine[0]);
    const r = dispatch(s, { type: 'removePipe', region: 'heartland', at: [mx, my] });
    expect(r.ok).toBe(true);
    expect(W.hasWater(s, 'heartland', key)).toBe(false);
    expect(r.ok && r.note).toMatch(/no water/);
  }
});
