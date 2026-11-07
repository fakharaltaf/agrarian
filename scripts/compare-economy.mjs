// Compare identical real-save actions before/after a reporting-only change.
// Usage: node scripts/compare-economy.mjs baseline-root save-dir output.json
import { createServer } from 'vite';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const [baselineRoot,saveDir,output]=process.argv.slice(2);
if(!baselineRoot||!saveDir||!output)throw new Error('Pass baseline root, save directory and report output.');
const names=['year10-day4-repaired','year35-day52','year55-day118','year125-day22'];
if(names.some(n=>resolve(output)===resolve(saveDir,`agrarian-${n}.json`)))throw new Error('Output must not overwrite a source save.');
const make=root=>createServer({root:resolve(root),logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const servers=await Promise.all([make(baselineRoot),make(process.cwd())]);
try {
 const modules=await Promise.all(servers.map(async v=>({engine:await v.ssrLoadModule('/src/simulation/engine.ts'),persistence:await v.ssrLoadModule('/src/simulation/persistence.ts'),config:await v.ssrLoadModule('/src/simulation/config.ts')})));
 const comparable=(s,config)=>{const copy=JSON.parse(JSON.stringify(s));delete copy.version;for(const b of copy.buildings){delete b.productionReport;const def=config.BUILDINGS[b.type];if(!def.recipe&&(def.category==='energy'||def.category==='commerce')){delete b.util;delete b.reason;}}return copy;};
 const results=[];
 for(const name of names){
  const text=await readFile(resolve(saveDir,`agrarian-${name}.json`),'utf8');
  const runs=modules.map(m=>({s:m.persistence.parseSave(text).game,m,restructures:0}));
  const tick=runs[0].s.tick;
  for(let i=0;i<720;i++)for(const run of runs){if(run.s.bankrupt){const result=run.m.engine.dispatch(run.s,{type:'restructure'});if(!result.ok)throw new Error(`Recovery failed: ${name}`);run.restructures++;}run.m.engine.step(run.s);}
  const [before,after]=runs;
  if(!isDeepStrictEqual(comparable(before.s,before.m.config),comparable(after.s,after.m.config))){
   const a=comparable(before.s,before.m.config),b=comparable(after.s,after.m.config),keys=Object.keys(a).filter(k=>!isDeepStrictEqual(a[k],b[k]));throw new Error(`Economic state differs for ${name}: ${keys.join(', ')}`);
  }
  if(before.s.tick-tick!==720||after.s.tick-tick!==720)throw new Error(`${name} did not complete 720 actual ticks.`);
  results.push({name,simulatedTicks:720,restructures:after.restructures,cash:after.s.cash,economicallyIdentical:true,excluded:['save version','new production reports','corrected non-recipe utilisation/status display']});
 }
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await Promise.all(servers.map(v=>v.close()));}
