// Oil: a few hidden fields lie under each region, each holding a set reserve. A geological survey reads one area
// (roughly: the reading is noisy, so some warm patches are false and some fields read faint); drilling there usually
// strikes, drilling blind rarely does. A strike becomes a working oil well that draws on its field's reserve. Each field
// suits a balanced number of wells; more than that drops its pressure and wastes oil, so it runs dry sooner.
import { MAP, worldOf } from './world';
import type { RegionId } from './config';
import type { Building, GameState } from './types';

export interface OilState {
  /** survey centres by region: each reads the ground within SURVEY_R tiles */ surveys: Partial<Record<RegionId, [number, number][]>>;
  dry: Partial<Record<RegionId, [number, number][]>>;
  /** reserve used up per field (`region:index`), waste from over-drilling included */ drawn: Record<string, number>;
}
export function oilOf(s: GameState): OilState {
  const o = (s.oil ??= { surveys: {}, dry: {}, drawn: {} }) as OilState & { surveyed?: RegionId[] };
  o.surveys ??= {}; o.dry ??= {}; o.drawn ??= {};
  if (o.surveyed) { // saves from when a survey read a whole region: keep a survey over each well already struck there
    for (const r of o.surveyed) for (const b of s.buildings) { const p = b.type === 'oilWell' && b.region === r ? worldOf(s, r).pos[`b:${b.id}`] : null; if (p && !(o.surveys[r] ?? []).some(([x, y]) => (x - p[0]) ** 2 + (y - p[1]) ** 2 < 100)) (o.surveys[r] ??= []).push([p[0] + 1, p[1] + 1]); }
    delete o.surveyed;
  }
  return o;
}
export const SURVEY_PRICE = 8000, DRILL_PRICE = 15000, SURVEY_R = 18;
/** Barrels a well's field needs per balanced well: a 40k-barrel field suits 2 wells. */
const PER_WELL = 20000;

type OilField = { x: number; y: number; r: number; reserve: number };
const fields = new Map<RegionId, OilField[]>();
const hash = (k: number, i: number) => { const v = Math.sin(k * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
const regionKey = (r: RegionId) => [...r].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 100000;
/** Three oil fields per region, away from the starting valley; deterministic so every game of a region agrees. */
export function oilFields(r: RegionId): OilField[] {
  const hit = fields.get(r);
  if (hit) return hit;
  const k = regionKey(r), rand = (i: number) => hash(k, i);
  const out: OilField[] = [];
  for (let i = 0; out.length < 3 && i < 40; i++) {
    const x = Math.round(MAP.x0 + 20 + rand(i * 2) * (MAP.w - 40)), y = Math.round(MAP.y0 + 20 + rand(i * 2 + 1) * (MAP.h - 40));
    if (Math.abs(x) < 26 && Math.abs(y - 4) < 22) continue; // never right under the starting valley
    out.push({ x, y, r: 4 + rand(i + 99) * 4, reserve: Math.round((20 + rand(i + 199) * 50) * 1000) });
  }
  fields.set(r, out);
  return out;
}
/** A field reaches about two and a half of its radii out; beyond that there is no oil to strike or pump. */
const REACH = 0.04;
/** Chance (0–0.8) that a well drilled at this tile strikes oil: none off the fields. */
export function oilChance(r: RegionId, x: number, y: number) {
  const v = oilFields(r).reduce((a, f) => a + Math.exp(-((x - f.x) ** 2 + (y - f.y) ** 2) / (2 * f.r * f.r)), 0);
  return v < REACH ? 0 : Math.min(0.8, 0.02 + v * 0.78);
}
/** What a survey reads at a tile, in 4-tile blocks: real oil reads anywhere from half to one and a half times its odds, and about one block in fifteen gives a false show, so the map is a hint, not a promise. */
export function oilReading(r: RegionId, x: number, y: number) {
  const block = Math.floor(x / 4) * 977 + Math.floor(y / 4) * 31, k = regionKey(r);
  const ghost = hash(k + 17, block) > 0.935 ? 0.25 + hash(k + 23, block) * 0.3 : 0;
  return Math.min(0.9, Math.max(oilChance(r, x, y) * (0.5 + hash(k + 29, block)), ghost));
}
/** A rough word for a survey reading (the survey never gives exact odds). */
export const readingWord = (v: number) => (v < 0.12 ? 'faint' : v < 0.3 ? 'weak' : v < 0.5 ? 'fair' : 'strong');
export const surveyed = (s: GameState, r: RegionId) => !!oilOf(s).surveys[r]?.length;
export const surveyedAt = (s: GameState, r: RegionId, x: number, y: number) => (oilOf(s).surveys[r] ?? []).some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= SURVEY_R * SURVEY_R);

/** The field a well at this tile draws on (the one it sits most within), or -1 if no field reaches it. */
export function fieldAt(r: RegionId, x: number, y: number) {
  let best = -1, score = REACH;
  oilFields(r).forEach((f, i) => { const v = Math.exp(-((x - f.x) ** 2 + (y - f.y) ** 2) / (2 * f.r * f.r)); if (v >= score) { score = v; best = i; } });
  return best;
}
const wellTile = (s: GameState, b: Building) => { const p = worldOf(s, b.region).pos[`b:${b.id}`]; return p ? [p[0] + 1, p[1] + 1] : null; };
/** A field's state: its reserve, what is left, its wells and how many suit it, and how fast over-drilling drains it (1 = no waste). */
export function fieldState(s: GameState, r: RegionId, i: number) {
  const f = oilFields(r)[i], wells = s.buildings.filter((b) => { if (b.type !== 'oilWell' || b.region !== r) return false; const t = wellTile(s, b); return !!t && fieldAt(r, t[0], t[1]) === i; });
  const balanced = Math.max(1, Math.round(f.reserve / PER_WELL)), over = Math.max(0, wells.length - balanced);
  return { i, reserve: f.reserve, left: Math.max(0, f.reserve - (oilOf(s).drawn[`${r}:${i}`] ?? 0)), wells, balanced, drain: 1 + 0.6 * over / balanced };
}
/** The field under a well, or null if there is no oil under it (or it is not on the map). */
export function wellField(s: GameState, b: Building) {
  const t = wellTile(s, b), i = t ? fieldAt(b.region, t[0], t[1]) : -1;
  return i < 0 ? null : fieldState(s, b.region, i);
}
/** Fields the player has struck (they have at least one well). */
export const struckFields = (s: GameState, r: RegionId) => oilFields(r).map((_, i) => fieldState(s, r, i)).filter((f) => f.wells.length);
/** Take pumped barrels from the well's field; over-drilled fields lose more than they give. */
export function drawOil(s: GameState, b: Building, barrels: number) {
  const f = wellField(s, b);
  if (!f || barrels <= 0) return;
  const k = `${b.region}:${f.i}`, O = oilOf(s);
  O.drawn[k] = (O.drawn[k] ?? 0) + barrels * f.drain;
}
