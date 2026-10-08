begin;

select plan(30);

-- WL-2.18 (KI-115): internal-app access reads the caller's membership in the
-- current Tenant through app_current_tenant_membership(), never the global
-- profiles.role_id. WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B =
-- ...000000001501, Tenant C = ...000000001502 (no fixture membership),
-- Tenant S = ...000000001503 (suspended).

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1501 WF client + B staff (profile role client)       CASE 1 / 4
-- 1502 WF admin + B client (profile role admin)        CASE 2 / 3
-- 1503 WF owner + B admin + S owner (profile owner)    CASE 5 / 10
-- 1504 WF owner + archived B staff (profile owner)     CASE 6
-- 1505 no membership anywhere                          CASE 7
-- 1506 WF owner, no B membership                       CASE 8
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'membership-access-' || n || '@example.invalid', now(), now()
from unnest(array['1501', '1502', '1503', '1504', '1505', '1506']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001501', 'membership-access-tenant-b', 'Membership Access Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001502', 'membership-access-tenant-c', 'Membership Access Tenant C', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001503', 'membership-access-tenant-s', 'Membership Access Tenant S', 'suspended');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(), 'MEMBERSHIP_ACCESS_WF_CLIENT', 'client'),
  ('c0000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501', 'MEMBERSHIP_ACCESS_B_CLIENT', 'client');

-- Wolf Forge memberships through the compatibility fields (explicit WF path).
update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000001501', 'client', 'c0000000-0000-4000-8000-000000001501'),
  ('20000000-0000-4000-8000-000000001502', 'admin', null),
  ('20000000-0000-4000-8000-000000001503', 'owner', null),
  ('20000000-0000-4000-8000-000000001504', 'owner', null),
  ('20000000-0000-4000-8000-000000001506', 'owner', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-000000001501', '20000000-0000-4000-8000-000000001501', 'staff', 'internal', null, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000001501', '20000000-0000-4000-8000-000000001502', 'client', 'client', 'c0000000-0000-4000-8000-000000001502', null),
  ('f0f0f0f0-0000-4000-8000-000000001501', '20000000-0000-4000-8000-000000001503', 'admin', 'internal', null, null),
  ('f0f0f0f0-0000-4000-8000-000000001503', '20000000-0000-4000-8000-000000001503', 'owner', 'internal', null, null),
  ('f0f0f0f0-0000-4000-8000-000000001501', '20000000-0000-4000-8000-000000001504', 'staff', 'internal', null, now())
) as fixture(tenant_id, profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_selector
    when 'none' then ''
    when 'wf' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}'
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}'
    when 'c' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001502"}'
    when 's' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001503"}'
    when 'unknown' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000015ff"}'
    when 'malformed' then '{"x-wf-tenant":"not-a-tenant"}'
    when 'empty' then '{"x-wf-tenant":""}'
    when 'number' then '{"x-wf-tenant":1501}'
    end, true);
$$;

-- m(): the caller's current-Tenant membership as 'class/role', '' for no row.
create function pg_temp.m()
returns text
language sql
as $$
  select coalesce(string_agg(account_class || '/' || role_name, ','), '')
  from public.app_current_tenant_membership();
$$;

grant execute on function pg_temp.act(text, text), pg_temp.m() to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- CASE 1 / 4: global client, Tenant B internal.
select pg_temp.act('1501', 'b');
select is(pg_temp.m(), 'internal/staff', 'CASE 1: B selector -> B internal staff although profiles.role_id = client');
select ok(private.is_internal_user(), 'CASE 1: DB internal predicate agrees under the B selector');
select pg_temp.act('1501', 'none');
select is(pg_temp.m(), 'client/client', 'CASE 4: no selector -> Wolf Forge client membership');
select pg_temp.act('1501', 'wf');
select is(pg_temp.m(), 'client/client', 'CASE 4: explicit WF selector -> Wolf Forge client membership');

-- CASE 2 / 3: global admin, Tenant B client.
select pg_temp.act('1502', 'b');
select is(pg_temp.m(), 'client/client', 'CASE 2/3: B selector -> client only although profiles.role_id = admin');
select ok(not private.is_internal_user(), 'CASE 2/3: DB internal predicate refuses under the B selector');
select pg_temp.act('1502', 'none');
select is(pg_temp.m(), 'internal/admin', 'CASE 3: Wolf Forge stays internal admin');

-- CASE 5: dual owner -> each Tenant's own role.
select pg_temp.act('1503', 'none');
select is(pg_temp.m(), 'internal/owner', 'CASE 5: WF selector -> WF owner');
select pg_temp.act('1503', 'b');
select is(pg_temp.m(), 'internal/admin', 'CASE 5: B selector -> B admin, not inherited owner');

-- CASE 6: archived B membership, global owner.
select pg_temp.act('1504', 'b');
select is(pg_temp.m(), '', 'CASE 6: archived B membership -> no row despite profiles.role_id = owner');
select pg_temp.act('1504', 'none');
select is(pg_temp.m(), 'internal/owner', 'CASE 6: the same identity keeps its active WF membership');

-- CASE 7: membership-less identity -> unassigned (no row in any Tenant).
select pg_temp.act('1505', 'none');
select is(pg_temp.m(), '', 'CASE 7: no membership, no selector -> no row (no WF fallback)');
select pg_temp.act('1505', 'b');
select is(pg_temp.m(), '', 'CASE 7: no membership, B selector -> no row');

-- CASE 8: foreign selector without membership.
select pg_temp.act('1506', 'b');
select is(pg_temp.m(), '', 'CASE 8: WF owner with B selector and no B membership -> no row');
select pg_temp.act('1506', 'c');
select is(pg_temp.m(), '', 'CASE 8: Tenant C selector without membership -> no row');
select pg_temp.act('1501', 'c');
select is(pg_temp.m(), '', 'CASE 8: B member with Tenant C selector -> no row, not B or WF');

-- CASE 9: malformed / unknown selector fails closed, never the WF fallback.
select pg_temp.act('1503', 'unknown');
select is(pg_temp.m(), '', 'CASE 9: unknown Tenant selector -> no row');
select pg_temp.act('1503', 'malformed');
select is(pg_temp.m(), '', 'CASE 9: malformed selector -> no row');
select pg_temp.act('1503', 'empty');
select is(pg_temp.m(), '', 'CASE 9: empty selector -> no row');
select pg_temp.act('1503', 'number');
select is(pg_temp.m(), '', 'CASE 9: non-string selector -> no row');

-- CASE 10: suspended Tenant.
select pg_temp.act('1503', 's');
select is(pg_temp.m(), '', 'CASE 10: owner of suspended Tenant S -> no row');
select ok(not private.is_internal_user(), 'CASE 10: DB internal predicate refuses the suspended Tenant');

-- Global profile row is untouched by selector switching.
reset role;
select is(
  (select role.name from public.profiles as profile join public.roles as role on role.id = profile.role_id
   where profile.id = '20000000-0000-4000-8000-000000001501'),
  'client',
  'global profile 1501 keeps compatibility role client'
);
select is(
  (select role.name from public.profiles as profile join public.roles as role on role.id = profile.role_id
   where profile.id = '20000000-0000-4000-8000-000000001502'),
  'admin',
  'global profile 1502 keeps compatibility role admin'
);
set local role authenticated;

-- Self-read used by the gate (display only) still works for Tenant B staff.
select pg_temp.act('1501', 'b');
select is(
  (select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000001501'),
  1::bigint,
  'B staff can read its own profile under the B selector'
);

-- The function is caller-only: no argument, no other identity's row.
select is(
  (select pronargs from pg_proc where oid = 'public.app_current_tenant_membership'::regproc),
  0::smallint,
  'app_current_tenant_membership takes no argument'
);

-- Grants: authenticated only.
reset role;
select ok(has_function_privilege('authenticated', 'public.app_current_tenant_membership()', 'execute'),
  'authenticated may execute');
select ok(not has_function_privilege('anon', 'public.app_current_tenant_membership()', 'execute'),
  'anon may not execute');
select ok(not has_function_privilege('service_role', 'public.app_current_tenant_membership()', 'execute'),
  'service_role may not execute');
select ok(
  (select prosecdef from pg_proc where oid = 'public.app_current_tenant_membership'::regproc),
  'security definer'
);

select * from finish();

rollback;
