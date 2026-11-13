import type { AnimalId, BuildingType, CropId, GoodId, LedgerKind, MachineType, PerkId, RegionId } from './config';

export type Division = 'crops' | 'livestock' | 'processing' | 'logistics' | 'energy' | 'trading' | 'corporate';

export interface Soil { n: number; p: number; k: number; organic: number }

export interface HarvestBreakdown {
  crop: CropId;
  units: number;
  base: number;
  soil: number;
  water: number;
  weather: number;
  pest: number;
  tech: number;
  suitability: number;
  timing: number;
  frost: number; // share of the crop that survived frost nights
  quality: number; // 0..1, sets the grade (A ≥ 0.8, B ≥ 0.6, else C)
}

export interface Field {
  id: number;
  cost: number; // purchase price (book value of the land)
  region: RegionId;
  ha: number;
  crop: CropId | null;
  plantedAt: number;
  plan: CropId | null; // crop workers replant automatically
  planLocked: boolean; // player fixed the plan: managers and rules leave it alone
  supplies: number | null; // building id this field grows for: its harvest is reserved for that factory
  spreading: 'fertilizer' | 'manure' | null; // bought and waiting for the crew to spread it
  spreadWork: number; // 0..1 progress spreading it
  soil: Soil;
  moisture: number;
  irrigated: boolean;
  greenhouse: boolean; // glass: no frost, steady temperature, heating in cold weather
  frost: number; // 0..1 share of the current crop lost to frost
  cycleAt: number; // perennials: tick the current fruiting cycle started
  pest: number; // 0..1
  lastCrop: CropId | null;
  streak: number; // consecutive harvests of the same crop
  work: number; // 0..1 progress of the pending labour task
  pickStart?: number; // tick the current harvest started (big fields take days to pick)
  acc: { temp: number; water: number; n: number }; // conditions accumulated over the growing period
  lastHarvest?: HarvestBreakdown;
  yields: number[]; // units/ha of recent harvests
}

export interface Worker {
  id: number;
  name: string;
  region: RegionId;
  role: 'hand' | 'manager';
  resident: boolean; // existing staff remain commuters when a community chapter begins
  wageFactor: number; // multiple of the regional market wage
  skill: number; // 0.5..1.6
  morale: number; // 0..1
  lowDays: number;
  trainingUntil: number;
  perk: PerkId | null;
  hours: number;
  task: number; // field id being worked this hour, 0 = idle (drives the world view)
}

export interface Machine {
  id: number;
  type: MachineType;
  region: RegionId;
  condition: number; // 0..1
  hours: number;
  util: number; // share of recent hours in use (EMA, ~2 days)
  task: number; // field id being worked this hour, 0 = idle
  broken: boolean;
  leased: boolean;
  cost: number; // purchase price (0 if leased)
  depreciated: number;
  usedThisTick: boolean;
  tier: number; // 1..3 upgrades: faster, thriftier, sturdier
  driver: number | null; // hand assigned to run it; they work by hand when it has nothing to do
}

export interface ProductionDay {
  day: number; hours: number; batches: number; capacity: number;
  earn: number; inputs: number; staff: number; power: number; alternative: number;
  qty: Partial<Record<GoodId, number>>; values: Partial<Record<GoodId, number>>;
  reasons: Record<string, number>;
}
export interface ProductionReport { open: ProductionDay | null; days: ProductionDay[]; lastBatches: number; lastTick: number }

export interface Building {
  movedUntil?: number; // a moved building stands idle until this tick
  id: number;
  type: BuildingType;
  region: RegionId;
  active: boolean;
  level: number; // 1..3 upgrades multiply capacity
  cost: number;
  depreciated: number;
  util: number; // smoothed capacity utilisation
  reserved: number; // input units held in storage for this factory by its supplying fields
  reason: string; // current bottleneck, '' when running at capacity
  productionReport: ProductionReport;
  stats: { out: number; inCost: number; outValue: number; opCost: number }; // smoothed per-hour economics
}

export interface Market {
  price: number; // USD
  inv: number; // market-held stock
  target: number;
  d0: number; // demand per tick at reference price
  bg0: number; // background (non-competitor) supply per tick
  bg: number; // current background supply rate
  comp: number; // competitor supply per tick (refreshed daily)
  sent: number; // speculative sentiment, AR(1)
  impact: number; // temporary order-book impact from recent large trades (log-price units, decays)
  history: number[]; // sampled every few ticks
  daily: number[]; // one sample per day
  demandToday: number;
  playerSold: number; // player units sold, rolling 30-day
  totalSold: number; // all units consumed, rolling 30-day
}

export interface RegionState {
  id: RegionId;
  unlocked: boolean;
  inventory: Record<GoodId, number>;
  fx: number; // USD per local unit
  cpi: number; // local price level (wages, land)
  rainToday: number;
  temp: number;
  rain30: number;
  retailToday: Partial<Record<GoodId, number>>; // units already given a retail markup today
  haulToday: number; // hired haulage used today
  truckToday: number; // own-truck capacity used today
  portToday: number;
  insured: boolean;
  insuredFrom: number; // cover starts after a waiting period
  homePlotsBought: number;
  parcelsBought: number;
  waterToday: number;
  powerGen: number; // kWh generated this tick
  powerUse: number; // kWh demanded this tick
  backlog: number; // work hours today with unfinished field work (drives fatigue)
  forecast: { temp: number; rain: number }[]; // the next days' weather (today is at index 0 once the day turns)
  frostTonight: boolean;
  quality: Partial<Record<GoodId, number>>; // average quality of stored stock
}

export interface Herd { region: RegionId; animal: AnimalId; count: number; health: number; fed: number }

export interface Loan {
  id: number;
  principal: number;
  balance: number;
  spread: number;
  termDays: number;
  daysLeft: number;
  missed: number;
  taken: number;
}

export interface FuturesPosition {
  id: number;
  good: GoodId;
  contracts: number; // + long, − short; 1 contract = 100 units
  entry: number; // USD
  mark: number; // USD, last settlement price
  expiry: number; // tick
  margin: number;
}

export interface SupplyContract {
  id: number;
  buyer: string;
  region: RegionId;
  good: GoodId;
  qty: number;
  delivered: number;
  price: number; // USD per unit
  deadline: number; // tick
  penalty: number; // USD per unit short
  minQuality?: number; // premium buyers only take stock at or above this quality
  expires: number; // offer expiry tick
  accepted: boolean;
}

export interface Shipment {
  /** Manager load day; -1 or absent means a normal immediate shipment. */
  batchDay?: number;
  id: number;
  good: GoodId;
  qty: number;
  from: RegionId;
  to: RegionId;
  arrives: number;
  cost: number;
  sell?: boolean; // sold into the destination market on arrival, a little each hour, instead of stored
  caravan?: boolean; // Region chapter: sold to a neighbour you hold no land in; can be raided in transit
}

export type RuleMetric = 'price' | 'inventory' | 'cash' | 'storageUtil' | 'minFertility' | 'minCondition' | 'facilityMargin';
export type RuleAction = 'sell' | 'buy' | 'fertilizeLow' | 'repairAll' | 'pauseFacilities' | 'resumeFacilities' | 'ship' | 'setPlan';

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  metric: RuleMetric;
  region: RegionId;
  good: GoodId;
  op: '>' | '<';
  value: number;
  action: RuleAction;
  actionGood: GoodId;
  actionRegion: RegionId; // for ship
  amountPct: number; // % of inventory (sell/ship) or units (buy)
  buildingType?: BuildingType;
  priority: number;
  maxSpend: number;
  cooldown: number; // ticks
  lastRun: number;
  history: { tick: number; note: string }[];
}

export interface Policies {
  cashReserve: number; // automation never spends below this
  autoFertilize: boolean;
  soilTarget: number; // 0..1 fertility below which managers fertilise
  autoRepair: number; // service machines when condition < this (0 = off)
  autoRotate: boolean; // managers pick the best crop per field (needs a manager)
  supplyFactories: boolean; // rotation also values crops at what your own short-of-input factories pay
  sellDiscipline: number; // managers auto-sell when price ≥ this × 30-day avg (0 = off)
  sellStorageCap: number; // ... or when storage is above this fraction
  debtCeiling: number; // repay loans from surplus cash when debt/assets above this (0 = off)
  irrigateMin: number; // irrigation tops moisture up to this
  hedgeRatio: number; // trading head shorts this share of expected 30-day crop output (0 = off)
  autoFeed: boolean; // buy feed when animals would otherwise go hungry
  autoExport: boolean; // managers ship surplus to another region when it pays more after freight and tariffs
}

export type EventKind =
  | 'drought' | 'flood' | 'pests' | 'energyShock' | 'strike' | 'portClosure' | 'embargo'
  | 'recession' | 'demandSurge' | 'creditCrunch' | 'breakthrough' | 'livestockDisease' | 'antitrust' | 'foodCrisis' | 'cropFailureAbroad';

export interface GameEvent {
  id: number;
  kind: EventKind;
  title: string;
  text: string;
  region?: RegionId;
  region2?: RegionId;
  good?: GoodId;
  announced: number;
  start: number;
  end: number;
  severity: number;
  choice?: { options: { id: string; label: string; detail: string }[]; chosen?: string; deadline: number };
}

export interface Competitor {
  payrollDay:number; payrollToday:number;
  id: number;
  name: string;
  archetype: import('./config').Archetype;
  region: RegionId;
  ha: number;
  mix: Partial<Record<CropId, number>>;
  mech: number;
  cash: number;
  debt: number;
  hiddenDebt: number;
  stock: Partial<Record<GoodId, number>>;
  status: 'active' | 'distressed' | 'bankrupt' | 'acquired';
  revenue30: number;
  profit30: number;
  diligence: 'none' | 'running' | 'done';
  diligenceDone: number;
  share: number; // share of regional crop output
}

export type LogLevel = 'info' | 'opportunity' | 'warning' | 'critical';
export interface LogEntry { id: number; tick: number; level: LogLevel; text: string; page?: string }

export interface LedgerEntry { tick: number; kind: LedgerKind; amount: number; region: RegionId; division: Division; memo: string }

export interface DayBook { day: number; kinds: Partial<Record<LedgerKind, number>>; regions: Partial<Record<RegionId, number>>; divisions: Partial<Record<Division, number>>; op: Partial<Record<RegionId, number>>; cash: number; debt: number; equity: number; produced: number }

export interface BarterOffer {
  id: string;
  takeGood: GoodId;
  takeQty: number;
  give: { kind: 'good'; good: GoodId; qty: number } | { kind: 'seed'; crop: CropId; qty: number };
  haggled: boolean;
  traded: boolean;
}
export interface HomesteadState { day: number; mood: number; offers: BarterOffer[] }
export interface MarketTownState { lastMarketDay: number }
export type TraderCharter = 'fair' | 'shrewd';
/** Each axis runs 0–100. cleanIndustrial: 0 clean energy, 100 heavy industry (oil). Everyday decisions nudge them. */
export interface TownValues { prosperityFairness: number; orderFreedom: number; peaceStrength: number; traditionProgress: number; cleanIndustrial?: number }
export type SettlementCharter = 'company' | 'free';
export type HomeTier = 'cottage' | 'terrace' | 'apartment';
export interface CommunityHome { id: number; tier: HomeTier; count: number; cost: number }
export interface HouseholdCohort { id: number; name: string; households: number; adults: number; children: number }
export interface SettlementState {
  active: boolean;
  /** Settlement pay policy (0–0.2 each): a pay cut for workers whose families live here, and a housing tax on them. */
  payCut?: number; housingTax?: number;
  /** Worker id → their family's cohort id. Only employees' families live in the settlement. */
  families?: Record<number, number>;
  charter: SettlementCharter | null;
  homes: CommunityHome[];
  cohorts: HouseholdCohort[];
  householdCash: number;
  happiness: number;
  fed: number;
  warm: number;
  autoLarder: boolean;
  larderHold: Partial<Record<GoodId, number>>;
  lastDay: number;
  enteredAt: number;
  hardshipDays: number;
}

export type SchoolCharter = 'public' | 'trade';
export const DISTRICT_IDS = ['farmgate', 'orchard', 'heights'] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];
export type ServiceType = 'school' | 'well' | 'clinic' | 'road' | 'hospital' | 'waterworks' | 'waterTower' | 'park' | 'sanitation' | 'lighting' | 'police' | 'watchtower' | 'barracks';
export interface CivicService { id: number; type: ServiceType; district: DistrictId; count: number; active: boolean; cost: number; staffed: number; funded: boolean; /** 1–3: wider reach, or more homes on its lines */ level?: number; /** families its lines serve now, and how many it can (utilities only) */ serving?: [number, number] }
export interface DistrictCoverage { people: number; school: number; water: number; medical: number; road: number }
export interface CouncilPetition { id: number; kind: 'park' | 'bread'; opened: number }
export interface TownState {
  active: boolean; enteredAt: number; charter: SchoolCharter | null; retrainingUntil: number;
  cash: number; companyAdvance: number; ledger: LedgerEntry[]; lifetime: Partial<Record<LedgerKind, number>>; books: DayBook[];
  taxRate: number; taxableIncome: number; lastTax: number; lastCost: number; lastDay: number;
  services: CivicService[]; coverage: Record<DistrictId, DistrictCoverage>;
  publicJobs: number; industrialJobs: number; factoryShare: number;
  health: number; education: number; water: number; roads: number;
  /** Share of families inside the reach of sanitation and of a power station (radius coverage). */
  sanitation?: number; power?: number; medical?: number;
  petition: CouncilPetition | null; nextPetition: number; goodwillUntil: number; breadUntil: number;
  crime: number; thefts: number; illnessDeaths: number; mortalityCarry: number;
}

export interface GameState {
  version: 15;
  seed: number;
  rng: number;
  tick: number;
  cash: number;
  marginAccount: number;
  fields: Field[];
  workers: Worker[];
  machines: Machine[];
  buildings: Building[];
  regions: Record<RegionId, RegionState>;
  markets: Record<RegionId, Partial<Record<GoodId, Market>>>;
  seeds: Record<CropId, number>;
  macro: { cpi: number; inflation: number; baseRate: number; energy: number; income: number; climate: number; crunch: number; emissions: number };
  bench: Partial<Record<GoodId, number>>; // 24h average global price, used to settle futures
  loans: Loan[];
  futures: FuturesPosition[];
  contracts: SupplyContract[];
  shipments: Shipment[];
  research: { done: string[]; active: { id: string; progress: number } | null; licensed: string[] };
  automation: { rules: Rule[]; policies: Policies };
  competitors: Competitor[];
  events: GameEvent[];
  corp: { incorporated: boolean; shares: number; playerShares: number; execs: Division[]; reputation: number; dividends: number; runoff: number };
  ledger: LedgerEntry[];
  lifetime: Partial<Record<LedgerKind, number>>;
  books: DayBook[];
  overdraftDays: number;
  haul?: import('./hauling').HaulState;
  oil?: import('./oil').OilState;
  bankrupt: { reason: string } | null;
  era: number;
  /** Stable content-stage identity; the legacy era remains for save compatibility and existing rules. */
  stageId: import('./stages/types').StageId;
  /** Persisted stage-specific state, keyed by stable stage id. */
  stageState: Partial<Record<import('./stages/types').StageId, Record<string, unknown>>>;
  world?: import('./world').WorldState;
  /** Old saves retain the pre-roadmap era gates and market behavior. */
  legacyProgression: boolean;
  /** Lasting choices shape the village's economic and civic character. */
  charters: { trader: TraderCharter | null };
  /** Four visible axes from 0 (left label) to 100 (right label). */
  values: TownValues;
  stats: { harvests: number; sales: number; plantings: number; produced: Partial<Record<GoodId, number>>; spoiled: number; peopleFed: number; forcedSales: number; overflowLost: number; maxEquity: number; crisisSurvived: boolean };
  unlockedCrops: CropId[];
  milestones: string[];
  seenTips: string[];
  discovered: string[];
  achievements: string[];
  rewarded: string[]; // starter gifts already given
  daily: { key: string; base: { harvests: number; sales: number; plantings: number }; claimed: boolean; streak: number; lastClaimed: string } | null;
  eraReady: boolean;
  herds: Herd[];
  advisor: boolean; // hired farm advisor (paid hourly while working)
  warned: Record<string, number>; // throttles repeated warnings
  log: LogEntry[];
  nextId: number;
}

export type Action =
  | { type: 'plant'; fieldId: number; crop: CropId }
  | { type: 'harvest'; fieldId: number }
  | { type: 'setPlan'; fieldIds: number[]; crop: CropId | null }
  | { type: 'lockPlan'; fieldIds: number[]; locked: boolean }
  | { type: 'assignDriver'; machineId: number; workerId: number | null }
  | { type: 'supplyFactory'; fieldIds: number[]; buildingId: number | null }
  | { type: 'fertilize'; fieldIds: number[]; source: 'fertilizer' | 'manure' }
  | { type: 'irrigate'; fieldIds: number[] }
  | { type: 'sell'; region: RegionId; good: GoodId; qty: number }
  | { type: 'sellToMill'; qty: number; /** wheat if left out */ good?: GoodId }
  | { type: 'barter'; offerId: string }
  | { type: 'haggle'; offerId: string }
  | { type: 'chooseCharter'; charter: TraderCharter }
  | { type: 'startSettlement'; charter?: SettlementCharter }
  | { type: 'buildHomes'; tier: HomeTier; count: number; at?: [number, number]; rot?: number }
  | { type: 'setLarder'; enabled: boolean }
  | { type: 'settleWorker'; workerId: number }
  | { type: 'setCityFunding'; enabled:boolean }
  | { type: 'startCity'; charter: import('./city-state').PoliceCharter }
  | { type: 'changePolice'; charter: import('./city-state').PoliceCharter }
  | { type: 'setZone'; district: DistrictId; zone: import('./city-state').ZoneType }
  | { type: 'trainPolice' }
  | { type: 'setJustice'; policy: import('./city-state').JusticePolicy }
  | { type: 'resolveCityCase'; answer: import('./city-state').JusticePolicy }
  | { type: 'startRegion'; border: import('./region-state').BorderCharter }
  | { type: 'setBorder'; border: import('./region-state').BorderCharter }
  | { type: 'setRoute'; to: import('./region-state').NeighbourId; good: GoodId | null; qty: number }
  | { type: 'giftNeighbour'; to: import('./region-state').NeighbourId; kind: 'goods' | 'cash' }
  | { type: 'signTreaty'; to: import('./region-state').NeighbourId }
  | { type: 'resolveRaid'; answer: 'pursue' | 'absorb' }
  | { type: 'answerDemand'; answer: 'pay' | 'refuse' }
  | { type: 'startNation'; path: import('./nation-state').NationPath }
  | { type: 'launchCampaign'; target: import('./region-state').NeighbourId; stance: import('./nation-state').Stance }
  | { type: 'trainArmy' }
  | { type: 'inviteAlly'; to: import('./region-state').NeighbourId }
  | { type: 'answerAid'; send: boolean }
  | { type: 'castVote'; yes: boolean }
  | { type: 'setEmbargo'; target: import('./region-state').NeighbourId | null }
  | { type: 'hireSpies' }
  | { type: 'hireMercenaries' }
  | { type: 'mediate' }
  | { type: 'startTown'; charter?: SchoolCharter }
  | { type: 'fundTown'; amount: number; direction: 'toTown' | 'repay' }
  | { type: 'setTownTax'; rate: number }
  | { type: 'buildService'; service: ServiceType; district: DistrictId; count?: number; at?: [number, number]; rot?: number }
  | { type: 'toggleService'; serviceId: number }
  | { type: 'changeSchools'; charter: SchoolCharter }
  | { type: 'answerPetition'; accept: boolean }
  | { type: 'buy'; region: RegionId; good: GoodId; qty: number }
  | { type: 'buyPlot'; at?: [number, number] }
  | { type: 'buyParcel'; region: RegionId; ha: number; at?: [number, number] }
  | { type: 'sellField'; fieldId: number }
  | { type: 'hire'; region: RegionId; role: 'hand' | 'manager'; wageFactor: number }
  | { type: 'fire'; workerId: number }
  | { type: 'setAdvisor'; on: boolean }
  | { type: 'setWage'; workerId: number; wageFactor: number }
  | { type: 'train'; workerId: number }
  | { type: 'buyMachine'; region: RegionId; machine: MachineType; lease: boolean }
  | { type: 'sellMachine'; machineId: number }
  | { type: 'sellIdleMachines'; machineIds: number[] }
  | { type: 'service'; machineId: number }
  | { type: 'build'; region: RegionId; building: BuildingType; count?: number; at?: [number, number]; rot?: number }
  | { type: 'moveObject'; region: RegionId; key: string; at: [number, number]; rot?: number }
  | { type: 'clearForest'; region: RegionId; chunks: number[] }
  | { type: 'demolish'; buildingId: number }
  | { type: 'toggleBuilding'; buildingId: number }
  | { type: 'ship'; good: GoodId; qty: number; from: RegionId; to: RegionId; sell?: boolean }
  | { type: 'takeLoan'; amount: number; termDays: number }
  | { type: 'repayLoan'; loanId: number; amount: number }
  | { type: 'buyLand'; region: RegionId; chunks: number[] }
  | { type: 'buyHorseCart' }
  | { type: 'setSettlementPay'; payCut?: number; housingTax?: number }
  | { type: 'zoneLand'; region: RegionId; chunks: number[]; zone: 'res' | 'ind' | 'farm' }
  | { type: 'surveyOil'; region: RegionId; at: [number, number] }
  | { type: 'drillOil'; region: RegionId; at: [number, number] }
  | { type: 'buildRoad'; region: RegionId; from: [number, number]; to: [number, number] }
  | { type: 'removeRoad'; region: RegionId; at: [number, number] }
  | { type: 'upgradeRoad'; region: RegionId; at: [number, number] }
  | { type: 'buildPipe'; region: RegionId; from: [number, number]; to: [number, number]; net?: import('./world').NetKind }
  | { type: 'upgradePipe'; region: RegionId; at: [number, number]; net?: import('./world').NetKind }
  | { type: 'removePipe'; region: RegionId; at: [number, number]; net?: import('./world').NetKind }
  | { type: 'upgradeService'; serviceId: number }
  | { type: 'openFutures'; good: GoodId; contracts: number; days: number }
  | { type: 'closeFutures'; positionId: number }
  | { type: 'acceptContract'; contractId: number }
  | { type: 'deliverContract'; contractId: number }
  | { type: 'setInsurance'; region: RegionId; on: boolean }
  | { type: 'research'; tech: string }
  | { type: 'unlockRegion'; region: RegionId }
  | { type: 'addRule'; rule: Omit<Rule, 'id' | 'lastRun' | 'history'> }
  | { type: 'updateRule'; ruleId: number; patch: Partial<Rule> }
  | { type: 'deleteRule'; ruleId: number }
  | { type: 'setPolicies'; patch: Partial<Policies> }
  | { type: 'incorporate' }
  | { type: 'hireExec'; division: Division }
  | { type: 'fireExec'; division: Division }
  | { type: 'issueShares'; pct: number }
  | { type: 'buyback'; pct: number }
  | { type: 'payDividend'; amount: number }
  | { type: 'diligence'; competitorId: number }
  | { type: 'acquire'; competitorId: number }
  | { type: 'chooseEvent'; eventId: number; option: string }
  | { type: 'restructure' }
  | { type: 'seeTip'; tip: string }
  | { type: 'advanceEra' }
  | { type: 'startDay'; key: string }
  | { type: 'claimDaily'; key: string }
  | { type: 'buyAnimals'; region: RegionId; animal: AnimalId; count: number }
  | { type: 'sellAnimals'; region: RegionId; animal: AnimalId; count: number }
  | { type: 'upgradeBuilding'; buildingId: number }
  | { type: 'consolidateRetail'; region: RegionId }
  | { type: 'upgradeMachine'; machineId: number }
  | { type: 'choosePerk'; workerId: number; perk: PerkId }
  | { type: 'greenhouse'; fieldIds: number[] }
  | { type: 'clearField'; fieldId: number };

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };
