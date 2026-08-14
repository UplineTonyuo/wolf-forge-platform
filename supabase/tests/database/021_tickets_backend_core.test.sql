begin;

select plan(67);

-- -----------------------------------------------------------------------------
-- Structure and security surface
-- -----------------------------------------------------------------------------

select is(
  (select count(*) from information_schema.tables
   where table_schema = 'public' and table_name in ('tickets', 'ticket_messages', 'ticket_attachments')),
  3::bigint,
  'Tickets core uses three coherent tables'
);
select ok(
  to_regprocedure('public.app_create_ticket(uuid,jsonb)') is not null
  and to_regprocedure('public.app_reply_to_ticket(uuid,uuid,text)') is not null
  and to_regprocedure('public.app_add_ticket_internal_note(uuid,uuid,text)') is not null
  and to_regprocedure('public.app_update_ticket_status(uuid,text)') is not null
  and to_regprocedure('public.app_assign_ticket(uuid,uuid)') is not null
  and to_regprocedure('public.app_update_ticket_priority(uuid,text)') is not null
  and to_regprocedure('public.app_archive_ticket(uuid)') is not null,
  'transactional Ticket mutation boundaries exist'
);
select is(
  (select count(*) from public.permissions where permission_key in (
    'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.assign',
    'tickets.archive', 'tickets.reply', 'tickets.internal_notes'
  )),
  7::bigint,
  'Ticket capabilities are registered'
);
select ok(
  not has_table_privilege('authenticated', 'public.tickets', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tickets', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ticket_messages', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ticket_attachments', 'INSERT'),
  'authenticated callers cannot directly mutate protected Ticket tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.tickets', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ticket_messages', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ticket_attachments', 'SELECT'),
  'raw Ticket tables are hidden behind safe read models'
);
select ok(
  not has_function_privilege('anon', 'public.app_create_ticket(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_get_ticket_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_reply_to_ticket(uuid,uuid,text)', 'EXECUTE'),
  'anonymous callers cannot reach Ticket RPCs'
);
select ok(
  (select bool_and(procedure.prosecdef and procedure.proconfig @> array['search_path=""']::text[])
   from pg_proc as procedure where procedure.oid in (
     'public.app_create_ticket(uuid,jsonb)'::regprocedure,
     'public.app_reply_to_ticket(uuid,uuid,text)'::regprocedure,
     'public.app_get_ticket_detail(uuid)'::regprocedure,
     'private.can_access_ticket(uuid)'::regprocedure
   )),
  'Ticket authorization functions are SECURITY DEFINER with an empty search_path'
);

-- -----------------------------------------------------------------------------
-- Actors and tenant fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('2c000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tickets-owner@example.invalid', now(), now()),
  ('2c000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tickets-manager@example.invalid', now(), now()),
  ('2c000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'tickets-staff@example.invalid', now(), now()),
  ('1c000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tickets-client-a@example.invalid', now(), now()),
  ('1c000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tickets-client-a-two@example.invalid', now(), now()),
  ('1c000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'tickets-client-b@example.invalid', now(), now());

update public.profiles as profile_row set
  role_id = (select role_row.id from public.roles as role_row where role_row.name = case profile_row.id
    when '2c000000-0000-0000-0000-000000000001'::uuid then 'owner'
    when '2c000000-0000-0000-0000-000000000002'::uuid then 'manager'
    when '2c000000-0000-0000-0000-000000000003'::uuid then 'staff'
    else 'client' end),
  display_name = case profile_row.id
    when '2c000000-0000-0000-0000-000000000001'::uuid then 'Tickets Owner'
    when '2c000000-0000-0000-0000-000000000002'::uuid then 'Tickets Manager'
    when '2c000000-0000-0000-0000-000000000003'::uuid then 'Restricted Tickets Staff'
    when '1c000000-0000-0000-0000-000000000001'::uuid then 'Client Alpha'
    when '1c000000-0000-0000-0000-000000000002'::uuid then 'Client Alpha Two'
    else 'Client Beta' end
where profile_row.id in (
  '2c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000002',
  '2c000000-0000-0000-0000-000000000003', '1c000000-0000-0000-0000-000000000001',
  '1c000000-0000-0000-0000-000000000002', '1c000000-0000-0000-0000-000000000003'
);

insert into public.companies (id, name, status)
values
  ('3c000000-0000-0000-0000-000000000001', 'Ticket Company Alpha', 'client'),
  ('3c000000-0000-0000-0000-000000000002', 'Ticket Company Beta', 'client');

update public.profiles set company_id = '3c000000-0000-0000-0000-000000000001'
where id in ('1c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000002');
update public.profiles set company_id = '3c000000-0000-0000-0000-000000000002'
where id = '1c000000-0000-0000-0000-000000000003';

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('2c000000-0000-0000-0000-000000000003', 'tickets.edit', false);

create temporary table ticket_test_ids (label text primary key, id uuid not null);
grant select, insert, update on ticket_test_ids to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Internal and client creation, authoritative ownership, idempotency
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into ticket_test_ids values ('internal-a', (public.app_create_ticket(
    '60000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '3c000000-0000-0000-0000-000000000001',
      'client_profile_id', '1c000000-0000-0000-0000-000000000001',
      'subject', 'Internal support request', 'message', 'Initial internal-created request.'
    )
  )).id)$$,
  'authorized internal user creates a Ticket'
);
reset role;
select is((select status from public.tickets where id = (select id from ticket_test_ids where label = 'internal-a')), 'open', 'new Ticket starts open');
select is((select priority from public.tickets where id = (select id from ticket_test_ids where label = 'internal-a')), 'normal', 'new Ticket priority defaults to normal');
select is((select company_id from public.tickets where id = (select id from ticket_test_ids where label = 'internal-a')), '3c000000-0000-0000-0000-000000000001'::uuid, 'internal Ticket belongs to the selected real company');
select is((select client_profile_id from public.tickets where id = (select id from ticket_test_ids where label = 'internal-a')), '1c000000-0000-0000-0000-000000000001'::uuid, 'internal Ticket can reference a real company client');
select is((select count(*) from public.ticket_messages where ticket_id = (select id from ticket_test_ids where label = 'internal-a')), 1::bigint, 'Ticket creation stores one immutable initial message');
select is((select created_by_profile_id from public.tickets where id = (select id from ticket_test_ids where label = 'internal-a')), '2c000000-0000-0000-0000-000000000001'::uuid, 'Ticket actor is derived from auth.uid()');

set local role authenticated;
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';
select is(
  (public.app_create_ticket(
    '60000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'company_id', '3c000000-0000-0000-0000-000000000001',
      'client_profile_id', '1c000000-0000-0000-0000-000000000001',
      'subject', 'Internal support request', 'message', 'Initial internal-created request.'
    )
  )).id,
  (select id from ticket_test_ids where label = 'internal-a'),
  'Ticket creation retry returns the original Ticket'
);
select throws_ok(
  $$select public.app_create_ticket(
    '60000000-0000-0000-0000-000000000001',
    jsonb_build_object('company_id', '3c000000-0000-0000-0000-000000000001', 'subject', 'Different', 'message', 'Different')
  )$$,
  '23505', 'idempotency key was already used with different input',
  'Ticket request ID cannot be reused with different input'
);
select throws_ok(
  $$select public.app_create_ticket(
    '60000000-0000-0000-0000-000000000002',
    jsonb_build_object('company_id', '3c000000-0000-0000-0000-000000000001', 'subject', 'Spoof', 'message', 'Spoof', 'created_by_profile_id', '2c000000-0000-0000-0000-000000000002')
  )$$,
  '22023', 'invalid Ticket creation input',
  'caller-supplied actor identity is rejected'
);
reset role;
select is((select count(*) from public.tickets where subject = 'Internal support request'), 1::bigint, 'retry cannot duplicate a Ticket');

set local role authenticated;
set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into ticket_test_ids values ('client-a', (public.app_create_ticket(
    '60000000-0000-0000-0000-000000000003',
    jsonb_build_object('subject', 'Client-created request', 'message', 'Please help with my account.')
  )).id)$$,
  'client creates a Ticket for its own company'
);
select throws_ok(
  $$select public.app_create_ticket(
    '60000000-0000-0000-0000-000000000004',
    jsonb_build_object('company_id', '3c000000-0000-0000-0000-000000000002', 'subject', 'Spoofed company', 'message', 'No.', 'priority', 'normal')
  )$$,
  '42501', 'Ticket company context cannot be spoofed',
  'client cannot create a Ticket for another company'
);
select throws_ok(
  $$select public.app_create_ticket(
    '60000000-0000-0000-0000-000000000005',
    jsonb_build_object('subject', 'Urgent spoof', 'message', 'No.', 'priority', 'urgent')
  )$$,
  '42501', 'client cannot set Ticket priority',
  'client cannot set internal priority'
);
reset role;
select is((select company_id from public.tickets where id = (select id from ticket_test_ids where label = 'client-a')), '3c000000-0000-0000-0000-000000000001'::uuid, 'client Ticket company is derived from the profile');
select is((select client_profile_id from public.tickets where id = (select id from ticket_test_ids where label = 'client-a')), '1c000000-0000-0000-0000-000000000001'::uuid, 'client Ticket profile is derived from auth.uid()');

-- -----------------------------------------------------------------------------
-- Company isolation, replies, and private notes
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000003';
select is((select count(*) from public.app_list_ticket_summaries(false) where ticket_id = (select id from ticket_test_ids where label = 'internal-a')), 0::bigint, 'Client B cannot list Client A Ticket');
select throws_ok(
  $$select public.app_get_ticket_detail((select id from ticket_test_ids where label = 'internal-a'))$$,
  '42501', 'Ticket access is denied',
  'Client B cannot read Client A Ticket or messages'
);
select throws_ok(
  $$select public.app_reply_to_ticket('61000000-0000-0000-0000-000000000001', (select id from ticket_test_ids where label = 'internal-a'), 'Cross-company reply')$$,
  '42501', 'Ticket access is denied',
  'client cannot reply to an inaccessible Ticket'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into ticket_test_ids values ('staff-reply', (public.app_reply_to_ticket(
    '61000000-0000-0000-0000-000000000002', (select id from ticket_test_ids where label = 'internal-a'), 'Wolf Forge reply.'
  )).id)$$,
  'authorized staff reply works'
);
select lives_ok(
  $$insert into ticket_test_ids values ('internal-note', (public.app_add_ticket_internal_note(
    '61000000-0000-0000-0000-000000000003', (select id from ticket_test_ids where label = 'internal-a'), 'Private operational note.'
  )).id)$$,
  'authorized internal note works'
);
select is(
  jsonb_array_length(public.app_get_ticket_detail((select id from ticket_test_ids where label = 'internal-a')) -> 'messages'),
  3,
  'authorized staff detail includes the internal note'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into ticket_test_ids values ('client-reply', (public.app_reply_to_ticket(
    '61000000-0000-0000-0000-000000000004', (select id from ticket_test_ids where label = 'internal-a'), 'Client response.'
  )).id)$$,
  'client replies to its own accessible Ticket'
);
select is(
  jsonb_array_length(public.app_get_ticket_detail((select id from ticket_test_ids where label = 'internal-a')) -> 'messages'),
  3,
  'client-safe detail excludes the internal note'
);
select ok(
  not (public.app_get_ticket_detail((select id from ticket_test_ids where label = 'internal-a'))::text like '%Private operational note%'),
  'internal note body is never exposed to the client'
);
select throws_ok(
  $$select public.app_add_ticket_internal_note('61000000-0000-0000-0000-000000000005', (select id from ticket_test_ids where label = 'internal-a'), 'Client note')$$,
  '42501', 'internal Ticket access is required',
  'client cannot add an internal note'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000001';
select is(
  (public.app_reply_to_ticket('61000000-0000-0000-0000-000000000004', (select id from ticket_test_ids where label = 'internal-a'), 'Client response.')).id,
  (select id from ticket_test_ids where label = 'client-reply'),
  'reply retry returns the original immutable message'
);
select throws_ok(
  $$select public.app_reply_to_ticket('61000000-0000-0000-0000-000000000004', (select id from ticket_test_ids where label = 'internal-a'), 'Changed retry')$$,
  '23505', 'idempotency key was already used with different input',
  'reply request ID cannot be reused with different content'
);
reset role;
select is((select count(*) from public.ticket_messages where id = (select id from ticket_test_ids where label = 'client-reply')), 1::bigint, 'reply retry cannot duplicate a message');

-- -----------------------------------------------------------------------------
-- Assignment, priority, lifecycle, archive, and audit history
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';
select is(
  (public.app_assign_ticket((select id from ticket_test_ids where label = 'internal-a'), '2c000000-0000-0000-0000-000000000002')).assigned_to_profile_id,
  '2c000000-0000-0000-0000-000000000002'::uuid,
  'Ticket assigns to a real internal profile'
);
select throws_ok(
  $$select public.app_assign_ticket((select id from ticket_test_ids where label = 'internal-a'), '1c000000-0000-0000-0000-000000000001')$$,
  '23514', 'assignee must be an active internal profile',
  'Ticket cannot be assigned to a Client'
);
select is(
  (public.app_update_ticket_priority((select id from ticket_test_ids where label = 'internal-a'), 'high')).priority,
  'high',
  'authorized priority change succeeds'
);
select is((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'in_progress')).status, 'in_progress', 'open transitions to in progress');
select is((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'resolved')).status, 'resolved', 'in progress transitions to resolved');
select ok((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'resolved')).resolved_at is not null, 'resolved timestamp is server-authored');
select is((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'closed')).status, 'closed', 'resolved transitions to closed');
select ok((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'closed')).closed_at is not null, 'closed timestamp is server-authored');
select throws_ok(
  $$select public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'waiting_on_team')$$,
  '55000', 'invalid Ticket status transition',
  'invalid closed transition is rejected'
);
select is((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'open')).status, 'open', 'closed Ticket can be intentionally reopened');
select ok((public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'open')).resolved_at is null
  and (public.app_update_ticket_status((select id from ticket_test_ids where label = 'internal-a'), 'open')).closed_at is null,
  'reopen clears current terminal timestamps without erasing activity history');
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.app_update_ticket_priority((select id from ticket_test_ids where label = 'internal-a'), 'urgent')$$,
  '42501', 'permission denied: tickets.edit',
  'unauthorized staff mutation is denied by capability resolution'
);
reset role;

select ok(
  (select count(*) >= 4 from public.activity_events where entity_type = 'ticket'
    and entity_id = (select id from ticket_test_ids where label = 'internal-a')
    and action = 'ticket.status_changed'),
  'resolved, closed, and reopened lifecycle history remains in append-only activity'
);
select ok(
  (select count(*) >= 1 from public.activity_events where entity_type = 'ticket' and action = 'ticket.created')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'ticket' and action = 'ticket.replied')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'ticket' and action = 'ticket.internal_note_added')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'ticket' and action = 'ticket.assigned')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'ticket' and action = 'ticket.priority_changed'),
  'meaningful Ticket operations are audited'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';
select ok((public.app_archive_ticket((select id from ticket_test_ids where label = 'internal-a'))).archived_at is not null, 'authorized Ticket archive succeeds');
reset role;
select is((select count(*) from public.tickets where id = (select id from ticket_test_ids where label = 'internal-a')), 1::bigint, 'archive preserves the Ticket');
select is((select count(*) from public.ticket_messages where ticket_id = (select id from ticket_test_ids where label = 'internal-a')), 4::bigint, 'archive preserves all messages and notes');
select ok((select count(*) >= 1 from public.activity_events where entity_id = (select id from ticket_test_ids where label = 'internal-a') and action = 'ticket.archived'), 'archive is audited');

-- -----------------------------------------------------------------------------
-- Attachment metadata isolation
-- -----------------------------------------------------------------------------

insert into public.ticket_attachments (
  ticket_id, ticket_message_id, storage_object_key, original_name, mime_type,
  size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id
) values
  ((select id from ticket_test_ids where label = 'internal-a'), (select id from ticket_test_ids where label = 'staff-reply'),
   'tickets/client-visible.txt', 'client-visible.txt', 'text/plain', 12, repeat('a', 64), 'clean', '2c000000-0000-0000-0000-000000000001'),
  ((select id from ticket_test_ids where label = 'internal-a'), (select id from ticket_test_ids where label = 'internal-note'),
   'tickets/internal-only.txt', 'internal-only.txt', 'text/plain', 12, repeat('b', 64), 'clean', '2c000000-0000-0000-0000-000000000001');
select is((select count(*) from public.ticket_attachments where ticket_id = (select id from ticket_test_ids where label = 'internal-a')), 2::bigint, 'attachment metadata stores references without blobs');

set local role authenticated;
set local "request.jwt.claim.sub" = '1c000000-0000-0000-0000-000000000001';
select ok(public.app_get_ticket_detail((select id from ticket_test_ids where label = 'internal-a'))::text like '%client-visible.txt%', 'client sees metadata for a client-visible attachment');
select ok(not (public.app_get_ticket_detail((select id from ticket_test_ids where label = 'internal-a'))::text like '%internal-only.txt%'), 'client cannot see attachment metadata from an internal note');
reset role;

-- -----------------------------------------------------------------------------
-- Contact Form -> Ticket orchestration
-- -----------------------------------------------------------------------------

create function pg_temp.ticket_contact_definition()
returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Ticket Contact', 'title', 'Contact Wolf Forge', 'visibility', 'public',
    'type_config', jsonb_build_object(
      'subject_field_key', '56000000-0000-0000-0000-000000000011',
      'message_field_key', '56000000-0000-0000-0000-000000000012',
      'ticket_orchestration', 'deferred'
    ),
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '56000000-0000-0000-0000-000000000010', 'sort_order', 0, 'field_type', 'email', 'label', 'Email', 'required', true),
      jsonb_build_object('stable_field_key', '56000000-0000-0000-0000-000000000011', 'sort_order', 1, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '56000000-0000-0000-0000-000000000012', 'sort_order', 2, 'field_type', 'textarea', 'label', 'Message', 'required', true)
    ),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
  );
$$;
grant execute on function pg_temp.ticket_contact_definition() to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '2c000000-0000-0000-0000-000000000001';
insert into ticket_test_ids values ('contact-form', (public.app_create_form(
  '62000000-0000-0000-0000-000000000001',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'ticket-contact', 'definition', pg_temp.ticket_contact_definition())
)).id);
insert into ticket_test_ids values ('contact-v1', (public.app_publish_form(
  '62000000-0000-0000-0000-000000000002', (select id from ticket_test_ids where label = 'contact-form')
)).id);
reset role;

set local role anon;
set local "request.jwt.claim.sub" = '';
select lives_ok(
  $$insert into ticket_test_ids values ('contact-submission', (public.app_submit_form(
    '62000000-0000-0000-0000-000000000003',
    (select id from ticket_test_ids where label = 'contact-v1'), '{}',
    jsonb_build_array(
      jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000010', 'value', 'guest@example.invalid'),
      jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000011', 'value', 'Guest Contact Ticket'),
      jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000012', 'value', 'A public guest needs help.')
    ), '[]'
  )).id)$$,
  'public Contact Form submission succeeds through the existing Form boundary'
);
reset role;

select is((select count(*) from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission')), 1::bigint, 'Contact submission creates exactly one Ticket');
select is((select subject from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission')), 'Guest Contact Ticket', 'Contact subject uses the configured exact field key');
select is((select requester_email from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission')), 'guest@example.invalid', 'Contact email uses the exact version email field semantics');
select is((select source_form_version_id from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission')), (select id from ticket_test_ids where label = 'contact-v1'), 'Contact Ticket links the exact immutable Form version');
select is((select body from public.ticket_messages where ticket_id = (select id from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission'))), 'A public guest needs help.', 'Contact message becomes the immutable initial Ticket message');
select is((select orchestration_status from public.form_submissions where id = (select id from ticket_test_ids where label = 'contact-submission')), 'completed', 'Contact Form orchestration records completion');
select ok((select company_id is null and created_by_profile_id is null from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission')), 'public guest creates no fake Client or company identity');

set local role anon;
set local "request.jwt.claim.sub" = '';
select lives_ok(
  $$select public.app_submit_form(
    '62000000-0000-0000-0000-000000000003',
    (select id from ticket_test_ids where label = 'contact-v1'), '{}',
    jsonb_build_array(
      jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000010', 'value', 'guest@example.invalid'),
      jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000011', 'value', 'Guest Contact Ticket'),
      jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000012', 'value', 'A public guest needs help.')
    ), '[]'
  )$$,
  'Contact submission retry returns safely'
);
reset role;
select is((select count(*) from public.tickets where source_form_submission_id = (select id from ticket_test_ids where label = 'contact-submission')), 1::bigint, 'Contact retry cannot duplicate the Ticket');

select * from finish();
rollback;
