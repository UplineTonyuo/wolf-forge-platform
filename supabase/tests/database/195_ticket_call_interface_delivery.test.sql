begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
delete from private.studio_push_configuration;
insert into public.tenant_domains(host,tenant_id,verified_at) values
('wolf-forge-platform-callstest-wolf-forge.vercel.app','f0f0f0f0-0000-4000-8000-000000001701',now());
insert into private.studio_push_configuration(singleton,enabled,project_url,origin,tenant_id,public_key,vapid_secret_id,api_key_secret_id)
values(true,true,'https://rsnmlcyopnxucwgfttyf.supabase.co','https://wolf-forge-platform-callstest-wolf-forge.vercel.app',
 'f0f0f0f0-0000-4000-8000-000000001701',repeat('A',87),extensions.gen_random_uuid(),extensions.gen_random_uuid());
create function pg_temp.actor(n text default '1701') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
    'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
  perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.current_call_id() returns uuid language sql security definer as $$
select id from private.ticket_calls where request_id='71000000-0000-4000-8000-000000001951';
$$;
select ok(not has_table_privilege('authenticated','private.ticket_call_push_devices','select'),'call devices cannot be enumerated');
select ok(not has_table_privilege('anon','private.ticket_call_push_deliveries','select'),'call delivery ledger is private');
select ok(not has_function_privilege('authenticated','public.app_claim_ticket_call_push_deliveries()','execute'),'browser cannot dispatch');
select ok(not has_function_privilege('anon','public.app_ticket_call_current(uuid,uuid)','execute'),'anonymous current-call read denied');
select pg_temp.actor('1704'); set local role authenticated;
select is(public.app_ticket_call_current()->>'profileId','20000000-0000-4000-8000-000000001704','identity is server derived');
select ok(public.app_get_my_call_push_configuration() is not null,'eligible internal actor gets public configuration');
select ok(not(public.app_get_my_call_push_configuration()?'privateKey'),'no private VAPID key in public configuration');
select ok(public.app_set_my_call_push_subscription('https://fcm.googleapis.com/call-device-test',
 'https://wolf-forge-platform-callstest-wolf-forge.vercel.app',true),'internal actor opts into call alerts');
select is(public.app_my_call_push_status('https://fcm.googleapis.com/call-device-test')->>'active','true','device is active');
reset role;
select is((select count(*) from private.push_subscriptions where endpoint='https://fcm.googleapis.com/call-device-test'),0::bigint,
 'call opt-in does not enable message push');
select pg_temp.actor(); set local role authenticated;
select throws_ok($q$select public.app_set_my_call_push_subscription('https://fcm.googleapis.com/call-device-test',
 'https://wolf-forge-platform-callstest-wolf-forge.vercel.app',true)$q$,'42501','Subscription unavailable','other profile cannot claim endpoint');
select is(public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
 '71000000-0000-4000-8000-000000001951','72000000-0000-4000-8000-000000001951','video')->>'state','ringing','explicit call admitted');
select is(public.app_ticket_call_current('e1700000-0000-4000-8000-000000001701')->'call'->>'mode','video','caller sees frozen mode');
select ok(not(public.app_ticket_call_current()?'token'),'current projection contains no media token');
reset role;
select is((select count(*) from private.ticket_call_push_deliveries where call_id=pg_temp.current_call_id()),1::bigint,'one incoming device delivery');
select pg_temp.actor('1702'); set local role authenticated;
select is(public.app_ticket_call_current(null,pg_temp.current_call_id())->'call','null'::jsonb,'same Company viewer sees no call');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select is(public.app_ticket_call_current()->'call'->>'id',pg_temp.current_call_id()::text,'selected callee sees incoming invitation');
select is(public.app_my_call_push_status('https://fcm.googleapis.com/call-device-test')->'call'->>'id',pg_temp.current_call_id()::text,'worker gets only opaque current hint');
reset role;
set local role service_role;
select is(jsonb_array_length(public.app_claim_ticket_call_push_deliveries()),1,'worker claims one delivery');
select is(jsonb_array_length(public.app_claim_ticket_call_push_deliveries()),0,'second worker cannot resend in-flight attempt');
reset role;
select ok((select public.app_finish_ticket_call_push_delivery(id,attempt_id,'unknown',null)
 from private.ticket_call_push_deliveries where call_id=pg_temp.current_call_id()),'unknown provider response gets a durable receipt');
select is((select state from private.ticket_call_push_deliveries where call_id=pg_temp.current_call_id()),'unknown','unknown delivery not reset');
select pg_temp.actor('1704'); set local role authenticated;
select is(public.app_ticket_call_command('decline',pg_temp.current_call_id())->>'outcome','declined','callee explicitly declines');
select is(public.app_my_call_push_status('https://fcm.googleapis.com/call-device-test')->'call','null'::jsonb,'stale push cannot show ringing');
select is(public.app_ticket_call_current(null,pg_temp.current_call_id())->'call'->>'state','ended','old call destination resolves terminal state');
select ok(public.app_set_my_call_push_subscription('https://fcm.googleapis.com/call-device-test',
 'https://wolf-forge-platform-callstest-wolf-forge.vercel.app',false),'call alerts disabled independently');
select is(public.app_my_call_push_status('https://fcm.googleapis.com/call-device-test')->>'active','false','disabled device cannot receive hints');
reset role;
select is((select count(*) from cron.job where jobname='wf-ticket-calls-push-recovery-v1' and schedule='10 seconds'),1::bigint,
 'bounded no-browser recovery is provisioned once');
select pg_temp.actor('1704');
update auth.sessions set not_after=now()-interval '1 second' where id='33000000-0000-4000-8000-000000001704';
set local role authenticated;
select throws_ok($q$select public.app_ticket_call_current()$q$,'42501','Active session required','expired session cannot read call');
select throws_ok($q$select public.app_my_call_push_status('https://fcm.googleapis.com/call-device-test')$q$,'42501','Active session required','expired session cannot verify device');
reset role;
select * from finish();
rollback;
