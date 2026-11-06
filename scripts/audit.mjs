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
  for(const width of (process.env.AUDIT_WIDTHS?.split(',').map(Number) ?? [390,1400])) for(const theme of (process.env.AUDIT_THEMES?.split(',') ?? ['light','dark'])) {
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
    await page.waitForFunction(()=>document.querySelector('.world-canvas')?.dataset.art==='9',undefined,{timeout:20000});
    if(!save){
      await page.locator('[data-action^="plant:"]').click();
      await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-first-plant.png`});
      await page.locator('[data-action^="harvest:"]').waitFor({state:'visible',timeout:45000});
      await page.locator('[data-action^="harvest:"]').click();
      await page.getByRole('button',{name:'Show panel',exact:true}).click();
      await page.getByRole('button',{name:/^Sell [0-9]/}).first().click();
      await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-first-sale.png`});
      await page.getByRole('button',{name:'Hide panel',exact:true}).click();
    }
    for(const speed of (process.env.AUDIT_SPEEDS?.split(',').map(Number) ?? (save?[1,10,50]:[1]))){
      if(save) { await page.getByRole('button',{name:'Time controls',exact:true}).click(); await page.getByRole('radio',{name:`${speed}×`,exact:true}).click(); }
      await page.waitForTimeout(1500);
      await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${speed}x-farm.png`});
    }
    if(save){
      // Restore the same starting point for layout captures; high-speed events are recorded above.
      await page.evaluate(async save => {
        const value=JSON.stringify({...save,savedAt:Date.now(),paused:true});
        localStorage.setItem('agrarian.auto',value);
        await new Promise((resolve,reject)=>{ const r=indexedDB.open('agrarian',1); r.onsuccess=()=>{const db=r.result;const t=db.transaction('saves','readwrite');t.objectStore('saves').put(value,'auto');t.oncomplete=()=>{db.close();resolve();};t.onerror=reject;};r.onerror=reject;});
      },save);
      await page.reload();
      await page.getByRole('button',{name:'Continue your farm',exact:true}).click();
      if(await page.getByRole('button',{name:'Pause simulation',exact:true}).count()) await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
      for(const section of (process.env.AUDIT_SECTIONS?.split(',') ?? ['production','research','equipment','automation','fields'])){
        await page.getByRole('button',{name:'Ledger',exact:true}).click();
        const nav=page.locator(`[data-coach="nav-${section}"]`);
        if(await nav.count()){
          await nav.click(); await page.locator('.page-drawer .card').first().waitFor({state:'visible'});
          await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${section}.png`});
          if(section==='equipment'){const idle=page.getByRole('heading',{name:'Idle fleet',exact:false});if(await idle.count()){await idle.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-idle-fleet.png`});}}
        } else { await page.keyboard.press('Escape'); await page.getByRole('dialog',{name:'Ledger',exact:true}).waitFor({state:'hidden'}); }
      }
    }
    results.push({width,theme,errors,assets:await page.locator('.world-canvas').getAttribute('data-art'),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
    await context.close();
  }
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await browser?.close();server.kill();}
