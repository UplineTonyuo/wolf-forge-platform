-- Rollback-only reproduction. Inserts and updates only the c4b9 synthetic fixture.
-- Run as the database administrator; do not remove BEGIN/ROLLBACK.
begin;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select set_config('request.headers','{}',true);

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

select set_config('request.jwt.claim.sub','c4b90000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{}',true);
select set_config('request.headers','{"x-wf-tenant":"c4b90000-0000-4000-8000-000000000010"}',true);
set local role authenticated;
insert into replay_fixture_ids select 'project',(public.app_create_order(
 'c4b90000-0000-4000-8000-000000000041','c4b90000-0000-4000-8000-000000000020','c4b90000-0000-4000-8000-000000000030',
 'Synthetic original project','c4b90000-0000-4000-8000-000000000001','normal',null,null,'Original project notes')).id;
insert into replay_fixture_ids select 'task',(public.app_create_task(
 'c4b90000-0000-4000-8000-000000000042',(select id from replay_fixture_ids where kind='project'),
 'Synthetic original task','c4b90000-0000-4000-8000-000000000001','Original task description',null,0)).id;

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.orders set assigned_to_profile_id='c4b90000-0000-4000-8000-000000000002',notes='Synthetic confidential notes added after reassignment'
where id=(select id from replay_fixture_ids where kind='project') and tenant_id='c4b90000-0000-4000-8000-000000000010';
update public.order_tasks set assigned_to_profile_id='c4b90000-0000-4000-8000-000000000002',description='Synthetic confidential description added after reassignment'
where id=(select id from replay_fixture_ids where kind='task');
update public.profile_permission_overrides set allowed=false
where tenant_id='c4b90000-0000-4000-8000-000000000010' and profile_id='c4b90000-0000-4000-8000-000000000001'
 and permission_key in ('projects.create','projects.edit');

select set_config('request.jwt.claim.sub','c4b90000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select jsonb_build_object(
 'project_select_denied',(select count(*)=0 from public.orders where id=(select id from replay_fixture_ids where kind='project')),
 'task_select_denied',(select count(*)=0 from public.order_tasks where id=(select id from replay_fixture_ids where kind='task')),
 'project_replay_leaks_fresh_notes',(public.app_create_order(
   'c4b90000-0000-4000-8000-000000000041','c4b90000-0000-4000-8000-000000000020','c4b90000-0000-4000-8000-000000000030',
   'Synthetic original project','c4b90000-0000-4000-8000-000000000001','normal',null,null,'Original project notes')).notes='Synthetic confidential notes added after reassignment',
 'task_replay_leaks_fresh_description',(public.app_create_task(
   'c4b90000-0000-4000-8000-000000000042',(select id from replay_fixture_ids where kind='project'),
   'Synthetic original task','c4b90000-0000-4000-8000-000000000001','Original task description',null,0)).description='Synthetic confidential description added after reassignment'
) as synthetic_replay_proof;
rollback;
