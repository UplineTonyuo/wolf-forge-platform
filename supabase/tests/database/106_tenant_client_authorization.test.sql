begin;

select plan(51);

-- WL-2.9 (KI-111, Clients / Contacts / Companies): every Client, contact,
-- Company and Company-membership operation requires the row to belong to the
-- caller's current Tenant; a foreign row behaves like a missing one, and the
-- directory / search sources never reveal another Tenant's names or ids.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001501.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1501 WF admin; 1502 B admin (WF archived); 1503 WF owner; 1504 B owner (WF
-- archived); 1505 owner of both; 1506 B admin with an archived B membership (WF
-- archived); 1507 WF client of the WF Client; 1508 B client of the B Client.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'client-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1501', '1502', '1503', '1504', '1505', '1506', '1507', '1508']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001501', 'client-authz-tenant-b', 'Client Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e0000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(), 'WF_ONLY_SECRET_CLIENT', 'client'),
  ('e0000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501', 'TENANT_B_SECRET_CLIENT', 'client');

insert into public.client_contacts (id, tenant_id, company_id, name, is_primary)
values
  ('45000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(),
   'e0000000-0000-4000-8000-000000001501', 'WF_ONLY_SECRET_CONTACT', true),
  ('45000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001502', 'TENANT_B_SECRET_CONTACT', true);

insert into public.organizations (id, tenant_id, name)
values
  ('60000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(), 'WF_ONLY_SECRET_ORG'),
  ('60000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501', 'TENANT_B_SECRET_ORG');

insert into public.organization_members (tenant_id, organization_id, contact_id)
values
  (private.wolf_forge_tenant_id(), '60000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001501'),
  ('f0f0f0f0-0000-4000-8000-000000001501', '60000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001501', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001502', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001503', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001504', 'owner', now(), null),
  ('20000000-0000-0000-0000-000000001505', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001506', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001507', 'client', null, 'e0000000-0000-4000-8000-000000001501'),
  ('20000000-0000-0000-0000-000000001508', 'client', null, null)
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001501', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001502', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001504', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001505', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001506', 'admin', 'internal', null, now()),
  ('20000000-0000-0000-0000-000000001508', 'client', 'client', 'e0000000-0000-4000-8000-000000001502', null)
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

-- Every id-based internal operation against one Client, contact and Company.
-- Archives run last.
create function pg_temp.battery(p_company text, p_contact text, p_org text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'update:' || pg_temp.try(format('select public.app_update_company(%L, %L)', p_company, '{"name":"Attack"}')),
    'updatec:' || pg_temp.try(format('select public.app_update_contact(%L, %L)', p_contact, '{"name":"Attack"}')),
    'updateo:' || pg_temp.try(format('select public.app_update_organization(%L, %L)', p_org, 'Attack')),
    'member:' || pg_temp.try(format('select public.app_add_organization_member(%L, %L)', p_org, p_contact)),
    'archive:' || pg_temp.try(format('select public.app_archive_company(%L)', p_company)),
    'archivec:' || pg_temp.try(format('select public.app_archive_contact(%L)', p_contact))
  );
end;
$$;

-- Readback of one Tenant's fixture rows (security definer).
create function pg_temp.snap(p_tenant text)
returns text
language sql
security definer
as $$
  select concat_ws('|',
    (select string_agg(company.name || ':' || (company.archived_at is not null), ',' order by company.id)
      from public.companies as company where company.tenant_id = p_tenant::uuid
        and company.id::text like 'e0000000-0000-4000-8000-00000000150%'),
    (select string_agg(contact.name || ':' || (contact.archived_at is not null), ',' order by contact.id)
      from public.client_contacts as contact where contact.tenant_id = p_tenant::uuid
        and contact.id::text like '45000000-0000-4000-8000-00000000150%'),
    (select string_agg(organization.name, ',' order by organization.id)
      from public.organizations as organization where organization.tenant_id = p_tenant::uuid
        and organization.id::text like '60000000-0000-4000-8000-00000000150%'),
    (select count(*)::text from public.organization_members as member
      where member.tenant_id = p_tenant::uuid
        and member.organization_id::text like '60000000-0000-4000-8000-00000000150%'));
$$;

-- Archived flags plus membership count for one Client, contact and Company.
create function pg_temp.state(p_company text, p_contact text, p_org text)
returns text
language sql
security definer
as $$
  select (select (archived_at is not null)::text from public.companies where id = p_company::uuid)
    || ' ' || (select (archived_at is not null)::text from public.client_contacts where id = p_contact::uuid)
    || ' ' || (select count(*)::text from public.organization_members where organization_id = p_org::uuid);
$$;

-- Fixture rows visible through direct RLS reads.
create function pg_temp.visible()
returns text
language sql
as $$
  select coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.companies
      where id::text like 'e0000000-0000-4000-8000-00000000150%'), '-')
    || ' | ' || coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.client_contacts
      where id::text like '45000000-0000-4000-8000-00000000150%'), '-')
    || ' | ' || coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.organizations
      where id::text like '60000000-0000-4000-8000-00000000150%'), '-')
    || ' | ' || coalesce((select string_agg(right(organization_id::text, 4) || right(contact_id::text, 4), ' ' order by contact_id)
      from public.organization_members
      where organization_id::text like '60000000-0000-4000-8000-00000000150%'), '-');
$$;

-- Secret names returned by the client directory search (never Tenant-filtered
-- here on purpose: a leak must surface).
create function pg_temp.search(p_query text)
returns text
language sql
as $$
  select coalesce(string_agg(distinct directory.display_name, ' ' order by directory.display_name), '-')
  from public.app_search_client_directory(p_query, 50) as directory
  where directory.display_name like '%SECRET%';
$$;

-- Fixture Clients in the company directory.
create function pg_temp.dir()
returns text
language sql
as $$
  select coalesce(string_agg(right(directory.id::text, 4), ' ' order by directory.id), '-')
  from public.app_list_client_company_directory() as directory
  where directory.id::text like 'e0000000-0000-4000-8000-00000000150%';
$$;

-- Activity events recorded against one entity.
create function pg_temp.events(p_entity uuid)
returns bigint
language sql
security definer
as $$
  select count(*) from public.activity_events where entity_id = p_entity;
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.battery(text, text, text), pg_temp.snap(text),
  pg_temp.state(text, text, text), pg_temp.visible(), pg_temp.search(text), pg_temp.dir(), pg_temp.events(uuid),
  pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads (Client, contact, Company and membership RLS)
-- -----------------------------------------------------------------------------

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.visible(), '1502 | 1502 | 1502 | 15021502',
  'a Tenant B admin reads only Tenant B Clients, contacts, Companies and memberships');
select is((select count(*) from public.companies where id = 'e0000000-0000-4000-8000-000000001501'),
  0::bigint, 'the Wolf Forge Client is invisible to a Tenant B admin');
select is((select count(*) from public.client_contacts where id = '45000000-0000-4000-8000-000000001501'),
  0::bigint, 'the Wolf Forge contact is invisible to a Tenant B admin');
select is((select count(*) from public.organizations where id = '60000000-0000-4000-8000-000000001501'),
  0::bigint, 'the Wolf Forge Company is invisible to a Tenant B admin');
select is((select count(*) from public.organization_members
    where organization_id = '60000000-0000-4000-8000-000000001501'),
  0::bigint, 'Wolf Forge Company membership is invisible to a Tenant B admin');

select pg_temp.act('1501', '');
select is(pg_temp.visible(), '1501 | 1501 | 1501 | 15011501',
  'a Wolf Forge admin reads only Wolf Forge rows');
select is((select count(*) from public.companies where id = 'e0000000-0000-4000-8000-000000001502'),
  0::bigint, 'the Tenant B Client is invisible to a Wolf Forge admin');
select is((select count(*) from public.client_contacts where id = '45000000-0000-4000-8000-000000001502'),
  0::bigint, 'the Tenant B contact is invisible to a Wolf Forge admin');
select is((select count(*) from public.organizations where id = '60000000-0000-4000-8000-000000001502'),
  0::bigint, 'the Tenant B Company is invisible to a Wolf Forge admin');
select is((select count(*) from public.organization_members
    where organization_id = '60000000-0000-4000-8000-000000001502'),
  0::bigint, 'Tenant B Company membership is invisible to a Wolf Forge admin');

select pg_temp.act('1508', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.visible(), '1502 | - | - | -',
  'a Tenant B portal client reads only its own Client');
select pg_temp.act('1507', '');
select is(pg_temp.visible(), '1501 | - | - | -',
  'a Wolf Forge portal client reads only its own Client');

-- -----------------------------------------------------------------------------
-- Directory and search leak
-- -----------------------------------------------------------------------------

select pg_temp.act('1501', '');
select ok(pg_temp.search('WF_ONLY_SECRET') like '%WF_ONLY_SECRET_CONTACT%',
  'Wolf Forge search returns the Wolf Forge contact name');
select ok(pg_temp.search('WF_ONLY_SECRET') not like '%TENANT_B%',
  'Wolf Forge search never returns a Tenant B name');
select is((select count(*) from public.app_search_client_directory('TENANT_B_SECRET', 50)),
  0::bigint, 'Wolf Forge search never returns the Tenant B secret names');
select is(pg_temp.dir(), '1501', 'the Wolf Forge company directory lists only the Wolf Forge Client');

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select ok(pg_temp.search('TENANT_B_SECRET') like '%TENANT_B_SECRET_CONTACT%',
  'Tenant B search returns the Tenant B contact name');
select ok(pg_temp.search('TENANT_B_SECRET') not like '%WF_ONLY%',
  'Tenant B search never returns a Wolf Forge name');
select is((select count(*) from public.app_search_client_directory('WF_ONLY_SECRET', 50)),
  0::bigint, 'Tenant B search never returns the Wolf Forge secret names');
select is(pg_temp.dir(), '1502', 'the Tenant B company directory lists only the Tenant B Client');

-- -----------------------------------------------------------------------------
-- Foreign Tenant operations fail closed (P0002 = missing row, no oracle)
-- -----------------------------------------------------------------------------

select pg_temp.act('1501', '');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:P0002 updatec:P0002 updateo:P0002 member:P0002 archive:P0002 archivec:P0002',
  'a Wolf Forge admin cannot touch any Tenant B Client, contact, Company or membership by id');

select pg_temp.act('1503', '');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:P0002 updatec:P0002 updateo:P0002 member:P0002 archive:P0002 archivec:P0002',
  'a Wolf Forge owner cannot touch any Tenant B row by id');

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001501',
    '60000000-0000-4000-8000-000000001501'),
  'update:P0002 updatec:P0002 updateo:P0002 member:P0002 archive:P0002 archivec:P0002',
  'a Tenant B admin cannot touch any Wolf Forge row by id');

select pg_temp.act('1504', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001501',
    '60000000-0000-4000-8000-000000001501'),
  'update:P0002 updatec:P0002 updateo:P0002 member:P0002 archive:P0002 archivec:P0002',
  'a Tenant B owner cannot touch any Wolf Forge row by id');

select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001501',
    '60000000-0000-4000-8000-000000001501'),
  'update:P0002 updatec:P0002 updateo:P0002 member:P0002 archive:P0002 archivec:P0002',
  'the dual owner under the Tenant B selector cannot touch Wolf Forge rows');

select pg_temp.act('1505', '');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:P0002 updatec:P0002 updateo:P0002 member:P0002 archive:P0002 archivec:P0002',
  'the dual owner under the Wolf Forge selector cannot touch Tenant B rows');

select pg_temp.act('1506', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:42501 updatec:42501 updateo:42501 member:42501 archive:42501 archivec:42501',
  'an archived Tenant B membership cannot operate at all');

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001599"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:42501 updatec:42501 updateo:42501 member:42501 archive:42501 archivec:42501',
  'a selector for a Tenant without membership fails everything closed');

select pg_temp.act('1502', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:42501 updatec:42501 updateo:42501 member:42501 archive:42501 archivec:42501',
  'a malformed selector fails everything closed');

-- Every foreign attempt left both Tenants untouched.
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000000001'),
  'WF_ONLY_SECRET_CLIENT:false|WF_ONLY_SECRET_CONTACT:false|WF_ONLY_SECRET_ORG|1',
  'the Wolf Forge rows are unchanged after every foreign attempt');
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000001501'),
  'TENANT_B_SECRET_CLIENT:false|TENANT_B_SECRET_CONTACT:false|TENANT_B_SECRET_ORG|1',
  'the Tenant B rows are unchanged after every foreign attempt');

-- A blocked foreign write records no activity event in the victim Tenant.
select is(pg_temp.events('e0000000-0000-4000-8000-000000001502'), 0::bigint,
  'no foreign attack wrote a Tenant B Client activity event');
select is(pg_temp.events('45000000-0000-4000-8000-000000001502'), 0::bigint,
  'no foreign attack wrote a Tenant B contact activity event');
select is(pg_temp.events('60000000-0000-4000-8000-000000001502'), 0::bigint,
  'no foreign attack wrote a Tenant B Company activity event');
select is(pg_temp.events('e0000000-0000-4000-8000-000000001501'), 0::bigint,
  'no attack wrote a Wolf Forge Client activity event');

-- The dual owner operates inside each Tenant under its own selector.
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select lives_ok(
  $$select public.app_update_organization('60000000-0000-4000-8000-000000001502', 'Dual B Rename')$$,
  'the dual owner renames the Tenant B Company under the Tenant B selector');
select pg_temp.act('1505', '');
select lives_ok(
  $$select public.app_update_organization('60000000-0000-4000-8000-000000001501', 'Dual WF Rename')$$,
  'the dual owner renames the Wolf Forge Company under the Wolf Forge selector');

-- -----------------------------------------------------------------------------
-- Cross-Tenant relationship writes are rejected
-- -----------------------------------------------------------------------------

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.try(
    $$select public.app_create_contact('85000000-0000-4000-8000-000000001510', 'e0000000-0000-4000-8000-000000001501', 'Cross Tenant Contact')$$),
  '23503', 'a Tenant B contact cannot be created on a Wolf Forge Client');
select is(pg_temp.try(
    $$select public.app_create_contact('85000000-0000-4000-8000-000000001511', 'e0000000-0000-4000-8000-000000001502', 'Cross Link', '20000000-0000-0000-0000-000000001507')$$),
  '23503', 'a Tenant B contact cannot link a Wolf Forge-only portal profile');
select is(pg_temp.try(
    $$select public.app_add_organization_member('60000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001501')$$),
  'P0002', 'a Tenant B Company cannot gain a Wolf Forge contact');

select pg_temp.act('1501', '');
select is(pg_temp.try(
    $$select public.app_add_organization_member('60000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001502')$$),
  'P0002', 'a Wolf Forge Company cannot gain a Tenant B contact');

-- A create replay never returns a row of another Tenant.
select pg_temp.act('1505', '');
select is(pg_temp.try(
    $$select public.app_create_organization('85000000-0000-4000-8000-000000001520', 'Replay Org')$$),
  'ok', 'the dual owner creates a Wolf Forge Company');
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.try(
    $$select public.app_create_organization('85000000-0000-4000-8000-000000001520', 'Replay Org')$$),
  'P0002', 'an organization create replay is not returned under another Tenant selector');

select pg_temp.act('1505', '');
select is(pg_temp.try(
    $$select public.app_create_company('85000000-0000-4000-8000-000000001521', 'Replay Client')$$),
  'ok', 'the dual owner creates a Wolf Forge Client');
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.try(
    $$select public.app_create_company('85000000-0000-4000-8000-000000001521', 'Replay Client')$$),
  'P0002', 'a Client create replay is not returned under another Tenant selector');

select pg_temp.act('1505', '');
select is(pg_temp.try(
    $$select public.app_create_contact('85000000-0000-4000-8000-000000001522', 'e0000000-0000-4000-8000-000000001501', 'Replay Contact')$$),
  'ok', 'the dual owner creates a Wolf Forge contact');
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.try(
    $$select public.app_create_contact('85000000-0000-4000-8000-000000001522', 'e0000000-0000-4000-8000-000000001501', 'Replay Contact')$$),
  'P0002', 'a contact create replay is not returned under another Tenant selector');

-- -----------------------------------------------------------------------------
-- Same-Tenant operations still work (mutations run last)
-- -----------------------------------------------------------------------------

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'update:ok updatec:ok updateo:ok member:ok archive:ok archivec:ok',
  'a Tenant B admin operates normally inside Tenant B');
select is(pg_temp.state('e0000000-0000-4000-8000-000000001502', '45000000-0000-4000-8000-000000001502',
    '60000000-0000-4000-8000-000000001502'),
  'true true 1', 'the Tenant B rows carry the Tenant B admin''s own changes');

select pg_temp.act('1503', '');
select is(pg_temp.battery('e0000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001501',
    '60000000-0000-4000-8000-000000001501'),
  'update:ok updatec:ok updateo:ok member:ok archive:ok archivec:ok',
  'the Wolf Forge owner operates normally inside Wolf Forge');
select is(pg_temp.state('e0000000-0000-4000-8000-000000001501', '45000000-0000-4000-8000-000000001501',
    '60000000-0000-4000-8000-000000001501'),
  'true true 1', 'the Wolf Forge rows carry the Wolf Forge owner''s own changes');

select * from finish();
rollback;
