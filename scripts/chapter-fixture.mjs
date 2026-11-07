// Create an isolated, playable chapter QA copy using actual game actions. Never overwrites input.
// Usage: node scripts/chapter-fixture.mjs /absolute/old-save.json docs/evidence/town-fixture.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'vite';
const [source, output, mode] = process.argv.slice(2);
if(!source||!output||[output,`${output}.before-town.json`,`${output}.actions.json`,`${output}.before-city.json`].some(path=>resolve(source)===resolve(path)))throw new Error('Pass distinct source-save and output paths.');
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
  if(mode==='city'){
    const {cityOf}=await server.ssrLoadModule('/src/simulation/city-state.ts');
    const {districtPopulation,SERVICE_DEFS}=await server.ssrLoadModule('/src/simulation/town-state.ts');
    const {plannedServiceCost,serviceDailyCost}=await server.ssrLoadModule('/src/simulation/stages/town.ts');
    const {canStartCity}=await server.ssrLoadModule('/src/simulation/stages/city.ts');
    act({type:'buildHomes',tier:'terrace',count:20});
    for(let i=0;i<24*240&&!canStartCity(s);i++){
      if(s.tick%24===0){
        const pop=districtPopulation(s),t=townOf(s);
        for(const district of Object.keys(pop))if(pop[district])for(const service of ['school','well','clinic','road']){
          const cap=t.services.filter(b=>b.type===service&&b.district===district).reduce((n,b)=>n+b.count*SERVICE_DEFS[service].capacity,0);
          if(cap>=(service==='school'?pop[district]/2:service==='road'?1:pop[district]))continue;
          const needed=servicePrice(s,service)+serviceDailyCost(s,service)*14;
          if(t.cash<needed)act({type:'fundTown',amount:Math.ceil(needed-t.cash),direction:'toTown'});
          act({type:'buildService',service,district});
        }
        const need=plannedServiceCost(s)*14;
        if(t.cash<need)act({type:'fundTown',amount:Math.ceil(need-t.cash),direction:'toTown'});
      }
      step(s);
    }
    if(!canStartCity(s))throw new Error('Town did not qualify for the optional City chapter.');
    await writeFile(`${output}.before-city.json`,JSON.stringify({version:s.version,savedAt:Date.now(),paused:true,game:s}));
    act({type:'startCity',charter:'professional'});
    const pop=districtPopulation(s),t=townOf(s);
    const need=Object.values(pop).filter(n=>n>0).length*['sanitation','lighting','police'].reduce((n,type)=>n+servicePrice(s,type)+serviceDailyCost(s,type)*30,0);
    if(t.cash<need)act({type:'fundTown',amount:Math.ceil(need-t.cash),direction:'toTown'});
    for(const district of Object.keys(pop))if(pop[district])for(const service of ['sanitation','lighting','police'])act({type:'buildService',service,district});
    for(let i=0;i<24*7;i++)step(s);
    if(!cityOf(s).active||cityOf(s).sanitation<.9)throw new Error('City copy has no working utilities.');
  }
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify({version:s.version,savedAt:Date.now(),paused:true,game:s}));
  await writeFile(`${output}.actions.json`,JSON.stringify({source,actions},null,2));
  console.log(JSON.stringify({output,people:population(s),treasury:townOf(s).cash,school:townOf(s).education,health:townOf(s).health}));
}finally{await server.close();}
