begin;

select plan(33);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7f100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'supervision-owner@example.invalid', now(), now()),
  ('7f100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'supervision-admin@example.invalid', now(), now()),
  ('7f100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'supervision-manager@example.invalid', now(), now()),
  ('7f100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'supervision-staff@example.invalid', now(), now()),
  ('7f100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'supervision-client@example.invalid', now(), now()),
  ('7f100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'supervision-archived@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    archived_at = case
      when profile_row.id = '7f100000-0000-4000-8000-000000000006' then now()
      else null
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '7f100000-0000-4000-8000-000000000001'::uuid
  when 'admin' then '7f100000-0000-4000-8000-000000000002'::uuid
  when 'manager' then '7f100000-0000-4000-8000-000000000003'::uuid
  when 'staff' then '7f100000-0000-4000-8000-000000000004'::uuid
  when 'client' then '7f100000-0000-4000-8000-000000000005'::uuid
end
or (
  profile_row.id = '7f100000-0000-4000-8000-000000000006'
  and role_row.name = 'admin'
);

create or replace function pg_temp.become(p_user uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
$$;

select ok(
  exists (select 1 from public.permissions where permission_key = 'team_messages.supervise'),
  'team_messages.supervise is registered'
);

select is(
  (select count(*) from public.role_permissions as grant_row
   join public.roles as role_row on role_row.id = grant_row.role_id
   where grant_row.permission_key = 'team_messages.supervise'
     and grant_row.allowed
     and role_row.name in ('owner', 'admin')),
  2::bigint,
  'owner and admin presets allow supervision'
);

select is(
  (select count(*) from public.role_permissions as grant_row
   join public.roles as role_row on role_row.id = grant_row.role_id
   where grant_row.permission_key = 'team_messages.supervise'
     and not grant_row.allowed
     and role_row.name in ('manager', 'staff', 'client')),
  3::bigint,
  'manager, staff, and client presets explicitly deny supervision'
);

select pg_temp.become('7f100000-0000-4000-8000-000000000001');
select ok(public.app_has_permission('team_messages.supervise'), 'owner has supervision permission');
select is(private.require_team_supervisor(), '7f100000-0000-4000-8000-000000000001'::uuid, 'owner helper returns auth.uid()');

select pg_temp.become('7f100000-0000-4000-8000-000000000002');
select ok(public.app_has_permission('team_messages.supervise'), 'admin has supervision permission');
select is(private.require_team_supervisor(), '7f100000-0000-4000-8000-000000000002'::uuid, 'admin helper returns auth.uid()');

select pg_temp.become('7f100000-0000-4000-8000-000000000003');
select ok(not public.app_has_permission('team_messages.supervise'), 'manager lacks supervision permission by default');
select throws_ok(
  $$ select private.require_team_supervisor() $$,
  '42501',
  null,
  'manager cannot pass the supervisor helper'
);

select pg_temp.become('7f100000-0000-4000-8000-000000000004');
select ok(not public.app_has_permission('team_messages.supervise'), 'staff lacks supervision permission by default');
select throws_ok(
  $$ select private.require_team_supervisor() $$,
  '42501',
  null,
  'staff cannot pass the supervisor helper'
);

select pg_temp.become('7f100000-0000-4000-8000-000000000005');
select ok(not public.app_has_permission('team_messages.supervise'), 'client lacks supervision permission');
select throws_ok(
  $$ select private.require_team_supervisor() $$,
  '42501',
  null,
  'client cannot pass the supervisor helper'
);

select pg_temp.become('7f100000-0000-4000-8000-000000000006');
select ok(not public.app_has_permission('team_messages.supervise'), 'archived internal profile lacks supervision permission');
select throws_ok(
  $$ select private.require_team_supervisor() $$,
  '42501',
  null,
  'archived internal profile cannot pass the supervisor helper'
);

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values
  ('7f100000-0000-4000-8000-000000000001', 'team_messages.supervise', false),
  ('7f100000-0000-4000-8000-000000000002', 'team_messages.supervise', false);

select pg_temp.become('7f100000-0000-4000-8000-000000000002');
select ok(not public.app_has_permission('team_messages.supervise'), 'explicit deny overrides the admin preset');
select throws_ok(
  $$ select private.require_team_supervisor() $$,
  '42501',
  null,
  'admin explicit deny blocks the supervisor helper'
);

select pg_temp.become('7f100000-0000-4000-8000-000000000001');
select ok(public.app_has_permission('team_messages.supervise'), 'owner remains absolute despite an explicit deny override');
select lives_ok(
  $$ select private.require_team_supervisor() $$,
  'owner helper follows the canonical absolute-owner resolver semantics'
);

select is(
  (select required_permission_key from public.permission_modules where module_key = 'team_supervision'),
  'team_messages.supervise',
  'team_supervision module is gated by the supervision capability'
);

select pg_temp.become('7f100000-0000-4000-8000-000000000001');
select ok((select granted from public.app_current_user_modules() where module_key = 'team_supervision'), 'owner sees team_supervision');

delete from public.profile_permission_overrides
where profile_id = '7f100000-0000-4000-8000-000000000002'
  and permission_key = 'team_messages.supervise';

select pg_temp.become('7f100000-0000-4000-8000-000000000002');
select ok((select granted from public.app_current_user_modules() where module_key = 'team_supervision'), 'admin sees team_supervision');

select pg_temp.become('7f100000-0000-4000-8000-000000000003');
select ok(not (select granted from public.app_current_user_modules() where module_key = 'team_supervision'), 'manager does not see team_supervision by default');
select ok((select granted from public.app_current_user_modules() where module_key = 'projects'), 'existing manager module behavior is unchanged');

select pg_temp.become('7f100000-0000-4000-8000-000000000004');
select ok(not (select granted from public.app_current_user_modules() where module_key = 'team_supervision'), 'staff does not see team_supervision by default');
select ok(public.app_has_permission('team_messages.use'), 'existing staff Team capability is unchanged');

select pg_temp.become('7f100000-0000-4000-8000-000000000005');
select is((select count(*) from public.app_current_user_modules() where module_key = 'team_supervision'), 0::bigint, 'client cannot see the internal team_supervision module');
select ok((select granted from public.app_current_user_modules() where module_key = 'portal_dashboard'), 'existing client module behavior is unchanged');

select is(
  (select pronargs from pg_proc where oid = 'private.require_team_supervisor()'::regprocedure),
  0::smallint,
  'helper accepts no actor or profile argument'
);

select ok(
  not has_function_privilege('anon', 'private.require_team_supervisor()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.require_team_supervisor()', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.require_team_supervisor()', 'EXECUTE'),
  'helper has no API or service-role execution grant'
);

select is(
  (select prorettype::regtype::text from pg_proc where oid = 'private.require_team_supervisor()'::regprocedure),
  'uuid',
  'helper returns only the trusted actor profile id'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name like 'team_%'
     and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role has a direct Team table grant'
);

select ok(
  not exists (
    select 1
    from pg_class as table_row
    join pg_namespace as schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relkind = 'r'
      and table_row.relname like 'team_%'
      and (not table_row.relrowsecurity or not table_row.relforcerowsecurity)
  ),
  'all existing Team tables retain enabled and forced RLS'
);

select * from finish();
rollback;
