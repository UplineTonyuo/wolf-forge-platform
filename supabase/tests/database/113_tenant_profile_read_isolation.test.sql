begin;

select plan(50);

-- WL-2.16 (KI-120): profiles stay global identity; an internal user reads a
-- profile only when it has a membership in the caller's current Tenant.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001301,
-- Tenant C = ...000000001302 (no fixture membership), Tenant S = ...000000001303
-- (suspended).

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- Actors: 1301 WF admin; 1302 B admin (B only); 1303 owner of WF, B and S;
-- 1304 B admin with an archived B membership; 1305 WF owner (no B membership).
-- Targets: 1311 A (WF client only); 1312 B (B client only); 1313 C (client in
-- both); 1314 D (no membership); 1315 E (archived B staff only); 1316 F (fresh
-- identity for provisioning).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'profile-read-' || n || '@example.invalid', now(), now()
from unnest(array['1301', '1302', '1303', '1304', '1305', '1311', '1312', '1313', '1314', '1315', '1316']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001301', 'profile-read-tenant-b', 'Profile Read Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001302', 'profile-read-tenant-c', 'Profile Read Tenant C', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001303', 'profile-read-tenant-s', 'Profile Read Tenant S', 'suspended');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000001301', private.wolf_forge_tenant_id(), 'PROFILE_READ_WF_CLIENT', 'client'),
  ('c0000000-0000-4000-8000-000000001302', 'f0f0f0f0-0000-4000-8000-000000001301', 'PROFILE_READ_B_CLIENT', 'client');

-- Wolf Forge memberships through the compatibility fields (explicit WF path).
update public.profiles as profile
set role_id = role.id,
    company_id = fixture.company_id::uuid,
    display_name = 'ProfileRead ' || right(fixture.profile_id, 4)
from (values
  ('20000000-0000-4000-8000-000000001301', 'admin', null),
  ('20000000-0000-4000-8000-000000001303', 'owner', null),
  ('20000000-0000-4000-8000-000000001305', 'owner', null),
  ('20000000-0000-4000-8000-000000001311', 'client', 'c0000000-0000-4000-8000-000000001301'),
  ('20000000-0000-4000-8000-000000001313', 'client', 'c0000000-0000-4000-8000-000000001301')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

update public.profiles set display_name = 'ProfileRead ' || right(id::text, 4)
where id in ('20000000-0000-4000-8000-000000001302', '20000000-0000-4000-8000-000000001304',
  '20000000-0000-4000-8000-000000001312', '20000000-0000-4000-8000-000000001314',
  '20000000-0000-4000-8000-000000001315');

-- Tenant B / S memberships (explicit, standing in for their own provisioning).
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-000000001301', '20000000-0000-4000-8000-000000001302', 'admin', 'internal', null, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000001301', '20000000-0000-4000-8000-000000001303', 'owner', 'internal', null, null),
  ('f0f0f0f0-0000-4000-8000-000000001303', '20000000-0000-4000-8000-000000001303', 'owner', 'internal', null, null),
  ('f0f0f0f0-0000-4000-8000-000000001301', '20000000-0000-4000-8000-000000001304', 'admin', 'internal', null, now()),
  ('f0f0f0f0-0000-4000-8000-000000001301', '20000000-0000-4000-8000-000000001312', 'client', 'client', 'c0000000-0000-4000-8000-000000001302', null),
  ('f0f0f0f0-0000-4000-8000-000000001301', '20000000-0000-4000-8000-000000001313', 'client', 'client', 'c0000000-0000-4000-8000-000000001302', null),
  ('f0f0f0f0-0000-4000-8000-000000001301', '20000000-0000-4000-8000-000000001315', 'staff', 'internal', null, now())
) as fixture(tenant_id, profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_selector
    when 'wf' then ''
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}'
    when 'c' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001302"}'
    when 's' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001303"}'
    when 'unknown' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000013ff"}'
    when 'malformed' then '{"x-wf-tenant":"not-a-tenant"}'
    when 'number' then '{"x-wf-tenant":1301}'
    when 'explicit-wf' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}'
    end, true);
$$;

-- seen(): fixture profiles the caller can read directly, as 'last4' list.
create function pg_temp.seen()
returns text
language sql
as $$
  select coalesce(string_agg(right(id::text, 4), ',' order by id), '')
  from public.profiles
  where id::text like '20000000-0000-4000-8000-0000000013%';
$$;

-- targets(): the same restricted to the four mandatory targets A-D and E.
create function pg_temp.targets()
returns text
language sql
as $$
  select coalesce(string_agg(right(id::text, 4), ',' order by id), '')
  from public.profiles
  where id::text like '20000000-0000-4000-8000-00000000131%';
$$;

-- Expected WF client count, read directly from the membership table.
create function pg_temp.wf_client_count()
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from public.tenant_memberships as membership
  join public.profiles as profile on profile.id = membership.profile_id
  join public.roles as role on role.id = membership.role_id
  where membership.tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001'
    and role.name = 'client'
    and membership.archived_at is null
    and profile.archived_at is null;
$$;

grant execute on function pg_temp.act(text, text), pg_temp.seen(), pg_temp.targets(),
  pg_temp.wf_client_count() to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads: A WF only, B B only, C both, D none, E archived B member
-- -----------------------------------------------------------------------------

select pg_temp.act('1301', 'wf');
select is(pg_temp.targets(), '1311,1313', 'WF admin sees A and C; B, D and E are hidden');
select is(pg_temp.seen(), '1301,1303,1305,1311,1313', 'WF admin sees only Wolf Forge-related fixture identities');
select is(
  (select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000001312'),
  0::bigint,
  'WF admin cannot read the B-only profile by id'
);
select is(
  (select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000001314'),
  0::bigint,
  'WF admin cannot read the membership-less profile by id'
);

select pg_temp.act('1302', 'b');
select is(pg_temp.targets(), '1312,1313,1315', 'B admin sees B, C and archived member E; A and D are hidden');
select is(pg_temp.seen(), '1302,1303,1304,1312,1313,1315', 'B admin sees only Tenant B-related fixture identities');
select is(
  (select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000001311'),
  0::bigint,
  'B admin cannot read the WF-only profile by id'
);
-- The Wolf Forge compatibility fields are not a cross-Tenant channel.
select is(
  (select count(*) from public.profiles where company_id = 'c0000000-0000-4000-8000-000000001301'),
  1::bigint,
  'B admin learns the WF company_id only of the dual member C'
);
select is(
  (select count(*) from public.profiles
    where id not in (
      select membership.profile_id from (values
        ('20000000-0000-4000-8000-000000001302'::uuid), ('20000000-0000-4000-8000-000000001303'),
        ('20000000-0000-4000-8000-000000001304'), ('20000000-0000-4000-8000-000000001312'),
        ('20000000-0000-4000-8000-000000001313'), ('20000000-0000-4000-8000-000000001315')
      ) as membership(profile_id))),
  0::bigint,
  'B admin reads no profile outside Tenant B across the whole table'
);

-- -----------------------------------------------------------------------------
-- Self access
-- -----------------------------------------------------------------------------

select pg_temp.act('1311', 'wf');
select is(pg_temp.seen(), '1311', 'A (WF client) reads only its own profile');
select pg_temp.act('1312', 'b');
select is(pg_temp.seen(), '1312', 'B (B client) reads only its own profile with the B selector');
select is(private.is_current_tenant_profile('20000000-0000-4000-8000-000000001302'), false,
  'the visibility helper is no membership oracle for a client caller');
select pg_temp.act('1313', 'wf');
select is(pg_temp.seen(), '1313', 'C reads only its own profile with the WF selector');
select pg_temp.act('1313', 'b');
select is(pg_temp.seen(), '1313', 'C reads only its own profile with the B selector');
select pg_temp.act('1314', 'wf');
select is(pg_temp.seen(), '', 'D (no membership) reads nothing, as before WL-2.16');
select pg_temp.act('1302', 'b');
select is(
  (select display_name from public.profiles where id = '20000000-0000-4000-8000-000000001302'),
  'ProfileRead 1302',
  'B admin reads its own profile'
);
select pg_temp.act('1301', 'wf');
select is(
  (select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000001301' and role_id is not null),
  1::bigint,
  'WF admin reads its own profile including role_id (internal app shell read)'
);

-- -----------------------------------------------------------------------------
-- Owner and dual owner
-- -----------------------------------------------------------------------------

select pg_temp.act('1305', 'wf');
select is(pg_temp.targets(), '1311,1313', 'WF owner sees only Wolf Forge-related targets');
select pg_temp.act('1303', 'wf');
select is(pg_temp.targets(), '1311,1313', 'dual owner with the WF selector sees the WF graph');
select pg_temp.act('1303', 'b');
select is(pg_temp.targets(), '1312,1313,1315', 'dual owner with the B selector sees the B graph');
select is(pg_temp.seen(), '1302,1303,1304,1312,1313,1315', 'dual owner with the B selector sees no WF-only identity');

-- -----------------------------------------------------------------------------
-- Archived caller and selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1304', 'b');
select is(pg_temp.seen(), '', 'an archived B admin reads no profile, not even its own');
select throws_ok($$ select * from public.app_list_internal_members() $$, '42501', null,
  'an archived B admin cannot list members');

select pg_temp.act('1305', 'b');
select is(pg_temp.seen(), '', 'a WF owner with a foreign B selector reads no profile');
select pg_temp.act('1303', 'c');
select is(pg_temp.seen(), '', 'a selector for a Tenant without membership reads no profile');
select pg_temp.act('1303', 's');
select is(pg_temp.seen(), '', 'a suspended Tenant selector reads no profile');
select pg_temp.act('1303', 'unknown');
select is(pg_temp.seen(), '', 'an unknown Tenant selector reads no profile');
select pg_temp.act('1303', 'malformed');
select is(pg_temp.seen(), '', 'a malformed selector reads no profile');
select pg_temp.act('1303', 'number');
select is(pg_temp.seen(), '', 'a non-string selector reads no profile');
select pg_temp.act('1302', 'wf');
select is(pg_temp.seen(), '', 'a B-only admin without a selector (WF default) reads no profile');
select pg_temp.act('1301', 'explicit-wf');
select is(pg_temp.targets(), '1311,1313', 'an explicit WF selector equals the absent-selector WF graph');

-- -----------------------------------------------------------------------------
-- Member lists / search (SECURITY DEFINER read models)
-- -----------------------------------------------------------------------------

select pg_temp.act('1302', 'b');
select is(
  (select string_agg(right(profile_id::text, 4), ',' order by profile_id)
    from public.app_list_internal_members() where profile_id::text like '20000000-0000-4000-8000-0000000013%'),
  '1302,1303',
  'B member directory lists only active B internal members'
);
select is(
  (select string_agg(right(profile_id::text, 4), ',' order by profile_id)
    from public.app_list_operational_assignees() where profile_id::text like '20000000-0000-4000-8000-0000000013%'),
  '1302,1303',
  'B assignee list holds only active B internal members'
);
select is(
  (select string_agg(right(profile_id::text, 4), ',' order by profile_id)
    from public.app_list_team_members() where profile_id::text like '20000000-0000-4000-8000-0000000013%'),
  '1303',
  'B Team directory holds only other active B internal members'
);
select is(
  (select string_agg(right(profile_id::text, 4), ',' order by profile_id)
    from public.app_list_onboarding_assignment_candidates() where profile_id::text like '20000000-0000-4000-8000-0000000013%'),
  '1312,1313',
  'B onboarding candidates are B client members only'
);
select is(
  (select count(*) from public.app_search_client_directory('ProfileRead')
    where client_profile_id in ('20000000-0000-4000-8000-000000001311', '20000000-0000-4000-8000-000000001314')),
  0::bigint,
  'B client directory search returns no WF-only or membership-less identity'
);
select is(
  (select count(*) from public.app_get_profile_permission_summary('20000000-0000-4000-8000-000000001311')),
  0::bigint,
  'B admin gets no permission summary for a WF-only identity'
);
select is(
  (select member_count from public.app_list_permission_preset_overview() where preset_key = 'admin'),
  1,
  'B role map counts only active B admins'
);
select is(
  (select member_count from public.app_list_permission_preset_overview() where preset_key = 'client'),
  2,
  'B role map counts only B client memberships'
);

select pg_temp.act('1301', 'wf');
select ok(
  (select string_agg(right(profile_id::text, 4), ',' order by profile_id)
    from public.app_list_internal_members() where profile_id::text like '20000000-0000-4000-8000-0000000013%')
    = '1301,1303,1305',
  'WF member directory still lists the WF internal members'
);
select is(
  (select string_agg(right(profile_id::text, 4), ',' order by profile_id)
    from public.app_list_onboarding_assignment_candidates() where profile_id::text like '20000000-0000-4000-8000-0000000013%'),
  '1311,1313',
  'WF onboarding candidates still list the WF clients'
);
select is(
  (select count(*) from public.app_get_profile_permission_summary('20000000-0000-4000-8000-000000001311')),
  1::bigint,
  'WF admin still reads a WF member''s permission summary'
);
select is(
  (select member_count from public.app_list_permission_preset_overview() where preset_key = 'client'),
  pg_temp.wf_client_count(),
  'WF role map counts WF client memberships, not every global client-role profile'
);

-- -----------------------------------------------------------------------------
-- Provisioning regressions
-- -----------------------------------------------------------------------------

select pg_temp.act('1302', 'b');
select is(pg_temp.seen() like '%1316%', false, 'a fresh identity is not discoverable before provisioning');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000001316', 'staff') $$,
  'B admin still provisions a fresh identity by UUID');
select is(pg_temp.seen() like '%1316%', true, 'the provisioned identity becomes visible to Tenant B');
select pg_temp.act('1301', 'wf');
select is(pg_temp.seen() like '%1316%', false, 'the B-provisioned identity stays invisible to Wolf Forge');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000001314', 'c0000000-0000-4000-8000-000000001301') $$,
  'WF admin still provisions the membership-less identity D as a WF client');
select is(pg_temp.targets(), '1311,1313,1314', 'D becomes visible to Wolf Forge after explicit provisioning');
select pg_temp.act('1302', 'b');
select is(pg_temp.seen() like '%1314%', false, 'D stays invisible to Tenant B');

reset role;

select * from finish();
rollback;
