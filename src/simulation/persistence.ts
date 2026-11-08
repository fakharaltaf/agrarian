import { createCityState, POLICE_CHARTERS }  from './city-state';
import { emptyProductionReport } from './production-report';
// Pure save validation and migration, shared by the browser and regression tools.
import { CROPS, CROP_IDS, GOOD_IDS, REGION_IDS } from './config';
import { createMarkets } from './markets';
import { stageIdForEra, STAGES, STAGE_IDS } from './stages';
import type { GameState } from './types';
import type { CivicService, CommunityHome, HouseholdCohort } from './types';
import { createTownState } from './town-state';
import { createRegionState, NEIGHBOUR_IDS, type RegionState } from './region-state';
import { createNationState, type NationState } from './nation-state';
import { createSettlementState } from './community-state';
export const SAVE_VERSION = 12;
export interface SaveFile { version: number; savedAt: number; paused?: boolean; game: GameState }

/** Trust boundary: stored or imported JSON may be stale, hand-edited or corrupt. */
export function parseSave(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid save.');
  }
  const f = raw as Partial<SaveFile> & { game?: { version?: number } };
  if (!f || typeof f !== 'object' || !f.game) throw new Error('That file is not an Agrarian save.');
  const g = migrate(f.game as unknown as Omit<GameState, 'version'> & { version: number });
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  if (![g.tick, g.cash, g.rng, g.seed, g.era].every(finite)) throw new Error('Save file is corrupt.');
  if (!Array.isArray(g.fields) || !g.fields.length || !g.regions || !g.markets) throw new Error('Save file is incomplete.');
  for (const r of REGION_IDS) {
    if (!g.regions[r]) throw new Error('Save file is missing a region.');
    for (const gd of GOOD_IDS) if (!finite(g.regions[r].inventory[gd]) || g.regions[r].inventory[gd] < -1e-6) throw new Error('Save file inventory is corrupt.');
  }
  for (const r of REGION_IDS) {
    const used=g.regions[r].retailToday;
    if(!used||typeof used!=='object'||Array.isArray(used)||Object.keys(used).some(k=>!GOOD_IDS.includes(k as typeof GOOD_IDS[number]))||Object.values(used).some(q=>!finite(q)||q<0))throw new Error('Save file retail allowance is corrupt.');
  }
  for (const c of CROP_IDS) if (!finite(g.seeds[c]) || g.seeds[c] < 0) throw new Error('Save file seed stock is corrupt.');
  const numericMap = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(finite);
  const validDay = (v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const row = v as Record<string, unknown>;
    return ['day','hours','batches','capacity','earn','inputs','staff','power','alternative'].every(k => finite(row[k]))
      && Number.isInteger(row.day) && Number.isInteger(row.hours) && Number(row.hours) >= 0 && Number(row.hours) <= 24
      && numericMap(row.qty) && numericMap(row.values) && numericMap(row.reasons);
  };
  for (const b of g.buildings) {
    const report = b.productionReport;
    if (!finite(report.lastBatches) || !finite(report.lastTick) || !Array.isArray(report.days)
      || report.days.length > 7 || !report.days.every(validDay) || (report.open !== null && !validDay(report.open))) {
      throw new Error('Save file production history is corrupt.');
    }
  }
  for(const employer of g.competitors)if(!finite(employer.payrollDay)||!finite(employer.payrollToday)||employer.payrollToday<0)throw new Error('Save file employer payroll is corrupt.');
  const city=g.stageState.city as unknown as ReturnType<typeof createCityState>;
  if(typeof city.autoFund!=='boolean'||typeof city.active!=='boolean'||(city.active&&city.charter===null)||(city.charter!==null&&!Object.prototype.hasOwnProperty.call(POLICE_CHARTERS,city.charter))
    ||!['rehabilitate','punish'].includes(city.justice)||!['crime','sanitation','lighting','police','prevention','training','lastDay','enteredAt','reformUntil','trainingUntil','trainingTarget','nextCaseDay','solved','rehabilitated','punished','threatAt','safeDays','neighbourJobs','neighbourPayroll','employmentDay'].every(k=>finite((city as unknown as Record<string,unknown>)[k]))
    ||!Array.isArray(city.crimeHistory)||city.crimeHistory.length>7||!city.crimeHistory.every(finite)
    ||!Array.isArray(city.caseHistory)||city.caseHistory.length>12||!Array.isArray(city.employers)||city.employers.length>g.competitors.length||city.employers.some(e=>![e.id,e.jobs,e.wages].every(finite)||!Number.isInteger(e.jobs)||e.jobs<0||e.wages<0))throw new Error('Save file civic safety state is corrupt.');
  if(!Number.isInteger(city.neighbourJobs)||city.neighbourJobs<0||city.neighbourJobs!==city.employers.reduce((n,e)=>n+e.jobs,0)||Math.abs(city.neighbourPayroll-city.employers.reduce((n,e)=>n+e.wages,0))>.01||city.employers.some(e=>!g.competitors.some(c=>c.id===e.id)))throw new Error('Save file local employment is corrupt.');
  for(const district of Object.values(city.districts))if(!district||!['farm','residential','industrial'].includes(district.zone)||![district.rezonedAt,district.sanitation,district.lighting,district.police].every(finite))throw new Error('Save file district state is corrupt.');
  if(city.case&&(!GOOD_IDS.includes(city.case.good)||!['id','opened','deadline','lost'].every(k=>finite((city.case as unknown as Record<string,unknown>)[k]))))throw new Error('Save file civic case is corrupt.');
  const region=g.stageState.region as unknown as RegionState;
  if(typeof region.active!=='boolean'||(region.active&&!['open','walls'].includes(region.border as string))||!['enteredAt','lastDay','bandits','raids','pursued','caravans','demandDay','defiantUntil'].every(k=>finite((region as unknown as Record<string,unknown>)[k]))
    ||!NEIGHBOUR_IDS.every(id=>{const n=region.neighbours?.[id];return !!n&&[n.trust,n.delivered,n.giftDay].every(finite)&&n.trust>=0&&n.trust<=100&&typeof n.treaty==='boolean'&&(n.route===null||GOOD_IDS.includes(n.route.good)&&finite(n.route.qty)&&n.route.qty>=1);})
    ||region.raid&&(!GOOD_IDS.includes(region.raid.good)||!NEIGHBOUR_IDS.includes(region.raid.to)||![region.raid.lost,region.raid.deadline].every(finite))
    ||region.demand&&(!NEIGHBOUR_IDS.includes(region.demand.from)||![region.demand.amount,region.demand.deadline].every(finite)))throw new Error('Save file region state is corrupt.');
  const nation=g.stageState.nation as unknown as NationState;
  if(typeof nation.active!=='boolean'||(nation.active&&!['army','alliance','neutrality'].includes(nation.path as string))||!['enteredAt','lastDay','drill','drillUntil','morale','supply','weariness','wins','losses','casualties'].every(k=>finite((nation as unknown as Record<string,unknown>)[k]))
    ||!Number.isInteger(nation.drill)||nation.drill<0||nation.drill>3||!NEIGHBOUR_IDS.every(id=>finite(nation.weakened?.[id]))||!Array.isArray(nation.history)||nation.history.length>12
    ||nation.campaign&&(!NEIGHBOUR_IDS.includes(nation.campaign.target)||!['raid','siege'].includes(nation.campaign.stance)||![nation.campaign.ends,nation.campaign.odds,nation.campaign.soldiers].every(finite))
    ||nation.vassal&&(!NEIGHBOUR_IDS.includes(nation.vassal.from)||![nation.vassal.until,nation.vassal.daily].every(finite))
    ||!Array.isArray(nation.league?.members)||!nation.league.members.every(id=>NEIGHBOUR_IDS.includes(id))||new Set(nation.league.members).size!==nation.league.members.length||![nation.league.cohesion,nation.league.aid,nation.league.nextRequestDay,nation.league.nextVoteDay].every(finite)
    ||nation.league.request&&(!NEIGHBOUR_IDS.includes(nation.league.request.from)||![nation.league.request.amount,nation.league.request.deadline].every(finite))
    ||![nation.neutral?.intelUntil,nation.neutral?.mercenariesUntil,nation.neutral?.nextDisputeDay,nation.neutral?.mediated].every(finite)
    ||nation.neutral.embargo&&!NEIGHBOUR_IDS.includes(nation.neutral.embargo.target))throw new Error('Save file nation state is corrupt.');
  return { version: SAVE_VERSION, savedAt: finite(f.savedAt) ? f.savedAt! : Date.now(), paused: f.paused === true, game: g };
}

/** Upgrades older saves in place. Version 1 (the prototype) predates the full economy. */
export function migrate(g: Omit<GameState, 'version'> & { version: number }): GameState {
  if (g.version === 1) throw new Error('This save is from the early prototype and cannot be upgraded. Please start a new game.');
  if (g.version !== 2 && g.version !== 3 && g.version !== 4 && g.version !== 5 && g.version !== 6 && g.version !== 7 && g.version !== 8 && g.version !== 9 && g.version !== 10 && g.version !== 11 && g.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${g.version}.`);
  g.warned ??= {};
  g.bench ??= {};
  g.discovered ??= [];
  g.achievements ??= [];
  g.rewarded ??= [];
  g.advisor ??= false;
  g.daily ??= null;
  g.stats.plantings ??= 0;
  g.eraReady ??= false;
  g.legacyProgression ??= true;
  g.charters ??= { trader: null };
  g.charters.trader ??= null;
  g.values ??= { prosperityFairness: 50, orderFreedom: 50, peaceStrength: 50, traditionProgress: 50 };
  g.values.prosperityFairness ??= 50;
  g.values.orderFreedom ??= 50;
  g.values.peaceStrength ??= 50;
  g.values.traditionProgress ??= 50;
  if (!STAGE_IDS.includes(g.stageId)) g.stageId = stageIdForEra(g.era);
  if (!g.stageState || typeof g.stageState !== 'object' || Array.isArray(g.stageState)) g.stageState = {};
  if (!g.stageState[g.stageId] || typeof g.stageState[g.stageId] !== 'object' || Array.isArray(g.stageState[g.stageId])) {
    g.stageState[g.stageId] = STAGES[g.stageId].createState();
  }
  g.stageState.city ??= createCityState() as unknown as Record<string,unknown>;
  for(const [key,value] of Object.entries(createCityState()))g.stageState.city[key] ??= value;
  const districts=createCityState().districts;
  for(const id of Object.keys(districts) as (keyof typeof districts)[]){
    const saved=g.stageState.city.districts as Record<string,Record<string,unknown>>;
    saved[id] ??= districts[id] as unknown as Record<string,unknown>;
    for(const [key,value] of Object.entries(districts[id]))saved[id][key] ??= value;
  }
  g.stageState.nation ??= createNationState() as unknown as Record<string,unknown>;
  for(const [key,value] of Object.entries(createNationState()))g.stageState.nation[key] ??= value;
  g.stageState.region ??= createRegionState() as unknown as Record<string,unknown>;
  for(const [key,value] of Object.entries(createRegionState()))g.stageState.region[key] ??= value;
  g.stageState.town ??= createTownState() as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(createTownState())) g.stageState.town[key] ??= value;
  for (const service of g.stageState.town.services as CivicService[]) { service.count ??= 1; service.staffed ??= 0; service.funded ??= false; }
  g.stageState.settlement ??= createSettlementState() as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(createSettlementState())) g.stageState.settlement[key] ??= value;
  for (const group of g.stageState.settlement.cohorts as HouseholdCohort[]) { group.adults ??= group.households*2; group.children ??= group.households*2; }
  for (const home of g.stageState.settlement.homes as CommunityHome[]) home.count ??= 1;
  for (const [key, value] of Object.entries(STAGES[g.stageId].createState())) {
    if (g.stageState[g.stageId]![key] === undefined) g.stageState[g.stageId]![key] = value;
  }
  for(const employer of g.competitors){employer.payrollDay ??= -1;employer.payrollToday ??= 0;}
  g.herds ??= [];
  for (const worker of g.workers) worker.resident ??= false;
  g.automation.policies.autoFeed ??= true;
  g.automation.policies.autoExport ??= true;
  if (g.research.done.includes('droughtResistant')) g.research.licensed = g.research.licensed.filter((x) => x !== 'droughtLicense');
  g.automation.policies.supplyFactories ??= false;
  for (const f of g.fields) (f.supplies ??= null), (f.spreading ??= null), (f.spreadWork ??= 0), (f.planLocked ??= false), (f.greenhouse ??= false), (f.frost ??= 0), (f.cycleAt ??= 0);
  // one-time repair (Nov 2026): orchards piled up pests from a bug; clear them once, marked in `rewarded` so it never repeats
  if (!g.rewarded.includes('fix:orchardPests')) {
    for (const f of g.fields) if (f.crop && CROPS[f.crop].perennial) (f.pest = 0), (f.streak = 0);
    g.rewarded.push('fix:orchardPests');
  }
  for (const w of g.workers) w.perk ??= null;
  for (const m of g.machines) m.tier ??= 1;
  for (const b of g.buildings) {
    b.level ??= 1; b.reserved ??= 0;b.productionReport ??= emptyProductionReport();
    b.productionReport.open ??= null;b.productionReport.days ??= [];b.productionReport.lastBatches ??= 0;b.productionReport.lastTick ??= -1;
  }
  for (const r of REGION_IDS) (g.regions[r].retailToday ??= {}), (g.regions[r].forecast ??= []), (g.regions[r].quality ??= {}), (g.regions[r].frostTonight ??= false);
  // goods and crops added after the save was made start empty, with fresh markets
  const fresh = createMarkets();
  for (const r of REGION_IDS) {
    for (const gd of GOOD_IDS) g.regions[r].inventory[gd] ??= 0;
    for (const gd in fresh[r]) g.markets[r][gd as keyof typeof fresh.heartland] ??= fresh[r][gd as keyof typeof fresh.heartland];
  }
  for (const c of CROP_IDS) g.seeds[c] ??= 0;
  for (const m of g.machines) (m.util ??= 0), (m.task ??= 0), (m.driver ??= null);
  for (const w of g.workers) w.task ??= 0;
  for (const rule of g.automation.rules) if (typeof rule.lastRun !== 'number') rule.lastRun = -1e9;
  for (const r of REGION_IDS) g.regions[r].insuredFrom ??= 0;
  g.seenTips ??= [];
  for (const r of REGION_IDS) for (const k in g.markets[r]) g.markets[r][k as keyof typeof g.markets.heartland]!.impact ??= 0;
  for (const shipment of g.shipments) shipment.batchDay ??= -1;
  g.version = SAVE_VERSION;
  return g as GameState;
}

