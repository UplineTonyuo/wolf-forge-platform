-- Real business RPCs and synthetic rows only; every fixture rolls back.
begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b1750000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated',
  'support-forms-'||n||'@example.invalid',now(),now() from generate_series(1,6)n;
insert into public.tenants(id,slug,display_name,status) values
('b1750000-0000-4000-8000-000000000010','support-forms-a','Support Forms A','active'),
('b1750000-0000-4000-8000-000000000011','support-forms-b','Support Forms B','active');
insert into public.companies(id,tenant_id,name,status) values
('b1750000-0000-4000-8000-000000000020','b1750000-0000-4000-8000-000000000010','Selected Company','client'),
('b1750000-0000-4000-8000-000000000021','b1750000-0000-4000-8000-000000000010','Other Company','client'),
('b1750000-0000-4000-8000-000000000022','b1750000-0000-4000-8000-000000000011','Foreign Company','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.kind,r.id,v.company::uuid from (values
('b1750000-0000-4000-8000-000000000010','b1750000-0000-4000-8000-000000000001','internal','owner',null),
('b1750000-0000-4000-8000-000000000010','b1750000-0000-4000-8000-000000000002','client','client','b1750000-0000-4000-8000-000000000020'),
('b1750000-0000-4000-8000-000000000010','b1750000-0000-4000-8000-000000000003','client','client','b1750000-0000-4000-8000-000000000020'),
('b1750000-0000-4000-8000-000000000010','b1750000-0000-4000-8000-000000000004','client','client','b1750000-0000-4000-8000-000000000021'),
('b1750000-0000-4000-8000-000000000011','b1750000-0000-4000-8000-000000000005','client','client','b1750000-0000-4000-8000-000000000022'),
('b1750000-0000-4000-8000-000000000011','b1750000-0000-4000-8000-000000000006','internal','owner',null)
)v(tenant,profile,kind,role_name,company) join public.roles r on r.name=v.role_name;
insert into auth.sessions(id,user_id,aal,not_after)
select ('c1750000-0000-4000-8000-00000000000'||n)::uuid,('b1750000-0000-4000-8000-00000000000'||n)::uuid,'aal1',now()+interval '1 day'
from generate_series(1,6)n;

create temp table support175_ids(label text primary key,id uuid not null);
grant all on support175_ids to authenticated;
create function pg_temp.forms175_act(n integer,tenant text default 'b1750000-0000-4000-8000-000000000010')
returns void language sql as $$
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','b1750000-0000-4000-8000-00000000000'||n,
  'role','authenticated','session_id','c1750000-0000-4000-8000-00000000000'||n)::text,true);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);
select set_config('app.client_support_id','',true);
select set_config('app.client_support_administrator','',true);
$$;
create function pg_temp.forms175_definition() returns jsonb language sql as $$
select jsonb_build_object('name','Onboarding Visibility Fixture','title','Onboarding Visibility Fixture',
  'visibility','assigned','type_config','{}'::jsonb,'rules','[]'::jsonb,'service_links','[]'::jsonb,
  'fields',jsonb_build_array(jsonb_build_object('stable_field_key','b1750000-0000-4000-8000-000000000050',
    'sort_order',0,'field_type','text','label','Business name','required',true)));
$$;
create function pg_temp.forms175_submit(n integer,version_label text default 'version-a') returns uuid language sql as $$
select (public.app_submit_form(gen_random_uuid(),(select id from support175_ids where label=version_label),
  jsonb_build_object('assignment_id',(select id from support175_ids where label='assignment-'||n)),
  jsonb_build_array(jsonb_build_object('field_key','b1750000-0000-4000-8000-000000000050','value','Synthetic business '||n)),
  '[]'::jsonb)).id;
$$;
create function pg_temp.forms175_request(tenant text default 'b1750000-0000-4000-8000-000000000010') returns void language sql as $$
select pg_temp.forms175_act(1,tenant);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant,
  'x-wf-client-support',(select id::text from support175_ids where label='session')||'.'||repeat('a',64))::text,true);
select set_config('request.path','/rpc/app_list_form_submissions',true);
select set_config('request.method','GET',true);
$$;
create function pg_temp.forms175_no_access() returns boolean language plpgsql as $$
begin
  return (select count(*) from public.app_list_form_submissions())=0;
exception when insufficient_privilege then return true;
end;
$$;

set local role authenticated;
select pg_temp.forms175_act(1);
insert into support175_ids select 'form-a',(public.app_create_form(gen_random_uuid(),jsonb_build_object(
  'form_type','onboarding','canonical_key','support-forms-175-a','definition',pg_temp.forms175_definition()))).id;
insert into support175_ids select 'version-a',(public.app_publish_form(gen_random_uuid(),id)).id from support175_ids where label='form-a';
insert into support175_ids select 'assignment-'||v.n,(public.app_assign_form(gen_random_uuid(),
  (select id from support175_ids where label='form-a'),jsonb_build_object('company_id',v.company,
    'client_profile_id','b1750000-0000-4000-8000-00000000000'||v.n))).id
from (values(2,'b1750000-0000-4000-8000-000000000020'),(3,'b1750000-0000-4000-8000-000000000020'),
  (4,'b1750000-0000-4000-8000-000000000021'))v(n,company);
select pg_temp.forms175_act(6,'b1750000-0000-4000-8000-000000000011');
insert into support175_ids select 'form-b',(public.app_create_form(gen_random_uuid(),jsonb_build_object(
  'form_type','onboarding','canonical_key','support-forms-175-b','definition',pg_temp.forms175_definition()))).id;
insert into support175_ids select 'version-b',(public.app_publish_form(gen_random_uuid(),id)).id from support175_ids where label='form-b';
insert into support175_ids select 'assignment-5',(public.app_assign_form(gen_random_uuid(),id,jsonb_build_object(
  'company_id','b1750000-0000-4000-8000-000000000022','client_profile_id','b1750000-0000-4000-8000-000000000005'))).id
from support175_ids where label='form-b';
select pg_temp.forms175_act(2);
insert into support175_ids select 'submission-2',pg_temp.forms175_submit(2);
select pg_temp.forms175_act(3);
insert into support175_ids select 'submission-3',pg_temp.forms175_submit(3);
select pg_temp.forms175_act(4);
insert into support175_ids select 'submission-4',pg_temp.forms175_submit(4);
select pg_temp.forms175_act(5,'b1750000-0000-4000-8000-000000000011');
insert into support175_ids select 'submission-5',pg_temp.forms175_submit(5,'version-b');
select pg_temp.forms175_act(2);
select is((select count(*) from public.app_list_form_submissions()),1::bigint,'normal selected client still sees exactly their own submission');
select pg_temp.forms175_act(1);
insert into support175_ids select 'session',(public.app_begin_client_support('b1750000-0000-4000-8000-000000000002',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'))->>'id')::uuid;
select pg_temp.forms175_request();
select throws_ok($q$select * from public.app_list_form_submissions()$q$,'42501',null,'submission listing fails closed without verified pre-request context');
select lives_ok($q$select public.app_apply_client_support_context()$q$,'reviewed submission-list RPC is accepted by the support hook');
select is((select count(*) from public.app_list_form_submissions()),1::bigint,'delegated submission list remains exact-client scoped');
select is((select id from public.app_list_form_submissions()),(select id from support175_ids where label='submission-2'),
  'delegated visibility receives the selected client submission');
select is((select count(*) from public.app_list_form_submissions() where id=(select id from support175_ids where label='submission-3')),0::bigint,
  'another client in the same company is excluded');
select is((select count(*) from public.app_list_form_submissions() where id=(select id from support175_ids where label='submission-4')),0::bigint,
  'another company in the same Tenant is excluded');
select is((select count(*) from public.app_list_form_submissions((select id from support175_ids where label='form-b'))),0::bigint,
  'foreign Tenant form selector cannot broaden visibility');
select is((select count(*) from public.app_list_form_submissions() where id=(select id from support175_ids where label='submission-5')),0::bigint,
  'foreign Tenant submission is excluded');
select pg_temp.forms175_request('b1750000-0000-4000-8000-000000000011');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'support capability cannot switch Tenant');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('b1750000-0000-4000-8000-000000000010','b1750000-0000-4000-8000-000000000002','forms.view',false);
set local role authenticated;
select pg_temp.forms175_request();
select public.app_apply_client_support_context();
select ok(pg_temp.forms175_no_access(),'revoked selected-client Forms permission returns no submissions');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('b1750000-0000-4000-8000-000000000010','b1750000-0000-4000-8000-000000000001','client_private.manage',false);
set local role authenticated;
select pg_temp.forms175_request();
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'administrator access revocation denies the next delegated listing');
reset role;
select ok(not has_function_privilege('authenticated','private.client_support_operation_allowed(text,text)','execute'),
  'extending the reviewed list adds no direct authority-helper grant');
select * from finish();
rollback;
