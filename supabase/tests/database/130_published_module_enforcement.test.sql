begin;
select no_plan();
create temp table preserved_drafts as select * from private.tenant_white_label_drafts;
create temp table preserved_qa as
select 'profiles' as kind, to_jsonb(t) as data from public.profiles t
union all select 'memberships', to_jsonb(t) from public.tenant_memberships t
union all select 'hosts', to_jsonb(t) from public.tenant_domains t
union all select 'audit', to_jsonb(t) from public.security_audit_events t;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000340'||n)::uuid,
'authenticated','authenticated','wl234-'||n||'@example.invalid',now(),now()
from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status)
values ('f0f0f0f0-0000-4000-8000-000000003401','wl234-fixture','WL234 Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values ('e7340000-0000-4000-8000-000000003400','f0f0f0f0-0000-4000-8000-000000003401','WL234 Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003401' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003402' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000003401',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000003403','internal','owner',null),
('20000000-0000-4000-8000-000000003404','client','client','e7340000-0000-4000-8000-000000003400'),
('20000000-0000-4000-8000-000000003405','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
select private.grant_platform_admin('20000000-0000-4000-8000-000000003401','WL234 test admin');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003406','WL234 admin without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000003406';
insert into public.client_reports(id,tenant_id,company_id,report_lane,package_label,title,sent_by_profile_id,status,sent_at)
values ('e7340000-0000-4000-8000-000000003401','f0f0f0f0-0000-4000-8000-000000003401','e7340000-0000-4000-8000-000000003400','seo_package','QA','Draft','20000000-0000-4000-8000-000000003403','draft',null),
('e7340000-0000-4000-8000-000000003402','f0f0f0f0-0000-4000-8000-000000003401','e7340000-0000-4000-8000-000000003400','seo_package','QA','Sent','20000000-0000-4000-8000-000000003403','sent',now());
insert into public.client_report_sections(id,report_id,section_key,title,sort_order)
values ('e7340000-0000-4000-8000-000000003403','e7340000-0000-4000-8000-000000003402','summary','QA summary',0);
insert into public.client_report_entries(id,section_id,label,value,sort_order)
values ('e7340000-0000-4000-8000-000000003404','e7340000-0000-4000-8000-000000003403','QA','Historical',0);
insert into public.client_report_reads(report_id,profile_id) values ('e7340000-0000-4000-8000-000000003402','20000000-0000-4000-8000-000000003404');
insert into public.activity_events(entity_type,entity_id,action,summary,actor_profile_id)
values ('client_report','e7340000-0000-4000-8000-000000003402','client_report.sent','Historical QA report','20000000-0000-4000-8000-000000003403');
insert into public.notifications(id,tenant_id,recipient_profile_id,company_id,audience,category,variant,title,body,href,entity_type,entity_id,event_key)
values
('e7340000-0000-4000-8000-000000003405','f0f0f0f0-0000-4000-8000-000000003401','20000000-0000-4000-8000-000000003403','e7340000-0000-4000-8000-000000003400','internal','report','info','QA report','Historical','/reporting','client_report','e7340000-0000-4000-8000-000000003402','wl234-owner'),
('e7340000-0000-4000-8000-000000003406','f0f0f0f0-0000-4000-8000-000000003401','20000000-0000-4000-8000-000000003404','e7340000-0000-4000-8000-000000003400','client','report','info','QA report','Historical','/account/reporting','client_report','e7340000-0000-4000-8000-000000003402','wl234-client');
create function pg_temp.act(n integer, tenant text default 'f0f0f0f0-0000-4000-8000-000000003401') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000340'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.publish(tenant uuid, revision integer, keys text[]) returns integer language plpgsql as $$
begin
perform pg_temp.act(1);
return private.publish_tenant_modules(tenant,revision,keys,'WL234 transaction fixture');
end;
$$;
create temp table module_sets as
select array_agg(module_key order by module_key) as enabled,
array_agg(module_key order by module_key) filter(where module_key<>'reporting') as disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('reporting')$$,'no publication preserves Tenant B owner access');
select ok((select granted from public.app_current_user_modules() where module_key='reporting'),'no publication preserves navigation');
select is((select count(*) from public.client_reports where id='e7340000-0000-4000-8000-000000003402'),1::bigint,'report visible before publication');
reset role;
select pg_temp.act(1);
select lives_ok($$select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003401',0,'Draft Only','#000000','#ffffff',array['services'])$$,'saving a fixture draft publishes nothing');
select is((select count(*) from private.tenant_module_publications where tenant_id in ('f0f0f0f0-0000-4000-8000-000000003401','f0f0f0f0-0000-4000-8000-000000003402')),0::bigint,'draft save creates no fixture Tenant publication');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('reporting')$$,'disabled Reporting draft never changes runtime');
reset role;
select is(pg_temp.publish('f0f0f0f0-0000-4000-8000-000000003401',0,(select disabled from module_sets)),1,'explicit first published revision');
select is((select published_by from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000003401'),'20000000-0000-4000-8000-000000003401'::uuid,'actor stamped from authenticated Platform Admin');
select throws_ok($$select pg_temp.publish('f0f0f0f0-0000-4000-8000-000000003401',0,(select enabled from module_sets))$$,'WF409',null,'stale expected revision refused');
select throws_ok($$update private.tenant_module_publications set reason='rewritten' where tenant_id='f0f0f0f0-0000-4000-8000-000000003401'$$,'55000',null,'history cannot be rewritten');
select throws_ok($$delete from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000003401'$$,'55000',null,'history cannot be deleted');
select pg_temp.act(2,'f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',1,(select enabled from module_sets),'owner attack')$$,'42501',null,'Tenant owner cannot publish');
select pg_temp.act(3);
set local role authenticated;
select is((select granted from public.app_current_user_modules() where module_key='reporting'),false,'disabled Reporting removed from authoritative navigation');
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'direct internal URL guard refuses owner');
select is(public.app_has_permission('reports.send'),false,'owner permission cannot bypass disablement');
select is((select count(*) from public.app_list_my_notifications()),0::bigint,'disabled owner cannot list report notification');
select is(public.app_mark_notification_read('e7340000-0000-4000-8000-000000003405'),false,'disabled owner cannot mark historical report notification');
select is(public.app_mark_all_notifications_read(),0,'disabled owner cannot mark all report notifications');
select throws_ok($$select * from public.app_list_internal_reports()$$,'42501',null,'disabled direct RPC: list');
select throws_ok($$select public.app_get_internal_report('e7340000-0000-4000-8000-000000003401')$$,'42501',null,'disabled direct RPC: detail');
select throws_ok($$select * from public.app_get_report_send_status('e7340000-0000-4000-8000-000000003401')$$,'42501',null,'disabled direct RPC: send status');
select throws_ok($$select public.app_create_report_draft(gen_random_uuid(),'{"company_id":"e7340000-0000-4000-8000-000000003400","report_lane":"seo_package","package_label":"QA","title":"QA","sections":[]}'::jsonb)$$,'42501',null,'disabled direct RPC: create');
select throws_ok($$select public.app_save_report_draft('e7340000-0000-4000-8000-000000003401','{"report_lane":"seo_package","package_label":"QA","title":"QA","sections":[]}'::jsonb)$$,'42501',null,'disabled direct RPC: save');
select throws_ok($$select public.app_send_report_draft(gen_random_uuid(),'e7340000-0000-4000-8000-000000003401')$$,'42501',null,'disabled direct RPC: send draft');
select throws_ok($$select public.app_discard_report_draft('e7340000-0000-4000-8000-000000003401')$$,'42501',null,'disabled direct RPC: discard');
select throws_ok($$select public.app_send_client_report(gen_random_uuid(),'{"company_id":"e7340000-0000-4000-8000-000000003400","report_lane":"seo_package","package_label":"QA","title":"QA","report_url":"https://example.invalid/report"}'::jsonb)$$,'42501',null,'disabled direct RPC: legacy send');
select throws_ok($$select * from public.app_list_reporting_service_options('e7340000-0000-4000-8000-000000003400',array[]::uuid[])$$,'42501',null,'disabled direct RPC: service options');
select throws_ok($$select * from public.app_list_reported_one_time_deliverables('e7340000-0000-4000-8000-000000003400','e7340000-0000-4000-8000-000000003409')$$,'42501',null,'disabled direct RPC: one time ledger');
select is((select count(*) from public.client_reports),0::bigint,'disabled owner direct client_reports reads empty');
select is((select count(*) from public.client_report_sections),0::bigint,'disabled owner direct client_report_sections reads empty');
select is((select count(*) from public.client_report_entries),0::bigint,'disabled owner direct client_report_entries reads empty');
select is((select count(*) from public.activity_events where entity_id='e7340000-0000-4000-8000-000000003402'),0::bigint,'historical report activity hidden even from admin shortcut');
select throws_ok($$update public.client_reports set title='attack' where id='e7340000-0000-4000-8000-000000003401'$$,'42501',null,'unauthorized direct report write refused');
select throws_ok($$insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason) values ('f0f0f0f0-0000-4000-8000-000000003401',2,array['reporting'],'20000000-0000-4000-8000-000000003403','attack')$$,'42501',null,'direct SQL policy write refused');
select ok(not has_function_privilege('authenticated','private.publish_tenant_modules(uuid,integer,text[],text)','execute'),'no authenticated Publish RPC');
select ok(not has_function_privilege('service_role','private.publish_tenant_modules(uuid,integer,text[],text)','execute'),'service role cannot publish');
select pg_temp.act(4);
select is((select granted from public.app_current_user_modules() where module_key='portal_reporting'),false,'client navigation disabled');
select throws_ok($$select public.app_require_module_access('portal_reporting')$$,'42501',null,'direct client URL guard refused');
select throws_ok($$select * from public.app_list_my_client_reports()$$,'42501',null,'client list RPC refused');
select throws_ok($$select public.app_get_my_client_report('e7340000-0000-4000-8000-000000003402')$$,'42501',null,'client detail RPC refused');
select throws_ok($$select public.app_mark_client_report_read('e7340000-0000-4000-8000-000000003402')$$,'42501',null,'client mark-read mutation refused');
select is(public.app_count_my_unread_reports(),0,'disabled unread badge reveals no reports');
select is((select count(*) from public.app_list_my_notifications()),0::bigint,'disabled client cannot list report notification');
select is(public.app_mark_notification_read('e7340000-0000-4000-8000-000000003406'),false,'disabled client cannot mark historical report notification');
select is(public.app_mark_all_notifications_read(),0,'disabled client cannot mark all report notifications');
select is((select count(*) from public.client_report_reads),0::bigint,'disabled client direct historical receipts hidden');
select is((select count(*) from public.client_reports),0::bigint,'disabled client direct reports hidden');
select pg_temp.act(2,'f0f0f0f0-0000-4000-8000-000000000001');
select lives_ok($$select public.app_require_module_access('reporting')$$,'B publication never affects Wolf Forge');
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'forged foreign Tenant header grants no authority');
select pg_temp.act(3,'not-a-uuid');
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'malformed Tenant header fails closed');
select pg_temp.act(6,'f0f0f0f0-0000-4000-8000-000000003401');
select throws_ok($$select * from public.app_list_internal_reports()$$,'42501',null,'Platform Admin is not a business data bypass');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
select private.emit_company_client_notification('e7340000-0000-4000-8000-000000003400','wl234-disabled-fanout','report','info','QA','QA','/account/reporting','client_report','e7340000-0000-4000-8000-000000003402',null,now());
select is((select count(*) from public.notifications where event_key='wl234-disabled-fanout'),0::bigint,'trusted no-user fanout evaluates subject Tenant policy');
select is(pg_temp.publish('f0f0f0f0-0000-4000-8000-000000000001',0,(select disabled from module_sets)),1,'Wolf Forge separately published revision');
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'WF policy cannot enable disabled B');
reset role;
select is(pg_temp.publish('f0f0f0f0-0000-4000-8000-000000003401',1,(select enabled from module_sets)),2,'re-enable is a new audited revision');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('reporting')$$,'re-enable restores legitimate B owner access');
select is((select count(*) from public.app_list_my_notifications()),1::bigint,'owner report notification restored');
select is(public.app_mark_notification_read('e7340000-0000-4000-8000-000000003405'),true,'re-enabled owner can mark notification');
select lives_ok($$select public.app_get_internal_report('e7340000-0000-4000-8000-000000003401')$$,'re-enable restores direct legitimate RPC');
select is((select count(*) from public.client_reports where id in ('e7340000-0000-4000-8000-000000003401','e7340000-0000-4000-8000-000000003402')),2::bigint,'historical reports preserved');
select is((select count(*) from public.activity_events where entity_id='e7340000-0000-4000-8000-000000003402'),1::bigint,'historical activity restored');
select pg_temp.act(4);
select lives_ok($$select public.app_get_my_client_report('e7340000-0000-4000-8000-000000003402')$$,'re-enable restores client detail');
select is((select count(*) from public.app_list_my_notifications()),1::bigint,'client report notification restored');
select is(public.app_mark_all_notifications_read(),1,'re-enabled client can mark all');

select is((select count(*) from public.client_report_reads where report_id='e7340000-0000-4000-8000-000000003402'),1::bigint,'historical client receipt restored');
-- Isolate membership denial from disabled-policy denial for the global entitlement.
select pg_temp.act(6);
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'enabled Reporting does not give Platform Admin without membership module access');
select throws_ok($$select * from public.app_list_internal_reports()$$,'42501',null,'enabled Reporting does not give Platform Admin without membership RPC access');
select throws_ok($$select public.app_get_internal_report('e7340000-0000-4000-8000-000000003402')$$,'42501',null,'enabled Reporting does not give Platform Admin without membership report detail');
select is((select count(*) from public.client_reports),0::bigint,'enabled Reporting Platform Admin without membership direct reports empty');
select is((select count(*) from public.client_report_sections),0::bigint,'enabled Reporting Platform Admin without membership direct sections empty');
select is((select count(*) from public.client_report_entries),0::bigint,'enabled Reporting Platform Admin without membership direct entries empty');
select is((select count(*) from public.client_report_reads),0::bigint,'enabled Reporting Platform Admin without membership direct receipts empty');
reset role;
select is(private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000003406','f0f0f0f0-0000-4000-8000-000000003401','reports.send'),false,'enabled explicit Tenant permission engine rejects Platform Admin without membership');
select pg_temp.act(1);
select throws_ok(format('select private.publish_tenant_modules(%L::uuid,2,%L::text[],%L)',
 'f0f0f0f0-0000-4000-8000-000000003401',array_remove(s.enabled,c.module_key),'omit '||c.module_key),
 '22023',null,'writer rejects omission of '||c.module_key)
from private.white_label_modules c cross join module_sets s where c.module_key not in ('reporting','investment_intent','projects');
select throws_ok(format('insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason) values (%L::uuid,3,%L::text[],%L::uuid,%L)',
 'f0f0f0f0-0000-4000-8000-000000003401',array_remove(s.enabled,c.module_key),'20000000-0000-4000-8000-000000003401','omit '||c.module_key),
 '22023',null,'table trigger rejects omission of '||c.module_key)
from private.white_label_modules c cross join module_sets s where c.module_key not in ('reporting','investment_intent','projects');
select pg_temp.act(3);
set local role authenticated;
select pg_temp.act(5);
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'enabled module never grants staff new permissions');
select pg_temp.act(2,'f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'B re-enable never changes disabled Wolf Forge');
reset role;
select is(pg_temp.publish('f0f0f0f0-0000-4000-8000-000000000001',1,(select enabled from module_sets)),2,'restore WF policy via explicit revision');
select pg_temp.act(1);
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,(select enabled||array['bogus'] from module_sets),'invalid')$$,'22023',null,'unknown module rejected');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,(select enabled||array['todo'] from module_sets),'invalid')$$,'22023',null,'Operations cannot be enabled');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,array['projects'],'invalid')$$,'22023',null,'missing Services dependency rejected');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,(select array_remove(enabled,'invoices') from module_sets),'invalid')$$,'22023',null,'financial module disablement unsupported');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,(select enabled||null::text from module_sets),'invalid')$$,'22023',null,'null keys rejected');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,(select enabled||array['reporting'] from module_sets),'invalid')$$,'22023',null,'duplicate keys rejected');
select throws_ok($$insert into private.tenant_module_publications values('f0f0f0f0-0000-4000-8000-000000003401',3,array['todo'],'20000000-0000-4000-8000-000000003403',now(),'SQL attack')$$,'22023',null,'low-level insert cannot enable Operations');
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('todo')$$,'42501',null,'B owner cannot use Operations');
reset role;
update public.tenants set status='suspended' where id='f0f0f0f0-0000-4000-8000-000000003401';
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'published enabled policy never unsuspends Tenant');
select is((select count(*) from public.client_reports),0::bigint,'suspended Tenant direct reads empty');
reset role;
select pg_temp.act(1);
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003401',2,(select enabled from module_sets),'suspended')$$,'55000',null,'cannot publish suspended Tenant');
update public.tenants set status='active' where id='f0f0f0f0-0000-4000-8000-000000003401';
-- Deliberately corrupt ONLY fixture history under superuser maintenance.
alter table private.tenant_module_publications disable trigger tenant_module_publications_validate;
insert into private.tenant_module_publications values('f0f0f0f0-0000-4000-8000-000000003401',3,array['bogus'],'20000000-0000-4000-8000-000000003401',now(),'corruption fixture');
alter table private.tenant_module_publications enable trigger tenant_module_publications_validate;
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('reporting')$$,'42501',null,'corrupt latest publication denies rather than defaults');
select is(public.app_has_permission('reports.send'),false,'corrupt policy cannot enable owner permission');
select pg_temp.act(2,'f0f0f0f0-0000-4000-8000-000000000001');
select lives_ok($$select public.app_require_module_access('reporting')$$,'corrupt B state cannot affect WF');
reset role;
select ok(not has_function_privilege('anon','public.app_list_internal_reports(text,integer)','execute'),'anonymous Reporting RPC not exposed');
select is((select count(*) from public.client_reports where id in ('e7340000-0000-4000-8000-000000003401','e7340000-0000-4000-8000-000000003402')),2::bigint,'disable and re-enable never delete reports');
select is((select title from public.client_reports where id='e7340000-0000-4000-8000-000000003401'),'Draft','no denied mutation changed historical title');
select is((select status from public.client_reports where id='e7340000-0000-4000-8000-000000003401'),'draft','no denied mutation sent or deleted draft');
select is((select count(*) from private.tenant_white_label_drafts d join preserved_drafts p using(tenant_id) where to_jsonb(d)=to_jsonb(p)),
(select count(*) from preserved_drafts),'all existing drafts byte-equivalent, including persistent Tenant B revision 6');
select is((select count(*) from preserved_qa p where not exists (
select 1 from (
select 'profiles' kind,to_jsonb(t) data from public.profiles t
union all select 'memberships',to_jsonb(t) from public.tenant_memberships t
union all select 'hosts',to_jsonb(t) from public.tenant_domains t
union all select 'audit',to_jsonb(t) from public.security_audit_events t
) current_rows where current_rows.kind=p.kind and current_rows.data=p.data
)),0::bigint,'existing QA profiles memberships host mappings and historic audits unchanged');
select * from finish();
rollback;
