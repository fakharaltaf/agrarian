// Shared primitives every system uses. The ledger in post() is the ONLY way cash changes.
import {
  BUILDINGS, CONFIG, CROPS, DAYS_PER_YEAR, GOODS, OPEX_KINDS, REGIONS, REVENUE_KINDS, SEASONS, TICKS_PER_DAY, type BuildingType, type CropId, type GoodId, type LedgerKind, type RegionId,
} from './config';
import type { Building, Division, EventKind, GameEvent, GameState, LogLevel, Market } from './types';

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const day = (s: GameState) => Math.floor(s.tick / TICKS_PER_DAY);
export const hour = (s: GameState) => s.tick % TICKS_PER_DAY;
export const seasonOf = (s: GameState) => SEASONS[Math.floor((((Math.floor(s.tick / TICKS_PER_DAY) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) / 30)];
export const known = (s: GameState, id: string) => s.discovered.includes(id);
/** Upgrade levels multiply what a building holds or makes. */
export const levelMult = (level: number) => [1, 1.8, 2.5][Math.max(0, Math.min(2, (level || 1) - 1))];
export const nextId = (s: GameState) => s.nextId++;

/** mulberry32 step; state lives on GameState so saves replay identically. */
export function random(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const gauss = (s: GameState) => {
  const u = Math.max(1e-9, random(s));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random(s));
};
export const pick = <T>(s: GameState, xs: readonly T[]): T => xs[Math.floor(random(s) * xs.length)];

// ---------------------------------------------------------------- ledger

const NON_CASH: LedgerKind[] = ['depreciation'];
const TAXABLE = new Set<LedgerKind>([...REVENUE_KINDS, ...OPEX_KINDS, 'interest', 'futures', 'insurancePayout', 'prize', 'depreciation']);

export function post(s: GameState, kind: LedgerKind, amount: number, memo: string, region: RegionId = 'heartland', division: Division = divisionOf(kind)) {
  amount = round2(amount);
  if (amount === 0) return;
  if (!NON_CASH.includes(kind)) s.cash = round2(s.cash + amount);
  s.lifetime[kind] = round2((s.lifetime[kind] ?? 0) + amount);
  const b = todayBook(s);
  b.kinds[kind] = round2((b.kinds[kind] ?? 0) + amount);
  b.regions[region] = round2((b.regions[region] ?? 0) + amount);
  b.divisions[division] = round2((b.divisions[division] ?? 0) + amount);
  if (TAXABLE.has(kind)) b.op[region] = round2((b.op[region] ?? 0) + amount);
  // Merge repeated charges (wages, fuel, power...) into one line per kind/region/memo/day so the ledger stays readable.
  const d = Math.floor(s.tick / 24);
  let merged = false;
  for (let i = s.ledger.length - 1; i >= Math.max(0, s.ledger.length - 40); i--) {
    const e = s.ledger[i];
    if (Math.floor(e.tick / 24) !== d) break;
    if (e.kind === kind && e.region === region && e.memo === memo) {
      e.amount = round2(e.amount + amount);
      merged = true;
      break;
    }
  }
  if (!merged) s.ledger.push({ tick: s.tick, kind, amount, region, division, memo });
  if (s.ledger.length > CONFIG.ledgerLength) s.ledger.splice(0, s.ledger.length - CONFIG.ledgerLength);
}

function divisionOf(kind: LedgerKind): Division {
  if (['haulage', 'shipping'].includes(kind)) return 'logistics';
  if (['electricity', 'grid'].includes(kind)) return 'energy';
  if (['futures', 'margin', 'contract'].includes(kind)) return 'trading';
  if (['interest', 'tax', 'loanIn', 'loanRepay', 'sharesIssued', 'dividends', 'buyback', 'legal', 'acquisition', 'salaries', 'research', 'fines'].includes(kind)) return 'corporate';
  return 'crops';
}
export const buildingDivision = (t: BuildingType): Division =>
  t === 'ranch' || t === 'dairy' ? 'livestock' : BUILDINGS[t].category === 'energy' ? 'energy' : BUILDINGS[t].category === 'research' ? 'corporate' : BUILDINGS[t].category === 'storage' ? 'logistics' : t === 'distribution' ? 'logistics' : 'processing';
export const goodDivision = (g: GoodId): Division => (g === 'meat' || g === 'milk' ? 'livestock' : GOODS[g].kind === 'processed' ? 'processing' : 'crops');

export function todayBook(s: GameState) {
  const d = day(s);
  let b = s.books[s.books.length - 1];
  if (!b || b.day !== d) {
    b = { day: d, kinds: {}, regions: {}, divisions: {}, op: {}, cash: s.cash, debt: 0, equity: 0, produced: 0 };
    s.books.push(b);
    if (s.books.length > CONFIG.booksDays) s.books.shift();
  }
  return b;
}

export function log(s: GameState, level: LogLevel, text: string, page?: string) {
  s.log.push({ id: nextId(s), tick: s.tick, level, text, page });
  if (s.log.length > CONFIG.logLength) s.log.splice(0, s.log.length - CONFIG.logLength);
}

// ---------------------------------------------------------------- lookups

export const has = (s: GameState, tech: string) => s.research.done.includes(tech);
export const buildingsIn = (s: GameState, r: RegionId, t?: BuildingType) => s.buildings.filter((b) => b.region === r && (!t || b.type === t));
export const execOn = (s: GameState, d: Division) => s.corp.execs.includes(d);

/** Local-currency amount → USD at today's exchange rate. */
export const usd = (s: GameState, r: RegionId, local: number) => local * s.regions[r].fx;
export const priceUsd = (s: GameState, r: RegionId, g: GoodId) => s.markets[r][g]?.price ?? GOODS[g].basePrice * s.macro.cpi;
export const refPrice = (s: GameState, g: GoodId) => GOODS[g].basePrice * s.macro.cpi;

/** Wages and land are local-currency costs: local inflation and the exchange rate both move them. */
export const marketWage = (s: GameState, r: RegionId) => usd(s, r, REGIONS[r].wage * s.regions[r].cpi);
export const electricityPrice = (s: GameState, r: RegionId) => 0.12 * s.macro.cpi * Math.sqrt(s.macro.energy) * (r === 'arid' ? 1.15 : r === 'tropics' ? 0.9 : 1);
export const fuelPrice = (s: GameState, r: RegionId) => priceUsd(s, r, 'fuel');
export const landPricePerHa = (s: GameState, r: RegionId) => (REGIONS[r].landPrice / REGIONS[r].fx0) * s.regions[r].cpi * s.regions[r].fx * (1 + 0.02 * s.regions[r].parcelsBought);

export function seedCost(s: GameState, crop: CropId) {
  let m = 1;
  if (has(s, 'improvedSeeds')) m += 0.2;
  if (has(s, 'droughtResistant')) m += 0.15;
  if (has(s, 'pestResistant')) m += 0.1;
  return CROPS[crop].seedCost * m * s.macro.cpi;
}

export function capacity(s: GameState, r: RegionId) {
  let dry = r === 'heartland' ? CONFIG.baseDryStorage : 0;
  let cold = 0;
  for (const b of buildingsIn(s, r)) {
    dry += (BUILDINGS[b.type].dry ?? 0) * levelMult(b.level);
    cold += (BUILDINGS[b.type].cold ?? 0) * levelMult(b.level);
  }
  return { dry, cold };
}

/** Units held per storage class. Cold goods overflow into dry space (and spoil faster there). */
export function stored(s: GameState, r: RegionId) {
  const inv = s.regions[r].inventory;
  let dry = 0, cold = 0;
  for (const g in inv) {
    const q = inv[g as GoodId];
    if (!q) continue;
    if (GOODS[g as GoodId].storage === 'cold') cold += q;
    else dry += q;
  }
  const cap = capacity(s, r);
  const coldOverflow = Math.max(0, cold - cap.cold);
  return { dry: dry + coldOverflow, cold: Math.min(cold, cap.cold), coldOverflow, cap };
}

export function freeSpace(s: GameState, r: RegionId, g: GoodId) {
  const st = stored(s, r);
  const dryFree = Math.max(0, st.cap.dry - st.dry);
  return GOODS[g].storage === 'cold' ? Math.max(0, st.cap.cold - st.cold) + dryFree : dryFree;
}

export function marketOf(s: GameState, r: RegionId, g: GoodId): Market | undefined {
  return s.markets[r][g];
}

/** Value of inventory at today's market prices (mark-to-market). */
export function inventoryValue(s: GameState) {
  let v = 0;
  for (const r of Object.values(s.regions)) for (const g in r.inventory) v += (r.inventory[g as GoodId] || 0) * priceUsd(s, r.id, g as GoodId);
  for (const c in s.seeds) v += s.seeds[c as CropId] * CROPS[c as CropId].seedCost;
  return v;
}

export function fixedAssets(s: GameState) {
  const land = s.fields.reduce((a, f) => a + f.cost, 0);
  const machines = s.machines.reduce((a, m) => a + Math.max(0, m.cost - m.depreciated), 0);
  const buildings = s.buildings.reduce((a, b) => a + Math.max(0, b.cost - b.depreciated), 0);
  return { land, machines, buildings };
}

export const debt = (s: GameState) => s.loans.reduce((a, l) => a + l.balance, 0) + Math.max(0, -s.cash);

export function totalAssets(s: GameState) {
  const fa = fixedAssets(s);
  return Math.max(0, s.cash) + s.marginAccount + inventoryValue(s) + fa.land + fa.machines + fa.buildings;
}
export const equity = (s: GameState) => totalAssets(s) - debt(s);

export function sumBooks(s: GameState, days: number, kinds?: LedgerKind[]) {
  const from = day(s) - days + 1;
  let t = 0;
  for (let i = s.books.length - 1; i >= 0 && s.books[i].day >= from; i--)
    for (const k in s.books[i].kinds) if (!kinds || kinds.includes(k as LedgerKind)) t += s.books[i].kinds[k as LedgerKind]!;
  return t;
}

// ---------------------------------------------------------------- events

export const activeEvents = (s: GameState, kind: EventKind, r?: RegionId, g?: GoodId): GameEvent[] =>
  s.events.filter((e) => e.kind === kind && s.tick >= e.start && s.tick < e.end && (!r || !e.region || e.region === r) && (!g || !e.good || e.good === g));
export const severity = (s: GameState, kind: EventKind, r?: RegionId, g?: GoodId) => activeEvents(s, kind, r, g).reduce((a, e) => Math.max(a, e.severity), 0);

// ---------------------------------------------------------------- dedicated supply

/** The crop a factory takes in, if fields can grow it for that factory. */
export const factoryCrop = (b: Building): CropId | null => {
  const ins = Object.keys(BUILDINGS[b.type].recipe?.inputs ?? {}) as GoodId[];
  return ins.length === 1 && ins[0] in CROPS ? (ins[0] as CropId) : null;
};

/** Most a factory holds in reserve: a week at full capacity. Surplus harvest stays free to sell. */
export const reserveCap = (b: Building) => {
  const rec = BUILDINGS[b.type].recipe!;
  return Object.values(rec.inputs)[0]! * rec.batchesPerHour * levelMult(b.level) * 24 * 7;
};

/** Stock of a good held for factories in a region (never more than is actually in store). Pass a factory to leave out its own share and that of its same-type siblings, which share one pool. */
export function reservedStock(s: GameState, r: RegionId, g: GoodId, except?: Building) {
  const held = s.buildings.reduce((a, b) => a + (b.region === r && b.type !== except?.type && factoryCrop(b) === g ? b.reserved : 0), 0);
  return Math.min(held, s.regions[r].inventory[g]);
}
