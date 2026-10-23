const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'..'),container='6f1db0d6b4a8c393e968f4de6af958937c69bfc6a2eed0c8ab163c37b8d40416';
const guard='C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Parallel-Setup-20261012/publication-test-environment.cjs';
const runtime='C:/Users/TrojanNiAnton/AppData/Local/Temp/wolf-forge-publication-backend-20261013/reservation';
const evidence=path.join(process.env.LOCALAPPDATA,'Temp','wolf-forge-publication-evidence-20261015');fs.mkdirSync(evidence,{recursive:true});
const version='20261013120050',migration=fs.readFileSync(path.join(source,'supabase/migrations/'+version+'_draft_bound_white_label_publication.sql'),'utf8').replace(/\r\n/g,'\n');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const q=value=>"'"+value.replaceAll("'","''")+"'";
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SystemRoot|SystemDrive|windir|ComSpec|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
Object.assign(env,{SUPABASE_HOME:path.join(evidence,'cli-state'),SUPABASE_TELEMETRY_DISABLED:'1',SUPABASE_NO_UPDATE_NOTIFIER:'1',DO_NOT_TRACK:'1'});
const run=(exe,args,options={})=>execFileSync(exe,args,{cwd:source,env,encoding:'utf8',windowsHide:true,maxBuffer:32e6,...options});
const sql=query=>run('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:query}).trim();
const verify=()=>JSON.parse(run(process.execPath,[guard,'verify','--require-source']));
const bodies=[...migration.matchAll(/create function ([a-z_.]+)\(([^]*?)\)\nreturns([^]*?)as \$\$([^]*?)\$\$;/g)].map(m=>({name:m[1],header:m[3],body:m[4].trim()}));assert.equal(bodies.length,12);
verify();
const installed=JSON.parse(sql(`begin read only;select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'signature',p.oid::regprocedure::text,
'body',p.prosrc,'owner',p.proowner::regrole::text,'definer',p.prosecdef,'config',p.proconfig,'api',json_build_object('anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in(${bodies.map(b=>q(b.name)).join(',')});commit;`));
assert.equal(installed.length,12);
for(const entry of bodies){const actual=installed.find(p=>p.name===entry.name);assert(actual);assert.equal(actual.body.trim(),entry.body,entry.name+' source body differs');assert.equal(actual.owner,'postgres');assert.equal(actual.definer,entry.header.includes('security definer'));assert.deepEqual(actual.config,['search_path=""']);assert.deepEqual(actual.api,{anon:false,authenticated:entry.name.startsWith('public.'),service_role:false});}
const catalog=JSON.parse(sql(`begin read only;select json_build_object('rls',(select relrowsecurity from pg_class where oid='private.tenant_white_label_publications'::regclass),
'snapshotTrigger',(select tgenabled from pg_trigger where tgrelid='private.tenant_white_label_publications'::regclass and tgname='tenant_white_label_publications_validate'),
'transactionStamp',(select tgenabled from pg_trigger where tgrelid='private.tenant_module_publications'::regclass and tgname='tenant_module_publications_xact_stamp'),
'snapshotTriggerFunction',(select tgfoid::regprocedure::text from pg_trigger where tgrelid='private.tenant_white_label_publications'::regclass and tgname='tenant_white_label_publications_validate'),
'snapshotTriggerType',(select tgtype from pg_trigger where tgrelid='private.tenant_white_label_publications'::regclass and tgname='tenant_white_label_publications_validate'),
'snapshotTriggerDefinition',(select pg_get_triggerdef(oid,true) from pg_trigger where tgrelid='private.tenant_white_label_publications'::regclass and tgname='tenant_white_label_publications_validate'),
'stampTriggerFunction',(select tgfoid::regprocedure::text from pg_trigger where tgrelid='private.tenant_module_publications'::regclass and tgname='tenant_module_publications_xact_stamp'),
'stampTriggerType',(select tgtype from pg_trigger where tgrelid='private.tenant_module_publications'::regclass and tgname='tenant_module_publications_xact_stamp'),
'stampTriggerDefinition',(select pg_get_triggerdef(oid,true) from pg_trigger where tgrelid='private.tenant_module_publications'::regclass and tgname='tenant_module_publications_xact_stamp'),
'parentValidationEnabled',(select tgenabled from pg_trigger where tgrelid='private.tenant_module_publications'::regclass and tgname='tenant_module_publications_validate'),
'stampDefault',(select atthasdef from pg_attribute where attrelid='private.tenant_module_publications'::regclass and attname='publication_transaction_id'),
'snapshotApiGrants',(select count(*) from (values('anon'),('authenticated'),('service_role'))r(name) where has_table_privilege(name,'private.tenant_white_label_publications','SELECT,INSERT,UPDATE,DELETE')),
'foreignKey',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.tenant_white_label_publications'::regclass and confrelid='private.tenant_module_publications'::regclass));commit;`));
assert.equal(catalog.rls,true);assert.equal(catalog.snapshotTrigger,'O');assert.equal(catalog.transactionStamp,'O');assert.equal(catalog.stampDefault,false);assert.equal(catalog.snapshotApiGrants,0);assert(catalog.foreignKey.includes('(tenant_id, publication_revision) REFERENCES private.tenant_module_publications(tenant_id, revision)'));
assert.equal(catalog.snapshotTriggerFunction,'private.validate_white_label_publication()');assert.equal(catalog.stampTriggerFunction,'private.stamp_white_label_publication_transaction()');assert.equal(catalog.snapshotTriggerType,31);assert.equal(catalog.stampTriggerType,7);assert.equal(catalog.parentValidationEnabled,'O');
const generated=spawnSync(process.execPath,[path.join(source,'node_modules/supabase/dist/supabase.js'),'--workdir',runtime,'gen','types','typescript','--local','--schema','public'],{cwd:source,env,encoding:'utf8',windowsHide:true,maxBuffer:32e6});
fs.writeFileSync(path.join(evidence,'typegen-private.log'),generated.stderr||'');assert.equal(generated.status,0,'Local type generation failed; inspect private evidence log');
fs.writeFileSync(path.join(evidence,'fresh-public.types.ts'),generated.stdout);
const ts=require(path.join(source,'node_modules/typescript'));
function functions(text){const file=ts.createSourceFile('types.ts',text,ts.ScriptTarget.Latest,true);const database=file.statements.find(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='Database');assert(database);const pub=database.type.members.find(n=>n.name.getText(file)==='public');return{file,members:pub.type.members.find(n=>n.name.getText(file)==='Functions').type.members};}
function shape(text,name){const {file,members}=functions(text),fn=members.find(n=>n.name.getText(file)===name);assert(fn,name+' missing');const args=fn.type.members.find(n=>n.name.getText(file)==='Args').type;return{args:ts.isTypeLiteralNode(args)?args.members.map(n=>({name:n.name.getText(file),optional:!!n.questionToken,type:n.type.getText(file).replace(/\s/g,'')})).sort((a,b)=>a.name.localeCompare(b.name)):[],returns:fn.type.members.find(n=>n.name.getText(file)==='Returns').type.getText(file).replace(/\s/g,'')};}
const rpcNames=bodies.filter(b=>b.name.startsWith('public.')).map(b=>b.name.split('.')[1]),declared=fs.readFileSync(path.join(source,'src/lib/supabase/database.types.ts'),'utf8');
for(const name of rpcNames)assert.deepEqual(shape(declared,name),shape(generated.stdout,name),'Fresh generated RPC declaration differs: '+name);
const register=process.argv.includes('--register');
if(register){
  const prior=JSON.parse(sql(`begin read only;select coalesce(json_agg(json_build_object('name',name,'statements',statements)),'[]'::json) from supabase_migrations.schema_migrations where version=${q(version)};commit;`));
  if(prior.length){assert.equal(prior.length,1);assert.equal(prior[0].name,'draft_bound_white_label_publication');assert.deepEqual(prior[0].statements,[migration]);}
  else sql(`begin;insert into supabase_migrations.schema_migrations(version,name,statements) values(${q(version)},'draft_bound_white_label_publication',array[${q(migration)}]);commit;`);
  assert.equal(sql(`begin read only;select name from supabase_migrations.schema_migrations where version=${q(version)} and statements=array[${q(migration)}];commit;`),'draft_bound_white_label_publication');
}
const verified=verify();
const proof={result:'PASS',verifiedAt:new Date().toISOString(),sourceMigrationHash:digest(migration),registered:register,registryVersions:verified.registryVersions,
  sourceBodiesMatched:installed.map(p=>({signature:p.signature,definer:p.definer,owner:p.owner,config:p.config,api:p.api})),catalog,freshPublicRpcTypesMatched:rpcNames,olderPublicTypeDriftPreserved:true,featureApiTransportTested:false};
const target=path.join(evidence,register?'installed-registered-readback.json':'installed-source-readback.json');fs.writeFileSync(target,JSON.stringify(proof,null,2)+'\n');assert.deepEqual(JSON.parse(fs.readFileSync(target,'utf8')),proof);
console.log(JSON.stringify({result:'PASS',sourceBodies:bodies.length,registered:register,registryVersions:verified.registryVersions,rpcTypesMatched:rpcNames.length,migrationHash:proof.sourceMigrationHash,evidence:target}));
