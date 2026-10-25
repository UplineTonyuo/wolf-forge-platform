begin;

select plan(47);

-- WL-2.22b (KI-125): verified request host -> Tenant selector. The host map
-- only selects; membership in the database still authorizes. WF =
-- f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...0000000120b1, Tenant C
-- = ...0000000120c1 (suspended later).
--
-- 2601 B staff only; 2602 B client only; 2603 WF owner + B client (dual);
-- 2604 WF owner only; 2605 archived B staff membership; 2606 no membership;
-- 2607 C staff.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'tenant-domains-' || n || '@example.invalid', now(), now()
from unnest(array['2601', '2602', '2603', '2604', '2605', '2606', '2607']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-0000000120b1', 'tenant-domains-b', 'Tenant Domains B', 'active'),
  ('f0f0f0f0-0000-4000-8000-0000000120c1', 'tenant-domains-c', 'Tenant Domains C', 'active');

insert into public.companies (id, tenant_id, name, status)
values ('c0000000-0000-4000-8000-000000002601', 'f0f0f0f0-0000-4000-8000-0000000120b1', 'TENANT_DOMAINS_B_CLIENT', 'client');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where role.name = 'owner'
  and profile.id in ('20000000-0000-4000-8000-000000002603', '20000000-0000-4000-8000-000000002604');

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at::timestamptz
from (values
  ('f0f0f0f0-0000-4000-8000-0000000120b1', '20000000-0000-4000-8000-000000002601', 'internal', 'staff', null, null),
  ('f0f0f0f0-0000-4000-8000-0000000120b1', '20000000-0000-4000-8000-000000002602', 'client', 'client', 'c0000000-0000-4000-8000-000000002601', null),
  ('f0f0f0f0-0000-4000-8000-0000000120b1', '20000000-0000-4000-8000-000000002603', 'client', 'client', 'c0000000-0000-4000-8000-000000002601', null),
  ('f0f0f0f0-0000-4000-8000-0000000120b1', '20000000-0000-4000-8000-000000002605', 'internal', 'staff', null, '2026-10-01'),
  ('f0f0f0f0-0000-4000-8000-0000000120c1', '20000000-0000-4000-8000-000000002607', 'internal', 'staff', null, null)
) as fixture(tenant_id, profile_id, account_class, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.tenant_domains (host, tenant_id, verified_at, disabled_at)
values
  ('tenant-b.test', 'f0f0f0f0-0000-4000-8000-0000000120b1', now(), null),
  ('unverified-b.test', 'f0f0f0f0-0000-4000-8000-0000000120b1', null, null),
  ('disabled-b.test', 'f0f0f0f0-0000-4000-8000-0000000120b1', now(), now()),
  ('tenant-c.test', 'f0f0f0f0-0000-4000-8000-0000000120c1', now(), null);

-- Acts as p_actor with the selector the proxy would forward for p_host. The
-- lookup runs as the anon role the proxy uses.
create function pg_temp.on_host(p_actor text, p_host text)
returns void
language plpgsql
as $$
declare
  resolved uuid;
begin
  reset role;
  set local role anon;
  resolved := public.app_resolve_tenant_host(p_host);
  reset role;
  if resolved is null then
    raise exception 'host % does not resolve', p_host;
  end if;
  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  perform set_config('request.headers', json_build_object('x-wf-tenant', resolved)::text, true);
  set local role authenticated;
end;
$$;

create function pg_temp.t()
returns text
language sql
as $$
  select coalesce(string_agg(account_class || ':' || role_name || '@' || tenant_id::text, ','), '')
  from public.app_current_tenant_membership();
$$;

create function pg_temp.resolve_as_anon(p_host text)
returns uuid
language plpgsql
as $$
declare
  resolved uuid;
begin
  set local role anon;
  resolved := public.app_resolve_tenant_host(p_host);
  reset role;
  return resolved;
end;
$$;

grant execute on function pg_temp.t() to authenticated;
grant execute on function pg_temp.resolve_as_anon(text) to anon;
set local "request.jwt.claim.role" = 'authenticated';

-- Shape and lock-down.
select col_is_pk('public', 'tenant_domains', 'host', 'host is the primary key (one mapping per host)');
select fk_ok('public', 'tenant_domains', 'tenant_id', 'public', 'tenants', 'id');
select col_not_null('public', 'tenant_domains', 'tenant_id', 'tenant_id is required');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tenant_domains'::regclass),
  'RLS is enabled and forced');
select ok(not has_table_privilege('anon', 'public.tenant_domains', 'select'), 'anon cannot read the map');
select ok(not has_table_privilege('authenticated', 'public.tenant_domains', 'select'), 'authenticated cannot read the map');
select ok(not has_table_privilege('authenticated', 'public.tenant_domains', 'insert'), 'authenticated cannot insert');
select ok(not has_table_privilege('authenticated', 'public.tenant_domains', 'update'), 'authenticated cannot update');
select ok(not has_table_privilege('service_role', 'public.tenant_domains', 'insert'), 'service_role cannot insert');
select ok(not has_table_privilege('service_role', 'public.tenant_domains', 'select'), 'service_role cannot read the map');
select ok(not (has_table_privilege('anon', 'public.tenant_domains', 'insert')
  or has_table_privilege('anon', 'public.tenant_domains', 'update')
  or has_table_privilege('anon', 'public.tenant_domains', 'delete')), 'anon cannot write the map');
select ok((select prosecdef from pg_proc where oid = 'public.app_resolve_tenant_host(text)'::regprocedure),
  'resolver is security definer');
select is((select proconfig from pg_proc where oid = 'public.app_resolve_tenant_host(text)'::regprocedure),
  array['search_path=""'], 'resolver pins an empty search_path');
select ok(has_function_privilege('anon', 'public.app_resolve_tenant_host(text)', 'execute'), 'anon may resolve');
select ok(not has_function_privilege('authenticated', 'public.app_resolve_tenant_host(text)', 'execute'),
  'authenticated may not call the resolver');
select ok(not has_function_privilege('service_role', 'public.app_resolve_tenant_host(text)', 'execute'),
  'service_role may not call the resolver');

set local role authenticated;
select throws_ok($$ insert into public.tenant_domains (host, tenant_id, verified_at)
  values ('attacker.test', 'f0f0f0f0-0000-4000-8000-0000000120b1', now()) $$, '42501', null,
  'a signed-in user cannot register a host');
select throws_ok($$ update public.tenant_domains set verified_at = now() where host = 'unverified-b.test' $$,
  '42501', null, 'a signed-in user cannot verify a host');
reset role;

-- Canonical host values only.
select throws_ok($$ insert into public.tenant_domains (host, tenant_id) values ('Tenant-B.test', private.wolf_forge_tenant_id()) $$,
  '23514', null, 'uppercase host rejected');
select throws_ok($$ insert into public.tenant_domains (host, tenant_id) values ('tenant-b.test:443', private.wolf_forge_tenant_id()) $$,
  '23514', null, 'host with port rejected');
select throws_ok($$ insert into public.tenant_domains (host, tenant_id) values ('*.tenant-b.test', private.wolf_forge_tenant_id()) $$,
  '23514', null, 'wildcard rejected');
select throws_ok($$ insert into public.tenant_domains (host, tenant_id) values ('localhost', private.wolf_forge_tenant_id()) $$,
  '23514', null, 'single-label host rejected');
select throws_ok($$ insert into public.tenant_domains (host, tenant_id) values ('tenant-b.test', private.wolf_forge_tenant_id()) $$,
  '23505', null, 'a host maps to exactly one Tenant');

-- Resolution.
select is(pg_temp.resolve_as_anon('tenant-b.test'), 'f0f0f0f0-0000-4000-8000-0000000120b1'::uuid, 'verified host -> Tenant B');
select is(pg_temp.resolve_as_anon('unverified-b.test'), null, 'unverified host -> nothing');
select is(pg_temp.resolve_as_anon('disabled-b.test'), null, 'disabled host -> nothing');
select is(pg_temp.resolve_as_anon('unknown.test'), null, 'unknown host -> nothing');
select is(pg_temp.resolve_as_anon('TENANT-B.test'), null, 'matching is exact (no case folding in SQL)');
select is(pg_temp.resolve_as_anon('wolf-forge-platform-woad.vercel.app'), private.wolf_forge_tenant_id(),
  'seeded Wolf Forge production alias');
select is(pg_temp.resolve_as_anon('wolf-forge-platform-wolf-forge.vercel.app'), private.wolf_forge_tenant_id(),
  'seeded Wolf Forge project alias');
select is(pg_temp.resolve_as_anon('wolf-forge-platform-git-rehearsal14-unregistered-wolf-forge.vercel.app'), null,
  'branch alias is not registered (fails closed)');

-- Access follows the host's Tenant; membership decides.
select pg_temp.on_host('2601', 'tenant-b.test');
select is(pg_temp.t(), 'internal:staff@f0f0f0f0-0000-4000-8000-0000000120b1', 'B staff on B host -> B internal');
select pg_temp.on_host('2602', 'tenant-b.test');
select is(pg_temp.t(), 'client:client@f0f0f0f0-0000-4000-8000-0000000120b1', 'B client on B host -> B client');
select is((select company_id from public.app_get_client_account_context()), 'c0000000-0000-4000-8000-000000002601'::uuid,
  'B client on B host -> B client portal account');
select pg_temp.on_host('2603', 'tenant-b.test');
select is(pg_temp.t(), 'client:client@f0f0f0f0-0000-4000-8000-0000000120b1', 'dual user on B host -> B client');
select pg_temp.on_host('2603', 'wolf-forge-platform-woad.vercel.app');
select is(pg_temp.t(), 'internal:owner@f0f0f0f0-0000-4000-8000-000000000001', 'dual user on WF host -> WF owner');
select pg_temp.on_host('2604', 'tenant-b.test');
select is(pg_temp.t(), '', 'WF-only owner on B host -> denied (host cannot override membership)');
select throws_ok($$ select * from public.app_get_client_account_context() $$, '42501', null,
  'WF-only owner on B host -> no client portal');
select pg_temp.on_host('2601', 'wolf-forge-platform-woad.vercel.app');
select is(pg_temp.t(), '', 'B-only staff on WF host -> denied');
select pg_temp.on_host('2605', 'tenant-b.test');
select is(pg_temp.t(), '', 'archived B membership -> denied');
select pg_temp.on_host('2606', 'tenant-b.test');
select is(pg_temp.t(), '', 'no membership -> no row (existing unassigned behavior)');
select pg_temp.on_host('2607', 'tenant-c.test');
select is(pg_temp.t(), 'internal:staff@f0f0f0f0-0000-4000-8000-0000000120c1', 'C staff on C host while active');

reset role;
update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-0000000120c1';
select is(pg_temp.resolve_as_anon('tenant-c.test'), null, 'suspended Tenant host -> nothing');
set local role authenticated;
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000120c1"}', true);
select is(pg_temp.t(), '', 'suspended Tenant selector -> denied even if sent directly');
reset role;

update public.tenants set status = 'archived', archived_at = now() where id = 'f0f0f0f0-0000-4000-8000-0000000120c1';
select is(pg_temp.resolve_as_anon('tenant-c.test'), null, 'archived Tenant host -> nothing');

update public.tenant_domains set disabled_at = now() where host = 'tenant-b.test';
select is(pg_temp.resolve_as_anon('tenant-b.test'), null, 'disabling a verified host stops resolution');

select throws_ok($$ delete from public.tenants where id = 'f0f0f0f0-0000-4000-8000-0000000120b1' $$, '23503', null,
  'a Tenant with mapped hosts cannot be deleted out from under them');

select * from finish();

rollback;
