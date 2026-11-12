// The bridge between the pure simulation and React. The GameState object is mutated in place by
// the engine; subscribers re-render on a version counter at most ~5 times a second.
import { useSyncExternalStore } from 'react';
import { CONFIG } from '../simulation/config';
import { advance, createGame, dispatch as engineDispatch } from '../simulation/engine';
import { BUILDINGS, type RegionId } from '../simulation/config';
import { FOOTPRINT, SERVICE_FOOTPRINT, findSpot, homesCentre, homeFootprint, plotSide, worldOf, chunkAt, roadRoute, rotOf } from '../simulation/world';
import { SERVICE_DEFS } from '../simulation/town-state';
import { parseSave, SAVE_VERSION, type SaveFile } from '../simulation/persistence';
export { parseSave, SAVE_VERSION } from '../simulation/persistence';
import type { Action, GameState } from '../simulation/types';
import { sfx, type Sfx } from '../app/audio';

export const SPEEDS = [0, 1, 2, 5, 10, 50] as const;
export type Speed = (typeof SPEEDS)[number];
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
  /** Placing something new or moving something: a ghost footprint the player positions on the map. */
  placing: Placement | null;
  roading: Roading | null;
  prospect: { region: RegionId; hover?: [number, number] } | null;
  zoning: Zoning | null;
}
/** Road mode: draw from the last tapped tile, or upgrade/remove the stretch tapped. */
export type Roading = { tool: 'draw' | 'upgrade' | 'remove'; region: RegionId; from?: [number, number]; hover?: [number, number] };
/** Zone mode: tap patches of your land to make them residential, industrial or farmland again. */
export type Zoning = { region: RegionId; zone: 'res' | 'ind' | 'farm'; hover?: [number, number] };
/** What a placement is, for zoning checks in the preview. */
export const placementUse = (p: Pick<Placement, 'action' | 'key' | 'kind'>) => p.kind === 'move' ? undefined : p.action.type === 'buildHomes' ? 'home' as const : p.action.type === 'buyPlot' || p.action.type === 'buyParcel' ? 'field' as const : p.action.type === 'build' ? 'building' as const : undefined;
export type Placement = { kind: 'new' | 'move'; action: Action; region: RegionId; w: number; d: number; label: string; key?: string; at: [number, number]; /** quarter turns; w and d are already turned */ rot?: number; /** placing one of several: how many are left, of how many */ left?: number; total?: number };

let store: Store = { game: createGame(), v: 0, speed: 1, toasts: [], away: null, catchUp: null, page: 'farm', ready: false, placing: null, roading: null, prospect: null, zoning: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch };
  emit();
};
const bump = () => set({ v: store.v + 1 });

export const getGame = () => store.game;
export const getSpeed = () => store.speed;
export const getPage = () => store.page;

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
      await del('auto');
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
  startCity:'celebrate',changePolice:'buy',setZone:'buy',trainPolice:'buy',resolveCityCase:'pop',
  startTown: 'celebrate', buildService: 'buy', fundTown: 'coin', answerPetition: 'pop',
  plant: 'plant', fertilize: 'plant', harvest: 'harvest', sell: 'coin', sellAnimals: 'coin', deliverContract: 'coin',
  buy: 'buy', buyPlot: 'buy', buyParcel: 'buy', buyMachine: 'buy', build: 'buy', hire: 'buy', buyAnimals: 'buy', upgradeBuilding: 'buy',
  upgradeMachine: 'buy', greenhouse: 'buy', irrigate: 'buy', research: 'buy', advanceEra: 'celebrate', claimDaily: 'celebrate', choosePerk: 'pop', setPlan: 'click',
};

/** Footprint of whatever this action would put on the map, when the player should choose the spot. */
function placementFor(a: Action): { region: RegionId; w: number; d: number; label: string } | null {
  if ('at' in a && a.at) return null;
  if (a.type === 'buyPlot') return { region: 'heartland', w: plotSide(1), d: plotSide(1), label: 'New field (1 ha)' };
  if (a.type === 'buyParcel') return { region: a.region, w: plotSide(a.ha), d: plotSide(a.ha), label: `New field (${a.ha} ha)` };
  if (a.type === 'build') { const [w, d] = FOOTPRINT[a.building]; return { region: a.region, w, d, label: BUILDINGS[a.building].name }; }
  if (a.type === 'buildHomes') { const f = homeFootprint({ id: 0, tier: a.tier, count: 1, cost: 0 }); return { region: 'heartland', ...f, label: `${a.tier[0].toUpperCase()}${a.tier.slice(1)} home` }; }
  if (a.type === 'buildService' && a.service !== 'road') return { region: 'heartland', ...SERVICE_FOOTPRINT, label: SERVICE_DEFS[a.service].name };
  return null;
}
export function startPlacement(p: Omit<Placement, 'at'>) {
  const g = store.game, civic = p.action.type === 'buildService' || p.action.type === 'buildHomes', at = findSpot(g, p.region, { w: p.w, d: p.d }, false, placementUse(p), civic ? homesCentre(worldOf(g, p.region)) : null) ?? (worldOf(g, p.region).pos[p.region === 'heartland' ? 'farmhouse' : 'shed'] ?? [1, 1]); // services and homes start among the homes
  set({ placing: { ...p, rot: p.rot ?? (p.kind === 'move' && p.key && !p.key.startsWith('field:') ? rotOf(g, p.key) : 0), at: [at[0], at[1]] }, roading: null, page: 'farm' });
}
export const startRoads = (region: RegionId) => set({ roading: { tool: 'draw', region }, placing: null, prospect: null, page: 'farm' });
/** Oil mode: see the survey, pick a 2×2 spot, drill. */
export const startProspect = (region: RegionId) => set({ prospect: { region }, placing: null, roading: null, page: 'farm' });
export const stopProspect = () => set({ prospect: null });
export const startZoning = (region: RegionId) => set({ zoning: { region, zone: 'res' }, placing: null, roading: null, prospect: null, page: 'farm' });
export const stopZoning = () => set({ zoning: null });
export const setZoneTool = (zone: Zoning['zone']) => store.zoning && set({ zoning: { ...store.zoning, zone } });
export const zoneHover = (at: [number, number] | null) => { const Z = store.zoning; if (Z && at && (Z.hover?.[0] !== at[0] || Z.hover?.[1] !== at[1])) set({ zoning: { ...Z, hover: at } }); };
export const zoneTap = (at: [number, number] | null) => { const Z = store.zoning; if (Z && at) act({ type: 'zoneLand', region: Z.region, chunks: [chunkAt(at[0], at[1])], zone: Z.zone }); };
export const prospectHover = (at: [number, number] | null) => { const P = store.prospect; if (P && at && (P.hover?.[0] !== at[0] || P.hover?.[1] !== at[1])) set({ prospect: { ...P, hover: at } }); };
export const prospectTap = (at: [number, number] | null) => { const P = store.prospect; if (P && at) act({ type: 'drillOil', region: P.region, at: [at[0] - 1, at[1] - 1] }); };
export const setRoadTool = (tool: Roading['tool']) => store.roading && set({ roading: { ...store.roading, tool, from: undefined } });
export const stopRoads = () => set({ roading: null });
export const roadHover = (at: [number, number] | null) => { const R = store.roading; if (R && at && (R.hover?.[0] !== at[0] || R.hover?.[1] !== at[1])) set({ roading: { ...R, hover: at } }); };
export function roadTap(at: [number, number] | null) {
  const R = store.roading;
  if (!R || !at) return;
  if (R.tool === 'draw') {
    if (!R.from) { if (!roadRoute(store.game, R.region, at, at)) { toast('Start a road on your own cleared land or on an existing road.'); return; } return set({ roading: { ...R, from: at } }); }
    if (act({ type: 'buildRoad', region: R.region, from: R.from, to: at })) set({ roading: { ...store.roading!, from: at } }); // keep drawing from here
    return;
  }
  act({ type: R.tool === 'upgrade' ? 'upgradeRoad' : 'removeRoad', region: R.region, at });
}
export const moveGhost = (at: [number, number]) => store.placing && set({ placing: { ...store.placing, at } });
/** Turn what is being placed a quarter turn clockwise (fields are square plots and do not turn). */
export function rotatePlacement() {
  const p = store.placing;
  if (!p || p.key?.startsWith('field:') || p.action.type === 'buyPlot' || p.action.type === 'buyParcel') return false;
  set({ placing: { ...p, rot: ((p.rot ?? 0) + 1) % 4, w: p.d, d: p.w } });
  return true;
}
export const cancelPlacement = () => set({ placing: null });
export function confirmPlacement() {
  const p = store.placing;
  if (!p) return false;
  const a = (p.kind === 'move' ? { type: 'moveObject', region: p.region, key: p.key!, at: p.at, rot: p.rot } : { ...p.action, at: p.at, ...(p.rot ? { rot: p.rot } : {}) }) as Action;
  const r = engineDispatch(store.game, a);
  sfx(r.ok ? 'buy' : 'error');
  if (!r.ok) { toast(r.error); bump(); return false; }
  if (r.note) toast(r.note, 'ok');
  set({ placing: null });
  // several at once are placed one after another, each where the player chooses
  if (p.kind === 'new' && (p.left ?? 1) > 1) startPlacement({ ...p, left: p.left! - 1 });
  bump();
  return true;
}
export function act(a: Action, success?: string) {
  const spot = store.ready ? placementFor(a) : null;
  if (spot) {
    const n = a.type === 'build' ? a.count ?? 1 : a.type === 'buildHomes' ? a.count : 1;
    startPlacement({ kind: 'new', action: n > 1 ? { ...a, count: 1 } as Action : a, ...spot, ...(n > 1 ? { left: n, total: n } : {}) });
    return true;
  }
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
      // One hour at a time so the clock can stop the moment the farm slips into overdraft:
      // at high speed the three-day insolvency clock would otherwise pass in about a second.
      for (let i = 0; i < ticks && !store.game.bankrupt; i++) {
        const over = store.game.overdraftDays;
        advance(store.game, 1);
        if (store.game.overdraftDays > over && store.speed > 1) {
          setSpeed(0);
          toast(`Paused: overdraft over its limit (day ${store.game.overdraftDays}/3). Sell stock, a field or a machine, or take a loan, before day 3.`);
          break;
        }
      }
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
