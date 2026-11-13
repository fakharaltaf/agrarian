import { workingFactories } from './stages/shared';
// Eras, unlocks, objectives and milestones. Progress comes from measurable business results.
import { worldOf } from './world';
import { CHAPTER_SALES, BUILDINGS, CROPS, CROP_IDS, ERAS, GOODS, REGION_IDS, type CropId, INDUSTRY_FACTORY_SALES } from './config';
import { equity, has, log, stored } from './core';
import { fertility, growth, isReady } from './agriculture';
import { topShare } from './corporate';
import { eraUnlockAvailable, stageIdForEra, tickActiveStage, NEXT_STAGE, stageAtLeast, STAGES } from './stages';
import { refreshHomestead } from './stages/homestead';
import { PLAYABLE_CHAPTERS, frontierTick, atFrontier } from './stages/frontier';
import { communityOf, population, homeCapacity, familiesHere, homeFamilies } from './community-state';
import { settlementTick, canStartSettlement } from './stages/settlement';
import { canStartTown, townDaily } from './stages/town';
import { canStartCity, cityDaily } from './stages/city';
import { plannedServiceCost, serviceDailyCost } from './stages/town';
import { dailyArrivals, wellbeing } from './stages/settlement';
import { canStartRegion, regionDaily, protection as regionProtection } from './stages/region';
import { nextMarketDay } from './stages/market-town';
import { canStartNation, nationDaily, soldiers } from './stages/nation';
import { nationActive, nationOf } from './nation-state';
import { regionActive, regionOf, NEIGHBOURS, NEIGHBOUR_IDS } from './region-state';
import { cityActive, cityOf } from './city-state';
import { townOf } from './town-state';
import type { GameState } from './types';

export const totalHa = (s: GameState) => s.fields.reduce((a, f) => a + f.ha, 0);
export const lifetimeSales = (s: GameState) => (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);
/** Sales needed for the next era (for progress bars); 0 when the goal is not about sales. */
export const ERA_SALES = [0, 12000, 60000, 500000, 3_000_000, 12_000_000, 60_000_000, 300_000_000];
export const HOMESTEAD_SALES_GOAL = CHAPTER_SALES.homestead;

export const ERA_UNLOCK_TEXT: Record<number, string[]> = {
  2: ['Hire farm hands to plant and harvest for you', 'Crop plans: tell workers what each field grows', 'Storage, soil care, fertiliser and irrigation', 'Your books: every dollar in and out'],
  3: ['Tractors, harvesters and trucks — buy or lease', 'Land parcels of 5 to 500 hectares', 'Bank loans and farm managers', 'Manager policies: automate rotation, feeding and selling'],
  4: ['Processing: mills, bakeries, presses, wineries', 'Energy: solar and biogas', 'Research station and technology', 'Logistics: haulage and trucks'],
  5: ['Commodity exchange and futures', 'Supply contracts, including premium buyers', 'Crop insurance and full financial statements', 'Analytics and competitor reports'],
  6: ['Four new regions with their own climate, wages and currencies', 'Shipping, tariffs and ports', 'The scenario planner'],
  7: ['Incorporation, shares and dividends', 'Division heads and acquisitions', 'Antitrust scrutiny'],
  8: ['Climate and global market share', 'Long-term milestones'],
};

function newStageReady(s: GameState) {
  if (s.stageId === 'homestead') return s.fields.length >= 4 && lifetimeSales(s) >= HOMESTEAD_SALES_GOAL;
  if (s.stageId === 'market-town') return s.fields.length >= 12 || lifetimeSales(s) >= CHAPTER_SALES['market-town'];
  if (s.stageId === 'farm-business') return s.workers.filter((w) => w.role === 'hand').length >= 2 && lifetimeSales(s) >= CHAPTER_SALES['farm-business'];
  if (s.stageId === 'industry') return canStartSettlement(s);
  if (s.stageId === 'settlement') return canStartTown(s);
  if (s.stageId === 'town') return canStartCity(s);
  if (s.stageId === 'city') return canStartRegion(s);
  if (s.stageId === 'region') return canStartNation(s);
  // Later chapters are offered only when their mechanics are implemented.
  return false;
}

export const canAdvance = (s: GameState) => s.legacyProgression && !communityOf(s).active
  ? s.era < ERAS.length && eraUnlockAvailable(s, s.era + 1)
  : PLAYABLE_CHAPTERS.some(id => id === NEXT_STAGE[s.stageId]) && newStageReady(s);

/** The player decides when to step into the next era. */
export function advanceEra(s: GameState): string | null {
  if (!canAdvance(s)) return `Not yet: ${ERAS[s.era]?.requirement ?? 'you have reached the final era'}.`;
  if (!s.legacyProgression && s.stageId === 'homestead' && !s.charters.trader) return 'Choose the Fair or Shrewd trader charter before entering Market Town.';
  const previous = s.stageId;
  if (!s.legacyProgression || communityOf(s).active) {
    const next = NEXT_STAGE[previous];
    if (!next) return 'You have reached the newest chapter.';
    if(next==='city')return 'Choose a City watch charter at the City watch.';
    if(next==='region')return 'Choose a border policy on the Region map.';
    if(next==='nation')return 'Choose your path on the Nation page.';
    if (next === 'town') return 'Open the Town hall to welcome newcomers.';
    if (next === 'settlement') return 'Open the Community page to bring your workers’ families.';
    s.stageId = next;
    s.stageState[next] ??= STAGES[next].createState();
    if (!s.legacyProgression) s.era = Math.min(8, s.era + 1);
  } else {
    s.era++;
    s.stageId = stageIdForEra(s.era);
  }
  s.eraReady = false;
  const title = s.legacyProgression && !communityOf(s).active ? `Era ${s.era}: ${ERAS[s.era - 1].name}` : STAGES[s.stageId].title;
  const preview = s.legacyProgression && !communityOf(s).active ? (ERA_UNLOCK_TEXT[s.era] ?? []) : [`New chapter: ${title}. Your earlier operation keeps running.`];
  log(s, 'opportunity', `Welcome to ${title}. ${preview.join(' · ')}`, 'overview');
  return null;
}

// ---------------------------------------------------------------- discoveries: one mechanic at a time

export interface Discovery { id: string; title: string; text: string; page?: string; when: (s: GameState) => boolean }
export const DISCOVERIES: Discovery[] = [
  {id:'cityReady',title:'A city worth protecting',text:'400 residents are ready for district utilities and a safety charter. Preview the City watch when you choose; your farm and town keep running.',page:'city',when:canStartCity},
  {id:'cityCase',title:'A response to theft',text:'The City watch has an open case. Rehabilitation invests in prevention; punishment costs less today but reduces happiness. Neither replaces jobs and schools.',page:'city',when:s=>cityActive(s)&&!!cityOf(s).case},
  {id:'nationReady',title:'A nation takes shape',text:'Your answer to the rival has made you a power in the region. Choose Army, Alliance or Neutrality on the Nation page.',page:'nation',when:canStartNation},
  {id:'nationVictory',title:'The first campaign',text:'Every soldier lost is a resident. Weariness lowers happiness; neighbours remember. Keep the army fed and drilled.',page:'nation',when:s=>nationActive(s)&&nationOf(s).history.length>0},
  {id:'regionReady',title:'Neighbours at the gate',text:'Caravans from four neighbouring settlements now reach your city. Open the Region map to choose open borders or walls & tolls.',page:'region',when:canStartRegion},
  {id:'regionRaid',title:'Bandits on the road',text:'A caravan was raided. Police coverage and staffed watchtowers protect the roads; pursue to recover some of the goods.',page:'region',when:s=>regionActive(s)&&!!regionOf(s).raid},
  {id:'regionDemand',title:'A rival makes a move',text:'A neighbour demands tribute. Paying buys their trust; refusing invites more raids for a while.',page:'region',when:s=>regionActive(s)&&!!regionOf(s).demand},
  {id:'cityCaravans',title:'Caravans seek safe passage',text:'Neighbouring traders notice your city. Keep growing here; a future regional chapter will build on your security choices.',page:'city',when:s=>cityActive(s)&&cityOf(s).threatAt>=0},
  { id: 'townSchool', title: 'Newcomers want to settle', text: 'Families from outside want to live here too. Open the Town page to welcome them and place schools, clinics and water.', page: 'town', when: canStartTown },
  { id: 'townClinic', title: 'Clean water and healthcare', text: 'A growing town needs a clinic and safe water. Each service covers only the homes within its reach, so place them among the houses.', page: 'town', when: s => townOf(s).active && townOf(s).services.length > 0 },
  { id: 'townCrime', title: 'Wealth attracts trouble', text: 'Thefts are rising. Jobs, education and roads reduce crime; City will offer police and justice choices when you choose the next chapter.', page: 'town', when: s => townOf(s).active && townOf(s).crime >= .1 },
  { id: 'familyHomes', title: 'A place for families', text: 'Your workers miss their families. Zone some land residential and build homes, and their families will move in. Your existing business keeps running.', page: 'community', when: canStartSettlement },
  { id: 'communityFood', title: 'The first family has arrived', text: 'Families eat from your own food stores. The larder policy protects three days of food and buys an affordable shortfall. Cold weather also needs heating fuel.', page: 'community', when: s => communityOf(s).active && population(s) > 0 },
  { id: 'communityChildren', title: 'Children need somewhere to learn', text: 'Your settlement is growing into a town. Schools and healthcare are the next chapter; you can keep building and running this community in the meantime.', page: 'community', when: () => false },
  { id: 'marketDay', title: 'Your first market day', text: 'The village market is open. Prices now respond to local supply and demand; once a week, a real demand surge brings a brief selling opportunity. The village trader remains available for barter and small trades.', page: 'markets', when: (s) => !s.legacyProgression && s.stageId === 'market-town' },
  { id: 'forecast', title: 'The weather forecast', text: 'You can now see the next four days of weather. Watch for frost nights in autumn and winter — and for dry spells when your crops need water.', when: (s) => stageAtLeast(s, 'farm-business') },
  { id: 'chickens', title: 'Chickens', text: 'A neighbour is selling hens. Build a chicken coop, buy a flock and they lay a tray of eggs each a day — as long as they are fed. Corn or wheat in your barn works as feed, or turn on automatic feed buying.', page: 'livestock', when: (s) => stageAtLeast(s, 'farm-business') && lifetimeSales(s) >= 16000 },
  { id: 'frost', title: 'Frost', text: 'A frost night damaged crops. Tender crops (everything except wheat and orchards) lose yield on frosty nights, and young seedlings die. Plant with the season, watch the forecast — or build greenhouses, which keep crops warm all year at a heating cost.', page: 'fields', when: () => false },
  { id: 'quality', title: 'Crop quality', text: 'Every harvest now shows its grade: A, B or C. Good soil, steady water, few pests and timely picking make A-grade produce, which sells for more — and premium buyers only take the best.', page: 'markets', when: (s) => stageAtLeast(s, 'farm-business') && s.stats.harvests >= 15 },
  { id: 'upgrades', title: 'Upgrades', text: 'Your buildings are running at their limits. Each can be upgraded twice — a level 2 barn holds 80% more, a level 3 holds 150% more. Factories and animal housing upgrade the same way.', page: 'storage', when: (s) => stageAtLeast(s, 'farm-business') && s.buildings.length > 0 && REGION_IDS.some((r) => { const st = stored(s, r); return st.cap.dry > 0 && st.dry > st.cap.dry * 0.85; }) },
  { id: 'perks', title: 'Specialists', text: 'One of your workers has become skilled enough to specialise. Choose a perk: faster planting or harvesting, healthier animals, slower machine wear, or better crop quality.', page: 'workers', when: (s) => s.workers.some((w) => w.role === 'hand' && w.skill >= 1.05) },
  { id: 'livestock', title: 'More livestock', text: 'Pigs (meat), sheep (wool on little feed) and — once you have machines — dairy cows (milk) are now available. Each needs its own housing.', page: 'livestock', when: (s) => s.discovered.includes('chickens') && (s.herds.some((h) => h.animal === 'chickens' && h.count >= 60) || (s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'industry'))) },
  { id: 'orchards', title: 'Orchards & vineyards', text: 'Apple trees and grapevines take weeks to mature and bear nothing at first — then fruit again and again for years, resting each winter. A long-term investment with premium prices.', page: 'fields', when: (s) => stageAtLeast(s, 'farm-business') && lifetimeSales(s) >= 90000 },
  { id: 'machineUpgrades', title: 'Machine upgrades', text: 'Your machines can be upgraded: each tier works 25% faster, burns 10% less fuel and breaks down less often.', page: 'equipment', when: (s) => stageAtLeast(s, 'industry') && s.machines.some((m) => m.hours > 200) },
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
  settlementTick(s);
  townDaily(s);
  cityDaily(s);
  regionDaily(s);
  nationDaily(s);
  frontierTick(s);
  // Keep legacy saves synchronized; new saves advance only when the player accepts a chapter.
  if (s.legacyProgression && !communityOf(s).active) s.stageId = stageIdForEra(s.era);
  if (!s.legacyProgression) refreshHomestead(s); // the village trader remains a side channel in later chapters
  tickActiveStage(s);
  const ready = canAdvance(s);
  if (ready && !s.eraReady) {
    const next = s.legacyProgression && !communityOf(s).active ? `Era ${s.era + 1}: ${ERAS[s.era].name}` : STAGES[NEXT_STAGE[s.stageId]!].title;
    log(s, 'opportunity', `A new chapter is ready: ${next}. Preview it and move on when you choose.`, 'overview');
  }
  s.eraReady = ready;
  if (s.tick % 6 === 0 && !ready) {
    // Small wins on the way to the next chapter: each requirement met gets a line in the journal.
    const rows = chapterGate(s) ?? [];
    for (const r of rows) {
      const key = `gate:${s.stageId}:${r.label}`;
      if (!r.done) s.warned[`${key}:open`] ??= s.tick;
      else if (s.warned[`${key}:open`] !== undefined && s.warned[key] === undefined) { s.warned[key] = s.tick; log(s, 'opportunity', `✓ ${r.label} reached (${rows.filter((x) => x.done).length}/${rows.length} for ${STAGES[NEXT_STAGE[s.stageId]!]?.title ?? 'the next chapter'}).`, 'overview'); }
    }
  }
  for (const d of DISCOVERIES) if (!s.discovered.includes(d.id) && d.when(s)) discover(s, d.id);
  for (const g of STARTER_GIFTS) if (!s.rewarded.includes(g.id) && g.when(s)) (s.rewarded.push(g.id), g.give(s), log(s, 'opportunity', g.text, 'farm'));
  if (s.tick % 6 === 0) for (const a of ACHIEVEMENTS) if (!s.achievements.includes(a.id) && a.done(s)) (s.achievements.push(a.id), log(s, 'opportunity', `Achievement unlocked: ${a.icon} ${a.name}`));
  for (const c of CROP_IDS) {
    if (s.unlockedCrops.includes(c)) continue;
    const def = CROPS[c];
    const inChapter = s.legacyProgression ? s.era >= def.minEra : def.perennial || c === 'apples' || c === 'grapes'
      ? stageAtLeast(s, 'farm-business')
      : def.minEra <= 1 ? true : def.minEra === 2 ? stageAtLeast(s, 'farm-business') : def.minEra <= 5 ? stageAtLeast(s, 'industry') : stageAtLeast(s, 'region');
    const ok = def.perennial ? s.discovered.includes('orchards') && inChapter : def.unlockHarvests !== undefined ? s.stats.harvests >= def.unlockHarvests && inChapter : inChapter;
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

// ---------------------------------------------------------------- chapter gates (one source for the HUD and the gate)

export interface GateRow { label: string; now: number; target: number; fmt: 'n' | 'pct' | 'money'; done: boolean; either?: boolean; atMost?: boolean }
const row = (label: string, now: number, target: number, fmt: GateRow['fmt'] = 'n', atMost = false): GateRow => ({ label, now, target, fmt, atMost, done: atMost ? now <= target : now >= target });
/** What the current chapter needs before the next one opens, as rows with live values. Null when there is no next chapter gate. */
export function chapterGate(s: GameState): GateRow[] | null {
  if (s.legacyProgression && !communityOf(s).active) return null;
  const sales = lifetimeSales(s), hands = s.workers.filter((w) => w.role === 'hand').length, c = communityOf(s), t = townOf(s);
  switch (s.stageId) {
    case 'homestead': return [row('Fields', s.fields.length, 4), row('Sales', sales, HOMESTEAD_SALES_GOAL, 'money')];
    case 'market-town': return [{ ...row('Fields', s.fields.length, 12), either: true }, { ...row('Sales', sales, CHAPTER_SALES['market-town'], 'money'), either: true }];
    case 'farm-business': return [row('Farm hands', hands, 2), row('Sales', sales, CHAPTER_SALES['farm-business'], 'money')];
    case 'industry': return [row('Sales', sales, CHAPTER_SALES.industry, 'money'), row('Production houses working', workingFactories(s), 2), row('Factory goods made', s.stats.factoryMade ?? 0, INDUSTRY_FACTORY_SALES, 'money'), row('Farm hands', hands, 2)];
    case 'settlement': return [row('Families settled', familiesHere(s), 6), row('Happiness', c.happiness, .6, 'pct'), row('Fed', c.fed, .9, 'pct')];
    case 'town': return [row('Residents', population(s), 400), row('Schooling', t.education, .6, 'pct'), row('Health', t.health, .7, 'pct'), row('Fed', c.fed, .9, 'pct')];
    case 'city': {
      if (cityOf(s).threatAt >= 0) return [row('Caravans have arrived', 1, 1)];
      return [row('Residents', population(s), 1200), row('Fed', c.fed, .9, 'pct'), row('Sanitation', cityOf(s).sanitation, .7, 'pct'), row('Crime', cityOf(s).crime, .2, 'pct', true)];
    }
    case 'region': { const v = regionOf(s); return [row('Answer the rival’s demand', v.answered ? 1 : 0, 1)]; }
    default: return null;
  }
}
/** 0..1 progress toward the gate: the weakest required row, or the best of 'either' rows. */
export function gateProgress(rows: GateRow[]) {
  const r = (x: GateRow) => x.done ? 1 : x.atMost ? Math.min(1, x.target / Math.max(1e-9, x.now)) : Math.min(1, x.now / Math.max(1e-9, x.target));
  const either = rows.filter((x) => x.either), all = rows.filter((x) => !x.either);
  return Math.min(either.length ? Math.max(...either.map(r)) : 1, all.length ? Math.min(...all.map(r)) : 1);
}

// ---------------------------------------------------------------- objectives (onboarding)

export function objective(s: GameState): { title: string; hint: string; page?: string } {
  if(canStartNation(s))return {title:'A nation takes shape',hint:'Choose Army, Alliance or Neutrality.',page:'nation'};
  if(nationActive(s)&&s.stageId==='nation'){const v=nationOf(s);
    const r=regionOf(s),bestTrust=Math.max(...NEIGHBOUR_IDS.map(id=>r.neighbours[id].trust));
    if(v.path==='alliance'){const L=v.league;
      if(L.request)return {title:`${NEIGHBOURS[L.request.from].leader} asks for help`,hint:'Answer and the league holds; refuse and members may leave.',page:'nation'};
      if(L.vote)return {title:'The league is voting',hint:'Sanctions close an outsider’s caravans for 60 days.',page:'nation'};
      if(!L.members.length)return bestTrust<60?{title:`Earn an ally’s trust · ${Math.floor(bestTrust)}/60`,hint:'Caravans of wanted goods and gifts on the Region map build trust.',page:'region'}:{title:'Invite your first ally',hint:'Members trade tariff-free and patrol your roads.',page:'nation'};
      if(L.members.length<2)return {title:'Grow the league · 1/2 members',hint:'Two members can vote on sanctions.',page:'nation'};
      return {title:`Hold your league together · cohesion ${Math.round(L.cohesion*100)}%`,hint:'Answer requests; refusing costs trust and cohesion.',page:'nation'};}
    if(v.path==='neutrality'){const routes=NEIGHBOUR_IDS.filter(id=>r.neighbours[id].route&&v.neutral.embargo?.target!==id).length;
      if(v.neutral.dispute)return {title:'Neighbours are quarrelling',hint:'Mediate for both their trust, or bandits roam when they fight.',page:'nation'};
      if(routes<4)return {title:`Feed the region · ${routes}/4 neighbours`,hint:'Every neighbour you supply by caravan adds road protection.',page:'region'};
      return {title:'Indispensable',hint:'Use embargoes sparingly; settle disputes for influence.',page:'nation'};}
    const men=soldiers(s),barracks=townOf(s).services.some(b=>b.type==='barracks');
    if(v.campaign)return {title:'Your army is on campaign',hint:'Keep rations flowing until it returns.',page:'nation'};
    if(!barracks)return {title:'Raise your first barracks',hint:'Every soldier is a resident who stops working the farm or town.',page:'nation'};
    if(men<20)return {title:`Muster soldiers · ${men}/20`,hint:'Barracks need funding and resident adults.',page:'nation'};
    if(v.supply<1)return {title:`Feed your army · rations ${Math.round(v.supply*100)}%`,hint:'Soldiers eat grain or bread from spare stock.',page:'nation'};
    if(v.drill<1)return {title:'Drill your soldiers',hint:'Drill & tactics makes the army 25% stronger.',page:'nation'};
    if(!v.history.length)return {title:'Plan your first campaign',hint:'Pick a target with good odds; casualties are residents.',page:'nation'};
    return {title:'Hold what you have won',hint:'Keep the army fed; neighbours remember.',page:'nation'};}
  if(canStartRegion(s))return {title:'Neighbours at the gate',hint:'Open the Region map and choose your border policy.',page:'region'};
  if(regionActive(s)&&s.stageId==='region'){const v=regionOf(s),ns=Object.values(v.neighbours),days=Math.floor((s.tick-v.enteredAt)/24);
    if(v.demand)return {title:`${NEIGHBOURS[v.demand.from].leader} demands tribute`,hint:'Pay for their trust, or refuse and expect more raids.',page:'region'};
    if(v.raid)return {title:'Bandits raided a caravan',hint:'Pursue to recover some goods, or let it go.',page:'region'};
    if(!ns.some(n=>n.route))return {title:'Send your first caravan',hint:'Pick a neighbour and a good they want (★ earns double trust).',page:'region'};
    if(regionProtection(s)<.5&&!townOf(s).services.some(b=>b.type==='watchtower'))return {title:`Guard the roads · escort ${Math.round(regionProtection(s)*100)}/50%`,hint:'A staffed watchtower and City police protect your caravans.',page:'region'};
    const best=NEIGHBOUR_IDS.reduce((a,b)=>v.neighbours[b].trust>v.neighbours[a].trust?b:a);
    if(!ns.some(n=>n.treaty)&&v.neighbours[best].trust<60)return {title:`Win ${NEIGHBOURS[best].leader}’s trust · ${Math.floor(v.neighbours[best].trust)}/60`,hint:'Wanted goods earn double trust; a goods gift adds 8 once a week. Trusted neighbours can become allies later.',page:'region'};
    if(!ns.some(n=>n.treaty))return {title:`Sign a trade treaty with ${NEIGHBOURS[best].leader}`,hint:'No tariffs on your caravans to them.',page:'region'};
    if(ns.filter(n=>n.route).length<2)return {title:'Open a second caravan route',hint:'More neighbours fed, more trust, more road protection later.',page:'region'};
    return {title:`A rival is watching · day ${Math.min(days,60)}/60`,hint:'Keep caravans on the road; a rival will make a move.',page:'region'};}
  if(canStartCity(s))return {title:'A city worth protecting',hint:'Preview sanitation, lighting and your safety charter.',page:'city'};
  if(cityActive(s)&&s.stageId==='city')return civicObjective(s);
  if (canStartTown(s)) return { title: 'Newcomers want to settle', hint: 'Welcome them on the Town page.', page: 'town' };
  if (townOf(s).active && s.stageId === 'town') return civicObjective(s);
  if (canStartSettlement(s)) return { title: 'Your workers want their families nearby', hint: 'Preview a settlement charter, then build the first homes when you are ready.', page: 'community' };
  if (communityOf(s).active && s.stageId === 'settlement') return civicObjective(s);
  if (!s.legacyProgression) {
    const sales = lifetimeSales(s);
    if (s.stageId === 'homestead') {
      if (!s.stats.harvests) {
        const f = s.fields.find((x) => x.crop);
        if (!f) return { title: 'Plant your first wheat crop', hint: 'Double-tap the field to plant wheat, then bring in the golden crop.', page: 'fields' };
        return isReady(s, f) ? { title: 'Harvest your wheat', hint: 'Tap the golden field to bring it in.', page: 'fields' } : { title: `Your wheat is growing · ${Math.floor(growth(s, f) * 100)}%`, hint: 'Speed up time with the clock if you like. Tap the field when it turns gold.', page: 'fields' };
      }
      if (!s.stats.sales) return { title: 'Meet the village trader', hint: 'Trade a little wheat for useful seed, or sell it to the mill at its posted price.', page: 'markets' };
      if (s.eraReady) return { title: 'Your first market day is ready', hint: 'The open market brings changing prices and new choices. Advance whenever you like.', page: 'overview' };
      if (s.fields.length < 4) return { title: `Grow your farm · ${s.fields.length}/4 fields`, hint: 'Use the mill buyer to build cash for more land.', page: 'fields' };
      return { title: `Build a surplus · ${moneyProgress(sales, HOMESTEAD_SALES_GOAL)}`, hint: `The village trader cannot absorb a growing farm. Reach $${HOMESTEAD_SALES_GOAL.toLocaleString()} in sales to open the first market day.`, page: 'markets' };
    }
    if (s.stageId === 'market-town') {
      if (s.eraReady) return { title: 'Your farm is ready for its next chapter', hint: 'Move into Farm Business when you want to hire your first crew.', page: 'overview' };
      const md = nextMarketDay(s), mdHint = md.running ? '' : ` · Market day: ${GOODS[md.good].name.toLowerCase()} ${md.inDays === 0 ? 'today' : md.inDays === 1 ? 'tomorrow' : `in ${md.inDays} days`}`;
      if (md.running) return { title: `Market day: sell ${GOODS[md.good].name.toLowerCase()} now`, hint: 'Buyers are in town until evening. Their demand lifts the price; big sales still push it down.', page: 'markets' };
      if (!s.buildings.some((b) => b.region === 'heartland' && b.type === 'barn')) return { title: 'Build a barn: hold stock for market day', hint: `More storage lets you wait for good prices instead of selling at harvest${mdHint}.`, page: 'storage' };
      if (s.fields.length < 10) return { title: `Grow to 10 fields · ${s.fields.length}/10`, hint: `More plots, more harvests running at once${mdHint}.`, page: 'fields' };
      return { title: `Earn on the open market · ${moneyProgress(sales, CHAPTER_SALES['market-town'])}`, hint: `Sell when prices are good; 12 fields also opens the next chapter${mdHint}.`, page: 'markets' };
    }
    if (s.stageId === 'farm-business') {
      const hands = s.workers.filter((w) => w.role === 'hand').length;
      if (s.eraReady) return { title: 'Machines can take the strain', hint: 'Industry brings tractors, factories and research. Move on when ready.', page: 'overview' };
      if (hands < 2) return { title: hands ? 'Hire a second farm hand' : 'Hire your first farm hand', hint: 'Crop plans let hands plant and harvest while you focus elsewhere. Wages are a running cost.', page: 'workers' };
      if (!s.fields.some((f) => f.plan)) return { title: 'Give your fields a crop plan', hint: 'Hands only plant and harvest fields that have a plan.', page: 'fields' };
      if (!s.herds.some((h) => h.count > 0) && !s.fields.some((f) => f.crop && CROPS[f.crop].perennial) && sales < 350_000) return { title: 'Start a flock: build a coop and buy hens', hint: `Eggs sell every day, between harvests. ${moneyProgress(sales, CHAPTER_SALES['farm-business'])}.`, page: 'livestock' };
      if (s.unlockedCrops.includes('apples') && !s.fields.some((f) => f.crop && CROPS[f.crop].perennial) && sales < 400_000) return { title: 'Plant an orchard or vineyard', hint: `Slow to mature, then fruit every season. ${moneyProgress(sales, CHAPTER_SALES['farm-business'])}.`, page: 'fields' };
      return { title: `Build the farm business · ${moneyProgress(sales, CHAPTER_SALES['farm-business'])}`, hint: `Two hands and $${CHAPTER_SALES['farm-business'].toLocaleString()} in sales open Industry. A-grade crops sell for more.`, page: 'workers' };
    }
    if (s.stageId === 'industry') {
      if (atFrontier(s)) return { title: 'Your next horizon', hint: 'Keep growing or earn stewardship marks. Settlement is the next chapter being built.', page: 'overview' };
      if (s.eraReady) return { title: 'Your workers want their families nearby', hint: 'Settlement is the next chapter. Your farm and factories keep running.', page: 'overview' };
      const ip = moneyProgress(sales, CHAPTER_SALES.industry);
      if (!s.machines.some((m) => m.type !== 'truck')) return { title: 'Buy or lease your first tractor', hint: `One tractor does the work of several hands. ${ip}.`, page: 'equipment' };
      const fs = moneyProgress(s.stats.factoryMade ?? 0, INDUSTRY_FACTORY_SALES);
      if (!s.buildings.some((b) => BUILDINGS[b.type].category === 'processing' && b.type !== 'oilWell')) return { title: 'Build your first mill', hint: `A flour mill turns wheat into flour worth about twice as much. Industry asks for two working production houses and ${fs} of factory goods made.`, page: 'production' };
      if (!s.buildings.some((b) => b.type === 'lab') && sales < 1_200_000) return { title: 'Build a research station', hint: `Research cuts costs and opens new crops and machines. ${ip}.`, page: 'production' };
      if (!s.research.active && !s.research.done.length && sales < 1_600_000) return { title: 'Start your first research project', hint: `Pick something that fixes today’s biggest cost. ${ip}.`, page: 'research' };
      if (!s.futures.length && !s.contracts.some((c) => c.accepted) && sales < 2_000_000) return { title: 'Lock in a price', hint: `A supply contract or a futures hedge protects you from price swings. ${ip}.`, page: 'markets' };
      if (workingFactories(s) < 2) return { title: 'Get two production houses working', hint: `A bakery after your mill turns flour into bread worth twice as much again. ${workingFactories(s)}/2 working · factory goods made ${fs}.`, page: 'production' };
      if ((s.stats.factoryMade ?? 0) < INDUSTRY_FACTORY_SALES) return { title: `Make factory goods · ${fs}`, hint: `Upgrades double a line's output. ${ip}.`, page: 'production' };
      return { title: `Grow into industry · ${ip}`, hint: 'Build a reliable farm-to-factory chain before moving on.', page: 'production' };
    }
    if (s.eraReady) return { title: `Next chapter: ${STAGES[NEXT_STAGE[s.stageId]!]?.title ?? 'Frontier'}`, hint: 'You choose when to move on. Your farm keeps operating.', page: 'overview' };
  }
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

const moneyProgress = (now: number, target: number) => `${Math.min(Math.floor(now), target).toLocaleString()} / ${target.toLocaleString()} sales`;
const pctTxt = (x: number) => `${Math.round(x * 100)}%`;
/** Settlement, Town and City: always name the first real blocker, then the chapter's own goals, then growth. */
export function civicObjective(s: GameState): { title: string; hint: string; page?: string } {
  const c = communityOf(s), t = townOf(s), pop = population(s), city = s.stageId === 'city', town = s.stageId === 'town';
  const gate = (chapterGate(s) ?? []).filter((r) => !r.done).map((r) => `${r.label} ${r.fmt === 'pct' ? pctTxt(r.now) : Math.floor(r.now).toLocaleString()}/${r.fmt === 'pct' ? pctTxt(r.target) : r.target.toLocaleString()}`).join(' · ');
  const hint = (x: string) => gate ? `${x} Next chapter: ${gate}.` : x;
  if (!homeCapacity(s)) return { title: 'Build the first cottage', hint: 'A home makes room for a worker’s family.', page: 'community' };
  if (city && cityOf(s).case) return { title: 'Choose a response to theft', hint: hint('Rehabilitation builds prevention; punishment acts now but costs happiness.'), page: 'city' };
  if (town && !t.services.length) return { title: 'Build the first school', hint: hint('Place it near the homes: it only serves families within its reach.'), page: 'town' };
  const upkeep = plannedServiceCost(s);
  if (city && upkeep > 0 && t.cash < upkeep * 7) {
    const days = Math.floor(t.cash / upkeep);
    return { title: `The treasury is running low · ${days} day${days === 1 ? '' : 's'} left`, hint: hint(`Services close when it runs dry. Taxes cover ${pctTxt(Math.min(1, t.lastTax / upkeep))} of upkeep; fund the rest from the farm.`), page: 'town' };
  }
  if (city && t.services.some((b) => b.active && !b.funded && t.cash >= serviceDailyCost(s, b.type) * b.count)) return { title: 'Services need resident staff', hint: hint('Public jobs are filled by your own families. Build homes so more adults move in.'), page: 'community' };
  if (c.fed < .9) return { title: `Families are going hungry · fed ${pctTxt(c.fed)}`, hint: hint('Keep food in storage and turn on the larder policy.'), page: 'community' };
  if (c.happiness < (s.stageId === 'settlement' ? .6 : .65)) {
    const w = wellbeing(s), weakest = (Object.entries({ food: w.fed, homes: w.housed, warmth: w.warm, jobs: w.jobs }) as [string, number][]).sort((a, b) => a[1] - b[1])[0][0];
    return { title: `Families have stopped coming · happiness ${pctTxt(c.happiness)}/65%`, hint: hint(`Weakest: ${weakest}. Happy towns grow; unhappy ones stall.`), page: 'community' };
  }
  if (s.stageId !== 'settlement' && homeCapacity(s) - pop < 4) return { title: pop >= 200 && !c.homes.some((h) => h.tier === 'apartment') ? 'Open the Heights: build apartments' : 'Families are waiting for homes', hint: hint('New families arrive only when there is room for them.'), page: 'community' };
  if (s.stageId === 'settlement') {
    const waiting = s.workers.filter((w) => w.region === 'heartland' && (c.families ?? {})[w.id] === undefined).length;
    if (!Object.values(worldOf(s, 'heartland').zones).includes('res')) return { title: 'Zone land for homes', hint: hint('Tap 🏘 on the map and mark some of your cleared land residential. Homes go there; fields can’t.'), page: 'farm' };
    if (waiting > 0 && homeFamilies(s) <= familiesHere(s)) return { title: `${waiting} famil${waiting === 1 ? 'y is' : 'ies are'} waiting for a home`, hint: hint('One family per cottage, three per terrace. Build them in your residential zone.'), page: 'community' };
    if (familiesHere(s) < 6) return { title: `Settle 6 families · ${familiesHere(s)}/6`, hint: hint('Each worker you hire brings a family once there is a home for them.'), page: 'workers' };
  }
  if (town && t.education < .6) return { title: `A school place for every child · ${pctTxt(t.education)}/60%`, hint: hint('Place schools near the homes: each one only teaches the children within its reach.'), page: 'town' };
  if (town && t.health < .7) return { title: `Keep families healthy · ${pctTxt(t.health)}/70%`, hint: hint('Clean water, a clinic within reach and full larders keep families well.'), page: 'town' };
  if (city && cityOf(s).sanitation < .7) return { title: `City sanitation · ${pctTxt(cityOf(s).sanitation)}/70%`, hint: hint('Sanitation works in each district protect health.'), page: 'city' };
  if (city && cityOf(s).crime > .2) return { title: `Bring crime under 20% · now ${pctTxt(cityOf(s).crime)}`, hint: hint('Street lighting, jobs and schools lower crime; a watchhouse adds policing.'), page: 'city' };
  const target = s.stageId === 'settlement' ? 80 : town ? 400 : 1200;
  const perDay = dailyArrivals(s) * 4, days = Math.ceil(Math.max(0, target - pop) / Math.max(1, perDay));
  const next = city && pop >= 600 && Object.values(cityOf(s).districts).every((d) => d.rezonedAt < 0) ? ' Try zoning a district.' : '';
  return { title: `Grow to ${target.toLocaleString()} residents · ${pop.toLocaleString()}/${target.toLocaleString()}`, hint: hint(`About ${days} day${days === 1 ? '' : 's'} at today’s pace if homes keep up.${next}`), page: 'community' };
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
  {id:'nation',label:'Nation',purpose:'Your army, league or embassy.',unlocked:s=>nationActive(s)||canStartNation(s)},
  {id:'region',label:'Region',purpose:'Neighbours, caravans, diplomacy and defence.',unlocked:s=>regionActive(s)||canStartRegion(s)},
  {id:'city',label:'City watch',purpose:'District utilities, everyday safety and justice.',unlocked:s=>cityActive(s)||canStartCity(s)},
  { id: 'town', label: 'Town hall', purpose: 'Schools, healthcare and a separate public budget.', unlocked: s => townOf(s).active || canStartTown(s) },
  { id: 'community', label: 'Community', purpose: 'Homes, families, food and life in your settlement.', unlocked: s => communityOf(s).active || canStartSettlement(s) },
  { id: 'overview', label: 'Overview', purpose: 'Your business at a glance.', unlocked: (s) => s.era >= 2 },
  { id: 'fields', label: 'Fields', purpose: 'Plant, harvest, plan crops and look after your soil.', unlocked: () => true },
  { id: 'livestock', label: 'Livestock', purpose: 'Chickens, pigs, sheep and cows: housing, feed and health.', unlocked: (s) => s.discovered.includes('chickens') },
  { id: 'markets', label: 'Markets', purpose: 'Prices, selling, buying inputs — later futures and contracts.', unlocked: (s) => s.stats.harvests > 0 },
  { id: 'workers', label: 'Workers', purpose: 'Hire hands and managers, set pay, train skills.', unlocked: (s) => stageAtLeast(s, 'farm-business') },
  { id: 'storage', label: 'Storage', purpose: 'Capacity and spoilage in each region.', unlocked: (s) => stageAtLeast(s, 'farm-business') },
  { id: 'finance', label: 'Finance', purpose: 'Books, loans, insurance and statements.', unlocked: (s) => s.legacyProgression ? s.era >= 2 : stageAtLeast(s, 'farm-business') },
  { id: 'equipment', label: 'Equipment', purpose: 'Machines: buy, lease, service and repair.', unlocked: (s) => s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'industry') },
  { id: 'automation', label: 'Automation', purpose: 'Policies for managers, then if/then rules.', unlocked: (s) => s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'farm-business') },
  { id: 'production', label: 'Production', purpose: 'Factories, energy and the production chain.', unlocked: (s) => s.legacyProgression ? s.era >= 4 : stageAtLeast(s, 'industry') },
  { id: 'research', label: 'Research', purpose: 'Invest in technology that changes how you farm.', unlocked: (s) => s.legacyProgression ? s.era >= 4 : stageAtLeast(s, 'industry') },
  { id: 'logistics', label: 'Logistics', purpose: 'Trucks, haulage and shipping between regions.', unlocked: (s) => s.legacyProgression ? s.era >= 4 : stageAtLeast(s, 'industry') },
  { id: 'analytics', label: 'Analytics', purpose: 'Profitability, break-even and the scenario planner.', unlocked: (s) => s.legacyProgression ? s.era >= 5 : stageAtLeast(s, 'industry') },
  { id: 'competitors', label: 'Competitors', purpose: 'Rival companies, market reports and acquisitions.', unlocked: (s) => s.legacyProgression ? s.era >= 5 : stageAtLeast(s, 'industry') },
  { id: 'world', label: 'World', purpose: 'Regions, climate, events and expansion.', unlocked: (s) => (s.legacyProgression ? s.era >= 5 : stageAtLeast(s, 'region')) || s.events.length > 0 },
  { id: 'corporation', label: 'Corporation', purpose: 'Divisions, executives, shares and dividends.', unlocked: (s) => s.legacyProgression ? s.era >= 7 : stageAtLeast(s, 'city') },
  { id: 'policy', label: 'Policy', purpose: 'Regulation, reputation and long-term milestones.', unlocked: (s) => s.legacyProgression ? s.era >= 7 : stageAtLeast(s, 'city') },
];

