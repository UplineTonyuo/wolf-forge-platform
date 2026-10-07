begin;

select plan(42);

-- WL-1C.4: every Service and Service folder is owned by exactly one Tenant, and
-- the folder tree, a Service's folder and assignee, and the Service referenced
-- by an Order, an investment Ticket, a store interest or a Form version belong
-- to that same Tenant. Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = ...09f1.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select has_column('public', 'services', 'tenant_id', 'services.tenant_id exists');
select col_not_null('public', 'services', 'tenant_id', 'services.tenant_id is NOT NULL');
select has_column('public', 'service_folders', 'tenant_id', 'service_folders.tenant_id exists');
select col_not_null('public', 'service_folders', 'tenant_id', 'service_folders.tenant_id is NOT NULL');
select has_column('public', 'service_interests', 'tenant_id', 'service_interests.tenant_id exists');
select col_not_null('public', 'service_interests', 'tenant_id', 'service_interests.tenant_id is NOT NULL');
select hasnt_column('public', 'form_service_links', 'tenant_id', 'form_service_links inherits its Tenant through its Form version');

select is(
  (select jsonb_object_agg(conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conname in (
      'services_tenant_id_fkey', 'services_tenant_id_id_key',
      'service_folders_tenant_id_fkey', 'service_folders_tenant_id_id_key',
      'service_interests_tenant_id_fkey'
    )),
  jsonb_build_object(
    'services.services_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'services.services_tenant_id_id_key', 'UNIQUE (tenant_id, id)',
    'service_folders.service_folders_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'service_folders.service_folders_tenant_id_id_key', 'UNIQUE (tenant_id, id)',
    'service_interests.service_interests_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT'
  ),
  'Services, folders and store interests are Tenant-owned; Services and folders have Tenant-safe keys'
);

select is(
  (select jsonb_object_agg(conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conname in (
      'service_folders_parent_id_fkey', 'services_folder_id_fkey',
      'services_assigned_to_profile_id_fkey', 'orders_service_id_fkey',
      'tickets_investment_service_id_fkey', 'service_interests_company_id_fkey',
      'service_interests_service_id_fkey'
    )),
  jsonb_build_object(
    'service_folders.service_folders_parent_id_fkey', 'FOREIGN KEY (tenant_id, parent_id) REFERENCES service_folders(tenant_id, id) ON DELETE RESTRICT',
    'services.services_folder_id_fkey', 'FOREIGN KEY (tenant_id, folder_id) REFERENCES service_folders(tenant_id, id) ON DELETE SET NULL (folder_id)',
    'services.services_assigned_to_profile_id_fkey', 'FOREIGN KEY (tenant_id, assigned_to_profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE SET NULL (assigned_to_profile_id)',
    'orders.orders_service_id_fkey', 'FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE RESTRICT',
    'tickets.tickets_investment_service_id_fkey', 'FOREIGN KEY (tenant_id, investment_service_id) REFERENCES services(tenant_id, id) ON DELETE RESTRICT',
    'service_interests.service_interests_company_id_fkey', 'FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE CASCADE',
    'service_interests.service_interests_service_id_fkey', 'FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE CASCADE'
  ),
  'every Service-domain reference is Tenant-relative and keeps its deletion semantics'
);

select is(
  (select array_agg(table_name::text || '=' || column_default order by table_name)
    from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
      and table_name in ('services', 'service_folders', 'service_interests')),
  array[
    'service_folders=private.identity_tenant_id()',
    'service_interests=private.identity_tenant_id()',
    'services=private.identity_tenant_id()'
  ],
  'new Services, folders and store interests default to the caller''s resolved Tenant, not a fixed Wolf Forge default'
);

select is(
  (select count(*) from public.services where tenant_id <> private.wolf_forge_tenant_id())
  + (select count(*) from public.service_folders where tenant_id <> private.wolf_forge_tenant_id())
  + (select count(*) from public.service_interests where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing Service, folder and store interest was backfilled to the Wolf Forge Tenant'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 931 = owner U (internal in WF and B), 932 = staff W (internal in WF only).
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000931', 'authenticated', 'authenticated', 'svc-owner-b@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000932', 'authenticated', 'authenticated', 'svc-wf-staff@example.invalid', now(), now());

update public.profiles as profile
set role_id = role.id
from (values
  ('20000000-0000-0000-0000-000000000931', 'owner'),
  ('20000000-0000-0000-0000-000000000932', 'staff')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009f1', 'svc-tenant-b', 'Service Tenant B', 'active');

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-0000000009f1', '20000000-0000-0000-0000-000000000931', 'internal', role.id
from public.roles as role where role.name = 'owner';

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000931', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Service Client', 'client'),
  ('30000000-0000-0000-0000-000000000932', 'f0f0f0f0-0000-4000-8000-0000000009f1', 'B Service Client', 'client');

insert into public.service_folders (id, tenant_id, name)
values
  ('59900000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Folder'),
  ('59900000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009f1', 'B Folder');

insert into public.services (id, tenant_id, folder_id, name)
values
  ('59800000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001',
   '59900000-0000-0000-0000-000000000001', 'WF Service'),
  ('59800000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009f1',
   '59900000-0000-0000-0000-000000000002', 'B Service');

insert into public.forms (id, tenant_id, form_type, canonical_key, name, visibility,
  created_by_profile_id, updated_by_profile_id)
values
  ('59700000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'contact',
   'svc-tenancy-wf', 'WF Service Form', 'public',
   '20000000-0000-0000-0000-000000000931', '20000000-0000-0000-0000-000000000931'),
  ('59700000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009f1', 'contact',
   'svc-tenancy-b', 'B Service Form', 'public',
   '20000000-0000-0000-0000-000000000931', '20000000-0000-0000-0000-000000000931');

insert into public.form_versions (id, form_id, version_number, title, visibility, created_by_profile_id)
values
  ('59710000-0000-0000-0000-000000000001', '59700000-0000-0000-0000-000000000001', 1,
   'WF Service Form', 'public', '20000000-0000-0000-0000-000000000931'),
  ('59710000-0000-0000-0000-000000000002', '59700000-0000-0000-0000-000000000002', 1,
   'B Service Form', 'public', '20000000-0000-0000-0000-000000000931');

-- -----------------------------------------------------------------------------
-- Normal catalog creation takes the caller's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000931';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_service(gen_random_uuid(),
    jsonb_build_object('name', 'WF created'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in Service creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009f1"}', true);
select is(
  (select tenant_id from public.app_create_service(gen_random_uuid(),
    jsonb_build_object('name', 'B created', 'folder_id', '59900000-0000-0000-0000-000000000002'))),
  'f0f0f0f0-0000-4000-8000-0000000009f1'::uuid,
  'a signed-in Service creation with the Tenant B selector lands in Tenant B'
);

select is(
  (select tenant_id from public.app_create_service_folder(gen_random_uuid(),
    'B created folder', null, '59900000-0000-0000-0000-000000000002', 0)),
  'f0f0f0f0-0000-4000-8000-0000000009f1'::uuid,
  'a signed-in folder creation with the Tenant B selector lands in Tenant B'
);

select throws_ok(
  $$select public.app_create_service(gen_random_uuid(),
    jsonb_build_object('name', 'B created in WF folder', 'folder_id', '59900000-0000-0000-0000-000000000001'))$$,
  '23503',
  'insert or update on table "services" violates foreign key constraint "services_folder_id_fkey"',
  'a Tenant B Service created through app_create_service cannot use a Wolf Forge folder'
);

select throws_ok(
  $$select public.app_create_service_folder(gen_random_uuid(),
    'B created under WF folder', null, '59900000-0000-0000-0000-000000000001', 0)$$,
  '23503',
  'insert or update on table "service_folders" violates foreign key constraint "service_folders_parent_id_fkey"',
  'a Tenant B folder created through app_create_service_folder cannot nest under a Wolf Forge folder'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_service(gen_random_uuid(), jsonb_build_object('name', 'Garbage selector'))$$,
  '42501',
  null,
  'app_create_service with an invalid selector creates nothing'
);

select set_config('request.headers', '', true);
reset role;
-- Trusted writes below run without a signed-in user.
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.services
    where name in ('B created in WF folder', 'Garbage selector'))
  + (select count(*) from public.service_folders where name = 'B created under WF folder'),
  0::bigint,
  'no Service or folder was created by a failed selector or a cross-Tenant folder'
);

-- -----------------------------------------------------------------------------
-- Cross-Tenant catalog references are rejected even for trusted writes
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.service_folders (tenant_id, parent_id, name)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '59900000-0000-0000-0000-000000000001', 'x')$$,
  '23503',
  'insert or update on table "service_folders" violates foreign key constraint "service_folders_parent_id_fkey"',
  'a Tenant B folder cannot nest under a Wolf Forge folder'
);

select throws_ok(
  $$insert into public.service_folders (tenant_id, parent_id, name)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '59900000-0000-0000-0000-000000000002', 'x')$$,
  '23503',
  'insert or update on table "service_folders" violates foreign key constraint "service_folders_parent_id_fkey"',
  'a Wolf Forge folder cannot nest under a Tenant B folder'
);

select throws_ok(
  $$insert into public.services (tenant_id, folder_id, name)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '59900000-0000-0000-0000-000000000001', 'x')$$,
  '23503',
  'insert or update on table "services" violates foreign key constraint "services_folder_id_fkey"',
  'a Tenant B Service cannot sit in a Wolf Forge folder'
);

select throws_ok(
  $$update public.services set folder_id = '59900000-0000-0000-0000-000000000002'
    where id = '59800000-0000-0000-0000-000000000001'$$,
  '23503',
  'insert or update on table "services" violates foreign key constraint "services_folder_id_fkey"',
  'a Wolf Forge Service cannot be moved into a Tenant B folder'
);

select throws_ok(
  $$update public.services set assigned_to_profile_id = '20000000-0000-0000-0000-000000000932'
    where id = '59800000-0000-0000-0000-000000000002'$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B Service cannot be assigned to Wolf Forge-only staff'
);

select lives_ok(
  $$update public.services set assigned_to_profile_id = '20000000-0000-0000-0000-000000000931'
    where id = '59800000-0000-0000-0000-000000000002'$$,
  'a Tenant B Service can be assigned to a Tenant B internal member'
);

select throws_ok(
  $$update public.services set tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001'
    where id = '59800000-0000-0000-0000-000000000002'$$,
  '23503',
  null,
  'a Service cannot be moved to another Tenant while it references a Tenant B folder and assignee'
);

-- -----------------------------------------------------------------------------
-- Orders and investment Tickets reference Services of their own Tenant only
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, title)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000931',
      '59800000-0000-0000-0000-000000000002', 'x')$$,
  '23503',
  'insert or update on table "orders" violates foreign key constraint "orders_service_id_fkey"',
  'a Wolf Forge Order cannot be for a Tenant B Service'
);

select throws_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, title)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '30000000-0000-0000-0000-000000000932',
      '59800000-0000-0000-0000-000000000001', 'x')$$,
  '23503',
  'insert or update on table "orders" violates foreign key constraint "orders_service_id_fkey"',
  'a Tenant B Order cannot be for a Wolf Forge Service'
);

select lives_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, title)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '30000000-0000-0000-0000-000000000932',
      '59800000-0000-0000-0000-000000000002', 'B Service Order')$$,
  'a Tenant B Order can be for a Tenant B Service'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, investment_service_id, subject)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000931',
      '59800000-0000-0000-0000-000000000002', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_investment_service_id_fkey"',
  'a Wolf Forge Ticket cannot carry investment intent for a Tenant B Service'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, investment_service_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '30000000-0000-0000-0000-000000000932',
      '59800000-0000-0000-0000-000000000001', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_investment_service_id_fkey"',
  'a Tenant B Ticket cannot carry investment intent for a Wolf Forge Service'
);

select lives_ok(
  $$insert into public.tickets (tenant_id, company_id, investment_service_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '30000000-0000-0000-0000-000000000932',
      '59800000-0000-0000-0000-000000000002', 'B investment intent')$$,
  'a Tenant B Ticket can carry investment intent for a Tenant B Service'
);

-- -----------------------------------------------------------------------------
-- Store interests link a Client and a Service of the same Tenant
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.service_interests (tenant_id, company_id, service_id)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000931',
      '59800000-0000-0000-0000-000000000002')$$,
  '23503',
  'insert or update on table "service_interests" violates foreign key constraint "service_interests_service_id_fkey"',
  'a Wolf Forge Client cannot signal interest in a Tenant B Service'
);

select throws_ok(
  $$insert into public.service_interests (tenant_id, company_id, service_id)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '30000000-0000-0000-0000-000000000931',
      '59800000-0000-0000-0000-000000000002')$$,
  '23503',
  'insert or update on table "service_interests" violates foreign key constraint "service_interests_company_id_fkey"',
  'a Tenant B interest cannot belong to a Wolf Forge Client'
);

select lives_ok(
  $$insert into public.service_interests (tenant_id, company_id, service_id)
    values ('f0f0f0f0-0000-4000-8000-0000000009f1', '30000000-0000-0000-0000-000000000932',
      '59800000-0000-0000-0000-000000000002')$$,
  'a Tenant B Client can signal interest in a Tenant B Service'
);

-- -----------------------------------------------------------------------------
-- A Form version offers Services of its Form's Tenant only
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.form_service_links (form_version_id, service_id, role,
      service_name_snapshot, service_currency_snapshot, service_price_cents_snapshot)
    values ('59710000-0000-0000-0000-000000000002', '59800000-0000-0000-0000-000000000001',
      'offered_item', 'WF Service', 'USD', 0)$$,
  '23514',
  'form service link must reference a service of the form''s tenant',
  'a Tenant B Form version cannot offer a Wolf Forge Service'
);

select throws_ok(
  $$insert into public.form_service_links (form_version_id, service_id, role,
      service_name_snapshot, service_currency_snapshot, service_price_cents_snapshot)
    values ('59710000-0000-0000-0000-000000000001', '59800000-0000-0000-0000-000000000002',
      'offered_item', 'B Service', 'USD', 0)$$,
  '23514',
  'form service link must reference a service of the form''s tenant',
  'a Wolf Forge Form version cannot offer a Tenant B Service'
);

select lives_ok(
  $$insert into public.form_service_links (form_version_id, service_id, role,
      service_name_snapshot, service_currency_snapshot, service_price_cents_snapshot)
    values ('59710000-0000-0000-0000-000000000002', '59800000-0000-0000-0000-000000000002',
      'offered_item', 'B Service', 'USD', 0)$$,
  'a Tenant B Form version can offer a Tenant B Service'
);

-- A trusted re-pointing of an existing link is checked too (service_role has
-- no direct grant on form_service_links, so postgres stands in).
select throws_ok(
  $$update public.form_service_links set service_id = '59800000-0000-0000-0000-000000000001'
    where form_version_id = '59710000-0000-0000-0000-000000000002'$$,
  '23514',
  'form service link must reference a service of the form''s tenant',
  'a trusted write cannot re-point a Tenant B Form link at a Wolf Forge Service'
);

select throws_ok(
  $$update public.form_service_links set form_version_id = '59710000-0000-0000-0000-000000000001'
    where form_version_id = '59710000-0000-0000-0000-000000000002'$$,
  '23514',
  'form service link must reference a service of the form''s tenant',
  'a trusted write cannot move a Tenant B Service link under a Wolf Forge Form version'
);

-- -----------------------------------------------------------------------------
-- Deletion semantics keep ownership
-- -----------------------------------------------------------------------------

-- Remove the dependents so the B folder can be deleted.
delete from public.services where name = 'B created';
delete from public.service_folders where name = 'B created folder';
delete from public.service_folders where id = '59900000-0000-0000-0000-000000000002';

select is(
  (select row(tenant_id, folder_id)::text from public.services
    where id = '59800000-0000-0000-0000-000000000002'),
  row('f0f0f0f0-0000-4000-8000-0000000009f1'::uuid, null::uuid)::text,
  'deleting a folder clears only folder_id; the Service keeps its Tenant'
);

delete from public.tenant_memberships
where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009f1'
  and profile_id = '20000000-0000-0000-0000-000000000931';

select is(
  (select row(tenant_id, assigned_to_profile_id)::text from public.services
    where id = '59800000-0000-0000-0000-000000000002'),
  row('f0f0f0f0-0000-4000-8000-0000000009f1'::uuid, null::uuid)::text,
  'removing the assignee''s membership clears only assigned_to_profile_id; the Service keeps its Tenant'
);

select throws_ok(
  $$delete from public.services where id = '59800000-0000-0000-0000-000000000002'$$,
  '23503',
  null,
  'a Service referenced by an Order or Ticket of its Tenant cannot be deleted'
);

select * from finish();
rollback;
