// Real-action balancing trace; never grants cash, goods, unlocks or population.
// Usage: node scripts/playthrough.mjs output.json [balanced|volume|town|city] [ticks] [source-root]
import{createServer}from'vite';import{writeFile,mkdir}from'node:fs/promises';import{dirname,resolve}from'node:path';
const [output,mode='balanced',limit='9000',root=process.cwd()]=process.argv.slice(2);
if(!output)throw new Error('Pass an evidence output path.');
const v=await createServer({root:resolve(root),logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {createGame,step}=await v.ssrLoadModule('/src/simulation/engine.ts');
 const {botAct,townBotAct,cityBotAct}=await v.ssrLoadModule('/src/tests/bot.ts');
 const {equity}=await v.ssrLoadModule('/src/simulation/core.ts');
 const {communityOf,population}=await v.ssrLoadModule('/src/simulation/community-state.ts');
 const {townOf}=await v.ssrLoadModule('/src/simulation/town-state.ts');
 const s=createGame(123),rows=[];
 for(let i=0;i<Number(limit);i++){
  if(mode==='city')cityBotAct(s);else if(mode==='town')townBotAct(s);else botAct(s,mode);
  step(s);
  if(i%500===0||i===Number(limit)-1){const c=communityOf(s),t=townOf(s);rows.push(structuredClone({elapsed:i+1,tick:s.tick,stage:s.stageId,cash:s.cash,equity:equity(s),people:population(s),housing:c.homes.reduce((n,h)=>n+h.count,0),fed:c.fed,happiness:c.happiness,public:t.cash,publicCost:t.lastCost,workers:s.workers.length,land:s.fields.reduce((n,f)=>n+f.ha,0),bankrupt:s.bankrupt,homes:c.homes,education:t.education,water:t.water,services:t.services,city:s.stageState.city,lifetime:s.lifetime}));}
 }
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({mode,root:resolve(root),rows},null,2));console.log(JSON.stringify(rows.at(-1)));
}finally{await v.close();}
