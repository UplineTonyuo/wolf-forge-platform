-- Wolf Forge investment intent.
--
-- The client portal Store cart is browser state (localStorage) and stays that
-- way: it is a browsing feature, and nothing here changes how it behaves. What
-- this migration adds is the durable sales signal underneath it. When a client
-- adds an investment to their cart, the server records that the company showed
-- interest in that service, so Wolf Forge learns about buying intent before the
-- client opens a conversation.
--
-- This is NOT checkout, an order, a project or a charge. The database still
-- refuses client-initiated projects and there is still no client payment
-- surface. An interest row is a sales intelligence record and nothing else.
--
-- Naming follows the existing split: the table is named for what the code calls
-- things (services), while the module, capabilities and route are named for what
-- the internal product calls it (Investment Intent) -- the same relationship
-- public.orders has with the "Projects" module.

-- -----------------------------------------------------------------------------
-- Interest records
--
-- One durable row per (company, service). Repeated adds do not accumulate rows,
-- and a removal never deletes one: "this client wanted this and then dropped it"
-- is exactly the intelligence the workspace exists to show.
-- -----------------------------------------------------------------------------

create table public.service_interests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,

  status text not null default 'new',
  in_cart boolean not null default true,
  add_count integer not null default 1,

  first_added_at timestamptz not null default now(),
  last_added_at timestamptz not null default now(),
  removed_at timestamptz,

  -- The last CLIENT-side event (add or remove). Internal triage deliberately
  -- does not touch it, so workspace ordering always means "newest buying
  -- signal" rather than "most recently administered".
  last_activity_at timestamptz not null default now(),

  contacted_at timestamptz,
  contacted_by_profile_id uuid references public.profiles (id) on delete set null,
  signalled_by_profile_id uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint service_interests_company_service_unique
    unique (company_id, service_id),

  constraint service_interests_status_valid check (
    status in ('new', 'reviewing', 'contacted', 'qualified', 'closed', 'not_interested')
  ),

  -- in_cart and removed_at describe the same fact and may never disagree.
  constraint service_interests_cart_state_consistent check (
    (in_cart and removed_at is null)
    or (not in_cart and removed_at is not null)
  ),

  constraint service_interests_add_count_positive check (add_count >= 1),

  constraint service_interests_added_order check (last_added_at >= first_added_at)
);

comment on table public.service_interests is
  'Durable client buying-interest signals, one row per company and service. Written only by app_record_store_interest from an authenticated client session; the company is derived from auth.uid() and is never supplied by the caller.';

comment on column public.service_interests.in_cart is
  'Last recorded cart state, not a guaranteed live mirror of the browser cart. Intent tracking is a best-effort side effect of a local-first cart.';

comment on column public.service_interests.add_count is
  'Number of times this interest became active. Increments only on a genuine remove then re-add, so it is a renewed-interest counter rather than a click counter.';

comment on column public.service_interests.last_activity_at is
  'Timestamp of the latest client add or remove. Internal status changes never move it.';

create index service_interests_activity_idx
  on public.service_interests (last_activity_at desc, id);

create index service_interests_status_activity_idx
  on public.service_interests (status, last_activity_at desc);

create index service_interests_in_cart_idx
  on public.service_interests (last_activity_at desc)
  where in_cart;

create index service_interests_company_idx
  on public.service_interests (company_id);

create index service_interests_service_idx
  on public.service_interests (service_id);

create trigger service_interests_set_updated_at
before update on public.service_interests
for each row
execute function private.set_updated_at();

-- Every real path is a SECURITY DEFINER RPC, so no application role holds table
-- privileges. The select policy below is defence in depth, not the boundary.
alter table public.service_interests enable row level security;
alter table public.service_interests force row level security;

revoke all on table public.service_interests
  from public, anon, authenticated, service_role;

-- Internal viewers only. There is deliberately no client policy: the portal cart
-- is local and needs no server read, so a client account can read no interest
-- row at all -- including its own company's.
create policy service_interests_internal_select
on public.service_interests
for select
to authenticated
using (
  private.is_internal_user()
  and private.current_user_has_permission('investment_intent.view')
);

-- -----------------------------------------------------------------------------
-- Capabilities and module
--
-- Internal-class only. Because no client-class module requires these keys and
-- the client preset never holds them, private.is_client_eligible_permission()
-- reports false for both and a client account cannot be granted them even
-- through the per-profile override path.
-- -----------------------------------------------------------------------------

insert into public.permissions (
  permission_key,
  category,
  label,
  description
)
values
  (
    'investment_intent.view',
    'investment_intent',
    'View investment intent',
    'View the internal Investment Intent workspace of client buying signals.'
  ),
  (
    'investment_intent.manage',
    'investment_intent',
    'Manage investment intent',
    'Move an investment intent through its internal sales workflow status.'
  )
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

-- Owner resolves through the preset bypass but is granted explicitly, matching
-- every other seed. Manager and staff receive nothing: this is an owner/admin
-- sales surface until someone with users.manage_permissions decides otherwise.
insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key_value, true
from public.roles as role_row
cross join unnest(array['investment_intent.view', 'investment_intent.manage'])
  as permission_key_value
where role_row.name in ('owner', 'admin')
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- sort_order 85 sits between Coupons (80) and Services (90).
insert into public.permission_modules (
  module_key,
  label,
  account_class,
  required_permission_key,
  sort_order
)
values ('investment_intent', 'Investment Intent', 'internal', 'investment_intent.view', 85)
on conflict (module_key) do update
set label = excluded.label,
    account_class = excluded.account_class,
    required_permission_key = excluded.required_permission_key,
    sort_order = excluded.sort_order,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Shared constraint widenings
-- -----------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_category_valid;
alter table public.notifications add constraint notifications_category_valid check (
  category in (
    'project',
    'client',
    'form',
    'coupon',
    'ticket',
    'payment',
    'wallet',
    'store'
  )
);

alter table public.activity_events drop constraint activity_events_entity_type_valid;
alter table public.activity_events add constraint activity_events_entity_type_valid check (
  entity_type in (
    'company', 'client_contact', 'service_folder', 'service', 'order',
    'order_task', 'profile', 'coupon', 'invoice', 'subscription',
    'form', 'form_assignment', 'form_submission', 'ticket', 'service_interest'
  )
);

-- -----------------------------------------------------------------------------
-- Client identity
--
-- The same shape app_get_client_account_context() requires: a live client
-- profile attached to a live company. Interest is recorded for this company and
-- there is no parameter through which another one could be named.
-- -----------------------------------------------------------------------------

create function private.current_store_client()
returns table (profile_id uuid, company_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select profile_row.id, company_row.id
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id
   and company_row.archived_at is null
  where profile_row.id = (select auth.uid())
    and profile_row.archived_at is null
    and role_row.name = 'client';
$$;

-- -----------------------------------------------------------------------------
-- Internal notification fan-out
--
-- private.emit_internal_notification() reaches every internal role. Investment
-- intent is an owner/admin sales surface, so recipients are derived from the
-- capability instead: whoever holds investment_intent.view is told, and nobody
-- else. Granting the capability later automatically starts the notifications.
--
-- Content is composed entirely server-side inside this function, so a client
-- session can cause a notification but can never author one.
-- -----------------------------------------------------------------------------

create function private.emit_investment_intent_notification(
  p_event_key text,
  p_title text,
  p_body text,
  p_intent_id uuid,
  p_company_id uuid,
  p_actor_profile_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key
  )
  select
    profile.id,
    p_company_id,
    'internal',
    'store',
    'info',
    p_title,
    p_body,
    '/investment-intent?intent=' || p_intent_id::text,
    'service_interest',
    p_intent_id,
    p_actor_profile_id,
    p_event_key
  from public.profiles as profile
  join public.roles as role
    on role.id = profile.role_id
  where profile.archived_at is null
    and role.name in ('owner', 'admin', 'manager', 'staff')
    and private.profile_has_permission(profile.id, 'investment_intent.view')
  on conflict (recipient_profile_id, event_key) do nothing;
$$;

-- -----------------------------------------------------------------------------
-- Client write path
--
-- One entry point for add, re-add and remove, taking service ids only. The
-- company comes from private.current_store_client(), and app_require_module_access
-- ('portal_store') proves both that the caller is a client-class account and
-- that it holds store.view -- which is also why an internal session is rejected
-- here rather than quietly writing interest on a client's behalf.
--
-- Array-shaped so clearing a cart is one statement rather than one round trip
-- per row. Ineligible service ids are skipped silently: erroring would turn this
-- into an oracle for which services exist.
-- -----------------------------------------------------------------------------

create function public.app_record_store_interest(
  p_service_ids uuid[],
  p_in_cart boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_actor record;
  service_row public.services;
  interest_row public.service_interests;
  prior_row public.service_interests;
  company_name text;
  distinct_ids uuid[];
  service_id_value uuid;
  written integer := 0;
begin
  if p_service_ids is null
    or p_in_cart is null
    or array_length(p_service_ids, 1) is null
    or array_length(p_service_ids, 1) > 12
    or exists (
      select 1 from unnest(p_service_ids) as candidate where candidate is null
    )
  then
    raise exception 'invalid Store interest input' using errcode = '22023';
  end if;

  select * into client_actor from private.current_store_client();

  if client_actor.profile_id is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_store');

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = client_actor.company_id;

  select array_agg(distinct entry) into distinct_ids
  from unnest(p_service_ids) as entry;

  foreach service_id_value in array distinct_ids
  loop
    -- Re-states services_authenticated_select_active, because RLS does not
    -- apply inside a SECURITY DEFINER function.
    select * into service_row
    from public.services as candidate
    where candidate.id = service_id_value
      and candidate.is_active
      and candidate.is_public
      and candidate.archived_at is null;

    if service_row.id is null then
      continue;
    end if;

    select * into prior_row
    from public.service_interests as existing
    where existing.company_id = client_actor.company_id
      and existing.service_id = service_id_value
    for update;

    if p_in_cart then
      if prior_row.id is null then
        insert into public.service_interests (
          company_id,
          service_id,
          status,
          in_cart,
          add_count,
          first_added_at,
          last_added_at,
          last_activity_at,
          signalled_by_profile_id
        )
        values (
          client_actor.company_id,
          service_id_value,
          'new',
          true,
          1,
          now(),
          now(),
          now(),
          client_actor.profile_id
        )
        on conflict (company_id, service_id) do nothing
        returning * into interest_row;

        -- A concurrent first add won the race and already emitted the signal.
        if interest_row.id is null then
          continue;
        end if;

        written := written + 1;

        perform private.emit_investment_intent_notification(
          'service-interest-new:' || interest_row.id::text,
          'New investment interest',
          coalesce(company_name, 'A client') || ' showed interest in ' || service_row.name || '.',
          interest_row.id,
          client_actor.company_id,
          client_actor.profile_id
        );

      elsif not prior_row.in_cart then
        -- Renewed interest. status is deliberately untouched: a client re-adding
        -- something must not silently reopen a decision William already made.
        -- The renewal shows up as activity, add_count and a notification.
        update public.service_interests as target
        set in_cart = true,
            removed_at = null,
            last_added_at = now(),
            last_activity_at = now(),
            add_count = target.add_count + 1
        where target.id = prior_row.id
        returning * into interest_row;

        written := written + 1;

        perform private.emit_investment_intent_notification(
          'service-interest-renewed:' || interest_row.id::text || ':' || interest_row.add_count::text,
          'Renewed investment interest',
          coalesce(company_name, 'A client') || ' added ' || service_row.name || ' back to their cart.',
          interest_row.id,
          client_actor.company_id,
          client_actor.profile_id
        );
      end if;

      -- Already in the cart: no write, no notification, and no reordering of
      -- the workspace from a repeated click.

    else
      if prior_row.id is not null and prior_row.in_cart then
        -- History is preserved. Removal is a state change, never a delete.
        update public.service_interests as target
        set in_cart = false,
            removed_at = now(),
            last_activity_at = now()
        where target.id = prior_row.id;

        written := written + 1;
      end if;

      -- Removing something that was never signalled creates nothing.
    end if;
  end loop;

  return written;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal read model
--
-- Filtering happens in the browser over one payload, the same way the Tickets
-- list and the Store catalogue work, so this takes no filter parameters.
-- -----------------------------------------------------------------------------

create function public.app_list_investment_intents(
  p_limit integer default 200
)
returns table (
  intent_id uuid,
  company_id uuid,
  company_name text,
  service_id uuid,
  service_name text,
  folder_name text,
  price numeric,
  currency text,
  recurring boolean,
  recurring_price numeric,
  recurring_interval_length integer,
  recurring_interval_unit text,
  status text,
  in_cart boolean,
  add_count integer,
  first_added_at timestamptz,
  last_added_at timestamptz,
  removed_at timestamptz,
  last_activity_at timestamptz,
  contacted_at timestamptz,
  contacted_by_profile_id uuid,
  contacted_by_name text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  perform public.app_require_module_access('investment_intent');

  return query
  select
    interest.id,
    interest.company_id,
    company_row.name,
    interest.service_id,
    service_row.name,
    folder_row.name,
    service_row.price,
    service_row.currency,
    service_row.recurring,
    service_row.recurring_price,
    service_row.recurring_interval_length,
    service_row.recurring_interval_unit,
    interest.status,
    interest.in_cart,
    interest.add_count,
    interest.first_added_at,
    interest.last_added_at,
    interest.removed_at,
    interest.last_activity_at,
    interest.contacted_at,
    interest.contacted_by_profile_id,
    contacted_profile.display_name,
    interest.updated_at
  from public.service_interests as interest
  join public.companies as company_row
    on company_row.id = interest.company_id
  join public.services as service_row
    on service_row.id = interest.service_id
  left join public.service_folders as folder_row
    on folder_row.id = service_row.folder_id
  left join public.profiles as contacted_profile
    on contacted_profile.id = interest.contacted_by_profile_id
  order by interest.last_activity_at desc, interest.id
  limit row_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal workflow status
--
-- last_activity_at is deliberately not touched: triage is not buying interest,
-- and moving the row would corrupt the ordering the workspace depends on.
-- -----------------------------------------------------------------------------

create function public.app_set_investment_intent_status(
  p_intent_id uuid,
  p_status text
)
returns public.service_interests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  interest_row public.service_interests;
  previous_status text;
begin
  if p_intent_id is null
    or p_status is null
    or p_status not in ('new', 'reviewing', 'contacted', 'qualified', 'closed', 'not_interested')
  then
    raise exception 'invalid Investment Intent status input' using errcode = '22023';
  end if;

  perform public.app_require_module_access('investment_intent');
  perform private.require_permission('investment_intent.manage');
  actor_id := private.require_internal_actor();

  select * into interest_row
  from public.service_interests as existing
  where existing.id = p_intent_id
  for update;

  if interest_row.id is null then
    raise exception 'Investment Intent access is denied' using errcode = '42501';
  end if;

  previous_status := interest_row.status;

  if previous_status = p_status then
    return interest_row;
  end if;

  update public.service_interests as target
  set status = p_status,
      contacted_at = case
        when p_status = 'contacted' and target.contacted_at is null then now()
        else target.contacted_at
      end,
      contacted_by_profile_id = case
        when p_status = 'contacted' and target.contacted_at is null then actor_id
        else target.contacted_by_profile_id
      end
  where target.id = p_intent_id
  returning * into interest_row;

  perform private.record_authenticated_activity(
    'service_interest',
    interest_row.id,
    'service_interest.status_changed',
    'Updated Investment Intent status.',
    jsonb_build_object(
      'company_id', interest_row.company_id,
      'service_id', interest_row.service_id,
      'previous_status', previous_status,
      'status', p_status
    )
  );

  return interest_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function boundary
-- -----------------------------------------------------------------------------

revoke all on function private.current_store_client()
  from public, anon, authenticated, service_role;
revoke all on function private.emit_investment_intent_notification(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.app_record_store_interest(uuid[], boolean)
  from public, anon, service_role;
revoke all on function public.app_list_investment_intents(integer)
  from public, anon, service_role;
revoke all on function public.app_set_investment_intent_status(uuid, text)
  from public, anon, service_role;

grant execute on function public.app_record_store_interest(uuid[], boolean)
  to authenticated;
grant execute on function public.app_list_investment_intents(integer)
  to authenticated;
grant execute on function public.app_set_investment_intent_status(uuid, text)
  to authenticated;

comment on function public.app_record_store_interest(uuid[], boolean) is
  'Records client buying interest for Store investments. Company identity is derived from auth.uid(); callers supply service ids only. First add and re-add after removal notify internal holders of investment_intent.view; a repeated add while already active writes and notifies nothing.';

comment on function public.app_list_investment_intents(integer) is
  'Internal Investment Intent read model, ordered by latest client activity. Gated by the investment_intent module.';

comment on function public.app_set_investment_intent_status(uuid, text) is
  'Moves an investment intent through its internal sales workflow. Requires investment_intent.manage and never alters client activity timestamps.';
