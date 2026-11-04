-- Pending execution on an authorized isolated synthetic Supabase target.
begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000002041','order-call-foreign-204','Synthetic foreign calls workspace','active');
insert into public.companies(id,tenant_id,name,status) values
 ('e0000000-0000-4000-8000-000000002041','f0f0f0f0-0000-4000-8000-000000002041','Synthetic foreign calls client','client');
insert into public.services(id,tenant_id,name) values
 ('e2040000-0000-4000-8000-000000002041','f0f0f0f0-0000-4000-8000-000000002041','Synthetic foreign call service');
insert into public.orders(id,tenant_id,company_id,service_id,title,status) values
 ('e2040000-0000-4000-8000-000000002041','f0f0f0f0-0000-4000-8000-000000002041','e0000000-0000-4000-8000-000000002041','e2040000-0000-4000-8000-000000002041','Synthetic foreign order','working');
insert into public.services(id,tenant_id,name) values
 ('e2040000-0000-4000-8000-000000000001','f0f0f0f0-0000-4000-8000-000000001701','Synthetic order-call service');
insert into public.orders(id,tenant_id,company_id,service_id,title,status,assigned_to_profile_id)
 select ('e2040000-0000-4000-8000-00000000000'||n)::uuid,'f0f0f0f0-0000-4000-8000-000000001701',
 'e0000000-0000-4000-8000-000000001701','e2040000-0000-4000-8000-000000000001','Synthetic order-call project','working',
 '20000000-0000-4000-8000-000000001704' from unnest(array['2','3']) n;
update public.tickets set order_id='e2040000-0000-4000-8000-000000000003' where id='e1700000-0000-4000-8000-000000001701';
insert into public.order_tasks(order_id,title,assigned_to_profile_id) values
 ('e2040000-0000-4000-8000-000000000002','Synthetic second assigned participant','20000000-0000-4000-8000-000000001705');
create function pg_temp.order_call_actor(n text default '1701') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,'role','authenticated',
   'session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
 perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.native_invite(n text) returns jsonb language sql as $$
 select public.app_request_order_call('e2040000-0000-4000-8000-000000000002',('71000000-0000-4000-8000-00000000'||n)::uuid,
   '72000000-0000-4000-8000-000000002041','audio','20000000-0000-4000-8000-000000001704');
$$;
create function pg_temp.order_call_id(n text) returns uuid language sql security definer set search_path='' as $$
 select id from private.ticket_calls where request_id=('71000000-0000-4000-8000-00000000'||n)::uuid;
$$;
select ok(not has_function_privilege('anon','public.app_request_order_call(uuid,uuid,uuid,text,uuid)','execute'),'anonymous native call denied');
select ok(not has_function_privilege('authenticated','private.request_conversation_call(uuid,uuid,uuid,uuid,text,uuid)','execute'),'shared admission remains private');
select pg_temp.order_call_actor(); set local role authenticated;
select throws_ok($$select public.app_order_call_current('e2040000-0000-4000-8000-000000002041')$$,'42501',null,'foreign workspace order is denied');
select throws_ok($$select public.app_order_call_history('e2040000-0000-4000-8000-000000002041')$$,'42501',null,'foreign workspace history is denied');
select throws_ok($$select public.app_request_order_call('e2040000-0000-4000-8000-000000002041',extensions.gen_random_uuid(),extensions.gen_random_uuid(),'audio','20000000-0000-4000-8000-000000001704')$$,'42501',null,'foreign workspace native call is denied');
select is(public.app_order_call_current('e2040000-0000-4000-8000-000000000003')->>'ticketId','e1700000-0000-4000-8000-000000001701','legacy order resolves actual linked Ticket');
select ok(not (public.app_ticket_call_current('e1700000-0000-4000-8000-000000001701') ? 'orderId'),'currently serving strict availability root remains compatible before app promotion');
select is(public.app_order_call_prepare('e2040000-0000-4000-8000-000000000003')->>'orderId','e2040000-0000-4000-8000-000000000003','new linked-order prepare restores explicit order target');
select is(public.app_order_call_current('e2040000-0000-4000-8000-000000000002')->>'ticketId',null::text,'native order never masquerades as a Ticket ID');
select is(jsonb_array_length(public.app_order_call_prepare('e2040000-0000-4000-8000-000000000002')->'candidates'),2,'only eligible order/task assignees are offered');
select throws_ok($$select public.app_request_ticket_call('e2040000-0000-4000-8000-000000000002',extensions.gen_random_uuid(),extensions.gen_random_uuid(),'audio','20000000-0000-4000-8000-000000001704')$$,'42501',null,'native UUID is not accepted by Ticket request');
select is(pg_temp.native_invite('2041')->>'state','ringing','native order uses genuine ringing lifecycle');
select is(pg_temp.native_invite('2041')->>'id',pg_temp.order_call_id('2041')::text,'exact retry returns same native call');
reset role;
select pg_temp.order_call_actor('1702'); set local role authenticated;
select is(public.app_request_order_call('e2040000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000002044',
 '72000000-0000-4000-8000-000000002044','audio','20000000-0000-4000-8000-000000001705')->>'outcome','busy','disjoint pair receives logged busy without call waiting');
reset role;
select is((select count(*) from private.ticket_call_reservations where call_id=pg_temp.order_call_id('2044')),0::bigint,'busy native attempt reserves no provider budget');
select pg_temp.order_call_actor(); set local role authenticated;
reset role;
select throws_ok($q$insert into private.ticket_calls(id,request_id,order_id,tenant_id,initiated_by,callee_profile_id,direction,mode,
 participants,created_at,expires_at,state,caller_session_id,caller_device_id,ring_deadline,legacy)
 values(extensions.gen_random_uuid(),extensions.gen_random_uuid(),'e2040000-0000-4000-8000-000000000002',
 'f0f0f0f0-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001702','20000000-0000-4000-8000-000000001703',
 'client_to_team','audio',array['20000000-0000-4000-8000-000000001702'::uuid,'20000000-0000-4000-8000-000000001703'::uuid],
 now(),now()+interval '15 minutes','ringing','33000000-0000-4000-8000-000000001702',extensions.gen_random_uuid(),now()+interval '40 seconds',false)$q$,
 '23505',null,'disjoint participants cannot create a second live call in one native order');
set local role authenticated;
select is(jsonb_array_length(public.app_order_call_history('e2040000-0000-4000-8000-000000000002')),1,'participant sees native history');
select is(public.app_ticket_call_command('cancel',pg_temp.order_call_id('2041'))->>'ended','true','existing cleanup path ends native call');
reset role;
select is((select count(*) from private.ticket_calls where order_id='e2040000-0000-4000-8000-000000000002' and ticket_id is null and request_id='71000000-0000-4000-8000-000000002041'),1::bigint,'one accepted native request row, no fake Ticket');
select is((select count(*) from public.tickets where order_id='e2040000-0000-4000-8000-000000000002'),0::bigint,'request creates no Ticket');
select pg_temp.order_call_actor('1703'); set local role authenticated;
select is(jsonb_array_length(public.app_order_call_history('e2040000-0000-4000-8000-000000000002')),0,'authorized nonparticipant cannot read another call history');
reset role;
update private.ticket_call_environment set pilot_profile_ids=array['20000000-0000-4000-8000-000000001704'::uuid];
select pg_temp.order_call_actor(); set local role authenticated;
select throws_ok($$select pg_temp.native_invite('2042')$$,'42501',null,'native support preserves pilot exclusion');
reset role;
update private.ticket_call_environment set pilot_profile_ids=null;
-- The fixture transition must use an authorized Owner, not the prior Client JWT.
select pg_temp.order_call_actor('1703');
update public.orders set status='complete',completed_at=clock_timestamp() where id='e2040000-0000-4000-8000-000000000002';
select pg_temp.order_call_actor(); set local role authenticated;
select is(jsonb_array_length(public.app_order_call_history('e2040000-0000-4000-8000-000000000002')),1,'ended order preserves authorized historical calls');
select throws_ok($$select pg_temp.native_invite('2043')$$,'42501',null,'completed order cannot start a new call');
reset role;
select * from finish();
rollback;
