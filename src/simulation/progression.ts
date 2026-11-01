// Eras, unlocks, objectives and milestones. Progress comes from measurable business results.
import { BUILDINGS, CROPS, CROP_IDS, ERAS, REGION_IDS, type CropId } from './config';
import { equity, has, log, stored } from './core';
import { fertility } from './agriculture';
import { topShare } from './corporate';
import type { GameState } from './types';

export const totalHa = (s: GameState) => s.fields.reduce((a, f) => a + f.ha, 0);
export const lifetimeSales = (s: GameState) => (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);
const factories = (s: GameState) => s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').length;

const ERA_CHECKS: ((s: GameState) => boolean)[] = [
  () => true,
  (s) => s.fields.length >= 4 && lifetimeSales(s) >= 12000,
  (s) => lifetimeSales(s) >= 60000 && s.workers.length >= 2,
  (s) => s.machines.length > 0 && lifetimeSales(s) >= 500000,
  (s) => lifetimeSales(s) >= 3_000_000 || (factories(s) >= 2 && lifetimeSales(s) >= 1_500_000),
  (s) => lifetimeSales(s) >= 12_000_000,
  (s) => lifetimeSales(s) >= 60_000_000 || totalHa(s) >= 3000,
  (s) => lifetimeSales(s) >= 300_000_000,
];
/** Sales needed for the next era (for progress bars); 0 when the goal is not about sales. */
export const ERA_SALES = [0, 12000, 60000, 500000, 3_000_000, 12_000_000, 60_000_000, 300_000_000];

export const ERA_UNLOCK_TEXT: Record<number, string[]> = {
  2: ['Hire farm hands to plant and harvest for you', 'Crop plans: tell workers what each field grows', 'Storage, soil care, fertiliser and irrigation', 'Your books: every dollar in and out'],
  3: ['Tractors, harvesters and trucks — buy or lease', 'Land parcels of 5 to 500 hectares', 'Bank loans and farm managers', 'Manager policies: automate rotation, feeding and selling'],
  4: ['Processing: mills, bakeries, presses, wineries', 'Energy: solar and biogas', 'Research station and technology', 'Logistics: haulage and trucks'],
  5: ['Commodity exchange and futures', 'Supply contracts, including premium buyers', 'Crop insurance and full financial statements', 'Analytics and competitor reports'],
  6: ['Four new regions with their own climate, wages and currencies', 'Shipping, tariffs and ports', 'The scenario planner'],
  7: ['Incorporation, shares and dividends', 'Division heads and acquisitions', 'Antitrust scrutiny'],
  8: ['Climate and global market share', 'Long-term milestones'],
};

export const canAdvance = (s: GameState) => s.era < ERAS.length && ERA_CHECKS[s.era](s);

/** The player decides when to step into the next era. */
export function advanceEra(s: GameState): string | null {
  if (!canAdvance(s)) return `Not yet: ${ERAS[s.era]?.requirement ?? 'you have reached the final era'}.`;
  s.era++;
  s.eraReady = false;
  log(s, 'opportunity', `Welcome to Era ${s.era}: ${ERAS[s.era - 1].name}. ${ERA_UNLOCK_TEXT[s.era].join(' · ')}.`, 'overview');
  return null;
}

// ---------------------------------------------------------------- discoveries: one mechanic at a time

export interface Discovery { id: string; title: string; text: string; page?: string; when: (s: GameState) => boolean }
export const DISCOVERIES: Discovery[] = [
  { id: 'forecast', title: 'The weather forecast', text: 'You can now see the next four days of weather. Watch for frost nights in autumn and winter — and for dry spells when your crops need water.', when: (s) => s.era >= 2 },
  { id: 'chickens', title: 'Chickens', text: 'A neighbour is selling hens. Build a chicken coop, buy a flock and they lay a tray of eggs each a day — as long as they are fed. Corn or wheat in your barn works as feed, or turn on automatic feed buying.', page: 'livestock', when: (s) => s.era >= 2 && lifetimeSales(s) >= 16000 },
  { id: 'frost', title: 'Frost', text: 'A frost night damaged crops. Tender crops (everything except wheat and orchards) lose yield on frosty nights, and young seedlings die. Plant with the season, watch the forecast — or build greenhouses, which keep crops warm all year at a heating cost.', page: 'fields', when: () => false },
  { id: 'quality', title: 'Crop quality', text: 'Every harvest now shows its grade: A, B or C. Good soil, steady water, few pests and timely picking make A-grade produce, which sells for more — and premium buyers only take the best.', page: 'markets', when: (s) => s.era >= 2 && s.stats.harvests >= 15 },
  { id: 'upgrades', title: 'Upgrades', text: 'Your buildings are running at their limits. Each can be upgraded twice — a level 2 barn holds 80% more, a level 3 holds 150% more. Factories and animal housing upgrade the same way.', page: 'storage', when: (s) => s.era >= 2 && s.buildings.length > 0 && REGION_IDS.some((r) => { const st = stored(s, r); return st.cap.dry > 0 && st.dry > st.cap.dry * 0.85; }) },
  { id: 'perks', title: 'Specialists', text: 'One of your workers has become skilled enough to specialise. Choose a perk: faster planting or harvesting, healthier animals, slower machine wear, or better crop quality.', page: 'workers', when: (s) => s.workers.some((w) => w.role === 'hand' && w.skill >= 1.05) },
  { id: 'livestock', title: 'More livestock', text: 'Pigs (meat), sheep (wool on little feed) and — once you have machines — dairy cows (milk) are now available. Each needs its own housing.', page: 'livestock', when: (s) => s.discovered.includes('chickens') && (s.herds.some((h) => h.animal === 'chickens' && h.count >= 60) || s.era >= 3) },
  { id: 'orchards', title: 'Orchards & vineyards', text: 'Apple trees and grapevines take weeks to mature and bear nothing at first — then fruit again and again for years, resting each winter. A long-term investment with premium prices.', page: 'fields', when: (s) => s.era >= 3 && lifetimeSales(s) >= 90000 },
  { id: 'machineUpgrades', title: 'Machine upgrades', text: 'Your machines can be upgraded: each tier works 25% faster, burns 10% less fuel and breaks down less often.', page: 'equipment', when: (s) => s.era >= 3 && s.machines.some((m) => m.hours > 200) },
];

// ---------------------------------------------------------------- achievements

export interface Achievement { id: string; icon: string; name: string; text: string; done: (s: GameState) => boolean }
const ha = (s: GameState) => totalHa(s);
const animals = (s: GameState) => s.herds.reduce((a, h) => a + h.count, 0);
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'firstHarvest', icon: '🌾', name: 'First harvest', text: 'Bring in your very first crop.', done: (s) => s.stats.harvests >= 1 },
  { id: 'harvest100', icon: '🧺', name: 'Busy hands', text: '100 harvests.', done: (s) => s.stats.harvests >= 100 },
  { id: 'harvest1000', icon: '🏆', name: 'Harvest legend', text: '1,000 harvests.', done: (s) => s.stats.harvests >= 1000 },
  { id: 'fields4', icon: '🏡', name: 'Smallholder', text: 'Own four fields.', done: (s) => s.fields.length >= 4 },
  { id: 'ha100', icon: '🗺️', name: 'Big country', text: 'Farm 100 hectares.', done: (s) => ha(s) >= 100 },
  { id: 'ha1000', icon: '🌍', name: 'Land baron', text: 'Farm 1,000 hectares.', done: (s) => ha(s) >= 1000 },
  { id: 'sales10k', icon: '💵', name: 'In business', text: '$10,000 of sales.', done: (s) => lifetimeSales(s) >= 10_000 },
  { id: 'sales1m', icon: '💰', name: 'Millionaire', text: '$1,000,000 of sales.', done: (s) => lifetimeSales(s) >= 1_000_000 },
  { id: 'sales100m', icon: '🏦', name: 'Tycoon', text: '$100,000,000 of sales.', done: (s) => lifetimeSales(s) >= 100_000_000 },
  { id: 'firstHire', icon: '👩‍🌾', name: 'An extra pair of hands', text: 'Hire your first worker.', done: (s) => s.workers.length >= 1 },
  { id: 'crew25', icon: '👥', name: 'Proper crew', text: 'Employ 25 people.', done: (s) => s.workers.length >= 25 },
  { id: 'firstMachine', icon: '🚜', name: 'Horsepower', text: 'Own or lease a machine.', done: (s) => s.machines.length >= 1 },
  { id: 'firstFactory', icon: '🏭', name: 'Value added', text: 'Build a processing facility.', done: (s) => s.buildings.some((b) => BUILDINGS[b.type].category === 'processing') },
  { id: 'firstFlock', icon: '🐔', name: 'Cluck cluck', text: 'Keep your first animals.', done: (s) => s.herds.length > 0 },
  { id: 'animals100', icon: '🐄', name: 'Animal farm', text: '100 animals at once.', done: (s) => animals(s) >= 100 },
  { id: 'orchard', icon: '🍎', name: 'Patient planter', text: 'Plant an orchard or vineyard.', done: (s) => s.fields.some((f) => f.crop && CROPS[f.crop].perennial) },
  { id: 'greenhouse', icon: '🌡️', name: 'Under glass', text: 'Build a greenhouse.', done: (s) => s.fields.some((f) => f.greenhouse) },
  { id: 'frost', icon: '❄️', name: 'Weathered it', text: 'Live through your first frost.', done: (s) => s.discovered.includes('frost') },
  { id: 'gradeA', icon: '⭐', name: 'Top quality', text: 'Bring in a grade-A harvest.', done: (s) => s.fields.some((f) => (f.lastHarvest?.quality ?? 0) >= 0.8) },
  { id: 'research5', icon: '🔬', name: 'Innovator', text: 'Complete five research projects.', done: (s) => s.research.done.length >= 5 },
  { id: 'region2', icon: '✈️', name: 'Going places', text: 'Operate in a second region.', done: (s) => REGION_IDS.filter((r) => s.regions[r].unlocked).length >= 2 },
  { id: 'era4', icon: '⚙️', name: 'Industrialist', text: 'Reach the Agricultural Industry era.', done: (s) => s.era >= 4 },
  { id: 'era8', icon: '🌐', name: 'Feeding the world', text: 'Reach the Global Food System era.', done: (s) => s.era >= 8 },
  { id: 'streak3', icon: '🔥', name: 'Regular', text: 'Complete daily goals 3 days in a row.', done: (s) => (s.daily?.streak ?? 0) >= 3 },
  { id: 'streak7', icon: '🎖️', name: 'Devoted farmer', text: 'Complete daily goals 7 days in a row.', done: (s) => (s.daily?.streak ?? 0) >= 7 },
];

/** Small welcome gifts while the player is finding their feet (seed only — no free money). */
const STARTER_GIFTS: { id: string; when: (s: GameState) => boolean; give: (s: GameState) => void; text: string }[] = [
  { id: 'gift1', when: (s) => s.stats.harvests >= 1, give: (s) => (s.seeds.wheat += 10), text: 'A neighbour drops off a bag of wheat seed to celebrate your first harvest (+10 seeds).' },
  { id: 'gift2', when: (s) => s.fields.length >= 2, give: (s) => (s.seeds.corn += 10), text: 'The seed merchant throws in a free bag of corn seed with your new field (+10 corn seeds).' },
  { id: 'gift3', when: (s) => s.fields.length >= 4, give: (s) => (s.seeds.potatoes += 10), text: 'Word is getting around: a farmer gifts you seed potatoes (+10).' },
];

export function discover(s: GameState, id: string) {
  if (s.discovered.includes(id)) return;
  s.discovered.push(id);
  const d = DISCOVERIES.find((x) => x.id === id);
  if (d) log(s, 'opportunity', `Discovered: ${d.title}. ${d.text}`, d.page);
}

export function progressionTick(s: GameState) {
  const ready = canAdvance(s);
  if (ready && !s.eraReady) log(s, 'opportunity', `You can now advance to Era ${s.era + 1}: ${ERAS[s.era].name}. Take your time — advance when you are ready.`, 'overview');
  s.eraReady = ready;
  for (const d of DISCOVERIES) if (!s.discovered.includes(d.id) && d.when(s)) discover(s, d.id);
  for (const g of STARTER_GIFTS) if (!s.rewarded.includes(g.id) && g.when(s)) (s.rewarded.push(g.id), g.give(s), log(s, 'opportunity', g.text, 'farm'));
  if (s.tick % 6 === 0) for (const a of ACHIEVEMENTS) if (!s.achievements.includes(a.id) && a.done(s)) (s.achievements.push(a.id), log(s, 'opportunity', `Achievement unlocked: ${a.icon} ${a.name}`));
  for (const c of CROP_IDS) {
    if (s.unlockedCrops.includes(c)) continue;
    const def = CROPS[c];
    const ok = def.perennial ? s.discovered.includes('orchards') : def.unlockHarvests !== undefined ? s.stats.harvests >= def.unlockHarvests && s.era >= def.minEra : s.era >= def.minEra;
    if (!ok) continue;
    s.unlockedCrops.push(c);
    if (CROP_UNLOCK[c]) log(s, 'opportunity', CROP_UNLOCK[c], 'fields');
  }
}

const CROP_UNLOCK: Record<CropId, string> = {
  wheat: '',
  corn: 'A neighbour offers corn seed. Slower to grow, but each hectare yields far more — and it sells in its own market.',
  potatoes: 'Seed potatoes are now available: the slowest crop, the biggest harvest, the least tending per dollar. They keep best in cold storage.',
  soybeans: 'Soybeans are available. They put nitrogen back into the soil — ideal in rotation after wheat or corn.',
  rice: 'Rice is available. It needs very wet soil: think irrigation or the River Plains.',
  sugarcane: 'Sugarcane is available. Huge tonnage, but cut cane rots within days unless milled.',
  cotton: 'Cotton is available. A non-food cash crop that loves heat and tolerates dry soil.',
  coffee: 'Coffee is available — but only the Tropical Highlands can grow it.',
  apples: '',
  grapes: '',
};

// ---------------------------------------------------------------- objectives (onboarding)

export function objective(s: GameState): { title: string; hint: string; page?: string } {
  const planted = s.fields.some((f) => f.crop) || s.stats.harvests > 0;
  if (!planted) return { title: 'Plant your first wheat crop', hint: 'Select your field and press Plant. You already own the ten seeds it needs.', page: 'fields' };
  if (s.stats.harvests === 0) return { title: 'Wait for your wheat to mature', hint: 'Wheat takes 12 hours. Harvest it once the field turns gold.', page: 'fields' };
  if (s.stats.sales === 0) return { title: 'Sell your harvest at the local market', hint: 'Selling a lot at once pushes the price down — watch the quote.', page: 'markets' };
  if (s.fields.length < 2) return { title: 'Buy a second field', hint: 'More land means more harvests running at once.', page: 'fields' };
  if (s.eraReady) return { title: `Advance to Era ${s.era + 1}`, hint: `${ERAS[s.era].name} is ready when you are — press Advance to see what it brings.`, page: 'overview' };
  if (s.era < 2) return { title: 'Grow to four fields and $12,000 in sales', hint: 'Try corn and potatoes: compare profit per hour, not just speed.', page: 'fields' };
  if (!s.workers.length) return { title: 'Hire your first farm hand', hint: 'Workers plant and harvest fields that have a crop plan. They cost wages every working hour.', page: 'workers' };
  if (!s.fields.some((f) => f.plan)) return { title: 'Give your fields a crop plan', hint: 'Workers only replant fields that have a plan. Set one on the Fields page.', page: 'fields' };
  if (s.era < 3) return { title: 'Reach $60,000 in sales with two workers', hint: 'Watch soil fertility: rotating crops (soybeans!) keeps yields up.', page: 'fields' };
  if (!s.machines.length) return { title: 'Buy or lease your first machine', hint: 'A tractor plants 4 ha an hour. Compare its fuel and servicing with the wages it saves.', page: 'equipment' };
  if (s.era < 4) return { title: 'Reach $500,000 in sales', hint: 'Buy 5 ha parcels — larger fields must be worked by hired hands and machines.', page: 'fields' };
  if (!s.buildings.some((b) => BUILDINGS[b.type].category === 'processing')) return { title: 'Build your first processing facility', hint: 'A flour mill turns wheat into flour. It only pays when it runs near capacity.', page: 'production' };
  if (s.era < 5) return { title: 'Reach $3,000,000 in sales', hint: 'Watch for bottlenecks in the production chain.', page: 'production' };
  if (!s.futures.length && !s.contracts.some((c) => c.accepted)) return { title: 'Lock in a price', hint: 'Accept a supply contract or hedge with futures on the Markets page.', page: 'markets' };
  if (s.era < 6) return { title: 'Reach $12,000,000 in sales', hint: 'Research can transform your costs — start a project.', page: 'research' };
  if (REGION_IDS.filter((r) => s.regions[r].unlocked).length < 2) return { title: 'Expand into a second region', hint: 'Each region has different land prices, climate, wages and demand.', page: 'world' };
  if (s.era < 7) return { title: 'Reach $60,000,000 in sales or 3,000 ha', hint: 'Ship goods to where prices are highest, net of freight and tariffs.', page: 'logistics' };
  if (!s.corp.incorporated) return { title: 'Incorporate your company', hint: 'Unlocks shares, executives and acquisitions.', page: 'corporation' };
  if (s.era < 8) return { title: 'Reach $300,000,000 in sales', hint: 'Acquire distressed competitors cheaply — after due diligence.', page: 'competitors' };
  const next = MILESTONES.find((m) => !s.milestones.includes(m.id));
  return next ? { title: next.name, hint: next.text, page: 'policy' } : { title: 'Run the global food system', hint: 'Every milestone achieved. Keep optimising — the world keeps changing.', page: 'overview' };
}

// ---------------------------------------------------------------- milestones (endgame)

export interface Milestone { id: string; name: string; text: string; progress: (s: GameState) => number }
export const MILESTONES: Milestone[] = [
  { id: 'feedMillion', name: 'Feed a million people', text: 'Sell enough food to feed one million people for a year (cumulative).', progress: (s) => s.stats.peopleFed / 1e6 },
  { id: 'feedBillion', name: 'Feed a billion people', text: 'The long game: a billion people-years of food delivered.', progress: (s) => s.stats.peopleFed / 1e9 },
  { id: 'share25', name: 'A quarter of world supply', text: 'Supply 25% of global consumption of any crop.', progress: (s) => topShare(s) / 0.25 },
  { id: 'automated', name: 'Fully automated supply chain', text: 'Every field planned, 5+ automation rules, autonomous machines and 3+ factories.', progress: (s) => [s.fields.every((f) => f.plan), s.automation.rules.filter((r) => r.enabled).length >= 5, s.machines.some((m) => m.type.startsWith('robot')), s.buildings.filter((b) => BUILDINGS[b.type].recipe).length >= 3].filter(Boolean).length / 4 },
  { id: 'everyRegion', name: 'Profitable everywhere', text: 'Positive 30-day operating profit in all five regions.', progress: (s) => REGION_IDS.filter((r) => s.books.slice(-30).reduce((a, b) => a + (b.op[r] ?? 0), 0) > 0).length / 5 },
  { id: 'resilient', name: 'Climate resilient', text: 'Irrigate 80% of your land and hold drought-resistant seed.', progress: (s) => (Math.min(1, s.fields.reduce((a, f) => a + (f.irrigated ? f.ha : 0), 0) / Math.max(1, totalHa(s)) / 0.8) + (has(s, 'droughtResistant') || s.research.licensed.includes('droughtLicense') ? 1 : 0)) / 2 },
  { id: 'sustainable', name: 'Sustainable at scale', text: 'Average fertility above 80% across 500+ ha.', progress: (s) => Math.min(1, totalHa(s) / 500) * Math.min(1, (s.fields.reduce((a, f) => a + fertility(f) * f.ha, 0) / Math.max(1, totalHa(s))) / 0.8) },
  { id: 'crisis', name: 'Survive a global food crisis', text: 'Remain solvent through a global food crisis.', progress: (s) => (s.stats.crisisSurvived ? 1 : 0) },
  { id: 'conglomerate', name: 'Vertically integrated conglomerate', text: 'Six kinds of processing facility across three regions.', progress: (s) => {
    const kinds = new Set(s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').map((b) => b.type)).size;
    const regions = new Set(s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').map((b) => b.region)).size;
    return (Math.min(1, kinds / 6) + Math.min(1, regions / 3)) / 2;
  } },
];

export function milestonesDaily(s: GameState) {
  if (s.era < 8) return;
  for (const m of MILESTONES) if (!s.milestones.includes(m.id) && m.progress(s) >= 1) {
    s.milestones.push(m.id);
    log(s, 'opportunity', `Milestone achieved: ${m.name}.`, 'policy');
  }
  s.stats.maxEquity = Math.max(s.stats.maxEquity, equity(s));
}

// ---------------------------------------------------------------- pages (progressive interface)

export interface PageDef { id: string; label: string; purpose: string; unlocked: (s: GameState) => boolean }
export const PAGES: PageDef[] = [
  { id: 'overview', label: 'Overview', purpose: 'Your business at a glance.', unlocked: (s) => s.era >= 2 },
  { id: 'fields', label: 'Fields', purpose: 'Plant, harvest, plan crops and look after your soil.', unlocked: () => true },
  { id: 'livestock', label: 'Livestock', purpose: 'Chickens, pigs, sheep and cows: housing, feed and health.', unlocked: (s) => s.discovered.includes('chickens') },
  { id: 'markets', label: 'Markets', purpose: 'Prices, selling, buying inputs — later futures and contracts.', unlocked: (s) => s.stats.harvests > 0 },
  { id: 'workers', label: 'Workers', purpose: 'Hire hands and managers, set pay, train skills.', unlocked: (s) => s.era >= 2 },
  { id: 'storage', label: 'Storage', purpose: 'Capacity and spoilage in each region.', unlocked: (s) => s.era >= 2 },
  { id: 'finance', label: 'Finance', purpose: 'Books, loans, insurance and statements.', unlocked: (s) => s.era >= 2 },
  { id: 'equipment', label: 'Equipment', purpose: 'Machines: buy, lease, service and repair.', unlocked: (s) => s.era >= 3 },
  { id: 'automation', label: 'Automation', purpose: 'Policies for managers, then if/then rules.', unlocked: (s) => s.era >= 3 },
  { id: 'production', label: 'Production', purpose: 'Factories, energy and the production chain.', unlocked: (s) => s.era >= 4 },
  { id: 'research', label: 'Research', purpose: 'Invest in technology that changes how you farm.', unlocked: (s) => s.era >= 4 },
  { id: 'logistics', label: 'Logistics', purpose: 'Trucks, haulage and shipping between regions.', unlocked: (s) => s.era >= 4 },
  { id: 'analytics', label: 'Analytics', purpose: 'Profitability, break-even and the scenario planner.', unlocked: (s) => s.era >= 5 },
  { id: 'competitors', label: 'Competitors', purpose: 'Rival companies, market reports and acquisitions.', unlocked: (s) => s.era >= 5 },
  { id: 'world', label: 'World', purpose: 'Regions, climate, events and expansion.', unlocked: (s) => s.era >= 5 || s.events.length > 0 },
  { id: 'corporation', label: 'Corporation', purpose: 'Divisions, executives, shares and dividends.', unlocked: (s) => s.era >= 7 },
  { id: 'policy', label: 'Policy', purpose: 'Regulation, reputation and long-term milestones.', unlocked: (s) => s.era >= 7 },
];

