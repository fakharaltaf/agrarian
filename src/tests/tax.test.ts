import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { day, post } from '../simulation/core';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '../simulation/config';
import { parseSave } from '../simulation/persistence';

const toDay = (s: ReturnType<typeof createGame>, d: number) => { while (day(s) < d) step(s); };

it('year end issues one fixed tax bill, payable within 30 days, taken on the due day if unpaid', () => {
  const s = createGame(42);
  post(s, 'sale', 50_000, 'fixture profit');
  toDay(s, DAYS_PER_YEAR - 1);
  expect(s.taxBill ?? null).toBeNull();
  toDay(s, DAYS_PER_YEAR);
  for (let i = 0; i < TICKS_PER_DAY; i++) step(s);
  const bill = s.taxBill!;
  expect(bill.amount).toBeGreaterThan(0);
  expect(bill.dueDay).toBe(DAYS_PER_YEAR + 30);
  expect(s.lifetime.tax ?? 0).toBe(0); // not charged yet
  expect(parseSave(JSON.stringify({ game: s })).game.taxBill).toEqual(bill);
  toDay(s, DAYS_PER_YEAR + 20);
  expect(s.taxBill!.amount).toBe(bill.amount); // the figure never moves
  toDay(s, bill.dueDay + 1);
  expect(s.taxBill).toBeNull();
  expect(s.lifetime.tax).toBeCloseTo(-bill.amount, 2);
});

it('the bill can be paid early', () => {
  const s = createGame(43);
  s.taxBill = { amount: 100, byRegion: { heartland: 100 }, dueDay: 30 };
  expect(dispatch(s, { type: 'payTax' }).ok).toBe(true);
  expect(s.taxBill).toBeNull();
  expect(s.lifetime.tax).toBe(-100);
  expect(dispatch(s, { type: 'payTax' }).ok).toBe(false);
});
