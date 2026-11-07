import {expect,it} from 'vitest';
import {createGame,dispatch} from '../simulation/engine';
import {post,stored} from '../simulation/core';
import {quoteBuy} from '../simulation/markets';
import {rulesTick,policiesTick} from '../simulation/automation';
import {fertilizeField,spreadingCost,spreadNeed} from '../simulation/agriculture';
function ready(){const s=createGame(2010);s.legacyProgression=true;s.era=8;s.research.done.push('farmSoftware');post(s,'sharesIssued',1e6,'Budget regression capital');return s;}
function budget(s:ReturnType<typeof ready>,amount:number){post(s,'dividends',amount-s.cash,'Set exact purchase budget');}
it('Manual purchases use the real executable quote: exact cash works and no hidden20%buffer is needed',()=>{
 const s=ready(),q=quoteBuy(s,'heartland','fertilizer',1);budget(s,q.net);
 expect(s.cash).toBeLessThan(s.markets.heartland.fertilizer!.price*1.2);
 expect(dispatch(s,{type:'buy',region:'heartland',good:'fertilizer',qty:1}).ok).toBe(true);
 expect(s.cash).toBe(0);expect(s.regions.heartland.inventory.fertilizer).toBe(1);
});
it('Orders whose true cost exceeds cash are rejected atomically even when the old headroom estimate would pass',()=>{
 const s=ready(),qty=400,q=quoteBuy(s,'heartland','flour',qty),old=s.markets.heartland.flour!.price*qty*1.2;
 expect(q.net).toBeGreaterThan(old);budget(s,Math.round((old+.01)*100)/100);
 const before=JSON.stringify(s);expect(dispatch(s,{type:'buy',region:'heartland',good:'flour',qty}).ok).toBe(false);
 expect(JSON.stringify(s)).toBe(before);
});
it('Huge automation orders respect the actual fill size, spending cap, reserve and storage',()=>{
 const s=ready();s.automation.policies.cashReserve=999900;
 expect(dispatch(s,{type:'addRule',rule:{name:'Budgeted input',enabled:true,metric:'cash',region:'heartland',good:'wheat',op:'>',value:0,action:'buy',actionGood:'fertilizer',actionRegion:'heartland',amountPct:1e9,priority:1,maxSpend:25,cooldown:1}}).ok).toBe(true);
 const cash=s.cash;rulesTick(s);expect(cash-s.cash).toBeGreaterThan(0);expect(cash-s.cash).toBeLessThanOrEqual(25);expect(s.cash).toBeGreaterThanOrEqual(999900);
 expect(stored(s,'heartland').dry).toBeLessThanOrEqual(stored(s,'heartland').cap.dry);
 const full=ready();full.regions.heartland.inventory.wheat=400;
 expect(dispatch(full,{type:'addRule',rule:{...s.automation.rules[0],name:'Full barn',maxSpend:0}}).ok).toBe(true);
 const before=full.cash;rulesTick(full);expect(full.cash).toBe(before);expect(full.regions.heartland.inventory.fertilizer).toBe(0);
});
it('Contractor application is quoted and cannot spend unavailable cash or consume inputs on failure',()=>{
 const s=ready(),f=s.fields[0];s.regions.heartland.inventory.fertilizer=20;budget(s,spreadingCost(s,f)-.01);
 const before=JSON.stringify(s);expect(fertilizeField(s,f,'fertilizer')).toMatch(/contractor costs/);expect(JSON.stringify(s)).toBe(before);
 post(s,'sharesIssued',1000,'Hire real field crew');expect(dispatch(s,{type:'hire',region:'heartland',role:'hand',wageFactor:1}).ok).toBe(true);budget(s,0);
 expect(spreadingCost(s,f)).toBe(0);expect(fertilizeField(s,f,'fertilizer')).toBeNull();expect(f.spreading).toBe('fertilizer');expect(s.cash).toBe(0);
});
it('Manager input purchases cannot overflow storage; precision doses use the shared physical requirement',()=>{
 const s=ready(),f=s.fields[0];f.ha=50;f.soil={n:.1,p:.1,k:.1,organic:.8};
 expect(dispatch(s,{type:'hire',region:'heartland',role:'manager',wageFactor:1}).ok).toBe(true);
 s.automation.policies.autoFertilize=true;s.tick=12;policiesTick(s);
 expect(stored(s,'heartland').dry).toBeLessThanOrEqual(stored(s,'heartland').cap.dry);
 expect(s.regions.heartland.inventory.fertilizer).toBe(400);expect(f.soil.n).toBe(.1);
 expect(s.log.some(e=>e.text.includes('Free space or expand storage'))).toBe(true);
 s.research.done.push('precisionFert');expect(spreadNeed(s,f,'fertilizer')).toBe(700);
 expect(dispatch(s,{type:'build',region:'heartland',building:'barn'}).ok).toBe(true);s.tick=36;policiesTick(s);
 expect(f.soil.n).toBeGreaterThan(.1);expect(s.regions.heartland.inventory.fertilizer).toBeLessThan(1);
});
it('One fertilising rule shares its spending limit across all contractor jobs',()=>{
 const s=ready();expect(dispatch(s,{type:'buyPlot'}).ok).toBe(true);for(const f of s.fields)f.soil={n:.1,p:.1,k:.1,organic:.8};s.regions.heartland.inventory.fertilizer=40;
 expect(dispatch(s,{type:'addRule',rule:{name:'One contractor budget',enabled:true,metric:'cash',region:'heartland',good:'wheat',op:'>',value:0,action:'fertilizeLow',actionGood:'fertilizer',actionRegion:'heartland',amountPct:100,priority:1,maxSpend:4,cooldown:1}}).ok).toBe(true);
 const cash=s.cash;rulesTick(s);expect(cash-s.cash).toBe(4);expect(s.fields.filter(f=>f.soil.n>.1)).toHaveLength(1);expect(s.regions.heartland.inventory.fertilizer).toBe(20);
});
it('Shipment rules preserve the same factory reserves as automatic sale rules',()=>{
 const s=ready();expect(dispatch(s,{type:'unlockRegion',region:'river'}).ok).toBe(true);
 expect(dispatch(s,{type:'build',region:'heartland',building:'flourMill'}).ok).toBe(true);
 s.buildings.find(b=>b.type==='flourMill')!.reserved=100;s.regions.heartland.inventory.wheat=150;
 expect(dispatch(s,{type:'addRule',rule:{name:'Ship only surplus',enabled:true,metric:'cash',region:'heartland',good:'wheat',op:'>',value:0,action:'ship',actionGood:'wheat',actionRegion:'river',amountPct:100,priority:1,maxSpend:10000,cooldown:1}}).ok).toBe(true);
 rulesTick(s);expect(s.regions.heartland.inventory.wheat).toBe(100);expect(s.shipments[0].qty).toBe(50);expect(s.buildings.find(b=>b.type==='flourMill')!.reserved).toBe(100);
});
