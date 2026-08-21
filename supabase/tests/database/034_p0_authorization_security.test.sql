begin;

select plan(34);

-- Security Batch A adversarial fixtures: one fully authorized internal operator,
-- one module-denied internal user, one view-only manager, one archived actor,
-- and three client identities spanning two companies.
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('2a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p0-owner@example.invalid', now(), now()),
  ('2a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p0-authorized-staff@example.invalid', now(), now()),
  ('2a000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'p0-module-denied@example.invalid', now(), now()),
  ('2a000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'p0-manager@example.invalid', now(), now()),
  ('2a000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'p0-archived@example.invalid', now(), now()),
  ('1a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p0-client-a@example.invalid', now(), now()),
  ('1a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p0-client-b@example.invalid', now(), now()),
  ('1a000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'p0-projects-denied@example.invalid', now(), now());

update public.profiles as profile
set role_id = role_row.id
from public.roles as role_row
where profile.id = case role_row.name
  when 'owner' then '2a000000-0000-0000-0000-000000000001'::uuid
  when 'staff' then '2a000000-0000-0000-0000-000000000002'::uuid
  when 'manager' then '2a000000-0000-0000-0000-000000000004'::uuid
end
  and role_row.name in ('owner', 'staff', 'manager');

update public.profiles
set role_id = (select id from public.roles where name = 'staff')
where id = '2a000000-0000-0000-0000-000000000003';

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    archived_at = now()
where id = '2a000000-0000-0000-0000-000000000005';

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values
  ('2a000000-0000-0000-0000-000000000002', 'clients.view', true),
  ('2a000000-0000-0000-0000-000000000002', 'clients.create', true),
  ('2a000000-0000-0000-0000-000000000002', 'clients.edit', true),
  ('2a000000-0000-0000-0000-000000000002', 'clients.archive', true),
  ('2a000000-0000-0000-0000-000000000002', 'services.create', true),
  ('2a000000-0000-0000-0000-000000000002', 'services.edit', true),
  ('2a000000-0000-0000-0000-000000000002', 'services.archive', true),
  ('2a000000-0000-0000-0000-000000000003', 'clients.view', false),
  ('2a000000-0000-0000-0000-000000000003', 'services.view', false),
  ('1a000000-0000-0000-0000-000000000003', 'projects.view', false);

insert into public.companies (id, name, status)
values
  ('3a000000-0000-0000-0000-000000000001', 'P0 Client A', 'client'),
  ('3a000000-0000-0000-0000-000000000002', 'P0 Client B', 'client'),
  ('3a000000-0000-0000-0000-000000000003', 'P0 Company Mutation Target', 'client');

update public.profiles
set company_id = case
  when id in (
    '1a000000-0000-0000-0000-000000000001'::uuid,
    '1a000000-0000-0000-0000-000000000003'::uuid
  ) then '3a000000-0000-0000-0000-000000000001'::uuid
  else '3a000000-0000-0000-0000-000000000002'::uuid
end
where id in (
  '1a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000002',
  '1a000000-0000-0000-0000-000000000003'
);

insert into public.services (id, name, is_active, is_public)
values ('4a000000-0000-0000-0000-000000000001', 'P0 Project Service', true, true);

insert into public.orders (
  id, company_id, service_id, title, notes, assigned_to_profile_id, status, priority
)
values
  ('5a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001', 'P0 Project A', 'INTERNAL-NOTES-A', '2a000000-0000-0000-0000-000000000001', 'working', 'high'),
  ('5a000000-0000-0000-0000-000000000002', '3a000000-0000-0000-0000-000000000002', '4a000000-0000-0000-0000-000000000001', 'P0 Project B', 'INTERNAL-NOTES-B', '2a000000-0000-0000-0000-000000000001', 'pending', 'urgent');

insert into public.order_tasks (id, order_id, title, description, assigned_to_profile_id, status, completed_at)
values
  ('6a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'INTERNAL-TASK-A', 'INTERNAL-TASK-DESCRIPTION', '2a000000-0000-0000-0000-000000000001', 'todo', null),
  ('6a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', 'Completed internal task', null, null, 'complete', now()),
  ('6a000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002', 'INTERNAL-TASK-B', null, null, 'todo', null);

create temporary table p0_ids (label text primary key, id uuid not null) on commit drop;
grant select, insert, update on p0_ids to authenticated;

-- H-01: full company reads and every mutator require Clients authority.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into p0_ids values ('owner-company', (public.app_create_company('7a000000-0000-0000-0000-000000000001', 'P0 Owner Company')).id)$$,
  'owner can create a company through the protected RPC'
);

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000002';
select lives_ok(
  $$insert into p0_ids values ('staff-company', (public.app_create_company('7a000000-0000-0000-0000-000000000002', 'P0 Authorized Staff Company')).id)$$,
  'explicitly authorized staff can create a company'
);
select lives_ok(
  $$select public.app_update_company((select id from p0_ids where label = 'staff-company'), '{"status":"lead"}'::jsonb)$$,
  'staff with clients.edit can update a company'
);
select lives_ok(
  $$select public.app_archive_company((select id from p0_ids where label = 'staff-company'))$$,
  'staff with clients.archive can archive a company'
);

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000003';
select is((select count(*) from public.companies), 0::bigint, 'internal staff denied Clients cannot read company rows');
select throws_ok(
  $$select public.app_create_company('7a000000-0000-0000-0000-000000000003', 'Denied Company')$$,
  '42501', 'permission denied: clients.view',
  'direct company RPC cannot bypass a denied Clients module'
);

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select public.app_create_company('7a000000-0000-0000-0000-000000000004', 'View-only Company')$$,
  '42501', 'permission denied: clients.create',
  'Clients view access does not imply company create authority'
);
select throws_ok(
  $$select public.app_update_company('3a000000-0000-0000-0000-000000000003', '{"name":"Denied update"}'::jsonb)$$,
  '42501', 'permission denied: clients.edit',
  'Clients view access does not imply company edit authority'
);
select throws_ok(
  $$select public.app_archive_company('3a000000-0000-0000-0000-000000000003')$$,
  '42501', 'permission denied: clients.archive',
  'Clients view access does not imply company archive authority'
);

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000005';
select throws_ok(
  $$select public.app_create_company('7a000000-0000-0000-0000-000000000005', 'Archived actor company')$$,
  '42501', 'verified internal authentication is required',
  'archived internal actor cannot invoke company administration directly'
);

-- H-02: all seven Service/folder mutators enforce Services + capability.
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000002';
select lives_ok(
  $$insert into p0_ids values ('folder', (public.app_create_service_folder('7b000000-0000-0000-0000-000000000001', 'P0 Folder')).id)$$,
  'authorized staff can create a Service folder'
);
select lives_ok(
  $$select public.app_update_service_folder((select id from p0_ids where label = 'folder'), '{"description":"P0 secured"}'::jsonb)$$,
  'authorized staff can update a Service folder'
);
select lives_ok(
  $$insert into p0_ids values ('service', (public.app_create_service('7b000000-0000-0000-0000-000000000002', jsonb_build_object('name', 'P0 Secured Service', 'folder_id', (select id from p0_ids where label = 'folder'), 'image_url', 'https://cdn.example.invalid/service.png'))).id)$$,
  'authorized staff can create a Service with an HTTPS image'
);
select lives_ok(
  $$select public.app_update_service((select id from p0_ids where label = 'service'), '{"description":"Authorized update"}'::jsonb)$$,
  'authorized staff can update a Service'
);
select lives_ok(
  $$insert into p0_ids values ('duplicate', (public.app_duplicate_service('7b000000-0000-0000-0000-000000000003', (select id from p0_ids where label = 'service'))).id)$$,
  'authorized staff can duplicate a Service'
);
select lives_ok(
  $$select public.app_archive_service((select id from p0_ids where label = 'duplicate'))$$,
  'authorized staff can archive a Service'
);
select lives_ok(
  $$select public.app_archive_service_folder((select id from p0_ids where label = 'folder'))$$,
  'authorized staff can archive a Service folder'
);

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.app_create_service('7b000000-0000-0000-0000-000000000004', '{"name":"Denied module"}'::jsonb)$$,
  '42501', 'permission denied: services.view',
  'direct Service RPC cannot bypass a denied Services module'
);

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000004';
select throws_ok($$select public.app_create_service('7b000000-0000-0000-0000-000000000005', '{"name":"Denied create"}'::jsonb)$$, '42501', 'permission denied: services.create', 'Service create requires services.create');
select throws_ok($$select public.app_update_service((select id from p0_ids where label = 'service'), '{"name":"Denied edit"}'::jsonb)$$, '42501', 'permission denied: services.edit', 'Service update requires services.edit');
select throws_ok($$select public.app_archive_service((select id from p0_ids where label = 'service'))$$, '42501', 'permission denied: services.archive', 'Service archive requires services.archive');
select throws_ok($$select public.app_duplicate_service('7b000000-0000-0000-0000-000000000006', (select id from p0_ids where label = 'service'))$$, '42501', 'permission denied: services.create', 'Service duplicate requires services.create');
select throws_ok($$select public.app_create_service_folder('7b000000-0000-0000-0000-000000000007', 'Denied folder')$$, '42501', 'permission denied: services.create', 'Service folder create requires services.create');
select throws_ok($$select public.app_update_service_folder((select id from p0_ids where label = 'folder'), '{"name":"Denied folder edit"}'::jsonb)$$, '42501', 'permission denied: services.edit', 'Service folder update requires services.edit');
select throws_ok($$select public.app_archive_service_folder((select id from p0_ids where label = 'folder'))$$, '42501', 'permission denied: services.archive', 'Service folder archive requires services.archive');

set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_service('7b000000-0000-0000-0000-000000000008', '{"name":"Unsafe image","image_url":"javascript:alert(1)"}'::jsonb)$$,
  '23514', null,
  'database constraint rejects a non-HTTP Service image URL'
);

-- H-03: clients receive only the permission-gated safe projection.
set local "request.jwt.claim.sub" = '1a000000-0000-0000-0000-000000000001';
select is((select count(*) from public.orders), 0::bigint, 'client direct orders table read is blocked');
select is((select count(*) from public.order_tasks), 0::bigint, 'client direct order_tasks table read is blocked');
select is((select count(*) from public.app_list_my_client_projects()), 1::bigint, 'authorized client reads its own Project through the safe RPC');
select ok(
  (select task_total = 2 and task_open = 1 and service_name = 'P0 Project Service' from public.app_get_my_client_project('5a000000-0000-0000-0000-000000000001')),
  'safe Project projection exposes aggregate task progress without task rows'
);
select ok(
  not exists (
    select 1
    from public.app_get_my_client_project('5a000000-0000-0000-0000-000000000001') as project_row,
         lateral jsonb_object_keys(to_jsonb(project_row)) as exposed(key)
    where exposed.key in ('company_id', 'service_id', 'priority', 'notes', 'assigned_to_profile_id', 'task_title', 'task_description')
  )
  and (select to_jsonb(project_row)::text not like '%INTERNAL-%' from public.app_get_my_client_project('5a000000-0000-0000-0000-000000000001') as project_row),
  'internal Project and task fields cannot be retrieved through the client RPC'
);
select is(
  (select count(*) from public.app_get_my_client_project('5a000000-0000-0000-0000-000000000002')),
  0::bigint,
  'a valid foreign Project UUID returns no client row'
);

set local "request.jwt.claim.sub" = '1a000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select * from public.app_list_my_client_projects()$$,
  '42501', 'permission denied: projects.view',
  'client denied portal_projects cannot invoke the safe Project RPC directly'
);
select is((select count(*) from public.orders), 0::bigint, 'projects-denied client also has no direct table fallback');

select * from finish();
rollback;
