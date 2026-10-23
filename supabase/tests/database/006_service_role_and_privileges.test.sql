begin;

select plan(79);

-- Catalog-driven guardrail for current and future Wolf Forge public tables.
-- Extension-owned relations and views are excluded; ordinary and partitioned
-- application tables are included automatically.
create temporary table test_public_application_tables on commit drop as
select
  table_relation.oid as relation_oid,
  format('%I.%I', table_namespace.nspname, table_relation.relname) as qualified_name,
  table_relation.relrowsecurity as rls_enabled
from pg_catalog.pg_class as table_relation
join pg_catalog.pg_namespace as table_namespace
  on table_namespace.oid = table_relation.relnamespace
where table_namespace.nspname = 'public'
  and table_relation.relkind in ('r', 'p')
  and not exists (
    select 1
    from pg_catalog.pg_depend as dependency
    where dependency.classid = 'pg_catalog.pg_class'::regclass
      and dependency.objid = table_relation.oid
      and dependency.refclassid = 'pg_catalog.pg_extension'::regclass
      and dependency.deptype = 'e'
  );

-- Effective ACL checks run as the test owner but ask PostgreSQL about the
-- named API roles. This catches inherited/default privileges as well as direct
-- GRANTs and complements the executable SET ROLE checks below.
select ok(
  (
    select bool_and(has_table_privilege('service_role', table_name, 'SELECT'))
    from unnest(array[
      'public.roles',
      'public.profiles',
      'public.companies',
      'public.client_contacts',
      'public.services',
      'public.orders',
      'public.order_tasks',
      'public.activity_events'
    ]) as required_tables(table_name)
  ),
  'service_role can select every Phase 1 application table'
);

select ok(
  not has_table_privilege('service_role', 'public.roles', 'INSERT')
  and not has_table_privilege('service_role', 'public.roles', 'UPDATE')
  and not has_table_privilege('service_role', 'public.roles', 'DELETE')
  and not has_table_privilege('service_role', 'public.roles', 'TRUNCATE'),
  'service_role has SELECT-only access to roles'
);

select ok(
  has_table_privilege('service_role', 'public.profiles', 'SELECT')
  and has_table_privilege('service_role', 'public.profiles', 'UPDATE')
  and not has_table_privilege('service_role', 'public.profiles', 'INSERT')
  and not has_table_privilege('service_role', 'public.profiles', 'DELETE')
  and not has_table_privilege('service_role', 'public.profiles', 'TRUNCATE'),
  'service_role has only SELECT and UPDATE on profiles'
);

select ok(
  (
    select bool_and(
      has_table_privilege('service_role', table_name, 'SELECT')
      and has_table_privilege('service_role', table_name, 'INSERT')
      and has_table_privilege('service_role', table_name, 'UPDATE')
    )
    from unnest(array[
      'public.companies',
      'public.client_contacts',
      'public.services',
      'public.orders',
      'public.order_tasks'
    ]) as operational_tables(table_name)
  ),
  'service_role has intended operational SELECT, INSERT, and UPDATE privileges'
);

select ok(
  (
    select bool_and(
      not has_table_privilege('service_role', table_name, 'DELETE')
      and not has_table_privilege('service_role', table_name, 'TRUNCATE')
    )
    from unnest(array[
      'public.companies',
      'public.client_contacts',
      'public.services',
      'public.orders',
      'public.order_tasks'
    ]) as operational_tables(table_name)
  ),
  'service_role has no DELETE or TRUNCATE on operational tables'
);

select ok(
  has_table_privilege('service_role', 'public.activity_events', 'SELECT')
  and has_table_privilege('service_role', 'public.activity_events', 'INSERT')
  and not has_table_privilege('service_role', 'public.activity_events', 'UPDATE')
  and not has_table_privilege('service_role', 'public.activity_events', 'DELETE')
  and not has_table_privilege('service_role', 'public.activity_events', 'TRUNCATE'),
  'service_role has append-only SELECT and INSERT access to activity events'
);

select ok(
  (
    select bool_and(
      not has_table_privilege('anon', table_name, privilege_name)
    )
    from unnest(array[
      'public.roles',
      'public.profiles',
      'public.companies',
      'public.client_contacts',
      'public.services',
      'public.orders',
      'public.order_tasks',
      'public.activity_events'
    ]) as application_tables(table_name)
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
    ]) as privileges(privilege_name)
  ),
  'anon has no application-table DML or TRUNCATE privileges'
);

select ok(
  (
    select bool_and(
      has_table_privilege('authenticated', table_name, 'SELECT')
      and not has_table_privilege('authenticated', table_name, 'INSERT')
      and not has_table_privilege('authenticated', table_name, 'UPDATE')
      and not has_table_privilege('authenticated', table_name, 'DELETE')
      and not has_table_privilege('authenticated', table_name, 'TRUNCATE')
    )
    from unnest(array[
      'public.companies',
      'public.client_contacts',
      'public.services',
      'public.orders',
      'public.order_tasks'
    ]) as operational_tables(table_name)
  ),
  'authenticated operational tables are SELECT-only outside audited RPCs'
);

select ok(
  not exists (
    select 1
    from test_public_application_tables as application_table
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
    ]) as privilege_list(privilege_name)
    where has_table_privilege(
      'anon',
      application_table.relation_oid,
      privilege_list.privilege_name
    )
  ),
  'catalog scan: anon has no privileges on any public application table'
);

select ok(
  not exists (
    select 1
    from test_public_application_tables as application_table
    where has_table_privilege(
      'authenticated',
      application_table.relation_oid,
      'TRUNCATE'
    )
  ),
  'catalog scan: authenticated cannot truncate any public application table'
);

select ok(
  not exists (
    select 1
    from test_public_application_tables as application_table
    where has_table_privilege(
      'service_role',
      application_table.relation_oid,
      'TRUNCATE'
    )
  ),
  'catalog scan: service_role cannot truncate any public application table'
);

select ok(
  not exists (
    select 1
    from test_public_application_tables as application_table
    where not application_table.rls_enabled
  ),
  'catalog scan: RLS is enabled on every public application table'
);

select ok(
  not has_sequence_privilege('service_role', 'public.orders_order_number_seq', 'USAGE'),
  'service_role has no direct sequence USAGE privilege'
);
select ok(
  not has_sequence_privilege('service_role', 'public.orders_order_number_seq', 'SELECT'),
  'service_role has no sequence SELECT privilege'
);
select ok(
  not has_sequence_privilege('service_role', 'public.orders_order_number_seq', 'UPDATE'),
  'service_role has no sequence UPDATE or setval privilege'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.orders_order_number_seq', 'USAGE'),
  'authenticated has no direct sequence USAGE privilege'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.orders_order_number_seq', 'SELECT'),
  'authenticated has no sequence SELECT privilege'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.orders_order_number_seq', 'UPDATE'),
  'authenticated has no sequence UPDATE or setval privilege'
);
select ok(
  not has_sequence_privilege('anon', 'public.orders_order_number_seq', 'USAGE'),
  'anon has no sequence USAGE privilege'
);
select ok(
  not has_sequence_privilege('anon', 'public.orders_order_number_seq', 'SELECT'),
  'anon has no sequence SELECT privilege'
);
select ok(
  not has_sequence_privilege('anon', 'public.orders_order_number_seq', 'UPDATE'),
  'anon has no sequence UPDATE privilege'
);

select has_index(
  'public',
  'activity_events',
  'activity_events_created_at_idx',
  'activity events have a global created-at timeline index'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.activity_events'::regclass
      and conname = 'activity_events_entity_type_valid'
      and contype = 'c'
  ),
  'activity events constrain current Phase 1 entity types'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_completion_consistent'
      and contype = 'c'
  ),
  'orders enforce completion timestamp consistency'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.order_tasks'::regclass
      and conname = 'order_tasks_completion_consistent'
      and contype = 'c'
  ),
  'order tasks enforce completion timestamp consistency'
);

-- Synthetic Auth users are created by the trusted test owner so the real Auth
-- trigger creates their profiles. service_role then performs the approved
-- backend administration and operational writes through its actual ACLs.
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'acl-owner@example.invalid', now(), now()),
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'acl-client@example.invalid', now(), now());

set local role service_role;

select is((select count(*) from public.roles), 5::bigint, 'service_role can execute a roles SELECT');

select lives_ok(
  $$
    insert into public.companies (id, tenant_id, name)
    values
      ('30000000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'ACL Test Company'),
      ('30000000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-000000000001', 'ACL Other Company')
  $$,
  'service_role can insert companies with an explicit Tenant'
);

select lives_ok(
  $$
    update public.profiles
    set role_id = (select id from public.roles where name = 'owner')
    where id = '20000000-0000-0000-0000-000000000001'
  $$,
  'service_role can perform trusted role administration'
);

select lives_ok(
  $$
    update public.profiles
    set company_id = '30000000-0000-0000-0000-000000000001'
    where id = '10000000-0000-0000-0000-000000000001'
  $$,
  'service_role can assign a client profile to a company'
);

select is(
  (
    select role.name
    from public.profiles as profile
    join public.roles as role on role.id = profile.role_id
    where profile.id = '20000000-0000-0000-0000-000000000001'
  ),
  'owner'::text,
  'service_role can read the administered profile and role'
);

select lives_ok(
  $$
    insert into public.client_contacts (id, tenant_id, company_id, profile_id, name)
    values (
      '35000000-0000-0000-0000-000000000001',
      'f0f0f0f0-0000-4000-8000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'ACL Client Contact'
    )
  $$,
  'service_role can insert a consistent client contact'
);

select lives_ok(
  $$
    update public.client_contacts
    set phone = '+1-555-0101'
    where id = '35000000-0000-0000-0000-000000000001'
  $$,
  'service_role can update client contacts'
);

select lives_ok(
  $$
    insert into public.services (id, tenant_id, name)
    values ('40000000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'ACL Test Service')
  $$,
  'service_role can insert services'
);

select lives_ok(
  $$
    update public.services
    set description = 'Updated through service_role'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  'service_role can update services'
);

select isnt_empty(
  $$
    insert into public.orders (id, tenant_id, company_id, service_id, title)
    values (
      '50000000-0000-0000-0000-000000000001',
      'f0f0f0f0-0000-4000-8000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'service_role Identity Order'
    )
    returning order_number
  $$,
  'service_role can insert an order and generate its identity number'
);

select ok(
  (
    select order_number > 0
    from public.orders
    where id = '50000000-0000-0000-0000-000000000001'
  ),
  'the service_role order received a positive identity number'
);

select lives_ok(
  $$
    update public.orders
    set status = 'working', started_at = now()
    where id = '50000000-0000-0000-0000-000000000001'
  $$,
  'service_role can update orders'
);

select lives_ok(
  $$
    insert into public.order_tasks (id, order_id, title)
    values (
      '60000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'service_role Task'
    )
  $$,
  'service_role can insert order tasks'
);

select lives_ok(
  $$
    update public.order_tasks
    set status = 'in_progress'
    where id = '60000000-0000-0000-0000-000000000001'
  $$,
  'service_role can update order tasks'
);

select lives_ok(
  $$
    insert into public.activity_events (
      id, actor_profile_id, entity_type, entity_id, action, summary, created_at
    )
    values (
      '70000000-0000-0000-0000-000000000001',
      null,
      'service',
      '40000000-0000-0000-0000-000000000001',
      'system_import',
      'Trusted backend event',
      '2001-01-01 00:00:00+00'::timestamptz
    )
  $$,
  'service_role can append a deliberate backend activity event'
);

select is(
  (
    select actor_profile_id
    from public.activity_events
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  null::uuid,
  'service_role may deliberately insert a system event with no actor'
);

select is(
  (
    select created_at
    from public.activity_events
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  '2001-01-01 00:00:00+00'::timestamptz,
  'service_role may deliberately supply a backend event timestamp'
);

select throws_ok(
  $$
    update public.activity_events
    set summary = 'Forbidden service_role mutation'
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table activity_events',
  'service_role cannot update activity events'
);

select throws_ok(
  $$delete from public.orders where id = '50000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table orders',
  'service_role cannot delete operational records'
);

select throws_ok(
  $$truncate table public.orders$$,
  '42501',
  'permission denied for table orders',
  'service_role cannot truncate operational tables'
);

select throws_ok(
  $$
    insert into public.profiles (id, role_id)
    values (
      '19999999-0000-0000-0000-000000000099',
      (select id from public.roles where name = 'client')
    )
  $$,
  '42501',
  'permission denied for table profiles',
  'service_role cannot bypass Auth-controlled profile insertion'
);

select throws_ok(
  $$select setval('public.orders_order_number_seq', 99999, true)$$,
  '42501',
  'permission denied for sequence orders_order_number_seq',
  'service_role cannot call setval on the order sequence'
);

select throws_ok(
  $$delete from public.activity_events where id = '70000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table activity_events',
  'service_role cannot delete activity events'
);

-- M-02 fixture. The audit row the append-only, privilege and cascade
-- assertions below depend on is now created by a trusted writer, because no
-- browser role holds INSERT on the audit stream any more.
reset role;

insert into public.activity_events (
  id, actor_profile_id, entity_type, entity_id, action, summary, created_at
)
values (
  '70000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'order',
  '50000000-0000-0000-0000-000000000001',
  'order.updated',
  'Trusted audit row for privilege assertions',
  now()
);

-- Authenticated internal writes must use audited RPCs. Direct operational DML
-- is denied even when RLS would otherwise recognize the caller as internal.
reset role;
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000001';

select ok(private.is_internal_user(), 'the administered owner is recognized as internal');

select throws_ok(
  $$
    insert into public.orders (id, company_id, service_id, title)
    values (
      '50000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'Authenticated Identity Order'
    )
  $$,
  '42501',
  'permission denied for table orders',
  'an authenticated internal user cannot directly insert an order'
);

select throws_ok(
  $$update public.orders set title = 'Mass bypass'$$,
  '42501',
  'permission denied for table orders',
  'an authenticated internal user cannot mass-update projects without activity'
);

select throws_ok(
  $$select setval('public.orders_order_number_seq', 88888, true)$$,
  '42501',
  'permission denied for sequence orders_order_number_seq',
  'authenticated users cannot call setval on the order sequence'
);

select throws_ok(
  $$truncate table public.orders$$,
  '42501',
  'permission denied for table orders',
  'authenticated internal users cannot truncate operational tables'
);

-- M-02: the audit stream is not browser-writable at all, so an authenticated
-- internal session can no longer author an event, forge an actor or backdate
-- one. The normalization trigger's authenticated branch is now unreachable
-- from a session, and actor/timestamp derivation lives in the trusted RPCs.
select throws_ok(
  $$
    insert into public.activity_events (
      id, actor_profile_id, entity_type, entity_id, action, summary, created_at
    )
    values (
      '70000000-0000-0000-0000-000000000012',
      '10000000-0000-0000-0000-000000000001',
      'order',
      '50000000-0000-0000-0000-000000000002',
      'forgery_attempt',
      'Authenticated event forgery test',
      '1999-01-01 00:00:00+00'::timestamptz
    )
  $$,
  '42501',
  'permission denied for table activity_events',
  'authenticated internal staff cannot append an activity event'
);

select ok(
  has_table_privilege('authenticated', 'public.activity_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.activity_events', 'INSERT')
    and not has_table_privilege('authenticated', 'public.activity_events', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.activity_events', 'DELETE'),
  'the browser role keeps scoped read access to the audit stream and nothing else'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_events'
      and cmd = 'INSERT'
  ),
  0::bigint,
  'no INSERT policy remains on the audit stream'
);

select throws_ok(
  $$
    update public.activity_events
    set summary = 'Forbidden authenticated mutation'
    where id = '70000000-0000-0000-0000-000000000002'
  $$,
  '42501',
  'permission denied for table activity_events',
  'authenticated internal users cannot update activity events'
);

select throws_ok(
  $$delete from public.activity_events where id = '70000000-0000-0000-0000-000000000002'$$,
  '42501',
  'permission denied for table activity_events',
  'authenticated internal users cannot delete activity events'
);

-- Completion, entity-type, and reverse contact-link invariants are exercised
-- through the trusted service_role path to prove they are structural controls,
-- not merely RLS behavior.
reset role;
set local role service_role;

select throws_ok(
  $$
    insert into public.orders (tenant_id, company_id, service_id, title, status)
    values (
      'f0f0f0f0-0000-4000-8000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'Invalid Complete Order',
      'complete'
    )
  $$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_completion_consistent"',
  'a complete order without completed_at is rejected'
);

select throws_ok(
  $$
    insert into public.orders (tenant_id, company_id, service_id, title, status, completed_at)
    values (
      'f0f0f0f0-0000-4000-8000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'Invalid Pending Completed Order',
      'pending',
      now()
    )
  $$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_completion_consistent"',
  'a non-complete order with completed_at is rejected'
);

select lives_ok(
  $$
    insert into public.orders (id, tenant_id, company_id, service_id, title, status, completed_at)
    values (
      '50000000-0000-0000-0000-000000000003',
      'f0f0f0f0-0000-4000-8000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'Valid Complete Order',
      'complete',
      now()
    )
  $$,
  'a complete order with completed_at is accepted'
);

select throws_ok(
  $$
    update public.orders
    set status = 'working'
    where id = '50000000-0000-0000-0000-000000000003'
  $$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_completion_consistent"',
  'complete to working fails unless completed_at is cleared'
);

select throws_ok(
  $$
    update public.orders
    set status = 'canceled'
    where id = '50000000-0000-0000-0000-000000000003'
  $$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_completion_consistent"',
  'complete to canceled fails unless completed_at is cleared'
);

select lives_ok(
  $$
    update public.orders
    set status = 'working', completed_at = null
    where id = '50000000-0000-0000-0000-000000000003'
  $$,
  'complete to working succeeds when completed_at is cleared atomically'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, title, status)
    values (
      '50000000-0000-0000-0000-000000000001',
      'Invalid Complete Task',
      'complete'
    )
  $$,
  '23514',
  'new row for relation "order_tasks" violates check constraint "order_tasks_completion_consistent"',
  'a complete task without completed_at is rejected'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, title, status, completed_at)
    values (
      '50000000-0000-0000-0000-000000000001',
      'Invalid Todo Completed Task',
      'todo',
      now()
    )
  $$,
  '23514',
  'new row for relation "order_tasks" violates check constraint "order_tasks_completion_consistent"',
  'a non-complete task with completed_at is rejected'
);

select lives_ok(
  $$
    insert into public.order_tasks (order_id, title, status, completed_at)
    values (
      '50000000-0000-0000-0000-000000000003',
      'Valid Complete Task',
      'complete',
      now()
    )
  $$,
  'a complete task with completed_at is accepted'
);

select throws_ok(
  $$
    update public.order_tasks
    set status = 'in_progress'
    where order_id = '50000000-0000-0000-0000-000000000003'
      and title = 'Valid Complete Task'
  $$,
  '23514',
  'new row for relation "order_tasks" violates check constraint "order_tasks_completion_consistent"',
  'complete task to in_progress fails unless completed_at is cleared'
);

select throws_ok(
  $$
    update public.order_tasks
    set status = 'canceled'
    where order_id = '50000000-0000-0000-0000-000000000003'
      and title = 'Valid Complete Task'
  $$,
  '23514',
  'new row for relation "order_tasks" violates check constraint "order_tasks_completion_consistent"',
  'complete task to canceled fails unless completed_at is cleared'
);

select lives_ok(
  $$
    update public.order_tasks
    set status = 'in_progress', completed_at = null
    where order_id = '50000000-0000-0000-0000-000000000003'
      and title = 'Valid Complete Task'
  $$,
  'complete task to in_progress succeeds when completed_at is cleared atomically'
);

select throws_ok(
  $$
    insert into public.activity_events (entity_type, entity_id, action, summary)
    values (
      'external_accounting_export',
      '79999999-0000-0000-0000-000000000099',
      'invalid_type',
      'Later-phase entity test'
    )
  $$,
  '42501',
  'activity event Tenant cannot be derived',
  'unsupported activity entity types remain rejected (WL-2.8: no Tenant can be derived for them)'
);
select ok(
  exists (select 1 from pg_constraint
    where conrelid = 'public.activity_events'::regclass and conname = 'activity_events_entity_type_valid'
      and pg_get_constraintdef(oid) ~ '''order_task'''
      and pg_get_constraintdef(oid) !~ 'external_accounting_export'),
  'the activity entity type check constraint still exists behind the Tenant trigger'
);

select throws_ok(
  $$
    update public.profiles
    set company_id = '30000000-0000-0000-0000-000000000002'
    where id = '10000000-0000-0000-0000-000000000001'
  $$,
  '23503',
  'update or delete on table "tenant_memberships" violates foreign key constraint "client_contacts_profile_membership_fkey" on table "client_contacts"',
  'profile administration cannot move a linked contact profile to another company'
);

select throws_ok(
  $$
    update public.profiles
    set role_id = (select id from public.roles where name = 'staff')
    where id = '10000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'new row for relation "tenant_memberships" violates check constraint "tenant_memberships_internal_has_no_company"',
  'profile administration cannot promote a linked client contact to an internal role'
);

-- Even the migration owner cannot casually mutate append-only history without
-- explicitly changing or disabling the structural trigger.
reset role;

select throws_ok(
  $$
    update public.activity_events
    set summary = 'Owner mutation attempt'
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  '55000',
  'activity events are append-only',
  'the append-only trigger blocks owner-level activity updates'
);

select throws_ok(
  $$delete from public.activity_events where id = '70000000-0000-0000-0000-000000000001'$$,
  '55000',
  'activity events are append-only',
  'the append-only trigger blocks owner-level activity deletes'
);

select throws_ok(
  $$truncate table public.activity_events$$,
  '55000',
  'activity events are append-only',
  'the append-only statement trigger blocks owner-level activity truncation'
);

select lives_ok(
  $$delete from auth.users where id = '20000000-0000-0000-0000-000000000001'$$,
  'deleting an Auth user can cascade-delete its profile without deleting activity history'
);

select is(
  (
    select actor_profile_id
    from public.activity_events
    where id = '70000000-0000-0000-0000-000000000002'
  ),
  null::uuid,
  'the actor foreign key nulls the deleted profile reference while preserving the event'
);

select * from finish();
rollback;
