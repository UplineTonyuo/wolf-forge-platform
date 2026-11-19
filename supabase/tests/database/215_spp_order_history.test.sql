begin;
select no_plan();

create function pg_temp.h(n int) returns uuid language sql immutable as $$
  select ('ea215000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
insert into auth.users(id,aud,role,email)
select pg_temp.h(n),'authenticated','authenticated','history-'||n||'@example.invalid' from generate_series(1,4) n;
insert into public.companies(id,name,status) values
  (pg_temp.h(10),'History fixture','client'),(pg_temp.h(11),'Separate client fixture','client');
update public.profiles set role_id=(select id from public.roles where name='owner') where id=pg_temp.h(1);
update public.profiles set role_id=(select id from public.roles where name='client'),
  company_id=case when id=pg_temp.h(2) then pg_temp.h(10) else pg_temp.h(11) end where id in (pg_temp.h(2),pg_temp.h(3));
update public.profiles set role_id=(select id from public.roles where name='admin') where id=pg_temp.h(4);
insert into public.profile_permission_overrides(profile_id,permission_key,allowed)
values(pg_temp.h(4),'client_private.read',false);
insert into public.services(id,name) values(pg_temp.h(20),'Synthetic historical service'),(pg_temp.h(21),'Separate service');
insert into public.orders(id,company_id,service_id,title,spp_order_reference) values
  (pg_temp.h(30),pg_temp.h(10),pg_temp.h(20),'First recorded work','CAFE0201_1'),
  (pg_temp.h(31),pg_temp.h(10),pg_temp.h(20),'Other recorded work','CAFE0201_2'),
  (pg_temp.h(32),pg_temp.h(11),pg_temp.h(20),'Another company','CAFE0201_3'),
  (pg_temp.h(33),pg_temp.h(10),pg_temp.h(21),'Another service','CAFE0201_4');

update public.orders set assigned_to_profile_id=pg_temp.h(4) where id=pg_temp.h(30);

select ok(not has_table_privilege(role_name::name,relation,'INSERT') and not has_table_privilege(role_name::name,relation,'SELECT'),
  role_name||' has no direct access to '||relation)
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['private.spp_message_history','private.spp_submission_history','private.spp_signed_agreements',
  'private.spp_invoice_item_orders','private.spp_payment_history']) relation;

-- Existing client message had import time in 2023. Its correction puts it after
-- one native system entry; the later operational staff reply then clears unanswered.
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at)
values(pg_temp.h(40),pg_temp.h(30),pg_temp.h(2),'client','Imported reply','2023-03-01 00:00:00+00');
insert into public.project_messages(order_id,author_type,body,created_at)
select pg_temp.h(30),'system','Native '||n,'2020-01-01 00:00:00+00'::timestamptz+n*interval '1 day' from generate_series(1,10) n;
insert into private.spp_message_history(message_id,order_id,source_message_id,source_created_at,author_profile_id,author_type,body_sha256)
values(pg_temp.h(40),pg_temp.h(30),'message-1','2020-01-02 01:00Z',pg_temp.h(2),'client',encode(sha256(convert_to('Imported reply','UTF8')),'hex')),
      (pg_temp.h(41),pg_temp.h(30),'message-2','2020-01-22 01:00Z',pg_temp.h(1),'internal',encode(sha256(convert_to('Archived staff reply','UTF8')),'hex'));
select throws_ok($$insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at)
  values(pg_temp.h(41),pg_temp.h(30),pg_temp.h(1),'internal','Changed body','2020-01-22 01:00Z')$$,'23514',null,
  'reserved staff reply rejects a changed body before notification');
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at)
values(pg_temp.h(41),pg_temp.h(30),pg_temp.h(1),'internal','Archived staff reply','2020-01-22 01:00Z');
select is((select count(*) from public.notifications where event_key='client-conversation:project:'||pg_temp.h(30)),0::bigint,
  'archived staff reply emits no client notifications');
select ok(not exists(select 1 from private.push_deliveries d join public.notifications n on n.id=d.notification_id
  where n.event_key='client-conversation:project:'||pg_temp.h(30)),'no message push delivery is queued');
select is((select created_at from public.project_messages where id=pg_temp.h(40)),'2023-03-01 00:00:00+00'::timestamptz,
  'native import receipt remains unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.h(1)::text,true);
select set_config('test.spp.latest',public.app_get_order_conversation_page(pg_temp.h(30))::text,true);
select set_config('test.spp.older',public.app_get_order_conversation_page(pg_temp.h(30),'before',current_setting('test.spp.latest')::jsonb->'page'->>'before')::text,true);
select is((current_setting('test.spp.older')::jsonb->'messages'->-1->>'id')::uuid,pg_temp.h(40),'corrected timestamp puts imported message on older page');
select is((public.app_get_order_conversation_page(pg_temp.h(30),'after',current_setting('test.spp.older')::jsonb->'page'->>'after')->'messages'),
  current_setting('test.spp.latest')::jsonb->'messages','source-date cursor round trip has no omission or duplicate');
select is((select (entry->>'created_at')::timestamptz from jsonb_array_elements(public.app_get_order_conversation(pg_temp.h(30))->'messages') entry
  where entry->>'id'=pg_temp.h(40)::text),'2020-01-02 01:00Z'::timestamptz,'full conversation uses the same source time');
select is((select unanswered from public.app_list_order_response_states(array[pg_temp.h(30)])),false,'internal badge follows latest source-dated human reply');
select set_config('request.jwt.claim.sub',pg_temp.h(2)::text,true);
select is((select unanswered from public.app_list_my_order_response_states(array[pg_temp.h(30)])),true,'client badge follows latest source-dated human reply');
select set_config('request.jwt.claim.sub',pg_temp.h(3)::text,true);
select throws_ok($$select public.app_get_order_conversation_page(pg_temp.h(30))$$,'P0002',null,'another company cannot read historical page');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.project_messages(id,order_id,author_profile_id,author_type,body)
values(pg_temp.h(42),pg_temp.h(30),pg_temp.h(1),'internal','Normal reply');
select ok(exists(select 1 from public.notifications where event_key='client-conversation:project:'||pg_temp.h(30)
  and recipient_profile_id=pg_temp.h(2)),'unreserved operational staff reply notifies its client');

insert into public.invoices(id,company_id,client_profile_id,status,invoice_number,issued_at,subtotal_cents,total_cents,created_by_profile_id,updated_by_profile_id)
values(pg_temp.h(50),pg_temp.h(10),pg_temp.h(2),'paid',99100215,'2020-01-01 00:00:00+00',2000,2000,pg_temp.h(1),pg_temp.h(1));
insert into public.invoice_items(id,invoice_id,service_id,order_id,position,name,quantity,unit_price_cents,fulfillment_status)
values(pg_temp.h(51),pg_temp.h(50),pg_temp.h(20),pg_temp.h(30),0,'Shared historical service',2,1000,'provisioned');
insert into private.spp_invoice_item_orders(order_id,invoice_item_id,source_order_reference)
values(pg_temp.h(30),pg_temp.h(51),'CAFE0201_1'),(pg_temp.h(31),pg_temp.h(51),'CAFE0201_2');
select throws_ok($$insert into private.spp_invoice_item_orders values(pg_temp.h(32),pg_temp.h(51),'CAFE0201_3')$$,'23514',null,'reject another company');
select throws_ok($$insert into private.spp_invoice_item_orders values(pg_temp.h(33),pg_temp.h(51),'CAFE0201_4')$$,'23514',null,'reject another service');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.h(1)::text,true);
select is(jsonb_array_length(public.app_get_invoice_order_history(pg_temp.h(50))->'order_ids'),2,'native link counted once alongside second verified order before any payment');
select is((public.app_find_invoice_item_by_order_id(pg_temp.h(31))).order_id,pg_temp.h(31),'inverse shared link identifies the requested order');
select is((public.app_find_invoice_item_by_order_id(pg_temp.h(31))).id,pg_temp.h(51),'inverse shared link returns the one native line');
select is((select count(*) from public.app_list_invoice_items(pg_temp.h(50))),1::bigint,'linked siblings never multiply the commercial line');
select set_config('request.jwt.claim.sub',pg_temp.h(4)::text,true);
select is(public.app_get_invoice_order_history(pg_temp.h(50))->'order_ids',jsonb_build_array(pg_temp.h(30)),
  'staff assigned only the primary order cannot discover its sibling');
select is(public.app_get_invoice_order_history(pg_temp.h(50))->'shared_orders',jsonb_build_array(jsonb_build_object(
  'order_id',pg_temp.h(30),'invoice_item_id',pg_temp.h(51),'source_order_reference','CAFE0201_1')),
  'primary order still carries the shared-line indicator');
select set_config('request.jwt.claim.sub',pg_temp.h(3)::text,true);
select throws_ok($$select public.app_get_invoice_order_history(pg_temp.h(50))$$,'42501',null,'other client cannot enumerate invoice associations');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into private.spp_payment_history(payment_id,invoice_id,source_invoice_id,source_provider,source_payment_id,created_by_profile_id,request_id,amount_cents,currency,settled_at)
values(pg_temp.h(52),pg_temp.h(50),'fixture-invoice','Test provider','fixture-transaction',pg_temp.h(1),pg_temp.h(54),1900,'USD','2020-01-02 00:00:00+00');
select throws_ok($$insert into public.invoice_payments(id,invoice_id,amount_cents,currency,status,payment_method,processor,processor_reference,request_id,created_by_profile_id,settled_at)
 values(pg_temp.h(52),pg_temp.h(50),2000,'USD','succeeded','other','spp_history','fixture-transaction',pg_temp.h(54),pg_temp.h(1),'2020-01-02 00:00:00+00')$$,
 '23514',null,'reservation rejects unexpected settlement amount');
insert into public.invoice_payments(id,invoice_id,amount_cents,currency,status,payment_method,processor,processor_reference,request_id,created_by_profile_id,settled_at)
values(pg_temp.h(52),pg_temp.h(50),1900,'USD','succeeded','other','spp_history','fixture-transaction',pg_temp.h(54),pg_temp.h(1),'2020-01-02 00:00:00+00');
select is((select count(*) from public.notifications where event_key='invoice-payment:'||pg_temp.h(52)),0::bigint,'historical settlement emits no notification');
select ok(not exists(select 1 from private.push_deliveries d join public.notifications n on n.id=d.notification_id
  where n.event_key='invoice-payment:'||pg_temp.h(52)),'no payment push delivery is queued');
insert into public.invoice_payments(id,invoice_id,amount_cents,currency,status,payment_method,request_id,created_by_profile_id,settled_at)
values(pg_temp.h(53),pg_temp.h(50),100,'USD','succeeded','manual',pg_temp.h(55),pg_temp.h(1),'2020-01-03 00:00:00+00');
select ok(exists(select 1 from public.notifications where event_key='invoice-payment:'||pg_temp.h(53)),'unreserved operational settlement still emits its notification');
select throws_ok($$update private.spp_payment_history set source_payment_id='different' where payment_id=pg_temp.h(52)$$,
 '23514',null,'existing native payment identity cannot be misattributed');
set constraints all immediate;

select * from finish();
rollback;
