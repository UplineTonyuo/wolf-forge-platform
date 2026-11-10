begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000209'||n)::uuid,'authenticated','authenticated','work-month-'||n||'@example.invalid',now(),now()
from generate_series(1,2) n;
update public.profiles p set role_id=r.id from (values
 ('20000000-0000-4000-8000-000000002091','owner'),
 ('20000000-0000-4000-8000-000000002092','manager')
) v(id,role_name) join public.roles r on r.name=v.role_name where p.id=v.id::uuid;
insert into public.companies(id,name) values('d0209000-0000-4000-8000-000000000001','Explicit work month QA');
insert into public.orders(id,company_id,service_id,title,status,started_at,created_at)
select ('d3209000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d0209000-0000-4000-8000-000000000001',
 '5f000000-0000-4000-8000-000000000318','October-started order '||n,'working','2026-10-15T00:00:00+08','2026-10-01T00:00:00+08'
from generate_series(1,4) n;
insert into public.tenants(id,slug,display_name,status) values('f0f0f0f0-0000-4000-8000-000000002090','work-month-other','Other work month QA Tenant','active');
insert into public.companies(id,tenant_id,name) values('d0209000-0000-4000-8000-000000000002','f0f0f0f0-0000-4000-8000-000000002090','Other Tenant client');
insert into public.services(id,tenant_id,name) values('d1209000-0000-4000-8000-000000000001','f0f0f0f0-0000-4000-8000-000000002090','Other Tenant Service');
insert into public.orders(id,tenant_id,company_id,service_id,title) values('d3209000-0000-4000-8000-000000000005','f0f0f0f0-0000-4000-8000-000000002090','d0209000-0000-4000-8000-000000000002','d1209000-0000-4000-8000-000000000001','Other Tenant order');
create function pg_temp.act(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000209'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers','',true);
$$;

select is((select private.order_reporting_month(o) from public.orders o where id='d3209000-0000-4000-8000-000000000001'),null::date,'start/create dates never supply a work month');
select ok(not has_function_privilege('anon','public.app_set_order_reporting_month(uuid,uuid,date)','EXECUTE')
 and not has_function_privilege('anon','public.app_complete_order_for_reporting_month(uuid,uuid,date)','EXECUTE'),'new RPCs are authenticated-only');
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000005','d1209000-0000-4000-8000-000000000001','2026-11-01')$$,'P0002',null,'cross-Tenant month selection is denied');
select throws_ok($$select public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000005','d1209000-0000-4000-8000-000000000001','2026-11-01')$$,'P0002',null,'cross-Tenant scoped completion is denied');
select throws_ok($$select public.app_change_order_status('d3209000-0000-4000-8000-000000000001','complete')$$,'WF431',null,'unset month cannot complete');
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318',null)$$,'22023',null,'month selection cannot default to today');
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-11-02')$$,'22023',null,'work month uses first-of-month convention');
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','infinity')$$,'22023',null,'unbounded periods cannot enter work-month scope');
select is((select status from public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-11-01')),'working','selecting November alone never completes an order');
select lives_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-11-01')$$,'duplicate selection is safe');
select throws_ok($$select public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-10-01')$$,'22023',null,'stale October completion scope cannot complete November work');
select throws_ok($$select public.app_complete_order_without_report('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-10-01','October waiver')$$,'22023',null,'October exception does not qualify for November work');
reset role;
select is((select reporting_period_month from public.orders where id='d3209000-0000-4000-8000-000000000001'),'2026-11-01'::date,'explicit November work period persists');
select is((select count(*) from public.activity_events where entity_id='d3209000-0000-4000-8000-000000000001' and action='order.reporting_period_changed'),1::bigint,'same-month retry does not duplicate selection audit');
insert into public.client_reports(company_id,service_id,report_lane,package_label,title,sent_by_profile_id,status,sent_at,reporting_period_month)
values('d0209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','gmb_management','QA','October report','20000000-0000-4000-8000-000000002091','sent',now(),'2026-10-01');
set local role authenticated;
select throws_ok($$select public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-11-01')$$,'WF431',null,'October report cannot complete an October-started order covering November');
select pg_temp.act(2);
select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01');
select public.app_complete_order_without_report('d3209000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-10-01','October exception');
select public.app_change_order_status('d3209000-0000-4000-8000-000000000002','working');
select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-11-01');
select throws_ok($$select public.app_change_order_status('d3209000-0000-4000-8000-000000000002','complete')$$,'WF431',null,'persisted October exception cannot unlock November work');
select is((select status from public.app_complete_order_without_report('d3209000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-11-01','November exception')),'complete','Manager November exception qualifies for November work');
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-12-01')$$,'23505',null,'completed November work cannot be silently reassigned to December');
reset role;
select is((select count(*) from private.order_report_exceptions where order_id='d3209000-0000-4000-8000-000000000002'),2::bigint,'old exception history is preserved with separate month scope');

select pg_temp.act(1);
select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000004','5f000000-0000-4000-8000-000000000318','2026-11-01');
select throws_ok($$update public.orders set status='complete' where id='d3209000-0000-4000-8000-000000000004'$$,'WF431',null,'direct mutation rejects October evidence for November work');
select throws_ok($$update public.orders set status='complete' where id in ('d3209000-0000-4000-8000-000000000003','d3209000-0000-4000-8000-000000000004')$$,'WF431',null,'multirow mutation cannot infer or substitute a month');
insert into public.client_reports(company_id,service_id,report_lane,package_label,title,sent_by_profile_id,status,sent_at,reporting_period_month)
values('d0209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','gmb_management','QA','November report published in December','20000000-0000-4000-8000-000000002091','sent','2026-12-10T12:00:00Z','2026-11-01');
-- Delayed completion dates never replace the work period, including on retries.
update public.orders set created_at='2026-12-01T00:00:00Z',started_at='2026-10-15T00:00:00Z' where id='d3209000-0000-4000-8000-000000000001';
select is((select private.order_reporting_month(o) from public.orders o where id='d3209000-0000-4000-8000-000000000001'),'2026-11-01'::date,'December creation/October start still resolve the explicitly stored November period');
set local role authenticated;
select throws_ok($$select public.app_change_order_status('d3209000-0000-4000-8000-000000000003','complete')$$,'WF431',null,'even a matching published report cannot substitute for an unset work month');
select is((select status from public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-11-01')),'complete','November report qualifies regardless of start/create/publication month');
select lives_ok($$select public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-11-01')$$,'matching completion retry is safe');
select throws_ok($$select public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000001','5f000000-0000-4000-8000-000000000318','2026-12-01')$$,'22023',null,'a December retry still requires November scope');
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000099','5f000000-0000-4000-8000-000000000318','2026-11-01')$$,'P0002',null,'unavailable order selection fails closed');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values('f0f0f0f0-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000002092','projects.edit',false);
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.app_set_order_reporting_month('d3209000-0000-4000-8000-000000000004','5f000000-0000-4000-8000-000000000318','2026-11-01')$$,'42501',null,'revoked Manager cannot replay a month selection');
select throws_ok($$select public.app_complete_order_for_reporting_month('d3209000-0000-4000-8000-000000000002','5f000000-0000-4000-8000-000000000318','2026-11-01')$$,'42501',null,'revoked Manager cannot replay scoped completion');
reset role;
select * from finish();
rollback;
