// Local-only audit: reads a save without editing it, seeds an isolated browser profile.
// Usage: node scripts/audit.mjs /absolute/save.json docs/evidence/before
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const [savePath, out = 'docs/evidence/audit'] = process.argv.slice(2);
const save = savePath === 'new' ? null : JSON.parse(await readFile(savePath, 'utf8'));
await mkdir(out, {recursive:true});
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4317','--strictPort'], {stdio:'pipe'});
let browser;
try {
  for(let i=0;i<100;i++){ try { if((await fetch('http://127.0.0.1:4317/agrarian/')).ok)break; }catch{} await new Promise(r=>setTimeout(r,100)); }
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const results=[];
  for(const width of [390,1400]) for(const theme of ['light','dark']) {
    const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme});
    await context.addInitScript(({save,theme})=>{
      if(!sessionStorage.getItem('audit-seeded')){
        if(save) localStorage.setItem('agrarian.auto',JSON.stringify({...save,savedAt:Date.now(),paused:true}));
        localStorage.setItem('agrarian.ui.theme',JSON.stringify(theme));
        localStorage.setItem('agrarian.ui.offline','false');
        localStorage.setItem('agrarian.ui.music','0');
        sessionStorage.setItem('audit-seeded','1');
      }
    },{save,theme});
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:4317/agrarian/');
    await page.getByRole('button',{name:save?'Continue your farm':'Start farming',exact:true}).click();
    for(const speed of save?[1,10,50]:[1]){
      await page.getByRole('radio',{name:`${speed}×`,exact:true}).click();
      await page.waitForTimeout(1500);
      await page.screenshot({path:`${out}/${width}-${theme}-${speed}x-farm.png`});
    }
    if(save){
      await page.getByRole('radio',{name:'❚❚',exact:true}).click();
      for(const section of ['production','research','equipment','automation','fields']){
        const nav=page.locator(`[data-coach="nav-${section}"]`);
        if(await nav.count()){
          await nav.click(); await page.waitForTimeout(350);
          await page.screenshot({path:`${out}/${width}-${theme}-${section}.png`});
        }
      }
    }
    results.push({width,theme,errors,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
    await context.close();
  }
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await browser?.close();server.kill();}
