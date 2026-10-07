begin;

select plan(34);

-- WL-2.13 (KI-111, dashboard aggregates): app_dashboard_overview returns only
-- the caller's current Tenant's business metrics, with asymmetric fixtures so
-- no equal totals can hide leakage.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001901,
-- empty Tenant C = ...000000001902.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1901 WF owner; 1902 B owner (no WF membership); 1903 owner of both; 1904 B
-- owner with an archived B membership (no WF membership); 1905 WF admin;
-- 1906 empty-Tenant-C owner (no WF membership).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'dash-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1901', '1902', '1903', '1904', '1905', '1906']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001901', 'dash-authz-tenant-b', 'Dash Authz Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001902', 'dash-authz-tenant-c', 'Dash Authz Tenant C', 'active');

insert into public.companies (id, tenant_id, name, status, created_at)
values
  ('e0000000-0000-4000-8000-000000001901', private.wolf_forge_tenant_id(), 'DASH_WF_CLIENT', 'client', now() - interval '45 minutes'),
  ('e0000000-0000-4000-8000-000000001902', private.wolf_forge_tenant_id(), 'DASH_WF_PREV', 'client', now() - interval '3 hours'),
  ('e0000000-0000-4000-8000-000000001903', 'f0f0f0f0-0000-4000-8000-000000001901', 'DASH_B_CLIENT', 'client', now() - interval '45 minutes'),
  ('e0000000-0000-4000-8000-000000001904', 'f0f0f0f0-0000-4000-8000-000000001901', 'DASH_B_PREV_1', 'client', now() - interval '3 hours'),
  ('e0000000-0000-4000-8000-000000001905', 'f0f0f0f0-0000-4000-8000-000000001901', 'DASH_B_PREV_2', 'client', now() - interval '3 hours'),
  ('e0000000-0000-4000-8000-000000001906', 'f0f0f0f0-0000-4000-8000-000000001902', 'DASH_C_CLIENT', 'client', now() - interval '45 minutes');

insert into public.services (id, tenant_id, name, price, currency, is_active, is_public, recurring, sort_order)
values
  ('5b000000-0000-4000-8000-000000001901', private.wolf_forge_tenant_id(), 'DASH_WF_SERVICE', 100.00, 'USD', true, true, false, 0),
  ('5b000000-0000-4000-8000-000000001902', 'f0f0f0f0-0000-4000-8000-000000001901', 'DASH_B_SERVICE', 100.00, 'USD', true, true, false, 0);

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('0d000000-0000-4000-8000-000000001901', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001901', '5b000000-0000-4000-8000-000000001901', 'DASH WF Order 1'),
  ('0d000000-0000-4000-8000-000000001902', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001901', '5b000000-0000-4000-8000-000000001901', 'DASH WF Order 2'),
  ('0d000000-0000-4000-8000-000000001903', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', 'DASH B Order 1'),
  ('0d000000-0000-4000-8000-000000001904', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', 'DASH B Order 2'),
  ('0d000000-0000-4000-8000-000000001905', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', 'DASH B Order 3');

insert into public.invoices (
  id, tenant_id, company_id, status, currency, billing_reason, due_at,
  subtotal_cents, discount_total_cents, tax_total_cents, total_cents,
  created_by_profile_id, updated_by_profile_id
)
values
  ('5a000000-0000-4000-8000-000000001901', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001901', 'draft', 'USD', 'manual', now() + interval '7 days', 50000, 0, 0, 50000, '20000000-0000-0000-0000-000000001901', '20000000-0000-0000-0000-000000001901'),
  ('5a000000-0000-4000-8000-000000001902', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001901', 'draft', 'USD', 'manual', now() + interval '7 days', 11100, 0, 0, 11100, '20000000-0000-0000-0000-000000001901', '20000000-0000-0000-0000-000000001901'),
  ('5a000000-0000-4000-8000-000000001903', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', 'draft', 'USD', 'manual', now() + interval '7 days', 77700, 0, 0, 77700, '20000000-0000-0000-0000-000000001902', '20000000-0000-0000-0000-000000001902'),
  ('5a000000-0000-4000-8000-000000001904', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', 'draft', 'USD', 'manual', now() + interval '7 days', 22200, 0, 0, 22200, '20000000-0000-0000-0000-000000001902', '20000000-0000-0000-0000-000000001902');

insert into public.invoice_items (
  invoice_id, service_id, order_id, position, name, quantity, unit_price_cents,
  unit_discount_cents, is_taxable, fulfillment_status
)
values
  ('5a000000-0000-4000-8000-000000001901', '5b000000-0000-4000-8000-000000001901', '0d000000-0000-4000-8000-000000001901', 0, 'WF line 1', 1, 25000, 0, false, 'provisioned'),
  ('5a000000-0000-4000-8000-000000001901', '5b000000-0000-4000-8000-000000001901', '0d000000-0000-4000-8000-000000001902', 1, 'WF line 2', 1, 25000, 0, false, 'provisioned'),
  ('5a000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', '0d000000-0000-4000-8000-000000001903', 0, 'B line 1', 1, 25900, 0, false, 'provisioned'),
  ('5a000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', '0d000000-0000-4000-8000-000000001904', 1, 'B line 2', 1, 25900, 0, false, 'provisioned'),
  ('5a000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', '0d000000-0000-4000-8000-000000001905', 2, 'B line 3', 1, 25900, 0, false, 'provisioned');

update public.invoices
set status = 'paid', invoice_number = 9911, issued_at = now() - interval '45 minutes'
where id = '5a000000-0000-4000-8000-000000001901';

update public.invoices
set status = 'paid', invoice_number = 9913, issued_at = now() - interval '45 minutes'
where id = '5a000000-0000-4000-8000-000000001903';

update public.invoices set status = 'paid', invoice_number = 9912, issued_at = now() - interval '3 hours'
where id = '5a000000-0000-4000-8000-000000001902';

update public.invoices set status = 'paid', invoice_number = 9914, issued_at = now() - interval '3 hours'
where id = '5a000000-0000-4000-8000-000000001904';

insert into public.invoice_payments (
  id, invoice_id, amount_cents, currency, status, payment_method, settled_at,
  request_id, created_by_profile_id
)
values
  ('7d000000-0000-4000-8000-000000001901', '5a000000-0000-4000-8000-000000001901', 50000, 'USD', 'succeeded', 'manual', now() - interval '45 minutes', '8e000000-0000-4000-8000-000000001901', '20000000-0000-0000-0000-000000001901'),
  ('7d000000-0000-4000-8000-000000001902', '5a000000-0000-4000-8000-000000001902', 11100, 'USD', 'succeeded', 'manual', now() - interval '3 hours', '8e000000-0000-4000-8000-000000001902', '20000000-0000-0000-0000-000000001901'),
  ('7d000000-0000-4000-8000-000000001903', '5a000000-0000-4000-8000-000000001903', 77700, 'USD', 'succeeded', 'manual', now() - interval '45 minutes', '8e000000-0000-4000-8000-000000001903', '20000000-0000-0000-0000-000000001902'),
  ('7d000000-0000-4000-8000-000000001904', '5a000000-0000-4000-8000-000000001904', 22200, 'USD', 'succeeded', 'manual', now() - interval '3 hours', '8e000000-0000-4000-8000-000000001904', '20000000-0000-0000-0000-000000001902');

insert into public.invoice_refunds (
  id, invoice_id, invoice_payment_id, amount_cents, currency, reason, status,
  refunded_at, request_id, created_by_profile_id
)
values
  ('9f000000-0000-4000-8000-000000001901', '5a000000-0000-4000-8000-000000001901', '7d000000-0000-4000-8000-000000001901',
   5000, 'USD', 'WF refund', 'succeeded', now() - interval '30 minutes', '8e000000-0000-4000-8000-000000001905', '20000000-0000-0000-0000-000000001901'),
  ('9f000000-0000-4000-8000-000000001902', '5a000000-0000-4000-8000-000000001902', '7d000000-0000-4000-8000-000000001902',
   1500, 'USD', 'WF previous refund', 'succeeded', now() - interval '3 hours', '8e000000-0000-4000-8000-000000001907', '20000000-0000-0000-0000-000000001901'),
  ('9f000000-0000-4000-8000-000000001903', '5a000000-0000-4000-8000-000000001904', '7d000000-0000-4000-8000-000000001904',
   700, 'USD', 'B previous refund', 'succeeded', now() - interval '3 hours', '8e000000-0000-4000-8000-000000001908', '20000000-0000-0000-0000-000000001902');

insert into public.subscriptions (
  id, tenant_id, company_id, service_id, plan_source, billing_anchor, started_at,
  created_by_profile_id, updated_by_profile_id
)
values
  ('5f000000-0000-4000-8000-000000001901', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001901', '5b000000-0000-4000-8000-000000001901', 'admin_invoice', current_date, now() - interval '45 minutes', '20000000-0000-0000-0000-000000001901', '20000000-0000-0000-0000-000000001901'),
  ('5f000000-0000-4000-8000-000000001902', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', 'admin_invoice', current_date, now() - interval '45 minutes', '20000000-0000-0000-0000-000000001902', '20000000-0000-0000-0000-000000001902'),
  ('5f000000-0000-4000-8000-000000001903', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', '5b000000-0000-4000-8000-000000001902', 'admin_invoice', current_date, now() - interval '45 minutes', '20000000-0000-0000-0000-000000001902', '20000000-0000-0000-0000-000000001902');

update public.subscriptions set status = 'past_due'
where id = '5f000000-0000-4000-8000-000000001903';

insert into public.activity_events (
  actor_profile_id, entity_type, entity_id, action, summary, metadata, created_at
)
values
  ('20000000-0000-0000-0000-000000001901', 'company', 'e0000000-0000-4000-8000-000000001901', 'company.updated', 'WF converted',
   jsonb_build_object('field', 'status', 'from', 'lead', 'to', 'client'), now() - interval '40 minutes'),
  ('20000000-0000-0000-0000-000000001902', 'company', 'e0000000-0000-4000-8000-000000001903', 'company.updated', 'B converted 1',
   jsonb_build_object('field', 'status', 'from', 'lead', 'to', 'client'), now() - interval '40 minutes'),
  ('20000000-0000-0000-0000-000000001902', 'company', 'e0000000-0000-4000-8000-000000001904', 'company.updated', 'B converted 2',
   jsonb_build_object('field', 'status', 'from', 'lead', 'to', 'client'), now() - interval '40 minutes');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id in (
    '20000000-0000-0000-0000-000000001901',
    '20000000-0000-0000-0000-000000001902',
    '20000000-0000-0000-0000-000000001903',
    '20000000-0000-0000-0000-000000001904',
    '20000000-0000-0000-0000-000000001906'
  )
  and role.name = 'owner';

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id = '20000000-0000-0000-0000-000000001905' and role.name = 'admin';

-- B-only and C-only users hold no Wolf Forge membership at all.
delete from public.tenant_memberships as membership_row
where membership_row.tenant_id = private.wolf_forge_tenant_id()
  and membership_row.profile_id in (
    '20000000-0000-0000-0000-000000001902',
    '20000000-0000-0000-0000-000000001904',
    '20000000-0000-0000-0000-000000001906'
  );

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, 'internal', role.id, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-000000001901', '20000000-0000-0000-0000-000000001902', null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000001901', '20000000-0000-0000-0000-000000001903', null),
  ('f0f0f0f0-0000-4000-8000-000000001901', '20000000-0000-0000-0000-000000001904', now()),
  ('f0f0f0f0-0000-4000-8000-000000001902', '20000000-0000-0000-0000-000000001906', null)
) as fixture(tenant_id, profile_id, archived_at)
join public.roles as role on role.name = 'owner';

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function pg_temp.dash()
returns jsonb
language sql
stable
as $$
  select public.app_dashboard_overview(
    now() - interval '2 hours', now() + interval '1 hour',
    now() - interval '4 hours', now() - interval '2 hours', 'day', 'UTC'
  );
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

grant execute on function pg_temp.dash(), pg_temp.act(text, text), pg_temp.try(text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Wolf Forge owner: honest Wolf Forge values only
-- -----------------------------------------------------------------------------

select pg_temp.act('1901', '');
select is((pg_temp.dash() #>> '{revenue,current,0,gross_cents}')::bigint, 50000::bigint,
  'WF gross counts only the WF payment');
select is((pg_temp.dash() #>> '{revenue,current,0,refunds_cents}')::bigint, 5000::bigint,
  'WF refunds count only the WF refund');
select is((pg_temp.dash() #>> '{revenue,current,0,net_cents}')::bigint, 45000::bigint,
  'WF net is the WF movement alone');
select is((pg_temp.dash() #>> '{revenue,previous,0,gross_cents}')::bigint, 11100::bigint,
  'WF previous gross counts only the WF previous payment');
select is((pg_temp.dash() #>> '{paid_orders,current}')::bigint, 2::bigint,
  'WF paid orders count only WF orders');
select is((pg_temp.dash() #>> '{paid_orders,previous}')::bigint, 0::bigint,
  'no WF paid orders in the previous window');
select is((pg_temp.dash() #>> '{clients,created,current}')::bigint, 1::bigint,
  'WF companies created counts only WF companies');
select is((pg_temp.dash() #>> '{clients,created,previous}')::bigint, 1::bigint,
  'WF previous companies created counts only the WF previous company');
select is((pg_temp.dash() #>> '{clients,converted,current}')::bigint, 1::bigint,
  'WF conversions count only WF status events');
select is((pg_temp.dash() #>> '{new_subscriptions,current}')::bigint, 1::bigint,
  'WF new subscriptions count only WF subscriptions');
select is((pg_temp.dash() #>> '{active_subscriptions,billable}')::bigint, 1::bigint,
  'WF billable subscriptions count only WF subscriptions');
select is((select sum((point ->> 'net_cents')::bigint)::bigint from jsonb_array_elements(pg_temp.dash() -> 'sales_trend' -> 0 -> 'points') as point),
  45000::bigint, 'the WF sales trend carries only WF movements');

-- -----------------------------------------------------------------------------
-- Tenant B owner under the Tenant B selector
-- -----------------------------------------------------------------------------

select pg_temp.act('1902', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001901"}');
select is((pg_temp.dash() #>> '{revenue,current,0,gross_cents}')::bigint, 77700::bigint,
  'Tenant B gross counts only the Tenant B payment');
select is((pg_temp.dash() #>> '{revenue,current,0,refunds_cents}')::bigint, 0::bigint,
  'Tenant B refunds count only Tenant B refunds');
select is((pg_temp.dash() #>> '{paid_orders,current}')::bigint, 3::bigint,
  'Tenant B paid orders count only Tenant B orders');
select is((pg_temp.dash() #>> '{clients,created,current}')::bigint, 1::bigint,
  'Tenant B companies created counts only Tenant B companies');
select is((pg_temp.dash() #>> '{clients,created,previous}')::bigint, 2::bigint,
  'Tenant B previous companies created counts only Tenant B previous companies');
select is((pg_temp.dash() #>> '{clients,converted,current}')::bigint, 2::bigint,
  'Tenant B conversions count only Tenant B status events');
select is((pg_temp.dash() #>> '{new_subscriptions,current}')::bigint, 2::bigint,
  'Tenant B new subscriptions count only Tenant B subscriptions');
select is((pg_temp.dash() #>> '{active_subscriptions,billable}')::bigint, 2::bigint,
  'Tenant B billable subscriptions count only Tenant B subscriptions');
select is((select sum((point ->> 'net_cents')::bigint)::bigint from jsonb_array_elements(pg_temp.dash() -> 'sales_trend' -> 0 -> 'points') as point),
  77700::bigint, 'the Tenant B sales trend carries only Tenant B movements');
select is((pg_temp.dash() #>> '{revenue,previous,0,refunds_cents}')::bigint, 700::bigint,
  'Tenant B previous refunds count only the Tenant B refund');

-- -----------------------------------------------------------------------------
-- Cross-Tenant oracle: changing Tenant B data must not change the WF payload
-- -----------------------------------------------------------------------------

select pg_temp.act('1901', '');
create temp table wl213_baseline as select pg_temp.dash() as payload;

-- Trusted Tenant B growth runs without the signed-in browser role.
reset role;

insert into public.invoices (
  id, tenant_id, company_id, status, currency, invoice_number,
  billing_reason, issued_at, due_at, subtotal_cents, discount_total_cents,
  tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id
)
values
  ('5a000000-0000-4000-8000-000000001905', 'f0f0f0f0-0000-4000-8000-000000001901', 'e0000000-0000-4000-8000-000000001903', 'paid', 'USD', 9915, 'manual', now() - interval '30 minutes', now() + interval '7 days', 999999, 0, 0, 999999, '20000000-0000-0000-0000-000000001902', '20000000-0000-0000-0000-000000001902');

insert into public.invoice_payments (
  id, invoice_id, amount_cents, currency, status, payment_method, settled_at,
  request_id, created_by_profile_id
)
values
  ('7d000000-0000-4000-8000-000000001905', '5a000000-0000-4000-8000-000000001905', 999999, 'USD', 'succeeded', 'manual', now() - interval '30 minutes', '8e000000-0000-4000-8000-000000001906', '20000000-0000-0000-0000-000000001902');

set local role authenticated;

select is(pg_temp.dash(), (select payload from wl213_baseline),
  'growing Tenant B data does not change the WF dashboard payload');

select pg_temp.act('1902', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001901"}');
select is((pg_temp.dash() #>> '{revenue,current,0,gross_cents}')::bigint, 1077699::bigint,
  'the Tenant B dashboard reflects its own new payment');

-- -----------------------------------------------------------------------------
-- Dual owner follows the selector
-- -----------------------------------------------------------------------------

select pg_temp.act('1903', '');
select is((pg_temp.dash() #>> '{revenue,current,0,gross_cents}')::bigint, 50000::bigint,
  'the dual owner under the WF selector sees the WF gross');

select pg_temp.act('1903', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001901"}');
select is((pg_temp.dash() #>> '{revenue,current,0,gross_cents}')::bigint, 1077699::bigint,
  'the dual owner under the Tenant B selector sees the Tenant B gross');

-- -----------------------------------------------------------------------------
-- Empty Tenant C: the existing empty representation, never a fallback
-- -----------------------------------------------------------------------------

select pg_temp.act('1906', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001902"}');
select is((pg_temp.dash() -> 'revenue' -> 'current'), '[]'::jsonb,
  'an empty Tenant receives an empty revenue array, not another Tenant''s totals');
select is((pg_temp.dash() #>> '{paid_orders,current}')::bigint, 0::bigint,
  'an empty Tenant receives zero paid orders');
select is((pg_temp.dash() #>> '{active_subscriptions,billable}')::bigint, 0::bigint,
  'an empty Tenant receives zero billable subscriptions');

-- -----------------------------------------------------------------------------
-- WF admin (explicit grant) and blocked callers
-- -----------------------------------------------------------------------------

select pg_temp.act('1905', '');
select is((pg_temp.dash() #>> '{revenue,current,0,gross_cents}')::bigint, 50000::bigint,
  'a WF admin sees the same WF-only gross');

select pg_temp.act('1904', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001901"}');
select is(pg_temp.try('select pg_temp.dash()'), '42501',
  'an archived Tenant B membership cannot read the dashboard');

select pg_temp.act('1902', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001999"}');
select is(pg_temp.try('select pg_temp.dash()'), '42501',
  'a selector for a Tenant without membership is refused');

select pg_temp.act('1902', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.try('select pg_temp.dash()'), '42501',
  'a malformed selector is refused');

-- -----------------------------------------------------------------------------
-- Output shape stays identical
-- -----------------------------------------------------------------------------

select pg_temp.act('1901', '');
select is(
  (select array_agg(key order by key) from jsonb_object_keys(pg_temp.dash()) as key),
  array['active_subscriptions', 'client_growth', 'clients', 'new_subscriptions', 'paid_orders', 'revenue', 'sales_trend'],
  'the dashboard payload keeps its exact key set');

select * from finish();
rollback;
