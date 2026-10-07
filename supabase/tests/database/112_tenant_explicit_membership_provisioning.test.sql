begin;

select plan(63);

-- WL-2.15 (D-275, KI-114, KI-118 item 1): a new global identity is not a
-- member of any Tenant; membership comes only from explicit provisioning in
-- the caller's Tenant. The Forms onboarding picker reads current-Tenant client
-- memberships.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001201,
-- Tenant C = ...000000001202 (the actors below hold no membership there).

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- Actors: 1201 WF admin; 1202 B admin (B only); 1203 owner of WF and B; 1204 B
-- admin with an archived B membership; 1205 WF owner (no B membership).
-- Picker: 1221 WF client only; 1222 B client only; 1223 client in both; 1224
-- WF client with an archived B membership; 1225 WF staff; 1226 WF client with
-- no Client.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'provisioning-' || n || '@example.invalid', now(), now()
from unnest(array['1201', '1202', '1203', '1204', '1205', '1221', '1222', '1223', '1224', '1225', '1226']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001201', 'provisioning-tenant-b', 'Provisioning Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001202', 'provisioning-tenant-c', 'Provisioning Tenant C', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000001201', private.wolf_forge_tenant_id(), 'PROVISIONING_WF_CLIENT', 'client'),
  ('c0000000-0000-4000-8000-000000001202', 'f0f0f0f0-0000-4000-8000-000000001201', 'PROVISIONING_B_CLIENT', 'client'),
  ('c0000000-0000-4000-8000-000000001203', 'f0f0f0f0-0000-4000-8000-000000001201', 'PROVISIONING_B_CLIENT_2', 'client');

-- Wolf Forge memberships through the compatibility fields (explicit WF path).
update public.profiles as profile
set role_id = role.id,
    company_id = fixture.company_id::uuid,
    display_name = 'Picker ' || right(fixture.profile_id, 4)
from (values
  ('20000000-0000-4000-8000-000000001201', 'admin', null),
  ('20000000-0000-4000-8000-000000001203', 'owner', null),
  ('20000000-0000-4000-8000-000000001205', 'owner', null),
  ('20000000-0000-4000-8000-000000001221', 'client', 'c0000000-0000-4000-8000-000000001201'),
  ('20000000-0000-4000-8000-000000001223', 'client', 'c0000000-0000-4000-8000-000000001201'),
  ('20000000-0000-4000-8000-000000001224', 'client', 'c0000000-0000-4000-8000-000000001201'),
  ('20000000-0000-4000-8000-000000001225', 'staff', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

update public.profiles set display_name = 'Picker ' || right(id::text, 4)
where id in ('20000000-0000-4000-8000-000000001222', '20000000-0000-4000-8000-000000001226');

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select private.wolf_forge_tenant_id(), '20000000-0000-4000-8000-000000001226', 'client', role.id
from public.roles as role where role.name = 'client';

-- Tenant B memberships (explicit, standing in for B's own provisioning).
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001201', fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-4000-8000-000000001202', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-4000-8000-000000001203', 'owner', 'internal', null, null),
  ('20000000-0000-4000-8000-000000001204', 'admin', 'internal', null, now()),
  ('20000000-0000-4000-8000-000000001222', 'client', 'client', 'c0000000-0000-4000-8000-000000001202', null),
  ('20000000-0000-4000-8000-000000001223', 'client', 'client', 'c0000000-0000-4000-8000-000000001202', null),
  ('20000000-0000-4000-8000-000000001224', 'client', 'client', 'c0000000-0000-4000-8000-000000001202', now())
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- Readback probes for the test only; callers cannot read these tables.
-- m(): 'role:class:client' of the membership in a Tenant, NULL when absent.
create function pg_temp.m(p_tenant text, p_profile text)
returns text
language sql
security definer
as $$
  select role.name || ':' || membership.account_class || ':' || coalesce(right(membership.company_id::text, 4), '-')
    || case when membership.archived_at is null then '' else ':archived' end
  from public.tenant_memberships as membership
  join public.roles as role on role.id = membership.role_id
  where membership.tenant_id = case p_tenant when 'wf' then 'f0f0f0f0-0000-4000-8000-000000000001'::uuid
      else 'f0f0f0f0-0000-4000-8000-000000001201'::uuid end
    and membership.profile_id = ('20000000-0000-4000-8000-00000000' || p_profile)::uuid;
$$;

create function pg_temp.n(p_profile text)
returns bigint
language sql
security definer
as $$
  select count(*) from public.tenant_memberships
  where profile_id = ('20000000-0000-4000-8000-00000000' || p_profile)::uuid;
$$;

-- p(): the global profile 'role:company:display_name'.
create function pg_temp.p(p_profile text)
returns text
language sql
security definer
as $$
  select role.name || ':' || coalesce(right(profile.company_id::text, 4), '-') || ':' || coalesce(profile.display_name, '-')
  from public.profiles as profile
  join public.roles as role on role.id = profile.role_id
  where profile.id = ('20000000-0000-4000-8000-00000000' || p_profile)::uuid;
$$;

create function pg_temp.act(p_actor text, p_tenant text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_tenant
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}'
    when 'c' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001202"}'
    else '' end, true);
$$;

create function pg_temp.picker(p_company text default null)
returns text
language sql
as $$
  select coalesce(string_agg(right(candidate.profile_id::text, 4) || '@' || right(candidate.company_id::text, 4), ',' order by candidate.profile_id), '')
  from public.app_list_onboarding_assignment_candidates(p_company::uuid) as candidate
  where candidate.profile_id::text like '20000000-0000-4000-8000-0000000012%';
$$;

grant execute on function pg_temp.m(text, text), pg_temp.n(text), pg_temp.p(text),
  pg_temp.act(text, text), pg_temp.picker(text) to authenticated;

-- -----------------------------------------------------------------------------
-- A new identity has no Tenant membership
-- -----------------------------------------------------------------------------

-- 1211 P, 1212 Q, 1213 R, 1214 S, 1215 T, 1216 U, 1217 V, 1218 W, 1219 X, 1220 Y.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'provisioning-' || n || '@example.invalid', now(), now()
from unnest(array['1211', '1212', '1213', '1214', '1215', '1216', '1217', '1218', '1219', '1220']) as n;

select is(pg_temp.p('1211'), 'client:-:-', 'P exists in profiles as a default global identity');
select is(pg_temp.m('wf', '1211'), null, 'P has no Wolf Forge membership');
select is(pg_temp.m('b', '1211'), null, 'P has no Tenant B membership');
select is(
  (select count(*) from public.tenant_memberships
    where profile_id::text like '20000000-0000-4000-8000-00000000121%'
      or profile_id = '20000000-0000-4000-8000-000000001220'),
  0::bigint,
  'no new identity received any Tenant membership'
);

-- An archive-only write on an unclaimed identity is not provisioning.
update public.profiles set archived_at = now() where id = '20000000-0000-4000-8000-000000001220';
select is(pg_temp.n('1220'), 0::bigint, 'archiving an unclaimed identity creates no membership');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('1211', 'wf');
select is(private.current_tenant_id(), null::uuid, 'a profile-only identity resolves no Tenant');

-- -----------------------------------------------------------------------------
-- Explicit Tenant B provisioning
-- -----------------------------------------------------------------------------

select pg_temp.act('1202', 'b');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001211', 'c0000000-0000-4000-8000-000000001202', 'Renamed By B') $$,
  'B admin provisions P as a B client');
select is(pg_temp.m('b', '1211'), 'client:client:1202', 'P has a Tenant B client membership');
select is(pg_temp.m('wf', '1211'), null, 'P still has no Wolf Forge membership');
select is(pg_temp.p('1211'), 'client:-:-', 'B provisioning wrote neither the compatibility fields nor the display name');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001211', 'c0000000-0000-4000-8000-000000001202') $$,
  'repeating B provisioning is idempotent');
select is(pg_temp.n('1211'), 1::bigint, 'P holds exactly one membership');

select lives_ok($$ select public.app_provision_internal_member_profile(
    '20000000-0000-4000-8000-000000001215', 'staff', 'Renamed By B') $$,
  'B admin provisions T as B staff');
select is(pg_temp.m('b', '1215'), 'staff:internal:-', 'T has a Tenant B staff membership');
select is(pg_temp.m('wf', '1215'), null, 'T has no Wolf Forge membership');
select is(pg_temp.p('1215'), 'client:-:-', 'B internal provisioning left the compatibility fields alone');

-- -----------------------------------------------------------------------------
-- Explicit Wolf Forge provisioning (compatibility path)
-- -----------------------------------------------------------------------------

select pg_temp.act('1201', 'wf');
select lives_ok($$ select public.app_provision_internal_member_profile(
    '20000000-0000-4000-8000-000000001213', 'manager', 'R Manager') $$,
  'WF admin provisions R as a WF manager');
select is(pg_temp.m('wf', '1213'), 'manager:internal:-', 'R has a WF manager membership');
select is(pg_temp.p('1213'), 'manager:-:R Manager', 'WF provisioning mirrors the compatibility profile');
select is(pg_temp.m('b', '1213'), null, 'R has no Tenant B membership');

select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001214', 'c0000000-0000-4000-8000-000000001201', 'S Client') $$,
  'WF admin provisions S as a WF client');
select is(pg_temp.m('wf', '1214'), 'client:client:1201', 'S has a WF client membership');
select is(pg_temp.p('1214'), 'client:1201:S Client', 'WF client provisioning mirrors the compatibility profile');
select is(pg_temp.m('b', '1214'), null, 'S has no Tenant B membership');

-- -----------------------------------------------------------------------------
-- Cross-Tenant claims (KI-114)
-- -----------------------------------------------------------------------------

select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001211', 'staff', 'Hijacked') $$,
  '42501', 'target profile was not found', 'WF admin cannot provision a B-only identity as WF staff');
select throws_ok($$ select public.app_assign_client_profile_to_company(
    '20000000-0000-4000-8000-000000001211', 'c0000000-0000-4000-8000-000000001201', 'Hijacked') $$,
  'P0002', null, 'WF admin cannot link a B-only identity to a WF Client');
select throws_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001211', 'c0000000-0000-4000-8000-000000001201', 'Hijacked') $$,
  'P0002', null, 'WF admin cannot provision a B-only identity as a WF client');
select is(pg_temp.m('wf', '1211'), null, 'refused WF claims created no WF membership for P');
select is(pg_temp.p('1211'), 'client:-:-', 'refused WF claims left P''s global identity unchanged');
select is(pg_temp.m('b', '1211'), 'client:client:1202', 'refused WF claims left P''s B membership unchanged');

select pg_temp.act('1202', 'b');
select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001213', 'staff') $$,
  '42501', 'target profile was not found', 'B admin cannot provision a WF-only identity');
select throws_ok($$ select public.app_assign_client_profile_to_company(
    '20000000-0000-4000-8000-000000001214', 'c0000000-0000-4000-8000-000000001202') $$,
  'P0002', null, 'B admin cannot link a WF-only identity to a B Client');
select is(pg_temp.m('b', '1213') || pg_temp.m('b', '1214'), null, 'refused B claims created no B membership');
select is(pg_temp.p('1213') || '|' || pg_temp.p('1214'), 'manager:-:R Manager|client:1201:S Client',
  'refused B claims left the WF identities unchanged');

-- No Tenant comes from the payload: a B admin linking to a WF Client is refused.
select throws_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001216', 'c0000000-0000-4000-8000-000000001201') $$,
  'P0002', null, 'B admin cannot provision into a WF Client');
select is(pg_temp.n('1216'), 0::bigint, 'the refused foreign-Client provisioning created no membership');
select throws_ok($$ insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
    values ('f0f0f0f0-0000-4000-8000-000000001201', '20000000-0000-4000-8000-000000001216', 'client',
      (select id from public.roles where name = 'client')) $$,
  '42501', null, 'a direct membership insert is refused');

-- An archived identity cannot be claimed.
select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001220', 'staff') $$,
  '42501', 'target profile was not found', 'an archived identity cannot be provisioned');
select is(pg_temp.n('1220'), 0::bigint, 'the archived identity holds no membership');

reset role;

-- The compatibility fields cannot pull a B-only identity into Wolf Forge, even
-- for a trusted role.
select throws_ok($$ update public.profiles set role_id = (select id from public.roles where name = 'staff')
    where id = '20000000-0000-4000-8000-000000001211' $$,
  '42501', 'this profile belongs to another Tenant; Wolf Forge compatibility fields cannot claim it',
  'a compatibility-field write cannot claim a B-only identity');
select is(pg_temp.m('wf', '1211'), null, 'the refused compatibility write created no WF membership');

-- -----------------------------------------------------------------------------
-- Archived admin, owner without B membership, dual owner
-- -----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.act('1204', 'b');
select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001217', 'staff') $$,
  '42501', 'verified internal authentication is required', 'an archived B admin cannot provision');
select throws_ok($$ select public.app_assign_client_profile_to_company(
    '20000000-0000-4000-8000-000000001217', 'c0000000-0000-4000-8000-000000001202') $$,
  '42501', null, 'an archived B admin cannot link a client');

select pg_temp.act('1205', 'b');
select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001217', 'staff') $$,
  '42501', 'verified internal authentication is required', 'a WF owner with the B selector cannot provision into B');

select pg_temp.act('1203', 'c');
select throws_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001217', 'staff') $$,
  '42501', 'verified internal authentication is required', 'a selector for a Tenant without membership cannot provision');
select is(pg_temp.n('1217'), 0::bigint, 'refused provisioning attempts created no membership');

select pg_temp.act('1203', 'b');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001218', 'staff') $$,
  'dual owner with the B selector provisions W');
select is(coalesce(pg_temp.m('b', '1218'), '') || '|' || coalesce(pg_temp.m('wf', '1218'), ''), 'staff:internal:-|',
  'dual owner selector B creates only a B membership');

select pg_temp.act('1203', 'wf');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001219', 'staff') $$,
  'dual owner with the WF selector provisions X');
select is(coalesce(pg_temp.m('b', '1219'), '') || '|' || coalesce(pg_temp.m('wf', '1219'), ''), '|staff:internal:-',
  'dual owner selector WF creates only a WF membership');

-- -----------------------------------------------------------------------------
-- Dual-Tenant identity: memberships stay independent
-- -----------------------------------------------------------------------------

select pg_temp.act('1201', 'wf');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001212', 'c0000000-0000-4000-8000-000000001201') $$,
  'WF admin provisions Q as a WF client');

reset role;
-- Adding an identity that already belongs to another Tenant is a future
-- explicit invite flow; a trusted insert stands in for it here.
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select 'f0f0f0f0-0000-4000-8000-000000001201', '20000000-0000-4000-8000-000000001212', 'client', role.id,
  'c0000000-0000-4000-8000-000000001202'
from public.roles as role where role.name = 'client';
select is(pg_temp.m('wf', '1212'), 'client:client:1201', 'adding Q to B left Q''s WF membership unchanged');
set local role authenticated;

select pg_temp.act('1202', 'b');
select lives_ok($$ select public.app_assign_client_profile_to_company(
    '20000000-0000-4000-8000-000000001212', 'c0000000-0000-4000-8000-000000001203') $$,
  'B admin moves Q to another B Client');
select is(pg_temp.m('b', '1212') || '|' || pg_temp.m('wf', '1212'), 'client:client:1203|client:client:1201',
  'B administration of Q left the WF membership unchanged');

select pg_temp.act('1201', 'wf');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001212', 'c0000000-0000-4000-8000-000000001201', 'Q Renamed') $$,
  'WF admin re-provisions Q in WF');
select is(pg_temp.m('b', '1212'), 'client:client:1203', 'WF provisioning of Q left the B membership unchanged');

-- -----------------------------------------------------------------------------
-- Forms onboarding picker (KI-118 item 1)
-- -----------------------------------------------------------------------------

select pg_temp.act('1203', 'wf');
select is(pg_temp.picker(), '1212@1201,1214@1201,1221@1201,1223@1201,1224@1201',
  'WF picker: WF clients only (A, C and D visible; B, staff and Client-less hidden)');
select is(pg_temp.picker('c0000000-0000-4000-8000-000000001202'), '', 'WF picker cannot list a B Client');

select pg_temp.act('1203', 'b');
select is(pg_temp.picker(), '1211@1202,1212@1203,1222@1202,1223@1202',
  'B picker: B clients only (B and C visible; A and archived D hidden)');
select is(pg_temp.picker('c0000000-0000-4000-8000-000000001202'), '1211@1202,1222@1202,1223@1202',
  'B picker filtered to the B Client');
select is(pg_temp.picker('c0000000-0000-4000-8000-000000001201'), '', 'B picker cannot list a WF Client');

select pg_temp.act('1205', 'b');
select throws_ok($$ select pg_temp.picker() $$, '42501', null, 'a WF owner with the B selector cannot read the B picker');

select pg_temp.act('1221', 'wf');
select throws_ok($$ select pg_temp.picker() $$, '42501', null, 'a client cannot read the picker');

select * from finish();
rollback;
