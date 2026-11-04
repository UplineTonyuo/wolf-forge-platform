-- Run only on an authorized isolated synthetic Supabase target.
begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
update public.tenant_memberships set role_id=(select id from public.roles where name='manager')
 where tenant_id='f0f0f0f0-0000-4000-8000-000000001701' and profile_id='20000000-0000-4000-8000-000000001705';
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000002031','manager-foreign-203','Synthetic foreign workspace','active');
insert into public.companies(id,tenant_id,name,status) values
 ('e0000000-0000-4000-8000-000000002031','f0f0f0f0-0000-4000-8000-000000002031','Synthetic foreign client','client');
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('20000000-0000-4000-8000-000000002031','authenticated','authenticated','manager-foreign-203@example.invalid',now(),now());
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
 select 'f0f0f0f0-0000-4000-8000-000000002031','20000000-0000-4000-8000-000000002031','internal',id from public.roles where name='manager';
create function pg_temp.manager_actor(n text default '1703') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,'role','authenticated')::text,true);
 perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
select ok(not has_table_privilege('authenticated','private.client_manager_assignments','select,insert,update,delete'),'no direct browser assignment access');
select ok(not has_function_privilege('anon','public.app_assign_client_manager(uuid,uuid)','execute'),'anonymous assignment refused');
select pg_temp.manager_actor(); set local role authenticated;
select is((select count(*) from public.app_list_client_manager_options()),1::bigint,'only active same-workspace manager is offered');
select is(public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705'),
 '20000000-0000-4000-8000-000000001705'::uuid,'assignment persisted and read back');
select is(public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705'),
 '20000000-0000-4000-8000-000000001705'::uuid,'exact retry is idempotent');
select is((select manager_profile_id from public.app_list_client_manager_assignments() where company_id='e0000000-0000-4000-8000-000000001701'),
 '20000000-0000-4000-8000-000000001705'::uuid,'fresh authoritative list retains manager');
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000002031','20000000-0000-4000-8000-000000001705')$$,'P0002',null,'foreign client is indistinguishable from missing');
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704')$$,'22023',null,'administrator role is not a manager assignment');
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000002031')$$,'22023',null,'active manager from another workspace is rejected');
reset role;
select is((select count(*) from private.client_manager_assignments),1::bigint,'only selected account changes');
select is((select count(*) from public.activity_events where entity_id='e0000000-0000-4000-8000-000000001701' and metadata->>'field'='manager_profile_id'),1::bigint,'one audit for assignment, none for exact replay');
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704','clients.edit',false);
select pg_temp.manager_actor('1704'); set local role authenticated;
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705')$$,'42501',null,'explicit internal edit denial stays authoritative');
reset role;
select pg_temp.manager_actor('1704');
delete from public.profile_permission_overrides where tenant_id='f0f0f0f0-0000-4000-8000-000000001701' and profile_id='20000000-0000-4000-8000-000000001704' and permission_key='clients.edit';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
 select 'f0f0f0f0-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704',required_permission_key,false
 from public.permission_modules where module_key='clients';
set local role authenticated;
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705')$$,'42501',null,'Clients module permission denial blocks assignment');
select throws_ok($$select * from public.app_list_client_manager_options()$$,'42501',null,'Clients module denial also hides manager choices');
reset role;
delete from public.profile_permission_overrides where tenant_id='f0f0f0f0-0000-4000-8000-000000001701' and profile_id='20000000-0000-4000-8000-000000001704';
select pg_temp.manager_actor();
update public.profiles set archived_at=now() where id='20000000-0000-4000-8000-000000001705';
set local role authenticated;
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705')$$,'22023',null,'archived profile is rejected despite active membership');
reset role;
update public.profiles set archived_at=null where id='20000000-0000-4000-8000-000000001705';
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001701' and profile_id='20000000-0000-4000-8000-000000001705';
set local role authenticated;
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705')$$,'22023',null,'revoked manager is rejected even on retry');
reset role;
select pg_temp.manager_actor('1701'); set local role authenticated;
select throws_ok($$select public.app_assign_client_manager('e0000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001705')$$,'42501',null,'client cannot assign a manager');
reset role;
select * from finish();
rollback;
