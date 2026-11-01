// Daily goals (by the player's real calendar day): three small goals; finishing all three wins a
// county-fair prize and extends the streak. Goals scale with the size of the farm.
import { post, sumBooks } from './core';
import { log } from './core';
import type { GameState } from './types';

export interface DailyGoal { id: string; text: string; target: number; progress: number }

const sales = (s: GameState) => (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);

export function startDay(s: GameState, key: string) {
  if (s.daily?.key === key) return;
  const prev = s.daily;
  s.daily = { key, base: { harvests: s.stats.harvests, sales: sales(s), plantings: s.stats.plantings }, claimed: false, streak: prev?.streak ?? 0, lastClaimed: prev?.lastClaimed ?? '' };
}

export function dailyGoals(s: GameState): DailyGoal[] {
  const d = s.daily;
  if (!d) return [];
  const scale = [1, 1, 3, 8, 20, 40, 80, 150, 250][s.era];
  const daySales = Math.max(150, (sumBooks(s, 30, ['sale', 'contract']) / 30) * 0.6);
  const target = Math.round(daySales / 50) * 50;
  return [
    { id: 'harvest', text: `Bring in ${5 * scale} harvests`, target: 5 * scale, progress: s.stats.harvests - d.base.harvests },
    { id: 'plant', text: `Plant ${5 * scale} fields`, target: 5 * scale, progress: s.stats.plantings - d.base.plantings },
    { id: 'sell', text: `Sell $${target.toLocaleString()} of produce`, target, progress: sales(s) - d.base.sales },
  ];
}

/** Prize scales with the business: about a fifth of a typical day's sales, at least $50. */
export const dailyPrize = (s: GameState) => Math.max(50, Math.round((sumBooks(s, 30, ['sale', 'contract']) / 30) * 0.2));

const yesterday = (key: string) => {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function claimDaily(s: GameState, key: string): number | string {
  const d = s.daily;
  if (!d || d.key !== key) return 'Today’s goals have not started yet.';
  if (d.claimed) return 'Already claimed today — come back tomorrow!';
  if (dailyGoals(s).some((g) => g.progress < g.target)) return 'Finish all three goals first.';
  const prize = dailyPrize(s);
  post(s, 'prize', prize, 'County fair prize', 'heartland', 'corporate');
  d.streak = d.lastClaimed === yesterday(key) ? d.streak + 1 : 1;
  d.lastClaimed = key;
  d.claimed = true;
  log(s, 'opportunity', `Daily goals complete — $${prize.toLocaleString()} county fair prize. Streak: ${d.streak} day${d.streak === 1 ? '' : 's'}!`);
  return prize;
}
