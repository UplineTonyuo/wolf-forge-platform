begin;
select no_plan();
insert into public.tenants(id,slug,display_name,status) values
('f0f0f0f0-0000-4000-8000-000000001664','ticket-call-fixture','Isolated call fixture','active');
insert into public.companies(id,tenant_id,name,status) values
('e0000000-0000-4000-8000-000000001664','f0f0f0f0-0000-4000-8000-000000001664','Call client A','client'),
('e0000000-0000-4000-8000-000000001665','f0f0f0f0-0000-4000-8000-000000001664','Call client B','client');
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000'||n)::uuid,'authenticated','authenticated','call-'||n||'@example.invalid',now(),now()
from unnest(array['1664','1665','1666','1667']) n;
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000001664',('20000000-0000-4000-8000-00000000'||n)::uuid,'client',r.id,
  case when n='1665' then 'e0000000-0000-4000-8000-000000001665' else 'e0000000-0000-4000-8000-000000001664' end::uuid
from unnest(array['1664','1665','1667']) n cross join public.roles r where r.name='client';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
select 'f0f0f0f0-0000-4000-8000-000000001664','20000000-0000-4000-8000-000000001666','internal',id from public.roles where name='owner';
insert into auth.sessions(id,user_id,aal,not_after)
select ('33000000-0000-4000-8000-00000000'||n)::uuid,('20000000-0000-4000-8000-00000000'||n)::uuid,'aal1',now()+interval '1 day'
from unnest(array['1664','1665','1666','1667']) n;
insert into public.tickets(id,tenant_id,company_id,subject,status) values
('e1650000-0000-4000-8000-000000001664','f0f0f0f0-0000-4000-8000-000000001664','e0000000-0000-4000-8000-000000001664','Isolated call A','open'),
('e1650000-0000-4000-8000-000000001665','f0f0f0f0-0000-4000-8000-000000001664','e0000000-0000-4000-8000-000000001664','Isolated call B','open');
create function pg_temp.call_actor(n text default '1664') returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
  perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001664"}',true);
end $$;
create function pg_temp.call_op(action text, mode text default 'audio') returns jsonb language sql as $$
select public.app_ticket_call(action,'e1650000-0000-4000-8000-000000001664','71650000-0000-4000-8000-000000001664','71650000-0000-4000-8000-000000001664',mode);
$$;
select ok(not has_function_privilege('anon','public.app_ticket_call(text,uuid,uuid,uuid,text)','execute'),'anonymous callers cannot access calls');
select ok(not has_function_privilege('authenticated','public.app_complete_ticket_call_setup(uuid)','execute'),'users cannot assert provider setup');
select ok(has_function_privilege('service_role','public.app_complete_ticket_call_setup(uuid)','execute'),'only trusted setup boundary is exposed to service');
select pg_temp.call_actor();
set local role authenticated;
select throws_ok('select * from private.ticket_calls','42501',null,'call rows have no direct client access');
select is(pg_temp.call_op('status'),null::jsonb,'an empty conversation has no call');
select throws_ok($q$select pg_temp.call_op('reserve','invalid')$q$,'22023',null,'invalid media modes refuse before reservation');
select is(pg_temp.call_op('reserve')->>'created','true','first reservation durably owns room creation');
select is(pg_temp.call_op('reserve')->>'created','false','same request never owns another create attempt');
select throws_ok($q$select pg_temp.call_op('reserve','video')$q$,'22023',null,'request id cannot change mode');
select throws_ok($q$select pg_temp.call_op('join')$q$,'42501',null,'room is not joinable before trusted verification');
reset role;
select public.app_complete_ticket_call_setup('71650000-0000-4000-8000-000000001664');
set local role authenticated;
select lives_ok($q$select pg_temp.call_op('join')$q$,'creator joins only a verified room');
reset role;
select pg_temp.call_actor('1665'); set local role authenticated;
select throws_ok($q$select pg_temp.call_op('status')$q$,'42501',null,'foreign Company cannot discover the call');
select throws_ok($q$select pg_temp.call_op('join')$q$,'42501',null,'foreign Company cannot reserve a participant');
reset role;
select pg_temp.call_actor('1666'); set local role authenticated;
select lives_ok($q$select pg_temp.call_op('join')$q$,'authorized staff can join client call');
reset role;
select pg_temp.call_actor('1667'); set local role authenticated;
select throws_ok($q$select pg_temp.call_op('join')$q$,'42501',null,'a third authorized person cannot join');
reset role;
delete from auth.sessions where id='33000000-0000-4000-8000-000000001664';
select pg_temp.call_actor(); set local role authenticated;
select throws_ok($q$select pg_temp.call_op('join')$q$,'42501','Active session required','a signed-out session cannot mint a token');
reset role;
select is((select token_attempts from private.ticket_calls where id='71650000-0000-4000-8000-000000001664'),2,'only two authorized token attempts were reserved');
select pg_temp.call_actor('1666'); set local role authenticated;
select is(pg_temp.call_op('end')->>'endClaim','true','first end owns provider cleanup');
select is(pg_temp.call_op('end')->>'endClaim','false','end replay cannot repeat external mutations');
select throws_ok($q$select pg_temp.call_op('join')$q$,'42501',null,'ended calls cannot mint more tokens');
reset role;
insert into private.ticket_calls(id,ticket_id,tenant_id,initiated_by,mode,participants,state)
select ('71650000-0000-4000-8000-00000000'||n)::uuid,'e1650000-0000-4000-8000-000000001664','f0f0f0f0-0000-4000-8000-000000001664',
 '20000000-0000-4000-8000-000000001666','audio',array['20000000-0000-4000-8000-000000001666'::uuid],'ended'
from unnest(array['1671','1672','1673']) n;
set local role authenticated;
select throws_ok($q$select public.app_ticket_call('reserve','e1650000-0000-4000-8000-000000001665','71650000-0000-4000-8000-000000001665',null,'video')$q$,'P0001','Call usage limit reached','uncertain ended rooms keep their concurrency reservation until expiry');
reset role;
select is((select count(*) from private.ticket_calls where tenant_id='f0f0f0f0-0000-4000-8000-000000001664'),4::bigint,'refused creation adds no room reservation');
select * from finish();
rollback;
