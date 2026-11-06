import { townOf } from './town-state';
// Financial statements, derived only from ledger books and live state.
import { FINANCING_KINDS, INVESTING_KINDS, LEDGER_KINDS, OPEX_KINDS, REVENUE_KINDS, type LedgerKind } from './config';
import { debt, fixedAssets, inventoryValue, sumBooks } from './core';
import type { GameState } from './types';

const sum = (s: GameState, days: number, kinds: LedgerKind[]) => sumBooks(s, days, kinds);
const lines = (s: GameState, days: number, kinds: LedgerKind[]) =>
  kinds.map((k) => ({ kind: k, label: LEDGER_KINDS[k], value: sum(s, days, [k]) })).filter((l) => Math.abs(l.value) >= 0.005);

export function incomeStatement(s: GameState, days: number) {
  const revenue = sum(s, days, REVENUE_KINDS);
  const opex = sum(s, days, OPEX_KINDS);
  const ebitda = revenue + opex;
  const depreciation = sum(s, days, ['depreciation']);
  const ebit = ebitda + depreciation;
  const interest = sum(s, days, ['interest']);
  const other = sum(s, days, ['futures', 'insurancePayout', 'prize']);
  const pretax = ebit + interest + other;
  const tax = sum(s, days, ['tax']);
  const net = pretax + tax;
  return {
    revenueLines: lines(s, days, REVENUE_KINDS), opexLines: lines(s, days, OPEX_KINDS),
    revenue, opex, ebitda, depreciation, ebit, interest, other, pretax, tax, net,
    operatingMargin: revenue ? ebit / revenue : 0,
  };
}

export function balanceSheet(s: GameState) {
  const fa = fixedAssets(s);
  const inventory = inventoryValue(s);
  const cash = Math.max(0, s.cash);
  const townAdvance=townOf(s).companyAdvance;
  const assets = townAdvance + cash + s.marginAccount + inventory + fa.land + fa.machines + fa.buildings;
  const loans = s.loans.reduce((a, l) => a + l.balance, 0);
  const overdraft = Math.max(0, -s.cash);
  const liabilities = loans + overdraft;
  const equity = assets - liabilities;
  const paidIn = 250 + (s.lifetime.sharesIssued ?? 0) + (s.lifetime.buyback ?? 0);
  return { cash, townAdvance, margin: s.marginAccount, inventory, land: fa.land, machines: fa.machines, buildings: fa.buildings, assets, loans, overdraft, liabilities, equity, paidIn, retained: equity - paidIn };
}

export function cashFlow(s: GameState, days: number) {
  const investing = sum(s, days, [...INVESTING_KINDS, 'margin']);
  const financing = sum(s, days, FINANCING_KINDS);
  const total = sumBooks(s, days) - sum(s, days, ['depreciation']);
  return { operating: total - investing - financing, investing, financing, total };
}

export function ratios(s: GameState) {
  const is = incomeStatement(s, 30);
  const bs = balanceSheet(s);
  const invested = bs.equity + bs.liabilities - bs.cash;
  const cogs = -sum(s, 30, ['seeds', 'fertilizer', 'purchases']);
  return {
    operatingMargin: is.operatingMargin,
    roic: invested > 0 ? ((is.ebit * (120 / 30)) * 0.8) / invested : 0,
    debtToEquity: bs.equity > 0 ? bs.liabilities / bs.equity : Infinity,
    interestCoverage: is.interest < 0 ? is.ebit / -is.interest : Infinity,
    workingCapital: bs.cash + bs.inventory + bs.margin - bs.overdraft,
    inventoryTurnover: bs.inventory > 0 ? (cogs * 4) / bs.inventory : 0,
    debt: debt(s),
  };
}
