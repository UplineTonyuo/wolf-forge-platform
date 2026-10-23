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
select ('20000000-0000-4000-8000-00000000390'||n)::uuid,
'authenticated','authenticated','wl239-subscriptions-rollback-'||n||'@example.invalid',now(),now()
from generate_series(1,7) n;
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000003901','wl239-subscriptions-rollback-fixture','Subscriptions Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000003901','f0f0f0f0-0000-4000-8000-000000003901','Subscriptions Fixture Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003901' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003902' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000003901',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000003903','internal','owner',null),
('20000000-0000-4000-8000-000000003904','client','client','e7360000-0000-4000-8000-000000003901'),
('20000000-0000-4000-8000-000000003905','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values
('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003905','investment_intent.view',true),
('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003905','investment_intent.manage',false);
select private.grant_platform_admin('20000000-0000-4000-8000-000000003901','Subscriptions fixture publisher');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003906','Subscriptions fixture without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000003906';
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
values
('e7360000-0000-4000-8000-000000003901','f0f0f0f0-0000-4000-8000-000000003901','Intent Purchasable',10,'USD',true,true,false,0),
('e7360000-0000-4000-8000-000000003902','f0f0f0f0-0000-4000-8000-000000003901','Intent Other',10,'USD',true,true,false,0);
update public.company_wallets set balance_cents=100000 where company_id='e7360000-0000-4000-8000-000000003901';
insert into public.wf_card_memberships(company_id,status,activated_at,purchase_price_cents,purchase_currency,purchase_reference)
values('e7360000-0000-4000-8000-000000003901','active',now(),25900,'USD','intent-fixture');

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000003901') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000390'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;

create temp table module_sets as select array_agg(module_key order by module_key) enabled,
array_agg(module_key order by module_key) filter(where module_key <> 'subscriptions') disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
create function pg_temp.publish(keys text[],revision integer,tenant uuid default 'f0f0f0f0-0000-4000-8000-000000003901') returns integer language plpgsql as $$
begin perform pg_temp.act(1); return private.publish_tenant_modules(tenant,revision,keys,'Tickets rollback fixture'); end;
$$;

update public.services set subscription_eligible=true where tenant_id='f0f0f0f0-0000-4000-8000-000000003901';
create temp table fixture_ids(kind text primary key,id uuid,request_id uuid,payload jsonb);
grant all on fixture_ids to authenticated;
create function pg_temp.payload() returns jsonb language sql as $$
select jsonb_build_object('company_id','e7360000-0000-4000-8000-000000003901','client_profile_id','20000000-0000-4000-8000-000000003904',
'service_id','e7360000-0000-4000-8000-000000003901','plan_source','admin_invoice','billing_anchor',current_date,
'interval_unit','month','interval_count',1,'currency','USD','recurring_action','none','items',jsonb_build_array(jsonb_build_object(
'service_id','e7360000-0000-4000-8000-000000003901','name','Subscription history','quantity',1,'unit_amount_cents',1000,'unit_discount_cents',0,'is_taxable',false)));
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
set local role authenticated;
insert into fixture_ids values('subscription',null,gen_random_uuid(),pg_temp.payload());
update fixture_ids set id=(public.app_create_subscription(request_id,payload)).id;
select is((public.app_create_subscription(request_id,payload)).id,id,'no-publication exact replay') from fixture_ids;
reset role;
insert into public.notifications(recipient_profile_id,audience,category,title,body,href,entity_type,entity_id,event_key) select '20000000-0000-4000-8000-000000003903','internal','payment','Legacy own subscription','Historical record','/subscriptions','subscription',id,'wl239.legacy.nopub' from fixture_ids where kind='subscription';
set local role authenticated;
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl239.legacy.nopub'),1::bigint,'own NULL-tenant notification preserves no-publication compatibility');
reset role;
update public.companies set archived_at=now() where id='e7360000-0000-4000-8000-000000003901';
set local role authenticated;
select throws_ok($$select public.app_create_subscription(request_id,payload) from fixture_ids$$,'42501',null,'current Company visibility protects accepted replay');
reset role;
update public.companies set archived_at=null where id='e7360000-0000-4000-8000-000000003901';
select ok(private.published_module_set_valid((select disabled from module_sets)),'Subscriptions optional');
select ok(not private.published_module_set_valid((select array_remove(enabled,'invoices') from module_sets)),'Invoices remains mandatory and dependency');
select ok(not private.published_module_set_valid((select array_remove(enabled,'services') from module_sets)),'Services dependency remains');
select ok(not private.published_module_set_valid((select array_remove(enabled,'tickets') from module_sets)),'Projects Tickets dependency preserved');
select ok(not private.published_module_set_valid((select enabled||array['subscriptions'] from module_sets)),'duplicate rejected');
select ok(not private.published_module_set_valid(array['todo']),'Operations excluded');
select ok(not private.published_module_set_valid(null),'null rejected');
select throws_ok($$select pg_temp.publish((select disabled from module_sets),0)$$,'55000',null,'active blocks publication');
select pg_temp.act(1);
select throws_ok($$insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason) select 'f0f0f0f0-0000-4000-8000-000000003901',1,disabled,'20000000-0000-4000-8000-000000003901','direct insert' from module_sets$$,'55000',null,'direct publication trigger blocks obligations');
select pg_temp.act(3);
update public.subscriptions set status='past_due' where id=(select id from fixture_ids where kind='subscription');
select throws_ok($$select pg_temp.publish((select disabled from module_sets),0)$$,'55000',null,'past due blocks publication');
select pg_temp.act(3);
update public.subscriptions set status='active' where id=(select id from fixture_ids where kind='subscription');

select is((select count(*) from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000003901'),0::bigint,'rejected publication changes no history');
select pg_temp.act(3);
set local role authenticated;
insert into fixture_ids(kind,id,request_id,payload) select 'invoice',null,gen_random_uuid(),jsonb_build_object('cycle_id',c.id) from public.subscription_cycles c join fixture_ids f on f.id=c.subscription_id;
update fixture_ids set id=(public.app_generate_subscription_cycle_invoice(request_id,(payload->>'cycle_id')::uuid)).id where kind='invoice';
insert into fixture_ids(kind,id,request_id,payload) values('terms',null,gen_random_uuid(),pg_temp.terms());
update fixture_ids set id=(public.app_update_subscription_terms(request_id,(select id from fixture_ids where kind='subscription'),payload)).id where kind='terms';
select lives_ok($$select public.app_pause_subscription(id,null) from fixture_ids where kind='subscription'$$,'pause authorized');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),0)$$,'55000',null,'paused blocks publication');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_resume_subscription(id) from fixture_ids where kind='subscription'$$,'resume authorized');
select lives_ok($$select public.app_schedule_subscription_cancellation(id,'period end') from fixture_ids where kind='subscription'$$,'schedule authorized');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),0)$$,'55000',null,'pending cancellation blocks');
select pg_temp.act(3);
update public.subscriptions set archived_at=now() where id=(select id from fixture_ids where kind='subscription');
select throws_ok($$select pg_temp.publish((select disabled from module_sets),0)$$,'55000',null,'archived uncanceled blocks');
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_cancel_subscription(id,null) from fixture_ids where kind='subscription'$$,'P0002',null,'archived uncanceled has no automatic repair path');
reset role;
select pg_temp.act(3);
update public.subscriptions set archived_at=null where id=(select id from fixture_ids where kind='subscription');
set local role authenticated;
select lives_ok($$select public.app_cancel_subscription(id,'approved stop') from fixture_ids where kind='subscription'$$,'immediate cancellation preserves invoice');
reset role;

select pg_temp.act(3);
set local role authenticated;
insert into fixture_ids(kind,id,request_id,payload)
select kind,(public.app_create_subscription(gen_random_uuid(),pg_temp.payload())).id,null,null
from unnest(array['wallet_subscription','partial_subscription','failed_subscription','void_subscription','archive_subscription','archived_parent']) kind;
insert into fixture_ids(kind,id,request_id,payload)
select replace(f.kind,'subscription','invoice'),(public.app_generate_subscription_cycle_invoice(gen_random_uuid(),c.id)).id,null,null
from fixture_ids f join public.subscription_cycles c on c.subscription_id=f.id where f.kind like '%subscription' and f.kind<>'subscription';
select lives_ok(format('select public.app_cancel_subscription(%L,''historical fixture'')',id),'cancel financial fixture '||kind) from fixture_ids where kind not in('subscription','terms') and kind not like '%invoice';
reset role;
update public.subscriptions set archived_at=now() where id=(select id from fixture_ids where kind='archived_parent');
insert into public.subscription_events(subscription_id,event_type,actor_type,actor_profile_id,payload)
values((select id from fixture_ids where kind='subscription'),'created','system','20000000-0000-4000-8000-000000003907','{"test":"actor reference"}');
select is(pg_temp.publish((select disabled from module_sets),0),1,'canceled including archived allows publication');

create temp table refused_hash as select pg_temp.business_hash() value;grant select on refused_hash to authenticated;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'canceled history remains');
select lives_ok($$select public.app_reconcile_subscription_state(id) from fixture_ids where kind='subscription'$$,'canceled reconcile nongenerative');
select lives_ok($$select public.app_cancel_subscription(id,null) from fixture_ids where kind='subscription'$$,'cancellation remains idempotent');
select is((public.app_create_subscription(request_id,payload)).id,id,'OFF accepted creation replay remains authorized') from fixture_ids where kind='subscription';
select throws_ok($$select public.app_create_subscription(gen_random_uuid(),pg_temp.payload())$$,'42501',null,'new creation refused');
select throws_ok($$select public.app_create_subscription(request_id,payload||'{"currency":"PHP"}') from fixture_ids where kind='subscription'$$,'23505',null,'altered request refused');
select throws_ok($$select public.app_resume_subscription(id) from fixture_ids where kind='subscription'$$,'42501',null,'resume refused');
select throws_ok($$select public.app_remove_subscription_cancellation(id) from fixture_ids where kind='subscription'$$,'42501',null,'uncancel refused');
select throws_ok($$select public.app_pause_subscription(id,null) from fixture_ids where kind='subscription'$$,'42501',null,'new pause refused');
select throws_ok($$select public.app_generate_subscription_cycle_invoice(gen_random_uuid(),(payload->>'cycle_id')::uuid) from fixture_ids where kind='invoice'$$,'42501',null,'new generation refused');
select is((public.app_generate_subscription_cycle_invoice(request_id,(payload->>'cycle_id')::uuid)).id,id,'accepted generation replay') from fixture_ids where kind='invoice';
select is((select count(*) from public.app_list_due_subscription_work()),0::bigint,'OFF has no generative due work');
select is((public.app_update_subscription_terms(request_id,(select id from fixture_ids where kind='subscription'),payload)).id,id,'OFF exact accepted terms replay authorized') from fixture_ids where kind='terms';
select throws_ok($$select public.app_update_subscription_terms(gen_random_uuid(),id,pg_temp.terms()) from fixture_ids where kind='subscription'$$,'42501',null,'new obligation terms refused');
select throws_ok($$select public.app_restore_subscription_cycle((payload->>'cycle_id')::uuid) from fixture_ids where kind='invoice'$$,'42501',null,'cycle restoration refused OFF');
select is(pg_temp.business_hash(),(select value from refused_hash),'all refused operations and accepted replays leave business and quota state unchanged');
reset role;
update public.companies set archived_at=now() where id='e7360000-0000-4000-8000-000000003901';
set local role authenticated;
select throws_ok($$select public.app_create_subscription(request_id,payload) from fixture_ids where kind='subscription'$$,'42501',null,'OFF replay archived Company hidden');
select throws_ok($$select public.app_update_subscription_terms(request_id,(select id from fixture_ids where kind='subscription'),payload) from fixture_ids where kind='terms'$$,'42501',null,'OFF terms replay archived Company hidden');
select throws_ok($$select public.app_generate_subscription_cycle_invoice(request_id,(payload->>'cycle_id')::uuid) from fixture_ids where kind='invoice'$$,'42501',null,'OFF Invoice generation replay archived Company hidden');
select throws_ok($$select public.app_reconcile_subscription_state(id) from fixture_ids where kind='subscription'$$,'42501',null,'OFF reconciliation archived Company hidden');
select throws_ok($$select public.app_cancel_subscription(id,null) from fixture_ids where kind='subscription'$$,'42501',null,'OFF cancellation archived Company hidden');
reset role;
update public.companies set archived_at=null where id='e7360000-0000-4000-8000-000000003901';
set local role authenticated;

select lives_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,1000) from fixture_ids where kind='invoice'$$,'old canceled Invoice payment succeeds OFF');
select is((select status from public.invoices where id=(select id from fixture_ids where kind='invoice')),'paid','financial settlement persisted');
select is((select count(*) from public.subscription_cycles where subscription_id=(select id from fixture_ids where kind='subscription')),1::bigint,'old settlement generates no renewal');
select is((select status from public.subscription_cycles where subscription_id=(select id from fixture_ids where kind='subscription')),'paid','historical cycle bookkeeping completes');
select lives_ok($$select public.app_refund_invoice(gen_random_uuid(),id,1000,'ledger refund') from fixture_ids where kind='invoice'$$,'existing Invoice refund permissions unchanged');
reset role;
select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'client canceled history');
select throws_ok($$select public.app_cancel_subscription(id,null) from fixture_ids where kind='subscription'$$,'42501',null,'client cancellation not granted');
reset role;
select pg_temp.act(6);
set local role authenticated;
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'42501',null,'Platform Admin no business membership');
reset role;
select pg_temp.act(3);
select throws_ok($$update public.subscriptions set status='active' where id=(select id from fixture_ids where kind='subscription')$$,'42501',null,'owner direct reactivation refused');
select throws_ok($$select private.issue_subscription_cycle_invoice(auth.uid(),(payload->>'cycle_id')::uuid) from fixture_ids where kind='invoice'$$,'42501',null,'trusted issuer cannot bypass OFF');
select throws_ok($$select private.schedule_subscription_cycle(f.id,s.current_plan_version_id,2,current_date,current_date+30) from fixture_ids f join public.subscriptions s on s.id=f.id where f.kind='subscription'$$,'42501',null,'trusted scheduling refused');

select pg_temp.act(3);
update public.invoices set archived_at=now() where id=(select id from fixture_ids where kind='invoice');
set local role authenticated;
select throws_ok($$select public.app_generate_subscription_cycle_invoice(request_id,(payload->>'cycle_id')::uuid) from fixture_ids where kind='invoice'$$,'42501',null,'archived Invoice generation replay refused');
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='archived_parent'$$,'42501',null,'archived canceled parent remains hidden');
select lives_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,500) from fixture_ids where kind='partial_invoice'$$,'partial old payment OFF');
select lives_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,500) from fixture_ids where kind='partial_invoice'$$,'remaining old payment OFF');
select lives_ok($$select public.app_record_invoice_payment(gen_random_uuid(),id,500,'failed') from fixture_ids where kind='failed_invoice'$$,'failed old payment bookkeeping OFF');
select lives_ok($$select public.app_void_invoice(id) from fixture_ids where kind='void_invoice'$$,'void old invoice OFF');
select lives_ok($$select public.app_refund_invoice(gen_random_uuid(),id,500,'partial ledger refund') from fixture_ids where kind='partial_invoice'$$,'partial refund OFF');
reset role;
select pg_temp.act(4);
set local role authenticated;
update fixture_ids set request_id=gen_random_uuid() where kind='wallet_invoice';
select lives_ok($$select public.app_pay_invoice_with_wallet(request_id,id) from fixture_ids where kind='wallet_invoice'$$,'old wallet settlement OFF');
select lives_ok($$select public.app_pay_invoice_with_wallet(request_id,id) from fixture_ids where kind='wallet_invoice'$$,'wallet exact retry no second debit');
reset role;
select pg_temp.act(3);
select is((select balance_cents from public.company_wallets where company_id='e7360000-0000-4000-8000-000000003901'),99000::bigint,'wallet debited once');
update public.invoices set archived_at=now() where id=(select id from fixture_ids where kind='archive_invoice');
select is((select status from public.subscription_cycles where invoice_id=(select id from fixture_ids where kind='archive_invoice')),'voided','old invoice archive bookkeeping OFF');
select is((select count(*) from public.subscription_cycles c join fixture_ids f on f.id=c.subscription_id where f.kind in ('wallet_subscription','partial_subscription','failed_subscription','void_subscription','archive_subscription')),5::bigint,'all historical financial branches create no renewal');
select ok(not has_table_privilege('authenticated','public.subscriptions','INSERT'),'API insert grant stays revoked');
select ok(not has_function_privilege('authenticated','private.require_subscription_write(uuid)','EXECUTE'),'private write helper owner only');
select throws_ok($$insert into public.subscription_events(subscription_id,event_type,actor_type,payload) values((select id from fixture_ids where kind='subscription'),'resumed','system','{}')$$,'42501',null,'direct arbitrary event blocked');
select throws_ok($$update public.subscription_cycles set status='scheduled' where invoice_id=(select id from fixture_ids where kind='invoice')$$,'42501',null,'direct cycle reactivation blocked');
select throws_ok($$insert into public.subscription_payment_methods(subscription_id,provider,priority) values((select id from fixture_ids where kind='subscription'),'test',1)$$,'42501',null,'direct payment method creation blocked');
select throws_ok($$insert into public.subscription_dunning_attempts(cycle_id,attempt_number,scheduled_for) values((select (payload->>'cycle_id')::uuid from fixture_ids where kind='invoice'),1,now())$$,'42501',null,'direct dunning creation blocked');

select pg_temp.act(3);
select throws_ok($$insert into public.subscription_plan_versions select (jsonb_populate_record(null::public.subscription_plan_versions,to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'version',p.version+1))).* from public.subscription_plan_versions p where p.subscription_id=(select id from fixture_ids where kind='subscription')$$,'42501',null,'direct new plan denied');
select throws_ok($$insert into public.subscription_plan_items select (jsonb_populate_record(null::public.subscription_plan_items,to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'position',p.position+1))).* from public.subscription_plan_items p join public.subscription_plan_versions v on v.id=p.plan_version_id where v.subscription_id=(select id from fixture_ids where kind='subscription')$$,'42501',null,'direct new plan item denied');
select throws_ok($$delete from public.subscriptions where id=(select id from fixture_ids where kind='archived_parent')$$,'42501',null,'OFF parent deletion denied');
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$delete from auth.users where id='20000000-0000-4000-8000-000000003907'$$,'historical system actor FK nulling preserved');
select is((select actor_profile_id from public.subscription_events where payload='{"test":"actor reference"}'::jsonb),null::uuid,'FK changed only historical actor pointer');
select pg_temp.act(3);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003905','subscriptions.view',true),
('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003905','subscriptions.manage',false),
('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003905','subscriptions.billing',false);
select pg_temp.act(5);
set local role authenticated;
select lives_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'staff canceled history under view permission');
select throws_ok($$select public.app_create_subscription(gen_random_uuid(),pg_temp.payload())$$,'42501',null,'enabled permission engine not broadened for staff');
reset role;
select pg_temp.act(3);
update public.profile_permission_overrides set allowed=false where tenant_id='f0f0f0f0-0000-4000-8000-000000003901' and profile_id='20000000-0000-4000-8000-000000003905' and permission_key='subscriptions.view';
select pg_temp.act(5);
set local role authenticated;
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'42501',null,'history denied override retained');
select is((select count(*) from public.subscriptions),0::bigint,'direct parent RLS denied override');
select is((select count(*) from public.subscription_cycles),0::bigint,'direct cycles RLS denied override');
select is((select count(*) from public.subscription_events),0::bigint,'direct events RLS denied override');
reset role;
select pg_temp.act(3);
select is(public.app_subscriptions_work_enabled(),false,'work availability OFF while history allowed');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)select 'f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003902','internal',id from public.roles where name='manager';
select pg_temp.act(2);
set local role authenticated;
select lives_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'manager canceled history retained');
select is(public.app_subscriptions_work_enabled(),false,'manager sees OFF work availability');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)values('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003905','subscriptions.cancel',true),('f0f0f0f0-0000-4000-8000-000000003901','20000000-0000-4000-8000-000000003904','subscriptions.cancel',true);
select pg_temp.act(5);
set local role authenticated;
select is((public.app_cancel_subscription((select id from fixture_ids where kind='subscription'),null)).id,(select id from fixture_ids where kind='subscription'),'cancel-only internal role retains idempotent cancellation OFF');
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'42501',null,'cancel-only role gains no independent history reader');
reset role;
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_cancel_subscription(id,null) from fixture_ids where kind='subscription'$$,'42501',null,'client account class cannot cancel despite permission override');
reset role;
select pg_temp.act(3);

insert into public.notifications(recipient_profile_id,company_id,tenant_id,audience,category,title,body,href,entity_type,entity_id,event_key)
select '20000000-0000-4000-8000-000000003903','e7360000-0000-4000-8000-000000003901','f0f0f0f0-0000-4000-8000-000000003901','internal','payment','Synthetic subscription history','Synthetic history','/subscriptions/'||id,'subscription',id,'wl239-'||kind from fixture_ids where kind in('subscription','archived_parent');
insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
select '20000000-0000-4000-8000-000000003903','subscription',id,'subscription.canceled','Synthetic history','{}'::jsonb from fixture_ids where kind in('subscription','archived_parent');
insert into fixture_ids(kind,id) select 'hidden_notification',id from public.notifications where event_key='wl239-archived_parent';
set local role authenticated;
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'wl239-%'),1::bigint,'notification list reveals only authorized canceled history');
select is(public.app_mark_notification_read((select id from fixture_ids where kind='hidden_notification')),false,'hidden history cannot be marked');
select lives_ok($$select public.app_mark_all_notifications_read()$$,'mark all preserves hidden notifications');
select is((select count(*) from public.activity_events where entity_type='subscription' and entity_id=(select id from fixture_ids where kind='archived_parent')),0::bigint,'OFF activity archived parent hidden');
reset role;
select is((select read_at from public.notifications where event_key='wl239-archived_parent'),null::timestamptz,'mark all did not touch hidden history');
select lives_ok($$select private.schedule_next_subscription_cycle((select id from fixture_ids where kind='subscription'),(select (payload->>'cycle_id')::uuid from fixture_ids where kind='invoice'))$$,'trusted renewal treats canceled parent as a nongenerative no-op OFF');

select is(pg_temp.publish((select enabled from module_sets),1),2,'re-enable creates revision only');


select pg_temp.act(3);
select is((select status from public.subscriptions where id=(select id from fixture_ids where kind='subscription')),'canceled','reenable does not revive');
select ok(not private.published_module_set_valid(array['bogus','services','invoices','forms','coupons']),'unknown identifiers refused');
select ok(not private.published_module_set_valid(array['services','invoices','forms','coupons','']),'empty identifier refused');
select ok(private.published_module_set_valid(array['services','invoices','forms','coupons']),'only four remaining mandatory modules');
select is((select count(*) from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000003901'),2::bigint,'append only revisions preserved');
select throws_ok($$update private.tenant_module_publications set reason='rewrite' where tenant_id='f0f0f0f0-0000-4000-8000-000000003901'$$,'55000',null,'publication immutable');
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_create_subscription(request_id,payload) from fixture_ids where kind='subscription'$$,'42501',null,'client cannot replay internal creation');
reset role;
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000003903' and tenant_id='f0f0f0f0-0000-4000-8000-000000003901';
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_create_subscription(request_id,payload) from fixture_ids where kind='subscription'$$,'42501',null,'revoked membership cannot replay');
reset role;
update public.tenant_memberships set archived_at=null where profile_id='20000000-0000-4000-8000-000000003903' and tenant_id='f0f0f0f0-0000-4000-8000-000000003901';
select pg_temp.act(4,'f0f0f0f0-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'42501',null,'foreign Tenant cannot read parent');
reset role;
select is((select count(*) from preserved_qa p where not exists(select 1 from (
select 'profiles' kind,to_jsonb(t) data from public.profiles t union all select 'memberships',to_jsonb(t) from public.tenant_memberships t
union all select 'domains',to_jsonb(t) from public.tenant_domains t union all select 'drafts',to_jsonb(t) from private.tenant_white_label_drafts t
union all select 'publications',to_jsonb(t) from private.tenant_module_publications t union all select 'admins',to_jsonb(t) from private.platform_admins t
union all select 'audit',to_jsonb(t) from public.security_audit_events t) a where a.kind=p.kind and a.data=p.data)),0::bigint,'existing QA records remain byte identical');
insert into public.tenants(id,slug,display_name,status) values('f0f0f0f0-0000-4000-8000-000000003902','wl239-foreign','Foreign synthetic Tenant','active');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id) select 'f0f0f0f0-0000-4000-8000-000000003902','20000000-0000-4000-8000-000000003903','internal',id from public.roles where name='owner';
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000003902');
set local role authenticated;
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'42501',null,'authorized foreign Tenant owner denied');
reset role;
insert into public.companies(id,tenant_id,name,status) values('e7360000-0000-4000-8000-000000003902','f0f0f0f0-0000-4000-8000-000000003901','Foreign Company','client');
update public.tenant_memberships set company_id='e7360000-0000-4000-8000-000000003902' where profile_id='20000000-0000-4000-8000-000000003904' and tenant_id='f0f0f0f0-0000-4000-8000-000000003901';
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_get_subscription_detail(id) from fixture_ids where kind='subscription'$$,'42501',null,'changed Company client denied parent');
reset role;
update public.tenant_memberships set company_id='e7360000-0000-4000-8000-000000003901' where profile_id='20000000-0000-4000-8000-000000003904' and tenant_id='f0f0f0f0-0000-4000-8000-000000003901';
-- Invoices is still mandatory. Remove only that mandatory-set condition in a
-- transaction-local copy to exercise the additional dependency independently.
do $$declare d text;begin
  d:=pg_get_functiondef('private.published_module_set_valid(text[])'::regprocedure);
  d:=replace(d,'private.published_module_set_valid','pg_temp.validator_without_invoice_mandatory');
  d:=replace(d,'''tickets'', ''subscriptions'')','''tickets'', ''subscriptions'', ''invoices'')');
  execute d;
end$$;
select ok(not pg_temp.validator_without_invoice_mandatory(array['services','forms','coupons','subscriptions']),'Subscriptions Invoices dependency independently enforced');

select pg_temp.act(3);
select is(pg_temp.publish((select disabled from module_sets),2),3,'disable for legacy notification scope');
select pg_temp.act(3);
insert into fixture_ids(kind,id) values('legacy_notification',gen_random_uuid());
insert into public.notifications(id,recipient_profile_id,audience,entity_type,entity_id,event_key,title,body,tenant_id,category,href)
select f.id,'20000000-0000-4000-8000-000000003903','internal','subscription',s.id,'wl239.legacy.scope','Legacy subscription','Preserved history',null,'payment','/subscriptions' from fixture_ids f cross join fixture_ids s where f.kind='legacy_notification' and s.kind='subscription';
set local role authenticated;
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl239.legacy.scope'),1::bigint,'own canceled legacy notification remains visible OFF');
reset role;
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000003902');
set local role authenticated;
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl239.legacy.scope'),0::bigint,'foreign selected Tenant cannot disclose NULL-tenant subscription notification');
select is(public.app_mark_notification_read((select id from fixture_ids where kind='legacy_notification')),false,'foreign selected Tenant cannot mark legacy subscription notification');
reset role;
update public.notifications set read_at=null where id=(select id from fixture_ids where kind='legacy_notification');
set local role authenticated;
select public.app_mark_all_notifications_read();
reset role;
select is((select read_at from public.notifications where id=(select id from fixture_ids where kind='legacy_notification')),null::timestamptz,'foreign mark-all preserves hidden legacy notification');
select pg_temp.act(3);
select is(pg_temp.publish((select enabled from module_sets),3),4,'restore enabled for remaining role checks');
select pg_temp.act(3);
set local role authenticated;
select is((select count(*) from public.app_list_my_notifications(100) where event_key='wl239.legacy.scope'),1::bigint,'own enabled legacy notification remains visible');
reset role;

select pg_temp.act(2);set local role authenticated;
select is(public.app_subscriptions_work_enabled(),true,'enabled availability does not grant manager permissions');
select throws_ok($$select public.app_create_subscription(gen_random_uuid(),pg_temp.payload())$$,'42501',null,'enabled manager still lacks manage capability');
reset role;
select * from finish();
rollback;
