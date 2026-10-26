-- Audio stays on the private Ticket attachment path and existing authorization.
-- This migration changes MIME acceptance only; no grants or policies change.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_send_ticket_message_with_attachment'
      and pg_get_function_identity_arguments(p.oid) = 'p_request_id uuid, p_ticket_id uuid, p_order_id uuid, p_body text, p_reply_to_message_id uuid, p_original_name text, p_mime_type text, p_size_bytes bigint, p_checksum_sha256 text'
      and md5(p.prosrc) = 'fcfeb77b01eb17a8504c56e646b907a6'
  ) then raise exception 'Ticket attachment function changed; review before applying audio support'; end if;
  if not exists (
    select 1 from storage.buckets where id = 'ticket-attachments'
      and public = false and file_size_limit = 5242880
  ) then raise exception 'Ticket attachment bucket differs from the reviewed private bucket'; end if;
end;
$$;
update storage.buckets
set allowed_mime_types = array(
  select distinct mime from unnest(allowed_mime_types || array['audio/webm', 'audio/ogg']::text[]) as mime
)
where id = 'ticket-attachments';
create or replace function public.app_send_ticket_message_with_attachment(
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
  actor record; prepared jsonb; expected_key text; send_body text := coalesce(p_body, '');
  linked public.tickets; ticket_message public.ticket_messages; ticket_attachment public.ticket_attachments;
  project_message public.project_messages; project_attachment public.project_attachments;
  quote_text text;
begin
  if char_length(send_body) > 50000 or octet_length(send_body) > 200000
     or p_original_name is null or btrim(p_original_name) = ''
     or char_length(p_original_name) > 255
     or p_original_name ~ '[\\/]' or p_original_name ~ '[[:cntrl:]]'
     or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif',
       'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf',
       'audio/webm', 'audio/ogg')
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid Ticket attachment' using errcode = '22023';
  end if;
  prepared := private.prepare_ticket_attachment(
    p_request_id, p_ticket_id, p_order_id, p_reply_to_message_id, false
  );
  expected_key := prepared ->> 'storage_key';
  if not exists (select 1 from storage.objects
    where bucket_id = 'ticket-attachments' and name = expected_key) then
    raise exception 'Ticket attachment upload is missing' using errcode = '22023';
  end if;
  select * into actor from private.current_ticket_actor();

  if p_order_id is not null then
    select * into linked from public.tickets where order_id = p_order_id;
  else
    select * into linked from public.tickets where id = p_ticket_id;
  end if;
  if linked.id is not null then
    perform set_config('app.ticket_attachment_message', 'on', true);
    if nullif(btrim(send_body), '') is null then send_body := U&'\FFFC'; end if;
    if p_order_id is not null then
      if p_reply_to_message_id is not null then
        ticket_message := public.app_reply_to_ticket_message(
          p_request_id, linked.id, send_body, p_reply_to_message_id, null
        );
      else
        perform public.app_send_order_message(p_order_id, p_request_id, send_body, false);
        select * into ticket_message from public.ticket_messages
        where ticket_id = linked.id and request_id = p_request_id;
      end if;
    elsif p_reply_to_message_id is not null then
      ticket_message := public.app_reply_to_ticket_message(
        p_request_id, linked.id, send_body, p_reply_to_message_id, null
      );
    else
      ticket_message := public.app_reply_to_ticket(p_request_id, linked.id, send_body);
    end if;
    insert into public.ticket_attachments (
      ticket_id, ticket_message_id, storage_object_key, original_name,
      mime_type, size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id
    ) values (
      linked.id, ticket_message.id, expected_key, p_original_name,
      p_mime_type, p_size_bytes, p_checksum_sha256, 'clean', actor.profile_id
    ) on conflict (storage_object_key) do nothing;
    select * into ticket_attachment from public.ticket_attachments where storage_object_key = expected_key;
    if ticket_attachment.ticket_id <> linked.id or ticket_attachment.ticket_message_id <> ticket_message.id
       or ticket_attachment.original_name <> p_original_name or ticket_attachment.mime_type <> p_mime_type
       or ticket_attachment.size_bytes <> p_size_bytes or ticket_attachment.checksum_sha256 <> p_checksum_sha256 then
      raise exception 'Ticket attachment request conflicts with an existing file' using errcode = '23505';
    end if;
    return jsonb_build_object('ticket_id', linked.id, 'message_id', ticket_message.id, 'attachment_id', ticket_attachment.id);
  end if;

  perform private.require_order_conversation_access(p_order_id);
  if p_reply_to_message_id is not null then
    select left(regexp_replace(private.team_message_plain_text(body), '\s+', ' ', 'g'), 500)
    into quote_text from public.project_messages
    where id = p_reply_to_message_id and order_id = p_order_id;
    if nullif(btrim(replace(quote_text, chr(65532), '')), '') is null then quote_text := 'Attachment'; end if;
  end if;
  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id,
    reply_to_message_id, reply_quote_text
  ) values (
    p_order_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    btrim(send_body), p_request_id, p_reply_to_message_id, quote_text
  ) on conflict (order_id, request_id) do nothing;
  select * into project_message from public.project_messages
  where order_id = p_order_id and request_id = p_request_id;
  if project_message.body is distinct from btrim(send_body)
     or project_message.reply_to_message_id is distinct from p_reply_to_message_id then
    raise exception 'Project attachment request conflicts with an existing message' using errcode = '23505';
  end if;
  insert into public.project_attachments (
    order_id, project_message_id, storage_object_key, original_name,
    mime_type, size_bytes, checksum_sha256, scan_status, uploaded_by_profile_id
  ) values (
    p_order_id, project_message.id, expected_key, p_original_name,
    p_mime_type, p_size_bytes, p_checksum_sha256, 'clean', actor.profile_id
  ) on conflict (storage_object_key) do nothing;
  select * into project_attachment from public.project_attachments where storage_object_key = expected_key;
  if project_attachment.order_id <> p_order_id or project_attachment.project_message_id <> project_message.id
     or project_attachment.original_name <> p_original_name or project_attachment.mime_type <> p_mime_type
     or project_attachment.size_bytes <> p_size_bytes or project_attachment.checksum_sha256 <> p_checksum_sha256 then
    raise exception 'Project attachment request conflicts with an existing file' using errcode = '23505';
  end if;
  return jsonb_build_object('ticket_id', p_order_id, 'message_id', project_message.id, 'attachment_id', project_attachment.id);
end;
$$;

-- Storage metadata is written only by the trusted upload path, after byte validation.
do $migration$
declare
  target regprocedure := 'public.app_send_ticket_message_with_attachment(uuid,uuid,uuid,text,uuid,text,text,bigint,text)'::regprocedure;
  definition text;
  marker text := E'  select * into actor from private.current_ticket_actor();\n';
  audio_guard text := $guard$
  if p_mime_type in ('audio/webm', 'audio/ogg') then
    if p_order_id is not null or p_ticket_id is null then
      raise exception 'Voice messages require a Ticket conversation' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'ticket-attachments' and name = expected_key
        and metadata ->> 'mimetype' = p_mime_type
        and metadata ->> 'size' = p_size_bytes::text
    ) then
      raise exception 'Ticket recording upload could not be verified' using errcode = '22023';
    end if;
  end if;
$guard$;
begin
  if not exists (
    select 1 from pg_proc where oid = target
      and md5(replace(prosrc, E'\r\n', E'\n')) = '918387a64593c705f157eac3c7f6502d'
  ) then
    raise exception 'Ticket attachment function changed; review before applying the recording upload guard';
  end if;
  select replace(pg_get_functiondef(target), E'\r\n', E'\n') into definition;
  if (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1 then
    raise exception 'Ticket attachment guard insertion point changed';
  end if;
  execute replace(definition, marker, audio_guard || marker);
end;
$migration$;
