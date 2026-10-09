begin;

select plan(79);

-- WL-2.32 (KI-146 / D-296): Platform Admin is a global entitlement held only
-- through an explicit, postgres-provisioned grant in private.platform_admins.
-- No Tenant role, membership, selector, header or JWT claim implies it; no API
-- role can create, revive or read a grant; archived identities and revoked
-- grants never pass. WF = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = f0f0f0f0-0000-4000-8000-000000003101.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 3101 granted Platform Admin (WF admin).  3102 WF owner.  3103 B owner.
-- 3104 WF client.  3105 granted, then archived.  3106 dual-Tenant (WF owner +
-- B owner), no grant.  3107 dual-Tenant (WF staff + B owner), granted.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'platform-admin-' || n || '@example.invalid', now(), now()
from unnest(array['3101', '3102', '3103', '3104', '3105', '3106', '3107']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000003101', 'platform-admin-tenant-b', 'Platform Admin Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values ('e7000000-0000-4000-8000-000000003101', private.wolf_forge_tenant_id(), 'PA WF Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000003101', 'admin', null),
  ('20000000-0000-4000-8000-000000003102', 'owner', null),
  ('20000000-0000-4000-8000-000000003104', 'client', 'e7000000-0000-4000-8000-000000003101'),
  ('20000000-0000-4000-8000-000000003105', 'admin', null),
  ('20000000-0000-4000-8000-000000003106', 'owner', null),
  ('20000000-0000-4000-8000-000000003107', 'staff', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-000000003101', fixture.profile_id::uuid, 'internal', role.id
from (values
  ('20000000-0000-4000-8000-000000003103'),
  ('20000000-0000-4000-8000-000000003106'),
  ('20000000-0000-4000-8000-000000003107')
) as fixture(profile_id)
join public.roles as role on role.name = 'owner';

select private.grant_platform_admin('20000000-0000-4000-8000-000000003101', 'pgTAP 128 fixture');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003105', 'pgTAP 128 fixture');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003107', 'pgTAP 128 fixture');
update public.profiles set archived_at = now() where id = '20000000-0000-4000-8000-000000003105';

-- Snapshot of Tenant data the checks must never touch.
create temp table tenant_data_before as
select
  (select count(*) from public.tenant_memberships) as memberships,
  (select md5(string_agg(t::text, ',' order by t.id)) from public.tenants as t) as tenants,
  (select md5(string_agg(p::text, ',' order by p.id)) from public.profiles as p) as profiles;

create function pg_temp.act(p_actor text, p_headers text default '', p_claims text default '')
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub',
    coalesce('20000000-0000-4000-8000-00000000' || p_actor, ''), true);
  select set_config('request.jwt.claims', p_claims, true);
  select set_config('request.headers', p_headers, true);
$$;

-- -----------------------------------------------------------------------------
-- Grants matrix: nobody but postgres touches the entitlement
-- -----------------------------------------------------------------------------

select ok(
  not has_table_privilege(api_role, 'private.platform_admins', privilege),
  api_role || ' has no ' || privilege || ' on private.platform_admins'
)
from unnest(array['anon', 'authenticated', 'service_role']) as api_role
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES']) as privilege;

select ok(
  not has_function_privilege(api_role, fn, 'EXECUTE'),
  api_role || ' cannot execute ' || fn
)
from unnest(array['anon', 'authenticated', 'service_role']) as api_role
cross join unnest(array[
  'private.grant_platform_admin(uuid, text)',
  'private.revoke_platform_admin(uuid, text)',
  'private.require_platform_admin()',
  'private.current_user_is_platform_admin()',
  'private.platform_admins_guard_update()'
]) as fn;

select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.app_is_platform_admin()'::regprocedure,
                 'private.current_user_is_platform_admin()'::regprocedure,
                 'private.require_platform_admin()'::regprocedure)),
  'every check is SECURITY DEFINER with an empty search_path');

select ok(has_function_privilege('authenticated', 'public.app_is_platform_admin()', 'EXECUTE'),
  'authenticated can execute app_is_platform_admin');
select ok(not has_function_privilege('anon', 'public.app_is_platform_admin()', 'EXECUTE'),
  'anon cannot execute app_is_platform_admin');
select ok(not has_function_privilege('service_role', 'public.app_is_platform_admin()', 'EXECUTE'),
  'service_role cannot execute app_is_platform_admin');

-- -----------------------------------------------------------------------------
-- Authorization outcomes (caller = auth.uid())
-- -----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.act('3101');
select ok(public.app_is_platform_admin(), '1. explicitly provisioned Platform Admin passes');

select pg_temp.act('3102');
select ok(not public.app_is_platform_admin(), '2. Wolf Forge owner is not Platform Admin');

select pg_temp.act('3103', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000003101"}');
select ok(not public.app_is_platform_admin(), '3. Tenant B owner (B selector) is not Platform Admin');

select pg_temp.act('3104');
select ok(not public.app_is_platform_admin(), '4. client is not Platform Admin');

select pg_temp.act('3105');
select ok(not public.app_is_platform_admin(), '5. archived identity with a grant is denied');

select pg_temp.act(null);
select ok(not public.app_is_platform_admin(), '6a. authenticated role without a subject is denied');

select pg_temp.act('3106');
select ok(not public.app_is_platform_admin(), '10a. dual-Tenant owner without a grant (no selector) is denied');
select pg_temp.act('3106', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000003101"}');
select ok(not public.app_is_platform_admin(), '10b. dual-Tenant owner without a grant (B selector) is denied');

select pg_temp.act('3107');
select ok(public.app_is_platform_admin(), '10c. granted dual-Tenant identity passes regardless of its Tenant roles');
select pg_temp.act('3107', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000003101"}');
select ok(public.app_is_platform_admin(), '10d. granted dual-Tenant identity passes under the B selector');

-- 7. Forged claims, headers and selectors grant nothing.
select pg_temp.act('3102', '{"x-platform-admin":"true","x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}',
  '{"sub":"20000000-0000-4000-8000-000000003102","role":"service_role","app_metadata":{"platform_admin":true},"user_role":"platform_admin"}');
select ok(not public.app_is_platform_admin(), '7a. forged admin claims and headers do not grant the entitlement');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000003102","platform_admin":true}', true);
select ok(not public.app_is_platform_admin(), '7b. claims-only subject without a grant is denied');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000003101"}', true);
select ok(public.app_is_platform_admin(), '7c. the check follows the verified subject, not a role flag');

-- 8. Direct self-promotion is impossible for every API role.
select pg_temp.act('3102');
select throws_ok(
  $$ insert into private.platform_admins (profile_id, grant_reason) values ('20000000-0000-4000-8000-000000003102', 'self') $$,
  '42501', null, '8a. authenticated cannot insert a grant');
select throws_ok(
  $$ select private.grant_platform_admin('20000000-0000-4000-8000-000000003102', 'self') $$,
  '42501', null, '8b. authenticated cannot call the provisioning function');
select throws_ok(
  $$ update private.platform_admins set revoked_at = null $$,
  '42501', null, '8c. authenticated cannot update grants');
select throws_ok(
  $$ select private.require_platform_admin() $$,
  '42501', null, '8d. authenticated cannot call the private guard directly');
reset role;
select is((select memberships from tenant_data_before), (select count(*) from public.tenant_memberships),
  '15a. checks as authenticated modify no Tenant membership');

set local role anon;
select pg_temp.act(null);
select throws_ok($$ select public.app_is_platform_admin() $$, '42501', null, '6b. anon cannot call the check');
select throws_ok(
  $$ insert into private.platform_admins (profile_id, grant_reason) values ('20000000-0000-4000-8000-000000003102', 'anon') $$,
  '42501', null, '8e. anon cannot insert a grant');

reset role;
set local role service_role;
select throws_ok(
  $$ insert into private.platform_admins (profile_id, grant_reason) values ('20000000-0000-4000-8000-000000003102', 'service') $$,
  '42501', null, '8f. service_role cannot insert a grant');
select throws_ok(
  $$ select private.grant_platform_admin('20000000-0000-4000-8000-000000003102', 'service') $$,
  '42501', null, '8g. service_role cannot call the provisioning function');
reset role;

-- -----------------------------------------------------------------------------
-- Guard for future Platform Admin mutation RPCs (owner context, as a
-- SECURITY DEFINER caller would invoke it)
-- -----------------------------------------------------------------------------

select pg_temp.act('3101');
select lives_ok($$ select private.require_platform_admin() $$, 'guard passes for the Platform Admin');
select pg_temp.act('3102');
select throws_ok($$ select private.require_platform_admin() $$, '42501', 'Platform Admin authorization required',
  'guard refuses a Tenant owner');
select pg_temp.act('3105');
select throws_ok($$ select private.require_platform_admin() $$, '42501', null, 'guard refuses an archived identity');
select pg_temp.act(null);
select throws_ok($$ select private.require_platform_admin() $$, '42501', null, 'guard refuses no subject');

-- -----------------------------------------------------------------------------
-- Provisioning rules and explicit revocation
-- -----------------------------------------------------------------------------

select throws_ok(
  $$ select private.grant_platform_admin('20000000-0000-4000-8000-000000003101', 'duplicate') $$,
  '23505', null, 'a second active grant for the same profile is refused');
select throws_ok(
  $$ select private.grant_platform_admin('20000000-0000-4000-8000-000000003104', '  ') $$,
  '23514', null, 'a blank grant reason is refused');
select throws_ok(
  $$ select private.grant_platform_admin('20000000-0000-4000-8000-000000003105', 'archived') $$,
  '55000', null, 'an archived profile cannot be granted');
select throws_ok(
  $$ select private.grant_platform_admin('20000000-0000-4000-8000-0000000031ff', 'missing') $$,
  '55000', null, 'a missing profile cannot be granted');

select private.revoke_platform_admin('20000000-0000-4000-8000-000000003101', 'pgTAP 128 revocation');

set local role authenticated;
select pg_temp.act('3101');
select ok(not public.app_is_platform_admin(), '9a. explicit revocation takes effect immediately');
reset role;

select throws_ok(
  $$ update private.platform_admins set revoked_at = null, revoke_reason = null
     where profile_id = '20000000-0000-4000-8000-000000003101' $$,
  '55000', null, '9b. a revoked grant cannot be revived, even by postgres');
select throws_ok(
  $$ update private.platform_admins set profile_id = '20000000-0000-4000-8000-000000003102'
     where profile_id = '20000000-0000-4000-8000-000000003107' $$,
  '55000', null, '9c. a grant cannot be moved to another identity');
select throws_ok(
  $$ update private.platform_admins set granted_at = granted_at - interval '1 day'
     where profile_id = '20000000-0000-4000-8000-000000003107' $$,
  '55000', null, '9c. a grant time cannot be rewritten');
select throws_ok(
  $$ update private.platform_admins set grant_reason = 'rewritten'
     where profile_id = '20000000-0000-4000-8000-000000003107' $$,
  '55000', null, '9c. a grant reason cannot be rewritten');
select throws_ok(
  $$ select private.revoke_platform_admin('20000000-0000-4000-8000-000000003101', 'again') $$,
  'P0002', null, '9d. revoking without an active grant is refused');
select throws_ok(
  $$ update private.platform_admins set revoked_at = now(), revoke_reason = null
     where profile_id = '20000000-0000-4000-8000-000000003107' $$,
  '23514', null, '9e. a revocation must carry a reason');

select private.grant_platform_admin('20000000-0000-4000-8000-000000003101', 'pgTAP 128 re-grant');
select is(
  (select count(*)::int from private.platform_admins where profile_id = '20000000-0000-4000-8000-000000003101'),
  2, '9f. a re-grant is a new row; the revoked history stays');
select throws_ok(
  $$ delete from public.profiles where id = '20000000-0000-4000-8000-000000003101' $$,
  '23503', null, '9g. a profile with grant history cannot be deleted (history outlives revocation)');
update private.platform_admins set revoked_at = now() + interval '1 year', revoke_reason = 'pgTAP 128 backdating'
where profile_id = '20000000-0000-4000-8000-000000003107' and revoked_at is null;
select is(
  (select revoked_at from private.platform_admins where profile_id = '20000000-0000-4000-8000-000000003107'),
  now(), '9h. a revocation is stamped with the real time, not a supplied one');

-- 15. Checks are STABLE and leave Tenant data untouched.
select ok(
  (select bool_and(provolatile = 's') from pg_proc
   where oid in ('public.app_is_platform_admin()'::regprocedure,
                 'private.current_user_is_platform_admin()'::regprocedure,
                 'private.require_platform_admin()'::regprocedure)),
  '15b. every check is declared STABLE');
select is(
  (select row(tenants, profiles) from tenant_data_before),
  (select row(
     (select md5(string_agg(t::text, ',' order by t.id)) from public.tenants as t),
     (select md5(string_agg(p::text, ',' order by p.id)) from public.profiles as p))),
  '15c. tenants and profiles are unchanged by the checks');

select * from finish();
rollback;
