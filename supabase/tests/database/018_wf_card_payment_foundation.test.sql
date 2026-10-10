begin;

select plan(51);

-- -----------------------------------------------------------------------------
-- Structure, centralized offer, and least privilege
-- -----------------------------------------------------------------------------

select ok(to_regclass('public.wf_card_memberships') is not null, 'WF Card membership table exists');
select ok(to_regclass('public.wf_card_settings') is not null, 'WF Card authoritative settings table exists');
select ok(to_regprocedure('public.app_pay_invoice_with_wallet(uuid,uuid,text)') is not null, 'client wallet payment RPC exists');
select ok(to_regprocedure('private.settle_invoice_payment(uuid,uuid,uuid,bigint,text,text,text,text)') is not null, 'shared private invoice settlement routine exists');
select is((select membership_price_cents from public.wf_card_settings where singleton), 25900::bigint, '$259 membership price is centralized as 25900 cents');
select is((select membership_currency from public.wf_card_settings where singleton), 'USD', 'membership price currency is centralized');
select ok(
  not has_function_privilege('anon', 'public.app_pay_invoice_with_wallet(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.app_pay_invoice_with_wallet(uuid,uuid,text)', 'EXECUTE'),
  'only authenticated callers may execute the wallet payment RPC'
);
select ok(
  not has_function_privilege('authenticated', 'private.settle_invoice_payment(uuid,uuid,uuid,bigint,text,text,text,text)', 'EXECUTE'),
  'authenticated callers cannot bypass the private settlement routine'
);
select ok(
  not has_table_privilege('authenticated', 'public.wf_card_memberships', 'INSERT')
  and not has_table_privilege('authenticated', 'public.wf_card_memberships', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.company_wallet_transactions', 'INSERT'),
  'browser callers cannot directly activate membership or write ledgers'
);
select ok(
  pg_get_function_arguments('public.app_pay_invoice_with_wallet(uuid,uuid,text)'::regprocedure) not ilike '%actor%'
  and pg_get_function_arguments('public.app_pay_invoice_with_wallet(uuid,uuid,text)'::regprocedure) not ilike '%company%',
  'wallet payment accepts no caller-supplied actor or company identity'
);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('29000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'wf-card-admin@example.invalid', now(), now()),
  ('19000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'wf-card-client-a@example.invalid', now(), now()),
  ('19000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'wf-card-client-b@example.invalid', now(), now()),
  ('19000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'wf-card-client-c@example.invalid', now(), now()),
  ('19000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'wf-card-invoices-denied@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'WF Card Admin'
from public.roles as role_row
where profile_row.id = '29000000-0000-0000-0000-000000000001'
  and role_row.name = 'admin';

insert into public.companies (id, name, status)
values
  ('39000000-0000-0000-0000-000000000001', 'WF Card Company A', 'client'),
  ('39000000-0000-0000-0000-000000000002', 'WF Card Company B', 'client'),
  ('39000000-0000-0000-0000-000000000003', 'WF Card Company C', 'client');

update public.profiles
set company_id = case id
  when '19000000-0000-0000-0000-000000000001' then '39000000-0000-0000-0000-000000000001'::uuid
  when '19000000-0000-0000-0000-000000000002' then '39000000-0000-0000-0000-000000000002'::uuid
  when '19000000-0000-0000-0000-000000000004' then '39000000-0000-0000-0000-000000000001'::uuid
  else '39000000-0000-0000-0000-000000000003'::uuid
end,
display_name = case id
  when '19000000-0000-0000-0000-000000000001' then 'Client Alpha'
  when '19000000-0000-0000-0000-000000000002' then 'Client Beta'
  when '19000000-0000-0000-0000-000000000004' then 'Client Invoices Denied'
  else 'Client Gamma'
end
where id in (
  '19000000-0000-0000-0000-000000000001',
  '19000000-0000-0000-0000-000000000002',
  '19000000-0000-0000-0000-000000000003',
  '19000000-0000-0000-0000-000000000004'
);

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('19000000-0000-0000-0000-000000000004', 'invoices.view', false);

update public.company_wallets
set balance_cents = case company_id
  when '39000000-0000-0000-0000-000000000001' then 68417
  when '39000000-0000-0000-0000-000000000002' then 80000
  else 18417
end
where company_id in (
  '39000000-0000-0000-0000-000000000001',
  '39000000-0000-0000-0000-000000000002',
  '39000000-0000-0000-0000-000000000003'
);

insert into public.wf_card_memberships (
  company_id, status, activated_at, purchase_price_cents, purchase_currency, purchase_reference
)
values
  ('39000000-0000-0000-0000-000000000001', 'active', now(), 25900, 'USD', 'test-active-a'),
  ('39000000-0000-0000-0000-000000000003', 'active', now(), 25900, 'USD', 'test-active-c');

insert into public.invoices (
  id, company_id, client_profile_id, status, currency, invoice_number,
  billing_reason, issued_at, due_at, subtotal_cents, discount_total_cents,
  tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id, voided_at
)
values
  ('49000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'unpaid', 'USD', 9001, 'manual', now(), now() + interval '7 days', 49700, 0, 0, 49700, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null),
  ('49000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000002', 'unpaid', 'USD', 9002, 'manual', now(), now() + interval '7 days', 22000, 0, 0, 22000, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null),
  ('49000000-0000-0000-0000-000000000003', '39000000-0000-0000-0000-000000000003', '19000000-0000-0000-0000-000000000003', 'unpaid', 'USD', 9003, 'manual', now(), now() + interval '7 days', 49700, 0, 0, 49700, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null),
  ('49000000-0000-0000-0000-000000000004', '39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'void', 'USD', 9004, 'manual', now(), now() + interval '7 days', 10000, 0, 0, 10000, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', now()),
  ('49000000-0000-0000-0000-000000000005', '39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'payment_pending', 'USD', 9005, 'manual', now(), now() + interval '7 days', 10000, 0, 0, 10000, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null),
  ('49000000-0000-0000-0000-000000000006', '39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'paid', 'USD', 9006, 'manual', now(), now() + interval '7 days', 10000, 0, 0, 10000, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null),
  ('49000000-0000-0000-0000-000000000007', '39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'unpaid', 'EUR', 9007, 'manual', now(), now() + interval '7 days', 10000, 0, 0, 10000, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null),
  ('49000000-0000-0000-0000-000000000008', '39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000004', 'draft', 'USD', null, 'manual', null, now() + interval '7 days', 10000, 0, 0, 10000, '29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', null);

update public.invoices
set status = 'unpaid', invoice_number = 9008, issued_at = now()
where id = '49000000-0000-0000-0000-000000000008';

insert into public.invoice_payments (
  id, invoice_id, amount_cents, currency, status, payment_method, settled_at,
  request_id, created_by_profile_id
)
values (
  '59000000-0000-0000-0000-000000000006', '49000000-0000-0000-0000-000000000006',
  10000, 'USD', 'succeeded', 'manual', now(),
  '79000000-0000-0000-0000-000000000006', '29000000-0000-0000-0000-000000000001'
);

-- -----------------------------------------------------------------------------
-- Membership visibility and company isolation
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000001';

select is((select status from public.wf_card_memberships), 'active', 'active company membership is recognized');
select is((select count(*) from public.wf_card_memberships where company_id = '39000000-0000-0000-0000-000000000002'), 0::bigint, 'Client A cannot read Company B membership');
select is((select count(*) from public.wf_card_memberships where company_id = '39000000-0000-0000-0000-000000000003'), 0::bigint, 'Client A cannot read Company C membership');
reset role;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000002';
select is((select count(*) from public.wf_card_memberships), 0::bigint, 'non-member company is recognized without another company membership leaking');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.wf_card_memberships$$, '42501', 'permission denied for table wf_card_memberships', 'anonymous cannot read membership-private data');
select throws_ok($$select * from public.app_get_wf_card_settings()$$, '42501', 'permission denied for function app_get_wf_card_settings', 'anonymous cannot read the private offer RPC');
reset role;

select is(
  (select count(*) from public.notifications
   where recipient_profile_id = '19000000-0000-0000-0000-000000000004'
     and event_key = 'client-invoice-issued:49000000-0000-0000-0000-000000000008'),
  0::bigint,
  'client denied invoices.view receives no issued-invoice notification metadata'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000004';
select is(
  (select count(*) from public.wf_card_memberships),
  0::bigint,
  'client denied portal_invoices cannot read wallet membership context directly'
);
select throws_ok(
  $$select public.app_get_company_wallet('39000000-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied: invoices.view',
  'client denied portal_invoices cannot read company wallet context by RPC'
);
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000011', '49000000-0000-0000-0000-000000000008')$$,
  '42501', 'permission denied: invoices.view',
  'client denied portal_invoices cannot wallet-pay an invoice by UUID'
);
reset role;
select is(
  (select count(*) from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000008'),
  0::bigint,
  'denied wallet payment creates no invoice payment'
);
select is(
  (select balance_cents from public.company_wallets where company_id = '39000000-0000-0000-0000-000000000001'),
  68417::bigint,
  'denied wallet payment leaves the company balance unchanged'
);

-- -----------------------------------------------------------------------------
-- Successful atomic full payment and retry safety
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select * from public.app_pay_invoice_with_wallet(
    '89000000-0000-0000-0000-000000000001',
    '49000000-0000-0000-0000-000000000001'
  )$$,
  'active member with sufficient balance can pay own invoice'
);
select lives_ok(
  $$select * from public.app_pay_invoice_with_wallet(
    '89000000-0000-0000-0000-000000000001',
    '49000000-0000-0000-0000-000000000001'
  )$$,
  'same payment request retries safely'
);
reset role;

select is((select count(*) from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000001'), 1::bigint, 'successful payment creates exactly one invoice payment');
select is((select amount_cents from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000001'), 49700::bigint, 'wallet debit settlement equals collectible invoice amount');
select is((select payment_method from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000001'), 'wolf_forge_wallet', 'invoice payment records the WF wallet method');
select is((select count(*) from public.company_wallet_transactions where invoice_id = '49000000-0000-0000-0000-000000000001'), 1::bigint, 'successful payment creates exactly one wallet debit ledger entry');
select is((select amount_cents from public.company_wallet_transactions where invoice_id = '49000000-0000-0000-0000-000000000001'), (-49700)::bigint, 'wallet ledger debit equals collectible invoice amount');
select is((select balance_cents from public.company_wallets where company_id = '39000000-0000-0000-0000-000000000001'), 18717::bigint, 'wallet balance reduces exactly once and remains non-negative');
select is((select status from public.invoices where id = '49000000-0000-0000-0000-000000000001'), 'paid', 'existing invoice accounting settles the invoice');
select is((select balance_due_cents from private.invoice_amounts('49000000-0000-0000-0000-000000000001')), 0::bigint, 'settled invoice has zero collectible balance');
select is((select created_by_profile_id from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000001'), '19000000-0000-0000-0000-000000000001'::uuid, 'payment actor is derived from auth.uid()');
select ok(
  exists (
    select 1 from public.activity_events
    where entity_type = 'invoice'
      and entity_id = '49000000-0000-0000-0000-000000000001'
      and action = 'invoice.payment_recorded'
      and actor_profile_id = '19000000-0000-0000-0000-000000000001'
  ) and exists (
    select 1 from public.activity_events
    where entity_type = 'company'
      and entity_id = '39000000-0000-0000-0000-000000000001'
      and action = 'company.wallet_invoice_paid'
      and actor_profile_id = '19000000-0000-0000-0000-000000000001'
  ),
  'invoice and wallet audit events carry correct client attribution'
);
select ok(
  pg_get_functiondef('public.app_pay_invoice_with_wallet(uuid,uuid,text)'::regprocedure) ilike '%find_create_request%'
  and pg_get_functiondef('private.find_create_request(uuid,text,uuid,jsonb)'::regprocedure) ilike '%pg_advisory_xact_lock%'
  and exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invoice_payments'::regclass
      and conname = 'invoice_payments_request_unique'
  ),
  'concurrent duplicate requests serialize and retain unique payment identity'
);

-- -----------------------------------------------------------------------------
-- Membership-free settlement and deterministic failures
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000002';
select lives_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000002')$$,
  'a client can settle its own invoice from Wolf Forge Balance without WF Card membership'
);
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000003', '49000000-0000-0000-0000-000000000001')$$,
  '42501', 'WF_CARD_INVOICE_ACCESS_DENIED',
  'Client B cannot pay Company A invoice'
);
reset role;
select is((select balance_cents from public.company_wallets where company_id = '39000000-0000-0000-0000-000000000002'), 58000::bigint, 'membership-free settlement debits Company B only for its own invoice');
select is((select count(*) from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000002'), 1::bigint, 'membership-free settlement records exactly one invoice payment');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000004', '49000000-0000-0000-0000-000000000003')$$,
  'P0001', 'WF_CARD_INSUFFICIENT_BALANCE',
  'insufficient funds are rejected deterministically'
);
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000005', '49000000-0000-0000-0000-000000000002')$$,
  '42501', 'WF_CARD_INVOICE_ACCESS_DENIED',
  'Client C cannot pay Company B invoice'
);
reset role;
select is((select balance_cents from public.company_wallets where company_id = '39000000-0000-0000-0000-000000000003'), 18417::bigint, 'insufficient payment cannot make wallet negative');
select is((select count(*) from public.invoice_payments where invoice_id = '49000000-0000-0000-0000-000000000003'), 0::bigint, 'insufficient payment rolls back invoice settlement');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '19000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000006', '49000000-0000-0000-0000-000000000004')$$,
  'P0001', 'WF_CARD_INVOICE_NOT_COLLECTIBLE',
  'void invoice cannot be wallet-paid'
);
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000007', '49000000-0000-0000-0000-000000000005')$$,
  'P0001', 'WF_CARD_INVOICE_NOT_COLLECTIBLE',
  'payment-pending invoice is rejected by full-payment V1'
);
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000008', '49000000-0000-0000-0000-000000000006')$$,
  'P0001', 'WF_CARD_INVOICE_NOT_COLLECTIBLE',
  'already-paid or fully refunded non-collectible invoice cannot be paid again'
);
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000009', '49000000-0000-0000-0000-000000000007')$$,
  'P0001', 'WF_CARD_CURRENCY_MISMATCH',
  'invoice currency must match wallet currency'
);
reset role;

set local role anon;
select throws_ok(
  $$select * from public.app_pay_invoice_with_wallet('89000000-0000-0000-0000-000000000010', '49000000-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function app_pay_invoice_with_wallet',
  'anonymous wallet payment is blocked'
);
reset role;

select is((select count(*) from public.services where tenant_id = private.wolf_forge_tenant_id()), 59::bigint, 'Wolf Forge Services remain exactly 59');
select is((select count(*) from public.services where tenant_id = private.wolf_forge_tenant_id() and description is not null and btrim(description) <> ''), 59::bigint, 'Wolf Forge Service descriptions remain 59 of 59');
select ok(to_regclass('public.coupons') is not null and to_regprocedure('public.app_validate_coupon(text,jsonb,numeric)') is not null, 'Coupons architecture remains intact');

select * from finish();
rollback;
