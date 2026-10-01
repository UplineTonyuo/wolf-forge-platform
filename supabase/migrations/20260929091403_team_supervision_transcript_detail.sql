-- Bounded, neutral transcript open for valid internal direct conversations.
-- This is supervisory access, not participant access: no membership or
-- participant-state projection is consulted or changed.

create function public.app_get_team_supervised_conversation(
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

  select
    conversation_row.id,
    conversation_row.kind,
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
  into conversation_record
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

  if conversation_record is null then
    raise exception 'team conversation unavailable' using errcode = 'P0002';
  end if;

  with candidates as (
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
    where message_row.conversation_id = p_conversation_id
    order by message_row.created_at desc, message_row.id desc
    limit effective_limit + 1
  ), page as (
    select *
    from candidates
    order by created_at desc, id desc
    limit effective_limit
  ), projected as (
    select
      page.id as message_id,
      page.author_profile_id,
      page.author_name,
      page.author_avatar_url,
      page.author_archived,
      case
        when page.deleted_for_everyone_at is not null then 'Message deleted'
        when page.message_type = 'voice' then 'Voice message'
        else page.body
      end as body,
      page.message_type,
      page.created_at,
      case
        when page.deleted_for_everyone_at is not null
          or page.reply_to_message_id is null then null
        else jsonb_build_object(
          'message_id', page.reply_to_message_id,
          'author_profile_id', page.reply_author_profile_id,
          'author_name', page.reply_author_name,
          'author_avatar_url', page.reply_author_avatar_url,
          'body', case
            when page.reply_deleted_at is not null then 'Message deleted'
            when page.reply_message_type = 'voice' then 'Voice message'
            else page.reply_quote_text
          end,
          'message_type', page.reply_message_type,
          'deleted_for_everyone', page.reply_deleted_at is not null
        )
      end as reply,
      case
        when page.deleted_for_everyone_at is not null then false
        else page.forwarded_from_message_id is not null
          or page.forwarded_from_ticket_message_id is not null
      end as forwarded,
      case when page.deleted_for_everyone_at is null
        then page.forwarded_from_author_name else null end as forwarded_from_author_name,
      page.deleted_for_everyone_at is not null as deleted_for_everyone,
      page.deleted_for_everyone_at,
      page.deleted_for_everyone_by as deleted_by_profile_id,
      page.deleted_by_name,
      case
        when page.message_type = 'voice'
          and page.deleted_for_everyone_at is null
        then 'Unavailable in supervisory view'
        else null
      end as supervisory_notice,
      case
        when page.deleted_for_everyone_at is not null then '[]'::jsonb
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
            where reaction_row.message_id = page.id
              and reaction_row.active
            group by reaction_row.reaction_code
          ) as reaction_count
        )
      end as reactions
    from page
  )
  select jsonb_build_object(
    'conversation_id', conversation_record.id,
    'conversation_kind', conversation_record.kind,
    'created_at', conversation_record.created_at,
    'last_message_at', conversation_record.last_message_at,
    'participants', conversation_record.participants,
    'messages', (
      select coalesce(
        jsonb_agg(to_jsonb(projected) order by projected.created_at, projected.message_id),
        '[]'::jsonb
      )
      from projected
    ),
    'has_more', (select count(*) > effective_limit from candidates),
    'next_before_created_at', case
      when (select count(*) > effective_limit from candidates)
      then (select page.created_at from page order by page.created_at, page.id limit 1)
      else null
    end,
    'next_before_message_id', case
      when (select count(*) > effective_limit from candidates)
      then (select page.id from page order by page.created_at, page.id limit 1)
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
