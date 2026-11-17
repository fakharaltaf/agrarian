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
  const town = [{ door: [tileId(2, y)], trips: 250 }], shop = [{ door: [tileId(18, y)], pull: 4 }], jam = trafficOf(w, town, shop, []).slow;
  expect(Object.keys(jam).length).toBeGreaterThan(0);
  expect(reachTime(travelFrom(w, [tileId(0, y)], 99, jam), [tileId(20, y)])).toBeGreaterThan(wide);
  const eased = trafficOf(w, town, shop, [{ door: [tileId(10, y)], reach: 8, share: 0.65 }]).slow;
  expect(Object.values(eased).reduce((a, b) => a + b, 0)).toBeLessThan(Object.values(jam).reduce((a, b) => a + b, 0));
  // the cars run from the homes to the shop along the road between them, and nowhere else
  const { flow } = trafficOf(w, town, shop, []); expect(flow[tileId(10, y)]).toBeGreaterThan(0); expect(flow[tileId(19, y)] ?? 0).toBe(0);
});

it('A building needs a street to match its size: apartments a two-lane road, a tower a three-lane paved one; too small a street halves a service', async () => {
  const { frontageAt, meets, APARTMENT_NEED, OFFICE_NEED } = await import('../simulation/access');
  const s = createGame(1023), w = worldOf(s, 'heartland');
  for (let x = 0; x <= 10; x++) w.roads[tileId(x, 30)] = 1; // a dirt track
  const f1 = frontageAt(w, 2, 31, 3, 3); expect(f1.lanes).toBe(1); expect(meets(f1, APARTMENT_NEED[0])).toBe(false);
  for (let x = 0; x <= 10; x++) w.roads[tileId(x, 29)] = 1; expect(meets(frontageAt(w, 2, 31, 3, 3), APARTMENT_NEED[0])).toBe(true); // widened to two lanes
  expect(meets(frontageAt(w, 2, 31, 3, 3), APARTMENT_NEED[1])).toBe(false); // the mid-rise wants it paved
  for (let x = 0; x <= 10; x++) for (const yy of [28, 29, 30]) w.roads[tileId(x, yy)] = 3;
  expect(meets(frontageAt(w, 2, 31, 3, 3), APARTMENT_NEED[2])).toBe(true); expect(meets(frontageAt(w, 2, 31, 3, 3), OFFICE_NEED[2])).toBe(false); // an office tower wants four lanes
});
