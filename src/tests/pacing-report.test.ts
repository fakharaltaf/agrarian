// Opt-in pacing report: PACING=1 npx vitest run src/tests/pacing-report.test.ts
// Plays a new farm with the play bot and measures, per chapter: duration, objective changes,
// the longest stretch with no growth (nothing new built/bought/hired: dead time), and insolvencies.
import { it } from 'vitest';
import { createGame, step, objective } from '../simulation/engine';
import { communityOf, population } from '../simulation/community-state';
import { townOf } from '../simulation/town-state';
import { regionOf } from '../simulation/region-state';
import { lifetimeSales } from '../simulation/stages/shared';
import { nationBotAct } from './bot';
// @ts-expect-error node
import { writeFileSync } from 'node:fs';
// @ts-expect-error node
const OUT = process.env.PACING as string | undefined;
const mask = (x: string) => x.replace(/[0-9$.,%·/~]+/g, '#');
it.skipIf(!OUT)('pacing report', () => {
  const seeds = [1002, 2024, 77];
  const report: unknown[] = [];
  for (const seed of seeds) {
    const s = createGame(seed);
    const growth = () => [s.fields.length, s.buildings.reduce((n, b) => n + b.level, 0), s.workers.length, s.machines.length, townOf(s).services.reduce((n, b) => n + b.count, 0), communityOf(s).homes.reduce((n, h) => n + h.count, 0), Object.values(regionOf(s).neighbours).filter(n => n.route).length, s.research.done.length, s.unlockedCrops.length].join(',');
    let objLongestTitle = '';
    let stage = s.stageId, start = 0, lastGrowth = 0, sig = growth(), obj = mask(objective(s).title), objChanges = 0, longestIdle = 0, idleAt = 0, bankrupt = 0, wasBankrupt = false, objLongest = 0, objAt = 0;
    const chapters: unknown[] = [];
    const close = () => { if (s.tick - lastGrowth > longestIdle) { longestIdle = s.tick - lastGrowth; idleAt = lastGrowth; } if (s.tick - objAt > objLongest) { objLongest = s.tick - objAt; objLongestTitle = obj; } chapters.push({ stage, ticks: s.tick - start, minutesAt1x: +((s.tick - start) / 60).toFixed(1), objectiveChanges: objChanges, longestNoGrowth: longestIdle, noGrowthStartedAt: idleAt - start, longestSameObjective: objLongest, insolvencies: bankrupt, salesAtEnd: Math.round(lifetimeSales(s)), cash: Math.round(s.cash), people: population(s), longestSameObjectiveTitle: objLongestTitle, lastObjective: obj }); };
    for (let i = 0; i < 60000; i++) {
      nationBotAct(s); step(s);
      if (s.bankrupt && !wasBankrupt) bankrupt++; wasBankrupt = !!s.bankrupt;
      if (s.stageId !== stage) { close(); stage = s.stageId; start = s.tick; lastGrowth = s.tick; longestIdle = 0; idleAt = s.tick; objChanges = 0; bankrupt = 0; objLongest = 0; objAt = s.tick; obj = mask(objective(s).title); objLongestTitle = obj; }
      const g = growth(); if (g !== sig) { sig = g; if (s.tick - lastGrowth > longestIdle) { longestIdle = s.tick - lastGrowth; idleAt = lastGrowth; } lastGrowth = s.tick; }
      const o = mask(objective(s).title); if (o !== obj) { objChanges++; if (s.tick - objAt > objLongest) { objLongest = s.tick - objAt; objLongestTitle = obj; } objAt = s.tick; obj = o; }
      if (s.stageId === 'nation' && s.tick - start > 24 * 60) break;
    }
    close();
    report.push({ seed, chapters });
  }
  writeFileSync(OUT, JSON.stringify(report, null, 1));
}, 900000);
