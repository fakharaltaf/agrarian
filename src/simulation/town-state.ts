// Bounded structural snapshots shared by the economy, stage and UI. No engine imports.
import { cityActive, policeJobs } from './city-state';
import { BUILDINGS, type RegionId } from './config';
import { communityOf, workingAdults, population, residentWorkers, neighbourJobs } from './community-state';
import type { DistrictId, GameState, ParkKind, ServiceType, ShopType, TownState } from './types';
import type { GoodId } from './config';
import { COMPLEX_NEED, MALL_NEED, MARKET_NEED, NO_NEED, OFFICE_NEED, PARKING_NEED, type LaneNeed } from './access';
export const SERVICE_DEFS: Record<ServiceType, { name: string; icon: string; cost: number; capacity: number; jobs: number; kwh: number }> = {
  sanitation: {name:'Sanitation works',icon:'🚿',cost:55000,capacity:500,jobs:4,kwh:12},
  lighting: {name:'Power station',icon:'⚡',cost:40000,capacity:400,jobs:2,kwh:24},
  police: {name:'Watchhouse',icon:'🛡',cost:65000,capacity:300,jobs:6,kwh:8},
  shopBaker: {name:"Baker's shop",icon:'🥖',cost:14000,capacity:1e12,jobs:2,kwh:3},
  shopDairy: {name:'Dairy shop',icon:'🥛',cost:16000,capacity:1e12,jobs:2,kwh:5},
  shopButcher: {name:'Butcher',icon:'🥩',cost:16000,capacity:1e12,jobs:2,kwh:5},
  shopGrocer: {name:'Greengrocer',icon:'🍎',cost:12000,capacity:1e12,jobs:2,kwh:2},
  shopGeneral: {name:'General store',icon:'🧺',cost:15000,capacity:1e12,jobs:2,kwh:2},
  mall: {name:'Mall',icon:'🏬',cost:250000,capacity:1e12,jobs:20,kwh:60},
  office: {name:'Office',icon:'🏢',cost:90000,capacity:1e12,jobs:0,kwh:30},
  parking: {name:'Parking complex',icon:'🅿',cost:70000,capacity:1e12,jobs:2,kwh:4},
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
export const SERVICE_RADIUS: Partial<Record<ServiceType, number>> = { school: 12, clinic: 12, hospital: 22, well: 8, waterworks: 20, waterTower: 14, sanitation: 12, lighting: 16, police: 14, park: 8, parking: 8, shopBaker: 10, shopDairy: 10, shopButcher: 10, shopGrocer: 10, shopGeneral: 10 };
/** City shops, and what each sells per resident per day to the homes in its reach. */
export const SHOP_GOODS: Record<ShopType, Partial<Record<GoodId, number>>> = {
  shopBaker: { bread: 0.6, flour: 0.1 }, shopDairy: { milk: 0.5, cheese: 0.06, butter: 0.05 }, shopButcher: { meat: 0.08 },
  shopGrocer: { potatoes: 0.3, apples: 0.2, greens: 0.1, corn: 0.1, rice: 0.1 }, shopGeneral: { sugar: 0.05, soyoil: 0.03, coffee: 0.02, wool: 0.01, cotton: 0.01 },
};
export const SHOP_TYPES = Object.keys(SHOP_GOODS) as ShopType[];
export const isShop = (t: ServiceType): t is ShopType => t in SHOP_GOODS;
/** Four shops of a kind in a 2×2 block merge into its market; four markets into the mall. */
export const MARKET_NAME: Record<ShopType, string> = { shopBaker: "Bakers' hall", shopDairy: 'Dairy hall', shopButcher: 'Meat market', shopGrocer: "Farmers' market", shopGeneral: 'Commercial market' };
export const svcSize = (b: { size?: number }) => b.size ?? 1;
/** Tiles a side: a shop is 3; a market takes its four shops and the lanes between them (7); the mall its four markets (15). */
export const svcSide = (b: { size?: number }) => (svcSize(b) >= 4 ? 15 : svcSize(b) === 2 ? 7 : 3);
/** What four of a town building become when they stand in a square and merge: one bigger place that reaches further (or serves a quarter more families). */
export const MERGED_NAME: Partial<Record<ServiceType, string>> = { school: 'School campus', clinic: 'Health centre', hospital: 'General hospital', well: 'Pump house', waterTower: 'Reservoir', waterworks: 'Water treatment works', sanitation: 'Sanitation plant', lighting: 'Power plant', police: 'Police headquarters', park: 'City park' };
export const serviceName = (b: { type: ServiceType; size?: number }) => (svcSize(b) >= 2 ? (isShop(b.type) ? MARKET_NAME[b.type] : MERGED_NAME[b.type] ?? SERVICE_DEFS[b.type].name) : SERVICE_DEFS[b.type].name);
/** A market draws a quarter more custom than shops do; a mall a little more again for each extra trade inside. */
export const shopPull = (b: { type: ServiceType; size?: number; kinds?: ShopType[] }) => (b.type === 'mall' ? 1.25 * (1 + 0.05 * Math.max(0, (b.kinds?.length ?? 1) - 1)) : svcSize(b) >= 2 ? 1.25 : 1);
export const sellsKind = (b: { type: ServiceType; kinds?: ShopType[] }, kind: ShopType) => b.type === kind || (b.type === 'mall' && !!b.kinds?.includes(kind));
/** What merging costs: a quarter of what the four cost to build. */
export const mergePrice = (group: { cost: number }[]) => Math.round(group.reduce((n, b) => n + b.cost, 0) * 0.25);
/** The best square of four this shop (or market) could merge in, each a lane apart: who is already in place, and where the block starts. */
export function mergeGroup(s: GameState, id: number) {
  const t = townOf(s), b = t.services.find((x) => x.id === id), pos = (s.world?.heartland?.pos ?? {}) as Record<string, [number, number]>, p = b && pos[`svc:${b.id}`];
  if (!b || !p || svcSize(b) > 2 || !(isShop(b.type) || (MERGED_NAME[b.type] && svcSize(b) === 1))) return null;
  const shop = isShop(b.type), step = svcSide(b) + 1;
  const fits = (x: typeof b) => (shop ? isShop(x.type) && svcSize(x) === svcSize(b) && (svcSize(b) === 2 || x.type === b.type) : x.type === b.type && svcSize(x) === 1 && levelOf(x) === levelOf(b));
  let best: { origin: [number, number]; members: typeof t.services; step: number } | null = null;
  for (const i of [0, 1]) for (const j of [0, 1]) {
    const o: [number, number] = [p[0] - i * step, p[1] - j * step];
    const members = [0, 1, 2, 3].map((k) => t.services.find((x) => fits(x) && pos[`svc:${x.id}`]?.[0] === o[0] + (k % 2) * step && pos[`svc:${x.id}`]?.[1] === o[1] + Math.floor(k / 2) * step)).filter(Boolean) as typeof t.services;
    if (!best || members.length > best.members.length) best = { origin: o, members, step };
  }
  return best && { ...best, complete: best.members.length === 4, into: !shop ? MERGED_NAME[b.type]! : svcSize(b) === 2 ? 'Mall' : MARKET_NAME[b.type as ShopType], price: mergePrice(best.members) };
}
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
  const t=townOf(s); return r==='heartland' && t.active ? (1 + t.factoryShare * (.08*t.education*(t.charter==='trade' && s.tick>=t.retrainingUntil ? 1 : .3) - .1*(1-t.health))) : 1;
};
export function factoryJobs(s: GameState) {
  return s.buildings.reduce((n,b)=>n+(b.active && b.region==='heartland' ? Math.ceil(BUILDINGS[b.type].staffPerHour * (1+.3*(b.level-1)) * (b.size===4?3.2:b.size===2?1.8:1)/12)*2 : 0),0);
}
/** Services that reach homes as a heat map round the building: full within their reach, then fading out beyond it. */
export const HEAT_SERVICES: ServiceType[] = ['school', 'clinic', 'well', 'police', 'park'];
/** Parks: gardens lift happiness, a sports ground health, a playground keeps the young out of trouble. */
export const PARK_KINDS: Record<ParkKind, { name: string; icon: string; does: string }> = {
  garden: { name: 'Gardens', icon: '🌷', does: 'Families in reach are happier' },
  play: { name: 'Playground', icon: '🎠', does: 'Less crime on the streets in reach' },
  sport: { name: 'Sports ground', icon: '⚽', does: 'Families in reach are healthier' },
};
/** Up to this much from parks when every family is in reach of a top-level one: +happiness, +health, −crime pressure. */
export const PARK_EFFECT = { garden: 0.05, sport: 0.06, play: 0.08 };
/** Services that reach homes only along their lines, and serve a set number of families. */
export const UTILITY_OF: Partial<Record<ServiceType, import('./world').UtilityNet>> = { lighting: 'power', waterTower: 'water', waterworks: 'water', sanitation: 'sewer' };
export const UTILITY_FAMILIES: Partial<Record<ServiceType, number>> = { lighting: 12, waterTower: 10, waterworks: 40, sanitation: 12 };
/** Level 1–3: how far a heat-map service reaches, how many families a utility serves, and how much a service can take on. */
const LEVEL_REACH = [1, 1.5, 2], LEVEL_FAMILIES = [1, 2, 3.5], LEVEL_CAPACITY = [1, 1.6, 2.2];
export const levelOf = (b: { level?: number }) => Math.max(1, Math.min(3, b.level ?? 1));
export const serviceRadius = (b: { type: ServiceType; level?: number; size?: number }) => (b.type === 'mall' ? 60 : (SERVICE_RADIUS[b.type] ?? 10) * (svcSize(b) >= 2 ? 1.8 : 1)) * LEVEL_REACH[levelOf(b) - 1];
export const utilityFamilies = (b: { type: ServiceType; level?: number; count: number; size?: number }) => (UTILITY_FAMILIES[b.type] ?? 0) * b.count * LEVEL_FAMILIES[levelOf(b) - 1] * (svcSize(b) >= 2 ? 1.25 : 1);
export const levelCapacity = (b: { level?: number; size?: number }) => LEVEL_CAPACITY[levelOf(b) - 1] * (svcSize(b) >= 2 ? 1.25 : 1);
export const canUpgradeService = (type: ServiceType) => HEAT_SERVICES.includes(type) || !!UTILITY_OF[type] || type === 'office' || type === 'mall' || type === 'parking';
/** What street a town building needs at its door, by what it is and how big. */
export function serviceNeed(b: { type: ServiceType; level?: number; size?: number }): LaneNeed {
  if (b.type === 'office') return OFFICE_NEED[levelOf(b) - 1];
  if (b.type === 'mall') return MALL_NEED;
  if (b.type === 'parking') return PARKING_NEED;
  if ((b.size ?? 1) >= 2) return isShop(b.type) ? MARKET_NEED : COMPLEX_NEED;
  return NO_NEED;
}
/** Share of the cars a parking complex takes off the streets in its reach, by level. */
export const PARKING_SHARE = [0.35, 0.5, 0.65];
/** A service's reach is measured along the roads: a little more than as the crow flies, since streets turn corners. */
export const ROAD_REACH = 1.3;
/** Desks outside firms fill with your residents, by office level; a mall's tower (its level 2) holds as many as a mid-rise. */
export const OFFICE_JOBS = [20, 50, 120];
export const officeJobs = (b: { type: ServiceType; level?: number; count: number }) => (b.type === 'office' ? OFFICE_JOBS[levelOf(b) - 1] * b.count : b.type === 'mall' && levelOf(b) >= 2 ? OFFICE_JOBS[1] : 0);
export const serviceUpgradePrice = (s: GameState, b: { type: ServiceType; level?: number; count: number }) => Math.round(SERVICE_DEFS[b.type].cost * b.count * [0.8, 1.5][levelOf(b) - 1] * s.macro.cpi * 100) / 100;
/** A heat-map service fades out over this much more than its full reach. */
export const HEAT_FADE = 0.75;
/** How well a heat-map service reaches a home this far from it: fully within its reach, fading to nothing over the next three quarters of it. */
export const heatAt = (d: number, r: number) => (d <= r ? 1 : Math.max(0, 1 - (d - r) / (HEAT_FADE * r)));
export const servicePrice = (s: GameState, type: ServiceType) => Math.round(SERVICE_DEFS[type].cost*s.macro.cpi*100)/100;
export const schoolChangeCost = (s: GameState) => Math.round(20000*s.macro.cpi*100)/100;
export const townWorkforce = (s: GameState) => Math.max(0, workingAdults(s)-residentWorkers(s));

export const serviceJobs=(s:GameState,type:ServiceType)=>type==='police'&&cityActive(s)?policeJobs(s):SERVICE_DEFS[type].jobs;
