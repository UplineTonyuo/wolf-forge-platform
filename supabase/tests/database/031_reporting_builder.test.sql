begin;

select plan(61);

-- =============================================================================
-- FIXTURES
--
-- Two unrelated client companies, one admin holding reports.send, one staff
-- who does not, and two client accounts at company A. Every assertion runs as a
-- real authenticated session, so RLS, the module guard, the capability check
-- and the grants are all exercised rather than assumed.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('95000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'builder-admin@example.invalid', now(), now()),
  ('95000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'builder-staff@example.invalid', now(), now()),
  ('95000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'builder-client-a@example.invalid', now(), now()),
  ('95000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'builder-client-b@example.invalid', now(), now()),
  ('95000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'builder-client-a2@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('96000000-0000-0000-0000-00000000000a', 'Northgate Dental'),
  ('96000000-0000-0000-0000-00000000000b', 'Southgate Legal');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Builder Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin' and profile_row.id = '95000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Builder Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff' and profile_row.id = '95000000-0000-0000-0000-000000000002';

update public.profiles set company_id = '96000000-0000-0000-0000-00000000000a', display_name = 'Client A'
where id = '95000000-0000-0000-0000-000000000003';

update public.profiles set company_id = '96000000-0000-0000-0000-00000000000b', display_name = 'Client B'
where id = '95000000-0000-0000-0000-000000000004';

update public.profiles set company_id = '96000000-0000-0000-0000-00000000000a', display_name = 'Client A2'
where id = '95000000-0000-0000-0000-000000000005';

-- Isolation: a local database accumulates real rows and the counts below are of
-- fixture rows. The enclosing rollback means nothing real is removed.
delete from public.notifications where entity_type = 'client_report';
delete from public.client_reports;

-- =============================================================================
-- STRUCTURE
-- =============================================================================

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'client_reports' and column_name = 'status'),
  '''sent''::text',
  'existing reports default to sent, so nothing already delivered becomes a draft'
);

select ok(
  (select is_nullable = 'YES' from information_schema.columns
   where table_schema = 'public' and table_name = 'client_reports' and column_name = 'sent_at'),
  'sent_at is nullable, because a draft has not been sent'
);

select throws_ok(
  $$ insert into public.client_reports
       (company_id, report_lane, package_label, title, sent_by_profile_id, status, sent_at)
     values ('96000000-0000-0000-0000-00000000000a', 'seo_package', 'Platinum SEO',
             'Impossible', '95000000-0000-0000-0000-000000000001', 'draft', now()) $$,
  '23514', null, 'a draft may not carry a send time'
);

select throws_ok(
  $$ insert into public.client_reports
       (company_id, report_lane, package_label, title, sent_by_profile_id, status, sent_at)
     values ('96000000-0000-0000-0000-00000000000a', 'seo_package', 'Platinum SEO',
             'Impossible', '95000000-0000-0000-0000-000000000001', 'sent', null) $$,
  '23514', null, 'a sent report must carry a send time'
);

select throws_ok(
  $$ insert into public.client_reports
       (company_id, report_lane, package_label, title, sent_by_profile_id, status)
     values ('96000000-0000-0000-0000-00000000000a', 'seo_package', 'Platinum SEO',
             'Impossible', '95000000-0000-0000-0000-000000000001', 'scheduled') $$,
  '23514', null, 'there are exactly two report states'
);

select is(
  (select account_class || '|' || required_permission_key
   from public.permission_modules where module_key = 'reporting'),
  'internal|reports.send',
  'the builder module is internal and backed by reports.send'
);

select ok(
  not private.is_client_eligible_permission('reports.send'),
  'and reports.send remains ineligible for a client account'
);

select ok(
  not has_table_privilege('authenticated', 'public.client_reports', 'INSERT')
    and not has_table_privilege('authenticated', 'public.client_reports', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.client_reports', 'DELETE')
    and not has_table_privilege('authenticated', 'public.client_report_sections', 'INSERT')
    and not has_table_privilege('authenticated', 'public.client_report_entries', 'INSERT'),
  'the builder added no direct table write privileges'
);

select ok(
  not has_function_privilege('authenticated', 'private.replace_report_structure(uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.require_editable_report(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.validate_report_sections(jsonb)', 'EXECUTE'),
  'the private builder helpers are not reachable from a session'
);

select is(
  (select count(*)::integer from pg_proc as proc
   join pg_namespace as namespace on namespace.oid = proc.pronamespace
   where namespace.nspname in ('public', 'private')
     and proc.proname in (
       'app_create_report_draft', 'app_save_report_draft', 'app_send_report_draft',
       'app_discard_report_draft', 'app_list_internal_reports', 'app_get_internal_report',
       'replace_report_structure', 'require_editable_report')
     and proc.proconfig @> array['search_path=""']),
  8,
  'every new reporting function locks its search_path'
);

-- =============================================================================
-- INTERNAL: CREATING A DRAFT
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000001';

select is(
  (select status from public.app_create_report_draft(
    '97000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '96000000-0000-0000-0000-00000000000a',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 2026 SEO Report',
      'sections', jsonb_build_array(
        jsonb_build_object(
          'section_key', 'geo_ranking', 'title', 'GEO Ranking',
          'entries', jsonb_build_array(
            jsonb_build_object('label', 'junk removal', 'value', 'RANK 2.12', 'url', null),
            jsonb_build_object('label', 'junk removal company', 'value', 'RANK 1.22', 'url', null)
          )
        ),
        jsonb_build_object(
          'section_key', 'technical_seo', 'title', 'Technical SEO',
          'entries', jsonb_build_array(
            jsonb_build_object('label', 'Technical SEO', 'value', 'Technical SEO updated',
                               'url', null)
          )
        )
      )
    ))),
  'draft',
  'an admin creates a report as a draft'
);

select ok(
  (select sent_at is null from public.client_reports
   where title = 'August 2026 SEO Report'),
  'and the draft has no send time'
);

select is(
  (select string_agg(section_key, '|' order by sort_order)
   from public.client_report_sections as section
   join public.client_reports as report on report.id = section.report_id
   where report.title = 'August 2026 SEO Report'),
  'geo_ranking|technical_seo',
  'sections are stored in the order the array supplied them'
);

select is(
  (select string_agg(entry.label, '|' order by entry.sort_order)
   from public.client_report_entries as entry
   join public.client_report_sections as section on section.id = entry.section_id
   join public.client_reports as report on report.id = section.report_id
   where report.title = 'August 2026 SEO Report' and section.section_key = 'geo_ranking'),
  'junk removal|junk removal company',
  'entries are stored in the order the array supplied them'
);

-- Counting notifications needs the privileged session back for a moment.
reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.notifications where entity_type = 'client_report'),
  0::bigint,
  'creating a draft notifies nobody'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000001';

-- Retry safety: the same request id must not create a second draft.
select is(
  (select count(*) from public.client_reports),
  1::bigint,
  'exactly one report exists so far'
);

select is(
  (select id from public.app_create_report_draft(
    '97000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '96000000-0000-0000-0000-00000000000a',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 2026 SEO Report',
      'sections', jsonb_build_array(
        jsonb_build_object(
          'section_key', 'geo_ranking', 'title', 'GEO Ranking',
          'entries', jsonb_build_array(
            jsonb_build_object('label', 'junk removal', 'value', 'RANK 2.12', 'url', null),
            jsonb_build_object('label', 'junk removal company', 'value', 'RANK 1.22', 'url', null)
          )
        ),
        jsonb_build_object(
          'section_key', 'technical_seo', 'title', 'Technical SEO',
          'entries', jsonb_build_array(
            jsonb_build_object('label', 'Technical SEO', 'value', 'Technical SEO updated',
                               'url', null)
          )
        )
      )
    ))),
  (select id from public.client_reports),
  'the same request id returns the draft it already created'
);

-- =============================================================================
-- INTERNAL: SERVER-SIDE VALIDATION
-- =============================================================================

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'website', 'package_label', 'Anything',
       'title', 'X', 'sections', '[]'::jsonb)) $$,
  '22023', null, 'a lane outside the two is refused'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', '   ', 'sections', '[]'::jsonb)) $$,
  '22023', null, 'a blank title is refused'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', gen_random_uuid(),
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'sections', '[]'::jsonb)) $$,
  '23503', null, 'a company that does not exist cannot be targeted'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO', 'title', 'X',
       'sections', jsonb_build_array(jsonb_build_object(
         'section_key', 'audits', 'title', 'Audits',
         'entries', jsonb_build_array(
           jsonb_build_object('label', 'Unsafe', 'value', null, 'url', 'javascript:alert(1)')))))) $$,
  '22023', null, 'an unsafe entry link is refused by the RPC'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO', 'title', 'X',
       'sections', jsonb_build_array(jsonb_build_object(
         'section_key', 'audits', 'title', 'Audits',
         'entries', jsonb_build_array(
           jsonb_build_object('label', '  ', 'value', 'something', 'url', null)))))) $$,
  '22023', null, 'an entry with no label is refused'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO', 'title', 'X',
       'sections', jsonb_build_array(jsonb_build_object(
         'section_key', 'Not A Key', 'title', 'Audits', 'entries', '[]'::jsonb)))) $$,
  '22023', null, 'a section key outside the lowercase form is refused'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO', 'title', 'X',
       'sections', (select jsonb_agg(jsonb_build_object(
         'section_key', 'section_' || generated, 'title', 'Section', 'entries', '[]'::jsonb))
         from generate_series(1, 101) as generated))) $$,
  '22023', null, 'more sections than a report may hold is refused'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO', 'title', 'X',
       'sections', '[]'::jsonb, 'status', 'sent')) $$,
  '22023', null, 'an unexpected payload key is refused rather than ignored'
);

-- =============================================================================
-- INTERNAL: SAVING A DRAFT
--
-- Whole-document replacement: a reorder, a removal, an edit and a new entry in
-- one call either all land or none do.
-- =============================================================================

select is(
  (select title from public.app_save_report_draft(
    (select id from public.client_reports),
    jsonb_build_object(
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 1-31, 2026',
      'sections', jsonb_build_array(
        jsonb_build_object(
          'section_key', 'technical_seo', 'title', 'Technical SEO',
          'entries', jsonb_build_array(
            jsonb_build_object('label', 'GMB Verification',
                               'value', 'GMB need to be verified', 'url', null),
            jsonb_build_object('label', 'Site Audit Before', 'value', null,
                               'url', 'https://reports.example.invalid/before'),
            jsonb_build_object('label', 'Blog Posts', 'value', '4 posts completed',
                               'url', 'https://reports.example.invalid/blog')
          )
        ),
        jsonb_build_object(
          'section_key', 'client_wins', 'title', 'Client Wins',
          'entries', jsonb_build_array(
            jsonb_build_object('label', 'Ranking', 'value', 'Improved from 12 to 4', 'url', null)
          )
        )
      )
    ))),
  'August 1-31, 2026',
  'the report header is updated in place'
);

select is(
  (select string_agg(section_key, '|' order by sort_order)
   from public.client_report_sections as section
   join public.client_reports as report on report.id = section.report_id),
  'technical_seo|client_wins',
  'a removed section is gone, a custom section is added and the order is the array order'
);

select is(
  (select string_agg(
     entry.label || '=' || coalesce(entry.value, '~') || '/' || coalesce(entry.url, '~'),
     '|' order by entry.sort_order)
   from public.client_report_entries as entry
   join public.client_report_sections as section on section.id = entry.section_id
   where section.section_key = 'technical_seo'),
  'GMB Verification=GMB need to be verified/~'
    || '|Site Audit Before=~/https://reports.example.invalid/before'
    || '|Blog Posts=4 posts completed/https://reports.example.invalid/blog',
  'value-only, link-only and value-with-link entries are all stored as supplied'
);

select is(
  (select count(*) from public.client_report_entries as entry
   join public.client_report_sections as section on section.id = entry.section_id
   where section.section_key = 'geo_ranking'),
  0::bigint,
  'the removed section took its entries with it'
);

select throws_ok(
  $$ select public.app_save_report_draft(gen_random_uuid(), jsonb_build_object(
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'sections', '[]'::jsonb)) $$,
  '42501', null, 'a report id that does not exist cannot be edited'
);

-- =============================================================================
-- CLIENT: A DRAFT IS NOT A REPORT
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000003';

select is(
  (select count(*) from public.app_list_my_client_reports()),
  0::bigint,
  'a client is not shown their company''s unsent draft'
);

select is(
  (select public.app_count_my_unread_reports()),
  0,
  'and it does not badge the rail'
);

select is(
  (select count(*) from public.client_reports),
  0::bigint,
  'RLS hides the draft row from a direct read as well'
);

select throws_ok(
  $$ select public.app_mark_client_report_read(
       (select id from public.client_reports limit 1)) $$,
  '22023', null, 'and there is no draft for them to mark read'
);

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'sections', '[]'::jsonb)) $$,
  '42501', null, 'a client cannot reach the internal reporting module'
);

select throws_ok(
  $$ select public.app_list_internal_reports() $$,
  '42501', null, 'nor the internal report list'
);

-- =============================================================================
-- INTERNAL: CAPABILITY BOUNDARY
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '96000000-0000-0000-0000-00000000000a',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'sections', '[]'::jsonb)) $$,
  '42501', null, 'staff without reports.send cannot create a draft'
);

select throws_ok(
  $$ select public.app_list_internal_reports() $$,
  '42501', null, 'staff without reports.send cannot read the workspace list'
);

select throws_ok(
  $$ select public.app_send_report_draft(gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'staff without reports.send cannot send'
);

-- =============================================================================
-- INTERNAL: READ MODELS
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000001';

select is(
  (select company_name || '|' || status || '|' || section_count || '|' || entry_count
   from public.app_list_internal_reports()),
  'Northgate Dental|draft|2|4',
  'the workspace list carries the client, the state and the real counts'
);

select is(
  (select count(*) from public.app_list_internal_reports('sent')),
  0::bigint,
  'filtering to sent excludes an unsent draft'
);

select throws_ok(
  $$ select public.app_list_internal_reports('archived') $$,
  '22023', null, 'an unknown status filter is refused rather than ignored'
);

select is(
  (select public.app_get_internal_report((select id from public.client_reports))
     -> 'sections' -> 0 ->> 'section_key'),
  'technical_seo',
  'the report document returns its sections in stored order'
);

select is(
  (select jsonb_array_length(
    public.app_get_internal_report((select id from public.client_reports))
      -> 'sections' -> 0 -> 'entries')),
  3,
  'with every entry of the first section'
);

select throws_ok(
  $$ select public.app_get_internal_report(gen_random_uuid()) $$,
  '42501', null, 'a report id that does not exist is refused, not answered'
);

-- =============================================================================
-- INTERNAL: SENDING
-- =============================================================================

select is(
  (select status from public.app_send_report_draft(
    '97000000-0000-0000-0000-000000000002',
    (select id from public.client_reports))),
  'sent',
  'sending a draft delivers it'
);

select ok(
  (select sent_at is not null and sent_by_profile_id = '95000000-0000-0000-0000-000000000001'
   from public.client_reports),
  'and stamps the send time and the actual sender'
);

select throws_ok(
  $$ select public.app_save_report_draft(
       (select id from public.client_reports),
       jsonb_build_object('report_lane', 'seo_package', 'package_label', 'Platinum SEO',
                          'title', 'Edited after sending', 'sections', '[]'::jsonb)) $$,
  '42501', null, 'a sent report can no longer be edited'
);

select throws_ok(
  $$ select public.app_discard_report_draft((select id from public.client_reports)) $$,
  '42501', null, 'and it can no longer be discarded'
);

-- Duplicate-send protection: a second send changes nothing and tells nobody.
select is(
  (select id from public.app_send_report_draft(
    gen_random_uuid(), (select id from public.client_reports))),
  (select id from public.client_reports),
  'sending an already-sent report returns it unchanged'
);

-- =============================================================================
-- NOTIFICATIONS AND AUDIT
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.notifications
   where entity_type = 'client_report'
     and recipient_profile_id in (
       '95000000-0000-0000-0000-000000000003',
       '95000000-0000-0000-0000-000000000005')),
  2::bigint,
  'every client user of the target company is notified exactly once'
);

select is(
  (select count(*) from public.notifications
   where entity_type = 'client_report'
     and recipient_profile_id in (
       '95000000-0000-0000-0000-000000000004',
       '95000000-0000-0000-0000-000000000001',
       '95000000-0000-0000-0000-000000000002')),
  0::bigint,
  'the other company, the sender and internal staff are not notified'
);

select is(
  (select distinct category || '|' || audience || '|' || href || '|' || title
   from public.notifications where entity_type = 'client_report'),
  'report|client|/account/reporting/' || (select id::text from public.client_reports)
    || '|New Platinum SEO report from Wolf Forge',
  'the notification opens the native detail and names the package'
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
-- CLIENT: THE SENT REPORT
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000003';

select is(
  (select title from public.app_list_my_client_reports()),
  'August 1-31, 2026',
  'the client now reads the report that was actually sent'
);

select is(
  (select public.app_count_my_unread_reports()),
  1,
  'and it badges the rail as unread'
);

select is(
  (select report_url from public.app_list_my_client_reports()),
  'https://reports.example.invalid/before',
  'the transitional list URL is the first stored asset, not the report itself'
);

-- =============================================================================
-- DISCARDING A DRAFT
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '95000000-0000-0000-0000-000000000001';

select is(
  (select status from public.app_create_report_draft(
    '97000000-0000-0000-0000-000000000003',
    jsonb_build_object(
      'company_id', '96000000-0000-0000-0000-00000000000b',
      'report_lane', 'gmb_management',
      'package_label', 'GMB Management',
      'title', 'Monthly GMB Management Report',
      'sections', jsonb_build_array(jsonb_build_object(
        'section_key', 'gmb_posting', 'title', 'GMB Posting', 'entries', '[]'::jsonb))))),
  'draft',
  'a second draft is created for another company'
);

select is(
  (select public.app_discard_report_draft(
    (select id from public.client_reports where status = 'draft'))),
  true,
  'an unsent draft can be discarded'
);

select is(
  (select count(*) from public.client_reports),
  1::bigint,
  'and only the sent report remains'
);

-- =============================================================================
-- TRANSITIONAL COMPATIBILITY
--
-- Phase 1's quick send is unchanged and still lands as a delivered report.
-- =============================================================================

select is(
  (select status from public.app_send_client_report(
    '97000000-0000-0000-0000-000000000004',
    jsonb_build_object(
      'company_id', '96000000-0000-0000-0000-00000000000b',
      'report_lane', 'gmb_management',
      'package_label', 'GMB Management',
      'title', 'Legacy quick send',
      'report_url', 'https://reports.example.invalid/legacy'
    ))),
  'sent',
  'the Phase 1 quick-send contract still delivers a report directly'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
