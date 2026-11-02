import { useState, type ReactNode } from 'react';
import { BUILDINGS, BUILDING_TYPES, GOODS, GOOD_IDS, REGIONS, TRADEABLE, type BuildingType, type CropId, type GoodId, type RegionId } from '../../simulation/config';
import { execOn, has } from '../../simulation/core';
import { avg30 } from '../../simulation/engine';
import { hasManager, metricLabel, metricValue } from '../../simulation/automation';
import { autoBudget } from '../../simulation/operations';
import { overdraftLimit } from '../../simulation/finance';
import type { GameState, Policies, Rule, RuleAction, RuleMetric } from '../../simulation/types';
import { act, go, useGame } from '../../stores/game';
import { money, num, stamp } from '../format';
import { Card, Confirm, Info, NumberInput, PageHead, Seg, Select } from '../ui';
import { regionOptions, unlockedRegions } from './shared';

type Draft = Omit<Rule, 'id' | 'lastRun' | 'history'>;
const setP = (patch: Partial<Policies>) => act({ type: 'setPolicies', patch });
const OnOff = ({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) =>
  <Seg label={label} value={value ? 1 : 0} onChange={(v) => onChange(v === 1)} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'On' }]} />;

export default function AutomationPage() {
  const s = useGame();
  return (
    <div className="stack l">
      <PageHead title="Automation" sub="Tell your managers what you want, then add rules that react to prices, stock and machines while you look elsewhere." />
      <PoliciesCard s={s} />
      {has(s, 'farmSoftware') ? <Rules s={s} /> : (
        <Card title="Rules">
          <p className="muted">Research <b>Farm management software</b> to unlock if/then rules (e.g. "sell wheat when the price is high").{' '}
            {s.era >= 4 ? <button className="btn ghost sm" onClick={() => go('research')}>Open Research</button> : 'Research opens in Era 4.'}</p>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- policies

function Policy({ title, who, children, info, note }: { title: string; who: ReactNode; children: ReactNode; info: string; note?: ReactNode }) {
  return (
    <div className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row between wrap">
        <b>{title}<Info text={info} /></b>
        <div className="row wrap">{children}</div>
      </div>
      <span className="small muted">{who}</span>
      {note}
    </div>
  );
}

function PoliciesCard({ s }: { s: GameState }) {
  const P = s.automation.policies;
  const regions = unlockedRegions(s);
  const lacking = regions.filter((r) => !hasManager(s, r));
  const managers = lacking.length ? <>Managers do this. <span className="warn">No manager in {lacking.map((r) => REGIONS[r].name).join(', ')}</span> — <button className="btn ghost sm" onClick={() => go('workers')}>Hire one</button></> : execOn(s, 'crops') ? 'Run by your head of crops in every region.' : 'Managers do this in every region you operate.';
  const reserveNote = P.cashReserve > 0
    ? <>Automation will spend down to {money(P.cashReserve)}; currently {money(Math.max(0, autoBudget(s)))} available. Seed for planned fields and animal feed are always bought, so your crew never stands idle.</>
    : <>With no reserve, workers may plant on up to half your overdraft ({money(overdraftLimit(s) * 0.5)}). Seed budget now: {money(autoBudget(s))}.</>;
  return (
    <Card title="Policies" info="Standing orders. Managers, maintenance crews and the irrigation system follow them every day. Automation never spends below the cash reserve.">
      <div className="stack">
        <Policy title="Cash reserve" info="Floor for every automated purchase: seed for replanting, fertiliser, repairs, rule purchases and debt repayment. Wages and running costs are still paid regardless."
          who="Applies to all automation, including field workers buying seed." note={<span className="small">{reserveNote}</span>}>
          <NumberInput label="Cash reserve" value={P.cashReserve} step={1000} onChange={(v) => setP({ cashReserve: Math.round(v) })} />
        </Policy>

        <Policy title="Crop rotation" info="Each time a field is empty, its manager plans the crop with the best expected profit per hour at today's prices, avoiding repeat crops that build pests. With Agricultural AI they also spare depleted soil and rotate in soybeans to fix nitrogen."
          who={managers}>
          <OnOff label="Crop rotation" value={P.autoRotate} onChange={(v) => setP({ autoRotate: v })} />
        </Policy>

        <Policy title="Fertilise fallow fields" info="At midday, managers fertilise empty fields whose fertility is below the target, buying fertiliser if stock is short (within the cash reserve)."
          who={managers}>
          <OnOff label="Auto fertilise" value={P.autoFertilize} onChange={(v) => setP({ autoFertilize: v })} />
          {P.autoFertilize && <Seg label="Soil target" value={P.soilTarget} onChange={(v) => setP({ soilTarget: v })} options={[0.4, 0.5, 0.6, 0.7, 0.8].map((v) => ({ v, label: `${v * 100}%` }))} />}
        </Policy>

        <Policy title="Auto-repair" info="Once a day, every machine below this condition (or broken) is serviced, if cash above the reserve covers it. Repairs of broken machines cost 3× a service."
          who="Your maintenance crew — no manager needed.">
          <Seg label="Auto-repair threshold" value={P.autoRepair} onChange={(v) => setP({ autoRepair: v })} options={[{ v: 0, label: 'Off' }, ...[0.4, 0.5, 0.6, 0.7, 0.8].map((v) => ({ v, label: `<${v * 100}%` }))]} />
        </Policy>

        <Policy title="Selling discipline" info="At midday, managers sell 25% of each crop or product when the price is at least this multiple of its 30-day average, or when dry storage is fuller than the cap. Fast-spoiling goods (over 2%/day) are sold in full every day. Stock promised to accepted contracts is kept."
          who={managers} note={P.sellDiscipline > 0 ? <span className="small muted">Caveat: selling into a thin market moves the price; 25% at a time limits the damage.</span> : undefined}>
          <Seg label="Sell when price above" value={P.sellDiscipline} onChange={(v) => setP({ sellDiscipline: v })} options={[{ v: 0, label: 'Off' }, ...[1, 1.05, 1.1, 1.2, 1.3].map((v) => ({ v, label: `${v.toFixed(2)}×` }))]} />
          {P.sellDiscipline > 0 && <Seg label="Or storage above" value={P.sellStorageCap} onChange={(v) => setP({ sellStorageCap: v })} options={[0.7, 0.8, 0.85, 0.9, 0.95].map((v) => ({ v, label: `${Math.round(v * 100)}% full` }))} />}
        </Policy>

        <Policy title="Irrigation level" info="Irrigated fields are topped up every hour to this soil moisture. Higher means safer yields but a bigger water bill; regions with water caps may not reach it."
          who="Automatic on irrigated fields — no manager needed.">
          <Seg label="Irrigate to" value={P.irrigateMin} onChange={(v) => setP({ irrigateMin: v })} options={[0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((v) => ({ v, label: `${v * 100}%` }))} />
        </Policy>

        {has(s, 'agAI') ? (
          <Policy title="Debt ceiling" info="Daily: while debt is above this share of total assets, up to half of the cash above the reserve goes to repaying loans early."
            who="Agricultural AI, company-wide.">
            <Seg label="Debt ceiling" value={P.debtCeiling} onChange={(v) => setP({ debtCeiling: v })} options={[{ v: 0, label: 'Off' }, ...[0.2, 0.3, 0.4, 0.5, 0.6].map((v) => ({ v, label: `${v * 100}%` }))]} />
          </Policy>
        ) : <p className="muted small">Debt ceiling policy unlocks with Agricultural AI research.</p>}

        {execOn(s, 'trading') ? (
          <Policy title="Hedging" info="Daily: your head of trading keeps a 30-day short futures position covering this share of the crop output your plans are expected to produce. Locks in prices — you give up gains if prices rise, and margin calls need cash."
            who="Head of commodity trading.">
            <Seg label="Hedge ratio" value={P.hedgeRatio} onChange={(v) => setP({ hedgeRatio: v })} options={[{ v: 0, label: 'Off' }, ...[0.25, 0.5, 0.75].map((v) => ({ v, label: `${v * 100}%` }))]} />
          </Policy>
        ) : s.era >= 7 ? <p className="muted small">Hedging policy needs a head of commodity trading (Corporation page).</p> : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- rules

const METRICS: { v: RuleMetric; label: string; unit: string }[] = [
  { v: 'price', label: 'Price of', unit: '$' },
  { v: 'inventory', label: 'Stock of', unit: 'units' },
  { v: 'cash', label: 'Cash', unit: '$' },
  { v: 'storageUtil', label: 'Dry storage used', unit: '%' },
  { v: 'minFertility', label: 'Lowest field fertility', unit: '%' },
  { v: 'minCondition', label: 'Lowest machine condition', unit: '%' },
  { v: 'facilityMargin', label: 'Factory margin', unit: '$/h' },
];
const ACTIONS: { v: RuleAction; label: string; minEra?: number }[] = [
  { v: 'sell', label: 'Sell' },
  { v: 'buy', label: 'Buy' },
  { v: 'fertilizeLow', label: 'Fertilise low fields' },
  { v: 'repairAll', label: 'Repair machines' },
  { v: 'pauseFacilities', label: 'Pause factories', minEra: 4 },
  { v: 'resumeFacilities', label: 'Resume factories', minEra: 4 },
  { v: 'ship', label: 'Ship to', minEra: 6 },
  { v: 'setPlan', label: 'Plan crop' },
];
const needsGood = (m: RuleMetric) => m === 'price' || m === 'inventory';

/** Goods that exist for this player right now. */
const goodsFor = (s: GameState) => GOOD_IDS.filter((g) => {
  const k = GOODS[g].kind;
  return k === 'input' || (k === 'crop' ? s.unlockedCrops.includes(g as CropId) : s.era >= 4 || (s.stats.produced[g] ?? 0) > 0 || s.regions.heartland.inventory[g] > 0);
});
const factoryTypes = (s: GameState) => BUILDING_TYPES.filter((t) => BUILDINGS[t].recipe && s.era >= BUILDINGS[t].minEra);

function describe(r: Draft) {
  const cond = `${metricLabel(r)}${r.metric === 'cash' ? '' : ` in ${REGIONS[r.region].name}`} ${r.op} ${num(r.value, 2)}`;
  const g = GOODS[r.actionGood].name.toLowerCase();
  const act = {
    sell: `sell ${r.amountPct}% of ${g}`, buy: `buy ${num(r.amountPct)} ${g}`, fertilizeLow: 'fertilise fallow fields under 60% fertility',
    repairAll: 'service machines below 60% or broken', pauseFacilities: `pause ${r.buildingType ? BUILDINGS[r.buildingType].name.toLowerCase() + 's' : 'all factories'}`,
    resumeFacilities: `resume ${r.buildingType ? BUILDINGS[r.buildingType].name.toLowerCase() + 's' : 'all factories'}`, ship: `ship ${r.amountPct}% of ${g} to ${REGIONS[r.actionRegion].name}`, setPlan: `plan ${g} on every suitable field`,
  }[r.action];
  return { cond, act };
}

function Rules({ s }: { s: GameState }) {
  const [editing, setEditing] = useState<{ id: number | null; d: Draft } | null>(null);
  const rules = [...s.automation.rules].sort((a, b) => b.priority - a.priority);
  const r0: RegionId = 'heartland';
  const blank: Draft = { name: '', enabled: true, metric: 'price', region: r0, good: 'wheat', op: '>', value: 0, action: 'sell', actionGood: 'wheat', actionRegion: r0, amountPct: 25, priority: 5, maxSpend: 0, cooldown: 24 };
  const templates: { label: string; d: Draft; show: boolean }[] = [
    { label: 'Sell wheat when price > 30-day avg + 10%', show: true,
      d: { ...blank, name: 'Sell wheat on strength', value: +(avg30(s, r0, 'wheat') * 1.1).toFixed(2), amountPct: 50 } },
    { label: 'Repair machines below 60%', show: true,
      d: { ...blank, name: 'Keep machines serviced', metric: 'minCondition', op: '<', value: 60, action: 'repairAll', cooldown: 6, priority: 8 } },
    { label: 'Buy fertiliser when stock < 500', show: true,
      d: { ...blank, name: 'Restock fertiliser', metric: 'inventory', good: 'fertilizer', op: '<', value: 500, action: 'buy', actionGood: 'fertilizer', amountPct: 1000, maxSpend: 5000 } },
    { label: 'Pause factories when margin < 0', show: s.era >= 4,
      d: { ...blank, name: 'Stop losing factories', metric: 'facilityMargin', op: '<', value: 0, action: 'pauseFacilities', cooldown: 12, priority: 6 } },
  ];
  return (
    <>
      <Card title={`Rules (${rules.length}/40)`} info="Rules are checked every hour. Enabled rules run from highest to lowest priority, so when two rules compete for the same stock or cash the higher one wins. After running, a rule waits out its cooldown."
        actions={<button className="btn primary sm" onClick={() => setEditing({ id: null, d: blank })}>New rule</button>}>
        <div className="stack">
          <div className="row wrap">
            <span className="small muted">Templates:</span>
            {templates.filter((t) => t.show).map((t) => <button key={t.label} className="btn ghost sm" onClick={() => act({ type: 'addRule', rule: t.d }, 'Rule added.')}>+ {t.label}</button>)}
          </div>
          {!rules.length && <p className="muted">No rules yet. Start from a template or build one: IF a condition is true THEN take an action.</p>}
          {rules.map((r) => <RuleRow key={r.id} s={s} r={r} onEdit={() => setEditing({ id: r.id, d: { ...r } })} />)}
        </div>
      </Card>
      {editing && <Builder s={s} init={editing.d} id={editing.id} onDone={() => setEditing(null)} />}
    </>
  );
}

function RuleRow({ s, r, onEdit }: { s: GameState; r: Rule; onEdit: () => void }) {
  const { cond, act: what } = describe(r);
  const v = metricValue(s, r);
  const met = r.op === '>' ? v > r.value : v < r.value;
  const ran = Number.isFinite(r.lastRun) && r.lastRun !== null; // -Infinity becomes null after a save
  const cooling = ran && s.tick - r.lastRun < r.cooldown;
  return (
    <div className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, opacity: r.enabled ? 1 : 0.6 }}>
      <div className="row between wrap">
        <div className="row wrap">
          <span className="pill">P{r.priority}</span>
          <b>{r.name || 'Untitled rule'}</b>
          {!r.enabled ? <span className="pill">Off</span> : cooling ? <span className="pill warn">Cooldown {r.cooldown - (s.tick - r.lastRun)}h</span> : met ? <span className="pill good">Condition met</span> : <span className="pill">Waiting</span>}
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => act({ type: 'updateRule', ruleId: r.id, patch: { enabled: !r.enabled } })}>{r.enabled ? 'Disable' : 'Enable'}</button>
          <button className="btn ghost sm" onClick={onEdit}>Edit</button>
          <Confirm label="Delete" className="btn danger sm" title="Delete rule?" body={`"${r.name || 'Untitled rule'}" and its history will be removed.`} confirmLabel="Delete" onConfirm={() => act({ type: 'deleteRule', ruleId: r.id })} />
        </div>
      </div>
      <span className="small">IF {cond} <span className="muted">(now {num(v, 2)})</span> THEN {what}{r.maxSpend ? ` · max ${money(r.maxSpend)}` : ''} · cooldown {r.cooldown}h</span>
      <span className="small muted">Last ran: {ran ? stamp(r.lastRun) : 'never'}</span>
      {r.history.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Why did this run? ({r.history.length})</summary>
          <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {r.history.map((h, i) => <li key={i}><span className="mono">{stamp(h.tick)}</span> — {h.note}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function Builder({ s, init, id, onDone }: { s: GameState; init: Draft; id: number | null; onDone: () => void }) {
  const [d, setD] = useState<Draft>(init);
  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const regions = regionOptions(s);
  const goods = goodsFor(s);
  const tradeable = goods.filter((g) => TRADEABLE.includes(g));
  const buyable = tradeable.filter((g) => GOODS[g].kind === 'input' || s.era >= 5);
  const actions = ACTIONS.filter((a) => s.era >= (a.minEra ?? 0) && (a.v !== 'ship' || regions.length > 1));
  const actionGoods = d.action === 'setPlan' ? s.unlockedCrops : d.action === 'buy' ? buyable : tradeable;
  const metric = METRICS.find((m) => m.v === d.metric)!;
  const live = metricValue(s, { ...d, id: 0, lastRun: 0, history: [] });
  const goodOpts = (gs: readonly GoodId[]) => gs.map((g) => ({ v: g, label: GOODS[g].name }));
  const save = () => {
    const rule: Draft = { ...d, name: d.name.trim() || describe(d).act, actionGood: actionGoods.includes(d.actionGood as CropId) ? d.actionGood : actionGoods[0] };
    if (id === null ? act({ type: 'addRule', rule }, 'Rule added.') : act({ type: 'updateRule', ruleId: id, patch: rule }, 'Rule updated.')) onDone();
  };
  const usesGood = ['sell', 'buy', 'ship', 'setPlan'].includes(d.action);
  return (
    <Card title={id === null ? 'New rule' : 'Edit rule'} actions={<><button className="btn ghost sm" onClick={onDone}>Cancel</button><button className="btn primary sm" onClick={save}>{id === null ? 'Add rule' : 'Save'}</button></>}>
      <div className="stack">
        <input className="input" aria-label="Rule name" placeholder="Name (optional)" value={d.name} onChange={(e) => up({ name: e.target.value })} />
        <div className="row wrap">
          <b>IF</b>
          <Select label="Metric" value={d.metric} onChange={(v) => up({ metric: v })} options={METRICS.map((m) => ({ v: m.v, label: m.label }))} />
          {needsGood(d.metric) && <Select label="Good" value={d.good} onChange={(v) => up({ good: v })} options={goodOpts(d.metric === 'price' ? tradeable : goods)} />}
          {d.metric !== 'cash' && regions.length > 1 && <><span className="muted">in</span><Select label="Region" value={d.region} onChange={(v) => up({ region: v })} options={regions} /></>}
          <Seg label="Comparison" value={d.op} onChange={(v) => up({ op: v })} options={[{ v: '>', label: '>' }, { v: '<', label: '<' }]} />
          <NumberInput label="Threshold" value={d.value} step={1} onChange={(v) => up({ value: v })} />
          <span className="small muted">{metric.unit} · now <b className="mono">{num(live, 2)}</b>{d.metric === 'price' && <> · 30-day avg {num(avg30(s, d.region, d.good), 2)}</>}</span>
        </div>
        <div className="row wrap">
          <b>THEN</b>
          <Select label="Action" value={d.action} onChange={(v) => up({ action: v })} options={actions.map((a) => ({ v: a.v, label: a.label }))} />
          {d.action === 'ship' && <Select label="Destination" value={d.actionRegion} onChange={(v) => up({ actionRegion: v })} options={regions.filter((o) => o.v !== d.region)} />}
          {usesGood && <Select label="Action good" value={(actionGoods as GoodId[]).includes(d.actionGood) ? d.actionGood : actionGoods[0]} onChange={(v) => up({ actionGood: v })} options={goodOpts(actionGoods)} />}
          {(d.action === 'sell' || d.action === 'ship') && <><NumberInput label="Percent of stock" value={d.amountPct} min={1} max={100} onChange={(v) => up({ amountPct: v })} width={70} /><span className="small muted">% of stock</span></>}
          {d.action === 'buy' && <><NumberInput label="Units to buy" value={d.amountPct} min={1} step={100} onChange={(v) => up({ amountPct: v })} /><span className="small muted">units</span></>}
          {(d.action === 'pauseFacilities' || d.action === 'resumeFacilities') && (
            <Select label="Building type" value={(d.buildingType ?? '') as BuildingType | ''} onChange={(v) => up({ buildingType: v || undefined })}
              options={[{ v: '' as const, label: 'All factories' }, ...factoryTypes(s).map((t) => ({ v: t as BuildingType | '', label: BUILDINGS[t].name }))]} />
          )}
        </div>
        <div className="row wrap">
          <span className="small muted">Priority<Info text="Higher priority rules run first each hour; ties keep creation order." /></span>
          <NumberInput label="Priority" value={d.priority} min={0} max={99} onChange={(v) => up({ priority: Math.round(v) })} width={60} />
          <span className="small muted">Max spend $<Info text="Cap on what one run may spend (buy, repair, ship). 0 = no cap; the cash reserve always applies." /></span>
          <NumberInput label="Max spend" value={d.maxSpend} step={500} onChange={(v) => up({ maxSpend: v })} width={90} />
          <span className="small muted">Cooldown h<Info text="Hours to wait after running before the rule may fire again. 0 runs it every hour the condition holds." /></span>
          <NumberInput label="Cooldown hours" value={d.cooldown} onChange={(v) => up({ cooldown: Math.round(v) })} width={60} />
        </div>
        <p className="explain">IF {describe(d).cond} THEN {describe(d).act}.</p>
      </div>
    </Card>
  );
}
