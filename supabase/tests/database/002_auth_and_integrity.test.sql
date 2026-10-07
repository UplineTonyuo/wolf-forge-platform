begin;

select plan(29);

-- These deterministic Auth rows are synthetic. Inserting them as the test
-- owner exercises the real auth.users trigger; subsequent RLS tests switch to
-- the authenticated PostgreSQL role explicitly.
insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'phase1-trigger@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"owner","company_id":"ffffffff-ffff-ffff-ffff-ffffffffffff"}'::jsonb,
    now(),
    now()
  );

select is(
  (
    select count(*)
    from public.profiles
    where id = '10000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'inserting an Auth user automatically creates exactly one profile'
);

select is(
  (
    select profile.id
    from public.profiles as profile
    where profile.id = '10000000-0000-0000-0000-000000000001'
  ),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the profile primary key is linked to auth.users.id'
);

select is(
  (
    select role.name
    from public.profiles as profile
    join public.roles as role on role.id = profile.role_id
    where profile.id = '10000000-0000-0000-0000-000000000001'
  ),
  'client'::text,
  'the Auth trigger always assigns the client role'
);

select is(
  (
    select count(*)
    from public.profiles as profile
    join public.roles as role on role.id = profile.role_id
    where profile.id = '10000000-0000-0000-0000-000000000001'
      and role.name in ('owner', 'admin', 'manager', 'staff')
  ),
  0::bigint,
  'raw user metadata cannot make an automatically-created profile internal'
);

select is(
  (select count(*) from public.roles),
  5::bigint,
  'exactly five system roles are seeded'
);

select is(
  (select array_agg(name order by name)::text from public.roles),
  '{admin,client,manager,owner,staff}'::text,
  'the seeded system roles are owner, admin, manager, staff, and client'
);

select throws_ok(
  $$insert into public.roles (name) values ('client')$$,
  '23505',
  'duplicate key value violates unique constraint "roles_name_key"',
  'duplicate role names are rejected'
);

insert into public.companies (id, name)
values
  ('30000000-0000-0000-0000-000000000001', 'Test Company A'),
  ('30000000-0000-0000-0000-000000000002', 'Test Company B');

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000001'
where id = '10000000-0000-0000-0000-000000000001';

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '10000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'phase1-contact-b@example.invalid',
  now(),
  now()
);

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000002'
where id = '10000000-0000-0000-0000-000000000002';

select throws_ok(
  $$
    insert into public.client_contacts (company_id, name)
    values ('39999999-0000-0000-0000-000000000099', 'Missing Company Contact')
  $$,
  '23503',
  'insert or update on table "client_contacts" violates foreign key constraint "client_contacts_company_id_fkey"',
  'a contact must reference an existing company'
);

select lives_ok(
  $$
    insert into public.client_contacts (company_id, name)
    values ('30000000-0000-0000-0000-000000000001', 'Unlinked Contact')
  $$,
  'a contact may exist without an authenticated profile'
);

select lives_ok(
  $$
    insert into public.client_contacts (company_id, name, is_primary)
    values ('30000000-0000-0000-0000-000000000001', 'Primary Contact A', true)
  $$,
  'a company can designate one active primary contact'
);

select throws_ok(
  $$
    insert into public.client_contacts (company_id, name, is_primary)
    values ('30000000-0000-0000-0000-000000000001', 'Second Primary A', true)
  $$,
  '23505',
  'duplicate key value violates unique constraint "client_contacts_one_active_primary_per_company_key"',
  'a company cannot have two active primary contacts'
);

select throws_ok(
  $$
    insert into public.client_contacts (id, company_id, profile_id, name)
    values (
      '35000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'Cross-company Linked Contact'
    )
  $$,
  '23503',
  'insert or update on table "client_contacts" violates foreign key constraint "client_contacts_profile_membership_fkey"',
  'a contact cannot link a client profile from another company'
);

select lives_ok(
  $$
    insert into public.client_contacts (id, company_id, profile_id, name)
    values (
      '35000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      'Same-company Linked Contact'
    )
  $$,
  'a contact can link a client profile from the same company'
);

select throws_ok(
  $$
    insert into public.client_contacts (company_id, profile_id, name)
    values (
      '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      'Duplicate Active Profile Link'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "client_contacts_active_profile_id_key"',
  'one profile cannot link to two active contacts'
);

update public.client_contacts
set archived_at = now()
where id = '35000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    insert into public.client_contacts (company_id, profile_id, name)
    values (
      '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      'Replacement Active Profile Link'
    )
  $$,
  'archiving a contact permits a replacement active profile link'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'phase1-staff@example.invalid',
    now(),
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'phase1-archived-staff@example.invalid',
    now(),
    now()
  );

update public.profiles
set role_id = (select id from public.roles where name = 'staff')
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);

update public.profiles
set archived_at = now()
where id = '20000000-0000-0000-0000-000000000002';

select throws_ok(
  $$
    insert into public.client_contacts (company_id, profile_id, name)
    values (
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'Internal Profile Contact'
    )
  $$,
  '23503',
  'insert or update on table "client_contacts" violates foreign key constraint "client_contacts_profile_membership_fkey"',
  'an internal staff profile cannot be linked as a client contact profile'
);

insert into public.services (id, name)
values ('40000000-0000-0000-0000-000000000001', 'Integrity Test Service');

select lives_ok(
  $$
    insert into public.orders (
      id, company_id, service_id, assigned_to_profile_id, title
    )
    values (
      '50000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'Internally Assigned Order'
    )
  $$,
  'an active internal profile can be assigned an order'
);

select is(
  (
    select status || ':' || priority
    from public.orders
    where id = '50000000-0000-0000-0000-000000000001'
  ),
  'pending:normal'::text,
  'orders receive the pending status and normal priority defaults'
);

select throws_ok(
  $$
    update public.orders
    set status = 'not_a_status'
    where id = '50000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_status_valid"',
  'invalid order statuses are rejected'
);

select throws_ok(
  $$
    insert into public.orders (company_id, service_id, assigned_to_profile_id, title)
    values (
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'Client-assigned Order'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'a client profile cannot be assigned an order'
);

select throws_ok(
  $$
    insert into public.orders (company_id, service_id, assigned_to_profile_id, title)
    values (
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      'Archived Staff-assigned Order'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'an archived internal profile cannot be assigned an order'
);

select lives_ok(
  $$
    insert into public.order_tasks (
      id, order_id, assigned_to_profile_id, title
    )
    values (
      '60000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'Internally Assigned Task'
    )
  $$,
  'an active internal profile can be assigned an order task'
);

select is(
  (
    select status || ':' || sort_position::text
    from public.order_tasks
    where id = '60000000-0000-0000-0000-000000000001'
  ),
  'todo:0'::text,
  'order tasks receive the todo status and zero sort-position defaults'
);

select throws_ok(
  $$
    update public.order_tasks
    set status = 'not_a_status'
    where id = '60000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'new row for relation "order_tasks" violates check constraint "order_tasks_status_valid"',
  'invalid order task statuses are rejected'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values (
      '50000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'Client-assigned Task'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'a client profile cannot be assigned an order task'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values (
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      'Archived Staff-assigned Task'
    )
  $$,
  '23514',
  'assignee must be an active internal profile',
  'an archived internal profile cannot be assigned an order task'
);

-- WL-2.8: an event needs a Tenant. A profile event has no Tenant-owned parent,
-- so a trusted write without a signed-in caller's Tenant is refused.
select throws_ok(
  $$
    insert into public.activity_events (
      actor_profile_id, entity_type, entity_id, action, summary, metadata
    )
    values (
      '20000000-0000-0000-0000-000000000001',
      'profile',
      '79999999-0000-0000-0000-000000000099',
      'observed',
      'Generic entity reference accepted',
      '{"source":"test"}'::jsonb
    )
  $$,
  '42501',
  'activity event Tenant cannot be derived',
  'a profile activity event without a current Tenant is refused'
);

select throws_ok(
  $$
    insert into public.activity_events (
      actor_profile_id, entity_type, entity_id, action, summary
    )
    values (
      '29999999-0000-0000-0000-000000000099',
      'order',
      '50000000-0000-0000-0000-000000000001',
      'created',
      'Invalid actor test'
    )
  $$,
  '23503',
  'insert or update on table "activity_events" violates foreign key constraint "activity_events_actor_profile_id_fkey"',
  'activity event actors must reference an existing profile'
);

select throws_ok(
  $$
    insert into public.activity_events (
      entity_type, entity_id, action, summary, metadata
    )
    values (
      'order',
      '50000000-0000-0000-0000-000000000001',
      'invalid_metadata',
      'Array metadata test',
      '[]'::jsonb
    )
  $$,
  '23514',
  'new row for relation "activity_events" violates check constraint "activity_events_metadata_is_object"',
  'activity event metadata must be a JSON object'
);

select * from finish();
rollback;
