begin;

select plan(71);

create temp table supervision_audit_before on commit drop as
select id from public.security_audit_events;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('9f400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'search-owner@example.invalid', now(), now()),
  ('9f400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'search-admin@example.invalid', now(), now()),
  ('9f400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'search-manager@example.invalid', now(), now()),
  ('9f400000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'search-staff-a@example.invalid', now(), now()),
  ('9f400000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'search-staff-b@example.invalid', now(), now()),
  ('9f400000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'search-client@example.invalid', now(), now()),
  ('9f400000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'search-archived-admin@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '9f400000-0000-4000-8000-000000000004' then 'Search Alice Staff'
      when '9f400000-0000-4000-8000-000000000005' then 'Search Bob Staff'
      else profile_row.display_name
    end,
    archived_at = case
      when profile_row.id = '9f400000-0000-4000-8000-000000000007' then now()
      else null
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '9f400000-0000-4000-8000-000000000001'::uuid
  when 'admin' then '9f400000-0000-4000-8000-000000000002'::uuid
  when 'manager' then '9f400000-0000-4000-8000-000000000003'::uuid
  when 'staff' then '9f400000-0000-4000-8000-000000000004'::uuid
  when 'client' then '9f400000-0000-4000-8000-000000000006'::uuid
end
or (profile_row.id = '9f400000-0000-4000-8000-000000000005' and role_row.name = 'staff')
or (profile_row.id = '9f400000-0000-4000-8000-000000000007' and role_row.name = 'admin');

insert into public.team_conversations (
  tenant_id, id, conversation_key, created_by_profile_id, kind, title, last_message_at, created_at
)
values
  (
    private.wolf_forge_tenant_id(),
    '9f410000-0000-4000-8000-000000000001',
    '9f400000-0000-4000-8000-000000000004|9f400000-0000-4000-8000-000000000005',
    '9f400000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 12:21:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    private.wolf_forge_tenant_id(),
    '9f410000-0000-4000-8000-000000000002',
    'group:9f410000-0000-4000-8000-000000000002',
    '9f400000-0000-4000-8000-000000000004', 'group', 'Search group',
    '2026-09-29 11:01:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    private.wolf_forge_tenant_id(),
    '9f410000-0000-4000-8000-000000000003',
    '9f400000-0000-4000-8000-000000000004|9f400000-0000-4000-8000-000000000006',
    '9f400000-0000-4000-8000-000000000004', 'direct', null,
    '2026-09-29 11:02:00+00', '2026-09-01 00:00:00+00'
  ),
  (
    private.wolf_forge_tenant_id(),
    '9f410000-0000-4000-8000-000000000004',
    '9f400000-0000-4000-8000-000000000001|9f400000-0000-4000-8000-000000000004',
    '9f400000-0000-4000-8000-000000000001', 'direct', null,
    '2026-09-29 11:03:00+00', '2026-09-01 00:00:00+00'
  );

insert into public.team_conversation_members (conversation_id, profile_id, last_read_at)
values
  ('9f410000-0000-4000-8000-000000000001', '9f400000-0000-4000-8000-000000000004', '2026-09-20 00:00:00+00'),
  ('9f410000-0000-4000-8000-000000000001', '9f400000-0000-4000-8000-000000000005', null),
  ('9f410000-0000-4000-8000-000000000002', '9f400000-0000-4000-8000-000000000003', null),
  ('9f410000-0000-4000-8000-000000000002', '9f400000-0000-4000-8000-000000000004', null),
  ('9f410000-0000-4000-8000-000000000002', '9f400000-0000-4000-8000-000000000005', null),
  ('9f410000-0000-4000-8000-000000000003', '9f400000-0000-4000-8000-000000000004', null),
  ('9f410000-0000-4000-8000-000000000003', '9f400000-0000-4000-8000-000000000006', null),
  ('9f410000-0000-4000-8000-000000000004', '9f400000-0000-4000-8000-000000000001', null),
  ('9f410000-0000-4000-8000-000000000004', '9f400000-0000-4000-8000-000000000004', null);

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
select
  ('9f420000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  ('9f430000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '9f410000-0000-4000-8000-000000000001',
  case when value % 2 = 0
    then '9f400000-0000-4000-8000-000000000004'::uuid
    else '9f400000-0000-4000-8000-000000000005'::uuid end,
  case value
    when 4 then 'A **supervisionneedle** report'
    when 5 then 'supervisionneedle hidden canonical content'
    when 8 then 'supervisionneedle escaped 2\*3 text'
    when 9 then 'supervisionneedle Unicode 東京'
    else 'supervisionneedle result ' || value
  end,
  '2026-09-29 12:00:00+00'::timestamptz + value * interval '1 minute'
from generate_series(1, 12) as value;

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
select
  ('9f460000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  ('9f470000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  '9f410000-0000-4000-8000-000000000001',
  case when value % 2 = 0
    then '9f400000-0000-4000-8000-000000000004'::uuid
    else '9f400000-0000-4000-8000-000000000005'::uuid end,
  'supervisionneedle older result ' || value,
  '2026-09-28 09:00:00+00'::timestamptz + value * interval '1 second'
from generate_series(1, 55) as value;

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, created_at
)
values
  (
    '9f440000-0000-4000-8000-000000000101',
    '9f450000-0000-4000-8000-000000000101',
    '9f410000-0000-4000-8000-000000000001',
    '9f400000-0000-4000-8000-000000000004',
    'supervisionneedle deleted original', '2026-09-29 12:20:00+00'
  ),
  (
    '9f440000-0000-4000-8000-000000000201',
    '9f450000-0000-4000-8000-000000000201',
    '9f410000-0000-4000-8000-000000000002',
    '9f400000-0000-4000-8000-000000000004',
    'supervisionneedle group-only content', '2026-09-29 11:01:00+00'
  ),
  (
    '9f440000-0000-4000-8000-000000000202',
    '9f450000-0000-4000-8000-000000000202',
    '9f410000-0000-4000-8000-000000000003',
    '9f400000-0000-4000-8000-000000000006',
    'supervisionneedle mixed-client content', '2026-09-29 11:02:00+00'
  ),
  (
    '9f440000-0000-4000-8000-000000000203',
    '9f450000-0000-4000-8000-000000000203',
    '9f410000-0000-4000-8000-000000000004',
    '9f400000-0000-4000-8000-000000000001',
    'supervisionneedle other-conversation content', '2026-09-29 11:03:00+00'
  ),
  (
    '9f440000-0000-4000-8000-000000000204',
    '9f450000-0000-4000-8000-000000000204',
    '9f410000-0000-4000-8000-000000000004',
    '9f400000-0000-4000-8000-000000000004',
    'participantneedle only', '2026-09-29 11:04:00+00'
  );

insert into public.team_messages (
  id, request_id, conversation_id, author_profile_id, body, message_type,
  created_at, voice_storage_path, voice_duration_ms, voice_size_bytes,
  voice_mime_type, voice_expires_at
)
values (
  '9f440000-0000-4000-8000-000000000102',
  '9f450000-0000-4000-8000-000000000102',
  '9f410000-0000-4000-8000-000000000001',
  '9f400000-0000-4000-8000-000000000005',
  'supervisionneedle voice original', 'voice', '2026-09-29 12:21:00+00',
  'team/private-search-secret.webm', 4200, 2048, 'audio/webm', '2026-10-29 12:21:00+00'
);

insert into public.team_message_hidden_for_profiles (message_id, profile_id)
values (
  '9f420000-0000-4000-8000-000000000005',
  '9f400000-0000-4000-8000-000000000005'
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

-- Establish the canonical deleted row through the ordinary participant RPC.
select pg_temp.become('9f400000-0000-4000-8000-000000000004');
set local role authenticated;
select public.app_delete_team_message_for_everyone('9f440000-0000-4000-8000-000000000101');
reset role;

create temp table supervised_search_results (
  label text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on supervised_search_results to authenticated;

create temp table search_audit_before (count bigint not null) on commit drop;
insert into search_audit_before
select count(*)
from public.security_audit_events
where id not in (select id from supervision_audit_before)
  and event_code = 'authorization.team_supervision.read'
  and action_slug = 'team.supervision.search';

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

select has_function(
  'public', 'app_search_team_supervised_conversation_messages',
  array['uuid', 'text', 'timestamp with time zone', 'uuid', 'integer', 'text'],
  'the supervisory conversation search RPC exists'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)'::regprocedure),
  'the supervisory search RPC is SECURITY DEFINER'
);

select is(
  (select provolatile from pg_proc
   where oid = 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)'::regprocedure),
  'v'::"char", 'the supervisory search RPC is VOLATILE'
);

select ok(
  'search_path=""' = any (
    select unnest(proconfig) from pg_proc
    where oid = 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)'::regprocedure
  ),
  'the supervisory search RPC fixes an empty search_path'
);

select is(
  (select proargnames from pg_proc
   where oid = 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)'::regprocedure),
  array['p_conversation_id', 'p_query', 'p_before_created_at', 'p_before_message_id', 'p_limit', 'p_correlation_id'],
  'search accepts an explicit conversation, query, cursor and optional correlation only'
);

select is(
  (select count(*) from pg_proc as function_row,
    lateral aclexplode(function_row.proacl) as acl
   where function_row.oid = 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)'::regprocedure
     and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0::bigint, 'PUBLIC has no supervisory search EXECUTE grant'
);

select ok(
  has_function_privilege('authenticated', 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_search_team_supervised_conversation_messages(uuid,text,timestamptz,uuid,integer,text)', 'EXECUTE'),
  'only authenticated receives the supervisory search RPC grant'
);

select is(
  (select count(*) from pg_proc as function_row
   join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
   where schema_row.nspname = 'public'
     and function_row.proname like 'app_search_team_supervised%'),
  1::bigint, 'there is one conversation-scoped supervisory search boundary and no global search RPC'
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

-- Denied and invalid calls must not parse content, consume the supervisor
-- search bucket, or append a successful SEARCH audit.
create temp table owner_rate_before (hits integer) on commit drop;
insert into owner_rate_before
select max(hits)
from private.rate_limit_counters
where scope = 'team.supervision.search.actor'
  and subject = '9f400000-0000-4000-8000-000000000001';

select pg_temp.become('9f400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  '42501', null, 'Manager cannot search supervised content'
);
reset role;

select pg_temp.become('9f400000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  '42501', null, 'Staff cannot search supervised content'
);
reset role;

select pg_temp.become('9f400000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  '42501', null, 'Client cannot search supervised content'
);
reset role;

select pg_temp.become('9f400000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  '42501', null, 'archived Admin cannot search supervised content'
);
reset role;

-- Wolf Forge overrides; written as a trusted fixture, so the Tenant is explicit.
insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
values (private.wolf_forge_tenant_id(), '9f400000-0000-4000-8000-000000000002', 'team_messages.supervise', false);

select pg_temp.become('9f400000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  '42501', null, 'Admin explicit deny blocks supervised search'
);
reset role;

delete from public.profile_permission_overrides
where profile_id = '9f400000-0000-4000-8000-000000000002'
  and permission_key = 'team_messages.supervise';

select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000002', 'supervisionneedle')$$,
  'P0002', 'team conversation unavailable', 'group search is denied before query evaluation'
);
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000003', 'supervisionneedle')$$,
  'P0002', 'team conversation unavailable', 'mixed client search is denied before query evaluation'
);
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000099', 'supervisionneedle')$$,
  'P0002', 'team conversation unavailable', 'nonexistent conversation fails safely'
);
reset role;

select is(
  (select count(*) from private.rate_limit_counters
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000001'),
  0::bigint, 'denied and invalid conversations do not create a supervisor search counter'
);

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.search'),
  (select count from search_audit_before),
  'denied and invalid conversations create no successful SEARCH audit'
);

-- Empty, malformed, oversized and invalid-cursor inputs are resolved before
-- the supervisor-specific counter or FTS evaluation.
select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  public.app_search_team_supervised_conversation_messages(
    '9f410000-0000-4000-8000-000000000001', '', null, null, 20
  ) -> 'results',
  '[]'::jsonb, 'empty search returns no results'
);
select is(
  public.app_search_team_supervised_conversation_messages(
    '9f410000-0000-4000-8000-000000000001', '   ', null, null, 20
  ) -> 'results',
  '[]'::jsonb, 'whitespace search returns no results'
);
select is(
  public.app_search_team_supervised_conversation_messages(
    '9f410000-0000-4000-8000-000000000001', repeat('x', 201), null, null, 20
  ) -> 'results',
  '[]'::jsonb, 'oversized search returns no results without evaluation'
);
insert into supervised_search_results
select 'owner-malformed', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', '**((unterminated', null, null, 20, repeat('0', 32)
);
select is(
  jsonb_array_length((select payload -> 'results' from supervised_search_results where label = 'owner-malformed')),
  0, 'malformed websearch syntax returns a safe empty result'
);
select is(
  public.app_search_team_supervised_conversation_messages(
    '9f410000-0000-4000-8000-000000000001', '!!!', null, null, 20
  ) -> 'results',
  '[]'::jsonb, 'punctuation-only search returns no results'
);
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle', null, gen_random_uuid(), 20)$$,
  '22023', 'invalid search cursor', 'a partial search cursor fails before rate limiting'
);
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle', null, null, 20, 'not-a-correlation')$$,
  '22023', 'invalid correlation id', 'an invalid correlation fails before rate limiting'
);
reset role;

select is(
  (select coalesce(max(hits), 0) from private.rate_limit_counters
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000001'),
  1,
  'empty, oversized and invalid inputs consume no quota; the parser-tolerated malformed query consumes one safe search allowance'
);

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.search'),
  (select count from search_audit_before) + 1,
  'empty and invalid searches create no audit; the parser-tolerated malformed query is one safe zero-result search'
);

-- Successful owner pages use the canonical newest-first search order and the
-- oldest returned pair as the next keyset cursor.
select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into supervised_search_results
select 'owner-page-1', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'supervisionneedle', null, null, 3, repeat('a', 32)
);
insert into supervised_search_results
select 'owner-page-2', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001',
  'supervisionneedle',
  (select (payload ->> 'next_before_created_at')::timestamptz from supervised_search_results where label = 'owner-page-1'),
  (select (payload ->> 'next_before_message_id')::uuid from supervised_search_results where label = 'owner-page-1'),
  3, repeat('b', 32)
);
insert into supervised_search_results
select 'owner-page-3', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001',
  'supervisionneedle',
  (select (payload ->> 'next_before_created_at')::timestamptz from supervised_search_results where label = 'owner-page-2'),
  (select (payload ->> 'next_before_message_id')::uuid from supervised_search_results where label = 'owner-page-2'),
  3, repeat('c', 32)
);
insert into supervised_search_results
select 'owner-page-4', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001',
  'supervisionneedle',
  (select (payload ->> 'next_before_created_at')::timestamptz from supervised_search_results where label = 'owner-page-3'),
  (select (payload ->> 'next_before_message_id')::uuid from supervised_search_results where label = 'owner-page-3'),
  3, repeat('d', 32)
);
insert into supervised_search_results
select 'owner-page-5', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001',
  'supervisionneedle',
  (select (payload ->> 'next_before_created_at')::timestamptz from supervised_search_results where label = 'owner-page-4'),
  (select (payload ->> 'next_before_message_id')::uuid from supervised_search_results where label = 'owner-page-4'),
  3, repeat('e', 32)
);
insert into supervised_search_results
select 'owner-full', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'supervisionneedle', null, null, 1000, repeat('f', 32)
);
insert into supervised_search_results
select 'owner-zero', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'no_such_supervision_term', null, null, 20, repeat('1', 32)
);
insert into supervised_search_results
select 'owner-unicode', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'supervisionneedle 東京', null, null, 20, repeat('2', 32)
);
insert into supervised_search_results
select 'owner-sql-looking', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'supervisionneedle OR 1=1', null, null, 20, repeat('3', 32)
);
insert into supervised_search_results
select 'owner-html-looking', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', '<script>supervisionneedle</script>', null, null, 20, repeat('4', 32)
);
reset role;

-- Admin is also allowed without membership after the explicit deny was removed.
select pg_temp.become('9f400000-0000-4000-8000-000000000002');
set local role authenticated;
insert into supervised_search_results
select 'admin-page', public.app_search_team_supervised_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'supervisionneedle', null, null, 2, repeat('5', 32)
);
reset role;

select is(
  jsonb_array_length((select payload -> 'results' from supervised_search_results where label = 'owner-page-1')),
  3, 'a search page respects the requested limit'
);

select is(
  (select payload -> 'results' -> 0 ->> 'id' from supervised_search_results where label = 'owner-page-1'),
  '9f420000-0000-4000-8000-000000000012', 'search orders matches newest first'
);

select is(
  (select payload -> 'results' -> 2 ->> 'id' from supervised_search_results where label = 'owner-page-1'),
  '9f420000-0000-4000-8000-000000000010', 'the first page oldest result is the next cursor boundary'
);

select ok(
  (select (payload ->> 'has_more')::boolean from supervised_search_results where label = 'owner-page-1')
  and (select payload ->> 'next_before_message_id' = '9f420000-0000-4000-8000-000000000010' from supervised_search_results where label = 'owner-page-1'),
  'search reports more matches and emits its oldest returned cursor'
);

select is(
  (select payload -> 'results' -> 0 ->> 'id' from supervised_search_results where label = 'owner-page-2'),
  '9f420000-0000-4000-8000-000000000009', 'the second page begins immediately before the first cursor'
);

select is(
  (select payload -> 'results' -> 0 ->> 'id' from supervised_search_results where label = 'owner-page-3'),
  '9f420000-0000-4000-8000-000000000006', 'same-conversation live results remain deterministic'
);

select is(
  (select payload -> 'results' -> 0 ->> 'id' from supervised_search_results where label = 'owner-page-4'),
  '9f420000-0000-4000-8000-000000000003', 'pagination continues deterministically into older matches'
);

select is(
  (select payload -> 'results' -> 0 ->> 'id' from supervised_search_results where label = 'owner-page-5'),
  '9f460000-0000-4000-8000-000000000055', 'the next older page has no duplicate boundary item'
);

select ok(
  not exists (
    select 1
    from (
      select result ->> 'id' as message_id
      from supervised_search_results, lateral jsonb_array_elements(payload -> 'results') as result
      where label like 'owner-page-%'
    ) as all_page_ids
    group by message_id
    having count(*) > 1
  ),
  'adjacent search pages contain no duplicate message ids'
);

select ok(
  (select not (payload ->> 'has_more')::boolean from supervised_search_results where label = 'owner-page-5') = false,
  'the bounded older page still reports remaining matches correctly'
);

select is(
  jsonb_array_length((select payload -> 'results' from supervised_search_results where label = 'owner-full')),
  50, 'the server clamps an oversized search limit to the 50-result maximum'
);

select ok(
  (select (payload ->> 'has_more')::boolean from supervised_search_results where label = 'owner-full'),
  'the maximum page reports more matches beyond its bound'
);

select is(
  jsonb_array_length((select payload -> 'results' from supervised_search_results where label = 'owner-zero')),
  0, 'a valid zero-result search returns an empty result page'
);

select is(
  jsonb_array_length((select payload -> 'results' from supervised_search_results where label = 'owner-unicode')),
  1, 'Unicode query input is handled safely'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements((select payload -> 'results' from supervised_search_results where label = 'owner-full')) as result
    where result ->> 'id' = '9f420000-0000-4000-8000-000000000005'
  ),
  'participant-hidden canonical content is searchable by supervision'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload -> 'results' from supervised_search_results where label = 'owner-full')) as result
    where result ->> 'id' in (
      '9f440000-0000-4000-8000-000000000101',
      '9f440000-0000-4000-8000-000000000102',
      '9f440000-0000-4000-8000-000000000201',
      '9f440000-0000-4000-8000-000000000202',
      '9f440000-0000-4000-8000-000000000203'
    )
  )
  and (select payload::text not like '%private-search-secret.webm%' from supervised_search_results where label = 'owner-full'),
  'deleted, voice, group, mixed and foreign-conversation rows do not leak into scoped results'
);

select is(
  (select count(*) from jsonb_object_keys(
    (select payload -> 'results' -> 0 from supervised_search_results where label = 'owner-full')
  )),
  6::bigint, 'search result items expose only the neutral six-field result DTO'
);

select is(
  (select count(*)
   from supervised_search_results,
     lateral jsonb_array_elements(payload -> 'results') as result,
     lateral jsonb_object_keys(result) as key_name
   where key_name ~ '(conversation|request|task|source|storage|signed|playback|unread|read_at|delivery|notification|presence|typing|capabilit|permission|reacted_by_me|voice)'),
  0::bigint, 'search DTOs omit participant state, source identifiers, capabilities and voice internals'
);

select ok(
  (select bool_and(char_length(result ->> 'snippet') <= 600)
   from supervised_search_results,
     lateral jsonb_array_elements(payload -> 'results') as result)
  and (select bool_and((result ->> 'snippet') not like '%<b>%'
                   and (result ->> 'snippet') not like '%<mark>%'
                   and (result ->> 'snippet') not like '%**%'
               )
       from supervised_search_results,
         lateral jsonb_array_elements(payload -> 'results') as result),
  'search snippets are bounded plain text with no raw HTML or Markdown markup'
);

select is(
  jsonb_array_length((select payload -> 'results' from supervised_search_results where label = 'owner-html-looking')),
  0, 'HTML-looking query input produces no arbitrary HTML result content'
);

create temp table participant_search_result (payload jsonb not null) on commit drop;
grant insert on participant_search_result to authenticated;

-- Participant hidden behavior stays unchanged while supervision searches the
-- same canonical message. This call also proves the participant bucket is a
-- separate scope from the supervisor bucket.
select pg_temp.become('9f400000-0000-4000-8000-000000000005');
set local role authenticated;
insert into participant_search_result
select public.app_search_team_conversation_messages(
  '9f410000-0000-4000-8000-000000000001', 'supervisionneedle'
);
reset role;

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload -> 'results' from participant_search_result)) as result
    where result ->> 'id' = '9f420000-0000-4000-8000-000000000005'
  ),
  'the participant still cannot search its own hidden message'
);

select is(
  (select count(*) from public.team_message_hidden_for_profiles
   where message_id = '9f420000-0000-4000-8000-000000000005'
     and profile_id = '9f400000-0000-4000-8000-000000000005'),
  1::bigint, 'supervisory search does not mutate hidden-state rows'
);

-- A valid participant search by the same Owner uses the ordinary bucket but
-- must not increment the supervisory bucket.
create temp table owner_supervision_hits_before (hits bigint not null) on commit drop;
insert into owner_supervision_hits_before
select coalesce(sum(hits), 0)
from private.rate_limit_counters
where scope = 'team.supervision.search.actor'
  and subject = '9f400000-0000-4000-8000-000000000001';

select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
select public.app_search_team_conversation_messages(
  '9f410000-0000-4000-8000-000000000004', 'participantneedle'
);
reset role;

select is(
  (select coalesce(sum(hits), 0)
   from private.rate_limit_counters
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000001'),
  (select hits from owner_supervision_hits_before),
  'participant search does not consume the supervisory search quota'
);

select is(
  (select coalesce(sum(hits), 0)
   from private.rate_limit_counters
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000001'),
  11::bigint, 'successful Owner searches consume exactly one actor-scoped allowance each'
);

select is(
  (select coalesce(sum(hits), 0)
   from private.rate_limit_counters
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000002'),
  1::bigint, 'the Admin has an independent supervisory search allowance'
);

select ok(
  exists (
    select 1 from private.rate_limit_counters
    where scope = 'team.search.actor'
      and subject = '9f400000-0000-4000-8000-000000000001'
  ),
  'participant search keeps its own actor bucket'
);

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.search'),
  (select count from search_audit_before) + (select count(*) from supervised_search_results),
  'each successful explicit non-empty search has exactly one SEARCH audit'
);

select is(
  (select metadata from public.security_audit_events where id not in (select id from supervision_audit_before)   and correlation_id = repeat('a', 32)),
  '{"read_kind":"search","conversation_kind":"direct","result_count":3}'::jsonb,
  'matching SEARCH audit metadata is bounded and content-free'
);

select is(
  (select metadata from public.security_audit_events where id not in (select id from supervision_audit_before)   and correlation_id = repeat('1', 32)),
  '{"read_kind":"search","conversation_kind":"direct","result_count":0}'::jsonb,
  'zero-result valid search is audited with result_count zero'
);

select ok(
  not exists (
    select 1 from public.security_audit_events
    where id not in (select id from supervision_audit_before)
      and event_code = 'authorization.team_supervision.read'
      and action_slug = 'team.supervision.search'
      and metadata::text ~ '(supervisionneedle|script|private-search-secret|query|snippet|body)'
  ),
  'SEARCH audit metadata contains no query, snippet, body or voice content'
);

select ok(
  not exists (
    select 1 from public.security_audit_events
    where id not in (select id from supervision_audit_before)
      and event_code = 'authorization.team_supervision.read'
      and action_slug = 'team.supervision.search'
      and (actor_profile_id is null or actor_profile_id not in (
        '9f400000-0000-4000-8000-000000000001',
        '9f400000-0000-4000-8000-000000000002'
      ))
  ),
  'SEARCH audits only identify the authenticated Owner or Admin actor'
);

select is(
  (select count(*) from public.team_conversation_members
   where conversation_id = '9f410000-0000-4000-8000-000000000001'
     and profile_id in (
       '9f400000-0000-4000-8000-000000000001',
       '9f400000-0000-4000-8000-000000000002'
     )),
  0::bigint, 'non-member supervisors remain non-members after search'
);

-- Consume the remaining 49 real valid searches for the Owner. The primitive's
-- rollback on WF429 must leave the counter at its configured limit and must not
-- write an audit.
select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  attempt integer;
begin
  for attempt in 1..49 loop
    perform public.app_search_team_supervised_conversation_messages(
      '9f410000-0000-4000-8000-000000000001', 'supervisionneedle'
    );
  end loop;
end;
$$;
reset role;

select is(
  (select sum(hits)::bigint from private.rate_limit_counters
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000001'),
  60::bigint, 'repeated valid searches consume one allowance each across fixed windows'
);

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.search'),
  (select count from search_audit_before) + (select count(*) from supervised_search_results) + 49,
  'each repeated valid search appends exactly one SEARCH audit'
);

-- A remote runner can cross a minute boundary between statements.
update private.rate_limit_counters set expires_at = clock_timestamp() + interval '1 hour'
where scope = 'team.supervision.search.actor'
  and subject = '9f400000-0000-4000-8000-000000000001';
with bucket as materialized (select date_trunc('minute', clock_timestamp()) as start)
insert into private.rate_limit_counters(scope, subject, window_start, expires_at, hits)
select 'team.supervision.search.actor', '9f400000-0000-4000-8000-000000000001',
  start + n * interval '1 minute', start + interval '1 hour', 60
from bucket cross join generate_series(0, 1) n
on conflict(scope, subject, window_start) do update
set hits = excluded.hits, expires_at = excluded.expires_at;
create temp table exhausted_owner_counters_before on commit drop as
select jsonb_agg(to_jsonb(c) order by window_start) as counters
from private.rate_limit_counters c
where scope = 'team.supervision.search.actor'
  and subject = '9f400000-0000-4000-8000-000000000001';

select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  'WF429', 'rate limit exceeded', 'supervisory search rejects an exhausted supervisor-specific bucket'
);
reset role;

select pg_temp.become('9f400000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  'a second supervisor remains searchable after the Owner bucket is exhausted'
);
reset role;

select pg_temp.become('9f400000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.app_search_team_conversation_messages('9f410000-0000-4000-8000-000000000004', 'participantneedle')$$,
  'participant search remains usable after the supervisory bucket is exhausted'
);
reset role;

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'
     and action_slug = 'team.supervision.search'),
  (select count from search_audit_before) + (select count(*) from supervised_search_results) + 49 + 1,
  'a rate-limited search creates no successful SEARCH audit'
);

select is(
  (select jsonb_agg(to_jsonb(c) order by window_start) from private.rate_limit_counters c
   where scope = 'team.supervision.search.actor'
     and subject = '9f400000-0000-4000-8000-000000000001'),
  (select counters from exhausted_owner_counters_before),
  'a rejected search leaves every owner counter unchanged'
);

select is(
  (select count(*) from public.team_conversation_members
   where conversation_id = '9f410000-0000-4000-8000-000000000001'
     and profile_id in ('9f400000-0000-4000-8000-000000000001', '9f400000-0000-4000-8000-000000000002')),
  0::bigint, 'rate limiting and searching never insert supervisor membership'
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
  'search changes no Team membership, read, delivery, notification, presence, typing, message, task, pin, reaction, admin or hidden state'
);

set local role service_role;
select throws_ok(
  $$select public.app_search_team_supervised_conversation_messages('9f410000-0000-4000-8000-000000000001', 'supervisionneedle')$$,
  '42501', null, 'service_role has no direct supervisory search shortcut'
);
reset role;

select * from finish();
rollback;
