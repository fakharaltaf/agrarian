// Farm advisor: reads the books and the farm, and explains in plain words what is costing money
// and what to try. Pure and deterministic; each tip names the page that fixes it.
import { BUILDINGS, CONFIG, CROPS, GOODS, LEDGER_KINDS, MACHINES, OPEX_KINDS, REVENUE_KINDS, REGION_IDS, type GoodId, type LedgerKind } from './config';
import { day, equity, refPrice, seedCost, stored, sumBooks } from './core';
import { buildingMargin } from './processing';
import { cropScore } from './automation';
import { expectedYield, fertility, isManual, isReady, readyAt, spoilValue } from './agriculture';
import type { GameState } from './types';

/** perDay: money it costs (or would earn) per day, shown to the player. weight: ranking when there is no clean $ figure. */
export interface Advice { id: string; icon: string; title: string; body: string; page: string; perDay: number; weight?: number }
export interface Diagnosis {
  revenue: number; costs: number; profit: number; topCosts: { label: string; perDay: number }[];
  /** every cost line, biggest first */ costLines: { label: string; perDay: number }[];
  /** change in what the farm is worth per day (cash, stock, assets, less debt), net of money raised or paid out to shareholders */ realProfit: number;
  /** things going well, so the player knows what not to touch */ working: string[];
  advice: Advice[];
}

const r0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Rates are per in-game day, averaged over the last (up to) three days. */
export function diagnose(s: GameState): Diagnosis {
  const days = Math.max(1 / 24, (s.tick - Math.max(0, day(s) - 2) * 24) / 24);
  const rate = (k: LedgerKind[]) => -sumBooks(s, 3, k) / days; // positive = money out
  const revenue = -rate(REVENUE_KINDS);
  const costs = rate([...OPEX_KINDS, 'interest']);
  const costLines = [...OPEX_KINDS, 'interest' as LedgerKind, 'tax' as LedgerKind].map((k) => ({ label: LEDGER_KINDS[k], perDay: rate([k]) }))
    .filter((c) => c.perDay > 1).sort((a, b) => b.perDay - a.perDay);
  const topCosts = costLines.slice(0, 3);
  // what the farm is really earning: change in equity, minus money that came from (or went to) shareholders
  const start = s.books.find((b) => b.day >= day(s) - 2);
  const realProfit = start && start.equity ? (equity(s) - start.equity + sumBooks(s, 3, ['sharesIssued', 'dividends', 'buyback'] as LedgerKind[]) * -1) / days : revenue - costs;
  const advice: Advice[] = [];
  const add = (a: Advice) => advice.push(a);

  // managers: the owner oversees 8 hands; each manager 20 more. Policies need one.
  const hands = s.workers.filter((w) => w.role === 'hand').length;
  const managers = s.workers.filter((w) => w.role === 'manager').length;
  const needed = Math.max(s.automation.policies.autoRotate || s.automation.policies.autoFertilize || s.automation.policies.sellDiscipline > 0 ? 1 : 0, Math.ceil((hands - 8) / 20));
  if (managers > needed) {
    const spare = managers - needed;
    add({ id: 'managers', icon: '🧑‍💼', page: 'workers', perDay: rate(['salaries']) * (spare / managers),
      title: `${spare} manager${spare > 1 ? 's' : ''} you don't need yet`,
      body: `Managers don't plant or harvest — they coordinate. You can oversee 8 hands yourself; each manager adds room for 20 more${needed ? ', and one runs your Automation policies' : ''}. You have ${hands} hand${hands === 1 ? '' : 's'}, so ${spare === managers ? 'no manager is needed' : `${needed} is enough`}. Each costs about ${r0(rate(['salaries']) / Math.max(1, managers))} a day.` });
  }

  // hands with nothing to do: labour the planned fields actually need vs what the crew supplies
  const planned = s.fields.filter((f) => !isManual(f) || f.plan);
  const needHours = planned.reduce((a, f) => { const c = CROPS[f.plan ?? f.crop ?? 'wheat']; return a + (f.ha * (c.harvestHours + 1) * 24) / c.growthTicks; }, 0);
  if (hands > 0 && hands * 12 > needHours * 2.5 + 12) {
    const spare = Math.floor((hands * 12 - needHours * 1.5) / 12);
    if (spare > 0) add({ id: 'idleHands', icon: '😴', page: planned.length ? 'workers' : 'fields', perDay: rate(['wages']) * (spare / hands),
      title: planned.length ? 'Your crew is mostly standing around' : 'Workers have no crop plans to follow',
      body: planned.length
        ? `Your planned fields need about ${Math.round(needHours)} work-hours a day; ${hands} hands supply ${hands * 12}. Wages are paid whether they're busy or not — let ${spare} go or buy more land for them to work.`
        : 'Hands only replant fields that have a crop plan. Pick fields, choose a plan, and they will keep them cycling — until then you pay wages for nothing.' });
  }

  // fields ripening with no one to pick them
  const late = s.fields.filter((f) => isReady(s, f) && s.tick - readyAt(f) > 12);
  if (late.length) add({ id: 'overripe', icon: '🥀', page: late.some((f) => f.plan) ? 'workers' : 'farm', perDay: 0,
    title: `${late.length} field${late.length > 1 ? 's are' : ' is'} over-ripening`,
    body: late.some((f) => !f.plan)
      ? 'A ripe crop loses yield every hour it waits after the first half day. Harvest it, or give the field a crop plan so your hands bring it in.'
      : 'Your crew can\'t get to ripe fields fast enough, and every hour they wait costs yield. Hire hands, and give each idle machine a driver.' });

  // more machines than people to drive them, or planned land the crew can't keep up with
  const drivable = s.machines.filter((m) => MACHINES[m.type].haPerHour && !MACHINES[m.type].autonomous && !m.broken).length;
  const waiting = s.fields.filter((f) => f.plan && !f.crop).length;
  if (hands > 0 && (drivable > hands || (waiting > 1 && drivable < hands && needHours > hands * 12 * 1.2))) { // hand-hour estimate only holds where hands work without machines
    const lost = s.fields.filter((f) => f.plan && !f.crop).reduce((a, f) => a + Math.max(0, cropScore(s, f, f.plan!)) * 24 * f.ha, 0);
    const spare = drivable - hands;
    add({ id: 'shortHands', icon: '🧑‍🌾', page: 'workers', perDay: lost,
      title: spare > 0 ? `${spare} machine${spare > 1 ? 's have' : ' has'} no one to drive ${spare > 1 ? 'them' : 'it'}` : `Your crew can't keep up with ${waiting} waiting field${waiting > 1 ? 's' : ''}`,
      body: spare > 0
        ? `Every tractor and harvester needs a hand at the wheel. You have ${hands} hand${hands === 1 ? '' : 's'} and ${drivable} machines, so ${spare} stand in the yard while ${waiting} field${waiting === 1 ? '' : 's'} wait${waiting === 1 ? 's' : ''} to be planted or harvested. Hire ${spare} hand${spare > 1 ? 's' : ''} — a hand costs far less than a day of an empty field.`
        : `${waiting} planned field${waiting > 1 ? 's are' : ' is'} waiting for your ${hands} hand${hands === 1 ? '' : 's'}. Hire more hands, or give them machines: a tractor or harvester does many times what a hand does alone.` });
  }

  // selling into a market the player is flooding
  for (const g of Object.keys(GOODS) as GoodId[]) {
    const m = s.markets.heartland[g];
    if (!m || m.playerSold < 1 || m.playerSold / Math.max(1, m.totalSold) < 0.25) continue;
    const drop = 1 - m.price / refPrice(s, g);
    if (drop > 0.2) add({ id: `flood:${g}`, icon: '📉', page: 'markets', perDay: 0,
      title: `You're flooding the ${GOODS[g].name.toLowerCase()} market`,
      body: `${GOODS[g].name} sells ${Math.round(drop * 100)}% below normal because you supply ${Math.round((m.playerSold / m.totalSold) * 100)}% of it. Every crop has its own market — grow a mix, or store some and sell when the price recovers.` });
  }

  // tired soil
  const tired = s.fields.filter((f) => fertility(f) < 0.6);
  if (tired.length) add({ id: 'soil', icon: '🪨', page: 'fields', perDay: 0,
    title: `${tired.length} field${tired.length > 1 ? 's have' : ' has'} worn-out soil`,
    body: 'Low nutrients mean smaller harvests for the same seed and labour. Rotate in soybeans (they add nitrogen), rest the field, or use fertiliser.' });

  // debt eating the profit
  const interest = rate(['interest']);
  if (interest > Math.max(20, revenue * 0.15)) add({ id: 'interest', icon: '🏦', page: 'finance', perDay: interest,
    title: 'Interest is eating your profit',
    body: `You pay about ${r0(interest)} a day in interest — ${revenue ? Math.round((interest / revenue) * 100) : 100}% of what you earn. Repay the most expensive loan first, or let the overdraft clear before borrowing more.` });

  // stock rotting in storage (not on the books, but money all the same)
  const spoil = spoilValue(s);
  const spill = REGION_IDS.reduce((a, r) => a + (s.regions[r].unlocked ? stored(s, r).coldOverflow : 0), 0);
  if (spoil > Math.max(500, revenue * 0.1)) add({ id: 'spoil', icon: '🦠', page: 'storage', perDay: spoil,
    title: 'Stock is rotting in storage',
    body: `About ${r0(spoil)} of goods spoil every day${spill > 1 ? ` — ${Math.round(spill).toLocaleString('en-US')} units of chilled goods don't fit in your cold stores` : ''}. Sell perishables (milk, eggs, potatoes) first; only build cold stores for what you can't sell.` });

  // a pile of stock that isn't being sold
  const held = REGION_IDS.reduce((a, r) => a + (Object.keys(s.regions[r].inventory) as GoodId[]).reduce((b, g) => b + (GOODS[g].kind !== 'input' && s.markets[r][g] ? s.regions[r].inventory[g] * s.markets[r][g]!.price : 0), 0), 0);
  if (held > Math.max(20000, revenue * 20)) add({ id: 'idleStock', icon: '📦', page: 'automation', perDay: 0, weight: held / 30,
    title: `${r0(held)} of stock is sitting unsold`,
    body: s.automation.policies.sellDiscipline > 0
      ? `Your manager only sells when the price is at least ${s.automation.policies.sellDiscipline.toFixed(2)}× its 30-day average, or when storage passes ${Math.round(s.automation.policies.sellStorageCap * 100)}% full — and spare warehouses keep it below that. Set the sell price to 0.90× in Automation, or sell some yourself on Fields → Sell.`
      : 'Nothing is selling it. Turn on Selling discipline in Automation (needs a manager), or sell on Fields → Sell.' });

  // paying for buildings that do nothing
  const st = stored(s, 'heartland');
  const storeStaff = s.buildings.filter((b) => b.active && BUILDINGS[b.type].category === 'storage').reduce((a, b) => a + BUILDINGS[b.type].staffPerHour * s.macro.cpi * 24, 0);
  if (st.cap.dry > 0 && st.dry / st.cap.dry < 0.5 && storeStaff > 1000) add({ id: 'overStorage', icon: '🏚️', page: 'storage', perDay: storeStaff * (1 - st.dry / st.cap.dry / 0.75),
    title: 'You\'re paying for empty storage',
    body: `Dry storage is only ${Math.round((st.dry / st.cap.dry) * 100)}% full but storage staff cost ${r0(storeStaff)} a day. Sell what you're holding, then demolish the warehouses you don't need.` });
  const lab = s.buildings.filter((b) => b.active && b.type === 'lab');
  if (lab.length && !s.research.active) add({ id: 'idleLab', icon: '🧪', page: 'research', perDay: lab.reduce((a, b) => a + BUILDINGS[b.type].staffPerHour * s.macro.cpi * 24, 0),
    title: 'Your research station has no project',
    body: 'Its staff are paid every hour whether it researches or not. Start a project on Research, or pause the station.' });

  // the general picture, if nothing specific explains it
  const profit = revenue - costs;
  if (profit < 0 && !advice.some((a) => a.perDay > -profit * 0.5) && topCosts[0]) add({ id: 'loss', icon: '🧾', page: 'finance', perDay: -profit,
    title: `You're spending more than you sell`,
    body: `Costs run about ${r0(costs)} a day against ${r0(revenue)} of sales; the biggest line is ${topCosts[0].label.toLowerCase()} (${r0(topCosts[0].perDay)}). ${topCosts[0].label === 'Seed' ? 'Seed is paid at planting and comes back at harvest and sale, so check that harvests are being brought in and sold.' : 'Open Finance to see every line — anything that costs more than what it brings in is worth cutting.'}` });

  // what is working, so the player doesn't break it
  const working: string[] = [];
  const goodMills = s.buildings.filter((b) => b.active && BUILDINGS[b.type].recipe && b.util > 0.85 && buildingMargin(b) > 0);
  if (goodMills.length) working.push(`${[...new Set(goodMills.map((b) => BUILDINGS[b.type].name))].join(', ')} running near full capacity at a profit (${r0(goodMills.reduce((a, b) => a + buildingMargin(b) * 24, 0))}/day).`);
  if (s.herds.length && s.herds.every((h) => h.fed > 0.99 && h.health > 0.8)) working.push('Your animals are fed and healthy.');
  const plans = s.fields.filter((f) => f.plan && !CROPS[f.plan].perennial);
  if (plans.length) {
    const ret = plans.map((f) => { const c = f.plan!; return (expectedYield(s, f, c) * s.markets[f.region][c]!.price) / Math.max(1, f.ha * CONFIG.seedsPerHa * seedCost(s, c)); }).sort((a, b) => a - b)[Math.floor(plans.length / 2)];
    if (ret > 2) working.push(`Your crops pay back about ${ret.toFixed(1)}× their seed at today's prices — planting is worth it; the problem is never the seed bill itself.`);
  }
  if (realProfit > 0 && profit < 0) working.push(`You're building value: counting stock and assets, the farm gains about ${r0(realProfit)} a day even though cash is going down.`);

  advice.sort((a, b) => (b.perDay || b.weight || 0) - (a.perDay || a.weight || 0));
  return { revenue, costs, profit, topCosts, costLines, realProfit, working, advice };
}
