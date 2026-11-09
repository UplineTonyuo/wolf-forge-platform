import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
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

test('workflow source guard accepts reviewed fixtures and rejects later protected changes',async t=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const workflow=yaml.load(readFileSync(join(root,'.github/workflows/security.yml'),'utf8'));
  const guard=workflow.jobs.monthly_report_acceptance.steps.find(step=>step.name==='verify exact source, branch and isolated dispatch mode').run;
  const reviewed='91406d53b8139ec8fdb7d5f0f3c7a5f5ced969d3';
  const prior='ce54eeebfeea4f594b11ee2a5e1a61174b86a032';
  const env={...process.env};
  for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
  for(const key of ['SUPABASE_ACCESS_TOKEN','DATABASE_URL','SUPABASE_URL','SUPABASE_SECRET_KEY','VERCEL_TOKEN','LOCAL_UI_QA_BYPASS'])delete env[key];
  const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','core.autocrlf=false','-c','user.name=Monthly guard fixture','-c','user.email=monthly-guard@example.invalid',...args],{cwd,env,encoding:'utf8'}).trim();
  const shell=process.platform==='win32'?resolve(git(root,'--exec-path'),'../../../bin/bash.exe'):'bash';
  const run=(command,cwd,head,overrides={})=>{
    const result=spawnSync(shell,['--noprofile','--norc','-c',command],{cwd,encoding:'utf8',timeout:10000,env:{...env,GITHUB_REPOSITORY:'UplineTonyuo/wolf-forge-platform',GITHUB_REF_NAME:runner.GITHUB_REF_NAME,GITHUB_RUN_ATTEMPT:'1',EXPECTED_SHA:head,GITHUB_SHA:head,DATABASE_ONLY:'false',CALL_ACCEPTANCE:'false',CALL_ACCEPTANCE_ONLY:'false',...overrides}});
    assert.ifError(result.error);
    return result;
  };
  const head=git(root,'rev-parse','HEAD');
  const oldResult=run(guard.replaceAll(reviewed,prior),root,head);
  assert.equal(oldResult.status,1,'The old content comparison must reject the reviewed fixture corrections');
  for(const number of ['098','208'])assert.match(oldResult.stdout,new RegExp(`diff --git a/supabase/tests/database/${number}_`));
  assert.equal(run(guard,root,head).status,0,'The current workflow must accept reviewed fixture content');

  const directory=mkdtempSync(join(tmpdir(),'monthly-report-guard-'));
  t.after(()=>{
    assert.equal(dirname(directory),resolve(tmpdir()));
    assert.match(basename(directory),/^monthly-report-guard-/);
    rmSync(directory,{recursive:true,force:true});
  });
  git(directory,'init','--quiet');
  const files=['src/guard-fixture.ts','supabase/migrations/guard-fixture.sql','supabase/tests/database/098_tenant_report_authorization.test.sql','supabase/tests/database/208_monthly_report_completion.test.sql','supabase/tests/database/guard-fixture.test.sql','package.json','package-lock.json','next.config.ts'];
  const write=(name,value)=>{const path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);};
  const commit=()=>{git(directory,'add','.');git(directory,'commit','--quiet','-m','synthetic guard fixture');return git(directory,'rev-parse','HEAD');};
  for(const name of files)write(name,'original fixture\n');
  const oldFixture=commit();
  for(const name of files.slice(2,4))write(name,'reviewed fixture correction\n');
  const reviewedFixture=commit();
  write('docs/guard-fixture.md','permitted candidate documentation\n');
  const candidate=commit();
  const command=guard.replaceAll(reviewed,reviewedFixture);
  await t.test('a future candidate SHA passes while checkout and GitHub SHA mismatches fail',()=>{
    assert.notEqual(candidate,reviewedFixture);
    assert.equal(run(command,directory,candidate).status,0);
    for(const overrides of [{EXPECTED_SHA:reviewedFixture,GITHUB_SHA:reviewedFixture},{GITHUB_SHA:reviewedFixture}])assert.equal(run(command,directory,candidate,overrides).status,1);
  });
  for(const name of files)await t.test(`rejects unauthorized ${name}`,()=>{
    const original=readFileSync(join(directory,name),'utf8');
    try{
      write(name,original+'unauthorized change\n');
      const result=run(command,directory,commit());
      assert.equal(result.status,1);
      assert.ok(result.stdout.includes(`diff --git a/${name} b/${name}`),'The protected-content comparison must cause the rejection');
    }finally{write(name,original);commit();}
  });
  await t.test('the reviewed baseline must be an ancestor',()=>{
    git(directory,'checkout','--quiet','--detach',oldFixture);
    assert.equal(run(command,directory,oldFixture).status,1);
  });
});
