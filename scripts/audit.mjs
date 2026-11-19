// Local-only audit: reads a save without editing it, seeds an isolated browser profile.
// Usage: node scripts/audit.mjs /absolute/save.json docs/evidence/before
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const [savePath, out = 'docs/evidence/audit'] = process.argv.slice(2);
const save = savePath === 'new' ? null : JSON.parse(await readFile(savePath, 'utf8'));
await mkdir(out, {recursive:true});
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4317','--strictPort'], {stdio:'pipe',cwd:process.env.AUDIT_ROOT||process.cwd()});
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
async function ensurePaused(page) {
  const pause=page.getByRole('button',{name:'Pause simulation',exact:true});
  if(await pause.count())await pause.click();
  if(!await page.getByRole('button',{name:'Resume simulation',exact:true}).count())throw new Error('The layout capture must be paused.');
}
class ExpectedRenderError extends Error {}
let browser;
try {
  for(let i=0;i<100;i++){ try { if((await fetch('http://127.0.0.1:4317/agrarian/')).ok)break; }catch{} await new Promise(r=>setTimeout(r,100)); }
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const results=[];
  for(const width of (process.env.AUDIT_WIDTHS?.split(',').map(Number) ?? [390,1400])) for(const theme of (process.env.AUDIT_THEMES?.split(',') ?? ['light','dark'])) {
    const context=await browser.newContext({viewport:{width,height:844},colorScheme:theme});
    await context.addInitScript(({save,theme,graphics})=>{
      if(!sessionStorage.getItem('audit-seeded')){
        if(save) localStorage.setItem('agrarian.auto',JSON.stringify({...save,savedAt:Date.now(),paused:true}));
        localStorage.setItem('agrarian.ui.theme',JSON.stringify(theme));
        localStorage.setItem('agrarian.ui.offline','false');
        localStorage.setItem('agrarian.ui.music','0');
        if(graphics)localStorage.setItem('agrarian.ui.graphics',JSON.stringify(graphics));
        sessionStorage.setItem('audit-seeded','1');
      }
    },{save,theme,graphics:process.env.AUDIT_GRAPHICS});
    const page=await context.newPage(); const errors=[],consoleErrors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await page.goto('http://127.0.0.1:4317/agrarian/');
    await page.getByRole('button',{name:save?'Continue your farm':'Start farming',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.world-canvas')?.dataset.art==='8',undefined,{timeout:20000});
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
      if(save)await ensurePaused(page);
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
          await nav.click();
          if(process.env.AUDIT_EXPECT_RENDER_ERROR){
            await page.waitForTimeout(1200);
            const observed=[...errors,...consoleErrors];
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-expected-render-error.png`});
            await writeFile(`${out}/render-error-results.json`,JSON.stringify({width,theme,root:process.env.AUDIT_ROOT,observed},null,2));
            if(!observed.some(e=>/Cannot read properties of undefined \(reading ['"]0['"]\)/.test(e)))throw new Error('Expected missing-port error was not observed.');
            throw new ExpectedRenderError('Verified baseline missing-port crash.');
          }
          await page.locator('.page-drawer .page-head, .page-drawer .card, .modal .charter-grid').first().waitFor({state:'visible'});
          await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${section}.png`});
          if(process.env.AUDIT_TOOLTIPS && (section==='production'||section==='markets')) {
            await page.getByRole('button',{name:'Time controls',exact:true}).click();
            await page.getByRole('radio',{name:'50×',exact:true}).click();await ensurePaused(page);
            await resolveAuditDialogs(page,`${out}/${width}-${theme}-tooltip-live`);await ensurePaused(page);
            const explain=page.getByRole('button',{name:'Explain',exact:true}).first();
            await explain.scrollIntoViewIfNeeded();await explain.focus();
            const described=await explain.getAttribute('aria-describedby');
            if(!described||!await page.locator(`[id="${described}"]`).isVisible())throw new Error('Keyboard focus did not explain the metric.');
            await explain.click();await page.mouse.move(5,5);
            const pop=page.locator('[role=tooltip]:visible');
            if(!await pop.count()||await pop.getAttribute('data-pinned')!=='true')throw new Error('Tap explanation did not remain open.');
            const measures=await pop.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,font:parseFloat(getComputedStyle(el).fontSize),overflow:el.scrollWidth>el.clientWidth};});
            const hit=await explain.boundingBox();
            if(width===390&&(!hit||hit.width<44||hit.height<44))throw new Error('Explanation touch target is smaller than44px.');
            if(measures.left<0||measures.right>width||measures.top<0||measures.bottom>844||measures.font<15||measures.overflow)throw new Error(`Unreadable explanation: ${JSON.stringify(measures)}`);
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${section}-explanation.png`});
            await page.keyboard.press('Space');
            if(!await page.getByRole('button',{name:'Pause simulation',exact:true}).count()||!await pop.isVisible())throw new Error('Space failed to resume while preserving the explanation.');
            await page.keyboard.press('Space');
            if(!await page.getByRole('button',{name:'Resume simulation',exact:true}).count()||!await pop.isVisible())throw new Error('Space failed to pause while preserving the explanation.');
            await page.keyboard.press('Escape');
            if(await page.getByRole('tooltip').count()||!await page.locator('.page-drawer').isVisible())throw new Error('Escape must close only the explanation.');
            await explain.click();await page.locator('.page-head h1').click();
            if(await page.getByRole('tooltip').count())throw new Error('Outside tap failed to close explanation.');
            if(section==='markets') {
              const rows=()=>page.locator('table.t').first().locator('tbody tr td:first-child').allTextContents();
              const before=await rows();await page.getByRole('button',{name:'Time controls',exact:true}).click();await page.getByRole('radio',{name:'50×',exact:true}).click();await page.waitForTimeout(1800);await resolveAuditDialogs(page,`${out}/${width}-${theme}-market-live`);await ensurePaused(page);
              const after=await rows();if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Default market row order changed as values moved.');
            }
          }
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
          if(section==='production'&&process.env.AUDIT_PRODUCTION) {
            const first=page.locator('.ln').first();await first.scrollIntoViewIfNeeded();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-production-run.png`});
            const overflow=await page.locator('.ln').evaluateAll(nodes=>nodes.flatMap(node=>{const box=node.getBoundingClientRect();return [...node.querySelectorAll('.ln-coins,.ln-token,.ln-money,.ln-command,.ln-report-note')].filter(child=>{const r=child.getBoundingClientRect();return r.width>0&&(r.left<box.left-2||r.right>box.right+2);}).map(child=>`${node.dataset.line}: ${child.className}`);}));
            if(overflow.length)throw new Error(`Production content escapes its card: ${overflow.join(', ')}`);
            const days=await page.locator('.ln').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.reportDays)));
            if(days.some(n=>n<3))throw new Error('Production QA needs actual completed-day history.');
            const before=await page.locator('.ln').evaluateAll(nodes=>nodes.map(n=>({key:n.dataset.line,height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top})));
            await page.getByRole('button',{name:'Time controls',exact:true}).click();await page.getByRole('radio',{name:'50×',exact:true}).click();await page.waitForTimeout(1800);await ensurePaused(page);
            const after=await page.locator('.ln').evaluateAll(nodes=>nodes.map(n=>({key:n.dataset.line,height:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top})));
            if(before.length!==after.length||before.some((b,i)=>b.key!==after[i].key||Math.abs(b.height-after[i].height)>2||Math.abs(b.top-after[i].top)>2))throw new Error('Production cards moved while data changed.');
            await resolveAuditDialogs(page,`${out}/${width}-${theme}-production-live`);await ensurePaused(page);
            await first.getByRole('button',{name:'Margins',exact:true}).click();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-production-margins.png`});
            await first.getByRole('button',{name:'Grow',exact:true}).click();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-production-grow.png`});
            const clipped=await first.locator('.ln-panel:not([hidden]) .ln-opt:visible').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.ln-command-body').getBoundingClientRect();return r.bottom>p.bottom+2;});
            if(clipped)throw new Error('Growth payoff or action is clipped by its command board.');
            await first.getByRole('button',{name:'＋ Another',exact:true}).click();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-production-another.png`});
            for(const type of ['biogas','verticalFarm','distribution']){
              const line=page.locator(`[data-line="${type}:heartland"]`);
              if(await line.count()){await line.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${type}-ports.png`});}
            }
          }
          if(section==='production'&&process.env.AUDIT_FACILITIES) {
            const retail=page.locator('[data-line="distribution:heartland"]');
            await retail.scrollIntoViewIfNeeded();await retail.getByRole('button',{name:'Run',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-retail-duplicates.png`});
            await retail.getByRole('button',{name:'Keep best',exact:true}).click();
            if(await retail.getByRole('button',{name:'Keep best',exact:true}).count())throw new Error('Keep-best did not pause redundant centres.');
            for(const type of ['distribution','solar']) {
              const line=page.locator(`[data-line="${type}:heartland"]`);await line.scrollIntoViewIfNeeded();
              await line.getByRole('button',{name:'Grow',exact:true}).click();
              await line.getByRole('button',{name:'⬆ Upgrade',exact:true}).click();
              await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${type}-upgrade-preview.png`});
              await line.getByRole('button',{name:'Upgrade',exact:true}).click();
              const confirm=page.getByRole('dialog').filter({has:page.getByRole('button',{name:/^Pay /})});
              await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${type}-upgrade-confirm.png`});
              await confirm.getByRole('button',{name:/^Pay /}).click();
              if((await line.locator('.ln-level').textContent())!=='Lv2')throw new Error(`${type} upgrade did not reach the actual line state.`);
              await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-${type}-upgraded.png`});
            }
          }
          if(section==='markets'&&process.env.AUDIT_FACILITIES) {
            await page.getByRole('row').filter({hasText:/Flour/}).first().click();
            const sell=page.locator('.card').filter({has:page.getByRole('heading',{name:/^Sell Flour/})});
            await ensurePaused(page);
            if(!await sell.locator('.retail-quote').count()) {
              await page.getByRole('combobox',{name:'Good to buy',exact:true}).selectOption('flour');
              await page.getByRole('textbox',{name:'Units to buy',exact:true}).fill('50');
              await page.getByRole('button',{name:/^Buy [0-9,]+ for /}).click();
              await page.getByRole('textbox',{name:'Units to sell',exact:true}).fill('50');
            }
            await sell.scrollIntoViewIfNeeded();await sell.locator('.retail-quote').waitFor({state:'visible'});
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-retail-sale-split.png`});
          }
          if(section==='city'&&process.env.AUDIT_CITY_ENTRY) {
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-offer.png`});
            await page.getByRole('button',{name:'Choose Professional police',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-entry-care.png`});
            const build=page.locator('.town-service').first().getByRole('button',{name:'Build',exact:true});
            if(await build.isDisabled()){const fund=page.locator('[data-coach=city-next]');if(!/Fund planned services/.test(await fund.innerText()))throw new Error('Entry fixture needs a supported funding action.');await fund.click();}
            await build.scrollIntoViewIfNeeded();await build.click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-first-project.png`});
            await page.getByRole('button',{name:'Back to the farm (Esc)',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-first-world.png`});
            continue;
          }
          if(section==='city'&&process.env.AUDIT_CITY) {
            const choose=page.getByRole('button',{name:'Choose Professional police',exact:true});
            if(await choose.count()) {await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-charter.png`});await choose.click();}
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-care.png`});
            const bounds=await page.locator('.city-page').evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('button,.town-purse,.community-strip')].filter(n=>{const b=n.getBoundingClientRect();return b.width>0&&(b.left<r.left-1||b.right>r.right+1);}).map(n=>n.textContent);});
            if(bounds.length)throw new Error('City controls escape the sheet: '+bounds.join(', '));
            const utility=page.locator('.town-service').first();
            await utility.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-utility.png`});
            const funding=page.getByRole('button',{name:'Enable automatic advances',exact:true});
            await funding.scrollIntoViewIfNeeded();await funding.click();
            await page.getByRole('button',{name:'Automatic advances · on',exact:true}).waitFor({state:'visible'});
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-funding.png`});
            await page.getByRole('button',{name:'Automatic advances · on',exact:true}).click();
            await page.getByRole('radio',{name:'District',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-district.png`});
            const zone=page.getByRole('button',{name:'⚙ industrial',exact:true});
            await zone.click();
            const rezone=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/^Rezone /})});
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-zone-preview.png`});await rezone.getByRole('button',{name:'Confirm',exact:true}).click();
            await page.getByRole('radio',{name:'Justice',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-justice.png`});
            const train=page.getByRole('button',{name:/^Train · /});
            if(!await train.isDisabled()) {await train.click();await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-training.png`});await page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Train your officers?',exact:true})}).getByRole('button',{name:'Confirm',exact:true}).click();}
            await page.getByRole('button',{name:'Change charter',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-reform.png`});
            const clipped=await page.locator('.city-charters .charter-tile').evaluateAll(nodes=>nodes.some(n=>{const r=n.getBoundingClientRect();return [...n.children].some(c=>{const b=c.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1;});}));
            if(clipped)throw new Error('City charter content clips outside its choice tile.');
            await page.getByRole('button',{name:'Reform Community watch',exact:true}).click();
            await page.getByRole('button',{name:'Back to the farm (Esc)',exact:true}).click();
            await page.screenshot({animations:'disabled',path:`${out}/${width}-${theme}-city-world.png`});
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
    results.push({width,theme,graphics:process.env.AUDIT_GRAPHICS??'high',testedSpeeds,captureMode:save?'paused after live interval':'live',errors,consoleErrors,assets:await page.locator('.world-canvas').getAttribute('data-art'),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
    console.log(JSON.stringify({width,theme,status:'captured'}));
    await context.close();
    console.log(JSON.stringify({width,theme,status:'closed'}));
  }
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
  if(results.some(r=>r.errors.length||r.consoleErrors.length||r.overflow))throw new Error('Browser review found an error or horizontal overflow; inspect results.json.');
}catch(error){
 if(error instanceof ExpectedRenderError)console.log(error.message);
 else {
  const active=browser?.contexts().at(-1)?.pages().at(-1);
  if(active){await active.screenshot({path:`${out}/failure.png`,timeout:5000}).catch(()=>{});await writeFile(`${out}/failure.txt`,String(error)+'\n'+await active.locator('body').innerText().catch(()=>''));}
  throw error;
 }
}finally{await browser?.close();server.kill();}
