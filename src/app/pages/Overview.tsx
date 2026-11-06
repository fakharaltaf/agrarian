import { useMemo } from 'react';
import { BUILDINGS, CROP_IDS, ERAS, GOODS, REGIONS, REVENUE_KINDS, type CropId, type LedgerKind } from '../../simulation/config';
import { debt, equity, inventoryValue, stored, sumBooks } from '../../simulation/core';
import { companyValue, globalShare } from '../../simulation/corporate';
import { lifetimeSales, objective, totalHa } from '../../simulation/engine';
import { ratios, incomeStatement } from '../../simulation/statements';
import type { DayBook, GameState } from '../../simulation/types';
import { go, useGame } from '../../stores/game';
import { AdvisorCard } from '../Advisor';
import { LineChart } from '../Chart';
import { duration, money, num, pct0, stamp } from '../format';
import { Bar, Card, Kpi, PageHead, usePref } from '../ui';
import { unlockedRegions } from './shared';
import { STAGES } from '../../simulation/stages';

// Kinds that move cash but are not profit or loss (same exclusions as corporate.netIncome).
const NON_PL: LedgerKind[] = ['loanIn', 'loanRepay', 'sharesIssued', 'dividends', 'buyback', 'land', 'machine', 'building', 'acquisition', 'irrigation', 'margin', 'assetSale'];
const sumKinds = (b: DayBook, kinds: LedgerKind[]) => kinds.reduce((a, k) => a + (b.kinds[k] ?? 0), 0);
const dayRevenue = (b: DayBook) => sumKinds(b, REVENUE_KINDS);
const dayProfit = (b: DayBook) => Object.entries(b.kinds).reduce((a, [k, v]) => a + (NON_PL.includes(k as LedgerKind) ? 0 : v ?? 0), 0);

const WIDGETS = [
  { id: 'kpis', label: 'Key numbers' },
  { id: 'era', label: 'Era progress' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'events', label: 'World events' },
  { id: 'pl', label: 'Revenue & profit chart' },
  { id: 'worth', label: 'Cash & net worth chart' },
] as const;
type WidgetId = (typeof WIDGETS)[number]['id'];

export default function OverviewPage() {
  const s = useGame();
  const [hidden, setHidden] = usePref<WidgetId[]>('overview.widgets', []);
  const [editing, setEditing] = usePref<boolean>('overview.customise', false);
  const custom = s.era >= 5;
  const show = (id: WidgetId) => !custom || !hidden.includes(id);
  const toggle = (id: WidgetId) => setHidden(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);

  return (
    <div className="stack l">
      <PageHead title="Overview" sub={s.legacyProgression ? `Era ${s.era} · ${ERAS[s.era - 1].name}. ${ERAS[s.era - 1].theme}` : `Chapter · ${STAGES[s.stageId].title}`}
        actions={custom && <button className={`btn ${editing ? 'primary' : 'ghost'} sm`} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Customise'}</button>} />
      {custom && editing && (
        <Card title="Dashboard widgets" info="Choose what this page shows. Your choice is remembered in this browser.">
          <div className="row wrap">
            {WIDGETS.map((w) => (
              <label key={w.id} className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={!hidden.includes(w.id)} onChange={() => toggle(w.id)} /> {w.label}
              </label>
            ))}
          </div>
        </Card>
      )}
      {show('kpis') && <Kpis s={s} />}
      <AdvisorCard s={s} />
      <ValuesCard s={s} />
      <div className="grid2">
        {show('era') && <EraCard s={s} />}
        {show('alerts') && <Alerts s={s} />}
        {show('events') && <Events s={s} />}
      </div>
      {(show('pl') || show('worth')) && <Charts s={s} pl={show('pl')} worth={show('worth')} />}
    </div>
  );
}

function ValuesCard({ s }: { s: GameState }) {
  if (s.legacyProgression || s.stageId === 'homestead') return null;
  const axes = [
    ['🌾', 'Prosperity', 'Fairness', s.values.prosperityFairness],
    ['⚖️', 'Order', 'Freedom', s.values.orderFreedom],
    ['🕊️', 'Peace', 'Strength', s.values.peaceStrength],
    ['🛠️', 'Tradition', 'Progress', s.values.traditionProgress],
  ] as const;
  const charter = s.charters.trader === 'fair' ? '🤝 Fair trader' : s.charters.trader === 'shrewd' ? '🪙 Shrewd trader' : 'Trader charter pending';
  return <Card title="Character of your town" info="Choices nudge these values. The first trader charter moves Prosperity ↔ Fairness; later decisions will shape the other axes.">
    <div className="town-values">
      <div className="town-charter">{charter}</div>
      {axes.map(([icon, left, right, value]) => <div className="town-axis" key={left}>
        <div className="town-axis-labels"><span>{icon} {left}</span><span>{right}</span></div>
        <div className="town-axis-track" aria-label={`${left} to ${right}: ${Math.round(value)}% ${right}`}><i style={{ left: `${Math.max(0, Math.min(100, value))}%` }} /></div>
      </div>)}
    </div>
  </Card>;
}

// ---------------------------------------------------------------- KPIs by era

function Kpis({ s }: { s: GameState }) {
  const last = s.books.length > 1 ? s.books[s.books.length - 2] : null;
  if (s.era <= 3) {
    const inv = inventoryValue(s);
    return (
      <div className="kpis">
        <Kpi label="Cash" value={money(s.cash)} tone={s.cash < 0 ? 'down' : undefined} info="Money in the bank. Negative means you are using your overdraft." />
        <Kpi label="Stock value" value={money(inv)} info="Everything in storage and your seed stock, valued at today's market prices." />
        <Kpi label="Fields" value={num(s.fields.length)} sub={`${num(totalHa(s), 1)} ha`} info="Fields you own and their total area." />
        <Kpi label="Revenue yesterday" value={money(last ? dayRevenue(last) : 0)} sub={`${money(dayRevenue(s.books[s.books.length - 1] ?? { kinds: {} } as DayBook))} so far today`}
          info="Sales, contract deliveries and power sold to the grid in the last full in-game day." />
      </div>
    );
  }
  if (s.era <= 6) {
    const op = incomeStatement(s, 7);
    let used = 0, cap = 0;
    for (const r of unlockedRegions(s)) {
      const st = stored(s, r);
      used += st.dry + st.cold;
      cap += st.cap.dry + st.cap.cold;
    }
    const produced = Object.entries(s.stats.produced).sort((a, b) => b[1]! - a[1]!);
    const hands = s.workers.filter((w) => w.role === 'hand').length;
    const avgCond = s.machines.length ? s.machines.reduce((a, m) => a + m.condition, 0) / s.machines.length : 0;
    const broken = s.machines.filter((m) => m.broken).length;
    return (
      <div className="kpis">
        <Kpi label="Operating profit 7d" value={money(op.ebit)} tone={op.ebit < 0 ? 'down' : 'up'} info="Revenue minus operating costs and depreciation over the last 7 days, before interest and tax."
          breakdown={[['Revenue', money(op.revenue)], ['Operating costs', money(op.opex)], ['Depreciation', money(op.depreciation)]]} />
        <Kpi label="Production" value={`${num(produced.reduce((a, [, q]) => a + q!, 0))} u`} sub="lifetime crop output" info="Units harvested since you started, by crop."
          breakdown={produced.slice(0, 6).map(([g, q]) => [GOODS[g as CropId].name, num(q!)])} />
        <Kpi label="Storage used" value={pct0(cap ? used / cap : 0)} tone={cap && used / cap > 0.85 ? 'warn' : undefined} sub={`${num(used)} / ${num(cap)}`} info="Units held against total dry and cold capacity in every region you operate in. Above ~85% new harvests risk forced sales." />
        <Kpi label="Workforce" value={num(s.workers.length)} sub={`${hands} hands · ${s.workers.length - hands} managers`} info="Everyone on your payroll." />
        <Kpi label="Machine condition" value={s.machines.length ? pct0(avgCond) : '—'} tone={avgCond < 0.5 && s.machines.length ? 'warn' : undefined} sub={s.machines.length ? `${s.machines.length} machines${broken ? ` · ${broken} broken` : ''}` : 'no machines'} info="Average condition. Worn machines break down far more often; service them on the Equipment page." />
        <Kpi label="Debt" value={money(debt(s))} tone={debt(s) > 0 ? 'warn' : undefined} info="Loan balances plus any overdraft." breakdown={[['Loans', money(s.loans.reduce((a, l) => a + l.balance, 0))], ['Overdraft', money(Math.max(0, -s.cash))]]} />
      </div>
    );
  }
  const net30 = incomeStatement(s, 30).net;
  const r = ratios(s);
  const top = CROP_IDS.map((c) => [c, globalShare(s, c)] as const).sort((a, b) => b[1] - a[1])[0];
  const ha = totalHa(s);
  const byRegion = unlockedRegions(s).map((x) => [x, s.fields.reduce((a, f) => a + (f.region === x ? f.ha : 0), 0)] as const).sort((a, b) => b[1] - a[1]);
  const facilities = s.buildings.filter((b) => b.active && BUILDINGS[b.type].recipe);
  const eff = facilities.length ? facilities.reduce((a, b) => a + b.util, 0) / facilities.length : 0;
  return (
    <div className="kpis">
      <Kpi label="Company value" value={money(companyValue(s))} big info="Book equity plus six years of trailing net profit (never below book equity). This drives your share price."
        breakdown={[['Book equity', money(equity(s))], ['Net profit, last year', money(sumBooks(s, 120) - sumBooks(s, 120, NON_PL))]]} />
      <Kpi label="Net profit 30d" value={money(net30)} tone={net30 < 0 ? 'down' : 'up'} info="Profit after every cost, interest and tax over the last 30 days." />
      <Kpi label="ROIC" value={pct0(r.roic)} tone={r.roic < 0 ? 'down' : undefined} info="Annualised after-tax operating profit divided by the capital tied up in the business (equity plus debt minus cash)." />
      <Kpi label="Top world share" value={pct0(top[1])} sub={GOODS[top[0]].name} info="Your share of global consumption of your strongest crop over the last ~30 days. 25% is a milestone."
        breakdown={CROP_IDS.map((c) => [GOODS[c].name, pct0(globalShare(s, c))] as [string, string]).filter(([, v]) => v !== '0%')} />
      <Kpi label="Regional exposure" value={ha ? pct0(byRegion[0][1] / ha) : '—'} sub={ha ? `of land in ${REGIONS[byRegion[0][0]].name}` : ''} info="How concentrated your land is. A single drought or strike hits a concentrated business harder."
        breakdown={byRegion.map(([x, h]) => [REGIONS[x].name, `${num(h)} ha · ${pct0(ha ? h / ha : 0)}`])} />
      <Kpi label="Supply-chain efficiency" value={facilities.length ? pct0(eff) : '—'} tone={facilities.length && eff < 0.5 ? 'warn' : undefined} sub={`${facilities.length} active facilities`} info="Average capacity utilisation of your processing and energy facilities. Idle capacity still pays staff." />
    </div>
  );
}

// ---------------------------------------------------------------- era progress

function eraProgress(s: GameState): { value: number; parts: [string, string][] } | null {
  const sales = lifetimeSales(s);
  const f = (a: number, b: number) => Math.min(1, a / b);
  const factories = s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').length;
  switch (s.era) {
    case 1: return { value: Math.max(f(s.fields.length, 4), f(sales, 2500)), parts: [['Fields', `${s.fields.length} / 4`], ['or sales', `${money(sales)} / $2,500`]] };
    case 2: return { value: Math.min(f(sales, 40000), f(s.workers.length, 2)), parts: [['Sales', `${money(sales)} / $40,000`], ['Workers', `${s.workers.length} / 2`]] };
    case 3: return { value: Math.min(f(s.machines.length, 1), f(sales, 350000)), parts: [['Machines', `${s.machines.length} / 1`], ['Sales', `${money(sales)} / $350,000`]] };
    case 4: return { value: Math.max(f(sales, 2e6), Math.min(f(factories, 2), f(sales, 1e6))), parts: [['Sales', `${money(sales)} / $2.00M`], ['or factories', `${factories} / 2 with $1.00M sales`]] };
    case 5: return { value: f(sales, 8e6), parts: [['Sales', `${money(sales)} / $8.00M`]] };
    case 6: return { value: Math.max(f(sales, 4e7), f(totalHa(s), 3000)), parts: [['Sales', `${money(sales)} / $40.00M`], ['or land', `${num(totalHa(s))} / 3,000 ha`]] };
    case 7: return { value: f(sales, 2e8), parts: [['Sales', `${money(sales)} / $200.00M`]] };
    default: return null;
  }
}

function EraCard({ s }: { s: GameState }) {
  if (!s.legacyProgression) {
    const o = objective(s);
    const sales = lifetimeSales(s);
    const ratio = (n: number, target: number) => Math.min(1, n / target);
    let progress = 0;
    let requirement = 'The newest playable chapter is ready when you are.';
    if (s.stageId === 'homestead') { progress = Math.min(ratio(s.fields.length, 4), ratio(sales, 90_000)); requirement = '4 fields + $90,000 in sales'; }
    else if (s.stageId === 'market-town') { progress = Math.max(ratio(s.fields.length, 12), ratio(sales, 165_000)); requirement = '12 fields or $165,000 in sales'; }
    else if (s.stageId === 'farm-business') { progress = Math.min(ratio(s.workers.filter(w => w.role === 'hand').length, 2), ratio(sales, 500_000)); requirement = '2 farm hands + $500,000 in sales'; }
    else if (s.stageId === 'industry') { progress = Math.min(ratio(sales, 3_000_000), s.buildings.some(b => BUILDINGS[b.type].category === 'processing') ? 1 : 0); requirement = 'A working processor + $3,000,000 in sales'; }
    return <Card title={<>Chapter · {STAGES[s.stageId].title}</>} info="Chapters open when your business reaches clear milestones. You choose when to advance.">
      <div className="stack s">
        <div className="row between small"><b>{o.title}</b><span className="mono">{pct0(progress)}</span></div>
        <Bar value={progress} color="var(--gold)" label="Chapter progress" />
        <div className="row between small"><span className="muted">Next chapter</span><span>{requirement}</span></div>
        {s.eraReady && <p className="small muted">Ready to preview · advancing is your choice.</p>}
      </div>
    </Card>;
  }
  const next = ERAS[s.era];
  const p = eraProgress(s);
  const o = objective(s);
  return (
    <Card title={<>Era {s.era}: {ERAS[s.era - 1].name}</>} info="Eras open as your business hits real results — lifetime sales, staff, machines, land. Each one unlocks new pages and tools.">
      <div className="stack">
        {next && p ? (
          <div className="stack s">
            <div className="row between small"><span className="muted">Next: Era {next.n} · {next.name}</span><span className="mono">{pct0(p.value)}</span></div>
            <Bar value={p.value} color="var(--gold)" label={`Progress to era ${next.n}`} />
            <p className="small muted">{next.requirement}</p>
            <dl className="facts">{p.parts.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}</dl>
          </div>
        ) : <p className="explain">You have reached the final era. Long-term milestones live on the Policy page.</p>}
        <div className="callout">
          <div className="row between wrap">
            <div><b>{o.title}</b><p className="small muted">{o.hint}</p></div>
            {o.page && o.page !== 'overview' && <button className="btn ghost sm" onClick={() => go(o.page!)}>Go</button>}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- alerts & events

function Alerts({ s }: { s: GameState }) {
  // newest first, one line per distinct message, last few in-game days only
  const seen = new Set<string>();
  const items = s.log.filter((l) => (l.level === 'warning' || l.level === 'critical') && l.tick > s.tick - 24 * 5).reverse()
    .filter((l) => { const k = l.text.replace(/[\d$,.]+/g, '#'); return !seen.has(k) && !!seen.add(k); }).slice(0, 6);
  return (
    <Card title="Alerts" info="Recent warnings and critical messages. Click one to open the page that deals with it.">
      {items.length ? (
        <ol className="log">
          {items.map((e) => (
            <li key={e.id} className={`${e.level}${e.page ? ' link' : ''}`} onClick={e.page ? () => go(e.page!) : undefined}
              role={e.page ? 'button' : undefined} tabIndex={e.page ? 0 : undefined} onKeyDown={e.page ? (k) => (k.key === 'Enter' || k.key === ' ') && go(e.page!) : undefined}>
              <span className="mono">{stamp(e.tick).slice(3)}</span><span>{e.text}</span>
            </li>
          ))}
        </ol>
      ) : <p className="explain">No warnings. Breakdowns, cash problems, spoilage and weather threats will appear here.</p>}
    </Card>
  );
}

function Events({ s }: { s: GameState }) {
  const active = s.events.filter((e) => e.start <= s.tick && e.end > s.tick && (!e.region || s.regions[e.region].unlocked || s.era >= 5));
  const coming = s.events.filter((e) => e.announced <= s.tick && e.start > s.tick);
  return (
    <Card title="World events" info="Droughts, shocks and opportunities currently in effect, and any that have been forecast."
      actions={(active.length > 0 || coming.length > 0) && s.era >= 5 && <button className="btn ghost sm" onClick={() => go('world')}>World</button>}>
      {active.length + coming.length ? (
        <div className="stack s">
          {coming.map((e) => <div key={e.id} className="callout warn small"><b>Forecast: {e.title}</b> — in {duration(e.start - s.tick)}. {e.text}</div>)}
          {active.map((e) => (
            <div key={e.id} className={`callout small ${e.kind === 'demandSurge' || e.kind === 'cropFailureAbroad' || e.kind === 'breakthrough' ? 'good' : 'bad'}`}>
              <b>{e.title}</b> <span className="muted">· {duration(e.end - s.tick)} left</span>
              <p>{e.text}</p>
              {e.choice && !e.choice.chosen && <p className="warn">Awaiting your decision.</p>}
            </div>
          ))}
        </div>
      ) : <p className="explain">Calm for now. Weather, energy shocks and market surges will be listed here while they last.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- charts

function Charts({ s, pl, worth }: { s: GameState; pl: boolean; worth: boolean }) {
  // completed days only; today's book is still filling
  const days = useMemo(() => s.books.slice(0, -1).slice(-60), [s.books.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rev = days.map(dayRevenue);
  const prof = days.map(dayProfit);
  const exp = rev.map((v, i) => v - prof[i]);
  const start = days[0]?.day ?? 0;
  const xf = (i: number) => `Day ${start + i + 1}`;
  return (
    <div className="grid2">
      {pl && (
        <Card title="Revenue, costs & profit" info="Per in-game day, last 60 days. Costs include wages, inputs, energy, depreciation, interest and tax — not purchases of land, machines or buildings.">
          <LineChart format={(n) => money(n)} xFormat={xf} series={[
            { name: 'Revenue', color: 'var(--accent)', data: rev },
            { name: 'Costs', color: 'var(--down)', data: exp, dashed: true },
            { name: 'Profit', color: 'var(--gold)', data: prof },
          ]} />
        </Card>
      )}
      {worth && (
        <Card title="Cash & net worth" info="Start-of-day cash and equity (assets minus debt), last 60 days.">
          <LineChart format={(n) => money(n)} xFormat={xf} series={[
            { name: 'Cash', color: 'var(--accent)', data: days.map((b) => b.cash) },
            { name: 'Net worth', color: 'var(--gold)', data: days.map((b) => b.equity) },
          ]} />
        </Card>
      )}
    </div>
  );
}
