# AGRARIAN

From a single field to a global agricultural empire — an incremental farming and economic strategy game
that runs entirely in the browser.

**Play it:** https://fakharaltaf.github.io/agrarian/

## Run it

```bash
npm install
npm run dev        # play at http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
npm test           # simulation rule tests
```

Balance reports (slow, print-only): `BALANCE=1 npx vitest run src/tests/pace.test.ts` or `src/tests/late.test.ts`.

## What's in the game

Eight eras, each solving a problem the previous one created. When you qualify for the next era an
**Advance** button appears with a preview — you choose when to move on. Within each era new mechanics are
**discovered** one at a time (frost, chickens, crop quality, upgrades, specialists, orchards…) with a short
explanation at the moment they become relevant.

1. **Homestead** — plant, harvest and sell by hand; prices respond to your sales.
2. **Farm business** — workers (wages, skill, morale, specialist perks), storage & spoilage, soil, rotation, fertiliser,
   irrigation, a four-day weather forecast, frost nights and greenhouses, crop quality grades, livestock (chickens,
   pigs, sheep; feed, health, breeding), building upgrades, books.
3. **Mechanization** — tractors, harvesters, trucks (upgradeable tiers); fuel, wear, breakdowns, depreciation; leasing,
   bank loans, land parcels, managers and automation policies; dairy cows; orchards and vineyards.
4. **Industry** — mills, bakeries, ranches, dairies, creameries, presses, sugar mills, energy (solar, biogas), research, logistics.
5. **Markets & finance** — commodity exchange, futures with margin, supply contracts, crop insurance, full financial statements, analytics.
6. **Regional expansion** — five regions with their own climate, soil, wages, taxes, tariffs and currencies; shipping; scenario planner.
7. **Corporation** — incorporation, division heads, shares, dividends, acquisitions with due diligence, antitrust.
8. **Global food system** — climate trends, global market share, long-term milestones.

A first-time guide points at the real controls as each system becomes relevant (Settings → replay or turn off).

## Architecture

- `src/simulation/` — pure, deterministic TypeScript engine (no React). Seeded RNG state lives in the save,
  so the same seed and actions always replay identically, at any speed.
  - `core.ts` ledger (`post()` is the only way cash changes), lookups, storage
  - `markets.ts` inventory-driven prices, elastic demand, substitution, regional arbitrage, order-book impact, macro (inflation, rates, energy, FX, weather, climate)
  - `agriculture.ts` fields, soil, water, pests, yield model with breakdowns, storage overflow & spoilage
  - `operations.ts` labour scheduling, wages, morale, machines · `processing.ts` factories & energy
  - `finance.ts` loans, overdraft, insolvency/restructuring, futures, contracts, insurance, tax
  - `automation.ts` manager policies and if/then rules · `research.ts` · `logistics.ts` · `competitors.ts` (AI companies) · `events.ts` · `corporate.ts` · `progression.ts` (eras, objectives, milestones) · `statements.ts` · `scenario.ts` (+ Web Worker)
  - `config.ts` every balancing number
- `src/stores/game.ts` — game loop, IndexedDB saves (autosave + 3 slots), export/import with validation, save versioning/migration, offline catch-up (capped at 6 hours, chunked).
- `src/app/world/` — the 3D farm: `Scene3D.tsx` (three.js renderer: orthographic isometric camera, sun/moon and
  shadows, seasons, rain/snow, instanced crops, live workers/machines/trucks/animals, picking, HTML labels),
  `models.ts` (stylised low-poly models built in code), `layout.ts` (deterministic placement), `Hud.tsx` (panels over the farm).
- `src/app/` — React UI: shell, first-time guide (`Coach.tsx`), UI kit (`ui.tsx`), charts, and one page per file in `pages/`
  (opened as drawers over the farm).

## Graphics

All models are generated in code (`src/app/world/models.ts`) in one shared palette, so the style is consistent and
no art files are needed. Settings → Graphics → Low turns off shadows and high-DPI rendering for slower machines.
Controls: drag to move, scroll/pinch to zoom, Q/E to rotate, click fields and buildings.

## Not yet included

Payments/accounts (planned), cloud saves, sound, localisation.
