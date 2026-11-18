import { VisitBar, VisitCard } from './VisitCard';
import { MILITIA_ESCORT, sidesAt, TOWER_REACH, towerSides } from '../../simulation/stages/region';
import { NEIGHBOUR_IDS, ROUTE_SIDE, SIDE_NAME } from '../../simulation/region-state';
import { travel } from '../../stores/game';
import { frontageAt, JAM_TEXT, laneCapacity, meets, needText, pressureOf, streetJammedAt, trafficRoom } from '../../simulation/access';
import { homesReached, nuisanceOf, NUISANCE_LOOK, type NuisanceKind } from '../../simulation/nuisance';
import { upgradeNeedsPower } from '../../simulation/stages/shared';
import { bestCrop } from '../crops';
import { DRILL_PRICE, wellField, oilReading, readingWord, struckFields, SURVEY_PRICE, SURVEY_R, surveyedAt } from '../../simulation/oil';
import {cityActive} from '../../simulation/city-state';
import { isShop, officeJobs, PARK_KINDS, PARKING_SHARE, ROAD_REACH, serviceName, svcSize, SERVICE_RADIUS } from '../../simulation/town-state';
import { townOf, SERVICE_DEFS, UTILITY_OF, levelOf, serviceUpgradePrice, utilityFamilies, serviceRadius, canUpgradeService } from '../../simulation/town-state';
// Everything that floats over the world: objective, selection panel, market, land, region switcher.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ANIMALS, ANIMAL_IDS, BUILDINGS, CONFIG, COWS_PER_DAIRY_BATCH, ERAS, GOODS, REGIONS, type CropId, type RegionId } from '../../simulation/config';
import { factoryCrop, known, maxLevel, recipeOf, throughput, VERTICAL_CROPS } from '../../simulation/core';
import { buildingMargin } from '../../simulation/processing';
import { planQuote } from '../../simulation/engine';
import { anotherQuote, DISCOVERIES, ERA_UNLOCK_TEXT, dailyGoals, dailyPrize, forecast, herdOf, homePlotPrice, housing, isManual, isReady, objective, chapterGate, gateProgress, type GateRow, PAGES, seedShortfall, upgradeCost } from '../../simulation/engine';
import type { CivicService, GameState } from '../../simulation/types';
import { act, cancelPlacement, confirmPlacement, planPlacementHere, placementNeed, rotatePlacement, go, placementUse, setRoadTool, toggleHideBuildings, setNet, setRoadLanes, undo, redo, canUndo, canRedo, setSurveying, setZoneTool, setZoneDrag, startPipes, type Prospect, startPlacement, stopProspect, stopRoads, stopZoning, type Zoning, useGame, usePageState, useStore, type Placement, type Roading } from '../../stores/game';
import { BRIDGE_COST, BRIDGE_GRADES, bridgeAt, bridgePlan } from '../../simulation/world';
import { WATER_LEVEL, WATER_PRICE, WATER_TIERS, wetTiers, NET_PRICE, NET_TIERS, NET_TOP, NET_QUALITY, linesOf, tileId, groundProblem, wideRoadRoute, upgradeAllPlan, BELT_PRICE, beltRoute, beltStretch, buildAs, buildAsOpen, lineBuildPrice, roadBuildPrice, type LineKind, type UtilityNet, pipeRoute, pipeStretch, cutsOff, footprintOf, forSaleAround, isRoad, MAP, ROAD_GRADES, ROAD_H, roadPick, roadTilePrice, worldOf, patchesAround, placeProblem, plotSide, PROBLEM_TEXT } from '../../simulation/world';
import { buildingPrice, moveFee, parcelPrice } from '../../simulation/engine';
import { APARTMENT_FAMILIES, homeLevel, homeUpgradePrice } from '../../simulation/community-state';
import { homeUpgradeNeeds } from '../../simulation/stages/settlement';
import { homePrice } from '../../simulation/community-state';
import { servicePrice } from '../../simulation/town-state';
import { money, num, pct0 } from '../format';
import { BatchPanel, FieldPanel, HomesteadTraderCard, RecentLog, SellCard } from '../pages/Fields';
import { NEXT_STAGE, STAGES, stageAtLeast } from '../../simulation/stages';
import { unlockedRegions } from '../pages/shared';
import { Bar, Card, Confirm, Modal, Select, usePref , Seg } from '../ui';
import { AdvisorPill } from '../Advisor';
import { Scene3D, fertilisePlan, lotName, type WorldPick } from './Scene3D';
import { anotherKey, layoutRegion, type Lot } from './layout';
import { communityOf, homeCapacity, homeFamilies, households, population } from '../../simulation/community-state';

function EraBanner({ s }: { s: GameState }) {
  const [open, setOpen] = useState(false);
  const oldChapter = s.legacyProgression && !communityOf(s).active;
  const nextId = oldChapter ? null : NEXT_STAGE[s.stageId];
  const next = oldChapter ? ERAS[s.era] : null;
  const title = oldChapter ? `Era ${s.era + 1}: ${next?.name ?? 'Frontier'}` : STAGES[nextId ?? s.stageId].title;
  const theme = next?.theme ?? (nextId === 'market-town' ? 'Surplus outgrows barter. The village opens its first market day.' : nextId === 'farm-business' ? 'Bring in a crew, plan the fields and manage the new costs.' : nextId === 'industry' ? 'Machines and processing turn a farm business into an industry.' : 'A new chapter is ready. Your farm keeps running behind you.');
  const unlocks = oldChapter ? ERA_UNLOCK_TEXT[s.era + 1] ?? [] : nextId === 'market-town' ? ['Open commodity market and daily market day', 'Keep the village trader as a side channel'] : nextId === 'farm-business' ? ['Farm hands, managers and crop plans', 'Soil care, livestock, orchards and seasons'] : nextId === 'industry' ? ['Tractors, processing and energy', 'Research and larger parcels'] : nextId==='settlement'?['Your workers’ families move onto your land','Residential zones, homes, and a pay cut or housing tax to fund them']:nextId==='town'?['Newcomer families from outside','Water towers, schools, clinics, sanitation and power that serve homes within reach']:nextId==='city'?['Sanitation, lighting and district zoning','A safety charter and justice choices']:nextId==='region'?['Four neighbours with leaders and trust','Caravans, raids, watchtowers and a border policy']:nextId==='nation'?['Choose Army, Alliance or Neutrality','Barracks, drills and campaigns on the region map']:['New systems arrive here as the story expands.'];
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
          : <><button className="btn ghost" onClick={() => setOpen(false)}>Not yet</button><button className="btn primary" onClick={() => { if(nextId === 'settlement') go('community'); else if(nextId==='town') go('town'); else if(nextId==='city')go('city'); else if(nextId==='region')go('region'); else if(nextId==='nation')go('nation'); else act({ type: 'advanceEra' }); setOpen(false); }}>Begin chapter</button></>}>
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
  const [sel, setSel] = useState<number[]>(() => (s.fields[0] && !s.stats.harvests ? [s.fields[0].id] : [])); // only a brand-new farm starts with its first field picked
  const [lot, setLot] = useState<Lot | null>(null);
  const [chosen, setCrop] = useState<CropId | null>(null);
  const [forest, setForest] = useState<[number, number] | null>(null);
  const placing = useStore((x) => x.placing), roading = useStore((x) => x.roading), prospect = useStore((x) => x.prospect), zoning = useStore((x) => x.zoning);
  const [panel, setPanel] = useState(false);
  const [journal, setJournal] = useState(false);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const page = usePageState(), visiting = useStore((x) => x.visiting);
  const oneField = sel.length === 1 ? s.fields.find((f) => f.id === sel[0]) : undefined;
  const crop = chosen ?? (oneField ? bestCrop(s, oneField) : 'wheat'); // best pay until the player picks
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

  // keep the selection valid; only a brand-new farm (before its first harvest) keeps its field picked so Plant is visible
  useEffect(() => {
    const valid = sel.filter((id) => s.fields.some((f) => f.id === id && f.region === region));
    if (valid.length !== sel.length || (!valid.length && !lot && !s.stats.harvests)) setSel(valid.length ? valid : s.stats.harvests ? [] : s.fields.filter((f) => f.region === region).slice(0, 1).map((f) => f.id));
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
    else if (p.kind === 'forest') (setForest([p.x, p.y]), setLot(null), setSel([]));
    else { setForest(null); setLot(null); setSel([]); }
    if (p.kind !== 'forest') setForest(null);
  };

  const selected = lot ? [] : s.fields.filter((f) => sel.includes(f.id));
  const one = selected.length === 1 ? selected[0] : null;
  const readyPlots = s.fields.filter((f) => f.region === region && isManual(f) && isReady(s, f));
  const plotPrice = homePlotPrice(s);
  const canBuyPlot = region === 'heartland' && s.stats.sales > 0 && s.regions.heartland.homePlotsBought < CONFIG.homePlots;
  // From Farm Business, parcels are far cheaper per hectare than the next home plot; offer them first.
  const parcelOpen = (s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'farm-business')) && s.regions[region].unlocked, parcel5 = parcelPrice(s, region, 5);
  const liveLot = lot && (lot.type === 'house' || lot.type === 'shed' ? lot : { ...lot, buildings: s.buildings.filter((b) => b.region === region && b.type === lot.type) });

  return (
    <div className="hud">
      {!visiting && <DiscoveryCard s={s} />}
      <Scene3D region={visiting ?? region} visiting={!!visiting} selected={lot || visiting ? [] : sel} onPick={visiting ? () => {} : onPick} plantLabel={plantLabel(s, crop, one)}
        placing={placing} forestAt={forest} placeCost={placing ? placementCost(s, placing) : 0} roading={roading} prospect={prospect} zoning={zoning}
        selectedLot={lot?.key} onAction={(kind, id) => {
          if(kind==='placeok'){ if(confirmPlacement()) { setSel([]); setLot(null); } }
          else if(kind==='placecancel'){ cancelPlacement(); setForest(null); }
          else if(kind==='buy1'||kind==='buy9'){ if(forest)act({type:'buyLand',region,chunks:forSaleAround(s,region,forest[0],forest[1],kind==='buy1'?1:3)}); } // the bubble stays open so the new land can be cleared next
          else if(kind==='clear1'||kind==='clear9'){ if(forest&&act({type:'clearForest',region,chunks:patchesAround(s,region,forest[0],forest[1],kind==='clear1'?1:3)}))setForest(null); }
          else if(kind==='move'){ const f=s.fields.find(x=>x.id===id); if(f){ const side=plotSide(f.ha); startPlacement({kind:'move',key:`field:${id}`,region:f.region,w:side,d:side,label:`Field ${id}`,action:{type:'seeTip',tip:''}}); setSel([]); } }
          else if(kind==='merge'&&lot?.service){ if(act({type:'mergeService',serviceId:lot.service.id})) setLot(null); }
          else if(kind==='merge'&&lot?.buildings[0]){ if(act({type:'mergeBuilding',buildingId:lot.buildings[0].id})) setLot(null); }
          else if(kind==='layout'&&lot?.buildings[0]){ act({type:'setLayout',buildingId:lot.buildings[0].id}); }
          else if(kind==='another'&&lot){ const k=anotherKey(lot); if(k&&act({type:'addAnother',key:k})) setLot(null); }
          else if(kind==='homeup'&&lot){ setPanel(true); setJournal(false); }
          else if(kind==='movelot'&&lot){ const fp=footprintOf(s,lot.place); if(fp){ startPlacement({kind:'move',key:lot.place,region,w:fp.w,d:fp.d,label:lotName(lot),action:{type:'seeTip',tip:''}}); setLot(null); } }
          else if(kind==='plant'||kind==='harvest') act(kind==='harvest'?{type:'harvest',fieldId:id}:{type:'plant',fieldId:id,crop});
          else if(kind==='irrigate') act({type:'irrigate',fieldIds:[id]},'Irrigation installed.');
          else if(kind==='pipes'){ startPipes(region); setSel([]); }
          else if(kind==='fertilise'){
            const f=s.fields.find(x=>x.id===id); if(!f)return;
            const plan=fertilisePlan(s,f);
            if(plan.buy&&!act({type:'buy',region:f.region,good:'fertilizer',qty:plan.buy}))return;
            act({type:'fertilize',fieldIds:[id],source:plan.source},plan.source==='manure'?'Manure is on its way to the field.':'Fertiliser is on its way to the field.');
          }
          else if(kind==='place' && lot?.service && canUpgradeService(lot.service.type)){ setPanel(true); setJournal(false); }
          else if(kind==='place' && lot){
            const target=lot.service?.type==='barracks'?'nation':lot.service?.type==='watchtower'?'region':lot.service&&(['sanitation','lighting','police'].includes(lot.service.type)||isShop(lot.service.type)||lot.service.type==='mall')?'city':lot.key.startsWith('civic:')?'town':lot.key.startsWith('community:')?'community':lot.key==='crew'?'workers':lot.key==='office'?'automation':lot.key==='market'?'markets':lot.type==='house'||lot.type==='shed'?'finance':LOT_PAGE[BUILDINGS[lot.type].category];
            if(target && PAGES.find(p=>p.id===target)?.unlocked(s))go(target);else {setPanel(true);setJournal(false);}
          } else {setPanel(true);setJournal(false); if(kind==='plan') requestAnimationFrame(()=>document.querySelector('[data-coach=plan-picker]')?.scrollIntoView({block:'center'}));}
        }} />
      {visiting ? <><VisitBar id={visiting} /><VisitCard id={visiting} /></> : <>
      {placing && <PlacementBar s={s} p={placing} />}
      {roading && (roading.belt ? <BeltBar s={s} r={roading} /> : roading.pipe === 'irrigation' ? <PipeBar s={s} r={roading} /> : roading.pipe ? <UtilityBar s={s} r={roading} /> : <RoadBar s={s} r={roading} />)}
      {prospect && <OilBar s={s} p={prospect} />}
      {zoning && <ZoneBar z={zoning} />}
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
          {parcelOpen && <button className="btn gold sm" disabled={s.cash < parcel5} onClick={() => act({ type: 'buyParcel', region, ha: 5 })} title={`${money(parcel5 / 5)} a hectare`}>Buy 5 ha · {money(parcel5)}</button>}
          {canBuyPlot && !(parcelOpen && parcel5 < plotPrice) && <button className="btn ghost sm" data-coach="buy-plot" disabled={s.cash < plotPrice} onClick={() => act({ type: 'buyPlot' })} title="Shortcut: B">Buy 1 ha · {money(plotPrice)}</button>}
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
      </>}
    </div>
  );
}

/** Fixed controls while placing: they never move with the ghost. With a mouse, clicking the map places it. */
function ZoneBar({ z }: { z: Zoning }) {
  return <div className="placement-bar road-bar" role="dialog" aria-label="Zones">
    <div className="placement-info"><b>🏘 Zones</b><span className="muted">{(z.drag ? (x: string) => x.replace('Tap your land', 'Drag across your land').replace('Tap a zoned patch', 'Drag across zoned land') : (x: string) => x)(z.zone === 'res' ? 'Tap your land: homes for workers\' families go here (no fields)' : z.zone === 'ind' ? 'Tap your land: for industrial-scale plants' : z.zone === 'com' ? 'Tap your land: shops and offices go here' : 'Tap a zoned patch to make it farmland again')}</span></div>
    <div className="seg" role="group" aria-label="Zone">
      {(townOf(useGame()).active ? ['res', 'com', 'ind', 'farm'] as const : ['res', 'ind', 'farm'] as const).map((t) => <button key={t} className={`btn ${z.zone === t ? 'primary' : 'ghost'}`} aria-pressed={z.zone === t} onClick={() => setZoneTool(t)}>{t === 'res' ? '🏠 Residential' : t === 'com' ? '🏪 Commercial' : t === 'ind' ? '🏭 Industrial' : '🌾 Farmland'}</button>)}
    </div>
    <button className={`btn ${z.drag ? 'primary' : 'ghost'}`} aria-pressed={!!z.drag} title="Drag across the map to zone every patch in the rectangle; pan with two fingers or turn this off" onClick={() => setZoneDrag(!z.drag)}>▭ Drag</button>
    <button className="btn ghost" onClick={() => stopZoning()}>Done</button>
  </div>;
}

function OilBar({ s, p }: { s: GameState; p: Prospect }) {
  const drill = Math.round(DRILL_PRICE * s.macro.cpi), survey = Math.round(SURVEY_PRICE * s.macro.cpi), h = p.hover;
  const read = h && surveyedAt(s, p.region, h[0], h[1]) ? readingWord(oilReading(p.region, h[0], h[1])) : null;
  const touch = !matchMedia('(pointer: fine)').matches, tapHow = touch ? 'tap again' : 'click';
  const hint = p.survey ? `${touch ? 'Tap' : 'Click'} the middle of the area to survey (${SURVEY_R * 2} tiles across) · ${money(survey)}`
    : !h ? `Drill on industrial land · ${money(drill)} · survey first: blind wells rarely strike`
    : read ? `Survey reads ${read} here · ${tapHow} to drill · ${money(drill)}` : `Not surveyed: drilling blind rarely strikes · ${tapHow} to drill · ${money(drill)}`;
  const fields = struckFields(s, p.region);
  return <div className="placement-bar road-bar" role="dialog" aria-label="Oil">
    <div className="placement-info"><b>🛢 Oil</b><span className="muted">{hint}</span>
      {fields.map((f) => <span key={f.i} className="muted small">Field {f.i + 1}: {num(f.left)} of {num(f.reserve)} bbl left · {f.wells.length} well{f.wells.length === 1 ? '' : 's'} ({f.balanced} balanced){f.wells.length > f.balanced ? ' · over-drilled: draining fast' : ''}</span>)}
    </div>
    <button className={`btn ${p.survey ? 'primary' : 'ghost'}`} disabled={survey > s.cash && !p.survey} onClick={() => setSurveying(!p.survey)}>{p.survey ? 'Cancel survey' : `Survey · ${money(survey)}`}</button>
    <button className="btn ghost" onClick={() => stopProspect()}>Done</button>
  </div>;
}

const UTIL_LABEL: Record<UtilityNet, string> = { power: '⚡ Power', water: '🚰 Water', sewer: '🚿 Sewage' };
/** The town's utility lines: power from the power station, water from the water tower, sewage to the sanitation works. */
function UtilityBar({ s, r }: { s: GameState; r: Roading }) {
  const net = r.pipe as UtilityNet, top = NET_TOP[net], names = NET_TIERS[net], own = linesOf(worldOf(s, r.region), net), h = r.hover;
  const price = (t: number) => Math.round(NET_PRICE[net][t] * s.macro.cpi), q = (t: number) => `${Math.round(NET_QUALITY[net][t] * 100)}%`, lay = lineBuildPrice(s, net);
  let hint: string;
  if (r.tool === 'draw') {
    const route = r.from && h ? pipeRoute(s, r.region, r.from, h, net) : null;
    hint = !r.from ? `Tap its building (or a line) to start · ${money(lay)} a tile` : !h ? 'Tap a home (or a spot) to run the line there' : route ? `${route.length} tiles · ${money(lay * route.length)} · tap to lay` : 'Can\'t get there: keep to your own cleared land';
  } else {
    const st = h ? pipeStretch(worldOf(s, r.region), h[0], h[1], net) : [];
    if (!st.length) hint = r.tool === 'upgrade' ? names.slice(1).map((n, i) => `${n} ${q(i + 1)}`).join(' → ') : 'Tap a line to remove that run';
    else if (r.tool === 'upgrade') { const t = Math.min(top, Math.min(...st.map((id) => own[id])) + 1), n = st.filter((id) => own[id] < t).length; hint = n ? `${names[t]} · ${n} tiles · ${money(price(t) * n)} · homes at ${q(t)}${t === top ? ' · land freed' : ''}` : `Already ${names[top].toLowerCase()}`; }
    else hint = `Remove ${st.length} tiles`;
  }
  const tabs = <div className="dock-tabs" role="group" aria-label="Which lines">
    {(['power', 'water', 'sewer'] as const).map((k) => <button key={k} className={net === k ? 'on' : ''} aria-pressed={net === k} aria-label={UTIL_LABEL[k].split(' ')[1]} onClick={() => setNet(k)}><span aria-hidden>{UTIL_LABEL[k].split(' ')[0]}</span><span className="tab-name"> {UTIL_LABEL[k].split(' ')[1]}</span></button>)}
  </div>;
  return <LineDock label="Utility lines" head={tabs} hint={hint} tool={r.tool} draw="Lay" all={{ region: r.region, nets: ['power', 'water', 'sewer'] }} as={{ what: 'line', names: names.slice(1) }} />;
}

function PipeBar({ s, r }: { s: GameState; r: Roading }) {
  const w = worldOf(s, r.region), price = (t: number) => Math.round(WATER_PRICE[t] * s.macro.cpi), pct = (t: number) => `${Math.round(WATER_LEVEL[t] * 100)}%`, h = r.hover;
  let hint: string;
  if (r.tool === 'draw') {
    const route = r.from && h ? pipeRoute(s, r.region, r.from, h) : null;
    hint = !r.from ? 'Tap beside the river (or on a line) to start a ditch' : !h ? `Tap where it goes next · ${money(lineBuildPrice(s, 'irrigation'))} a tile · fields at ${pct(Math.min(3, buildAs(s, 'line')))}` : route ? `${route.length} tiles of ${WATER_TIERS[Math.min(3, buildAs(s, 'line'))].toLowerCase()} · ${money(lineBuildPrice(s, 'irrigation') * route.length)} · tap to dig` : 'Can\'t get there: keep to your own cleared land';
  } else {
    const st = h ? pipeStretch(w, h[0], h[1]) : [];
    if (!st.length) hint = r.tool === 'upgrade' ? `Tap a line: ditch → pipe (${pct(2)}) → buried (${pct(3)}, frees the land)` : 'Tap a line to remove that run';
    else if (r.tool === 'upgrade') { const t = Math.min(3, Math.min(...st.map((id) => w.canals[id])) + 1), n = st.filter((id) => w.canals[id] < t).length; hint = n ? `${t === 3 ? 'Bury' : 'Pipe'} ${n} tiles · ${money(price(t) * n)} · fields at ${pct(t)}${t === 3 ? ' · land freed' : ''}` : `Already ${WATER_TIERS[3].toLowerCase()}`; }
    else hint = `Remove ${st.length} tiles of water line`;
    if (st.length && !st.some((id) => wetTiers(s, r.region).has(id))) hint = `Dry (red): not joined to the river · ${hint}`;
  }
  return <LineDock label="Water lines" head={<b className="dock-title">💧 Irrigation</b>} hint={hint} tool={r.tool} draw="Dig" all={{ region: r.region, nets: ['irrigation'] }} as={{ what: 'line', names: WATER_TIERS.slice(1) }} />;
}

function BeltBar({ s, r }: { s: GameState; r: Roading }) {
  const h = r.hover, price = Math.round(BELT_PRICE * s.macro.cpi), w = worldOf(s, r.region);
  let hint: string;
  if (r.tool === 'remove') { const st = h ? beltStretch(w, h[0], h[1]) : []; hint = st.length ? `Fell ${st.length} tile${st.length === 1 ? '' : 's'} of trees` : 'Tap a tree line to fell that run'; }
  else { const route = r.from && h ? beltRoute(s, r.region, r.from, h) : null; hint = !r.from ? `Tap where the trees start · ${money(price)} a tile` : !h ? 'Tap where the row goes next' : route ? `${route.length} trees · ${money(price * route.length)} · tap to plant` : groundProblem(s, r.region, h[0], h[1], 'belt') ?? 'No way through for a row of trees from here: plant it in shorter runs'; }
  return <LineDock label="Tree lines" head={<b className="dock-title">🌳 Tree lines</b>} hint={hint} tool={r.tool} draw="Plant" noUpgrade />;
}

function RoadBar({ s, r }: { s: GameState; r: Roading }) {
  const lanes = useStore((x) => x.roadLanes);
  const w = worldOf(s, r.region), price = roadBuildPrice(s), h = r.hover;
  // what the next tap would do, with its price, before you commit
  let hint: string;
  if (r.tool === 'draw') {
    const route = r.from && h ? wideRoadRoute(s, r.region, r.from, h, lanes) : null;
    hint = !r.from ? 'Tap where the road starts' : !h ? `Tap where it goes next · ${money(price)} a tile` : route ? `${route.length} tiles · ${money(price * route.length)} · tap to build` : groundProblem(s, r.region, h[0], h[1], 'road') ?? (lanes > 1 ? `A ${lanes}-lane road needs open land ${lanes} tiles wide all the way` : 'No way through from here: try a point in between');
  } else if (r.tool === 'bridge') {
    const plan = h ? bridgePlan(s, r.region, h, lanes) : null, g = 1;
    hint = !plan ? 'Tap the river where the bridge should cross' : 'error' in plan ? plan.error : `${BRIDGE_GRADES[g]} · ${plan.tiles.length} tiles · ${money(roadBuildPrice(s, g) * BRIDGE_COST * plan.tiles.length)} · tap to build`;
  } else if (h && isRoad(h[1])) {
    hint = w.main >= 3 ? 'The main road is already paved' : `Whole main road → ${ROAD_GRADES[w.main + 1].toLowerCase()} · ${money(roadTilePrice(s, w.main + 1) * MAP.w * ROAD_H)}`;
    if (r.tool === 'remove') hint = 'The main road stays';
  } else {
    const span = h ? bridgeAt(s, r.region, h) : [], st = span.length ? span : h ? (r.from ? roadPick(w, r.from, h) : roadPick(w, h)) : [];
    if (!st.length) hint = r.tool === 'upgrade' ? 'Tap a road to upgrade that stretch, or drag along it to pick part of it' : 'Tap a road to remove that stretch, or drag along it to pick part of it';
    else if (r.tool === 'upgrade') { const g = Math.min(3, Math.min(...st.map((id) => w.roads[id])) + 1), n = st.filter((id) => w.roads[id] < g).length; hint = span.length ? (n ? `${BRIDGE_GRADES[w.roads[span[0]]]} → ${BRIDGE_GRADES[g].toLowerCase()} · ${money(roadTilePrice(s, g) * BRIDGE_COST * n)} · carries more traffic` : 'Already a concrete bridge') : n ? `${n} tiles → ${ROAD_GRADES[g].toLowerCase()} · ${money(roadTilePrice(s, g) * n)}` : 'Already paved'; }
    else { const lost = cutsOff(s, r.region, st); hint = `Remove ${st.length} tiles${lost.length ? ` · cuts off ${lost.length} building${lost.length === 1 ? '' : 's'}` : ''}`; }
  }
  { const id = h ? tileId(h[0], h[1]) : -1, x = id >= 0 && w.roads[id] !== undefined ? pressureOf(s, w, id) : 0; if (x > 0.05) { const cars = townOf(s).flow?.[id] ?? 0; hint += ` · 🚦 ${cars} cars a lane, ${laneCapacity(w, id)} at ease (${Math.round(x * 100)}%)${x >= 1 ? ': upgrade or widen it' : ''}`; } }
  return <LineDock label="Roads" head={<b className="dock-title">🛤 Roads</b>} hint={hint} tool={r.tool} draw="Draw" bridge all={{ region: r.region, nets: ['road'] }} as={{ what: 'road', names: ROAD_GRADES.slice(1) }} extra={<>{(r.tool === 'draw' || r.tool === 'bridge') && <select className="dock-as" aria-label="Lanes" title="How many lanes wide new roads are" value={lanes} onChange={(e) => setRoadLanes(+e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} lane{n > 1 ? 's' : ''}</option>)}</select>}
    <button className={`dock-all${s.autoRoads === false ? '' : ' on'}`} aria-pressed={s.autoRoads !== false} title="When on, every new, moved or upgraded building gets a dirt track to the nearest road. Turn it off to lay every road yourself." onClick={() => act({ type: 'setAutoRoads', on: s.autoRoads === false })}>Auto tracks: {s.autoRoads === false ? 'off' : 'on'}</button></>} />;
}

/** The dock for roads and lines: what you're working on (with Hide and Done), what the next tap does, then the tools at thumb height. */
const UndoIcon = ({ redo }: { redo?: boolean }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={redo ? { transform: 'scaleX(-1)' } : undefined}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>;
function LineDock({ label, head, hint, tool, draw, all, as, noUpgrade, extra, bridge }: { /** offer the bridge tool */ bridge?: boolean; noUpgrade?: boolean; extra?: React.ReactNode; label: string; head: React.ReactNode; hint: string; tool: Roading['tool']; draw: string; all?: { region: RegionId; nets: LineKind[] }; /** what a new one is built as: the choices, and which of road or line it sets */ as?: { what: 'road' | 'line'; names: readonly string[] } }) {
  const s = useGame(), plan = all && tool === 'upgrade' ? upgradeAllPlan(s, worldOf(s, all.region), all.nets, all.region) : null;
  const hidden = useStore((x) => x.hideBuildings), bad = /^(Can't|Dry)/.test(hint);
  const tools = ([['draw', '✏', draw], ['bridge', '🌉', 'Bridge'], ['upgrade', '⬆', 'Upgrade'], ['remove', '✕', 'Remove']] as const).filter(([t]) => !(noUpgrade && t === 'upgrade') && (bridge || t !== 'bridge'));
  return <div className="placement-bar line-dock" role="dialog" aria-label={label}>
    <div className="dock-head">
      {head}
      <button className={`dock-hide${hidden ? ' on' : ''}`} aria-pressed={hidden} title="Hide buildings while you work on roads and lines" onClick={toggleHideBuildings}>{hidden ? '🏠 Show' : '🏚 Hide'}<span className="wide"> buildings</span></button>
      <button className="btn ghost dock-done" onClick={() => stopRoads()}>Done</button>
    </div>
    <div className={`dock-hint${bad ? ' bad' : ''}`}>
      <p aria-live="polite">{hint}</p>
      {extra}
      {as && tool === 'draw' && buildAsOpen(s) && <select className="dock-as" aria-label="Build as" title="What new ones are built as" value={Math.min(as.names.length, buildAs(s, as.what))} onChange={(e) => act({ type: 'setBuildAs', what: as.what, level: +e.target.value })}>{as.names.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>}
      {plan && plan.tiles > 0 && <button className="dock-all" disabled={plan.cost > s.cash} title={`Raise all ${plan.tiles} tiles one step${all!.nets.includes('road') ? ' (the main road is upgraded on its own)' : ''}`} onClick={() => act({ type: 'upgradeAllLines', ...all! })}>⬆ All · {money(plan.cost)}</button>}
      <button className="dock-undo" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo()} onClick={() => undo()}><UndoIcon /></button>
      <button className="dock-undo" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo()} onClick={() => redo()}><UndoIcon redo /></button>
    </div>
    <div className="dock-tools" role="group" aria-label={`${label} tool`}>
      {tools.map(([t, i, n]) => <button key={t} className={`${tool === t ? 'on' : ''} ${t}`} aria-pressed={tool === t} onClick={() => setRoadTool(t)}><span aria-hidden>{i}</span>{n}</button>)}
    </div>
  </div>;
}

function PlacementBar({ s, p }: { s: GameState; p: Placement }) {
  const problem = placeProblem(s, p.region, p.at[0], p.at[1], { w: p.w, d: p.d }, p.key, p.kind === 'move' ? undefined : placementUse(p)), cost = placementCost(s, p);
  const quote = p.kind === 'new' && (problem === 'unowned' || problem === 'forest' || problem === 'road') ? planQuote(s, p.region, p.at, p.w, p.d, p.action) : null;
  const need = placementNeed(p), street = !problem && need && need.lanes > 1 ? (!meets(frontageAt(worldOf(s, p.region), p.at[0], p.at[1], p.w, p.d), need) ? `Needs ${needText(need)}: draw a wider street beside it first (🛤, set the lanes).` : streetJammedAt(s, worldOf(s, p.region), p.at[0], p.at[1], p.w, p.d) ? `🚦 ${JAM_TEXT}` : null) : null;
  return <div className="placement-bar" role="dialog" aria-label={`Placing ${p.label}`}>
    <div className="placement-info"><b>{p.kind === 'move' ? '✥ Moving' : '📍 Placing'} {p.label}{p.total ? ` ${p.total - p.left! + 1} of ${p.total}` : ''}{cost > 0 ? ` · ${money(cost)}` : ''}</b>
      <span className={(problem && !quote?.ok) || street ? 'bad' : 'muted'}>{street ?? null}{street ? null : quote?.ok ? (quote.buy.length || quote.clear.length ? `${quote.buy.length ? 'Not yours' : 'Still forest'}${quote.roads.length ? ', with a road across it' : ''}. Buy and clear it, and it is placed when the crew finishes (about ${quote.hours} h).` : `Your road runs here (${quote.roads.length} tile${quote.roads.length === 1 ? '' : 's'}). Take it up to place this? Anything that used it gets a fresh track.`) : quote && !quote.ok && quote.error !== PROBLEM_TEXT.occupied ? quote.error : problem ? PROBLEM_TEXT[problem] : matchMedia('(pointer: fine)').matches ? 'Click a green spot to place it.' : 'Tap where it goes, then confirm.'}</span>{p.action.type === 'buildService' && p.action.service === 'watchtower' && (() => { const sides = sidesAt(s, p.at[0] + p.w / 2, p.at[1] + p.d / 2); return <span className={`small ${sides.length ? 'good' : 'bad'}`}>🗼 {sides.length ? <>Guards {sides.map((x) => SIDE_NAME[x]).join(' and ')}: caravans to {NEIGHBOUR_IDS.filter((id) => sides.includes(ROUTE_SIDE[id])).map((id) => REGIONS[id].name).join(', ')}</> : <>Too far from the main road or the river to guard a trade route (within {TOWER_REACH} tiles)</>}</span>; })()}</div>
    {!p.key?.startsWith('field:') && p.action.type !== 'buyPlot' && p.action.type !== 'buyParcel' && <button className="btn ghost" aria-label="Rotate" title="Rotate (R)" onClick={() => rotatePlacement()}>⟳ Rotate</button>}
    {quote?.ok ? <button className="btn primary" disabled={quote.cost > s.cash} title={`Buys ${quote.buy.length} patch${quote.buy.length === 1 ? '' : 'es'} and clears ${quote.clear.length}. The crew needs about ${quote.hours} hours; your ${p.label} goes up when they finish.`} onClick={() => planPlacementHere()}>{quote.buy.length || quote.clear.length ? `Buy & clear · ${money(quote.cost)}` : 'Remove road & place'}</button>
      : <button className="btn primary" disabled={!!problem || !!street} onClick={() => confirmPlacement()}>{p.kind === 'move' ? 'Move here' : 'Place'}</button>}
    <button className="btn ghost" onClick={() => cancelPlacement()}>Cancel</button>
  </div>;
}

/** What confirming a placement will cost: the purchase itself, or the moving fee. */
function placementCost(s: GameState, p: Placement) {
  if (p.kind === 'move') return moveFee(s, p.region, p.key!);
  const a = p.action;
  if (a.type === 'buyPlot') return homePlotPrice(s);
  if (a.type === 'buyParcel') return parcelPrice(s, a.region, a.ha);
  if (a.type === 'build') return buildingPrice(s, a.building, a.region);
  if (a.type === 'buildHomes') return homePrice(s, a.tier) * a.count;
  if (a.type === 'buildService') { let c = servicePrice(s, a.service) * (a.block ? 4 : a.count ?? 1); if (canUpgradeService(a.service)) for (let lv = 1; lv < buildAs(s, 'service'); lv++) c += serviceUpgradePrice(s, { type: a.service, level: lv, count: 1 }); return c; }
  return 0;
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
      <GateRows s={s} />
    </section>
  );
}

const gateValue = (r: GateRow, x: number) => r.fmt === 'pct' ? pct0(x) : r.fmt === 'money' ? money(x) : num(x);
/** The next chapter's requirements as live bars: rows on wide screens, one bar and a count on phones. */
function GateRows({ s }: { s: GameState }) {
  const rows = chapterGate(s);
  if (!rows || s.eraReady) return null;
  const done = rows.filter((r) => r.done).length, next = NEXT_STAGE[s.stageId];
  return <div className="gate-rows" aria-label={`Next chapter${next ? `: ${STAGES[next].title}` : ''}`}>
    <div className="gate-head"><span>Next: {next ? STAGES[next].title : 'chapter'}</span><b>{rows.some((r) => r.either) ? 'either' : `${done}/${rows.length}`}</b></div>
    <div className="gate-compact"><Bar thin value={gateProgress(rows)} color="var(--gold)" label="Progress to the next chapter" /></div>
    {rows.map((r) => <div className={`gate-row${r.done ? ' done' : ''}`} key={r.label}>
      <span>{r.done ? '✓' : r.either ? '◇' : '○'} {r.label}</span><b>{r.pending ? `— / ${gateValue(r, r.target)}` : r.atMost ? `${gateValue(r, r.now)} ≤ ${gateValue(r, r.target)}` : `${gateValue(r, Math.min(r.now, r.target))} / ${gateValue(r, r.target)}`}</b>
      <Bar thin value={r.pending ? 0 : r.done ? 1 : r.atMost ? Math.min(1, r.target / Math.max(1e-9, r.now)) : Math.min(1, r.now / Math.max(1e-9, r.target))} color={r.done ? 'var(--up)' : 'var(--gold)'} label={r.label} />
    </div>)}
  </div>;
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

/** A town service: its level, how full it is (utilities) or how far it reaches (school, clinic, well), and what to do next. */
function ServiceCard({ s, svc, onClose }: { s: GameState; svc: CivicService; onClose: () => void }) {
  const d = SERVICE_DEFS[svc.type], net = UTILITY_OF[svc.type], lv = levelOf(svc), price = serviceUpgradePrice(s, svc), [used, cap] = svc.serving ?? [0, Math.round(utilityFamilies(svc))];
  const full = !!net && cap > 0 && used >= cap;
  const room = trafficRoom(s, 'heartland', `svc:${svc.id}`, levelOf(svc) + 1), jammed = !room.ok, grows = canUpgradeService(svc.type) || (isShop(svc.type) && svcSize(svc) >= 2), reach = !!SERVICE_RADIUS[svc.type] || svc.type === 'mall';
  return <Card title={<>{d.icon} {serviceName(svc)}{grows && <span className="muted"> · level {lv}</span>}</>} actions={<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}>
    <div className="stack s">
      {net ? <><div className="row between small"><span className="muted">Families on its lines</span><b>{used} / {cap}</b></div><Bar value={cap ? used / cap : 0} label={`${used} / ${cap} families on its lines`} color={full ? 'var(--gold)' : 'var(--up)'} /></>
        : svc.type === 'watchtower' || svc.type === 'militia' ? <><p className="small">{svc.type === 'militia' ? <>Rides out with every caravan: <b>+{Math.round(MILITIA_ESCORT[lv - 1] * 100)}%</b> protection on all your trade routes when fully staffed.</> : (() => { const sides = towerSides(s, svc); return sides.length ? <>Watches over <b>{sides.map((x) => SIDE_NAME[x]).join(' and ')}</b>: caravans to {NEIGHBOUR_IDS.filter((id) => sides.includes(ROUTE_SIDE[id])).map((id) => REGIONS[id].name).join(', ')} are raided less. Each level counts for more.</> : <>Too far from the main road or the river to watch any trade route: move it within {TOWER_REACH} tiles of one.</>; })()}</p>
          <button className="btn ghost sm" onClick={() => travel('region')}>🗺 Region map</button></>
        : svc.type === 'parking' ? <p className="small">Takes <b>{Math.round(PARKING_SHARE[lv - 1] * 100)}%</b> of the cars off the streets within <b>{Math.round(serviceRadius(svc))} tiles</b> of road, so traffic there flows freely.</p>
        : reach && <p className="small">{svc.type === 'police' ? 'Cuts crime' : isShop(svc.type) || svc.type === 'mall' ? 'Sells to homes' : 'Full service'} for <b>{Math.round(serviceRadius(svc) * ROAD_REACH)} tiles of road travel</b>, fading out beyond. Dirt tracks and traffic make it reach less far; paved and wide roads further.</p>}
      {svc.type === 'park' && <><p className="small">{PARK_KINDS[svc.park ?? 'garden'].does}. A bigger park counts for more.</p>
        <Seg label="Park layout" value={svc.park ?? 'garden'} onChange={(kind) => act({ type: 'setPark', serviceId: svc.id, kind })} options={(Object.keys(PARK_KINDS) as (keyof typeof PARK_KINDS)[]).map((k) => ({ v: k, label: `${PARK_KINDS[k].icon} ${PARK_KINDS[k].name}` }))} />
        {svc.park && <p className="small muted">Changing the layout costs {money(Math.round(servicePrice(s, 'park') * 0.25))}.</p>}</>}
      {jammed && grows && <div className="callout warn">🚦 {room.why}</div>}
      {full && <div className="callout warn">Full: upgrade it or build another to serve more homes.</div>}
      <div className="row wrap">
        {officeJobs(svc) > 0 && <p className="small">Outside firms offer <b>{officeJobs(svc)} desks</b> to your residents and pay their wages.</p>}
        {grows && lv < (svc.type === 'mall' ? 2 : 3) && <button className="btn primary sm" disabled={price > s.cash || jammed} onClick={() => act({ type: 'upgradeService', serviceId: svc.id })}>⬆ {svc.type === 'mall' ? 'Office tower' : `Level ${lv + 1}`} · {money(price)}</button>}
        {net && <button className="btn ghost sm" onClick={() => { startPipes('heartland', net); onClose(); }}>🔌 Lay lines</button>}
        <AddAnother s={s} k={`svc:${svc.id}`} level={grows ? lv : 1} />
        <Confirm label="Demolish" className="btn danger sm" title={`Demolish this ${serviceName(svc).toLowerCase()}?`} body={`You get back about ${money(Math.round(svc.cost * 0.5))}. Homes it served lose the service; any lines stay in the ground.`} onConfirm={() => { act({ type: 'demolishService', serviceId: svc.id }); onClose(); }} confirmLabel="Demolish" />
        {svc.type === 'police' || isShop(svc.type) || svc.type === 'mall' ? <button className="btn ghost sm" onClick={() => go('city')}>City</button> : <button className="btn ghost sm" onClick={() => go('town')}>Town</button>}
      </div>
    </div>
  </Card>;
}

/** One more of the same, built to the same level: its price, or why it can't be built (on a phone there's no hover, so the reason shows). */
function AddAnother({ s, k, level }: { s: GameState; k: string; level: number }) {
  const day = Math.floor(s.tick / 24), q = useMemo(() => anotherQuote(s, k), [k, day, s.buildings.length, townOf(s).services.length, communityOf(s).homes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return null;
  const poor = !q.why && q.price > s.cash; // q.why depends on where it goes (room, road, zone): you choose the spot, so it's a hint, not a block
  return <>
    <button className="btn ghost sm" disabled={poor} title={q.why} onClick={() => act({ type: 'addAnother', key: k })}>＋ Add another{level > 1 ? ` (level ${level})` : ''}{q.why ? '' : ` · ${money(q.price)}`}</button>
    {(poor || q.why) && <span className="faint small">{poor ? `Needs ${money(q.price)}, you have ${money(s.cash)}` : q.why}</span>}
  </>;
}
/** What a building does to the homes around it at its level: smell, noise, smoke, or fresh bread, and how many homes it reaches. */
function NuisanceLine({ s, b }: { s: GameState; b: GameState['buildings'][number] }) {
  const n = nuisanceOf(b.type, b.level), kinds = Object.entries(n) as [NuisanceKind, number][];
  if (!kinds.length) return null;
  const p = worldOf(s, b.region).pos[`b:${b.id}`], fp = footprintOf(s, `b:${b.id}`), homes = p && fp ? homesReached(s, b.type, b.level, p[0] + fp.w / 2, p[1] + fp.d / 2) : 0;
  return <p className="small">{kinds.map(([k, r]) => <span key={k} className="pill" style={{ marginRight: 6 }}>{NUISANCE_LOOK[k].icon} {NUISANCE_LOOK[k].name} · {r} tiles</span>)}
    {kinds.some(([k]) => k !== 'pleasant') && <span className="muted">{homes ? `${homes} home${homes === 1 ? '' : 's'} affected` : 'no homes nearby'}</span>}</p>;
}
/** The upgrade dialog says when the next level brings a new or wider nuisance. */
function nuisanceChange(b: GameState['buildings'][number]) {
  const now = nuisanceOf(b.type, b.level), next = nuisanceOf(b.type, b.level + 1);
  const worse = (Object.entries(next) as [NuisanceKind, number][]).filter(([k, r]) => k !== 'pleasant' && r > (now[k] ?? 0));
  return worse.length ? <> At level {b.level + 1}: {worse.map(([k, r]) => `${NUISANCE_LOOK[k].icon} ${NUISANCE_LOOK[k].name.toLowerCase()} reaches ${r} tiles`).join(', ')}, keep homes clear.</> : null;
}

function LotPanel({ s, lot, region, onClose }: { s: GameState; lot: Lot; region: RegionId; onClose: () => void }) {
  if(lot.service?.type==='barracks')return <Card title="Barracks"><button className="btn primary" onClick={()=>go('nation')}>Open Nation</button></Card>;
  if(lot.service)return <ServiceCard s={s} svc={townOf(s).services.find((b)=>b.id===lot.service!.id)??lot.service} onClose={onClose} />;
  if (lot.key.startsWith('civic:')) return <Card title="Town services"><button className="btn primary" onClick={() => go('town')}>Open Town hall</button></Card>;
  const home = lot.key.startsWith('community:apartment:') ? communityOf(s).homes.find((h) => h.id === +lot.key.split(':')[2].split('-')[0]) : undefined;
  if (home) { // an apartment building: what it holds, and what its next level needs
    const lv = homeLevel(home), needs = homeUpgradeNeeds(s, home), price = homeUpgradePrice(s, home), ready = needs.every((n) => n.met);
    return <Card title={<>{['Apartments', 'Mid-rise apartments', 'Apartment tower'][lv - 1]} <span className="muted">· level {lv}</span></>} actions={<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}>
      <div className="stack s">
        <p className="small">Homes for <b>{APARTMENT_FAMILIES[lv - 1]} families</b>{lv < 3 && <> · {['a mid-rise', 'a tower'][lv - 1]} holds <b>{APARTMENT_FAMILIES[lv]}</b> on the same ground</>}.</p>
        {lv < 3 && <ul className="need-list">{needs.map((n) => <li key={n.need} className={n.met ? 'met' : ''}>{n.met ? '✓' : '○'} {n.need}</li>)}</ul>}
        <div className="row wrap">
          {lv < 3 && <button className="btn primary sm" disabled={!ready || price > s.cash} onClick={() => act({ type: 'upgradeHome', homeId: home.id })}>⬆ {lv === 1 ? 'Mid-rise' : 'Tower'} · {money(price)}</button>}
          {lv < 3 && !ready && <button className="btn ghost sm" onClick={() => { startPipes('heartland', 'power'); onClose(); }}>🔌 Lay lines</button>}
          <AddAnother s={s} k={`home:${home.id}`} level={lv} />
          <button className="btn ghost sm" onClick={() => go('community')}>Homes & families</button>
        </div>
      </div>
    </Card>;
  }
  if (lot.key.startsWith('community:')) return <Card title="Your neighbourhood"><div className="community-strip"><span title="People living here · homes filled">🏘️ {population(s)} people · {households(s)}/{homeFamilies(s)} homes</span><span>☺ {pct0(communityOf(s).happiness)}</span></div><button className="btn primary" onClick={() => go('community')}>Homes & families</button></Card>;
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
  const picked = bs.find((b) => `b:${b.id}` === lot.key) ?? bs[bs.length - 1]; // the one tapped on the map
  const field = picked?.type === 'oilWell' ? wellField(s, picked) : undefined;
  return (
    <Card title={<>{d.name}{bs.length > 1 && <span className="muted"> ×{bs.length}</span>}</>} actions={<button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}>
      <div className="stack s">
        <p className="explain">{d.blurb}</p>
        {picked && <NuisanceLine s={s} b={picked} />}
        {d.recipe ? (
          <dl className="facts">
            <dt>Running</dt><dd>{active} of {bs.length}</dd>
            <dt>Utilisation</dt><dd>{pct0(util)}</dd>
            {lot.type === 'dairy' && (() => { // every dairy in the region milks from one herd, the first ones filling up before the next gets any
              const herd = s.herds.find((h) => h.region === bs[0].region && h.animal === 'cows')?.count ?? 0;
              const can = s.buildings.filter((b) => b.type === 'dairy' && b.region === bs[0].region && b.active).reduce((n, b) => n + d.recipe!.batchesPerHour * throughput(b) * COWS_PER_DAIRY_BATCH, 0);
              return <><dt>Cows</dt><dd className={herd < can ? 'down' : undefined}>{num(herd)} of {num(can)} the dairies can milk</dd></>;
            })()}
            <dt>Margin</dt><dd className={margin < 0 ? 'down' : 'up'}>{money(margin)}/h</dd>
            <dt>Recipe</dt><dd>{Object.entries(d.recipe.inputs).map(([g, q]) => `${q} ${GOODS[g as keyof typeof GOODS].name.toLowerCase()}`).join(' + ') || 'electricity'} → {Object.entries(recipeOf(picked ?? bs[0])!.outputs).map(([g, q]) => `${q} ${GOODS[g as keyof typeof GOODS].name.toLowerCase()}`).join(' + ') || `${-d.recipe.kwh} kWh`}</dd>
          </dl>
        ) : (
          <dl className="facts">
            {d.dry && <><dt>Dry storage</dt><dd>{num(d.dry * bs.length)}</dd></>}
            {d.cold && <><dt>Cold storage</dt><dd>{num(d.cold * bs.length)}</dd></>}
            <dt>Staff</dt><dd>{money(d.staffPerHour * s.macro.cpi * bs.length)}/h</dd>
          </dl>
        )}
        {picked?.type === 'verticalFarm' && <div className="row wrap">
          <Select label="Grows" value={picked.grows ?? 'greens'} onChange={(g) => act({ type: 'setGrows', buildingId: picked.id, grows: g })} options={VERTICAL_CROPS.filter((g) => g === 'greens' || s.unlockedCrops.includes(g as CropId)).map((g) => ({ v: g, label: `Grows ${GOODS[g].name.toLowerCase()}` }))} />
          {(() => { const houses = s.buildings.filter((b) => b.region === picked.region && factoryCrop(b) && VERTICAL_CROPS.includes(factoryCrop(b)!)); if (!houses.length) return null;
            const name = (b: (typeof houses)[number]) => `${BUILDINGS[b.type].name}${houses.filter((x) => x.type === b.type).length > 1 ? ` #${houses.filter((x) => x.type === b.type).indexOf(b) + 1}` : ''} (${GOODS[factoryCrop(b)!].name.toLowerCase()})`;
            return <select className="input" aria-label="Supplies" title="Its harvest is held for that production house: auto-selling, rules and the Sell buttons leave it alone, and the house uses it first." value={String(picked.supplies ?? '')} onChange={(e) => act({ type: 'farmSupplies', farmId: picked.id, buildingId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">For the market</option>
              {houses.map((b) => <option key={b.id} value={b.id}>Supplies {name(b)}</option>)}
            </select>; })()}
        </div>}
        {picked?.type === 'oilWell' && <div className={`callout ${field && field.left > 0 ? '' : 'warn'}`}>{field ? `This well draws on field ${field.i + 1}: ${num(field.left)} of ${num(field.reserve)} bbl left · ${field.wells.length} well${field.wells.length === 1 ? '' : 's'} (${field.balanced} balanced)` : 'No oil under this well: it pumps nothing. Demolish it.'}</div>}
        {reason && reason !== 'Idle' && <div className={`callout ${/Not enough|full|Disease/.test(reason) ? 'warn' : ''}`}>{reason}</div>}
        {d.category === 'livestock' && <HerdInfo s={s} lot={lot} />}
        {known(s, 'upgrades') && bs.map((b, i) => b.level < maxLevel(b.type) && (
          <div key={b.id} className="row between small">
            <span className="muted">{bs.length > 1 ? `#${i + 1} ` : ''}Level {b.level} → {b.level + 1}: {(() => { const now = throughput(b), next = throughput({ type: b.type, level: b.level + 1 }); return `+${Math.round((next / now - 1) * 100)}%`; })()} {d.recipe ? 'output' : d.category === 'livestock' ? 'space' : 'capacity'}</span>
            {!trafficRoom(s, b.region, `b:${b.id}`, b.level + 1).ok ? <span className="faint small" title={trafficRoom(s, b.region, `b:${b.id}`, b.level + 1).why}>🚦 {trafficRoom(s, b.region, `b:${b.id}`, b.level + 1).need}</span> : upgradeNeedsPower(s, b) ? <span className="faint small" title={upgradeNeedsPower(s, b)!}>⚡ Needs your own power</span> : <Confirm label={`Upgrade · ${money(upgradeCost(s, b))}`} className="btn ghost sm" disabled={upgradeCost(s, b) > s.cash} title={`Upgrade ${d.name.toLowerCase()} to level ${b.level + 1}?`} body={<>Costs <b>{money(upgradeCost(s, b))}</b>. {d.recipe ? 'More output per hour, but staff cost rises 30%.' : d.category === 'livestock' ? 'Room for more animals.' : 'More storage space.'}{nuisanceChange(b)}</>} onConfirm={() => act({ type: 'upgradeBuilding', buildingId: b.id })} confirmLabel="Upgrade" />}
          </div>
        ))}
        <div className="row wrap">
          {d.recipe && <button className="btn ghost sm" onClick={() => bs.forEach((b) => b.active === (active === bs.length) && act({ type: 'toggleBuilding', buildingId: b.id }))}>{active === bs.length ? 'Pause' : 'Resume'}{bs.length > 1 ? ' all' : ''}</button>}
          {page && <button className="btn ghost sm" onClick={() => go(page)}>Open {page}</button>}
          {picked && <AddAnother s={s} k={`b:${picked.id}`} level={picked.level} />}
          {picked && <Confirm label={bs.length > 1 ? 'Demolish this one' : 'Demolish'} className="btn danger sm" title={`Demolish this ${d.name.toLowerCase()}?`} body={`The one you tapped on the map goes. You get back about ${money(Math.max(0, picked.cost - picked.depreciated) * 0.5)}. Stock that no longer fits is sold or lost.`} onConfirm={() => act({ type: 'demolish', buildingId: picked.id })} confirmLabel="Demolish" />}
        </div>
      </div>
    </Card>
  );
}
