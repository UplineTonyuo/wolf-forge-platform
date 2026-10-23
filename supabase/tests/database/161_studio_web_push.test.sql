begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000'||n)::uuid,'authenticated','authenticated','push-'||n||'@example.invalid',now(),now()
from unnest(array['1901','1902','1903','1904']) n;
insert into public.tenants(id,slug,display_name,status) values
('f0f0f0f0-0000-4000-8000-000000001901','push-tenant-b','Push Tenant B','active');
insert into public.companies(id,tenant_id,name,status) values
('e0000000-0000-4000-8000-000000001901',private.wolf_forge_tenant_id(),'PUSH TEST A','client'),
('e0000000-0000-4000-8000-000000001902','f0f0f0f0-0000-4000-8000-000000001901','PUSH TEST B','client');
update public.profiles set role_id=(select id from public.roles where name='client'),company_id='e0000000-0000-4000-8000-000000001901'
where id in ('20000000-0000-4000-8000-000000001901','20000000-0000-4000-8000-000000001902');
delete from public.tenant_memberships where profile_id='20000000-0000-4000-8000-000000001903';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000001901','20000000-0000-4000-8000-000000001903','client',id,'e0000000-0000-4000-8000-000000001902'
from public.roles where name='client';
update public.profiles set role_id=(select id from public.roles where name='owner') where id='20000000-0000-4000-8000-000000001904';
insert into auth.sessions(id,user_id,aal,not_after)
select ('33000000-0000-4000-8000-00000000'||n)::uuid,('20000000-0000-4000-8000-00000000'||n)::uuid,'aal1',now()+interval '1 day'
from unnest(array['1901','1902','1903','1904']) n;
insert into public.tenant_domains(host,tenant_id,verified_at) values
('wolf-forge-platform-pushtest-wolf-forge.vercel.app',private.wolf_forge_tenant_id(),now());
insert into private.studio_push_configuration(singleton,enabled,project_url,origin,tenant_id,public_key,vapid_secret_id,api_key_secret_id)
values(true,true,'https://rsnmlcyopnxucwgfttyf.supabase.co','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',private.wolf_forge_tenant_id(),repeat('A',87),extensions.gen_random_uuid(),extensions.gen_random_uuid());

create function pg_temp.push_actor(p_suffix text,p_tenant uuid default private.wolf_forge_tenant_id()) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||p_suffix,'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||p_suffix)::text,true);
  perform set_config('request.headers',jsonb_build_object('x-wf-tenant',p_tenant)::text,true);
end $$;

select ok(not has_table_privilege('authenticated','private.push_subscriptions','SELECT'),'client cannot read endpoint table');
select ok(not has_table_privilege('authenticated','private.push_subscriptions','INSERT'),'client cannot bypass registration');
select ok(not has_table_privilege('anon','private.push_deliveries','SELECT'),'anonymous cannot read delivery history');
select ok(not has_function_privilege('authenticated','public.app_claim_studio_push_deliveries()','EXECUTE'),'client cannot claim deliveries');
select ok(not has_function_privilege('anon','public.app_get_my_push_configuration()','EXECUTE'),'anonymous cannot get configuration');
select ok(not has_function_privilege('authenticated','public.app_get_studio_push_dispatch_settings()','EXECUTE'),'client cannot obtain VAPID private key');
select ok(not has_function_privilege('authenticated','public.app_configure_studio_push(text,text,text,text,text)','EXECUTE'),'client cannot configure dispatcher');
select ok(has_function_privilege('service_role','public.app_claim_studio_push_deliveries()','EXECUTE'),'worker can claim deliveries');
set local role authenticated;
select throws_ok('select public.app_claim_studio_push_deliveries()','42501',null,'actual client role cannot execute worker RPC');
select throws_ok('select public.app_get_studio_push_dispatch_settings()','42501',null,'actual client role cannot read worker keys');
reset role;
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'
  and c.relname in ('push_subscriptions','push_deliveries','studio_push_configuration') and c.relrowsecurity),3::bigint,'all new private tables enforce RLS');

select pg_temp.push_actor('1904');
select throws_ok('select public.app_get_my_push_configuration()','42501',null,'internal owner cannot enroll as a client');
select throws_ok($q$select public.app_configure_studio_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',repeat('A',87),repeat('B',43),repeat('C',40))$q$,'22023',null,'production backend cannot use a Studio origin');
select pg_temp.push_actor('1901');
select is(public.app_get_my_push_configuration()->>'publicKey',repeat('A',87),'eligible client gets public key only');
select is((select count(*) from jsonb_object_keys(public.app_get_my_push_configuration())),2::bigint,'configuration excludes secrets');
select throws_ok($q$select public.app_set_my_push_subscription('https://127.0.0.1/secret','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true)$q$,'22023',null,'loopback endpoint refused');
select throws_ok($q$select public.app_set_my_push_subscription('https://fcm.googleapis.com.attacker.invalid/x','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true)$q$,'22023',null,'lookalike provider refused');
select throws_ok($q$select public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/test','https://attacker.invalid',true)$q$,'42501',null,'unverified app origin refused');
select ok(public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/push-test-a','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true),'client opts in own device');
select ok(public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/push-test-a'),'own active subscription visible');
select pg_temp.push_actor('1902');
select ok(not public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/push-test-a'),'peer cannot inspect another client subscription');
select throws_ok($q$select public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/push-test-a','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true)$q$,'42501',null,'peer cannot claim endpoint');
select throws_ok($q$select public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/push-test-a','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',false)$q$,'42501',null,'peer cannot disable endpoint');
select pg_temp.push_actor('1903','f0f0f0f0-0000-4000-8000-000000001901');
select is(public.app_get_my_push_configuration(),null::jsonb,'foreign tenant gets no Studio configuration');
select throws_ok($q$select public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/foreign','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true)$q$,'42501',null,'foreign tenant cannot enroll on Studio origin');

select pg_temp.push_actor('1901');
insert into public.notifications(id,recipient_profile_id,company_id,audience,category,variant,title,body,href,event_key,tenant_id,message_count)
values('44000000-0000-4000-8000-000000001901','20000000-0000-4000-8000-000000001901','e0000000-0000-4000-8000-000000001901','client','client','info','Sensitive example title','Never sent to push','/account','push-test-1',private.wolf_forge_tenant_id(),1);
select is((select count(*) from private.push_deliveries where notification_id='44000000-0000-4000-8000-000000001901'),1::bigint,'notification insert queues exact opted-in recipient');
update public.notifications set read_at=now() where id='44000000-0000-4000-8000-000000001901';
select is((select count(*) from private.push_deliveries where notification_id='44000000-0000-4000-8000-000000001901'),1::bigint,'marking read queues no extra delivery');
update public.notifications set read_at=null,message_count=2,created_at=clock_timestamp() where id='44000000-0000-4000-8000-000000001901';
select is((select count(*) from private.push_deliveries where notification_id='44000000-0000-4000-8000-000000001901'),2::bigint,'coalesced message update queues a new version');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.headers','{"x-original":"preserve"}',true);
create temporary table push_claim as select public.app_claim_studio_push_deliveries() as payload;
select is(jsonb_array_length((select payload from push_claim)),1,'only current notification version claimed');
select is((select count(*) from private.push_deliveries where state='suppressed'),1::bigint,'obsolete version suppressed');
select is(current_setting('request.jwt.claims')::jsonb,'{"role":"service_role"}'::jsonb,'recipient claims restored after canonical read');
select is(current_setting('request.headers'),'{"x-original":"preserve"}','request headers restored');
select ok(not public.app_finish_studio_push_delivery((select (payload->0->>'id')::uuid from push_claim),extensions.gen_random_uuid(),'accepted',201),'wrong attempt cannot reconcile another delivery');
select ok(public.app_finish_studio_push_delivery((select (payload->0->>'id')::uuid from push_claim),(select (payload->0->>'attemptId')::uuid from push_claim),'accepted',201),'bound provider receipt persists');
select ok(not public.app_finish_studio_push_delivery((select (payload->0->>'id')::uuid from push_claim),(select (payload->0->>'attemptId')::uuid from push_claim),'rejected',410),'completed attempt cannot be overwritten');
select is(jsonb_array_length(public.app_claim_studio_push_deliveries()),0,'accepted delivery is never resent');

select pg_temp.push_actor('1901');
update public.notifications set message_count=3,created_at=clock_timestamp() where id='44000000-0000-4000-8000-000000001901';
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000001901' and tenant_id=private.wolf_forge_tenant_id();
select is(jsonb_array_length(public.app_claim_studio_push_deliveries()),0,'membership removal suppresses queued push');
update public.tenant_memberships set archived_at=null where profile_id='20000000-0000-4000-8000-000000001901' and tenant_id=private.wolf_forge_tenant_id();
select pg_temp.push_actor('1901');
update public.notifications set message_count=4,created_at=clock_timestamp() where id='44000000-0000-4000-8000-000000001901';
select public.app_disable_my_push_session();
select ok(not public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/push-test-a'),'logout cleanup disables current session');
select is(jsonb_array_length(public.app_claim_studio_push_deliveries()),0,'logout suppresses already queued work');
select ok(public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/push-test-a','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true),'same client can explicitly re-enable');
update public.notifications set message_count=5,created_at=clock_timestamp() where id='44000000-0000-4000-8000-000000001901';
delete from push_claim;
insert into push_claim select public.app_claim_studio_push_deliveries();
select ok(public.app_finish_studio_push_delivery((select (payload->0->>'id')::uuid from push_claim),(select (payload->0->>'attemptId')::uuid from push_claim),'rejected',410),'expired provider response recorded');
select ok(not public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/push-test-a'),'410 retires expired device');
select ok(public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/push-test-a','https://wolf-forge-platform-pushtest-wolf-forge.vercel.app',true),'own device can be registered again');
update public.notifications set message_count=6,created_at=clock_timestamp() where id='44000000-0000-4000-8000-000000001901';
delete from push_claim;
insert into push_claim select public.app_claim_studio_push_deliveries();
update private.push_deliveries set attempted_at=now()-interval '3 minutes' where state='sending';
select private.wake_studio_push();
select is((select state from private.push_deliveries where id=(select (payload->0->>'id')::uuid from push_claim)),'unknown','interrupted attempt stays unknown without blind retry');
select is(jsonb_array_length(public.app_claim_studio_push_deliveries()),0,'uncertain attempt is not claimed again');
update auth.sessions set not_after=now()-interval '1 minute' where id='33000000-0000-4000-8000-000000001901';
select throws_ok($q$select public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/push-test-a')$q$,'42501',null,'expired session cannot approve device display');
select ok(private.push_endpoint_allowed('https://wns2-db5p.notify.windows.com/w/?token=example'),'Microsoft push endpoint accepted');
select ok(not private.push_endpoint_allowed('https://wns2-db5p.notify.windows.com.attacker.invalid/w/x'),'Microsoft lookalike refused');

select * from finish();
rollback;
