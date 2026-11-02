import { useState } from 'react';
import { CONFIG, CROPS, CROP_IDS, GOODS, PERKS, REGIONS, WORK_END, WORK_START, type PerkId, type RegionId } from '../../simulation/config';
import { clamp, execOn, known, marketWage } from '../../simulation/core';
import { hireCost, trainCost } from '../../simulation/engine';
import { productivity, spanPenalty, wageOf } from '../../simulation/operations';
import type { GameState, Worker } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Bar, Card, Confirm, Info, Kpi, PageHead, Seg, Select, Table, type Col } from '../ui';
import { regionOptions, unlockedRegions } from './shared';

const HOURS = WORK_END - WORK_START; // paid hours per day
const PAY_LEVELS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];
const SET_LEVELS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];

/** Mirrors workforceDaily's morale target. */
const moraleTarget = (s: GameState, r: RegionId, pay: number) =>
  clamp(0.62 + (pay - 1) * 1.3 - 0.2 * Math.min(1, s.regions[r].backlog / HOURS) + (0.15 * (s.corp.reputation - 50)) / 50, 0, 1);

const moraleTone = (m: number) => (m < 0.25 ? 'var(--down)' : m < 0.45 ? 'var(--warn)' : 'var(--up)');

function regionSummary(s: GameState, r: RegionId) {
  const ws = s.workers.filter((w) => w.region === r);
  const hands = ws.filter((w) => w.role === 'hand');
  const managers = ws.length - hands.length;
  const bill = ws.reduce((a, w) => a + wageOf(s, w) * HOURS, 0);
  const labour = hands.reduce((a, w) => a + (w.trainingUntil > s.tick ? 0 : productivity(s, w) * HOURS), 0);
  let ahead = 0;
  for (const f of s.fields) {
    if (f.region !== r) continue;
    if (f.crop) ahead += f.ha * CROPS[f.crop].harvestHours * (1 - (f.work || 0));
    else if (f.plan) ahead += f.ha * CONFIG.plantHours;
  }
  const span = 8 + 20 * (managers + (execOn(s, 'crops') ? 2 : 0));
  return { r, hands: hands.length, managers, bill, labour, ahead, span, penalty: spanPenalty(s, r) };
}

export default function WorkersPage() {
  const s = useGame();
  const regions = unlockedRegions(s);
  const rows = regions.map((r) => regionSummary(s, r));
  const totalBill = rows.reduce((a, x) => a + x.bill, 0);
  const lowMorale = s.workers.filter((w) => w.morale < 0.25);

  return (
    <div className="stack l">
      <PageHead title="Workers" sub="Hands plant and harvest every field too big to work yourself. Managers keep big crews efficient and run your automation policies." />

      <div className="kpis">
        <Kpi label="Farm hands" value={num(s.workers.filter((w) => w.role === 'hand').length)} />
        <Kpi label="Managers" value={num(s.workers.filter((w) => w.role === 'manager').length)} sub={s.era < 3 ? 'Available from Era 3' : undefined} />
        <Kpi label="Wage bill / day" value={money(totalBill)} info={`Every worker is paid each working hour (${WORK_START}:00–${WORK_END}:00), whether there is work or not.`}
          breakdown={rows.map((x) => [REGIONS[x.r].name, money(x.bill)])} />
        <Kpi label="Quitting risk" value={num(lowMorale.length)} tone={lowMorale.length ? 'down' : undefined} info="Workers whose morale is below 25%. Anyone who stays that low for 5 days in a row quits." />
      </div>

      <Card title="Farm advisor" coach="hire-advisor" info="An advisor reads your books every day and explains, in plain words, what is costing you money and how to fix it.">
        <div className="row between wrap">
          <p className="small">{s.advisor
            ? <>Your advisor watches the books for {money(CONFIG.advisorFee * s.macro.cpi * HOURS)} a day. Look for their 📉 / 💡 note on the farm and the Overview page.</>
            : <>Losing money and not sure why? An advisor spots costly mistakes — idle staff, flooded markets, tired soil, expensive debt — for {money(CONFIG.advisorFee * s.macro.cpi * HOURS)} a day.</>}</p>
          <button className={`btn ${s.advisor ? 'ghost' : 'primary'} sm`} onClick={() => act({ type: 'setAdvisor', on: !s.advisor })}>{s.advisor ? 'Let go' : 'Hire advisor'}</button>
        </div>
      </Card>

      <Card title="Crews by region" info="Labour-hours available counts each hand's productivity × 12 working hours. Field work ahead is the hand-labour still needed to harvest what is growing and plant planned fallow fields.">
        <Table rows={rows} rowKey={(x) => x.r} scroll cols={[
          { key: 'r', label: 'Region', render: (x) => REGIONS[x.r].name },
          { key: 'h', label: 'Hands', align: 'r', render: (x) => num(x.hands) },
          { key: 'm', label: 'Managers', align: 'r', render: (x) => num(x.managers) },
          { key: 'w', label: 'Market wage', align: 'r', render: (x) => `${price(marketWage(s, x.r))}/h` },
          { key: 'b', label: 'Wage bill / day', align: 'r', render: (x) => money(x.bill) },
          { key: 'l', label: 'Labour-h / day', align: 'r', render: (x) => num(x.labour, 1) },
          { key: 'a', label: 'Field work ahead', align: 'r', render: (x) => <span className={x.ahead > x.labour * 2 ? 'warn' : ''}>{num(x.ahead, 0)} h</span> },
          { key: 'p', label: 'Span', align: 'r', render: (x) => (
            <span className={x.penalty < 1 ? 'down' : ''}>{pct0(x.penalty)}<Info text="Management overhead: the owner can oversee 8 hands, each manager 20 more, and a head of crops counts as 2 managers. Beyond that span every hand slows down (√ of span ÷ hands, never below 71%)."
              breakdown={[['Hands', num(x.hands)], ['Owner', '8'], ['Managers × 20', num(x.managers * 20)], ['Head of crops', execOn(s, 'crops') ? '+40' : '—'], ['Span capacity', num(x.span)], ['Productivity multiplier', pct0(x.penalty)]]} /></span>
          ) },
        ]} />
        <div className="explain" style={{ marginTop: 10 }}>
          Wages are paid every working hour from {WORK_START}:00 to {WORK_END}:00, busy or idle — an idle crew is pure cost. Planting takes {CONFIG.plantHours} labour-hours per ha; harvesting
          takes {CROP_IDS.filter((c) => s.unlockedCrops.includes(c)).map((c) => `${GOODS[c].name.toLowerCase()} ${CROPS[c].harvestHours}`).join(', ')} h/ha. A hand driving a tractor or harvester covers that machine's hectares per hour instead, so machines multiply each hand many times over.
        </div>
      </Card>

      <div className="grid2">
        <HireCard s={s} />
        <BulkCard s={s} />
      </div>

      <WorkerTable s={s} />
    </div>
  );
}

function HireCard({ s }: { s: GameState }) {
  const opts = regionOptions(s);
  const [region, setRegion] = useState<RegionId>('heartland');
  const r = opts.some((o) => o.v === region) ? region : 'heartland';
  const [role, setRole] = useState<'hand' | 'manager'>('hand');
  const [pay, setPay] = useState(1);
  const cost = hireCost(s, r);
  const base = role === 'manager' ? CONFIG.managerWage * s.macro.cpi : marketWage(s, r);
  const target = moraleTarget(s, r, pay);
  const span = spanPenalty(s, r);
  const prodLo = 0.75 * (0.6 + 0.4 * target) * span, prodHi = 1.1 * (0.6 + 0.4 * target) * span;
  return (
    <Card title="Hire">
      <div className="stack">
        <div className="row wrap">
          {opts.length > 1 && <Select label="Region" value={r} onChange={setRegion} options={opts} />}
          <Seg label="Role" value={role} onChange={setRole} options={[{ v: 'hand', label: 'Farm hand' }, { v: 'manager', label: 'Manager', disabled: s.era < 3, title: s.era < 3 ? 'Managers become available in Era 3' : undefined }]} />
        </div>
        <div className="stack s">
          <span className="small muted">Pay level (× market wage)</span>
          <Seg label="Pay level" value={pay} onChange={setPay} options={PAY_LEVELS.map((v) => ({ v, label: `${v.toFixed(1)}×` }))} />
        </div>
        <dl className="facts">
          <dt>Hourly pay</dt><dd>{price(base * pay)}/h</dd>
          <dt>Per day ({HOURS} h)</dt><dd>{money(base * pay * HOURS)}</dd>
          <dt>Expected morale <Info text="Morale drifts 20% of the way toward its target every day. Target ≈ 0.62 + (pay − 1) × 1.3 − overwork + reputation. Overwork is the share of today's hours with unfinished field work (up to −0.20)."
            breakdown={[['Base', '0.62'], ['Pay', (1.3 * (pay - 1)).toFixed(2)], ['Overwork', (-0.2 * Math.min(1, s.regions[r].backlog / HOURS)).toFixed(2)], ['Reputation', ((0.15 * (s.corp.reputation - 50)) / 50).toFixed(2)], ['Target', pct0(target)]]} /></dt>
          <dd className={target < 0.25 ? 'down' : target < 0.45 ? 'warn' : 'up'}>{pct0(target)}</dd>
          {role === 'hand' && <><dt>Productivity <Info text="Skill × (0.6 + 0.4 × morale) × span. New hands arrive with skill 0.75–1.10 and learn on the job up to 1.30." /></dt><dd>{prodLo.toFixed(2)}–{prodHi.toFixed(2)}</dd></>}
          {role === 'manager' && <><dt>Effect</dt><dd>+20 hands of span</dd></>}
          <dt>Recruitment</dt><dd>{money(cost)}</dd>
        </dl>
        {role === 'manager' && <p className="explain">Managers don't work fields. They extend how many hands run at full speed, and in their region they carry out your automation policies (rotation, fertilising, selling discipline).</p>}
        {target < 0.25 && <div className="callout bad">At this pay morale settles below 25% — they will quit within about a week.</div>}
        <button className="btn primary" data-coach="hire-btn" disabled={cost > s.cash} onClick={() => act({ type: 'hire', region: r, role, wageFactor: pay }, 'Hired.')}>
          Hire {role === 'hand' ? 'farm hand' : 'manager'} <span className="btn-sub">{money(cost)}</span>
        </button>
      </div>
    </Card>
  );
}

function BulkCard({ s }: { s: GameState }) {
  const opts = regionOptions(s);
  const [region, setRegion] = useState<RegionId>('heartland');
  const r = opts.some((o) => o.v === region) ? region : 'heartland';
  const [to, setTo] = useState(1.1);
  const below = s.workers.filter((w) => w.region === r && w.wageFactor < to - 1e-9);
  const extra = below.reduce((a, w) => a + (wageOf(s, w) / w.wageFactor) * (to - w.wageFactor) * HOURS, 0);
  return (
    <Card title="Pay rise" info="Raises everyone in a region who is paid below the chosen level. Nobody gets a pay cut.">
      <div className="stack">
        <div className="row wrap">
          {opts.length > 1 && <Select label="Region for pay rise" value={r} onChange={setRegion} options={opts} />}
          <Seg label="New pay level" value={to} onChange={setTo} options={PAY_LEVELS.filter((v) => v >= 1).map((v) => ({ v, label: `${v.toFixed(1)}×` }))} />
        </div>
        <p className="explain">{below.length ? <>{below.length} worker{below.length === 1 ? '' : 's'} in {REGIONS[r].name} earn less than {to.toFixed(1)}×. Raising them costs about <b>{money(extra)}</b> more per day and lifts their morale target to {pct0(moraleTarget(s, r, to))}.</> : `Everyone in ${REGIONS[r].name} already earns at least ${to.toFixed(1)}×.`}</p>
        <button className="btn ghost" disabled={!below.length} onClick={() => { below.forEach((w) => act({ type: 'setWage', workerId: w.id, wageFactor: to })); }}>
          Raise everyone in {REGIONS[r].name} to {to.toFixed(1)}×
        </button>
      </div>
    </Card>
  );
}

function WorkerTable({ s }: { s: GameState }) {
  const tc = trainCost(s);
  const multi = unlockedRegions(s).length > 1;
  const live: Col<Worker>[] = [
    { key: 'name', label: 'Name', sort: (w) => w.name, render: (w) => w.name },
    { key: 'role', label: 'Role', sort: (w) => w.role, render: (w) => <span className={`pill ${w.role === 'manager' ? 'accent' : ''}`}>{w.role === 'manager' ? 'Manager' : 'Hand'}</span> },
    ...(multi ? [{ key: 'region', label: 'Region', sort: (w: Worker) => w.region, render: (w: Worker) => REGIONS[w.region].name }] : []),
    { key: 'skill', label: 'Skill', align: 'r', sort: (w) => w.skill, render: (w) => w.skill.toFixed(2) },
    ...(known(s, 'perks') ? [{ key: 'perk', label: 'Specialism', sort: (w: Worker) => w.perk ?? '', render: (w: Worker) => w.role !== 'hand' ? <span className="faint">—</span>
      : w.perk ? <span className="pill accent" title={PERKS[w.perk].text}>{PERKS[w.perk].name}</span>
      : w.skill >= 1.05 ? <Select label={`Specialism for ${w.name}`} value={'' as PerkId | ''} onChange={(v) => v && act({ type: 'choosePerk', workerId: w.id, perk: v as PerkId })}
          options={[{ v: '' as PerkId | '', label: 'Choose a perk…' }, ...(Object.keys(PERKS) as PerkId[]).map((k) => ({ v: k as PerkId | '', label: `${PERKS[k].name} — ${PERKS[k].text}` }))]} />
      : <span className="faint small">at skill 1.05</span> } as Col<Worker>] : []),
    { key: 'morale', label: 'Morale', sort: (w) => w.morale, width: 130, render: (w) => (
      <div className="stack s">
        <Bar thin value={w.morale} color={moraleTone(w.morale)} label={`Morale ${pct0(w.morale)}`} />
        <span className="small mono">{pct0(w.morale)}{w.morale < 0.25 && <span className="down"> · quits in {Math.max(1, 5 - w.lowDays)}d</span>}</span>
      </div>
    ) },
    { key: 'pay', label: 'Pay', sort: (w) => w.wageFactor, render: (w) => (
      <div className="row">
        <Select label={`Pay for ${w.name}`} value={w.wageFactor.toFixed(1)} onChange={(v) => act({ type: 'setWage', workerId: w.id, wageFactor: Number(v) })}
          options={SET_LEVELS.map((v) => ({ v: v.toFixed(1), label: `${v.toFixed(1)}×` }))} />
        <span className="small mono muted">{price(wageOf(s, w))}/h</span>
      </div>
    ) },
    { key: 'hours', label: 'Hours worked', align: 'r', sort: (w) => w.hours, render: (w) => (w.role === 'manager' ? <span className="faint">—</span> : num(w.hours)) },
    { key: 'train', label: 'Training', sort: (w) => w.trainingUntil, render: (w) => w.trainingUntil > s.tick
      ? <span className="pill warn">Away {Math.ceil(w.trainingUntil - s.tick)}h</span>
      : w.skill >= 1.6 ? <span className="pill good">Max skill</span>
      : <button className="btn ghost sm" disabled={tc > s.cash} title="+0.15 skill; away from work for 24 hours (still paid)" onClick={() => act({ type: 'train', workerId: w.id }, `${w.name} is in training.`)}>Train {money(tc)}</button> },
    { key: 'fire', label: '', render: (w) => (
      <Confirm label="Fire" className="btn danger sm" title={`Fire ${w.name}?`} confirmLabel="Fire"
        body={<>Severance is 12 hours' pay: <b>{money(wageOf(s, w) * 12)}</b>. Everyone else in {REGIONS[w.region].name} loses 5 points of morale.</>}
        onConfirm={() => act({ type: 'fire', workerId: w.id }, `${w.name} let go.`)} />
    ) },
  ];
  return (
    <Card title={`Staff (${s.workers.length})`} info="Pay can be set from 0.7× to 1.6× of the market wage. Training costs a flat fee, adds 0.15 skill (max 1.6) and keeps the worker away for 24 hours.">
      <Table rows={s.workers} cols={live} rowKey={(w) => w.id} search={(w) => `${w.name} ${w.role} ${REGIONS[w.region].name}`}
        initialSort={{ key: 'morale', dir: 1 }} empty="No one on the payroll yet. Hire a farm hand above — they plant and harvest any field with a crop plan." />
    </Card>
  );
}
