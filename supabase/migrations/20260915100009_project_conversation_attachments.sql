-- Project conversation files stay on the canonical Ticket message model.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  5242880,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.ticket_messages
  drop constraint ticket_messages_body_not_blank,
  add constraint ticket_messages_body_length_valid check (char_length(body) <= 50000);

-- The established reply RPCs own authorization, rate limits, audit and
-- idempotency. For attachment-only sends, this insert trigger converts the
-- private wrapper's object marker into the canonical empty body before checks.
create function private.normalize_ticket_attachment_message_body()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body = U&'\FFFC'
     and coalesce(current_setting('app.ticket_attachment_message', true), '') = 'on' then
    new.body := '';
  end if;
  return new;
end;
$$;

create trigger ticket_messages_normalize_attachment_body
before insert on public.ticket_messages
for each row execute function private.normalize_ticket_attachment_message_body();

revoke all on function private.normalize_ticket_attachment_message_body()
  from public, anon, authenticated, service_role;

create function private.prepare_ticket_attachment(
  p_request_id uuid,
  p_ticket_id uuid default null,
  p_order_id uuid default null,
  p_reply_to_message_id uuid default null,
  p_consume_rate_limit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor record; ticket_row public.tickets; project public.orders;
begin
  if p_request_id is null or (p_ticket_id is null) = (p_order_id is null) then
    raise exception 'invalid Ticket attachment target' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.reply');

  if p_order_id is not null then
    project := private.require_order_conversation_access(p_order_id);
    select * into ticket_row from public.tickets where order_id = project.id;
    if ticket_row.id is null then
      perform private.require_permission('tickets.create');
    end if;
  else
    ticket_row := private.require_ticket_access(p_ticket_id);
    if ticket_row.order_id is not null then
      perform private.require_order_conversation_access(ticket_row.order_id);
    end if;
  end if;

  if ticket_row.id is not null
     and (ticket_row.archived_at is not null or ticket_row.status = 'closed') then
    raise exception 'Ticket is not open for replies' using errcode = '55000';
  end if;

  if p_reply_to_message_id is not null and not exists (
    select 1 from public.ticket_messages as message
    where message.id = p_reply_to_message_id
      and message.ticket_id = ticket_row.id
      and message.visibility = 'client'
      and message.message_kind <> 'internal_note'
  ) then
    raise exception 'reply source is unavailable' using errcode = '42501';
  end if;

  if p_consume_rate_limit then
    perform private.consume_rate_limit(
      'ticket.attachment.actor.hour', actor.profile_id::text, interval '1 hour', 30
    );
  end if;

  return jsonb_build_object(
    'storage_key', actor.profile_id::text || '/' || p_request_id::text
  );
end;
$$;

create function public.app_prepare_ticket_attachment(
  p_request_id uuid,
  p_ticket_id uuid default null,
  p_order_id uuid default null,
  p_reply_to_message_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.prepare_ticket_attachment(
    p_request_id, p_ticket_id, p_order_id, p_reply_to_message_id, true
  );
$$;

create function public.app_send_ticket_message_with_attachment(
  p_request_id uuid,
  p_ticket_id uuid default null,
  p_order_id uuid default null,
  p_body text default '',
  p_reply_to_message_id uuid default null,
  p_original_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_checksum_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor record;
  prepared jsonb;
  expected_key text;
  message_row public.ticket_messages;
  linked_ticket_id uuid;
  attachment_row public.ticket_attachments;
  send_body text := coalesce(p_body, '');
begin
  if char_length(send_body) > 50000 or octet_length(send_body) > 200000
     or p_original_name is null or btrim(p_original_name) = ''
     or char_length(p_original_name) > 255
     or p_original_name ~ '[\\/]' or p_original_name ~ '[[:cntrl:]]'
     or p_mime_type not in (
       'image/jpeg', 'image/png', 'image/webp', 'image/gif',
       'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'
     )
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid Ticket attachment' using errcode = '22023';
  end if;

  prepared := private.prepare_ticket_attachment(
    p_request_id, p_ticket_id, p_order_id, p_reply_to_message_id, false
  );
  expected_key := prepared ->> 'storage_key';
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'ticket-attachments' and name = expected_key
  ) then
    raise exception 'Ticket attachment upload is missing' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  perform set_config('app.ticket_attachment_message', 'on', true);
  if nullif(btrim(send_body), '') is null then send_body := U&'\FFFC'; end if;

  if p_order_id is not null then
    linked_ticket_id := public.app_send_order_message(
      p_order_id, p_request_id, send_body, false
    );
    select * into message_row from public.ticket_messages
    where ticket_id = linked_ticket_id and request_id = p_request_id;
  elsif p_reply_to_message_id is not null then
    message_row := public.app_reply_to_ticket_message(
      p_request_id, p_ticket_id, send_body, p_reply_to_message_id
    );
    linked_ticket_id := p_ticket_id;
  else
    message_row := public.app_reply_to_ticket(p_request_id, p_ticket_id, send_body);
    linked_ticket_id := p_ticket_id;
  end if;

  insert into public.ticket_attachments (
    ticket_id, ticket_message_id, storage_object_key, original_name,
    mime_type, size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id
  ) values (
    linked_ticket_id, message_row.id, expected_key, p_original_name,
    p_mime_type, p_size_bytes, p_checksum_sha256, 'clean', actor.profile_id
  )
  on conflict (storage_object_key) do nothing;

  select * into attachment_row from public.ticket_attachments
  where storage_object_key = expected_key;
  if attachment_row.ticket_id <> linked_ticket_id
     or attachment_row.ticket_message_id <> message_row.id
     or attachment_row.original_name <> p_original_name
     or attachment_row.mime_type <> p_mime_type
     or attachment_row.size_bytes <> p_size_bytes
     or attachment_row.checksum_sha256 <> p_checksum_sha256 then
    raise exception 'Ticket attachment request conflicts with an existing file' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'ticket_id', linked_ticket_id,
    'message_id', message_row.id,
    'attachment_id', attachment_row.id
  );
end;
$$;

create function public.app_get_ticket_attachment_download(p_attachment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare attachment_row public.ticket_attachments; ticket_row public.tickets; message_row public.ticket_messages; actor record;
begin
  select * into attachment_row from public.ticket_attachments where id = p_attachment_id;
  if attachment_row.id is null or attachment_row.scan_status <> 'clean' then
    raise exception 'Ticket attachment not found' using errcode = 'P0002';
  end if;

  ticket_row := private.require_ticket_access(attachment_row.ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  select * into actor from private.current_ticket_actor();
  select * into message_row from public.ticket_messages where id = attachment_row.ticket_message_id;
  if actor.role_name = 'client'
     and (message_row.visibility <> 'client' or message_row.message_kind = 'internal_note') then
    raise exception 'Ticket attachment not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('storage_object_key', attachment_row.storage_object_key);
end;
$$;

revoke all on function public.app_prepare_ticket_attachment(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.app_send_ticket_message_with_attachment(uuid, uuid, uuid, text, uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.app_get_ticket_attachment_download(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_prepare_ticket_attachment(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.app_send_ticket_message_with_attachment(uuid, uuid, uuid, text, uuid, text, text, bigint, text) to authenticated;
grant execute on function public.app_get_ticket_attachment_download(uuid) to authenticated;
revoke all on function private.prepare_ticket_attachment(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

comment on table public.ticket_attachments is
  'Canonical metadata for private files attached to Ticket messages; binaries live in the private ticket-attachments bucket.';
