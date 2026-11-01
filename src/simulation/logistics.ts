import { GOODS, REGIONS, type GoodId, type RegionId } from './config';
import { has, log, nextId, post } from './core';
import { closedPort, freightPerUnit, haulCost, tariffRate, transitTicks } from './markets';
import { addGoods } from './agriculture';
import type { GameState } from './types';

export function portCapacity(s: GameState, r: RegionId) {
  return REGIONS[r].port * (has(s, 'portLogistics') ? 2 : 1);
}

export function shipQuote(s: GameState, g: GoodId, qty: number, from: RegionId, to: RegionId) {
  const freight = freightPerUnit(s, from, to) * qty;
  const value = (s.markets[to][g]?.price ?? GOODS[g].basePrice) * qty;
  const tariff = tariffRate(s, from, to) * value;
  const haul = haulCost(s, from, qty);
  const sea = from === 'tropics' || to === 'tropics';
  const portFrom = sea ? (REGIONS[from].port ? from : 'coastal') : null;
  return { freight, tariff, haul: haul.cost, total: freight + tariff + haul.cost, ticks: transitTicks(s, from, to), sea, portFrom, haulOk: haul.possible >= qty };
}

/** Moves goods between your regions. Freight, tariffs and loading are paid up front. */
export function shipGoods(s: GameState, g: GoodId, qty: number, from: RegionId, to: RegionId, budget = s.cash): string | null {
  if (from === to) return 'Pick a different destination.';
  if (!s.regions[to].unlocked) return `You have no operations in ${REGIONS[to].name}.`;
  if (qty <= 0 || s.regions[from].inventory[g] < qty) return 'Not enough stock to ship.';
  if (closedPort(s, from, to)) return 'This route is closed by an embargo or port closure.';
  const q = shipQuote(s, g, qty, from, to);
  if (!q.haulOk) return 'Not enough haulage capacity today to load this shipment.';
  if (q.portFrom) {
    const cap = portCapacity(s, q.portFrom);
    if (s.regions[q.portFrom].portToday + qty > cap) return `Port capacity at ${REGIONS[q.portFrom].name} is full for today.`;
    s.regions[q.portFrom].portToday += qty;
  }
  if (q.total > budget) return `Shipping costs $${Math.round(q.total).toLocaleString()}.`;
  s.regions[from].inventory[g] -= qty;
  const h = haulCost(s, from, qty);
  s.regions[from].truckToday += h.viaTruck;
  s.regions[from].haulToday += h.viaHired;
  post(s, 'haulage', -h.cost, 'Loading haulage', from);
  post(s, 'shipping', -(q.freight + q.tariff), `Freight${q.tariff ? ' + tariff' : ''}: ${GOODS[g].name} → ${REGIONS[to].name}`, to, 'logistics');
  s.shipments.push({ id: nextId(s), good: g, qty, from, to, arrives: s.tick + q.ticks, cost: q.total });
  return null;
}

export function shipmentsTick(s: GameState) {
  for (const sh of [...s.shipments]) {
    if (s.tick < sh.arrives) continue;
    if (closedPort(s, sh.from, sh.to)) {
      sh.arrives = s.tick + 24; // stuck at port until it reopens
      continue;
    }
    s.shipments.splice(s.shipments.indexOf(sh), 1);
    addGoods(s, sh.to, sh.good, sh.qty);
    log(s, 'info', `${Math.round(sh.qty)} ${GOODS[sh.good].name.toLowerCase()} arrived in ${REGIONS[sh.to].name}.`, 'logistics');
  }
}
