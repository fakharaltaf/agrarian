import { it } from 'vitest';
// Balance reports: slow and print-only. Run with BALANCE=1 npx vitest run src/tests/<file>.
// @ts-expect-error node global in tests only
const run = process.env.BALANCE ? it : it.skip;
import { createGame, step, totalHa, lifetimeSales } from '../simulation/engine';
import { equity } from '../simulation/core';
import { botAct, type Strategy } from './bot';
for (const strat of ['balanced', 'volume', 'processor'] as Strategy[]) run('pace ' + strat, () => {
  const s = createGame(11);
  const marks: string[] = [];
  let era = 1, bk = 0;
  const t0 = performance.now();
  for (let t = 0; t < 3600 * 12; t++) {
    botAct(s, strat);
    if (s.bankrupt) bk++;
    step(s);
    if (s.era !== era) { era = s.era; marks.push(`E${era}@${(s.tick / 60).toFixed(0)}m`); }
    if (t % 7200 === 0) console.log(`${strat} ${t/3600}h eq=${Math.round(equity(s)/1000)}k cash=${Math.round(s.cash/1000)}k ha=${totalHa(s)} sales=${Math.round(lifetimeSales(s)/1000)}k w=${s.workers.length} m=${s.machines.length} b=${s.buildings.length} f=${s.fields.length} wh=${s.markets.heartland.wheat!.price.toFixed(2)} cpi=${s.macro.cpi.toFixed(2)} res=${s.research.done.length}`);
  }
  console.log(strat, marks.join(' '), 'bankruptcies', bk, 'ms', Math.round(performance.now() - t0));
}, 900000);
