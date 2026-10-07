begin;

select plan(46);

-- WL-2.7 (KI-111, Services + investment intents): every Service, Service
-- folder and investment intent operation requires the row to belong to the
-- caller's current Tenant; a foreign row behaves like a missing one.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001401.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1401 WF admin; 1402 B admin (WF archived); 1403 WF owner; 1404 B owner (WF
-- archived); 1405 owner of both; 1406 B admin with an archived B membership (WF
-- archived); 1407 WF client of the WF Client; 1408 B client of the B Client (WF
-- archived).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'service-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1401', '1402', '1403', '1404', '1405', '1406', '1407', '1408']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001401', 'service-authz-tenant-b', 'Service Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e0000000-0000-4000-8000-000000001401', private.wolf_forge_tenant_id(), 'Service WF Client', 'client'),
  ('e0000000-0000-4000-8000-000000001402', 'f0f0f0f0-0000-4000-8000-000000001401', 'Service B Client', 'client');

insert into public.service_folders (id, tenant_id, name)
values
  ('e1000000-0000-4000-8000-000000001401', private.wolf_forge_tenant_id(), 'WF Folder'),
  ('e1000000-0000-4000-8000-000000001402', 'f0f0f0f0-0000-4000-8000-000000001401', 'B Folder');

insert into public.services (id, tenant_id, folder_id, name, price, is_active, is_public)
values
  ('e2000000-0000-4000-8000-000000001401', private.wolf_forge_tenant_id(),
   'e1000000-0000-4000-8000-000000001401', 'WF Service', 10, true, true),
  ('e2000000-0000-4000-8000-000000001402', 'f0f0f0f0-0000-4000-8000-000000001401',
   'e1000000-0000-4000-8000-000000001402', 'B Service', 20, true, true);

insert into public.service_interests (id, tenant_id, company_id, service_id)
values
  ('e3000000-0000-4000-8000-000000001401', private.wolf_forge_tenant_id(),
   'e0000000-0000-4000-8000-000000001401', 'e2000000-0000-4000-8000-000000001401'),
  ('e3000000-0000-4000-8000-000000001402', 'f0f0f0f0-0000-4000-8000-000000001401',
   'e0000000-0000-4000-8000-000000001402', 'e2000000-0000-4000-8000-000000001402');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001401', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001402', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001403', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001404', 'owner', now(), null),
  ('20000000-0000-0000-0000-000000001405', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001406', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001407', 'client', null, 'e0000000-0000-4000-8000-000000001401'),
  ('20000000-0000-0000-0000-000000001408', 'client', now(), null)
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001401', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001402', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001404', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001405', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001406', 'admin', 'internal', null, now()),
  ('20000000-0000-0000-0000-000000001408', 'client', 'client', 'e0000000-0000-4000-8000-000000001402', null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- Runs one statement and returns 'ok' or its SQLSTATE.
create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Every id-based internal operation against one Service, folder and intent.
-- Archives run last.
create function pg_temp.battery(p_service text, p_folder text, p_intent text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'update:' || pg_temp.try(format('select public.app_update_service(%L, %L)', p_service, '{"name":"Changed"}')),
    'assign:' || pg_temp.try(format('select public.app_update_service(%L, %L)', p_service, '{"assigned_to_profile_id":null}')),
    'duplicate:' || pg_temp.try(format('select public.app_duplicate_service(gen_random_uuid(), %L)', p_service)),
    'intent:' || pg_temp.try(format('select public.app_set_investment_intent_status(%L, %L)', p_intent, 'reviewing')),
    'folder:' || pg_temp.try(format('select public.app_update_service_folder(%L, %L)', p_folder, '{"name":"Changed"}')),
    'eligible:' || pg_temp.try(format('select public.app_set_service_folder_subscription_eligibility(%L, true)', p_folder)),
    'archive:' || pg_temp.try(format('select public.app_archive_service(%L)', p_service)),
    'folderarchive:' || pg_temp.try(format('select public.app_archive_service_folder(%L)', p_folder))
  );
end;
$$;

-- Readback of one Tenant's fixture rows (security definer).
create function pg_temp.snap(p_tenant text)
returns text
language sql
security definer
as $$
  select concat_ws('/',
    (select string_agg(service.name || ':' || (service.archived_at is not null) || ':' || service.subscription_eligible
      || ':' || (service.folder_id is not null), ',' order by service.name)
      from public.services as service where service.tenant_id = p_tenant::uuid
        and (service.id::text like 'e2000000-0000-4000-8000-00000000140%' or service.name like '% (Copy)')),
    (select string_agg(folder.name || ':' || (folder.archived_at is not null), ',')
      from public.service_folders as folder where folder.id::text like 'e1000000-0000-4000-8000-00000000140%'
        and folder.tenant_id = p_tenant::uuid),
    (select string_agg(interest.status, ',') from public.service_interests as interest
      where interest.id::text like 'e3000000-0000-4000-8000-00000000140%' and interest.tenant_id = p_tenant::uuid));
$$;

-- Fixture Services and folders visible through direct RLS reads, plus the
-- fixture intents in the investment intent list.
create function pg_temp.visible()
returns text
language sql
as $$
  select coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.services
      where id::text like 'e2000000-0000-4000-8000-00000000140%'), '-')
    || ' | ' || coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.service_folders
      where id::text like 'e1000000-0000-4000-8000-00000000140%'), '-');
$$;

create function pg_temp.intents()
returns text
language sql
as $$
  select coalesce(string_agg(right(intent.intent_id::text, 4), ' ' order by intent.intent_id), '-')
  from public.app_list_investment_intents(500) as intent
  where intent.intent_id::text like 'e3000000-0000-4000-8000-00000000140%';
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.battery(text, text, text), pg_temp.snap(text),
  pg_temp.visible(), pg_temp.intents(), pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads (Service RLS; global search reads services through it)
-- -----------------------------------------------------------------------------

select pg_temp.act('1401', '');
select is(pg_temp.visible(), '1401 | 1401', 'WF admin reads only WF Services and folders');
select is(pg_temp.intents(), '1401', 'WF admin lists only WF investment intents');
select throws_ok($$ select count(*) from public.service_interests $$, '42501', 'permission denied for table service_interests',
  'no direct service_interests access');
select is((select count(*) from public.services where name ilike 'B Service%'), 0::bigint,
  'a global-search style name query finds no B Service');
select pg_temp.act('1402', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.visible(), '1402 | 1402', 'B admin reads only B Services and folders');
select is(pg_temp.intents(), '1402', 'B admin lists only B investment intents');

-- -----------------------------------------------------------------------------
-- Tenant A (Wolf Forge) admin
-- -----------------------------------------------------------------------------

select pg_temp.act('1401', '');
select is(
  pg_temp.battery('e2000000-0000-4000-8000-000000001402', 'e1000000-0000-4000-8000-000000001402',
    'e3000000-0000-4000-8000-000000001402'),
  'update:P0002 assign:P0002 duplicate:P0002 intent:42501 folder:P0002 eligible:P0002 archive:P0002 folderarchive:P0002',
  'WF admin -> B Service, folder and intent: every operation fails'
);
select is(
  pg_temp.battery('e2000000-0000-4000-8000-0000000014ff', 'e1000000-0000-4000-8000-0000000014ff',
    'e3000000-0000-4000-8000-0000000014ff'),
  'update:P0002 assign:P0002 duplicate:P0002 intent:42501 folder:P0002 eligible:P0002 archive:P0002 folderarchive:P0002',
  'missing ids fail exactly like the foreign rows'
);
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000001401'), 'B Service:false:false:true/B Folder:false/new',
  'B rows unchanged and no copy made after the WF admin attempts');
select is(
  pg_temp.battery('e2000000-0000-4000-8000-000000001401', 'e1000000-0000-4000-8000-000000001401',
    'e3000000-0000-4000-8000-000000001401'),
  'update:ok assign:ok duplicate:ok intent:ok folder:ok eligible:ok archive:ok folderarchive:ok',
  'WF admin -> WF Service, folder and intent: every operation allowed'
);
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000000001'),
  'Changed:true:true:false,Changed (Copy):false:true:false/Changed:true/reviewing',
  'WF rows changed and copied in Wolf Forge by the WF admin');

-- -----------------------------------------------------------------------------
-- Tenant B admin
-- -----------------------------------------------------------------------------

select pg_temp.act('1402', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(
  pg_temp.battery('e2000000-0000-4000-8000-000000001401', 'e1000000-0000-4000-8000-000000001401',
    'e3000000-0000-4000-8000-000000001401'),
  'update:P0002 assign:P0002 duplicate:P0002 intent:42501 folder:P0002 eligible:P0002 archive:P0002 folderarchive:P0002',
  'B admin -> WF Service, folder and intent: every operation fails'
);
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000000001'),
  'Changed:true:true:false,Changed (Copy):false:true:false/Changed:true/reviewing',
  'WF rows unchanged after the B admin attempts');
select is(
  pg_temp.battery('e2000000-0000-4000-8000-000000001402', 'e1000000-0000-4000-8000-000000001402',
    'e3000000-0000-4000-8000-000000001402'),
  'update:ok assign:ok duplicate:ok intent:ok folder:ok eligible:ok archive:ok folderarchive:ok',
  'B admin -> B Service, folder and intent: every operation allowed'
);
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000001401'),
  'Changed:true:true:false,Changed (Copy):false:true:false/Changed:true/reviewing',
  'B rows changed and copied in Tenant B by the B admin');

-- Restore the fixtures (trusted) for the remaining cases.
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.service_folders set archived_at = null where id::text like 'e1000000-0000-4000-8000-00000000140%';
update public.services set archived_at = null, is_active = true,
  folder_id = case when tenant_id = private.wolf_forge_tenant_id()
    then 'e1000000-0000-4000-8000-000000001401'::uuid else 'e1000000-0000-4000-8000-000000001402'::uuid end
where id::text like 'e2000000-0000-4000-8000-00000000140%';
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Owners, dual owner, archived membership, selectors
-- -----------------------------------------------------------------------------

select pg_temp.act('1403', '');
select is(pg_temp.visible(), '1401 | 1401', 'WF owner reads only WF Services');
select is(pg_temp.try($$ select public.app_duplicate_service(gen_random_uuid(), 'e2000000-0000-4000-8000-000000001402') $$),
  'P0002', 'WF owner cannot duplicate the B Service');
select pg_temp.act('1403', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.try($$ select public.app_archive_service('e2000000-0000-4000-8000-000000001402') $$), '42501',
  'WF owner with the B selector cannot archive the B Service');
select pg_temp.act('1404', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.try($$ select public.app_archive_service('e2000000-0000-4000-8000-000000001401') $$), 'P0002',
  'B owner cannot archive the WF Service');
select is(pg_temp.try($$ select public.app_set_investment_intent_status('e3000000-0000-4000-8000-000000001401', 'closed') $$),
  '42501', 'B owner cannot change the WF investment intent');
select pg_temp.act('1404', '');
select is(pg_temp.visible(), '- | -', 'B owner (archived in WF) with no selector reads nothing');

select pg_temp.act('1405', '');
select is(pg_temp.visible() || ' ' || pg_temp.intents(), '1401 | 1401 1401',
  'dual owner with the WF selector reads WF Services and intents only');
select is(pg_temp.try($$ select public.app_duplicate_service(gen_random_uuid(), 'e2000000-0000-4000-8000-000000001402') $$),
  'P0002', 'dual owner with the WF selector cannot duplicate the B Service');
select pg_temp.act('1405', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.visible() || ' ' || pg_temp.intents(), '1402 | 1402 1402',
  'dual owner with the B selector reads B Services and intents only');
select is(pg_temp.try($$ select public.app_update_service('e2000000-0000-4000-8000-000000001401', '{"name":"x"}') $$),
  'P0002', 'dual owner with the B selector cannot update the WF Service');

select pg_temp.act('1406', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_update_service('e2000000-0000-4000-8000-000000001402', '{"name":"x"}') $$),
  '- | - 42501', 'archived B admin reads and changes nothing');
select pg_temp.act('1405', '{"x-wf-tenant":"not-a-uuid"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_list_investment_intents(10) $$),
  '- | - 42501', 'malformed selector reads nothing');
select pg_temp.act('1405', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000014ff"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_list_investment_intents(10) $$),
  '- | - 42501', 'foreign selector reads nothing');

reset role;
update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000001401';
set local role authenticated;
select pg_temp.act('1404', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_archive_service('e2000000-0000-4000-8000-000000001402') $$),
  '- | - 42501', 'suspended Tenant owner reads and changes nothing');
reset role;
update public.tenants set status = 'active' where id = 'f0f0f0f0-0000-4000-8000-000000001401';
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Client store: catalog, quote, interest and purchase stay in the Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1407', '');
select is(pg_temp.visible(), '1401 | 1401', 'WF client store shows only the WF Service and folder');
select throws_ok($$ select public.app_quote_store_coupon('e2000000-0000-4000-8000-000000001402', null) $$,
  '42501', 'WF_PURCHASE_SERVICE_UNAVAILABLE', 'WF client cannot quote the B Service');
select throws_ok($$ select public.app_purchase_service_with_balance(gen_random_uuid(), 'e2000000-0000-4000-8000-000000001402', null) $$,
  '42501', 'WF_PURCHASE_SERVICE_UNAVAILABLE', 'WF client cannot purchase the B Service');
select is(public.app_record_store_interest(array['e2000000-0000-4000-8000-000000001402'::uuid], true), 0,
  'WF client registers no interest in the B Service');
select is(public.app_record_store_interest(array['e2000000-0000-4000-8000-000000001401'::uuid], false), 1,
  'WF client updates their interest in the WF Service');
select pg_temp.act('1408', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select is(pg_temp.visible(), '1402 | 1402', 'B client store shows only the B Service and folder');
select is(public.app_record_store_interest(array['e2000000-0000-4000-8000-000000001401'::uuid], true), 0,
  'B client registers no interest in the WF Service');
select is(
  pg_temp.try($$ select public.app_quote_store_coupon('e2000000-0000-4000-8000-000000001401', 'NONE') $$)
  || ' ' || pg_temp.try($$ select public.app_purchase_service_with_balance(gen_random_uuid(), 'e2000000-0000-4000-8000-000000001401', null) $$),
  '42501 42501', 'B client cannot quote or purchase the WF Service');

-- -----------------------------------------------------------------------------
-- Creation: folder / assignee of the current Tenant; replays stay in their Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1402', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select throws_ok($$ select public.app_create_service(gen_random_uuid(), jsonb_build_object(
    'name', 'x', 'folder_id', 'e1000000-0000-4000-8000-000000001401')) $$,
  '23514', null, 'B admin cannot file a Service in a WF folder (fails like a missing folder)');
select throws_ok($$ select public.app_create_service(gen_random_uuid(), jsonb_build_object(
    'name', 'x', 'assigned_to_profile_id', '20000000-0000-0000-0000-000000001401')) $$,
  '23514', null, 'B admin cannot assign a Service to WF-only staff');
select is((select tenant_id from public.app_create_service(gen_random_uuid(), jsonb_build_object(
    'name', 'B new', 'folder_id', 'e1000000-0000-4000-8000-000000001402'))),
  'f0f0f0f0-0000-4000-8000-000000001401'::uuid, 'B admin creates a B Service in Tenant B');
select is(
  pg_temp.try($$ select public.app_update_service('e2000000-0000-4000-8000-000000001402',
    '{"assigned_to_profile_id":"20000000-0000-0000-0000-000000001401"}') $$)
  || ' ' || pg_temp.try($$ select public.app_update_service_folder('e1000000-0000-4000-8000-000000001402',
    '{"parent_id":"e1000000-0000-4000-8000-000000001401"}') $$),
  '23514 23514', 'B admin cannot reassign a B Service to WF-only staff or move a B folder under a WF folder');

select pg_temp.act('1405', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}');
select lives_ok($$ select public.app_duplicate_service('ea000000-0000-4000-8000-000000001401', 'e2000000-0000-4000-8000-000000001402') $$,
  'dual owner duplicates the B Service with a fixed request id');
select lives_ok($$ select public.app_create_service_folder('ea000000-0000-4000-8000-000000001402', 'B sub', null, null, 0) $$,
  'dual owner creates a B folder with a fixed request id');
select lives_ok($$ select public.app_create_service('ea000000-0000-4000-8000-000000001403', '{"name":"B fixed"}') $$,
  'dual owner creates a B Service with a fixed request id');
select pg_temp.act('1405', '');
select is(
  pg_temp.try($$ select public.app_duplicate_service('ea000000-0000-4000-8000-000000001401', 'e2000000-0000-4000-8000-000000001402') $$)
  || ' ' || pg_temp.try($$ select public.app_create_service_folder('ea000000-0000-4000-8000-000000001402', 'B sub', null, null, 0) $$)
  || ' ' || pg_temp.try($$ select public.app_create_service('ea000000-0000-4000-8000-000000001403', '{"name":"B fixed"}') $$),
  'P0002 P0002 P0002', 'replays under the WF selector do not return the B copy, folder or Service');

select pg_temp.act('1401', '');
select is((select tenant_id from public.app_create_service(gen_random_uuid(), jsonb_build_object(
    'name', 'WF new', 'folder_id', 'e1000000-0000-4000-8000-000000001401'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid, 'WF admin creates a WF Service in Wolf Forge');

select * from finish();

rollback;
