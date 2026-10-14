import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root=resolve(import.meta.dirname,'..');
const backend=resolve(process.env.LOCALAPPDATA,'Temp/wolf-forge-studio-release-backend-20261014');
const identity=JSON.parse(readFileSync(resolve(backend,'identity.json'),'utf8'));
assert.equal(identity.api,'http://127.0.0.1:62321');
assert.equal(identity.origin,'http://127.0.0.1:3022');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(head,process.env.WF_RELEASE_CANDIDATE_SHA,'Pin the exact committed candidate SHA');
assert.equal(execFileSync('git',['diff','HEAD','--','src','supabase','package.json','package-lock.json','next.config.ts'],{cwd:root,encoding:'utf8'}),'');
const harnessClean=execFileSync('git',['diff','HEAD','--','scripts/qa-studio-release-browser.mjs'],{cwd:root,encoding:'utf8'})==='';
const inspection=JSON.parse(execFileSync('docker',['inspect',identity.containerId],{encoding:'utf8'}))[0];
assert.equal(inspection.Name,'/supabase_db_Wolf-Forge-Studio-Release-20261014');
assert.equal(inspection.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');
const gateway=JSON.parse(execFileSync('docker',['inspect','supabase_kong_Wolf-Forge-Studio-Release-20261014'],{encoding:'utf8'}))[0];
assert.equal(gateway.NetworkSettings.Ports['8000/tcp'][0].HostIp,'127.0.0.1');
const sql=q=>execFileSync('docker',['exec',identity.containerId,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',q],{encoding:'utf8'}).trim();
assert.equal(sql('select system_identifier from pg_control_system()'),identity.systemId);
const phase=process.argv[2];
assert.ok(['login','verify'].includes(phase));
const evidence=resolve(backend,'evidence/browser');
const sessions=resolve(backend,'private-sessions');
mkdirSync(evidence,{recursive:true});mkdirSync(sessions,{recursive:true});
const result={sha:head,harnessClean,phase,origin:identity.origin,backend:identity.project,startedAt:new Date().toISOString(),checks:[],viewports:[],errors:[],consoleErrors:[],failedResponses:[]};
const accounts=JSON.parse(readFileSync(resolve(root,'.qa-local-credentials.release.json'),'utf8'));
assert.match(accounts.platformAdmin.id,/^[0-9a-f-]{36}$/i);
let revoked=false;
let expectedDenial=false;
const browser=await chromium.launch({channel:'chrome',headless:true});
const routeA='/white-label?tenant=f0f0f0f0-0000-4000-8000-000000004201';
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const monitor=p=>{
 p.on('pageerror',e=>result.errors.push(e.message));
 p.on('response',r=>{if(r.status()>=400)result.failedResponses.push({status:r.status(),url:r.url(),denialPhase:expectedDenial});});
 p.on('console',m=>{
  if(m.type()!=='error')return;
  const message=m.text(),location=m.location().url;
  const classification=expectedDenial&&/status of (404|403)/.test(message)?'expected-denial'
   :/Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy/.test(message)?'inherited-csp-warning'
   :message.includes('/_vercel/speed-insights/script.js')||location.includes('/_vercel/speed-insights/script.js')?'local-speed-insights'
   :location.endsWith('/favicon.ico')&&/404/.test(message)?'local-favicon':'unexpected';
  result.consoleErrors.push({message,location,classification});
 });
};
const ready=p=>p.getByRole('textbox',{name:'Workspace display name',exact:true}).waitFor({timeout:90000});
const saved=p=>p.getByText(/Draft saved · revision/).filter({visible:true}).first().waitFor({timeout:45000});
const noOverlay=async p=>assert.equal(await p.locator('nextjs-portal [data-nextjs-dialog-header]').count(),0);
try{
 if(phase==='login'){
  for(const [name,a] of Object.entries(accounts)){
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   const page=await context.newPage();monitor(page);
   await page.goto(identity.origin+'/login',{waitUntil:'domcontentloaded',timeout:120000});
   await page.getByLabel('Email',{exact:true}).fill(a.email);
   await page.getByLabel('Password',{exact:true}).fill(a.password);
   await page.getByRole('button',{name:/^Sign in/}).click();
   await page.waitForURL(url=>url.pathname!=='/login',{timeout:120000});
   await noOverlay(page);
   await context.storageState({path:resolve(sessions,name+'.json')});
   result.checks.push({actor:name,normalFormLogin:true,destination:new URL(page.url()).pathname});
   await context.close();
  }
 } else if(phase==='verify'){
  const context=await browser.newContext({storageState:resolve(sessions,'platformAdmin.json'),viewport:{width:1440,height:1000}});
  const page=await context.newPage();monitor(page);
  await page.goto(identity.origin+'/white-label',{timeout:120000});
  await page.getByRole('region',{name:'Tenant drafts',exact:true}).waitFor({timeout:90000});
  assert.match(await page.title(),/White Label Studio/);
  assert.ok(await page.getByRole('heading',{name:'White Label Studio',exact:true}).isVisible());
  assert.ok(await page.getByText('Drafts only · Publishing and live branding are unavailable.').isVisible());
  assert.equal(await page.getByRole('button',{name:/^publish(?: now)?$/i}).count(),0);
  await button(page,'Continue Editing Studio Release A').click();await ready(page);
  const field=page.getByRole('textbox',{name:'Workspace display name',exact:true});
  const shellColor=await page.locator('aside').first().evaluate(e=>getComputedStyle(e).backgroundColor);
  await field.fill('Studio candidate '+head.slice(0,8));
  await page.getByRole('textbox',{name:'Primary color',exact:true}).fill('#256b45');
  await page.getByRole('textbox',{name:'Accent color',exact:true}).fill('#e0a438');
  await button(page,'Review Draft').click();
  await page.getByText('Draft valid for saving. Publishing is unavailable.').filter({visible:true}).waitFor();
  await button(page,'Save reviewed draft').click();await saved(page);
  await button(page,'Back to editing').click();
  await page.reload();await ready(page);
  assert.equal(await field.inputValue(),'Studio candidate '+head.slice(0,8));
  assert.equal(await page.getByRole('textbox',{name:'Primary color',exact:true}).inputValue(),'#256b45');
  assert.equal(await page.getByRole('textbox',{name:'Accent color',exact:true}).inputValue(),'#e0a438');
  assert.equal(await page.locator('aside').first().evaluate(e=>getComputedStyle(e).backgroundColor),shellColor);
  result.checks.push('Review, save and reload draft name/colors; actual shell branding unchanged');
  const live=page.getByRole('region',{name:'Live preview',exact:true});
  await button(live,'Edit modules').click();
  for(const label of ['Projects','Subscriptions','Coupons','Investment Intent','Tickets','Reporting','Invoices','Forms','Services']){
   const toggle=live.getByRole('switch',{name:label+' module',exact:true});
   if(await toggle.getAttribute('aria-checked')==='true')await toggle.click();
  }
  await field.fill('Empty module draft');
  await button(page,'Save Draft').click();await saved(page);
  assert.equal(sql("select module_keys::text from private.tenant_white_label_drafts where tenant_id='f0f0f0f0-0000-4000-8000-000000004201'"),'{}');
  await page.reload();await ready(page);
  result.checks.push('Empty module selection, including Services OFF, saved and reloaded without restoration');
  await field.fill('Unsaved local edit');
  await button(page,'All Drafts').click();
  await page.getByRole('dialog').waitFor();
  await button(page,'Keep editing').click();
  assert.equal(await field.inputValue(),'Unsaved local edit');
  await button(page,'All Drafts').click();await button(page,'Discard and return').click();
  await button(page,'Continue Editing Studio Release B').click();await ready(page);
  assert.equal(await field.inputValue(),'Studio Release B');
  assert.equal(sql("select count(*) from private.tenant_white_label_drafts where tenant_id='f0f0f0f0-0000-4000-8000-000000004202'"),'0');
  result.checks.push('Unsaved departure confirmation and Tenant B isolation');
  await page.goto(identity.origin+routeA);await ready(page);
  const second=await context.newPage();monitor(second);await second.goto(identity.origin+routeA);await ready(second);
  await field.fill('First revision winner');await button(page,'Save Draft').click();await saved(page);
  await second.getByRole('textbox',{name:'Workspace display name',exact:true}).fill('Stale revision loser');
  await button(second,'Save Draft').click();await second.getByText('Revision conflict',{exact:true}).first().waitFor();
  assert.equal(sql("select display_name from private.tenant_white_label_drafts where tenant_id='f0f0f0f0-0000-4000-8000-000000004201'"),'First revision winner');
  await second.close();result.checks.push('Concurrent stale revision refused without overwriting the winner');
  const revision=sql("select revision from private.tenant_white_label_drafts where tenant_id='f0f0f0f0-0000-4000-8000-000000004201'");
  await field.fill('A revoked actor must not save');
  sql(`select private.revoke_platform_admin('${accounts.platformAdmin.id}', 'Disposable browser revocation QA')`);revoked=true;
  await button(page,'Save Draft').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('input[maxlength="60"]')].some(e=>e.checkVisibility()&&e.matches(':disabled')));
  assert.equal(sql("select revision from private.tenant_white_label_drafts where tenant_id='f0f0f0f0-0000-4000-8000-000000004201'"),revision);
  sql(`select private.grant_platform_admin('${accounts.platformAdmin.id}', 'Restore disposable browser QA grant')`);revoked=false;
  result.checks.push('Open editor refuses a save after entitlement revocation; revision unchanged');
  for(const width of [320,360,390,430,768,1280,1440]){
   await page.setViewportSize({width,height:1000});
   await page.reload();await ready(page);
   await field.fill('W'.repeat(60));
   await button(page,'Mobile').click();
   await page.waitForFunction(()=>{
    const frame=document.querySelector('[data-testid="preview-frame"][data-device="mobile"]');
    if(!frame||!frame.checkVisibility())return false;
    const box=frame.getBoundingClientRect(),slot=frame.parentElement.getBoundingClientRect();
    return box.left>=slot.left-1&&box.right<=slot.right+1&&box.height<=761;
   });
   assert.deepEqual(await page.getByTestId('phone-viewport').evaluate(e=>({width:e.style.width,height:e.style.height})),{width:'393px',height:'852px'});
   const size=page.getByRole('button',{name:/Phone size/});
   await size.click();await page.getByRole('listbox').waitFor();
   await page.screenshot({path:resolve(evidence,`phone-menu-${width}.png`),fullPage:true});
   await page.keyboard.press('Escape');
   await button(page,'Desktop').click();
   await button(page,'Review Draft').click();
   await page.getByRole('heading',{name:'Review draft',exact:true}).waitFor();
   const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert.ok(overflow.page<=overflow.viewport+1,JSON.stringify({width,overflow}));
   await page.screenshot({path:resolve(evidence,`review-${width}.png`),fullPage:true});
   await noOverlay(page);result.viewports.push({width,passed:true,overflow});
   await button(page,'Back to editing').click();
  }
  await page.reload();await ready(page);
  await page.goto(identity.origin+'/white-label?tenant=f0f0f0f0-0000-4000-8000-000000004203');await ready(page);
  assert.ok(await page.getByRole('textbox',{name:'Workspace display name',exact:true}).isDisabled());
  assert.ok(await button(page,'Save Draft').isDisabled());
  result.checks.push('Suspended Tenant is read-only');
  await context.close();
  expectedDenial=true;
  for(const role of ['owner','staff','client']){
   const c=await browser.newContext({storageState:resolve(sessions,role+'.json')});const p=await c.newPage();monitor(p);
   const response=await p.goto(identity.origin+routeA);
   await p.waitForFunction(()=>location.pathname==='/login'||location.pathname.startsWith('/account')||[...document.querySelectorAll('h1')].some(e=>e.textContent?.trim()==='404'),null,{timeout:90000});
   assert.equal(await p.getByRole('textbox',{name:'Workspace display name',exact:true}).count(),0);
   result.checks.push({actor:role,studio:'denied',status:response.status(),route:new URL(p.url()).pathname});
   await c.close();
  }
  const anon=await browser.newContext();const a=await anon.newPage();await a.goto(identity.origin+routeA);
  assert.equal(new URL(a.url()).pathname,'/login');await anon.close();result.checks.push('Anonymous redirected to login');
  expectedDenial=false;
  for(const [role,routes] of [['owner',['/dashboard','/clients','/services','/forms','/orders','/tickets','/invoices','/subscriptions','/coupons','/team','/settings/general']],['client',['/account','/account/store','/account/projects','/account/messages','/account/invoices','/account/subscriptions','/account/profile']]]){
   const c=await browser.newContext({storageState:resolve(sessions,role+'.json')});const p=await c.newPage();monitor(p);
   for(const route of routes){
    const response=await p.goto(identity.origin+route,{timeout:90000});
    await p.getByRole('heading').first().waitFor({timeout:90000});
    assert.equal(new URL(p.url()).pathname,route);
    assert.ok(response.status()<400);
    assert.doesNotMatch(await p.locator('body').innerText(),/Application error:|Something went wrong|Internal Server Error/);
    await noOverlay(p);result.checks.push({actor:role,route,status:response.status(),heading:await p.getByRole('heading').first().innerText()});
   }
   await c.close();
  }
  assert.equal(sql("select to_regclass('private.tenant_module_publications') is null"),'t');
 }
 assert.equal(result.errors.length,0,JSON.stringify(result.errors));
 assert.equal(result.consoleErrors.filter(e=>e.classification==='unexpected').length,0,JSON.stringify(result.consoleErrors));
 result.passed=true;
} catch(error){result.passed=false;result.failure=error.message;for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:resolve(evidence,`failure-${phase}.png`),fullPage:true}).catch(()=>{});throw error;}
finally{if(revoked)sql(`select private.grant_platform_admin('${accounts.platformAdmin.id}', 'Restore disposable QA fixture after interrupted check')`);result.finishedAt=new Date().toISOString();writeFileSync(resolve(evidence,phase+'.json'),JSON.stringify(result,null,2));await browser.close();console.log(JSON.stringify({phase,sha:head,passed:result.passed,checks:result.checks.length,viewports:result.viewports.length,failure:result.failure}));}
