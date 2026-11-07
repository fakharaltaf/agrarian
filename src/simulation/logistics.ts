import { GOODS, REGIONS, type GoodId, type RegionId } from './config';
import { has, log, nextId, post, priceUsd } from './core';
import { closedPort, executeSell, freightPerUnit, haulCost, marketDepth, tariffRate, transitTicks } from './markets';
import { addGoods } from './agriculture';
import type { GameState } from './types';
import { creditCaravan, treatyWith } from './region-state';

/** Extra per unit from selling a good in `to` instead of at home, after freight and tariff (negative = worse). */
export function exportGain(s: GameState, g: GoodId, from: RegionId, to: RegionId) {
  const pTo = priceUsd(s, to, g);
  return pTo * (1 - tariffRate(s, from, to)) - freightPerUnit(s, from, to) - priceUsd(s, from, g);
}

export function portCapacity(s: GameState, r: RegionId) {
  return REGIONS[r].port * (has(s, 'portLogistics') ? 2 : 1);
}

export function shipQuote(s: GameState, g: GoodId, qty: number, from: RegionId, to: RegionId) {
  const freight = freightPerUnit(s, from, to) * qty;
  const value = (s.markets[to][g]?.price ?? GOODS[g].basePrice) * qty;
  const tariff = treatyWith(s, to) ? 0 : tariffRate(s, from, to) * value;
  const haul = haulCost(s, from, qty);
  const sea = from === 'tropics' || to === 'tropics';
  const portFrom = sea ? (REGIONS[from].port ? from : 'coastal') : null;
  return { freight, tariff, haul: haul.cost, total: freight + tariff + haul.cost, ticks: transitTicks(s, from, to), sea, portFrom, haulOk: haul.possible >= qty };
}

/** Moves goods between your regions. Freight, tariffs and loading are paid up front. */
export function shipGoods(s: GameState, g: GoodId, qty: number, from: RegionId, to: RegionId, budget = s.cash, sell = false, dailyBatch = false, caravan = false): string | null {
  if (from === to) return 'Pick a different destination.';
  if (caravan && !s.markets[to][g]) return 'That neighbour has no market for this good.';
  if (!caravan && !s.regions[to].unlocked) return `You have no operations in ${REGIONS[to].name}.`;
  if (qty <= 0 || s.regions[from].inventory[g] < qty) return 'Not enough stock to ship.';
  if (closedPort(s, from, to)) return 'This route is closed by an embargo or port closure.';
  const q = shipQuote(s, g, qty, from, to);
  if (!q.haulOk) return 'Not enough haulage capacity today to load this shipment.';
  if (q.total > budget) return `Shipping costs $${Math.round(q.total).toLocaleString()}.`;
  if (q.portFrom) {
    const cap = portCapacity(s, q.portFrom);
    if (s.regions[q.portFrom].portToday + qty > cap) return `Port capacity at ${REGIONS[q.portFrom].name} is full for today.`;
    s.regions[q.portFrom].portToday += qty;
  }
  s.regions[from].inventory[g] -= qty;
  const h = haulCost(s, from, qty);
  s.regions[from].truckToday += h.viaTruck;
  s.regions[from].haulToday += h.viaHired;
  post(s, 'haulage', -h.cost, 'Loading haulage', from);
  post(s, 'shipping', -(q.freight + q.tariff), `${caravan ? 'Caravan' : 'Freight'}${q.tariff ? ' + tariff' : ''}: ${GOODS[g].name} → ${REGIONS[to].name}`, caravan ? from : to, 'logistics');
  const batchDay = dailyBatch ? Math.floor(s.tick / 24) : -1;
  const arrives = (dailyBatch ? (batchDay + 1) * 24 : s.tick) + q.ticks;
  const load = dailyBatch && s.shipments.find(x => x.batchDay === batchDay && x.from === from && x.to === to && x.good === g && x.sell === (sell || caravan) && !!x.caravan === caravan);
  if (load) { load.qty += qty; load.cost += q.total; load.arrives = Math.max(load.arrives, arrives); }
  else s.shipments.push({ id: nextId(s), good: g, qty, from, to, arrives, cost: q.total, sell: (sell || caravan) && !!s.markets[to][g], batchDay, ...(caravan ? { caravan: true } : {}) });
  return null;
}

export function shipmentsTick(s: GameState) {
  for (const sh of [...s.shipments]) {
    if (s.tick < sh.arrives) continue;
    if (closedPort(s, sh.from, sh.to)) {
      sh.arrives = s.tick + 24; // stuck at port until it reopens
      continue;
    }
    if (sh.sell) {
      // sold off the lorry a slice an hour, so one lot doesn't crash the destination market
      if (s.tick === sh.arrives) log(s, 'info', `${Math.round(sh.qty)} ${GOODS[sh.good].name.toLowerCase()} arrived in ${REGIONS[sh.to].name} and is being sold.`, 'logistics');
      const slice = Math.min(sh.qty, Math.max(50, marketDepth(s, sh.to, sh.good) * 0.15));
      s.regions[sh.to].inventory[sh.good] += slice;
      const sale = executeSell(s, sh.to, sh.good, slice, `${sh.caravan ? 'Caravan' : 'Export'} sale: ${GOODS[sh.good].name} in ${REGIONS[sh.to].name}`), sold = sale.qty;
      if (sh.caravan) creditCaravan(s, sh.to, sh.good, sale.gross);
      s.regions[sh.to].inventory[sh.good] -= slice - sold;
      sh.qty -= sold;
      if (sold <= 0 && sh.qty >= 1) addGoods(s, sh.caravan ? sh.from : sh.to, sh.good, sh.qty); // market won't take it: store what's left (caravans bring it home)
      if (sh.qty < 1 || sold <= 0) s.shipments.splice(s.shipments.indexOf(sh), 1);
      continue;
    }
    s.shipments.splice(s.shipments.indexOf(sh), 1);
    addGoods(s, sh.to, sh.good, sh.qty);
    log(s, 'info', `${Math.round(sh.qty)} ${GOODS[sh.good].name.toLowerCase()} arrived in ${REGIONS[sh.to].name}.`, 'logistics');
  }
}
