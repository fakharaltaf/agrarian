// The neighbours' towns, laid out on their own regions' maps the way your town is on yours: streets on the tile grid off the main
// road, homes, a town hall and services, fields round about. Each town has its own plan and its own stage of growth: the Arid
// Frontier a dirt-road village strung along two tracks, the Tropical Highlands a hamlet of huts on a loop through its plantations,
// the River Plains a farming village round its green, the Coastal Trade Hub a paved port city of towers and blocks. Fixed for now
// (seen on a visit); the shapes match your own town's records so a town you later take over, buy or ally with can be worked like yours.
import type { CropId } from './config';
import type { NeighbourId } from './region-state';
import { chunkAt, MAP, ROAD_H, ROAD_Y, riverTiles, SEA_X, tileId } from './world';

export interface NeighbourLot { key: string; name: string; kind: 'home' | 'civic'; /** home tier or service type */ type: string; level: number; x: number; y: number; w: number; d: number; rot: number }
export interface NeighbourField { x: number; y: number; s: number; crop: CropId; /** how far grown, 0–1 */ phase: number }
export interface NeighbourTown { roads: Record<number, number>; cleared: number[]; lots: NeighbourLot[]; fields: NeighbourField[] }

const NAMES: Record<string, string> = { hall: 'Town hall' };
type Build = NeighbourTown & { id: NeighbourId; taken: Set<number>; clear: Set<number>; n: number; rand: () => number };

// ---------------------------------------------------------------- building blocks
const S = ROAD_Y + ROAD_H; // the first row south of the main road
function road(b: Build, x0: number, y0: number, x1: number, y1: number, grade: number) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { const k = tileId(x, y); b.roads[k] = grade; b.taken.add(k); b.clear.add(chunkAt(x, y)); }
}
function free(b: Build, x: number, y: number, w: number, d: number, pad = 0) {
  const water = riverTiles(b.id), sea = SEA_X[b.id] ?? Infinity;
  for (let yy = y - pad; yy < y + d + pad; yy++) for (let xx = x - pad; xx < x + w + pad; xx++) {
    const k = tileId(xx, yy);
    if (yy < S || xx < MAP.x0 || yy >= MAP.y0 + MAP.h || xx >= sea - 1 || b.taken.has(k) || water.has(k) || water.has(tileId(xx - 1, yy)) || water.has(tileId(xx + 1, yy))) return false;
  }
  return true;
}
function claim(b: Build, x: number, y: number, w: number, d: number, margin = 1) {
  for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) b.taken.add(tileId(xx, yy));
  for (let yy = y - margin; yy < y + d + margin; yy++) for (let xx = x - margin; xx < x + w + margin; xx++) b.clear.add(chunkAt(xx, yy));
}
function lot(b: Build, kind: 'home' | 'civic', type: string, level: number, x: number, y: number, rot: number, w = 3, d = 3) {
  const [lw, ld] = rot % 2 ? [d, w] : [w, d];
  if (!free(b, x, y, lw, ld)) return false;
  claim(b, x, y, lw, ld);
  b.lots.push({ key: kind === 'civic' ? `civic:${type}:nb${b.id}${b.n++}` : `community:${type}:nb${b.id}${b.n++}`, name: NAMES[type] ?? '', kind, type, level, x, y, w: lw, d: ld, rot });
  return true;
}
/** Lots down both sides of a straight street, fronts to it. gap: tiles left between them (a village leaves more), fill: how many get built. */
function alongStreet(b: Build, x0: number, y0: number, x1: number, y1: number, make: () => [string, number] | null, gap: [number, number], fill = 1) {
  const horiz = y0 === y1, len = horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0), a = horiz ? Math.min(x0, x1) : Math.min(y0, y1);
  for (const side of [-1, 1]) for (let t = a + 1; t + 3 <= a + len; ) {
    const pick = b.rand() < fill ? make() : null;
    if (pick) {
      const [tier, level] = pick, x = horiz ? t : side < 0 ? x0 - 3 : x0 + 1, y = horiz ? (side < 0 ? y0 - 3 : y0 + 1) : t;
      lot(b, 'home', tier, level, x, y, horiz ? (side < 0 ? 0 : 2) : side < 0 ? 1 : 3);
    }
    t += 3 + gap[0] + Math.floor(b.rand() * (gap[1] - gap[0] + 1));
  }
}
/** A service on the first free spot round a point, front to the nearest street. */
function service(b: Build, type: string, level: number, cx: number, cy: number, size = 3) {
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = cx + dx, y = cy + dy;
    const facing = [[0, size, 0], [size, 0, 1], [0, -1, 2], [-1, 0, 3]].find(([ox, oy]) => b.roads[tileId(x + (ox ? ox : 1), y + (oy ? oy : 1))] !== undefined);
    if (facing && lot(b, 'civic', type, level, x, y, facing[2], size === 4 ? 4 : size, size === 4 ? 3 : size)) return;
  }
}
function fields(b: Build, spots: [number, number, number][], crops: CropId[]) {
  let i = 0;
  for (const [x, y, s] of spots) {
    if (!free(b, x, y, s, s, 1)) continue;
    claim(b, x, y, s, s, 1);
    b.fields.push({ x, y, s, crop: crops[i % crops.length], phase: (i++ * 0.37) % 1 });
  }
}
const pick = (b: Build, tiers: [string, number, number][]) => () => { let r = b.rand() * tiers.reduce((a, t) => a + t[2], 0); for (const [t, l, w] of tiers) if ((r -= w) <= 0) return [t, l] as [string, number]; return [tiers[0][0], tiers[0][1]] as [string, number]; };

// ---------------------------------------------------------------- the four towns
const PLANS: Record<NeighbourId, (b: Build) => void> = {
  // a frontier village: two dirt tracks off the main road, scattered cottages, the militia and the khan's hall at the crossing, a few watered plots
  arid(b) {
    road(b, 24, S, 24, 32, 1); road(b, 8, 20, 42, 20, 1); road(b, 14, 29, 24, 29, 1);
    service(b, 'hall', 1, 25, 16, 4); service(b, 'militia', 1, 20, 21); service(b, 'watchtower', 1, 26, 21); service(b, 'well', 1, 19, 16); service(b, 'shopGeneral', 1, 29, 16); service(b, 'clinic', 1, 33, 21);
    const home = pick(b, [['cottage', 1, 1]]);
    alongStreet(b, 24, S, 24, 32, home, [1, 3], 0.7); alongStreet(b, 8, 20, 42, 20, home, [1, 4], 0.65); alongStreet(b, 14, 29, 24, 29, home, [1, 2], 0.8);
    fields(b, [[46, 12, 5], [46, 19, 4], [6, 24, 5], [30, 26, 5], [36, 26, 4], [12, 34, 5]], ['cotton', 'grapes', 'wheat']);
  },
  // a hamlet of huts round a loop track, plantations cut out of the jungle around it
  tropics(b) {
    road(b, 16, S, 16, 20, 1); road(b, 16, 20, 34, 20, 1); road(b, 34, 20, 34, 30, 1); road(b, 12, 30, 34, 30, 1); road(b, 12, 20, 12, 30, 1); road(b, 12, 20, 16, 20, 1);
    service(b, 'hall', 1, 21, 22, 4); service(b, 'well', 1, 17, 16); service(b, 'clinic', 1, 27, 16); service(b, 'shopGeneral', 1, 26, 22);
    const hut = pick(b, [['cottage', 1, 1]]);
    for (const [a, c, d, e] of [[16, S, 16, 20], [16, 20, 34, 20], [34, 20, 34, 30], [12, 30, 34, 30], [12, 20, 12, 30]] as const) alongStreet(b, a, c, d, e, hut, [2, 4], 0.6);
    fields(b, [[40, 12, 7], [40, 21, 6], [40, 29, 8], [4, 34, 6], [16, 34, 7], [26, 35, 6], [36, 39, 7], [50, 14, 6], [50, 24, 8]], ['coffee', 'sugarcane', 'rice']);
  },
  // a farming village round its green: the hall, school and bakery face it, lanes run out to the farms, fields as far as you can see
  river(b) {
    road(b, 28, S, 28, 16, 2); road(b, 21, 16, 35, 16, 2); road(b, 21, 28, 35, 28, 2); road(b, 21, 16, 21, 28, 2); road(b, 35, 16, 35, 28, 2);
    road(b, 6, 22, 21, 22, 2); road(b, 35, 22, 50, 22, 2); road(b, 28, 28, 28, 42, 2);
    service(b, 'park', 1, 26, 21); service(b, 'hall', 2, 23, 17, 4); service(b, 'school', 2, 30, 17); service(b, 'shopBaker', 1, 23, 25); service(b, 'clinic', 1, 30, 25); service(b, 'well', 1, 36, 12);
    const home = pick(b, [['cottage', 1, 3], ['terrace', 1, 1]]);
    alongStreet(b, 21, 16, 35, 16, home, [0, 1]); alongStreet(b, 21, 28, 35, 28, home, [0, 1]); alongStreet(b, 21, 16, 21, 28, home, [0, 1]); alongStreet(b, 35, 16, 35, 28, home, [0, 1]);
    alongStreet(b, 6, 22, 21, 22, home, [0, 2], 0.8); alongStreet(b, 35, 22, 50, 22, home, [0, 2], 0.8); alongStreet(b, 28, 28, 28, 42, home, [0, 2], 0.8);
    const spots: [number, number, number][] = [];
    for (let y = S + 1; y < 60; y += 9) for (let x = -6; x < 80; x += 9) spots.push([x, y, 8]);
    fields(b, spots, ['wheat', 'corn', 'potatoes', 'apples']);
  },
  // a port city: a paved grid running down to the sea, towers in the middle, terraces round them, every service grown, a mall
  coastal(b) {
    const x0 = 16, sea = (SEA_X.coastal ?? 70) - 2, cols = Math.floor((sea - x0) / 8), rows = 5, y0 = S + 1;
    for (let i = 0; i <= cols; i++) road(b, x0 + i * 8, S, x0 + i * 8, y0 + rows * 8, 3);
    for (let j = 0; j <= rows; j++) road(b, x0, y0 + j * 8, x0 + cols * 8, y0 + j * 8, 3);
    const mid = [Math.floor(cols / 2), 2];
    const civic: [string, number, number][] = [['hall', 3, 4], ['mall', 2, 6], ['hospital', 3, 3], ['school', 3, 3], ['police', 3, 3], ['waterTower', 3, 3], ['lighting', 3, 3], ['parking', 2, 3], ['shopGrocer', 2, 3], ['shopDairy', 2, 3], ['shopButcher', 2, 3], ['park', 3, 3], ['park', 2, 3], ['sanitation', 3, 3]];
    const blocks: [number, number][] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) blocks.push([i, j]);
    blocks.sort((a, c) => Math.hypot(a[0] - mid[0], a[1] - mid[1]) - Math.hypot(c[0] - mid[0], c[1] - mid[1]));
    blocks.forEach(([i, j], k) => {
      const bx = x0 + i * 8 + 1, by = y0 + j * 8 + 1, far = Math.hypot(i - mid[0], j - mid[1]);
      if (k % 3 === 1 && civic.length) { const [t, l, s] = civic.shift()!; if (s === 6) { lot(b, 'civic', t, l, bx, by, 2, 6, 6); return; } lot(b, 'civic', t, l, bx, by, 2, s === 4 ? 4 : 3, 3); }
      for (const [dx, dy, rot] of [[0, 0, 2], [3, 0, 2], [0, 4, 0], [3, 4, 0]] as const) {
        const tier = far < 1.6 ? 'apartment' : far < 2.6 ? (b.rand() < 0.5 ? 'apartment' : 'terrace') : 'terrace', level = tier === 'apartment' ? (far < 1.2 ? 3 : 2) : 1;
        lot(b, 'home', tier, level, bx + dx + (dx ? 1 : 0), by + dy, rot);
      }
    });
    for (let y = y0; y < y0 + rows * 8; y++) for (let x = x0 - 1; x <= x0 + cols * 8 + 1; x++) b.clear.add(chunkAt(x, y));
    fields(b, [[0, 12, 6], [0, 20, 6], [6, 30, 6], [0, 38, 6]], ['potatoes', 'wheat']);
  },
};

const cache = new Map<NeighbourId, NeighbourTown>();
export function neighbourTown(id: NeighbourId): NeighbourTown {
  const hit = cache.get(id); if (hit) return hit;
  let seed = id.length * 7919 + id.charCodeAt(0);
  const b: Build = { id, roads: {}, lots: [], fields: [], cleared: [], taken: new Set(), clear: new Set(), n: 0, rand: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } };
  PLANS[id](b);
  const town = { roads: b.roads, cleared: [...b.clear].filter((c) => c >= 0), lots: b.lots, fields: b.fields };
  cache.set(id, town); return town;
}
