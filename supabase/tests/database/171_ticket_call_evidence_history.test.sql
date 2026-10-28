begin;
select no_plan();
\ir ../../../scripts/qa/fixtures/ticket-calls.sql
create function pg_temp.actor(n text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
    'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
  perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.call_id() returns uuid language sql security definer as $$
  select id from private.ticket_calls where request_id='71000000-0000-4000-8000-000000000001';
$$;
select pg_temp.actor('1701'); set local role authenticated;
select lives_ok($q$select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  '71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','audio')$q$,'request accepted');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select lives_ok($q$select public.app_ticket_call_command('accept',pg_temp.call_id(),'72000000-0000-4000-8000-000000000002')$q$,'callee accepts');
reset role;
select is((select answered_at from private.ticket_calls where id=pg_temp.call_id()),null::timestamptz,'accepted alone is not answered');
update private.ticket_calls set created_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes',
  accepted_at=now()-interval '19 minutes',ring_deadline=now()-interval '19 minutes 20 seconds',
  connect_deadline=now()-interval '18 minutes 15 seconds',provider_state='ready',state='connecting' where id=pg_temp.call_id();
create function pg_temp.evidence() returns jsonb language sql as $$
select jsonb_build_object('account','wolfforge','callId',pg_temp.call_id(),'eventId','fixture-event-1','meetingId','fixture-meeting-1',
  'endedAt',now()-interval '6 minutes','intervals',jsonb_build_array(
    jsonb_build_object('sessionId','caller-session','profileId','20000000-0000-4000-8000-000000001701',
      'joinedAt',now()-interval '18 minutes','leftAt',now()-interval '8 minutes'),
    jsonb_build_object('sessionId','callee-session','profileId','20000000-0000-4000-8000-000000001704',
      'joinedAt',now()-interval '17 minutes','leftAt',now()-interval '9 minutes')));
$$;
select ok(not has_function_privilege('authenticated','public.app_ingest_ticket_call_evidence(jsonb,boolean)','execute'),'browser cannot assert media evidence');
select is(public.app_ingest_ticket_call_evidence(pg_temp.evidence()),true,'trusted finalized meeting evidence ingests');
select is(public.app_ingest_ticket_call_evidence(pg_temp.evidence()),false,'duplicate event is idempotent');
select throws_ok($q$select public.app_ingest_ticket_call_evidence(pg_temp.evidence()||'{"meetingId":"changed"}'::jsonb)$q$,
  '22023','Evidence replay conflicts','changed replay conflicts');
select is((select connected_seconds from private.ticket_calls where id=pg_temp.call_id()),480::numeric,'connected seconds are overlapping presence');
select is((select participant_seconds from private.ticket_calls where id=pg_temp.call_id()),1080::numeric,'budget counts both participants including solo waiting');
select is((select settled_seconds from private.ticket_call_reservations where call_id=pg_temp.call_id()),null::numeric,'a meeting receipt alone retains room lifetime reservation');
select is(public.app_ingest_ticket_call_evidence(pg_temp.evidence(),true),false,'post-expiry complete reconciliation settles replay safely');
select is((select settled_seconds from private.ticket_call_reservations where call_id=pg_temp.call_id()),1080::numeric,'complete room reconciliation settles actual participant seconds');
select is((select count(*) from private.ticket_call_claims where call_id=pg_temp.call_id()),0::bigint,'settled expiry releases participant claims');
select pg_temp.actor('1703'); set local role authenticated;
select is((public.app_ticket_call_owner_summary(date_trunc('month',now())::date)->>'made')::integer,1,'owner made count');
select is((public.app_ticket_call_owner_summary(date_trunc('month',now())::date)->>'answered')::integer,1,'owner answered count');
select is((public.app_ticket_call_owner_summary(date_trunc('month',now())::date)->>'connectedSeconds')::numeric,480::numeric,'owner summary has connected rather than participant seconds');
select is(public.app_ticket_call_history('e1700000-0000-4000-8000-000000001701'),'[]'::jsonb,'owner aggregate entitlement is not private call participation');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_owner_summary(date_trunc('month',now())::date)$q$,'42501','Owner required','non-owner cannot read owner summary');
select is(jsonb_array_length(public.app_ticket_call_history('e1700000-0000-4000-8000-000000001701')),1,'actual participant reads own history');
reset role;
select pg_temp.actor('1702'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_history('e1700000-0000-4000-8000-000000001701')$q$,'42501','Call unavailable','same-company non-owner client cannot read private history');
reset role;
select ok(exists(select 1 from cron.job where jobname='wf-ticket-calls-deadlines-v1' and schedule='10 seconds'),'named deadline job has second-based cadence');
select ok(exists(select 1 from cron.job where jobname='wf-ticket-calls-retention-v1'),'named retention job exists');
select is(private.prune_ticket_call_history(),0,'recent evidence is retained');
update private.ticket_calls set created_at=created_at-interval '13 months',expires_at=expires_at-interval '13 months',
  ended_at=ended_at-interval '13 months' where id=pg_temp.call_id();
select is(private.prune_ticket_call_history(),1,'settled terminal history expires after twelve months');
select * from finish();
rollback;
