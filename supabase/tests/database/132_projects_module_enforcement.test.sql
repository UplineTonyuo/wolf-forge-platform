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
select ('20000000-0000-4000-8000-00000000360'||n)::uuid,
'authenticated','authenticated','wl236-projects-'||n||'@example.invalid',now(),now()
from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000003601','wl236-projects-fixture','Projects Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000003601','f0f0f0f0-0000-4000-8000-000000003601','Projects Fixture Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003601' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003602' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000003601',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000003603','internal','owner',null),
('20000000-0000-4000-8000-000000003604','client','client','e7360000-0000-4000-8000-000000003601'),
('20000000-0000-4000-8000-000000003605','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values
('f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003605','investment_intent.view',true),
('f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003605','investment_intent.manage',false);
select private.grant_platform_admin('20000000-0000-4000-8000-000000003601','Projects fixture publisher');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003606','Projects fixture without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000003606';
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
values
('e7360000-0000-4000-8000-000000003601','f0f0f0f0-0000-4000-8000-000000003601','Intent Purchasable',10,'USD',true,true,false,0),
('e7360000-0000-4000-8000-000000003602','f0f0f0f0-0000-4000-8000-000000003601','Intent Other',10,'USD',true,true,false,0);
update public.company_wallets set balance_cents=100000 where company_id='e7360000-0000-4000-8000-000000003601';
insert into public.wf_card_memberships(company_id,status,activated_at,purchase_price_cents,purchase_currency,purchase_reference)
values('e7360000-0000-4000-8000-000000003601','active',now(),25900,'USD','intent-fixture');

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000003601') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000360'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create temp table module_sets as select array_agg(module_key order by module_key) enabled,
array_agg(module_key order by module_key) filter(where module_key<>'projects') disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
create function pg_temp.publish(keys text[],revision integer,tenant uuid default 'f0f0f0f0-0000-4000-8000-000000003601') returns integer language plpgsql as $$
begin
perform pg_temp.act(1);
return private.publish_tenant_modules(tenant,revision,keys,'Intent transaction fixture');
end;
$$;
create function pg_temp.snapshot() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
'interests',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.service_interests t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),
'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.tickets t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),
'notifications',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.notifications t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),
'activity',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.activity_events t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),
'quota',(select coalesce(jsonb_agg(to_jsonb(t) order by scope,subject,window_start),'[]'::jsonb) from private.rate_limit_counters t where subject like '20000000-0000-4000-8000-00000000360%'));
$$;
create temp table fixture_ids(kind text primary key,id uuid,request_id uuid,payload jsonb);
grant select,insert,update on fixture_ids to authenticated;

select ok(private.published_module_set_valid((select disabled from module_sets)), 'Projects is optional');
select ok(private.published_module_set_valid((select array_remove(array_remove(disabled,'reporting'),'investment_intent') from module_sets)), 'three audited modules may be disabled together');
select ok(not private.published_module_set_valid(array['projects']), 'Projects requires Services and the six mandatory modules');
select ok(not private.published_module_set_valid((select enabled||array['todo'] from module_sets)), 'Operations excluded');
select ok(not private.published_module_set_valid((select enabled||array['projects'] from module_sets)), 'duplicates rejected');
select ok(not private.published_module_set_valid((select enabled||array['unknown'] from module_sets)), 'unknown identifiers rejected');
select ok(not private.published_module_set_valid(null), 'null publication rejected');
select ok(not private.published_module_set_valid(array[['services'],['projects']]), 'multidimensional publication rejected');
select ok(not has_table_privilege('authenticated','public.tickets','select'),'direct Ticket API grant stays revoked');
grant select on public.tickets to authenticated;
select ok(not private.published_module_set_valid(array_remove(s.enabled,c.module_key)), 'mandatory module: '||c.module_key)
from private.white_label_modules c cross join module_sets s where c.module_key not in ('projects','tickets','reporting','investment_intent','subscriptions','forms','invoices','coupons');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('projects')$$, 'no publication preserves owner Projects');
select throws_ok($$select public.app_require_module_access('todo')$$,'42501',null,'Operations remains excluded from other Tenants');
select pg_temp.act(6);
select is(public.app_has_permission('projects.view'),false,'enabled Projects never grants Platform Admin business permission');
select throws_ok($$select public.app_require_module_access('projects')$$,'42501',null,'enabled Projects still denies Platform Admin without membership');
select throws_ok($$select public.app_store_purchase_projects_enabled()$$,'42501',null,'availability never grants Platform Admin business access');
select pg_temp.act(3);
insert into fixture_ids(kind,request_id,payload) values('project',gen_random_uuid(),'{}');
update fixture_ids set id=(public.app_create_order(request_id,'e7360000-0000-4000-8000-000000003601','e7360000-0000-4000-8000-000000003601','Unfinished fixture')).id where kind='project';
insert into fixture_ids(kind,request_id,payload) values('task',gen_random_uuid(),'{}');
update fixture_ids set id=(public.app_create_task(request_id,(select id from fixture_ids where kind='project'),'Fixture task')).id where kind='task';
select lives_ok($$select public.app_create_coupon(gen_random_uuid(),'{"code":"PROJECTSQA","description":"Synthetic coupon","discount_type":"fixed","recurring_duration":"forever","single_use_per_customer":true,"new_customers_only":false,"is_active":true,"rules":[{"discount_value":1,"applies_to_all":true,"service_ids":[]}]}')$$,'applicable synthetic coupon created');
select pg_temp.act(4);
select is(public.app_store_purchase_projects_enabled(),true,'no publication retains Store purchase availability');
select is(public.app_record_store_interest(array['e7360000-0000-4000-8000-000000003601'::uuid],true),1,'historical Interest fixture created before purchase');
select pg_temp.act(3);
select lives_ok($$select public.app_get_project_conversation((select id from fixture_ids where kind='project'))$$, 'no publication preserves native conversation');
insert into fixture_ids(kind,request_id) values('native_attachment',gen_random_uuid());
update fixture_ids set payload=public.app_prepare_ticket_attachment(request_id,null,(select id from fixture_ids where kind='project')) where kind='native_attachment';
reset role;
insert into storage.objects(bucket_id,name,owner) select 'ticket-attachments',payload->>'storage_key','20000000-0000-4000-8000-000000003603' from fixture_ids where kind='native_attachment';
set local role authenticated;
update fixture_ids set payload=public.app_send_ticket_message_with_attachment(request_id,null,(select id from fixture_ids where kind='project'),'Preserved native evidence',null,'native.pdf','application/pdf',1,repeat('a1',32)) where kind='native_attachment';
update fixture_ids set id=(payload->>'attachment_id')::uuid where kind='native_attachment';
insert into fixture_ids(kind,request_id,payload) values('plain_ticket',gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003601","subject":"Ordinary support","message":"Preserved support"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='plain_ticket';
insert into fixture_ids(kind,request_id,payload) values('linked_ticket',gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003601","subject":"Legacy Project","message":"Preserved legacy"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='linked_ticket';
reset role;
update public.tickets set order_id=(select id from fixture_ids where kind='project') where id=(select id from fixture_ids where kind='linked_ticket');
select pg_temp.act(3);
set local role authenticated;
insert into fixture_ids(kind,request_id) values('legacy_attachment',gen_random_uuid());
update fixture_ids set payload=public.app_prepare_ticket_attachment(request_id,(select id from fixture_ids where kind='linked_ticket')) where kind='legacy_attachment';
reset role;
insert into storage.objects(bucket_id,name,owner) select 'ticket-attachments',payload->>'storage_key','20000000-0000-4000-8000-000000003603' from fixture_ids where kind='legacy_attachment';
set local role authenticated;
update fixture_ids set payload=public.app_send_ticket_message_with_attachment(request_id,(select id from fixture_ids where kind='linked_ticket'),null,'Preserved legacy evidence',null,'legacy.pdf','application/pdf',1,repeat('a1',32)) where kind='legacy_attachment';
update fixture_ids set id=(payload->>'attachment_id')::uuid where kind='legacy_attachment';
reset role;
update public.project_attachments set scan_status='clean' where id=(select id from fixture_ids where kind='native_attachment');
update public.ticket_attachments set scan_status='clean' where id=(select id from fixture_ids where kind='legacy_attachment');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='native_attachment'))$$,'native clean download works before disablement');
select lives_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='legacy_attachment'))$$,'legacy clean download works before disablement');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003605','projects.view',true),
('f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003605','projects.edit',false),
('f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003605','client_private.read',true);
select pg_temp.act(5);
set local role authenticated;
select throws_ok($$select public.app_update_order((select id from fixture_ids where kind='project'),'{"title":"Not permitted"}')$$,'42501',null,'enabled Projects retains denied edit override');
select throws_ok($$select public.app_update_task((select id from fixture_ids where kind='task'),'{"title":"Not permitted"}')$$,'42501',null,'enabled Projects retains denied task edit');
select is((select count(*) from public.orders where id=(select id from fixture_ids where kind='project')),1::bigint,'no publication preserves granted staff Project read');
select is((select count(*) from public.order_tasks where id=(select id from fixture_ids where kind='task')),1::bigint,'no publication preserves granted staff Task read');
reset role;
update public.profile_permission_overrides set allowed=false where tenant_id='f0f0f0f0-0000-4000-8000-000000003601' and profile_id='20000000-0000-4000-8000-000000003605' and permission_key='projects.view';
select pg_temp.act(5);
set local role authenticated;
select is((select count(*) from public.orders where id=(select id from fixture_ids where kind='project')),0::bigint,'enabled Projects direct RLS honors denied view override');
select is((select count(*) from public.order_tasks where id=(select id from fixture_ids where kind='task')),0::bigint,'enabled task direct RLS honors denied Project view override');
reset role;
update public.profile_permission_overrides set allowed=true where tenant_id='f0f0f0f0-0000-4000-8000-000000003601' and profile_id='20000000-0000-4000-8000-000000003605' and permission_key='projects.view';
select throws_ok($$select pg_temp.publish((select disabled from module_sets),0)$$,'55000',null,'unfinished Project prevents trusted publication');
select is((select count(*) from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),0::bigint,'rejected publication writes no revision');
select pg_temp.act(1);
select throws_ok($$insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason) select 'f0f0f0f0-0000-4000-8000-000000003601',1,disabled,auth.uid(),'direct insertion' from module_sets$$,'55000',null,'direct publication trigger rejects unfinished Project');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_change_order_status((select id from fixture_ids where kind='project'),'complete')$$,'owner completes Project');
select pg_temp.act(4);
insert into fixture_ids(kind,request_id,payload) values('purchase',gen_random_uuid(),'{}');
create temp table accepted_purchase as select p.* from fixture_ids f cross join lateral public.app_purchase_service_with_balance(f.request_id,'e7360000-0000-4000-8000-000000003601') p where f.kind='purchase';
select is((select count(*) from accepted_purchase),1::bigint,'enabled purchase succeeds');
update fixture_ids set id=(select order_id from accepted_purchase) where kind='purchase';
reset role;
grant select on accepted_purchase to authenticated;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_change_order_status((select id from fixture_ids where kind='purchase'),'canceled')$$,'owner cancels purchased Project before disablement');
reset role;
select is((select status from public.service_interests where company_id='e7360000-0000-4000-8000-000000003601' and service_id='e7360000-0000-4000-8000-000000003601'),'closed','enabled authorized purchase retains historical Interest cleanup');
select pg_temp.act(3);
update public.service_interests set status='contacted' where company_id='e7360000-0000-4000-8000-000000003601';
set local role authenticated;
insert into fixture_ids(kind,request_id,payload) values('intake',gen_random_uuid(),jsonb_build_object('form_type','intake','canonical_key','wl236-intake','definition',jsonb_build_object(
  'name','Projects intake','title','Projects intake','visibility','assigned','fields',jsonb_build_array(jsonb_build_object('stable_field_key','e7360000-0000-4000-8000-000000003699','sort_order',0,'field_type','text','label','Brief','required',true)),
  'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','e7360000-0000-4000-8000-000000003601','role','intake_assignment','sort_order',0)))));
update fixture_ids set id=(public.app_create_form(request_id,payload)).id where kind='intake';
select lives_ok($$select public.app_publish_form(gen_random_uuid(),(select id from fixture_ids where kind='intake'))$$,'intake fixture publishes normally');
insert into fixture_ids(kind,request_id,payload) select 'intake_assignment',gen_random_uuid(),jsonb_build_object('order_id',id,'client_profile_id','20000000-0000-4000-8000-000000003604') from fixture_ids where kind='project';
update fixture_ids set id=(public.app_assign_form(request_id,(select id from fixture_ids where kind='intake'),payload)).id where kind='intake_assignment';
insert into fixture_ids(kind,request_id,payload) values('onboarding',gen_random_uuid(),jsonb_build_object('form_type','onboarding','canonical_key','wl236-onboarding','definition',jsonb_build_object(
  'name','Onboarding','title','Onboarding','visibility','assigned','fields',jsonb_build_array(jsonb_build_object('stable_field_key','e7360000-0000-4000-8000-000000003698','sort_order',0,'field_type','text','label','Name','required',true)), 'rules','[]'::jsonb,'service_links','[]'::jsonb)));
update fixture_ids set id=(public.app_create_form(request_id,payload)).id where kind='onboarding';
select lives_ok($$select public.app_publish_form(gen_random_uuid(),(select id from fixture_ids where kind='onboarding'))$$,'onboarding fixture publishes normally');
insert into fixture_ids(kind,request_id,payload) values('public_contact',gen_random_uuid(),jsonb_build_object('form_type','contact','canonical_key','wl236-public-contact','definition',jsonb_build_object(
  'name','Public support','title','Contact support','visibility','public','type_config',jsonb_build_object('subject_field_key','e7360000-0000-4000-8000-000000003697','message_field_key','e7360000-0000-4000-8000-000000003696','ticket_orchestration','deferred'),
  'fields',jsonb_build_array(jsonb_build_object('stable_field_key','e7360000-0000-4000-8000-000000003697','sort_order',0,'field_type','text','label','Subject','required',true),jsonb_build_object('stable_field_key','e7360000-0000-4000-8000-000000003696','sort_order',1,'field_type','textarea','label','Message','required',true)), 'rules','[]'::jsonb,'service_links','[]'::jsonb)));
update fixture_ids set id=(public.app_create_form(request_id,payload)).id where kind='public_contact';
insert into fixture_ids(kind,request_id) values('public_contact_version',gen_random_uuid());
update fixture_ids set id=(public.app_publish_form(request_id,(select id from fixture_ids where kind='public_contact'))).id where kind='public_contact_version';
reset role;
insert into public.notifications(tenant_id,recipient_profile_id,company_id,audience,category,title,body,href,entity_type,entity_id,event_key)
select 'f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003603','e7360000-0000-4000-8000-000000003601','internal','project','Preserved Project','Preserved Project','/orders/'||id,'order',id,'wl236-project-proof' from fixture_ids where kind='project';
insert into fixture_ids(kind,id) select 'project_notification',id from public.notifications where event_key='wl236-project-proof';
insert into public.notifications(tenant_id,recipient_profile_id,company_id,audience,category,title,body,href,entity_type,entity_id,event_key)
select 'f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003603','e7360000-0000-4000-8000-000000003601','internal','ticket','Preserved legacy','Preserved legacy','/tickets/'||id,'ticket',id,'wl236-linked-proof' from fixture_ids where kind='linked_ticket';
select pg_temp.act(3);
set local role authenticated;
select ok((select count(*)>0 from public.app_list_my_notifications() where event_key in ('wl236-project-proof','wl236-linked-proof')),'enabled historical notification fixtures visible');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.orders(tenant_id,company_id,service_id,title,archived_at) values('f0f0f0f0-0000-4000-8000-000000003601','e7360000-0000-4000-8000-000000003601','e7360000-0000-4000-8000-000000003601','Archived unfinished',now());
select is(pg_temp.publish((select disabled from module_sets),0),1,'complete canceled and archived Projects permit disablement');
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_ok($$insert into public.orders(tenant_id,company_id,service_id,title) values('f0f0f0f0-0000-4000-8000-000000003601','e7360000-0000-4000-8000-000000003601','e7360000-0000-4000-8000-000000003601','Refused trusted insertion')$$,'42501','WF_PROJECTS_DISABLED','trusted auth-null INSERT cannot bypass published disablement');
reset role;
select pg_temp.act(1);
create temp table history_before as
select 'orders' kind,to_jsonb(t) data from public.orders t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'
union all select 'tasks',to_jsonb(t) from public.order_tasks t where order_id in(select id from public.orders where tenant_id='f0f0f0f0-0000-4000-8000-000000003601')
union all select 'messages',to_jsonb(t) from public.project_messages t where order_id in(select id from public.orders where tenant_id='f0f0f0f0-0000-4000-8000-000000003601');
create function pg_temp.economic_snapshot() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
'wallet',(select to_jsonb(t) from public.company_wallets t where company_id='e7360000-0000-4000-8000-000000003601'),
'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.company_wallet_transactions t where company_id='e7360000-0000-4000-8000-000000003601'),
'invoices',(select jsonb_agg(to_jsonb(t) order by id) from public.invoices t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),
'invoice_items',(select jsonb_agg(to_jsonb(t) order by id) from public.invoice_items t where invoice_id in(select id from public.invoices where tenant_id='f0f0f0f0-0000-4000-8000-000000003601')),
'payments',(select jsonb_agg(to_jsonb(t) order by id) from public.invoice_payments t where invoice_id in(select id from public.invoices where tenant_id='f0f0f0f0-0000-4000-8000-000000003601')),
'coupon',(select jsonb_agg(to_jsonb(t) order by id) from public.coupon_redemptions t where company_id='e7360000-0000-4000-8000-000000003601'),
'orders',(select jsonb_agg(to_jsonb(t) order by id) from public.orders t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'),
'assignments',(select jsonb_agg(to_jsonb(t) order by id) from public.form_assignments t where company_id='e7360000-0000-4000-8000-000000003601'),
'requests',(select jsonb_agg(to_jsonb(t) order by request_id) from private.app_create_requests t where actor_profile_id in(select profile_id from public.tenant_memberships where tenant_id='f0f0f0f0-0000-4000-8000-000000003601')),
'work',(select pg_temp.snapshot()));
$$;
create temp table economic_before as select pg_temp.economic_snapshot() data;
create temp table secure_rate_definition as select pg_get_functiondef('private.consume_rate_limit(text,text,interval,integer)'::regprocedure) definition;
do $trap$ begin
execute replace(replace((select definition from secure_rate_definition),E'\r\n',E'\n'),E'begin\n',E'begin\n  if p_scope like ''store.purchase.%'' and not private.tenant_module_allowed(private.current_tenant_id(), ''projects'') then raise exception ''purchase reached quota before Projects gate'' using errcode = ''P0001''; end if;\n');
end $trap$;
select ok(pg_get_functiondef('private.consume_rate_limit(text,text,interval,integer)'::regprocedure) like '%purchase reached quota before Projects gate%','prequota invocation trap installed');
grant select on economic_before to authenticated;
select pg_temp.act(3);
set local role authenticated;
select is(public.app_has_permission(permission_key),false,'disabled permission: '||permission_key) from unnest(array['projects.view','projects.create','projects.edit','projects.assign','projects.archive']) keys(permission_key);
select throws_ok($$select public.app_require_module_access('projects')$$,'42501',null,'internal module denied');
select is((select count(*) from public.orders),0::bigint,'direct Order RLS hides disabled Projects');
select is((select count(*) from public.order_tasks),0::bigint,'direct Task RLS hides disabled tasks');
select is((select count(*) from public.activity_events where entity_type in ('order','order_task')),0::bigint,'admin shortcut cannot disclose Project activity');
select is((select count(*) from public.app_list_my_notifications() where category='project' or entity_type in ('order','order_task')),0::bigint,'Project notifications hidden');
select is((select count(*) from public.app_list_my_notifications() where entity_type='ticket' and entity_id=(select id from fixture_ids where kind='linked_ticket')),0::bigint,'linked-Ticket notification hidden');
select is(public.app_mark_notification_read((select id from fixture_ids where kind='project_notification')),false,'disabled Project notification cannot be marked');
select lives_ok($$select public.app_mark_all_notifications_read()$$,'mark-all remains usable');
select throws_ok($$select public.app_assign_form(gen_random_uuid(),(select id from fixture_ids where kind='intake'),(select payload from fixture_ids where kind='intake_assignment'))$$,'42501','WF_PROJECTS_DISABLED','new intake assignment refused');
select is((public.app_assign_form((select request_id from fixture_ids where kind='intake_assignment'),(select id from fixture_ids where kind='intake'),(select payload from fixture_ids where kind='intake_assignment'))).id,(select id from fixture_ids where kind='intake_assignment'),'accepted intake replay retained');
select throws_ok($$select public.app_get_project_conversation((select id from fixture_ids where kind='project'))$$,'42501',null,'native conversation blocked');
select throws_ok($$select public.app_get_order_conversation((select id from fixture_ids where kind='project'))$$,'42501',null,'legacy conversation entry blocked');
select throws_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='linked_ticket'))$$,'42501',null,'linked Ticket detail blocked');
select throws_ok($$select public.app_get_ticket_detail_with_avatars((select id from fixture_ids where kind='linked_ticket'))$$,'42501',null,'avatar detail wrapper blocked');
select throws_ok($$select public.app_reply_to_ticket_message(gen_random_uuid(),(select id from fixture_ids where kind='linked_ticket'),'Denied',(select (payload->>'message_id')::uuid from fixture_ids where kind='legacy_attachment'))$$,'42501',null,'legacy quoted reply blocked');
select throws_ok($$select public.app_reply_to_order_message((select id from fixture_ids where kind='project'),gen_random_uuid(),'Denied',(select (payload->>'message_id')::uuid from fixture_ids where kind='native_attachment'))$$,'42501',null,'native quoted reply blocked');
select throws_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='native_attachment'))$$,'42501',null,'native clean download blocked');
select throws_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='legacy_attachment'))$$,'42501',null,'legacy clean download blocked');
select throws_ok($$select public.app_send_ticket_message_with_attachment(gen_random_uuid(),null,(select id from fixture_ids where kind='project'),'Denied',null,'denied.pdf','application/pdf',1,repeat('a1',32))$$,'42501',null,'native attachment send blocked');
select throws_ok($$select public.app_send_ticket_message_with_attachment(gen_random_uuid(),(select id from fixture_ids where kind='linked_ticket'),null,'Denied',null,'denied.pdf','application/pdf',1,repeat('a1',32))$$,'42501',null,'legacy attachment send blocked');
select is((select count(*) from public.tickets where id=(select id from fixture_ids where kind='linked_ticket')),0::bigint,'linked Ticket direct RLS blocked');
select is((select count(*) from public.tickets where id=(select id from fixture_ids where kind='plain_ticket')),1::bigint,'ordinary Ticket direct RLS preserved');
select throws_ok($$select public.app_reply_to_ticket(gen_random_uuid(),(select id from fixture_ids where kind='linked_ticket'),'Denied')$$,'42501',null,'linked Ticket reply blocked');
select throws_ok($$select public.app_add_ticket_internal_note(gen_random_uuid(),(select id from fixture_ids where kind='linked_ticket'),'Denied')$$,'42501',null,'linked internal note blocked');
select throws_ok($$select public.app_update_ticket_status((select id from fixture_ids where kind='linked_ticket'),'in_progress')$$,'42501',null,'linked Ticket status blocked');
select throws_ok($$select public.app_update_ticket_priority((select id from fixture_ids where kind='linked_ticket'),'high')$$,'42501',null,'linked Ticket priority blocked');
select throws_ok($$select public.app_assign_ticket((select id from fixture_ids where kind='linked_ticket'),null)$$,'42501',null,'linked Ticket assignment blocked');
select throws_ok($$select public.app_archive_ticket((select id from fixture_ids where kind='linked_ticket'))$$,'42501',null,'linked Ticket archive blocked');
select throws_ok($$select public.app_add_ticket_to_inbox((select id from fixture_ids where kind='linked_ticket'))$$,'42501',null,'linked Ticket inbox shortcut blocked');
select throws_ok($$select public.app_prepare_ticket_attachment(gen_random_uuid(),(select id from fixture_ids where kind='linked_ticket'))$$,'42501',null,'linked attachment prepare blocked');
select throws_ok($$select public.app_send_order_message(gen_random_uuid(),(select id from fixture_ids where kind='project'),'Denied')$$,'42501',null,'native message blocked');
select throws_ok($$select public.app_create_order(gen_random_uuid(),null,null,'Denied')$$,'42501',null,'create Project blocked');
select throws_ok($$select public.app_update_order(null,'{}')$$,'42501',null,'edit Project blocked');
select throws_ok($$select public.app_assign_order(null,null)$$,'42501',null,'assign Project blocked');
select throws_ok($$select public.app_archive_order(null)$$,'42501',null,'archive Project blocked');
select throws_ok($$select public.app_change_order_status(null,'working')$$,'42501',null,'Project status blocked');
select throws_ok($$select public.app_create_task(gen_random_uuid(),null,'Denied')$$,'42501',null,'create task blocked');
select throws_ok($$select public.app_update_task(null,'{}')$$,'42501',null,'edit task blocked');
select throws_ok($$select public.app_assign_task(null,null)$$,'42501',null,'assign task blocked');
select throws_ok($$select public.app_reorder_task(null,1)$$,'42501',null,'reorder task blocked');
select throws_ok($$select public.app_change_task_status(null,'done')$$,'42501',null,'task status blocked');
select throws_ok($$insert into public.orders(company_id,service_id,title) values('e7360000-0000-4000-8000-000000003601','e7360000-0000-4000-8000-000000003601','Denied')$$,'42501',null,'direct Project mutation privilege remains revoked');
select throws_ok($$update public.order_tasks set title='Denied'$$,'42501',null,'direct task mutation privilege remains revoked');
reset role;
update economic_before set data=pg_temp.economic_snapshot();
select pg_temp.act(4);
set local role authenticated;
select is(public.app_store_purchase_projects_enabled(),false,'disabled Projects Store availability is false');
select throws_ok($$select public.app_require_module_access('portal_projects')$$,'42501',null,'client module denied');
select throws_ok($$select * from public.app_list_my_client_projects()$$,'42501',null,'client Project list denied');
select throws_ok($$select public.app_get_my_client_project((select id from fixture_ids where kind='project'))$$,'42501',null,'client Project detail denied');
select throws_ok($$select public.app_set_client_conversation_presence('ticket',(select id from fixture_ids where kind='linked_ticket'),true)$$,'42501',null,'linked Ticket presence blocked');
select throws_ok($$select public.app_set_client_conversation_presence('project',(select id from fixture_ids where kind='project'),true)$$,'42501',null,'Project presence blocked');
select throws_ok($$select * from public.app_purchase_service_with_balance(gen_random_uuid(),'e7360000-0000-4000-8000-000000003601')$$,'42501','WF_PROJECTS_DISABLED','new purchase denied before quota and economics');
select throws_ok($$select * from public.app_purchase_service_with_balance(gen_random_uuid(),'e7360000-0000-4000-8000-000000003601','PROJECTSQA')$$,'42501','WF_PROJECTS_DISABLED','coupon purchase denied before redemption and Interest cleanup');
select is(pg_temp.economic_snapshot(),(select data from economic_before),'denied purchase has no economic or interest side effects');
select is((select replayed from public.app_purchase_service_with_balance((select request_id from fixture_ids where kind='purchase'),'e7360000-0000-4000-8000-000000003601')),true,'accepted exact purchase replays while disabled');
select is(pg_temp.economic_snapshot(),(select data from economic_before),'accepted replay has no second charge or new quota');
select throws_ok($$select * from public.app_purchase_service_with_balance((select request_id from fixture_ids where kind='purchase'),'e7360000-0000-4000-8000-000000003602')$$,'23505',null,'altered payload cannot replay');
select throws_ok($$select * from public.app_purchase_service_with_balance((select request_id from fixture_ids where kind='purchase'),'e7360000-0000-4000-8000-000000003601','PROJECTSQA')$$,'23505',null,'altered coupon cannot replay');
select is((select count(*) from public.invoices where id=(select invoice_id from accepted_purchase)),1::bigint,'financial invoice remains accessible');
select throws_ok($$select public.app_get_assigned_form_schema((select id from fixture_ids where kind='intake_assignment'))$$,'42501',null,'NULL-assignee Intake remains denied to clients while Projects OFF');
select lives_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='plain_ticket'))$$,'ordinary support detail remains available');
select lives_ok($$select public.app_reply_to_ticket(gen_random_uuid(),(select id from fixture_ids where kind='plain_ticket'),'Allowed ordinary support')$$,'ordinary support reply preserved');
reset role;
do $restore$ begin execute (select definition from secure_rate_definition); end $restore$;
select is(pg_get_functiondef('private.consume_rate_limit(text,text,interval,integer)'::regprocedure),(select definition from secure_rate_definition),'rate-order probe restored exactly');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_assign_form(gen_random_uuid(),(select id from fixture_ids where kind='onboarding'),'{"client_profile_id":"20000000-0000-4000-8000-000000003604"}')$$,'unrelated onboarding assignment remains available');
insert into fixture_ids(kind,request_id) values('support_attachment',gen_random_uuid());
update fixture_ids set payload=public.app_prepare_ticket_attachment(request_id,(select id from fixture_ids where kind='plain_ticket')) where kind='support_attachment';
reset role;
insert into storage.objects(bucket_id,name,owner) select 'ticket-attachments',payload->>'storage_key','20000000-0000-4000-8000-000000003603' from fixture_ids where kind='support_attachment';
set local role authenticated;
select lives_ok($$select public.app_send_ticket_message_with_attachment((select request_id from fixture_ids where kind='support_attachment'),(select id from fixture_ids where kind='plain_ticket'),null,'Ordinary support evidence',null,'support.pdf','application/pdf',1,repeat('a1',32))$$,'ordinary support attachment send preserved');
select lives_ok($$select public.app_update_ticket_status((select id from fixture_ids where kind='plain_ticket'),'in_progress')$$,'ordinary support status preserved');
select is((select count(*) from public.invoice_payments where id=(select payment_id from accepted_purchase)),1::bigint,'authorized internal financial payment remains accessible');
select lives_ok($$select public.app_refund_invoice(gen_random_uuid(),(select invoice_id from accepted_purchase),100,'Synthetic authorized refund',(select payment_id from accepted_purchase))$$,'authorized refund remains available while Projects disabled');
select lives_ok($$select public.app_dashboard_overview(now()-interval '1 year',now(),now()-interval '2 years',now()-interval '1 year','day','UTC')$$,'financial dashboard remains available while Projects disabled');
reset role;
select is((select count(*) from public.notifications where event_key='wl236-project-proof' and read_at is null),1::bigint,'disabled Project notification storage and read state intact');
grant select,insert,update on fixture_ids to anon;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
insert into fixture_ids(kind,request_id) values('public_submission',gen_random_uuid());
select lives_ok($$update fixture_ids set id=(public.app_submit_form(request_id,(select id from fixture_ids where kind='public_contact_version'),'{}',jsonb_build_array(jsonb_build_object('field_key','e7360000-0000-4000-8000-000000003697','value','Ordinary public support'),jsonb_build_object('field_key','e7360000-0000-4000-8000-000000003696','value','Synthetic public answer preserved')),'[]')).id where kind='public_submission'$$,'ordinary anonymous public submission remains available');
reset role;
select is((select count(*) from public.form_submissions where id=(select id from fixture_ids where kind='public_submission')),1::bigint,'public submission stored under disabled Projects');
select is((select count(*) from public.tickets where source_form_submission_id=(select id from fixture_ids where kind='public_submission') and order_id is null),1::bigint,'public support orchestration creates an unrelated Ticket');
select pg_temp.act(6);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('projects')$$,'42501',null,'Platform Admin without membership denied');
select is((select count(*) from public.orders),0::bigint,'Platform Admin cannot bypass RLS');
select pg_temp.act(2, 'f0f0f0f0-0000-4000-8000-000000003601');
select throws_ok($$select public.app_get_project_conversation((select id from fixture_ids where kind='project'))$$,'42501',null,'foreign Wolf Forge owner cannot read Tenant Project');
select pg_temp.act(2, 'f0f0f0f0-0000-4000-8000-000000000001');
select lives_ok($$select public.app_require_module_access('projects')$$,'foreign configuration does not disable Wolf Forge');
select is((select count(*) from public.orders where id=(select id from fixture_ids where kind='project')),0::bigint,'foreign Tenant direct Project RLS remains isolated');
select is((select count(*) from public.order_tasks where id=(select id from fixture_ids where kind='task')),0::bigint,'foreign Tenant direct Task RLS remains isolated');
select pg_temp.act(4, 'f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$select * from public.app_purchase_service_with_balance((select request_id from fixture_ids where kind='purchase'),'e7360000-0000-4000-8000-000000003601')$$,'42501',null,'foreign Tenant cannot replay purchase');
reset role;
select is(pg_temp.publish((select enabled from module_sets),1),2,'re-enabling appends publication revision');
update public.profile_permission_overrides set allowed=false where tenant_id='f0f0f0f0-0000-4000-8000-000000003601' and profile_id='20000000-0000-4000-8000-000000003605' and permission_key='projects.view';
select pg_temp.act(5);
set local role authenticated;
select is((select count(*) from public.orders where id=(select id from fixture_ids where kind='project')),0::bigint,'published enabled Project RLS honors denied view override');
select is((select count(*) from public.order_tasks where id=(select id from fixture_ids where kind='task')),0::bigint,'published enabled Task RLS honors denied view override');
select throws_ok($$select public.app_require_module_access('projects')$$,'42501',null,'published enabled module grants no denied view capability');
reset role;
update public.profile_permission_overrides set allowed=true where tenant_id='f0f0f0f0-0000-4000-8000-000000003601' and profile_id='20000000-0000-4000-8000-000000003605' and permission_key='projects.view';
select pg_temp.act(5);
set local role authenticated;
select is((select count(*) from public.orders where id=(select id from fixture_ids where kind='project')),1::bigint,'published enabled Project retains authorized staff read');
reset role;
select throws_ok($$select pg_temp.publish((select enabled from module_sets),0)$$,'WF409',null,'stale publication revision refused');
select pg_temp.act(1);
select lives_ok($$select public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003601',0,'Projects disabled draft','#000d51','#a8832e',(select disabled from module_sets))$$,'Projects disabled draft may be saved');
select pg_temp.act(3);
set local role authenticated;
select is(public.app_has_permission('projects.view'),true,'disabled draft cannot override enabled publication');
select lives_ok($$select public.app_get_project_conversation((select id from fixture_ids where kind='project'))$$,'native historical conversation restored');
select lives_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='linked_ticket'))$$,'legacy historical conversation restored');
select lives_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='native_attachment'))$$,'native historical download restored');
select lives_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='legacy_attachment'))$$,'legacy historical download restored');
select is((select count(*) from public.orders where id=(select id from fixture_ids where kind='project')),1::bigint,'historical Project restored through RLS');
reset role;
savepoint client_without_project_view;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values('f0f0f0f0-0000-4000-8000-000000003601','20000000-0000-4000-8000-000000003604','projects.view',false);
select pg_temp.act(4);
set local role authenticated;
select is(public.app_has_permission('projects.view'),false,'buyer Project view override remains denied');
select is(public.app_store_purchase_projects_enabled(),true,'availability reports policy without granting Project view');
select lives_ok($$select * from public.app_purchase_service_with_balance(gen_random_uuid(),'e7360000-0000-4000-8000-000000003601')$$,'ordinary purchase model does not gain a Project view/create requirement');
reset role;
rollback to savepoint client_without_project_view;
select is((select jsonb_agg(data order by kind,data::text) from history_before),
(select jsonb_agg(data order by kind,data::text) from (
select 'orders' kind,to_jsonb(t) data from public.orders t where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'
union all select 'tasks',to_jsonb(t) from public.order_tasks t where order_id in(select id from public.orders where tenant_id='f0f0f0f0-0000-4000-8000-000000003601')
union all select 'messages',to_jsonb(t) from public.project_messages t where order_id in(select id from public.orders where tenant_id='f0f0f0f0-0000-4000-8000-000000003601')) preserved), 'disable and enable preserve exact Project tasks and messages');
select throws_ok($$update private.tenant_module_publications set reason='Rewrite' where tenant_id='f0f0f0f0-0000-4000-8000-000000003601'$$,'55000',null,'publication history remains immutable');
select is((select count(*) from preserved_qa p where not exists (
select 1 from (
select 'profiles' kind,to_jsonb(t) data from public.profiles t
union all select 'memberships',to_jsonb(t) from public.tenant_memberships t
union all select 'domains',to_jsonb(t) from public.tenant_domains t
union all select 'drafts',to_jsonb(t) from private.tenant_white_label_drafts t
union all select 'publications',to_jsonb(t) from private.tenant_module_publications t
union all select 'admins',to_jsonb(t) from private.platform_admins t
union all select 'audit',to_jsonb(t) from public.security_audit_events t
) current_rows where current_rows.kind=p.kind and current_rows.data=p.data)),0::bigint,'pre-existing QA identity memberships domains drafts publications grants and audit rows preserved');
select * from finish();
rollback;
