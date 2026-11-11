begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b6270000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated','order-start-'||n||'@example.invalid',now(),now() from generate_series(1,3)n;
insert into public.tenants(id,slug,display_name,status) values('b6270000-0000-4000-8000-000000000010','order-start-fixture','Order Start Fixture','active');
insert into public.companies(id,tenant_id,name,status) values
('b6270000-0000-4000-8000-000000000020','b6270000-0000-4000-8000-000000000010','Start Buyer','client'),
('b6270000-0000-4000-8000-000000000021','b6270000-0000-4000-8000-000000000010','Other Start Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'b6270000-0000-4000-8000-000000000010',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid from (values
('b6270000-0000-4000-8000-000000000001','internal','owner',null),
('b6270000-0000-4000-8000-000000000002','client','client','b6270000-0000-4000-8000-000000000020'),
('b6270000-0000-4000-8000-000000000003','client','client','b6270000-0000-4000-8000-000000000021'))v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
values('b6270000-0000-4000-8000-000000000030','b6270000-0000-4000-8000-000000000010','Start Service',10,'USD',true,true,false);
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
values('b6270000-0000-4000-8000-000000000031','b6270000-0000-4000-8000-000000000010','No Intake Service',10,'USD',true,true,false);
update public.company_wallets set balance_cents=10000 where company_id='b6270000-0000-4000-8000-000000000020';
insert into private.client_order_start_rollout values('b6270000-0000-4000-8000-000000000010','b6270000-0000-4000-8000-000000000030',true);
create function pg_temp.act(n integer) returns void language sql as $$
select set_config('request.jwt.claim.sub','b6270000-0000-4000-8000-00000000000'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers','{"x-wf-tenant":"b6270000-0000-4000-8000-000000000010"}',true);$$;
create function pg_temp.try(command text) returns text language plpgsql as $$begin execute command; return 'OK';exception when others then return sqlstate;end;$$;
create function pg_temp.chat_write_probe(p_order uuid) returns void language sql security definer set search_path='' as $$
insert into public.project_messages(order_id,author_profile_id,author_type,body)
values(p_order,auth.uid(),'client','Synthetic post-lock write probe');$$;
create temp table start_ids(label text primary key,id uuid not null);
grant all on start_ids to authenticated;
set local role authenticated;
select pg_temp.act(1);
insert into start_ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake','canonical_key','order-start-fixture',
  'definition',jsonb_build_object('name','Service Intake','title','Service Intake','visibility','assigned','type_config','{}'::jsonb,
    'fields',jsonb_build_array(jsonb_build_object('stable_field_key','b6270000-0000-4000-8000-000000000050','sort_order',0,'field_type','text','label','Business','required',true,'settings','{}'::jsonb,'options','[]'::jsonb,'service_links','[]'::jsonb)),
    'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','b6270000-0000-4000-8000-000000000030','role','intake_assignment','sort_order',0,'configuration','{}'::jsonb)))))).id;
select public.app_publish_form(gen_random_uuid(),id) from start_ids where label='form';
insert into start_ids select 'second-form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake','canonical_key','order-start-second-fixture',
  'definition',jsonb_build_object('name','Second Intake','title','Second Intake','visibility','assigned','type_config','{}'::jsonb,
    'fields',jsonb_build_array(jsonb_build_object('stable_field_key','b6270000-0000-4000-8000-000000000051','sort_order',0,'field_type','text','label','Second business','required',true,'settings','{}'::jsonb,'options','[]'::jsonb,'service_links','[]'::jsonb)),
    'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','b6270000-0000-4000-8000-000000000030','role','intake_assignment','sort_order',0,'configuration','{}'::jsonb)))))).id;
select public.app_publish_form(gen_random_uuid(),id) from start_ids where label='second-form';
select pg_temp.act(2);
insert into start_ids select 'order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),'b6270000-0000-4000-8000-000000000030');
reset role;
select is((select count(*)::integer from public.project_messages
  where order_id=(select id from start_ids where label='order') and author_type='system' and author_profile_id is null),
  1,'purchase stores its system receipt even while required forms are incomplete');
select is(private.order_conversation_forms_complete(id),false,'purchase receipt does not complete or bypass required intake') from start_ids where label='order';
select throws_ok(format('update public.project_messages set body=body where order_id=%L and author_type=%L',id,'system'),
  '55000',null,'system receipt UPDATE remains append-only despite the INSERT exception') from start_ids where label='order';
select throws_ok(format('insert into public.project_messages(order_id,author_profile_id,author_type,body) values(%L,%L,%L,%L)',
  id,'b6270000-0000-4000-8000-000000000002','system','Forged system author'),
  '42501',null,'system INSERT with a non-null author is not exempt') from start_ids where label='order';
select ok(not has_table_privilege('authenticated','public.project_messages','INSERT')
  and not has_table_privilege('authenticated','public.ticket_messages','INSERT'),'client cannot use raw message INSERT to claim system authorship');
insert into start_ids select 'assignment',a.id from public.form_assignments a
  where a.order_id=(select id from start_ids where label='order') and a.form_id=(select id from start_ids where label='form');
select is((select count(*)::integer from start_ids where label='assignment'),1,'purchase creates exactly one assigned intake');
insert into start_ids select 'second-assignment',a.id from public.form_assignments a
  where a.order_id=(select id from start_ids where label='order') and a.form_id=(select id from start_ids where label='second-form');
set local role authenticated;
select pg_temp.act(2);
select is((public.app_get_my_order_start(id)->>'requested')::boolean,false,'purchase waits for an explicit client start') from start_ids where label='order';
select is((select order_id from public.app_list_assigned_forms() where assignment_id=(select id from start_ids where label='assignment')),
  (select id from start_ids where label='order'),'client assignment includes its authorized Project for Pending intake navigation');
select is(jsonb_array_length(public.app_get_my_order_start(id)->'forms'),2,'both frozen required forms are returned before Start order') from start_ids where label='order';
select is((public.app_request_my_order_start(id)->>'started')::boolean,false,'request does not skip required intake') from start_ids where label='order';
select is((select status from public.app_get_my_client_project(id)),'pending','order remains pending before form completion') from start_ids where label='order';
select is(public.app_my_order_chat_available(id),false,'Start request without submissions keeps chat locked') from start_ids where label='order';
select throws_ok(format('select pg_temp.chat_write_probe(%L)',id),'42501',null,'existing write trigger independently refuses unfinished intake after admission waits') from start_ids where label='order';
select is((select unanswered from public.app_list_my_order_response_states(array[id])),null::boolean,'locked native conversation does not expose reply metadata') from start_ids where label='order';
select throws_ok(format('select public.app_get_order_conversation_page(%L)',id),'42501',null,'paged reader blocks unfinished intake') from start_ids where label='order';
select throws_ok(format('select public.app_get_order_conversation(%L)',id),'42501',null,'old full reader blocks unfinished intake') from start_ids where label='order';
select throws_ok(format('select public.app_get_project_conversation(%L)',id),'42501',null,'project full reader blocks unfinished intake') from start_ids where label='order';
select throws_ok(format('select public.app_send_order_message(%L,gen_random_uuid(),%L)',id,'Blocked'),'42501',null,'direct send blocks unfinished intake') from start_ids where label='order';
select throws_ok(format('select public.app_reply_to_order_message(%L,gen_random_uuid(),%L,gen_random_uuid())',id,'Blocked reply'),'42501',null,'direct quote/reply blocks before source lookup') from start_ids where label='order';
select throws_ok(format('select public.app_toggle_order_message_reaction(%L,gen_random_uuid(),%L)',id,'like'),'42501',null,'direct reaction blocks unfinished intake') from start_ids where label='order';
select pg_temp.act(3);
select ok(public.app_get_my_order_start(id) is null,'other client cannot read order start') from start_ids where label='order';
select is(pg_temp.try(format('select public.app_request_my_order_start(%L)',id)),'42501','other client cannot start the order') from start_ids where label='order';
select pg_temp.act(1);
select lives_ok(format('select public.app_get_order_conversation_page(%L)',id),'actual staff retain conversation access while forms are unfinished') from start_ids where label='order';
select public.app_publish_form(gen_random_uuid(),id) from start_ids where label='form';
select pg_temp.act(2);
select ok(public.app_my_intake_version_available(a.id,(public.app_get_assigned_form_schema(a.id)->'schema'->>'form_version_id')::uuid),'frozen intake remains available after republication') from start_ids a where label='assignment';
select public.app_submit_form(gen_random_uuid(),(public.app_get_assigned_form_schema(a.id)->'schema'->>'form_version_id')::uuid,
  jsonb_build_object('assignment_id',a.id),jsonb_build_array(jsonb_build_object('field_key','b6270000-0000-4000-8000-000000000050','value','Synthetic Business')),'[]') from start_ids a where label='assignment';
select is((public.app_reconcile_my_order_start(id)->>'started')::boolean,false,'one completed form cannot skip the second required form') from start_ids where label='assignment';
select is(public.app_my_order_chat_available(id),false,'one of two required submissions cannot open chat') from start_ids where label='order';
select is((select status from public.app_get_my_client_project(id)),'pending','persisted order is still pending with one incomplete requirement') from start_ids where label='order';
select public.app_submit_form(gen_random_uuid(),(public.app_get_assigned_form_schema(a.id)->'schema'->>'form_version_id')::uuid,
  jsonb_build_object('assignment_id',a.id),jsonb_build_array(jsonb_build_object('field_key','b6270000-0000-4000-8000-000000000051','value','Second Synthetic Business')),'[]') from start_ids a where label='second-assignment';
select is((public.app_reconcile_my_order_start(id)->>'started')::boolean,true,'required form completion starts the requested order') from start_ids where label='assignment';
select is((select status from public.app_get_my_client_project(id)),'working','canonical order is in progress') from start_ids where label='order';
select is((public.app_request_my_order_start(id)->>'started')::boolean,true,'a duplicate start replays the confirmed state') from start_ids where label='order';
select is(public.app_my_order_chat_available(id),true,'all frozen submitted requirements unlock chat after final submission') from start_ids where label='order';
select lives_ok(format('select public.app_get_order_conversation_page(%L)',id),'final completion unlocks the existing paged reader') from start_ids where label='order';
select lives_ok(format('select pg_temp.chat_write_probe(%L)',id),'existing write boundary accepts valid completed proof') from start_ids where label='order';
reset role;
-- A sibling company member reads completion proof without becoming the purchaser.
insert into auth.users(id,aud,role,email) values('b6270000-0000-4000-8000-000000000004','authenticated','authenticated','order-start-sibling@example.invalid');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'b6270000-0000-4000-8000-000000000010','b6270000-0000-4000-8000-000000000004','client',id,'b6270000-0000-4000-8000-000000000020' from public.roles where name='client';
set local role authenticated;
select pg_temp.act(4);
select is(public.app_my_order_chat_available(id),true,'company member is not restricted to purchaser-owned intake') from start_ids where label='order';
select lives_ok(format('select public.app_get_order_conversation_page(%L)',id),'company member retains ordinary conversation entitlement') from start_ids where label='order';
reset role;
create temp table original_chat_gate as select * from private.client_order_starts where order_id=(select id from start_ids where label='order');
update private.client_order_starts set assignment_ids=assignment_ids||gen_random_uuid() where order_id=(select id from start_ids where label='order');
select is(private.order_conversation_forms_complete(id),false,'missing frozen assignment cannot disappear and open chat') from start_ids where label='order';
update private.client_order_starts g set assignment_ids=s.assignment_ids,assignment_versions='{}'::jsonb from original_chat_gate s where g.order_id=s.order_id;
select is(private.order_conversation_forms_complete(id),false,'mismatched frozen versions lock an already started order') from start_ids where label='order';
update private.client_order_starts g set assignment_versions=s.assignment_versions from original_chat_gate s where g.order_id=s.order_id;
select is((select count(*)::integer from public.activity_events where entity_id=(select id from start_ids where label='order') and action='order.status_changed' and metadata->>'client_requested'='true'),1,'only one client-start activity is recorded');
select ok(not has_function_privilege('authenticated','private.try_requested_order_start(uuid)','EXECUTE'),'privileged start helper is not a client RPC');
select ok(not has_table_privilege('authenticated','private.client_order_starts','UPDATE'),'client cannot edit request proof');
select ok(not has_function_privilege('anon','public.app_request_my_order_start(uuid)','EXECUTE'),'anonymous start is forbidden');
select set_config('request.jwt.claim.sub','',true);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('b6270000-0000-4000-8000-000000000010','b6270000-0000-4000-8000-000000000002','forms.view',false);
set local role authenticated;
select pg_temp.act(2);
insert into start_ids select 'denied-form-order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),'b6270000-0000-4000-8000-000000000030');
select is(pg_temp.try(format('select public.app_get_my_order_start(%L)',id)),'42501','failed assignment access is denied rather than not_required') from start_ids where label='denied-form-order';
reset role;
select is((select cardinality(g.assignment_ids) from private.client_order_starts g where g.order_id=(select id from start_ids where label='denied-form-order')),2,'purchase still freezes both requirements when the client lacks Forms read access');
select set_config('request.jwt.claim.sub','',true);
delete from public.profile_permission_overrides where tenant_id='b6270000-0000-4000-8000-000000000010' and profile_id='b6270000-0000-4000-8000-000000000002' and permission_key='forms.view';
set local role authenticated;
select pg_temp.act(2);
insert into start_ids select 'no-intake-order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),'b6270000-0000-4000-8000-000000000031');
select ok(public.app_get_my_order_start(id) is null,'service intentionally without intake remains ungated') from start_ids where label='no-intake-order';
select is(public.app_my_order_chat_available(id),true,'no requirements preserves authorized client chat') from start_ids where label='no-intake-order';
reset role;
select ok(not has_function_privilege('authenticated','private.order_conversation_forms_complete(uuid)','execute'),'completion proof is private');
select ok(not has_function_privilege('anon','public.app_my_order_chat_available(uuid)','execute'),'anonymous cannot read eligibility');
select ok(not has_function_privilege('service_role','public.app_my_order_chat_available(uuid)','execute'),'no service-role eligibility shortcut');
-- Historical assigned intake has no frozen gate and must still block linked Ticket paths.
select set_config('request.jwt.claim.sub','',true);
insert into public.orders(id,tenant_id,company_id,service_id,title) values
('b6270000-0000-4000-8000-000000000080','b6270000-0000-4000-8000-000000000010','b6270000-0000-4000-8000-000000000020','b6270000-0000-4000-8000-000000000030','Legacy required intake');
insert into public.form_assignments(id,form_id,form_version_id,company_id,client_profile_id,order_id,assigned_by_profile_id)
select 'b6270000-0000-4000-8000-000000000081',a.form_id,f.published_version_id,a.company_id,null,'b6270000-0000-4000-8000-000000000080','b6270000-0000-4000-8000-000000000001'
from public.form_assignments a join public.forms f on f.id=a.form_id where a.id=(select id from start_ids where label='assignment');
set local role authenticated;
select pg_temp.act(1);
insert into start_ids select 'legacy-assignment',(public.app_assign_form(gen_random_uuid(),id,
  '{"order_id":"b6270000-0000-4000-8000-000000000080","client_profile_id":"b6270000-0000-4000-8000-000000000002"}')).id from start_ids where label='form';
reset role;
select is((select status from public.form_assignments where id='b6270000-0000-4000-8000-000000000081'),'canceled','ordinary reassignment retains canceled legacy history');
select set_config('request.jwt.claim.sub','',true);
insert into public.tickets(id,tenant_id,order_id,company_id,client_profile_id,subject,created_by_profile_id) values
('b6270000-0000-4000-8000-000000000082','b6270000-0000-4000-8000-000000000010','b6270000-0000-4000-8000-000000000080','b6270000-0000-4000-8000-000000000020','b6270000-0000-4000-8000-000000000002','Legacy chat','b6270000-0000-4000-8000-000000000001'),
('b6270000-0000-4000-8000-000000000083','b6270000-0000-4000-8000-000000000010',null,'b6270000-0000-4000-8000-000000000020','b6270000-0000-4000-8000-000000000002','Standalone chat','b6270000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.act(2);
select is(public.app_my_order_chat_available('b6270000-0000-4000-8000-000000000080'),false,'legacy required assignment blocks without a frozen gate');
select is(private.can_access_ticket('b6270000-0000-4000-8000-000000000082'),false,'linked Ticket RLS visibility blocks required intake');
select throws_ok($$select public.app_get_ticket_detail_with_avatars('b6270000-0000-4000-8000-000000000082')$$,'42501',null,'linked Ticket full reader blocks required intake');
select throws_ok($$select public.app_reply_to_ticket(gen_random_uuid(),'b6270000-0000-4000-8000-000000000082','Blocked')$$,'42501',null,'linked Ticket direct reply blocks required intake');
select lives_ok($$select public.app_get_ticket_detail_with_avatars('b6270000-0000-4000-8000-000000000083')$$,'standalone Ticket keeps existing behavior');
select public.app_submit_form(gen_random_uuid(),(public.app_get_assigned_form_schema(id)->'schema'->>'form_version_id')::uuid,
  jsonb_build_object('assignment_id',id),
  '[{"field_key":"b6270000-0000-4000-8000-000000000050","value":"Legacy completion"}]','[]') from start_ids where label='legacy-assignment';
select is(public.app_my_order_chat_available('b6270000-0000-4000-8000-000000000080'),true,'legacy submitted completion unlocks without gate creation or Start');
select lives_ok($$select public.app_get_order_conversation_page('b6270000-0000-4000-8000-000000000080')$$,'legacy completion unlocks linked-ticket paging');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.form_assignments set status='archived',archived_at=clock_timestamp() where id='b6270000-0000-4000-8000-000000000081';
select is(private.order_conversation_forms_complete('b6270000-0000-4000-8000-000000000080'),false,'archived old requirement remains fail-closed despite a submitted replacement');
update public.form_assignments set status='canceled',archived_at=null where id='b6270000-0000-4000-8000-000000000081';
select is(private.order_conversation_forms_complete('b6270000-0000-4000-8000-000000000080'),true,'restored ordinary canceled replacement history preserves submitted completion');
select throws_ok($$update public.form_assignments set latest_submission_id=(select latest_submission_id from public.form_assignments where id=(select id from start_ids where label='second-assignment')) where id=(select id from start_ids where label='assignment')$$,
  '23514',null,'existing receipt invariant rejects invalid submitted linkage rather than admitting chat');
update public.form_assignments set status='archived',archived_at=clock_timestamp() where id=(select id from start_ids where label='assignment');
select is(private.order_conversation_forms_complete(id),false,'archived frozen assignment cannot open a started order') from start_ids where label='order';
select * from finish();
rollback;
