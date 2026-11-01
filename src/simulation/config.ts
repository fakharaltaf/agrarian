// All balancing values live here so they can be tuned without touching engine code.
// Money is USD unless a field says "local". 1 tick = 1 in-game hour = 1 real second at 1x.

export const TICKS_PER_DAY = 24;
export const DAYS_PER_SEASON = 30;
export const DAYS_PER_YEAR = 120;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const WORK_START = 6;
export const WORK_END = 18; // workers supply labour 06:00–17:59

// ---------------------------------------------------------------- goods

export type CropId = 'wheat' | 'corn' | 'potatoes' | 'soybeans' | 'rice' | 'sugarcane' | 'cotton' | 'coffee' | 'apples' | 'grapes';
export type ProcessedId = 'flour' | 'bread' | 'feed' | 'meat' | 'milk' | 'cheese' | 'butter' | 'soyoil' | 'soymeal' | 'sugar' | 'greens' | 'eggs' | 'wool' | 'wine';
export type InputId = 'fertilizer' | 'fuel' | 'manure';
export type GoodId = CropId | ProcessedId | InputId;
export type StorageClass = 'dry' | 'cold';

export interface GoodDef {
  id: GoodId;
  name: string;
  kind: 'crop' | 'processed' | 'input';
  basePrice: number; // USD per unit at CPI = 1
  storage: StorageClass; // preferred storage
  spoilProper: number; // fraction lost per day in preferred storage
  spoilImproper: number; // per day when a cold good sits in dry storage
  elasticity: number; // price elasticity of demand (absolute)
  incomeElasticity: number;
  demand: number; // home-region consumption, units per tick at base price
  kcal: number; // calories per unit, for "people fed"
  tradeable: boolean;
  color: string;
  inputs?: Partial<Record<GoodId, number>>; // cost basis for NPC processors (propagates input-price shocks)
}

const G = (id: GoodId, name: string, kind: GoodDef['kind'], basePrice: number, storage: StorageClass, spoilProper: number, spoilImproper: number, elasticity: number, incomeElasticity: number, demand: number, kcal: number, color: string, extra: Partial<GoodDef> = {}): GoodDef =>
  ({ id, name, kind, basePrice, storage, spoilProper, spoilImproper, elasticity, incomeElasticity, demand, kcal, tradeable: true, color, ...extra });

export const GOODS: Record<GoodId, GoodDef> = {
  wheat: G('wheat', 'Wheat', 'crop', 3, 'dry', 0.001, 0.001, 0.3, 0.1, 190, 3000, '#D8AA54'),
  corn: G('corn', 'Corn', 'crop', 2.5, 'dry', 0.002, 0.002, 0.35, 0.15, 430, 3500, '#C9B23C'),
  potatoes: G('potatoes', 'Potatoes', 'crop', 2, 'cold', 0.003, 0.02, 0.3, 0.1, 620, 800, '#A8865A'),
  soybeans: G('soybeans', 'Soybeans', 'crop', 6, 'dry', 0.001, 0.001, 0.4, 0.3, 140, 4000, '#9DAA5A'),
  rice: G('rice', 'Rice', 'crop', 4, 'dry', 0.001, 0.001, 0.25, 0.1, 200, 3600, '#E6DDB8'),
  sugarcane: G('sugarcane', 'Sugarcane', 'crop', 1.2, 'dry', 0.08, 0.08, 0.5, 0.2, 700, 300, '#7FA36B'),
  cotton: G('cotton', 'Cotton', 'crop', 7, 'dry', 0, 0, 0.6, 0.8, 90, 0, '#EDE7DA'),
  coffee: G('coffee', 'Coffee', 'crop', 14, 'dry', 0.002, 0.002, 0.7, 1.0, 45, 100, '#6B4A35'),
  apples: G('apples', 'Apples', 'crop', 1.3, 'cold', 0.004, 0.03, 0.6, 0.6, 320, 520, '#C8463A'),
  grapes: G('grapes', 'Grapes', 'crop', 2.4, 'cold', 0.01, 0.06, 0.7, 0.8, 160, 690, '#6B3A6E'),
  flour: G('flour', 'Flour', 'processed', 5.5, 'dry', 0.003, 0.003, 0.35, 0.1, 130, 3600, '#EFE4C8', { inputs: { wheat: 1.25 } }),
  bread: G('bread', 'Bread', 'processed', 5.5, 'dry', 0.15, 0.15, 0.4, 0.3, 160, 2600, '#C68A4E', { inputs: { flour: 0.6 } }),
  feed: G('feed', 'Livestock feed', 'processed', 3.2, 'dry', 0.002, 0.002, 0.4, 0.2, 260, 0, '#B2A160', { inputs: { corn: 1 } }),
  meat: G('meat', 'Meat', 'processed', 55, 'cold', 0.01, 0.25, 0.8, 1.0, 14, 2500, '#B85C50', { inputs: { feed: 10 } }),
  milk: G('milk', 'Milk', 'processed', 4.5, 'cold', 0.04, 0.3, 0.5, 0.4, 150, 650, '#F4F1E8', { inputs: { feed: 0.83 } }),
  cheese: G('cheese', 'Cheese', 'processed', 55, 'cold', 0.002, 0.05, 0.9, 1.0, 10, 4000, '#E8C25A', { inputs: { milk: 9 } }),
  butter: G('butter', 'Butter', 'processed', 14, 'cold', 0.005, 0.1, 0.7, 0.7, 12, 7000, '#F2DC8C', { inputs: { milk: 3 } }),
  soyoil: G('soyoil', 'Soybean oil', 'processed', 22, 'dry', 0.001, 0.001, 0.5, 0.4, 25, 8800, '#D9B95B', { inputs: { soybeans: 2.6 } }),
  soymeal: G('soymeal', 'Soybean meal', 'processed', 4, 'dry', 0.003, 0.003, 0.5, 0.3, 80, 0, '#A89060', { inputs: { soybeans: 0.6 } }),
  sugar: G('sugar', 'Sugar', 'processed', 14, 'dry', 0, 0, 0.4, 0.3, 40, 3900, '#F7F4EE', { inputs: { sugarcane: 5 } }),
  greens: G('greens', 'Fresh greens', 'processed', 6, 'cold', 0.03, 0.3, 0.9, 1.1, 40, 200, '#6FAF5A'),
  eggs: G('eggs', 'Eggs (trays)', 'processed', 3.5, 'cold', 0.01, 0.04, 0.4, 0.3, 120, 2100, '#F1E3C6'),
  wool: G('wool', 'Wool', 'processed', 9, 'dry', 0, 0, 0.6, 0.7, 20, 0, '#E9E4D8'),
  wine: G('wine', 'Wine', 'processed', 9, 'dry', 0, 0, 0.9, 1.2, 30, 850, '#7A2A3A', { inputs: { grapes: 1.7 } }),
  fertilizer: G('fertilizer', 'Fertilizer', 'input', 1.5, 'dry', 0, 0, 0.4, 0.2, 260, 0, '#8E8E7A'),
  fuel: G('fuel', 'Diesel', 'input', 1.0, 'dry', 0, 0, 0.3, 0.4, 900, 0, '#55606A'),
  manure: G('manure', 'Manure', 'input', 0.3, 'dry', 0.01, 0.01, 1, 0, 0, 0, '#6F5338', { tradeable: false }),
};
export const GOOD_IDS = Object.keys(GOODS) as GoodId[];
export const TRADEABLE = GOOD_IDS.filter((g) => GOODS[g].tradeable);
export const GRAINS: GoodId[] = ['wheat', 'corn', 'rice']; // substitutes for one another

// ---------------------------------------------------------------- crops

export interface CropDef {
  id: CropId;
  growthTicks: number;
  seedCost: number; // USD per seed, 10 seeds per ha
  yieldPerSeed: number;
  uptake: { n: number; p: number; k: number }; // nutrients removed per harvest (negative = fixes)
  water: number; // ideal soil moisture 0..1
  optTemp: number; // °C
  tempTol: number; // °C either side before yields fall
  harvestHours: number; // labour-hours per ha by hand
  machineHarvest: boolean; // can a harvester do it
  minEra: number; // era before which the crop never appears
  unlockHarvests?: number; // homestead unlock by harvest count
  frostHardy?: boolean; // survives frost nights
  bestSeasons: Season[]; // when it grows best outdoors (shown to players; temperature drives the yield)
  perennial?: { matureDays: number; lifeYears: number }; // orchards: plant once, harvest every cycle outside winter
}
export type Season = (typeof SEASONS)[number];

export const CROPS: Record<CropId, CropDef> = {
  wheat: { id: 'wheat', growthTicks: 12, seedCost: 2, yieldPerSeed: 5, uptake: { n: 0.025, p: 0.012, k: 0.01 }, water: 0.45, optTemp: 16, tempTol: 9, harvestHours: 2, machineHarvest: true, minEra: 1, frostHardy: true, bestSeasons: ['Autumn', 'Winter', 'Spring'] },
  corn: { id: 'corn', growthTicks: 25, seedCost: 5, yieldPerSeed: 14, uptake: { n: 0.04, p: 0.018, k: 0.015 }, water: 0.55, optTemp: 22, tempTol: 9, harvestHours: 2.5, machineHarvest: true, minEra: 1, unlockHarvests: 3, bestSeasons: ['Spring', 'Summer'] },
  potatoes: { id: 'potatoes', growthTicks: 40, seedCost: 8, yieldPerSeed: 24, uptake: { n: 0.02, p: 0.015, k: 0.04 }, water: 0.6, optTemp: 15, tempTol: 8, harvestHours: 4, machineHarvest: true, minEra: 1, unlockHarvests: 5, bestSeasons: ['Spring', 'Autumn'] },
  soybeans: { id: 'soybeans', growthTicks: 30, seedCost: 6, yieldPerSeed: 8, uptake: { n: -0.05, p: 0.02, k: 0.02 }, water: 0.5, optTemp: 22, tempTol: 9, harvestHours: 2, machineHarvest: true, minEra: 2, bestSeasons: ['Spring', 'Summer'] },
  rice: { id: 'rice', growthTicks: 36, seedCost: 5, yieldPerSeed: 10, uptake: { n: 0.03, p: 0.012, k: 0.012 }, water: 0.85, optTemp: 25, tempTol: 8, harvestHours: 3, machineHarvest: true, minEra: 4, bestSeasons: ['Summer'] },
  sugarcane: { id: 'sugarcane', growthTicks: 60, seedCost: 10, yieldPerSeed: 40, uptake: { n: 0.03, p: 0.01, k: 0.03 }, water: 0.7, optTemp: 27, tempTol: 8, harvestHours: 5, machineHarvest: true, minEra: 4, bestSeasons: ['Spring', 'Summer', 'Autumn'] },
  cotton: { id: 'cotton', growthTicks: 48, seedCost: 6, yieldPerSeed: 6, uptake: { n: 0.03, p: 0.012, k: 0.02 }, water: 0.4, optTemp: 26, tempTol: 9, harvestHours: 3, machineHarvest: true, minEra: 4, bestSeasons: ['Summer'] },
  coffee: { id: 'coffee', growthTicks: 90, seedCost: 20, yieldPerSeed: 6, uptake: { n: 0.03, p: 0.01, k: 0.03 }, water: 0.65, optTemp: 21, tempTol: 5, harvestHours: 6, machineHarvest: false, minEra: 6, frostHardy: false, bestSeasons: ['Spring', 'Summer', 'Autumn', 'Winter'] },
  apples: { id: 'apples', growthTicks: 72, seedCost: 15, yieldPerSeed: 60, uptake: { n: 0.012, p: 0.006, k: 0.012 }, water: 0.5, optTemp: 18, tempTol: 9, harvestHours: 5, machineHarvest: false, minEra: 3, frostHardy: true, bestSeasons: ['Summer', 'Autumn'], perennial: { matureDays: 45, lifeYears: 8 } },
  grapes: { id: 'grapes', growthTicks: 96, seedCost: 22, yieldPerSeed: 45, uptake: { n: 0.01, p: 0.006, k: 0.014 }, water: 0.4, optTemp: 22, tempTol: 9, harvestHours: 6, machineHarvest: false, minEra: 3, frostHardy: true, bestSeasons: ['Summer', 'Autumn'], perennial: { matureDays: 60, lifeYears: 10 } },
};
export const CROP_IDS = Object.keys(CROPS) as CropId[];

// ---------------------------------------------------------------- livestock

export type AnimalId = 'chickens' | 'pigs' | 'cows' | 'sheep';
export interface AnimalDef {
  id: AnimalId;
  name: string;
  one: string;
  price: number; // USD per head
  feedPerDay: number; // feed units per head per day (corn or wheat can stand in)
  product?: GoodId;
  perDay: number; // product units per head per day at full health (pigs: meat as they grow)
  meat: number; // meat units when sent to market
  breedPerDay: number; // growth of a healthy herd with space
  building: BuildingType;
  perBuilding: number; // head per building at level 1
}
export const ANIMALS: Record<AnimalId, AnimalDef> = {
  chickens: { id: 'chickens', name: 'Chickens', one: 'hen', price: 40, feedPerDay: 0.5, product: 'eggs', perDay: 1, meat: 0.3, breedPerDay: 0.05, building: 'coop', perBuilding: 100 },
  pigs: { id: 'pigs', name: 'Pigs', one: 'pig', price: 250, feedPerDay: 1.6, product: 'meat', perDay: 0.15, meat: 2, breedPerDay: 0.04, building: 'pigsty', perBuilding: 40 },
  cows: { id: 'cows', name: 'Dairy cows', one: 'cow', price: 1200, feedPerDay: 5, product: 'milk', perDay: 8, meat: 6, breedPerDay: 0.01, building: 'cowshed', perBuilding: 20 },
  sheep: { id: 'sheep', name: 'Sheep', one: 'sheep', price: 220, feedPerDay: 0.8, product: 'wool', perDay: 0.6, meat: 1.2, breedPerDay: 0.03, building: 'sheepfold', perBuilding: 50 },
};
export const ANIMAL_IDS = Object.keys(ANIMALS) as AnimalId[];

// ---------------------------------------------------------------- discoveries (gradual introductions)

export type PerkId = 'harvester' | 'planter' | 'herder' | 'mechanic' | 'agronomist';
export const PERKS: Record<PerkId, { name: string; text: string }> = {
  harvester: { name: 'Harvest hand', text: 'Harvests 30% faster.' },
  planter: { name: 'Sower', text: 'Plants 30% faster.' },
  herder: { name: 'Herder', text: 'Animals in this region stay healthier (+health every day).' },
  mechanic: { name: 'Mechanic', text: 'Machines in this region wear 30% slower.' },
  agronomist: { name: 'Agronomist', text: 'Harvests in this region come in one quality step better.' },
};

// ---------------------------------------------------------------- regions

export type RegionId = 'heartland' | 'river' | 'arid' | 'coastal' | 'tropics';

export interface RegionDef {
  id: RegionId;
  name: string;
  blurb: string;
  currency: string;
  fx0: number; // USD per 1 local unit at start
  inflationOffset: number; // added to global inflation, drives FX drift
  landPrice: number; // USD per ha for parcels (CPI-indexed)
  soil: number; // starting nutrient level multiplier
  rain: number; // mean daily rainfall index 0..1
  temp: number; // mean °C
  wage: number; // local currency per hour at CPI 1
  tax: number; // corporate profit tax rate
  infra: number; // >1 cheaper/faster haulage
  population: number; // demand multiplier
  solar: number;
  stability: number; // 0..1, lower = more FX noise and disruption
  port: number; // port throughput units/day, 0 = landlocked
  customsDays: number;
  importTariff: number; // ad valorem on imports
  waterPrice: number; // USD per irrigation unit
  waterCap: number; // irrigation units per ha per day permitted, Infinity = unlimited
  suitability: Partial<Record<CropId, number>>; // 0 = cannot grow
  x: number; y: number; // map position 0..100
}

export const REGIONS: Record<RegionId, RegionDef> = {
  heartland: { id: 'heartland', name: 'Heartland Valley', blurb: 'Your home valley. Balanced soil, rain and prices.', currency: 'USD', fx0: 1, inflationOffset: 0, landPrice: 900, soil: 1, rain: 0.55, temp: 15, wage: 12, tax: 0.2, infra: 1, population: 1, solar: 1, stability: 0.95, port: 0, customsDays: 0, importTariff: 0, waterPrice: 0.4, waterCap: Infinity,
    suitability: { wheat: 1, corn: 1, potatoes: 1, soybeans: 0.9, rice: 0.35, sugarcane: 0.25, cotton: 0.45, apples: 1, grapes: 0.8 }, x: 30, y: 34 },
  river: { id: 'river', name: 'River Plains', blurb: 'Fertile, reliably watered and close to home. Labour is expensive.', currency: 'USD', fx0: 1, inflationOffset: 0, landPrice: 1300, soil: 1.25, rain: 0.7, temp: 18, wage: 18, tax: 0.22, infra: 1.15, population: 1.3, solar: 0.9, stability: 0.95, port: 0, customsDays: 0, importTariff: 0, waterPrice: 0.25, waterCap: Infinity,
    suitability: { wheat: 1.05, corn: 1.15, potatoes: 1, soybeans: 1.15, rice: 1.1, sugarcane: 0.5, cotton: 0.6, apples: 1.05, grapes: 0.9 }, x: 46, y: 52 },
  arid: { id: 'arid', name: 'Arid Frontier', blurb: 'Cheap land and strong sun, but water is scarce and permits are capped.', currency: 'ARP', fx0: 0.055, inflationOffset: 0.05, landPrice: 350, soil: 0.7, rain: 0.22, temp: 24, wage: 160, tax: 0.12, infra: 0.75, population: 0.6, solar: 1.7, stability: 0.75, port: 0, customsDays: 2, importTariff: 0.08, waterPrice: 1.2, waterCap: 0.35,
    suitability: { wheat: 0.85, corn: 0.6, soybeans: 0.6, cotton: 1.1, sugarcane: 0.7, grapes: 1.15, apples: 0.5 }, x: 16, y: 72 },
  coastal: { id: 'coastal', name: 'Coastal Trade Hub', blurb: 'Expensive land, a deep-water port, big industry and wealthy consumers.', currency: 'EUR', fx0: 1.1, inflationOffset: -0.005, landPrice: 3000, soil: 0.9, rain: 0.6, temp: 14, wage: 20, tax: 0.25, infra: 1.5, population: 2.6, solar: 0.85, stability: 0.92, port: 60000, customsDays: 1, importTariff: 0.06, waterPrice: 0.5, waterCap: Infinity,
    suitability: { wheat: 0.95, potatoes: 1.1, corn: 0.8, soybeans: 0.8, apples: 1.15, grapes: 0.95 }, x: 74, y: 28 },
  tropics: { id: 'tropics', name: 'Tropical Highlands', blurb: 'Coffee and cane country. Cheap labour, rich rain, a volatile currency.', currency: 'BRL', fx0: 0.2, inflationOffset: 0.04, landPrice: 500, soil: 1, rain: 0.85, temp: 24, wage: 40, tax: 0.15, infra: 0.8, population: 1.4, solar: 1.2, stability: 0.62, port: 30000, customsDays: 3, importTariff: 0.12, waterPrice: 0.2, waterCap: Infinity,
    suitability: { coffee: 1.2, sugarcane: 1.25, rice: 1, soybeans: 1.05, corn: 0.9, cotton: 0.8 }, x: 70, y: 76 },
};
export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

/** Road/sea distance in km. Shipping cost and transit days scale with it. */
export const DISTANCE: Record<RegionId, Partial<Record<RegionId, number>>> = {
  heartland: { river: 300, arid: 900, coastal: 800, tropics: 5200 },
  river: { arid: 1000, coastal: 700, tropics: 5000 },
  arid: { coastal: 1500, tropics: 5600 },
  coastal: { tropics: 4500 },
  tropics: {},
};
export const distance = (a: RegionId, b: RegionId) => (a === b ? 0 : DISTANCE[a][b] ?? DISTANCE[b][a]!);
export const SEA_ROUTE = (a: RegionId, b: RegionId) => a === 'tropics' || b === 'tropics';
export const SAME_COUNTRY: RegionId[][] = [['heartland', 'river']];

// ---------------------------------------------------------------- machines & buildings

export type MachineType = 'tractor' | 'harvester' | 'truck' | 'robotTractor' | 'robotHarvester';
export interface MachineDef {
  type: MachineType;
  name: string;
  price: number;
  leasePerDay: number;
  fuelPerHour: number; // litres
  servicePerHours: number; // condition falls 1/servicePerHours each operating hour
  serviceCost: number;
  life: number; // operating hours of useful life (straight-line depreciation per hour)
  haPerHour?: number; // field work rate
  task?: 'plant' | 'harvest';
  autonomous?: boolean; // needs no operator
  capacity?: number; // trucks: units per day
  research?: string;
  minEra: number;
}
export const MACHINES: Record<MachineType, MachineDef> = {
  tractor: { type: 'tractor', name: 'Tractor', price: 15000, leasePerDay: 55, fuelPerHour: 12, servicePerHours: 120, serviceCost: 200, life: 1000, haPerHour: 4, task: 'plant', minEra: 3 },
  harvester: { type: 'harvester', name: 'Combine harvester', price: 42000, leasePerDay: 150, fuelPerHour: 25, servicePerHours: 100, serviceCost: 450, life: 1200, haPerHour: 3, task: 'harvest', minEra: 3 },
  truck: { type: 'truck', name: 'Truck', price: 35000, leasePerDay: 120, fuelPerHour: 0, servicePerHours: 2000, serviceCost: 300, life: 30000, capacity: 1500, minEra: 3 },
  robotTractor: { type: 'robotTractor', name: 'Autonomous tractor', price: 90000, leasePerDay: 320, fuelPerHour: 9, servicePerHours: 300, serviceCost: 600, life: 4000, haPerHour: 6, task: 'plant', autonomous: true, research: 'robotics', minEra: 6 },
  robotHarvester: { type: 'robotHarvester', name: 'Autonomous harvester', price: 160000, leasePerDay: 560, fuelPerHour: 18, servicePerHours: 250, serviceCost: 900, life: 4000, haPerHour: 5, task: 'harvest', autonomous: true, research: 'robotics', minEra: 6 },
};

export type BuildingType =
  | 'barn' | 'silo' | 'coldStore' | 'warehouse' | 'coop' | 'pigsty' | 'cowshed' | 'sheepfold' | 'winery'
  | 'flourMill' | 'bakery' | 'feedMill' | 'ranch' | 'dairy' | 'creamery' | 'oilPress' | 'sugarMill'
  | 'biogas' | 'solar' | 'verticalFarm' | 'distribution' | 'lab' | 'lab2';

export interface Recipe {
  inputs: Partial<Record<GoodId, number>>;
  outputs: Partial<Record<GoodId, number>>;
  kwh: number; // per batch (negative = generates)
  batchesPerHour: number;
}
export interface BuildingDef {
  type: BuildingType;
  name: string;
  category: 'storage' | 'processing' | 'energy' | 'commerce' | 'research' | 'livestock';
  price: number;
  staffPerHour: number; // USD/h, paid every hour the building is active
  dry?: number; cold?: number; // storage capacity added
  coldKwh?: number; // kWh per hour for refrigeration
  recipe?: Recipe;
  solarKw?: number; // kWh per daylight hour at solar index 1
  research?: string;
  minEra: number;
  blurb: string;
}
export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  barn: { type: 'barn', name: 'Barn', category: 'storage', price: 1500, staffPerHour: 0, dry: 1200, minEra: 1, blurb: 'Dry storage for grain and seed stock.' },
  silo: { type: 'silo', name: 'Grain silo', category: 'storage', price: 12000, staffPerHour: 1, dry: 10000, minEra: 2, blurb: 'Large dry storage; halves grain spoilage in the region.' },
  coldStore: { type: 'coldStore', name: 'Cold store', category: 'storage', price: 9000, staffPerHour: 1, cold: 3000, coldKwh: 6, minEra: 2, blurb: 'Refrigerated storage for potatoes, milk, meat, cheese and greens. Uses electricity.' },
  warehouse: { type: 'warehouse', name: 'Warehouse', category: 'storage', price: 60000, staffPerHour: 6, dry: 60000, minEra: 4, blurb: 'Industrial dry storage for processed goods and bulk grain.' },
  flourMill: { type: 'flourMill', name: 'Flour mill', category: 'processing', price: 25000, staffPerHour: 60, recipe: { inputs: { wheat: 10 }, outputs: { flour: 8 }, kwh: 15, batchesPerHour: 6 }, minEra: 4, blurb: 'Wheat → flour.' },
  bakery: { type: 'bakery', name: 'Bakery', category: 'processing', price: 40000, staffPerHour: 60, recipe: { inputs: { flour: 6 }, outputs: { bread: 10 }, kwh: 40, batchesPerHour: 8 }, minEra: 4, blurb: 'Flour → bread. Bread goes stale fast: sell it daily.' },
  feedMill: { type: 'feedMill', name: 'Feed mill', category: 'processing', price: 18000, staffPerHour: 45, recipe: { inputs: { corn: 10 }, outputs: { feed: 10 }, kwh: 10, batchesPerHour: 8 }, minEra: 4, blurb: 'Corn → livestock feed.' },
  ranch: { type: 'ranch', name: 'Cattle ranch', category: 'processing', price: 60000, staffPerHour: 50, recipe: { inputs: { feed: 20 }, outputs: { meat: 2, manure: 6 }, kwh: 10, batchesPerHour: 2 }, minEra: 4, blurb: 'Feed → meat, with manure as a by-product.' },
  dairy: { type: 'dairy', name: 'Dairy farm', category: 'processing', price: 50000, staffPerHour: 45, recipe: { inputs: { feed: 10 }, outputs: { milk: 12, manure: 3 }, kwh: 12, batchesPerHour: 4 }, minEra: 4, blurb: 'Feed → milk (needs cold storage), plus manure.' },
  creamery: { type: 'creamery', name: 'Creamery', category: 'processing', price: 45000, staffPerHour: 50, recipe: { inputs: { milk: 10 }, outputs: { cheese: 1, butter: 0.6 }, kwh: 18, batchesPerHour: 6 }, minEra: 4, blurb: 'Milk → cheese and butter.' },
  oilPress: { type: 'oilPress', name: 'Oilseed press', category: 'processing', price: 35000, staffPerHour: 35, recipe: { inputs: { soybeans: 10 }, outputs: { soyoil: 2, soymeal: 7.5 }, kwh: 20, batchesPerHour: 5 }, minEra: 4, blurb: 'Soybeans → oil and meal.' },
  sugarMill: { type: 'sugarMill', name: 'Sugar mill', category: 'processing', price: 30000, staffPerHour: 55, recipe: { inputs: { sugarcane: 10 }, outputs: { sugar: 2 }, kwh: 25, batchesPerHour: 5 }, minEra: 4, blurb: 'Cane → sugar. Cut cane spoils in days.' },
  biogas: { type: 'biogas', name: 'Biogas plant', category: 'energy', price: 28000, staffPerHour: 4, recipe: { inputs: { manure: 10 }, outputs: {}, kwh: -100, batchesPerHour: 4 }, research: 'biogas', minEra: 4, blurb: 'Manure → electricity for your region.' },
  solar: { type: 'solar', name: 'Solar farm', category: 'energy', price: 50000, staffPerHour: 2, solarKw: 120, research: 'solar', minEra: 4, blurb: 'Free daytime electricity; surplus sells to the grid at half price.' },
  verticalFarm: { type: 'verticalFarm', name: 'Vertical farm', category: 'processing', price: 250000, staffPerHour: 80, recipe: { inputs: {}, outputs: { greens: 20 }, kwh: 200, batchesPerHour: 4 }, research: 'verticalFarming', minEra: 7, blurb: 'Weatherproof greens grown on electricity.' },
  coop: { type: 'coop', name: 'Chicken coop', category: 'livestock', price: 2500, staffPerHour: 0, minEra: 2, blurb: 'Houses 100 hens per level. Hens lay a tray of eggs a day when fed and healthy.' },
  pigsty: { type: 'pigsty', name: 'Pigsty', category: 'livestock', price: 6000, staffPerHour: 0, minEra: 2, blurb: 'Houses 40 pigs per level. Pigs put on meat every day they are fed.' },
  cowshed: { type: 'cowshed', name: 'Cowshed', category: 'livestock', price: 14000, staffPerHour: 2, minEra: 3, blurb: 'Houses 20 dairy cows per level. Milk needs cold storage or a quick sale.' },
  sheepfold: { type: 'sheepfold', name: 'Sheepfold', category: 'livestock', price: 5000, staffPerHour: 0, minEra: 2, blurb: 'Houses 50 sheep per level. Sheep grow wool on very little feed.' },
  winery: { type: 'winery', name: 'Winery', category: 'processing', price: 55000, staffPerHour: 45, recipe: { inputs: { grapes: 10 }, outputs: { wine: 6 }, kwh: 10, batchesPerHour: 4 }, minEra: 4, blurb: 'Grapes → wine. Premium grapes make premium wine.' },
  distribution: { type: 'distribution', name: 'Distribution centre', category: 'commerce', price: 80000, staffPerHour: 60, minEra: 4, blurb: 'Retail channel: +12% on processed goods sold in this region.' },
  lab: { type: 'lab', name: 'Research station', category: 'research', price: 30000, staffPerHour: 50, minEra: 4, blurb: 'Runs one research project at a time.' },
  lab2: { type: 'lab2', name: 'Advanced laboratory', category: 'research', price: 150000, staffPerHour: 120, research: 'advancedLab', minEra: 5, blurb: 'Required for advanced research; projects run twice as fast.' },
};
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

// ---------------------------------------------------------------- research

export interface TechDef {
  id: string;
  name: string;
  category: 'Crop Genetics' | 'Soil Science' | 'Irrigation' | 'Mechanization' | 'Automation' | 'Logistics' | 'Food Processing' | 'Renewable Energy' | 'Biotechnology' | 'Artificial Intelligence';
  cost: number;
  days: number;
  requires: string[];
  advanced?: boolean; // needs an advanced lab
  benefit: string;
  tradeoff: string;
}
export const TECHS: TechDef[] = [
  { id: 'soilTesting', name: 'Soil testing', category: 'Soil Science', cost: 4000, days: 3, requires: [], benefit: 'Reveals nitrogen, phosphorus, potassium and organic matter for each field.', tradeoff: 'None — knowledge only.' },
  { id: 'coverCrops', name: 'Cover cropping', category: 'Soil Science', cost: 9000, days: 6, requires: ['soilTesting'], benefit: 'Fallow fields rebuild nutrients and organic matter twice as fast.', tradeoff: 'Pays off only if you rest fields.' },
  { id: 'precisionFert', name: 'Precision fertilisation', category: 'Soil Science', cost: 22000, days: 10, requires: ['soilTesting'], benefit: 'Fertiliser doses use 30% less product and never overdose soil.', tradeoff: 'Requires soil testing data.' },
  { id: 'improvedSeeds', name: 'Improved seed varieties', category: 'Crop Genetics', cost: 12000, days: 6, requires: [], benefit: '+10% yield on all crops.', tradeoff: 'Seed costs +20%.' },
  { id: 'droughtResistant', name: 'Drought-resistant varieties', category: 'Crop Genetics', cost: 45000, days: 14, requires: ['improvedSeeds'], benefit: 'Dry soil never cuts yields below 70%.', tradeoff: 'Seed costs a further +15%.' },
  { id: 'hybrids', name: 'High-yield hybrids', category: 'Crop Genetics', cost: 90000, days: 20, requires: ['improvedSeeds'], advanced: true, benefit: '+20% yield.', tradeoff: 'Removes 40% more nutrients per harvest.' },
  { id: 'pestResistant', name: 'Pest-resistant traits', category: 'Biotechnology', cost: 60000, days: 14, requires: ['improvedSeeds'], benefit: 'Pest pressure builds 60% slower.', tradeoff: 'Royalty-free, but seed costs +10%.' },
  { id: 'nitrogenFixing', name: 'Nitrogen-fixing cereals', category: 'Biotechnology', cost: 180000, days: 30, requires: ['pestResistant', 'soilTesting'], advanced: true, benefit: 'Wheat, corn and rice take 50% less nitrogen.', tradeoff: 'Expensive, long project.' },
  { id: 'dripIrrigation', name: 'Drip irrigation', category: 'Irrigation', cost: 15000, days: 7, requires: [], benefit: 'Irrigation uses 35% less water.', tradeoff: 'Irrigated fields cost $200/ha more to equip.' },
  { id: 'precisionIrrigation', name: 'Precision irrigation', category: 'Irrigation', cost: 55000, days: 14, requires: ['dripIrrigation', 'soilTesting'], benefit: 'Water use −60% and irrigated fields never fall below 85% water factor.', tradeoff: 'Sensors draw 1 kWh per ha per hour.' },
  { id: 'mech2', name: 'Efficient drivetrains', category: 'Mechanization', cost: 25000, days: 8, requires: [], benefit: 'Machines work 30% faster and burn 20% less fuel.', tradeoff: 'Service costs +25%.' },
  { id: 'predictiveMaintenance', name: 'Predictive maintenance', category: 'Mechanization', cost: 30000, days: 10, requires: ['mech2'], benefit: 'Breakdowns are 70% less likely.', tradeoff: 'None.' },
  { id: 'farmSoftware', name: 'Farm management software', category: 'Automation', cost: 10000, days: 5, requires: [], benefit: 'Unlocks the automation rule builder (if/then rules).', tradeoff: 'Rules only do what you tell them.' },
  { id: 'robotics', name: 'Agricultural robotics', category: 'Automation', cost: 200000, days: 30, requires: ['mech2', 'farmSoftware'], advanced: true, benefit: 'Autonomous tractors and harvesters that need no operator.', tradeoff: 'Very expensive machines.' },
  { id: 'routeOptimization', name: 'Route optimisation', category: 'Logistics', cost: 18000, days: 7, requires: [], benefit: 'Haulage and freight cost −20%.', tradeoff: 'None.' },
  { id: 'coldChain', name: 'Cold chain', category: 'Logistics', cost: 28000, days: 10, requires: [], benefit: 'Spoilage of cold goods halved.', tradeoff: 'Cold stores draw 30% more power.' },
  { id: 'portLogistics', name: 'Port logistics', category: 'Logistics', cost: 50000, days: 12, requires: ['routeOptimization'], benefit: 'Customs delays halved, port capacity doubled for you.', tradeoff: 'None.' },
  { id: 'processEfficiency', name: 'Process efficiency', category: 'Food Processing', cost: 35000, days: 10, requires: [], benefit: 'Processing recipes yield 10% more output.', tradeoff: 'None.' },
  { id: 'foodTech', name: 'Low-energy food tech', category: 'Food Processing', cost: 40000, days: 12, requires: ['processEfficiency'], benefit: 'Factories use 30% less electricity.', tradeoff: 'None.' },
  { id: 'solar', name: 'Solar power', category: 'Renewable Energy', cost: 20000, days: 8, requires: [], benefit: 'Unlocks solar farms.', tradeoff: 'Only generates in daylight.' },
  { id: 'biogas', name: 'Biogas digestion', category: 'Renewable Energy', cost: 16000, days: 7, requires: [], benefit: 'Unlocks biogas plants that burn manure for power.', tradeoff: 'Manure used for power is not spread on fields.' },
  { id: 'advancedLab', name: 'Advanced laboratory', category: 'Artificial Intelligence', cost: 30000, days: 8, requires: [], benefit: 'Lets you build an advanced lab for advanced research.', tradeoff: 'Lab staff are expensive.' },
  { id: 'agAI', name: 'Agricultural AI', category: 'Artificial Intelligence', cost: 150000, days: 25, requires: ['farmSoftware', 'soilTesting'], advanced: true, benefit: 'Managers pursue strategic objectives: soil targets, rotation and selling discipline.', tradeoff: 'Managers still need salaries.' },
  { id: 'climateForecast', name: 'Climate forecasting', category: 'Artificial Intelligence', cost: 80000, days: 18, requires: ['agAI'], advanced: true, benefit: 'Drought and flood warnings 10 days ahead.', tradeoff: 'None.' },
  { id: 'marketAI', name: 'Market intelligence', category: 'Artificial Intelligence', cost: 70000, days: 15, requires: ['farmSoftware'], benefit: 'Shows a 10-day price outlook from current supply and demand.', tradeoff: 'Forecasts are model-based, not guarantees.' },
  { id: 'verticalFarming', name: 'Vertical farming', category: 'Renewable Energy', cost: 250000, days: 30, requires: ['solar', 'robotics'], advanced: true, benefit: 'Unlocks vertical farms.', tradeoff: 'Enormous electricity demand.' },
];
export const TECH = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<string, TechDef>;

// ---------------------------------------------------------------- competitors

export type Archetype = 'traditional' | 'industrial' | 'speculator' | 'conglomerate';
export const ARCHETYPES: Record<Archetype, { label: string; leverage: number; expandRate: number; mech: number; blurb: string }> = {
  traditional: { label: 'Traditional farmer', leverage: 0.15, expandRate: 0.0002, mech: 0.3, blurb: 'Conservative, low debt, slow growth, very resilient.' },
  industrial: { label: 'Industrial producer', leverage: 0.6, expandRate: 0.0006, mech: 0.9, blurb: 'Huge mechanised volume on thin margins. Hurt by fuel prices.' },
  speculator: { label: 'Commodity speculator', leverage: 0.7, expandRate: 0.0003, mech: 0.6, blurb: 'Hoards inventory to trade volatility. Vulnerable to credit squeezes.' },
  conglomerate: { label: 'Agri conglomerate', leverage: 0.45, expandRate: 0.0004, mech: 0.8, blurb: 'Vertically integrated and diversified. Big market influence.' },
};
export const COMPETITOR_SEEDS: { name: string; archetype: Archetype; region: RegionId; ha: number }[] = [
  { name: 'Oakridge Family Farms', archetype: 'traditional', region: 'heartland', ha: 18 },
  { name: 'Prairie Industrial Grain', archetype: 'industrial', region: 'heartland', ha: 90 },
  { name: 'Delta Agri Holdings', archetype: 'conglomerate', region: 'river', ha: 140 },
  { name: 'Meridian Commodities', archetype: 'speculator', region: 'coastal', ha: 30 },
  { name: 'Sunstone Cotton Co.', archetype: 'industrial', region: 'arid', ha: 110 },
  { name: 'Serra Verde Cooperativa', archetype: 'traditional', region: 'tropics', ha: 60 },
  { name: 'Atlantica Foods', archetype: 'conglomerate', region: 'tropics', ha: 200 },
];

// ---------------------------------------------------------------- progression

export interface EraDef { n: number; name: string; theme: string; requirement: string }
export const ERAS: EraDef[] = [
  { n: 1, name: 'The Homestead', theme: 'Survival, manual farming and basic economics.', requirement: '' },
  { n: 2, name: 'The Farm Business', theme: 'Scaling up: workers, storage, soil and water.', requirement: 'Own 4 fields and earn $12,000 in sales' },
  { n: 3, name: 'Mechanization', theme: 'Trading labour for capital: machines, fuel, finance.', requirement: '$60,000 in sales with two workers' },
  { n: 4, name: 'Agricultural Industry', theme: 'Processing, energy, research and vertical integration.', requirement: 'Own a machine and earn $500,000 in sales' },
  { n: 5, name: 'Markets & Finance', theme: 'Commodity exchange, hedging, contracts, statements.', requirement: '$3,000,000 in sales (or two factories and $1,500,000)' },
  { n: 6, name: 'Regional Expansion', theme: 'New regions, trade, tariffs and currencies.', requirement: '$12,000,000 in sales' },
  { n: 7, name: 'Agricultural Corporation', theme: 'Divisions, executives, acquisitions and capital markets.', requirement: '$60,000,000 in sales or 3,000 ha' },
  { n: 8, name: 'Global Food System', theme: 'Climate, global influence and systemic risk.', requirement: '$300,000,000 in sales' },
];

export const CONFIG = {
  startingCash: 250,
  seedsPerHa: 10,
  homePlotBase: 300, // first 16 one-hectare plots, price escalates
  homePlotGrowth: 1.55,
  homePlots: 16,
  parcelSizes: [5, 25, 100, 500],
  plantHours: 1.5, // labour-hours per ha to plant by hand
  fertilizeHours: 1,
  fertilizerPerHa: 20, // units per dose
  fertilizerDose: 0.25, // nutrient gain per dose
  manurePerHa: 40,
  overripeGrace: 12,
  overripeLoss: 0.004, // per tick after grace
  baseDryStorage: 400,
  irrigationCostPerHa: 600,
  irrigationWaterPerHa: 0.5, // units per ha per tick of top-up when dry
  demandScale: 4, // multiplies GoodDef.demand × population
  marketBuffer: 48, // market stock buffer = hours of demand; sets fundamental price
  marketDepth: 2, // hours of demand a single trade can absorb before the price falls ~63%
  impactDecay: 0.94, // per tick: order-book impact half-life ≈ 11 hours
  priceHistoryEvery: 4,
  priceHistoryLength: 180,
  dailyHistoryLength: 360,
  ledgerLength: 400,
  logLength: 120,
  booksDays: 360,
  offlineCapTicks: 6 * 3600,
  haulPerUnit: 0.04, // USD per unit hired haulage at infra 1, fuel 1
  haulCapacityPerDay: 20000, // hired haulage capacity per region per day at infra 1
  freightPerUnitKm: 0.00012,
  seaFreightPerUnitKm: 0.00004,
  overdraftRate: 0.12,
  incorporateCost: 50000,
  sharesOutstanding: 1_000_000,
  managerWage: 35, // USD/h
  execSalary: 400, // USD/h
  antitrustShare: 0.35,
};

export const LEDGER_KINDS = {
  sale: 'Sales', contract: 'Contract deliveries', grid: 'Power sold to grid', insurancePayout: 'Insurance payouts', prize: 'Prizes & gifts', assetSale: 'Asset sales',
  seeds: 'Seed', wages: 'Wages', salaries: 'Management salaries', staff: 'Factory staff', fuel: 'Fuel', maintenance: 'Maintenance & repairs',
  electricity: 'Electricity', water: 'Water', fertilizer: 'Fertiliser', purchases: 'Market purchases', haulage: 'Haulage', shipping: 'Freight & tariffs',
  insurance: 'Insurance premiums', lease: 'Leases', royalties: 'Royalties', training: 'Training', fines: 'Fines & penalties', research: 'Research', legal: 'Legal & due diligence',
  interest: 'Interest', tax: 'Tax', futures: 'Futures P&L',
  land: 'Land', machine: 'Machinery', building: 'Buildings', acquisition: 'Acquisitions', irrigation: 'Irrigation equipment',
  loanIn: 'Loans drawn', loanRepay: 'Loan principal repaid', sharesIssued: 'Shares issued', dividends: 'Dividends', buyback: 'Share buybacks',
  margin: 'Futures margin', depreciation: 'Depreciation',
} as const;
export type LedgerKind = keyof typeof LEDGER_KINDS;

export const REVENUE_KINDS: LedgerKind[] = ['sale', 'contract', 'grid'];
export const OPEX_KINDS: LedgerKind[] = ['seeds', 'wages', 'salaries', 'staff', 'fuel', 'maintenance', 'electricity', 'water', 'fertilizer', 'purchases', 'haulage', 'shipping', 'insurance', 'lease', 'royalties', 'training', 'fines', 'research', 'legal'];
export const INVESTING_KINDS: LedgerKind[] = ['land', 'machine', 'building', 'acquisition', 'irrigation', 'assetSale'];
export const FINANCING_KINDS: LedgerKind[] = ['loanIn', 'loanRepay', 'sharesIssued', 'dividends', 'buyback'];
export const OTHER_OPERATING: LedgerKind[] = ['interest', 'tax', 'futures', 'insurancePayout', 'prize'];
