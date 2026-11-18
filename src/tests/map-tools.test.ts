import { expect, it } from 'vitest';
import { createGame, dispatch } from '../simulation/engine';
import { post } from '../simulation/core';
import { chunkAt, chunksIn, hasAccess, ownedSet, worldOf } from '../simulation/world';

function ready() {
  const s = createGame(6061); s.discovered.push('upgrades');
  post(s, 'sharesIssued', 1e7, 'Test capital');
  return s;
}

it('Zoning many patches at once zones the free ones and skips those where the wrong thing stands', () => {
  const s = ready(), w = worldOf(s, 'heartland');
  const owned = [...ownedSet(w)];
  const p = w.pos[`field:${s.fields[0].id}`]!, fieldChunk = chunkAt(p[0], p[1]);
  const free = owned.filter((c) => c !== fieldChunk && !Object.entries(w.pos).some(([, q]) => q && chunksIn(q[0], q[1], 1, 1).includes(c))).slice(0, 3);
  const r = dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: [fieldChunk, ...free], zone: 'res' });
  expect(r.ok).toBe(true);
  for (const c of free) expect(w.zones[c]).toBe('res');
  expect(w.zones[fieldChunk]).toBeUndefined();
  expect(dispatch(s, { type: 'zoneLand', region: 'heartland', chunks: [fieldChunk], zone: 'res' }).ok).toBe(false);
});

it('With auto tracks off, a new building gets no road; turned back on, the next one does', () => {
  const s = ready(); s.legacyProgression = true; s.era = 8;
  const w = worldOf(s, 'heartland');
  expect(dispatch(s, { type: 'setAutoRoads', on: false }).ok).toBe(true);
  const roads = Object.keys(w.roads).length;
  dispatch(s, { type: 'build', region: 'heartland', building: 'barn' });
  const a = s.buildings[s.buildings.length - 1];
  expect(w.links[`b:${a.id}`]).toBeUndefined();
  expect(Object.keys(w.roads).length).toBe(roads); // not one tile laid
  dispatch(s, { type: 'setAutoRoads', on: true });
  expect(s.autoRoads).toBeUndefined();
  dispatch(s, { type: 'build', region: 'heartland', building: 'barn' });
  const b = s.buildings[s.buildings.length - 1];
  expect(hasAccess(s, 'heartland', `b:${b.id}`)).toBe(true);
});

it('A Plant laid out as a 2×2 block counts as square; its long shape is all four in one row', async () => {
  const { isLong, longShape } = await import('../simulation/engine');
  const block = { type: 'solar' as const, size: 4, span: [11, 7] as [number, number] };
  expect(isLong(block)).toBe(false);
  expect(longShape(block)).toEqual([23, 3]); // four 5×3 arrays with a tile between each
  expect(isLong({ ...block, span: [23, 3], longSpan: [23, 3] })).toBe(true);
  expect(isLong({ type: 'solar' as const, size: 2, span: [11, 3] })).toBe(true); // a Works is its pair side by side
});
