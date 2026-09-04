begin;

select plan(46);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('8aa00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'voice-owner@example.invalid', now(), now()),
  ('8aa00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'voice-admin@example.invalid', now(), now()),
  ('8aa00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'voice-member@example.invalid', now(), now()),
  ('8aa00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'voice-outsider@example.invalid', now(), now()),
  ('8aa00000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'voice-client@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Voice Owner'
where id = '8aa00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'admin'), display_name = 'Voice Admin'
where id = '8aa00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Voice Member'
where id in ('8aa00000-0000-4000-8000-000000000003', '8aa00000-0000-4000-8000-000000000004');
update public.profiles set role_id = (select id from public.roles where name = 'client'), display_name = 'Voice Client'
where id = '8aa00000-0000-4000-8000-000000000005';

create or replace function pg_temp.become(p_user uuid, p_role text default 'authenticated')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
$$;

select pg_temp.become('8aa00000-0000-4000-8000-000000000001');
create temp table voice_group on commit drop as
select public.app_create_team_group('Voice Group', array[
  '8aa00000-0000-4000-8000-000000000002'::uuid,
  '8aa00000-0000-4000-8000-000000000003'::uuid
]) as conversation_id;
select public.app_grant_team_conversation_admin(
  (select conversation_id from voice_group),
  '8aa00000-0000-4000-8000-000000000002',
  '{"manage_members": true}'::jsonb
);

select has_table('public', 'team_message_pins', 'pin history relation exists');
select has_table('private', 'team_voice_uploads', 'voice upload claims relation exists');
select is((select public from storage.buckets where id = 'team-voice-messages'), false, 'voice bucket is private');
select is((select file_size_limit from storage.buckets where id = 'team-voice-messages'), 5242880::bigint, 'voice bucket enforces 5 MB');
select is((select relrowsecurity from pg_class where oid = 'public.team_message_pins'::regclass), true, 'pin history has RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.team_message_pins'::regclass), true, 'pin history forces RLS');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'team_message_pins'), 0::bigint, 'pin history has no direct policies');
set local role authenticated;
select throws_ok($$ select * from public.team_message_pins $$, '42501', null, 'authenticated browser cannot read pin rows directly');
select is((select count(*) from storage.objects where bucket_id = 'team-voice-messages'), 0::bigint, 'authenticated browser sees no private voice objects directly');
reset role;

select is((public.app_get_team_conversation((select conversation_id from voice_group)) -> 'my_capabilities' ->> 'can_send_voice')::boolean, true, 'conversation owner can send voice');
select is((public.app_get_team_conversation((select conversation_id from voice_group)) -> 'my_capabilities' ->> 'can_manage_pins')::boolean, true, 'conversation owner can manage pins');
create temp table owner_upload on commit drop as
select public.app_prepare_team_voice_upload((select conversation_id from voice_group), 'audio/webm;codecs=opus') as claim;
select matches((select claim ->> 'storage_path' from owner_upload), '^' || (select conversation_id::text from voice_group) || '/[0-9a-f-]+/audio\.webm$', 'owner receives a server-generated constrained path');

select pg_temp.become('8aa00000-0000-4000-8000-000000000002');
select is((public.app_get_team_conversation((select conversation_id from voice_group)) -> 'my_capabilities' ->> 'can_send_voice')::boolean, true, 'delegated conversation admin can send voice');
select lives_ok(format($$ select public.app_prepare_team_voice_upload(%L::uuid, 'audio/ogg') $$, (select conversation_id from voice_group)), 'delegated admin can prepare voice');
select throws_ok(format($$ select public.app_finalize_team_voice_upload(%L::uuid, 1000, 1000, 'audio/webm', 90) $$, (select (claim ->> 'upload_id')::uuid from owner_upload)), '42501', null, 'actor spoofing fails: admin cannot finalize owner upload');

-- Runtime proof (not a SQL-text assertion) that upload ownership cannot be
-- spoofed by any actor other than the one auth.uid() actually names: prepare
-- as the real owner, attempt finalize as a wrong admin, a wrong plain member,
-- and a wrong outsider, confirm the claim is untouched by every rejection,
-- then prove the real creator still finalizes cleanly afterward.
select pg_temp.become('8aa00000-0000-4000-8000-000000000001');
create temp table spoof_upload on commit drop as
select public.app_prepare_team_voice_upload((select conversation_id from voice_group), 'audio/webm;codecs=opus') as claim;

select pg_temp.become('8aa00000-0000-4000-8000-000000000002');
select throws_ok(format($$ select public.app_finalize_team_voice_upload(%L::uuid, 4200, 1000, 'audio/webm', 90) $$, (select (claim ->> 'upload_id')::uuid from spoof_upload)), '42501', null, 'delegated admin (wrong actor, same conversation) cannot finalize another actor''s upload');

select pg_temp.become('8aa00000-0000-4000-8000-000000000003');
select throws_ok(format($$ select public.app_finalize_team_voice_upload(%L::uuid, 4200, 1000, 'audio/webm', 90) $$, (select (claim ->> 'upload_id')::uuid from spoof_upload)), '42501', null, 'plain conversation member (wrong actor, no admin capability) cannot finalize another actor''s upload');

select pg_temp.become('8aa00000-0000-4000-8000-000000000004');
select throws_ok(format($$ select public.app_finalize_team_voice_upload(%L::uuid, 4200, 1000, 'audio/webm', 90) $$, (select (claim ->> 'upload_id')::uuid from spoof_upload)), '42501', null, 'outsider (wrong actor, not even a conversation member) cannot finalize another actor''s upload');

select is((select status from private.team_voice_uploads where id = (select (claim ->> 'upload_id')::uuid from spoof_upload)), 'pending', 'rejected finalize attempts leave the upload claim untouched');
select is((select message_id from private.team_voice_uploads where id = (select (claim ->> 'upload_id')::uuid from spoof_upload)), null, 'rejected finalize attempts create no message');

select pg_temp.become('8aa00000-0000-4000-8000-000000000001');
create temp table spoof_result on commit drop as
select public.app_finalize_team_voice_upload(
  (select (claim ->> 'upload_id')::uuid from spoof_upload), 4200, 1000, 'audio/webm', 90
) as result;
select is((select message_type from public.team_messages where id = (select (result ->> 'id')::uuid from spoof_result)), 'voice', 'the real creator finalizes successfully once all other validation passes, after every spoof attempt was rejected');

select pg_temp.become('8aa00000-0000-4000-8000-000000000003');
select is((public.app_get_team_conversation((select conversation_id from voice_group)) -> 'my_capabilities' ->> 'can_send_voice')::boolean, false, 'normal member has no voice capability');
select throws_ok(format($$ select public.app_prepare_team_voice_upload(%L::uuid, 'audio/webm') $$, (select conversation_id from voice_group)), '42501', null, 'normal member cannot prepare voice');
select throws_ok(format($$ select public.app_pin_team_message((select id from public.team_messages where conversation_id = %L limit 1)) $$, (select conversation_id from voice_group)), '42501', null, 'normal member cannot pin');

select pg_temp.become('8aa00000-0000-4000-8000-000000000004');
select throws_ok(format($$ select public.app_prepare_team_voice_upload(%L::uuid, 'audio/webm') $$, (select conversation_id from voice_group)), '42501', null, 'nonmember cannot prepare voice');

select pg_temp.become('8aa00000-0000-4000-8000-000000000005');
select throws_ok(format($$ select public.app_prepare_team_voice_upload(%L::uuid, 'audio/webm') $$, (select conversation_id from voice_group)), '42501', null, 'client cannot prepare voice');

select pg_temp.become('8aa00000-0000-4000-8000-000000000001');
select throws_ok(format($$ select public.app_prepare_team_voice_upload(%L::uuid, 'audio/wav') $$, (select conversation_id from voice_group)), '22023', null, 'unsupported MIME is rejected');
select throws_ok(format($$ select public.app_finalize_team_voice_upload(%L::uuid, 300001, 1000, 'audio/webm', 90) $$, (select (claim ->> 'upload_id')::uuid from owner_upload)), '22023', null, 'recording over five minutes is rejected');
create temp table voice_message on commit drop as
select public.app_finalize_team_voice_upload(
  (select (claim ->> 'upload_id')::uuid from owner_upload), 4200, 1000, 'audio/webm', 90
) as result;
select is((select message_type from public.team_messages where id = (select (result ->> 'id')::uuid from voice_message)), 'voice', 'owner finalizes canonical voice message');
select lives_ok(format($$ select public.app_get_team_voice_playback(%L::uuid) $$, (select (result ->> 'id')::uuid from voice_message)), 'conversation member can authorize signed playback context');
select pg_temp.become('8aa00000-0000-4000-8000-000000000004');
select throws_ok(format($$ select public.app_get_team_voice_playback(%L::uuid) $$, (select (result ->> 'id')::uuid from voice_message)), '42501', null, 'outside user cannot authorize voice playback');

select pg_temp.become('8aa00000-0000-4000-8000-000000000001');
create temp table text_message on commit drop as
select public.app_send_team_message(gen_random_uuid(), (select conversation_id from voice_group), 'Pinned launch note') as result;
create temp table active_pin on commit drop as
select public.app_pin_team_message((select (result ->> 'id')::uuid from text_message)) as result;
select is(jsonb_array_length(public.app_get_team_conversation((select conversation_id from voice_group)) -> 'pins'), 1, 'owner pin is visible in conversation projection');
select is(jsonb_array_length(public.app_team_live_sync((select conversation_id from voice_group), null) -> 'detail' -> 'pins'), 1, 'live sync carries pin changes without a full refresh');
select lives_ok(format($$ select public.app_pin_team_message(%L::uuid) $$, (select (result ->> 'id')::uuid from text_message)), 'pin replay is idempotent');
select is((select count(*) from public.team_message_pins where unpinned_at is null and message_id = (select (result ->> 'id')::uuid from text_message)), 1::bigint, 'duplicate active pin is prevented');

select pg_temp.become('8aa00000-0000-4000-8000-000000000002');
select lives_ok(format($$ select public.app_unpin_team_message(%L::uuid) $$, (select (result ->> 'id')::uuid from active_pin)), 'admin can unpin');
select is((select count(*) from public.team_message_pins where unpinned_at is not null and message_id = (select (result ->> 'id')::uuid from text_message)), 1::bigint, 'unpin preserves history');
select lives_ok(format($$ select public.app_pin_team_message(%L::uuid) $$, (select (result ->> 'id')::uuid from text_message)), 'admin can create a newer active pin event');
select is((public.app_get_team_conversation((select conversation_id from voice_group)) -> 'pins' -> 0 ->> 'unpinned_at'), null, 'current pin orders before previous history');

select pg_temp.become('8aa00000-0000-4000-8000-000000000003');
select throws_ok(format($$ select public.app_unpin_team_message(%L::uuid) $$, (select id from public.team_message_pins where unpinned_at is null limit 1)), '42501', null, 'normal member cannot unpin');
select is(jsonb_array_length(public.app_get_team_conversation((select conversation_id from voice_group)) -> 'pins'), 2, 'member can view current and previous pin history');

select pg_temp.become('8aa00000-0000-4000-8000-000000000004');
select throws_ok(format($$ select public.app_pin_team_message(%L::uuid) $$, (select (result ->> 'id')::uuid from text_message)), '42501', null, 'cross-conversation pinning fails');

select pg_temp.become('8aa00000-0000-4000-8000-000000000001');
update public.team_messages set voice_expires_at = clock_timestamp() - interval '1 day'
where id = (select (result ->> 'id')::uuid from voice_message);
select pg_temp.become('8aa00000-0000-4000-8000-000000000001', 'service_role');
select is((select count(*) from public.app_list_team_voice_cleanup_batch(100) where object_kind = 'message'), 1::bigint, 'cleanup selects expired voice only');
select is((select count(*) from public.app_list_team_voice_cleanup_batch(100) where storage_path is null), 0::bigint, 'cleanup never selects unrelated text rows');
select lives_ok(format($$ select public.app_complete_team_voice_cleanup('message', %L::uuid, %L) $$,
  (select (result ->> 'id')::uuid from voice_message),
  (select voice_storage_path from public.team_messages where id = (select (result ->> 'id')::uuid from voice_message))), 'cleanup marks deleted Storage metadata');
select lives_ok(format($$ select public.app_complete_team_voice_cleanup('message', %L::uuid, 'already-missing') $$,
  (select (result ->> 'id')::uuid from voice_message)), 'cleanup completion is idempotent');

select * from finish();
rollback;
