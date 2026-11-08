import {expect,it} from 'vitest';
import {createGame,dispatch,step} from '../simulation/engine';
import {communityOf,workingAdults,population} from '../simulation/community-state';
import {post} from '../simulation/core';
import {townOf} from '../simulation/town-state';
import {cityOf} from '../simulation/city-state';
import {regionOf} from '../simulation/region-state';
import {nationOf,nationActive,DEFENCE} from '../simulation/nation-state';
import {canStartNation,nationDaily,soldiers,armyStrength,campaignOdds,plunder} from '../simulation/stages/nation';
import {parseSave} from '../simulation/persistence';
import {canAdvance} from '../simulation/progression';

function ready(){
 const s=createGame(1901);s.legacyProgression=true;s.era=8;s.stageId='region';
 post(s,'sharesIssued',5e6,'Nation test stake');
 const c=communityOf(s);c.active=true;c.charter='free';c.cohorts=[{id:999,name:'Families',households:300,adults:700,children:600}];c.homes=[{id:998,tier:'cottage',count:330,cost:990000}];c.fed=1;c.happiness=.9;
 const t=townOf(s);t.active=true;t.charter='public';t.education=.8;t.health=.9;t.roads=1;
 expect(dispatch(s,{type:'fundTown',amount:2e6,direction:'toTown'}).ok).toBe(true);
 cityOf(s).active=true;cityOf(s).charter='watch';
 const r=regionOf(s);r.active=true;r.border='open';r.answered='refused';
 s.regions.heartland.inventory.wheat=8000;s.tick=24*10;return s;
}
const flows=(s:ReturnType<typeof createGame>)=>Object.entries(s.lifetime).reduce((n,[k,v])=>n+(k==='depreciation'?0:v??0),0);
const army=(s:ReturnType<typeof createGame>)=>{expect(dispatch(s,{type:'startNation',path:'army'}).ok).toBe(true);expect(dispatch(s,{type:'buildService',service:'barracks',district:'farmgate'}).ok).toBe(true);for(let i=0;i<48;i++)step(s);};

it('Nation is offered once a rival demand is answered; a path must be chosen',()=>{
 const s=ready();expect(canStartNation(s)).toBe(true);expect(canAdvance(s)).toBe(true);
 expect(dispatch(s,{type:'startNation',path:'empire' as never}).ok).toBe(false);
 const cash=s.cash;expect(dispatch(s,{type:'startNation',path:'army'}).ok).toBe(true);
 expect(nationActive(s)).toBe(true);expect(s.stageId).toBe('nation');expect(s.cash).toBe(cash);
});

it('Soldiers are local adults on paid civic jobs, and they eat grain every day',()=>{
 const s=ready();const wheat=s.regions.heartland.inventory.wheat;army(s);
 expect(soldiers(s)).toBe(20);expect(townOf(s).publicJobs).toBeGreaterThanOrEqual(20);
 expect(s.regions.heartland.inventory.wheat).toBeLessThan(wheat);expect(nationOf(s).supply).toBe(1);
 s.regions.heartland.inventory.wheat=0;s.regions.heartland.inventory.corn=0;s.regions.heartland.inventory.bread=0;
 s.tick=(Math.floor(s.tick/24)+1)*24;nationDaily(s);expect(nationOf(s).supply).toBeLessThan(1);
});

it('Odds rise with drills and fall against stronger defenders and sieges',()=>{
 const s=ready();army(s);
 const raid=campaignOdds(s,'river','raid');expect(campaignOdds(s,'river','siege')).toBeLessThan(raid);
 expect(campaignOdds(s,'arid','raid')).toBeLessThan(raid);expect(DEFENCE.arid).toBeGreaterThan(DEFENCE.river);
 const before=armyStrength(s);nationOf(s).drill=2;expect(armyStrength(s)).toBeGreaterThan(before);
});

it('A campaign resolves with real casualties, cash conserved, caravans halted and neighbours wary',()=>{
 for(const seed of [1,2,3,4,5,6]){
  const s=ready();s.rng=seed*7919;army(s);
  const r=regionOf(s);r.neighbours.river.route={good:'wheat',qty:50};
  const adults=workingAdults(s),others=r.neighbours.coastal.trust,cash=s.cash,f0=flows(s);
  expect(dispatch(s,{type:'launchCampaign',target:'river',stance:'raid'}).ok).toBe(true);
  expect(dispatch(s,{type:'launchCampaign',target:'arid',stance:'raid'}).ok).toBe(false);
  for(let i=0;i<24*8;i++)step(s);
  const v=nationOf(s);expect(v.campaign).toBeNull();expect(v.history).toHaveLength(1);
  expect(workingAdults(s)).toBeLessThan(adults);expect(v.casualties).toBe(adults-workingAdults(s));
  expect(r.neighbours.coastal.trust).toBeLessThan(others);
  expect(s.cash-cash).toBeCloseTo(flows(s)-f0,1);
  const h=v.history[0];if(h.won)expect(h.spoils).toBeCloseTo(plunder(s,'river'),0);else expect(h.spoils).toBeLessThan(0);
  expect(population(s)).toBeGreaterThan(0);
 }
});

it('A won siege makes the neighbour a tribute-paying vassal; state survives a save and corrupt saves are rejected',()=>{
 const s=ready();army(s);const v=nationOf(s);v.drill=3;
 expect(dispatch(s,{type:'launchCampaign',target:'river',stance:'siege'}).ok).toBe(true);
 v.campaign!.ends=s.tick;s.rng=1;let tries=0;
 while(!v.vassal&&tries++<40){const t=structuredClone(s);t.rng=tries*104729;t.tick=(Math.floor(t.tick/24)+1)*24;nationDaily(t);if(nationOf(t).vassal){Object.assign(s,t);break;}}
 const w=nationOf(s);expect(w.vassal?.from).toBe('river');expect(regionOf(s).neighbours.river.treaty).toBe(true);
 const cash=s.cash;s.tick=(Math.floor(s.tick/24)+1)*24;nationDaily(s);expect(s.cash).toBeGreaterThan(cash);
 expect(dispatch(s,{type:'launchCampaign',target:'river',stance:'raid'}).ok).toBe(false);
 const loaded=parseSave(JSON.stringify({game:s})).game;expect(nationOf(loaded)).toEqual(nationOf(s));
 const bad=JSON.parse(JSON.stringify({game:s}));bad.game.stageState.nation.drill=9;expect(()=>parseSave(JSON.stringify(bad))).toThrow();
});

it('Old saves without nation state load inactive',()=>{
 const s=ready(),raw=JSON.parse(JSON.stringify(s));delete raw.stageState.nation;raw.version=11;
 const g=parseSave(JSON.stringify({game:raw})).game;expect(nationActive(g)).toBe(false);expect(g.cash).toBe(s.cash);
});

import {allyCharterCost,pathGuard,closedTo} from '../simulation/stages/nation';
import {raidRisk} from '../simulation/stages/region';
const nextDay=(s:ReturnType<typeof createGame>)=>{s.tick=(Math.floor(s.tick/24)+1)*24;nationDaily(s);};

it('Alliance: invites need trust and cost cash; members guard the roads; aid requests have real costs both ways',()=>{
 const s=ready();expect(dispatch(s,{type:'startNation',path:'alliance'}).ok).toBe(true);
 const r=regionOf(s),L=nationOf(s).league;
 expect(dispatch(s,{type:'buildService',service:'barracks',district:'farmgate'}).ok).toBe(false);
 expect(dispatch(s,{type:'launchCampaign',target:'river',stance:'raid'}).ok).toBe(false);
 r.neighbours.river.trust=50;expect(dispatch(s,{type:'inviteAlly',to:'river'}).ok).toBe(false);
 r.neighbours.river.trust=70;const cash=s.cash,risk=raidRisk(s);
 expect(dispatch(s,{type:'inviteAlly',to:'river'}).ok).toBe(true);expect(cash-s.cash).toBeCloseTo(allyCharterCost(s),2);
 expect(L.members).toEqual(['river']);expect(r.neighbours.river.treaty).toBe(true);expect(pathGuard(s)).toBeGreaterThan(0);expect(raidRisk(s)).toBeLessThan(risk);
 L.nextRequestDay=0;nextDay(s);expect(L.request?.from).toBe('river');
 L.request={from:'river',kind:'grain',amount:500,deadline:s.tick+240};
 const wheat=s.regions.heartland.inventory.wheat,trust=r.neighbours.river.trust;
 expect(dispatch(s,{type:'answerAid',send:true}).ok).toBe(true);
 expect(s.regions.heartland.inventory.wheat).toBe(wheat-500);expect(r.neighbours.river.trust).toBe(trust+10);expect(L.aid).toBeGreaterThan(0);
 L.request={from:'river',kind:'grain',amount:1e9,deadline:s.tick+240};const w2=s.regions.heartland.inventory.wheat;
 expect(dispatch(s,{type:'answerAid',send:true}).ok).toBe(false);expect(s.regions.heartland.inventory.wheat).toBe(w2); // nothing taken on failure
 L.cohesion=.2;L.request=null;nextDay(s);expect(L.members).toEqual([]);
});

it('Alliance: a passed sanction closes caravans to the target',()=>{
 const s=ready();dispatch(s,{type:'startNation',path:'alliance'});const r=regionOf(s),L=nationOf(s).league;
 L.members=['river','coastal'];L.vote={target:'arid',deadline:s.tick+100};
 expect(dispatch(s,{type:'castVote',yes:true}).ok).toBe(true);expect(closedTo(s,'arid')).toBe(true);
 r.neighbours.arid.route={good:'wheat',qty:10};nextDay(s);
 expect(s.shipments.some(x=>x.to==='arid')).toBe(false);
});

it('Neutrality: feeding neighbours protects the roads; embargo makes a dependent neighbour concede; spies and mercenaries cost money',()=>{
 const s=ready();dispatch(s,{type:'startNation',path:'neutrality'});const r=regionOf(s),N=nationOf(s).neutral;
 const g0=pathGuard(s);r.neighbours.river.route={good:'wheat',qty:10};r.neighbours.coastal.route={good:'wheat',qty:10};expect(pathGuard(s)).toBeGreaterThan(g0);
 r.neighbours.arid.delivered=1000;r.bandits=.6;r.demand={from:'arid',amount:1,opened:s.tick,deadline:s.tick+9999};
 expect(dispatch(s,{type:'setEmbargo',target:'arid'}).ok).toBe(true);expect(closedTo(s,'arid')).toBe(true);
 for(let d=0;d<21;d++)nextDay(s);
 expect(N.embargo).toBeNull();expect(r.demand).toBeNull();expect(r.bandits).toBeLessThan(.6);
 const tc=townOf(s).cash;expect(dispatch(s,{type:'hireSpies'}).ok).toBe(true);expect(townOf(s).cash).toBeLessThan(tc);
 const c=s.cash,g1=pathGuard(s);expect(dispatch(s,{type:'hireMercenaries'}).ok).toBe(true);expect(s.cash).toBeLessThan(c);expect(pathGuard(s)).toBeCloseTo(g1+.3);
 N.dispute={a:'river',b:'tropics',deadline:s.tick+100};const t0=r.neighbours.tropics.trust;
 expect(dispatch(s,{type:'mediate'}).ok).toBe(true);expect(r.neighbours.tropics.trust).toBe(Math.min(100,t0+10));expect(N.mediated).toBe(1);
 const loaded=parseSave(JSON.stringify({game:s})).game;expect(nationOf(loaded)).toEqual(nationOf(s));
});
