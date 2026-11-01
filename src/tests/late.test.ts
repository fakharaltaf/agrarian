import { it } from 'vitest';
// Balance reports: slow and print-only. Run with BALANCE=1 npx vitest run src/tests/<file>.
// @ts-expect-error node global in tests only
const run = process.env.BALANCE ? it : it.skip;
import { createGame, step, totalHa, lifetimeSales } from '../simulation/engine';
import { equity } from '../simulation/core';
import { botAct } from './bot';
run('late', () => {
  const s = createGame(77);
  const marks: string[] = []; let era = 1; const kinds: Record<string, number> = {}; const seen = new Set<number>();
  const t0 = performance.now();
  for (let t = 0; t < 3600 * 20; t++) {
    botAct(s, 'balanced'); step(s);
    if (s.era !== era) { era = s.era; marks.push(`E${era}@${(s.tick / 3600).toFixed(1)}h`); }
    for (const e of s.events) if (!seen.has(e.id)) { seen.add(e.id); kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; }
  }
  const ms = performance.now() - t0;
  const t1 = performance.now(); for (let i = 0; i < 500; i++) step(s); const per = (performance.now() - t1) / 500;
  console.log('eras', marks.join(' '), 'sim ms', Math.round(ms), 'ms/tick late', per.toFixed(3));
  console.log('eq', Math.round(equity(s)), 'ha', totalHa(s), 'fields', s.fields.length, 'workers', s.workers.length, 'machines', s.machines.length, 'buildings', s.buildings.length, 'sales', Math.round(lifetimeSales(s)));
  console.log('save KB', Math.round(JSON.stringify(s).length / 1024), 'cpi', s.macro.cpi.toFixed(2), 'climate', s.macro.climate.toFixed(2), 'rate', s.macro.baseRate.toFixed(3), 'energy', s.macro.energy.toFixed(2));
  console.log('events', JSON.stringify(kinds));
  console.log('competitors', s.competitors.map(c => `${c.name.split(' ')[0]}:${c.status}:${Math.round(c.ha)}ha:${Math.round(c.profit30)}`).join(' | '));
  console.log('regions', Object.values(s.regions).filter(r => r.unlocked).map(r => r.id).join(','), 'research', s.research.done.length);
  console.log('wheat prices', Object.values(s.markets).map(m => m.wheat!.price.toFixed(2)).join(' '));
}, 1800000);
