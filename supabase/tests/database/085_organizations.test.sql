begin;

select plan(24);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000851', 'authenticated', 'authenticated', 'org-admin@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000852', 'authenticated', 'authenticated', 'org-manager@example.invalid', now(), now());

update public.profiles as profile
set role_id = role.id
from public.roles as role
where (profile.id, role.name) in (
  ('20000000-0000-0000-0000-000000000851'::uuid, 'admin'),
  ('20000000-0000-0000-0000-000000000852'::uuid, 'manager')
);

-- A Client record whose business name matches the Company created below.
insert into public.companies (id, name, status)
values ('30000000-0000-0000-0000-000000000851', 'Anthony PLATFORM', 'client');

insert into public.client_contacts (id, company_id, name, is_primary)
values ('45000000-0000-0000-0000-000000000851', '30000000-0000-0000-0000-000000000851', 'Antonio Paghubasan Jr', true);

select is(
  (select count(*) from public.organizations),
  0::bigint,
  'existing Client records are not Companies'
);

-- Admin: full Clients capabilities including private contact management.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000851';

select lives_ok(
  $$select public.app_create_organization('85000000-0000-0000-0000-000000000001', 'Anthony PLATFORM')$$,
  'admin creates a Company whose name matches a Client business name'
);
select is(
  (select count(*) from public.organizations where name = 'Anthony PLATFORM'),
  1::bigint,
  'the Company exists once'
);
select lives_ok(
  $$select public.app_create_organization('85000000-0000-0000-0000-000000000001', 'Anthony PLATFORM')$$,
  'a retried create with the same request id succeeds'
);
select is(
  (select count(*) from public.organizations),
  1::bigint,
  'the retry does not duplicate the Company'
);
select is(
  (select count(*) from public.companies where name = 'Anthony PLATFORM'),
  1::bigint,
  'creating a Company creates no Client record'
);
select is(
  (select count(*) from public.organization_members),
  0::bigint,
  'a same-named Client is never inferred as a member; zero people is valid'
);
select is(
  (select count(*) from public.activity_events where entity_type = 'organization' and action = 'organization.created'),
  1::bigint,
  'creation is audited once'
);

select lives_ok(
  $$select public.app_add_organization_member(
      (select id from public.organizations where name = 'Anthony PLATFORM'),
      '45000000-0000-0000-0000-000000000851')$$,
  'admin adds an existing person explicitly'
);
select lives_ok(
  $$select public.app_add_organization_member(
      (select id from public.organizations where name = 'Anthony PLATFORM'),
      '45000000-0000-0000-0000-000000000851')$$,
  'adding the same person again is a no-op'
);
select is(
  (select count(*) from public.organization_members),
  1::bigint,
  'membership is stored once'
);
select is(
  (select count(*) from public.activity_events where action = 'organization.member_added'),
  1::bigint,
  'only the real membership change is audited'
);
select is(
  (select company_id from public.client_contacts where id = '45000000-0000-0000-0000-000000000851'),
  '30000000-0000-0000-0000-000000000851'::uuid,
  'the person keeps their Client record'
);
select is(
  (select status from public.companies where id = '30000000-0000-0000-0000-000000000851'),
  'client',
  'Client lifecycle status is unchanged by Company membership'
);

select lives_ok(
  $$select public.app_update_organization(
      (select id from public.organizations where name = 'Anthony PLATFORM'),
      'Anthony Team')$$,
  'admin renames the Company'
);
select is(
  (select name from public.companies where id = '30000000-0000-0000-0000-000000000851'),
  'Anthony PLATFORM',
  'renaming the Company leaves the Client business name alone'
);

select throws_ok(
  $$insert into public.organizations (name) values ('Direct write')$$,
  '42501',
  null,
  'direct inserts are refused; writes go through the RPCs'
);
select throws_ok(
  $$select public.app_create_organization('85000000-0000-0000-0000-000000000002', '   ')$$,
  '23514',
  null,
  'a blank Company name is refused'
);

-- Manager: clients.view only.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000852';

select is(
  (select count(*) from public.organizations),
  1::bigint,
  'a Clients viewer can read Companies'
);
select is(
  (select count(*) from public.organization_members),
  0::bigint,
  'membership is hidden without private contact access'
);
select throws_ok(
  $$select public.app_create_organization('85000000-0000-0000-0000-000000000003', 'Manager Company')$$,
  '42501',
  null,
  'a viewer cannot create a Company'
);
select throws_ok(
  $$select public.app_add_organization_member(
      (select id from public.organizations limit 1),
      '45000000-0000-0000-0000-000000000851')$$,
  '42501',
  null,
  'a viewer cannot add people'
);

reset role;
set local role anon;

select throws_ok(
  $$select count(*) from public.organizations$$,
  '42501',
  null,
  'anonymous callers cannot read Companies'
);
select throws_ok(
  $$select public.app_create_organization('85000000-0000-0000-0000-000000000004', 'Anon Company')$$,
  '42501',
  null,
  'anonymous callers cannot create Companies'
);

select * from finish();
rollback;
