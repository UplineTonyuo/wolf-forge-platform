begin;

select plan(61);

-- =============================================================================
-- Store service purchase → paid order → fulfillment Ticket → internal notice.
--
-- Fixtures:
--   internal owner   — holds everything, so it is the notification recipient
--   internal staff   — tickets.view REVOKED, so it must receive nothing
--   client A         — the purchaser, at company A, funded, with NO WF Card
--                      membership — the successful purchase proves the rail no
--                      longer requires one
--   client B         — an unrelated company, used for tenant separation
--
-- Services: one purchasable (active, public, one-time, priced), one inactive,
-- one private, one recurring, one free. Each proves a different refusal.
--
-- Every purchase below runs through the real RPC as the real client session, so
-- nothing here asserts against a shortcut the application does not take.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('d1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p-owner@example.invalid', now(), now()),
  ('d1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p-staff@example.invalid', now(), now()),
  ('d2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p-client-a@example.invalid', now(), now()),
  ('d2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p-client-b@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner'), display_name = 'P Owner'
where id = 'd1000000-0000-0000-0000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'), display_name = 'P Staff'
where id = 'd1000000-0000-0000-0000-000000000002';

insert into public.companies (id, name, status)
values
  ('d3000000-0000-0000-0000-00000000000a', 'Purchase Client A', 'client'),
  ('d3000000-0000-0000-0000-00000000000b', 'Purchase Client B', 'client');

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'd3000000-0000-0000-0000-00000000000a',
    display_name = 'Purchaser A'
where id = 'd2000000-0000-0000-0000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'd3000000-0000-0000-0000-00000000000b',
    display_name = 'Purchaser B'
where id = 'd2000000-0000-0000-0000-000000000002';

-- The staff account must not be able to receive a ticket notification.
insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('d1000000-0000-0000-0000-000000000002', 'tickets.view', false);

insert into public.services (id, name, price, currency, is_active, is_public, recurring, sort_order)
values
  ('d4000000-0000-0000-0000-000000000001', 'Purchasable Growth System', 1495.00, 'USD', true, true, false, 0),
  ('d4000000-0000-0000-0000-000000000002', 'Retired System', 500.00, 'USD', false, true, false, 0),
  ('d4000000-0000-0000-0000-000000000003', 'Internal Only System', 500.00, 'USD', true, false, false, 0),
  ('d4000000-0000-0000-0000-000000000005', 'Free System', 0.00, 'USD', true, true, false, 0);

insert into public.services (
  id, name, price, currency, is_active, is_public, recurring,
  recurring_price, recurring_interval_length, recurring_interval_unit, recurring_action, sort_order
)
values (
  'd4000000-0000-0000-0000-000000000004', 'Recurring Retainer', 97.00, 'USD', true, true, true,
  97.00, 1, 'M', 'create_order', 0
);

-- Both companies are funded. Neither holds a WF Card membership row, so no
-- purchase below can succeed on membership alone — the rail must work for a
-- funded non-member or it does not work at all.
update public.company_wallets
set balance_cents = 500000
where company_id in (
  'd3000000-0000-0000-0000-00000000000a',
  'd3000000-0000-0000-0000-00000000000b'
);

create temporary table purchase_result (
  order_id uuid, order_number bigint, ticket_id uuid, ticket_public_ref text,
  invoice_id uuid, invoice_number bigint, payment_id uuid, amount_cents bigint,
  currency text, wallet_balance_cents bigint, service_name text, replayed boolean
) on commit drop;

grant select, insert on purchase_result to authenticated;

-- =============================================================================
-- Structure and boundary
-- =============================================================================

select has_column('public', 'project_messages', 'order_id',
  'Project messages carry the durable fulfillment Order reference');

select col_is_fk('public', 'project_messages', array['order_id'],
  'the Project conversation reference is a real foreign key, not a loose uuid');

select has_index('public', 'project_messages', 'project_messages_request_identity_unique',
  'Project conversation writes are idempotent per Order and request');

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'app_purchase_service_with_balance'
     and p.prosecdef
     and 'search_path=""' = any(p.proconfig)),
  1,
  'the purchase RPC is SECURITY DEFINER with an empty search_path'
);

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'app_set_wf_card_membership'
     and p.prosecdef
     and 'search_path=""' = any(p.proconfig)),
  1,
  'the membership RPC is SECURITY DEFINER with an empty search_path'
);

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in (
       'notify_ticket_created', 'emit_internal_notification_for_permission',
       'enforce_order_permission', 'notify_client_invoice_issued',
       'notify_project_created'
     )
     and not (p.prosecdef and 'search_path=""' = any(p.proconfig))),
  0,
  'every private function this migration touches stays SECURITY DEFINER with search_path='''''
);

select ok(
  not has_function_privilege('anon', 'public.app_purchase_service_with_balance(uuid, uuid, text)', 'EXECUTE'),
  'anon cannot purchase'
);

select ok(
  not has_function_privilege('service_role', 'public.app_purchase_service_with_balance(uuid, uuid, text)', 'EXECUTE'),
  'service_role cannot purchase'
);

select ok(
  has_function_privilege('authenticated', 'public.app_purchase_service_with_balance(uuid, uuid, text)', 'EXECUTE'),
  'an authenticated session may call the purchase boundary'
);

select ok(
  not has_function_privilege('authenticated',
    'private.emit_internal_notification_for_permission(text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz, uuid)',
    'EXECUTE'),
  'the browser role cannot emit notifications directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.orders', 'INSERT'),
  'the browser role still holds no direct INSERT on orders'
);

select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
  'the browser role still holds no direct INSERT on notifications'
);

select is(
  (select count(*)::int from private.notification_category_decision_gaps()),
  0,
  'every notification audience+category combination still carries a decision'
);

-- =============================================================================
-- Refusals. None of these may leave anything behind.
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_purchase_service_with_balance(
      'e0000000-0000-4000-8000-000000000001', 'd4000000-0000-0000-0000-000000000002')$$,
  'WF_PURCHASE_SERVICE_UNAVAILABLE',
  'an inactive Service cannot be purchased'
);

select throws_ok(
  $$select public.app_purchase_service_with_balance(
      'e0000000-0000-4000-8000-000000000002', 'd4000000-0000-0000-0000-000000000003')$$,
  'WF_PURCHASE_SERVICE_UNAVAILABLE',
  'a private Service is indistinguishable from one that does not exist'
);

select throws_ok(
  $$select public.app_purchase_service_with_balance(
      'e0000000-0000-4000-8000-000000000003', 'd4000000-0000-0000-0000-000000000004')$$,
  'WF_PURCHASE_RECURRING_UNSUPPORTED',
  'a recurring Service is refused rather than mis-sold as a one-time purchase'
);

select throws_ok(
  $$select public.app_purchase_service_with_balance(
      'e0000000-0000-4000-8000-000000000004', 'd4000000-0000-0000-0000-000000000005')$$,
  'WF_PURCHASE_SERVICE_NOT_PRICED',
  'a zero-priced Service cannot be "purchased"'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*)::int from public.invoices
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  0,
  'four refused purchases left no invoice behind'
);

select is(
  (select balance_cents from public.company_wallets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  500000::bigint,
  'four refused purchases moved no money'
);

-- Insufficient balance, proven against the real price rather than a stub.
update public.company_wallets
set balance_cents = 100000
where company_id = 'd3000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_purchase_service_with_balance(
      'e0000000-0000-4000-8000-000000000005', 'd4000000-0000-0000-0000-000000000001')$$,
  'WF_CARD_INSUFFICIENT_BALANCE',
  'a balance below the server-resolved price is refused'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*)::int from public.orders
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  0,
  'THE GOLDEN RULE: a failed payment created no Order'
);

select is(
  (select count(*)::int from public.tickets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  0,
  'THE GOLDEN RULE: a failed payment created no fulfillment Ticket'
);

select is(
  (select count(*)::int from public.notifications
   where event_key like 'ticket-created:%'
     and company_id = 'd3000000-0000-0000-0000-00000000000a'),
  0,
  'THE GOLDEN RULE: a failed payment notified nobody'
);

-- Restore the funded balance that the insufficient-balance check spent down.
update public.company_wallets
set balance_cents = 500000
where company_id = 'd3000000-0000-0000-0000-00000000000a';

-- The purchaser holds NO active WF Card membership — no row at all. The
-- successful purchase below therefore proves the Store rail works for a funded
-- non-member.
select ok(
  not exists (
    select 1
    from public.wf_card_memberships as membership
    where membership.company_id = 'd3000000-0000-0000-0000-00000000000a'
      and membership.status = 'active'
  ),
  'the purchaser holds NO active WF Card membership when they buy'
);

-- Direct arbitrary Order creation is still refused. The browser role holds no
-- INSERT grant on public.orders, and the purchase exception in
-- private.enforce_order_permission cannot be reached by naming a payment id by
-- hand — the trigger re-derives every fact from the settled payment itself.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$insert into public.orders (
      company_id, service_id, title, status, priority
    ) values (
      'd3000000-0000-0000-0000-00000000000a',
      'd4000000-0000-0000-0000-000000000001',
      'Forged project', 'pending', 'normal')$$,
  '42501',
  'permission denied for table orders',
  'a client session cannot create an arbitrary Order directly'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- The successful purchase
--
-- The purchaser is a NON-member (asserted above). Everything below — the exact
-- debit, the paid invoice, the single Order, the single waiting_on_team Ticket,
-- the internal notice — is the proof that a funded client without WF Card
-- membership can buy an eligible one-time Service.
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';

insert into purchase_result
select * from public.app_purchase_service_with_balance(
  'e0000000-0000-4000-8000-00000000000a', 'd4000000-0000-0000-0000-000000000001'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select amount_cents from purchase_result),
  149500::bigint,
  'the price is the server''s, taken from the catalogue and not from the caller'
);

select is(
  (select balance_cents from public.company_wallets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  350500::bigint,
  'the wallet is debited by exactly the catalogue price'
);

select is(
  (select count(*)::int from public.company_wallet_transactions
   where company_id = 'd3000000-0000-0000-0000-00000000000a'
     and amount_cents = -149500),
  1,
  'exactly one wallet movement, and it is a debit'
);

select is(
  (select status || '/' || billing_reason from public.invoices
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  'paid/store_purchase',
  'the invoice is paid and names the purchase as its billing reason'
);

select is(
  (select status || '/' || payment_method from public.invoice_payments
   where invoice_id = (select invoice_id from purchase_result)),
  'succeeded/wolf_forge_wallet',
  'the payment settled through the Wolf Forge Balance rail'
);

select is(
  (select count(*)::int from public.orders
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  1,
  'exactly one Order'
);

select is(
  (select count(*)::int from public.tickets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  0,
  'a successful purchase creates no Ticket'
);

select is(
  (select o.status || '/' || o.service_id::text
   from public.orders o where o.id = (select order_id from purchase_result)),
  'pending/d4000000-0000-0000-0000-000000000001',
  'the Order is pending and references the purchased Service'
);

select ok(
  (select assigned_to_profile_id is null from public.orders
   where id = (select order_id from purchase_result)),
  'the Order is not silently assigned'
);

select is(
  (select fulfillment_status || '/' || (order_id is not null)::text
   from public.invoice_items
   where invoice_id = (select invoice_id from purchase_result)),
  'provisioned/true',
  'the invoice line records the Order it provisioned'
);

select is((select ticket_id from purchase_result), null::uuid,
  'the purchase result carries no Ticket id');

select is((select ticket_public_ref from purchase_result), null::text,
  'the purchase result carries no Ticket reference');

select is((select count(*)::int from public.project_messages
  where order_id = (select order_id from purchase_result)), 1,
  'the Project starts with one canonical conversation message');

select is((select count(distinct order_id)::int from public.project_messages
  where order_id = (select order_id from purchase_result)), 1,
  'the conversation is keyed directly to exactly one Project');

select is((select order_id from public.project_messages
  where order_id = (select order_id from purchase_result)),
  (select order_id from purchase_result),
  'the conversation is durably linked to the Project');

select is((select author_type || '/' || (author_profile_id is null)::text
  from public.project_messages where order_id = (select order_id from purchase_result)),
  'system/true',
  'the opening Project message is authored by the system');

select ok((select body like '%Purchasable Growth System%'
    and body like '%USD 1495.00%'
    and body like '%Wolf Forge Balance%'
    and body like '%ready for the Wolf Forge team%'
  from public.project_messages where order_id = (select order_id from purchase_result)),
  'the opening Project message carries the real purchase context');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';
select is(jsonb_array_length(public.app_get_order_conversation(
  (select order_id from purchase_result limit 1)
) -> 'messages'), 1, 'the purchased Project conversation is available to its client');
reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*)::int from public.activity_events
   where entity_id = (select order_id from purchase_result)
     and action = 'order.purchased'),
  1,
  'the purchase is auditable through the existing activity trail'
);

-- =============================================================================
-- Notification
-- =============================================================================

select is((select count(*)::int from public.notifications
  where event_key like 'ticket-created:%'
    and company_id = 'd3000000-0000-0000-0000-00000000000a'), 0,
  'a purchase emits no Ticket-created notification');

select is((select count(*)::int from public.notifications
  where category = 'ticket' and company_id = 'd3000000-0000-0000-0000-00000000000a'), 0,
  'a purchase emits no internal Ticket-category row');

select is(
  (select count(*)::int from public.notifications n
   where n.recipient_profile_id = 'd1000000-0000-0000-0000-000000000002'
     and n.event_key like 'ticket-created:%'),
  0,
  'an internal profile without tickets.view receives nothing'
);

select is(
  (select count(*)::int from public.notifications n
   where n.recipient_profile_id in (
     'd2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002'
   ) and n.event_key like 'ticket-created:%'),
  0,
  'no client receives the internal purchase notification, including the purchaser'
);

select is(
  (select count(*)::int from public.notifications n
   where n.event_key like 'ticket-created:%'
     and n.company_id = 'd3000000-0000-0000-0000-00000000000b'),
  0,
  'no row is tagged to the unrelated tenant'
);

select is(
  (select count(*)::int from public.notifications n
   where n.event_key = 'project-created:' || (select order_id from purchase_result)::text),
  0,
  'a purchase does not also emit the generic "Project created" row'
);

select is(
  (select count(*)::int from public.notifications n
   where n.audience = 'client'
     and n.event_key = 'client-invoice-issued:' || (select invoice_id from purchase_result)::text),
  0,
  'the purchaser is not told an invoice "is due" that was paid in the same transaction'
);

-- =============================================================================
-- Idempotency
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';

insert into purchase_result
select * from public.app_purchase_service_with_balance(
  'e0000000-0000-4000-8000-00000000000a', 'd4000000-0000-0000-0000-000000000001'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(distinct order_id)::int from purchase_result),
  1,
  'replaying the request id returns the ORIGINAL purchase'
);

select ok(
  (select bool_or(replayed) from purchase_result),
  'the replay reports itself as a replay rather than a new sale'
);

select is(
  (select balance_cents from public.company_wallets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  350500::bigint,
  'the replay moved no additional money'
);

select is(
  (select count(*)::int from public.orders
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  1,
  'the replay created no second Order'
);

select is(
  (select count(*)::int from public.tickets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  0,
  'the replay still creates no Ticket'
);

select is(
  (select count(*)::int from public.project_messages
   where order_id = (select order_id from purchase_result limit 1)),
  1,
  'the replay created no duplicate Project conversation message'
);

-- =============================================================================
-- Tenant separation
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000002';

insert into purchase_result
select * from public.app_purchase_service_with_balance(
  'e0000000-0000-4000-8000-00000000000b', 'd4000000-0000-0000-0000-000000000001'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*)::int from public.orders
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  1,
  'company B purchasing the same Service cannot touch company A''s fulfillment'
);

select is(
  (select company_id from public.orders
   where id = (select order_id from purchase_result where replayed = false
               order by order_number desc limit 1)),
  'd3000000-0000-0000-0000-00000000000b'::uuid,
  'a purchase is always provisioned to the caller''s own derived company'
);

select is(
  (select balance_cents from public.company_wallets
   where company_id = 'd3000000-0000-0000-0000-00000000000a'),
  350500::bigint,
  'company B''s purchase debited company B, never company A'
);

-- =============================================================================
-- The membership activation path is internal-only
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'd2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_set_wf_card_membership(
      'e0000000-0000-4000-8000-00000000000c',
      'd3000000-0000-0000-0000-00000000000a', true)$$,
  'verified internal authentication is required',
  'a client cannot grant their own company the membership'
);

reset role;

select * from finish();
rollback;
