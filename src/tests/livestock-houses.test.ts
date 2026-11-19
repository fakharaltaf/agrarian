import { expect, it } from 'vitest';
import { createGame, dispatch } from '../simulation/engine';
import { post } from '../simulation/core';
import { healthFactors, outbreakShare } from '../simulation/livestock';
import type { GameState } from '../simulation/types';

function farm(houses: number) {
  const s = createGame(7101); s.legacyProgression = true; s.era = 8; s.discovered.push('chickens', 'livestock');
  post(s, 'sharesIssued', 1e7, 'Test capital');
  for (let i = 0; i < houses; i++) dispatch(s, { type: 'build', region: 'heartland', building: 'coop' });
  dispatch(s, { type: 'buyAnimals', region: 'heartland', animal: 'chickens', count: 50 });
  s.events.push({ kind: 'livestockDisease', region: 'heartland', start: s.tick, end: s.tick + 120, severity: 1, title: 'Livestock disease', text: '' } as GameState['events'][number]);
  return s;
}

it('An outbreak reaches one house: a flock spread over four coops loses a quarter as much health as one in a single coop', () => {
  const one = farm(1), four = farm(4);
  expect(outbreakShare(one, 'heartland', 'chickens')).toBe(1);
  expect(outbreakShare(four, 'heartland', 'chickens')).toBeCloseTo(0.25, 5);
  const h1 = one.herds.find((h) => h.animal === 'chickens')!, h4 = four.herds.find((h) => h.animal === 'chickens')!;
  expect(healthFactors(four, h4).disease).toBeCloseTo(healthFactors(one, h1).disease / 4, 6);
});
