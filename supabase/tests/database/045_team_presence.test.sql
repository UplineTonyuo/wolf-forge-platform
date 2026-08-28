begin;

select plan(18);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7eb00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'presence-owner@example.invalid', now(), now()),
  ('7eb00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'presence-staff@example.invalid', now(), now()),
  ('7eb00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'presence-client@example.invalid', now(), now());

insert into public.companies (id, name)
values ('7eb00000-0000-4000-8000-00000000c001', 'Presence Client Co');

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    display_name = 'Presence Owner'
where id = '7eb00000-0000-4000-8000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    display_name = 'Presence Staff'
where id = '7eb00000-0000-4000-8000-000000000002';

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    display_name = 'Presence Client',
    company_id = '7eb00000-0000-4000-8000-00000000c001'
where id = '7eb00000-0000-4000-8000-000000000003';

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

select has_table(
  'public'::name,
  'team_presence_connections'::name,
  'presence connections have a dedicated table rather than a profile boolean'
);

select is(
  (select count(*) from pg_class
    where oid = 'public.team_presence_connections'::regclass
      and relrowsecurity and relforcerowsecurity),
  1::bigint,
  'presence storage enables and forces RLS'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'team_presence_connections'
      and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role has direct presence-table privileges'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'team_presence_connections'),
  0::bigint,
  'no policy reopens direct presence rows'
);

select is(
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('app_touch_team_presence', 'app_disconnect_team_presence')),
  2::bigint,
  'the surface is exactly one heartbeat and one disconnect RPC'
);

select is(
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('app_touch_team_presence', 'app_disconnect_team_presence')
      and prosecdef
      and coalesce(proconfig::text like '%search_path=%', false)),
  2::bigint,
  'both presence RPCs are SECURITY DEFINER with a pinned search path'
);

select is(
  (select count(*) from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('app_touch_team_presence', 'app_disconnect_team_presence')
      and grantee = 'authenticated'
      and privilege_type = 'EXECUTE'),
  2::bigint,
  'authenticated receives only RPC execution'
);

select is(
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('app_touch_team_presence', 'app_disconnect_team_presence')
      and coalesce(proargnames::text, '') ~ 'profile'),
  0::bigint,
  'neither RPC accepts a browser-supplied profile identity'
);

select pg_temp.become('7eb00000-0000-4000-8000-000000000003');

select throws_ok(
  $$ select public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000c1') $$,
  '42501',
  null,
  'a client cannot publish or read internal presence'
);

select throws_ok(
  $$ select public.app_disconnect_team_presence('7eb00000-0000-4000-8000-0000000000c1') $$,
  '42501',
  null,
  'a client cannot reach the disconnect surface either'
);

select pg_temp.become('7eb00000-0000-4000-8000-000000000001');

select ok(
  public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000a1')
    @> array['7eb00000-0000-4000-8000-000000000001'::uuid],
  'one live owner tab makes the owner online without disturbing real local sessions'
);

select public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000a2');

select is(
  (select count(*) from public.team_presence_connections
    where profile_id = '7eb00000-0000-4000-8000-000000000001'),
  2::bigint,
  'two tabs create two independent connections for one profile'
);

select pg_temp.become('7eb00000-0000-4000-8000-000000000002');

select ok(
  public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000bb')
    @> array[
      '7eb00000-0000-4000-8000-000000000001'::uuid,
      '7eb00000-0000-4000-8000-000000000002'::uuid
    ],
  'a colleague receives only the active internal profile ids'
);

select pg_temp.become('7eb00000-0000-4000-8000-000000000001');
select public.app_disconnect_team_presence('7eb00000-0000-4000-8000-0000000000a1');

select is(
  (select count(*) from public.team_presence_connections
    where profile_id = '7eb00000-0000-4000-8000-000000000001'),
  1::bigint,
  'closing one of two tabs leaves the other owner connection live'
);

select public.app_disconnect_team_presence('7eb00000-0000-4000-8000-0000000000a2');
select pg_temp.become('7eb00000-0000-4000-8000-000000000002');

select ok(
  not ('7eb00000-0000-4000-8000-000000000001'::uuid = any(
    public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000bb')
  )),
  'closing the last owner tab makes the owner offline'
);

insert into public.team_presence_connections (
  profile_id,
  connection_id,
  last_seen_at
)
values (
  '7eb00000-0000-4000-8000-000000000001',
  '7eb00000-0000-4000-8000-0000000000dd',
  clock_timestamp() - interval '2 minutes'
);

select public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000bb');

select is(
  (select count(*) from public.team_presence_connections
    where connection_id = '7eb00000-0000-4000-8000-0000000000dd'),
  0::bigint,
  'a crashed browser connection expires and is pruned'
);

select pg_temp.become('7eb00000-0000-4000-8000-000000000001');
select public.app_touch_team_presence('7eb00000-0000-4000-8000-0000000000bb');

select is(
  (select count(*) from public.team_presence_connections
    where connection_id = '7eb00000-0000-4000-8000-0000000000bb'),
  2::bigint,
  'an opaque connection id is namespaced by server-derived profile identity'
);

select public.app_disconnect_team_presence('7eb00000-0000-4000-8000-0000000000bb');

select is(
  (select count(*) from public.team_presence_connections
    where connection_id = '7eb00000-0000-4000-8000-0000000000bb'),
  1::bigint,
  'disconnect removes only the caller connection, never a colleague row'
);

select * from finish();
rollback;
