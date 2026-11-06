-- Execute only on the authorized isolated fixture database, never production.
begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
select has_column('private','ticket_calls','duration_policy','explicit lifetime policy preserves historical calls');
select is((select manual_end_enabled from private.ticket_call_environment),false,'manual-end activation is operator-only and default OFF');
select ok(not has_function_privilege('authenticated','public.app_claim_manual_call_checks()','execute'),'presence maintenance is service-only');
select ok(not has_function_privilege('anon','public.app_finish_manual_call_check(uuid,uuid,jsonb)','execute'),'anonymous cannot certify provider presence');
update private.ticket_call_environment set manual_end_enabled=true,manual_maintenance_at=clock_timestamp();
create function pg_temp.duration_actor(n text default '1701') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
 perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.duration_invite() returns jsonb language sql as $$
 select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701','71000000-0000-4000-8000-000000002061','72000000-0000-4000-8000-000000002061','audio','20000000-0000-4000-8000-000000001704');
$$;
select pg_temp.duration_actor();set local role authenticated;
select is(pg_temp.duration_invite()->>'durationPolicy','manual','new admission selects manual policy through operator-verified configuration');
reset role;
create function pg_temp.duration_id() returns uuid language sql security definer set search_path='' as $$select id from private.ticket_calls where request_id='71000000-0000-4000-8000-000000002061'$$;
-- Advance stored timestamps together, preserving the original admission constraint.
update private.ticket_calls set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '105 minutes',accepted_at=clock_timestamp()-interval '2 hours',answered_at=clock_timestamp()-interval '2 hours',state='active',provider_state='ready',callee_session_id='33000000-0000-4000-8000-000000001704',callee_device_id='72000000-0000-4000-8000-000000002064' where id=pg_temp.duration_id();
select private.process_ticket_call_deadlines();
select is((select state from private.ticket_calls where id=pg_temp.duration_id()),'active','manual active call survives two hours and expired admission time');
select private.accrue_manual_call_holds();
select ok((select sum(reserved_seconds) from private.ticket_call_reservations where call_id=pg_temp.duration_id())>=14400,'both participants remain reserved beyond the old 1800-second hold');
update private.ticket_call_account_usage set verified_at=clock_timestamp()-interval '2 hours';
select private.process_ticket_call_deadlines();
select is((select state from private.ticket_calls where id=pg_temp.duration_id()),'active','stale accounting blocks admission without revoking active authority');
update private.ticket_call_settings set monthly_minutes=1 where tenant_id='f0f0f0f0-0000-4000-8000-000000001701';
select private.process_ticket_call_deadlines();
select is((select state from private.ticket_calls where id=pg_temp.duration_id()),'active','exhausted budget never ends active manual media');
select pg_temp.duration_actor('1704');set local role authenticated;
select is(public.app_ticket_call_command('status',pg_temp.duration_id())->>'budgetWarning','100','internal participant receives a nonblocking threshold warning');
select lives_ok($$select public.app_ticket_call_command('setup',pg_temp.duration_id(),'72000000-0000-4000-8000-000000002064')$$,'bound participant can obtain fresh bounded join credentials after two hours');
select throws_ok($$select public.app_ticket_call_command('join',pg_temp.duration_id(),extensions.gen_random_uuid())$$,'42501',null,'another device cannot reuse the established call');
select is(public.app_ticket_call_command('end',pg_temp.duration_id())->>'ended','true','callee can end an arbitrarily long call');
select is(public.app_ticket_call_command('end',pg_temp.duration_id())->>'ended','true','hangup retry is idempotent');
reset role;
select is((select state from private.ticket_calls where id=pg_temp.duration_id()),'ended','manual hangup is authoritative');
select pg_temp.duration_actor();set local role authenticated;
select is(public.app_ticket_call_command('end',pg_temp.duration_id())->>'ended','true','caller can also end/replay the call');
reset role;
select ok((private.ticket_call_projection((select c from private.ticket_calls c where c.id=pg_temp.duration_id()))->>'budgetWarning') is null,'client projection discloses no internal usage warning');
select * from finish();
rollback;
