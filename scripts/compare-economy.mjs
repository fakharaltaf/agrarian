// Independent-process economic comparison; Vite SSR servers must not share a module cache.
// Usage: node scripts/compare-economy.mjs baseline-root save-dir output.json [candidate-root]
// COMPARE_ECONOMIC_CHANGE=1 records intentional rule changes instead of requiring equivalence.
import {createServer} from 'vite';
import {readFile,writeFile,mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
if(process.argv[2]==='--run') {
 const [,root,input,output]=process.argv.slice(2);
 const v=await createServer({root:resolve(root),logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 try {
  const {step,dispatch}=await v.ssrLoadModule('/src/simulation/engine.ts');
  const {parseSave}=await v.ssrLoadModule('/src/simulation/persistence.ts');
  const {BUILDINGS,OPEX_KINDS}=await v.ssrLoadModule('/src/simulation/config.ts');
  const s=parseSave(await readFile(input,'utf8')).game,start=s.tick,cash=s.cash,lifetime=structuredClone(s.lifetime);let restructures=0;
  const {lineEcon}=await v.ssrLoadModule('/src/simulation/lines.ts');
  let report;
  try{await access(resolve(root,'src/simulation/production-report.ts'));report=(await v.ssrLoadModule('/src/simulation/production-report.ts')).productionReport;}catch(error){if(error.code!=='ENOENT')throw error;}
  const signs=new Map(),tones=new Map(),visible=new Map(),prices=Object.fromEntries(['wheat','corn','flour','feed','bread'].map(g=>[g,[]]));
  let rawFlips=0,reportedFlips=0,transitions=0;
  const observe=()=>{
    for(const g of Object.keys(prices))prices[g].push(s.markets.heartland[g].price);
    const groups=new Map();for(const b of s.buildings)if(BUILDINGS[b.type].recipe){const key=b.type+':'+b.region;groups.set(key,[...(groups.get(key)||[]),b]);}
    for(const[key,list]of groups){
      const raw=lineEcon(s,list).worth>=0?'up':'down';
      if(signs.has(key)&&signs.get(key)!==raw)rawFlips++;signs.set(key,raw);
      const tone=report?report(list).tone:raw;
      if(visible.has(key)&&visible.get(key)!==tone)transitions++;visible.set(key,tone);
      if(tone!=='neutral'){if(tones.has(key)&&tones.get(key)!==tone)reportedFlips++;tones.set(key,tone);}
    }
  };

  for(let i=0;i<720;i++){if(s.bankrupt){const result=dispatch(s,{type:'restructure'});if(!result.ok)throw new Error(`Recovery failed: ${result.error}`);restructures++;}step(s);observe();}
  if(s.tick-start!==720)throw new Error('Did not complete720 actual ticks.');
  const delta=k=>(s.lifetime[k]??0)-(lifetime[k]??0),sales=delta('sale')+delta('contract');
  const volatility=Object.fromEntries(Object.entries(prices).map(([g,values])=>{const mean=values.reduce((n,p)=>n+p,0)/values.length;return[g,{min:Math.min(...values),max:Math.max(...values),cv:Math.sqrt(values.reduce((n,p)=>n+(p-mean)**2,0)/values.length)/mean}];}));
  await writeFile(output,JSON.stringify({state:s,categories:Object.fromEntries(Object.entries(BUILDINGS).map(([id,d])=>[id,{category:d.category,recipe:!!d.recipe}])),metrics:{sales,operatingProfitExcludingFinesAndTax:sales+OPEX_KINDS.filter(k=>k!=='fines').reduce((n,k)=>n+delta(k),0),cashDelta:s.cash-cash,rawSignReversalsPerDay:rawFlips/30,reportedProfitLossReversalsPerDay:reportedFlips/30,statusTransitionsPerDay:transitions/30,volatility,purchases:delta('purchases'),haulage:delta('haulage'),restructures}}));
 }finally{await v.close();}
} else {
 const [baseline,saveDir,output,candidate=process.cwd()]=process.argv.slice(2);
 if(!baseline||!saveDir||!output)throw new Error('Pass baseline root, save directory and output.');
 const names=['year10-day4-repaired','year35-day52','year55-day118','year125-day22'];
 if(names.some(n=>resolve(output)===resolve(saveDir,`agrarian-${n}.json`)))throw new Error('Output must not overwrite a source save.');
 const dir=await mkdtemp(resolve(tmpdir(),'agrarian-economy-')),run=promisify(execFile),results=[];
 const comparable=({state:s,categories})=>{
  const copy=structuredClone(s);delete copy.version;
  if(copy.stageState?.city&&(copy.stageState.city.active===false||Object.keys(copy.stageState.city).length===0))delete copy.stageState.city;
  for(const c of copy.competitors){delete c.payrollDay;delete c.payrollToday;}
  for(const r of Object.values(copy.regions))if(r.retailToday&&Object.keys(r.retailToday).length===0)delete r.retailToday;
  for(const b of copy.buildings){delete b.productionReport;const d=categories[b.type];if(!d.recipe&&(d.category==='energy'||d.category==='commerce')){delete b.util;delete b.reason;}}
  return copy;
 };
 try {
  for(const name of names) {
   const states=[];
   for(const [index,root]of[baseline,candidate].entries()) {
    const temp=resolve(dir,`${name}-${index}.json`);
    await run(process.execPath,[fileURLToPath(import.meta.url),'--run',root,resolve(saveDir,`agrarian-${name}.json`),temp],{maxBuffer:4*1024*1024});
    states.push(JSON.parse(await readFile(temp,'utf8')));
   }
   const [before,after]=states,[a,b]=states.map(comparable),keys=Object.keys(a).filter(k=>!isDeepStrictEqual(a[k],b[k]));
   const item={name,simulatedTicks:720,sourceRoots:[resolve(baseline),resolve(candidate)],loadedVersions:states.map(s=>s.state.version),economicallyIdentical:keys.length===0,differenceKeys:keys,before:before.metrics,after:after.metrics};
   results.push(item);
   if(keys.length&&!process.env.COMPARE_ECONOMIC_CHANGE)throw new Error(`${name}: economic state differs in ${keys.join(', ')}`);
  }
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{await rm(dir,{recursive:true,force:true});}
}
