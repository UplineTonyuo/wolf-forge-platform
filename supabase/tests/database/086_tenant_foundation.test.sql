begin;

select plan(48);

-- -----------------------------------------------------------------------------
-- Structure
-- -----------------------------------------------------------------------------

select has_table('public', 'tenants', 'tenants exists');
select has_table('public', 'tenant_memberships', 'tenant_memberships exists');

select columns_are(
  'public', 'tenants',
  array['id', 'slug', 'display_name', 'status', 'created_at', 'updated_at', 'archived_at'],
  'tenants has exactly the WL-1A columns'
);
select columns_are(
  'public', 'tenant_memberships',
  array['id', 'tenant_id', 'profile_id', 'account_class', 'role_id', 'company_id',
        'created_at', 'updated_at', 'archived_at'],
  'tenant_memberships has exactly the WL-1A columns'
);

select col_is_unique('public', 'tenant_memberships', array['tenant_id', 'profile_id'],
  'one membership per tenant and profile');
select col_is_unique('public', 'tenants', array['slug'], 'tenant slugs are unique');
select fk_ok('public', 'tenant_memberships', 'tenant_id', 'public', 'tenants', 'id',
  'membership tenant references tenants');
select fk_ok('public', 'tenant_memberships', 'profile_id', 'public', 'profiles', 'id',
  'membership profile references profiles');
select fk_ok('public', 'tenant_memberships', 'role_id', 'public', 'roles', 'id',
  'membership role references roles');
select fk_ok('public', 'tenant_memberships', array['tenant_id', 'company_id'],
  'public', 'companies', array['tenant_id', 'id'],
  'membership company references a Client of the same Tenant (WL-1C.1)');
select col_is_null('public', 'tenant_memberships', 'company_id',
  'company_id is nullable for unassigned client identities');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.tenants'::regclass, 'public.tenant_memberships'::regclass)),
  'RLS is enabled on both tables'
);
select ok(
  (select bool_and(relforcerowsecurity) from pg_class
    where oid in ('public.tenants'::regclass, 'public.tenant_memberships'::regclass)),
  'RLS is forced on both tables'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename in ('tenants', 'tenant_memberships')),
  0::bigint,
  'no access policies exist yet'
);

-- -----------------------------------------------------------------------------
-- Seed
-- -----------------------------------------------------------------------------

select is((select count(*) from public.tenants), 1::bigint, 'exactly one tenant is seeded');
select is(
  (select id from public.tenants where slug = 'wolf-forge'),
  private.wolf_forge_tenant_id(),
  'the seeded Wolf Forge tenant uses the canonical fixed id'
);
select is(
  private.wolf_forge_tenant_id(),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'the canonical id is stable'
);
select throws_ok(
  $$delete from public.tenants where id = private.wolf_forge_tenant_id()$$,
  '42501',
  'the Wolf Forge system tenant cannot be deleted',
  'deleting the Wolf Forge tenant is refused'
);

-- -----------------------------------------------------------------------------
-- Backfill: profiles that exist before the mirror runs
-- -----------------------------------------------------------------------------

alter table public.profiles disable trigger profiles_mirror_tenant_membership;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000861', 'authenticated', 'authenticated', 'tenant-admin@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000862', 'authenticated', 'authenticated', 'tenant-client@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000863', 'authenticated', 'authenticated', 'tenant-archived@example.invalid', now(), now());

insert into public.companies (id, name, status)
values ('30000000-0000-0000-0000-000000000861', 'Tenant Foundation Client', 'client');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id = '20000000-0000-0000-0000-000000000861' and role.name = 'admin';

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000861'
where id = '20000000-0000-0000-0000-000000000862';

update public.profiles
set archived_at = now()
where id = '20000000-0000-0000-0000-000000000863';

delete from public.tenant_memberships
where profile_id in (
  '20000000-0000-0000-0000-000000000861',
  '20000000-0000-0000-0000-000000000862',
  '20000000-0000-0000-0000-000000000863'
);

select is(
  private.backfill_wolf_forge_tenant_memberships(),
  (select count(*) from public.profiles as profile_row
    where not exists (
      select 1 from public.tenant_memberships as membership_row
      where membership_row.profile_id = profile_row.id
    )),
  'the backfill creates one membership for each profile that lacks one'
);
select is(
  private.backfill_wolf_forge_tenant_memberships(),
  0::bigint,
  'repeating the backfill inserts nothing'
);

alter table public.profiles enable trigger profiles_mirror_tenant_membership;

create temporary view mirror_drift as
select profile_row.id
from public.profiles as profile_row
full join public.tenant_memberships as membership_row
  on membership_row.profile_id = profile_row.id
left join public.permission_presets as preset_row
  on preset_row.role_id = profile_row.role_id
where membership_row.id is null
  or profile_row.id is null
  or membership_row.tenant_id is distinct from private.wolf_forge_tenant_id()
  or membership_row.role_id is distinct from profile_row.role_id
  or membership_row.company_id is distinct from profile_row.company_id
  or membership_row.archived_at is distinct from profile_row.archived_at
  or membership_row.account_class is distinct from preset_row.account_class;

select is(
  (select count(*) from public.tenant_memberships),
  (select count(*) from public.profiles),
  'membership count equals profile count'
);
select is(
  (select count(*) from public.profiles as profile_row
    join public.tenant_memberships as membership_row on membership_row.profile_id = profile_row.id
    where membership_row.role_id is distinct from profile_row.role_id),
  0::bigint,
  'every membership matches its profile role_id'
);
select is(
  (select count(*) from public.profiles as profile_row
    join public.tenant_memberships as membership_row on membership_row.profile_id = profile_row.id
    where membership_row.company_id is distinct from profile_row.company_id),
  0::bigint,
  'every membership matches its profile company_id'
);
select is(
  (select count(*) from public.profiles as profile_row
    join public.tenant_memberships as membership_row on membership_row.profile_id = profile_row.id
    where membership_row.archived_at is distinct from profile_row.archived_at),
  0::bigint,
  'every membership matches its profile archived_at'
);
select is(
  (select account_class from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000861'),
  'internal',
  'an admin profile maps to an internal membership'
);
select is(
  (select account_class from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000862'),
  'client',
  'a client profile maps to a client membership'
);
select is((select count(*) from mirror_drift), 0::bigint, 'no drift after the backfill');

-- -----------------------------------------------------------------------------
-- Ongoing mirror
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000864', 'authenticated', 'authenticated', 'tenant-new@example.invalid', now(), now());

-- D-275 (WL-2.15) replaces the WL-1A insert mirror: a new identity is not a
-- member of any Tenant until it is explicitly provisioned.
select is(
  (select count(*) from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000864'),
  0::bigint,
  'a new profile creates no Tenant membership'
);

update public.profiles
set company_id = '30000000-0000-0000-0000-000000000861'
where id = '20000000-0000-0000-0000-000000000864';

select is(
  (select company_id from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000864'),
  '30000000-0000-0000-0000-000000000861'::uuid,
  'a Wolf Forge Client link explicitly provisions the fresh identity into Wolf Forge'
);

update public.profiles
set company_id = null
where id = '20000000-0000-0000-0000-000000000864';

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id = '20000000-0000-0000-0000-000000000864' and role.name = 'staff';

select is(
  (select row(role_id, account_class)::text from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000864'),
  (select row(id, 'internal'::text)::text from public.roles where name = 'staff'),
  'a profile role update updates the membership role and account class'
);

update public.profiles
set archived_at = '2026-10-07 12:00:00+00'
where id = '20000000-0000-0000-0000-000000000864';

select is(
  (select archived_at from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000864'),
  '2026-10-07 12:00:00+00'::timestamptz,
  'a profile archive update updates the membership'
);

update public.profiles
set archived_at = null
where id = '20000000-0000-0000-0000-000000000864';

select is(
  (select archived_at from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000864'),
  null::timestamptz,
  'a profile restore clears the membership archive'
);

-- Fail closed: a role with no permission preset cannot be mirrored.
insert into public.roles (id, name)
values ('40000000-0000-0000-0000-000000000861', 'qa_unmapped_role');

select throws_ok(
  $$update public.profiles set role_id = '40000000-0000-0000-0000-000000000861'
    where id = '20000000-0000-0000-0000-000000000864'$$,
  '23514',
  'profile role has no permission preset; tenant membership cannot be mirrored',
  'a mirror failure aborts the profile write'
);
select is(
  (select role_id from public.profiles where id = '20000000-0000-0000-0000-000000000864'),
  (select id from public.roles where name = 'staff'),
  'the aborted profile write left the profile unchanged'
);

-- WL-1C.1 enforces the WL-1A deferred invariant: an internal membership never
-- holds a Client. The fail-closed mirror rejects the profile write itself.
select throws_ok(
  $$update public.profiles
    set company_id = '30000000-0000-0000-0000-000000000861'
    where id = '20000000-0000-0000-0000-000000000864'$$,
  '23514',
  'new row for relation "tenant_memberships" violates check constraint "tenant_memberships_internal_has_no_company"',
  'an internal profile cannot hold a company (mirror fails closed)'
);
select is(
  (select company_id from public.profiles
    where id = '20000000-0000-0000-0000-000000000864'),
  null::uuid,
  'the rejected internal profile write left the profile unchanged'
);

-- Deleting a Client nulls the profile and the membership together, as before.
delete from public.companies where id = '30000000-0000-0000-0000-000000000861';

select is(
  (select company_id from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000862'),
  null::uuid,
  'deleting a Client clears the mirrored company'
);

delete from auth.users where id = '20000000-0000-0000-0000-000000000863';

select is(
  (select count(*) from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000863'),
  0::bigint,
  'deleting the identity removes its membership'
);
select is((select count(*) from mirror_drift), 0::bigint, 'no drift after every mirrored change');

-- Direct writes cannot introduce a disallowed shape either.
select throws_ok(
  $$insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
    select private.wolf_forge_tenant_id(), '20000000-0000-0000-0000-000000000864', 'platform', role_id
    from public.profiles where id = '20000000-0000-0000-0000-000000000864'$$,
  '23514',
  null,
  'account_class only allows internal or client'
);

-- -----------------------------------------------------------------------------
-- Browser roles and helper privileges
-- -----------------------------------------------------------------------------

select ok(
  not has_table_privilege('service_role', 'public.tenants', 'select')
  and not has_table_privilege('service_role', 'public.tenant_memberships', 'select'),
  'service_role has no direct grant on the tenant tables'
);
select is(
  (select count(*) from pg_proc as function_row
    join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'private'
      and function_row.proname in (
        'wolf_forge_tenant_id', 'protect_wolf_forge_tenant',
        'backfill_wolf_forge_tenant_memberships', 'mirror_profile_tenant_membership'
      )
      and function_row.proacl is not null),
  4::bigint,
  'every new private helper carries an explicit ACL'
);
select ok(
  (select bool_and(
      not has_function_privilege('anon', function_row.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      and not has_function_privilege('service_role', function_row.oid, 'EXECUTE'))
    from pg_proc as function_row
    join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'private'
      and function_row.proname in (
        'wolf_forge_tenant_id', 'protect_wolf_forge_tenant',
        'backfill_wolf_forge_tenant_memberships', 'mirror_profile_tenant_membership'
      )),
  'no browser or service role can execute the new private helpers'
);

set local role anon;

select throws_ok('select * from public.tenants', '42501', null, 'anon cannot read tenants');
select throws_ok('select * from public.tenant_memberships', '42501', null, 'anon cannot read memberships');

reset role;
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000861';

select throws_ok('select * from public.tenants', '42501', null, 'authenticated cannot read tenants');
select throws_ok('select * from public.tenant_memberships', '42501', null, 'authenticated cannot read memberships');
select throws_ok(
  'select private.wolf_forge_tenant_id()',
  '42501',
  null,
  'authenticated cannot execute the Wolf Forge tenant helper'
);

reset role;

select * from finish();

rollback;
