begin;

select plan(38);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'internal-owner@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'internal-admin@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'internal-manager@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'internal-staff@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'internal-archived-staff@example.invalid', now(), now()),
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'internal-test-client@example.invalid', now(), now());

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id = case role.name
  when 'owner' then '20000000-0000-0000-0000-000000000001'::uuid
  when 'admin' then '20000000-0000-0000-0000-000000000002'::uuid
  when 'manager' then '20000000-0000-0000-0000-000000000003'::uuid
  when 'staff' then '20000000-0000-0000-0000-000000000004'::uuid
end
  and role.name in ('owner', 'admin', 'manager', 'staff');

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    archived_at = now()
where id = '20000000-0000-0000-0000-000000000005';

-- This fixture is an explicitly capable project operator. Internal membership
-- alone remains insufficient, as proved by 013_backend_permission_boundary.
insert into public.profile_permission_overrides (
  profile_id,
  permission_key,
  allowed
)
values
  ('20000000-0000-0000-0000-000000000003', 'clients.create', true),
  ('20000000-0000-0000-0000-000000000004', 'clients.view', true),
  ('20000000-0000-0000-0000-000000000004', 'clients.create', true),
  ('20000000-0000-0000-0000-000000000004', 'services.create', true),
  ('20000000-0000-0000-0000-000000000004', 'services.edit', true),
  ('20000000-0000-0000-0000-000000000004', 'projects.create', true),
  ('20000000-0000-0000-0000-000000000004', 'projects.edit', true),
  ('20000000-0000-0000-0000-000000000004', 'projects.assign', true);

insert into public.companies (id, name)
values ('30000000-0000-0000-0000-000000000010', 'Internal Test Company');

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000010'
where id = '10000000-0000-0000-0000-000000000001';

insert into public.services (id, name, is_active)
values ('40000000-0000-0000-0000-000000000010', 'Internal Inactive Service', false);

create temporary table internal_rpc_ids (
  contact_id uuid,
  service_id uuid,
  order_id uuid,
  task_id uuid
) on commit drop;
insert into internal_rpc_ids default values;
grant select, update on internal_rpc_ids to authenticated;

insert into public.client_contacts (
  id,
  company_id,
  name
)
values (
  '45000000-0000-0000-0000-000000000010',
  '30000000-0000-0000-0000-000000000010',
  'Private Contact Fixture'
);

update internal_rpc_ids
set contact_id = '45000000-0000-0000-0000-000000000010';

-- Each internal application role is tested under the real authenticated
-- PostgreSQL role and its own auth.uid(), rather than inferred from policy names.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000001';

select ok(private.is_internal_user(), 'owner is recognized as internal');
select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000010'),
  1::bigint,
  'owner can read inactive services'
);
select lives_ok(
  $$select public.app_create_company('84000000-0000-0000-0000-000000000001', 'Owner-created Test Client')$$,
  'owner can create an operational company'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000002';

select ok(private.is_internal_user(), 'admin is recognized as internal');
select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000010'),
  1::bigint,
  'admin can read inactive services'
);
select lives_ok(
  $$select public.app_create_company('84000000-0000-0000-0000-000000000002', 'Admin-created Test Client')$$,
  'admin can create an operational company'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000003';

select ok(private.is_internal_user(), 'manager is recognized as internal');
select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000010'),
  1::bigint,
  'manager can read inactive services'
);
select lives_ok(
  $$select public.app_create_company('84000000-0000-0000-0000-000000000003', 'Manager-created Test Client')$$,
  'manager can create an operational company'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000004';

select ok(private.is_internal_user(), 'staff is recognized as internal');
select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000010'),
  1::bigint,
  'staff can read inactive services'
);
select lives_ok(
  $$select public.app_create_company('84000000-0000-0000-0000-000000000004', 'Staff-created Test Client')$$,
  'staff can create an operational company'
);

select is(
  (
    select count(*) from public.profiles
    where id in (
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000005',
      '10000000-0000-0000-0000-000000000001'
    )
  ),
  6::bigint,
  'staff can read all test profiles'
);
select is((select count(*) from public.roles), 5::bigint, 'staff can read all system roles');

select throws_ok(
  $$
    select public.app_create_contact(
      '84000000-0000-0000-0000-000000000005',
      '30000000-0000-0000-0000-000000000010',
      'Staff-created Contact'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'staff cannot create a client-private contact without capability'
);

select throws_ok(
  $$
    select public.app_update_contact(
      (select contact_id from internal_rpc_ids),
      '{"phone":"+1-555-0100"}'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'staff cannot update a client-private contact without capability'
);

select lives_ok(
  $$
    update internal_rpc_ids set service_id = (public.app_create_service(
      '84000000-0000-0000-0000-000000000006',
      '{"name":"Staff-created Service"}'::jsonb
    )).id
  $$,
  'staff can create a service'
);

select isnt_empty(
  $$
    select public.app_update_service(
      (select service_id from internal_rpc_ids),
      '{"description":"Updated by staff test"}'
    )
  $$,
  'staff can update a service'
);

select lives_ok(
  $$
    update internal_rpc_ids set order_id = (public.app_create_order(
      '84000000-0000-0000-0000-000000000007',
      '30000000-0000-0000-0000-000000000010',
      (select service_id from internal_rpc_ids),
      'Staff-created Project',
      '20000000-0000-0000-0000-000000000004'
    )).id
  $$,
  'staff can create and assign an order'
);

select isnt_empty(
  $$
    select public.app_change_order_status((select order_id from internal_rpc_ids), 'working')
  $$,
  'staff can update an order'
);

select lives_ok(
  $$
    update internal_rpc_ids set task_id = (public.app_create_task(
      '84000000-0000-0000-0000-000000000008',
      (select order_id from internal_rpc_ids),
      'Staff-created Task',
      '20000000-0000-0000-0000-000000000004'
    )).id
  $$,
  'staff can create and assign an order task'
);

select isnt_empty(
  $$
    select public.app_change_task_status((select task_id from internal_rpc_ids), 'in_progress')
  $$,
  'staff can update an order task'
);

-- M-02: the browser has no INSERT privilege on the audit stream at all. An
-- authenticated staff session can no longer author an activity event, forge an
-- actor, or backdate one -- the attempt fails before any policy is consulted.
select throws_ok(
  $$
    insert into public.activity_events (
      id, actor_profile_id, entity_type, entity_id, action, summary, created_at
    )
    values (
      '70000000-0000-0000-0000-000000000010',
      '20000000-0000-0000-0000-000000000001',
      'order',
      (select order_id from internal_rpc_ids),
      'updated',
      'Staff updated the order',
      '2000-01-01 00:00:00+00'::timestamptz
    )
  $$,
  '42501',
  'permission denied for table activity_events',
  'staff cannot append an activity event directly'
);

-- The legitimate path still works: the task RPC above wrote its own audit row
-- through private.record_authenticated_activity.
select is(
  (
    select activity_row.actor_profile_id
    from public.activity_events as activity_row
    where activity_row.entity_type = 'order_task'
      and activity_row.entity_id = (select task_id from internal_rpc_ids)
      and activity_row.action = 'task.status_changed'
  ),
  '20000000-0000-0000-0000-000000000004'::uuid,
  'the trusted task RPC attributes its audit row to the real actor'
);

select ok(
  (
    select activity_row.created_at > '2020-01-01 00:00:00+00'::timestamptz
    from public.activity_events as activity_row
    where activity_row.entity_type = 'order_task'
      and activity_row.entity_id = (select task_id from internal_rpc_ids)
      and activity_row.action = 'task.status_changed'
  ),
  'the trusted task RPC timestamps its audit row server-side'
);

select ok(
  (
    select count(*) >= 2
    from public.activity_events
    where entity_type = 'order_task'
      and entity_id = (select task_id from internal_rpc_ids)
  ),
  'staff can read operational activity events'
);

select throws_ok(
  $$
    update public.profiles
    set role_id = (select id from public.roles where name = 'owner')
    where id = '20000000-0000-0000-0000-000000000004'
  $$,
  '42501',
  'permission denied for table profiles',
  'authenticated staff cannot promote profiles'
);

select throws_ok(
  $$delete from public.companies where id = '30000000-0000-0000-0000-000000000010'$$,
  '42501',
  'permission denied for table companies',
  'internal users cannot hard-delete companies'
);

select throws_ok(
  $$delete from public.client_contacts where id = (select contact_id from internal_rpc_ids)$$,
  '42501',
  'permission denied for table client_contacts',
  'internal users cannot hard-delete client contacts'
);

select throws_ok(
  $$delete from public.services where id = (select service_id from internal_rpc_ids)$$,
  '42501',
  'permission denied for table services',
  'internal users cannot hard-delete services'
);

select throws_ok(
  $$delete from public.orders where id = (select order_id from internal_rpc_ids)$$,
  '42501',
  'permission denied for table orders',
  'internal users cannot hard-delete orders'
);

select throws_ok(
  $$delete from public.order_tasks where id = (select task_id from internal_rpc_ids)$$,
  '42501',
  'permission denied for table order_tasks',
  'internal users cannot hard-delete order tasks'
);

select throws_ok(
  $$
    update public.activity_events
    set summary = 'Mutated audit history'
    where id = '70000000-0000-0000-0000-000000000010'
  $$,
  '42501',
  'permission denied for table activity_events',
  'existing activity events cannot be updated'
);

select throws_ok(
  $$delete from public.activity_events where id = '70000000-0000-0000-0000-000000000010'$$,
  '42501',
  'permission denied for table activity_events',
  'existing activity events cannot be hard-deleted'
);

select throws_ok(
  $$
    select public.app_create_order(
      '84000000-0000-0000-0000-000000000009',
      '30000000-0000-0000-0000-000000000010',
      (select service_id from internal_rpc_ids),
      'Client-assigned Internal Project',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign an order to a client profile'
);

select throws_ok(
  $$
    select public.app_create_order(
      '84000000-0000-0000-0000-000000000010',
      '30000000-0000-0000-0000-000000000010',
      (select service_id from internal_rpc_ids),
      'Archived-assignee Internal Project',
      '20000000-0000-0000-0000-000000000005'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign an order to an archived internal profile'
);

select throws_ok(
  $$
    select public.app_create_task(
      '84000000-0000-0000-0000-000000000011',
      (select order_id from internal_rpc_ids),
      'Client-assigned Internal Task',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign a task to a client profile'
);

select throws_ok(
  $$
    select public.app_create_task(
      '84000000-0000-0000-0000-000000000012',
      (select order_id from internal_rpc_ids),
      'Archived-assignee Internal Task',
      '20000000-0000-0000-0000-000000000005'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign a task to an archived internal profile'
);

select * from finish();
rollback;
