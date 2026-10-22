begin;

select plan(60);

-- WL-2.24: subscription authorization is Tenant-relative. Wolf Forge (WF) =
-- f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...09c1, Tenant C = ...09c3
-- (suspended). Users: 951 = owner in WF and B, 954 = global client + B internal
-- owner, 955 = WF client of company 951, 956 = B client of company 952,
-- 957 = global internal (WF owner) + B client, 958 = archived B internal,
-- 959 = no membership anywhere, 960 = internal in suspended Tenant C.

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000951', 'authenticated', 'authenticated', 'sub-authz-owner@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000954', 'authenticated', 'authenticated', 'sub-authz-b-internal@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000955', 'authenticated', 'authenticated', 'sub-authz-wf-client@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000956', 'authenticated', 'authenticated', 'sub-authz-b-client@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000957', 'authenticated', 'authenticated', 'sub-authz-dual-client@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000958', 'authenticated', 'authenticated', 'sub-authz-archived@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000959', 'authenticated', 'authenticated', 'sub-authz-nobody@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000960', 'authenticated', 'authenticated', 'sub-authz-c-internal@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-0000000009c1', 'sub-authz-tenant-b', 'Subscription Authz Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-0000000009c3', 'sub-authz-tenant-c', 'Subscription Authz Tenant C', 'suspended');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000951', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Authz Client', 'client'),
  ('30000000-0000-0000-0000-000000000952', 'f0f0f0f0-0000-4000-8000-0000000009c1', 'B Authz Client', 'client'),
  ('30000000-0000-0000-0000-000000000953', 'f0f0f0f0-0000-4000-8000-0000000009c3', 'C Authz Client', 'client');

-- Global compatibility fields first (mirrors the Wolf Forge membership), then
-- Tenant memberships. 956, 959 and 960 never get compatibility roles, so no
-- Wolf Forge membership is mirrored for them.
update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000951', 'owner', null),
  ('20000000-0000-0000-0000-000000000954', 'client', null),
  ('20000000-0000-0000-0000-000000000955', 'client', '30000000-0000-0000-0000-000000000951'),
  ('20000000-0000-0000-0000-000000000957', 'owner', null),
  ('20000000-0000-0000-0000-000000000958', 'client', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-0000000009c1', fixture.profile_id::uuid, fixture.account_class, role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000951', 'internal', 'owner', null, null),
  ('20000000-0000-0000-0000-000000000954', 'internal', 'owner', null, null),
  ('20000000-0000-0000-0000-000000000956', 'client', 'client', '30000000-0000-0000-0000-000000000952', null),
  ('20000000-0000-0000-0000-000000000957', 'client', 'client', '30000000-0000-0000-0000-000000000952', null),
  ('20000000-0000-0000-0000-000000000958', 'internal', 'staff', null, now())
) as fixture(profile_id, account_class, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select 'f0f0f0f0-0000-4000-8000-0000000009c3', '20000000-0000-0000-0000-000000000960', 'internal', role.id, null
from public.roles as role where role.name = 'owner';

insert into public.services (id, tenant_id, name, subscription_eligible)
values
  ('59d00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Authz Service', true),
  ('59d00000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009c1', 'B Authz Service', true),
  ('59d00000-0000-0000-0000-000000000003', 'f0f0f0f0-0000-4000-8000-0000000009c3', 'C Authz Service', true);

-- WF and B Subscriptions are created through the public RPC as 951.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

create temporary table fixture_creation_payload (tenant text, payload jsonb) on commit drop;
grant select on fixture_creation_payload to authenticated;
insert into fixture_creation_payload
select tenant, jsonb_build_object(
  'company_id', company_id, 'service_id', service_id, 'plan_source', 'admin_invoice',
  'billing_anchor', current_date, 'interval_unit', 'month', 'interval_count', 1,
  'currency', 'USD', 'recurring_action', 'none',
  'items', jsonb_build_array(jsonb_build_object(
    'service_id', service_id, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100)))
from (values
  ('wf', '30000000-0000-0000-0000-000000000951', '59d00000-0000-0000-0000-000000000001'),
  ('b', '30000000-0000-0000-0000-000000000952', '59d00000-0000-0000-0000-000000000002')
) as fixture(tenant, company_id, service_id);

select set_config('request.headers', '', true);
select public.app_create_subscription(gen_random_uuid(),
  (select payload from fixture_creation_payload where tenant = 'wf'));
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
select public.app_create_subscription(gen_random_uuid(),
  (select payload from fixture_creation_payload where tenant = 'b'));

reset role;
set local "request.jwt.claim.sub" = '';

-- The suspended-Tenant C Subscription and the child fixtures are trusted
-- inserts; no RPC is involved.
insert into public.subscriptions (tenant_id, company_id, service_id, plan_source, billing_anchor,
    created_by_profile_id, updated_by_profile_id)
values ('f0f0f0f0-0000-4000-8000-0000000009c3', '30000000-0000-0000-0000-000000000953',
  '59d00000-0000-0000-0000-000000000003', 'admin_invoice', current_date,
  '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951');

create temporary table fixture_subscription on commit drop as
select
  max(id::text) filter (where company_id = '30000000-0000-0000-0000-000000000951')::uuid as wf_id,
  max(id::text) filter (where company_id = '30000000-0000-0000-0000-000000000952')::uuid as b_id,
  max(id::text) filter (where company_id = '30000000-0000-0000-0000-000000000953')::uuid as c_id
from public.subscriptions
where company_id in ('30000000-0000-0000-0000-000000000951',
  '30000000-0000-0000-0000-000000000952', '30000000-0000-0000-0000-000000000953');

create temporary table fixture_cycle on commit drop as
select
  (select id from public.subscription_cycles
    where subscription_id = (select wf_id from fixture_subscription) and sequence = 1) as wf_cycle,
  (select id from public.subscription_cycles
    where subscription_id = (select b_id from fixture_subscription) and sequence = 1) as b_cycle;

grant select on fixture_subscription, fixture_cycle to authenticated;

insert into public.subscription_payment_methods (subscription_id, provider, payment_method_ref)
values
  ((select wf_id from fixture_subscription), 'manual', 'wf-authz-pm'),
  ((select b_id from fixture_subscription), 'manual', 'b-authz-pm');

insert into public.subscription_dunning_attempts (cycle_id, attempt_number, scheduled_for)
values
  ((select wf_cycle from fixture_cycle), 1, now()),
  ((select b_cycle from fixture_cycle), 1, now());

create temporary table fixture_terms_payload (label text, payload jsonb) on commit drop;
grant select on fixture_terms_payload to authenticated;
insert into fixture_terms_payload
select label, jsonb_build_object(
  'interval_unit', 'month', 'interval_count', 1, 'currency', 'USD',
  'recurring_action', 'none',
  'items', jsonb_build_array(jsonb_build_object(
    'service_id', service_id, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100)))
from (values
  ('b', '59d00000-0000-0000-0000-000000000002'),
  ('wf', '59d00000-0000-0000-0000-000000000001')
) as fixture(label, service_id);

-- -----------------------------------------------------------------------------
-- D1: child SELECT policies derive ownership from the parent Subscription
-- -----------------------------------------------------------------------------

create temp table subscription_tenant_scope on commit drop as
select id, tenant_id from public.subscriptions;
grant select on subscription_tenant_scope to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select is(
  (select array_agg(subscription_id order by subscription_id) from public.subscription_cycles),
  array[(select b_id from fixture_subscription)],
  'a Tenant B internal member reads only Tenant B cycles'
);

select is(
  (select array_agg(distinct subscription_id order by subscription_id) from public.subscription_events),
  array[(select b_id from fixture_subscription)],
  'a Tenant B internal member reads only Tenant B events'
);

select is(
  (select count(*) from public.subscription_dunning_attempts),
  1::bigint,
  'a Tenant B internal member reads only Tenant B dunning attempts'
);

select is(
  (select array_agg(subscription_id order by subscription_id) from public.subscription_payment_methods),
  array[(select b_id from fixture_subscription)],
  'a Tenant B internal member reads only Tenant B payment methods'
);

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select is(
  (select array_agg(subscription_id order by subscription_id) from public.subscription_cycles
   where subscription_id in (select unnest(array[wf_id, b_id, c_id]) from fixture_subscription)),
  array[(select wf_id from fixture_subscription)],
  'a dual-Tenant identity with the Wolf Forge selector reads only Wolf Forge cycles'
);

select is(
  (select array_agg(distinct subscription_id order by subscription_id) from public.subscription_events
   where subscription_id in (select unnest(array[wf_id, b_id, c_id]) from fixture_subscription)),
  array[(select wf_id from fixture_subscription)],
  'a dual-Tenant identity with the Wolf Forge selector reads only Wolf Forge events'
);

select ok(
  not exists (select 1 from public.subscription_cycles
    where subscription_id not in (select id from subscription_tenant_scope
      where tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001')),
  'every visible cycle belongs to Wolf Forge, including pre-existing records'
);
select ok(
  not exists (select 1 from public.subscription_events
    where subscription_id not in (select id from subscription_tenant_scope
      where tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001')),
  'every visible event belongs to Wolf Forge, including pre-existing records'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select is(
  (select array_agg(subscription_id order by subscription_id) from public.subscription_cycles),
  array[(select b_id from fixture_subscription)],
  'the same dual-Tenant identity with the Tenant B selector reads only Tenant B cycles'
);

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000958';

select is(
  (select count(*) from public.subscription_cycles),
  0::bigint,
  'an archived membership reads no cycles'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c3"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000960';

select is(
  (select count(*) from public.subscription_cycles),
  0::bigint,
  'a suspended Tenant denies child reads entirely'
);

-- -----------------------------------------------------------------------------
-- D3: can_read_subscription is membership- and Tenant-relative
-- -----------------------------------------------------------------------------

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';

select lives_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select b_id from fixture_subscription)),
  'a global-client profile with a Tenant B internal membership reads its own Tenant Subscription detail'
);

select throws_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select wf_id from fixture_subscription)),
  '42501', 'subscription access is denied',
  'the same Tenant B internal member is denied a Wolf Forge Subscription detail'
);

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000957';

select lives_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select b_id from fixture_subscription)),
  'a global-internal profile with a Tenant B client membership reads its own company Subscription detail'
);

select throws_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select wf_id from fixture_subscription)),
  '42501', 'subscription access is denied',
  'the same Tenant B client is denied a Wolf Forge Subscription detail'
);

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000955';

select lives_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select wf_id from fixture_subscription)),
  'a Wolf Forge client reads its own company Subscription detail'
);

select throws_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select b_id from fixture_subscription)),
  '42501', 'subscription access is denied',
  'a Wolf Forge client is denied a Tenant B Subscription detail'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select throws_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select wf_id from fixture_subscription)),
  '42501', 'subscription access is denied',
  'a Wolf Forge owner under a Tenant B selector is denied a Wolf Forge Subscription detail'
);

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000959';

select throws_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select b_id from fixture_subscription)),
  '42501', 'subscription access is denied',
  'a profile with no Tenant B membership is denied Tenant B Subscription detail'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c3"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000960';

select throws_ok(
  format($$select public.app_get_subscription_detail(%L)$$, (select c_id from fixture_subscription)),
  '42501', 'subscription access is denied',
  'a suspended Tenant denies even its own Subscription detail'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';

select is(
  (select array_agg(subscription_id order by subscription_id) from public.app_list_subscription_summaries()),
  array[(select b_id from fixture_subscription)],
  'a Tenant B internal member lists only Tenant B Subscription summaries'
);

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000955';

select is(
  (select array_agg(subscription_id order by subscription_id) from public.app_list_subscription_summaries()),
  array[(select wf_id from fixture_subscription)],
  'a Wolf Forge client lists only its own company Subscription summaries'
);

-- -----------------------------------------------------------------------------
-- D2: foreign targets are indistinguishable from missing targets
-- -----------------------------------------------------------------------------

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';

select throws_ok(
  format($$select public.app_cancel_subscription(%L)$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_cancel_subscription refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_update_subscription_terms(gen_random_uuid(), %L,
    (select payload from fixture_terms_payload where label = 'b'))$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_update_subscription_terms refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_reconcile_subscription_state(%L)$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_reconcile_subscription_state refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_pause_subscription(%L)$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_pause_subscription refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_resume_subscription(%L)$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_resume_subscription refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_schedule_subscription_cancellation(%L)$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_schedule_subscription_cancellation refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_remove_subscription_cancellation(%L)$$, (select wf_id from fixture_subscription)),
  'P0002', null,
  'app_remove_subscription_cancellation refuses a Wolf Forge Subscription from Tenant B'
);

select throws_ok(
  format($$select public.app_generate_subscription_cycle_invoice(gen_random_uuid(), %L)$$,
    (select wf_cycle from fixture_cycle)),
  'P0002', null,
  'app_generate_subscription_cycle_invoice refuses a Wolf Forge cycle from Tenant B'
);

select throws_ok(
  $$select public.app_cancel_subscription(gen_random_uuid())$$,
  'P0002', null,
  'a nonexistent target raises the same error as a foreign target'
);

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select throws_ok(
  format($$select public.app_cancel_subscription(%L)$$, (select b_id from fixture_subscription)),
  'P0002', null,
  'app_cancel_subscription refuses a Tenant B Subscription from Wolf Forge'
);

select throws_ok(
  format($$select public.app_update_subscription_terms(gen_random_uuid(), %L,
    (select payload from fixture_terms_payload where label = 'b'))$$, (select b_id from fixture_subscription)),
  'P0002', null,
  'app_update_subscription_terms refuses a Tenant B Subscription from Wolf Forge'
);

-- -----------------------------------------------------------------------------
-- No cross-Tenant attempt changed anything
-- -----------------------------------------------------------------------------

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select array_agg(status order by id)
    from public.subscriptions
    where id in ((select wf_id from fixture_subscription), (select b_id from fixture_subscription))),
  array['active'::text, 'active'::text],
  'the denied attempts left both Subscriptions active'
);

select is(
  (select count(*) from public.subscription_cycles
    where subscription_id in ((select wf_id from fixture_subscription), (select b_id from fixture_subscription))),
  2::bigint,
  'the denied attempts created no cycles'
);

select is(
  (select count(*) from public.subscription_events
    where subscription_id in ((select wf_id from fixture_subscription), (select b_id from fixture_subscription))),
  4::bigint,
  'the denied attempts wrote no events'
);

-- -----------------------------------------------------------------------------
-- Cycle restoration and creation references are Tenant-scoped
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select throws_ok(
  format($$select public.app_restore_subscription_cycle(%L)$$, (select wf_cycle from fixture_cycle)),
  'P0002', null,
  'app_restore_subscription_cycle refuses a Wolf Forge cycle from Tenant B'
);

select throws_ok(
  $$select public.app_restore_subscription_cycle(gen_random_uuid())$$,
  'P0002', null,
  'a nonexistent cycle raises the same error for cycle restoration'
);

select throws_ok(
  format($$select public.app_create_subscription(gen_random_uuid(), jsonb_build_object(
    'company_id', %L, 'service_id', %L, 'plan_source', 'admin_invoice',
    'billing_anchor', current_date, 'interval_unit', 'month', 'interval_count', 1,
    'currency', 'USD', 'recurring_action', 'none',
    'items', jsonb_build_array(jsonb_build_object(
      'service_id', %L, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100))))$$,
    '30000000-0000-0000-0000-000000000951', '59d00000-0000-0000-0000-000000000002',
    '59d00000-0000-0000-0000-000000000002'),
  'P0002', null,
  'a Tenant B Subscription creation cannot reference a Wolf Forge Client company'
);

select throws_ok(
  format($$select public.app_create_subscription(gen_random_uuid(), jsonb_build_object(
    'company_id', %L, 'service_id', %L, 'plan_source', 'admin_invoice',
    'billing_anchor', current_date, 'interval_unit', 'month', 'interval_count', 1,
    'currency', 'USD', 'recurring_action', 'none',
    'items', jsonb_build_array(jsonb_build_object(
      'service_id', %L, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100))))$$,
    '30000000-0000-0000-0000-000000000952', '59d00000-0000-0000-0000-000000000001',
    '59d00000-0000-0000-0000-000000000001'),
  '23514', 'subscription Service must be active',
  'a Tenant B Subscription creation cannot reference a Wolf Forge Service'
);

-- -----------------------------------------------------------------------------
-- Due work is Tenant-scoped
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select is(
  (select array_agg(distinct subscription_id order by subscription_id)
    from public.app_list_due_subscription_work()),
  array[(select b_id from fixture_subscription)],
  'a Tenant B internal member sees only Tenant B due work'
);

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select is(
  (select array_agg(distinct subscription_id order by subscription_id)
    from public.app_list_due_subscription_work()
    where subscription_id in (select unnest(array[wf_id, b_id, c_id]) from fixture_subscription)),
  array[(select wf_id from fixture_subscription)],
  'a Wolf Forge owner sees only Wolf Forge due work'
);

select ok(
  not exists (select 1 from public.app_list_due_subscription_work()
    where subscription_id not in (select id from subscription_tenant_scope
      where tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001')),
  'every due-work row belongs to Wolf Forge, including pre-existing records'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select is(
  (select array_agg(distinct subscription_id order by subscription_id)
    from public.app_list_due_subscription_work()),
  array[(select b_id from fixture_subscription)],
  'the same dual-Tenant identity sees only Tenant B due work under the Tenant B selector'
);

-- -----------------------------------------------------------------------------
-- Request replays stay inside the Tenant that created the request
-- -----------------------------------------------------------------------------

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select lives_ok(
  format($$select public.app_update_subscription_terms(%L, %L,
    (select payload from fixture_terms_payload where label = 'wf'))$$,
    '77a00000-0000-0000-0000-000000000122', (select wf_id from fixture_subscription)),
  'a Wolf Forge owner updates Wolf Forge terms with a fixed request id'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select throws_ok(
  format($$select public.app_update_subscription_terms(%L, %L,
    (select payload from fixture_terms_payload where label = 'wf'))$$,
    '77a00000-0000-0000-0000-000000000122', (select wf_id from fixture_subscription)),
  'P0002', null,
  'replaying the same terms request under a Tenant B selector returns no foreign plan row'
);

-- -----------------------------------------------------------------------------
-- Legitimate own-Tenant operations still work
-- -----------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';

select lives_ok(
  format($$select public.app_update_subscription_terms(gen_random_uuid(), %L,
    (select payload from fixture_terms_payload where label = 'b'))$$, (select b_id from fixture_subscription)),
  'a Tenant B internal member can update Tenant B Subscription terms'
);

select is(
  (select version from public.subscription_plan_versions
    where subscription_id = (select b_id from fixture_subscription)
    order by version desc limit 1),
  2::integer,
  'updating Tenant B terms creates version 2'
);

select lives_ok(
  format($$select public.app_reconcile_subscription_state(%L)$$, (select b_id from fixture_subscription)),
  'a Tenant B internal member can reconcile a Tenant B Subscription'
);

select is(
  (select status from public.app_cancel_subscription((select b_id from fixture_subscription))),
  'canceled',
  'a Tenant B internal member can cancel a Tenant B Subscription'
);

select is(
  (select array_agg(status || ':' || blocked_reason order by sequence)
    from public.subscription_cycles
    where subscription_id = (select b_id from fixture_subscription)),
  array['skipped:subscription_canceled'::text],
  'canceling a Tenant B Subscription skips its own scheduled cycles'
);

select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select is(
  (select status from public.app_pause_subscription((select wf_id from fixture_subscription))),
  'paused',
  'a Wolf Forge owner can pause a Wolf Forge Subscription'
);

select is(
  (select status from public.app_resume_subscription((select wf_id from fixture_subscription))),
  'active',
  'a Wolf Forge owner can resume a Wolf Forge Subscription'
);

-- -----------------------------------------------------------------------------
-- Archived and missing memberships are refused at the capability gate
-- -----------------------------------------------------------------------------

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000958';

select throws_ok(
  format($$select public.app_cancel_subscription(%L)$$, (select b_id from fixture_subscription)),
  '42501', 'verified internal authentication is required',
  'an archived membership cannot cancel a Subscription'
);

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000959';

select throws_ok(
  format($$select public.app_cancel_subscription(%L)$$, (select b_id from fixture_subscription)),
  '42501', 'verified internal authentication is required',
  'a profile with no membership cannot cancel a Subscription'
);

-- -----------------------------------------------------------------------------
-- D4: the client person must be an active client of the Subscription company
-- in the Subscription Tenant
-- -----------------------------------------------------------------------------

reset role;
set local "request.jwt.claim.sub" = '';

select lives_ok(
  format($$update public.subscriptions set client_profile_id = %L::uuid where id = %L$$,
    '20000000-0000-0000-0000-000000000956', (select b_id from fixture_subscription)),
  'a Tenant B Subscription can name an active client of its Tenant B company'
);

select lives_ok(
  format($$update public.subscriptions set client_profile_id = %L::uuid where id = %L$$,
    '20000000-0000-0000-0000-000000000955', (select wf_id from fixture_subscription)),
  'a Wolf Forge Subscription can name an active client of its Wolf Forge company'
);

select throws_ok(
  format($$update public.subscriptions set client_profile_id = %L::uuid where id = %L$$,
    '20000000-0000-0000-0000-000000000955', (select b_id from fixture_subscription)),
  '23514', 'subscription client profile must be an active client in the subscription company',
  'a Tenant B Subscription cannot name a Wolf Forge-only client person'
);

select throws_ok(
  format($$update public.subscriptions set client_profile_id = %L::uuid where id = %L$$,
    '20000000-0000-0000-0000-000000000956', (select wf_id from fixture_subscription)),
  '23514', 'subscription client profile must be an active client in the subscription company',
  'a Wolf Forge Subscription cannot name a Tenant B client person'
);

-- -----------------------------------------------------------------------------
-- D9: event actor labels come from the current-Tenant membership
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000954';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);

select is(
  (select actor_type
    from public.subscription_events
    where subscription_id = (select b_id from fixture_subscription) and event_type = 'canceled'),
  'user',
  'a Tenant B internal actor is labeled from the Tenant B membership, not the global client role'
);

select * from finish();
rollback;
