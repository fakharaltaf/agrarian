import { it } from 'vitest';
// @ts-expect-error node builtin in tests only
import { writeFileSync } from 'node:fs';
import { createGame, step, dispatch } from '../simulation/engine';
import { post } from '../simulation/core';
import { botAct } from './bot';
// @ts-expect-error node global in tests only
const OUT: string = process.env.SAVE_DIR ?? '.';
(OUT !== '.' ? it : it.skip)('gen saves', () => {
  const s = createGame(77);
  const want = [2, 4, 6];
  for (let t = 0; t < 3600 * 12 && want.length; t++) {
    botAct(s, 'balanced'); step(s);
    if (want.length && s.era >= want[0]) {
      const e = want.shift()!;
      if (e === 6) {
        // late-game showcase: everything unlocked
        s.era = 8;
        for (const r of ['river', 'tropics', 'coastal'] as const) s.regions[r].unlocked = true;
        post(s, 'sharesIssued', 3e6, 'Showcase capital');
        dispatch(s, { type: 'incorporate' });
        dispatch(s, { type: 'build', region: 'heartland', building: 'lab' });
        dispatch(s, { type: 'build', region: 'heartland', building: 'warehouse' });
        dispatch(s, { type: 'build', region: 'heartland', building: 'flourMill' });
        dispatch(s, { type: 'build', region: 'heartland', building: 'ranch' });
        dispatch(s, { type: 'build', region: 'heartland', building: 'coldStore' });
        dispatch(s, { type: 'buyParcel', region: 'tropics', ha: 100 });
        dispatch(s, { type: 'hireExec', division: 'crops' });
        s.discovered.push('forecast', 'chickens', 'livestock', 'frost', 'quality', 'upgrades', 'perks', 'orchards', 'machineUpgrades');
        for (const [b, a, n] of [['coop', 'chickens', 80], ['pigsty', 'pigs', 30], ['cowshed', 'cows', 15], ['sheepfold', 'sheep', 40]] as const) {
          dispatch(s, { type: 'build', region: 'heartland', building: b });
          dispatch(s, { type: 'buyAnimals', region: 'heartland', animal: a, count: n });
        }
        s.unlockedCrops.push('apples', 'grapes');
        const orchard = s.fields.find((f) => f.ha === 5 && !f.crop) ?? s.fields.find((f) => f.ha === 5)!;
        orchard.crop = null; orchard.plan = null;
        dispatch(s, { type: 'plant', fieldId: s.fields[1].id, crop: 'wheat' });
        s.fields[2].crop = null;
        dispatch(s, { type: 'greenhouse', fieldIds: [s.fields[2].id] });
        s.research.done.push('farmSoftware', 'soilTesting', 'marketAI', 'agAI', 'solar', 'biogas');
        for (const b of ['feedMill', 'bakery', 'dairy', 'creamery', 'oilPress', 'solar'] as const) dispatch(s, { type: 'build', region: 'heartland', building: b });
        dispatch(s, { type: 'addRule', rule: { name: 'Sell wheat high', enabled: true, metric: 'price', region: 'heartland', good: 'wheat', op: '>', value: 3, action: 'sell', actionGood: 'wheat', actionRegion: 'heartland', amountPct: 25, priority: 5, maxSpend: 0, cooldown: 24 } });
        for (let i = 0; i < 24 * 20; i++) step(s);
      }
      writeFileSync(`${OUT}/era${s.era}.json`, JSON.stringify({ version: 2, savedAt: 0, game: s }));
      console.log('wrote era', s.era, 'tick', s.tick);
    }
  }
}, 1800000);
