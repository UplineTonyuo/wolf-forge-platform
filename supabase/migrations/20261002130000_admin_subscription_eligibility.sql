-- Admins manage services.subscription_eligible from the Services UI. The column
-- stays the only source of truth: the service RPCs accept it like any other
-- field, and the folder control is a bulk write over a folder's active
-- services, not a persisted folder rule.

create or replace function public.app_create_service(
  p_request_id uuid,
  p_payload jsonb
)
returns public.services
language plpgsql
security definer
set search_path = ''
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
    where service.id = existing_id;
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

create or replace function public.app_update_service(
  p_service_id uuid,
  p_patch jsonb
)
returns public.services
language plpgsql
security definer
set search_path = ''
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

-- Bulk-set eligibility on every active, non-archived service directly in a
-- folder. Returns how many services changed. Nested folders are not touched.
create or replace function public.app_set_service_folder_subscription_eligibility(
  p_folder_id uuid,
  p_eligible boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
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

revoke all on function public.app_set_service_folder_subscription_eligibility(uuid, boolean) from public, anon, service_role;
grant execute on function public.app_set_service_folder_subscription_eligibility(uuid, boolean) to authenticated;
