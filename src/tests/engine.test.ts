import { describe, expect, it } from 'vitest';
import { CONFIG, CROPS, GOOD_IDS, REGION_IDS, TICKS_PER_DAY } from '../simulation/config';
import { advance, createGame, dispatch, harvestField, quoteSell, step } from '../simulation/engine';
import { capacity, debt, equity, post, reserveCap, reservedStock, stored, sumBooks } from '../simulation/core';
import { frostNight, isReady } from '../simulation/agriculture';
const frostNightForTest = (s: GameState) => frostNight(s, 'heartland');
import { balanceSheet, cashFlow, incomeStatement } from '../simulation/statements';
import { CONTRACT_SIZE, futuresPrice } from '../simulation/finance';
import { runScenario } from '../simulation/scenario';
import { chooseCrop } from '../simulation/automation';
import { botAct, type Strategy } from './bot';
import type { GameState } from '../simulation/types';

/** Cash must equal the starting stake plus every cash ledger entry ever posted. */
const reconcile = (s: GameState) => {
  const flows = Object.entries(s.lifetime).filter(([k]) => k !== 'depreciation').reduce((a, [, v]) => a + v!, 0);
  expect(s.cash).toBeCloseTo(CONFIG.startingCash + flows, 0);
};
const fresh = (seed = 1) => createGame(seed);
/** Funds a test through the ledger (as share capital) so reconciliation still holds. */
const give = (s: GameState, cash: number) => post(s, 'sharesIssued', cash - s.cash, 'Test capital');
const toEra = (s: GameState, era: number) => {
  s.era = era;
  for (const c of Object.keys(CROPS) as (keyof typeof CROPS)[]) if (CROPS[c].minEra <= era && !s.unlockedCrops.includes(c)) s.unlockedCrops.push(c);
};

describe('homestead loop', () => {
  it('planting consumes seeds; harvest only after maturity and only once', () => {
    const s = fresh();
    const f = s.fields[0];
    expect(dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' }).ok).toBe(true);
    expect(s.seeds.wheat).toBe(0);
    expect(s.cash).toBe(250);
    expect(dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' }).ok).toBe(false);
    advance(s, CROPS.wheat.growthTicks - 1);
    expect(dispatch(s, { type: 'harvest', fieldId: f.id }).ok).toBe(false);
    advance(s, 1);
    expect(dispatch(s, { type: 'harvest', fieldId: f.id }).ok).toBe(true);
    expect(s.regions.heartland.inventory.wheat).toBeGreaterThan(0);
    expect(dispatch(s, { type: 'harvest', fieldId: f.id }).ok).toBe(false);
  });

  it('planting without seed buys exactly the shortfall', () => {
    const s = fresh();
    s.seeds.wheat = 4;
    dispatch(s, { type: 'plant', fieldId: s.fields[0].id, crop: 'wheat' });
    expect(s.cash).toBeCloseTo(250 - 6 * CROPS.wheat.seedCost, 2);
    expect(s.seeds.wheat).toBe(0);
    reconcile(s);
  });

  it('locked crops and unaffordable purchases are refused without side effects', () => {
    const s = fresh();
    expect(dispatch(s, { type: 'plant', fieldId: s.fields[0].id, crop: 'potatoes' }).ok).toBe(false);
    give(s, 10);
    const before = JSON.stringify(s);
    expect(dispatch(s, { type: 'buyPlot' }).ok).toBe(false);
    expect(dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('selling deducts inventory, pays the quote and depresses the price', () => {
    const s = fresh();
    s.regions.heartland.inventory.wheat = 500;
    const p0 = s.markets.heartland.wheat!.price;
    const q = quoteSell(s, 'heartland', 'wheat', 500);
    expect(q.avgPrice).toBeLessThan(p0);
    dispatch(s, { type: 'sell', region: 'heartland', good: 'wheat', qty: 500 });
    expect(s.regions.heartland.inventory.wheat).toBe(0);
    expect(s.cash).toBeCloseTo(250 + q.net, 1);
    expect(s.markets.heartland.wheat!.price).toBeLessThan(p0);
    expect(dispatch(s, { type: 'sell', region: 'heartland', good: 'wheat', qty: 1 }).ok).toBe(false);
    reconcile(s);
  });

  it('bulk sales get worse average prices (market depth) and the impact fades', () => {
    const s = fresh();
    expect(quoteSell(s, 'heartland', 'wheat', 5000).avgPrice).toBeLessThan(quoteSell(s, 'heartland', 'wheat', 50).avgPrice * 0.6);
    s.regions.heartland.inventory.wheat = 3000;
    const p0 = s.markets.heartland.wheat!.price;
    dispatch(s, { type: 'sell', region: 'heartland', good: 'wheat', qty: 3000 });
    const low = s.markets.heartland.wheat!.price;
    advance(s, 48);
    expect(s.markets.heartland.wheat!.price).toBeGreaterThan(low + (p0 - low) * 0.4);
  });

  it('crops unlock after enough harvests', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) {
      dispatch(s, { type: 'plant', fieldId: s.fields[0].id, crop: 'wheat' });
      advance(s, CROPS.wheat.growthTicks);
      dispatch(s, { type: 'harvest', fieldId: s.fields[0].id });
    }
    step(s);
    expect(s.unlockedCrops).toContain('corn');
  });
});

describe('farm systems', () => {
  it('workers receive wages during working hours and plant/harvest planned fields', () => {
    const s = fresh();
    toEra(s, 2);
    give(s, 5000);
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    dispatch(s, { type: 'setPlan', fieldIds: [s.fields[0].id], crop: 'wheat' });
    const wages0 = s.lifetime.wages ?? 0;
    advance(s, 2 * TICKS_PER_DAY);
    expect((s.lifetime.wages ?? 0)).toBeLessThan(wages0);
    expect(s.stats.harvests).toBeGreaterThan(0);
    reconcile(s);
  });

  it('storage overflow is sold immediately, never stored beyond capacity', () => {
    const s = fresh();
    const f = s.fields[0];
    f.ha = 1;
    s.regions.heartland.inventory.wheat = CONFIG.baseDryStorage;
    dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' });
    advance(s, CROPS.wheat.growthTicks);
    harvestField(s, f);
    expect(s.regions.heartland.inventory.wheat).toBeLessThanOrEqual(CONFIG.baseDryStorage + 1e-6);
    expect(s.stats.forcedSales).toBe(1);
  });

  it('repeating a crop depletes soil; soybeans restore nitrogen', () => {
    const s = fresh();
    const f = s.fields[0];
    const n0 = f.soil.n;
    for (let i = 0; i < 8; i++) {
      dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' });
      advance(s, CROPS.wheat.growthTicks);
      dispatch(s, { type: 'harvest', fieldId: f.id });
      s.regions.heartland.inventory.wheat = 0;
      give(s, s.cash + 100);
    }
    expect(f.soil.n).toBeLessThan(n0);
    toEra(s, 2);
    const n1 = f.soil.n;
    give(s, s.cash + 1000);
    dispatch(s, { type: 'plant', fieldId: f.id, crop: 'soybeans' });
    advance(s, CROPS.soybeans.growthTicks);
    dispatch(s, { type: 'harvest', fieldId: f.id });
    expect(f.soil.n).toBeGreaterThan(n1);
  });

  it('machines consume fuel, wear, and depreciate when used', () => {
    const s = fresh();
    toEra(s, 3);
    give(s, 100000);
    dispatch(s, { type: 'buyParcel', region: 'heartland', ha: 25 });
    const parcel = s.fields[s.fields.length - 1];
    dispatch(s, { type: 'setPlan', fieldIds: [parcel.id], crop: 'wheat' });
    dispatch(s, { type: 'buyMachine', region: 'heartland', machine: 'tractor', lease: false });
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    advance(s, TICKS_PER_DAY);
    const m = s.machines[0];
    expect(m.hours).toBeGreaterThan(0);
    expect(m.condition).toBeLessThan(1);
    expect(s.lifetime.fuel ?? 0).toBeLessThan(0);
    expect(s.lifetime.depreciation ?? 0).toBeLessThan(0);
    expect(parcel.crop).toBe('wheat');
    reconcile(s);
  });

  it('large fields cannot be worked by hand', () => {
    const s = fresh();
    toEra(s, 3);
    give(s, 100000);
    dispatch(s, { type: 'buyParcel', region: 'heartland', ha: 5 });
    expect(dispatch(s, { type: 'plant', fieldId: s.fields[1].id, crop: 'wheat' }).ok).toBe(false);
  });

  it('factories cannot produce without inputs, and conserve goods when they can', () => {
    const s = fresh();
    toEra(s, 4);
    give(s, 1e6);
    dispatch(s, { type: 'build', region: 'heartland', building: 'warehouse' });
    dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
    advance(s, 5);
    expect(s.regions.heartland.inventory.flour).toBe(0);
    expect(s.buildings[1].reason).toMatch(/wheat/i);
    s.regions.heartland.inventory.wheat = 100;
    advance(s, 1);
    // 6 batches max per hour: 60 wheat in, 48 flour out
    expect(s.regions.heartland.inventory.wheat).toBeCloseTo(40, 5);
    expect(s.regions.heartland.inventory.flour).toBeCloseTo(48, 5);
  });
});

describe('finance', () => {
  it('loans accrue interest daily and amortise', () => {
    const s = fresh();
    toEra(s, 3);
    give(s, 50000);
    s.fields[0].cost = 200000; // collateral
    expect(dispatch(s, { type: 'takeLoan', amount: 10000, termDays: 30 }).ok).toBe(true);
    const l = s.loans[0];
    advance(s, TICKS_PER_DAY * 2);
    expect(l.balance).toBeLessThan(10000);
    expect(s.lifetime.interest ?? 0).toBeLessThan(0);
    reconcile(s);
  });

  it('borrowing beyond the credit limit is refused', () => {
    const s = fresh();
    toEra(s, 3);
    expect(dispatch(s, { type: 'takeLoan', amount: 1e9, termDays: 30 }).ok).toBe(false);
  });

  it('futures margin is held, marked daily and fully released on close', () => {
    const s = fresh();
    toEra(s, 5);
    give(s, 100000);
    expect(dispatch(s, { type: 'openFutures', good: 'wheat', contracts: -5, days: 30 }).ok).toBe(true);
    const p = s.futures[0];
    expect(s.marginAccount).toBeCloseTo(p.margin, 2);
    advance(s, TICKS_PER_DAY * 3);
    const settle = futuresPrice(s, 'wheat', p.expiry);
    const expectedPnl = p.contracts * CONTRACT_SIZE * (settle - p.entry);
    const cash0 = s.cash - (s.lifetime.futures ?? 0);
    dispatch(s, { type: 'closeFutures', positionId: p.id });
    expect(s.marginAccount).toBeCloseTo(0, 6);
    expect(s.lifetime.futures ?? 0).toBeCloseTo(expectedPnl, 0);
    expect(s.futures.length).toBe(0);
    void cash0;
    reconcile(s);
  });

  it('statements reconcile with the ledger', () => {
    const s = fresh(3);
    for (let t = 0; t < 3600; t++) {
      botAct(s);
      step(s);
    }
    const days = 30;
    const is = incomeStatement(s, days);
    const cf = cashFlow(s, days);
    const bs = balanceSheet(s);
    expect(cf.total).toBeCloseTo(sumBooks(s, days) - sumBooks(s, days, ['depreciation']), 0);
    expect(cf.operating + cf.investing + cf.financing).toBeCloseTo(cf.total, 0);
    expect(is.net).toBeCloseTo(is.revenue + is.opex + is.depreciation + is.interest + is.other + is.tax, 0);
    expect(bs.assets - bs.liabilities).toBeCloseTo(bs.equity, 0);
    expect(bs.equity).toBeCloseTo(equity(s), 0);
    reconcile(s);
  });
});

describe('automation & research', () => {
  it('rules cannot bypass resource constraints or the cash reserve', () => {
    const s = fresh();
    toEra(s, 4);
    s.research.done.push('farmSoftware');
    give(s, 1000);
    s.automation.policies.cashReserve = 900;
    dispatch(s, { type: 'addRule', rule: { name: 'buy fert', enabled: true, metric: 'cash', region: 'heartland', good: 'wheat', op: '>', value: 0, action: 'buy', actionGood: 'fertilizer', actionRegion: 'heartland', amountPct: 10000, priority: 1, maxSpend: 0, cooldown: 1 } });
    advance(s, 3);
    expect(s.cash).toBeGreaterThanOrEqual(900 - 1);
    dispatch(s, { type: 'addRule', rule: { name: 'sell', enabled: true, metric: 'cash', region: 'heartland', good: 'wheat', op: '>', value: 0, action: 'sell', actionGood: 'wheat', actionRegion: 'heartland', amountPct: 100, priority: 2, maxSpend: 0, cooldown: 1 } });
    advance(s, 3);
    for (const g of GOOD_IDS) expect(s.regions.heartland.inventory[g]).toBeGreaterThanOrEqual(0);
    expect(s.automation.rules[0].history.length).toBeGreaterThan(0);
  });

  it('research requires a lab, money and prerequisites', () => {
    const s = fresh();
    toEra(s, 4);
    give(s, 1e6);
    expect(dispatch(s, { type: 'research', tech: 'soilTesting' }).ok).toBe(false);
    dispatch(s, { type: 'build', region: 'heartland', building: 'lab' });
    expect(dispatch(s, { type: 'research', tech: 'precisionFert' }).ok).toBe(false);
    expect(dispatch(s, { type: 'research', tech: 'soilTesting' }).ok).toBe(true);
    advance(s, TICKS_PER_DAY * 4);
    expect(s.research.done).toContain('soilTesting');
  });
});

describe('determinism, persistence and speed', () => {
  it('same seed + same actions = same world', () => {
    const run = () => {
      const s = createGame(42);
      for (let t = 0; t < 2000; t++) {
        botAct(s);
        step(s);
      }
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('chunking time does not change outcomes (speed independence)', () => {
    const a = createGame(7);
    const b = createGame(7);
    advance(a, 1000);
    for (let i = 0; i < 100; i++) advance(b, 10);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a JSON save round-trip mid-game continues identically', () => {
    const a = createGame(9);
    for (let t = 0; t < 1500; t++) {
      botAct(a);
      step(a);
    }
    const b = JSON.parse(JSON.stringify(a)) as GameState;
    for (let t = 0; t < 1500; t++) {
      botAct(a);
      step(a);
      botAct(b);
      step(b);
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('scenario planner leaves the live game untouched and isolates the assumption', () => {
    const s = createGame(5);
    for (let t = 0; t < 1200; t++) {
      botAct(s);
      step(s);
    }
    const before = JSON.stringify(s);
    const r = runScenario(s, { days: 5 });
    expect(JSON.stringify(s)).toBe(before);
    expect(r.scen.cash).toEqual(r.base.cash); // no assumptions → identical paths
  });
});

describe('long-run balance (simulated years, several strategies)', () => {
  for (const strategy of ['balanced', 'volume', 'idle'] as Strategy[])
    it(`${strategy}: no negative stock, bounded prices, books balance, no money from nothing`, () => {
      const s = createGame(123);
      const ticks = strategy === 'idle' ? 120 * 24 * 5 : 9000;
      for (let t = 0; t < ticks; t++) {
        botAct(s, strategy);
        step(s);
        if (t % 50 !== 0) continue;
        for (const r of REGION_IDS) {
          for (const g of GOOD_IDS) expect(s.regions[r].inventory[g]).toBeGreaterThanOrEqual(-1e-6);
          for (const g in s.markets[r]) {
            const m = s.markets[r][g as keyof typeof s.markets.heartland]!;
            expect(Number.isFinite(m.price)).toBe(true);
            expect(m.price).toBeGreaterThan(0);
          }
        }
        expect(Number.isFinite(s.cash)).toBe(true);
      }
      reconcile(s);
      expect(debt(s)).toBeGreaterThanOrEqual(0);
      if (strategy === 'idle') expect(s.cash).toBe(250); // doing nothing earns nothing and costs nothing
      else expect(equity(s)).toBeGreaterThan(5000); // a competent player is not deadlocked
    }, 120000);
});

describe('exploit guards', () => {
  it('a buy-then-sell round trip can never make money', () => {
    const s = fresh();
    toEra(s, 5);
    give(s, 1e6);
    const c0 = s.cash;
    for (const g of ['wheat', 'corn', 'fertilizer'] as const) {
      dispatch(s, { type: 'buy', region: 'heartland', good: g, qty: 300 });
      dispatch(s, { type: 'sell', region: 'heartland', good: g, qty: Math.floor(s.regions.heartland.inventory[g]) });
    }
    expect(s.cash).toBeLessThan(c0);
  });

  it('share issues cannot take the founder below 51%', () => {
    const s = fresh();
    toEra(s, 7);
    give(s, 1e6);
    s.corp.incorporated = true;
    let n = 0;
    while (dispatch(s, { type: 'issueShares', pct: 0.25 }).ok && n < 50) n++;
    expect(s.corp.playerShares / s.corp.shares).toBeGreaterThanOrEqual(0.51);
    expect(n).toBeLessThan(5);
  });

  it('futures positions are capped by the exchange limit', () => {
    const s = fresh();
    toEra(s, 5);
    give(s, 1e9);
    expect(dispatch(s, { type: 'openFutures', good: 'wheat', contracts: -1_000_000, days: 30 }).ok).toBe(false);
  });

  it('crop insurance has a waiting period', () => {
    const s = fresh();
    toEra(s, 5);
    dispatch(s, { type: 'setInsurance', region: 'heartland', on: true });
    expect(s.regions.heartland.insuredFrom).toBeGreaterThan(s.tick);
  });
});

describe('new mechanics', () => {
  it('eras only advance when the player chooses', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyPlot' });
    post(s, 'sale', 13000, 'test');
    give(s, s.cash + 2000);
    for (let i = 0; i < 3; i++) give(s, s.cash + 2000), dispatch(s, { type: 'buyPlot' });
    step(s);
    expect(s.era).toBe(1);
    expect(s.eraReady).toBe(true);
    expect(dispatch(s, { type: 'advanceEra' }).ok).toBe(true);
    expect(s.era).toBe(2);
    expect(dispatch(s, { type: 'advanceEra' }).ok).toBe(false);
  });

  it('livestock eat, produce, and starve without feed', () => {
    const s = fresh();
    toEra(s, 2);
    s.discovered.push('chickens');
    give(s, 20000);
    expect(dispatch(s, { type: 'buyAnimals', region: 'heartland', animal: 'chickens', count: 10 }).ok).toBe(false); // no coop yet
    dispatch(s, { type: 'build', region: 'heartland', building: 'coop' });
    expect(dispatch(s, { type: 'buyAnimals', region: 'heartland', animal: 'chickens', count: 50 }).ok).toBe(true);
    s.automation.policies.autoFeed = false;
    s.regions.heartland.inventory.corn = 200;
    advance(s, TICKS_PER_DAY * 3);
    expect(s.regions.heartland.inventory.eggs).toBeGreaterThan(50);
    expect(s.regions.heartland.inventory.corn).toBeLessThan(200);
    s.regions.heartland.inventory.corn = 0;
    const h0 = s.herds[0].health;
    advance(s, TICKS_PER_DAY * 3);
    expect(s.herds[0].health).toBeLessThan(h0);
    reconcile(s);
  });

  it('orchards fruit repeatedly without replanting', () => {
    const s = fresh();
    toEra(s, 3);
    s.unlockedCrops.push('apples');
    give(s, 10000);
    const f = s.fields[0];
    expect(dispatch(s, { type: 'plant', fieldId: f.id, crop: 'apples' }).ok).toBe(true);
    let harvests = 0;
    for (let i = 0; i < 24 * 120 && harvests < 2; i++) {
      step(s);
      if (dispatch(s, { type: 'harvest', fieldId: f.id }).ok) harvests++;
    }
    expect(harvests).toBe(2);
    expect(f.crop).toBe('apples');
  });

  it('frost damages tender crops but not greenhouses or wheat', () => {
    const s = fresh();
    toEra(s, 2);
    give(s, 50000);
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyPlot' });
    const [a, b, c] = s.fields;
    dispatch(s, { type: 'plant', fieldId: a.id, crop: 'corn' });
    dispatch(s, { type: 'plant', fieldId: b.id, crop: 'wheat' });
    s.discovered.push('frost');
    dispatch(s, { type: 'greenhouse', fieldIds: [c.id] });
    dispatch(s, { type: 'plant', fieldId: c.id, crop: 'corn' });
    advance(s, 8); // a third grown
    s.regions.heartland.frostTonight = true;
    advance(s, 24 - (s.tick % 24)); // the next day turns: frost is processed only if tonight was frosty, so force it again
    a.frost = 0; b.frost = 0;
    s.regions.heartland.frostTonight = true;
    // run the frost step directly through a day boundary with frost forced
    const { hit } = frostNightForTest(s);
    expect(hit).toBeGreaterThan(0);
    expect(a.frost > 0 || a.crop === null).toBe(true);
    expect(b.frost).toBe(0);
    expect(c.frost).toBe(0);
  });

  it('quality follows produce and changes the sale price', () => {
    const s = fresh();
    s.regions.heartland.inventory.wheat = 100;
    s.regions.heartland.quality.wheat = 0.95;
    const hi = quoteSell(s, 'heartland', 'wheat', 100).gross;
    s.regions.heartland.quality.wheat = 0.4;
    const lo = quoteSell(s, 'heartland', 'wheat', 100).gross;
    expect(hi).toBeGreaterThan(lo * 1.2);
  });

  it('upgrades raise capacity; perks need skill', () => {
    const s = fresh();
    toEra(s, 2);
    give(s, 50000);
    dispatch(s, { type: 'build', region: 'heartland', building: 'barn' });
    const cap1 = capacity(s, 'heartland').dry;
    expect(dispatch(s, { type: 'upgradeBuilding', buildingId: s.buildings[0].id }).ok).toBe(false); // not discovered yet
    s.discovered.push('upgrades', 'perks');
    expect(dispatch(s, { type: 'upgradeBuilding', buildingId: s.buildings[0].id }).ok).toBe(true);
    expect(capacity(s, 'heartland').dry).toBeGreaterThan(cap1);
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    const w = s.workers[0];
    w.skill = 0.9;
    expect(dispatch(s, { type: 'choosePerk', workerId: w.id, perk: 'harvester' }).ok).toBe(false);
    w.skill = 1.1;
    expect(dispatch(s, { type: 'choosePerk', workerId: w.id, perk: 'harvester' }).ok).toBe(true);
    reconcile(s);
  });
});

describe('rewards', () => {
  it('daily goals pay a recorded prize once, only when complete', () => {
    const s = fresh();
    dispatch(s, { type: 'startDay', key: '2026-11-01' });
    expect(dispatch(s, { type: 'claimDaily', key: '2026-11-01' }).ok).toBe(false);
    s.stats.harvests += 10; s.stats.plantings += 10;
    post(s, 'sale', 1000, 'test sales');
    const c0 = s.cash;
    expect(dispatch(s, { type: 'claimDaily', key: '2026-11-01' }).ok).toBe(true);
    expect(s.cash).toBeGreaterThan(c0);
    expect(s.daily!.streak).toBe(1);
    expect(dispatch(s, { type: 'claimDaily', key: '2026-11-01' }).ok).toBe(false);
    reconcile(s);
  });

  it('achievements and starter gifts trigger from real progress', () => {
    const s = fresh();
    dispatch(s, { type: 'plant', fieldId: s.fields[0].id, crop: 'wheat' });
    advance(s, CROPS.wheat.growthTicks);
    dispatch(s, { type: 'harvest', fieldId: s.fields[0].id });
    advance(s, 12);
    expect(s.achievements).toContain('firstHarvest');
    expect(s.rewarded).toContain('gift1');
    expect(s.seeds.wheat).toBe(10);
  });
});

describe('farm advisor', () => {
  it('explains a loss caused by managers nobody needs', async () => {
    const { diagnose } = await import('../simulation/advisor');
    const s = fresh();
    toEra(s, 3);
    give(s, 50000);
    for (const role of ['hand', 'hand', 'manager', 'manager'] as const) expect(dispatch(s, { type: 'hire', region: 'heartland', role, wageFactor: 1 }).ok).toBe(true);
    advance(s, 48);
    const d = diagnose(s);
    expect(d.profit).toBeLessThan(0);
    expect(d.advice[0].id).toBe('managers');
    expect(d.advice[0].title).toContain('2 managers');
  });
});

describe('farm advisor fee', () => {
  it('is hired from era 2 and paid through the ledger', () => {
    const s = fresh();
    expect(dispatch(s, { type: 'setAdvisor', on: true }).ok).toBe(false);
    toEra(s, 2);
    expect(dispatch(s, { type: 'setAdvisor', on: true }).ok).toBe(true);
    advance(s, 48);
    expect(sumBooks(s, 3, ['advisor'])).toBeLessThan(0);
    reconcile(s);
    dispatch(s, { type: 'setAdvisor', on: false });
    const before = sumBooks(s, 999, ['advisor']);
    advance(s, 24);
    expect(sumBooks(s, 999, ['advisor'])).toBe(before);
  });
});

describe('full barn', () => {
  it('tells the player when a hand harvest is sold off the field', () => {
    const s = fresh();
    const f = s.fields[0];
    dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' });
    advance(s, CROPS.wheat.growthTicks);
    s.regions.heartland.inventory.corn = 1e6; // fill the barn
    const r = dispatch(s, { type: 'harvest', fieldId: f.id });
    expect(r.ok).toBe(true);
    expect(r.ok && r.note).toMatch(/Barn full! \d+ wheat/);
  });
});

describe('cash reserve', () => {
  it('never stops hands replanting planned fields', () => {
    const s = fresh(3);
    toEra(s, 3);
    give(s, 5000);
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyPlot' });
    for (const f of s.fields) f.plan = 'wheat';
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    s.automation.policies.cashReserve = s.cash + 5000;
    const p = s.stats.plantings;
    advance(s, 72);
    expect(s.stats.plantings - p).toBeGreaterThan(4);
    reconcile(s);
  });
});

describe('orchard pests', () => {
  it('stay manageable over a year of harvests', () => {
    const s = fresh(4);
    toEra(s, 3);
    give(s, 50000);
    s.unlockedCrops.push('grapes');
    const f = s.fields[0];
    f.streak = 5; // old saves: orchards had piled up a repeat-crop streak
    expect(dispatch(s, { type: 'plant', fieldId: f.id, crop: 'grapes' }).ok).toBe(true);
    let max = 0;
    for (let t = 0; t < TICKS_PER_DAY * 120; t++) {
      step(s);
      if (isReady(s, f)) dispatch(s, { type: 'harvest', fieldId: f.id });
      max = Math.max(max, f.pest);
    }
    expect(s.stats.harvests).toBeGreaterThan(5);
    expect(max).toBeLessThan(0.4);
  });
});

describe('manager selling policy', () => {
  it('sells when storage is over the cap at any hour, but keeps animal feed', () => {
    const s = fresh(5);
    toEra(s, 3);
    give(s, 80000);
    dispatch(s, { type: 'hire', region: 'heartland', role: 'manager', wageFactor: 1 });
    s.herds.push({ region: 'heartland', animal: 'chickens', count: 100, health: 1, fed: 1 });
    s.automation.policies.sellDiscipline = 1.3;
    s.automation.policies.sellStorageCap = 0.5;
    const cap = stored(s, 'heartland').cap.dry;
    s.regions.heartland.inventory.wheat = cap * 0.9;
    while (s.tick % 24 !== 8) step(s); // well before the midday round
    const before = s.regions.heartland.inventory.wheat;
    step(s);
    expect(s.regions.heartland.inventory.wheat).toBeLessThan(before);
    for (let i = 0; i < 48; i++) step(s);
    expect(s.regions.heartland.inventory.wheat).toBeGreaterThan(0); // feed reserve kept
    reconcile(s);
  });
});

describe('crew', () => {
  it('hands spread across fields instead of crowding one', () => {
    const s = fresh(6);
    toEra(s, 2);
    give(s, 20000);
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyPlot' });
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    while (s.tick % 24 !== 9) step(s);
    for (const f of s.fields) (f.crop = null), (f.work = 0), (f.plan = 'wheat'); // four empty fields waiting
    step(s);
    const tasks = s.workers.map((w) => w.task);
    expect(new Set(tasks).size).toBe(3);
  });
});

describe('tractor', () => {
  it('plants several small plots in one hour and gets a driver before hand work', () => {
    const s = fresh(7);
    toEra(s, 3);
    give(s, 60000);
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyPlot' });
    expect(dispatch(s, { type: 'buyMachine', region: 'heartland', machine: 'tractor', lease: false }).ok).toBe(true);
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    while (s.tick % 24 !== 9) step(s);
    for (const f of s.fields) (f.crop = null), (f.work = 0), (f.plan = 'wheat');
    s.workers[0].skill = 1; s.workers[0].morale = 1;
    const p = s.stats.plantings;
    step(s);
    expect(s.stats.plantings - p).toBe(4);
    reconcile(s);
  });

  it('an assigned driver runs their machine and works by hand when it has nothing to do', () => {
    const s = fresh(7);
    toEra(s, 3);
    give(s, 200000);
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyPlot' });
    dispatch(s, { type: 'buyMachine', region: 'heartland', machine: 'tractor', lease: false });
    for (let i = 0; i < 2; i++) dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    const m = s.machines[0];
    const [a, b] = s.workers.filter((w) => w.role === 'hand');
    expect(dispatch(s, { type: 'assignDriver', machineId: m.id, workerId: b.id }).ok).toBe(true);
    while (s.tick % 24 !== 9) step(s);
    for (const f of s.fields) (f.crop = null), (f.work = 0), (f.plan = 'wheat');
    step(s);
    expect(m.usedThisTick).toBe(true);
    expect(b.task).toBe(m.task); // b drove it, not a
    // broken machine: its driver works by hand instead of standing idle
    for (const f of s.fields) (f.crop = null), (f.work = 0);
    m.broken = true;
    step(s);
    expect(b.task).not.toBe(0);
    expect(a.task).not.toBe(0);
    // firing the driver frees the machine
    dispatch(s, { type: 'fire', workerId: b.id });
    expect(m.driver).toBe(null);
    reconcile(s);
  });

  it('extra tractors join a big field instead of standing idle', () => {
    const s = fresh(7);
    toEra(s, 3);
    give(s, 200000);
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyMachine', region: 'heartland', machine: 'tractor', lease: false });
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    while (s.tick % 24 !== 9) step(s);
    s.fields.length = 1;
    Object.assign(s.fields[0], { crop: null, work: 0, plan: 'wheat', ha: 40 });
    step(s);
    expect(s.machines.filter((m) => m.usedThisTick).length).toBe(3);
    reconcile(s);
  });
});

describe('manager crop choice', () => {
  it('values wheat by what the flour mill pays when the mill is short', async () => {
    const { millValue } = await import('../simulation/automation');
    const s = fresh(8);
    toEra(s, 4);
    give(s, 100000);
    expect(millValue(s, 'heartland', 'wheat')).toBe(0);
    expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
    s.regions.heartland.inventory.wheat = 0;
    expect(millValue(s, 'heartland', 'wheat')).toBeGreaterThan(s.markets.heartland.wheat!.price);
    s.regions.heartland.inventory.wheat = 1e5; // plenty waiting: no premium
    expect(millValue(s, 'heartland', 'wheat')).toBe(0);
  });
});

describe('plan lock', () => {
  it('managers on auto-rotate never change a locked plan', () => {
    const s = fresh(9);
    toEra(s, 3);
    give(s, 50000);
    dispatch(s, { type: 'buyPlot' });
    dispatch(s, { type: 'hire', region: 'heartland', role: 'manager', wageFactor: 1 });
    s.automation.policies.autoRotate = true;
    const [a, b] = s.fields;
    for (const f of [a, b]) (f.crop = null), (f.work = 0);
    const best = chooseCrop(s, b);
    const other = s.unlockedCrops.find((c) => c !== best && !CROPS[c].perennial)!; // a crop the manager would not pick
    dispatch(s, { type: 'setPlan', fieldIds: [a.id, b.id], crop: other });
    dispatch(s, { type: 'lockPlan', fieldIds: [a.id], locked: true });
    step(s);
    expect(a.plan).toBe(other);
    expect(b.plan).not.toBe(other);
  });
});

describe('dedicated supply', () => {
  it("a field's harvest is held for its factory and nothing else takes it", () => {
    const s = fresh(10);
    toEra(s, 4);
    give(s, 200000);
    expect(dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' }).ok).toBe(true);
    const mill = s.buildings.find((b) => b.type === 'flourMill')!;
    const f = s.fields[0];
    expect(dispatch(s, { type: 'supplyFactory', fieldIds: [f.id], buildingId: mill.id }).ok).toBe(true);
    expect(f.plan).toBe('wheat');
    expect(f.planLocked).toBe(true);
    expect(dispatch(s, { type: 'setPlan', fieldIds: [f.id], crop: 'corn' }).ok).toBe(false);
    mill.active = false;
    dispatch(s, { type: 'plant', fieldId: f.id, crop: 'wheat' });
    advance(s, CROPS.wheat.growthTicks);
    const inv0 = s.regions.heartland.inventory.wheat;
    dispatch(s, { type: 'harvest', fieldId: f.id });
    const got = s.regions.heartland.inventory.wheat - inv0;
    expect(got).toBeGreaterThan(0);
    expect(mill.reserved).toBeCloseTo(got, 5);
    expect(reservedStock(s, 'heartland', 'wheat')).toBeCloseTo(got, 5);
    // a second mill of the same type shares the reserve
    dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
    s.regions.heartland.inventory.wheat = mill.reserved; // only reserved wheat in store
    const r1 = mill.reserved;
    step(s);
    expect(mill.reserved).toBeLessThan(r1); // the paused mill's reserve was used by its sibling
    // the reserve never holds more than a week of the factory's needs
    s.regions.heartland.inventory.wheat = 1e7;
    mill.reserved = 1e7;
    step(s);
    expect(mill.reserved).toBeLessThanOrEqual(reserveCap(mill));
    s.regions.heartland.inventory.wheat = mill.reserved = 100; // the starter barn holds 400
    // the dedicated mill uses it once running
    mill.active = true;
    const r0 = mill.reserved;
    step(s);
    expect(mill.reserved).toBeLessThan(r0);
    // demolishing frees the field
    dispatch(s, { type: 'demolish', buildingId: mill.id });
    expect(f.supplies).toBe(null);
    expect(f.planLocked).toBe(false);
    reconcile(s);
  });
});

describe('build many', () => {
  it('builds several at once, all or nothing', () => {
    const s = fresh(11);
    toEra(s, 2);
    give(s, 1e6);
    const n0 = s.buildings.length;
    expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', count: 5 }).ok).toBe(true);
    expect(s.buildings.length).toBe(n0 + 5);
    expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', count: 0 }).ok).toBe(false);
    give(s, 10);
    expect(dispatch(s, { type: 'build', region: 'heartland', building: 'barn', count: 10 }).ok).toBe(false);
    expect(s.buildings.length).toBe(n0 + 5);
    reconcile(s);
  });
});

describe('fruit machines', () => {
  const vineyard = (seed: number, crop: 'grapes' | 'apples') => {
    const s = fresh(seed);
    toEra(s, 3);
    give(s, 300000);
    s.unlockedCrops.push(crop);
    dispatch(s, { type: 'buyParcel', region: 'heartland', ha: 5 });
    const f = s.fields.find((x) => x.ha === 5)!;
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    s.workers[0].skill = 1; s.workers[0].morale = 1;
    // a mature crop, ripe now
    f.crop = crop; f.plan = crop; f.plantedAt = s.tick - 9999 * 24; f.cycleAt = s.tick - CROPS[crop].growthTicks; f.work = 0;
    while (s.tick % 24 !== 8) { step(s); f.cycleAt = s.tick - CROPS[crop].growthTicks; }
    return { s, f };
  };
  it('grape harvester picks grapes by machine, a grade step lower', () => {
    const { s, f } = vineyard(12, 'grapes');
    expect(dispatch(s, { type: 'buyMachine', region: 'heartland', machine: 'grapeHarvester', lease: false }).ok).toBe(true);
    const h0 = s.stats.harvests;
    for (let i = 0; i < 4 && s.stats.harvests === h0; i++) step(s);
    expect(s.stats.harvests).toBe(h0 + 1); // 5 ha at ~2 ha/h: done within a few hours, not 30 by hand
    expect(f.lastHarvest!.quality).toBeLessThan(1);
    reconcile(s);
  });
  it('orchard platform makes apple pickers faster; combines still cannot pick fruit', () => {
    const a = vineyard(13, 'apples');
    const b = vineyard(13, 'apples');
    dispatch(b.s, { type: 'buyMachine', region: 'heartland', machine: 'orchardPlatform', lease: false });
    dispatch(a.s, { type: 'buyMachine', region: 'heartland', machine: 'harvester', lease: false });
    const wa = a.f.work, wb = b.f.work;
    step(a.s); step(b.s);
    expect(b.f.work - wb).toBeGreaterThan((a.f.work - wa) * 2.5);
    expect(a.s.machines[0].usedThisTick || a.s.machines[0].task).toBeFalsy();
  });
});

describe('orchard crew', () => {
  it('hands fill free platform seats before spreading to other fields, and long picks are scored fairly', () => {
    const s = fresh(14);
    toEra(s, 5);
    give(s, 5e6);
    s.unlockedCrops.push('apples');
    dispatch(s, { type: 'buyParcel', region: 'heartland', ha: 500 });
    for (let i = 0; i < 8; i++) dispatch(s, { type: 'buyPlot' });
    const f = s.fields.find((x) => x.ha === 500)!;
    for (const g of s.fields) if (g !== f) g.plan = 'wheat';
    for (let i = 0; i < 12; i++) dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'buyMachine', region: 'heartland', machine: 'orchardPlatform', lease: false });
    for (const w of s.workers) (w.skill = 1), (w.morale = 1);
    s.automation.policies.autoRepair = 0.8;
    f.crop = 'apples'; f.plan = 'apples'; f.plantedAt = s.tick - 60 * 24; f.cycleAt = s.tick - CROPS.apples.growthTicks; f.work = 0;
    while (s.tick % 24 !== 10) step(s);
    expect(s.workers.filter((w) => w.task === f.id).length).toBe(12); // 3 platforms × 4 seats
    let timingFactorAtHarvest = 0;
    while (!f.lastHarvest && s.tick < 24 * 400) step(s);
    timingFactorAtHarvest = f.lastHarvest!.timing;
    expect(timingFactorAtHarvest).toBeGreaterThan(0.6); // a ~6-day pick isn't scored as fully over-ripe
  });
});

describe('mechanics gaps', () => {
  it('feed buying never pays more than e^1.2 × the price, herds leave the mill its corn, sensors skip empty fields', async () => {
    const { quoteBuy } = await import('../simulation/markets');
    const s = fresh(11);
    toEra(s, 6);
    give(s, 5e6);
    const m = s.markets.heartland.feed!;
    const q = quoteBuy(s, 'heartland', 'feed', 50000);
    if (q.qty) expect(q.gross / q.qty).toBeLessThanOrEqual(m.price * Math.exp(1.2) + 1e-6);
    // a running feed mill keeps its day of corn away from the herd
    dispatch(s, { type: 'build', region: 'heartland', building: 'feedMill' });
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'build', region: 'heartland', building: 'warehouse' });
    s.regions.heartland.inventory.corn = 1000; // less than the mill's 1,920/day
    s.herds.push({ region: 'heartland', animal: 'pigs', count: 100, health: 1, fed: 1 });
    s.automation.policies.autoFeed = false;
    const { livestockDaily } = await import('../simulation/livestock');
    livestockDaily(s);
    expect(s.regions.heartland.inventory.corn).toBe(1000);
    // precision sensors draw nothing on an empty field
    s.research.done.push('precisionIrrigation');
    for (const f of s.fields) (f.irrigated = true), (f.crop = null);
    s.regions.heartland.powerUse = 0;
    const { fieldsTick } = await import('../simulation/agriculture');
    fieldsTick(s);
    expect(s.regions.heartland.powerUse).toBe(0);
  });

  it('workers skip planting they cannot pay seed for instead of wasting the work', () => {
    const s = fresh(12);
    toEra(s, 3);
    dispatch(s, { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 });
    const f = s.fields[0];
    Object.assign(f, { crop: null, work: 0, plan: 'wheat', ha: 400 });
    s.seeds.wheat = 0;
    post(s, 'sharesIssued', -s.cash - 5000, 't'); // deep in the overdraft
    while (s.tick % 24 !== 9) step(s);
    step(s);
    expect(f.work).toBe(0);
    expect(s.log.some((l) => /can't afford seed/.test(l.text))).toBe(true);
  });

  it('a manager sells chilled stock that does not fit the cold store', () => {
    const s = fresh(13);
    toEra(s, 4);
    give(s, 1e6);
    dispatch(s, { type: 'hire', region: 'heartland', role: 'manager', wageFactor: 1 });
    s.automation.policies.sellDiscipline = 1.3;
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'build', region: 'heartland', building: 'warehouse' });
    s.regions.heartland.inventory.potatoes = 5000; // no cold store at all
    while (hourOf(s) === 12) step(s);
    const p0 = s.regions.heartland.inventory.potatoes;
    step(s);
    expect(s.regions.heartland.inventory.potatoes).toBeLessThan(p0);
  });
});
const hourOf = (s: GameState) => s.tick % 24;

describe('exports', () => {
  it('a sell-on-arrival shipment is sold off in the destination, and managers export when it pays', async () => {
    const { exportGain } = await import('../simulation/logistics');
    const s = fresh(21);
    toEra(s, 6);
    give(s, 5e6);
    for (const r of REGION_IDS) s.regions[r].unlocked = true;
    for (let i = 0; i < 3; i++) dispatch(s, { type: 'build', region: 'heartland', building: 'warehouse' });
    s.regions.heartland.inventory.wheat = 20000;
    const to = REGION_IDS.find((r) => r !== 'heartland' && s.markets[r].wheat && exportGain(s, 'wheat', 'heartland', r) > -1e9)!;
    expect(dispatch(s, { type: 'ship', good: 'wheat', qty: 5000, from: 'heartland', to, sell: true }).ok).toBe(true);
    const sh = s.shipments[0];
    expect(sh.sell).toBe(true);
    const sales0 = s.stats.sales;
    advance(s, sh.arrives - s.tick + 48);
    expect(s.shipments.length).toBe(0);
    expect(s.stats.sales).toBeGreaterThan(sales0);
    expect(s.regions[to].inventory.wheat).toBeLessThan(1); // nothing parked in a region with no storage
    // manager export: make another region pay far more
    dispatch(s, { type: 'hire', region: 'heartland', role: 'manager', wageFactor: 1 });
    s.automation.policies.sellDiscipline = 1.3;
    s.markets[to].wheat!.sent = 2; // buyers there pay far more
    while (s.tick % 24 !== 11) step(s);
    step(s); // the midday round
    expect(s.shipments.some((x) => x.to === to && x.good === 'wheat' && x.sell)).toBe(true);
    reconcile(s);
  });
});
