-- Conversation-scoped supervisory message search.
-- This is a content-read boundary, not a privileged bypass of participant
-- search. It reuses the canonical Team FTS projection and neutral result shape
-- while applying the supervisory direct-conversation policy first.

create function public.app_search_team_supervised_conversation_messages(
  p_conversation_id uuid,
  p_query text,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 20,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  trimmed_query text := btrim(coalesce(p_query, ''));
  tsquery_value tsquery;
  highlight_start text := chr(57349);
  highlight_stop text := chr(57350);
  actor_id uuid;
  conversation_record record;
  search_result jsonb;
  result_count integer;
begin
  actor_id := private.require_team_supervisor();

  select *
  into conversation_record
  from private.team_supervision_direct_conversation(p_conversation_id);

  if not found then
    raise exception 'team conversation unavailable' using errcode = 'P0002';
  end if;

  if (p_before_created_at is null) <> (p_before_message_id is null) then
    raise exception 'invalid search cursor' using errcode = '22023';
  end if;

  if p_correlation_id is not null
    and p_correlation_id !~ '^[0-9a-f]{32}$'
  then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;

  if trimmed_query = '' or char_length(trimmed_query) > 200 then
    return jsonb_build_object(
      'results', '[]'::jsonb,
      'has_more', false,
      'next_before_created_at', null,
      'next_before_message_id', null
    );
  end if;

  begin
    tsquery_value := websearch_to_tsquery('english', trimmed_query);
  exception when others then
    return jsonb_build_object(
      'results', '[]'::jsonb,
      'has_more', false,
      'next_before_created_at', null,
      'next_before_message_id', null
    );
  end;

  if tsquery_value is null or tsquery_value = ''::tsquery then
    return jsonb_build_object(
      'results', '[]'::jsonb,
      'has_more', false,
      'next_before_created_at', null,
      'next_before_message_id', null
    );
  end if;

  -- This scope is intentionally distinct from the participant Team search
  -- bucket. The subject remains the server-derived supervisor actor.
  perform private.consume_rate_limit(
    'team.supervision.search.actor',
    actor_id::text,
    interval '1 minute',
    60
  );

  with candidates as (
    select
      message_row.id,
      message_row.author_profile_id,
      author_row.display_name as author_name,
      author_row.avatar_url as author_avatar_url,
      message_row.created_at,
      left(
        ts_headline(
          'english',
          private.team_message_plain_text(message_row.body),
          tsquery_value,
          'StartSel=' || highlight_start || ', StopSel=' || highlight_stop ||
          ', MaxFragments=1, MaxWords=18, MinWords=6, ShortWord=3, HighlightAll=false'
        ),
        600
      ) as snippet
    from public.team_messages as message_row
    join public.profiles as author_row
      on author_row.id = message_row.author_profile_id
    where message_row.conversation_id = p_conversation_id
      and message_row.message_type = 'text'
      and message_row.deleted_for_everyone_at is null
      and message_row.search_vector @@ tsquery_value
      and (
        p_before_created_at is null
        or (message_row.created_at, message_row.id)
          < (p_before_created_at, p_before_message_id)
      )
    order by message_row.created_at desc, message_row.id desc
    limit effective_limit + 1
  ), results_page as (
    select *
    from candidates
    order by created_at desc, id desc
    limit effective_limit
  )
  select jsonb_build_object(
    'results', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', result_row.id,
            'author_profile_id', result_row.author_profile_id,
            'author_name', result_row.author_name,
            'author_avatar_url', result_row.author_avatar_url,
            'created_at', result_row.created_at,
            'snippet', result_row.snippet
          ) order by result_row.created_at desc, result_row.id desc
        ),
        '[]'::jsonb
      )
      from results_page as result_row
    ),
    'has_more', (select count(*) > effective_limit from candidates),
    'next_before_created_at', case
      when (select count(*) > effective_limit from candidates)
      then (select result_row.created_at from results_page as result_row order by result_row.created_at, result_row.id limit 1)
      else null
    end,
    'next_before_message_id', case
      when (select count(*) > effective_limit from candidates)
      then (select result_row.id from results_page as result_row order by result_row.created_at, result_row.id limit 1)
      else null
    end
  ), (select count(*)::integer from results_page)
  into search_result, result_count;

  perform private.write_team_supervision_audit(
    'team.supervision.search',
    p_conversation_id,
    result_count,
    p_correlation_id
  );

  return search_result;
end;
$$;

revoke all on function public.app_search_team_supervised_conversation_messages(uuid, text, timestamptz, uuid, integer, text)
from public, anon, authenticated, service_role;

grant execute on function public.app_search_team_supervised_conversation_messages(uuid, text, timestamptz, uuid, integer, text)
to authenticated;

comment on function public.app_search_team_supervised_conversation_messages(uuid, text, timestamptz, uuid, integer, text)
is 'Searches one eligible internal direct Team conversation for an authorized supervisor using the canonical Team FTS projection and appends one successful supervision-search audit event.';
