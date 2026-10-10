begin;

select plan(31);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.seed_wolf_forge_services_catalog()',
    'EXECUTE'
  ),
  'the complete catalog seed is private'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.import_wayfront_service_folder(jsonb,integer)',
    'EXECUTE'
  ),
  'the captured-folder import boundary is private'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.wayfront_service_folder_sources',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'private.wayfront_service_catalog_sources',
    'SELECT'
  ),
  'raw Wayfront source metadata is not exposed to authenticated clients'
);

select private.seed_wolf_forge_services_catalog();
select private.seed_wolf_forge_services_catalog();

select is(
  (select count(*) from public.services where archived_at is null and tenant_id = private.wolf_forge_tenant_id()),
  59::bigint,
  'double seeding leaves exactly 59 active Wolf Forge catalog services'
);

select is(
  (select count(*) from public.service_folders where archived_at is null),
  8::bigint,
  'the catalog contains SEO Sprints plus seven captured folders'
);

select is(
  (
    select jsonb_object_agg(folder.name, folder.service_count)
    from (
      select service_folder.name, count(service.id) as service_count
      from public.service_folders as service_folder
      left join public.services as service
        on service.folder_id = service_folder.id
       and service.archived_at is null
      where service_folder.archived_at is null
      group by service_folder.id, service_folder.name
    ) as folder
  ),
  '{
    "SEO Sprints": 10,
    "GBP Only SEO": 4,
    "Local SEO": 7,
    "Ecommerce SEO": 1,
    "Onpage & Technical SEO": 7,
    "Website Design": 6,
    "Press Releases": 5,
    "Backlink Service": 19
  }'::jsonb,
  'folder service counts match the captured 59-service catalog'
);

select is(
  (select count(*) from private.wayfront_service_folder_sources),
  7::bigint,
  'all seven Wayfront folder identifiers are retained'
);

select is(
  (select count(*) from private.wayfront_service_catalog_sources),
  59::bigint,
  'all 59 authoritative source service identifiers are retained'
);

select is(
  (
    select count(distinct source_service_id)
    from private.wayfront_service_catalog_sources
  ),
  59::bigint,
  'source service identifiers remain unique without name deduplication'
);

select is(
  (
    select service_folder.name
    from private.wayfront_service_folder_sources as source
    join public.service_folders as service_folder on service_folder.id = source.folder_id
    where source.source_folder_id = 20
  ),
  'Website Design',
  'Wayfront folder 20 maps to Website Design'
);

select is(
  (
    select service_folder.name
    from private.wayfront_service_folder_sources as source
    join public.service_folders as service_folder on service_folder.id = source.folder_id
    where source.source_folder_id = 53
  ),
  'Press Releases',
  'Wayfront folder 53 maps to Press Releases'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where nullif(service.description, '') is not null
  ),
  59::bigint,
  'every active catalog service has a non-empty imported description'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where service.description is distinct from source.source_data ->> 'description'
  ),
  0::bigint,
  'every imported description exactly equals its authoritative capture string'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where service.folder_id = '5e000000-0000-4000-8000-000000000001'
      and source.source_folder_id = 54
      and nullif(service.description, '') is not null
      and service.description = source.source_data ->> 'description'
      and service.archived_at is null
  ),
  10::bigint,
  'all ten SEO Sprint descriptions exactly equal the authoritative capture'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where source.source_folder_id <> 54
      and service.price is distinct from coalesce(
      (source.source_data ->> 'price')::numeric,
      0
    )
  ),
  0::bigint,
  'captured one-time prices survive import exactly'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where service.recurring
  ),
  1::bigint,
  'the catalog has exactly one recurring captured service'
);

select ok(
  (
    select service.recurring
      and service.price = 0
      and service.recurring_price = 97
      and service.recurring_interval_length = 1
      and service.recurring_interval_unit = 'M'
      and service.recurring_action = 'client_request'
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where source.source_service_id = 318
  ),
  'GMB/GBP Management retains its $97 monthly recurrence and source action 3 mapping'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where not service.is_public
  ),
  6::bigint,
  'all six captured null/non-public services remain non-public'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where source.source_folder_id <> 54
      and service.is_public is distinct from coalesce(
      (source.source_data ->> 'public')::boolean,
      false
    )
  ),
  0::bigint,
  'visibility exactly follows the captured public value'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where service.deadline_amount = 30
      and service.deadline_unit = 'D'
  ),
  5::bigint,
  'all five 720-hour deadlines render locally as 30 days'
);

select is(
  (
    select count(*)
    from private.wayfront_service_catalog_sources
    where (source_data ->> 'deadline')::integer = 720
  ),
  5::bigint,
  'the raw 720 deadline values remain in source metadata'
);

select is(
  (
    select count(*)
    from private.wayfront_service_catalog_sources
    where nullif(source_data ->> 'image', '') is not null
  ),
  6::bigint,
  'all six captured image source paths are retained as metadata'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where service.image_url is not null
  ),
  0::bigint,
  'no source image path is presented as a migrated media upload'
);

select is(
  (
    select count(*)
    from private.wayfront_service_catalog_sources
    where (source_data ->> 'intake_form_id')::bigint is not null
  ),
  47::bigint,
  '47 captured intake form identifiers remain in source metadata'
);

select is(
  (
    select jsonb_agg(source_service_id order by source_service_id)
    from private.wayfront_service_catalog_sources
    where source_folder_id <> 54
      and (source_data ->> 'intake_form_id')::bigint is null
  ),
  '[418, 450]'::jsonb,
  'services 418 and 450 remain the two services without intake forms'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where service.sort_order is distinct from source.display_order
  ),
  0::bigint,
  'local sort order deterministically preserves captured listing order'
);

select is(
  (
    select jsonb_agg(
      jsonb_build_array(
        source.source_service_id,
        source.source_data -> 'sort_order',
        service.sort_order
      )
      order by source.display_order
    )
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where source.source_service_id in (338, 433, 435)
  ),
  '[[338, 2, 2], [433, 2, 3], [435, 2, 4]]'::jsonb,
  'raw sort collisions remain captured while local display order stays deterministic'
);

select ok(
  (
    select service.price = 10
      and source.source_folder_id = 45
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where source.source_service_id = 460
  ),
  'Backlink service 460 remains the separate $10 product in folder 45'
);

select ok(
  (
    select service.price = 15
      and source.source_folder_id = 53
    from public.services as service
    join private.wayfront_service_catalog_sources as source
      on source.service_id = service.id
    where source.source_service_id = 257
  ),
  'Press Releases service 257 remains the separate $15 product in folder 53'
);

select is(
  (
    select count(*)
    from public.services
    where name = 'Basic Press Release Distribution Service - Guaranteed 150 Links'
      and archived_at is null
  ),
  2::bigint,
  'matching service names are not deduplicated across folders'
);

select is(
  (
    select count(*)
    from public.services as service
    join private.wayfront_service_catalog_sources as service_source
      on service_source.service_id = service.id
    join private.wayfront_service_folder_sources as folder_source
      on folder_source.source_folder_id = service_source.source_folder_id
    where service.folder_id is distinct from folder_source.folder_id
  ),
  0::bigint,
  'all captured services retain their source folder relationship'
);

select * from finish();
rollback;
