// Pure save validation and migration, shared by the browser and regression tools.
import { CROPS, CROP_IDS, GOOD_IDS, REGION_IDS } from './config';
import { createMarkets } from './markets';
import { stageIdForEra, STAGES, STAGE_IDS } from './stages';
import type { GameState } from './types';
export const SAVE_VERSION = 6;
export interface SaveFile { version: number; savedAt: number; paused?: boolean; game: GameState }

/** Trust boundary: stored or imported JSON may be stale, hand-edited or corrupt. */
export function parseSave(text: string): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a valid save.');
  }
  const f = raw as Partial<SaveFile> & { game?: { version?: number } };
  if (!f || typeof f !== 'object' || !f.game) throw new Error('That file is not an Agrarian save.');
  const g = migrate(f.game as unknown as Omit<GameState, 'version'> & { version: number });
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  if (![g.tick, g.cash, g.rng, g.seed, g.era].every(finite)) throw new Error('Save file is corrupt.');
  if (!Array.isArray(g.fields) || !g.fields.length || !g.regions || !g.markets) throw new Error('Save file is incomplete.');
  for (const r of REGION_IDS) {
    if (!g.regions[r]) throw new Error('Save file is missing a region.');
    for (const gd of GOOD_IDS) if (!finite(g.regions[r].inventory[gd]) || g.regions[r].inventory[gd] < -1e-6) throw new Error('Save file inventory is corrupt.');
  }
  for (const c of CROP_IDS) if (!finite(g.seeds[c]) || g.seeds[c] < 0) throw new Error('Save file seed stock is corrupt.');
  return { version: SAVE_VERSION, savedAt: finite(f.savedAt) ? f.savedAt! : Date.now(), paused: f.paused === true, game: g };
}

/** Upgrades older saves in place. Version 1 (the prototype) predates the full economy. */
export function migrate(g: Omit<GameState, 'version'> & { version: number }): GameState {
  if (g.version === 1) throw new Error('This save is from the early prototype and cannot be upgraded. Please start a new game.');
  if (g.version !== 2 && g.version !== 3 && g.version !== 4 && g.version !== 5 && g.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${g.version}.`);
  g.warned ??= {};
  g.bench ??= {};
  g.discovered ??= [];
  g.achievements ??= [];
  g.rewarded ??= [];
  g.advisor ??= false;
  g.daily ??= null;
  g.stats.plantings ??= 0;
  g.eraReady ??= false;
  g.legacyProgression ??= true;
  g.charters ??= { trader: null };
  g.charters.trader ??= null;
  g.values ??= { prosperityFairness: 50, orderFreedom: 50, peaceStrength: 50, traditionProgress: 50 };
  g.values.prosperityFairness ??= 50;
  g.values.orderFreedom ??= 50;
  g.values.peaceStrength ??= 50;
  g.values.traditionProgress ??= 50;
  if (!STAGE_IDS.includes(g.stageId)) g.stageId = stageIdForEra(g.era);
  if (!g.stageState || typeof g.stageState !== 'object' || Array.isArray(g.stageState)) g.stageState = {};
  if (!g.stageState[g.stageId] || typeof g.stageState[g.stageId] !== 'object' || Array.isArray(g.stageState[g.stageId])) {
    g.stageState[g.stageId] = STAGES[g.stageId].createState();
  }
  for (const [key, value] of Object.entries(STAGES[g.stageId].createState())) {
    if (g.stageState[g.stageId]![key] === undefined) g.stageState[g.stageId]![key] = value;
  }
  g.herds ??= [];
  g.automation.policies.autoFeed ??= true;
  g.automation.policies.autoExport ??= true;
  if (g.research.done.includes('droughtResistant')) g.research.licensed = g.research.licensed.filter((x) => x !== 'droughtLicense');
  g.automation.policies.supplyFactories ??= false;
  for (const f of g.fields) (f.supplies ??= null), (f.spreading ??= null), (f.spreadWork ??= 0), (f.planLocked ??= false), (f.greenhouse ??= false), (f.frost ??= 0), (f.cycleAt ??= 0);
  // one-time repair (Nov 2026): orchards piled up pests from a bug; clear them once, marked in `rewarded` so it never repeats
  if (!g.rewarded.includes('fix:orchardPests')) {
    for (const f of g.fields) if (f.crop && CROPS[f.crop].perennial) (f.pest = 0), (f.streak = 0);
    g.rewarded.push('fix:orchardPests');
  }
  for (const w of g.workers) w.perk ??= null;
  for (const m of g.machines) m.tier ??= 1;
  for (const b of g.buildings) (b.level ??= 1), (b.reserved ??= 0);
  for (const r of REGION_IDS) (g.regions[r].forecast ??= []), (g.regions[r].quality ??= {}), (g.regions[r].frostTonight ??= false);
  // goods and crops added after the save was made start empty, with fresh markets
  const fresh = createMarkets();
  for (const r of REGION_IDS) {
    for (const gd of GOOD_IDS) g.regions[r].inventory[gd] ??= 0;
    for (const gd in fresh[r]) g.markets[r][gd as keyof typeof fresh.heartland] ??= fresh[r][gd as keyof typeof fresh.heartland];
  }
  for (const c of CROP_IDS) g.seeds[c] ??= 0;
  for (const m of g.machines) (m.util ??= 0), (m.task ??= 0), (m.driver ??= null);
  for (const w of g.workers) w.task ??= 0;
  for (const rule of g.automation.rules) if (typeof rule.lastRun !== 'number') rule.lastRun = -1e9;
  for (const r of REGION_IDS) g.regions[r].insuredFrom ??= 0;
  g.seenTips ??= [];
  for (const r of REGION_IDS) for (const k in g.markets[r]) g.markets[r][k as keyof typeof g.markets.heartland]!.impact ??= 0;
  for (const shipment of g.shipments) shipment.batchDay ??= -1;
  g.version = SAVE_VERSION;
  return g as GameState;
}

