import type { StageModule } from './types';
import type { Action, ActionResult, GameState } from '../types';
import { REGIONS, type GoodId } from '../config';
import { clamp, log, nextId, post, random, reservedStock, round2 } from '../core';
import { communityOf, workingAdults } from '../community-state';
import { townOf } from '../town-state';
import { regionActive, regionOf, NEIGHBOUR_IDS, NEIGHBOURS, isNeighbour, type NeighbourId } from '../region-state';
import { createNationState, DEFENCE, DRILLS, drillPower, nationActive, nationOf, RATIONS_PER_SOLDIER, type Stance } from '../nation-state';
import { larderReserve } from './settlement';
import { lifetimeSales } from './shared';

export const canStartNation = (s: GameState) => regionActive(s) && regionOf(s).answered !== null && !nationActive(s);
const RATION_GOODS: GoodId[] = ['wheat', 'corn', 'bread', 'flour', 'potatoes', 'rice'];
const CAMPAIGN_DAYS: Record<Stance, number> = { raid: 7, siege: 14 };
const day = (s: GameState) => Math.floor(s.tick / 24);

export function soldiers(s: GameState) {
  return townOf(s).services.filter(b => b.type === 'barracks' && b.active && b.funded).reduce((n, b) => n + b.staffed, 0);
}
export function armyStrength(s: GameState) {
  const v = nationOf(s);
  return soldiers(s) * drillPower(v.drill) * (.5 + .5 * v.morale) * v.supply;
}
export function defenceOf(s: GameState, id: NeighbourId) { return DEFENCE[id] * (1 - nationOf(s).weakened[id]); }
export function campaignOdds(s: GameState, id: NeighbourId, stance: Stance) {
  const a = armyStrength(s), d = defenceOf(s, id) * (stance === 'siege' ? 1.6 : .9);
  return a <= 0 ? 0 : clamp(a / (a + d), .02, .95);
}
/** Expected soldiers lost: a win costs 5% of the force, a defeat 15%; sieges cost half again as much. */
export function expectedLosses(s: GameState, stance: Stance, won: boolean) {
  return Math.round(soldiers(s) * (won ? .05 : .15) * (stance === 'siege' ? 1.5 : 1));
}
export const plunder = (s: GameState, id: NeighbourId) => round2(DEFENCE[id] * 1500 * s.macro.cpi);
export const indemnity = (s: GameState, id: NeighbourId) => round2(DEFENCE[id] * 300 * s.macro.cpi);
export const vassalDaily = (s: GameState, id: NeighbourId) => round2(DEFENCE[id] * 50 * s.macro.cpi);
export const drillCost = (s: GameState) => { const next = DRILLS[nationOf(s).drill]; return next ? round2(next.cost * s.macro.cpi) : 0; };

/** Casualties are real people: adults leave the town's cohorts, spread proportionally. */
function bury(s: GameState, dead: number) {
  const c = communityOf(s), total = workingAdults(s);
  let left = Math.min(dead, total);
  const lost = left;
  for (const group of c.cohorts) {
    if (!left) break;
    const share = Math.min(group.adults, left, Math.ceil(dead * group.adults / Math.max(1, total)));
    group.adults -= share; left -= share;
    group.households = Math.min(group.households, group.adults + group.children);
  }
  c.cohorts = c.cohorts.filter(g => g.households > 0);
  while (s.workers.filter(w => w.resident && w.region === 'heartland').length > workingAdults(s)) {
    const w = [...s.workers].reverse().find(x => x.resident && x.region === 'heartland')!;
    s.workers.splice(s.workers.indexOf(w), 1);
    for (const m of s.machines) if (m.driver === w.id) m.driver = null;
  }
  return lost;
}

function resolveCampaign(s: GameState) {
  const v = nationOf(s), war = v.campaign!, r = regionOf(s), c = communityOf(s);
  const odds = campaignOdds(s, war.target, war.stance); // today's supply and morale decide, not launch day's
  const won = random(s) < odds;
  const dead = bury(s, expectedLosses(s, war.stance, won));
  v.casualties += dead; v.weariness = clamp(v.weariness + .15, 0, 1); c.happiness = clamp(c.happiness - .03, 0, 1);
  let spoils = 0;
  const target = r.neighbours[war.target], who = NEIGHBOURS[war.target];
  for (const id of NEIGHBOUR_IDS) if (id !== war.target) r.neighbours[id].trust = clamp(r.neighbours[id].trust - (war.stance === 'siege' ? 12 : 8), 0, 100);
  if (won) {
    v.wins++;
    if (war.stance === 'raid') {
      spoils = plunder(s, war.target); post(s, 'prize', spoils, `Plunder from ${REGIONS[war.target].name}`);
      v.weakened[war.target] = .5; target.trust = clamp(target.trust - 25, 0, 100);
      log(s, 'opportunity', `Your raid on ${REGIONS[war.target].name} succeeded: $${Math.round(spoils).toLocaleString()} taken, ${dead} soldiers lost.`, 'nation');
    } else {
      v.weakened[war.target] = .8; target.trust = 30; target.treaty = true;
      v.vassal = { from: war.target, until: s.tick + 90 * 24, daily: vassalDaily(s, war.target) };
      if (r.demand?.from === war.target) r.demand = null;
      log(s, 'opportunity', `${who.leader} yields. ${REGIONS[war.target].name} pays tribute for 90 days and trades without tariffs. ${dead} soldiers lost.`, 'nation');
    }
  } else {
    v.losses++; v.weariness = clamp(v.weariness + .1, 0, 1); c.happiness = clamp(c.happiness - .05, 0, 1);
    target.trust = clamp(target.trust - 10, 0, 100);
    spoils = -Math.min(Math.max(0, s.cash), indemnity(s, war.target));
    if (spoils < 0) post(s, 'diplomacy', spoils, `War indemnity to ${REGIONS[war.target].name}`);
    log(s, 'warning', `Defeat at ${REGIONS[war.target].name}. ${dead} soldiers lost and an indemnity paid. Rations, drills and morale decide the odds.`, 'nation');
  }
  if (NEIGHBOUR_IDS.filter(id => r.neighbours[id].trust < 25).length >= 2) { r.bandits = clamp(r.bandits + .2, 0, 1); log(s, 'warning', 'Neighbours are uniting against your army. Expect more raids on your caravans.', 'nation'); }
  v.history.push({ day: day(s), target: war.target, stance: war.stance, won, lost: dead, spoils }); v.history = v.history.slice(-12);
  v.campaign = null;
}

export function nationDaily(s: GameState) {
  if (!nationActive(s) || s.tick % 24 !== 0) return;
  const v = nationOf(s), today = day(s), c = communityOf(s);
  if (v.lastDay === today) return;
  v.lastDay = today;
  if (v.drillUntil >= 0 && s.tick >= v.drillUntil) { v.drill++; v.drillUntil = -1; log(s, 'opportunity', `${DRILLS[v.drill - 1].name} complete. Your army fights at ${drillPower(v.drill)}× strength.`, 'nation'); }
  // Rations: grain or bread from spare stock; an unfed army loses strength.
  const n = soldiers(s), need = n * RATIONS_PER_SOLDIER * (v.campaign ? 1.5 : 1);
  let eaten = 0;
  for (const g of RATION_GOODS) {
    if (eaten >= need) break;
    const inv = s.regions.heartland.inventory;
    const take = Math.min(need - eaten, Math.max(0, inv[g] - reservedStock(s, 'heartland', g) - larderReserve(s, g)));
    inv[g] -= take; eaten += take;
  }
  v.supply = need > 0 ? clamp(eaten / need, 0, 1) : 1;
  v.morale = clamp(v.morale + (clamp(c.happiness - .6 * v.weariness + .5 * (v.supply - 1), 0, 1) - v.morale) * .1, 0, 1);
  if (!v.campaign) v.weariness = Math.max(0, v.weariness - .005);
  for (const id of NEIGHBOUR_IDS) v.weakened[id] = Math.max(0, v.weakened[id] - .01);
  if (v.vassal) {
    if (s.tick >= v.vassal.until) { log(s, 'info', `${REGIONS[v.vassal.from].name} has paid its last tribute.`, 'nation'); v.vassal = null; }
    else post(s, 'prize', v.vassal.daily, `Tribute from ${REGIONS[v.vassal.from].name}`);
  }
  if (v.campaign && s.tick >= v.campaign.ends) resolveCampaign(s);
}

function action(s: GameState, a: Action): ActionResult | null {
  if (!['startNation', 'launchCampaign', 'trainArmy'].includes(a.type)) return null;
  const v = nationOf(s), fail = (error: string): ActionResult => ({ ok: false, error });
  if (a.type === 'startNation') {
    if (a.path !== 'army') return fail('The Alliance and Neutrality paths arrive in a later update.');
    if (!canStartNation(s)) return fail('Answer a rival’s demand in the Region chapter first.');
    v.active = true; v.path = a.path; v.enteredAt = s.tick; s.stageId = 'nation'; s.eraReady = false;
    s.values.orderFreedom = clamp(s.values.orderFreedom + 8, 0, 100);
    log(s, 'opportunity', 'Build barracks, keep them fed and drilled. Every soldier is a worker your farm and town no longer have.', 'nation');
    return { ok: true };
  }
  if (!v.active) return fail('Begin the Nation chapter first.');
  if (a.type === 'trainArmy') {
    const next = DRILLS[v.drill];
    if (!next) return fail('Your army has every drill.');
    if (v.drillUntil >= 0) return fail('A drill is already under way.');
    const cost = drillCost(s), t = townOf(s);
    if (t.cash < cost) return fail('Fund the treasury before the drill.');
    post(s, 'research', -cost, `Army: ${next.name}`, 'heartland', 'corporate', 'town');
    v.drillUntil = s.tick + next.days * 24; return { ok: true };
  }
  if (a.type === 'launchCampaign') {
    if (v.campaign) return fail('A campaign is already under way.');
    if (!isNeighbour(a.target) || (a.stance !== 'raid' && a.stance !== 'siege')) return fail('Choose a target and a stance.');
    if (soldiers(s) < 1) return fail('Staff and fund barracks first.');
    if (v.vassal?.from === a.target) return fail(`${REGIONS[a.target].name} already pays you tribute.`);
    const odds = campaignOdds(s, a.target, a.stance);
    v.campaign = { id: nextId(s), target: a.target, stance: a.stance, started: s.tick, ends: s.tick + CAMPAIGN_DAYS[a.stance] * 24, odds, soldiers: soldiers(s) };
    regionOf(s).neighbours[a.target].trust = clamp(regionOf(s).neighbours[a.target].trust - 15, 0, 100);
    log(s, 'warning', `Your army marches on ${REGIONS[a.target].name}. Caravans there are halted until it returns.`, 'nation');
    return { ok: true };
  }
  return null;
}

export const nation: StageModule = {
  id: 'nation', title: 'Nation', legacyEras: [8],
  eraUnlocks: { 8: (s) => lifetimeSales(s) >= 300_000_000 },
  actionTypes: ['chooseEvent', 'takeLoan', 'repayLoan', 'startNation', 'launchCampaign', 'trainArmy'],
  tips: ['era8'], discoveries: ['nationReady', 'nationVictory'],
  tick: nationDaily, handleAction: action, createState: () => createNationState() as unknown as Record<string, unknown>,
};
