begin;
select no_plan();

create temp table preserved_qa as
select 'profiles' kind,to_jsonb(t) data from public.profiles t
union all select 'memberships',to_jsonb(t) from public.tenant_memberships t
union all select 'domains',to_jsonb(t) from public.tenant_domains t
union all select 'drafts',to_jsonb(t) from private.tenant_white_label_drafts t
union all select 'publications',to_jsonb(t) from private.tenant_module_publications t
union all select 'admins',to_jsonb(t) from private.platform_admins t
union all select 'audit',to_jsonb(t) from public.security_audit_events t;

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000838'||n)::uuid,
'authenticated','authenticated','wl238-invoices-pgtap-rollback-'||n||'@example.invalid',now(),now()
from generate_series(1,7) n;
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000008381','wl238-invoices-pgtap-rollback-fixture','Invoice Rollback Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000008381','f0f0f0f0-0000-4000-8000-000000008381','Subscriptions Fixture Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000008381' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000008382' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000008381',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000008383','internal','owner',null),
('20000000-0000-4000-8000-000000008384','client','client','e7360000-0000-4000-8000-000000008381'),
('20000000-0000-4000-8000-000000008385','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values
('f0f0f0f0-0000-4000-8000-000000008381','20000000-0000-4000-8000-000000008385','investment_intent.view',true),
('f0f0f0f0-0000-4000-8000-000000008381','20000000-0000-4000-8000-000000008385','investment_intent.manage',false);
select private.grant_platform_admin('20000000-0000-4000-8000-000000008381','Subscriptions fixture publisher');
select private.grant_platform_admin('20000000-0000-4000-8000-000000008386','Subscriptions fixture without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000008386';
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
values
('e7360000-0000-4000-8000-000000008381','f0f0f0f0-0000-4000-8000-000000008381','Intent Purchasable',10,'USD',true,true,false,0),
('e7360000-0000-4000-8000-000000008382','f0f0f0f0-0000-4000-8000-000000008381','Intent Other',10,'USD',true,true,false,0);
update public.company_wallets set balance_cents=100000 where company_id='e7360000-0000-4000-8000-000000008381';
insert into public.wf_card_memberships(company_id,status,activated_at,purchase_price_cents,purchase_currency,purchase_reference)
values('e7360000-0000-4000-8000-000000008381','active',now(),25900,'USD','intent-fixture');

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000008381') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000838'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;

create temp table module_sets as select array_agg(module_key order by module_key) enabled,
array_agg(module_key order by module_key) filter(where module_key not in ('subscriptions','invoices','coupons')) disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
create function pg_temp.publish(keys text[],revision integer,tenant uuid default 'f0f0f0f0-0000-4000-8000-000000008381') returns integer language plpgsql as $$
begin perform pg_temp.act(1); return private.publish_tenant_modules(tenant,revision,keys,'Tickets rollback fixture'); end;
$$;

update public.services set subscription_eligible=true where tenant_id='f0f0f0f0-0000-4000-8000-000000008381';
create temp table fixture_ids(kind text primary key,id uuid,request_id uuid,payload jsonb);
grant all on fixture_ids to authenticated;
create function pg_temp.payload() returns jsonb language sql as $$
select jsonb_build_object('company_id','e7360000-0000-4000-8000-000000008381','client_profile_id','20000000-0000-4000-8000-000000008384',
'service_id','e7360000-0000-4000-8000-000000008381','plan_source','admin_invoice','billing_anchor',current_date,
'interval_unit','month','interval_count',1,'currency','USD','recurring_action','none','items',jsonb_build_array(jsonb_build_object(
'service_id','e7360000-0000-4000-8000-000000008381','name','Subscription history','quantity',1,'unit_amount_cents',1000,'unit_discount_cents',0,'is_taxable',false)));
$$;
create function pg_temp.terms() returns jsonb language sql as $$select pg_temp.payload()-array['company_id','client_profile_id','service_id','plan_source','billing_anchor']$$;
create function pg_temp.business_hash() returns text language sql security definer set search_path='' as $$
select md5(coalesce(jsonb_agg(jsonb_build_array(kind,data) order by kind,data::text),'[]'::jsonb)::text) from (
select 'subscriptions' kind,to_jsonb(t) data from public.subscriptions t union all select 'plans',to_jsonb(t) from public.subscription_plan_versions t
union all select 'items',to_jsonb(t) from public.subscription_plan_items t union all select 'cycles',to_jsonb(t) from public.subscription_cycles t
union all select 'events',to_jsonb(t) from public.subscription_events t union all select 'dunning',to_jsonb(t) from public.subscription_dunning_attempts t
union all select 'methods',to_jsonb(t) from public.subscription_payment_methods t union all select 'invoices',to_jsonb(t) from public.invoices t
union all select 'invoice_items',to_jsonb(t) from public.invoice_items t union all select 'payments',to_jsonb(t) from public.invoice_payments t
union all select 'refunds',to_jsonb(t) from public.invoice_refunds t union all select 'wallets',to_jsonb(t) from public.company_wallets t
union all select 'wallet_transactions',to_jsonb(t) from public.company_wallet_transactions t union all select 'notifications',to_jsonb(t) from public.notifications t
union all select 'activity',to_jsonb(t) from public.activity_events t union all select 'requests',to_jsonb(t) from private.app_create_requests t
union all select 'invoice_numbers',to_jsonb(t) from public.invoice_number_counters t
union all select 'quotas',to_jsonb(t) from private.rate_limit_counters t) rows;
$$;

select pg_temp.act(3);
create function pg_temp.invoice_payload() returns jsonb language sql as $$
select jsonb_build_object('company_id','e7360000-0000-4000-8000-000000008381','currency','USD','due_at',now()+interval '7 days','items',jsonb_build_array(jsonb_build_object('name','Financial evidence','quantity',1,'unit_price_cents',1000,'unit_discount_cents',0,'is_taxable',false)));
$$;
set local role authenticated;
insert into fixture_ids values('draft',null,gen_random_uuid(),pg_temp.invoice_payload());
update fixture_ids set id=(public.app_create_invoice(request_id,payload)).id where kind='draft';
select is((public.app_create_invoice(request_id,payload)).id,id,'no-publication creation exact replay') from fixture_ids where kind='draft';
insert into fixture_ids values('paid',null,gen_random_uuid(),pg_temp.invoice_payload());
update fixture_ids set id=(public.app_create_invoice(request_id,payload)).id where kind='paid';
select lives_ok($$select public.app_issue_invoice(id) from fixture_ids where kind='paid'$$,'normal issuance');
insert into fixture_ids values('payment',null,gen_random_uuid(),null);
update fixture_ids set id=(public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),1000)).id where kind='payment';
insert into fixture_ids values('refund',null,gen_random_uuid(),null);
update fixture_ids set id=(public.app_refund_invoice(request_id,(select id from fixture_ids where kind='paid'),250,'ledger only')).id where kind='refund';
select is((public.app_get_invoice_financials((select id from fixture_ids where kind='paid'))).balance_due_cents,0::bigint,'partial refund does not recreate collectible debt');
reset role;
select ok(private.published_module_set_valid((select disabled from module_sets)),'six optional modules: Invoice OFF supported');
select ok(not private.published_module_set_valid((select array_remove(enabled,'invoices') from module_sets)),'Subscriptions ON requires Invoices');
select ok(not private.published_module_set_valid((select array_remove(enabled,'services') from module_sets)),'Services mandatory');
select ok(private.published_module_set_valid((select array_remove(enabled,'forms') from module_sets)),'Forms independently optional');
select ok(private.published_module_set_valid((select array_remove(enabled,'coupons') from module_sets)),'Coupons independently optional');
select ok(not private.published_module_set_valid((select array_remove(enabled,'tickets') from module_sets)),'Projects still needs Tickets');
select ok(not private.published_module_set_valid((select enabled||array['invoices'] from module_sets)),'duplicates invalid');
select ok(not private.published_module_set_valid(array['todo']),'Operations excluded');
select is(pg_temp.publish((select enabled from module_sets),0),1,'publish ON');
select pg_temp.act(3);
set local role authenticated;
select is(public.app_invoices_work_enabled(),true,'Invoice work ON');
insert into fixture_ids values('open',null,gen_random_uuid(),pg_temp.invoice_payload());
update fixture_ids set id=(public.app_create_invoice(request_id,payload)).id where kind='open';
select lives_ok($$select public.app_issue_invoice(id) from fixture_ids where kind='open'$$,'open Invoice issued');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'unpaid blocks OFF');
select pg_temp.act(1);
select throws_ok($$insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason) select 'f0f0f0f0-0000-4000-8000-000000008381',2,disabled,'20000000-0000-4000-8000-000000008381','direct fixture' from module_sets$$,'55000',null,'direct publication blocks unpaid');
select pg_temp.act(3);
update public.invoices set archived_at=now() where id=(select id from fixture_ids where kind='open');
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'archived unpaid also blocks OFF');
select pg_temp.act(3);
update public.invoices set archived_at=null where id=(select id from fixture_ids where kind='open');
set local role authenticated;
select lives_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,250) from fixture_ids where kind='open'$$,'partial payment ON');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'partial collectible balance blocks OFF');
select pg_temp.act(3);set local role authenticated;
select lives_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,750) from fixture_ids where kind='open'$$,'resolve ordinary obligation by legitimate settlement');
reset role;
savepoint pending_payment;
insert into public.invoice_payments(invoice_id,amount_cents,currency,status,payment_method,request_id,created_by_profile_id)
select id,1000,'USD','pending','manual',gen_random_uuid(),'20000000-0000-4000-8000-000000008383' from fixture_ids where kind='paid';
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'pending payment blocks even paid parent');
rollback to pending_payment;
savepoint pending_refund;
select pg_temp.act(3);set local role authenticated;
select lives_ok($$select public.app_refund_invoice(gen_random_uuid(),id,100,'pending fixture',null,'pending') from fixture_ids where kind='paid'$$,'pending refund fixture ON');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'pending refund blocks OFF');
rollback to pending_refund;
select pg_temp.act(4);set local role authenticated;
insert into fixture_ids(kind,id,request_id) values('purchase',null,gen_random_uuid());
update fixture_ids set id=(select invoice_id from public.app_purchase_service_with_balance(request_id,'e7360000-0000-4000-8000-000000008381')) where kind='purchase';
select is((public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')).balance_cents,99000::bigint,'normal one-time purchase debits once');
reset role;
select pg_temp.act(3);set local role authenticated;
select lives_ok($$select public.app_refund_invoice(gen_random_uuid(),id,1000,'Ledger refund does not return wallet money') from fixture_ids where kind='purchase'$$,'wallet-backed refund is recorded only in ledger');
insert into fixture_ids values('wallet_invoice',null,gen_random_uuid(),pg_temp.invoice_payload());
update fixture_ids set id=(public.app_create_invoice(request_id,payload)).id where kind='wallet_invoice';
select lives_ok($$select public.app_issue_invoice(id) from fixture_ids where kind='wallet_invoice'$$,'wallet Invoice issued ON');
reset role;
select pg_temp.act(4);set local role authenticated;
select is((public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')).balance_cents,99000::bigint,'refund ledger creates no imaginary wallet credit');
select lives_ok($$select public.app_pay_invoice_with_wallet(request_id,id) from fixture_ids where kind='wallet_invoice'$$,'ordinary wallet Invoice payment ON');
reset role;
insert into public.notifications(recipient_profile_id,audience,category,title,body,href,entity_type,entity_id,event_key,tenant_id)
select '20000000-0000-4000-8000-000000008383','internal','payment','Invoice fixture history','Financial evidence','/invoices','invoice',id,'wl238-'||kind,null from fixture_ids where kind in ('paid','draft');
select is(pg_temp.publish((select disabled from module_sets),1),2,'OFF retains nonzero wallet and paid/refunded history');
select pg_temp.act(3);set local role authenticated;
select is(public.app_invoices_work_enabled(),false,'work OFF is authoritative');

-- Sidebar/client-detail acceptance extension: real existing fixture and policies.

create temp table nav_read_fingerprint as select pg_temp.business_hash() value;
grant select on nav_read_fingerprint to authenticated;
select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null
  and id in (select id from fixture_ids where kind in ('paid','purchase'))),2::bigint,
  'selected-company history includes manual-created and actual Store-purchase receipts OFF');
select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null
  and id=(select id from fixture_ids where kind='draft')),0::bigint,
  'selected-company predicate does not expose OFF drafts');
select is((select balance_due_cents from public.app_get_invoice_financials((select id from fixture_ids where kind='paid'))),0::bigint,
  'manual receipt uses authoritative financials under current read authority');
select is((select balance_due_cents from public.app_get_invoice_financials((select id from fixture_ids where kind='purchase'))),0::bigint,
  'Store receipt uses authoritative financials under current read authority');
select is(pg_temp.business_hash(),(select value from nav_read_fingerprint),
  'scoped history and financial reads have no business, wallet, request or quota side effect');

select is((select count(*) from public.invoices where id=(select id from fixture_ids where kind='paid')),1::bigint,'issued paid history remains');
select is((select count(*) from public.invoices where id=(select id from fixture_ids where kind='draft')),0::bigint,'draft is not history');
select is((select count(*) from public.invoice_items where invoice_id=(select id from fixture_ids where kind='draft')),0::bigint,'draft child items are not history');
select is((select count(*) from public.activity_events where entity_type='invoice' and entity_id=(select id from fixture_ids where kind='draft')),0::bigint,'private-admin shortcut cannot disclose draft financial activity');
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl238-paid'),1::bigint,'eligible legacy Invoice notification remains');
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl238-draft'),0::bigint,'draft financial notification hidden OFF');
select is(public.app_mark_notification_read((select id from public.app_list_my_notifications(100) where event_key='wl238-paid')),true,'eligible history notification can be marked');
select throws_ok($$select public.app_create_invoice(request_id,payload) from fixture_ids where kind='draft'$$,'42501',null,'draft accepted create cannot replay OFF');
create temp table replay_hash as select pg_temp.business_hash() value;
select is((public.app_create_invoice(request_id,payload)).id,id,'issued creation receipt exact replay OFF') from fixture_ids where kind='paid';
select is((public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),1000)).id,id,'accepted payment replay OFF') from fixture_ids where kind='payment';
select is((public.app_refund_invoice(request_id,(select id from fixture_ids where kind='paid'),250,'ledger only')).id,id,'accepted refund replay OFF') from fixture_ids where kind='refund';
select is(pg_temp.business_hash(),(select value from replay_hash),'accepted financial replay creates no new rows or side effects');
create temp table unchanged as select pg_temp.business_hash() value;
select throws_ok($$select public.app_create_invoice(gen_random_uuid(),pg_temp.invoice_payload())$$,'42501',null,'new creation OFF refused');
select throws_ok($$select public.app_issue_invoice(id) from fixture_ids where kind='draft'$$,'42501',null,'issuance OFF refused');
select throws_ok($$select public.app_update_invoice(id,'{"billing_reason":"changed"}') from fixture_ids where kind='paid'$$,'42501',null,'correction OFF refused');
select throws_ok($$select public.app_void_invoice(id) from fixture_ids where kind='paid'$$,'42501',null,'new void OFF refused');
select throws_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,1000) from fixture_ids where kind='paid'$$,'42501',null,'new payment OFF refused');
select throws_ok($$select public.app_refund_invoice(gen_random_uuid(),id,100,'new refund') from fixture_ids where kind='paid'$$,'42501',null,'new refund OFF refused');
select throws_ok($$select public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),999) from fixture_ids where kind='payment'$$,'23505','idempotency key was already used with different input','changed payment payload cannot replay');
select throws_ok($$select public.app_refund_invoice(request_id,(select id from fixture_ids where kind='paid'),251,'ledger only') from fixture_ids where kind='refund'$$,'23505','idempotency key was already used with different input','changed refund payload cannot replay');
select is(pg_temp.business_hash(),(select value from unchanged),'refused work changes no financial/business/quota state');
reset role;
select throws_ok($$update public.invoices set billing_reason='trusted bypass' where id=(select id from fixture_ids where kind='paid')$$,'42501',null,'trusted direct invoice update denied');
select throws_ok($$insert into public.invoice_payments(invoice_id,amount_cents,currency,status,payment_method,request_id) select id,100,'USD','succeeded','manual',gen_random_uuid() from fixture_ids where kind='paid'$$,'42501',null,'trusted direct payment denied');
select throws_ok($$insert into public.invoice_refunds(invoice_id,amount_cents,currency,status,reason,request_id) select id,100,'USD','succeeded','bypass',gen_random_uuid() from fixture_ids where kind='paid'$$,'42501',null,'trusted direct refund denied');
select throws_ok($$delete from public.invoices where id=(select id from fixture_ids where kind='draft')$$,'42501',null,'OFF draft preserved');
select pg_temp.act(4);set local role authenticated;
select lives_ok($$select public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')$$,'wallet read cannot be denied by Invoice OFF');
select is((public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')).balance_cents,98000::bigint,'client wallet stays visible OFF');
select lives_ok($$select public.app_list_my_wallet_history()$$,'wallet ledger read cannot be denied by Invoice OFF');
select is((select count(*) from public.app_list_my_wallet_history()),2::bigint,'client wallet history remains visible');
select is((select wallet_balance_cents from public.app_pay_invoice_with_wallet(request_id,id)),98000::bigint,'accepted wallet Invoice payment replay OFF') from fixture_ids where kind='wallet_invoice';
select is((select invoice_id from public.app_purchase_service_with_balance(request_id,'e7360000-0000-4000-8000-000000008381')),id,'accepted Store receipt OFF') from fixture_ids where kind='purchase';
select throws_ok($$select public.app_purchase_service_with_balance(gen_random_uuid(),'e7360000-0000-4000-8000-000000008381')$$,'42501',null,'new Store purchase OFF refused');
select throws_ok($$select public.app_pay_invoice_with_wallet(gen_random_uuid(),id) from fixture_ids where kind='paid'$$,'42501',null,'new wallet payment OFF refused');
select is((public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')).balance_cents,98000::bigint,'replay and denial never duplicate debit');
select throws_ok($$select order_id from public.invoice_items$$,'42501',null,'direct inaccessible Project pointer unavailable');
select is((select count(*) from public.app_list_invoice_items((select id from fixture_ids where kind='paid'))),1::bigint,'line-item financial evidence retained');
reset role;
select pg_temp.act(3);
savepoint independent_adjustment;
set local role authenticated;
select lives_ok($$select public.app_adjust_company_balance(gen_random_uuid(),'e7360000-0000-4000-8000-000000008381',25,'Independent synthetic adjustment')$$,'independent authorized wallet adjustment remains available OFF');
select is((public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')).balance_cents,98025::bigint,'independent adjustment has exact amount');
reset role;
rollback to independent_adjustment;
update public.orders set status='complete',completed_at=now() where id=(select order_id from public.invoice_items where invoice_id=(select id from fixture_ids where kind='purchase'));
select is(pg_temp.publish((select array_remove(disabled,'projects') from module_sets),2),3,'financial history survives separate Projects OFF');
select pg_temp.act(4);set local role authenticated;
select is((select order_id from public.app_purchase_service_with_balance(request_id,'e7360000-0000-4000-8000-000000008381')),null::uuid,'accepted purchase does not reveal inaccessible Project id') from fixture_ids where kind='purchase';
select is((select order_number from public.app_purchase_service_with_balance(request_id,'e7360000-0000-4000-8000-000000008381')),null::bigint,'accepted purchase does not reveal inaccessible Project number') from fixture_ids where kind='purchase';
select is((select order_id from public.app_list_invoice_items((select id from fixture_ids where kind='purchase'))),null::uuid,'receipt line item redacts inaccessible Project reference');
select is((select count(*) from public.app_list_invoice_items((select id from fixture_ids where kind='purchase'))),1::bigint,'redaction retains financial line item');
reset role;
select pg_temp.act(3);
update public.profile_permission_overrides set allowed=false where profile_id='20000000-0000-4000-8000-000000008384' and permission_key='invoices.view';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values('f0f0f0f0-0000-4000-8000-000000008381','20000000-0000-4000-8000-000000008384','invoices.view',false) on conflict(tenant_id,profile_id,permission_key) do update set allowed=false;
select pg_temp.act(4);set local role authenticated;
select throws_ok($$select public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')$$,'42501',null,'wallet visibility grants no denied permission');
select throws_ok($$select public.app_list_my_wallet_history()$$,'42501',null,'history respects denied permission');
select is((select count(*) from public.invoices),0::bigint,'OFF never grants Invoice view');

-- Sidebar/client-detail acceptance extension: real existing fixture and policies.

select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null),0::bigint,
  'previously visible company history disappears after current read revocation');
select throws_ok($$select public.app_get_invoice_financials(id) from fixture_ids where kind='paid'$$,
  '42501',null,'previously loaded financial receipt fails a fresh read after revocation');

reset role;
update public.profile_permission_overrides set allowed=true where profile_id='20000000-0000-4000-8000-000000008384' and permission_key='invoices.view';
select pg_temp.act(6);set local role authenticated;
select throws_ok($$select public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),1000) from fixture_ids where kind='payment'$$,'42501',null,'Platform Admin has no financial business authority');
reset role;
select pg_temp.act(3);
select is(pg_temp.publish((select enabled from module_sets),3),4,'re-enable does not repair or rewrite money');
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
select 'f0f0f0f0-0000-4000-8000-000000008381','20000000-0000-4000-8000-000000008385',k,false from unnest(array['invoices.manage','invoices.mark_paid','invoices.refund']) k;
select pg_temp.act(5);set local role authenticated;
select throws_ok($$select public.app_create_invoice(gen_random_uuid(),pg_temp.invoice_payload())$$,'42501',null,'enabled Invoices grants no denied management permission');
select throws_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,100) from fixture_ids where kind='paid'$$,'42501',null,'enabled Invoices grants no denied payment permission');
select throws_ok($$select public.app_refund_invoice(gen_random_uuid(),id,100,'unauthorized') from fixture_ids where kind='paid'$$,'42501',null,'enabled Invoices grants no denied refund permission');
reset role;
select pg_temp.act(3);
update public.companies set archived_at=now() where id='e7360000-0000-4000-8000-000000008381';
set local role authenticated;
select throws_ok($$select public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),1000) from fixture_ids where kind='payment'$$,'42501',null,'accepted payment requires current Company visibility');
select throws_ok($$select public.app_refund_invoice(request_id,(select id from fixture_ids where kind='paid'),250,'ledger only') from fixture_ids where kind='refund'$$,'42501',null,'accepted refund requires current Company visibility');

-- Sidebar/client-detail acceptance extension: real existing fixture and policies.

select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null),0::bigint,
  'current company archive hides scoped history');

reset role;
update public.companies set archived_at=null where id='e7360000-0000-4000-8000-000000008381';
update public.invoices set archived_at=now() where id=(select id from fixture_ids where kind='paid');
set local role authenticated;
select throws_ok($$select public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),1000) from fixture_ids where kind='payment'$$,'42501',null,'accepted payment requires current Invoice visibility');
select throws_ok($$select public.app_refund_invoice(request_id,(select id from fixture_ids where kind='paid'),250,'ledger only') from fixture_ids where kind='refund'$$,'42501',null,'accepted refund requires current Invoice visibility');
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl238-paid'),0::bigint,'archived financial notifications are hidden');

-- Sidebar/client-detail acceptance extension: real existing fixture and policies.

select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null
  and id=(select id from fixture_ids where kind='paid')),0::bigint,
  'current invoice archive hides scoped history');

reset role;
update public.invoices set archived_at=null where id=(select id from fixture_ids where kind='paid');
insert into public.tenants(id,slug,display_name,status) values('f0f0f0f0-0000-4000-8000-000000008382','wl238-invoices-foreign','Foreign Invoice Fixture','active');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id) select 'f0f0f0f0-0000-4000-8000-000000008382','20000000-0000-4000-8000-000000008383','internal',id from public.roles where name='owner';
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000008382');set local role authenticated;
select throws_ok($$select public.app_get_invoice_financials(id) from fixture_ids where kind='paid'$$,'42501',null,'authorized foreign Tenant cannot read financial history');

-- Sidebar/client-detail acceptance extension: real existing fixture and policies.

select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null),0::bigint,
  'selected company UUID does not bypass the current Tenant');

select throws_ok($$select public.app_record_invoice_payment(request_id,(select id from fixture_ids where kind='paid'),1000) from fixture_ids where kind='payment'$$,'P0002',null,'foreign Tenant cannot replay accepted payment');
select throws_ok($$select public.app_get_company_wallet('e7360000-0000-4000-8000-000000008381')$$,'42501',null,'foreign Tenant cannot see wallet');
reset role;
insert into public.companies(id,tenant_id,name,status) values('e7360000-0000-4000-8000-000000008382','f0f0f0f0-0000-4000-8000-000000008381','Other Invoice Client','client');
update public.tenant_memberships set company_id='e7360000-0000-4000-8000-000000008382' where tenant_id='f0f0f0f0-0000-4000-8000-000000008381' and profile_id='20000000-0000-4000-8000-000000008384';
select pg_temp.act(4);set local role authenticated;
select throws_ok($$select public.app_get_invoice_financials(id) from fixture_ids where kind='paid'$$,'42501',null,'changed Company cannot read financial history');

-- Sidebar/client-detail acceptance extension: real existing fixture and policies.

select is((select count(*) from public.invoices
  where company_id='e7360000-0000-4000-8000-000000008381' and archived_at is null),0::bigint,
  'changed client company cannot read another company via the scoped predicate');

select throws_ok($$select public.app_purchase_service_with_balance(request_id,'e7360000-0000-4000-8000-000000008381') from fixture_ids where kind='purchase'$$,'P0002',null,'changed Company cannot replay purchase');
select is((select count(*) from public.app_list_my_wallet_history()),0::bigint,'changed Company has no foreign wallet transactions');
reset role;
select pg_temp.act(3);
select throws_ok($$update private.tenant_module_publications set reason='rewrite' where tenant_id='f0f0f0f0-0000-4000-8000-000000008381'$$,'55000',null,'publication history immutable');

-- Additional fixture rows/overrides below exist only inside this savepoint/outer rollback.
-- They change no installed policy, role defaults, production grants or billing application code.
savepoint nav_history_matrix;
insert into public.invoices(id,tenant_id,company_id,created_by_profile_id,updated_by_profile_id)
values('5a000000-0000-4000-8000-000000009901','f0f0f0f0-0000-4000-8000-000000008381',
  'e7360000-0000-4000-8000-000000008382','20000000-0000-4000-8000-000000008383','20000000-0000-4000-8000-000000008383');
set local role authenticated;
select is((select count(*) from public.invoices where id='5a000000-0000-4000-8000-000000009901'),1::bigint,
  'same-Tenant other-company fixture exists for this internal owner');
select is((select count(*) from public.invoices where company_id='e7360000-0000-4000-8000-000000008381'
  and archived_at is null and id='5a000000-0000-4000-8000-000000009901'),0::bigint,
  'repository-equivalent company predicate excludes another visible company');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values('f0f0f0f0-0000-4000-8000-000000008381','20000000-0000-4000-8000-000000008385','invoices.view',false),
('f0f0f0f0-0000-4000-8000-000000008381','20000000-0000-4000-8000-000000008385','invoices.manage',true)
on conflict(tenant_id,profile_id,permission_key) do update set allowed=excluded.allowed;
select pg_temp.act(5); set local role authenticated;
select ok(not public.app_has_permission('invoices.view') and public.app_has_permission('invoices.manage'),
  'synthetic staff fixture is explicitly manage-only');
select is((select count(*) from public.invoices where company_id='e7360000-0000-4000-8000-000000008381'
  and archived_at is null and id=(select id from fixture_ids where kind='paid')),1::bigint,
  'manage-only retains existing internal invoice history authority');
select lives_ok($$select public.app_get_invoice_financials(id) from fixture_ids where kind='paid'$$,
  'manage-only can read the exact scoped receipt financials');
reset role;
update public.profile_permission_overrides set allowed=(permission_key='invoices.view')
where tenant_id='f0f0f0f0-0000-4000-8000-000000008381' and profile_id='20000000-0000-4000-8000-000000008385'
  and permission_key in ('invoices.view','invoices.manage');
set local role authenticated;
select ok(public.app_has_permission('invoices.view') and not public.app_has_permission('invoices.manage'),
  'synthetic staff fixture is explicitly view-only');
select is((select count(*) from public.invoices where company_id='e7360000-0000-4000-8000-000000008381'
  and archived_at is null and id=(select id from fixture_ids where kind='paid')),1::bigint,
  'view-only retains existing internal invoice history authority');
reset role;
update public.profile_permission_overrides set allowed=false
where tenant_id='f0f0f0f0-0000-4000-8000-000000008381' and profile_id='20000000-0000-4000-8000-000000008385'
  and permission_key in ('invoices.view','invoices.manage');
set local role authenticated;
select is((select count(*) from public.invoices where company_id='e7360000-0000-4000-8000-000000008381'
  and archived_at is null),0::bigint,'revoking both internal read capabilities hides the same scoped history');
select throws_ok($$select public.app_get_invoice_financials(id) from fixture_ids where kind='paid'$$,
  '42501',null,'revoking both internal capabilities refuses a fresh financial read');
reset role;
rollback to nav_history_matrix;

select * from finish();
rollback;
