begin;

select plan(20);

insert into public.companies (id, name)
values ('30000000-0000-0000-0000-000000000001', 'Archive Test Company');

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'archive-client@example.invalid',
    now(),
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'archive-staff@example.invalid',
    now(),
    now()
  );

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000001'
where id = '10000000-0000-0000-0000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff')
where id = '20000000-0000-0000-0000-000000000001';

insert into public.services (id, name)
values ('40000000-0000-0000-0000-000000000001', 'Archive Test Service');

insert into public.orders (id, company_id, service_id, title)
values (
  '50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'Archive Test Order'
);

insert into public.order_tasks (id, order_id, title)
values (
  '60000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'Archive Test Task'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';

select is((select count(*) from public.profiles), 1::bigint, 'active client can read its profile');
select is((select count(*) from public.companies), 1::bigint, 'active client can read its company');
select is((select count(*) from public.orders), 1::bigint, 'active client can read its order');
select is((select count(*) from public.order_tasks), 1::bigint, 'active client can read its task');
select is((select count(*) from public.services), 1::bigint, 'active client can read active services');

reset role;
update public.companies
set archived_at = now()
where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';

select is((select count(*) from public.companies), 0::bigint, 'an archived company is hidden from its client');
select is(
  (select count(*) from public.orders),
  0::bigint,
  'archiving a company hides its non-archived orders from its client'
);
select is(
  (select count(*) from public.order_tasks),
  0::bigint,
  'archiving a company hides tasks under its orders from its client'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.companies where id = '30000000-0000-0000-0000-000000000001'),
  1::bigint,
  'internal staff can read the fixture archived company'
);
select is(
  (select count(*) from public.orders where id = '50000000-0000-0000-0000-000000000001'),
  1::bigint,
  'internal staff can read the fixture order for an archived company'
);
select is(
  (select count(*) from public.order_tasks where id = '60000000-0000-0000-0000-000000000001'),
  1::bigint,
  'internal staff can read the fixture task for an archived company'
);

reset role;
update public.companies
set archived_at = null
where id = '30000000-0000-0000-0000-000000000001';
update public.orders
set archived_at = now()
where id = '50000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';

select is((select count(*) from public.orders), 0::bigint, 'an archived order is hidden from its client');
select is(
  (select count(*) from public.order_tasks),
  0::bigint,
  'tasks are hidden when their parent order is archived'
);

reset role;
update public.orders
set archived_at = null
where id = '50000000-0000-0000-0000-000000000001';
update public.order_tasks
set archived_at = now()
where id = '60000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';

select is((select count(*) from public.orders), 1::bigint, 'an active order remains visible');
select is((select count(*) from public.order_tasks), 0::bigint, 'an archived task is hidden from its client');

reset role;
update public.order_tasks
set archived_at = null
where id = '60000000-0000-0000-0000-000000000001';
update public.profiles
set archived_at = now()
where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';

select is((select count(*) from public.profiles), 0::bigint, 'an archived client cannot read its profile');
select is((select count(*) from public.companies), 0::bigint, 'an archived client cannot read its company');
select is((select count(*) from public.orders), 0::bigint, 'an archived client cannot read company orders');
select is((select count(*) from public.order_tasks), 0::bigint, 'an archived client cannot read company tasks');
select is(
  (select count(*) from public.services),
  1::bigint,
  'an archived profile can still read active services because the policy applies to authenticated users'
);

select * from finish();
rollback;
