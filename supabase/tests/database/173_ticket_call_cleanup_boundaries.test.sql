begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
create function pg_temp.actor(n text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
    'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
  perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.call_id() returns uuid language sql security definer as $$
  select id from private.ticket_calls where not legacy order by created_at desc limit 1;
$$;
select pg_temp.actor('1701'); set local role authenticated;
select lives_ok($q$select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  '71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','video')$q$,'synthetic invitation admitted');
reset role;
select pg_temp.actor('1702'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_command('status',pg_temp.call_id())$q$,
  '42501','Call unavailable','same-company viewer cannot inspect a ringing call');
select throws_ok($q$select public.app_ticket_call_command('join',pg_temp.call_id(),'72000000-0000-4000-8000-000000000001')$q$,
  '42501','Call unavailable','same-company viewer cannot claim the empty media slot');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select lives_ok($q$select public.app_ticket_call_command('accept',pg_temp.call_id(),'72000000-0000-4000-8000-000000000002')$q$,'selected recipient accepts');
select throws_ok($q$select public.app_ticket_call_command('setup',pg_temp.call_id(),'72000000-0000-4000-8000-000000000003')$q$,
  '42501','Call unavailable','callee setup requires winning device');
reset role;
select pg_temp.actor('1701'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_command('setup',pg_temp.call_id(),'72000000-0000-4000-8000-000000000003')$q$,
  '42501','Call unavailable','caller setup requires original device');
select lives_ok($q$select public.app_ticket_call_command('setup',pg_temp.call_id(),'72000000-0000-4000-8000-000000000001')$q$,'durable setup claim created without provider traffic');
reset role;
update private.ticket_call_environment set enabled=false;
update public.tenant_memberships set archived_at=clock_timestamp()
  where profile_id='20000000-0000-4000-8000-000000001701';
set local role authenticated;
select is(public.app_ticket_call_command('end',pg_temp.call_id()),'{"ended":true}'::jsonb,
  'membership revocation and global breaker still allow content-free participant end');
reset role;
select is((select count(*) from private.ticket_call_cleanup),1::bigint,'uncertain setup retains trusted cleanup work');
select is((select count(*) from private.ticket_call_claims),2::bigint,'uncertain provider use keeps participant claims');
select is((select settled_seconds from private.ticket_call_reservations),null::numeric,'uncertain provider use keeps worst-case budget');
select is(jsonb_array_length(public.app_claim_ticket_call_cleanup()),1,'trusted cleanup works while breaker is OFF');

delete from private.ticket_calls;
update private.ticket_call_environment set enabled=true;
update public.tenant_memberships set archived_at=null where profile_id='20000000-0000-4000-8000-000000001701';
set local role authenticated;
select lives_ok($q$select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  '71000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','audio')$q$,'next fixture invitation admitted');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select lives_ok($q$select public.app_ticket_call_command('accept',pg_temp.call_id(),'72000000-0000-4000-8000-000000000002')$q$,'next recipient accepts');
reset role;
update private.ticket_calls set connect_deadline=clock_timestamp()-interval '1 second';
select is(private.process_ticket_call_deadlines(),1,'server finalizes accepted-without-media timeout');
select is((select reason from private.ticket_calls),'connect_timeout','setup timeout has explicit reason');
select is((select answered_at from private.ticket_calls),null::timestamptz,'permission denial/no media is never answered');
select is((select connected_seconds from private.ticket_calls),0::numeric,'no-media timeout has zero conversation seconds');

delete from private.ticket_calls;
select pg_temp.actor('1701'); set local role authenticated;
select lives_ok($q$select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  '71000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','audio')$q$,'revocation fixture admitted');
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second'
  where user_id='20000000-0000-4000-8000-000000001701';
set local role authenticated;
select throws_ok($q$select public.app_ticket_call_command('end',pg_temp.call_id())$q$,
  '42501','Active session required','revoked sessions cannot use participant termination');
reset role;
select is(private.process_ticket_call_deadlines(),1,'trusted sweep finalizes after session revocation');
select is((select reason from private.ticket_calls),'authority_revoked','session revocation has explicit reason');
select is((select count(*) from private.ticket_call_claims),0::bigint,'no-provider revocation releases claims');
select * from finish();
rollback;
