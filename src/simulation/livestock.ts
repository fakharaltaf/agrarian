import { townIndustryFactor } from './town-state';
import { larderReserve } from './stages/settlement';
// Farm animals. Herds live in their buildings, eat every day, produce in proportion to their
// health, breed when they have space, and suffer when hungry or crowded.
import { ANIMALS, BUILDINGS, COWS_PER_DAIRY_BATCH, GOODS, REGIONS, type AnimalId, type GoodId, type RegionId } from './config';
import { addGoods } from './agriculture';
import { buildingsIn, clamp, levelMult, post, reservedStock, severity } from './core';
import { avg30, executeBuy, executeSell, quoteBuy } from './markets';
import { essentialBudget } from './operations';
import { warnOnce } from './agriculture';
import type { GameState, Herd } from './types';

export const FEEDS: GoodId[] = ['feed', 'corn', 'soymeal', 'wheat']; // eaten in this order, 1:1
export const MANURE: Record<AnimalId, number> = { chickens: 0.02, pigs: 0.6, cows: 1.5, sheep: 0.2 };

export const herdOf = (s: GameState, r: RegionId, a: AnimalId) => s.herds.find((h) => h.region === r && h.animal === a);
export const housing = (s: GameState, r: RegionId, a: AnimalId) =>
  buildingsIn(s, r, ANIMALS[a].building).reduce((n, b) => n + ANIMALS[a].perBuilding * levelMult(b.level), 0);
export const animalPrice = (s: GameState, a: AnimalId) => ANIMALS[a].price * s.macro.cpi;

export function livestockDaily(s: GameState) {
  for (const h of s.herds) {
    if (h.count < 0.5) continue;
    const def = ANIMALS[h.animal];
    const inv = s.regions[h.region].inventory;
    // cows a dairy milks are fed and milked there (their feed and milk run through the dairy's recipe)
    const inDairy = h.animal === 'cows' ? Math.min(h.count, s.buildings.reduce((a, b) => a + (b.type === 'dairy' && b.region === h.region && b.active ? b.stats.out * COWS_PER_DAIRY_BATCH : 0), 0)) : 0;
    const own = 1 - inDairy / h.count; // share of the herd looked after in the cowshed
    // feed: what is in store first, then buy feed if the policy allows
    const need = h.count * def.feedPerDay * own;
    let got = 0;
    for (const g of FEEDS) {
      // stock your factories need comes first: reserved input and a day of what running mills use
      const millDay = s.buildings.reduce((a, b) => a + (b.region === h.region && b.active && BUILDINGS[b.type].recipe?.inputs[g] ? BUILDINGS[b.type].recipe!.inputs[g]! * BUILDINGS[b.type].recipe!.batchesPerHour * levelMult(b.level) * townIndustryFactor(s,b.region) * 24 : 0), 0);
      const take = Math.max(0, Math.min(inv[g] - reservedStock(s, h.region, g) - (h.region === 'heartland' ? larderReserve(s, g) : 0) - millDay, need - got));
      inv[g] -= take;
      got += take;
      if (got >= need) break;
    }
    if (got < need && s.automation.policies.autoFeed && s.era >= 2) {
      // buy no more than the market can supply at up to twice its usual price; the rest waits for tomorrow
      let q = quoteBuy(s, h.region, 'feed', need - got);
      const fair = 2 * avg30(s, h.region, 'feed');
      for (let i = 0; i < 12 && q.qty > 1 && q.gross / q.qty > fair; i++) q = quoteBuy(s, h.region, 'feed', q.qty * 0.6);
      if (q.gross / Math.max(1, q.qty) > fair) q = { ...q, qty: 0 };
      if (q.qty > 0 && q.net <= essentialBudget(s)) {
        const bought = executeBuy(s, h.region, 'feed', q.qty, `Feed for ${def.name.toLowerCase()}`).qty;
        inv.feed -= bought; // eaten straight away
        got += bought;
      }
    }
    h.fed = need > 0 ? Math.min(1, got / need) : 1;
    // health
    const cap = housing(s, h.region, h.animal);
    const crowd = cap > 0 ? Math.max(0, h.count / cap - 1) : 1;
    const herder = s.workers.some((w) => w.region === h.region && w.perk === 'herder') ? 0.03 : 0;
    h.health = clamp(h.health + (h.fed >= 0.99 ? 0.05 : -(1 - h.fed) * 0.25) - crowd * 0.2 + herder - 0.12 * severity(s, 'livestockDisease', h.region), 0, 1);
    if (h.fed < 0.99) warnOnce(s, `hungry-${h.region}-${h.animal}`, 'warning', `Your ${def.name.toLowerCase()} in ${REGIONS[h.region].name} are going hungry. Keep feed or corn in storage (a feed mill on your own corn is cheapest), turn on automatic feed buying, or keep fewer animals — the market can only supply so much feed a day at a fair price.`, 'livestock', 48);
    if (crowd > 0) warnOnce(s, `crowd-${h.region}-${h.animal}`, 'warning', `Your ${def.name.toLowerCase()} are overcrowded. Build or upgrade housing, or sell some.`, 'livestock', 72);
    if (h.health < 0.35) h.count *= 0.96; // sick, hungry animals die
    // produce
    if (def.product) {
      const made = h.count * own * def.perDay * h.health * h.fed;
      addGoods(s, h.region, def.product, made, 0.45 + 0.45 * h.health);
      s.stats.produced[def.product] = (s.stats.produced[def.product] ?? 0) + made;
    }
    inv.manure += h.count * own * MANURE[h.animal];
    // breed
    if (h.health > 0.7 && h.fed > 0.95 && h.count >= 2 && h.count < cap) h.count = Math.min(cap, h.count * (1 + def.breedPerDay));
  }
  s.herds = s.herds.filter((h) => h.count >= 0.5);
}

export function buyAnimals(s: GameState, r: RegionId, a: AnimalId, n: number): string | null {
  const room = housing(s, r, a) - (herdOf(s, r, a)?.count ?? 0);
  if (housing(s, r, a) === 0) return `Build a ${ANIMALS[a].building === 'coop' ? 'chicken coop' : ANIMALS[a].building} first.`;
  if (n > room + 1e-6) return `There is room for ${Math.floor(room)} more.`;
  const cost = n * animalPrice(s, a);
  if (cost > s.cash) return `${n} ${ANIMALS[a].name.toLowerCase()} cost $${Math.round(cost).toLocaleString()}.`;
  post(s, 'purchases', -cost, `Bought ${n} ${ANIMALS[a].name.toLowerCase()}`, r, 'livestock');
  const h = herdOf(s, r, a);
  if (h) {
    h.health = (h.health * h.count + 0.9 * n) / (h.count + n);
    h.count += n;
  } else s.herds.push({ region: r, animal: a, count: n, health: 0.9, fed: 1 } satisfies Herd);
  return null;
}

/** Sends animals to market as meat (at the market price, with the usual price impact and haulage). */
export function sellAnimals(s: GameState, r: RegionId, a: AnimalId, n: number): string | null {
  const h = herdOf(s, r, a);
  if (!h || n > Math.floor(h.count) || n <= 0) return 'Not that many animals.';
  const meat = n * ANIMALS[a].meat * (0.5 + 0.5 * h.health);
  h.count -= n;
  s.regions[r].inventory.meat += meat;
  executeSell(s, r, 'meat', meat, `Sold ${n} ${ANIMALS[a].name.toLowerCase()} for meat`); // anything not hauled today stays in store
  s.herds = s.herds.filter((x) => x.count >= 0.5);
  return null;
}

export const animalGood = (a: AnimalId) => GOODS[ANIMALS[a].product ?? 'meat'];
