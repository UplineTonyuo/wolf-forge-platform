begin;

select plan(61);

-- WL-2.14 (KI-111, Forms portion): Form management is Tenant-bound. The Form
-- is the authoritative Tenant root (WL-1C.2a); versions, assignments and
-- submissions inherit through it. The public Form boundary is preserved: a
-- public Form determines its own Tenant for anonymous and signed-in
-- submitters.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001801.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1801 WF owner; 1802 B owner (no WF membership); 1803 owner of both; 1804 B
-- owner with an archived B membership (no WF membership); 1805 WF client;
-- 1806 B client (no WF membership).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'form-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1801', '1802', '1803', '1804', '1805', '1806']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001801', 'form-authz-tenant-b', 'Form Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e0000000-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'FORM_AUTHZ_WF_CLIENT', 'client'),
  ('e0000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801', 'FORM_AUTHZ_B_CLIENT', 'client');

insert into public.services (id, tenant_id, name, price, currency, is_active, is_public, recurring, sort_order)
values
  ('5b000000-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'FORM_AUTHZ_WF_SERVICE', 100.00, 'USD', true, true, false, 0),
  ('5b000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801', 'FORM_AUTHZ_B_SERVICE', 100.00, 'USD', true, true, false, 0);

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('0d000000-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'e0000000-0000-4000-8000-000000001801', '5b000000-0000-4000-8000-000000001801', 'FORM AUTHZ WF Order'),
  ('0d000000-0000-4000-8000-000000001802', 'f0f0f0f0-0000-4000-8000-000000001801', 'e0000000-0000-4000-8000-000000001802', '5b000000-0000-4000-8000-000000001802', 'FORM AUTHZ B Order');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id in (
    '20000000-0000-4000-8000-000000001801',
    '20000000-0000-4000-8000-000000001802',
    '20000000-0000-4000-8000-000000001803',
    '20000000-0000-4000-8000-000000001804'
  )
  and role.name = 'owner';

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'e0000000-0000-4000-8000-000000001801'
where id = '20000000-0000-4000-8000-000000001805';

-- 1806 stays a default client profile (the auth trigger already assigned the
-- client role) with no global company; its Client identity is the explicit
-- Tenant B membership inserted below, so the Wolf Forge mirror never tries to
-- carry a Tenant B company on a Wolf Forge membership.

-- B-only users hold no Wolf Forge membership at all.
delete from public.tenant_memberships as membership_row
where membership_row.tenant_id = private.wolf_forge_tenant_id()
  and membership_row.profile_id in (
    '20000000-0000-4000-8000-000000001802',
    '20000000-0000-4000-8000-000000001804',
    '20000000-0000-4000-8000-000000001806'
  );

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-000000001801', '20000000-0000-4000-8000-000000001802', 'internal', 'owner', null, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000001801', '20000000-0000-4000-8000-000000001803', 'internal', 'owner', null, null),
  ('f0f0f0f0-0000-4000-8000-000000001801', '20000000-0000-4000-8000-000000001804', 'internal', 'owner', null, now()),
  ('f0f0f0f0-0000-4000-8000-000000001801', '20000000-0000-4000-8000-000000001806', 'client', 'client', 'e0000000-0000-4000-8000-000000001802', null)
) as fixture(tenant_id, profile_id, account_class, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

create temp table wl214_ids (label text primary key, id uuid);
grant select, insert on wl214_ids to authenticated, anon;
grant select on wl214_ids to service_role;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.contact_def()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Authz Contact', 'title', 'Contact us', 'visibility', 'public',
    'type_config', jsonb_build_object(
      'subject_field_key', '58000000-0000-4000-8000-000000001801',
      'message_field_key', '58000000-0000-4000-8000-000000001802',
      'ticket_orchestration', 'deferred'
    ),
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000001801', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000001802', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)
    ),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
  );
$$;

create function pg_temp.onboard_def()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Authz Onboarding', 'title', 'Onboarding', 'visibility', 'assigned',
    'type_config', jsonb_build_object('reuse_policy', 'company_profile'),
    'fields', jsonb_build_array(jsonb_build_object(
      'stable_field_key', '58000000-0000-4000-8000-000000001803',
      'sort_order', 0, 'field_type', 'text', 'label', 'Brand name', 'required', true
    )),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
  );
$$;

create function pg_temp.intake_def(p_service_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Authz Intake', 'title', 'Project intake', 'visibility', 'assigned',
    'type_config', jsonb_build_object('completion_status', 'submitted'),
    'fields', jsonb_build_array(jsonb_build_object(
      'stable_field_key', '58000000-0000-4000-8000-000000001804',
      'sort_order', 0, 'field_type', 'textarea', 'label', 'Project brief', 'required', true
    )),
    'rules', '[]'::jsonb,
    'service_links', jsonb_build_array(jsonb_build_object(
      'service_id', p_service_id, 'role', 'intake_assignment', 'sort_order', 0
    ))
  );
$$;

grant execute on function pg_temp.act(text, text), pg_temp.try(text),
  pg_temp.contact_def(), pg_temp.onboard_def(), pg_temp.intake_def(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Tenant fixtures through the real RPCs
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('1801', '');
insert into wl214_ids values ('wf-public', (public.app_create_form(
  '71000000-0000-4000-8000-000000001801',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl214-wf-public', 'definition', pg_temp.contact_def()))).id);
insert into wl214_ids values ('wf-onboard', (public.app_create_form(
  '71000000-0000-4000-8000-000000001802',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wl214-wf-onboard', 'definition', pg_temp.onboard_def()))).id);
insert into wl214_ids select 'wf-public-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000001803', (select id from wl214_ids where label = 'wf-public'))).id;
insert into wl214_ids select 'wf-onboard-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000001804', (select id from wl214_ids where label = 'wf-onboard'))).id;
insert into wl214_ids values ('wf-intake', (public.app_create_form(
  '71000000-0000-4000-8000-000000001805',
  jsonb_build_object('form_type', 'intake', 'canonical_key', 'wl214-wf-intake', 'definition', pg_temp.intake_def('5b000000-0000-4000-8000-000000001801')))).id);
insert into wl214_ids select 'wf-intake-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000001806', (select id from wl214_ids where label = 'wf-intake'))).id;
insert into wl214_ids select 'wf-onboard-assignment', (public.app_assign_form(
  '71000000-0000-4000-8000-000000001807', (select id from wl214_ids where label = 'wf-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000001805'))).id;
insert into wl214_ids select 'wf-intake-assignment', (public.app_assign_form(
  '71000000-0000-4000-8000-000000001808', (select id from wl214_ids where label = 'wf-intake'),
  jsonb_build_object('order_id', '0d000000-0000-4000-8000-000000001801', 'client_profile_id', '20000000-0000-4000-8000-000000001805'))).id;

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
insert into wl214_ids values ('b-public', (public.app_create_form(
  '71000000-0000-4000-8000-000000001809',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl214-b-public', 'definition', pg_temp.contact_def()))).id);
insert into wl214_ids values ('b-onboard', (public.app_create_form(
  '71000000-0000-4000-8000-000000001810',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wl214-b-onboard', 'definition', pg_temp.onboard_def()))).id);
insert into wl214_ids select 'b-public-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000001811', (select id from wl214_ids where label = 'b-public'))).id;
insert into wl214_ids select 'b-onboard-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000001812', (select id from wl214_ids where label = 'b-onboard'))).id;
insert into wl214_ids values ('b-intake', (public.app_create_form(
  '71000000-0000-4000-8000-000000001813',
  jsonb_build_object('form_type', 'intake', 'canonical_key', 'wl214-b-intake', 'definition', pg_temp.intake_def('5b000000-0000-4000-8000-000000001802')))).id);
insert into wl214_ids select 'b-intake-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000001814', (select id from wl214_ids where label = 'b-intake'))).id;
insert into wl214_ids select 'b-onboard-assignment', (public.app_assign_form(
  '71000000-0000-4000-8000-000000001815', (select id from wl214_ids where label = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000001806'))).id;
insert into wl214_ids select 'b-intake-assignment', (public.app_assign_form(
  '71000000-0000-4000-8000-000000001816', (select id from wl214_ids where label = 'b-intake'),
  jsonb_build_object('order_id', '0d000000-0000-4000-8000-000000001802', 'client_profile_id', '20000000-0000-4000-8000-000000001806'))).id;

select pg_temp.act('1805', '');
insert into wl214_ids values ('wf-submission', (public.app_submit_form(
  '71000000-0000-4000-8000-000000001817',
  (select id from wl214_ids where label = 'wf-onboard-v1'),
  jsonb_build_object('assignment_id', (select id from wl214_ids where label = 'wf-onboard-assignment')),
  jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'WF client brand')),
  '[]'::jsonb)).id);

select pg_temp.act('1806', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
insert into wl214_ids values ('b-submission', (public.app_submit_form(
  '71000000-0000-4000-8000-000000001818',
  (select id from wl214_ids where label = 'b-onboard-v1'),
  jsonb_build_object('assignment_id', (select id from wl214_ids where label = 'b-onboard-assignment')),
  jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'B client brand')),
  '[]'::jsonb)).id);

-- -----------------------------------------------------------------------------
-- Same-Tenant positive paths
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is((select count(*) from public.app_list_assigned_forms() where form_id in (select id from wl214_ids where label in ('wf-intake','wf-onboard','b-intake','b-onboard'))), 2::bigint,
  'the WF owner list contains exactly the WF assignments');
select is((select count(*) from public.app_list_assigned_forms()
  where form_id = (select id from wl214_ids where label = 'wf-onboard')), 1::bigint,
  'the WF owner list carries the WF onboarding assignment');
select is(public.app_get_assigned_form_schema((select id from wl214_ids where label = 'wf-onboard-assignment'))
  #>> '{schema,form_version_id}',
  (select id::text from wl214_ids where label = 'wf-onboard-v1'),
  'the WF owner reads the assigned Form schema pinned to its version');
select is(public.app_get_form_submission((select id from wl214_ids where label = 'wf-submission'))
  #>> '{submission,form_id}',
  (select id::text from wl214_ids where label = 'wf-onboard'),
  'the WF owner reads the WF client submission');
select lives_ok(
  $$select public.app_correct_form_submission(
    '71000000-0000-4000-8000-000000001819',
    (select id from wl214_ids where label = 'wf-submission'),
    jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'WF client brand corrected')))$$,
  'the WF owner corrects the WF submission');
select is((select revision_number from public.form_submissions
  where supersedes_submission_id = (select id from wl214_ids where label = 'wf-submission')), 2,
  'the correction appends revision 2');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is((select count(*) from public.app_list_assigned_forms() where form_id in (select id from wl214_ids where label in ('wf-intake','wf-onboard','b-intake','b-onboard'))), 2::bigint,
  'the Tenant B owner list contains exactly the Tenant B assignments');
select is((select count(*) from public.app_list_assigned_forms()
  where assignment_id = (select id from wl214_ids where label = 'b-intake-assignment')), 1::bigint,
  'the Tenant B owner list carries the Tenant B intake assignment');
select is(public.app_get_assigned_form_schema((select id from wl214_ids where label = 'b-intake-assignment'))
  #>> '{assignment,order_id}',
  '0d000000-0000-4000-8000-000000001802',
  'the Tenant B owner reads its assigned Form with the Tenant B Order scope');

-- -----------------------------------------------------------------------------
-- IDOR: WF owner against Tenant B targets
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select is(pg_temp.try($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001820', (select id from wl214_ids where label = 'b-public'))$$),
  'P0002', 'the WF owner cannot archive a Tenant B Form');
select is(pg_temp.try($$select public.app_update_form_draft(
    '71000000-0000-4000-8000-000000001821', (select id from wl214_ids where label = 'b-intake'),
    pg_temp.contact_def())$$),
  'P0002', 'the WF owner cannot update a Tenant B Form draft');
select is(pg_temp.try($$select public.app_publish_form(
    '71000000-0000-4000-8000-000000001822', (select id from wl214_ids where label = 'b-onboard'))$$),
  'P0002', 'the WF owner cannot publish a Tenant B Form');
select is(pg_temp.try($$select public.app_get_assigned_form_schema(
    (select id from wl214_ids where label = 'b-onboard-assignment'))$$),
  'P0002', 'the WF owner cannot read a Tenant B assignment schema');
select is(pg_temp.try($$select public.app_get_form_submission(
    (select id from wl214_ids where label = 'b-submission'))$$),
  'P0002', 'the WF owner cannot read a Tenant B submission');
select is(pg_temp.try($$select public.app_correct_form_submission(
    '71000000-0000-4000-8000-000000001823', (select id from wl214_ids where label = 'b-submission'),
    jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'Injected correction')))$$),
  'P0002', 'the WF owner cannot correct a Tenant B submission');
reset role;
select ok((select status = 'published' and archived_at is null
  from public.forms where id = (select id from wl214_ids where label = 'b-public')),
  'the blocked Tenant B Form is unchanged');
select is((select count(*) from public.form_submissions
  where root_submission_id = (select id from wl214_ids where label = 'b-submission')), 1::bigint,
  'the blocked Tenant B submission gained no revision');
set local role authenticated;

-- -----------------------------------------------------------------------------
-- IDOR: Tenant B owner against WF targets
-- -----------------------------------------------------------------------------

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001824', (select id from wl214_ids where label = 'wf-public'))$$),
  'P0002', 'the Tenant B owner cannot archive a WF Form');
select is(pg_temp.try($$select public.app_update_form_draft(
    '71000000-0000-4000-8000-000000001825', (select id from wl214_ids where label = 'wf-onboard'),
    pg_temp.onboard_def())$$),
  'P0002', 'the Tenant B owner cannot update a WF Form draft');
select is(pg_temp.try($$select public.app_get_assigned_form_schema(
    (select id from wl214_ids where label = 'wf-onboard-assignment'))$$),
  'P0002', 'the Tenant B owner cannot read a WF assignment schema');
select is(pg_temp.try($$select public.app_get_form_submission(
    (select id from wl214_ids where label = 'wf-submission'))$$),
  'P0002', 'the Tenant B owner cannot read a WF submission');
select is(pg_temp.try($$select public.app_correct_form_submission(
    '71000000-0000-4000-8000-000000001826', (select id from wl214_ids where label = 'wf-submission'),
    jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'Injected correction')))$$),
  'P0002', 'the Tenant B owner cannot correct a WF submission');

-- -----------------------------------------------------------------------------
-- Cross-Tenant assignment integrity
-- -----------------------------------------------------------------------------

select is(pg_temp.try($$select public.app_assign_form(
    '71000000-0000-4000-8000-000000001827', (select id from wl214_ids where label = 'b-intake'),
    jsonb_build_object('order_id', '0d000000-0000-4000-8000-000000001801', 'client_profile_id', '20000000-0000-4000-8000-000000001805'))$$),
  'P0002', 'a Tenant B Form cannot attach to a WF Order');

select pg_temp.act('1801', '');
select is(pg_temp.try($$select public.app_assign_form(
    '71000000-0000-4000-8000-000000001828', (select id from wl214_ids where label = 'wf-intake'),
    jsonb_build_object('order_id', '0d000000-0000-4000-8000-000000001802', 'client_profile_id', '20000000-0000-4000-8000-000000001806'))$$),
  'P0002', 'a WF Form cannot attach to a Tenant B Order');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_assign_form(
    '71000000-0000-4000-8000-000000001829', (select id from wl214_ids where label = 'b-onboard'),
    jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000001805'))$$),
  'P0002', 'a Tenant B Form cannot assign a WF client without a Tenant B membership');
select is(pg_temp.try($$select public.app_assign_form(
    '71000000-0000-4000-8000-000000001830', (select id from wl214_ids where label = 'b-onboard'),
    jsonb_build_object('client_profile_id', '2f000000-0000-4000-8000-0000000018ff'))$$),
  'P0002', 'a Tenant B Form cannot assign an unknown client profile');

select pg_temp.act('1801', '');
select is(pg_temp.try($$select public.app_assign_form(
    '71000000-0000-4000-8000-000000001831', (select id from wl214_ids where label = 'wf-onboard'),
    jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000001806'))$$),
  'P0002', 'a WF Form cannot assign a Tenant B client without a WF membership');

select pg_temp.act('1801', '');
select is(pg_temp.try($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001843',
    (select id from wl214_ids where label = 'b-onboard-v1'),
    jsonb_build_object('assignment_id', (select id from wl214_ids where label = 'b-onboard-assignment')),
    jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'Cross-tenant internal')),
    '[]'::jsonb)$$),
  '42501', 'the WF owner cannot submit a Tenant B assignment');
select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001844',
    (select id from wl214_ids where label = 'wf-onboard-v1'),
    jsonb_build_object('assignment_id', (select id from wl214_ids where label = 'wf-onboard-assignment')),
    jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001803', 'value', 'Cross-tenant internal')),
    '[]'::jsonb)$$),
  '42501', 'the Tenant B owner cannot submit a WF assignment');
select pg_temp.act('1801', '');
select lives_ok($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001845',
    (select id from wl214_ids where label = 'wf-intake-v1'),
    jsonb_build_object('assignment_id', (select id from wl214_ids where label = 'wf-intake-assignment')),
    jsonb_build_array(jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001804', 'value', 'Internal completion')),
    '[]'::jsonb)$$,
  'the WF owner completes the WF intake assignment inside its Tenant');
select is(pg_temp.try($$select public.app_get_published_form_schema('wl214-wf-onboard')$$),
  'ok', 'the WF owner reads the WF assigned schema by canonical key');
select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_get_published_form_schema('wl214-wf-onboard')$$),
  '42501', 'the Tenant B owner cannot read the WF assigned schema by canonical key');

-- -----------------------------------------------------------------------------
-- Dual owner: request replay does not cross the selector
-- -----------------------------------------------------------------------------

select pg_temp.act('1803', '');
select is(pg_temp.try($$insert into wl214_ids values ('dual-form', (public.app_create_form(
    '71000000-0000-4000-8000-000000001832',
    jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl214-dual-replay', 'definition', pg_temp.contact_def()))).id)$$),
  'ok', 'the dual owner creates a Form under the WF selector');
select pg_temp.act('1803', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_create_form(
    '71000000-0000-4000-8000-000000001832',
    jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl214-dual-replay', 'definition', pg_temp.contact_def()))$$),
  'P0002', 'the same request replayed under the Tenant B selector returns nothing');
select pg_temp.act('1803', '');
select lives_ok($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001842', (select id from wl214_ids where label = 'dual-form'))$$,
  'the dual owner archives its WF Form under the WF selector');
select pg_temp.act('1803', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001842', (select id from wl214_ids where label = 'dual-form'))$$),
  'P0002', 'the archive replay under the Tenant B selector raises no_data_found');

-- -----------------------------------------------------------------------------
-- Direct RLS reads
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select ok(
  (select count(*) from public.forms where id = (select id from wl214_ids where label = 'b-public')) = 0
  and (select count(*) from public.form_versions where form_id = (select id from wl214_ids where label = 'b-public')) = 0
  and (select count(*) from public.form_assignments where id = (select id from wl214_ids where label = 'b-onboard-assignment')) = 0
  and (select count(*) from public.form_submissions where id = (select id from wl214_ids where label = 'b-submission')) = 0,
  'the WF owner direct RLS reads see zero Tenant B Form rows');

select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select ok(
  (select count(*) from public.forms where id = (select id from wl214_ids where label = 'wf-public')) = 0
  and (select count(*) from public.form_versions where form_id = (select id from wl214_ids where label = 'wf-public')) = 0
  and (select count(*) from public.form_assignments where id = (select id from wl214_ids where label = 'wf-onboard-assignment')) = 0
  and (select count(*) from public.form_submissions where id = (select id from wl214_ids where label = 'wf-submission')) = 0,
  'the Tenant B owner direct RLS reads see zero WF Form rows');

select throws_ok(
  $$insert into public.forms (form_type, canonical_key, name, visibility, created_by_profile_id, updated_by_profile_id)
    values ('contact', 'wl214-direct-insert', 'Direct', 'public',
      '20000000-0000-4000-8000-000000001802', '20000000-0000-4000-8000-000000001802')$$,
  '42501', null,
  'authenticated still cannot insert Forms directly');

select pg_temp.act('1806', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is((select count(*) from public.form_submissions), 1::bigint,
  'the Tenant B client reads only its own submission through RLS');
select is((select count(*) from public.form_submission_values), 0::bigint,
  'the Tenant B client cannot read protected answer rows');
select is((select count(*) from public.form_assignments
  where id = (select id from wl214_ids where label = 'wf-onboard-assignment')), 0::bigint,
  'the Tenant B client cannot read a WF assignment');
select is((select count(*) from public.form_assignments
  where id = (select id from wl214_ids where label = 'b-onboard-assignment')), 1::bigint,
  'the Tenant B client reads its own assignment');

-- -----------------------------------------------------------------------------
-- Selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1802', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.try($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001833', (select id from wl214_ids where label = 'b-public'))$$),
  '42501', 'a malformed selector fails closed for Form management');
select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001899"}');
select is(pg_temp.try($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001834', (select id from wl214_ids where label = 'b-public'))$$),
  '42501', 'an unknown Tenant selector fails closed for Form management');
select pg_temp.act('1804', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select is(pg_temp.try($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001835', (select id from wl214_ids where label = 'b-public'))$$),
  '42501', 'an archived membership fails closed for Form management');
select pg_temp.act('1802', '{"x-wf-tenant":"garbage"}');
select is(pg_temp.try($$select public.app_list_assigned_forms()$$),
  '42501', 'a malformed selector fails closed for the assigned-Form list');

-- -----------------------------------------------------------------------------
-- Public Form boundary (anonymous, preserved)
-- -----------------------------------------------------------------------------

reset role;
set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

set local role service_role;
select is(public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000001801', 'wl214-b-public') ->> 'form_version_id',
  (select id::text from wl214_ids where label = 'b-public-v1'),
  'trusted server reads the published Tenant B public schema by tenant and canonical key');
set local role anon;

select lives_ok($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001836',
    (select id from wl214_ids where label = 'wf-public-v1'), '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001801', 'value', 'Anon WF subject'),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001802', 'value', 'Anon WF message')
    ), '[]'::jsonb)$$,
  'anonymous submits the WF public Form');

select lives_ok($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001837',
    (select id from wl214_ids where label = 'b-public-v1'), '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001801', 'value', 'Anon B subject'),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001802', 'value', 'Anon B message')
    ), '[]'::jsonb)$$,
  'anonymous submits the Tenant B public Form');

reset role;
insert into wl214_ids select 'wf-anon-submission', id from public.form_submissions
where form_id = (select id from wl214_ids where label = 'wf-public') and submitted_by_profile_id is null;
insert into wl214_ids select 'b-anon-submission', id from public.form_submissions
where form_id = (select id from wl214_ids where label = 'b-public') and submitted_by_profile_id is null;

select is((select form_id from public.form_submissions
  where id = (select id from wl214_ids where label = 'wf-anon-submission')),
  (select id from wl214_ids where label = 'wf-public'),
  'the anonymous WF submission lands under the WF Form');
select is((select form_id from public.form_submissions
  where id = (select id from wl214_ids where label = 'b-anon-submission')),
  (select id from wl214_ids where label = 'b-public'),
  'the anonymous Tenant B submission lands under the Tenant B Form');
select is((select count(*) from public.tickets
  where source_form_submission_id = (select id from wl214_ids where label = 'wf-anon-submission')
    and tenant_id = private.wolf_forge_tenant_id()), 1::bigint,
  'the WF public Contact Form creates its Ticket inside WF');
select is((select count(*) from public.tickets
  where source_form_submission_id = (select id from wl214_ids where label = 'b-anon-submission')
    and tenant_id = 'f0f0f0f0-0000-4000-8000-000000001801'), 1::bigint,
  'the Tenant B public Contact Form creates its Ticket inside Tenant B');

-- -----------------------------------------------------------------------------
-- Signed-in cross-Tenant public semantics (preserved)
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('1802', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001801"}');
select lives_ok($$insert into wl214_ids values ('b-visitor-submission', (public.app_submit_form(
    '71000000-0000-4000-8000-000000001838',
    (select id from wl214_ids where label = 'wf-public-v1'), '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001801', 'value', 'Visitor subject'),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001802', 'value', 'Signed-in Tenant B owner behaving as visitor')
    ), '[]'::jsonb)).id)$$,
  'a signed-in Tenant B user may still submit the WF public Form as a visitor');
reset role;
select is((select form_id from public.form_submissions
  where id = (select id from wl214_ids where label = 'b-visitor-submission')),
  (select id from wl214_ids where label = 'wf-public'),
  'the visitor submission stays under the WF Form with no cross-Tenant business context');
set local role authenticated;

select pg_temp.act('1805', '');
select is(pg_temp.try($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001839',
    (select id from wl214_ids where label = 'wf-public-v1'),
    jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001802'),
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001801', 'value', 'Context subject'),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001802', 'value', 'Cross-tenant company context')
    ), '[]'::jsonb)$$),
  '42501', 'a WF client cannot supply Tenant B company context to the WF Form');
select is(pg_temp.try($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000001840',
    (select id from wl214_ids where label = 'b-public-v1'),
    jsonb_build_object('company_id', 'e0000000-0000-4000-8000-000000001802'),
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001801', 'value', 'Context subject'),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000001802', 'value', 'Foreign company context')
    ), '[]'::jsonb)$$),
  '42501', 'a WF client cannot supply Tenant B company context to the Tenant B Form');

-- -----------------------------------------------------------------------------
-- Activity events and the positive archive
-- -----------------------------------------------------------------------------

select pg_temp.act('1801', '');
select ok(
  (select count(*) from public.activity_events
   where entity_id = (select id from wl214_ids where label = 'wf-public') and action = 'form.archived') = 0
  and (select count(*) from public.activity_events
   where actor_profile_id = '20000000-0000-4000-8000-000000001802'
     and entity_id = (select id from wl214_ids where label = 'wf-public')) = 0,
  'blocked foreign Form management wrote zero WF events for the Tenant B actor');

select lives_ok($$select public.app_archive_form(
    '71000000-0000-4000-8000-000000001841', (select id from wl214_ids where label = 'wf-public'))$$,
  'the WF owner archives the WF Form');
select is((select archived_at is not null from public.forms
  where id = (select id from wl214_ids where label = 'wf-public')), true,
  'the WF Form is archived by its own Tenant');

select * from finish();
rollback;
