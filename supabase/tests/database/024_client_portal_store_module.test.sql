begin;

select plan(14);

-- =============================================================================
-- STRUCTURE
--
-- Store adds no table, view or RPC. It adds one client capability and one
-- client-class module, so the portal rail can be derived from a real permission
-- the same way every other module is.
-- =============================================================================

select is(
  (select count(*) from public.permissions where permission_key = 'store.view'),
  1::bigint,
  'the store.view capability exists'
);

select is(
  (
    select account_class || '|' || required_permission_key
    from public.permission_modules
    where module_key = 'portal_store'
  ),
  'client|store.view',
  'portal_store is a client-class module backed by store.view'
);

-- The whole point of minting store.view instead of reusing services.view.
select is(
  (
    select count(*)
    from public.permission_modules
    where account_class = 'client'
      and required_permission_key = 'services.view'
  ),
  0::bigint,
  'no client module references the internal services.view capability'
);

select ok(
  private.is_client_eligible_permission('store.view')
  and not private.is_client_eligible_permission('services.view'),
  'store.view is client-eligible and services.view is not'
);

select is(
  (
    select grant_row.allowed
    from public.role_permissions as grant_row
    join public.roles as role_row on role_row.id = grant_row.role_id
    where role_row.name = 'client'
      and grant_row.permission_key = 'store.view'
  ),
  true,
  'the client preset holds store.view'
);

-- =============================================================================
-- FIXTURES
--
-- The auth trigger creates every profile as an unclaimed client account, so the
-- client fixture only needs its company attached.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('50000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'store-client@example.invalid', now(), now()),
  ('50000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'store-staff@example.invalid', now(), now());

insert into public.companies (id, name)
values ('51000000-0000-0000-0000-000000000001', 'Store Company');

update public.profiles
set company_id = '51000000-0000-0000-0000-000000000001',
    display_name = 'Store Client'
where id = '50000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Store Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '50000000-0000-0000-0000-000000000002';

insert into public.service_folders (id, name, sort_order)
values
  ('52000000-0000-0000-0000-000000000001', 'Store Visible Folder', 1),
  ('52000000-0000-0000-0000-000000000002', 'Store Hidden Folder', 2);

insert into public.services (id, name, folder_id, price, is_active, is_public, archived_at)
values
  ('53000000-0000-0000-0000-000000000001', 'Public Active Service',
   '52000000-0000-0000-0000-000000000001', 100, true, true, null),
  ('53000000-0000-0000-0000-000000000002', 'Private Service',
   '52000000-0000-0000-0000-000000000002', 100, true, false, null),
  ('53000000-0000-0000-0000-000000000003', 'Inactive Service',
   '52000000-0000-0000-0000-000000000002', 100, false, true, null),
  ('53000000-0000-0000-0000-000000000004', 'Archived Service',
   '52000000-0000-0000-0000-000000000002', 100, true, true, now());

-- =============================================================================
-- CLIENT SESSION
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '50000000-0000-0000-0000-000000000001';

select is(
  (
    select count(*)
    from public.services
    where id in (
      '53000000-0000-0000-0000-000000000001',
      '53000000-0000-0000-0000-000000000002',
      '53000000-0000-0000-0000-000000000003',
      '53000000-0000-0000-0000-000000000004'
    )
  ),
  1::bigint,
  'a client session reads only the public, active, non-archived service'
);

select is(
  (select name from public.services where id = '53000000-0000-0000-0000-000000000001'),
  'Public Active Service',
  'the client-visible service is the one the Store presents'
);

select is(
  (
    select granted
    from public.app_current_user_modules()
    where module_key = 'portal_store'
  ),
  true,
  'the client resolver grants the portal_store module'
);

select is(
  (
    select count(*)
    from public.app_current_user_modules()
    where account_class <> 'client'
  ),
  0::bigint,
  'the client resolver never returns an internal module'
);

select lives_ok(
  $$ select public.app_require_module_access('portal_store') $$,
  'a client session passes the portal_store gate'
);

-- Store grants no internal Services access. This is the guarantee that makes
-- the client-facing Store safe to build on the internal catalog.
select throws_ok(
  $$ select public.app_require_module_access('services') $$,
  '42501',
  null,
  'a client session is still refused the internal Services module'
);

-- =============================================================================
-- INTERNAL SESSION
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '50000000-0000-0000-0000-000000000002';

-- Account class is checked before the capability, so a portal module is not
-- reachable by an internal actor even though staff can read the catalog.
select throws_ok(
  $$ select public.app_require_module_access('portal_store') $$,
  '42501',
  null,
  'an internal session cannot enter a client portal module'
);

select is(
  (
    select count(*)
    from public.app_current_user_modules()
    where module_key like 'portal\_%'
  ),
  0::bigint,
  'the internal resolver returns no client portal module'
);

select is(
  (
    select count(*)
    from public.services
    where id in (
      '53000000-0000-0000-0000-000000000001',
      '53000000-0000-0000-0000-000000000002',
      '53000000-0000-0000-0000-000000000003',
      '53000000-0000-0000-0000-000000000004'
    )
  ),
  4::bigint,
  'internal catalog visibility is unchanged by the Store module'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
