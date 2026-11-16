import type { Action, GameState } from './types';
import type { LedgerKind } from './config';
import { post } from './core';
import { dispatch } from './engine';
import { townOf } from './town-state';
import { communityOf } from './community-state';
import { touch } from './world';

/** Map edits the player can take back: what they built, drew, moved, zoned or knocked down. */
export const UNDOABLE = new Set<Action['type']>(['build', 'buildService', 'buildHomes', 'demolish', 'moveObject', 'zoneLand', 'buildRoad', 'removeRoad', 'upgradeRoad', 'buildPipe', 'removePipe', 'upgradePipe', 'upgradeAllLines']);
/** shortcut: edits can be undone for one game day with a full refund, so a mistake costs nothing; older ones drop off so undo can't be used as a free rental. */
export const UNDO_TICKS = 24;

type Rec = Record<string, unknown>;
interface Snap { world: unknown; buildings: Rec; services: Rec; homes: Rec; lifetime: Rec; town: Rec }
export interface Edit { action: Action; tick: number; before: Snap; after: Snap }

const byId = (xs: { id: number }[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
const snap = (s: GameState): Snap => structuredClone({ world: s.world ?? {}, buildings: byId(s.buildings), services: byId(townOf(s).services), homes: byId(communityOf(s).homes), lifetime: s.lifetime as Rec, town: townOf(s).lifetime as Rec });
const plain = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Put back only what the edit changed, leaving whatever the farm did since alone. Arrays and ids are whole values. */
function revert(cur: Rec, before: Rec, after: Rec, deep: boolean) {
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[k], after[k])) continue;
    if (deep && plain(before[k]) && plain(after[k])) revert((cur[k] ??= {}) as Rec, before[k] as Rec, after[k] as Rec, true);
    else if (before[k] === undefined) delete cur[k];
    else cur[k] = structuredClone(before[k]);
  }
}
function restoreList<T extends { id: number }>(list: T[], before: Rec, after: Rec) {
  const map = byId(list) as Rec;
  revert(map, before, after, false);
  const keep = list.filter((x) => map[x.id] !== undefined).map((x) => map[x.id] as T);
  for (const [id, x] of Object.entries(map)) if (!keep.some((k) => k.id === +id)) keep.push(x as T);
  list.splice(0, list.length, ...keep);
}
/** Pay back (or take back) exactly what an edit moved, kind by kind, so the books stay balanced. */
function refund(s: GameState, before: Rec, after: Rec, account: 'company' | 'town') {
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = ((after[k] as number) ?? 0) - ((before[k] as number) ?? 0);
    if (d) post(s, k as LedgerKind, -d, 'Undone', 'heartland', undefined, account);
  }
}

/** Run an action; if it is a map edit that worked, return the record needed to undo it. */
export function dispatchEdit(s: GameState, a: Action) {
  const before = UNDOABLE.has(a.type) ? snap(s) : null, r = dispatch(s, a);
  return { r, edit: r.ok && before ? { action: a, tick: s.tick, before, after: snap(s) } as Edit : null };
}
export const undoable = (s: GameState, e: Edit) => s.tick - e.tick < UNDO_TICKS;
/** Take an edit back: remove what it added, rebuild what it removed, restore the map, refund the money. */
export function undoEdit(s: GameState, e: Edit) {
  restoreList(s.buildings, e.before.buildings, e.after.buildings);
  restoreList(townOf(s).services, e.before.services, e.after.services);
  restoreList(communityOf(s).homes, e.before.homes, e.after.homes);
  revert((s.world ??= {}) as Rec, e.before.world as Rec, e.after.world as Rec, true);
  for (const w of Object.values(s.world)) if (w) touch(w);
  // fields fed by a building that is gone stop pointing at it
  for (const f of s.fields) if (f.supplies != null && !s.buildings.some((b) => b.id === f.supplies)) (f.supplies = null), (f.planLocked = false);
  refund(s, e.before.lifetime, e.after.lifetime, 'company');
  refund(s, e.before.town, e.after.town, 'town');
}
