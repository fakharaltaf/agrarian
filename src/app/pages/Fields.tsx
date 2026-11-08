import { spreadNeed, spreadingCost } from '../../simulation/agriculture';
import { DEALER_SPREAD } from '../../simulation/markets';
import { RetailQuote } from '../RetailQuote';
import { useEffect, useRef, useState } from 'react';
import { BUILDINGS, CONFIG, CROPS, GOODS, GOOD_IDS, MACHINES, REGIONS, WORK_END, WORK_START, type CropId, type GoodId, type RegionId } from '../../simulation/config';
import { factoryCrop, freeSpace, has, known, reservedStock, priceUsd, stored } from '../../simulation/core';
import {
  canGrow, expectedYield, fertility, grade, greenhousePrice, growth, homePlotPrice, irrigationPrice, isManual, isMature, isReady, parcelPrice, qualityMult, quoteSell, seedShortfall, soilFactor, tempFactor, timingFactor, waterFactor, techFactor,
} from '../../simulation/engine';
import type { Field, GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { dayPrice } from '../../simulation/lines';
import { bestCrop, cropReturn, rankCrops } from '../crops';
import { duration, money, num, pct, pct0, price, stamp } from '../format';
import { Bar, Card, Confirm, Info, Seg, Select, Swatch, Tip, usePref } from '../ui';
import { unlockedRegions } from './shared';
import { stageAtLeast } from '../../simulation/stages';
import { HOMESTEAD_MILL_PRICE, homesteadState } from '../../simulation/stages/homestead';


export function FieldsPage() {
  const s = useGame();
  const regions = unlockedRegions(s).filter((r) => s.fields.some((f) => f.region === r));
  const [region, setRegion] = usePref<RegionId>('fields.region', 'heartland');
  const r = regions.includes(region) ? region : 'heartland';
  const fields = s.fields.filter((f) => f.region === r);
  const [sel, setSel] = useState<number[]>([fields[0]?.id ?? 1]);
  const [chosen, setCrop] = useState<CropId | null>(null);
  const selected = s.fields.filter((f) => sel.includes(f.id));
  const one = selected.length === 1 ? selected[0] : null;
  const crop = chosen ?? (one ? bestCrop(s, one) : 'wheat'); // best pay until the player picks
  const live = useRef({ s, one, crop });
  live.current = { s, one, crop };

  useEffect(() => {
    if (!s.fields.some((f) => sel.includes(f.id))) setSel(fields[0] ? [fields[0].id] : []);
  }, [s.fields.length, r]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: P plant selected, H harvest every ready hand-worked plot, B buy a plot.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, [role=dialog]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const L = live.current;
      if (e.key === 'p' && L.one && !L.one.crop) act({ type: 'plant', fieldId: L.one.id, crop: L.crop });
      else if (e.key === 'h') L.s.fields.filter((f) => isManual(f) && isReady(L.s, f)).forEach((f) => act({ type: 'harvest', fieldId: f.id }));
      else if (e.key === 'b') act({ type: 'buyPlot' });
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const toggle = (id: number, multi: boolean) => setSel((cur) => (multi ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  const readyPlots = s.fields.filter((f) => isManual(f) && isReady(s, f));
  const emptyPlots = fields.filter((f) => isManual(f) && !f.crop);

  return (
    <div className="stack l" style={{ marginTop: 16 }}>
      <div className="grid2 fields-layout">
        <div className="stack l">
          <Card
            title={<>Farm <span className="muted">{num(fields.reduce((a, f) => a + f.ha, 0))} ha{regions.length > 1 ? ` · ${REGIONS[r].name}` : ''}</span></>}
            actions={<>
              {regions.length > 1 && <Select label="Region" value={r} onChange={setRegion} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />}
              {readyPlots.length > 1 && <button className="btn ghost sm" onClick={() => readyPlots.forEach((f) => act({ type: 'harvest', fieldId: f.id }))} title="Shortcut: H">Harvest {readyPlots.length} ready</button>}
              {emptyPlots.length > 1 && <button className="btn ghost sm" onClick={() => emptyPlots.forEach((f) => act({ type: 'plant', fieldId: f.id, crop }))}>Plant {emptyPlots.length} empty with {GOODS[crop].name.toLowerCase()}</button>}
              {fields.length > 1 && stageAtLeast(s, 'farm-business') && <button className="btn ghost sm" onClick={() => setSel(sel.length === fields.length ? [fields[0].id] : fields.map((f) => f.id))}>{sel.length === fields.length ? 'Clear selection' : 'Select all'}</button>}
            </>}
          >
            {fields.length > 24
              ? <FieldGrid s={s} fields={fields} sel={sel} onSelect={toggle} />
              : <FarmView s={s} fields={fields} sel={sel} onSelect={toggle} canBuy={r === 'heartland' && s.stats.sales > 0 && s.regions.heartland.homePlotsBought < CONFIG.homePlots} />}
            {stageAtLeast(s, 'farm-business') && <p className="muted small" style={{ marginTop: 8 }}>Shift- or Ctrl-click to select several fields for batch actions.</p>}
          </Card>
          {selected.length > 1 ? <BatchPanel s={s} fields={selected} /> : one && <FieldPanel s={s} f={one} crop={crop} setCrop={setCrop} />}
        </div>
        <div className="stack l">
          {s.stats.harvests > 0 && (s.legacyProgression || stageAtLeast(s, 'market-town') ? <SellCard s={s} r={r} /> : <HomesteadTraderCard s={s} />)}
          {(s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'farm-business')) && <LandCard s={s} />}
          {!stageAtLeast(s, 'industry') && <RecentLog s={s} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- farm view

function plotState(s: GameState, f: Field) {
  const ready = isReady(s, f);
  return { ready, g: growth(s, f), depleted: fertility(f) < 0.45, diseased: f.pest > 0.3 };
}

function FarmView({ s, fields, sel, onSelect, canBuy }: { s: GameState; fields: Field[]; sel: number[]; onSelect: (id: number, multi: boolean) => void; canBuy: boolean }) {
  return <div className="stack"><FieldGrid s={s} fields={fields} sel={sel} onSelect={onSelect}/>
    {canBuy && <button className="btn" data-coach="buy-plot" disabled={s.cash<homePlotPrice(s)} onClick={()=>act({type:'buyPlot'})}>＋ 1 ha · {money(homePlotPrice(s))}</button>}
  </div>;
}

/** Compact tiles for large operations: readable and fast with hundreds of fields. */
function FieldGrid({ s, fields, sel, onSelect }: { s: GameState; fields: Field[]; sel: number[]; onSelect: (id: number, multi: boolean) => void }) {
  const counts = { ready: 0, growing: 0, empty: 0 };
  for (const f of fields) isReady(s, f) ? counts.ready++ : f.crop ? counts.growing++ : counts.empty++;
  return (
    <div className="stack s">
      <div className="row wrap small muted">
        <span>{counts.growing} growing</span>·<span className="warn">{counts.ready} ready</span>·<span>{counts.empty} empty</span>
      </div>
      <div className="fgrid" role="group" aria-label="Your fields">
        {fields.map((f) => {
          const st = plotState(s, f);
          const color = f.crop ? GOODS[f.crop].color : f.plan ? 'var(--surface-3)' : 'transparent';
          return (
            <button key={f.id} className={`ftile${sel.includes(f.id) ? ' on' : ''}${st.ready ? ' ready' : ''}${st.depleted ? ' depleted' : ''}`}
              aria-pressed={sel.includes(f.id)} aria-label={`Field ${f.id}, ${f.ha} ha, ${f.crop ? `${GOODS[f.crop].name} ${st.ready ? 'ready' : Math.floor(st.g * 100) + '%'}` : 'fallow'}`}
              title={`Field ${f.id} · ${num(f.ha)} ha · ${f.crop ? GOODS[f.crop].name : f.plan ? `plan ${GOODS[f.plan].name}` : 'fallow'} · fertility ${pct0(fertility(f))}${f.pest > 0.3 ? ' · pests' : ''}`}
              onClick={(e) => onSelect(f.id, e.shiftKey || e.ctrlKey || e.metaKey)}>
              <span className="ftile-top"><b>F{f.id}</b><span>{num(f.ha)} ha</span></span>
              <span className="field-symbol" aria-hidden>{GOOD_ICON[f.crop ?? f.plan ?? 'wheat'] ?? '🌱'}</span>
              <span className="ftile-crop" style={{ background: color, color: f.crop ? '#2a2110' : 'var(--muted)' }}>{f.crop ? GOODS[f.crop].name : f.plan ? GOODS[f.plan].name : '—'}</span>
              <span className="field-state">{st.ready ? '✓ Ready' : f.crop ? pct0(st.g) : f.plan ? 'Planned' : 'Fallow'}</span>
              <span className="ftile-bar"><i style={{ width: `${(f.crop ? st.g : 0) * 100}%` }} /></span>
              {(f.irrigated || st.diseased) && <span className="ftile-flags">{f.irrigated ? '💧' : ''}{st.diseased ? '🐛' : ''}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- single field

export function FieldPanel({ s, f, crop, setCrop }: { s: GameState; f: Field; crop: CropId; setCrop: (c: CropId) => void }) {
  const ready = isReady(s, f);
  const g = growth(s, f);
  const manual = isManual(f);
  const cost = seedShortfall(s, f, crop);
  const left = f.crop ? CROPS[f.crop].growthTicks - (s.tick - f.plantedAt) : 0;
  const forecastCrop = f.crop ?? crop;
  const fc = expectedYield(s, f, forecastCrop);
  const breakdown: [string, string][] = [
    ['Base', num(f.ha * CONFIG.seedsPerHa * CROPS[forecastCrop].yieldPerSeed)],
    ['× Soil', soilFactor(f, forecastCrop).toFixed(2)],
    ['× Water', waterFactor(s, f, forecastCrop).toFixed(2)],
    ['× Season/temp', tempFactor(s, f, forecastCrop).toFixed(2)],
    ['× Pests', (1 - 0.6 * f.pest).toFixed(2)],
    ['× Technology', techFactor(s).toFixed(2)],
    ['× Region fit', (REGIONS[f.region].suitability[forecastCrop] ?? 0).toFixed(2)],
  ];
  return (
    <Card title={<>Field {f.id} <span className="muted">{num(f.ha)} ha · {REGIONS[f.region].name}</span></>}
      actions={f.crop ? <span className={`pill ${ready ? 'gold' : ''}`}>{ready ? (timingFactor(s, f) < 1 ? 'Over-ripening' : 'Ready') : 'Growing'}</span> : <span className="pill">{f.plan ? `Planned: ${GOODS[f.plan].name}` : 'Fallow'}</span>}>
      <div className="stack">
        {f.crop ? (
          <>
            <div className="row between">
              <span className="crop-name"><Swatch color={GOODS[f.crop].color} />{GOODS[f.crop].name}</span>
              <span className="muted">{ready ? `Ripe — ${timingFactor(s, f) < 1 ? `losing yield (${pct0(timingFactor(s, f))} left)` : 'harvest within half a day'}` : `${duration(left)} to go`}</span>
            </div>
            <Bar value={g} color={GOODS[f.crop].color} label="Growth" />
            {CROPS[f.crop].perennial && <p className="small muted">{isMature(s, f) ? `Bearing fruit · planted ${num((s.tick - f.plantedAt) / 24)} days ago · rests in winter` : `Young trees — first fruit in ${duration(f.plantedAt + CROPS[f.crop].perennial!.matureDays * 24 - s.tick)}`}</p>}
            {f.frost > 0 && <div className="callout warn small">❄ Frost has cost this crop {pct0(f.frost)} of its yield.</div>}
            <div className="row between small">
              <span className="muted">Forecast yield <Info text="Expected harvest if conditions stay as they are now. Each factor multiplies the base yield." breakdown={breakdown} /></span>
              <span className="mono">~{num(fc)} units ({money(fc * priceUsd(s, f.region, f.crop))} today)</span>
            </div>
            {manual ? (
              <button className="btn primary lg" data-coach="harvest-btn" disabled={!ready} onClick={() => act({ type: 'harvest', fieldId: f.id })}>
                {ready ? `Harvest ${GOODS[f.crop].name.toLowerCase()}` : 'Not ready yet'}
              </button>
            ) : <p className="muted small">Harvested by your workers and machines when ready.</p>}
            {!manual && !CROPS[f.crop].machineHarvest && <PickTime s={s} f={f} />}
            {CROPS[f.crop].perennial && <Confirm label="Uproot orchard" className="btn ghost sm" title="Uproot this orchard?" body="The trees are removed and the field becomes fallow. The years of growth are lost." onConfirm={() => act({ type: 'clearField', fieldId: f.id })} confirmLabel="Uproot" />}
          </>
        ) : (
          <>
            {manual && (
              <>
                <div className="crop-grid" role="radiogroup" aria-label="Crop to plant" data-coach="crop-picker">
                  {(() => { const ranked = rankCrops(s, f); return ranked.map((id, i) => <CropCard key={id} s={s} f={f} id={id} on={crop === id} best={i === 0 && cropReturn(s, f, id).perHour > 0} pick={() => setCrop(id)} />); })()}
                </div>
                <button className="btn primary lg" data-coach="plant-btn" disabled={cost.cost > s.cash || !canGrow(f, crop)} onClick={() => act({ type: 'plant', fieldId: f.id, crop })} title="Shortcut: P">
                  Plant {GOODS[crop].name.toLowerCase()}
                  <span className="btn-sub">{cost.short ? `buy ${num(cost.short)} seeds · ${money(cost.cost)}` : `uses ${num(cost.need)} of your seeds`}</span>
                </button>
              </>
            )}
            {!manual && <p className="muted small">At {num(f.ha)} ha this field is too big to work by hand. Give it a crop plan; workers {s.machines.length ? 'and machines ' : ''}plant and harvest it.</p>}
          </>
        )}
        {stageAtLeast(s, 'farm-business') && <PlanPicker s={s} fields={[f]} />}
        <SupplyPicker s={s} fields={[f]} />
        {stageAtLeast(s, 'farm-business') && <SoilPanel s={s} f={f} />}
        {f.lastHarvest && (
          <Tip text="Why this harvest came out as it did — every factor is from the simulation."
            breakdown={[['Base', num(f.lastHarvest.base)], ['Soil', f.lastHarvest.soil.toFixed(2)], ['Water', f.lastHarvest.water.toFixed(2)], ['Season/temp', f.lastHarvest.weather.toFixed(2)], ['Pests', f.lastHarvest.pest.toFixed(2)], ['Technology', f.lastHarvest.tech.toFixed(2)], ['Region fit', f.lastHarvest.suitability.toFixed(2)], ['Timing', f.lastHarvest.timing.toFixed(2)]]}>
            <p className="explain">Last harvest: <b style={{ color: 'var(--text)' }}>{num(f.lastHarvest.units)} {GOODS[f.lastHarvest.crop].name.toLowerCase()}</b> ({pct0(f.lastHarvest.units / Math.max(1, f.lastHarvest.base))} of potential){known(s, 'quality') && f.lastHarvest.quality !== undefined && <> · grade <GradePill q={f.lastHarvest.quality} /></>} — hover for why.</p>
          </Tip>
        )}
        {stageAtLeast(s, 'industry') && s.fields.length > 1 && (
          <div className="row end">
            <Confirm label="Sell field" title={`Sell field ${f.id}?`} body={<>You will receive about <b>{money(f.cost * 0.85)}</b> (85% of what you paid). Any crop on it is lost.</>} onConfirm={() => act({ type: 'sellField', fieldId: f.id })} className="btn danger sm" confirmLabel="Sell" />
          </div>
        )}
      </div>
    </Card>
  );
}

const GOOD_ICON: Partial<Record<GoodId,string>> = {wheat:'🌾',corn:'🌽',potatoes:'🥔',soybeans:'🫘',rice:'🍚',sugarcane:'🎋',cotton:'☁',coffee:'☕',apples:'🍎',grapes:'🍇',bread:'🍞',flour:'🌾',milk:'🥛',eggs:'🥚',wool:'🧶',wine:'🍷',meat:'🥩',cheese:'🧀',butter:'🧈',feed:'🌿'};
function CropCard({ s, f, id, on, pick, best }: { s: GameState; f: Field; id: CropId; on: boolean; pick: () => void; best: boolean }) {
  const c=CROPS[id], {units,seed,value,profit,perHour}=cropReturn(s,f,id), ok=canGrow(f,id);
  return <article className={`crop-choice${on?' selected':''}${best?' best':''}`}>
    {best && <span className="crop-best">★ Best pay</span>}
    <button role="radio" aria-checked={on} className="crop-pick" onClick={pick} disabled={!ok}>
      <span className="good-symbol" aria-hidden="true">{GOOD_ICON[id]??'🌱'}</span>
      <strong>{GOODS[id].name} {on?'✓':''}</strong>
      {ok && <span className={`crop-rate mono ${perHour >= 0 ? 'good' : 'bad'}`} title="Expected profit per hour of growing">{perHour >= 0 ? '+' : '−'}{price(Math.abs(perHour))}/h</span>}
      <span className="crop-numbers mono"><span title="Growth time">⏱ {c.growthTicks}h</span><span title="Seed cost">🌱 {money(seed)}</span><span title="Estimated yield">📦 ~{num(units)}</span></span>
    </button>
    <Info text={`${c.perennial?`First fruit after ${c.perennial.matureDays} days. `:''}Best in ${c.bestSeasons.join(', ')}. ${!c.frostHardy?'Frost-sensitive. ':''}Yield depends on soil, water, pests and weather.`} breakdown={[
      ['Seed in store',num(s.seeds[id])],['24h market average',price(dayPrice(s,f.region,id))],['Estimated crop value',money(value)],['Seed cost',c.perennial?`${money(seed)} once`:money(seed)],['Profit per harvest',money(profit)],['Per hour of growing',ok?price(perHour):'—'],['Suitability',ok?'Suitable':'Cannot grow here']
    ]}/>
  </article>;
}

/** Fruit is picked by hand (or fruit machines): how long one harvest takes with today's crew, against how often it ripens. */
function PickTime({ s, f }: { s: GameState; f: Field }) {
  const c = f.crop!;
  const hands = s.workers.filter((w) => w.region === f.region && w.role === 'hand').length;
  const mine = s.machines.filter((m) => m.region === f.region && !m.broken && MACHINES[m.type].crops?.includes(c));
  const seats = Math.min(hands, mine.reduce((a, m) => a + (MACHINES[m.type].riders ?? 0), 0));
  const assist = mine.find((m) => MACHINES[m.type].assist)?.type;
  const drivers = Math.min(hands - seats, mine.filter((m) => MACHINES[m.type].haPerHour).length);
  const haPerHour = seats * (assist ? MACHINES[assist].assist! : 1) / CROPS[c].harvestHours + (hands - seats - drivers) / CROPS[c].harvestHours
    + mine.filter((m) => MACHINES[m.type].haPerHour).slice(0, drivers).reduce((a, m) => a + MACHINES[m.type].haPerHour!, 0);
  const days = haPerHour > 0 ? f.ha / haPerHour / (WORK_END - WORK_START) : Infinity;
  const cycle = CROPS[c].growthTicks / 24;
  const slow = days > cycle * 0.5;
  return (
    <p className={`small ${slow ? 'warn' : 'muted'}`} title="Assumes every hand in the region works this orchard, with average skill. Fruit left on the tree after ripening loses yield.">
      {Number.isFinite(days) ? <>Picking takes ~{days < 1 ? `${Math.max(1, Math.round(days * (WORK_END - WORK_START)))} h` : `${days.toFixed(1)} days`} with your {hands} hand{hands === 1 ? '' : 's'}{seats ? ` (${seats} on ${assist ? 'platforms' : 'machines'})` : ''}; fruit ripens every {cycle} days.</> : 'No hands to pick this fruit — hire some.'}
      {slow && ` ${c === 'grapes' ? 'Add hands or a grape harvester' : 'Add hands or orchard platforms'} to pick before it over-ripens.`}
    </p>
  );
}

/** Dedicate fields to one factory: they grow its crop, and the harvest is held in storage for it. */
function SupplyPicker({ s, fields }: { s: GameState; fields: Field[] }) {
  const r = fields[0].region;
  const mills = s.buildings.filter((b) => b.region === r && factoryCrop(b) && fields.every((f) => f.region === r));
  if (!mills.length) return null;
  const value = fields.every((f) => f.supplies === fields[0].supplies) ? String(fields[0].supplies ?? '') : 'mixed';
  const label = (b: (typeof mills)[number]) => `${BUILDINGS[b.type].name}${mills.filter((x) => x.type === b.type).length > 1 ? ` #${mills.filter((x) => x.type === b.type).indexOf(b) + 1}` : ''} (${GOODS[factoryCrop(b)!].name.toLowerCase()})`;
  return (
    <div className="row between wrap">
      <span className="small muted">Supplies factory <Info text="A dedicated field always grows its factory's crop, and its harvest is reserved in storage for that factory: auto-selling, rules and the Sell buttons leave it alone, and the factory uses it first." /></span>
      <select className="input" aria-label="Supplies factory" value={value} onChange={(e) => act({ type: 'supplyFactory', fieldIds: fields.map((f) => f.id), buildingId: e.target.value ? Number(e.target.value) : null })}>
        {value === 'mixed' && <option value="mixed" disabled>Mixed</option>}
        <option value="">None — sell on the market</option>
        {mills.map((b) => <option key={b.id} value={b.id} disabled={!fields.every((f) => canGrow(f, factoryCrop(b)!))}>{label(b)}</option>)}
      </select>
    </div>
  );
}

function PlanPicker({ s, fields }: { s: GameState; fields: Field[] }) {
  const mill = fields.every((f) => f.supplies) ? s.buildings.find((b) => b.id === fields[0].supplies) : undefined;
  if (mill) return <div className="row between wrap" data-coach="plan-picker"><span className="small muted">Crop plan</span><span className="small">🔒 {GOODS[factoryCrop(mill)!].name} for the {BUILDINGS[mill.type].name.toLowerCase()}</span></div>;
  const value = fields.every((f) => f.plan === fields[0].plan) ? fields[0].plan ?? '' : 'mixed';
  const locked = fields.every((f) => f.planLocked);
  return (
    <div className="row between wrap" data-coach="plan-picker">
      <span className="small muted">Crop plan <Info text="Workers plant fields that have a plan, and keep replanting the same crop after each harvest. With a manager and the auto-rotate policy, the manager chooses for you — unless you lock the plan." /></span>
      {(s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'industry')) && <button className={`btn ${locked ? 'primary' : 'ghost'} sm`} aria-pressed={locked} title={locked ? 'Locked: managers and rules keep this plan. Click to unlock.' : 'Lock this plan so managers and rules never change it'}
        onClick={() => act({ type: 'lockPlan', fieldIds: fields.map((f) => f.id), locked: !locked })}>{locked ? '🔒 Locked' : '🔓 Lock'}</button>}
      <select className="input" aria-label="Crop plan" value={value} onChange={(e) => act({ type: 'setPlan', fieldIds: fields.map((f) => f.id), crop: (e.target.value || null) as CropId | null })}>
        {value === 'mixed' && <option value="mixed" disabled>Mixed</option>}
        <option value="">No plan (leave fallow)</option>
        {s.unlockedCrops.map((c) => <option key={c} value={c} disabled={!fields.every((f) => canGrow(f, c))}>{GOODS[c].name}</option>)}
      </select>
    </div>
  );
}

function SoilPanel({ s, f }: { s: GameState; f: Field }) {
  const fert = fertility(f);
  const tested = has(s, 'soilTesting');
  const fertNeed=spreadNeed(s,f,'fertilizer'),spreadFee=spreadingCost(s,f);
  const inv = s.regions[f.region].inventory;
  return (
    <div className="stack s" data-coach="soil-panel" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row between">
        <h3>Soil & water</h3>
        <div className="row">
          {f.greenhouse ? <span className="pill accent">Greenhouse</span> : known(s, 'frost') && f.ha <= 5 && <Confirm label={`Greenhouse · ${money(greenhousePrice(s, f.ha))}`} className="btn ghost sm" title="Build a greenhouse?" body="Glass over the whole field: no frost, steady warmth and watering, slightly better quality. Heating uses electricity whenever it is below 12°C." onConfirm={() => act({ type: 'greenhouse', fieldIds: [f.id] })} confirmLabel="Build" />}
          {!f.greenhouse && (f.irrigated ? <span className="pill accent">Irrigated</span> : <button className="btn ghost sm" onClick={() => act({ type: 'irrigate', fieldIds: [f.id] })}>Irrigate · {money(irrigationPrice(s, f.ha))}</button>)}
        </div>
      </div>
      <Meter label="Fertility" value={fert} info="Average of nitrogen, phosphorus and potassium relative to what crops need. Every harvest removes nutrients; resting, soybeans, manure and fertiliser restore them." tone={fert < 0.5 ? 'down' : fert < 0.75 ? 'warn' : 'up'} />
      {tested ? (
        <div className="grid3" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {(['n', 'p', 'k', 'organic'] as const).map((k) => <div key={k} className="kpi"><span>{{ n: 'Nitrogen', p: 'Phosph.', k: 'Potass.', organic: 'Organic' }[k]}</span><strong className="mono" style={{ fontSize: 14 }}>{pct0(f.soil[k] / (k === 'organic' ? 1 : 0.7))}</strong></div>)}
        </div>
      ) : <p className="faint small">Research soil testing to see nitrogen, phosphorus, potassium and organic matter.</p>}
      <Meter label="Soil moisture" value={f.moisture} info={`Rain sets the soil's water level; heat dries it. ${f.crop ? `${GOODS[f.crop].name} grows best around ${pct0(CROPS[f.crop].water)}.` : ''} Irrigation tops it up to ${pct0(s.automation.policies.irrigateMin)} at a water cost.`} color="#5aa3c8" />
      {f.pest > 0.05 && <Meter label="Pest pressure" value={f.pest} info={f.crop && CROPS[f.crop].perennial ? 'Pests build while the trees bear fruit, faster in heat. Each harvest halves them, and they die back while the orchard rests in winter.' : `Pests build while crops grow, faster in heat and in monocultures (this field has grown the same crop ${f.streak + 1}× in a row). Resting or rotating clears them.`} tone="down" />}
      {f.spreading ? <p className="small">🧪 {f.spreading === 'manure' ? 'Manure' : 'Fertiliser'} is waiting for your crew to spread it ({pct0(f.spreadWork)} done){f.crop ? ' — after the harvest' : ''}. Tractors do it fastest; it goes on before the next sowing.</p> : (
      <div className="row wrap">
        <button className="btn ghost sm" disabled={inv.fertilizer < fertNeed||spreadFee>s.cash} onClick={() => act({ type: 'fertilize', fieldIds: [f.id], source: 'fertilizer' })} title={`Uses ${fertNeed} fertiliser from storage (${num(inv.fertilizer)} held). Buy it on the Markets page.`}>Spread · {num(fertNeed)} fertiliser{spreadFee>0?` · ${money(spreadFee)}`:''}</button>
        {inv.manure >= f.ha * CONFIG.manurePerHa && <button className="btn ghost sm" disabled={spreadFee>s.cash} onClick={() => act({ type: 'fertilize', fieldIds: [f.id], source: 'manure' })}>Spread · {num(spreadNeed(s,f,'manure'))} manure{spreadFee>0?` · ${money(spreadFee)}`:''}</button>}
        {inv.fertilizer < fertNeed && <span className="faint small">{num(inv.fertilizer)} fertiliser in storage</span>}
      </div>)}
    </div>
  );
}

export const GradePill = ({ q }: { q: number }) => {
  const g = grade(q);
  return <span className={`pill ${g === 'A' ? 'good' : g === 'C' ? 'warn' : ''}`} title={`Quality ${pct0(q)} — sells at ${pct0(qualityMult(q))} of the standard price`}>Grade {g}</span>;
};

const Meter = ({ label, value, info, tone, color }: { label: string; value: number; info: string; tone?: 'up' | 'down' | 'warn'; color?: string }) => (
  <div className="stack s" style={{ gap: 3 }}>
    <div className="row between small"><span className="muted">{label} <Info text={info} /></span><span className={`mono ${tone ?? ''}`}>{pct0(value)}</span></div>
    <Bar value={value} thin color={color ?? (tone === 'down' ? 'var(--down)' : tone === 'warn' ? 'var(--warn)' : 'var(--up)')} label={label} />
  </div>
);

// ---------------------------------------------------------------- batch

export function BatchPanel({ s, fields }: { s: GameState; fields: Field[] }) {
  const ha = fields.reduce((a, f) => a + f.ha, 0);
  const unirrigated = fields.filter((f) => !f.irrigated);
  const batchSpreadFee=fields.reduce((n,f)=>n+spreadingCost(s,f),0);
  const avgFert = fields.reduce((a, f) => a + fertility(f) * f.ha, 0) / ha;
  return (
    <Card title={<>{fields.length} fields selected <span className="muted">{num(ha)} ha</span></>}>
      <div className="stack">
        <div className="kpis">
          <div className="kpi"><span>Avg fertility</span><strong className="mono">{pct0(avgFert)}</strong></div>
          <div className="kpi"><span>Growing</span><strong className="mono">{fields.filter((f) => f.crop).length}</strong></div>
          <div className="kpi"><span>Ready</span><strong className="mono">{fields.filter((f) => isReady(s, f)).length}</strong></div>
        </div>
        <PlanPicker s={s} fields={fields} />
        <SupplyPicker s={s} fields={fields} />
        <div className="row wrap">
          {(['fertilizer', 'manure'] as const).map((src) => {
            // poorest soil first, so a short supply goes where it matters most
            const todo = fields.filter((f) => !f.spreading).sort((a, b) => fertility(a) - fertility(b));
            const need = todo.reduce((n, f) => n + spreadNeed(s, f, src), 0), held = fields.length ? s.regions[fields[0].region].inventory[src] : 0;
            if (src === 'manure' && held < 1) return null;
            return <button key={src} className="btn ghost sm" disabled={!todo.length || held < 1} title={held < need ? `Enough for the poorest fields first; the rest are skipped.` : undefined}
              onClick={() => act({ type: 'fertilize', fieldIds: todo.map((f) => f.id), source: src })}>
              Spread {src === 'manure' ? 'manure' : 'fertiliser'} on all · {num(Math.min(need, held))}/{num(need)}{batchSpreadFee > 0 ? ` · up to ${money(batchSpreadFee)}` : ''}</button>;
          })}
          {unirrigated.length > 0 && <Confirm label={`Irrigate ${unirrigated.length} · ${money(irrigationPrice(s, unirrigated.reduce((a, f) => a + f.ha, 0)))}`} title="Install irrigation?" body={`Equip ${unirrigated.length} fields with irrigation. Water is then bought whenever soil moisture falls below ${pct0(s.automation.policies.irrigateMin)}.`} onConfirm={() => act({ type: 'irrigate', fieldIds: unirrigated.map((f) => f.id) })} />}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- selling

export function SellCard({ s, r }: { s: GameState; r: RegionId }) {
  // every crop you grow plus anything else you have in store (eggs, wool, wine, flour…); farm inputs are bought, not sold here
  const rows = GOOD_IDS.filter((g) => GOODS[g].kind !== 'input' && s.markets[r][g] && (s.regions[r].inventory[g] >= 1 || s.unlockedCrops.includes(g as CropId)));
  const st = stored(s, r);
  return (
    <Card title="Barn & market" coach="trader" className="reveal"
      info={`Prices follow supply and demand. Orders include a ${(DEALER_SPREAD*100).toFixed(1)}% dealer spread on each side and per-unit haulage; large orders move the price.`}>
      <div className="stack">
        <div className="stack s" style={{ gap: 3 }}>
          <div className="row between small"><span className="muted">Dry storage</span><span className="mono">{num(st.dry)} / {num(st.cap.dry)}</span></div>
          <Bar value={st.cap.dry ? st.dry / st.cap.dry : 1} thin color={st.dry > st.cap.dry * 0.85 ? 'var(--down)' : undefined} label="Dry storage used" />
          {st.dry >= st.cap.dry * 0.85 && <p className="callout warn small">{st.dry >= st.cap.dry - 1 ? <><b>Your barn is full.</b> Anything you harvest now is sold straight off the field at a knock-down price — sell some stock first to make room.</> : <><b>Your barn is almost full.</b> Sell some stock before your next harvest, or it will be sold off the field cheaply.</>}</p>}
          {st.cap.cold > 0 && <div className="row between small"><span className="muted">Cold storage</span><span className="mono">{num(st.cold)} / {num(st.cap.cold)}</span></div>}
        </div>
        {rows.map((g) => <SellRow key={g} s={s} r={r} g={g} />)}
      </div>
    </Card>
  );
}

/** The Homestead trades through one village stall; prices and the full exchange arrive later. */
export function HomesteadTraderCard({ s }: { s: GameState }) {
  const [fraction, setFraction] = useState(1);
  const state = homesteadState(s);
  const wheat = Math.floor(s.regions.heartland.inventory.wheat);
  const qty = Math.floor(wheat * fraction);
  return <Card title={<>🧺 Village trader <span className="muted">{state.mood >= 65 ? '· friendly' : state.mood <= 35 ? '· wary' : '· neutral'}</span></>} coach="trader">
    <div className="stack s">
      <div className="row between"><b>Mill buyer</b><span className="mono">${HOMESTEAD_MILL_PRICE.toFixed(2)} / wheat</span></div>
      <div className="row wrap">
        <Seg label="Wheat to sell" value={fraction} onChange={setFraction} options={[{ v: .25, label: '¼' }, { v: .5, label: '½' }, { v: 1, label: 'All' }]} />
        <span className="mono">📦 {num(wheat)} wheat · +{money(qty * HOMESTEAD_MILL_PRICE)}</span>
      </div>
      <button className="btn primary" disabled={!qty} onClick={() => act({ type: 'sellToMill', qty })}>Sell {num(qty)} wheat</button>
      <div className="trader-offers" aria-label="Today's barter offers">
        {state.offers.map((offer) => {
          const output = offer.give.kind === 'seed' ? `${num(offer.give.qty)} ${GOODS[offer.give.crop].name.toLowerCase()} seeds` : `${num(offer.give.qty)} ${GOODS[offer.give.good].name.toLowerCase()}`;
          return <article className={`trader-offer${offer.traded ? ' traded' : ''}`} key={offer.id}>
            <span className="trader-amount">{num(offer.takeQty)} {GOOD_ICON[offer.takeGood] ?? '📦'} {GOODS[offer.takeGood].name.toLowerCase()}</span><span className="trader-arrow">↔</span><span className="trader-amount">{output}</span>
            {offer.traded ? <span className="pill">Done</span> : <div className="row wrap">
              {!offer.haggled && <button className="btn ghost sm" onClick={() => act({ type: 'haggle', offerId: offer.id })}>Haggle</button>}
              <button className="btn gold sm" disabled={wheat < offer.takeQty || (offer.give.kind === 'good' && freeSpace(s, 'heartland', offer.give.good) < offer.give.qty)} onClick={() => act({ type: 'barter', offerId: offer.id })}>Trade</button>
            </div>}
          </article>;
        })}
      </div>
      <span className="faint small">Offers refresh each morning · one haggle per offer</span>
    </div>
  </Card>;
}

function SellRow({ s, r, g }: { s: GameState; r: RegionId; g: GoodId }) {
  const m = s.markets[r][g]!;
  const inv = s.regions[r].inventory[g];
  const [frac, setFrac] = useState(1);
  const held = reservedStock(s, r, g); // kept for factories by their dedicated fields
  const qty = Math.floor(Math.max(0, inv - held) * frac);
  const q = quoteSell(s, r, g, qty);
  return <div className="stock-choice">
    <div className="row between">
      <span className="crop-name"><span className="good-symbol" aria-hidden="true">{GOOD_ICON[g]??'📦'}</span>{GOODS[g].name}</span>
      <strong className="mono" title="Units in store">📦 {num(inv)}</strong>
    </div>
    {held>=1 && <span className="muted">🏭 {num(held)} reserved</span>}
    <div className="row between wrap">
      <Seg label="Amount to sell" value={frac} onChange={setFrac} options={[{v:.25,label:'¼'},{v:.5,label:'½'},{v:1,label:'All'}]}/>
      <Info text={`Sale value includes the ${(DEALER_SPREAD*100).toFixed(1)}% dealer bid spread, market impact and haulage. Reserved factory stock is protected.`} breakdown={[
        ['Market average (24h)',price(dayPrice(s,r,g))],['Execution price',price(q.avgPrice)],['Haulage',money(q.haul)],['Price after sale',price(q.priceAfter)],['Market impact',pct(m.price?q.priceAfter/m.price-1:0)]
      ]}/>
    </div>
    <RetailQuote s={s} region={r} good={g} qty={q.qty} retailQty={q.retailQty}/>
    <button className="btn primary" disabled={!q.qty} onClick={()=>act({type:'sell',region:r,good:g,qty:q.qty})}>{q.qty?`Sell ${num(q.qty)} → ${money(q.net)}`:'No unreserved stock'}</button>
    {known(s,'quality')&&inv>=1&&<span className="muted">Quality <GradePill q={s.regions[r].quality[g]??.65}/></span>}
  </div>;
}

// ---------------------------------------------------------------- land

export function LandCard({ s }: { s: GameState }) {
  const regions = unlockedRegions(s);
  const [r, setR] = useState<RegionId>('heartland');
  return (
    <Card title="Buy land" coach="buy-parcel" info="Parcels are cheaper per hectare than homestead plots but too large to work by hand. Each purchase in a region nudges its land price up 2%.">
      <div className="stack s">
        {regions.length > 1 && <Select label="Region" value={r} onChange={setR} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />}
        {CONFIG.parcelSizes.map((ha) => {
          const p = parcelPrice(s, r, ha);
          return (
            <div key={ha} className="row between">
              <span><b>{num(ha)} ha</b> <span className="muted small">{money(p / ha)}/ha</span></span>
              <Confirm label={money(p)} className="btn ghost sm" disabled={p > s.cash} title={`Buy ${ha} ha in ${REGIONS[r].name}?`} body={<>Costs <b>{money(p)}</b>. You will need workers{ha >= 25 ? ' and machines' : ''} to farm it, and a crop plan.</>} onConfirm={() => act({ type: 'buyParcel', region: r, ha })} confirmLabel="Buy" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function RecentLog({ s }: { s: GameState }) {
  return (
    <Card title="Activity">
      <ol className="log">
        {[...s.log].reverse().slice(0, 10).map((e) => (
          <li key={e.id} className={e.level}><span className="mono">{stamp(e.tick).slice(3)}</span><span>{e.text}</span></li>
        ))}
      </ol>
    </Card>
  );
}
