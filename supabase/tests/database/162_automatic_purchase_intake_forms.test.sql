begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('a6210000-0000-4000-8000-00000000000'||n)::uuid,
  'authenticated','authenticated','auto-intake-'||n||'@example.invalid',now(),now()
from generate_series(1,4) n;
insert into public.tenants(id,slug,display_name,status) values
('a6210000-0000-4000-8000-000000000010','auto-intake-a','Automatic Intake A','active'),
('a6210000-0000-4000-8000-000000000011','auto-intake-b','Automatic Intake B','active');
insert into public.companies(id,tenant_id,name,status) values
('a6210000-0000-4000-8000-000000000020','a6210000-0000-4000-8000-000000000010','Intake Buyer','client'),
('a6210000-0000-4000-8000-000000000021','a6210000-0000-4000-8000-000000000010','Other Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'a6210000-0000-4000-8000-000000000010',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('a6210000-0000-4000-8000-000000000001','internal','owner',null),
('a6210000-0000-4000-8000-000000000002','client','client','a6210000-0000-4000-8000-000000000020'),
('a6210000-0000-4000-8000-000000000003','client','client','a6210000-0000-4000-8000-000000000020'),
('a6210000-0000-4000-8000-000000000004','client','client','a6210000-0000-4000-8000-000000000021')
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
select ('a6210000-0000-4000-8000-00000000003'||n)::uuid,
  'a6210000-0000-4000-8000-000000000010','Intake Service '||n,10,'USD',true,true,false,n
from generate_series(1,3) n;
update public.company_wallets set balance_cents=10000
where company_id='a6210000-0000-4000-8000-000000000020';

create function pg_temp.act(n integer, tenant text default 'a6210000-0000-4000-8000-000000000010')
returns void language sql as $$
select set_config('request.jwt.claim.sub','a6210000-0000-4000-8000-00000000000'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.try(sql_text text) returns text language plpgsql as $$
begin execute sql_text; return 'OK'; exception when others then return sqlstate; end;
$$;
create temp table intake_ids(label text primary key,id uuid);
create temp table purchases(label text,order_id uuid,invoice_id uuid);
grant all on intake_ids,purchases to authenticated;

set local role authenticated;
select pg_temp.act(1);
insert into intake_ids
select v.label,(public.app_create_form(gen_random_uuid(),jsonb_build_object(
  'form_type','intake','canonical_key','auto-'||v.label,'definition',jsonb_build_object(
    'name','Automatic '||v.label,'title','Automatic '||v.label,'visibility','assigned',
    'type_config','{}'::jsonb,'fields',jsonb_build_array(jsonb_build_object(
      'stable_field_key',gen_random_uuid(),'sort_order',0,'field_type','text',
      'label','Full Business Name','required',true,'settings','{}'::jsonb,
      'options','[]'::jsonb,'service_links','[]'::jsonb)),
    'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object(
      'service_id',v.service_id,'role','intake_assignment','sort_order',0,'configuration','{}'::jsonb))
  )))).id
from (values
('seo','a6210000-0000-4000-8000-000000000031'),
('access','a6210000-0000-4000-8000-000000000031'),
('draft','a6210000-0000-4000-8000-000000000031'),
('inactive','a6210000-0000-4000-8000-000000000031'),
('other-service','a6210000-0000-4000-8000-000000000032')
) v(label,service_id);
select public.app_publish_form(gen_random_uuid(),id) from intake_ids where label<>'draft';
reset role;
update public.forms set status='inactive' where id=(select id from intake_ids where label='inactive');

select ok(not has_function_privilege('authenticated','private.assign_purchase_intake_forms(uuid)','EXECUTE'),
  'clients cannot call the automatic assignment helper directly');
select ok(not has_function_privilege('anon','private.assign_purchase_intake_forms(uuid)','EXECUTE'),
  'anonymous users cannot call the helper');
select ok(not has_function_privilege('service_role','private.assign_purchase_intake_forms(uuid)','EXECUTE'),
  'service role cannot call the helper');

set local role authenticated;
select pg_temp.act(2);
insert into purchases select 'first',order_id,invoice_id
from public.app_purchase_service_with_balance('a6210000-0000-4000-8000-000000000041','a6210000-0000-4000-8000-000000000031');
select is((select count(*)::int from public.app_list_assigned_forms() where form_id in(select id from intake_ids)),2,
  'buyer immediately receives both published Service intake forms');
reset role;
select is((select count(*)::int from public.form_assignments where order_id=(select order_id from purchases where label='first')),2,
  'one assignment per linked published Form; draft and inactive are skipped');
select ok((select bool_and(client_profile_id='a6210000-0000-4000-8000-000000000002'
  and company_id='a6210000-0000-4000-8000-000000000020' and required)
  from public.form_assignments where order_id=(select order_id from purchases where label='first')),
  'assignment is required and scoped to the purchaser and exact company');
select ok((select bool_and(a.form_version_id=f.published_version_id)
  from public.form_assignments a join public.forms f on f.id=a.form_id
  where a.order_id=(select order_id from purchases where label='first')),'published versions are pinned');
select is((select count(*)::int from public.notifications n join public.form_assignments a on a.id=n.entity_id
  where a.order_id=(select order_id from purchases where label='first') and n.recipient_profile_id='a6210000-0000-4000-8000-000000000002'),2,
  'buyer receives the existing in-app form notifications');
select is((select count(*)::int from public.notifications n join public.form_assignments a on a.id=n.entity_id
  where a.order_id=(select order_id from purchases where label='first') and n.recipient_profile_id<>'a6210000-0000-4000-8000-000000000002'),0,
  'form notifications are not broadcast to other client accounts');

set local role authenticated;
select pg_temp.act(3);
select is((select count(*)::int from public.app_list_assigned_forms() where form_id in(select id from intake_ids)),0,
  'another account in the same company cannot see the buyer forms');
select pg_temp.act(4);
select is((select count(*)::int from public.app_list_assigned_forms() where form_id in(select id from intake_ids)),0,
  'a different company cannot see the forms');
select pg_temp.act(2,'a6210000-0000-4000-8000-000000000011');
select isnt(pg_temp.try($q$select * from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000049','a6210000-0000-4000-8000-000000000031')$q$),'OK',
  'a foreign Tenant cannot use this purchase context');
select pg_temp.act(2);
select ok((select replayed from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000041','a6210000-0000-4000-8000-000000000031')),'same request replays the purchase');
reset role;
select is((select count(*)::int from public.form_assignments where order_id=(select order_id from purchases where label='first')),2,
  'a replay creates no duplicate assignments');
select is((select balance_cents::int from public.company_wallets where company_id='a6210000-0000-4000-8000-000000000020'),9000,
  'a replay does not debit the wallet twice');

set local role authenticated;
select pg_temp.act(2);
insert into purchases select 'second',order_id,invoice_id from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000042','a6210000-0000-4000-8000-000000000031');
insert into purchases select 'different',order_id,invoice_id from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000043','a6210000-0000-4000-8000-000000000032');
insert into purchases select 'none',order_id,invoice_id from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000044','a6210000-0000-4000-8000-000000000033');
reset role;
select is((select count(*)::int from public.form_assignments where order_id=(select order_id from purchases where label='second')),2,
  'a separate purchase gets separate forms for its own Project');
select is((select count(*)::int from public.form_assignments where order_id=(select order_id from purchases where label='different')
  and form_id=(select id from intake_ids where label='other-service')),1,'a different Service receives its own Form');
select is((select count(*)::int from public.form_assignments where order_id=(select order_id from purchases where label='none')),0,
  'a Service without a linked published Form still purchases normally');

select set_config('request.jwt.claim.sub','',true);
update public.company_wallets set balance_cents=0 where company_id='a6210000-0000-4000-8000-000000000020';
set local role authenticated;
select pg_temp.act(2);
select isnt(pg_temp.try($q$select * from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000045','a6210000-0000-4000-8000-000000000031')$q$),'OK',
  'insufficient funds refuse a purchase');
reset role;
select is((select count(*)::int from public.orders where tenant_id='a6210000-0000-4000-8000-000000000010'),4,
  'a failed purchase creates no Project');
select is((select count(*)::int from public.form_assignments a join public.forms f on f.id=a.form_id
  where f.tenant_id='a6210000-0000-4000-8000-000000000010'),5,'a failed purchase creates no Form assignment');

select is((select count(*)::int from public.invoices where tenant_id='a6210000-0000-4000-8000-000000000010'),4,
  'a failed purchase leaves no Invoice');
select is((select count(*)::int from public.company_wallet_transactions
  where company_id='a6210000-0000-4000-8000-000000000020'),4,
  'a failed purchase leaves no wallet debit');

select set_config('request.jwt.claim.sub','',true);
select private.grant_platform_admin('a6210000-0000-4000-8000-000000000001','Automatic Intake rollback fixture');
select pg_temp.act(1);
select private.publish_tenant_modules('a6210000-0000-4000-8000-000000000010',0,
  (select array_agg(module_key order by module_key) from private.white_label_modules where module_key<>'forms'),
  'Automatic Intake Forms OFF fixture');
select ok(not private.tenant_module_allowed('a6210000-0000-4000-8000-000000000010','forms'),
  'Forms OFF fixture is actually disabled');
select set_config('request.jwt.claim.sub','',true);
update public.company_wallets set balance_cents=10000 where company_id='a6210000-0000-4000-8000-000000000020';
set local role authenticated;
select pg_temp.act(2);
insert into purchases select 'forms-off',order_id,invoice_id from public.app_purchase_service_with_balance(
  'a6210000-0000-4000-8000-000000000046','a6210000-0000-4000-8000-000000000031');
reset role;
select is((select count(*)::int from public.form_assignments where order_id=(select order_id from purchases where label='forms-off')),0,
  'Forms OFF does not create new assignments');
select is((select status from public.invoices where id=(select invoice_id from purchases where label='forms-off')),'paid',
  'Forms OFF still allows an otherwise valid purchase');
select is((select count(*)::int from public.form_assignments a join public.forms f on f.id=a.form_id
  where f.tenant_id='a6210000-0000-4000-8000-000000000010'),5,
  'Forms OFF preserves earlier assignments without backfill');

select * from finish();
rollback;
