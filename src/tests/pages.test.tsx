// Every page must render for any building a player can own — a crash here blanks the whole game.
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BUILDINGS, REGION_IDS, type BuildingType } from '../simulation/config';
import { createGame, step } from '../simulation/engine';
import type { GameState } from '../simulation/types';

let game: GameState;
vi.mock('../stores/game', () => ({ act: () => null, go: () => {}, useGame: () => game, getGame: () => game, getSpeed: () => 1, usePageState: () => 'farm', useStore: (f: (s: unknown) => unknown) => f({ game, v: 0, speed: 1, page: 'farm', toasts: [] }) }));
vi.mock('../app/world/portrait', () => ({ portrait: () => '' }));

const PAGES = ['Analytics', 'Automation', 'Competitors', 'Corporation', 'Equipment', 'Fields', 'Finance', 'Livestock', 'Logistics', 'Markets', 'Overview', 'Policy', 'Production', 'Research', 'Storage', 'Workers', 'World'];

describe('pages', () => {
  it('every page renders in a late game with every building type, running and paused, in every region', async () => {
    game = createGame(7);
    game.era = 8;
    for (const r of REGION_IDS) game.regions[r].unlocked = true;
    const tpl = { level: 1, active: true, util: 0, reason: '', stats: { out: 0, inCost: 0, outValue: 0, opCost: 0 } };
    let id = 1e6;
    for (const t of Object.keys(BUILDINGS) as BuildingType[])
      for (const r of REGION_IDS) for (const active of [true, false]) game.buildings.push({ ...structuredClone(tpl), id: id++, type: t, region: r, active } as never);
    for (let i = 0; i < 30; i++) step(game);
    const failed: string[] = [];
    for (const name of PAGES) {
      const mod = await import(`../app/pages/${name}.tsx`);
      const Page = mod.default ?? mod[`${name}Page`];
      try { renderToString(<Page />); } catch (e) { failed.push(`${name}: ${(e as Error).stack?.split("\n").slice(0, 3).join(" / ")}`); }
    }
    expect(failed).toEqual([]);
    const { default: Production } = await import('../app/pages/Production');
    const html = renderToString(<Production />);
    expect(html).toContain('Vertical farm');
    expect(html).toContain('Biogas plant');
  });
});
