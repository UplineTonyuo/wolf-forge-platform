begin;

select plan(33);

-- =============================================================================
-- CONTRACT
-- =============================================================================

select ok(
  (select proc.prosecdef and proc.proconfig @> array['search_path=""']
   from pg_proc as proc
   where proc.oid = 'public.app_get_my_client_report(uuid)'::regprocedure),
  'the client detail RPC is SECURITY DEFINER with a locked search_path'
);

select ok(
  (select proc.pronargs = 1 and oidvectortypes(proc.proargtypes) = 'uuid'
   from pg_proc as proc
   where proc.oid = 'public.app_get_my_client_report(uuid)'::regprocedure),
  'the detail RPC accepts only a report id and no browser company authority'
);

select ok(
  has_function_privilege('authenticated', 'public.app_get_my_client_report(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.app_get_my_client_report(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.app_get_my_client_report(uuid)', 'EXECUTE'),
  'only authenticated sessions may execute the client detail RPC'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'notifications_set_client_report_href'
      and tgrelid = 'public.notifications'::regclass
      and not tgisinternal
  ),
  'report notifications have one trusted native-detail path guard'
);

-- =============================================================================
-- FIXTURES
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('97000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'viewer-admin@example.invalid', now(), now()),
  ('97000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'viewer-client-a@example.invalid', now(), now()),
  ('97000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'viewer-client-a2@example.invalid', now(), now()),
  ('97000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'viewer-client-b@example.invalid', now(), now()),
  ('97000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'viewer-client-denied@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('98000000-0000-0000-0000-00000000000a', 'Northgate Dental'),
  ('98000000-0000-0000-0000-00000000000b', 'Southgate Legal');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Viewer Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin'
  and profile_row.id = '97000000-0000-0000-0000-000000000001';

update public.profiles
set company_id = '98000000-0000-0000-0000-00000000000a'
where id in (
  '97000000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000003',
  '97000000-0000-0000-0000-000000000005'
);

update public.profiles
set company_id = '98000000-0000-0000-0000-00000000000b'
where id = '97000000-0000-0000-0000-000000000004';

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('97000000-0000-0000-0000-000000000005', 'reporting.view', false);

delete from public.notifications where entity_type = 'client_report';
delete from public.client_reports;

insert into public.client_reports (
  id, company_id, report_lane, package_label, title, sent_by_profile_id,
  status, sent_at, archived_at
)
values
  ('99000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-00000000000a',
   'seo_package', 'Platinum SEO', 'August 2026 SEO Report',
   '97000000-0000-0000-0000-000000000001', 'sent', '2026-08-20T10:00:00Z', null),
  ('99000000-0000-0000-0000-000000000002', '98000000-0000-0000-0000-00000000000a',
   'seo_package', 'Platinum SEO', 'Unfinished draft',
   '97000000-0000-0000-0000-000000000001', 'draft', null, null),
  ('99000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-00000000000b',
   'gmb_management', 'GMB Management', 'Foreign sent report',
   '97000000-0000-0000-0000-000000000001', 'sent', '2026-08-19T10:00:00Z', null),
  ('99000000-0000-0000-0000-000000000004', '98000000-0000-0000-0000-00000000000a',
   'seo_package', 'Basic SEO Package', 'Archived sent report',
   '97000000-0000-0000-0000-000000000001', 'sent', '2026-08-18T10:00:00Z', now()),
  ('99000000-0000-0000-0000-000000000005', '98000000-0000-0000-0000-00000000000a',
   'seo_package', 'Legacy SEO', 'Legacy quick-send report',
   '97000000-0000-0000-0000-000000000001', 'sent', '2026-08-17T10:00:00Z', null);

insert into public.client_report_sections (id, report_id, section_key, title, sort_order)
values
  ('99100000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001',
   'technical_seo', 'Technical SEO', 20),
  ('99100000-0000-0000-0000-000000000002', '99000000-0000-0000-0000-000000000001',
   'ranking', 'Ranking', 10),
  ('99100000-0000-0000-0000-000000000004', '99000000-0000-0000-0000-000000000001',
   'one_time_setup', 'One-time Setup', 30),
  ('99100000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000005',
   'external_report', 'Report', 0);

insert into public.client_report_entries (section_id, label, value, url, sort_order)
values
  ('99100000-0000-0000-0000-000000000002', 'Ranking', 'Improved from 12 to 4', null, 20),
  ('99100000-0000-0000-0000-000000000002', 'Site Audit Before', null,
   'https://reports.example.invalid/before', 10),
  ('99100000-0000-0000-0000-000000000002', 'Blog Posts', '4 posts completed',
   'https://reports.example.invalid/blog', 30),
  ('99100000-0000-0000-0000-000000000001', 'Technical SEO', 'Technical SEO updated', null, 0),
  ('99100000-0000-0000-0000-000000000003', 'View report', null,
   'https://reports.example.invalid/legacy', 0);

insert into public.client_report_entries (
  section_id, label, value, url, sort_order, one_time_item_key, one_time_completed
)
values (
  '99100000-0000-0000-0000-000000000004', '100 Citations', 'Completed', null, 0,
  'citations_100', true
);

do $$
begin
  perform private.emit_company_client_notification(
    '98000000-0000-0000-0000-00000000000a',
    'viewer-report:99000000-0000-0000-0000-000000000001',
    'report', 'info', 'New report', 'August 2026 SEO Report',
    '/account/reporting', 'client_report',
    '99000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000001', now()
  );
end;
$$;

-- =============================================================================
-- OWN-COMPANY SENT DETAIL
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '97000000-0000-0000-0000-000000000002';

select is(
  public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'report_id',
  '99000000-0000-0000-0000-000000000001',
  'an own-company sent report loads'
);

select is(
  public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'status',
  'sent',
  'the client document is sent'
);

select is(
  public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'company_id',
  '98000000-0000-0000-0000-00000000000a',
  'the report company is derived from the authenticated profile'
);

select is(
  public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'company_name',
  'Northgate Dental',
  'the active caller company is returned with the document'
);

select is(
  (select string_agg(section ->> 'section_key', '|' order by ordinal)
   from jsonb_array_elements(
     public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->'sections'
   ) with ordinality as item(section, ordinal)),
  'ranking|technical_seo|one_time_setup',
  'ordered sections are preserved'
);

select is(
  (select string_agg(entry ->> 'label', '|' order by ordinal)
   from jsonb_array_elements(
     public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')
       ->'sections'->0->'entries'
   ) with ordinality as item(entry, ordinal)),
  'Site Audit Before|Ranking|Blog Posts',
  'ordered entries are preserved'
);

select is(
  public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')
    ->'sections'->0->'entries'->1->>'value',
  'Improved from 12 to 4',
  'a value-only entry is returned natively'
);

select is(
  public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')
    ->'sections'->0->'entries'->0->>'url',
  'https://reports.example.invalid/before',
  'a URL-only entry is returned as a supporting asset'
);

select is(
  (public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')
    ->'sections'->0->'entries'->2->>'value') || '|'
  || (public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')
    ->'sections'->0->'entries'->2->>'url'),
  '4 posts completed|https://reports.example.invalid/blog',
  'value and URL are returned together when both exist'
);

select is(
  (select entry ->> 'one_time_item_key'
   from jsonb_array_elements(
     public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->'sections'
   ) as section,
   jsonb_array_elements(section->'entries') as entry
   where entry ->> 'label' = '100 Citations'),
  'citations_100',
  'the client detail exposes the stable one-time item identity required by presentation'
);

select is(
  (select (entry ->> 'one_time_completed')::boolean
   from jsonb_array_elements(
     public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->'sections'
   ) as section,
   jsonb_array_elements(section->'entries') as entry
   where entry ->> 'label' = '100 Citations'),
  true,
  'the client detail exposes only the one-time completion flag required by presentation'
);

select is(
  (public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'is_read')::boolean,
  false,
  'an unopened detail reports unread for this profile'
);

select is(
  (select count(*) from public.app_list_my_client_reports()),
  2::bigint,
  'the report list remains sent-only, own-company and unarchived'
);

select ok(
  not exists (
    select 1 from public.app_list_my_client_reports()
    where title in ('Unfinished draft', 'Foreign sent report', 'Archived sent report')
  ),
  'the list leaks no draft, foreign or archived report'
);

select is(
  public.app_count_my_unread_reports(),
  2,
  'the unread count includes only the two visible sent reports'
);

select throws_ok(
  $$ select public.app_get_my_client_report('99000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'an own-company draft is not readable'
);

select throws_ok(
  $$ select public.app_get_my_client_report('99000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'a foreign-company sent report is not readable'
);

select throws_ok(
  $$ select public.app_get_my_client_report('99000000-0000-0000-0000-000000000004') $$,
  '42501', null, 'an archived report is not readable'
);

select throws_ok(
  $$ select public.app_get_my_client_report('99000000-0000-0000-0000-000000000099') $$,
  '42501', null, 'a missing report id fails without revealing metadata'
);

select throws_ok(
  $$ select public.app_get_my_client_report('not-a-uuid') $$,
  '22P02', null, 'an invalid UUID fails safely before any report lookup'
);

select is(
  public.app_mark_client_report_read('99000000-0000-0000-0000-000000000001'),
  true,
  'opening detail can mark the report read'
);

select is(
  (public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'is_read')::boolean,
  true,
  'the opened detail is now read for this profile'
);

select is(
  public.app_count_my_unread_reports(),
  1,
  'the caller unread count falls after opening detail'
);

-- =============================================================================
-- PROFILE SCOPE, CAPABILITY, LEGACY AND NOTIFICATIONS
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '97000000-0000-0000-0000-000000000003';

select is(
  (public.app_get_my_client_report('99000000-0000-0000-0000-000000000001')->>'is_read')::boolean,
  false,
  'a colleague does not inherit another profile''s read state'
);

select is(
  public.app_count_my_unread_reports(),
  2,
  'the colleague keeps their own unread count'
);

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '97000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select public.app_get_my_client_report('99000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'portal_reporting capability is enforced on detail'
);

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '97000000-0000-0000-0000-000000000002';

select is(
  (public.app_get_my_client_report('99000000-0000-0000-0000-000000000005')
    ->'sections'->0->>'section_key') || '|'
  || (public.app_get_my_client_report('99000000-0000-0000-0000-000000000005')
    ->'sections'->0->'entries'->0->>'url'),
  'external_report|https://reports.example.invalid/legacy',
  'a legacy quick-send report renders through the same structured document'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select distinct href from public.notifications
   where event_key = 'viewer-report:99000000-0000-0000-0000-000000000001'),
  '/account/reporting/99000000-0000-0000-0000-000000000001',
  'the notification points to the exact native report detail'
);

update public.companies
set archived_at = now()
where id = '98000000-0000-0000-0000-00000000000a';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '97000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.app_get_my_client_report('99000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'an archived company cannot read reports'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
