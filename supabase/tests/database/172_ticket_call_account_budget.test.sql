begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
select ok(not has_function_privilege('authenticated','public.app_reconcile_ticket_call_account(text,date,numeric,timestamptz)','execute'),
  'only trusted accounting can import unmapped provider use');
select throws_ok($q$select public.app_reconcile_ticket_call_account('other',date_trunc('month',now())::date,0,now())$q$,
  '22023','Invalid account usage evidence','foreign account usage refused');
select throws_ok($q$select public.app_reconcile_ticket_call_account('wolfforge',date_trunc('month',now())::date,'NaN',now())$q$,
  '22023','Invalid account usage evidence','non-finite account usage refused');
select is(public.app_reconcile_ticket_call_account('wolfforge',date_trunc('month',now())::date,31000,now()),true,'trusted account snapshot ingested');
select is((select count(*) from private.ticket_call_budget_alerts),1::bigint,'75 percent threshold recorded');
select is(public.app_reconcile_ticket_call_account('wolfforge',date_trunc('month',now())::date,0,now()),true,'older/lower usage cannot reduce a settled account charge');
select is((select unmapped_seconds from private.ticket_call_account_usage),31000::numeric,'unmapped cost is monotonic');
create function pg_temp.actor(n text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
    'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
  perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
select pg_temp.actor('1701'); set local role authenticated;
select is(public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701','71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001','audio')->>'state','ringing','affordable reserved usage admitted');
reset role;
select is((select count(*) from private.ticket_call_budget_alerts),2::bigint,'new reservation records 90 percent threshold');
select public.app_reconcile_ticket_call_account('wolfforge',date_trunc('month',now())::date,36000,now());
select public.app_reconcile_ticket_call_account('wolfforge',date_trunc('month',now())::date,36000,now());
select is((select count(*) from private.ticket_call_budget_alerts),3::bigint,'100 percent alert deduplicates across snapshots');
select pg_temp.actor('1702'); set local role authenticated;
select is(public.app_request_ticket_call('e1700000-0000-4000-8000-000000001704','71000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000001','audio')->>'outcome','refused','unmapped account use blocks another otherwise eligible call');
reset role;
select is((select count(*) from private.ticket_call_reservations),1::bigint,'quota refusal creates no reservation');
update private.ticket_call_account_usage set verified_at=now()-interval '2 hours';
set local role authenticated;
select throws_ok($q$select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001704','71000000-0000-4000-8000-000000000003',
  '72000000-0000-4000-8000-000000000001','audio')$q$,'42501','Calls disabled','stale provider reconciliation fails closed');
reset role;
update private.ticket_call_account_usage set verified_at=now();
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001701'
  and profile_id='20000000-0000-4000-8000-000000001703';
set local role authenticated;
select is(public.app_request_ticket_call('e1700000-0000-4000-8000-000000001704','71000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000001','audio')->>'message','Please send a message instead','invalid configured fallback is refused without auto-pick');
reset role;
select * from finish();
rollback;
