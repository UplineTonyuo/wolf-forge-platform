-- =============================================================================
-- Team Communication + Tasks
--
-- INTERNAL staff-to-staff messaging with lightweight task assignment, surfaced
-- through the workspace command bar. This is a separate security domain from
-- the client Ticket system: a client account holds no capability that reaches
-- any table or RPC created here, and every read/write is a SECURITY DEFINER
-- RPC whose subject is auth.uid() — never a browser-supplied id.
--
-- Design notes:
--
-- 1. DIRECT CONVERSATIONS ONLY (v1). A conversation is a deterministic pair of
--    internal profiles, keyed by the sorted pair so "get or create" cannot
--    duplicate. Membership is fixed at creation; there is no membership-change
--    surface to audit.
--
-- 2. MESSAGES ARE IMMUTABLE, matching the Ticket precedent
--    (private.prevent_ticket_message_mutation). There is no edit and no
--    delete: no mutation path exists at all, so the policy needs no trigger.
--
-- 3. TABLES ARE NOT QUERIED DIRECTLY BY APPLICATION ROLES. RLS is enabled and
--    forced and every privilege is revoked from anon/authenticated/service_role;
--    all reads and writes go through the RPCs below (the notifications model,
--    not the tickets RLS-select model). RLS remains as defense in depth.
--
-- 4. RATE LIMITS sit after authorization and before the write (D-085/D-122),
--    using the one existing primitive private.consume_rate_limit, keyed on the
--    server-derived actor id only.
--
-- 5. NOTIFICATIONS reuse the unified center. A new 'team' category is mapped
--    for internal audiences to team_messages.use and explicitly declared
--    non-deliverable to client accounts, satisfying D-090's "every permitted
--    combination carries an explicit decision" invariant. Delivery is per
--    explicit conversation member, never a capability broadcast, and each
--    insert re-checks the recipient still holds the capability.
--
-- 6. TASKS are a real entity (public.team_tasks), never decorated message
--    text. Statuses todo/in_progress/done. Priority low/normal/high/urgent.
--    Creation, reassignment, priority and due-date changes require
--    team_tasks.manage (owner/admin presets). The assignee (and the creator,
--    and any manage holder) may move status. source_message_id keeps the link
--    to the originating message when the task was made from one.
--
-- 7. AUDIT TRAIL: ordinary messages and routine task moves deliberately stay
--    OUT of both security streams (noise + privacy). Accountability for the
--    genuinely privileged act — reassignment — rides the persistent
--    notification row (actor_profile_id + unique event_key), which is exactly
--    what notifications were designed to carry. The C2-5 durable taxonomy is
--    not extended here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values
  ('team_messages.use', 'team_messages', 'Use team messages',
   'Send and receive internal Wolf Forge staff messages and see assigned team tasks.'),
  ('team_tasks.manage', 'team_messages', 'Manage team tasks',
   'Create team tasks, assign them, and change priority or due date.')
on conflict (permission_key) do nothing;

-- Every internal role can converse; only owner/admin manage accountable work,
-- per the product brief ("William / authorized admin" creates and assigns).
insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, true
from public.roles as role_row
cross join unnest(array['team_messages.use']::text[]) as permission_key
where role_row.name in ('owner', 'admin', 'manager', 'staff')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'team_tasks.manage', true
from public.roles as role_row
where role_row.name in ('owner', 'admin')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

-- Explicitly refused everywhere else, including any later client grant attempt.
insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_key, false
from public.roles as role_row
cross join unnest(array['team_messages.use', 'team_tasks.manage']::text[]) as permission_key
where role_row.name = 'client'
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

-- -----------------------------------------------------------------------------
-- Core schema
-- -----------------------------------------------------------------------------

create table public.team_conversations (
  id uuid primary key default gen_random_uuid(),
  -- Deterministic direct-conversation identity: '<smaller uuid>|<larger uuid>'.
  -- Get-or-create resolves by this key, so two tabs racing to open the same
  -- pair land on one row.
  conversation_key text not null unique,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_conversations_key_shape
    check (conversation_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

create trigger team_conversations_set_updated_at
before update on public.team_conversations
for each row
execute function private.set_updated_at();

create table public.team_conversation_members (
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Read marker for THIS member. Unread = other-authored messages newer than it.
  last_read_at timestamptz,
  created_at timestamptz not null default now(),

  primary key (conversation_id, profile_id)
);

create index team_conversation_members_profile_idx
  on public.team_conversation_members (profile_id);

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  -- Client-generated send id: one draft can be retried without ever producing
  -- two rows, and a replay returns the original message untouched.
  request_id uuid not null unique,
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  author_profile_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),

  constraint team_messages_body_not_blank
    check (btrim(body) <> ''),
  constraint team_messages_body_length
    check (char_length(body) <= 4000)
);

create index team_messages_conversation_created_idx
  on public.team_messages (conversation_id, created_at);

create table public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  source_message_id uuid references public.team_messages (id) on delete set null,
  title text not null,
  description text,
  assigned_to_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'todo',
  priority text not null default 'normal',
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_tasks_title_not_blank
    check (btrim(title) <> ''),
  constraint team_tasks_title_length
    check (char_length(title) <= 200),
  constraint team_tasks_description_not_blank
    check (description is null or btrim(description) <> ''),
  constraint team_tasks_description_length
    check (description is null or char_length(description) <= 2000),
  constraint team_tasks_status_valid
    check (status in ('todo', 'in_progress', 'done')),
  constraint team_tasks_priority_valid
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint team_tasks_done_needs_completed_at
    check ((status = 'done') = (completed_at is not null))
);

create trigger team_tasks_set_updated_at
before update on public.team_tasks
for each row
execute function private.set_updated_at();

create index team_tasks_conversation_created_idx
  on public.team_tasks (conversation_id, created_at);

create index team_tasks_assignee_status_idx
  on public.team_tasks (assigned_to_profile_id, status);

-- -----------------------------------------------------------------------------
-- Lock down: no application role touches these tables directly. Reads and
-- writes happen inside the SECURITY DEFINER RPCs below (owner-owned), so this
-- removes the direct PostgREST surface entirely while keeping RLS as the last
-- line of defense should a grant ever reappear.
-- -----------------------------------------------------------------------------

alter table public.team_conversations enable row level security;
alter table public.team_conversations force row level security;
alter table public.team_conversation_members enable row level security;
alter table public.team_conversation_members force row level security;
alter table public.team_messages enable row level security;
alter table public.team_messages force row level security;
alter table public.team_tasks enable row level security;
alter table public.team_tasks force row level security;

revoke all on table public.team_conversations
  from public, anon, authenticated, service_role;
revoke all on table public.team_conversation_members
  from public, anon, authenticated, service_role;
revoke all on table public.team_messages
  from public, anon, authenticated, service_role;
revoke all on table public.team_tasks
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Private helpers
-- -----------------------------------------------------------------------------

-- One entry boundary for this domain: verified ACTIVE internal actor holding
-- team_messages.use. Returns the server-derived profile id.
create or replace function private.require_team_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('team_messages.use');
  return actor_id;
end;
$$;

revoke all on function private.require_team_actor()
  from public, anon, authenticated, service_role;

create or replace function private.require_team_task_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
begin
  perform private.require_permission('team_tasks.manage');
  return actor_id;
end;
$$;

revoke all on function private.require_team_task_manager()
  from public, anon, authenticated, service_role;

-- Membership is the read/write boundary for everything conversation-scoped.
create or replace function private.team_is_conversation_member(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_conversation_members as member_row
    join public.profiles as profile_row
      on profile_row.id = member_row.profile_id
    where member_row.conversation_id = p_conversation_id
      and member_row.profile_id = p_profile_id
      and profile_row.archived_at is null
  );
$$;

revoke all on function private.team_is_conversation_member(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Refuses anything that is not a conversation the actor belongs to.
create or replace function private.require_team_conversation_member(
  p_conversation_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
begin
  if not private.team_is_conversation_member(p_conversation_id, actor_id) then
    raise exception 'conversation membership is required'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

revoke all on function private.require_team_conversation_member(uuid)
  from public, anon, authenticated, service_role;

-- The other side of a direct conversation, resolved from the fixed pair key.
create or replace function private.team_other_member_id(
  p_conversation_id uuid,
  p_actor_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member_row.profile_id
  from public.team_conversation_members as member_row
  where member_row.conversation_id = p_conversation_id
    and member_row.profile_id <> p_actor_id
  limit 1;
$$;

revoke all on function private.team_other_member_id(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.team_pair_key(
  p_left uuid,
  p_right uuid
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_left < p_right
    then p_left::text || '|' || p_right::text
    else p_right::text || '|' || p_left::text
  end;
$$;

-- Per-recipient team notification. Recipients are explicit conversation
-- members, never a capability fan-out, and each insert re-checks the recipient
-- still holds team_messages.use so a revoked account receives nothing (D-089's
-- delivery-time counterpart).
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
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key
  )
  select
    p_recipient_profile_id,
    null,
    'internal',
    'team',
    'info',
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key
  where private.profile_has_permission(p_recipient_profile_id, 'team_messages.use');
$$;

revoke all on function private.emit_team_notification(uuid, text, text, text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Read models
-- -----------------------------------------------------------------------------

-- The directory a conversation can start with: active internal colleagues.
-- Deliberately narrower than app_list_internal_members (which needs users.view):
-- messaging needs names and faces, not emails or preset administration data.
create or replace function public.app_list_team_members()
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile_row.id,
    profile_row.display_name,
    profile_row.avatar_url
  from public.profiles as profile_row
  where profile_row.archived_at is null
    and profile_row.id <> private.require_team_actor()
    and private.profile_account_class(profile_row.id) = 'internal'
  order by coalesce(nullif(btrim(profile_row.display_name), ''), '~') asc, profile_row.id asc;
$$;

revoke all on function public.app_list_team_members()
  from public, anon;

grant execute on function public.app_list_team_members()
  to authenticated;

-- One row per conversation the actor belongs to: the other person, a preview,
-- and an honest unread count derived from the member's own read marker.
create or replace function public.app_list_team_conversations()
returns table (
  conversation_id uuid,
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
  select
    conversation_row.id,
    other.id,
    other.display_name,
    other.avatar_url,
    (
      select regexp_replace(last_message.body, '\s+', ' ', 'g')
      from public.team_messages as last_message
      where last_message.conversation_id = conversation_row.id
      order by last_message.created_at desc
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
  join public.team_conversation_members as other_member
    on other_member.conversation_id = conversation_row.id
   and other_member.profile_id <> my_member.profile_id
  join public.profiles as other
    on other.id = other_member.profile_id
  cross join (select private.require_team_actor() as actor_id) as actor
  where my_member.profile_id = actor.actor_id
  order by conversation_row.last_message_at desc nulls last, conversation_row.created_at desc;
$$;

revoke all on function public.app_list_team_conversations()
  from public, anon;

grant execute on function public.app_list_team_conversations()
  to authenticated;

-- Cheap badge fuel for the header icon between polls of the full list.
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
  ))::integer, 0)
  from (select private.require_team_actor() as actor_id) as actor;
$$;

revoke all on function public.app_team_unread_count()
  from public, anon;

grant execute on function public.app_team_unread_count()
  to authenticated;

-- Full conversation body: header + newest messages ascending + the
-- conversation's task cards. Membership required, obviously.
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
  other_id uuid := private.team_other_member_id(p_conversation_id, actor_id);
begin
  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'other_member', (
      select jsonb_build_object(
        'profile_id', other_profile.id,
        'display_name', other_profile.display_name,
        'avatar_url', other_profile.avatar_url
      )
      from public.profiles as other_profile
      where other_profile.id = other_id
    ),
    'messages', (
      select coalesce(jsonb_agg(message_row order by message_row.created_at asc, message_row.id asc), '[]'::jsonb)
      from (
        select
          message.id,
          message.conversation_id,
          message.author_profile_id,
          author.display_name as author_name,
          author.avatar_url as author_avatar_url,
          message.body,
          message.created_at
        from public.team_messages as message
        join public.profiles as author
          on author.id = message.author_profile_id
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
          task.created_at,
          task.updated_at,
          task.assigned_to_profile_id,
          assignee.display_name as assigned_to_name,
          task.created_by_profile_id,
          creator.display_name as created_by_name
        from public.team_tasks as task
        join public.profiles as assignee
          on assignee.id = task.assigned_to_profile_id
        join public.profiles as creator
          on creator.id = task.created_by_profile_id
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

-- Tasks the actor can see outside a single conversation thread:
--   * assigned to them, across every conversation they belong to, plus
--   * every task in their own conversations when they hold team_tasks.manage
--     (the Team Tasks grouping is scoped to conversations they are party to —
--     it does not open other people's private threads).
create or replace function public.app_list_my_team_tasks(
  p_include_team boolean default false
)
returns table (
  id uuid,
  conversation_id uuid,
  source_message_id uuid,
  title text,
  status text,
  priority text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  assigned_to_profile_id uuid,
  assigned_to_name text,
  created_by_profile_id uuid,
  created_by_name text,
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
    task.status,
    task.priority,
    task.due_at,
    task.completed_at,
    task.created_at,
    task.updated_at,
    task.assigned_to_profile_id,
    assignee.display_name,
    task.created_by_profile_id,
    creator.display_name,
    (
      select other.display_name
      from public.team_conversation_members as other_member
      join public.profiles as other
        on other.id = other_member.profile_id
      where other_member.conversation_id = task.conversation_id
        and other_member.profile_id <> task.assigned_to_profile_id
      limit 1
    ),
    task.assigned_to_profile_id = scope.actor_id
  from public.team_tasks as task
  join scope on true
  join my_conversations
    on my_conversations.conversation_id = task.conversation_id
  join public.profiles as assignee
    on assignee.id = task.assigned_to_profile_id
  join public.profiles as creator
    on creator.id = task.created_by_profile_id
  where task.assigned_to_profile_id = scope.actor_id
     or (p_include_team and private.current_user_has_permission('team_tasks.manage'))
  order by
    case when task.status = 'done' then 1 else 0 end,
    coalesce(task.due_at, 'infinity'::timestamptz) asc,
    task.created_at desc;
$$;

revoke all on function public.app_list_my_team_tasks(boolean)
  from public, anon;

grant execute on function public.app_list_my_team_tasks(boolean)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Mutations
-- -----------------------------------------------------------------------------

-- Get or create the direct conversation with a colleague. Both sides become
-- members atomically; the deterministic key makes this race-safe.
create or replace function public.app_start_team_conversation(
  p_other_profile_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  v_key text := private.team_pair_key(actor_id, p_other_profile_id);
  v_conversation_id uuid;
begin
  if p_other_profile_id = actor_id then
    raise exception 'a conversation must have two members'
      using errcode = '22023';
  end if;

  if private.profile_account_class(p_other_profile_id) is distinct from 'internal'
    or not exists (
      select 1 from public.profiles as profile_row
      where profile_row.id = p_other_profile_id
        and profile_row.archived_at is null
    ) then
    raise exception 'that colleague cannot be messaged'
      using errcode = '22023';
  end if;

  select conversation_row.id into v_conversation_id
  from public.team_conversations as conversation_row
  where conversation_row.conversation_key = v_key;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  begin
    insert into public.team_conversations (conversation_key, created_by_profile_id)
    values (v_key, actor_id)
    returning id into v_conversation_id;

    insert into public.team_conversation_members (conversation_id, profile_id)
    values (v_conversation_id, actor_id), (v_conversation_id, p_other_profile_id);

    return v_conversation_id;
  exception
    when unique_violation then
      -- A concurrent tab created the same pair first: adopt theirs.
      select conversation_row.id into v_conversation_id
      from public.team_conversations as conversation_row
      where conversation_row.conversation_key = v_key;

      if v_conversation_id is null then
        raise;
      end if;

      return v_conversation_id;
  end;
end;
$$;

revoke all on function public.app_start_team_conversation(uuid)
  from public, anon;

grant execute on function public.app_start_team_conversation(uuid)
  to authenticated;

-- Send. Idempotent on the client request id: a retry replays the original
-- row with zero side effects (no double notification — the event key is the
-- message id, and the replay path never emits anyway).
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
  actor_id uuid;
  clean_body text;
  sent record;
  recipient_id uuid;
  sender_name text;
  preview text;
begin
  actor_id := private.require_team_conversation_member(p_conversation_id);

  clean_body := btrim(coalesce(p_body, ''));
  if clean_body = '' then
    raise exception 'message body is required'
      using errcode = '22023';
  end if;
  if char_length(clean_body) > 4000 then
    raise exception 'message is too long'
      using errcode = '22001';
  end if;

  -- Idempotent replay.
  select
    message.id, message.request_id, message.conversation_id,
    message.author_profile_id, message.body, message.created_at
  into sent
  from public.team_messages as message
  where message.request_id = p_request_id;

  if sent is not null then
    if sent.author_profile_id <> actor_id or sent.conversation_id <> p_conversation_id then
      raise exception 'request id already used'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'id', sent.id,
      'request_id', sent.request_id,
      'conversation_id', sent.conversation_id,
      'author_profile_id', sent.author_profile_id,
      'body', sent.body,
      'created_at', sent.created_at
    );
  end if;

  -- Frequency bounds AFTER authorization and replay, BEFORE the write (D-122).
  perform private.consume_rate_limit('team.message.actor.minute', actor_id::text, interval '1 minute', 30);
  perform private.consume_rate_limit('team.message.actor.hour', actor_id::text, interval '1 hour', 200);

  insert into public.team_messages (request_id, conversation_id, author_profile_id, body)
  values (p_request_id, p_conversation_id, actor_id, clean_body)
  returning
    team_messages.id, team_messages.request_id, team_messages.conversation_id,
    team_messages.author_profile_id, team_messages.body, team_messages.created_at
  into sent;

  update public.team_conversations as conversation_row
  set last_message_at = sent.created_at
  where conversation_row.id = p_conversation_id;

  -- Notify the other member. Never self-notify; never notify a revoked account.
  recipient_id := private.team_other_member_id(p_conversation_id, actor_id);
  sender_name := coalesce(
    (select profile_row.display_name from public.profiles as profile_row where profile_row.id = actor_id),
    'A colleague'
  );
  preview := left(regexp_replace(clean_body, '\s+', ' ', 'g'), 90);

  if recipient_id is not null then
    perform private.emit_team_notification(
      recipient_id,
      'team-message:' || sent.id::text,
      sender_name || ' sent you a message',
      preview,
      '/dashboard?team-messages=' || p_conversation_id::text,
      'team_message',
      sent.id,
      actor_id
    );
  end if;

  return jsonb_build_object(
    'id', sent.id,
    'request_id', sent.request_id,
    'conversation_id', sent.conversation_id,
    'author_profile_id', sent.author_profile_id,
    'body', sent.body,
    'created_at', sent.created_at
  );
end;
$$;

revoke all on function public.app_send_team_message(uuid, uuid, text)
  from public, anon;

grant execute on function public.app_send_team_message(uuid, uuid, text)
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
begin
  update public.team_conversation_members as member_row
  set last_read_at = clock_timestamp()
  where member_row.conversation_id = p_conversation_id
    and member_row.profile_id = actor_id;
end;
$$;

revoke all on function public.app_mark_team_conversation_read(uuid)
  from public, anon;

grant execute on function public.app_mark_team_conversation_read(uuid)
  to authenticated;

-- Create a real task inside a conversation. Management capability only; the
-- assignee must already belong to the conversation (assignment grants no new
-- reach — it never widens who can read the thread).
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
  actor_id uuid;
  clean_title text;
  clean_description text;
  created record;
begin
  actor_id := private.require_team_conversation_member(p_conversation_id);
  perform private.require_permission('team_tasks.manage');

  clean_title := btrim(coalesce(p_title, ''));
  if clean_title = '' then
    raise exception 'task title is required'
      using errcode = '22023';
  end if;
  if char_length(clean_title) > 200 then
    raise exception 'task title is too long'
      using errcode = '22001';
  end if;

  clean_description := btrim(coalesce(p_description, ''));
  if clean_description = '' then
    clean_description := null;
  elsif char_length(clean_description) > 2000 then
    raise exception 'task description is too long'
      using errcode = '22001';
  end if;

  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'unknown task priority'
      using errcode = '22023';
  end if;

  if not private.team_is_conversation_member(p_conversation_id, p_assigned_to_profile_id) then
    raise exception 'the assignee must be part of this conversation'
      using errcode = '22023';
  end if;

  if p_source_message_id is not null and not exists (
    select 1
    from public.team_messages as message_row
    where message_row.id = p_source_message_id
      and message_row.conversation_id = p_conversation_id
  ) then
    raise exception 'source message does not belong to this conversation'
      using errcode = '22023';
  end if;

  perform private.consume_rate_limit('team.task.create.actor.minute', actor_id::text, interval '1 minute', 20);

  begin
    insert into public.team_tasks (
      request_id, conversation_id, source_message_id, title, description,
      assigned_to_profile_id, created_by_profile_id, priority, due_at
    )
    values (
      p_request_id, p_conversation_id, p_source_message_id, clean_title, clean_description,
      p_assigned_to_profile_id, actor_id, p_priority, p_due_at
    )
    returning * into created;
  exception
    when unique_violation then
      select task_row.* into created
      from public.team_tasks as task_row
      where task_row.request_id = p_request_id;

      if created is null then
        raise;
      end if;
  end;

  if created.assigned_to_profile_id <> actor_id then
    perform private.emit_team_notification(
      created.assigned_to_profile_id,
      'team-task-assigned:' || created.id::text,
      'New task from ' || coalesce(
        (select profile_row.display_name from public.profiles as profile_row where profile_row.id = actor_id),
        'a colleague'
      ),
      created.title,
      '/dashboard?team-messages=' || p_conversation_id::text,
      'team_task',
      created.id,
      actor_id
    );
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
    'created_at', created.created_at,
    'updated_at', created.updated_at,
    'assigned_to_profile_id', created.assigned_to_profile_id,
    'created_by_profile_id', created.created_by_profile_id
  );
end;
$$;

revoke all on function public.app_create_team_task(uuid, uuid, text, uuid, text, text, timestamptz, uuid)
  from public, anon;

grant execute on function public.app_create_team_task(uuid, uuid, text, uuid, text, text, timestamptz, uuid)
  to authenticated;

-- Move status. Allowed actors: the assignee, the creator, any manage holder.
-- Everyone else in the conversation sees the card move on refresh but cannot
-- move it. done sets/clears completed_at atomically via the check constraint's
-- companion logic below.
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
  recipient_id uuid;
  actor_name text;
begin
  if p_status not in ('todo', 'in_progress', 'done') then
    raise exception 'unknown task status'
      using errcode = '22023';
  end if;

  select task_row.* into existing
  from public.team_tasks as task_row
  where task_row.id = p_task_id;

  if existing is null then
    raise exception 'task not found'
      using errcode = '22023';
  end if;

  if not private.team_is_conversation_member(existing.conversation_id, actor_id) then
    raise exception 'conversation membership is required'
      using errcode = '42501';
  end if;

  if actor_id <> existing.assigned_to_profile_id
    and actor_id <> existing.created_by_profile_id
    and not private.current_user_has_permission('team_tasks.manage') then
    raise exception 'only the assignee, the creator, or management can move this task'
      using errcode = '42501';
  end if;

  update public.team_tasks as task_row
  set status = p_status,
      completed_at = case when p_status = 'done' then clock_timestamp() else null end
  where task_row.id = p_task_id
  returning * into updated;

  actor_name := coalesce(
    (select profile_row.display_name from public.profiles as profile_row where profile_row.id = actor_id),
    'A colleague'
  );

  -- Tell the other member, whoever they are relative to the actor.
  recipient_id := private.team_other_member_id(updated.conversation_id, actor_id);

  if recipient_id is not null then
    perform private.emit_team_notification(
      recipient_id,
      'team-task-status:' || updated.id::text || ':' || p_status || ':' ||
        extract(epoch from clock_timestamp())::bigint::text,
      actor_name || ' moved "' || updated.title || '" to ' ||
        case p_status when 'todo' then 'To Do' when 'in_progress' then 'In Progress' else 'Done' end,
      -- Notification bodies are constrained non-blank; the title always is.
      updated.title,
      '/dashboard?team-messages=' || updated.conversation_id::text,
      'team_task',
      updated.id,
      actor_id
    );
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

-- Management-only detail edits: title, description, priority, due date, and
-- reassignment. Reassignment notifies the incoming assignee; the persistent
-- notification row (actor id + unique event key) is the accountability trail.
create or replace function public.app_update_team_task_details(
  p_task_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing record;
  updated record;
  new_assignee uuid;
  clean_title text;
  clean_description text;
  new_priority text;
  new_due_at timestamptz;
begin
  actor_id := private.require_team_actor();
  perform private.require_permission('team_tasks.manage');

  select task_row.* into existing
  from public.team_tasks as task_row
  where task_row.id = p_task_id;

  if existing is null then
    raise exception 'task not found'
      using errcode = '22023';
  end if;

  if not private.team_is_conversation_member(existing.conversation_id, actor_id) then
    raise exception 'conversation membership is required'
      using errcode = '42501';
  end if;

  clean_title := existing.title;
  if p_patch ? 'title' then
    clean_title := btrim(coalesce(p_patch ->> 'title', ''));
    if clean_title = '' then
      raise exception 'task title is required'
        using errcode = '22023';
    end if;
    if char_length(clean_title) > 200 then
      raise exception 'task title is too long'
        using errcode = '22001';
    end if;
  end if;

  clean_description := existing.description;
  if p_patch ? 'description' then
    clean_description := btrim(coalesce(p_patch ->> 'description', ''));
    if clean_description = '' then
      clean_description := null;
    elsif char_length(clean_description) > 2000 then
      raise exception 'task description is too long'
        using errcode = '22001';
    end if;
  end if;

  new_priority := existing.priority;
  if p_patch ? 'priority' then
    new_priority := p_patch ->> 'priority';
    if new_priority not in ('low', 'normal', 'high', 'urgent') then
      raise exception 'unknown task priority'
        using errcode = '22023';
    end if;
  end if;

  new_due_at := existing.due_at;
  if p_patch ? 'due_at' then
    new_due_at := (p_patch ->> 'due_at')::timestamptz;
  end if;

  new_assignee := existing.assigned_to_profile_id;
  if p_patch ? 'assigned_to_profile_id' then
    new_assignee := (p_patch ->> 'assigned_to_profile_id')::uuid;

    if not private.team_is_conversation_member(existing.conversation_id, new_assignee) then
      raise exception 'the assignee must be part of this conversation'
        using errcode = '22023';
    end if;
  end if;

  update public.team_tasks as task_row
  set title = clean_title,
      description = clean_description,
      priority = new_priority,
      due_at = new_due_at,
      assigned_to_profile_id = new_assignee
  where task_row.id = p_task_id
  returning * into updated;

  if new_assignee <> existing.assigned_to_profile_id and new_assignee <> actor_id then
    perform private.emit_team_notification(
      new_assignee,
      'team-task-reassigned:' || updated.id::text || ':' ||
        extract(epoch from clock_timestamp())::bigint::text,
      'Task reassigned to you',
      updated.title,
      '/dashboard?team-messages=' || updated.conversation_id::text,
      'team_task',
      updated.id,
      actor_id
    );
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
    'created_at', updated.created_at,
    'updated_at', updated.updated_at,
    'assigned_to_profile_id', updated.assigned_to_profile_id,
    'created_by_profile_id', updated.created_by_profile_id
  );
end;
$$;

revoke all on function public.app_update_team_task_details(uuid, jsonb)
  from public, anon;

grant execute on function public.app_update_team_task_details(uuid, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Notification category decision (D-082 / D-090)
-- -----------------------------------------------------------------------------

-- Widen the permitted catalog with 'team'.
alter table public.notifications
  drop constraint if exists notifications_category_valid;

alter table public.notifications
  add constraint notifications_category_valid
  check (
    category in (
      'project',
      'client',
      'form',
      'coupon',
      'ticket',
      'payment',
      'wallet',
      'store',
      'report',
      'team'
    )
  );

-- Internal audience: team notifications require the messaging capability.
create or replace function private.notification_category_permission(
  p_audience text,
  p_category text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_audience = 'internal' then
      case p_category
        when 'project' then 'projects.view'
        when 'client'  then 'clients.view'
        when 'form'    then 'forms.view'
        when 'coupon'  then 'coupons.view'
        when 'ticket'  then 'tickets.view'
        when 'payment' then 'invoices.view'
        -- Client wallet money is only reachable from /clients/<company>.
        when 'wallet'  then 'clients.view'
        when 'store'   then 'investment_intent.view'
        when 'report'  then 'reports.send'
        when 'team'    then 'team_messages.use'
        else null
      end
    when p_audience = 'client' then
      case p_category
        when 'project' then 'projects.view'
        when 'client'  then 'dashboard.view'
        when 'form'    then 'forms.view'
        -- A client account has no Coupons module; nothing may fan out to one.
        when 'coupon'  then null
        when 'ticket'  then 'tickets.view'
        when 'payment' then 'invoices.view'
        when 'wallet'  then 'invoices.view'
        when 'store'   then 'store.view'
        when 'report'  then 'reporting.view'
        else null
      end
    else null
  end;
$$;

-- Team communication is internal-only BY DEFINITION. Declared explicitly so
-- the category-decision invariant stays total: ('client','team') is a decided
-- refusal, not an undecided gap.
create or replace function private.notification_category_non_deliverable(
  p_audience text,
  p_category text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_audience, p_category) in (
    -- A client account has no Coupons module, so no coupon metadata may ever
    -- reach one.
    ('client', 'coupon'),
    -- Internal staff communication never reaches a client account, whatever
    -- the caller asks for.
    ('client', 'team')
  );
$$;

-- Re-assert the runtime half of the invariant against the widened catalog.
alter table public.notifications
  drop constraint if exists notifications_category_decision;

alter table public.notifications
  add constraint notifications_category_decision check (
    private.notification_category_permission(audience, category) is not null
    or private.notification_category_non_deliverable(audience, category)
  );
