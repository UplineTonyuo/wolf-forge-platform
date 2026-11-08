import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyRunner, target, loadState, makeFixtures, createOrder, createReport, rpc, denied, sql, gmb, seo, tenant, lateWorkPeriod, recordPhase, scrub } from './monthly-report-acceptance.mjs';

const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const period=lateWorkPeriod();
const checks=[];
const sessions=new Set();
let phase='initial guards';
class Session {
  constructor(project,name){
    this.child=spawn('docker',['exec','-i','supabase_db_'+project,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=0','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});
    this.name=name;this.pending=null;this.child.stderr.resume();sessions.add(this);
    createInterface({input:this.child.stdout}).on('line',line=>{
      const pending=this.pending;if(!pending)return;
      if(line.startsWith(pending.marker+' state ')){pending.code=line.slice((pending.marker+' state ').length).trim();return;}
      if(line===pending.marker+' done'){clearTimeout(pending.timer);this.pending=null;pending.accept({rows:pending.rows,code:pending.code});return;}
      pending.rows.push(line);
    });
    this.child.on('exit',()=>{if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Owned SQL session ended'));this.pending=null;}});
  }
  query(statement){
    assert.equal(this.pending,null,'One pending query per physical session');
    return new Promise((accept,reject)=>{
      const marker='monthly_'+randomUUID().replaceAll('-','');
      const timer=setTimeout(()=>{this.pending=null;this.child.kill();reject(new Error('Bounded SQL race timeout'));},20000);
      this.pending={marker,rows:[],code:null,accept,reject,timer};
      this.child.stdin.write(statement+`\n\\echo ${marker} state :SQLSTATE\n\\echo ${marker} done\n`);
    });
  }
  async okay(statement){const result=await this.query(statement);assert.equal(result.code,'00000',`${this.name} unexpected SQLSTATE`);return result.rows;}
  async close(){if(this.child.exitCode===null){this.child.stdin.end();await Promise.race([new Promise(done=>this.child.once('exit',done)),delay(1000)]);if(this.child.exitCode===null)this.child.kill();}sessions.delete(this);}
}
const actor=account=>`select set_config('request.jwt.claims',${quote(JSON.stringify(account.claims))},true);select set_config('request.headers',${quote(JSON.stringify({'x-wf-tenant':tenant}))},true);set local role authenticated;`;
const complete=(id,service=gmb,month=period.work)=>`select public.app_complete_order_for_reporting_month(${quote(id)},${quote(service)},${quote(month)});`;
const exception=(id,reason)=>`select public.app_complete_order_without_report(${quote(id)},${quote(gmb)},${quote(period.work)},${quote(reason)});`;
async function persisted(id){return JSON.parse(await sql("select json_build_object('status',o.status,'service',o.service_id,'month',o.reporting_period_month,'completed',o.completed_at,'exceptions',(select coalesce(json_agg(json_build_object('order',e.order_id,'company',e.company_id,'tenant',e.tenant_id,'service',e.service_id,'month',e.reporting_period_month,'reason',e.reason,'actor',e.actor_profile_id,'at',e.recorded_at)),'[]') from private.order_report_exceptions e where e.order_id=o.id),'exceptionAudit',(select count(*) from public.activity_events where entity_id=o.id and action='order.report_not_required'),'statusAudit',(select count(*) from public.activity_events where entity_id=o.id and action='order.status_changed')) from public.orders o where id=:'id';",{id}));}
async function overlap(project,label,leftSql,rightSql,{leftActor,rightActor,rightCode='00000'}={}){
  phase=label;const a=new Session(project,label+'-a'),b=new Session(project,label+'-b');
  try{
    const [aPid]=await a.okay('select pg_backend_pid();'),[bPid]=await b.okay('select pg_backend_pid();');assert.notEqual(aPid,bPid);
    await a.okay('begin;'+(leftActor?actor(leftActor):''));await b.okay('begin;'+(rightActor?actor(rightActor):''));
    await a.okay(leftSql);
    const waiting=b.query(rightSql);
    let blocked=false;
    for(let n=0;n<40;n++){if(await sql('select cardinality(pg_blocking_pids(:\'pid\'::integer))>0;',{pid:bPid})==='t'){blocked=true;break;}await delay(100);}
    assert.ok(blocked,'Actual overlapping lock wait was not observed');
    await a.okay('commit;');
    const result=await waiting;assert.equal(result.code,rightCode,'Waiting mutation had the wrong outcome');
    await b.okay(result.code==='00000'?'commit;':'rollback;');
    checks.push({case:label,distinctPhysicalSessions:true,blockedWaitObserved:true,result:result.code});
  }finally{await a.close();await b.close();}
}

try{
  await verifyRunner();const {state}=await target();assert.ok(state.migrated,'Candidate not migrated');
  const fixture=await makeFixtures('race'),project=(await loadState()).project;
  const owner=fixture.accounts.owner,manager=fixture.accounts.manager;
  let order=await createOrder(fixture,{month:period.work});
  const report=await createReport(fixture,{publish:true,title:'Synthetic race report'});
  await overlap(project,'month writer before completion',`update public.orders set reporting_period_month=${quote(period.wrong)} where id=${quote(order.id)};`,complete(order.id),{rightActor:owner,rightCode:'22023'});
  assert.equal((await persisted(order.id)).status,'working');
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'Service writer before completion',`update public.orders set service_id=${quote(seo)} where id=${quote(order.id)};`,complete(order.id),{rightActor:owner,rightCode:'22023'});
  assert.equal((await persisted(order.id)).status,'working');
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'completion before month writer',complete(order.id),`select public.app_set_order_reporting_month(${quote(order.id)},${quote(gmb)},${quote(period.wrong)});`,{leftActor:owner,rightActor:owner,rightCode:'23505'});
  assert.equal((await persisted(order.id)).month,period.work);
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'completion before Service writer',complete(order.id),`select public.app_update_order(${quote(order.id)},${quote(JSON.stringify({service_id:seo}))}::jsonb);`,{leftActor:owner,rightActor:owner,rightCode:'WF431'});
  assert.equal((await persisted(order.id)).service,gmb);

  // Remove the genuine report for exception-only and report-archive cases.
  await sql("update public.client_reports set archived_at=now() where id=:'id';",{id:report.id});
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'identical exceptions',exception(order.id,'Same scoped reason'),exception(order.id,'Same scoped reason'),{leftActor:manager,rightActor:owner});
  let row=await persisted(order.id);assert.equal(row.status,'complete');assert.equal(row.exceptions.length,1);assert.equal(row.exceptionAudit,1);assert.equal(row.statusAudit,2);assert.equal(row.exceptions[0].actor,manager.id);assert.equal(row.exceptions[0].company,fixture.company);assert.equal(row.exceptions[0].tenant,tenant);assert.equal(row.exceptions[0].month,period.work);assert.ok(row.exceptions[0].at);
  const originalCompletion=row.completed;
  await rpc(owner.client,'app_complete_order_without_report',{p_order_id:order.id,p_service_id:gmb,p_reporting_period_month:period.work,p_reason:'Same scoped reason'});assert.equal((await persisted(order.id)).completed,originalCompletion);
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'conflicting exceptions',exception(order.id,'Original reason'),exception(order.id,'Conflicting reason'),{leftActor:owner,rightActor:manager,rightCode:'23505'});
  row=await persisted(order.id);assert.equal(row.exceptions[0].reason,'Original reason');assert.equal(row.exceptionAudit,1);assert.equal(row.exceptions.length,1);

  const archiveReport=await createReport(fixture,{publish:true,title:'Synthetic archive race'});
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'report archive before completion',`update public.client_reports set archived_at=now() where id=${quote(archiveReport.id)};`,complete(order.id),{rightActor:owner,rightCode:'WF431'});
  assert.equal((await persisted(order.id)).status,'working');
  const lockingReport=await createReport(fixture,{publish:true,title:'Synthetic locked report'});
  order=await createOrder(fixture,{month:period.work});
  await overlap(project,'completion before report archive',complete(order.id),`update public.client_reports set archived_at=now() where id=${quote(lockingReport.id)};`,{leftActor:owner});
  assert.equal((await persisted(order.id)).status,'complete');

  order=await createOrder(fixture,{month:period.work});
  await rpc(manager.client,'app_complete_order_without_report',{p_order_id:order.id,p_service_id:gmb,p_reporting_period_month:period.work,p_reason:'Revocation retry reason'});
  const before=await persisted(order.id);
  await sql("insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values(:'tenant',:'actor','projects.edit',false);",{tenant,actor:manager.id});
  await denied(manager.client,'app_complete_order_without_report',{p_order_id:order.id,p_service_id:gmb,p_reporting_period_month:period.work,p_reason:'Revocation retry reason'},'42501');
  await denied(manager.client,'app_complete_order_for_reporting_month',{p_order_id:order.id,p_service_id:gmb,p_reporting_period_month:period.work},'42501');
  assert.deepEqual(await persisted(order.id),before);
  await sql("delete from public.profile_permission_overrides where tenant_id=:'tenant' and profile_id=:'actor' and permission_key='projects.edit';update public.tenant_memberships set archived_at=clock_timestamp() where tenant_id=:'tenant' and profile_id=:'actor';",{tenant,actor:manager.id});
  await denied(manager.client,'app_complete_order_without_report',{p_order_id:order.id,p_service_id:gmb,p_reporting_period_month:period.work,p_reason:'Revocation retry reason'},'42501');
  assert.deepEqual(await persisted(order.id),before);
  checks.push({case:'Current permission and membership revocation before exact retries',status:'passed',auditAndEvidenceUnchanged:true});
  await recordPhase('races',{status:'passed',checks,calendar:{workPeriod:period.work,actualCompletedAt:new Date().toISOString()},persistedScopeAndAuditAssertions:true});
}catch(error){await recordPhase('races',{status:'failed',stage:phase,error:scrub(error.message),checks});process.exitCode=1;}
finally{for(const session of sessions)await session.close();}
