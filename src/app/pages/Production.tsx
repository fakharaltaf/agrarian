import { useMemo, useState, type ReactNode } from 'react';
import { BUILDINGS, CROPS, GOODS, REGIONS, type BuildingType, type GoodId, type RegionId, TECH } from '../../simulation/config';
import { electricityPrice, factoryCrop, has, levelMult, priceUsd, stored, sumBooks } from '../../simulation/core';
import { buildingPrice, expectedYield } from '../../simulation/engine';
import { buildingMargin, solarOutput } from '../../simulation/processing';
import type { Building, GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Bar, Card, Confirm, Empty, Info, Kpi, PageHead, Select, Table, usePref, type Col } from '../ui';
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
const statusOf = (util: number, paused: boolean, reason: string) => (paused ? 'warn' : util >= 0.85 || !reason ? 'ok' : util >= 0.5 ? 'warn' : 'bad');

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
      {groups.length > 0 && <ChainCard s={s} groups={groups} />}
      {groups.length > 0 && <FacilitiesCard s={s} groups={groups} />}
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

/** Dedicated fields feeding this factory: how much land, what they grow per day vs what it uses, and stock held for it. */
function SupplyNote({ s, g }: { s: GameState; g: Group }) {
  const c = factoryCrop(g.list[0]);
  if (!c) return null;
  const fields = s.fields.filter((f) => g.list.some((b) => b.id === f.supplies));
  const reserved = g.list.reduce((a, b) => a + b.reserved, 0);
  if (!fields.length && reserved < 1) return <div className="small faint">No dedicated fields</div>;
  const grow = fields.reduce((a, f) => a + (expectedYield(s, f, c) * 24) / CROPS[c].growthTicks, 0);
  const need = g.list.reduce((a, b) => a + BUILDINGS[b.type].recipe!.inputs[c]! * BUILDINGS[b.type].recipe!.batchesPerHour * levelMult(b.level) * 24, 0);
  return <div className="small" title="Fields dedicated to this factory, their expected harvest per day against what it uses at full capacity, and stock reserved for it">
    🌾 {fields.length} field{fields.length === 1 ? '' : 's'} · ~{num(grow)}/day of {num(need)} needed{reserved >= 1 && <> · 🏭 {num(reserved)} reserved</>}
  </div>;
}

function FacilitiesCard({ s, groups }: { s: GameState; groups: Group[] }) {
  const cols: Col<Group>[] = [
    { key: 'name', label: 'Facility', sort: (g) => BUILDINGS[g.type].name, render: (g) => <div><b>{BUILDINGS[g.type].name}</b>{g.list.length > 1 && <span className="muted"> ×{g.list.length}</span>}<div className="muted small">{REGIONS[g.region].name}</div><SupplyNote s={s} g={g} /></div> },
    { key: 'state', label: 'Running', render: (g) => <span className={`pill ${g.active === g.list.length ? 'good' : g.active ? 'warn' : ''}`}>{g.active === g.list.length ? 'Active' : g.active ? `${g.active}/${g.list.length} active` : 'Paused'}</span> },
    { key: 'util', label: 'Utilisation', sort: (g) => g.util, width: 130, render: (g) => BUILDINGS[g.type].recipe ? <div className="stack s"><span className="mono small">{pct0(g.util)}</span><Bar thin value={g.util} label="Utilisation" color={g.util >= 0.85 ? 'var(--up)' : g.util >= 0.5 ? 'var(--warn)' : 'var(--down)'} /></div> : <span className="faint">—</span> },
    { key: 'reason', label: 'Bottleneck', render: (g) => g.reason ? <span className={g.reason === 'Paused' ? 'muted' : 'warn'}>{g.reason}</span> : BUILDINGS[g.type].recipe ? <span className="up">At capacity</span> : <span className="faint">—</span> },
    { key: 'out', label: 'Output/h', align: 'r', sort: (g) => g.outValue, render: (g) => <span className="mono">{money(g.outValue)}</span> },
    { key: 'in', label: 'Inputs/h', align: 'r', sort: (g) => g.inCost, render: (g) => <span className="mono">−{money(g.inCost)}</span> },
    { key: 'op', label: 'Staff+power/h', align: 'r', sort: (g) => g.opCost, render: (g) => <span className="mono">−{money(g.opCost)}</span> },
    { key: 'margin', label: 'Margin/h', align: 'r', sort: (g) => g.margin, render: (g) => <span className={`mono ${tone(g.margin)}`}>{money(g.margin)}</span> },
    { key: 'day', label: 'Per day', align: 'r', sort: (g) => g.margin, render: (g) => <span className={`mono ${tone(g.margin)}`}>{money(g.margin * 24)}</span> },
    { key: 'act', label: '', render: (g) => {
      const allOn = g.active === g.list.length;
      const victim = [...g.list].sort((a, b) => Number(a.active) - Number(b.active) || a.util - b.util)[0];
      const refund = Math.round(Math.max(0, victim.cost - victim.depreciated) * 0.5);
      return (
        <div className="row">
          <button className="btn ghost sm" onClick={() => g.list.filter((b) => b.active === allOn).forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id }))}>{allOn ? (g.list.length > 1 ? 'Pause all' : 'Pause') : (g.list.length > 1 ? 'Resume all' : 'Resume')}</button>
          <Confirm className="btn danger sm" label="Demolish" title={`Demolish a ${BUILDINGS[g.type].name.toLowerCase()}?`} confirmLabel={`Demolish for ${money(refund)}`}
            body={<>You recover 50% of its book value: {money(refund)} (book {money(victim.cost - victim.depreciated)}). {g.list.length > 1 ? 'The least-used one in this group goes first.' : ''}</>}
            onConfirm={() => act({ type: 'demolish', buildingId: victim.id }, 'Facility demolished.')} />
        </div>
      );
    } },
  ];
  return (
    <Card title="Facilities" info="Grouped by type and region. Economics are smoothed per-hour figures from the simulation; inputs are valued at today's market price — what you gave up by not selling them. Paused facilities pay no staff.">
      <Table rows={groups} cols={cols} rowKey={(g) => g.key} initialSort={{ key: 'margin', dir: -1 }} search={(g) => `${BUILDINGS[g.type].name} ${REGIONS[g.region].name}`} />
      {s.era >= 4 && <p className="small muted" style={{ marginTop: 8 }}>Tip: a factory below its break-even utilisation loses money every hour it runs. Pause it until inputs are back.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- chain

const DEPTH: Partial<Record<BuildingType, number>> = { flourMill: 2, feedMill: 2, oilPress: 2, sugarMill: 2, verticalFarm: 2, solar: 2, distribution: 5, bakery: 3, ranch: 3, dairy: 3, creamery: 4, biogas: 4 };
const NW = 168, NH = 84, CG = 46, RG = 16;

interface ChainNode { id: string; title: string; lines: string[]; status: 'ok' | 'warn' | 'bad'; col: number; group?: Group }

function ChainCard({ s, groups }: { s: GameState; groups: Group[] }) {
  const regs = unlockedRegions(s).filter((r) => groups.some((g) => g.region === r));
  const [pref, setPref] = usePref<RegionId>('prod.chain', 'heartland');
  const r = regs.includes(pref) ? pref : regs[0];
  const [sel, setSel] = useState<string | null>(null);
  const inv = s.regions[r].inventory;
  const here = groups.filter((g) => g.region === r);
  const has_ = (t: BuildingType) => here.some((g) => g.type === t);

  const cropDay = useMemo(() => {
    const out: Partial<Record<GoodId, number>> = {};
    for (const f of s.fields) if (f.region === r && f.crop) out[f.crop] = (out[f.crop] ?? 0) + (expectedYield(s, f, f.crop) / CROPS[f.crop].growthTicks) * 24;
    return out;
  }, [s.tick, r]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = stored(s, r);
  const fill = st.cap.dry ? st.dry / st.cap.dry : 1;
  const nodes: ChainNode[] = [];
  const cropTotal = Object.values(cropDay).reduce((a, x) => a + x!, 0);
  const topCrops = (Object.entries(cropDay) as [GoodId, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  nodes.push({ id: 'fields', title: 'Fields', col: 0, status: cropTotal > 0 ? 'ok' : 'warn', lines: [cropTotal ? `≈${num(cropTotal)} units/day` : 'Nothing growing', topCrops.map(([g, q]) => `${GOODS[g].name} ${num(q)}`).join(' · ')] });
  const keyGoods = new Set<GoodId>();
  for (const g of here) for (const [x] of ins(g.type)) keyGoods.add(x);
  const keyList = [...keyGoods].sort((a, b) => inv[b] - inv[a]).slice(0, 2);
  nodes.push({ id: 'storage', title: 'Storage', col: 1, status: fill > 0.95 ? 'bad' : fill > 0.8 ? 'warn' : 'ok', lines: [`Dry ${pct0(fill)} full`, keyList.map((g) => `${GOODS[g].name} ${num(inv[g])}`).join(' · ') || `${num(st.dry)} units held`] });
  for (const g of here) {
    const d = BUILDINGS[g.type];
    const paused = g.active === 0;
    const inS = ins(g.type).map(([x]) => `${GOODS[x].name.split(' ')[0]} ${num(inv[x])}`).join(', ');
    const outS = outs(g.type).filter(([x]) => x !== 'manure').map(([x]) => `${GOODS[x].name.split(' ')[0]} ${num(inv[x])}`).join(', ');
    nodes.push({
      id: g.key, group: g, col: DEPTH[g.type] ?? 2, title: `${d.name}${g.list.length > 1 ? ` ×${g.list.length}` : ''}`,
      status: d.recipe ? statusOf(g.util, paused, g.reason) : paused ? 'warn' : 'ok',
      lines: d.recipe ? [`${pct0(g.util)} · ${money(g.margin)}/h`, inS ? `in: ${inS}` : `out: ${outS}`, inS && outS ? `out: ${outS}` : ''] : [paused ? 'Paused' : 'Running', `${money(g.margin)}/h`],
    });
  }
  const salesToday = sumBooks(s, 1, ['sale', 'contract']);
  nodes.push({ id: 'markets', title: 'Markets', col: 5, status: 'ok', lines: [`Sales today ${money(salesToday)}`, 'all regions'] });

  // compact columns
  const usedCols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
  const colIdx = (c: number) => usedCols.indexOf(c);
  const rowsIn: Record<number, number> = {};
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const i = (rowsIn[n.col] = (rowsIn[n.col] ?? -1) + 1);
    pos[n.id] = { x: colIdx(n.col) * (NW + CG), y: i * (NH + RG) };
  }
  const maxRows = Math.max(...Object.values(rowsIn)) + 1;
  const W = usedCols.length * NW + (usedCols.length - 1) * CG;
  const H = maxRows * NH + (maxRows - 1) * RG;
  for (const n of nodes) if ((rowsIn[n.col] ?? 0) + 1 < maxRows) pos[n.id].y += ((maxRows - rowsIn[n.col] - 1) * (NH + RG)) / 2;

  // edges: storage feeds anything whose input nobody here makes; producers feed consumers; finished goods go to market
  const edges: { a: string; b: string; good: string; live: boolean }[] = [];
  const add = (a: string, b: string, good: string, live: boolean) => pos[a] && pos[b] && !edges.some((e) => e.a === a && e.b === b) && edges.push({ a, b, good, live });
  add('fields', 'storage', 'crops', cropTotal > 0);
  const live = (g: Group) => g.active > 0 && g.util > 0.05;
  for (const g of here) {
    for (const [x] of ins(g.type)) {
      const makers = here.filter((p) => outs(p.type).some(([o]) => o === x));
      if (makers.length) makers.forEach((p) => add(p.key, g.key, GOODS[x].name, live(p) && live(g)));
      else add('storage', g.key, GOODS[x].name, live(g));
    }
    const sold = outs(g.type).filter(([o]) => o !== 'manure' && !here.some((c) => ins(c.type).some(([i]) => i === o)));
    if (sold.length) add(g.key, 'markets', sold.map(([o]) => GOODS[o].name).join(', '), live(g));
    if (outs(g.type).some(([o]) => o === 'manure') && !has_('biogas')) add(g.key, 'fields', 'Manure', live(g));
    if (g.type === 'distribution') add('storage', g.key, 'processed goods', g.active > 0);
  }
  const selNode = nodes.find((n) => n.id === sel) ?? null;
  const tip = (n: ChainNode) => `${n.title}: ${n.lines.filter(Boolean).join(', ')}`;

  return (
    <Card title={<>Production chain{regs.length > 1 ? '' : <span className="muted"> · {REGIONS[r].name}</span>}</>}
      info="Material flows through your regional inventory. Animated edges are moving goods right now. Node border: green at capacity, amber partly limited or paused, red mostly idle. Click a node for the bottleneck and what it costs you."
      actions={regs.length > 1 ? <Select label="Region" value={r} onChange={setPref} options={regs.map((x) => ({ v: x, label: REGIONS[x].name }))} /> : undefined}>
      <div style={{ overflowX: 'auto' }}>
        <svg className="chain" viewBox={`-6 -6 ${W + 12} ${H + 12}`} style={{ minWidth: Math.min(W, 640) }} role="group" aria-label={`Production chain in ${REGIONS[r].name}`}>
          <defs><marker id="prod-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--faint)" /></marker></defs>
          {edges.map((e) => {
            const a = pos[e.a], b = pos[e.b];
            const back = b.x <= a.x;
            const x1 = back ? a.x + NW / 2 : a.x + NW, y1 = back ? a.y + NH : a.y + NH / 2;
            const x2 = back ? b.x + NW / 2 : b.x, y2 = back ? b.y + NH : b.y + NH / 2;
            const d = back ? `M${x1} ${y1} C${x1} ${y1 + 40} ${x2} ${y2 + 40} ${x2} ${y2}` : `M${x1} ${y1} C${x1 + CG / 2} ${y1} ${x2 - CG / 2} ${y2} ${x2} ${y2}`;
            return <path key={`${e.a}-${e.b}`} className={`edge${e.live ? ' flow' : ''}`} d={d} markerEnd="url(#prod-arrow)"><title>{e.good}</title></path>;
          })}
          {nodes.map((n) => {
            const p = pos[n.id];
            const pick = () => setSel(sel === n.id ? null : n.id);
            return (
              <g key={n.id} className={`node ${n.status}`} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-pressed={sel === n.id} aria-label={tip(n)} style={{ cursor: 'pointer' }}
                onClick={pick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}>
                <rect width={NW} height={NH} rx={10} style={sel === n.id ? { strokeWidth: 3 } : undefined} />
                <text x={10} y={20} style={{ fontWeight: 600, fontSize: 12 }}>{n.title}</text>
                {n.lines.filter(Boolean).map((l, i) => <text key={i} className="sub" x={10} y={40 + i * 15}>{l.length > 30 ? `${l.slice(0, 29)}…` : l}</text>)}
                {n.group && BUILDINGS[n.group.type].recipe && <rect x={0} y={NH - 4} height={4} width={NW * Math.min(1, n.group.util)} rx={2} style={{ fill: n.status === 'ok' ? 'var(--up)' : n.status === 'warn' ? 'var(--warn)' : 'var(--down)', stroke: 'none' }} />}
              </g>
            );
          })}
        </svg>
      </div>
      {selNode ? <NodeDetail s={s} n={selNode} r={r} cropDay={cropDay} fill={fill} /> : <p className="small muted" style={{ marginTop: 8 }}>Click a node to see what is holding it back.</p>}
    </Card>
  );
}

function NodeDetail({ s, n, r, cropDay, fill }: { s: GameState; n: ChainNode; r: RegionId; cropDay: Partial<Record<GoodId, number>>; fill: number }) {
  const inv = s.regions[r].inventory;
  const box = (tone: string, body: ReactNode) => <div className={`callout ${tone}`} style={{ marginTop: 10 }}>{body}</div>;
  if (n.id === 'fields') {
    const rows = (Object.entries(cropDay) as [GoodId, number][]).sort((a, b) => b[1] - a[1]);
    return box('', rows.length ? <>Fields in {REGIONS[r].name} are on course to produce {rows.map(([g, q]) => `${num(q)} ${GOODS[g].name.toLowerCase()}`).join(', ')} per day (forecast yield ÷ growing time). Harvests land in regional storage, where factories draw from them.</> : <>Nothing is growing in {REGIONS[r].name}. Factories here will need inputs bought on Markets{s.era >= 6 ? ' or shipped in' : ''}.</>);
  }
  if (n.id === 'storage') {
    const st = stored(s, r);
    return box(fill > 0.95 ? 'bad' : fill > 0.8 ? 'warn' : '', <>Dry storage holds {num(st.dry)} of {num(st.cap.dry)} units ({pct0(fill)}){st.cap.cold ? `; cold ${num(st.cold)} of ${num(st.cap.cold)}` : ''}. {fill > 0.8 ? 'When it fills, factories stop with “Output storage full” and harvests overflow. Sell output or build a warehouse.' : 'Factories take inputs from here and put outputs back here.'}</>);
  }
  if (n.id === 'markets') return box('', <>Finished goods wait in storage until you sell them on Markets{s.era >= 6 ? ' or ship them to a better-priced region' : ''}. Sales today across all regions: {money(sumBooks(s, 1, ['sale', 'contract']))}.</>);
  const g = n.group!;
  const d = BUILDINGS[g.type];
  if (!d.recipe) return box(g.active ? 'good' : 'warn', <>{d.name}{g.list.length > 1 ? ` ×${g.list.length}` : ''} is {g.active ? 'running' : 'paused'}. {d.blurb} {d.solarKw ? 'See the Energy panel for its output.' : ''}</>);
  const e = fullEcon(s, g.type, r);
  const units = g.active || g.list.length;
  const lost = Math.max(0, (1 - g.util) * e.perBatch * e.bph * units);
  const short = ins(g.type).filter(([x, q]) => inv[x] < q * e.bph);
  const advice = g.reason === 'Not enough cows' ? 'A dairy milks your own cows: up to 120 per dairy. Buy cows and build cowsheds on the Livestock page, or run fewer dairies.'
    : g.reason.startsWith('Not enough')
    ? `Grow more ${short.map(([x]) => GOODS[x].name.toLowerCase()).join(' and ') || 'input'}, buy it on Markets${s.era >= 6 ? ', ship it in' : ''}, or build an upstream facility.`
    : g.reason === 'Output storage full' ? 'Sell the output or add storage (warehouse for dry goods, cold store for chilled).'
    : g.reason === 'Paused' ? 'Resume it when inputs and prices support running. Paused facilities pay no staff.'
    : g.reason.startsWith('Disease') ? 'Livestock disease halts production until the outbreak ends; staff are still paid.'
    : '';
  const bad = n.status !== 'ok';
  return box(n.status === 'ok' ? 'good' : n.status, (
    <div className="stack s">
      <b>{d.name}{g.list.length > 1 ? ` ×${g.list.length}` : ''} at {pct0(g.util)} capacity{g.reason ? ` — ${g.reason.toLowerCase()}` : ''}.</b>
      {bad && e.perBatch > 0 && <span>Lost margin ≈ <b className="mono">{money(lost)}/h</b> ({money(lost * 24)}/day) at current {REGIONS[r].name} prices versus running flat out.</span>}
      {e.perBatch <= 0 && <span className="down">Each batch loses {money(-e.perBatch)} at today's prices before staff — running harder makes it worse.</span>}
      <span className="small">Inputs on hand: {ins(g.type).map(([x, q]) => `${num(inv[x])} ${GOODS[x].name.toLowerCase()} (needs ${num(q * e.bph * units)}/h)`).join(', ') || 'none needed'}. Outputs held: {outs(g.type).map(([x]) => `${num(inv[x])} ${GOODS[x].name.toLowerCase()}`).join(', ')}.</span>
      <span className="small">Margin now {money(g.margin)}/h; at full capacity {money(e.margin * units)}/h. Break-even {Number.isFinite(e.breakEven) ? pct0(e.breakEven) : 'not reachable'}.</span>
      {advice && <span className="small">{advice}</span>}
    </div>
  ));
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
