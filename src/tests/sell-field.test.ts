import { expect, it } from 'vitest';
import { createGame, dispatch, homePlotPrice } from '../simulation/engine';
it('selling a home plot returns 85% and puts the plot back on the market; the last field cannot be sold', () => {
  const s = createGame(31); s.cash = 10000; s.stats.sales = 1;
  expect(dispatch(s, { type: 'buyPlot' }).ok).toBe(true);
  const paid = s.fields[1].cost, bought = s.regions.heartland.homePlotsBought, cash = s.cash;
  expect(dispatch(s, { type: 'sellField', fieldId: s.fields[1].id }).ok).toBe(true);
  expect(s.cash - cash).toBe(Math.round(paid * 0.85));
  expect(s.regions.heartland.homePlotsBought).toBe(bought - 1);
  expect(homePlotPrice(s)).toBeGreaterThanOrEqual(Math.round(paid * 0.85)); // buying back never pays
  expect(dispatch(s, { type: 'sellField', fieldId: s.fields[0].id }).ok).toBe(false);
});
