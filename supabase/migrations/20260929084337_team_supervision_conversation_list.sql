-- Team supervision conversation metadata list only.
-- Transcript/content reads remain unavailable.

create function public.app_list_team_supervised_conversations(
  p_limit integer default 50,
  p_before_last_message_at timestamptz default null,
  p_before_conversation_id uuid default null
)
returns table (
  conversation_id uuid,
  conversation_kind text,
  created_at timestamptz,
  last_message_at timestamptz,
  participant_one_profile_id uuid,
  participant_one_name text,
  participant_one_avatar_url text,
  participant_one_archived boolean,
  participant_two_profile_id uuid,
  participant_two_name text,
  participant_two_avatar_url text,
  participant_two_archived boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform private.require_team_supervisor();

  if p_before_conversation_id is null and p_before_last_message_at is not null then
    raise exception 'conversation cursor id is required with a timestamp cursor'
      using errcode = '22023';
  end if;

  return query
  with eligible as (
    select
      conversation_row.id,
      conversation_row.kind,
      conversation_row.created_at,
      conversation_row.last_message_at,
      (array_agg(profile_row.id order by profile_row.id))[1] as first_id,
      (array_agg(profile_row.display_name order by profile_row.id))[1] as first_name,
      (array_agg(profile_row.avatar_url order by profile_row.id))[1] as first_avatar_url,
      (array_agg(profile_row.archived_at is not null order by profile_row.id))[1] as first_archived,
      (array_agg(profile_row.id order by profile_row.id))[2] as second_id,
      (array_agg(profile_row.display_name order by profile_row.id))[2] as second_name,
      (array_agg(profile_row.avatar_url order by profile_row.id))[2] as second_avatar_url,
      (array_agg(profile_row.archived_at is not null order by profile_row.id))[2] as second_archived
    from public.team_conversations as conversation_row
    join public.team_conversation_members as member_row
      on member_row.conversation_id = conversation_row.id
    join public.profiles as profile_row
      on profile_row.id = member_row.profile_id
    join public.permission_presets as preset_row
      on preset_row.role_id = profile_row.role_id
    where conversation_row.kind = 'direct'
    group by
      conversation_row.id,
      conversation_row.kind,
      conversation_row.created_at,
      conversation_row.last_message_at,
      conversation_row.conversation_key
    having count(*) = 2
      and bool_and(preset_row.account_class = 'internal')
      and conversation_row.conversation_key =
        (array_agg(profile_row.id::text order by profile_row.id))[1]
        || '|'
        || (array_agg(profile_row.id::text order by profile_row.id))[2]
  )
  select
    eligible.id,
    eligible.kind,
    eligible.created_at,
    eligible.last_message_at,
    eligible.first_id,
    eligible.first_name,
    eligible.first_avatar_url,
    eligible.first_archived,
    eligible.second_id,
    eligible.second_name,
    eligible.second_avatar_url,
    eligible.second_archived
  from eligible
  where p_before_conversation_id is null
     or (
       p_before_last_message_at is not null
       and (
         eligible.last_message_at < p_before_last_message_at
         or (
           eligible.last_message_at = p_before_last_message_at
           and eligible.id < p_before_conversation_id
         )
         or eligible.last_message_at is null
       )
     )
     or (
       p_before_last_message_at is null
       and eligible.last_message_at is null
       and eligible.id < p_before_conversation_id
     )
  order by eligible.last_message_at desc nulls last, eligible.id desc
  limit effective_limit;
end;
$$;

revoke all on function public.app_list_team_supervised_conversations(integer, timestamptz, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.app_list_team_supervised_conversations(integer, timestamptz, uuid)
to authenticated;

comment on function public.app_list_team_supervised_conversations(integer, timestamptz, uuid)
is 'Lists bounded metadata for valid internal direct Team conversations. It returns no message or participant state and has no side effects.';
