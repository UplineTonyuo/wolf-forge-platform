begin;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('c4b90000-0000-4000-8000-000000000001','authenticated','authenticated','replay-creator-c4b9@example.invalid',now(),now()),
 ('c4b90000-0000-4000-8000-000000000002','authenticated','authenticated','replay-assignee-c4b9@example.invalid',now(),now());
insert into public.tenants(id,slug,display_name,status) values
 ('c4b90000-0000-4000-8000-000000000010','replay-scope-c4b9','Synthetic replay scope','active');
insert into public.companies(id,tenant_id,name,status) values
 ('c4b90000-0000-4000-8000-000000000020','c4b90000-0000-4000-8000-000000000010','Synthetic replay company','client');
insert into public.services(id,tenant_id,name) values
 ('c4b90000-0000-4000-8000-000000000030','c4b90000-0000-4000-8000-000000000010','Synthetic replay service');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
select 'c4b90000-0000-4000-8000-000000000010',actor.id,'internal',r.id
from (values ('c4b90000-0000-4000-8000-000000000001'::uuid),('c4b90000-0000-4000-8000-000000000002'::uuid)) actor(id)
join public.roles r on r.name='staff';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
select 'c4b90000-0000-4000-8000-000000000010','c4b90000-0000-4000-8000-000000000001',permission_key,allowed
from (values ('projects.view',true),('projects.create',true),('projects.edit',true),('client_private.read',false)) permissions(permission_key,allowed);
create temp table replay_fixture_ids(kind text primary key,id uuid) on commit drop;
grant select,insert on replay_fixture_ids to authenticated;
create function pg_temp.replay_actor() returns void language sql as $$
 select set_config('request.jwt.claim.sub','c4b90000-0000-4000-8000-000000000001',true);
 select set_config('request.jwt.claims','{}',true);
 select set_config('request.headers','{"x-wf-tenant":"c4b90000-0000-4000-8000-000000000010"}',true);
$$;
create function pg_temp.replay_project(p_title text default 'Synthetic original project') returns public.orders language sql as $$
 select * from public.app_create_order(
  'c4b90000-0000-4000-8000-000000000041','c4b90000-0000-4000-8000-000000000020','c4b90000-0000-4000-8000-000000000030',
  p_title,'c4b90000-0000-4000-8000-000000000001','normal',null,null,'Original project notes');
$$;
create function pg_temp.replay_task(p_title text default 'Synthetic original task') returns public.order_tasks language sql as $$
 select * from public.app_create_task(
  'c4b90000-0000-4000-8000-000000000042',(select id from replay_fixture_ids where kind='project'),
  p_title,'c4b90000-0000-4000-8000-000000000001','Original task description',null,0);
$$;
select pg_temp.replay_actor();
set local role authenticated;
insert into replay_fixture_ids select 'project',(pg_temp.replay_project()).id;
insert into replay_fixture_ids select 'task',(pg_temp.replay_task()).id;
select is((pg_temp.replay_project()).id,(select id from replay_fixture_ids where kind='project'),'authorized Project retry returns the original identity');
select is((pg_temp.replay_task()).id,(select id from replay_fixture_ids where kind='task'),'authorized task retry returns the original identity');
select throws_ok($$select pg_temp.replay_project('Changed input')$$,'23505',null,'Project retry still binds the exact original payload');
select throws_ok($$select pg_temp.replay_task('Changed input')$$,'23505',null,'task retry still binds the exact original payload');

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.profile_permission_overrides set allowed=false
where tenant_id='c4b90000-0000-4000-8000-000000000010' and profile_id='c4b90000-0000-4000-8000-000000000001'
 and permission_key in ('projects.create','projects.edit');
select pg_temp.replay_actor();
set local role authenticated;
select lives_ok($$select pg_temp.replay_project()$$,'read-authorized Project retry does not require a second create permission');
select lives_ok($$select pg_temp.replay_task()$$,'read-authorized task retry does not require a second edit permission');

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.orders set assigned_to_profile_id='c4b90000-0000-4000-8000-000000000002',notes='Synthetic confidential notes added after reassignment'
where id=(select id from replay_fixture_ids where kind='project') and tenant_id='c4b90000-0000-4000-8000-000000000010';
update public.order_tasks set assigned_to_profile_id='c4b90000-0000-4000-8000-000000000002',description='Synthetic confidential description added after reassignment'
where id=(select id from replay_fixture_ids where kind='task');
select pg_temp.replay_actor();
set local role authenticated;
select is((select count(*) from public.orders where id=(select id from replay_fixture_ids where kind='project')),0::bigint,'reassigned creator cannot SELECT the Project');
select is((select count(*) from public.order_tasks where id=(select id from replay_fixture_ids where kind='task')),0::bigint,'reassigned creator cannot SELECT the task');
select throws_ok($$select pg_temp.replay_project()$$,'P0002',null,'Project retry cannot disclose later confidential notes after read access is lost');
select throws_ok($$select pg_temp.replay_task()$$,'P0002',null,'task retry cannot disclose later confidential description after read access is lost');

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.tenant_memberships set role_id=(select id from public.roles where name='manager')
where tenant_id='c4b90000-0000-4000-8000-000000000010' and profile_id='c4b90000-0000-4000-8000-000000000001';
select pg_temp.replay_actor();
set local role authenticated;
select lives_ok($$select pg_temp.replay_project()$$,'current Manager Project scope permits the original retry');
select lives_ok($$select pg_temp.replay_task()$$,'current Manager task scope permits the original retry');

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.order_tasks set archived_at=now() where id=(select id from replay_fixture_ids where kind='task');
select pg_temp.replay_actor();
set local role authenticated;
select throws_ok($$select pg_temp.replay_task()$$,'P0002',null,'even a Manager cannot replay an archived task');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.order_tasks set archived_at=null where id=(select id from replay_fixture_ids where kind='task');
update public.orders set archived_at=now()
where id=(select id from replay_fixture_ids where kind='project') and tenant_id='c4b90000-0000-4000-8000-000000000010';
select pg_temp.replay_actor();
set local role authenticated;
select throws_ok($$select pg_temp.replay_project()$$,'P0002',null,'even a Manager cannot replay an archived Project');
select throws_ok($$select pg_temp.replay_task()$$,'P0002',null,'a live task cannot be replayed through an archived Project');

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.profile_permission_overrides set allowed=false
where tenant_id='c4b90000-0000-4000-8000-000000000010' and profile_id='c4b90000-0000-4000-8000-000000000001' and permission_key='projects.view';
select pg_temp.replay_actor();
set local role authenticated;
select throws_ok($$select pg_temp.replay_project()$$,'42501',null,'Project retry preserves explicit view denial');
select throws_ok($$select pg_temp.replay_task()$$,'42501',null,'task retry preserves explicit view denial');
reset role;
select * from finish();
rollback;
