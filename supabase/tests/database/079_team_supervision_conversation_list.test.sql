begin;

select plan(40);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7f300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'list-owner@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'list-admin@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'list-manager@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'list-staff-a@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'list-staff-b@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'list-client@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'list-archived-admin@example.invalid', now(), now()),
  ('7f300000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'list-archived-staff@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '7f300000-0000-4000-8000-000000000004' then 'Alice Staff'
      when '7f300000-0000-4000-8000-000000000005' then 'Bob Staff'
      when '7f300000-0000-4000-8000-000000000008' then 'Former Staff'
      else profile_row.display_name
    end,
    archived_at = case
      when profile_row.id in (
        '7f300000-0000-4000-8000-000000000007',
        '7f300000-0000-4000-8000-000000000008'
      ) then now()
      else null
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '7f300000-0000-4000-8000-000000000001'::uuid
  when 'admin' then '7f300000-0000-4000-8000-000000000002'::uuid
  when 'manager' then '7f300000-0000-4000-8000-000000000003'::uuid
  when 'staff' then '7f300000-0000-4000-8000-000000000004'::uuid
  when 'client' then '7f300000-0000-4000-8000-000000000006'::uuid
end
or (profile_row.id = '7f300000-0000-4000-8000-000000000005' and role_row.name = 'staff')
or (profile_row.id = '7f300000-0000-4000-8000-000000000007' and role_row.name = 'admin')
or (profile_row.id = '7f300000-0000-4000-8000-000000000008' and role_row.name = 'staff');

insert into public.team_conversations (
  id, conversation_key, created_by_profile_id, kind, title, last_message_at, created_at
)
values
  (
    '7f310000-0000-4000-8000-000000000001',
    '7f300000-0000-4000-8000-000000000004|7f300000-0000-4000-8000-000000000005',
    '7f300000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-28 12:00:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '7f310000-0000-4000-8000-000000000002',
    'group:7f310000-0000-4000-8000-000000000002',
    '7f300000-0000-4000-8000-000000000004', 'group', 'Excluded group',
    '2026-09-29 12:00:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '7f310000-0000-4000-8000-000000000003',
    '7f300000-0000-4000-8000-000000000004|7f300000-0000-4000-8000-000000000006',
    '7f300000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 11:00:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '7f310000-0000-4000-8000-000000000004',
    '7f300000-0000-4000-8000-000000000001|7f300000-0000-4000-8000-000000000004',
    '7f300000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 10:00:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '7f310000-0000-4000-8000-000000000005',
    '7f300000-0000-4000-8000-000000000001|7f300000-0000-4000-8000-000000000002',
    '7f300000-0000-4000-8000-000000000001', 'direct', null,
    '2026-09-29 09:00:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '7f310000-0000-4000-8000-000000000006',
    '7f300000-0000-4000-8000-000000000004|7f300000-0000-4000-8000-000000000008',
    '7f300000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-28 12:00:00+00', '2026-09-01 00:00:00+00'
  );

insert into public.team_conversation_members (conversation_id, profile_id, last_read_at)
values
  ('7f310000-0000-4000-8000-000000000001', '7f300000-0000-4000-8000-000000000004', '2026-09-20 00:00:00+00'),
  ('7f310000-0000-4000-8000-000000000001', '7f300000-0000-4000-8000-000000000005', null),
  ('7f310000-0000-4000-8000-000000000002', '7f300000-0000-4000-8000-000000000004', null),
  ('7f310000-0000-4000-8000-000000000002', '7f300000-0000-4000-8000-000000000005', null),
  ('7f310000-0000-4000-8000-000000000003', '7f300000-0000-4000-8000-000000000004', null),
  ('7f310000-0000-4000-8000-000000000003', '7f300000-0000-4000-8000-000000000006', null),
  ('7f310000-0000-4000-8000-000000000004', '7f300000-0000-4000-8000-000000000004', null),
  ('7f310000-0000-4000-8000-000000000005', '7f300000-0000-4000-8000-000000000001', null),
  ('7f310000-0000-4000-8000-000000000005', '7f300000-0000-4000-8000-000000000002', null),
  ('7f310000-0000-4000-8000-000000000005', '7f300000-0000-4000-8000-000000000004', null),
  ('7f310000-0000-4000-8000-000000000006', '7f300000-0000-4000-8000-000000000004', null),
  ('7f310000-0000-4000-8000-000000000006', '7f300000-0000-4000-8000-000000000008', null);

insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
values (
  '7f340000-0000-4000-8000-000000000001',
  '7f340000-0000-4000-8000-000000000002',
  '7f310000-0000-4000-8000-000000000001',
  '7f300000-0000-4000-8000-000000000004',
  'SUPERVISION_LIST_MUST_NOT_EXPOSE_THIS_BODY',
  '2026-09-28 12:00:00+00'
);

create temp table synthetic_profiles (profile_id uuid primary key) on commit drop;

insert into synthetic_profiles
select ('7f320000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid
from generate_series(1, 15) as value;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select profile_id, 'authenticated', 'authenticated', profile_id::text || '@example.invalid', now(), now()
from synthetic_profiles;

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = 'Synthetic ' || right(profile_row.id::text, 2)
from public.roles as role_row
where profile_row.id in (select profile_id from synthetic_profiles)
  and role_row.name = 'staff';

create temp table synthetic_pairs on commit drop as
select
  row_number() over (order by first_profile.profile_id, second_profile.profile_id)::integer as pair_number,
  first_profile.profile_id as first_id,
  second_profile.profile_id as second_id
from synthetic_profiles as first_profile
join synthetic_profiles as second_profile on first_profile.profile_id < second_profile.profile_id
limit 105;

insert into public.team_conversations (
  id, conversation_key, created_by_profile_id, kind, last_message_at, created_at
)
select
  ('7f330000-0000-4000-8000-' || lpad(pair_number::text, 12, '0'))::uuid,
  first_id::text || '|' || second_id::text,
  first_id,
  'direct',
  '2026-09-01 00:00:00+00'::timestamptz + pair_number * interval '1 minute',
  '2026-08-01 00:00:00+00'::timestamptz + pair_number * interval '1 minute'
from synthetic_pairs;

insert into public.team_conversation_members (conversation_id, profile_id)
select ('7f330000-0000-4000-8000-' || lpad(pair_number::text, 12, '0'))::uuid, first_id
from synthetic_pairs
union all
select ('7f330000-0000-4000-8000-' || lpad(pair_number::text, 12, '0'))::uuid, second_id
from synthetic_pairs;

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

create temp table supervision_state_before (
  state_name text primary key,
  payload jsonb not null
) on commit drop;

insert into supervision_state_before
select 'members', coalesce(jsonb_agg(to_jsonb(snapshot_row)), '[]'::jsonb)
from (select * from public.team_conversation_members order by conversation_id, profile_id) as snapshot_row
union all
select 'operational', jsonb_build_object(
  'deliveries', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_deliveries order by message_id, recipient_profile_id) as row_value),
  'notifications', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.notifications order by id) as row_value),
  'presence', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_presence_connections order by profile_id, connection_id) as row_value),
  'typing', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_typing_connections order by conversation_id, profile_id, connection_id) as row_value),
  'messages', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_messages order by id) as row_value),
  'tasks', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_tasks order by id) as row_value),
  'pins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_pins order by conversation_id, message_id) as row_value),
  'reactions', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_reactions order by message_id, reactor_profile_id, reaction_code) as row_value),
  'admins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversation_admins order by conversation_id, profile_id) as row_value)
)
union all
select 'audit', coalesce((select jsonb_agg(to_jsonb(snapshot_row)) from (select * from public.security_audit_events order by id) as snapshot_row), '[]'::jsonb);

select has_function(
  'public',
  'app_list_team_supervised_conversations',
  array['integer', 'timestamp with time zone', 'uuid'],
  'the dedicated supervisory list RPC exists'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)'::regprocedure),
  'the list RPC is SECURITY DEFINER'
);

select is(
  (select provolatile from pg_proc
   where oid = 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)'::regprocedure),
  's'::"char",
  'the pure list RPC is STABLE'
);

select ok(
  'search_path=""' = any (
    select unnest(proconfig) from pg_proc
    where oid = 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)'::regprocedure
  ),
  'the list RPC fixes an empty search_path'
);

select is(
  (select proargnames[1:3] from pg_proc
   where oid = 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)'::regprocedure),
  array['p_limit', 'p_before_last_message_at', 'p_before_conversation_id'],
  'the RPC accepts pagination only, with no actor or profile identity argument'
);

select is(
  (select count(*) from pg_proc as function_row,
    lateral aclexplode(function_row.proacl) as acl
   where function_row.oid = 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)'::regprocedure
     and acl.grantee = 0
     and acl.privilege_type = 'EXECUTE'),
  0::bigint,
  'PUBLIC has no EXECUTE grant'
);

select ok(
  has_function_privilege('authenticated', 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_list_team_supervised_conversations(integer,timestamptz,uuid)', 'EXECUTE'),
  'only authenticated receives the repository-standard API execution grant'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name like 'team_%'
     and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role received a direct Team table grant'
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
  'all Team tables retain enabled and forced RLS'
);

select pg_temp.become('7f300000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  'Owner can list supervised conversation metadata'
);
select ok(
  exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000001'
  ),
  'a supervisor who is not a member can list an eligible direct conversation'
);
reset role;

select pg_temp.become('7f300000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  'Admin can list supervised conversation metadata'
);
reset role;

select pg_temp.become('7f300000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  '42501', null,
  'Manager is denied by default'
);
reset role;

select pg_temp.become('7f300000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  '42501', null,
  'Staff is denied'
);
reset role;

select pg_temp.become('7f300000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  '42501', null,
  'Client is denied'
);
reset role;

select pg_temp.become('7f300000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  '42501', null,
  'an archived supervisor is denied'
);
reset role;

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('7f300000-0000-4000-8000-000000000002', 'team_messages.supervise', false);

select pg_temp.become('7f300000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  '42501', null,
  'an Admin explicit deny blocks the list RPC'
);
reset role;

delete from public.profile_permission_overrides
where profile_id = '7f300000-0000-4000-8000-000000000002'
  and permission_key = 'team_messages.supervise';

select pg_temp.become('7f300000-0000-4000-8000-000000000001');

select ok(
  exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000001'
  ),
  'a valid internal direct conversation is returned'
);

select ok(
  not exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000002'
  ),
  'group conversations are excluded by the database boundary'
);

select ok(
  not exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000003'
  ),
  'a mixed internal/client direct shape is excluded'
);

select ok(
  not exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000004'
  ),
  'a direct conversation with one member is excluded'
);

select ok(
  not exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000005'
  ),
  'a direct conversation with three members is excluded'
);

select ok(
  exists (
    select 1 from public.app_list_team_supervised_conversations(100)
    where conversation_id = '7f310000-0000-4000-8000-000000000006'
      and participant_two_name = 'Former Staff'
      and participant_two_archived
  ),
  'historical internal pairs remain identifiable with bounded archived status'
);

select is(
  (select count(*) from public.app_list_team_supervised_conversations(100)
   where conversation_kind <> 'direct'),
  0::bigint,
  'every returned row is direct'
);

select is(
  (select count(*)
   from public.app_list_team_supervised_conversations(1) as list_row
   cross join lateral jsonb_object_keys(to_jsonb(list_row)) as key_name),
  12::bigint,
  'the neutral DTO contains only the twelve approved metadata fields'
);

select is(
  (select count(*)
   from public.app_list_team_supervised_conversations(1) as list_row,
        lateral jsonb_object_keys(to_jsonb(list_row)) as key_name
   where key_name ~ '(message|preview|unread|read_at|delivery|notification|presence|typing|capabilit|permission|voice|signed|source|task|reaction|pin)'),
  1::bigint,
  'the only message-related DTO key is the approved last_message_at chronology field'
);

select ok(
  not exists (
    select 1 from public.app_list_team_supervised_conversations(100) as list_row
    where to_jsonb(list_row)::text like '%SUPERVISION_LIST_MUST_NOT_EXPOSE_THIS_BODY%'
  ),
  'message body content is not exposed'
);

select is(
  (select count(*) from public.app_list_team_supervised_conversations(10000)),
  100::bigint,
  'the server clamps an arbitrarily large requested page to 100 rows'
);

select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10, now(), null)$$,
  '22023', null,
  'a timestamp cursor without its conversation id fails closed'
);

select is(
  (select conversation_id from public.app_list_team_supervised_conversations(1)),
  '7f310000-0000-4000-8000-000000000006'::uuid,
  'equal timestamps use descending conversation id as the deterministic tie-breaker'
);

select is(
  (
    with first_page as (
      select * from public.app_list_team_supervised_conversations(1)
    )
    select second_page.conversation_id
    from first_page
    cross join lateral public.app_list_team_supervised_conversations(
      1, first_page.last_message_at, first_page.conversation_id
    ) as second_page
  ),
  '7f310000-0000-4000-8000-000000000001'::uuid,
  'the next keyset page starts exactly after the prior boundary'
);

select is(
  (
    with first_page as (
      select * from public.app_list_team_supervised_conversations(25)
    ), cursor_row as (
      select * from first_page
      order by last_message_at asc nulls first, conversation_id asc
      limit 1
    ), second_page as (
      select next_page.*
      from cursor_row
      cross join lateral public.app_list_team_supervised_conversations(
        25, cursor_row.last_message_at, cursor_row.conversation_id
      ) as next_page
    )
    select count(*) from first_page join second_page using (conversation_id)
  ),
  0::bigint,
  'adjacent keyset pages do not duplicate conversations'
);

set local role service_role;
select throws_ok(
  $$select * from public.app_list_team_supervised_conversations(10)$$,
  '42501', null,
  'service_role has no direct RPC shortcut'
);
reset role;

select is(
  (select payload from supervision_state_before where state_name = 'members'),
  (select coalesce(jsonb_agg(to_jsonb(snapshot_row)), '[]'::jsonb)
   from (select * from public.team_conversation_members order by conversation_id, profile_id) as snapshot_row),
  'listing never inserts membership or changes last_read_at'
);

select is(
  (select payload from supervision_state_before where state_name = 'operational'),
  jsonb_build_object(
    'deliveries', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_deliveries order by message_id, recipient_profile_id) as row_value),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.notifications order by id) as row_value),
    'presence', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_presence_connections order by profile_id, connection_id) as row_value),
    'typing', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_typing_connections order by conversation_id, profile_id, connection_id) as row_value),
    'messages', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_messages order by id) as row_value),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_tasks order by id) as row_value),
    'pins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_pins order by conversation_id, message_id) as row_value),
    'reactions', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_reactions order by message_id, reactor_profile_id, reaction_code) as row_value),
    'admins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversation_admins order by conversation_id, profile_id) as row_value)
  ),
  'listing leaves deliveries, notifications, presence, typing, messages, tasks, pins, reactions, and governance unchanged'
);

select is(
  (select payload from supervision_state_before where state_name = 'audit'),
  coalesce((select jsonb_agg(to_jsonb(snapshot_row)) from (select * from public.security_audit_events order by id) as snapshot_row), '[]'::jsonb),
  'listing appends no security audit row'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'),
  0::bigint,
  'LIST emits no authorization.team_supervision.read event'
);

select ok(
  position('write_team_supervision_audit' in (
    select pg_get_functiondef('public.app_list_team_supervised_conversations(integer,timestamptz,uuid)'::regprocedure)
  )) = 0,
  'the LIST implementation does not call the privileged-content audit writer'
);

select is(
  (select count(*) from public.team_conversation_members
   where conversation_id = '7f310000-0000-4000-8000-000000000001'
     and profile_id in (
       '7f300000-0000-4000-8000-000000000001',
       '7f300000-0000-4000-8000-000000000002'
     )),
  0::bigint,
  'Owner and Admin were never inserted as conversation members'
);

select is(
  (select count(*) from pg_proc as function_row
   join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
   where schema_row.nspname = 'public'
     and function_row.proname in (
       'app_list_team_supervised_messages_before',
       'app_get_team_supervised_message_window',
       'app_search_team_supervised_conversation_messages'
     )),
  0::bigint,
  'no supervisory history, window, pagination, or search RPC exists'
);

select * from finish();
rollback;
