begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
select ok(not has_function_privilege('authenticated','public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)','execute'),'browser cannot certify provider history');
select ok(not has_table_privilege('service_role','private.ticket_call_provider_scans','select'),'scan state has no API table grant');
-- Two expired, readied rooms with no history. Provider history can omit short joins.
insert into private.ticket_calls(id,ticket_id,tenant_id,initiated_by,callee_profile_id,request_id,mode,direction,
 created_at,accepted_at,expires_at,state,participants,provider_state,ended_at,outcome)
select ('71000000-0000-4000-8000-00000000196'||n)::uuid,('e1700000-0000-4000-8000-00000000170'||n)::uuid,
 'f0f0f0f0-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704',
 ('72000000-0000-4000-8000-00000000196'||n)::uuid,'audio','client_to_team',now()-interval '40 minutes',now()-interval '39 minutes',
 now()-interval '25 minutes','ended',array['20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704']::uuid[],'ready',now()-interval '25 minutes','expired'
from unnest(array['1','2']) n;
insert into private.ticket_call_reservations select id,date_trunc('month',now() at time zone 'UTC')::date,1800,null from private.ticket_calls where id::text like '%00196_';
insert into private.ticket_call_cleanup(call_id,result) select id,'verified' from private.ticket_calls where id::text like '%00196_';
insert into private.ticket_call_claims values('20000000-0000-4000-8000-000000001701','71000000-0000-4000-8000-000000001961'),
 ('20000000-0000-4000-8000-000000001704','71000000-0000-4000-8000-000000001961');
create temp table scan as select public.app_claim_ticket_call_provider_scan() value;
select ok(value is not null,'trusted environment receives a scan lease') from scan;
select is(public.app_claim_ticket_call_provider_scan(),null::jsonb,'overlapping worker gets no lease');
select throws_ok($q$select public.app_apply_ticket_call_provider_page(extensions.gen_random_uuid(),null,'[]',true)$q$,'22023','Invalid provider page','unclaimed worker cannot update usage');
select ok(public.app_apply_ticket_call_provider_page((value->>'id')::uuid,null,'[]',true),'empty complete history can finalize conservative accounting') from scan;
select is((select count(*) from private.ticket_call_claims where call_id::text like '%00196_'),0::bigint,'expired verified rooms release participant busy claims');
select is((select count(*) from private.ticket_call_reservations where call_id::text like '%00196_' and settled_seconds=1800),2::bigint,'both calls keep full reservation rather than assuming zero use');
select is((select count(*) from private.ticket_call_events where call_id::text like '%00196_' and event='conservative_usage_settled'),2::bigint,'multi-call completion has independent receipts');
select is(public.app_claim_ticket_call_provider_scan(),null::jsonb,'completed scans do not start an immediate provider loop');

insert into private.ticket_calls(id,ticket_id,tenant_id,initiated_by,callee_profile_id,request_id,mode,direction,created_at,accepted_at,expires_at,state,participants,
 provider_state,caller_session_id,callee_session_id,caller_device_id,callee_device_id)
values('71000000-0000-4000-8000-000000001963','e1700000-0000-4000-8000-000000001701','f0f0f0f0-0000-4000-8000-000000001701',
 '20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704','72000000-0000-4000-8000-000000001963','audio','client_to_team',
 now(),now(),now()+interval '15 minutes','connecting',array['20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704']::uuid[],
 'ready','33000000-0000-4000-8000-000000001701','33000000-0000-4000-8000-000000001704','73000000-0000-4000-8000-000000001963','73000000-0000-4000-8000-000000001964');
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000001701","role":"authenticated","session_id":"33000000-0000-4000-8000-000000001701"}',true);
select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
set local role authenticated;
select lives_ok($q$select public.app_ticket_call_media_probe('71000000-0000-4000-8000-000000001963','73000000-0000-4000-8000-000000001963') from generate_series(1,12)$q$,'presence probes do not use token issuance allowance');
select throws_ok($q$select public.app_ticket_call_media_probe('71000000-0000-4000-8000-000000001963','73000000-0000-4000-8000-000000001965')$q$,'42501','Call unavailable','losing device cannot probe media');
reset role;
select is((select token_attempts from private.ticket_calls where id='71000000-0000-4000-8000-000000001963'),0,'probe leaves all token attempts available');
set local role service_role;
select is(public.app_confirm_ticket_call_presence('71000000-0000-4000-8000-000000001963',
 '{"total_count":2,"data":[{"id":"p1","room":"wf-call-71000000-0000-4000-8000-000000001963","userId":"20000000-0000-4000-8000-000000001701"},{"id":"p2","room":"wf-call-71000000-0000-4000-8000-000000001963","userId":"20000000-0000-4000-8000-000000001704"}]}')->>'state','active','provider-confirmed two-party presence activates the call');
reset role;
-- History can omit one short participant and reuse participant ids across meetings.
update private.ticket_calls set created_at=now()-interval '2 minutes',accepted_at=now()-interval '2 minutes',expires_at=now()+interval '13 minutes'
 where id='71000000-0000-4000-8000-000000001963';
update private.ticket_call_provider_scans set completed_at=null,lease_until='-infinity',cursor=null;
create temp table partial_scan as select public.app_claim_ticket_call_provider_scan() value;
select ok(public.app_apply_ticket_call_provider_page((value->>'id')::uuid,null,
 (select jsonb_agg(jsonb_build_object('id',('74000000-0000-4000-8000-00000000196'||n)::uuid,'room','wf-call-71000000-0000-4000-8000-000000001963',
  'start_time',extract(epoch from now())-120+(n::integer*20),'duration',10,'max_participants',1,'ongoing',false,
  'participants',jsonb_build_array(jsonb_build_object('user_id','20000000-0000-4000-8000-000000001701','participant_id','same-session',
   'join_time',extract(epoch from now())-120+(n::integer*20),'duration',10)))) from unnest(array['1','2']) n),true),
 'coarse partial history and repeated participant ids can be reconciled') from partial_scan;
select ok((select answered_at is not null from private.ticket_calls where id='71000000-0000-4000-8000-000000001963'),'partial history preserves the presence-confirmed answer');
select is((select count(*) from private.ticket_call_intervals where call_id='71000000-0000-4000-8000-000000001963'),2::bigint,'meeting-scoped interval keys keep both records');
update private.ticket_call_provider_scans set completed_at=null,lease_until='-infinity',cursor=null;
delete from private.ticket_call_provider_seen;
create temp table foreign_scan as select public.app_claim_ticket_call_provider_scan() value;
select ok(public.app_apply_ticket_call_provider_page((value->>'id')::uuid,null,jsonb_build_array(jsonb_build_object(
 'id','75000000-0000-4000-8000-000000001961','room','uncontrolled-synthetic-room','start_time',extract(epoch from now())-60,
 'duration',60,'max_participants',2,'ongoing',true,'participants','[]'::jsonb)),true),'ongoing foreign-room observation is recorded') from foreign_scan;
select ok((select not enabled and not account_exclusive from private.ticket_call_environment),'ongoing unknown usage immediately trips admission/exclusivity fuse');
select * from finish();
rollback;
