begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b6270000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','order-start-'||n||'@example.invalid',now(),now() from generate_series(1,3)n;
insert into public.tenants(id,slug,display_name,status) values('b6270000-0000-4000-8000-000000000010','order-start-fixture','Order Start Fixture','active');
insert into public.companies(id,tenant_id,name,status) values
('b6270000-0000-4000-8000-000000000020','b6270000-0000-4000-8000-000000000010','Start Buyer','client'),
('b6270000-0000-4000-8000-000000000021','b6270000-0000-4000-8000-000000000010','Other Start Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'b6270000-0000-4000-8000-000000000010',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid from (values
('b6270000-0000-4000-8000-000000000001','internal','owner',null),
('b6270000-0000-4000-8000-000000000002','client','client','b6270000-0000-4000-8000-000000000020'),
('b6270000-0000-4000-8000-000000000003','client','client','b6270000-0000-4000-8000-000000000021'))v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
values('b6270000-0000-4000-8000-000000000030','b6270000-0000-4000-8000-000000000010','Start Service',10,'USD',true,true,false);
update public.company_wallets set balance_cents=10000 where company_id='b6270000-0000-4000-8000-000000000020';
insert into private.client_order_start_rollout values('b6270000-0000-4000-8000-000000000010','b6270000-0000-4000-8000-000000000030',true);
create function pg_temp.act(n integer) returns void language sql as $$
select set_config('request.jwt.claim.sub','b6270000-0000-4000-8000-00000000000'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers','{"x-wf-tenant":"b6270000-0000-4000-8000-000000000010"}',true);$$;
create function pg_temp.try(command text) returns text language plpgsql as $$begin execute command; return 'OK';exception when others then return sqlstate;end;$$;
create temp table start_ids(label text primary key,id uuid not null);
grant all on start_ids to authenticated;
set local role authenticated;
select pg_temp.act(1);
insert into start_ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake','canonical_key','order-start-fixture',
  'definition',jsonb_build_object('name','Service Intake','title','Service Intake','visibility','assigned','type_config','{}'::jsonb,
    'fields',jsonb_build_array(jsonb_build_object('stable_field_key','b6270000-0000-4000-8000-000000000050','sort_order',0,'field_type','text','label','Business','required',true,'settings','{}'::jsonb,'options','[]'::jsonb,'service_links','[]'::jsonb)),
    'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','b6270000-0000-4000-8000-000000000030','role','intake_assignment','sort_order',0,'configuration','{}'::jsonb)))))).id;
select public.app_publish_form(gen_random_uuid(),id) from start_ids where label='form';
select pg_temp.act(2);
insert into start_ids select 'order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),'b6270000-0000-4000-8000-000000000030');
reset role;
insert into start_ids select 'assignment',a.id from public.form_assignments a
  where a.order_id=(select id from start_ids where label='order') and a.form_id=(select id from start_ids where label='form');
select is((select count(*)::integer from start_ids where label='assignment'),1,'purchase creates exactly one assigned intake');
set local role authenticated;
select pg_temp.act(2);
select is((public.app_get_my_order_start(id)->>'requested')::boolean,false,'purchase waits for an explicit client start') from start_ids where label='order';
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'request does not skip required intake') from start_ids where label='order';
select is((select status from public.app_get_my_client_project(id)),'pending','order remains pending before form completion') from start_ids where label='order';
select pg_temp.act(3);
select ok(public.app_get_my_order_start(id) is null,'other client cannot read order start') from start_ids where label='order';
select is(pg_temp.try(format('select public.app_request_my_order_start(%L)',id)),'42501','other client cannot start the order') from start_ids where label='order';
select pg_temp.act(1);
select public.app_publish_form(gen_random_uuid(),id) from start_ids where label='form';
select pg_temp.act(2);
select ok(public.app_my_intake_version_available(a.id,(public.app_get_assigned_form_schema(a.id)->'schema'->>'form_version_id')::uuid),'frozen intake remains available after republication') from start_ids a where label='assignment';
select public.app_submit_form(gen_random_uuid(),(public.app_get_assigned_form_schema(a.id)->'schema'->>'form_version_id')::uuid,
  jsonb_build_object('assignment_id',a.id),jsonb_build_array(jsonb_build_object('field_key','b6270000-0000-4000-8000-000000000050','value','Synthetic Business')),'[]') from start_ids a where label='assignment';
select is((public.app_reconcile_my_order_start(id)->>'started')::boolean,true,'required form completion starts the requested order') from start_ids where label='assignment';
select is((select status from public.app_get_my_client_project(id)),'working','canonical order is in progress') from start_ids where label='order';
select is((public.app_request_my_order_start(id)->>'started')::boolean,true,'a duplicate start replays the confirmed state') from start_ids where label='order';
reset role;
select is((select count(*)::integer from public.activity_events where entity_id=(select id from start_ids where label='order') and action='order.status_changed' and metadata->>'client_requested'='true'),1,'only one client-start activity is recorded');
select ok(not has_function_privilege('authenticated','private.try_requested_order_start(uuid)','EXECUTE'),'privileged start helper is not a client RPC');
select ok(not has_table_privilege('authenticated','private.client_order_starts','UPDATE'),'client cannot edit request proof');
select ok(not has_function_privilege('anon','public.app_request_my_order_start(uuid)','EXECUTE'),'anonymous start is forbidden');
select * from finish();
rollback;
