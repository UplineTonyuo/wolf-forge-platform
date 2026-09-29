-- Team supervision transcript history and target windows.
-- Supervisors remain non-members and receive the same neutral message shape as
-- the approved transcript detail RPC. No Team table or participant read path
-- is widened by this migration.

-- Keep the exact direct-conversation boundary in one private helper so every
-- supervisory content-read RPC validates the same database-derived shape.
create function private.team_supervision_direct_conversation(
  p_conversation_id uuid
)
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
        'archived', profile_row.archived_at is not null
      ) order by profile_row.id
    ) as participants
  from public.team_conversations as conversation_row
  join public.team_conversation_members as member_row
    on member_row.conversation_id = conversation_row.id
  join public.profiles as profile_row
    on profile_row.id = member_row.profile_id
  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  where conversation_row.id = p_conversation_id
    and conversation_row.kind = 'direct'
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
      || (array_agg(profile_row.id::text order by profile_row.id))[2];
$$;

revoke all on function private.team_supervision_direct_conversation(uuid)
from public, anon, authenticated, service_role;

-- One canonical neutral message projection for detail, history and windows.
-- It deliberately does not read participant hidden rows, state, capabilities,
-- source identifiers, or voice storage metadata.
create function private.team_supervision_message_json(
  p_message_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with source as (
  select
    message_row.id,
    message_row.author_profile_id,
    author_row.display_name as author_name,
    author_row.avatar_url as author_avatar_url,
    author_row.archived_at is not null as author_archived,
    message_row.body,
    message_row.message_type,
    message_row.created_at,
    message_row.reply_to_message_id,
    message_row.reply_quote_text,
    reply_row.author_profile_id as reply_author_profile_id,
    reply_author.display_name as reply_author_name,
    reply_author.avatar_url as reply_author_avatar_url,
    reply_row.message_type as reply_message_type,
    reply_row.deleted_for_everyone_at as reply_deleted_at,
    message_row.forwarded_from_message_id,
    message_row.forwarded_from_ticket_message_id,
    message_row.forwarded_from_author_name,
    message_row.deleted_for_everyone_at,
    message_row.deleted_for_everyone_by,
    deleter_row.display_name as deleted_by_name
  from public.team_messages as message_row
  join public.profiles as author_row
    on author_row.id = message_row.author_profile_id
  left join public.team_messages as reply_row
    on reply_row.id = message_row.reply_to_message_id
  left join public.profiles as reply_author
    on reply_author.id = reply_row.author_profile_id
  left join public.profiles as deleter_row
    on deleter_row.id = message_row.deleted_for_everyone_by
  where message_row.id = p_message_id
), projected as (
  select
    source.id as message_id,
    source.author_profile_id,
    source.author_name,
    source.author_avatar_url,
    source.author_archived,
    case
      when source.deleted_for_everyone_at is not null then 'Message deleted'
      when source.message_type = 'voice' then 'Voice message'
      else source.body
    end as body,
    source.message_type,
    source.created_at,
    case
      when source.deleted_for_everyone_at is not null
        or source.reply_to_message_id is null then null
      else jsonb_build_object(
        'message_id', source.reply_to_message_id,
        'author_profile_id', source.reply_author_profile_id,
        'author_name', source.reply_author_name,
        'author_avatar_url', source.reply_author_avatar_url,
        'body', case
          when source.reply_deleted_at is not null then 'Message deleted'
          when source.reply_message_type = 'voice' then 'Voice message'
          else source.reply_quote_text
        end,
        'message_type', source.reply_message_type,
        'deleted_for_everyone', source.reply_deleted_at is not null
      )
    end as reply,
    case
      when source.deleted_for_everyone_at is not null then false
      else source.forwarded_from_message_id is not null
        or source.forwarded_from_ticket_message_id is not null
    end as forwarded,
    case when source.deleted_for_everyone_at is null
      then source.forwarded_from_author_name else null end as forwarded_from_author_name,
    source.deleted_for_everyone_at is not null as deleted_for_everyone,
    source.deleted_for_everyone_at,
    source.deleted_for_everyone_by as deleted_by_profile_id,
    source.deleted_by_name,
    case
      when source.message_type = 'voice'
        and source.deleted_for_everyone_at is null
      then 'Unavailable in supervisory view'
      else null
    end as supervisory_notice,
    case
      when source.deleted_for_everyone_at is not null then '[]'::jsonb
      else (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'reaction_code', reaction_count.reaction_code,
              'reaction_count', reaction_count.reaction_count
            ) order by reaction_count.reaction_code
          ),
          '[]'::jsonb
        )
        from (
          select reaction_row.reaction_code, count(*)::integer as reaction_count
          from public.team_message_reactions as reaction_row
          where reaction_row.message_id = source.id
            and reaction_row.active
          group by reaction_row.reaction_code
        ) as reaction_count
      )
    end as reactions
  from source
)
select to_jsonb(projected)
from projected;
$$;

revoke all on function private.team_supervision_message_json(uuid)
from public, anon, authenticated, service_role;

-- Rebind the existing detail boundary to the shared private projection. The
-- response, OPEN audit, authorization and bounds remain unchanged.
create or replace function public.app_get_team_supervised_conversation(
  p_conversation_id uuid,
  p_limit integer default 50,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  conversation_record record;
  transcript_result jsonb;
  result_count integer;
begin
  perform private.require_team_supervisor();

  select *
  into conversation_record
  from private.team_supervision_direct_conversation(p_conversation_id);

  if not found then
    raise exception 'team conversation unavailable' using errcode = 'P0002';
  end if;

  with candidates as (
    select message_row.id, message_row.created_at
    from public.team_messages as message_row
    where message_row.conversation_id = p_conversation_id
    order by message_row.created_at desc, message_row.id desc
    limit effective_limit + 1
  ), page as (
    select *
    from candidates
    order by created_at desc, id desc
    limit effective_limit
  )
  select jsonb_build_object(
    'conversation_id', conversation_record.conversation_id,
    'conversation_kind', conversation_record.conversation_kind,
    'created_at', conversation_record.created_at,
    'last_message_at', conversation_record.last_message_at,
    'participants', conversation_record.participants,
    'messages', (
      select coalesce(
        jsonb_agg(
          private.team_supervision_message_json(page_row.id)
          order by page_row.created_at, page_row.id
        ),
        '[]'::jsonb
      )
      from page as page_row
    ),
    'has_more', (select count(*) > effective_limit from candidates),
    'next_before_created_at', case
      when (select count(*) > effective_limit from candidates)
      then (select page_row.created_at from page as page_row order by page_row.created_at, page_row.id limit 1)
      else null
    end,
    'next_before_message_id', case
      when (select count(*) > effective_limit from candidates)
      then (select page_row.id from page as page_row order by page_row.created_at, page_row.id limit 1)
      else null
    end
  ), (select count(*)::integer from page)
  into transcript_result, result_count;

  perform private.write_team_supervision_audit(
    'team.supervision.open',
    p_conversation_id,
    result_count,
    p_correlation_id
  );

  return transcript_result;
end;
$$;

revoke all on function public.app_get_team_supervised_conversation(uuid, integer, text)
from public, anon, authenticated, service_role;

grant execute on function public.app_get_team_supervised_conversation(uuid, integer, text)
to authenticated;

comment on function public.app_get_team_supervised_conversation(uuid, integer, text)
is 'Returns one bounded neutral transcript page for a valid internal direct Team conversation and appends exactly one successful supervision-open audit event.';

-- Load older supervisory messages using the exact cursor emitted by detail:
-- strict tuple ordering, newest-first selection, oldest-first response.
create function public.app_list_team_supervised_messages_before(
  p_conversation_id uuid,
  p_before_created_at timestamptz,
  p_before_message_id uuid,
  p_limit integer default 50,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  conversation_record record;
  transcript_result jsonb;
  result_count integer;
begin
  perform private.require_team_supervisor();

  if p_before_created_at is null or p_before_message_id is null then
    raise exception 'message cursor requires created_at and message_id'
      using errcode = '22023';
  end if;

  if p_correlation_id is not null
    and p_correlation_id !~ '^[0-9a-f]{32}$'
  then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;

  select *
  into conversation_record
  from private.team_supervision_direct_conversation(p_conversation_id);

  if not found then
    raise exception 'team conversation unavailable' using errcode = 'P0002';
  end if;

  with candidates as (
    select message_row.id, message_row.created_at
    from public.team_messages as message_row
    where message_row.conversation_id = p_conversation_id
      and (message_row.created_at, message_row.id)
        < (p_before_created_at, p_before_message_id)
    order by message_row.created_at desc, message_row.id desc
    limit effective_limit + 1
  ), page as (
    select *
    from candidates
    order by created_at desc, id desc
    limit effective_limit
  )
  select jsonb_build_object(
    'conversation_id', conversation_record.conversation_id,
    'conversation_kind', conversation_record.conversation_kind,
    'created_at', conversation_record.created_at,
    'last_message_at', conversation_record.last_message_at,
    'participants', conversation_record.participants,
    'messages', (
      select coalesce(
        jsonb_agg(
          private.team_supervision_message_json(page_row.id)
          order by page_row.created_at, page_row.id
        ),
        '[]'::jsonb
      )
      from page as page_row
    ),
    'has_more', (select count(*) > effective_limit from candidates),
    'next_before_created_at', case
      when (select count(*) > effective_limit from candidates)
      then (select page_row.created_at from page as page_row order by page_row.created_at, page_row.id limit 1)
      else null
    end,
    'next_before_message_id', case
      when (select count(*) > effective_limit from candidates)
      then (select page_row.id from page as page_row order by page_row.created_at, page_row.id limit 1)
      else null
    end
  ), (select count(*)::integer from page)
  into transcript_result, result_count;

  perform private.write_team_supervision_audit(
    'team.supervision.page',
    p_conversation_id,
    result_count,
    p_correlation_id
  );

  return transcript_result;
end;
$$;

revoke all on function public.app_list_team_supervised_messages_before(uuid, timestamptz, uuid, integer, text)
from public, anon, authenticated, service_role;

grant execute on function public.app_list_team_supervised_messages_before(uuid, timestamptz, uuid, integer, text)
to authenticated;

comment on function public.app_list_team_supervised_messages_before(uuid, timestamptz, uuid, integer, text)
is 'Returns one bounded chronological page strictly before a detail cursor for a valid internal direct Team conversation and appends one successful supervision-page audit event.';

-- Return a bounded chronological window around a target. Before and after
-- limits mean the number of messages on each side; the target is included.
create function public.app_get_team_supervised_message_window(
  p_conversation_id uuid,
  p_target_message_id uuid,
  p_before_limit integer default 25,
  p_after_limit integer default 25,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_before_limit integer := least(greatest(coalesce(p_before_limit, 25), 0), 100);
  effective_after_limit integer := least(greatest(coalesce(p_after_limit, 25), 0), 100);
  conversation_record record;
  target record;
  window_result jsonb;
  result_count integer;
begin
  perform private.require_team_supervisor();

  if p_correlation_id is not null
    and p_correlation_id !~ '^[0-9a-f]{32}$'
  then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;

  select *
  into conversation_record
  from private.team_supervision_direct_conversation(p_conversation_id);

  if not found then
    raise exception 'team conversation unavailable' using errcode = 'P0002';
  end if;

  select message_row.id, message_row.created_at
  into target
  from public.team_messages as message_row
  where message_row.id = p_target_message_id
    and message_row.conversation_id = p_conversation_id;

  if not found then
    return jsonb_build_object('found', false, 'messages', '[]'::jsonb);
  end if;

  with before_candidates as (
    select message_row.id, message_row.created_at
    from public.team_messages as message_row
    where message_row.conversation_id = p_conversation_id
      and (message_row.created_at, message_row.id)
        < (target.created_at, target.id)
    order by message_row.created_at desc, message_row.id desc
    limit effective_before_limit + 1
  ), before_page as (
    select *
    from before_candidates
    order by created_at desc, id desc
    limit effective_before_limit
  ), after_candidates as (
    select message_row.id, message_row.created_at
    from public.team_messages as message_row
    where message_row.conversation_id = p_conversation_id
      and (message_row.created_at, message_row.id)
        >= (target.created_at, target.id)
    order by message_row.created_at asc, message_row.id asc
    limit effective_after_limit + 2
  ), after_page as (
    select *
    from after_candidates
    order by created_at asc, id asc
    limit effective_after_limit + 1
  ), combined as (
    select * from before_page
    union all
    select * from after_page
  )
  select jsonb_build_object(
    'found', true,
    'conversation_id', conversation_record.conversation_id,
    'conversation_kind', conversation_record.conversation_kind,
    'created_at', conversation_record.created_at,
    'last_message_at', conversation_record.last_message_at,
    'participants', conversation_record.participants,
    'messages', (
      select coalesce(
        jsonb_agg(
          private.team_supervision_message_json(combined_row.id)
          order by combined_row.created_at, combined_row.id
        ),
        '[]'::jsonb
      )
      from combined as combined_row
    ),
    'has_more_before', (select count(*) > effective_before_limit from before_candidates),
    'has_more_after', (select count(*) > effective_after_limit + 1 from after_candidates)
  ), (select count(*)::integer from combined)
  into window_result, result_count;

  perform private.write_team_supervision_audit(
    'team.supervision.page',
    p_conversation_id,
    result_count,
    p_correlation_id
  );

  return window_result;
end;
$$;

revoke all on function public.app_get_team_supervised_message_window(uuid, uuid, integer, integer, text)
from public, anon, authenticated, service_role;

grant execute on function public.app_get_team_supervised_message_window(uuid, uuid, integer, integer, text)
to authenticated;

comment on function public.app_get_team_supervised_message_window(uuid, uuid, integer, integer, text)
is 'Returns a bounded neutral chronological window around a target in a valid internal direct Team conversation and appends one successful supervision-page audit event.';
