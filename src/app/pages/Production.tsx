import { townIndustryFactor } from '../../simulation/town-state';
import type { ReactNode } from 'react';
import { ANIMALS, BUILDINGS, COWS_PER_DAIRY_BATCH, CROPS, GOODS, REGIONS, type BuildingType, type GoodId, type RegionId, TECH } from '../../simulation/config';
import { electricityPrice, factoryCrop, has, levelMult, priceUsd, sumBooks } from '../../simulation/core';
import { buildingPrice, expectedYield } from '../../simulation/engine';
import { buildingMargin, solarOutput } from '../../simulation/processing';
import type { Building, GameState } from '../../simulation/types';
import { act, go, useGame } from '../../stores/game';
import { breakEven, dayPrice, lineEcon, upgradeOutlook } from '../../simulation/lines';
import { portrait } from '../world/portrait';
import { money, num, pct0, price } from '../format';
import { Card, Confirm, Empty, Info, Kpi, PageHead, Select, usePref } from '../ui';
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
  const bph = rec.batchesPerHour * townIndustryFactor(s,r);
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

// ---------------------------------------------------------------- production lines

/** Dedicated fields feeding this factory: how many, and how their harvest compares with what it uses. */
function supplyOf(s: GameState, g: Group) {
  const c = factoryCrop(g.list[0]);
  if (!c) return null;
  const fields = s.fields.filter((f) => g.list.some((b) => b.id === f.supplies));
  if (!fields.length) return null;
  const grow = fields.reduce((a, f) => a + (expectedYield(s, f, c) * 24) / CROPS[c].growthTicks, 0);
  const need = g.list.reduce((a, b) => a + BUILDINGS[b.type].recipe!.inputs[c]! * BUILDINGS[b.type].recipe!.batchesPerHour * levelMult(b.level) * townIndustryFactor(s,b.region) * 24, 0);
  return { c, n: fields.length, grow, need };
}

/** Spare daily supply of a line's main input: dedicated fields' harvest beyond need, or your own mills' output beyond what every line here uses at full speed. Null when nothing of yours makes it. */
function spareOf(s: GameState, g: Group, groups: Group[]): { good: GoodId; spare: number } | null {
  const main = ins(g.type)[0]?.[0];
  if (!main) return null;
  const sup = supplyOf(s, g);
  if (sup && sup.c === main) return { good: main, spare: sup.grow - sup.need };
  const here = groups.filter((x) => x.region === g.region && BUILDINGS[x.type].recipe);
  const day = (x: Group, q: number) => x.list.reduce((a, b) => a + q * BUILDINGS[b.type].recipe!.batchesPerHour * levelMult(b.level) * townIndustryFactor(s,b.region) * 24, 0);
  const made = here.reduce((a, x) => a + day(x, (BUILDINGS[x.type].recipe!.outputs[main] ?? 0) * (has(s, 'processEfficiency') ? 1.1 : 1)), 0);
  if (made <= 0) return null;
  const used = here.reduce((a, x) => a + day(x, BUILDINGS[x.type].recipe!.inputs[main] ?? 0), 0);
  // herds eat feed first (cows a dairy milks are already counted in its recipe)
  const milked = here.filter((x) => x.type === 'dairy').reduce((a, x) => a + x.list.reduce((c, b) => c + (b.active ? b.stats.out * COWS_PER_DAIRY_BATCH : 0), 0), 0);
  const herds = main === 'feed' ? s.herds.filter((h) => h.region === g.region).reduce((a, h) => a + Math.max(0, h.count - (h.animal === 'cows' ? milked : 0)) * ANIMALS[h.animal].feedPerDay, 0) : 0;
  return { good: main, spare: made - used - herds };
}

const extraNeed = (s: GameState, g: Group, levels: number) => {
  if (g.type === 'dairy') return 0; // its cows move in from the cowshed and eat the same feed there
  const rec = BUILDINGS[g.type].recipe!;
  const q = Object.values(rec.inputs)[0] ?? 0;
  return g.list.filter((b) => b.active && (b.level || 1) < 3).reduce((a, b) => a + q * rec.batchesPerHour * townIndustryFactor(s,g.region) * 24 * (levelMult(Math.min(3, (b.level || 1) + levels)) - levelMult(b.level)), 0);
};

/** Is one more of these worth building? The gain is what one running unit is worth today. */
function addMore(s: GameState, g: Group, groups: Group[], worth: number): { ok: boolean; why: string; gain: number } {
  const rec = BUILDINGS[g.type].recipe!;
  const gain = g.active > 0 ? worth / g.active : lineEcon(s, g.list.slice(0, 1), true).worth;
  if (gain <= 0) return { ok: false, why: 'Not while it loses money', gain };
  if (g.reason && g.reason !== 'Paused' && g.util < 0.85) return { ok: false, why: `Not while it's ${g.reason.toLowerCase().replace('not enough', 'short of')}`, gain };
  if (g.type === 'dairy') {
    const per = rec.batchesPerHour * townIndustryFactor(s,g.region) * COWS_PER_DAIRY_BATCH;
    const cows = s.herds.filter((h) => h.region === g.region && h.animal === 'cows').reduce((a, h) => a + h.count, 0);
    if (cows - g.list.reduce((a, b) => a + per * levelMult(b.level), 0) < per) return { ok: false, why: `Needs ${num(per)} more cows than you have spare`, gain };
  }
  if (g.type === 'dairy') return { ok: true, why: 'You have the cows for it, and they eat the same feed either way', gain };
  const sp = spareOf(s, g, groups);
  const one = (Object.values(rec.inputs)[0] ?? 0) * rec.batchesPerHour * townIndustryFactor(s,g.region) * 24;
  if (!sp) return { ok: false, why: `Nothing of yours makes its ${lower(ins(g.type))} — you'd be buying it`, gain };
  if (sp.spare >= one) return { ok: true, why: `You make enough ${GOODS[sp.good].name.toLowerCase()} for it`, gain };
  return { ok: false, why: factoryCrop(g.list[0]) === sp.good ? `Dedicate more ${GOODS[sp.good].name.toLowerCase()} fields first` : `You'd need ${num(one - Math.max(0, sp.spare))} more ${GOODS[sp.good].name.toLowerCase()} a day`, gain };
}

type Dot = 'ok' | 'bad' | 'off';

function Coin() {
  return <svg className="coin" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="7" /><circle cx="8" cy="8" r="4.6" className="coin-in" /></svg>;
}

function Token({ g, top, sub, bad }: { g: GoodId; top: string; sub?: string; bad?: boolean }) {
  return (
    <div className={`ln-token${bad ? ' bad' : ''}`}>
      <span className="ln-ball" style={{ background: GOODS[g].color }} />
      <span className="ln-token-name">{GOODS[g].name}</span>
      <b className="mono">{top}</b>
      {sub && <span className="ln-token-sub">{sub}</span>}
    </div>
  );
}

function Belt({ live, color }: { live: boolean; color: string }) {
  return <div className={`ln-belt${live ? ' live' : ''}`} aria-hidden>{[0, 1, 2].map((i) => <i key={i} style={{ background: color, animationDelay: `${-i * 0.6}s` }} />)}</div>;
}

function Option({ icon, title, sub, children, good }: { icon: string; title: ReactNode; sub: ReactNode; children?: ReactNode; good?: boolean }) {
  return (
    <div className={`ln-opt${good ? ' good' : ''}`}>
      <span className="ln-opt-icon" aria-hidden>{icon}</span>
      <div className="ln-opt-text"><b>{title}</b><span>{sub}</span></div>
      {children}
    </div>
  );
}

function LineCard({ s, g, groups }: { s: GameState; g: Group; groups: Group[] }) {
  const d = BUILDINGS[g.type];
  const rec = d.recipe;
  const paused = g.active === 0;
  const e = rec ? lineEcon(s, g.list, paused) : null; // paused lines show what they would make flat out
  const worth = e ? e.worth : g.margin * 24;
  const inv = s.regions[g.region].inventory;
  const shortOf = rec && g.reason.startsWith('Not enough') && g.reason !== 'Not enough cows' ? ins(g.type).find(([x, q]) => inv[x] < q * rec.batchesPerHour * townIndustryFactor(s,g.region))?.[0] ?? null : null;
  const dot: Dot = paused ? 'off' : worth < 0 || (g.reason && g.reason !== '' && g.util < 0.85) ? 'bad' : 'ok';
  const label = paused ? 'Paused' : !rec ? 'Running' : g.reason === 'Output storage full' ? 'Storage full' : g.reason === 'Not enough cows' ? 'Short of cows' : shortOf ? `Short of ${GOODS[shortOf].name.toLowerCase()}` : worth < 0 ? 'Losing money' : 'Running well';
  const sup = supplyOf(s, g);
  const perDay = (q: number) => g.list.reduce((a, b) => a + q * (rec?.batchesPerHour ?? 0) * levelMult(b.level) * townIndustryFactor(s,b.region) * 24, 0);
  const live = !paused && g.util > 0.05;
  const targets = e && !paused ? breakEven(s, e, g.region).slice(0, 2) : [];
  const up = e && !paused ? upgradeOutlook(s, g.list) : null;
  const more = e && !paused && worth > 0 ? addMore(s, g, groups, worth) : null;
  const sp = rec && !paused ? spareOf(s, g, groups) : null;
  const upShort = up && !up.blocked && sp && extraNeed(s, g, 1) > Math.max(0, sp.spare) ? `Needs ${num(extraNeed(s, g, 1) - Math.max(0, sp.spare))} more ${GOODS[sp.good].name.toLowerCase()} a day than you make` : undefined;
  const buildCost = buildingPrice(s, g.type, g.region);
  const toggle = (on: boolean) => g.list.filter((b) => b.active !== on).forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id }));
  const upgradeAll = () => g.list.filter((b) => b.active && (b.level || 1) < 3).forEach((b) => act({ type: 'upgradeBuilding', buildingId: b.id }));
  const victim = [...g.list].sort((a, b) => Number(a.active) - Number(b.active) || a.util - b.util)[0];
  const refund = Math.round(Math.max(0, victim.cost - victim.depreciated) * 0.5);
  const img = portrait(g.type);
  const days = (cost: number, gain: number) => (gain > 0 ? `pays back in ${Math.ceil(cost / gain)} days` : '');
  const pauseSaves = e ? -e.worth : -g.margin * 24;

  return (
    <article className={`ln ln-${dot}`}>
      <div className="ln-portrait">
        {img ? <img src={img} alt="" /> : <span className="ln-portrait-fallback">🏭</span>}
        {g.list.length > 1 && <span className="ln-count">×{g.list.length}</span>}
        {g.list.some((b) => (b.level || 1) > 1) && <span className="ln-level">Lv {Math.max(...g.list.map((b) => b.level || 1))}</span>}
      </div>

      <div className="ln-body">
        <header className="ln-head">
          <div><h4>{d.name}</h4><span className="ln-region">{REGIONS[g.region].name}</span></div>
          <div className={`ln-coins ${tone(worth)}`} title={g.type === 'dairy' ? 'Per day, compared with keeping these cows in the cowshed' : 'Profit per day at the current pace'}>
            <Coin /><span className="mono">{worth > 0.005 ? '+' : ''}{money(worth)}</span><small>{paused ? 'a day if running' : 'a day'}</small>
          </div>
        </header>

        {rec && (
          <div className="ln-flow">
            <div className="ln-side in">
              {ins(g.type).map(([x, q]) => {
                const fromMill = groups.some((p) => p.region === g.region && outs(p.type).some(([o]) => o === x));
                const sub = shortOf === x ? `only ${num(inv[x])} left` : sup && sup.c === x ? `🌾 ${sup.n} field${sup.n === 1 ? '' : 's'}` : fromMill ? 'from your mill' : g.type === 'dairy' && x === 'feed' ? 'for your cows' : `${num(inv[x])} in store`;
                return <Token key={x} g={x} top={`${num(perDay(q))}/day`} sub={sub} bad={shortOf === x} />;
              })}
            </div>
            <Belt live={live} color={GOODS[ins(g.type)[0][0]].color} />
            <div className={`ln-puck ${dot}`} style={{ ['--p' as string]: `${Math.round(Math.min(1, g.util) * 100)}` }}>
              <div className="ln-ring"><span className="mono">{pct0(g.util)}</span></div>
              <b>{label}</b>
            </div>
            <Belt live={live} color={GOODS[outs(g.type)[0][0]].color} />
            <div className="ln-side out">
              {outs(g.type).filter(([x]) => x !== 'manure').map(([x, q]) => (
                <Token key={x} g={x} top={`${num(perDay(q * (has(s, 'processEfficiency') ? 1.1 : 1)))}/day`} sub={`${price(dayPrice(s, g.region, x))} each`} />
              ))}
            </div>
          </div>
        )}

        {e && !paused && (
          <div className="ln-money">
            <span className="ln-mlabel">Sells for</span>
            <div className="ln-bar"><div className="earn" style={{ width: `${(e.earn / Math.max(e.earn, e.inputs + e.staff + e.power + e.alt, 1)) * 100}%` }} /></div>
            <span className="mono">{money(e.earn)}</span>
            <span className="ln-mlabel">Costs</span>
            <div className="ln-bar">
              {[['inputs', e.inputs, 'Inputs'], ['staff', e.staff + e.power, 'Staff & power'], ['alt', e.alt, 'What these cows earn in the cowshed']].filter(([, v]) => (v as number) > 0).map(([k, v, l]) => (
                <div key={k as string} className={k as string} title={`${l}: ${money(v as number)}`} style={{ width: `${((v as number) / Math.max(e.earn, e.inputs + e.staff + e.power + e.alt, 1)) * 100}%` }} />
              ))}
            </div>
            <span className="mono">{money(e.inputs + e.staff + e.power + e.alt)}</span>
            <span />
            <span className="ln-legend"><i className="inputs" />inputs {money(e.inputs)} <i className="staff" />staff &amp; power {money(e.staff + e.power)}{e.alt > 0 && <> <i className="alt" />what the cows earn in the cowshed {money(e.alt)}</>}</span>
            <span />
          </div>
        )}

        {/* the player's next moves */}
        <div className="ln-opts">
          {paused && <Option icon="▶" title="Paused — paying no staff" sub={e && e.worth > 0 ? `Flat out it would make ${money(e.worth)} a day at today's prices` : 'Flat out it would still lose money at today\'s prices'}>
            <button className={`btn sm ${e && e.worth > 0 ? 'primary' : 'ghost'}`} onClick={() => toggle(true)}>Resume</button></Option>}

          {!paused && g.reason === 'Output storage full' && <Option icon="📦" title="Storage is full" sub="It stops when there's nowhere to put what it makes."><button className="btn sm" onClick={() => go('storage')}>Storage →</button></Option>}
          {!paused && g.reason === 'Not enough cows' && <Option icon="🐄" title="Not enough cows" sub="Each dairy milks up to 120 of your cows."><button className="btn sm" onClick={() => go('livestock')}>Livestock →</button></Option>}
          {!paused && shortOf && <Option icon="🌾" title={`Short of ${GOODS[shortOf].name.toLowerCase()}`} sub={`It needs ${num(perDay(rec!.inputs[shortOf]!))} a day; staff are paid either way.`}>
            <button className="btn sm" onClick={() => go(factoryCrop(g.list[0]) === shortOf ? 'fields' : 'markets')}>{factoryCrop(g.list[0]) === shortOf ? 'Dedicate fields →' : 'Markets →'}</button></Option>}

          {targets.length > 0 && <div className="ln-targets">
            <span className="ln-kicker">To break even, any one of</span>
            {targets.map((x) => (
              <div key={x.good} className="ln-target">
                <span className="ln-ball" style={{ background: GOODS[x.good].color }} />
                <span>{GOODS[x.good].name} {x.side === 'sell' ? 'sells for' : 'costs'} <b className="mono">{x.side === 'sell' ? '≥' : '≤'} {price(x.need)}</b></span>
                <div className="ln-gauge" title={`now ${price(x.now)}`}><div style={{ width: `${Math.min(100, (x.side === 'sell' ? x.now / x.need : x.need / x.now) * 100)}%` }} /></div>
                <span className="mono small muted">now {price(x.now)} · {x.change > 0 ? '+' : ''}{Math.round(x.change * 100)}%</span>
              </div>
            ))}
          </div>}

          {up && (up.gain > 0 || up.blocked) && <Option icon="⬆" good={!up.blocked && !upShort && up.worthAfter > 0}
            title={`Upgrade to level ${up.level} · ${money(up.cost)}`}
            sub={up.blocked ?? upShort ?? `${up.worthAfter >= 0 ? `Then makes ${money(up.worthAfter)} a day` : `Still loses ${money(-up.worthAfter)} a day`} (+${money(up.gain)}) · ${days(up.cost, up.gain)}`}>
            {!up.blocked && !upShort && up.gain > 0 && <Confirm className={`btn sm ${up.worthAfter > 0 ? 'primary' : 'ghost'}`} disabled={up.cost > s.cash} label="Upgrade" title={`Upgrade ${d.name.toLowerCase()} to level ${up.level}?`} confirmLabel={`Pay ${money(up.cost)}`}
              body={<>Costs {money(up.cost)}. More capacity, and 30% more staff per level. At today's prices it should then make {money(up.worthAfter)} a day.</>} onConfirm={upgradeAll} />}
          </Option>}

          {more && <Option icon="＋" good={more.ok} title={`Build another · ${money(buildCost)}`} sub={more.ok ? `About +${money(more.gain)} a day · ${days(buildCost, more.gain)}` : more.why}>
            {more.ok && <Confirm className="btn sm primary" disabled={buildCost > s.cash} label="Build" title={`Build another ${d.name.toLowerCase()}?`} confirmLabel={`Pay ${money(buildCost)}`}
              body={<>Costs {money(buildCost)}. At today's prices one more should make about {money(more.gain)} a day. Extra output lowers its price a little.</>}
              onConfirm={() => act({ type: 'build', region: g.region, building: g.type }, `${d.name} built.`)} />}
          </Option>}

          {!paused && worth < 0 && <Option icon="⏸" title={`Pause it · saves ${money(pauseSaves)} a day`} sub={g.type === 'dairy' ? 'Its cows go back to the cowshed and keep giving milk.' : `The ${lower(ins(g.type))} gets sold instead.`}>
            <button className="btn sm warn" onClick={() => toggle(false)}>Pause</button></Option>}
        </div>

        <footer className="ln-foot">
          {!paused && worth >= 0 && <button className="btn ghost xs" onClick={() => toggle(false)}>Pause</button>}
          <Confirm className="btn ghost xs" label="Demolish" title={`Demolish a ${d.name.toLowerCase()}?`} confirmLabel={`Demolish for ${money(refund)}`}
            body={<>You get back {money(refund)}, half its book value. {g.list.length > 1 ? 'The least-used one goes first.' : ''}</>}
            onConfirm={() => act({ type: 'demolish', buildingId: victim.id }, 'Facility demolished.')} />
        </footer>
      </div>
    </article>
  );
}

const lower = (xs: [GoodId, number][]) => xs.filter(([x]) => x !== 'manure').map(([x]) => GOODS[x].name.toLowerCase()).join(' and ');

function LinesCard({ s, groups }: { s: GameState; groups: Group[] }) {
  // fixed order (name, then region) so lines never trade places as numbers move; colour carries the status
  const rows = [...groups].sort((a, b) => BUILDINGS[a.type].name.localeCompare(BUILDINGS[b.type].name) || a.region.localeCompare(b.region));
  return (
    <Card title="Production lines" info="Each line shows what goes in, how busy it is, what comes out and what it earns a day at today's prices (inputs valued at what you could sell them for). Losing lines show the prices they need to break even.">
      <div className="ln-list">{rows.map((g) => <LineCard key={g.key} s={s} g={g} groups={groups} />)}</div>
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
