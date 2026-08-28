begin;

select plan(68);

-- =============================================================================
-- Team Communication V2.3 — conversation history search and shared reactions.
--
-- Covers supabase/migrations/20260827000000_team_search_and_reactions.sql.
--
-- The claims under test:
--   * search is conversation-scoped, server-side, and never returns a hit from
--     a conversation the caller does not belong to;
--   * search operates on the same plain-text projection previews already use,
--     so Markdown markers and escaped literals are searchable as perceived
--     text rather than as syntax;
--   * app_list_team_messages_before and app_get_team_message_window give a
--     deterministic keyset page and a bounded jump-to-message window, neither
--     of which loads more than requested;
--   * reactions are a narrow, capability-free table with no policy and no
--     grant to any browser role — the only doorway is
--     app_toggle_team_message_reaction, which derives the reactor from
--     auth.uid() and re-derives conversation membership from the message
--     itself, so a client, a non-member, or a member of only a DIFFERENT
--     conversation can never react to it.
--
-- Fixtures: a direct conversation between owner Nora and staff Otis holding
-- seven messages with CONTROLLED timestamps (inserted directly as the
-- superuser test role, the only way to make keyset ordering deterministic —
-- every RPC call in one test transaction shares one frozen now()), a group
-- "Search Pod" (Nora, Priya, Quinn) holding one message, staff outsider Priya
-- (group member, not in the direct conversation), staff outsider Quinn (same),
-- and client Uma who must reach none of it.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7ef00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'v23-nora@example.invalid', now(), now()),
  ('7ef00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'v23-otis@example.invalid', now(), now()),
  ('7ef00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'v23-priya@example.invalid', now(), now()),
  ('7ef00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'v23-quinn@example.invalid', now(), now()),
  ('7ef00000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'v23-uma@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Nora Owner'
where id = '7ef00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Otis Staff'
where id = '7ef00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Priya Staff'
where id = '7ef00000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Quinn Staff'
where id = '7ef00000-0000-4000-8000-000000000004';
update public.profiles set role_id = (select id from public.roles where name = 'client'), display_name = 'Uma Client'
where id = '7ef00000-0000-4000-8000-000000000005';

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select pg_temp.become('7ef00000-0000-4000-8000-000000000001');
create temp table v23_direct on commit drop as
select public.app_start_team_conversation('7ef00000-0000-4000-8000-000000000002') as conversation_id;

create temp table v23_group on commit drop as
select public.app_create_team_group(
  'Search Pod',
  array[
    '7ef00000-0000-4000-8000-000000000003'::uuid,
    '7ef00000-0000-4000-8000-000000000004'::uuid
  ]
) as conversation_id;

-- Seven messages, oldest first, with EXPLICIT distinct timestamps. Direct
-- fixture insertion is what makes keyset pagination and result ordering
-- deterministic: every app_send_team_message call in this same test
-- transaction would otherwise share one frozen now().
insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
values
  ('7ef10000-0000-4000-8000-000000000001', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000001', 'Morning standup notes for the team', now() - interval '60 minutes'),
  ('7ef10000-0000-4000-8000-000000000002', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000001', 'I already sent the **website** audit to the client', now() - interval '50 minutes'),
  ('7ef10000-0000-4000-8000-000000000003', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000002', 'The website needs another service page', now() - interval '40 minutes'),
  ('7ef10000-0000-4000-8000-000000000004', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000001', E'Our rate is 2\\*3 percent for website work', now() - interval '30 minutes'),
  ('7ef10000-0000-4000-8000-000000000005', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000002', 'Unrelated chit chat about lunch', now() - interval '20 minutes'),
  ('7ef10000-0000-4000-8000-000000000006', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000001', 'Final website confirmation before launch', now() - interval '10 minutes'),
  ('7ef10000-0000-4000-8000-000000000007', gen_random_uuid(), (select conversation_id from v23_direct), '7ef00000-0000-4000-8000-000000000002', 'Thanks, sounds good', now() - interval '5 minutes');

insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
values
  ('7ef10000-0000-4000-8000-000000000101', gen_random_uuid(), (select conversation_id from v23_group), '7ef00000-0000-4000-8000-000000000001', 'The Search Pod also mentions the website relaunch', now() - interval '15 minutes');

-- ---------------------------------------------------------------------------
-- Shape, grants, and the objects search is built on
-- ---------------------------------------------------------------------------

select function_returns('public', 'app_search_team_conversation_messages',
  array['uuid', 'text', 'timestamp with time zone', 'uuid', 'integer'], 'jsonb',
  'search answers in one JSON envelope');
select function_returns('public', 'app_list_team_messages_before',
  array['uuid', 'timestamp with time zone', 'uuid', 'integer'], 'jsonb',
  'the older-history page answers in one JSON envelope');
select function_returns('public', 'app_get_team_message_window',
  array['uuid', 'uuid', 'integer', 'integer'], 'jsonb',
  'the jump-to-message window answers in one JSON envelope');
select function_returns('public', 'app_toggle_team_message_reaction',
  array['uuid', 'text'], 'jsonb',
  'the reaction toggle answers in one JSON envelope');

select ok(has_function_privilege('authenticated', 'public.app_search_team_conversation_messages(uuid, text, timestamptz, uuid, integer)', 'EXECUTE'),
  'authenticated may search');
select ok(not has_function_privilege('anon', 'public.app_search_team_conversation_messages(uuid, text, timestamptz, uuid, integer)', 'EXECUTE'),
  'anon may not search');
select ok(has_function_privilege('authenticated', 'public.app_toggle_team_message_reaction(uuid, text)', 'EXECUTE'),
  'authenticated may toggle a reaction');
select ok(not has_function_privilege('anon', 'public.app_toggle_team_message_reaction(uuid, text)', 'EXECUTE'),
  'anon may not toggle a reaction');

select has_column('public', 'team_messages', 'search_vector', 'the generated search projection exists');
select ok((select count(*) from pg_indexes where schemaname = 'public' and indexname = 'team_messages_search_vector_idx') = 1,
  'search is GIN-indexed rather than an unindexed table scan');
select ok((select count(*) from pg_indexes where schemaname = 'public' and indexname = 'team_messages_conversation_created_id_idx') = 1,
  'history keyset pagination is indexed on (conversation_id, created_at, id)');

select is(
  (select relrowsecurity from pg_class where oid = 'public.team_message_reactions'::regclass), true,
  'team_message_reactions has RLS enabled');
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.team_message_reactions'::regclass), true,
  'and FORCES it, even for the table owner');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'team_message_reactions'), 0::bigint,
  'zero policies exist — the RPC is the only doorway');

set local role authenticated;
select throws_ok($$ select * from public.team_message_reactions $$, '42501', null,
  'authenticated cannot read the reactions table directly');
select throws_ok($$ insert into public.team_message_reactions (message_id, reactor_profile_id, reaction_code) values (gen_random_uuid(), gen_random_uuid(), 'like') $$, '42501', null,
  'nor write to it directly');
reset role;

-- ---------------------------------------------------------------------------
-- Search authorization
-- ---------------------------------------------------------------------------

select pg_temp.become('7ef00000-0000-4000-8000-000000000005');
select throws_ok(
  format($$ select public.app_search_team_conversation_messages(%L::uuid, 'website') $$, (select conversation_id from v23_direct)),
  '42501', null,
  'a client account cannot search Team conversations at all');

select pg_temp.become('7ef00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_search_team_conversation_messages(%L::uuid, 'website') $$, (select conversation_id from v23_direct)),
  '42501', null,
  'an internal staff account not a member of the direct conversation is refused');

select pg_temp.become('7ef00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_search_team_conversation_messages(%L::uuid, 'website') $$, (select conversation_id from v23_direct)),
  'the direct conversation''s own member can search it');

select pg_temp.become('7ef00000-0000-4000-8000-000000000003');
select lives_ok(
  format($$ select public.app_search_team_conversation_messages(%L::uuid, 'website') $$, (select conversation_id from v23_group)),
  'a group member can search the group');

-- ---------------------------------------------------------------------------
-- Search results: relevance, plain-text projection, and scope
-- ---------------------------------------------------------------------------

select pg_temp.become('7ef00000-0000-4000-8000-000000000001');

select is(
  jsonb_array_length(public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website') -> 'results'),
  4,
  'all four messages mentioning "website" are found in the direct conversation');

select is(
  (public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website') -> 'results' -> 0 ->> 'id'),
  '7ef10000-0000-4000-8000-000000000006',
  'results order newest first, deterministically, by (created_at, id)');

select is(
  (public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website') -> 'results' -> 3 ->> 'id'),
  '7ef10000-0000-4000-8000-000000000002',
  'and the oldest match sorts last');

select ok(
  (select bool_and((result ->> 'snippet') !~ '\*\*')
   from jsonb_array_elements(public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website') -> 'results') as result),
  'every snippet is built from the plain-text projection: no raw Markdown marker leaks through');

select ok(
  (select (result ->> 'snippet') like '%2*3%' and (result ->> 'snippet') not like '%\%'
   from jsonb_array_elements(public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website') -> 'results') as result
   where (result ->> 'id') = '7ef10000-0000-4000-8000-000000000004'),
  'an escaped literal asterisk is searchable and renders unescaped, never with a stray backslash');

select is(
  jsonb_array_length(public.app_search_team_conversation_messages((select conversation_id from v23_group), 'website') -> 'results'),
  1,
  'the group conversation is searched independently and finds only its own message');

select ok(
  not (
    public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website') -> 'results'
    @> jsonb_build_array(jsonb_build_object('id', '7ef10000-0000-4000-8000-000000000101'))
  ),
  'search never returns a hit from a different conversation, even to a caller who belongs to both');

select is(
  (public.app_search_team_conversation_messages((select conversation_id from v23_direct), '') -> 'results'), '[]'::jsonb,
  'an empty query is handled: it matches nothing rather than raising');
select is(
  (public.app_search_team_conversation_messages((select conversation_id from v23_direct), '   ') -> 'results'), '[]'::jsonb,
  'a whitespace-only query is likewise handled');
select lives_ok(
  format($$ select public.app_search_team_conversation_messages(%L::uuid, '**((unterminated') $$, (select conversation_id from v23_direct)),
  'malformed query syntax never raises back to the caller');

-- Deterministic cursor pagination over the same four hits: page 1 of 2, then
-- page 2 cursored on the first page's own oldest result.
select is(
  jsonb_array_length(public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website', null, null, 2) -> 'results'),
  2,
  'search respects an explicit page size');
select is(
  (public.app_search_team_conversation_messages((select conversation_id from v23_direct), 'website', null, null, 2) ->> 'has_more')::boolean,
  true,
  'has_more is true when a further page exists');
select is(
  jsonb_array_length(
    public.app_search_team_conversation_messages(
      (select conversation_id from v23_direct), 'website',
      (now() - interval '40 minutes'), '7ef10000-0000-4000-8000-000000000003', 2
    ) -> 'results'
  ),
  1,
  'cursoring strictly before the second page''s pivot returns exactly the one remaining older hit — never OFFSET, never a repeat');
select is(
  (public.app_search_team_conversation_messages(
      (select conversation_id from v23_direct), 'website',
      (now() - interval '40 minutes'), '7ef10000-0000-4000-8000-000000000003', 2
    ) ->> 'has_more')::boolean,
  false,
  'the final page correctly reports no further page');

-- ---------------------------------------------------------------------------
-- History pagination: "load older", keyset on (created_at, id)
-- ---------------------------------------------------------------------------

select pg_temp.become('7ef00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_list_team_messages_before(%L::uuid, now(), gen_random_uuid()) $$, (select conversation_id from v23_direct)),
  '42501', null,
  'a non-member cannot page through history it cannot open');

select pg_temp.become('7ef00000-0000-4000-8000-000000000001');
select is(
  jsonb_array_length(
    public.app_list_team_messages_before(
      (select conversation_id from v23_direct),
      (now() - interval '20 minutes'), '7ef10000-0000-4000-8000-000000000005', 3
    ) -> 'messages'
  ),
  3,
  'the older page returns exactly the messages strictly before the cursor');
select is(
  (public.app_list_team_messages_before(
      (select conversation_id from v23_direct),
      (now() - interval '20 minutes'), '7ef10000-0000-4000-8000-000000000005', 3
    ) -> 'messages' -> 0 ->> 'id'),
  '7ef10000-0000-4000-8000-000000000002',
  'the page itself is returned oldest-first, ready to prepend — the 3 nearest messages before the cursor, earliest of those 3 first');
select is(
  (public.app_list_team_messages_before(
      (select conversation_id from v23_direct),
      (now() - interval '20 minutes'), '7ef10000-0000-4000-8000-000000000005', 3
    ) ->> 'has_more')::boolean,
  true,
  'has_more is true when the requested page size does not reach all the way back to the first message');
select is(
  (public.app_list_team_messages_before(
      (select conversation_id from v23_direct),
      (now() - interval '20 minutes'), '7ef10000-0000-4000-8000-000000000005', 10
    ) ->> 'has_more')::boolean,
  false,
  'has_more is false once a large-enough page reaches all the way back to the very first message');
select is(
  (public.app_list_team_messages_before(
      (select conversation_id from v23_direct),
      (now() - interval '45 minutes'), '7ef10000-0000-4000-8000-000000000003', 1
    ) ->> 'has_more')::boolean,
  true,
  'has_more is true while older messages remain beyond the requested page size');
select is(
  jsonb_array_length(
    (public.app_list_team_messages_before(
      (select conversation_id from v23_direct),
      (now() - interval '20 minutes'), '7ef10000-0000-4000-8000-000000000005', 3
    ) -> 'messages' -> 0 -> 'reactions')
  ),
  0,
  'a message with no reactions carries an empty (never null) reactions array');

-- ---------------------------------------------------------------------------
-- Jump-to-message: a bounded window, authorized like everything else here
-- ---------------------------------------------------------------------------

select pg_temp.become('7ef00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_get_team_message_window(%L::uuid, '7ef10000-0000-4000-8000-000000000002'::uuid, 1, 1) $$, (select conversation_id from v23_direct)),
  '42501', null,
  'target-context retrieval is authorized exactly like every other Team read: a non-member is refused');

select pg_temp.become('7ef00000-0000-4000-8000-000000000001');
select is(
  (public.app_get_team_message_window((select conversation_id from v23_direct), '7ef10000-0000-4000-8000-000000000002'::uuid, 1, 1) ->> 'found')::boolean,
  true,
  'a historical message far outside any "latest window" is still found');
select is(
  jsonb_array_length(public.app_get_team_message_window((select conversation_id from v23_direct), '7ef10000-0000-4000-8000-000000000002'::uuid, 1, 1) -> 'messages'),
  3,
  'the window carries exactly one message before, the target, and one after');
select is(
  (public.app_get_team_message_window((select conversation_id from v23_direct), '7ef10000-0000-4000-8000-000000000002'::uuid, 1, 1) -> 'messages' -> 1 ->> 'id'),
  '7ef10000-0000-4000-8000-000000000002',
  'the target sits in the middle of its own window');
select is(
  jsonb_array_length(public.app_get_team_message_window((select conversation_id from v23_direct), '7ef10000-0000-4000-8000-000000000001'::uuid, 5, 0) -> 'messages'),
  1,
  'a window at the very start of history returns only what actually exists before it');
select is(
  (public.app_get_team_message_window((select conversation_id from v23_direct), gen_random_uuid(), 5, 5) ->> 'found')::boolean,
  false,
  'a message id that does not exist in the conversation is reported not-found rather than raising');

-- ---------------------------------------------------------------------------
-- Reactions: allowed, rejected, idempotent, shared
-- ---------------------------------------------------------------------------

select pg_temp.become('7ef00000-0000-4000-8000-000000000005');
select throws_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') $$,
  '42501', null,
  'a client account cannot react to anything');

select pg_temp.become('7ef00000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') $$,
  '42501', null,
  'staff outside the direct conversation cannot react to its messages');
select lives_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000101'::uuid, 'heart') $$,
  'but the SAME staff member reacts freely to a message in a conversation they do belong to — the refusal above was about the conversation, not the person');
select lives_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000101'::uuid, 'heart') $$,
  'toggle it back off, leaving the group message clean for the isolation check below');

-- Cross-conversation isolation, precisely: Otis is a direct-conversation
-- member but NOT in Search Pod, so the group's own message must refuse him.
select pg_temp.become('7ef00000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000101'::uuid, 'heart') $$,
  '42501', null,
  'a message from one conversation can never be reacted to by a member of only a different conversation');

select pg_temp.become('7ef00000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'shrug') $$,
  '22023', null,
  'an unknown reaction code is rejected');

select is(
  (public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') ->> 'reacted_by_me')::boolean,
  true,
  'the allowed reaction succeeds and reports the actor as now reacted');
select is(
  (select count(*) from public.team_message_reactions
    where message_id = '7ef10000-0000-4000-8000-000000000002'
      and reactor_profile_id = '7ef00000-0000-4000-8000-000000000001'
      and reaction_code = 'heart'),
  1::bigint,
  'exactly one row exists for this reactor/message/code');
select is(
  (select active from public.team_message_reactions
    where message_id = '7ef10000-0000-4000-8000-000000000002'
      and reactor_profile_id = '7ef00000-0000-4000-8000-000000000001'
      and reaction_code = 'heart'),
  true,
  'and it is active');

-- Reacting again is the toggle-off; reacting a third time re-activates the
-- SAME row rather than inserting a second one.
select is(
  (public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') ->> 'reacted_by_me')::boolean,
  false,
  'clicking an already-applied reaction toggles it off');
select is(
  (select count(*) from public.team_message_reactions
    where message_id = '7ef10000-0000-4000-8000-000000000002'
      and reactor_profile_id = '7ef00000-0000-4000-8000-000000000001'
      and reaction_code = 'heart'),
  1::bigint,
  'toggling off never deletes or duplicates the row — same row, active=false');
select is(
  jsonb_array_length(public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') -> 'reactions'),
  1,
  'toggling back on re-activates the same row again (three toggles, one row)');
select is(
  (select count(*) from public.team_message_reactions
    where message_id = '7ef10000-0000-4000-8000-000000000002'
      and reactor_profile_id = '7ef00000-0000-4000-8000-000000000001'
      and reaction_code = 'heart'),
  1::bigint,
  'confirmed: still exactly one row after three toggles');

-- A second employee reacting with the SAME code increments the shared
-- aggregate rather than creating a second chip.
select pg_temp.become('7ef00000-0000-4000-8000-000000000002');
select is(
  (public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') -> 'reactions' -> 0 ->> 'reaction_count')::integer,
  2,
  'a second employee''s reaction increments the shared aggregate to 2');
select is(
  (public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'heart') -> 'reactions' -> 0 ->> 'reaction_count')::integer,
  1,
  'and toggling that second reaction back off correctly decrements the shared delta to 1, never below zero');
select is(
  (select active from public.team_message_reactions
    where message_id = '7ef10000-0000-4000-8000-000000000002'
      and reactor_profile_id = '7ef00000-0000-4000-8000-000000000002'
      and reaction_code = 'heart'),
  false,
  'the removed reaction is represented as the same row flipped to active=false, not a deletion');

-- Different reaction types coexist without disturbing one another.
select pg_temp.become('7ef00000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'laugh') $$,
  'the same message accepts a second, different reaction type');

select is(
  (
    select jsonb_object_agg(reaction ->> 'reaction_code', (reaction ->> 'reaction_count')::integer)
    from jsonb_array_elements(
      public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'laugh') -> 'reactions'
    ) as reaction
  ),
  jsonb_build_object('heart', 1),
  'toggling laugh off again leaves heart entirely undisturbed, and a zero-count reaction never appears in the aggregate at all'
);

select lives_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'laugh') $$,
  're-apply laugh so heart and laugh coexist on the same message');

-- A message's author has no special standing here: any conversation member —
-- including someone other than the author — may react to it.
select pg_temp.become('7ef00000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.app_toggle_team_message_reaction('7ef10000-0000-4000-8000-000000000002'::uuid, 'wow') $$,
  'a non-author conversation member reacts freely — authorship of the message grants no extra gate');
select is(
  (select count(*) from public.team_message_reactions
    where message_id = '7ef10000-0000-4000-8000-000000000002'
      and active
      and reaction_code in ('heart', 'laugh', 'wow')),
  3::bigint,
  'heart (Nora), laugh (Nora) and wow (Otis) are all active on the one message — three distinct reaction types, no duplicate rows within any of them'
);

select * from finish();
rollback;
