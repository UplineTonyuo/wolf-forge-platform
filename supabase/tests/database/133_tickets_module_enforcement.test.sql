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
select ('20000000-0000-4000-8000-00000000370'||n)::uuid,
'authenticated','authenticated','wl237-tickets-'||n||'@example.invalid',now(),now()
from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000003701','wl237-tickets-fixture','Projects Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000003701','f0f0f0f0-0000-4000-8000-000000003701','Projects Fixture Client','client');
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003701' and r.name='admin';
update public.profiles p set role_id=r.id from public.roles r
where p.id='20000000-0000-4000-8000-000000003702' and r.name='owner';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000003701',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('20000000-0000-4000-8000-000000003703','internal','owner',null),
('20000000-0000-4000-8000-000000003704','client','client','e7360000-0000-4000-8000-000000003701'),
('20000000-0000-4000-8000-000000003705','internal','staff',null)
) v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values
('f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003705','investment_intent.view',true),
('f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003705','investment_intent.manage',false);
select private.grant_platform_admin('20000000-0000-4000-8000-000000003701','Projects fixture publisher');
select private.grant_platform_admin('20000000-0000-4000-8000-000000003706','Projects fixture without business membership');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000003706';
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order)
values
('e7360000-0000-4000-8000-000000003701','f0f0f0f0-0000-4000-8000-000000003701','Intent Purchasable',10,'USD',true,true,false,0),
('e7360000-0000-4000-8000-000000003702','f0f0f0f0-0000-4000-8000-000000003701','Intent Other',10,'USD',true,true,false,0);
update public.company_wallets set balance_cents=100000 where company_id='e7360000-0000-4000-8000-000000003701';
insert into public.wf_card_memberships(company_id,status,activated_at,purchase_price_cents,purchase_currency,purchase_reference)
values('e7360000-0000-4000-8000-000000003701','active',now(),25900,'USD','intent-fixture');

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000003701') returns void language sql as $$
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000370'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;

create temp table module_sets as select array_agg(module_key order by module_key) enabled,
array_agg(module_key order by module_key) filter(where module_key not in ('projects','tickets')) disabled
from private.white_label_modules;
grant select on module_sets to authenticated;
create function pg_temp.publish(keys text[],revision integer,tenant uuid default 'f0f0f0f0-0000-4000-8000-000000003701') returns integer language plpgsql as $$
begin perform pg_temp.act(1); return private.publish_tenant_modules(tenant,revision,keys,'Tickets rollback fixture'); end;
$$;
create function pg_temp.snapshot() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.tickets t where tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),
'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.ticket_messages m join public.tickets t on t.id=m.ticket_id where t.tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),
'attachments',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.ticket_attachments m join public.tickets t on t.id=m.ticket_id where t.tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),
'notifications',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.notifications t where tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),
'activity',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.activity_events t where tenant_id='f0f0f0f0-0000-4000-8000-000000003701' and entity_type='ticket'),
'quota',(select coalesce(jsonb_agg(to_jsonb(t) order by scope,subject,window_start),'[]'::jsonb) from private.rate_limit_counters t where subject like '20000000-0000-4000-8000-00000000370%'));
$$;
create temp table fixture_ids(kind text primary key,id uuid,request_id uuid,payload jsonb);
grant all on fixture_ids to authenticated;
select ok(private.published_module_set_valid((select disabled from module_sets)),'Tickets and Projects may be OFF together');
select ok(private.published_module_set_valid((select array_remove(array_remove(disabled,'reporting'),'investment_intent') from module_sets)),'four optional modules may be OFF');
select ok(not private.published_module_set_valid((select array_remove(enabled,'tickets') from module_sets)),'Projects ON requires Tickets ON');
select ok(not private.published_module_set_valid((select enabled||array['tickets'] from module_sets)),'duplicate module rejected');
select ok(not private.published_module_set_valid((select enabled||array['unknown'] from module_sets)),'unknown module rejected');
select ok(not private.published_module_set_valid((select enabled||array['todo'] from module_sets)),'Operations excluded');
select ok(not private.published_module_set_valid(null),'null module set rejected');
select ok(not private.published_module_set_valid(array[['tickets'],['services']]),'malformed module set rejected');
select ok(not private.published_module_set_valid(array_remove(s.enabled,c.module_key)),'remaining mandatory module: '||c.module_key)
from private.white_label_modules c cross join module_sets s where c.module_key not in ('projects','tickets','reporting','investment_intent','subscriptions','forms','invoices');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('tickets')$$,'no publication retains owner Tickets');
select throws_ok($$select public.app_require_module_access('todo')$$,'42501',null,'Operations remains Wolf Forge only');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000003702','wl237-foreign-fixture','Foreign Ticket Fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000003710','f0f0f0f0-0000-4000-8000-000000003702','Foreign Company','client');
insert into public.tickets(id,tenant_id,company_id,subject,status,archived_at)
values('e7370000-0000-4000-8000-000000003709','f0f0f0f0-0000-4000-8000-000000003702','e7360000-0000-4000-8000-000000003710','Foreign Tenant evidence','open',now());
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select public.app_get_ticket_detail('e7370000-0000-4000-8000-000000003709')$$,'42501',null,'owner cannot read an actual foreign Tenant Ticket');
reset role;
select is(pg_temp.publish((select disabled from module_sets),0,'f0f0f0f0-0000-4000-8000-000000003702'),1,'isolated foreign Tenant can publish Tickets OFF');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('tickets')$$,'foreign Tenant OFF publication does not change this Tenant');
select pg_temp.act(4);
insert into fixture_ids(kind,request_id,payload) values('client_ticket',gen_random_uuid(),'{"subject":"Replay fixture","message":"Historical client message"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='client_ticket';
select is((public.app_create_ticket((select request_id from fixture_ids where kind='client_ticket'),(select payload from fixture_ids where kind='client_ticket'))).id,(select id from fixture_ids where kind='client_ticket'),'authorized exact creation replay succeeds');
select throws_ok($$select public.app_create_ticket(request_id,payload||'{"company_id":"e7360000-0000-4000-8000-000000003709"}') from fixture_ids where kind='client_ticket'$$,'23505',null,'altered replay payload rejected');
reset role;
insert into public.companies(id,tenant_id,name,status) values('e7360000-0000-4000-8000-000000003709','f0f0f0f0-0000-4000-8000-000000003701','Other Company','client');
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values('f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003704','tickets.view',false);
set local role authenticated;
select ok(public.app_has_permission('tickets.create'),'view denial does not remove independent create permission');
select throws_ok($$select public.app_create_ticket(request_id,payload) from fixture_ids where kind='client_ticket'$$,'42501',null,'replay cannot bypass revoked view');
reset role;
delete from public.profile_permission_overrides where profile_id='20000000-0000-4000-8000-000000003704' and permission_key='tickets.view';
update public.tenant_memberships set company_id='e7360000-0000-4000-8000-000000003709' where tenant_id='f0f0f0f0-0000-4000-8000-000000003701' and profile_id='20000000-0000-4000-8000-000000003704';
set local role authenticated;
select throws_ok($$select public.app_create_ticket(request_id,payload) from fixture_ids where kind='client_ticket'$$,'42501',null,'replay checks current Company');
select throws_ok($$select public.app_get_ticket_detail(id) from fixture_ids where kind='client_ticket'$$,'42501',null,'ordinary read and replay agree after reassignment');
reset role;
update public.tenant_memberships set company_id='e7360000-0000-4000-8000-000000003701' where tenant_id='f0f0f0f0-0000-4000-8000-000000003701' and profile_id='20000000-0000-4000-8000-000000003704';
select pg_temp.act(3);
set local role authenticated;
insert into fixture_ids(kind,request_id,payload) values('open_ticket',gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003701","subject":"Open work","message":"Outstanding client obligation"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='open_ticket';
insert into fixture_ids(kind,request_id,payload) values('archived_ticket',gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003701","subject":"Archived unresolved","message":"Retained archive"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='archived_ticket';
select lives_ok($$select public.app_archive_ticket((select id from fixture_ids where kind='archived_ticket'))$$,'existing unresolved archive semantics retained');
insert into fixture_ids(kind,request_id,payload) values('investment_ticket',gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003701","subject":"Archived investment conversation","message":"Retained investment history","investment_service_id":"e7360000-0000-4000-8000-000000003701"}');
update fixture_ids set id=(public.app_create_ticket(request_id,payload)).id where kind='investment_ticket';
select lives_ok($$select public.app_archive_ticket((select id from fixture_ids where kind='investment_ticket'))$$,'archived unresolved investment fixture retained');
insert into fixture_ids(kind,request_id) values('note',gen_random_uuid());
update fixture_ids set id=(public.app_add_ticket_internal_note(request_id,(select id from fixture_ids where kind='client_ticket'),'Historical internal note')).id where kind='note';
insert into fixture_ids(kind,request_id) values('native_project',gen_random_uuid()),('legacy_project',gen_random_uuid());
update fixture_ids set id=(public.app_create_order(request_id,'e7360000-0000-4000-8000-000000003701','e7360000-0000-4000-8000-000000003701','Historical Project')).id where kind in ('native_project','legacy_project');
select lives_ok($$select public.app_send_order_message((select id from fixture_ids where kind='native_project'),gen_random_uuid(),'Native history',false)$$,'native conversation works before disablement');
insert into fixture_ids(kind,request_id) values('attachment',gen_random_uuid());
update fixture_ids set payload=public.app_prepare_ticket_attachment(request_id,(select id from fixture_ids where kind='client_ticket')) where kind='attachment';
reset role;
update public.tickets set order_id=(select id from fixture_ids where kind='legacy_project') where id=(select id from fixture_ids where kind='open_ticket');
insert into storage.objects(bucket_id,name,owner) select 'ticket-attachments',payload->>'storage_key','20000000-0000-4000-8000-000000003703' from fixture_ids where kind='attachment';
set local role authenticated;
update fixture_ids set payload=public.app_send_ticket_message_with_attachment(request_id,(select id from fixture_ids where kind='client_ticket'),null,'Historical attachment',null,'history.pdf','application/pdf',1,repeat('a1',32)) where kind='attachment';
update fixture_ids set id=(payload->>'attachment_id')::uuid where kind='attachment';
reset role;
update public.ticket_attachments set scan_status='clean' where id=(select id from fixture_ids where kind='attachment');
update fixture_ids set id=(select id from public.ticket_messages where ticket_id=(select id from fixture_ids where kind='client_ticket') and message_kind='initial_request' limit 1) where kind='message';
insert into fixture_ids(kind,id) select 'message',id from public.ticket_messages where ticket_id=(select id from fixture_ids where kind='client_ticket') and message_kind='initial_request' limit 1;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_get_order_conversation((select id from fixture_ids where kind='legacy_project'))$$,'legacy conversation works before disablement');
insert into fixture_ids(kind,request_id,payload) values('public_contact',gen_random_uuid(),jsonb_build_object('form_type','contact','canonical_key','wl237-public-contact','definition',jsonb_build_object(
  'name','Public support','title','Contact support','visibility','public','type_config',jsonb_build_object('subject_field_key','e7360000-0000-4000-8000-000000003797','message_field_key','e7360000-0000-4000-8000-000000003796','ticket_orchestration','deferred'),
  'fields',jsonb_build_array(jsonb_build_object('stable_field_key','e7360000-0000-4000-8000-000000003797','sort_order',0,'field_type','text','label','Subject','required',true),jsonb_build_object('stable_field_key','e7360000-0000-4000-8000-000000003796','sort_order',1,'field_type','textarea','label','Message','required',true)), 'rules','[]'::jsonb,'service_links','[]'::jsonb)));
update fixture_ids set id=(public.app_create_form(request_id,payload)).id where kind='public_contact';
insert into fixture_ids(kind,request_id) values('public_contact_version',gen_random_uuid());
update fixture_ids set id=(public.app_publish_form(request_id,(select id from fixture_ids where kind='public_contact'))).id where kind='public_contact_version';

reset role;
select is(pg_temp.publish((select enabled from module_sets),0),1,'published ON preserves compatibility');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_require_module_access('tickets')$$,'published ON preserves authorized owner');
reset role;
grant select,insert,update on fixture_ids to anon;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
insert into fixture_ids(kind,request_id,payload) values('historical_form',gen_random_uuid(),jsonb_build_array(
jsonb_build_object('field_key','e7360000-0000-4000-8000-000000003797','value','Historical Contact subject'),
jsonb_build_object('field_key','e7360000-0000-4000-8000-000000003796','value','Historical independent Form answer')));
update fixture_ids set id=(public.app_submit_form(request_id,(select id from fixture_ids where kind='public_contact_version'),'{}',payload,'[]')).id where kind='historical_form';
reset role;
insert into fixture_ids(kind,id) select 'historical_form_ticket',id from public.tickets
where source_form_submission_id=(select id from fixture_ids where kind='historical_form');
select ok((select id is not null from fixture_ids where kind='historical_form_ticket'),'enabled Contact orchestration still creates its Ticket');
select pg_temp.act(3);
set local role authenticated;
select public.app_update_ticket_status((select id from fixture_ids where kind='historical_form_ticket'),'closed');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003705','tickets.view',true),
('f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003705','tickets.edit',false),
('f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003705','team_messages.use',true);
select pg_temp.act(5);
set local role authenticated;
select lives_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='client_ticket'))$$,'enabled staff view honors allowed role');
select throws_ok($$select public.app_update_ticket_priority((select id from fixture_ids where kind='client_ticket'),'urgent')$$,'42501',null,'enabled module never grants denied edit');
select pg_temp.act(4,'00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.app_create_ticket(request_id,payload) from fixture_ids where kind='client_ticket'$$,'42501',null,'creation replay cannot return foreign Tenant history');
reset role;
select pg_temp.act(4);
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000003701' and profile_id='20000000-0000-4000-8000-000000003704';
set local role authenticated;
select throws_ok($$select public.app_create_ticket(request_id,payload) from fixture_ids where kind='client_ticket'$$,'42501',null,'changed inactive membership cannot replay history');
reset role;
update public.tenant_memberships set archived_at=null where tenant_id='f0f0f0f0-0000-4000-8000-000000003701' and profile_id='20000000-0000-4000-8000-000000003704';
select throws_ok($$select pg_temp.publish((select array_remove(enabled,'tickets') from module_sets),1)$$,'22023',null,'dependency rejects Projects ON and Tickets OFF');
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'open obligations reject OFF');
select is((select max(revision) from private.tenant_module_publications where tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),1,'rejected publication leaves revision intact');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_update_ticket_status((select id from fixture_ids where kind='client_ticket'),'closed')$$,'close client obligation');
select lives_ok($$select public.app_update_ticket_status((select id from fixture_ids where kind='open_ticket'),'resolved')$$,'resolve still replyable');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'resolved is not terminal');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_update_ticket_status((select id from fixture_ids where kind='open_ticket'),'closed')$$,'close remaining obligation');
reset role;
select throws_ok($$select pg_temp.publish((select disabled from module_sets),1)$$,'55000',null,'unfinished Projects still block disablement');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_change_order_status(id,'canceled') from fixture_ids where kind in ('native_project','legacy_project')$$,'verified Project terminal state');
select public.app_update_ticket_status((select id from fixture_ids where kind='client_ticket'),'open');
reset role;
select pg_temp.act(1);
select throws_ok($$insert into private.tenant_module_publications(tenant_id,revision,module_keys,published_by,reason)
select 'f0f0f0f0-0000-4000-8000-000000003701',2,disabled,'20000000-0000-4000-8000-000000003701','Direct publication must check open Tickets' from module_sets$$,'55000','unclosed Tickets prevent disablement','direct publication trigger independently checks open Tickets');
select pg_temp.act(3);
set local role authenticated;
select public.app_update_ticket_status((select id from fixture_ids where kind='client_ticket'),'closed');
reset role;
insert into public.notifications(id,tenant_id,recipient_profile_id,company_id,audience,category,title,body,href,entity_type,entity_id,event_key)
values
('e7370000-0000-4000-8000-000000003701','f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003703','e7360000-0000-4000-8000-000000003701','internal','ticket','Protected Ticket title','Protected Ticket snippet','/tickets','ticket',(select id from fixture_ids where kind='client_ticket'),'wl237-ticket');
insert into public.notifications(id,tenant_id,recipient_profile_id,company_id,audience,category,title,body,href,entity_type,entity_id,event_key)
values('e7370000-0000-4000-8000-000000003703','f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003703','e7360000-0000-4000-8000-000000003701','internal','store','Protected Investment Ticket title','Protected Ticket snippet','/tickets','ticket',(select id from fixture_ids where kind='investment_ticket'),'wl237-investment-ticket');
insert into public.notifications(id,tenant_id,recipient_profile_id,audience,category,title,body,href,event_key)
values('e7370000-0000-4000-8000-000000003702','f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003703','internal','team','Independent Team title','Independent Team snippet','/team','wl237-team');
create temp table history_snapshot as select pg_temp.snapshot() data;
select is(pg_temp.publish((select disabled from module_sets),1),2,'closed and archived Tickets permit OFF after Project closure');
select pg_temp.act(3);
set local role authenticated;
select is(public.app_has_permission(permission_key),false,'OFF permission: '||permission_key) from unnest(array['tickets.view','tickets.create','tickets.reply','tickets.edit','tickets.assign','tickets.internal_notes','tickets.archive']) p(permission_key);
select throws_ok($$select public.app_require_module_access('tickets')$$,'42501',null,'owner typed route denied');
select is((select count(*) from public.app_list_ticket_summaries(true)),0::bigint,'summary including archives hides all Tickets');
select is((select count(*) from public.app_list_ticket_summaries(false,true)),0::bigint,'Inbox summary hides all Tickets');
select throws_ok($$select public.app_create_ticket(request_id,payload) from fixture_ids where kind='client_ticket'$$,'42501',null,'accepted creation replay cannot expose disabled history');
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003701","subject":"Refused","message":"Refused"}')$$,'42501',null,'new internal Ticket refused');
select throws_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'detail refused');
select throws_ok($$select public.app_get_ticket_detail_with_avatars((select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'avatar/quote detail refused');
select throws_ok($$select public.app_reply_to_ticket(gen_random_uuid(),(select id from fixture_ids where kind='client_ticket'),'Refused')$$,'42501',null,'reply refused before closed-state disclosure');
select throws_ok($$select public.app_reply_to_ticket_message(gen_random_uuid(),(select id from fixture_ids where kind='client_ticket'),'Refused',(select id from fixture_ids where kind='message'))$$,'42501',null,'quoted reply refused');
select throws_ok($$select public.app_add_ticket_internal_note(gen_random_uuid(),(select id from fixture_ids where kind='client_ticket'),'Refused')$$,'42501',null,'internal note refused');
select throws_ok($$select public.app_unsend_ticket_internal_note((select id from fixture_ids where kind='note'))$$,'42501',null,'unsend refused');
select throws_ok($$select public.app_toggle_ticket_message_reaction((select id from fixture_ids where kind='message'),'like')$$,'42501',null,'reaction refused');
select throws_ok($$select public.app_forward_ticket_message_to_team(gen_random_uuid(),(select id from fixture_ids where kind='message'),gen_random_uuid())$$,'42501',null,'new forward refused without destination side effects');
select throws_ok($$select public.app_update_ticket_status((select id from fixture_ids where kind='client_ticket'),'open')$$,'42501',null,'reopen refused');
select throws_ok($$select public.app_update_ticket_priority((select id from fixture_ids where kind='client_ticket'),'urgent')$$,'42501',null,'priority refused');
select throws_ok($$select public.app_assign_ticket((select id from fixture_ids where kind='client_ticket'),null)$$,'42501',null,'assignment refused');
select throws_ok($$select public.app_archive_ticket((select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'archive refused');
select throws_ok($$select public.app_add_ticket_to_inbox((select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'Inbox write refused');
select throws_ok($$select public.app_prepare_ticket_attachment(gen_random_uuid(),(select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'attachment preparation refused before upload');
select throws_ok($$select public.app_send_ticket_message_with_attachment(gen_random_uuid(),(select id from fixture_ids where kind='client_ticket'),null,'Refused',null,'file.pdf','application/pdf',1,repeat('a1',32))$$,'42501',null,'attachment completion refused before storage disclosure');
select throws_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='attachment'))$$,'42501',null,'download metadata and bytes authority refused');
select throws_ok($$select public.app_get_project_conversation((select id from fixture_ids where kind='native_project'))$$,'42501',null,'native Project history remains protected');
select throws_ok($$select public.app_get_order_conversation((select id from fixture_ids where kind='legacy_project'))$$,'42501',null,'legacy Project history remains protected');
select pg_temp.act(4);
select throws_ok($$select public.app_set_client_conversation_presence('ticket',(select id from fixture_ids where kind='client_ticket'),true)$$,'42501',null,'Ticket presence denied');
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"subject":"Refused","message":"Refused"}')$$,'42501',null,'new client Ticket refused');
reset role;
select is(pg_temp.snapshot(),(select data from history_snapshot),'all refused operations preserve exact Ticket history/fanout/quota');
select ok(not has_table_privilege('authenticated','public.tickets','select'),'direct API grant remains revoked');
grant select on public.tickets,public.ticket_messages,public.ticket_attachments to authenticated;
grant execute on function private.current_user_has_permission(text),private.is_internal_user() to authenticated;
select pg_temp.act(3);
set local role authenticated;
select is((select count(*) from public.tickets where tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),0::bigint,'RLS cannot bypass OFF even with temporary test grant');
select is((select count(*) from public.ticket_messages where ticket_id=(select id from fixture_ids where kind='client_ticket')),0::bigint,'message RLS denies history');
select is((select count(*) from public.ticket_attachments where id=(select id from fixture_ids where kind='attachment')),0::bigint,'attachment RLS denies metadata');
reset role;
select throws_ok($$insert into public.tickets(tenant_id,company_id,subject,status) values('f0f0f0f0-0000-4000-8000-000000003701','e7360000-0000-4000-8000-000000003701','Trusted refused','open')$$,'42501',null,'trusted direct insert cannot bypass OFF');
select throws_ok($$update public.tickets set status='open' where id=(select id from fixture_ids where kind='client_ticket')$$,'42501',null,'trusted direct reopening cannot bypass OFF');
select throws_ok($$insert into public.ticket_messages(ticket_id,author_type,message_kind,visibility,body) values((select id from fixture_ids where kind='client_ticket'),'system','reply','client','Refused')$$,'42501',null,'trusted message write cannot bypass OFF');
select set_config('request.jwt.claim.sub','',true);
grant select,insert,update on fixture_ids to anon;
set local role anon;
insert into fixture_ids(kind,request_id) values('forms_only',gen_random_uuid());
select lives_ok($$update fixture_ids set id=(public.app_submit_form(request_id,(select id from fixture_ids where kind='public_contact_version'),'{}',jsonb_build_array(jsonb_build_object('field_key','e7360000-0000-4000-8000-000000003797','value','Forms-only inquiry'),jsonb_build_object('field_key','e7360000-0000-4000-8000-000000003796','value','Stored answer without Ticket')),'[]')).id where kind='forms_only'$$,'anonymous Contact submission succeeds without Ticket');
reset role;
select is((select count(*) from public.form_submission_values where submission_id=(select id from fixture_ids where kind='forms_only')),2::bigint,'both answers preserved');
select is((select orchestration_status from public.form_submissions where id=(select id from fixture_ids where kind='forms_only')),'not_required','no-orchestration outcome is explicit');
select ok((select orchestration_type is null and provenance->>'tickets_enabled_at_submission'='false' from public.form_submissions where id=(select id from fixture_ids where kind='forms_only')),'provenance records generation disabled');
select is((select count(*) from public.tickets where source_form_submission_id=(select id from fixture_ids where kind='forms_only')),0::bigint,'Forms-only generates no Ticket');
insert into fixture_ids(kind,id) values('trusted_deferred',gen_random_uuid());
insert into public.form_submissions(id,form_id,form_version_id,root_submission_id,revision_number,orchestration_type,orchestration_status,provenance)
select f.id,s.form_id,s.form_version_id,f.id,1,'contact_ticket','deferred',s.provenance
from public.form_submissions s cross join fixture_ids f
where s.id=(select id from fixture_ids where kind='forms_only') and f.kind='trusted_deferred';
select lives_ok($$insert into public.form_submission_values(submission_id,form_version_field_id,stable_field_key,field_label_snapshot,field_type_snapshot,sort_order_snapshot,value)
select (select id from fixture_ids where kind='trusted_deferred'),form_version_field_id,stable_field_key,field_label_snapshot,field_type_snapshot,sort_order_snapshot,value
from public.form_submission_values where submission_id=(select id from fixture_ids where kind='forms_only')$$,'trusted Contact value trigger preserves answers while Tickets are disabled');
select is(private.create_ticket_from_contact_submission((select id from fixture_ids where kind='trusted_deferred')),null::uuid,'trusted Contact creator independently skips disabled Tickets');
select is((select count(*) from public.tickets where source_form_submission_id=(select id from fixture_ids where kind='trusted_deferred')),0::bigint,'trusted deferred generation has no Ticket side effects');
select is(pg_temp.snapshot(),(select data from history_snapshot),'Form receipt creates no Ticket message/notification/activity/quota');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_get_form_submission((select id from fixture_ids where kind='forms_only'))$$,'authorized employee retrieves exact Forms-only answers');
select lives_ok($$select public.app_get_form_submission((select id from fixture_ids where kind='historical_form'))$$,'authorized Forms history remains readable independently of its hidden Ticket');
select throws_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='historical_form_ticket'))$$,'42501',null,'historical Form relationship does not unlock Ticket history');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is((public.app_submit_form((select request_id from fixture_ids where kind='historical_form'),(select id from fixture_ids where kind='public_contact_version'),'{}',(select payload from fixture_ids where kind='historical_form'),'[]')).id,(select id from fixture_ids where kind='historical_form'),'accepted Form replay preserves original receipt while Tickets is OFF');
reset role;
select pg_temp.act(3);
set local role authenticated;
select is((select count(*) from public.app_list_my_notifications(100) where entity_type='ticket'),0::bigint,'Ticket titles and snippets absent from feed');
select is((select count(*) from public.app_list_my_notifications(100) where id='e7370000-0000-4000-8000-000000003702'),1::bigint,'independent Team feed retained');
select is(public.app_mark_notification_read('e7370000-0000-4000-8000-000000003701'),false,'mark cannot access hidden Ticket notification');
select is(public.app_mark_notification_read('e7370000-0000-4000-8000-000000003703'),false,'Intent category cannot mark hidden Ticket notification');
create temp table visible_unread as select count(*)::integer n from public.app_list_my_notifications(100) where read_at is null;
select is(public.app_mark_all_notifications_read(),(select n from visible_unread),'mark-all count equals visible unread feed');
select is((select count(*) from public.activity_events where entity_type='ticket' and tenant_id='f0f0f0f0-0000-4000-8000-000000003701'),0::bigint,'Ticket activity hidden from direct authorized activity surface');
insert into fixture_ids(kind,id) values('team_direct',public.app_start_team_conversation('20000000-0000-4000-8000-000000003705'));
select lives_ok($$select public.app_send_team_message(gen_random_uuid(),(select id from fixture_ids where kind='team_direct'),'Independent Team conversation')$$,'Team direct messaging remains available');
select lives_ok($$select public.app_get_team_conversation((select id from fixture_ids where kind='team_direct'))$$,'Team direct read remains available');
select lives_ok($$select public.app_list_team_supervised_conversations(10)$$,'core supervision remains authorized');
reset role;
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
select 'f0f0f0f0-0000-4000-8000-000000003701','20000000-0000-4000-8000-000000003702','internal',id from public.roles where name='manager';
set local role authenticated;
select lives_ok($$select public.app_create_team_group('Independent group',array['20000000-0000-4000-8000-000000003705'::uuid,'20000000-0000-4000-8000-000000003702'::uuid])$$,'Team group creation remains available');
reset role;
select ok((select read_at is null from public.notifications where id='e7370000-0000-4000-8000-000000003701'),'mark-all preserves hidden notification read history');
select ok((select read_at is null from public.notifications where id='e7370000-0000-4000-8000-000000003703'),'mark-all preserves hidden Investment Ticket notification history');
select pg_temp.act(5);
set local role authenticated;
select is((select count(*) from public.app_list_ticket_summaries()),0::bigint,'staff cannot list disabled Tickets');
select throws_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'staff direct detail cannot bypass OFF');
select pg_temp.act(4);
select is(public.app_record_store_interest(array['e7360000-0000-4000-8000-000000003701'::uuid],true),1,'Intent recording survives Tickets OFF');
select pg_temp.act(3);
select ok((select active_ticket_id is null and active_ticket_status is null from public.app_list_investment_intents() where service_id='e7360000-0000-4000-8000-000000003701'),'Intent ON cannot disclose disabled archived Ticket pointer');
select throws_ok($$select public.app_create_ticket(gen_random_uuid(),'{"company_id":"e7360000-0000-4000-8000-000000003701","subject":"Investment","message":"Refused","investment_service_id":"e7360000-0000-4000-8000-000000003701"}')$$,'42501',null,'new investment Ticket blocked');
select pg_temp.act(6);
select throws_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='client_ticket'))$$,'42501',null,'Platform Admin without business membership denied');
reset role;
select is(pg_temp.publish((select enabled from module_sets),2),3,'reenable restores authorization');
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='client_ticket'))$$,'closed history restored under normal permissions');
select lives_ok($$select public.app_get_ticket_detail((select id from fixture_ids where kind='archived_ticket'))$$,'archived unresolved history preserved and restored');
select lives_ok($$select public.app_get_project_conversation((select id from fixture_ids where kind='native_project'))$$,'native conversation restores');
select lives_ok($$select public.app_get_order_conversation((select id from fixture_ids where kind='legacy_project'))$$,'legacy conversation restores');
select lives_ok($$select public.app_get_ticket_attachment_download((select id from fixture_ids where kind='attachment'))$$,'clean attachment restores');
reset role;
select is((select count(*) from public.tickets where source_form_submission_id=(select id from fixture_ids where kind='forms_only')),0::bigint,'reenable never converts prior Forms-only receipt');
select is(private.create_ticket_from_contact_submission((select id from fixture_ids where kind='forms_only')),null::uuid,'trusted creator cannot convert no-orchestration history');
select is((pg_temp.snapshot()->'tickets'),(select data->'tickets' from history_snapshot),'disable and reenable preserve exact Ticket rows');
select is((pg_temp.snapshot()->'messages'),(select data->'messages' from history_snapshot),'disable and reenable preserve exact messages and notes');
select is((pg_temp.snapshot()->'attachments'),(select data->'attachments' from history_snapshot),'disable and reenable preserve attachment metadata');
update public.profile_permission_overrides set allowed=false where tenant_id='f0f0f0f0-0000-4000-8000-000000003701' and profile_id='20000000-0000-4000-8000-000000003705' and permission_key='tickets.view';
select pg_temp.act(5);
set local role authenticated;
select ok((select active_ticket_id is null and active_ticket_status is null from public.app_list_investment_intents() where service_id='e7360000-0000-4000-8000-000000003701'),'Intent permission does not grant denied Ticket pointers');
reset role;
select is(pg_temp.publish((select array_remove(enabled,'projects') from module_sets),3),4,'Projects OFF and Tickets ON remains supported');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into public.tickets(tenant_id,company_id,order_id,subject,status) values('f0f0f0f0-0000-4000-8000-000000003701','e7360000-0000-4000-8000-000000003701',(select id from fixture_ids where kind='native_project'),'Trusted legacy bypass','open')$$,'42501',null,'trusted legacy creation requires Projects too');
select throws_ok($$insert into public.ticket_messages(ticket_id,author_type,message_kind,visibility,body) values((select id from fixture_ids where kind='open_ticket'),'system','reply','client','Trusted legacy bypass')$$,'42501',null,'trusted legacy message requires Projects too');
select throws_ok($$update private.tenant_module_publications set reason='Rewrite' where tenant_id='f0f0f0f0-0000-4000-8000-000000003701'$$,'55000',null,'publication history immutable');
select is((select count(*) from preserved_qa p where not exists (
select 1 from (select 'profiles' kind,to_jsonb(t) data from public.profiles t
union all select 'memberships',to_jsonb(t) from public.tenant_memberships t
union all select 'domains',to_jsonb(t) from public.tenant_domains t
union all select 'drafts',to_jsonb(t) from private.tenant_white_label_drafts t
union all select 'publications',to_jsonb(t) from private.tenant_module_publications t
union all select 'admins',to_jsonb(t) from private.platform_admins t
union all select 'audit',to_jsonb(t) from public.security_audit_events t) c where c.kind=p.kind and c.data=p.data)),0::bigint,'pre-existing QA rows and history preserved');
select * from finish();
rollback;
