-- Wolf Forge Platform
-- Recent wallet activity for internal notifications.

create index if not exists
  company_wallet_transactions_created_idx
on public.company_wallet_transactions (
  created_at desc
);

create or replace function
public.app_list_recent_company_wallet_transactions(
  p_limit integer default 10
)
returns table (
  transaction_id uuid,
  company_id uuid,
  company_name text,
  client_name text,
  actor_profile_id uuid,
  actor_display_name text,
  amount_cents bigint,
  balance_after_cents bigint,
  currency text,
  source text,
  reason text,
  created_at timestamptz,
  is_current_actor boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid :=
    private.require_internal_actor();

  safe_limit integer :=
    least(
      greatest(
        coalesce(p_limit, 10),
        1
      ),
      50
    );
begin
  return query
  select
    tx.id as transaction_id,
    tx.company_id,
    company.name as company_name,

    coalesce(
      primary_contact.name,
      company.name
    ) as client_name,

    tx.actor_profile_id,
    profile.display_name
      as actor_display_name,

    tx.amount_cents,
    tx.balance_after_cents,
    tx.currency,
    tx.source,
    tx.reason,
    tx.created_at,

    tx.actor_profile_id = actor_id
      as is_current_actor

  from public.company_wallet_transactions
    as tx

  join public.companies
    as company
    on company.id = tx.company_id
    and company.archived_at is null

  left join public.profiles
    as profile
    on profile.id =
      tx.actor_profile_id

  left join lateral (
    select contact.name
    from public.client_contacts
      as contact
    where
      contact.company_id =
        tx.company_id
      and contact.archived_at
        is null
    order by
      contact.is_primary desc,
      contact.created_at asc
    limit 1
  ) as primary_contact
    on true

  order by tx.created_at desc

  limit safe_limit;
end;
$$;

revoke all on function
public.app_list_recent_company_wallet_transactions(integer)
from public, anon, authenticated, service_role;

grant execute on function
public.app_list_recent_company_wallet_transactions(integer)
to authenticated;