begin;
select no_plan();

insert into auth.users (id, aud, role, email) values
('ea000000-0000-4000-8000-000000000001','authenticated','authenticated','page-owner@example.invalid'),
('ea000000-0000-4000-8000-000000000002','authenticated','authenticated','page-client@example.invalid'),
('ea000000-0000-4000-8000-000000000003','authenticated','authenticated','page-other@example.invalid');
insert into public.companies(id,name,status) values
('ea100000-0000-4000-8000-000000000001','Page fixtures','client'),
('ea100000-0000-4000-8000-000000000002','Other page fixtures','client');
update public.profiles set role_id=(select id from public.roles where name='owner') where id='ea000000-0000-4000-8000-000000000001';
update public.profiles set role_id=(select id from public.roles where name='client'), company_id='ea100000-0000-4000-8000-000000000001' where id='ea000000-0000-4000-8000-000000000002';
update public.profiles set role_id=(select id from public.roles where name='client'), company_id='ea100000-0000-4000-8000-000000000002' where id='ea000000-0000-4000-8000-000000000003';
insert into public.orders(id,company_id,service_id,title) select
 ('ea200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ea100000-0000-4000-8000-000000000001',
 (select id from public.services where tenant_id=private.wolf_forge_tenant_id() and archived_at is null order by id limit 1),
 'Pagination fixture '||n from generate_series(1,3) n;
insert into public.project_messages(id,order_id,author_type,body,created_at) select
 ('ea300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ea200000-0000-4000-8000-000000000001','system','Receipt '||n,
 '2026-11-10 00:00:00.123456+00'::timestamptz from generate_series(1,1003) n;
insert into public.tickets(id,order_id,company_id,subject,created_by_profile_id) values
 ('ea400000-0000-4000-8000-000000000001','ea200000-0000-4000-8000-000000000002','ea100000-0000-4000-8000-000000000001','Legacy pages','ea000000-0000-4000-8000-000000000001');
insert into public.ticket_messages(ticket_id,author_profile_id,author_type,message_kind,visibility,body)
 select 'ea400000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000001','internal',
 case when n%2=0 then 'internal_note' else 'reply' end,
 case when n%2=0 then 'internal' else 'client' end,'Legacy '||n from generate_series(1,25) n;

select ok(has_function_privilege('authenticated','public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[])','execute'),'authenticated pages');
select ok(not has_function_privilege('anon','public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[])','execute'),'anonymous pages denied');
select ok(not has_function_privilege('service_role','public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[])','execute'),'no service role page grant');
select ok(not has_function_privilege('anon','public.app_get_order_conversation_notes(uuid)','execute'),'anonymous notes denied');
select ok(not has_function_privilege('authenticated','private.order_conversation_page_messages(uuid,uuid,uuid[],boolean)','execute'),'projection helper cannot be used to bypass page authorization');
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[])'::regprocedure),'page SECURITY DEFINER has fixed empty search_path');
insert into public.tenants(id,slug,display_name,status) values
 ('ea600000-0000-4000-8000-000000000001','pagination-foreign-210','Synthetic pagination foreign workspace','active');
insert into public.companies(id,tenant_id,name,status) values
 ('ea100000-0000-4000-8000-000000000003','ea600000-0000-4000-8000-000000000001','Synthetic foreign workspace client','client');
insert into public.services(id,tenant_id,name) values
 ('ea700000-0000-4000-8000-000000000001','ea600000-0000-4000-8000-000000000001','Synthetic foreign workspace service');
insert into public.orders(id,tenant_id,company_id,service_id,title) values
 ('ea200000-0000-4000-8000-000000000004','ea600000-0000-4000-8000-000000000001','ea100000-0000-4000-8000-000000000003','ea700000-0000-4000-8000-000000000001','Synthetic foreign workspace order');

set local role authenticated;
set local "request.jwt.claim.sub"='ea000000-0000-4000-8000-000000000001';
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000004')$$,'P0002',null,'foreign Tenant fails closed for Owner');
select set_config('test.page', public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001')::text,true);
select is(jsonb_array_length(current_setting('test.page')::jsonb->'messages'),10,'initial page is ten of 1003 receipts');
select is(current_setting('test.page')::jsonb->'messages'->0->>'body','Receipt 994','latest ten shown chronologically');
select is(current_setting('test.page')::jsonb->'messages'->9->>'body','Receipt 1003','newest at end');
select is((current_setting('test.page')::jsonb->'page'->>'hasOlder')::boolean,true,'older sentinel');
select is((current_setting('test.page')::jsonb->'page'->>'hasNewer')::boolean,false,'latest exhausted');
select like((current_setting('test.page')::jsonb->'page'->>'before')::jsonb->>'at','%.123456%','microsecond boundary retained');
select set_config('test.older',public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','before',current_setting('test.page')::jsonb->'page'->>'before')::text,true);
select is(current_setting('test.older')::jsonb->'messages'->9->>'body','Receipt 993','same timestamp UUID boundary has no repeat or gap');
select is(jsonb_array_length(current_setting('test.older')::jsonb->'messages'),10,'older batch ten');
select set_config('test.newer',public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','after',current_setting('test.older')::jsonb->'page'->>'after')::text,true);
select is(current_setting('test.newer')::jsonb->'messages',current_setting('test.page')::jsonb->'messages','forward reload recovers evicted latest page');
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000002','before',current_setting('test.page')::jsonb->'page'->>'before')$$,'22023',null,'foreign Order cursor denied');
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','after',current_setting('test.page')::jsonb->'page'->>'before')$$,'22023',null,'cursor direction bound');
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','before','{}')$$,'22023',null,'invalid cursor denied');
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','before',replace(current_setting('test.page')::jsonb->'page'->>'before','.123456','.123'))$$,'22023',null,'rounded boundary is not accepted as the exact persisted cursor');
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','refresh',null,array_fill('ea300000-0000-4000-8000-000000000001'::uuid,array[101]))$$,'22023',null,'database caps retained windows independently of browser validation');
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','refresh',null,array['ea400000-0000-4000-8000-000000000001'::uuid])$$,'22023',null,'foreign source retained ID denied');
select is(jsonb_array_length(public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000003')->'messages'),0,'empty native history');
select is((public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000003')->'page'->>'hasOlder')::boolean,false,'empty history exhausted');
select is(jsonb_array_length(public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000002')->'messages'),10,'legacy notes do not consume public batch');
select is(jsonb_array_length(public.app_get_order_conversation_notes('ea200000-0000-4000-8000-000000000002')),12,'scoped notes read retains all notes independently');
select is(jsonb_array_length(public.app_get_order_conversation('ea200000-0000-4000-8000-000000000002')->'messages'),25,'legacy full consumer compatible');
select set_config('test.refresh',public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','refresh',null,array['ea300000-0000-4000-8000-000000000001'::uuid])::text,true);
select is(jsonb_array_length(current_setting('test.refresh')::jsonb->'updates'),1,'refreshes older retained rows independently of new arrivals');
select is(public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','refresh',null,array['ea300000-0000-4000-8000-000000000001'::uuid],current_setting('test.refresh')::jsonb->>'fingerprint')->'updates','null'::jsonb,'unchanged refresh omits row payload');
reset role;
insert into public.profile_permission_overrides(profile_id,permission_key,allowed) values
 ('ea000000-0000-4000-8000-000000000001','tickets.view',false);
set local role authenticated;
set local "request.jwt.claim.sub"='ea000000-0000-4000-8000-000000000001';
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001')$$,'42501',null,'current explicit permission denial blocks subsequent page reads');
reset role;
delete from public.profile_permission_overrides where profile_id='ea000000-0000-4000-8000-000000000001' and permission_key='tickets.view';
insert into public.project_messages(id,order_id,author_profile_id,author_type,request_id,body,created_at) values
 ('ea300000-0000-4000-8000-000000000000','ea200000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000002','client','ea500000-0000-4000-8000-000000000001','Accepted older send','2026-11-09 00:00:00.123456+00');
set local role authenticated;
set local "request.jwt.claim.sub"='ea000000-0000-4000-8000-000000000002';
select is(public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001','refresh',null,'{}',null,array['ea500000-0000-4000-8000-000000000001'::uuid])->'confirmedRequestIds',
 '["ea500000-0000-4000-8000-000000000001"]'::jsonb,'viewer own accepted request is confirmed outside latest page without returning its body');
select is(jsonb_array_length(public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001')->'messages'),10,'authorized client native page');
select is((select count(*) from jsonb_array_elements(public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000002')->'messages') m where m->>'visibility'<>'client' or m->>'message_kind'='internal_note'),0::bigint,'no client internal notes');
select throws_ok($$select public.app_get_order_conversation_notes('ea200000-0000-4000-8000-000000000002')$$,'42501',null,'client cannot request notes');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='ea000000-0000-4000-8000-000000000003';
select throws_ok($$select public.app_get_order_conversation_page('ea200000-0000-4000-8000-000000000001')$$,'P0002',null,'foreign company fails closed on every page');
reset role;
select * from finish();
rollback;
