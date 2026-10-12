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
select ('20000000-0000-4000-8000-00000000937'||n)::uuid,
'authenticated','authenticated','wl-coupons-137-pgtap-rollback-'||n||'@example.invalid',now(),now()
from generate_series(1,7) n;
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000009371','wl-coupons-137-pgtap-rollback-fixture','Invoice Rollback Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000009371','f0f0f0f0-0000-4000-8000-000000009371','Subscriptions Fixture Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000009371' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000009372' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000009371',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000009373','internal','owner',null),
('20000000-0000-4000-8000-000000009374','client','client','e7360000-0000-4000-8000-000000009371'),
('20000000-0000-4000-8000-000000009375','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values
('f0f0f0f0-0000-4000-8000-000000009371','20000000-0000-4000-8000-000000009375','investment_intent.view',true),
('f0f0f0f0-0000-4000-8000-000000009371','20000000-0000-4000-8000-000000009375','investment_intent.manage',false);
select private.grant_platform_admin('20000000-0000-4000-8000-000000009371','Subscriptions fixture publisher');
select private.grant_platform_admin('20000000-0000-4000-8000-000000009376','Subscriptions fixture without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000009376';
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
values
('e7360000-0000-4000-8000-000000009371','f0f0f0f0-0000-4000-8000-000000009371','Intent Purchasable',10,'USD',true,true,false,0),
('e7360000-0000-4000-8000-000000009372','f0f0f0f0-0000-4000-8000-000000009371','Intent Other',10,'USD',true,true,false,0);
update public.company_wallets set balance_cents=100000 where company_id='e7360000-0000-4000-8000-000000009371';
insert into public.wf_card_memberships(company_id,status,activated_at,purchase_price_cents,purchase_currency,purchase_reference)
values('e7360000-0000-4000-8000-000000009371','active',now(),25900,'USD','intent-fixture');

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000009371') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000937'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;



create temp table module_sets as select array_agg(module_key order by module_key) enabled,
array_agg(module_key order by module_key) filter(where module_key not in ('coupons')) disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
create function pg_temp.publish(keys text[],revision integer,tenant uuid default 'f0f0f0f0-0000-4000-8000-000000009371') returns integer language plpgsql as $$
begin perform pg_temp.act(1); return private.publish_tenant_modules(tenant,revision,keys,'Tickets rollback fixture'); end;
$$;

update public.services set subscription_eligible=true where tenant_id='f0f0f0f0-0000-4000-8000-000000009371';
create temp table fixture_ids(kind text primary key,id uuid,request_id uuid,payload jsonb);
grant all on fixture_ids to authenticated;
create function pg_temp.payload() returns jsonb language sql as $$
select jsonb_build_object('company_id','e7360000-0000-4000-8000-000000009371','client_profile_id','20000000-0000-4000-8000-000000009374',
'service_id','e7360000-0000-4000-8000-000000009371','plan_source','admin_invoice','billing_anchor',current_date,
'interval_unit','month','interval_count',1,'currency','USD','recurring_action','none','items',jsonb_build_array(jsonb_build_object(
'service_id','e7360000-0000-4000-8000-000000009371','name','Subscription history','quantity',1,'unit_amount_cents',1000,'unit_discount_cents',0,'is_taxable',false)));
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
insert into public.coupons(id,tenant_id,code,discount_type,recurring_duration)
values
('c1370000-0000-4000-8000-000000000001','f0f0f0f0-0000-4000-8000-000000009371','COUPONS137FOREVER','percentage','forever'),
('c1370000-0000-4000-8000-000000000002','f0f0f0f0-0000-4000-8000-000000009371','COUPONS137FIRST','percentage','first_payment');
insert into public.coupon_discount_rules(coupon_id,discount_value,applies_to_all,sort_order)
select id,10,true,0 from public.coupons where id in ('c1370000-0000-4000-8000-000000000001','c1370000-0000-4000-8000-000000000002');

select ok(private.published_module_set_valid((select disabled from module_sets)), 'Coupons OFF is a valid published set');
select is(pg_temp.publish((select enabled from module_sets),0),1,'publish Coupons ON');
create function pg_temp.plan_payload(coupon uuid) returns jsonb language sql as $$
select jsonb_set(pg_temp.payload(),'{items,0}',(pg_temp.payload()->'items'->0)||jsonb_build_object('coupon_id',coupon,'unit_discount_cents',100))
$$;
select pg_temp.act(3);
set local role authenticated;
insert into fixture_ids values('forever',null,gen_random_uuid(),pg_temp.plan_payload('c1370000-0000-4000-8000-000000000001'));
update fixture_ids set id=(public.app_create_subscription(request_id,payload)).id where kind='forever';
insert into fixture_ids values('first',null,gen_random_uuid(),pg_temp.plan_payload('c1370000-0000-4000-8000-000000000002')||jsonb_build_object('lead_days',90));
update fixture_ids set id=(public.app_create_subscription(request_id,payload)).id where kind='first';
reset role;
select pg_temp.act(4);
set local role authenticated;
create temp table purchase_receipt as select * from public.app_purchase_service_with_balance(
 'c1370000-0000-4000-8000-000000000010','e7360000-0000-4000-8000-000000009371','COUPONS137FOREVER');
reset role;
select is((select amount_cents from purchase_receipt),900::bigint,'authoritative Store discount is charged exactly');
select is((select discount_total_cents from public.invoices where id=(select invoice_id from purchase_receipt)),100::bigint,'issued Store discount is materialized');
select pg_temp.act(3);
create function pg_temp.invoice_payload() returns jsonb language sql as $$
select jsonb_build_object('company_id','e7360000-0000-4000-8000-000000009371','currency','USD','due_at',now()+interval '7 days','items',jsonb_build_array(jsonb_build_object(
 'service_id','e7360000-0000-4000-8000-000000009371','name','Historic discount','quantity',1,'unit_price_cents',1000,'unit_discount_cents',100,'is_taxable',false)))
$$;
set local role authenticated;
insert into fixture_ids values('old_invoice',null,gen_random_uuid(),pg_temp.invoice_payload());
update fixture_ids set id=(public.app_create_invoice(request_id,payload)).id where kind='old_invoice';
select public.app_issue_invoice((select id from fixture_ids where kind='old_invoice'));
insert into fixture_ids values('wallet_coupon',null,gen_random_uuid(),pg_temp.invoice_payload());
update fixture_ids set id=(public.app_create_invoice(request_id,payload)).id where kind='wallet_coupon';
select public.app_issue_invoice((select id from fixture_ids where kind='wallet_coupon'));
reset role;
select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select public.app_pay_invoice_with_wallet('c1370000-0000-4000-8000-000000000011',(select id from fixture_ids where kind='wallet_coupon'),'COUPONS137FOREVER')$$,'new Coupon wallet payment ON');
reset role;
select pg_temp.act(3);
insert into public.subscription_plan_versions
select (jsonb_populate_record(null::public.subscription_plan_versions,to_jsonb(p)||jsonb_build_object(
 'id','c1370000-0000-4000-8000-000000000030','version',2,'effective_from',current_date+80))).*
from public.subscription_plan_versions p where p.subscription_id=(select id from fixture_ids where kind='first');
insert into public.subscription_plan_items
select (jsonb_populate_record(null::public.subscription_plan_items,to_jsonb(i)||jsonb_build_object(
 'id',gen_random_uuid(),'plan_version_id','c1370000-0000-4000-8000-000000000030','position',n))).*
from public.subscription_plan_items i join public.subscription_plan_versions p on p.id=i.plan_version_id cross join generate_series(0,1) n
where p.subscription_id=(select id from fixture_ids where kind='first') and p.version=1;
update public.coupons set recurring_duration='first_payment',is_active=false,archived_at=now(),archived_by_profile_id=auth.uid()
where id='c1370000-0000-4000-8000-000000000001';
create temp table historic_money as select id,discount_total_cents,total_cents from public.invoices where tenant_id='f0f0f0f0-0000-4000-8000-000000009371';
create temp table historic_items as select i.* from public.subscription_plan_items i join public.subscription_plan_versions p on p.id=i.plan_version_id join fixture_ids f on f.id=p.subscription_id;
select is(pg_temp.publish((select disabled from module_sets),1),2,'Coupons OFF preserves active plans and unpaid invoices');
select is((select count(*) from historic_money m join public.invoices i on i.id=m.id where row(i.discount_total_cents,i.total_cents) is distinct from row(m.discount_total_cents,m.total_cents)),0::bigint,'OFF does not reprice invoices');
select is((select count(*) from historic_items h join public.subscription_plan_items i on i.id=h.id where to_jsonb(i)<>to_jsonb(h)),0::bigint,'OFF does not rewrite existing snapshots');

select pg_temp.act(3);
create temp table zero_effect as select pg_temp.business_hash() hash;
set local role authenticated;
select ok(not public.app_has_permission('coupons.manage'),'owner cannot bypass Coupon OFF');
select is((select count(*) from public.coupons),0::bigint,'Coupon catalog RLS hidden OFF');
select is((select count(*) from public.coupon_discount_rules),0::bigint,'Coupon rule RLS hidden OFF');
select is((select count(*) from public.coupon_redemptions),0::bigint,'Coupon redemption RLS hidden OFF');
select throws_ok($$select public.app_archive_coupon('c1370000-0000-4000-8000-000000000002')$$,'42501',null,'archive OFF denied');
select throws_ok($$select public.app_create_coupon(gen_random_uuid(),'{}')$$,'42501',null,'create OFF denied');
select throws_ok($$select public.app_update_coupon('c1370000-0000-4000-8000-000000000002','{}')$$,'42501',null,'update OFF denied');
select throws_ok($$select public.app_validate_coupon('COUPONS137FIRST','[]',10)$$,'42501',null,'validate OFF denied before quotas');
reset role;
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_quote_store_coupon('e7360000-0000-4000-8000-000000009371','COUPONS137FIRST')$$,'42501','WF_COUPONS_DISABLED','Store quote OFF explicit denial');
select throws_ok($$select public.app_quote_invoice_coupon((select id from fixture_ids where kind='old_invoice'),'COUPONS137FIRST')$$,'42501','WF_COUPONS_DISABLED','Invoice quote OFF explicit denial');
select throws_ok($$select public.app_purchase_service_with_balance(gen_random_uuid(),'e7360000-0000-4000-8000-000000009371','COUPONS137FIRST')$$,'42501','WF_COUPONS_DISABLED','stale Coupon purchase never charges full price');
select throws_ok($$select public.app_pay_invoice_with_wallet(gen_random_uuid(),(select id from fixture_ids where kind='old_invoice'),'COUPONS137FIRST')$$,'42501','WF_COUPONS_DISABLED','old invoice cannot acquire new Coupon OFF');
reset role;
select is(pg_temp.business_hash(),(select hash from zero_effect),'denials leave money requests quotas activity and fanout unchanged');

select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select public.app_purchase_service_with_balance('c1370000-0000-4000-8000-000000000010','e7360000-0000-4000-8000-000000009371','COUPONS137FOREVER')$$,'accepted Coupon purchase replays OFF');
select lives_ok($$select public.app_pay_invoice_with_wallet('c1370000-0000-4000-8000-000000000011',(select id from fixture_ids where kind='wallet_coupon'),'COUPONS137FOREVER')$$,'accepted Coupon wallet payment replays OFF');
reset role;
select is(pg_temp.business_hash(),(select hash from zero_effect),'accepted replay has no effects OFF');
select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select public.app_purchase_service_with_balance('c1370000-0000-4000-8000-000000000012','e7360000-0000-4000-8000-000000009371')$$,'ordinary no-Coupon Store purchase remains available');
select lives_ok($$select public.app_pay_invoice_with_wallet('c1370000-0000-4000-8000-000000000013',(select id from fixture_ids where kind='old_invoice'))$$,'already-discounted Invoice settles without new Coupon');
reset role;
select is((select amount_cents from public.invoice_payments where invoice_id=(select id from fixture_ids where kind='old_invoice')),900::bigint,'settlement charges saved discounted amount');

select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_update_subscription_terms('c1370000-0000-4000-8000-000000000020',(select id from fixture_ids where kind='forever'),
 (pg_temp.plan_payload(null)-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+40))$$,'unchanged historic UI terms carry OFF with archived live Coupon');
reset role;
select is((select coupon_recurring_duration from public.subscription_plan_items where plan_version_id=(select current_plan_version_id from public.subscriptions where id=(select id from fixture_ids where kind='forever'))),'forever','stored duration survives changed live Coupon');
select is((select coupon_id from public.subscription_plan_items where plan_version_id=(select current_plan_version_id from public.subscriptions where id=(select id from fixture_ids where kind='forever'))),'c1370000-0000-4000-8000-000000000001'::uuid,'historic ID remains attached');
set local role authenticated;
select throws_ok($$select public.app_update_subscription_terms(gen_random_uuid(),(select id from fixture_ids where kind='forever'),
 jsonb_set((pg_temp.plan_payload(null)-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+80),'{items,0,quantity}','2'))$$,'42501',null,'quantity cannot amplify carried benefit OFF');
select throws_ok($$select public.app_update_subscription_terms(gen_random_uuid(),(select id from fixture_ids where kind='forever'),
 jsonb_set((pg_temp.plan_payload(null)-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+80),'{items,0,unit_discount_cents}','0'))$$,'42501',null,'historic discount cannot disappear OFF');
select throws_ok($$select public.app_create_subscription(gen_random_uuid(),pg_temp.plan_payload('c1370000-0000-4000-8000-000000000002'))$$,'42501','WF_COUPONS_DISABLED','new Subscription Coupon attachment denied OFF');
select lives_ok($$select public.app_update_subscription_terms('c1370000-0000-4000-8000-000000000020',(select id from fixture_ids where kind='forever'),
 (pg_temp.plan_payload(null)-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+40))$$,'accepted unchanged terms replay remains available OFF');
select throws_ok($$select public.app_update_subscription_terms(gen_random_uuid(),(select id from fixture_ids where kind='forever'),
 jsonb_set((pg_temp.plan_payload(null)-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+80),'{currency}','"EUR"'))$$,'42501',null,'currency change cannot pass as historic carry');
select throws_ok($$select public.app_update_subscription_terms(gen_random_uuid(),(select id from fixture_ids where kind='forever'),
 jsonb_set((pg_temp.plan_payload(null)-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+80),'{items,0,unit_amount_cents}','2000'))$$,'42501',null,'price change cannot pass as historic carry');
select throws_ok($$select public.app_update_subscription_terms(gen_random_uuid(),(select id from fixture_ids where kind='forever'),
 jsonb_set((pg_temp.plan_payload('c1370000-0000-4000-8000-000000000002')-array['company_id','client_profile_id','service_id','plan_source','billing_anchor'])||jsonb_build_object('effective_from',current_date+80),'{items,0,unit_discount_cents}','100'))$$,'42501','WF_COUPONS_DISABLED','different Coupon ID cannot pass as historic carry');
reset role;
create temp table redemption_baseline as select count(*) count from public.coupon_redemptions;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_generate_subscription_cycle_invoice(gen_random_uuid(),(select c.id from public.subscription_cycles c join fixture_ids f on f.id=c.subscription_id where f.kind='first' and c.sequence=1))$$,'first-cycle snapshot invoices OFF');
reset role;
select is((select i.discount_total_cents from public.invoices i join public.subscription_cycles c on c.invoice_id=i.id join fixture_ids f on f.id=c.subscription_id where f.kind='first' and c.sequence=1),100::bigint,'sequence one keeps first-payment discount');
select is((select count(*) from public.coupon_redemptions),(select count from redemption_baseline),'carry and cycle issue create no redemptions');

select throws_ok($$update public.coupons set description='bypass' where id='c1370000-0000-4000-8000-000000000002'$$,'42501','WF_COUPONS_DISABLED','trusted root update denied OFF');
select throws_ok($$update public.coupon_discount_rules set discount_value=20 where coupon_id='c1370000-0000-4000-8000-000000000002'$$,'42501','WF_COUPONS_DISABLED','trusted rule update denied OFF');
select throws_ok($$delete from public.coupon_discount_rules where coupon_id='c1370000-0000-4000-8000-000000000002'$$,'42501','WF_COUPONS_DISABLED','trusted rule deletion denied OFF');
select throws_ok($$update public.subscriptions set current_plan_version_id=(select id from public.subscription_plan_versions p where p.subscription_id=public.subscriptions.id and version=1) where id=(select id from fixture_ids where kind='forever')$$,'42501',null,'trusted rewind cannot revive historic benefit');
select throws_ok($$update public.subscriptions set current_plan_version_id='c1370000-0000-4000-8000-000000000030' where id=(select id from fixture_ids where kind='first')$$,'42501',null,'Coupon terms staged ON cannot activate extra benefits OFF');
insert into public.subscription_plan_versions
select (jsonb_populate_record(null::public.subscription_plan_versions,to_jsonb(p)||jsonb_build_object(
 'id','c1370000-0000-4000-8000-000000000031','version',3,'effective_from',current_date+120))).*
from public.subscription_plan_versions p where p.id=(select current_plan_version_id from public.subscriptions where id=(select id from fixture_ids where kind='forever'));
select throws_ok($$update public.subscriptions set current_plan_version_id='c1370000-0000-4000-8000-000000000031' where id=(select id from fixture_ids where kind='forever')$$,'42501',null,'trusted empty terms cannot omit historic Coupon benefit');
select throws_ok($$insert into public.coupon_redemptions(coupon_id,tenant_id,customer_profile_id,company_id,request_id,currency,original_cart_subtotal,eligible_subtotal,discount_amount,resulting_cart_subtotal)
values('c1370000-0000-4000-8000-000000000002','f0f0f0f0-0000-4000-8000-000000009371','20000000-0000-4000-8000-000000009374','e7360000-0000-4000-8000-000000009371',gen_random_uuid(),'USD',10,10,1,9)$$,'42501','WF_COUPONS_DISABLED','trusted redemption insertion denied OFF');

select ok(not private.coupon_notification_visible(null,null,'coupon'),'legacy Coupon category without provable parent fails closed');
select ok(not private.coupon_notification_visible('coupon','c1370000-0000-4000-8000-000000000002','coupon'),'Coupon-specific notification hidden OFF');
select ok(private.coupon_notification_visible('invoice',(select invoice_id from purchase_receipt),'invoice'),'independent Invoice notification predicate unaffected');
select throws_ok($$truncate public.coupon_redemptions$$,'55000','Coupon history cannot be truncated','trusted truncate cannot reset single-use history');
select throws_ok($$truncate public.subscription_cycles cascade$$,'55000',null,'trusted truncate cannot reset first-cycle history');
select throws_ok($$update public.subscription_cycles set sequence=9 where subscription_id=(select id from fixture_ids where kind='first')$$,'55000','Coupon cycle identity is immutable','trusted cycle sequence cannot reset agreed duration');
select throws_ok($$update public.subscription_cycles set due_on=due_on+1,period_start=period_start+1 where subscription_id=(select id from fixture_ids where kind='first')$$,'55000','Coupon cycle identity is immutable','trusted cycle date cannot change snapshot eligibility');
select throws_ok($$delete from public.subscription_cycles where subscription_id=(select id from fixture_ids where kind='first')$$,'55000','Coupon cycle identity is immutable','trusted cycle deletion cannot reset first-cycle discount');
set local role authenticated;
select public.app_void_invoice((select invoice_id from public.subscription_cycles where subscription_id=(select id from fixture_ids where kind='first') and sequence=1));
reset role;
select private.schedule_subscription_cycle((select id from fixture_ids where kind='first'),
 (select current_plan_version_id from public.subscriptions where id=(select id from fixture_ids where kind='first')),2,
 (select period_end from public.subscription_cycles where subscription_id=(select id from fixture_ids where kind='first') and sequence=1),
 (select period_end+30 from public.subscription_cycles where subscription_id=(select id from fixture_ids where kind='first') and sequence=1));
set local role authenticated;
select lives_ok($$select public.app_generate_subscription_cycle_invoice(gen_random_uuid(),(select c.id from public.subscription_cycles c join fixture_ids f on f.id=c.subscription_id where f.kind='first' and c.sequence=2))$$,'second cycle can issue after voided unpaid first cycle');
reset role;
select is((select i.discount_total_cents from public.invoices i join public.subscription_cycles c on c.invoice_id=i.id join fixture_ids f on f.id=c.subscription_id where f.kind='first' and c.sequence=2),0::bigint,'voided unpaid first cycle does not extend first-payment benefit');
select is((select count(*) from public.coupon_redemptions),(select count from redemption_baseline),'later sequence issuance creates no new redemption');
select throws_ok($$select private.schedule_subscription_cycle((select id from fixture_ids where kind='first'),
 (select current_plan_version_id from public.subscriptions where id=(select id from fixture_ids where kind='first')),3,current_date,current_date+30)$$,'23514','Coupon billing periods must move forward','trusted next sequence cannot backdate into superseded or duplicate billing period');

create temp table preserved_after as select pg_temp.business_hash() hash;
select pg_temp.act(5);
set local role authenticated;
select throws_ok($$select public.app_validate_coupon('COUPONS137FIRST','[]',10)$$,'42501',null,'staff cannot validate OFF');
reset role;
select pg_temp.act(6);
set local role authenticated;
select throws_ok($$select public.app_validate_coupon('COUPONS137FIRST','[]',10)$$,'42501',null,'PA-only identity cannot use business Coupon OFF');
reset role;
set local role anon;
select throws_ok($$select public.app_validate_coupon('COUPONS137FIRST','[]',10)$$,'42501',null,'anonymous cannot use Coupons');
reset role;
select is(pg_temp.business_hash(),(select hash from preserved_after),'actor-denial matrix leaves all financial and fanout rows unchanged');

-- Combined integration: both module predicates must survive the ordered migration chain.
select pg_temp.act(1);
select lives_ok($$select pg_temp.publish((select array_remove(disabled,'forms') from module_sets),
  (select max(revision) from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000009371'))$$,
  'combined Forms OFF / Coupons OFF publishes without resetting obligations');
select pg_temp.act(3);
select ok(not private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000009373',
  'f0f0f0f0-0000-4000-8000-000000009371','forms.manage'),'Forms management remains denied in composed owner predicate');
select ok(not private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000009373',
  'f0f0f0f0-0000-4000-8000-000000009371','coupons.manage'),'Coupons management remains denied in composed owner predicate');
select ok(private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000009373',
  'f0f0f0f0-0000-4000-8000-000000009371','forms.submissions_view'),'Forms history permission survives both modules OFF');
select ok(private.published_module_set_valid(array['services']),'all eight optional modules may be OFF together');
select ok(not private.published_module_set_valid(array['forms','coupons']),'Forms and Coupons cannot remove required Services');
select ok(not private.published_module_set_valid(array['services','projects']),'composed publication retains Projects requires Tickets');
select ok(not private.published_module_set_valid(array['services','subscriptions']),'composed publication retains Subscriptions requires Invoices');
select ok(not private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000009376',
  'f0f0f0f0-0000-4000-8000-000000009371','forms.submissions_view'),'Platform Admin entitlement never grants Forms history membership');
create temp table combined_before as select pg_temp.business_hash() hash;
select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select * from public.app_purchase_service_with_balance(
  'c1370000-0000-4000-8000-000000000010','e7360000-0000-4000-8000-000000009371','COUPONS137FOREVER')$$,
  'accepted discounted Store receipt replays while Forms and Coupons are both OFF');
select lives_ok($$select * from public.app_pay_invoice_with_wallet(
  'c1370000-0000-4000-8000-000000000011',(select id from fixture_ids where kind='wallet_coupon'),'COUPONS137FOREVER')$$,
  'accepted wallet receipt replays while Forms and Coupons are both OFF');
select throws_ok($$select * from public.app_purchase_service_with_balance(gen_random_uuid(),
  'e7360000-0000-4000-8000-000000009371','COUPONS137FIRST')$$,'42501','WF_COUPONS_DISABLED',
  'both modules OFF cannot introduce a new Coupon benefit');
reset role;
select is(pg_temp.business_hash(),(select hash from combined_before),'combined replay and denial produce no financial or fanout effects');
select pg_temp.act(1);
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000009399',0,
  array['services'],'Missing Tenant')$$,'P0002','Tenant not found','post-wait publication writer preserves missing-Tenant contract');
select throws_ok($$insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason)
  values('f0f0f0f0-0000-4000-8000-000000009399',1,array['services'],auth.uid(),'Missing Tenant')$$,
  'P0002','Tenant not found','post-wait direct publication trigger preserves missing-Tenant contract');

select * from finish();
rollback;
