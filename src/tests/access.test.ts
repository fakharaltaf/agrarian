import { expect, it } from 'vitest';
import { createGame } from '../simulation/engine';
import { tileId, worldOf } from '../simulation/world';
import { roadWidth, reachTime, trafficOf, travelFrom } from '../simulation/access';

it('Travel along roads: paved is quicker than dirt, a wide road quicker still, traffic slows it and a parking complex eases it; no road, no reach', () => {
  const s = createGame(1020), w = worldOf(s, 'heartland');
  const y = 40, row = (g: number, yy = y) => { for (let x = 0; x <= 20; x++) w.roads[tileId(x, yy)] = g; };
  row(1); const dirt = reachTime(travelFrom(w, [tileId(0, y)], 99), [tileId(20, y)]);
  row(3); const paved = reachTime(travelFrom(w, [tileId(0, y)], 99), [tileId(20, y)]);
  row(3, y + 1); row(3, y + 2); const wide = reachTime(travelFrom(w, [tileId(0, y)], 99), [tileId(20, y)]);
  expect(paved).toBeLessThan(dirt); expect(roadWidth(w, tileId(10, y))).toBe(3); expect(wide).toBeLessThan(paved);
  expect(reachTime(travelFrom(w, [tileId(0, y)], 99), [tileId(30, y + 20)])).toBe(Infinity); // not joined by road
  const town = [{ door: [tileId(10, y)], trips: 800 }], jam = trafficOf(w, town, []);
  expect(Object.keys(jam).length).toBeGreaterThan(0);
  expect(reachTime(travelFrom(w, [tileId(0, y)], 99, jam), [tileId(20, y)])).toBeGreaterThan(wide);
  const eased = trafficOf(w, town, [{ door: [tileId(10, y)], reach: 8, share: 0.65 }]);
  expect(Object.values(eased).reduce((a, b) => a + b, 0)).toBeLessThan(Object.values(jam).reduce((a, b) => a + b, 0));
});
