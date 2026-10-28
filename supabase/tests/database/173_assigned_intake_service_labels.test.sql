begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b1730000-0000-4000-8000-00000000000'||n)::uuid,
  'authenticated','authenticated','service-label-'||n||'@example.invalid',now(),now()
from generate_series(1,5) n;
insert into public.tenants(id,slug,display_name,status) values
('b1730000-0000-4000-8000-000000000010','service-label-a','Service labels A','active'),
('b1730000-0000-4000-8000-000000000011','service-label-b','Service labels B','active');
insert into public.companies(id,tenant_id,name,status) values
('b1730000-0000-4000-8000-000000000020','b1730000-0000-4000-8000-000000000010','Label buyer A','client'),
('b1730000-0000-4000-8000-000000000021','b1730000-0000-4000-8000-000000000011','Label buyer B','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant_id::uuid,v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
('b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000001','internal','owner',null),
('b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000002','client','client','b1730000-0000-4000-8000-000000000020'),
('b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000003','client','client','b1730000-0000-4000-8000-000000000020'),
('b1730000-0000-4000-8000-000000000011','b1730000-0000-4000-8000-000000000004','client','client','b1730000-0000-4000-8000-000000000021'),
('b1730000-0000-4000-8000-000000000011','b1730000-0000-4000-8000-000000000005','internal','owner',null)
) v(tenant_id,profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring,sort_order) values
('b1730000-0000-4000-8000-000000000031','b1730000-0000-4000-8000-000000000010','Google Business Review',10,'USD',true,false,false,1),
('b1730000-0000-4000-8000-000000000032','b1730000-0000-4000-8000-000000000010','GMB Optimization',10,'USD',true,false,false,2),
('b1730000-0000-4000-8000-000000000033','b1730000-0000-4000-8000-000000000011','Foreign purchased service',10,'USD',true,false,false,1);
insert into public.orders(id,tenant_id,company_id,service_id,title) values
('b1730000-0000-4000-8000-000000000041','b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000020','b1730000-0000-4000-8000-000000000031','Customized order one'),
('b1730000-0000-4000-8000-000000000042','b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000020','b1730000-0000-4000-8000-000000000032','Customized order two'),
('b1730000-0000-4000-8000-000000000043','b1730000-0000-4000-8000-000000000011','b1730000-0000-4000-8000-000000000021','b1730000-0000-4000-8000-000000000033','Foreign customized order');

create function pg_temp.act(n integer, tenant text default 'b1730000-0000-4000-8000-000000000010')
returns void language sql as $$
select set_config('request.jwt.claim.sub','b1730000-0000-4000-8000-00000000000'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.intake_definition(service_ids uuid[])
returns jsonb language sql as $$
select jsonb_build_object('name','Shared GMB intake','title','Intake Form for GMB Services','visibility','assigned',
  'type_config','{}'::jsonb,'fields',jsonb_build_array(jsonb_build_object('stable_field_key',gen_random_uuid(),
    'sort_order',0,'field_type','text','label','Business name','required',true)),
  'rules','[]'::jsonb,'service_links',(select jsonb_agg(jsonb_build_object('service_id',id,
    'role','intake_assignment','sort_order',ordinality-1)) from unnest(service_ids) with ordinality ids(id,ordinality)));
$$;
create temp table labels173_ids(label text primary key,id uuid);
grant all on labels173_ids to authenticated;

set local role authenticated;
select pg_temp.act(1);
insert into labels173_ids select 'form-a',(public.app_create_form(gen_random_uuid(),jsonb_build_object(
  'form_type','intake','canonical_key','service-label-173-a','definition',pg_temp.intake_definition(array[
    'b1730000-0000-4000-8000-000000000031','b1730000-0000-4000-8000-000000000032']::uuid[])))).id;
select public.app_publish_form(gen_random_uuid(),id) from labels173_ids where label='form-a';
insert into labels173_ids select v.label,(public.app_assign_form(gen_random_uuid(),
  (select id from labels173_ids where label='form-a'),jsonb_build_object('order_id',v.order_id,
  'client_profile_id','b1730000-0000-4000-8000-000000000002'))).id
from (values ('review','b1730000-0000-4000-8000-000000000041'),('optimization','b1730000-0000-4000-8000-000000000042')) v(label,order_id);
select pg_temp.act(5,'b1730000-0000-4000-8000-000000000011');
insert into labels173_ids select 'form-b',(public.app_create_form(gen_random_uuid(),jsonb_build_object(
  'form_type','intake','canonical_key','service-label-173-b','definition',pg_temp.intake_definition(array[
    'b1730000-0000-4000-8000-000000000033']::uuid[])))).id;
select public.app_publish_form(gen_random_uuid(),id) from labels173_ids where label='form-b';
insert into labels173_ids select 'foreign',(public.app_assign_form(gen_random_uuid(),
  (select id from labels173_ids where label='form-b'),jsonb_build_object('order_id','b1730000-0000-4000-8000-000000000043',
  'client_profile_id','b1730000-0000-4000-8000-000000000004'))).id;
reset role;

select ok(not has_function_privilege('anon','public.app_get_assigned_form_service_labels(uuid[])','execute'),'anonymous callers cannot read assignment labels');
select ok(not has_function_privilege('service_role','public.app_get_assigned_form_service_labels(uuid[])','execute'),'service role has no bypass grant');
select ok(has_function_privilege('authenticated','public.app_get_assigned_form_service_labels(uuid[])','execute'),'signed-in callers use the scoped projection');
set local role authenticated;
select pg_temp.act(2);
select is((select service_name from public.app_get_assigned_form_service_labels(array[(select id from labels173_ids where label='review')])),
  'Google Business Review','shared form uses the first assigned order actual Service');
select is((select service_name from public.app_get_assigned_form_service_labels(array[(select id from labels173_ids where label='optimization')])),
  'GMB Optimization','same shared form keeps the other purchased Service distinct');
select is((select count(*) from public.app_get_assigned_form_service_labels((select array_agg(id) from labels173_ids))),2::bigint,
  'other Tenant assignments and arbitrary form IDs do not disclose labels');
select is((select count(*) from public.app_get_assigned_form_service_labels('{}'::uuid[])),0::bigint,'empty batch is harmless');
select throws_ok($q$select * from public.app_get_assigned_form_service_labels(null)$q$,'22023',null,'null batch refuses');
select throws_ok($q$select * from public.app_get_assigned_form_service_labels(array_fill('b1730000-0000-4000-8000-000000000041'::uuid,array[101]))$q$,
  '22023',null,'request batches are bounded to 100');
select throws_ok($q$select * from public.app_get_assigned_form_service_labels(array[null]::uuid[])$q$,'22023',null,'null IDs refuse');
select pg_temp.act(3);
select is((select count(*) from public.app_get_assigned_form_service_labels((select array_agg(id) from labels173_ids))),0::bigint,
  'another client in the same Company cannot see the assigned client labels');
select pg_temp.act(4,'b1730000-0000-4000-8000-000000000011');
select is((select count(*) from public.app_get_assigned_form_service_labels((select array_agg(id) from labels173_ids))),1::bigint,
  'foreign Tenant client sees only their own assigned Service');
select pg_temp.act(2,'b1730000-0000-4000-8000-000000000011');
select throws_ok($q$select * from public.app_get_assigned_form_service_labels((select array_agg(id) from labels173_ids))$q$,
  '42501',null,'switching to a nonmember Tenant refuses');
reset role;

insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000002','projects.view',false);
set local role authenticated;
select pg_temp.act(2);
select ok((select bool_and(order_id is null) from public.app_list_assigned_forms()),'existing assignment projection redacts Order pointers after Projects permission loss');
select is((select count(*) from public.app_get_assigned_form_service_labels((select array_agg(id) from labels173_ids))),2::bigint,
  'Service labels remain attached to independently authorized retained intake assignments');
select is((select title from public.app_list_assigned_forms() where assignment_id=(select id from labels173_ids where label='review')),
  'Intake Form for GMB Services','display labels do not rewrite immutable published Form title');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('b1730000-0000-4000-8000-000000000010','b1730000-0000-4000-8000-000000000002','forms.view',false);
set local role authenticated;
select pg_temp.act(2);
select throws_ok($q$select * from public.app_get_assigned_form_service_labels((select array_agg(id) from labels173_ids))$q$,
  '42501',null,'revoked Forms authority cannot retain a service-label read');
reset role;
select * from finish();
rollback;
