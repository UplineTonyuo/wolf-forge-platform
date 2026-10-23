begin;

select plan(37);

-- WL-2.28 (KI-137): a client's onboarding Form assignment may only be completed
-- by a valid submission of the exact Form the assignment references. Submitting
-- a different (order / contact) Form with that assignment_id in the context
-- used to attach the assignment to the submission and mark it completed with an
-- unrelated latest_submission_id. It must now be refused (42501) and must leave
-- the assignment, submissions and activity untouched.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = f0f0f0f0-0000-4000-8000-000000002901.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 2901 WF admin. 2902 B admin only (the role mirror also claims them into
-- Wolf Forge as internal; no assertion reads 2902). 2903 WF client of the WF Client.
-- 2904 global client of the WF Client + B client of the B Client.
-- 2905 global WF admin + B internal admin.
-- 2906 global client of the WF Client + B client of the B Client (dual).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'form-bind-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['2901', '2902', '2903', '2904', '2905', '2906']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002901', 'form-bind-tenant-b', 'Form Bind Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e7000000-0000-4000-8000-000000002901', private.wolf_forge_tenant_id(), 'FBIND WF Client', 'client'),
  ('e7000000-0000-4000-8000-000000002902', 'f0f0f0f0-0000-4000-8000-000000002901', 'FBIND B Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002901', 'admin', null),
  ('20000000-0000-4000-8000-000000002902', 'admin', null),
  ('20000000-0000-4000-8000-000000002903', 'client', 'e7000000-0000-4000-8000-000000002901'),
  ('20000000-0000-4000-8000-000000002904', 'client', 'e7000000-0000-4000-8000-000000002901'),
  ('20000000-0000-4000-8000-000000002905', 'admin', null),
  ('20000000-0000-4000-8000-000000002906', 'client', 'e7000000-0000-4000-8000-000000002901')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-000000002901', '20000000-0000-4000-8000-000000002902', 'admin', 'internal', null, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000002901', '20000000-0000-4000-8000-000000002904', 'client', 'client', 'e7000000-0000-4000-8000-000000002902', null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000002901', '20000000-0000-4000-8000-000000002905', 'admin', 'internal', null, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000002901', '20000000-0000-4000-8000-000000002906', 'client', 'client', 'e7000000-0000-4000-8000-000000002902', null::timestamptz)
) as fixture(tenant_id, profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub',
    coalesce('20000000-0000-4000-8000-00000000' || p_actor, ''), true);
  select set_config('request.headers', case p_selector
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002901"}'
    else ''
    end, true);
$$;

create function pg_temp.def(p_type text, p_visibility text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'FBIND ' || p_type, 'title', 'FBIND ' || p_type, 'visibility', p_visibility,
    'type_config', case p_type
      when 'contact' then jsonb_build_object(
        'subject_field_key', '5a000000-0000-4000-8000-000000002901',
        'message_field_key', '5a000000-0000-4000-8000-000000002902',
        'ticket_orchestration', 'deferred')
      when 'onboarding' then jsonb_build_object('reuse_policy', 'company_profile')
      else '{}'::jsonb end,
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '5a000000-0000-4000-8000-000000002901', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '5a000000-0000-4000-8000-000000002902', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb);
$$;

create temp table ids (k text primary key, v uuid);
grant all on ids to anon, authenticated;

-- Submit a Form version by key with a fresh request id; returns the submission
-- id or the SQLSTATE.
create function pg_temp.sub_rq(p_request uuid, p_version text, p_tag text, p_context jsonb default '{}'::jsonb)
returns text
language plpgsql
as $$
declare
  submission_id uuid;
begin
  submission_id := (public.app_submit_form(p_request, (select v from ids where k = p_version), p_context,
    jsonb_build_array(
      jsonb_build_object('field_key', '5a000000-0000-4000-8000-000000002901', 'value', p_tag),
      jsonb_build_object('field_key', '5a000000-0000-4000-8000-000000002902', 'value', p_tag || ' message')),
    '[]'::jsonb)).id;
  insert into ids values (p_tag, submission_id);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.sub(p_version text, p_tag text, p_context jsonb default '{}'::jsonb)
returns text
language sql
as $$
  select pg_temp.sub_rq(gen_random_uuid(), p_version, p_tag, p_context);
$$;

-- status, latest submission, linked submission count, linked activity count.
create function pg_temp.assignment_state(p_assignment uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select assignment.status || ':' || coalesce(assignment.latest_submission_id::text, '-') || ':'
    || (select count(*) from public.form_submissions as submission
        where submission.form_assignment_id = p_assignment) || ':'
    || (select count(*) from public.activity_events as event
        where event.metadata ->> 'assignment_id' = p_assignment::text)
  from public.form_assignments as assignment
  where assignment.id = p_assignment;
$$;

grant execute on function pg_temp.act(text, text), pg_temp.sub(text, text, jsonb),
  pg_temp.sub_rq(uuid, text, text, jsonb), pg_temp.assignment_state(uuid) to anon, authenticated;

-- Forms: Tenant B public contact / public order / authenticated order /
-- assigned onboarding, and Wolf Forge public contact / public order /
-- assigned onboarding.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2902', 'b');
insert into ids values ('b-contact', (public.app_create_form('72000000-0000-4000-8000-000000002901',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl228-b-contact', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('b-order', (public.app_create_form('72000000-0000-4000-8000-000000002902',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl228-b-order', 'definition', pg_temp.def('order', 'public')))).id);
insert into ids values ('b-auth', (public.app_create_form('72000000-0000-4000-8000-000000002903',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl228-b-auth', 'definition', pg_temp.def('order', 'authenticated')))).id);
insert into ids values ('b-onboard', (public.app_create_form('72000000-0000-4000-8000-000000002904',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wl228-b-onboard', 'definition', pg_temp.def('onboarding', 'assigned')))).id);
insert into ids values ('b-contact-v', (public.app_publish_form('72000000-0000-4000-8000-000000002905', (select v from ids where k = 'b-contact'))).id);
insert into ids values ('b-order-v', (public.app_publish_form('72000000-0000-4000-8000-000000002906', (select v from ids where k = 'b-order'))).id);
insert into ids values ('b-auth-v', (public.app_publish_form('72000000-0000-4000-8000-000000002907', (select v from ids where k = 'b-auth'))).id);
insert into ids values ('b-onboard-v', (public.app_publish_form('72000000-0000-4000-8000-000000002908', (select v from ids where k = 'b-onboard'))).id);
insert into ids values ('b-onboard-a', (public.app_assign_form('72000000-0000-4000-8000-000000002909', (select v from ids where k = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002904'))).id);
insert into ids values ('b-onboard-a2', (public.app_assign_form('72000000-0000-4000-8000-000000002910', (select v from ids where k = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002906'))).id);

select pg_temp.act('2901', 'wf');
insert into ids values ('wf-contact', (public.app_create_form('72000000-0000-4000-8000-000000002911',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl228-wf-contact', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('wf-order', (public.app_create_form('72000000-0000-4000-8000-000000002912',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl228-wf-order', 'definition', pg_temp.def('order', 'public')))).id);
insert into ids values ('wf-onboard', (public.app_create_form('72000000-0000-4000-8000-000000002913',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wl228-wf-onboard', 'definition', pg_temp.def('onboarding', 'assigned')))).id);
insert into ids values ('wf-contact-v', (public.app_publish_form('72000000-0000-4000-8000-000000002914', (select v from ids where k = 'wf-contact'))).id);
insert into ids values ('wf-order-v', (public.app_publish_form('72000000-0000-4000-8000-000000002915', (select v from ids where k = 'wf-order'))).id);
insert into ids values ('wf-onboard-v', (public.app_publish_form('72000000-0000-4000-8000-000000002916', (select v from ids where k = 'wf-onboard'))).id);
insert into ids values ('wf-onboard-a', (public.app_assign_form('72000000-0000-4000-8000-000000002917', (select v from ids where k = 'wf-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002903'))).id);
reset role;

-- -----------------------------------------------------------------------------
-- The exact Form completes the assignment (Wolf Forge and Tenant B regressions)
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2903', 'wf');
select is(pg_temp.sub('wf-onboard-v', 'wf-own', jsonb_build_object('assignment_id', (select v from ids where k = 'wf-onboard-a'))), 'ok',
  'a Wolf Forge client submits its own Wolf Forge onboarding assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'wf-onboard-a'))
    = 'completed:' || (select v from ids where k = 'wf-own') || ':1:1',
  'the matching Wolf Forge submission completes the assignment and links the submission');

select pg_temp.act('2904', 'b');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the Tenant B assignment starts assigned with no linked submission or activity');

-- -----------------------------------------------------------------------------
-- KI-137: a different Form must never complete the assignment
-- -----------------------------------------------------------------------------

select is(pg_temp.sub('b-contact-v', 'wrong-contact', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a Tenant B client cannot submit the public Contact Form against its onboarding assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the wrong-Form Contact attempt leaves the assignment, submissions and activity untouched');

select is(pg_temp.sub('b-order-v', 'wrong-order', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a Tenant B client cannot submit the public Order Form against its onboarding assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the wrong-Form Order attempt leaves the assignment, submissions and activity untouched');

select is(pg_temp.sub('b-auth-v', 'wrong-auth', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a Tenant B client cannot submit the authenticated Order Form against its onboarding assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the wrong-Form authenticated attempt leaves the assignment, submissions and activity untouched');

select pg_temp.act('2905', 'b');
select is(pg_temp.sub('b-contact-v', 'internal-wrong', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'Tenant B staff cannot attach an onboarding assignment to the public Contact Form');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the staff wrong-Form attempt leaves the assignment, submissions and activity untouched');

set local role anon;
set local "request.jwt.claim.role" = 'anon';
select pg_temp.act(null, null);
select is(pg_temp.sub('b-contact-v', 'anon-wrong', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'an anonymous guest cannot submit the public Contact Form against someone''s assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the anonymous wrong-Form attempt leaves the assignment, submissions and activity untouched');
select is(pg_temp.sub('b-contact-v', 'anon-bad-id', jsonb_build_object('assignment_id', 'not-a-uuid')), '42501',
  'an anonymous guest with an invalid assignment id is refused');
reset role;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2903', 'b');
select is(pg_temp.sub('b-contact-v', 'nonmember-wrong', jsonb_build_object('assignment_id', (select v from ids where k = 'wf-onboard-a'))), '42501',
  'a signed-in non-member guest cannot carry a Wolf Forge assignment into the Tenant B public Form');

select pg_temp.act('2904', 'wf');
select is(pg_temp.sub('wf-contact-v', 'b-on-wf-wrong', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a Tenant B client cannot carry a Tenant B assignment into the Wolf Forge public Form');

select pg_temp.act('2904', 'b');
select is(pg_temp.sub('b-contact-v', 'foreign-assign', jsonb_build_object('assignment_id', (select v from ids where k = 'wf-onboard-a'))), '42501',
  'a Wolf Forge assignment cannot be attached to the Tenant B public Form');
select is(pg_temp.sub('b-contact-v', 'bad-id', jsonb_build_object('assignment_id', 'not-a-uuid')), '22P02',
  'an invalid assignment id is refused safely');

select pg_temp.act('2906', 'b');
select is(pg_temp.sub('b-contact-v', 'sibling-wrong', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a same-company client cannot submit the public Contact Form against another client''s assignment');

select pg_temp.act('2904', 'b');
select is(pg_temp.sub_rq('76000000-0000-4000-8000-000000002901', 'b-contact-v', 'replay-a',
    jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a wrong-Form attempt with a fixed request id is refused');
select is(pg_temp.sub_rq('76000000-0000-4000-8000-000000002901', 'b-contact-v', 'replay-b',
    jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'the same request id with a different attempt is refused again, never accepted');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a')) = 'assigned:-:0:0',
  'the replayed wrong-Form attempts leave the assignment, submissions and activity untouched');

-- -----------------------------------------------------------------------------
-- The exact Form still completes the assignment (Tenant B regression)
-- -----------------------------------------------------------------------------

select is(pg_temp.sub('b-onboard-v', 'b-own', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), 'ok',
  'the Tenant B client still submits its own Tenant B onboarding assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a'))
    = 'completed:' || (select v from ids where k = 'b-own') || ':1:1',
  'the matching Tenant B submission completes the assignment and links the submission');

-- -----------------------------------------------------------------------------
-- A completed assignment cannot transition through a different Form or a retry
-- -----------------------------------------------------------------------------

select is(pg_temp.sub('b-contact-v', 'after-complete-wrong', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a completed assignment is refused against the public Contact Form');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a'))
    = 'completed:' || (select v from ids where k = 'b-own') || ':1:1',
  'the completed assignment keeps its original latest submission');

select is(pg_temp.sub('b-onboard-v', 'after-complete-retry', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'resubmitting the exact Form after completion is refused');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a'))
    = 'completed:' || (select v from ids where k = 'b-own') || ':1:1',
  'the completed assignment stays completed with its original latest submission');

-- -----------------------------------------------------------------------------
-- Assignment ownership and missing / foreign assignments
-- -----------------------------------------------------------------------------

select pg_temp.act('2906', 'b');
select is(pg_temp.sub('b-onboard-v', 'other-client', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'another client cannot submit the assigned Form against someone else''s assignment');

select pg_temp.act('2904', 'b');
select is(pg_temp.sub('b-onboard-v', 'missing-assignment'), '42501',
  'an assigned Form without an assignment id is refused');
select is(pg_temp.sub('b-onboard-v', 'unknown-assignment', jsonb_build_object('assignment_id', '7f000000-0000-4000-8000-0000000029ff')), '42501',
  'an assigned Form with an unknown assignment id is refused');

select pg_temp.act('2906', 'wf');
select is(pg_temp.sub('wf-onboard-v', 'dual-cross', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a2'))), '42501',
  'the dual client cannot submit the Wolf Forge assigned Form against its Tenant B assignment');

select pg_temp.act('2904', 'b');
select is(pg_temp.sub('wf-onboard-v', 'b-on-wf-assigned', jsonb_build_object('assignment_id', (select v from ids where k = 'wf-onboard-a'))), '42501',
  'a Tenant B client cannot submit the Wolf Forge assigned Form against a Wolf Forge assignment');

set local role anon;
select pg_temp.act(null, null);
select is(pg_temp.sub('b-onboard-v', 'anon-assigned', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a2'))), '42501',
  'an anonymous guest cannot submit an assigned Form against anyone''s assignment');
reset role;

set local role authenticated;
select pg_temp.act('2906', 'b');
select is(pg_temp.sub('b-onboard-v', 'dual-own', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a2'))), 'ok',
  'the dual client still submits its own Tenant B onboarding assignment');
select ok(pg_temp.assignment_state((select v from ids where k = 'b-onboard-a2'))
    = 'completed:' || (select v from ids where k = 'dual-own') || ':1:1',
  'the dual client''s matching submission completes its own assignment');
reset role;

-- -----------------------------------------------------------------------------
-- The exact version is authoritative too: a later published version of the
-- same onboarding Form cannot complete an assignment pinned to version 1.
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('2902', 'b');
insert into ids values ('b-onboard-a3', (public.app_assign_form('72000000-0000-4000-8000-000000002919', (select v from ids where k = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002904'))).id);
insert into ids values ('b-onboard-v2', (public.app_publish_form('72000000-0000-4000-8000-000000002918', (select v from ids where k = 'b-onboard'))).id);
select pg_temp.act('2904', 'b');
select is(pg_temp.sub('b-onboard-v2', 'v2-against-v1', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a3'))), '42501',
  'a later published version of the assigned Form cannot complete an assignment pinned to the earlier version');
reset role;

select * from finish();

rollback;
