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
assert.equal(execFileSync('git',['diff','HEAD','--','src','scripts','supabase','package.json','package-lock.json'],{cwd:root,encoding:'utf8'}),'');
const inspection=JSON.parse(execFileSync('docker',['inspect',identity.containerId],{encoding:'utf8'}))[0];
assert.equal(inspection.Name,'/supabase_db_Wolf-Forge-Studio-Release-20261014');
assert.equal(inspection.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');
const sql=q=>execFileSync('docker',['exec',identity.containerId,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',q],{encoding:'utf8'}).trim();
assert.equal(sql('select system_identifier from pg_control_system()'),identity.systemId);
const phase=process.argv[2];
assert.ok(['login','verify'].includes(phase));
const evidence=resolve(backend,'evidence/browser');
const sessions=resolve(backend,'private-sessions');
mkdirSync(evidence,{recursive:true});mkdirSync(sessions,{recursive:true});
const result={sha:head,phase,origin:identity.origin,backend:identity.project,startedAt:new Date().toISOString(),checks:[],viewports:[],errors:[],consoleErrors:[]};
const accounts=JSON.parse(readFileSync(resolve(root,'.qa-local-credentials.release.json'),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const routeA='/white-label?tenant=f0f0f0f0-0000-4000-8000-000000004201';
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const monitor=p=>{p.on('pageerror',e=>result.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});};
const ready=p=>p.getByLabel('Workspace display name',{exact:true}).waitFor({timeout:90000});
const saved=p=>p.getByText(/Draft saved · revision/).waitFor({timeout:45000});
const noOverlay=async p=>assert.equal(await p.locator('nextjs-portal').count(),0);
try{
 if(phase==='login'){
  for(const [name,a] of Object.entries(accounts)){
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   const page=await context.newPage();monitor(page);
   await page.goto(identity.origin+'/login',{waitUntil:'domcontentloaded',timeout:120000});
   await page.getByLabel('Email',{exact:true}).fill(a.email);
   await page.getByLabel('Password',{exact:true}).fill(a.password);
   await button(page,'Sign in').click();
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
  const field=page.getByLabel('Workspace display name',{exact:true});
  await field.fill('Studio candidate '+head.slice(0,8));
  await button(page,'Review Draft').click();
  await page.getByText('Draft valid for saving. Publishing is unavailable.').waitFor();
  await button(page,'Save reviewed draft').click();await saved(page);
  await button(page,'Back to editing').click();
  await page.reload();await ready(page);
  assert.equal(await field.inputValue(),'Studio candidate '+head.slice(0,8));
  result.checks.push('Review, save and reload a persisted draft');
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
  await second.getByLabel('Workspace display name',{exact:true}).fill('Stale revision loser');
  await button(second,'Save Draft').click();await second.getByText('Revision conflict',{exact:true}).first().waitFor();
  assert.equal(sql("select display_name from private.tenant_white_label_drafts where tenant_id='f0f0f0f0-0000-4000-8000-000000004201'"),'First revision winner');
  await second.close();result.checks.push('Concurrent stale revision refused without overwriting the winner');
  for(const width of [320,360,390,430,768,1280,1440]){
   await page.setViewportSize({width,height:1000});
   await page.reload();await ready(page);
   await field.fill('W'.repeat(60));
   await button(page,'Mobile').click();
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
  assert.ok(await page.getByLabel('Workspace display name',{exact:true}).isDisabled());
  assert.ok(await button(page,'Save Draft').isDisabled());
  result.checks.push('Suspended Tenant is read-only');
  await context.close();
  for(const role of ['owner','staff','client']){
   const c=await browser.newContext({storageState:resolve(sessions,role+'.json')});const p=await c.newPage();monitor(p);
   const response=await p.goto(identity.origin+routeA);
   assert.ok(response.status()===404||!new URL(p.url()).pathname.startsWith('/white-label'));
   assert.equal(await p.getByLabel('Workspace display name',{exact:true}).count(),0);
   result.checks.push({actor:role,studio:'denied',status:response.status(),route:new URL(p.url()).pathname});
   await c.close();
  }
  const anon=await browser.newContext();const a=await anon.newPage();await a.goto(identity.origin+routeA);
  assert.equal(new URL(a.url()).pathname,'/login');await anon.close();result.checks.push('Anonymous redirected to login');
  assert.equal(sql("select to_regclass('private.tenant_module_publications') is null"),'t');
 }
 result.passed=true;
} catch(error){result.passed=false;result.failure=error.message;throw error;}
finally{result.finishedAt=new Date().toISOString();writeFileSync(resolve(evidence,phase+'.json'),JSON.stringify(result,null,2));await browser.close();console.log(JSON.stringify({phase,sha:head,passed:result.passed,checks:result.checks.length,viewports:result.viewports.length,failure:result.failure}));}
