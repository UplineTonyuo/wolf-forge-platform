begin;

select plan(33);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values (
  '24000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'services-owner@example.invalid',
  now(),
  now()
);

update public.profiles
set role_id = (select id from public.roles where name = 'owner')
where id = '24000000-0000-4000-8000-000000000001';

select ok(
  (
    select bool_and(has_function_privilege('authenticated', function_name, 'EXECUTE'))
    from unnest(array[
      'public.app_create_service_folder(uuid,text,text,uuid,integer)',
      'public.app_update_service_folder(uuid,jsonb)',
      'public.app_archive_service_folder(uuid)',
      'public.app_create_service(uuid,jsonb)',
      'public.app_update_service(uuid,jsonb)',
      'public.app_duplicate_service(uuid,uuid)',
      'public.app_archive_service(uuid)'
    ]) as functions(function_name)
  ),
  'authenticated internal users receive the audited Services RPC surface'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.seed_seo_sprints_catalog()',
    'EXECUTE'
  ),
  'the deterministic seed helper is not exposed to authenticated callers'
);

select ok(
  has_table_privilege('authenticated', 'public.service_folders', 'SELECT')
  and not has_table_privilege('authenticated', 'public.service_folders', 'INSERT')
  and not has_table_privilege('authenticated', 'public.service_folders', 'UPDATE'),
  'service folders are read-only outside audited RPCs'
);

select ok(
  not has_table_privilege('authenticated', 'public.service_folders', 'DELETE')
  and not has_table_privilege('authenticated', 'public.services', 'DELETE'),
  'Services engine tables expose no authenticated hard-delete privilege'
);

select private.seed_seo_sprints_catalog();
select private.seed_seo_sprints_catalog();

select is(
  (
    select count(*)
    from public.services
    where folder_id = '5e000000-0000-4000-8000-000000000001'
      and archived_at is null
  ),
  10::bigint,
  'repeating the SEO Sprints seed leaves exactly ten active services'
);

select is(
  (
    select jsonb_object_agg(name, price order by sort_order)
    from public.services
    where folder_id = '5e000000-0000-4000-8000-000000000001'
      and archived_at is null
  ),
  '{
    "MAPS SPRINT": 97.00,
    "SEO SPRINT": 97.00,
    "AI VISIBILITY SPRINT": 97.00,
    "WEBSITE SPRINT": 97.00,
    "LEAD GEN SPRINT": 97.00,
    "CONVERSION SPRINT": 97.00,
    "COMPETITOR SPRINT": 97.00,
    "LEAD GENERATION SYSTEM": 2500.00,
    "Conversion Optimization System": 997.00,
    "Competitive Domination Blueprint": 497.00
  }'::jsonb,
  'SEO Sprints prices match the verified local catalog brief'
);

select is(
  (
    select count(*)
    from public.services
    where folder_id = '5e000000-0000-4000-8000-000000000001'
      and currency = 'USD'
      and is_public
      and not recurring
      and not group_quantities
      and not require_client_profile
      and assigned_to_profile_id is null
      and deadline_amount is null
      and archived_at is null
  ),
  10::bigint,
  'all SEO Sprints records use the required baseline settings'
);

select is(
  (
    select count(*)
    from public.services
    where folder_id = '5e000000-0000-4000-8000-000000000001'
      and nullif(description, '') is not null
      and image_url is null
      and archived_at is null
  ),
  10::bigint,
  'the seed retains all ten authoritative descriptions without inventing images'
);

create temporary table services_engine_ids (
  folder_id uuid,
  child_folder_id uuid,
  service_id uuid,
  duplicate_id uuid,
  archive_timestamp timestamptz,
  folder_archive_timestamp timestamptz
) on commit drop;
insert into services_engine_ids default values;
grant select, update on services_engine_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '24000000-0000-4000-8000-000000000001';

update services_engine_ids
set folder_id = (public.app_create_service_folder(
  '84000000-0000-4000-8000-000000000001',
  'MVP Folder'
)).id;

select is(
  (select name from public.service_folders where id = (select folder_id from services_engine_ids)),
  'MVP Folder',
  'folder create returns and commits the folder'
);

select is(
  (public.app_create_service_folder(
    '84000000-0000-4000-8000-000000000001',
    'MVP Folder'
  )).id,
  (select folder_id from services_engine_ids),
  'folder create is request-id idempotent'
);

select is(
  (select count(*) from public.service_folders where name = 'MVP Folder'),
  1::bigint,
  'folder retry does not create a duplicate row'
);

select is(
  (
    select count(*) from public.activity_events
    where entity_id = (select folder_id from services_engine_ids)
      and action = 'service_folder.created'
  ),
  1::bigint,
  'folder retry does not duplicate activity'
);

select is(
  (public.app_update_service_folder(
    (select folder_id from services_engine_ids),
    '{"description":"Edited folder"}'
  )).description,
  'Edited folder',
  'folder edit is atomic'
);

select is(
  (
    select count(*) from public.activity_events
    where entity_id = (select folder_id from services_engine_ids)
      and action = 'service_folder.updated'
  ),
  1::bigint,
  'folder edit appends one activity event'
);

update services_engine_ids
set child_folder_id = (public.app_create_service_folder(
  '84000000-0000-4000-8000-000000000002',
  'Nested Folder',
  null,
  (select folder_id from services_engine_ids)
)).id;

select is(
  (
    select parent_id from public.service_folders
    where id = (select child_folder_id from services_engine_ids)
  ),
  (select folder_id from services_engine_ids),
  'nested folder relationships are persisted'
);

select throws_ok(
  $$select public.app_update_service_folder(
    (select folder_id from services_engine_ids),
    jsonb_build_object('parent_id', (select child_folder_id from services_engine_ids))
  )$$,
  '23514',
  'service folder nesting cannot contain a cycle',
  'folder cycles are rejected'
);

update services_engine_ids
set service_id = (public.app_create_service(
  '84000000-0000-4000-8000-000000000003',
  jsonb_build_object(
    'name', 'Recurring MVP Service',
    'folder_id', (select folder_id from services_engine_ids),
    'description', 'Operator-authored description',
    'price', 125,
    'currency', 'USD',
    'is_public', true,
    'recurring', true,
    'recurring_price', 75,
    'recurring_interval_length', 1,
    'recurring_interval_unit', 'M',
    'recurring_action', 'reopen_order',
    'group_quantities', false,
    'assigned_to_profile_id', '24000000-0000-4000-8000-000000000001',
    'deadline_amount', 3,
    'deadline_unit', 'D',
    'require_client_profile', true,
    'sort_order', 3
  )
)).id;

select is(
  (
    select folder_id from public.services
    where id = (select service_id from services_engine_ids)
  ),
  (select folder_id from services_engine_ids),
  'service create persists folder assignment'
);

select ok(
  (
    select recurring
      and recurring_price = 75
      and recurring_interval_length = 1
      and recurring_interval_unit = 'M'
      and recurring_action = 'reopen_order'
    from public.services
    where id = (select service_id from services_engine_ids)
  ),
  'service create persists validated recurring configuration'
);

select is(
  (
    select count(*) from public.activity_events
    where entity_id = (select service_id from services_engine_ids)
      and action = 'service.created'
  ),
  1::bigint,
  'service create appends activity atomically'
);

select is(
  (public.app_update_service(
    (select service_id from services_engine_ids),
    '{"name":"Edited MVP Service","price":150}'
  )).price,
  150.00::numeric,
  'service edit updates catalog fields atomically'
);

select is(
  (
    select count(*) from public.activity_events
    where entity_id = (select service_id from services_engine_ids)
      and action = 'service.updated'
  ),
  1::bigint,
  'service edit appends one activity event'
);

update services_engine_ids
set duplicate_id = (public.app_duplicate_service(
  '84000000-0000-4000-8000-000000000004',
  (select service_id from services_engine_ids)
)).id;

select isnt(
  (select duplicate_id from services_engine_ids),
  (select service_id from services_engine_ids),
  'service duplication creates a distinct service'
);

select is(
  (select name from public.services where id = (select duplicate_id from services_engine_ids)),
  'Edited MVP Service (Copy)',
  'service duplication uses a truthful copy name'
);

select is(
  (public.app_duplicate_service(
    '84000000-0000-4000-8000-000000000004',
    (select service_id from services_engine_ids)
  )).id,
  (select duplicate_id from services_engine_ids),
  'service duplication is request-id idempotent'
);

select is(
  (
    select count(*) from public.activity_events
    where entity_id = (select duplicate_id from services_engine_ids)
      and action = 'service.duplicated'
  ),
  1::bigint,
  'service duplicate retry does not duplicate activity'
);

select throws_ok(
  $$select public.app_create_service(
    '84000000-0000-4000-8000-000000000005',
    '{"name":"Invalid Recurring","recurring":true,"price":10}'::jsonb
  )$$,
  '23514',
  null,
  'incomplete recurring configuration is rejected'
);

update services_engine_ids
set archive_timestamp = (public.app_archive_service(
  (select service_id from services_engine_ids)
)).archived_at;

select ok(
  (select archive_timestamp is not null from services_engine_ids),
  'service soft delete records an archive timestamp'
);

select is(
  (public.app_archive_service((select service_id from services_engine_ids))).archived_at,
  (select archive_timestamp from services_engine_ids),
  'service soft delete is idempotent'
);

select is(
  (
    select count(*) from public.activity_events
    where entity_id = (select service_id from services_engine_ids)
      and action = 'service.archived'
  ),
  1::bigint,
  'service soft-delete retry does not duplicate activity'
);

update services_engine_ids
set folder_archive_timestamp = (public.app_archive_service_folder(
  (select folder_id from services_engine_ids)
)).archived_at;

select ok(
  (select folder_archive_timestamp is not null from services_engine_ids),
  'folder soft delete records an archive timestamp'
);

select is(
  (
    select folder_id from public.services
    where id = (select duplicate_id from services_engine_ids)
  ),
  null::uuid,
  'folder soft delete moves its live services to Unfiled'
);

select is(
  (
    select parent_id from public.service_folders
    where id = (select child_folder_id from services_engine_ids)
  ),
  null::uuid,
  'folder soft delete promotes nested folders to the root'
);

select is(
  (public.app_archive_service_folder((select folder_id from services_engine_ids))).archived_at,
  (select folder_archive_timestamp from services_engine_ids),
  'folder soft delete is idempotent'
);

select * from finish();
rollback;
