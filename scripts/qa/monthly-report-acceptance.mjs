import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename, lstat, realpath } from 'node:fs/promises';
import { resolve, join, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

export const branch='codex/woad-monthly-report-gate-20261108';
export const tenant='f0f0f0f0-0000-4000-8000-000000000001';
export const gmb='5f000000-0000-4000-8000-000000000318';
export const seo='5f000000-0000-4000-8000-000000000546';
const migrations=[
  ['20261108080017_monthly_report_completion_gate.sql','cdbe85dcbd2341d35db560ae2efe550be6c821e7115b62c6acfe8691d91adf45'],
  ['20261108173532_explicit_order_reporting_month.sql','5f0d1079110bd4b9ea233cb8f485c0e728d1e3509e04c26bf922147ef914768e'],
];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const need=(condition,message)=>assert.ok(condition,message);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const secretValues=new Set();
export function scrub(value){
  let text=String(value);
  for(const secret of secretValues)text=text.split(secret).join('[redacted]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted session]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[redacted connection]').slice(0,1500);
}
export function assertRunner(env,platform,head){
  need(platform==='linux' && env.CI==='true' && env.GITHUB_ACTIONS==='true' && env.RUNNER_OS==='Linux' && env.RUNNER_ENVIRONMENT==='github-hosted','Requires an actual GitHub-hosted Linux runner');
  need(env.GITHUB_REPOSITORY==='UplineTonyuo/wolf-forge-platform' && env.GITHUB_REF_NAME===branch,'Wrong repository or branch');
  need(/^\d+$/.test(env.GITHUB_RUN_ID??'') && env.GITHUB_RUN_ATTEMPT==='1','Only one first attempt is authorized');
  need(/^[a-f0-9]{40}$/.test(env.EXPECTED_SHA??'') && head===env.EXPECTED_SHA,'Reviewed source SHA mismatch');
  for(const name of ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','DATABASE_URL','VERCEL','VERCEL_TOKEN','LOCAL_UI_QA_BYPASS','SENTRY_AUTH_TOKEN'])need(!env[name],`Forbidden inherited configuration: ${name}`);
}
export function loopback(value,protocol){
  const url=new URL(value);
  need(url.protocol===protocol && ['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Only loopback destinations are allowed');
  need(!url.search && !url.hash,'Unexpected target query or fragment');
  if(protocol==='http:')need(!url.username && !url.password && url.pathname==='/','Unexpected API credentials or path');
  else need(url.username==='postgres' && url.pathname==='/postgres','Unexpected database identity');
  return url;
}
export function assertLedger(rows,versions,prior=[]){
  assert.deepEqual(rows.map(row=>row.version).sort(),[...versions].sort(),'Migration ledger does not match the exact candidate');
  for(const row of prior)need(rows.find(item=>item.version===row.version)?.source===row.source,'Prior migration source changed');
}
export function assertOwnedContainer(inspect,state){
  need(inspect.Id===state.containerId && inspect.Name==='/supabase_db_'+state.project && inspect.State?.Running,'Container ownership mismatch');
  need(inspect.Config?.Labels?.['com.supabase.cli.project']===state.project,'Container project label mismatch');
  need(inspect.NetworkSettings?.Ports?.['5432/tcp']?.some(binding=>binding.HostPort==='54322'),'Database port binding mismatch');
  need(inspect.Mounts?.some(mount=>mount.Type==='volume' && mount.Name===state.volume && mount.Destination==='/var/lib/postgresql/data'),'Database volume ownership mismatch');
}
export function assertProjectConfig(config,project){
  const values=[...config.matchAll(/^project_id\s*=\s*"([^"\r\n]+)"\s*$/gm)].map(match=>match[1]);
  assert.deepEqual(values,[project],'Local CLI target changed or is ambiguous');
}
export function assertEvidenceName(name){
  need(name==='summary.json' || name==='browser.json' || name==='races.json' || name==='bootstrap.json' || /^[a-z][a-z0-9-]{0,80}\.png$/.test(name),'Unsafe evidence name');
}
export function lateWorkPeriod(now=new Date()){
  const year=now.getUTCFullYear()-1;
  return {work:`${year}-11-01`,wrong:`${year}-10-01`,started:`${year}-10-15T00:00:00+08:00`};
}
export function capture(command,args,input,timeout=30000){
  return new Promise((accept,reject)=>{
    const child=execFile(command,args,{encoding:'utf8',timeout,maxBuffer:16*2**20},(error,stdout,stderr)=>{
      if(error){const diagnostic=scrub(stderr).split(/\r?\n/).filter(line=>/error|failed/i.test(line)).slice(0,3).join(' ').slice(0,600);reject(new Error(`Captured ${basename(command)} failed (${error.code??'unknown'}): ${diagnostic}`));}
      else accept(stdout.trim());
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(input??'');
  });
}
export async function privateDirectory(){
  need(process.env.RUNNER_TEMP,'RUNNER_TEMP missing');
  const base=await realpath(process.env.RUNNER_TEMP), dir=join(base,'monthly-report-'+process.env.GITHUB_RUN_ID+'-1');
  await mkdir(dir,{recursive:true,mode:0o700});
  need((await realpath(dir)).startsWith(base+sep),'Unsafe task directory');
  return dir;
}
const root=privateDirectory;
async function saveState(state){await writeFile(join(await root(),'state.json'),JSON.stringify(state),{mode:0o600});}
export async function loadState(){return JSON.parse(await readFile(join(await root(),'state.json'),'utf8'));}
export async function recordPhase(name,data){
  const dir=join(await root(),'evidence');await mkdir(dir,{recursive:true,mode:0o700});
  assertEvidenceName(name+'.json');await writeFile(join(dir,name+'.json'),JSON.stringify(data,null,2),{mode:0o600});
  console.log(JSON.stringify({phase:name,status:data.status,checks:data.checks?.length??0}));
}
export async function verifyRunner(){
  const head=await capture('git',['rev-parse','HEAD']);assertRunner(process.env,process.platform,head);
  const origin=await capture('git',['remote','get-url','origin']);
  need(/^https:\/\/github\.com\/UplineTonyuo\/wolf-forge-platform(?:\.git)?$/.test(origin),'Unexpected checkout origin');
  return head;
}
async function inspectContainer(name){return JSON.parse(await capture('docker',['inspect',name]))[0];}
export async function target(){
  await verifyRunner();
  const state=await loadState();need(state.sha===process.env.EXPECTED_SHA && state.runId===process.env.GITHUB_RUN_ID,'Foreign task journal');
  assertProjectConfig(await readFile('supabase/config.toml','utf8'),state.project);
  const inspect=await inspectContainer('supabase_db_'+state.project);assertOwnedContainer(inspect,state);
  const status=JSON.parse(await capture(resolve('node_modules/.bin/supabase'),['status','--output','json']));
  need(loopback(status.API_URL,'http:').port==='54321' && loopback(status.DB_URL,'postgresql:').port==='54322','Unexpected target ports');
  const publicKey=status.PUBLISHABLE_KEY||status.ANON_KEY, serverKey=status.SECRET_KEY||status.SERVICE_ROLE_KEY;
  need(publicKey&&serverKey,'Local keys unavailable');secretValues.add(publicKey);secretValues.add(serverKey);secretValues.add(status.DB_URL);
  return {state,status,publicKey,serverKey};
}
export async function sql(statement,variables={}){
  const state=await loadState();
  const args=['exec','-i','supabase_db_'+state.project,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'];
  for(const [key,value] of Object.entries(variables)){need(/^[a-z_]+$/.test(key),'Invalid SQL parameter');args.push('-v',`${key}=${typeof value==='string'?value:JSON.stringify(value)}`);}
  return capture('docker',args,statement);
}
async function ledger(){return JSON.parse(await sql("select coalesce(json_agg(json_build_object('version',version,'source',md5(coalesce(array_to_string(statements,E'\\n'),''))) order by version),'[]') from supabase_migrations.schema_migrations;"));}
async function restoreHeld(state){
  for(const [name,digest] of migrations){
    const source=join('supabase/migrations',name),held=join(await root(),name);
    try{need(sha(await readFile(source))===digest,'Unexpected candidate migration bytes');}
    catch(error){if(error.code!=='ENOENT')throw error;need(sha(await readFile(held))===digest,'Held candidate migration changed');await rename(held,source);}
  }
  state.filesRestored=true;await saveState(state);
}
async function bootstrap(){
  const head=await verifyRunner(), dir=await root();
  const original=await readFile('supabase/config.toml');
  const names=(await readdir('supabase/migrations')).filter(name=>/^\d{14}_.+\.sql$/.test(name)).sort();
  for(const [name,digest] of migrations)need(sha(await readFile(join('supabase/migrations',name)))===digest,'Candidate migration digest mismatch');
  const state={sha:head,runId:process.env.GITHUB_RUN_ID,project:`monthly-${process.env.GITHUB_RUN_ID}-1`,originalConfig:original.toString('base64'),versions:names.map(name=>name.slice(0,14)),startedAt:Date.now(),filesRestored:false};
  await saveState(state);
  for(const [name] of migrations)await rename(join('supabase/migrations',name),join(dir,name));
  const config=original.toString('utf8');need((config.match(/^project_id\s*=/gm)||[]).length===1,'Ambiguous local config');
  await writeFile('supabase/config.toml',config.replace(/^project_id\s*=.*$/m,`project_id = "${state.project}"`));
  await capture(resolve('node_modules/.bin/supabase'),['start','--yes'],null,9*60*1000);
  const inspect=await inspectContainer('supabase_db_'+state.project);
  need(new Date(inspect.Created).getTime()>=state.startedAt-5000,'Pre-existing container refused');
  const mount=inspect.Mounts?.find(item=>item.Type==='volume'&&item.Destination==='/var/lib/postgresql/data');
  need(mount?.Name,'Owned data volume missing');state.containerId=inspect.Id;state.volume=mount.Name;await saveState(state);
  await target();
  need(await sql("select current_database()='postgres' and current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999;")==='t','Unexpected database identity/version');
  need(await sql('select not exists(select 1 from auth.users) and not exists(select 1 from public.orders) and not exists(select 1 from public.invoices) and not exists(select 1 from public.subscriptions);')==='t','Fresh synthetic-only baseline required');
  const before=await ledger(), candidateVersions=migrations.map(([name])=>name.slice(0,14));
  assertLedger(before,state.versions.filter(version=>!candidateVersions.includes(version)));
  state.priorLedger=before;await saveState(state);
  await restoreHeld(state);
  await capture(resolve('node_modules/.bin/supabase'),['migration','up','--local'],null,120000);
  const after=await ledger();assertLedger(after,state.versions,before);
  const controls=JSON.parse(await sql("select json_build_object('privateEvidence',not has_table_privilege('authenticated','private.order_report_exceptions','SELECT'),'anonymousDenied',not has_function_privilege('anon','public.app_complete_order_for_reporting_month(uuid,uuid,date)','EXECUTE'),'explicitMonthOnly',position('p_order.reporting_period_month' in pg_get_functiondef('private.order_reporting_month(public.orders)'::regprocedure))>0,'emptySearchPath',(select bool_and(proconfig @> array['search_path=\"\"']) from pg_proc where oid in ('public.app_set_order_reporting_month(uuid,uuid,date)'::regprocedure,'public.app_complete_order_for_reporting_month(uuid,uuid,date)'::regprocedure)));"));
  need(Object.values(controls).every(Boolean),'Database control readback failed');
  state.migrated=true;await saveState(state);
  await recordPhase('bootstrap',{status:'passed',sha:head,project:state.project,containerId:state.containerId,volume:state.volume,migrations:after.length,controls,checks:['Fresh runner-owned loopback target verified','Only the two candidate migrations applied in chronological order','Every prior ledger source hash preserved']});
}
export function apiOptions(apiUrl){return {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{'x-wf-tenant':tenant},fetch:(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);need(url.origin===apiUrl,'Supabase request escaped the disposable API');return fetch(input,{...init,redirect:'error',signal:init.signal||AbortSignal.timeout(20000)});
}}};}
export async function rpc(client,name,args){const result=await client.rpc(name,args);need(!result.error,`${name} refused (${result.error?.code??'unknown'})`);return result.data;}
export async function denied(client,name,args,code){const result=await client.rpc(name,args);need(Boolean(result.error)&&(!code||result.error.code===code),`${name} did not refuse with ${code??'an error'}`);return result.error.code;}
export async function makeFixtures(prefix){
  const local=await target(), {status,publicKey,serverKey}=local, options=apiOptions(status.API_URL);
  const admin=createClient(status.API_URL,serverKey,options), company=randomUUID(), otherCompany=randomUUID(), emptyCompany=randomUUID();
  await sql("insert into public.companies(id,name,status) values(:'company',:'name','client'),(:'other',:'other_name','client'),(:'empty',:'empty_name','client');",{company,other:otherCompany,empty:emptyCompany,name:`Synthetic ${prefix} monthly work`,other_name:`Synthetic ${prefix} unrelated client`,empty_name:`Synthetic ${prefix} empty client`});
  const accounts={};
  for(const key of ['owner','admin','manager','client','staff','otherClient']){
    const role=key==='otherClient'?'client':key;
    const password=randomBytes(32).toString('base64url');secretValues.add(password);
    const email=`monthly-${prefix}-${key}-${randomUUID()}@example.invalid`;
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    need(!created.error && uuid.test(created.data.user?.id??''),'Synthetic Auth identity creation failed');
    const id=created.data.user.id;
    await sql("update public.profiles set role_id=(select id from public.roles where name=:'role'),company_id=case when :'role'='client' then :'company'::uuid else null end,display_name='Synthetic monthly QA' where id=:'id';",{role,company:key==='otherClient'?otherCompany:company,id});
    const cookies=[];
    const client=createServerClient(status.API_URL,publicKey,{...options,cookies:{getAll:()=>cookies,setAll:items=>{for(const item of items){const index=cookies.findIndex(cookie=>cookie.name===item.name);if(index>=0)cookies.splice(index,1);cookies.push(item);}}}});
    const signed=await client.auth.signInWithPassword({email,password});need(!signed.error&&signed.data.session&&signed.data.user.id===id,'Legitimate password sign-in failed');
    secretValues.add(signed.data.session.access_token);secretValues.add(signed.data.session.refresh_token);
    accounts[key]={id,client,cookies,claims:JSON.parse(Buffer.from(signed.data.session.access_token.split('.')[1],'base64url').toString('utf8'))};
  }
  const ordinary=randomUUID();await sql("insert into public.services(id,name,price,currency) values(:'id','Synthetic ordinary investment',1,'USD');",{id:ordinary});
  return {...local,admin,accounts,company,otherCompany,emptyCompany,ordinary,options,prefix};
}
export async function createOrder(fixture,{service=gmb,company=fixture.company,month=null,title='Synthetic monthly work'}={}){
  const order=await rpc(fixture.accounts.owner.client,'app_create_order',{p_request_id:randomUUID(),p_company_id:company,p_service_id:service,p_title:title,p_started_at:lateWorkPeriod().started});
  await rpc(fixture.accounts.owner.client,'app_change_order_status',{p_order_id:order.id,p_status:'working'});
  if(month)await rpc(fixture.accounts.owner.client,'app_set_order_reporting_month',{p_order_id:order.id,p_service_id:service,p_reporting_period_month:month});
  return order;
}
export async function createReport(fixture,{company=fixture.company,service=gmb,month=lateWorkPeriod().work,title='Synthetic published monthly report',publish=false}={}){
  const report=await rpc(fixture.accounts.owner.client,'app_create_report_draft',{p_request_id:randomUUID(),p_payload:{company_id:company,service_id:service,reporting_period_month:month,report_lane:'gmb_management',package_label:'Synthetic GMB',title,sections:[{section_key:'custom',title:'Synthetic work delivered',entries:[{label:'Monthly work',value:'Completed synthetic work',url:null}]}]}});
  if(publish)await rpc(fixture.accounts.owner.client,'app_send_report_draft',{p_request_id:randomUUID(),p_report_id:report.id});
  return report;
}
export async function fingerprint(){return sql("select md5(coalesce(json_agg(v order by v)::text,'')) from (select json_build_object('id',id,'status',status,'month',reporting_period_month,'complete',completed_at)::text v from public.orders union all select json_build_object('task',id,'status',status,'complete',completed_at)::text from public.order_tasks union all select json_build_object('invoice',id,'status',status)::text from public.invoices union all select json_build_object('subscription',id,'status',status)::text from public.subscriptions) x;");}
async function evidence(){
  await verifyRunner();const directory=join(await root(),'evidence');await mkdir(directory,{recursive:true});
  const summaries={sha:process.env.EXPECTED_SHA,runId:process.env.GITHUB_RUN_ID,calendar:'Real dates only; literal December cases are SQL fixtures',build:process.env.BUILD_OUTCOME??'pending',database:process.env.DATABASE_OUTCOME??'pending',bootstrap:process.env.BOOTSTRAP_OUTCOME??'pending',races:process.env.RACES_OUTCOME??'pending',browser:process.env.BROWSER_OUTCOME??'pending'};
  await writeFile(join(directory,'summary.json'),JSON.stringify(summaries,null,2));
  const entries=await readdir(directory);let bytes=0;
  for(const name of entries){assertEvidenceName(name);const file=join(directory,name),meta=await lstat(file);need(meta.isFile()&&!meta.isSymbolicLink(),'Unsafe evidence entry');bytes+=meta.size;
    if(name.endsWith('.json')){const text=await readFile(file,'utf8');JSON.parse(text);need(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"(?:password|access_token|refresh_token|service_role_key|cookies)"\s*:/i.test(text),'Sensitive evidence refused');}
    else need((await readFile(file)).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Screenshot is not PNG');
  }
  need(bytes<=20*2**20,'Evidence exceeds 20 MiB');
  const dest=resolve('artifacts/monthly-report-sanitized');await mkdir(dest,{recursive:true});need((await readdir(dest)).length===0,'Evidence staging directory was not empty');
  for(const name of entries)await writeFile(join(dest,name),await readFile(join(directory,name)));
  console.log(JSON.stringify({phase:'evidence',status:'passed',files:entries.length,bytes}));
}
async function cleanup(){
  await verifyRunner();let state;try{state=await loadState();}catch(error){if(error.code==='ENOENT')return;throw error;}
  need(state.sha===process.env.EXPECTED_SHA && state.runId===process.env.GITHUB_RUN_ID,'Foreign cleanup journal');
  if(state.containerId){await target();await capture(resolve('node_modules/.bin/supabase'),['stop','--no-backup'],null,120000);}
  else {
    const containers=await capture('docker',['ps','-aq','--filter','label=com.supabase.cli.project='+state.project]);
    need(!containers,'Partial startup has unjournaled containers; refusing cleanup (disposable runner teardown required)');
  }
  await restoreHeld(state);
  await writeFile('supabase/config.toml',Buffer.from(state.originalConfig,'base64'));
  console.log(JSON.stringify({phase:'cleanup',status:'passed',ownedProject:state.project}));
}

async function main(){
  const phase=process.argv[2];
  if(phase==='bootstrap')await bootstrap();
  else if(phase==='browser')await (await import('./monthly-report-browser.mjs')).browserAcceptance();
  else if(phase==='evidence')await evidence();
  else if(phase==='cleanup')await cleanup();
  else throw Error('Unknown acceptance phase');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await main();}catch(error){console.error(JSON.stringify({phase:process.argv[2],status:'failed',error:scrub(error.message)}));process.exitCode=1;}
}
