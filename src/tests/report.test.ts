// Economy report (run with REPORT=1): plays bot farms through the chapters and prints, per chapter, how long it took,
// where the money came from (raw crops, processed goods, oil) and how many factories stood. A design measuring stick,
// not a pass/fail test; see docs/ROADMAP.md §10c.
import { it } from 'vitest';
import { createGame, step } from '../simulation/engine';
import { BUILDINGS, GOODS, GOOD_IDS, type GoodId } from '../simulation/config';
import { refPrice } from '../simulation/core';
import { botAct, type Strategy } from './bot';

type Source = 'raw' | 'processed' | 'oil' | 'other';
const sourceOf = (g: GoodId): Source => (g === 'oil' || g === 'fuel' ? 'oil' : GOODS[g].kind === 'crop' ? 'raw' : GOODS[g].kind === 'processed' ? 'processed' : 'other');
// longest names first, so "Soybean oil" is not crude oil and "Sugarcane" is not sugar
const NAMES = GOOD_IDS.map((g) => [GOODS[g].name.toLowerCase(), g] as const).sort((a, b) => b[0].length - a[0].length);
const goodIn = (memo: string) => { const m = memo.toLowerCase(); return NAMES.find(([n]) => m.includes(n))?.[1]; };

export function economyReport(seed: number, strategy: Strategy, until = 'settlement', maxTicks = 14000) {
  const s = createGame(seed), seen = new WeakSet<object>(), rows: Record<string, { hours: number; income: Record<Source, number>; factories: number; priceRatio: number; share: number }> = {};
  let stage = s.stageId, since = s.tick, samples = 0;
  const row = () => (rows[stage] ??= { hours: 0, income: { raw: 0, processed: 0, oil: 0, other: 0 }, factories: 0, priceRatio: 0, share: 0 });
  for (let i = 0; i < maxTicks && s.stageId !== until; i++) {
    botAct(s, strategy); step(s);
    for (const e of s.ledger) { if (seen.has(e)) continue; seen.add(e); if (e.kind !== 'sale') continue; const g = goodIn(e.memo); row().income[g ? sourceOf(g) : 'other'] += e.amount; }
    if (s.tick % 24 === 0) { // daily: how dear crops are against their reference, and how much of each crop market the farm is
      const crops = GOOD_IDS.filter((g) => GOODS[g].kind === 'crop'), m = s.markets.heartland;
      row().priceRatio += crops.reduce((a, g) => a + m[g]!.price / refPrice(s, g), 0) / crops.length;
      row().share += Math.max(...crops.map((g) => m[g]!.playerSold / Math.max(1, m[g]!.totalSold)));
      samples++;
    }
    if (s.stageId !== stage) close();
  }
  if (s.stageId === stage && samples) close(); // the chapter it stopped in, as far as it got
  return rows;
  function close() { const r = row(); r.hours = s.tick - since; r.factories = s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing' && b.type !== 'oilWell' && b.type !== 'refinery').length; r.priceRatio /= samples || 1; r.share /= samples || 1; stage = s.stageId; since = s.tick; samples = 0; }
}

it.skipIf(!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.REPORT)('economy report: chapters, income sources, factories', () => {
  for (const strategy of ['balanced', 'volume', 'processor'] as Strategy[]) for (const seed of [123, 741]) {
    const rows = economyReport(seed, strategy);
    for (const [stage, r] of Object.entries(rows)) {
      const total = Object.values(r.income).reduce((a, b) => a + b, 0) || 1, pct = (k: Source) => `${Math.round((r.income[k] / total) * 100)}%`.padStart(4);
      console.log(`REPORT ${strategy.padEnd(9)} ${seed} ${stage.padEnd(13)} ${String(r.hours).padStart(5)}h  raw ${pct('raw')} processed ${pct('processed')} oil ${pct('oil')}  factories ${r.factories}  crop price ×${r.priceRatio.toFixed(2)}  biggest share ${(r.share * 100).toFixed(1)}%`);
    }
  }
}, 600000);
