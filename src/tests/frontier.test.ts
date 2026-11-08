import { expect, it } from 'vitest';
import { createGame, canAdvance, dispatch } from '../simulation/engine';
import { frontierGoals, frontierTick } from '../simulation/stages/frontier';
import { communityOf } from '../simulation/community-state';
import { post } from '../simulation/core';
it('Frontier recognizes growth once per day and doubles the next target without granting cash', () => {
  const s = createGame(919); s.stageId = 'nation'; communityOf(s).active = true; s.tick = 24;
  post(s, 'sale', 1e6, 'Test delivered goods');
  const cash = s.cash;
  const first = frontierGoals(s)[0];
  frontierTick(s);
  expect(s.milestones).toContain(first.id);
  expect(frontierGoals(s)[0].target).toBe(first.target * 2);
  frontierTick(s);
  expect(s.milestones.filter(id => id === first.id)).toHaveLength(1);
  expect(s.cash).toBe(cash);
});
it('The unfinished chapter cannot be entered, and legacy endgame receives optional goals', () => {
  const s = createGame(920); s.stageId = 'nation'; communityOf(s).active = true; s.lifetime.sale = 1e9;
  expect(canAdvance(s)).toBe(false);
  expect(dispatch(s, { type: 'advanceEra' }).ok).toBe(false);
  s.legacyProgression = true; s.era = 8; s.tick = 24;
  frontierTick(s);
  expect(s.milestones.filter(id => id.startsWith('frontier:sales:')).length).toBeGreaterThan(1);
  const marks = s.milestones.length;
  frontierTick(s);
  expect(s.milestones.length).toBe(marks);
  expect(s.log.filter(entry => entry.text.includes('Frontier mark'))).toHaveLength(1);
});
it('Poor soil cannot earn a stewardship mark even when acreage qualifies', () => {
  const s = createGame(921); s.stageId = 'nation'; communityOf(s).active = true; s.tick = 24;
  s.fields[0].ha = 1000;
  for (const nutrient of ['n','p','k'] as const) s.fields[0].soil[nutrient] = 0;
  frontierTick(s);
  expect(s.milestones.some(id => id.startsWith('frontier:soil:'))).toBe(false);
});

it('City Frontier uses actual safe days and labels people separately from hectares',()=>{
 const s=createGame(1703);s.stageId='nation';communityOf(s).active=true;
 const v=s.stageState.city!;v.active=true;v.safeDays=120;
 const goals=frontierGoals(s),safe=goals.find(g=>g.name==='Safe passage')!;
 expect(safe.unit).toBe('days');expect(safe.progress).toBe(1);
 s.tick=24;frontierTick(s);expect(s.milestones).toContain(safe.id);
 expect(frontierGoals(s).find(g=>g.name==='Safe passage')!.target).toBe(240);
});
