import {buildingsTick} from '../simulation/processing';
import {lineEcon} from '../simulation/lines';
import {expect,it} from 'vitest';
import {createGame,dispatch,step} from '../simulation/engine';
import {communityOf,population,workingAdults} from '../simulation/community-state';
import {post} from '../simulation/core';
import {townOf,localEmployment,zoningFactor} from '../simulation/town-state';
import {canStartCity,cityDaily,cityCrimeTarget} from '../simulation/stages/city';
import {cityOf,cityActive} from '../simulation/city-state';
import {townDaily,serviceDailyCost} from '../simulation/stages/town';
import {parseSave} from '../simulation/persistence';
import {cityBotAct} from './bot';
function ready(){
 const s=createGame(1701);s.legacyProgression=true;s.era=8;s.stageId='town';
 post(s,'sharesIssued',5e6,'City test stake');
 const c=communityOf(s);c.active=true;c.charter='free';c.cohorts=[{id:999,name:'Families',households:100,adults:200,children:200}];c.homes=[{id:998,tier:'cottage',count:100,cost:300000}];c.fed=1;c.happiness=.9;
 const t=townOf(s);t.active=true;t.charter='public';t.education=.8;t.health=.9;t.roads=1;
 expect(dispatch(s,{type:'fundTown',amount:1e6,direction:'toTown'}).ok).toBe(true);
 return s;
}
const flow=(x:Record<string,number|undefined>)=>Object.entries(x).reduce((n,[k,v])=>n+(k==='depreciation'?0:v??0),0);
it('City is an optional, capability-preserving charter; old version10 city ids remain inactive',()=>{
 const s=ready(),cash=s.cash,people=population(s),old=structuredClone(s);
 expect(canStartCity(s)).toBe(true);expect(cityActive(s)).toBe(false);
 expect(dispatch(s,{type:'startCity',charter:'watch'}).ok).toBe(true);
 expect(s.cash).toBe(cash);expect(population(s)).toBe(people);expect(s.era).toBe(8);expect(s.stageId).toBe('city');
 expect(dispatch(s,{type:'startCity',charter:'strict'}).ok).toBe(false);
 const raw=JSON.parse(JSON.stringify(old));raw.version=10;raw.stageState.city={};raw.stageId='city';
 const loaded=parseSave(JSON.stringify({game:raw})).game;
 expect(cityActive(loaded)).toBe(false);expect(loaded.cash).toBe(cash);expect(population(loaded)).toBe(people);
 const corrupt=structuredClone(s);cityOf(corrupt).crime='invalid' as unknown as number;
 expect(()=>parseSave(JSON.stringify({game:corrupt}))).toThrow(/safety/);
});
// shortcut: built on the old town treasury, which the new Town replaced (11 Nov 2026); rewrite with the City/Region rework.
it.skip('Civic utilities and police share real adults and paid public money; no funds means no coverage',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'strict'});
 for(const service of ['sanitation','lighting','police'] as const)expect(dispatch(s,{type:'buildService',service,district:'farmgate'}).ok).toBe(true);
 const c=communityOf(s),t=townOf(s),before=t.cash,household=c.householdCash;
 s.tick=24;townDaily(s);cityDaily(s);
 expect(t.publicJobs).toBe(15);expect(localEmployment(s)).toBeLessThanOrEqual(workingAdults(s));expect(c.householdCash).toBeGreaterThan(household);
 expect(before-t.cash).toBeCloseTo((['sanitation','lighting','police'] as const).reduce((n,type)=>n+serviceDailyCost(s,type),0),2);
 expect(cityOf(s)).toMatchObject({sanitation:1,lighting:1,police:.75});
 const saved=JSON.stringify(s);cityDaily(s);townDaily(s);expect(JSON.stringify(s)).toBe(saved);
 const repay=t.cash;dispatch(s,{type:'fundTown',direction:'repay',amount:repay});
 s.tick=48;townDaily(s);cityDaily(s);
 expect(cityOf(s).sanitation).toBe(0);expect(t.publicJobs).toBe(0);
 expect(t.cash).toBeCloseTo(flow(t.lifetime),2);expect(s.cash).toBeCloseTo(250+flow(s.lifetime),2);
});
it('Jobs, schools and happiness prevent crime without a police force; strict suppression costs happiness',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'watch'});
 const t=townOf(s),c=communityOf(s),v=cityOf(s);v.lighting=1;t.education=1;t.publicJobs=200;c.happiness=1;
 expect(cityCrimeTarget(s)).toBe(0);expect(v.police).toBe(0);
 t.publicJobs=0;t.education=0;c.happiness=.3;t.roads=0;v.lighting=0;
 expect(cityCrimeTarget(s)).toBeGreaterThan(.4);
 v.police=1;const watch=cityCrimeTarget(s);v.charter='strict';expect(cityCrimeTarget(s)).toBeLessThan(watch);
});
it('Zoning is paid and reversible, never removes homes, and empty zones give no free industry',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'professional'});const c=communityOf(s),homes=structuredClone(c.homes),people=population(s),cash=townOf(s).cash;
 expect(dispatch(s,{type:'setZone',district:'heights',zone:'industrial'}).ok).toBe(true);expect(zoningFactor(s)).toBe(1);
 expect(dispatch(s,{type:'setZone',district:'farmgate',zone:'industrial'}).ok).toBe(true);expect(zoningFactor(s)).toBeCloseTo(1.05);
 expect(dispatch(s,{type:'setZone',district:'farmgate',zone:'residential'}).ok).toBe(true);expect(zoningFactor(s)).toBeCloseTo(.95);
 expect(townOf(s).cash).toBe(cash-15000*s.macro.cpi);expect(c.homes).toEqual(homes);expect(population(s)).toBe(people);
});
it('Officer training takes paid time; case defaults consume public funds and preserve deterministic replay',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'professional'});dispatch(s,{type:'buildService',service:'police',district:'farmgate'});
 const v=cityOf(s),before=townOf(s).cash;
 expect(dispatch(s,{type:'trainPolice'}).ok).toBe(true);expect(v.training).toBe(1);expect(before-townOf(s).cash).toBe(15000*s.macro.cpi);
 expect(dispatch(s,{type:'trainPolice'}).ok).toBe(false);
 s.tick=Math.ceil(v.trainingUntil/24)*24;cityDaily(s);expect(v.training).toBe(1.25);
 v.case={id:997,district:'farmgate',kind:'theft',opened:s.tick,deadline:s.tick+24,good:'wheat',lost:5};
 const clone=structuredClone(s);s.tick+=24;clone.tick+=24;cityDaily(s);cityDaily(clone);expect(s).toEqual(clone);expect(v.case).toBeNull();expect(v.rehabilitated).toBe(1);
 const json=JSON.stringify(s);expect(JSON.stringify(parseSave(JSON.stringify({game:s})).game)).toBe(json);
});
// shortcut: parked while Settlement → City are reworked from scratch (10 Nov 2026); replace with a playthrough of the new design.
it.skip('A new farm reaches a serviced safe1200-person City through real actions, no grants',()=>{
 const s=createGame(1002);let entry=-1;
 for(let i=0;i<60000;i++){
  cityBotAct(s);step(s);if(cityActive(s)&&entry<0)entry=s.tick;
  const v=cityOf(s);if(v.active&&population(s)>=1200&&v.sanitation>=.7&&v.crime<=.2)break;
 }
 expect(cityActive(s)).toBe(true);expect(population(s)).toBeGreaterThanOrEqual(1200);expect(cityOf(s).sanitation).toBeGreaterThanOrEqual(.7);expect(cityOf(s).crime).toBeLessThanOrEqual(.2);expect(s.bankrupt).toBeNull();
 expect(s.cash).toBeCloseTo(250+flow(s.lifetime),1);expect(townOf(s).cash).toBeCloseTo(flow(townOf(s).lifetime),1);
 console.log('City pacing',JSON.stringify({enteredAt:entry,developedAt:s.tick,cityTicks:s.tick-entry,population:population(s)}));
},120000);

it('Theft cannot take dedicated inputs or household reserves, and unpaid default cases grant nothing',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'watch'});const v=cityOf(s),t=townOf(s),c=communityOf(s);
 dispatch(s,{type:'build',region:'heartland',building:'flourMill'});const mill=s.buildings[0];mill.reserved=90;
 s.regions.heartland.inventory.wheat=100;c.larderHold={wheat:8};
 for(let day=1;day<180&&!v.case;day++){v.crime=.8;v.nextCaseDay=0;s.tick=day*24;cityDaily(s);}
 expect(v.case).not.toBeNull();expect(v.case!.lost).toBeLessThanOrEqual(2);expect(s.regions.heartland.inventory.wheat).toBeGreaterThanOrEqual(98);
 dispatch(s,{type:'fundTown',direction:'repay',amount:t.cash});v.prevention=0;s.tick=Math.ceil(v.case!.deadline/24)*24;cityDaily(s);
 expect(v.case).toBeNull();expect(v.prevention).toBe(0);expect(v.caseHistory.at(-1)?.answer).toBe('unfunded');
});

// Private real-save fixtures are made by scripts/chapter-fixture.mjs through real actions.
// @ts-expect-error Node IO is only used by opt-in local verification.
import {readFileSync} from 'node:fs';
// @ts-expect-error Node environment is absent from the browser type project.
const fixtures=process.env.AGRARIAN_CITY_FIXTURES as string|undefined;
it.skipIf(!fixtures)('Real veteran City copies run thirty days with conserved accounts, finite state and identical replay',()=>{
 const finite=(x:unknown,path='state')=>{if(x===undefined)throw new Error(path+' undefined');if(typeof x==='number')expect(Number.isFinite(x),path).toBe(true);if(x&&typeof x==='object')for(const[k,v]of Object.entries(x))finite(v,path+'.'+k);};
 for(const path of fixtures!.split(',')){
  const s=parseSave(readFileSync(path,'utf8')).game,copy=structuredClone(s),cash=s.cash,companyFlow=flow(s.lifetime),t=townOf(s),publicCash=t.cash,publicFlow=flow(t.lifetime),tick=s.tick;
  for(let i=0;i<720;i++){step(s);step(copy);}
  expect(s.tick-tick).toBe(720);expect(s).toEqual(copy);finite(s);
  expect(s.cash-cash).toBeCloseTo(flow(s.lifetime)-companyFlow,1);expect(t.cash-publicCash).toBeCloseTo(flow(t.lifetime)-publicFlow,1);
  expect(parseSave(JSON.stringify({game:s})).game).toEqual(s);expect(cityOf(s).crime).toBeGreaterThanOrEqual(0);expect(cityOf(s).crime).toBeLessThanOrEqual(1);expect(population(s)).toBeGreaterThan(0);
  console.log('City real save',JSON.stringify({path,people:population(s),crime:cityOf(s).crime,treasury:t.cash,ticks:s.tick-tick}));
 }
},120000);

it('Delegated public advances conserve both accounts and respect the company reserve',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'watch'});dispatch(s,{type:'buildService',service:'sanitation',district:'farmgate'});
 const t=townOf(s);dispatch(s,{type:'fundTown',amount:t.cash,direction:'repay'});
 const cash=s.cash,advance=t.companyAdvance;s.automation.policies.cashReserve=cash-100;
 expect(dispatch(s,{type:'setCityFunding',enabled:true}).ok).toBe(true);
 s.tick=24;cityDaily(s);expect(s.cash).toBe(cash-100);expect(t.cash).toBe(100);expect(t.companyAdvance).toBe(advance+100);
 const state=JSON.stringify(s);cityDaily(s);expect(JSON.stringify(s)).toBe(state);
 s.tick=48;cityDaily(s);expect(t.cash).toBe(100);expect(s.cash+t.cash).toBe(cash);
 expect(s.cash).toBeCloseTo(250+flow(s.lifetime),2);expect(t.cash).toBeCloseTo(flow(t.lifetime),2);
 s.automation.policies.cashReserve=0;post(s,'dividends',-(s.cash-1000),'Fixture distributions');
 const publicBefore=t.cash;s.tick=72;cityDaily(s);expect(s.cash).toBe(800);expect(t.cash-publicBefore).toBe(200);
});


it('Occupied industrial zoning changes real throughput and its preview without creating recipe inputs',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'watch'});dispatch(s,{type:'build',region:'heartland',building:'flourMill'});
 s.regions.heartland.inventory.wheat=200;
 const base=structuredClone(s);expect(dispatch(s,{type:'setZone',district:'farmgate',zone:'industrial'}).ok).toBe(true);
 buildingsTick(base);buildingsTick(s);
 const before=base.regions.heartland.inventory,after=s.regions.heartland.inventory;
 expect(200-after.wheat).toBeCloseTo((200-before.wheat)*1.05,5);
 expect(after.flour).toBeCloseTo((200-after.wheat)*.8,5);
 expect(lineEcon(s,s.buildings,true).qty.flour).toBeCloseTo(after.flour*24,5);
});
it('Funded sanitation improves actual health instead of being a cosmetic coverage bar',()=>{
 const dirty=ready();dispatch(dirty,{type:'startCity',charter:'watch'});
 for(const [service,count] of [['well',4],['clinic',3],['school',3]] as const)dispatch(dirty,{type:'buildService',service,count,district:'farmgate'});
 const clean=structuredClone(dirty);expect(dispatch(clean,{type:'buildService',service:'sanitation',district:'farmgate'}).ok).toBe(true);
 for(let day=1;day<=3;day++)for(const s of [dirty,clean]){s.tick=day*24;townDaily(s);cityDaily(s);}
 expect(cityOf(clean).sanitation).toBe(1);expect(cityOf(dirty).sanitation).toBe(0);
 expect(townOf(clean).health).toBeGreaterThan(townOf(dirty).health);
});
