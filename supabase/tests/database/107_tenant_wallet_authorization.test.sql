begin;

select plan(80);

-- WL-2.10 (KI-111 money + KI-109 wallet / payment portion): wallet, WF Card
-- and invoice-money operations require the target to belong to the caller's
-- current Tenant, and portal money flows resolve the Client from the
-- current-Tenant membership instead of the global profiles.company_id.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001601.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1601 WF admin; 1602 B admin (no WF membership); 1603 WF owner; 1604 B owner
-- (no WF membership); 1605 owner of both; 1606 B admin with an archived B
-- membership (no WF membership); 1607 WF client; 1608 B client (no global
-- company); 1609 client of both Tenants.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'wallet-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1601', '1602', '1603', '1604', '1605', '1606', '1607', '1608', '1609']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001601', 'wallet-authz-tenant-b', 'Wallet Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e0000000-0000-4000-8000-000000001601', private.wolf_forge_tenant_id(), 'WALLET_WF_CLIENT', 'client'),
  ('e0000000-0000-4000-8000-000000001602', 'f0f0f0f0-0000-4000-8000-000000001601', 'WALLET_B_CLIENT', 'client');

update public.company_wallets
set balance_cents = case company_id
  when 'e0000000-0000-4000-8000-000000001601' then 100000
  else 200000
end
where company_id in ('e0000000-0000-4000-8000-000000001601', 'e0000000-0000-4000-8000-000000001602');

insert into public.wf_card_memberships (
  company_id, status, activated_at, purchase_price_cents, purchase_currency, purchase_reference
)
values
  ('e0000000-0000-4000-8000-000000001601', 'active', now(), 25900, 'USD', 'wallet-authz-wf'),
  ('e0000000-0000-4000-8000-000000001602', 'active', now(), 25900, 'USD', 'wallet-authz-b');

insert into public.invoices (
  id, tenant_id, company_id, client_profile_id, status, currency, invoice_number,
  billing_reason, issued_at, due_at, subtotal_cents, discount_total_cents,
  tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id
)
values
  ('4a000000-0000-4000-8000-000000001601', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001601', null, 'unpaid', 'USD', 9601, 'manual', now(), now() + interval '7 days', 30000, 0, 0, 30000, '20000000-0000-0000-0000-000000001601', '20000000-0000-0000-0000-000000001601'),
  ('4a000000-0000-4000-8000-000000001602', 'f0f0f0f0-0000-4000-8000-000000001601', 'e0000000-0000-4000-8000-000000001602', null, 'unpaid', 'USD', 9602, 'manual', now(), now() + interval '7 days', 40000, 0, 0, 40000, '20000000-0000-0000-0000-000000001602', '20000000-0000-0000-0000-000000001602'),
  ('4a000000-0000-4000-8000-000000001603', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001601', null, 'unpaid', 'USD', 9603, 'manual', now(), now() + interval '7 days', 10000, 0, 0, 10000, '20000000-0000-0000-0000-000000001601', '20000000-0000-0000-0000-000000001601'),
  ('4a000000-0000-4000-8000-000000001604', 'f0f0f0f0-0000-4000-8000-000000001601', 'e0000000-0000-4000-8000-000000001602', null, 'unpaid', 'USD', 9604, 'manual', now(), now() + interval '7 days', 5000, 0, 0, 5000, '20000000-0000-0000-0000-000000001602', '20000000-0000-0000-0000-000000001602'),
  ('4a000000-0000-4000-8000-000000001605', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001601', null, 'paid', 'USD', 9605, 'manual', now(), now() + interval '7 days', 500, 0, 0, 500, '20000000-0000-0000-0000-000000001601', '20000000-0000-0000-0000-000000001601'),
  ('4a000000-0000-4000-8000-000000001606', 'f0f0f0f0-0000-4000-8000-000000001601', 'e0000000-0000-4000-8000-000000001602', null, 'unpaid', 'USD', 9606, 'manual', now(), now() + interval '7 days', 3000, 0, 0, 3000, '20000000-0000-0000-0000-000000001602', '20000000-0000-0000-0000-000000001602'),
  ('4a000000-0000-4000-8000-000000001607', 'f0f0f0f0-0000-4000-8000-000000001601', 'e0000000-0000-4000-8000-000000001602', null, 'paid', 'USD', 9607, 'manual', now(), now() + interval '7 days', 500, 0, 0, 500, '20000000-0000-0000-0000-000000001602', '20000000-0000-0000-0000-000000001602');

insert into public.invoice_payments (
  id, invoice_id, amount_cents, currency, status, payment_method, settled_at,
  request_id, created_by_profile_id
)
values
  ('7d000000-0000-4000-8000-000000001601', '4a000000-0000-4000-8000-000000001605', 500, 'USD', 'succeeded', 'manual', now(),
   '8e000000-0000-4000-8000-000000001601', '20000000-0000-0000-0000-000000001601'),
  ('7d000000-0000-4000-8000-000000001602', '4a000000-0000-4000-8000-000000001607', 500, 'USD', 'succeeded', 'manual', now(),
   '8e000000-0000-4000-8000-000000001602', '20000000-0000-0000-0000-000000001602');

insert into public.invoice_refunds (
  id, invoice_id, invoice_payment_id, amount_cents, currency, reason, status,
  refunded_at, request_id, created_by_profile_id
)
values
  ('9f000000-0000-4000-8000-000000001601', '4a000000-0000-4000-8000-000000001605', '7d000000-0000-4000-8000-000000001601',
   100, 'USD', 'fixture refund', 'succeeded', now(), '8e000000-0000-4000-8000-000000001603', '20000000-0000-0000-0000-000000001601'),
  ('9f000000-0000-4000-8000-000000001602', '4a000000-0000-4000-8000-000000001607', '7d000000-0000-4000-8000-000000001602',
   100, 'USD', 'fixture refund', 'succeeded', now(), '8e000000-0000-4000-8000-000000001604', '20000000-0000-0000-0000-000000001602');

insert into public.services (id, tenant_id, name, price, currency, is_active, is_public, recurring, sort_order)
values
  ('5b000000-0000-4000-8000-000000001601', private.wolf_forge_tenant_id(), 'WALLET_WF_SERVICE', 50.00, 'USD', true, true, false, 0),
  ('5b000000-0000-4000-8000-000000001602', 'f0f0f0f0-0000-4000-8000-000000001601', 'WALLET_B_SERVICE', 60.00, 'USD', true, true, false, 0);

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001601', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001602', 'admin', null, null),
  ('20000000-0000-0000-0000-000000001603', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001604', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001605', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001606', 'admin', null, null),
  ('20000000-0000-0000-0000-000000001607', 'client', null, 'e0000000-0000-4000-8000-000000001601'),
  ('20000000-0000-0000-0000-000000001608', 'client', null, null),
  ('20000000-0000-0000-0000-000000001609', 'client', null, 'e0000000-0000-4000-8000-000000001601')
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

-- B-only users hold no Wolf Forge membership at all (the model a real Tenant B
-- user will have once D-275 replaces the universal Wolf Forge auto-membership).
delete from public.tenant_memberships as membership_row
where membership_row.tenant_id = private.wolf_forge_tenant_id()
  and membership_row.profile_id in (
    '20000000-0000-0000-0000-000000001602',
    '20000000-0000-0000-0000-000000001604',
    '20000000-0000-0000-0000-000000001606'
  );

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001601', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001602', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001604', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001605', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001606', 'admin', 'internal', null, now()),
  ('20000000-0000-0000-0000-000000001608', 'client', 'client', 'e0000000-0000-4000-8000-000000001602', null),
  ('20000000-0000-0000-0000-000000001609', 'client', 'client', 'e0000000-0000-4000-8000-000000001602', null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- Runs one statement and returns 'ok', its SQLSTATE, or SQLSTATE plus message.
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

-- Every id-based money operation against one Client and one of its invoices.
-- The operation set used for foreign attacks and for archived / selector
-- callers; all are expected to fail closed.
create function pg_temp.battery(p_company text, p_invoice text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'adjust:' || pg_temp.try(format('select public.app_adjust_company_balance(gen_random_uuid(), %L, 100, %L)', p_company, 'attack')),
    'wallet:' || pg_temp.try(format('select public.app_get_company_wallet(%L)', p_company)),
    'stripe:' || pg_temp.try(format('select public.app_link_company_stripe_customer(%L, %L)', p_company, 'cus_Attack')),
    'card:' || pg_temp.try(format('select public.app_set_wf_card_membership(gen_random_uuid(), %L, true)', p_company)),
    'record:' || pg_temp.try(format('select public.app_record_invoice_payment(gen_random_uuid(), %L, 100)', p_invoice))
  );
end;
$$;

-- Security-definer readbacks of fixture money state.
create function pg_temp.balance(p_company text)
returns bigint
language sql
security definer
as $$
  select balance_cents from public.company_wallets where company_id = p_company::uuid;
$$;

create function pg_temp.wallet_tx_count(p_company text)
returns bigint
language sql
security definer
as $$
  select count(*) from public.company_wallet_transactions where company_id = p_company::uuid;
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

create function pg_temp.last_order_company(p_company text)
returns uuid
language sql
security definer
as $$
  select company_id from public.orders
  where company_id = p_company::uuid
  order by order_number desc
  limit 1;
$$;

create function pg_temp.cards_visible()
returns text
language sql
as $$
  select coalesce(string_agg(right(company_id::text, 4), ' ' order by company_id), '-')
  from public.wf_card_memberships
  where company_id::text like 'e0000000-0000-4000-8000-00000000160%';
$$;

create function pg_temp.payments_visible()
returns text
language sql
as $$
  select coalesce(string_agg(right(invoice_id::text, 4), ' ' order by invoice_id), '-')
  from public.invoice_payments
  where invoice_id::text like '4a000000-0000-4000-8000-00000000160%';
$$;

create function pg_temp.refunds_visible()
returns text
language sql
as $$
  select coalesce(string_agg(right(invoice_id::text, 4), ' ' order by invoice_id), '-')
  from public.invoice_refunds
  where invoice_id::text like '4a000000-0000-4000-8000-00000000160%';
$$;

create function pg_temp.wallet_list()
returns text
language sql
as $$
  select coalesce(string_agg(distinct right(company_id::text, 4) || ':' || reason, ' ' order by right(company_id::text, 4) || ':' || reason), '-')
  from public.app_list_recent_company_wallet_transactions(50)
  where company_id::text like 'e0000000-0000-4000-8000-00000000160%';
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.trymsg(text), pg_temp.battery(text, text), pg_temp.balance(text),
  pg_temp.wallet_tx_count(text), pg_temp.events_by(text, text), pg_temp.events_wrong_tenant(text, text),
  pg_temp.last_order_company(text),
  pg_temp.cards_visible(), pg_temp.payments_visible(), pg_temp.refunds_visible(), pg_temp.wallet_list(),
  pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Money tables are RPC-only to the browser
-- -----------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.company_wallets', 'SELECT')
    and not has_table_privilege('authenticated', 'public.company_wallets', 'UPDATE'),
  'the browser role holds no direct wallet table access'
);
select ok(
  not has_table_privilege('authenticated', 'public.company_wallet_transactions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.company_wallet_transactions', 'INSERT'),
  'the browser role holds no direct wallet ledger access'
);
select throws_ok('select * from public.company_wallets', '42501', null,
  'authenticated cannot read wallet balances directly');
select throws_ok('select * from public.company_wallet_transactions', '42501', null,
  'authenticated cannot read the wallet ledger directly');

-- -----------------------------------------------------------------------------
-- Direct RLS reads on money tables that do grant SELECT
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select is(pg_temp.cards_visible(), '1601', 'a WF admin reads only WF card memberships');
select is(pg_temp.payments_visible(), '1605', 'a WF admin reads only WF invoice payments');
select is(pg_temp.refunds_visible(), '1605', 'a WF admin reads only WF invoice refunds');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.cards_visible(), '1602', 'a Tenant B admin reads only Tenant B card memberships');
select is(pg_temp.payments_visible(), '1607', 'a Tenant B admin reads only Tenant B invoice payments');
select is(pg_temp.refunds_visible(), '1607', 'a Tenant B admin reads only Tenant B invoice refunds');

select pg_temp.act('1608', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.cards_visible(), '1602', 'a Tenant B portal client reads only its own card membership');
select is((select count(*) from public.invoice_payments where invoice_id::text like '4a000000-0000-4000-8000-00000000160%'),
  0::bigint, 'a portal client reads no invoice payments');

-- -----------------------------------------------------------------------------
-- Wallet reads: the balance never crosses a Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_get_company_wallet(''e0000000-0000-4000-8000-000000001602'')'),
  '42501', 'a WF admin cannot read a Tenant B wallet');
select is((select balance_cents from public.app_get_company_wallet('e0000000-0000-4000-8000-000000001601')),
  100000::bigint, 'a WF admin reads the WF wallet balance');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_get_company_wallet(''e0000000-0000-4000-8000-000000001601'')'),
  '42501', 'a Tenant B admin cannot read a WF wallet');
select is((select balance_cents from public.app_get_company_wallet('e0000000-0000-4000-8000-000000001602')),
  200000::bigint, 'a Tenant B admin reads the Tenant B wallet balance');

select pg_temp.act('1607', '');
select is((select balance_cents from public.app_get_company_wallet('e0000000-0000-4000-8000-000000001601')),
  100000::bigint, 'a WF portal client reads its own wallet');
select is((select company_id from public.app_get_client_account_context()),
  'e0000000-0000-4000-8000-000000001601'::uuid, 'a WF portal client resolves its account context unchanged');

select pg_temp.act('1608', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is((select balance_cents from public.app_get_company_wallet('e0000000-0000-4000-8000-000000001602')),
  200000::bigint, 'a Tenant B portal client reads its own wallet through its membership');
select is(pg_temp.try('select public.app_get_company_wallet(''e0000000-0000-4000-8000-000000001601'')'),
  '42501', 'a Tenant B portal client cannot read a WF wallet');
select is((select company_id from public.app_get_client_account_context()),
  'e0000000-0000-4000-8000-000000001602'::uuid, 'a Tenant B portal client resolves its account context from its membership');

-- -----------------------------------------------------------------------------
-- Balance mutations fail closed across Tenants
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_adjust_company_balance(gen_random_uuid(), ''e0000000-0000-4000-8000-000000001602'', 100, ''attack'')'),
  'P0002', 'a WF admin cannot adjust a Tenant B balance');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 200000::bigint,
  'the Tenant B balance is unchanged after the foreign adjustment');
select is(pg_temp.wallet_tx_count('e0000000-0000-4000-8000-000000001602'), 0::bigint,
  'no Tenant B ledger row was written');
select is(pg_temp.events_by('e0000000-0000-4000-8000-000000001602', '20000000-0000-0000-0000-000000001601'),
  0::bigint, 'no Tenant B activity event names the foreign actor');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_adjust_company_balance(gen_random_uuid(), ''e0000000-0000-4000-8000-000000001601'', 100, ''attack'')'),
  'P0002', 'a Tenant B admin cannot adjust a WF balance');
select is(pg_temp.try('select public.app_adjust_company_balance(''8e000000-0000-4000-8000-000000001605'', ''e0000000-0000-4000-8000-000000001602'', 500, ''credit'')'),
  'ok', 'a Tenant B admin adjusts its own Client balance');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 200500::bigint,
  'the Tenant B adjustment landed on the Tenant B wallet');
select is(pg_temp.wallet_tx_count('e0000000-0000-4000-8000-000000001602'), 1::bigint,
  'exactly one Tenant B ledger row exists');

select pg_temp.act('1605', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_adjust_company_balance(gen_random_uuid(), ''e0000000-0000-4000-8000-000000001601'', 100, ''attack'')'),
  'P0002', 'the dual owner under the Tenant B selector cannot adjust a WF balance');
select pg_temp.act('1605', '');
select is(pg_temp.try('select public.app_adjust_company_balance(gen_random_uuid(), ''e0000000-0000-4000-8000-000000001602'', 100, ''attack'')'),
  'P0002', 'the dual owner under the Wolf Forge selector cannot adjust a Tenant B balance');

-- -----------------------------------------------------------------------------
-- WF Card membership changes fail closed across Tenants
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_set_wf_card_membership(gen_random_uuid(), ''e0000000-0000-4000-8000-000000001602'', true)'),
  '23503', 'a WF admin cannot change a Tenant B card membership');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_set_wf_card_membership(gen_random_uuid(), ''e0000000-0000-4000-8000-000000001601'', true)'),
  '23503', 'a Tenant B admin cannot change a WF card membership');
select is(pg_temp.try('select public.app_set_wf_card_membership(''8e000000-0000-4000-8000-000000001606'', ''e0000000-0000-4000-8000-000000001602'', false)'),
  'ok', 'a Tenant B admin deactivates its own card membership');
select is((select status from public.wf_card_memberships where company_id = 'e0000000-0000-4000-8000-000000001602'),
  'cancelled', 'the Tenant B membership status changed inside its own Tenant');

select pg_temp.act('1605', '');
select is(pg_temp.try('select public.app_set_wf_card_membership(''8e000000-0000-4000-8000-000000001607'', ''e0000000-0000-4000-8000-000000001601'', true)'),
  'ok', 'the dual owner activates a WF membership under the Wolf Forge selector');
select pg_temp.act('1605', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_set_wf_card_membership(''8e000000-0000-4000-8000-000000001607'', ''e0000000-0000-4000-8000-000000001601'', true)'),
  '23503', 'a card membership replay under another Tenant selector fails closed like a missing company');

-- -----------------------------------------------------------------------------
-- Stripe customer link
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_link_company_stripe_customer(''e0000000-0000-4000-8000-000000001602'', ''cus_AttackB'')'),
  '42501', 'a WF admin cannot link a Tenant B company to a Stripe customer');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_link_company_stripe_customer(''e0000000-0000-4000-8000-000000001601'', ''cus_AttackWf'')'),
  '42501', 'a Tenant B admin cannot link a WF company to a Stripe customer');
select is(public.app_link_company_stripe_customer('e0000000-0000-4000-8000-000000001602', 'cus_WalletB'),
  'cus_WalletB', 'a Tenant B admin links its own company');

-- -----------------------------------------------------------------------------
-- Wallet ledger listing
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select ok(pg_temp.wallet_list() not like '%1602%',
  'the WF wallet ledger listing never shows a Tenant B movement');
select ok(pg_temp.wallet_list() like '%1601%' or pg_temp.wallet_list() = '-',
  'the WF wallet ledger listing stays limited to Wolf Forge rows');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select ok(pg_temp.wallet_list() not like '%1601%',
  'the Tenant B wallet ledger listing never shows a Wolf Forge movement');
select ok(pg_temp.wallet_list() like '%1602%',
  'the Tenant B wallet ledger listing keeps the Tenant B movement');

-- -----------------------------------------------------------------------------
-- Wallet invoice payment (portal)
-- -----------------------------------------------------------------------------

select pg_temp.act('1607', '');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001611'', ''4a000000-0000-4000-8000-000000001601'')'),
  'ok', 'a WF client pays a WF invoice from the wallet');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001601'), 70000::bigint,
  'the WF wallet debited exactly the invoice total');

select pg_temp.act('1608', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001612'', ''4a000000-0000-4000-8000-000000001602'')'),
  'ok', 'a Tenant B client pays a Tenant B invoice through its membership');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 160500::bigint,
  'the Tenant B wallet debited exactly the invoice total');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001613'', ''4a000000-0000-4000-8000-000000001603'')'),
  '42501', 'a Tenant B client cannot pay a WF invoice');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001612'', ''4a000000-0000-4000-8000-000000001602'')'),
  'ok', 'a Tenant B client replay of an idempotent request stays answered');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 160500::bigint,
  'the replay moved no additional money');

select pg_temp.act('1607', '');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001614'', ''4a000000-0000-4000-8000-000000001604'')'),
  '42501', 'a WF client cannot pay a Tenant B invoice');

select pg_temp.act('1609', '');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001615'', ''4a000000-0000-4000-8000-000000001603'')'),
  'ok', 'the dual client under the WF selector pays a WF invoice');
select pg_temp.act('1609', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select * from public.app_pay_invoice_with_wallet(''8e000000-0000-4000-8000-000000001616'', ''4a000000-0000-4000-8000-000000001604'')'),
  'ok', 'the dual client under the Tenant B selector pays a Tenant B invoice');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001601'), 60000::bigint,
  'the WF wallet reflects only the WF-selector payments');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 155500::bigint,
  'the Tenant B wallet reflects only the Tenant B-selector payments');

-- -----------------------------------------------------------------------------
-- Store purchase (portal)
-- -----------------------------------------------------------------------------

select pg_temp.act('1608', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.trymsg('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001621'', ''5b000000-0000-4000-8000-000000001602'')'),
  'ok', 'a Tenant B client purchases a Tenant B service');
select is(pg_temp.last_order_company('e0000000-0000-4000-8000-000000001602'),
  'e0000000-0000-4000-8000-000000001602'::uuid, 'the purchase provisioned to the caller''s own Tenant B Client');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 149500::bigint,
  'the Tenant B wallet debited exactly the service price');
select is(pg_temp.try('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001622'', ''5b000000-0000-4000-8000-000000001601'')'),
  '42501', 'a Tenant B client cannot purchase a WF service');
select is((select replayed from public.app_purchase_service_with_balance('8e000000-0000-4000-8000-000000001621', '5b000000-0000-4000-8000-000000001602')),
  true, 'a purchase replay is answered as a replay');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001602'), 149500::bigint,
  'the purchase replay moved no additional money');

select pg_temp.act('1607', '');
select is(pg_temp.try('select * from public.app_purchase_service_with_balance(''8e000000-0000-4000-8000-000000001623'', ''5b000000-0000-4000-8000-000000001602'')'),
  '42501', 'a WF client cannot purchase a Tenant B service');

-- -----------------------------------------------------------------------------
-- Recorded payments and refunds (internal rails)
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_record_invoice_payment(''8e000000-0000-4000-8000-000000001631'', ''4a000000-0000-4000-8000-000000001606'', 3000)'),
  'P0002', 'a WF admin cannot record a payment on a Tenant B invoice');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.trymsg('select public.app_record_invoice_payment(''8e000000-0000-4000-8000-000000001632'', ''4a000000-0000-4000-8000-000000001606'', 3000)'),
  'ok', 'a Tenant B admin records a payment on its own invoice');

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_refund_invoice(''8e000000-0000-4000-8000-000000001633'', ''4a000000-0000-4000-8000-000000001607'', 100, ''attack'')'),
  'P0002', 'a WF admin cannot refund a Tenant B invoice');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.try('select public.app_refund_invoice(''8e000000-0000-4000-8000-000000001634'', ''4a000000-0000-4000-8000-000000001607'', 400, ''goodwill'')'),
  'ok', 'a Tenant B admin refunds its own invoice');
select is((select count(*) from public.invoice_refunds where invoice_id = '4a000000-0000-4000-8000-000000001607'),
  2::bigint, 'the Tenant B refund landed on the Tenant B invoice');

-- -----------------------------------------------------------------------------
-- Archived memberships and selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1606', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001602', '4a000000-0000-4000-8000-000000001606'),
  'adjust:42501 wallet:42501 stripe:42501 card:42501 record:42501',
  'an archived Tenant B membership cannot operate on money at all');

select pg_temp.act('1602', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001699"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001602', '4a000000-0000-4000-8000-000000001606'),
  'adjust:42501 wallet:42501 stripe:42501 card:42501 record:42501',
  'a selector for a Tenant without membership fails every money operation closed');

select pg_temp.act('1602', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001602', '4a000000-0000-4000-8000-000000001606'),
  'adjust:42501 wallet:42501 stripe:42501 card:42501 record:42501',
  'a malformed selector fails every money operation closed');

-- -----------------------------------------------------------------------------
-- Activity: victim Tenant stays untouched, own Tenant records correctly
-- -----------------------------------------------------------------------------

select is(pg_temp.events_by('e0000000-0000-4000-8000-000000001601', '20000000-0000-0000-0000-000000001602'),
  0::bigint, 'no Tenant B actor wrote a Wolf Forge money activity event');
select is(pg_temp.events_by('e0000000-0000-4000-8000-000000001601', '20000000-0000-0000-0000-000000001604'),
  0::bigint, 'no Tenant B owner wrote a Wolf Forge money activity event');
select ok(pg_temp.events_by('e0000000-0000-4000-8000-000000001602', '20000000-0000-0000-0000-000000001602') > 0,
  'same-Tenant money operations still record activity');
select is(pg_temp.events_wrong_tenant('e0000000-0000-4000-8000-000000001602', 'f0f0f0f0-0000-4000-8000-000000001601'),
  0::bigint, 'every Tenant B money event carries the Tenant B Tenant');

-- -----------------------------------------------------------------------------
-- Wolf Forge regression: the WF money rail is product-equivalent
-- -----------------------------------------------------------------------------

select ok((select qual from pg_policies
    where schemaname = 'public'
      and tablename = 'subscription_payment_methods'
      and policyname = 'subscription_payment_methods_internal_select') like '%current_tenant_id%',
  'the subscription payment method policy is Tenant-bound');

select pg_temp.act('1601', '');
select is(pg_temp.try('select public.app_adjust_company_balance(''8e000000-0000-4000-8000-000000001641'', ''e0000000-0000-4000-8000-000000001601'', 1000, ''top-up'')'),
  'ok', 'a WF admin still adjusts the WF balance');
select is(pg_temp.balance('e0000000-0000-4000-8000-000000001601'), 61000::bigint,
  'the WF adjustment landed on the WF wallet');
select is(pg_temp.try('select public.app_set_wf_card_membership(''8e000000-0000-4000-8000-000000001642'', ''e0000000-0000-4000-8000-000000001601'', true)'),
  'ok', 'a WF admin still activates a WF membership');
select is((select status from public.wf_card_memberships where company_id = 'e0000000-0000-4000-8000-000000001601'),
  'active', 'the WF membership stays active');

select * from finish();
rollback;
