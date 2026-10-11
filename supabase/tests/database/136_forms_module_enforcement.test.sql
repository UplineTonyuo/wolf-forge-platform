begin;

select no_plan();

-- Regression seed for the approved Forms policies. The six denial/redaction
-- assertions fail at baseline adad483; this is not the complete acceptance suite.
-- Synthetic fixtures use the f136 UUID namespace and roll back with the test.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1801 WF owner; 1802 B owner (no WF membership); 1803 owner of both; 1804 B
-- owner with an archived B membership (no WF membership); 1805 WF client;
-- 1806 B client (no WF membership).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('f1360000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'forms136-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1801', '1802', '1803', '1804', '1805', '1806']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f1360010-0000-4000-8000-000000001801', 'forms136-authz-tenant-b', 'Form Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('f1360020-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'FORMS136_WF_CLIENT', 'client'),
  ('f1360020-0000-4000-8000-000000001802', 'f1360010-0000-4000-8000-000000001801', 'FORMS136_B_CLIENT', 'client');

insert into public.services (id, tenant_id, name, price, currency, is_active, is_public, recurring, sort_order)
values
  ('f1360030-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'FORMS136_WF_SERVICE', 100.00, 'USD', true, true, false, 0),
  ('f1360030-0000-4000-8000-000000001802', 'f1360010-0000-4000-8000-000000001801', 'FORMS136_B_SERVICE', 100.00, 'USD', true, true, false, 0);

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('f1360040-0000-4000-8000-000000001801', private.wolf_forge_tenant_id(), 'f1360020-0000-4000-8000-000000001801', 'f1360030-0000-4000-8000-000000001801', 'FORM AUTHZ WF Order'),
  ('f1360040-0000-4000-8000-000000001802', 'f1360010-0000-4000-8000-000000001801', 'f1360020-0000-4000-8000-000000001802', 'f1360030-0000-4000-8000-000000001802', 'FORM AUTHZ B Order');

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id in (
    'f1360000-0000-4000-8000-000000001801',
    'f1360000-0000-4000-8000-000000001802',
    'f1360000-0000-4000-8000-000000001803',
    'f1360000-0000-4000-8000-000000001804'
  )
  and role.name = 'owner';

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'f1360020-0000-4000-8000-000000001801'
where id = 'f1360000-0000-4000-8000-000000001805';

-- 1806 stays a default client profile (the auth trigger already assigned the
-- client role) with no global company; its Client identity is the explicit
-- Tenant B membership inserted below, so the Wolf Forge mirror never tries to
-- carry a Tenant B company on a Wolf Forge membership.

-- B-only users hold no Wolf Forge membership at all.
delete from public.tenant_memberships as membership_row
where membership_row.tenant_id = private.wolf_forge_tenant_id()
  and membership_row.profile_id in (
    'f1360000-0000-4000-8000-000000001802',
    'f1360000-0000-4000-8000-000000001804',
    'f1360000-0000-4000-8000-000000001806'
  );

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('f1360010-0000-4000-8000-000000001801', 'f1360000-0000-4000-8000-000000001802', 'internal', 'owner', null, null::timestamptz),
  ('f1360010-0000-4000-8000-000000001801', 'f1360000-0000-4000-8000-000000001803', 'internal', 'owner', null, null),
  ('f1360010-0000-4000-8000-000000001801', 'f1360000-0000-4000-8000-000000001804', 'internal', 'owner', null, now()),
  ('f1360010-0000-4000-8000-000000001801', 'f1360000-0000-4000-8000-000000001806', 'client', 'client', 'f1360020-0000-4000-8000-000000001802', null)
) as fixture(tenant_id, profile_id, account_class, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

create temp table wlforms136_ids (label text primary key, id uuid);
grant select, insert on wlforms136_ids to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', 'f1360000-0000-4000-8000-00000000' || p_actor, true);
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
      'subject_field_key', 'f1360060-0000-4000-8000-000000001801',
      'message_field_key', 'f1360060-0000-4000-8000-000000001802',
      'ticket_orchestration', 'deferred'
    ),
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', 'f1360060-0000-4000-8000-000000001801', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', 'f1360060-0000-4000-8000-000000001802', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)
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
      'stable_field_key', 'f1360060-0000-4000-8000-000000001803',
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
      'stable_field_key', 'f1360060-0000-4000-8000-000000001804',
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
insert into wlforms136_ids values ('wf-public', (public.app_create_form(
  'f1360050-0000-4000-8000-000000001801',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wlforms136-wf-public', 'definition', pg_temp.contact_def()))).id);
insert into wlforms136_ids values ('wf-onboard', (public.app_create_form(
  'f1360050-0000-4000-8000-000000001802',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wlforms136-wf-onboard', 'definition', pg_temp.onboard_def()))).id);
insert into wlforms136_ids select 'wf-public-v1', (public.app_publish_form(
  'f1360050-0000-4000-8000-000000001803', (select id from wlforms136_ids where label = 'wf-public'))).id;
insert into wlforms136_ids select 'wf-onboard-v1', (public.app_publish_form(
  'f1360050-0000-4000-8000-000000001804', (select id from wlforms136_ids where label = 'wf-onboard'))).id;
insert into wlforms136_ids values ('wf-intake', (public.app_create_form(
  'f1360050-0000-4000-8000-000000001805',
  jsonb_build_object('form_type', 'intake', 'canonical_key', 'wlforms136-wf-intake', 'definition', pg_temp.intake_def('f1360030-0000-4000-8000-000000001801')))).id);
insert into wlforms136_ids select 'wf-intake-v1', (public.app_publish_form(
  'f1360050-0000-4000-8000-000000001806', (select id from wlforms136_ids where label = 'wf-intake'))).id;
insert into wlforms136_ids select 'wf-onboard-assignment', (public.app_assign_form(
  'f1360050-0000-4000-8000-000000001807', (select id from wlforms136_ids where label = 'wf-onboard'),
  jsonb_build_object('client_profile_id', 'f1360000-0000-4000-8000-000000001805'))).id;
insert into wlforms136_ids select 'wf-intake-assignment', (public.app_assign_form(
  'f1360050-0000-4000-8000-000000001808', (select id from wlforms136_ids where label = 'wf-intake'),
  jsonb_build_object('order_id', 'f1360040-0000-4000-8000-000000001801'))).id;

select pg_temp.act('1802', '{"x-wf-tenant":"f1360010-0000-4000-8000-000000001801"}');
insert into wlforms136_ids values ('b-public', (public.app_create_form(
  'f1360050-0000-4000-8000-000000001809',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wlforms136-b-public', 'definition', pg_temp.contact_def()))).id);
insert into wlforms136_ids values ('b-onboard', (public.app_create_form(
  'f1360050-0000-4000-8000-000000001810',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wlforms136-b-onboard', 'definition', pg_temp.onboard_def()))).id);
insert into wlforms136_ids select 'b-public-v1', (public.app_publish_form(
  'f1360050-0000-4000-8000-000000001811', (select id from wlforms136_ids where label = 'b-public'))).id;
insert into wlforms136_ids select 'b-onboard-v1', (public.app_publish_form(
  'f1360050-0000-4000-8000-000000001812', (select id from wlforms136_ids where label = 'b-onboard'))).id;
insert into wlforms136_ids values ('b-intake', (public.app_create_form(
  'f1360050-0000-4000-8000-000000001813',
  jsonb_build_object('form_type', 'intake', 'canonical_key', 'wlforms136-b-intake', 'definition', pg_temp.intake_def('f1360030-0000-4000-8000-000000001802')))).id);
insert into wlforms136_ids select 'b-intake-v1', (public.app_publish_form(
  'f1360050-0000-4000-8000-000000001814', (select id from wlforms136_ids where label = 'b-intake'))).id;
insert into wlforms136_ids select 'b-onboard-assignment', (public.app_assign_form(
  'f1360050-0000-4000-8000-000000001815', (select id from wlforms136_ids where label = 'b-onboard'),
  jsonb_build_object('client_profile_id', 'f1360000-0000-4000-8000-000000001806'))).id;
insert into wlforms136_ids select 'b-intake-assignment', (public.app_assign_form(
  'f1360050-0000-4000-8000-000000001816', (select id from wlforms136_ids where label = 'b-intake'),
  jsonb_build_object('order_id', 'f1360040-0000-4000-8000-000000001802'))).id;

select pg_temp.act('1805', '');
insert into wlforms136_ids values ('wf-submission', (public.app_submit_form(
  'f1360050-0000-4000-8000-000000001817',
  (select id from wlforms136_ids where label = 'wf-onboard-v1'),
  jsonb_build_object('assignment_id', (select id from wlforms136_ids where label = 'wf-onboard-assignment')),
  jsonb_build_array(jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001803', 'value', 'WF client brand')),
  '[]'::jsonb)).id);

select pg_temp.act('1806', '{"x-wf-tenant":"f1360010-0000-4000-8000-000000001801"}');
insert into wlforms136_ids values ('b-submission', (public.app_submit_form(
  'f1360050-0000-4000-8000-000000001818',
  (select id from wlforms136_ids where label = 'b-onboard-v1'),
  jsonb_build_object('assignment_id', (select id from wlforms136_ids where label = 'b-onboard-assignment')),
  jsonb_build_array(jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001803', 'value', 'B client brand')),
  '[]'::jsonb)).id);

-- -----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '', true);
insert into public.form_submissions (
  id, form_id, form_version_id, form_assignment_id, company_id, order_id, root_submission_id,
  submitted_by_profile_id
) select
  'f1360070-0000-4000-8000-000000001823', form_id, form_version_id, id, company_id, order_id,
  'f1360070-0000-4000-8000-000000001823', 'f1360000-0000-4000-8000-000000001801'
from public.form_assignments where id = (select id from wlforms136_ids where label = 'wf-intake-assignment');
set local role authenticated;
select pg_temp.act('1805', '');
select ok(detail -> 'submission' ->> 'id' = (select id::text from wlforms136_ids where label = 'wf-submission')
  and detail -> 'values' -> 0 ->> 'value' = 'WF client brand', 'exact assignee reads the original historical receipt and answer')
from (select public.app_get_form_submission((select id from wlforms136_ids where label = 'wf-submission'))) as result(detail);
select ok(detail -> 'assignment' ->> 'assignment_id' = (select id::text from wlforms136_ids where label = 'wf-onboard-assignment')
  and detail -> 'schema' -> 'fields' -> 0 ->> 'label' = 'Brand name', 'exact assignee reads the original assignment schema and question')
from (select public.app_get_assigned_form_schema((select id from wlforms136_ids where label = 'wf-onboard-assignment'))) as result(detail);
select is(pg_temp.try('select public.app_get_assigned_form_schema((select id from wlforms136_ids where label = ''wf-intake-assignment''))'), '42501', 'NULL assignee refuses client schema');
select is(pg_temp.try($sql$insert into wlforms136_ids values ('null-intake-submission', (public.app_submit_form('f1360050-0000-4000-8000-000000001819', (select id from wlforms136_ids where label = 'wf-intake-v1'), jsonb_build_object('assignment_id', (select id from wlforms136_ids where label = 'wf-intake-assignment')), jsonb_build_array(jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001804', 'value', 'must not accept')), '[]'::jsonb)).id)$sql$), '42501', 'NULL assignee refuses client submit');
select is(pg_temp.try('select public.app_get_form_submission(''f1360070-0000-4000-8000-000000001823'')'), '42501', 'NULL assignee refuses client history');
select pg_temp.act('1802', '{"x-wf-tenant":"f1360010-0000-4000-8000-000000001801"}');
insert into wlforms136_ids values ('b-authenticated', (public.app_create_form('f1360050-0000-4000-8000-000000001820', jsonb_build_object('form_type', 'contact', 'canonical_key', 'wlforms136-b-authenticated', 'definition', pg_temp.contact_def() || '{"visibility":"authenticated"}'::jsonb))).id);
insert into wlforms136_ids values ('b-authenticated-v1', (public.app_publish_form('f1360050-0000-4000-8000-000000001821', (select id from wlforms136_ids where label = 'b-authenticated'))).id);
select pg_temp.act('1801', '');
select is(pg_temp.try('select public.app_get_published_form_schema(''wlforms136-b-authenticated'')'), '42501', 'foreign authenticated schema refuses selected Tenant authority');
reset role;
create temp table guest_receipt (kind text primary key, receipt jsonb);
grant select, insert on guest_receipt to anon, authenticated;
create function pg_temp.effects()
returns jsonb
language plpgsql
as $$
declare
  relation_name text;
  digest text;
  result jsonb := '{}'::jsonb;
begin
  foreach relation_name in array array[
    'public.form_submissions', 'public.form_submission_values', 'public.form_files',
    'public.form_assignments', 'private.form_submission_requests',
    'private.rate_limit_counters', 'private.bot_verifications', 'public.tickets',
    'public.ticket_messages', 'public.notifications', 'public.activity_events'
  ] loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text), ''[]''::jsonb)::text) from %s as row', relation_name)
      into digest;
    result := result || jsonb_build_object(relation_name, digest);
  end loop;
  return result;
end;
$$;
create temp table replay_effects (before_replay jsonb);
set local role anon;
set local "request.jwt.claim.role" = 'anon';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '', true);
insert into guest_receipt select 'initial', to_jsonb(public.app_submit_form('f1360050-0000-4000-8000-000000001822', (select id from wlforms136_ids where label = 'wf-public-v1'), '{}'::jsonb, jsonb_build_array(jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001801', 'value', 'synthetic subject'), jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001802', 'value', 'synthetic message')), '[]'::jsonb));
reset role;
insert into wlforms136_ids select 'guest-persisted', submission_id from private.form_submission_requests
where operation = 'form.submit' and request_id = 'f1360050-0000-4000-8000-000000001822';
insert into replay_effects select pg_temp.effects();
set local role anon;
insert into guest_receipt select 'replay', to_jsonb(public.app_submit_form('f1360050-0000-4000-8000-000000001822', (select id from wlforms136_ids where label = 'wf-public-v1'), '{}'::jsonb, jsonb_build_array(jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001801', 'value', 'synthetic subject'), jsonb_build_object('field_key', 'f1360060-0000-4000-8000-000000001802', 'value', 'synthetic message')), '[]'::jsonb));
select ok((select receipt ->> 'id' from guest_receipt where kind = 'replay') is not null
  and (select receipt ->> 'id' from guest_receipt where kind = 'replay') = (select id::text from wlforms136_ids where label = 'guest-persisted')
  and (select receipt ->> 'id' from guest_receipt where kind = 'initial') = (select id::text from wlforms136_ids where label = 'guest-persisted'), 'guest acknowledgement identifies the persisted original submission');
select is((select jsonb_strip_nulls(receipt) - 'id' from guest_receipt where kind = 'replay'), '{}'::jsonb, 'guest replay contains only acknowledgement information');
reset role;
select is(pg_temp.effects(), (select before_replay from replay_effects), 'accepted guest replay changes no receipt, quota, challenge, assignment or Contact effects');
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('1805', '');
select is(pg_temp.try('select public.app_get_form_submission((select id from wlforms136_ids where label = ''guest-persisted''))'), '42501', 'client refuses unrelated guest history');
reset role;
-- Lifecycle assertions extend the original ten regressions without changing them.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
select private.grant_platform_admin('f1360000-0000-4000-8000-000000001801','Forms rollback fixture publisher');
create temp table forms136_before_assignments as select to_jsonb(a) row from public.form_assignments a;
create temp table forms136_before_effects as select pg_temp.effects() effects;
select pg_temp.act('1801','');
select lives_ok($$select private.publish_tenant_modules(private.wolf_forge_tenant_id(),
  coalesce((select max(revision) from private.tenant_module_publications where tenant_id=private.wolf_forge_tenant_id()),0),
  (select array_agg(module_key order by module_key) from private.white_label_modules where module_key<>'forms'),
  'Forms OFF rollback test')$$,'Forms can be disabled with outstanding assignments');
select is((select jsonb_agg(to_jsonb(a) order by a.id) from public.form_assignments a),
  (select jsonb_agg(row order by row->>'id') from forms136_before_assignments),'OFF freezes every assignment byte-for-byte');
select is(pg_temp.effects(),(select effects from forms136_before_effects),'OFF publication changes no Form, quota, challenge or Contact effects');
select ok(not private.tenant_module_allowed(private.wolf_forge_tenant_id(),'forms'),'owning Tenant Forms is OFF');
select ok(private.tenant_module_allowed('f1360010-0000-4000-8000-000000001801','forms'),'another Tenant retains Forms ON');
set local role authenticated;
select pg_temp.act('1801','');
select ok(not public.app_forms_work_enabled(),'owner sees collection paused');
select ok(not public.app_has_permission('forms.manage') and not public.app_has_permission('forms.publish') and not public.app_has_permission('forms.assign') and not public.app_has_permission('forms.submissions_manage'),'OFF removes management capabilities without granting history privileges');
select ok(public.app_require_module_access('forms'),'owner retains Forms history entry');
select throws_ok($$select public.app_create_form('f1360050-0000-4000-8000-000000001830',jsonb_build_object('form_type','contact','canonical_key','forms136-off-create','definition',pg_temp.contact_def()))$$,'42501',null,'create refuses OFF');
select throws_ok($$select public.app_archive_form('f1360050-0000-4000-8000-000000001831',(select id from wlforms136_ids where label='wf-public'))$$,'42501',null,'archive refuses OFF');
select throws_ok($$select public.app_update_form_draft('f1360050-0000-4000-8000-000000001832',(select id from wlforms136_ids where label='wf-public'),pg_temp.contact_def())$$,'42501',null,'draft change refuses OFF');
select throws_ok($$select public.app_publish_form('f1360050-0000-4000-8000-000000001833',(select id from wlforms136_ids where label='wf-public'))$$,'42501',null,'publish refuses OFF');
select throws_ok($$select public.app_assign_form('f1360050-0000-4000-8000-000000001834',(select id from wlforms136_ids where label='wf-onboard'),'{"client_profile_id":"f1360000-0000-4000-8000-000000001805"}')$$,'42501',null,'assignment refuses OFF');
select throws_ok($$select public.app_correct_form_submission('f1360050-0000-4000-8000-000000001835',(select id from wlforms136_ids where label='wf-submission'),'[]')$$,'42501',null,'correction refuses OFF');
select pg_temp.act('1805','');
select ok(public.app_require_module_access('portal_forms'),'exact client retains history entry OFF');
select is(public.app_get_form_submission((select id from wlforms136_ids where label='wf-submission'))->'values'->0->>'value','WF client brand','exact client reads original response OFF');
select is(public.app_get_form_assignment_history((select id from wlforms136_ids where label='wf-onboard-assignment'))->>'assignment_id',(select id::text from wlforms136_ids where label='wf-onboard-assignment'),'client history loads without collection schema OFF');
select throws_ok($$select public.app_get_assigned_form_schema((select id from wlforms136_ids where label='wf-onboard-assignment'))$$,'42501',null,'collection schema refuses OFF');
select is((public.app_submit_form('f1360050-0000-4000-8000-000000001817',(select id from wlforms136_ids where label='wf-onboard-v1'),jsonb_build_object('assignment_id',(select id from wlforms136_ids where label='wf-onboard-assignment')),jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001803','value','WF client brand')),'[]')).id,(select id from wlforms136_ids where label='wf-submission'),'accepted member replay returns original ID OFF');
select throws_ok($$select public.app_submit_form('f1360050-0000-4000-8000-000000001836',(select id from wlforms136_ids where label='wf-onboard-v1'),jsonb_build_object('assignment_id',(select id from wlforms136_ids where label='wf-onboard-assignment')),jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001803','value','new refused')),'[]')$$,'42501',null,'new assigned response refuses OFF before effects');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
select throws_ok($$update public.forms set name='trusted off change' where id=(select id from wlforms136_ids where label='wf-public')$$,'42501',null,'trusted auth-NULL management refuses published OFF');
select throws_ok($$update public.form_versions set title='trusted off draft' where id=(select current_draft_version_id from public.forms where id=(select id from wlforms136_ids where label='wf-public'))$$,'42501',null,'trusted version write refuses OFF');
select throws_ok($$update public.form_assignments set due_at=now() where id=(select id from wlforms136_ids where label='wf-intake-assignment')$$,'42501',null,'trusted outstanding assignment mutation refuses OFF');
set local role anon;
set local "request.jwt.claim.role"='anon';
select throws_ok($$select public.app_get_published_form_schema('wlforms136-wf-public')$$,'P0002',null,'public schema unavailable OFF');
select is((public.app_submit_form('f1360050-0000-4000-8000-000000001822',(select id from wlforms136_ids where label='wf-public-v1'),'{}',jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001801','value','synthetic subject'),jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001802','value','synthetic message')),'[]')).id,(select id from wlforms136_ids where label='guest-persisted'),'accepted guest replay returns original ID OFF');
select throws_ok($$select public.app_submit_form('f1360050-0000-4000-8000-000000001837',(select id from wlforms136_ids where label='wf-public-v1'),'{}',jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001801','value','new subject'),jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001802','value','new message')),'[]')$$,'42501',null,'new guest collection refuses OFF');
reset role;
select is(pg_temp.effects(),(select effects from forms136_before_effects),'all refused work and accepted replay have zero effects');
select pg_temp.act('1801','');
select lives_ok($$select private.publish_tenant_modules(private.wolf_forge_tenant_id(),
  (select max(revision) from private.tenant_module_publications where tenant_id=private.wolf_forge_tenant_id()),
  (select array_agg(module_key order by module_key) from private.white_label_modules),'Forms re-enable rollback test')$$,'Forms can be re-enabled');
select is(pg_temp.effects(),(select effects from forms136_before_effects),'re-enable performs no conversion, repinning or publication of Form drafts');
set local role authenticated;
select pg_temp.act('1805','');
select ok(public.app_forms_work_enabled(),'collection eligibility restored ON');
select is(public.app_get_published_form_schema('wlforms136-wf-public')->>'form_version_id',(select id::text from wlforms136_ids where label='wf-public-v1'),'unchanged public URL restores exact published version');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
select throws_ok($$insert into public.form_submissions(id,form_id,form_version_id,company_id,root_submission_id)
  select 'f1360070-0000-4000-8000-000000001840',f.id,f.published_version_id,'f1360020-0000-4000-8000-000000001802','f1360070-0000-4000-8000-000000001840'
  from public.forms f where id=(select id from wlforms136_ids where label='wf-public')$$,'23514',null,'trusted receipt rejects foreign Company');
select throws_ok($$insert into public.form_submission_values(submission_id,form_version_field_id,stable_field_key,field_label_snapshot,field_type_snapshot,sort_order_snapshot,value)
  select (select id from wlforms136_ids where label='wf-submission'),f.id,f.stable_field_key,f.label,f.field_type,f.sort_order,'"foreign question"'::jsonb
  from public.form_version_fields f where f.form_version_id=(select id from wlforms136_ids where label='b-onboard-v1') limit 1$$,'23514',null,'trusted answer rejects a foreign receipt field');
select throws_ok($$update public.form_assignments set latest_submission_id=(select id from wlforms136_ids where label='b-submission') where id=(select id from wlforms136_ids where label='wf-onboard-assignment')$$,'23514',null,'trusted assignment rejects foreign latest receipt');
set local role authenticated;
select pg_temp.act('1805','');
select is((select count(*) from public.form_assignments where id=(select id from wlforms136_ids where label='wf-onboard-assignment')),1::bigint,'exact client direct assignment SELECT remains authorized');
select pg_temp.act('1801','');
select is((select count(*) from public.app_list_assigned_forms() where assignment_id=(select id from wlforms136_ids where label='wf-intake-assignment') and order_id='f1360040-0000-4000-8000-000000001801'),1::bigint,'authorized owner sees live Project context ON');
reset role;
select pg_temp.act('1801','');
update public.orders set status='complete',completed_at=now() where id='f1360040-0000-4000-8000-000000001801';
select private.publish_tenant_modules(private.wolf_forge_tenant_id(),
  (select max(revision) from private.tenant_module_publications where tenant_id=private.wolf_forge_tenant_id()),
  (select array_agg(module_key order by module_key) from private.white_label_modules where module_key not in ('projects')),'Project redaction rollback fixture');
set local role authenticated;
select pg_temp.act('1801','');
select is((select count(*) from public.app_list_assigned_forms() where assignment_id=(select id from wlforms136_ids where label='wf-intake-assignment') and order_id is null and order_number is null and order_title is null),1::bigint,'assignment list redacts unavailable live Project context');
select is(public.app_get_assigned_form_schema((select id from wlforms136_ids where label='wf-intake-assignment'))->'assignment'->>'order_title',null::text,'assigned schema redacts unavailable live Project context');
reset role;
select pg_temp.act('1801','');
update public.tickets set status='closed',closed_at=now() where source_form_submission_id=(select id from wlforms136_ids where label='guest-persisted');
select private.publish_tenant_modules(private.wolf_forge_tenant_id(),
  (select max(revision) from private.tenant_module_publications where tenant_id=private.wolf_forge_tenant_id()),
  (select array_agg(module_key order by module_key) from private.white_label_modules where module_key not in ('projects','tickets')),'Forms ON Tickets OFF rollback fixture');
set local role anon;
set local "request.jwt.claim.role"='anon';
select set_config('request.jwt.claim.sub','',true);
insert into wlforms136_ids values('forms-only-contact',(public.app_submit_form('f1360050-0000-4000-8000-000000001841',(select id from wlforms136_ids where label='wf-public-v1'),'{}',jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001801','value','Forms only'),jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001802','value','Stored without conversation')),'[]')).id);
reset role;
select ok(exists(select 1 from public.form_submissions where id=(select id from wlforms136_ids where label='forms-only-contact') and orchestration_type is null and orchestration_status='not_required' and provenance->>'tickets_enabled_at_submission'='false'),'Forms ON Tickets OFF stores nongenerative immutable answers');
select is((select count(*) from public.tickets where source_form_submission_id=(select id from wlforms136_ids where label='forms-only-contact')),0::bigint,'Forms-only Contact creates no Ticket');
select set_config('request.jwt.claim.sub','',true);
insert into public.form_submissions(id,form_id,form_version_id,root_submission_id,orchestration_type,orchestration_status)
select 'f1360070-0000-4000-8000-000000001843',id,published_version_id,'f1360070-0000-4000-8000-000000001843','contact_ticket','deferred'
from public.forms where id=(select id from wlforms136_ids where label='wf-public');
select ok(exists(select 1 from public.form_submissions where id='f1360070-0000-4000-8000-000000001843' and orchestration_type is null and orchestration_status='not_required' and provenance->>'tickets_enabled_at_submission'='false'),'trusted Contact insertion derives nongenerative provenance when Tickets OFF');
select pg_temp.act('1801','');
select private.publish_tenant_modules(private.wolf_forge_tenant_id(),
  (select max(revision) from private.tenant_module_publications where tenant_id=private.wolf_forge_tenant_id()),
  (select array_agg(module_key order by module_key) from private.white_label_modules),'Restore all modules rollback fixture');
select is(private.create_ticket_from_contact_submission((select id from wlforms136_ids where label='forms-only-contact')),null::uuid,'re-enable cannot convert Forms-only Contact');
select is((select count(*) from public.tickets where source_form_submission_id=(select id from wlforms136_ids where label='forms-only-contact')),0::bigint,'trusted later orchestration creates no Forms-only Ticket');
select set_config('request.jwt.claim.sub','',true);
insert into public.form_submission_values(submission_id,form_version_field_id,stable_field_key,field_label_snapshot,field_type_snapshot,sort_order_snapshot,value)
select 'f1360070-0000-4000-8000-000000001843',id,stable_field_key,label,field_type,sort_order,to_jsonb('Late synthetic answer'::text)
from public.form_version_fields where form_version_id=(select id from wlforms136_ids where label='wf-public-v1');
select is((select count(*) from public.tickets where source_form_submission_id='f1360070-0000-4000-8000-000000001843'),0::bigint,'trusted late answers after re-enable cannot convert a Forms-only receipt');
insert into public.form_submissions(id,form_id,form_version_id,root_submission_id,orchestration_type,orchestration_status,submitted_by_profile_id)
select 'f1360070-0000-4000-8000-000000001844',id,published_version_id,'f1360070-0000-4000-8000-000000001844','contact_ticket','deferred','f1360000-0000-4000-8000-000000001801'
from public.forms where id=(select id from wlforms136_ids where label='wf-public');
set local role authenticated;
select pg_temp.act('1801','');
insert into wlforms136_ids values('contact-correction',(public.app_correct_form_submission('f1360050-0000-4000-8000-000000001842',(select id from wlforms136_ids where label='forms-only-contact'),jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001801','value','Corrected Subject'),jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001802','value','Corrected message')))).id);
reset role;
select ok(exists(select 1 from public.form_submissions where id=(select id from wlforms136_ids where label='contact-correction') and orchestration_type is null and orchestration_status='not_required'),'Contact correction remains nongenerative while both modules ON');
select is((select count(*) from public.tickets where source_form_submission_id in ((select id from wlforms136_ids where label='contact-correction'),(select id from wlforms136_ids where label='forms-only-contact'))),0::bigint,'correction cannot generate an original or replacement Ticket');
set local role authenticated;
select pg_temp.act('1801','');
insert into wlforms136_ids values('deferred-correction',(public.app_correct_form_submission('f1360050-0000-4000-8000-000000001845','f1360070-0000-4000-8000-000000001844',jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001801','value','Deferred Subject'),jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001802','value','Deferred correction')))).id);
reset role;
select is((select count(*) from public.tickets where source_form_submission_id in ((select id from wlforms136_ids where label='deferred-correction'),'f1360070-0000-4000-8000-000000001844')),0::bigint,'correction of a trusted deferred receipt cannot orchestrate either receipt');
select pg_temp.act('1806','{"x-wf-tenant":"f1360010-0000-4000-8000-000000001801"}');
set local role authenticated;
select throws_ok($$select public.app_get_form_submission((select id from wlforms136_ids where label='wf-submission'))$$,'P0002',null,'foreign Tenant client cannot read known historical response');
select is((select count(*) from public.form_submissions where id=(select id from wlforms136_ids where label='wf-submission')),0::bigint,'secured direct history listing excludes a foreign Tenant receipt');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
update public.tenant_memberships set role_id=(select id from public.roles where name='staff')
where tenant_id=private.wolf_forge_tenant_id() and profile_id='f1360000-0000-4000-8000-000000001803';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
(private.wolf_forge_tenant_id(),'f1360000-0000-4000-8000-000000001803','forms.view',false),
(private.wolf_forge_tenant_id(),'f1360000-0000-4000-8000-000000001803','forms.submissions_view',true);
set local role authenticated;
select pg_temp.act('1803','');
select ok(public.app_require_module_access('forms'),'history-only staff enters Forms without builder permission');
select ok((select granted from public.app_current_user_modules() where module_key='forms'),'history-only staff has a reachable Forms navigation entry');
select is((select count(*) from public.forms where id=(select id from wlforms136_ids where label='wf-onboard')),0::bigint,'history-only capability grants no live builder definitions');
select is(public.app_get_form_submission((select id from wlforms136_ids where label='wf-submission'))->'values'->0->>'value','WF client brand','history-only staff reads original responses');
select is((select count(*) from public.form_submissions where id=(select id from wlforms136_ids where label='wf-submission')),1::bigint,'history-only staff direct response listing contains the authorized original receipt');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.tenant_memberships set archived_at=now() where tenant_id=private.wolf_forge_tenant_id() and profile_id='f1360000-0000-4000-8000-000000001803';
set local role authenticated;
select pg_temp.act('1803','');
select throws_ok($$select public.app_get_form_submission((select id from wlforms136_ids where label='wf-submission'))$$,'42501',null,'revoked membership removes retained history authority');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.headers','',true);
update public.forms set archived_at=now(),status='archived' where id=(select id from wlforms136_ids where label='wf-onboard');
set local role authenticated;
select pg_temp.act('1801','');
select throws_ok($$select public.app_correct_form_submission('f1360050-0000-4000-8000-000000001870',(select id from wlforms136_ids where label='wf-submission'),'[]')$$,'P0002',null,'archived Form refuses new correction before values validation');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into public.form_submission_values(submission_id,form_version_field_id,stable_field_key,field_label_snapshot,field_type_snapshot,sort_order_snapshot,value)
  select s.id,f.id,f.stable_field_key,f.label,f.field_type,f.sort_order,'"late answer"'::jsonb from public.form_submissions s join public.form_version_fields f on f.form_version_id=s.form_version_id where s.id=(select id from wlforms136_ids where label='wf-submission') limit 1$$,'55000',null,'trusted late answer refuses archived Form');
update public.forms set archived_at=null,status='published' where id=(select id from wlforms136_ids where label='wf-onboard');
update public.companies set archived_at=now() where id='f1360020-0000-4000-8000-000000001801';
set local role authenticated;
select pg_temp.act('1801','');
select throws_ok($$select public.app_correct_form_submission('f1360050-0000-4000-8000-000000001871',(select id from wlforms136_ids where label='wf-submission'),'[]')$$,'P0002',null,'archived Company refuses correction');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.companies set archived_at=null where id='f1360020-0000-4000-8000-000000001801';
update public.form_assignments set archived_at=now(),status='archived' where id=(select id from wlforms136_ids where label='wf-onboard-assignment');
set local role authenticated;
select pg_temp.act('1801','');
select throws_ok($$select public.app_correct_form_submission('f1360050-0000-4000-8000-000000001872',(select id from wlforms136_ids where label='wf-submission'),'[]')$$,'P0002',null,'archived assignment refuses correction');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into public.form_submission_values(submission_id,form_version_field_id,stable_field_key,field_label_snapshot,field_type_snapshot,sort_order_snapshot,value)
  select s.id,f.id,f.stable_field_key,f.label,f.field_type,f.sort_order,'"late answer"'::jsonb from public.form_submissions s join public.form_version_fields f on f.form_version_id=s.form_version_id where s.id=(select id from wlforms136_ids where label='wf-submission') limit 1$$,'55000',null,'trusted late answer refuses archived assignment');
update public.form_assignments set archived_at=null,status='completed' where id=(select id from wlforms136_ids where label='wf-onboard-assignment');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into public.form_submissions(id,form_id,form_version_id,root_submission_id)
 select 'f1360070-0000-4000-8000-000000001876',id,current_draft_version_id,'f1360070-0000-4000-8000-000000001876' from public.forms where id=(select id from wlforms136_ids where label='wf-public')$$,'55000',null,'trusted new root refuses unpublished draft version');
select throws_ok($$insert into public.form_submissions(id,form_id,form_version_id,form_assignment_id,company_id,client_profile_id,root_submission_id)
 select 'f1360070-0000-4000-8000-000000001877',form_id,form_version_id,id,company_id,client_profile_id,'f1360070-0000-4000-8000-000000001877' from public.form_assignments where id=(select id from wlforms136_ids where label='wf-onboard-assignment')$$,'55000',null,'trusted new root refuses completed assignment');
update public.forms set archived_at=now(),status='archived' where id=(select id from wlforms136_ids where label='wf-public');
set local role authenticated;
select pg_temp.act('1801','');
select throws_ok($$select public.app_correct_form_submission('f1360050-0000-4000-8000-000000001842',(select id from wlforms136_ids where label='forms-only-contact'),jsonb_build_array(jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001801','value','Corrected Subject'),jsonb_build_object('field_key','f1360060-0000-4000-8000-000000001802','value','Corrected message')))$$,'P0002',null,'accepted correction replay rechecks archived parent');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$insert into public.form_submissions(id,form_id,form_version_id,root_submission_id) select 'f1360070-0000-4000-8000-000000001875',id,published_version_id,'f1360070-0000-4000-8000-000000001875' from public.forms where id=(select id from wlforms136_ids where label='wf-public')$$,'55000',null,'trusted new root refuses archived Form');
select * from finish();
rollback;
