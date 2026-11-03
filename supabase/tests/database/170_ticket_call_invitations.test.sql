begin;
select no_plan();
select is((select enabled from private.ticket_call_environment),false,'environment defaults OFF');
\ir ../fixtures/ticket_calls.inc
create function pg_temp.actor(n text default '1701') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
    'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
  perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.request(n text default '0001',t text default '1701',recipient text default '1704') returns jsonb language sql as $$
  select public.app_request_ticket_call(('e1700000-0000-4000-8000-00000000'||t)::uuid,
    ('71000000-0000-4000-8000-00000000'||n)::uuid,'72000000-0000-4000-8000-000000000001','audio',case when recipient='none' then null when t='1702' then '20000000-0000-4000-8000-000000001705'::uuid else ('20000000-0000-4000-8000-00000000'||recipient)::uuid end);
$$;
create function pg_temp.call_id() returns uuid language sql security definer as $$
  select id from private.ticket_calls where request_id='71000000-0000-4000-8000-000000000001';
$$;
select ok(not has_table_privilege('authenticated','private.ticket_call_settings','select'),'settings are private');
select ok(not has_function_privilege('authenticated','private.finish_ticket_call(uuid,text,text,timestamptz)','execute'),'trusted termination is not public');
select pg_temp.actor(); set local role authenticated;
select is(pg_temp.request()->>'state','ringing','owner client requests own open Ticket');
select is(pg_temp.request()->>'calleeId','20000000-0000-4000-8000-000000001704','explicitly selected saved admin is the one callee');
select is(pg_temp.request()->>'state','ringing','same request replays without another log');
reset role;
select is((select count(*) from private.ticket_calls where not legacy),1::bigint,'one attempt on replay');
select is((select count(*) from private.ticket_call_claims),2::bigint,'ringing claims both participants');
select is((select sum(reserved_seconds) from private.ticket_call_reservations),1800::numeric,'reserves worst-case participant seconds');
select pg_temp.actor('1702'); set local role authenticated;
select throws_ok($q$select pg_temp.request('0002')$q$,'42501','Call unavailable','same-company client cannot initiate on someone else Ticket');
select is(pg_temp.request('0003','1703')->>'outcome','busy','ringing callee refuses a different client immediately');
select is(pg_temp.request('0003','1703')->>'outcome','busy','busy replay is idempotent');
reset role;
select is((select count(*) from private.ticket_call_reservations),1::bigint,'busy creates no reservation');
select pg_temp.actor('1703'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_command('accept',pg_temp.call_id(),'72000000-0000-4000-8000-000000000002')$q$,
  '42501','Call unavailable','wrong authorized staff cannot occupy a vacant slot');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select is(public.app_ticket_call_command('accept',pg_temp.call_id(),'72000000-0000-4000-8000-000000000002')->>'state','accepted','selected callee accepts');
select throws_ok($q$select public.app_ticket_call_command('accept',pg_temp.call_id(),'72000000-0000-4000-8000-000000000003')$q$,
  '42501','Call already taken or ended','second device cannot take over');
reset role;
select ok((select answered_at is null from private.ticket_calls where id=pg_temp.call_id()),'acceptance does not mark answered');
update private.ticket_calls set state='active' where id=pg_temp.call_id();
select pg_temp.actor('1702'); set local role authenticated;
select is(pg_temp.request('0006','1703')->>'outcome','busy','active call refuses call waiting');
reset role;
select pg_temp.actor('1704');
update public.tickets set status='closed',closed_at=clock_timestamp() where id='e1700000-0000-4000-8000-000000001701';
update private.ticket_call_settings set enabled=false;
set local role authenticated;
select is(public.app_ticket_call_command('end',pg_temp.call_id())->>'ended','true','closure and OFF flag do not prevent participant end');
reset role;
select is((select settled_seconds from private.ticket_call_reservations),0::numeric,'no-provider end releases hold');
select is((select count(*) from private.ticket_call_claims),0::bigint,'no-provider end releases claims');
update private.ticket_call_settings set enabled=true,fallback_team_profile_id=null;
select pg_temp.actor('1701'); set local role authenticated;
select throws_ok($q$select pg_temp.request('0007')$q$,'42501','Call unavailable','client cannot start a call on own closed Ticket');
reset role;
select pg_temp.actor('1702'); set local role authenticated;
select throws_ok($q$select pg_temp.request('0004','1704','none')$q$,'42501','Call unavailable','unassigned Ticket still requires an explicit selected recipient');
select is(jsonb_array_length(public.app_ticket_call_history('e1700000-0000-4000-8000-000000001704')),0,'invalid selection creates no fabricated call history');
reset role;
update private.ticket_call_settings set fallback_team_profile_id='20000000-0000-4000-8000-000000001704';
set local role authenticated;
select is(pg_temp.request('0005','1704')->>'calleeId','20000000-0000-4000-8000-000000001704','explicit non-owner saved team member remains the selected recipient');
reset role;
update private.ticket_calls set ring_deadline=clock_timestamp()-interval '1 second' where request_id='71000000-0000-4000-8000-000000000005';
select is(private.process_ticket_call_deadlines(),1,'server job finalizes without a browser');
select is((select outcome from private.ticket_calls where request_id='71000000-0000-4000-8000-000000000005'),'missed','silent ring becomes missed');
select is(private.process_ticket_call_deadlines(),0,'deadline finalization is idempotent');
select is((select count(*) from public.notifications where event_key like 'ticket-call-missed:%'),1::bigint,'exactly one missed bell');
select is((select count(*) from private.push_deliveries where notification_id in
  (select id from public.notifications where event_key like 'ticket-call-missed:%')),0::bigint,'missed bell does not enroll or dispatch push');
select pg_temp.actor('1703'); set local role authenticated;
select is(public.app_configure_ticket_call_settings(true,'20000000-0000-4000-8000-000000001704',600),true,'owner can configure fallback member');
select throws_ok($q$select public.app_configure_ticket_call_settings(true,null,601)$q$,'22023','Invalid call settings','Tenant owner cannot take live allocation');
reset role;
select is((select count(*) from private.ticket_call_settings_audit),1::bigint,'settings update audited');
select * from finish();
rollback;
