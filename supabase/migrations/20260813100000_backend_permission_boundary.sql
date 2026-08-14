-- Wolf Forge Platform
-- Backend permission boundary for client-private and mixed operational data.
--
-- Existing account roles remain unchanged. Capabilities decide privileged
-- operations, while a client's profile.company_id remains its tenant scope.

-- -----------------------------------------------------------------------------
-- Capability catalog and defaults
-- -----------------------------------------------------------------------------

insert into public.permissions (
  permission_key,
  category,
  label,
  description
)
values
  (
    'client_private.read',
    'clients',
    'Read client-private data',
    'Read private client, portal, wallet, and unassigned project data.'
  ),
  (
    'client_private.manage',
    'clients',
    'Manage client-private data',
    'Perform explicitly authorized client-private administrative mutations.'
  ),
  (
    'client_directory.read',
    'clients',
    'Search client directory',
    'Search the narrow client identity directory without private contact fields.'
  )
on conflict (permission_key) do update
set
  category = excluded.category,
  label = excluded.label,
  description = excluded.description,
  updated_at = now();

insert into public.role_permissions (
  role_id,
  permission_key,
  allowed
)
select
  role_row.id,
  permission_key.permission_key,
  true
from public.roles as role_row
cross join (
  values
    ('client_private.read'::text),
    ('client_private.manage'::text),
    ('client_directory.read'::text)
) as permission_key(permission_key)
where role_row.name = 'admin'
on conflict (role_id, permission_key) do update
set
  allowed = excluded.allowed,
  updated_at = now();

insert into public.role_permissions (
  role_id,
  permission_key,
  allowed
)
select
  role_row.id,
  'client_directory.read',
  true
from public.roles as role_row
where role_row.name in ('manager', 'staff')
on conflict (role_id, permission_key) do update
set
  allowed = excluded.allowed,
  updated_at = now();

-- -----------------------------------------------------------------------------
-- Capability-driven client-private helpers
-- -----------------------------------------------------------------------------

create or replace function private.is_client_private_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_internal_user())
    and private.current_user_has_permission('client_private.read');
$$;

create or replace function private.can_access_client_private_company(
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_company_id is not null
    and exists (
      select 1
      from public.profiles as profile_row
      join public.roles as role_row
        on role_row.id = profile_row.role_id
      join public.companies as company_row
        on company_row.id = p_company_id
       and company_row.archived_at is null
      where profile_row.id = (select auth.uid())
        and profile_row.archived_at is null
        and (
          (
            role_row.name = 'client'
            and profile_row.company_id = p_company_id
          )
          or (
            role_row.name in ('owner', 'admin', 'manager', 'staff')
            and private.current_user_has_permission('client_private.read')
          )
        )
    );
$$;

create or replace function private.require_client_private_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
    or not (select private.is_internal_user())
    or not private.current_user_has_permission('client_private.manage')
  then
    raise exception 'authorized client administration is required'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

create or replace function private.can_access_operational_order(
  p_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_internal_user())
    and exists (
      select 1
      from public.orders as order_row
      where order_row.id = p_order_id
        and order_row.archived_at is null
        and (
          private.current_user_has_permission('client_private.read')
          or order_row.assigned_to_profile_id = (select auth.uid())
          or exists (
            select 1
            from public.order_tasks as task_row
            where task_row.order_id = order_row.id
              and task_row.assigned_to_profile_id = (select auth.uid())
              and task_row.archived_at is null
          )
        )
    );
$$;

create or replace function private.can_access_operational_task(
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_internal_user())
    and exists (
      select 1
      from public.order_tasks as task_row
      join public.orders as order_row
        on order_row.id = task_row.order_id
       and order_row.archived_at is null
      where task_row.id = p_task_id
        and task_row.archived_at is null
        and (
          private.current_user_has_permission('client_private.read')
          or task_row.assigned_to_profile_id = (select auth.uid())
          or order_row.assigned_to_profile_id = (select auth.uid())
        )
    );
$$;

-- -----------------------------------------------------------------------------
-- RLS classification enforcement
--
-- client_contacts: client-private
-- orders/order_tasks: mixed; clients use company scope, internal members use
--                     assignment scope, privileged users use capability scope
-- activity_events: internal operational/mixed, following the related entity
-- services/service_folders: unchanged public/client-safe catalog
-- companies/profiles: unchanged minimal identity/account records
-- wallets: client-private behind controlled RPCs (no direct table grants)
-- -----------------------------------------------------------------------------

drop policy if exists client_contacts_internal_select
on public.client_contacts;

create policy client_contacts_authorized_private_select
on public.client_contacts
for select
to authenticated
using (
  (select private.is_client_private_admin())
  and archived_at is null
);

drop policy if exists orders_internal_select
on public.orders;

create policy orders_internal_scoped_select
on public.orders
for select
to authenticated
using (
  (select private.can_access_operational_order(id))
);

drop policy if exists order_tasks_internal_select
on public.order_tasks;

create policy order_tasks_internal_scoped_select
on public.order_tasks
for select
to authenticated
using (
  (select private.can_access_operational_task(id))
);

drop policy if exists activity_events_internal_select
on public.activity_events;

create policy activity_events_internal_scoped_select
on public.activity_events
for select
to authenticated
using (
  (select private.is_internal_user())
  and (
    (select private.is_client_private_admin())
    or entity_type in ('service', 'service_folder')
    or (
      entity_type = 'order'
      and (select private.can_access_operational_order(entity_id))
    )
    or (
      entity_type = 'order_task'
      and (select private.can_access_operational_task(entity_id))
    )
  )
);

-- -----------------------------------------------------------------------------
-- Client-private mutation backstop
--
-- Existing audited contact RPCs remain intact. This trigger ensures their
-- SECURITY DEFINER ownership cannot turn an internal-only check into broad
-- access to private contact fields.
-- -----------------------------------------------------------------------------

create or replace function private.enforce_client_contact_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  perform private.require_permission('client_private.manage');

  if tg_op = 'INSERT' then
    perform private.require_permission('clients.create');
  elsif tg_op = 'UPDATE' then
    perform private.require_permission('clients.edit');
  else
    perform private.require_permission('clients.archive');
  end if;

  return new;
end;
$$;

drop trigger if exists client_contacts_enforce_permission
on public.client_contacts;

create trigger client_contacts_enforce_permission
before insert or update or delete on public.client_contacts
for each row
execute function private.enforce_client_contact_permission();

-- Wallet writes are client-private administrative operations even when the
-- existing audited RPC is invoked by an authenticated internal profile.
create or replace function private.enforce_company_wallet_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Company creation deterministically provisions an empty wallet through the
  -- database-owned companies_create_wallet trigger. This is not a balance
  -- mutation and remains available to existing operational company creation.
  if tg_table_name = 'company_wallets'
    and tg_op = 'INSERT'
    and new.balance_cents = 0
  then
    return new;
  end if;

  if (select auth.uid()) is not null then
    perform private.require_permission('client_private.manage');
  end if;

  return new;
end;
$$;

drop trigger if exists company_wallets_enforce_permission
on public.company_wallets;

create trigger company_wallets_enforce_permission
before insert or update or delete on public.company_wallets
for each row
execute function private.enforce_company_wallet_permission();

drop trigger if exists company_wallet_transactions_enforce_permission
on public.company_wallet_transactions;

create trigger company_wallet_transactions_enforce_permission
before insert or update or delete on public.company_wallet_transactions
for each row
execute function private.enforce_company_wallet_permission();

-- Mixed operational project mutations must follow both capability and
-- assignment scope. SECURITY DEFINER RPC ownership does not bypass triggers.
create or replace function private.enforce_order_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.require_permission('projects.create');

    if new.assigned_to_profile_id is distinct from (select auth.uid())
      and new.assigned_to_profile_id is not null
    then
      perform private.require_permission('projects.assign');
    end if;

    return new;
  end if;

  if not private.can_access_operational_order(old.id) then
    raise exception 'project access is denied'
      using errcode = '42501';
  end if;

  if new.assigned_to_profile_id is distinct from old.assigned_to_profile_id then
    perform private.require_permission('projects.assign');
  end if;

  if new.archived_at is not null and old.archived_at is null then
    perform private.require_permission('projects.archive');
  else
    perform private.require_permission('projects.edit');
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enforce_permission
on public.orders;

create trigger orders_enforce_permission
before insert or update or delete on public.orders
for each row
execute function private.enforce_order_permission();

create or replace function private.enforce_order_task_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not private.can_access_operational_order(new.order_id) then
      raise exception 'project access is denied'
        using errcode = '42501';
    end if;

    perform private.require_permission('projects.edit');

    if new.assigned_to_profile_id is distinct from (select auth.uid())
      and new.assigned_to_profile_id is not null
    then
      perform private.require_permission('projects.assign');
    end if;

    return new;
  end if;

  if not private.can_access_operational_task(old.id) then
    raise exception 'project task access is denied'
      using errcode = '42501';
  end if;

  perform private.require_permission('projects.edit');

  if new.assigned_to_profile_id is distinct from old.assigned_to_profile_id then
    perform private.require_permission('projects.assign');
  end if;

  return new;
end;
$$;

drop trigger if exists order_tasks_enforce_permission
on public.order_tasks;

create trigger order_tasks_enforce_permission
before insert or update or delete on public.order_tasks
for each row
execute function private.enforce_order_task_permission();

-- -----------------------------------------------------------------------------
-- Company-scoped wallet read
-- -----------------------------------------------------------------------------

create or replace function public.app_get_company_wallet(
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
  perform private.require_client_private_company_access(p_company_id);

  select wallet.*
  into wallet_row
  from public.company_wallets as wallet
  join public.companies as company_row
    on company_row.id = wallet.company_id
  where wallet.company_id = p_company_id
    and company_row.archived_at is null;

  if wallet_row.company_id is null then
    raise no_data_found;
  end if;

  return wallet_row;
end;
$$;

create or replace function public.app_list_recent_company_wallet_transactions(
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
  actor_id uuid := private.require_internal_actor();
  safe_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  perform private.require_permission('client_private.read');

  return query
  select
    transaction_row.id,
    transaction_row.company_id,
    company_row.name,
    coalesce(primary_contact.name, company_row.name),
    transaction_row.actor_profile_id,
    actor_profile.display_name,
    transaction_row.amount_cents,
    transaction_row.balance_after_cents,
    transaction_row.currency,
    transaction_row.source,
    transaction_row.reason,
    transaction_row.created_at,
    transaction_row.actor_profile_id = actor_id
  from public.company_wallet_transactions as transaction_row
  join public.companies as company_row
    on company_row.id = transaction_row.company_id
   and company_row.archived_at is null
  left join public.profiles as actor_profile
    on actor_profile.id = transaction_row.actor_profile_id
  left join lateral (
    select contact_row.name
    from public.client_contacts as contact_row
    where contact_row.company_id = transaction_row.company_id
      and contact_row.archived_at is null
    order by contact_row.is_primary desc, contact_row.created_at asc
    limit 1
  ) as primary_contact on true
  order by transaction_row.created_at desc
  limit safe_limit;
end;
$$;

-- Existing auth administration remains outside Postgres, but the profile and
-- company membership mutation is capability-checked and audited here.
create or replace function public.app_assign_client_profile_to_company(
  p_profile_id uuid,
  p_company_id uuid,
  p_display_name text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles;
  normalized_display_name text := nullif(btrim(p_display_name), '');
begin
  perform private.require_client_private_admin();
  perform private.require_permission('users.create');

  if not exists (
    select 1
    from public.companies as company_row
    where company_row.id = p_company_id
      and company_row.archived_at is null
  ) then
    raise no_data_found;
  end if;

  update public.profiles as target_profile
  set
    company_id = p_company_id,
    display_name = coalesce(normalized_display_name, target_profile.display_name)
  from public.roles as target_role
  where target_profile.id = p_profile_id
    and target_profile.role_id = target_role.id
    and target_role.name = 'client'
    and target_profile.archived_at is null
  returning target_profile.* into profile_row;

  if profile_row.id is null then
    raise no_data_found;
  end if;

  perform private.record_authenticated_activity(
    'profile',
    profile_row.id,
    'profile.company_assigned',
    'Assigned a client portal profile to a company.',
    jsonb_build_object('company_id', profile_row.company_id)
  );

  return profile_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Narrow client directory
-- -----------------------------------------------------------------------------

create or replace function public.app_search_client_directory(
  p_query text,
  p_limit integer default 20
)
returns table (
  client_contact_id uuid,
  client_profile_id uuid,
  display_name text,
  company_id uuid,
  company_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  perform private.require_internal_actor();
  perform private.require_permission('client_directory.read');

  if char_length(normalized_query) < 2 then
    raise exception 'client directory query must contain at least 2 characters'
      using errcode = '22023';
  end if;

  return query
  with directory_rows as (
    select
      contact_row.id as client_contact_id,
      contact_row.profile_id as client_profile_id,
      contact_row.name as display_name,
      company_row.id as company_id,
      company_row.name as company_name
    from public.client_contacts as contact_row
    join public.companies as company_row
      on company_row.id = contact_row.company_id
     and company_row.archived_at is null
    where contact_row.archived_at is null

    union all

    select
      null::uuid,
      profile_row.id,
      coalesce(profile_row.display_name, company_row.name),
      company_row.id,
      company_row.name
    from public.profiles as profile_row
    join public.roles as role_row
      on role_row.id = profile_row.role_id
     and role_row.name = 'client'
    join public.companies as company_row
      on company_row.id = profile_row.company_id
     and company_row.archived_at is null
    where profile_row.archived_at is null
      and not exists (
        select 1
        from public.client_contacts as linked_contact
        where linked_contact.profile_id = profile_row.id
          and linked_contact.archived_at is null
      )

    union all

    select
      null::uuid,
      null::uuid,
      company_row.name,
      company_row.id,
      company_row.name
    from public.companies as company_row
    where company_row.archived_at is null
      and not exists (
        select 1
        from public.client_contacts as company_contact
        where company_contact.company_id = company_row.id
          and company_contact.archived_at is null
      )
      and not exists (
        select 1
        from public.profiles as company_profile
        join public.roles as company_profile_role
          on company_profile_role.id = company_profile.role_id
         and company_profile_role.name = 'client'
        where company_profile.company_id = company_row.id
          and company_profile.archived_at is null
      )
  )
  select
    directory_row.client_contact_id,
    directory_row.client_profile_id,
    directory_row.display_name,
    directory_row.company_id,
    directory_row.company_name
  from directory_rows as directory_row
  where position(normalized_query in lower(directory_row.display_name)) > 0
     or position(normalized_query in lower(directory_row.company_name)) > 0
  order by
    directory_row.company_name,
    directory_row.display_name,
    directory_row.client_profile_id nulls last
  limit safe_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke all on function private.can_access_operational_order(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.can_access_operational_task(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.enforce_client_contact_permission()
from public, anon, authenticated, service_role;
revoke all on function private.enforce_company_wallet_permission()
from public, anon, authenticated, service_role;
revoke all on function private.enforce_order_permission()
from public, anon, authenticated, service_role;
revoke all on function private.enforce_order_task_permission()
from public, anon, authenticated, service_role;

grant execute on function private.can_access_operational_order(uuid)
to authenticated;
grant execute on function private.can_access_operational_task(uuid)
to authenticated;

revoke all on function public.app_search_client_directory(text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.app_search_client_directory(text, integer)
to authenticated;

revoke all on function public.app_get_company_wallet(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.app_get_company_wallet(uuid)
to authenticated;

revoke all on function public.app_list_recent_company_wallet_transactions(integer)
from public, anon, authenticated, service_role;
grant execute on function public.app_list_recent_company_wallet_transactions(integer)
to authenticated;

revoke all on function public.app_assign_client_profile_to_company(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.app_assign_client_profile_to_company(uuid, uuid, text)
to authenticated;

-- Security-sensitive configuration is read-only even at the ordinary trusted
-- server boundary. Future changes must use an audited administrative RPC.
revoke all on table
  public.permissions,
  public.role_permissions,
  public.profile_permission_overrides
from service_role;

grant select on table
  public.permissions,
  public.role_permissions,
  public.profile_permission_overrides
to service_role;

comment on function private.is_client_private_admin()
is 'True for active internal profiles with the explicit client_private.read capability; normal membership alone is insufficient.';

comment on function private.can_access_client_private_company(uuid)
is 'Allows an active client in its own active company or an active internal profile with client_private.read.';

comment on function public.app_search_client_directory(text, integer)
is 'Capability-gated internal search exposing only contact/profile identity and company identity fields.';
