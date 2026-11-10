// Oil: a few hidden fields lie under each region. A geological survey maps where oil is likely; drilling there
// usually strikes, drilling blind rarely does. A strike becomes a working oil well; a miss leaves a dry hole.
import { MAP } from './world';
import type { RegionId } from './config';
import type { GameState } from './types';

export interface OilState { surveyed: RegionId[]; dry: Partial<Record<RegionId, [number, number][]>> }
export const oilOf = (s: GameState): OilState => (s.oil ??= { surveyed: [], dry: {} });
export const SURVEY_PRICE = 8000, DRILL_PRICE = 15000;

const fields = new Map<RegionId, { x: number; y: number; r: number }[]>();
/** Three oil fields per region, away from the starting valley; deterministic so every game of a region agrees. */
function oilFields(r: RegionId) {
  const hit = fields.get(r);
  if (hit) return hit;
  const k = [...r].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const rand = (i: number) => { const v = Math.sin(k * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; out.length < 3 && i < 40; i++) {
    const x = Math.round(MAP.x0 + 20 + rand(i * 2) * (MAP.w - 40)), y = Math.round(MAP.y0 + 20 + rand(i * 2 + 1) * (MAP.h - 40));
    if (Math.abs(x) < 26 && Math.abs(y - 4) < 22) continue; // never right under the starting valley
    out.push({ x, y, r: 6 + rand(i + 99) * 6 });
  }
  fields.set(r, out);
  return out;
}
/** Chance (0–0.9) that a well drilled at this tile strikes oil. */
export function oilChance(r: RegionId, x: number, y: number) {
  const v = oilFields(r).reduce((a, f) => a + Math.exp(-((x - f.x) ** 2 + (y - f.y) ** 2) / (2 * f.r * f.r)), 0);
  return Math.min(0.9, 0.04 + v * 0.86);
}
export const surveyed = (s: GameState, r: RegionId) => oilOf(s).surveyed.includes(r);
