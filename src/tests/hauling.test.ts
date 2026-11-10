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
