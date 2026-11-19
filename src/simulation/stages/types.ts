import type { Action, ActionResult, GameState } from '../types';

/** Public, persistent ids. Never serialize an array index or stage number. */
export const STAGE_IDS = ['homestead', 'market-town', 'farm-business', 'industry', 'settlement', 'town', 'city', 'region', 'nation', 'frontier'] as const;
export type StageId = (typeof STAGE_IDS)[number];

export interface StageModule {
  readonly id: StageId;
  readonly title: string;
  /** Legacy era identities currently represented by this stage, if any. */
  readonly legacyEras: readonly number[];
  /** Unlock rules keyed by the legacy era being entered. */
  readonly eraUnlocks: Readonly<Partial<Record<number, (s: GameState) => boolean>>>;
  /** Legacy action ownership index; the engine's established action switch remains authoritative in this refactor. */
  readonly actionTypes: readonly Action['type'][];
  readonly tips: readonly string[];
  readonly discoveries: readonly string[];
  /** Stage hook. Systems move here as each content slice is built. */
  tick(s: GameState, state: Record<string, unknown>): void;
  handleAction(s: GameState, action: Action, state: Record<string, unknown>): ActionResult | null;
  createState(): Record<string, unknown>;
}
