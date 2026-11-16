import { expect, it } from 'vitest';
import { createGame, step } from '../simulation/engine';
import { post } from '../simulation/core';
import { tileId, worldOf } from '../simulation/world';
import { dispatchEdit, undoEdit, undoable } from '../simulation/undo';

it('Undo takes back a road, a building and a demolition with a full refund, and redo does it again', () => {
  const s = createGame(1010); s.legacyProgression = true; s.era = 4; post(s, 'prize', 1e6, 'fixture');
  const w = worldOf(s, 'heartland'), cash = s.cash;
  const road = dispatchEdit(s, { type: 'buildRoad', region: 'heartland', from: [-10, -6], to: [6, -6] });
  expect(road.edit).not.toBeNull(); expect(w.roads[tileId(0, -6)]).toBeTruthy();
  undoEdit(s, road.edit!); expect(w.roads[tileId(0, -6)]).toBeUndefined(); expect(s.cash).toBeCloseTo(cash, 2);
  const barn = dispatchEdit(s, { type: 'build', region: 'heartland', building: 'barn', at: [-6, -5] });
  const id = s.buildings.at(-1)!.id; expect(s.cash).toBeLessThan(cash);
  step(s); // time passes: undo still works within the day, without touching what the farm did
  undoEdit(s, barn.edit!); expect(s.buildings.some((b) => b.id === id)).toBe(false); expect(w.pos[`b:${id}`]).toBeUndefined();
  const redo = dispatchEdit(s, barn.edit!.action); expect(redo.r.ok).toBe(true);
  const again = s.buildings.at(-1)!, spent = s.cash;
  const gone = dispatchEdit(s, { type: 'demolish', buildingId: again.id });
  undoEdit(s, gone.edit!); expect(s.buildings.some((b) => b.id === again.id)).toBe(true); expect(w.pos[`b:${again.id}`]).toBeTruthy(); expect(s.cash).toBeCloseTo(spent, 2);
  // nothing but map edits are recorded, and an edit expires after a day
  expect(dispatchEdit(s, { type: 'toggleBuilding', buildingId: again.id }).edit).toBeNull();
  for (let i = 0; i < 24; i++) step(s);
  expect(undoable(s, gone.edit!)).toBe(false);
});

it('Upgrade all raises every utility line one step for one price, and undo puts them back', () => {
  const s = createGame(1011); post(s, 'prize', 1e6, 'fixture');
  const w = worldOf(s, 'heartland'); w.nets = { power: { 1: 1, 2: 2 }, sewer: { 3: 1 } };
  const cash = s.cash, { edit } = dispatchEdit(s, { type: 'upgradeAllLines', region: 'heartland', nets: ['power', 'water', 'sewer'] });
  expect(w.nets).toEqual({ power: { 1: 2, 2: 2 }, water: {}, sewer: { 3: 2 } });
  expect(cash - s.cash).toBeCloseTo(Math.round((60 + 25) * s.macro.cpi), 2);
  undoEdit(s, edit!); expect(w.nets.power).toEqual({ 1: 1, 2: 2 }); expect(w.nets.sewer).toEqual({ 3: 1 }); expect(s.cash).toBeCloseTo(cash, 2);
});
