begin;
select no_plan();
select ok(to_regprocedure('private.fulfill_manual_invoice_claim(uuid)') is not null,'approved manual claims have a narrow fulfillment helper');
select ok(to_regclass('private.invoice_manual_order_fulfillments') is not null,'manual fulfillment provenance exists');

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b6840000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','manual-fulfillment-'||n||'@example.invalid',now(),now() from generate_series(1,5)n;
insert into public.tenants(id,slug,display_name,status) values
 ('b6840000-0000-4000-8000-000000000010','manual-fulfillment-a','Manual Fulfillment A','active'),
 ('b6840000-0000-4000-8000-000000000011','manual-fulfillment-b','Manual Fulfillment B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('b6840000-0000-4000-8000-000000000020','b6840000-0000-4000-8000-000000000010','Invoice Buyer','client'),
 ('b6840000-0000-4000-8000-000000000021','b6840000-0000-4000-8000-000000000010','Other Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'b6840000-0000-4000-8000-000000000010',v.profile_id::uuid,v.class,r.id,v.company_id::uuid
from(values
 ('b6840000-0000-4000-8000-000000000001','internal','owner',null),
 ('b6840000-0000-4000-8000-000000000002','client','client','b6840000-0000-4000-8000-000000000020'),
 ('b6840000-0000-4000-8000-000000000003','client','client','b6840000-0000-4000-8000-000000000020'),
 ('b6840000-0000-4000-8000-000000000004','internal','staff',null),
 ('b6840000-0000-4000-8000-000000000005','client','client','b6840000-0000-4000-8000-000000000021')
)v(profile_id,class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('b6840000-0000-4000-8000-000000000010','b6840000-0000-4000-8000-000000000004','invoices.view',true),
 ('b6840000-0000-4000-8000-000000000010','b6840000-0000-4000-8000-000000000004','invoices.mark_paid',true),
 ('b6840000-0000-4000-8000-000000000010','b6840000-0000-4000-8000-000000000004','projects.create',false),
 ('b6840000-0000-4000-8000-000000000010','b6840000-0000-4000-8000-000000000004','forms.assign',false);
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring) values
 ('b6840000-0000-4000-8000-000000000030','b6840000-0000-4000-8000-000000000010','Manual Intake Service',10,'USD',true,true,false),
 ('b6840000-0000-4000-8000-000000000031','b6840000-0000-4000-8000-000000000010','Existing Service',10,'USD',true,true,false);
create function pg_temp.act(n integer,tenant text default 'b6840000-0000-4000-8000-000000000010') returns void language sql as $$
select set_config('request.jwt.claim.sub','b6840000-0000-4000-8000-00000000000'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);$$;
create function pg_temp.try(command text) returns text language plpgsql as $$begin execute command;return 'OK';exception when others then return sqlstate;end;$$;
-- Test-only trusted wrapper exposes the private helper to exercise its own current-actor checks.
create function pg_temp.fulfill(id uuid) returns uuid[] language sql security definer set search_path='' as $$select private.fulfill_manual_invoice_claim(id);$$;
grant execute on function pg_temp.fulfill(uuid) to authenticated;
create temp table fulfillment_ids(label text primary key,id uuid);
grant all on fulfillment_ids to authenticated;
set local role authenticated;
select pg_temp.act(1);
insert into fulfillment_ids select 'existing-order',(public.app_create_order(gen_random_uuid(),'b6840000-0000-4000-8000-000000000020','b6840000-0000-4000-8000-000000000031','Existing ordered line')).id;
insert into fulfillment_ids
select v.label,(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake','canonical_key','manual-fulfill-'||v.label,
 'definition',jsonb_build_object('name','Manual '||v.label,'title','Manual '||v.label,'visibility','assigned','type_config',jsonb_build_object(),
 'fields',jsonb_build_array(jsonb_build_object('stable_field_key',v.field,'sort_order',0,'field_type','text','label','Brief','required',true)),
 'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','b6840000-0000-4000-8000-000000000030','role','intake_assignment','sort_order',0,'configuration',jsonb_build_object())))))).id
from(values('form-a','b6840000-0000-4000-8000-000000000050'),('form-b','b6840000-0000-4000-8000-000000000051'))v(label,field);
select public.app_publish_form(gen_random_uuid(),id) from fulfillment_ids where label in('form-a','form-b');
insert into fulfillment_ids select 'invoice',(public.app_create_invoice(gen_random_uuid(),jsonb_build_object(
 'company_id','b6840000-0000-4000-8000-000000000020','client_profile_id','b6840000-0000-4000-8000-000000000002','currency','USD','billing_reason','manual','due_at',now()+interval '7 days','tax_total_cents',0,
 'items',jsonb_build_array(
  jsonb_build_object('service_id','b6840000-0000-4000-8000-000000000030','name','Two units, one line','description','Frozen commercial description','quantity',2,'unit_price_cents',1000,'unit_discount_cents',0,'is_taxable',false),
  jsonb_build_object('service_id','b6840000-0000-4000-8000-000000000030','name','Same service, another line','quantity',1,'unit_price_cents',500,'unit_discount_cents',0,'is_taxable',false),
  jsonb_build_object('service_id','b6840000-0000-4000-8000-000000000031','name','Already linked service','quantity',1,'unit_price_cents',700,'unit_discount_cents',0,'is_taxable',false),
  jsonb_build_object('service_id',null,'name','Custom consulting','quantity',1,'unit_price_cents',300,'unit_discount_cents',0,'is_taxable',false))))).id;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.invoice_items set order_id=(select id from fulfillment_ids where label='existing-order'),fulfillment_status='provisioned'
 where invoice_id=(select id from fulfillment_ids where label='invoice') and position=2;
create temp table item_baseline as select id,to_jsonb(item)-array['order_id','fulfillment_status','updated_at'] as commercial
 from public.invoice_items item where invoice_id=(select id from fulfillment_ids where label='invoice');
set local role authenticated;
select pg_temp.act(1);
select public.app_issue_invoice(id) from fulfillment_ids where label='invoice';
select pg_temp.act(4);
insert into fulfillment_ids select 'payment',(public.app_record_invoice_payment(gen_random_uuid(),id,3500,'succeeded','manual')).id from fulfillment_ids where label='invoice';
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into private.invoice_payment_receipts(id,tenant_id,invoice_id,uploader_profile_id,request_id,original_name,mime_type,size_bytes,checksum_sha256,object_key,verified_at)
select 'b6840000-0000-4000-8000-000000000060','b6840000-0000-4000-8000-000000000010',id,'b6840000-0000-4000-8000-000000000003',gen_random_uuid(),'synthetic.png','image/png',100,repeat('a',64),'synthetic-fulfillment/receipt.png',now()
from fulfillment_ids where label='invoice';
insert into private.invoice_manual_payment_claims(id,tenant_id,invoice_id,company_id,client_profile_id,request_id,receipt_id,amount_cents,currency,method,status,reviewed_at,reviewed_by_profile_id,reconciliation_reference,paid_at,payment_id)
select 'b6840000-0000-4000-8000-000000000061','b6840000-0000-4000-8000-000000000010',id,'b6840000-0000-4000-8000-000000000020','b6840000-0000-4000-8000-000000000003',gen_random_uuid(),'b6840000-0000-4000-8000-000000000060',3500,'USD','paypal','approved',now(),'b6840000-0000-4000-8000-000000000004','SYNTHETIC-PAID-184',now(),(select id from fulfillment_ids where label='payment')
from fulfillment_ids where label='invoice';
create temp table wallet_baseline as select company_id,balance_cents from public.company_wallets where company_id='b6840000-0000-4000-8000-000000000020';
select ok(not has_function_privilege('authenticated','private.fulfill_manual_invoice_claim(uuid)','EXECUTE'),'authenticated cannot call trusted helper directly');
select ok(not has_table_privilege('authenticated','private.invoice_manual_order_fulfillments','INSERT'),'authenticated cannot forge fulfillment provenance');
select ok(not has_table_privilege('service_role','private.invoice_manual_order_fulfillments','INSERT'),'service role has no provenance write');
set local role authenticated;
select pg_temp.act(2);
select is(pg_temp.try($q$select pg_temp.fulfill('b6840000-0000-4000-8000-000000000061')$q$),'42501','client cannot fulfill a paid claim');
select pg_temp.act(4,'b6840000-0000-4000-8000-000000000011');
select is(pg_temp.try($q$select pg_temp.fulfill('b6840000-0000-4000-8000-000000000061')$q$),'42501','other Tenant cannot fulfill');
select pg_temp.act(4);
select is(pg_temp.try($q$select public.app_create_order(gen_random_uuid(),'b6840000-0000-4000-8000-000000000020','b6840000-0000-4000-8000-000000000030','Unrelated project')$q$),'42501','reviewer still lacks general project creation');
select is(cardinality(pg_temp.fulfill('b6840000-0000-4000-8000-000000000061')),3,'two unlinked service lines plus reused Order returned');
select is(cardinality(pg_temp.fulfill('b6840000-0000-4000-8000-000000000061')),3,'exact fulfillment replay returns same three Orders');
reset role;
select is((select count(*)::int from public.orders where tenant_id='b6840000-0000-4000-8000-000000000010'),3,'one Order per service line, not per unit and no custom Order');
select is((select count(*)::int from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000061'),2,'only newly provisioned lines earn manual origin');
select is((select count(*)::int from public.form_assignments where order_id in(select order_id from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000061')),4,'each new service Order freezes both required forms');
select ok((select bool_and(a.client_profile_id='b6840000-0000-4000-8000-000000000002' and a.assigned_by_profile_id='b6840000-0000-4000-8000-000000000004' and a.required)
 from public.form_assignments a where order_id in(select order_id from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000061')),'forms belong to billed client; reviewer is recorded without impersonation');
select is((select count(*)::int from private.client_order_starts where order_id in(select order_id from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000061')),2,'manual origin gates intake without enabling Store rollout');
select ok(not exists(select 1 from public.invoice_items i join item_baseline b using(id) where to_jsonb(i)-array['order_id','fulfillment_status','updated_at'] is distinct from b.commercial),'commercial item fields unchanged');
select is((select balance_cents from public.company_wallets where company_id='b6840000-0000-4000-8000-000000000020'),(select balance_cents from wallet_baseline),'fulfillment never debits wallet');
select is((select count(*)::int from public.company_wallet_transactions where company_id='b6840000-0000-4000-8000-000000000020'),0,'no wallet purchase was rerun');
insert into fulfillment_ids select 'new-order',order_id from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000061' order by invoice_item_id limit 1;
create temp table frozen_baseline as select a.id,a.form_version_id from public.form_assignments a where a.order_id=(select id from fulfillment_ids where label='new-order');
create temp table gate_projection_baseline as select order_id,assignment_ids,assignment_versions from private.client_order_starts where order_id=(select id from fulfillment_ids where label='new-order');
insert into fulfillment_ids select 'projection-assignment',unnest(assignment_ids) from gate_projection_baseline order by 2 limit 1;
select set_config('request.jwt.claim.sub','',true);
update private.client_order_starts set assignment_ids=array_append(assignment_ids,'b6840000-0000-4000-8000-000000000099'::uuid)
 where order_id=(select id from fulfillment_ids where label='new-order');
set local role authenticated;
select pg_temp.act(2);
select is(jsonb_array_length(public.app_get_my_order_start(id)->'forms'),3,'missing frozen assignment stays visibly required rather than disappearing') from fulfillment_ids where label='new-order';
select is((select (value->>'available')::boolean from fulfillment_ids ids,jsonb_array_elements(public.app_get_my_order_start(ids.id)->'forms') where ids.label='new-order' and value->>'id'='b6840000-0000-4000-8000-000000000099'),false,'missing frozen assignment is unavailable');
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'missing requirement blocks Start') from fulfillment_ids where label='new-order';
reset role;
select set_config('request.jwt.claim.sub','',true);
update private.client_order_starts g set assignment_ids=b.assignment_ids from gate_projection_baseline b where g.order_id=b.order_id;
update public.form_assignments set status='archived',archived_at=now() where id=(select id from fulfillment_ids where label='projection-assignment');
set local role authenticated;
select pg_temp.act(2);
select is(jsonb_array_length(public.app_get_my_order_start(id)->'forms'),2,'archived frozen assignment remains in the requirement projection') from fulfillment_ids where label='new-order';
select is((select (value->>'available')::boolean from fulfillment_ids ids,jsonb_array_elements(public.app_get_my_order_start(ids.id)->'forms') where ids.label='new-order' and value->>'id'=(select id::text from fulfillment_ids where label='projection-assignment')),false,'archived required assignment is unavailable');
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'archived requirement blocks Start') from fulfillment_ids where label='new-order';
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.form_assignments set status='completed',archived_at=null,completed_at=now(),latest_submission_id=null where id=(select id from fulfillment_ids where label='projection-assignment');
set local role authenticated;
select pg_temp.act(2);
select is((select (value->>'completed')::boolean from fulfillment_ids ids,jsonb_array_elements(public.app_get_my_order_start(ids.id)->'forms') where ids.label='new-order' and value->>'id'=(select id::text from fulfillment_ids where label='projection-assignment')),false,'status-only completed never substitutes for matching submitted evidence');
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'status-only completed requirement blocks Start') from fulfillment_ids where label='new-order';
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.form_assignments set status='assigned',completed_at=null where id=(select id from fulfillment_ids where label='projection-assignment');
update private.client_order_starts set assignment_versions=assignment_versions||jsonb_build_object((select id::text from fulfillment_ids where label='projection-assignment'),'b6840000-0000-4000-8000-000000000098')
 where order_id=(select id from fulfillment_ids where label='new-order');
set local role authenticated;
select pg_temp.act(2);
select is((select (value->>'available')::boolean from fulfillment_ids ids,jsonb_array_elements(public.app_get_my_order_start(ids.id)->'forms') where ids.label='new-order' and value->>'id'=(select id::text from fulfillment_ids where label='projection-assignment')),false,'frozen version mismatch is unavailable');
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'frozen version mismatch blocks Start') from fulfillment_ids where label='new-order';
reset role;
select set_config('request.jwt.claim.sub','',true);
update private.client_order_starts g set assignment_versions=b.assignment_versions from gate_projection_baseline b where g.order_id=b.order_id;
set local role authenticated;
select pg_temp.act(2);
select is((public.app_get_my_order_start(id)->>'available')::boolean,true,'billed client can request manual-origin Order start without Store rollout') from fulfillment_ids where label='new-order';
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'unsubmitted required forms prevent start') from fulfillment_ids where label='new-order';
select pg_temp.act(3);
select ok(public.app_get_my_order_start(id) is null,'claimant colleague cannot access billed-client intake gate') from fulfillment_ids where label='new-order';
select pg_temp.act(1);
select public.app_publish_form(gen_random_uuid(),id) from fulfillment_ids where label='form-a';
select pg_temp.act(2);
select ok(not has_column_privilege('authenticated','public.form_assignments','order_id','SELECT'),'client workflow keeps raw assignment Order linkage private');
select public.app_submit_form(gen_random_uuid(),(public.app_get_assigned_form_schema(a.id)->'schema'->>'form_version_id')::uuid,jsonb_build_object('assignment_id',a.id),
 jsonb_build_array(jsonb_build_object('field_key',case when (public.app_get_assigned_form_schema(a.id)#>>'{assignment,form_id}')::uuid=(select id from fulfillment_ids where label='form-a') then 'b6840000-0000-4000-8000-000000000050' else 'b6840000-0000-4000-8000-000000000051' end,'value','Synthetic manual brief')),'[]')
 from jsonb_to_recordset(public.app_get_my_order_start((select id from fulfillment_ids where label='new-order'))->'forms') as a(id uuid);
select is((public.app_request_my_order_start(id)->>'started')::boolean,true,'both frozen forms permit requested start') from fulfillment_ids where label='new-order';
reset role;
select ok(not exists(select 1 from public.form_assignments a join frozen_baseline b using(id) where a.form_version_id<>b.form_version_id),'republication does not change frozen requirements');
set local role authenticated;
select pg_temp.act(1);
insert into fulfillment_ids select 'null-client-invoice',(public.app_create_invoice(gen_random_uuid(),jsonb_build_object(
 'company_id','b6840000-0000-4000-8000-000000000020','client_profile_id',null,'currency','USD','billing_reason','manual','due_at',now()+interval '7 days','tax_total_cents',0,
 'items',jsonb_build_array(jsonb_build_object('service_id','b6840000-0000-4000-8000-000000000031','name','Claimant intake recipient fallback','quantity',1,'unit_price_cents',1000,'unit_discount_cents',0,'is_taxable',false))))).id;
select public.app_issue_invoice(id) from fulfillment_ids where label='null-client-invoice';
select pg_temp.act(4);
insert into fulfillment_ids select 'null-client-payment',(public.app_record_invoice_payment(gen_random_uuid(),id,1000,'succeeded','manual')).id from fulfillment_ids where label='null-client-invoice';
reset role;
select is((select count(*)::int from public.orders where tenant_id='b6840000-0000-4000-8000-000000000010'),3,'ordinary succeeded historical/manual payment does not backfill Orders without an approved claim');
select set_config('request.jwt.claim.sub','',true);
insert into private.invoice_payment_receipts(id,tenant_id,invoice_id,uploader_profile_id,request_id,original_name,mime_type,size_bytes,checksum_sha256,object_key,verified_at)
select 'b6840000-0000-4000-8000-000000000070','b6840000-0000-4000-8000-000000000010',id,'b6840000-0000-4000-8000-000000000003',gen_random_uuid(),'synthetic-null.png','image/png',100,repeat('b',64),'synthetic-fulfillment/null-receipt.png',now()
from fulfillment_ids where label='null-client-invoice';
insert into private.invoice_manual_payment_claims(id,tenant_id,invoice_id,company_id,client_profile_id,request_id,receipt_id,amount_cents,currency,method,status,reviewed_at,reviewed_by_profile_id,reconciliation_reference,paid_at,payment_id)
select 'b6840000-0000-4000-8000-000000000071','b6840000-0000-4000-8000-000000000010',id,'b6840000-0000-4000-8000-000000000020','b6840000-0000-4000-8000-000000000003',gen_random_uuid(),'b6840000-0000-4000-8000-000000000070',1000,'USD','bank_transfer','approved',now(),'b6840000-0000-4000-8000-000000000004','SYNTHETIC-PAID-184-NULL',now(),(select id from fulfillment_ids where label='null-client-payment')
from fulfillment_ids where label='null-client-invoice';
set local role authenticated;
select pg_temp.act(4);
select is(cardinality(pg_temp.fulfill('b6840000-0000-4000-8000-000000000071')),1,'null billed-client profile uses current approved claimant');
reset role;
select is((select client_profile_id from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000071'),'b6840000-0000-4000-8000-000000000003'::uuid,'recipient fallback is approved claimant, never reviewer');
select is((select count(*)::int from private.client_order_starts where order_id in(select order_id from private.invoice_manual_order_fulfillments where claim_id='b6840000-0000-4000-8000-000000000071')),0,'a service without required intake remains ungated');
select set_config('request.jwt.claim.sub','',true);
update public.profile_permission_overrides set allowed=false where tenant_id='b6840000-0000-4000-8000-000000000010' and profile_id='b6840000-0000-4000-8000-000000000004' and permission_key='invoices.mark_paid';
set local role authenticated;
select pg_temp.act(4);
select is(pg_temp.try($q$select pg_temp.fulfill('b6840000-0000-4000-8000-000000000061')$q$),'42501','revoked reviewer cannot replay fulfillment');
reset role;
select * from finish();
rollback;
