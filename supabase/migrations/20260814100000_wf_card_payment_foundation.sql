-- Wolf Forge Platform - WF Card membership and invoice wallet payment foundation
--
-- WF Card is a company-scoped Wolf Forge membership layered on the existing
-- company wallet. It is not a bank-issued card and stores no card credentials.

-- -----------------------------------------------------------------------------
-- Central membership offer configuration
-- -----------------------------------------------------------------------------

create table public.wf_card_settings (
  singleton boolean primary key default true,
  membership_price_cents bigint not null,
  membership_currency text not null default 'USD',
  updated_at timestamptz not null default now(),
  constraint wf_card_settings_singleton check (singleton),
  constraint wf_card_settings_price_positive check (membership_price_cents > 0),
  constraint wf_card_settings_currency_format check (membership_currency ~ '^[A-Z]{3}$')
);

insert into public.wf_card_settings (singleton, membership_price_cents, membership_currency)
values (true, 25900, 'USD');

create trigger wf_card_settings_set_updated_at
before update on public.wf_card_settings
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Company-owned membership entitlement
-- -----------------------------------------------------------------------------

create table public.wf_card_memberships (
  company_id uuid primary key references public.companies (id) on delete cascade,
  status text not null,
  activated_at timestamptz,
  deactivated_at timestamptz,
  purchase_price_cents bigint not null,
  purchase_currency text not null,
  purchase_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wf_card_memberships_status_valid
    check (status in ('inactive', 'pending', 'active', 'cancelled')),
  constraint wf_card_memberships_price_positive check (purchase_price_cents > 0),
  constraint wf_card_memberships_currency_format check (purchase_currency ~ '^[A-Z]{3}$'),
  constraint wf_card_memberships_reference_not_blank
    check (purchase_reference is null or btrim(purchase_reference) <> ''),
  constraint wf_card_memberships_lifecycle_consistent check (
    (status in ('inactive', 'pending') and activated_at is null and deactivated_at is null)
    or (status = 'active' and activated_at is not null and deactivated_at is null)
    or (status = 'cancelled' and deactivated_at is not null)
  )
);

create index wf_card_memberships_active_idx
on public.wf_card_memberships (company_id)
where status = 'active';

create trigger wf_card_memberships_set_updated_at
before update on public.wf_card_memberships
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Wallet ledger linkage for invoice payments
-- -----------------------------------------------------------------------------

alter table public.company_wallet_transactions
  drop constraint company_wallet_transaction_source;

alter table public.company_wallet_transactions
  add column invoice_id uuid references public.invoices (id) on delete restrict,
  add column invoice_payment_id uuid references public.invoice_payments (id) on delete restrict,
  add constraint company_wallet_transaction_source check (
    source in (
      'manual_credit', 'manual_debit', 'service_purchase', 'refund',
      'adjustment', 'invoice_payment'
    )
  ),
  add constraint company_wallet_transaction_invoice_links check (
    (source = 'invoice_payment' and invoice_id is not null and invoice_payment_id is not null)
    or (source <> 'invoice_payment' and invoice_id is null and invoice_payment_id is null)
  ),
  add constraint company_wallet_transaction_invoice_payment_unique unique (invoice_payment_id);

create index company_wallet_transactions_invoice_idx
on public.company_wallet_transactions (invoice_id)
where invoice_id is not null;

alter table public.invoice_payments
  drop constraint invoice_payments_method_valid;

alter table public.invoice_payments
  add constraint invoice_payments_method_valid check (
    payment_method in (
      'manual', 'card', 'bank_transfer', 'wallet', 'wolf_forge_wallet', 'other'
    )
  );

-- -----------------------------------------------------------------------------
-- Client account and membership reads
-- -----------------------------------------------------------------------------

create function public.app_get_client_account_context()
returns table (
  profile_id uuid,
  company_id uuid,
  display_name text,
  company_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  return query
  select profile_row.id, company_row.id, profile_row.display_name, company_row.name
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if not found then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;
end;
$$;

create function public.app_get_wf_card_settings()
returns table (membership_price_cents bigint, membership_currency text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles as profile_row
    where profile_row.id = (select auth.uid()) and profile_row.archived_at is null
  ) then
    raise exception 'authenticated account is required' using errcode = '42501';
  end if;

  return query
  select settings.membership_price_cents, settings.membership_currency
  from public.wf_card_settings as settings
  where settings.singleton;
end;
$$;

-- -----------------------------------------------------------------------------
-- Shared invoice settlement routine
--
-- Authorization and idempotency remain in the public entry points. This private
-- routine is the single accounting path for admin-recorded and WF wallet payments.
-- -----------------------------------------------------------------------------

create function private.settle_invoice_payment(
  p_actor_id uuid,
  p_request_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_status text,
  p_payment_method text,
  p_processor text default null,
  p_processor_reference text default null
)
returns public.invoice_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  payment_row public.invoice_payments;
  amounts record;
  remaining_balance bigint;
begin
  if p_actor_id is null or p_actor_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.profiles as profile_row
      where profile_row.id = p_actor_id and profile_row.archived_at is null
    )
  then
    raise exception 'verified payment actor is required' using errcode = '42501';
  end if;

  if p_request_id is null or p_amount_cents is null or p_amount_cents <= 0
    or p_status not in ('pending', 'succeeded', 'failed', 'cancelled')
    or p_payment_method not in (
      'manual', 'card', 'bank_transfer', 'wallet', 'wolf_forge_wallet', 'other'
    )
  then
    raise exception 'invalid invoice payment' using errcode = '22023';
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
  for update;

  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status not in ('unpaid', 'payment_pending') then
    raise exception 'invoice is not open for payment' using errcode = '55000';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if p_status in ('pending', 'succeeded') and p_amount_cents > amounts.balance_due_cents then
    raise exception 'invoice payment exceeds balance due' using errcode = '22023';
  end if;

  insert into public.invoice_payments (
    invoice_id, amount_cents, currency, status, payment_method, processor,
    processor_reference, settled_at, request_id, created_by_profile_id
  ) values (
    p_invoice_id, p_amount_cents, invoice_row.currency, p_status, p_payment_method,
    nullif(btrim(p_processor), ''), nullif(btrim(p_processor_reference), ''),
    case when p_status = 'succeeded' then now() else null end,
    p_request_id, p_actor_id
  ) returning * into payment_row;

  if p_status = 'pending' and invoice_row.status = 'unpaid' then
    update public.invoices
    set status = 'payment_pending', updated_by_profile_id = p_actor_id
    where id = p_invoice_id;
  elsif p_status = 'succeeded' then
    select balance_due_cents into remaining_balance
    from private.invoice_amounts(p_invoice_id);

    update public.invoices
    set status = case when remaining_balance = 0 then 'paid' else 'unpaid' end,
        invoice_number = coalesce(invoice_number, private.next_invoice_number()),
        issued_at = coalesce(issued_at, now()),
        updated_by_profile_id = p_actor_id
    where id = p_invoice_id;

    if remaining_balance = 0 then
      update public.invoice_items
      set fulfillment_status = 'pending'
      where invoice_id = p_invoice_id
        and service_id is not null
        and fulfillment_status = 'awaiting_payment';
    end if;
  end if;

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    p_actor_id,
    'invoice',
    p_invoice_id,
    'invoice.payment_recorded',
    'Recorded invoice payment.',
    jsonb_build_object(
      'payment_id', payment_row.id,
      'amount_cents', payment_row.amount_cents,
      'currency', payment_row.currency,
      'status', payment_row.status,
      'payment_method', payment_row.payment_method
    )
  );

  return payment_row;
end;
$$;

create or replace function public.app_record_invoice_payment(
  p_request_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_status text default 'succeeded',
  p_payment_method text default 'manual',
  p_processor text default null,
  p_processor_reference text default null
)
returns public.invoice_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.mark_paid');
  request_payload jsonb := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'amount_cents', p_amount_cents,
    'status', p_status,
    'payment_method', p_payment_method,
    'processor', nullif(btrim(p_processor), ''),
    'processor_reference', nullif(btrim(p_processor_reference), '')
  );
  existing_id uuid;
  payment_row public.invoice_payments;
begin
  existing_id := private.find_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload
  );

  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment where payment.id = existing_id;
    if payment_row.id is null then raise no_data_found; end if;
    return payment_row;
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id, p_request_id, p_invoice_id, p_amount_cents, p_status,
    p_payment_method, p_processor, p_processor_reference
  );

  perform private.remember_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload, payment_row.id
  );
  return payment_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Narrow trigger allowance for the validated client wallet payment transaction
-- -----------------------------------------------------------------------------

create or replace function private.enforce_company_wallet_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_payment_id uuid;
begin
  if tg_table_name = 'company_wallets' then
    if tg_op = 'INSERT' and new.balance_cents = 0 then
      return new;
    end if;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;

  begin
    context_payment_id := nullif(
      current_setting('app.wf_wallet_invoice_payment_id', true), ''
    )::uuid;
  exception when invalid_text_representation then
    context_payment_id := null;
  end;

  if context_payment_id is not null then
    if tg_table_name = 'company_wallets' then
      if tg_op = 'UPDATE' and exists (
        select 1
        from public.invoice_payments as payment_row
        join public.invoices as invoice_row on invoice_row.id = payment_row.invoice_id
        join public.wf_card_memberships as membership_row
          on membership_row.company_id = invoice_row.company_id and membership_row.status = 'active'
        join public.profiles as profile_row
          on profile_row.id = (select auth.uid())
         and profile_row.company_id = invoice_row.company_id
         and profile_row.archived_at is null
        join public.roles as role_row on role_row.id = profile_row.role_id and role_row.name = 'client'
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and old.company_id = invoice_row.company_id
          and new.company_id = old.company_id
          and new.currency = old.currency
          and old.balance_cents - new.balance_cents = payment_row.amount_cents
          and new.balance_cents >= 0
      ) then
        return new;
      end if;
    end if;

    if tg_table_name = 'company_wallet_transactions' then
      if tg_op = 'INSERT' and exists (
        select 1
        from public.invoice_payments as payment_row
        join public.invoices as invoice_row on invoice_row.id = payment_row.invoice_id
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and new.actor_profile_id = (select auth.uid())
          and new.company_id = invoice_row.company_id
          and new.invoice_id = invoice_row.id
          and new.invoice_payment_id = payment_row.id
          and new.request_id = payment_row.request_id
          and new.amount_cents = -payment_row.amount_cents
          and new.currency = payment_row.currency
          and new.source = 'invoice_payment'
      ) then
        return new;
      end if;
    end if;
  end if;

  perform private.require_permission('client_private.manage');
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Atomic, full-balance client wallet payment
-- -----------------------------------------------------------------------------

create function public.app_pay_invoice_with_wallet(
  p_request_id uuid,
  p_invoice_id uuid
)
returns table (
  payment_id uuid,
  wallet_transaction_id uuid,
  wallet_balance_cents bigint,
  invoice_balance_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  request_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id);
  existing_id uuid;
  invoice_row public.invoices;
  wallet_row public.company_wallets;
  payment_row public.invoice_payments;
  wallet_transaction_row public.company_wallet_transactions;
  amounts record;
  debit_cents bigint;
begin
  if actor_id is null then
    raise exception 'WF_CARD_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_invoice_id is null then
    raise exception 'WF_CARD_INVALID_PAYMENT_REQUEST' using errcode = '22023';
  end if;

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if actor_company_id is null then
    raise exception 'WF_CARD_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'invoice.wallet.pay', p_request_id, request_payload
  );
  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment where payment.id = existing_id;
    select transaction.* into wallet_transaction_row
    from public.company_wallet_transactions as transaction
    where transaction.invoice_payment_id = existing_id;
    select * into amounts from private.invoice_amounts(payment_row.invoice_id);

    if payment_row.id is null or wallet_transaction_row.id is null then raise no_data_found; end if;
    return query select payment_row.id, wallet_transaction_row.id,
      wallet_transaction_row.balance_after_cents, amounts.balance_due_cents;
    return;
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
  for update;

  if invoice_row.id is null or invoice_row.company_id <> actor_company_id then
    raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if invoice_row.status <> 'unpaid' then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  debit_cents := amounts.balance_due_cents;
  if debit_cents is null or debit_cents <= 0 then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.wf_card_memberships as membership
    where membership.company_id = actor_company_id and membership.status = 'active'
  ) then
    raise exception 'WF_CARD_MEMBERSHIP_REQUIRED' using errcode = 'P0001';
  end if;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> invoice_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < debit_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    p_invoice_id,
    debit_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - debit_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents,
    balance_after_cents, currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -debit_cents,
    wallet_row.balance_cents, wallet_row.currency, 'invoice_payment',
    format('WF Card payment for invoice #%s', invoice_row.invoice_number),
    invoice_row.id, payment_row.id
  ) returning * into wallet_transaction_row;

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'company',
    actor_company_id,
    'company.wallet_invoice_paid',
    'Paid an invoice with WF Card.',
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'wallet_transaction_id', wallet_transaction_row.id,
      'amount_cents', debit_cents,
      'balance_after_cents', wallet_row.balance_cents,
      'currency', wallet_row.currency
    )
  );

  perform private.remember_create_request(
    actor_id, 'invoice.wallet.pay', p_request_id, request_payload, payment_row.id
  );

  select * into amounts from private.invoice_amounts(p_invoice_id);
  return query select payment_row.id, wallet_transaction_row.id,
    wallet_row.balance_cents, amounts.balance_due_cents;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS and least privilege
-- -----------------------------------------------------------------------------

alter table public.wf_card_settings enable row level security;
alter table public.wf_card_memberships enable row level security;

create policy wf_card_memberships_authorized_select
on public.wf_card_memberships for select to authenticated
using (
  company_id = (select private.current_user_company_id())
  or (
    (select private.is_internal_user())
    and public.app_has_permission('client_private.read')
  )
);

revoke all on table public.wf_card_settings, public.wf_card_memberships
from public, anon, authenticated, service_role;
grant select on table public.wf_card_memberships to authenticated, service_role;
grant select on table public.wf_card_settings to service_role;

revoke all on function public.app_get_client_account_context()
from public, anon, authenticated, service_role;
revoke all on function public.app_get_wf_card_settings()
from public, anon, authenticated, service_role;
revoke all on function private.settle_invoice_payment(uuid, uuid, uuid, bigint, text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.app_pay_invoice_with_wallet(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.app_get_client_account_context() to authenticated;
grant execute on function public.app_get_wf_card_settings() to authenticated;
grant execute on function public.app_pay_invoice_with_wallet(uuid, uuid) to authenticated;

comment on table public.wf_card_memberships is
  'Company-scoped Wolf Forge membership entitlement layered on the existing company wallet; not a bank-issued card.';
comment on table public.wf_card_settings is
  'Authoritative WF Card offer configuration. Seeded at $259 one-time and ready for a future Settings mutation boundary.';
comment on function public.app_pay_invoice_with_wallet(uuid, uuid) is
  'Authenticated client-only, company-scoped, active-membership-gated, idempotent full invoice payment using the existing wallet and invoice ledgers.';
