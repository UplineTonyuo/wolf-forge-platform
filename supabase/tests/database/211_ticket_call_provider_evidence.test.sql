-- Standard PR CI's isolated fixture database only; every change rolls back.
begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc

insert into private.ticket_calls(id,ticket_id,tenant_id,initiated_by,callee_profile_id,request_id,mode,direction,
 created_at,accepted_at,expires_at,state,participants,provider_state,ended_at,outcome,duration_policy)
select ('71000000-0000-4000-8000-00000000211'||n)::uuid,'e1700000-0000-4000-8000-000000001701',
 'f0f0f0f0-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704',
 ('72000000-0000-4000-8000-00000000211'||n)::uuid,'audio','client_to_team',
 now()-interval '20 minutes',now()-interval '19 minutes',now()-interval '5 minutes','ended',
 array['20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704']::uuid[],
 'ended',now()-interval '18 minutes','answered',case when n='2' then 'fixed' else 'manual' end
from unnest(array['1','2','3','4']) n;
insert into private.ticket_call_reservations(call_id,month,reserved_seconds)
 select id,date_trunc('month',now() at time zone 'UTC')::date,1800
 from private.ticket_calls where id::text like '%00211_';
insert into private.ticket_call_cleanup(call_id,result)
 select id,'verified' from private.ticket_calls where id::text like '%00211_';

-- Latest leftAt is deliberately first, so taking the last interval also undercounts.
create temp table rounded_meetings as
select c.duration_policy,jsonb_build_array(jsonb_build_object(
 'id',case c.duration_policy when 'manual' then '74000000-0000-4000-8000-000000002111' else '74000000-0000-4000-8000-000000002112' end,
 'room','wf-call-'||c.id,'start_time',extract(epoch from c.accepted_at),'duration',10,
 'max_participants',2,'ongoing',false,'participants',jsonb_build_array(
  jsonb_build_object('user_id',c.participants[1],'participant_id','later-end','join_time',extract(epoch from c.accepted_at)+1,'duration',10),
  jsonb_build_object('user_id',c.participants[2],'participant_id','earlier-end','join_time',extract(epoch from c.accepted_at),'duration',10)))) payload
from private.ticket_calls c where c.id in ('71000000-0000-4000-8000-000000002111','71000000-0000-4000-8000-000000002112');
create temp table evidence_scan(value jsonb);
grant select on rounded_meetings,evidence_scan to service_role;

update private.ticket_call_account_usage set verified_at=now()-interval '2 hours';
insert into evidence_scan select public.app_claim_ticket_call_provider_scan();
set local role service_role;
select lives_ok($q$select public.app_apply_ticket_call_provider_page((select (value->>'id')::uuid from evidence_scan),null,
 (select payload from rounded_meetings where duration_policy='manual'),true)$q$,
 'manual rounded participant end does not reject the page');
reset role;
select is((select i.left_at-c.accepted_at from private.ticket_call_intervals i join private.ticket_calls c on c.id=i.call_id
 where c.id='71000000-0000-4000-8000-000000002111' and i.profile_id=c.participants[1]),interval '11 seconds',
 'manual participant interval keeps the extra second');
select is((select participant_seconds from private.ticket_calls where id='71000000-0000-4000-8000-000000002111'),20::numeric,
 'manual usage includes both full ten-second intervals');
select ok((select verified from private.ticket_call_provider_seen where meeting_id='74000000-0000-4000-8000-000000002111'),
 'manual rounded evidence is verified rather than conservatively discarded');
select ok((select completed_at is not null and cursor='74000000-0000-4000-8000-000000002111' from private.ticket_call_provider_scans),
 'manual page advances the cursor and completes the scan');
select is((select u.verified_at=s.cutoff from private.ticket_call_account_usage u join private.ticket_call_provider_scans s using(month)),true,
 'manual scan refreshes stale usage verification to its cutoff');

delete from private.ticket_call_provider_scans;
truncate evidence_scan;
update private.ticket_call_account_usage set verified_at=now()-interval '2 hours';
insert into evidence_scan select public.app_claim_ticket_call_provider_scan();
set local role service_role;
select lives_ok($q$select public.app_apply_ticket_call_provider_page((select (value->>'id')::uuid from evidence_scan),null,
 (select payload from rounded_meetings where duration_policy='fixed'),true)$q$,
 'fixed rounded participant end does not reject the page');
reset role;
select is((select i.left_at-c.accepted_at from private.ticket_call_intervals i join private.ticket_calls c on c.id=i.call_id
 where c.id='71000000-0000-4000-8000-000000002112' and i.profile_id=c.participants[1]),interval '11 seconds',
 'fixed participant interval keeps the extra second');
select is((select participant_seconds from private.ticket_calls where id='71000000-0000-4000-8000-000000002112'),20::numeric,
 'fixed usage includes both full ten-second intervals');
select ok((select verified from private.ticket_call_provider_seen where meeting_id='74000000-0000-4000-8000-000000002112'),
 'fixed rounded evidence is verified');
select ok((select completed_at is not null and cursor='74000000-0000-4000-8000-000000002112' from private.ticket_call_provider_scans),
 'fixed page advances the cursor and completes the scan');
select is((select u.verified_at=s.cutoff from private.ticket_call_account_usage u join private.ticket_call_provider_scans s using(month)),true,
 'fixed scan refreshes stale usage verification to its cutoff');

-- Preserve each policy's existing expiry boundary while fixing the evidence envelope.
create temp table expiry_meetings as
select jsonb_agg(jsonb_build_object(
 'id',case c.duration_policy when 'manual' then '74000000-0000-4000-8000-000000002115' else '74000000-0000-4000-8000-000000002116' end,
 'room','wf-call-'||c.id,'start_time',extract(epoch from c.expires_at)-10,'duration',9,
 'max_participants',2,'ongoing',false,'participants',jsonb_build_array(
  jsonb_build_object('user_id',c.participants[1],'participant_id','crosses-expiry','join_time',extract(epoch from c.expires_at)-9,'duration',10),
  jsonb_build_object('user_id',c.participants[2],'participant_id','before-expiry','join_time',extract(epoch from c.expires_at)-10,'duration',9)))) payload
from private.ticket_calls c where c.id in ('71000000-0000-4000-8000-000000002111','71000000-0000-4000-8000-000000002112');
grant select on expiry_meetings to service_role;
delete from private.ticket_call_provider_scans;
truncate evidence_scan;
insert into evidence_scan select public.app_claim_ticket_call_provider_scan();
set local role service_role;
select lives_ok($q$select public.app_apply_ticket_call_provider_page((select (value->>'id')::uuid from evidence_scan),null,
 (select payload from expiry_meetings),true)$q$,'both policies handle provider intervals crossing expiry');
reset role;
select is((select i.left_at-c.expires_at from private.ticket_call_intervals i join private.ticket_calls c on c.id=i.call_id
 where c.id='71000000-0000-4000-8000-000000002111' and i.participant_session='74000000-0000-4000-8000-000000002115:crosses-expiry'),
 interval '1 second','manual interval remains intact beyond admission expiry');
select is((select i.left_at-c.expires_at from private.ticket_call_intervals i join private.ticket_calls c on c.id=i.call_id
 where c.id='71000000-0000-4000-8000-000000002112' and i.participant_session='74000000-0000-4000-8000-000000002116:crosses-expiry'),
 interval '0 seconds','fixed interval retains its established expires_at bound');
select is((select count(*) from private.ticket_call_provider_seen where verified),2::bigint,
 'both expiry-boundary meetings produce verified evidence');

-- The second participant fails after ingest has inserted evidence and the first interval.
create temp table rejected_meeting as
select jsonb_build_object('id','74000000-0000-4000-8000-000000002113','room','wf-call-'||c.id,
 'start_time',extract(epoch from c.accepted_at),'duration',10,'max_participants',2,'ongoing',false,
 'participants',jsonb_build_array(
  jsonb_build_object('user_id',c.participants[1],'participant_id','valid-first','join_time',extract(epoch from c.accepted_at),'duration',10),
  jsonb_build_object('user_id',c.participants[2],'participant_id',repeat('x',100),'join_time',extract(epoch from c.accepted_at),'duration',10))) payload
from private.ticket_calls c where c.id='71000000-0000-4000-8000-000000002113';
-- The known 80 participant-second window may straddle the current UTC month start.
create temp table rejected_bound as
select least(80::numeric,greatest(0::numeric,2*extract(epoch from
 c.accepted_at+interval '25 seconds'-(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')))) seconds
from private.ticket_calls c where c.id='71000000-0000-4000-8000-000000002113';
grant select on rejected_meeting to service_role;
delete from private.ticket_call_provider_scans;
truncate evidence_scan;
update private.ticket_call_account_usage set verified_at=now()-interval '2 hours',unmapped_seconds=0;
insert into evidence_scan select public.app_claim_ticket_call_provider_scan();
set local role service_role;
select lives_ok($q$select public.app_apply_ticket_call_provider_page((select (value->>'id')::uuid from evidence_scan),null,
 jsonb_build_array((select payload from rejected_meeting))||(select payload from rounded_meetings where duration_policy='fixed'),true)$q$,
 '22023 evidence rejection is isolated and the next meeting still applies');
reset role;
select is((select verified from private.ticket_call_provider_seen where meeting_id='74000000-0000-4000-8000-000000002113'),false,
 'rejected mapped meeting is recorded as not verified');
select is((select unmapped_seconds from private.ticket_call_provider_scans),(select seconds from rejected_bound),
 'rejected meeting uses the conservative two-participant duration plus thirty seconds');
select is((select unmapped_seconds from private.ticket_call_account_usage),(select seconds from rejected_bound),
 'complete scan carries the conservative bound into account usage');
select is((select count(*) from private.ticket_call_evidence where call_id='71000000-0000-4000-8000-000000002113'),0::bigint,
 'failed ingest leaves no partial evidence row');
select is((select count(*) from private.ticket_call_intervals where call_id='71000000-0000-4000-8000-000000002113'),0::bigint,
 'failed ingest rolls back the first participant interval');
select is((select participant_seconds from private.ticket_calls where id='71000000-0000-4000-8000-000000002113'),0::numeric,
 'failed ingest leaves the call usage unchanged');
select ok((select completed_at is not null and cursor='74000000-0000-4000-8000-000000002112' from private.ticket_call_provider_scans),
 'rejection cannot prevent the later cursor or scan completion');
select is((select u.verified_at=s.cutoff from private.ticket_call_account_usage u join private.ticket_call_provider_scans s using(month)),true,
 'scan with rejected evidence refreshes usage verification');
select ok((select enabled and account_exclusive from private.ticket_call_environment),
 'a known mapped call rejection does not masquerade as an unknown account room');

-- Deterministic real ingest 42501: malformed acceptance after fixed expiry passes the
-- page's 15-second mapping tolerance, but cannot be bound by the stricter ingester.
update private.ticket_calls set duration_policy='fixed',created_at=now()-interval '30 minutes',expires_at=now()-interval '15 minutes',
 accepted_at=now()-interval '15 minutes'+interval '1 second' where id='71000000-0000-4000-8000-000000002114';
create temp table unbound_meeting as
select jsonb_build_object('id','74000000-0000-4000-8000-000000002114','room','wf-call-'||c.id,
 'start_time',extract(epoch from c.accepted_at),'duration',1,'max_participants',2,'ongoing',false,
 'participants',jsonb_build_array(jsonb_build_object('user_id',c.participants[1],'participant_id','after-expiry',
 'join_time',extract(epoch from c.accepted_at),'duration',1))) payload
from private.ticket_calls c where c.id='71000000-0000-4000-8000-000000002114';
create temp table unbound_bound as
select least(62::numeric,greatest(0::numeric,2*extract(epoch from
 c.accepted_at+interval '16 seconds'-(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')))) seconds
from private.ticket_calls c where c.id='71000000-0000-4000-8000-000000002114';
grant select on unbound_meeting to service_role;
delete from private.ticket_call_provider_scans;
truncate evidence_scan;
update private.ticket_call_account_usage set verified_at=now()-interval '2 hours',unmapped_seconds=0;
insert into evidence_scan select public.app_claim_ticket_call_provider_scan();
set local role service_role;
select lives_ok($q$select public.app_apply_ticket_call_provider_page((select (value->>'id')::uuid from evidence_scan),null,
 jsonb_build_array((select payload from unbound_meeting))||(select payload from rounded_meetings where duration_policy='fixed'),true)$q$,
 '42501 evidence rejection is isolated and the next meeting still applies');
reset role;
select is((select verified from private.ticket_call_provider_seen where meeting_id='74000000-0000-4000-8000-000000002114'),false,
 '42501 mapped meeting is recorded as not verified');
select is((select unmapped_seconds from private.ticket_call_provider_scans),(select seconds from unbound_bound),
 '42501 rejection also receives the existing conservative bound');
select ok((select completed_at is not null and cursor='74000000-0000-4000-8000-000000002112' from private.ticket_call_provider_scans),
 '42501 rejection still permits cursor advancement and completion');
select is((select u.verified_at=s.cutoff from private.ticket_call_account_usage u join private.ticket_call_provider_scans s using(month)),true,
 '42501 rejection still permits usage verification');

-- Only the two expected evidence errors may be isolated; a database fault remains fatal.
create temp table unexpected_meeting as
select jsonb_build_array(jsonb_build_object('id','74000000-0000-4000-8000-000000002119','room','wf-call-'||c.id,
 'start_time',extract(epoch from c.accepted_at),'duration',10,'max_participants',2,'ongoing',false,
 'participants',jsonb_build_array(
  jsonb_build_object('user_id',c.participants[1],'participant_id','collision','join_time',extract(epoch from c.accepted_at),'duration',10),
  jsonb_build_object('user_id',c.participants[2],'participant_id','collision','join_time',extract(epoch from c.accepted_at),'duration',10)))) payload
from private.ticket_calls c where c.id='71000000-0000-4000-8000-000000002113';
grant select on unexpected_meeting to service_role;
delete from private.ticket_call_provider_scans;
truncate evidence_scan;
insert into evidence_scan select public.app_claim_ticket_call_provider_scan();
create temp table unexpected_scan_before as select to_jsonb(s) value from private.ticket_call_provider_scans s;
set local role service_role;
select throws_ok($q$select public.app_apply_ticket_call_provider_page((select (value->>'id')::uuid from evidence_scan),null,
 (select payload from unexpected_meeting),true)$q$,'23505',null,'unexpected ingest errors still propagate');
reset role;
select is((select to_jsonb(s) from private.ticket_call_provider_scans s),(select value from unexpected_scan_before),
 'unexpected ingest failure leaves the scan unchanged');
select is((select count(*) from private.ticket_call_evidence where meeting_id='74000000-0000-4000-8000-000000002119'),0::bigint,
 'unexpected ingest failure also rolls back partial evidence');
select is((select count(*) from private.ticket_call_provider_seen),0::bigint,
 'unexpected ingest failure cannot certify or skip the meeting');

select ok(not has_function_privilege('anon','public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)','execute'),
 'anonymous callers still cannot apply provider history');
select ok(not has_function_privilege('authenticated','public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)','execute'),
 'browser callers still cannot apply provider history');
select ok(has_function_privilege('service_role','public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)','execute'),
 'trusted worker retains its existing grant');
select ok((select prosecdef and proconfig=array['search_path=""'] from pg_proc
 where oid='public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)'::regprocedure),
 'provider page retains SECURITY DEFINER and the empty search path');
select * from finish();
rollback;
