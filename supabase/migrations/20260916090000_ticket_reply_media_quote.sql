-- Reply to a media-only Ticket message (no visible text) previously stored
-- the raw U+FFFC blank-body placeholder as reply_quote_text, surfacing the
-- literal "￼" glyph to every future viewer of the reply. Fall back to a
-- truthful, media-aware label instead of the placeholder character.
create or replace function public.app_reply_to_ticket_message(
  p_request_id uuid,
  p_ticket_id uuid,
  p_body text,
  p_reply_to_message_id uuid
)
returns public.ticket_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor record;
  ticket_row public.tickets;
  source_row public.ticket_messages;
  message_row public.ticket_messages;
  existing_id uuid;
  clean_quote text;
  payload jsonb;
begin
  if p_request_id is null or p_ticket_id is null or p_reply_to_message_id is null
     or nullif(btrim(p_body), '') is null or char_length(p_body) > 50000
     or octet_length(p_body) > 200000 then
    raise exception 'invalid Ticket reply input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.reply');
  ticket_row := private.require_ticket_access(p_ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if ticket_row.archived_at is not null or ticket_row.status = 'closed' then
    raise exception 'Ticket is not open for replies' using errcode = '55000';
  end if;

  select * into source_row
  from public.ticket_messages as message
  where message.id = p_reply_to_message_id
    and message.ticket_id = p_ticket_id
    and message.visibility = 'client'
    and message.message_kind <> 'internal_note';
  if source_row.id is null then
    raise exception 'reply source is unavailable' using errcode = '42501';
  end if;

  clean_quote := left(
    regexp_replace(private.team_message_plain_text(source_row.body), '\s+', ' ', 'g'),
    500
  );
  -- U+FFFC is the blank-body placeholder written for text-less attachment
  -- sends; team_message_plain_text() leaves it untouched (it is not
  -- whitespace), so it must be stripped before the blank check below.
  if nullif(btrim(replace(clean_quote, chr(65532), '')), '') is null then
    select case
        when count(*) = 0 then 'Message'
        when count(*) = count(*) filter (where attachment.mime_type like 'image/%') then 'Image'
        else 'Attachment'
      end
    into clean_quote
    from public.ticket_attachments as attachment
    where attachment.ticket_message_id = source_row.id;
  end if;
  payload := jsonb_build_object(
    'ticket_id', p_ticket_id,
    'body', p_body,
    'reply_to_message_id', p_reply_to_message_id
  );
  existing_id := private.find_create_request(
    actor.profile_id, 'ticket.reply_to_message', p_request_id, payload
  );
  if existing_id is not null then
    select * into message_row from public.ticket_messages where id = existing_id;
    return message_row;
  end if;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body,
    request_id, reply_to_message_id, reply_quote_text
  ) values (
    p_ticket_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'reply', 'client', btrim(p_body), p_request_id, p_reply_to_message_id, clean_quote
  ) returning * into message_row;

  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.replied', 'Replied to a Ticket message.',
    jsonb_build_object(
      'message_id', message_row.id,
      'reply_to_message_id', p_reply_to_message_id,
      'author_type', message_row.author_type
    ), actor.profile_id
  );
  perform private.remember_create_request(
    actor.profile_id, 'ticket.reply_to_message', p_request_id, payload, message_row.id
  );
  return message_row;
end;
$$;

revoke all on function public.app_reply_to_ticket_message(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_reply_to_ticket_message(uuid, uuid, text, uuid)
  to authenticated;
