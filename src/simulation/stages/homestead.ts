import type { StageModule } from './types';
import { GOODS } from '../config';
import { addGoods } from '../agriculture';
import { freeSpace, log, post, random } from '../core';
import { priceFromInv } from '../markets';
import type { Action, ActionResult, GameState, HomesteadState } from '../types';

export const HOMESTEAD_MILL_PRICE = 2.25;

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
  // A small outlet for the crops the trader introduced, at a deliberately modest exchange rate.
  const crop = s.unlockedCrops.includes('corn') && s.unlockedCrops.includes('potatoes') ? (d % 2 ? 'corn' : 'potatoes') : s.unlockedCrops.includes('corn') ? 'corn' : s.unlockedCrops.includes('potatoes') ? 'potatoes' : null;
  if (crop) offers.push({ id: `${crop}-buyer`, takeGood: crop, takeQty: crop === 'corn' ? 15 : 15, give: { kind: 'good', good: 'wheat', qty: crop === 'corn' ? 12 : 10 }, haggled: false, traded: false });
  t.offers = offers;
}

export function homesteadState(s: GameState): HomesteadState { return stateOf(s); }

function fail(error: string): ActionResult { return { ok: false, error }; }
function ok(note?: string): ActionResult { return { ok: true, note }; }

function handleHomesteadAction(s: GameState, action: Action): ActionResult | null {
  if (action.type !== 'sellToMill' && action.type !== 'barter' && action.type !== 'haggle') return null;
  if (s.legacyProgression) return fail('The village trader is only available on new progression saves.');
  const trader = stateOf(s);
  if (action.type === 'sellToMill') {
    const qty = Math.floor(action.qty), stock = s.regions.heartland.inventory.wheat;
    if (!Number.isFinite(qty) || qty < 1) return fail('Choose at least one wheat.');
    if (qty > stock) return fail(`You have only ${Math.floor(stock)} wheat in the barn.`);
    s.regions.heartland.inventory.wheat -= qty;
    const market = s.markets.heartland.wheat!;
    market.inv += qty;
    market.price = priceFromInv(s, 'wheat', market);
    const received = qty * HOMESTEAD_MILL_PRICE;
    post(s, 'sale', received, `Village mill bought ${qty} wheat @ $${HOMESTEAD_MILL_PRICE.toFixed(2)}`, 'heartland', 'crops');
    s.stats.sales++;
    s.stats.peopleFed += (qty * GOODS.wheat.kcal) / (2000 * 365);
    log(s, 'info', `The village mill took ${qty} wheat at its posted price: $${received.toFixed(2)}.`, 'farm');
    return ok(`Sold ${qty} wheat · $${received.toFixed(2)}.`);
  }
  if (action.type !== 'barter' && action.type !== 'haggle') return null;
  const offerId = action.offerId;
  const offer = trader.offers.find((x) => x.id === offerId);
  if (!offer || offer.traded) return fail('That daily offer has expired.');
  if (action.type === 'haggle') {
    if (offer.haggled) return fail('You have already haggled over this offer today.');
    offer.haggled = true;
    const chance = 0.35 + (trader.mood / 100) * 0.45;
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
