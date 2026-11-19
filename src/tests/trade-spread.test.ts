import {expect,it} from 'vitest';
import {createGame} from '../simulation/engine';
import {post} from '../simulation/core';
import {executeBuy,executeSell,marketDepth} from '../simulation/markets';
import type {GoodId} from '../simulation/config';
it('Dealer quotes prevent same-tick closed-loop profit at small, medium and saturated order sizes',()=>{
  for(const good of ['wheat','flour','feed','fuel','manure'] as GoodId[])for(const scale of [.01,.1,1,3])for(const first of ['buy','sell']) {
    const s=createGame(2005);post(s,'sharesIssued',1e8,'Spread regression stake');
    const quantity=Math.ceil(marketDepth(s,'heartland',good)*scale);
    if(first==='sell')s.regions.heartland.inventory[good]=quantity;
    for(let i=0;i<10;i++) {
      const before=s.cash,stock=s.regions.heartland.inventory[good];
      if(first==='buy'){const bought=executeBuy(s,'heartland',good,quantity);executeSell(s,'heartland',good,bought.qty);}
      else {const sold=executeSell(s,'heartland',good,quantity);const bought=executeBuy(s,'heartland',good,sold.qty);if(bought.qty<sold.qty)break;}
      expect(s.regions.heartland.inventory[good]).toBeCloseTo(stock,6);
      expect(s.cash-before,`${good},${scale}×depth,${first}-first,round${i}`).toBeLessThanOrEqual(.001);
    }
  }
});
it('Splitting either side of a wholesale round trip does not bypass the dealer spread',()=>{
  for(const buyParts of [1,2,10])for(const sellParts of [1,2,10]) {
    const s=createGame(2006);post(s,'sharesIssued',1e8,'Split-order regression stake');
    const cash=s.cash,want=marketDepth(s,'heartland','flour');let held=0;
    for(let i=0;i<buyParts;i++)held+=executeBuy(s,'heartland','flour',want/buyParts).qty;
    for(let i=0;i<sellParts;i++)executeSell(s,'heartland','flour',held/sellParts);
    expect(s.regions.heartland.inventory.flour).toBeCloseTo(0,6);
    expect(s.cash-cash,`${buyParts} buys / ${sellParts} sales`).toBeLessThanOrEqual(.001);
  }
});
it('Tiny low-price orders cannot harvest cent rounding by merging their resale',()=>{
  for(const good of ['manure','wheat','flour'] as GoodId[]) {
    const s=createGame(2007);post(s,'sharesIssued',1e6,'Cent-rounding regression stake');const cash=s.cash;
    for(let i=0;i<100;i++)executeBuy(s,'heartland',good,1);
    executeSell(s,'heartland',good,100);
    expect(s.cash-cash).toBeLessThanOrEqual(.001);expect(s.regions.heartland.inventory[good]).toBeCloseTo(0,6);
  }
});
