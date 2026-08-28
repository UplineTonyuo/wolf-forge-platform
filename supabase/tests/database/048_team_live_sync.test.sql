begin;

select plan(28);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7ee00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'v22-owner@example.invalid', now(), now()),
  ('7ee00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'v22-alex@example.invalid', now(), now()),
  ('7ee00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'v22-blair@example.invalid', now(), now()),
  ('7ee00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'v22-client@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Vera Owner'
where id = '7ee00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Alex Staff'
where id = '7ee00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Blair Staff'
where id = '7ee00000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'client'), display_name = 'Casey Client'
where id = '7ee00000-0000-4000-8000-000000000004';

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Shape and reach
-- ---------------------------------------------------------------------------

select function_returns('public', 'app_team_live_sync', array['uuid', 'timestamp with time zone'], 'jsonb',
  'the live read answers in one JSON envelope');
select ok(has_function_privilege('authenticated', 'public.app_team_live_sync(uuid, timestamptz)', 'EXECUTE'),
  'authenticated may run the actor-derived live read');
select ok(not has_function_privilege('anon', 'public.app_team_live_sync(uuid, timestamptz)', 'EXECUTE'),
  'anon may not run the live read');
select ok(not has_function_privilege('service_role', 'public.app_team_live_sync(uuid, timestamptz)', 'EXECUTE'),
  'service_role may not run the live read');
select ok((select count(*) from pg_indexes where schemaname = 'public' and indexname = 'team_conversations_last_message_at_idx') = 1,
  'the delta is indexed by when a conversation last moved');

-- ---------------------------------------------------------------------------
-- Authorization is the database's, not the route's
-- ---------------------------------------------------------------------------

select pg_temp.become('7ee00000-0000-4000-8000-000000000004');
select throws_ok($$ select public.app_team_live_sync(null, null) $$, '42501', null,
  'a client account cannot reach the live read');

select pg_temp.become('7ee00000-0000-4000-8000-000000000001');
create temp table v22_direct on commit drop as
select public.app_start_team_conversation('7ee00000-0000-4000-8000-000000000002') as conversation_id;

select pg_temp.become('7ee00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_team_live_sync(%L::uuid, null) $$, (select conversation_id from v22_direct)),
  '42501', null,
  'a non-member cannot read another pair''s conversation through the live read');

-- ---------------------------------------------------------------------------
-- The delta
-- ---------------------------------------------------------------------------

select pg_temp.become('7ee00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_send_team_message('7ee10000-0000-4000-8000-000000000001'::uuid, %L::uuid, '**Bold** and 2\*3 costs \_less') $$,
    (select conversation_id from v22_direct)),
  'the owner sends a formatted message');

select pg_temp.become('7ee00000-0000-4000-8000-000000000002');

select is(
  jsonb_typeof(public.app_team_live_sync(null, null) -> 'signals'), 'array',
  'signals is always an array');
select is(
  jsonb_array_length(public.app_team_live_sync(null, null) -> 'signals'), 1,
  'a message inside the look-back window is reported');
select is(
  jsonb_array_length(public.app_team_live_sync(null, clock_timestamp()) -> 'signals'), 0,
  'a cursor at now leaves the delta empty');
select is(
  jsonb_array_length(public.app_team_live_sync(null, clock_timestamp() + interval '1 hour') -> 'signals'), 0,
  'a cursor ahead of the newest message leaves the delta empty');

select is(
  (public.app_team_live_sync(null, null) -> 'signals' -> 0 ->> 'last_message_preview'),
  'Bold and 2*3 costs _less',
  'the delta preview is plain text, with escaped markers restored');
select is(
  (public.app_team_live_sync(null, null) -> 'signals' -> 0 ->> 'other_member_name'), 'Vera Owner',
  'a direct delta names the other member');
select is(
  (public.app_team_live_sync(null, null) -> 'signals' -> 0 ->> 'last_message_author_name'), 'Vera Owner',
  'the delta names the author, so a peek can attribute it');
select is(
  (public.app_team_live_sync(null, null) -> 'signals' -> 0 ->> 'unread_count')::integer, 1,
  'the delta carries the unread count for that conversation');
select is(
  (public.app_team_live_sync(null, null) ->> 'unread_total')::integer, 1,
  'the badge total rides the same answer');
select ok(
  (public.app_team_live_sync(null, null) ->> 'server_time') is not null,
  'the answer carries the cursor for the caller''s next request');

-- The recipient's own message must not announce itself.
--
-- Asserted through the unread count rather than through "who wrote the newest
-- message": every statement in this file shares one transaction timestamp, so
-- two messages sent here carry the same created_at and which one is "latest"
-- falls to uuid ordering. That is an artefact of the test transaction, not of
-- the RPC, and it is not worth asserting.
select lives_ok(
  format($$ select public.app_send_team_message('7ee10000-0000-4000-8000-000000000002'::uuid, %L::uuid, 'my own reply') $$,
    (select conversation_id from v22_direct)),
  'the recipient replies');
select is(
  (public.app_team_live_sync(null, null) -> 'signals' -> 0 ->> 'unread_count')::integer, 1,
  'a reader''s own message never adds to their own unread count');
select is(
  (public.app_team_live_sync(null, null) ->> 'unread_total')::integer, 1,
  'nor to their badge');

-- ---------------------------------------------------------------------------
-- The open thread
-- ---------------------------------------------------------------------------

select is(
  jsonb_typeof(public.app_team_live_sync(null, null) -> 'detail'), 'null',
  'no open thread means no transcript is read at all');
select is(
  (public.app_team_live_sync((select conversation_id from v22_direct), null) -> 'detail' ->> 'conversation_id'),
  (select conversation_id from v22_direct)::text,
  'an open thread is answered in the same call');
select is(
  jsonb_array_length(public.app_team_live_sync((select conversation_id from v22_direct), null) -> 'detail' -> 'messages'), 2,
  'the open thread carries its transcript');

select pg_temp.become('7ee00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_touch_team_typing(%L::uuid, '7ee20000-0000-4000-8000-000000000001'::uuid) $$,
    (select conversation_id from v22_direct)),
  'the owner starts typing');

select pg_temp.become('7ee00000-0000-4000-8000-000000000002');
select is(
  jsonb_array_length(public.app_team_live_sync((select conversation_id from v22_direct), clock_timestamp()) -> 'detail' -> 'typing'), 1,
  'typing reaches the recipient on a tick whose delta is empty');
select is(
  (public.app_team_live_sync((select conversation_id from v22_direct), null) -> 'detail' -> 'typing' -> 0 ->> 'profile_id'),
  '7ee00000-0000-4000-8000-000000000001',
  'typing names the colleague, never the reader');

select pg_temp.become('7ee00000-0000-4000-8000-000000000001');
select is(
  jsonb_array_length(public.app_team_live_sync((select conversation_id from v22_direct), null) -> 'detail' -> 'typing'), 0,
  'a tab never sees its own typing state');

select * from finish();
rollback;
