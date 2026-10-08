begin;

select plan(44);

-- WL-1B Checkpoint B. Part 1 proves the rewritten helpers return exactly what
-- the pre-WL-1B profile-based helpers returned, for every Wolf Forge fixture
-- and every existing profile. Part 2 proves the new Tenant boundaries.

-- -----------------------------------------------------------------------------
-- Pre-WL-1B helper bodies, verbatim, as the reference implementation
-- -----------------------------------------------------------------------------

create function pg_temp.old_profile_has_permission(p_profile_id uuid, p_permission_key text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select case when preset_row.key = 'owner' then true
      else coalesce(
        (select profile_override.allowed from public.profile_permission_overrides as profile_override
          where profile_override.profile_id = profile_row.id and profile_override.permission_key = p_permission_key),
        (select preset_grant.allowed from public.role_permissions as preset_grant
          where preset_grant.role_id = profile_row.role_id and preset_grant.permission_key = p_permission_key),
        false) end
    from public.profiles as profile_row
    join public.permission_presets as preset_row on preset_row.role_id = profile_row.role_id
    where profile_row.id = p_profile_id and profile_row.archived_at is null
      and exists (select 1 from public.permissions as permission where permission.permission_key = p_permission_key)
  ), false);
$$;

create function pg_temp.old_profile_account_class(p_profile_id uuid)
returns text language sql stable set search_path = '' as $$
  select preset_row.account_class from public.profiles as profile_row
  join public.permission_presets as preset_row on preset_row.role_id = profile_row.role_id
  where profile_row.id = p_profile_id and profile_row.archived_at is null;
$$;

create function pg_temp.old_profile_preset_key(p_profile_id uuid)
returns text language sql stable set search_path = '' as $$
  select preset_row.key from public.profiles as profile_row
  join public.permission_presets as preset_row on preset_row.role_id = profile_row.role_id
  where profile_row.id = p_profile_id and profile_row.archived_at is null;
$$;

create function pg_temp.old_is_internal_user()
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.profiles as profile join public.roles as role on role.id = profile.role_id
    where profile.id = (select auth.uid()) and profile.archived_at is null
      and role.name in ('owner', 'admin', 'manager', 'staff'));
$$;

create function pg_temp.old_is_client_user()
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.profiles as profile join public.roles as role on role.id = profile.role_id
    where profile.id = (select auth.uid()) and profile.archived_at is null and role.name = 'client');
$$;

create function pg_temp.old_current_user_company_id()
returns uuid language sql stable set search_path = '' as $$
  select profile.company_id from public.profiles as profile
  join public.roles as role on role.id = profile.role_id
  join public.companies as company on company.id = profile.company_id
  where profile.id = (select auth.uid()) and profile.archived_at is null
    and company.archived_at is null and role.name = 'client';
$$;

create function pg_temp.old_current_user_role_name()
returns text language sql stable set search_path = '' as $$
  select role.name from public.profiles as profile join public.roles as role on role.id = profile.role_id
  where profile.id = (select auth.uid()) and profile.archived_at is null limit 1;
$$;

create function pg_temp.old_current_store_client()
returns table(profile_id uuid, company_id uuid) language sql stable set search_path = '' as $$
  select profile_row.id, company_row.id from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  join public.companies as company_row on company_row.id = profile_row.company_id and company_row.archived_at is null
  where profile_row.id = (select auth.uid()) and profile_row.archived_at is null and role_row.name = 'client';
$$;

create function pg_temp.old_current_ticket_actor()
returns table(profile_id uuid, role_name text, company_id uuid) language sql stable set search_path = '' as $$
  select profile_row.id, role_row.name, profile_row.company_id from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  where profile_row.id = (select auth.uid()) and profile_row.archived_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Wolf Forge fixtures (rolled back)
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-0000000008' || suffix)::uuid, 'authenticated', 'authenticated',
       'helpers-' || suffix || '@example.invalid', now(), now()
from unnest(array['81','82','83','84','85','86','87','88','89','90','91']) as suffix;

insert into public.companies (id, name, status, archived_at)
values
  ('30000000-0000-0000-0000-000000000881', 'Helpers Client', 'client', null),
  ('30000000-0000-0000-0000-000000000882', 'Helpers Archived Client', 'client', now());

update public.profiles as profile
set role_id = role.id,
    company_id = fixture.company_id::uuid,
    archived_at = fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000881', 'owner',   null, null::timestamptz),
  ('20000000-0000-0000-0000-000000000882', 'admin',   null, null),
  ('20000000-0000-0000-0000-000000000883', 'manager', null, null),
  ('20000000-0000-0000-0000-000000000884', 'staff',   null, null),
  ('20000000-0000-0000-0000-000000000885', 'client',  '30000000-0000-0000-0000-000000000881', null),
  ('20000000-0000-0000-0000-000000000886', 'client',  null, null),
  ('20000000-0000-0000-0000-000000000887', 'admin',   null, now()),
  ('20000000-0000-0000-0000-000000000888', 'client',  '30000000-0000-0000-0000-000000000882', null),
  ('20000000-0000-0000-0000-000000000889', 'staff',   null, null),
  ('20000000-0000-0000-0000-000000000890', 'admin',   null, null),
  ('20000000-0000-0000-0000-000000000891', 'client',  '30000000-0000-0000-0000-000000000881', null)
) as fixture(profile_id, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

-- D-275: 886 keeps the default client role with no Client, so no compatibility
-- field changed; provision it into Wolf Forge explicitly.
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select private.wolf_forge_tenant_id(), '20000000-0000-0000-0000-000000000886', 'client', role_row.id
from public.roles as role_row
where role_row.name = 'client';

-- Overrides exercise both directions of the override path.
create temporary table fx as
select
  (select permission.permission_key from public.permissions as permission
    where not exists (
      select 1 from public.role_permissions as grant_row join public.roles as role on role.id = grant_row.role_id
      where role.name = 'staff' and grant_row.permission_key = permission.permission_key and grant_row.allowed)
    order by 1 limit 1) as staff_extra_key,
  (select grant_row.permission_key from public.role_permissions as grant_row join public.roles as role on role.id = grant_row.role_id
    where role.name = 'manager' and grant_row.allowed order by 1 limit 1) as manager_denied_key;

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
select '20000000-0000-0000-0000-000000000884'::uuid, staff_extra_key, true from fx
union all
select '20000000-0000-0000-0000-000000000883'::uuid, manager_denied_key, false from fx;

-- 890 models a user who exists but holds no membership in the request Tenant.
delete from public.tenant_memberships where profile_id = '20000000-0000-0000-0000-000000000890';

select ok((select staff_extra_key is not null and manager_denied_key is not null from fx),
  'override fixtures found suitable permission keys');
-- Compared profiles: every fixture except 890, plus every existing profile
-- with a Wolf Forge membership. A profile that belongs only to another Tenant
-- (D-275, e.g. the persistent Local QA Tenant B identities) has no Wolf Forge
-- mirror, so the pre-WL-1B profile-based helpers never described it.
create temporary table compared_subjects as
select profile_row.id from public.profiles as profile_row
where profile_row.id <> '20000000-0000-0000-0000-000000000890'
  and (profile_row.id::text like '20000000-0000-0000-0000-00000000088_'
    or profile_row.id = '20000000-0000-0000-0000-000000000891'
    or exists (
      select 1 from public.tenant_memberships as membership_row
      where membership_row.profile_id = profile_row.id
        and membership_row.tenant_id = private.wolf_forge_tenant_id()
    ));
grant select on compared_subjects to authenticated;

select ok(
  not exists (
    select 1 from public.profiles as profile_row
    left join public.tenant_memberships as membership_row
      on membership_row.profile_id = profile_row.id and membership_row.tenant_id = private.wolf_forge_tenant_id()
    where profile_row.id in (select id from compared_subjects)
      and (membership_row.id is null
        or membership_row.role_id is distinct from profile_row.role_id
        or membership_row.company_id is distinct from profile_row.company_id
        or membership_row.archived_at is distinct from profile_row.archived_at)
  ),
  'every compared profile has an exact Wolf Forge mirror membership'
);

-- -----------------------------------------------------------------------------
-- Part 1: behavioural equivalence matrix
-- -----------------------------------------------------------------------------

create temporary table mismatch (context text, profile_id uuid, detail text);
create temporary table compared (context text, profile_id uuid, checks int);

do $$
declare
  subject record;
  context record;
  checks int;
begin
  for context in
    select * from (values
      ('no header', null::text),
      ('Wolf Forge selector', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}')
    ) as c(label, headers)
  loop
    for subject in
      select id from compared_subjects
    loop
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config('request.jwt.claim.sub', subject.id::text, true);
      perform set_config('request.headers', coalesce(context.headers, ''), true);

      insert into mismatch
      select context.label, subject.id, 'caller helper: ' || name
      from (values
        ('is_internal_user', private.is_internal_user() is distinct from pg_temp.old_is_internal_user()),
        ('is_client_user', private.is_client_user() is distinct from pg_temp.old_is_client_user()),
        ('current_user_company_id', private.current_user_company_id() is distinct from pg_temp.old_current_user_company_id()),
        ('current_user_role_name', private.current_user_role_name() is distinct from pg_temp.old_current_user_role_name()),
        ('current_account_class', private.current_account_class() is distinct from pg_temp.old_profile_account_class(subject.id)),
        ('is_client_private_admin', private.is_client_private_admin() is distinct from
          (pg_temp.old_is_internal_user() and pg_temp.old_profile_has_permission(subject.id, 'client_private.read'))),
        ('current_store_client', exists (
          (select * from private.current_store_client() except select * from pg_temp.old_current_store_client())
          union all
          (select * from pg_temp.old_current_store_client() except select * from private.current_store_client()))),
        ('current_ticket_actor', exists (
          (select * from private.current_ticket_actor() except select * from pg_temp.old_current_ticket_actor())
          union all
          (select * from pg_temp.old_current_ticket_actor() except select * from private.current_ticket_actor())))
      ) as result(name, differs)
      where differs;

      insert into mismatch
      select context.label, subject.id, 'permission: ' || permission.permission_key
      from public.permissions as permission
      where private.current_user_has_permission(permission.permission_key)
        is distinct from pg_temp.old_profile_has_permission(subject.id, permission.permission_key);

      insert into mismatch
      select context.label, subject.id, 'app_current_user_permissions'
      where exists (
        (select permission_key from public.app_current_user_permissions()
          except select permission_key from public.permissions where pg_temp.old_profile_has_permission(subject.id, permission_key))
        union all
        (select permission_key from public.permissions where pg_temp.old_profile_has_permission(subject.id, permission_key)
          except select permission_key from public.app_current_user_permissions())
      );

      if pg_temp.old_profile_account_class(subject.id) is not null then
        insert into mismatch
        select context.label, subject.id, 'app_current_user_modules'
        where exists (
          (select module_key, granted from public.app_current_user_modules()
            except
           select module_key, pg_temp.old_profile_has_permission(subject.id, required_permission_key)
           from public.permission_modules where account_class = pg_temp.old_profile_account_class(subject.id))
          union all
          (select module_key, pg_temp.old_profile_has_permission(subject.id, required_permission_key)
           from public.permission_modules where account_class = pg_temp.old_profile_account_class(subject.id)
            except
           select module_key, granted from public.app_current_user_modules())
        );
      end if;

      select count(*) into checks from public.permissions;
      insert into compared values (context.label, subject.id, checks + 10);
    end loop;
  end loop;

  -- Target-profile helpers, evaluated by a signed-in Wolf Forge owner and on
  -- the no-user trusted path (service role / triggers).
  for context in
    select * from (values
      ('target, signed-in evaluator', 'authenticated', '20000000-0000-0000-0000-000000000881'),
      ('target, no user (bridge)', '', '')
    ) as c(label, role_claim, sub)
  loop
    perform set_config('request.jwt.claim.role', context.role_claim, true);
    perform set_config('request.jwt.claim.sub', context.sub, true);
    perform set_config('request.headers', '', true);

    for subject in
      select id from compared_subjects
    loop
      insert into mismatch
      select context.label, subject.id, 'target: ' || coalesce(permission.permission_key, '(class/preset)')
      from public.permissions as permission
      where private.profile_has_permission(subject.id, permission.permission_key)
        is distinct from pg_temp.old_profile_has_permission(subject.id, permission.permission_key);

      insert into mismatch
      select context.label, subject.id, 'target class/preset'
      where private.profile_account_class(subject.id) is distinct from pg_temp.old_profile_account_class(subject.id)
         or private.profile_permission_preset_key(subject.id) is distinct from pg_temp.old_profile_preset_key(subject.id);

      insert into compared
      select context.label, subject.id, count(*) + 2 from public.permissions;
    end loop;
  end loop;
end;
$$;

select is((select count(*) from mismatch where context = 'no header'), 0::bigint,
  'no header: every caller helper and permission matches pre-WL-1B behaviour');
select is((select count(*) from mismatch where context = 'Wolf Forge selector'), 0::bigint,
  'Wolf Forge selector: every caller helper and permission matches pre-WL-1B behaviour');
select is((select count(*) from mismatch where context = 'target, signed-in evaluator'), 0::bigint,
  'target-profile helpers match for a signed-in Wolf Forge evaluator');
select is((select count(*) from mismatch where context = 'target, no user (bridge)'), 0::bigint,
  'target-profile helpers match on the no-user trusted path');
select ok(
  (select count(distinct profile_id) from compared) >= 10
    and (select count(*) from compared) = 4 * (select count(distinct profile_id) from compared),
  'the matrix ran all four contexts for every fixture and existing profile'
);
select ok(
  (select bool_and(pg_temp.old_profile_has_permission(
      '20000000-0000-0000-0000-000000000884', staff_extra_key)) from fx)
    and not (select bool_and(pg_temp.old_profile_has_permission(
      '20000000-0000-0000-0000-000000000883', manager_denied_key)) from fx),
  'the matrix includes an allow override and a deny override'
);

-- Spot checks on the role matrix. Helpers are SECURITY DEFINER, so results
-- depend on the JWT claims, not the SQL role these statements run as.
set local "request.jwt.claim.role" = 'authenticated';

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000881';
select is(private.current_user_role_name(), 'owner', 'owner resolves owner');
select ok(private.is_internal_user() and not private.is_client_user(), 'owner is internal');
select is((select count(*) from public.app_current_user_permissions()),
  (select count(*) from public.permissions), 'Wolf Forge owner holds every permission inside Wolf Forge');

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000885';
select ok(private.is_client_user() and not private.is_internal_user(), 'client membership is client, not internal');
select is(private.current_user_company_id(), '30000000-0000-0000-0000-000000000881'::uuid,
  'client resolves its Client from the membership');

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000889';
select ok(private.is_internal_user(), 'staff is internal');
select is(private.current_user_company_id(), null::uuid,
  'an internal membership has no client company context');
select is((select count(*) from private.current_store_client()), 0::bigint,
  'an internal membership is not a store client');

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000887';
select ok(not private.is_internal_user() and private.current_user_role_name() is null,
  'archived membership resolves nothing');

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000888';
select is(private.current_user_company_id(), null::uuid, 'archived Client yields no company context');

reset role;

-- -----------------------------------------------------------------------------
-- Part 2: Tenant boundaries (Tenant B rolled back)
-- -----------------------------------------------------------------------------

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000008b2', 'helpers-tenant-b', 'Tenant B', 'active');

-- 891: Wolf Forge client, Owner of Tenant B. 884: Wolf Forge staff with an
-- allow override, plain staff in Tenant B.
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-0000000008b2', fixture.profile_id::uuid, 'internal', role.id
from (values
  ('20000000-0000-0000-0000-000000000891', 'owner'),
  ('20000000-0000-0000-0000-000000000884', 'staff')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name;

-- Helpers are SECURITY DEFINER: results depend on the JWT claims, not the SQL role.
set local "request.jwt.claim.role" = 'authenticated';

-- Wolf Forge owner with a foreign selector (no membership there).
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000881';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008b2"}', true);
select ok(not private.is_internal_user(), 'foreign selector: Wolf Forge owner is not internal');
select is(private.current_user_role_name(), null, 'foreign selector: no role');
select is(private.current_account_class(), null, 'foreign selector: no account class');
select is((select count(*) from public.app_current_user_permissions()), 0::bigint,
  'foreign selector: Wolf Forge owner inherits no permissions');
select throws_ok('select private.require_permission(''permissions.manage'')', '42501', null,
  'foreign selector: require_permission refuses');
select throws_ok('select * from public.app_current_user_modules()', '42501', null,
  'foreign selector: modules refuse');

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select ok(not private.is_internal_user() and private.current_user_role_name() is null,
  'malformed selector: no Wolf Forge fallback for the owner');
select set_config('request.headers', '{"x-wf-tenant":""}', true);
select ok(not private.is_internal_user(), 'empty selector: no Wolf Forge fallback for the owner');

-- Tenant B Owner who is a client in Wolf Forge.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000891';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008b2"}', true);
select is(private.current_user_role_name(), 'owner', 'Tenant B selector: Owner of Tenant B');
select is((select count(*) from public.app_current_user_permissions()),
  (select count(*) from public.permissions), 'Tenant B Owner holds every permission inside Tenant B');
select is(private.current_user_company_id(), null::uuid,
  'Tenant B owner membership carries no Wolf Forge Client context');

select set_config('request.headers', '', true);
select is(private.current_user_role_name(), 'client', 'no header: the same user is a client in Wolf Forge');
select ok(not private.is_internal_user(), 'no header: Tenant B ownership grants nothing in Wolf Forge');
select ok(not private.current_user_has_permission('permissions.manage'),
  'no header: Tenant B Owner cannot manage Wolf Forge permissions');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c9"}', true);
select is((select count(*) from public.app_current_user_permissions()), 0::bigint,
  'Tenant Owner resolves nothing under a Tenant they do not belong to');

-- Overrides stay with the Wolf Forge membership.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000884';
select set_config('request.headers', '', true);
select ok(private.current_user_has_permission((select staff_extra_key from fx)),
  'Wolf Forge: the staff allow override applies');
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008b2"}', true);
select ok(not private.current_user_has_permission((select staff_extra_key from fx)),
  'Tenant B: a Wolf Forge override does not leak into another Tenant');
select ok(private.is_internal_user(), 'Tenant B: staff membership is internal there');

-- A profile with no membership in the request Tenant fails closed, although the
-- old profile-based helpers would have trusted it.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000890';
select set_config('request.headers', '', true);
select ok(pg_temp.old_is_internal_user(), 'pre-WL-1B helpers trusted the bare profile');
select ok(not private.is_internal_user() and not private.current_user_has_permission('clients.view'),
  'missing membership fails closed');

reset role;

-- Target-profile helpers follow the evaluator's Tenant.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000881', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008b2"}', true);
select ok(not private.profile_has_permission('20000000-0000-0000-0000-000000000882', 'clients.view')
    and private.profile_account_class('20000000-0000-0000-0000-000000000882') is null,
  'signed-in evaluator with a foreign selector resolves no target profile');

select set_config('request.headers', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select ok(not private.profile_has_permission('20000000-0000-0000-0000-000000000881', 'clients.view')
    and private.profile_account_class('20000000-0000-0000-0000-000000000881') is null,
  'anon resolves no target profile');

select set_config('request.jwt.claim.role', 'service_role', true);
select is(private.profile_account_class('20000000-0000-0000-0000-000000000881'), 'internal',
  'service_role (no user) evaluates targets in Wolf Forge via the bridge');

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'private.identity_tenant_id()', 'execute')
    and not has_function_privilege('anon', 'private.identity_tenant_id()', 'execute')
    and not has_function_privilege('service_role', 'private.identity_tenant_id()', 'execute'),
  'identity_tenant_id() is not executable by any client role'
);
select is(
  (select array_agg(proname::text order by proname) from pg_proc
    where pronamespace = 'private'::regnamespace
      and proname in ('identity_tenant_id', 'profile_account_class', 'profile_permission_preset_key',
        'profile_has_permission', 'is_internal_user', 'is_client_user', 'current_user_company_id',
        'current_user_role_name', 'current_store_client', 'current_ticket_actor')
      and prosecdef and proconfig = array['search_path=""']),
  array['current_store_client', 'current_ticket_actor', 'current_user_company_id', 'current_user_role_name',
    'identity_tenant_id', 'is_client_user', 'is_internal_user', 'profile_account_class',
    'profile_has_permission', 'profile_permission_preset_key'],
  'every rewritten helper is SECURITY DEFINER with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'private.is_internal_user()', 'execute')
    and not has_function_privilege('anon', 'private.is_internal_user()', 'execute')
    and not has_function_privilege('authenticated', 'private.profile_has_permission(uuid, text)', 'execute'),
  'helper execute grants are unchanged'
);

select * from finish();

rollback;
