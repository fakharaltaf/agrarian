import {expect,it} from 'vitest';
import {createGame,dispatch,step} from '../simulation/engine';
import {communityOf} from '../simulation/community-state';
import {post} from '../simulation/core';
import {townOf} from '../simulation/town-state';
import {cityOf} from '../simulation/city-state';
import {regionOf,regionActive,NEIGHBOURS} from '../simulation/region-state';
import {canStartRegion,regionDaily,raidRisk,protection,giftValue,treatyCost,TREATY_TRUST,staffedTowers} from '../simulation/stages/region';
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

it('Raids remove real goods; pursuit costs the farm and recovers part; walls and police lower the risk',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'open'});
 const v=regionOf(s);
 const risky=raidRisk(s);cityOf(s).police=1;expect(raidRisk(s)).toBeLessThan(risky);expect(protection(s)).toBeCloseTo(.35);
 cityOf(s).police=0;v.bandits=1;
 s.shipments.push({id:9001,good:'flour',qty:1000,from:'heartland',to:'river',arrives:s.tick+999,cost:0,sell:true,caravan:true});
 for(let d=0;d<60&&!v.raid;d++){s.tick=(Math.floor(s.tick/24)+1)*24;regionDaily(s);}
 expect(v.raid).not.toBeNull();
 s.regions.heartland.inventory.flour=0;s.regions.heartland.inventory.wheat=0; // room in the barn for recovered goods
 const lost=v.raid!.lost,flour=s.regions.heartland.inventory.flour,cash=s.cash;
 expect(s.shipments.find(x=>x.id===9001)!.qty).toBeLessThan(1000);
 expect(dispatch(s,{type:'resolveRaid',answer:'pursue'}).ok).toBe(true);
 expect(s.cash).toBeLessThan(cash);
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

it('Watchtowers are staffed civic jobs paid by the farm; walls charge tolls, paid to the farm',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'walls'});
 expect(dispatch(s,{type:'buildService',service:'watchtower',district:'farmgate'}).ok).toBe(true);
 for(let i=0;i<48;i++)step(s);
 expect(staffedTowers(s)).toBeGreaterThan(0);
 expect(s.lifetime.tolls??0).toBeGreaterThan(0);
});


it('A watchtower guards the side it stands on; a militia hall escorts every route',async()=>{
 const W=await import('../simulation/world');
 const s=ready();dispatch(s,{type:'startRegion',border:'open'});cityOf(s).police=0;
 const w=W.worldOf(s,'heartland'),home=w.pos.farmhouse!,t=townOf(s);
 const before={arid:protection(s,'arid'),coastal:protection(s,'coastal')};
 t.services.push({id:7001,type:'watchtower',district:'farmgate',count:1,active:true,cost:0,staffed:5,funded:true});w.pos['svc:7001']=[home[0]-12,W.ROAD_Y+3];
 expect(protection(s,'arid')).toBeGreaterThan(before.arid); // west road: Arid
 expect(protection(s,'coastal')).toBe(before.coastal); // not the east road
 expect(raidRisk(s,'arid')).toBeLessThan(raidRisk(s,'coastal'));
 t.services.push({id:7002,type:'militia',district:'farmgate',count:1,active:true,cost:0,staffed:8,funded:true});
 expect(protection(s,'coastal')).toBeCloseTo(before.coastal+.1,5); // a level-1 hall, fully staffed
});

it('A neighbour order pays a bonus and trust when filled by caravan, and costs trust when missed',()=>{
 const s=ready();dispatch(s,{type:'startRegion',border:'open'});const v=regionOf(s);v.bandits=0;cityOf(s).police=1;
 const n=v.neighbours.river;n.request={good:'flour',qty:100,done:0,deadline:s.tick+15*24,bonus:500};
 expect(dispatch(s,{type:'setRoute',to:'river',good:'flour',qty:500}).ok).toBe(true);
 const t0=n.trust,cash=s.cash;let fromBonus=0;
 for(let i=0;i<24*6&&n.request;i++){step(s);}
 expect(n.request).toBeNull();expect(v.filled).toBe(1);fromBonus=s.ledger.filter(e=>e.memo.startsWith(`${NEIGHBOURS.river.leader}'s order`)).reduce((a,e)=>a+e.amount,0);
 expect(fromBonus).toBe(500);expect(n.trust).toBeGreaterThan(t0+9);expect(s.cash).toBeGreaterThan(cash-1e6);
 const a=v.neighbours.arid;a.request={good:'bread',qty:1e6,done:0,deadline:s.tick+24,bonus:1};const ta=a.trust;
 for(let i=0;i<48;i++)step(s);
 expect(a.request).toBeNull();expect(v.missed).toBe(1);expect(a.trust).toBeLessThan(ta);
});
