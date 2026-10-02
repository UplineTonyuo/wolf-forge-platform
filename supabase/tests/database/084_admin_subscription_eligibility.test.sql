begin;

select plan(22);

-- Local SEO: 6 of 7 eligible; Franchise in a Box (564) is the odd one out.
-- Two extra children prove inactive and archived services are never bulk-written.
insert into public.services (id, name, folder_id, is_active, subscription_eligible)
values ('5f000000-0000-4000-8000-0000000a0001', 'QA inactive Local SEO', '5f000000-0000-4000-8000-000000000049', false, false);
insert into public.services (id, name, folder_id, archived_at, subscription_eligible)
values ('5f000000-0000-4000-8000-0000000a0002', 'QA archived Local SEO', '5f000000-0000-4000-8000-000000000049', now(), false);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('2c000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'qa.eligibility-admin@wolfforge.local', now(), now()),
  ('2c000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'qa.eligibility-staff@wolfforge.local', now(), now());
update public.profiles set role_id = (select id from public.roles where name = 'admin')
where id = '2c000000-0000-0000-0000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff')
where id = '2c000000-0000-0000-0000-000000000002';

insert into public.companies (id, name, status)
values ('3c000000-0000-0000-0000-000000000001', 'QA Eligibility Admin Company', 'client');

create function pg_temp.payload(p_service_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'company_id', '3c000000-0000-0000-0000-000000000001',
    'service_id', p_service_id,
    'plan_source', 'admin_invoice',
    'billing_anchor', current_date,
    'interval_unit', 'month',
    'interval_count', 1,
    'currency', 'USD',
    'recurring_action', 'none',
    'items', jsonb_build_array(jsonb_build_object(
      'service_id', p_service_id, 'name', 'Eligibility snapshot', 'quantity', 1, 'unit_amount_cents', 10000))
  );
$$;

create function pg_temp.eligible_count()
returns bigint
language sql
as $$
  select count(*) from public.services
  where folder_id = '5f000000-0000-4000-8000-000000000049' and is_active and archived_at is null and subscription_eligible;
$$;

create temporary table before_flags as
select id, recurring, is_public, is_active, price from public.services
where folder_id = '5f000000-0000-4000-8000-000000000049';

create temporary table existing_subscription (id uuid);
grant select, insert on before_flags, existing_subscription to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Unauthorized actors cannot mutate eligibility
-- -----------------------------------------------------------------------------
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000002';

select throws_ok(
  $$select public.app_update_service('5f000000-0000-4000-8000-000000000564', '{"subscription_eligible": true}')$$,
  '42501', null, 'staff cannot toggle one service'
);
select throws_ok(
  $$select public.app_set_service_folder_subscription_eligibility('5f000000-0000-4000-8000-000000000049', true)$$,
  '42501', null, 'staff cannot bulk-update a folder'
);
select throws_ok(
  $$update public.services set subscription_eligible = true where id = '5f000000-0000-4000-8000-000000000564' returning id$$,
  '42501', null, 'direct table writes stay blocked'
);

-- -----------------------------------------------------------------------------
-- Single-service toggle
-- -----------------------------------------------------------------------------
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';

select is(pg_temp.eligible_count(), 6::bigint, 'Local SEO starts mixed at 6 of 7');

select is(
  (public.app_update_service('5f000000-0000-4000-8000-000000000564', '{"subscription_eligible": true}')).subscription_eligible,
  true, 'admin toggles Franchise in a Box on'
);
select lives_ok(
  $$insert into existing_subscription select (public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000564'))).id$$,
  'a newly eligible service can start a subscription'
);
select is(
  (public.app_update_service('5f000000-0000-4000-8000-000000000564', '{"subscription_eligible": false}')).subscription_eligible,
  false, 'admin toggles it back off'
);
select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-000000000564'))$$,
  '23514', 'Service is not eligible for Subscriptions', 'server rejects the now-ineligible service'
);
select lives_ok(
  $$select public.app_update_subscription_terms(gen_random_uuid(), (select id from existing_subscription), jsonb_build_object(
    'effective_from', current_date + 2, 'interval_unit', 'month', 'interval_count', 1, 'currency', 'USD', 'recurring_action', 'none',
    'items', jsonb_build_array(jsonb_build_object('service_id', '5f000000-0000-4000-8000-000000000564', 'name', 'Kept', 'quantity', 1, 'unit_amount_cents', 11000))))$$,
  'the existing subscription stays valid and editable'
);
select ok(
  (select app_create_service.subscription_eligible from public.app_create_service(gen_random_uuid(), '{"name": "QA eligible on create", "subscription_eligible": true}')),
  'create accepts subscription_eligible'
);
select is(
  (select subscription_eligible from public.app_create_service(gen_random_uuid(), '{"name": "QA default on create"}')),
  false, 'create defaults to ineligible'
);

-- -----------------------------------------------------------------------------
-- Folder bulk
-- -----------------------------------------------------------------------------
select is(
  public.app_set_service_folder_subscription_eligibility('5f000000-0000-4000-8000-000000000049', false),
  6, 'Remove all changes the six eligible active services'
);
select is(pg_temp.eligible_count(), 0::bigint, 'folder reports NONE');

select is(
  public.app_set_service_folder_subscription_eligibility('5f000000-0000-4000-8000-000000000049', true),
  7, 'Mark all changes every active service'
);
select is(pg_temp.eligible_count(), 7::bigint, 'folder reports ALL');

select lives_ok(
  $$select public.app_update_service('5f000000-0000-4000-8000-000000000546', '{"subscription_eligible": false}')$$,
  'an individual service can still be changed after a bulk action'
);
select is(pg_temp.eligible_count(), 6::bigint, 'folder reports MIXED again');

select throws_ok(
  $$select public.app_set_service_folder_subscription_eligibility('5f000000-0000-4000-8000-0000000000ff', true)$$,
  'P0002', null, 'unknown folder is rejected'
);

reset role;

select ok(
  not exists (select 1 from public.services where id in ('5f000000-0000-4000-8000-0000000a0001', '5f000000-0000-4000-8000-0000000a0002') and subscription_eligible),
  'inactive and archived children are not bulk-written'
);

update public.services set subscription_eligible = true where id = '5f000000-0000-4000-8000-0000000a0002';
set local role authenticated;
select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(), pg_temp.payload('5f000000-0000-4000-8000-0000000a0002'))$$,
  '23514', null, 'archived services stay unusable even when flagged'
);
reset role;

select ok(
  not exists (
    select 1 from public.services as service
    join before_flags as before using (id)
    where (service.recurring, service.is_public, service.is_active, service.price)
      is distinct from (before.recurring, before.is_public, before.is_active, before.price)
  ),
  'recurring, Store visibility, active state and price are untouched'
);

select ok(
  exists (
    select 1 from public.activity_events
    where entity_type = 'service_folder' and action = 'service_folder.subscription_eligibility_updated'
  ),
  'bulk actions are recorded in activity'
);

select * from finish();
rollback;
