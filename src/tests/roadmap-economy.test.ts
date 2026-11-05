import { antitrustCheck, expireChoices } from '../simulation/events';
import { researchSpeed, labLevel, researchDaily } from '../simulation/research';
import { dispatch } from '../simulation/engine';
import { TECH } from '../simulation/config';
import { expect, it } from 'vitest';
import { createGame } from '../simulation/engine';
import { post } from '../simulation/core';
import { shipGoods } from '../simulation/logistics';
import { policiesTick } from '../simulation/automation';
import { stored } from '../simulation/core';
import { executeSell, marketDepth } from '../simulation/markets';

it('daily manager-sale aggregation preserves cash and books across intervening entries', () => {
  const a=createGame(8), b=structuredClone(a);
  a.regions.heartland.inventory.wheat=b.regions.heartland.inventory.wheat=1000;
  for(let hour=0;hour<12;hour++){
    a.tick=b.tick=hour;
    executeSell(a,'heartland','wheat',10,'Manager sales: Wheat');
    executeSell(b,'heartland','wheat',10,`Sale ${hour}`);
    for(let i=0;i<45;i++){post(a,'wages',-0.01,`Worker ${i}`);post(b,'wages',-0.01,`Worker ${i}`);}
  }
  expect(a.cash).toBe(b.cash);expect(a.books).toEqual(b.books);expect(a.lifetime).toEqual(b.lifetime);
  expect(a.ledger.filter(x=>x.memo==='Manager sales: Wheat')).toHaveLength(1);
  a.tick=24;executeSell(a,'heartland','wheat',10,'Manager sales: Wheat');
  expect(a.ledger.filter(x=>x.memo==='Manager sales: Wheat')).toHaveLength(2);
});
it('separate divisions never collapse into the same ledger entry',()=>{
  const s=createGame(1);post(s,'wages',-5,'Staff','heartland','crops');post(s,'wages',-6,'Staff','heartland','processing');
  expect(s.ledger).toHaveLength(2);
});
it('rejected shipping leaves port allowance, stock, cash and ledger unchanged',()=>{
  const s=createGame(9);s.regions.tropics.unlocked=true;s.regions.heartland.inventory.wheat=100;
  const before=JSON.stringify(s);
  expect(shipGoods(s,'wheat',100,'heartland','tropics',0)).toMatch(/costs/);
  expect(JSON.stringify(s)).toBe(before);
});

it('storage relief sells only the excess and respects an hourly depth cap',()=>{
  const s=createGame(4);s.corp.execs.push('crops');
  s.automation.policies.sellDiscipline=1.3;s.automation.policies.sellStorageCap=0.85;
  s.tick=7;
  const cap=stored(s,'heartland').cap.dry;
  s.regions.heartland.inventory.flour=cap*0.85+10;
  policiesTick(s);
  expect(s.regions.heartland.inventory.flour).toBeCloseTo(cap*0.85,6);
  s.regions.heartland.inventory.flour=100000;
  const before=s.regions.heartland.inventory.flour;
  policiesTick(s);
  expect(before-s.regions.heartland.inventory.flour).toBeLessThanOrEqual(marketDepth(s,'heartland','flour')*0.15+1e-6);
});

it('paid lab levels speed research without granting advanced eligibility or stacking',()=>{
  const s=createGame(8);s.era=8;s.discovered.push('upgrades');post(s,'sharesIssued',10000000,'Test capital');
  expect(dispatch(s,{type:'build',building:'lab',region:'heartland'}).ok).toBe(true);
  const lab=s.buildings.find(b=>b.type==='lab')!;
  expect(researchSpeed(s)).toBe(1);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:lab.id}).ok).toBe(true);
  expect(researchSpeed(s)).toBe(1.5);
  s.research.active={id:Object.keys(TECH)[0],progress:0};
  researchDaily(s);expect(s.research.active!.progress).toBeCloseTo(1.5/TECH[s.research.active!.id].days);
  expect(dispatch(s,{type:'upgradeBuilding',buildingId:lab.id}).ok).toBe(true);
  expect(researchSpeed(s)).toBe(2);expect(labLevel(s)).toBe(1);
  expect(dispatch(s,{type:'build',building:'lab',region:'heartland'}).ok).toBe(true);
  expect(researchSpeed(s)).toBe(2);
  s.buildings.forEach(b=>b.active=false);expect(researchSpeed(s)).toBe(0);
});

it('hourly export loads share one daily shipment without free freight or earlier arrival',()=>{
  const s=createGame(88);s.regions.river.unlocked=true;post(s,'sharesIssued',100000,'Test capital');
  s.regions.heartland.inventory.bread=400;
  s.tick=3;expect(shipGoods(s,'bread',100,'heartland','river',s.cash,true,true)).toBeNull();
  const arrival=s.shipments[0].arrives, cash=s.cash;
  s.tick=15;expect(shipGoods(s,'bread',100,'heartland','river',s.cash,true,true)).toBeNull();
  expect(s.shipments).toHaveLength(1);expect(s.shipments[0].qty).toBe(200);
  expect(s.shipments[0].arrives).toBeGreaterThanOrEqual(arrival);expect(s.cash).toBeLessThan(cash);
  expect(s.regions.heartland.inventory.bread).toBe(200);
  s.tick=25;expect(shipGoods(s,'bread',100,'heartland','river',s.cash,true,true)).toBeNull();
  expect(s.shipments).toHaveLength(2);
});

it('bulk idle sale protects assigned machines and revalidates the whole selection',()=>{
  const s=createGame(11);s.era=8;post(s,'sharesIssued',1000000,'Test capital');
  for(let i=0;i<3;i++) expect(dispatch(s,{type:'buyMachine',region:'heartland',machine:'tractor',lease:false}).ok).toBe(true);
  const [a,b,c]=s.machines;a.driver=123;
  const before=JSON.stringify(s);
  expect(dispatch(s,{type:'sellIdleMachines',machineIds:[a.id,b.id]}).ok).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
  const cash=s.cash;
  expect(dispatch(s,{type:'sellIdleMachines',machineIds:[b.id,c.id]}).ok).toBe(true);
  expect(s.machines.map(m=>m.id)).toEqual([a.id]);
  expect(s.cash-cash).toBe(Math.round(b.cost*.8)+Math.round(c.cost*.8));
});

it('antitrust auto-settlement retains the fine and leaves a readable notice',()=>{
  const s=createGame(22);s.era=7;post(s,'sale',1000000,'Test sales');
  for(let i=0;i<100&&!s.events.some(e=>e.kind==='antitrust');i++) antitrustCheck(s,()=>0.5);
  const probes=s.events.filter(e=>e.kind==='antitrust');expect(probes.length).toBeGreaterThan(0);
  const cash=s.cash, rep=s.corp.reputation;
  s.tick=Math.max(...probes.map(e=>e.choice!.deadline));expireChoices(s);
  expect(s.cash).toBeCloseTo(cash-30000*probes.length,2);
  expect(s.corp.reputation).toBe(Math.max(0,rep-3*probes.length));
  expect(s.log.some(x=>x.text.includes('Antitrust auto-settled')&&x.text.includes('35%'))).toBe(true);
});
