import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyRunner, target, privateDirectory, makeFixtures, createOrder, createReport, rpc, denied, sql, gmb, seo, tenant, lateWorkPeriod, recordPhase, capture, scrub } from './monthly-report-acceptance.mjs';

// No test clock, RPC mock, auth bypass, hosted target or publication-date rewrite.
export async function browserAcceptance(){
  await verifyRunner();const local=await target();assert.ok(local.state.migrated);
  const result={status:'incomplete',checks:[],widths:[],actions:[],pageErrors:[],externalRequests:[],environmentNotices:[],calendar:{actualStartedAt:new Date().toISOString(),...lateWorkPeriod(),literalDecember:'SQL208/209 fixtures; not a December browser observation'}};
  let step='synthetic fixtures',server,proxy,browser;
  const dir=await privateDirectory(),output=join(dir,'evidence');await mkdir(output,{recursive:true,mode:0o700});
  const check=name=>{result.checks.push(name);console.log(JSON.stringify({phase:'browser',check:name}));};
  const period=lateWorkPeriod(),origin='https://127.0.0.1:3443';
  const row=async id=>JSON.parse(await sql("select json_build_object('status',status,'month',reporting_period_month,'started',started_at,'completed',completed_at) from public.orders where id=:'id';",{id}));
  const scope=(id,month=period.work)=>({p_order_id:id,p_service_id:gmb,p_reporting_period_month:month});
  const evidence=async id=>JSON.parse(await sql("select json_build_object('exceptions',(select coalesce(json_agg(to_jsonb(e)),'[]') from private.order_report_exceptions e where order_id=:'id'),'exceptionAudit',(select count(*) from public.activity_events where entity_id=:'id' and action='order.report_not_required'),'statusAudit',(select count(*) from public.activity_events where entity_id=:'id' and action='order.status_changed'));",{id}));
  try{
    const f=await makeFixtures('browser'),owner=f.accounts.owner;
    const order=await createOrder(f,{title:'Synthetic November delivery'});
    await createOrder(f,{company:f.otherCompany,title:'Synthetic unrelated ownership'});
    await rpc(owner.client,'app_create_subscription',{p_request_id:randomUUID(),p_payload:{company_id:f.company,service_id:seo,plan_source:'admin_invoice',billing_anchor:period.work,interval_unit:'month',interval_count:1,currency:'USD',recurring_action:'none',items:[{service_id:seo,name:'Synthetic SEO entitlement',quantity:1,unit_amount_cents:100,unit_discount_cents:0,is_taxable:false}]}});
    const choices=await rpc(owner.client,'app_list_reporting_service_options',{p_company_id:f.company,p_supported_service_ids:[gmb,seo]});
    assert.ok(choices.some(c=>c.service_id===gmb && c.subscription_id===null),'Order-only ownership missing');
    assert.ok(choices.some(c=>c.service_id===seo && c.subscription_id),'Subscription ownership missing');
    assert.deepEqual(await rpc(owner.client,'app_list_reporting_service_options',{p_company_id:f.emptyCompany,p_supported_service_ids:[gmb,seo]}),[]);
    // Profile identity remains the existing UUID even when the display name changes.
    await sql("update public.services set name='Synthetic renamed monthly Service' where id=:'id';",{id:gmb});
    check('Real order-only and subscription ownership, stable Service IDs and empty ownership');

    await createReport(f,{month:period.wrong,publish:true,title:'Synthetic wrong October'});
    await createReport(f,{service:seo,publish:true,title:'Synthetic wrong Service'});
    await createReport(f,{company:f.otherCompany,publish:true,title:'Synthetic wrong client'});
    await createReport(f,{title:'Synthetic November draft'});
    const archived=await createReport(f,{publish:true,title:'Synthetic archived November'});
    await sql("update public.client_reports set archived_at=now() where id=:'id';",{id:archived.id});
    await denied(owner.client,'app_change_order_status',{p_order_id:order.id,p_status:'complete'},'WF431');
    await rpc(owner.client,'app_set_order_reporting_month',scope(order.id));
    await denied(owner.client,'app_change_order_status',{p_order_id:order.id,p_status:'complete'},'WF431');
    await denied(owner.client,'app_complete_order_for_reporting_month',scope(order.id),'WF431');
    await denied(owner.client,'app_complete_order_without_report',{...scope(order.id,period.wrong),p_reason:'Wrong October scope'},'22023');
    await denied(owner.client,'app_complete_order_without_report',{...scope(order.id),p_reason:'   '},'22023');
    await denied(owner.client,'app_complete_order_without_report',{...scope(order.id),p_reason:'x'.repeat(1001)},'22023');
    assert.equal((await row(order.id)).status,'working');
    check('Draft, archived, wrong client/Service/October and invalid exceptions cannot unlock November through direct RPC');

    // Frozen historical/billing rows and task progress are never mutated by QA actions.
    const historical=await createOrder(f,{service:f.ordinary,title:'Synthetic historical completed work'});
    await rpc(owner.client,'app_change_order_status',{p_order_id:historical.id,p_status:'complete'});
    const invoice=randomUUID();
    await sql("insert into public.invoices(id,company_id,created_by_profile_id,updated_by_profile_id) values(:'id',:'company',:'actor',:'actor');insert into public.order_tasks(order_id,title,status,completed_at) values(:'order','Synthetic delivered task','complete',now()),(:'order','Synthetic remaining task','todo',null);",{id:invoice,company:f.company,actor:owner.id,order:order.id});
    const protectedState=()=>sql("select md5(json_build_object('historical',(select to_jsonb(o) from public.orders o where id=:'history'),'tasks',(select json_agg(to_jsonb(t) order by id) from public.order_tasks t where order_id=:'order'),'invoices',(select json_agg(to_jsonb(i) order by id) from public.invoices i),'subscriptions',(select json_agg(to_jsonb(s) order by id) from public.subscriptions s),'reports',(select to_jsonb(r) from public.client_reports r where id=:'report'))::text);",{history:historical.id,order:order.id,report:archived.id});
    const protectedBefore=await protectedState();

    step='owned production server';
    await capture('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);
    server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],{env:{...process.env,NODE_ENV:'production',SUPABASE_URL:f.status.API_URL,SUPABASE_PUBLISHABLE_KEY:f.publicKey,SUPABASE_SECRET_KEY:f.serverKey,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
    server.stdout.resume();server.stderr.resume();
    for(let n=0;n<60;n++){
      assert.equal(server.exitCode,null,'Production process exited');
      try{if((await fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(2000)})).ok)break;}catch{/* Owned process starting. */}
      assert.ok(n<59,'Production server readiness timeout');await delay(1000);
    }
    proxy=createHttpsServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},(request,response)=>{
      if(request.headers.host!==new URL(origin).host){response.writeHead(403).end();return;}
      const upstream=httpRequest({hostname:'127.0.0.1',port:3000,path:request.url,method:request.method,headers:{...request.headers,'x-forwarded-host':new URL(origin).host,'x-forwarded-proto':'https'}},received=>{response.writeHead(received.statusCode,received.headers);received.pipe(response);});
      upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});request.pipe(upstream);
    });
    await new Promise(done=>proxy.listen(3443,'127.0.0.1',done));
    const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
    async function pageFor(key){
      const account=f.accounts[key],context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:1000}});
      context.setDefaultTimeout(12000);context.setDefaultNavigationTimeout(25000);
      await context.addCookies(account.cookies.map(c=>({name:c.name,value:c.value,domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'})));
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());if(url.origin===origin || ['data:','blob:'].includes(url.protocol))return route.continue();
        result.externalRequests.push({origin:url.origin,path:url.pathname});return route.abort('blockedbyclient');
      });
      const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(scrub(e.message)));
      page.on('response',response=>{
        const request=response.request(),url=new URL(response.url());
        if(request.method()==='POST' && request.headers()['next-action'])result.actions.push({role:key,path:url.pathname,status:response.status()});
        if(response.status()>=400 && url.pathname.startsWith('/_vercel/'))result.environmentNotices.push({path:url.pathname,status:response.status(),reason:'Optional hosted-platform telemetry unavailable locally; no response stubbed'});
      });return page;
    }
    const page=await pageFor('owner');
    async function goto(p,path){const response=await p.goto(origin+path,{waitUntil:'networkidle'});assert.ok(response?.ok(),'Authorized route failed: '+path);}
    async function waitRow(id,status){for(let n=0;n<40;n++){if((await row(id)).status===status)return;await delay(150);}assert.fail('Persisted status did not become '+status);}
    async function openCompletion(p,id,control='header'){
      await goto(p,'/orders/'+id);
      if(control==='header'){const trigger=p.getByRole('button',{name:/^Status:/});await trigger.focus();await p.keyboard.press('Enter');await p.getByRole('option',{name:'Complete',exact:true}).click();}
      else{await p.getByRole('button',{name:'Open project actions',exact:true}).click();await p.getByRole('button',{name:/Change status/}).click();await p.getByRole('button',{name:'Complete',exact:true}).click();}
    }
    const sheet=p=>p.getByRole('dialog',{name:'Monthly report required',exact:true});
    async function missing(p,id,control='header'){
      await openCompletion(p,id,control);const dialog=sheet(p);await dialog.waitFor();return dialog;
    }
    async function confirmMonth(dialog,month){await dialog.getByLabel('Month the work covers',{exact:true}).fill(month.slice(0,7));await dialog.getByRole('button',{name:'Check report and complete',exact:true}).click();await dialog.getByRole('alert').waitFor();await dialog.getByRole('link',{name:'Create report',exact:true}).waitFor();}

    step='ownership and empty UI';
    for(const [name,empty] of [['Synthetic browser monthly work',false],['Synthetic browser empty client',true]]){
      await goto(page,'/reporting/new');const client=page.getByRole('combobox',{name:'Client',exact:true});await client.fill(name);await page.getByRole('option',{name,exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
      if(empty)await page.getByText('No purchased or in-progress Reporting Services.',{exact:true}).waitFor();
      else{await page.getByRole('button',{name:/Synthetic renamed monthly Service/}).waitFor();assert.equal(await page.getByRole('button',{name:/Purchased or in-progress order/}).count(),1);}
    }
    check('New report UI shows real owned Services and a clear empty state without a catalogue fallback');

    step='blank explicit month and builder prefill';
    const blank=await createOrder(f,{title:'Synthetic explicit-month selection'});
    let dialog=await missing(page,blank.id);
    assert.equal(await dialog.getByLabel('Month the work covers',{exact:true}).inputValue(),'');
    assert.ok(await dialog.getByRole('button',{name:'Check report and complete'}).isDisabled());
    assert.equal(await dialog.getByRole('link',{name:'Create report'}).count(),0);
    await confirmMonth(dialog,period.work);
    assert.equal((await row(blank.id)).month,period.work);assert.equal((await row(blank.id)).status,'working');
    const href=await dialog.getByRole('link',{name:'Create report'}).getAttribute('href'),query=new URL(href,origin);
    assert.equal(query.searchParams.get('companyId'),f.company);assert.equal(query.searchParams.get('serviceId'),gmb);assert.equal(query.searchParams.get('reportingPeriodMonth'),period.work);
    await dialog.getByRole('link',{name:'Create report'}).click();
    await page.getByRole('heading',{name:'Choose the Service',exact:true}).waitFor();
    await page.getByLabel('Report title',{exact:true}).fill('Synthetic guided draft only');
    await page.getByRole('button',{name:'Start guided report',exact:true}).click();
    await page.waitForURL(url=>/^\/reporting\/[a-f0-9-]{36}$/.test(url.pathname));
    const guidedId=new URL(page.url()).pathname.split('/').at(-1);
    await page.getByRole('button',{name:'Save draft',exact:true}).click();
    const guided=JSON.parse(await sql("select json_build_object('status',status,'company',company_id,'service',service_id,'month',reporting_period_month) from public.client_reports where id=:'id';",{id:guidedId}));
    assert.deepEqual(guided,{status:'draft',company:f.company,service:gmb,month:period.work});assert.equal((await row(blank.id)).status,'working');
    check('Missing month is blank; explicit November persists; prefilled builder and saved draft leave work incomplete');

    step='responsive sheets, keyboard, errors and retry';
    const responsive=await createOrder(f,{title:'Synthetic long monthly delivery title for narrow viewport review'}),noReportMonth=period.work.slice(0,4)+'-08-01';
    for(const width of [320,360,390,430,768,1280,1440]){
      await page.setViewportSize({width,height:1000});dialog=await missing(page,responsive.id,width%3===0?'actions':'header');
      await confirmMonth(dialog,noReportMonth);
      await dialog.getByRole('button',{name:'Report not required',exact:true}).click();
      const reason=dialog.getByLabel('Reason',{exact:true});await reason.fill('   ');assert.ok(await dialog.getByRole('button',{name:'Record exception and complete'}).isDisabled());
      await reason.fill('Synthetic bounded reason '.repeat(60));assert.equal((await reason.inputValue()).length,1000);
      await reason.focus();await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'Focus escaped the modal');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Responsive page overflows');
      const box=await dialog.boundingBox();assert.ok(box && box.x>=-1 && box.x+box.width<=width+1,'Completion sheet outside viewport');
      const actionBox=await dialog.getByRole('button',{name:'Record exception and complete'}).boundingBox();assert.ok(actionBox && actionBox.height>=44,'Completion touch target below 44px');
      await page.screenshot({path:join(output,`gate-${width}.png`),fullPage:true});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.ok(await page.evaluate(()=>document.activeElement?.tagName==='BUTTON'),'Focus did not return to a button');result.widths.push(width);
    }
    await page.setViewportSize({width:1280,height:1000});
    check('Both detail completion controls, seven responsive widths, bounded reason, Escape/focus return and error/retry UI');

    step='real late-period browser publication';
    const published=await createReport(f,{title:'Synthetic genuine late November report'});
    await goto(page,`/reporting/${published.id}?mode=advanced`);
    await page.getByRole('button',{name:'Send to client',exact:true}).click();
    await page.getByRole('dialog',{name:/Send this report to/}).getByRole('button',{name:'Send report',exact:true}).click();
    let sent;
    for(let n=0;n<40;n++){sent=JSON.parse(await sql("select json_build_object('status',status,'month',reporting_period_month,'sent',sent_at) from public.client_reports where id=:'id';",{id:published.id}));if(sent.status==='sent')break;await delay(150);}
    assert.equal(sent.status,'sent');assert.equal(sent.month,period.work);assert.ok(new Date(sent.sent)>new Date(period.work));
    const client=await pageFor('client'),otherClient=await pageFor('otherClient');
    await goto(client,'/account/reporting');await client.getByText('Synthetic genuine late November report',{exact:true}).waitFor();
    await goto(otherClient,'/account/reporting');assert.equal(await otherClient.getByText('Synthetic genuine late November report',{exact:true}).count(),0);
    await otherClient.goto(origin+'/account/reporting/'+published.id,{waitUntil:'networkidle'});assert.ok(!(await otherClient.locator('body').innerText()).includes('Synthetic genuine late November report'),'Unrelated Client can read the report');
    await openCompletion(page,order.id);await waitRow(order.id,'complete');await page.reload({waitUntil:'networkidle'});
    assert.ok((await page.getByRole('button',{name:/^Status:/}).getAttribute('aria-label')).includes('Complete'));
    const completed=await row(order.id);assert.equal(completed.month,period.work);assert.ok(new Date(completed.completed)>new Date(period.work));
    result.calendar={...result.calendar,publishedAt:sent.sent,completedAt:completed.completed,storedWorkMonth:completed.month,startedAt:completed.started};
    check('Real browser publication is client-visible only to the correct company; late completion retains explicit November');

    step='Owner/Admin/Manager scoped exceptions';
    const exceptionMonth=period.work.slice(0,4)+'-09-01';
    for(const key of ['owner','admin','manager']){
      const actor=f.accounts[key],actorPage=key==='owner'?page:await pageFor(key),item=await createOrder(f,{month:exceptionMonth,title:`Synthetic ${key} exception`});
      dialog=await missing(actorPage,item.id,key==='admin'?'actions':'header');
      await dialog.getByRole('button',{name:'Report not required',exact:true}).click();
      assert.ok(await dialog.getByRole('button',{name:'Record exception and complete'}).isDisabled());
      const reason=`Synthetic ${key} exact scoped exception`;
      await dialog.getByLabel('Reason',{exact:true}).fill(reason);await dialog.getByRole('button',{name:'Record exception and complete'}).click();await waitRow(item.id,'complete');await dialog.waitFor({state:'hidden'});await actorPage.reload({waitUntil:'networkidle'});
      const before=await evidence(item.id),e=before.exceptions[0];assert.equal(before.exceptions.length,1);assert.equal(before.exceptionAudit,1);assert.equal(before.statusAudit,2);
      assert.equal(e.order_id,item.id);assert.equal(e.tenant_id,tenant);assert.equal(e.company_id,f.company);assert.equal(e.service_id,gmb);assert.equal(e.reporting_period_month,exceptionMonth);assert.equal(e.reason,reason);assert.equal(e.actor_profile_id,actor.id);assert.ok(e.recorded_at);
      await rpc(actor.client,'app_complete_order_without_report',{...scope(item.id,exceptionMonth),p_reason:reason});
      await denied(actor.client,'app_complete_order_without_report',{...scope(item.id,exceptionMonth),p_reason:'Conflicting replacement'},'23505');assert.deepEqual(await evidence(item.id),before);
      const separate=await createOrder(f,{month:exceptionMonth,title:'Synthetic exception isolation'});await denied(actor.client,'app_complete_order_for_reporting_month',scope(separate.id,exceptionMonth),'WF431');
    }
    check('Owner/Admin/Manager genuine browser exceptions persist exact immutable scope/actor/time; retries, conflict and other-order isolation verified');

    step='ordinary and actual bulk server actions';
    const ordinary=await createOrder(f,{service:f.ordinary,title:'Synthetic ordinary normal completion'});await openCompletion(page,ordinary.id,'actions');await waitRow(ordinary.id,'complete');assert.equal(await sheet(page).count(),0);
    const bulkMonthly=await createOrder(f,{month:exceptionMonth,title:'Synthetic bulk monthly missing report'}),bulkOrdinary=await createOrder(f,{service:f.ordinary,title:'Synthetic bulk ordinary'});
    await goto(page,'/orders');
    for(const item of [bulkMonthly,bulkOrdinary])await page.getByRole('checkbox',{name:`Select Synthetic browser monthly work order ${item.title}`,exact:true}).check();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('wolf-forge:projects-bulk-action',{detail:{kind:'status'}})));
    const bulk=page.getByRole('dialog');await bulk.getByLabel('New status',{exact:true}).selectOption({label:'Complete'});await bulk.getByRole('button',{name:'Apply',exact:true}).click();await waitRow(bulkOrdinary.id,'complete');await sheet(page).waitFor();assert.equal((await row(bulkMonthly.id)).status,'working');
    await page.keyboard.press('Escape');
    check('Ordinary work completes normally; real bulk server action completes ordinary work and gates monthly work (existing event seam, launcher absent)');

    step='unauthorized, cross-tenant and revoked sessions';
    const restricted=await createOrder(f,{month:exceptionMonth,title:'Synthetic revoked completion'});
    await denied(f.accounts.client.client,'app_change_order_status',{p_order_id:restricted.id,p_status:'complete'},'42501');
    await denied(f.accounts.client.client,'app_complete_order_without_report',{...scope(restricted.id,exceptionMonth),p_reason:'Client cannot waive'},'42501');
    const deniedRead=await f.accounts.otherClient.client.from('orders').select('id').eq('id',restricted.id);
    if(deniedRead.error)assert.equal(deniedRead.error.code,'42501');else assert.deepEqual(deniedRead.data,[],'Unrelated Client can read the order');
    await client.goto(origin+'/orders/'+restricted.id,{waitUntil:'networkidle'});assert.ok(!new URL(client.url()).pathname.startsWith('/orders/'));
    const foreignTenant=randomUUID(),foreignCompany=randomUUID(),foreignOrder=randomUUID(),foreignService=randomUUID();
    await sql("insert into public.tenants(id,slug,display_name) values(:'tenant',:'slug','Synthetic other Tenant');insert into public.companies(id,tenant_id,name) values(:'company',:'tenant','Synthetic foreign client');insert into public.services(id,tenant_id,name,price,currency) values(:'service',:'tenant','Synthetic foreign Service',1,'USD');insert into public.orders(id,tenant_id,company_id,service_id,title) values(:'order',:'tenant',:'company',:'service','Synthetic foreign work');",{tenant:foreignTenant,slug:'monthly-'+foreignTenant,company:foreignCompany,order:foreignOrder,service:foreignService});
    await denied(owner.client,'app_change_order_status',{p_order_id:foreignOrder,p_status:'complete'},'P0002');
    await denied(owner.client,'app_complete_order_for_reporting_month',scope(foreignOrder,exceptionMonth),'P0002');
    await denied(owner.client,'app_complete_order_without_report',{...scope(foreignOrder,exceptionMonth),p_reason:'Foreign scope'},'P0002');
    const managerPage=await pageFor('manager');dialog=await missing(managerPage,restricted.id);await dialog.getByRole('button',{name:'Report not required'}).click();await dialog.getByLabel('Reason',{exact:true}).fill('Revoked while modal open');
    await sql("insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values(:'tenant',:'actor','projects.edit',false);",{tenant,actor:f.accounts.manager.id});
    await dialog.getByRole('button',{name:'Record exception and complete'}).click();await dialog.getByRole('alert').waitFor();assert.equal((await row(restricted.id)).status,'working');assert.equal((await evidence(restricted.id)).exceptions.length,0);
    await denied(f.accounts.manager.client,'app_complete_order_without_report',{...scope(restricted.id,exceptionMonth),p_reason:'Revoked retry'},'42501');
    await sql("update public.tenant_memberships set archived_at=now() where tenant_id=:'tenant' and profile_id=:'actor';",{tenant,actor:f.accounts.manager.id});
    await denied(f.accounts.manager.client,'app_change_order_status',{p_order_id:restricted.id,p_status:'complete'},'42501');
    await denied(f.accounts.staff.client,'app_complete_order_without_report',{...scope(restricted.id,exceptionMonth),p_reason:'Staff cannot waive'},'42501');
    check('Client/Staff and foreign-Tenant denial; stale Manager sheet and direct retries recheck permission/membership revocation');
    assert.equal(await protectedState(),protectedBefore,'Historical/report/task/billing state changed');
    await goto(client,'/account/projects/'+order.id);await client.getByText('50%',{exact:true}).first().waitFor();
    check('Task-based client progress remains 50%; historical order/report, invoice and subscription fingerprints unchanged');
    assert.equal(result.pageErrors.length,0,'Uncaught browser exceptions');assert.equal(result.externalRequests.length,0,'Unexpected external browser request');assert.ok(result.actions.length>=10,'Insufficient actual server-action evidence');
    result.status='passed';result.calendar.actualFinishedAt=new Date().toISOString();
  }catch(error){result.status='failed';result.failedStep=step;result.error=scrub(error.message);throw error;}
  finally{
    await recordPhase('browser',result);
    if(browser)await browser.close();
    if(proxy){proxy.closeAllConnections();await new Promise(done=>proxy.close(done));}
    if(server && server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(done=>server.once('exit',done)),delay(2000)]);if(server.exitCode===null)server.kill('SIGKILL');}
  }
}
