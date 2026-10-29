begin;
select no_plan();
create temp table unchanged_manager_grants as select permission_key,allowed from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.name='manager' and permission_key not like 'projects.%';
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000178'||n)::uuid,'authenticated','authenticated','project-manager-'||n||'@example.invalid',now(),now() from generate_series(1,5) n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001780','manager-project-a','Manager QA A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001781','manager-project-b','Manager QA B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('d0000000-0000-4000-8000-000000001780','f0f0f0f0-0000-4000-8000-000000001780','Manager QA Client A','client'),
 ('d0000000-0000-4000-8000-000000001781','f0f0f0f0-0000-4000-8000-000000001781','Manager QA Client B','client');
insert into public.services(id,tenant_id,name) values
 ('d1000000-0000-4000-8000-000000001780','f0f0f0f0-0000-4000-8000-000000001780','Manager QA Service A'),
 ('d1000000-0000-4000-8000-000000001781','f0f0f0f0-0000-4000-8000-000000001781','Manager QA Service B');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.account_class,r.id,v.company::uuid from (values
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781','internal','manager',null),
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001782','internal','staff',null),
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001783','client','client','d0000000-0000-4000-8000-000000001780'),
 ('f0f0f0f0-0000-4000-8000-000000001781','20000000-0000-4000-8000-000000001784','internal','manager',null),
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001785','internal','owner',null)
) v(tenant,profile,account_class,role_name,company) join public.roles r on r.name=v.role_name;
select private.grant_platform_admin('20000000-0000-4000-8000-000000001785','Isolated Manager module test');
insert into public.orders(id,tenant_id,company_id,service_id,title) values
 ('d3000000-0000-4000-8000-000000001780','f0f0f0f0-0000-4000-8000-000000001780','d0000000-0000-4000-8000-000000001780','d1000000-0000-4000-8000-000000001780','Unassigned project one'),
 ('d3000000-0000-4000-8000-000000001781','f0f0f0f0-0000-4000-8000-000000001780','d0000000-0000-4000-8000-000000001780','d1000000-0000-4000-8000-000000001780','Unassigned project two'),
 ('d3000000-0000-4000-8000-000000001782','f0f0f0f0-0000-4000-8000-000000001781','d0000000-0000-4000-8000-000000001781','d1000000-0000-4000-8000-000000001781','Other workspace project');
insert into public.order_tasks(id,order_id,title) values
 ('d4000000-0000-4000-8000-000000001780','d3000000-0000-4000-8000-000000001780','Unassigned task one'),
 ('d4000000-0000-4000-8000-000000001781','d3000000-0000-4000-8000-000000001781','Unassigned task two'),
 ('d4000000-0000-4000-8000-000000001782','d3000000-0000-4000-8000-000000001782','Other workspace task');
create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000001780') returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000178'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.visible_count(statement text) returns bigint language plpgsql as $$
declare result bigint;
begin execute statement into result; return result;
exception when insufficient_privilege then return 0;
end;
$$;
select pg_temp.act(1);
set local role authenticated;
select is((select count(*) from public.orders where id in ('d3000000-0000-4000-8000-000000001780','d3000000-0000-4000-8000-000000001781')),2::bigint,'Manager sees both unassigned workspace projects');
select is((select count(*) from public.order_tasks where id in ('d4000000-0000-4000-8000-000000001780','d4000000-0000-4000-8000-000000001781')),2::bigint,'Manager sees all workspace project tasks');
select is((select count(*) from public.orders where id='d3000000-0000-4000-8000-000000001782'),0::bigint,'Manager cannot read another workspace project');
select is((select count(*) from public.order_tasks where id='d4000000-0000-4000-8000-000000001782'),0::bigint,'Manager cannot read another workspace task');
select is(public.app_has_permission('client_private.read'),false,'Project scope does not grant private client authority');
select lives_ok($$select public.app_update_order('d3000000-0000-4000-8000-000000001780','{"title":"Manager edited"}')$$,'Manager edits an unassigned project');
select lives_ok($$select public.app_change_order_status('d3000000-0000-4000-8000-000000001780','working')$$,'Manager changes project status');
select lives_ok($$select public.app_assign_order('d3000000-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781')$$,'Manager assigns a workspace project');
select lives_ok($$select public.app_create_task('d5000000-0000-4000-8000-000000001780','d3000000-0000-4000-8000-000000001781','Manager created task',null,null,null,0)$$,'Manager creates a nonblank task on an unassigned project');
select lives_ok($$select public.app_create_task('d5000000-0000-4000-8000-000000001780','d3000000-0000-4000-8000-000000001781','Manager created task',null,null,null,0)$$,'accepted task retry uses the same request');
select is((select count(*) from public.order_tasks where order_id='d3000000-0000-4000-8000-000000001781' and title='Manager created task'),1::bigint,'task persisted exactly once after retry');
select throws_ok($$select public.app_create_task(gen_random_uuid(),'d3000000-0000-4000-8000-000000001781','   ',null,null,null,0)$$,'23514',null,'whitespace task title rejected by database');
select throws_ok($$select public.app_create_task(gen_random_uuid(),'d3000000-0000-4000-8000-000000001782','Foreign task',null,null,null,0)$$,'P0002',null,'task creation in another Tenant is denied');
select public.app_change_task_status(id,'complete') from public.order_tasks where order_id='d3000000-0000-4000-8000-000000001781' and title='Manager created task';
select pg_temp.act(3);
select is((select task_total from public.app_get_my_client_project('d3000000-0000-4000-8000-000000001781')),2,'client authoritative progress includes created task');
select is((select task_open from public.app_get_my_client_project('d3000000-0000-4000-8000-000000001781')),1,'client progress reflects task completion');
select ok(not (to_jsonb(public.app_get_my_client_project('d3000000-0000-4000-8000-000000001781')) ? 'tasks'),'client receives counts without private task rows');
select pg_temp.act(1);
select public.app_change_task_status(id,'todo') from public.order_tasks where order_id='d3000000-0000-4000-8000-000000001781' and title='Manager created task';
select pg_temp.act(3);
select is((select task_open from public.app_get_my_client_project('d3000000-0000-4000-8000-000000001781')),2,'reopening the task updates client progress');
select pg_temp.act(1);
select lives_ok($$select public.app_update_task('d4000000-0000-4000-8000-000000001780','{"title":"Manager renamed task"}')$$,'Manager edits a task');
select lives_ok($$select public.app_change_task_status('d4000000-0000-4000-8000-000000001780','in_progress')$$,'Manager changes task status');
select lives_ok($$select public.app_assign_task('d4000000-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001782')$$,'Manager assigns a workspace task');
select throws_ok($$select public.app_assign_task('d4000000-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001784')$$,'23514',null,'Foreign workspace assignee refused');
select throws_ok($$select public.app_assign_task('d4000000-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001783')$$,'23514',null,'Client cannot be an internal task assignee');
select throws_ok($$select public.app_update_order('d3000000-0000-4000-8000-000000001782','{"title":"Foreign"}')$$,'P0002',null,'Foreign workspace project mutation refused');
select pg_temp.act(2);
select is((select count(*) from public.orders where id='d3000000-0000-4000-8000-000000001781'),0::bigint,'Staff scope is not widened');
select pg_temp.act(3);
select throws_ok($$select public.app_update_order('d3000000-0000-4000-8000-000000001780','{"title":"Client"}')$$,'42501',null,'Client cannot manage projects');
reset role;
select pg_temp.act(5);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781','projects.edit',false),
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781','projects.assign',false),
 ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781','projects.archive',false);
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_update_order('d3000000-0000-4000-8000-000000001781','{"title":"Denied"}')$$,'42501',null,'Manager edit deny remains enforced');
select throws_ok($$select public.app_change_task_status('d4000000-0000-4000-8000-000000001780','complete')$$,'42501',null,'Manager task edit deny remains enforced');
reset role;
select pg_temp.act(5);
update public.profile_permission_overrides set allowed=true where tenant_id='f0f0f0f0-0000-4000-8000-000000001780' and profile_id='20000000-0000-4000-8000-000000001781' and permission_key='projects.edit';
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_assign_order('d3000000-0000-4000-8000-000000001781','20000000-0000-4000-8000-000000001782')$$,'42501',null,'Manager assign deny is enforced while edit is allowed');
select throws_ok($$select public.app_assign_task('d4000000-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781')$$,'42501',null,'Manager task assign deny is enforced while edit is allowed');
select throws_ok($$select public.app_archive_order('d3000000-0000-4000-8000-000000001781')$$,'42501',null,'Manager archive deny remains enforced');
reset role;
select pg_temp.act(5);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values ('f0f0f0f0-0000-4000-8000-000000001780','20000000-0000-4000-8000-000000001781','projects.view',false);
select pg_temp.act(1);
set local role authenticated;
select is((select count(*) from public.orders where id='d3000000-0000-4000-8000-000000001780'),0::bigint,'Manager view deny hides even their assigned project');
select is((select count(*) from public.order_tasks where id='d4000000-0000-4000-8000-000000001780'),0::bigint,'Manager view deny hides project tasks');
reset role;
select pg_temp.act(5);
delete from public.profile_permission_overrides where tenant_id='f0f0f0f0-0000-4000-8000-000000001780' and profile_id='20000000-0000-4000-8000-000000001781';
select pg_temp.act(1);
set local role authenticated;
select lives_ok($$select public.app_archive_order('d3000000-0000-4000-8000-000000001781')$$,'Manager can archive an unassigned workspace project');
reset role;
select pg_temp.act(5);
select public.app_change_task_status('d4000000-0000-4000-8000-000000001780','complete');
select public.app_change_order_status('d3000000-0000-4000-8000-000000001780','complete');
select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000001780',0,(select array_agg(module_key order by module_key) from private.white_label_modules where module_key<>'projects'),'Disable Projects in isolated Manager QA');
select pg_temp.act(1);
set local role authenticated;
select is((select count(*) from public.orders where id='d3000000-0000-4000-8000-000000001780'),0::bigint,'Published Projects disablement hides Manager projects');
select is((select count(*) from public.order_tasks where id='d4000000-0000-4000-8000-000000001780'),0::bigint,'Published Projects disablement hides Manager tasks');
select throws_ok($$select public.app_update_order('d3000000-0000-4000-8000-000000001780','{"title":"Disabled"}')$$,'42501',null,'Manager cannot edit with Projects disabled');
reset role;
select pg_temp.act(5);
select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000001780',1,(select array_agg(module_key order by module_key) from private.white_label_modules),'Restore isolated Manager QA modules');
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001780' and profile_id='20000000-0000-4000-8000-000000001781';
select pg_temp.act(1);
set local role authenticated;
select is(pg_temp.visible_count($$select count(*) from public.orders where id='d3000000-0000-4000-8000-000000001780'$$),0::bigint,'Revoked Manager membership loses project access');
reset role;
select results_eq($$select permission_key,allowed from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.name='manager' and permission_key not like 'projects.%' order by permission_key$$,$$select permission_key,allowed from unchanged_manager_grants order by permission_key$$,'Other Manager permissions are unchanged');
select * from finish();
rollback;
