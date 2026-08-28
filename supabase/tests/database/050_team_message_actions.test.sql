begin;

select plan(56);

-- Team Communication V2.4 — replies, independent forwards, per-profile hide,
-- and author-only tombstones. Every browser-callable function derives the
-- actor from auth.uid(); no test passes a profile id as authority.

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7fa00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'v24-aria@example.invalid', now(), now()),
  ('7fa00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'v24-ben@example.invalid', now(), now()),
  ('7fa00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'v24-cora@example.invalid', now(), now()),
  ('7fa00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'v24-dane@example.invalid', now(), now()),
  ('7fa00000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'v24-client@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Aria Author'
where id = '7fa00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Ben Member'
where id = '7fa00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Cora Outsider'
where id = '7fa00000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Dane Destination'
where id = '7fa00000-0000-4000-8000-000000000004';
update public.profiles set role_id = (select id from public.roles where name = 'client'), display_name = 'Client Account'
where id = '7fa00000-0000-4000-8000-000000000005';

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select pg_temp.become('7fa00000-0000-4000-8000-000000000001');
create temp table v24_direct on commit drop as
select public.app_start_team_conversation('7fa00000-0000-4000-8000-000000000002') as conversation_id;
create temp table v24_other on commit drop as
select public.app_start_team_conversation('7fa00000-0000-4000-8000-000000000003') as conversation_id;
create temp table v24_destination on commit drop as
select public.app_start_team_conversation('7fa00000-0000-4000-8000-000000000004') as conversation_id;

insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
values
  ('7fa10000-0000-4000-8000-000000000001', gen_random_uuid(), (select conversation_id from v24_direct), '7fa00000-0000-4000-8000-000000000001', 'Can you check the **website report** before sending it?', now() - interval '4 minutes'),
  ('7fa10000-0000-4000-8000-000000000002', gen_random_uuid(), (select conversation_id from v24_direct), '7fa00000-0000-4000-8000-000000000002', 'This message is hidden only for Ben', now() - interval '3 minutes'),
  ('7fa10000-0000-4000-8000-000000000003', gen_random_uuid(), (select conversation_id from v24_other), '7fa00000-0000-4000-8000-000000000001', 'Cross conversation source', now() - interval '2 minutes');

-- Schema and locked-table posture.
select has_column('public', 'team_messages', 'reply_to_message_id', 'reply source is stored');
select has_column('public', 'team_messages', 'reply_quote_text', 'reply excerpt is stored');
select has_column('public', 'team_messages', 'forwarded_from_message_id', 'forward provenance is stored');
select has_column('public', 'team_messages', 'forwarded_from_author_name', 'forward author snapshot is stored');
select has_column('public', 'team_messages', 'deleted_for_everyone_at', 'tombstone time is stored');
select has_column('public', 'team_messages', 'deleted_for_everyone_by', 'tombstone actor is stored');
select is((select relrowsecurity from pg_class where oid = 'public.team_message_hidden_for_profiles'::regclass), true, 'per-profile hide table has RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.team_message_hidden_for_profiles'::regclass), true, 'per-profile hide table forces RLS');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'team_message_hidden_for_profiles'), 0::bigint, 'per-profile hide table has zero policies');
set local role authenticated;
select throws_ok($$ select * from public.team_message_hidden_for_profiles $$, '42501', null, 'browser role cannot read per-profile hide rows');
reset role;
select function_returns('public', 'app_send_team_reply', array['uuid','uuid','text','uuid','text'], 'jsonb', 'reply RPC returns a message envelope');
select function_returns('public', 'app_forward_team_message', array['uuid','uuid','uuid'], 'jsonb', 'forward RPC returns a message envelope');
select function_returns('public', 'app_hide_team_message_for_me', array['uuid'], 'void', 'delete-for-me accepts only a message id');
select function_returns('public', 'app_delete_team_message_for_everyone', array['uuid'], 'void', 'delete-for-everyone accepts only a message id');

-- Reply: same conversation, visible-text excerpt, and authorization.
select pg_temp.become('7fa00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_send_team_reply(gen_random_uuid(), %L::uuid, 'I will finish tonight.', '7fa10000-0000-4000-8000-000000000001'::uuid, 'website   report') $$, (select conversation_id from v24_direct)),
  'a conversation member can reply');
create temp table v24_reply on commit drop as
select id from public.team_messages where reply_to_message_id = '7fa10000-0000-4000-8000-000000000001' limit 1;
select is((select reply_to_message_id from public.team_messages where id = (select id from v24_reply)), '7fa10000-0000-4000-8000-000000000001'::uuid, 'reply keeps its stable same-conversation source');
select is((select reply_quote_text from public.team_messages where id = (select id from v24_reply)), 'website report', 'server normalizes and stores plain selected visible text');
select is((public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages' -> -1 ->> 'reply_source_author_name'), 'Aria Author', 'reply read model resolves the source author server-side');
select throws_ok(
  format($$ select public.app_send_team_reply(gen_random_uuid(), %L::uuid, 'No.', '7fa10000-0000-4000-8000-000000000003'::uuid, 'Cross conversation source') $$, (select conversation_id from v24_direct)),
  '22023', null, 'cross-conversation reply source is rejected');
select throws_ok(
  format($$ select public.app_send_team_reply(gen_random_uuid(), %L::uuid, 'No.', '7fa10000-0000-4000-8000-000000000001'::uuid, %L) $$, (select conversation_id from v24_direct), repeat('x', 501)),
  '22001', null, 'reply quote is bounded to 500 characters');
select throws_ok(
  format($$ select public.app_send_team_reply(gen_random_uuid(), %L::uuid, 'No.', '7fa10000-0000-4000-8000-000000000001'::uuid, '<script>not visible</script>') $$, (select conversation_id from v24_direct)),
  '22023', null, 'arbitrary quote metadata not present in visible source text is rejected');
select pg_temp.become('7fa00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_send_team_reply(gen_random_uuid(), %L::uuid, 'No.', '7fa10000-0000-4000-8000-000000000001'::uuid, 'website report') $$, (select conversation_id from v24_direct)),
  '42501', null, 'non-member cannot reply');
select pg_temp.become('7fa00000-0000-4000-8000-000000000005');
select throws_ok(
  format($$ select public.app_send_team_reply(gen_random_uuid(), %L::uuid, 'No.', '7fa10000-0000-4000-8000-000000000001'::uuid, 'website report') $$, (select conversation_id from v24_direct)),
  '42501', null, 'client cannot reply');

-- Forward: destination membership and copied-content independence.
select pg_temp.become('7fa00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fa10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v24_destination)),
  'readable source can be forwarded to an authorized Team destination');
create temp table v24_forward on commit drop as
select id from public.team_messages where forwarded_from_message_id = '7fa10000-0000-4000-8000-000000000001' limit 1;
select is((select body from public.team_messages where id = (select id from v24_forward)), 'Can you check the **website report** before sending it?', 'forward copies the constrained message body');
select is((select forwarded_from_message_id from public.team_messages where id = (select id from v24_forward)), '7fa10000-0000-4000-8000-000000000001'::uuid, 'forward keeps provenance');
select is((select forwarded_from_author_name from public.team_messages where id = (select id from v24_forward)), 'Aria Author', 'forward snapshots a safe display author');
select pg_temp.become('7fa00000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fa10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v24_destination)),
  '42501', null, 'destination membership is required');
select throws_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fa10000-0000-4000-8000-000000000003'::uuid, %L::uuid) $$, (select conversation_id from v24_direct)),
  '42501', null, 'inaccessible source is rejected');
select pg_temp.become('7fa00000-0000-4000-8000-000000000005');
select throws_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fa10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v24_destination)),
  '42501', null, 'client cannot forward');

-- Delete for me: durable actor-only visibility across every read architecture.
select pg_temp.become('7fa00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_hide_team_message_for_me('7fa10000-0000-4000-8000-000000000002'::uuid) $$, 'current actor can hide a message');
select ok(not (public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages' @> jsonb_build_array(jsonb_build_object('id', '7fa10000-0000-4000-8000-000000000002'))), 'hidden message is absent from actor transcript');
select is(jsonb_array_length(public.app_search_team_conversation_messages((select conversation_id from v24_direct), 'hidden') -> 'results'), 0, 'hidden message is absent from actor search');
select is((public.app_get_team_message_window((select conversation_id from v24_direct), '7fa10000-0000-4000-8000-000000000002'::uuid) ->> 'found')::boolean, false, 'hidden message is absent from actor message window');
select is((select profile_id from public.team_message_hidden_for_profiles where message_id = '7fa10000-0000-4000-8000-000000000002'), '7fa00000-0000-4000-8000-000000000002'::uuid, 'hide row stores the server-derived actor');
select lives_ok($$ select public.app_hide_team_message_for_me('7fa10000-0000-4000-8000-000000000002'::uuid) $$, 'repeating delete-for-me is idempotent');
select is((select count(*) from public.team_message_hidden_for_profiles where message_id = '7fa10000-0000-4000-8000-000000000002'), 1::bigint, 'idempotent hide never duplicates a row');
select pg_temp.become('7fa00000-0000-4000-8000-000000000001');
select ok(public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages' @> jsonb_build_array(jsonb_build_object('id', '7fa10000-0000-4000-8000-000000000002')), 'same message remains visible to the other actor');
select is(jsonb_array_length(public.app_search_team_conversation_messages((select conversation_id from v24_direct), 'hidden') -> 'results'), 1, 'same message remains searchable to the other actor');
select pg_temp.become('7fa00000-0000-4000-8000-000000000005');
select throws_ok($$ select public.app_hide_team_message_for_me('7fa10000-0000-4000-8000-000000000002'::uuid) $$, '42501', null, 'client cannot hide Team messages');

-- Delete for everyone: author-only tombstone, no body/search/reactions leak,
-- replies become deleted-source strips, and forwarded copies remain.
select pg_temp.become('7fa00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_toggle_team_message_reaction('7fa10000-0000-4000-8000-000000000001'::uuid, 'heart') $$, 'recipient may react before deletion');
select throws_ok($$ select public.app_delete_team_message_for_everyone('7fa10000-0000-4000-8000-000000000001'::uuid) $$, '42501', null, 'recipient cannot delete source for everyone');
select pg_temp.become('7fa00000-0000-4000-8000-000000000003');
select throws_ok($$ select public.app_delete_team_message_for_everyone('7fa10000-0000-4000-8000-000000000001'::uuid) $$, '42501', null, 'non-member cannot delete source for everyone');
select pg_temp.become('7fa00000-0000-4000-8000-000000000005');
select throws_ok($$ select public.app_delete_team_message_for_everyone('7fa10000-0000-4000-8000-000000000001'::uuid) $$, '42501', null, 'client cannot delete source for everyone');
select pg_temp.become('7fa00000-0000-4000-8000-000000000001');
select lives_ok($$ select public.app_delete_team_message_for_everyone('7fa10000-0000-4000-8000-000000000001'::uuid) $$, 'original author can delete for everyone');
select is((select body from public.team_messages where id = '7fa10000-0000-4000-8000-000000000001'), 'Message deleted', 'tombstone overwrites original body');
select ok((select deleted_for_everyone_at is not null and deleted_for_everyone_by = '7fa00000-0000-4000-8000-000000000001' from public.team_messages where id = '7fa10000-0000-4000-8000-000000000001'), 'tombstone records server-derived author and time');
select is((select message ->> 'body' from jsonb_array_elements(public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages') as message where message ->> 'id' = '7fa10000-0000-4000-8000-000000000001'), '', 'transcript never returns tombstoned body');
select is((select (message ->> 'deleted_for_everyone')::boolean from jsonb_array_elements(public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages') as message where message ->> 'id' = '7fa10000-0000-4000-8000-000000000001'), true, 'transcript returns explicit tombstone state');
select is(jsonb_array_length(public.app_search_team_conversation_messages((select conversation_id from v24_direct), 'website') -> 'results'), 0, 'deleted body is absent from search');
select is((select count(*) from public.team_message_reactions where message_id = '7fa10000-0000-4000-8000-000000000001' and active), 0::bigint, 'existing reactions are deactivated');
select throws_ok($$ select public.app_toggle_team_message_reaction('7fa10000-0000-4000-8000-000000000001'::uuid, 'fire') $$, '22023', null, 'deleted source rejects new reactions');
select is((select (message ->> 'reply_source_deleted')::boolean from jsonb_array_elements(public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages') as message where message ->> 'id' = (select id::text from v24_reply)), true, 'existing reply reports deleted source');
select is((select message ->> 'reply_quote_text' from jsonb_array_elements(public.app_get_team_conversation((select conversation_id from v24_direct)) -> 'messages') as message where message ->> 'id' = (select id::text from v24_reply)), null, 'deleted source exposes no historical reply excerpt');
select is((select body from public.team_messages where id = (select id from v24_forward)), 'Can you check the **website report** before sending it?', 'already-forwarded copy remains independent after source deletion');
select is((select deleted_for_everyone_at from public.team_messages where id = (select id from v24_forward)), null, 'deleting source does not tombstone forward');

select * from finish();
rollback;
