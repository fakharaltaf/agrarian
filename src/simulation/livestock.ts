// Farm animals. Herds live in their buildings, eat every day, produce in proportion to their
// health, breed when they have space, and suffer when hungry or crowded.
import { ANIMALS, GOODS, REGIONS, type AnimalId, type GoodId, type RegionId } from './config';
import { addGoods } from './agriculture';
import { buildingsIn, clamp, levelMult, post, severity } from './core';
import { executeBuy, executeSell, quoteBuy } from './markets';
import { autoBudget } from './operations';
import { warnOnce } from './agriculture';
import type { GameState, Herd } from './types';

const FEEDS: GoodId[] = ['feed', 'corn', 'soymeal', 'wheat']; // eaten in this order, 1:1
const MANURE: Record<AnimalId, number> = { chickens: 0.02, pigs: 0.6, cows: 1.5, sheep: 0.2 };

export const herdOf = (s: GameState, r: RegionId, a: AnimalId) => s.herds.find((h) => h.region === r && h.animal === a);
export const housing = (s: GameState, r: RegionId, a: AnimalId) =>
  buildingsIn(s, r, ANIMALS[a].building).reduce((n, b) => n + ANIMALS[a].perBuilding * levelMult(b.level), 0);
export const animalPrice = (s: GameState, a: AnimalId) => ANIMALS[a].price * s.macro.cpi;

export function livestockDaily(s: GameState) {
  for (const h of s.herds) {
    if (h.count < 0.5) continue;
    const def = ANIMALS[h.animal];
    const inv = s.regions[h.region].inventory;
    // feed: what is in store first, then buy feed if the policy allows
    const need = h.count * def.feedPerDay;
    let got = 0;
    for (const g of FEEDS) {
      const take = Math.min(inv[g], need - got);
      inv[g] -= take;
      got += take;
      if (got >= need) break;
    }
    if (got < need && s.automation.policies.autoFeed && s.era >= 2) {
      const q = quoteBuy(s, h.region, 'feed', need - got);
      if (q.qty > 0 && q.net <= autoBudget(s)) {
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
    if (h.fed < 0.99) warnOnce(s, `hungry-${h.region}-${h.animal}`, 'warning', `Your ${def.name.toLowerCase()} in ${REGIONS[h.region].name} are going hungry — keep feed (or corn) in storage, or turn on automatic feed buying.`, 'livestock', 48);
    if (crowd > 0) warnOnce(s, `crowd-${h.region}-${h.animal}`, 'warning', `Your ${def.name.toLowerCase()} are overcrowded. Build or upgrade housing, or sell some.`, 'livestock', 72);
    if (h.health < 0.35) h.count *= 0.96; // sick, hungry animals die
    // produce
    if (def.product) addGoods(s, h.region, def.product, h.count * def.perDay * h.health * h.fed, 0.45 + 0.45 * h.health);
    inv.manure += h.count * MANURE[h.animal];
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
