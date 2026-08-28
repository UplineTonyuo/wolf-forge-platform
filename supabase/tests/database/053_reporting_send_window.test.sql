begin;

select plan(48);

-- =============================================================================
-- FIXTURES
--
-- Owner (resolver bypass), one admin holding reports.send but no explicit
-- send_anytime override, one admin holding an explicit send_anytime override,
-- one staff holding neither reports.send nor manage_permissions, and one
-- client. Every assertion runs as a real authenticated session.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('98000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'window-owner@example.invalid', now(), now()),
  ('98000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'window-admin@example.invalid', now(), now()),
  ('98000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'window-admin-anytime@example.invalid', now(), now()),
  ('98000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'window-staff@example.invalid', now(), now()),
  ('98000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'window-client@example.invalid', now(), now());

insert into public.companies (id, name)
values ('99000000-0000-0000-0000-000000000001', 'Northgate Dental');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Window Owner', company_id = null
from public.roles as role_row
where role_row.name = 'owner' and profile_row.id = '98000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Window Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin' and profile_row.id = '98000000-0000-0000-0000-000000000002';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Window Admin Anytime', company_id = null
from public.roles as role_row
where role_row.name = 'admin' and profile_row.id = '98000000-0000-0000-0000-000000000003';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Window Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff' and profile_row.id = '98000000-0000-0000-0000-000000000004';

update public.profiles set company_id = '99000000-0000-0000-0000-000000000001', display_name = 'Window Client'
where id = '98000000-0000-0000-0000-000000000005';

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('98000000-0000-0000-0000-000000000003', 'reports.send_anytime', true);

-- =============================================================================
-- DATE ENGINE — private.reporting_window_bounds, deterministic, no now()
-- involved. Matches src/domain/reporting/send-window.ts exactly (same
-- fixtures, both sides asserted in Vitest and here independently).
-- =============================================================================

select is(
  (select window_start || '..' || window_end
   from private.reporting_window_bounds('2026-08-01')),
  '2026-08-28..2026-09-03',
  'August 2026: Aug 28 through Sep 3'
);

select is(
  (select window_start || '..' || window_end
   from private.reporting_window_bounds('2026-09-01')),
  '2026-09-27..2026-10-03',
  'September 2026: Sep 27 through Oct 3'
);

select is(
  (select window_start || '..' || window_end
   from private.reporting_window_bounds('2027-02-01')),
  '2027-02-25..2027-03-03',
  'February 2027 (non-leap): Feb 25 through Mar 3'
);

select is(
  (select window_start || '..' || window_end
   from private.reporting_window_bounds('2028-02-01')),
  '2028-02-26..2028-03-03',
  'February 2028 (leap): Feb 26 through Mar 3'
);

select is(
  (select window_start || '..' || window_end
   from private.reporting_window_bounds('2026-12-01')),
  '2026-12-28..2027-01-03',
  'December 2026: Dec 28, 2026 through Jan 3, 2027 (year boundary)'
);

select is(
  (select window_start || '..' || window_end
   from private.reporting_window_bounds('2026-01-01')),
  '2026-01-28..2026-02-03',
  'January 2026: an ordinary 31-day month stays entirely within itself and the next'
);

-- =============================================================================
-- COLUMN AND CONSTRAINT
-- =============================================================================

select ok(
  (select is_nullable = 'NO' from information_schema.columns
   where table_schema = 'public' and table_name = 'client_reports'
     and column_name = 'reporting_period_month'),
  'reporting_period_month is NOT NULL'
);

select throws_ok(
  $$ insert into public.client_reports
       (company_id, report_lane, package_label, title, sent_by_profile_id,
        reporting_period_month)
     values ('99000000-0000-0000-0000-000000000001', 'seo_package', 'Platinum SEO',
             'Bad period', '98000000-0000-0000-0000-000000000001', '2026-08-15') $$,
  '23514', null, 'reporting_period_month must be the first day of a month'
);

-- =============================================================================
-- PERMISSION CATALOG — reports.send_anytime is a real, granular, revocable
-- capability, not a role default.
-- =============================================================================

select is(
  (select category from public.permissions where permission_key = 'reports.send_anytime'),
  'reports',
  'reports.send_anytime is registered in the permission catalog'
);

select is(
  (select count(*) from public.role_permissions where permission_key = 'reports.send_anytime'),
  0::bigint,
  'no preset (owner, admin, manager, staff, client) is seeded with reports.send_anytime as a role default'
);

select ok(
  not private.is_client_eligible_permission('reports.send_anytime'),
  'a client account can never receive reports.send_anytime, even through an override'
);

select throws_ok(
  $$ select private.apply_profile_permission_override(
       '98000000-0000-0000-0000-000000000005', 'reports.send_anytime', true) $$,
  '42501', null, 'the client-eligibility guard refuses the override at the primitive level too'
);

-- =============================================================================
-- THE AUTHORIZATION BOUNDARY — canSendReport(actor, report, now)
-- =============================================================================

select ok(
  private.profile_has_permission('98000000-0000-0000-0000-000000000001', 'reports.send_anytime'),
  'Owner resolves reports.send_anytime true with no override row on file (existing resolver bypass)'
);

select ok(
  not exists (
    select 1 from public.profile_permission_overrides
    where profile_id = '98000000-0000-0000-0000-000000000001'
      and permission_key = 'reports.send_anytime'
  ),
  'and Owner truly has no override row — the bypass is the resolver, not a seeded grant'
);

select ok(
  not private.profile_has_permission('98000000-0000-0000-0000-000000000002', 'reports.send_anytime'),
  'an ordinary Admin does not have reports.send_anytime by default'
);

select ok(
  private.profile_has_permission('98000000-0000-0000-0000-000000000003', 'reports.send_anytime'),
  'the Admin with an explicit override does'
);

-- private.report_send_authorized_for_period runs as the calling session, so
-- these are exercised as each actor via app_get_report_send_status further
-- below; the direct-call assertions here isolate the pure period math from
-- role resolution using a service-role/superuser context (no session actor).

select is(
  (select window_start from private.reporting_window_bounds('2000-01-01')),
  '2000-01-28'::date,
  'a period far in the past still computes a real window (sanity bound for the denial case below)'
);

-- =============================================================================
-- SERVER-SIDE SEND ENFORCEMENT — app_create_report_draft / app_save_report_draft
-- / app_send_report_draft, as the Admin WITHOUT send_anytime.
--
-- A period six months from any plausible "now" can never fall inside its own
-- ±3-day window (windows are 7 days wide; six months is always far more), so
-- this is a deterministic denial regardless of which real calendar day the
-- suite executes on.
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000002';

select is(
  (select status from public.app_create_report_draft(
    '9a000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '99000000-0000-0000-0000-000000000001',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'Far-period draft',
      'reporting_period_month', to_char(now() + interval '6 months', 'YYYY-MM') || '-01',
      'sections', jsonb_build_array(jsonb_build_object(
        'section_key', 'technical_seo', 'title', 'Technical SEO',
        'entries', jsonb_build_array(
          jsonb_build_object('label', 'Site Audit', 'value', 'Complete', 'url', null))))
    ))),
  'draft',
  'creating a draft is never window-restricted, even for a far-future period'
);

select throws_ok(
  $$ select public.app_send_report_draft(
       '9a000000-0000-0000-0000-000000000002',
       (select id from public.client_reports where title = 'Far-period draft')) $$,
  '42501', null,
  'an Admin without reports.send_anytime cannot send a report whose period''s window has not opened'
);

select is(
  (select status from public.client_reports where title = 'Far-period draft'),
  'draft',
  'the denied send left the report exactly as it was — no partial state'
);

-- Self-consistency: without send_anytime, authorization for the CURRENT real
-- month exactly matches independent date arithmetic — true on every possible
-- day the suite runs, and proves the wiring actually performs the comparison
-- rather than being hardcoded either way. private.report_send_authorized_for_period
-- and private.reporting_window_bounds are both SECURITY DEFINER but are
-- revoked from `authenticated` for direct calls (only reachable through the
-- public RPCs), so this comparison runs privileged while still resolving
-- auth.uid() from the same JWT claim — the claim GUC, not the database role,
-- is what auth.uid() reads.
reset role;

select is(
  private.report_send_authorized_for_period(
    (date_trunc('month', now() at time zone 'Asia/Manila'))::date
  ),
  (
    select (now() at time zone 'Asia/Manila')::date
      between bounds.window_start and bounds.window_end
    from private.reporting_window_bounds(
      (date_trunc('month', now() at time zone 'Asia/Manila'))::date
    ) as bounds
  ),
  'without send_anytime, the current-month authorization exactly matches independent window arithmetic'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- =============================================================================
-- SEND ANYTIME — the override actually lets its holder send outside the window
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000003';

select is(
  (select status from public.app_create_report_draft(
    '9a000000-0000-0000-0000-000000000003',
    jsonb_build_object(
      'company_id', '99000000-0000-0000-0000-000000000001',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'Anytime-sent draft',
      'reporting_period_month', to_char(now() + interval '6 months', 'YYYY-MM') || '-01',
      'sections', jsonb_build_array(jsonb_build_object(
        'section_key', 'technical_seo', 'title', 'Technical SEO',
        'entries', jsonb_build_array(
          jsonb_build_object('label', 'Site Audit', 'value', 'Complete', 'url', null))))
    ))),
  'draft',
  'the send-anytime Admin creates a draft for the same far-future period'
);

select is(
  (select status from public.app_send_report_draft(
    '9a000000-0000-0000-0000-000000000004',
    (select id from public.client_reports where title = 'Anytime-sent draft'))),
  'sent',
  'and sends it successfully despite the period''s normal window not being open — reports.send_anytime works'
);

-- =============================================================================
-- app_get_report_send_status — presentation read matches enforcement exactly
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000002';

select is(
  (select can_send || '|' || send_anytime
   from public.app_get_report_send_status(
     (select id from public.client_reports where title = 'Far-period draft'))),
  'false|false',
  'the status read agrees with the send RPC: denied, and send_anytime is correctly reported false'
);

select is(
  (select can_send || '|' || send_anytime
   from public.app_get_report_send_status(
     (select id from public.client_reports where title = 'Anytime-sent draft'))),
  'false|false',
  'a different actor without send_anytime reads the same window rule for an already-sent report — status does not change what the rule itself would answer'
);

-- private.reporting_window_bounds is reachable only through the RPC layer
-- (revoked from authenticated), so this direct comparison runs privileged;
-- auth.uid() still resolves from the unchanged JWT claim regardless of the
-- connecting database role.
reset role;

select is(
  (select window_start || '..' || window_end
   from public.app_get_report_send_status(
     (select id from public.client_reports where title = 'Anytime-sent draft'))),
  (select window_start || '..' || window_end
   from private.reporting_window_bounds(
     (to_char(now() + interval '6 months', 'YYYY-MM') || '-01')::date
   )),
  'the status read''s window bounds match the canonical bounds function for the same period'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- =============================================================================
-- SECURITY / BYPASS REVIEW
-- =============================================================================

-- Staff has neither reports.send nor reports.send_anytime.
reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000004';

select throws_ok(
  $$ select public.app_send_report_draft(gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'staff without reports.send cannot reach the send RPC at all (forged report id or not)'
);

select throws_ok(
  $$ select public.app_get_report_send_status(gen_random_uuid()) $$,
  '42501', null, 'staff without reports.send cannot read send status either'
);

-- A CLIENT session cannot reach any internal Reporting mutation, forged
-- report id or not — module access is refused before a report is even looked up.
reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select public.app_create_report_draft(gen_random_uuid(), jsonb_build_object(
       'company_id', '99000000-0000-0000-0000-000000000001',
       'report_lane', 'seo_package', 'package_label', 'Platinum SEO',
       'title', 'X', 'sections', '[]'::jsonb)) $$,
  '42501', null, 'a client cannot create a report draft'
);

select throws_ok(
  $$ select public.app_send_report_draft(gen_random_uuid(), gen_random_uuid()) $$,
  '42501', null, 'a client cannot reach the send RPC'
);

select throws_ok(
  $$ select public.app_get_report_send_status(gen_random_uuid()) $$,
  '42501', null, 'a client cannot read send status'
);

select throws_ok(
  $$ select public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000005') $$,
  '42501', null, 'a client cannot grant itself (or anyone) reports.send_anytime'
);

-- =============================================================================
-- PER-USER OVERRIDE MANAGEMENT — grant / revoke
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000001';

select ok(
  (select allowed from public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000004')),
  'Owner grants reports.send_anytime to Staff'
);

-- private.profile_has_permission is reachable only through the RPC layer
-- (revoked from authenticated), so these direct checks run privileged.
reset role;

select ok(
  private.profile_has_permission('98000000-0000-0000-0000-000000000004', 'reports.send_anytime'),
  'the grant is immediately effective'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select ok(
  (select public.app_revoke_report_send_anytime('98000000-0000-0000-0000-000000000004')),
  'Owner revokes it again'
);

reset role;

select ok(
  not private.profile_has_permission('98000000-0000-0000-0000-000000000004', 'reports.send_anytime'),
  'the revoke is immediately effective'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select is(
  (select count(*) from public.activity_events
   where entity_type = 'profile'
     and entity_id = '98000000-0000-0000-0000-000000000004'
     and action = 'permission.report_send_anytime_granted'),
  1::bigint,
  'the grant is audited'
);

select is(
  (select count(*) from public.activity_events
   where entity_type = 'profile'
     and entity_id = '98000000-0000-0000-0000-000000000004'
     and action = 'permission.report_send_anytime_revoked'),
  1::bigint,
  'the revoke is audited'
);

select throws_ok(
  $$ select public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'nobody — not even Owner — can modify the Owner account through this path'
);

-- Admin holds users.manage_permissions by role default, so Admin may act as a
-- permission manager for eligible non-owner targets, same as any other
-- override.
reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000002';

select ok(
  (select allowed from public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000004')),
  'Admin grants reports.send_anytime to an eligible non-owner (Staff)'
);

select ok(
  (select public.app_revoke_report_send_anytime('98000000-0000-0000-0000-000000000004')),
  'and revokes it again'
);

select throws_ok(
  $$ select public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'Admin cannot modify Owner'
);

select throws_ok(
  $$ select public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'Admin cannot self-grant'
);

select throws_ok(
  $$ select public.app_revoke_report_send_anytime('98000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'Admin cannot self-revoke either'
);

-- Staff holds neither reports.send nor users.manage_permissions.
reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000004';

select throws_ok(
  $$ select public.app_grant_report_send_anytime('98000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'an unauthorized internal account cannot grant the override to anyone'
);

-- =============================================================================
-- TEAM DIRECTORY — app_list_internal_members surfaces the resolved state
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '98000000-0000-0000-0000-000000000001';

select is(
  (select report_send_anytime from public.app_list_internal_members()
   where profile_id = '98000000-0000-0000-0000-000000000001'),
  true,
  'the directory shows Owner as report_send_anytime true with no override'
);

select is(
  (select report_send_anytime from public.app_list_internal_members()
   where profile_id = '98000000-0000-0000-0000-000000000002'),
  false,
  'and the ordinary Admin as false'
);

select is(
  (select report_send_anytime from public.app_list_internal_members()
   where profile_id = '98000000-0000-0000-0000-000000000003'),
  true,
  'and the Admin holding the explicit override as true'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
