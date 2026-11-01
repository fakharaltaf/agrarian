// Finance: the books, statements, banking and insurance. Every figure is read from the ledger,
// the daily books or live state; this is where players learn how a business's money works.
import { useMemo, useState, type ReactNode } from 'react';
import { DAYS_PER_YEAR, LEDGER_KINDS, OPEX_KINDS, REGIONS, REVENUE_KINDS, type LedgerKind, type RegionId } from '../../simulation/config';
import { day, debt, equity, fixedAssets, inventoryValue, sumBooks, totalAssets } from '../../simulation/core';
import { creditLimit, insurancePremium } from '../../simulation/engine';
import { creditSpread, loanRate, overdraftLimit } from '../../simulation/finance';
import { balanceSheet, cashFlow, incomeStatement, ratios } from '../../simulation/statements';
import type { DayBook, GameState, LedgerEntry, Loan } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { Bars, LineChart } from '../Chart';
import { money, num, pct0, stamp } from '../format';
import { Bar, Card, Confirm, Info, Kpi, NumberInput, PageHead, Seg, Table, Tabs, usePref, type Col } from '../ui';
import { unlockedRegions } from './shared';

type Tab = 'overview' | 'ledger' | 'statements' | 'loans' | 'insurance';
const EXPENSE_KINDS: LedgerKind[] = [...OPEX_KINDS, 'interest', 'tax', 'depreciation'];
const pct1 = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—');
const rows = (s: GameState, days: number, kinds: LedgerKind[], sign = 1): [string, string][] =>
  kinds.map((k) => [LEDGER_KINDS[k], sumBooks(s, days, [k]) * sign] as const).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => [k, money(v)]);
const bookSum = (b: DayBook, kinds: LedgerKind[]) => kinds.reduce((a, k) => a + (b.kinds[k] ?? 0), 0);

export default function FinancePage() {
  const s = useGame();
  const [tab, setTab] = usePref<Tab>('finance.tab', 'overview');
  const tabs: { v: Tab; label: string; hidden?: boolean }[] = [
    { v: 'overview', label: 'Overview' },
    { v: 'ledger', label: 'Ledger' },
    { v: 'statements', label: 'Statements', hidden: s.era < 5 },
    { v: 'loans', label: 'Loans', hidden: s.era < 3 },
    { v: 'insurance', label: 'Insurance', hidden: s.era < 5 },
  ];
  const t = tabs.find((x) => x.v === tab && !x.hidden) ? tab : 'overview';
  return (
    <div className="stack l">
      <PageHead title="Finance" sub="Where the money comes from, where it goes, and what the business is worth." />
      <Tabs value={t} tabs={tabs} onChange={setTab} />
      {s.cash < 0 && <OverdraftWarning s={s} />}
      {t === 'overview' && <Overview s={s} />}
      {t === 'ledger' && <Ledger s={s} />}
      {t === 'statements' && <Statements s={s} />}
      {t === 'loans' && <Loans s={s} />}
      {t === 'insurance' && <Insurance s={s} />}
      {s.era < 5 && <p className="faint small">{s.era < 3 ? 'Bank loans unlock in Era 3. ' : ''}Financial statements and crop insurance unlock in Era 5.</p>}
    </div>
  );
}

function OverdraftWarning({ s }: { s: GameState }) {
  const lim = overdraftLimit(s);
  const over = s.cash < -lim;
  return (
    <div className={`callout ${over ? 'bad' : 'warn'}`}>
      You are overdrawn by <b>{money(-s.cash)}</b> (limit {money(lim)}), paying {pct1(s.macro.baseRate + 0.12)} a year on it.
      {over ? <> Over the limit for <b>{s.overdraftDays}/3 days</b> — on the third day the business is insolvent. Sell stock or assets now.</> : ' Stay inside the limit: three days over it means insolvency.'}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function Overview({ s }: { s: GameState }) {
  const [days, setDays] = usePref<1 | 7 | 30>('finance.kpiDays', 7);
  const [range, setRange] = usePref<30 | 120 | 360>('finance.range', 30);
  const is = incomeStatement(s, days);
  const fa = fixedAssets(s);
  const loans = s.loans.reduce((a, l) => a + l.balance, 0);
  const window = days === 1 ? 'today' : `last ${days} days`;

  const books = s.books.slice(-range);
  const series = useMemo(() => {
    const rev = books.map((b) => bookSum(b, REVENUE_KINDS));
    const exp = books.map((b) => -bookSum(b, EXPENSE_KINDS));
    const profit = books.map((b) => bookSum(b, [...REVENUE_KINDS, ...EXPENSE_KINDS, 'futures', 'insurancePayout']));
    return { rev, exp, profit, cash: books.map((b) => b.cash), debt: books.map((b) => b.debt), eq: books.map((b) => b.equity) };
  }, [books.length, s.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const startDay = books[0]?.day ?? day(s);
  const xFormat = (i: number) => `Day ${startDay + i + 1}`;

  const spend = EXPENSE_KINDS.map((k) => ({ label: LEDGER_KINDS[k], value: -sumBooks(s, days, [k]) })).filter((r) => r.value > 0.5).sort((a, b) => b.value - a.value);
  const totalSpend = spend.reduce((a, r) => a + r.value, 0);

  return (
    <div className="stack l">
      <Card title="Key figures" actions={<Seg label="Period" value={days} onChange={setDays} options={[{ v: 1, label: 'Today' }, { v: 7, label: '7 days' }, { v: 30, label: '30 days' }]} />}>
        <div className="kpis">
          <Kpi label="Revenue" value={money(is.revenue)} sub={window} info="Money earned from selling what you produce: market sales, contract deliveries and power sold to the grid." breakdown={rows(s, days, REVENUE_KINDS)} />
          <Kpi label="Operating costs" value={money(-is.opex)} sub={window} tone="down" info="Day-to-day costs of running the business, largest first. Excludes buying assets (land, machines, buildings), interest and tax." breakdown={rows(s, days, OPEX_KINDS, -1)} />
          <Kpi label="Net income" value={money(is.net)} sub={window} tone={is.net >= 0 ? 'up' : 'down'} info="Profit after every cost, including depreciation (machines and buildings wearing out), interest and tax. Buying an asset is not a cost here — only its wear is."
            breakdown={[['Revenue', money(is.revenue)], ['Operating costs', money(is.opex)], ['Depreciation', money(is.depreciation)], ['Interest', money(is.interest)], ['Futures & insurance', money(is.other)], ['Tax', money(is.tax)], ['Net income', money(is.net)]]} />
          <Kpi label="Cash" value={money(s.cash)} tone={s.cash < 0 ? 'down' : undefined} info={`Money in the bank right now. You can go up to ${money(overdraftLimit(s))} overdrawn (8% of assets, at least $500), at base rate + 12%; three days over that limit is insolvency.`}
            breakdown={[['Cash', money(s.cash)], ['Futures margin held', money(s.marginAccount)], ['Overdraft limit', money(overdraftLimit(s))]]} />
          <Kpi label="Debt" value={money(debt(s))} info="Loan balances plus any overdraft." breakdown={[['Loans', money(loans)], ['Overdraft', money(Math.max(0, -s.cash))]]} />
          <Kpi label="Net worth" value={money(equity(s))} tone={equity(s) < 0 ? 'down' : undefined} info="Everything you own minus everything you owe. Inventory is valued at today's market prices; machines and buildings at cost less depreciation."
            breakdown={[['Cash & margin', money(Math.max(0, s.cash) + s.marginAccount)], ['Inventory', money(inventoryValue(s))], ['Land', money(fa.land)], ['Machinery', money(fa.machines)], ['Buildings', money(fa.buildings)], ['− Debt', money(-debt(s))], ['Net worth', money(totalAssets(s) - debt(s))]]} />
        </div>
      </Card>

      <div className="row end"><Seg label="Chart range" value={range} onChange={setRange} options={[{ v: 30, label: '30 days' }, { v: 120, label: '1 year' }, { v: 360, label: '3 years' }]} /></div>
      <div className="grid2">
        <Card title="Profit and loss per day" info="Revenue earned and costs incurred each day. Profit includes depreciation, interest, tax and futures results. Lumpy days are normal: harvests sell in batches and tax is assessed once a year.">
          <LineChart series={[
            { name: 'Revenue', color: 'var(--up)', data: series.rev },
            { name: 'Expenses', color: 'var(--down)', data: series.exp },
            { name: 'Profit', color: 'var(--gold)', data: series.profit, dashed: true },
          ]} format={(n) => money(n)} xFormat={xFormat} />
        </Card>
        <Card title="Cash, debt and net worth" info="Cash is what you can spend; net worth is what the business is worth after paying all debts. Cash can fall while net worth rises — when you buy land or machines, cash turns into assets.">
          <LineChart series={[
            { name: 'Cash', color: 'var(--accent)', data: series.cash },
            { name: 'Debt', color: 'var(--down)', data: series.debt },
            { name: 'Net worth', color: 'var(--gold)', data: series.eq },
          ]} format={(n) => money(n)} xFormat={xFormat} />
        </Card>
      </div>

      <div className="grid2">
        <Card title={<>Where the money goes <span className="muted">{window}</span></>} info="Every cost recorded in the period, largest first. Asset purchases are investments, not costs, so they are not listed here — see Investing in the cash-flow statement.">
          {spend.length ? (
            <div className="stack s">
              <Bars rows={spend.map((r) => ({ ...r, sub: pct0(r.value / totalSpend), color: 'var(--warn)' }))} format={(n) => money(n)} />
              <p className="faint small">Total {money(totalSpend)}</p>
            </div>
          ) : <p className="muted small">No costs recorded {window}.</p>}
        </Card>
        <TaxCard s={s} />
      </div>
    </div>
  );
}

function TaxCard({ s }: { s: GameState }) {
  const d = day(s);
  const yearStart = d - (d % DAYS_PER_YEAR);
  const left = DAYS_PER_YEAR - (d % DAYS_PER_YEAR);
  const relief = s.era < 3 ? 0.5 : 1;
  const regs = unlockedRegions(s).map((r) => {
    const ytd = s.books.filter((b) => b.day >= yearStart).reduce((a, b) => a + (b.op[r] ?? 0), 0);
    return { r, ytd, est: Math.max(0, ytd) * REGIONS[r].tax * relief };
  });
  return (
    <Card title="Profit tax" info={`Tax is assessed once a year (every ${DAYS_PER_YEAR} days) on each region's operating profit after depreciation and interest. Losses in a region pay no tax. Buying assets and repaying loans are not deductible; their wear (depreciation) and interest are.`}>
      <div className="stack">
        <table className="t">
          <thead><tr><th>Region</th><th className="r">Rate</th><th className="r">Profit this year</th><th className="r">Est. tax</th></tr></thead>
          <tbody>
            {regs.map(({ r, ytd, est }) => (
              <tr key={r}><td>{REGIONS[r].name}</td><td className="r mono">{pct0(REGIONS[r].tax * relief)}</td><td className={`r mono ${ytd < 0 ? 'down' : ''}`}>{money(ytd)}</td><td className="r mono">{money(est)}</td></tr>
            ))}
          </tbody>
        </table>
        <dl className="facts">
          <dt>Next assessment</dt><dd>in {left} day{left === 1 ? '' : 's'}</dd>
          <dt>Tax paid, lifetime</dt><dd>{money(-(s.lifetime.tax ?? 0))}</dd>
        </dl>
        {relief < 1 && <p className="faint small">Small-farm relief: you pay half the regional rate until Era 3.</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- ledger

function Ledger({ s }: { s: GameState }) {
  const entries = [...s.ledger].reverse();
  const cols: Col<LedgerEntry>[] = [
    { key: 'when', label: 'When', render: (e) => <span className="mono small">{stamp(e.tick)}</span>, sort: (e) => e.tick },
    { key: 'kind', label: 'Type', render: (e) => LEDGER_KINDS[e.kind], sort: (e) => LEDGER_KINDS[e.kind] },
    { key: 'region', label: 'Region', render: (e) => <span className="muted">{REGIONS[e.region].name}</span>, sort: (e) => e.region },
    { key: 'memo', label: 'Detail', render: (e) => e.memo },
    { key: 'amt', label: 'Amount', align: 'r', render: (e) => <span className={`mono ${e.amount >= 0 ? 'up' : 'down'}`}>{e.amount >= 0 ? '+' : ''}{money(e.amount)}</span>, sort: (e) => e.amount },
  ];
  return (
    <Card title="Ledger" info="Every movement of money, newest first. Repeated small charges on the same day (wages, fuel, power) are merged into one line. Depreciation is recorded here but is not cash — it is the wear on machines and buildings.">
      <Table rows={entries} cols={cols} rowKey={(e) => `${e.tick}-${e.kind}-${e.region}-${e.memo}`} search={(e) => `${LEDGER_KINDS[e.kind]} ${e.memo} ${REGIONS[e.region].name}`}
        initialSort={{ key: 'when', dir: -1 }} empty="Transactions appear here as you buy and sell." />
      <p className="faint small" style={{ marginTop: 8 }}>The ledger keeps the most recent {s.ledger.length} lines; daily totals for the last 360 days live in the charts and statements.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- statements

const Line = ({ label, value, strong, info, indent, sub }: { label: ReactNode; value: number; strong?: boolean; info?: ReactNode; indent?: boolean; sub?: string }) => (
  <div className="row between" style={{ padding: '3px 0', paddingLeft: indent ? 14 : 0, borderTop: strong ? '1px solid var(--line)' : undefined, fontWeight: strong ? 600 : undefined, fontSize: 13 }}>
    <span className={indent ? 'muted' : ''}>{label}{info && <> <Info text={info} /></>}</span>
    <span className={`mono ${value < 0 ? 'down' : ''}`}>{money(value)}{sub && <span className="faint small"> {sub}</span>}</span>
  </div>
);

function Statements({ s }: { s: GameState }) {
  const [days, setDays] = usePref<30 | 120>('finance.stmtDays', 30);
  const is = incomeStatement(s, days);
  const bs = balanceSheet(s);
  const cf = cashFlow(s, days);
  const ra = ratios(s);
  const period = days === 30 ? 'last 30 days' : 'last year (120 days)';
  return (
    <div className="stack l">
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0 }}>These are built from the same ledger as everything else. Inventory is valued at <b>market value</b> (today's price), so a price swing moves your net worth even before you sell.</p>
        <Seg label="Statement period" value={days} onChange={setDays} options={[{ v: 30, label: '30 days' }, { v: 120, label: '1 year' }]} />
      </div>
      <div className="grid2">
        <Card title={<>Income statement <span className="muted">{period}</span></>} info="Shows whether the business made a profit: what came in from customers, minus what it cost to earn it.">
          <div className="stack s" style={{ gap: 0 }}>
            {is.revenueLines.map((l) => <Line key={l.kind} label={l.label} value={l.value} indent />)}
            <Line label="Revenue" value={is.revenue} strong />
            {is.opexLines.map((l) => <Line key={l.kind} label={l.label} value={l.value} indent />)}
            <Line label="Operating costs" value={is.opex} strong />
            <Line label="EBITDA" value={is.ebitda} strong info="Earnings before interest, tax, depreciation and amortisation: the cash the operations themselves generate, before how they are financed or taxed." sub={is.revenue ? pct0(is.ebitda / is.revenue) : undefined} />
            <Line label="Depreciation" value={is.depreciation} indent info="Machines and buildings lose value as they age. Spreading their cost over their life shows the true cost of using them." />
            <Line label="EBIT (operating profit)" value={is.ebit} strong />
            <Line label="Interest" value={is.interest} indent />
            <Line label="Futures & insurance payouts" value={is.other} indent />
            <Line label="Pre-tax profit" value={is.pretax} strong />
            <Line label="Tax" value={is.tax} indent />
            <Line label="Net income" value={is.net} strong />
            <div className="row between small" style={{ paddingTop: 6 }}><span className="muted">Operating margin</span><span className="mono">{pct1(is.operatingMargin)}</span></div>
          </div>
        </Card>
        <div className="stack l">
          <Card title="Balance sheet" info="A snapshot of what the business owns (assets), what it owes (liabilities), and what is left for you (equity). Assets always equal liabilities plus equity.">
            <div className="stack s" style={{ gap: 0 }}>
              <Line label="Cash" value={bs.cash} indent />
              <Line label="Futures margin" value={bs.margin} indent />
              <Line label="Inventory (market value)" value={bs.inventory} indent />
              <Line label="Land" value={bs.land} indent info="At what you paid, including irrigation installed." />
              <Line label="Machinery" value={bs.machines} indent info="Cost less depreciation." />
              <Line label="Buildings" value={bs.buildings} indent info="Cost less depreciation." />
              <Line label="Total assets" value={bs.assets} strong />
              <Line label="Loans" value={-bs.loans} indent />
              <Line label="Overdraft" value={-bs.overdraft} indent />
              <Line label="Total liabilities" value={-bs.liabilities} strong />
              <Line label="Paid-in capital" value={bs.paidIn} indent info="Money put into the business by owners: your starting $250 plus shares issued, less buybacks." />
              <Line label="Retained earnings" value={bs.retained} indent info="Profits kept in the business over its life (and value changes on inventory). This is what you have built." />
              <Line label="Equity" value={bs.equity} strong />
            </div>
          </Card>
          <Card title={<>Cash flow <span className="muted">{period}</span></>} info="Profit and cash are different. This shows where cash actually came from and went.">
            <div className="stack s" style={{ gap: 0 }}>
              <Line label="Operating" value={cf.operating} info="Cash from running the business: sales minus costs, interest and tax." />
              <Line label="Investing" value={cf.investing} info="Cash spent on land, machines, buildings and acquisitions (and futures margin), minus asset sales." />
              <Line label="Financing" value={cf.financing} info="Loans drawn minus repaid, shares issued, dividends and buybacks." />
              <Line label="Net change in cash" value={cf.total} strong />
            </div>
          </Card>
        </div>
      </div>
      <Card title="Ratios" info="Ratios turn the statements into a few numbers you can compare over time. All use the last 30 days.">
        <div className="kpis">
          <Kpi label="Operating margin" value={pct1(ra.operatingMargin)} tone={ra.operatingMargin < 0 ? 'down' : undefined}
            info="Operating profit (EBIT) per dollar of revenue. Driven here by crop prices versus wages, fuel, seed and fertiliser, and by depreciation on machines. Higher yields and selling when prices are high raise it." />
          <Kpi label="Return on capital" value={pct1(ra.roic)} sub="annualised, after 20% tax" tone={ra.roic < 0 ? 'down' : undefined}
            info="How much after-tax operating profit each dollar invested in land, machines, buildings and stock earns per year. If it is below your loan rate, borrowing to expand destroys value." breakdown={[['Your current loan rate', pct1(loanRate(s, creditSpread(s)))]]} />
          <Kpi label="Debt / equity" value={Number.isFinite(ra.debtToEquity) ? ra.debtToEquity.toFixed(2) : '∞'} tone={ra.debtToEquity > 1.5 ? 'down' : undefined}
            info="Liabilities per dollar of equity. Leverage multiplies both gains and losses; banks charge higher rates as it rises. Above about 1.5 a bad season can become a crisis." />
          <Kpi label="Interest coverage" value={Number.isFinite(ra.interestCoverage) ? `${ra.interestCoverage.toFixed(1)}×` : 'No interest'} tone={ra.interestCoverage < 2 ? 'down' : undefined}
            info="Operating profit divided by interest paid. Below 2× means a modest fall in profit could leave you unable to pay the bank." />
          <Kpi label="Working capital" value={money(ra.workingCapital)} tone={ra.workingCapital < 0 ? 'down' : undefined}
            info="Cash, stock and margin minus overdraft: the cushion that pays wages and inputs between harvests." />
          <Kpi label="Inventory turnover" value={`${ra.inventoryTurnover.toFixed(1)}×`} sub="per year"
            info="How many times a year purchased inputs (seed, fertiliser, market purchases) pass through your stock. Low turnover means money sits in the barn — and spoils." />
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- loans

const TERMS = [30, 120, 360] as const;
const termRate = (s: GameState, term: number) => loanRate(s, creditSpread(s) + (term > 120 ? 0.01 : 0));

function Loans({ s }: { s: GameState }) {
  const limit = creditLimit(s);
  const [amount, setAmount] = useState(1000);
  const [term, setTerm] = useState<(typeof TERMS)[number]>(120);
  const rate = termRate(s, term);
  const amt = Math.min(amount, Math.floor(limit));
  const interest1 = (amt * rate) / DAYS_PER_YEAR;
  const totalInterest = interest1 * (term + 1) / 2; // straight-line principal: interest falls as the balance does
  const ta = Math.max(1, totalAssets(s));
  const spread = creditSpread(s);
  return (
    <div className="stack l">
      <div className="grid2">
        <Card title="Borrow" info="Banks lend against your collateral — land, machinery, buildings and stock — plus some of your recent profit. Loans repay a little principal every day plus interest.">
          <div className="stack">
            <div className="kpis">
              <Kpi label="Credit available" value={money(limit)} info="What the bank will still lend: 60% of land, 50% of machinery, 40% of buildings and 30% of inventory, plus twice your last 30 days' profit, minus loans outstanding. A credit crunch cuts it."
                breakdown={[['Land × 60%', money(0.6 * fixedAssets(s).land)], ['Machinery × 50%', money(0.5 * fixedAssets(s).machines)], ['Buildings × 40%', money(0.4 * fixedAssets(s).buildings)], ['Inventory × 30%', money(0.3 * inventoryValue(s))], ['Profit × 2', money(Math.max(0, sumBooks(s, 30)) * 2)], ['− Loans owed', money(-s.loans.reduce((a, l) => a + l.balance, 0))]]} />
              <Kpi label="Base rate" value={pct1(s.macro.baseRate)} info="The central bank's rate. It follows inflation (and jumps in a credit crunch). Every loan pays base rate plus a spread, so when base rate moves, your interest moves too." breakdown={[['Inflation', pct1(s.macro.inflation)]]} />
              <Kpi label="Your spread" value={pct1(spread)} info="What the bank adds for your risk: more debt relative to assets and a weaker reputation cost more."
                breakdown={[['Base margin', '3.0%'], ['Leverage', pct1(0.08 * Math.min(1, debt(s) / ta))], ['Reputation', pct1((50 - s.corp.reputation) * 0.0004)], ['Credit crunch', pct1(s.macro.crunch * 0.6)]]} />
            </div>
            <table className="t">
              <thead><tr><th>Term</th><th className="r">Rate today</th><th className="r">Daily payment on {money(amt)}</th></tr></thead>
              <tbody>{TERMS.map((t) => { const r = termRate(s, t); return <tr key={t} className={t === term ? 'sel' : ''}><td>{t} days{t > 120 ? ' (+1% long-term)' : ''}</td><td className="r mono">{pct1(r)}</td><td className="r mono">{money(amt / t + (amt * r) / DAYS_PER_YEAR)}</td></tr>; })}</tbody>
            </table>
            <div className="row wrap">
              <NumberInput label="Loan amount" value={amount} onChange={setAmount} min={0} max={Math.max(0, Math.floor(limit))} step={1000} width={130} />
              <Seg label="Loan term" value={term} onChange={setTerm} options={TERMS.map((t) => ({ v: t, label: `${t} days` }))} />
            </div>
            <dl className="facts">
              <dt>First day's payment</dt><dd>{money(amt / term + interest1)}</dd>
              <dt>· principal</dt><dd>{money(amt / term)}</dd>
              <dt>· interest</dt><dd>{money(interest1)}</dd>
              <dt>Total interest at today's rate</dt><dd>{money(totalInterest)}</dd>
            </dl>
            <Confirm label={`Borrow ${money(amt)} over ${term} days`} className="btn primary" disabled={amt <= 0} title="Take this loan?" confirmLabel="Take loan"
              body={<>You receive <b>{money(amt)}</b> now and repay about <b>{money(amt / term + interest1)}</b> a day for {term} days. The rate is variable: it is base rate plus your spread, so it rises if inflation or your debt rises. Five missed payments and the bank calls in all loans.</>}
              onConfirm={() => act({ type: 'takeLoan', amount: amt, termDays: term }, `Borrowed ${money(amt)}.`)} />
          </div>
        </Card>
        <Card title="Overdraft" info="Your bank lets your cash go negative up to a limit. It is expensive and meant for short gaps, not funding growth.">
          <div className="stack">
            <dl className="facts">
              <dt>Overdraft limit</dt><dd>{money(overdraftLimit(s))}</dd>
              <dt>Rate (base + 12%)</dt><dd>{pct1(s.macro.baseRate + 0.12)}</dd>
              <dt>Cash now</dt><dd className={s.cash < 0 ? 'down' : ''}>{money(s.cash)}</dd>
              <dt>Days over limit</dt><dd className={s.overdraftDays ? 'down' : ''}>{s.overdraftDays} / 3</dd>
            </dl>
            <Bar value={s.cash < 0 ? -s.cash / overdraftLimit(s) : 0} color="var(--down)" label="Overdraft used" />
            <p className="explain">The limit is 8% of your total assets (at least $500). If your cash stays below minus the limit at the end of three consecutive days, the business is insolvent. Loan payments are only made while cash plus the overdraft can cover them — otherwise they are missed.</p>
          </div>
        </Card>
      </div>
      <Card title="Your loans" info="Rates are variable: each day's interest uses today's base rate plus the spread fixed when you borrowed. Missed payments add 1.5× the interest to the balance and cost reputation.">
        {s.loans.length ? <div className="stack">{s.loans.map((l) => <LoanRow key={l.id} s={s} l={l} />)}</div> : <p className="muted small">No loans. Borrowing makes sense when what you buy earns more than the interest — check Return on capital against the rate.</p>}
      </Card>
    </div>
  );
}

function LoanRow({ s, l }: { s: GameState; l: Loan }) {
  const [amt, setAmt] = useState(Math.round(l.balance));
  const rate = loanRate(s, l.spread);
  const pay = Math.min(amt, l.balance, Math.max(0, s.cash));
  return (
    <div className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row between wrap">
        <span><b>{money(l.balance)}</b> <span className="muted small">of {money(l.principal)} · {l.termDays}-day loan · {pct1(rate)}</span></span>
        <span className="row small">
          <span className="muted">{l.daysLeft} days left</span>
          {l.missed > 0 && <span className="pill bad">{l.missed}/5 missed</span>}
          <span className="mono">{money(l.balance / Math.max(1, l.daysLeft) + (l.balance * rate) / DAYS_PER_YEAR)}/day</span>
        </span>
      </div>
      <Bar value={1 - l.balance / Math.max(1, l.principal)} thin label="Repaid" />
      <div className="row end wrap">
        <NumberInput label="Early repayment amount" value={amt} onChange={setAmt} max={Math.ceil(l.balance)} step={500} width={110} />
        <button className="btn ghost sm" disabled={pay <= 0} onClick={() => act({ type: 'repayLoan', loanId: l.id, amount: pay }, `Repaid ${money(pay)}.`)}>Repay {money(pay)}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- insurance

function Insurance({ s }: { s: GameState }) {
  const regs = unlockedRegions(s);
  const premiums = -(s.lifetime.insurance ?? 0), payouts = s.lifetime.insurancePayout ?? 0;
  const ha = (r: RegionId) => s.fields.reduce((a, f) => a + (f.region === r ? f.ha : 0), 0);
  return (
    <div className="stack l">
      <Card title="Crop insurance" info="Insurance pays out when growing conditions — drought, bad weather or pests — cut a harvest below 75% of its potential. It does not cover poor management such as tired soil or late harvesting.">
        <div className="stack">
          <table className="t">
            <thead><tr><th>Region</th><th className="r">Farmland</th><th className="r">Premium / day</th><th className="r">Per year</th><th></th></tr></thead>
            <tbody>
              {regs.map((r) => {
                const p = insurancePremium(s, r);
                const on = s.regions[r].insured;
                return (
                  <tr key={r}>
                    <td>{REGIONS[r].name} {on && <span className="pill good">Insured</span>}</td>
                    <td className="r mono">{num(ha(r))} ha</td>
                    <td className="r mono">{money(p)}</td>
                    <td className="r mono">{money(p * DAYS_PER_YEAR)}</td>
                    <td className="r"><button className={`btn sm ${on ? 'ghost' : 'primary'}`} disabled={!on && ha(r) === 0} onClick={() => act({ type: 'setInsurance', region: r, on: !on })}>{on ? 'Cancel cover' : 'Insure'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="explain">Premiums are about $0.90 per hectare per day, scaled up for dry regions, unstable regions and the warming climate. When a harvest's water × weather × pest factors fall below 0.75, insurance pays 80% of the shortfall below 75% at today's market price.</p>
          <dl className="facts">
            <dt>Premiums paid, lifetime</dt><dd>{money(premiums)}</dd>
            <dt>Payouts received, lifetime</dt><dd>{money(payouts)}</dd>
            <dt>Net</dt><dd className={payouts - premiums >= 0 ? 'up' : 'down'}>{money(payouts - premiums)}</dd>
          </dl>
          <p className="faint small">Insurers price in a profit, so on average you pay more than you get back. You buy cover to survive a bad year — especially with loans to repay — not to make money.</p>
        </div>
      </Card>
    </div>
  );
}
