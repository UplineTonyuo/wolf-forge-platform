begin;
select no_plan();
select has_table('private','spp_account_references','external references exist');
select ok(not has_table_privilege('authenticated','private.spp_account_references','SELECT'),'references are private');
select ok(not has_function_privilege('anon','public.app_spp_account_import(text,text,text,uuid,jsonb)','EXECUTE'),'anon denied');
select ok(not has_function_privilege('service_role','public.app_spp_account_import(text,text,text,uuid,jsonb)','EXECUTE'),'service role cannot bypass owner');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
('20000000-0000-4000-8000-000000002131','authenticated','authenticated','owner-import@example.com',now(),now()),
('20000000-0000-4000-8000-000000002133','authenticated','authenticated','client-import@example.com',now(),now());
update public.profiles set role_id=(select id from public.roles where name='owner') where id='20000000-0000-4000-8000-000000002131';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000002131","role":"authenticated"}',true);
select set_config('request.headers','{}',true);
set local role authenticated;
select is(public.app_spp_account_import('inspect')->>'state','ready','owner can inspect');
select is(public.app_spp_account_import('claim','101',encode(extensions.digest('ada-import@example.com','sha256'),'hex'))->>'state','claimed','durable claim precedes Auth');
select is(public.app_spp_account_import('claim','101',encode(extensions.digest('ada-import@example.com','sha256'),'hex'))->>'state','pending','uncertain attempt is never blindly retried');
select is(public.app_spp_account_import('claim','103',encode(extensions.digest('client-import@example.com','sha256'),'hex'))->>'state','conflict','an existing Auth account is never claimed');
reset role;

insert into auth.users (id,aud,role,email,email_confirmed_at,encrypted_password,created_at,updated_at)
values ('20000000-0000-4000-8000-000000002132','authenticated','authenticated','ada-import@example.com',now(),null,now(),now());
set local role authenticated;
select throws_ok($$
  select public.app_spp_account_import('complete','101',null,'20000000-0000-4000-8000-000000002132',
    '{"email":"ada-import@example.com","display_name":"Ada Synthetic","company_name":"Synthetic Studio"}')
$$,'42501','fresh claimed identity required','a passwordless identity without the server-owned claim is refused');
reset role;
update auth.users set encrypted_password='synthetic-generated-hash',
  raw_app_meta_data = jsonb_build_object('spp_import_claim_id',r.auth_claim_id)
from private.spp_account_references r
where auth.users.id='20000000-0000-4000-8000-000000002132' and r.spp_account_id='101';

-- A reachable notification emission fails this entire test, not just a mock assertion.
create or replace function private.emit_internal_notification_for_permission(
  p_required_permission_key text,p_event_key text,p_category text,p_variant text,p_title text,p_body text,p_href text,p_entity_type text,p_entity_id uuid,p_actor_profile_id uuid,p_company_id uuid,p_created_at timestamptz,p_exclude_profile_id uuid default null
) returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'notification path reached'; end;
$$;
set local role authenticated;
select is(public.app_spp_account_import('complete','101',null,'20000000-0000-4000-8000-000000002132',
'{"email":"ada-import@example.com","display_name":"Ada Synthetic","company_name":"Synthetic Studio","phone":null,"stripe_customer_id":"cus_test213"}')->>'state','complete','silent import binds the generated identity to its source claim');
select is(public.app_spp_account_import('claim','101',encode(extensions.digest('ada-import@example.com','sha256'),'hex'))->>'state','complete','second run skips imported source ID');
select is(public.app_spp_account_import('claim','102',encode(extensions.digest('ada-import@example.com','sha256'),'hex'))->>'state','complete','duplicate email creates no second identity');
select is(public.app_spp_account_import('claim','101',repeat('a',64))->>'state','conflict','source email disagreement is refused');
reset role;
select is((select count(*)::int from private.spp_account_references where spp_account_id in ('101','102')),1,'one canonical reference');
select ok((select bool_and(tenant_id=private.wolf_forge_tenant_id()) from private.spp_account_references),'references belong only to Wolf Forge');
select ok(exists(select 1 from public.tenant_memberships where profile_id='20000000-0000-4000-8000-000000002132' and tenant_id=private.wolf_forge_tenant_id() and account_class='client'),'client membership uses Wolf Forge');
select ok(exists(select 1 from public.client_contacts c join private.spp_account_references r on r.profile_id=c.profile_id and r.company_id=c.company_id where r.spp_account_id='101' and c.is_primary and c.tenant_id=r.tenant_id),'primary contact owns correct profile/company/tenant');
select is((select raw_app_meta_data->>'spp_import_claim_id' from auth.users where id='20000000-0000-4000-8000-000000002132'),
  (select auth_claim_id::text from private.spp_account_references where spp_account_id='101'),'Auth identity retained its server-owned claim');
select is((select count(*)::int from private.client_welcome_emails where profile_id='20000000-0000-4000-8000-000000002132'),0,'activation email never prepared');
insert into public.companies(id,name) values('c0000000-0000-4000-8000-000000002131','Synthetic Sentinel Company');
select throws_ok(format('select public.app_create_contact(extensions.gen_random_uuid(),%L::uuid,%L,null,null,null,null,true)','c0000000-0000-4000-8000-000000002131','Synthetic sentinel'),'P0001','notification path reached','ordinary primary-contact path proves sentinel is active');

insert into public.tenants(id,slug,display_name,status) values('f0f0f0f0-0000-4000-8000-000000002131','spp-test-other','Synthetic Other','active');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
select 'f0f0f0f0-0000-4000-8000-000000002131','20000000-0000-4000-8000-000000002131','internal',id from public.roles where name='owner';
select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002131"}',true);
set local role authenticated;
select throws_ok($$select public.app_spp_account_import('inspect')$$,'42501','SPP import requires the Wolf Forge owner','another Tenant owner is refused');
reset role;
select set_config('request.headers','{}',true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000002133","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.app_spp_account_import('inspect')$$,'42501',null,'a client cannot import');
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000002131","role":"authenticated"}',true);
set local role authenticated;
select is(public.app_spp_account_import('verify','101')->>'state','complete','fresh persisted readback succeeds');
select throws_ok($$select public.app_spp_account_import(null,'101')$$,'22023','invalid import operation','NULL operation never completes');
reset role;
select * from finish();
rollback;