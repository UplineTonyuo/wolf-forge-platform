-- Facebook-Messenger-style image reply context: a reply must be able to
-- target one exact attachment on its parent message, not just the message
-- as a whole. D-190's existing reply_to_message_id is a same-Ticket
-- composite FK with a bounded server-derived reply_quote_text; this adds an
-- optional attachment-level target on top of it, enforced at the database
-- level so a reply can never reference an attachment that does not belong to
-- its own parent message (needed for the multi-image case: message #7 may
-- carry two images, and a reply must remember which one it targeted).

-- 1. A composite uniqueness anchor so a (attachment id, parent message id)
--    pair can be verified by a real foreign key instead of a trigger.
alter table public.ticket_attachments
  add constraint ticket_attachments_id_message_unique unique (id, ticket_message_id);

-- 2. The optional attachment-level reply target.
alter table public.ticket_messages
  add column reply_to_attachment_id uuid;

alter table public.ticket_messages
  add constraint ticket_messages_reply_attachment_requires_message
  check (reply_to_attachment_id is null or reply_to_message_id is not null);

alter table public.ticket_messages
  add constraint ticket_messages_reply_attachment_fkey
  foreign key (reply_to_attachment_id, reply_to_message_id)
  references public.ticket_attachments (id, ticket_message_id)
  on delete restrict;

-- 3. app_reply_to_ticket_message gains the optional 5th parameter. The old
--    4-argument signature is a distinct overload to Postgres and must be
--    dropped explicitly, or PostgREST/pg RPC dispatch would see two
--    candidate functions once a caller omits the new argument.
drop function if exists public.app_reply_to_ticket_message(uuid, uuid, text, uuid);

create function public.app_reply_to_ticket_message(
  p_request_id uuid,
  p_ticket_id uuid,
  p_body text,
  p_reply_to_message_id uuid,
  p_reply_to_attachment_id uuid default null
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

  -- The attachment target, if any, must genuinely belong to this exact
  -- parent message — the multi-image case (source message #7 carries two
  -- images; a reply to image #2 must not silently resolve to image #1).
  if p_reply_to_attachment_id is not null and not exists (
    select 1 from public.ticket_attachments as attachment
    where attachment.id = p_reply_to_attachment_id
      and attachment.ticket_message_id = source_row.id
  ) then
    raise exception 'reply attachment target is invalid' using errcode = '22023';
  end if;

  clean_quote := left(
    regexp_replace(private.team_message_plain_text(source_row.body), '\s+', ' ', 'g'),
    500
  );
  -- U+FFFC is the blank-body placeholder written for text-less attachment
  -- sends; team_message_plain_text() leaves it untouched (it is not
  -- whitespace), so it must be stripped before the blank check below.
  if nullif(btrim(replace(clean_quote, chr(65532), '')), '') is null then
    if p_reply_to_attachment_id is not null then
      -- A specific attachment was targeted: the text fallback describes
      -- that exact attachment, not "any attachment on the message".
      select case when attachment.mime_type like 'image/%' then 'Image' else 'Attachment' end
      into clean_quote
      from public.ticket_attachments as attachment
      where attachment.id = p_reply_to_attachment_id;
    else
      select case
          when count(*) = 0 then 'Message'
          when count(*) = count(*) filter (where attachment.mime_type like 'image/%') then 'Image'
          else 'Attachment'
        end
      into clean_quote
      from public.ticket_attachments as attachment
      where attachment.ticket_message_id = source_row.id;
    end if;
  end if;
  payload := jsonb_build_object(
    'ticket_id', p_ticket_id,
    'body', p_body,
    'reply_to_message_id', p_reply_to_message_id,
    'reply_to_attachment_id', p_reply_to_attachment_id
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
    request_id, reply_to_message_id, reply_to_attachment_id, reply_quote_text
  ) values (
    p_ticket_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'reply', 'client', btrim(p_body), p_request_id, p_reply_to_message_id, p_reply_to_attachment_id, clean_quote
  ) returning * into message_row;

  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.replied', 'Replied to a Ticket message.',
    jsonb_build_object(
      'message_id', message_row.id,
      'reply_to_message_id', p_reply_to_message_id,
      'reply_to_attachment_id', p_reply_to_attachment_id,
      'author_type', message_row.author_type
    ), actor.profile_id
  );
  perform private.remember_create_request(
    actor.profile_id, 'ticket.reply_to_message', p_request_id, payload, message_row.id
  );
  return message_row;
end;
$$;

revoke all on function public.app_reply_to_ticket_message(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_reply_to_ticket_message(uuid, uuid, text, uuid, uuid)
  to authenticated;

-- 4. Read model: surface the targeted attachment (never raw MIME, bytes,
--    signed URL, or storage path — only its id, whether it is an image, and
--    its original filename, the same fields the existing attachment card
--    already shows). The client renders the thumbnail via the existing
--    authenticated /api/ticket-attachments/{id} route using this id, so no
--    new download surface is introduced.
create or replace function public.app_get_ticket_detail_with_avatars(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare detail jsonb; enriched_messages jsonb;
begin
  detail := public.app_get_ticket_detail(p_ticket_id);
  if detail is null then return null; end if;

  select coalesce(jsonb_agg(
    message_json.value || jsonb_build_object(
      'author_avatar_url', author_profile.avatar_url,
      'reply_to_message_id', stored.reply_to_message_id,
      'reply_to_attachment_id', stored.reply_to_attachment_id,
      'reply_quote_text', stored.reply_quote_text,
      'reply_source_author_name', coalesce(
        reply_author.display_name,
        case when reply_source.author_type in ('client', 'guest') then reply_ticket.requester_name end,
        case when reply_source.author_type = 'system' then 'Wolf Forge' end
      ),
      'reply_source_available', reply_source.id is not null,
      'reply_source_attachment', case when reply_attachment.id is not null then jsonb_build_object(
        'id', reply_attachment.id,
        'is_image', reply_attachment.mime_type like 'image/%',
        'original_name', reply_attachment.original_name
      ) else null end,
      'reactions', private.ticket_message_reactions_json(stored.id, (select auth.uid()))
    ) || case when stored.message_kind = 'internal_note' then jsonb_build_object(
      'body', case when stored.unsent_at is null then stored.body else 'This note was unsent.' end,
      'attachments', case when stored.unsent_at is null
        then coalesce(message_json.value -> 'attachments', '[]'::jsonb)
        else '[]'::jsonb end,
      'unsent_at', stored.unsent_at,
      'can_unsend', stored.unsent_at is null and stored.author_profile_id = (select auth.uid())
    ) else '{}'::jsonb end
    order by message_json.ordinality
  ), '[]'::jsonb)
  into enriched_messages
  from jsonb_array_elements(coalesce(detail -> 'messages', '[]'::jsonb))
    with ordinality as message_json(value, ordinality)
  join public.ticket_messages as stored
    on stored.id = (message_json.value ->> 'id')::uuid
  left join public.profiles as author_profile
    on author_profile.id = stored.author_profile_id and author_profile.archived_at is null
  left join public.ticket_messages as reply_source
    on reply_source.id = stored.reply_to_message_id and reply_source.ticket_id = stored.ticket_id
  left join public.tickets as reply_ticket on reply_ticket.id = reply_source.ticket_id
  left join public.profiles as reply_author on reply_author.id = reply_source.author_profile_id
  left join public.ticket_attachments as reply_attachment
    on reply_attachment.id = stored.reply_to_attachment_id
   and reply_attachment.ticket_message_id = stored.reply_to_message_id;

  return jsonb_set(detail, '{messages}', enriched_messages, true);
end;
$$;

revoke all on function public.app_get_ticket_detail_with_avatars(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_ticket_detail_with_avatars(uuid)
  to authenticated;
