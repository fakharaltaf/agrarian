// Read-only colour stability comparison using actual completed-day reports.
// Usage: node scripts/production-signals.mjs save.json output.json
import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [input,output]=process.argv.slice(2);
if(!input||!output||resolve(input)===resolve(output))throw new Error('Provide distinct input save and evidence paths.');
const server=await createServer({logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
 const {parseSave}=await server.ssrLoadModule('/src/simulation/persistence.ts');
 const {step,dispatch}=await server.ssrLoadModule('/src/simulation/engine.ts');
 const {BUILDINGS}=await server.ssrLoadModule('/src/simulation/config.ts');
 const {lineEcon}=await server.ssrLoadModule('/src/simulation/lines.ts');
 const {productionReport}=await server.ssrLoadModule('/src/simulation/production-report.ts');
 const s=parseSave(await readFile(input,'utf8')).game,start=s.tick;
 const groups=[...new Set(s.buildings.filter(b=>BUILDINGS[b.type].recipe).map(b=>`${b.type}:${b.region}`))].map(key=>({key,list:s.buildings.filter(b=>`${b.type}:${b.region}`===key),rawFlips:0,reportChanges:0,reportSignFlips:0,raw:null,tone:null,lastSign:null}));
 for(let i=0;i<720;i++) {
  if(s.bankrupt&&!dispatch(s,{type:'restructure'}).ok)throw new Error('Recovery unavailable.');
  step(s);
  for(const g of groups){
   const positive=lineEcon(s,g.list).worth>=0,r=productionReport(g.list);
   if(g.raw!==null&&g.raw!==positive)g.rawFlips++;g.raw=positive;
   if(g.tone!==null&&g.tone!==r.tone)g.reportChanges++;g.tone=r.tone;
   if(r.tone!=='neutral'){if(g.lastSign!==null&&g.lastSign!==r.tone)g.reportSignFlips++;g.lastSign=r.tone;}
  }
 }
 if(s.tick-start!==720)throw new Error('Did not run thirty full days.');
 const rows=groups.map(({key,rawFlips,reportChanges,reportSignFlips})=>({key,rawFlips,rawFlipsPerDay:rawFlips/30,reportChanges,reportChangesPerDay:reportChanges/30,reportSignFlips}));
 await writeFile(output,JSON.stringify({ticks:720,rows},null,2));console.log(JSON.stringify(rows));
}finally{await server.close();}
