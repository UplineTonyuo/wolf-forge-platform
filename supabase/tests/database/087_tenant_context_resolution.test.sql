begin;

select plan(38);

-- PostgREST sets request.headers with set_config(..., true) inside each
-- request transaction; these tests do exactly the same.

-- -----------------------------------------------------------------------------
-- Catalog and privileges
-- -----------------------------------------------------------------------------

select has_function('private', 'current_tenant_id', array[]::text[], 'current_tenant_id() exists with no parameters');
select is(
  (select count(*) from pg_proc
    where pronamespace = 'private'::regnamespace and proname = 'current_tenant_id'),
  1::bigint,
  'there is no overload that accepts a caller-supplied tenant'
);
select ok(
  (select prosecdef from pg_proc where oid = 'private.current_tenant_id()'::regprocedure),
  'current_tenant_id() is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc where oid = 'private.current_tenant_id()'::regprocedure),
  array['search_path=""'],
  'current_tenant_id() pins an empty search_path'
);
select is(
  (select provolatile::text from pg_proc where oid = 'private.current_tenant_id()'::regprocedure),
  's',
  'current_tenant_id() is STABLE'
);
select ok(
  (select rolbypassrls from pg_roles
    where oid = (select proowner from pg_proc where oid = 'private.current_tenant_id()'::regprocedure)),
  'the owner bypasses RLS, so it can read the forced-RLS tenant tables'
);
select ok(has_function_privilege('authenticated', 'private.current_tenant_id()', 'execute'),
  'authenticated can execute current_tenant_id()');
select ok(not has_function_privilege('anon', 'private.current_tenant_id()', 'execute'),
  'anon cannot execute current_tenant_id()');
select ok(not has_function_privilege('service_role', 'private.current_tenant_id()', 'execute'),
  'service_role cannot execute current_tenant_id()');
select ok(
  not exists (
    select 1 from aclexplode((select proacl from pg_proc where oid = 'private.current_tenant_id()'::regprocedure))
    where grantee = 0
  ),
  'PUBLIC has no execute grant on current_tenant_id()'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename in ('tenants', 'tenant_memberships')),
  0::bigint,
  'no policy was added to the tenant tables'
);
-- WL-2 adds Tenant RLS one domain at a time; pin exactly which policies use it.
select is(
  (select array_agg(tablename || '.' || policyname order by tablename, policyname) from pg_policies
    where coalesce(qual, '') ~ 'current_tenant_id' or coalesce(with_check, '') ~ 'current_tenant_id'),
  array[
    'activity_events.activity_events_internal_scoped_select',
    'client_contacts.client_contacts_authorized_private_select',
    'client_report_entries.client_report_entries_authorized_select',
    'client_report_sections.client_report_sections_authorized_select',
    'client_reports.client_reports_authorized_select',
    'companies.companies_internal_select',
    'coupon_discount_rules.coupon_discount_rules_authorized_internal_select',
    'coupon_discount_services.coupon_discount_services_authorized_internal_select',
    'coupon_redemptions.coupon_redemptions_authorized_internal_select',
    'coupons.coupons_authorized_internal_select',
    'form_assignments.form_assignments_authorized_select',
    'form_field_options.form_field_options_internal_select',
    'form_files.form_files_internal_select',
    'form_rules.form_rules_internal_select',
    'form_service_links.form_service_links_internal_select',
    'form_submission_values.form_submission_values_internal_select',
    'form_submissions.form_submissions_authorized_select',
    'form_version_fields.form_version_fields_internal_select',
    'form_versions.form_versions_internal_select',
    'forms.forms_internal_select',
    'invoice_payments.invoice_payments_authorized_internal_select',
    'invoice_refunds.invoice_refunds_authorized_internal_select',
    'invoices.invoices_authorized_internal_select',
    'organization_members.organization_members_private_select',
    'organizations.organizations_internal_select',
    'service_folders.service_folders_authenticated_select_active',
    'service_folders.service_folders_internal_select',
    'service_interests.service_interests_internal_select',
    'services.services_authenticated_select_active',
    'services.services_internal_select',
    'subscription_cycles.subscription_cycles_internal_select',
    'subscription_dunning_attempts.subscription_dunning_attempts_internal_select',
    'subscription_events.subscription_events_internal_select',
    'subscription_payment_methods.subscription_payment_methods_internal_select',
    'wf_card_memberships.wf_card_memberships_authorized_select'
  ]::text[],
  'only the WL-2.1 Client report, WL-2.7 Service, WL-2.8 activity, WL-2.9 Client / contact / Company, WL-2.10 wallet / payment, WL-2.11 invoice, WL-2.12 coupon, WL-2.14 Form and WL-2.24 Subscription child policies call current_tenant_id()'
);
select ok(
  not has_table_privilege('authenticated', 'public.tenant_memberships', 'select')
    and not has_table_privilege('authenticated', 'public.tenants', 'select')
    and not has_table_privilege('anon', 'public.tenant_memberships', 'select')
    and not has_table_privilege('anon', 'public.tenants', 'select'),
  'tenant tables stay unreadable to browser roles'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000871', 'authenticated', 'authenticated', 'ctx-member@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000872', 'authenticated', 'authenticated', 'ctx-nonmember@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000873', 'authenticated', 'authenticated', 'ctx-archived@example.invalid', now(), now());

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id = '20000000-0000-0000-0000-000000000871' and role.name = 'admin';

-- D-275: provision 873 into Wolf Forge explicitly before archiving it.
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select private.wolf_forge_tenant_id(), '20000000-0000-0000-0000-000000000873', 'client', role_row.id
from public.roles as role_row
where role_row.name = 'client';

update public.profiles set archived_at = now()
where id = '20000000-0000-0000-0000-000000000873';

-- A profile without a Wolf Forge membership (not reachable through the mirror
-- today; models a user of another Tenant).
delete from public.tenant_memberships
where profile_id = '20000000-0000-0000-0000-000000000872';

insert into public.tenants (id, slug, display_name, status, archived_at)
values
  ('f0f0f0f0-0000-4000-8000-0000000008b1', 'ctx-tenant-b', 'Tenant B', 'active', null),
  ('f0f0f0f0-0000-4000-8000-0000000008c1', 'ctx-tenant-c', 'Tenant C (archived)', 'archived', now()),
  ('f0f0f0f0-0000-4000-8000-0000000008d1', 'ctx-tenant-d', 'Tenant D (suspended)', 'suspended', null),
  ('f0f0f0f0-0000-4000-8000-0000000008e1', 'ctx-tenant-e', 'Tenant E', 'active', null);

-- Member 871: active in B, C (archived Tenant), D (suspended Tenant);
-- archived membership in E. Not a member of anything for 872.
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select tenant_id, '20000000-0000-0000-0000-000000000871', 'internal', role.id, archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-0000000008b1'::uuid, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-0000000008c1'::uuid, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-0000000008d1'::uuid, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-0000000008e1'::uuid, now())
) as fixture(tenant_id, archived_at)
cross join public.roles as role
where role.name = 'admin';

-- -----------------------------------------------------------------------------
-- Active Wolf Forge member
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000871';

select is(private.current_tenant_id(), 'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'no request.headers at all: member falls back to Wolf Forge');

select set_config('request.headers', '{"accept":"application/json"}', true);
select is(private.current_tenant_id(), 'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'headers without a selector: member falls back to Wolf Forge');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}', true);
select is(private.current_tenant_id(), 'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'Wolf Forge selector: member resolves Wolf Forge');

select set_config('request.headers', '{"x-wf-tenant":"F0F0F0F0-0000-4000-8000-000000000001"}', true);
select is(private.current_tenant_id(), 'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'an uppercase UUID selector is the same Tenant');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008b1"}', true);
select is(private.current_tenant_id(), 'f0f0f0f0-0000-4000-8000-0000000008b1'::uuid,
  'selector for another Tenant the caller belongs to resolves that Tenant');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009f9"}', true);
select is(private.current_tenant_id(), null::uuid,
  'selector for a Tenant without membership is NULL, not Wolf Forge');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008c1"}', true);
select is(private.current_tenant_id(), null::uuid, 'archived Tenant is NULL');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008d1"}', true);
select is(private.current_tenant_id(), null::uuid, 'suspended Tenant is NULL');

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008e1"}', true);
select is(private.current_tenant_id(), null::uuid, 'archived membership is NULL');

select set_config('request.headers', '{"x-wf-tenant":""}', true);
select is(private.current_tenant_id(), null::uuid, 'empty selector is NULL, never the fallback');

select set_config('request.headers', '{"x-wf-tenant":"not-a-uuid''; drop table x;--"}', true);
select is(private.current_tenant_id(), null::uuid, 'malformed selector is NULL without raising');

select set_config('request.headers',
  '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001, f0f0f0f0-0000-4000-8000-0000000008b1"}', true);
select is(private.current_tenant_id(), null::uuid, 'comma-joined duplicate selectors are NULL');

select set_config('request.headers', '{"x-wf-tenant":" f0f0f0f0-0000-4000-8000-000000000001"}', true);
select is(private.current_tenant_id(), null::uuid, 'padded selector is NULL');

select set_config('request.headers', '{"x-wf-tenant":null}', true);
select is(private.current_tenant_id(), null::uuid, 'JSON null selector counts as present and invalid');

select set_config('request.headers', '{"x-wf-tenant":42}', true);
select is(private.current_tenant_id(), null::uuid, 'non-string selector is NULL');

-- -----------------------------------------------------------------------------
-- Profile without membership, archived profile, no user
-- -----------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000872';
select set_config('request.headers', '{}', true);
select is(private.current_tenant_id(), null::uuid, 'non-member without selector is NULL');
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}', true);
select is(private.current_tenant_id(), null::uuid, 'non-member with Wolf Forge selector is NULL');
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000008b1"}', true);
select is(private.current_tenant_id(), null::uuid, 'non-member with a foreign selector is NULL');

set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000873';
select set_config('request.headers', '{}', true);
reset role;
select isnt(
  (select archived_at from public.tenant_memberships
    where profile_id = '20000000-0000-0000-0000-000000000873'
      and tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001'),
  null,
  'archiving the profile archived its Wolf Forge membership through the mirror'
);
set local role authenticated;
select is(private.current_tenant_id(), null::uuid, 'archived Wolf Forge membership does not fall back');

set local "request.jwt.claim.sub" = '';
select is(private.current_tenant_id(), null::uuid, 'no auth.uid() is NULL');

-- Tenant tables stay closed to the caller even though the helper reads them.
select throws_ok('select * from public.tenant_memberships', '42501', null,
  'authenticated still cannot read tenant_memberships');
select throws_ok('select * from public.tenants', '42501', null,
  'authenticated still cannot read tenants');

reset role;

set local role anon;
select throws_ok('select private.current_tenant_id()', '42501', null,
  'anon cannot execute current_tenant_id()');
reset role;

set local role service_role;
select throws_ok('select private.current_tenant_id()', '42501', null,
  'service_role cannot execute current_tenant_id()');
reset role;

select * from finish();

rollback;
