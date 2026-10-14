import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.LOCALAPPDATA, 'Temp/wolf-forge-studio-release-backend-20261014');
const container = 'supabase_db_Wolf-Forge-Studio-Release-20261014';
const out = resolve(backend, 'evidence');
mkdirSync(out, { recursive: true });
const json = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8'}).trim();
const inspection = JSON.parse(docker('inspect', container))[0];
assert.equal(inspection.Name, '/' + container);
assert.equal(inspection.NetworkSettings.Ports['5432/tcp'][0].HostPort, '62322');
assert.equal(inspection.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
const sql = query => docker('exec','-i', inspection.Id, 'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',query);
const systemId = sql('select system_identifier from pg_control_system()');
const identity = {project:'Wolf-Forge-Studio-Release-20261014', containerId:inspection.Id, systemId, api:'http://127.0.0.1:62321', dbPort:62322, origin:'http://127.0.0.1:3022', backend};
const phase=process.argv[2];
if(phase==='prepare-upgrade')json(resolve(backend,'identity.json'),identity);
else if(phase==='record-restart'){
 const previous=read(resolve(backend,'identity.json'));
 assert.equal(previous.systemId,identity.systemId);
 assert.equal(previous.backend,identity.backend);
 assert.equal(previous.api,identity.api);
 json(resolve(out,'controlled-restart.json'),{reason:'Controlled restart of the owned isolated QA stack; preserve the existing database volume',previous,current:identity});
 json(resolve(backend,'identity.json'),identity);
} else assert.deepEqual(read(resolve(backend,'identity.json')),identity);
const cli=(...a)=>execFileSync(process.execPath,[resolve(root,'node_modules/supabase/dist/supabase.js'),...a,'--workdir',backend],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const status = Object.fromEntries(cli('status','-o','env').split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(m=>[m[1],m[2]]));
assert.equal(status.API_URL,identity.api);
assert.ok(status.DB_URL.includes(':62322/'));
const admin=createClient(identity.api,status.SECRET_KEY??status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const digest = value => createHash('sha256').update(value).digest('hex');
const business = () => {
 const tables=sql("select tablename from pg_tables where schemaname='public' and tablename not in ('tenants','tenant_memberships','security_audit_events') order by tablename").split('\n');
 return Object.fromEntries(tables.map(t=>[t,{rows:Number(sql(`select count(*) from public."${t}"`)),sha256:digest(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."${t}" t`))}]));
};
const controls = () => sql("select coalesce(jsonb_agg(x order by x::text),'[]') from (select jsonb_build_object('oid',p.oid::text,'body',pg_get_functiondef(p.oid),'acl',p.proacl::text) x from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f') q");
const check=async r=>{const {data,error}=await r;if(error)throw error;return data;};

if(phase==='prepare-upgrade'){
 assert.equal(sql("select to_regclass('public.tenants') is null"),'t');
 assert.equal(sql('select count(*) from auth.users'),'0');
 const company=(await check(admin.from('companies').insert({name:'Studio Release Synthetic Company'}).select('id').single())).id;
 const accounts={};
 for(const [key,role] of [['platformAdmin','admin'],['owner','owner'],['staff','staff'],['client','client']]){
  const email=`studio-release-${key.toLowerCase()}@wolf-forge.local`,password=randomBytes(24).toString('base64url');
  const user=(await check(admin.auth.admin.createUser({email,password,email_confirm:true}))).user;
  const roleRow=await check(admin.from('roles').select('id').eq('name',role).single());
  await check(admin.from('profiles').update({role_id:roleRow.id,display_name:`Studio release ${key}`,company_id:key==='client'?company:null}).eq('id',user.id));
  accounts[key]={id:user.id,email,password};
 }
 json(resolve(root,'.qa-local-credentials.release.json'),accounts);
 writeFileSync(resolve(root,'.env.local'),`SUPABASE_URL=${identity.api}\nSUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY??status.ANON_KEY}\nSUPABASE_SECRET_KEY=${status.SECRET_KEY??status.SERVICE_ROLE_KEY}\n`);
 json(resolve(out,'before-upgrade.json'),{identity,business:business(),controls:JSON.parse(controls()),migrations:sql('select version from supabase_migrations.schema_migrations order by version').split('\n')});
 console.log('Synthetic baseline fixtures and preservation snapshots recorded.');
} else if(phase==='upgrade'){
 const before=read(resolve(out,'before-upgrade.json'));
 const added=readdirSync(resolve(root,'supabase/migrations')).filter(n=>!before.migrations.includes(n.split('_')[0]));
 assert.deepEqual(added.map(n=>n.split('_')[0]),['20261007120000','20261009160000','20261010090000','20261010120000']);
 for(const n of added)copyFileSync(resolve(root,'supabase/migrations',n),resolve(backend,'supabase/migrations',n));
 writeFileSync(resolve(backend,'supabase/config.toml'),readFileSync(resolve(backend,'supabase/config.toml'),'utf8').replace(/(\[db.seed\][\s\S]*?enabled = )true/,'$1false'));
 const result=cli('migration','up','--local');writeFileSync(resolve(out,'upgrade.log'),result);
 assert.deepEqual(business(),before.business);
 const afterControls=JSON.parse(controls());
 for(const old of before.controls)assert.deepEqual(afterControls.find(c=>c.oid===old.oid),old);
 const accounts=read(resolve(root,'.qa-local-credentials.release.json'));
 sql(`select private.grant_platform_admin('${accounts.platformAdmin.id}', 'Disposable Studio release QA only'); insert into public.tenants(id,slug,display_name,status) values ('f0f0f0f0-0000-4000-8000-000000004201','studio-release-a','Studio Release A','active'),('f0f0f0f0-0000-4000-8000-000000004202','studio-release-b','Studio Release B','active'),('f0f0f0f0-0000-4000-8000-000000004203','studio-release-suspended','Studio Release Suspended','suspended');`);
 json(resolve(out,'upgrade-result.json'),{passed:true,identity,applied:added,preservedBusinessTables:Object.keys(before.business).length,preservedFunctionBodiesAndAcls:before.controls.length,noPublication:sql("select to_regclass('private.tenant_module_publications') is null"),migrations:sql('select count(*) from supabase_migrations.schema_migrations')});
 console.log('Upgrade passed; preexisting business rows and function bodies/ACLs preserved.');
} else if(phase==='record-restart'){
 assert.equal(sql('select count(*) from auth.users'),'4');
 assert.equal(sql('select count(*) from supabase_migrations.schema_migrations'),'102');
 console.log('Controlled restart recorded; database system ID, fixtures and migrations preserved.');
} else if(phase==='database'){
 const accounts=read(resolve(root,'.qa-local-credentials.release.json'));
 const results=[];
 for(const [key,a] of Object.entries(accounts)){
  const client=createClient(identity.api,status.PUBLISHABLE_KEY??status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  await check(client.auth.signInWithPassword({email:a.email,password:a.password}));
  const grant=await check(client.rpc('app_is_platform_admin'));assert.equal(grant,key==='platformAdmin');
  const listed=await client.rpc('app_list_white_label_tenants');
  if(key==='platformAdmin')assert.ok(listed.data.length===4);else assert.equal(listed.error?.code,'42501');
  const loaded=await client.rpc('app_get_white_label_draft',{p_tenant_id:'f0f0f0f0-0000-4000-8000-000000004201'});
  if(key==='platformAdmin')assert.ok(loaded.data.length===1);else assert.equal(loaded.error?.code,'42501');
  if(key!=='platformAdmin'){
   const denied=await client.rpc('app_save_white_label_draft',{p_tenant_id:'f0f0f0f0-0000-4000-8000-000000004201',p_expected_revision:0,p_display_name:'Unauthorized draft',p_primary_color:'#000d51',p_accent_color:'#a8832e',p_module_keys:[]});
   assert.equal(denied.error?.code,'42501');
  }
  const direct=await client.schema('private').from('tenant_white_label_drafts').select('*');assert.ok(direct.error);
  results.push({actor:key,platformAdmin:grant,tenantRead:key==='platformAdmin'?'allowed':'denied',privateTableRead:'denied'});
 }
 const anon=createClient(identity.api,status.PUBLISHABLE_KEY??status.ANON_KEY,{auth:{persistSession:false}});
 assert.ok((await anon.rpc('app_list_white_label_tenants')).error);
 assert.ok((await admin.rpc('app_list_white_label_tenants')).error);
 const invalid=await fetch(identity.api+'/rest/v1/rpc/app_list_white_label_tenants',{method:'POST',headers:{apikey:status.PUBLISHABLE_KEY??status.ANON_KEY,Authorization:'Bearer invalid-token','Content-Type':'application/json'},body:'{}'});
 assert.equal(invalid.status,401);
 assert.equal(sql("select to_regprocedure('public.app_publish_white_label_draft(uuid,integer,integer)') is null"),'t');
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 json(resolve(out,'runtime-database.json'),{sha,identity,passed:true,results,anonymous:'denied',serviceRole:'denied',forgedTokenStatus:invalid.status});
 console.log('Live Auth/Data API authorization matrix passed.');
} else throw Error('Unknown phase');
