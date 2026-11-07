import { productionReport, productionPriceRails } from '../../simulation/production-report';
import { townIndustryFactor } from '../../simulation/town-state';
import { useState, type ReactNode } from 'react';
import { ANIMALS, BUILDINGS, COWS_PER_DAIRY_BATCH, CROPS, GOODS, REGIONS, type BuildingType, type GoodId, type RegionId, TECH } from '../../simulation/config';
import { electricityPrice, factoryCrop, has, levelMult, priceUsd, sumBooks } from '../../simulation/core';
import { buildingPrice, expectedYield } from '../../simulation/engine';
import { buildingMargin, solarOutput } from '../../simulation/processing';
import type { Building, GameState } from '../../simulation/types';
import { act, go, useGame, useStore } from '../../stores/game';
import { lineEcon, upgradeOutlook } from '../../simulation/lines';
import { portrait } from '../world/portrait';
import { money, num, pct0, price } from '../format';
import { Card, Confirm, Empty, Info, Kpi, PageHead, Select, usePref } from '../ui';
import { regionOptions, unlockedRegions } from './shared';

const qtyFormat=new Intl.NumberFormat('en-US',{notation:'compact',maximumSignificantDigits:2});
const compactQty=(n:number)=>qtyFormat.format(n);
const compactMoney=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumSignificantDigits:3}).format(n);
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
  const report=productionReport(groups.flatMap(g=>g.list));
  const marginH = report.days?report.worth/24:groups.reduce((a, g) => a + g.margin, 0);
  const avgUtil = withRecipe.length ? withRecipe.reduce((a, g) => a + g.util * g.list.length, 0) / withRecipe.reduce((a, g) => a + g.list.length, 0) : 0;
  const elecY = sumBooks(s, 2, ['electricity']) - sumBooks(s, 1, ['electricity']);
  const gridY = sumBooks(s, 2, ['grid']) - sumBooks(s, 1, ['grid']);
  const count = groups.reduce((a, g) => a + g.list.length, 0);

  return (
    <div className="stack l">
      <PageHead title="Production" sub="Turn crops into higher-value goods. A factory pays fixed staff every hour it runs, so it only earns when inputs keep it near capacity." />
      <div className="kpis">
        <Kpi label="Facilities" value={num(count)} sub={`${groups.reduce((a, g) => a + g.active, 0)} running`} />
        <Kpi label="Processing contribution" value={`${money(marginH*24)}/day`} tone={report.tone==='neutral'?undefined:report.tone} sub={report.days?`${report.days} completed days`:"Collecting history"}
          info="Average completed-day value after inputs, staff and power. This is processing contribution, not company net profit or settled sales. Farm costs, selling impact, spoilage, fines and tax remain separate." />
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
  if(!ins(g.type).length)return {ok:true,why:'Grid power can supply another; its cost is included',gain};
  const sp = spareOf(s, g, groups);
  const one = (Object.values(rec.inputs)[0] ?? 0) * rec.batchesPerHour * townIndustryFactor(s,g.region) * 24;
  if (!sp) return { ok: false, why: `Nothing of yours makes its ${lower(ins(g.type))} — you'd be buying it`, gain };
  if (sp.spare >= one) return { ok: true, why: `You make enough ${GOODS[sp.good].name.toLowerCase()} for it`, gain };
  return { ok: false, why: factoryCrop(g.list[0]) === sp.good ? `Dedicate more ${GOODS[sp.good].name.toLowerCase()} fields first` : `You'd need ${num(one - Math.max(0, sp.spare))} more ${GOODS[sp.good].name.toLowerCase()} a day`, gain };
}

type Dot = 'ok' | 'bad' | 'off' | 'watch';

function Coin() {
  return <svg className="coin" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="7" /><circle cx="8" cy="8" r="4.6" className="coin-in" /></svg>;
}

function Token({ g, top, sub, bad }: { g: GoodId; top: string; sub?: string; bad?: boolean }) {
  return (
    <div className={`ln-token${bad ? ' bad' : ''}`}>
      <span className="ln-ball" style={{ background: GOODS[g].color }} />
      <span className="ln-token-name">{g==='feed'?'Feed':GOODS[g].name}</span>
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
  const speed=useStore(x=>x.speed),d=BUILDINGS[g.type],rec=d.recipe,paused=g.active===0;
  const [panel,setPanel]=useState<'run'|'rails'|'grow'>('run'),[growth,setGrowth]=useState<'upgrade'|'another'>(()=>g.list.some(b=>b.level<3)?'upgrade':'another');
  const current=rec?lineEcon(s,g.list,paused):null,report=productionReport(g.list);
  const fallback={earn:g.outValue*24,inputs:g.inCost*24,staff:g.opCost*24,power:0,alt:0,worth:g.margin*24};
  const shown=report.days?report:current??fallback;
  const shownTone=paused||!report.days?'neutral':report.tone;
  const utilisation=report.days?report.utilisation:g.util;
  const reason=report.days?report.reason:g.reason;
  const shortOf=reason.startsWith('Not enough')&&reason!=='Not enough cows'?ins(g.type).find(([good])=>reason.toLowerCase().includes(GOODS[good].name.toLowerCase()))?.[0]??null:null;
  const dot:Dot=paused?'off':report.days<3?'watch':shownTone==='down'||utilisation<.75?'bad':shownTone==='neutral'||utilisation<.9?'watch':'ok';
  const label=paused?'Paused':!report.days?'Collecting report':utilisation<.9&&reason?reason==='Output storage full'?'Storage full':reason==='Not enough cows'?'Short of cows':shortOf?`Needs ${GOODS[shortOf].name.toLowerCase()}`:'Below capacity':report.days<3?`${report.days}d report`:shownTone==='down'?'Losing value':shownTone==='neutral'?'Near break-even':'Running well';
  const inv=s.regions[g.region].inventory;
  const perDay=(q:number)=>g.list.reduce((n,b)=>n+q*(rec?.batchesPerHour??0)*levelMult(b.level)*townIndustryFactor(s,b.region)*24,0);
  const live=speed>0&&g.list.some(b=>b.active&&b.productionReport.lastTick===s.tick&&b.productionReport.lastBatches>0);
  const up=current&&!paused?upgradeOutlook(s,g.list):null,sp=rec?spareOf(s,g,groups):null;
  const upShort=up&&!up.blocked&&sp&&extraNeed(s,g,1)>Math.max(0,sp.spare)?`Needs ${num(extraNeed(s,g,1)-Math.max(0,sp.spare))} more ${sp.good==='feed'?'feed':GOODS[sp.good].name.toLowerCase()}/day`:undefined;
  const more=current&&!paused?addMore(s,g,groups,current.worth):null;
  const buildCost=buildingPrice(s,g.type,g.region);
  const toggle=(on:boolean)=>g.list.filter(b=>b.active!==on).forEach(b=>act({type:'toggleBuilding',buildingId:b.id}));
  const upgradeAll=()=>g.list.filter(b=>b.active&&(b.level||1)<3).forEach(b=>act({type:'upgradeBuilding',buildingId:b.id}));
  const victim=[...g.list].sort((a,b)=>Number(a.active)-Number(b.active)||a.util-b.util)[0],refund=Math.round(Math.max(0,victim.cost-victim.depreciated)*.5);
  const rails=productionPriceRails(g.type,report),img=portrait(g.type);
  const input=ins(g.type)[0]?.[0],output=outs(g.type)[0]?.[0];
  const suppliers=groups.filter(other=>other.region===g.region&&input&&outs(other.type).some(([good])=>good===input)).map(other=>BUILDINGS[other.type].name);
  const totalCosts=shown.inputs+shown.staff+shown.power+Math.max(0,shown.alt),shownValue=shown.earn+Math.max(0,-shown.alt),scale=Math.max(shownValue,totalCosts,1);
  const problem=!paused&&utilisation<.9?reason:'';
  const jobTitle=!rec?(d.solarKw?'Power generation':report.days&&shownTone==='down'?'Retail costs exceed sales':'Retail sales'):paused?'Paused · no running costs':problem==='Output storage full'?'Make room for finished goods':problem==='Not enough cows'?'Your dairy needs more cows':shortOf?`Supply ${GOODS[shortOf].name.toLowerCase()}`:report.days<3?'Learning the run rate':shownTone==='down'?'Check the margin rails':'Inputs and output are flowing';
  const sourceGroup=shortOf?groups.find(other=>other.region===g.region&&outs(other.type).some(([good])=>good===shortOf)):null;
  const jobSub=!rec?'Reported value after staff costs':paused?'Resume when its inputs and market are ready.':problem==='Output storage full'?'Sell surplus or add storage.':problem==='Not enough cows'?'Only your own herd can supply a dairy.':shortOf?sourceGroup?`${BUILDINGS[sourceGroup.type].name} → shared store`:'Input ran short yesterday':!report.days?'The first full day will appear here.':shownTone==='down'&&current&&current.worth>0?'Past loss; prices have recovered':`${report.days} completed days · market-valued inputs`;
  const traceSource=()=>{if(sourceGroup)document.querySelector<HTMLElement>(`[data-line="${sourceGroup.key}"]`)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});else if(jobPage)go(jobPage);};
  const jobPage=!rec&&g.type==='distribution'?'markets':problem==='Output storage full'?'storage':problem==='Not enough cows'?'livestock':shortOf?factoryCrop(g.list[0])===shortOf?'fields':'markets':null;
  return <article className={`ln ln-${dot}`} data-line={g.key} data-report-days={report.days} data-report-tone={shownTone}>
    <div className="ln-portrait">{img?<img src={img} alt=""/>:<span className="ln-portrait-fallback">🏭</span>}{g.list.length>1&&<span className="ln-count">×{g.list.length}</span>}{g.list.some(b=>(b.level||1)>1)&&<span className="ln-level">Lv{Math.max(...g.list.map(b=>b.level||1))}</span>}</div>
    <div className="ln-body">
      <header className="ln-head"><div><h4>{d.name}</h4><span className="ln-region">{REGIONS[g.region].name}</span></div>
        <div className={`ln-coins ${shownTone==='neutral'?'':shownTone}`}><Coin/><span className="mono">{paused&&!rec&&!report.days?'—':`${shown.worth>.005?'+':''}${money(shown.worth)}`}</span><small>{report.days?`${report.days}d avg/day`:paused?current?'if running':'paused':'estimate/day'}</small></div>
      </header>
      <div className="ln-report-note"><span>{report.days?'Completed-day contribution':paused?current?'Current-price forecast':'Paused · no recorded days':'Collecting daily history'}</span><Info text="Completed days show the value produced after input opportunity cost, staff and power. This is not settled sales or company net profit: farm costs, selling impact, spoilage, fines and tax are separate. Dairy value is compared with leaving the same cows in the cowshed. Flow rates are installed capacity per day; crate numbers are live stock. Colours need three full days and a 3% margin buffer; no past history is invented on loading an older save." breakdown={[[report.days?'Observed period':'Current estimate',report.days?`${report.days} full days`:'No complete day yet'],['Value made',money(shown.earn)],['Inputs',money(-shown.inputs)],['Staff & power',money(-shown.staff-shown.power)],['Cowshed alternative',money(-shown.alt)],['Input supply',suppliers.length?`${suppliers.join(', ')} or market · shared regional store`:'Fields, herds or market · shared regional store'],['Right now',g.reason||'No current input bottleneck']]}/></div>
      {rec&&<div className="ln-flow">
        <div className="ln-side in">{input?ins(g.type).map(([good,q])=><Token key={good} g={good} top={`${compactQty(perDay(q))}/d`} sub={`📦${compactQty(inv[good])}`} bad={shortOf===good}/>):<div className="ln-token"><span>⚡</span><b>{compactQty(perDay(Math.max(0,rec.kwh)))}/d</b><span className="ln-token-sub">kWh</span></div>}</div>
        <Belt live={live} color={input?GOODS[input].color:'#D8AA54'}/>
        <div className={`ln-puck ${dot}`} style={{['--p' as string]:Math.round(Math.min(1,utilisation)*100)}}><div className="ln-ring"><span className="mono">{pct0(utilisation)}</span></div><b>{label}</b></div>
        <Belt live={live} color={output?GOODS[output].color:'#D8AA54'}/>
        <div className="ln-side out">{output?outs(g.type).filter(([good])=>good!=='manure').map(([good,q])=><Token key={good} g={good} top={`${compactQty(perDay(q*(has(s,'processEfficiency')?1.1:1)))}/d`} sub={`📦${compactQty(inv[good])}`}/>):<div className="ln-token"><span>⚡</span><b>{compactQty(perDay(-rec.kwh))}/d</b><span className="ln-token-sub">kWh</span></div>}</div>
      </div>}
      <div className="ln-money"><span className="ln-mlabel">Value</span><div className="ln-bar"><div className="earn" style={{width:`${shownValue/scale*100}%`}}/></div><span className="mono">{money(shownValue)}</span><span className="ln-mlabel">Costs</span><div className="ln-bar">{[['inputs',shown.inputs],['staff',shown.staff+shown.power],['alt',Math.max(0,shown.alt)]].map(([key,value])=><div key={String(key)} className={String(key)} style={{width:`${Math.max(0,Number(value))/scale*100}%`}}/>)}</div><span className="mono">{money(totalCosts)}</span></div>
      <div className="ln-command">
        <div className="ln-command-tabs" aria-label={`${d.name} commands`}>{([['run','⚙','Run'],['rails','🪙','Margins'],['grow','⬆','Grow']] as const).map(([key,icon,title])=><button key={key} className={panel===key?'on':''} aria-label={title} aria-pressed={panel===key} onClick={()=>setPanel(key)}><span aria-hidden>{icon}</span>{title}</button>)}</div>
        <div className="ln-command-body">
        <div className={`ln-panel ln-job-slot${jobPage?'':' no-job-action'}`} hidden={panel!=='run'}><Option icon={paused?'⏸':problem?'⚠':'✓'} title={jobTitle} sub={jobSub}>{jobPage?<button className="btn sm" onClick={traceSource}>{sourceGroup?'Source →':'Fix →'}</button>:null}</Option><div className="ln-forecast-strip"><span>24h forecast</span><b className="mono">{current?`${money(current.worth)}/day`:g.type==='distribution'?'12% retail channel':'Weather dependent'}</b></div></div>
        <div className="ln-panel ln-targets" hidden={panel!=='rails'}><span className="ln-kicker">Price targets</span>{[0,1].map(index=>{const rail=rails[index];return <div className="ln-target" key={rail?.good??`energy-${index}`}>
          {rail?<><span className="ln-ball" style={{background:GOODS[rail.good].color}}/><span>{GOODS[rail.good].name} {rail.side==='sell'?'floor':'ceiling'}</span><b className="mono">{report.days&&rail.need!==null&&rail.need>0?price(rail.need):'—'}</b><span className="small muted">{!report.days?'Collecting a full day':rail.need===null?'Same cost either way':rail.need<=0?'Other changes matter':`observed ${price(rail.now)}`}</span></>:<><span>⚡</span><span>{g.type==='distribution'?'Retail premium':g.type==='solar'?'Power value':'Power & staff'}</span><b>{g.type==='distribution'?'+12%':'—'}</b><span className="small muted">{g.type==='distribution'?'One channel; centres do not stack':'Included in the report'}</span></>}
        </div>;})}</div>
        <div className="ln-panel ln-growth-slot" hidden={panel!=='grow'}><div className="ln-growth-choices"><button className={growth==='upgrade'?'on':''} aria-pressed={growth==='upgrade'} onClick={()=>setGrowth('upgrade')}>⬆ Upgrade</button><button className={growth==='another'?'on':''} aria-pressed={growth==='another'} onClick={()=>setGrowth('another')}>＋ Another</button><Info text="Expansion is a live forecast using current production rules, supply and 24-hour prices. The main report describes completed days. More output still lowers prices."/></div>
          <div className="ln-growth-option" hidden={growth!=='upgrade'}>
          <Option icon="⬆" title={up?`Upgrade · ${compactMoney(up.cost)}`:rec?'Upgrade · maximum reached':'Specialist facility'} sub={paused?'Resume first':up?.blocked?(up.blocked.includes('cows')?'More cows needed':'Input supply too low'):upShort??(up?up.gain>0?`About +${money(up.gain)}/day`:'More capacity would not pay':rec?'No further level':'Use the dedicated facility controls')}><Confirm className="btn sm" disabled={!up||!!up.blocked||!!upShort||up.gain<=0||up.cost>s.cash} label="Upgrade" title={`Upgrade ${d.name}?`} confirmLabel={`Pay ${money(up?.cost??0)}`} body={<>At current prices this adds about {money(up?.gain??0)} a day. More capacity still needs inputs, staff and power.</>} onConfirm={upgradeAll}/></Option></div>
          <div className="ln-growth-option" hidden={growth!=='another'}><Option icon="＋" title={`Another · ${compactMoney(buildCost)}`} sub={paused?'Resume this line first':more?more.ok?`About +${money(more.gain)}/day`:more.why:g.type==='distribution'?'Extra centres do not stack the premium':'Review generation in Energy'}><Confirm className="btn sm" disabled={!more?.ok||buildCost>s.cash} label="Build" title={`Build another ${d.name}?`} confirmLabel={`Pay ${money(buildCost)}`} body={<>At current prices: about +{money(more?.gain??0)} a day. More output lowers prices; the estimate assumes its inputs remain available.</>} onConfirm={()=>act({type:'build',region:g.region,building:g.type})}/></Option></div>
        </div>
      </div></div>
      <footer className="ln-foot"><button className="btn ghost xs" onClick={()=>toggle(paused)}>{paused?'Resume':'Pause'}</button><Confirm className="btn ghost xs" label="Demolish" title={`Demolish a ${d.name}?`} confirmLabel={`Return ${money(refund)}`} body={<>Half its book value is returned. The least-used unit goes first.</>} onConfirm={()=>act({type:'demolish',buildingId:victim.id})}/></footer>
    </div>
  </article>;
}

const lower = (xs: [GoodId, number][]) => xs.filter(([x]) => x !== 'manure').map(([x]) => GOODS[x].name.toLowerCase()).join(' and ');

function LinesCard({ s, groups }: { s: GameState; groups: Group[] }) {
  // fixed order (name, then region) so lines never trade places as numbers move; colour carries the status
  const rows = [...groups].sort((a, b) => BUILDINGS[a.type].name.localeCompare(BUILDINGS[b.type].name) || a.region.localeCompare(b.region));
  return (
    <Card title="Production lines" info="The main coin is a completed-day contribution report, not cash received. Stock and material motion stay live. Fixed margin rails and expansion slots stay in place at high speed.">
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
