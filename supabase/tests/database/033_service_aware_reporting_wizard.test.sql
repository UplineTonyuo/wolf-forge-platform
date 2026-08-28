begin;

select plan(33);

-- =============================================================================
-- CONTRACT
-- =============================================================================

select ok(
  (select count(*) = 3
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'client_reports'
     and column_name in ('service_id', 'subscription_id', 'wizard_step_key')),
  'reports carry stable Service/subscription identity and durable wizard progress'
);

select ok(
  (select count(*) = 2
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'client_report_entries'
     and column_name in ('one_time_item_key', 'one_time_completed')),
  'structured entries carry item-level one-time completion metadata'
);

select ok(
  to_regclass('private.reported_one_time_deliverables') is not null,
  'one-time completion state is private and durable'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.reported_one_time_deliverables', 'SELECT'
  )
  and not has_table_privilege(
    'authenticated', 'private.reported_one_time_deliverables', 'INSERT'
  ),
  'browser sessions have no direct read or write path to one-time state'
);

select ok(
  (select proc.prosecdef and proc.proconfig @> array['search_path=""']
   from pg_proc as proc
   where proc.oid = 'public.app_list_reporting_service_options(uuid,uuid[])'::regprocedure),
  'the service-choice RPC is SECURITY DEFINER with a locked search_path'
);

select ok(
  (select proc.prosecdef and proc.proconfig @> array['search_path=""']
   from pg_proc as proc
   where proc.oid = 'public.app_send_report_draft(uuid,uuid)'::regprocedure),
  'the transactional send RPC remains SECURITY DEFINER with a locked search_path'
);

-- =============================================================================
-- FIXTURES
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'service-report-admin@example.invalid', now(), now()),
  ('a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'service-report-client@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('a2000000-0000-0000-0000-000000000001', 'Northgate Dental'),
  ('a2000000-0000-0000-0000-000000000002', 'Southgate Dental'),
  ('a2000000-0000-0000-0000-000000000003', 'Westgate Dental');

update public.profiles as profile
set role_id = role.id, display_name = 'Reporting Admin', company_id = null
from public.roles as role
where role.name = 'admin'
  and profile.id = 'a1000000-0000-0000-0000-000000000001';

-- This suite sends reports on whatever real calendar day the suite happens to
-- run, so the fixture admin needs reports.send_anytime rather than the send
-- assertions below depending on the reporting-window date engine (covered on
-- its own in 053_reporting_send_window.test.sql).
insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('a1000000-0000-0000-0000-000000000001', 'reports.send_anytime', true);

update public.profiles
set company_id = 'a2000000-0000-0000-0000-000000000001'
where id = 'a1000000-0000-0000-0000-000000000002';

insert into public.subscriptions (
  id, company_id, service_id, public_ref, status, plan_source, billing_anchor,
  paused_at, created_by_profile_id, updated_by_profile_id
)
values
  ('a3000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   '5f000000-0000-4000-8000-000000000123',
   'REPORTSUB001', 'active', 'admin_invoice', current_date, null,
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002',
   'a2000000-0000-0000-0000-000000000001',
   '5f000000-0000-4000-8000-000000000123',
   'REPORTSUB002', 'paused', 'admin_invoice', current_date, now(),
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000003',
   'a2000000-0000-0000-0000-000000000002',
   '5f000000-0000-4000-8000-000000000123',
   'REPORTSUB003', 'active', 'admin_invoice', current_date, null,
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000004',
   'a2000000-0000-0000-0000-000000000001',
   '5f000000-0000-4000-8000-000000000318',
   'REPORTSUB004', 'active', 'admin_invoice', current_date, null,
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select is(
  (select count(*)
   from public.app_list_reporting_service_options(
     'a2000000-0000-0000-0000-000000000001',
     array['5f000000-0000-4000-8000-000000000123'::uuid]
   )
   where subscription_id is not null),
  2::bigint,
  'service choices expose both real non-canceled subscriptions for the client'
);

select is(
  (select distinct service_name
   from public.app_list_reporting_service_options(
     'a2000000-0000-0000-0000-000000000001',
     array['5f000000-0000-4000-8000-000000000123'::uuid]
   )),
  'Platinum SEO Success Blueprint (100 Targeted Keywords)',
  'service choices preserve the exact current catalogue name'
);

select is(
  (select count(*)
   from public.app_list_reporting_service_options(
     'a2000000-0000-0000-0000-000000000001',
     array['5f000000-0000-4000-8000-000000000318'::uuid]
   )
   where subscription_id = 'a3000000-0000-0000-0000-000000000004'),
  1::bigint,
  'standalone GMB Management is selectable through its attached subscription'
);

select is(
  (select service_name
   from public.app_list_reporting_service_options(
     'a2000000-0000-0000-0000-000000000001',
     array['5f000000-0000-4000-8000-000000000318'::uuid]
   )),
  'GMB/GBP Management',
  'the standalone GMB profile resolves the exact live catalogue record'
);

select is(
  (select count(*)
   from public.app_list_reporting_service_options(
     'a2000000-0000-0000-0000-000000000003',
     array['5f000000-0000-4000-8000-000000000318'::uuid]
   )
   where subscription_id is null),
  1::bigint,
  'standalone GMB Management remains available as an explicit catalogue fallback'
);

select is(
  (select report_lane || '|' || coalesce(wizard_step_key, '')
   from public.app_create_report_draft(
     'a4000000-0000-0000-0000-000000000018',
     jsonb_build_object(
       'company_id', 'a2000000-0000-0000-0000-000000000001',
       'service_id', '5f000000-0000-4000-8000-000000000318',
       'subscription_id', 'a3000000-0000-0000-0000-000000000004',
       'report_lane', 'gmb_management',
       'package_label', 'GMB/GBP Management',
       'title', 'August 2026 GMB Management Report',
       'wizard_step_key', 'gmb_content',
       'sections', jsonb_build_array(
         jsonb_build_object(
           'section_key', 'gmb_content',
           'title', 'GMB Content',
           'entries', jsonb_build_array(jsonb_build_object(
             'label', 'GMB Content', 'value', null, 'url', null
           ))
         ),
         jsonb_build_object(
           'section_key', 'gmb_posting',
           'title', 'GMB Posting',
           'entries', jsonb_build_array(jsonb_build_object(
             'label', 'GMB Posting', 'value', null, 'url', null
           ))
         )
       )
     )
   )),
  'gmb_management|gmb_content',
  'a standalone GMB draft preserves its lane and first focused wizard step'
);

select is(
  (select string_agg(section_key, '|' order by sort_order)
   from public.client_report_sections
   where report_id = (
     select id from public.client_reports
     where title = 'August 2026 GMB Management Report'
   )),
  'gmb_content|gmb_posting',
  'a standalone GMB draft stores no Technical or Performance sections'
);

select throws_ok(
  $$ select public.app_create_report_draft(
    gen_random_uuid(),
    jsonb_build_object(
      'company_id', 'a2000000-0000-0000-0000-000000000002',
      'service_id', '5f000000-0000-4000-8000-000000000123',
      'subscription_id', 'a3000000-0000-0000-0000-000000000001',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'Wrong company',
      'wizard_step_key', 'technical_seo',
      'sections', '[]'::jsonb
    )
  ) $$,
  '23514', null,
  'a browser cannot pair a subscription with another company'
);

select is(
  (select status from public.app_create_report_draft(
    'a4000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', 'a2000000-0000-0000-0000-000000000001',
      'service_id', '5f000000-0000-4000-8000-000000000123',
      'subscription_id', 'a3000000-0000-0000-0000-000000000001',
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 2026 Platinum SEO Report',
      'wizard_step_key', 'technical_seo',
      'sections', jsonb_build_array(
        jsonb_build_object(
          'section_key', 'one_time_setup',
          'title', 'One-time Setup',
          'entries', jsonb_build_array(
            jsonb_build_object(
              'label', 'One-time GMB Optimization',
              'value', null,
              'url', null,
              'one_time_item_key', 'gmb_optimization',
              'one_time_completed', false
            ),
            jsonb_build_object(
              'label', '100 Directory Listings',
              'value', null,
              'url', null,
              'one_time_item_key', 'directory_listings_100',
              'one_time_completed', false
            )
          )
        )
      )
    )
  )),
  'draft',
  'a service-aware draft is created in the existing report model'
);

select is(
  (select count(*)
   from public.app_list_reported_one_time_deliverables(
     'a2000000-0000-0000-0000-000000000001',
     '5f000000-0000-4000-8000-000000000123',
     'a3000000-0000-0000-0000-000000000001'
   )),
  0::bigint,
  'creating a draft does not consume one-time items'
);

select is(
  public.app_get_internal_report(
    (select id from public.client_reports
     where title = 'August 2026 Platinum SEO Report'
       and company_id = 'a2000000-0000-0000-0000-000000000001')
  )->>'wizard_step_key',
  'technical_seo',
  'the saved wizard step is returned for resume'
);

select is(
  public.app_get_internal_report(
    (select id from public.client_reports
     where title = 'August 2026 Platinum SEO Report'
       and company_id = 'a2000000-0000-0000-0000-000000000001')
  )->>'service_id',
  '5f000000-0000-4000-8000-000000000123',
  'the internal document returns stable Service identity'
);

select is(
  (select wizard_step_key from public.app_save_report_draft(
    (select id from public.client_reports
     where title = 'August 2026 Platinum SEO Report'
       and company_id = 'a2000000-0000-0000-0000-000000000001'),
    jsonb_build_object(
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'August 2026 Platinum SEO Report',
      'wizard_step_key', 'one_time_setup',
      'sections', jsonb_build_array(
        jsonb_build_object(
          'section_key', 'one_time_setup',
          'title', 'One-time Setup',
          'entries', jsonb_build_array(
            jsonb_build_object(
              'label', 'One-time GMB Optimization',
              'value', 'Completed',
              'url', 'https://reports.example.invalid/gmb',
              'one_time_item_key', 'gmb_optimization',
              'one_time_completed', true
            ),
            jsonb_build_object(
              'label', '100 Directory Listings',
              'value', 'In progress',
              'url', null,
              'one_time_item_key', 'directory_listings_100',
              'one_time_completed', false
            )
          )
        )
      )
    )
  )),
  'one_time_setup',
  'Save Draft persists the current wizard step and its data'
);

select is(
  public.app_get_internal_report(
    (select id from public.client_reports
     where title = 'August 2026 Platinum SEO Report'
       and company_id = 'a2000000-0000-0000-0000-000000000001')
  )->'sections'->0->'entries'->0->>'one_time_item_key',
  'gmb_optimization',
  'one-time item metadata survives whole-document draft replacement'
);

select throws_ok(
  $$ select public.app_save_report_draft(
    (select id from public.client_reports
     where title = 'August 2026 Platinum SEO Report'
       and company_id = 'a2000000-0000-0000-0000-000000000001'),
    jsonb_build_object(
      'report_lane', 'seo_package',
      'package_label', 'Platinum SEO',
      'title', 'Unsafe',
      'sections', jsonb_build_array(jsonb_build_object(
        'section_key', 'technical_seo',
        'title', 'Technical SEO',
        'entries', jsonb_build_array(jsonb_build_object(
          'label', 'Site Audit Before', 'url', 'javascript:alert(1)', 'value', null
        ))
      ))
    )
  ) $$,
  '22023', null,
  'the service-aware save path preserves safe HTTP(S) validation'
);

select is(
  (select status from public.app_send_report_draft(
    'a4000000-0000-0000-0000-000000000002',
    (select id from public.client_reports
     where title = 'August 2026 Platinum SEO Report'
       and company_id = 'a2000000-0000-0000-0000-000000000001')
  )),
  'sent',
  'sending delivers the service-aware report'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from private.reported_one_time_deliverables),
  1::bigint,
  'a sent report consumes only the one-time item explicitly completed'
);

select is(
  (select item_key from private.reported_one_time_deliverables),
  'gmb_optimization',
  'the completed item is stored by stable item key'
);

select ok(
  not exists (
    select 1 from private.reported_one_time_deliverables
    where item_key = 'directory_listings_100'
  ),
  'an incomplete one-time item remains eligible'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select is(
  (select string_agg(item_key, '|' order by item_key)
   from public.app_list_reported_one_time_deliverables(
     'a2000000-0000-0000-0000-000000000001',
     '5f000000-0000-4000-8000-000000000123',
     'a3000000-0000-0000-0000-000000000001'
   ) as item_key),
  'gmb_optimization',
  'the next cycle reads the completed item for omission'
);

select is(
  (select count(*)
   from public.app_list_reported_one_time_deliverables(
     'a2000000-0000-0000-0000-000000000002',
     '5f000000-0000-4000-8000-000000000123',
     'a3000000-0000-0000-0000-000000000003'
   )),
  0::bigint,
  'one-time state is isolated by client company'
);

select is(
  (select count(*)
   from public.app_list_reported_one_time_deliverables(
     'a2000000-0000-0000-0000-000000000001',
     '5f000000-0000-4000-8000-000000000123',
     'a3000000-0000-0000-0000-000000000002'
   )),
  0::bigint,
  'one-time state is isolated by subscription'
);

select is(
  (select count(*)
   from public.app_list_reported_one_time_deliverables(
     'a2000000-0000-0000-0000-000000000001',
     '5f000000-0000-4000-8000-000000000123',
     null
   )),
  0::bigint,
  'subscription completion does not leak into the explicit fallback scope'
);

select is(
  (select count(*)
   from public.app_list_reported_one_time_deliverables(
     'a2000000-0000-0000-0000-000000000001',
     '5f000000-0000-4000-8000-000000000124',
     null
   )),
  0::bigint,
  'one-time state is isolated by Service identity'
);

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select * from public.app_list_reporting_service_options(
    'a2000000-0000-0000-0000-000000000001',
    array['5f000000-0000-4000-8000-000000000123'::uuid]
  ) $$,
  '42501', null,
  'a client session cannot use the internal service-choice RPC'
);

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select is(
  (select status from public.app_send_client_report(
    'a4000000-0000-0000-0000-000000000003',
    jsonb_build_object(
      'company_id', 'a2000000-0000-0000-0000-000000000002',
      'report_lane', 'seo_package',
      'package_label', 'Legacy SEO',
      'title', 'Legacy quick send remains',
      'report_url', 'https://reports.example.invalid/legacy'
    )
  )),
  'sent',
  'the Phase 1 quick-send contract remains compatible'
);

select is(
  (select count(*)
   from public.client_reports
   where title = 'Legacy quick send remains' and service_id is null),
  1::bigint,
  'legacy quick-send reports remain valid without service identity'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
