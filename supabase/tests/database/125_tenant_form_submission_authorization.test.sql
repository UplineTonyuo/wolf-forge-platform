begin;

select plan(46);

-- WL-2.27 (KI-115 D6): app_submit_form classifies a signed-in submitter by its
-- active membership in the Form's Tenant, never the global role. Without one,
-- a public Form takes the caller as an anonymous guest. WF =
-- f0f0f0f0-0000-4000-8000-000000000001, Tenant B = f0f0f0f0-0000-4000-8000-000000002701.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 2701 WF admin. 2702 B admin only. 2703 WF client of the WF Client.
-- 2704 global client of the WF Client + B internal admin.
-- 2705 global WF admin + B client of the B Client.
-- 2706 WF client of the WF Client + B client of the B Client (dual).
-- 2707 archived B client.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'form-submit-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['2701', '2702', '2703', '2704', '2705', '2706', '2707']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002701', 'form-submit-tenant-b', 'Form Submit Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e7000000-0000-4000-8000-000000002701', private.wolf_forge_tenant_id(), 'FSUB WF Client', 'client'),
  ('e7000000-0000-4000-8000-000000002702', 'f0f0f0f0-0000-4000-8000-000000002701', 'FSUB B Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002701', 'admin', null),
  ('20000000-0000-4000-8000-000000002703', 'client', 'e7000000-0000-4000-8000-000000002701'),
  ('20000000-0000-4000-8000-000000002704', 'client', 'e7000000-0000-4000-8000-000000002701'),
  ('20000000-0000-4000-8000-000000002705', 'admin', null),
  ('20000000-0000-4000-8000-000000002706', 'client', 'e7000000-0000-4000-8000-000000002701')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000002701', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-4000-8000-000000002702', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-4000-8000-000000002704', 'admin', 'internal', null, null),
  ('20000000-0000-4000-8000-000000002705', 'client', 'client', 'e7000000-0000-4000-8000-000000002702', null),
  ('20000000-0000-4000-8000-000000002706', 'client', 'client', 'e7000000-0000-4000-8000-000000002702', null),
  ('20000000-0000-4000-8000-000000002707', 'client', 'client', 'e7000000-0000-4000-8000-000000002702', now())
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub',
    coalesce('20000000-0000-4000-8000-00000000' || p_actor, ''), true);
  select set_config('request.headers', case p_selector
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002701"}'
    else ''
    end, true);
$$;

create function pg_temp.def(p_type text, p_visibility text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'FSUB ' || p_type, 'title', 'FSUB ' || p_type, 'visibility', p_visibility,
    'type_config', case p_type
      when 'contact' then jsonb_build_object(
        'subject_field_key', '58000000-0000-4000-8000-000000002701',
        'message_field_key', '58000000-0000-4000-8000-000000002702',
        'ticket_orchestration', 'deferred')
      when 'onboarding' then jsonb_build_object('reuse_policy', 'company_profile')
      else '{}'::jsonb end,
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000002701', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000002702', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb);
$$;

create temp table ids (k text primary key, v uuid);
grant all on ids to anon, authenticated;

-- Submit a Form version by key; returns the submission id or the SQLSTATE.
create function pg_temp.sub(p_version text, p_tag text, p_context jsonb default '{}'::jsonb)
returns text
language plpgsql
as $$
declare
  submission_id uuid;
begin
  submission_id := (public.app_submit_form(gen_random_uuid(), (select v from ids where k = p_version), p_context,
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000002701', 'value', p_tag),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000002702', 'value', p_tag || ' message')),
    '[]'::jsonb)).id;
  insert into ids values (p_tag, submission_id);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- One submission's attribution: company / client / submitter as fixture suffixes.
create function pg_temp.who(p_tag text)
returns text
language sql
as $$
  select concat_ws(',', coalesce(right(submission.company_id::text, 4), '-'),
    coalesce(right(submission.client_profile_id::text, 4), '-'),
    coalesce(right(submission.submitted_by_profile_id::text, 4), '-'))
  from public.form_submissions as submission
  where submission.id = (select v from ids where k = p_tag);
$$;

-- The contact Ticket of one submission: Tenant suffix, Company, initial author type.
create function pg_temp.ticket(p_tag text)
returns text
language sql
as $$
  select concat_ws(',', right(ticket.tenant_id::text, 4), coalesce(right(ticket.company_id::text, 4), '-'),
    message.author_type)
  from public.tickets as ticket
  join public.ticket_messages as message
    on message.ticket_id = ticket.id and message.message_kind = 'initial_request'
  where ticket.source_form_submission_id = (select v from ids where k = p_tag);
$$;

grant execute on function pg_temp.act(text, text), pg_temp.sub(text, text, jsonb) to anon, authenticated;

-- Forms: Tenant B public contact / public order / authenticated order /
-- assigned onboarding, and a Wolf Forge public contact and public order.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2702', 'b');
insert into ids values ('b-contact', (public.app_create_form('71000000-0000-4000-8000-000000002701',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl227-b-contact', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('b-order', (public.app_create_form('71000000-0000-4000-8000-000000002702',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl227-b-order', 'definition', pg_temp.def('order', 'public')))).id);
insert into ids values ('b-auth', (public.app_create_form('71000000-0000-4000-8000-000000002703',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl227-b-auth', 'definition', pg_temp.def('order', 'authenticated')))).id);
insert into ids values ('b-onboard', (public.app_create_form('71000000-0000-4000-8000-000000002704',
  jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'wl227-b-onboard', 'definition', pg_temp.def('onboarding', 'assigned')))).id);
insert into ids values ('b-draft', (public.app_create_form('71000000-0000-4000-8000-000000002705',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl227-b-draft', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('b-contact-v', (public.app_publish_form('71000000-0000-4000-8000-000000002706', (select v from ids where k = 'b-contact'))).id);
insert into ids values ('b-order-v', (public.app_publish_form('71000000-0000-4000-8000-000000002707', (select v from ids where k = 'b-order'))).id);
insert into ids values ('b-auth-v', (public.app_publish_form('71000000-0000-4000-8000-000000002708', (select v from ids where k = 'b-auth'))).id);
insert into ids values ('b-onboard-v', (public.app_publish_form('71000000-0000-4000-8000-000000002709', (select v from ids where k = 'b-onboard'))).id);
insert into ids values ('b-onboard-a', (public.app_assign_form('71000000-0000-4000-8000-000000002710', (select v from ids where k = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002705'))).id);
insert into ids values ('b-onboard-a2', (public.app_assign_form('71000000-0000-4000-8000-000000002711', (select v from ids where k = 'b-onboard'),
  jsonb_build_object('client_profile_id', '20000000-0000-4000-8000-000000002706'))).id);

select pg_temp.act('2701', 'wf');
insert into ids values ('wf-contact', (public.app_create_form('71000000-0000-4000-8000-000000002712',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl227-wf-contact', 'definition', pg_temp.def('contact', 'public')))).id);
insert into ids values ('wf-order', (public.app_create_form('71000000-0000-4000-8000-000000002713',
  jsonb_build_object('form_type', 'order', 'canonical_key', 'wl227-wf-order', 'definition', pg_temp.def('order', 'public')))).id);
insert into ids values ('wf-contact-v', (public.app_publish_form('71000000-0000-4000-8000-000000002714', (select v from ids where k = 'wf-contact'))).id);
insert into ids values ('wf-order-v', (public.app_publish_form('71000000-0000-4000-8000-000000002715', (select v from ids where k = 'wf-order'))).id);
reset role;

insert into ids select 'b-draft-v', id from public.form_versions
where form_id = (select v from ids where k = 'b-draft');
insert into ids values ('missing-v', '7f000000-0000-4000-8000-0000000027ff');

-- -----------------------------------------------------------------------------
-- Anonymous public submissions: the Form decides the Tenant
-- -----------------------------------------------------------------------------

set local role anon;
set local "request.jwt.claim.role" = 'anon';
select pg_temp.act(null, null);
select is(pg_temp.sub('b-contact-v', 'anon-b'), 'ok', 'anonymous submits the Tenant B public Contact Form');
select is(pg_temp.sub('wf-contact-v', 'anon-wf'), 'ok', 'anonymous submits the Wolf Forge public Contact Form');
select is(pg_temp.sub('b-auth-v', 'anon-auth'), '42501', 'anonymous cannot submit an authenticated Form');
select is(pg_temp.sub('b-draft-v', 'anon-draft'), 'P0002', 'an unpublished Form version is rejected');
select is(pg_temp.sub('missing-v', 'anon-missing'), 'P0002', 'a missing Form version is rejected safely');
reset role;

select is(pg_temp.ticket('anon-b'), '2701,-,guest', 'the anonymous Tenant B Contact Ticket is a Tenant B guest Ticket');
select is(pg_temp.ticket('anon-wf'), '0001,-,guest', 'the anonymous Wolf Forge Contact Ticket stays in Wolf Forge');
select is((select count(*) from public.notifications as notification
  join public.tickets as ticket on notification.event_key = 'ticket-created:' || ticket.id::text
  where ticket.source_form_submission_id = (select v from ids where k = 'anon-b')
    and (notification.tenant_id is distinct from 'f0f0f0f0-0000-4000-8000-000000002701'
      or notification.recipient_profile_id::text like '20000000-0000-4000-8000-00000000270_'
        and right(notification.recipient_profile_id::text, 4) not in ('2702', '2704'))), 0::bigint,
  'the anonymous Tenant B Contact Ticket notifies only Tenant B staff (WL-2.25)');
select ok(exists (select 1 from public.notifications as notification
  join public.tickets as ticket on notification.event_key = 'ticket-created:' || ticket.id::text
  where ticket.source_form_submission_id = (select v from ids where k = 'anon-b')
    and notification.recipient_profile_id = '20000000-0000-4000-8000-000000002704'),
  'Tenant B staff whose global role is client is notified of the Tenant B Contact Ticket');

-- -----------------------------------------------------------------------------
-- Members act through their membership in the Form's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('2704', 'b');
select is(pg_temp.sub('b-order-v', 'b-staff-order'), 'ok',
  'global client + Tenant B internal submits the Tenant B public Form as Tenant B staff');
select is(pg_temp.sub('b-contact-v', 'b-staff-contact'), 'ok', 'the same person submits the Tenant B Contact Form');
select is(pg_temp.sub('b-onboard-v', 'b-staff-onboard', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a2'))), 'ok',
  'Tenant B staff (global client) submits a Tenant B onboarding assignment on behalf of the client');

select pg_temp.act('2705', 'b');
select is(pg_temp.sub('b-order-v', 'b-client-order'), 'ok',
  'global internal + Tenant B client submits the Tenant B public Form as a Tenant B client');
select is(pg_temp.sub('b-contact-v', 'b-client-contact'), 'ok', 'the same person submits the Tenant B Contact Form');
select is(pg_temp.sub('b-auth-v', 'b-client-auth'), 'ok', 'the same person submits the Tenant B authenticated Form');
select is(pg_temp.sub('b-onboard-v', 'b-client-onboard', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), 'ok',
  'the same person submits its own Tenant B onboarding assignment');
select is(pg_temp.sub('b-order-v', 'b-client-spoof', jsonb_build_object('company_id', 'e7000000-0000-4000-8000-000000002701')), '42501',
  'a Tenant B client cannot attach the Wolf Forge Client through the context');

select pg_temp.act('2706', 'b');
select is(pg_temp.sub('b-order-v', 'dual-b'), 'ok', 'the dual client submits the Tenant B Form in Tenant B');
select is(pg_temp.sub('b-onboard-v', 'dual-foreign-assign', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'a Tenant B client cannot submit another client''s assignment');
select pg_temp.act('2706', 'wf');
select is(pg_temp.sub('wf-order-v', 'dual-wf'), 'ok', 'the dual client submits the Wolf Forge Form in Wolf Forge');

select pg_temp.act('2701', 'wf');
select is(pg_temp.sub('wf-order-v', 'wf-staff'), 'ok', 'Wolf Forge staff still submits the Wolf Forge public Form');
select pg_temp.act('2703', 'wf');
select is(pg_temp.sub('wf-order-v', 'wf-client'), 'ok', 'a Wolf Forge client still submits the Wolf Forge public Form');
reset role;

select is(pg_temp.who('b-staff-order'), '-,-,2704', 'a Tenant B staff submission attaches no Company (internal path)');
select is(pg_temp.ticket('b-staff-contact'), '2701,-,internal', 'the Tenant B staff Contact Ticket author is internal, not the global client role');
select is(pg_temp.who('b-staff-onboard'), '2702,2706,2704', 'the on-behalf onboarding submission belongs to the assigned Tenant B client');
select is(pg_temp.who('b-client-order'), '2702,2705,2705', 'the Tenant B client submission carries the Tenant B Client');
select is(pg_temp.ticket('b-client-contact'), '2701,2702,client', 'the Tenant B client Contact Ticket author is client, not the global admin role');
select is(pg_temp.who('dual-b'), '2702,2706,2706', 'the dual client carries the Tenant B Client in Tenant B');
select is(pg_temp.who('dual-wf'), '2701,2706,2706', 'the dual client carries the Wolf Forge Client in Wolf Forge');
select is(pg_temp.who('wf-client'), '2701,2703,2703', 'a Wolf Forge client still carries the Wolf Forge Client');
select is(pg_temp.who('wf-staff'), '-,-,2701', 'Wolf Forge staff still submits without a Company');

-- -----------------------------------------------------------------------------
-- No membership in the Form's Tenant: public = guest, otherwise refused
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('2703', 'wf');
select is(pg_temp.sub('b-order-v', 'wf-client-on-b'), 'ok',
  'a Wolf Forge client may submit the Tenant B public Form by id under the Wolf Forge selector');
select pg_temp.act('2703', 'b');
select is(pg_temp.sub('b-contact-v', 'wf-client-forged'), 'ok',
  'a forged Tenant B selector without membership still submits the public Form');
select is(pg_temp.sub('b-auth-v', 'wf-client-forged-auth'), '42501',
  'a forged Tenant B selector cannot submit the Tenant B authenticated Form');
select is(pg_temp.sub('b-order-v', 'wf-client-forged-spoof', jsonb_build_object('company_id', 'e7000000-0000-4000-8000-000000002701')), '42501',
  'a guest cannot attach any Company through the context');
select pg_temp.act('2701', 'b');
select is(pg_temp.sub('b-contact-v', 'wf-staff-on-b'), 'ok',
  'Wolf Forge staff on the Tenant B host submits the Tenant B public Form as a guest');
select is(pg_temp.sub('b-onboard-v', 'wf-staff-on-b-assign', jsonb_build_object('assignment_id', (select v from ids where k = 'b-onboard-a'))), '42501',
  'Wolf Forge staff cannot submit a Tenant B assignment');
select pg_temp.act('2707', 'b');
select is(pg_temp.sub('b-auth-v', 'archived-auth'), '42501', 'an archived Tenant B client cannot submit the authenticated Form');
select pg_temp.act('2705', 'wf');
select is(pg_temp.sub('b-auth-v', 'b-client-wf-selector'), '42501',
  'a Tenant B client under the Wolf Forge selector gets no Tenant B member rights');
reset role;
update public.profiles set archived_at = now() where id = '20000000-0000-4000-8000-000000002703';
set local role authenticated;
select pg_temp.act('2703', 'b');
select is(pg_temp.sub('b-contact-v', 'archived-profile'), '42501', 'an archived profile is refused, never turned into a guest');
reset role;
update public.profiles set archived_at = null where id = '20000000-0000-4000-8000-000000002703';

select is(pg_temp.who('wf-client-on-b') || ' ' || pg_temp.who('wf-client-forged') || ' ' || pg_temp.who('wf-staff-on-b'),
  '-,-,- -,-,- -,-,-', 'a guest submission carries no foreign Company, client or submitter');
select is((select count(*) from public.activity_events
  where entity_type = 'form_submission' and action = 'form.submitted'
    and entity_id in (select v from ids where k in ('wf-client-on-b', 'wf-client-forged', 'wf-staff-on-b'))
    and actor_profile_id is null), 3::bigint,
  'a guest submission records its activity with no actor');
select is(pg_temp.ticket('wf-staff-on-b'), '2701,-,guest', 'a guest Contact Ticket belongs to the Form''s Tenant with a guest author');

update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000002701';
set local role authenticated;
select pg_temp.act('2705', 'b');
select is(pg_temp.sub('b-auth-v', 'suspended-auth'), '42501', 'a suspended Tenant grants its members nothing');
select is(pg_temp.sub('b-order-v', 'suspended-public'), '55000', 'a suspended Tenant''s public Form refuses its members too (WL-2.29, KI-138)');
reset role;
select is((select count(*) from ids where k = 'suspended-public'), 0::bigint, 'the refused suspended-Tenant submission stores nothing');
update public.tenants set status = 'active' where id = 'f0f0f0f0-0000-4000-8000-000000002701';

select * from finish();

rollback;
