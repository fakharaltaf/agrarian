// Nation chapter: the player's answer to a rival. Compact state, no engine imports.
import type { NeighbourId } from './region-state';
import type { GameState } from './types';
export type NationPath = 'army' | 'alliance' | 'neutrality';
export type Stance = 'raid' | 'siege';
/** Paid, timed military training. Each level multiplies army strength. */
export const DRILLS = [
  { name: 'Drill & tactics', icon: '🎖', cost: 30000, days: 20, power: 1.25 },
  { name: 'Logistics', icon: '🐎', cost: 60000, days: 30, power: 1.5 },
  { name: 'Artillery', icon: '💥', cost: 120000, days: 45, power: 1.85 },
] as const;
/** Each neighbour's standing defence, in soldier-equivalents. It recovers after a defeat. */
export const DEFENCE: Record<NeighbourId, number> = { river: 30, arid: 70, coastal: 50, tropics: 60 };
export interface Campaign { id: number; target: NeighbourId; stance: Stance; started: number; ends: number; odds: number; soldiers: number }
export interface WarRecord { day: number; target: NeighbourId; stance: Stance; won: boolean; lost: number; spoils: number }
export interface NationState {
  active: boolean; enteredAt: number; path: NationPath | null; lastDay: number;
  drill: number; drillUntil: number; morale: number; supply: number; weariness: number;
  weakened: Record<NeighbourId, number>; vassal: { from: NeighbourId; until: number; daily: number } | null;
  campaign: Campaign | null; wins: number; losses: number; casualties: number; history: WarRecord[];
  league: League; neutral: Neutral;
}
/** Alliance path: a league of trusted neighbours with obligations both ways. */
export interface League {
  members: NeighbourId[]; cohesion: number; aid: number;
  request: { from: NeighbourId; kind: 'grain' | 'cash'; amount: number; deadline: number } | null; nextRequestDay: number;
  vote: { target: NeighbourId; deadline: number } | null; nextVoteDay: number; sanction: { target: NeighbourId; until: number } | null;
}
/** Neutrality path: safety by being indispensable, with embargoes, spies, mercenaries and mediation. */
export interface Neutral {
  embargo: { target: NeighbourId; since: number } | null; intelUntil: number; mercenariesUntil: number;
  dispute: { a: NeighbourId; b: NeighbourId; deadline: number } | null; nextDisputeDay: number; mediated: number;
}
export function createNationState(): NationState {
  return { active: false, enteredAt: -1, path: null, lastDay: -1, drill: 0, drillUntil: -1, morale: .7, supply: 1, weariness: 0,
    weakened: { river: 0, arid: 0, coastal: 0, tropics: 0 }, vassal: null, campaign: null, wins: 0, losses: 0, casualties: 0, history: [],
    league: { members: [], cohesion: .6, aid: 0, request: null, nextRequestDay: -1, vote: null, nextVoteDay: -1, sanction: null },
    neutral: { embargo: null, intelUntil: -1, mercenariesUntil: -1, dispute: null, nextDisputeDay: -1, mediated: 0 } };
}
export const nationOf = (s: GameState): NationState => (s.stageState.nation ??= createNationState() as unknown as Record<string, unknown>) as unknown as NationState;
export const nationActive = (s: GameState) => !!(s.stageState.nation as unknown as NationState | undefined)?.active;
export const drillPower = (level: number) => level > 0 ? DRILLS[level - 1].power : 1;
/** Barracks are staffed through the shared civic allocator: each soldier is a local adult. */
export const SOLDIERS_PER_BARRACKS = 20;
export const RATIONS_PER_SOLDIER = 3; // units of grain or bread a day
