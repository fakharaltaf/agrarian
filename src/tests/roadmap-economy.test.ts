import { expect, it } from 'vitest';
import { createGame } from '../simulation/engine';
import { post } from '../simulation/core';
import { shipGoods } from '../simulation/logistics';
import { executeSell } from '../simulation/markets';

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
