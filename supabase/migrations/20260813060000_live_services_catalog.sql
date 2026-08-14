-- Wolf Forge Platform - captured live Services catalog infrastructure
-- External identifiers and fields without a public MVP representation remain
-- private source metadata. The public Services schema stays unchanged.

create table private.wayfront_service_folder_sources (
  folder_id uuid primary key references public.service_folders (id) on delete cascade,
  source_folder_id bigint not null unique,
  display_order integer not null,
  source_data jsonb not null,
  constraint wayfront_service_folder_sources_display_order_positive
    check (display_order > 0),
  constraint wayfront_service_folder_sources_source_data_object
    check (jsonb_typeof(source_data) = 'object')
);

create table private.wayfront_service_catalog_sources (
  service_id uuid primary key references public.services (id) on delete cascade,
  source_service_id bigint not null unique,
  source_folder_id bigint not null,
  display_order integer not null,
  source_url text not null,
  source_data jsonb not null,
  constraint wayfront_service_catalog_sources_display_order_positive
    check (display_order > 0),
  constraint wayfront_service_catalog_sources_source_url_not_blank
    check (btrim(source_url) <> ''),
  constraint wayfront_service_catalog_sources_source_data_object
    check (jsonb_typeof(source_data) = 'object')
);

create index wayfront_service_catalog_sources_source_folder_id_idx
on private.wayfront_service_catalog_sources (source_folder_id, display_order);

create function private.import_wayfront_service_folder(
  p_folder_capture jsonb,
  p_folder_order integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  folder_source_id bigint;
  folder_local_id uuid;
  service_capture jsonb;
  service_local_id uuid;
  service_order integer := 0;
  source_deadline integer;
begin
  if jsonb_typeof(p_folder_capture) <> 'object'
    or jsonb_typeof(p_folder_capture -> 'folder') <> 'object'
    or jsonb_typeof(p_folder_capture -> 'services') <> 'array'
    or p_folder_order <= 0
  then
    raise exception 'invalid Wayfront service folder capture'
      using errcode = '22023';
  end if;

  folder_source_id := (p_folder_capture #>> '{folder,source_folder_id}')::bigint;
  folder_local_id := (
    '5f000000-0000-4000-8000-' || lpad(folder_source_id::text, 12, '0')
  )::uuid;

  insert into public.service_folders (
    id, name, description, image_url, parent_id, sort_order, archived_at
  ) values (
    folder_local_id,
    p_folder_capture #>> '{folder,name}',
    null,
    null,
    null,
    p_folder_order,
    null
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    image_url = excluded.image_url,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    archived_at = excluded.archived_at;

  insert into private.wayfront_service_folder_sources (
    folder_id, source_folder_id, display_order, source_data
  ) values (
    folder_local_id,
    folder_source_id,
    p_folder_order,
    p_folder_capture -> 'folder'
  )
  on conflict (folder_id) do update set
    source_folder_id = excluded.source_folder_id,
    display_order = excluded.display_order,
    source_data = excluded.source_data;

  for service_capture in
    select value from jsonb_array_elements(p_folder_capture -> 'services')
  loop
    service_order := service_order + 1;
    service_local_id := (
      '5f000000-0000-4000-8000-' ||
      lpad(service_capture ->> 'source_service_id', 12, '0')
    )::uuid;
    source_deadline := (service_capture ->> 'deadline')::integer;

    insert into public.services (
      id,
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
      archived_at
    ) values (
      service_local_id,
      service_capture ->> 'name',
      folder_local_id,
      service_capture ->> 'description',
      coalesce((service_capture ->> 'price')::numeric, 0),
      coalesce(service_capture ->> 'currency', 'USD'),
      null,
      service_capture ->> 'deleted_at' is null,
      coalesce((service_capture ->> 'public')::boolean, false),
      coalesce((service_capture ->> 'recurring')::boolean, false),
      (service_capture ->> 'recurring_price')::numeric,
      (service_capture ->> 'recurring_interval_length')::integer,
      service_capture ->> 'recurring_interval_unit',
      case (service_capture ->> 'recurring_action')::integer
        when 0 then 'none'
        when 1 then 'reopen_order'
        when 2 then 'create_order'
        when 3 then 'client_request'
        else null
      end,
      coalesce((service_capture ->> 'group_quantities')::boolean, false),
      null,
      case
        when source_deadline is null then null
        when source_deadline % 24 = 0 then source_deadline / 24
        else source_deadline
      end,
      case
        when source_deadline is null then null
        when source_deadline % 24 = 0 then 'D'
        else 'H'
      end,
      coalesce((service_capture ->> 'require_client_profile')::boolean, false),
      service_order,
      null
    )
    on conflict (id) do update set
      name = excluded.name,
      folder_id = excluded.folder_id,
      description = excluded.description,
      price = excluded.price,
      currency = excluded.currency,
      image_url = excluded.image_url,
      is_active = excluded.is_active,
      is_public = excluded.is_public,
      recurring = excluded.recurring,
      recurring_price = excluded.recurring_price,
      recurring_interval_length = excluded.recurring_interval_length,
      recurring_interval_unit = excluded.recurring_interval_unit,
      recurring_action = excluded.recurring_action,
      group_quantities = excluded.group_quantities,
      assigned_to_profile_id = excluded.assigned_to_profile_id,
      deadline_amount = excluded.deadline_amount,
      deadline_unit = excluded.deadline_unit,
      require_client_profile = excluded.require_client_profile,
      sort_order = excluded.sort_order,
      archived_at = excluded.archived_at;

    insert into private.wayfront_service_catalog_sources (
      service_id,
      source_service_id,
      source_folder_id,
      display_order,
      source_url,
      source_data
    ) values (
      service_local_id,
      (service_capture ->> 'source_service_id')::bigint,
      folder_source_id,
      service_order,
      service_capture ->> 'source_url',
      service_capture
    )
    on conflict (service_id) do update set
      source_service_id = excluded.source_service_id,
      source_folder_id = excluded.source_folder_id,
      display_order = excluded.display_order,
      source_url = excluded.source_url,
      source_data = excluded.source_data;
  end loop;
end;
$function$;

create function private.seed_wolf_forge_services_catalog()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  folder_source private.wayfront_service_folder_sources;
  folder_capture jsonb;
begin
  perform private.seed_seo_sprints_catalog();

  for folder_source in
    select *
    from private.wayfront_service_folder_sources
    order by display_order
  loop
    select jsonb_build_object(
      'folder', folder_source.source_data,
      'services', coalesce(
        jsonb_agg(service_source.source_data order by service_source.display_order),
        '[]'::jsonb
      )
    )
    into folder_capture
    from private.wayfront_service_catalog_sources as service_source
    where service_source.source_folder_id = folder_source.source_folder_id;

    perform private.import_wayfront_service_folder(
      folder_capture,
      folder_source.display_order
    );
  end loop;
end;
$function$;

revoke all on table private.wayfront_service_folder_sources
from public, anon, authenticated, service_role;
revoke all on table private.wayfront_service_catalog_sources
from public, anon, authenticated, service_role;
revoke all on function private.import_wayfront_service_folder(jsonb, integer)
from public, anon, authenticated, service_role;
revoke all on function private.seed_wolf_forge_services_catalog()
from public, anon, authenticated, service_role;
