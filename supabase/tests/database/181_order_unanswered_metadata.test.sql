-- Run only against an isolated full Supabase schema; every fixture rolls back.
begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000181'||n)::uuid,'authenticated','authenticated','unanswered-'||n||'@example.invalid',now(),now() from generate_series(1,5) n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001811','unanswered-a','Unanswered A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001812','unanswered-b','Unanswered B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('d0000000-0000-4000-8000-000000001811','f0f0f0f0-0000-4000-8000-000000001811','Synthetic A','client'),
 ('d0000000-0000-4000-8000-000000001812','f0f0f0f0-0000-4000-8000-000000001812','Synthetic B','client');
insert into public.services(id,tenant_id,name) values
 ('d1000000-0000-4000-8000-000000001811','f0f0f0f0-0000-4000-8000-000000001811','Synthetic A'),
 ('d1000000-0000-4000-8000-000000001812','f0f0f0f0-0000-4000-8000-000000001812','Synthetic B');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.account_class,r.id,v.company::uuid from (values
 ('f0f0f0f0-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001811','internal','owner',null),
 ('f0f0f0f0-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001812','internal','manager',null),
 ('f0f0f0f0-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001813','internal','staff',null),
 ('f0f0f0f0-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001814','client','client','d0000000-0000-4000-8000-000000001811'),
 ('f0f0f0f0-0000-4000-8000-000000001812','20000000-0000-4000-8000-000000001815','internal','owner',null)
) v(tenant,profile,account_class,role_name,company) join public.roles r on r.name=v.role_name;
insert into public.orders(id,tenant_id,company_id,service_id,title,assigned_to_profile_id) values
 ('d3000000-0000-4000-8000-000000001811','f0f0f0f0-0000-4000-8000-000000001811','d0000000-0000-4000-8000-000000001811','d1000000-0000-4000-8000-000000001811','Native','20000000-0000-4000-8000-000000001813'),
 ('d3000000-0000-4000-8000-000000001812','f0f0f0f0-0000-4000-8000-000000001811','d0000000-0000-4000-8000-000000001811','d1000000-0000-4000-8000-000000001811','Legacy',null),
 ('d3000000-0000-4000-8000-000000001813','f0f0f0f0-0000-4000-8000-000000001812','d0000000-0000-4000-8000-000000001812','d1000000-0000-4000-8000-000000001812','Foreign',null);
insert into public.tickets(id,tenant_id,order_id,company_id,subject) values
 ('d4000000-0000-4000-8000-000000001811','f0f0f0f0-0000-4000-8000-000000001811','d3000000-0000-4000-8000-000000001812','d0000000-0000-4000-8000-000000001811','Legacy');
create function pg_temp.act(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000181'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001811"}',true);
$$;
create function pg_temp.response(n integer) returns boolean language sql as $$
 select unanswered from public.app_list_order_response_states(array[('d3000000-0000-4000-8000-00000000181'||n)::uuid]);
$$;
select ok(not has_function_privilege('anon','public.app_list_order_response_states(uuid[])','execute'),'anonymous cannot call metadata RPC');
select ok(not has_function_privilege('service_role','public.app_list_order_response_states(uuid[])','execute'),'service-role fallback not granted');
select pg_temp.act(1);
set local role authenticated;
select is(pg_temp.response(1),false,'no human message is answered');
select is((select count(*) from public.app_list_order_response_states('{}')),0::bigint,'empty batch returns no rows');
select throws_ok($$select public.app_list_order_response_states(null)$$,'22023',null,'null input refused');
select throws_ok($$select public.app_list_order_response_states(array[null::uuid])$$,'22023',null,'null ID refused');
select throws_ok($$select public.app_list_order_response_states(array_fill('d3000000-0000-4000-8000-000000001811'::uuid,array[2001]))$$,'22023',null,'more than 2000 requested IDs refused');
select throws_ok($$select public.app_list_order_response_states(array[['d3000000-0000-4000-8000-000000001811'::uuid]])$$,'22023',null,'multidimensional input refused');
reset role;
-- Direct synthetic fixture inserts intentionally avoid actual sends or delivery.
insert into public.project_messages(order_id,author_type,body,created_at) values
 ('d3000000-0000-4000-8000-000000001811','system','Synthetic purchase',now()-interval '10 minutes');
set local role authenticated;
select is(pg_temp.response(1),false,'system purchase does not create Unanswered');
reset role;
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at) values
 ('d5000000-0000-4000-8000-000000001811','d3000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001811','internal','Earlier team reply',now()-interval '8 minutes'),
 ('d5000000-0000-4000-8000-000000001812','d3000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001814','client',chr(65532),now()-interval '7 minutes');
set local role authenticated;
select is(pg_temp.response(1),true,'attachment or voice-only client message needs a reply');
select is((select count(*) from public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001811'::uuid,'d3000000-0000-4000-8000-000000001811'::uuid])),1::bigint,'duplicate IDs return one row');
select is((select to_jsonb(r) - array['order_id','unanswered'] from public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001811'::uuid]) r),'{}'::jsonb,'only order ID and response flag leave the database');
reset role;
insert into public.project_messages(order_id,author_type,body,created_at) values
 ('d3000000-0000-4000-8000-000000001811','system','Later system event',now()-interval '6 minutes');
insert into public.project_message_reactions(message_id,reactor_profile_id,reaction_code) values
 ('d5000000-0000-4000-8000-000000001812','20000000-0000-4000-8000-000000001811','like');
set local role authenticated;
select is(pg_temp.response(1),true,'system event and reaction do not clear Unanswered');
select is(pg_temp.response(1),true,'reading metadata does not clear Unanswered');
reset role;
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at) values
 ('d5000000-0000-4000-8000-000000001813','d3000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001811','internal','Public team reply',now()-interval '5 minutes');
set local role authenticated;
select is(pg_temp.response(1),false,'later public team reply clears Unanswered');
reset role;
insert into public.project_messages(id,order_id,author_profile_id,author_type,body,created_at) values
 ('d5000000-0000-4000-8000-000000001814','d3000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001814','client','Same timestamp, later ID',now()-interval '5 minutes');
set local role authenticated;
select is(pg_temp.response(1),true,'equal timestamps use the same deterministic ID order as the conversation');
reset role;
insert into public.project_messages(order_id,author_profile_id,author_type,body,created_at) values
 ('d3000000-0000-4000-8000-000000001812','20000000-0000-4000-8000-000000001814','client','Ignored native branch',now());
set local role authenticated;
select is(pg_temp.response(2),false,'an existing legacy Ticket wins over native history');
reset role;
insert into public.ticket_messages(ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at) values
 ('d4000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001814','client','initial_request','client','Legacy client request',now()-interval '4 minutes'),
 ('d4000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001811','internal','internal_note','internal','Private note',now()-interval '3 minutes');
insert into public.ticket_messages(ticket_id,author_type,message_kind,visibility,body,created_at) values
 ('d4000000-0000-4000-8000-000000001811','system','reply','client','System update',now()-interval '2 minutes'),
 ('d4000000-0000-4000-8000-000000001811','guest','reply','client','Guest is never staff',now()-interval '1 minute');
set local role authenticated;
select is(pg_temp.response(2),true,'legacy client request is not answered by notes, system or guests');
reset role;
insert into public.ticket_messages(ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at) values
 ('d4000000-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001811','internal','reply','client','Legacy public team reply',now());
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.response(2),false,'Manager sees authoritative reply metadata across workspace orders');
select is((select count(*) from public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001813'::uuid])),0::bigint,'foreign Tenant ID does not disclose metadata');
select pg_temp.act(3);
select is((select count(*) from public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001811'::uuid,'d3000000-0000-4000-8000-000000001812'::uuid])),1::bigint,'Staff retains assignment scope');
select pg_temp.act(4);
select throws_ok($$select public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001811'::uuid])$$,'42501',null,'Client cannot call internal response metadata');
reset role;
select pg_temp.act(1);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001811','20000000-0000-4000-8000-000000001812','tickets.view',false);
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001812'::uuid])$$,'42501',null,'Tickets view deny is not converted to answered or native fallback');
reset role;
select pg_temp.act(1);
delete from public.profile_permission_overrides where tenant_id='f0f0f0f0-0000-4000-8000-000000001811' and profile_id='20000000-0000-4000-8000-000000001812';
update public.orders set archived_at=now() where id='d3000000-0000-4000-8000-000000001812';
select pg_temp.act(2);
set local role authenticated;
select is((select count(*) from public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001812'::uuid])),0::bigint,'archived order metadata is excluded');
reset role;
select pg_temp.act(1);
select private.grant_platform_admin('20000000-0000-4000-8000-000000001811','Isolated Unanswered module checks');
-- Module disablement requires the isolated workspace's open work to be retired.
update public.tickets set archived_at=now() where id='d4000000-0000-4000-8000-000000001811';
update public.orders set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001811';
select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000001811',0,(select array_agg(module_key order by module_key) from private.white_label_modules where module_key not in ('projects','tickets')),'Disable isolated conversation modules');
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001811'::uuid])$$,'42501',null,'published module disablement denies metadata');
reset role;
select pg_temp.act(1);
select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000001811',1,(select array_agg(module_key order by module_key) from private.white_label_modules),'Restore isolated modules');
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001811' and profile_id='20000000-0000-4000-8000-000000001812';
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.app_list_order_response_states(array['d3000000-0000-4000-8000-000000001811'::uuid])$$,'42501',null,'revoked membership cannot keep metadata access');
reset role;
select * from finish();
rollback;
