// The bridge between the pure simulation and React. The GameState object is mutated in place by
// the engine; subscribers re-render on a version counter at most ~5 times a second.
import { useSyncExternalStore } from 'react';
import { CONFIG, CROPS, CROP_IDS, GOOD_IDS, REGION_IDS } from '../simulation/config';
import { advance, createGame, dispatch as engineDispatch } from '../simulation/engine';
import { createMarkets } from '../simulation/markets';
import type { Action, GameState } from '../simulation/types';
import { sfx, type Sfx } from '../app/audio';

export const SPEEDS = [0, 1, 2, 5, 10, 50] as const;
export type Speed = (typeof SPEEDS)[number];
export const SAVE_VERSION = 2;
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type Slot = (typeof SLOTS)[number];

export interface Toast { id: number; text: string; kind: 'error' | 'ok' }
interface Store {
  game: GameState;
  v: number;
  speed: Speed;
  toasts: Toast[];
  away: { summary: string[]; earned: number } | null;
  catchUp: { done: number; total: number } | null;
  page: string;
  ready: boolean;
}

let store: Store = { game: createGame(), v: 0, speed: 1, toasts: [], away: null, catchUp: null, page: 'farm', ready: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch };
  emit();
};
const bump = () => set({ v: store.v + 1 });

export const getGame = () => store.game;

// ---------------------------------------------------------------- persistence (IndexedDB, localStorage fallback)

const DB = 'agrarian';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(key: string, value: string) {
  try {
    const db = await idb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    localStorage.setItem(`${DB}.${key}`, value);
  }
}
async function get(key: string): Promise<string | null> {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const r = db.transaction('saves').objectStore('saves').get(key);
      r.onsuccess = () => res((r.result as string) ?? localStorage.getItem(`${DB}.${key}`));
      r.onerror = () => rej(r.error);
    });
  } catch {
    return localStorage.getItem(`${DB}.${key}`);
  }
}
async function del(key: string) {
  try {
    const db = await idb();
    db.transaction('saves', 'readwrite').objectStore('saves').delete(key);
  } catch {
    localStorage.removeItem(`${DB}.${key}`);
  }
}

interface SaveFile { version: number; savedAt: number; paused?: boolean; game: GameState }

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
function migrate(g: Omit<GameState, 'version'> & { version: number }): GameState {
  if (g.version === 1) throw new Error('This save is from the early prototype and cannot be upgraded. Please start a new game.');
  if (g.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${g.version}.`);
  g.warned ??= {};
  g.bench ??= {};
  g.discovered ??= [];
  g.achievements ??= [];
  g.rewarded ??= [];
  g.advisor ??= false;
  g.daily ??= null;
  g.stats.plantings ??= 0;
  g.eraReady ??= false;
  g.herds ??= [];
  g.automation.policies.autoFeed ??= true;
  g.automation.policies.supplyFactories ??= false;
  for (const f of g.fields) (f.supplies ??= null), (f.planLocked ??= false), (f.greenhouse ??= false), (f.frost ??= 0), (f.cycleAt ??= 0);
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
  for (const m of g.machines) (m.util ??= 0), (m.task ??= 0);
  for (const w of g.workers) w.task ??= 0;
  for (const rule of g.automation.rules) if (typeof rule.lastRun !== 'number') rule.lastRun = -1e9;
  for (const r of REGION_IDS) g.regions[r].insuredFrom ??= 0;
  g.seenTips ??= [];
  for (const r of REGION_IDS) for (const k in g.markets[r]) g.markets[r][k as keyof typeof g.markets.heartland]!.impact ??= 0;
  return g as GameState;
}

const serialize = () => JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), paused: store.speed === 0, game: store.game } satisfies SaveFile);

export async function saveTo(slot: Slot, silent = false) {
  try {
    await put(slot, serialize());
    if (!silent) toast(slot === 'auto' ? 'Saved.' : `Saved to ${slotLabel(slot)}.`, 'ok');
  } catch {
    toast('Could not save: browser storage is unavailable.');
  }
}
export const slotLabel = (s: Slot) => (s === 'auto' ? 'Autosave' : `Slot ${s.slice(-1)}`);

export async function slotInfo(): Promise<Record<Slot, { savedAt: number; day: number; cash: number; era: number } | null>> {
  const out = {} as Record<Slot, { savedAt: number; day: number; cash: number; era: number } | null>;
  for (const s of SLOTS) {
    const t = await get(s);
    if (!t) { out[s] = null; continue; }
    try {
      const f = parseSave(t);
      out[s] = { savedAt: f.savedAt, day: Math.floor(f.game.tick / 24) + 1, cash: f.game.cash, era: f.game.era };
    } catch {
      out[s] = null;
    }
  }
  return out;
}

export async function loadFrom(slot: Slot) {
  const t = await get(slot);
  if (!t) return toast('That slot is empty.');
  try {
    const f = parseSave(t);
    startFrom(f.game, f.savedAt, f.paused);
    toast(`Loaded ${slotLabel(slot)}.`, 'ok');
  } catch (e) {
    toast((e as Error).message);
  }
}
export const deleteSlot = (slot: Slot) => del(slot);

export function exportSave() {
  const url = URL.createObjectURL(new Blob([serialize()], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `agrarian-year${Math.floor(store.game.tick / 2880) + 1}-day${(Math.floor(store.game.tick / 24) % 120) + 1}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importSave(file: File) {
  if (file.size > 50 * 1024 * 1024) return toast('That file is too large to be a save.');
  try {
    const f = parseSave(await file.text());
    startFrom(f.game, Date.now());
    saveTo('auto', true);
    toast('Save imported.', 'ok');
  } catch (e) {
    toast(`Import failed: ${(e as Error).message}`);
  }
}

export function newGame() {
  store.game = createGame();
  set({ speed: 1, away: null, page: 'farm', v: store.v + 1 });
  saveTo('auto', true);
}

/** Loads a game and simulates the real time since it was saved, in chunks so the page stays responsive. */
/** Off when the player left the game paused, or turned "keep farming while away" off in Settings. */
export const offlineOn = () => { try { return localStorage.getItem('agrarian.ui.offline') !== 'false'; } catch { return true; } };

function startFrom(game: GameState, savedAt: number, paused = false) {
  store.game = game;
  set({ v: store.v + 1, page: 'farm', ...(paused ? { speed: 0 as Speed } : {}) });
  const elapsed = Math.floor((Date.now() - savedAt) / 1000);
  const total = Math.min(elapsed, CONFIG.offlineCapTicks);
  if (total < 60 || game.bankrupt || paused || !offlineOn()) return;
  const before = { cash: game.cash, harvests: game.stats.harvests, sales: (game.lifetime.sale ?? 0) + (game.lifetime.contract ?? 0), wages: game.lifetime.wages ?? 0, spoiled: game.stats.spoiled, log: game.log.length ? game.log[game.log.length - 1].id : 0 };
  let done = 0;
  set({ catchUp: { done, total } });
  const chunk = () => {
    const n = Math.min(400, total - done);
    // safety: the moment cash runs out, stop and pause so the player can fix it instead of coming back bankrupt
    const floor = Math.min(0, before.cash);
    let i = 0;
    for (; i < n && game.cash >= floor; i++) advance(game, 1);
    done += i;
    const broke = game.cash < floor;
    if (done < total && !game.bankrupt && !broke) {
      set({ catchUp: { done, total } });
      setTimeout(chunk, 0);
      return;
    }
    const days = (done / 24).toFixed(1);
    const sales = (game.lifetime.sale ?? 0) + (game.lifetime.contract ?? 0) - before.sales;
    const summary = [
      `${days} in-game days passed${elapsed > total && !broke ? ' (offline time is capped at 6 hours)' : ''}.`,
      `Cash ${game.cash >= before.cash ? 'rose' : 'fell'} by $${Math.abs(Math.round(game.cash - before.cash)).toLocaleString()}.`,
      `${game.stats.harvests - before.harvests} harvests · $${Math.round(sales).toLocaleString()} in sales · $${Math.round(-(game.lifetime.wages ?? 0) + before.wages).toLocaleString()} in wages.`,
    ];
    const spoiled = game.stats.spoiled - before.spoiled;
    if (spoiled > 1) summary.push(`About $${Math.round(spoiled).toLocaleString()} of stock spoiled in storage.`);
    const important = game.log.filter((l) => l.id > before.log && (l.level === 'critical' || l.level === 'warning')).slice(-4).map((l) => l.text);
    summary.push(...important);
    if (game.bankrupt) summary.push('Your business became insolvent while you were away.');
    else if (broke) (summary.push('Your cash ran out, so the farm was paused the moment it happened. Fix the problem, then press play.'), set({ speed: 0 }));
    set({ catchUp: null, away: { summary, earned: Math.round(game.cash - before.cash) }, v: store.v + 1 });
  };
  setTimeout(chunk, 0);
}

export async function boot() {
  const t = await get('auto');
  if (t) {
    try {
      const f = parseSave(t);
      startFrom(f.game, f.savedAt, f.paused);
    } catch (e) {
      toast(`Your autosave could not be loaded (${(e as Error).message}). A new game was started.`);
    }
  }
  set({ ready: true });
}

// ---------------------------------------------------------------- actions & UI state

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'error') {
  const t = { id: ++toastId, text, kind };
  set({ toasts: [...store.toasts.slice(-2), t] });
  setTimeout(() => set({ toasts: store.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 4500 : 2500);
}

const SOUND: Partial<Record<Action['type'], Sfx>> = {
  plant: 'plant', fertilize: 'plant', harvest: 'harvest', sell: 'coin', sellAnimals: 'coin', deliverContract: 'coin',
  buy: 'buy', buyPlot: 'buy', buyParcel: 'buy', buyMachine: 'buy', build: 'buy', hire: 'buy', buyAnimals: 'buy', upgradeBuilding: 'buy',
  upgradeMachine: 'buy', greenhouse: 'buy', irrigate: 'buy', research: 'buy', advanceEra: 'celebrate', claimDaily: 'celebrate', choosePerk: 'pop', setPlan: 'click',
};

export function act(a: Action, success?: string) {
  const r = engineDispatch(store.game, a);
  if (a.type !== 'seeTip' && a.type !== 'startDay') sfx(r.ok ? SOUND[a.type] ?? 'click' : 'error');
  if (!r.ok) toast(r.error);
  else if (r.note || success) toast(r.note ?? success!, 'ok');
  bump();
  return r.ok;
}

export const setSpeed = (speed: Speed) => set({ speed });
export const dismissAway = () => set({ away: null });
export const go = (page: string) => set({ page });
export const usePageState = () => useStore((x) => x.page);

// ---------------------------------------------------------------- loop

let carry = 0;
let last = performance.now();
let lastEmit = 0;
function loop() {
  const now = performance.now();
  if (store.ready && !store.catchUp && !store.game.bankrupt) {
    carry += ((now - last) / 1000) * store.speed;
    // a backgrounded tab can sleep for minutes; cap the burst and let offline catch-up handle long gaps
    const ticks = Math.min(Math.floor(carry), 120);
    if (ticks > 0) {
      carry -= ticks;
      if (carry > 5) carry = 0;
      advance(store.game, ticks);
    }
  }
  last = now;
  if (now - lastEmit > 200) {
    lastEmit = now;
    bump();
  }
}
setInterval(loop, 50);
setInterval(() => store.ready && !store.catchUp && saveTo('auto', true), 15000);
addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && store.ready && saveTo('auto', true));
addEventListener('pagehide', () => store.ready && saveTo('auto', true));

// ---------------------------------------------------------------- React binding

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders when the store changes. Selectors must return primitives or stable references. */
export function useStore<T>(select: (s: Store) => T): T {
  return useSyncExternalStore(subscribe, () => select(store));
}
/** The live game; re-renders on each UI frame. */
export function useGame(): GameState {
  useStore((s) => s.v);
  return store.game;
}
