-- Secure image/file delivery: the browser-facing route must proxy attachment
-- bytes through the app instead of redirecting to a raw Supabase Storage
-- signed URL. The route needs the attachment's mime_type and original_name
-- (already resolved and authorized inside this function) to set correct
-- response headers without a second round trip. No authorization logic
-- changes: every existing check (attachment/scan_status, Ticket access,
-- Order access, internal-note-vs-client visibility) is untouched.

create or replace function public.app_get_ticket_attachment_download(p_attachment_id uuid)
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

  return jsonb_build_object(
    'storage_object_key', attachment_row.storage_object_key,
    'mime_type', attachment_row.mime_type,
    'original_name', attachment_row.original_name
  );
end;
$$;
