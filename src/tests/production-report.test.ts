import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { productionReport, productionPriceRails, recordProductionHour, cowshedAlternative } from '../simulation/production-report';
import { executeSell, quoteSell } from '../simulation/markets';
import { parseSave } from '../simulation/persistence';
function fixture() {
  const s=createGame(1901);s.legacyProgression=true;s.era=8;
  post(s,'sharesIssued',1e6,'Reporting fixture capital');
  expect(dispatch(s,{type:'build',region:'heartland',building:'flourMill'}).ok).toBe(true);
  return s;
}
it('Records completed operating days without inventing history or posting money',()=>{
  const s=fixture(),b=s.buildings[0],cash=s.cash,lifetime=structuredClone(s.lifetime);
  expect(productionReport([b]).days).toBe(0);
  for(let tick=0;tick<=24;tick++){s.tick=tick;recordProductionHour(s,b,2,100,40,20,5);}
  const r=productionReport([b]);expect(r.days).toBe(1);expect(r.earn).toBe(2400);expect(r.worth).toBe(24*35);expect(r.tone).toBe('neutral');
  const before=JSON.stringify(b.productionReport);recordProductionHour(s,b,2,100,40,20,5);expect(JSON.stringify(b.productionReport)).toBe(before);
  expect(s.cash).toBe(cash);expect(s.lifetime).toEqual(lifetime);
  for(let tick=25;tick<=24*10;tick++){s.tick=tick;recordProductionHour(s,b,2,100,40,20,5);}
  expect(b.productionReport.days).toHaveLength(7);expect(productionReport([b]).days).toBe(7);expect(productionReport([b]).tone).toBe('up');
});
it('Partial starting days are excluded, and colours/rails remain unchanged during an open day',()=>{
  const s=fixture(),b=s.buildings[0];
  for(let tick=12;tick<=24*5;tick++){s.tick=tick;recordProductionHour(s,b,2,100,40,20,5);}
  const before=productionReport([b]),rails=productionPriceRails(b.type,before);
  expect(before.days).toBe(4);expect(rails.map(x=>x.good)).toEqual(['flour','wheat']);
  for(const rail of rails)if(rail.need!==null)expect(before.worth+(rail.need-rail.now)*(before.qty[rail.good]??0)).toBeCloseTo(0,6);
  for(let tick=121;tick<144;tick++){s.tick=tick;recordProductionHour(s,b,0,0,100000,100000,5);expect(productionReport([b])).toEqual(before);}
});
it('Dairy alternative uses the same real cowshed yield and feed, so feed does not change incremental value',()=>{
  const s=fixture();expect(dispatch(s,{type:'build',region:'heartland',building:'dairy'}).ok).toBe(true);
  const dairy=s.buildings.find(b=>b.type==='dairy')!;
  const alt=cowshedAlternative(s,'heartland',30);
  for(let tick=0;tick<=24;tick++){s.tick=tick;recordProductionHour(s,dairy,1,100,30,20,5);}
  const r=productionReport([dairy]);expect(r.alt).toBeCloseTo(alt.value,6);expect(r.qty.feed).toBeCloseTo(0,6);expect(productionPriceRails('dairy',r).find(x=>x.good==='feed')!.need).toBeNull();
});
it('Retail reporting attributes the existing premium once to the supplying centre',()=>{
  const s=fixture();expect(dispatch(s,{type:'build',region:'heartland',building:'distribution',count:2}).ok).toBe(true);
  s.regions.heartland.inventory.flour=100;
  const centres=s.buildings.filter(b=>b.type==='distribution'),q=quoteSell(s,'heartland','flour',100),cash=s.cash;
  executeSell(s,'heartland','flour',100);
  expect(s.cash-cash).toBeCloseTo(q.net,2);
  expect(centres.reduce((n,b)=>n+(b.productionReport.open?.earn??0),0)).toBe(q.retailValue);
  expect(centres[0].productionReport.open!.earn).toBeGreaterThan(0);expect(centres[1].productionReport.open?.earn??0).toBe(0);
});
it('Version8 gains empty reports; saved reporting continues exactly through JSON',()=>{
  const s=fixture(),raw=JSON.parse(JSON.stringify(s));raw.version=8;for(const b of raw.buildings)delete b.productionReport;
  const migrated=parseSave(JSON.stringify({game:raw})).game;
  expect(productionReport(migrated.buildings).days).toBe(0);expect(migrated.cash).toBe(s.cash);
  for(let i=0;i<96;i++)step(migrated);
  const restored=parseSave(JSON.stringify({game:migrated})).game;
  for(let i=0;i<72;i++){step(migrated);step(restored);}
  expect(restored).toEqual(migrated);
});
it('Solar reports only avoided purchases and actual half-price exports, not a fictitious full-price sale',async()=>{
  const {buildingsTick}=await import('../simulation/processing');
  const s=fixture();s.research.done.push('solar');
  expect(dispatch(s,{type:'build',region:'heartland',building:'solar'}).ok).toBe(true);
  const solar=s.buildings.find(b=>b.type==='solar')!,cash=s.cash;
  s.tick=12;buildingsTick(s);
  expect(solar.productionReport.open!.earn).toBeCloseTo(s.lifetime.grid??0,2);
  expect(solar.productionReport.open!.staff).toBeGreaterThan(0);
  expect(s.cash).not.toBe(cash);
});

it('Rejects corrupt imported report rows before they can crash the production view',()=>{
  const s=fixture();s.tick=24;recordProductionHour(s,s.buildings[0],1,100,20,5,1);
  for(const corrupt of ['array','quantity','hours']) {
    const raw=JSON.parse(JSON.stringify(s));
    if(corrupt==='array')raw.buildings[0].productionReport.days='not an array';
    if(corrupt==='quantity')raw.buildings[0].productionReport.open.qty.wheat='not a number';
    if(corrupt==='hours')raw.buildings[0].productionReport.open.hours=25;
    expect(()=>parseSave(JSON.stringify({game:raw}))).toThrow('production history is corrupt');
  }
});
