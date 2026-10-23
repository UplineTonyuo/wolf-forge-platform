begin;

select plan(44);

-- WL-2.12 (KI-111 coupon portion + KI-109 coupon remainder): coupon
-- administration, code lookup, quoting and redemption are Tenant-bound; a
-- foreign code behaves exactly like a nonexistent one.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001801.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1801 WF admin; 1802 B admin (no WF membership); 1803 WF client; 1804 B
-- client; 1805 owner of both; 1806 B admin with an archived B membership (no
-- WF membership); 1807 WF owner (no B membership).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'coupon-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1801', '1802', '1803', '1804', '1805', '1806', '1807']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001801', 'coupon-authz-tenant-b', 'Coupon Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e0000000-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'COUPON_WF_CLIENT', 'client'),
  ('e0000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801', 'COUPON_B_CLIENT', 'client');

update public.company_wallets set balance_cents = 100000
where company_id = 'e0000000-0000-4000-8000-000000001802';

insert into public.services (id, tenant_id, name, price, currency, is_active, is_public, recurring, sort_order)
values
  ('5b000000-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'COUPON_WF_SERVICE', 100.00, 'USD', true, true, false, 0),
  ('5b000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801', 'COUPON_B_SERVICE', 100.00, 'USD', true, true, false, 0);

insert into public.coupons (
  id, tenant_id, code, description, discount_type, recurring_duration,
  single_use_per_customer, new_customers_only, expires_at, minimum_cart_amount,
  is_active, created_by_profile_id, updated_by_profile_id
)
values
  ('c0000000-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'WFAUTHZ10', null, 'fixed', 'forever', false, false, null, null, true, '20000000-0000-0000-0000-000000001801', '20000000-0000-0000-0000-000000001801'),
  ('c0000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801', 'BAUTHZ10', null, 'fixed', 'forever', false, false, null, null, true, '20000000-0000-0000-0000-000000001802', '20000000-0000-0000-0000-000000001802'),
  ('c0000000-0000-4000-8000-000000001803', 'f0f0f0f0-0000-4000-8000-000000001801', 'BSINGLE10', null, 'fixed', 'forever', true, false, null, null, true, '20000000-0000-0000-0000-000000001802', '20000000-0000-0000-0000-000000001802'),
  ('c0000000-0000-4000-8000-000000001804', 'f0f0f0f0-0000-4000-8000-000000001801', 'BSPARE10', null, 'fixed', 'forever', false, false, null, null, true, '20000000-0000-0000-0000-000000001802', '20000000-0000-0000-0000-000000001802');

insert into public.coupon_discount_rules (coupon_id, discount_value, applies_to_all, sort_order)
values
  ('c0000000-0000-4000-8000-000000001801', 10, true, 0),
  ('c0000000-0000-4000-8000-000000001802', 10, true, 0),
  ('c0000000-0000-4000-8000-000000001803', 10, true, 0),
  ('c0000000-0000-4000-8000-000000001804', 10, true, 0);

insert into public.invoices (
  id, tenant_id, company_id, status, currency, invoice_number,
  billing_reason, issued_at, due_at, subtotal_cents, discount_total_cents,
  tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id
)
values
  ('5a000000-0000-4000-8000-000000001801', 'f0f0f0f0-0000-4000-8000-000000001801', 'e0000000-0000-4000-8000-000000001802', 'draft', 'USD', null, 'manual', null, now() + interval '7 days', 10000, 0, 0, 10000, '20000000-0000-0000-0000-000000001802', '20000000-0000-0000-0000-000000001802');

insert into public.invoice_items (
  invoice_id, service_id, position, name, quantity, unit_price_cents,
  unit_discount_cents, is_taxable, fulfillment_status
)
values
  ('5a000000-0000-4000-8000-000000001801', '5b000000-0000-4000-8000-000000001802', 0, 'B line', 1, 10000, 0, false, 'awaiting_payment');

update public.invoices
set status = 'unpaid', invoice_number = 9801, issued_at = now()
where id = '5a000000-0000-4000-8000-000000001801';

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001801', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001802', 'admin', null, null),
  ('20000000-0000-0000-0000-000000001803', 'client', null, 'e0000000-0000-4000-8000-000000001801'),
  ('20000000-0000-0000-0000-000000001804', 'client', null, null),
  ('20000000-0000-0000-0000-000000001805', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001806', 'admin', null, null),
  ('20000000-0000-0000-0000-000000001807', 'owner', null, null)
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

-- B-only users hold no Wolf Forge membership at all.
delete from public.tenant_memberships as membership_row
where membership_row.tenant_id = private.wolf_forge_tenant_id()
  and membership_row.profile_id in (
    '20000000-0000-0000-0000-000000001802',
    '20000000-0000-0000-0000-000000001806'
  );

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001801', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001802', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001804', 'client', 'client', 'e0000000-0000-4000-8000-000000001802', null),
  ('20000000-0000-0000-0000-000000001805', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001806', 'admin', 'internal', null, now())
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

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

-- Archive and update against one coupon with a valid attack payload.
create function pg_temp.battery(p_coupon text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'archive:' || pg_temp.try(format('select public.app_archive_coupon(%L)', p_coupon)),
    'update:' || pg_temp.try(format('select public.app_update_coupon(%L, %L::jsonb)', p_coupon,
      '{"code":"ATTACKX10","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":true,"service_ids":[]}]}'))
  );
end;
$$;

-- Definitive readbacks (security definer).
create function pg_temp.coupon_state(p_id text)
returns text
language sql
security definer
as $$
  select code || ':' || (archived_at is not null)::text || ':' || is_active::text
  from public.coupons where id = p_id::uuid;
$$;

create function pg_temp.redemptions_for(p_coupon text)
returns bigint
language sql
security definer
as $$
  select count(*) from public.coupon_redemptions where coupon_id = p_coupon::uuid;
$$;

create function pg_temp.balance(p_company text)
returns bigint
language sql
security definer
as $$
  select balance_cents from public.company_wallets where company_id = p_company::uuid;
$$;

create function pg_temp.inv_status(p_id text)
returns text
language sql
security definer
as $$
  select status from public.invoices where id = p_id::uuid;
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

create function pg_temp.visible()
returns text
language sql
as $$
  select coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.coupons
      where id::text like 'c0000000-0000-4000-8000-00000000180%'), '-')
    || ' | ' || coalesce((select string_agg(right(coupon_id::text, 4), ' ' order by coupon_id) from public.coupon_discount_rules
      where coupon_id::text like 'c0000000-0000-4000-8000-00000000180%'), '-');
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.battery(text), pg_temp.coupon_state(text),
  pg_temp.redemptions_for(text), pg_temp.balance(text), pg_temp.inv_status(text),
  pg_temp.events_by(text, text), pg_temp.events_wrong_tenant(text, text), pg_temp.visible(),
  pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads (coupon, rule and redemption RLS)
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is(pg_temp.visible(), '1801 | 1801', 'a WF admin reads only Wolf Forge coupons and their rules');
select is((select count(*) from public.coupon_redemptions), 0::bigint, 'no redemptions are visible yet');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.visible(), '1802 1803 1804 | 1802 1803 1804', 'a Tenant B admin reads only Tenant B coupons and their rules');

-- -----------------------------------------------------------------------------
-- Code lookup isolation: a foreign code reads exactly like a nonexistent one
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is(
  public.app_validate_coupon('BAUTHZ10', jsonb_build_array(jsonb_build_object('service_id', '5b000000-0000-4000-8000-000000001801', 'quantity', 1, 'unit_amount', 100, 'billing_context', 'one_time')), 100),
  public.app_validate_coupon('NOPE999NOPE', jsonb_build_array(jsonb_build_object('service_id', '5b000000-0000-4000-8000-000000001801', 'quantity', 1, 'unit_amount', 100, 'billing_context', 'one_time')), 100),
  'a Tenant B code is indistinguishable from a nonexistent code for a WF admin');
select is((public.app_validate_coupon('WFAUTHZ10', jsonb_build_array(jsonb_build_object('service_id', '5b000000-0000-4000-8000-000000001801', 'quantity', 1, 'unit_amount', 100, 'billing_context', 'one_time')), 100) ->> 'discount_amount')::numeric,
  10.00, 'the WF admin validates the WF code normally');

select pg_temp.act('1803', '');
select is((public.app_quote_store_coupon('5b000000-0000-4000-8000-000000001801', 'BAUTHZ10') ->> 'failure_code'),
  'INVALID_CODE', 'a WF client quoting a Tenant B code gets the nonexistent-code answer');
select is((public.app_quote_store_coupon('5b000000-0000-4000-8000-000000001801', 'WFAUTHZ10') ->> 'valid'),
  'true', 'a WF client quotes its own code normally');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(
  public.app_validate_coupon('WFAUTHZ10', jsonb_build_array(jsonb_build_object('service_id', '5b000000-0000-4000-8000-000000001802', 'quantity', 1, 'unit_amount', 100, 'billing_context', 'one_time')), 100),
  public.app_validate_coupon('NOPE999NOPE', jsonb_build_array(jsonb_build_object('service_id', '5b000000-0000-4000-8000-000000001802', 'quantity', 1, 'unit_amount', 100, 'billing_context', 'one_time')), 100),
  'a Wolf Forge code is indistinguishable from a nonexistent code for a Tenant B admin');

select pg_temp.act('1804', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is((public.app_quote_store_coupon('5b000000-0000-4000-8000-000000001802', 'WFAUTHZ10') ->> 'failure_code'),
  'INVALID_CODE', 'a Tenant B client quoting a WF code gets the nonexistent-code answer');

-- -----------------------------------------------------------------------------
-- Archive / update fail closed across Tenants
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is(pg_temp.try('select public.app_archive_coupon(''c0000000-0000-4000-8000-000000001802'')'),
  'P0002', 'a WF admin cannot archive a Tenant B coupon');
select is(pg_temp.coupon_state('c0000000-0000-4000-8000-000000001802'), 'BAUTHZ10:false:true',
  'the Tenant B coupon is unchanged after the foreign archive');
select is(pg_temp.try('select public.app_update_coupon(''c0000000-0000-4000-8000-000000001804'', ''{"code":"BSPARE10","description":"attack","discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":true,"service_ids":[]}]}'' )'),
  'P0002', 'a WF admin cannot update a Tenant B coupon');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.coupon_state('c0000000-0000-4000-8000-000000001804'), 'BSPARE10:false:true',
  'the Tenant B coupon is unchanged after the foreign update');
select is(pg_temp.try('select public.app_update_coupon(''c0000000-0000-4000-8000-000000001804'', ''{"code":"BSPARE10","description":"own","discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":true,"service_ids":[]}]}'' )'),
  'ok', 'a Tenant B admin updates its own coupon');

-- -----------------------------------------------------------------------------
-- Create: tenant relationships stay inside one Tenant, replays stay bound
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is(pg_temp.try(
    $$select public.app_create_coupon(gen_random_uuid(), '{"code":"WFCROSS10","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":false,"service_ids":["5b000000-0000-4000-8000-000000001802"]}]}'::jsonb)$$),
  '23514', 'a WF-created coupon cannot discount a Tenant B Service');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try(
    $$select public.app_create_coupon(gen_random_uuid(), '{"code":"BCROSS10","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":false,"service_ids":["5b000000-0000-4000-8000-000000001801"]}]}'::jsonb)$$),
  '23514', 'a Tenant B-created coupon cannot discount a WF Service');
select is((select tenant_id from public.app_create_coupon('8e000000-0000-4000-8000-000000001821', '{"code":"BOWN10","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":false,"service_ids":["5b000000-0000-4000-8000-000000001802"]}]}'::jsonb)),
  'f0f0f0f0-0000-4000-8000-000000001801'::uuid, 'a Tenant B admin creation lands in Tenant B');

select pg_temp.act('1805', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try(
    $$select public.app_create_coupon('8e000000-0000-4000-8000-000000001831', '{"code":"BOWN11","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":false,"service_ids":["5b000000-0000-4000-8000-000000001802"]}]}'::jsonb)$$),
  'ok', 'the dual owner creates a Tenant B coupon under the Tenant B selector');
select pg_temp.act('1805', '');
select is(pg_temp.try(
    $$select public.app_create_coupon('8e000000-0000-4000-8000-000000001831', '{"code":"BOWN11","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":false,"service_ids":["5b000000-0000-4000-8000-000000001802"]}]}'::jsonb)$$),
  'P0002', 'a create replay is not answered under another Tenant selector');

-- -----------------------------------------------------------------------------
-- Purchase and redemption (KI-109 coupon remainder)
-- -----------------------------------------------------------------------------

select pg_temp.act('1804', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001822'', ''5b000000-0000-4000-8000-000000001802'', ''BSINGLE10'')'),
  'ok', 'a Tenant B client purchases with a Tenant B coupon');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001802'), 91000::bigint,
  'the Tenant B wallet debited the discounted price');
select is(pg_temp.try('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001823'', ''5b000000-0000-4000-8000-000000001802'', ''BSINGLE10'')'),
  'P0001', 'the single-use Tenant B coupon refuses a second redemption');
select is(pg_temp.try('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001824'', ''5b000000-0000-4000-8000-000000001802'', ''WFAUTHZ10'')'),
  'P0001', 'a Tenant B client cannot redeem a WF code');
select is(pg_temp.try('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001825'', ''5b000000-0000-4000-8000-000000001801'', ''BAUTHZ10'')'),
  '42501', 'a Tenant B client cannot purchase a WF Service with a Tenant B coupon');

select pg_temp.act('1801', '');
select is((select count(*) from public.coupon_redemptions where coupon_id = 'c0000000-0000-4000-8000-000000001803'), 0::bigint,
  'a WF admin cannot see the Tenant B redemption');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.redemptions_for('c0000000-0000-4000-8000-000000001803'), 1::bigint,
  'the Tenant B admin sees the Tenant B redemption');
select is((select count(*) from public.coupon_redemptions), 1::bigint,
  'the Tenant B redemption list stays Tenant-bound');

-- -----------------------------------------------------------------------------
-- Wallet invoice payment with a coupon stays inside the Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1804', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001826'', ''5a000000-0000-4000-8000-000000001801'', ''BAUTHZ10'')'),
  'ok', 'a Tenant B client pays its own invoice with a Tenant B coupon');
select is(pg_temp.inv_status('5a000000-0000-4000-8000-000000001801'), 'paid',
  'the discounted payment settled the Tenant B invoice');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001802'), 82000::bigint,
  'the Tenant B wallet debited exactly the discounted amount');

-- -----------------------------------------------------------------------------
-- Owner, dual-owner, archived and selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1807', '');
select is(pg_temp.try('select public.app_archive_coupon(''c0000000-0000-4000-8000-000000001803'')'),
  'P0002', 'a WF owner cannot archive a Tenant B coupon');

select pg_temp.act('1805', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.battery('c0000000-0000-4000-8000-000000001801'), 'archive:P0002 update:P0002',
  'the dual owner under the Tenant B selector cannot touch a WF coupon');
select pg_temp.act('1805', '');
select is(pg_temp.battery('c0000000-0000-4000-8000-000000001803'), 'archive:P0002 update:P0002',
  'the dual owner under the WF selector cannot touch a Tenant B coupon');

select pg_temp.act('1806', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.battery('c0000000-0000-4000-8000-000000001803'), 'archive:42501 update:42501',
  'an archived Tenant B membership cannot operate on coupons');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001899"}');
select is(pg_temp.battery('c0000000-0000-4000-8000-000000001803'), 'archive:42501 update:42501',
  'a selector for a Tenant without membership fails coupon operations closed');

select pg_temp.act('1802', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.battery('c0000000-0000-4000-8000-000000001803'), 'archive:42501 update:42501',
  'a malformed selector fails coupon operations closed');

-- -----------------------------------------------------------------------------
-- Activity events
-- -----------------------------------------------------------------------------

select is(pg_temp.events_by('c0000000-0000-4000-8000-000000001803', '20000000-0000-0000-0000-000000001801'),
  0::bigint, 'no WF actor wrote a Tenant B coupon activity event');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try('select public.app_archive_coupon(''c0000000-0000-4000-8000-000000001802'')'),
  'ok', 'a Tenant B admin archives its own coupon');
select ok(pg_temp.events_by('c0000000-0000-4000-8000-000000001802', '20000000-0000-0000-0000-000000001802') > 0,
  'same-Tenant coupon operations record activity');
select is(pg_temp.events_wrong_tenant('c0000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801'),
  0::bigint, 'every Tenant B coupon event carries the Tenant B Tenant');

-- -----------------------------------------------------------------------------
-- Wolf Forge regression
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is((select tenant_id from public.app_create_coupon('8e000000-0000-4000-8000-000000001832', '{"code":"WFAUTHZ11","description":null,"discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":false,"new_customers_only":false,"expires_at":null,"minimum_cart_amount":null,"is_active":true,"rules":[{"discount_value":10,"applies_to_all":false,"service_ids":["5b000000-0000-4000-8000-000000001801"]}]}'::jsonb)),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid, 'a WF admin creates a WF coupon');
select is(pg_temp.try('select public.app_archive_coupon(''c0000000-0000-4000-8000-000000001801'')'),
  'ok', 'a WF admin still archives a WF coupon');
select is(pg_temp.coupon_state('c0000000-0000-4000-8000-000000001801'), 'WFAUTHZ10:true:false',
  'the WF coupon archive persisted');

select throws_ok('update public.coupons set is_active = false', '42501', null,
  'authenticated still cannot update coupons directly');

select * from finish();
rollback;
