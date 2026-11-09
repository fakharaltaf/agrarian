import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { day, post } from '../simulation/core';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '../simulation/config';
import { parseSave } from '../simulation/persistence';

const toDay = (s: ReturnType<typeof createGame>, d: number) => { while (day(s) < d && !s.bankrupt) step(s); expect(s.bankrupt).toBeNull(); };

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

it('farm investment is deducted the year it is paid, and losses carry forward', () => {
  const a = createGame(44), b = createGame(44);
  for (const s of [a, b]) post(s, 'sale', 50_000, 'fixture profit');
  post(b, 'land', -30_000, 'fixture field');
  for (const s of [a, b]) { toDay(s, DAYS_PER_YEAR + 1); }
  expect(b.taxBill!.amount).toBeCloseTo(a.taxBill!.amount * 0.4, 0); // taxed on 20k, not 50k

  const c = createGame(45);
  post(c, 'loanIn', 40_000, 'fixture funding (not taxable)');
  post(c, 'land', -40_000, 'fixture: invest more than earned');
  post(c, 'sale', 10_000, 'fixture');
  toDay(c, DAYS_PER_YEAR + 1);
  expect(c.taxBill ?? null).toBeNull();
  expect(c.taxLoss!.heartland!).toBeGreaterThanOrEqual(30_000);
  const carried = c.taxLoss!.heartland!;
  post(c, 'sale', carried + 5_000, 'fixture next year');
  toDay(c, 2 * DAYS_PER_YEAR + 1);
  expect(c.taxLoss?.heartland ?? 0).toBe(0);
  expect(c.taxBill!.amount).toBeLessThan(5_000 * 0.2 + 1); // only the 5k above the carried loss (+ the year's small costs)
});
