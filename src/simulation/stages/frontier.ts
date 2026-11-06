import type { StageModule } from './types';
import type { GameState } from '../types';
import { communityOf } from '../community-state';
import { noStageAction } from './shared';
import { log } from '../core';
import { fertility } from '../agriculture';

export const PLAYABLE_CHAPTERS = ['homestead', 'market-town', 'farm-business', 'industry', 'settlement'] as const;
export function atFrontier(s: GameState) { return s.legacyProgression && !communityOf(s).active ? s.era >= 8 : s.stageId === PLAYABLE_CHAPTERS[PLAYABLE_CHAPTERS.length - 1]; }
export function frontierGoals(s: GameState) {
  const rank = (track: string) => s.milestones.filter(id => id.startsWith(`frontier:${track}:`)).length;
  const salesRank = rank('sales'), soilRank = rank('soil');
  const sales = (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);
  const ha = s.fields.reduce((n, f) => n + f.ha, 0);
  const soil = s.fields.reduce((n, f) => n + fertility(f) * f.ha, 0) / Math.max(1, ha);
  // Saturation protects displayed values from Infinity in extraordinarily long saves.
  const target = (base: number, tier: number) => Math.min(Number.MAX_SAFE_INTEGER, base * 2 ** Math.min(900, tier));
  return [
    { id: `frontier:sales:${salesRank}`, icon: '📦', name: 'Trade horizon', rank: salesRank, value: sales, target: target(1e6, salesRank), progress: sales / target(1e6, salesRank), detail: 'Lifetime sales. Each mark doubles the next goal.' },
    { id: `frontier:soil:${soilRank}`, icon: '🌱', name: 'Stewardship', rank: soilRank, value: ha, target: target(100, soilRank), progress: Math.min(ha / target(100, soilRank), soil / 0.8), detail: `Keep average fertility at 80% or more. Current: ${Math.round(soil * 100)}%. Each mark doubles the land target.` },
  ];
}
export function frontierTick(s: GameState) {
  if (!atFrontier(s) || s.tick % 24 !== 0) return;
  let earned = 0;
  // Veteran saves may already qualify for several tiers. Record them together,
  // rather than presenting trivial goals and repeated notifications for days.
  for (let tier = 0; tier < 64; tier++) {
    const ready = frontierGoals(s).filter(goal => goal.progress >= 1);
    if (!ready.length) break;
    for (const goal of ready) { s.milestones.push(goal.id); earned++; }
  }
  if (earned) log(s, 'opportunity', `${earned} Frontier mark${earned === 1 ? '' : 's'} earned. Your next horizon is ready.`, 'overview');
}
export const frontier: StageModule = {
  id: 'frontier', title: 'Frontier', legacyEras: [], eraUnlocks: {},
  actionTypes: [], tips: [], discoveries: [],
  tick: frontierTick, handleAction: noStageAction, createState: () => ({}),
};
