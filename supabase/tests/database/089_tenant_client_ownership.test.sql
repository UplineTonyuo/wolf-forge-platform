begin;

select plan(16);

-- WL-1C.1: Clients, contacts, Companies and their memberships cannot cross a
-- Tenant boundary. Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = f0f0f0f0-0000-4000-8000-0000000009b1.

select is(
  (select count(*) from public.companies where tenant_id <> private.wolf_forge_tenant_id())
  + (select count(*) from public.client_contacts where tenant_id <> private.wolf_forge_tenant_id())
  + (select count(*) from public.organizations where tenant_id <> private.wolf_forge_tenant_id())
  + (select count(*) from public.organization_members where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing row was backfilled to the Wolf Forge Tenant'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 891 = person P (client in both Tenants), 892 = owner U (internal in both),
-- 893 = person Q (client of a Tenant B Client only).
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000891', 'authenticated', 'authenticated', 'own-person@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000892', 'authenticated', 'authenticated', 'own-owner@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000893', 'authenticated', 'authenticated', 'own-other@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009b1', 'own-tenant-b', 'Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000891', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Client', 'client'),
  ('30000000-0000-0000-0000-000000000892', 'f0f0f0f0-0000-4000-8000-0000000009b1', 'B Client', 'client'),
  ('30000000-0000-0000-0000-000000000893', 'f0f0f0f0-0000-4000-8000-0000000009b1', 'B Client 2', 'client');

update public.profiles as profile
set role_id = role.id,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000891', 'client', '30000000-0000-0000-0000-000000000891'),
  ('20000000-0000-0000-0000-000000000892', 'owner',  null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select 'f0f0f0f0-0000-4000-8000-0000000009b1', fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000891', 'client',   'client', '30000000-0000-0000-0000-000000000892'),
  ('20000000-0000-0000-0000-000000000892', 'internal', 'owner',  null),
  ('20000000-0000-0000-0000-000000000893', 'client',   'client', '30000000-0000-0000-0000-000000000893')
) as fixture(profile_id, account_class, role_name, company_id)
join public.roles as role on role.name = fixture.role_name;

-- -----------------------------------------------------------------------------
-- Cross-Tenant references are rejected
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.client_contacts (tenant_id, company_id, name)
    values ('f0f0f0f0-0000-4000-8000-0000000009b1', '30000000-0000-0000-0000-000000000891', 'B contact of WF Client')$$,
  '23503',
  'insert or update on table "client_contacts" violates foreign key constraint "client_contacts_company_id_fkey"',
  'a contact in Tenant B cannot belong to a Wolf Forge Client'
);

select throws_ok(
  $$update public.tenant_memberships
    set company_id = '30000000-0000-0000-0000-000000000892'
    where tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001'
      and profile_id = '20000000-0000-0000-0000-000000000891'$$,
  '23503',
  'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_company_id_fkey"',
  'a Wolf Forge membership cannot hold a Tenant B Client'
);

-- -----------------------------------------------------------------------------
-- One person, two Tenants
-- -----------------------------------------------------------------------------

select lives_ok(
  $$insert into public.client_contacts (id, tenant_id, company_id, profile_id, name)
    values ('35000000-0000-0000-0000-000000000891', 'f0f0f0f0-0000-4000-8000-000000000001',
      '30000000-0000-0000-0000-000000000891', '20000000-0000-0000-0000-000000000891', 'P at WF')$$,
  'P is linked as a contact of its Wolf Forge Client'
);

select lives_ok(
  $$insert into public.client_contacts (id, tenant_id, company_id, profile_id, name)
    values ('35000000-0000-0000-0000-000000000892', 'f0f0f0f0-0000-4000-8000-0000000009b1',
      '30000000-0000-0000-0000-000000000892', '20000000-0000-0000-0000-000000000891', 'P at B')$$,
  'the same P is also linked as a contact of its Tenant B Client'
);

select throws_ok(
  $$insert into public.client_contacts (tenant_id, company_id, profile_id, name)
    values ('f0f0f0f0-0000-4000-8000-0000000009b1', '30000000-0000-0000-0000-000000000892',
      '20000000-0000-0000-0000-000000000892', 'U at B')$$,
  '23503',
  'insert or update on table "client_contacts" violates foreign key constraint "client_contacts_profile_membership_fkey"',
  'a profile without a client membership of that Client in that Tenant cannot be linked'
);

select throws_ok(
  $$insert into public.client_contacts (tenant_id, company_id, profile_id, name)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000891',
      '20000000-0000-0000-0000-000000000891', 'P at WF again')$$,
  '23505',
  'duplicate key value violates unique constraint "client_contacts_active_profile_id_key"',
  'P is still linked to at most one active contact per Tenant'
);

-- -----------------------------------------------------------------------------
-- Company / Team membership
-- -----------------------------------------------------------------------------

insert into public.organizations (id, name)
values ('60000000-0000-0000-0000-000000000891', 'WF Team');

select throws_ok(
  $$insert into public.organization_members (tenant_id, organization_id, contact_id)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '60000000-0000-0000-0000-000000000891',
      '35000000-0000-0000-0000-000000000892')$$,
  '23503',
  'insert or update on table "organization_members" violates foreign key constraint "organization_members_contact_id_fkey"',
  'a Wolf Forge Company cannot gain a Tenant B contact'
);

select throws_ok(
  $$insert into public.organization_members (tenant_id, organization_id, contact_id)
    values ('f0f0f0f0-0000-4000-8000-0000000009b1', '60000000-0000-0000-0000-000000000891',
      '35000000-0000-0000-0000-000000000892')$$,
  '23503',
  'insert or update on table "organization_members" violates foreign key constraint "organization_members_organization_id_fkey"',
  'a Tenant B membership row cannot point at a Wolf Forge Company'
);

-- -----------------------------------------------------------------------------
-- Internal memberships hold no Client
-- -----------------------------------------------------------------------------

select throws_ok(
  $$update public.tenant_memberships
    set company_id = '30000000-0000-0000-0000-000000000892'
    where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009b1'
      and profile_id = '20000000-0000-0000-0000-000000000892'$$,
  '23514',
  'new row for relation "tenant_memberships" violates check constraint "tenant_memberships_internal_has_no_company"',
  'an internal membership cannot hold a Client'
);

-- -----------------------------------------------------------------------------
-- tenant_id default
-- -----------------------------------------------------------------------------

set local role service_role;
select throws_ok(
  $$insert into public.companies (name) values ('No Tenant')$$,
  '42501',
  'permission denied for function identity_tenant_id',
  'service_role must supply tenant_id explicitly'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000892';

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);
select is(
  (select tenant_id from public.app_create_organization(gen_random_uuid(), 'B Team')),
  'f0f0f0f0-0000-4000-8000-0000000009b1'::uuid,
  'a signed-in RPC with the Tenant B selector creates the row in Tenant B'
);

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_organization(gen_random_uuid(), 'WF Team 2')),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in RPC without a selector creates the row in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_organization(gen_random_uuid(), 'Nowhere Team')$$,
  '42501',
  null,
  'a signed-in RPC with an invalid selector creates nothing'
);

select set_config('request.headers', '', true);
reset role;
set local "request.jwt.claim.sub" = '';

-- -----------------------------------------------------------------------------
-- Delete semantics keep tenant_id
-- -----------------------------------------------------------------------------

delete from public.companies where id = '30000000-0000-0000-0000-000000000893';
select is(
  (select row(tenant_id, company_id)::text from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000893'
      and tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009b1'),
  row('f0f0f0f0-0000-4000-8000-0000000009b1'::uuid, null::uuid)::text,
  'deleting a Client clears only the membership company, not its Tenant'
);

delete from auth.users where id = '20000000-0000-0000-0000-000000000891';
select is(
  (select array_agg(row(tenant_id, profile_id)::text order by id) from public.client_contacts
    where id in ('35000000-0000-0000-0000-000000000891', '35000000-0000-0000-0000-000000000892')),
  array[
    row('f0f0f0f0-0000-4000-8000-000000000001'::uuid, null::uuid)::text,
    row('f0f0f0f0-0000-4000-8000-0000000009b1'::uuid, null::uuid)::text
  ],
  'deleting a person unlinks its contacts in both Tenants and keeps each contact''s Tenant'
);

select * from finish();
rollback;
