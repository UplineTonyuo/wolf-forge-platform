-- Isolated fixture database only. Loading the library requires the local native administrator.
\connect - supabase_admin
begin;
set local role postgres;
select no_plan();
\ir ../fixtures/ticket_calls.inc
reset role;
load 'safeupdate';
set local safeupdate.enabled=1;
set local role postgres;
select is(current_setting('safeupdate.enabled'),'on','the real safeupdate library is enabled');
select throws_ok($q$update private.ticket_call_environment set manual_maintenance_at=clock_timestamp()$q$,
 '21000','UPDATE requires a WHERE clause','the production safety guard rejects the original unqualified update');

-- Exact pre-correction maintenance body, renamed into the transaction-local schema.
create function pg_temp.original_manual_call_checks() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; batch jsonb:='[]'; claim uuid; stamp timestamptz;
begin
 perform private.ticket_call_lock(); stamp:=clock_timestamp();
 perform private.process_ticket_call_deadlines(); perform private.accrue_manual_call_holds();
 update private.ticket_call_environment set manual_maintenance_at=stamp;
 for c in select * from private.ticket_calls where duration_policy='manual' and state='active'
  and (presence_check_at is null or presence_check_at<stamp-interval '1 minute') order by presence_check_at nulls first limit 2 for update loop
  claim:=extensions.gen_random_uuid();
  update private.ticket_calls set presence_check_id=claim,presence_check_at=stamp where id=c.id;
  batch:=batch||jsonb_build_array(jsonb_build_object('id',c.id,'claimId',claim,'roomName','wf-call-'||c.id::text));
 end loop;
 return batch;
end $$;
select throws_ok($q$select pg_temp.original_manual_call_checks()$q$,'21000','UPDATE requires a WHERE clause',
 'the exact original maintenance body reproduces the production failure');
update private.ticket_call_environment set manual_maintenance_at=null where singleton=true;
set local role service_role;
select is(public.app_claim_manual_call_checks(),'[]'::jsonb,'trusted empty maintenance succeeds with the production safeguard enabled');
reset role;
select ok((select manual_maintenance_at>clock_timestamp()-interval '1 minute' from private.ticket_call_environment),
 'successful maintenance persists its real heartbeat');
select is((select manual_end_enabled from private.ticket_call_environment),false,'maintenance never activates manual-end policy');
select ok(not has_function_privilege('anon','public.app_claim_manual_call_checks()','execute'), 'anonymous maintenance remains denied');
select ok(not has_function_privilege('authenticated','public.app_claim_manual_call_checks()','execute'), 'browser maintenance remains denied');

create temp table safe_scan as select public.app_claim_ticket_call_provider_scan() value;
grant select on safe_scan to service_role;
set local role service_role;
select ok(public.app_apply_ticket_call_provider_page((value->>'id')::uuid,null,jsonb_build_array(jsonb_build_object(
 'id','75000000-0000-4000-8000-000000002071','room','uncontrolled-synthetic-room',
 'start_time',extract(epoch from now())-60,'duration',60,'max_participants',2,'ongoing',true,'participants','[]'::jsonb)),true),
 'ongoing unknown provider usage is processed under safeupdate') from safe_scan;
reset role;
select ok((select not enabled and not account_exclusive from private.ticket_call_environment),
 'ongoing unknown usage still disables admission and exclusivity');

update private.ticket_call_environment set enabled=true,account_exclusive=true where singleton=true;
delete from private.ticket_call_provider_scans where month=date_trunc('month',clock_timestamp() at time zone 'UTC')::date;
create temp table completed_safe_scan as select public.app_claim_ticket_call_provider_scan() value;
grant select on completed_safe_scan to service_role;
set local role service_role;
select ok(public.app_apply_ticket_call_provider_page((value->>'id')::uuid,null,jsonb_build_array(jsonb_build_object(
 'id','75000000-0000-4000-8000-000000002072','room','uncontrolled-synthetic-room',
 'start_time',extract(epoch from clock_timestamp())-120,'duration',120,'max_participants',2,'ongoing',false,'participants','[]'::jsonb)),true),
 'completed unknown provider usage is processed under safeupdate') from completed_safe_scan;
reset role;
select ok((select not enabled and not account_exclusive from private.ticket_call_environment),
 'completed unknown usage still disables admission and exclusivity');
select ok(not has_function_privilege('authenticated','public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)','execute'),
 'provider history certification remains trusted-only');
select * from finish();
rollback;
