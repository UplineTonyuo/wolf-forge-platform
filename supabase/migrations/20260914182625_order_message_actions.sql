-- D-190: persisted Order/Ticket message actions.

alter table public.ticket_messages
  add column if not exists reply_to_message_id uuid,
  add column if not exists reply_quote_text text;

alter table public.ticket_messages
  drop constraint if exists ticket_messages_reply_source_fkey,
  add constraint ticket_messages_reply_source_fkey
    foreign key (reply_to_message_id, ticket_id)
    references public.ticket_messages (id, ticket_id) on delete restrict,
  drop constraint if exists ticket_messages_reply_shape_valid,
  add constraint ticket_messages_reply_shape_valid check (
    (reply_to_message_id is null and reply_quote_text is null)
    or (reply_to_message_id is not null and nullif(btrim(reply_quote_text), '') is not null
      and char_length(reply_quote_text) <= 500)
  );

create index if not exists ticket_messages_reply_source_idx
  on public.ticket_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create table if not exists public.ticket_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ticket_messages (id) on delete cascade,
  reactor_profile_id uuid not null references public.profiles (id) on delete cascade,
  reaction_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_message_reactions_code_valid check (reaction_code in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  )),
  constraint ticket_message_reactions_unique
    unique (message_id, reactor_profile_id, reaction_code)
);

drop trigger if exists ticket_message_reactions_set_updated_at
  on public.ticket_message_reactions;
create trigger ticket_message_reactions_set_updated_at
before update on public.ticket_message_reactions
for each row execute function private.set_updated_at();

create index if not exists ticket_message_reactions_message_active_idx
  on public.ticket_message_reactions (message_id)
  where active;

alter table public.ticket_message_reactions enable row level security;
alter table public.ticket_message_reactions force row level security;
revoke all on table public.ticket_message_reactions
  from public, anon, authenticated, service_role;

create or replace function private.ticket_message_reactions_json(
  p_message_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(reaction_row order by reaction_row.reaction_code), '[]'::jsonb)
  from (
    select
      reaction.reaction_code,
      count(*)::integer as reaction_count,
      bool_or(reaction.reactor_profile_id = p_actor_id) as reacted_by_me,
      jsonb_agg(reactor.display_name order by reactor.display_name, reactor.id) as reactor_names
    from public.ticket_message_reactions as reaction
    join public.profiles as reactor on reactor.id = reaction.reactor_profile_id
    where reaction.message_id = p_message_id and reaction.active
    group by reaction.reaction_code
  ) as reaction_row;
$$;

revoke all on function private.ticket_message_reactions_json(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Keep the existing Ticket-detail authorization boundary, then enrich only
-- message ids it already returned to this actor.
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
    ) order by message_json.ordinality
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

create or replace function public.app_toggle_ticket_message_reaction(
  p_message_id uuid,
  p_reaction_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.ticket_messages;
  ticket_row public.tickets;
  actor record;
  now_active boolean;
begin
  select * into source_row from public.ticket_messages where id = p_message_id;
  if source_row.id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then
    raise exception 'verified authentication is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.reply');
  ticket_row := private.require_ticket_access(source_row.ticket_id);
  if ticket_row.order_id is not null then
    perform private.require_order_conversation_access(ticket_row.order_id);
  end if;
  if actor.role_name = 'client' and source_row.visibility <> 'client' then
    raise exception 'message access is denied' using errcode = '42501';
  end if;
  if p_reaction_code is null or p_reaction_code not in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  ) then
    raise exception 'invalid reaction code' using errcode = '22023';
  end if;

  perform private.consume_rate_limit(
    'ticket.reaction.actor', actor.profile_id::text, interval '1 minute', 60
  );
  insert into public.ticket_message_reactions as reaction (
    message_id, reactor_profile_id, reaction_code, active, created_at, updated_at
  ) values (
    p_message_id, actor.profile_id, p_reaction_code, true, clock_timestamp(), clock_timestamp()
  )
  on conflict (message_id, reactor_profile_id, reaction_code)
  do update set active = not reaction.active, updated_at = clock_timestamp()
  returning reaction.active into now_active;

  return jsonb_build_object(
    'message_id', p_message_id,
    'reacted_by_me', now_active,
    'reactions', private.ticket_message_reactions_json(p_message_id, actor.profile_id)
  );
end;
$$;

revoke all on function public.app_toggle_ticket_message_reaction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_toggle_ticket_message_reaction(uuid, text)
  to authenticated;

alter table public.team_messages
  add column if not exists forwarded_from_ticket_message_id uuid
    references public.ticket_messages (id) on delete restrict;

alter table public.team_messages
  drop constraint if exists team_messages_forward_source_shape,
  add constraint team_messages_forward_source_shape check (
    (forwarded_from_message_id is null
      and forwarded_from_ticket_message_id is null
      and forwarded_from_author_name is null)
    or (num_nonnulls(forwarded_from_message_id, forwarded_from_ticket_message_id) = 1
      and nullif(btrim(forwarded_from_author_name), '') is not null)
  );

create index if not exists team_messages_forwarded_ticket_idx
  on public.team_messages (forwarded_from_ticket_message_id)
  where forwarded_from_ticket_message_id is not null;

create or replace function private.team_message_json(p_message_id uuid, p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', message.id,
    'request_id', message.request_id,
    'conversation_id', message.conversation_id,
    'author_profile_id', message.author_profile_id,
    'author_name', author.display_name,
    'author_avatar_url', author.avatar_url,
    'body', case when message.deleted_for_everyone_at is null then message.body else '' end,
    'message_type', message.message_type,
    'task_id', message.task_id,
    'task_action', message.task_action,
    'created_at', message.created_at,
    'reply_to_message_id', message.reply_to_message_id,
    'reply_quote_text', case when reply_source.deleted_for_everyone_at is null
      then message.reply_quote_text else null end,
    'reply_source_author_name', reply_author.display_name,
    'reply_source_deleted', coalesce(reply_source.deleted_for_everyone_at is not null, false),
    'forwarded_from_message_id', message.forwarded_from_message_id,
    'forwarded_from_ticket_message_id', message.forwarded_from_ticket_message_id,
    'forwarded_from_author_name', message.forwarded_from_author_name,
    'deleted_for_everyone', message.deleted_for_everyone_at is not null,
    'voice_storage_path', case when message.voice_expired_at is null then message.voice_storage_path else null end,
    'voice_duration_ms', message.voice_duration_ms,
    'voice_size_bytes', message.voice_size_bytes,
    'voice_mime_type', message.voice_mime_type,
    'voice_expires_at', message.voice_expires_at,
    'voice_expired_at', message.voice_expired_at,
    'reactions', private.team_message_reactions_json(message.id, p_actor_id)
  )
  from public.team_messages as message
  join public.profiles as author on author.id = message.author_profile_id
  left join public.team_messages as reply_source on reply_source.id = message.reply_to_message_id
  left join public.profiles as reply_author on reply_author.id = reply_source.author_profile_id
  where message.id = p_message_id;
$$;

revoke all on function private.team_message_json(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.app_forward_ticket_message_to_team(
  p_request_id uuid,
  p_source_ticket_message_id uuid,
  p_destination_conversation_id uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor record;
  destination_actor_id uuid;
  source_message record;
  clean_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  source_author_name text;
  source_label text;
  source_excerpt text;
  available_source_length integer;
  sent record;
begin
  if p_request_id is null or p_source_ticket_message_id is null
     or p_destination_conversation_id is null
     or char_length(coalesce(p_comment, '')) > 1000 then
    raise exception 'invalid Ticket forward input' using errcode = '22023';
  end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;

  select
    message.ticket_id,
    message.body,
    message.visibility,
    message.message_kind,
    message.author_type,
    ticket.order_id,
    ticket.public_ref,
    ticket.requester_name,
    project.order_number,
    author.display_name as author_name
  into source_message
  from public.ticket_messages as message
  join public.tickets as ticket on ticket.id = message.ticket_id
  left join public.orders as project on project.id = ticket.order_id
  left join public.profiles as author on author.id = message.author_profile_id
  where message.id = p_source_ticket_message_id;

  if source_message is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  perform private.require_ticket_access(source_message.ticket_id);
  if source_message.order_id is not null then
    perform private.require_order_conversation_access(source_message.order_id);
  end if;
  if source_message.visibility <> 'client' or source_message.message_kind = 'internal_note' then
    raise exception 'message is unavailable' using errcode = '42501';
  end if;

  destination_actor_id := private.require_team_conversation_member(p_destination_conversation_id);
  if destination_actor_id <> actor.profile_id then
    raise exception 'actor mismatch' using errcode = '42501';
  end if;

  source_author_name := left(coalesce(
    nullif(btrim(source_message.author_name), ''),
    case when source_message.author_type in ('client', 'guest')
      then nullif(btrim(source_message.requester_name), '') end,
    case when source_message.author_type = 'system' then 'Wolf Forge' end,
    'Client'
  ), 200);
  source_label := case when source_message.order_number is not null
    then 'Project #' || source_message.order_number::text
    else 'Ticket ' || source_message.public_ref
  end;
  available_source_length := 4000 - char_length(source_label) - 2
    - case when clean_comment is null then 0 else char_length(clean_comment) + 2 end;
  -- ponytail: Team messages cap at 4,000 characters; keep a bounded snapshot
  -- here and use the persisted source id if a future authorized detail flow needs more.
  source_excerpt := left(source_message.body, available_source_length);
  if char_length(source_message.body) > available_source_length then
    source_excerpt := left(source_excerpt, available_source_length - 3) || '...';
  end if;

  select message.id, message.request_id, message.conversation_id,
    message.author_profile_id, message.body, message.created_at,
    message.forwarded_from_ticket_message_id
  into sent
  from public.team_messages as message
  where message.request_id = p_request_id;
  if sent is not null then
    if sent.author_profile_id <> actor.profile_id
       or sent.conversation_id <> p_destination_conversation_id
       or sent.forwarded_from_ticket_message_id <> p_source_ticket_message_id
       or sent.body <> concat_ws(E'\n\n', clean_comment, source_label || E'\n' || source_excerpt) then
      raise exception 'request id already used' using errcode = '23505';
    end if;
    return private.team_message_json(sent.id, actor.profile_id);
  end if;

  perform private.enforce_team_slow_mode(p_destination_conversation_id, actor.profile_id);
  perform private.consume_rate_limit(
    'team.message.actor.minute', actor.profile_id::text, interval '1 minute', 30
  );
  perform private.consume_rate_limit(
    'team.message.actor.hour', actor.profile_id::text, interval '1 hour', 200
  );

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body,
    forwarded_from_ticket_message_id, forwarded_from_author_name
  ) values (
    p_request_id, p_destination_conversation_id, actor.profile_id,
    concat_ws(E'\n\n', clean_comment, source_label || E'\n' || source_excerpt),
    p_source_ticket_message_id, source_author_name
  )
  returning id, request_id, conversation_id, author_profile_id, body, created_at,
    forwarded_from_ticket_message_id
  into sent;

  update public.team_conversations
  set last_message_at = sent.created_at
  where id = p_destination_conversation_id;
  perform private.record_team_message_delivery(
    sent.id, p_destination_conversation_id, actor.profile_id, sent.created_at
  );
  return private.team_message_json(sent.id, actor.profile_id);
end;
$$;

revoke all on function public.app_forward_ticket_message_to_team(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_forward_ticket_message_to_team(uuid, uuid, uuid, text)
  to authenticated;

comment on column public.team_messages.forwarded_from_ticket_message_id is
  'Ticket-message provenance for a new Team Chat message. Never passed to Team-message source APIs.';
