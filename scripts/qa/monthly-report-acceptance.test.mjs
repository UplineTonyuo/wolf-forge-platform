import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunner, loopback, assertLedger, assertOwnedContainer, assertProjectConfig, assertEvidenceName, lateWorkPeriod } from './monthly-report-acceptance.mjs';

const sha='a'.repeat(40);
const runner={CI:'true',GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'UplineTonyuo/wolf-forge-platform',GITHUB_REF_NAME:'codex/woad-monthly-report-gate-20261108',GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',EXPECTED_SHA:sha};
test('runner accepts only the approved first-attempt exact source',()=>{
  assert.doesNotThrow(()=>assertRunner(runner,'linux',sha));
  for(const change of [{GITHUB_REF_NAME:'main'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_RUN_ATTEMPT:'2'},{EXPECTED_SHA:'b'.repeat(40)},{RUNNER_ENVIRONMENT:'self-hosted'},{CI:'false'},{SUPABASE_URL:'https://customer.supabase.co'},{SUPABASE_ACCESS_TOKEN:'forbidden'},{LOCAL_UI_QA_BYPASS:'1'}])assert.throws(()=>assertRunner({...runner,...change},'linux',sha));
  assert.throws(()=>assertRunner(runner,'win32',sha));
});
test('target refuses hosted, credential-bearing API and noncanonical destinations',()=>{
  assert.equal(loopback('http://127.0.0.1:54321','http:').port,'54321');
  assert.equal(loopback('postgresql://postgres:local@127.0.0.1:54322/postgres','postgresql:').pathname,'/postgres');
  for(const value of ['https://production.supabase.co','http://127.0.0.1.attacker.test:54321','http://user:password@127.0.0.1:54321','http://127.0.0.1:54321/?token=x','http://127.0.0.1:54321/path'])assert.throws(()=>loopback(value,'http:'));
});
test('ledger must match every expected version and preserve prior source hashes',()=>{
  const prior=[{version:'1',source:'first'}], after=[...prior,{version:'2',source:'second'}];
  assert.doesNotThrow(()=>assertLedger(after,['1','2'],prior));
  assert.throws(()=>assertLedger(after,['1','2','3'],prior));
  assert.throws(()=>assertLedger([{version:'1',source:'changed'},after[1]],['1','2'],prior));
  assert.throws(()=>assertLedger([...after,after[1]],['1','2'],prior));
});
test('cleanup refuses a different container, volume, project or binding',()=>{
  const state={project:'monthly-12345-1',containerId:'a'.repeat(64),volume:'volume-owned'};
  const inspect={Id:state.containerId,Name:'/supabase_db_'+state.project,State:{Running:true},Config:{Labels:{'com.supabase.cli.project':state.project}},NetworkSettings:{Ports:{'5432/tcp':[{HostPort:'54322'}]}},Mounts:[{Type:'volume',Name:'volume-owned',Destination:'/var/lib/postgresql/data'}]};
  assert.doesNotThrow(()=>assertOwnedContainer(inspect,state));
  for(const changed of [{...inspect,Id:'b'.repeat(64)},{...inspect,Name:'/supabase_db_shared'},{...inspect,Mounts:[]},{...inspect,Config:{Labels:{}}}])assert.throws(()=>assertOwnedContainer(changed,state));
});
test('evidence admits only bounded named summaries and PNG screenshots',()=>{
  for(const name of ['summary.json','gate-320.png','browser.json'])assert.doesNotThrow(()=>assertEvidenceName(name));
  for(const name of ['../secret.png','.env','cookies.json','session.har','raw.log','nested/screenshot.png','state.zip'])assert.throws(()=>assertEvidenceName(name));
});
test('CLI mutation target must be the one exact journaled project declaration',()=>{
  assert.doesNotThrow(()=>assertProjectConfig('project_id = "monthly-12345-1"\n[api]\n','monthly-12345-1'));
  for(const config of ['project_id = "shared"\n# project_id = "monthly-12345-1"','project_id = "shared"\nproject_id = "monthly-12345-1"','[api]\n'])assert.throws(()=>assertProjectConfig(config,'monthly-12345-1'));
});
test('late browser period uses a genuine earlier work period, with no clock mutation',()=>{
  assert.deepEqual(lateWorkPeriod(new Date('2026-11-09T12:00:00Z')),{work:'2025-11-01',wrong:'2025-10-01',started:'2025-10-15T00:00:00+08:00'});
  assert.deepEqual(lateWorkPeriod(new Date('2026-12-09T12:00:00Z')),{work:'2025-11-01',wrong:'2025-10-01',started:'2025-10-15T00:00:00+08:00'});
});
