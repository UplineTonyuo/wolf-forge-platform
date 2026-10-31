-- Isolated Supabase only; synthetic rows and all state changes roll back.
begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000182'||n)::uuid,'authenticated','authenticated','client-reply-'||n||'@example.invalid',now(),now() from generate_series(1,5) n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001821','client-reply-a','Client Reply A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001822','client-reply-b','Client Reply B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('d0000000-0000-4000-8000-000000001821','f0f0f0f0-0000-4000-8000-000000001821','Synthetic A','client'),
 ('d0000000-0000-4000-8000-000000001822','f0f0f0f0-0000-4000-8000-000000001821','Synthetic Other A','client'),
 ('d0000000-0000-4000-8000-000000001823','f0f0f0f0-0000-4000-8000-000000001822','Synthetic B','client');
insert into public.services(id,tenant_id,name) values
 ('d1000000-0000-4000-8000-000000001821','f0f0f0f0-0000-4000-8000-000000001821','Synthetic A'),
 ('d1000000-0000-4000-8000-000000001822','f0f0f0f0-0000-4000-8000-000000001822','Synthetic B');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.account_class,r.id,v.company::uuid from (values
 ('f0f0f0f0-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal','owner',null),
 ('f0f0f0f0-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001822','client','client','d0000000-0000-4000-8000-000000001821'),
 ('f0f0f0f0-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001823','client','client','d0000000-0000-4000-8000-000000001821'),
 ('f0f0f0f0-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001824','client','client','d0000000-0000-4000-8000-000000001822'),
 ('f0f0f0f0-0000-4000-8000-000000001822','20000000-0000-4000-8000-000000001825','client','client','d0000000-0000-4000-8000-000000001823')
) v(tenant,profile,account_class,role_name,company) join public.roles r on r.name=v.role_name;
insert into public.orders(id,tenant_id,company_id,service_id,title) values
 ('d3000000-0000-4000-8000-000000001821','f0f0f0f0-0000-4000-8000-000000001821','d0000000-0000-4000-8000-000000001821','d1000000-0000-4000-8000-000000001821','Native'),
 ('d3000000-0000-4000-8000-000000001822','f0f0f0f0-0000-4000-8000-000000001821','d0000000-0000-4000-8000-000000001821','d1000000-0000-4000-8000-000000001821','Legacy'),
 ('d3000000-0000-4000-8000-000000001823','f0f0f0f0-0000-4000-8000-000000001821','d0000000-0000-4000-8000-000000001822','d1000000-0000-4000-8000-000000001821','Other company'),
 ('d3000000-0000-4000-8000-000000001824','f0f0f0f0-0000-4000-8000-000000001822','d0000000-0000-4000-8000-000000001823','d1000000-0000-4000-8000-000000001822','Foreign');
insert into public.tickets(id,tenant_id,order_id,company_id,subject) values
 ('d4000000-0000-4000-8000-000000001821','f0f0f0f0-0000-4000-8000-000000001821','d3000000-0000-4000-8000-000000001822','d0000000-0000-4000-8000-000000001821','Legacy');
create function pg_temp.act(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000182'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001821"}',true);
$$;
create function pg_temp.clear_actor() returns void language sql as $$ select set_config('request.jwt.claim.sub','',true); $$;
create function pg_temp.response(n integer) returns boolean language sql as $$
 select unanswered from public.app_list_my_order_response_states(array[('d3000000-0000-4000-8000-00000000182'||n)::uuid]);
$$;
select ok(not has_function_privilege('anon','public.app_list_my_order_response_states(uuid[])','execute'),'anonymous cannot execute');
select ok(not has_function_privilege('service_role','public.app_list_my_order_response_states(uuid[])','execute'),'service-role fallback not granted');
select ok(private.client_support_operation_allowed('/rest/v1/rpc/app_list_my_order_response_states','POST'),'delegation explicitly allows this client read');
select ok(not private.client_support_operation_allowed('/rest/v1/rpc/app_list_order_response_states','POST'),'delegation does not allow the internal metadata RPC');
select ok(not private.client_support_operation_allowed('/rest/v1/tenant_memberships','GET'),'raw membership read remains denied');
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select pg_temp.response(1)$$,'42501',null,'normal internal callers cannot use client metadata');
select pg_temp.act(2);
select is(pg_temp.response(1),false,'empty conversation has no unanswered staff reply');
select is((select count(*) from public.app_list_my_order_response_states('{}')),0::bigint,'empty authorized batch returns no rows');
select throws_ok($$select public.app_list_my_order_response_states(null)$$,'22023',null,'null input denied');
select throws_ok($$select public.app_list_my_order_response_states(array[null::uuid])$$,'22023',null,'null ID denied');
select throws_ok($$select public.app_list_my_order_response_states(array_fill('d3000000-0000-4000-8000-000000001821'::uuid,array[2001]))$$,'22023',null,'oversized batch denied');
select throws_ok($$select public.app_list_my_order_response_states(array[['d3000000-0000-4000-8000-000000001821'::uuid]])$$,'22023',null,'multidimensional input denied');
select is((select count(*) from public.app_list_my_order_response_states(array['d3000000-0000-4000-8000-000000001823'::uuid,'d3000000-0000-4000-8000-000000001824'::uuid])),0::bigint,'other-company and foreign-Tenant metadata excluded');
reset role;
select pg_temp.clear_actor();
insert into public.project_messages(order_id,author_type,body,created_at) values
 ('d3000000-0000-4000-8000-000000001821','system','Synthetic purchase',now()-interval '10 minutes');
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(1),false,'system purchase is not a staff request');
reset role;
select pg_temp.clear_actor();
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at) values
 ('d5000000-0000-4000-8000-000000001821','d3000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001822','client','Earlier client reply',now()-interval '8 minutes'),
 ('d5000000-0000-4000-8000-000000001822','d3000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal',chr(65532),now()-interval '7 minutes');
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(1),true,'staff voice or attachment-only message needs a client reply');
select is((select count(*) from public.app_list_my_order_response_states(array['d3000000-0000-4000-8000-000000001821'::uuid,'d3000000-0000-4000-8000-000000001821'::uuid])),1::bigint,'duplicate IDs return one row');
select is((select to_jsonb(r)-array['order_id','unanswered'] from public.app_list_my_order_response_states(array['d3000000-0000-4000-8000-000000001821'::uuid]) r),'{}'::jsonb,'only ID and flag leave database');
select is(pg_temp.response(1),true,'reading does not clear the client flag');
reset role;
select pg_temp.clear_actor();
insert into public.project_message_reactions(message_id,reactor_profile_id,reaction_code) values
 ('d5000000-0000-4000-8000-000000001822','20000000-0000-4000-8000-000000001822','like');
insert into public.project_messages(order_id,author_type,body,created_at) values
 ('d3000000-0000-4000-8000-000000001821','system','Later system update',now()-interval '6 minutes');
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(1),true,'system updates and reactions do not clear staff reply');
reset role;
select pg_temp.clear_actor();
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at) values
 ('d5000000-0000-4000-8000-000000001823','d3000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001823','client','Another authorized company member replies',now()-interval '5 minutes');
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(1),false,'a later public company-client reply clears it');
reset role;
select pg_temp.clear_actor();
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at) values
 ('d5000000-0000-4000-8000-000000001824','d3000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal','Same time later ID',now()-interval '5 minutes'),
 ('d5000000-0000-4000-8000-000000001825','d3000000-0000-4000-8000-000000001822','20000000-0000-4000-8000-000000001821','internal','Native branch is ignored when linked',now());
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(1),true,'equal timestamps use deterministic descending message ID');
select is(pg_temp.response(2),false,'linked Ticket wins over conflicting native history');
reset role;
select pg_temp.clear_actor();
insert into public.ticket_messages(id,ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at) values
 ('d6000000-0000-4000-8000-000000001821','d4000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal','reply','client','Public staff request',now()-interval '4 minutes'),
 ('d6000000-0000-4000-8000-000000001822','d4000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001822','client','reply','client','Client response',now()-interval '3 minutes'),
 ('d6000000-0000-4000-8000-000000001823','d4000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal','internal_note','internal','Private note',now()-interval '2 minutes');
insert into public.ticket_messages(ticket_id,author_type,message_kind,visibility,body,created_at) values
 ('d4000000-0000-4000-8000-000000001821','system','reply','client','System event',now()-interval '1 minute'),
 ('d4000000-0000-4000-8000-000000001821','guest','reply','client','Guest event',now());
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(2),false,'private notes, systems and guests never become unanswered staff messages');
reset role;
select pg_temp.clear_actor();
insert into public.ticket_messages(id,ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at) values
 ('d6000000-0000-4000-8000-000000001824','d4000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal','reply','client','Follow-up staff request',now()+interval '1 minute');
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(2),true,'a public Ticket staff follow-up sets the client flag');
reset role;
select pg_temp.clear_actor();
insert into public.ticket_messages(ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at,unsent_at,unsent_by_profile_id) values
 ('d4000000-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001821','internal','internal_note','internal','This note was unsent.',now()+interval '2 minutes',now(),'20000000-0000-4000-8000-000000001821');
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(2),true,'unsent private notes cannot clear a public staff request');
reset role;
select pg_temp.act(1);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001821','20000000-0000-4000-8000-000000001822','tickets.view',false);
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select pg_temp.response(1)$$,'42501',null,'current communication denial does not become answered');
reset role;
select pg_temp.act(1);
delete from public.profile_permission_overrides where tenant_id='f0f0f0f0-0000-4000-8000-000000001821' and profile_id='20000000-0000-4000-8000-000000001822';
select pg_temp.clear_actor();
update public.orders set archived_at=now() where id='d3000000-0000-4000-8000-000000001821';
select pg_temp.act(2);
set local role authenticated;
select is((select count(*) from public.app_list_my_order_response_states(array['d3000000-0000-4000-8000-000000001821'::uuid])),0::bigint,'archived Orders excluded');
reset role;
select pg_temp.clear_actor();
update public.profiles set archived_at=now() where id='20000000-0000-4000-8000-000000001822';
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select pg_temp.response(2)$$,'42501',null,'archived client identity denied');
reset role;
select pg_temp.clear_actor();
update public.profiles set archived_at=null where id='20000000-0000-4000-8000-000000001822';
update public.companies set archived_at=now() where id='d0000000-0000-4000-8000-000000001821';
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select pg_temp.response(2)$$,'42501',null,'archived client company denied');
reset role;
select pg_temp.clear_actor();
update public.companies set archived_at=null where id='d0000000-0000-4000-8000-000000001821';
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001821' and profile_id='20000000-0000-4000-8000-000000001822';
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select pg_temp.response(2)$$,'42501',null,'revoked membership denied');
reset role;
select * from finish();
rollback;
