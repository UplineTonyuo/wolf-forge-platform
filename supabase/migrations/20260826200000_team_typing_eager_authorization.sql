-- =============================================================================
-- Team typing — make the membership check unconditional
--
-- Forward correction to 20260826190000_team_communication_v2.sql, which is
-- already applied. Nothing is dropped and no shape changes: only the body of
-- app_list_team_typing is replaced.
--
-- THE DEFECT. The function was written as `language sql` with its
-- authorization inside a CTE:
--
--     with actor as (select private.require_team_conversation_member(...) )
--     select ... from public.team_typing_connections as typing
--     cross join actor
--     where typing.conversation_id = ... and typing.profile_id <> actor.actor_id
--
-- A CTE joined into a scan is only evaluated if the scan produces rows. When
-- no one in the conversation is currently typing — the common case, since
-- typing rows live for about three seconds — the table scan returns nothing,
-- the join short-circuits, and `require_team_conversation_member` is never
-- called. A non-member, including a client account, then received an empty
-- result instead of the intended 42501.
--
-- No data was reachable either way: an unauthorized caller got the same empty
-- set the refusal would have produced, and the sibling read models
-- (app_list_team_conversations, app_list_my_team_tasks, app_team_unread_count)
-- scan tables that are never empty in practice and refuse correctly. But an
-- authorization gate whose firing depends on whether rows happen to exist is
-- not a gate. Every other team RPC derives and validates its actor before
-- touching a table, and this one now does too.
--
-- THE FIX. plpgsql with the actor resolved in the declaration block, which is
-- the shape app_get_team_conversation already uses: the check runs on entry,
-- unconditionally, before any scan is planned.
-- =============================================================================

create or replace function public.app_list_team_typing(
  p_conversation_id uuid
)
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text,
  last_typed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Resolved before the query below is reached, so the refusal cannot depend
  -- on whether the typing table currently holds a matching row.
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
begin
  return query
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
  order by max(typing.last_typed_at) desc, typing.profile_id;
end;
$$;

revoke all on function public.app_list_team_typing(uuid)
  from public, anon;
grant execute on function public.app_list_team_typing(uuid)
  to authenticated;

comment on function public.app_list_team_typing(uuid) is
  'Fresh typing state for one conversation. Membership is checked on entry, not lazily inside the scan.';
