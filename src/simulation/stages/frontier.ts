import {cityActive,cityOf} from '../city-state';
import {regionActive,regionOf} from '../region-state';
import type { StageModule } from './types';
import type { GameState } from '../types';
import { townOf } from '../town-state';
import { population } from '../community-state';
import { communityOf } from '../community-state';
import { noStageAction } from './shared';
import { log } from '../core';
import { fertility } from '../agriculture';

export const PLAYABLE_CHAPTERS = ['homestead', 'market-town', 'farm-business', 'industry', 'settlement', 'town', 'city', 'region'] as const;
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
    { id: `frontier:sales:${salesRank}`, icon: '📦', name: 'Trade horizon', unit:'usd', rank: salesRank, value: sales, target: target(1e6, salesRank), progress: sales / target(1e6, salesRank), detail: 'Lifetime sales. Each mark doubles the next goal.' },
    { id: `frontier:soil:${soilRank}`, icon: '🌱', name: 'Stewardship', unit:'ha', rank: soilRank, value: ha, target: target(100, soilRank), progress: Math.min(ha / target(100, soilRank), soil / 0.8), detail: `Keep average fertility at 80% or more. Current: ${Math.round(soil * 100)}%. Each mark doubles the land target.` },
    ...(regionActive(s)?(()=>{const sent=Object.values(regionOf(s).neighbours).reduce((n,x)=>n+x.delivered,0),r=rank('caravans');return [{id:`frontier:caravans:${r}`,icon:'🐫',name:'Caravan roads',unit:'usd',rank:r,value:sent,target:target(250000,r),progress:sent/target(250000,r),detail:'Value delivered to neighbours by caravan. Each mark doubles the goal.'}];})():[]),
    ...(cityActive(s)?[{id:`frontier:safety:${rank('safety')}`,icon:'🛡',name:'Safe passage',unit:'days',rank:rank('safety'),value:cityOf(s).safeDays,target:target(120,rank('safety')),progress:cityOf(s).safeDays/target(120,rank('safety')),detail:'Maintain1200 residents,90%food,70%sanitation and crime no higher than20%. Each mark doubles the safe-day goal.'}]:[]),
    ...(townOf(s).active ? [{ id: `frontier:care:${rank('care')}`, icon: '♥', name: 'A place to thrive', unit:'people', rank: rank('care'), value: population(s), target: target(100,rank('care')), progress: Math.min(population(s)/target(100,rank('care')),communityOf(s).happiness/.95,townOf(s).health/.9,townOf(s).education/.9), detail: 'Grow while keeping happiness at 95%, health and education at 90%. Each mark doubles the population goal.' }] : []),
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
