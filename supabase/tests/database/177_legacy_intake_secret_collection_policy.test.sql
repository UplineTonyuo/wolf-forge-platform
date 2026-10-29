-- Synthetic policy rows and Vault captures roll back; no production identifiers are fixtures.
begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b1770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'legacy-intake-'||n||'@example.invalid',now(),now() from generate_series(1,4)n;
insert into public.tenants(id,slug,display_name,status) values
('b1770000-0000-4000-8000-000000000010','legacy-intake-policy-a','Legacy Intake A','active'),
('b1770000-0000-4000-8000-000000000011','legacy-intake-policy-b','Legacy Intake B','active');
insert into public.companies(id,tenant_id,name,status) values
('b1770000-0000-4000-8000-000000000020','b1770000-0000-4000-8000-000000000010','Synthetic Legacy Buyer','client'),
('b1770000-0000-4000-8000-000000000021','b1770000-0000-4000-8000-000000000011','Synthetic Foreign Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,('b1770000-0000-4000-8000-'||lpad(v.n::text,12,'0'))::uuid,v.kind,r.id,v.company::uuid
from (values
('b1770000-0000-4000-8000-000000000010',1,'internal','owner',null),
('b1770000-0000-4000-8000-000000000010',2,'client','client','b1770000-0000-4000-8000-000000000020'),
('b1770000-0000-4000-8000-000000000010',3,'client','client','b1770000-0000-4000-8000-000000000020'),
('b1770000-0000-4000-8000-000000000011',4,'client','client','b1770000-0000-4000-8000-000000000021')
)v(tenant,n,kind,role_name,company) join public.roles r on r.name=v.role_name;
insert into auth.sessions(id,user_id,aal,not_after)
select ('c1770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('b1770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal1',now()+interval '1 day'
from generate_series(1,4)n;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
values('b1770000-0000-4000-8000-000000000030','b1770000-0000-4000-8000-000000000010','Legacy Intake Service',10,'USD',true,true,false);
update public.company_wallets set balance_cents=10000 where company_id='b1770000-0000-4000-8000-000000000020';
insert into private.client_order_start_rollout values
('b1770000-0000-4000-8000-000000000010','b1770000-0000-4000-8000-000000000030',true);
create temp table legacy177_ids(label text primary key,id uuid not null);
create temp table legacy177_evidence(label text primary key,value jsonb not null);
create temp table legacy177_boundary(mode text);
grant all on legacy177_ids,legacy177_evidence,legacy177_boundary to authenticated;
create function pg_temp.legacy177_key(n integer) returns uuid language sql immutable as $$
select ('b1770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.legacy177_act(n integer,tenant text default 'b1770000-0000-4000-8000-000000000010') returns void language sql as $$
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.legacy177_key(n),'role','authenticated',
  'session_id',('c1770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)::text,true);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);
select set_config('app.client_support_id','',true);
select set_config('app.client_support_administrator','',true);
$$;
create function pg_temp.legacy177_definition(mode text default 'disabled') returns jsonb language sql as $$
select jsonb_build_object('name','Legacy Policy Fixture','title','Legacy Policy Fixture','visibility','assigned',
  'type_config','{}'::jsonb,'rules','[]'::jsonb,'service_links',jsonb_build_array(
    jsonb_build_object('service_id',pg_temp.legacy177_key(30),'role','intake_assignment','sort_order',0)),
  'fields',jsonb_build_array(
    jsonb_build_object('stable_field_key',pg_temp.legacy177_key(50),'sort_order',0,'field_type','secret','label','WordPress Password',
      'required',false,'settings',jsonb_build_object('collection_mode',mode)),
    jsonb_build_object('stable_field_key',pg_temp.legacy177_key(51),'sort_order',1,'field_type','secret','label','Unrelated social password',
      'required',false,'settings',jsonb_build_object('collection_mode','disabled')),
    jsonb_build_object('stable_field_key',pg_temp.legacy177_key(52),'sort_order',2,'field_type','text','label','Business','required',true),
    jsonb_build_object('stable_field_key',pg_temp.legacy177_key(53),'sort_order',3,'field_type','richtext','label','Original agreement',
      'required',false,'help_html','Original agreement must remain unchanged.','settings','{"display_only":true}'::jsonb),
    jsonb_build_object('stable_field_key',pg_temp.legacy177_key(54),'sort_order',4,'field_type','signature','label','Signature',
      'required',true,'settings','{"signature_mode":"drawn"}'::jsonb),
    jsonb_build_object('stable_field_key',pg_temp.legacy177_key(55),'sort_order',5,'field_type','secret','label','Native encrypted field',
      'required',false,'settings',jsonb_build_object('collection_mode','encrypted'))));
$$;
create function pg_temp.legacy177_values(reference uuid default null) returns jsonb language sql as $$
select jsonb_build_array(jsonb_build_object('field_key',pg_temp.legacy177_key(52),'value','Saved synthetic business'),
  jsonb_build_object('field_key',pg_temp.legacy177_key(54),'value',
    jsonb_build_object('consent',true,'drawing','[[[10,20],[50,60]]]'::jsonb)))
  ||case when reference is null then '[]'::jsonb else jsonb_build_array(
    jsonb_build_object('field_key',pg_temp.legacy177_key(50),'value',jsonb_build_object('credential_id',reference))) end;
$$;
create function pg_temp.legacy177_capture(field integer default 50) returns uuid language sql as $$
select (public.app_capture_intake_secret(gen_random_uuid(),(select id from legacy177_ids where label='assignment'),
  pg_temp.legacy177_key(field),'  synthetic legacy credential 177  ')->>'credential_id')::uuid;
$$;
create function pg_temp.legacy177_revoke_policy() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.scope='intake-secret-capture-minute' and exists(select 1 from pg_temp.legacy177_boundary where mode='capture') then
    delete from private.intake_secret_collection_policy where form_version_id=(select id from pg_temp.legacy177_ids where label='original');
  end if;
  return new;
end;
$$;
create trigger legacy177_revoke_after_rate after insert or update on private.rate_limit_counters
for each row execute function pg_temp.legacy177_revoke_policy();
create function pg_temp.legacy177_revoke_after_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from pg_temp.legacy177_boundary where mode=tg_table_name) then
    delete from private.intake_secret_collection_policy where form_version_id=(select id from pg_temp.legacy177_ids where label='original');
  end if;
  return new;
end;
$$;
create trigger legacy177_revoke_after_draft after insert or update on private.intake_drafts
for each row execute function pg_temp.legacy177_revoke_after_write();
create trigger legacy177_revoke_after_binding after update of submission_id on private.intake_secret_references
for each row when (new.submission_id is not null) execute function pg_temp.legacy177_revoke_after_write();
create trigger legacy177_revoke_after_submission_ledger after insert on private.form_submission_requests
for each row execute function pg_temp.legacy177_revoke_after_write();

select ok(not has_table_privilege('authenticated','private.intake_secret_collection_policy','select'),'collection policy is not client-readable');
select ok(not has_table_privilege('authenticated','private.intake_secret_collection_policy','insert'),'clients cannot enable legacy collection');
select ok(not has_table_privilege('service_role','private.intake_secret_collection_policy','update'),'service role has no policy write bypass');
select ok(not has_function_privilege('authenticated','private.intake_secret_field_collection_enabled(uuid,uuid)','execute'),'policy helper is private');
select ok(not has_function_privilege('anon','private.intake_secret_field_collection_enabled(uuid,uuid)','execute'),'anonymous callers cannot probe policy');
select ok(not has_function_privilege('authenticated','private.require_intake_secret_collection_write(uuid,uuid)','execute'),'write-lock guard is not a client RPC');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.intake_secret_collection_policy'::regclass),'policy has RLS and FORCE RLS');
select is((select count(*) from private.intake_secret_collection_policy),0::bigint,'fresh database does not seed production-specific policy');
set local role authenticated;
select pg_temp.legacy177_act(1);
insert into legacy177_ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake',
  'canonical_key','legacy-intake-177','definition',pg_temp.legacy177_definition()))).id;
insert into legacy177_ids select 'original',(public.app_publish_form(gen_random_uuid(),id)).id from legacy177_ids where label='form';
insert into legacy177_ids select 'public-form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','contact',
  'canonical_key','legacy-public-177','definition',jsonb_build_object('name','Public Password Fixture','title','Public Password Fixture',
    'visibility','public','type_config','{}'::jsonb,'rules','[]'::jsonb,'service_links','[]'::jsonb,
    'fields',jsonb_build_array(jsonb_build_object('stable_field_key',pg_temp.legacy177_key(56),'sort_order',0,
      'field_type','password','label','Raw legacy password','required',false)))))).id;
insert into legacy177_ids select 'public-version',(public.app_publish_form(gen_random_uuid(),id)).id from legacy177_ids where label='public-form';
select pg_temp.legacy177_act(2);
insert into legacy177_ids select 'historic-order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),pg_temp.legacy177_key(30));
reset role;
insert into legacy177_ids select 'historic-assignment',id from public.form_assignments
  where order_id=(select id from legacy177_ids where label='historic-order');
set local role authenticated;
select pg_temp.legacy177_act(2);
insert into legacy177_ids select 'historic-submission',(public.app_submit_form(gen_random_uuid(),(select id from legacy177_ids where label='original'),
  jsonb_build_object('assignment_id',(select id from legacy177_ids where label='historic-assignment')),pg_temp.legacy177_values(),'[]'::jsonb)).id;
insert into legacy177_ids select 'order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),pg_temp.legacy177_key(30));
reset role;
insert into legacy177_ids select 'assignment',id from public.form_assignments where order_id=(select id from legacy177_ids where label='order');
insert into legacy177_evidence select 'historic-receipt',to_jsonb(s) from public.form_submissions s where id=(select id from legacy177_ids where label='historic-submission');
insert into legacy177_evidence select 'historic-values',jsonb_agg(to_jsonb(v) order by v.sort_order_snapshot) from public.form_submission_values v
  where submission_id=(select id from legacy177_ids where label='historic-submission');
insert into legacy177_evidence select 'original-version',to_jsonb(v) from public.form_versions v where id=(select id from legacy177_ids where label='original');
insert into legacy177_evidence select 'original-fields',jsonb_agg(to_jsonb(f) order by sort_order) from public.form_version_fields f
  where form_version_id=(select id from legacy177_ids where label='original');
insert into legacy177_evidence select 'assignment',to_jsonb(a) from public.form_assignments a where id=(select id from legacy177_ids where label='assignment');
insert into legacy177_evidence select 'gate-versions',assignment_versions from private.client_order_starts where order_id=(select id from legacy177_ids where label='order');
set local role authenticated;
select pg_temp.legacy177_act(2);
select lives_ok($q$select public.app_save_intake_draft((select id from legacy177_ids where label='assignment'),pg_temp.legacy177_values())$q$,'save original answers and drawn signature before policy');
select throws_ok($q$select pg_temp.legacy177_capture()$q$,'42501',null,'legacy collection starts disabled');
select pg_temp.legacy177_act(1);
select public.app_update_form_draft(gen_random_uuid(),id,pg_temp.legacy177_definition('encrypted')) from legacy177_ids where label='form';
insert into legacy177_ids select 'latest',(public.app_publish_form(gen_random_uuid(),id)).id from legacy177_ids where label='form';
select pg_temp.legacy177_act(2);
select ok(public.app_my_intake_version_available((select id from legacy177_ids where label='assignment'),(select id from legacy177_ids where label='original')),'existing pending-order gate already permits the frozen original version');
select is((public.app_get_assigned_form_schema((select id from legacy177_ids where label='assignment'))->'schema'->'fields'->0->>'encrypted_collection_allowed')::boolean,false,'new publication does not silently enable legacy collection');
reset role;
insert into private.intake_secret_collection_policy(form_version_id,field_key,schema_hash)
select id,pg_temp.legacy177_key(50),repeat('0',32) from legacy177_ids where label='original';
select ok(not private.intake_secret_field_collection_enabled((select id from legacy177_ids where label='original'),pg_temp.legacy177_key(50)),'policy with mismatched immutable hash cannot enable collection');
update private.intake_secret_collection_policy policy set schema_hash=version.schema_hash from public.form_versions version
  where version.id=policy.form_version_id and version.id=(select id from legacy177_ids where label='original');
select ok(private.intake_secret_field_collection_enabled((select id from legacy177_ids where label='original'),pg_temp.legacy177_key(50)),'exact version, field and hash enable secure collection');
select ok(not private.intake_secret_field_collection_enabled((select id from legacy177_ids where label='original'),pg_temp.legacy177_key(51)),'unlisted social field stays disabled');
insert into private.intake_secret_collection_policy(form_version_id,field_key,schema_hash)
select id,pg_temp.legacy177_key(56),schema_hash from public.form_versions where id=(select id from legacy177_ids where label='public-version');
select ok(not private.intake_secret_field_collection_enabled((select id from legacy177_ids where label='public-version'),pg_temp.legacy177_key(56)),'policy cannot enable public raw password type');
select ok(not private.intake_secret_field_collection_enabled((select id from legacy177_ids where label='original'),gen_random_uuid()),'unknown field key stays disabled');
select ok(private.intake_secret_field_collection_enabled((select id from legacy177_ids where label='original'),pg_temp.legacy177_key(55)),'native encrypted collection is preserved');
select is((select to_jsonb(a) from public.form_assignments a where id=(select id from legacy177_ids where label='assignment')),
  (select value from legacy177_evidence where label='assignment'),'policy and publication preserve the original assignment exactly');
select is((select assignment_versions from private.client_order_starts where order_id=(select id from legacy177_ids where label='order')),
  (select value from legacy177_evidence where label='gate-versions'),'frozen order requirement versions stay unchanged');
set local role authenticated;
select pg_temp.legacy177_act(2);
select is((public.app_get_assigned_form_schema((select id from legacy177_ids where label='assignment'))->'schema'->>'form_version_id')::uuid,
  (select id from legacy177_ids where label='original'),'schema still names the original published version');
select is(public.app_get_assigned_form_schema((select id from legacy177_ids where label='assignment'))->'schema'->'fields'->0->'settings'->>'collection_mode',
  'disabled','immutable field settings are not rewritten');
select is((public.app_get_assigned_form_schema((select id from legacy177_ids where label='assignment'))->'schema'->'fields'->0->>'encrypted_collection_allowed')::boolean,
  true,'assigned schema separately projects effective encrypted collection');
select is(public.app_get_form_assignment_history((select id from legacy177_ids where label='assignment'))->'secret_fields'->0->>'collection_mode',
  'encrypted','repository preflight receives the same effective policy');
select is(public.app_get_intake_draft((select id from legacy177_ids where label='assignment'))->'values',pg_temp.legacy177_values(),'original text and drawn signature draft survive policy');
select throws_ok($q$select pg_temp.legacy177_capture(51)$q$,'42501',null,'unlisted social capture is refused');
select throws_ok($q$select pg_temp.legacy177_capture(56)$q$,'42501',null,'raw password field from another Form cannot enter this assignment');
select pg_temp.legacy177_act(3);
select throws_ok($q$select pg_temp.legacy177_capture()$q$,'42501',null,'same-company peer cannot capture against another assignment');
select pg_temp.legacy177_act(4,'b1770000-0000-4000-8000-000000000011');
select throws_ok($q$select pg_temp.legacy177_capture()$q$,'42501',null,'foreign company and Tenant cannot use policy');
select pg_temp.legacy177_act(2);
insert into legacy177_boundary values('capture');
select throws_ok($q$select pg_temp.legacy177_capture()$q$,'42501',null,'capture rechecks policy after a blocking boundary');
update legacy177_boundary set mode='off';
insert into legacy177_ids select 'credential',pg_temp.legacy177_capture();
select throws_ok($q$select public.app_save_intake_draft((select id from legacy177_ids where label='assignment'),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.legacy177_key(50),'value','synthetic raw input')))$q$,'23514',null,'policy never admits plaintext to ordinary drafts');
update legacy177_boundary set mode='intake_drafts';
select throws_ok($q$select public.app_save_intake_draft((select id from legacy177_ids where label='assignment'),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')))$q$,'42501',null,'draft rechecks current policy after the actual UPSERT write');
reset role;
select is((select answers from private.intake_drafts where assignment_id=(select id from legacy177_ids where label='assignment')),
  pg_temp.legacy177_values(),'late draft policy denial rolls back the write and preserves prior answers and ink');
set local role authenticated;
select pg_temp.legacy177_act(2);
update legacy177_boundary set mode='off';
select lives_ok($q$select public.app_save_intake_draft((select id from legacy177_ids where label='assignment'),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')))$q$,'legacy draft accepts the bound opaque Vault reference');
select is(public.app_get_intake_draft((select id from legacy177_ids where label='assignment'))->'values',
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')),'restored legacy draft preserves answers, drawing and opaque reference');
reset role;
delete from private.intake_secret_collection_policy where form_version_id=(select id from legacy177_ids where label='original');
set local role authenticated;
select pg_temp.legacy177_act(2);
select is(public.app_get_intake_draft((select id from legacy177_ids where label='assignment'))->'values',pg_temp.legacy177_values(),'policy removal omits the reference and retains normal answers');
select throws_ok($q$select public.app_submit_form(gen_random_uuid(),(select id from legacy177_ids where label='original'),
  jsonb_build_object('assignment_id',(select id from legacy177_ids where label='assignment')),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')),'[]'::jsonb)$q$,'55000',null,'policy removal refuses submission of the captured legacy field');
reset role;
insert into private.intake_secret_collection_policy(form_version_id,field_key,schema_hash)
select id,pg_temp.legacy177_key(50),schema_hash from public.form_versions where id=(select id from legacy177_ids where label='original');
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values(pg_temp.legacy177_key(10),pg_temp.legacy177_key(2),'forms.view',false);
set local role authenticated;
select pg_temp.legacy177_act(2);
select throws_ok($q$select pg_temp.legacy177_capture()$q$,'42501',null,'policy never bypasses current permission revocation');
reset role;
delete from public.profile_permission_overrides where tenant_id=pg_temp.legacy177_key(10)
  and profile_id=pg_temp.legacy177_key(2) and permission_key='forms.view';
set local role authenticated;
select pg_temp.legacy177_act(2);
update legacy177_boundary set mode='intake_secret_references';
select throws_ok($q$select public.app_submit_form(gen_random_uuid(),(select id from legacy177_ids where label='original'),
  jsonb_build_object('assignment_id',(select id from legacy177_ids where label='assignment')),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')),'[]'::jsonb)$q$,'42501',null,'binding rechecks current policy after the actual reference UPDATE');
reset role;
select ok((select submission_id is null from private.intake_secret_references where id=(select id from legacy177_ids where label='credential')),
  'late binding denial rolls back reference consumption');
select is((select count(*) from public.form_submissions where form_assignment_id=(select id from legacy177_ids where label='assignment')),
  0::bigint,'late binding denial creates no receipt');
select is((select status from public.form_assignments where id=(select id from legacy177_ids where label='assignment')),
  'assigned','late binding denial leaves the request outstanding');
select is((select answers from private.intake_drafts where assignment_id=(select id from legacy177_ids where label='assignment')),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')),'late binding denial preserves the saved draft');
set local role authenticated;
select pg_temp.legacy177_act(2);
update legacy177_boundary set mode='form_submission_requests';
select throws_ok($q$select public.app_submit_form(gen_random_uuid(),(select id from legacy177_ids where label='original'),
  jsonb_build_object('assignment_id',(select id from legacy177_ids where label='assignment')),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')),'[]'::jsonb)$q$,'42501',null,'final submission check catches policy drift in the final evidence write');
reset role;
select is((select count(*) from public.form_submissions where form_assignment_id=(select id from legacy177_ids where label='assignment')),
  0::bigint,'late evidence denial rolls back receipt, binding and completion');
select is((select status from public.form_assignments where id=(select id from legacy177_ids where label='assignment')),
  'assigned','late evidence denial restores the original outstanding assignment');
set local role authenticated;
select pg_temp.legacy177_act(2);
update legacy177_boundary set mode='off';
select public.app_request_my_order_start(id) from legacy177_ids where label='order';
insert into legacy177_ids select 'submission',(public.app_submit_form(gen_random_uuid(),(select id from legacy177_ids where label='original'),
  jsonb_build_object('assignment_id',(select id from legacy177_ids where label='assignment')),
  pg_temp.legacy177_values((select id from legacy177_ids where label='credential')),'[]'::jsonb)).id;
select is((public.app_reconcile_my_order_start(id)->>'started')::boolean,true,'original frozen version completes and starts the requested order')
  from legacy177_ids where label='assignment';
select ok(position((select id::text from legacy177_ids where label='credential') in public.app_get_form_submission((select id from legacy177_ids where label='submission'))::text)=0,'ordinary receipt stays redacted');
select ok(position((select id::text from legacy177_ids where label='credential') in public.app_get_form_submission_pdf((select id from legacy177_ids where label='submission'))::text)=0,'PDF stays redacted');
select throws_ok($q$select public.app_reveal_intake_secret((select id from legacy177_ids where label='credential'))$q$,'42501',null,'client cannot reveal submitted credential');
select pg_temp.legacy177_act(1);
select is(public.app_reveal_intake_secret((select id from legacy177_ids where label='credential')),'  synthetic legacy credential 177  ','current authorized Owner can explicitly reveal through existing audited boundary');
reset role;
select is((select form_version_id from public.form_submissions where id=(select id from legacy177_ids where label='submission')),
  (select id from legacy177_ids where label='original'),'new receipt binds the original version');
select is((select value->'drawing' from public.form_submission_values where submission_id=(select id from legacy177_ids where label='submission')
  and field_type_snapshot='signature'),'[[[10,20],[50,60]]]'::jsonb,'submitted signature preserves original saved ink');
select is((select value->>'method' from public.form_submission_values where submission_id=(select id from legacy177_ids where label='submission')
  and field_type_snapshot='signature'),'drawn','existing signature attestation remains active');
select is((select to_jsonb(v) from public.form_versions v where id=(select id from legacy177_ids where label='original')),
  (select value from legacy177_evidence where label='original-version'),'original immutable version and hash stay unchanged');
select is((select jsonb_agg(to_jsonb(f) order by sort_order) from public.form_version_fields f where form_version_id=(select id from legacy177_ids where label='original')),
  (select value from legacy177_evidence where label='original-fields'),'all original field definitions and agreement text stay unchanged');
select is((select to_jsonb(s) from public.form_submissions s where id=(select id from legacy177_ids where label='historic-submission')),
  (select value from legacy177_evidence where label='historic-receipt'),'existing receipt stays byte-equivalent');
select is((select jsonb_agg(to_jsonb(v) order by v.sort_order_snapshot) from public.form_submission_values v
  where submission_id=(select id from legacy177_ids where label='historic-submission')),
  (select value from legacy177_evidence where label='historic-values'),'existing answers and signature evidence stay byte-equivalent');
select ok(not exists(select 1 from private.form_submission_requests where actor_profile_id=pg_temp.legacy177_key(2)
  and position('synthetic legacy credential 177' in payload::text)>0)
  and not exists(select 1 from public.form_submission_values where submission_id=(select id from legacy177_ids where label='submission')
    and position('synthetic legacy credential 177' in value::text)>0),'plaintext never enters generic request ledgers or submitted values');
select * from finish();
rollback;
