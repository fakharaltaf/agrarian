// Bounded structural snapshots shared by the economy, stage and UI. No engine imports.
import { cityActive, cityOf, policeJobs } from './city-state';
import { BUILDINGS, type RegionId } from './config';
import { communityOf, workingAdults, population, residentWorkers, neighbourJobs } from './community-state';
import type { DistrictId, GameState, ServiceType, TownState } from './types';
export const SERVICE_DEFS: Record<ServiceType, { name: string; icon: string; cost: number; capacity: number; jobs: number; kwh: number }> = {
  sanitation: {name:'Sanitation works',icon:'🚿',cost:55000,capacity:500,jobs:4,kwh:12},
  lighting: {name:'Power station',icon:'⚡',cost:40000,capacity:400,jobs:2,kwh:24},
  police: {name:'Watchhouse',icon:'🛡',cost:65000,capacity:300,jobs:6,kwh:8},
  school: { name: 'School', icon: '📚', cost: 30000, capacity: 80, jobs: 4, kwh: 8 },
  well: { name: 'Well', icon: '💧', cost: 8000, capacity: 100, jobs: 1, kwh: 0 },
  clinic: { name: 'Clinic', icon: '♥', cost: 45000, capacity: 150, jobs: 3, kwh: 16 },
  road: { name: 'Road', icon: '🛤', cost: 12000, capacity: 1e12, jobs: 1, kwh: 0 },
  hospital: { name: 'Hospital', icon: '🏥', cost: 180000, capacity: 800, jobs: 12, kwh: 80 },
  waterworks: { name: 'Waterworks', icon: '⛲', cost: 120000, capacity: 1500, jobs: 4, kwh: 40 },
  waterTower: { name: 'Water tower', icon: '🚰', cost: 20000, capacity: 1e12, jobs: 1, kwh: 4 },
  park: { name: 'Park', icon: '🌳', cost: 15000, capacity: 1e12, jobs: 0, kwh: 0 },
  watchtower: {name:'Watchtower & militia',icon:'🗼',cost:50000,capacity:1e12,jobs:5,kwh:2},
  barracks: {name:'Barracks',icon:'⚔',cost:120000,capacity:1e12,jobs:20,kwh:10},
};
/** How far (in tiles, centre to centre) each service reaches: homes inside the circle are served. */
export const SERVICE_RADIUS: Partial<Record<ServiceType, number>> = { school: 12, clinic: 12, hospital: 22, well: 8, waterworks: 20, waterTower: 14, sanitation: 12, lighting: 16, police: 14, park: 8 };
export const SERVICE_GROUPS = { school: ['school'], medical: ['clinic', 'hospital'], water: ['well', 'waterworks', 'waterTower'], sanitation: ['sanitation'], power: ['lighting'] } as const;
export const DISTRICT_NAMES: Record<DistrictId, string> = { farmgate: 'Farmgate', orchard: 'Orchard', heights: 'Heights' };
export function createTownState(): TownState {
  const district = () => ({ people: 0, school: 0, water: 0, medical: 0, road: 0 });
  return { active: false, enteredAt: -1, charter: null, retrainingUntil: -1,
    cash: 0, companyAdvance: 0, ledger: [], lifetime: {}, books: [], taxRate: 0.1,
    taxableIncome: 0, lastTax: 0, lastCost: 0, lastDay: -1, services: [],
    coverage: { farmgate: district(), orchard: district(), heights: district() },
    publicJobs: 0, industrialJobs: 0, factoryShare: 0, health: 1, education: 0, water: 0, roads: 0,
    petition: null, nextPetition: -1, goodwillUntil: -1, breadUntil: -1, crime: 0, thefts: 0, illnessDeaths: 0, mortalityCarry: 0 };
}
export const townOf = (s: GameState): TownState => (s.stageState.town ??= createTownState() as unknown as Record<string, unknown>) as unknown as TownState;
/** Districts are bounded cohorts on the existing fixed density streets. */
export function districtPopulation(s: GameState): Record<DistrictId, number> {
  let left = population(s);
  const by = (tier: 'cottage' | 'terrace' | 'apartment', places: number) => {
    const n = Math.min(left, communityOf(s).homes.filter(h => h.tier === tier).reduce((n,h) => n + h.count * places, 0));
    left -= n; return n;
  };
  return { farmgate: by('cottage',4), orchard: by('terrace',16), heights: by('apartment',48) };
}
export function payHouseholds(s: GameState, amount: number) {
  const paid = Math.round(Math.max(0, amount) * 100) / 100;
  const c = communityOf(s); c.householdCash = Math.round((c.householdCash + paid) * 100) / 100;
  const t = townOf(s); if (t.active) t.taxableIncome = Math.round((t.taxableIncome + paid) * 100) / 100;
}
export const localPublicJobs = (s: GameState) => townOf(s).active ? townOf(s).publicJobs : 0;
export const localIndustryJobs = (s: GameState) => townOf(s).active ? townOf(s).industrialJobs : 0;
export const localEmployment = (s: GameState) => residentWorkers(s) + localPublicJobs(s) + localIndustryJobs(s) + neighbourJobs(s);
export const townResearchFactor = (s: GameState) => {
  const t=townOf(s); return t.active && s.tick >= t.retrainingUntil ? 1 + t.education * (t.charter === 'public' ? .15 : .05) : 1;
};
export const townWorkerFactor = (s: GameState) => {
  const t=townOf(s); return t.active ? (.75 + .25*t.health) * (1 + .1*t.roads) : 1;
};
export const townIndustryFactor = (s: GameState, r: RegionId) => {
  const t=townOf(s); return r==='heartland' && t.active ? (1 + t.factoryShare * (.08*t.education*(t.charter==='trade' && s.tick>=t.retrainingUntil ? 1 : .3) - .1*(1-t.health))) * zoningFactor(s) : 1;
};
export function factoryJobs(s: GameState) {
  return s.buildings.reduce((n,b)=>n+(b.active && b.region==='heartland' ? Math.ceil(BUILDINGS[b.type].staffPerHour * (1+.3*(b.level-1))/12)*2 : 0),0);
}
/** Services that reach homes as a heat map round the building: full within their reach, then fading out beyond it. */
export const HEAT_SERVICES: ServiceType[] = ['school', 'clinic', 'well'];
/** Services that reach homes only along their lines, and serve a set number of families. */
export const UTILITY_OF: Partial<Record<ServiceType, import('./world').UtilityNet>> = { lighting: 'power', waterTower: 'water', waterworks: 'water', sanitation: 'sewer' };
export const UTILITY_FAMILIES: Partial<Record<ServiceType, number>> = { lighting: 12, waterTower: 10, waterworks: 40, sanitation: 12 };
/** Level 1–3: how far a heat-map service reaches, how many families a utility serves, and how much a service can take on. */
const LEVEL_REACH = [1, 1.5, 2], LEVEL_FAMILIES = [1, 2, 3.5], LEVEL_CAPACITY = [1, 1.6, 2.2];
export const levelOf = (b: { level?: number }) => Math.max(1, Math.min(3, b.level ?? 1));
export const serviceRadius = (b: { type: ServiceType; level?: number }) => (SERVICE_RADIUS[b.type] ?? 10) * LEVEL_REACH[levelOf(b) - 1];
export const utilityFamilies = (b: { type: ServiceType; level?: number; count: number }) => (UTILITY_FAMILIES[b.type] ?? 0) * b.count * LEVEL_FAMILIES[levelOf(b) - 1];
export const levelCapacity = (b: { level?: number }) => LEVEL_CAPACITY[levelOf(b) - 1];
export const canUpgradeService = (type: ServiceType) => HEAT_SERVICES.includes(type) || !!UTILITY_OF[type];
export const serviceUpgradePrice = (s: GameState, b: { type: ServiceType; level?: number; count: number }) => Math.round(SERVICE_DEFS[b.type].cost * b.count * [0.8, 1.5][levelOf(b) - 1] * s.macro.cpi * 100) / 100;
/** A heat-map service fades out over this much more than its full reach. */
export const HEAT_FADE = 0.75;
/** How well a heat-map service reaches a home this far from it: fully within its reach, fading to nothing over the next three quarters of it. */
export const heatAt = (d: number, r: number) => (d <= r ? 1 : Math.max(0, 1 - (d - r) / (HEAT_FADE * r)));
export const servicePrice = (s: GameState, type: ServiceType) => Math.round(SERVICE_DEFS[type].cost*s.macro.cpi*100)/100;
export const schoolChangeCost = (s: GameState) => Math.round(20000*s.macro.cpi*100)/100;
export const townWorkforce = (s: GameState) => Math.max(0, workingAdults(s)-residentWorkers(s));

export const serviceJobs=(s:GameState,type:ServiceType)=>type==='police'&&cityActive(s)?policeJobs(s):SERVICE_DEFS[type].jobs;

/** Only occupied districts affect industry; empty zones never create a free bonus. */
export function zoningFactor(s:GameState) {
  if(!cityActive(s))return 1;
  const count=districtPopulation(s),v=cityOf(s),total=population(s);
  return 1+Object.entries(count).reduce((n,[id,people])=>n+(v.districts[id as DistrictId].zone==='industrial'?.05:v.districts[id as DistrictId].zone==='residential'?-.05:0)*people/Math.max(1,total),0);
}
