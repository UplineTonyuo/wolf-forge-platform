begin;

select plan(13);

-- WL-2.22a (D-285): app_current_tenant_membership() also returns the
-- database-validated current Tenant, which the application uses to keep Wolf
-- Forge-only Operations surfaces closed to other Tenants. WF =
-- f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000002201.

-- 2201 WF owner + B owner (dual owner); 2202 B staff only; 2203 archived WF
-- owner membership.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'membership-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['2201', '2202', '2203']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002201', 'membership-tenant-b', 'Membership Tenant B', 'active');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where role.name = 'owner'
  and profile.id in ('20000000-0000-4000-8000-000000002201', '20000000-0000-4000-8000-000000002203');

update public.tenant_memberships set archived_at = now()
where profile_id = '20000000-0000-4000-8000-000000002203';

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-000000002201', fixture.profile_id::uuid, 'internal', role.id
from (values
  ('20000000-0000-4000-8000-000000002201', 'owner'),
  ('20000000-0000-4000-8000-000000002202', 'staff')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_selector
    when 'none' then ''
    when 'wf' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}'
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002201"}'
    when 'malformed' then '{"x-wf-tenant":"not-a-tenant"}'
    end, true);
$$;

create function pg_temp.t()
returns text
language sql
as $$
  select coalesce(string_agg(role_name || '@' || tenant_id::text, ','), '')
  from public.app_current_tenant_membership();
$$;

grant execute on function pg_temp.act(text, text), pg_temp.t() to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('2201', 'none');
select is(pg_temp.t(), 'owner@f0f0f0f0-0000-4000-8000-000000000001', 'dual owner, no selector -> Wolf Forge Tenant');
select pg_temp.act('2201', 'wf');
select is(pg_temp.t(), 'owner@f0f0f0f0-0000-4000-8000-000000000001', 'dual owner, WF selector -> Wolf Forge Tenant');
select pg_temp.act('2201', 'b');
select is(pg_temp.t(), 'owner@f0f0f0f0-0000-4000-8000-000000002201', 'dual owner, B selector -> Tenant B, not Wolf Forge');
select pg_temp.act('2201', 'malformed');
select is(pg_temp.t(), '', 'malformed selector -> no row');

select pg_temp.act('2202', 'b');
select is(pg_temp.t(), 'staff@f0f0f0f0-0000-4000-8000-000000002201', 'Tenant B staff -> Tenant B');
select pg_temp.act('2202', 'none');
select is(pg_temp.t(), '', 'Tenant B-only staff without selector -> no row (no Wolf Forge fallback)');
select pg_temp.act('2202', 'wf');
select is(pg_temp.t(), '', 'Tenant B-only staff with a WF selector -> no row');

select pg_temp.act('2203', 'none');
select is(pg_temp.t(), '', 'archived Wolf Forge membership -> no row');

reset role;
update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000002201';
set local role authenticated;
select pg_temp.act('2202', 'b');
select is(pg_temp.t(), '', 'suspended Tenant B -> no row');
reset role;

select is(
  (select pg_get_function_result('public.app_current_tenant_membership'::regproc)),
  'TABLE(account_class text, role_name text, tenant_id uuid)',
  'returns account_class, role_name, tenant_id'
);
select ok(has_function_privilege('authenticated', 'public.app_current_tenant_membership()', 'execute'),
  'authenticated may execute');
select ok(not has_function_privilege('anon', 'public.app_current_tenant_membership()', 'execute'),
  'anon may not execute');
select ok(not has_function_privilege('service_role', 'public.app_current_tenant_membership()', 'execute'),
  'service_role may not execute');

select * from finish();

rollback;
