-- Team Communication V2.2 — one cheap read for the latency-sensitive path.
--
-- V2.1 answered "is anyone typing?" and "did a message arrive?" from the same
-- round trip that rebuilt the conversation list, the roster, the task lists and
-- the digest materializer. On loopback that coupling is invisible; from a
-- serverless function to a hosted project every one of those reads is a network
-- round trip, and the fast question waits behind all of them.
--
-- app_team_live_sync answers only the fast questions, in ONE call:
--   * the open conversation, including its typing state
--   * conversations that have changed since the caller's own last answer
--   * the unread badge total
--
-- It is forward-only after 20260826210000 and rewrites nothing. Authorization
-- is unchanged and is not this function's to grant: private.require_team_actor()
-- refuses any account that is not an internal member holding team_messages.use,
-- app_get_team_conversation re-checks membership of the requested thread, and
-- the delta below is scoped by the caller's own membership rows. The actor is
-- always auth.uid(); no parameter names a subject.

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
  -- A caller with no cursor yet is given a short look-back rather than the
  -- whole history: enough to survive one dropped answer, far short of a
  -- conversation list rebuild.
  since timestamptz := coalesce(p_since, clock_timestamp() - interval '30 seconds');
  captured_at timestamptz := clock_timestamp();
begin
  return jsonb_build_object(
    'server_time', captured_at,
    -- Delegated rather than reimplemented, so the open thread cannot drift
    -- from what the conversation view already renders.
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
      ))::integer, 0)
      from public.team_conversation_members as my_member
      where my_member.profile_id = actor_id
    ),
    -- Normally empty. Only conversations that actually moved since the caller's
    -- previous answer are described, which is what makes a one-second cadence
    -- affordable while the drawer is shut.
    'signals', (
      select coalesce(jsonb_agg(signal order by signal.last_message_at desc), '[]'::jsonb)
      from (
        select
          conversation_row.id as conversation_id,
          conversation_row.kind as conversation_kind,
          conversation_row.title as conversation_title,
          (select count(*)::integer
             from public.team_conversation_members as counted
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
            when latest.message_type = 'task_activity' then
              coalesce(latest.author_name, 'A colleague') ||
              case latest.task_action
                when 'completed' then ' completed "' || private.team_message_plain_text(latest.body) || '"'
                else ' reopened "' || private.team_message_plain_text(latest.body) || '"'
              end
            else private.team_message_plain_text(latest.body)
          end as last_message_preview,
          conversation_row.last_message_at,
          (
            select count(*)::integer
            from public.team_messages as unread_message
            where unread_message.conversation_id = conversation_row.id
              and unread_message.author_profile_id <> actor_id
              and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
          ) as unread_count
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
        where my_member.profile_id = actor_id
          and conversation_row.last_message_at is not null
          and conversation_row.last_message_at > since
      ) as signal
    )
  );
end;
$$;

revoke all on function public.app_team_live_sync(uuid, timestamptz)
  from public, anon, service_role;
grant execute on function public.app_team_live_sync(uuid, timestamptz)
  to authenticated;

-- The delta is "my conversations, ordered by when they last moved". Without
-- this the planner sorts every membership row on every tick, which is the one
-- read frequent enough for that to matter.
create index if not exists team_conversations_last_message_at_idx
  on public.team_conversations (last_message_at desc nulls last);
