-- Synthetic isolated-backend acceptance. Source presence is not an execution pass.
begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
create function pg_temp.actor(n text default '1701') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
  'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
 perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.invite(n integer default 1) returns jsonb language sql as $$
 select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '72000000-0000-4000-8000-000000000001','audio','20000000-0000-4000-8000-000000001704');
$$;
create function pg_temp.call_id() returns uuid language sql security definer set search_path='' as $$
 select id from private.ticket_calls where request_id='71000000-0000-4000-8000-000000000001';
$$;
create function pg_temp.command(action text) returns jsonb language sql as $$
 select public.app_ticket_call_command(action,pg_temp.call_id(),'72000000-0000-4000-8000-000000000001');
$$;
select pg_temp.actor(); set local role authenticated;
select is(pg_temp.invite()->>'state','ringing','initial call admission preserved');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select is(pg_temp.command('accept')->>'state','accepted','callee acceptance preserved');
select is((pg_temp.command('setup')->>'created')::boolean,true,'initial setup owns one durable create');
select is((pg_temp.command('setup')->>'created')::boolean,false,'uncertain setup retry cannot create twice');
select is((pg_temp.command('setup')->>'ready')::boolean,false,'claimed room still needs reconciliation');
reset role;
update private.ticket_calls set token_attempts=8 where id=pg_temp.call_id();
set local role authenticated;
select throws_ok($q$select pg_temp.command('setup')$q$,'42501','Call unavailable','exhausted call denied before lookup claim');
reset role;
update private.ticket_calls set token_attempts=0,provider_state='ready' where id=pg_temp.call_id();
set local role authenticated;
select is((pg_temp.command('setup')->>'ready')::boolean,true,'verified ready room needs no repeated lookup');
reset role;
-- Seed both adjacent fixed windows to avoid a wall-clock boundary changing the test.
insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
 select 'ticket-call-provider-actor','20000000-0000-4000-8000-000000001704',b,b+interval '2 minutes',12
 from generate_series(date_trunc('minute',clock_timestamp()),date_trunc('minute',clock_timestamp())+interval '1 minute',interval '1 minute') b
 on conflict(scope,subject,window_start) do update set hits=excluded.hits;
set local role authenticated;
select throws_ok($q$select pg_temp.command('setup')$q$,'WF429','rate limit exceeded','ready setup retries are throttled');
reset role;
update private.ticket_calls set provider_state='claimed' where id=pg_temp.call_id();
set local role authenticated;
select throws_ok($q$select pg_temp.command('setup')$q$,'WF429','rate limit exceeded','uncertain-create lookup retries are throttled');
reset role;
select is((select token_attempts from private.ticket_calls where id=pg_temp.call_id()),0,'refused setup cannot spend token attempts');
select * from finish();
rollback;
