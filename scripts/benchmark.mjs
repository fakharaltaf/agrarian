// Read-only simulation benchmark. Usage: node scripts/benchmark.mjs save.json [source-root] [settlement]
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const [savePath, source = process.cwd(), mode] = process.argv.slice(2);
if (!savePath) throw new Error('Pass a save file. The original file is only read.');
const server = await createServer({ root: resolve(source), logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { step, dispatch } = await server.ssrLoadModule('/src/simulation/engine.ts');
  const { parseSave } = await server.ssrLoadModule('/src/simulation/persistence.ts');
  const template = parseSave(await readFile(savePath, 'utf8')).game;
  if (mode === 'settlement') {
    for (const action of [{type:'startSettlement',charter:'free'},{type:'buildHomes',tier:'cottage',count:10}]) {
      const result = dispatch(template, action); if (!result?.ok) throw new Error(result?.error ?? 'Settlement unavailable in this source tree.');
    }
  }
  const trials=[];
  for(let trial=0;trial<4;trial++) {
    const s=structuredClone(template), tick=s.tick;
    const begin=performance.now();for(let n=0;n<720;n++)step(s);
    const elapsed=performance.now()-begin;
    if(s.tick-tick!==720)throw new Error('Simulation halted; do not report no-op calls as simulated ticks.');
    if(trial)trials.push(720000/elapsed); // first run warms the engine; cloning and IO are unmeasured
  }
  const sorted=[...trials].sort((a,b)=>a-b);
  console.log(JSON.stringify({source:resolve(source),mode:mode??'existing-business',ticksPerTrial:720,trials,medianTicksPerSecond:sorted[1]},null,2));
} finally { await server.close(); }
