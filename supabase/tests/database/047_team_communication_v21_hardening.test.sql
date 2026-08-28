begin;

select plan(49);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7ed00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'v21-owner@example.invalid', now(), now()),
  ('7ed00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'v21-alex@example.invalid', now(), now()),
  ('7ed00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'v21-blair@example.invalid', now(), now()),
  ('7ed00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'v21-client@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Vera Owner'
where id = '7ed00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Alex Staff'
where id = '7ed00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Blair Staff'
where id = '7ed00000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'client'), display_name = 'Casey Client'
where id = '7ed00000-0000-4000-8000-000000000004';

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select has_table('public'::name, 'team_message_deliveries'::name, 'offline delivery state has a dedicated table');
select is((select count(*) from pg_class where oid = 'public.team_message_deliveries'::regclass and relrowsecurity and relforcerowsecurity), 1::bigint, 'delivery storage enables and forces RLS');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'team_message_deliveries' and grantee in ('anon', 'authenticated', 'service_role')), 0::bigint, 'no API role has delivery-table privileges');
select function_returns('public', 'app_materialize_team_message_digests', array[]::text[], 'integer', 'digest materialization returns a bounded count');
select ok(has_function_privilege('authenticated', 'public.app_materialize_team_message_digests()', 'EXECUTE'), 'authenticated may run the actor-derived materializer');

select pg_temp.become('7ed00000-0000-4000-8000-000000000001');
select is((select email from public.app_list_team_members() where profile_id = '7ed00000-0000-4000-8000-000000000002'), 'v21-alex@example.invalid', 'the active internal picker can search a teammate email');
select is((select count(*) from public.app_list_team_members() where profile_id = '7ed00000-0000-4000-8000-000000000004'), 0::bigint, 'the Team roster never exposes a client');

create temp table v21_direct on commit drop as
select public.app_start_team_conversation('7ed00000-0000-4000-8000-000000000002') as conversation_id;

select pg_temp.become('7ed00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_touch_team_presence('7ed10000-0000-4000-8000-000000000002') $$, 'an online recipient has a fresh presence connection');
select pg_temp.become('7ed00000-0000-4000-8000-000000000001');
select lives_ok($$ select public.app_send_team_message('7ed20000-0000-4000-8000-000000000001', (select conversation_id from v21_direct), 'Live hello') $$, 'an ordinary live message sends');
select is((select count(*) from public.team_message_deliveries where message_id = (select id from public.team_messages where request_id = '7ed20000-0000-4000-8000-000000000001')), 0::bigint, 'a live recipient does not enter the offline digest ledger');
select is((select count(*) from public.notifications where entity_type = 'team_message'), 0::bigint, 'a live message creates no bell row');

select pg_temp.become('7ed00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_mark_team_conversation_read((select conversation_id from v21_direct)) $$, 'the live recipient reads the message before going offline');
select lives_ok($$ select public.app_disconnect_team_presence('7ed10000-0000-4000-8000-000000000002') $$, 'the recipient can become offline');
select pg_temp.become('7ed00000-0000-4000-8000-000000000001');
select lives_ok($$ select public.app_send_team_message('7ed20000-0000-4000-8000-000000000002', (select conversation_id from v21_direct), '**Bold** [safe](https://example.com)') $$, 'an offline message sends');
update public.team_messages set created_at = clock_timestamp()
where request_id = '7ed20000-0000-4000-8000-000000000002';
select is((select count(*) from public.team_message_deliveries where message_id = (select id from public.team_messages where request_id = '7ed20000-0000-4000-8000-000000000002')), 1::bigint, 'one offline delivery marker is created');
select lives_ok($$ select public.app_send_team_message('7ed20000-0000-4000-8000-000000000002', (select conversation_id from v21_direct), '**Bold** [safe](https://example.com)') $$, 'retrying the send replays it');
select is((select count(*) from public.team_message_deliveries where message_id = (select id from public.team_messages where request_id = '7ed20000-0000-4000-8000-000000000002')), 1::bigint, 'the retry cannot duplicate its delivery marker');
select is((select count(*) from public.notifications where entity_type = 'team_message'), 0::bigint, 'an offline message still creates no per-message bell row');

update public.team_message_deliveries set eligible_at = clock_timestamp() - interval '31 minutes'
where message_id = (select id from public.team_messages where request_id = '7ed20000-0000-4000-8000-000000000002');
select pg_temp.become('7ed00000-0000-4000-8000-000000000002');
select is(public.app_materialize_team_message_digests(), 1, 'one stale unread conversation is materialized');
select is((select count(*) from public.notifications where event_key like 'team-message-digest:%'), 1::bigint, 'one digest row represents the conversation');
select is((select title from public.notifications where event_key like 'team-message-digest:%'), 'Vera Owner sent you a message', 'a one-message direct digest uses direct wording');
select is((select body from public.notifications where event_key like 'team-message-digest:%'), 'Bold safe', 'digest preview strips Markdown and link destinations');
select is(public.app_materialize_team_message_digests(), 1, 'a repeated materialization safely revisits the same unread group');
select is((select count(*) from public.notifications where event_key like 'team-message-digest:%'), 1::bigint, 'a repeated sync cannot duplicate the digest row');
select lives_ok($$ select public.app_mark_team_conversation_read((select conversation_id from v21_direct)) $$, 'opening the conversation resolves its digest');
select ok((select read_at is not null from public.notifications where event_key like 'team-message-digest:%'), 'the resolved digest is marked read');
select ok((select resolved_at is not null from public.team_message_deliveries where message_id = (select id from public.team_messages where request_id = '7ed20000-0000-4000-8000-000000000002')), 'the delivery marker is resolved too');

select pg_temp.become('7ed00000-0000-4000-8000-000000000001');
select lives_ok($$ select public.app_send_team_message('7ed20000-0000-4000-8000-000000000003', (select conversation_id from v21_direct), '- First item') $$, 'a first message in a new unread cycle sends');
select lives_ok($$ select public.app_send_team_message('7ed20000-0000-4000-8000-000000000004', (select conversation_id from v21_direct), 'Second _item_') $$, 'a second message in the cycle sends');
update public.team_messages
set created_at = case request_id
  when '7ed20000-0000-4000-8000-000000000003' then clock_timestamp() + interval '1 millisecond'
  else clock_timestamp() + interval '2 milliseconds'
end
where request_id in ('7ed20000-0000-4000-8000-000000000003', '7ed20000-0000-4000-8000-000000000004');
update public.team_message_deliveries set eligible_at = clock_timestamp() - interval '31 minutes'
where message_id in (select id from public.team_messages where request_id in ('7ed20000-0000-4000-8000-000000000003', '7ed20000-0000-4000-8000-000000000004'));
select pg_temp.become('7ed00000-0000-4000-8000-000000000002');
select is(public.app_materialize_team_message_digests(), 1, 'the second stale unread cycle materializes as one group');
select is((select count(*) from public.notifications where event_key like 'team-message-digest:%'), 2::bigint, 'the new read cycle receives one new digest');
select is((select title from public.notifications where read_at is null and event_key like 'team-message-digest:%'), 'Vera Owner sent you 2 messages', 'a multi-message direct digest reports its count');
select is(array_length(string_to_array((select body from public.notifications where read_at is null and event_key like 'team-message-digest:%'), E'\n'), 1), 2, 'a digest contains at most two preview lines');

select pg_temp.become('7ed00000-0000-4000-8000-000000000001');
select lives_ok($$ select public.app_create_team_task('7ed30000-0000-4000-8000-000000000001', (select conversation_id from v21_direct), 'Direct follow-up', '7ed00000-0000-4000-8000-000000000002') $$, 'a direct task is created');
select is((select count(*) from public.notifications where event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000001')), 1::bigint, 'a direct task notifies only its assignee');
select is((select title from public.notifications where event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000001')), 'Vera Owner assigned you: Direct follow-up', 'the direct assignee receives strong wording');
select lives_ok($$ select public.app_create_team_task('7ed30000-0000-4000-8000-000000000001', (select conversation_id from v21_direct), 'Direct follow-up', '7ed00000-0000-4000-8000-000000000002') $$, 'a direct task retry replays');
select is((select count(*) from public.notifications where event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000001')), 1::bigint, 'the direct retry cannot duplicate its notification');
select lives_ok($$ select public.app_create_team_task('7ed30000-0000-4000-8000-000000000002', (select conversation_id from v21_direct), 'My own note', '7ed00000-0000-4000-8000-000000000001') $$, 'a creator may assign a direct task to self');
select is((select count(*) from public.notifications where event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000002')), 0::bigint, 'a self-assigned direct task creates no useless self-notification');

create temp table v21_group on commit drop as
select public.app_create_team_group('Launch Crew', array['7ed00000-0000-4000-8000-000000000002'::uuid, '7ed00000-0000-4000-8000-000000000003'::uuid]) as conversation_id;
select lives_ok($$ select public.app_create_team_task('7ed30000-0000-4000-8000-000000000003', (select conversation_id from v21_group), 'Group launch task', '7ed00000-0000-4000-8000-000000000002') $$, 'a canonical group task is created');
select is((select count(*) from public.notifications where event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000003')), 2::bigint, 'all non-creator active group members receive one task notification');
select is((select title from public.notifications where recipient_profile_id = '7ed00000-0000-4000-8000-000000000002' and event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000003')), 'Vera Owner assigned you: Group launch task', 'the group assignee receives strong wording');
select is((select title from public.notifications where recipient_profile_id = '7ed00000-0000-4000-8000-000000000003' and event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000003')), 'New group task · Assigned to Alex Staff', 'another group member receives informational wording');
select lives_ok($$ select public.app_create_team_task('7ed30000-0000-4000-8000-000000000003', (select conversation_id from v21_group), 'Group launch task', '7ed00000-0000-4000-8000-000000000002') $$, 'a group task retry replays');
select is((select count(*) from public.notifications where event_key like 'team-task-created:%' and entity_id = (select id from public.team_tasks where request_id = '7ed30000-0000-4000-8000-000000000003')), 2::bigint, 'the group retry cannot duplicate recipient rows');

select pg_temp.become('7ed00000-0000-4000-8000-000000000004');
select throws_ok($$ select public.app_materialize_team_message_digests() $$, '42501', null, 'a client cannot materialize internal message digests');
select throws_ok($$ select public.app_list_team_members() $$, '42501', null, 'a client cannot search the internal roster');

select pg_temp.become('7ed00000-0000-4000-8000-000000000001');
select ok((select last_message_preview from public.app_list_team_conversations() where conversation_id = (select conversation_id from v21_direct)) not like '%**%' and (select last_message_preview from public.app_list_team_conversations() where conversation_id = (select conversation_id from v21_direct)) not like '%](%', 'conversation previews are plain text even when stored messages are formatted');

select * from finish();
rollback;
