const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'..');
const guard='C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Parallel-Setup-20261012/publication-test-environment.cjs';
const container='6f1db0d6b4a8c393e968f4de6af958937c69bfc6a2eed0c8ab163c37b8d40416';
const migration=path.join(source,'supabase/migrations/20261013120050_draft_bound_white_label_publication.sql');
const run=(exe,args,options={})=>execFileSync(exe,args,{cwd:source,encoding:'utf8',windowsHide:true,maxBuffer:32e6,...options});
const verify=()=>JSON.parse(run(process.execPath,[guard,'verify','--require-source']));
const sql=query=>run('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:query});
const command=process.argv[2];
assert(['dry-run','install','refresh-functions'].includes(command),'Use dry-run, install or refresh-functions before registry acceptance.');
verify();
if(command==='refresh-functions') {
  assert.equal(sql("select count(*) from supabase_migrations.schema_migrations where version='20261013120050';").trim(),'0','Accepted migration cannot be changed');
  const functions=[...fs.readFileSync(migration,'utf8').matchAll(/create function [a-z_.]+\([^]*?\)\nreturns[^]*?as \$\$[^]*?\$\$;/g)].map(m=>m[0].replace('create function','create or replace function'));
  assert.equal(functions.length,12);
  sql('begin;\n'+functions.join('\n')+'\ncommit;');verify();
  console.log(JSON.stringify({result:'PASS',command,registered:false}));process.exit(0);
}
assert.equal(sql("begin read only; select to_regclass('private.tenant_white_label_publications') is null; commit;").trim(),'t','Unexpected prior implementation; reconcile instead of reapplying');
const bytes=fs.readFileSync(migration,'utf8');
sql('begin;\n'+bytes+'\n'+(command==='dry-run'?'rollback;':'commit;'));
verify();
console.log(JSON.stringify({result:'PASS',command,container,registered:false}));
