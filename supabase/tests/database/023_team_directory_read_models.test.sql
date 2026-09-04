begin;

select plan(25);

-- =============================================================================
-- STRUCTURE
-- =============================================================================

select has_function(
  'public',
  'app_list_internal_members',
  'the internal directory read boundary exists'
);

select has_function(
  'public',
  'app_list_permission_preset_overview',
  'the preset overview read boundary exists'
);

select has_function(
  'public',
  'app_list_permission_preset_grants',
  'the preset grant read boundary exists'
);

select has_function(
  'public',
  'app_list_operational_assignees',
  'the narrow operational assignee read model exists'
);

select is(
  pg_get_function_result('public.app_list_operational_assignees()'::regprocedure),
  'TABLE(profile_id uuid, display_name text)',
  'the operational assignee read model exposes no role, company, archive, or avatar-storage fields'
);

-- =============================================================================
-- FIXTURES
--
-- The auth trigger creates every profile as an unclaimed client account, so the
-- internal fixtures are promoted below exactly as 022 does it.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('40000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'directory-owner@example.invalid', now(), now()),
  ('40000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'directory-admin@example.invalid', now(), now()),
  ('40000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'directory-manager@example.invalid', now(), now()),
  ('40000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'directory-staff@example.invalid', now(), now()),
  ('40000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'directory-client@example.invalid', now(), now()),
  ('40000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated',
   'directory-archived@example.invalid', now(), now());

insert into public.companies (id, name)
values ('41000000-0000-0000-0000-000000000001', 'Directory Company');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Directory Owner'
from public.roles as role_row
where role_row.name = 'owner'
  and profile_row.id = '40000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Directory Admin'
from public.roles as role_row
where role_row.name = 'admin'
  and profile_row.id = '40000000-0000-0000-0000-000000000002';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Directory Manager'
from public.roles as role_row
where role_row.name = 'manager'
  and profile_row.id = '40000000-0000-0000-0000-000000000003';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Directory Staff'
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '40000000-0000-0000-0000-000000000004';

update public.profiles
set company_id = '41000000-0000-0000-0000-000000000001',
    display_name = 'Directory Client'
where id = '40000000-0000-0000-0000-000000000005';

-- An archived member must not appear in the directory or in any count.
update public.profiles as profile_row
set role_id = role_row.id,
    display_name = 'Directory Archived',
    archived_at = now()
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '40000000-0000-0000-0000-000000000006';

-- The capability catalog is revoked from every API role, so the numbers the
-- read models are checked against are captured here, before the session drops
-- to an ordinary authenticated caller.
create temporary table directory_expected as
select
  (select count(*)::integer from public.permissions) as permission_total,
  (
    select count(*)::integer
    from public.role_permissions as grant_row
    join public.roles as role_row on role_row.id = grant_row.role_id
    where role_row.name = 'staff'
      and grant_row.allowed
  ) as staff_grant_total;

grant select on directory_expected to authenticated;

-- =============================================================================
-- THE DIRECTORY IS GATED ON users.view, NOT ON BEING INTERNAL
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '40000000-0000-0000-0000-000000000003';

select is(
  (
    select count(*)
    from public.app_list_operational_assignees()
    where profile_id in (
      '40000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000003',
      '40000000-0000-0000-0000-000000000004',
      '40000000-0000-0000-0000-000000000005',
      '40000000-0000-0000-0000-000000000006'
    )
  ),
  4::bigint,
  'operational pickers retain active internal names while excluding clients and archived profiles'
);

select throws_ok(
  $$ select * from public.app_list_internal_members() $$,
  '42501',
  null,
  'a manager without users.view cannot read the team directory'
);

select throws_ok(
  $$ select * from public.app_list_permission_preset_overview() $$,
  '42501',
  null,
  'a manager without users.view cannot read the role map'
);

select throws_ok(
  $$ select * from public.app_list_permission_preset_grants() $$,
  '42501',
  null,
  'a manager without users.view cannot read preset grants'
);

set local "request.jwt.claim.sub" = '40000000-0000-0000-0000-000000000005';

select throws_ok(
  $$select * from public.app_list_operational_assignees()$$,
  '42501',
  'verified internal authentication is required',
  'a client account cannot invoke the internal operational assignee projection'
);

select throws_ok(
  $$ select * from public.app_list_internal_members() $$,
  '42501',
  null,
  'a client portal account cannot read the internal directory'
);

-- =============================================================================
-- WHAT AN AUTHORIZED ADMINISTRATOR SEES
-- =============================================================================

set local "request.jwt.claim.sub" = '40000000-0000-0000-0000-000000000002';

select is(
  (
    select count(*)
    from public.app_list_internal_members() as member_row
    where member_row.profile_id in (
      '40000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000003',
      '40000000-0000-0000-0000-000000000004'
    )
  ),
  4::bigint,
  'every active internal member is listed'
);

select is(
  (
    select count(*)
    from public.app_list_internal_members() as member_row
    where member_row.profile_id in (
      '40000000-0000-0000-0000-000000000005',
      '40000000-0000-0000-0000-000000000006'
    )
  ),
  0::bigint,
  'client accounts and archived members are never listed'
);

select is(
  (
    select member_row.email
    from public.app_list_internal_members() as member_row
    where member_row.profile_id = '40000000-0000-0000-0000-000000000004'
  ),
  'directory-staff@example.invalid',
  'the directory resolves the login email that public.profiles does not carry'
);

select is(
  (
    select member_row.preset_name
    from public.app_list_internal_members() as member_row
    where member_row.profile_id = '40000000-0000-0000-0000-000000000002'
  ),
  'Administrator',
  'the directory reports the real preset display name'
);

select ok(
  (
    select member_row.is_self
    from public.app_list_internal_members() as member_row
    where member_row.profile_id = '40000000-0000-0000-0000-000000000002'
  )
  and not (
    select member_row.is_self
    from public.app_list_internal_members() as member_row
    where member_row.profile_id = '40000000-0000-0000-0000-000000000001'
  ),
  'the caller is identified from auth.uid(), never from an argument'
);

select is(
  (
    select member_row.override_count
    from public.app_list_internal_members() as member_row
    where member_row.profile_id = '40000000-0000-0000-0000-000000000004'
  ),
  0,
  'a member with no overrides reports none'
);

-- =============================================================================
-- ROLE MAP NUMBERS COME FROM THE REAL GRANT STORE
-- =============================================================================

select is(
  (
    select count(*)
    from public.app_list_permission_preset_overview()
  ),
  5::bigint,
  'the role map covers every system preset, client included'
);

select is(
  (
    select overview_row.granted_permission_count
    from public.app_list_permission_preset_overview() as overview_row
    where overview_row.preset_key = 'owner'
  ),
  (select permission_total from directory_expected),
  'owner reports full breadth because the resolver bypasses grant rows'
);

select is(
  (
    select overview_row.granted_permission_count
    from public.app_list_permission_preset_overview() as overview_row
    where overview_row.preset_key = 'staff'
  ),
  (select staff_grant_total from directory_expected),
  'a preset reports exactly the grants public.role_permissions holds'
);

select ok(
  (
    select overview_row.member_count
    from public.app_list_permission_preset_overview() as overview_row
    where overview_row.preset_key = 'staff'
  ) = 1,
  'member counts exclude archived profiles'
);

-- =============================================================================
-- PRESET GRANT DETAIL
-- =============================================================================

select is(
  (
    select count(*)::integer
    from public.app_list_permission_preset_grants() as grant_row
    where grant_row.preset_key = 'manager'
  ),
  (select permission_total from directory_expected),
  'the grid covers the whole capability catalog, allowed or not'
);

select ok(
  (
    select bool_and(grant_row.allowed)
    from public.app_list_permission_preset_grants() as grant_row
    where grant_row.preset_key = 'owner'
  ),
  'owner shows every capability as granted'
);

select ok(
  (
    select grant_row.allowed
    from public.app_list_permission_preset_grants() as grant_row
    where grant_row.preset_key = 'staff'
      and grant_row.permission_key = 'projects.view'
  )
  and not (
    select grant_row.allowed
    from public.app_list_permission_preset_grants() as grant_row
    where grant_row.preset_key = 'staff'
      and grant_row.permission_key = 'users.manage_permissions'
  ),
  'grant detail matches the resolver for a non-owner preset'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- DIRECT ACCESS PROTECTION
-- =============================================================================

select ok(
  not has_function_privilege('anon', 'public.app_list_internal_members()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_list_permission_preset_overview()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_list_permission_preset_grants()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_list_internal_members()', 'EXECUTE'),
  'the directory read boundary is reachable only by an authenticated session'
);

select * from finish();

rollback;
