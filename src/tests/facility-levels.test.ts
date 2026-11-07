import { expect, it } from 'vitest';
import { createGame, dispatch, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { buildingsTick } from '../simulation/processing';
import { executeSell, retailPremium } from '../simulation/markets';
import { solarCapacity, retailChannel } from '../simulation/facility-levels';

function ready() {
  const s=createGame(2001);s.legacyProgression=true;s.era=8;s.research.done.push('solar');s.discovered.push('upgrades');
  post(s,'sharesIssued',1e6,'Facility regression capital');
  return s;
}
it('Paid solar upgrades increase actual grid generation at unchanged level-one rules',()=>{
  const s=ready();expect(dispatch(s,{type:'build',region:'heartland',building:'solar'}).ok).toBe(true);s.tick=12;
  const level1=structuredClone(s);buildingsTick(level1);
  expect(solarCapacity(s.buildings[0])).toBe(120);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:s.buildings[0].id}).ok).toBe(true);
  const level2=structuredClone(s);buildingsTick(level2);
  expect(solarCapacity(s.buildings[0])).toBe(216);
  expect(level2.lifetime.grid!).toBeCloseTo(level1.lifetime.grid!*1.8,2);
  expect(-level2.lifetime.staff!).toBeCloseTo(-level1.lifetime.staff!*1.3,2);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:s.buildings[0].id}).ok).toBe(true);
  const level3=structuredClone(s);buildingsTick(level3);
  expect(solarCapacity(s.buildings[0])).toBe(300);
  expect(level3.lifetime.grid!).toBeCloseTo(level1.lifetime.grid!*2.5,2);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:s.buildings[0].id}).ok).toBe(false);
});
it('Retail levels improve the real non-stacking sale channel and retain the12% base premium',()=>{
  const s=ready();expect(dispatch(s,{type:'build',region:'heartland',building:'distribution',count:2}).ok).toBe(true);
  const [first,second]=s.buildings;
  expect(retailPremium(s,'heartland','flour')).toBe(1.12);
  expect(retailPremium(s,'heartland','wheat')).toBe(1);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:second.id}).ok).toBe(true);
  expect(retailChannel(s,'heartland')).toBe(.15);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:second.id}).ok).toBe(true);
  expect(retailPremium(s,'heartland','flour')).toBe(1.18);
  s.regions.heartland.inventory.flour=100;
  const cash=s.cash;expect(executeSell(s,'heartland','flour',100).qty).toBe(100);expect(s.cash).toBeGreaterThan(cash);
  expect(second.productionReport.open!.earn).toBeGreaterThan(0);
  expect(first.productionReport.open?.earn??0).toBe(0);
  second.active=false;expect(retailChannel(s,'heartland')).toBe(.12);
});
it('Keep-best pauses redundant centres reversibly without a refund or a lost premium',()=>{
  const s=ready();expect(dispatch(s,{type:'build',region:'heartland',building:'distribution',count:3}).ok).toBe(true);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:s.buildings[1].id}).ok).toBe(true);
  const cash=s.cash,capital=s.buildings.map(b=>b.cost),premium=retailPremium(s,'heartland','bread');
  expect(dispatch(s,{type:'consolidateRetail',region:'heartland'}).ok).toBe(true);
  expect(s.cash).toBe(cash);expect(s.buildings.map(b=>b.cost)).toEqual(capital);
  expect(s.buildings.filter(b=>b.active).map(b=>b.id)).toEqual([s.buildings[1].id]);
  expect(retailPremium(s,'heartland','bread')).toBe(premium);
  const stable=JSON.stringify(s);expect(dispatch(s,{type:'consolidateRetail',region:'heartland'}).ok).toBe(false);expect(JSON.stringify(s)).toBe(stable);
  expect(dispatch(s,{type:'toggleBuilding',buildingId:s.buildings[0].id}).ok).toBe(true);
  expect(s.buildings.filter(b=>b.active)).toHaveLength(2);expect(retailPremium(s,'heartland','bread')).toBe(premium);
});
it('Specialist upgrade previews match actual extra generation/staff and do not invent retail demand',async()=>{
  const {facilityUpgrade}=await import('../simulation/lines');
  const s=ready();expect(dispatch(s,{type:'build',region:'heartland',building:'solar'}).ok).toBe(true);
  const preview=facilityUpgrade(s,s.buildings)!,before=structuredClone(s);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:s.buildings[0].id}).ok).toBe(true);
  for(let h=0;h<24;h++){s.tick=before.tick=h;buildingsTick(s);buildingsTick(before);}
  const gain=(s.lifetime.grid??0)-(before.lifetime.grid??0)+(s.lifetime.staff??0)-(before.lifetime.staff??0);
  expect(preview.conservativeGain).toBeCloseTo(gain,1);
  expect(s.ledger.find(e=>e.memo.startsWith('Upgrade'))!.division).toBe('energy');
  expect(dispatch(s,{type:'build',region:'heartland',building:'distribution',count:2}).ok).toBe(true);
  const retail=s.buildings.filter(b=>b.type==='distribution'),out=facilityUpgrade(s,retail)!;
  expect(out.ids).toEqual([retail[0].id]);expect(out.rateBefore).toBe(.12);expect(out.rateAfter).toBe(.15);
  expect(out.extraBaseSales!*(out.rateAfter-out.rateBefore)).toBeCloseTo(out.extraStaff,6);
  expect(out.conservativeGain).toBeNull();
});
it('Retail markup has a conserved daily allowance, so same-tick buy/resell cannot earn unlimited markup',async()=>{
  const {retailAllowance}=await import('../simulation/facility-levels');
  const {executeBuy,quoteSell}=await import('../simulation/markets');
  const {parseSave}=await import('../simulation/persistence');
  const s=ready();expect(dispatch(s,{type:'build',region:'heartland',building:'distribution'}).ok).toBe(true);
  const limit=retailAllowance(s,'heartland','flour').limit;
  let marked=0;
  for(let i=0;i<100&&retailAllowance(s,'heartland','flour').left>0;i++) {
    const buy=executeBuy(s,'heartland','flour',Math.ceil(limit));
    const sale=executeSell(s,'heartland','flour',buy.qty);marked+=sale.retailQty??0;
  }
  expect(marked).toBeCloseTo(limit,6);expect(retailAllowance(s,'heartland','flour').left).toBe(0);
  const restored=parseSave(JSON.stringify({game:s})).game;
  expect(retailAllowance(restored,'heartland','flour').left).toBe(0);
  const cash=s.cash;
  for(let i=0;i<100;i++){const buy=executeBuy(s,'heartland','flour',1);expect(quoteSell(s,'heartland','flour',buy.qty).retailValue).toBe(0);executeSell(s,'heartland','flour',buy.qty);}
  expect(s.cash).toBeLessThan(cash);expect(s.regions.heartland.inventory.flour).toBeCloseTo(0,6);
  s.tick=23;step(s);expect(retailAllowance(s,'heartland','flour').left).toBe(limit);
  const old=JSON.parse(JSON.stringify(s));old.version=9;delete old.regions.heartland.retailToday;
  expect(parseSave(JSON.stringify({game:old})).game.regions.heartland.retailToday).toEqual({});
});
