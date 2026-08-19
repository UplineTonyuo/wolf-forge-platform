-- Client-audience notifications.
--
-- The unified notification centre already supports client recipients:
-- private.emit_company_client_notification fans a row out to every active
-- client profile at a company, and notifications_select_own restricts reads to
-- the recipient. Until now only one event actually used it (wallet credit), so
-- a client's bell was effectively empty.
--
-- This migration adds client notifications for three things that already
-- happen. Nothing here invents an event, backfills history, or writes a row for
-- something the platform does not do:
--
--   1. An onboarding or intake Form is assigned to the company.
--   2. Wolf Forge replies to one of the company's conversations.
--   3. An invoice is issued to the company.
--
-- Every href points at the client portal's own routes. All three are
-- idempotent through the existing (recipient_profile_id, event_key) unique
-- constraint plus `on conflict do nothing` inside the emitter, so a retried
-- mutation cannot produce a duplicate.

-- ------------------------------------------------------------
-- 1. Form assigned to the company
-- ------------------------------------------------------------

create or replace function private.notify_client_form_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_title text;
  form_kind text;
begin
  -- Only assignments a client is expected to act on.
  if new.status is distinct from 'assigned' then
    return new;
  end if;

  select version.title, form.form_type
  into form_title, form_kind
  from public.form_versions as version
  join public.forms as form on form.id = version.form_id
  where version.id = new.form_version_id;

  -- Internal-only Form types are never surfaced to a client, even if one is
  -- somehow assigned: the portal only renders intake and onboarding.
  if form_kind is null or form_kind not in ('intake', 'onboarding') then
    return new;
  end if;

  perform private.emit_company_client_notification(
    new.company_id,
    'client-form-assigned:' || new.id::text,
    'form',
    'info',
    'New onboarding item',
    coalesce(nullif(form_title, ''), 'Wolf Forge needs some information')
      || case
           when new.due_at is null then ' is ready for you to complete.'
           else ' is due ' || to_char(new.due_at, 'FMMon FMDD') || '.'
         end,
    '/account/onboarding/' || new.id::text,
    'form_assignment',
    new.id,
    (select auth.uid()),
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_client_form_assigned
  on public.form_assignments;

create trigger notifications_client_form_assigned
after insert on public.form_assignments
for each row
execute function private.notify_client_form_assigned();


-- ------------------------------------------------------------
-- 2. Wolf Forge replied to the client
--
-- The mirror of private.notify_client_ticket_reply, which notifies staff when
-- a *client* replies. This one fires for an internal author, and only for a
-- client-visible message: an internal note must never produce a client-facing
-- notification, since its body and even its existence are staff-only.
-- ------------------------------------------------------------

create or replace function private.notify_client_ticket_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_role text;
  author_name text;
  ticket_ref text;
  ticket_subject text;
  ticket_company_id uuid;
begin
  if new.message_kind is distinct from 'reply'
     or new.visibility is distinct from 'client'
     or new.author_profile_id is null then
    return new;
  end if;

  select role.name, profile.display_name
  into author_role, author_name
  from public.profiles as profile
  join public.roles as role on role.id = profile.role_id
  where profile.id = new.author_profile_id;

  -- Only a Wolf Forge author. A client replying to their own conversation
  -- should not notify themselves.
  if author_role is null or author_role not in ('owner', 'admin', 'manager', 'staff') then
    return new;
  end if;

  select ticket.public_ref, ticket.subject, ticket.company_id
  into ticket_ref, ticket_subject, ticket_company_id
  from public.tickets as ticket
  where ticket.id = new.ticket_id;

  if ticket_company_id is null then
    return new;
  end if;

  perform private.emit_company_client_notification(
    ticket_company_id,
    'client-ticket-response:' || new.id::text,
    'ticket',
    'info',
    'New message from Wolf Forge',
    coalesce(nullif(author_name, ''), 'Wolf Forge')
      || case
           when ticket_subject is null then ' replied to your conversation.'
           else ' replied to "' || ticket_subject || '".'
         end,
    '/account/messages/' || new.ticket_id::text,
    'ticket',
    new.ticket_id,
    new.author_profile_id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_client_ticket_response
  on public.ticket_messages;

create trigger notifications_client_ticket_response
after insert on public.ticket_messages
for each row
execute function private.notify_client_ticket_response();


-- ------------------------------------------------------------
-- 3. Invoice issued
--
-- Fires on the draft -> unpaid transition, which is what app_issue_invoice
-- performs. A draft invoice is not visible to a client (see
-- invoices_client_select_own_company combined with the portal's own filtering),
-- so notifying before issue would point at something they cannot open.
-- ------------------------------------------------------------

create or replace function private.notify_client_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  amount_label text;
begin
  if new.status is distinct from 'unpaid' or old.status is not distinct from 'unpaid' then
    return new;
  end if;

  amount_label := new.currency || ' ' || to_char(new.total_cents / 100.0, 'FM999999990.00');

  perform private.emit_company_client_notification(
    new.company_id,
    'client-invoice-issued:' || new.id::text,
    'payment',
    'debit',
    case
      when new.invoice_number is null then 'New invoice'
      else 'Invoice #WF-' || lpad(new.invoice_number::text, 4, '0')
    end,
    amount_label
      || case
           when new.due_at is null then ' is ready to view.'
           else ' is due ' || to_char(new.due_at, 'FMMon FMDD') || '.'
         end,
    '/account/invoices/' || new.id::text,
    'invoice',
    new.id,
    (select auth.uid()),
    now()
  );

  return new;
end;
$$;

drop trigger if exists notifications_client_invoice_issued
  on public.invoices;

create trigger notifications_client_invoice_issued
after update of status on public.invoices
for each row
execute function private.notify_client_invoice_issued();


-- ------------------------------------------------------------
-- Existing client-facing hrefs, repointed.
--
-- The portal's Forms and Tickets routes were renamed to Onboarding and
-- Messages. Rows already written keep working because their href column is
-- rewritten here rather than being left pointing at a route that no longer
-- exists. Only client-audience rows are touched; internal hrefs are untouched.
-- ------------------------------------------------------------

update public.notifications
set href = '/account/onboarding' || substr(href, length('/account/forms') + 1)
where audience = 'client'
  and (href = '/account/forms' or href like '/account/forms/%');

update public.notifications
set href = '/account/messages' || substr(href, length('/account/tickets') + 1)
where audience = 'client'
  and (href = '/account/tickets' or href like '/account/tickets/%');


comment on function private.notify_client_form_assigned() is
  'Client notification when an intake or onboarding Form is assigned to their company.';
comment on function private.notify_client_ticket_response() is
  'Client notification when Wolf Forge posts a client-visible reply. Internal notes never notify a client.';
comment on function private.notify_client_invoice_issued() is
  'Client notification on the draft -> unpaid transition, i.e. when an invoice is actually issued.';
