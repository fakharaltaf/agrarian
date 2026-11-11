import {expect,it} from 'vitest';
import {createGame,dispatch,step} from '../simulation/engine';
import {communityOf} from '../simulation/community-state';
import {post} from '../simulation/core';
import {townOf} from '../simulation/town-state';
import {cityOf} from '../simulation/city-state';
import {regionOf,regionActive,NEIGHBOURS} from '../simulation/region-state';
import {canStartRegion,regionDaily,raidRisk,protection,giftValue,treatyCost,TREATY_TRUST} from '../simulation/stages/region';
import {shipQuote} from '../simulation/logistics';
import {parseSave} from '../simulation/persistence';
import {canAdvance} from '../simulation/progression';

function ready(){
 const s=createGame(1801);s.legacyProgression=true;s.era=8;s.stageId='city';
 post(s,'sharesIssued',5e6,'Region test stake');
 const c=communityOf(s);c.active=true;c.charter='free';c.cohorts=[{id:999,name:'Families',households:300,adults:700,children:600}];c.homes=[{id:998,tier:'cottage',count:330,cost:990000}];c.fed=1;c.happiness=.9;
 const t=townOf(s);t.active=true;t.charter='public';t.education=.8;t.health=.9;t.roads=1;
 expect(dispatch(s,{type:'fundTown',amount:1e6,direction:'toTown'}).ok).toBe(true);
 const v=cityOf(s);v.active=true;v.charter='watch';v.threatAt=0;
 s.regions.heartland.inventory.flour=5000;s.regions.heartland.inventory.wheat=5000;
 s.tick=24*10;return s;
}
const flows=(s:ReturnType<typeof createGame>)=>Object.entries(s.lifetime).reduce((n,[k,v])=>n+(k==='depreciation'?0:v??0),0);

it('Region is offered after City caravans arrive and keeps the earlier chapters running',()=>{
 const s=ready();
 expect(canStartRegion(s)).toBe(true);expect(canAdvance(s)).toBe(true);
 expect(dispatch(s,{type:'advanceEra'}).ok).toBe(false); // charter is chosen on the Region map
 const cash=s.cash;
 expect(dispatch(s,{type:'startRegion',border:'open'}).ok).toBe(true);
 expect(regionActive(s)).toBe(true);expect(s.stageId).toBe('region');expect(s.cash).toBe(cash);expect(cityOf(s).active).toBe(true);
 expect(dispatch(s,{type:'startRegion',border:'walls'}).ok).toBe(false);
});

it('A caravan is a real sale: goods leave, freight is paid, revenue and trust arrive, books balance',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'open'});
 const v=regionOf(s);v.bandits=0;cityOf(s).police=1; // no raids for this test
 expect(dispatch(s,{type:'setRoute',to:'river',good:'flour',qty:200}).ok).toBe(true);
 const flour=s.regions.heartland.inventory.flour,trust=v.neighbours.river.trust,cash=s.cash,f0=flows(s);
 for(let i=0;i<24*6;i++)step(s);
 expect(s.regions.heartland.inventory.flour).toBeLessThan(flour);
 expect(v.caravans).toBeGreaterThan(0);
 expect(v.neighbours.river.delivered).toBeGreaterThan(0);
 expect(v.neighbours.river.trust).toBeGreaterThan(trust);
 expect((s.lifetime.shipping??0)).toBeLessThan(0);
 expect(s.cash-cash).toBeCloseTo(flows(s)-f0,1);
 expect(s.regions.river.inventory.flour).toBe(0); // nothing stored in a region you hold no land in
});

it('Raids remove real goods; pursuit costs the treasury and recovers part; walls and police lower the risk',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'open'});
 const v=regionOf(s);
 const risky=raidRisk(s);cityOf(s).police=1;expect(raidRisk(s)).toBeLessThan(risky);expect(protection(s)).toBeCloseTo(.35);
 cityOf(s).police=0;v.bandits=1;
 s.shipments.push({id:9001,good:'flour',qty:1000,from:'heartland',to:'river',arrives:s.tick+999,cost:0,sell:true,caravan:true});
 for(let d=0;d<60&&!v.raid;d++){s.tick=(Math.floor(s.tick/24)+1)*24;regionDaily(s);}
 expect(v.raid).not.toBeNull();
 s.regions.heartland.inventory.flour=0;s.regions.heartland.inventory.wheat=0; // room in the barn for recovered goods
 const lost=v.raid!.lost,flour=s.regions.heartland.inventory.flour,treasury=townOf(s).cash;
 expect(s.shipments.find(x=>x.id===9001)!.qty).toBeLessThan(1000);
 expect(dispatch(s,{type:'resolveRaid',answer:'pursue'}).ok).toBe(true);
 expect(townOf(s).cash).toBeLessThan(treasury);
 const back=s.regions.heartland.inventory.flour-flour;expect(back).toBeGreaterThan(0);expect(back).toBeLessThan(lost);
 expect(v.raid).toBeNull();
 const open=raidRisk(s);v.border='walls';expect(raidRisk(s)).toBeLessThan(open);
});

it('Gifts and treaties have real costs and limits; a treaty waives the tariff',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'open'});const v=regionOf(s);
 const flour=s.regions.heartland.inventory.flour,t0=v.neighbours.river.trust;
 expect(dispatch(s,{type:'giftNeighbour',to:'river',kind:'goods'}).ok).toBe(true);
 expect(s.regions.heartland.inventory.flour).toBeLessThan(flour);expect(v.neighbours.river.trust).toBe(t0+8);
 expect(dispatch(s,{type:'giftNeighbour',to:'river',kind:'cash'}).ok).toBe(false); // once a week
 const cash=s.cash;expect(dispatch(s,{type:'giftNeighbour',to:'arid',kind:'cash'}).ok).toBe(true);expect(cash-s.cash).toBeCloseTo(giftValue(s),2);
 v.neighbours.tropics.trust=TREATY_TRUST-1;expect(dispatch(s,{type:'signTreaty',to:'tropics'}).ok).toBe(false);
 v.neighbours.tropics.trust=TREATY_TRUST;const before=shipQuote(s,'wheat',100,'heartland','tropics').tariff,c2=s.cash;
 expect(dispatch(s,{type:'signTreaty',to:'tropics'}).ok).toBe(true);expect(c2-s.cash).toBeCloseTo(treatyCost(s),2);
 expect(before).toBeGreaterThan(0);expect(shipQuote(s,'wheat',100,'heartland','tropics').tariff).toBe(0);
});

it('A rival demands tribute after raids; paying costs cash, refusing raises raid risk; both persist through a save',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'walls'});const v=regionOf(s);
 v.raids=1;s.tick+=61*24;s.tick=Math.floor(s.tick/24)*24;regionDaily(s);
 expect(v.demand).not.toBeNull();
 const from=v.demand!.from;expect(Object.values(v.neighbours).every(n=>n.trust>=v.neighbours[from].trust)).toBe(true);
 const loaded=parseSave(JSON.stringify({game:s})).game;expect(regionOf(loaded)).toEqual(v);
 const risk=raidRisk(s);expect(dispatch(s,{type:'answerDemand',answer:'refuse'}).ok).toBe(true);expect(raidRisk(s)).toBeGreaterThan(risk);
 expect(v.answered).toBe('refused');expect(NEIGHBOURS[from].leader).toBeTruthy();
 const bad=JSON.parse(JSON.stringify({game:s}));bad.game.stageState.region.neighbours.river.trust=500;
 expect(()=>parseSave(JSON.stringify(bad))).toThrow();
});

it('Watchtowers are staffed civic jobs funded by the treasury and add protection; walls charge tolls into the public purse',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'walls'});
 expect(dispatch(s,{type:'buildService',service:'watchtower',district:'farmgate'}).ok).toBe(true);
 const p0=protection(s);for(let i=0;i<48;i++)step(s);
 expect(protection(s)).toBeGreaterThan(p0);
 expect(townOf(s).lifetime.tolls??0).toBeGreaterThan(0);
});

