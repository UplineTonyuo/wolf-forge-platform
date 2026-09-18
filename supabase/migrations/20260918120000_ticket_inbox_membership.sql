-- =============================================================================
-- Ticket -> Inbox conversation membership
--
-- A Ticket is the one canonical conversation record: one row in public.tickets,
-- one row per message in public.ticket_messages, one row per file in
-- public.ticket_attachments. Nothing here copies, forks, or duplicates any of
-- that. What this migration adds is the single durable fact the product did not
-- have: whether an existing Ticket's conversation is surfaced in the Inbox
-- Tickets pane.
--
-- Deliberately NOT used: no status value, no priority value, no assignment, no
-- archive flag, no second conversation table. "Not in Inbox" is not closed, not
-- resolved, and not deleted -- those are independent axes with their own
-- columns, and overloading one of them would make "hide from Inbox" silently
-- mean something else. A nullable timestamp is the whole model.
--
-- Set once, never cleared. There is no product requirement to remove a Ticket
-- from Inbox, so there is no column state and no RPC for it; adding one later is
-- a strictly additive change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The durable membership fact
-- -----------------------------------------------------------------------------

alter table public.tickets
  add column if not exists inbox_added_at timestamptz;

comment on column public.tickets.inbox_added_at is
  'When this Ticket''s conversation was made available in the Inbox Tickets pane. Null means it is managed from /tickets only and is not an Inbox conversation candidate. Set once by app_add_ticket_to_inbox; never cleared. Independent of status, priority, assignment and archived_at.';

-- -----------------------------------------------------------------------------
-- 2. Backfill
--
-- The Inbox Tickets pane listed every accessible Ticket before this migration,
-- so every Ticket that already exists is already an Inbox conversation. Filling
-- the column now keeps that true and confines the behaviour change to Tickets
-- created from here on, which start with a null value and require an explicit
-- "Add to Ticket conversation".
-- -----------------------------------------------------------------------------

update public.tickets set inbox_added_at = now() where inbox_added_at is null;

-- -----------------------------------------------------------------------------
-- 3. The one mutation
--
-- Same shape as app_archive_ticket: require the permission, require an internal
-- actor, lock the row, and write the activity record only on an actual
-- transition. A second call is therefore a no-op that returns the existing row
-- rather than a duplicate event -- idempotent without a request id, because the
-- column itself is the idempotency key.
-- -----------------------------------------------------------------------------

create function public.app_add_ticket_to_inbox(p_ticket_id uuid)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); ticket_row public.tickets;
begin
  perform private.require_permission('tickets.edit');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  select * into ticket_row from public.tickets where id = p_ticket_id for update;
  if ticket_row.id is null then raise no_data_found; end if;
  if ticket_row.inbox_added_at is null then
    update public.tickets set inbox_added_at = now() where id = p_ticket_id returning * into ticket_row;
    perform private.record_ticket_activity(
      p_ticket_id, 'ticket.inbox_added',
      'Added this Ticket to the Inbox Ticket conversation list.',
      '{}'::jsonb, actor_id
    );
  end if;
  return ticket_row;
end;
$$;

comment on function public.app_add_ticket_to_inbox(uuid) is
  'Makes an existing Ticket''s canonical conversation available in the Inbox Tickets pane. Idempotent: a Ticket already in the Inbox is returned unchanged with no second activity record. Copies no messages.';

-- -----------------------------------------------------------------------------
-- 4. The list read model
--
-- Two changes, both narrow:
--   * inbox_added_at joins the returned row, so a reader can tell at a glance.
--   * p_inbox_only filters the list to Inbox conversations, for the Inbox pane.
--     Defaulted false, so the /tickets management list is unchanged.
--
-- A returned-column change alters the function's row type, which CREATE OR
-- REPLACE cannot do, so this drops and recreates rather than replacing. The
-- drop takes the old grants with it; they are re-issued below.
-- -----------------------------------------------------------------------------

drop function if exists public.app_list_ticket_summaries(boolean);

create function public.app_list_ticket_summaries(
  p_include_archived boolean default false,
  p_inbox_only boolean default false
)
returns table (
  ticket_id uuid,
  public_ref text,
  company_id uuid,
  company_name text,
  client_profile_id uuid,
  client_name text,
  subject text,
  status text,
  priority text,
  assigned_to_profile_id uuid,
  assigned_to_name text,
  message_count bigint,
  last_message_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  inbox_added_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select ticket_row.id, ticket_row.public_ref, ticket_row.company_id,
    company_row.name, ticket_row.client_profile_id, client_profile.display_name,
    ticket_row.subject, ticket_row.status, ticket_row.priority,
    ticket_row.assigned_to_profile_id, assignee.display_name,
    (select count(*) from public.ticket_messages as message
      where message.ticket_id = ticket_row.id
        and (actor.role_name <> 'client' or message.visibility = 'client')),
    (select max(message.created_at) from public.ticket_messages as message
      where message.ticket_id = ticket_row.id
        and (actor.role_name <> 'client' or message.visibility = 'client')),
    ticket_row.created_at, ticket_row.updated_at, ticket_row.archived_at,
    ticket_row.inbox_added_at
  from public.tickets as ticket_row
  left join public.companies as company_row on company_row.id = ticket_row.company_id
  left join public.profiles as client_profile on client_profile.id = ticket_row.client_profile_id
  left join public.profiles as assignee on assignee.id = ticket_row.assigned_to_profile_id
  cross join private.current_ticket_actor() as actor
  where private.can_access_ticket(ticket_row.id)
    and (coalesce(p_include_archived, false) or ticket_row.archived_at is null)
    and (not coalesce(p_inbox_only, false) or ticket_row.inbox_added_at is not null)
  order by ticket_row.updated_at desc, ticket_row.id;
$$;

-- -----------------------------------------------------------------------------
-- 5. Keep the staff-only flag off the client-facing Ticket read
--
-- app_get_ticket_detail serializes the whole Ticket row with to_jsonb, so
-- inbox_added_at would ride along to a client account by default. It is a
-- staff workflow bookmark with no client meaning, so it is stripped for clients
-- exactly like company_id and the other internal identifiers. Staff reads are
-- untouched. Body is otherwise byte-for-byte the original.
-- -----------------------------------------------------------------------------

create or replace function public.app_get_ticket_detail(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare ticket_row public.tickets; actor record; result jsonb;
begin
  ticket_row := private.require_ticket_access(p_ticket_id);
  select * into actor from private.current_ticket_actor();
  select jsonb_build_object(
    'ticket', to_jsonb(ticket_row),
    'company_name', company_row.name,
    'client_name', client_profile.display_name,
    'assigned_to_name', assignee.display_name,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', message.id,
          'ticket_id', message.ticket_id,
          'author_profile_id', case when actor.role_name = 'client' then null else message.author_profile_id end,
          'author_name', author_profile.display_name,
          'author_type', message.author_type,
          'message_kind', message.message_kind,
          'visibility', message.visibility,
          'body', message.body,
          'created_at', message.created_at,
          'attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', attachment.id, 'original_name', attachment.original_name,
              'mime_type', attachment.mime_type, 'size_bytes', attachment.size_bytes,
              'scan_status', attachment.scan_status, 'created_at', attachment.created_at
            ) order by attachment.created_at)
            from public.ticket_attachments as attachment
            where attachment.ticket_message_id = message.id
          ), '[]'::jsonb)
        ) order by message.created_at, message.id
      )
      from public.ticket_messages as message
      left join public.profiles as author_profile on author_profile.id = message.author_profile_id
      where message.ticket_id = ticket_row.id
        and (actor.role_name <> 'client' or message.visibility = 'client')
    ), '[]'::jsonb)
  ) into result
  from public.tickets as ticket
  left join public.companies as company_row on company_row.id = ticket.company_id
  left join public.profiles as client_profile on client_profile.id = ticket.client_profile_id
  left join public.profiles as assignee on assignee.id = ticket.assigned_to_profile_id
  where ticket.id = ticket_row.id;
  if actor.role_name = 'client' then
    result := jsonb_set(result, '{ticket}', (result -> 'ticket')
      - array['company_id', 'client_profile_id', 'assigned_to_profile_id', 'created_by_profile_id',
              'source_form_submission_id', 'source_form_version_id', 'requester_email',
              'inbox_added_at']);
  end if;
  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Least privilege
--
-- Re-issued, not relaxed: the same "revoke from public/anon, grant to
-- authenticated" shape every other Ticket RPC uses. The row-level checks inside
-- each function are unchanged, so this feature grants no new access to any
-- Ticket -- it only lets a staff member who already has tickets.edit flip one
-- flag on a Ticket they already pass private.require_permission and
-- private.can_access_ticket for.
-- -----------------------------------------------------------------------------

revoke all on function public.app_add_ticket_to_inbox(uuid) from public, anon;
revoke all on function public.app_list_ticket_summaries(boolean, boolean) from public, anon;

grant execute on function public.app_add_ticket_to_inbox(uuid) to authenticated;
grant execute on function public.app_list_ticket_summaries(boolean, boolean) to authenticated;
