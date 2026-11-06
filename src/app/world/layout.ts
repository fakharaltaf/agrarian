// Where everything sits in a region's isometric world. Deterministic: same state, same picture.
import { BUILDING_TYPES, CONFIG, type BuildingType, type RegionId } from '../../simulation/config';
import type { Building, CivicService, Field, GameState } from '../../simulation/types';
import { stageAtLeast } from '../../simulation/stages';
import { townOf } from '../../simulation/town-state';
import { DISTRICT_IDS } from '../../simulation/types';
import { communityOf } from '../../simulation/community-state';

export interface Lot { key: string; type: BuildingType | 'house' | 'shed'; buildings: Building[]; service?: CivicService; x: number; y: number; w: number; d: number }
export interface Plot { field: Field; x: number; y: number; s: number }
export interface Layout { lots: Lot[]; plots: Plot[]; roadY: number; buy: { x: number; y: number; s: number } | null; maxX: number; maxY: number }

const LOT_W = 7, LOT_D = 5, LOTS_PER_ROW = 5, FIELD_ROW_W = 46;

/** Tiles each building occupies (x × y). */
export const FOOTPRINT: Record<Lot['type'], [number, number]> = {
  house: [3, 3], shed: [2, 2], barn: [3, 2], silo: [2, 2], coldStore: [3, 2], warehouse: [5, 3], flourMill: [2, 2], bakery: [2, 2],
  feedMill: [3, 2], ranch: [5, 4], dairy: [5, 3], creamery: [3, 2], oilPress: [3, 2], sugarMill: [3, 2], biogas: [3, 3], solar: [5, 3],
  verticalFarm: [2, 2], distribution: [5, 3], lab: [3, 2], lab2: [4, 3], coop: [3, 3], pigsty: [4, 3], cowshed: [5, 4], sheepfold: [5, 4], winery: [3, 3],
};

/** Side length in tiles: area grows with hectares but stays legible (1 ha = 2×2 tiles … capped at 16×16). */
export const plotSide = (ha: number) => Math.max(2, Math.min(16, Math.round(2 * Math.sqrt(ha))));

export function layoutRegion(s: GameState, r: RegionId): Layout {
  const lots: Lot[] = [];
  const add = (type: Lot['type'], bs: Building[], key: string = type) => {
    const [w, d] = FOOTPRINT[type];
    const landmark = key === 'market' ? 1 : key === 'crew' ? 2 : key === 'office' ? 3 : 0;
    const industrial = BUILDING_TYPES.indexOf(type as BuildingType);
    const x = bs.length ? (industrial % LOTS_PER_ROW) * LOT_W + 1 : landmark * LOT_W + 1;
    const y = bs.length ? -LOT_D * (1 + Math.floor(industrial / LOTS_PER_ROW)) : 1;
    lots.push({ key, type, buildings: bs, x, y, w, d });
  };
  add(r === 'heartland' ? 'house' : 'shed', []);
  if (s.stats.harvests > 0) add('shed', [], 'market');
  if (stageAtLeast(s, 'farm-business')) add('house', [], 'crew');
  if (s.legacyProgression ? s.era >= 3 : stageAtLeast(s, 'industry')) add('house', [], 'office');
  const here = s.buildings.filter((b) => b.region === r);
  for (const t of BUILDING_TYPES) {
    const bs = here.filter((b) => b.type === t);
    if (bs.length) add(t, bs);
  }
  if (r === 'heartland' && communityOf(s).active) {
    // Separate fixed streets prevent new houses from moving fields or factories.
    // Eight visible blocks per density tier represent larger neighbourhood cohorts.
    for (const home of communityOf(s).homes) for (let i = 0; i < Math.min(home.count, 8); i++) {
      const street = home.tier === 'cottage' ? 0 : home.tier === 'terrace' ? 1 : 2;
      lots.push({ key: `community:${home.tier}:${home.id}-${i}`, type: 'house', buildings: [], x: -7 - street * 8, y: i === 0 ? 1 : 5 + i * 4, w: 3, d: 3 });
    }
  }
  if(r==='heartland' && townOf(s).active) {
    lots.push({key:'civic:hall',type:'house',buildings:[],x:-31,y:1,w:4,d:3});
    const order=['school','well','clinic','road','hospital','waterworks','park'];
    for(const service of townOf(s).services) {
      const road=service.type==='road';
      lots.push({key:`civic:${service.type}:${service.id}`,type:'house',buildings:[],service,x:-7-DISTRICT_IDS.indexOf(service.district)*8+(road?3.2:0),y:road?1:-6-order.indexOf(service.type)*5,w:road?1:3,d:road?36:3});
    }
  }
  const roadY = 6;

  const plots: Plot[] = [];
  let x = 0, y = roadY + 2, rowH = 0;
  const place = (side: number) => {
    if (x > 0 && x + side > FIELD_ROW_W) (x = 0), (y += rowH + 1), (rowH = 0);
    const at = { x, y };
    x += side + 1;
    rowH = Math.max(rowH, side);
    return at;
  };
  for (const f of s.fields) {
    if (f.region !== r) continue;
    const side = plotSide(f.ha);
    plots.push({ field: f, ...place(side), s: side });
  }
  let buy: Layout['buy'] = null;
  if (r === 'heartland' && s.stats.sales > 0 && s.regions.heartland.homePlotsBought < CONFIG.homePlots) buy = { ...place(2), s: 2 };
  const maxX = Math.max(LOTS_PER_ROW * LOT_W, ...lots.map(l => l.x + l.w), ...plots.map((p) => p.x + p.s), buy ? buy.x + 2 : 0);
  const maxY = Math.max(y + rowH, roadY + 4, ...lots.map(l => l.y + l.d));
  return { lots, plots, roadY, buy, maxX, maxY };
}
