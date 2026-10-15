const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const source=path.resolve(__dirname,'..');
const guard='C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Parallel-Setup-20261012/publication-test-environment.cjs';
const container='6f1db0d6b4a8c393e968f4de6af958937c69bfc6a2eed0c8ab163c37b8d40416';
const runId=crypto.randomUUID(),actor=crypto.randomUUID(),otherActor=crypto.randomUUID();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const run=(exe,args,options={})=>execFileSync(exe,args,{cwd:source,encoding:'utf8',windowsHide:true,maxBuffer:32e6,...options});
const sql=query=>run('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:query}).trim();
const verify=()=>JSON.parse(run(process.execPath,[guard,'verify','--require-source']));
const last=text=>text.trim().split(/\r?\n/).at(-1);
const asActor=(tenant,id=actor)=>`select set_config('request.jwt.claim.sub',${q(id)},true);select set_config('request.headers',${q(JSON.stringify({'x-wf-tenant':tenant}))},true);`;
const publish=(tenant,request,sourceRevision=1,expected=0,reason='Reviewed race')=>`select public.app_publish_white_label_draft(${q(tenant)},${sourceRevision},${expected},${q(request)},${q(reason)});`;
const reconcile=(tenant,request)=>`select public.app_reconcile_white_label_publication(${q(tenant)},1,0,${q(request)},'Reviewed race');`;
const outcomes=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function session(){
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{cwd:source,windowsHide:true});
  let buffer='',stderr='',pending,exited=false;
  child.stdout.on('data',chunk=>{buffer+=chunk; if(pending&&buffer.includes(pending.marker)){const value=buffer.slice(0,buffer.indexOf(pending.marker));buffer=buffer.slice(buffer.indexOf(pending.marker)+pending.marker.length);const done=pending;pending=undefined;clearTimeout(done.timeout);done.resolve(value.trim());}});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.on('exit',code=>{exited=true;if(pending){clearTimeout(pending.timeout);pending.reject(new Error(`psql ${code}: ${stderr.slice(-2500)}`));pending=undefined;}});
  const result={
    query(query){assert(!pending,'Only one outstanding statement per session');return new Promise((resolve,reject)=>{if(exited)return reject(new Error('Session exited: '+stderr));const marker='__wf_'+crypto.randomUUID();pending={marker,resolve,reject,timeout:setTimeout(()=>{child.kill();reject(new Error('Session timeout'));},25000)};child.stdin.write(query+'\n\\echo '+marker+'\n');});},
    close(){if(!exited){child.stdin.end('\\q\n');}},
    pid:null,
  };
  result.pid=Number(last(await result.query("set statement_timeout='20s';select pg_backend_pid();")));
  return result;
}
async function blocked(s){
  const until=Date.now()+8000;
  while(Date.now()<until){if(sql(`begin read only;select cardinality(pg_blocking_pids(${s.pid}))>0;commit;`)==='t')return;await sleep(60);}
  throw new Error('No real blocked waiter observed: '+s.pid);
}
const attempt=promise=>promise.then(value=>({value}),error=>({error}));
const expectError=(result,state)=>{assert(result.error,'Expected SQL refusal, got '+result.value);assert(result.error.message.includes(state),result.error.message);};
function setupTenant(){
  const tenant=crypto.randomUUID();
  sql(`begin;insert into public.tenants(id,slug,display_name,status)values(${q(tenant)},${q('pub-'+tenant)},'Publication race fixture','active');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)select ${q(tenant)},${q(actor)},'internal',id from public.roles where name='admin';
${asActor(tenant)}select * from public.app_save_white_label_draft(${q(tenant)},0,'Reviewed name','#14213d','#fca311',array['services']);commit;`);
  return tenant;
}
const counts=tenant=>JSON.parse(sql(`begin read only;select json_build_object('parents',(select count(*) from private.tenant_module_publications where tenant_id=${q(tenant)}),
'snapshots',(select count(*) from private.tenant_white_label_publications where tenant_id=${q(tenant)}),'audits',(select count(*) from public.security_audit_events where event_code='authorization.white_label.published' and resource_id=${q(tenant)}));commit;`));
const regrant=()=>sql(`begin;select private.grant_platform_admin(${q(actor)},'Restore synthetic race authority');commit;`);
const revoke=()=>sql(`begin;select private.revoke_platform_admin(${q(actor)},'Synthetic post-wait revocation');commit;`);
async function test(name,body){await body();outcomes.push({name,result:'PASS'});console.log('PASS '+name);}
async function withPair(body){const a=await session(),b=await session();try{await body(a,b);}finally{a.close();b.close();}}

async function main(){
  verify();
  sql(`begin;insert into auth.users(id,aud,role,email,created_at,updated_at)values(${q(actor)},'authenticated','authenticated',${q('pub-race-'+actor+'@example.invalid')},now(),now()),(${q(otherActor)},'authenticated','authenticated',${q('pub-race-'+otherActor+'@example.invalid')},now(),now());
update public.profiles set role_id=(select id from public.roles where name='admin')where id in(${q(actor)},${q(otherActor)});
select private.grant_platform_admin(${q(actor)},'Synthetic publication races');select private.grant_platform_admin(${q(otherActor)},'Synthetic publication races');commit;`);
  await test('same request: one publication, one exact retry',()=>withPair(async(a,b)=>{
    const tenant=setupTenant(),request=crypto.randomUUID();await a.query('begin;'+asActor(tenant)+publish(tenant,request));
    const waiter=attempt(b.query('begin;'+asActor(tenant)+publish(tenant,request)));await blocked(b);await a.query('commit;');
    const result=await waiter;assert(!result.error,result.error?.message);assert.equal(JSON.parse(last(result.value)).outcome,'already_applied');await b.query('commit;');
    assert.deepEqual(counts(tenant),{parents:1,snapshots:1,audits:1});
  }));
  await test('different requests: stale publication loser',()=>withPair(async(a,b)=>{
    const tenant=setupTenant();await a.query('begin;'+asActor(tenant)+publish(tenant,crypto.randomUUID()));
    const waiter=attempt(b.query('begin;'+asActor(tenant)+publish(tenant,crypto.randomUUID())));await blocked(b);await a.query('commit;');expectError(await waiter,'WF409');
    assert.deepEqual(counts(tenant),{parents:1,snapshots:1,audits:1});
  }));
  await test('same publisher/request across Tenants: global binding conflict',()=>withPair(async(a,b)=>{
    const tenant=setupTenant(),foreign=setupTenant(),request=crypto.randomUUID();await a.query('begin;'+asActor(tenant)+publish(tenant,request));
    const waiter=attempt(b.query('begin;'+asActor(foreign)+publish(foreign,request)));await blocked(b);await a.query('commit;');expectError(await waiter,'WF409');
    assert.deepEqual(counts(foreign),{parents:0,snapshots:0,audits:0});
  }));
  await test('in-flight absence then same-ID retry reconciles the committed result',()=>withPair(async(a,b)=>{
    const tenant=setupTenant(),request=crypto.randomUUID();await a.query('begin;'+asActor(tenant)+publish(tenant,request));
    const absent=await b.query('begin;'+asActor(tenant)+reconcile(tenant,request));assert.equal(JSON.parse(last(absent)).outcome,'not_found');await b.query('commit;');
    const waiter=attempt(b.query('begin;'+asActor(tenant)+publish(tenant,request)));await blocked(b);await a.query('commit;');
    const result=await waiter;assert(!result.error,result.error?.message);assert.equal(JSON.parse(last(result.value)).outcome,'already_applied');await b.query('commit;');
    const recovered=JSON.parse(last(sql('begin;'+asActor(tenant)+reconcile(tenant,request)+'commit;')));assert.equal(recovered.outcome,'applied');assert.deepEqual(counts(tenant),{parents:1,snapshots:1,audits:1});
  }));
  await test('draft save first: stale reviewed revision refuses after a real wait',()=>withPair(async(a,b)=>{
    const tenant=setupTenant();await a.query('begin;'+asActor(tenant)+`select * from public.app_save_white_label_draft(${q(tenant)},1,'Changed while waiting','#14213d','#fca311',array['services']);`);
    const waiter=attempt(b.query('begin;'+asActor(tenant)+publish(tenant,crypto.randomUUID())));await blocked(b);await a.query('commit;');expectError(await waiter,'WF409');
    assert.deepEqual(counts(tenant),{parents:0,snapshots:0,audits:0});
  }));
  await test('publication first: later save cannot alter the committed snapshot',()=>withPair(async(a,b)=>{
    const tenant=setupTenant();await a.query('begin;'+asActor(tenant)+publish(tenant,crypto.randomUUID()));
    const waiter=attempt(b.query('begin;'+asActor(tenant)+`select * from public.app_save_white_label_draft(${q(tenant)},1,'Later draft','#14213d','#fca311',array['services']);`));await blocked(b);await a.query('commit;');
    const result=await waiter;assert(!result.error,result.error?.message);await b.query('commit;');
    const runtime=JSON.parse(last(sql('begin;'+asActor(tenant)+'select public.app_get_runtime_white_label_configuration();commit;')));assert.equal(runtime.configuration.displayName,'Reviewed name');
  }));
  for(const waitKind of ['Tenant','request','draft'])await test('PA revocation after '+waitKind+' wait refuses before publication',()=>withPair(async(a,b)=>{
    const tenant=setupTenant(),request=crypto.randomUUID();
    if(waitKind==='Tenant')await a.query(`begin;select 1 from public.tenants where id=${q(tenant)} for update;`);
    else if(waitKind==='request'){const other=setupTenant();await a.query('begin;'+asActor(other)+publish(other,request));}
    else await a.query(`begin;select 1 from private.tenant_white_label_drafts where tenant_id=${q(tenant)} for update;`);
    const waiter=attempt(b.query('begin;'+asActor(tenant)+publish(tenant,request)));await blocked(b);revoke();await a.query('commit;');expectError(await waiter,'42501');regrant();
    assert.deepEqual(counts(tenant),{parents:0,snapshots:0,audits:0});
  }));
  await test('Tenant suspension committed first is rechecked after Tenant wait',()=>withPair(async(a,b)=>{
    const tenant=setupTenant();await a.query(`begin;update public.tenants set status='suspended' where id=${q(tenant)};`);
    const waiter=attempt(b.query('begin;'+asActor(tenant)+publish(tenant,crypto.randomUUID())));await blocked(b);await a.query('commit;');expectError(await waiter,'55000');assert.deepEqual(counts(tenant),{parents:0,snapshots:0,audits:0});
  }));
  await test('committed legacy parent refuses a late exact-matching companion',async()=>{
    const tenant=setupTenant(),request=crypto.randomUUID();sql('begin;'+asActor(tenant)+`select private.publish_tenant_modules(${q(tenant)},0,array['services'],'Legacy committed');commit;`);
    let error;try{sql('begin;'+asActor(tenant)+`insert into private.tenant_white_label_publications(tenant_id,publication_revision,display_name,primary_color,accent_color,source_draft_revision,source_draft_updated_at,source_draft_updated_by,expected_publication_revision,request_id,published_by,published_at,reason)
select p.tenant_id,p.revision,d.display_name,d.primary_color,d.accent_color,d.revision,d.updated_at,d.updated_by,0,${q(request)},p.published_by,p.published_at,p.reason from private.tenant_module_publications p join private.tenant_white_label_drafts d on d.tenant_id=p.tenant_id where p.tenant_id=${q(tenant)};commit;`);}catch(e){error=e;}
    assert(error?.stderr?.includes('55000'),error?.message);assert.deepEqual(counts(tenant),{parents:1,snapshots:0,audits:0});
  });
  for(const isolation of ['repeatable read','serializable'])await test(isolation+' fails closed',async()=>{
    const tenant=setupTenant();let error;try{sql('begin isolation level '+isolation+';'+asActor(tenant)+publish(tenant,crypto.randomUUID())+'commit;');}catch(e){error=e;}
    assert(error?.stderr?.includes('55000'),error?.message);assert.deepEqual(counts(tenant),{parents:0,snapshots:0,audits:0});
  });
  for(const kind of ['parent','companion','transaction-stamp'])await test('malformed '+kind+' refuses runtime, rollback restores exact publication',async()=>{
    const tenant=setupTenant();sql('begin;'+asActor(tenant)+publish(tenant,crypto.randomUUID())+'commit;');
    const isParent=kind!=='companion',table=isParent?'tenant_module_publications':'tenant_white_label_publications',trigger=table+'_validate';
    const before=sql(`begin read only;select jsonb_agg(to_jsonb(p) order by p.tenant_id,p.${isParent?'revision':'publication_revision'}) from private.${table} p;commit;`);
    const corrupt=kind==='parent'?"module_keys=array['forms']":kind==='transaction-stamp'?'publication_transaction_id=null':"published_by="+q(otherActor);
    let error;try{sql(`begin;alter table private.${table} disable trigger ${trigger};update private.${table} set ${corrupt} where tenant_id=${q(tenant)};`+asActor(tenant)+'select public.app_get_runtime_white_label_configuration();rollback;');}catch(e){error=e;}
    assert(error?.stderr?.includes('55000'),error?.message);
    assert.equal(sql(`begin read only;select jsonb_agg(to_jsonb(p) order by p.tenant_id,p.${isParent?'revision':'publication_revision'}) from private.${table} p;commit;`),before);
    assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.${table}'::regclass and tgname=${q(trigger)};`),'O');
  });
  verify();
  const proof={runId,executedAt:new Date().toISOString(),container,systemIdentifier:'7696121223199268902',sqlOnly:true,realBlockedWaits:10,outcomes,syntheticActors:[actor,otherActor],fixturesRetained:true,apiTransportTested:false};
  const evidence=path.join(process.env.LOCALAPPDATA,'Temp','wolf-forge-publication-evidence-20261015');fs.mkdirSync(evidence,{recursive:true});const target=path.join(evidence,'races-'+runId+'.json');fs.writeFileSync(target,JSON.stringify(proof,null,2)+'\n');assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),proof);
  console.log(JSON.stringify({result:'PASS',cases:outcomes.length,evidence:target,apiTransportTested:false}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
