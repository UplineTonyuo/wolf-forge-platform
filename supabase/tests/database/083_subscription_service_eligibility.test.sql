begin;

select plan(16);

-- -----------------------------------------------------------------------------
-- Column and approved backfill
-- -----------------------------------------------------------------------------

select col_not_null('public', 'services', 'subscription_eligible', 'subscription_eligible is not null');
select col_default_is('public', 'services', 'subscription_eligible', 'false', 'new Services default to ineligible');

select set_eq(
  $$select id from public.services where subscription_eligible$$,
  $$values
    ('5f000000-0000-4000-8000-000000000318'::uuid),
    ('5f000000-0000-4000-8000-000000000555'::uuid),
    ('5f000000-0000-4000-8000-000000000563'::uuid),
    ('5f000000-0000-4000-8000-000000000123'::uuid),
    ('5f000000-0000-4000-8000-000000000554'::uuid),
    ('5f000000-0000-4000-8000-000000000124'::uuid),
    ('5f000000-0000-4000-8000-000000000546'::uuid)$$,
  'only GMB/GBP Management and the six recurring Local SEO packages are eligible'
);

select ok(
  not exists (
    select 1 from public.services
    where id in (
      '5f000000-0000-4000-8000-000000000310', -- GMB Verification
      '5f000000-0000-4000-8000-000000000152', -- GMB Optimization
      '5f000000-0000-4000-8000-000000000256', -- GBP Reviews
      '5f000000-0000-4000-8000-000000000564'  -- Franchise in a Box
    ) and subscription_eligible
  ),
  'one-time GBP services and Franchise in a Box stay ineligible'
);

select is(
  (select recurring from public.services where id = '5f000000-0000-4000-8000-000000000546'),
  false,
  'eligibility does not rewrite services.recurring'
);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('2b000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'qa.subscription-eligibility@wolfforge.local', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner')
where id = '2b000000-0000-0000-0000-000000000001';

insert into public.companies (id, name, status)
values ('3b000000-0000-0000-0000-000000000001', 'QA Eligibility Company', 'client');

create function pg_temp.payload(p_service_id uuid, p_item_service_id uuid default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'company_id', '3b000000-0000-0000-0000-000000000001',
    'service_id', p_service_id,
    'plan_source', 'admin_invoice',
    'billing_anchor', current_date,
    'interval_unit', 'month',
    'interval_count', 1,
    'currency', 'USD',
    'recurring_action', 'none',
    'items', jsonb_build_array(jsonb_build_object(
      'service_id', coalesce(p_item_service_id, p_service_id),
      'name', 'Eligibility snapshot',
      'quantity', 1,
      'unit_amount_cents', 10000
    ))
  );
$$;

create function pg_temp.terms(p_item_service_id uuid, p_effective_from date default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'effective_from', p_effective_from,
    'interval_unit', 'month',
    'interval_count', 1,
    'currency', 'USD',
    'recurring_action', 'none',
    'items', jsonb_build_array(jsonb_build_object(
      'service_id', p_item_service_id,
      'name', 'Eligibility snapshot',
      'quantity', 1,
      'unit_amount_cents', 12000
    ))
  );
$$;

create temporary table eligibility_ids (label text primary key, id uuid not null);
grant select, insert on eligibility_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- Create enforcement
-- -----------------------------------------------------------------------------

select lives_ok(
  $$insert into eligibility_ids values ('gmb', (public.app_create_subscription(
    gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000318'))).id)$$,
  'eligible GMB/GBP Management subscription can be created'
);

select lives_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000546'))$$,
  'eligible Local SEO subscription can be created'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000310'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'GMB Verification is rejected server-side'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000260'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'Website Design is rejected server-side'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5e000000-0000-4000-8000-000000000102'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'SEO Sprint is rejected server-side'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload(
    '5f000000-0000-4000-8000-000000000318', '5f000000-0000-4000-8000-000000000564'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'an ineligible line-item Service cannot ride on an eligible subscription'
);

-- -----------------------------------------------------------------------------
-- Terms update enforcement and existing subscriptions
-- -----------------------------------------------------------------------------

select throws_ok(
  $$select public.app_update_subscription_terms(gen_random_uuid(),
    (select id from eligibility_ids where label = 'gmb'),
    pg_temp.terms('5f000000-0000-4000-8000-000000000152'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'terms cannot move a subscription onto GMB Optimization'
);

select lives_ok(
  $$select public.app_update_subscription_terms(gen_random_uuid(),
    (select id from eligibility_ids where label = 'gmb'),
    pg_temp.terms('5f000000-0000-4000-8000-000000000563'))$$,
  'terms can move a subscription onto another eligible Service'
);

reset role;
update public.services set subscription_eligible = false where id = '5f000000-0000-4000-8000-000000000318';
set local role authenticated;

select lives_ok(
  $$select public.app_update_subscription_terms(gen_random_uuid(),
    (select id from eligibility_ids where label = 'gmb'),
    pg_temp.terms('5f000000-0000-4000-8000-000000000318', current_date + 2))$$,
  'an existing subscription keeps its now-ineligible Service on later terms'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000318'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'the same Service is rejected for new subscriptions once ineligible'
);

reset role;
update public.services set archived_at = now() where id = '5f000000-0000-4000-8000-000000000555';
set local role authenticated;

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload(
    '5f000000-0000-4000-8000-000000000546', '5f000000-0000-4000-8000-000000000555'))$$,
  '23514', 'Service is not eligible for Subscriptions',
  'archived eligible Services stay unavailable'
);

select * from finish();
rollback;
