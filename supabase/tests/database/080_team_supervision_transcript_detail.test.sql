begin;

select plan(54);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7f400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'detail-owner@example.invalid', now(), now()),
  ('7f400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'detail-admin@example.invalid', now(), now()),
  ('7f400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'detail-manager@example.invalid', now(), now()),
  ('7f400000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'detail-staff-a@example.invalid', now(), now()),
  ('7f400000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'detail-staff-b@example.invalid', now(), now()),
  ('7f400000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'detail-client@example.invalid', now(), now()),
  ('7f400000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'detail-archived-admin@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '7f400000-0000-4000-8000-000000000004' then 'Alice Staff'
      when '7f400000-0000-4000-8000-000000000005' then 'Bob Staff'
      else profile_row.display_name
    end,
    archived_at = case
      when profile_row.id = '7f400000-0000-4000-8000-000000000007' then now()
      else null
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '7f400000-0000-4000-8000-000000000001'::uuid
  when 'admin' then '7f400000-0000-4000-8000-000000000002'::uuid
  when 'manager' then '7f400000-0000-4000-8000-000000000003'::uuid
  when 'staff' then '7f400000-0000-4000-8000-000000000004'::uuid
  when 'client' then '7f400000-0000-4000-8000-000000000006'::uuid
end
or (profile_row.id = '7f400000-0000-4000-8000-000000000005' and role_row.name = 'staff')
or (profile_row.id = '7f400000-0000-4000-8000-000000000007' and role_row.name = 'admin');

insert into public.team_conversations (
  id, conversation_key, created_by_profile_id, kind, title, last_message_at, created_at
)
values
  (
    '7f410000-0000-4000-8000-000000000001',
    '7f400000-0000-4000-8000-000000000004|7f400000-0000-4000-8000-000000000005',
    '7f400000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 10:04:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    '7f410000-0000-4000-8000-000000000002',
    'group:7f410000-0000-4000-8000-000000000002',
    '7f400000-0000-4000-8000-000000000004', 'group', 'Denied group',
    null, '2026-09-01 00:00:00+00'
  ),
  (
    '7f410000-0000-4000-8000-000000000003',
    '7f400000-0000-4000-8000-000000000004|7f400000-0000-4000-8000-000000000006',
    '7f400000-0000-4000-8000-000000000004', 'direct', null,
    null, '2026-09-01 00:00:00+00'
  );

insert into public.team_conversation_members (conversation_id, profile_id, last_read_at)
values
  ('7f410000-0000-4000-8000-000000000001', '7f400000-0000-4000-8000-000000000004', '2026-09-20 00:00:00+00'),
  ('7f410000-0000-4000-8000-000000000001', '7f400000-0000-4000-8000-000000000005', null),
  ('7f410000-0000-4000-8000-000000000002', '7f400000-0000-4000-8000-000000000004', null),
  ('7f410000-0000-4000-8000-000000000002', '7f400000-0000-4000-8000-000000000005', null),
  ('7f410000-0000-4000-8000-000000000003', '7f400000-0000-4000-8000-000000000004', null),
  ('7f410000-0000-4000-8000-000000000003', '7f400000-0000-4000-8000-000000000006', null);

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
select
  ('7f420000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  ('7f430000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '7f410000-0000-4000-8000-000000000001',
  case when value % 2 = 0
    then '7f400000-0000-4000-8000-000000000004'::uuid
    else '7f400000-0000-4000-8000-000000000005'::uuid end,
  'Bounded message ' || value,
  '2026-09-28 00:00:00+00'::timestamptz + value * interval '1 second'
from generate_series(1, 105) as value;

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at,
  reply_to_message_id, reply_quote_text,
  forwarded_from_message_id, forwarded_from_author_name
)
values
  (
    '7f440000-0000-4000-8000-000000000001',
    '7f450000-0000-4000-8000-000000000001',
    '7f410000-0000-4000-8000-000000000001',
    '7f400000-0000-4000-8000-000000000004',
    'HIDDEN_CANONICAL_SUPERVISORY_TEXT', '2026-09-29 10:00:00+00',
    null, null, null, null
  ),
  (
    '7f440000-0000-4000-8000-000000000002',
    '7f450000-0000-4000-8000-000000000002',
    '7f410000-0000-4000-8000-000000000001',
    '7f400000-0000-4000-8000-000000000004',
    'DELETED_ORIGINAL_MUST_NEVER_RETURN', '2026-09-29 10:01:00+00',
    null, null, null, null
  ),
  (
    '7f440000-0000-4000-8000-000000000004',
    '7f450000-0000-4000-8000-000000000004',
    '7f410000-0000-4000-8000-000000000001',
    '7f400000-0000-4000-8000-000000000005',
    'Reply body', '2026-09-29 10:03:00+00',
    '7f440000-0000-4000-8000-000000000001', 'HIDDEN_CANONICAL_SUPERVISORY_TEXT',
    null, null
  ),
  (
    '7f440000-0000-4000-8000-000000000005',
    '7f450000-0000-4000-8000-000000000005',
    '7f410000-0000-4000-8000-000000000001',
    '7f400000-0000-4000-8000-000000000005',
    'Forwarded display body', '2026-09-29 10:04:00+00',
    null, null,
    '7f440000-0000-4000-8000-000000000001', 'Alice Staff'
  );

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, message_type,
  created_at, voice_storage_path, voice_duration_ms, voice_size_bytes,
  voice_mime_type, voice_expires_at
)
values (
  '7f440000-0000-4000-8000-000000000003',
  '7f450000-0000-4000-8000-000000000003',
  '7f410000-0000-4000-8000-000000000001',
  '7f400000-0000-4000-8000-000000000005',
  'VOICE_ORIGINAL_BODY_MUST_NOT_RETURN', 'voice', '2026-09-29 10:02:00+00',
  'team/secret-object.webm', 4200, 2048, 'audio/webm', '2026-10-29 10:02:00+00'
);

insert into public.team_message_hidden_for_profiles (message_id, profile_id)
values (
  '7f440000-0000-4000-8000-000000000001',
  '7f400000-0000-4000-8000-000000000004'
);

insert into public.team_message_reactions (message_id, reactor_profile_id, reaction_code)
values
  ('7f440000-0000-4000-8000-000000000001', '7f400000-0000-4000-8000-000000000004', 'like'),
  ('7f440000-0000-4000-8000-000000000001', '7f400000-0000-4000-8000-000000000005', 'like');

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

-- Use the real participant mutation once to establish the canonical tombstone.
select pg_temp.become('7f400000-0000-4000-8000-000000000004');
set local role authenticated;
select public.app_delete_team_message_for_everyone('7f440000-0000-4000-8000-000000000002');
reset role;

create temp table detail_state_before (payload jsonb not null) on commit drop;
insert into detail_state_before
select jsonb_build_object(
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

select has_function(
  'public', 'app_get_team_supervised_conversation',
  array['uuid', 'integer', 'text'],
  'the dedicated supervisory detail RPC exists'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure),
  'the detail RPC is SECURITY DEFINER'
);

select is(
  (select provolatile from pg_proc
   where oid = 'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure),
  'v'::"char",
  'the audited detail RPC is VOLATILE'
);

select ok(
  'search_path=""' = any (
    select unnest(proconfig) from pg_proc
    where oid = 'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure
  ),
  'the detail RPC fixes an empty search_path'
);

select is(
  (select proargnames from pg_proc
   where oid = 'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure),
  array['p_conversation_id', 'p_limit', 'p_correlation_id'],
  'the RPC accepts no actor or profile authority argument'
);

select is(
  (select count(*) from pg_proc as function_row,
    lateral aclexplode(function_row.proacl) as acl
   where function_row.oid = 'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure
     and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0::bigint,
  'PUBLIC has no EXECUTE grant'
);

select ok(
  has_function_privilege('authenticated', 'public.app_get_team_supervised_conversation(uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_get_team_supervised_conversation(uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_get_team_supervised_conversation(uuid,integer,text)', 'EXECUTE'),
  'only authenticated receives the repository-standard API execution grant'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'team_%'
     and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role received a direct Team table grant'
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

select pg_temp.become('7f400000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  'Owner can open an eligible direct transcript as a non-member'
);
reset role;

select pg_temp.become('7f400000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  'Admin can open an eligible direct transcript as a non-member'
);
reset role;

select pg_temp.become('7f400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Manager is denied by default'
);
reset role;

select pg_temp.become('7f400000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Staff is denied'
);
reset role;

select pg_temp.become('7f400000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Client is denied'
);
reset role;

select pg_temp.become('7f400000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  '42501', null, 'an archived supervisor is denied'
);
reset role;

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('7f400000-0000-4000-8000-000000000002', 'team_messages.supervise', false);

select pg_temp.become('7f400000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  '42501', null, 'an Admin explicit deny blocks transcript access'
);
reset role;

delete from public.profile_permission_overrides
where profile_id = '7f400000-0000-4000-8000-000000000002'
  and permission_key = 'team_messages.supervise';

select pg_temp.become('7f400000-0000-4000-8000-000000000001');
set local role authenticated;

select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000002')$$,
  'P0002', 'team conversation unavailable', 'an explicit group UUID is denied'
);

select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000003')$$,
  'P0002', 'team conversation unavailable', 'a mixed internal/client direct UUID is denied'
);

select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000099')$$,
  'P0002', 'team conversation unavailable', 'a nonexistent UUID fails with the same safe error'
);

reset role;

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.open'),
  2::bigint,
  'denied and invalid opens append no successful OPEN audit event'
);

create temp table detail_result (payload jsonb not null) on commit drop;
insert into detail_result
select public.app_get_team_supervised_conversation(
  '7f410000-0000-4000-8000-000000000001', 50, repeat('a', 32)
);

select is(
  (select payload ->> 'conversation_kind' from detail_result),
  'direct', 'the detail identifies the direct conversation neutrally'
);

select is(
  (select jsonb_array_length(payload -> 'participants') from detail_result),
  2, 'the neutral conversation DTO contains exactly two participants'
);

select is(
  (select jsonb_array_length(payload -> 'messages') from detail_result),
  50, 'the default initial transcript contains 50 messages'
);

select is(
  jsonb_array_length(public.app_get_team_supervised_conversation(
    '7f410000-0000-4000-8000-000000000001', 10000, null
  ) -> 'messages'),
  100, 'the server clamps an arbitrarily large initial request to 100 messages'
);

select ok(
  (select (payload ->> 'has_more')::boolean from detail_result),
  'the bounded result reports older messages'
);

select ok(
  (select payload -> 'next_before_created_at' is not null
      and payload -> 'next_before_message_id' is not null from detail_result),
  'the bounded result provides the future history cursor pair'
);

select ok(
  (select payload ->> 'next_before_created_at' = payload -> 'messages' -> 0 ->> 'created_at'
      and payload ->> 'next_before_message_id' = payload -> 'messages' -> 0 ->> 'message_id'
   from detail_result),
  'the future history cursor is the oldest returned message boundary'
);

select ok(
  not exists (
    select 1
    from detail_result,
      lateral jsonb_array_elements(payload -> 'messages') with ordinality as current_row(message, position)
    join lateral jsonb_array_elements(payload -> 'messages') with ordinality as prior_row(message, position)
      on prior_row.position = current_row.position - 1
    where (current_row.message ->> 'created_at', current_row.message ->> 'message_id')
        < (prior_row.message ->> 'created_at', prior_row.message ->> 'message_id')
  ),
  'messages are deterministically ordered by created_at then message id ascending'
);

select ok(
  (select payload::text like '%HIDDEN_CANONICAL_SUPERVISORY_TEXT%' from detail_result),
  'participant-hidden canonical text remains visible to authorized supervision'
);

select is(
  (select message ->> 'body'
   from detail_result, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '7f440000-0000-4000-8000-000000000002'),
  'Message deleted', 'a deleted message exposes only the canonical tombstone body'
);

select ok(
  (select payload::text not like '%DELETED_ORIGINAL_MUST_NEVER_RETURN%' from detail_result),
  'the deleted original body is not recoverable from the supervisory DTO'
);

select ok(
  (select (message ->> 'deleted_for_everyone')::boolean
      and message -> 'deleted_for_everyone_at' is not null
      and message ->> 'deleted_by_profile_id' = '7f400000-0000-4000-8000-000000000004'
   from detail_result, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '7f440000-0000-4000-8000-000000000002'),
  'the tombstone includes only its safe deletion state and deleting identity'
);

select is(
  (select message ->> 'body'
   from detail_result, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '7f440000-0000-4000-8000-000000000003'),
  'Voice message', 'voice rows receive a neutral supervisory representation'
);

select is(
  (select message ->> 'supervisory_notice'
   from detail_result, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '7f440000-0000-4000-8000-000000000003'),
  'Unavailable in supervisory view', 'voice playback is explicitly unavailable'
);

select ok(
  (select payload::text not like '%team/secret-object.webm%'
      and payload::text not like '%VOICE_ORIGINAL_BODY_MUST_NOT_RETURN%' from detail_result),
  'voice storage and underlying body data do not leak'
);

select is(
  (select (message -> 'reactions' -> 0 ->> 'reaction_count')::integer
   from detail_result, lateral jsonb_array_elements(payload -> 'messages') as message
   where message ->> 'message_id' = '7f440000-0000-4000-8000-000000000001'),
  2, 'reactions are neutral aggregate counts only'
);

select ok(
  (select payload::text like '%"forwarded": true%'
      and payload::text like '%"forwarded_from_author_name": "Alice Staff"%' from detail_result),
  'forwarding exposes only safe display provenance'
);

select is(
  (select count(*)
   from detail_result,
     lateral jsonb_array_elements(payload -> 'messages') as message,
     lateral jsonb_object_keys(message) as key_name
   where key_name ~ '(request_id|conversation_id|task_id|task_action|source|storage|duration|size|mime|expires|signed|playback|reacted_by_me|reactor_names|unread|read_at|delivery|notification|presence|typing|capabilit|permission)'),
  0::bigint,
  'message DTOs omit participant state, capabilities, source IDs, requests, tasks, and voice internals'
);

select is(
  (select count(*)
   from detail_result, lateral jsonb_object_keys(payload) as key_name
   where key_name ~ '(unread|read_at|delivery|notification|presence|typing|capabilit|permission|task|pin|admin|owner)'),
  0::bigint,
  'the conversation DTO omits participant and governance state'
);

select is(
  (select count(*) from public.team_conversation_members
   where conversation_id = '7f410000-0000-4000-8000-000000000001'
     and profile_id in (
       '7f400000-0000-4000-8000-000000000001',
       '7f400000-0000-4000-8000-000000000002'
     )),
  0::bigint, 'supervisors remain non-members after transcript access'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.open'
     and resource_type = 'team_conversation'
     and resource_id = '7f410000-0000-4000-8000-000000000001'),
  4::bigint, 'each of the four successful explicit opens produced exactly one OPEN event'
);

select is(
  (select metadata from public.security_audit_events
   where correlation_id = repeat('a', 32)),
  '{"read_kind":"open","conversation_kind":"direct","result_count":50}'::jsonb,
  'the OPEN audit stores only bounded non-content metadata with the result count'
);

select ok(
  not exists (
    select 1 from public.security_audit_events
    where event_code = 'authorization.team_supervision.read'
      and metadata::text ~ '(HIDDEN_CANONICAL|DELETED_ORIGINAL|VOICE_ORIGINAL|secret-object|search)'
  ),
  'audit metadata contains no message, query, or voice-storage content'
);

select throws_ok(
  $$select public.app_get_team_supervised_conversation(
    '7f410000-0000-4000-8000-000000000001', 10, 'message body smuggling'
  )$$,
  '22023', 'invalid correlation id', 'invalid correlation fails the entire open atomically'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.open'),
  4::bigint, 'a failed audited open leaves no false successful-read event'
);

reset role;

select pg_temp.become('7f400000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.app_get_team_conversation('7f410000-0000-4000-8000-000000000001') -> 'messages'
    ) as message
    where message ->> 'id' = '7f440000-0000-4000-8000-000000000001'
  ),
  'ordinary participant hide-for-me behavior remains unchanged'
);
reset role;

select is(
  (select payload from detail_state_before),
  jsonb_build_object(
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
  ),
  'detail access changes no Team operational state, including hidden rows and last_read_at'
);

set local role service_role;
select throws_ok(
  $$select public.app_get_team_supervised_conversation('7f410000-0000-4000-8000-000000000001')$$,
  '42501', null, 'service_role has no direct RPC shortcut'
);
reset role;

select is(
  (select count(*) from pg_proc as function_row
   join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
   where schema_row.nspname = 'public'
      and function_row.proname = 'app_search_team_supervised_conversation_messages'),
  0::bigint,
  'the supervisory search RPC remains absent'
);

select is(
  (select count(*) from public.security_audit_events
   where event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.open'
     and actor_profile_id not in (
       '7f400000-0000-4000-8000-000000000001',
       '7f400000-0000-4000-8000-000000000002'
     )),
  0::bigint, 'every OPEN event actor is the authenticated Owner or Admin'
);

select ok(
  (select pg_get_functiondef(
    'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure
  ) not like '%team_message_hidden_for_profiles%'),
  'the supervisory projection does not apply participant hidden-for-me filtering'
);

select ok(
  (select pg_get_functiondef(
    'public.app_get_team_supervised_conversation(uuid,integer,text)'::regprocedure
  ) not like '%app_get_team_conversation(%'),
  'the detail RPC does not reuse the membership-gated participant projection'
);

select is(
  (select count(*) from jsonb_object_keys(
    (select payload -> 'messages' -> 0 from detail_result)
  )),
  17::bigint, 'the neutral message DTO has only the approved bounded fields'
);

select is(
  (select count(*) from jsonb_object_keys((select payload from detail_result))),
  9::bigint, 'the neutral conversation envelope has only nine fields'
);

select * from finish();
rollback;
