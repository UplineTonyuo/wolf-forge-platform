-- Synthetic fixtures only. Execute against a fully migrated isolated Supabase database.
begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b1740000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','support-'||n||'@example.invalid',now(),now()
from generate_series(1,5)n;
insert into public.tenants(id,slug,display_name,status) values
('b1740000-0000-4000-8000-000000000010','support-a','Support A','active'),
('b1740000-0000-4000-8000-000000000011','support-b','Support B','active');
insert into public.companies(id,tenant_id,name,status) values
('b1740000-0000-4000-8000-000000000020','b1740000-0000-4000-8000-000000000010','Support buyer A','client'),
('b1740000-0000-4000-8000-000000000021','b1740000-0000-4000-8000-000000000011','Support buyer B','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.actor::uuid,v.kind,r.id,v.company::uuid from (values
('b1740000-0000-4000-8000-000000000010','b1740000-0000-4000-8000-000000000001','internal','owner',null),
('b1740000-0000-4000-8000-000000000010','b1740000-0000-4000-8000-000000000002','client','client','b1740000-0000-4000-8000-000000000020'),
('b1740000-0000-4000-8000-000000000010','b1740000-0000-4000-8000-000000000003','internal','manager',null),
('b1740000-0000-4000-8000-000000000011','b1740000-0000-4000-8000-000000000004','client','client','b1740000-0000-4000-8000-000000000021'),
('b1740000-0000-4000-8000-000000000010','b1740000-0000-4000-8000-000000000005','internal','admin',null)
)v(tenant,actor,kind,role_name,company) join public.roles r on r.name=v.role_name;
insert into auth.sessions(id,user_id,aal,not_after)
select ('c1740000-0000-4000-8000-00000000000'||n)::uuid,('b1740000-0000-4000-8000-00000000000'||n)::uuid,'aal1',now()+interval '1 day'
from generate_series(1,5)n;
create temp table support174_ids(label text primary key,id uuid);
grant all on support174_ids to authenticated;
create function pg_temp.support_actor(n integer default 1) returns void language sql as $$
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','b1740000-0000-4000-8000-00000000000'||n,'role','authenticated','session_id','c1740000-0000-4000-8000-00000000000'||n)::text,true);
select set_config('request.headers','{"x-wf-tenant":"b1740000-0000-4000-8000-000000000010"}',true);
select set_config('app.client_support_id','',true);
select set_config('app.client_support_administrator','',true);
$$;
create function pg_temp.support_request(p_operation text default '/rpc/app_get_client_support_context',p_method text default 'GET',p_n integer default 1,p_tenant text default 'b1740000-0000-4000-8000-000000000010',p_secret text default repeat('a',64)) returns void language sql as $$
select pg_temp.support_actor(p_n);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',p_tenant,'x-wf-client-support',(select id::text from support174_ids where label='session')||'.'||p_secret)::text,true);
select set_config('request.path',p_operation,true);
select set_config('request.method',p_method,true);
$$;
select ok(not has_function_privilege('anon','public.app_begin_client_support(uuid,text)','execute'),'anonymous start is denied');
select ok(not has_function_privilege('service_role','public.app_begin_client_support(uuid,text)','execute'),'no service-role support bypass');
select ok(not has_function_privilege('authenticated','private.require_client_support_authority(uuid,uuid,uuid,uuid)','execute'),'authority helper is not directly callable');
select ok(not has_table_privilege('authenticated','private.client_support_sessions','select'),'browser cannot read capability ledger');
set local role authenticated;
select pg_temp.support_actor(3);
select throws_ok($q$select public.app_begin_client_support('b1740000-0000-4000-8000-000000000002',repeat('b',64))$q$,'42501',null,'manager cannot impersonate');
select pg_temp.support_actor(1);
select throws_ok($q$select public.app_begin_client_support('b1740000-0000-4000-8000-000000000004',repeat('b',64))$q$,'42501',null,'foreign Tenant target is denied');
insert into support174_ids select 'session',(public.app_begin_client_support('b1740000-0000-4000-8000-000000000002',encode(extensions.digest(repeat('a',64),'sha256'),'hex'))->>'id')::uuid;
select throws_ok($q$select public.app_begin_client_support('b1740000-0000-4000-8000-000000000002',repeat('b',64))$q$,'42501',null,'second active lease on same original session is denied');
select pg_temp.support_request();
select throws_ok($q$select public.app_get_client_support_context()$q$,'42501',null,'proof refuses when hook is absent');
select throws_ok($q$select private.current_tenant_id()$q$,'42501',null,'tenant guard refuses missing hook instead of compatibility fallback');
select throws_ok($q$select public.app_mark_all_notifications_read()$q$,'42501',null,'ordinary write cannot silently act as owner without hook');
select throws_ok($q$select * from public.app_get_my_profile()$q$,'42501',null,'legacy profile RPC refuses missing hook');
select throws_ok($q$select * from public.app_get_wf_card_settings()$q$,'42501',null,'global WF settings RPC refuses missing hook');
select throws_ok($q$select id from public.profiles limit 1$q$,'42501',null,'direct profile GET refuses missing hook through restrictive guard');
select lives_ok($q$select public.app_apply_client_support_context()$q$,'valid pre-request context is accepted');
select is(auth.uid(),'b1740000-0000-4000-8000-000000000002'::uuid,'effective subject is the client');
select is(auth.jwt()->>'session_id','c1740000-0000-4000-8000-000000000001','original session binding is retained');
select is(public.app_get_client_support_context()->>'administratorId','b1740000-0000-4000-8000-000000000001','proof retains actual administrator');
select is((select profile_id from public.app_get_my_profile()),'b1740000-0000-4000-8000-000000000002'::uuid,'self-profile uses target client');
select pg_temp.support_request('/rpc/app_unreviewed_future_action','POST');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'future API operations require explicit review');
select pg_temp.support_request('/profiles','PATCH');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'direct profile writes are never delegated');
select pg_temp.support_request('/rpc/app_update_my_profile','POST');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'account profile mutation is never delegated');
select pg_temp.support_request('/rpc/app_get_my_push_configuration','POST');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'device enrollment is never delegated');
select pg_temp.support_request(p_n=>5);
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'another administrator cannot adopt capability');
select pg_temp.support_request(p_tenant=>'b1740000-0000-4000-8000-000000000011');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'capability cannot cross Tenant');
select pg_temp.support_request(p_secret=>repeat('b',64));
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'wrong capability secret is denied');
select pg_temp.support_request();
select set_config('request.jwt.claims',jsonb_build_object('sub','b1740000-0000-4000-8000-000000000001','role','authenticated','session_id','c1740000-0000-4000-8000-000000000005')::text,true);
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'same user with another original auth session is denied');
reset role;
update public.tenant_memberships set role_id=(select id from public.roles where name='staff') where profile_id='b1740000-0000-4000-8000-000000000001' and tenant_id='b1740000-0000-4000-8000-000000000010';
set local role authenticated;
select pg_temp.support_request();
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'role removal takes effect on the next request');
select pg_temp.support_actor();
select lives_ok($q$select public.app_end_client_support((select id from support174_ids where label='session'))$q$,'original session can Exit after role removal');
select is((public.app_get_own_client_support_state((select id from support174_ids where label='session'))->>'active')::boolean,false,'Exit state is independently confirmed');
select lives_ok($q$select public.app_end_client_support((select id from support174_ids where label='session'))$q$,'Exit retry is idempotent');
reset role;
select is((select count(*) from public.security_audit_events where resource_id=(select id from support174_ids where label='session') and event_code='authorization.client_support.ended'),1::bigint,'idempotent Exit creates only one end audit');
select is((select actor_profile_id from public.security_audit_events where resource_id=(select id from support174_ids where label='session') and event_code='authorization.client_support.started'),'b1740000-0000-4000-8000-000000000001'::uuid,'audit identifies original administrator');
select is((select target_actor_id from public.security_audit_events where resource_id=(select id from support174_ids where label='session') and event_code='authorization.client_support.started'),'b1740000-0000-4000-8000-000000000002'::uuid,'audit identifies target client');
select pg_temp.support_actor();
select ok(public.app_client_support_request_valid(),'normal requests remain unchanged without support header');
-- Reopen only the synthetic harness lease to exercise fresh authority and signature evidence.
update public.tenant_memberships set role_id=(select id from public.roles where name='owner') where profile_id='b1740000-0000-4000-8000-000000000001' and tenant_id='b1740000-0000-4000-8000-000000000010';
select pg_temp.support_actor();
set local role authenticated;
insert into support174_ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding','canonical_key','support-signature-174','definition',jsonb_build_object(
  'name','Support signature fixture','title','Support signature fixture','visibility','assigned','type_config','{}'::jsonb,
  'fields',jsonb_build_array(jsonb_build_object('stable_field_key','b1740000-0000-4000-8000-000000000050','sort_order',0,
    'field_type','signature','label','Client agreement','required',true,'settings',jsonb_build_object('signature_mode','drawn'),'help_html','<p>Synthetic agreement.</p>')),
  'rules','[]'::jsonb,'service_links','[]'::jsonb)))).id;
insert into support174_ids select 'version',(public.app_publish_form(gen_random_uuid(),id)).id from support174_ids where label='form';
insert into support174_ids select 'assignment',(public.app_assign_form(gen_random_uuid(),id,jsonb_build_object(
  'company_id','b1740000-0000-4000-8000-000000000020','client_profile_id','b1740000-0000-4000-8000-000000000002'))).id from support174_ids where label='form';
reset role;
update private.client_support_sessions set ended_at=null where id=(select id from support174_ids where label='session');
set local role authenticated;
select pg_temp.support_request('/rpc/app_submit_form','POST');
select public.app_apply_client_support_context();
select throws_ok($q$select public.app_submit_form(gen_random_uuid(),(select id from support174_ids where label='version'),
  jsonb_build_object('assignment_id',(select id from support174_ids where label='assignment')),
  jsonb_build_array(jsonb_build_object('field_key','b1740000-0000-4000-8000-000000000050','value',jsonb_build_object('consent',true,'drawing','[[[10,20],[90,60]]]'::jsonb,'support_administrator_id','b1740000-0000-4000-8000-000000000005'))),'[]'::jsonb)$q$,
  '23514',null,'caller cannot forge administrator signature provenance');
insert into support174_ids select 'submission',(public.app_submit_form(gen_random_uuid(),(select id from support174_ids where label='version'),
  jsonb_build_object('assignment_id',(select id from support174_ids where label='assignment')),
  jsonb_build_array(jsonb_build_object('field_key','b1740000-0000-4000-8000-000000000050','value',jsonb_build_object('consent',true,'drawing','[[[10,20],[90,60]]]'::jsonb))),'[]'::jsonb)).id;
reset role;
select is((select value->>'support_administrator_id' from public.form_submission_values where submission_id=(select id from support174_ids where label='submission')),
  'b1740000-0000-4000-8000-000000000001','drawn signature records actual administrator, not independent client authorship');
select is((select value->>'support_session_id' from public.form_submission_values where submission_id=(select id from support174_ids where label='submission')),
  (select id::text from support174_ids where label='session'),'drawn signature binds its support session');
select is((public.app_get_form_submission_pdf((select id from support174_ids where label='submission'))->'original'->'values'->0->'value'->>'support_administrator_id'),
  'b1740000-0000-4000-8000-000000000001','PDF projection retains support provenance');
update private.client_support_sessions set created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '5 minutes' where id=(select id from support174_ids where label='session');
set local role authenticated;
select pg_temp.support_request();
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'expired capability fails on next request');
reset role;
update private.client_support_sessions set created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '15 minutes' where id=(select id from support174_ids where label='session');
update public.tenant_memberships set archived_at=clock_timestamp() where profile_id='b1740000-0000-4000-8000-000000000002' and tenant_id='b1740000-0000-4000-8000-000000000010';
set local role authenticated;
select pg_temp.support_request();
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'archived target cannot retain delegated access');
reset role;
update public.tenant_memberships set archived_at=null where profile_id='b1740000-0000-4000-8000-000000000002' and tenant_id='b1740000-0000-4000-8000-000000000010';
delete from auth.sessions where id='c1740000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.support_request();
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'revoked original Auth session cannot keep client support alive');
reset role;
select * from finish();
rollback;
