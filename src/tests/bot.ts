import {canStartCity} from '../simulation/stages/city';
import {cityActive,cityOf} from '../simulation/city-state';
import { canStartTown, serviceAvailable, serviceDailyCost, plannedServiceCost } from '../simulation/stages/town';
import { districtPopulation, SERVICE_DEFS, servicePrice, townOf } from '../simulation/town-state';
import { DISTRICT_IDS } from '../simulation/types';
// A competent player, used by balancing tests to drive the real engine through every era.
import { CONFIG, CROPS, REGION_IDS, type BuildingType, type CropId, type GoodId, type RegionId } from '../simulation/config';
import { avg30, dispatch, homePlotPrice, isManual, isReady, parcelPrice, totalHa } from '../simulation/engine';
import { seasonOf, stored } from '../simulation/core';
import { communityOf, population, homeCapacity, availableResidents } from '../simulation/community-state';
import { clearCost, findSpot, frontierPatches, worldOf } from '../simulation/world';
import { canStartSettlement, larderReserve } from '../simulation/stages/settlement';
import type { GameState } from '../simulation/types';

export type Strategy = 'balanced' | 'volume' | 'processor' | 'idle';

const count = (s: GameState, r: RegionId, t: string) => s.machines.filter((m) => m.region === r && m.type === t).length;
const haIn = (s: GameState, r: RegionId) => s.fields.reduce((a, f) => a + (f.region === r ? f.ha : 0), 0);
const hasB = (s: GameState, r: RegionId, t: BuildingType) => s.buildings.some((b) => b.region === r && b.type === t);

/** A sensible player keeps this year's profit tax in hand (the game warns 14 days ahead). */
const taxDue = (_s: GameState) => 0; // no profit tax any more

export function botAct(s: GameState, strategy: Strategy = 'balanced', civicPriority = false) {
  if (strategy === 'idle') return;
  if (s.bankrupt) {
    dispatch(s, { type: 'restructure' });
    return;
  }
  const P = s.automation.policies;
  const civic = civicPriority && communityOf(s).active;
  const civicReady = !civic || (townOf(s).active && townOf(s).education >= .8 && townOf(s).water >= .8 && townOf(s).cash >= plannedServiceCost(s) * 14 && (!cityActive(s)||cityOf(s).sanitation>=.7));
  if (!s.legacyProgression && canStartSettlement(s)) dispatch(s, { type: 'startSettlement', charter: 'free' });
  const settled = townOf(s).active && townOf(s).education >= .6 && townOf(s).water >= .6;
  const homeGap = cityActive(s) ? 16 : 8;
  if ((!civicPriority || (!townOf(s).active && population(s)<100) || townOf(s).active && (civicReady || settled || availableResidents(s)<4)) && communityOf(s).active && homeCapacity(s) - population(s) < homeGap && s.cash > 15000 * s.macro.cpi) {
    const tier = population(s) < 40 ? 'cottage' : 'terrace';
    dispatch(s, { type: 'buildHomes', tier, count: 1 });
  }
  if (s.eraReady) {
    if (!s.legacyProgression && s.stageId === 'homestead' && !s.charters.trader) dispatch(s, { type: 'chooseCharter', charter: 'fair' });
    dispatch(s, { type: 'advanceEra' });
  }
  // Homestead: work small plots by hand until there are workers.
  if (!s.workers.some((w) => w.role === 'hand')) for (const f of s.fields) {
    if (!isManual(f)) continue;
    if (isReady(s, f)) dispatch(s, { type: 'harvest', fieldId: f.id });
    if (!f.crop) dispatch(s, { type: 'plant', fieldId: f.id, crop: bestCrop(s, 'heartland') });
  }
  if (s.tick % 3 === 0) sell(s);
  if (s.era < 3 && s.regions.heartland.homePlotsBought < 16 && s.cash > homePlotPrice(s) * 1.3 && homePlotPrice(s) < 6000) dispatch(s, { type: 'buyPlot' });
  if (s.tick % 6 !== 0) return; // management decisions a few times a day
  // Keep room to grow: clear forest at the edge of the farm when a big field no longer fits.
  for (const r of REGION_IDS) {
    if (!s.regions[r].unlocked || worldOf(s, r).queue.length) continue;
    if (!findSpot(s, r, { w: 10, d: 10 }) && s.cash > clearCost(s) * 9 * 3) dispatch(s, { type: 'clearForest', region: r, chunks: frontierPatches(s, r, 9) });
  }

  for (const r of REGION_IDS) {
    if (!s.regions[r].unlocked) continue;
    const ha = haIn(s, r);
    if (s.era >= 2 && ha > 0) {
      for (const f of s.fields) if (f.region === r && !f.plan) dispatch(s, { type: 'setPlan', fieldIds: [f.id], crop: bestCrop(s, r) });
      const mech = count(s, r, 'tractor') > 0 && count(s, r, 'harvester') > 0;
      const hands = s.workers.filter((w) => w.region === r && w.role === 'hand').length;
      const want = Math.ceil(ha / (mech ? 18 : 3.5));
      if (hands < want && s.cash > 500) dispatch(s, { type: 'hire', region: r, role: 'hand', wageFactor: cityActive(s)?1.1:1.05 });
      // A competent mechanised farm reassigns its labour budget instead of retaining
      // the entire old manual crew forever while buying and leasing machines.
      if (mech && hands > want) {
        const crew=s.workers.filter(w=>w.region===r&&w.role==='hand');
        const spare=crew.find(w=>!w.task)??crew[crew.length-1];
        dispatch(s,{type:'fire',workerId:spare.id});
      }
      const st = stored(s, r);
      const stores = s.buildings.filter(b => b.region === r && (b.type === 'barn' || b.type === 'silo')).length;
      if (st.dry > st.cap.dry * 0.7 && stores < Math.ceil(ha / 10)) dispatch(s, { type: 'build', region: r, building: s.cash > 40000 ? 'silo' : 'barn' });
    }
    if (s.era >= 3 && ha > 0) {
      if (ha >= (s.legacyProgression ? 15 : 6) && !s.workers.some((w) => w.region === r && w.role === 'manager') && s.cash > 8000) dispatch(s, { type: 'hire', region: r, role: 'manager', wageFactor: 1 });
      if (ha >= 12 && count(s, r, 'tractor') < Math.ceil(ha / 80)) dispatch(s, { type: 'buyMachine', region: r, machine: 'tractor', lease: s.cash < 30000 });
      if (ha >= 12 && count(s, r, 'harvester') < Math.ceil(ha / 70)) dispatch(s, { type: 'buyMachine', region: r, machine: 'harvester', lease: s.cash < 80000 });
    }
  }
  if (s.era >= 3) {
    Object.assign(P, { autoRotate: true, autoFertilize: true, autoRepair: 0.45, sellDiscipline: 0, cashReserve: 0 });
    const parcel = strategy === 'volume' ? 25 : s.cash > 300000 ? 25 : 5;
    const cap = strategy === 'volume' ? 3000 : civic ? 600 : 1200;
    const needsChain = !s.legacyProgression && s.stageId === 'industry' && (!hasB(s, 'heartland', 'lab') || (strategy !== 'volume' && !hasB(s, 'heartland', 'flourMill')));
    if (civicReady && !needsChain && s.cash > parcelPrice(s, 'heartland', parcel) * 1.5 + 15000 && totalHa(s) < cap) dispatch(s, { type: 'buyParcel', region: 'heartland', ha: parcel });
    for (const l of s.loans) if (s.cash > 100000) dispatch(s, { type: 'repayLoan', loanId: l.id, amount: Math.min(l.balance, s.cash - 80000) });
  }
  if (s.era >= 4 && civicReady) {
    if (!hasB(s, 'heartland', 'lab') && s.cash > 45000) dispatch(s, { type: 'build', region: 'heartland', building: 'lab' });
    if (!s.research.active) for (const t of ['farmSoftware', 'improvedSeeds', 'soilTesting', 'mech2', 'solar', 'processEfficiency', 'routeOptimization', 'dripIrrigation', 'predictiveMaintenance', 'coldChain', 'advancedLab'])
      if (dispatch(s, { type: 'research', tech: t }).ok) break;
    if (strategy !== 'volume') {
      if (!hasB(s, 'heartland', 'flourMill') && s.cash > 37500) dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
      if (strategy === 'processor') for (const b of ['feedMill', 'warehouse', 'bakery', 'ranch'] as BuildingType[]) if (!hasB(s, 'heartland', b) && s.cash > 150000) dispatch(s, { type: 'build', region: 'heartland', building: b });
    }
    if (s.tick % 6 === 0) for (const g of ['flour', 'feed', 'bread', 'meat', 'milk'] as GoodId[]) if (s.regions.heartland.inventory[g] > 10) dispatch(s, { type: 'sell', region: 'heartland', good: g, qty: Math.min(s.regions.heartland.inventory[g], s.markets.heartland[g]!.d0) });
  }
  if (s.era >= 6 && civicReady) {
    for (const r of ['river', 'tropics'] as RegionId[]) if (!s.regions[r].unlocked && s.cash > 250000) dispatch(s, { type: 'unlockRegion', region: r });
    for (const r of ['river', 'tropics'] as RegionId[]) if (s.regions[r].unlocked && s.cash > parcelPrice(s, r, 25) * 2 + 50000 && haIn(s, r) < 600) dispatch(s, { type: 'buyParcel', region: r, ha: 25 });
  }
  if (s.era >= 7 && !s.corp.incorporated) dispatch(s, { type: 'incorporate' });
}

function bestCrop(s: GameState, r: RegionId): CropId {
  let best: CropId = 'wheat', v = -Infinity;
  const cold = seasonOf(s) === 'Winter' || seasonOf(s) === 'Autumn';
  for (const c of s.unlockedCrops) {
    if ((c === 'coffee' && r !== 'tropics') || CROPS[c].perennial || (cold && !CROPS[c].frostHardy)) continue;
    const m = s.markets[r][c]!;
    const val = (CROPS[c].yieldPerSeed * m.price - CROPS[c].seedCost) / CROPS[c].growthTicks;
    if (val > v) (v = val), (best = c);
  }
  return best;
}

/** Sells in slices no bigger than a fifth of market depth, and only near or above the monthly average. */
function sell(s: GameState) {
  if (!s.legacyProgression && s.stageId === 'homestead') {
    const q = Math.floor(s.regions.heartland.inventory.wheat);
    if (q >= 1) dispatch(s, { type: 'sellToMill', qty: q });
    return;
  }
  for (const r of REGION_IDS) {
    if (!s.regions[r].unlocked) continue;
    const st = stored(s, r);
    const full = st.dry > st.cap.dry * 0.8 || s.cash < 5000; // short of cash or space: sell regardless of price
    for (const c of Object.keys(CROPS) as CropId[]) {
      const q = Math.max(0, s.regions[r].inventory[c] - (r === 'heartland' ? larderReserve(s, c) : 0));
      const m = s.markets[r][c]!;
      if (q < 5 || (c === 'wheat' && hasB(s, r, 'flourMill') && q < 2000)) continue;
      if (!full && m.price < avg30(s, r, c) * 0.92) continue;
      dispatch(s, { type: 'sell', region: r, good: c, qty: Math.min(q, m.d0 * CONFIG.marketDepth * 0.2) });
    }
  }
}

/** Civic player: extends the farm policy with public funding and placed services. */
export function townBotAct(s: GameState) {
  botAct(s, 'balanced', true);
  if(s.bankrupt)return;
  if(communityOf(s).active && availableResidents(s)>0 && s.cash>2000) {
    const commuter=s.workers.find(w=>w.region==='heartland'&&!w.resident);
    if(commuter)dispatch(s,{type:'settleWorker',workerId:commuter.id});
  }
  if(canStartTown(s)&&s.cash>60000*s.macro.cpi)dispatch(s,{type:'startTown',charter:'public'});
  const t=townOf(s);if(!t.active||s.tick%6!==0)return;
  if(t.lastCost>t.lastTax*1.1&&t.taxRate<.25)dispatch(s,{type:'setTownTax',rate:.25});
  const pop=districtPopulation(s);
  for(const id of DISTRICT_IDS) {
    if(!pop[id])continue;
    for(const type of ['school','well','clinic','road'] as const) {
      if(!serviceAvailable(s,type))continue;
      const capacity=t.services.filter(b=>b.district===id&&b.type===type&&b.active).reduce((n,b)=>n+b.count*SERVICE_DEFS[type].capacity,0);
      const needed=type==='school'?pop[id]/2:type==='road'?1:pop[id];
      if(capacity>=needed)continue;
      const cost=servicePrice(s,type),reserve=serviceDailyCost(s,type)*14;
      if(t.cash<cost+reserve&&s.cash>cost+reserve+20000)dispatch(s,{type:'fundTown',amount:Math.ceil(cost+reserve-t.cash),direction:'toTown'});
      if(t.cash>=cost+reserve)dispatch(s,{type:'buildService',service:type,district:id});
    }
  }
  const need=plannedServiceCost(s)*14-t.cash, spare=s.cash-Math.max(30000*s.macro.cpi,s.automation.policies.cashReserve)-taxDue(s);
  if(need>0&&spare>0){const amount=Math.floor(Math.min(need,spare)*100)/100;if(amount>0)dispatch(s,{type:'fundTown',amount,direction:'toTown'});}
  if(t.petition)dispatch(s,{type:'answerPetition',accept:false});
}


/** Extend ordinary farm and Town choices; no goods, citizens or cash are granted. */
export function cityBotAct(s:GameState) {
  townBotAct(s);
  if(s.bankrupt)return;
  if(canStartCity(s))dispatch(s,{type:'startCity',charter:'professional'});
  if(!cityActive(s)||s.tick%6!==0)return;
  const t=townOf(s),pop=districtPopulation(s),v=cityOf(s);
  // Real equity financing bridges civic construction. Dilution and the majority
  // control floor bound this source of capital; it is never a recurring grant.
  if(s.corp.incorporated&&s.corp.playerShares/(s.corp.shares*1.2)>=.51&&s.cash<100000)dispatch(s,{type:'issueShares',pct:.2});
  const target=plannedServiceCost(s)*14;
  if(t.cash<target&&s.cash>100000*s.macro.cpi+taxDue(s)) {
    const amount=Math.floor(Math.min(s.cash-100000*s.macro.cpi-taxDue(s),target-t.cash)*100)/100;
    if(amount>0)dispatch(s,{type:'fundTown',amount,direction:'toTown'});
  }
  for(const id of DISTRICT_IDS)if(pop[id])for(const type of ['sanitation','lighting','police'] as const) {
    if(type==='police'&&v.crime<.1&&t.services.some(b=>b.type==='police'))continue;
    const capacity=t.services.filter(b=>b.type===type&&b.district===id&&b.active).reduce((n,b)=>n+b.count*SERVICE_DEFS[type].capacity,0);
    if(capacity>=pop[id])continue;
    const cost=servicePrice(s,type),reserve=serviceDailyCost(s,type)*14;
    if(t.cash<cost+reserve&&s.cash>cost+reserve+20000)dispatch(s,{type:'fundTown',amount:Math.ceil(cost+reserve-t.cash),direction:'toTown'});
    if(t.cash>=cost+reserve)dispatch(s,{type:'buildService',service:type,district:id});
  }
  if(v.case)dispatch(s,{type:'resolveCityCase',answer:'rehabilitate'});
}

// ---------------------------------------------------------------- Region and Nation, through real actions only
import { canStartRegion, protection, treatyCost, TREATY_TRUST } from '../simulation/stages/region';
import { regionActive, regionOf, NEIGHBOUR_IDS, NEIGHBOURS } from '../simulation/region-state';
import { canStartNation, campaignOdds, soldiers } from '../simulation/stages/nation';
import { nationActive, nationOf } from '../simulation/nation-state';
export function regionBotAct(s: GameState) {
  cityBotAct(s);
  if (s.bankrupt) return;
  if (canStartRegion(s)) dispatch(s, { type: 'startRegion', border: 'open' });
  if (!regionActive(s) || s.tick % 24 !== 1) return;
  const r = regionOf(s), t = townOf(s);
  // A caravan of each neighbour's wanted good when the farm has it, otherwise wheat.
  for (const id of NEIGHBOUR_IDS) if (!r.neighbours[id].route) {
    const want = NEIGHBOURS[id].wants, good = s.regions.heartland.inventory[want] > 100 ? want : 'wheat';
    dispatch(s, { type: 'setRoute', to: id, good, qty: 100 });
  }
  if (protection(s) < .5 && !t.services.some(b => b.type === 'watchtower') && t.cash > servicePrice(s, 'watchtower') + serviceDailyCost(s, 'watchtower') * 14)
    dispatch(s, { type: 'buildService', service: 'watchtower', district: 'farmgate' });
  if (r.raid) dispatch(s, { type: 'resolveRaid', answer: t.cash > 20000 * s.macro.cpi ? 'pursue' : 'absorb' });
  const best = [...NEIGHBOUR_IDS].sort((a, b) => r.neighbours[b].trust - r.neighbours[a].trust)[0];
  if (!r.neighbours[best].treaty && r.neighbours[best].trust >= TREATY_TRUST && s.cash > treatyCost(s) * 3) dispatch(s, { type: 'signTreaty', to: best });
  const cold = [...NEIGHBOUR_IDS].filter(id => r.neighbours[id].route).sort((a, b) => r.neighbours[a].trust - r.neighbours[b].trust)[0];
  if (cold) dispatch(s, { type: 'giftNeighbour', to: cold, kind: 'goods' });
  if (r.demand) dispatch(s, { type: 'answerDemand', answer: s.cash > r.demand.amount * 3 ? 'pay' : 'refuse' });
}
export function nationBotAct(s: GameState) {
  regionBotAct(s);
  if (s.bankrupt) return;
  if (canStartNation(s)) dispatch(s, { type: 'startNation', path: 'army' });
  if (!nationActive(s) || s.tick % 24 !== 2) return;
  const v = nationOf(s), t = townOf(s);
  const companies = t.services.filter(b => b.type === 'barracks').reduce((n, b) => n + b.count, 0);
  const gap = Math.ceil(servicePrice(s, 'barracks') + (plannedServiceCost(s) + serviceDailyCost(s, 'barracks')) * 14 - t.cash + 100);
  if (companies < 2 && gap > 0 && s.cash > gap + 100000 * s.macro.cpi) dispatch(s, { type: 'fundTown', amount: gap, direction: 'toTown' });
  if (companies < 2 && soldiers(s) >= companies * 20 && t.cash > servicePrice(s, 'barracks') + plannedServiceCost(s) * 14)
    dispatch(s, { type: 'buildService', service: 'barracks', district: 'farmgate' });
  if (soldiers(s) && v.drillUntil < 0 && v.drill < 1) dispatch(s, { type: 'trainArmy' });
  if (!v.campaign && soldiers(s) && v.supply >= 1) {
    const target = [...NEIGHBOUR_IDS].sort((a, b) => campaignOdds(s, b, 'raid') - campaignOdds(s, a, 'raid'))[0];
    if (campaignOdds(s, target, 'raid') >= .6) dispatch(s, { type: 'launchCampaign', target, stance: 'raid' });
  }
}
