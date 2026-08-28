-- Team Communication V2.1 preview hardening.
--
-- Ordinary chat messages are ephemeral UI peeks while a recipient is online.
-- Only messages sent while a recipient has no fresh presence connection enter
-- this closed delivery ledger. A stale unread digest is materialized when that
-- recipient next runs the authenticated Team sync path; no scheduler is needed.

create table public.team_message_deliveries (
  message_id uuid not null
    references public.team_messages(id) on delete cascade,
  conversation_id uuid not null
    references public.team_conversations(id) on delete cascade,
  recipient_profile_id uuid not null
    references public.profiles(id) on delete cascade,
  eligible_at timestamptz not null,
  materialized_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, recipient_profile_id),
  constraint team_message_deliveries_resolution_order
    check (resolved_at is null or resolved_at >= created_at)
);

create index team_message_deliveries_recipient_pending_idx
  on public.team_message_deliveries (recipient_profile_id, eligible_at)
  where resolved_at is null;

create index team_message_deliveries_conversation_recipient_idx
  on public.team_message_deliveries (conversation_id, recipient_profile_id)
  where resolved_at is null;

alter table public.team_message_deliveries enable row level security;
alter table public.team_message_deliveries force row level security;

revoke all on table public.team_message_deliveries
  from public, anon, authenticated, service_role;

comment on table public.team_message_deliveries is
  'Closed offline-message delivery ledger. Browser roles have no table access; authenticated RPCs derive the recipient from auth.uid().';

-- Safe plain-text projection used by list peeks and delayed digests. It strips
-- the supported Markdown punctuation and link destinations, never renders HTML.
create or replace function private.team_message_plain_text(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := coalesce(p_body, '');
begin
  clean := regexp_replace(clean, E'\\[([^]\\n]+)\\]\\([^)]*\\)', E'\\1', 'g');
  clean := regexp_replace(clean, E'(^|\\n)[[:space:]]*([*-]|[0-9]+\\.)[[:space:]]+', E'\\1', 'g');
  clean := translate(clean, '*_`#', '');
  clean := regexp_replace(clean, '[[:space:]]+', ' ', 'g');
  return btrim(clean);
end;
$$;

revoke all on function private.team_message_plain_text(text)
  from public, anon, authenticated, service_role;

-- Make every team emitter retry-safe. Existing callers retain their contract;
-- the recipient/event uniqueness key is the idempotency boundary.
create or replace function private.emit_team_notification(
  p_recipient_profile_id uuid,
  p_event_key text,
  p_title text,
  p_body text,
  p_href text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_profile_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (
    recipient_profile_id, company_id, audience, category, variant,
    title, body, href, entity_type, entity_id, actor_profile_id, event_key
  )
  select
    p_recipient_profile_id, null, 'internal', 'team', 'info',
    p_title, p_body, p_href, p_entity_type, p_entity_id,
    p_actor_profile_id, p_event_key
  where private.profile_has_permission(p_recipient_profile_id, 'team_messages.use')
  on conflict (recipient_profile_id, event_key) do nothing;
$$;

revoke all on function private.emit_team_notification(uuid, text, text, text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;

-- The picker may search email as well as display name. This remains an
-- internal-only, capability-gated projection and does not expose client rows.
drop function public.app_list_team_members();

create function public.app_list_team_members()
returns table (
  profile_id uuid,
  display_name text,
  email text,
  avatar_url text
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
    profile_row.id,
    profile_row.display_name,
    auth_user.email::text,
    profile_row.avatar_url
  from public.profiles as profile_row
  join auth.users as auth_user on auth_user.id = profile_row.id
  cross join actor
  where profile_row.archived_at is null
    and profile_row.id <> actor.actor_id
    and private.profile_account_class(profile_row.id) = 'internal'
    and private.profile_has_permission(profile_row.id, 'team_messages.use')
  order by coalesce(nullif(btrim(profile_row.display_name), ''), auth_user.email::text), profile_row.id;
$$;

revoke all on function public.app_list_team_members()
  from public, anon, authenticated, service_role;
grant execute on function public.app_list_team_members()
  to authenticated;

-- One lateral read of the latest message provides enough metadata for the
-- browser to detect a new ordinary message and update one transient peek.
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
  my_last_read_at timestamptz
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
    (select count(*)::integer
       from public.team_conversation_members as counted
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
      when latest.message_type = 'task_activity' then
        coalesce(latest.author_name, 'A colleague') ||
        case latest.task_action
          when 'completed' then ' completed "' || private.team_message_plain_text(latest.body) || '"'
          else ' reopened "' || private.team_message_plain_text(latest.body) || '"'
        end
      else private.team_message_plain_text(latest.body)
    end,
    conversation_row.last_message_at,
    (
      select count(*)::integer
      from public.team_messages as unread_message
      where unread_message.conversation_id = conversation_row.id
        and unread_message.author_profile_id <> actor.actor_id
        and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
    ),
    my_member.last_read_at
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
      message.author_profile_id, author.display_name as author_name,
      author.avatar_url as author_avatar_url
    from public.team_messages as message
    join public.profiles as author on author.id = message.author_profile_id
    where message.conversation_id = conversation_row.id
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest on true
  where my_member.profile_id = actor.actor_id
  order by conversation_row.last_message_at desc nulls last, conversation_row.created_at desc;
$$;

revoke all on function public.app_list_team_conversations()
  from public, anon, authenticated, service_role;
grant execute on function public.app_list_team_conversations()
  to authenticated;

-- Ordinary messages no longer create persistent notifications. Offline
-- recipients receive a deduplicated delivery marker that becomes eligible for
-- one conversation digest after 30 minutes.
create or replace function public.app_send_team_message(
  p_request_id uuid,
  p_conversation_id uuid,
  p_body text
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
  sent record;
begin
  if clean_body = '' then
    raise exception 'message body is required' using errcode = '22023';
  end if;
  if char_length(clean_body) > 4000 then
    raise exception 'message is too long' using errcode = '22001';
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

  insert into public.team_messages (request_id, conversation_id, author_profile_id, body)
  values (p_request_id, p_conversation_id, actor_id, clean_body)
  returning id, request_id, conversation_id, author_profile_id, body, created_at
  into sent;

  update public.team_conversations
  set last_message_at = sent.created_at
  where id = p_conversation_id;

  insert into public.team_message_deliveries (
    message_id, conversation_id, recipient_profile_id, eligible_at
  )
  select
    sent.id, p_conversation_id, member.profile_id,
    sent.created_at + interval '30 minutes'
  from public.team_conversation_members as member
  join public.profiles as recipient on recipient.id = member.profile_id
  where member.conversation_id = p_conversation_id
    and member.profile_id <> actor_id
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

  return jsonb_build_object(
    'id', sent.id, 'request_id', sent.request_id,
    'conversation_id', sent.conversation_id,
    'author_profile_id', sent.author_profile_id,
    'body', sent.body, 'created_at', sent.created_at
  );
end;
$$;

revoke all on function public.app_send_team_message(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_send_team_message(uuid, uuid, text)
  to authenticated;

-- Materialize one stale-unread notification per conversation/read cycle. The
-- actor is eager and server-derived. Repeated sync calls update the same row.
create or replace function public.app_materialize_team_message_digests()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  digest record;
  materialized_count integer := 0;
  digest_title text;
  digest_event_key text;
begin
  update public.team_message_deliveries as delivery
  set resolved_at = clock_timestamp()
  from public.team_messages as message,
       public.team_conversation_members as member
  where delivery.recipient_profile_id = actor_id
    and delivery.resolved_at is null
    and message.id = delivery.message_id
    and member.conversation_id = delivery.conversation_id
    and member.profile_id = actor_id
    and message.created_at <= coalesce(member.last_read_at, '-infinity'::timestamptz);

  for digest in
    with eligible_conversations as (
      select distinct delivery.conversation_id
      from public.team_message_deliveries as delivery
      where delivery.recipient_profile_id = actor_id
        and delivery.resolved_at is null
        and delivery.eligible_at <= clock_timestamp()
    ), unread as (
      select
        message.conversation_id,
        message.id,
        message.author_profile_id,
        author.display_name as author_name,
        message.body,
        message.created_at,
        row_number() over (
          partition by message.conversation_id
          order by message.created_at desc, message.id desc
        ) as preview_rank
      from public.team_messages as message
      join eligible_conversations as eligible
        on eligible.conversation_id = message.conversation_id
      join public.team_conversation_members as member
        on member.conversation_id = message.conversation_id
       and member.profile_id = actor_id
      join public.profiles as author on author.id = message.author_profile_id
      where message.author_profile_id <> actor_id
        and message.message_type = 'text'
        and message.created_at > coalesce(member.last_read_at, '-infinity'::timestamptz)
    )
    select
      conversation.id as conversation_id,
      conversation.kind as conversation_kind,
      conversation.title as conversation_title,
      member.last_read_at,
      count(unread.id)::integer as message_count,
      (array_agg(unread.author_profile_id order by unread.created_at desc, unread.id desc))[1]
        as latest_author_profile_id,
      (array_agg(coalesce(unread.author_name, 'A colleague') order by unread.created_at desc, unread.id desc))[1]
        as latest_author_name,
      string_agg(
        case when unread.preview_rank <= 2
          then left(private.team_message_plain_text(unread.body), 120)
        end,
        E'\n' order by unread.created_at asc, unread.id asc
      ) filter (where unread.preview_rank <= 2) as previews
    from unread
    join public.team_conversations as conversation on conversation.id = unread.conversation_id
    join public.team_conversation_members as member
      on member.conversation_id = unread.conversation_id
     and member.profile_id = actor_id
    group by conversation.id, conversation.kind, conversation.title, member.last_read_at
  loop
    if digest.message_count = 1 then
      digest_title := digest.latest_author_name ||
        case when digest.conversation_kind = 'group'
          then ' sent a message in ' || coalesce(digest.conversation_title, 'your group')
          else ' sent you a message'
        end;
    elsif digest.conversation_kind = 'group' then
      digest_title := digest.message_count::text || ' new messages in ' ||
        coalesce(digest.conversation_title, 'your group');
    else
      digest_title := digest.latest_author_name || ' sent you ' ||
        digest.message_count::text || ' messages';
    end if;

    digest_event_key := 'team-message-digest:' || digest.conversation_id::text || ':' ||
      coalesce(to_char(digest.last_read_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), 'never');

    insert into public.notifications (
      recipient_profile_id, company_id, audience, category, variant,
      title, body, href, entity_type, entity_id, actor_profile_id, event_key
    ) values (
      actor_id, null, 'internal', 'team', 'info',
      digest_title, coalesce(nullif(digest.previews, ''), 'Unread Team messages'),
      '/dashboard?team-messages=' || digest.conversation_id::text,
      'team_conversation', digest.conversation_id,
      digest.latest_author_profile_id, digest_event_key
    )
    on conflict (recipient_profile_id, event_key) do update
      set title = excluded.title,
          body = excluded.body,
          actor_profile_id = excluded.actor_profile_id
    where notifications.read_at is null;

    update public.team_message_deliveries as delivery
    set materialized_at = coalesce(delivery.materialized_at, clock_timestamp())
    where delivery.recipient_profile_id = actor_id
      and delivery.conversation_id = digest.conversation_id
      and delivery.resolved_at is null
      and delivery.eligible_at <= clock_timestamp();

    materialized_count := materialized_count + 1;
  end loop;

  return materialized_count;
end;
$$;

revoke all on function public.app_materialize_team_message_digests()
  from public, anon, authenticated, service_role;
grant execute on function public.app_materialize_team_message_digests()
  to authenticated;

create or replace function public.app_mark_team_conversation_read(
  p_conversation_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  observed_read_at timestamptz := clock_timestamp();
begin
  update public.team_conversation_members as member_row
  set last_read_at = observed_read_at
  where member_row.conversation_id = p_conversation_id
    and member_row.profile_id = actor_id;

  update public.team_message_deliveries as delivery
  set resolved_at = observed_read_at
  where delivery.conversation_id = p_conversation_id
    and delivery.recipient_profile_id = actor_id
    and delivery.resolved_at is null;

  update public.notifications as notification
  set read_at = coalesce(notification.read_at, observed_read_at)
  where notification.recipient_profile_id = actor_id
    and notification.entity_type = 'team_conversation'
    and notification.entity_id = p_conversation_id
    and notification.event_key like 'team-message-digest:' || p_conversation_id::text || ':%'
    and notification.read_at is null;
end;
$$;

revoke all on function public.app_mark_team_conversation_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_mark_team_conversation_read(uuid)
  to authenticated;

-- Canonical task rows remain unchanged. Notification fan-out now reflects the
-- direct/group semantics and stays idempotent on task id + recipient.
create or replace function public.app_create_team_task(
  p_request_id uuid,
  p_conversation_id uuid,
  p_title text,
  p_assigned_to_profile_id uuid,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_source_message_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  clean_title text := btrim(coalesce(p_title, ''));
  clean_description text := nullif(btrim(coalesce(p_description, '')), '');
  created record;
  conversation_kind text;
  actor_name text;
  assignee_name text;
  recipient_id uuid;
  notification_title text;
begin
  perform private.require_permission('team_tasks.manage');

  if clean_title = '' then
    raise exception 'task title is required' using errcode = '22023';
  end if;
  if char_length(clean_title) > 200 then
    raise exception 'task title is too long' using errcode = '22001';
  end if;
  if clean_description is not null and char_length(clean_description) > 2000 then
    raise exception 'task description is too long' using errcode = '22001';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'unknown task priority' using errcode = '22023';
  end if;
  if not private.team_is_conversation_member(p_conversation_id, p_assigned_to_profile_id) then
    raise exception 'the assignee must be part of this conversation' using errcode = '22023';
  end if;
  if p_source_message_id is not null and not exists (
    select 1 from public.team_messages as message_row
    where message_row.id = p_source_message_id
      and message_row.conversation_id = p_conversation_id
  ) then
    raise exception 'source message does not belong to this conversation' using errcode = '22023';
  end if;

  perform private.consume_rate_limit('team.task.create.actor.minute', actor_id::text, interval '1 minute', 20);

  begin
    insert into public.team_tasks (
      request_id, conversation_id, source_message_id, title, description,
      assigned_to_profile_id, created_by_profile_id, priority, due_at
    ) values (
      p_request_id, p_conversation_id, p_source_message_id, clean_title,
      clean_description, p_assigned_to_profile_id, actor_id, p_priority, p_due_at
    ) returning * into created;
  exception
    when unique_violation then
      select task_row.* into created
      from public.team_tasks as task_row
      where task_row.request_id = p_request_id;
      if created is null then raise; end if;
  end;

  select kind into conversation_kind
  from public.team_conversations where id = p_conversation_id;
  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');
  assignee_name := coalesce((select display_name from public.profiles where id = created.assigned_to_profile_id), 'a teammate');

  if conversation_kind = 'direct' then
    if created.assigned_to_profile_id <> actor_id then
      perform private.emit_team_notification(
        created.assigned_to_profile_id,
        'team-task-created:' || created.id::text || ':' || created.assigned_to_profile_id::text,
        actor_name || ' assigned you: ' || created.title,
        created.title,
        '/dashboard?team-messages=' || p_conversation_id::text || '&team-task=' || created.id::text,
        'team_task', created.id, actor_id
      );
    end if;
  else
    for recipient_id in
      select member.profile_id
      from public.team_conversation_members as member
      join public.profiles as recipient on recipient.id = member.profile_id
      where member.conversation_id = p_conversation_id
        and member.profile_id <> actor_id
        and recipient.archived_at is null
        and private.profile_account_class(member.profile_id) = 'internal'
        and private.profile_has_permission(member.profile_id, 'team_messages.use')
    loop
      notification_title := case
        when recipient_id = created.assigned_to_profile_id
          then actor_name || ' assigned you: ' || created.title
        else 'New group task · Assigned to ' || assignee_name
      end;
      perform private.emit_team_notification(
        recipient_id,
        'team-task-created:' || created.id::text || ':' || recipient_id::text,
        notification_title,
        created.title,
        '/dashboard?team-messages=' || p_conversation_id::text || '&team-task=' || created.id::text,
        'team_task', created.id, actor_id
      );
    end loop;
  end if;

  return jsonb_build_object(
    'id', created.id,
    'request_id', created.request_id,
    'conversation_id', created.conversation_id,
    'source_message_id', created.source_message_id,
    'title', created.title,
    'description', created.description,
    'status', created.status,
    'priority', created.priority,
    'due_at', created.due_at,
    'completed_at', created.completed_at,
    'completed_by_profile_id', created.completed_by_profile_id,
    'created_at', created.created_at,
    'updated_at', created.updated_at,
    'assigned_to_profile_id', created.assigned_to_profile_id,
    'created_by_profile_id', created.created_by_profile_id
  );
end;
$$;

revoke all on function public.app_create_team_task(uuid, uuid, text, uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_create_team_task(uuid, uuid, text, uuid, text, text, timestamptz, uuid)
  to authenticated;

-- Remove the old one-row-per-message bell artifacts. Task, group-membership,
-- completion and every non-Team notification are untouched.
delete from public.notifications
where category = 'team'
  and entity_type = 'team_message'
  and event_key like 'team-message:%';
