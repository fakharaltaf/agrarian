import { BUILDINGS, COWS_PER_DAIRY_BATCH, CROPS, GOODS, REGIONS, type BuildingType, type GoodId, type RegionId, TECH } from '../../simulation/config';
import { electricityPrice, factoryCrop, has, levelMult, priceUsd, sumBooks } from '../../simulation/core';
import { buildingPrice, expectedYield } from '../../simulation/engine';
import { buildingMargin, solarOutput } from '../../simulation/processing';
import type { Building, GameState } from '../../simulation/types';
import { act, go, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Bar, Card, Confirm, Empty, Info, Kpi, PageHead, Select, Swatch, usePref } from '../ui';
import { regionOptions, unlockedRegions } from './shared';

const FACTORY_CATS = ['processing', 'energy', 'commerce'];
const isFactory = (t: BuildingType) => FACTORY_CATS.includes(BUILDINGS[t].category);
const ins = (t: BuildingType) => Object.entries(BUILDINGS[t].recipe?.inputs ?? {}) as [GoodId, number][];
const outs = (t: BuildingType) => Object.entries(BUILDINGS[t].recipe?.outputs ?? {}) as [GoodId, number][];
// Midpoint sum of the engine's daylight sine curve over 06:00–17:59 ≈ full-sun hours per day.
const SUN_HOURS = Array.from({ length: 12 }, (_, k) => Math.sin(((k + 0.5) / 12) * Math.PI)).reduce((a, x) => a + x, 0);

/** Hourly economics of one building running at full capacity, at today's regional prices. */
function fullEcon(s: GameState, t: BuildingType, r: RegionId) {
  const d = BUILDINGS[t];
  const staff = d.staffPerHour * s.macro.cpi;
  const rec = d.recipe;
  const elec = electricityPrice(s, r);
  if (!rec) {
    const solarDay = (d.solarKw ?? 0) * REGIONS[r].solar * SUN_HOURS;
    return { staff, outVal: 0, inVal: 0, energy: 0, margin: -staff, perBatch: 0, breakEven: NaN, kwhBatch: 0, bph: 0, solarDay, elec };
  }
  const outMult = has(s, 'processEfficiency') ? 1.1 : 1;
  const kwhBatch = rec.kwh * (has(s, 'foodTech') && rec.kwh > 0 ? 0.7 : 1);
  const outB = outs(t).reduce((a, [g, q]) => a + q * outMult * priceUsd(s, r, g), 0) + (kwhBatch < 0 ? -kwhBatch * elec : 0);
  const inB = ins(t).reduce((a, [g, q]) => a + q * priceUsd(s, r, g), 0);
  const enB = Math.max(0, kwhBatch) * elec;
  const perBatch = outB - inB - enB;
  const bph = rec.batchesPerHour;
  return { staff, outVal: outB * bph, inVal: inB * bph, energy: enB * bph, margin: perBatch * bph - staff, perBatch, breakEven: perBatch > 0 ? staff / (perBatch * bph) : Infinity, kwhBatch, bph, solarDay: 0, elec };
}

function recipeText(s: GameState, t: BuildingType) {
  const rec = BUILDINGS[t].recipe;
  if (!rec) return null;
  const outMult = has(s, 'processEfficiency') ? 1.1 : 1;
  const side = (xs: [GoodId, number][], m = 1) => xs.map(([g, q]) => `${num(q * m, q * m % 1 ? 1 : 0)} ${GOODS[g].name.toLowerCase()}`).join(' + ') || 'electricity';
  const kwh = rec.kwh * (has(s, 'foodTech') && rec.kwh > 0 ? 0.7 : 1);
  return `${ins(t).length ? side(ins(t)) : 'electricity'} → ${outs(t).length ? side(outs(t), outMult) : `${num(-kwh)} kWh`}${kwh > 0 ? ` · ${num(kwh, kwh % 1 ? 1 : 0)} kWh` : ''} · ${rec.batchesPerHour} batches/h`;
}

const tone = (n: number) => (n > 0.005 ? 'up' : n < -0.005 ? 'down' : '');

interface Group { key: string; type: BuildingType; region: RegionId; list: Building[]; active: number; util: number; reason: string; outValue: number; inCost: number; opCost: number; margin: number }

function groupsOf(s: GameState): Group[] {
  const map = new Map<string, Group>();
  for (const b of s.buildings) {
    if (!isFactory(b.type)) continue;
    const key = `${b.type}:${b.region}`;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, type: b.type, region: b.region, list: [], active: 0, util: 0, reason: '', outValue: 0, inCost: 0, opCost: 0, margin: 0 }));
    g.list.push(b);
    const d = BUILDINGS[b.type];
    if (b.active) g.active++;
    if (d.recipe) {
      g.outValue += b.stats.outValue;
      g.inCost += b.stats.inCost;
      g.opCost += b.stats.opCost;
      g.margin += buildingMargin(b);
    } else if (b.active) {
      // no recipe: staff is the running cost; solar's value is the power it makes now
      const staff = d.staffPerHour * s.macro.cpi;
      const solar = (d.solarKw ?? 0) * solarOutput(s, b.region) * electricityPrice(s, b.region);
      g.opCost += staff;
      g.outValue += solar;
      g.margin += solar - staff;
    }
  }
  for (const g of map.values()) {
    g.util = g.list.reduce((a, b) => a + b.util, 0) / g.list.length;
    const counts = new Map<string, number>();
    for (const b of g.list) if (b.reason) counts.set(b.reason, (counts.get(b.reason) ?? 0) + 1);
    g.reason = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }
  return [...map.values()];
}

export default function ProductionPage() {
  const s = useGame();
  const groups = groupsOf(s);
  const withRecipe = groups.filter((g) => BUILDINGS[g.type].recipe);
  const marginH = groups.reduce((a, g) => a + g.margin, 0);
  const avgUtil = withRecipe.length ? withRecipe.reduce((a, g) => a + g.util * g.list.length, 0) / withRecipe.reduce((a, g) => a + g.list.length, 0) : 0;
  const elecY = sumBooks(s, 2, ['electricity']) - sumBooks(s, 1, ['electricity']);
  const gridY = sumBooks(s, 2, ['grid']) - sumBooks(s, 1, ['grid']);
  const count = groups.reduce((a, g) => a + g.list.length, 0);

  return (
    <div className="stack l">
      <PageHead title="Production" sub="Turn crops into higher-value goods. A factory pays fixed staff every hour it runs, so it only earns when inputs keep it near capacity." />
      <div className="kpis">
        <Kpi label="Facilities" value={num(count)} sub={`${groups.reduce((a, g) => a + g.active, 0)} running`} />
        <Kpi label="Operating margin" value={`${money(marginH)}/h`} tone={tone(marginH) as 'up' | 'down' | undefined} sub={`${money(marginH * 24)}/day`}
          info="Smoothed hourly output value minus inputs (valued at what you could have sold them for), staff and electricity, summed over all facilities." />
        <Kpi label="Avg utilisation" value={withRecipe.length ? pct0(avgUtil) : '—'} tone={avgUtil < 0.5 && withRecipe.length ? 'warn' : undefined}
          info="Share of rated capacity your factories actually ran, smoothed over roughly the last day." />
        <Kpi label="Electricity yesterday" value={money(-elecY)} sub={gridY ? `grid sales ${money(gridY)}` : undefined} info="Grid electricity bought (and surplus sold back) over the last full day, all regions." />
      </div>
      {groups.length > 0 && <LinesCard s={s} groups={groups} />}
      <div className="grid2">
        <BuildCard s={s} />
        <EnergyCard s={s} elecY={elecY} gridY={gridY} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- build

function BuildCard({ s }: { s: GameState }) {
  const types = (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => isFactory(t) && BUILDINGS[t].minEra <= s.era);
  const [type, setType] = usePref<BuildingType>('prod.build', 'flourMill');
  const t = types.includes(type) ? type : types[0];
  const regions = regionOptions(s);
  const [region, setRegion] = usePref<RegionId>('prod.region', 'heartland');
  const r = s.regions[region]?.unlocked ? region : 'heartland';
  const d = BUILDINGS[t];
  const locked = d.research && !has(s, d.research) ? TECH[d.research].name : null;
  const cost = buildingPrice(s, t, r);
  const e = fullEcon(s, t, r);
  const rt = recipeText(s, t);
  return (
    <Card title="Build a facility" info="Prices are in USD and scale with inflation; Coastal land costs 20% more to build on, Arid and Tropics 15% less.">
      <div className="stack">
        <div className="row wrap">
          <Select label="Facility" value={t} onChange={setType} options={types.map((x) => ({ v: x, label: `${BUILDINGS[x].name}${BUILDINGS[x].research && !has(s, BUILDINGS[x].research!) ? ' (research needed)' : ''}` }))} />
          {regions.length > 1 && <Select label="Region" value={r} onChange={setRegion} options={regions} />}
        </div>
        <p className="explain">{d.blurb}</p>
        {rt && <p className="mono small">{rt}</p>}
        <dl className="facts">
          <dt>Price</dt><dd>{money(cost)}</dd>
          <dt>Staff</dt><dd>{money(e.staff)}/h</dd>
          {d.recipe && <>
            <dt>Output value at capacity</dt><dd>{money(e.outVal)}/h</dd>
            <dt>Inputs at market</dt><dd>−{money(e.inVal)}/h</dd>
            <dt>Electricity ({price(e.elec)}/kWh)</dt><dd>−{money(e.energy)}/h</dd>
            <dt>Margin at full capacity</dt><dd className={tone(e.margin)}>{money(e.margin)}/h · {money(e.margin * 24)}/day</dd>
            <dt>Break-even utilisation <Info text="Utilisation at which the batch margin just pays the staff: staff ÷ (margin per batch × batches per hour)." breakdown={[['Staff', `${money(e.staff)}/h`], ['Margin per batch', money(e.perBatch)], ['Batches per hour', String(e.bph)]]} /></dt>
            <dd className={e.breakEven > 1 ? 'down' : e.breakEven > 0.7 ? 'warn' : ''}>{Number.isFinite(e.breakEven) ? pct0(e.breakEven) : 'never — inputs cost more than outputs'}</dd>
          </>}
          {d.solarKw && <><dt>Generation (clear day)</dt><dd>≈{num(e.solarDay)} kWh/day ≈ {money(e.solarDay * e.elec)}</dd></>}
        </dl>
        {d.recipe && e.breakEven > 1 && <div className="callout bad">At today's {REGIONS[r].name} prices this facility loses money even at full capacity.</div>}
        {t === 'distribution' && <p className="explain">Adds 12% to the price of every processed good you sell in {REGIONS[r].name}. It pays once those sales exceed {money(e.staff / 0.12)}/h.</p>}
        {d.recipe && (has(s, 'processEfficiency') || has(s, 'foodTech')) && (
          <p className="small muted">Included: {[has(s, 'processEfficiency') && 'Process efficiency +10% output', has(s, 'foodTech') && 'Low-energy food tech −30% kWh'].filter(Boolean).join(' · ')}.</p>
        )}
        {locked ? <p className="muted small">Requires research: {locked}.</p> : (
          <Confirm className="btn primary" disabled={cost > s.cash} label={`Build ${d.name.toLowerCase()} · ${money(cost)}`} title={`Build a ${d.name.toLowerCase()}?`} confirmLabel={`Pay ${money(cost)}`}
            body={<>A {d.name.toLowerCase()} in {REGIONS[r].name} costs {money(cost)} and {money(e.staff)}/h in staff while it runs. It depreciates over 20 years; demolishing returns half its book value.</>}
            onConfirm={() => act({ type: 'build', region: r, building: t }, `${d.name} built.`)} />
        )}
        {s.era < 7 && <p className="faint small">Vertical farms unlock in Era 7.</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- facilities

/** Dedicated fields feeding this factory, as a short line: how many, and how their harvest compares with what it uses. */
function supplyOf(s: GameState, g: Group) {
  const c = factoryCrop(g.list[0]);
  if (!c) return null;
  const fields = s.fields.filter((f) => g.list.some((b) => b.id === f.supplies));
  if (!fields.length) return null;
  const grow = fields.reduce((a, f) => a + (expectedYield(s, f, c) * 24) / CROPS[c].growthTicks, 0);
  const need = g.list.reduce((a, b) => a + BUILDINGS[b.type].recipe!.inputs[c]! * BUILDINGS[b.type].recipe!.batchesPerHour * levelMult(b.level) * 24, 0);
  return { c, n: fields.length, grow, need, reserved: g.list.reduce((a, b) => a + b.reserved, 0) };
}

/** Should you build one more of this facility here? A verdict, a short reason, and what one more earns per day. */
function addMore(s: GameState, g: Group): { verdict: 'yes' | 'maybe' | 'no'; why: string; gain: number } | null {
  const rec = BUILDINGS[g.type].recipe;
  if (!rec) return null;
  // a full-speed unit's real result beats the price-sheet estimate (it includes dairy cows, smoothing, actual prices)
  const gain = g.active > 0 && g.util >= 0.85 ? (g.margin * 24) / g.active : fullEcon(s, g.type, g.region).margin * 24;
  if (gain <= 0) return { verdict: 'no', why: 'Loses money at today\'s prices', gain };
  if (g.reason && g.reason !== 'Paused' && g.util < 0.85) return { verdict: 'no', why: `Already ${g.reason.toLowerCase().replace('not enough', 'short of')}`, gain };
  if (g.type === 'dairy') {
    const per = rec.batchesPerHour * COWS_PER_DAIRY_BATCH;
    const spare = s.herds.filter((h) => h.region === g.region && h.animal === 'cows').reduce((a, h) => a + h.count, 0) - g.list.length * per;
    if (spare < per) return { verdict: 'no', why: `Needs ${num(per - Math.max(0, spare))} more cows`, gain };
  }
  const sup = supplyOf(s, g);
  const oneDay = (x: GoodId) => (rec.inputs[x] ?? 0) * rec.batchesPerHour * 24;
  if (sup) {
    const n = Math.floor((sup.grow - sup.need) / oneDay(sup.c));
    return n >= 1 ? { verdict: 'yes', why: `Your fields can feed ${n > 20 ? '20+' : n} more`, gain } : { verdict: 'maybe', why: `Dedicate more ${GOODS[sup.c].name.toLowerCase()} fields first`, gain };
  }
  const [x] = ins(g.type)[0] ?? [];
  if (!x) return { verdict: 'yes', why: 'Needs no inputs', gain };
  const days = s.regions[g.region].inventory[x] / oneDay(x);
  return { verdict: 'maybe', why: `${GOODS[x].name} in stock: ${days >= 1 ? `${num(days)} days` : 'under a day'} for one more`, gain };
}

type Act = { label: string; onClick?: () => void; build?: true; tone?: 'primary' | 'warn' };

/** A line's state, the one-line reason when something is off, and the single next move. */
function lineState(s: GameState, g: Group, groups: Group[]): { dot: 'ok' | 'warn' | 'bad' | 'off'; label: string; note: string; act: Act | null; shortOf: GoodId | null } {
  const d = BUILDINGS[g.type];
  const day = g.margin * 24;
  const pause: Act = { label: `Pause · saves ${money(-day)}/day`, tone: 'warn', onClick: () => g.list.filter((b) => b.active).forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id })) };
  if (g.active === 0) return { dot: 'off', label: 'Paused', note: 'Paused facilities pay no staff.', act: { label: 'Resume', onClick: () => g.list.forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id })) }, shortOf: null };
  if (!d.recipe) return { dot: day < 0 ? 'warn' : 'ok', label: 'Running', note: '', act: null, shortOf: null };
  const rec = d.recipe;
  const inv = s.regions[g.region].inventory;
  if (g.reason === 'Output storage full') return { dot: 'bad', label: 'Storage full', note: 'Nowhere to put what it makes.', act: { label: 'Make room on Storage →', onClick: () => go('storage') }, shortOf: null };
  if (g.reason === 'Not enough cows') return { dot: 'bad', label: 'Not enough cows', note: 'Each dairy milks 120 of your cows.', act: { label: 'Get cows on Livestock →', onClick: () => go('livestock') }, shortOf: null };
  if (g.reason.startsWith('Not enough')) {
    const x = ins(g.type).find(([y, q]) => inv[y] < q * rec.batchesPerHour)?.[0] ?? ins(g.type)[0][0];
    const fromUs = groups.some((p) => p.region === g.region && outs(p.type).some(([o]) => o === x));
    return { dot: 'bad', label: `Short of ${GOODS[x].name.toLowerCase()}`, note: `Running at ${pct0(g.util)} — staff are paid either way.`,
      act: day < 0 ? pause : factoryCrop(g.list[0]) === x ? { label: 'Dedicate fields →', onClick: () => go('fields') } : fromUs ? null : { label: `Buy ${GOODS[x].name.toLowerCase()} →`, onClick: () => go('markets') }, shortOf: x };
  }
  if (day < 0) return { dot: 'bad', label: 'Losing money', note: g.inCost > g.outValue ? 'Its inputs are worth more than what it makes.' : 'Staff & power tip it into a loss.', act: pause, shortOf: null };
  const more = addMore(s, g);
  return { dot: 'ok', label: 'Running well', note: more && more.verdict !== 'yes' ? `Build another? ${more.why}.` : '', act: more?.verdict === 'yes' ? { label: `＋ Build another · +${money(more.gain)}/day`, build: true, tone: 'primary' } : null, shortOf: null };
}

function Chip({ g, top, sub, bad }: { g: GoodId; top: string; sub?: string; bad?: boolean }) {
  return (
    <div className={`pl-chip${bad ? ' bad' : ''}`}>
      <span className="pl-chip-name"><Swatch color={GOODS[g].color} />{GOODS[g].name}</span>
      <span className="mono">{top}</span>
      {sub && <span className="pl-chip-sub">{sub}</span>}
    </div>
  );
}

function LineCard({ s, g, groups }: { s: GameState; g: Group; groups: Group[] }) {
  const d = BUILDINGS[g.type];
  const st = lineState(s, g, groups);
  const day = g.margin * 24;
  const inv = s.regions[g.region].inventory;
  const sup = supplyOf(s, g);
  const perDay = (q: number) => g.list.reduce((a, b) => a + q * (d.recipe?.batchesPerHour ?? 0) * levelMult(b.level) * 24, 0);
  const earn = g.outValue * 24, inC = g.inCost * 24, opC = g.opCost * 24;
  const scale = Math.max(earn, inC + opC, 1);
  const victim = [...g.list].sort((a, b) => Number(a.active) - Number(b.active) || a.util - b.util)[0];
  const refund = Math.round(Math.max(0, victim.cost - victim.depreciated) * 0.5);
  const cost = buildingPrice(s, g.type, g.region);
  const allOn = g.active === g.list.length;
  return (
    <div className={`pl pl-${st.dot}`}>
      <div className="pl-head">
        <div>
          <b>{d.name}</b>{g.list.length > 1 && <span className="muted"> ×{g.list.length}</span>}
          <span className="muted small"> · {REGIONS[g.region].name}</span>
        </div>
        <div className="pl-profit"><span className={`mono ${tone(day)}`}>{day > 0.005 ? '+' : ''}{money(day)}</span><span className="faint small"> /day</span></div>
      </div>

      {d.recipe && (
        <div className="pl-flow">
          <div className="pl-side">
            {ins(g.type).map(([x, q]) => {
              const short = st.shortOf === x;
              const fromMill = groups.some((p) => p.region === g.region && outs(p.type).some(([o]) => o === x));
              const sub = short ? `only ${num(inv[x])} in stock` : sup && sup.c === x ? `🌾 ${sup.n} field${sup.n === 1 ? '' : 's'} · ${sup.grow >= sup.need * 10 ? '10×+' : `${(sup.grow / sup.need).toFixed(1)}×`} enough` : fromMill ? 'from your mill' : `${num(inv[x])} in stock`;
              return <Chip key={x} g={x} top={`${num(perDay(q))}/day`} sub={sub} bad={short} />;
            })}
          </div>
          <span className={`pl-arrow${g.active && g.util > 0.05 ? ' live' : ''}`} aria-hidden>→</span>
          <div className={`pl-plant pl-${st.dot}`}>
            <span className={`pl-dot ${st.dot}`} />
            <b className="small">{st.label}</b>
            <Bar thin value={g.util} label="How busy" color={st.dot === 'ok' ? 'var(--up)' : st.dot === 'off' ? 'var(--faint)' : st.dot === 'warn' ? 'var(--warn)' : 'var(--down)'} />
            <span className="mono small muted">{pct0(g.util)} busy</span>
          </div>
          <span className={`pl-arrow${g.active && g.util > 0.05 ? ' live' : ''}`} aria-hidden>→</span>
          <div className="pl-side">
            {outs(g.type).filter(([x]) => x !== 'manure').map(([x, q]) => (
              <Chip key={x} g={x} top={`${num(perDay(q * (has(s, 'processEfficiency') ? 1.1 : 1)))}/day`} sub={`${price(priceUsd(s, g.region, x))} each`} />
            ))}
          </div>
        </div>
      )}

      {(earn > 0 || opC > 0) && (
        <div className="pl-money">
          <span className="small muted">Earns</span>
          <div className="pl-bar"><div style={{ width: `${(earn / scale) * 100}%`, background: 'var(--up)' }} /></div>
          <span className="mono small">{money(earn)}</span>
          <span className="small muted">Costs</span>
          <div className="pl-bar">
            {inC > 0 && <div title={`Inputs ${money(inC)}`} style={{ width: `${(inC / scale) * 100}%`, background: 'var(--warn)' }} />}
            <div title={`Staff & power ${money(opC)}`} style={{ width: `${(opC / scale) * 100}%`, background: 'var(--down)' }} />
          </div>
          <span className="mono small">{money(inC + opC)}</span>
          <span />
          <span className="pl-legend small faint">{inC > 0 && <><i style={{ background: 'var(--warn)' }} />inputs {money(inC)} </>}<i style={{ background: 'var(--down)' }} />staff &amp; power {money(opC)}</span>
          <span />
        </div>
      )}

      <div className="pl-foot">
        <span className={`small ${st.dot === 'bad' ? 'down' : 'muted'}`}>{st.note}</span>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {g.active > 0 && st.act?.tone !== 'warn' && <button className="btn ghost sm" onClick={() => g.list.filter((b) => b.active === allOn).forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id }))}>Pause</button>}
          <Confirm className="btn ghost sm" label="Demolish" title={`Demolish a ${d.name.toLowerCase()}?`} confirmLabel={`Demolish for ${money(refund)}`}
            body={<>You get back {money(refund)}, half its book value. {g.list.length > 1 ? 'The least-used one goes first.' : ''}</>}
            onConfirm={() => act({ type: 'demolish', buildingId: victim.id }, 'Facility demolished.')} />
          {st.act && (st.act.build
            ? <Confirm className="btn primary sm" disabled={cost > s.cash} label={st.act.label} title={`Build another ${d.name.toLowerCase()}?`} confirmLabel={`Pay ${money(cost)}`}
                body={<>Costs {money(cost)}. At today's prices one more should earn about {st.act.label.split('+')[1]}.</>}
                onConfirm={() => act({ type: 'build', region: g.region, building: g.type }, `${d.name} built.`)} />
            : <button className={`btn sm ${st.act.tone === 'warn' ? 'warn' : ''}`} onClick={st.act.onClick}>{st.act.label}</button>)}
        </div>
      </div>
    </div>
  );
}

function LinesCard({ s, groups }: { s: GameState; groups: Group[] }) {
  // fixed order (name, then region) so cards never trade places as numbers move; colour carries the status
  const rows = [...groups].sort((a, b) => BUILDINGS[a.type].name.localeCompare(BUILDINGS[b.type].name) || a.region.localeCompare(b.region)).map((g) => ({ g }));
  return (
    <Card title="Production lines" info="Each line shows what goes in, how busy the facility is, what comes out, and whether it earns more than it costs. Inputs are valued at what you could have sold them for.">
      <div className="stack">{rows.map(({ g }) => <LineCard key={g.key} s={s} g={g} groups={groups} />)}</div>
    </Card>
  );
}

// ---------------------------------------------------------------- energy

function EnergyCard({ s, elecY, gridY }: { s: GameState; elecY: number; gridY: number }) {
  const regs = unlockedRegions(s);
  const foodTech = has(s, 'foodTech') ? 0.7 : 1;
  const rows = regs.map((r) => {
    const bs = s.buildings.filter((b) => b.region === r && b.active);
    const solar = bs.reduce((a, b) => a + (BUILDINGS[b.type].solarKw ?? 0), 0) * solarOutput(s, r);
    const biogas = bs.filter((b) => b.type === 'biogas').reduce((a, b) => a + b.stats.out * -BUILDINGS.biogas.recipe!.kwh, 0);
    let demand = 0;
    for (const b of bs) {
      const d = BUILDINGS[b.type];
      if (d.coldKwh) demand += d.coldKwh * (has(s, 'coldChain') ? 1.3 : 1);
      if (d.recipe && d.recipe.kwh > 0) demand += b.stats.out * d.recipe.kwh * foodTech;
    }
    return { r, price: electricityPrice(s, r), solar, biogas, demand, n: bs.length };
  }).filter((x) => x.n > 0);
  return (
    <Card title="Energy" info="Each region settles power every hour: your own solar and biogas generation covers your demand first, the shortfall is bought from the grid, and any surplus is sold to the grid at half the retail price.">
      <div className="stack">
        <dl className="facts">
          <dt>Grid electricity bought yesterday</dt><dd>{money(-elecY)}</dd>
          <dt>Surplus sold to grid yesterday</dt><dd className={gridY > 0 ? 'up' : ''}>{money(gridY)}</dd>
        </dl>
        {rows.length ? (
          <div className="table-wrap scroll">
            <table className="t">
              <thead><tr><th>Region</th><th className="r">Price</th><th className="r">Demand now</th><th className="r">Solar now</th><th className="r">Biogas</th><th className="r">Net cost/h</th></tr></thead>
              <tbody>
                {rows.map((x) => {
                  const net = x.demand - x.solar - x.biogas;
                  const cost = net > 0 ? net * x.price : net * x.price * 0.5;
                  return (
                    <tr key={x.r}>
                      <td>{REGIONS[x.r].name}</td>
                      <td className="r mono">{price(x.price)}/kWh</td>
                      <td className="r mono">{num(x.demand)} kWh</td>
                      <td className="r mono">{num(x.solar)} kWh</td>
                      <td className="r mono">{num(x.biogas)} kWh</td>
                      <td className={`r mono ${cost > 0 ? 'down' : cost < 0 ? 'up' : ''}`}>{cost < 0 ? `+${money(-cost)}` : money(cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>No running facilities yet. Factories, cold stores and labs draw power; solar and biogas plants make it.</Empty>}
        <p className="explain">Demand is estimated from each factory's smoothed batch rate. Solar only generates 06:00–18:00 and less in rain; biogas burns {BUILDINGS.biogas.recipe!.inputs.manure} manure per batch for {-BUILDINGS.biogas.recipe!.kwh} kWh. Precision-irrigation sensors (1 kWh per ha per hour on growing fields), irrigation pumps and greenhouse heating also draw power and appear on the grid bill. Electricity price follows the global energy index{has(s, 'foodTech') ? '; Low-energy food tech already cuts factory use by 30%' : ''}.</p>
        {!has(s, 'solar') && !has(s, 'biogas') && <p className="faint small">Research Solar power or Biogas digestion to generate your own electricity.</p>}
      </div>
    </Card>
  );
}
