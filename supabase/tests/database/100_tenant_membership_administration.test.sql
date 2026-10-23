begin;

select plan(46);

-- WL-2.3 (KI-112): membership administration changes only the current Tenant's
-- membership. Profiles P (internal), C and D (client) belong to Wolf Forge (WF)
-- and Tenant B; a role or Client change in one Tenant never reaches the other.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001001.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1001 WF admin; 1002 B admin (WF archived); 1003 P: staff in both; 1004 WF
-- owner; 1005 B owner (WF archived); 1006 owner of both; 1007 B admin with an
-- archived B membership (WF archived); 1008 C: client in both; 1009 X: WF staff
-- only; 1010 D: unclaimed client in both.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'membership-' || n || '@example.invalid', now(), now()
from unnest(array['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008', '1009', '1010']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001001', 'membership-tenant-b', 'Membership Tenant B', 'active');

insert into public.companies (id, tenant_id, name)
values
  ('c0000000-0000-4000-8000-000000001001', private.wolf_forge_tenant_id(), 'Membership WF Client'),
  ('c0000000-0000-4000-8000-000000001002', 'f0f0f0f0-0000-4000-8000-000000001001', 'Membership B Client');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    display_name = 'Original ' || right(fixture.profile_id, 4)
from (values
  ('20000000-0000-0000-0000-000000001001', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000001002', 'admin', now()),
  ('20000000-0000-0000-0000-000000001003', 'staff', null),
  ('20000000-0000-0000-0000-000000001004', 'owner', null),
  ('20000000-0000-0000-0000-000000001005', 'owner', now()),
  ('20000000-0000-0000-0000-000000001006', 'owner', null),
  ('20000000-0000-0000-0000-000000001007', 'admin', now()),
  ('20000000-0000-0000-0000-000000001008', 'client', null),
  ('20000000-0000-0000-0000-000000001009', 'staff', null),
  ('20000000-0000-0000-0000-000000001010', 'client', null)
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001001', fixture.profile_id::uuid, fixture.account_class, role.id, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001002', 'admin', 'internal', null::timestamptz),
  ('20000000-0000-0000-0000-000000001003', 'staff', 'internal', null),
  ('20000000-0000-0000-0000-000000001005', 'owner', 'internal', null),
  ('20000000-0000-0000-0000-000000001006', 'owner', 'internal', null),
  ('20000000-0000-0000-0000-000000001007', 'admin', 'internal', now()),
  ('20000000-0000-0000-0000-000000001008', 'client', 'client', null),
  ('20000000-0000-0000-0000-000000001010', 'client', 'client', null)
) as fixture(profile_id, role_name, account_class, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- D-275: C and D keep the default client role with no Client, so nothing
-- provisions them into Wolf Forge implicitly; do it explicitly.
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select private.wolf_forge_tenant_id(), fixture.profile_id::uuid, 'client', role.id
from (values ('20000000-0000-0000-0000-000000001008'), ('20000000-0000-0000-0000-000000001010')) as fixture(profile_id)
join public.roles as role on role.name = 'client';

-- Readback probes for the test only; callers cannot read these tables.
create function pg_temp.m(p_tenant text, p_profile text)
returns text
language sql
security definer
as $$
  select role.name || ':' || membership.account_class || ':' || coalesce(right(membership.company_id::text, 4), '-')
  from public.tenant_memberships as membership
  join public.roles as role on role.id = membership.role_id
  where membership.tenant_id = case p_tenant when 'wf' then 'f0f0f0f0-0000-4000-8000-000000000001'::uuid
      else 'f0f0f0f0-0000-4000-8000-000000001001'::uuid end
    and membership.profile_id = ('20000000-0000-0000-0000-00000000' || p_profile)::uuid;
$$;

create function pg_temp.p(p_profile text)
returns text
language sql
security definer
as $$
  select role.name || ':' || coalesce(right(profile.company_id::text, 4), '-') || ':' || profile.display_name
  from public.profiles as profile
  join public.roles as role on role.id = profile.role_id
  where profile.id = ('20000000-0000-0000-0000-00000000' || p_profile)::uuid;
$$;

create function pg_temp.act(p_actor text, p_tenant text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers',
    case p_tenant when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001001"}' else '' end, true);
$$;

grant execute on function pg_temp.m(text, text), pg_temp.p(text), pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Role writes
-- -----------------------------------------------------------------------------

-- Tenant A (Wolf Forge) admin changes P's Wolf Forge role.
select pg_temp.act('1001', 'wf');
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001003', 'manager') $$,
  'WF admin changes P''s WF role');
select is(pg_temp.m('wf', '1003'), 'manager:internal:-', 'WF admin -> WF: P''s WF membership is manager');
select is(pg_temp.m('b', '1003'), 'staff:internal:-', 'WF admin -> WF: P''s B membership unchanged');
select is(pg_temp.p('1003'), 'manager:-:Original 1003', 'WF admin -> WF: compatibility profile mirrors the WF role');

-- Tenant B admin changes P's Tenant B role.
select pg_temp.act('1002', 'b');
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001003', 'admin') $$,
  'B admin changes P''s B role');
select is(pg_temp.m('b', '1003'), 'admin:internal:-', 'B admin -> B: P''s B membership is admin');
select is(pg_temp.m('wf', '1003'), 'manager:internal:-', 'B admin -> B: P''s WF membership unchanged');
select is(pg_temp.p('1003'), 'manager:-:Original 1003', 'B admin -> B: global profile not written');

-- The original exploit: a B admin demoting a dual WF owner.
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001006', 'admin') $$,
  'B admin demotes the dual owner in B');
select is(pg_temp.m('b', '1006'), 'admin:internal:-', 'dual owner is admin in B');
select is(pg_temp.m('wf', '1006'), 'owner:internal:-', 'dual owner stays owner in WF');

-- Target with no membership in the current Tenant.
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001009', 'manager') $$,
  '42501', 'target profile was not found', 'B admin cannot change a WF-only member');
select pg_temp.act('1001', 'wf');
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001002', 'staff') $$,
  '42501', 'target profile was not found', 'WF admin cannot change a member archived in WF but active in B');
select is(pg_temp.m('b', '1002'), 'admin:internal:-', 'B admin''s B membership untouched by the WF attempt');

-- Owners are bound to their own Tenant.
select pg_temp.act('1004', 'b');
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001003', 'staff') $$,
  '42501', 'verified internal authentication is required', 'WF owner with the B selector cannot change B roles');
select pg_temp.act('1005', 'wf');
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001003', 'staff') $$,
  '42501', 'verified internal authentication is required', 'B owner (archived in WF) cannot change WF roles');
select is(pg_temp.m('wf', '1003') || ' ' || pg_temp.m('b', '1003'), 'manager:internal:- admin:internal:-',
  'owner attacks changed nothing');

-- A dual owner is bound to the selector.
select pg_temp.act('1006', 'wf');
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001003', 'staff') $$,
  'dual owner changes P in WF');
select is(pg_temp.m('wf', '1003') || ' ' || pg_temp.m('b', '1003'), 'staff:internal:- admin:internal:-',
  'dual owner with the WF selector changed only WF');

-- Archived membership cannot manage members.
select pg_temp.act('1007', 'b');
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001003', 'staff') $$,
  '42501', 'verified internal authentication is required', 'archived B admin cannot change B roles');

-- A second B manager exists (P is now B admin), so the B owner may demote the B admin.
select pg_temp.act('1005', 'b');
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-0000-0000-000000001002', 'staff') $$,
  'B owner demotes a B admin while other B managers remain');
select is(pg_temp.m('b', '1002'), 'staff:internal:-', 'B admin demoted in B only');

-- -----------------------------------------------------------------------------
-- Client link writes
-- -----------------------------------------------------------------------------

select pg_temp.act('1001', 'wf');
select lives_ok($$ select public.app_assign_client_profile_to_company('20000000-0000-0000-0000-000000001008',
    'c0000000-0000-4000-8000-000000001001') $$,
  'WF admin links C to the WF Client');
select is(pg_temp.m('wf', '1008') || ' ' || pg_temp.m('b', '1008'), 'client:client:1001 client:client:-',
  'WF link changed only C''s WF membership');
select is(pg_temp.p('1008'), 'client:1001:Original 1008', 'WF link mirrored on the compatibility profile');
select throws_ok($$ select public.app_assign_client_profile_to_company('20000000-0000-0000-0000-000000001008',
    'c0000000-0000-4000-8000-000000001002') $$,
  'P0002', 'no_data_found', 'WF admin cannot assign a Tenant B Client');

select pg_temp.act('1002', 'b');
select throws_ok($$ select public.app_assign_client_profile_to_company('20000000-0000-0000-0000-000000001008',
    'c0000000-0000-4000-8000-000000001002') $$,
  '42501', 'authorized client administration is required', 'demoted B admin can no longer link Clients');

select pg_temp.act('1003', 'b');
select lives_ok($$ select public.app_assign_client_profile_to_company('20000000-0000-0000-0000-000000001008',
    'c0000000-0000-4000-8000-000000001002', 'Renamed From B') $$,
  'B admin (P) links C to the B Client');
select is(pg_temp.m('b', '1008') || ' ' || pg_temp.m('wf', '1008'), 'client:client:1002 client:client:1001',
  'B link changed only C''s B membership');
select is(pg_temp.p('1008'), 'client:1001:Original 1008', 'B link wrote neither the global Client nor the display name');
select throws_ok($$ select public.app_assign_client_profile_to_company('20000000-0000-0000-0000-000000001008',
    'c0000000-0000-4000-8000-000000001001') $$,
  'P0002', 'no_data_found', 'B admin cannot assign a Wolf Forge Client');
select throws_ok($$ select public.app_provision_client_account_profile('20000000-0000-0000-0000-000000001010',
    'c0000000-0000-4000-8000-000000001001') $$,
  'P0002', 'no_data_found', 'B client provisioning cannot use a Wolf Forge Client');
select is(pg_temp.m('wf', '1008') || ' ' || pg_temp.m('wf', '1010'), 'client:client:1001 client:client:-',
  'refused B links left WF memberships unchanged');

-- -----------------------------------------------------------------------------
-- Internal member provisioning
-- -----------------------------------------------------------------------------

select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-0000-0000-000000001008', 'staff') $$,
  '42501', 'an existing client portal account cannot become a Wolf Forge member',
  'a client linked in B cannot become a B member');
select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-0000-0000-000000001009', 'staff') $$,
  '42501', 'target profile was not found', 'B admin cannot provision a WF-only member');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-0000-0000-000000001010', 'staff',
    'Renamed From B') $$,
  'B admin provisions D as B staff');
select is(pg_temp.m('b', '1010') || ' ' || pg_temp.m('wf', '1010'), 'staff:internal:- client:client:-',
  'B provisioning changed only D''s B membership');
select is(pg_temp.p('1010'), 'client:-:Original 1010', 'B provisioning wrote neither the global role nor the display name');

select pg_temp.act('1001', 'wf');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-0000-0000-000000001010', 'manager',
    'Named In WF') $$,
  'WF admin provisions D as WF manager');
select is(pg_temp.m('wf', '1010') || ' ' || pg_temp.m('b', '1010'), 'manager:internal:- staff:internal:-',
  'WF provisioning changed only D''s WF membership');
select is(pg_temp.p('1010'), 'manager:-:Named In WF', 'WF provisioning keeps the compatibility profile and display name');

reset role;

-- -----------------------------------------------------------------------------
-- Wolf Forge compatibility mirror stays coherent
-- -----------------------------------------------------------------------------

select is(
  (select count(*)
    from public.profiles as profile
    join public.tenant_memberships as membership
      on membership.profile_id = profile.id
     and membership.tenant_id = private.wolf_forge_tenant_id()
    where profile.id::text like '20000000-0000-0000-0000-0000000010%'
      and (membership.role_id, membership.company_id, membership.archived_at)
        is distinct from (profile.role_id, profile.company_id, profile.archived_at)),
  0::bigint,
  'every fixture WF membership still matches its compatibility profile'
);

-- -----------------------------------------------------------------------------
-- Last permission manager guard is per Tenant
-- -----------------------------------------------------------------------------

-- Tenant B loses every manager; Wolf Forge keeps its own.
update public.tenant_memberships as membership
set role_id = (select id from public.roles where name = 'staff')
where membership.tenant_id = 'f0f0f0f0-0000-4000-8000-000000001001'
  and membership.account_class = 'internal';

select pg_temp.act('1003', 'b');
select throws_ok($$ select private.assert_permission_management_retained() $$,
  '42501', 'at least one active internal account must retain permission management',
  'B with no manager of its own is blocked; WF managers do not count');
select pg_temp.act('1003', 'wf');
select lives_ok($$ select private.assert_permission_management_retained() $$, 'WF still has its own managers');

-- Restore one B manager, then Wolf Forge loses every manager.
update public.tenant_memberships as membership
set role_id = (select id from public.roles where name = 'admin')
where membership.tenant_id = 'f0f0f0f0-0000-4000-8000-000000001001'
  and membership.profile_id = '20000000-0000-0000-0000-000000001005';

update public.tenant_memberships as membership
set role_id = (select id from public.roles where name = 'staff')
where membership.tenant_id = private.wolf_forge_tenant_id()
  and membership.account_class = 'internal';

select throws_ok($$ select private.assert_permission_management_retained() $$,
  '42501', 'at least one active internal account must retain permission management',
  'WF with no manager of its own is blocked; B managers do not count');
select pg_temp.act('1003', 'b');
select lives_ok($$ select private.assert_permission_management_retained() $$, 'B has its own manager again');

select * from finish();

rollback;
