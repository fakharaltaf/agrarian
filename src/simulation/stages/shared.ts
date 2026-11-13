import type { GameState } from '../types';
import { BUILDINGS } from '../config';

export const noStageAction = () => null;

export const lifetimeSales = (s: GameState) => (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0);
export const totalHa = (s: GameState) => s.fields.reduce((n, f) => n + f.ha, 0);
/** Food production houses actually at work: running, with a road, and busy at least a quarter of the time. */
export const workingFactories = (s: GameState) => s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing' && b.type !== 'oilWell' && b.type !== 'refinery' && b.active && b.util >= 0.25).length;
export const factoryCount = (s: GameState) => s.buildings.filter((b) => BUILDINGS[b.type].category === 'processing').length;
