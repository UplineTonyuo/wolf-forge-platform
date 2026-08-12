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

insert into public.companies (id, name)
values ('30000000-0000-0000-0000-000000000010', 'Internal Test Company');

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000010'
where id = '10000000-0000-0000-0000-000000000001';

insert into public.services (id, name, is_active)
values ('40000000-0000-0000-0000-000000000010', 'Internal Inactive Service', false);

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
  $$insert into public.companies (name) values ('Owner-created Test Company')$$,
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
  $$insert into public.companies (name) values ('Admin-created Test Company')$$,
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
  $$insert into public.companies (name) values ('Manager-created Test Company')$$,
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
  $$insert into public.companies (name) values ('Staff-created Test Company')$$,
  'staff can create an operational company'
);

select is((select count(*) from public.profiles), 6::bigint, 'staff can read all test profiles');
select is((select count(*) from public.roles), 5::bigint, 'staff can read all system roles');

select lives_ok(
  $$
    insert into public.client_contacts (id, company_id, name)
    values (
      '35000000-0000-0000-0000-000000000010',
      '30000000-0000-0000-0000-000000000010',
      'Staff-created Contact'
    )
  $$,
  'staff can create a client contact'
);

select isnt_empty(
  $$
    update public.client_contacts
    set phone = '+1-555-0100'
    where id = '35000000-0000-0000-0000-000000000010'
    returning id
  $$,
  'staff can update a client contact'
);

select lives_ok(
  $$
    insert into public.services (id, name)
    values ('40000000-0000-0000-0000-000000000020', 'Staff-created Service')
  $$,
  'staff can create a service'
);

select isnt_empty(
  $$
    update public.services
    set description = 'Updated by staff test'
    where id = '40000000-0000-0000-0000-000000000020'
    returning id
  $$,
  'staff can update a service'
);

select lives_ok(
  $$
    insert into public.orders (
      id, company_id, service_id, assigned_to_profile_id, title
    )
    values (
      '50000000-0000-0000-0000-000000000010',
      '30000000-0000-0000-0000-000000000010',
      '40000000-0000-0000-0000-000000000020',
      '20000000-0000-0000-0000-000000000004',
      'Staff-created Order'
    )
  $$,
  'staff can create and assign an order'
);

select isnt_empty(
  $$
    update public.orders
    set status = 'working', started_at = now()
    where id = '50000000-0000-0000-0000-000000000010'
    returning id
  $$,
  'staff can update an order'
);

select lives_ok(
  $$
    insert into public.order_tasks (
      id, order_id, assigned_to_profile_id, title
    )
    values (
      '60000000-0000-0000-0000-000000000010',
      '50000000-0000-0000-0000-000000000010',
      '20000000-0000-0000-0000-000000000004',
      'Staff-created Task'
    )
  $$,
  'staff can create and assign an order task'
);

select isnt_empty(
  $$
    update public.order_tasks
    set status = 'in_progress'
    where id = '60000000-0000-0000-0000-000000000010'
    returning id
  $$,
  'staff can update an order task'
);

select lives_ok(
  $$
    insert into public.activity_events (
      id, actor_profile_id, entity_type, entity_id, action, summary, created_at
    )
    values (
      '70000000-0000-0000-0000-000000000010',
      '20000000-0000-0000-0000-000000000001',
      'order',
      '50000000-0000-0000-0000-000000000010',
      'updated',
      'Staff updated the order',
      '2000-01-01 00:00:00+00'::timestamptz
    )
  $$,
  'staff can append an activity event'
);

select is(
  (
    select actor_profile_id
    from public.activity_events
    where id = '70000000-0000-0000-0000-000000000010'
  ),
  '20000000-0000-0000-0000-000000000004'::uuid,
  'authenticated staff cannot forge another activity actor'
);

select is(
  (
    select created_at
    from public.activity_events
    where id = '70000000-0000-0000-0000-000000000010'
  ),
  now(),
  'authenticated staff cannot backdate an activity event'
);

select is(
  (select count(*) from public.activity_events where id = '70000000-0000-0000-0000-000000000010'),
  1::bigint,
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
  $$delete from public.client_contacts where id = '35000000-0000-0000-0000-000000000010'$$,
  '42501',
  'permission denied for table client_contacts',
  'internal users cannot hard-delete client contacts'
);

select throws_ok(
  $$delete from public.services where id = '40000000-0000-0000-0000-000000000020'$$,
  '42501',
  'permission denied for table services',
  'internal users cannot hard-delete services'
);

select throws_ok(
  $$delete from public.orders where id = '50000000-0000-0000-0000-000000000010'$$,
  '42501',
  'permission denied for table orders',
  'internal users cannot hard-delete orders'
);

select throws_ok(
  $$delete from public.order_tasks where id = '60000000-0000-0000-0000-000000000010'$$,
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
    insert into public.orders (company_id, service_id, assigned_to_profile_id, title)
    values (
      '30000000-0000-0000-0000-000000000010',
      '40000000-0000-0000-0000-000000000020',
      '10000000-0000-0000-0000-000000000001',
      'Client-assigned Internal Order'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign an order to a client profile'
);

select throws_ok(
  $$
    insert into public.orders (company_id, service_id, assigned_to_profile_id, title)
    values (
      '30000000-0000-0000-0000-000000000010',
      '40000000-0000-0000-0000-000000000020',
      '20000000-0000-0000-0000-000000000005',
      'Archived-assignee Internal Order'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign an order to an archived internal profile'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values (
      '50000000-0000-0000-0000-000000000010',
      '10000000-0000-0000-0000-000000000001',
      'Client-assigned Internal Task'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign a task to a client profile'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values (
      '50000000-0000-0000-0000-000000000010',
      '20000000-0000-0000-0000-000000000005',
      'Archived-assignee Internal Task'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'internal users cannot assign a task to an archived internal profile'
);

select * from finish();
rollback;
