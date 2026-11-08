import { expect, it } from 'vitest';
import { createGame, step, chapterGate } from '../simulation/engine';
import { nationBotAct } from './bot';
import { canAdvance } from '../simulation/progression';
import { canStartSettlement } from '../simulation/stages/settlement';
import { canStartTown } from '../simulation/stages/town';
import { canStartCity } from '../simulation/stages/city';
import { canStartRegion } from '../simulation/stages/region';
// The HUD's gate rows must agree with the real chapter gate at every point of a playthrough.
it('chapter gate rows agree with the real gate through a new-farm playthrough', () => {
  const s = createGame(1002), seen = new Set<string>();
  for (let i = 0; i < 16000; i++) {
    nationBotAct(s); step(s);
    if (s.tick % 6 || s.bankrupt) continue;
    const rows = chapterGate(s);
    if (!rows) continue;
    const either = rows.filter((r) => r.either), all = rows.filter((r) => !r.either);
    const done = (either.length ? either.some((r) => r.done) : true) && all.every((r) => r.done);
    const gate = s.stageId === 'industry' ? canStartSettlement(s) : s.stageId === 'settlement' ? canStartTown(s) : s.stageId === 'town' ? canStartCity(s)
      : s.stageId === 'city' ? canStartRegion(s) : s.stageId === 'region' ? null : canAdvance(s) || (s.stageId === 'homestead' && !s.charters.trader && done);
    if (gate === null) continue;
    expect(done, `${s.stageId} @${s.tick}`).toBe(gate);
    seen.add(s.stageId);
  }
  expect([...seen]).toEqual(expect.arrayContaining(['homestead', 'market-town', 'farm-business', 'industry', 'settlement', 'town', 'city']));
}, 120000);
