begin;
select no_plan();

-- Configuration, Vault fixtures, subscriptions and jobs all roll back together.
delete from private.studio_push_configuration;
delete from vault.secrets where name in ('studio_push_vapid_private','studio_push_dispatch_api_key');

create function pg_temp.configure_push(p_project text,p_origin text) returns boolean
language sql as $$
select public.app_configure_studio_push(p_project,p_origin,repeat('A',87),repeat('B',43),repeat('C',40));
$$;

select ok(not has_function_privilege('anon','public.app_configure_studio_push(text,text,text,text,text)','execute'),'anonymous cannot provision production push');
select ok(not has_function_privilege('authenticated','public.app_configure_studio_push(text,text,text,text,text)','execute'),'client cannot provision production push');
select ok(has_function_privilege('service_role','public.app_configure_studio_push(text,text,text,text,text)','execute'),'trusted provisioning retains its existing grant');
set local role anon;
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'42501',null,'actual anonymous execution is denied');
reset role;
set local role authenticated;
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'42501',null,'actual client execution is denied');
reset role;

select is((select count(*) from private.studio_push_configuration),0::bigint,'configuration is absent until explicit provisioning');
set local role service_role;
select ok(pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app'),'production can be explicitly provisioned for WOAD');
reset role;
select ok((select enabled and project_url='https://jwynqsyirgenqlmkooah.supabase.co'
  and origin='https://wolf-forge-platform-woad.vercel.app' and tenant_id=private.wolf_forge_tenant_id()
  from private.studio_push_configuration),'production configuration has the exact backend, origin and owning Tenant');
select is((select count(*) from cron.job where jobname='studio-web-push-wake'),1::bigint,'provisioning schedules only one existing wake job');
create temp table production_push_before as select to_jsonb(c) as value from private.studio_push_configuration c;

select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-test-wolf-forge.vercel.app')$q$,'22023',null,'production backend refuses Studio origin');
select throws_ok($q$select pg_temp.configure_push('https://rsnmlcyopnxucwgfttyf.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'22023',null,'Studio backend refuses production origin');
select throws_ok($q$select pg_temp.configure_push('https://unrelated.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'22023',null,'unrelated backend is refused');
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app.attacker.invalid')$q$,'22023',null,'lookalike production origin is refused');
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app:8443')$q$,'22023',null,'noncanonical production port is refused');
select throws_ok($q$select pg_temp.configure_push('https://rsnmlcyopnxucwgfttyf.supabase.co','https://wolf-forge-platform-test-wolf-forge.vercel.app')$q$,'42501',null,'unverified Studio host cannot replace production');

update public.tenant_domains set verified_at=null where host='wolf-forge-platform-woad.vercel.app';
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'42501',null,'production requires independently verified host mapping');
update public.tenant_domains set verified_at=now(),disabled_at=now() where host='wolf-forge-platform-woad.vercel.app';
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'42501',null,'disabled production host is refused');
update public.tenant_domains set disabled_at=null where host='wolf-forge-platform-woad.vercel.app';
insert into public.tenants(id,slug,display_name,status) values
('f0f0f0f0-0000-4000-8000-000000001963','production-push-foreign','Production push foreign fixture','active');
update public.tenant_domains set tenant_id='f0f0f0f0-0000-4000-8000-000000001963' where host='wolf-forge-platform-woad.vercel.app';
select throws_ok($q$select pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app')$q$,'42501',null,'production origin cannot target another Tenant');
update public.tenant_domains set tenant_id=private.wolf_forge_tenant_id() where host='wolf-forge-platform-woad.vercel.app';
select throws_ok($q$select public.app_configure_studio_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app',repeat('D',87),repeat('B',43),repeat('C',40))$q$,'22023',null,'existing production public key cannot silently rotate');
select is((select to_jsonb(c) from private.studio_push_configuration c),(select value from production_push_before),'denied provisioning leaves every production configuration field unchanged');
select ok(pg_temp.configure_push('https://jwynqsyirgenqlmkooah.supabase.co','https://wolf-forge-platform-woad.vercel.app'),'same production configuration can be provisioned again');
select is((select count(*) from cron.job where jobname='studio-web-push-wake'),1::bigint,'repeated provisioning does not duplicate schedules');

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000'||n)::uuid,'authenticated','authenticated','production-push-'||n||'@example.invalid',now(),now()
from unnest(array['1961','1962']) n;
insert into public.companies(id,tenant_id,name,status)
values('e0000000-0000-4000-8000-000000001963',private.wolf_forge_tenant_id(),'Production push synthetic client','client');
update public.profiles set role_id=(select id from public.roles where name='client'),company_id='e0000000-0000-4000-8000-000000001963'
where id in ('20000000-0000-4000-8000-000000001961','20000000-0000-4000-8000-000000001962');
insert into auth.sessions(id,user_id,aal,not_after)
select ('33000000-0000-4000-8000-00000000'||n)::uuid,('20000000-0000-4000-8000-00000000'||n)::uuid,'aal1',now()+interval '1 day'
from unnest(array['1961','1962']) n;
create function pg_temp.production_push_actor(p_suffix text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||p_suffix,'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||p_suffix)::text,true);
  perform set_config('request.headers',jsonb_build_object('x-wf-tenant',private.wolf_forge_tenant_id())::text,true);
end $$;
select pg_temp.production_push_actor('1961');
set local role authenticated;
select is(public.app_get_my_push_configuration()->>'origin','https://wolf-forge-platform-woad.vercel.app','production client receives canonical WOAD configuration');
select is((select count(*) from jsonb_object_keys(public.app_get_my_push_configuration())),2::bigint,'production client receives no dispatcher secrets');
select ok(not public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/production-push-fixture'),'new production client is not enrolled automatically');
select ok(public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/production-push-fixture','https://wolf-forge-platform-woad.vercel.app',true),'production client can explicitly enroll a device');
select ok(public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/production-push-fixture'),'production device is active for its own session');
reset role;
select pg_temp.production_push_actor('1962');
set local role authenticated;
select ok(not public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/production-push-fixture'),'another client cannot inspect the production device');
select throws_ok($q$select public.app_set_my_push_subscription('https://fcm.googleapis.com/wp/production-push-fixture','https://wolf-forge-platform-woad.vercel.app',true)$q$,'42501',null,'another client cannot claim the production device');
reset role;
select pg_temp.production_push_actor('1961');
set local role authenticated;
select public.app_disable_my_push_session();
select ok(not public.app_my_push_subscription_active('https://fcm.googleapis.com/wp/production-push-fixture'),'production logout disables its current session device');
reset role;

insert into public.tenant_domains(host,tenant_id,verified_at)
values('wolf-forge-platform-productionpush-wolf-forge.vercel.app',private.wolf_forge_tenant_id(),now());
select throws_ok($q$select pg_temp.configure_push('https://rsnmlcyopnxucwgfttyf.supabase.co','https://wolf-forge-platform-productionpush-wolf-forge.vercel.app')$q$,'22023',null,'a configured backend cannot be switched from production to Studio');
delete from private.studio_push_configuration;
delete from vault.secrets where name in ('studio_push_vapid_private','studio_push_dispatch_api_key');
select ok(pg_temp.configure_push('https://rsnmlcyopnxucwgfttyf.supabase.co','https://wolf-forge-platform-productionpush-wolf-forge.vercel.app'),'an independent Studio configuration remains supported for testing');
select is((select project_url from private.studio_push_configuration),'https://rsnmlcyopnxucwgfttyf.supabase.co','Studio configuration retains its separate backend');

select * from finish();
rollback;
