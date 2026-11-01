import { useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG, CROPS, GOODS, REGIONS, type CropId, type GoodId, type RegionId } from '../../simulation/config';
import { has, known, priceUsd, seasonOf, seedCost, stored } from '../../simulation/core';
import {
  canGrow, expectedYield, fertility, grade, greenhousePrice, growth, homePlotPrice, irrigationPrice, isManual, isMature, isReady, parcelPrice, qualityMult, quoteSell, seedShortfall, soilFactor, tempFactor, timingFactor, waterFactor, techFactor,
} from '../../simulation/engine';
import type { Field, GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { Sparkline } from '../Chart';
import { duration, money, num, pct, pct0, price, stamp } from '../format';
import { Bar, Card, Confirm, Info, Seg, Select, Swatch, Tip, usePref } from '../ui';
import { unlockedRegions } from './shared';

const W = 132, H = 92, GAP = 14, COLS = 4, PLANTS = 9;

export function FieldsPage() {
  const s = useGame();
  const regions = unlockedRegions(s).filter((r) => s.fields.some((f) => f.region === r));
  const [region, setRegion] = usePref<RegionId>('fields.region', 'heartland');
  const r = regions.includes(region) ? region : 'heartland';
  const fields = s.fields.filter((f) => f.region === r);
  const [sel, setSel] = useState<number[]>([fields[0]?.id ?? 1]);
  const [crop, setCrop] = useState<CropId>('wheat');
  const selected = s.fields.filter((f) => sel.includes(f.id));
  const one = selected.length === 1 ? selected[0] : null;
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
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="stack l">
          <Card
            title={<>Farm <span className="muted">{num(fields.reduce((a, f) => a + f.ha, 0))} ha{regions.length > 1 ? ` · ${REGIONS[r].name}` : ''}</span></>}
            actions={<>
              {regions.length > 1 && <Select label="Region" value={r} onChange={setRegion} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />}
              {readyPlots.length > 1 && <button className="btn ghost sm" onClick={() => readyPlots.forEach((f) => act({ type: 'harvest', fieldId: f.id }))} title="Shortcut: H">Harvest {readyPlots.length} ready</button>}
              {emptyPlots.length > 1 && <button className="btn ghost sm" onClick={() => emptyPlots.forEach((f) => act({ type: 'plant', fieldId: f.id, crop }))}>Plant {emptyPlots.length} empty with {GOODS[crop].name.toLowerCase()}</button>}
              {fields.length > 1 && s.era >= 2 && <button className="btn ghost sm" onClick={() => setSel(sel.length === fields.length ? [fields[0].id] : fields.map((f) => f.id))}>{sel.length === fields.length ? 'Clear selection' : 'Select all'}</button>}
            </>}
          >
            {fields.length > 24
              ? <FieldGrid s={s} fields={fields} sel={sel} onSelect={toggle} />
              : <FarmView s={s} fields={fields} sel={sel} onSelect={toggle} canBuy={r === 'heartland' && s.stats.sales > 0 && s.regions.heartland.homePlotsBought < CONFIG.homePlots} />}
            {s.era >= 2 && <p className="muted small" style={{ marginTop: 8 }}>Shift- or Ctrl-click to select several fields for batch actions.</p>}
          </Card>
          {selected.length > 1 ? <BatchPanel s={s} fields={selected} /> : one && <FieldPanel s={s} f={one} crop={crop} setCrop={setCrop} />}
        </div>
        <div className="stack l">
          {s.stats.harvests > 0 && <SellCard s={s} r={r} />}
          {s.era >= 3 && <LandCard s={s} />}
          {s.era < 3 && <RecentLog s={s} />}
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
  const cells = fields.length + (canBuy ? 1 : 0);
  const rows = Math.max(1, Math.ceil(cells / COLS));
  const width = COLS * W + (COLS - 1) * GAP;
  const height = rows * H + (rows - 1) * GAP;
  const pos = (i: number) => ({ x: (i % COLS) * (W + GAP), y: Math.floor(i / COLS) * (H + GAP) });
  const plotCost = homePlotPrice(s);
  return (
    <svg className="farm" viewBox={`-4 -4 ${width + 8} ${height + 8}`} role="group" aria-label="Your fields" style={{ maxHeight: rows > 6 ? 640 : undefined, overflow: 'auto' }}>
      {fields.map((f, i) => {
        const { x, y } = pos(i);
        const st = plotState(s, f);
        const crop = f.crop ? CROPS[f.crop] : null;
        const color = f.crop ? GOODS[f.crop].color : '';
        const label = crop ? (st.ready ? `${GOODS[f.crop!].name} · ready` : `${GOODS[f.crop!].name} · ${Math.floor(st.g * 100)}%`) : f.plan ? `Plan: ${GOODS[f.plan].name}` : 'Fallow';
        const activate = (multi: boolean) => onSelect(f.id, multi);
        return (
          <g key={f.id} transform={`translate(${x} ${y})`} data-coach={i === 0 ? 'field-1' : undefined}
            className={`plot${sel.includes(f.id) ? ' selected' : ''}${st.ready ? ' ready' : ''}${st.depleted ? ' depleted' : ''}${st.diseased ? ' diseased' : ''}`}
            role="button" tabIndex={0} aria-label={`Field ${f.id}, ${f.ha} hectares: ${label}`} aria-pressed={sel.includes(f.id)}
            onClick={(e) => activate(e.shiftKey || e.ctrlKey || e.metaKey)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), activate(e.shiftKey))}>
            <rect className="soil" width={W} height={H} rx={10} />
            {Array.from({ length: 4 }, (_, k) => <line key={k} className="furrow" x1={12} x2={W - 12} y1={18 + k * 15} y2={18 + k * 15} />)}
            {crop && Array.from({ length: 4 * PLANTS }, (_, k) => {
              const row = Math.floor(k / PLANTS), c = k % PLANTS;
              return <circle key={k} className="plant" cx={16 + c * ((W - 32) / (PLANTS - 1))} cy={18 + row * 15} r={1 + st.g * 3.6} fill={st.ready ? color : 'var(--sprout)'} opacity={0.45 + st.g * 0.55} />;
            })}
            {f.irrigated && <path className="water" d={`M${W - 16} 8 q4 6 0 9 q-4 -3 0 -9z`} />}
            <text className="plot-id" x={10} y={H - 8}>F{f.id}{f.ha > 1 ? ` · ${num(f.ha)} ha` : ''}</text>
            <text className="plot-label" x={W - 10} y={H - 8} textAnchor="end">{label}</text>
            {crop && !st.ready && <rect className="plot-progress" x={0} y={H - 3} height={3} width={W * st.g} rx={1.5} />}
          </g>
        );
      })}
      {canBuy && (() => {
        const { x, y } = pos(fields.length);
        const afford = s.cash >= plotCost;
        const buy = () => act({ type: 'buyPlot' });
        return (
          <g transform={`translate(${x} ${y})`} className={`plot buy${afford ? ' afford' : ''}`} role="button" tabIndex={0} data-coach="buy-plot"
            aria-label={`Buy another hectare for ${money(plotCost)}`} onClick={buy} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), buy())}>
            <rect width={W} height={H} rx={10} />
            <text x={W / 2} y={H / 2 - 4} textAnchor="middle" style={{ fontSize: 15 }}>+ 1 ha</text>
            <text x={W / 2} y={H / 2 + 16} textAnchor="middle" style={{ fontSize: 12 }}>{money(plotCost)}</text>
          </g>
        );
      })()}
    </svg>
  );
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
              <span className="ftile-crop" style={{ background: color, color: f.crop ? '#2a2110' : 'var(--muted)' }}>{f.crop ? GOODS[f.crop].name : f.plan ? GOODS[f.plan].name : '—'}</span>
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
            {CROPS[f.crop].perennial && <Confirm label="Uproot orchard" className="btn ghost sm" title="Uproot this orchard?" body="The trees are removed and the field becomes fallow. The years of growth are lost." onConfirm={() => act({ type: 'clearField', fieldId: f.id })} confirmLabel="Uproot" />}
          </>
        ) : (
          <>
            {manual && (
              <>
                <div className="crop-grid" role="radiogroup" aria-label="Crop to plant" data-coach="crop-picker">
                  {s.unlockedCrops.map((id) => <CropCard key={id} s={s} f={f} id={id} on={crop === id} pick={() => setCrop(id)} />)}
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
        {s.era >= 2 && <PlanPicker s={s} fields={[f]} />}
        {s.era >= 2 && <SoilPanel s={s} f={f} />}
        {f.lastHarvest && (
          <Tip text="Why this harvest came out as it did — every factor is from the simulation."
            breakdown={[['Base', num(f.lastHarvest.base)], ['Soil', f.lastHarvest.soil.toFixed(2)], ['Water', f.lastHarvest.water.toFixed(2)], ['Season/temp', f.lastHarvest.weather.toFixed(2)], ['Pests', f.lastHarvest.pest.toFixed(2)], ['Technology', f.lastHarvest.tech.toFixed(2)], ['Region fit', f.lastHarvest.suitability.toFixed(2)], ['Timing', f.lastHarvest.timing.toFixed(2)]]}>
            <p className="explain">Last harvest: <b style={{ color: 'var(--text)' }}>{num(f.lastHarvest.units)} {GOODS[f.lastHarvest.crop].name.toLowerCase()}</b> ({pct0(f.lastHarvest.units / Math.max(1, f.lastHarvest.base))} of potential){known(s, 'quality') && f.lastHarvest.quality !== undefined && <> · grade <GradePill q={f.lastHarvest.quality} /></>} — hover for why.</p>
          </Tip>
        )}
        {s.era >= 3 && s.fields.length > 1 && (
          <div className="row end">
            <Confirm label="Sell field" title={`Sell field ${f.id}?`} body={<>You will receive about <b>{money(f.cost * 0.85)}</b> (85% of what you paid). Any crop on it is lost.</>} onConfirm={() => act({ type: 'sellField', fieldId: f.id })} className="btn danger sm" confirmLabel="Sell" />
          </div>
        )}
      </div>
    </Card>
  );
}

function CropCard({ s, f, id, on, pick }: { s: GameState; f: Field; id: CropId; on: boolean; pick: () => void }) {
  const c = CROPS[id];
  const units = expectedYield(s, f, id);
  const p = priceUsd(s, f.region, id);
  const seed = f.ha * CONFIG.seedsPerHa * seedCost(s, id);
  const perHour = (units * p - seed) / c.growthTicks;
  const ok = canGrow(f, id);
  return (
    <button role="radio" aria-checked={on} className={`crop ${on ? 'on' : ''}`} onClick={pick} disabled={!ok} title={ok ? undefined : 'Cannot grow in this region'}>
      <span className="crop-name"><Swatch color={GOODS[id].color} />{GOODS[id].name}</span>
      <dl>
        <dt>Grows</dt><dd>{c.growthTicks}h</dd>
        <dt>Seed</dt><dd>{money(seed)}</dd>
        <dt>Yield now</dt><dd>~{num(units)}</dd>
        <dt>Price</dt><dd>{price(p)}</dd>
        <dt title="Expected profit per in-game hour at today's price and conditions, before price impact and labour">Profit/h</dt><dd className={perHour < 0 ? 'down' : ''}>{money(perHour)}</dd>
      </dl>
      <span className="small muted" style={{ display: 'block', marginTop: 4 }}>
        {c.perennial ? `Orchard: fruit after ${c.perennial.matureDays} days, then every ${c.growthTicks}h for years` : `Best in ${c.bestSeasons.join(', ').toLowerCase()}`}
      </span>
      {!c.frostHardy && !f.greenhouse && (seasonOf(s) === 'Winter' || seasonOf(s) === 'Autumn') && <span className="small warn">❄ Frost-tender</span>}
      {s.seeds[id] > 0 && <span className="small up">{num(s.seeds[id])} seeds in stock</span>}
    </button>
  );
}

function PlanPicker({ s, fields }: { s: GameState; fields: Field[] }) {
  const value = fields.every((f) => f.plan === fields[0].plan) ? fields[0].plan ?? '' : 'mixed';
  return (
    <div className="row between wrap" data-coach="plan-picker">
      <span className="small muted">Crop plan <Info text="Workers plant fields that have a plan, and keep replanting the same crop after each harvest. With a manager and the auto-rotate policy, the manager chooses for you." /></span>
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
  const fertNeed = Math.ceil(f.ha * CONFIG.fertilizerPerHa * (has(s, 'precisionFert') ? 0.7 : 1));
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
      {f.pest > 0.05 && <Meter label="Pest pressure" value={f.pest} info={`Pests build while crops grow, faster in heat and in monocultures (this field has grown the same crop ${f.streak + 1}× in a row). Resting or rotating clears them.`} tone="down" />}
      <div className="row wrap">
        <button className="btn ghost sm" disabled={inv.fertilizer < fertNeed} onClick={() => act({ type: 'fertilize', fieldIds: [f.id], source: 'fertilizer' })} title={`Uses ${fertNeed} fertiliser from storage (${num(inv.fertilizer)} held). Buy it on the Markets page.`}>Spread fertiliser ({fertNeed})</button>
        {inv.manure >= f.ha * CONFIG.manurePerHa && <button className="btn ghost sm" onClick={() => act({ type: 'fertilize', fieldIds: [f.id], source: 'manure' })}>Spread manure ({num(f.ha * CONFIG.manurePerHa)})</button>}
        {inv.fertilizer < fertNeed && <span className="faint small">{num(inv.fertilizer)} fertiliser in storage</span>}
      </div>
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
        <div className="row wrap">
          <button className="btn ghost sm" onClick={() => act({ type: 'fertilize', fieldIds: fields.map((f) => f.id), source: 'fertilizer' })}>Spread fertiliser on all</button>
          {unirrigated.length > 0 && <Confirm label={`Irrigate ${unirrigated.length} · ${money(irrigationPrice(s, unirrigated.reduce((a, f) => a + f.ha, 0)))}`} title="Install irrigation?" body={`Equip ${unirrigated.length} fields with irrigation. Water is then bought whenever soil moisture falls below ${pct0(s.automation.policies.irrigateMin)}.`} onConfirm={() => act({ type: 'irrigate', fieldIds: unirrigated.map((f) => f.id) })} />}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- selling

export function SellCard({ s, r }: { s: GameState; r: RegionId }) {
  const goods = useMemo(() => [...s.unlockedCrops, 'flour', 'feed', 'bread', 'meat', 'milk', 'cheese', 'butter', 'soyoil', 'soymeal', 'sugar', 'greens'] as GoodId[], [s.unlockedCrops]);
  const rows = goods.filter((g) => s.markets[r][g] && (s.regions[r].inventory[g] >= 1 || s.unlockedCrops.includes(g as CropId)));
  const st = stored(s, r);
  return (
    <Card title="Barn & market" coach="sell-card" className="reveal"
      info="Prices move with supply and demand. Selling a lot at once depresses the price for a while; haulage to market is charged per unit.">
      <div className="stack">
        <div className="stack s" style={{ gap: 3 }}>
          <div className="row between small"><span className="muted">Dry storage</span><span className="mono">{num(st.dry)} / {num(st.cap.dry)}</span></div>
          <Bar value={st.cap.dry ? st.dry / st.cap.dry : 1} thin color={st.dry > st.cap.dry * 0.85 ? 'var(--down)' : undefined} label="Dry storage used" />
          {st.cap.cold > 0 && <div className="row between small"><span className="muted">Cold storage</span><span className="mono">{num(st.cold)} / {num(st.cap.cold)}</span></div>}
        </div>
        {rows.map((g) => <SellRow key={g} s={s} r={r} g={g} />)}
      </div>
    </Card>
  );
}

function SellRow({ s, r, g }: { s: GameState; r: RegionId; g: GoodId }) {
  const m = s.markets[r][g]!;
  const inv = s.regions[r].inventory[g];
  const [frac, setFrac] = useState(1);
  const qty = Math.floor(inv * frac);
  const q = quoteSell(s, r, g, qty);
  const dayAgo = m.history[Math.max(0, m.history.length - 1 - 24 / CONFIG.priceHistoryEvery)] ?? m.price;
  const change = m.price / dayAgo - 1;
  return (
    <div className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row between wrap">
        <span className="crop-name"><Swatch color={GOODS[g].color} />{GOODS[g].name}</span>
        <div className="row">
          <Sparkline data={m.history} color={GOODS[g].color} w={90} h={26} />
          <span className="mono">{price(m.price)}</span>
          <span className={`mono small ${change >= 0 ? 'up' : 'down'}`} title="Change over the last in-game day" style={{ minWidth: 52, textAlign: 'right' }}>{pct(change)}</span>
        </div>
      </div>
      <div className="row between wrap">
        <span className="muted small">In store <b className="mono" style={{ color: 'var(--text)' }}>{num(inv)}</b>{known(s, 'quality') && inv >= 1 && <> · <GradePill q={s.regions[r].quality[g] ?? 0.65} /></>}</span>
        <div className="row">
          <Seg label="Amount to sell" value={frac} onChange={setFrac} options={[{ v: 0.25, label: '25%' }, { v: 0.5, label: '50%' }, { v: 1, label: 'All' }]} />
          <button className="btn primary sm" disabled={!q.qty} onClick={() => act({ type: 'sell', region: r, good: g, qty: q.qty })}>{q.qty ? `Sell ${num(q.qty)} → ${money(q.net)}` : 'Nothing to sell'}</button>
        </div>
      </div>
      {q.qty > 0 && (
        <p className="small muted" style={{ textAlign: 'right' }}>
          Avg {price(q.avgPrice)}/unit · price impact <span className="down">{pct(q.priceAfter / m.price - 1)}</span>{q.haul > 0.5 ? ` · haulage ${money(q.haul)}` : ''}{q.limitedBy ? ` · ${q.limitedBy}` : ''}
        </p>
      )}
    </div>
  );
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
