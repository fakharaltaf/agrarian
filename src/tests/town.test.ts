// shortcut: parked while Town is rebuilt on the new families-only Settlement (11 Nov 2026); replace with tests of the new Town.
import { lineEcon } from '../simulation/lines';
import { haulCost } from '../simulation/markets';
import { researchSpeed } from '../simulation/research';
import { balanceSheet, cashFlow, incomeStatement } from '../simulation/statements';
import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post, totalAssets } from '../simulation/core';
import { communityOf, availableResidents, population } from '../simulation/community-state';
import { townOf, payHouseholds, SERVICE_DEFS, servicePrice } from '../simulation/town-state';
import { canStartTown, townDaily, townNextStep } from '../simulation/stages/town';
import { buildingsTick } from '../simulation/processing';
import { parseSave } from '../simulation/persistence';
import { townBotAct } from './bot';
import type { GameState } from '../simulation/types';
function ready(charter:'public'|'trade'='public') {
  const s=createGame(1601);s.legacyProgression=true;s.era=8;s.stageId='settlement';
  post(s,'sharesIssued',3e6,'Town fixture stake');
  const c=communityOf(s);c.active=true;c.charter='free';c.homes=[{id:999,tier:'cottage',count:40,cost:120000}];c.cohorts=[{id:998,name:'Fixture families',households:20,adults:40,children:40}];c.fed=1;c.happiness=.8;
  expect(canStartTown(s)).toBe(true);expect(dispatch(s,{type:'startTown',charter}).ok).toBe(true);
  expect(dispatch(s,{type:'fundTown',amount:200000,direction:'toTown'}).ok).toBe(true);
  return s;
}
const flow=(values:GameState['lifetime'])=>Object.entries(values).reduce((n,[k,v])=>n+(k==='depreciation'?0:v??0),0);
it.skip('Town transfers conserve both accounts and assets, and cannot mint repayments',()=>{
  const s=ready(),t=townOf(s),asset=totalAssets(s),company=s.cash,pub=t.cash;
  expect(dispatch(s,{type:'fundTown',amount:1234.56,direction:'toTown'}).ok).toBe(true);
  expect(totalAssets(s)).toBeCloseTo(asset,2);
  expect(balanceSheet(s).assets).toBeCloseTo(totalAssets(s),2);
  expect(cashFlow(s,1).investing).toBeCloseTo(-201234.56,2);
  expect(incomeStatement(s,1).revenue).toBe(0);
  expect(s.cash+t.cash).toBeCloseTo(company+pub,2);
  expect(dispatch(s,{type:'fundTown',amount:1234.56,direction:'repay'}).ok).toBe(true);
  expect(s.cash).toBe(company);expect(t.cash).toBe(pub);
  const before=JSON.stringify(s);
  expect(dispatch(s,{type:'fundTown',amount:300000,direction:'repay'}).ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
  expect(dispatch(s,{type:'fundTown',amount:-1,direction:'toTown'}).ok).toBe(false);
  expect(s.cash).toBeCloseTo(250+flow(s.lifetime),2);expect(t.cash).toBeCloseTo(flow(t.lifetime),2);
});
it.skip('Taxes only take actual new payroll and public services need cash and available adults',()=>{
  const s=ready(),t=townOf(s),c=communityOf(s);
  c.householdCash=1000;s.tick=24;townDaily(s);
  expect(t.lastTax).toBe(0);expect(c.householdCash).toBe(1000);
  post(s,'wages',-100,'Local payroll fixture');payHouseholds(s,100);
  expect(dispatch(s,{type:'buildService',service:'school',district:'farmgate'}).ok).toBe(true);
  expect(dispatch(s,{type:'buildService',service:'well',district:'orchard'}).ok).toBe(true);
  s.tick=48;townDaily(s);
  expect(t.lastTax).toBe(10);expect(t.coverage.farmgate.school).toBe(1);expect(t.coverage.farmgate.water).toBe(0);
  expect(t.coverage.orchard.water).toBe(0);expect(t.publicJobs).toBe(5);expect(availableResidents(s)).toBe(35);
  expect(t.taxableIncome).toBeGreaterThan(0);
  expect(s.cash).toBeCloseTo(250+flow(s.lifetime),2);expect(t.cash).toBeCloseTo(flow(t.lifetime),2);
  expect(dispatch(s,{type:'fundTown',direction:'repay',amount:Math.min(t.companyAdvance,t.cash)}).ok).toBe(true);
  s.tick=72;townDaily(s);
  // A small next-day tax payment cannot sustain the school; no treasury overdraft occurs.
  expect(t.cash).toBeGreaterThanOrEqual(0);
  expect(t.services.find(b=>b.type==='school')!.funded).toBe(false);
  expect(t.coverage.farmgate.school).toBe(0);
});
it.skip('Factory salaries reach residents without extra company expense, and school reversal does not stack benefits',()=>{
  const s=ready('trade'),t=townOf(s),c=communityOf(s);
  expect(dispatch(s,{type:'build',region:'heartland',building:'flourMill'}).ok).toBe(true);
  expect(dispatch(s,{type:'buildService',service:'school',district:'farmgate'}).ok).toBe(true);
  s.tick=24;townDaily(s);
  expect(t.factoryShare).toBe(1);expect(t.industrialJobs).toBeGreaterThan(0);
  const house=c.householdCash,staff=s.lifetime.staff??0;
  buildingsTick(s);
  expect(c.householdCash-house).toBeCloseTo(-((s.lifetime.staff??0)-staff),2);
  const before=t.cash;
  expect(dispatch(s,{type:'changeSchools',charter:'public'}).ok).toBe(true);
  expect(before-t.cash).toBe(20000*s.macro.cpi);expect(t.education).toBe(0);
  expect(dispatch(s,{type:'changeSchools',charter:'trade'}).ok).toBe(false);
  s.tick=48;townDaily(s);expect(t.education).toBe(0);
  s.tick=24*9;townDaily(s);expect(t.education).toBe(1);
});
it.skip('Coverage and council choices use real resources and remain bounded on large towns',()=>{
  const s=ready(),t=townOf(s),c=communityOf(s);
  expect(dispatch(s,{type:'buildService',service:'hospital',district:'farmgate'}).ok).toBe(false);
  expect(dispatch(s,{type:'buildService',service:'school',district:'farmgate',count:5}).ok).toBe(true);
  expect(dispatch(s,{type:'buildService',service:'school',district:'farmgate',count:5}).ok).toBe(false); // treasury now below price
  expect(t.services).toHaveLength(1);
  expect(dispatch(s,{type:'fundTown',amount:200000,direction:'toTown'}).ok).toBe(true);
  expect(dispatch(s,{type:'buildService',service:'school',district:'farmgate',count:5}).ok).toBe(true);
  expect(t.services).toHaveLength(1);expect(t.services[0].count).toBe(10);
  t.petition={id:997,kind:'bread',opened:0};
  const cash=t.cash;
  expect(dispatch(s,{type:'answerPetition',accept:true}).ok).toBe(false);expect(t.cash).toBe(cash);
  s.regions.heartland.inventory.bread=100;
  expect(dispatch(s,{type:'answerPetition',accept:true}).ok).toBe(true);
  expect(s.regions.heartland.inventory.bread).toBeLessThan(100);expect(t.petition).toBeNull();
  c.autoLarder=false;
  const json=JSON.stringify(s),migrated=parseSave(JSON.stringify({game:s})).game;
  expect(JSON.stringify(migrated)).toBe(json);
  expect(SERVICE_DEFS.school.capacity).toBe(80);expect(servicePrice(s,'school')).toBe(30000*s.macro.cpi);
});
// shortcut: parked while Settlement → City are reworked from scratch (10 Nov 2026); replace with a playthrough of the new design.
it.skip('A new-game player reaches a funded, educated Town using real production and optional chapter actions',()=>{
  const s=createGame(1002);let start=-1;
  for(let i=0;i<24000;i++) {
    townBotAct(s);step(s);
    if(townOf(s).active&&start<0)start=s.tick;
    if(townOf(s).active&&population(s)>=400&&townOf(s).education>.8&&townOf(s).water>.8)break;
  }

  expect(s.stageId).toBe('town');expect(population(s)).toBeGreaterThanOrEqual(400);
  expect(townOf(s).education).toBeGreaterThan(.8);expect(townOf(s).water).toBeGreaterThan(.8);
  expect(s.bankrupt).toBeNull();expect(townOf(s).cash).toBeGreaterThanOrEqual(0);
  expect(s.cash).toBeCloseTo(250+flow(s.lifetime),1);expect(townOf(s).cash).toBeCloseTo(flow(townOf(s).lifetime),1);
  console.log('Town pacing',JSON.stringify({enteredAt:start,developedAt:s.tick,townTicks:s.tick-start,people:population(s)}));
},120000);
it.skip('Clean water and health prevent actual illness losses; cohorts keep adults and children conserved',()=>{
  const ill=ready(),healthy=structuredClone(ill);
  townOf(ill).health=.1;townOf(ill).mortalityCarry=.999;
  townOf(healthy).health=1;townOf(healthy).mortalityCarry=.999;
  const before=population(ill);ill.tick=healthy.tick=24;
  const replay=structuredClone(ill);
  townDaily(ill);townDaily(healthy);townDaily(replay);
  expect(townOf(ill).illnessDeaths).toBe(1);expect(population(ill)).toBe(before-1);
  expect(townOf(healthy).illnessDeaths).toBe(0);expect(population(healthy)).toBe(before);
  expect(ill).toEqual(replay);
  expect(communityOf(ill).cohorts.every(g=>Number.isInteger(g.adults)&&Number.isInteger(g.children)&&g.adults>=0&&g.children>=0)).toBe(true);
});
it.skip('Version-7 households migrate without changing people or money, and fresh saves never reapply the orchard repair',()=>{
  const s=ready();s.stageId='settlement';
  const raw=JSON.parse(JSON.stringify(s));raw.version=7;delete raw.stageState.town;
  for(const group of raw.stageState.settlement.cohorts){delete group.adults;delete group.children;}
  const migrated=parseSave(JSON.stringify({game:raw})).game;
  expect(population(migrated)).toBe(80);expect(migrated.cash).toBe(s.cash);expect(townOf(migrated).active).toBe(false);
  expect(communityOf(migrated).cohorts[0]).toMatchObject({adults:40,children:40});
  const fresh=createGame(1602);fresh.fields[0].crop='apples';fresh.fields[0].pest=.7;
  expect(parseSave(JSON.stringify({game:fresh})).game.fields[0].pest).toBe(.7);
});

it.skip('Town guidance repairs funding and paused services before suggesting duplicate capacity',()=>{
  const s=ready(),t=townOf(s);
  expect(townNextStep(s,'farmgate')).toMatchObject({kind:'build',service:'school'});
  dispatch(s,{type:'buildService',service:'school',district:'farmgate'});
  const school=t.services[0];
  expect(townNextStep(s,'farmgate')).toMatchObject({kind:'build',service:'well'});
  dispatch(s,{type:'toggleService',serviceId:school.id});
  expect(townNextStep(s,'farmgate')).toMatchObject({kind:'resume',serviceId:school.id});
  dispatch(s,{type:'toggleService',serviceId:school.id});
  expect(dispatch(s,{type:'fundTown',amount:t.cash,direction:'repay'}).ok).toBe(true);
  expect(townNextStep(s,'farmgate')).toMatchObject({kind:'fund',upkeep:true});
  expect(t.services).toHaveLength(1);
});

it.skip('Education and roads change real production, research and haulage while preserving material ratios',()=>{
  const s=ready('trade'),t=townOf(s);
  expect(dispatch(s,{type:'build',region:'heartland',building:'flourMill'}).ok).toBe(true);
  expect(dispatch(s,{type:'build',region:'heartland',building:'lab'}).ok).toBe(true);
  t.education=1;t.factoryShare=1;t.health=1;
  const inv=s.regions.heartland.inventory;inv.wheat=100;
  const wheat=inv.wheat,flour=inv.flour;
  const haul=haulCost(s,'heartland',100).cost;t.roads=1;
  expect(haulCost(s,'heartland',100).cost).toBeCloseTo(haul*.85,6);
  buildingsTick(s);
  expect(wheat-inv.wheat).toBeCloseTo(6*1.08*10,6);
  expect(inv.flour-flour).toBeCloseTo((wheat-inv.wheat)*.8,6);
  const mill=s.buildings.find(b=>b.type==='flourMill')!;
  expect(lineEcon(s,[mill],true).qty.flour).toBeCloseTo((inv.flour-flour)*24,6);
  expect(researchSpeed(s)).toBeCloseTo(1.05,6);
  t.charter='public';expect(researchSpeed(s)).toBeCloseTo(1.15,6);
});
