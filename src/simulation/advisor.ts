// Farm advisor: reads the last two weeks of books and the farm, and names the few changes worth the most money.
// Rates use whole finished days only, so the advice holds steady through the day. Pure and deterministic.
import { BUILDINGS, CONFIG, CROPS, GOODS, LEDGER_KINDS, MACHINES, OPEX_KINDS, REVENUE_KINDS, REGION_IDS, type GoodId, type LedgerKind } from './config';
import { day, refPrice, seedCost, stored } from './core';
import { buildingMargin } from './processing';
import { cropScore } from './automation';
import { expectedYield, fertility, isManual, isReady, readyAt, spoilValue, spreadNeed } from './agriculture';
import type { Action, GameState } from './types';
import { parcelPrice } from './engine';
import { stageAtLeast } from './stages';

/**
 * title: the verdict. proof: one short line of evidence. gain: $/day the fix is worth (0 when there is no clean figure).
 * act: a button that does the fix; otherwise the button opens `page`.
 */
export interface Advice { id: string; icon: string; title: string; proof: string; page: string; gain: number; weight?: number; act?: { label: string; action: Action } }
export interface Diagnosis {
  revenue: number; costs: number; profit: number;
  /** every cost line, biggest first */ costLines: { label: string; perDay: number }[];
  /** profit if the top tips with a $ figure are followed */ after: number;
  /** finished days the rates are averaged over (0 = today so far) */ days: number;
  working: string[];
  advice: Advice[];
}

const WINDOW = 14;
const r0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function diagnose(s: GameState): Diagnosis {
  const today = day(s), full = Math.min(WINDOW, today);
  // whole finished days; on the very first day, today so far scaled to a day
  const books = full ? s.books.filter((b) => b.day >= today - full && b.day < today) : s.books.filter((b) => b.day === today);
  const span = full || Math.max(1 / 24, (s.tick % 24) / 24);
  const rate = (k: LedgerKind[]) => -books.reduce((a, b) => a + k.reduce((c, x) => c + (b.kinds[x] ?? 0), 0), 0) / span; // positive = money out
  const revenue = -rate(REVENUE_KINDS);
  const costs = rate([...OPEX_KINDS, 'interest']);
  const profit = revenue - costs;
  const costLines = [...OPEX_KINDS, 'interest' as LedgerKind].map((k) => ({ label: LEDGER_KINDS[k], perDay: rate([k]) }))
    .filter((c) => c.perDay > 1).sort((a, b) => b.perDay - a.perDay);
  const share = (x: number) => (revenue > 1 ? x / revenue : 1);
  const advice: Advice[] = [];
  const add = (a: Advice) => advice.push(a);
  const ha = s.fields.reduce((a, f) => a + f.ha, 0);

  // managers: the owner oversees 8 hands; each manager 20 more; one runs Automation policies
  const hands = s.workers.filter((w) => w.role === 'hand').length;
  const mgrs = s.workers.filter((w) => w.role === 'manager');
  const policies = s.automation.policies.autoRotate || s.automation.policies.autoFertilize || s.automation.policies.sellDiscipline > 0;
  const forCrew = Math.max(0, Math.ceil((hands - 8) / 20));
  const needed = Math.max(policies ? 1 : 0, forCrew), each = mgrs.length ? rate(['salaries']) / mgrs.length : 0;
  // spare managers; or the one kept only to run automation when the farm can't yet carry the salary
  const cut = mgrs.length > needed ? mgrs.length - needed : forCrew === 0 && mgrs.length && share(each) > 0.15 ? 1 : 0;
  if (cut) add({ id: 'managers', icon: '🧑‍💼', page: 'workers', gain: each * cut,
    title: mgrs.length === 1 ? `Manager costs ${pct(share(each))} of your sales` : `${plural(cut, 'manager')} you don't need yet`,
    proof: `${r0(each)}/day${mgrs.length > 1 ? ' each' : ''} · you can run 8 hands yourself, you have ${hands}${cut >= mgrs.length && policies ? ' · you would plant and sell yourself' : ''}`,
    act: { label: 'Let go', action: { type: 'fire', workerId: mgrs[mgrs.length - 1].id } } });

  // the advisor's own fee
  const fee = rate(['advisor']);
  if (s.advisor && fee > 1 && share(fee) > 0.05) add({ id: 'advisorFee', icon: '💡', page: 'workers', gain: fee,
    title: `Advisor costs ${pct(share(fee))} of your sales`, proof: `${r0(fee)}/day · hire again any time from Workers`,
    act: { label: 'Cancel', action: { type: 'setAdvisor', on: false } } });

  // hands with nothing to do: labour the planned fields need vs what the crew supplies
  const planned = s.fields.filter((f) => !isManual(f) || f.plan);
  const needHours = planned.reduce((a, f) => { const c = CROPS[f.plan ?? f.crop ?? 'wheat']; return a + (f.ha * (c.harvestHours + 1) * 24) / c.growthTicks; }, 0);
  if (hands > 0 && hands * 12 > needHours * 2.5 + 12) {
    const spare = Math.floor((hands * 12 - needHours * 1.5) / 12);
    const hand = s.workers.filter((w) => w.role === 'hand').pop()!;
    if (spare > 0) add({ id: 'idleHands', icon: '😴', page: planned.length ? 'workers' : 'fields', gain: rate(['wages']) * (spare / hands),
      title: planned.length ? `${plural(spare, 'hand')} with little to do` : 'Hands have no crop plans to follow',
      proof: planned.length ? `Fields need ~${Math.round(needHours)} work-hours a day, ${hands} hands give ${hands * 12}` : 'Hands only replant fields that have a crop plan',
      act: planned.length ? { label: 'Let one go', action: { type: 'fire', workerId: hand.id } } : undefined });
  }

  // crew too big for the land: grow into it
  const crew = rate(['wages', 'salaries']);
  const parcels = (s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'farm-business')) && s.regions.heartland.unlocked, p5 = parcelPrice(s, 'heartland', 5);
  if (ha > 0 && revenue > 1 && share(crew) > 0.45 && !advice.some((a) => a.id === 'idleHands')) add({ id: 'smallFarm', icon: '🌾', page: 'fields', gain: 0, weight: crew * 0.3,
    title: `Your crew costs ${pct(share(crew))} of sales`,
    proof: parcels ? `Only ${Math.round(ha)} ha to work · 5 ha costs ${r0(p5)} (${r0(p5 / 5)}/ha)` : `${r0(crew / ha)}/day per hectare on ${Math.round(ha)} ha`,
    act: parcels && s.cash >= p5 ? { label: 'Buy 5 ha', action: { type: 'buyParcel', region: 'heartland', ha: 5 } } : undefined });

  // ripe fields waiting
  const late = s.fields.filter((f) => isReady(s, f) && s.tick - readyAt(f) > 12);
  if (late.length) add({ id: 'overripe', icon: '🥀', page: late.some((f) => f.plan) ? 'workers' : 'farm', gain: 0, weight: 50 * late.length,
    title: `${plural(late.length, 'field')} over-ripening`, proof: late.some((f) => !f.plan) ? 'Ripe crops lose yield every hour they wait' : 'Your crew can\'t keep up: hire hands or add machines' });

  // machines without drivers, or planned land the crew can't keep up with
  const drivable = s.machines.filter((m) => MACHINES[m.type].haPerHour && !MACHINES[m.type].autonomous && !m.broken).length;
  const waiting = s.fields.filter((f) => f.plan && !f.crop).length;
  if (hands > 0 && (drivable > hands || (waiting > 1 && drivable < hands && needHours > hands * 12 * 1.2))) {
    const lost = s.fields.filter((f) => f.plan && !f.crop).reduce((a, f) => a + Math.max(0, cropScore(s, f, f.plan!)) * 24 * f.ha, 0);
    const spare = drivable - hands, wage = hands ? rate(['wages']) / hands : 0;
    // only worth saying when the crop a hand brings in beats the hand's wage
    if (lost > wage) add({ id: 'shortHands', icon: '🧑‍🌾', page: 'workers', gain: lost - wage,
      title: spare > 0 ? `${plural(spare, 'machine')} with no driver` : `${plural(waiting, 'field')} waiting for hands`,
      proof: spare > 0 ? `${hands} hands, ${drivable} machines · a hand costs less than an idle field` : `Hire a hand, or give them a machine`,
      act: { label: 'Hire a hand', action: { type: 'hire', region: 'heartland', role: 'hand', wageFactor: 1 } } });
  }

  // flooding a market
  for (const g of Object.keys(GOODS) as GoodId[]) {
    const m = s.markets.heartland[g];
    if (!m || m.playerSold < 1 || m.playerSold / Math.max(1, m.totalSold) < 0.25) continue;
    const drop = 1 - m.price / refPrice(s, g);
    if (drop > 0.2) add({ id: `flood:${g}`, icon: '📉', page: 'markets', gain: 0, weight: drop * revenue * 0.2,
      title: `${GOODS[g].name} sells ${pct(drop)} below normal`, proof: `You supply ${pct(m.playerSold / m.totalSold)} of it · plant a mix of crops` });
  }

  // tired soil: spread the manure already in the barn
  const tired = s.fields.filter((f) => fertility(f) < 0.6 && !f.spreading);
  if (tired.length) {
    let manure = s.regions.heartland.inventory.manure ?? 0;
    const feedable = tired.filter((f) => f.region === 'heartland' && (manure -= spreadNeed(s, f, 'manure')) >= 0);
    const avg = tired.reduce((a, f) => a + fertility(f), 0) / tired.length;
    add({ id: 'soil', icon: '🪨', page: 'fields', gain: 0, weight: 20 * tired.length,
      title: `${plural(tired.length, 'field')} with worn-out soil`, proof: `Soil at ${pct(avg)}${feedable.length ? ` · you have manure for ${feedable.length}` : ' · rotate in soybeans or fertilise'}`,
      act: feedable.length ? { label: 'Spread manure', action: { type: 'fertilize', fieldIds: feedable.map((f) => f.id), source: 'manure' } } : undefined });
  }

  // interest
  const interest = rate(['interest']);
  if (interest > Math.max(20, revenue * 0.15)) add({ id: 'interest', icon: '🏦', page: 'finance', gain: interest,
    title: `Interest costs ${pct(share(interest))} of your sales`, proof: `${r0(interest)}/day · repay the dearest loan first` });

  // spoiling stock
  const spoil = spoilValue(s);
  const spill = REGION_IDS.reduce((a, r) => a + (s.regions[r].unlocked ? stored(s, r).coldOverflow : 0), 0);
  if (spoil > Math.max(500, revenue * 0.1)) add({ id: 'spoil', icon: '🦠', page: 'storage', gain: spoil,
    title: 'Stock is rotting in storage', proof: spill > 1 ? `${Math.round(spill).toLocaleString('en-US')} chilled units don't fit your cold stores` : 'Sell perishables first' });

  // stock piling up unsold
  const held = REGION_IDS.reduce((a, r) => a + (Object.keys(s.regions[r].inventory) as GoodId[]).reduce((b, g) => b + (GOODS[g].kind !== 'input' && s.markets[r][g] ? s.regions[r].inventory[g] * s.markets[r][g]!.price : 0), 0), 0);
  if (held > Math.max(20000, revenue * 20)) add({ id: 'idleStock', icon: '📦', page: s.automation.policies.sellDiscipline > 0 ? 'automation' : 'markets', gain: 0, weight: held / 30,
    title: `${r0(held)} of stock sitting unsold`, proof: s.automation.policies.sellDiscipline > 0 ? `Your manager waits for ${s.automation.policies.sellDiscipline.toFixed(2)}× the average price` : 'Nothing is selling it' });

  // paying for empty buildings
  const st = stored(s, 'heartland');
  const storeStaff = s.buildings.filter((b) => b.active && BUILDINGS[b.type].category === 'storage').reduce((a, b) => a + BUILDINGS[b.type].staffPerHour * s.macro.cpi * 24, 0);
  if (st.cap.dry > 0 && st.dry / st.cap.dry < 0.5 && storeStaff > 1000) add({ id: 'overStorage', icon: '🏚️', page: 'storage', gain: storeStaff * (1 - st.dry / st.cap.dry / 0.75),
    title: 'Paying for empty storage', proof: `${pct(st.dry / st.cap.dry)} full · staff cost ${r0(storeStaff)}/day` });
  const lab = s.buildings.filter((b) => b.active && b.type === 'lab');
  if (lab.length && !s.research.active) add({ id: 'idleLab', icon: '🧪', page: 'research', gain: lab.reduce((a, b) => a + BUILDINGS[b.type].staffPerHour * s.macro.cpi * 24, 0),
    title: 'Research station has no project', proof: 'Its staff are paid either way' });

  // nothing specific explains a loss
  if (profit < 0 && !advice.some((a) => a.gain > -profit * 0.5) && costLines[0]) add({ id: 'loss', icon: '🧾', page: 'finance', gain: 0, weight: -profit,
    title: `Spending more than you sell`, proof: `Biggest cost: ${costLines[0].label.toLowerCase()} ${r0(costLines[0].perDay)}/day` });

  // what is working, so the player doesn't break it
  const working: string[] = [];
  const goodMills = s.buildings.filter((b) => b.active && BUILDINGS[b.type].recipe && b.util > 0.85 && buildingMargin(b) > 0);
  if (goodMills.length) working.push(`${[...new Set(goodMills.map((b) => BUILDINGS[b.type].name))].join(', ')} busy and profitable`);
  if (s.herds.length && s.herds.every((h) => h.fed > 0.99 && h.health > 0.8)) working.push('Animals fed and healthy');
  const plans = s.fields.filter((f) => f.plan && !CROPS[f.plan].perennial);
  if (plans.length) {
    const ret = plans.map((f) => { const c = f.plan!; return (expectedYield(s, f, c) * s.markets[f.region][c]!.price) / Math.max(1, f.ha * CONFIG.seedsPerHa * seedCost(s, c)); }).sort((a, b) => a - b)[Math.floor(plans.length / 2)];
    if (ret > 2) working.push(`Crops return ${ret.toFixed(1)}× their seed`);
  }

  advice.sort((a, b) => (b.gain || b.weight || 0) - (a.gain || a.weight || 0));
  const top = advice.slice(0, 3);
  return { revenue, costs, profit, costLines, after: profit + top.reduce((a, x) => a + x.gain, 0), days: full, working, advice: top };
}
