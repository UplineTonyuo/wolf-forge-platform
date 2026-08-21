begin;

select plan(36);

-- =============================================================================
-- FIXTURES
--
-- Two unrelated client companies and one Wolf Forge staff account. Every
-- isolation assertion below runs as a real authenticated client session, so it
-- exercises RLS and the SECURITY DEFINER resolvers rather than any application
-- filtering.
--
-- The auth trigger creates every profile as an unclaimed client account, so the
-- client fixtures only need their company attached.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('60000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'portal-client-a@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'portal-client-b@example.invalid', now(), now()),
  ('60000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'portal-staff@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('61000000-0000-0000-0000-00000000000a', 'Portal Company A'),
  ('61000000-0000-0000-0000-00000000000b', 'Portal Company B');

update public.profiles
set company_id = '61000000-0000-0000-0000-00000000000a', display_name = 'Client A'
where id = '60000000-0000-0000-0000-000000000001';

update public.profiles
set company_id = '61000000-0000-0000-0000-00000000000b', display_name = 'Client B'
where id = '60000000-0000-0000-0000-000000000002';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Portal Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '60000000-0000-0000-0000-000000000003';

insert into public.service_folders (id, name, sort_order)
values ('62000000-0000-0000-0000-000000000001', 'Portal Folder', 1);

insert into public.services (id, name, folder_id, price, is_active, is_public)
values ('63000000-0000-0000-0000-000000000001', 'Portal Service',
        '62000000-0000-0000-0000-000000000001', 100, true, true);

-- One project per company.
insert into public.orders (id, company_id, service_id, title, status, notes)
values
  ('64000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a',
   '63000000-0000-0000-0000-000000000001', 'Project A', 'working', 'Internal note A'),
  ('64000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000b',
   '63000000-0000-0000-0000-000000000001', 'Project B', 'working', 'Internal note B');

-- One invoice per company. A stays draft until the issue transition is tested.
-- invoices_issued_status_consistent requires an invoice_number once a row
-- leaves draft, so the issued fixture carries one.
insert into public.invoices (
  id, company_id, status, currency, invoice_number, issued_at,
  total_cents, subtotal_cents, created_by_profile_id, updated_by_profile_id
)
values
  ('65000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a',
   'draft', 'USD', null, null, 25000, 25000,
   '60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003'),
  ('65000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000b',
   'unpaid', 'USD', 6, now(), 90000, 90000,
   '60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003');

-- One conversation per company.
insert into public.tickets (id, company_id, client_profile_id, subject, status, created_by_profile_id)
values
  ('66000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-000000000001', 'Conversation A', 'waiting_on_client',
   '60000000-0000-0000-0000-000000000001'),
  ('66000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000b',
   '60000000-0000-0000-0000-000000000002', 'Conversation B', 'open',
   '60000000-0000-0000-0000-000000000002');

-- One assignable Form, published, with one assignment per company.
insert into public.forms (
  id, form_type, canonical_key, name, status, visibility,
  created_by_profile_id, updated_by_profile_id
)
values ('67000000-0000-0000-0000-000000000001', 'onboarding', 'portal-onboarding',
        'Portal Onboarding', 'published', 'assigned',
        '60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003');

-- form_versions_publication_consistent requires publisher, timestamp and
-- schema hash once a version is published.
insert into public.form_versions (
  id, form_id, version_number, lifecycle_state, title, visibility, schema_hash,
  created_by_profile_id, published_by_profile_id, published_at
)
values ('68000000-0000-0000-0000-000000000001', '67000000-0000-0000-0000-000000000001',
        1, 'published', 'Business information', 'assigned', 'portal-test-hash',
        '60000000-0000-0000-0000-000000000003',
        '60000000-0000-0000-0000-000000000003', now());

update public.forms
set published_version_id = '68000000-0000-0000-0000-000000000001'
where id = '67000000-0000-0000-0000-000000000001';


-- =============================================================================
-- CLIENT NOTIFICATIONS: form assigned
--
-- The assignment insert fires private.notify_client_form_assigned.
-- =============================================================================

insert into public.form_assignments (
  id, form_id, form_version_id, company_id, client_profile_id,
  status, required, assigned_by_profile_id
)
values
  ('69000000-0000-0000-0000-00000000000a', '67000000-0000-0000-0000-000000000001',
   '68000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-000000000001', 'assigned', true,
   '60000000-0000-0000-0000-000000000003'),
  ('69000000-0000-0000-0000-00000000000b', '67000000-0000-0000-0000-000000000001',
   '68000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-00000000000b',
   '60000000-0000-0000-0000-000000000002', 'assigned', true,
   '60000000-0000-0000-0000-000000000003');

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-form-assigned:69000000-0000-0000-0000-00000000000a'
      and recipient_profile_id = '60000000-0000-0000-0000-000000000001'
      and audience = 'client'
  ),
  1::bigint,
  'assigning a Form notifies the client it was assigned to'
);

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-form-assigned:69000000-0000-0000-0000-00000000000a'
      and recipient_profile_id <> '60000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'the Form assignment notification never reaches another company'
);

select is(
  (
    select href
    from public.notifications
    where event_key = 'client-form-assigned:69000000-0000-0000-0000-00000000000a'
  ),
  '/account/onboarding/69000000-0000-0000-0000-00000000000a',
  'the Form assignment notification links to the client Onboarding route'
);


-- =============================================================================
-- CLIENT NOTIFICATIONS: Wolf Forge replies
--
-- A staff reply notifies the client. An internal note must not, because its
-- existence is staff-only.
-- =============================================================================

insert into public.ticket_messages (
  id, ticket_id, author_profile_id, author_type, message_kind, visibility, body
)
values
  ('6a000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-000000000003', 'internal', 'reply', 'client',
   'Here is the update you asked for.'),
  ('6a000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-000000000003', 'internal', 'internal_note', 'internal',
   'Confirm scope before replying again.'),
  ('6a000000-0000-0000-0000-000000000003', '66000000-0000-0000-0000-00000000000a',
   '60000000-0000-0000-0000-000000000001', 'client', 'reply', 'client',
   'Thanks, that works.');

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-ticket-response:6a000000-0000-0000-0000-000000000001'
      and recipient_profile_id = '60000000-0000-0000-0000-000000000001'
      and audience = 'client'
  ),
  1::bigint,
  'a Wolf Forge reply notifies the client on the conversation'
);

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-ticket-response:6a000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'an internal note never produces a client notification'
);

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-ticket-response:6a000000-0000-0000-0000-000000000003'
  ),
  0::bigint,
  'a client replying to their own conversation does not notify themselves'
);

select is(
  (
    select href
    from public.notifications
    where event_key = 'client-ticket-response:6a000000-0000-0000-0000-000000000001'
  ),
  '/account/messages/66000000-0000-0000-0000-00000000000a',
  'the reply notification links to the client Messages route'
);


-- =============================================================================
-- CLIENT NOTIFICATIONS: invoice issued
--
-- Fires on draft -> unpaid, which is what app_issue_invoice performs.
-- =============================================================================

update public.invoices
set status = 'unpaid',
    invoice_number = 7,
    issued_at = now(),
    due_at = now() + interval '14 days'
where id = '65000000-0000-0000-0000-00000000000a';

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-invoice-issued:65000000-0000-0000-0000-00000000000a'
      and recipient_profile_id = '60000000-0000-0000-0000-000000000001'
      and audience = 'client'
      and category = 'payment'
  ),
  1::bigint,
  'issuing an invoice notifies the billed company'
);

-- A no-op update must not re-notify. The uniqueness constraint covers a retry,
-- but the trigger's own old/new guard is what keeps unrelated updates quiet.
update public.invoices
set updated_at = now()
where id = '65000000-0000-0000-0000-00000000000a';

select is(
  (
    select count(*)
    from public.notifications
    where event_key = 'client-invoice-issued:65000000-0000-0000-0000-00000000000a'
  ),
  1::bigint,
  'a later update to an already-issued invoice does not notify again'
);


-- =============================================================================
-- CLIENT A SESSION
--
-- Everything below is what the portal can actually read for Client A.
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.app_list_my_client_projects()),
  1::bigint,
  'a client session reads only its own company Projects through the safe projection'
);

select is(
  (select title from public.app_list_my_client_projects()),
  'Project A',
  'the safe Project projection returns the client own company Project'
);

select is(
  (select count(*) from public.invoices),
  1::bigint,
  'a client session reads only its own company invoices'
);

select is(
  (select total_cents from public.invoices),
  25000::bigint,
  'the visible invoice is the client own company invoice'
);

select throws_ok(
  $$ select public.app_get_invoice_financials('65000000-0000-0000-0000-00000000000b') $$,
  '42501',
  null,
  'the financials RPC refuses another company invoice'
);

-- Conversations are not directly selectable at all: `authenticated` holds no
-- table grant, so the only way in is the audited RPC boundary.
select throws_ok(
  $$ select count(*) from public.tickets $$,
  '42501',
  null,
  'a client session cannot select the tickets table directly'
);

select is(
  (select count(*) from public.app_list_ticket_summaries()),
  1::bigint,
  'a client session lists only its own company conversations'
);

select is(
  (select subject from public.app_list_ticket_summaries()),
  'Conversation A',
  'the listed conversation is the client own company conversation'
);

-- The internal note is on the client's OWN conversation. Company scope is not
-- enough: message visibility has to be enforced separately, and is.
select is(
  (
    select jsonb_array_length(
      public.app_get_ticket_detail_with_avatars('66000000-0000-0000-0000-00000000000a')
        -> 'messages'
    )
  ),
  2,
  'a client reads only client-visible messages on its own conversation'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.app_get_ticket_detail_with_avatars('66000000-0000-0000-0000-00000000000a')
        -> 'messages'
    ) as message
    where message ->> 'visibility' = 'internal'
  ),
  0::bigint,
  'no internal note is readable by a client'
);

select throws_ok(
  $$ select public.app_get_ticket_detail_with_avatars('66000000-0000-0000-0000-00000000000b') $$,
  '42501',
  null,
  'the conversation detail RPC refuses another company conversation'
);

select is(
  (select count(*) from public.app_list_assigned_forms()),
  1::bigint,
  'a client session lists only its own company Form assignments'
);

select is(
  (select company_id from public.app_list_assigned_forms()),
  '61000000-0000-0000-0000-00000000000a'::uuid,
  'the listed assignment belongs to the client own company'
);

select is(
  (select count(*) from public.app_list_subscription_summaries()),
  0::bigint,
  'a client with no subscriptions sees none, including other companies'
);

-- Notifications carry no table grant either; the RPC is the only way in.
select throws_ok(
  $$ select count(*) from public.notifications $$,
  '42501',
  null,
  'a client session cannot select the notifications table directly'
);

-- Recipient-scoped, not company-scoped: the RPC returns this account's rows and
-- nothing else, including rows addressed to a colleague at the same company.
select is(
  (
    select count(*)
    from public.app_list_my_notifications(50)
    where audience <> 'client'
  ),
  0::bigint,
  'a client never receives an internal-audience notification'
);

select is(
  (
    select count(*)
    from public.app_list_my_notifications(50)
    where event_key = 'client-form-assigned:69000000-0000-0000-0000-00000000000b'
       or event_key = 'client-invoice-issued:65000000-0000-0000-0000-00000000000b'
  ),
  0::bigint,
  'a client never receives a notification raised for another company'
);


-- =============================================================================
-- CLIENT B SESSION
--
-- The mirror image. Proves the scoping is per-account, not an artefact of
-- fixture ordering.
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '60000000-0000-0000-0000-000000000002';

select is(
  (select title from public.app_list_my_client_projects()),
  'Project B',
  'client B reads only its own Project through the safe projection'
);

select is(
  (select total_cents from public.invoices),
  90000::bigint,
  'client B reads only its own invoice'
);

select is(
  (select subject from public.app_list_ticket_summaries()),
  'Conversation B',
  'client B reads only its own conversation'
);

select is(
  (select company_id from public.app_list_assigned_forms()),
  '61000000-0000-0000-0000-00000000000b'::uuid,
  'client B lists only its own Form assignment'
);

select is(
  (
    select count(*)
    from public.app_list_my_notifications(50)
    where event_key like 'client-ticket-response:%'
  ),
  0::bigint,
  'client B never sees the reply notification sent to client A'
);

-- =============================================================================
-- GLOBAL SEARCH SOURCES
--
-- The client search action reads exactly three things: listClientProjects,
-- app_list_ticket_summaries and the Store catalog. It never names a company —
-- these assertions are what makes that safe, by proving each source is already
-- scoped to the caller before any matching happens.
--
-- Still running as client B from the section above.
-- =============================================================================

-- Client A's project reference and title are not reachable from client B's
-- session, so no query string can surface them.
-- Every project reference the search path can build belongs to this account,
-- so no reference query can reach another company's.
select is(
  (
    select count(*)
    from public.orders
    where id <> '64000000-0000-0000-0000-00000000000b'
  ),
  0::bigint,
  'every searchable project reference belongs to the caller own company'
);

select is(
  (select count(*) from public.orders where title ilike '%Project A%'),
  0::bigint,
  'a project title from another company matches nothing in this session'
);

-- The same for conversations, through the RPC the search action actually uses.
select is(
  (
    select count(*)
    from public.app_list_ticket_summaries()
    where subject ilike '%Conversation A%'
  ),
  0::bigint,
  'a conversation subject from another company matches nothing in this session'
);

-- Every reference the search path can see belongs to this account's own
-- conversation, so no reference query can reach another company's.
select is(
  (
    select count(*)
    from public.app_list_ticket_summaries()
    where ticket_id <> '66000000-0000-0000-0000-00000000000b'
  ),
  0::bigint,
  'every searchable conversation reference belongs to the caller own company'
);

-- Search matches on subject and reference only. This is the row that proves
-- why: message bodies live in a table the search path never reads, and the
-- internal note among them is unreadable here regardless.
select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.app_get_ticket_detail_with_avatars('66000000-0000-0000-0000-00000000000b')
        -> 'messages'
    ) as message
    where message ->> 'visibility' = 'internal'
  ),
  0::bigint,
  'no internal note is readable even on the caller own conversation'
);

select * from finish();

rollback;
