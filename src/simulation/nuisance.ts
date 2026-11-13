// Nuisance: what a working building does to the homes around it. Rated per building and per level, because a village
// windmill or a bakery is a good neighbour while a pigsty, a biogas plant or a refinery is not, and a workshop that grows
// to industrial scale gets louder. Smell and noise cost happiness; smoke and fumes cost health; fresh bread lifts spirits.
// Each fades with distance from the building to nothing at its radius (tiles), and adds up across buildings (capped at 1).
import type { BuildingType } from './config';
import type { GameState } from './types';
import { HOME_DEFS, communityOf } from './community-state';
import { footprintOf, worldOf } from './world';

export type NuisanceKind = 'smell' | 'noise' | 'smoke' | 'pleasant';
export type Nuisance = Partial<Record<NuisanceKind, number>>;
const KINDS: NuisanceKind[] = ['smell', 'noise', 'smoke', 'pleasant'];

/** Radius in tiles of each nuisance, by level (1–3). A missing level repeats the last one. */
export const NUISANCE: Partial<Record<BuildingType, Nuisance[]>> = {
  flourMill: [{}, { noise: 6 }, { noise: 10 }], // a windmill at first; roller mills are loud
  bakery: [{ pleasant: 6 }, {}, { noise: 6 }], // fresh bread, until the delivery lorries come
  winery: [{}, {}, { noise: 6 }],
  creamery: [{}, {}, { noise: 6 }],
  feedMill: [{ noise: 4 }, { noise: 8 }, { noise: 10 }],
  oilPress: [{}, { smell: 6 }, { smell: 8 }],
  sugarMill: [{ smell: 8, smoke: 6 }, { smell: 10, smoke: 8 }, { smell: 12, smoke: 10 }], // molasses, and burning cane waste
  dairy: [{ smell: 6 }, { smell: 8 }, { smell: 10 }],
  ranch: [{ smell: 10 }, { smell: 12 }, { smell: 14 }],
  coop: [{ smell: 3 }, { smell: 4 }, { smell: 5 }],
  sheepfold: [{ smell: 3 }, { smell: 4 }, { smell: 5 }],
  cowshed: [{ smell: 6 }, { smell: 8 }, { smell: 10 }],
  pigsty: [{ smell: 10 }, { smell: 12 }, { smell: 14 }],
  windTurbine: [{ noise: 5 }],
  biogas: [{ smell: 10 }, { smell: 12 }, { smell: 14 }],
  oilWell: [{ noise: 6, smoke: 4 }], // the pump, and gas at the wellhead
  refinery: [{ smoke: 30, noise: 15 }],
  distribution: [{ noise: 8 }], // lorries day and night
};
export const nuisanceOf = (type: BuildingType, level = 1): Nuisance => {
  const l = NUISANCE[type];
  return l ? l[Math.min(l.length, Math.max(1, level)) - 1] : {};
};
export const NUISANCE_LOOK: Record<NuisanceKind, { icon: string; name: string; color: number }> = {
  smell: { icon: '👃', name: 'Smell', color: 0xd9a441 },
  noise: { icon: '🔊', name: 'Noise', color: 0x8f6fd0 },
  smoke: { icon: '🌫', name: 'Smoke', color: 0x6e6e6e },
  pleasant: { icon: '🍞', name: 'Fresh bread', color: 0x5fbf6a },
};
/** The harm (or good) at most: full smell plus noise costs 20 points of happiness, full smoke 35 of health, full bread lifts happiness 5. */
export const NUISANCE_WEIGHT = { annoy: 0.2, smoke: 0.35, pleasant: 0.05 };

export type Source = { key: string; x: number; y: number; n: Nuisance };
/** Every working building in the region that troubles (or cheers) its neighbours, with its middle. */
export function nuisanceSources(s: GameState, r: GameState['buildings'][number]['region'] = 'heartland'): Source[] {
  const w = worldOf(s, r), out: Source[] = [];
  for (const b of s.buildings) {
    if (b.region !== r || !b.active) continue;
    const n = nuisanceOf(b.type, b.level), key = `b:${b.id}`, p = w.pos[key], fp = footprintOf(s, key);
    if (!p || !fp || !Object.keys(n).length) continue;
    out.push({ key, x: p[0] + fp.w / 2, y: p[1] + fp.d / 2, n });
  }
  return out;
}
/** How strongly each kind reaches a spot: 1 beside its source, fading to 0 at its radius, summed over sources and capped at 1. */
export function exposureAt(sources: Source[], x: number, y: number): Record<NuisanceKind, number> {
  const e = { smell: 0, noise: 0, smoke: 0, pleasant: 0 };
  for (const src of sources) for (const k of KINDS) { const r = src.n[k]; if (r) e[k] += Math.max(0, 1 - Math.hypot(x - src.x, y - src.y) / r); }
  for (const k of KINDS) e[k] = Math.min(1, e[k]);
  return e;
}
/** The settlement's homes, each with its families and what reaches it. */
export function homesExposed(s: GameState, sources = nuisanceSources(s)) {
  const w = worldOf(s, 'heartland');
  return communityOf(s).homes.map((h) => {
    const key = `home:${h.id}`, p = w.pos[key], fp = footprintOf(s, key);
    if (!p || !fp) return null;
    const x = p[0] + fp.w / 2, y = p[1] + fp.d / 2;
    return { key, x, y, families: HOME_DEFS[h.tier].families * h.count, e: exposureAt(sources, x, y) };
  }).filter((h): h is NonNullable<typeof h> => !!h);
}
/** What the settlement as a whole lives with: each kind averaged over its families (0–1). */
export function settlementExposure(s: GameState) {
  const homes = homesExposed(s), total = homes.reduce((n, h) => n + h.families, 0), avg = { smell: 0, noise: 0, smoke: 0, pleasant: 0 };
  if (!total) return avg;
  for (const h of homes) for (const k of KINDS) avg[k] += (h.e[k] * h.families) / total;
  return avg;
}
/** Happiness lost (negative: gained) to what the homes live with. */
export const nuisanceHappiness = (e: Record<NuisanceKind, number>) => NUISANCE_WEIGHT.annoy * Math.min(1, e.smell + e.noise) - NUISANCE_WEIGHT.pleasant * e.pleasant;
/** Homes a building at this spot and level would reach with something harmful. */
export function homesReached(s: GameState, type: BuildingType, level: number, x: number, y: number) {
  const n = nuisanceOf(type, level), harm = Math.max(n.smell ?? 0, n.noise ?? 0, n.smoke ?? 0);
  if (!harm) return 0;
  return homesExposed(s, []).filter((h) => Math.hypot(h.x - x, h.y - y) < harm).length;
}
