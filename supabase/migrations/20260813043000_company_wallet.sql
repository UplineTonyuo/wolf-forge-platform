-- Wolf Forge Platform
-- Company wallet / client account balance.
--
-- Money is stored as integer cents.
-- Balance cannot fall below zero.
-- All adjustments are ledgered and idempotent.

create table public.company_wallets (
  company_id uuid primary key
    references public.companies(id)
    on delete cascade,

  balance_cents bigint not null default 0,
  currency text not null default 'USD',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint company_wallet_balance_nonnegative
    check (balance_cents >= 0),

  constraint company_wallet_currency_format
    check (currency ~ '^[A-Z]{3}$')
);

create trigger company_wallets_set_updated_at
before update on public.company_wallets
for each row
execute function private.set_updated_at();


create table public.company_wallet_transactions (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null
    references public.companies(id)
    on delete cascade,

  request_id uuid not null,

  actor_profile_id uuid not null
    references public.profiles(id)
    on delete restrict,

  amount_cents bigint not null,
  balance_after_cents bigint not null,

  currency text not null default 'USD',

  source text not null,
  reason text,

  created_at timestamptz not null default now(),

  constraint company_wallet_transaction_nonzero
    check (amount_cents <> 0),

  constraint company_wallet_transaction_balance_nonnegative
    check (balance_after_cents >= 0),

  constraint company_wallet_transaction_currency_format
    check (currency ~ '^[A-Z]{3}$'),

  constraint company_wallet_transaction_reason_length
    check (
      reason is null
      or char_length(reason) <= 240
    ),

  constraint company_wallet_transaction_source
    check (
      source in (
        'manual_credit',
        'manual_debit',
        'service_purchase',
        'refund',
        'adjustment'
      )
    ),

  constraint company_wallet_transaction_request_unique
    unique (actor_profile_id, request_id)
);

create index company_wallet_transactions_company_created_idx
on public.company_wallet_transactions (
  company_id,
  created_at desc
);


-- Existing companies receive a wallet immediately.
insert into public.company_wallets (
  company_id,
  balance_cents,
  currency
)
select
  company.id,
  0,
  'USD'
from public.companies as company
on conflict (company_id) do nothing;


-- Every future company automatically receives a wallet.
create or replace function private.create_company_wallet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_wallets (
    company_id,
    balance_cents,
    currency
  )
  values (
    new.id,
    0,
    'USD'
  )
  on conflict (company_id) do nothing;

  return new;
end;
$$;

revoke all on function private.create_company_wallet()
from public, anon, authenticated, service_role;

create trigger companies_create_wallet
after insert on public.companies
for each row
execute function private.create_company_wallet();


-- ------------------------------------------------------------
-- Secure read
-- ------------------------------------------------------------

create function public.app_get_company_wallet(
  p_company_id uuid
)
returns public.company_wallets
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_row public.company_wallets;
begin
  perform private.require_internal_actor();

  select wallet.*
  into wallet_row
  from public.company_wallets as wallet
  join public.companies as company
    on company.id = wallet.company_id
  where wallet.company_id = p_company_id
    and company.archived_at is null;

  if wallet_row.company_id is null then
    raise no_data_found;
  end if;

  return wallet_row;
end;
$$;


-- ------------------------------------------------------------
-- Secure atomic balance adjustment
-- ------------------------------------------------------------

create function public.app_adjust_company_balance(
  p_request_id uuid,
  p_company_id uuid,
  p_amount_cents bigint,
  p_reason text default null
)
returns public.company_wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid :=
    private.require_internal_actor();

  normalized_reason text :=
    nullif(btrim(p_reason), '');

  request_payload jsonb;

  existing_id uuid;

  wallet_row public.company_wallets;

  transaction_row
    public.company_wallet_transactions;

  new_balance bigint;

  source_value text;

  formatted_amount text;
begin
  if p_request_id is null then
    raise exception 'request id is required'
      using errcode = '22023';
  end if;

  if p_amount_cents is null
    or p_amount_cents = 0
  then
    raise exception 'balance adjustment must be non-zero'
      using errcode = '22023';
  end if;

  if normalized_reason is not null
    and char_length(normalized_reason) > 240
  then
    raise exception 'balance adjustment reason is too long'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.companies as company
    where company.id = p_company_id
      and company.archived_at is null
  ) then
    raise no_data_found;
  end if;

  request_payload :=
    jsonb_build_object(
      'company_id',
      p_company_id,
      'amount_cents',
      p_amount_cents,
      'reason',
      normalized_reason
    );

  existing_id :=
    private.find_create_request(
      actor_id,
      'company_wallet.adjust',
      p_request_id,
      request_payload
    );

  if existing_id is not null then
    select transaction.*
    into transaction_row
    from public.company_wallet_transactions
      as transaction
    where transaction.id = existing_id;

    if transaction_row.id is null then
      raise no_data_found;
    end if;

    return transaction_row;
  end if;

  select wallet.*
  into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = p_company_id
  for update;

  if wallet_row.company_id is null then
    raise no_data_found;
  end if;

  new_balance :=
    wallet_row.balance_cents
    + p_amount_cents;

  if new_balance < 0 then
    raise exception 'insufficient client balance'
      using errcode = '22023';
  end if;

  update public.company_wallets
  set balance_cents = new_balance
  where company_id = p_company_id
  returning *
  into wallet_row;

  source_value :=
    case
      when p_amount_cents > 0
        then 'manual_credit'
      else 'manual_debit'
    end;

  insert into public.company_wallet_transactions (
    company_id,
    request_id,
    actor_profile_id,
    amount_cents,
    balance_after_cents,
    currency,
    source,
    reason
  )
  values (
    p_company_id,
    p_request_id,
    actor_id,
    p_amount_cents,
    new_balance,
    wallet_row.currency,
    source_value,
    normalized_reason
  )
  returning *
  into transaction_row;

  formatted_amount :=
    to_char(
      abs(p_amount_cents)::numeric / 100,
      'FM999999999999990.00'
    );

  perform private.record_authenticated_activity(
    'company',
    p_company_id,
    'company.updated',
    case
      when p_amount_cents > 0
        then format(
          'Added $%s to client balance.',
          formatted_amount
        )
      else format(
        'Deducted $%s from client balance.',
        formatted_amount
      )
    end,
    jsonb_build_object(
      'field',
      'balance',
      'transaction_id',
      transaction_row.id,
      'amount_cents',
      p_amount_cents,
      'balance_after_cents',
      new_balance,
      'currency',
      wallet_row.currency,
      'reason',
      normalized_reason
    )
  );

  perform private.remember_create_request(
    actor_id,
    'company_wallet.adjust',
    p_request_id,
    request_payload,
    transaction_row.id
  );

  return transaction_row;
end;
$$;


-- ------------------------------------------------------------
-- Security boundary
-- ------------------------------------------------------------

alter table public.company_wallets
  enable row level security;

alter table public.company_wallet_transactions
  enable row level security;

revoke all on table
  public.company_wallets,
  public.company_wallet_transactions
from public, anon, authenticated, service_role;

revoke all on function
  public.app_get_company_wallet(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.app_adjust_company_balance(
    uuid,
    uuid,
    bigint,
    text
  )
from public, anon, authenticated, service_role;

grant execute on function
  public.app_get_company_wallet(uuid)
to authenticated;

grant execute on function
  public.app_adjust_company_balance(
    uuid,
    uuid,
    bigint,
    text
  )
to authenticated;