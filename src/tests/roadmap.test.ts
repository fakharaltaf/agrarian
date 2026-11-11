import {createCityState} from '../simulation/city-state';
import { createRegionState } from '../simulation/region-state';
import { createNationState } from '../simulation/nation-state';
import { expect, it } from 'vitest';
// Node-only local evidence; real player files are never included in the repository.
// @ts-expect-error Node types are deliberately absent from the browser project
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSave } from '../simulation/persistence';
import { canAdvance, createGame, dispatch, newField, step } from '../simulation/engine';
import { BUILDINGS, CHAPTER_SALES, GOOD_IDS, OPEX_KINDS, REGION_IDS } from '../simulation/config';
import { lineEcon } from '../simulation/lines';
import { STAGES, STAGE_IDS, stageIdForEra, tickActiveStage } from '../simulation/stages';
import { HOMESTEAD_MILL_PRICE, homesteadState, traderHaggleChance } from '../simulation/stages/homestead';
import { HOMESTEAD_SALES_GOAL } from '../simulation/progression';
import { botAct } from './bot';
import { createTownState, servicePrice, townOf } from '../simulation/town-state';
import { communityOf, createSettlementState, population } from '../simulation/community-state';
import { canStartSettlement } from '../simulation/stages/settlement';
import type { GameState } from '../simulation/types';

function finiteTree(value: unknown, path = 'state') {
  if (typeof value === 'number') expect(Number.isFinite(value), path).toBe(true);
  if (value === undefined) throw new Error(`${path} is undefined`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
}
const cashFlows = (s: GameState) => Object.entries(s.lifetime).reduce((n, [k, v]) => n + (k === 'depreciation' ? 0 : v ?? 0), 0);
it('stage registry uses stable string ids and preserves the eight legacy-era identities', () => {
  expect(Object.keys(STAGES).sort()).toEqual([...STAGE_IDS].sort());
  expect([1,2,3,4,5,6,7,8].map(stageIdForEra)).toEqual([
    'homestead','market-town','farm-business','industry','industry','region','city','nation',
  ]);
  const s = createGame(44), before = structuredClone(s);
  tickActiveStage(s);
  expect((s.stageState.homestead as { offers: unknown[] }).offers.length).toBe(3);
  expect(s.cash).toBe(before.cash);
  for (const id of STAGE_IDS) {
    expect(STAGES[id].id).toBe(id);
    expect(typeof STAGES[id].tick).toBe('function');
    expect(typeof STAGES[id].handleAction).toBe('function');
    expect(STAGES[id].createState()).toEqual(id === 'homestead' ? { day: -1, mood: 50, offers: [] } : id === 'market-town' ? { lastMarketDay: -1 } : id === 'settlement' ? createSettlementState() : id === 'town' ? createTownState() : id==='city'?createCityState():id==='region'?createRegionState():id==='nation'?createNationState():{});
  }
});
it('player chapter advancement synchronizes the stable stage id', () => {
  const s = createGame(46);
  for (let i = 0; i < 3; i++) s.fields.push(newField(s, 'heartland', 1, 0));
  s.lifetime.sale = HOMESTEAD_SALES_GOAL;
  s.eraReady = true;
  expect(dispatch(s, { type: 'advanceEra' }).ok).toBe(false);
  expect(dispatch(s, { type: 'chooseCharter', charter: 'fair' }).ok).toBe(true);
  expect(dispatch(s, { type: 'advanceEra' }).ok).toBe(true);
  expect(s.era).toBe(2);
  expect(s.stageId).toBe('market-town');
  step(s);
  expect(s.stageState['market-town']).toEqual({ lastMarketDay: 0 });
  expect(s.events.some((event) => event.kind === 'demandSurge' && event.good)).toBe(true);
});
it('new Homestead uses a daily barter board and fixed wheat buyer before opening the market', () => {
  const s = createGame(740);
  expect(s.stageId).toBe('homestead');
  expect(s.legacyProgression).toBe(false);
  expect((s.stageState.homestead as { offers: unknown[] }).offers).toHaveLength(3);
  s.regions.heartland.inventory.wheat = 40;
  const openSale = dispatch(s, { type: 'sell', region: 'heartland', good: 'wheat', qty: 1 });
  expect(openSale.ok).toBe(false);
  const offer = (s.stageState.homestead as { offers: { id: string; takeQty: number }[] }).offers[0];
  expect(dispatch(s, { type: 'haggle', offerId: offer.id }).ok).toBe(true);
  expect(dispatch(s, { type: 'haggle', offerId: offer.id }).ok).toBe(false);
  expect(dispatch(s, { type: 'barter', offerId: offer.id }).ok).toBe(true);
  expect(s.seeds.corn).toBeGreaterThan(0);
  const marketBefore = s.markets.heartland.wheat!.inv;
  const cashBefore = s.cash;
  expect(dispatch(s, { type: 'sellToMill', qty: 10 }).ok).toBe(true);
  expect(s.cash - cashBefore).toBeCloseTo(10 * HOMESTEAD_MILL_PRICE, 6);
  expect(s.regions.heartland.inventory.wheat).toBe(40 - offer.takeQty - 10);
  expect(s.markets.heartland.wheat!.inv).toBe(marketBefore + 10);
  expect(dispatch(s, { type: 'sellToMill', qty: 100 }).ok).toBe(false);
  expect(dispatch(s, { type: 'sell', region: 'heartland', good: 'wheat', qty: 1 }).ok).toBe(false);
  s.fields.push(newField(s, 'heartland', 1, 0), newField(s, 'heartland', 1, 0), newField(s, 'heartland', 1, 0));
  s.lifetime.sale = HOMESTEAD_SALES_GOAL;
  s.eraReady = true;
  expect(canAdvance(s)).toBe(true);
  expect(dispatch(s, { type: 'chooseCharter', charter: 'fair' }).ok).toBe(true);
  expect(dispatch(s, { type: 'advanceEra' }).ok).toBe(true);
  expect(s.stageId).toBe('market-town');
  step(s);
  expect(s.stageId).toBe('market-town');
  expect(dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 }).ok).toBe(false);
  expect(dispatch(s, { type: 'sellToMill', qty: 1 }).ok).toBe(true); // trader remains a side channel
});
it('Fair and Shrewd trader charters have distinct, persistent and previewed tradeoffs', () => {
  const fair = createGame(744), shrewd = createGame(744);
  for (const s of [fair, shrewd]) {
    for (let i = 0; i < 3; i++) s.fields.push(newField(s, 'heartland', 1, 0));
    s.lifetime.sale = HOMESTEAD_SALES_GOAL;
    s.eraReady = true;
  }
  const fairBase = homesteadState(fair).offers[0]!.give.qty;
  expect(dispatch(fair, { type: 'chooseCharter', charter: 'fair' }).ok).toBe(true);
  expect(dispatch(shrewd, { type: 'chooseCharter', charter: 'shrewd' }).ok).toBe(true);
  expect(fair.charters.trader).toBe('fair');
  expect(shrewd.charters.trader).toBe('shrewd');
  expect(fair.values.prosperityFairness).toBe(68);
  expect(shrewd.values.prosperityFairness).toBe(32);
  expect(fair.corp.reputation).toBe(54);
  expect(shrewd.corp.reputation).toBe(42);
  expect(homesteadState(fair).mood).toBe(68);
  expect(homesteadState(shrewd).mood).toBe(42);
  expect(homesteadState(fair).offers[0]!.give.qty).toBe(Math.ceil(fairBase * 1.1));
  expect(traderHaggleChance(shrewd)).toBeGreaterThan(traderHaggleChance(fair));
  expect(dispatch(fair, { type: 'chooseCharter', charter: 'shrewd' }).ok).toBe(false);
  expect(dispatch(fair, { type: 'advanceEra' }).ok).toBe(true);
  expect(fair.charters.trader).toBe('fair');
});
it('Market Town schedules a real, weekly demand surge and does not repeat it within the day', () => {
  const market = createGame(742), quiet = createGame(742);
  market.stageId = quiet.stageId = 'market-town';
  market.stageState['market-town'] = { lastMarketDay: -1 };
  quiet.stageState['market-town'] = { lastMarketDay: 0 };
  step(market); step(quiet); // stage schedules demand after this hour's market tick
  expect(market.events.some((e) => e.kind === 'demandSurge' && e.region === 'heartland')).toBe(true);
  step(market); step(quiet);
  expect(market.markets.heartland.wheat!.demandToday).toBeGreaterThan(quiet.markets.heartland.wheat!.demandToday);
  const before = market.events.length;
  for (let i = 0; i < 18; i++) step(market);
  expect(market.events.length).toBe(before);
});
it('a competent new-game bot reaches Market Town without cash grants', () => {
  const s = createGame(741);
  for (let i = 0; i < 2200 && s.stageId === 'homestead'; i++) { botAct(s); step(s); }
  expect(s.stageId).toBe('market-town');
  expect(s.tick - 6).toBeGreaterThanOrEqual(420);
  expect(s.tick - 6).toBeLessThanOrEqual(900);
  expect(s.lifetime.sale).toBeGreaterThanOrEqual(HOMESTEAD_SALES_GOAL);
  expect(s.fields.length).toBeGreaterThanOrEqual(4);
  expect(s.ledger.some((entry) => entry.memo.startsWith('Village mill bought'))).toBe(true);
});
it('a competent player can grow from Market Town into Farm Business', () => {
  const s = createGame(743);
  let enteredMarket = -1;
  const start = s.tick;
  for (let i = 0; i < 10_000 && s.stageId !== 'farm-business'; i++) {
    botAct(s); step(s);
    if (enteredMarket < 0 && s.stageId === 'market-town') enteredMarket = s.tick;
  }
  expect(s.stageId).toBe('farm-business');
  expect(s.lifetime.sale).toBeGreaterThanOrEqual(CHAPTER_SALES['market-town']);
  const homesteadTicks = enteredMarket - start, marketTownTicks = s.tick - enteredMarket;
  expect(marketTownTicks).toBeGreaterThanOrEqual(homesteadTicks * 1.5);
  expect(marketTownTicks).toBeLessThanOrEqual(homesteadTicks * 3.5);
});
it('pure save migration round-trips and preserves deterministic continuation', () => {
  const a = parseSave(JSON.stringify({version: 2, game: createGame(819)})).game;
  const b = parseSave(JSON.stringify({version: 2, game: a, paused: true, savedAt: 1})).game;
  for (let i = 0; i < 72; i++) { step(a); step(b); }
  expect(b).toEqual(a);
  finiteTree(b);
});
// @ts-expect-error Node environment only
const root = process.env.AGRARIAN_SAVES;
const names = ['year10-day4-repaired', 'year35-day52', 'year55-day118', 'year125-day22'];
const reports: unknown[] = [];
for (const name of names) (root ? it : it.skip)(`real-save baseline: ${name}, 30 days`, () => {
  const s = parseSave(readFileSync(`${root}/agrarian-${name}.json`, 'utf8')).game;
  const before = structuredClone(s.lifetime), cash = s.cash, flows = cashFlows(s), tick = s.tick;
  const groups = [...new Set(s.buildings.filter(b => BUILDINGS[b.type].recipe).map(b => `${b.region}:${b.type}`))].map(key => ({key, buildings: s.buildings.filter(b => `${b.region}:${b.type}` === key)}));
  const signs = new Map<string, boolean>(), prices: Record<string, number[]> = {};
  let flips = 0;
  const t = performance.now();
  for (let i = 0; i < 720; i++) {
    step(s);
    for (const g of groups) { const positive = lineEcon(s, g.buildings).worth >= 0; if (signs.has(g.key) && signs.get(g.key) !== positive) flips++; signs.set(g.key, positive); }
    for (const good of ['wheat', 'corn', 'flour', 'feed', 'bread'] as const) (prices[good] ??= []).push(s.markets.heartland[good]!.price);
  }
  const elapsed = performance.now() - t;
  expect(s.tick - tick === 720 || !!s.bankrupt).toBe(true);
  finiteTree(s);
  expect(s.cash - cash).toBeCloseTo(cashFlows(s) - flows, 1);
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  for (const r of REGION_IDS) for (const g of GOOD_IDS) expect(s.regions[r].inventory[g]).toBeGreaterThanOrEqual(-1e-6);
  const delta = (k: keyof typeof before) => (s.lifetime[k] ?? 0) - (before[k] ?? 0);
  const sales = delta('sale') + delta('contract');
  const op = sales + OPEX_KINDS.filter(k => k !== 'fines').reduce((n,k) => n + delta(k),0);
  const volatility = Object.fromEntries(Object.entries(prices).map(([g, values]) => { const mean = values.reduce((a,b)=>a+b,0)/values.length; return [g, {min: Math.min(...values),max:Math.max(...values),cv: Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length)/mean}]; }));
  // Separate timing pass: no validation, chart calculations or file IO in the measured loop.
  const timed = parseSave(readFileSync(`${root}/agrarian-${name}.json`, 'utf8')).game;
  const timingStartTick=timed.tick,start = performance.now(); for (let i = 0; i < 720; i++) step(timed);
  const ticksPerSecond = (timed.tick-timingStartTick)*1000 / (performance.now()-start);
  const report = {name,simulatedTicks:s.tick-tick,bankrupt:!!s.bankrupt,sales,operatingProfitExcludingFinesAndTax:op,cashDelta:s.cash-cash,flipsPerDay:flips/30,ticksPerSecond,elapsed,volatility};
  reports.push(report); console.log(JSON.stringify(report));
  // @ts-expect-error Node environment only
  if (process.env.AGRARIAN_REPORT) writeFileSync(process.env.AGRARIAN_REPORT, JSON.stringify(reports,null,2));
}, 120000);

(root ? it : it.skip)('Year10 recovery uses the actual restructuring action and completes 30 days',()=>{
  const s=parseSave(readFileSync(`${root}/agrarian-year10-day4-repaired.json`,'utf8')).game;
  const cash=s.cash, flows=cashFlows(s), tick=s.tick;
  let restructures=0;
  for(let i=0;i<720;i++){
    if(s.bankrupt){expect(dispatch(s,{type:'restructure'}).ok).toBe(true);restructures++;}
    step(s);
  }
  expect(s.tick-tick).toBe(720);finiteTree(s);
  expect(s.cash-cash).toBeCloseTo(cashFlows(s)-flows,1);
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  console.log('Year10 recovery actions',restructures);
},120000);

(root ? it : it.skip)('veteran Settlement entry preserves capabilities and runs the community for 30 days', () => {
  for(const name of ['year55-day118','year125-day22']) {
    const s=parseSave(readFileSync(`${root}/agrarian-${name}.json`,'utf8')).game;
    const era=s.era,cash=s.cash,flows=cashFlows(s),workers=structuredClone(s.workers),tick=s.tick;
    expect(canStartSettlement(s)).toBe(true);
    expect(dispatch(s,{type:'startSettlement',charter:'free'}).ok).toBe(true);
    expect(s.cash).toBe(cash);expect(s.workers).toEqual(workers);expect(s.era).toBe(era);
    expect(dispatch(s,{type:'buildHomes',tier:'cottage',count:10}).ok).toBe(true);
    const start=performance.now();for(let i=0;i<720;i++)step(s);
    const rate=720000/(performance.now()-start);
    expect(s.tick-tick).toBe(720);expect(s.stageId).toBe('settlement');expect(s.era).toBe(era);
    expect(population(s)).toBeGreaterThan(0);expect(communityOf(s).fed).toBeGreaterThan(0.95);
    finiteTree(s);expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.cash-cash).toBeCloseTo(cashFlows(s)-flows,1);
    console.log('Active Settlement real save',JSON.stringify({name,people:population(s),ticksPerSecond:rate}));
  }
},120000);

(root ? it : it.skip)('veteran Town migration preserves company assets and reconciles both accounts for 30 days',()=>{
  for(const name of ['year55-day118','year125-day22']) {
    const s=parseSave(readFileSync(`${root}/agrarian-${name}.json`,'utf8')).game;
    const era=s.era;
    expect(dispatch(s,{type:'startSettlement',charter:'free'}).ok).toBe(true);
    expect(dispatch(s,{type:'buildHomes',tier:'cottage',count:25}).ok).toBe(true);
    for(let i=0;i<960&&population(s)<100;i++)step(s);
    expect(dispatch(s,{type:'startTown',charter:'public'}).ok).toBe(true);
    const amount=Math.ceil(['school','well','clinic','road'].reduce((n,type)=>n+servicePrice(s,type as 'school'|'well'|'clinic'|'road'),0)*2);
    expect(dispatch(s,{type:'fundTown',amount,direction:'toTown'}).ok).toBe(true);
    for(const service of ['school','well','clinic','road'] as const)expect(dispatch(s,{type:'buildService',service,district:'farmgate'}).ok).toBe(true);
    const cash=s.cash,flows=cashFlows(s),tick=s.tick;
    for(let i=0;i<720;i++)step(s);
    expect(s.tick-tick).toBe(720);expect(s.era).toBe(era);expect(s.stageId).toBe('town');
    expect(population(s)).toBeGreaterThanOrEqual(99);expect(townOf(s).education).toBe(1);expect(townOf(s).water).toBe(1);
    expect(s.cash-cash).toBeCloseTo(cashFlows(s)-flows,1);
    expect(townOf(s).cash).toBeCloseTo(Object.values(townOf(s).lifetime).reduce((n,v)=>n+(v??0),0),1);
    finiteTree(s);expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    console.log('Active Town real save',JSON.stringify({name,people:population(s),treasury:townOf(s).cash,health:townOf(s).health}));
  }
},120000);
