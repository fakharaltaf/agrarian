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

// ---------------------------------------------------------------- Alliance & Neutrality
export const allyCharterCost = (s: GameState) => round2(20000 * s.macro.cpi);
export const spyCost = (s: GameState) => round2(15000 * s.macro.cpi);
export const mercenaryCost = (s: GameState) => round2(40000 * s.macro.cpi);
export const mediationCost = (s: GameState) => round2(10000 * s.macro.cpi);
export const ALLY_TRUST = 60;
/** Extra road protection from the chosen path: allied patrols, or neutral goodwill and hired swords. */
export function pathGuard(s: GameState) {
  if (!nationActive(s)) return 0;
  const v = nationOf(s);
  if (v.path === 'alliance') return Math.min(.3, .1 * v.league.members.length * v.league.cohesion);
  if (v.path === 'neutrality') return Math.min(.25, .06 * NEIGHBOUR_IDS.filter(id => regionOf(s).neighbours[id].route && v.neutral.embargo?.target !== id).length) + (s.tick < v.neutral.mercenariesUntil ? .3 : 0);
  return 0;
}
/** Neighbours your caravans must not reach today: sanctioned by the league or under your embargo. */
export const closedTo = (s: GameState, id: NeighbourId) => nationActive(s) && (nationOf(s).league.sanction?.target === id || nationOf(s).neutral.embargo?.target === id);
function answerAid(s: GameState, send: boolean): ActionResult {
  const L = nationOf(s).league, q = L.request, r = regionOf(s);
  if (!q) return { ok: false, error: 'No ally is asking for help.' };
  if (send) {
    if (q.kind === 'cash') { if (s.cash < q.amount) return { ok: false, error: 'Not enough cash.' }; post(s, 'diplomacy', -q.amount, `Aid to ${REGIONS[q.from].name}`); L.aid = round2(L.aid + q.amount); }
    else {
      const spare = (g: GoodId) => Math.max(0, s.regions.heartland.inventory[g] - reservedStock(s, 'heartland', g) - larderReserve(s, g));
      if (RATION_GOODS.reduce((n, g) => n + spare(g), 0) < q.amount) return { ok: false, error: `You need ${Math.ceil(q.amount)} spare grain or bread.` };
      let left = q.amount;
      for (const g of RATION_GOODS) { const take = Math.min(left, spare(g)); s.regions.heartland.inventory[g] -= take; left -= take; }

      L.aid = round2(L.aid + q.amount * 2 * s.macro.cpi);
    }
    r.neighbours[q.from].trust = clamp(r.neighbours[q.from].trust + 10, 0, 100); L.cohesion = clamp(L.cohesion + .08, 0, 1);
  } else { r.neighbours[q.from].trust = clamp(r.neighbours[q.from].trust - 20, 0, 100); L.cohesion = clamp(L.cohesion - .15, 0, 1); }
  L.request = null; return { ok: true };
}
function allianceDaily(s: GameState, today: number) {
  const L = nationOf(s).league, r = regionOf(s);
  L.cohesion = clamp(L.cohesion + (.6 - L.cohesion) * .01, 0, 1);
  if (L.sanction && s.tick >= L.sanction.until) L.sanction = null;
  if (L.request && s.tick >= L.request.deadline) answerAid(s, false);
  if (L.vote && s.tick >= L.vote.deadline) { L.vote = null; L.cohesion = clamp(L.cohesion - .05, 0, 1); }
  if (!L.members.length) return;
  if (!L.request && today >= L.nextRequestDay) {
    const from = L.members[Math.floor(random(s) * L.members.length)], grain = random(s) < .6;
    L.request = { from, kind: grain ? 'grain' : 'cash', amount: grain ? 400 + 100 * L.members.length : round2(15000 * s.macro.cpi), deadline: s.tick + 10 * 24 };
    L.nextRequestDay = today + 30;
    log(s, 'warning', `${NEIGHBOURS[from].leader} asks the league for help: ${grain ? `${L.request.amount} grain` : `$${Math.round(L.request.amount).toLocaleString()}`}. Allies remember who answers.`, 'nation');
  }
  if (L.members.length >= 2 && !L.vote && !L.sanction && today >= L.nextVoteDay) {
    const outsiders = NEIGHBOUR_IDS.filter(id => !L.members.includes(id)).sort((a, b) => r.neighbours[a].trust - r.neighbours[b].trust);
    if (outsiders.length) { L.vote = { target: outsiders[0], deadline: s.tick + 7 * 24 }; log(s, 'info', `The league votes on sanctions against ${REGIONS[outsiders[0]].name}.`, 'nation'); }
    L.nextVoteDay = today + 60;
  }
  if (L.cohesion < .25 && L.members.length) {
    const gone = L.members.pop()!; r.neighbours[gone].treaty = false; L.cohesion = .4;
    log(s, 'warning', `${REGIONS[gone].name} has left the league. Answer allies' requests to hold it together.`, 'nation');
  }
}
function neutralDaily(s: GameState, today: number) {
  const N = nationOf(s).neutral, r = regionOf(s);
  if (N.embargo) {
    const n = r.neighbours[N.embargo.target];
    n.trust = clamp(n.trust - .3, 0, 100);
    // Dependence on your food decides how fast they give in.
    if (today - Math.floor(N.embargo.since / 24) >= (n.delivered > 0 ? 20 : 40)) {
      r.bandits = Math.max(.1, r.bandits - .2); if (r.demand?.from === N.embargo.target) r.demand = null; n.trust = 50;
      log(s, 'opportunity', `${NEIGHBOURS[N.embargo.target].leader} concedes after the embargo. Their raiders stand down; trade can resume.`, 'nation');
      N.embargo = null;
    }
  }
  if (N.dispute && s.tick >= N.dispute.deadline) { r.bandits = clamp(r.bandits + .1, 0, 1); log(s, 'warning', `${REGIONS[N.dispute.a].name} and ${REGIONS[N.dispute.b].name} came to blows. Bandits roam the roads between them.`, 'nation'); N.dispute = null; }
  if (!N.dispute && today >= N.nextDisputeDay) {
    const [a, b] = [...NEIGHBOUR_IDS].sort(() => random(s) - .5);
    N.dispute = { a, b, deadline: s.tick + 10 * 24 }; N.nextDisputeDay = today + 45;
    log(s, 'info', `${REGIONS[a].name} and ${REGIONS[b].name} are quarrelling. A neutral mediator could earn both their trust.`, 'nation');
  }
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
  if (v.path === 'alliance') allianceDaily(s, today);
  if (v.path === 'neutrality') neutralDaily(s, today);
}

function action(s: GameState, a: Action): ActionResult | null {
  if (!['startNation', 'launchCampaign', 'trainArmy', 'inviteAlly', 'answerAid', 'castVote', 'setEmbargo', 'hireSpies', 'hireMercenaries', 'mediate'].includes(a.type)) return null;
  const v = nationOf(s), fail = (error: string): ActionResult => ({ ok: false, error });
  if (a.type === 'startNation') {
    if (a.path !== 'army' && a.path !== 'alliance' && a.path !== 'neutrality') return fail('Choose Army, Alliance or Neutrality.');
    if (!canStartNation(s)) return fail('Answer a rival’s demand in the Region chapter first.');
    v.active = true; v.path = a.path; v.enteredAt = s.tick; s.stageId = 'nation'; s.eraReady = false;
    const today = day(s); v.league.nextRequestDay = today + 20; v.league.nextVoteDay = today + 40; v.neutral.nextDisputeDay = today + 15;
    s.values.orderFreedom = clamp(s.values.orderFreedom + (a.path === 'army' ? 8 : a.path === 'neutrality' ? -6 : 0), 0, 100);
    log(s, 'opportunity', a.path === 'army' ? 'Build barracks, keep them fed and drilled. Every soldier is a worker your farm and town no longer have.'
      : a.path === 'alliance' ? `Invite neighbours who trust you (${ALLY_TRUST}+) into a league. Members guard your roads; they will ask for help in return.`
      : 'Stay unarmed and indispensable: every neighbour you feed makes you harder to attack.', 'nation');
    return { ok: true };
  }
  if (!v.active) return fail('Begin the Nation chapter first.');
  if (a.type === 'inviteAlly' || a.type === 'answerAid' || a.type === 'castVote') {
    if (v.path !== 'alliance') return fail('Only the Alliance path has a league.');
    const L = v.league, r = regionOf(s);
    if (a.type === 'answerAid') return answerAid(s, a.send);
    if (a.type === 'castVote') {
      if (!L.vote) return fail('There is no vote today.');
      if (a.yes) { L.sanction = { target: L.vote.target, until: s.tick + 60 * 24 }; r.neighbours[L.vote.target].trust = clamp(r.neighbours[L.vote.target].trust - 15, 0, 100); r.bandits = Math.max(.1, r.bandits - .15); L.cohesion = clamp(L.cohesion + .05, 0, 1); }
      else L.cohesion = clamp(L.cohesion - .1, 0, 1);
      L.vote = null; return { ok: true };
    }
    if (!isNeighbour(a.to)) return fail('Choose a neighbour.');
    if (L.members.includes(a.to)) return fail('Already in your league.');
    if (r.neighbours[a.to].trust < ALLY_TRUST) return fail(`${NEIGHBOURS[a.to].leader} needs trust ${ALLY_TRUST} first.`);
    const cost = allyCharterCost(s); if (s.cash < cost) return fail('Not enough cash.');
    post(s, 'diplomacy', -cost, `League charter with ${REGIONS[a.to].name}`); L.members.push(a.to); r.neighbours[a.to].treaty = true; L.cohesion = clamp(L.cohesion + .05, 0, 1);
    return { ok: true };
  }
  if (a.type === 'setEmbargo' || a.type === 'hireSpies' || a.type === 'hireMercenaries' || a.type === 'mediate') {
    if (v.path !== 'neutrality') return fail('Only the Neutrality path uses these tools.');
    const N = v.neutral, t = townOf(s), r = regionOf(s);
    if (a.type === 'setEmbargo') {
      if (a.target === null) { N.embargo = null; return { ok: true }; }
      if (!isNeighbour(a.target)) return fail('Choose a neighbour.');
      if (N.embargo) return fail('One embargo at a time.');
      N.embargo = { target: a.target, since: s.tick }; return { ok: true };
    }
    if (a.type === 'hireSpies') { const cost = spyCost(s); if (t.cash < cost) return fail('Fund the treasury first.'); post(s, 'civic', -cost, 'Intelligence network', 'heartland', 'corporate', 'town'); N.intelUntil = Math.max(N.intelUntil, s.tick) + 60 * 24; return { ok: true }; }
    if (a.type === 'hireMercenaries') { const cost = mercenaryCost(s); if (s.cash < cost) return fail('Not enough cash.'); post(s, 'wages', -cost, 'Mercenary company, 30 days'); N.mercenariesUntil = Math.max(N.mercenariesUntil, s.tick) + 30 * 24; return { ok: true }; }
    if (!N.dispute) return fail('No dispute to mediate.');
    const cost = mediationCost(s); if (s.cash < cost) return fail('Not enough cash.');
    post(s, 'diplomacy', -cost, 'Mediation'); for (const id of [N.dispute.a, N.dispute.b]) r.neighbours[id].trust = clamp(r.neighbours[id].trust + 10, 0, 100);
    N.mediated++; N.dispute = null; return { ok: true };
  }
  if (a.type === 'trainArmy') {
    if (v.path !== 'army') return fail('Only the Army path drills soldiers.');
    const next = DRILLS[v.drill];
    if (!next) return fail('Your army has every drill.');
    if (v.drillUntil >= 0) return fail('A drill is already under way.');
    const cost = drillCost(s), t = townOf(s);
    if (t.cash < cost) return fail('Fund the treasury before the drill.');
    post(s, 'research', -cost, `Army: ${next.name}`, 'heartland', 'corporate', 'town');
    v.drillUntil = s.tick + next.days * 24; return { ok: true };
  }
  if (a.type === 'launchCampaign') {
    if (v.path !== 'army') return fail('Only the Army path marches on neighbours.');
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
  actionTypes: ['chooseEvent', 'takeLoan', 'repayLoan', 'startNation', 'launchCampaign', 'trainArmy', 'inviteAlly', 'answerAid', 'castVote', 'setEmbargo', 'hireSpies', 'hireMercenaries', 'mediate'],
  tips: ['era8'], discoveries: ['nationReady', 'nationVictory'],
  tick: nationDaily, handleAction: action, createState: () => createNationState() as unknown as Record<string, unknown>,
};
