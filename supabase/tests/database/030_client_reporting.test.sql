begin;

select plan(42);

-- =============================================================================
-- FIXTURES
--
-- Two unrelated client companies, each with a client account, plus one admin
-- (holds reports.send) and one staff (does not). Every assertion runs as a real
-- authenticated session so RLS, the RPC guards and the grants are all exercised.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('90000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'report-admin@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'report-staff@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'report-client-a@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'report-client-b@example.invalid', now(), now()),
  ('90000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'report-client-a2@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('91000000-0000-0000-0000-00000000000a', 'Northgate Dental'),
  ('91000000-0000-0000-0000-00000000000b', 'Southgate Legal');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Report Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin' and profile_row.id = '90000000-0000-0000-0000-000000000001';

-- This suite sends reports on whatever real calendar day the suite happens to
-- run, so the fixture admin needs reports.send_anytime rather than the send
-- assertions below depending on the reporting-window date engine (covered on
-- its own in 053_reporting_send_window.test.sql).
insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('90000000-0000-0000-0000-000000000001', 'reports.send_anytime', true);

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Report Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff' and profile_row.id = '90000000-0000-0000-0000-000000000002';

update public.profiles set company_id = '91000000-0000-0000-0000-00000000000a', display_name = 'Client A'
where id = '90000000-0000-0000-0000-000000000003';

update public.profiles set company_id = '91000000-0000-0000-0000-00000000000b', display_name = 'Client B'
where id = '90000000-0000-0000-0000-000000000004';

-- A second legitimate portal user at company A: reports belong to the COMPANY.
update public.profiles set company_id = '91000000-0000-0000-0000-00000000000a', display_name = 'Client A2'
where id = '90000000-0000-0000-0000-000000000005';

-- Isolation: counts below are of fixture rows, and a local database accumulates
-- real ones. The enclosing rollback means nothing real is removed.
delete from public.notifications where entity_type = 'client_report';
delete from public.client_reports;

-- =============================================================================
-- STRUCTURE
-- =============================================================================

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where oid = 'public.client_reports'::regclass),
  'row level security is enabled and forced on client_reports'
);

select ok(
  not has_table_privilege('authenticated', 'public.client_reports', 'INSERT')
    and not has_table_privilege('authenticated', 'public.client_reports', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.client_reports', 'DELETE'),
  'no authenticated session may write client_reports directly'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where oid = 'public.client_report_sections'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class
       where oid = 'public.client_report_entries'::regclass),
  'row level security is enabled and forced on report sections and entries'
);

select ok(
  not has_table_privilege('authenticated', 'public.client_report_sections', 'INSERT')
    and not has_table_privilege('authenticated', 'public.client_report_sections', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.client_report_sections', 'DELETE')
    and not has_table_privilege('authenticated', 'public.client_report_entries', 'INSERT')
    and not has_table_privilege('authenticated', 'public.client_report_entries', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.client_report_entries', 'DELETE'),
  'no authenticated session may write report sections or entries directly'
);

select is(
  (select account_class || '|' || required_permission_key
   from public.permission_modules where module_key = 'portal_reporting'),
  'client|reporting.view',
  'portal_reporting is a client module backed by reporting.view'
);

select ok(
  private.is_client_eligible_permission('reporting.view')
    and not private.is_client_eligible_permission('reports.send'),
  'the client capability is client-eligible and the internal one is not'
);

select throws_ok(
  $$ insert into public.client_reports (company_id, report_lane, package_label, title, sent_by_profile_id)
     values ('91000000-0000-0000-0000-00000000000a', 'newsletter', 'Future Package', 'X',
             '90000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'an unsupported report lane is refused by the table'
);

insert into public.client_reports (
  id, company_id, report_lane, package_label, title, sent_by_profile_id
)
values (
  '93000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-00000000000a',
  'seo_package',
  'Future SEO Package',
  'Structure fixture',
  '90000000-0000-0000-0000-000000000001'
);

select is(
  (select package_label from public.client_reports
   where id = '93000000-0000-0000-0000-000000000001'),
  'Future SEO Package',
  'package labels remain open for future SEO services'
);

insert into public.client_report_sections (id, report_id, section_key, title, sort_order)
values (
  '93000000-0000-0000-0000-000000000002',
  '93000000-0000-0000-0000-000000000001',
  'custom_results',
  'Custom Results',
  0
);

select lives_ok(
  $$ insert into public.client_report_entries (section_id, label, value, sort_order)
     values ('93000000-0000-0000-0000-000000000002',
             'Technical SEO updated', 'Complete', 20) $$,
  'a report section accepts a text/status-only entry with no URL'
);

select lives_ok(
  $$ insert into public.client_report_entries (section_id, label, url, value, sort_order)
     values
       ('93000000-0000-0000-0000-000000000002', 'First article',
        'https://reports.example.invalid/article-1', 'Published', 10),
       ('93000000-0000-0000-0000-000000000002', 'Second article',
        'https://reports.example.invalid/article-2', null, 30) $$,
  'a report section accepts multiple external assets with optional status text'
);

select is(
  (select string_agg(label, '|' order by sort_order)
   from public.client_report_entries
   where section_id = '93000000-0000-0000-0000-000000000002'),
  'First article|Technical SEO updated|Second article',
  'report entries retain explicit ordering'
);

select throws_ok(
  $$ insert into public.client_report_entries (section_id, label, url, sort_order)
     values ('93000000-0000-0000-0000-000000000002',
             'Unsafe asset', 'javascript:alert(1)', 40) $$,
  '23514', null, 'an unsafe entry URL is refused when one is provided'
);

delete from public.client_reports where id = '93000000-0000-0000-0000-000000000001';

-- =============================================================================
-- INTERNAL: SENDING
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000001';

select is(
  (select report_lane from public.app_send_client_report(
    '92000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '91000000-0000-0000-0000-00000000000a',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 2026 SEO Performance',
      'report_url', 'https://reports.example.invalid/aug-2026'
    ))),
  'seo_package',
  'an admin sends a report to a client company'
);

select is(
  (select count(*) from public.client_reports),
  1::bigint,
  'exactly one report row was created'
);

select is(
  (select sent_by_profile_id from public.client_reports),
  '90000000-0000-0000-0000-000000000001'::uuid,
  'the sender is taken from the session, not from the payload'
);

-- Retry safety: the same request id must not send a second report.
select is(
  (select id from public.app_send_client_report(
    '92000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '91000000-0000-0000-0000-00000000000a',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 2026 SEO Performance',
      'report_url', 'https://reports.example.invalid/aug-2026'
    ))),
  (select id from public.client_reports),
  'the same request id returns the report it already created'
);

select is(
  (select count(*) from public.client_reports),
  1::bigint,
  'a retried send creates no duplicate'
);

select throws_ok(
  $$ select public.app_send_client_report(gen_random_uuid(), jsonb_build_object(
       'company_id', '91000000-0000-0000-0000-00000000000a',
       'report_lane', 'newsletter', 'package_label', 'Future Package',
       'title', 'X', 'report_url', 'https://a.invalid')) $$,
  '22023', null, 'an unsupported report lane is refused by the RPC'
);

select throws_ok(
  $$ select public.app_send_client_report(gen_random_uuid(), jsonb_build_object(
       'company_id', '91000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'report_url', 'javascript:alert(1)')) $$,
  '22023', null, 'a javascript: link is refused by the RPC'
);

select throws_ok(
  $$ select public.app_send_client_report(gen_random_uuid(), jsonb_build_object(
       'company_id', '91000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', '   ', 'report_url', 'https://a.invalid')) $$,
  '22023', null, 'a blank title is refused'
);

select throws_ok(
  $$ select public.app_send_client_report(gen_random_uuid(), jsonb_build_object(
       'company_id', gen_random_uuid(),
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'report_url', 'https://a.invalid')) $$,
  '23503', null, 'a company that does not exist cannot be targeted'
);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.notifications
   where entity_type = 'client_report'
     and recipient_profile_id in (
       '90000000-0000-0000-0000-000000000003',
       '90000000-0000-0000-0000-000000000005')),
  2::bigint,
  'every client user of the target company is notified'
);

select is(
  (select count(*) from public.notifications
   where entity_type = 'client_report'
     and recipient_profile_id in (
       '90000000-0000-0000-0000-000000000004',
       '90000000-0000-0000-0000-000000000001',
       '90000000-0000-0000-0000-000000000002')),
  0::bigint,
  'the other company, the sender and internal staff are not notified'
);

select is(
  (select distinct category || '|' || audience || '|' || href
   from public.notifications where entity_type = 'client_report'),
  'report|client|/account/reporting/' || (select id::text from public.client_reports),
  'the notification is a client report notification pointing at its native detail'
);

select is(
  (select distinct title from public.notifications where entity_type = 'client_report'),
  'New Platinum SEO report from Wolf Forge',
  'the notification names the package label, not a false report type'
);

select is(
  (select distinct body from public.notifications where entity_type = 'client_report'),
  'August 2026 SEO Performance',
  'the notification body is the report title'
);

select is(
  (select count(*) from public.activity_events
   where entity_type = 'client_report'
     and entity_id = (select id from public.client_reports)
     and action = 'client_report.sent'),
  1::bigint,
  'sending is recorded once in the audit trail'
);

-- =============================================================================
-- INTERNAL: CAPABILITY BOUNDARY
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.app_send_client_report(gen_random_uuid(), jsonb_build_object(
       'company_id', '91000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'report_url', 'https://a.invalid')) $$,
  '42501', null, 'staff without reports.send cannot send a report'
);

-- =============================================================================
-- CLIENT: OWN COMPANY ONLY
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000003';

select is(
  (select count(*) from public.app_list_my_client_reports()),
  1::bigint,
  'a client reads their own company''s report'
);

select is(
  (select title from public.app_list_my_client_reports()),
  'August 2026 SEO Performance',
  'and it is the report that was actually sent'
);

select is(
  (select is_read from public.app_list_my_client_reports()),
  false,
  'a report nobody has opened reports as unread'
);

select is(
  (select public.app_count_my_unread_reports()),
  1,
  'the unread count matches'
);

select throws_ok(
  $$ select public.app_send_client_report(gen_random_uuid(), jsonb_build_object(
       'company_id', '91000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'report_url', 'https://a.invalid')) $$,
  '42501', null, 'a client cannot send a report'
);

select throws_ok(
  $$ update public.client_reports set title = 'Edited by client' $$,
  '42501', null, 'a client cannot edit a report'
);

select throws_ok(
  $$ delete from public.client_reports $$,
  '42501', null, 'a client cannot delete a report'
);

-- Marking read is per person: this must not clear the mark for a colleague.
select is(
  (select public.app_mark_client_report_read(
    (select report_id from public.app_list_my_client_reports()))),
  true,
  'a client marks their own report read'
);

select is(
  (select public.app_count_my_unread_reports()),
  0,
  'their unread count falls to zero'
);

select is(
  (select count(*) from public.app_list_my_client_reports()),
  1::bigint,
  'and the report is still listed — read state is emphasis, not removal'
);

-- =============================================================================
-- CLIENT ISOLATION
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000004';

select is(
  (select count(*) from public.app_list_my_client_reports()),
  0::bigint,
  'a client at another company sees none of the first company''s reports'
);

select is(
  (select count(*) from public.client_reports),
  0::bigint,
  'and RLS hides the rows from a direct read too'
);

select throws_ok(
  $$ select public.app_mark_client_report_read(
       (select id from public.client_reports limit 1)) $$,
  '22023', null, 'with no visible report there is nothing for them to mark'
);

-- The colleague at company A still has it unread: read state is per person.
reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '90000000-0000-0000-0000-000000000005';

select is(
  (select public.app_count_my_unread_reports()),
  1,
  'a colleague at the same company still has the report unread'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
