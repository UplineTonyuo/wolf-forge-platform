-- Internal notes keep their historical row while hiding unsent content.

alter table public.ticket_messages
  add column if not exists unsent_at timestamptz,
  add column if not exists unsent_by_profile_id uuid
    references public.profiles (id) on delete restrict;

alter table public.ticket_messages
  drop constraint if exists ticket_messages_unsent_shape_valid,
  add constraint ticket_messages_unsent_shape_valid check (
    (unsent_at is null and unsent_by_profile_id is null)
    or (
      unsent_at is not null
      and unsent_by_profile_id is not null
      and message_kind = 'internal_note'
      and visibility = 'internal'
      and body = 'This note was unsent.'
    )
  );

comment on column public.ticket_messages.unsent_at is
  'When set, this internal note remains in history but renders only its tombstone.';
comment on column public.ticket_messages.unsent_by_profile_id is
  'Authenticated author who unsent the internal note.';

-- Preserve append-only history. The only permitted row update is the exact
-- one-way transition from a live internal note to its tombstone.
create or replace function private.prevent_ticket_message_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.message_kind = 'internal_note'
    and old.visibility = 'internal'
    and old.unsent_at is null
    and old.unsent_by_profile_id is null
    and new.unsent_at is not null
    and new.unsent_by_profile_id is not null
    and new.body = 'This note was unsent.'
    and (to_jsonb(new) - array['body', 'unsent_at', 'unsent_by_profile_id'])
      = (to_jsonb(old) - array['body', 'unsent_at', 'unsent_by_profile_id'])
  then
    return new;
  end if;

  raise exception 'Ticket messages are append-only' using errcode = '55000';
end;
$$;

create or replace function public.app_unsend_ticket_internal_note(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor record;
  note public.ticket_messages;
  ticket_row public.tickets;
  unsent_time timestamptz;
begin
  if p_message_id is null then
    raise exception 'invalid Ticket note input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.internal_notes');

  select * into note
  from public.ticket_messages
  where id = p_message_id
  for update;

  if note.id is null or note.message_kind <> 'internal_note' or note.visibility <> 'internal' then
    raise exception 'Ticket note not found' using errcode = 'P0002';
  end if;

  ticket_row := private.require_ticket_access(note.ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if note.author_profile_id is distinct from actor.profile_id then
    raise exception 'only the note author may unsend it' using errcode = '42501';
  end if;

  if note.unsent_at is not null then
    return jsonb_build_object('ticket_id', note.ticket_id, 'order_id', ticket_row.order_id);
  end if;

  perform private.consume_rate_limit(
    'ticket.internal_note.unsend.actor', actor.profile_id::text, interval '1 minute', 60
  );
  unsent_time := clock_timestamp();

  update public.ticket_messages
  set body = 'This note was unsent.',
      unsent_at = unsent_time,
      unsent_by_profile_id = actor.profile_id
  where id = note.id;

  update public.tickets set updated_at = unsent_time where id = note.ticket_id;
  perform private.record_ticket_activity(
    note.ticket_id,
    'ticket.internal_note_unsent',
    'Unsent an internal Ticket note.',
    jsonb_build_object('message_id', note.id),
    actor.profile_id
  );

  return jsonb_build_object('ticket_id', note.ticket_id, 'order_id', ticket_row.order_id);
end;
$$;

revoke all on function public.app_unsend_ticket_internal_note(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_unsend_ticket_internal_note(uuid)
  to authenticated;

comment on function public.app_unsend_ticket_internal_note(uuid) is
  'Author-only persisted tombstone transition for an accessible internal Ticket note.';

-- Keep the existing detail authorization boundary and strip any attachments
-- from tombstoned notes before the result reaches normal UI readers.
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
      'reply_quote_text', stored.reply_quote_text,
      'reply_source_author_name', coalesce(
        reply_author.display_name,
        case when reply_source.author_type in ('client', 'guest') then reply_ticket.requester_name end,
        case when reply_source.author_type = 'system' then 'Wolf Forge' end
      ),
      'reply_source_available', reply_source.id is not null,
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
  left join public.profiles as reply_author on reply_author.id = reply_source.author_profile_id;

  return jsonb_set(detail, '{messages}', enriched_messages, true);
end;
$$;

revoke all on function public.app_get_ticket_detail_with_avatars(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_ticket_detail_with_avatars(uuid)
  to authenticated;
