begin;

select plan(76);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('8f400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'page-owner@example.invalid', now(), now()),
  ('8f400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'page-admin@example.invalid', now(), now()),
  ('8f400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'page-manager@example.invalid', now(), now()),
  ('8f400000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'page-staff-a@example.invalid', now(), now()),
  ('8f400000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'page-staff-b@example.invalid', now(), now()),
  ('8f400000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'page-client@example.invalid', now(), now()),
  ('8f400000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'page-archived-admin@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '8f400000-0000-4000-8000-000000000004' then 'Page Alice Staff'
      when '8f400000-0000-4000-8000-000000000005' then 'Page Bob Staff'
      else profile_row.display_name
    end,
    archived_at = case
      when profile_row.id = '8f400000-0000-4000-8000-000000000007' then now()
      else null
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '8f400000-0000-4000-8000-000000000001'::uuid
  when 'admin' then '8f400000-0000-4000-8000-000000000002'::uuid
  when 'manager' then '8f400000-0000-4000-8000-000000000003'::uuid
  when 'staff' then '8f400000-0000-4000-8000-000000000004'::uuid
  when 'client' then '8f400000-0000-4000-8000-000000000006'::uuid
end
or (profile_row.id = '8f400000-0000-4000-8000-000000000005' and role_row.name = 'staff')
or (profile_row.id = '8f400000-0000-4000-8000-000000000007' and role_row.name = 'admin');

insert into public.team_conversations (
  id, conversation_key, created_by_profile_id, kind, title, last_message_at, created_at
)
values
  (
    '8f410000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000004|8f400000-0000-4000-8000-000000000005',
    '8f400000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 10:06:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '8f410000-0000-4000-8000-000000000002',
    'group:8f410000-0000-4000-8000-000000000002',
    '8f400000-0000-4000-8000-000000000004', 'group', 'Page group',
    '2026-09-29 11:00:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '8f410000-0000-4000-8000-000000000003',
    '8f400000-0000-4000-8000-000000000004|8f400000-0000-4000-8000-000000000006',
    '8f400000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 11:01:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '8f410000-0000-4000-8000-000000000004',
    '8f400000-0000-4000-8000-000000000001|8f400000-0000-4000-8000-000000000004',
    '8f400000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 11:02:00+00', '2026-09-01 00:00:00+00'
  );

insert into public.team_conversation_members (conversation_id, profile_id, last_read_at)
values
  ('8f410000-0000-4000-8000-000000000001', '8f400000-0000-4000-8000-000000000004', '2026-09-20 00:00:00+00'),
  ('8f410000-0000-4000-8000-000000000001', '8f400000-0000-4000-8000-000000000005', null),
  ('8f410000-0000-4000-8000-000000000002', '8f400000-0000-4000-8000-000000000004', null),
  ('8f410000-0000-4000-8000-000000000002', '8f400000-0000-4000-8000-000000000005', null),
  ('8f410000-0000-4000-8000-000000000002', '8f400000-0000-4000-8000-000000000003', null),
  ('8f410000-0000-4000-8000-000000000003', '8f400000-0000-4000-8000-000000000004', null),
  ('8f410000-0000-4000-8000-000000000003', '8f400000-0000-4000-8000-000000000006', null),
  ('8f410000-0000-4000-8000-000000000004', '8f400000-0000-4000-8000-000000000001', null),
  ('8f410000-0000-4000-8000-000000000004', '8f400000-0000-4000-8000-000000000004', null);

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
select
  ('8f420000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  ('8f430000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '8f410000-0000-4000-8000-000000000001',
  case when value % 2 = 0
    then '8f400000-0000-4000-8000-000000000004'::uuid
    else '8f400000-0000-4000-8000-000000000005'::uuid end,
  'Page boundary message ' || value,
  '2026-09-29 10:00:00+00'::timestamptz
from generate_series(1, 12) as value;

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at,
  reply_to_message_id, reply_quote_text,
  forwarded_from_message_id, forwarded_from_author_name
)
values
  (
    '8f440000-0000-4000-8000-000000000101',
    '8f450000-0000-4000-8000-000000000101',
    '8f410000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000004',
    'HIDDEN_PAGE_CANONICAL_TEXT', '2026-09-29 10:01:00+00',
    null, null, null, null
  ),
  (
    '8f440000-0000-4000-8000-000000000102',
    '8f450000-0000-4000-8000-000000000102',
    '8f410000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000004',
    'DELETED_PAGE_ORIGINAL_MUST_NOT_RETURN', '2026-09-29 10:02:00+00',
    null, null, null, null
  ),
  (
    '8f440000-0000-4000-8000-000000000104',
    '8f450000-0000-4000-8000-000000000104',
    '8f410000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000005',
    'Page reply body', '2026-09-29 10:04:00+00',
    '8f440000-0000-4000-8000-000000000101', 'HIDDEN_PAGE_CANONICAL_TEXT',
    null, null
  ),
  (
    '8f440000-0000-4000-8000-000000000105',
    '8f450000-0000-4000-8000-000000000105',
    '8f410000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000005',
    'Page forwarded body', '2026-09-29 10:05:00+00',
    null, null,
    '8f440000-0000-4000-8000-000000000101', 'Page Alice Staff'
  ),
  (
    '8f440000-0000-4000-8000-000000000106',
    '8f450000-0000-4000-8000-000000000106',
    '8f410000-0000-4000-8000-000000000001',
    '8f400000-0000-4000-8000-000000000005',
    'Page cursor sentinel', '2026-09-29 10:06:00+00',
    null, null, null, null
  );

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, message_type,
  created_at, voice_storage_path, voice_duration_ms, voice_size_bytes,
  voice_mime_type, voice_expires_at
)
values (
  '8f440000-0000-4000-8000-000000000103',
  '8f450000-0000-4000-8000-000000000103',
  '8f410000-0000-4000-8000-000000000001',
  '8f400000-0000-4000-8000-000000000005',
  'VOICE_PAGE_ORIGINAL_MUST_NOT_RETURN', 'voice', '2026-09-29 10:03:00+00',
  'team/private-page-secret.webm', 4200, 2048, 'audio/webm', '2026-10-29 10:03:00+00'
);

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
select
  ('8f460000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  ('8f470000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '8f410000-0000-4000-8000-000000000001',
  case when value % 2 = 0
    then '8f400000-0000-4000-8000-000000000004'::uuid
    else '8f400000-0000-4000-8000-000000000005'::uuid end,
  'Older bounded message ' || value,
  '2026-09-29 09:00:00+00'::timestamptz + value * interval '1 second'
from generate_series(1, 205) as value;

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
values
  (
    '8f440000-0000-4000-8000-000000000201',
    '8f450000-0000-4000-8000-000000000201',
    '8f410000-0000-4000-8000-000000000004',
    '8f400000-0000-4000-8000-000000000001',
    'OTHER_DIRECT_CONVERSATION_TARGET', '2026-09-29 11:02:00+00'
  ),
  (
    '8f440000-0000-4000-8000-000000000202',
    '8f450000-0000-4000-8000-000000000202',
    '8f410000-0000-4000-8000-000000000002',
    '8f400000-0000-4000-8000-000000000004',
    'GROUP_TARGET_MUST_NOT_CROSS_BOUNDARY', '2026-09-29 11:00:00+00'
  );

insert into public.team_message_hidden_for_profiles (message_id, profile_id)
values (
  '8f440000-0000-4000-8000-000000000101',
  '8f400000-0000-4000-8000-000000000004'
);

insert into public.team_message_reactions (message_id, reactor_profile_id, reaction_code)
values
  ('8f440000-0000-4000-8000-000000000101', '8f400000-0000-4000-8000-000000000004', 'like'),
  ('8f440000-0000-4000-8000-000000000101', '8f400000-0000-4000-8000-000000000005', 'like');

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

-- Establish the canonical tombstone through the ordinary participant RPC.
select pg_temp.become('8f400000-0000-4000-8000-000000000004');
set local role authenticated;
select public.app_delete_team_message_for_everyone('8f440000-0000-4000-8000-000000000102');
reset role;

create temp table supervision_state_before (payload jsonb not null) on commit drop;
insert into supervision_state_before
select jsonb_build_object(
  'conversations', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversations order by id) as row_value),
  'members', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversation_members order by conversation_id, profile_id) as row_value),
  'deliveries', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_deliveries order by message_id, recipient_profile_id) as row_value),
  'notifications', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.notifications order by id) as row_value),
  'presence', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_presence_connections order by profile_id, connection_id) as row_value),
  'typing', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_typing_connections order by conversation_id, profile_id, connection_id) as row_value),
  'messages', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_messages order by id) as row_value),
  'tasks', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_tasks order by id) as row_value),
  'pins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_pins order by conversation_id, message_id) as row_value),
  'reactions', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_reactions order by message_id, reactor_profile_id, reaction_code) as row_value),
  'admins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversation_admins order by conversation_id, profile_id) as row_value),
  'hidden', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_hidden_for_profiles order by message_id, profile_id) as row_value)
);

create temp table page_audit_before (count bigint not null) on commit drop;
insert into page_audit_before
select count(*)
from public.security_audit_events
where event_code = 'authorization.team_supervision.read'
  and action_slug = 'team.supervision.page';

select has_function(
  'public', 'app_list_team_supervised_messages_before',
  array['uuid', 'timestamp with time zone', 'uuid', 'integer', 'text'],
  'the supervisory history RPC exists'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)'::regprocedure),
  'the history RPC is SECURITY DEFINER'
);

select is(
  (select provolatile from pg_proc
   where oid = 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)'::regprocedure),
  'v'::"char", 'the audited history RPC is VOLATILE'
);

select ok(
  'search_path=""' = any (
    select unnest(proconfig) from pg_proc
    where oid = 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)'::regprocedure
  ),
  'the history RPC fixes an empty search_path'
);

select is(
  (select proargnames from pg_proc
   where oid = 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)'::regprocedure),
  array['p_conversation_id', 'p_before_created_at', 'p_before_message_id', 'p_limit', 'p_correlation_id'],
  'history accepts the detail cursor and optional correlation only'
);

select is(
  (select count(*) from pg_proc as function_row,
    lateral aclexplode(function_row.proacl) as acl
   where function_row.oid = 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)'::regprocedure
     and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0::bigint, 'PUBLIC has no history EXECUTE grant'
);

select ok(
  has_function_privilege('authenticated', 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_list_team_supervised_messages_before(uuid,timestamptz,uuid,integer,text)', 'EXECUTE'),
  'only authenticated receives the history RPC grant'
);

select has_function(
  'public', 'app_get_team_supervised_message_window',
  array['uuid', 'uuid', 'integer', 'integer', 'text'],
  'the supervisory message-window RPC exists'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)'::regprocedure),
  'the message-window RPC is SECURITY DEFINER'
);

select is(
  (select provolatile from pg_proc
   where oid = 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)'::regprocedure),
  'v'::"char", 'the audited message-window RPC is VOLATILE'
);

select ok(
  'search_path=""' = any (
    select unnest(proconfig) from pg_proc
    where oid = 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)'::regprocedure
  ),
  'the message-window RPC fixes an empty search_path'
);

select is(
  (select proargnames from pg_proc
   where oid = 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)'::regprocedure),
  array['p_conversation_id', 'p_target_message_id', 'p_before_limit', 'p_after_limit', 'p_correlation_id'],
  'message-window accepts a target, bounded sides and optional correlation only'
);

select is(
  (select count(*) from pg_proc as function_row,
    lateral aclexplode(function_row.proacl) as acl
   where function_row.oid = 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)'::regprocedure
     and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0::bigint, 'PUBLIC has no message-window EXECUTE grant'
);

select ok(
  has_function_privilege('authenticated', 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_get_team_supervised_message_window(uuid,uuid,integer,integer,text)', 'EXECUTE'),
  'only authenticated receives the message-window RPC grant'
);

select ok(
  not has_function_privilege('anon', 'private.team_supervision_direct_conversation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.team_supervision_direct_conversation(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.team_supervision_direct_conversation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.team_supervision_message_json(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.team_supervision_message_json(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.team_supervision_message_json(uuid)', 'EXECUTE'),
  'private validation and projection helpers have no API execution grant'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'team_%'
     and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint, 'no API role received a direct Team table grant'
);

select ok(
  not exists (
    select 1 from pg_class as table_row
    join pg_namespace as schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public' and table_row.relkind = 'r'
      and table_row.relname like 'team_%'
      and (not table_row.relrowsecurity or not table_row.relforcerowsecurity)
  ),
  'all Team tables retain enabled and forced RLS'
);

-- Authorization matrix and non-member success paths.
select pg_temp.become('8f400000-0000-4000-8000-000000000001');
set local role authenticated;
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  '2026-09-29 10:06:00+00', '8f440000-0000-4000-8000-000000000106', 1
);
reset role;

select pg_temp.become('8f400000-0000-4000-8000-000000000002');
set local role authenticated;
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  '2026-09-29 10:06:00+00', '8f440000-0000-4000-8000-000000000106', 1
);
reset role;

select pg_temp.become('8f400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', now(), gen_random_uuid())$$,
  '42501', null, 'Manager cannot page supervised history'
);
reset role;

select pg_temp.become('8f400000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', now(), gen_random_uuid())$$,
  '42501', null, 'Staff cannot page supervised history'
);
reset role;

select pg_temp.become('8f400000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', now(), gen_random_uuid())$$,
  '42501', null, 'Client cannot page supervised history'
);
reset role;

select pg_temp.become('8f400000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', now(), gen_random_uuid())$$,
  '42501', null, 'archived Admin cannot page supervised history'
);
reset role;

-- Wolf Forge overrides; written as a trusted fixture, so the Tenant is explicit.
insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
values (private.wolf_forge_tenant_id(), '8f400000-0000-4000-8000-000000000002', 'team_messages.supervise', false);

select pg_temp.become('8f400000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', now(), gen_random_uuid())$$,
  '42501', null, 'Admin explicit deny blocks supervised history'
);
reset role;

delete from public.profile_permission_overrides
where profile_id = '8f400000-0000-4000-8000-000000000002'
  and permission_key = 'team_messages.supervise';

select pg_temp.become('8f400000-0000-4000-8000-000000000001');
set local role authenticated;
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000101', 0, 0
);
reset role;

select is(
  (select count(*) from public.team_conversation_members
   where conversation_id = '8f410000-0000-4000-8000-000000000001'
     and profile_id in ('8f400000-0000-4000-8000-000000000001', '8f400000-0000-4000-8000-000000000002')),
  0::bigint, 'supervisors remain non-members after successful history/window reads'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.page'),
  (select count + 3 from page_audit_before),
  'Owner history, Admin history and Owner window each append one PAGE audit'
);

create temp table open_result (payload jsonb not null) on commit drop;
grant insert on open_result to authenticated;
select pg_temp.become('8f400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into open_result
select public.app_get_team_supervised_conversation(
  '8f410000-0000-4000-8000-000000000001', 1, repeat('a', 32)
);
reset role;

select is(
  jsonb_array_length((select payload -> 'messages' from open_result)),
  1, 'the existing detail cursor source returns one latest sentinel'
);

select is(
  (select payload ->> 'next_before_message_id' from open_result),
  '8f440000-0000-4000-8000-000000000106',
  'history consumes the exact cursor emitted by detail'
);

create temp table history_page_one (payload jsonb not null) on commit drop;
create temp table history_page_two (payload jsonb not null) on commit drop;
create temp table history_page_three (payload jsonb not null) on commit drop;
create temp table history_page_four (payload jsonb not null) on commit drop;
create temp table history_page_max (payload jsonb not null) on commit drop;
create temp table history_page_min (payload jsonb not null) on commit drop;
grant insert on history_page_one, history_page_two, history_page_three,
  history_page_four, history_page_max, history_page_min to authenticated;

insert into history_page_one
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  (select (payload ->> 'next_before_created_at')::timestamptz from open_result),
  (select (payload ->> 'next_before_message_id')::uuid from open_result),
  5, repeat('b', 32)
);

select is(
  jsonb_array_length((select payload -> 'messages' from history_page_one)),
  5, 'history returns the bounded page size'
);

select is(
  (select payload -> 'messages' -> 0 ->> 'message_id' from history_page_one),
  '8f440000-0000-4000-8000-000000000101',
  'history returns its selected page in chronological order'
);

select is(
  (select payload -> 'messages' -> 4 ->> 'message_id' from history_page_one),
  '8f440000-0000-4000-8000-000000000105',
  'history ends at the message immediately before the detail cursor'
);

select ok(
  (select (payload ->> 'has_more')::boolean from history_page_one)
  and (select payload -> 'next_before_created_at' is not null from history_page_one)
  and (select payload -> 'next_before_message_id' is not null from history_page_one),
  'history reports more rows and emits its oldest returned cursor'
);

select ok(
  not exists (
    select 1 from history_page_one,
      lateral jsonb_array_elements(payload -> 'messages') as message
    where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000106'
  ),
  'history uses a strict earlier-than boundary with no duplicate cursor item'
);

insert into history_page_two
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  (select (payload ->> 'next_before_created_at')::timestamptz from history_page_one),
  (select (payload ->> 'next_before_message_id')::uuid from history_page_one),
  5
);

select is(
  (select payload -> 'messages' -> 0 ->> 'message_id' from history_page_two),
  '8f420000-0000-4000-8000-000000000008',
  'same-timestamp keyset pagination selects the nearest older ids'
);

select is(
  (select payload -> 'messages' -> 4 ->> 'message_id' from history_page_two),
  '8f420000-0000-4000-8000-000000000012',
  'same-timestamp page selection has no skipped boundary row'
);

select is(
  (select count(*)
   from (
     select message ->> 'message_id' as message_id
     from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
     union all
     select message ->> 'message_id'
     from history_page_two, lateral jsonb_array_elements(payload -> 'messages') as message
   ) as combined_ids),
  10::bigint, 'adjacent history pages contain no duplicate message ids'
);

insert into history_page_three
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  (select (payload ->> 'next_before_created_at')::timestamptz from history_page_two),
  (select (payload ->> 'next_before_message_id')::uuid from history_page_two),
  5
);

select is(
  (select payload -> 'messages' -> 0 ->> 'message_id' from history_page_three),
  '8f420000-0000-4000-8000-000000000003',
  'the next same-timestamp page begins immediately after the prior boundary'
);

insert into history_page_four
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  (select (payload ->> 'next_before_created_at')::timestamptz from history_page_three),
  (select (payload ->> 'next_before_message_id')::uuid from history_page_three),
  5
);

select is(
  jsonb_array_length((select payload -> 'messages' from history_page_four)),
  5, 'the next page continues to the nearest older rows after the same-timestamp set'
);

select is(
  (select payload -> 'messages' -> 0 ->> 'message_id' from history_page_four),
  '8f460000-0000-4000-8000-000000000203',
  'the older-page boundary remains deterministic after equal timestamps'
);

select is(
  jsonb_array_length((select payload -> 'messages' from history_page_one)),
  5, 'history page result remains stable when revisited through its cursor'
);

insert into history_page_max
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  '2026-09-29 10:06:00+00', '8f440000-0000-4000-8000-000000000106', 10000
);

select is(
  jsonb_array_length((select payload -> 'messages' from history_page_max)),
  100, 'history clamps an arbitrarily large limit to 100'
);

select ok(
  (select (payload ->> 'has_more')::boolean from history_page_max),
  'history has_more remains true when bounded older rows remain'
);

insert into history_page_min
select public.app_list_team_supervised_messages_before(
  '8f410000-0000-4000-8000-000000000001',
  '2026-09-29 10:06:00+00', '8f440000-0000-4000-8000-000000000106', -10
);

select is(
  jsonb_array_length((select payload -> 'messages' from history_page_min)),
  1, 'history clamps non-positive limits to one message'
);

select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', null, gen_random_uuid())$$,
  '22023', 'message cursor requires created_at and message_id',
  'an incomplete history cursor fails closed'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.page'),
  (select count + 9 from page_audit_before),
  'invalid cursor adds no successful PAGE audit'
);

select is(
  (select count(*) from jsonb_object_keys(
    (select payload -> 'messages' -> 0 from history_page_one)
  )),
  17::bigint, 'history message DTO has the same 17 neutral fields as detail'
);

select is(
  (select count(*) from jsonb_object_keys((select payload from history_page_one))),
  9::bigint, 'history envelope preserves the detail contract field count'
);

select is(
  (select message ->> 'body'
   from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000102'),
  'Message deleted', 'deleted history rows expose only the tombstone body'
);

select ok(
  (select payload::text not like '%DELETED_PAGE_ORIGINAL_MUST_NOT_RETURN%' from history_page_one)
  and (select message ->> 'deleted_by_profile_id' = '8f400000-0000-4000-8000-000000000004'
       from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
       where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000102'),
  'deleted history preserves safe deletion metadata without recovery'
);

select is(
  (select message ->> 'body'
   from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000103'),
  'Voice message', 'history voice rows use the neutral body'
);

select is(
  (select message ->> 'supervisory_notice'
   from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000103'),
  'Unavailable in supervisory view', 'history voice rows advertise no playback capability'
);

select ok(
  (select payload::text not like '%team/private-page-secret.webm%'
      and payload::text not like '%VOICE_PAGE_ORIGINAL_MUST_NOT_RETURN%' from history_page_one),
  'history does not expose voice storage or original body data'
);

select is(
  (select (message -> 'reactions' -> 0 ->> 'reaction_count')::integer
   from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000101'),
  2, 'history keeps neutral aggregate reaction counts'
);

select ok(
  (select message -> 'reply' ->> 'body' = 'HIDDEN_PAGE_CANONICAL_TEXT'
      and message -> 'reply' ->> 'author_name' = 'Page Alice Staff'
   from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000104')
  and (select message ->> 'forwarded' = 'true'
      and message ->> 'forwarded_from_author_name' = 'Page Alice Staff'
   from history_page_one, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '8f440000-0000-4000-8000-000000000105'),
  'history keeps safe reply and forward display metadata'
);

select is(
  (select count(*)
   from history_page_one,
     lateral jsonb_array_elements(payload -> 'messages') as message,
     lateral jsonb_object_keys(message) as key_name
   where key_name ~ '(request_id|conversation_id|task_id|task_action|source|storage|duration|size|mime|expires|signed|playback|reacted_by_me|reactor_names|unread|read_at|delivery|notification|presence|typing|capabilit|permission)'),
  0::bigint, 'history messages omit state, capabilities, source ids, requests and voice internals'
);

-- Window behavior and target isolation.
create temp table hidden_window (payload jsonb not null) on commit drop;
create temp table deleted_window (payload jsonb not null) on commit drop;
create temp table voice_window (payload jsonb not null) on commit drop;
create temp table max_window (payload jsonb not null) on commit drop;
create temp table cross_window (payload jsonb not null) on commit drop;
create temp table missing_window (payload jsonb not null) on commit drop;
create temp table group_target_window (payload jsonb not null) on commit drop;
grant insert on hidden_window, deleted_window, voice_window, max_window,
  cross_window, missing_window, group_target_window to authenticated;

insert into hidden_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000101', 2, 2, repeat('c', 32)
);

select is(
  (select (payload ->> 'found')::boolean from hidden_window),
  true, 'a valid target in the requested direct conversation is found'
);

select is(
  jsonb_array_length((select payload -> 'messages' from hidden_window)),
  5, 'a window contains the target plus the requested before and after sides'
);

select is(
  (select payload -> 'messages' -> 2 ->> 'message_id' from hidden_window),
  '8f440000-0000-4000-8000-000000000101',
  'the target is in deterministic chronological position'
);

select is(
  (select payload -> 'messages' -> 2 ->> 'body' from hidden_window),
  'HIDDEN_PAGE_CANONICAL_TEXT', 'participant-hidden canonical content remains visible in a window'
);

select ok(
  (select (payload ->> 'has_more_before')::boolean from hidden_window)
  and (select (payload ->> 'has_more_after')::boolean from hidden_window),
  'window reports bounded content remaining on both sides'
);

insert into deleted_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000102', 0, 0, repeat('d', 32)
);

select is(
  jsonb_array_length((select payload -> 'messages' from deleted_window)),
  1, 'zero-side window limits remain bounded to the target'
);

select is(
  (select payload -> 'messages' -> 0 ->> 'body' from deleted_window),
  'Message deleted', 'a deleted target remains a tombstone in the window'
);

insert into voice_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000103', 0, 0
);

select ok(
  (select payload -> 'messages' -> 0 ->> 'body' = 'Voice message'
      and payload -> 'messages' -> 0 ->> 'supervisory_notice' = 'Unavailable in supervisory view'
      and payload::text not like '%team/private-page-secret.webm%' from voice_window),
  'a voice target has only the neutral unavailable representation'
);

insert into max_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000101', 1000, 1000, repeat('e', 32)
);

select is(
  jsonb_array_length((select payload -> 'messages' from max_window)),
  106, 'window clamps each side to 100 and includes only one target'
);

insert into cross_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000201', 5, 5
);

insert into missing_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001', gen_random_uuid(), 5, 5
);

insert into group_target_window
select public.app_get_team_supervised_message_window(
  '8f410000-0000-4000-8000-000000000001',
  '8f440000-0000-4000-8000-000000000202', 5, 5
);

select is(
  (select payload from cross_window),
  (select payload from missing_window),
  'cross-conversation target IDs and nonexistent IDs have the same safe not-found result'
);

select is(
  (select (payload ->> 'found')::boolean from group_target_window),
  false, 'a target from a group cannot cross into a direct window'
);

select pg_temp.become('8f400000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.app_get_team_supervised_message_window('8f410000-0000-4000-8000-000000000002', '8f440000-0000-4000-8000-000000000202', 5, 5)$$,
  'P0002', 'team conversation unavailable', 'a group conversation is denied before target lookup'
);
select throws_ok(
  $$select public.app_get_team_supervised_message_window('8f410000-0000-4000-8000-000000000003', '8f440000-0000-4000-8000-000000000201', 5, 5)$$,
  'P0002', 'team conversation unavailable', 'a mixed client conversation is denied before target lookup'
);
select throws_ok(
  $$select public.app_get_team_supervised_message_window('8f410000-0000-4000-8000-000000000001', '8f440000-0000-4000-8000-000000000101', 5, 5, 'not-a-correlation')$$,
  '22023', 'invalid correlation id', 'an invalid window correlation fails before content audit'
);
reset role;

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.page'),
  (select count + 13 from page_audit_before),
  'each successful history page or window has exactly one PAGE audit and failed reads have none'
);

select is(
  (select metadata from public.security_audit_events
   where correlation_id = repeat('b', 32)),
  '{"read_kind":"page","conversation_kind":"direct","result_count":5}'::jsonb,
  'history PAGE audit metadata contains only bounded non-content fields'
);

select is(
  (select metadata from public.security_audit_events
   where correlation_id = repeat('c', 32)),
  '{"read_kind":"page","conversation_kind":"direct","result_count":5}'::jsonb,
  'window PAGE audit metadata contains only bounded non-content fields'
);

select ok(
  not exists (
    select 1 from public.security_audit_events
    where event_code = 'authorization.team_supervision.read'
      and metadata::text ~ '(HIDDEN_PAGE|DELETED_PAGE|VOICE_PAGE|private-page-secret|query|body|reply|storage)'
  ),
  'PAGE audit metadata contains no body, reply, query or voice-storage content'
);

select ok(
  not exists (
    select 1 from public.security_audit_events
    where event_code = 'authorization.team_supervision.read'
      and action_slug = 'team.supervision.page'
      and actor_profile_id not in (
        '8f400000-0000-4000-8000-000000000001',
        '8f400000-0000-4000-8000-000000000002'
      )
  ),
  'every PAGE audit actor is the authenticated Owner or Admin'
);

create temp table supervision_state_after (payload jsonb not null) on commit drop;
insert into supervision_state_after
select jsonb_build_object(
  'conversations', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversations order by id) as row_value),
  'members', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversation_members order by conversation_id, profile_id) as row_value),
  'deliveries', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_deliveries order by message_id, recipient_profile_id) as row_value),
  'notifications', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.notifications order by id) as row_value),
  'presence', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_presence_connections order by profile_id, connection_id) as row_value),
  'typing', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_typing_connections order by conversation_id, profile_id, connection_id) as row_value),
  'messages', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_messages order by id) as row_value),
  'tasks', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_tasks order by id) as row_value),
  'pins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_pins order by conversation_id, message_id) as row_value),
  'reactions', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_reactions order by message_id, reactor_profile_id, reaction_code) as row_value),
  'admins', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_conversation_admins order by conversation_id, profile_id) as row_value),
  'hidden', (select coalesce(jsonb_agg(to_jsonb(row_value)), '[]'::jsonb) from (select * from public.team_message_hidden_for_profiles order by message_id, profile_id) as row_value)
);

select is(
  (select payload from supervision_state_after),
  (select payload from supervision_state_before),
  'successful history/window reads mutate no Team membership, message, state or governance rows'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.open'),
  1::bigint, 'the detail cursor source emitted only its one OPEN event'
);

set local role service_role;
select throws_ok(
  $$select public.app_list_team_supervised_messages_before('8f410000-0000-4000-8000-000000000001', now(), gen_random_uuid())$$,
  '42501', null, 'service_role has no direct history RPC shortcut'
);
select throws_ok(
  $$select public.app_get_team_supervised_message_window('8f410000-0000-4000-8000-000000000001', '8f440000-0000-4000-8000-000000000101', 1, 1)$$,
  '42501', null, 'service_role has no direct message-window RPC shortcut'
);
reset role;

select * from finish();
rollback;
