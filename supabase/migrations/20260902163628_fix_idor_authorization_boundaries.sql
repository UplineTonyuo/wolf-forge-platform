-- Wolf Forge Platform
-- Phase 1 authorization hardening / compatibility bridge.
-- Close three RPC IDOR/BOLA paths and add the narrow operational assignee
-- read model before the final profiles RLS boundary is deployed in Phase 2.

-- =============================================================================
-- Archived contacts must pass capability checks before a definer-owned read.
-- =============================================================================

create or replace function public.app_archive_contact(p_contact_id uuid)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  perform private.require_permission('client_private.manage');
  perform private.require_permission('clients.archive');

  select contact.*
  into contact_row
  from public.client_contacts as contact
  where contact.id = p_contact_id
  for update;

  if contact_row.id is null then
    raise no_data_found;
  end if;

  if contact_row.archived_at is not null then
    return contact_row;
  end if;

  update public.client_contacts
  set archived_at = now(),
      is_primary = false
  where id = p_contact_id
  returning * into contact_row;

  perform private.record_authenticated_activity(
    'client_contact',
    contact_row.id,
    'contact.archived',
    format('Archived client contact %s.', contact_row.name)
  );

  return contact_row;
end;
$$;


-- =============================================================================
-- Manual wallet adjustments must authorize before validating caller input,
-- resolving the company/request, locking the wallet, or comparing its balance.
-- =============================================================================

create or replace function public.app_adjust_company_balance(
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
  actor_id uuid;
  normalized_reason text;
  request_payload jsonb;
  existing_id uuid;
  wallet_row public.company_wallets;
  transaction_row public.company_wallet_transactions;
  new_balance bigint;
  source_value text;
  formatted_amount text;
begin
  actor_id := private.require_internal_actor();
  perform private.require_permission('client_private.manage');

  normalized_reason := nullif(btrim(p_reason), '');

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

  request_payload := jsonb_build_object(
    'company_id', p_company_id,
    'amount_cents', p_amount_cents,
    'reason', normalized_reason
  );

  existing_id := private.find_create_request(
    actor_id,
    'company_wallet.adjust',
    p_request_id,
    request_payload
  );

  if existing_id is not null then
    select transaction.*
    into transaction_row
    from public.company_wallet_transactions as transaction
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

  new_balance := wallet_row.balance_cents + p_amount_cents;

  if new_balance < 0 then
    raise exception 'insufficient client balance'
      using errcode = '22023';
  end if;

  update public.company_wallets
  set balance_cents = new_balance
  where company_id = p_company_id
  returning * into wallet_row;

  source_value := case
    when p_amount_cents > 0 then 'manual_credit'
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
  returning * into transaction_row;

  formatted_amount := to_char(
    abs(p_amount_cents)::numeric / 100,
    'FM999999999999990.00'
  );

  perform private.record_authenticated_activity(
    'company',
    p_company_id,
    'company.updated',
    case
      when p_amount_cents > 0 then format(
        'Added $%s to client balance.',
        formatted_amount
      )
      else format(
        'Deducted $%s from client balance.',
        formatted_amount
      )
    end,
    jsonb_build_object(
      'field', 'balance',
      'transaction_id', transaction_row.id,
      'amount_cents', p_amount_cents,
      'balance_after_cents', new_balance,
      'currency', wallet_row.currency,
      'reason', normalized_reason
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


-- =============================================================================
-- Archived projects must pass the same real-row assignment/private-client scope
-- as active projects, plus projects.archive, before an idempotent row return.
-- =============================================================================

create or replace function public.app_archive_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  order_row public.orders;
begin
  select project.*
  into order_row
  from public.orders as project
  where project.id = p_order_id
  for update;

  if order_row.id is null then
    raise no_data_found;
  end if;

  if not coalesce((
    private.current_user_has_permission('client_private.read')
    or order_row.assigned_to_profile_id = actor_id
    or exists (
      select 1
      from public.order_tasks as task_row
      where task_row.order_id = order_row.id
        and task_row.assigned_to_profile_id = actor_id
        and task_row.archived_at is null
    )
  ), false) then
    raise exception 'project access is denied'
      using errcode = '42501';
  end if;

  perform private.require_permission('projects.archive');

  if order_row.archived_at is not null then
    return order_row;
  end if;

  update public.orders
  set archived_at = now()
  where id = p_order_id
  returning * into order_row;

  perform private.record_authenticated_activity(
    'order',
    order_row.id,
    'order.archived',
    format('Archived project %s.', order_row.order_number)
  );

  return order_row;
end;
$$;


-- =============================================================================
-- Compatibility bridge: operational pickers move to a narrow read model before
-- Phase 2 removes broad direct profile visibility from internal callers.
-- =============================================================================

create or replace function public.app_list_operational_assignees()
returns table (
  profile_id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();

  return query
  select profile_row.id, profile_row.display_name
  from public.profiles as profile_row
  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  where profile_row.archived_at is null
    and preset_row.account_class = 'internal'
  order by
    coalesce(nullif(btrim(profile_row.display_name), ''), '~'),
    profile_row.id;
end;
$$;

-- CREATE OR REPLACE preserves existing ACLs, but restate the public API surface
-- so the migration is independently reviewable and cannot inherit PUBLIC access.
revoke all on function public.app_archive_contact(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.app_archive_contact(uuid)
to authenticated;

revoke all on function public.app_adjust_company_balance(uuid, uuid, bigint, text)
from public, anon, authenticated, service_role;
grant execute on function public.app_adjust_company_balance(uuid, uuid, bigint, text)
to authenticated;

revoke all on function public.app_archive_order(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.app_archive_order(uuid)
to authenticated;

comment on function public.app_archive_contact(uuid) is
  'Archives a contact idempotently after internal, client-private, and archive authorization. No contact row is returned before capability checks.';

comment on function public.app_adjust_company_balance(uuid, uuid, bigint, text) is
  'Performs an idempotent manual wallet adjustment. client_private.manage is checked before input, company, request, wallet, or balance-dependent processing.';

comment on function public.app_archive_order(uuid) is
  'Archives a project idempotently after authorizing the actual row against private-client or assignment scope and projects.archive.';

revoke all on function public.app_list_operational_assignees()
from public, anon, authenticated, service_role;
grant execute on function public.app_list_operational_assignees()
to authenticated;

comment on function public.app_list_operational_assignees() is
  'Narrow active-internal assignee projection for operational pickers. Derives the caller from auth.uid() and exposes only profile ID and display name.';
