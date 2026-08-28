-- =============================================================================
-- Team Communication V2
--
-- Forward-only extension of the already-applied direct-message/task model:
-- group conversations, ephemeral typing connections, structured task activity,
-- creator completion notifications, and task read models reusable by /todo.
-- The closed-table boundary remains unchanged: browser roles receive no table
-- privileges and every actor/author/creator is derived from auth.uid().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conversation and message/task shape extensions
-- -----------------------------------------------------------------------------

alter table public.team_conversations
  add column kind text not null default 'direct',
  add column title text;

alter table public.team_conversations
  drop constraint team_conversations_key_shape;

alter table public.team_conversations
  add constraint team_conversations_kind_valid
    check (kind in ('direct', 'group')),
  add constraint team_conversations_shape_valid
    check (
      (
        kind = 'direct'
        and title is null
        and conversation_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or
      (
        kind = 'group'
        and btrim(title) <> ''
        and char_length(title) <= 80
        and conversation_key ~* '^group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    );

alter table public.team_tasks
  add column completed_by_profile_id uuid
    references public.profiles (id) on delete restrict;

alter table public.team_messages
  add column message_type text not null default 'text',
  add column task_id uuid references public.team_tasks (id) on delete restrict,
  add column task_action text;

alter table public.team_messages
  add constraint team_messages_type_valid
    check (message_type in ('text', 'task_activity')),
  add constraint team_messages_activity_shape_valid
    check (
      (message_type = 'text' and task_id is null and task_action is null)
      or
      (message_type = 'task_activity' and task_id is not null
        and task_action in ('completed', 'reopened'))
    );

create index team_messages_task_activity_idx
  on public.team_messages (task_id, created_at)
  where message_type = 'task_activity';

-- One row per active composer connection, not per keystroke. The opaque
-- connection id distinguishes tabs without ever accepting a profile id.
create table public.team_typing_connections (
  conversation_id uuid not null
    references public.team_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  connection_id uuid not null,
  last_typed_at timestamptz not null default clock_timestamp(),
  primary key (conversation_id, profile_id, connection_id)
);

create index team_typing_connections_fresh_idx
  on public.team_typing_connections (conversation_id, last_typed_at desc);

alter table public.team_typing_connections enable row level security;
alter table public.team_typing_connections force row level security;
revoke all on table public.team_typing_connections
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Group creation and ephemeral typing RPCs
-- -----------------------------------------------------------------------------

create or replace function public.app_create_team_group(
  p_title text,
  p_member_profile_ids uuid[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  clean_title text := btrim(coalesce(p_title, ''));
  requested_ids uuid[];
  conversation_id uuid := gen_random_uuid();
  member_id uuid;
  actor_name text;
begin
  if clean_title = '' then
    raise exception 'group name is required' using errcode = '22023';
  end if;
  if char_length(clean_title) > 80 then
    raise exception 'group name is too long' using errcode = '22001';
  end if;

  select coalesce(array_agg(distinct candidate), '{}'::uuid[])
  into requested_ids
  from unnest(coalesce(p_member_profile_ids, '{}'::uuid[])) as candidate
  where candidate <> actor_id;

  if cardinality(requested_ids) < 2 then
    raise exception 'a group needs at least three members including you'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(requested_ids) as requested(profile_id)
    left join public.profiles as profile_row on profile_row.id = requested.profile_id
    where profile_row.id is null
       or profile_row.archived_at is not null
       or private.profile_account_class(requested.profile_id) is distinct from 'internal'
       or not private.profile_has_permission(requested.profile_id, 'team_messages.use')
  ) then
    raise exception 'every group member must be an active internal teammate'
      using errcode = '22023';
  end if;

  perform private.consume_rate_limit(
    'team.group.create.actor.minute', actor_id::text, interval '1 minute', 10
  );

  insert into public.team_conversations (
    id, conversation_key, kind, title, created_by_profile_id
  ) values (
    conversation_id, 'group:' || conversation_id::text, 'group', clean_title, actor_id
  );

  insert into public.team_conversation_members (conversation_id, profile_id)
  select conversation_id, profile_id
  from unnest(array_append(requested_ids, actor_id)) as profile_id;

  actor_name := coalesce(
    (select display_name from public.profiles where id = actor_id),
    'A colleague'
  );

  foreach member_id in array requested_ids loop
    perform private.emit_team_notification(
      member_id,
      'team-group-created:' || conversation_id::text || ':' || member_id::text,
      actor_name || ' added you to ' || clean_title,
      clean_title,
      '/dashboard?team-messages=' || conversation_id::text,
      'team_conversation',
      conversation_id,
      actor_id
    );
  end loop;

  return conversation_id;
end;
$$;

revoke all on function public.app_create_team_group(text, uuid[])
  from public, anon;
grant execute on function public.app_create_team_group(text, uuid[])
  to authenticated;

create or replace function public.app_touch_team_typing(
  p_conversation_id uuid,
  p_connection_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
begin
  delete from public.team_typing_connections
  where last_typed_at < clock_timestamp() - interval '1 minute';

  insert into public.team_typing_connections (
    conversation_id, profile_id, connection_id, last_typed_at
  ) values (
    p_conversation_id, actor_id, p_connection_id, clock_timestamp()
  )
  on conflict (conversation_id, profile_id, connection_id)
  do update set last_typed_at = excluded.last_typed_at;
end;
$$;

revoke all on function public.app_touch_team_typing(uuid, uuid)
  from public, anon;
grant execute on function public.app_touch_team_typing(uuid, uuid)
  to authenticated;

create or replace function public.app_clear_team_typing(
  p_conversation_id uuid,
  p_connection_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
begin
  delete from public.team_typing_connections
  where conversation_id = p_conversation_id
    and profile_id = actor_id
    and connection_id = p_connection_id;
end;
$$;

revoke all on function public.app_clear_team_typing(uuid, uuid)
  from public, anon;
grant execute on function public.app_clear_team_typing(uuid, uuid)
  to authenticated;

create or replace function public.app_list_team_typing(
  p_conversation_id uuid
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text,
  last_typed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select private.require_team_conversation_member(p_conversation_id) as actor_id
  )
  select
    typing.profile_id,
    profile_row.display_name,
    profile_row.avatar_url,
    max(typing.last_typed_at) as last_typed_at
  from public.team_typing_connections as typing
  join public.profiles as profile_row on profile_row.id = typing.profile_id
  cross join actor
  where typing.conversation_id = p_conversation_id
    and typing.profile_id <> actor.actor_id
    and typing.last_typed_at > clock_timestamp() - interval '3.5 seconds'
    and profile_row.archived_at is null
  group by typing.profile_id, profile_row.display_name, profile_row.avatar_url
  order by max(typing.last_typed_at) desc, typing.profile_id;
$$;

revoke all on function public.app_list_team_typing(uuid)
  from public, anon;
grant execute on function public.app_list_team_typing(uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Group-aware read models. Existing direct rows retain their original fields.
-- -----------------------------------------------------------------------------

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
    (select count(*)::integer from public.team_conversation_members as counted
      where counted.conversation_id = conversation_row.id),
    case when conversation_row.kind = 'direct' then other.id end,
    case when conversation_row.kind = 'direct' then other.display_name end,
    case when conversation_row.kind = 'direct' then other.avatar_url end,
    (
      select case
        when last_message.message_type = 'task_activity' then
          coalesce(last_author.display_name, 'A colleague') ||
          case last_message.task_action
            when 'completed' then ' completed "' || last_message.body || '"'
            else ' reopened "' || last_message.body || '"'
          end
        else regexp_replace(last_message.body, '\s+', ' ', 'g')
      end
      from public.team_messages as last_message
      join public.profiles as last_author on last_author.id = last_message.author_profile_id
      where last_message.conversation_id = conversation_row.id
      order by last_message.created_at desc, last_message.id desc
      limit 1
    ),
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
  where my_member.profile_id = actor.actor_id
  order by conversation_row.last_message_at desc nulls last, conversation_row.created_at desc;
$$;

revoke all on function public.app_list_team_conversations()
  from public, anon;
grant execute on function public.app_list_team_conversations()
  to authenticated;

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
        select
          typing.profile_id,
          profile_row.display_name,
          profile_row.avatar_url,
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
      select coalesce(jsonb_agg(message_row order by message_row.created_at asc, message_row.id asc), '[]'::jsonb)
      from (
        select
          message.id,
          message.request_id,
          message.conversation_id,
          message.author_profile_id,
          author.display_name as author_name,
          author.avatar_url as author_avatar_url,
          message.body,
          message.message_type,
          message.task_id,
          message.task_action,
          message.created_at
        from public.team_messages as message
        join public.profiles as author on author.id = message.author_profile_id
        where message.conversation_id = p_conversation_id
        order by message.created_at desc, message.id desc
        limit 300
      ) as message_row
    ),
    'tasks', (
      select coalesce(jsonb_agg(task_row order by task_row.created_at asc, task_row.id asc), '[]'::jsonb)
      from (
        select
          task.id,
          task.conversation_id,
          task.source_message_id,
          task.title,
          task.description,
          task.status,
          task.priority,
          task.due_at,
          task.completed_at,
          task.completed_by_profile_id,
          task.created_at,
          task.updated_at,
          task.assigned_to_profile_id,
          assignee.display_name as assigned_to_name,
          task.created_by_profile_id,
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
  from public, anon;
grant execute on function public.app_get_team_conversation(uuid)
  to authenticated;

drop function public.app_list_my_team_tasks(boolean);

create function public.app_list_my_team_tasks(
  p_include_team boolean default false
)
returns table (
  id uuid,
  conversation_id uuid,
  source_message_id uuid,
  title text,
  description text,
  status text,
  priority text,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by_profile_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  assigned_to_profile_id uuid,
  assigned_to_name text,
  created_by_profile_id uuid,
  created_by_name text,
  conversation_kind text,
  conversation_name text,
  other_member_name text,
  is_mine boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with scope as (
    select private.require_team_actor() as actor_id
  ),
  my_conversations as (
    select member.conversation_id
    from public.team_conversation_members as member
    join scope on true
    where member.profile_id = scope.actor_id
  )
  select
    task.id,
    task.conversation_id,
    task.source_message_id,
    task.title,
    task.description,
    task.status,
    task.priority,
    task.due_at,
    task.completed_at,
    task.completed_by_profile_id,
    task.created_at,
    task.updated_at,
    task.assigned_to_profile_id,
    assignee.display_name,
    task.created_by_profile_id,
    creator.display_name,
    conversation.kind,
    case when conversation.kind = 'group' then conversation.title else (
      select other.display_name
      from public.team_conversation_members as other_member
      join public.profiles as other on other.id = other_member.profile_id
      where other_member.conversation_id = task.conversation_id
        and other_member.profile_id <> scope.actor_id
      limit 1
    ) end,
    case when conversation.kind = 'direct' then (
      select other.display_name
      from public.team_conversation_members as other_member
      join public.profiles as other on other.id = other_member.profile_id
      where other_member.conversation_id = task.conversation_id
        and other_member.profile_id <> scope.actor_id
      limit 1
    ) end,
    task.assigned_to_profile_id = scope.actor_id
  from public.team_tasks as task
  join scope on true
  join my_conversations on my_conversations.conversation_id = task.conversation_id
  join public.team_conversations as conversation on conversation.id = task.conversation_id
  join public.profiles as assignee on assignee.id = task.assigned_to_profile_id
  join public.profiles as creator on creator.id = task.created_by_profile_id
  where task.assigned_to_profile_id = scope.actor_id
     or (p_include_team and private.current_user_has_permission('team_tasks.manage'))
  order by
    case when task.status = 'done' then 1 else 0 end,
    coalesce(task.due_at, 'infinity'::timestamptz),
    task.created_at desc;
$$;

revoke all on function public.app_list_my_team_tasks(boolean)
  from public, anon;
grant execute on function public.app_list_my_team_tasks(boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Group-aware send and meaningful task transitions
-- -----------------------------------------------------------------------------

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
  recipient_id uuid;
  sender_name text;
  preview text;
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

  sender_name := coalesce(
    (select display_name from public.profiles where id = actor_id),
    'A colleague'
  );
  preview := left(regexp_replace(clean_body, '\s+', ' ', 'g'), 90);

  for recipient_id in
    select member.profile_id
    from public.team_conversation_members as member
    where member.conversation_id = p_conversation_id
      and member.profile_id <> actor_id
  loop
    perform private.emit_team_notification(
      recipient_id,
      'team-message:' || sent.id::text || ':' || recipient_id::text,
      sender_name || ' sent a message',
      preview,
      '/dashboard?team-messages=' || p_conversation_id::text,
      'team_message',
      sent.id,
      actor_id
    );
  end loop;

  return jsonb_build_object(
    'id', sent.id, 'request_id', sent.request_id,
    'conversation_id', sent.conversation_id,
    'author_profile_id', sent.author_profile_id,
    'body', sent.body, 'created_at', sent.created_at
  );
end;
$$;

revoke all on function public.app_send_team_message(uuid, uuid, text)
  from public, anon;
grant execute on function public.app_send_team_message(uuid, uuid, text)
  to authenticated;

create or replace function public.app_update_team_task_status(
  p_task_id uuid,
  p_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  existing record;
  updated record;
  activity record;
  actor_name text;
begin
  if p_status not in ('todo', 'in_progress', 'done') then
    raise exception 'unknown task status' using errcode = '22023';
  end if;

  select task_row.* into existing
  from public.team_tasks as task_row
  where task_row.id = p_task_id
  for update;

  if existing is null then
    raise exception 'task not found' using errcode = '22023';
  end if;
  if not private.team_is_conversation_member(existing.conversation_id, actor_id) then
    raise exception 'conversation membership is required' using errcode = '42501';
  end if;
  if actor_id <> existing.assigned_to_profile_id
    and actor_id <> existing.created_by_profile_id
    and not private.current_user_has_permission('team_tasks.manage') then
    raise exception 'only the assignee, the creator, or management can move this task'
      using errcode = '42501';
  end if;

  if existing.status = p_status then
    updated := existing;
  else
    update public.team_tasks as task_row
    set status = p_status,
        completed_at = case when p_status = 'done' then clock_timestamp() else null end,
        completed_by_profile_id = case when p_status = 'done' then actor_id else null end
    where task_row.id = p_task_id
    returning * into updated;
  end if;

  actor_name := coalesce(
    (select display_name from public.profiles where id = actor_id),
    'A colleague'
  );

  if existing.status <> p_status and p_status = 'done' then
    insert into public.team_messages (
      request_id, conversation_id, author_profile_id, body,
      message_type, task_id, task_action
    ) values (
      gen_random_uuid(), updated.conversation_id, actor_id, updated.title,
      'task_activity', updated.id, 'completed'
    ) returning id, created_at into activity;

    update public.team_conversations
    set last_message_at = activity.created_at
    where id = updated.conversation_id;

    if updated.created_by_profile_id <> actor_id then
      perform private.emit_team_notification(
        updated.created_by_profile_id,
        'team-task-completed:' || activity.id::text,
        actor_name || ' completed "' || updated.title || '"',
        updated.title,
        '/dashboard?team-messages=' || updated.conversation_id::text ||
          '&team-task=' || updated.id::text,
        'team_task',
        updated.id,
        actor_id
      );
    end if;
  elsif existing.status = 'done' and p_status <> 'done' then
    insert into public.team_messages (
      request_id, conversation_id, author_profile_id, body,
      message_type, task_id, task_action
    ) values (
      gen_random_uuid(), updated.conversation_id, actor_id, updated.title,
      'task_activity', updated.id, 'reopened'
    ) returning id, created_at into activity;

    update public.team_conversations
    set last_message_at = activity.created_at
    where id = updated.conversation_id;
  end if;

  return jsonb_build_object(
    'id', updated.id,
    'request_id', updated.request_id,
    'conversation_id', updated.conversation_id,
    'source_message_id', updated.source_message_id,
    'title', updated.title,
    'description', updated.description,
    'status', updated.status,
    'priority', updated.priority,
    'due_at', updated.due_at,
    'completed_at', updated.completed_at,
    'completed_by_profile_id', updated.completed_by_profile_id,
    'created_at', updated.created_at,
    'updated_at', updated.updated_at,
    'assigned_to_profile_id', updated.assigned_to_profile_id,
    'created_by_profile_id', updated.created_by_profile_id
  );
end;
$$;

revoke all on function public.app_update_team_task_status(uuid, text)
  from public, anon;
grant execute on function public.app_update_team_task_status(uuid, text)
  to authenticated;

comment on table public.team_typing_connections is
  'Ephemeral per-tab Team composer activity. No browser table access; membership-scoped RPCs only.';
comment on function public.app_create_team_group(text, uuid[]) is
  'Creates an internal-only group. Creator is auth.uid(); supplied ids name members only.';
comment on function public.app_touch_team_typing(uuid, uuid) is
  'Upserts one ephemeral typing heartbeat for the authenticated conversation member.';
