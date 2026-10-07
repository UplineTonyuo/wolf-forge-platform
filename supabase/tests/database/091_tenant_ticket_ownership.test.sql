begin;

select plan(32);

-- WL-1C.2b: every Ticket is owned by exactly one Tenant, and its Client, client
-- person and assignee belong to that Tenant. A Contact Form Ticket takes the
-- Tenant of its Form. Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = ...09d1, Tenant C = ...09d2.
--
-- Every profile has a Wolf Forge membership (WL-1A mirror), so "a person outside
-- Tenant A" can only be built with A <> Wolf Forge; Tenant C plays that role.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select has_column('public', 'tickets', 'tenant_id', 'tickets.tenant_id exists');
select col_not_null('public', 'tickets', 'tenant_id', 'tickets.tenant_id is NOT NULL');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.tickets'::regclass and conname = 'tickets_tenant_id_fkey'),
  'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
  'tickets.tenant_id references tenants(id) ON DELETE RESTRICT'
);

select is(
  (select count(*) from public.tickets where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing Ticket was backfilled to the Wolf Forge Tenant'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 911 = owner U (internal in WF and B), 912 = owner V (internal in WF and C),
-- 913 = person P (client in WF and B), 914 = person R (client in WF only).
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000911', 'authenticated', 'authenticated', 'tkt-owner-b@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000912', 'authenticated', 'authenticated', 'tkt-owner-c@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000913', 'authenticated', 'authenticated', 'tkt-person@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000914', 'authenticated', 'authenticated', 'tkt-wf-only@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-0000000009d1', 'tkt-tenant-b', 'Ticket Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-0000000009d2', 'tkt-tenant-c', 'Ticket Tenant C', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000911', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Ticket Client', 'client'),
  ('30000000-0000-0000-0000-000000000912', 'f0f0f0f0-0000-4000-8000-0000000009d1', 'B Ticket Client', 'client'),
  ('30000000-0000-0000-0000-000000000913', 'f0f0f0f0-0000-4000-8000-0000000009d2', 'C Ticket Client', 'client');

update public.profiles as profile
set role_id = role.id,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000911', 'owner',  null),
  ('20000000-0000-0000-0000-000000000912', 'owner',  null),
  ('20000000-0000-0000-0000-000000000913', 'client', '30000000-0000-0000-0000-000000000911'),
  ('20000000-0000-0000-0000-000000000914', 'client', '30000000-0000-0000-0000-000000000911')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid
from (values
  ('f0f0f0f0-0000-4000-8000-0000000009d1', '20000000-0000-0000-0000-000000000911', 'internal', 'owner',  null),
  ('f0f0f0f0-0000-4000-8000-0000000009d2', '20000000-0000-0000-0000-000000000912', 'internal', 'owner',  null),
  ('f0f0f0f0-0000-4000-8000-0000000009d1', '20000000-0000-0000-0000-000000000913', 'client',   'client', '30000000-0000-0000-0000-000000000912')
) as fixture(tenant_id, profile_id, account_class, role_name, company_id)
join public.roles as role on role.name = fixture.role_name;

-- One published public Contact Form per Tenant, built the way 036 builds one.
insert into public.forms (id, tenant_id, form_type, canonical_key, name, status, visibility,
  created_by_profile_id, updated_by_profile_id)
values
  ('59100000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'contact', 'tkt-wf-contact',
   'WF Contact', 'published', 'public', '20000000-0000-0000-0000-000000000911', '20000000-0000-0000-0000-000000000911'),
  ('59100000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009d1', 'contact', 'tkt-b-contact',
   'B Contact', 'published', 'public', '20000000-0000-0000-0000-000000000911', '20000000-0000-0000-0000-000000000911');

insert into public.form_versions (id, form_id, version_number, lifecycle_state, title, visibility,
  type_config, created_by_profile_id)
select ('59200000-0000-0000-0000-00000000000' || n)::uuid, ('59100000-0000-0000-0000-00000000000' || n)::uuid,
  1, 'draft', 'Contact', 'public',
  jsonb_build_object(
    'subject_field_key', '59300000-0000-0000-0000-0000000000' || n || '1',
    'message_field_key', '59300000-0000-0000-0000-0000000000' || n || '2'
  ),
  '20000000-0000-0000-0000-000000000911'
from (values (1), (2)) as version(n);

insert into public.form_version_fields (form_version_id, stable_field_key, sort_order, field_type, label, required)
select ('59200000-0000-0000-0000-00000000000' || n)::uuid,
  ('59300000-0000-0000-0000-0000000000' || n || field.k)::uuid, field.k, field.t, field.l, true
from (values (1), (2)) as version(n)
cross join (values (1, 'text', 'Subject'), (2, 'textarea', 'Message'), (3, 'email', 'Email')) as field(k, t, l);

update public.form_versions
set lifecycle_state = 'published', schema_hash = 'tkt-hash-' || left(id::text, 8),
    published_by_profile_id = '20000000-0000-0000-0000-000000000911', published_at = now()
where id in ('59200000-0000-0000-0000-000000000001', '59200000-0000-0000-0000-000000000002');

update public.forms set published_version_id = '59200000-0000-0000-0000-000000000001'
where id = '59100000-0000-0000-0000-000000000001';
update public.forms set published_version_id = '59200000-0000-0000-0000-000000000002'
where id = '59100000-0000-0000-0000-000000000002';

create function pg_temp.contact_values(p_form int, p_subject text)
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('field_key', '59300000-0000-0000-0000-0000000000' || p_form || '1', 'value', p_subject),
    jsonb_build_object('field_key', '59300000-0000-0000-0000-0000000000' || p_form || '2', 'value', 'Please help.'),
    jsonb_build_object('field_key', '59300000-0000-0000-0000-0000000000' || p_form || '3', 'value', p_subject || '@example.invalid')
  );
$$;
grant execute on function pg_temp.contact_values(int, text) to anon, authenticated;

-- A trusted Contact submission written straight to the tables, bypassing
-- app_submit_form, with whatever business context the caller chose. The
-- values insert fires the Ticket orchestration.
create function pg_temp.trusted_contact_submission(p_form int, p_company uuid, p_client uuid)
returns void
language plpgsql
as $$
declare
  submission_id uuid := gen_random_uuid();
begin
  insert into public.form_submissions (id, form_id, form_version_id, company_id, client_profile_id,
    root_submission_id, orchestration_type, orchestration_status)
  values (submission_id, ('59100000-0000-0000-0000-00000000000' || p_form)::uuid,
    ('59200000-0000-0000-0000-00000000000' || p_form)::uuid, p_company, p_client,
    submission_id, 'contact_ticket', 'deferred');

  insert into public.form_submission_values (submission_id, form_version_field_id, stable_field_key,
    field_label_snapshot, field_type_snapshot, sort_order_snapshot, value)
  select submission_id, field.id, field.stable_field_key, field.label, field.field_type, field.sort_order,
    to_jsonb(case field.field_type when 'text' then 'Trusted' else 'Trusted message' end)
  from public.form_version_fields as field
  where field.form_version_id = ('59200000-0000-0000-0000-00000000000' || p_form)::uuid
    and field.field_type <> 'email'
  order by field.sort_order;
end;
$$;

create temporary table tkt_ids (label text primary key, id uuid not null) on commit drop;
grant select, insert on tkt_ids to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Normal Ticket creation takes the caller's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000911';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000911', 'subject', 'WF ticket', 'message', 'Hello'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in Ticket creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009d1"}', true);
select is(
  (select tenant_id from public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000912', 'subject', 'B ticket', 'message', 'Hello'))),
  'f0f0f0f0-0000-4000-8000-0000000009d1'::uuid,
  'a signed-in Ticket creation with the Tenant B selector lands in Tenant B'
);

select throws_ok(
  $$select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000911', 'subject', 'B ticket for WF Client', 'message', 'Hello'))$$,
  '23503',
  'active Ticket company is required',
  'a Tenant B Ticket created through app_create_ticket cannot name a Wolf Forge Client'
);

select throws_ok(
  $$select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'tenant_id', 'f0f0f0f0-0000-4000-8000-000000000001',
    'company_id', '30000000-0000-0000-0000-000000000912', 'subject', 'Caller tenant', 'message', 'Hello'))$$,
  '22023',
  'invalid Ticket creation input',
  'a caller-supplied tenant_id is rejected as Ticket input'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000911', 'subject', 'Garbage selector', 'message', 'Hello'))$$,
  '42501',
  null,
  'app_create_ticket with an invalid selector creates nothing'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009d2"}', true);
select throws_ok(
  $$select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000913', 'subject', 'Foreign selector', 'message', 'Hello'))$$,
  '42501',
  null,
  'app_create_ticket with a Tenant the caller does not belong to creates nothing'
);

-- A client of Tenant B gets the Tenant B Client from its Tenant B membership.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000913';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009d1"}', true);
select ok(
  (select tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009d1' and company_id = '30000000-0000-0000-0000-000000000912'
     and client_profile_id = '20000000-0000-0000-0000-000000000913'
   from public.app_create_ticket(gen_random_uuid(), jsonb_build_object('subject', 'B client ticket', 'message', 'Hello'))),
  'a Tenant B client opens a Tenant B Ticket for its Tenant B Client'
);

select set_config('request.headers', '', true);
reset role;

-- The column default itself fails closed for a signed-in caller whose selector
-- resolves to no Tenant: it yields NULL, never Wolf Forge.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000911';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009d2"}', true);
select throws_ok(
  $$insert into public.tickets (company_id, subject) values ('30000000-0000-0000-0000-000000000911', 'Default')$$,
  '23502',
  'null value in column "tenant_id" of relation "tickets" violates not-null constraint',
  'the tenant_id default yields NULL for an unresolvable selector instead of Wolf Forge'
);
select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.tickets where subject in ('B ticket for WF Client', 'Caller tenant', 'Garbage selector', 'Foreign selector', 'Default')),
  0::bigint,
  'no Ticket was created by a failed selector or a cross-Tenant Client'
);

-- -----------------------------------------------------------------------------
-- Cross-Tenant references are rejected even for trusted writes
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, subject)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000912', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_company_id_fkey"',
  'a Wolf Forge Ticket cannot belong to a Tenant B Client'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009d1', '30000000-0000-0000-0000-000000000911', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_company_id_fkey"',
  'a Tenant B Ticket cannot belong to a Wolf Forge Client'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, client_profile_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009d2', '30000000-0000-0000-0000-000000000913',
      '20000000-0000-0000-0000-000000000913', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_client_profile_id_fkey"',
  'a Tenant C Ticket cannot name a client person without a Tenant C membership'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, client_profile_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009d1', '30000000-0000-0000-0000-000000000912',
      '20000000-0000-0000-0000-000000000914', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_client_profile_id_fkey"',
  'a Tenant B Ticket cannot name a client person without a Tenant B membership'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, assigned_to_profile_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009d2', '30000000-0000-0000-0000-000000000913',
      '20000000-0000-0000-0000-000000000911', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant C Ticket cannot be assigned to a Tenant B-only staff member'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, assigned_to_profile_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009d1', '30000000-0000-0000-0000-000000000912',
      '20000000-0000-0000-0000-000000000912', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B Ticket cannot be assigned to a Tenant C-only staff member'
);

-- One global profile takes part independently in each Tenant it belongs to.
select lives_ok(
  $$insert into public.tickets (tenant_id, company_id, client_profile_id, assigned_to_profile_id, subject)
    values
      ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000911',
       '20000000-0000-0000-0000-000000000913', '20000000-0000-0000-0000-000000000911', 'WF shared people'),
      ('f0f0f0f0-0000-4000-8000-0000000009d1', '30000000-0000-0000-0000-000000000912',
       '20000000-0000-0000-0000-000000000913', '20000000-0000-0000-0000-000000000911', 'B shared people')$$,
  'the same client person and assignee take part in Wolf Forge and Tenant B Tickets'
);

select throws_ok(
  $$update public.tickets set tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009d1' where subject = 'WF shared people'$$,
  '23503',
  null,
  'a Ticket cannot be moved to another Tenant while it references Wolf Forge rows'
);

-- -----------------------------------------------------------------------------
-- Contact Form Tickets take the Tenant of the Form
-- -----------------------------------------------------------------------------

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select lives_ok(
  $$insert into tkt_ids select 'anon-wf', (public.app_submit_form(gen_random_uuid(),
    '59200000-0000-0000-0000-000000000001', '{}'::jsonb, pg_temp.contact_values(1, 'anon-wf'))).id$$,
  'an anonymous visitor submits the Wolf Forge public Contact Form'
);

select lives_ok(
  $$insert into tkt_ids select 'anon-b', (public.app_submit_form(gen_random_uuid(),
    '59200000-0000-0000-0000-000000000002', '{}'::jsonb, pg_temp.contact_values(2, 'anon-b'))).id$$,
  'an anonymous visitor submits the Tenant B public Contact Form without any membership'
);

-- A selector sent by an anonymous caller is not Tenant context.
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}', true);
select lives_ok(
  $$insert into tkt_ids select 'anon-b-wf-selector', (public.app_submit_form(gen_random_uuid(),
    '59200000-0000-0000-0000-000000000002', '{}'::jsonb, pg_temp.contact_values(2, 'anon-b-sel'))).id$$,
  'an anonymous Tenant B submission with a Wolf Forge selector header is accepted'
);
select set_config('request.headers', '', true);

select throws_ok(
  $$select public.app_submit_form(gen_random_uuid(), '59200000-0000-0000-0000-000000000002',
    jsonb_build_object('tenant_id', 'f0f0f0f0-0000-4000-8000-000000000001'), pg_temp.contact_values(2, 'anon-b-tenant'))$$,
  '22023',
  'invalid Form submission context',
  'a caller-supplied tenant_id is rejected as Form context'
);
reset role;

select is(
  (select array_agg(ticket.tenant_id order by ids.label)
   from tkt_ids as ids join public.tickets as ticket on ticket.source_form_submission_id = ids.id
   where ids.label like 'anon-%'),
  array[
    'f0f0f0f0-0000-4000-8000-0000000009d1',
    'f0f0f0f0-0000-4000-8000-0000000009d1',
    'f0f0f0f0-0000-4000-8000-000000000001'
  ]::uuid[],
  'each anonymous Contact Ticket is owned by its Form''s Tenant, regardless of the selector header'
);

select ok(
  (select bool_and(submission.orchestration_status = 'completed' and message.author_type = 'guest'
     and message.message_kind = 'initial_request' and message.body = 'Please help.')
     and count(*) = 3
   from tkt_ids as ids
   join public.form_submissions as submission on submission.id = ids.id
   join public.tickets as ticket on ticket.source_form_submission_id = submission.id
   join public.ticket_messages as message on message.ticket_id = ticket.id
   where ids.label like 'anon-%'),
  'the anonymous flow still completes the submission and writes the guest initial message'
);

-- A signed-in Wolf Forge member's selector does not move a Tenant B Form Ticket.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000911';
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}', true);
insert into tkt_ids select 'staff-b', (public.app_submit_form(gen_random_uuid(),
  '59200000-0000-0000-0000-000000000002', '{}'::jsonb, pg_temp.contact_values(2, 'staff-b'))).id;
select set_config('request.headers', '', true);
reset role;
select is(
  (select ticket.tenant_id from public.tickets as ticket
   where ticket.source_form_submission_id = (select id from tkt_ids where label = 'staff-b')),
  'f0f0f0f0-0000-4000-8000-0000000009d1'::uuid,
  'a signed-in submission of the Tenant B Form under a Wolf Forge selector still lands in Tenant B'
);
set local role authenticated;

-- A Wolf Forge client brings its Wolf Forge Client and person to the Tenant B
-- Form: the Ticket would cross Tenants, so the whole submission rolls back.
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000914';
select throws_ok(
  $$select public.app_submit_form(gen_random_uuid(), '59200000-0000-0000-0000-000000000002',
    '{}'::jsonb, pg_temp.contact_values(2, 'wf-client-b'))$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_company_id_fkey"',
  'a Tenant B Form submission carrying Wolf Forge client context is rejected'
);
reset role;
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = '';

select is(
  (select count(*) from public.form_submissions
    where form_id = '59100000-0000-0000-0000-000000000002'
      and submitted_by_profile_id = '20000000-0000-0000-0000-000000000914'),
  0::bigint,
  'the rejected cross-Tenant submission persisted nothing'
);

-- The same holds for trusted writes that skip app_submit_form.
select throws_ok(
  $$select pg_temp.trusted_contact_submission(2, '30000000-0000-0000-0000-000000000911', null)$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_company_id_fkey"',
  'a trusted Tenant B Form submission with a Wolf Forge Client cannot create a Ticket'
);

select throws_ok(
  $$select pg_temp.trusted_contact_submission(2, '30000000-0000-0000-0000-000000000912',
    '20000000-0000-0000-0000-000000000914')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_client_profile_id_fkey"',
  'a trusted Tenant B Form submission naming a person without a Tenant B membership cannot create a Ticket'
);

select * from finish();
rollback;
