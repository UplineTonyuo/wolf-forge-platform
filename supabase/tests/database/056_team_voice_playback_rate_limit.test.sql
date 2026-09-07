begin;

select plan(9);

-- KI-057 (DB-only half): app_get_team_voice_playback now throttles at
-- 12 requests per actor per rolling 1-minute window, via the same
-- private.consume_rate_limit primitive every other Team throttle uses.
-- This file is paired 1:1 with
-- supabase/migrations/20260907160000_team_voice_playback_rate_limit.sql
-- and does not modify 055_team_voice_messages_and_pins.test.sql, which
-- already covers this RPC's non-throttle behavior (allowed member call,
-- non-member 42501 denial) against the historical, already-applied
-- migration.

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('8bb00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'voice-rl-owner@example.invalid', now(), now()),
  ('8bb00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'voice-rl-member-a@example.invalid', now(), now()),
  ('8bb00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'voice-rl-member-b@example.invalid', now(), now()),
  ('8bb00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'voice-rl-outsider@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Voice RL Owner'
where id = '8bb00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Voice RL Member A'
where id = '8bb00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Voice RL Member B'
where id = '8bb00000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Voice RL Outsider'
where id = '8bb00000-0000-4000-8000-000000000004';

create or replace function pg_temp.become(p_user uuid, p_role text default 'authenticated')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
$$;

-- -----------------------------------------------------------------------
-- Fixture: a group conversation with two ordinary members, one voice
-- message the owner records and finalizes, exactly the flow
-- 055_team_voice_messages_and_pins.test.sql already validates end to end.
-- -----------------------------------------------------------------------

select pg_temp.become('8bb00000-0000-4000-8000-000000000001');
create temp table voice_rl_group on commit drop as
select public.app_create_team_group('Voice RL Group', array[
  '8bb00000-0000-4000-8000-000000000002'::uuid,
  '8bb00000-0000-4000-8000-000000000003'::uuid
]) as conversation_id;

create temp table voice_rl_upload on commit drop as
select public.app_prepare_team_voice_upload((select conversation_id from voice_rl_group), 'audio/webm;codecs=opus') as claim;

create temp table voice_rl_message on commit drop as
select public.app_finalize_team_voice_upload(
  (select (claim ->> 'upload_id')::uuid from voice_rl_upload), 4200, 1000, 'audio/webm', 90
) as result;

select is(
  (select message_type from public.team_messages where id = (select (result ->> 'id')::uuid from voice_rl_message)),
  'voice',
  'fixture: owner finalizes one canonical voice message to authorize playback against'
);

select is(
  (select provolatile from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'app_get_team_voice_playback'),
  'v',
  'app_get_team_voice_playback is VOLATILE now that it records a rate-limit counter, matching this codebase''s own "a function that records counters must be VOLATILE" convention'
);

-- -----------------------------------------------------------------------
-- 1. Authorized actor can make requests through the allowed threshold.
-- -----------------------------------------------------------------------

select pg_temp.become('8bb00000-0000-4000-8000-000000000002');

select lives_ok(
  format(
    $outer$do $inner$
      declare i integer;
      begin
        for i in 1..12 loop
          perform public.app_get_team_voice_playback(%L::uuid);
        end loop;
      end
    $inner$$outer$,
    (select (result ->> 'id')::uuid from voice_rl_message)
  ),
  'a conversation member exhausts exactly the configured 12/minute allowance without being refused'
);

-- -----------------------------------------------------------------------
-- 2. Request 13 in the same one-minute window is throttled.
-- -----------------------------------------------------------------------

select throws_ok(
  format($$ select public.app_get_team_voice_playback(%L::uuid) $$, (select (result ->> 'id')::uuid from voice_rl_message)),
  'WF429', 'rate limit exceeded',
  'the 13th playback request in the same window is refused by the new throttle'
);

select is(
  (select max(hits) from private.rate_limit_counters
    where scope = 'team.voice.playback.actor.minute' and subject = '8bb00000-0000-4000-8000-000000000002'),
  12,
  'the rejected 13th attempt rolls its own increment back, so the counter settles at the configured ceiling'
);

-- -----------------------------------------------------------------------
-- 3. A different authorized actor is not blocked by actor A's exhausted
--    bucket — the throttle is keyed per actor, not per conversation or
--    per message.
-- -----------------------------------------------------------------------

select pg_temp.become('8bb00000-0000-4000-8000-000000000003');

select lives_ok(
  format($$ select public.app_get_team_voice_playback(%L::uuid) $$, (select (result ->> 'id')::uuid from voice_rl_message)),
  'a second conversation member is not blocked by the first member''s exhausted allowance'
);

-- -----------------------------------------------------------------------
-- 4. Existing membership-denial behavior is preserved unchanged.
-- -----------------------------------------------------------------------

select pg_temp.become('8bb00000-0000-4000-8000-000000000004');

select throws_ok(
  format($$ select public.app_get_team_voice_playback(%L::uuid) $$, (select (result ->> 'id')::uuid from voice_rl_message)),
  '42501', null,
  'an outsider still cannot authorize playback at all, throttle aside — membership authorization is unchanged'
);

select is(
  (select count(*) from private.rate_limit_counters
    where scope = 'team.voice.playback.actor.minute' and subject = '8bb00000-0000-4000-8000-000000000004'),
  0::bigint,
  'a membership refusal never reaches the throttle, so the outsider consumes no allowance at all'
);

-- Determinism proof, not a wall-clock assumption: every one of actor A's
-- 13 calls above landed in the exact same fixed bucket
-- (private.consume_rate_limit keys window_start on floor(epoch/60)*60), so
-- the 13th call was refused because the counter genuinely reached the
-- ceiling inside one window, not because of timing luck. This test never
-- sleeps and never depends on how fast the runner executes it.
select is(
  (select count(distinct window_start) from private.rate_limit_counters
    where scope = 'team.voice.playback.actor.minute' and subject = '8bb00000-0000-4000-8000-000000000002'),
  1::bigint,
  'all 13 of actor A''s calls landed in one fixed bucket, proving the threshold assertion is deterministic, not a timing race'
);

select * from finish();
rollback;
