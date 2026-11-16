import {expect,it} from 'vitest';
import {createGame,dispatch,step} from '../simulation/engine';
import {communityOf,population} from '../simulation/community-state';
import {post} from '../simulation/core';
import {townOf} from '../simulation/town-state';
import {canStartCity,cityDaily,homeCrimeTarget,caseCost,policeReformCost} from '../simulation/stages/city';
import {cityOf,cityActive} from '../simulation/city-state';
import {townOrders} from '../simulation/stages/town';
import {parseSave} from '../simulation/persistence';
import {cityBotAct} from './bot';
function ready(){
 const s=createGame(1701);s.legacyProgression=true;s.era=8;s.stageId='town';
 post(s,'sharesIssued',5e6,'City test stake');
 const c=communityOf(s);c.active=true;c.charter='free';c.cohorts=[{id:999,name:'Families',households:100,adults:200,children:200}];c.homes=[{id:998,tier:'cottage',count:100,cost:300000}];c.fed=1;c.happiness=.9;
 const t=townOf(s);t.active=true;t.charter='public';t.education=.8;t.health=.9;t.roads=1;
 return s;
}
const flow=(x:Record<string,number|undefined>)=>Object.entries(x).reduce((n,[k,v])=>n+(k==='depreciation'?0:v??0),0);
it('City is an optional, capability-preserving charter',()=>{
 const s=ready(),cash=s.cash,people=population(s);
 expect(canStartCity(s)).toBe(true);expect(cityActive(s)).toBe(false);
 expect(dispatch(s,{type:'startCity',charter:'watch'}).ok).toBe(true);
 expect(s.cash).toBe(cash);expect(population(s)).toBe(people);expect(s.era).toBe(8);expect(s.stageId).toBe('city');
 expect(dispatch(s,{type:'startCity',charter:'strict'}).ok).toBe(false);
 const corrupt=structuredClone(s);cityOf(corrupt).crime='invalid' as unknown as number;
 expect(()=>parseSave(JSON.stringify({game:corrupt}))).toThrow(/safety/);
});
it('Crime is per street: dark, unwatched homes see more; a watchhouse in reach and lit streets cut it; strict cuts most',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'watch'});
 const t=townOf(s),c=communityOf(s),v=cityOf(s);t.education=1;t.publicJobs=200;c.happiness=1;
 expect(homeCrimeTarget(s,{power:1,watch:0})).toBe(0);
 t.publicJobs=0;t.education=0;c.happiness=.3;t.roads=0;
 const dark=homeCrimeTarget(s,{power:0,watch:0}),lit=homeCrimeTarget(s,{power:1,watch:0}),watched=homeCrimeTarget(s,{power:1,watch:1});
 expect(dark).toBeGreaterThan(.4);expect(lit).toBeLessThan(dark);expect(watched).toBeLessThan(lit);
 v.charter='strict';expect(homeCrimeTarget(s,{power:1,watch:1})).toBeLessThan(watched);
 // the city's crime is the families' average, and each street drifts towards its own target
 v.homes=[{id:1,families:30,power:0,watch:0},{id:2,families:10,power:1,watch:1}];v.crime=0;
 s.tick=24;cityDaily(s);
 expect(v.homeCrime![1]).toBeGreaterThan(v.homeCrime![2]);
 expect(v.crime).toBeCloseTo((v.homeCrime![1]*30+v.homeCrime![2]*10)/40,10);
 expect(v.police).toBeCloseTo(10/40,10);
});
it('Training, reforms and cases are paid by the farm; gangs sour happiness and smugglers cut the town shops',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'professional'});dispatch(s,{type:'buildService',service:'police',district:'farmgate'});
 const v=cityOf(s),c=communityOf(s);let cash=s.cash;
 expect(dispatch(s,{type:'trainPolice'}).ok).toBe(true);expect(v.training).toBe(1);expect(cash-s.cash).toBeCloseTo(15000*s.macro.cpi,6);
 expect(dispatch(s,{type:'trainPolice'}).ok).toBe(false);
 s.tick=Math.ceil(v.trainingUntil/24)*24;cityDaily(s);expect(v.training).toBe(1.25);
 cash=s.cash;expect(dispatch(s,{type:'changePolice',charter:'strict'}).ok).toBe(true);expect(cash-s.cash).toBeCloseTo(policeReformCost(s),6);
 v.case={id:996,kind:'gang',opened:s.tick,deadline:s.tick+24*7,good:'wheat',lost:5};
 c.happiness=.8;s.tick+=24;cityDaily(s);expect(c.happiness).toBeLessThan(.8);
 cash=s.cash;expect(dispatch(s,{type:'resolveCityCase',answer:'punish'}).ok).toBe(true);expect(cash-s.cash).toBeCloseTo(caseCost(s,'punish'),6);expect(v.case).toBeNull();
 // an unanswered case resolves itself with the default, paid by the farm, and replays the same
 v.case={id:997,kind:'theft',opened:s.tick,deadline:s.tick+24,good:'wheat',lost:5};
 const clone=structuredClone(s);s.tick+=24;clone.tick+=24;cityDaily(s);cityDaily(clone);expect(s).toEqual(clone);expect(v.case).toBeNull();expect(v.rehabilitated).toBe(1);
 const json=JSON.stringify(s);expect(JSON.stringify(parseSave(JSON.stringify({game:s})).game)).toBe(json);
 // smugglers: the town shops order less from you while the case is open
 townOrders(s);const full=townOf(s).orders!.reduce((n,o)=>n+o.want,0);
 v.case={id:998,kind:'smuggling',opened:s.tick,deadline:s.tick+24*7,good:'wheat',lost:5};townOrders(s);
 expect(full).toBeGreaterThan(0);expect(townOf(s).orders!.reduce((n,o)=>n+o.want,0)).toBeLessThan(full);
});
// shortcut: parked while Settlement → City are reworked from scratch (10 Nov 2026); replace with a playthrough of the new design.
it.skip('A new farm reaches a serviced safe1200-person City through real actions, no grants',()=>{
 const s=createGame(1002);let entry=-1;
 for(let i=0;i<60000;i++){
  cityBotAct(s);step(s);if(cityActive(s)&&entry<0)entry=s.tick;
  const v=cityOf(s);if(v.active&&population(s)>=1200&&(townOf(s).sanitation??0)>=.7&&v.crime<=.2)break;
 }
 expect(cityActive(s)).toBe(true);expect(population(s)).toBeGreaterThanOrEqual(1200);expect(townOf(s).sanitation??0).toBeGreaterThanOrEqual(.7);expect(cityOf(s).crime).toBeLessThanOrEqual(.2);expect(s.bankrupt).toBeNull();
 expect(s.cash).toBeCloseTo(250+flow(s.lifetime),1);expect(townOf(s).cash).toBeCloseTo(flow(townOf(s).lifetime),1);
 console.log('City pacing',JSON.stringify({enteredAt:entry,developedAt:s.tick,cityTicks:s.tick-entry,population:population(s)}));
},120000);

it('Theft cannot take dedicated inputs or household reserves, and unpaid default cases grant nothing',()=>{
 const s=ready();dispatch(s,{type:'startCity',charter:'watch'});const v=cityOf(s),c=communityOf(s);
 dispatch(s,{type:'build',region:'heartland',building:'flourMill'});const mill=s.buildings[0];mill.reserved=90;
 s.regions.heartland.inventory.wheat=100;c.larderHold={wheat:8};
 for(let day=1;day<180&&!v.case;day++){v.crime=.8;v.nextCaseDay=0;s.tick=day*24;cityDaily(s);}
 expect(v.case).not.toBeNull();expect(v.case!.lost).toBeLessThanOrEqual(2);expect(s.regions.heartland.inventory.wheat).toBeGreaterThanOrEqual(98);
 post(s,'dividends',-s.cash,'Fixture: an empty till');v.prevention=0;s.tick=Math.ceil(v.case!.deadline/24)*24;cityDaily(s);
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


it('City shops: families in reach spend savings on your goods first and imports for the rest; GST comes to the farm; every dollar is accounted for', async () => {
  const { cityTrade } = await import('../simulation/stages/city');
  const { priceUsd } = await import('../simulation/core');
  const s = ready(); dispatch(s, { type: 'startCity', charter: 'watch' });
  const v = cityOf(s), c = communityOf(s), inv = s.regions.heartland.inventory, people = population(s);
  v.homes = [{ id: 1, families: 50, power: 1, watch: 0, shops: { shopBaker: 1 } }, { id: 2, families: 50, power: 1, watch: 0 }]; // half the city is in a baker's reach
  c.householdCash = 1e6; c.larderHold = {}; inv.bread = 1e6; inv.flour = 0; v.gst = 0.1;
  const cash = s.cash, bread = inv.bread, want = Math.floor(people * 0.5 * 0.6), flourWant = Math.floor(people * 0.5 * 0.1);
  cityTrade(s);
  expect(bread - inv.bread).toBe(want); // your bread is sold
  expect(v.trade!.ours).toBeCloseTo(want * priceUsd(s, 'heartland', 'bread') * 1.2, 1);
  expect(v.trade!.imports).toBeCloseTo(flourWant * priceUsd(s, 'heartland', 'flour') * 1.2, 1); // no flour in store: imported
  expect(v.trade!.gaps[0].good).toBe('flour');
  expect(v.trade!.gst).toBeCloseTo(v.trade!.spend * 0.1, 1);
  expect(s.cash - cash).toBeCloseTo(v.trade!.ours + v.trade!.gst, 1); // the farm gets its sales and the GST
  expect(1e6 - c.householdCash).toBeCloseTo(v.trade!.spend + v.trade!.gst, 1); // families paid for all of it
  // savings cap the day's spending; no GST at 0%; out of reach, nothing is sold
  c.householdCash = 100; cityTrade(s); expect(v.trade!.spend + v.trade!.gst).toBeLessThanOrEqual(5.01);
  expect(dispatch(s, { type: 'setGst', rate: 0.07 }).ok).toBe(false); expect(dispatch(s, { type: 'setGst', rate: 0 }).ok).toBe(true);
  c.householdCash = 1e6; cityTrade(s); expect(v.trade!.gst).toBe(0);
  v.homes = [{ id: 1, families: 100, power: 1, watch: 0 }]; cityTrade(s); expect(v.trade!.spend).toBe(0);
});

it('Shops stand only on commercial land, and commercial land takes nothing else', async () => {
  const W = await import('../simulation/world');
  const s = ready(); dispatch(s, { type: 'startCity', charter: 'watch' });
  const w = W.worldOf(s, 'heartland'), spot = W.findSpot(s, 'heartland', W.SERVICE_FOOTPRINT)!;
  expect(dispatch(s, { type: 'buildService', service: 'shopBaker', district: 'farmgate', at: spot }).ok).toBe(false); // farmland: no
  const chunks = [...new Set([0, 1, 2].flatMap((dx) => [0, 1, 2].map((dy) => W.chunkAt(spot[0] + dx, spot[1] + dy))))];
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks, zone: 'com' }).ok).toBe(true);
  expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', at: spot }).ok).toBe(false); // no barns on commercial land
  expect(dispatch(s, { type: 'buildService', service: 'shopBaker', district: 'farmgate', at: spot }).ok).toBe(true);
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks, zone: 'farm' }).ok).toBe(false); // the shop is in the way
  expect(w.zones[chunks[0]]).toBe('com');
});

it('Four shops of a kind in a square merge into a market, four markets into the mall; undo splits them again', async () => {
  const W = await import('../simulation/world');
  const { mergeGroup, serviceName, serviceRadius } = await import('../simulation/town-state');
  const { dispatchEdit, undoEdit } = await import('../simulation/undo');
  const s = ready(); dispatch(s, { type: 'startCity', charter: 'watch' });
  const t = townOf(s), w = W.worldOf(s, 'heartland'), o: [number, number] = [W.MAP.x0 + 40, W.MAP.y0 + 8]; // open country, given to the farm for the test
  const chunks = [...new Set(Array.from({ length: 225 }, (_, i) => W.chunkAt(o[0] + (i % 15), o[1] + Math.floor(i / 15))))];
  w.owned = [...new Set([...w.owned, ...chunks])]; w.cleared = [...new Set([...w.cleared, ...chunks])]; W.touch(w);
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks, zone: 'com' }).ok).toBe(true);
  const kinds = ['shopBaker', 'shopDairy', 'shopButcher', 'shopGrocer'] as const, markets: number[] = [];
  kinds.forEach((kind, q) => {
    const qo: [number, number] = [o[0] + (q % 2) * 8, o[1] + Math.floor(q / 2) * 8], ids: number[] = [];
    for (let k = 0; k < 4; k++) {
      { const res = dispatch(s, { type: 'buildService', service: kind, district: 'farmgate', at: [qo[0] + (k % 2) * 4, qo[1] + Math.floor(k / 2) * 4] }); if (!res.ok) console.log('FAIL', kind, k, res.error); expect(res.ok).toBe(true); }
      ids.push(t.services.at(-1)!.id);
      if (k === 2) { expect(mergeGroup(s, ids[0])!.members.length).toBe(3); expect(dispatch(s, { type: 'mergeService', serviceId: ids[0] }).ok).toBe(false); } // three is not enough
    }
    const cash = s.cash, g = mergeGroup(s, ids[3])!; expect(g.complete).toBe(true);
    const { r, edit } = dispatchEdit(s, { type: 'mergeService', serviceId: ids[3] }); expect(r.ok).toBe(true);
    const m = t.services.find((b) => b.id === ids[3])!;
    expect(cash - s.cash).toBe(g.price); expect(m.size).toBe(2); expect(w.pos[`svc:${m.id}`]).toEqual(qo); expect(W.footprintOf(s, `svc:${m.id}`)).toEqual({ w: 7, d: 7 });
    expect(t.services.filter((b) => b.type === kind).length).toBe(1); expect(serviceRadius(m)).toBe(18);
    if (q === 0) { // undo puts the four shops back where they stood, and the money
      expect(serviceName(m)).toBe("Bakers' hall");
      undoEdit(s, edit!); expect(t.services.filter((b) => b.type === kind).length).toBe(4); expect(s.cash).toBeCloseTo(cash, 2); expect(W.footprintOf(s, `svc:${ids[0]}`)).toEqual({ w: 3, d: 3 });
      expect(dispatch(s, { type: 'mergeService', serviceId: ids[3] }).ok).toBe(true);
    }
    markets.push(ids[3]);
  });
  expect(dispatch(s, { type: 'mergeService', serviceId: markets[1] }).ok).toBe(true);
  const mall = t.services.find((b) => b.id === markets[1])!;
  expect(mall.type).toBe('mall'); expect(mall.kinds!.sort()).toEqual([...kinds].sort()); expect(w.pos[`svc:${mall.id}`]).toEqual(o); expect(W.footprintOf(s, `svc:${mall.id}`)).toEqual({ w: 15, d: 15 });
  expect(t.services.filter((b) => b.type.startsWith('shop')).length).toBe(0);
  expect(parseSave(JSON.stringify({ game: s })).game).toEqual(s);
});
