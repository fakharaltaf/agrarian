import { runScenario, type ScenarioInput } from './scenario';
import type { GameState } from './types';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState; input: ScenarioInput }>) => {
  try {
    self.postMessage({ id: e.data.id, result: runScenario(e.data.state, e.data.input) });
  } catch (err) {
    self.postMessage({ id: e.data.id, error: (err as Error).message });
  }
};
