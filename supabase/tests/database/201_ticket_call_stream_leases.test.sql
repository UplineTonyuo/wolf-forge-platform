begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
insert into auth.sessions(id,user_id,aal,not_after)
 select ('33000000-0000-4000-8000-00000000'||n)::uuid,'20000000-0000-4000-8000-000000001704','aal1',now()+interval '1 day'
 from unnest(array['1798','1799']) n;
create function pg_temp.actor(sid text default '1704') returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-000000001704',
  'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||sid)::text,true);
 select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
$$;
create function pg_temp.first_lease() returns uuid language sql security definer set search_path='' as $$
 select id from private.ticket_call_signal_leases where session_id='33000000-0000-4000-8000-000000001704' order by id limit 1;
$$;
select ok(not has_table_privilege('authenticated','private.ticket_call_signal_leases','select'),'lease rows are private');
select ok(not has_function_privilege('anon','public.app_ticket_call_signal_lease(text,uuid)','execute'),'anonymous renewal/release denied');
select ok(not has_function_privilege('anon','public.app_ticket_call_signal_lease_context()','execute'),'anonymous stream admission denied');
select pg_temp.actor(); set local role authenticated;
select is(public.app_ticket_call_signal_context(),jsonb_build_object('topic','ticket-calls:f0f0f0f0-0000-4000-8000-000000001701:20000000-0000-4000-8000-000000001704'),'serving app retains exact strict topic contract');
reset role;
select is((select count(*) from private.ticket_call_signal_leases),0::bigint,'legacy lookup cannot leak a lease');
set local role authenticated;
select lives_ok($q$do $b$begin for i in 1..3 loop perform public.app_ticket_call_signal_lease_context(); end loop; end$b$$q$,'three simultaneous tabs in one session admitted');
select throws_ok($q$select public.app_ticket_call_signal_lease_context()$q$,'WF429','Call stream limit reached','fourth tab denied');
reset role;
select pg_temp.actor('1799'); set local role authenticated;
select lives_ok($q$do $b$begin for i in 1..3 loop perform public.app_ticket_call_signal_lease_context(); end loop; end$b$$q$,'second device can open three tabs');
select is(public.app_ticket_call_signal_lease('renew',pg_temp.first_lease()),null::jsonb,'other session cannot renew a lease');
select lives_ok($q$select public.app_ticket_call_signal_lease('release',pg_temp.first_lease())$q$,'foreign-session release is harmless');
reset role;
select is((select count(*) from private.ticket_call_signal_leases),6::bigint,'wrong-session release leaves leases intact');
select pg_temp.actor('1798'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_signal_lease_context()$q$,'WF429','Call stream limit reached','profile allowance spans sessions');
reset role;
select pg_temp.actor();
update private.ticket_call_signal_leases set expires_at=clock_timestamp()+interval '5 seconds' where id=pg_temp.first_lease();
set local role authenticated;
select ok((public.app_ticket_call_signal_lease('renew',pg_temp.first_lease())->>'expiresAt')::timestamptz>clock_timestamp()+interval '80 seconds','valid renewal extends live lease');
select lives_ok($q$select public.app_ticket_call_signal_lease('release',pg_temp.first_lease())$q$,'disconnect releases one exact lease');
select lives_ok($q$select public.app_ticket_call_signal_lease_context()$q$,'released slot can be reused immediately');
reset role;
create temporary table expired_lease as select id from private.ticket_call_signal_leases where id=pg_temp.first_lease();
grant select on expired_lease to authenticated;
update private.ticket_call_signal_leases set expires_at=clock_timestamp()-interval '1 second' where id=(select id from expired_lease);
set local role authenticated;
select is(public.app_ticket_call_signal_lease('renew',(select id from expired_lease)),null::jsonb,'expired lease cannot be resurrected');
select lives_ok($q$select public.app_ticket_call_signal_lease_context()$q$,'crashed stream expires and a replacement is admitted');
reset role;
select is((select count(*) from private.ticket_call_signal_leases where id=(select id from expired_lease)),0::bigint,'expired rows are reclaimed under profile lock');
update private.ticket_call_signal_leases set expires_at=clock_timestamp()+interval '5 seconds',max_expires_at=clock_timestamp()+interval '5 seconds'
 where id=pg_temp.first_lease();
set local role authenticated;
select ok((public.app_ticket_call_signal_lease('renew',pg_temp.first_lease())->>'expiresAt')::timestamptz<=clock_timestamp()+interval '5 seconds','renewal cannot extend hard stream lifetime');
reset role;
update private.ticket_call_settings set enabled=false;
set local role authenticated;
select is(public.app_ticket_call_signal_lease('renew',pg_temp.first_lease()),null::jsonb,'calling disable refuses renewal');
select lives_ok($q$select public.app_ticket_call_signal_lease('release',pg_temp.first_lease())$q$,'release remains available when admission is disabled');
reset role;
select * from finish();
rollback;
