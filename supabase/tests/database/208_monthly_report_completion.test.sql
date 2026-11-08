begin;
select no_plan();

-- Isolated synthetic fixtures; never run against a customer database.
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000208'||n)::uuid,'authenticated','authenticated','report-gate-'||n||'@example.invalid',now(),now()
from generate_series(1,5) n;
update public.profiles p set role_id=r.id from (values
 ('20000000-0000-4000-8000-000000002081','owner'),
 ('20000000-0000-4000-8000-000000002082','manager'),
 ('20000000-0000-4000-8000-000000002083','staff'),
 ('20000000-0000-4000-8000-000000002085','admin')
) v(id,role_name) join public.roles r on r.name=v.role_name where p.id=v.id::uuid;
insert into public.profile_permission_overrides(profile_id,permission_key,allowed) values
 ('20000000-0000-4000-8000-000000002083','projects.view',true),
 ('20000000-0000-4000-8000-000000002083','projects.edit',true);
insert into public.companies(id,name) values
 ('d0208000-0000-4000-8000-000000000001','Reporting QA client'),
 ('d0208000-0000-4000-8000-000000000002','Another Reporting QA client'),
 ('d0208000-0000-4000-8000-000000000003','No owned Services');
insert into public.services(id,name) values('d1208000-0000-4000-8000-000000000001','GMB named ordinary Service');
insert into public.orders(id,company_id,service_id,title,status,started_at,assigned_to_profile_id)
select ('d3208000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=4 then 'd0208000-0000-4000-8000-000000000002'::uuid else 'd0208000-0000-4000-8000-000000000001'::uuid end,
 case when n=3 then 'd1208000-0000-4000-8000-000000000001'::uuid
   when n=5 then '5f000000-0000-4000-8000-000000000546'::uuid else '5f000000-0000-4000-8000-000000000318'::uuid end,
 'Report gate order '||n,'working',case when n=6 then '2026-11-01T00:00:00+08'::timestamptz else '2026-10-01T00:00:00+08'::timestamptz end,
 '20000000-0000-4000-8000-000000002083'
from generate_series(1,6) n;
insert into public.orders(company_id,service_id,title,status,archived_at) values
 ('d0208000-0000-4000-8000-000000000003','5f000000-0000-4000-8000-000000000318','Canceled purchase','canceled',null),
 ('d0208000-0000-4000-8000-000000000003','5f000000-0000-4000-8000-000000000318','Archived work','working',now());

create function pg_temp.act(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000208'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers','',true);
$$;

select ok(not has_table_privilege('authenticated','private.order_report_exceptions','INSERT')
 and not has_table_privilege('authenticated','private.order_report_exceptions','SELECT'), 'exception evidence is private');
select ok(not has_function_privilege('anon','public.app_complete_order_without_report(uuid,uuid,date,text)','EXECUTE'), 'anonymous exception execution denied');

select pg_temp.act(1);
set local role authenticated;
select is((select count(*) from public.app_list_reporting_service_options('d0208000-0000-4000-8000-000000000003',
 array['5f000000-0000-4000-8000-000000000318'::uuid])),0::bigint,'empty ownership has no catalogue fallback');
select is((select count(*) from public.app_list_reporting_service_options('d0208000-0000-4000-8000-000000000001',
 array['5f000000-0000-4000-8000-000000000318'::uuid]) where subscription_id is null),1::bigint,'in-progress order establishes ownership without a subscription');
select is((select count(*) from public.app_list_reporting_service_options('d0208000-0000-4000-8000-000000000001',
 array['d1208000-0000-4000-8000-000000000001'::uuid])),0::bigint,'name never creates a Reporting profile');
select throws_ok($$select public.app_create_report_draft(gen_random_uuid(),'{"company_id":"d0208000-0000-4000-8000-000000000003","service_id":"5f000000-0000-4000-8000-000000000318","report_lane":"gmb_management","package_label":"GMB","title":"Unowned","sections":[]}')$$,
 '42501',null,'forged unowned Service is denied by draft mutation');
select is((select status from public.app_create_report_draft('d4208000-0000-4000-8000-000000000001',
 '{"company_id":"d0208000-0000-4000-8000-000000000001","service_id":"5f000000-0000-4000-8000-000000000318","reporting_period_month":"2026-10-01","report_lane":"gmb_management","package_label":"GMB","title":"Owned draft","sections":[]}')),
 'draft','order-only owner can create a draft for the exact reporting month');
select is((select status from public.orders where id='d3208000-0000-4000-8000-000000000001'),'working','saving a draft never completes an order');
select throws_ok($$select public.app_change_order_status('d3208000-0000-4000-8000-000000000001','complete')$$,'WF431',null,'draft does not qualify');
reset role;

-- Wrong scopes all coexist; none can qualify for order 1. Sent timestamps are
-- deliberately in November even when the reporting month is October.
insert into public.client_reports(id,company_id,service_id,report_lane,package_label,title,sent_by_profile_id,status,sent_at,reporting_period_month,archived_at)
select ('d5208000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=1 then 'd0208000-0000-4000-8000-000000000002'::uuid else 'd0208000-0000-4000-8000-000000000001'::uuid end,
 case when n=2 then '5f000000-0000-4000-8000-000000000546'::uuid else '5f000000-0000-4000-8000-000000000318'::uuid end,
 'gmb_management','QA','Wrong scope '||n,'20000000-0000-4000-8000-000000002081','sent','2026-11-06T12:00:00Z',
 case when n=3 then '2026-11-01'::date else '2026-10-01'::date end,
 case when n=4 then now() else null end
from generate_series(1,4) n;
set local role authenticated;
select throws_ok($$select public.app_change_order_status('d3208000-0000-4000-8000-000000000001','complete')$$,'WF431',null,'wrong-client, wrong-Service, wrong-month and archived sent reports do not qualify');
select is((select status from public.app_change_order_status('d3208000-0000-4000-8000-000000000003','complete')),'complete','ordinary Service completes even when its name contains GMB');
reset role;
insert into public.client_reports(id,company_id,service_id,report_lane,package_label,title,sent_by_profile_id,status,sent_at,reporting_period_month)
values('d5208000-0000-4000-8000-000000000005','d0208000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318',
 'gmb_management','QA','Matching October report','20000000-0000-4000-8000-000000002081','sent','2026-11-06T12:00:00Z','2026-10-01');
set local role authenticated;
select is((select status from public.app_change_order_status('d3208000-0000-4000-8000-000000000001','complete')),'complete','matching reporting month qualifies despite a later publication timestamp');
reset role;
create temp table completion_before as select completed_at from public.orders where id='d3208000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.app_change_order_status('d3208000-0000-4000-8000-000000000001','complete')$$,'duplicate completion is safe');
reset role;
select is((select completed_at from public.orders where id='d3208000-0000-4000-8000-000000000001'),(select completed_at from completion_before),'retry preserves original completion time');
select is((select count(*) from public.activity_events where entity_id='d3208000-0000-4000-8000-000000000001' and action='order.status_changed'),1::bigint,'retry does not duplicate the status audit');

-- Remove matching evidence for remaining orders; historical completed order 1
-- is preserved. Manager has existing completion authority without broad PII access.
update public.client_reports set archived_at=now() where id in ('d5208000-0000-4000-8000-000000000003','d5208000-0000-4000-8000-000000000005');
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01',E' \n\t ')$$,'22023',null,'blank exception reason denied');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01',chr(11))$$,'22023',null,'vertical-tab-only reason denied');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01',U&'\00A0\2003\FEFF')$$,'22023',null,'Unicode whitespace-only reason denied');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01',repeat('x',1001))$$,'22023',null,'overlong exception reason denied');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000546','2026-10-01','Wrong Service')$$,'22023',null,'exception cannot change Service scope');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-11-01','Wrong month')$$,'22023',null,'exception cannot change month scope');
select is((select status from public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01','Client waived this month')),'complete','authorized Manager records the exception and completes atomically');
select lives_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01','Client waived this month')$$,'duplicate exception submission is safe');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01','Overwrite reason')$$,'23505',null,'retry cannot overwrite the recorded reason');
reset role;
select is((select count(*) from private.order_report_exceptions where order_id='d3208000-0000-4000-8000-000000000002'),1::bigint,'one immutable scoped exception');
select ok((select reason='Client waived this month' and actor_profile_id='20000000-0000-4000-8000-000000002082' and recorded_at is not null
 and company_id='d0208000-0000-4000-8000-000000000001' and reporting_period_month='2026-10-01' from private.order_report_exceptions
 where order_id='d3208000-0000-4000-8000-000000000002'),'exact client, Service, order, month, actor, time and reason persist');

-- Raw/multirow writes must fail even when bypassing the presentation and RPC.
select pg_temp.act(1);
select throws_ok($$update public.orders set started_at='2026-11-01T00:00:00+08' where id='d3208000-0000-4000-8000-000000000002'$$,'WF431',null,'an exception does not unlock a later month on the same order');
insert into public.orders(id,company_id,service_id,title,status,started_at)
values('d3208000-0000-4000-8000-000000000008','d0208000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','Another October order','working','2026-10-01T00:00:00+08');
select throws_ok($$update public.orders set status='complete',completed_at=now() where id='d3208000-0000-4000-8000-000000000008'$$,'WF431',null,'an exception does not unlock another order in the same month');
select throws_ok($$update public.orders set status='complete',completed_at=now() where id='d3208000-0000-4000-8000-000000000006'$$,'WF431',null,'exception does not unlock a future month/order via direct update');
select throws_ok($$update public.orders set status='complete',completed_at=now() where id in ('d3208000-0000-4000-8000-000000000005','d3208000-0000-4000-8000-000000000006')$$,'WF431',null,'multirow completion cannot bypass the gate');
select is((select status from public.orders where id='d3208000-0000-4000-8000-000000000006'),'working','failed completion leaves work unchanged');

select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000006','5f000000-0000-4000-8000-000000000318','2026-11-01','Staff waiver')$$,'42501',null,'Staff with Project edit cannot record an exception');
select pg_temp.act(4);
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000006','5f000000-0000-4000-8000-000000000318','2026-11-01','Client waiver')$$,'42501',null,'client cannot record an exception');
reset role;
select pg_temp.act(2);
select is((select status from public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000006','5f000000-0000-4000-8000-000000000318','2026-11-01','v')),'complete','a one-letter nonblank reason is preserved');
select is((select reason from private.order_report_exceptions where order_id='d3208000-0000-4000-8000-000000000006'),'v','SQL trim never removes letters');

-- Completed paid purchases remain owned even without a subscription. Create
-- the completion through the real gate, then add isolated billing provenance.
select pg_temp.act(1);
insert into public.orders(id,company_id,service_id,title,status,started_at)
values('d3208000-0000-4000-8000-000000000007','d0208000-0000-4000-8000-000000000003','5f000000-0000-4000-8000-000000000318','Historical paid GMB order','working','2026-10-01T00:00:00+08');
insert into public.client_reports(company_id,service_id,report_lane,package_label,title,sent_by_profile_id,status,sent_at,reporting_period_month)
values('d0208000-0000-4000-8000-000000000003','5f000000-0000-4000-8000-000000000318','gmb_management','QA','Historical paid report','20000000-0000-4000-8000-000000002081','sent',now(),'2026-10-01');
select public.app_change_order_status('d3208000-0000-4000-8000-000000000007','complete');
select is((select count(*) from public.app_list_reporting_service_options('d0208000-0000-4000-8000-000000000003',array['5f000000-0000-4000-8000-000000000318'::uuid])),0::bigint,'completed work alone is not current ownership');
select set_config('request.jwt.claim.sub','',true);
insert into public.invoices(id,company_id,status,invoice_number,issued_at,subtotal_cents,total_cents,created_by_profile_id,updated_by_profile_id)
values('d6208000-0000-4000-8000-000000000001','d0208000-0000-4000-8000-000000000003','paid',2089001,now(),100,100,'20000000-0000-4000-8000-000000002081','20000000-0000-4000-8000-000000002081');
insert into public.invoice_items(invoice_id,service_id,order_id,position,name,quantity,unit_price_cents,fulfillment_status)
values('d6208000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','d3208000-0000-4000-8000-000000000007',0,'Purchased GMB',1,100,'provisioned');
select pg_temp.act(1);
select is((select count(*) from public.app_list_reporting_service_options('d0208000-0000-4000-8000-000000000003',array['5f000000-0000-4000-8000-000000000318'::uuid]) where subscription_id is null),1::bigint,'completed paid purchase owns the Service without any subscription');

insert into public.orders(id,company_id,service_id,title,status,started_at)
select ('d3208000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d0208000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','September exception '||n,'working','2026-09-01T00:00:00+08'::timestamptz
from generate_series(9,10) n;
select is((select status from public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000009','5f000000-0000-4000-8000-000000000318','2026-09-01','Owner waiver')),'complete','Owner may record an exact-scoped exception');
select pg_temp.act(5);
select is((select status from public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000010','5f000000-0000-4000-8000-000000000318','2026-09-01','Admin waiver')),'complete','Admin with completion authority may record an exception');

insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values('f0f0f0f0-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000002082','projects.edit',false);
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01','Client waived this month')$$,'42501',null,'revoked authority is rechecked on an exact retry');
select throws_ok($$select public.app_change_order_status('d3208000-0000-4000-8000-000000000001','complete')$$,'42501',null,'revoked authority is rechecked on status retry');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.tenants(id,slug,display_name,status) values('f0f0f0f0-0000-4000-8000-000000002080','report-gate-other','Other Reporting QA Tenant','active');
insert into public.companies(id,tenant_id,name) values('d0208000-0000-4000-8000-000000000004','f0f0f0f0-0000-4000-8000-000000002080','Other Tenant client');
insert into public.services(id,tenant_id,name) values('d1208000-0000-4000-8000-000000000002','f0f0f0f0-0000-4000-8000-000000002080','Other Tenant Service');
insert into public.orders(id,tenant_id,company_id,service_id,title) values('d3208000-0000-4000-8000-000000000011','f0f0f0f0-0000-4000-8000-000000002080','d0208000-0000-4000-8000-000000000004','d1208000-0000-4000-8000-000000000002','Other Tenant order');
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_change_order_status('d3208000-0000-4000-8000-000000000011','complete')$$,'P0002',null,'Owner cannot complete another Tenant order by id');
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000011','d1208000-0000-4000-8000-000000000002','2026-10-01','Cross Tenant')$$,'P0002',null,'exception mutation cannot target another Tenant order');
reset role;
select pg_temp.act(2);
select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002080"}',true);
set local role authenticated;
select throws_ok($$select public.app_complete_order_without_report('d3208000-0000-4000-8000-000000000006','5f000000-0000-4000-8000-000000000318','2026-11-01','Cross Tenant')$$,'42501',null,'unavailable Tenant membership cannot execute');
reset role;
select * from finish();
rollback;
