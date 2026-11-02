// Farm advisor: reads the books and the farm, and explains in plain words what is costing money
// and what to try. Pure and deterministic; each tip names the page that fixes it.
import { CROPS, GOODS, LEDGER_KINDS, OPEX_KINDS, REVENUE_KINDS, type GoodId, type LedgerKind } from './config';
import { day, refPrice, sumBooks } from './core';
import { fertility, isManual, isReady, readyAt } from './agriculture';
import type { GameState } from './types';

export interface Advice { id: string; icon: string; title: string; body: string; page: string; perDay: number }
export interface Diagnosis { revenue: number; costs: number; profit: number; topCosts: { label: string; perDay: number }[]; advice: Advice[] }

const r0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Rates are per in-game day, averaged over the last (up to) three days. */
export function diagnose(s: GameState): Diagnosis {
  const days = Math.max(1 / 24, (s.tick - Math.max(0, day(s) - 2) * 24) / 24);
  const rate = (k: LedgerKind[]) => -sumBooks(s, 3, k) / days; // positive = money out
  const revenue = -rate(REVENUE_KINDS);
  const costs = rate([...OPEX_KINDS, 'interest']);
  const topCosts = [...OPEX_KINDS, 'interest' as LedgerKind].map((k) => ({ label: LEDGER_KINDS[k], perDay: rate([k]) }))
    .filter((c) => c.perDay > 1).sort((a, b) => b.perDay - a.perDay).slice(0, 3);
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
  const late = s.fields.filter((f) => isReady(s, f) && !f.plan && s.tick - readyAt(f) > 12);
  if (late.length) add({ id: 'overripe', icon: '🥀', page: 'farm', perDay: 0,
    title: `${late.length} field${late.length > 1 ? 's are' : ' is'} over-ripening`,
    body: 'A ripe crop loses yield every hour it waits after the first half day. Harvest it, or give the field a crop plan so your hands bring it in.' });

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

  // the general picture, if nothing specific explains it
  const profit = revenue - costs;
  if (profit < 0 && !advice.some((a) => a.perDay > -profit * 0.5) && topCosts[0]) add({ id: 'loss', icon: '🧾', page: 'finance', perDay: -profit,
    title: `Your biggest cost is ${topCosts[0].label.toLowerCase()}`,
    body: `It runs about ${r0(topCosts[0].perDay)} a day against ${r0(revenue)} of sales. Open Finance to see every line — anything that costs more than the extra harvest it brings is worth cutting.` });

  advice.sort((a, b) => b.perDay - a.perDay);
  return { revenue, costs, profit, topCosts, advice };
}
