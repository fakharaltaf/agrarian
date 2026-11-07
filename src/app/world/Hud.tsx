import {cityActive} from '../../simulation/city-state';
import { townOf } from '../../simulation/town-state';
// Everything that floats over the world: objective, selection panel, market, land, region switcher.
import { useEffect, useRef, useState } from 'react';
import { ANIMALS, ANIMAL_IDS, BUILDINGS, CONFIG, ERAS, GOODS, REGIONS, type CropId, type RegionId } from '../../simulation/config';
import { known } from '../../simulation/core';
import { buildingMargin } from '../../simulation/processing';
import { DISCOVERIES, ERA_UNLOCK_TEXT, dailyGoals, dailyPrize, forecast, herdOf, homePlotPrice, housing, isManual, isReady, objective, PAGES, seedShortfall, upgradeCost } from '../../simulation/engine';
import type { GameState } from '../../simulation/types';
import { act, go, useGame, usePageState } from '../../stores/game';
import { money, num, pct0 } from '../format';
import { BatchPanel, FieldPanel, HomesteadTraderCard, RecentLog, SellCard } from '../pages/Fields';
import { NEXT_STAGE, STAGES, stageAtLeast } from '../../simulation/stages';
import { unlockedRegions } from '../pages/shared';
import { Bar, Card, Confirm, Modal, Select, usePref } from '../ui';
import { AdvisorPill } from '../Advisor';
import { Scene3D, type WorldPick } from './Scene3D';
import { layoutRegion, type Lot } from './layout';
import { communityOf, population, homeCapacity } from '../../simulation/community-state';

function EraBanner({ s }: { s: GameState }) {
  const [open, setOpen] = useState(false);
  const oldChapter = s.legacyProgression && !communityOf(s).active;
  const nextId = oldChapter ? null : NEXT_STAGE[s.stageId];
  const next = oldChapter ? ERAS[s.era] : null;
  const title = oldChapter ? `Era ${s.era + 1}: ${next?.name ?? 'Frontier'}` : STAGES[nextId ?? s.stageId].title;
  const theme = next?.theme ?? (nextId === 'market-town' ? 'Surplus outgrows barter. The village opens its first market day.' : nextId === 'farm-business' ? 'Bring in a crew, plan the fields and manage the new costs.' : nextId === 'industry' ? 'Machines and processing turn a farm business into an industry.' : 'A new chapter is ready. Your farm keeps running behind you.');
  const unlocks = oldChapter ? ERA_UNLOCK_TEXT[s.era + 1] ?? [] : nextId === 'market-town' ? ['Open commodity market and daily market day', 'Keep the village trader as a side channel'] : nextId === 'farm-business' ? ['Farm hands, managers and crop plans', 'Soil care, livestock, orchards and seasons'] : nextId === 'industry' ? ['Tractors, processing and energy', 'Research and larger parcels'] : nextId==='settlement'?['Housing, families and local jobs','Feed your community from the farm']:nextId==='town'?['Schools, clean water and healthcare','A separate public treasury and council']:nextId==='city'?['Sanitation, lighting and district zoning','A safety charter and justice choices']:nextId==='region'?['Four neighbours with leaders and trust','Caravans, raids, watchtowers and a border policy']:['New systems arrive here as the story expands.'];
  const chooseTrader = (charter: 'fair' | 'shrewd') => {
    if (!act({ type: 'chooseCharter', charter })) return;
    if (act({ type: 'advanceEra' })) setOpen(false);
  };
  return (
    <>
      <button className="hud-era" data-coach="advance" onClick={() => setOpen(true)}>
        <span className="objective-tag">Ready</span>
        <b>{title}</b>
        <span>Preview & advance →</span>
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)} actions={nextId === 'market-town' && !oldChapter
          ? <button className="btn ghost" onClick={() => setOpen(false)}>Not yet</button>
          : <><button className="btn ghost" onClick={() => setOpen(false)}>Not yet</button><button className="btn primary" onClick={() => { if(nextId === 'settlement') go('community'); else if(nextId==='town') go('town'); else if(nextId==='city')go('city'); else if(nextId==='region')go('region'); else act({ type: 'advanceEra' }); setOpen(false); }}>Begin chapter</button></>}>
          <p className="muted">{theme}</p>
          <ul>{unlocks.map((t) => <li key={t}>{t}</li>)}</ul>
          {nextId === 'market-town' && !oldChapter ? <>
            <div className="charter-heading"><b>Choose your trader charter</b><span>Permanent · no other feature is closed</span></div>
            <div className="charter-grid">
              <article className="charter-tile fair">
                <div className="charter-crest">🤝</div><h3>Fair</h3>
                <p>Villagers trust you.</p>
                <strong>+10% barter goods · +4 reputation</strong>
                <span>Opens with a friendly trader.</span>
                <button className="btn primary" onClick={() => chooseTrader('fair')}>Choose Fair</button>
              </article>
              <article className="charter-tile shrewd">
                <div className="charter-crest">🪙</div><h3>Shrewd</h3>
                <p>Push harder in a bargain.</p>
                <strong>+20 points to haggle chance</strong>
                <span>Reputation −8 · trader starts wary.</span>
                <button className="btn gold" onClick={() => chooseTrader('shrewd')}>Choose Shrewd</button>
              </article>
            </div>
          </> : <p className="small muted">Nothing changes until you choose. Your earlier operation keeps running.</p>}
        </Modal>
      )}
    </>
  );
}

/** One explanation card per newly discovered mechanic, shown once. */
function DiscoveryCard({ s }: { s: GameState }) {
  const d = DISCOVERIES.find((x) => s.discovered.includes(x.id) && !s.seenTips.includes(`disc:${x.id}`));
  if (!d) return null;
  const seen = () => act({ type: 'seeTip', tip: `disc:${d.id}` });
  return (
    <Modal title={`New: ${d.title}`} onClose={seen} actions={<>
      {d.page && PAGES.find((p) => p.id === d.page)?.unlocked(s) && <button className="btn ghost" onClick={() => (seen(), go(d.page!))}>Show me</button>}
      <button className="btn primary" autoFocus onClick={seen}>Got it</button>
    </>}>
      <p>{d.text}</p>
    </Modal>
  );
}

const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the player's own time zone

function DailyGoals({ s }: { s: GameState }) {
  const [open, setOpen] = usePref('daily.open', true);
  useEffect(() => {
    const start = () => s.daily?.key !== todayKey() && act({ type: 'startDay', key: todayKey() });
    start();
    const t = setInterval(start, 60_000);
    return () => clearInterval(t);
  }, [s.daily?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const goals = dailyGoals(s);
  if (!s.daily || !goals.length) return null;
  const done = goals.every((g) => g.progress >= g.target);
  const claimed = s.daily.claimed;
  return (
    <section className="hud-daily" aria-label="Today's goals">
      <button className="hud-daily-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{claimed ? '✅' : '🎯'} Today’s goals</b>
        <span className="muted small">{s.daily.streak > 0 && `🔥 ${s.daily.streak}-day streak · `}{goals.filter((g) => g.progress >= g.target).length}/3 {open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="stack s">
          {goals.map((g) => (
            <div key={g.id} className="stack s" style={{ gap: 2 }}>
              <div className="row between small"><span>{g.progress >= g.target ? '✔ ' : ''}{g.text}</span><span className="mono muted">{g.id === 'sell' ? money(Math.min(g.progress, g.target)) : `${Math.min(g.progress, g.target)}/${g.target}`}</span></div>
              <Bar thin value={g.progress / g.target} color={g.progress >= g.target ? 'var(--up)' : 'var(--sun)'} label={g.text} />
            </div>
          ))}
          {claimed ? <p className="small muted">Prize collected — new goals tomorrow.</p>
            : <button className="btn gold sm" disabled={!done} onClick={() => act({ type: 'claimDaily', key: s.daily!.key })}>{done ? `Claim ${money(dailyPrize(s))} prize` : `Prize: ${money(dailyPrize(s))}`}</button>}
        </div>
      )}
    </section>
  );
}

function ForecastStrip({ s, r }: { s: GameState; r: RegionId }) {
  const days = forecast(s, r);
  const today = s.regions[r];
  const cell = (label: string, temp: number, rain: number, frost: boolean, key: string) => (
    <div key={key} className={`fc-day${frost ? ' frost' : ''}`} title={`${Math.round(temp)}°C · ${rain > 1 ? 'heavy rain' : rain > 0.6 ? 'rain' : rain > 0.3 ? 'showers' : 'dry'}${frost ? ' · frost tonight' : ''}`}>
      <span className="fc-label">{label}</span>
      <span className="fc-icon">{frost ? '❄' : rain > 0.8 ? '🌧' : rain > 0.4 ? '⛅' : '☀'}</span>
      <span className="mono">{Math.round(temp)}°</span>
    </div>
  );
  return (
    <section className="hud-forecast" aria-label="Weather forecast">
      {cell('Today', today.temp, today.rainToday, today.frostTonight, 't')}
      {days.map((d, i) => cell(['Tmrw', '+2', '+3', '+4'][i], d.temp, d.rain, d.frost, `d${i}`))}
    </section>
  );
}

export function Hud() {
  const s = useGame();
  const regions = unlockedRegions(s).filter((r) => r === 'heartland' || s.fields.some((f) => f.region === r) || s.buildings.some((b) => b.region === r));
  const [regionPref, setRegion] = usePref<RegionId>('world.region', 'heartland');
  const region = regions.includes(regionPref) ? regionPref : 'heartland';
  const [sel, setSel] = useState<number[]>(() => (s.fields[0] ? [s.fields[0].id] : []));
  const [lot, setLot] = useState<Lot | null>(null);
  const [crop, setCrop] = useState<CropId>('wheat');
  const [panel, setPanel] = useState(false);
  const [journal, setJournal] = useState(false);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const page = usePageState();
  const live = useRef({ s, sel, crop });
  live.current = { s, sel: lot ? [] : sel, crop };
  const firstHomesShown = useRef(false);
  const communityPlaces = homeCapacity(s);
  useEffect(() => {
    if (firstHomesShown.current || !communityOf(s).active || !communityPlaces) return;
    const first = layoutRegion(s, 'heartland').lots.find(x => x.key.startsWith('community:'));
    if (first) { firstHomesShown.current = true; setRegion('heartland'); setSel([]); setLot(first); }
  }, [communityPlaces]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstServicesShown=useRef(false),serviceGroups=townOf(s).services.length;
  useEffect(()=>{
    if(firstServicesShown.current||!serviceGroups||!townOf(s).active)return;
    const first=layoutRegion(s,'heartland').lots.find(x=>x.key.startsWith('civic:')&&x.key!=='civic:hall');
    if(first){firstServicesShown.current=true;setRegion('heartland');setSel([]);setLot(first);}
  },[serviceGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstCityShown=useRef(false),cityGroups=townOf(s).services.filter(b=>['sanitation','lighting','police'].includes(b.type)).length;
  useEffect(()=>{
    if(firstCityShown.current||!cityGroups||!cityActive(s))return;
    const first=layoutRegion(s,'heartland').lots.find(x=>x.service&&['sanitation','lighting','police'].includes(x.service.type));
    if(first){firstCityShown.current=true;setRegion('heartland');setSel([]);setLot(first);}
  },[cityGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the selection valid; in the homestead always have the field selected so its controls are visible
  useEffect(() => {
    const valid = sel.filter((id) => s.fields.some((f) => f.id === id && f.region === region));
    if (valid.length !== sel.length || (!valid.length && !lot && s.era < 3)) setSel(valid.length ? valid : s.fields.filter((f) => f.region === region).slice(0, 1).map((f) => f.id));
  }, [s.fields.length, region]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard: P plant selected plot, H harvest every ready hand-worked plot, B buy a plot
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, [role=dialog]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const L = live.current;
      const one = L.sel.length === 1 ? L.s.fields.find((f) => f.id === L.sel[0]) : undefined;
      if (e.key === 'p' && one && !one.crop) act({ type: 'plant', fieldId: one.id, crop: L.crop });
      else if (e.key === 'h') L.s.fields.filter((f) => isManual(f) && isReady(L.s, f)).forEach((f) => act({ type: 'harvest', fieldId: f.id }));
      else if (e.key === 'b') act({ type: 'buyPlot' });
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const onPick = (p: WorldPick) => {
    setPanel(false);
    setJournal(false);
    if (p.kind === 'field') {
      setLot(null);
      const f = s.fields.find((x) => x.id === p.id);
      // Play on the farm: a ripe hand-worked plot harvests on click; an empty one plants on a second click (or double-click).
      if (!p.multi && f && isManual(f)) {
        if (isReady(s, f)) act({ type: 'harvest', fieldId: f.id });
        else if (!f.crop && sel.length === 1 && sel[0] === f.id) act({ type: 'plant', fieldId: f.id, crop });
      }
      setSel((cur) => (p.multi ? (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]) : [p.id]));
    } else if (p.kind === 'lot') {
      setLot(p.lot);
      setSel([]);
    } else if (p.kind === 'buy') act({ type: 'buyPlot' });
    else if (s.era >= 3) (setLot(null), setSel([]));
  };

  const selected = lot ? [] : s.fields.filter((f) => sel.includes(f.id));
  const one = selected.length === 1 ? selected[0] : null;
  const readyPlots = s.fields.filter((f) => f.region === region && isManual(f) && isReady(s, f));
  const plotPrice = homePlotPrice(s);
  const canBuyPlot = region === 'heartland' && s.stats.sales > 0 && s.regions.heartland.homePlotsBought < CONFIG.homePlots;
  const liveLot = lot && (lot.type === 'house' || lot.type === 'shed' ? lot : { ...lot, buildings: s.buildings.filter((b) => b.region === region && b.type === lot.type) });

  return (
    <div className="hud">
      <DiscoveryCard s={s} />
      <Scene3D region={region} selected={lot ? [] : sel} onPick={onPick} plantLabel={plantLabel(s, crop, one)}
        selectedLot={lot?.key} onAction={(kind, id) => {
          if(kind==='plant'||kind==='harvest') act(kind==='harvest'?{type:'harvest',fieldId:id}:{type:'plant',fieldId:id,crop});
          else if(kind==='place' && lot){
            const target=lot.service?.type==='watchtower'?'region':lot.service&&['sanitation','lighting','police'].includes(lot.service.type)?'city':lot.key.startsWith('civic:')?'town':lot.key.startsWith('community:')?'community':lot.key==='crew'?'workers':lot.key==='office'?'automation':lot.key==='market'?'markets':lot.type==='house'||lot.type==='shed'?'finance':LOT_PAGE[BUILDINGS[lot.type].category];
            if(target && PAGES.find(p=>p.id===target)?.unlocked(s))go(target);else {setPanel(true);setJournal(false);}
          } else {setPanel(true);setJournal(false); if(kind==='plan') requestAnimationFrame(()=>document.querySelector('[data-coach=plan-picker]')?.scrollIntoView({block:'center'}));}
        }} />
      <div className={`hud-left${journal ? ' journal-open' : ''}`} hidden={page !== 'farm'}>
        <ObjectiveCard s={s} />
        <div id="coach-slot" className="coach-slot" />
        <button className="btn hud-journal-toggle" aria-expanded={journal} onClick={() => { setJournal(!journal); setPanel(false); }}>📖 {journal ? 'Close journal' : 'Farm journal'}</button>
        {journal && <div className="hud-journal stack">
        {s.eraReady && <EraBanner s={s} />}
        <AdvisorPill s={s} />
        {known(s, 'forecast') && <ForecastStrip s={s} r={region} />}
        {s.stats.sales > 0 && <DailyGoals s={s} />}
        <div className="hud-actions">
          {regions.length > 1 && <Select label="Region shown" value={region} onChange={(r) => (setRegion(r), setSel([]), setLot(null))} options={regions.map((r) => ({ v: r, label: REGIONS[r].name }))} />}
          {readyPlots.length > 1 && <button className="btn gold sm" onClick={() => readyPlots.forEach((f) => act({ type: 'harvest', fieldId: f.id }))} title="Shortcut: H">Harvest {readyPlots.length} ready</button>}
          {canBuyPlot && <button className="btn ghost sm" data-coach="buy-plot" disabled={s.cash < plotPrice} onClick={() => act({ type: 'buyPlot' })} title="Shortcut: B">Buy 1 ha · {money(plotPrice)}</button>}
          {stageAtLeast(s, 'farm-business') && <button className="btn ghost sm" onClick={() => go('fields')}>All fields</button>}
        </div>
        {(s.legacyProgression ? s.era < 3 : !stageAtLeast(s, 'industry')) && page === 'farm' && <div className="hud-log"><RecentLog s={s} /></div>}
        </div>}
      </div>
      {page === 'farm' && (
        <aside className={`hud-panel${panel ? '' : ' closed'}`} aria-label="Selection">
          <button className="hud-toggle" onPointerDown={e => { dragStart.current = e.clientY; dragged.current = false; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { if (dragStart.current !== null && e.clientY - dragStart.current > 45) { dragged.current = true; setPanel(false); } dragStart.current = null; }} onClick={() => { if (dragged.current) { dragged.current = false; return; } setPanel(!panel); setJournal(false); }} aria-expanded={panel} aria-label={panel ? 'Hide panel' : 'Show panel'}>{panel ? '━  Close' : 'Inspect'}</button>
          {panel && (
            <div className="stack">
              {liveLot ? <LotPanel s={s} region={region} lot={liveLot} onClose={() => setLot(null)} />
                : selected.length > 1 ? <BatchPanel s={s} fields={selected} />
                  : one ? <FieldPanel s={s} f={one} crop={crop} setCrop={setCrop} />
                    : <Card title="Your farm"><p className="explain">Click a field or building to manage it. Drag to look around, scroll to zoom. Shift-click to select several fields.</p></Card>}
              {s.stats.harvests > 0 && liveLot?.key !== 'market' && (s.legacyProgression || stageAtLeast(s, 'market-town') ? <SellCard s={s} r={region} /> : <HomesteadTraderCard s={s} />)}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function plantLabel(s: GameState, crop: CropId, f: GameState['fields'][number] | null) {
  if (!f || f.crop || !isManual(f)) return undefined;
  const c = seedShortfall(s, f, crop);
  return `Plant ${GOODS[crop].name.toLowerCase()}${c.short ? ` · ${money(c.cost)}` : ''}`;
}

function ObjectiveCard({ s }: { s: GameState }) {
  const o = objective(s);
  const target = o.page && PAGES.find((p) => p.id === o.page)?.unlocked(s) && !['fields', 'farm'].includes(o.page) ? o.page : null;
  return (
    <section className="hud-objective" aria-live="polite">
      <span className="objective-tag">Objective</span>
      <strong>{o.title}</strong>
      <span className="muted small">{o.hint}</span>
      {target && <button className="btn ghost sm" onClick={() => go(target)}>Go →</button>}
    </section>
  );
}

const LOT_PAGE: Partial<Record<string, string>> = { storage: 'storage', processing: 'production', energy: 'production', commerce: 'production', research: 'research', livestock: 'livestock' };

function HerdInfo({ s, lot }: { s: GameState; lot: Lot }) {
  const animal = ANIMAL_IDS.find((a) => ANIMALS[a].building === lot.type)!;
  const region = lot.buildings[0]?.region ?? 'heartland';
  const h = herdOf(s, region, animal);
  const cap = housing(s, region, animal);
  return (
    <div className="stack s">
      <dl className="facts">
        <dt>{ANIMALS[animal].name}</dt><dd>{num(Math.floor(h?.count ?? 0))} / {num(cap)}</dd>
        {h && <><dt>Health</dt><dd className={h.health < 0.5 ? 'down' : ''}>{pct0(h.health)}</dd><dt>Fed yesterday</dt><dd className={h.fed < 0.99 ? 'down' : ''}>{pct0(h.fed)}</dd></>}
      </dl>
      <button className="btn ghost sm" onClick={() => go('livestock')}>Manage animals</button>
    </div>
  );
}

function LotPanel({ s, lot, region, onClose }: { s: GameState; lot: Lot; region: RegionId; onClose: () => void }) {
  if(lot.service?.type==='watchtower')return <Card title="Watchtower & militia"><button className="btn primary" onClick={()=>go('region')}>Open Region map</button></Card>;
  if(lot.service&&['sanitation','lighting','police'].includes(lot.service.type))return <Card title="City watch"><button className="btn primary" onClick={()=>go('city')}>Open City watch</button></Card>;
  if (lot.key.startsWith('civic:')) return <Card title="Town services"><button className="btn primary" onClick={() => go('town')}>Open Town hall</button></Card>;
  if (lot.key.startsWith('community:')) return <Card title="Your neighbourhood"><div className="community-strip"><span>🏘️ {population(s)} / {homeCapacity(s)}</span><span>☺ {pct0(communityOf(s).happiness)}</span></div><button className="btn primary" onClick={() => go('community')}>Homes & families</button></Card>;
  if(lot.key==='market') return s.legacyProgression || stageAtLeast(s, 'market-town') ? <SellCard s={s} r={region}/> : <HomesteadTraderCard s={s}/>;
  if (lot.type === 'house' || lot.type === 'shed') {
    const hands = s.workers.filter((w) => w.role === 'hand').length;
    return (
      <Card title={lot.key==='crew'?'Bunkhouse':lot.key==='office'?'Farm office':lot.type === 'house' ? 'Farmhouse' : 'Regional office'} actions={<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}>
        <div className="stack s">
          <p className="explain">{lot.type === 'house' ? 'Where it all started. Your crew gathers in the yard when there is no field work.' : 'Your base of operations in this region.'}</p>
          <dl className="facts">
            <dt>Farm hands</dt><dd>{hands}</dd>
            <dt>Managers</dt><dd>{s.workers.length - hands}</dd>
            <dt>Machines</dt><dd>{s.machines.length}</dd>
          </dl>
          {stageAtLeast(s, 'farm-business') && <button className="btn ghost sm" onClick={() => go('workers')}>Manage workers</button>}
        </div>
      </Card>
    );
  }
  const d = BUILDINGS[lot.type];
  const bs = lot.buildings;
  const active = bs.filter((b) => b.active).length;
  const util = bs.reduce((a, b) => a + b.util, 0) / Math.max(1, bs.length);
  const margin = bs.reduce((a, b) => a + buildingMargin(b), 0);
  const reason = bs.find((b) => b.reason && b.reason !== 'Paused')?.reason;
  const page = LOT_PAGE[d.category];
  return (
    <Card title={<>{d.name}{bs.length > 1 && <span className="muted"> ×{bs.length}</span>}</>} actions={<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}>
      <div className="stack s">
        <p className="explain">{d.blurb}</p>
        {d.recipe ? (
          <dl className="facts">
            <dt>Running</dt><dd>{active} of {bs.length}</dd>
            <dt>Utilisation</dt><dd>{pct0(util)}</dd>
            <dt>Margin</dt><dd className={margin < 0 ? 'down' : 'up'}>{money(margin)}/h</dd>
            <dt>Recipe</dt><dd>{Object.entries(d.recipe.inputs).map(([g, q]) => `${q} ${GOODS[g as keyof typeof GOODS].name.toLowerCase()}`).join(' + ') || 'electricity'} → {Object.entries(d.recipe.outputs).map(([g, q]) => `${q} ${GOODS[g as keyof typeof GOODS].name.toLowerCase()}`).join(' + ') || `${-d.recipe.kwh} kWh`}</dd>
          </dl>
        ) : (
          <dl className="facts">
            {d.dry && <><dt>Dry storage</dt><dd>{num(d.dry * bs.length)}</dd></>}
            {d.cold && <><dt>Cold storage</dt><dd>{num(d.cold * bs.length)}</dd></>}
            <dt>Staff</dt><dd>{money(d.staffPerHour * s.macro.cpi * bs.length)}/h</dd>
          </dl>
        )}
        {reason && reason !== 'Idle' && <div className={`callout ${/Not enough|full|Disease/.test(reason) ? 'warn' : ''}`}>{reason}</div>}
        {d.category === 'livestock' && <HerdInfo s={s} lot={lot} />}
        {known(s, 'upgrades') && bs.map((b, i) => b.level < 3 && (
          <div key={b.id} className="row between small">
            <span className="muted">{bs.length > 1 ? `#${i + 1} ` : ''}Level {b.level} → {b.level + 1}: {b.level === 1 ? '+80%' : '+40%'} {d.recipe ? 'output' : d.category === 'livestock' ? 'space' : 'capacity'}</span>
            <Confirm label={`Upgrade · ${money(upgradeCost(s, b))}`} className="btn ghost sm" disabled={upgradeCost(s, b) > s.cash} title={`Upgrade ${d.name.toLowerCase()} to level ${b.level + 1}?`} body={<>Costs <b>{money(upgradeCost(s, b))}</b>. {d.recipe ? 'More output per hour, but staff cost rises 30%.' : d.category === 'livestock' ? 'Room for more animals.' : 'More storage space.'}</>} onConfirm={() => act({ type: 'upgradeBuilding', buildingId: b.id })} confirmLabel="Upgrade" />
          </div>
        ))}
        <div className="row wrap">
          {d.recipe && <button className="btn ghost sm" onClick={() => bs.forEach((b) => b.active === (active === bs.length) && act({ type: 'toggleBuilding', buildingId: b.id }))}>{active === bs.length ? 'Pause' : 'Resume'}{bs.length > 1 ? ' all' : ''}</button>}
          {page && <button className="btn ghost sm" onClick={() => go(page)}>Open {page}</button>}
          {bs.length > 0 && <Confirm label="Demolish one" className="btn danger sm" title={`Demolish a ${d.name.toLowerCase()}?`} body={`You get back about ${money(Math.max(0, bs[0].cost - bs[0].depreciated) * 0.5)}. Stock that no longer fits is sold or lost.`} onConfirm={() => act({ type: 'demolish', buildingId: bs[bs.length - 1].id })} confirmLabel="Demolish" />}
        </div>
      </div>
    </Card>
  );
}
