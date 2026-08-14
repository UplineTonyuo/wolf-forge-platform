begin;

select plan(67);

create temporary table coupon_test_baseline as
select
  (select count(*) from public.coupons) as coupon_count,
  (
    select count(*)
    from public.activity_events
    where action = 'coupon.created'
      and actor_profile_id = '27000000-0000-0000-0000-000000000001'::uuid
  ) as actor_create_event_count;

-- -----------------------------------------------------------------------------
-- Structure and least privilege
-- -----------------------------------------------------------------------------

select ok(to_regclass('public.coupons') is not null, 'coupons table exists');
select ok(to_regclass('public.coupon_discount_rules') is not null, 'coupon discount rules table exists');
select ok(to_regclass('public.coupon_discount_services') is not null, 'coupon discount services table exists');
select ok(to_regclass('public.coupon_redemptions') is not null, 'coupon redemptions table exists');

select ok(to_regprocedure('public.app_create_coupon(uuid,jsonb)') is not null, 'coupon create RPC exists');
select ok(to_regprocedure('public.app_update_coupon(uuid,jsonb)') is not null, 'coupon update RPC exists');
select ok(to_regprocedure('public.app_archive_coupon(uuid)') is not null, 'coupon archive RPC exists');
select ok(to_regprocedure('public.app_validate_coupon(text,jsonb,numeric)') is not null, 'coupon validation RPC exists');

select ok(
  not has_function_privilege('anon', 'public.app_create_coupon(uuid,jsonb)', 'EXECUTE'),
  'anonymous callers cannot execute coupon creation'
);

select ok(
  has_function_privilege('authenticated', 'public.app_create_coupon(uuid,jsonb)', 'EXECUTE'),
  'authenticated callers can reach the capability-gated coupon creation RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.coupons', 'INSERT')
  and not has_table_privilege('authenticated', 'public.coupons', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.coupon_redemptions', 'INSERT'),
  'authenticated clients have no direct coupon or redemption mutation grants'
);

select ok(
  (
    select bool_and(
      procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']::text[]
    )
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.app_create_coupon(uuid,jsonb)'::regprocedure,
      'public.app_update_coupon(uuid,jsonb)'::regprocedure,
      'public.app_archive_coupon(uuid)'::regprocedure,
      'public.app_validate_coupon(text,jsonb,numeric)'::regprocedure
    )
  ),
  'coupon RPCs are SECURITY DEFINER functions with an empty search_path'
);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('27000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'coupon-admin@example.invalid', now(), now()),
  ('27000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'coupon-member@example.invalid', now(), now()),
  ('17000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'coupon-client@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '27000000-0000-0000-0000-000000000001' then 'Coupon Admin'
      when '27000000-0000-0000-0000-000000000002' then 'Coupon Member'
      else 'Coupon Client'
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'admin' then '27000000-0000-0000-0000-000000000001'::uuid
  when 'staff' then '27000000-0000-0000-0000-000000000002'::uuid
end
and role_row.name in ('admin', 'staff');

insert into public.companies (id, name, status)
values ('37000000-0000-0000-0000-000000000001', 'Coupon Client Company', 'client');

update public.profiles
set company_id = '37000000-0000-0000-0000-000000000001',
    display_name = 'Coupon Client'
where id = '17000000-0000-0000-0000-000000000001';

create temporary table coupon_test_services as
select service_row.id, row_number() over (order by service_row.id) as ordinal
from public.services as service_row
where service_row.is_active
  and service_row.archived_at is null
order by service_row.id
limit 3;

grant select on coupon_test_services to authenticated;

create function pg_temp.coupon_payload(
  p_code text,
  p_discount_type text default 'fixed',
  p_discount_value numeric default 10,
  p_applies_to_all boolean default true,
  p_service_ids jsonb default '[]'::jsonb,
  p_is_active boolean default true,
  p_expires_at timestamptz default null,
  p_minimum_cart_amount numeric default null,
  p_single_use boolean default false,
  p_new_customers_only boolean default false
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'code', p_code,
    'description', 'Coupon database test fixture',
    'discount_type', p_discount_type,
    'recurring_duration', 'forever',
    'single_use_per_customer', p_single_use,
    'new_customers_only', p_new_customers_only,
    'expires_at', p_expires_at,
    'minimum_cart_amount', p_minimum_cart_amount,
    'is_active', p_is_active,
    'rules', jsonb_build_array(
      jsonb_build_object(
        'discount_value', p_discount_value,
        'applies_to_all', p_applies_to_all,
        'service_ids', p_service_ids
      )
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Authorization, normalization, multiple Services, idempotency
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '27000000-0000-0000-0000-000000000001';

select lives_ok(
  format(
    $sql$select public.app_create_coupon(
      '47000000-0000-0000-0000-000000000001',
      %L::jsonb
    )$sql$,
    jsonb_build_object(
      'code', '  admin10  ',
      'description', 'Admin specific-service coupon',
      'discount_type', 'fixed',
      'recurring_duration', 'forever',
      'single_use_per_customer', false,
      'new_customers_only', false,
      'expires_at', null,
      'minimum_cart_amount', 50,
      'is_active', true,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'discount_value', 10,
          'applies_to_all', false,
          'service_ids', (
            select jsonb_agg(id::text order by ordinal)
            from coupon_test_services
            where ordinal in (1, 2)
          )
        )
      )
    )::text
  ),
  'coupons.manage holder can create a coupon'
);

reset role;

select is((select code from public.coupons where code = 'ADMIN10'), 'ADMIN10', 'coupon codes are trimmed and uppercased');
select is(
  (select created_by_profile_id from public.coupons where code = 'ADMIN10'),
  '27000000-0000-0000-0000-000000000001'::uuid,
  'coupon creation derives the actor from auth.uid()'
);
select is(
  (select count(*) from public.coupon_discount_services as membership join public.coupon_discount_rules as discount_rule on discount_rule.id = membership.coupon_discount_rule_id join public.coupons as coupon on coupon.id = discount_rule.coupon_id where coupon.code = 'ADMIN10'),
  2::bigint,
  'a coupon rule supports multiple selected Wolf Forge Services'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '27000000-0000-0000-0000-000000000002';

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000002', pg_temp.coupon_payload('MEMBERFAIL'))$$,
  '42501',
  'permission denied: coupons.manage',
  'normal internal member without coupons.manage cannot create coupons'
);

select throws_ok(
  $$select public.app_update_coupon((select id from public.coupons where code = 'ADMIN10'), '{}'::jsonb)$$,
  '42501',
  'permission denied: coupons.manage',
  'normal internal member without coupons.manage cannot update coupons'
);

select throws_ok(
  $$select public.app_archive_coupon((select id from public.coupons where code = 'ADMIN10'))$$,
  '42501',
  'permission denied: coupons.manage',
  'normal internal member without coupons.manage cannot archive coupons'
);

set local "request.jwt.claim.sub" = '17000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000003', pg_temp.coupon_payload('CLIENTFAIL'))$$,
  '42501',
  'verified internal authentication is required',
  'Client cannot create coupons'
);

reset role;
set local role anon;

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000004', '{}'::jsonb)$$,
  '42501',
  'permission denied for function app_create_coupon',
  'anonymous caller cannot create coupons'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '27000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000005', pg_temp.coupon_payload('admin10'))$$,
  '23505',
  'duplicate key value violates unique constraint "coupons_code_unique_idx"',
  'normalized coupon codes are unique regardless of input case'
);

select lives_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000006', pg_temp.coupon_payload('PERCENT1', 'percentage', 1))$$,
  'percentage value 1 is accepted'
);

select lives_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000007', pg_temp.coupon_payload('PERCENT100', 'percentage', 100))$$,
  'percentage value 100 is accepted'
);

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000008', pg_temp.coupon_payload('PERCENT101', 'percentage', 100.01))$$,
  '22023',
  'invalid coupon discount rule',
  'percentage over 100 is rejected'
);

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000009', pg_temp.coupon_payload('PERCENT0', 'percentage', 0))$$,
  '22023',
  'invalid coupon discount rule',
  'percentage zero is rejected'
);

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000020', pg_temp.coupon_payload('FIXEDNEGATIVE', 'fixed', -0.01))$$,
  '22023',
  'invalid coupon discount rule',
  'negative fixed discount is rejected'
);

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000010', pg_temp.coupon_payload('EMPTYFAIL', 'fixed', 10, false, '[]'::jsonb))$$,
  '22023',
  'invalid coupon discount rule',
  'specific-service coupon rule requires at least one Service'
);

select lives_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000011', pg_temp.coupon_payload('GLOBAL999', 'fixed', 999, true, '[]'::jsonb))$$,
  'all-services coupon rule requires no Service relationship'
);

select is(
  (select count(*) from public.coupon_discount_services as membership join public.coupon_discount_rules as discount_rule on discount_rule.id = membership.coupon_discount_rule_id join public.coupons as coupon on coupon.id = discount_rule.coupon_id where coupon.code = 'GLOBAL999'),
  0::bigint,
  'all-services applicability is represented explicitly, not by required memberships'
);

select throws_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000012', pg_temp.coupon_payload('NOSERVICE', 'fixed', 10, false, '["ffffffff-ffff-ffff-ffff-ffffffffffff"]'::jsonb))$$,
  '23514',
  'specific-service coupon rules require active Wolf Forge services',
  'selected Services must reference existing active Wolf Forge services'
);

select is(
  (
    select confrelid::bigint
    from pg_catalog.pg_constraint
    where conrelid = 'public.coupon_discount_services'::regclass
      and conname = 'coupon_discount_services_service_id_fkey'
  ),
  'public.services'::regclass::oid::bigint,
  'coupon Service applicability foreign key points to public.services'
);

select lives_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000013', pg_temp.coupon_payload('IDEMPOTENT'))$$,
  'first retry-safe coupon creation succeeds'
);

select lives_ok(
  $$select public.app_create_coupon('47000000-0000-0000-0000-000000000013', pg_temp.coupon_payload('IDEMPOTENT'))$$,
  'same coupon creation request can be retried safely'
);

select is((select count(*) from public.coupons where code = 'IDEMPOTENT'), 1::bigint, 'double creation request produces one coupon');

-- -----------------------------------------------------------------------------
-- Update and audit
-- -----------------------------------------------------------------------------

select lives_ok(
  format(
    $sql$select public.app_update_coupon(
      (select id from public.coupons where code = 'ADMIN10'),
      %L::jsonb
    )$sql$,
    jsonb_build_object(
      'code', 'admin15',
      'description', 'Updated admin coupon',
      'discount_type', 'fixed',
      'recurring_duration', 'first_payment',
      'single_use_per_customer', false,
      'new_customers_only', false,
      'expires_at', null,
      'minimum_cart_amount', 50,
      'is_active', true,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'discount_value', 15,
          'applies_to_all', false,
          'service_ids', (
            select jsonb_agg(id::text order by ordinal)
            from coupon_test_services
            where ordinal in (1, 2)
          )
        )
      )
    )::text
  ),
  'coupons.manage holder can update coupon and rules atomically'
);

reset role;

select is((select code from public.coupons where code = 'ADMIN15'), 'ADMIN15', 'coupon update persists normalized values');
select is(
  (select updated_by_profile_id from public.coupons where code = 'ADMIN15'),
  '27000000-0000-0000-0000-000000000001'::uuid,
  'coupon update actor is derived from auth.uid()'
);
select is(
  (select count(*) from public.activity_events where entity_type = 'coupon' and action = 'coupon.updated' and entity_id = (select id from public.coupons where code = 'ADMIN15')),
  1::bigint,
  'coupon update writes one audit event'
);
select ok(
  (select metadata ? 'before' and metadata ? 'after' from public.activity_events where entity_type = 'coupon' and action = 'coupon.updated' and entity_id = (select id from public.coupons where code = 'ADMIN15')),
  'coupon update audit preserves before and after rule metadata'
);

-- Create validation fixtures as the authorized admin.
set local role authenticated;
set local "request.jwt.claim.sub" = '27000000-0000-0000-0000-000000000001';

select public.app_create_coupon('47000000-0000-0000-0000-000000000014', pg_temp.coupon_payload('EXPIRED', 'fixed', 5, true, '[]'::jsonb, true, now() - interval '1 minute'));
select public.app_create_coupon('47000000-0000-0000-0000-000000000015', pg_temp.coupon_payload('MIN100', 'percentage', 10, true, '[]'::jsonb, true, null, 100));
select public.app_create_coupon('47000000-0000-0000-0000-000000000016', pg_temp.coupon_payload('INACTIVE', 'fixed', 5, true, '[]'::jsonb, false));
select public.app_create_coupon('47000000-0000-0000-0000-000000000017', pg_temp.coupon_payload('SINGLE5', 'fixed', 5, true, '[]'::jsonb, true, null, null, true));
select public.app_create_coupon('47000000-0000-0000-0000-000000000018', pg_temp.coupon_payload('NEWONLY', 'fixed', 5, true, '[]'::jsonb, true, null, null, false, true));
select public.app_create_coupon('47000000-0000-0000-0000-000000000019', pg_temp.coupon_payload('ARCHIVE5', 'fixed', 5));

reset role;

-- -----------------------------------------------------------------------------
-- Validation and calculation
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '17000000-0000-0000-0000-000000000001';

select is(
  public.app_validate_coupon(
    'ADMIN15',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 3), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'failure_code',
  'NOT_APPLICABLE',
  'wrong Service produces no eligible coupon discount'
);

select ok(
  (public.app_validate_coupon(
    'admin15',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'valid')::boolean,
  'eligible specific Service receives a discount with case-insensitive code matching'
);

select is(
  (public.app_validate_coupon(
    'ADMIN15',
    jsonb_build_array(
      jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100),
      jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 2), 'quantity', 1, 'unit_amount', 50)
    ),
    150
  ) ->> 'eligible_subtotal')::numeric,
  150::numeric,
  'multiple selected Services are all eligible under one ordered rule'
);

select ok(
  (public.app_validate_coupon(
    'GLOBAL999',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 3), 'quantity', 1, 'unit_amount', 40)),
    40
  ) ->> 'valid')::boolean,
  'global coupon applies to an active Service'
);

select is(
  (public.app_validate_coupon(
    'GLOBAL999',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 3), 'quantity', 1, 'unit_amount', 40)),
    40
  ) ->> 'discount_amount')::numeric,
  40::numeric,
  'fixed discount is clamped to eligible subtotal'
);

select is(
  (public.app_validate_coupon(
    'GLOBAL999',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 3), 'quantity', 1, 'unit_amount', 40)),
    40
  ) ->> 'resulting_subtotal')::numeric,
  0::numeric,
  'fixed discount cannot make resulting subtotal negative'
);

select is(
  public.app_validate_coupon(
    'EXPIRED',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'failure_code',
  'EXPIRED',
  'expired coupon is invalid'
);

select is(
  public.app_validate_coupon(
    'MIN100',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 99.99)),
    99.99
  ) ->> 'failure_code',
  'MINIMUM_CART_NOT_MET',
  'minimum cart amount is enforced against pre-discount subtotal'
);

select ok(
  (public.app_validate_coupon(
    'MIN100',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'valid')::boolean,
  'cart exactly at minimum amount is eligible'
);

select is(
  public.app_validate_coupon(
    'INACTIVE',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'failure_code',
  'INACTIVE',
  'inactive coupon is invalid'
);

select is(
  public.app_validate_coupon(
    'NEWONLY',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'failure_code',
  'NEW_CUSTOMER_DETERMINATION_DEFERRED',
  'new-customer-only rule returns deterministic deferred result without paid commerce history'
);

select ok(
  (public.app_validate_coupon(
    'SINGLE5',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'valid')::boolean,
  'single-use coupon is initially eligible for a customer'
);

reset role;

insert into public.coupon_redemptions (
  coupon_id,
  customer_profile_id,
  company_id,
  request_id,
  original_cart_subtotal,
  eligible_subtotal,
  discount_amount,
  resulting_cart_subtotal
)
values (
  (select id from public.coupons where code = 'SINGLE5'),
  '17000000-0000-0000-0000-000000000001',
  '37000000-0000-0000-0000-000000000001',
  '57000000-0000-0000-0000-000000000001',
  100,
  100,
  5,
  95
);

set local role authenticated;
set local "request.jwt.claim.sub" = '17000000-0000-0000-0000-000000000001';

select is(
  public.app_validate_coupon(
    'SINGLE5',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'failure_code',
  'ALREADY_REDEEMED',
  'single-use rule is enforced from redemption records'
);

reset role;

select throws_ok(
  $$
    insert into public.coupon_redemptions (
      coupon_id, customer_profile_id, company_id, request_id,
      original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal
    ) values (
      (select id from public.coupons where code = 'SINGLE5'),
      '17000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      '57000000-0000-0000-0000-000000000002',
      100, 100, 5, 95
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "coupon_redemptions_single_use_customer_idx"',
  'database uniqueness backs single use per company customer'
);

select throws_ok(
  $$update public.coupon_redemptions set discount_amount = 4, resulting_cart_subtotal = 96 where request_id = '57000000-0000-0000-0000-000000000001'$$,
  '55000',
  'coupon redemptions are append-only',
  'redemption financial history is append-only'
);

-- -----------------------------------------------------------------------------
-- Archive history and RLS
-- -----------------------------------------------------------------------------

insert into public.coupon_redemptions (
  coupon_id,
  company_id,
  request_id,
  original_cart_subtotal,
  eligible_subtotal,
  discount_amount,
  resulting_cart_subtotal
)
values (
  (select id from public.coupons where code = 'ARCHIVE5'),
  '37000000-0000-0000-0000-000000000001',
  '57000000-0000-0000-0000-000000000003',
  100,
  100,
  5,
  95
);

set local role authenticated;
set local "request.jwt.claim.sub" = '27000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.app_archive_coupon((select id from public.coupons where code = 'ARCHIVE5'))$$,
  'coupons.manage holder can archive a coupon'
);

reset role;

select ok(
  (select archived_at is not null and not is_active from public.coupons where code = 'ARCHIVE5'),
  'coupon archive preserves the row in an inactive archived state'
);

select is(
  (select count(*) from public.coupon_redemptions as redemption join public.coupons as coupon on coupon.id = redemption.coupon_id where coupon.code = 'ARCHIVE5'),
  1::bigint,
  'coupon archive preserves redemption history'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '17000000-0000-0000-0000-000000000001';

select is(
  public.app_validate_coupon(
    'ARCHIVE5',
    jsonb_build_array(jsonb_build_object('service_id', (select id from coupon_test_services where ordinal = 1), 'quantity', 1, 'unit_amount', 100)),
    100
  ) ->> 'failure_code',
  'ARCHIVED',
  'archived coupon is invalid'
);

select is((select count(*) from public.coupons), 0::bigint, 'Client cannot read coupon administration rows');
select is((select count(*) from public.coupon_redemptions), 0::bigint, 'Client cannot read raw coupon redemption rows');

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '27000000-0000-0000-0000-000000000001';

select ok((select count(*) from public.coupons) > 0, 'authorized admin can read coupons for future admin screens');

reset role;

select is(
  (
    select count(*) - baseline.actor_create_event_count
    from public.activity_events
    cross join coupon_test_baseline as baseline
    where action = 'coupon.created'
      and actor_profile_id = '27000000-0000-0000-0000-000000000001'
    group by baseline.actor_create_event_count
  ),
  (
    select count(*) - baseline.coupon_count
    from public.coupons
    cross join coupon_test_baseline as baseline
    group by baseline.coupon_count
  )::bigint,
  'each successful coupon creation has an authenticated actor audit event'
);

select is(
  (select count(*) from public.activity_events where entity_type = 'coupon' and action = 'coupon.archived' and entity_id = (select id from public.coupons where code = 'ARCHIVE5')),
  1::bigint,
  'coupon archive writes one audit event'
);

select ok(
  pg_get_function_arguments('public.app_create_coupon(uuid,jsonb)'::regprocedure) not ilike '%actor%',
  'coupon creation accepts no caller-supplied actor identity'
);

select is((select count(*) from public.services), 59::bigint, 'Services remain exactly 59');
select is((select count(*) from public.services where description is not null and btrim(description) <> ''), 59::bigint, 'Service descriptions remain 59 of 59');

select * from finish();
rollback;
