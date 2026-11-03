-- Full isolated Supabase only. Synthetic fixtures and all mutations roll back.
-- Written before the proposal implementation; root executes RED against base.
begin;
select no_plan();
select ok(to_regclass('private.invoice_manual_payment_claims') is not null,'separate payment claims exist');
select ok(to_regprocedure('public.app_submit_invoice_manual_payment_claim(uuid,uuid,uuid,text,text,bigint)') is not null,'authenticated claim boundary exists');

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000183'||n)::uuid,'authenticated','authenticated','manual-pay-'||n||'@example.invalid',now(),now() from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001831','manual-pay-a','Manual Pay A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001832','manual-pay-b','Manual Pay B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('d0000000-0000-4000-8000-000000001831','f0f0f0f0-0000-4000-8000-000000001831','Manual A','client'),
 ('d0000000-0000-4000-8000-000000001832','f0f0f0f0-0000-4000-8000-000000001831','Other A','client'),
 ('d0000000-0000-4000-8000-000000001833','f0f0f0f0-0000-4000-8000-000000001832','Foreign B','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.account_class,r.id,v.company::uuid from (values
 ('f0f0f0f0-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001831','internal','owner',null),
 ('f0f0f0f0-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001832','client','client','d0000000-0000-4000-8000-000000001831'),
 ('f0f0f0f0-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001833','client','client','d0000000-0000-4000-8000-000000001832'),
 ('f0f0f0f0-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001834','internal','staff',null),
 ('f0f0f0f0-0000-4000-8000-000000001832','20000000-0000-4000-8000-000000001835','client','client','d0000000-0000-4000-8000-000000001833'),
 ('f0f0f0f0-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001836','client','client','d0000000-0000-4000-8000-000000001831')
) v(tenant,profile,account_class,role_name,company) join public.roles r on r.name=v.role_name;
create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000001831') returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000183'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.clear_actor() returns void language sql as $$ select set_config('request.jwt.claim.sub','',true); select set_config('request.jwt.claims','',true); $$;
create temp table fixture(key text primary key,value jsonb);
grant all on fixture to authenticated,service_role;
create function pg_temp.invoice(n integer,company text default 'd0000000-0000-4000-8000-000000001831',tenant text default 'f0f0f0f0-0000-4000-8000-000000001831') returns uuid language plpgsql as $$
declare identifier uuid:=('d3000000-0000-4000-8000-00000000183'||n)::uuid;
begin
 perform pg_temp.clear_actor();
 insert into public.invoices(id,tenant_id,company_id,client_profile_id,status,currency,subtotal_cents,total_cents,created_by_profile_id,updated_by_profile_id)
 values(identifier,tenant::uuid,company::uuid,case when company='d0000000-0000-4000-8000-000000001831' then '20000000-0000-4000-8000-000000001832'::uuid else null end,'draft','USD',1000,1000,'20000000-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001831');
 insert into public.invoice_items(invoice_id,name,quantity,unit_price_cents,position,fulfillment_status) values(identifier,'Synthetic manual work',1,1000,0,'not_applicable');
 update public.invoices set status='unpaid',invoice_number=18300+n,issued_at=now() where id=identifier;
 return identifier;
end;
$$;
select pg_temp.invoice(n) from generate_series(1,8) n;
select pg_temp.invoice(9,'d0000000-0000-4000-8000-000000001832');
-- Seed a receipt as trusted fixture data; actual MIME sniff/upload is separately tested through REST/application.
create function pg_temp.ready_receipt(n integer,invoice_n integer default 1,client_n integer default 2) returns uuid language plpgsql as $$
declare identifier uuid:=('d4000000-0000-4000-8000-00000000'||lpad(n::text,4,'0'))::uuid;
begin
 perform pg_temp.clear_actor();
 insert into private.invoice_payment_receipts(id,tenant_id,invoice_id,uploader_profile_id,request_id,original_name,mime_type,size_bytes,checksum_sha256,object_key,verified_at)
 values(identifier,'f0f0f0f0-0000-4000-8000-000000001831',('d3000000-0000-4000-8000-00000000183'||invoice_n)::uuid,('20000000-0000-4000-8000-00000000183'||client_n)::uuid,identifier,'receipt.png','image/png',16,repeat('a',64),'synthetic/'||identifier,now());
 return identifier;
end;
$$;

select ok(not has_table_privilege('authenticated','private.invoice_manual_payment_claims','select'),'claims have no raw authenticated read');
select ok(not has_table_privilege('service_role','private.invoice_payment_receipts','select'),'receipt metadata has no raw service role read');
select ok(not has_function_privilege('anon','public.app_get_invoice_manual_payment(uuid)','execute'),'anonymous cannot read claims');
select ok(not has_function_privilege('authenticated','public.app_verify_invoice_payment_receipt(uuid,uuid,text)','execute'),'client cannot verify bytes');
select ok(has_function_privilege('service_role','public.app_verify_invoice_payment_receipt(uuid,uuid,text)','execute'),'trusted verifier only grant exists');
select ok(private.client_support_operation_allowed('/rest/v1/rpc/app_submit_invoice_manual_payment_claim','POST'),'delegated client claim explicitly allowed');
select ok(not private.client_support_operation_allowed('/rest/v1/rpc/app_review_invoice_manual_payment_claim','POST'),'delegation never allows review');
select ok(not private.client_support_operation_allowed('/rest/v1/rpc/app_verify_invoice_payment_receipt','POST'),'delegation never allows trusted verification');
select pg_temp.act(1); set local role authenticated;
select is(public.app_get_invoice_manual_payment_settings(),'{"enabled":false,"paypal_url":null,"instructions":""}'::jsonb,'settings start disabled');
select throws_ok($$select public.app_save_invoice_manual_payment_settings(true,'http://paypal.com/pay','Instructions')$$,'22023',null,'insecure URL rejected');
select throws_ok($$select public.app_save_invoice_manual_payment_settings(true,'https://evil.example/pay','Instructions')$$,'22023',null,'untrusted payment host rejected');
select lives_ok($$select public.app_save_invoice_manual_payment_settings(true,'https://www.paypal.com/paypalme/synthetic','Synthetic instructions')$$,'owner configures settings');
select pg_temp.act(2);
select throws_ok($$select public.app_get_invoice_manual_payment_settings()$$,'42501',null,'client cannot read config authority');
select is((public.app_get_invoice_manual_payment('d3000000-0000-4000-8000-000000001831')->>'can_report')::boolean,true,'owned collectible invoice can report');
select throws_ok($$select public.app_get_invoice_manual_payment('d3000000-0000-4000-8000-000000001839')$$,'42501',null,'foreign company invoice unavailable');
select throws_ok($$select public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001831',gen_random_uuid(),'evil.svg','image/svg+xml',16,repeat('a',64))$$,'22023',null,'active image type refused');
select throws_ok($$select public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001831',gen_random_uuid(),'huge.png','image/png',4194305,repeat('a',64))$$,'22023',null,'oversize refused');
insert into fixture values('reservation',public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001831','d5000000-0000-4000-8000-000000001831','receipt.png','image/png',16,repeat('a',64)));
select is(public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001831','d5000000-0000-4000-8000-000000001831','receipt.png','image/png',16,repeat('a',64)),(select value from fixture where key='reservation'),'upload reservation retry exact');
select throws_ok($$select public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001831','d5000000-0000-4000-8000-000000001831','changed.png','image/png',16,repeat('a',64))$$,'23505',null,'reservation conflict refused');
select throws_ok($$select public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001831',(select (value->>'id')::uuid from fixture where key='reservation'),'paypal',null,1000)$$,'55000',null,'unverified screenshot cannot report');
reset role;
select pg_temp.ready_receipt(1831); select pg_temp.ready_receipt(1832); select pg_temp.ready_receipt(1833,2);
select pg_temp.act(2); set local role authenticated;
select throws_ok($$select public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null)$$,'22023',null,'new claim without rendered balance guard is rejected');
select throws_ok($$select public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null,900)$$,'55000',null,'stale rendered balance is rejected rather than replaced with current balance');
insert into fixture values('claim',public.app_submit_invoice_manual_payment_claim('d6000000-0000-4000-8000-000000001831','d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null,1000));
select is((select value->>'status' from fixture where key='claim'),'pending','claim pending only');
select is((select (value->>'amount_cents')::bigint from fixture where key='claim'),1000::bigint,'full actual outstanding captured');
select is(public.app_submit_invoice_manual_payment_claim('d6000000-0000-4000-8000-000000001831','d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null,1000),(select value from fixture where key='claim'),'claim retry exact');
select throws_ok($$select public.app_submit_invoice_manual_payment_claim('d6000000-0000-4000-8000-000000001831','d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null,900)$$,'23505',null,'claim replay cannot change expected amount snapshot');
select throws_ok($$select public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001832','paypal',null,1000)$$,'55000',null,'second pending claim refused');
select throws_ok($$select public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001833','paypal',null,1000)$$,'55000',null,'receipt bound to exact invoice');
select pg_temp.act(6);
select throws_ok($$select public.app_get_invoice_payment_receipt('d4000000-0000-4000-8000-000000001831')$$,'42501',null,'same company colleague cannot read private proof');
select pg_temp.act(4);
select throws_ok($$select public.app_review_invoice_manual_payment_claim(gen_random_uuid(),(select (value->>'id')::uuid from fixture where key='claim'),'approve',now(),'recon-183','')$$,'42501',null,'staff without capability cannot approve');
reset role; select pg_temp.clear_actor();
select is((select status from public.invoices where id='d3000000-0000-4000-8000-000000001831'),'unpaid','report did not mutate invoice status');
select is((select count(*) from public.invoice_payments where invoice_id='d3000000-0000-4000-8000-000000001831'),0::bigint,'report created no ledger payment');
select is((select count(*) from public.notifications where event_key=(select 'invoice-manual-claim:'||(value->>'id') from fixture where key='claim') and recipient_profile_id='20000000-0000-4000-8000-000000001831'),1::bigint,'one internal reviewer alert despite retry');
select pg_temp.act(1); set local role authenticated;
select throws_ok($$select public.app_review_invoice_manual_payment_claim(gen_random_uuid(),(select (value->>'id')::uuid from fixture where key='claim'),'approve',now(),null,null)$$,'22023',null,'reviewer reconciliation reference mandatory');
insert into fixture values('review',public.app_review_invoice_manual_payment_claim('d7000000-0000-4000-8000-000000001831',(select (value->>'id')::uuid from fixture where key='claim'),'approve',date_trunc('second',now()),'recon-183',null));
select is((select value#>>'{claim,status}' from fixture where key='review'),'approved','authorized independent verification approves');
select is(public.app_review_invoice_manual_payment_claim('d7000000-0000-4000-8000-000000001831',(select (value->>'id')::uuid from fixture where key='claim'),'approve',date_trunc('second',now()),'recon-183',null),(select value from fixture where key='review'),'review idempotent');
select is((select jsonb_array_length(value->'order_ids') from fixture where key='review'),0,'nonservice line creates no order');
reset role; select pg_temp.clear_actor();
select is((select count(*) from public.invoice_payments where invoice_id='d3000000-0000-4000-8000-000000001831' and status='succeeded'),1::bigint,'only one succeeded payment');
select is((select status from public.invoices where id='d3000000-0000-4000-8000-000000001831'),'paid','approval settles invoice');
select ok((select paid_at is not null and payment_id is not null from private.invoice_manual_payment_claims where id=(select (value->>'id')::uuid from fixture where key='claim')),'actual paid date and immutable ledger relation recorded');
select pg_temp.act(2); set local role authenticated;
select throws_ok($$select public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001831','d5000000-0000-4000-8000-000000001831','receipt.png','image/png',16,repeat('a',64))$$,'55000',null,'old upload request cannot replay against a settled invoice');
select is(public.app_submit_invoice_manual_payment_claim('d6000000-0000-4000-8000-000000001831','d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null,1000)->>'status','approved','correct old claim request returns prior approval even when invoice now settled');
reset role; select pg_temp.clear_actor();
-- Stale balances: report 1000, real independent payment 1, approval must refuse 1000.
select pg_temp.act(2); set local role authenticated;
insert into fixture values('stale',public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001832','d4000000-0000-4000-8000-000000001833','bank_transfer','client optional',1000));
select pg_temp.act(1);
select public.app_record_invoice_payment(gen_random_uuid(),'d3000000-0000-4000-8000-000000001832',1,'succeeded','manual');
select throws_ok($$select public.app_review_invoice_manual_payment_claim(gen_random_uuid(),(select (value->>'id')::uuid from fixture where key='stale'),'approve',now(),'stale-183',null)$$,'55000',null,'changed balance requires reconciliation');
select throws_ok($$select public.app_review_invoice_manual_payment_claim(gen_random_uuid(),(select (value->>'id')::uuid from fixture where key='stale'),'reject',null,null,'')$$,'22023',null,'rejection requires explanation');
select lives_ok($$select public.app_review_invoice_manual_payment_claim(gen_random_uuid(),(select (value->>'id')::uuid from fixture where key='stale'),'reject',null,null,'Please reconcile partial transfer')$$,'stale claim can be rejected');
reset role; select pg_temp.clear_actor();
-- Trusted Storage verification is separate from authenticated reservations.
select pg_temp.act(2); set local role authenticated;
insert into fixture values('verify-reservation',public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001833',gen_random_uuid(),'proof.webp','image/webp',16,repeat('b',64)));
reset role; select pg_temp.clear_actor();
insert into storage.objects(bucket_id,name,metadata)
select 'invoice-payment-receipts',value->>'path',jsonb_build_object('size',16,'mimetype','image/webp') from fixture where key='verify-reservation';
set local role service_role;
select throws_ok($$select public.app_verify_invoice_payment_receipt((select (value->>'id')::uuid from fixture where key='verify-reservation'),'20000000-0000-4000-8000-000000001836',repeat('b',64))$$,'42501',null,'trusted verification still binds actual uploader');
select throws_ok($$select public.app_verify_invoice_payment_receipt((select (value->>'id')::uuid from fixture where key='verify-reservation'),'20000000-0000-4000-8000-000000001832',repeat('c',64))$$,'42501',null,'trusted verification binds actual checksum');
select lives_ok($$select public.app_verify_invoice_payment_receipt((select (value->>'id')::uuid from fixture where key='verify-reservation'),'20000000-0000-4000-8000-000000001832',repeat('b',64))$$,'trusted verifier confirms private exact upload');
reset role;
select pg_temp.act(2); set local role authenticated;
insert into fixture values('duplicate-reference',public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001833',(select (value->>'id')::uuid from fixture where key='verify-reservation'),'paypal',null,1000));
select pg_temp.act(1);
select throws_ok($$select public.app_review_invoice_manual_payment_claim(gen_random_uuid(),(select (value->>'id')::uuid from fixture where key='duplicate-reference'),'approve',now(),' RECON-183 ',null)$$,'23505',null,'same method normalized actual reference cannot credit another invoice');
reset role; select pg_temp.clear_actor();
-- An active company client loses replay/download access immediately on permission revocation.
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values('f0f0f0f0-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001832','invoices.view',false);
select pg_temp.act(2); set local role authenticated;
select throws_ok($$select public.app_get_invoice_manual_payment('d3000000-0000-4000-8000-000000001831')$$,'42501',null,'revoked invoice permission blocks claim history');
select throws_ok($$select public.app_get_invoice_payment_receipt('d4000000-0000-4000-8000-000000001831')$$,'42501',null,'revoked permission blocks receipt');
select throws_ok($$select public.app_submit_invoice_manual_payment_claim('d6000000-0000-4000-8000-000000001831','d3000000-0000-4000-8000-000000001831','d4000000-0000-4000-8000-000000001831','paypal',null,1000)$$,'42501',null,'successful old request does not bypass current permission');
reset role; select pg_temp.clear_actor();
delete from public.profile_permission_overrides where tenant_id='f0f0f0f0-0000-4000-8000-000000001831' and profile_id='20000000-0000-4000-8000-000000001832' and permission_key='invoices.view';
select pg_temp.act(5,'f0f0f0f0-0000-4000-8000-000000001832'); set local role authenticated;
select throws_ok($$select public.app_get_invoice_manual_payment('d3000000-0000-4000-8000-000000001831')$$,'42501',null,'foreign Tenant cannot read payment report');
reset role; select pg_temp.clear_actor();
-- Database counters cap orphan upload reservations and repeated rejected reports.
select pg_temp.ready_receipt(1840+n,4) from generate_series(1,6) n;
insert into private.invoice_manual_payment_claims(tenant_id,invoice_id,company_id,client_profile_id,request_id,receipt_id,amount_cents,currency,method,status,reviewed_at,reviewed_by_profile_id,review_reason)
select 'f0f0f0f0-0000-4000-8000-000000001831','d3000000-0000-4000-8000-000000001834','d0000000-0000-4000-8000-000000001831','20000000-0000-4000-8000-000000001832',gen_random_uuid(),('d4000000-0000-4000-8000-00000000'||(1840+n)::text)::uuid,1000,'USD','paypal','rejected',now(),'20000000-0000-4000-8000-000000001831','Synthetic rejected report'
from generate_series(1,5) n;
select pg_temp.ready_receipt(1850+n,5) from generate_series(1,10) n;
select pg_temp.act(2); set local role authenticated;
select throws_ok($$select public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001834','d4000000-0000-4000-8000-000000001846','paypal',null,1000)$$,'54000',null,'five lifetime claims cap enforced');
select throws_ok($$select public.app_prepare_invoice_payment_receipt('d3000000-0000-4000-8000-000000001835',gen_random_uuid(),'proof.png','image/png',16,repeat('a',64))$$,'54000',null,'ten receipt reservations cap enforced');
reset role; select pg_temp.clear_actor();
select pg_temp.ready_receipt(1861,6);
select pg_temp.act(1); set local role authenticated;
select public.app_record_invoice_payment(gen_random_uuid(),'d3000000-0000-4000-8000-000000001836',250,'succeeded','manual');
select pg_temp.act(2);
insert into fixture values('actual-balance',public.app_submit_invoice_manual_payment_claim(gen_random_uuid(),'d3000000-0000-4000-8000-000000001836','d4000000-0000-4000-8000-000000001861','bank_transfer',null,750));
select is((select (value->>'amount_cents')::bigint from fixture where key='actual-balance'),750::bigint,'actual outstanding subtracts only authoritative settled payments');
reset role; select pg_temp.clear_actor();
select ok(not has_function_privilege('authenticated','public.app_consume_server_cost_limit(uuid,text,uuid)','execute'),'authenticated callers cannot choose server cost actor');
set local role service_role;
select lives_ok($$select public.app_consume_server_cost_limit('20000000-0000-4000-8000-000000001832','invoice.receipt_upload',null)$$,'trusted receipt upload cost action supported');
select lives_ok($$select public.app_consume_server_cost_limit('20000000-0000-4000-8000-000000001832','invoice.receipt_download',null)$$,'trusted receipt download cost action supported');
reset role;
-- Direct private storage is never accessible using ordinary application roles.
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and (qual like '%invoice-payment-receipts%' or with_check like '%invoice-payment-receipts%')),'no direct authenticated receipt policy');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('private.invoice_manual_payment_settings'::regclass,'private.invoice_payment_receipts'::regclass,'private.invoice_manual_payment_claims'::regclass,'private.invoice_manual_payment_reviews'::regclass)),'private records force row security');
select * from finish();
rollback;
