begin;
select no_plan();

create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
select ('20000000-0000-4000-8000-'||lpad((4100+n)::text,12,'0'))::uuid; $$;
create function pg_temp.tid(n integer) returns uuid language sql immutable as $$
select ('f0000000-0000-4000-8000-'||lpad((4100+n)::text,12,'0'))::uuid; $$;
create function pg_temp.rid(n integer) returns uuid language sql immutable as $$
select ('a0000000-0000-4000-8000-'||lpad((4100+n)::text,12,'0'))::uuid; $$;

insert into public.tenants(id,slug,display_name,status,archived_at)
select pg_temp.tid(n),'publication-141-'||n,'Publication fixture '||n,
  case when n=3 then 'suspended' when n=4 then 'archived' else 'active' end,
  case when n=4 then now() else null end from generate_series(1,4)n;
insert into public.companies(id,tenant_id,name,status) values
  ('e0000000-0000-4000-8000-000000004101',pg_temp.tid(1),'Publication A','client'),
  ('e0000000-0000-4000-8000-000000004102',pg_temp.tid(2),'Publication B','client'),
  ('e0000000-0000-4000-8000-000000004103',private.wolf_forge_tenant_id(),'Publication WF','client');
insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.uid(n),'authenticated','authenticated','publication-141-'||n||'@example.invalid',now(),now() from generate_series(1,6)n;
update public.profiles p set role_id=r.id,company_id=case when n=4 then 'e0000000-0000-4000-8000-000000004103'::uuid else null end
from generate_series(1,6)n join public.roles r on r.name=case n when 2 then 'staff' when 3 then 'owner' when 4 then 'client' else 'admin' end
where p.id=pg_temp.uid(n);
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select pg_temp.tid(1),pg_temp.uid(n),case when n=4 then 'client' else 'internal' end,r.id,
  case when n=4 then 'e0000000-0000-4000-8000-000000004101'::uuid else null end
from generate_series(1,4)n join public.roles r on r.name=case n when 2 then 'staff' when 3 then 'owner' when 4 then 'client' else 'admin' end;
select private.grant_platform_admin(pg_temp.uid(n),'Synthetic publication suite141') from unnest(array[1,5,6])n;
select private.revoke_platform_admin(pg_temp.uid(6),'Synthetic revocation suite141');

create function pg_temp.api(actor integer,tenant integer,query text,api_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claim.sub',coalesce(pg_temp.uid(actor)::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(actor),'role',api_role)::text,true);
  perform set_config('request.headers',jsonb_build_object('x-wf-tenant',pg_temp.tid(tenant))::text,true);
  execute format('set local role %I',api_role);
  begin execute query into result; exception when others then execute 'reset role'; raise; end;
  execute 'reset role';
  return result;
end;
$$;
create function pg_temp.save(actor integer,tenant integer,expected integer,keys text[],display_name text default 'Northwind')
returns jsonb language sql as $$
select pg_temp.api(actor,tenant,format('select to_jsonb(x) from public.app_save_white_label_draft(%L,%s,%L,%L,%L,%L::text[]) x',
  pg_temp.tid(tenant),expected,display_name,'#14213d','#fca311',keys)); $$;
create function pg_temp.publish(actor integer,tenant integer,source_revision integer,expected integer,request_number integer,reason text default 'Reviewed')
returns jsonb language sql as $$
select pg_temp.api(actor,tenant,format('select public.app_publish_white_label_draft(%L,%s,%s,%L,%L)',
  pg_temp.tid(tenant),source_revision,expected,pg_temp.rid(request_number),reason)); $$;
create function pg_temp.reconcile(actor integer,tenant integer,source_revision integer,expected integer,request_number integer,reason text default 'Reviewed')
returns jsonb language sql as $$
select pg_temp.api(actor,tenant,format('select public.app_reconcile_white_label_publication(%L,%s,%s,%L,%L)',
  pg_temp.tid(tenant),source_revision,expected,pg_temp.rid(request_number),reason)); $$;
create function pg_temp.preflight(actor integer,tenant integer,source_revision integer,expected integer)
returns jsonb language sql as $$
select pg_temp.api(actor,tenant,format('select public.app_preflight_white_label_publication(%L,%s,%s)',pg_temp.tid(tenant),source_revision,expected)); $$;

select ok(not has_table_privilege(api_role,'private.tenant_white_label_publications',privilege),api_role||' cannot '||privilege||' snapshots')
from unnest(array['anon','authenticated','service_role'])api_role cross join unnest(array['SELECT','INSERT','UPDATE','DELETE'])privilege;
select ok(has_function_privilege(api_role,signature,'EXECUTE')=(api_role='authenticated'),api_role||' public RPC ACL: '||signature)
from unnest(array['anon','authenticated','service_role'])api_role cross join unnest(array[
  'public.app_get_runtime_white_label_configuration()',
  'public.app_preflight_white_label_publication(uuid,integer,integer)',
  'public.app_publish_white_label_draft(uuid,integer,integer,uuid,text)',
  'public.app_reconcile_white_label_publication(uuid,integer,integer,uuid,text)'])signature;
select ok(not has_function_privilege(api_role,p.oid,'EXECUTE'),api_role||' cannot execute private publication helper '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role'])api_role
where n.nspname='private' and (p.proname like '%white_label_publication%' or p.proname='publish_tenant_modules');
select ok((select relrowsecurity from pg_class where oid='private.tenant_white_label_publications'::regclass),'snapshot RLS enabled');

select is(pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')->>'kind','unpublished','ordinary member reads explicit unpublished state');
select is(pg_temp.api(4,1,'select public.app_get_runtime_white_label_configuration()')->>'kind','unpublished','client member reads its Tenant');
select throws_ok($$select pg_temp.api(5,1,'select public.app_get_runtime_white_label_configuration()')$$,'42501','Tenant membership required','PA entitlement alone grants no runtime membership');
select throws_ok($$select pg_temp.api(2,2,'select public.app_get_runtime_white_label_configuration()')$$,'42501','Tenant membership required','foreign selector grants no runtime read');
select throws_ok($$select pg_temp.api(1,1,'select public.app_get_runtime_white_label_configuration()','anon')$$,'42501',null,'anon cannot execute runtime RPC');
select throws_ok($$select pg_temp.api(1,1,'select public.app_get_runtime_white_label_configuration()','service_role')$$,'42501',null,'service role cannot execute runtime RPC');

select is(pg_temp.preflight(1,1,1,0)->'candidate','null'::jsonb,'unsaved defaults are not candidates');
select ok((pg_temp.preflight(1,1,1,0)->'blockers') @> '[{"code":"DRAFT_NOT_SAVED"},{"code":"STALE_DRAFT"}]','unsaved preflight is blocked');
select is(pg_temp.preflight(1,3,1,0)->>'publishable','false','inactive preflight never authorizes execution');
select throws_ok($$select pg_temp.publish(1,3,1,0,1)$$,'55000','Tenant is not active','suspended Tenant refuses before draft access');
select throws_ok($$select pg_temp.publish(1,4,1,0,1)$$,'55000','Tenant is not active','archived Tenant refuses');
select throws_ok($$select pg_temp.publish(1,99,1,0,1)$$,'P0002','Tenant not found','missing Tenant preserves P0002');
select throws_ok($$select pg_temp.publish(1,1,1,0,1)$$,'WF409','Saved draft revision conflict','loaded defaults cannot publish');

select throws_ok(format('select pg_temp.publish(%s,1,1,0,1)',actor),'42501','Platform Admin authorization required','ordinary or revoked actor cannot publish: '||actor)
from unnest(array[2,3,4,6])actor;
select throws_ok($$select pg_temp.preflight(2,1,1,0)$$,'42501','Platform Admin authorization required','ordinary staff cannot preflight');
select throws_ok($$select pg_temp.reconcile(2,1,1,0,1)$$,'42501','Platform Admin authorization required','ordinary staff cannot discover receipts');
select throws_ok($$select pg_temp.publish(1,1,0,0,1)$$,'22023',null,'zero source revision refused');
select throws_ok($$select pg_temp.publish(1,1,1,2147483647,1)$$,'22023',null,'publication revision exhaustion refused');
select throws_ok($$select pg_temp.publish(1,1,1,0,1,' ')$$,'22023',null,'blank reason refused');

select is(pg_temp.save(1,1,0,'{}')->>'revision','1','empty module selection remains draft-save valid');
select is(pg_temp.save(1,2,0,array['services'],'Other Tenant')->>'revision','1','other Tenant draft saved independently');
create temp table before_refusal as select
  (select count(*) from private.tenant_module_publications)parents,
  (select count(*) from private.tenant_white_label_publications)snapshots,
  (select count(*) from public.security_audit_events where event_code='authorization.white_label.published')audits;
select ok((pg_temp.preflight(1,1,1,0)->'blockers') @> '[{"code":"SERVICES_REQUIRED"}]','Services OFF reports specific blocker');
select throws_ok($$select pg_temp.publish(1,1,1,0,1)$$,'22023','invalid or unsupported published module set','Services OFF is not repaired during publish');
select is((select module_keys from private.tenant_white_label_drafts where tenant_id=pg_temp.tid(1)),'{}'::text[],'failed publication preserves empty saved draft');
select is((select count(*) from private.tenant_module_publications),(select parents from before_refusal),'invalid policy creates no parent');
select is((select count(*) from private.tenant_white_label_publications),(select snapshots from before_refusal),'invalid policy creates no snapshot');
select is((select count(*) from public.security_audit_events where event_code='authorization.white_label.published'),(select audits from before_refusal),'invalid policy creates no successful audit');

select is(pg_temp.save(1,1,1,array['services'],'Northwind')->>'revision','2','explicit saved draft enables Services');
select is(pg_temp.preflight(1,1,2,0)->>'publishable','true','exact saved supported draft is advisory eligible');
select throws_ok($$select pg_temp.publish(1,1,1,0,1)$$,'WF409','Saved draft revision conflict','stale reviewed draft refused');
select is(pg_temp.publish(1,1,2,0,1,'  Reviewed  ')->>'outcome','published','exact reviewed draft publishes atomically');
create temp table first_receipt as select pg_temp.reconcile(1,1,2,0,1)->'receipt' data;
select is((select data#>>'{configuration,displayName}' from first_receipt),'Northwind','receipt name comes from saved draft');
select is((select data#>>'{configuration,primaryColor}' from first_receipt),'#14213d','receipt color comes from saved draft');
select is((select data->>'publishedBy' from first_receipt),pg_temp.uid(1)::text,'receipt actor comes from authenticated session');
select is((select data->>'reason' from first_receipt),'Reviewed','reason space canonicalization matches receipt');
select is(pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')->>'kind','published','ordinary member reads published snapshot');
select is(pg_temp.api(4,1,'select public.app_get_runtime_white_label_configuration()')#>>'{configuration,displayName}','Northwind','client reads same selected-Tenant snapshot');
select is((select count(*) from private.tenant_module_publications where tenant_id=pg_temp.tid(2)),0::bigint,'Tenant A publication leaves Tenant B unpublished');
select is((select revision from private.tenant_white_label_drafts where tenant_id=pg_temp.tid(2)),1,'Tenant B draft untouched');
select is(pg_temp.publish(1,1,2,0,1)->>'outcome','already_applied','same request returns exact immutable receipt');
select is(pg_temp.reconcile(1,1,2,0,1)->'receipt',(select data from first_receipt),'lost response reconciliation proves original commit');
select is(pg_temp.reconcile(1,1,2,0,99)->>'outcome','not_found','unknown UUID reports only observed absence');
select throws_ok($$select pg_temp.publish(1,2,1,0,1)$$,'WF409','Publication request binding conflict','same publisher UUID cannot name another Tenant');
select throws_ok($$select pg_temp.reconcile(1,2,1,0,1)$$,'WF409','Publication request binding conflict','cross-Tenant reconciliation is conflict without a foreign receipt');
select throws_ok($$select pg_temp.publish(1,1,2,0,1,'Changed')$$,'WF409','Publication request binding conflict','same UUID cannot change reason');
select throws_ok($$select pg_temp.publish(1,1,2,0,2)$$,'WF409','Published revision conflict','new stale publication request refused');
select throws_ok($$update private.tenant_white_label_publications set display_name='Changed'$$,'55000','Published configuration history is immutable','snapshot update refused');
select throws_ok($$delete from private.tenant_white_label_publications$$,'55000','Published configuration history is immutable','snapshot deletion refused');
select throws_ok($$update private.tenant_module_publications set reason='Changed'$$,'55000','published module history is immutable','parent immutability retained');

select is(pg_temp.save(1,1,2,array['services'],'Later name')->>'revision','3','later save remains an inert draft');
select is(pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')#>>'{configuration,displayName}','Northwind','draft save never updates live branding');
select ok((pg_temp.preflight(1,1,2,0)->'blockers') @> '[{"code":"STALE_DRAFT"},{"code":"STALE_PUBLICATION"}]','preflight reports both stale revisions');
select is(pg_temp.publish(1,1,3,1,2)->>'outcome','published','new exact revisions append second snapshot');
select is(pg_temp.publish(1,1,2,0,1)->'receipt',(select data from first_receipt),'exact retry still returns historical receipt after later publication');
select is(pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')#>>'{configuration,displayName}','Later name','runtime reads latest effective snapshot, not retry receipt');
select is((select count(*) from private.tenant_module_publications where tenant_id=pg_temp.tid(1)),2::bigint,'retries do not duplicate parent publication');
select is((select count(*) from private.tenant_white_label_publications where tenant_id=pg_temp.tid(1)),2::bigint,'retries do not duplicate snapshots');
select is((select count(*) from public.security_audit_events where event_code='authorization.white_label.published' and resource_id=pg_temp.tid(1)),2::bigint,'only new committed publications emit success audits');

select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select private.publish_tenant_modules(pg_temp.tid(1),2,array['services'],'Legacy module writer remains private');
select is(pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')->>'kind','legacy_modules','later module-only row stays legacy and never revives earlier branding');
select ok(not (pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()') ? 'configuration'),'legacy runtime contains no old branding snapshot');
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select private.publish_tenant_modules(pg_temp.tid(2),0,array['services'],'Legacy Tenant B');
select is(pg_temp.publish(1,2,1,1,3)->>'outcome','published','draft publication advances existing legacy module revision');
select is(pg_temp.reconcile(1,2,1,1,3)#>>'{receipt,configuration,publicationRevision}','2','legacy compatibility uses one shared revision sequence');

create function pg_temp.reject_snapshot() returns trigger language plpgsql as $$
begin raise exception 'Synthetic snapshot failure' using errcode='P0001'; end; $$;
create trigger zz_test_reject_snapshot before insert on private.tenant_white_label_publications
for each row execute function pg_temp.reject_snapshot();
select throws_ok($$select pg_temp.publish(1,2,1,2,4)$$,'P0001','Synthetic snapshot failure','a failure after parent insertion rolls back the complete publication');
select is((select count(*) from private.tenant_module_publications where tenant_id=pg_temp.tid(2)),2::bigint,'failed companion leaves no parent increment');
select is((select count(*) from private.tenant_white_label_publications where tenant_id=pg_temp.tid(2)),1::bigint,'failed companion leaves no snapshot');
select is((select count(*) from public.security_audit_events where event_code='authorization.white_label.published' and resource_id=pg_temp.tid(2)),1::bigint,'failed companion leaves no success audit');
drop trigger zz_test_reject_snapshot on private.tenant_white_label_publications;

select is(pg_temp.save(1,1,3,(select array_agg(module_key order by module_key) from private.white_label_modules),'Enabled fixture')->>'revision','4','explicit draft can enable all supported modules');
select is(pg_temp.publish(1,1,4,3,10)->>'outcome','published','accepted eight-module policy supports the full selected set');
select set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',pg_temp.tid(1))::text,true);
insert into public.services(id,tenant_id,name) values('b0000000-0000-4000-8000-000000004101',pg_temp.tid(1),'Publication obligations fixture');
insert into public.orders(id,tenant_id,company_id,service_id,title,status)
values('c0000000-0000-4000-8000-000000004101',pg_temp.tid(1),'e0000000-0000-4000-8000-000000004101','b0000000-0000-4000-8000-000000004101','Unfinished fixture','pending');
insert into public.tickets(id,tenant_id,company_id,subject,status,resolved_at)
values('d0000000-0000-4000-8000-000000004101',pg_temp.tid(1),'e0000000-0000-4000-8000-000000004101','Resolved still blocks','resolved',now());
insert into public.subscriptions(id,tenant_id,company_id,service_id,status,plan_source,billing_anchor,created_by_profile_id,updated_by_profile_id,archived_at)
values('c0000000-0000-4000-8000-000000004102',pg_temp.tid(1),'e0000000-0000-4000-8000-000000004101','b0000000-0000-4000-8000-000000004101','active','service_purchase',current_date,pg_temp.uid(1),pg_temp.uid(1),now());
insert into public.invoices(id,tenant_id,company_id,status,invoice_number,issued_at,created_by_profile_id,updated_by_profile_id,archived_at)
values('c0000000-0000-4000-8000-000000004103',pg_temp.tid(1),'e0000000-0000-4000-8000-000000004101','unpaid',9414101,now(),pg_temp.uid(1),pg_temp.uid(1),now());
create temp table obligations_before as
select 'orders' kind,to_jsonb(t) data from public.orders t where tenant_id=pg_temp.tid(1)
union all select 'tickets',to_jsonb(t) from public.tickets t where tenant_id=pg_temp.tid(1)
union all select 'subscriptions',to_jsonb(t) from public.subscriptions t where tenant_id=pg_temp.tid(1)
union all select 'invoices',to_jsonb(t) from public.invoices t where tenant_id=pg_temp.tid(1);
select is(pg_temp.save(1,1,4,array['services'],'Blocked replacement')->>'revision','5','draft can request disablement independently of obligations');
select ok((pg_temp.preflight(1,1,5,4)->'blockers') @> jsonb_build_array(jsonb_build_object('code',code)),'preflight reports retained obligation: '||code)
from unnest(array['OUTSTANDING_PROJECTS','OUTSTANDING_TICKETS','UNCANCELED_SUBSCRIPTIONS','OUTSTANDING_FINANCIAL_OBLIGATIONS'])code;
select throws_ok($$select pg_temp.publish(1,1,5,4,11)$$,'55000',null,'publication independently rechecks actual outstanding-work safeguards');
select is((select count(*) from private.tenant_module_publications where tenant_id=pg_temp.tid(1)),4::bigint,'obligation refusal preserves current publication revision');
select is(pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')#>>'{configuration,displayName}','Enabled fixture','obligation refusal preserves live branding');
select results_eq($$select kind,data from obligations_before order by kind,data::text$$,$$
select kind,data from (
select 'orders' kind,to_jsonb(t) data from public.orders t where tenant_id=pg_temp.tid(1)
union all select 'tickets',to_jsonb(t) from public.tickets t where tenant_id=pg_temp.tid(1)
union all select 'subscriptions',to_jsonb(t) from public.subscriptions t where tenant_id=pg_temp.tid(1)
union all select 'invoices',to_jsonb(t) from public.invoices t where tenant_id=pg_temp.tid(1))x order by kind,data::text$$,'preflight and refused publication do not settle, cancel, archive or rewrite business obligations');

update public.tenant_memberships set archived_at=now() where tenant_id=pg_temp.tid(1) and profile_id=pg_temp.uid(2);
select throws_ok($$select pg_temp.api(2,1,'select public.app_get_runtime_white_label_configuration()')$$,'42501','Tenant membership required','revoked membership redacts runtime snapshot');
update public.profiles set archived_at=now() where id=pg_temp.uid(3);
select throws_ok($$select pg_temp.api(3,1,'select public.app_get_runtime_white_label_configuration()')$$,'42501','Tenant membership required','archived global profile cannot use retained Tenant membership');
update public.companies set archived_at=now() where id='e0000000-0000-4000-8000-000000004101';
select throws_ok($$select pg_temp.api(4,1,'select public.app_get_runtime_white_label_configuration()')$$,'42501','Tenant membership required','archived Company refuses client runtime');
select private.revoke_platform_admin(pg_temp.uid(1),'End-of-suite revocation');
select throws_ok($$select pg_temp.publish(1,1,2,0,1)$$,'42501','Platform Admin authorization required','accepted receipt does not bypass current PA authority');
select throws_ok($$select pg_temp.reconcile(1,1,2,0,1)$$,'42501','Platform Admin authorization required','reconciliation requires current PA authority');

select * from finish();
rollback;
