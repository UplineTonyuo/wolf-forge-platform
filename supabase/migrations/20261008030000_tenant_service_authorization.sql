-- WL-2.7 (KI-111, Services + investment intents): Service authorization is
-- bound to the current Tenant.
--
-- Concrete attack closed: the services / service_folders SELECT policies
-- (internal and active-catalog branches) and the Service RPCs ignored
-- services.tenant_id, so any internal member of the caller's current Tenant
-- with services.view read every Tenant's Services and folders (and global
-- search listed their names), and with services.edit / archive / create could
-- update, archive or duplicate another Tenant's Service by id - duplicate
-- copied a foreign Service's content into the caller's Tenant. Folder archive
-- and folder subscription eligibility also rewrote the foreign folder's
-- Services. app_list_investment_intents listed every Tenant's intents and
-- app_set_investment_intent_status changed any intent by id. Clients could
-- get a coupon quote for another Tenant's public Service by id, and purchase
-- and store interest reached it (the composite FKs blocked the write).
--
-- Pattern (D-272, no new helper): every Service / folder / intent lookup and
-- the SELECT policies add tenant_id = private.current_tenant_id(); a foreign
-- row behaves like a missing one. Investment intents use their own tenant_id
-- (composite FKs to the Service and the Company). New Services / folders
-- take tenant_id from trusted context and their folder / parent / assignee
-- are held to that Tenant by composite FKs and the WL-2.4 assignee trigger;
-- the active-folder / folder-parent triggers only accept a folder of the
-- row's own Tenant, so a foreign folder id fails like a missing one (no
-- existence oracle through the FK error); create / duplicate replays return
-- only current-Tenant rows.
--
-- Not changed: KI-109 client identity in the purchase flow, Companies,
-- dashboard, Forms, notifications, the Tenant-less activity_events feed
-- (Service activity summaries) and the global coupon-code lookup in
-- private.calculate_coupon (later KI-111 slices).

alter policy services_internal_select on public.services
  using ((select private.is_internal_user()) and public.app_has_permission('services.view')
    and tenant_id = (select private.current_tenant_id()));
alter policy services_authenticated_select_active on public.services
  using (is_active and is_public and archived_at is null
    and tenant_id = (select private.current_tenant_id()));
alter policy service_folders_internal_select on public.service_folders
  using ((select private.is_internal_user()) and public.app_has_permission('services.view')
    and tenant_id = (select private.current_tenant_id()));
alter policy service_folders_authenticated_select_active on public.service_folders
  using (archived_at is null and tenant_id = (select private.current_tenant_id()));
alter policy service_interests_internal_select on public.service_interests
  using (private.is_internal_user() and private.current_user_has_permission('investment_intent.view')
    and tenant_id = (select private.current_tenant_id()));

create or replace function public.app_archive_service(p_service_id uuid)
 returns public.services
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  service_row public.services;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.archive');

  select service.* into service_row
  from public.services as service
  where service.id = p_service_id
    and service.tenant_id = (select private.current_tenant_id())
  for update;

  if service_row.id is null then raise no_data_found; end if;
  if service_row.archived_at is not null then return service_row; end if;

  update public.services
  set archived_at = now(), is_active = false
  where id = p_service_id
  returning * into service_row;

  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.archived',
    format('Archived service %s.', service_row.name)
  );
  return service_row;
end;
$$;

create or replace function public.app_update_service(p_service_id uuid, p_patch jsonb)
 returns public.services
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  service_row public.services;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.edit');

  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array[
      'name', 'folder_id', 'description', 'price', 'currency', 'image_url',
      'is_active', 'is_public', 'recurring', 'recurring_price',
      'recurring_interval_length', 'recurring_interval_unit',
      'recurring_action', 'group_quantities', 'assigned_to_profile_id',
      'deadline_amount', 'deadline_unit', 'require_client_profile', 'sort_order',
      'subscription_eligible'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid service update patch'
      using errcode = '22023';
  end if;

  update public.services
  set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
    folder_id = case when p_patch ? 'folder_id' then (p_patch ->> 'folder_id')::uuid else folder_id end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
    price = case when p_patch ? 'price' then (p_patch ->> 'price')::numeric else price end,
    currency = case when p_patch ? 'currency' then p_patch ->> 'currency' else currency end,
    image_url = case when p_patch ? 'image_url' then p_patch ->> 'image_url' else image_url end,
    is_active = case when p_patch ? 'is_active' then (p_patch ->> 'is_active')::boolean else is_active end,
    is_public = case when p_patch ? 'is_public' then (p_patch ->> 'is_public')::boolean else is_public end,
    recurring = case when p_patch ? 'recurring' then (p_patch ->> 'recurring')::boolean else recurring end,
    recurring_price = case when p_patch ? 'recurring_price' then (p_patch ->> 'recurring_price')::numeric else recurring_price end,
    recurring_interval_length = case when p_patch ? 'recurring_interval_length' then (p_patch ->> 'recurring_interval_length')::integer else recurring_interval_length end,
    recurring_interval_unit = case when p_patch ? 'recurring_interval_unit' then p_patch ->> 'recurring_interval_unit' else recurring_interval_unit end,
    recurring_action = case when p_patch ? 'recurring_action' then p_patch ->> 'recurring_action' else recurring_action end,
    group_quantities = case when p_patch ? 'group_quantities' then (p_patch ->> 'group_quantities')::boolean else group_quantities end,
    assigned_to_profile_id = case when p_patch ? 'assigned_to_profile_id' then (p_patch ->> 'assigned_to_profile_id')::uuid else assigned_to_profile_id end,
    deadline_amount = case when p_patch ? 'deadline_amount' then (p_patch ->> 'deadline_amount')::integer else deadline_amount end,
    deadline_unit = case when p_patch ? 'deadline_unit' then p_patch ->> 'deadline_unit' else deadline_unit end,
    require_client_profile = case when p_patch ? 'require_client_profile' then (p_patch ->> 'require_client_profile')::boolean else require_client_profile end,
    sort_order = case when p_patch ? 'sort_order' then (p_patch ->> 'sort_order')::integer else sort_order end,
    subscription_eligible = case when p_patch ? 'subscription_eligible' then (p_patch ->> 'subscription_eligible')::boolean else subscription_eligible end
  where id = p_service_id
    and tenant_id = (select private.current_tenant_id())
    and archived_at is null
  returning * into service_row;

  if service_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.updated',
    format('Updated service %s.', service_row.name),
    jsonb_build_object('folder_id', service_row.folder_id)
  );
  return service_row;
end;
$$;

create or replace function public.app_duplicate_service(p_request_id uuid, p_service_id uuid)
 returns public.services
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object('service_id', p_service_id);
  existing_id uuid;
  source_row public.services;
  service_row public.services;
begin
  perform public.app_require_module_access('services');
  perform private.require_permission('services.create');

  existing_id := private.find_create_request(
    actor_id,
    'service.duplicate',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select service.* into service_row
    from public.services as service
    where service.id = existing_id
      and service.tenant_id = (select private.current_tenant_id());
    if service_row.id is null then raise no_data_found; end if;
    return service_row;
  end if;

  select service.* into source_row
  from public.services as service
  where service.id = p_service_id
    and service.tenant_id = (select private.current_tenant_id())
    and service.archived_at is null;
  if source_row.id is null then raise no_data_found; end if;

  insert into public.services (
    name, folder_id, description, price, currency, image_url, is_active,
    is_public, recurring, recurring_price, recurring_interval_length,
    recurring_interval_unit, recurring_action, group_quantities,
    assigned_to_profile_id, deadline_amount, deadline_unit,
    require_client_profile, sort_order
  ) values (
    source_row.name || ' (Copy)', source_row.folder_id, source_row.description,
    source_row.price, source_row.currency, source_row.image_url,
    source_row.is_active, source_row.is_public, source_row.recurring,
    source_row.recurring_price, source_row.recurring_interval_length,
    source_row.recurring_interval_unit, source_row.recurring_action,
    source_row.group_quantities, source_row.assigned_to_profile_id,
    source_row.deadline_amount, source_row.deadline_unit,
    source_row.require_client_profile, source_row.sort_order + 1
  ) returning * into service_row;

  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.duplicated',
    format('Duplicated service %s.', source_row.name),
    jsonb_build_object('source_service_id', source_row.id)
  );
  perform private.remember_create_request(
    actor_id,
    'service.duplicate',
    p_request_id,
    request_payload,
    service_row.id
  );
  return service_row;
end;
$$;

create or replace function public.app_create_service(p_request_id uuid, p_payload jsonb)
 returns public.services
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  existing_id uuid;
  service_row public.services;
begin
  perform public.app_require_module_access('services');
  perform private.require_permission('services.create');

  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or not p_payload ? 'name'
    or jsonb_typeof(p_payload -> 'name') <> 'string'
    or btrim(p_payload ->> 'name') = ''
    or p_payload - array[
      'name', 'folder_id', 'description', 'price', 'currency', 'image_url',
      'is_active', 'is_public', 'recurring', 'recurring_price',
      'recurring_interval_length', 'recurring_interval_unit',
      'recurring_action', 'group_quantities', 'assigned_to_profile_id',
      'deadline_amount', 'deadline_unit', 'require_client_profile', 'sort_order',
      'subscription_eligible'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid service create payload'
      using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id,
    'service.create',
    p_request_id,
    p_payload
  );
  if existing_id is not null then
    select service.* into service_row
    from public.services as service
    where service.id = existing_id
      and service.tenant_id = (select private.current_tenant_id());
    if service_row.id is null then raise no_data_found; end if;
    return service_row;
  end if;

  insert into public.services (
    name,
    folder_id,
    description,
    price,
    currency,
    image_url,
    is_active,
    is_public,
    recurring,
    recurring_price,
    recurring_interval_length,
    recurring_interval_unit,
    recurring_action,
    group_quantities,
    assigned_to_profile_id,
    deadline_amount,
    deadline_unit,
    require_client_profile,
    sort_order,
    subscription_eligible
  )
  values (
    p_payload ->> 'name',
    (p_payload ->> 'folder_id')::uuid,
    p_payload ->> 'description',
    coalesce((p_payload ->> 'price')::numeric, 0),
    coalesce(p_payload ->> 'currency', 'USD'),
    p_payload ->> 'image_url',
    coalesce((p_payload ->> 'is_active')::boolean, true),
    coalesce((p_payload ->> 'is_public')::boolean, true),
    coalesce((p_payload ->> 'recurring')::boolean, false),
    (p_payload ->> 'recurring_price')::numeric,
    (p_payload ->> 'recurring_interval_length')::integer,
    p_payload ->> 'recurring_interval_unit',
    p_payload ->> 'recurring_action',
    coalesce((p_payload ->> 'group_quantities')::boolean, false),
    (p_payload ->> 'assigned_to_profile_id')::uuid,
    (p_payload ->> 'deadline_amount')::integer,
    p_payload ->> 'deadline_unit',
    coalesce((p_payload ->> 'require_client_profile')::boolean, false),
    coalesce((p_payload ->> 'sort_order')::integer, 0),
    coalesce((p_payload ->> 'subscription_eligible')::boolean, false)
  )
  returning * into service_row;

  perform private.record_authenticated_activity(
    'service',
    service_row.id,
    'service.created',
    format('Created service %s.', service_row.name),
    jsonb_build_object('folder_id', service_row.folder_id)
  );
  perform private.remember_create_request(
    actor_id,
    'service.create',
    p_request_id,
    p_payload,
    service_row.id
  );
  return service_row;
end;
$$;

create or replace function public.app_create_service_folder(p_request_id uuid, p_name text, p_description text default NULL::text, p_parent_id uuid default NULL::uuid, p_sort_order integer default 0)
 returns public.service_folders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'name', p_name,
    'description', p_description,
    'parent_id', p_parent_id,
    'sort_order', p_sort_order
  );
  existing_id uuid;
  folder_row public.service_folders;
begin
  perform public.app_require_module_access('services');
  perform private.require_permission('services.create');

  existing_id := private.find_create_request(
    actor_id,
    'service_folder.create',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select folder.* into folder_row
    from public.service_folders as folder
    where folder.id = existing_id
      and folder.tenant_id = (select private.current_tenant_id());
    if folder_row.id is null then raise no_data_found; end if;
    return folder_row;
  end if;

  insert into public.service_folders (name, description, parent_id, sort_order)
  values (p_name, p_description, p_parent_id, p_sort_order)
  returning * into folder_row;

  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.created',
    format('Created service folder %s.', folder_row.name)
  );
  perform private.remember_create_request(
    actor_id,
    'service_folder.create',
    p_request_id,
    request_payload,
    folder_row.id
  );
  return folder_row;
end;
$$;

create or replace function public.app_update_service_folder(p_folder_id uuid, p_patch jsonb)
 returns public.service_folders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  folder_row public.service_folders;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.edit');

  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array['name', 'description', 'parent_id', 'sort_order'] <> '{}'::jsonb
  then
    raise exception 'invalid service folder update patch'
      using errcode = '22023';
  end if;

  update public.service_folders
  set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
    parent_id = case when p_patch ? 'parent_id' then (p_patch ->> 'parent_id')::uuid else parent_id end,
    sort_order = case when p_patch ? 'sort_order' then (p_patch ->> 'sort_order')::integer else sort_order end
  where id = p_folder_id
    and tenant_id = (select private.current_tenant_id())
    and archived_at is null
  returning * into folder_row;

  if folder_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.updated',
    format('Updated service folder %s.', folder_row.name)
  );
  return folder_row;
end;
$$;

create or replace function public.app_archive_service_folder(p_folder_id uuid)
 returns public.service_folders
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  folder_row public.service_folders;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.archive');

  select folder.* into folder_row
  from public.service_folders as folder
  where folder.id = p_folder_id
    and folder.tenant_id = (select private.current_tenant_id())
  for update;

  if folder_row.id is null then raise no_data_found; end if;
  if folder_row.archived_at is not null then return folder_row; end if;

  update public.services set folder_id = null where folder_id = p_folder_id;
  update public.service_folders set parent_id = null where parent_id = p_folder_id;
  update public.service_folders
  set archived_at = now()
  where id = p_folder_id
  returning * into folder_row;

  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.archived',
    format('Archived service folder %s.', folder_row.name)
  );
  return folder_row;
end;
$$;

create or replace function public.app_set_service_folder_subscription_eligibility(p_folder_id uuid, p_eligible boolean)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  folder_row public.service_folders;
  changed integer;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('services');
  perform private.require_permission('services.edit');

  if p_eligible is null then
    raise exception 'eligibility is required' using errcode = '22023';
  end if;

  select folder.* into folder_row
  from public.service_folders as folder
  where folder.id = p_folder_id
    and folder.tenant_id = (select private.current_tenant_id())
    and folder.archived_at is null;
  if folder_row.id is null then raise no_data_found; end if;

  update public.services
  set subscription_eligible = p_eligible
  where folder_id = p_folder_id
    and is_active
    and archived_at is null
    and subscription_eligible is distinct from p_eligible;
  get diagnostics changed = row_count;

  perform private.record_authenticated_activity(
    'service_folder',
    folder_row.id,
    'service_folder.subscription_eligibility_updated',
    format(
      '%s %s services in %s for subscriptions.',
      case when p_eligible then 'Enabled' else 'Disabled' end,
      changed,
      folder_row.name
    ),
    jsonb_build_object('subscription_eligible', p_eligible, 'changed', changed)
  );
  return changed;
end;
$$;

create or replace function private.require_active_service_folder()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
begin
  if new.folder_id is not null
    and not exists (
      select 1
      from public.service_folders as folder
      where folder.id = new.folder_id
        and folder.tenant_id = new.tenant_id
        and folder.archived_at is null
    )
  then
    raise exception 'service folder must be active'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.validate_service_folder_parent()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a service folder cannot be its own parent'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.service_folders as parent
    where parent.id = new.parent_id
      and parent.tenant_id = new.tenant_id
      and parent.archived_at is null
  ) then
    raise exception 'service folder parent must be active'
      using errcode = '23514';
  end if;

  if exists (
    with recursive ancestors as (
      select folder.id, folder.parent_id
      from public.service_folders as folder
      where folder.id = new.parent_id
      union all
      select folder.id, folder.parent_id
      from public.service_folders as folder
      join ancestors on folder.id = ancestors.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'service folder nesting cannot contain a cycle'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.app_list_investment_intents(p_limit integer default 200)
 returns TABLE(intent_id uuid, company_id uuid, company_name text, service_id uuid, service_name text, folder_name text, price numeric, currency text, recurring boolean, recurring_price numeric, recurring_interval_length integer, recurring_interval_unit text, status text, in_cart boolean, add_count integer, first_added_at timestamp with time zone, last_added_at timestamp with time zone, removed_at timestamp with time zone, last_activity_at timestamp with time zone, contacted_at timestamp with time zone, contacted_by_profile_id uuid, contacted_by_name text, updated_at timestamp with time zone, active_ticket_id uuid, active_ticket_status text)
 language plpgsql
 stable security definer
 set search_path to ''
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
    interest.updated_at,
    active_ticket.id,
    active_ticket.status
  from public.service_interests as interest
  join public.companies as company_row
    on company_row.id = interest.company_id
  join public.services as service_row
    on service_row.id = interest.service_id
  left join public.service_folders as folder_row
    on folder_row.id = service_row.folder_id
  left join public.profiles as contacted_profile
    on contacted_profile.id = interest.contacted_by_profile_id
  -- tickets_active_investment_conversation_unique guarantees at most one live
  -- conversation per (company_id, investment_service_id), so this left join can
  -- never fan one interest row out into two.
  left join public.tickets as active_ticket
    on active_ticket.company_id = interest.company_id
   and active_ticket.investment_service_id = interest.service_id
   and active_ticket.status not in ('resolved', 'closed')
  where interest.tenant_id = (select private.current_tenant_id())
  order by interest.last_activity_at desc, interest.id
  limit row_limit;
end;
$$;

create or replace function public.app_set_investment_intent_status(p_intent_id uuid, p_status text)
 returns public.service_interests
 language plpgsql
 security definer
 set search_path to ''
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
    and existing.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_record_store_interest(p_service_ids uuid[], p_in_cart boolean)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  -- One staff signal per interest row per hour. Long enough that a rapid
  -- remove/re-add loop produces nothing, short enough that a client who
  -- genuinely reconsiders later in the day is still heard.
  renewal_cooldown constant interval := interval '1 hour';
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

  -- M-04. Keyed on the server-derived client profile, so one account cannot
  -- consume another account's or another company's allowance. Generous enough
  -- that ordinary cart use never reaches it: a whole cart is one call.
  perform private.consume_rate_limit(
    'store.interest.actor.minute', client_actor.profile_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'store.interest.actor.hour', client_actor.profile_id::text, interval '1 hour', 200
  );

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
      and candidate.tenant_id = (select private.current_tenant_id())
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
          last_notified_at,
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
        -- The state change is always recorded; only the staff signal is
        -- coalesced, and the row itself carries the cooldown anchor so two
        -- concurrent calls cannot both emit (the row is already locked above).
        update public.service_interests as target
        set in_cart = true,
            removed_at = null,
            last_added_at = now(),
            last_activity_at = now(),
            add_count = target.add_count + 1,
            last_notified_at = case
              when target.last_notified_at is null
                or target.last_notified_at < now() - renewal_cooldown
              then now()
              else target.last_notified_at
            end
        where target.id = prior_row.id
        returning * into interest_row;

        written := written + 1;

        if prior_row.last_notified_at is null
          or prior_row.last_notified_at < now() - renewal_cooldown
        then
          perform private.emit_investment_intent_notification(
            'service-interest-renewed:' || interest_row.id::text || ':' || interest_row.add_count::text,
            'Renewed investment interest',
            coalesce(company_name, 'A client') || ' added ' || service_row.name || ' back to their cart.',
            interest_row.id,
            client_actor.company_id,
            client_actor.profile_id
          );
        end if;
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

create or replace function public.app_quote_store_coupon(p_service_id uuid, p_coupon_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$

declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  service_row public.services;
  price_cents bigint;
  application record;
begin
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
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
    raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  -- Same module boundary as the purchase itself: quoting is a Store AND a
  -- billing action.
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform public.app_require_module_access('portal_invoices');
  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

  perform private.require_permission('invoices.view');

  select * into service_row
  from public.services as service
  where service.id = p_service_id
    and service.archived_at is null
    and service.is_active
    and service.is_public
    and service.tenant_id = (select private.current_tenant_id());

  if service_row.id is null then
    raise exception 'WF_PURCHASE_SERVICE_UNAVAILABLE' using errcode = '42501';
  end if;
  if service_row.recurring then
    raise exception 'WF_PURCHASE_RECURRING_UNSUPPORTED' using errcode = 'P0001';
  end if;

  price_cents := round(service_row.price * 100)::bigint;
  if price_cents is null or price_cents <= 0 then
    raise exception 'WF_PURCHASE_SERVICE_NOT_PRICED' using errcode = 'P0001';
  end if;

  select * into application
  from private.resolve_coupon_application(
    p_coupon_code,
    jsonb_build_array(jsonb_build_object(
      'service_id', service_row.id,
      'quantity', 1,
      'unit_amount', service_row.price,
      'billing_context', 'one_time'
    )),
    service_row.price,
    actor_id,
    actor_company_id,
    price_cents
  );

  if not application.valid then
    return jsonb_build_object('valid', false, 'failure_code', application.failure_code);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', application.coupon_id,
    'discount_cents', application.discount_cents,
    'original_subtotal_cents', price_cents,
    'eligible_subtotal_cents', round(application.eligible_subtotal * 100)::bigint,
    'resulting_subtotal_cents', round(application.resulting_cart_subtotal * 100)::bigint
  );
end;
$$;

create or replace function public.app_purchase_service_with_balance(p_request_id uuid, p_service_id uuid, p_coupon_code text default NULL::text)
 returns TABLE(order_id uuid, order_number bigint, ticket_id uuid, ticket_public_ref text, invoice_id uuid, invoice_number bigint, payment_id uuid, amount_cents bigint, currency text, wallet_balance_cents bigint, service_name text, replayed boolean)
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  request_payload jsonb;
  existing_id uuid;
  service_row public.services;
  wallet_row public.company_wallets;
  invoice_row public.invoices;
  invoice_item_id uuid;
  payment_row public.invoice_payments;
  order_row public.orders;
  company_name text;
  price_cents bigint;
  coupon_application record;
  coupon_discount_cents bigint := 0;
  coupon_redemption_id uuid;
  final_price_cents bigint;
begin
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_service_id is null then
    raise exception 'WF_PURCHASE_INVALID_REQUEST' using errcode = '22023';
  end if;

  select profile_row.company_id into actor_company_id
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  join public.companies as company_row
    on company_row.id = profile_row.company_id
   and company_row.archived_at is null
  where profile_row.id = actor_id
    and profile_row.archived_at is null
    and role_row.name = 'client';

  if actor_company_id is null then
    raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  request_payload := jsonb_build_object(
    'service_id', p_service_id,
    'coupon_code', nullif(btrim(p_coupon_code), '')
  );

  existing_id := private.find_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload
  );

  if existing_id is not null then
    select * into order_row from public.orders where id = existing_id;
    if order_row.id is null then raise no_data_found; end if;

    select item.invoice_id into invoice_id
    from public.invoice_items as item
    where item.order_id = order_row.id
    limit 1;

    select * into invoice_row from public.invoices where id = invoice_id;

    select * into payment_row
    from public.invoice_payments as payment
    where payment.invoice_id = invoice_row.id
      and payment.status = 'succeeded'
    order by payment.created_at
    limit 1;

    select * into wallet_row
    from public.company_wallets as wallet
    where wallet.company_id = actor_company_id;

    select service.name into service_name
    from public.services as service
    where service.id = order_row.service_id;

    return query
    select
      order_row.id,
      order_row.order_number,
      null::uuid,
      null::text,
      invoice_row.id,
      invoice_row.invoice_number,
      payment_row.id,
      payment_row.amount_cents,
      invoice_row.currency,
      wallet_row.balance_cents,
      service_name,
      true;
    return;
  end if;

  perform private.consume_rate_limit(
    'store.purchase.client.hour', actor_id::text, interval '1 hour', 10
  );
  perform private.consume_rate_limit(
    'store.purchase.client.day', actor_id::text, interval '1 day', 40
  );

  select * into service_row
  from public.services as service
  where service.id = p_service_id
    and service.tenant_id = (select private.current_tenant_id())
    and service.archived_at is null
    and service.is_active
    and service.is_public;

  if service_row.id is null then
    raise exception 'WF_PURCHASE_SERVICE_UNAVAILABLE' using errcode = '42501';
  end if;

  if service_row.recurring then
    raise exception 'WF_PURCHASE_RECURRING_UNSUPPORTED' using errcode = 'P0001';
  end if;

  price_cents := round(service_row.price * 100)::bigint;

  if price_cents is null or price_cents <= 0 then
    raise exception 'WF_PURCHASE_SERVICE_NOT_PRICED' using errcode = 'P0001';
  end if;

  -- Coupon: re-resolved here, never trusted from the browser. A coupon that is
  -- invalid at purchase time fails the whole purchase - it is never silently
  -- dropped in favour of the full price.
  if nullif(btrim(p_coupon_code), '') is not null then
    select * into coupon_application
    from private.resolve_coupon_application(
      p_coupon_code,
      jsonb_build_array(jsonb_build_object(
        'service_id', service_row.id,
        'quantity', 1,
        'unit_amount', service_row.price,
        'billing_context', 'one_time'
      )),
      service_row.price,
      actor_id,
      actor_company_id,
      price_cents
    );

    if not coupon_application.valid then
      if coupon_application.failure_code = 'ALREADY_REDEEMED' then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
      end if;
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    coupon_discount_cents := coupon_application.discount_cents;
  end if;

  final_price_cents := price_cents - coupon_discount_cents;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> service_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < final_price_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  -- Redemption is written only now, after the balance check, inside the same
  -- transaction as the purchase: a failed purchase rolls it back, and a replay
  -- returns above without reaching here.
  if coupon_discount_cents > 0 then
    begin
      insert into public.coupon_redemptions (
        coupon_id, customer_profile_id, company_id, request_id, currency,
        original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal
      ) values (
        coupon_application.coupon_id, actor_id, actor_company_id, p_request_id,
        service_row.currency,
        coupon_application.original_cart_subtotal,
        coupon_application.eligible_subtotal,
        coupon_application.discount_amount,
        coupon_application.resulting_cart_subtotal
      ) returning id into coupon_redemption_id;
    exception
      when unique_violation then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
    end;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = actor_company_id;

  insert into public.invoices (
    company_id, client_profile_id, status, currency,
    billing_reason, due_at,
    subtotal_cents, discount_total_cents, tax_total_cents, total_cents,
    created_by_profile_id, updated_by_profile_id
  ) values (
    actor_company_id, actor_id, 'draft', service_row.currency,
    'store_purchase', now(),
    price_cents, coupon_discount_cents, 0, final_price_cents,
    actor_id, actor_id
  ) returning * into invoice_row;

  insert into public.invoice_items (
    invoice_id, service_id, order_id, position, name, description,
    quantity, unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status
  ) values (
    invoice_row.id, service_row.id, null, 0, service_row.name, null,
    1, price_cents, coupon_discount_cents, false, 'awaiting_payment'
  ) returning id into invoice_item_id;

  perform set_config('app.wf_store_purchase_order', 'on', true);

  update public.invoices
  set status = 'unpaid',
      invoice_number = private.next_invoice_number(),
      issued_at = now(),
      updated_by_profile_id = actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    invoice_row.id,
    final_price_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  select * into invoice_row from public.invoices where id = invoice_row.id;

  if invoice_row.status <> 'paid' then
    raise exception 'WF_PURCHASE_NOT_SETTLED' using errcode = 'P0001';
  end if;

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - final_price_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents, balance_after_cents,
    currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -final_price_cents, wallet_row.balance_cents,
    wallet_row.currency, 'invoice_payment',
    left('Store purchase - ' || service_row.name, 240),
    invoice_row.id, payment_row.id
  );

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  perform set_config('app.wf_store_purchase_payment_id', payment_row.id::text, true);

  insert into public.orders (
    company_id, service_id, assigned_to_profile_id, title, status, priority, notes
  ) values (
    actor_company_id,
    service_row.id,
    null,
    left(service_row.name, 500),
    'pending',
    'normal',
    null
  ) returning * into order_row;

  perform set_config('app.wf_store_purchase_payment_id', '', true);
  perform set_config('app.wf_store_purchase_order', '', true);

  update public.invoice_items
  set order_id = order_row.id,
      fulfillment_status = 'provisioned'
  where id = invoice_item_id;

  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id
  ) values (
    order_row.id,
    null,
    'system',
    'New service purchase received.' || chr(10) || chr(10)
      || 'Client: ' || coalesce(nullif(company_name, ''), 'Unknown company') || chr(10)
      || 'Service: ' || service_row.name || chr(10)
      || 'Amount: ' || invoice_row.currency || ' '
        || to_char(final_price_cents::numeric / 100, 'FM999999999999990.00') || chr(10)
      || 'Payment method: Wolf Forge Balance' || chr(10)
      || 'Invoice: #WF-' || lpad(invoice_row.invoice_number::text, 4, '0') || chr(10)
      || 'Project: #' || order_row.order_number::text || ' ' || order_row.title || chr(10)
      || 'Purchased: ' || to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY')
        || ' (UTC)' || chr(10) || chr(10)
      || 'The client has successfully completed payment. This Project is ready '
      || 'for the Wolf Forge team to begin fulfillment.',
    p_request_id
  );

  update public.service_interests
  set status = 'closed',
      in_cart = false,
      removed_at = coalesce(removed_at, now()),
      last_activity_at = now()
  where company_id = actor_company_id
    and service_id = service_row.id
    and status not in ('closed', 'not_interested');

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'order',
    order_row.id,
    'order.purchased',
    format(
      'Purchased %s with Wolf Forge Balance.',
      service_row.name
    ),
    jsonb_build_object(
      'company_id', actor_company_id,
      'service_id', service_row.id,
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'amount_cents', final_price_cents,
      'currency', invoice_row.currency,
      'payment_method', 'wolf_forge_wallet',
      'coupon_redemption_id', coupon_redemption_id,
      'coupon_discount_cents', coupon_discount_cents
    )
  );

  perform private.remember_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload, order_row.id
  );

  return query
  select
    order_row.id,
    order_row.order_number,
    null::uuid,
    null::text,
    invoice_row.id,
    invoice_row.invoice_number,
    payment_row.id,
    final_price_cents,
    invoice_row.currency,
    wallet_row.balance_cents,
    service_row.name,
    false;
end;
$$;
