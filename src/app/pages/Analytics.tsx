import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILDINGS, CONFIG, CROPS, DAYS_PER_YEAR, GOODS, MACHINES, REGIONS, TRADEABLE, type CropId, type GoodId, type MachineType, type RegionId } from '../../simulation/config';
import { marketWage, priceUsd, seedCost, sumBooks } from '../../simulation/core';
import { cropScore } from '../../simulation/automation';
import { canGrow, expectedYield, fertility, parcelPrice } from '../../simulation/engine';
import { loanRate } from '../../simulation/finance';
import type { ScenarioInput, ScenarioResult } from '../../simulation/scenario';
import { incomeStatement } from '../../simulation/statements';
import type { Field, GameState } from '../../simulation/types';
import { useGame } from '../../stores/game';
import { Bars, LineChart } from '../Chart';
import { money, num, pct, pct0, price } from '../format';
import { Card, Info, Kpi, NumberInput, PageHead, Select, Table, type Col } from '../ui';
import { GoodName, regionOptions, unlockedRegions } from './shared';

export default function AnalyticsPage() {
  const s = useGame();
  return (
    <div className="stack l">
      <PageHead title="Analytics" sub="Where your money is made and lost — and what happens if things change." />
      <CropProfit s={s} />
      <FieldRanking s={s} />
      <div className="grid2">
        <Forecast s={s} />
        <RegionalProfit s={s} />
      </div>
      <div className="grid2">
        <InventoryProjection s={s} />
        <Equipment s={s} />
      </div>
      <Bottlenecks s={s} />
      {s.era >= 6 ? <Scenario s={s} /> : <p className="faint small">The scenario planner unlocks in Era 6.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- crop profitability

interface CropRow { crop: CropId; yieldHa: number; price: number; rev: number; seed: number; labour: number; unitCost: number; profit: number; perHour: number; score: number }

function CropProfit({ s }: { s: GameState }) {
  const regions = unlockedRegions(s).filter((r) => s.fields.some((f) => f.region === r));
  const [region, setRegion] = useState<RegionId>(regions[0] ?? 'heartland');
  const r = regions.includes(region) ? region : regions[0];
  // the region's largest field stands in for typical soil and water conditions there
  const f = r ? s.fields.filter((x) => x.region === r).reduce((a, b) => (b.ha > a.ha ? b : a)) : null;
  const wage = r ? marketWage(s, r) : 0;
  const rows: CropRow[] = !f ? [] : s.unlockedCrops.filter((c) => canGrow(f, c)).map((c) => {
    const yieldHa = expectedYield(s, f, c) / f.ha;
    const p = priceUsd(s, f.region, c);
    const seed = CONFIG.seedsPerHa * seedCost(s, c);
    const labour = (CROPS[c].harvestHours + CONFIG.plantHours) * wage;
    const profit = yieldHa * p - seed - labour;
    return { crop: c, yieldHa, price: p, rev: yieldHa * p, seed, labour, unitCost: yieldHa > 0 ? (seed + labour) / yieldHa : Infinity, profit, perHour: profit / CROPS[c].growthTicks, score: cropScore(s, f, c) };
  });
  const cols: Col<CropRow>[] = [
    { key: 'crop', label: 'Crop', render: (x) => <GoodName g={x.crop} />, sort: (x) => GOODS[x.crop].name },
    { key: 'y', label: 'Yield/ha', align: 'r', render: (x) => num(x.yieldHa, 1), sort: (x) => x.yieldHa },
    { key: 'p', label: 'Price', align: 'r', render: (x) => price(x.price), sort: (x) => x.price },
    { key: 'rev', label: 'Revenue/ha', align: 'r', render: (x) => money(x.rev), sort: (x) => x.rev },
    { key: 'seed', label: 'Seed/ha', align: 'r', render: (x) => money(x.seed), sort: (x) => x.seed },
    { key: 'lab', label: 'Labour/ha', align: 'r', render: (x) => money(x.labour), sort: (x) => x.labour },
    { key: 'be', label: <>Break-even <Info text="Seed plus hand labour per unit harvested: the price below which this crop loses money here. Machines, fertiliser and storage come on top." /></>, align: 'r',
      render: (x) => <span className={x.unitCost > x.price ? 'down' : ''}>{price(x.unitCost)}</span>, sort: (x) => x.unitCost },
    { key: 'profit', label: 'Profit/ha/cycle', align: 'r', render: (x) => <span className={x.profit < 0 ? 'down' : 'up'}>{money(x.profit)}</span>, sort: (x) => x.profit },
    { key: 'ph', label: <>Profit/ha/h <Info text="Profit per hectare per growing hour after seed and labour — the fairest comparison between fast and slow crops. Managers rank crops on the same figure before labour." /></>, align: 'r',
      render: (x) => <span className={x.perHour < 0 ? 'down' : ''}>{money(x.perHour)}</span>, sort: (x) => x.perHour },
  ];
  return (
    <Card title="Crop profitability" info="Expected economics of one hectare of each crop at today's prices and conditions, using your largest field in the region as the reference."
      actions={regions.length > 1 && <Select label="Region" value={r!} onChange={setRegion} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />}>
      {f ? (
        <div className="stack">
          <Table rows={rows} cols={cols} rowKey={(x) => x.crop} initialSort={{ key: 'ph', dir: -1 }} scroll />
          <p className="small muted">Labour at {money(wage)}/h ({CONFIG.plantHours} h planting + harvest hours per ha). Reference: field {f.id}, {num(f.ha)} ha, fertility {pct0(fertility(f))}.</p>
        </div>
      ) : <p className="explain">Buy land to compare crops.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- field ranking

function FieldRanking({ s }: { s: GameState }) {
  const avg = (f: Field) => (f.yields.length ? f.yields.reduce((a, b) => a + b, 0) / f.yields.length : 0);
  const cols: Col<Field>[] = [
    { key: 'id', label: 'Field', render: (f) => `F${f.id}`, sort: (f) => f.id },
    { key: 'region', label: 'Region', render: (f) => REGIONS[f.region].name, sort: (f) => f.region },
    { key: 'ha', label: 'ha', align: 'r', render: (f) => num(f.ha), sort: (f) => f.ha },
    { key: 'crop', label: 'Crop', render: (f) => (f.crop ? <GoodName g={f.crop} /> : f.lastCrop ? <span className="muted">{GOODS[f.lastCrop].name} (last)</span> : <span className="faint">—</span>), sort: (f) => f.crop ?? f.lastCrop ?? '' },
    { key: 'avg', label: 'Avg yield/ha', align: 'r', render: (f) => (f.yields.length ? num(avg(f), 1) : '—'), sort: avg },
    { key: 'last', label: 'Last harvest', align: 'r', render: (f) => (f.lastHarvest ? `${num(f.lastHarvest.units)} ${GOODS[f.lastHarvest.crop].name.toLowerCase()}` : '—'), sort: (f) => f.lastHarvest?.units ?? 0 },
    { key: 'fert', label: 'Fertility', align: 'r', render: (f) => <span className={fertility(f) < 0.5 ? 'down' : fertility(f) < 0.75 ? 'warn' : ''}>{pct0(fertility(f))}</span>, sort: fertility },
    { key: 'pest', label: 'Pests', align: 'r', render: (f) => <span className={f.pest > 0.3 ? 'down' : ''}>{pct0(f.pest)}</span>, sort: (f) => f.pest },
  ];
  return (
    <Card title="Field performance" info="Every field ranked by its average yield per hectare over recent harvests. Yields compare fairly only within the same crop.">
      <Table rows={s.fields} cols={cols} rowKey={(f) => f.id} initialSort={{ key: 'avg', dir: -1 }} search={(f) => `F${f.id} ${REGIONS[f.region].name} ${f.crop ?? ''}`} empty="No fields yet." />
    </Card>
  );
}

// ---------------------------------------------------------------- forecast

function Forecast({ s }: { s: GameState }) {
  const days = Math.max(1, Math.min(30, s.books.length - 1));
  const is = incomeStatement(s, days);
  const interest = sumBooks(s, days, ['interest']);
  const investing = sumBooks(s, days, ['land', 'machine', 'building', 'acquisition', 'irrigation', 'assetSale', 'margin']);
  const financing = sumBooks(s, days, ['loanIn', 'loanRepay', 'sharesIssued', 'dividends', 'buyback']);
  // operating cash per day, excluding loan interest (scheduled separately below) and depreciation (non-cash)
  const opDay = (sumBooks(s, days) - sumBooks(s, days, ['depreciation']) - investing - financing - interest) / days;
  const cash: number[] = [s.cash];
  let loanTotal = 0;
  const balances = s.loans.map((l) => ({ bal: l.balance, left: l.daysLeft, rate: loanRate(s, l.spread) }));
  for (let d = 1; d <= 30; d++) {
    let pay = 0;
    for (const l of balances) {
      if (l.bal <= 0) continue;
      const principal = l.left > 0 ? l.bal / l.left : l.bal;
      pay += principal + (l.bal * l.rate) / DAYS_PER_YEAR;
      l.bal -= principal;
      l.left--;
    }
    loanTotal += pay;
    cash.push(cash[d - 1] + opDay - pay);
  }
  const revDay = is.revenue / days;
  return (
    <Card title="30-day cash forecast" info={`A straight-line projection: the last ${days} days of operating cash flow repeated, minus scheduled loan payments. It assumes no new investments, prices or events.`}>
      <div className="stack">
        <div className="kpis">
          <Kpi label="Revenue (30d)" value={money(revDay * 30)} info="Average daily revenue × 30." />
          <Kpi label="Operating cash (30d)" value={money(opDay * 30)} tone={opDay < 0 ? 'down' : 'up'} info="Average daily cash from operations (after costs and tax, before loan payments) × 30." />
          <Kpi label="Loan payments" value={money(-loanTotal)} tone={loanTotal ? 'warn' : undefined} info="Principal and interest due over the next 30 days at today's rates." />
          <Kpi label="Cash in 30 days" value={money(cash[30])} tone={cash[30] < 0 ? 'down' : undefined} info="Today's cash plus the above." />
        </div>
        <LineChart series={[{ name: 'Projected cash', color: 'var(--accent)', data: cash, dashed: true }]} format={(n) => money(n)} xFormat={(i) => (i ? `+${i} days` : 'Today')} height={160} />
      </div>
    </Card>
  );
}

function RegionalProfit({ s }: { s: GameState }) {
  const rows = unlockedRegions(s).map((r) => ({ label: REGIONS[r].name, value: s.books.slice(-30).reduce((a, b) => a + (b.op[r] ?? 0), 0) }));
  return (
    <Card title="Regional profitability" info="Operating profit booked in each region over the last 30 days: sales minus the costs incurred there (wages, inputs, energy, freight, depreciation, interest, tax). Corporate costs are booked to Heartland.">
      <Bars rows={rows} format={(n) => money(n)} />
    </Card>
  );
}

// ---------------------------------------------------------------- inventory & equipment

function InventoryProjection({ s }: { s: GameState }) {
  const rows = TRADEABLE.concat(['fertilizer', 'fuel', 'manure'] as GoodId[]).filter((g, i, a) => a.indexOf(g) === i).map((g) => {
    let qty = 0, value = 0;
    for (const r of unlockedRegions(s)) {
      const q = s.regions[r].inventory[g];
      qty += q;
      value += q * priceUsd(s, r, g);
    }
    const keep = (1 - GOODS[g].spoilProper) ** 30;
    return { g, qty, value, spoil: GOODS[g].spoilProper, after: qty * keep, lost: value * (1 - keep) };
  }).filter((x) => x.qty >= 1);
  const cols: Col<(typeof rows)[number]>[] = [
    { key: 'g', label: 'Good', render: (x) => <GoodName g={x.g} />, sort: (x) => GOODS[x.g].name },
    { key: 'q', label: 'Held', align: 'r', render: (x) => num(x.qty), sort: (x) => x.qty },
    { key: 'v', label: 'Value', align: 'r', render: (x) => money(x.value), sort: (x) => x.value },
    { key: 'sp', label: 'Spoils/day', align: 'r', render: (x) => pct(-x.spoil), sort: (x) => x.spoil },
    { key: 'a', label: 'In 30 days', align: 'r', render: (x) => num(x.after), sort: (x) => x.after },
    { key: 'l', label: 'Value lost', align: 'r', render: (x) => <span className={x.lost > 1 ? 'down' : ''}>{money(-x.lost)}</span>, sort: (x) => x.lost },
  ];
  return (
    <Card title="Inventory projection" info="What your current stock becomes in 30 days if you sell nothing, at the spoilage rate in proper storage. Cold goods kept in dry storage spoil much faster.">
      <Table rows={rows} cols={cols} rowKey={(x) => x.g} initialSort={{ key: 'l', dir: -1 }} empty="Nothing in storage." />
    </Card>
  );
}

function Equipment({ s }: { s: GameState }) {
  // Machines keep only lifetime hours, so the rate is measured from the moment this page opened.
  const first = useRef<{ tick: number; hours: Map<number, number> } | null>(null);
  if (!first.current) first.current = { tick: s.tick, hours: new Map(s.machines.map((m) => [m.id, m.hours])) };
  const span = s.tick - first.current.tick;
  const types = [...new Set(s.machines.map((m) => m.type))] as MachineType[];
  const rows = types.map((t) => {
    const ms = s.machines.filter((m) => m.type === t);
    const measured = ms.filter((m) => first.current!.hours.has(m.id));
    const worked = measured.reduce((a, m) => a + m.hours - first.current!.hours.get(m.id)!, 0);
    return {
      t, n: ms.length, now: ms.filter((m) => m.usedThisTick).length, broken: ms.filter((m) => m.broken).length,
      cond: ms.reduce((a, m) => a + m.condition, 0) / ms.length,
      perDay: span >= 6 && measured.length ? (worked / measured.length / span) * 24 : null,
    };
  });
  return (
    <Card title="Equipment utilisation" info="How many hours a day each machine type actually works, out of 24. Idle machines still cost lease, depreciation and capital. Measured while this page is open.">
      {rows.length ? (
        <div className="stack s">
          {rows.map((r) => (
            <div key={r.t} className="row between wrap small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <span><b>{MACHINES[r.t].name}</b> <span className="muted">×{r.n} · {r.now} working now{r.broken ? ` · ${r.broken} broken` : ''} · condition {pct0(r.cond)}</span></span>
              <span className="mono">{r.perDay === null ? 'measuring…' : `${num(r.perDay, 1)} h/day · ${pct0(r.perDay / 24)}`}</span>
            </div>
          ))}
          {span < 6 && <p className="faint small">Utilisation appears after a few in-game hours.</p>}
        </div>
      ) : <p className="explain">No machines yet.</p>}
    </Card>
  );
}

function Bottlenecks({ s }: { s: GameState }) {
  const groups = new Map<string, { type: keyof typeof BUILDINGS; region: RegionId; reason: string; n: number; util: number }>();
  for (const b of s.buildings) {
    if (!b.active || !b.reason) continue;
    const k = `${b.type}|${b.region}|${b.reason}`;
    const g = groups.get(k) ?? { type: b.type, region: b.region, reason: b.reason, n: 0, util: 0 };
    g.n++;
    g.util += b.util;
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.util / a.n - b.util / b.n);
  const paused = s.buildings.filter((b) => !b.active).length;
  return (
    <Card title="Production bottlenecks" info="Facilities running below capacity right now, grouped by type, region and cause. Under-used facilities still pay full staff costs.">
      {rows.length ? (
        <div className="stack s">
          {rows.map((g) => (
            <div key={`${g.type}${g.region}${g.reason}`} className="row between wrap small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <span><b>{BUILDINGS[g.type].name}</b>{g.n > 1 ? ` ×${g.n}` : ''} <span className="muted">· {REGIONS[g.region].name}</span></span>
              <span><span className="warn">{g.reason}</span> <span className="mono muted">{pct0(g.util / g.n)} used</span></span>
            </div>
          ))}
        </div>
      ) : <p className="explain">{s.buildings.length ? 'Every active facility is running at capacity.' : 'No facilities yet.'}</p>}
      {paused > 0 && <p className="faint small" style={{ marginTop: 8 }}>{paused} facilities are paused.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- scenario planner

function Scenario({ s }: { s: GameState }) {
  const regions = regionOptions(s);
  const goods = TRADEABLE.filter((g) => GOODS[g].kind !== 'input' || g === 'fertilizer' || g === 'fuel');
  const [days, setDays] = useState(30);
  const [good, setGood] = useState<GoodId>('wheat');
  const [pricePct, setPricePct] = useState(0);
  const [energyPct, setEnergyPct] = useState(0);
  const [wagePct, setWagePct] = useState(0);
  const [buyRegion, setBuyRegion] = useState<RegionId>('heartland');
  const [buyHa, setBuyHa] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    if (!worker.current) {
      worker.current = new Worker(new URL('../../simulation/scenario.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onmessage = (e: MessageEvent<{ id: number; result?: ScenarioResult; error?: string }>) => {
        if (e.data.id !== reqId.current) return;
        setBusy(false);
        if (e.data.result) setResult(e.data.result);
        else setError(e.data.error ?? 'The scenario failed.');
      };
      worker.current.onerror = () => (setBusy(false), setError('The scenario worker crashed.'));
    }
    const input: ScenarioInput = {
      days, priceGood: pricePct ? good : undefined, pricePct: pricePct / 100 || undefined, energyPct: energyPct / 100 || undefined,
      wagePct: wagePct / 100 || undefined, buyRegion: buyHa > 0 ? buyRegion : undefined, buyHa: buyHa > 0 ? buyHa : undefined,
    };
    setBusy(true);
    setError('');
    worker.current.postMessage({ id: ++reqId.current, state: JSON.parse(JSON.stringify(s)), input });
  };

  const landCost = buyHa > 0 ? parcelPrice(s, buyRegion, buyHa) : 0;
  const known = useMemo(() => [
    ['Cash', money(s.cash)], ['Fields', `${s.fields.length} · ${num(s.fields.reduce((a, f) => a + f.ha, 0))} ha`], ['Workers', num(s.workers.length)], ['Machines', num(s.machines.length)], ['Facilities', num(s.buildings.length)],
  ], [s.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Scenario planner" info="Runs the real simulation forward twice from this exact moment and the same random seed: once unchanged, once with your assumptions. Differences come only from what you change. Only your staff, managers, policies and rules act — no new decisions.">
      <div className="stack">
        <div className="grid2">
          <div className="stack s">
            <h3>Assumptions</h3>
            <div className="row between wrap small"><span>Horizon (days)</span><NumberInput label="Days to simulate" value={days} onChange={(n) => setDays(Math.round(n))} min={1} max={120} step={5} width={90} /></div>
            <div className="row between wrap small">
              <span>Price shock</span>
              <span className="row"><Select label="Good" value={good} onChange={setGood} options={goods.map((g) => ({ v: g, label: GOODS[g].name }))} /><NumberInput label="Price change %" value={pricePct} onChange={setPricePct} min={-90} max={300} step={5} width={70} />%</span>
            </div>
            <div className="row between wrap small"><span>Energy (fuel, fertiliser, power)</span><span className="row"><NumberInput label="Energy change %" value={energyPct} onChange={setEnergyPct} min={-80} max={300} step={5} width={70} />%</span></div>
            <div className="row between wrap small"><span>Wages & land costs</span><span className="row"><NumberInput label="Wage change %" value={wagePct} onChange={setWagePct} min={-80} max={300} step={5} width={70} />%</span></div>
            <div className="row between wrap small">
              <span>Buy land</span>
              <span className="row"><Select label="Region to buy in" value={buyRegion} onChange={setBuyRegion} options={regions} /><NumberInput label="Hectares to buy" value={buyHa} onChange={(n) => setBuyHa(Math.round(n))} min={0} max={100000} step={25} width={80} />ha</span>
            </div>
            {buyHa > 0 && <p className="small muted" style={{ textAlign: 'right' }}>Land would cost about {money(landCost)}{landCost > s.cash ? ' — more than your cash; the scenario runs it on overdraft.' : '.'}</p>}
            <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Simulating…' : `Run ${days}-day scenario`}</button>
            {error && <p className="callout bad small">{error}</p>}
          </div>
          <div className="stack s">
            <h3>Known values (today)</h3>
            <dl className="facts">{known.map(([k, v]) => [<dt key={`k${k}`}>{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}</dl>
          </div>
        </div>
        {busy && <p className="explain">Simulating {days} days twice — this runs in the background so the game keeps going.</p>}
        {result && !busy && <ScenarioOut r={result} />}
      </div>
    </Card>
  );
}

function ScenarioOut({ r }: { r: ScenarioResult }) {
  const rows: [string, number, number][] = [['Revenue', r.base.revenue, r.scen.revenue], ['Operating costs', r.base.opex, r.scen.opex], ['Net profit', r.base.net, r.scen.net],
    ['Ending cash', r.base.cash[r.base.cash.length - 1], r.scen.cash[r.scen.cash.length - 1]], ['Ending equity', r.base.equity[r.base.equity.length - 1], r.scen.equity[r.scen.equity.length - 1]]];
  return (
    <div className="stack">
      <LineChart format={(n) => money(n)} xFormat={(i) => `Day +${i + 1}`} series={[
        { name: 'Cash (baseline)', color: 'var(--accent)', data: r.base.cash, dashed: true },
        { name: 'Cash (scenario)', color: 'var(--accent)', data: r.scen.cash },
        { name: 'Equity (baseline)', color: 'var(--gold)', data: r.base.equity, dashed: true },
        { name: 'Equity (scenario)', color: 'var(--gold)', data: r.scen.equity },
      ]} />
      <div className="table-wrap scroll">
        <table className="t">
          <thead><tr><th>Over {r.days} days</th><th className="r">Baseline</th><th className="r">Scenario</th><th className="r">Difference</th></tr></thead>
          <tbody>
            {rows.map(([k, a, b]) => (
              <tr key={k}><td>{k}</td><td className="r mono">{money(a)}</td><td className="r mono">{money(b)}</td><td className={`r mono ${b - a < 0 ? 'down' : b - a > 0 ? 'up' : ''}`}>{money(b - a)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Assumptions applied</h3>
        <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>
    </div>
  );
}
