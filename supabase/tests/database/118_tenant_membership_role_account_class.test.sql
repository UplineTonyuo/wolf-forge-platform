begin;

select plan(44);

-- WL-2.21 (KI-124): tenant_memberships.account_class must equal the role's
-- permission_presets.account_class, for every INSERT and UPDATE, archived rows
-- included, whoever writes. WF = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = ...000000002401.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- Actors: 2401 WF admin; 2402 B admin (B only).
-- Dual: 2403 WF client (profile client) + B staff; 2404 WF admin (profile
-- admin) + B client.
-- Direct-write targets: 2405, 2406, 2407 (no membership until the tests).
-- Fresh identities for provisioning: 2411 WF staff, 2412 WF client, 2413 B
-- staff, 2414 B client.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'membership-class-' || n || '@example.invalid', now(), now()
from unnest(array['2401', '2402', '2403', '2404', '2405', '2406', '2407', '2411', '2412', '2413', '2414']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002401', 'membership-class-tenant-b', 'Membership Class Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000002401', private.wolf_forge_tenant_id(), 'MEMBERSHIP_CLASS_WF_CLIENT', 'client'),
  ('c0000000-0000-4000-8000-000000002402', 'f0f0f0f0-0000-4000-8000-000000002401', 'MEMBERSHIP_CLASS_B_CLIENT', 'client');

-- Wolf Forge memberships through the compatibility fields (explicit WF path).
update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002401', 'admin', null),
  ('20000000-0000-4000-8000-000000002403', 'client', 'c0000000-0000-4000-8000-000000002401'),
  ('20000000-0000-4000-8000-000000002404', 'admin', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select 'f0f0f0f0-0000-4000-8000-000000002401', fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002402', 'admin', 'internal', null),
  ('20000000-0000-4000-8000-000000002403', 'staff', 'internal', null),
  ('20000000-0000-4000-8000-000000002404', 'client', 'client', 'c0000000-0000-4000-8000-000000002402')
) as fixture(profile_id, role_name, account_class, company_id)
join public.roles as role on role.name = fixture.role_name;

-- Readback probes for the test only.
-- m(): 'role:class' of the membership in a Tenant, NULL when absent.
create function pg_temp.m(p_tenant text, p_profile text)
returns text
language sql
security definer
as $$
  select role.name || ':' || membership.account_class
  from public.tenant_memberships as membership
  join public.roles as role on role.id = membership.role_id
  where membership.tenant_id = case p_tenant when 'wf' then 'f0f0f0f0-0000-4000-8000-000000000001'::uuid
      else 'f0f0f0f0-0000-4000-8000-000000002401'::uuid end
    and membership.profile_id = ('20000000-0000-4000-8000-00000000' || p_profile)::uuid;
$$;

create function pg_temp.r(p_role text)
returns uuid
language sql
security definer
as $$
  select id from public.roles where name = p_role;
$$;

create function pg_temp.act(p_actor text, p_tenant text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_tenant
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002401"}'
    else '' end, true);
$$;

create function pg_temp.cls()
returns text
language sql
as $$
  select coalesce(string_agg(account_class || '/' || role_name, ','), '')
  from public.app_current_tenant_membership();
$$;

grant execute on function pg_temp.m(text, text), pg_temp.r(text), pg_temp.act(text, text), pg_temp.cls()
  to authenticated;

-- -----------------------------------------------------------------------------
-- Structure
-- -----------------------------------------------------------------------------

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.tenant_memberships'::regclass
     and conname = 'tenant_memberships_role_account_class_fkey'),
  'FOREIGN KEY (role_id, account_class) REFERENCES permission_presets(role_id, account_class)',
  'membership (role_id, account_class) references the preset classification'
);
select is(
  (select count(*) from public.roles as role
   where not exists (select 1 from public.permission_presets as preset where preset.role_id = role.id)),
  0::bigint,
  'every role has a preset classification'
);

-- -----------------------------------------------------------------------------
-- Direct / trusted writes (postgres; RLS and grants do not apply)
-- -----------------------------------------------------------------------------

select lives_ok($$
  insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
  values ('f0f0f0f0-0000-4000-8000-000000002401', '20000000-0000-4000-8000-000000002405', 'internal', pg_temp.r('owner'))
$$, 'valid internal membership (owner) inserts');
select lives_ok($$
  insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
  values ('f0f0f0f0-0000-4000-8000-000000002401', '20000000-0000-4000-8000-000000002406', 'client', pg_temp.r('client'),
    'c0000000-0000-4000-8000-000000002402')
$$, 'valid client membership inserts');

select throws_ok($$
  insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
  values ('f0f0f0f0-0000-4000-8000-000000002401', '20000000-0000-4000-8000-000000002407', 'client', pg_temp.r('owner'))
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'INSERT client + owner role fails');
select throws_ok($$
  insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
  values ('f0f0f0f0-0000-4000-8000-000000002401', '20000000-0000-4000-8000-000000002407', 'client', pg_temp.r('staff'))
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'INSERT client + staff role fails');
select throws_ok($$
  insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
  values ('f0f0f0f0-0000-4000-8000-000000002401', '20000000-0000-4000-8000-000000002407', 'internal', pg_temp.r('client'))
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'INSERT internal + client role fails');
select throws_ok($$
  insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
  values ('f0f0f0f0-0000-4000-8000-000000002401', '20000000-0000-4000-8000-000000002407', 'client', pg_temp.r('admin'), now())
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'INSERT archived client + admin role fails');
select is(pg_temp.m('b', '2407'), null, 'no contradictory 2407 row was stored');

-- account_class only.
select throws_ok($$
  update public.tenant_memberships set account_class = 'client'
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'UPDATE account_class only: internal owner -> client fails');
select throws_ok($$
  update public.tenant_memberships set account_class = 'internal', company_id = null
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002406'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'UPDATE account_class only: client -> internal with the client role fails');

-- role_id only.
select throws_ok($$
  update public.tenant_memberships set role_id = pg_temp.r('client')
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'UPDATE role_id only: internal membership -> client role fails');
select throws_ok($$
  update public.tenant_memberships set role_id = pg_temp.r('owner')
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002406'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'UPDATE role_id only: client membership -> owner role fails');
select throws_ok($$
  update public.tenant_memberships set role_id = pg_temp.r('staff')
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002406'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'UPDATE role_id only: client membership -> staff role fails');

select is(pg_temp.m('b', '2405'), 'owner:internal', 'rejected updates left the owner row intact');
select is(pg_temp.m('b', '2406'), 'client:client', 'rejected updates left the client row intact');

-- Legitimate same-class role change.
select lives_ok($$
  update public.tenant_memberships set role_id = pg_temp.r('staff')
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, 'internal owner -> internal staff passes');

-- Archived rows stay structurally consistent.
update public.tenant_memberships set archived_at = now()
where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405';
select throws_ok($$
  update public.tenant_memberships set role_id = pg_temp.r('client')
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'archived membership: role_id -> client role still fails');
select throws_ok($$
  update public.tenant_memberships set account_class = 'client'
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, '23503', 'insert or update on table "tenant_memberships" violates foreign key constraint "tenant_memberships_role_account_class_fkey"',
  'archived membership: account_class -> client still fails');
select lives_ok($$
  update public.tenant_memberships set archived_at = null
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, 'restoring an archived valid membership passes');

-- Both columns moving together stay valid.
select lives_ok($$
  update public.tenant_memberships set account_class = 'client', role_id = pg_temp.r('client')
  where tenant_id = 'f0f0f0f0-0000-4000-8000-000000002401' and profile_id = '20000000-0000-4000-8000-000000002405'
$$, 'consistent internal -> client transition of both columns passes');

-- -----------------------------------------------------------------------------
-- Explicit provisioning (WL-2.15)
-- -----------------------------------------------------------------------------

select is(
  (select count(*) from public.tenant_memberships
   where profile_id in ('20000000-0000-4000-8000-000000002411', '20000000-0000-4000-8000-000000002412',
     '20000000-0000-4000-8000-000000002413', '20000000-0000-4000-8000-000000002414')),
  0::bigint,
  'fresh identities hold no membership'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('2401', 'wf');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000002411', 'staff') $$,
  'WF admin provisions WF staff');
select is(pg_temp.m('wf', '2411'), 'staff:internal', 'WF internal provisioning -> staff:internal');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000002412', 'c0000000-0000-4000-8000-000000002401') $$,
  'WF admin provisions a WF client');
select is(pg_temp.m('wf', '2412'), 'client:client', 'WF client provisioning -> client:client');
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-4000-8000-000000002411', 'manager') $$,
  'WF admin changes WF staff -> manager');
select is(pg_temp.m('wf', '2411'), 'manager:internal', 'WF role change through the mirror stays internal');

select pg_temp.act('2402', 'b');
select lives_ok($$ select public.app_provision_internal_member_profile('20000000-0000-4000-8000-000000002413', 'staff') $$,
  'B admin provisions B staff');
select is(pg_temp.m('b', '2413'), 'staff:internal', 'B internal provisioning -> staff:internal');
select lives_ok($$ select public.app_provision_client_account_profile(
    '20000000-0000-4000-8000-000000002414', 'c0000000-0000-4000-8000-000000002402') $$,
  'B admin provisions a B client');
select is(pg_temp.m('b', '2414'), 'client:client', 'B client provisioning -> client:client');

-- Membership administration in B.
select lives_ok($$ select public.app_set_profile_permission_preset('20000000-0000-4000-8000-000000002413', 'manager') $$,
  'B admin changes B staff -> manager');
select is(pg_temp.m('b', '2413'), 'manager:internal', 'B internal -> internal role change passes');
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-4000-8000-000000002413', 'client') $$,
  '42501', 'a internal account cannot be assigned the client preset', 'B internal membership -> client preset refused');
select throws_ok($$ select public.app_set_profile_permission_preset('20000000-0000-4000-8000-000000002414', 'owner') $$,
  '42501', 'a client account cannot be assigned the internal preset', 'B client membership -> owner preset refused');
select is(pg_temp.m('b', '2414'), 'client:client', 'B client membership unchanged');

-- -----------------------------------------------------------------------------
-- Dual-Tenant identities and app access (fb352af)
-- -----------------------------------------------------------------------------

select pg_temp.act('2403', 'b');
select is(pg_temp.cls(), 'internal/staff', 'global client + B staff -> internal in B');
select pg_temp.act('2403', 'wf');
select is(pg_temp.cls(), 'client/client', 'same identity -> client in WF');
select pg_temp.act('2404', 'b');
select is(pg_temp.cls(), 'client/client', 'global admin + B client -> client in B');
select ok(not private.is_internal_user(), 'global admin + B client has no internal access in B');

reset role;

-- -----------------------------------------------------------------------------
-- Profile compatibility mirror
-- -----------------------------------------------------------------------------

update public.profiles set role_id = pg_temp.r('client'), company_id = 'c0000000-0000-4000-8000-000000002401'
where id = '20000000-0000-4000-8000-000000002411';
select is(pg_temp.m('wf', '2411'), 'client:client', 'mirror carries a WF role -> client change with a matching class');
select is(
  (select role.name from public.profiles as profile join public.roles as role on role.id = profile.role_id
   where profile.id = '20000000-0000-4000-8000-000000002413'),
  'client',
  'B provisioning left the compatibility role alone'
);

-- No contradictory membership exists anywhere.
select is(
  (select count(*) from public.tenant_memberships as membership
   join public.permission_presets as preset on preset.role_id = membership.role_id
   where preset.account_class <> membership.account_class),
  0::bigint,
  'no membership contradicts its role classification'
);

select * from finish();

rollback;
