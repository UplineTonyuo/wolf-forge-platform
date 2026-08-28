-- Team Communication V2.6 — conversation governance.
--
-- Forward-only after 20260827130000_reporting_send_window.sql. This does not
-- introduce a second V2.1-V2.5 product surface: reactions, search, presence
-- and typing are untouched, and the live-sync scheduler's own policy is
-- untouched. It does replace a working set of existing RPCs to wire
-- governance in, and to restore a regression this migration's own first pass
-- introduced and then fixed before it ever shipped: Slow Mode enforcement on
-- send/reply/forward; task-creation policy on create; delete-for-everyone
-- additionally refusing to tombstone a task_activity/governance_activity
-- audit row; member removal additionally requiring manage_admins whenever
-- the target holds an admin grant; and app_team_live_sync restored to its
-- exact true pre-V2.6 body (hidden-message filtering, the 'Message deleted'
-- preview priority, and the greatest(last_message_at, updated_at) watermark)
-- plus its one genuine V2.6 addition, the 'created' task-activity preview
-- case.
--
-- What this adds:
--   Owner            team_conversations.created_by_profile_id already IS the
--                     owner (set at creation by app_start_team_conversation /
--                     app_create_team_group). No new column. The owner is
--                     never stored in team_conversation_admins and is always
--                     resolved first, so owner authority cannot be revoked.
--   Delegated admins  public.team_conversation_admins — one row per grant,
--                     five granular boolean capabilities. Closed table, same
--                     posture as every other Team table: zero browser grants,
--                     RPCs only.
--   Slow Mode         team_conversations.slow_mode_seconds/slow_mode_scope +
--                     private.team_slow_mode_cooldowns, a race-safe
--                     compare-and-swap cooldown table (NOT the fixed-window
--                     private.consume_rate_limit primitive — see the function
--                     comment on private.enforce_team_slow_mode for why a
--                     fixed epoch window is the wrong shape for "N seconds
--                     since your last message").
--   Task policy       team_conversations.task_creation_policy, now the sole
--                     authority over team-conversation task CREATE. This
--                     REPLACES the private.require_permission('team_tasks.manage')
--                     check app_create_team_task used to run — an org-wide
--                     capability must not bypass a conversation's own
--                     Owner-only policy, and a plain member must be able to
--                     create when the policy is Everyone even without
--                     team_tasks.manage. Every other team_tasks RPC
--                     (status/detail updates) is untouched and still gates on
--                     team_tasks.manage exactly as before.
--   Task timeline fix task_action gains 'created' alongside the existing
--                     'completed'/'reopened', so a composer-created task (no
--                     source message) now gets its own chronological
--                     task_activity row instead of only living in the sticky
--                     "Tasks in this conversation" block the client removes
--                     in this same release. Anchored (source-message) tasks
--                     are unchanged — they already render inline at their
--                     source message and gain nothing from a second event.
--   Audit trail       Every governance mutation (rename, slow mode, task
--                     policy, admin grant/revoke, member add/remove) inserts
--                     a new message_type = 'governance_activity' row, the
--                     same mechanism task completion already uses. This is
--                     deliberate reuse, not a new subsystem: it rides the
--                     existing last_message_at / live-sync signal plumbing
--                     with no additional wiring.

-- =============================================================================
-- Schema
-- =============================================================================

alter table public.team_conversations
  add column slow_mode_seconds integer,
  add column slow_mode_scope text not null default 'members_and_admins',
  add column task_creation_policy text not null default 'everyone';

alter table public.team_conversations
  add constraint team_conversations_slow_mode_seconds_valid
    check (slow_mode_seconds is null or (slow_mode_seconds > 0 and slow_mode_seconds <= 86400)),
  add constraint team_conversations_slow_mode_scope_valid
    check (slow_mode_scope in ('members_only', 'members_and_admins')),
  add constraint team_conversations_task_creation_policy_valid
    check (task_creation_policy in ('owner_only', 'admins_and_owner', 'everyone'));

comment on column public.team_conversations.slow_mode_seconds is
  'null/0 = off. Enforced by private.enforce_team_slow_mode, a race-safe compare-and-swap cooldown, not private.consume_rate_limit (fixed epoch windows are the wrong shape for a per-actor "wait N seconds since your last message" rule).';
comment on column public.team_conversations.slow_mode_scope is
  'members_only exempts delegated admins as well as the owner; members_and_admins applies to everyone except the owner, who is always exempt regardless of scope.';
comment on column public.team_conversations.task_creation_policy is
  'Authoritative for Team-conversation task CREATE. Replaces the org-wide team_tasks.manage check for this one action; every other team_tasks RPC keeps gating on team_tasks.manage unchanged.';

-- One row per delegated admin grant. The owner (team_conversations.created_by
-- _profile_id) is never a row here — owner authority is resolved first, is
-- unconditional, and cannot be revoked or diluted by anything in this table.
create table public.team_conversation_admins (
  conversation_id uuid not null
    references public.team_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  can_manage_members boolean not null default false,
  can_manage_admins boolean not null default false,
  can_manage_slow_mode boolean not null default false,
  can_rename_conversation boolean not null default false,
  can_manage_task_policy boolean not null default false,
  granted_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),

  primary key (conversation_id, profile_id)
);

create index team_conversation_admins_profile_idx
  on public.team_conversation_admins (profile_id);

alter table public.team_conversation_admins enable row level security;
alter table public.team_conversation_admins force row level security;

revoke all on table public.team_conversation_admins
  from public, anon, authenticated, service_role;

comment on table public.team_conversation_admins is
  'Per-conversation delegated governance grants. Closed table: no browser role holds any privilege; every read/write goes through a SECURITY DEFINER RPC that re-derives the acting profile from auth.uid(). The conversation owner never appears here.';

-- Slow Mode's cooldown watermark. Lives in private (never PostgREST-exposed)
-- and is written only through the conditional-upsert pattern in
-- private.enforce_team_slow_mode, which is what makes it race-safe under two
-- tabs, concurrent requests, multiple server instances and retries.
create table private.team_slow_mode_cooldowns (
  conversation_id uuid not null
    references public.team_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  next_allowed_at timestamptz not null,

  primary key (conversation_id, profile_id)
);

alter table private.team_slow_mode_cooldowns enable row level security;

revoke all on table private.team_slow_mode_cooldowns
  from public, anon, authenticated, service_role;

comment on table private.team_slow_mode_cooldowns is
  'Slow Mode per-actor-per-conversation cooldown watermark. Written only by private.enforce_team_slow_mode via a conditional upsert (INSERT ... ON CONFLICT DO UPDATE ... WHERE next_allowed_at <= clock_timestamp()), which is the standard Postgres atomic compare-and-swap: the unique index serializes concurrent callers, so two racing requests can never both pass. Deliberately clock_timestamp(), not now(): now() is frozen to the start of the enclosing transaction, so it would compare every call inside one transaction against the same instant instead of the real time each call actually ran at.';

-- Widen the existing task_activity shape to allow 'created', and add a
-- sibling message_type for governance events. Both are audit-trail rows, not
-- authored chat: task_id/task_action stay null for governance_activity, the
-- same shape task_activity already requires the inverse of.
alter table public.team_messages
  drop constraint team_messages_type_valid,
  drop constraint team_messages_activity_shape_valid;

alter table public.team_messages
  add constraint team_messages_type_valid
    check (message_type in ('text', 'task_activity', 'governance_activity')),
  add constraint team_messages_activity_shape_valid
    check (
      (message_type = 'text' and task_id is null and task_action is null)
      or
      (message_type = 'task_activity' and task_id is not null
        and task_action in ('completed', 'reopened', 'created'))
      or
      (message_type = 'governance_activity' and task_id is null and task_action is null)
    );

create index team_messages_governance_activity_idx
  on public.team_messages (conversation_id, created_at)
  where message_type = 'governance_activity';

-- =============================================================================
-- Private helpers
-- =============================================================================

create or replace function private.team_conversation_is_owner(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select created_by_profile_id = p_profile_id
  from public.team_conversations
  where id = p_conversation_id;
$$;

revoke all on function private.team_conversation_is_owner(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Owner short-circuits every capability. A delegated admin needs the exact
-- named capability set true on their own grant row.
create or replace function private.team_conversation_has_capability(
  p_conversation_id uuid,
  p_profile_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.team_conversation_is_owner(p_conversation_id, p_profile_id)
    or exists (
      select 1
      from public.team_conversation_admins as admin_row
      where admin_row.conversation_id = p_conversation_id
        and admin_row.profile_id = p_profile_id
        and case p_capability
          when 'manage_members' then admin_row.can_manage_members
          when 'manage_admins' then admin_row.can_manage_admins
          when 'manage_slow_mode' then admin_row.can_manage_slow_mode
          when 'rename_conversation' then admin_row.can_rename_conversation
          when 'manage_task_policy' then admin_row.can_manage_task_policy
          else false
        end
    );
$$;

revoke all on function private.team_conversation_has_capability(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- The one entry boundary every governance mutation RPC opens with: real
-- conversation membership, then the named capability (owner or delegated).
create or replace function private.require_team_conversation_capability(
  p_conversation_id uuid,
  p_capability text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
begin
  if not private.team_conversation_has_capability(p_conversation_id, actor_id, p_capability) then
    raise exception 'this action requires delegated conversation authority'
      using errcode = '42501';
  end if;
  return actor_id;
end;
$$;

revoke all on function private.require_team_conversation_capability(uuid, text)
  from public, anon, authenticated, service_role;

-- Task-creation authority. Conversation policy is the ONLY input — this
-- deliberately does not consult team_tasks.manage, so an org-wide grant
-- cannot bypass a stricter conversation policy and a plain member CAN create
-- under 'everyone' without holding team_tasks.manage at all.
create or replace function private.team_conversation_task_creation_allowed(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (
    select task_creation_policy from public.team_conversations where id = p_conversation_id
  )
    when 'everyone' then true
    when 'owner_only' then private.team_conversation_is_owner(p_conversation_id, p_profile_id)
    when 'admins_and_owner' then
      private.team_conversation_is_owner(p_conversation_id, p_profile_id)
      or exists (
        select 1 from public.team_conversation_admins as admin_row
        where admin_row.conversation_id = p_conversation_id
          and admin_row.profile_id = p_profile_id
      )
    else false
  end;
$$;

revoke all on function private.team_conversation_task_creation_allowed(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.team_format_slow_mode_seconds(p_seconds integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_seconds is null then 'off'
    when p_seconds < 60 then
      p_seconds::text || ' second' || case when p_seconds = 1 then '' else 's' end
    when p_seconds % 60 = 0 then
      (p_seconds / 60)::text || ' minute' || case when p_seconds / 60 = 1 then '' else 's' end
    else
      round(p_seconds / 60.0, 1)::text || ' minutes'
  end;
$$;

revoke all on function private.team_format_slow_mode_seconds(integer)
  from public, anon, authenticated, service_role;

-- Single source of truth for "is this actor currently subject to Slow Mode
-- at all" — shared by enforcement (private.enforce_team_slow_mode) and the
-- read model (public.app_get_team_conversation) precisely so those two can
-- never drift apart the way app_team_live_sync's copy-instead-of-reuse
-- pattern did (see the comment on that function). A stored cooldown row is
-- historical fact; whether it currently BLOCKS this actor depends on the
-- conversation's live configuration, not just the row's timestamp — Slow
-- Mode may since have been turned off, or this actor may since have become
-- exempt (promoted to admin under members_only, or the scope itself
-- changed).
create or replace function private.team_conversation_slow_mode_applies(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.slow_mode_seconds is not null
    and not private.team_conversation_is_owner(p_conversation_id, p_profile_id)
    and case conversation.slow_mode_scope
      when 'members_only' then not exists (
        select 1 from public.team_conversation_admins as admin_row
        where admin_row.conversation_id = p_conversation_id
          and admin_row.profile_id = p_profile_id
      )
      else true -- members_and_admins: everyone but the owner
    end
  from public.team_conversations as conversation
  where conversation.id = p_conversation_id;
$$;

revoke all on function private.team_conversation_slow_mode_applies(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Slow Mode enforcement.
--
-- Deliberately NOT private.consume_rate_limit. That primitive buckets hits
-- into fixed, epoch-aligned windows (comment on the function: "Windows are
-- fixed and epoch-aligned"), which is the right shape for "at most N per
-- window" but the WRONG shape for Slow Mode's actual rule, "wait N seconds
-- since YOUR last message": a 30-second window aligned to :00/:30 lets an
-- actor send at :29 and again at :30, one second later. Slow Mode needs a
-- true sliding cooldown per (conversation, actor), which is what
-- private.team_slow_mode_cooldowns holds.
--
-- Race safety: the whole check is one INSERT ... ON CONFLICT DO UPDATE ...
-- WHERE statement. Postgres locks the conflicting row for the duration of the
-- upsert, so two concurrent callers (two tabs, a retry racing the original, a
-- second Vercel instance) cannot both observe an expired cooldown and both
-- win — exactly one of them updates the row and is allowed through; the loser
-- sees zero rows affected (FOUND = false) and is refused. No advisory lock,
-- no SELECT ... FOR UPDATE, no application-level mutex: the unique index does
-- the serializing.
create or replace function private.enforce_team_slow_mode(
  p_conversation_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  slow_mode_seconds integer;
  proposed_next timestamptz;
  settled_next timestamptz;
  wait_seconds integer;
begin
  if not private.team_conversation_slow_mode_applies(p_conversation_id, p_actor_id) then
    return;
  end if;

  select team_conversations.slow_mode_seconds into slow_mode_seconds
  from public.team_conversations
  where id = p_conversation_id;

  proposed_next := clock_timestamp() + make_interval(secs => slow_mode_seconds);

  insert into private.team_slow_mode_cooldowns as cooldown (
    conversation_id, profile_id, next_allowed_at
  ) values (
    p_conversation_id, p_actor_id, proposed_next
  )
  on conflict (conversation_id, profile_id) do update
    set next_allowed_at = excluded.next_allowed_at
    where cooldown.next_allowed_at <= clock_timestamp()
  returning next_allowed_at into settled_next;

  if not found then
    select next_allowed_at into settled_next
    from private.team_slow_mode_cooldowns
    where conversation_id = p_conversation_id and profile_id = p_actor_id;

    wait_seconds := greatest(
      ceil(extract(epoch from (settled_next - clock_timestamp())))::integer, 1
    );

    -- A DISTINCT SQLSTATE from private.consume_rate_limit's WF429, on
    -- purpose: WF429 is deliberately anonymous (naming the anti-abuse bucket
    -- would help an attacker), but Slow Mode is a visible, intentional
    -- product feature — collapsing it into the same generic "Too many
    -- requests" message defeats its own UX. `detail` carries the remaining
    -- seconds as a plain integer string (not embedded only in prose) so the
    -- application layer can surface an authoritative countdown without
    -- parsing free text.
    raise exception 'slow mode is active for this conversation'
      using errcode = 'WF430',
            detail = wait_seconds::text,
            hint = 'Slow mode is on. Wait ' || wait_seconds || ' more second'
              || case when wait_seconds = 1 then '' else 's' end || '.';
  end if;
end;
$$;

revoke all on function private.enforce_team_slow_mode(uuid, uuid)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- Task timeline fix + task creation policy authority
-- =============================================================================

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
  is_new_task boolean := true;
  conversation_kind text;
  actor_name text;
  assignee_name text;
  recipient_id uuid;
  notification_title text;
  activity record;
begin
  -- Conversation task_creation_policy is authoritative for CREATE. This is
  -- the only check that gates creation now: an org-wide team_tasks.manage
  -- grant must not bypass a conversation set to Owner only, and a plain
  -- member must be able to create under Everyone without holding
  -- team_tasks.manage at all. Every other team_tasks RPC is untouched and
  -- still requires team_tasks.manage exactly as before.
  if not private.team_conversation_task_creation_allowed(p_conversation_id, actor_id) then
    raise exception 'this conversation restricts who can create tasks'
      using errcode = '42501';
  end if;

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
      is_new_task := false;
      select task_row.* into created
      from public.team_tasks as task_row
      where task_row.request_id = p_request_id;
      if created is null then raise; end if;
      -- Bind the replay to the expected actor and conversation, exactly the
      -- pattern every other idempotent-replay RPC in this file already uses
      -- (app_send_team_message/app_send_team_reply/app_forward_team_message
      -- all check this). request_id collisions are practically impossible by
      -- accident, but this was the one create-style RPC that skipped the
      -- check, and it costs nothing to close: it stops a request_id, once
      -- learned or guessed, from returning a DIFFERENT actor's or
      -- conversation's task data as though it were an ordinary replay.
      if created.created_by_profile_id <> actor_id
        or created.conversation_id <> p_conversation_id then
        raise exception 'request id already used' using errcode = '23505';
      end if;
  end;

  -- Task timeline fix: a composer-created task (no source message) gets its
  -- own chronological task_activity row, guarded by is_new_task so a retry
  -- of the same request_id never inserts a second one. An anchored
  -- (source-message) task already renders inline at that message and gains
  -- nothing from a duplicate event, so this is deliberately conditional.
  if is_new_task and created.source_message_id is null then
    insert into public.team_messages (
      request_id, conversation_id, author_profile_id, body,
      message_type, task_id, task_action
    ) values (
      gen_random_uuid(), p_conversation_id, actor_id, created.title,
      'task_activity', created.id, 'created'
    ) returning id, created_at into activity;

    update public.team_conversations
    set last_message_at = activity.created_at
    where id = p_conversation_id;
  end if;

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

-- =============================================================================
-- Slow Mode enforcement wired into the two actor-authored send paths
-- =============================================================================

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

  -- Slow Mode first: a throttled actor should never consume the anti-spam
  -- allowance below for an attempt that was refused anyway. Anti-spam stays
  -- separate and always enabled regardless of Slow Mode's own state.
  perform private.enforce_team_slow_mode(p_conversation_id, actor_id);

  perform private.consume_rate_limit('team.message.actor.minute', actor_id::text, interval '1 minute', 30);
  perform private.consume_rate_limit('team.message.actor.hour', actor_id::text, interval '1 hour', 200);

  insert into public.team_messages (request_id, conversation_id, author_profile_id, body)
  values (p_request_id, p_conversation_id, actor_id, clean_body)
  returning id, request_id, conversation_id, author_profile_id, body, created_at
  into sent;

  update public.team_conversations
  set last_message_at = sent.created_at
  where id = p_conversation_id;

  -- V2.1: ordinary chat never touches the persistent bell. An online
  -- recipient gets only the transient live-lane peek; a recipient with no
  -- fresh presence connection gets one closed delivery-ledger row, eligible
  -- 30 minutes later and collapsed into a digest on their next sync.
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

  perform private.enforce_team_slow_mode(p_conversation_id, actor_id);

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

-- Forwarding is a third actor-authored send path into a conversation and was
-- missing Slow Mode entirely in the first V2.6 draft (a Codex red-team review
-- finding): a throttled member could repeatedly forward with fresh request
-- ids and bypass the governed destination conversation's cooldown. Gated
-- against the DESTINATION conversation — that is whose Slow Mode state
-- governs whether this send is allowed, not the source's. Everything else
-- (authorization, destination membership, idempotent replay, the existing
-- anti-spam limiter, forward provenance metadata) is byte-for-byte the V2.4
-- body.
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

  perform private.enforce_team_slow_mode(p_destination_conversation_id, actor_id);

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

-- =============================================================================
-- Governance mutation RPCs
-- =============================================================================

create or replace function public.app_rename_team_conversation(
  p_conversation_id uuid,
  p_title text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'rename_conversation');
  clean_title text := btrim(coalesce(p_title, ''));
  conversation_kind text;
  previous_title text;
  actor_name text;
  activity record;
begin
  select kind, title into conversation_kind, previous_title
  from public.team_conversations where id = p_conversation_id;

  if conversation_kind <> 'group' then
    raise exception 'only a group conversation can be renamed' using errcode = '22023';
  end if;
  if clean_title = '' then
    raise exception 'group name is required' using errcode = '22023';
  end if;
  if char_length(clean_title) > 80 then
    raise exception 'group name is too long' using errcode = '22001';
  end if;

  if clean_title = previous_title then
    return jsonb_build_object('conversation_id', p_conversation_id, 'title', clean_title);
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  update public.team_conversations set title = clean_title where id = p_conversation_id;

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id,
    actor_name || ' renamed this group from "' || previous_title || '" to "' || clean_title || '"',
    'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  return jsonb_build_object('conversation_id', p_conversation_id, 'title', clean_title);
end;
$$;

revoke all on function public.app_rename_team_conversation(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_rename_team_conversation(uuid, text)
  to authenticated;

create or replace function public.app_set_team_conversation_slow_mode(
  p_conversation_id uuid,
  p_seconds integer,
  p_scope text default 'members_and_admins'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'manage_slow_mode');
  normalized_seconds integer := nullif(p_seconds, 0);
  normalized_scope text := coalesce(p_scope, 'members_and_admins');
  actor_name text;
  activity record;
  description text;
begin
  if normalized_seconds is not null and (normalized_seconds < 1 or normalized_seconds > 86400) then
    raise exception 'slow mode must be between 1 second and 24 hours' using errcode = '22023';
  end if;
  if normalized_scope not in ('members_only', 'members_and_admins') then
    raise exception 'unknown slow mode scope' using errcode = '22023';
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  update public.team_conversations
  set slow_mode_seconds = normalized_seconds,
      slow_mode_scope = normalized_scope
  where id = p_conversation_id;

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');
  description := case
    when normalized_seconds is null then actor_name || ' turned Slow Mode off'
    else actor_name || ' set Slow Mode to ' || private.team_format_slow_mode_seconds(normalized_seconds)
      || case when normalized_scope = 'members_only' then ' (members only)' else ' (members and admins)' end
  end;

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id, description, 'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'slow_mode_seconds', normalized_seconds,
    'slow_mode_scope', normalized_scope
  );
end;
$$;

revoke all on function public.app_set_team_conversation_slow_mode(uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_set_team_conversation_slow_mode(uuid, integer, text)
  to authenticated;

create or replace function public.app_set_team_task_creation_policy(
  p_conversation_id uuid,
  p_policy text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'manage_task_policy');
  actor_name text;
  activity record;
  policy_label text;
begin
  if p_policy not in ('owner_only', 'admins_and_owner', 'everyone') then
    raise exception 'unknown task creation policy' using errcode = '22023';
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  update public.team_conversations set task_creation_policy = p_policy where id = p_conversation_id;

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');
  policy_label := case p_policy
    when 'owner_only' then 'Owner only'
    when 'admins_and_owner' then 'Admins and Owner'
    else 'Everyone'
  end;

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id,
    actor_name || ' set task creation to ' || policy_label,
    'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  return jsonb_build_object('conversation_id', p_conversation_id, 'task_creation_policy', p_policy);
end;
$$;

revoke all on function public.app_set_team_task_creation_policy(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_set_team_task_creation_policy(uuid, text)
  to authenticated;

-- A delegated admin with manage_admins can grant capabilities they do not
-- themselves hold to nobody: the requested set must be a subset of their own
-- current grant. The owner is exempt from that restriction (unconditional
-- authority) and can never be a grant target (already holds everything).
create or replace function public.app_grant_team_conversation_admin(
  p_conversation_id uuid,
  p_target_profile_id uuid,
  p_capabilities jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'manage_admins');
  conversation_kind text;
  actor_is_owner boolean;
  actor_admin record;
  want_manage_members boolean := coalesce((p_capabilities ->> 'manage_members')::boolean, false);
  want_manage_admins boolean := coalesce((p_capabilities ->> 'manage_admins')::boolean, false);
  want_manage_slow_mode boolean := coalesce((p_capabilities ->> 'manage_slow_mode')::boolean, false);
  want_rename_conversation boolean := coalesce((p_capabilities ->> 'rename_conversation')::boolean, false);
  want_manage_task_policy boolean := coalesce((p_capabilities ->> 'manage_task_policy')::boolean, false);
  actor_name text;
  target_name text;
  granted_labels text[];
  activity record;
begin
  select kind into conversation_kind from public.team_conversations where id = p_conversation_id;
  if conversation_kind <> 'group' then
    raise exception 'delegated admin roles are a group conversation feature' using errcode = '22023';
  end if;

  if not private.team_is_conversation_member(p_conversation_id, p_target_profile_id) then
    raise exception 'the target must be a member of this conversation' using errcode = '22023';
  end if;

  if private.team_conversation_is_owner(p_conversation_id, p_target_profile_id) then
    raise exception 'the conversation owner already holds full authority' using errcode = '22023';
  end if;

  if not (want_manage_members or want_manage_admins or want_manage_slow_mode
    or want_rename_conversation or want_manage_task_policy) then
    raise exception 'grant at least one capability' using errcode = '22023';
  end if;

  actor_is_owner := private.team_conversation_is_owner(p_conversation_id, actor_id);

  if not actor_is_owner then
    select * into actor_admin
    from public.team_conversation_admins
    where conversation_id = p_conversation_id and profile_id = actor_id;

    if (want_manage_members and not coalesce(actor_admin.can_manage_members, false))
      or (want_manage_admins and not coalesce(actor_admin.can_manage_admins, false))
      or (want_manage_slow_mode and not coalesce(actor_admin.can_manage_slow_mode, false))
      or (want_rename_conversation and not coalesce(actor_admin.can_rename_conversation, false))
      or (want_manage_task_policy and not coalesce(actor_admin.can_manage_task_policy, false))
    then
      raise exception 'a delegated admin cannot grant a capability they do not hold themselves'
        using errcode = '42501';
    end if;
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  insert into public.team_conversation_admins as admin_row (
    conversation_id, profile_id, can_manage_members, can_manage_admins,
    can_manage_slow_mode, can_rename_conversation, can_manage_task_policy,
    granted_by_profile_id
  ) values (
    p_conversation_id, p_target_profile_id, want_manage_members, want_manage_admins,
    want_manage_slow_mode, want_rename_conversation, want_manage_task_policy, actor_id
  )
  on conflict (conversation_id, profile_id) do update
    set can_manage_members = excluded.can_manage_members,
        can_manage_admins = excluded.can_manage_admins,
        can_manage_slow_mode = excluded.can_manage_slow_mode,
        can_rename_conversation = excluded.can_rename_conversation,
        can_manage_task_policy = excluded.can_manage_task_policy,
        granted_by_profile_id = excluded.granted_by_profile_id,
        granted_at = clock_timestamp();

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');
  target_name := coalesce((select display_name from public.profiles where id = p_target_profile_id), 'a teammate');

  granted_labels := array_remove(array[
    case when want_manage_members then 'Manage members' end,
    case when want_manage_admins then 'Manage admins' end,
    case when want_manage_slow_mode then 'Slow Mode' end,
    case when want_rename_conversation then 'Rename' end,
    case when want_manage_task_policy then 'Task policy' end
  ], null);

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id,
    actor_name || ' made ' || target_name || ' an admin (' || array_to_string(granted_labels, ', ') || ')',
    'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  if p_target_profile_id <> actor_id then
    perform private.emit_team_notification(
      p_target_profile_id,
      'team-admin-granted:' || p_conversation_id::text || ':' || activity.id::text,
      actor_name || ' made you an admin',
      'You can now ' || lower(array_to_string(granted_labels, ', ')) || ' in this conversation.',
      '/dashboard?team-messages=' || p_conversation_id::text,
      'team_conversation', p_conversation_id, actor_id
    );
  end if;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'profile_id', p_target_profile_id,
    'can_manage_members', want_manage_members,
    'can_manage_admins', want_manage_admins,
    'can_manage_slow_mode', want_manage_slow_mode,
    'can_rename_conversation', want_rename_conversation,
    'can_manage_task_policy', want_manage_task_policy
  );
end;
$$;

revoke all on function public.app_grant_team_conversation_admin(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.app_grant_team_conversation_admin(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.app_revoke_team_conversation_admin(
  p_conversation_id uuid,
  p_target_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'manage_admins');
  removed boolean;
  actor_name text;
  target_name text;
  activity record;
begin
  delete from public.team_conversation_admins
  where conversation_id = p_conversation_id and profile_id = p_target_profile_id
  returning true into removed;

  if removed is null then
    raise exception 'that teammate does not hold a delegated admin role here' using errcode = '22023';
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');
  target_name := coalesce((select display_name from public.profiles where id = p_target_profile_id), 'a teammate');

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id,
    actor_name || ' removed ' || target_name || ' as an admin',
    'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  return jsonb_build_object('conversation_id', p_conversation_id, 'profile_id', p_target_profile_id);
end;
$$;

revoke all on function public.app_revoke_team_conversation_admin(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_revoke_team_conversation_admin(uuid, uuid)
  to authenticated;

create or replace function public.app_add_team_conversation_member(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'manage_members');
  conversation_kind text;
  conversation_title text;
  actor_name text;
  activity record;
begin
  select kind, title into conversation_kind, conversation_title
  from public.team_conversations where id = p_conversation_id;

  if conversation_kind <> 'group' then
    raise exception 'members can only be added to a group conversation' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles as profile_row
    where profile_row.id = p_profile_id
      and profile_row.archived_at is null
      and private.profile_account_class(profile_row.id) = 'internal'
      and private.profile_has_permission(profile_row.id, 'team_messages.use')
  ) then
    raise exception 'every group member must be an active internal teammate' using errcode = '22023';
  end if;

  if private.team_is_conversation_member(p_conversation_id, p_profile_id) then
    raise exception 'that teammate is already a member of this conversation' using errcode = '22023';
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  insert into public.team_conversation_members (conversation_id, profile_id)
  values (p_conversation_id, p_profile_id);

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id,
    actor_name || ' added ' ||
      coalesce((select display_name from public.profiles where id = p_profile_id), 'a teammate') ||
      ' to the group',
    'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  perform private.emit_team_notification(
    p_profile_id,
    'team-group-created:' || p_conversation_id::text || ':' || p_profile_id::text || ':' || activity.id::text,
    actor_name || ' added you to ' || coalesce(conversation_title, 'a group'),
    coalesce(conversation_title, 'Team group'),
    '/dashboard?team-messages=' || p_conversation_id::text,
    'team_conversation', p_conversation_id, actor_id
  );

  return jsonb_build_object('conversation_id', p_conversation_id, 'profile_id', p_profile_id);
end;
$$;

revoke all on function public.app_add_team_conversation_member(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_add_team_conversation_member(uuid, uuid)
  to authenticated;

create or replace function public.app_remove_team_conversation_member(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_capability(p_conversation_id, 'manage_members');
  conversation_kind text;
  actor_name text;
  target_name text;
  activity record;
  removed boolean;
begin
  select kind into conversation_kind from public.team_conversations where id = p_conversation_id;

  if conversation_kind <> 'group' then
    raise exception 'members can only be removed from a group conversation' using errcode = '22023';
  end if;

  if private.team_conversation_is_owner(p_conversation_id, p_profile_id) then
    raise exception 'the conversation owner cannot be removed' using errcode = '22023';
  end if;

  -- Fail closed: removing an ORDINARY member needs only manage_members (the
  -- capability that already gated entry above), but removing a DELEGATED
  -- ADMIN also deletes their admin grant as a side effect, so it must not be
  -- reachable with manage_members alone — that would let a narrowly-scoped
  -- admin eject a more broadly-scoped one without ever holding manage_admins.
  -- The owner is unaffected (already bypasses every capability check).
  if exists (
    select 1 from public.team_conversation_admins
    where conversation_id = p_conversation_id and profile_id = p_profile_id
  ) and not private.team_conversation_has_capability(p_conversation_id, actor_id, 'manage_admins') then
    raise exception 'removing a delegated admin also requires manage_admins'
      using errcode = '42501';
  end if;

  perform private.consume_rate_limit('team.governance.actor.minute', actor_id::text, interval '1 minute', 20);

  delete from public.team_conversation_members
  where conversation_id = p_conversation_id and profile_id = p_profile_id
  returning true into removed;

  if removed is null then
    raise exception 'that teammate is not a member of this conversation' using errcode = '22023';
  end if;

  delete from public.team_conversation_admins
  where conversation_id = p_conversation_id and profile_id = p_profile_id;

  actor_name := coalesce((select display_name from public.profiles where id = actor_id), 'A colleague');
  target_name := coalesce((select display_name from public.profiles where id = p_profile_id), 'a teammate');

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type
  ) values (
    gen_random_uuid(), p_conversation_id, actor_id,
    actor_name || ' removed ' || target_name || ' from the group',
    'governance_activity'
  ) returning id, created_at into activity;

  update public.team_conversations set last_message_at = activity.created_at where id = p_conversation_id;

  perform private.emit_team_notification(
    p_profile_id,
    'team-member-removed:' || p_conversation_id::text || ':' || activity.id::text,
    actor_name || ' removed you from a group',
    'You no longer have access to this Team conversation.',
    '/dashboard',
    'team_conversation', p_conversation_id, actor_id
  );

  return jsonb_build_object('conversation_id', p_conversation_id, 'profile_id', p_profile_id);
end;
$$;

revoke all on function public.app_remove_team_conversation_member(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_remove_team_conversation_member(uuid, uuid)
  to authenticated;

-- =============================================================================
-- Audit integrity: system activity rows cannot be tombstoned through the
-- ordinary delete-for-everyone action. The V2.4 RPC authorized this purely by
-- author id; a governance_activity (and task_activity) row's "author" is
-- whichever actor performed that mutation/event, so without this they could
-- delete-for-everyone their own audit trail entry through the existing
-- message-delete surface. UI never offers the control on an activity row
-- (team-message-actions.tsx only wires it to ordinary text bubbles), but the
-- RPC itself must fail closed regardless of what the UI happens to expose.
-- Ordinary author-owned text messages keep their exact V2.4 behavior.
-- =============================================================================

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
    message.deleted_for_everyone_at, message.message_type
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

  if source_message.message_type <> 'text' then
    raise exception 'system activity messages cannot be deleted' using errcode = '22023';
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

-- =============================================================================
-- Read model: fold governance state into the existing conversation detail RPC
-- rather than adding a second one. app_team_live_sync already recomputes
-- app_get_team_conversation for the open thread on every tick, so governance
-- changes propagate live with no extra plumbing.
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
  my_next_allowed_at timestamptz;
begin
  select * into conversation
  from public.team_conversations
  where id = p_conversation_id;

  -- A stored cooldown row is historical fact, not current truth: Slow Mode
  -- may since have been turned off, or this actor may since have become
  -- exempt (promoted to admin under members_only, or the scope changed).
  -- private.team_conversation_slow_mode_applies is the same live check
  -- private.enforce_team_slow_mode itself uses, so the two can never
  -- disagree about who is currently subject to Slow Mode.
  if private.team_conversation_slow_mode_applies(p_conversation_id, actor_id) then
    select next_allowed_at into my_next_allowed_at
    from private.team_slow_mode_cooldowns
    where conversation_id = p_conversation_id and profile_id = actor_id;
  end if;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'conversation_kind', conversation.kind,
    'conversation_title', conversation.title,
    'owner_profile_id', conversation.created_by_profile_id,
    'slow_mode_seconds', conversation.slow_mode_seconds,
    'slow_mode_scope', conversation.slow_mode_scope,
    'task_creation_policy', conversation.task_creation_policy,
    'my_next_allowed_send_at',
      case when my_next_allowed_at is not null and my_next_allowed_at > clock_timestamp()
        then my_next_allowed_at else null end,
    'my_capabilities', jsonb_build_object(
      'is_owner', private.team_conversation_is_owner(p_conversation_id, actor_id),
      'can_create_task', private.team_conversation_task_creation_allowed(p_conversation_id, actor_id),
      'can_manage_members', private.team_conversation_has_capability(p_conversation_id, actor_id, 'manage_members'),
      'can_manage_admins', private.team_conversation_has_capability(p_conversation_id, actor_id, 'manage_admins'),
      'can_manage_slow_mode', private.team_conversation_has_capability(p_conversation_id, actor_id, 'manage_slow_mode'),
      'can_rename_conversation', private.team_conversation_has_capability(p_conversation_id, actor_id, 'rename_conversation'),
      'can_manage_task_policy', private.team_conversation_has_capability(p_conversation_id, actor_id, 'manage_task_policy')
    ),
    'admins', (
      select coalesce(jsonb_agg(admin_row order by admin_row.display_name, admin_row.profile_id), '[]'::jsonb)
      from (
        select
          profile_row.id as profile_id, profile_row.display_name, profile_row.avatar_url,
          admin.can_manage_members, admin.can_manage_admins, admin.can_manage_slow_mode,
          admin.can_rename_conversation, admin.can_manage_task_policy
        from public.team_conversation_admins as admin
        join public.profiles as profile_row on profile_row.id = admin.profile_id
        where admin.conversation_id = p_conversation_id
          and profile_row.archived_at is null
      ) as admin_row
    ),
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

-- =============================================================================
-- Preview text: teach the two "latest message" projections about 'created',
-- the only new task_action. Both are otherwise byte-identical to their prior
-- definitions; without this a composer-created task's preview would fall
-- into the existing CASE's ELSE branch and misreport itself as "reopened".
-- =============================================================================

create or replace function public.app_list_team_conversations()
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
          when 'created' then ' created "' || private.team_message_plain_text(latest.body) || '"'
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

-- Restored to the true final pre-V2.6 body (20260827010000_team_message_
-- actions.sql), which itself superseded 20260826220000's original — a Codex
-- red-team review caught that the first V2.6 draft of this function had
-- silently based itself on the OLDER, superseded definition instead, which
-- would have regressed: hidden/tombstoned-message filtering in unread totals
-- and the "latest message" lookup, the 'Message deleted' preview priority,
-- `my_last_read_at`/`destination_search_text` in signals, and the
-- `greatest(last_message_at, updated_at)` delta watermark (a plain
-- `last_message_at > since` check misses a conversation whose only change
-- since the caller's cursor was a metadata update, e.g. a rename, that
-- V2.6 itself now makes possible). The only genuine V2.6 addition is the
-- 'created' branch in the task_activity preview case.
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
                when 'created' then ' created "' || private.team_message_plain_text(latest.body) || '"'
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
  from public, anon, service_role;
grant execute on function public.app_team_live_sync(uuid, timestamptz)
  to authenticated;
