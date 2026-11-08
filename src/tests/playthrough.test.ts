// Opt-in (slow): a brand-new farm plays from Homestead into Nation through real actions only.
// Run with PLAYTHROUGH=1. Prints chapter entry ticks for pacing review.
import { expect, it } from 'vitest';
import { createGame, step } from '../simulation/engine';
import { cityActive } from '../simulation/city-state';
import { regionActive, regionOf } from '../simulation/region-state';
import { nationActive, nationOf } from '../simulation/nation-state';
import { townOf, townWorkforce } from '../simulation/town-state';
import { soldiers, campaignOdds } from '../simulation/stages/nation';
import { plannedServiceCost } from '../simulation/stages/town';
import { NEIGHBOUR_IDS } from '../simulation/region-state';
import { nationBotAct } from './bot';
const flow = (x: Record<string, number | undefined>) => Object.entries(x).reduce((n, [k, v]) => n + (k === 'depreciation' ? 0 : v ?? 0), 0);
// @ts-expect-error Node environment only
it.skipIf(!process.env.PLAYTHROUGH)('A new farm reaches Region, trades by caravan and enters Nation, no grants', () => {
  const s = createGame(1002), at: Record<string, number> = {};
  for (let i = 0; i < 40000 && !(nationActive(s) && s.tick > (at.nation ?? 1e9) + 24 * 30); i++) {
    nationBotAct(s); step(s);
    if (cityActive(s)) at.city ??= s.tick;
    if (regionActive(s)) at.region ??= s.tick;
    if (regionOf(s).raids) at.firstRaid ??= s.tick;
    if (nationActive(s)) at.nation ??= s.tick;
  }
  console.log('Chapter pacing (ticks; 1 tick = 1 s at 1x)', JSON.stringify({ ...at, end: s.tick, caravans: regionOf(s).caravans, raids: regionOf(s).raids, wins: nationOf(s).wins, losses: nationOf(s).losses, fallen: nationOf(s).casualties }));
  const t = townOf(s), b = t.services.find(x => x.type === 'barracks');
  console.log('Army', JSON.stringify({ barracks: b && { staffed: b.staffed, funded: b.funded }, soldiers: soldiers(s), supply: nationOf(s).supply, drill: nationOf(s).drill, treasury: Math.round(t.cash), odds: NEIGHBOUR_IDS.map(id => campaignOdds(s, id, 'raid').toFixed(2)), workforce: townWorkforce(s), publicJobs: t.publicJobs, company: Math.round(s.cash), cpi: +s.macro.cpi.toFixed(2), upkeepPerDay: Math.round(plannedServiceCost(s)), tax: Math.round(t.lastTax), services: t.services.length, incorporated: s.corp.incorporated, debt: Math.round(s.loans?.reduce?.((n: number, l: { balance: number }) => n + l.balance, 0) ?? 0) }));
  expect(s.bankrupt, JSON.stringify(s.bankrupt)).toBeNull();
  expect(regionActive(s)).toBe(true); expect(regionOf(s).caravans).toBeGreaterThan(0);
  expect(nationActive(s)).toBe(true);
  // Known gap (A24): a bot-sized farm cannot yet fund city services plus an army; wins are not asserted.
  expect(s.cash).toBeCloseTo(250 + flow(s.lifetime), 1); expect(townOf(s).cash).toBeCloseTo(flow(townOf(s).lifetime), 1);
}, 600000);
