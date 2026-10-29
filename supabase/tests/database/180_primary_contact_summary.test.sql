begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000180'||n)::uuid,'authenticated','authenticated','primary-contact-'||n||'@example.invalid',now(),now() from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001800','contact-read-a','Contact QA A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001801','contact-read-b','Contact QA B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('d0000000-0000-4000-8000-000000001800','f0f0f0f0-0000-4000-8000-000000001800','Contact QA A','client'),
 ('d0000000-0000-4000-8000-000000001801','f0f0f0f0-0000-4000-8000-000000001801','Contact QA B','client'),
 ('d0000000-0000-4000-8000-000000001802','f0f0f0f0-0000-4000-8000-000000001800','No contact QA','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.account_class,r.id,v.company::uuid from (values
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001801','internal','manager',null),
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001802','internal','staff',null),
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001803','client','client','d0000000-0000-4000-8000-000000001800'),
 ('f0f0f0f0-0000-4000-8000-000000001801','20000000-0000-4000-8000-000000001804','internal','manager',null),
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001805','internal','owner',null),
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001806','internal','admin',null)
) v(tenant,profile,account_class,role_name,company) join public.roles r on r.name=v.role_name;
insert into public.client_contacts(id,tenant_id,company_id,name,email,phone,job_title,is_primary) values
 ('d1000000-0000-4000-8000-000000001800','f0f0f0f0-0000-4000-8000-000000001800','d0000000-0000-4000-8000-000000001800','Synthetic Primary','primary@example.invalid','+1 555 0100','Coordinator',true),
 ('d1000000-0000-4000-8000-000000001801','f0f0f0f0-0000-4000-8000-000000001800','d0000000-0000-4000-8000-000000001800','Alternate Contact','alternate@example.invalid',null,null,false);
create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000001800') returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000180'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
select pg_temp.act(1);
set local role authenticated;
select is((select name from public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')),'Synthetic Primary','Manager reads the existing primary contact');
select is((select email from public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')),'primary@example.invalid','Manager reads primary email');
select is((select phone from public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')),'+1 555 0100','Manager reads primary phone');
select is((select job_title from public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')),'Coordinator','Manager reads primary job title');
select is((select count(*) from public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001802')),0::bigint,'missing contact remains empty');
select is((select count(*) from jsonb_object_keys((select to_jsonb(c) from public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800') c))),4::bigint,'projection contains exactly four fields');
select is((select count(*) from public.client_contacts where company_id='d0000000-0000-4000-8000-000000001800'),0::bigint,'Manager raw contact RLS stays restricted');
select is(public.app_has_permission('client_private.read'),false,'Manager gets no private read authority');
select is(public.app_has_permission('client_private.manage'),false,'Manager gets no private management authority');
select throws_ok($$select public.app_update_contact('d1000000-0000-4000-8000-000000001800','{"phone":"Changed"}')$$,'42501',null,'Manager contact editing is still denied');
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001801')$$,'P0002',null,'Manager cannot read another Tenant');
select pg_temp.act(2);
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'unauthorized Staff is denied');
select pg_temp.act(3);
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'Client cannot call internal contact reader');
select pg_temp.act(4,'f0f0f0f0-0000-4000-8000-000000001800');
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'membership in another Tenant does not authorize a header switch');
select pg_temp.act(5);
select lives_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'Owner reads primary contact');
select pg_temp.act(6);
select lives_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'Admin reads primary contact');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001801','clients.contact_read',false);
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'explicit contact-read deny is honored');
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from public.profile_permission_overrides where profile_id='20000000-0000-4000-8000-000000001801' and permission_key='clients.contact_read';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001800','20000000-0000-4000-8000-000000001801','clients.view',false);
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'explicit Clients view denial is honored');
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from public.profile_permission_overrides where profile_id='20000000-0000-4000-8000-000000001801';
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000001801';
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'archived Manager membership is denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.tenant_memberships set archived_at=null where profile_id='20000000-0000-4000-8000-000000001801';
update public.profiles set archived_at=now() where id='20000000-0000-4000-8000-000000001801';
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_get_primary_contact_summary('d0000000-0000-4000-8000-000000001800')$$,'42501',null,'archived Manager profile is denied at the RPC');
reset role;
select ok(not has_function_privilege('anon','public.app_get_primary_contact_summary(uuid)','EXECUTE'),'anonymous execution denied');
select ok(not has_function_privilege('service_role','public.app_get_primary_contact_summary(uuid)','EXECUTE'),'no server-role shortcut');
select * from finish();
rollback;
