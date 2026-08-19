begin;

select plan(32);

-- =============================================================================
-- STRUCTURE
--
-- The executive dashboard mints its own capability instead of reusing
-- dashboard.view, which is granted to manager, staff and client and is shared
-- with the client portal's module row.
-- =============================================================================

select is(
  (select count(*) from public.permissions where permission_key = 'dashboard.executive_view'),
  1::bigint,
  'the dashboard.executive_view capability exists'
);

select is(
  (
    select account_class || '|' || required_permission_key
    from public.permission_modules
    where module_key = 'dashboard'
  ),
  'internal|dashboard.executive_view',
  'the internal dashboard module is backed by dashboard.executive_view'
);

-- The whole reason a new capability was minted: the portal must not move.
select is(
  (
    select account_class || '|' || required_permission_key
    from public.permission_modules
    where module_key = 'portal_dashboard'
  ),
  'client|dashboard.view',
  'the client portal dashboard still uses dashboard.view'
);

select is(
  (
    select string_agg(role_row.name, ',' order by role_row.name)
    from public.role_permissions as grant_row
    join public.roles as role_row on role_row.id = grant_row.role_id
    where grant_row.permission_key = 'dashboard.executive_view'
      and grant_row.allowed
  ),
  'admin',
  'only admin holds an explicit grant; owner bypasses the resolver'
);

-- =============================================================================
-- FIXTURES
--
-- Every timestamp is written in +08:00 so the expected buckets can be read off
-- the fixture directly. The auth trigger creates each profile as an unclaimed
-- client account, so internal roles are assigned afterwards.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'dash-owner@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'dash-admin@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'dash-manager@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'dash-staff@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'dash-client@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Dash ' || role_row.name, company_id = null
from public.roles as role_row
where profile_row.id = '60000000-0000-0000-0000-000000000001' and role_row.name = 'owner';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Dash admin', company_id = null
from public.roles as role_row
where profile_row.id = '60000000-0000-0000-0000-000000000002' and role_row.name = 'admin';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Dash manager', company_id = null
from public.roles as role_row
where profile_row.id = '60000000-0000-0000-0000-000000000003' and role_row.name = 'manager';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Dash staff', company_id = null
from public.roles as role_row
where profile_row.id = '60000000-0000-0000-0000-000000000004' and role_row.name = 'staff';

-- Companies: two created inside the current window, one inside the previous.
insert into public.companies (id, name, status, created_at)
values
  ('61000000-0000-0000-0000-000000000001', 'Alpha Co', 'client',      '2026-06-11 08:00:00+08'),
  ('61000000-0000-0000-0000-000000000002', 'Beta Co',  'client',      '2026-06-12 08:00:00+08'),
  ('61000000-0000-0000-0000-000000000003', 'Gamma Co', 'lead',        '2026-06-05 08:00:00+08'),
  ('61000000-0000-0000-0000-000000000004', 'Delta Co', 'client_team', '2026-01-05 08:00:00+08');

update public.profiles
set company_id = '61000000-0000-0000-0000-000000000001'
where id = '60000000-0000-0000-0000-000000000005';

insert into public.services (id, name, price, is_active, is_public)
values ('62000000-0000-0000-0000-000000000001', 'Dashboard Fixture Service', 100, true, true);

insert into public.orders (id, company_id, service_id, title, status)
values
  ('63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', 'Order on fully paid invoice', 'pending'),
  ('63000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', 'Order on partially paid invoice', 'pending'),
  ('63000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000002',
   '62000000-0000-0000-0000-000000000001', 'Order on GBP invoice', 'pending'),
  ('63000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000002',
   '62000000-0000-0000-0000-000000000001', 'Order on zero-total invoice', 'pending'),
  ('63000000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000003',
   '62000000-0000-0000-0000-000000000001', 'Order paid in the previous window', 'pending');

-- Invoices. A: fully paid across two payments. B: partially paid, stays unpaid.
-- C: fully paid in GBP. D: zero total, paid at issuance with no payment row.
-- E: fully paid inside the previous window. F: void, and therefore invisible.
--
-- Created as drafts because private.protect_invoice_item_history() refuses line
-- items on an issued invoice; issuance is applied after the items exist, which
-- is the order the real app_issue_invoice path also follows.
insert into public.invoices (
  id, company_id, status, currency, due_at,
  subtotal_cents, total_cents,
  created_by_profile_id, updated_by_profile_id
)
values
  ('64000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-000000000001',
   'draft', 'USD', '2026-06-20 09:00:00+08', 10000, 10000,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('64000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-000000000001',
   'draft', 'USD', '2026-06-20 09:00:00+08', 5000, 5000,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('64000000-0000-0000-0000-00000000000c', '61000000-0000-0000-0000-000000000002',
   'draft', 'GBP', '2026-06-20 09:00:00+08', 7000, 7000,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('64000000-0000-0000-0000-00000000000d', '61000000-0000-0000-0000-000000000002',
   'draft', 'USD', '2026-06-20 09:00:00+08', 0, 0,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('64000000-0000-0000-0000-00000000000e', '61000000-0000-0000-0000-000000000003',
   'draft', 'USD', '2026-06-09 09:00:00+08', 3000, 3000,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('64000000-0000-0000-0000-00000000000f', '61000000-0000-0000-0000-000000000003',
   'draft', 'USD', '2026-06-20 09:00:00+08', 99999, 99999,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002');

insert into public.invoice_items (
  invoice_id, service_id, order_id, position, name, quantity,
  unit_price_cents, fulfillment_status
)
values
  ('64000000-0000-0000-0000-00000000000a', '62000000-0000-0000-0000-000000000001',
   '63000000-0000-0000-0000-000000000001', 0, 'Paid line', 1, 10000, 'provisioned'),
  ('64000000-0000-0000-0000-00000000000b', '62000000-0000-0000-0000-000000000001',
   '63000000-0000-0000-0000-000000000002', 0, 'Partial line', 1, 5000, 'provisioned'),
  ('64000000-0000-0000-0000-00000000000c', '62000000-0000-0000-0000-000000000001',
   '63000000-0000-0000-0000-000000000003', 0, 'GBP line', 1, 7000, 'provisioned'),
  ('64000000-0000-0000-0000-00000000000d', '62000000-0000-0000-0000-000000000001',
   '63000000-0000-0000-0000-000000000004', 0, 'Zero line', 1, 0, 'provisioned'),
  ('64000000-0000-0000-0000-00000000000e', '62000000-0000-0000-0000-000000000001',
   '63000000-0000-0000-0000-000000000005', 0, 'Previous line', 1, 3000, 'provisioned');

-- Issue the invoices now that their lines exist.
update public.invoices set
  status = case id
    when '64000000-0000-0000-0000-00000000000b'::uuid then 'unpaid'
    when '64000000-0000-0000-0000-00000000000f'::uuid then 'void'
    else 'paid'
  end,
  invoice_number = case id
    when '64000000-0000-0000-0000-00000000000a'::uuid then 9001
    when '64000000-0000-0000-0000-00000000000b'::uuid then 9002
    when '64000000-0000-0000-0000-00000000000c'::uuid then 9003
    when '64000000-0000-0000-0000-00000000000d'::uuid then 9004
    when '64000000-0000-0000-0000-00000000000e'::uuid then 9005
    else 9006
  end,
  issued_at = case id
    when '64000000-0000-0000-0000-00000000000a'::uuid then '2026-06-11 09:00:00+08'::timestamptz
    when '64000000-0000-0000-0000-00000000000b'::uuid then '2026-06-13 09:00:00+08'::timestamptz
    when '64000000-0000-0000-0000-00000000000c'::uuid then '2026-06-14 09:00:00+08'::timestamptz
    when '64000000-0000-0000-0000-00000000000d'::uuid then '2026-06-16 09:00:00+08'::timestamptz
    when '64000000-0000-0000-0000-00000000000e'::uuid then '2026-06-05 09:00:00+08'::timestamptz
    else '2026-06-12 09:00:00+08'::timestamptz
  end,
  voided_at = case
    when id = '64000000-0000-0000-0000-00000000000f'::uuid
      then '2026-06-13 09:00:00+08'::timestamptz
    else null
  end
where id in (
  '64000000-0000-0000-0000-00000000000a', '64000000-0000-0000-0000-00000000000b',
  '64000000-0000-0000-0000-00000000000c', '64000000-0000-0000-0000-00000000000d',
  '64000000-0000-0000-0000-00000000000e', '64000000-0000-0000-0000-00000000000f'
);

insert into public.invoice_payments (
  invoice_id, amount_cents, currency, status, payment_method, settled_at,
  request_id, created_by_profile_id, created_at
)
values
  ('64000000-0000-0000-0000-00000000000a', 4000, 'USD', 'succeeded', 'manual',
   '2026-06-11 10:00:00+08', gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-11 10:00:00+08'),
  ('64000000-0000-0000-0000-00000000000a', 6000, 'USD', 'succeeded', 'manual',
   '2026-06-12 10:00:00+08', gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-12 10:00:00+08'),
  ('64000000-0000-0000-0000-00000000000b', 2000, 'USD', 'succeeded', 'manual',
   '2026-06-13 10:00:00+08', gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-13 10:00:00+08'),
  ('64000000-0000-0000-0000-00000000000c', 7000, 'GBP', 'succeeded', 'manual',
   '2026-06-14 10:00:00+08', gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-14 10:00:00+08'),
  ('64000000-0000-0000-0000-00000000000e', 3000, 'USD', 'succeeded', 'manual',
   '2026-06-05 10:00:00+08', gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-05 10:00:00+08'),
  -- A pending payment must never reach revenue.
  ('64000000-0000-0000-0000-00000000000b', 1000, 'USD', 'pending', 'manual',
   null, gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-13 11:00:00+08');

insert into public.invoice_refunds (
  invoice_id, amount_cents, currency, reason, status, refunded_at,
  request_id, created_by_profile_id, created_at
)
values
  ('64000000-0000-0000-0000-00000000000a', 1500, 'USD', 'Goodwill', 'succeeded',
   '2026-06-15 10:00:00+08', gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-15 10:00:00+08'),
  -- A failed refund must never reduce revenue.
  ('64000000-0000-0000-0000-00000000000a', 9999, 'USD', 'Reversed', 'failed',
   null, gen_random_uuid(), '60000000-0000-0000-0000-000000000002',
   '2026-06-15 11:00:00+08');

-- Status transitions. Alpha converts twice inside the window and must count once.
insert into public.activity_events (entity_type, entity_id, action, summary, metadata, created_at)
values
  ('company', '61000000-0000-0000-0000-000000000001', 'company.updated', 'Status change',
   '{"field":"status","from":"lead","to":"client"}'::jsonb, '2026-06-11 09:00:00+08'),
  ('company', '61000000-0000-0000-0000-000000000001', 'company.updated', 'Status change',
   '{"field":"status","from":"lead","to":"client"}'::jsonb, '2026-06-13 09:00:00+08'),
  ('company', '61000000-0000-0000-0000-000000000002', 'company.updated', 'Status change',
   '{"field":"status","from":"contact","to":"client"}'::jsonb, '2026-06-12 09:00:00+08'),
  ('company', '61000000-0000-0000-0000-000000000003', 'company.updated', 'Status change',
   '{"field":"status","from":"contact","to":"lead"}'::jsonb, '2026-06-12 09:00:00+08'),
  ('company', '61000000-0000-0000-0000-000000000004', 'company.updated', 'Status change',
   '{"field":"status","from":"lead","to":"client"}'::jsonb, '2026-06-05 09:00:00+08'),
  -- A non-status company update must not be read as a transition.
  ('company', '61000000-0000-0000-0000-000000000004', 'company.updated', 'Renamed',
   '{"field":"name"}'::jsonb, '2026-06-12 09:00:00+08');

insert into public.subscriptions (
  id, company_id, service_id, status, plan_source, billing_anchor, started_at,
  paused_at, cancel_effective_at, canceled_at, current_period_end,
  created_by_profile_id, updated_by_profile_id
)
values
  ('65000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', 'active', 'admin_invoice', '2026-06-11',
   '2026-06-11 10:00:00+08', null, null, null, '2026-07-11',
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('65000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001',
   '62000000-0000-0000-0000-000000000001', 'past_due', 'admin_invoice', '2026-06-12',
   '2026-06-12 10:00:00+08', null, null, null, '2026-07-12',
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('65000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000002',
   '62000000-0000-0000-0000-000000000001', 'pending_cancellation', 'admin_invoice', '2026-06-05',
   '2026-06-05 10:00:00+08', null, '2026-07-05', null, '2026-07-05',
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('65000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000002',
   '62000000-0000-0000-0000-000000000001', 'paused', 'admin_invoice', '2026-01-05',
   '2026-01-05 10:00:00+08', '2026-02-05 10:00:00+08', null, null, '2026-07-05',
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002'),
  ('65000000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000002',
   '62000000-0000-0000-0000-000000000001', 'canceled', 'admin_invoice', '2026-01-05',
   '2026-01-05 10:00:00+08', null, null, '2026-03-05 10:00:00+08', null,
   '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002');

-- =============================================================================
-- AUTHORIZATION
--
-- The rail hides the module for these roles, but hiding is not the boundary.
-- Each of these calls is what a typed URL or a direct PostgREST request does.
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.app_dashboard_overview(
      '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila')$$,
  '42501',
  null,
  'a manager is refused the executive dashboard'
);

set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select public.app_dashboard_overview(
      '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila')$$,
  '42501',
  null,
  'a staff member is refused the executive dashboard'
);

set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000005';
select throws_ok(
  $$select public.app_dashboard_overview(
      '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila')$$,
  '42501',
  null,
  'a client account is refused: the module is internal-class'
);

set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000002';
select lives_ok(
  $$select public.app_dashboard_overview(
      '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila')$$,
  'an admin may read the executive dashboard'
);

-- Owner runs every remaining assertion, exercising the resolver bypass.
set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_dashboard_overview(
      '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila')$$,
  'an owner may read the executive dashboard'
);

-- =============================================================================
-- INPUT VALIDATION
-- =============================================================================

select throws_ok(
  $$select public.app_dashboard_overview(
      '2026-06-17 00:00:00+08', '2026-06-10 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila')$$,
  '22023',
  null,
  'an inverted range is rejected'
);

select throws_ok(
  $$select public.app_dashboard_overview(
      '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'fortnight', 'Asia/Manila')$$,
  '22023',
  null,
  'an unknown bucket is rejected'
);

select throws_ok(
  $$select public.app_dashboard_overview(
      '2020-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
      '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'week', 'Asia/Manila')$$,
  '22023',
  null,
  'a range longer than 366 days is rejected'
);

-- =============================================================================
-- METRICS
-- =============================================================================

create temporary table dashboard_result as
select public.app_dashboard_overview(
  '2026-06-10 00:00:00+08', '2026-06-17 00:00:00+08',
  '2026-06-03 00:00:00+08', '2026-06-10 00:00:00+08', 'day', 'Asia/Manila'
) as payload;

-- 4000 + 6000 (fully paid) + 2000 (partial) = 12000. The pending payment and
-- the void invoice contribute nothing.
select is(
  (
    select (entry ->> 'gross_cents')::bigint
    from dashboard_result, jsonb_array_elements(payload -> 'revenue' -> 'current') as entry
    where entry ->> 'currency' = 'USD'
  ),
  12000::bigint,
  'USD gross revenue counts every succeeded payment once, including partials'
);

select is(
  (
    select (entry ->> 'refunds_cents')::bigint
    from dashboard_result, jsonb_array_elements(payload -> 'revenue' -> 'current') as entry
    where entry ->> 'currency' = 'USD'
  ),
  1500::bigint,
  'only succeeded refunds reduce revenue'
);

select is(
  (
    select (entry ->> 'net_cents')::bigint
    from dashboard_result, jsonb_array_elements(payload -> 'revenue' -> 'current') as entry
    where entry ->> 'currency' = 'USD'
  ),
  10500::bigint,
  'USD net revenue is gross less refunds'
);

select is(
  (
    select (entry ->> 'net_cents')::bigint
    from dashboard_result, jsonb_array_elements(payload -> 'revenue' -> 'current') as entry
    where entry ->> 'currency' = 'GBP'
  ),
  7000::bigint,
  'GBP is reported separately and never folded into USD'
);

select is(
  (select jsonb_array_length(payload -> 'revenue' -> 'current') from dashboard_result),
  2,
  'each currency gets exactly one revenue row'
);

select is(
  (
    select (entry ->> 'gross_cents')::bigint
    from dashboard_result, jsonb_array_elements(payload -> 'revenue' -> 'previous') as entry
    where entry ->> 'currency' = 'USD'
  ),
  3000::bigint,
  'the previous window is measured on the same basis'
);

-- Fully paid USD + fully paid GBP + zero-total. The partially paid invoice is
-- excluded, which is why this figure does not reconcile 1:1 with revenue.
select is(
  (select (payload -> 'paid_orders' ->> 'current')::bigint from dashboard_result),
  3::bigint,
  'paid orders counts orders on fully paid invoices, including zero-total ones'
);

select is(
  (select (payload -> 'paid_orders' ->> 'previous')::bigint from dashboard_result),
  1::bigint,
  'paid orders resolves the previous window from the same paid-at derivation'
);

select is(
  (select (payload -> 'clients' -> 'converted' ->> 'current')::bigint from dashboard_result),
  2::bigint,
  'a company converting twice inside one window counts once'
);

select is(
  (select (payload -> 'clients' -> 'converted' ->> 'previous')::bigint from dashboard_result),
  1::bigint,
  'conversions resolve in the previous window too'
);

select is(
  (select (payload -> 'clients' -> 'created' ->> 'current')::bigint from dashboard_result),
  2::bigint,
  'companies created counts records made in the window'
);

select is(
  (select (payload -> 'new_subscriptions' ->> 'current')::bigint from dashboard_result),
  2::bigint,
  'new subscriptions counts subscriptions started in the window'
);

select is(
  (select (payload -> 'active_subscriptions' ->> 'billable')::bigint from dashboard_result),
  3::bigint,
  'billable subscriptions are active, past_due and pending_cancellation'
);

select is(
  (
    select count(*)
    from dashboard_result,
      jsonb_array_elements(payload -> 'active_subscriptions' -> 'by_status') as entry
    where entry ->> 'status' = 'canceled'
  ),
  0::bigint,
  'canceled subscriptions are absent from the snapshot entirely'
);

-- Seven days, one bucket each, present whether or not money moved.
select is(
  (
    select jsonb_array_length(entry -> 'points')
    from dashboard_result, jsonb_array_elements(payload -> 'sales_trend') as entry
    where entry ->> 'currency' = 'USD'
  ),
  7,
  'the trend returns every bucket in the range, including empty ones'
);

select is(
  (
    select count(*)
    from dashboard_result,
      jsonb_array_elements(payload -> 'sales_trend') as series,
      jsonb_array_elements(series -> 'points') as point
    where series ->> 'currency' = 'USD'
      and (point ->> 'net_cents')::bigint = 0
  ),
  3::bigint,
  'days with no USD movement are returned as zero rather than omitted'
);

-- The refund lands on 15 June Manila and must reduce that bucket alone.
select is(
  (
    select (point ->> 'net_cents')::bigint
    from dashboard_result,
      jsonb_array_elements(payload -> 'sales_trend') as series,
      jsonb_array_elements(series -> 'points') as point
    where series ->> 'currency' = 'USD'
      and (point ->> 'bucket_start')::timestamptz = '2026-06-15 00:00:00+08'
  ),
  -1500::bigint,
  'a refund reduces the bucket it was issued in, not the original sale bucket'
);

select is(
  (select (payload -> 'client_growth' ->> 'supported')::boolean from dashboard_result),
  true,
  'client growth reports itself supported once transitions exist'
);

-- Alpha entered 'client' on both 11 and 13 June, so the chart shows it in two
-- buckets while the headline `clients.converted` figure above counts it once.
-- Distinctness is deliberately per-bucket here and per-window there: a growth
-- chart that hid the second conversion would misreport that day's activity.
select is(
  (
    select sum((point ->> 'to_client')::bigint)::bigint
    from dashboard_result,
      jsonb_array_elements(payload -> 'client_growth' -> 'points') as point
  ),
  3::bigint,
  'client growth is distinct per bucket, unlike the deduplicated window headline'
);

select is(
  (
    select sum((point ->> 'to_lead')::bigint)::bigint
    from dashboard_result,
      jsonb_array_elements(payload -> 'client_growth' -> 'points') as point
  ),
  1::bigint,
  'a non-status company update is not read as a transition'
);

select finish();

rollback;
