begin;

select plan(38);

-- WL-2.29 (KI-138 item 3): a Form accepts submissions only while its owning
-- Tenant (forms.tenant_id) is active. A suspended or archived Tenant's Forms
-- are refused before any write, with the same 55000 contract as an
-- unavailable Form, whatever the caller, selector or context claims.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = f0f0f0f0-0000-4000-8000-000000002901.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 2901 WF admin. 2902 B admin. 2903 B client of the B Client.
-- 2904 WF client of the WF Client (no B membership: guest on B public Forms).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'suspended-form-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['2901', '2902', '2903', '2904']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002901', 'suspended-form-tenant-b', 'Suspended Form Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e7000000-0000-4000-8000-000000002901', private.wolf_forge_tenant_id(), 'SFT WF Client', 'client'),
  ('e7000000-0000-4000-8000-000000002902', 'f0f0f0f0-0000-4000-8000-000000002901', 'SFT B Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002901', 'admin', null),
  ('20000000-0000-4000-8000-000000002904', 'client', 'e7000000-0000-4000-8000-000000002901')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select 'f0f0f0f0-0000-4000-8000-000000002901', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002902', 'admin', 'internal', null),
  ('20000000-0000-4000-8000-000000002903', 'client', 'client', 'e7000000-0000-4000-8000-000000002902')
) as fixture(profile_id, role_name, account_class, company_id)
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
    'name', 'SFT ' || p_type, 'title', 'SFT ' || p_type, 'visibility', p_visibility,
    'type_config', case p_type
      when 'contact' then jsonb_build_object(
        'subject_field_key', '58000000-0000-4000-8000-000000002901',
        'message_field_key', '58000000-0000-4000-8000-000000002902',
        'ticket_orchestration', 'deferred')
      when 'onboarding' then jsonb_build_object('reuse_policy', 'company_profile')
      else '{}'::jsonb end,
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000002901', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000002902', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb);
$$;

create temp table ids (k text primary key, v uuid);
grant all on ids to anon, authenticated;

-- Submit a Form version by key; returns 'ok' or the SQLSTATE.
create function pg_temp.sub(p_version text, p_tag text, p_context jsonb default '{}'::jsonb,
  p_request_id uuid default gen_random_uuid())
returns text
language plpgsql
as $$
declare
  submission_id uuid;
begin
  submission_id := (public.app_submit_form(p_request_id, (select v from ids where k = p_version), p_context,
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000002901', 'value', p_tag),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000002902', 'value', p_tag || ' message')),
    '[]'::jsonb)).id;
  insert into ids values (p_tag, submission_id);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Every row a submission can create, directly or through triggers.
create function pg_temp.fx()
returns text
language sql
as $$
  select concat_ws('|',
    (select count(*) from public.form_submissions),
    (select count(*) from public.form_submission_values),
    (select count(*) from public.tickets),
    (select count(*) from public.ticket_messages),
    (select count(*) from public.notifications),
    (select count(*) from public.activity_events),
    (select count(*) from public.form_assignments where status = 'completed'),
    (select coalesce(sum(hits), 0) from private.rate_limit_counters),
    (select count(*) from private.form_submission_requests),
    (select count(*) from private.bot_verifications));
$$;

create temp table fx_snap (k text primary key, v text);
grant all on fx_snap to anon, authenticated;

create function pg_temp.status(p_tenant text, p_status text)
returns void
language sql
as $$
  update public.tenants
  set status = p_status, archived_at = case when p_status = 'archived' then now() end
  where id = case p_tenant when 'b' then 'f0f0f0f0-0000-4000-8000-000000002901'::uuid
    else private.wolf_forge_tenant_id() end;
$$;

grant execute on function pg_temp.act(text, text), pg_temp.sub(text, text, jsonb, uuid), pg_temp.fx()
  to anon, authenticated;

-- Forms: Tenant B public contact / public order / authenticated order /
-- assigned onboarding / draft, and a Wolf Forge public contact.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2902', 'b');
insert into ids values ('b-contact', (public.app_create_form('71000000-0000-4000-8000-000000002901',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl229-b-contact', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('b-order', (public.app_create_form('71000000-0000-4000-8000-000000002902',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl229-b-order', 'definition', pg_temp.def('order', 'public')))).id);
insert into ids values ('b-auth', (public.app_create_form('71000000-0000-4000-8000-000000002903',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl229-b-auth', 'definition', pg_temp.def('order', 'authenticated')))).id);
insert into ids values ('b-onboard', (public.app_create_form('71000000-0000-4000-8000-000000002904',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wl229-b-onboard', 'definition', pg_temp.def('onboarding', 'assigned')))).id);
insert into ids values ('b-draft', (public.app_create_form('71000000-0000-4000-8000-000000002905',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl229-b-draft', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('b-contact-v', (public.app_publish_form('71000000-0000-4000-8000-000000002906', (select v from ids where k = 'b-contact'))).id);
insert into ids values ('b-order-v', (public.app_publish_form('71000000-0000-4000-8000-000000002907', (select v from ids where k = 'b-order'))).id);
insert into ids values ('b-auth-v', (public.app_publish_form('71000000-0000-4000-8000-000000002908', (select v from ids where k = 'b-auth'))).id);
insert into ids values ('b-onboard-v', (public.app_publish_form('71000000-0000-4000-8000-000000002909', (select v from ids where k = 'b-onboard'))).id);
insert into ids values ('b-onboard-a', (public.app_assign_form('71000000-0000-4000-8000-000000002910', (select v from ids where k = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002903'))).id);

select pg_temp.act('2901', 'wf');
insert into ids values ('wf-contact', (public.app_create_form('71000000-0000-4000-8000-000000002911',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl229-wf-contact', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('wf-contact-v', (public.app_publish_form('71000000-0000-4000-8000-000000002912', (select v from ids where k = 'wf-contact'))).id);
reset role;

insert into ids select 'b-draft-v', id from public.form_versions
where form_id = (select v from ids where k = 'b-draft');

-- -----------------------------------------------------------------------------
-- Active Tenants keep working (D-291 guest, D-292 binding)
-- -----------------------------------------------------------------------------

set local role anon;
set local "request.jwt.claim.role" = 'anon';
select pg_temp.act(null, null);
select is(pg_temp.sub('b-contact-v', 'anon-b'), 'ok', 'anonymous submits the active Tenant B public Contact Form');
select is(pg_temp.sub('wf-contact-v', 'anon-wf'), 'ok', 'anonymous submits the active Wolf Forge public Contact Form');
select is(pg_temp.sub('b-draft-v', 'anon-draft'), 'P0002', 'an unpublished Form is refused');
select is(pg_temp.sub('b-contact-v', 'anon-replay-seed', '{}'::jsonb, '72000000-0000-4000-8000-000000002901'), 'ok',
  'anonymous seeds a request id while Tenant B is active');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2904', 'wf');
select is(pg_temp.sub('b-contact-v', 'guest-b'), 'ok', 'a Wolf Forge client submits the active Tenant B public Form as a guest (D-291)');
select pg_temp.act('2903', 'b');
select is(pg_temp.sub('b-auth-v', 'client-b-auth'), 'ok', 'a Tenant B client submits the active Tenant B authenticated Form');
select is(pg_temp.sub('b-auth-v', 'client-b-wrong-form', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'an assignment id on a different Form is still refused (D-292)');
reset role;

select is((select submitted_by_profile_id from public.form_submissions where id = (select v from ids where k = 'guest-b')), null,
  'the cross-Tenant visitor is recorded as a guest (D-291)');
select is((select status from public.form_assignments where id = (select v from ids where k = 'b-onboard-a')), 'assigned',
  'the wrong-Form attempt leaves the assignment open (D-292)');

-- -----------------------------------------------------------------------------
-- Suspended Tenant B: every path is refused before any write
-- -----------------------------------------------------------------------------

select pg_temp.status('b', 'suspended');
insert into fx_snap values ('before-b', pg_temp.fx());

set local role anon;
set local "request.jwt.claim.role" = 'anon';
select pg_temp.act(null, null);
select is(pg_temp.sub('b-contact-v', 'susp-anon-contact'), '55000', 'anonymous cannot submit a suspended Tenant B public Contact Form');
select is(pg_temp.sub('b-order-v', 'susp-anon-order'), '55000', 'anonymous cannot submit a suspended Tenant B public Order Form');
select throws_ok(
  format($sql$select public.app_submit_form(gen_random_uuid(), %L, '{}'::jsonb,
    '[{"field_key":"58000000-0000-4000-8000-000000002901","value":"x"},{"field_key":"58000000-0000-4000-8000-000000002902","value":"y"}]'::jsonb)$sql$,
    (select v from ids where k = 'b-contact-v')),
  '55000', 'Form version is unavailable for submission',
  'the refusal reuses the unavailable-Form contract and does not disclose the Tenant status');
select is(pg_temp.sub('b-draft-v', 'susp-anon-draft'), 'P0002', 'an unpublished suspended Tenant Form keeps its existing refusal');
select pg_temp.act(null, 'b');
select is(pg_temp.sub('b-contact-v', 'susp-anon-selector'), '55000', 'a forged Tenant B selector does not help anonymous callers');
select is(pg_temp.sub('b-contact-v', 'susp-anon-company', jsonb_build_object('company_id', 'e7000000-0000-4000-8000-000000002902')), '55000',
  'a context Company claim does not bypass the Tenant status');
select pg_temp.act(null, null);
select is(pg_temp.sub('b-contact-v', 'susp-anon-new-request'), '55000', 'a fresh request id cannot create a new submission');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2904', 'wf');
select is(pg_temp.sub('b-contact-v', 'susp-guest'), '55000', 'a cross-Tenant guest cannot submit a suspended Tenant B public Form');
select pg_temp.act('2903', 'b');
select is(pg_temp.sub('b-order-v', 'susp-client-public'), '55000', 'a Tenant B client cannot submit a suspended Tenant B public Form');
select is(pg_temp.sub('b-auth-v', 'susp-client-auth'), '42501', 'a Tenant B client cannot submit a suspended Tenant B authenticated Form');
select is(pg_temp.sub('b-onboard-v', 'susp-client-onboard', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a valid onboarding assignment cannot be completed while Tenant B is suspended');
select pg_temp.act('2902', 'b');
select is(pg_temp.sub('b-contact-v', 'susp-staff'), '55000', 'Tenant B staff cannot submit a suspended Tenant B public Form');
select is(pg_temp.sub('b-onboard-v', 'susp-staff-onboard', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'Tenant B staff cannot complete the assignment on behalf of the client while suspended');
reset role;

select is(pg_temp.fx(), (select v from fx_snap where k = 'before-b'),
  'refused suspended-Tenant submissions leave no submission, value, Ticket, notification, activity, completion, throttle, request or bot row');
select is((select status from public.form_assignments where id = (select v from ids where k = 'b-onboard-a')), 'assigned',
  'the onboarding assignment stays open while suspended');

-- A request id already accepted while active replays its own row; nothing new.
set local role anon;
set local "request.jwt.claim.role" = 'anon';
select pg_temp.act(null, null);
select is((public.app_submit_form('72000000-0000-4000-8000-000000002901', (select v from ids where k = 'b-contact-v'), '{}'::jsonb,
    '[{"field_key":"58000000-0000-4000-8000-000000002901","value":"anon-replay-seed"},{"field_key":"58000000-0000-4000-8000-000000002902","value":"anon-replay-seed message"}]'::jsonb)).id,
  (select v from ids where k = 'anon-replay-seed'),
  'replaying a request id accepted while active returns that same row, not a new one');
reset role;
select is(pg_temp.fx(), (select v from fx_snap where k = 'before-b'), 'the replay writes nothing');

-- Wolf Forge is unaffected by Tenant B's suspension.
set local role anon;
set local "request.jwt.claim.role" = 'anon';
select is(pg_temp.sub('wf-contact-v', 'anon-wf-during-b'), 'ok', 'Wolf Forge public Forms keep working while Tenant B is suspended');
reset role;

-- -----------------------------------------------------------------------------
-- Archived Tenant B, then resumed Tenant B
-- -----------------------------------------------------------------------------

select pg_temp.status('b', 'archived');
set local role anon;
set local "request.jwt.claim.role" = 'anon';
select is(pg_temp.sub('b-contact-v', 'arch-anon'), '55000', 'an archived Tenant B public Form is refused');
reset role;

select pg_temp.status('b', 'active');
set local role anon;
set local "request.jwt.claim.role" = 'anon';
select is(pg_temp.sub('b-contact-v', 'resumed-anon'), 'ok', 'anonymous submits again once Tenant B is resumed');
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2903', 'b');
select is(pg_temp.sub('b-onboard-v', 'resumed-onboard', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), 'ok',
  'the client completes its exact onboarding assignment once Tenant B is resumed (D-292)');
reset role;
select is((select latest_submission_id from public.form_assignments where id = (select v from ids where k = 'b-onboard-a')),
  (select v from ids where k = 'resumed-onboard'), 'the assignment points at its own onboarding submission');
select is((select count(*) from public.tickets where source_form_submission_id = (select v from ids where k = 'resumed-anon')
  and tenant_id = 'f0f0f0f0-0000-4000-8000-000000002901'), 1::bigint, 'the resumed Contact submission opens a Tenant B Ticket');

-- -----------------------------------------------------------------------------
-- Suspended Wolf Forge
-- -----------------------------------------------------------------------------

select pg_temp.status('wf', 'suspended');
insert into fx_snap values ('before-wf', pg_temp.fx());
set local role anon;
set local "request.jwt.claim.role" = 'anon';
select pg_temp.act(null, null);
select is(pg_temp.sub('wf-contact-v', 'susp-wf-anon'), '55000', 'anonymous cannot submit a suspended Wolf Forge public Form');
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2904', 'wf');
select is(pg_temp.sub('wf-contact-v', 'susp-wf-client'), '55000', 'a Wolf Forge client cannot submit a suspended Wolf Forge public Form');
select pg_temp.act('2903', 'b');
select is(pg_temp.sub('wf-contact-v', 'susp-wf-guest'), '55000', 'a Tenant B member cannot submit a suspended Wolf Forge public Form as a guest');
reset role;
select is(pg_temp.fx(), (select v from fx_snap where k = 'before-wf'), 'refused Wolf Forge submissions write nothing');

set local role anon;
set local "request.jwt.claim.role" = 'anon';
select is(pg_temp.sub('b-contact-v', 'anon-b-during-wf'), 'ok', 'Tenant B public Forms keep working while Wolf Forge is suspended');
reset role;

-- Direct RPC grants are unchanged: anon and authenticated may call it, the
-- function itself is the gate.
select ok(has_function_privilege('anon', 'public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb)', 'execute'),
  'anon still holds the direct EXECUTE grant (the check is inside the RPC)');

select * from finish();
rollback;
