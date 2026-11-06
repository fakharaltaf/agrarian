// Local-only audit: reads a save without editing it, seeds an isolated browser profile.
// Usage: node scripts/audit.mjs /absolute/save.json docs/evidence/before
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const [savePath, out = 'docs/evidence/audit'] = process.argv.slice(2);
const save = savePath === 'new' ? null : JSON.parse(await readFile(savePath, 'utf8'));
await mkdir(out, {recursive:true});
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4317','--strictPort'], {stdio:'pipe'});
async function resolveAuditDialogs(page, prefix) {
  for(let n=0;n<20;n++) {
    const probe=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/^Antitrust probe:/})});
    if(await probe.count()) {
      await page.screenshot({animations:'disabled',path:`${prefix}-probe-${n}.png`});
      // This is an isolated test save: follow the game's cautious default through its real UI.
      await probe.getByRole('button',{name:/^Settle/}).click();continue;
    }
    const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/^New:/})});
    if(!await dialog.count())break;
    await page.screenshot({animations:'disabled',path:`${prefix}-discovery-${n}.png`});
    await dialog.getByRole('button',{name:'Got it',exact:true}).click();
  }
}
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
    await resolveAuditDialogs(page,`${out}/${width}-${theme}-entry`);
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
    const testedSpeeds=process.env.AUDIT_SPEEDS?.split(',').map(Number) ?? (save?[1,10,50]:[1]);
    for(const speed of testedSpeeds){
      if(save) { await page.getByRole('button',{name:'Time controls',exact:true}).click(); await page.getByRole('radio',{name:`${speed}×`,exact:true}).click(); }
      await page.waitForTimeout(1500);
      if(save && await page.getByRole('button',{name:'Pause simulation',exact:true}).count())await page.keyboard.press('Space');
      await resolveAuditDialogs(page,`${out}/${width}-${theme}-${speed}x`);
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
      await resolveAuditDialogs(page,`${out}/${width}-${theme}-reset`);
      if(await page.getByRole('button',{name:'Pause simulation',exact:true}).count()) await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
      for(const section of (process.env.AUDIT_SECTIONS?.split(',') ?? ['production','research','equipment','automation','fields'])){
        await page.getByRole('button',{name:'Ledger',exact:true}).click();
        const nav=page.locator(`[data-coach="nav-${section}"]`);
        if(await nav.count()){
          await nav.click(); await page.locator('.page-drawer .page-head, .page-drawer .card, .modal .charter-grid').first().waitFor({state:'visible'});
          await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${section}.png`});
          if(section==='community' && process.env.AUDIT_COMMUNITY) {
            const found=page.getByRole('button',{name:'Found free settlement',exact:true});
            if(await found.count())await found.click();
            await page.locator('.community-next').click();
            await page.getByRole('button',{name:'Time controls',exact:true}).click();
            await page.getByRole('radio',{name:'50×',exact:true}).click();
            await page.waitForTimeout(1800);
            // Space is the game's documented pause control and also works over notifications.
            await page.keyboard.press('Space');
            await resolveAuditDialogs(page,`${out}/${width}-${theme}-families`);
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-community-grown.png`});
            await page.getByRole('button',{name:'Back to the farm (Esc)',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-homes-world.png`});
            await page.getByRole('button',{name:'Ledger',exact:true}).click();
            await page.locator('[data-coach="nav-workers"]').click();
            const hire=page.locator('[data-coach="hire-btn"]');
            await hire.scrollIntoViewIfNeeded();await hire.click();await hire.click();
            if(!await hire.isDisabled())throw new Error('Hiring must stop when both resident adults have jobs.');
            await page.waitForTimeout(3200);
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-local-hiring.png`});
          }
          if(section==='town') {
            const choose=page.getByRole('button',{name:'Choose Public',exact:true});
            if(await choose.count()) {
              await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-town-charter.png`});
              await choose.click();await page.locator('[data-coach=town-fund]').click();await page.locator('[data-coach=town-fund]').click();
            }
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-town-services.png`});
            await page.locator('.town-budget').first().locator(':scope > summary').click();
            await page.locator('.town-budget').first().scrollIntoViewIfNeeded();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-town-budget.png`});
            const grip=page.locator('.sheet-grip');await grip.scrollIntoViewIfNeeded();
            const box=await grip.boundingBox();if(!box)throw new Error('Town sheet grip missing.');
            await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+80,{steps:8});await page.mouse.up();
            await page.locator('.page-drawer').waitFor({state:'hidden'});
            if(await page.locator('[data-k=place-act]').count()&&await page.locator('[data-k=act]').count())throw new Error('Field and building radial menus must never show together.');
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-town-world.png`});
          }
          if(section==='overview'){const frontier=page.getByRole('heading',{name:/Frontier/});if(await frontier.count()){await frontier.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-frontier.png`});}}
          if(section==='equipment'){const idle=page.getByRole('heading',{name:'Idle fleet',exact:false});if(await idle.count()){await idle.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-idle-fleet.png`});}}
        } else { await page.keyboard.press('Escape'); await page.getByRole('dialog',{name:'Ledger',exact:true}).waitFor({state:'hidden'}); }
      }
    }
    results.push({width,theme,testedSpeeds,captureMode:save?'paused after live interval':'live',errors,assets:await page.locator('.world-canvas').getAttribute('data-art'),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
    console.log(JSON.stringify({width,theme,status:'captured'}));
    await context.close();
    console.log(JSON.stringify({width,theme,status:'closed'}));
  }
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
}finally{await browser?.close();server.kill();}
