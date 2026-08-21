begin;

select plan(42);

-- Trusted test setup runs before SET ROLE so it can create both tenants and
-- their operational records without bypassing RLS during the assertions.
insert into public.companies (id, name)
values
  ('30000000-0000-0000-0000-000000000001', 'RLS Company A'),
  ('30000000-0000-0000-0000-000000000002', 'RLS Company B');

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'rls-client-a@example.invalid',
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'rls-client-b@example.invalid',
    now(),
    now()
  );

update public.profiles
set company_id = case id
  when '10000000-0000-0000-0000-000000000001'::uuid
    then '30000000-0000-0000-0000-000000000001'::uuid
  when '10000000-0000-0000-0000-000000000002'::uuid
    then '30000000-0000-0000-0000-000000000002'::uuid
end
where id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002'
);

insert into public.services (id, name, is_active, archived_at)
values
  ('40000000-0000-0000-0000-000000000001', 'Active RLS Service', true, null),
  ('40000000-0000-0000-0000-000000000002', 'Inactive RLS Service', false, null),
  ('40000000-0000-0000-0000-000000000003', 'Archived RLS Service', true, now());

insert into public.orders (id, company_id, service_id, title)
values
  (
    '50000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'Company A Order'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    'Company B Order'
  );

insert into public.order_tasks (id, order_id, title)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    'Company A Task'
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000002',
    'Company B Task'
  );

insert into public.activity_events (
  id, actor_profile_id, entity_type, entity_id, action, summary
)
values (
  '70000000-0000-0000-0000-000000000001',
  null,
  'order',
  '50000000-0000-0000-0000-000000000001',
  'created',
  'Company A order created'
);

-- Supabase's auth.uid() reads request.jwt.claim.sub. SET LOCAL ROLE ensures
-- every assertion below executes with the same grants and RLS behavior as an
-- authenticated Data API request, not as postgres or service_role.
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select ok(private.is_client_user(), 'Client A is recognized as an active client');
select isnt(private.is_internal_user(), true, 'Client A is not recognized as internal');

select is(
  (select count(*) from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Client A can read its own profile'
);

select is(
  (select count(*) from public.profiles where id = '10000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client A cannot read Client B profile'
);

select is((select count(*) from public.roles), 0::bigint, 'Client A cannot enumerate roles');

select is(
  (select count(*) from public.companies where id = '30000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Client A can read Company A'
);

select is(
  (select count(*) from public.companies where id = '30000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client A cannot read Company B'
);

select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Client A can read an active service'
);

select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client A cannot read an inactive service'
);

select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000003'),
  0::bigint,
  'Client A cannot read an archived service'
);

select is(
  (select count(*) from public.orders where id = '50000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Client A cannot bypass the safe Project RPC through the orders table'
);

select is(
  (select count(*) from public.orders where id = '50000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client A cannot read Company B order'
);

select is(
  (select count(*) from public.order_tasks where id = '60000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Client A cannot bypass the safe Project RPC through the order_tasks table'
);

select is(
  (select count(*) from public.order_tasks where id = '60000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client A cannot read a task through Company B order'
);

select is(
  (select count(*) from public.activity_events),
  0::bigint,
  'Client A cannot read operational activity events'
);

select throws_ok(
  $$
    update public.profiles
    set role_id = (select id from public.roles where name = 'owner')
    where id = '10000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table profiles',
  'Client A cannot promote its own profile'
);

select throws_ok(
  $$
    update public.profiles
    set company_id = '30000000-0000-0000-0000-000000000002'
    where id = '10000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table profiles',
  'Client A cannot change its company membership'
);

select throws_ok(
  $$
    insert into public.profiles (id, role_id)
    values (
      '19999999-0000-0000-0000-000000000099',
      '19999999-0000-0000-0000-000000000098'
    )
  $$,
  '42501',
  'permission denied for table profiles',
  'Client A cannot create a privileged profile'
);

select throws_ok(
  $$
    insert into public.orders (company_id, service_id, title)
    values (
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'Client-created Order'
    )
  $$,
  '42501',
  'permission denied for table orders',
  'Client A cannot create an order'
);

select throws_ok(
  $$
    update public.orders
    set title = 'Client-mutated Company A Order'
    where id = '50000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table orders',
  'Client A cannot update its own company order'
);

select throws_ok(
  $$
    update public.orders
    set title = 'Client-mutated Company B Order'
    where id = '50000000-0000-0000-0000-000000000002'
  $$,
  '42501',
  'permission denied for table orders',
  'Client A cannot update another company order'
);

select throws_ok(
  $$delete from public.orders where id = '50000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table orders',
  'Client A cannot hard-delete orders'
);

select throws_ok(
  $$
    insert into public.order_tasks (order_id, title)
    values ('50000000-0000-0000-0000-000000000001', 'Client-created Task')
  $$,
  '42501',
  'permission denied for table order_tasks',
  'Client A cannot create an order task'
);

select throws_ok(
  $$
    update public.order_tasks
    set title = 'Client-mutated Task'
    where id = '60000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table order_tasks',
  'Client A cannot update an order task'
);

select throws_ok(
  $$delete from public.order_tasks where id = '60000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table order_tasks',
  'Client A cannot hard-delete order tasks'
);

select throws_ok(
  $$insert into public.services (name) values ('Client-created Service')$$,
  '42501',
  'permission denied for table services',
  'Client A cannot create services'
);

select throws_ok(
  $$
    update public.services
    set name = 'Client-mutated Service'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table services',
  'Client A cannot update services'
);

select throws_ok(
  $$delete from public.services where id = '40000000-0000-0000-0000-000000000001'$$,
  '42501',
  'permission denied for table services',
  'Client A cannot hard-delete services'
);

select throws_ok(
  $$
    insert into public.activity_events (entity_type, entity_id, action, summary)
    values (
      'order',
      '50000000-0000-0000-0000-000000000001',
      'forged',
      'Client-forged audit event'
    )
  $$,
  '42501',
  'permission denied for table activity_events',
  'Client A cannot forge an operational activity event'
);

-- Repeat the tenant boundary from Client B's identity.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.companies where id = '30000000-0000-0000-0000-000000000002'),
  1::bigint,
  'Client B can read Company B'
);

select is(
  (select count(*) from public.companies where id = '30000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Client B cannot read Company A'
);

select is(
  (select count(*) from public.orders where id = '50000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client B cannot bypass the safe Project RPC through the orders table'
);

select is(
  (select count(*) from public.orders where id = '50000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Client B cannot read Company A order'
);

select is(
  (select count(*) from public.order_tasks where id = '60000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Client B cannot bypass the safe Project RPC through the order_tasks table'
);

select is(
  (select count(*) from public.order_tasks where id = '60000000-0000-0000-0000-000000000001'),
  0::bigint,
  'Client B cannot read Company A task'
);

-- anon has no application-table grants at all.
reset role;
set local role anon;
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = 'anon';

select throws_ok(
  $$select * from public.profiles limit 1$$,
  '42501',
  'permission denied for table profiles',
  'anonymous users cannot read profiles'
);

select throws_ok(
  $$select * from public.services limit 1$$,
  '42501',
  'permission denied for table services',
  'anonymous users cannot read active services'
);

-- An authenticated database role without a user identity receives no tenant
-- data. Active services remain visible because their policy intentionally
-- applies to every authenticated request.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = 'authenticated';

select is((select count(*) from public.profiles), 0::bigint, 'missing auth.uid() reveals no profiles');
select is((select count(*) from public.companies), 0::bigint, 'missing auth.uid() reveals no companies');
select is((select count(*) from public.orders), 0::bigint, 'missing auth.uid() reveals no orders');
select is((select count(*) from public.order_tasks), 0::bigint, 'missing auth.uid() reveals no order tasks');
select is(
  (select count(*) from public.services where id = '40000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authenticated request without auth.uid() can read active services by design'
);

select * from finish();
rollback;
