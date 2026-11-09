import { frontierPatches, worldOf } from '../simulation/world';
import { expect, it } from 'vitest';
import { botAct } from './bot';
import { createGame, dispatch, step } from '../simulation/engine';
import { CHAPTER_SALES } from '../simulation/config';
import { post, totalAssets } from '../simulation/core';
import { communityOf, population } from '../simulation/community-state';
import { laborTick, wageOf } from '../simulation/operations';
import { canStartSettlement, settlementTick } from '../simulation/stages/settlement';
function ready() {
  const s = createGame(1001); s.legacyProgression = true; s.era = 8; s.stageId = 'nation';
  post(s, 'sale', CHAPTER_SALES.industry, 'Established business fixture');
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
  for (let i = 0; i < 2; i++) expect(dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 }).ok).toBe(true);
  return s;
}
it('Entering Settlement preserves the veteran business and existing staff; homes conserve assets', () => {
  const s = ready(), cash = s.cash, staff = structuredClone(s.workers);
  expect(canStartSettlement(s)).toBe(true);
  expect(dispatch(s, { type: 'startSettlement', charter: 'company' }).ok).toBe(true);
  expect(s.era).toBe(8); expect(s.stageId).toBe('settlement'); expect(s.cash).toBe(cash); expect(s.workers).toEqual(staff);
  const assets = totalAssets(s);
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 }).ok).toBe(true);
  expect(totalAssets(s)).toBeCloseTo(assets, 2);
  s.tick = 24; settlementTick(s);
  expect(population(s)).toBe(4);
  expect(dispatch(s, { type: 'startSettlement', charter: 'free' }).ok).toBe(false);
});
it('Families eat real inventory, rent cannot exceed household funds, and hiring respects available adults', () => {
  const s = ready(); dispatch(s, { type: 'startSettlement', charter: 'company' }); dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 1 });
  s.tick = 24; settlementTick(s);
  const c = communityOf(s); c.autoLarder = false;
  s.regions.heartland.inventory.wheat = 100;
  const cash = s.cash, before = s.regions.heartland.inventory.wheat, fedBefore = s.stats.peopleFed;
  s.tick = 48; settlementTick(s);
  expect(before - s.regions.heartland.inventory.wheat).toBeCloseTo(8000 / 3000, 6);
  expect(s.stats.peopleFed - fedBefore).toBeCloseTo(4 / 365, 6);
  expect(c.fed).toBe(1); expect(c.householdCash).toBe(0);
  expect(s.cash - cash).toBeCloseTo(-0.5 * s.macro.cpi, 2);
  for (let i = 0; i < 2; i++) expect(dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 }).ok).toBe(true);
  expect(dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 }).ok).toBe(false);
  expect(s.workers.filter(w => w.resident)).toHaveLength(2);
  s.tick = 54;
  const wages = s.workers.filter(w => w.resident).reduce((n,w)=>n+Math.round(wageOf(s,w)*100)/100,0);
  laborTick(s);
  expect(c.householdCash).toBeCloseTo(wages, 2);
  const savings = c.householdCash, rent = s.lifetime.rent ?? 0;
  s.tick = 72; settlementTick(s);
  expect((s.lifetime.rent ?? 0) - rent).toBeLessThanOrEqual(savings);
  expect(c.householdCash + (s.lifetime.rent ?? 0) - rent).toBeCloseTo(savings, 2);
});

it('a fresh-game player can establish a healthy 100-person settlement through the real economy', () => {
  const s = createGame(1002); let prior = s.stageId, entered = s.tick;
  const pacing: { stage: string; ticks: number }[] = [];
  for (let i = 0; i < 20000 && population(s) < 100; i++) {
    botAct(s); step(s);
    if (s.stageId !== prior) { pacing.push({ stage: prior, ticks: s.tick - entered }); entered = s.tick; prior = s.stageId; }
  }
  expect(s.stageId).toBe('settlement');
  expect(population(s)).toBeGreaterThanOrEqual(100);
  expect(communityOf(s).happiness).toBeGreaterThan(0.65);
  expect(s.bankrupt).toBeNull();
  expect(s.cash).toBeCloseTo(250 + Object.entries(s.lifetime).reduce((n,[kind,v])=>n+(kind==='depreciation'?0:v??0),0), 1);
  console.log('New-game pacing ticks', JSON.stringify(pacing));
}, 120000);

it('a growing community aggregates families into compact cohorts; every home is its own plot', () => {
  const s = ready(); post(s, 'sharesIssued', 20e6, 'Community capacity fixture');
  dispatch(s, { type: 'startSettlement', charter: 'free' });
  // Streets for 100 homes need room: clear forest at the edge of the farm first, as a player would.
  expect(dispatch(s, { type: 'clearForest', region: 'heartland', chunks: frontierPatches(s, 'heartland', 25) }).ok).toBe(true);
  while (worldOf(s, 'heartland').queue.length) step(s);
  expect(dispatch(s, { type: 'buildHomes', tier: 'apartment', count: 1 }).ok).toBe(false);
  expect(dispatch(s, { type: 'buildHomes', tier: 'cottage', count: 50 }).ok).toBe(true);
  let apartments = false;
  for(let i=0;i<24*300;i++) {
    if(!apartments && population(s)>=200) {expect(dispatch(s,{type:'buildHomes',tier:'apartment',count:50}).ok).toBe(true);apartments=true;}
    step(s);
    expect(communityOf(s).cohorts.length).toBeLessThanOrEqual(51);
  }
  expect(population(s)).toBeGreaterThan(200);
  expect(communityOf(s).homes.every((h) => h.count === 1)).toBe(true); // every home is its own plot on the map
  expect(communityOf(s).homes.length).toBeGreaterThanOrEqual(50);
  expect(communityOf(s).cohorts.some(g=>g.households>1)).toBe(true);
},120000);
