-- Team Communication V2.4 — message actions, replies, forwarding, and durable
-- delete semantics.
--
-- Forward-only after 20260827000000_team_search_and_reactions.sql. The V2.3
-- search index, keyset history, bounded windows, reaction model, Lexical wire
-- format, and two-lane synchronization stay in place. This migration only
-- extends the message read model and the existing RPC boundary.

-- =============================================================================
-- Storage
-- =============================================================================

alter table public.team_messages
  add column reply_to_message_id uuid
    references public.team_messages (id) on delete restrict,
  add column reply_quote_text text,
  add column forwarded_from_message_id uuid
    references public.team_messages (id) on delete restrict,
  add column forwarded_from_author_name text,
  add column deleted_for_everyone_at timestamptz,
  add column deleted_for_everyone_by uuid
    references public.profiles (id) on delete restrict;

alter table public.team_messages
  add constraint team_messages_reply_quote_length
    check (reply_quote_text is null or char_length(reply_quote_text) between 1 and 500),
  add constraint team_messages_forward_author_length
    check (
      forwarded_from_author_name is null
      or char_length(forwarded_from_author_name) between 1 and 200
    ),
  add constraint team_messages_reply_source_shape
    check (reply_to_message_id is not null or reply_quote_text is null),
  add constraint team_messages_forward_source_shape
    check (
      (forwarded_from_message_id is null and forwarded_from_author_name is null)
      or (forwarded_from_message_id is not null and forwarded_from_author_name is not null)
    ),
  add constraint team_messages_tombstone_shape
    check (
      (deleted_for_everyone_at is null and deleted_for_everyone_by is null)
      or (deleted_for_everyone_at is not null and deleted_for_everyone_by is not null)
    );

create index team_messages_reply_source_idx
  on public.team_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create index team_messages_forward_source_idx
  on public.team_messages (forwarded_from_message_id)
  where forwarded_from_message_id is not null;

create table public.team_message_hidden_for_profiles (
  message_id uuid not null references public.team_messages (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

create index team_message_hidden_for_profiles_profile_idx
  on public.team_message_hidden_for_profiles (profile_id, message_id);

alter table public.team_message_hidden_for_profiles enable row level security;
alter table public.team_message_hidden_for_profiles force row level security;

revoke all on table public.team_message_hidden_for_profiles
  from public, anon, authenticated, service_role;

comment on table public.team_message_hidden_for_profiles is
  'Durable per-profile Team message visibility. No browser grants or policies; app_hide_team_message_for_me derives profile_id from auth.uid().';

comment on column public.team_messages.reply_quote_text is
  'Bounded plain-text visible excerpt. The reply RPC validates it against the source message plain-text projection; deleted sources clear it.';

comment on column public.team_messages.forwarded_from_author_name is
  'Safe display snapshot used by an independent forwarded copy; rendering never depends on continued access to the source thread.';

-- =============================================================================
-- Shared private projections and delivery helper
-- =============================================================================

create or replace function private.team_message_reactions_json(
  p_message_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.team_messages as message
      where message.id = p_message_id
        and message.deleted_for_everyone_at is not null
    ) then '[]'::jsonb
    else coalesce(jsonb_agg(reaction_row order by reaction_row.reaction_code), '[]'::jsonb)
  end
  from (
    select
      reaction.reaction_code,
      count(*)::integer as reaction_count,
      bool_or(reaction.reactor_profile_id = p_actor_id) as reacted_by_me,
      jsonb_agg(reactor.display_name order by reactor.display_name, reactor.id) as reactor_names
    from public.team_message_reactions as reaction
    join public.profiles as reactor on reactor.id = reaction.reactor_profile_id
    where reaction.message_id = p_message_id
      and reaction.active
    group by reaction.reaction_code
  ) as reaction_row;
$$;

revoke all on function private.team_message_reactions_json(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.team_message_json(
  p_message_id uuid,
  p_actor_id uuid
)
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
    'reply_quote_text', case
      when reply_source.deleted_for_everyone_at is null then message.reply_quote_text
      else null
    end,
    'reply_source_author_name', reply_author.display_name,
    'reply_source_deleted', coalesce(reply_source.deleted_for_everyone_at is not null, false),
    'forwarded_from_message_id', message.forwarded_from_message_id,
    'forwarded_from_author_name', message.forwarded_from_author_name,
    'deleted_for_everyone', message.deleted_for_everyone_at is not null,
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

create or replace function private.record_team_message_delivery(
  p_message_id uuid,
  p_conversation_id uuid,
  p_actor_id uuid,
  p_created_at timestamptz
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.team_message_deliveries (
    message_id, conversation_id, recipient_profile_id, eligible_at
  )
  select
    p_message_id,
    p_conversation_id,
    member.profile_id,
    p_created_at + interval '30 minutes'
  from public.team_conversation_members as member
  join public.profiles as recipient on recipient.id = member.profile_id
  where member.conversation_id = p_conversation_id
    and member.profile_id <> p_actor_id
    and recipient.archived_at is null
    and private.profile_account_class(member.profile_id) = 'internal'
    and private.profile_has_permission(member.profile_id, 'team_messages.use')
    and not exists (
      select 1
      from public.team_presence_connections as presence
      where presence.profile_id = member.profile_id
        and presence.last_seen_at >= clock_timestamp() - interval '90 seconds'
    )
  on conflict (message_id, recipient_profile_id) do nothing;
$$;

revoke all on function private.record_team_message_delivery(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- Message writes
-- =============================================================================

create or replace function public.app_send_team_reply(
  p_request_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_reply_to_message_id uuid,
  p_reply_quote_text text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  clean_body text := btrim(coalesce(p_body, ''));
  clean_quote text := regexp_replace(btrim(coalesce(p_reply_quote_text, '')), '[[:space:]]+', ' ', 'g');
  source_message record;
  source_plain text;
  sent record;
begin
  if clean_body = '' then
    raise exception 'message body is required' using errcode = '22023';
  end if;
  if char_length(clean_body) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;
  if clean_quote = '' then
    raise exception 'reply quote is required' using errcode = '22023';
  end if;
  if char_length(clean_quote) > 500 then
    raise exception 'reply quote is too long' using errcode = '22001';
  end if;

  select
    message.conversation_id,
    message.body,
    message.deleted_for_everyone_at
  into source_message
  from public.team_messages as message
  where message.id = p_reply_to_message_id;

  if source_message is null
     or source_message.conversation_id <> p_conversation_id
     or source_message.deleted_for_everyone_at is not null
     or exists (
       select 1
       from public.team_message_hidden_for_profiles as hidden
       where hidden.message_id = p_reply_to_message_id
         and hidden.profile_id = actor_id
     ) then
    raise exception 'reply source is unavailable in this conversation' using errcode = '22023';
  end if;

  source_plain := regexp_replace(
    private.team_message_plain_text(source_message.body),
    '[[:space:]]+', ' ', 'g'
  );
  if position(clean_quote in source_plain) = 0 then
    raise exception 'reply quote must be visible source text' using errcode = '22023';
  end if;

  select message.id, message.request_id, message.conversation_id,
    message.author_profile_id, message.body, message.created_at
  into sent
  from public.team_messages as message
  where message.request_id = p_request_id;

  if sent is not null then
    if sent.author_profile_id <> actor_id or sent.conversation_id <> p_conversation_id then
      raise exception 'request id already used' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id', sent.id, 'request_id', sent.request_id,
      'conversation_id', sent.conversation_id,
      'author_profile_id', sent.author_profile_id,
      'body', sent.body, 'created_at', sent.created_at
    );
  end if;

  perform private.consume_rate_limit('team.message.actor.minute', actor_id::text, interval '1 minute', 30);
  perform private.consume_rate_limit('team.message.actor.hour', actor_id::text, interval '1 hour', 200);

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body,
    reply_to_message_id, reply_quote_text
  ) values (
    p_request_id, p_conversation_id, actor_id, clean_body,
    p_reply_to_message_id, clean_quote
  )
  returning id, request_id, conversation_id, author_profile_id, body, created_at
  into sent;

  update public.team_conversations
  set last_message_at = sent.created_at
  where id = p_conversation_id;

  perform private.record_team_message_delivery(
    sent.id, p_conversation_id, actor_id, sent.created_at
  );

  return jsonb_build_object(
    'id', sent.id, 'request_id', sent.request_id,
    'conversation_id', sent.conversation_id,
    'author_profile_id', sent.author_profile_id,
    'body', sent.body, 'created_at', sent.created_at
  );
end;
$$;

revoke all on function public.app_send_team_reply(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_send_team_reply(uuid, uuid, text, uuid, text)
  to authenticated;

create or replace function public.app_forward_team_message(
  p_request_id uuid,
  p_source_message_id uuid,
  p_destination_conversation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  source_message record;
  source_author_name text;
  sent record;
begin
  select
    message.conversation_id,
    message.body,
    message.deleted_for_everyone_at,
    message.forwarded_from_author_name,
    author.display_name as author_name
  into source_message
  from public.team_messages as message
  join public.profiles as author on author.id = message.author_profile_id
  where message.id = p_source_message_id;

  if source_message is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  actor_id := private.require_team_conversation_member(source_message.conversation_id);
  perform private.require_team_conversation_member(p_destination_conversation_id);

  if source_message.deleted_for_everyone_at is not null
     or exists (
       select 1
       from public.team_message_hidden_for_profiles as hidden
       where hidden.message_id = p_source_message_id
         and hidden.profile_id = actor_id
     ) then
    raise exception 'message is unavailable' using errcode = '22023';
  end if;

  source_author_name := left(
    coalesce(
      nullif(btrim(source_message.forwarded_from_author_name), ''),
      nullif(btrim(source_message.author_name), ''),
      'A colleague'
    ),
    200
  );

  select message.id, message.request_id, message.conversation_id,
    message.author_profile_id, message.body, message.created_at
  into sent
  from public.team_messages as message
  where message.request_id = p_request_id;

  if sent is not null then
    if sent.author_profile_id <> actor_id
       or sent.conversation_id <> p_destination_conversation_id then
      raise exception 'request id already used' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id', sent.id, 'request_id', sent.request_id,
      'conversation_id', sent.conversation_id,
      'author_profile_id', sent.author_profile_id,
      'body', sent.body, 'created_at', sent.created_at
    );
  end if;

  perform private.consume_rate_limit('team.message.actor.minute', actor_id::text, interval '1 minute', 30);
  perform private.consume_rate_limit('team.message.actor.hour', actor_id::text, interval '1 hour', 200);

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body,
    forwarded_from_message_id, forwarded_from_author_name
  ) values (
    p_request_id, p_destination_conversation_id, actor_id, source_message.body,
    p_source_message_id, source_author_name
  )
  returning id, request_id, conversation_id, author_profile_id, body, created_at
  into sent;

  update public.team_conversations
  set last_message_at = sent.created_at
  where id = p_destination_conversation_id;

  perform private.record_team_message_delivery(
    sent.id, p_destination_conversation_id, actor_id, sent.created_at
  );

  return jsonb_build_object(
    'id', sent.id, 'request_id', sent.request_id,
    'conversation_id', sent.conversation_id,
    'author_profile_id', sent.author_profile_id,
    'body', sent.body, 'created_at', sent.created_at
  );
end;
$$;

revoke all on function public.app_forward_team_message(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_forward_team_message(uuid, uuid, uuid)
  to authenticated;

create or replace function public.app_hide_team_message_for_me(
  p_message_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  resolved_conversation_id uuid;
begin
  select message.conversation_id into resolved_conversation_id
  from public.team_messages as message
  where message.id = p_message_id;

  if resolved_conversation_id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  actor_id := private.require_team_conversation_member(resolved_conversation_id);

  insert into public.team_message_hidden_for_profiles (message_id, profile_id)
  values (p_message_id, actor_id)
  on conflict (message_id, profile_id) do nothing;

  update public.team_message_deliveries as delivery
  set resolved_at = coalesce(delivery.resolved_at, clock_timestamp())
  where delivery.message_id = p_message_id
    and delivery.recipient_profile_id = actor_id;
end;
$$;

revoke all on function public.app_hide_team_message_for_me(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_hide_team_message_for_me(uuid)
  to authenticated;

create or replace function public.app_delete_team_message_for_everyone(
  p_message_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  source_message record;
  deleted_at timestamptz := clock_timestamp();
begin
  select message.conversation_id, message.author_profile_id,
    message.deleted_for_everyone_at
  into source_message
  from public.team_messages as message
  where message.id = p_message_id;

  if source_message is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  actor_id := private.require_team_conversation_member(source_message.conversation_id);

  if source_message.author_profile_id <> actor_id then
    raise exception 'only the message author may delete it for everyone' using errcode = '42501';
  end if;

  if source_message.deleted_for_everyone_at is not null then
    return;
  end if;

  perform private.consume_rate_limit(
    'team.message.delete.actor', actor_id::text, interval '1 minute', 60
  );

  update public.team_messages as message
  set body = 'Message deleted',
      reply_quote_text = null,
      deleted_for_everyone_at = deleted_at,
      deleted_for_everyone_by = actor_id
  where message.id = p_message_id;

  -- A reply to the deleted source keeps its stable source id but never keeps
  -- the historical excerpt. Every reader renders the source as deleted.
  update public.team_messages as reply
  set reply_quote_text = null
  where reply.reply_to_message_id = p_message_id;

  update public.team_message_reactions as reaction
  set active = false,
      updated_at = deleted_at
  where reaction.message_id = p_message_id
    and reaction.active;

  update public.team_message_deliveries as delivery
  set resolved_at = coalesce(delivery.resolved_at, deleted_at)
  where delivery.message_id = p_message_id;

  -- Do not rewrite last_message_at (conversation chronology); updated_at is
  -- the existing live-delta signal for this state change.
  update public.team_conversations
  set updated_at = deleted_at
  where id = source_message.conversation_id;
end;
$$;

revoke all on function public.app_delete_team_message_for_everyone(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_delete_team_message_for_everyone(uuid)
  to authenticated;

-- Deleted messages cannot be reacted to, even through a forged call.
create or replace function public.app_toggle_team_message_reaction(
  p_message_id uuid,
  p_reaction_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_conversation_id uuid;
  deleted_at timestamptz;
  actor_id uuid;
  now_active boolean;
begin
  select message.conversation_id, message.deleted_for_everyone_at
  into resolved_conversation_id, deleted_at
  from public.team_messages as message
  where message.id = p_message_id;

  if resolved_conversation_id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  actor_id := private.require_team_conversation_member(resolved_conversation_id);

  if deleted_at is not null or exists (
    select 1
    from public.team_message_hidden_for_profiles as hidden
    where hidden.message_id = p_message_id
      and hidden.profile_id = actor_id
  ) then
    raise exception 'message is unavailable' using errcode = '22023';
  end if;

  if p_reaction_code is null or p_reaction_code not in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  ) then
    raise exception 'invalid reaction code' using errcode = '22023';
  end if;

  perform private.consume_rate_limit(
    'team.reaction.actor', actor_id::text, interval '1 minute', 60
  );

  insert into public.team_message_reactions as reaction (
    message_id, reactor_profile_id, reaction_code, active, created_at, updated_at
  )
  values (p_message_id, actor_id, p_reaction_code, true, clock_timestamp(), clock_timestamp())
  on conflict (message_id, reactor_profile_id, reaction_code)
  do update set active = not reaction.active, updated_at = clock_timestamp()
  returning reaction.active into now_active;

  return jsonb_build_object(
    'message_id', p_message_id,
    'reacted_by_me', now_active,
    'reactions', private.team_message_reactions_json(p_message_id, actor_id)
  );
end;
$$;

revoke all on function public.app_toggle_team_message_reaction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_toggle_team_message_reaction(uuid, text)
  to authenticated;

-- =============================================================================
-- Conversation list and unread projections
-- =============================================================================

drop function public.app_list_team_conversations();

create function public.app_list_team_conversations()
returns table (
  conversation_id uuid,
  conversation_kind text,
  conversation_title text,
  member_count integer,
  other_member_profile_id uuid,
  other_member_name text,
  other_member_avatar_url text,
  last_message_id uuid,
  last_message_type text,
  last_message_author_profile_id uuid,
  last_message_author_name text,
  last_message_author_avatar_url text,
  last_message_preview text,
  last_message_at timestamptz,
  unread_count integer,
  my_last_read_at timestamptz,
  destination_search_text text
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select private.require_team_actor() as actor_id
  )
  select
    conversation_row.id,
    conversation_row.kind,
    conversation_row.title,
    (select count(*)::integer from public.team_conversation_members as counted
      where counted.conversation_id = conversation_row.id),
    case when conversation_row.kind = 'direct' then other.id end,
    case when conversation_row.kind = 'direct' then other.display_name end,
    case when conversation_row.kind = 'direct' then other.avatar_url end,
    latest.id,
    latest.message_type,
    latest.author_profile_id,
    latest.author_name,
    latest.author_avatar_url,
    case
      when latest.deleted_for_everyone_at is not null then 'Message deleted'
      when latest.message_type = 'task_activity' then
        coalesce(latest.author_name, 'A colleague') ||
        case latest.task_action
          when 'completed' then ' completed "' || private.team_message_plain_text(latest.body) || '"'
          else ' reopened "' || private.team_message_plain_text(latest.body) || '"'
        end
      else private.team_message_plain_text(latest.body)
    end,
    latest.created_at,
    (
      select count(*)::integer
      from public.team_messages as unread_message
      where unread_message.conversation_id = conversation_row.id
        and unread_message.author_profile_id <> actor.actor_id
        and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
        and unread_message.deleted_for_everyone_at is null
        and not exists (
          select 1 from public.team_message_hidden_for_profiles as hidden
          where hidden.message_id = unread_message.id
            and hidden.profile_id = actor.actor_id
        )
    ),
    my_member.last_read_at,
    member_search.search_text
  from public.team_conversation_members as my_member
  join public.team_conversations as conversation_row
    on conversation_row.id = my_member.conversation_id
  cross join actor
  left join lateral (
    select profile_row.id, profile_row.display_name, profile_row.avatar_url
    from public.team_conversation_members as other_member
    join public.profiles as profile_row on profile_row.id = other_member.profile_id
    where other_member.conversation_id = conversation_row.id
      and other_member.profile_id <> actor.actor_id
    order by other_member.created_at, other_member.profile_id
    limit 1
  ) as other on true
  left join lateral (
    select
      message.id, message.message_type, message.task_action, message.body,
      message.author_profile_id, message.deleted_for_everyone_at,
      message.created_at, author.display_name as author_name,
      author.avatar_url as author_avatar_url
    from public.team_messages as message
    join public.profiles as author on author.id = message.author_profile_id
    where message.conversation_id = conversation_row.id
      and not exists (
        select 1 from public.team_message_hidden_for_profiles as hidden
        where hidden.message_id = message.id
          and hidden.profile_id = actor.actor_id
      )
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest on true
  left join lateral (
    select string_agg(
      coalesce(profile_row.display_name, '') || ' ' || coalesce(auth_user.email::text, ''),
      ' '
      order by profile_row.id
    ) as search_text
    from public.team_conversation_members as searchable_member
    join public.profiles as profile_row on profile_row.id = searchable_member.profile_id
    left join auth.users as auth_user on auth_user.id = profile_row.id
    where searchable_member.conversation_id = conversation_row.id
  ) as member_search on true
  where my_member.profile_id = actor.actor_id
  order by latest.created_at desc nulls last, conversation_row.created_at desc;
$$;

revoke all on function public.app_list_team_conversations()
  from public, anon, authenticated, service_role;
grant execute on function public.app_list_team_conversations()
  to authenticated;

create or replace function public.app_team_unread_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((
    select count(*)
    from public.team_messages as unread_message
    join public.team_conversation_members as my_member
      on my_member.conversation_id = unread_message.conversation_id
     and my_member.profile_id = actor.actor_id
    where unread_message.author_profile_id <> actor.actor_id
      and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
      and unread_message.deleted_for_everyone_at is null
      and not exists (
        select 1 from public.team_message_hidden_for_profiles as hidden
        where hidden.message_id = unread_message.id
          and hidden.profile_id = actor.actor_id
      )
  ))::integer, 0)
  from (select private.require_team_actor() as actor_id) as actor;
$$;

revoke all on function public.app_team_unread_count()
  from public, anon, authenticated, service_role;
grant execute on function public.app_team_unread_count()
  to authenticated;

-- =============================================================================
-- Transcript, history, bounded window, and search
-- =============================================================================

create or replace function public.app_get_team_conversation(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  conversation record;
begin
  select * into conversation
  from public.team_conversations
  where id = p_conversation_id;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'conversation_kind', conversation.kind,
    'conversation_title', conversation.title,
    'members', (
      select coalesce(jsonb_agg(member_row order by member_row.display_name, member_row.profile_id), '[]'::jsonb)
      from (
        select profile_row.id as profile_id, profile_row.display_name, profile_row.avatar_url
        from public.team_conversation_members as member
        join public.profiles as profile_row on profile_row.id = member.profile_id
        where member.conversation_id = p_conversation_id
          and profile_row.archived_at is null
      ) as member_row
    ),
    'other_member', case when conversation.kind = 'direct' then (
      select jsonb_build_object(
        'profile_id', other_profile.id,
        'display_name', other_profile.display_name,
        'avatar_url', other_profile.avatar_url
      )
      from public.team_conversation_members as other_member
      join public.profiles as other_profile on other_profile.id = other_member.profile_id
      where other_member.conversation_id = p_conversation_id
        and other_member.profile_id <> actor_id
      limit 1
    ) else null end,
    'typing', (
      select coalesce(jsonb_agg(typing_row order by typing_row.last_typed_at desc), '[]'::jsonb)
      from (
        select typing.profile_id, profile_row.display_name, profile_row.avatar_url,
          max(typing.last_typed_at) as last_typed_at
        from public.team_typing_connections as typing
        join public.profiles as profile_row on profile_row.id = typing.profile_id
        where typing.conversation_id = p_conversation_id
          and typing.profile_id <> actor_id
          and typing.last_typed_at > clock_timestamp() - interval '3.5 seconds'
          and profile_row.archived_at is null
        group by typing.profile_id, profile_row.display_name, profile_row.avatar_url
      ) as typing_row
    ),
    'messages', (
      select coalesce(jsonb_agg(private.team_message_json(page.id, actor_id)
        order by page.created_at asc, page.id asc), '[]'::jsonb)
      from (
        select message.id, message.created_at
        from public.team_messages as message
        where message.conversation_id = p_conversation_id
          and not exists (
            select 1 from public.team_message_hidden_for_profiles as hidden
            where hidden.message_id = message.id and hidden.profile_id = actor_id
          )
        order by message.created_at desc, message.id desc
        limit 300
      ) as page
    ),
    'tasks', (
      select coalesce(jsonb_agg(task_row order by task_row.created_at asc, task_row.id asc), '[]'::jsonb)
      from (
        select task.id, task.conversation_id, task.source_message_id, task.title,
          task.description, task.status, task.priority, task.due_at,
          task.completed_at, task.completed_by_profile_id, task.created_at,
          task.updated_at, task.assigned_to_profile_id,
          assignee.display_name as assigned_to_name, task.created_by_profile_id,
          creator.display_name as created_by_name
        from public.team_tasks as task
        join public.profiles as assignee on assignee.id = task.assigned_to_profile_id
        join public.profiles as creator on creator.id = task.created_by_profile_id
        where task.conversation_id = p_conversation_id
        order by task.created_at desc, task.id desc
      ) as task_row
    )
  );
end;
$$;

revoke all on function public.app_get_team_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_team_conversation(uuid)
  to authenticated;

create or replace function public.app_list_team_messages_before(
  p_conversation_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  effective_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return (
    with page as (
      select message.id, message.created_at
      from public.team_messages as message
      where message.conversation_id = p_conversation_id
        and (message.created_at, message.id) < (p_before_created_at, p_before_id)
        and not exists (
          select 1 from public.team_message_hidden_for_profiles as hidden
          where hidden.message_id = message.id and hidden.profile_id = actor_id
        )
      order by message.created_at desc, message.id desc
      limit effective_limit + 1
    )
    select jsonb_build_object(
      'messages', (
        select coalesce(jsonb_agg(private.team_message_json(page_row.id, actor_id)
          order by page_row.created_at asc, page_row.id asc), '[]'::jsonb)
        from (
          select * from page order by created_at desc, id desc limit effective_limit
        ) as page_row
      ),
      'has_more', (select count(*) > effective_limit from page)
    )
  );
end;
$$;

revoke all on function public.app_list_team_messages_before(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.app_list_team_messages_before(uuid, timestamptz, uuid, integer)
  to authenticated;

create or replace function public.app_get_team_message_window(
  p_conversation_id uuid,
  p_message_id uuid,
  p_before integer default 25,
  p_after integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  target record;
  before_limit integer := least(greatest(coalesce(p_before, 25), 0), 100);
  after_limit integer := least(greatest(coalesce(p_after, 25), 0), 100);
begin
  select message.created_at, message.id into target
  from public.team_messages as message
  where message.id = p_message_id
    and message.conversation_id = p_conversation_id
    and not exists (
      select 1 from public.team_message_hidden_for_profiles as hidden
      where hidden.message_id = message.id and hidden.profile_id = actor_id
    );

  if not found then
    return jsonb_build_object('found', false, 'messages', '[]'::jsonb);
  end if;

  return (
    with before_page as (
      select message.id, message.created_at
      from public.team_messages as message
      where message.conversation_id = p_conversation_id
        and (message.created_at, message.id) < (target.created_at, target.id)
        and not exists (
          select 1 from public.team_message_hidden_for_profiles as hidden
          where hidden.message_id = message.id and hidden.profile_id = actor_id
        )
      order by message.created_at desc, message.id desc
      limit before_limit
    ),
    after_page as (
      select message.id, message.created_at
      from public.team_messages as message
      where message.conversation_id = p_conversation_id
        and (message.created_at, message.id) >= (target.created_at, target.id)
        and not exists (
          select 1 from public.team_message_hidden_for_profiles as hidden
          where hidden.message_id = message.id and hidden.profile_id = actor_id
        )
      order by message.created_at asc, message.id asc
      limit after_limit + 1
    ),
    combined as (
      select * from before_page
      union all
      select * from after_page
    )
    select jsonb_build_object(
      'found', true,
      'messages', coalesce(jsonb_agg(private.team_message_json(combined.id, actor_id)
        order by combined.created_at asc, combined.id asc), '[]'::jsonb)
    )
    from combined
  );
end;
$$;

revoke all on function public.app_get_team_message_window(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_team_message_window(uuid, uuid, integer, integer)
  to authenticated;

create or replace function public.app_search_team_conversation_messages(
  p_conversation_id uuid,
  p_query text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  effective_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  trimmed_query text := btrim(coalesce(p_query, ''));
  tsquery_value tsquery;
  highlight_start text := chr(57349);
  highlight_stop text := chr(57350);
begin
  if trimmed_query = '' then
    return jsonb_build_object('results', '[]'::jsonb, 'has_more', false);
  end if;

  perform private.consume_rate_limit(
    'team.search.actor', actor_id::text, interval '1 minute', 60
  );

  begin
    tsquery_value := websearch_to_tsquery('english', trimmed_query);
  exception when others then
    return jsonb_build_object('results', '[]'::jsonb, 'has_more', false);
  end;

  if tsquery_value is null or tsquery_value = ''::tsquery then
    return jsonb_build_object('results', '[]'::jsonb, 'has_more', false);
  end if;

  return (
    with page as (
      select message.id, message.author_profile_id,
        author.display_name as author_name, author.avatar_url as author_avatar_url,
        message.created_at,
        ts_headline(
          'english', private.team_message_plain_text(message.body), tsquery_value,
          'StartSel=' || highlight_start || ', StopSel=' || highlight_stop ||
          ', MaxFragments=1, MaxWords=18, MinWords=6, ShortWord=3, HighlightAll=false'
        ) as snippet
      from public.team_messages as message
      join public.profiles as author on author.id = message.author_profile_id
      where message.conversation_id = p_conversation_id
        and message.message_type = 'text'
        and message.deleted_for_everyone_at is null
        and message.search_vector @@ tsquery_value
        and not exists (
          select 1 from public.team_message_hidden_for_profiles as hidden
          where hidden.message_id = message.id and hidden.profile_id = actor_id
        )
        and (
          p_before_created_at is null
          or (message.created_at, message.id) < (p_before_created_at, p_before_id)
        )
      order by message.created_at desc, message.id desc
      limit effective_limit + 1
    )
    select jsonb_build_object(
      'results', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', page_row.id,
          'author_profile_id', page_row.author_profile_id,
          'author_name', page_row.author_name,
          'author_avatar_url', page_row.author_avatar_url,
          'created_at', page_row.created_at,
          'snippet', page_row.snippet
        ) order by page_row.created_at desc, page_row.id desc), '[]'::jsonb)
        from (
          select * from page order by created_at desc, id desc limit effective_limit
        ) as page_row
      ),
      'has_more', (select count(*) > effective_limit from page)
    )
  );
end;
$$;

revoke all on function public.app_search_team_conversation_messages(uuid, text, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.app_search_team_conversation_messages(uuid, text, timestamptz, uuid, integer)
  to authenticated;

-- =============================================================================
-- Existing live lane, minimally extended for tombstone/visibility changes
-- =============================================================================

create or replace function public.app_team_live_sync(
  p_conversation_id uuid default null,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  since timestamptz := coalesce(p_since, clock_timestamp() - interval '30 seconds');
  captured_at timestamptz := clock_timestamp();
begin
  return jsonb_build_object(
    'server_time', captured_at,
    'detail', case
      when p_conversation_id is null then null
      else public.app_get_team_conversation(p_conversation_id)
    end,
    'unread_total', (
      select coalesce(sum((
        select count(*)
        from public.team_messages as unread_message
        where unread_message.conversation_id = my_member.conversation_id
          and unread_message.author_profile_id <> actor_id
          and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
          and unread_message.deleted_for_everyone_at is null
          and not exists (
            select 1 from public.team_message_hidden_for_profiles as hidden
            where hidden.message_id = unread_message.id and hidden.profile_id = actor_id
          )
      ))::integer, 0)
      from public.team_conversation_members as my_member
      where my_member.profile_id = actor_id
    ),
    'signals', (
      select coalesce(jsonb_agg(signal order by signal.last_message_at desc), '[]'::jsonb)
      from (
        select
          conversation_row.id as conversation_id,
          conversation_row.kind as conversation_kind,
          conversation_row.title as conversation_title,
          (select count(*)::integer from public.team_conversation_members as counted
            where counted.conversation_id = conversation_row.id) as member_count,
          case when conversation_row.kind = 'direct' then other.id end as other_member_profile_id,
          case when conversation_row.kind = 'direct' then other.display_name end as other_member_name,
          case when conversation_row.kind = 'direct' then other.avatar_url end as other_member_avatar_url,
          latest.id as last_message_id,
          latest.message_type as last_message_type,
          latest.author_profile_id as last_message_author_profile_id,
          latest.author_name as last_message_author_name,
          latest.author_avatar_url as last_message_author_avatar_url,
          case
            when latest.deleted_for_everyone_at is not null then 'Message deleted'
            when latest.message_type = 'task_activity' then
              coalesce(latest.author_name, 'A colleague') ||
              case latest.task_action
                when 'completed' then ' completed "' || private.team_message_plain_text(latest.body) || '"'
                else ' reopened "' || private.team_message_plain_text(latest.body) || '"'
              end
            else private.team_message_plain_text(latest.body)
          end as last_message_preview,
          latest.created_at as last_message_at,
          (
            select count(*)::integer
            from public.team_messages as unread_message
            where unread_message.conversation_id = conversation_row.id
              and unread_message.author_profile_id <> actor_id
              and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
              and unread_message.deleted_for_everyone_at is null
              and not exists (
                select 1 from public.team_message_hidden_for_profiles as hidden
                where hidden.message_id = unread_message.id and hidden.profile_id = actor_id
              )
          ) as unread_count,
          my_member.last_read_at as my_last_read_at,
          member_search.search_text as destination_search_text
        from public.team_conversation_members as my_member
        join public.team_conversations as conversation_row
          on conversation_row.id = my_member.conversation_id
        left join lateral (
          select profile_row.id, profile_row.display_name, profile_row.avatar_url
          from public.team_conversation_members as other_member
          join public.profiles as profile_row on profile_row.id = other_member.profile_id
          where other_member.conversation_id = conversation_row.id
            and other_member.profile_id <> actor_id
          order by other_member.created_at, other_member.profile_id
          limit 1
        ) as other on true
        left join lateral (
          select message.id, message.message_type, message.task_action, message.body,
            message.author_profile_id, message.deleted_for_everyone_at,
            message.created_at, author.display_name as author_name,
            author.avatar_url as author_avatar_url
          from public.team_messages as message
          join public.profiles as author on author.id = message.author_profile_id
          where message.conversation_id = conversation_row.id
            and not exists (
              select 1 from public.team_message_hidden_for_profiles as hidden
              where hidden.message_id = message.id and hidden.profile_id = actor_id
            )
          order by message.created_at desc, message.id desc
          limit 1
        ) as latest on true
        left join lateral (
          select string_agg(
            coalesce(profile_row.display_name, '') || ' ' || coalesce(auth_user.email::text, ''),
            ' ' order by profile_row.id
          ) as search_text
          from public.team_conversation_members as searchable_member
          join public.profiles as profile_row on profile_row.id = searchable_member.profile_id
          left join auth.users as auth_user on auth_user.id = profile_row.id
          where searchable_member.conversation_id = conversation_row.id
        ) as member_search on true
        where my_member.profile_id = actor_id
          and greatest(
            coalesce(conversation_row.last_message_at, '-infinity'::timestamptz),
            conversation_row.updated_at
          ) > since
      ) as signal
    )
  );
end;
$$;

revoke all on function public.app_team_live_sync(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.app_team_live_sync(uuid, timestamptz)
  to authenticated;
