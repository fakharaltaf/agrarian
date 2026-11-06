import type { GameState } from '../types';
import { BUILDINGS } from '../config';

export const noStageAction = () => null;

export const lifetimeSales = (s: GameState) => (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);
export const totalHa = (s: GameState) => s.fields.reduce((n, f) => n + f.ha, 0);
export const factoryCount = (s: GameState) => s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').length;
