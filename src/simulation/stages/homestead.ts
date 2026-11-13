import type { StageModule } from './types';
import { GOODS } from '../config';
import { addGoods } from '../agriculture';
import { freeSpace, log, post, random } from '../core';
import { priceFromInv } from '../markets';
import type { Action, ActionResult, GameState, HomesteadState } from '../types';
import type { GoodId } from '../config';

/** What the village pays for each crop you can grow before the market opens: about three quarters of its market price. */
export const HOMESTEAD_PRICES: Partial<Record<GoodId, number>> = { wheat: 2.25, corn: 1.9, potatoes: 1.5 };
export const HOMESTEAD_MILL_PRICE = HOMESTEAD_PRICES.wheat!;

export function createHomesteadState(): HomesteadState { return { day: -1, mood: 50, offers: [] }; }

function stateOf(s: GameState) {
  return s.stageState.homestead as unknown as HomesteadState;
}

/** A small daily board. Trades conserve inventory; the trader's stock is finite each day. */
export function refreshHomestead(s: GameState) {
  if (s.legacyProgression) return;
  const t = stateOf(s), d = Math.floor(s.tick / 24);
  if (t.day === d) return;
  t.day = d;
  t.mood += Math.sign(50 - t.mood);
  const variable = (base: number) => base + Math.floor(random(s) * 3);
  const offers: HomesteadState['offers'] = [
    { id: 'corn-seed', takeGood: 'wheat', takeQty: 12 + Math.floor(random(s) * 3), give: { kind: 'seed', crop: 'corn', qty: variable(7) }, haggled: false, traded: false },
    { id: 'potato-seed', takeGood: 'wheat', takeQty: 18 + Math.floor(random(s) * 3), give: { kind: 'seed', crop: 'potatoes', qty: variable(7) }, haggled: false, traded: false },
    { id: 'fertilizer', takeGood: 'wheat', takeQty: 8 + Math.floor(random(s) * 3), give: { kind: 'good', good: 'fertilizer', qty: variable(12) }, haggled: false, traded: false },
  ];
  if (s.charters?.trader === 'fair') {
    for (const offer of offers) offer.give.qty = Math.ceil(offer.give.qty * 1.1);
  }
  t.offers = offers;
}

export function homesteadState(s: GameState): HomesteadState { return stateOf(s); }
export function traderHaggleChance(s: GameState) {
  const trader = stateOf(s);
  return Math.min(0.95, 0.35 + (trader.mood / 100) * 0.45 + (s.charters.trader === 'shrewd' ? 0.2 : 0));
}

function fail(error: string): ActionResult { return { ok: false, error }; }
function ok(note?: string): ActionResult { return { ok: true, note }; }

function handleHomesteadAction(s: GameState, action: Action): ActionResult | null {
  if (action.type === 'chooseCharter') {
    if (s.legacyProgression || s.stageId !== 'homestead' || !s.eraReady) return fail('The trader charter is offered when your first market day is ready.');
    if (s.charters.trader) return fail('You already chose the village trader charter.');
    s.charters.trader = action.charter;
    const trader = stateOf(s);
    if (action.charter === 'fair') {
      s.values.prosperityFairness = 68;
      trader.mood = 68;
      for (const offer of trader.offers) offer.give.qty = Math.ceil(offer.give.qty * 1.1);
      s.corp.reputation = Math.min(100, s.corp.reputation + 4);
      return ok('Fair charter · the trader trusts you; barter offers give 10% more.');
    }
    s.values.prosperityFairness = 32;
    trader.mood = 42;
    s.corp.reputation = Math.max(0, s.corp.reputation - 8);
    return ok('Shrewd charter · haggling is stronger, but reputation falls by 8.');
  }
  if (action.type !== 'sellToMill' && action.type !== 'barter' && action.type !== 'haggle') return null;
  if (s.legacyProgression) return fail('The village trader is only available on new progression saves.');
  const trader = stateOf(s);
  if (action.type === 'sellToMill') {
    const good = action.good ?? 'wheat', price = HOMESTEAD_PRICES[good], name = GOODS[good]?.name.toLowerCase();
    if (!price) return fail('The village does not buy that.');
    const qty = Math.floor(action.qty), stock = s.regions.heartland.inventory[good];
    if (!Number.isFinite(qty) || qty < 1) return fail(`Choose at least one ${name}.`);
    if (qty > stock) return fail(`You have only ${Math.floor(stock)} ${name} in the barn.`);
    s.regions.heartland.inventory[good] -= qty;
    const market = s.markets.heartland[good];
    if (market) { market.inv += qty; market.price = priceFromInv(s, good, market); }
    const received = qty * price, buyer = good === 'potatoes' ? 'Village market' : 'Village mill';
    post(s, 'sale', received, `${buyer} bought ${qty} ${name} @ $${price.toFixed(2)}`, 'heartland', 'crops');
    s.stats.sales++;
    s.stats.peopleFed += (qty * GOODS[good].kcal) / (2000 * 365);
    log(s, 'info', `The ${buyer.toLowerCase()} took ${qty} ${name} at its posted price: $${received.toFixed(2)}.`, 'farm');
    return ok(`Sold ${qty} ${name} · $${received.toFixed(2)}.`);
  }
  if (action.type !== 'barter' && action.type !== 'haggle') return null;
  const offerId = action.offerId;
  const offer = trader.offers.find((x) => x.id === offerId);
  if (!offer || offer.traded) return fail('That daily offer has expired.');
  if (action.type === 'haggle') {
    if (offer.haggled) return fail('You have already haggled over this offer today.');
    offer.haggled = true;
    const chance = traderHaggleChance(s);
    if (random(s) < chance) {
      offer.give.qty += Math.max(1, Math.ceil(offer.give.qty * 0.15));
      trader.mood = Math.min(100, trader.mood + 8);
      log(s, 'opportunity', `The trader agrees to your terms on ${offer.id.replace('-', ' ')}.`, 'farm');
      return ok('They nod. The offer is better.');
    }
    trader.mood = Math.max(0, trader.mood - 10);
    log(s, 'info', 'The trader holds firm. Your daily offer is unchanged.', 'farm');
    return ok('They hold firm. Try another offer tomorrow.');
  }
  if (s.regions.heartland.inventory[offer.takeGood] < offer.takeQty) return fail(`Need ${offer.takeQty} ${GOODS[offer.takeGood].name.toLowerCase()} in the barn.`);
  if (offer.give.kind === 'good' && freeSpace(s, 'heartland', offer.give.good) < offer.give.qty) return fail('The barn is too full. Make room before trading.');
  s.regions.heartland.inventory[offer.takeGood] -= offer.takeQty;
  if (offer.give.kind === 'seed') s.seeds[offer.give.crop] += offer.give.qty;
  else addGoods(s, 'heartland', offer.give.good, offer.give.qty);
  offer.traded = true;
  const output = offer.give.kind === 'seed' ? `${offer.give.qty} ${GOODS[offer.give.crop].name.toLowerCase()} seeds` : `${offer.give.qty} ${GOODS[offer.give.good].name.toLowerCase()}`;
  log(s, 'opportunity', `Bartered ${offer.takeQty} wheat for ${output}.`, 'farm');
  return ok(`Trade complete · ${output}.`);
}

export const homestead: StageModule = {
  id: 'homestead', title: 'Homestead', legacyEras: [1], eraUnlocks: { 1: () => true },
  actionTypes: ['plant','harvest','sell','sellToMill','barter','haggle','buyPlot'],
  tips: ['plant','time','harvest','sell','impact','replant','speed','land'], discoveries: [],
  tick: refreshHomestead,
  handleAction: handleHomesteadAction,
  createState: () => createHomesteadState() as unknown as Record<string, unknown>,
};
