begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
create function pg_temp.actor() returns void language sql as $$
 select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000001701","role":"authenticated","session_id":"33000000-0000-4000-8000-000000001701"}',true);
 select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
$$;
create function pg_temp.invite(n integer) returns jsonb language sql as $$
 select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '72000000-0000-4000-8000-000000000001','audio','20000000-0000-4000-8000-000000001704');
$$;
create function pg_temp.seed(n integer,actor_id uuid,age interval) returns void language sql as $$
 insert into private.ticket_calls(id,request_id,ticket_id,tenant_id,initiated_by,mode,participants,state,outcome,
  created_at,expires_at,reconciled_at,ended_at)
 select extensions.gen_random_uuid(),extensions.gen_random_uuid(),'e1700000-0000-4000-8000-000000001701',
  'f0f0f0f0-0000-4000-8000-000000001701',actor_id,'audio',array[actor_id],'ended','refused',
  clock_timestamp()-age,clock_timestamp()-age+interval '15 minutes',clock_timestamp()-age,clock_timestamp()-age
 from generate_series(1,n);
$$;
select pg_temp.actor(); set local role authenticated;
select is(pg_temp.invite(1)->>'state','ringing','initial admitted record');
select is(pg_temp.invite(2)->>'outcome','busy','busy attempt is durably recorded within storage allowance');
reset role;
select pg_temp.seed(28,'20000000-0000-4000-8000-000000001701',interval '1 hour');
set local role authenticated;
select throws_ok($q$select pg_temp.invite(3)$q$,'WF429','Call history limit reached','busy/refused rows count toward daily storage allowance');
select is(pg_temp.invite(2)->>'outcome','busy','exact busy replay still returns its existing receipt at storage limit');
reset role;
select is((select count(*) from private.ticket_calls),30::bigint,'storage denial inserts no extra history');
select is((select count(*) from private.ticket_call_reservations),1::bigint,'storage denial adds no media hold');
-- Actor rolling 30-day limit, including refused outcomes that never reserve media.
delete from private.ticket_calls;
select pg_temp.seed(300,'20000000-0000-4000-8000-000000001701',interval '2 days');
set local role authenticated;
select throws_ok($q$select pg_temp.invite(3)$q$,'WF429','Call history limit reached','actor rolling 30-day allowance includes refused records');
reset role;
delete from private.ticket_calls;
select pg_temp.seed(120,'20000000-0000-4000-8000-000000001702',interval '1 hour');
set local role authenticated;
select throws_ok($q$select pg_temp.invite(3)$q$,'WF429','Call history limit reached','account daily allowance includes other initiators');
reset role;
delete from private.ticket_calls;
select pg_temp.seed(1200,'20000000-0000-4000-8000-000000001702',interval '2 days');
set local role authenticated;
select throws_ok($q$select pg_temp.invite(3)$q$,'WF429','Call history limit reached','account rolling allowance includes other initiators');
reset role;
delete from private.ticket_calls;
select pg_temp.seed(1200,'20000000-0000-4000-8000-000000001701',interval '31 days');
set local role authenticated;
select is(pg_temp.invite(3)->>'state','ringing','aged records do not permanently consume ingress allowance');
reset role;
select * from finish();
rollback;
