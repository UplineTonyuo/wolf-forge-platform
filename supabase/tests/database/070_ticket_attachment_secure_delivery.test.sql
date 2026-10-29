begin;
select plan(10);

-- -----------------------------------------------------------------------------
-- Secure image/file delivery: app_get_ticket_attachment_download is the sole
-- authorization boundary the browser-facing /api/ticket-attachments/{id}
-- route relies on before it proxies bytes (it no longer redirects to a raw
-- Supabase Storage signed URL — see route.ts and
-- ticket-attachment-secure-route.test.ts for the HTTP-layer contract). This
-- file proves the authorization matrix the route depends on: who resolves an
-- attachment, who is refused, and exactly how internal-note/cross-company
-- refusals are disguised as "not found" (intentional anti-enumeration,
-- already established elsewhere in this codebase — see
-- app_get_ticket_attachment_download and require_order_conversation_access).
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('fd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'secdl-owner@example.invalid', now(), now()),
  ('fd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'secdl-client-a@example.invalid', now(), now()),
  ('fd000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'secdl-client-b@example.invalid', now(), now()),
  ('fd000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'secdl-unassigned-staff@example.invalid', now(), now());

insert into public.companies (id, name, status) values
  ('fd100000-0000-4000-8000-000000000001', 'Secure Delivery Co A', 'client'),
  ('fd100000-0000-4000-8000-000000000002', 'Secure Delivery Co B', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'SecDL Owner'
where id = 'fd000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'fd100000-0000-4000-8000-000000000001', display_name = 'SecDL Client A'
where id = 'fd000000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'fd100000-0000-4000-8000-000000000002', display_name = 'SecDL Client B'
where id = 'fd000000-0000-4000-8000-000000000003';
-- 'staff' has tickets.view (broad Ticket read) but not client_private.read and
-- is not assigned to the Order below — the exact shape of an internal user
-- who is not "related" to this one Order/Ticket.
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'SecDL Unassigned Staff'
where id = 'fd000000-0000-4000-8000-000000000004';

insert into public.orders (id, company_id, service_id, title, assigned_to_profile_id) values
  ('fd200000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', (select id from public.services where archived_at is null and tenant_id = private.wolf_forge_tenant_id() order by id limit 1), 'Secure delivery order', 'fd000000-0000-4000-8000-000000000001');
insert into public.tickets (id, company_id, client_profile_id, order_id, subject, created_by_profile_id) values
  ('fd300000-0000-4000-8000-000000000001', 'fd100000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', 'fd200000-0000-4000-8000-000000000001', 'Secure delivery ticket', 'fd000000-0000-4000-8000-000000000001');
insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body) values
  ('fd400000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000002', 'client', 'reply', 'client', 'Here is the screenshot.'),
  ('fd400000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'internal', 'internal_note', 'internal', 'Internal-only attachment');
insert into public.ticket_attachments (id, ticket_id, ticket_message_id, storage_object_key, original_name, mime_type, size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id) values
  ('fd450000-0000-4000-8000-000000000001', 'fd300000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000001', 'ticket-attachments/secdl-client.png', 'client-visible.png', 'image/png', 1000, repeat('e', 64), 'clean', 'fd000000-0000-4000-8000-000000000002'),
  ('fd450000-0000-4000-8000-000000000002', 'fd300000-0000-4000-8000-000000000001', 'fd400000-0000-4000-8000-000000000002', 'ticket-attachments/secdl-note.png', 'internal-only.png', 'image/png', 1000, repeat('f', 64), 'clean', 'fd000000-0000-4000-8000-000000000001');

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- -----------------------------------------------------------------------------
-- authorized owner -> resolves the client-visible attachment
-- -----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.become('fd000000-0000-4000-8000-000000000001');
select is(
  public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'storage_object_key', 'ticket-attachments/secdl-client.png',
    'mime_type', 'image/png',
    'original_name', 'client-visible.png',
    'size_bytes', 1000,
    'tenant_id', (select tenant_id from public.app_current_tenant_membership())
  ),
  'authorized owner resolves the attachment with the fields the route needs (key, mime, filename)'
);

-- -----------------------------------------------------------------------------
-- authorized participant/client -> 200 only when visibility permits
-- -----------------------------------------------------------------------------
select pg_temp.become('fd000000-0000-4000-8000-000000000002');
select is(
  (public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000001') ->> 'storage_object_key'),
  'ticket-attachments/secdl-client.png',
  'the owning-company client resolves the same attachment on a client-visible message'
);

-- -----------------------------------------------------------------------------
-- unrelated client (different company) -> 403 (permission denied at the
-- Ticket/company boundary, before any Order-level check runs)
-- -----------------------------------------------------------------------------
select pg_temp.become('fd000000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'an unrelated client (different company) is refused with a real permission-denied code'
);

-- -----------------------------------------------------------------------------
-- unrelated employee (internal, tickets.view, not assigned to this Order, no
-- client_private.read) -> refused as "not found" (P0002), not 403. This is
-- the existing require_order_conversation_access anti-enumeration boundary,
-- unchanged by this work — it deliberately never confirms an Order/Ticket's
-- existence to an internal caller who has no relationship to it.
-- -----------------------------------------------------------------------------
select pg_temp.become('fd000000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000001')$$,
  'P0002', null,
  'an unrelated internal employee (not assigned, no broad Order permission) is refused as not-found, the existing Order-boundary anti-enumeration behavior'
);

-- -----------------------------------------------------------------------------
-- internal-note attachment never leaks to a client, even from the owning
-- company, even though the Ticket itself is otherwise accessible to them.
-- -----------------------------------------------------------------------------
select pg_temp.become('fd000000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000002')$$,
  'P0002', null,
  'a same-company client cannot resolve an attachment on an internal note; disguised as not-found, never confirms the note exists'
);

-- -----------------------------------------------------------------------------
-- internal-note attachment resolves fine for internal staff who ARE
-- authorized (the owner here), proving the boundary is the note's
-- visibility, not attachment access in general.
-- -----------------------------------------------------------------------------
select pg_temp.become('fd000000-0000-4000-8000-000000000001');
select is(
  (public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000002') ->> 'original_name'),
  'internal-only.png',
  'authorized internal staff can still resolve the internal-note attachment'
);

-- -----------------------------------------------------------------------------
-- Scan status gate: a pending/rejected attachment is refused exactly like a
-- nonexistent one, regardless of who asks — QA-DIAG/malware-scan boundary
-- unchanged by this work.
-- -----------------------------------------------------------------------------
reset role;
update public.ticket_attachments set scan_status = 'pending' where id = 'fd450000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.become('fd000000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.app_get_ticket_attachment_download('fd450000-0000-4000-8000-000000000001')$$,
  'P0002', null,
  'a not-yet-clean attachment is refused as not-found, even to its owning-company client'
);
reset role;
update public.ticket_attachments set scan_status = 'clean' where id = 'fd450000-0000-4000-8000-000000000001';

-- -----------------------------------------------------------------------------
-- Nonexistent attachment id -> not-found, same shape as every other refusal.
-- -----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.become('fd000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.app_get_ticket_attachment_download(gen_random_uuid())$$,
  'P0002', null,
  'a nonexistent attachment id is refused as not-found'
);
reset role;

-- -----------------------------------------------------------------------------
-- Attachment-level reply targeting is enforced by a real foreign key, not
-- just RPC-layer validation — a raw insert that bypasses the RPC entirely
-- (direct DB write, as would only ever happen from trusted server code) must
-- still be rejected if the attachment does not belong to the referenced
-- parent message.
-- -----------------------------------------------------------------------------
select throws_ok(
  $$insert into public.ticket_messages (
      ticket_id, author_profile_id, author_type, message_kind, visibility, body,
      reply_to_message_id, reply_quote_text, reply_to_attachment_id
    ) values (
      'fd300000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'internal', 'reply', 'client', 'mismatched target',
      'fd400000-0000-4000-8000-000000000001', 'Here is the screenshot.', 'fd450000-0000-4000-8000-000000000002'
    )$$,
  '23503', null,
  'the database itself rejects a reply attachment target that belongs to a different parent message, independent of the RPC'
);
select throws_ok(
  $$insert into public.ticket_messages (
      ticket_id, author_profile_id, author_type, message_kind, visibility, body,
      reply_to_message_id, reply_to_attachment_id
    ) values (
      'fd300000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', 'internal', 'reply', 'client', 'attachment without a parent',
      null, 'fd450000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  'an attachment target can never be set without a parent message target, enforced by a real CHECK constraint'
);

select * from finish();
rollback;
