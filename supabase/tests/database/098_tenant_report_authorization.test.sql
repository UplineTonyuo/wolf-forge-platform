begin;

select plan(53);

-- WL-2.1: internal Client report functions act only on rows of the caller's
-- resolved Tenant. Knowing another Tenant's report, Client or Service id must
-- not matter. Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = ...09b1.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 981 WF admin; 982 Tenant B admin (WF membership archived); 983 WF owner;
-- 984 owner of both WF and B; 985 Tenant B admin whose B membership is archived.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select fixture.id::uuid, 'authenticated', 'authenticated', fixture.email, now(), now()
from (values
  ('20000000-0000-0000-0000-000000000981', 'report-authz-wf-admin@example.invalid'),
  ('20000000-0000-0000-0000-000000000982', 'report-authz-b-admin@example.invalid'),
  ('20000000-0000-0000-0000-000000000983', 'report-authz-wf-owner@example.invalid'),
  ('20000000-0000-0000-0000-000000000984', 'report-authz-dual-owner@example.invalid'),
  ('20000000-0000-0000-0000-000000000985', 'report-authz-stale@example.invalid')
) as fixture(id, email);

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009b1', 'report-authz-tenant-b', 'Report Authz Tenant B', 'active');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000981', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000000982', 'admin', now()),
  ('20000000-0000-0000-0000-000000000983', 'owner', null),
  ('20000000-0000-0000-0000-000000000984', 'owner', null),
  ('20000000-0000-0000-0000-000000000985', 'admin', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-0000000009b1', fixture.profile_id::uuid, 'internal', role.id, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000982', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000000984', 'owner', null),
  ('20000000-0000-0000-0000-000000000985', 'admin', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000981', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Authz Client', 'client'),
  ('30000000-0000-0000-0000-000000000982', 'f0f0f0f0-0000-4000-8000-0000000009b1', 'B Authz Client', 'client');

insert into public.services (id, tenant_id, name)
values
  ('59b00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Authz Service');

-- Rehome a supported Reporting profile within this rolled-back fixture and
-- establish the Tenant B Client's ownership through current work.
update public.services
set tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009b1',
    folder_id = null,
    assigned_to_profile_id = null
where id = '5f000000-0000-4000-8000-000000000555';

insert into public.orders (tenant_id, company_id, service_id, title, status)
values ('f0f0f0f0-0000-4000-8000-0000000009b1', '30000000-0000-0000-0000-000000000982',
  '5f000000-0000-4000-8000-000000000555', 'B Authz Reporting work', 'working');

-- Previous period; admins are outside its send window, owners send anytime.
insert into public.client_reports (id, tenant_id, company_id, service_id, report_lane,
  package_label, title, sent_by_profile_id, status, sent_at, reporting_period_month)
values
  ('59b10000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001',
   '30000000-0000-0000-0000-000000000981', null, 'seo_package',
   'WF package', 'WF secret draft', '20000000-0000-0000-0000-000000000981', 'draft', null,
   (date_trunc('month', now() at time zone 'Asia/Manila') - interval '1 month')::date),
  ('59b10000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009b1',
   '30000000-0000-0000-0000-000000000982', null, 'seo_package',
   'B package', 'B secret draft', '20000000-0000-0000-0000-000000000982', 'draft', null,
   (date_trunc('month', now() at time zone 'Asia/Manila') - interval '1 month')::date);

insert into public.client_report_sections (report_id, section_key, title, sort_order)
values
  ('59b10000-0000-0000-0000-000000000001', 'summary', 'Summary', 0),
  ('59b10000-0000-0000-0000-000000000002', 'summary', 'Summary', 0);

insert into public.client_report_entries (section_id, label, value, sort_order)
select section.id, 'Secret metric', 'secret', 0
from public.client_report_sections as section
where section.report_id in ('59b10000-0000-0000-0000-000000000001', '59b10000-0000-0000-0000-000000000002');

create temporary table authz_payload (name text, payload jsonb) on commit drop;
grant select on authz_payload to authenticated;
insert into authz_payload values
  ('save', jsonb_build_object('report_lane', 'seo_package', 'package_label', 'Hijacked',
    'title', 'Hijacked', 'sections', '[]'::jsonb)),
  ('wf-draft', jsonb_build_object('company_id', '30000000-0000-0000-0000-000000000981',
    'report_lane', 'seo_package', 'package_label', 'X', 'title', 'X', 'sections', '[]'::jsonb)),
  ('b-draft', jsonb_build_object('company_id', '30000000-0000-0000-0000-000000000982',
    'report_lane', 'seo_package', 'package_label', 'X', 'title', 'X', 'sections', '[]'::jsonb)),
  ('b-draft-wf-service', jsonb_build_object('company_id', '30000000-0000-0000-0000-000000000982',
    'service_id', '59b00000-0000-0000-0000-000000000001',
    'report_lane', 'seo_package', 'package_label', 'X', 'title', 'X', 'sections', '[]'::jsonb)),
  ('wf-quick', jsonb_build_object('company_id', '30000000-0000-0000-0000-000000000981',
    'report_lane', 'seo_package', 'package_label', 'X', 'title', 'X', 'report_url', 'https://example.invalid/r')),
  ('b-quick', jsonb_build_object('company_id', '30000000-0000-0000-0000-000000000982',
    'report_lane', 'seo_package', 'package_label', 'X', 'title', 'X', 'report_url', 'https://example.invalid/r'));

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct table reads (RLS): an internal user sees only the selected Tenant
-- -----------------------------------------------------------------------------

create temporary view authz_visible as
select 'report' as kind, report.id as report_id from public.client_reports as report
union all
select 'section', section.report_id from public.client_report_sections as section
union all
select 'entry', section.report_id
from public.client_report_entries as entry
join public.client_report_sections as section on section.id = entry.section_id;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000981', true);
select set_config('request.headers', '', true);
select is(
  (select array_agg(kind order by kind) from authz_visible where report_id = '59b10000-0000-0000-0000-000000000001'),
  array['entry', 'report', 'section'],
  'RLS A -> A: WF admin reads WF report, section and entry rows directly'
);
select is(
  (select count(*) from authz_visible where report_id = '59b10000-0000-0000-0000-000000000002'),
  0::bigint,
  'RLS A -> B: WF admin reads no Tenant B report, section or entry row directly'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000982', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);
select is(
  (select array_agg(kind order by kind) from authz_visible where report_id = '59b10000-0000-0000-0000-000000000002'),
  array['entry', 'report', 'section'],
  'RLS B -> B: Tenant B admin reads Tenant B report, section and entry rows directly'
);
select is(
  (select count(*) from authz_visible where report_id = '59b10000-0000-0000-0000-000000000001'),
  0::bigint,
  'RLS B -> A: Tenant B admin reads no WF report, section or entry row directly'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000984', true);
select is(
  (select count(*) from authz_visible where report_id = '59b10000-0000-0000-0000-000000000001'),
  0::bigint,
  'RLS: dual owner in Tenant B reads no WF report rows directly'
);
select set_config('request.headers', '', true);
select is(
  (select count(*) from authz_visible where report_id = '59b10000-0000-0000-0000-000000000002'),
  0::bigint,
  'RLS: dual owner in WF reads no Tenant B report rows directly'
);

-- -----------------------------------------------------------------------------
-- Tenant A (Wolf Forge) admin: own Tenant works, Tenant B is invisible
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000981', true);
select set_config('request.headers', '', true);

select is(
  public.app_get_internal_report('59b10000-0000-0000-0000-000000000001') ->> 'title',
  'WF secret draft',
  'A -> A: WF admin reads a WF report'
);

select is(
  (select array_agg(title::text order by title) from public.app_list_internal_reports(null, 200)
    where report_id in ('59b10000-0000-0000-0000-000000000001', '59b10000-0000-0000-0000-000000000002')),
  array['WF secret draft'],
  'A -> A: WF admin lists WF reports and never Tenant B reports'
);

select is(
  (select title from public.app_save_report_draft('59b10000-0000-0000-0000-000000000001',
    jsonb_build_object('report_lane', 'seo_package', 'package_label', 'WF package',
      'title', 'WF edited draft', 'sections', jsonb_build_array(jsonb_build_object(
        'section_key', 'summary', 'title', 'Summary', 'entries', '[]'::jsonb))))),
  'WF edited draft',
  'A -> A: WF admin saves a WF draft'
);

select ok(
  (select can_send is not null from public.app_get_report_send_status('59b10000-0000-0000-0000-000000000001')),
  'A -> A: WF admin reads a WF report send status'
);

select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'A -> B: WF admin cannot read a Tenant B report by id');
select throws_ok($$select * from public.app_get_report_send_status('59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'A -> B: WF admin cannot read a Tenant B report send status');
select throws_ok($$select public.app_save_report_draft('59b10000-0000-0000-0000-000000000002',
    (select payload from authz_payload where name = 'save'))$$,
  '42501', 'report access is denied', 'A -> B: WF admin cannot edit a Tenant B draft');
select throws_ok($$select public.app_send_report_draft(gen_random_uuid(), '59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'A -> B: WF admin cannot send a Tenant B draft');
select throws_ok($$select public.app_discard_report_draft('59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'A -> B: WF admin cannot discard a Tenant B draft');
select throws_ok($$select * from public.app_list_reporting_service_options('30000000-0000-0000-0000-000000000982',
    array['5f000000-0000-4000-8000-000000000555'::uuid])$$,
  '23503', 'active client company is required', 'A -> B: WF admin cannot list a Tenant B Client''s reporting Services');
select throws_ok($$select * from public.app_list_reported_one_time_deliverables('30000000-0000-0000-0000-000000000982',
    '5f000000-0000-4000-8000-000000000555', null)$$,
  '23503', 'active client company is required', 'A -> B: WF admin cannot read a Tenant B Client''s deliverables ledger');
select throws_ok($$select public.app_create_report_draft(gen_random_uuid(),
    (select payload from authz_payload where name = 'b-draft'))$$,
  '23503', 'active client company is required', 'A -> B: WF admin cannot draft a report for a Tenant B Client');

select is(
  (select array_agg(service_id::text) from public.app_list_reporting_service_options('30000000-0000-0000-0000-000000000981',
    array['59b00000-0000-0000-0000-000000000001'::uuid, '5f000000-0000-4000-8000-000000000555'::uuid])),
  null::text[],
  'unsupported or unowned Services never appear, including another Tenant''s Service'
);

-- -----------------------------------------------------------------------------
-- Tenant B admin (B selector): own Tenant works, Wolf Forge is invisible
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000982', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);

select is(
  public.app_get_internal_report('59b10000-0000-0000-0000-000000000002') ->> 'title',
  'B secret draft',
  'B -> B: Tenant B admin reads a Tenant B report'
);

select is(
  (select array_agg(title::text order by title) from public.app_list_internal_reports(null, 200)
    where report_id in ('59b10000-0000-0000-0000-000000000001', '59b10000-0000-0000-0000-000000000002')),
  array['B secret draft'],
  'B -> B: Tenant B admin lists Tenant B reports and never WF reports'
);

select ok(
  (select tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009b1'
    from public.app_create_report_draft(gen_random_uuid(), (select payload from authz_payload where name = 'b-draft'))),
  'B -> B: Tenant B admin drafts a report for a Tenant B Client'
);

select ok(
  (select can_send is not null from public.app_get_report_send_status('59b10000-0000-0000-0000-000000000002')),
  'B -> B: Tenant B admin reads a Tenant B report send status'
);

select lives_ok($$select * from public.app_list_reported_one_time_deliverables('30000000-0000-0000-0000-000000000982',
    '5f000000-0000-4000-8000-000000000555', null)$$,
  'B -> B: Tenant B admin reads a Tenant B Client''s deliverables ledger');

select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'B -> A: Tenant B admin cannot read a WF report by id');
select throws_ok($$select * from public.app_get_report_send_status('59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'B -> A: Tenant B admin cannot read a WF report send status');
select throws_ok($$select public.app_save_report_draft('59b10000-0000-0000-0000-000000000001',
    (select payload from authz_payload where name = 'save'))$$,
  '42501', 'report access is denied', 'B -> A: Tenant B admin cannot edit a WF draft');
select throws_ok($$select public.app_send_report_draft(gen_random_uuid(), '59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'B -> A: Tenant B admin cannot send a WF draft to the WF Client');
select throws_ok($$select public.app_discard_report_draft('59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'B -> A: Tenant B admin cannot discard a WF draft');
select throws_ok($$select * from public.app_list_reporting_service_options('30000000-0000-0000-0000-000000000981',
    array['59b00000-0000-0000-0000-000000000001'::uuid])$$,
  '23503', 'active client company is required', 'B -> A: Tenant B admin cannot list a WF Client''s reporting Services');
select throws_ok($$select * from public.app_list_reported_one_time_deliverables('30000000-0000-0000-0000-000000000981',
    '59b00000-0000-0000-0000-000000000001', null)$$,
  '23503', 'active client company is required', 'B -> A: Tenant B admin cannot read a WF Client''s deliverables ledger');
select throws_ok($$select public.app_create_report_draft(gen_random_uuid(),
    (select payload from authz_payload where name = 'wf-draft'))$$,
  '23503', 'active client company is required', 'B -> A: Tenant B admin cannot draft a report for a WF Client');
select throws_ok($$select public.app_create_report_draft(gen_random_uuid(),
    (select payload from authz_payload where name = 'b-draft-wf-service'))$$,
  '23503', 'active Reporting Service is required', 'B -> A: Tenant B admin cannot tie a draft to a WF Service');

-- No selector: the archived WF membership resolves no Tenant, so nothing works.
select set_config('request.headers', '', true);
select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000001')$$,
  '42501', null, 'B admin without a selector cannot read a WF report');
select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000002')$$,
  '42501', null, 'B admin without a selector cannot read a Tenant B report');

-- -----------------------------------------------------------------------------
-- Owner of Tenant A: owner of WF is nobody in Tenant B
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000983', true);
select set_config('request.headers', '', true);

select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'owner A -> B: WF owner cannot read a Tenant B report');
select throws_ok($$select public.app_save_report_draft('59b10000-0000-0000-0000-000000000002',
    (select payload from authz_payload where name = 'save'))$$,
  '42501', 'report access is denied', 'owner A -> B: WF owner cannot edit a Tenant B draft');
select throws_ok($$select public.app_discard_report_draft('59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'owner A -> B: WF owner cannot discard a Tenant B draft');
select throws_ok($$select public.app_send_client_report(gen_random_uuid(),
    (select payload from authz_payload where name = 'b-quick'))$$,
  '23503', 'active client company is required', 'owner A -> B: WF owner cannot quick-send a report to a Tenant B Client');

-- A foreign selector is not authorization.
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);
select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000002')$$,
  '42501', null, 'owner A with the Tenant B selector but no B membership cannot read a Tenant B report');

-- -----------------------------------------------------------------------------
-- Owner of both Tenants: the selected Tenant bounds every call
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000984', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);

select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'dual owner in Tenant B cannot read a WF report');
select throws_ok($$select public.app_send_report_draft(gen_random_uuid(), '59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'dual owner in Tenant B cannot send a WF draft');
select throws_ok($$select public.app_discard_report_draft('59b10000-0000-0000-0000-000000000001')$$,
  '42501', 'report access is denied', 'dual owner in Tenant B cannot discard a WF draft');

-- Owners hold reports.send_anytime, so the send window is not what stops these.
select throws_ok($$select public.app_send_client_report(gen_random_uuid(),
    (select payload from authz_payload where name = 'wf-quick'))$$,
  '23503', 'active client company is required', 'dual owner in Tenant B cannot quick-send a report to a WF Client');

select is(
  (select status from public.app_send_report_draft(gen_random_uuid(), '59b10000-0000-0000-0000-000000000002')),
  'sent',
  'B -> B: dual owner in Tenant B sends the Tenant B draft'
);

select is(
  (select tenant_id from public.app_send_client_report(gen_random_uuid(),
    (select payload from authz_payload where name = 'b-quick'))),
  'f0f0f0f0-0000-4000-8000-0000000009b1'::uuid,
  'B -> B: dual owner in Tenant B quick-sends a report to a Tenant B Client'
);

select set_config('request.headers', '', true);
select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000002')$$,
  '42501', 'report access is denied', 'dual owner in WF cannot read a Tenant B report');
select throws_ok($$select public.app_save_report_draft('59b10000-0000-0000-0000-000000000002',
    (select payload from authz_payload where name = 'save'))$$,
  '42501', 'report access is denied', 'dual owner in WF cannot edit a Tenant B report');

-- -----------------------------------------------------------------------------
-- Stale membership: an archived Tenant B membership authorizes nothing
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000985', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);

select throws_ok($$select public.app_get_internal_report('59b10000-0000-0000-0000-000000000002')$$,
  '42501', null, 'archived Tenant B admin cannot read a Tenant B report');
select throws_ok($$select public.app_discard_report_draft('59b10000-0000-0000-0000-000000000002')$$,
  '42501', null, 'archived Tenant B admin cannot discard a Tenant B report');

-- -----------------------------------------------------------------------------
-- Readback: every attack left the target untouched
-- -----------------------------------------------------------------------------

select set_config('request.headers', '', true);
reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select row(title, package_label, status)::text from public.client_reports
    where id = '59b10000-0000-0000-0000-000000000001'),
  row('WF edited draft', 'WF package', 'draft')::text,
  'the WF draft holds only its own admin''s edit: never hijacked, sent or discarded'
);

select is(
  (select row(title, package_label, status, sent_by_profile_id)::text from public.client_reports
    where id = '59b10000-0000-0000-0000-000000000002'),
  row('B secret draft', 'B package', 'sent', '20000000-0000-0000-0000-000000000984'::uuid)::text,
  'the Tenant B report was sent only by its own Tenant member and never edited from WF'
);

select is(
  (select count(*) from public.client_reports
    where company_id in ('30000000-0000-0000-0000-000000000981', '30000000-0000-0000-0000-000000000982')),
  4::bigint,
  'only the two fixtures and the two same-Tenant B reports exist; no cross-Tenant report was created'
);

select * from finish();
rollback;
