// Create an isolated, playable chapter QA copy using actual game actions. Never overwrites input.
// Usage: node scripts/chapter-fixture.mjs /absolute/old-save.json docs/evidence/town-fixture.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'vite';
const [source, output] = process.argv.slice(2);
if(!source||!output||[output,`${output}.before-town.json`,`${output}.actions.json`].some(path=>resolve(source)===resolve(path)))throw new Error('Pass distinct source-save and output paths.');
const server=await createServer({logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {step,dispatch}=await server.ssrLoadModule('/src/simulation/engine.ts');
  const {parseSave}=await server.ssrLoadModule('/src/simulation/persistence.ts');
  const {population}=await server.ssrLoadModule('/src/simulation/community-state.ts');
  const {townOf,servicePrice}=await server.ssrLoadModule('/src/simulation/town-state.ts');
  const s=parseSave(await readFile(source,'utf8')).game,actions=[];
  const act=a=>{const result=dispatch(s,a);if(!result.ok)throw new Error(`${a.type}: ${result.error}`);actions.push({tick:s.tick,...a});};
  act({type:'startSettlement',charter:'free'});
  act({type:'buildHomes',tier:'cottage',count:25});
  for(let i=0;i<24*40&&population(s)<100;i++)step(s);
  if(population(s)<80||s.bankrupt)throw new Error('Community failed to establish.');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(`${output}.before-town.json`,JSON.stringify({version:s.version,savedAt:Date.now(),paused:true,game:s}));
  act({type:'startTown',charter:'public'});
  act({type:'fundTown',amount:Math.ceil(['school','well','clinic','road'].reduce((n,type)=>n+servicePrice(s,type),0)*2),direction:'toTown'});
  for(const service of ['school','well','clinic','road'])act({type:'buildService',service,district:'farmgate'});
  for(let i=0;i<120;i++)step(s);
  if(s.bankrupt||!townOf(s).services.every(b=>b.funded))throw new Error('Service QA copy failed to run.');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify({version:s.version,savedAt:Date.now(),paused:true,game:s}));
  await writeFile(`${output}.actions.json`,JSON.stringify({source,actions},null,2));
  console.log(JSON.stringify({output,people:population(s),treasury:townOf(s).cash,school:townOf(s).education,health:townOf(s).health}));
}finally{await server.close();}
