// The neighbours' towns, laid out on their own regions' maps the way your town is on yours: streets on the tile grid off the main
// road, homes in blocks, a town hall and services, fields round about. Fixed for now (seen on a visit); the shapes match your own
// town's records so a town you later take over, buy or ally with can be worked like yours.
import type { CropId } from './config';
import type { NeighbourId } from './region-state';
import { chunkAt, ROAD_H, ROAD_Y, tileId } from './world';

export interface NeighbourLot { key: string; name: string; kind: 'home' | 'civic'; /** home tier or service type */ type: string; level: number; x: number; y: number; w: number; d: number; rot: number }
export interface NeighbourField { x: number; y: number; s: number; crop: CropId; /** how far grown, 0–1 */ phase: number }
export interface NeighbourTown { roads: Record<number, number>; cleared: number[]; lots: NeighbourLot[]; fields: NeighbourField[] }

/** Each town's size (blocks across and down), street grade, homes and the services on its blocks, and what its farms grow. */
const PLAN: Record<NeighbourId, { cols: number; rows: number; grade: number; homes: string[]; apartments?: number; civic: string[]; crops: CropId[] }> = {
  arid: { cols: 4, rows: 3, grade: 1, homes: ['cottage', 'cottage', 'terrace'], civic: ['hall', 'well', 'militia', 'shopGeneral', 'watchtower', 'clinic'], crops: ['cotton', 'wheat', 'grapes'] },
  coastal: { cols: 5, rows: 4, grade: 3, homes: ['terrace', 'terrace', 'cottage'], apartments: 2, civic: ['hall', 'hospital', 'school', 'police', 'waterTower', 'shopGrocer', 'shopDairy', 'shopButcher', 'park', 'lighting', 'parking'], crops: ['potatoes', 'wheat'] },
  river: { cols: 4, rows: 3, grade: 2, homes: ['cottage', 'cottage', 'terrace'], civic: ['hall', 'school', 'well', 'shopBaker', 'clinic', 'park'], crops: ['wheat', 'corn', 'potatoes', 'apples'] },
  tropics: { cols: 3, rows: 3, grade: 1, homes: ['cottage'], civic: ['hall', 'well', 'clinic', 'shopGeneral'], crops: ['coffee', 'sugarcane', 'rice'] },
};
const NAMES: Record<string, string> = { hall: 'Town hall' };
const BLOCK = 9; // a block is 8 tiles square inside its streets
const X0 = 6, Y0 = ROAD_Y + ROAD_H + 2; // the town starts just south of the main road, east of the river, as yours does

const cache = new Map<NeighbourId, NeighbourTown>();
export function neighbourTown(id: NeighbourId): NeighbourTown {
  const hit = cache.get(id); if (hit) return hit;
  const p = PLAN[id], roads: Record<number, number> = {}, lots: NeighbourLot[] = [], fields: NeighbourField[] = [];
  const W = p.cols * BLOCK, H = p.rows * BLOCK;
  // streets: a grid, its middle street running up to meet the main road
  for (let i = 0; i <= p.cols; i++) for (let y = Y0; y <= Y0 + H; y++) roads[tileId(X0 + i * BLOCK, y)] = p.grade;
  for (let j = 0; j <= p.rows; j++) for (let x = X0; x <= X0 + W; x++) roads[tileId(x, Y0 + j * BLOCK)] = p.grade;
  const mid = X0 + Math.floor(p.cols / 2) * BLOCK;
  for (let y = ROAD_Y + ROAD_H; y < Y0; y++) roads[tileId(mid, y)] = p.grade;
  // blocks: services spread through the town (the hall on the middle block by the main street), homes on the rest, four to a block
  let seed = id.length * 7919, n = 0;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const blocks: [number, number][] = [];
  for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.cols; i++) blocks.push([i, j]);
  const civicAt = new Map<string, string>();
  const order = [...blocks].sort((a, b) => Math.hypot(a[0] - p.cols / 2 + 0.5, a[1]) - Math.hypot(b[0] - p.cols / 2 + 0.5, b[1]));
  p.civic.forEach((t, k) => { const b = order[k * 2 % order.length] ?? order[k]; if (!civicAt.has(b.join())) civicAt.set(b.join(), t); else civicAt.set(order.find((o) => !civicAt.has(o.join()))!.join(), t); });
  let flats = p.apartments ?? 0;
  for (const [i, j] of blocks) {
    const bx = X0 + i * BLOCK + 1, by = Y0 + j * BLOCK + 1, civic = civicAt.get(`${i},${j}`);
    if (civic) { // one service and two homes behind it
      const w = civic === 'hall' ? 4 : 3, d = 3;
      lots.push({ key: `civic:${civic}:nb${id}${n++}`, name: NAMES[civic] ?? '', kind: 'civic', type: civic, level: id === 'coastal' ? 2 : 1, x: bx + 1, y: by, w, d, rot: 2 });
      for (const dx of [0, 4]) lots.push(home(id, n++, p.homes[Math.floor(rand() * p.homes.length)], bx + dx + 0.5, by + 4.5, 0));
      continue;
    }
    for (const [dx, dy, rot] of [[0, 0, 2], [4, 0, 2], [0, 4, 0], [4, 4, 0]] as const) {
      const tier = flats > 0 && dx === 0 && dy === 0 ? 'apartment' : p.homes[Math.floor(rand() * p.homes.length)];
      if (tier === 'apartment') flats--;
      lots.push(home(id, n++, tier, bx + dx + 0.5, by + dy + 0.5, rot, tier === 'apartment' ? 2 : 1));
    }
  }
  // farms beyond the last street: fields in rows to the east and south
  let f = 0;
  for (let y = Y0; y < Y0 + H + 14; y += 7) for (let x = X0 + W + 3; x < X0 + W + 38; x += 7) fields.push({ x, y, s: 6, crop: p.crops[f % p.crops.length], phase: (f++ * 0.37) % 1 });
  for (let x = X0; x < X0 + W; x += 7) fields.push({ x, y: Y0 + H + 3, s: 6, crop: p.crops[f % p.crops.length], phase: (f++ * 0.37) % 1 });
  // the ground they stand on is cleared
  const cleared = new Set<number>();
  for (let y = ROAD_Y; y < Y0 + H + 11; y++) for (let x = X0 - 2; x < X0 + W + 40; x++) cleared.add(chunkAt(x, y));
  const town = { roads, cleared: [...cleared], lots, fields };
  cache.set(id, town); return town;
}
const home = (id: NeighbourId, n: number, tier: string, x: number, y: number, rot: number, level = 1): NeighbourLot => ({ key: `community:${tier}:nb${id}${n}`, name: '', kind: 'home', type: tier, level, x: Math.floor(x), y: Math.floor(y), w: 3, d: 3, rot });
