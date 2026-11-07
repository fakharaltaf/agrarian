// Read-only source save -> isolated production QA copy. Every building uses real dispatch.
// Usage: node scripts/production-fixture.mjs save.json output.json [ports] [source-root]
import { createServer } from 'vite';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
const [source,output,mode,root=process.cwd()]=process.argv.slice(2);
if(!source||!output||[output,`${output}.actions.json`].some(p=>resolve(p)===resolve(source)))throw new Error('Pass distinct source and output paths.');
const server=await createServer({root:resolve(root),logLevel:'silent',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {parseSave}=await server.ssrLoadModule('/src/simulation/persistence.ts'),{dispatch,step}=await server.ssrLoadModule('/src/simulation/engine.ts');
  const s=parseSave(await readFile(source,'utf8')).game,actions=[];
  if(mode==='ports')for(const building of ['biogas','verticalFarm','solar','distribution']){
    const action={type:'build',region:'heartland',building},result=dispatch(s,action);actions.push({tick:s.tick,action,result});
    if(!result.ok&&(building==='biogas'||building==='verticalFarm'))throw new Error(`Required power-port fixture: ${result.error}`);
  }
  const tick=s.tick;for(let i=0;i<24*10;i++)step(s);
  if(s.tick-tick!==240)throw new Error('QA scenario stopped before ten days.');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({version:s.version,savedAt:Date.now(),paused:true,game:s}));
  await writeFile(`${output}.actions.json`,JSON.stringify({source,root,actions,simulatedTicks:240},null,2));
  console.log(JSON.stringify({output,version:s.version,simulatedTicks:240,buildActions:actions}));
}finally{await server.close();}
