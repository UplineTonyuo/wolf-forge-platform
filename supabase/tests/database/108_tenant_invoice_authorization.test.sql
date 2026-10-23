begin;

select plan(48);

-- WL-2.11 (KI-111, invoice): every invoice read, state change and financial
-- read requires the invoice to belong to the caller's current Tenant; the
-- client branch resolves through the current-Tenant membership.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001701.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1701 WF admin; 1702 B admin (no WF membership); 1703 WF manager (view only);
-- 1704 B owner (no WF membership); 1705 owner of both; 1706 B admin with an
-- archived B membership (no WF membership); 1707 WF client; 1708 B client.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'invoice-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1701', '1702', '1703', '1704', '1705', '1706', '1707', '1708']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001701', 'invoice-authz-tenant-b', 'Invoice Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e0000000-0000-4000-8000-000000001701', private.wolf_forge_tenant_id(), 'INVOICE_WF_CLIENT', 'client'),
  ('e0000000-0000-4000-8000-000000001702', 'f0f0f0f0-0000-4000-8000-000000001701', 'INVOICE_B_CLIENT', 'client');

insert into public.invoices (
  id, tenant_id, company_id, status, currency, invoice_number,
  billing_reason, issued_at, due_at, subtotal_cents, discount_total_cents,
  tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id
)
values
  ('5a000000-0000-4000-8000-000000001701', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001701', 'unpaid', 'USD', 9701, 'manual', now(), now() + interval '7 days', 20000, 0, 0, 20000, '20000000-0000-0000-0000-000000001701', '20000000-0000-0000-0000-000000001701'),
  ('5a000000-0000-4000-8000-000000001702', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001701', 'draft', 'USD', null, null, null, now() + interval '7 days', 15000, 0, 0, 15000, '20000000-0000-0000-0000-000000001701', '20000000-0000-0000-0000-000000001701'),
  ('5a000000-0000-4000-8000-000000001703', 'f0f0f0f0-0000-4000-8000-000000001701', 'e0000000-0000-4000-8000-000000001702', 'unpaid', 'USD', 9703, 'manual', now(), now() + interval '7 days', 30000, 0, 0, 30000, '20000000-0000-0000-0000-000000001702', '20000000-0000-0000-0000-000000001702'),
  ('5a000000-0000-4000-8000-000000001704', 'f0f0f0f0-0000-4000-8000-000000001701', 'e0000000-0000-4000-8000-000000001702', 'draft', 'USD', null, null, null, now() + interval '7 days', 12000, 0, 0, 12000, '20000000-0000-0000-0000-000000001702', '20000000-0000-0000-0000-000000001702'),
  ('5a000000-0000-4000-8000-000000001705', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001701', 'paid', 'USD', 9705, 'manual', now(), now() + interval '7 days', 500, 0, 0, 500, '20000000-0000-0000-0000-000000001701', '20000000-0000-0000-0000-000000001701'),
  ('5a000000-0000-4000-8000-000000001706', 'f0f0f0f0-0000-4000-8000-000000001701', 'e0000000-0000-4000-8000-000000001702', 'paid', 'USD', 9706, 'manual', now(), now() + interval '7 days', 500, 0, 0, 500, '20000000-0000-0000-0000-000000001702', '20000000-0000-0000-0000-000000001702');

insert into public.invoice_items (
  invoice_id, position, name, quantity, unit_price_cents, unit_discount_cents,
  is_taxable, fulfillment_status
)
values
  ('5a000000-0000-4000-8000-000000001702', 0, 'WF draft line', 1, 15000, 0, false, 'not_applicable'),
  ('5a000000-0000-4000-8000-000000001704', 0, 'B draft line', 1, 12000, 0, false, 'not_applicable');

insert into public.invoice_payments (
  id, invoice_id, amount_cents, currency, status, payment_method, settled_at,
  request_id, created_by_profile_id
)
values
  ('7d000000-0000-4000-8000-000000001701', '5a000000-0000-4000-8000-000000001705', 500, 'USD', 'succeeded', 'manual', now(),
   '8e000000-0000-4000-8000-000000001701', '20000000-0000-0000-0000-000000001701'),
  ('7d000000-0000-4000-8000-000000001702', '5a000000-0000-4000-8000-000000001706', 500, 'USD', 'succeeded', 'manual', now(),
   '8e000000-0000-4000-8000-000000001702', '20000000-0000-0000-0000-000000001702');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001701', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001702', 'admin', null, null),
  ('20000000-0000-0000-0000-000000001703', 'manager', null, null),
  ('20000000-0000-0000-0000-000000001704', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001705', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001706', 'admin', null, null),
  ('20000000-0000-0000-0000-000000001707', 'client', null, 'e0000000-0000-4000-8000-000000001701'),
  ('20000000-0000-0000-0000-000000001708', 'client', null, null)
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

-- B-only users hold no Wolf Forge membership at all.
delete from public.tenant_memberships as membership_row
where membership_row.tenant_id = private.wolf_forge_tenant_id()
  and membership_row.profile_id in (
    '20000000-0000-0000-0000-000000001702',
    '20000000-0000-0000-0000-000000001704',
    '20000000-0000-0000-0000-000000001706'
  );

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001701', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001702', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001704', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001705', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001706', 'admin', 'internal', null, now()),
  ('20000000-0000-0000-0000-000000001708', 'client', 'client', 'e0000000-0000-4000-8000-000000001702', null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- Runs one statement and returns 'ok' or its SQLSTATE.
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

create function pg_temp.trymsg(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

-- Every id-based invoice operation: update and issue the draft, void the
-- issued invoice, read its financials, and attempt a creation for the given
-- company.
create function pg_temp.battery(p_draft text, p_issued text, p_company text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'update:' || pg_temp.try(format('select public.app_update_invoice(%L, %L)', p_draft, '{"billing_reason":"attack"}')),
    'issue:' || pg_temp.try(format('select public.app_issue_invoice(%L)', p_draft)),
    'void:' || pg_temp.try(format('select public.app_void_invoice(%L)', p_issued)),
    'fin:' || pg_temp.try(format('select * from public.app_get_invoice_financials(%L)', p_issued)),
    'create:' || pg_temp.try(format(
      'select public.app_create_invoice(gen_random_uuid(), jsonb_build_object(%L::text, %L::text, ''items'', jsonb_build_array(jsonb_build_object(''name'', ''attack line'', ''quantity'', 1, ''unit_price_cents'', 100))))',
      'company_id', p_company))
  );
end;
$$;

-- Security-definer readbacks.
create function pg_temp.inv_status(p_id text)
returns text
language sql
security definer
as $$
  select status from public.invoices where id = p_id::uuid;
$$;

create function pg_temp.inv_reason(p_id text)
returns text
language sql
security definer
as $$
  select coalesce(billing_reason, '-') from public.invoices where id = p_id::uuid;
$$;

create function pg_temp.inv_issued(p_id text)
returns text
language sql
security definer
as $$
  select status || ':' || (invoice_number is not null)::text from public.invoices where id = p_id::uuid;
$$;

create function pg_temp.events_by(p_entity text, p_actor text)
returns bigint
language sql
security definer
as $$
  select count(*) from public.activity_events
  where entity_id = p_entity::uuid and actor_profile_id = p_actor::uuid;
$$;

create function pg_temp.events_wrong_tenant(p_entity text, p_tenant text)
returns bigint
language sql
security definer
as $$
  select count(*) from public.activity_events
  where entity_id = p_entity::uuid and tenant_id <> p_tenant::uuid;
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.trymsg(text), pg_temp.battery(text, text, text), pg_temp.inv_status(text),
  pg_temp.inv_reason(text), pg_temp.inv_issued(text), pg_temp.events_by(text, text),
  pg_temp.events_wrong_tenant(text, text), pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads (invoice and item RLS)
-- -----------------------------------------------------------------------------

select pg_temp.act('1701', '');
select is((select coalesce(string_agg(right(id::text, 4), ' ' order by id), '-') from public.invoices
    where id::text like '5a000000-0000-4000-8000-00000000170%'),
  '1701 1702 1705', 'a WF admin reads only Wolf Forge invoices');
select is((select count(*) from public.invoice_items
    where invoice_id::text like '5a000000-0000-4000-8000-00000000170%'
      and invoice_id in ('5a000000-0000-4000-8000-000000001704', '5a000000-0000-4000-8000-000000001706')),
  0::bigint, 'a WF admin reads no Tenant B invoice items');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is((select coalesce(string_agg(right(id::text, 4), ' ' order by id), '-') from public.invoices
    where id::text like '5a000000-0000-4000-8000-00000000170%'),
  '1703 1704 1706', 'a Tenant B admin reads only Tenant B invoices');

select pg_temp.act('1703', '');
select is((select coalesce(string_agg(right(id::text, 4), ' ' order by id), '-') from public.invoices
    where id::text like '5a000000-0000-4000-8000-00000000170%'),
  '1701 1702 1705', 'a WF manager with invoices.view reads Wolf Forge invoices only');

select pg_temp.act('1707', '');
select is((select coalesce(string_agg(right(id::text, 4), ' ' order by id), '-') from public.invoices
    where id::text like '5a000000-0000-4000-8000-00000000170%'),
  '1701 1702 1705', 'a WF portal client reads only its own company invoices');

select pg_temp.act('1708', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is((select coalesce(string_agg(right(id::text, 4), ' ' order by id), '-') from public.invoices
    where id::text like '5a000000-0000-4000-8000-00000000170%'),
  '1703 1704 1706', 'a Tenant B portal client reads only its own company invoices');

-- -----------------------------------------------------------------------------
-- Financial reads
-- -----------------------------------------------------------------------------

select pg_temp.act('1701', '');
select is(pg_temp.try('select * from public.app_get_invoice_financials(''5a000000-0000-4000-8000-000000001703'')'),
  '42501', 'a WF admin cannot read Tenant B invoice financials');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.try('select * from public.app_get_invoice_financials(''5a000000-0000-4000-8000-000000001701'')'),
  '42501', 'a Tenant B admin cannot read WF invoice financials');
select is((select balance_due_cents from public.app_get_invoice_financials('5a000000-0000-4000-8000-000000001703')),
  30000::bigint, 'a Tenant B admin reads its own invoice financials');

select pg_temp.act('1708', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is((select balance_due_cents from public.app_get_invoice_financials('5a000000-0000-4000-8000-000000001703')),
  30000::bigint, 'a Tenant B portal client reads its own invoice financials');

-- -----------------------------------------------------------------------------
-- Update / issue / void fail closed across Tenants
-- -----------------------------------------------------------------------------

select pg_temp.act('1701', '');
select is(pg_temp.try('select public.app_update_invoice(''5a000000-0000-4000-8000-000000001704'', ''{"billing_reason":"attack"}'' )'),
  'P0002', 'a WF admin cannot update a Tenant B draft invoice');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.inv_reason('5a000000-0000-4000-8000-000000001704'), '-',
  'the Tenant B draft stayed unchanged after the foreign update');
select is(pg_temp.trymsg('select public.app_update_invoice(''5a000000-0000-4000-8000-000000001704'', ''{"billing_reason":"subscription_update"}'' )'),
  'ok', 'a Tenant B admin updates its own draft invoice');
select is(pg_temp.inv_reason('5a000000-0000-4000-8000-000000001704'), 'subscription_update',
  'the Tenant B draft update persisted');

select pg_temp.act('1701', '');
select is(pg_temp.try('select public.app_issue_invoice(''5a000000-0000-4000-8000-000000001704'')'),
  'P0002', 'a WF admin cannot issue a Tenant B draft invoice');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.inv_status('5a000000-0000-4000-8000-000000001704'), 'draft',
  'the Tenant B draft stayed a draft after the foreign issue');
select is(pg_temp.try('select public.app_issue_invoice(''5a000000-0000-4000-8000-000000001704'')'),
  'ok', 'a Tenant B admin issues its own draft invoice');
select is(pg_temp.inv_issued('5a000000-0000-4000-8000-000000001704'), 'unpaid:true',
  'the Tenant B issuance set status and number');

select pg_temp.act('1701', '');
select is(pg_temp.try('select public.app_void_invoice(''5a000000-0000-4000-8000-000000001703'')'),
  'P0002', 'a WF admin cannot void a Tenant B invoice');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.inv_status('5a000000-0000-4000-8000-000000001703'), 'unpaid',
  'the Tenant B invoice stayed unpaid after the foreign void');
select is(pg_temp.try('select public.app_void_invoice(''5a000000-0000-4000-8000-000000001703'')'),
  'ok', 'a Tenant B admin voids its own invoice');
select is(pg_temp.try('select public.app_void_invoice(''5a000000-0000-4000-8000-000000001706'')'),
  '55000', 'a Tenant B admin still cannot void its own paid invoice');

-- -----------------------------------------------------------------------------
-- Create fails closed across Tenants and replay stays in Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1701', '');
select is(pg_temp.try(
    $$select public.app_create_invoice(gen_random_uuid(), jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001702', 'items', jsonb_build_array(jsonb_build_object('name', 'x', 'quantity', 1, 'unit_price_cents', 100))))$$),
  'P0002', 'a WF admin cannot create an invoice for a Tenant B Client');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.try(
    $$select public.app_create_invoice(gen_random_uuid(), jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001701', 'items', jsonb_build_array(jsonb_build_object('name', 'x', 'quantity', 1, 'unit_price_cents', 100))))$$),
  'P0002', 'a Tenant B admin cannot create an invoice for a WF Client');
select is((select tenant_id from public.app_create_invoice('8e000000-0000-4000-8000-000000001721', jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001702', 'items', jsonb_build_array(jsonb_build_object('name', 'own line', 'quantity', 1, 'unit_price_cents', 100))))),
  'f0f0f0f0-0000-4000-8000-000000001701'::uuid, 'a Tenant B admin creation lands in Tenant B');

select pg_temp.act('1705', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.try(
    $$select public.app_create_invoice('8e000000-0000-4000-8000-000000001722', jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001702', 'items', jsonb_build_array(jsonb_build_object('name', 'x', 'quantity', 1, 'unit_price_cents', 100))))$$),
  'ok', 'the dual owner creates a Tenant B invoice under the Tenant B selector');
select pg_temp.act('1705', '');
select is(pg_temp.try(
    $$select public.app_create_invoice('8e000000-0000-4000-8000-000000001722', jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001702', 'items', jsonb_build_array(jsonb_build_object('name', 'x', 'quantity', 1, 'unit_price_cents', 100))))$$),
  'P0002', 'a replayed creation is not answered under another Tenant selector');

-- -----------------------------------------------------------------------------
-- Wallet / payment layer stays intact (WL-2.10 re-test)
-- -----------------------------------------------------------------------------

select pg_temp.act('1708', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001731'', ''5a000000-0000-4000-8000-000000001701'')'),
  '42501', 'a Tenant B client still cannot wallet-pay a WF invoice');

select pg_temp.act('1701', '');
select is(pg_temp.try('select public.app_record_invoice_payment(''8e000000-0000-4000-8000-000000001732'', ''5a000000-0000-4000-8000-000000001704'', 100)'),
  'P0002', 'a WF admin still cannot record a payment on a Tenant B invoice');
select is(pg_temp.try('select public.app_refund_invoice(''8e000000-0000-4000-8000-000000001733'', ''5a000000-0000-4000-8000-000000001706'', 100, ''attack'')'),
  'P0002', 'a WF admin still cannot refund a Tenant B invoice');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.try('select public.app_refund_invoice(''8e000000-0000-4000-8000-000000001734'', ''5a000000-0000-4000-8000-000000001706'', 200, ''goodwill'')'),
  'ok', 'a Tenant B admin refunds its own paid invoice');
select is((select count(*) from public.invoice_refunds where invoice_id = '5a000000-0000-4000-8000-000000001706'),
  1::bigint, 'the Tenant B refund landed on the Tenant B invoice');

-- -----------------------------------------------------------------------------
-- Batteries: foreign, dual, archived, selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1701', '');
select is(pg_temp.battery('5a000000-0000-4000-8000-000000001704', '5a000000-0000-4000-8000-000000001703', 'e0000000-0000-4000-8000-000000001702'),
  'update:P0002 issue:P0002 void:P0002 fin:42501 create:P0002',
  'a WF admin fails every Tenant B invoice operation');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.battery('5a000000-0000-4000-8000-000000001702', '5a000000-0000-4000-8000-000000001701', 'e0000000-0000-4000-8000-000000001701'),
  'update:P0002 issue:P0002 void:P0002 fin:42501 create:P0002',
  'a Tenant B admin fails every Wolf Forge invoice operation');

select pg_temp.act('1705', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.try('select public.app_update_invoice(''5a000000-0000-4000-8000-000000001702'', ''{"billing_reason":"attack"}'' )'),
  'P0002', 'the dual owner under the Tenant B selector cannot update a WF invoice');

select pg_temp.act('1705', '');
select is(pg_temp.try('select public.app_update_invoice(''5a000000-0000-4000-8000-000000001704'', ''{"billing_reason":"attack"}'' )'),
  'P0002', 'the dual owner under the WF selector cannot update a Tenant B invoice');

select pg_temp.act('1706', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}');
select is(pg_temp.battery('5a000000-0000-4000-8000-000000001704', '5a000000-0000-4000-8000-000000001703', 'e0000000-0000-4000-8000-000000001702'),
  'update:42501 issue:42501 void:42501 fin:42501 create:42501',
  'an archived Tenant B membership cannot operate on invoices at all');

select pg_temp.act('1702', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001799"}');
select is(pg_temp.battery('5a000000-0000-4000-8000-000000001704', '5a000000-0000-4000-8000-000000001703', 'e0000000-0000-4000-8000-000000001702'),
  'update:42501 issue:42501 void:42501 fin:42501 create:42501',
  'a selector for a Tenant without membership fails every invoice operation closed');

select pg_temp.act('1702', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.battery('5a000000-0000-4000-8000-000000001704', '5a000000-0000-4000-8000-000000001703', 'e0000000-0000-4000-8000-000000001702'),
  'update:42501 issue:42501 void:42501 fin:42501 create:42501',
  'a malformed selector fails every invoice operation closed');

-- -----------------------------------------------------------------------------
-- Activity events stay in the victim-free, correct-Tenant shape
-- -----------------------------------------------------------------------------

select is(pg_temp.events_by('5a000000-0000-4000-8000-000000001703', '20000000-0000-0000-0000-000000001701'),
  0::bigint, 'no WF actor wrote a Tenant B invoice activity event');
select ok(pg_temp.events_by('5a000000-0000-4000-8000-000000001703', '20000000-0000-0000-0000-000000001702') > 0,
  'same-Tenant invoice operations still record activity');
select is(pg_temp.events_wrong_tenant('5a000000-0000-4000-8000-000000001703', 'f0f0f0f0-0000-4000-8000-000000001701'),
  0::bigint, 'every Tenant B invoice event carries the Tenant B Tenant');

-- -----------------------------------------------------------------------------
-- Wolf Forge regression
-- -----------------------------------------------------------------------------

select pg_temp.act('1701', '');
select is(pg_temp.trymsg('select public.app_update_invoice(''5a000000-0000-4000-8000-000000001702'', ''{"billing_reason":"subscription_update"}'' )'),
  'ok', 'a WF admin still updates a WF draft invoice');
select is(pg_temp.try('select public.app_issue_invoice(''5a000000-0000-4000-8000-000000001702'')'),
  'ok', 'a WF admin still issues a WF draft invoice');
select is(pg_temp.inv_issued('5a000000-0000-4000-8000-000000001702'), 'unpaid:true',
  'the WF issuance set status and number');
select is(pg_temp.try('select public.app_void_invoice(''5a000000-0000-4000-8000-000000001701'')'),
  'ok', 'a WF admin still voids a WF unsettled invoice');
select is((select presentation_state from public.app_get_invoice_financials('5a000000-0000-4000-8000-000000001701')),
  'void', 'WF financials still present the void state');

select throws_ok('update public.invoices set billing_reason = ''direct''', '42501', null,
  'authenticated still cannot update invoices directly');

select * from finish();
rollback;
