// Every page must render for any building a player can own — a crash here blanks the whole game.
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BUILDINGS, REGION_IDS, type BuildingType } from '../simulation/config';
import { createGame, step } from '../simulation/engine';
import type { GameState } from '../simulation/types';
import { emptyProductionReport } from '../simulation/production-report';
import { communityOf } from '../simulation/community-state';
import { townOf } from '../simulation/town-state';
import { cityOf } from '../simulation/city-state';
import { regionOf } from '../simulation/region-state';

let game: GameState;
vi.mock('../stores/game', () => ({ act: () => null, go: () => {}, useGame: () => game, getGame: () => game, getSpeed: () => 1, usePageState: () => 'farm', useStore: (f: (s: unknown) => unknown) => f({ game, v: 0, speed: 1, page: 'farm', toasts: [] }) }));
vi.mock('../app/world/portrait', () => ({ portrait: () => '' }));

const PAGES = ['Analytics', 'Automation', 'Competitors', 'Corporation', 'Equipment', 'Fields', 'Finance', 'Livestock', 'Logistics', 'Markets', 'Overview', 'Policy', 'Production', 'Research', 'Storage', 'Workers', 'World', 'Community', 'Town', 'City', 'Region'];

describe('pages', () => {
  it('every page renders in a late game with every building type, running and paused, in every region', async () => {
    game = createGame(7);
    game.era = 8;
    for (const r of REGION_IDS) game.regions[r].unlocked = true;
    const tpl = { level: 1, active: true, util: 0, reason: '', stats: { out: 0, inCost: 0, outValue: 0, opCost: 0 } };
    let id = 1e6;
    for (const t of Object.keys(BUILDINGS) as BuildingType[])
      for (const r of REGION_IDS) for (const active of [true, false]) game.buildings.push({ ...structuredClone(tpl), productionReport: emptyProductionReport(), id: id++, type: t, region: r, active } as never);
    const c = communityOf(game); c.active = true; c.charter = 'free'; c.cohorts = [{ id: 9e6, name: 'Families', households: 100, adults: 200, children: 200 }]; c.homes = [{ id: 9e6 + 1, tier: 'cottage', count: 100, cost: 3e5 }];
    const t = townOf(game); t.active = true; t.charter = 'public'; t.cash = 1e6;
    const v = cityOf(game); v.active = true; v.charter = 'watch';
    const g = regionOf(game); g.active = true; g.border = 'walls'; g.neighbours.river.route = { good: 'wheat', qty: 100 };
    for (const service of ['school', 'sanitation', 'police', 'watchtower'] as const) t.services.push({ id: 9e6 + 2 + t.services.length, type: service, district: 'farmgate', count: 1, cost: 1e4, active: true, staffed: 0, funded: false });
    for (let i = 0; i < 30; i++) step(game);
    g.raid = { id: 1, to: 'arid', good: 'wheat', lost: 50, opened: game.tick, deadline: game.tick + 72 };
    g.demand = { from: 'tropics', amount: 1e5, opened: game.tick, deadline: game.tick + 336 };
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
