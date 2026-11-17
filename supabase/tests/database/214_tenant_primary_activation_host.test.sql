-- Synthetic activation claims only. All fixture writes are rolled back.
begin;

select plan(8);

insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid,
  'authenticated', 'authenticated', 'canonical-' || n || '@example.invalid', now(), now()
from unnest(array['2141', '2142', '2143', '2144']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002140', 'canonical-host-test', 'Canonical Host Test', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000002141', private.wolf_forge_tenant_id(), 'Canonical WF Client', 'client'),
  ('c0000000-0000-4000-8000-000000002142', 'f0f0f0f0-0000-4000-8000-000000002140', 'Canonical Other Client', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner')
where id = '20000000-0000-4000-8000-000000002141';
update public.profiles set company_id = 'c0000000-0000-4000-8000-000000002141'
where id = '20000000-0000-4000-8000-000000002142';

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select 'f0f0f0f0-0000-4000-8000-000000002140', member.profile_id, member.account_class, roles.id, member.company_id
from (values
  ('20000000-0000-4000-8000-000000002143'::uuid, 'internal', 'owner', null::uuid),
  ('20000000-0000-4000-8000-000000002144'::uuid, 'client', 'client', 'c0000000-0000-4000-8000-000000002142'::uuid)
) as member(profile_id, account_class, role_name, company_id)
join public.roles on roles.name = member.role_name;

insert into public.tenant_domains (host, tenant_id, verified_at, created_at)
values
  ('z-canonical-older.test', private.wolf_forge_tenant_id(), now(), '2000-01-01'),
  ('b-canonical-older.test', private.wolf_forge_tenant_id(), now(), '2000-01-01'),
  ('a-canonical-newer.test', private.wolf_forge_tenant_id(), now(), '2001-01-01'),
  ('z-canonical-other.test', 'f0f0f0f0-0000-4000-8000-000000002140', now(), '2000-01-01'),
  ('a-canonical-other.test', 'f0f0f0f0-0000-4000-8000-000000002140', now(), '2001-01-01');

select results_eq(
  $$select host from public.tenant_domains where tenant_id = private.wolf_forge_tenant_id() and is_primary$$,
  $$values ('services.wolfforgedigitalagency.com'::text)$$,
  'migration marks only the registered services host as Wolf Forge primary'
);

select throws_ok(
  $$update public.tenant_domains set is_primary = true where host = 'b-canonical-older.test'$$,
  '23505', null, 'one tenant cannot have two primaries'
);

set local role service_role;
select is(
  (select canonical_host from public.app_server_claim_client_welcome_email(
    '20000000-0000-4000-8000-000000002141', '20000000-0000-4000-8000-000000002142',
    'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('a', 64))),
  'services.wolfforgedigitalagency.com', 'verified enabled primary beats older hosts'
);
select is(
  (select canonical_host from public.app_server_claim_client_welcome_email(
    '20000000-0000-4000-8000-000000002143', '20000000-0000-4000-8000-000000002144',
    'f0f0f0f0-0000-4000-8000-000000002140', gen_random_uuid(), repeat('b', 64))),
  'z-canonical-other.test', 'a different tenant still uses its own oldest host'
);
reset role;

-- Age the existing sending lease before making each fresh claim.
update private.client_welcome_emails set claimed_at = now() - interval '11 minutes'
where profile_id = '20000000-0000-4000-8000-000000002142';
update public.tenant_domains set is_primary = false where host = 'services.wolfforgedigitalagency.com';

set local role service_role;
select is(
  (select canonical_host from public.app_server_claim_client_welcome_email(
    '20000000-0000-4000-8000-000000002141', '20000000-0000-4000-8000-000000002142',
    'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('c', 64))),
  'b-canonical-older.test', 'without a primary the original created_at then host order is preserved'
);
reset role;

update private.client_welcome_emails set claimed_at = now() - interval '11 minutes'
where profile_id = '20000000-0000-4000-8000-000000002142';
update public.tenant_domains set is_primary = true, disabled_at = now()
where host = 'services.wolfforgedigitalagency.com';

set local role service_role;
select is(
  (select canonical_host from public.app_server_claim_client_welcome_email(
    '20000000-0000-4000-8000-000000002141', '20000000-0000-4000-8000-000000002142',
    'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('d', 64))),
  'b-canonical-older.test', 'a disabled primary is skipped'
);
reset role;

update private.client_welcome_emails set claimed_at = now() - interval '11 minutes'
where profile_id = '20000000-0000-4000-8000-000000002142';
update public.tenant_domains set disabled_at = null, verified_at = null
where host = 'services.wolfforgedigitalagency.com';

set local role service_role;
select is(
  (select canonical_host from public.app_server_claim_client_welcome_email(
    '20000000-0000-4000-8000-000000002141', '20000000-0000-4000-8000-000000002142',
    'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('e', 64))),
  'b-canonical-older.test', 'an unverified primary is skipped'
);
reset role;

select lives_ok(
  $$update public.tenant_domains set is_primary = true where host = 'a-canonical-other.test'$$,
  'a separate tenant can have its own primary'
);

select * from finish();
rollback;