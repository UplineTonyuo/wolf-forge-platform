-- WL-2.17 (KI-121): Team supervision is bound to the current Tenant.
--
-- Team Chat tables have no tenant_id. A direct conversation belongs to a
-- Tenant through its participants: it is supervisable only when it has exactly
-- two members and BOTH have an internal membership (active or archived) in the
-- caller's current Tenant. Participant classification moves from the global
-- profiles.role_id preset to that Tenant membership.
--
-- Before: require_team_supervisor() (Tenant-relative actor + capability) was
-- followed by Team reads with no Tenant predicate, so a Tenant B supervisor
-- listed Wolf Forge staff direct conversations and read their message bodies.
--
-- After: every supervision RPC routes through the same predicate — the list
-- inline, and open / page / window / search through
-- private.team_supervision_direct_conversation(), which gates all message,
-- reaction and audit reads. A foreign conversation fails exactly like a
-- missing one (no existence oracle). current_tenant_id() is NULL on any
-- selector failure, which matches nothing.
--
-- The participant 'archived' flag is the current Tenant membership's, so one
-- Tenant never sees another Tenant's archive state.
--
-- Wolf Forge behavior is unchanged: the WF membership mirrors profiles.role_id
-- and archived_at, so the same staff-to-staff conversations qualify, archived
-- participants included, with the same archived flag.

create or replace function private.team_supervision_direct_conversation(p_conversation_id uuid)
returns table (
  conversation_id uuid,
  conversation_kind text,
  created_at timestamptz,
  last_message_at timestamptz,
  participants jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation_row.id as conversation_id,
    conversation_row.kind as conversation_kind,
    conversation_row.created_at,
    conversation_row.last_message_at,
    jsonb_agg(
      jsonb_build_object(
        'profile_id', profile_row.id,
        'display_name', profile_row.display_name,
        'avatar_url', profile_row.avatar_url,
        'archived', membership_row.archived_at is not null
      ) order by profile_row.id
    ) as participants
  from public.team_conversations as conversation_row
  join public.team_conversation_members as member_row
    on member_row.conversation_id = conversation_row.id
  join public.profiles as profile_row
    on profile_row.id = member_row.profile_id
  left join public.tenant_memberships as membership_row
    on membership_row.profile_id = profile_row.id
   and membership_row.tenant_id = (select private.current_tenant_id())
  where conversation_row.id = p_conversation_id
    and conversation_row.kind = 'direct'
  group by
    conversation_row.id,
    conversation_row.kind,
    conversation_row.created_at,
    conversation_row.last_message_at,
    conversation_row.conversation_key
  having count(*) = 2
    and count(*) filter (where membership_row.account_class = 'internal') = 2
    and conversation_row.conversation_key =
      (array_agg(profile_row.id::text order by profile_row.id))[1]
      || '|'
      || (array_agg(profile_row.id::text order by profile_row.id))[2];
$$;

create or replace function public.app_list_team_supervised_conversations(
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
      (array_agg(membership_row.archived_at is not null order by profile_row.id))[1] as first_archived,
      (array_agg(profile_row.id order by profile_row.id))[2] as second_id,
      (array_agg(profile_row.display_name order by profile_row.id))[2] as second_name,
      (array_agg(profile_row.avatar_url order by profile_row.id))[2] as second_avatar_url,
      (array_agg(membership_row.archived_at is not null order by profile_row.id))[2] as second_archived
    from public.team_conversations as conversation_row
    join public.team_conversation_members as member_row
      on member_row.conversation_id = conversation_row.id
    join public.profiles as profile_row
      on profile_row.id = member_row.profile_id
    left join public.tenant_memberships as membership_row
      on membership_row.profile_id = profile_row.id
     and membership_row.tenant_id = (select private.current_tenant_id())
    where conversation_row.kind = 'direct'
    group by
      conversation_row.id,
      conversation_row.kind,
      conversation_row.created_at,
      conversation_row.last_message_at,
      conversation_row.conversation_key
    having count(*) = 2
      and count(*) filter (where membership_row.account_class = 'internal') = 2
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
