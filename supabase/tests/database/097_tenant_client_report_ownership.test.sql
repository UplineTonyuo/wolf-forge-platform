begin;

select plan(19);

-- WL-1C.8: every Client report is owned by exactly one Tenant; its Client,
-- Service and Subscription stay inside that Tenant.
-- Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...09a1.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select col_not_null('public', 'client_reports', 'tenant_id', 'client_reports.tenant_id is NOT NULL');

select is(
  (select array_agg(table_name::text order by table_name)
    from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
      and table_name in ('client_report_sections', 'client_report_entries', 'client_report_reads')),
  null::text[],
  'report sections, entries and reads have no tenant_id and inherit through the report'
);

select is(
  (select jsonb_object_agg(conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conrelid = 'public.client_reports'::regclass
      and conname in (
        'client_reports_tenant_id_fkey', 'client_reports_company_id_fkey',
        'client_reports_service_id_fkey', 'client_reports_subscription_id_fkey'
      )),
  jsonb_build_object(
    'client_reports_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'client_reports_company_id_fkey', 'FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE RESTRICT',
    'client_reports_service_id_fkey', 'FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE RESTRICT',
    'client_reports_subscription_id_fkey', 'FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscriptions(tenant_id, id) ON DELETE RESTRICT'
  ),
  'Client reports are Tenant-owned and their Client, Service and Subscription references are Tenant-relative'
);

select is(
  (select column_default::text from information_schema.columns
    where table_schema = 'public' and table_name = 'client_reports' and column_name = 'tenant_id'),
  'private.identity_tenant_id()',
  'new Client reports default to the caller''s resolved Tenant'
);

select is(
  (select count(*) from public.client_reports where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing Client report was backfilled to the Wolf Forge Tenant'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 971 = owner U (internal in WF and B).
insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000971', 'authenticated', 'authenticated', 'report-owner-b@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009a1', 'report-tenant-b', 'Report Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000971', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Report Client', 'client'),
  ('30000000-0000-0000-0000-000000000972', 'f0f0f0f0-0000-4000-8000-0000000009a1', 'B Report Client', 'client');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where role.name = 'owner' and profile.id = '20000000-0000-0000-0000-000000000971';

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-0000000009a1', '20000000-0000-0000-0000-000000000971', 'internal', role.id
from public.roles as role where role.name = 'owner';

insert into public.services (id, tenant_id, name, subscription_eligible)
values
  ('59a00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Report Service', true),
  ('59a00000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009a1', 'B Report Service', true);

create temporary table report_payload (tenant text, payload jsonb) on commit drop;
grant select on report_payload to authenticated;
insert into report_payload
select tenant, jsonb_strip_nulls(jsonb_build_object(
  'company_id', company_id, 'service_id', service_id, 'report_lane', 'seo_package',
  'package_label', 'Tenant report', 'title', 'Tenant report', 'sections', '[]'::jsonb))
from (values
  ('wf', '30000000-0000-0000-0000-000000000971', null),
  ('b', '30000000-0000-0000-0000-000000000972', null),
  ('b-wf-client', '30000000-0000-0000-0000-000000000971', null),
  ('b-wf-service', '30000000-0000-0000-0000-000000000972', '59a00000-0000-0000-0000-000000000001')
) as fixture(tenant, company_id, service_id);

create temporary table subscription_payload (tenant text, payload jsonb) on commit drop;
grant select on subscription_payload to authenticated;
insert into subscription_payload
select tenant, jsonb_build_object(
  'company_id', company_id, 'service_id', service_id, 'plan_source', 'admin_invoice',
  'billing_anchor', current_date, 'interval_unit', 'month', 'interval_count', 1,
  'currency', 'USD', 'recurring_action', 'none',
  'items', jsonb_build_array(jsonb_build_object(
    'service_id', service_id, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100)))
from (values
  ('wf', '30000000-0000-0000-0000-000000000971', '59a00000-0000-0000-0000-000000000001'),
  ('b', '30000000-0000-0000-0000-000000000972', '59a00000-0000-0000-0000-000000000002')
) as fixture(tenant, company_id, service_id);

create temporary table fixture_subscription (wf_id uuid, b_id uuid) on commit drop;
grant select, insert, update on fixture_subscription to authenticated;
insert into fixture_subscription values (null, null);

-- -----------------------------------------------------------------------------
-- Normal report drafting takes the caller's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000971';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_report_draft(gen_random_uuid(),
    (select payload from report_payload where tenant = 'wf'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in report draft without a selector lands in Wolf Forge'
);
update fixture_subscription set wf_id = (select id from public.app_create_subscription(
  gen_random_uuid(), (select payload from subscription_payload where tenant = 'wf')));

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009a1"}', true);
select is(
  (select tenant_id from public.app_create_report_draft(gen_random_uuid(),
    (select payload from report_payload where tenant = 'b'))),
  'f0f0f0f0-0000-4000-8000-0000000009a1'::uuid,
  'a signed-in report draft with the Tenant B selector lands in Tenant B'
);
update fixture_subscription set b_id = (select id from public.app_create_subscription(
  gen_random_uuid(), (select payload from subscription_payload where tenant = 'b')));

-- Since WL-2.1 the RPC refuses a foreign Client / Service before the insert;
-- the composite keys behind it are proven by the trusted writes below.
select throws_ok(
  $$select public.app_create_report_draft(gen_random_uuid(),
    (select payload from report_payload where tenant = 'b-wf-client'))$$,
  '23503',
  'active client company is required',
  'a Tenant B report draft cannot be addressed to a Wolf Forge Client'
);

select throws_ok(
  $$select public.app_create_report_draft(gen_random_uuid(),
    (select payload from report_payload where tenant = 'b-wf-service'))$$,
  '23503',
  'active Reporting Service is required',
  'a Tenant B report draft cannot be tied to a Wolf Forge Service'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_report_draft(gen_random_uuid(),
    (select payload from report_payload where tenant = 'b'))$$,
  '42501',
  null,
  'app_create_report_draft with an invalid selector creates nothing'
);

select set_config('request.headers', '', true);
reset role;
-- Trusted writes below run without a signed-in user.
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.client_reports where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009a1'),
  1::bigint,
  'only the valid Tenant B report was created; failed attempts left nothing behind'
);

-- -----------------------------------------------------------------------------
-- Cross-Tenant report references are rejected even for trusted writes
-- -----------------------------------------------------------------------------

create function pg_temp.report(p_tenant uuid, p_company uuid, p_service uuid, p_subscription uuid)
returns void
language sql
as $$
  insert into public.client_reports (tenant_id, company_id, service_id, subscription_id,
    report_lane, package_label, title, sent_by_profile_id, status, sent_at)
  values (p_tenant, p_company, p_service, p_subscription, 'seo_package', 'Trusted report',
    'Trusted report', '20000000-0000-0000-0000-000000000971', 'draft', null);
$$;

select throws_ok(
  $$select pg_temp.report('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000972', null, null)$$,
  '23503',
  'insert or update on table "client_reports" violates foreign key constraint "client_reports_company_id_fkey"',
  'a Wolf Forge report cannot be addressed to a Tenant B Client'
);

select throws_ok(
  $$select pg_temp.report('f0f0f0f0-0000-4000-8000-0000000009a1', '30000000-0000-0000-0000-000000000971', null, null)$$,
  '23503',
  'insert or update on table "client_reports" violates foreign key constraint "client_reports_company_id_fkey"',
  'a Tenant B report cannot be addressed to a Wolf Forge Client'
);

select throws_ok(
  $$select pg_temp.report('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000971',
    '59a00000-0000-0000-0000-000000000002', null)$$,
  '23503',
  'insert or update on table "client_reports" violates foreign key constraint "client_reports_service_id_fkey"',
  'a Wolf Forge report cannot be tied to a Tenant B Service'
);

select throws_ok(
  $$select pg_temp.report('f0f0f0f0-0000-4000-8000-0000000009a1', '30000000-0000-0000-0000-000000000972',
    '59a00000-0000-0000-0000-000000000001', null)$$,
  '23503',
  'insert or update on table "client_reports" violates foreign key constraint "client_reports_service_id_fkey"',
  'a Tenant B report cannot be tied to a Wolf Forge Service'
);

select throws_ok(
  format($$select pg_temp.report('f0f0f0f0-0000-4000-8000-0000000009a1', '30000000-0000-0000-0000-000000000972',
    '59a00000-0000-0000-0000-000000000002', %L)$$, (select wf_id from fixture_subscription)),
  '23503',
  'insert or update on table "client_reports" violates foreign key constraint "client_reports_subscription_id_fkey"',
  'a Tenant B report cannot be tied to a Wolf Forge Subscription'
);

select throws_ok(
  format($$select pg_temp.report('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000971',
    '59a00000-0000-0000-0000-000000000001', %L)$$, (select b_id from fixture_subscription)),
  '23503',
  'insert or update on table "client_reports" violates foreign key constraint "client_reports_subscription_id_fkey"',
  'a Wolf Forge report cannot be tied to a Tenant B Subscription'
);

select lives_ok(
  format($$select pg_temp.report('f0f0f0f0-0000-4000-8000-0000000009a1', '30000000-0000-0000-0000-000000000972',
    '59a00000-0000-0000-0000-000000000002', %L)$$, (select b_id from fixture_subscription)),
  'a Tenant B report can reference a Tenant B Client, Service and Subscription'
);

select throws_ok(
  $$update public.client_reports set tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001'
    where company_id = '30000000-0000-0000-0000-000000000972'$$,
  '23503',
  null,
  'a Tenant B report cannot be moved to another Tenant while it references Tenant B rows'
);

select * from finish();
rollback;
