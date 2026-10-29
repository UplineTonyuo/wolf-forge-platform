begin;
select no_plan();

select has_function('public', 'app_consume_private_download_byte_budget', array['uuid', 'uuid', 'bigint'], 'trusted byte budget RPC exists');
select ok(not has_function_privilege('anon', 'public.app_consume_private_download_byte_budget(uuid,uuid,bigint)', 'execute'), 'anon cannot reserve or select subjects');
select ok(not has_function_privilege('authenticated', 'public.app_consume_private_download_byte_budget(uuid,uuid,bigint)', 'execute'), 'authenticated cannot reserve or select subjects');
select ok(has_function_privilege('service_role', 'public.app_consume_private_download_byte_budget(uuid,uuid,bigint)', 'execute'), 'only trusted server can reserve bytes');
select ok(not exists (
  select 1 from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.app_consume_private_download_byte_budget(uuid,uuid,bigint)'::regprocedure and a.grantee = 0
), 'PUBLIC has no function grant');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.private_download_byte_counters'::regclass), 'durable counters enable and force RLS');
select ok(not has_table_privilege('anon', 'private.private_download_byte_counters', 'select,insert,update,delete,truncate,references,trigger'), 'anon has no counter grants');
select ok(not has_table_privilege('authenticated', 'private.private_download_byte_counters', 'select,insert,update,delete,truncate,references,trigger'), 'authenticated has no counter grants');
select ok(not has_table_privilege('service_role', 'private.private_download_byte_counters', 'select,insert,update,delete,truncate,references,trigger'), 'service role cannot bypass the RPC with direct counter writes');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.app_consume_private_download_byte_budget(uuid,uuid,bigint)'::regprocedure), 'privileged RPC has an empty search path');

set local role authenticated;
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',1)$$, '42501', null, 'client RPC calls really fail');
reset role;

set local role service_role;
select throws_ok($$select public.app_consume_private_download_byte_budget(null,'de000000-0000-4000-8000-000000000001',1)$$, '22023', null, 'actor is required');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001',null,1)$$, '22023', null, 'metadata Tenant is required');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',null)$$, '22023', null, 'size is required');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',0)$$, '22023', null, 'zero cannot bypass byte accounting');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',-1)$$, '22023', null, 'negative bytes cannot refund usage');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',9223372036854775807)$$, 'WF429', null, 'oversized requests are capped without bigint overflow');

select lives_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',499999999)$$, 'initial partial reservation succeeds');
select lives_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',1)$$, 'exactly 500 MB succeeds');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001',1)$$, 'WF429', null, 'one byte over the account budget fails');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000002',1)$$, 'WF429', null, 'switching Tenants cannot bypass the global account allowance');
reset role;
select is((select sum(bytes)::bigint from private.private_download_byte_counters where scope='actor' and subject='dd000000-0000-4000-8000-000000000001'), 500000000::bigint, 'account denials do not partially charge the actor');
select is((select sum(bytes)::bigint from private.private_download_byte_counters where scope='tenant' and subject='de000000-0000-4000-8000-000000000001'), 500000000::bigint, 'both dimensions committed the same accepted total');
select is((select count(*) from private.private_download_byte_counters where scope='tenant' and subject='de000000-0000-4000-8000-000000000002'), 0::bigint, 'actor denial creates no charge in the other Tenant');

set local role service_role;
select lives_ok($body$do $$begin
  for i in 1..20 loop
    perform public.app_consume_private_download_byte_budget(
      format('dd100000-0000-4000-8000-%s', lpad(i::text,12,'0'))::uuid,
      'de100000-0000-4000-8000-000000000001',500000000);
  end loop;
end$$$body$, '20 separate accounts may consume exactly the 10 GB Tenant ceiling');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd100000-0000-4000-8000-000000000021','de100000-0000-4000-8000-000000000001',1)$$, 'WF429', null, 'Tenant ceiling stops an unused account');
reset role;
select is((select sum(bytes)::bigint from private.private_download_byte_counters where scope='tenant' and subject='de100000-0000-4000-8000-000000000001'), 10000000000::bigint, 'Tenant remains exactly at ceiling');
select is((select count(*) from private.private_download_byte_counters where scope='actor' and subject='dd100000-0000-4000-8000-000000000021'), 0::bigint, 'Tenant refusal atomically leaves the actor uncharged');
set local role service_role;
select lives_ok($$select public.app_consume_private_download_byte_budget('dd100000-0000-4000-8000-000000000021','de100000-0000-4000-8000-000000000002',1)$$, 'another Tenant retains its allowance');
reset role;

-- Seed age boundaries rather than waiting a day. A recent reservation must
-- survive when the older one ages out; a fixed window reset would lose it.
insert into private.private_download_byte_counters(scope,subject,consumed_at,bytes) values
  ('actor','dd200000-0000-4000-8000-000000000001',clock_timestamp()-interval '24 hours',400000000),
  ('actor','dd200000-0000-4000-8000-000000000001',clock_timestamp()-interval '23 hours',100000000),
  ('tenant','de200000-0000-4000-8000-000000000001',clock_timestamp()-interval '24 hours',400000000),
  ('tenant','de200000-0000-4000-8000-000000000001',clock_timestamp()-interval '23 hours',100000000);
set local role service_role;
select lives_ok($$select public.app_consume_private_download_byte_budget('dd200000-0000-4000-8000-000000000001','de200000-0000-4000-8000-000000000001',400000000)$$, '24-hour-old bytes roll out of both dimensions');
select throws_ok($$select public.app_consume_private_download_byte_budget('dd200000-0000-4000-8000-000000000001','de200000-0000-4000-8000-000000000001',1)$$, 'WF429', null, 'younger bytes still count: this is a rolling window');
reset role;
select is((select sum(bytes)::bigint from private.private_download_byte_counters where scope='actor' and subject='dd200000-0000-4000-8000-000000000001'),500000000::bigint,'account rollover preserves younger usage');
select is((select sum(bytes)::bigint from private.private_download_byte_counters where scope='tenant' and subject='de200000-0000-4000-8000-000000000001'),500000000::bigint,'Tenant rollover preserves younger usage');

insert into private.private_download_byte_counters(scope,subject,consumed_at,bytes) values
  ('tenant','de300000-0000-4000-8000-000000000001',clock_timestamp()-interval '24 hours',10000000000);
set local role service_role;
select lives_ok($$select public.app_consume_private_download_byte_budget('dd300000-0000-4000-8000-000000000001','de300000-0000-4000-8000-000000000001',500000000)$$, 'expired aggregate Tenant usage releases capacity');
reset role;

select ok(has_function_privilege('authenticated','public.app_get_intake_file(uuid)','execute') and has_function_privilege('authenticated','public.app_get_ticket_attachment_download(uuid)','execute'), 'existing authorized metadata RPC grants survive');
select ok(not has_function_privilege('anon','public.app_get_intake_file(uuid)','execute') and not has_function_privilege('anon','public.app_get_ticket_attachment_download(uuid)','execute'), 'anonymous metadata reads stay forbidden');

select * from finish();
rollback;
