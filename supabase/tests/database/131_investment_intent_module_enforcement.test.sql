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
select ('20000000-0000-4000-8000-00000000350'||n)::uuid,
'authenticated','authenticated','wl234-intent-'||n||'@example.invalid',now(),now()
from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000003501','wl234-intent-fixture','Intent Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7350000-0000-4000-8000-000000003501','f0f0f0f0-0000-4000-8000-000000003501','Intent Fixture Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003501' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003502' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000003501',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000003503','internal','owner',null),
('20000000-0000-4000-8000-000000003504','client','client','e7350000-0000-4000-8000-000000003501'),
('20000000-0000-4000-8000-000000003505','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values
('f0f0f0f0-0000-4000-8000-000000003501','20000000-0000-4000-8000-000000003505','investment_intent.view',true),
('f0f0f0f0-0000-4000-8000-000000003501','20000000-0000-4000-8000-000000003505','investment_intent.manage',false);
select private.grant_platform_admin('20000000-0000-4000-8000-000000003501','Intent fixture publisher');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003506','Intent fixture without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000003506';
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
values
('e7350000-0000-4000-8000-000000003501','f0f0f0f0-0000-4000-8000-000000003501','Intent Purchasable',10,'USD',true,true,false,0),
('e7350000-0000-4000-8000-000000003502','f0f0f0f0-0000-4000-8000-000000003501','Intent Other',10,'USD',true,true,false,0);
update public.company_wallets set balance_cents=100000 where company_id='e7350000-0000-4000-8000-000000003501';
insert into public.wf_card_memberships(company_id,status,activated_at,purchase_price_cents,purchase_currency,purchase_reference)
values('e7350000-0000-4000-8000-000000003501','active',now(),25900,'USD','intent-fixture');

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000003501') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000350'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create temp table module_sets as select array_agg(module_key order by module_key) enabled,
array_agg(module_key order by module_key) filter(where module_key<>'investment_intent') disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
create function pg_temp.publish(keys text[],revision integer,tenant uuid default 'f0f0f0f0-0000-4000-8000-000000003501') returns integer language plpgsql as $$
begin
perform pg_temp.act(1);
return private.publish_tenant_modules(tenant,revision,keys,'Intent transaction fixture');
end;
$$;
create function pg_temp.snapshot() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
'interests',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.service_interests t where tenant_id='f0f0f0f0-0000-4000-8000-000000003501'),
'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.tickets t where tenant_id='f0f0f0f0-0000-4000-8000-000000003501'),
'notifications',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.notifications t where tenant_id='f0f0f0f0-0000-4000-8000-000000003501'),
'activity',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.activity_events t where tenant_id='f0f0f0f0-0000-4000-8000-000000003501'),
'quota',(select coalesce(jsonb_agg(to_jsonb(t) order by scope,subject,window_start),'[]'::jsonb) from private.rate_limit_counters t where subject like '20000000-0000-4000-8000-00000000350%'));
$$;
create temp table fixture_ids(kind text primary key,id uuid,request_id uuid,payload jsonb);
grant select,insert,update on fixture_ids to authenticated;

select ok(private.published_module_set_valid((select disabled from module_sets)),'Intent omission is the only new optional module');
select ok(private.published_module_set_valid((select array_remove(disabled,'reporting') from module_sets)),'Reporting and Intent may both be omitted');
select ok(not has_table_privilege('authenticated','public.service_interests','select'),'production direct interest SELECT privilege remains revoked');
-- Exercise RLS as defense in depth without changing persistent API grants.
grant select on public.service_interests to authenticated;
grant execute on function private.current_user_has_permission(text) to authenticated;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('investment_intent')$$,'no publication preserves owner access');
select pg_temp.act(4);
select is(public.app_record_store_interest(array['e7350000-0000-4000-8000-000000003501'::uuid],true),1,'no publication preserves client recording');
reset role;
insert into fixture_ids select 'interest',id,null,null from public.service_interests where company_id='e7350000-0000-4000-8000-000000003501';
select pg_temp.act(3);
set local role authenticated;
select is((select count(*) from public.service_interests where id=(select id from fixture_ids where kind='interest')),1::bigint,'owner direct RLS sees authorized interest');
select lives_ok($$select public.app_set_investment_intent_status((select id from fixture_ids where kind='interest'),'contacted')$$,'authorized management works');
insert into fixture_ids(kind,request_id,payload) values('investment_ticket',gen_random_uuid(),'{"company_id":"e7350000-0000-4000-8000-000000003501","subject":"Investment conversation","message":"Existing conversation","investment_service_id":"e7350000-0000-4000-8000-000000003501"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='investment_ticket';
select lives_ok($$select public.app_get_ticket_detail_with_avatars((select id from fixture_ids where kind='investment_ticket'))$$,'authorized investment conversation created');
select pg_temp.act(5);
select lives_ok($$select * from public.app_list_investment_intents()$$,'view-only role can list');
select throws_ok($$select public.app_set_investment_intent_status((select id from fixture_ids where kind='interest'),'qualified')$$,'42501',null,'enabled module never grants missing manage permission');
reset role;
select pg_temp.act(6);
set local role authenticated;
select throws_ok($$select * from public.app_list_investment_intents()$$,'42501',null,'Platform Admin without business membership denied while enabled');
select is((select count(*) from public.service_interests),0::bigint,'Platform Admin without business membership direct RLS empty');
reset role;
select is(private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000003506','f0f0f0f0-0000-4000-8000-000000003501','investment_intent.view'),false,'explicit Tenant permission engine preserves membership');
select is(private.profile_has_permission_in_tenant('20000000-0000-4000-8000-000000003502','f0f0f0f0-0000-4000-8000-000000003501','investment_intent.view'),false,'Wolf Forge owner cannot borrow permission in fixture Tenant');

create temp table history_before as select pg_temp.snapshot() data;
insert into fixture_ids(kind,id) select 'notification',id from public.notifications
where recipient_profile_id='20000000-0000-4000-8000-000000003503' and category='store' limit 1;
select ok(exists(select 1 from fixture_ids where kind='notification'),'historical notification fixture exists');
create temp table notification_read_state as select id,read_at from public.notifications
where tenant_id='f0f0f0f0-0000-4000-8000-000000003501' and category='store';
select is(pg_temp.publish((select disabled from module_sets),0),1,'publish disabled Intent with no draft copy');
select is((select pg_temp.snapshot()->'interests'),(select data->'interests' from history_before),'publication changes no historical interest or cooldown');
select pg_temp.act(3);
set local role authenticated;
select is((select granted from public.app_current_user_modules() where module_key='investment_intent'),false,'disabled Intent navigation denied');
select throws_ok($$select public.app_require_module_access('investment_intent')$$,'42501',null,'direct page guard denies owner');
select is(public.app_has_permission('investment_intent.view'),false,'owner view permission cannot bypass disablement');
select is(public.app_has_permission('investment_intent.manage'),false,'owner management permission cannot bypass disablement');
select throws_ok($$select * from public.app_list_investment_intents()$$,'42501',null,'disabled direct list RPC denied');
select throws_ok($$select public.app_set_investment_intent_status((select id from fixture_ids where kind='interest'),'qualified')$$,'42501',null,'disabled direct management denied');
select is((select count(*) from public.service_interests),0::bigint,'disabled direct RLS hides interests');
select throws_ok($$update public.service_interests set status='qualified' where id=(select id from fixture_ids where kind='interest')$$,'42501',null,'direct interest write has no grant');
select is((select count(*) from public.activity_events where entity_type='service_interest'),0::bigint,'admin shortcut cannot disclose historical Intent activity');
select is((select count(*) from public.app_list_my_notifications() where category='store'),0::bigint,'notification reader hides historical Intent signals');
select is((select count(*) from public.app_list_my_notifications() where category='store' and read_at is null),0::bigint,'unread count cannot disclose disabled Intent');
select is(public.app_mark_notification_read((select id from fixture_ids where kind='notification')),false,'disabled historical notification cannot be marked');
select lives_ok($$select public.app_mark_all_notifications_read()$$,'mark-all remains available for ordinary authorized categories');
select throws_ok($$select * from public.notifications$$,'42501',null,'direct notification RLS cannot bypass revoked API grant');
select lives_ok($$select public.app_get_ticket_detail_with_avatars((select id from fixture_ids where kind='investment_ticket'))$$,'existing investment Ticket remains ordinarily authorized');
select lives_ok($$select public.app_create_ticket(request_id,payload) from fixture_ids where kind='investment_ticket'$$,'accepted Ticket replay produces no new investment Ticket');
reset role;
select is((select count(*) from notification_read_state s join public.notifications n using(id) where n.read_at is distinct from s.read_at),0::bigint,'mark-one and mark-all preserve disabled notification read state');

create temp table before_refusal as select pg_temp.snapshot() data;
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_record_store_interest(array['e7350000-0000-4000-8000-000000003502'::uuid],true)$$,'42501',null,'disabled new client signal denied');
select throws_ok($$select public.app_record_store_interest(array['e7350000-0000-4000-8000-000000003501'::uuid],false)$$,'42501',null,'disabled removal does not silently rewrite history');
select lives_ok($$select public.app_require_module_access('portal_store')$$,'disabled Intent leaves shopping Store enabled');
select is((select count(*) from public.service_interests),0::bigint,'client cannot read business interest rows');
reset role;
select is(pg_temp.snapshot(),(select data from before_refusal),'refused signal changes no interest Ticket notification activity or quota');

-- Exceptions roll back SQL writes. A failing quota sentinel additionally proves call ordering.
create temp table quota_definition as select pg_get_functiondef('private.consume_rate_limit(text,text,interval,integer)'::regprocedure) body;
create or replace function private.consume_rate_limit(p_scope text,p_subject text,p_window interval,p_limit integer)
returns integer language plpgsql security definer set search_path='' as $$
begin
raise exception 'quota was reached before the refused request boundary' using errcode='PQ001';
end;
$$;
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_record_store_interest(array['e7350000-0000-4000-8000-000000003502'::uuid],true)$$,'42501',null,'Intent refusal happens before any quota call');
select pg_temp.act(3);
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7350000-0000-4000-8000-000000003501","subject":"Blocked investment","message":"No side effects","investment_service_id":"e7350000-0000-4000-8000-000000003501"}')$$,'42501',null,'investment Ticket refusal precedes quota and writes');
reset role;
do $$begin execute (select body from quota_definition); end$$;
select is(pg_get_functiondef('private.consume_rate_limit(text,text,interval,integer)'::regprocedure),(select body from quota_definition),'secure quota definition restored after ordering probe');
select is(pg_temp.snapshot(),(select data from before_refusal),'refused Ticket changes no interest Ticket notification activity or quota');

select pg_temp.act(3);
set local role authenticated;
insert into fixture_ids(kind,id) select 'ordinary_ticket',(public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7350000-0000-4000-8000-000000003501","subject":"Ordinary support","message":"Still available"}')).id;
select lives_ok($$select public.app_get_ticket_detail_with_avatars((select id from fixture_ids where kind='ordinary_ticket'))$$,'ordinary support creation and conversation unaffected');
select pg_temp.act(4);
select lives_ok($$select public.app_get_ticket_detail_with_avatars((select id from fixture_ids where kind='investment_ticket'))$$,'client existing investment conversation unaffected');
reset role;
select pg_temp.act(2,'f0f0f0f0-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok($$select public.app_require_module_access('investment_intent')$$,'B policy leaves Wolf Forge enabled');
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000000001');
select throws_ok($$select * from public.app_list_investment_intents()$$,'42501',null,'foreign Tenant selector gives no business membership');
reset role;

select pg_temp.act(1);
select lives_ok($$select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003501',0,'Enabled Draft','#000d51','#a8832e',(select enabled from module_sets))$$,'fixture draft can be saved');
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('investment_intent')$$,'42501',null,'enabled draft never overrides disabled publication');
select lives_ok($$select public.app_require_module_access('reporting')$$,'Intent disablement never disables Reporting');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
create temp table notifications_before as select count(*) n from public.notifications where tenant_id='f0f0f0f0-0000-4000-8000-000000003501';
select private.emit_investment_intent_notification('intent-disabled-system','No disclosure','No disclosure',(select id from fixture_ids where kind='interest'),'e7350000-0000-4000-8000-000000003501',null);
select is((select count(*) from public.notifications where tenant_id='f0f0f0f0-0000-4000-8000-000000003501'),(select n from notifications_before),'trusted fanout resolves subject Tenant disabled policy');

select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select * from public.app_purchase_service_with_balance('e7350000-0000-4000-8000-000000003510','e7350000-0000-4000-8000-000000003501',null)$$,'authorized local wallet purchase succeeds while Intent disabled');
reset role;
select is((select status from public.service_interests where id=(select id from fixture_ids where kind='interest')),'closed','narrow purchase cleanup closes historical interest');
select is((select add_count from public.service_interests where id=(select id from fixture_ids where kind='interest')),((select data->'interests'->0->>'add_count' from history_before)::integer),'purchase does not manufacture a new interest signal');
select is((select last_notified_at from public.service_interests where id=(select id from fixture_ids where kind='interest')),(select (data->'interests'->0->>'last_notified_at')::timestamptz from history_before),'purchase preserves cooldown');
select is((select count(*) from public.service_interests where id=(select id from fixture_ids where kind='interest')),1::bigint,'purchase does not delete interest history');
select is((select count(*) from public.activity_events where entity_type='service_interest' and entity_id=(select id from fixture_ids where kind='interest')),1::bigint,'status history stored even when hidden');
select pg_temp.act(4);
set local role authenticated;
select lives_ok($$select * from public.app_purchase_service_with_balance('e7350000-0000-4000-8000-000000003510','e7350000-0000-4000-8000-000000003501',null)$$,'authorized purchase replay remains available');
reset role;

select is(pg_temp.publish((select enabled from module_sets),1),2,'re-enable creates next immutable revision');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select * from public.app_list_investment_intents()$$,'re-enabled authorized list restored');
select is((select count(*) from public.service_interests where id=(select id from fixture_ids where kind='interest')),1::bigint,'historical direct RLS restored');
select is((select count(*) from public.activity_events where entity_type='service_interest' and entity_id=(select id from fixture_ids where kind='interest')),1::bigint,'historical activity restored');
select ok((select count(*)>0 from public.app_list_my_notifications() where category='store'),'historical Intent notifications restored');
select is(public.app_mark_notification_read((select id from fixture_ids where kind='notification')),true,'re-enabled authorized notification marking restored');
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7350000-0000-4000-8000-000000003501","subject":"Foreign service","message":"No spoofing","investment_service_id":"e7350000-0000-4000-8000-000000000001"}')$$,'23503',null,'investment relation must be a Service of the resolved Tenant');
reset role;

-- Isolate the Tickets boundary without publishing an invalid product configuration.
create temp table module_definition as select pg_get_functiondef('private.tenant_module_allowed(uuid,text)'::regprocedure) body;
do $$declare definition text; begin
select replace(replace(body,E'\r\n',E'\n'),E'begin\n',E'begin\n  if p_module_key = ''tickets'' then return false; end if;\n') into definition from module_definition;
execute definition;
end$$;
select ok(private.tenant_module_allowed('f0f0f0f0-0000-4000-8000-000000003501','investment_intent'),'isolated probe leaves Intent enabled');
select ok(not private.tenant_module_allowed('f0f0f0f0-0000-4000-8000-000000003501','tickets'),'isolated probe denies Tickets');
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7350000-0000-4000-8000-000000003501","subject":"Tickets boundary","message":"No bypass","investment_service_id":"e7350000-0000-4000-8000-000000003501"}')$$,'42501',null,'Intent enabled alone cannot create an investment Ticket');
reset role;
do $$begin execute (select body from module_definition); end$$;
select is(pg_get_functiondef('private.tenant_module_allowed(uuid,text)'::regprocedure),(select body from module_definition),'secure module definition restored after Tickets probe');

select pg_temp.act(1);
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003501',2,(select enabled||array['todo'] from module_sets),'invalid')$$,'22023',null,'Operations excluded');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003501',2,(select enabled||array['bogus'] from module_sets),'invalid')$$,'22023',null,'unknown module rejected');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003501',2,(select enabled||array['investment_intent'] from module_sets),'invalid')$$,'22023',null,'duplicate module rejected');
select throws_ok($$select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000003501',2,(select array_remove(enabled,'services') from module_sets),'invalid')$$,'22023',null,'Intent cannot be enabled without Services');
select throws_ok(format('select private.publish_tenant_modules(%L::uuid,2,%L::text[],%L)',
'f0f0f0f0-0000-4000-8000-000000003501',array_remove(s.enabled,c.module_key),'invalid'),
'22023',null,'remaining module mandatory: '||c.module_key)
from private.white_label_modules c cross join module_sets s where c.module_key not in ('reporting','investment_intent','projects','tickets','subscriptions','forms','invoices');
select throws_ok($$update private.tenant_module_publications set reason='rewrite' where tenant_id='f0f0f0f0-0000-4000-8000-000000003501'$$,'55000',null,'historical publications immutable');
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_require_module_access('todo')$$,'42501',null,'Operations remains Wolf Forge-only');
reset role;

-- A corrupt published set cannot be used as a Tickets-disable bypass either.
select pg_temp.act(1);
alter table private.tenant_module_publications disable trigger tenant_module_publications_validate;
insert into private.tenant_module_publications values('f0f0f0f0-0000-4000-8000-000000003501',3,(select array_remove(enabled,'tickets') from module_sets),'20000000-0000-4000-8000-000000003501',now(),'corrupt Tickets-off fixture');
alter table private.tenant_module_publications enable trigger tenant_module_publications_validate;
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7350000-0000-4000-8000-000000003501","subject":"Tickets off","message":"No bypass","investment_service_id":"e7350000-0000-4000-8000-000000003501"}')$$,'42501',null,'Tickets-off publication blocks new investment Ticket');
select throws_ok($$select * from public.app_list_investment_intents()$$,'42501',null,'invalid published set fails closed');
reset role;

select is((select count(*) from preserved_qa p where not exists(
select 1 from(
select 'profiles' kind,to_jsonb(t) data from public.profiles t
union all select 'memberships',to_jsonb(t) from public.tenant_memberships t
union all select 'domains',to_jsonb(t) from public.tenant_domains t
union all select 'drafts',to_jsonb(t) from private.tenant_white_label_drafts t
union all select 'publications',to_jsonb(t) from private.tenant_module_publications t
union all select 'admins',to_jsonb(t) from private.platform_admins t
union all select 'audit',to_jsonb(t) from public.security_audit_events t
) current_rows where current_rows.kind=p.kind and current_rows.data=p.data)),0::bigint,'existing QA identity draft membership domain publication and audit rows preserved');
select * from finish();
rollback;
