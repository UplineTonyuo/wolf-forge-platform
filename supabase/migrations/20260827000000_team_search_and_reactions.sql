-- Team Communication V2.3 — conversation history search and shared message
-- reactions.
--
-- Forward-only after 20260826230000. Neither 20260826220000_team_live_sync.sql
-- nor 20260826230000_team_markdown_escapes.sql is edited; app_get_team_conversation
-- (defined in 20260826190000_team_communication_v2.sql) is extended with
-- CREATE OR REPLACE rather than rewritten from scratch, so its authorization,
-- shape and 300-message window are all preserved.
--
-- Two independent additions, both riding the existing seam:
--   * SEARCH is server-side, conversation-scoped, and backed by Postgres
--     built-in full text search (no extension required) over the same
--     plain-text projection private.team_message_plain_text already produces
--     for previews and digests. A generated tsvector column + GIN index keeps
--     it index-only; ILIKE over an unindexed multi-year table was rejected for
--     exactly the reason the brief calls out. websearch_to_tsquery tolerates
--     arbitrary employee input without raising on malformed syntax the way
--     to_tsquery would.
--   * REACTIONS get one new, narrowly-scoped table with the same
--     force-RLS/zero-policy/zero-grant posture as every other Team table. The
--     only doorway is app_toggle_team_message_reaction, which derives the
--     reactor from auth.uid() and re-checks conversation membership through
--     the message being reacted to — never a browser-supplied actor or
--     conversation id.
--
-- Both ride the LIVE lane for free: app_get_team_conversation already resends
-- its whole loaded window on every ~700ms-1.2s live poll, so folding a
-- per-message reaction aggregate into that same row means a reaction a
-- colleague adds is visible next tick, with no second timer, no realtime
-- subscription and no browser Supabase token.

-- =============================================================================
-- Reactions: storage
-- =============================================================================

create table public.team_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_messages (id) on delete cascade,
  reactor_profile_id uuid not null references public.profiles (id) on delete cascade,
  -- A stable code, not an arbitrary user-controlled string. The browser only
  -- ever sends one of these nine; application code maps each to its emoji.
  reaction_code text not null,
  -- Toggle semantics live on one row rather than a physical delete, so a
  -- like-unlike-like cycle never needs a second insert path and the RPC below
  -- is a single idempotent upsert.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_message_reactions_code_valid
    check (reaction_code in (
      'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
    )),
  -- One reactor may hold at most one row per (message, reaction) — this is
  -- what makes "duplicate same reaction does not duplicate row" structural
  -- rather than an application promise.
  constraint team_message_reactions_unique
    unique (message_id, reactor_profile_id, reaction_code)
);

create trigger team_message_reactions_set_updated_at
before update on public.team_message_reactions
for each row
execute function private.set_updated_at();

-- Every read path aggregates "active reactions for this message", so this is
-- the one index that matters.
create index team_message_reactions_message_active_idx
  on public.team_message_reactions (message_id)
  where active;

alter table public.team_message_reactions enable row level security;
alter table public.team_message_reactions force row level security;

revoke all on table public.team_message_reactions
  from public, anon, authenticated, service_role;

comment on table public.team_message_reactions is
  'Shared per-message reactions. No policy, no grant to any browser role — reachable only through app_toggle_team_message_reaction, which derives the reactor from auth.uid().';

-- =============================================================================
-- Reactions: the one private aggregate, reused by every message-shaped read
-- =============================================================================

create or replace function private.team_message_reactions_json(
  p_message_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(reaction_row order by reaction_row.reaction_code), '[]'::jsonb)
  from (
    select
      reaction.reaction_code,
      count(*)::integer as reaction_count,
      bool_or(reaction.reactor_profile_id = p_actor_id) as reacted_by_me,
      jsonb_agg(reactor.display_name order by reactor.display_name, reactor.id) as reactor_names
    from public.team_message_reactions as reaction
    join public.profiles as reactor on reactor.id = reaction.reactor_profile_id
    where reaction.message_id = p_message_id
      and reaction.active
    group by reaction.reaction_code
  ) as reaction_row;
$$;

revoke all on function private.team_message_reactions_json(uuid, uuid)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- Reactions: the only write
-- =============================================================================

-- Idempotent toggle. The reactor is always auth.uid(); the only thing the
-- browser supplies is which message and which of the nine allowed codes.
-- Membership is re-derived from the message's OWN conversation, so a message
-- from conversation X can never be reacted to by a member who only belongs to
-- conversation Y, no matter what conversation id a forged call might carry
-- elsewhere.
create or replace function public.app_toggle_team_message_reaction(
  p_message_id uuid,
  p_reaction_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_conversation_id uuid;
  actor_id uuid;
  now_active boolean;
begin
  select message.conversation_id into resolved_conversation_id
  from public.team_messages as message
  where message.id = p_message_id;

  if resolved_conversation_id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  actor_id := private.require_team_conversation_member(resolved_conversation_id);

  if p_reaction_code is null or p_reaction_code not in (
    'like', 'heart', 'laugh', 'wow', 'celebrate', 'fire', 'eyes', 'pray', 'check'
  ) then
    raise exception 'invalid reaction code' using errcode = '22023';
  end if;

  perform private.consume_rate_limit(
    'team.reaction.actor', actor_id::text, interval '1 minute', 60
  );

  insert into public.team_message_reactions as reaction (
    message_id, reactor_profile_id, reaction_code, active, created_at, updated_at
  )
  values (p_message_id, actor_id, p_reaction_code, true, clock_timestamp(), clock_timestamp())
  on conflict (message_id, reactor_profile_id, reaction_code)
  do update set
    active = not reaction.active,
    updated_at = clock_timestamp()
  returning reaction.active into now_active;

  return jsonb_build_object(
    'message_id', p_message_id,
    'reacted_by_me', now_active,
    'reactions', private.team_message_reactions_json(p_message_id, actor_id)
  );
end;
$$;

revoke all on function public.app_toggle_team_message_reaction(uuid, text)
  from public, anon;
grant execute on function public.app_toggle_team_message_reaction(uuid, text)
  to authenticated;

-- =============================================================================
-- app_get_team_conversation: fold the reaction aggregate into the same
-- per-message row the live lane already resends every tick. Everything else
-- below is byte-identical to the 20260826190000 definition.
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
          message.created_at,
          private.team_message_reactions_json(message.id, actor_id) as reactions
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

-- =============================================================================
-- History pagination: keyset on (created_at, id), never OFFSET
-- =============================================================================

-- A stable ordering key for keyset pagination and the search/window RPCs
-- below. The existing (conversation_id, created_at) index has no id
-- tiebreaker, which is not safe as a cursor when two messages share a
-- timestamp.
create index team_messages_conversation_created_id_idx
  on public.team_messages (conversation_id, created_at desc, id desc);

-- "Load older": the page strictly before the caller's own oldest loaded
-- message. Requesting effective_limit + 1 rows and trimming in-database is
-- what makes has_more exact without a second COUNT query.
create or replace function public.app_list_team_messages_before(
  p_conversation_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  effective_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return (
    with page as (
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
        message.created_at,
        private.team_message_reactions_json(message.id, actor_id) as reactions
      from public.team_messages as message
      join public.profiles as author on author.id = message.author_profile_id
      where message.conversation_id = p_conversation_id
        and (message.created_at, message.id) < (p_before_created_at, p_before_id)
      order by message.created_at desc, message.id desc
      limit effective_limit + 1
    )
    select jsonb_build_object(
      'messages', (
        select coalesce(jsonb_agg(page_row order by page_row.created_at asc, page_row.id asc), '[]'::jsonb)
        from (
          select * from page order by created_at desc, id desc limit effective_limit
        ) as page_row
      ),
      'has_more', (select count(*) > effective_limit from page)
    )
  );
end;
$$;

revoke all on function public.app_list_team_messages_before(uuid, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.app_list_team_messages_before(uuid, timestamptz, uuid, integer)
  to authenticated;

-- Jump-to-message: a bounded window of messages surrounding one target,
-- regardless of whether the target sits inside the caller's currently loaded
-- window. This is the minimum architecture a search result click needs — it
-- never loads everything between today and a message from eight months ago.
create or replace function public.app_get_team_message_window(
  p_conversation_id uuid,
  p_message_id uuid,
  p_before integer default 25,
  p_after integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  target record;
  before_limit integer := least(greatest(coalesce(p_before, 25), 0), 100);
  after_limit integer := least(greatest(coalesce(p_after, 25), 0), 100);
begin
  select message.created_at, message.id
  into target
  from public.team_messages as message
  where message.id = p_message_id
    and message.conversation_id = p_conversation_id;

  if not found then
    return jsonb_build_object('found', false, 'messages', '[]'::jsonb);
  end if;

  return (
    with before_page as (
      select
        message.id, message.request_id, message.conversation_id, message.author_profile_id,
        author.display_name as author_name, author.avatar_url as author_avatar_url,
        message.body, message.message_type, message.task_id, message.task_action, message.created_at
      from public.team_messages as message
      join public.profiles as author on author.id = message.author_profile_id
      where message.conversation_id = p_conversation_id
        and (message.created_at, message.id) < (target.created_at, target.id)
      order by message.created_at desc, message.id desc
      limit before_limit
    ),
    -- Inclusive of the target itself, so "after" never has to special-case it.
    after_page as (
      select
        message.id, message.request_id, message.conversation_id, message.author_profile_id,
        author.display_name as author_name, author.avatar_url as author_avatar_url,
        message.body, message.message_type, message.task_id, message.task_action, message.created_at
      from public.team_messages as message
      join public.profiles as author on author.id = message.author_profile_id
      where message.conversation_id = p_conversation_id
        and (message.created_at, message.id) >= (target.created_at, target.id)
      order by message.created_at asc, message.id asc
      limit after_limit + 1
    ),
    combined as (
      select * from before_page
      union all
      select * from after_page
    )
    select jsonb_build_object(
      'found', true,
      'messages', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', combined.id,
          'request_id', combined.request_id,
          'conversation_id', combined.conversation_id,
          'author_profile_id', combined.author_profile_id,
          'author_name', combined.author_name,
          'author_avatar_url', combined.author_avatar_url,
          'body', combined.body,
          'message_type', combined.message_type,
          'task_id', combined.task_id,
          'task_action', combined.task_action,
          'created_at', combined.created_at,
          'reactions', private.team_message_reactions_json(combined.id, actor_id)
        ) order by combined.created_at asc, combined.id asc), '[]'::jsonb)
        from combined
      )
    )
  );
end;
$$;

revoke all on function public.app_get_team_message_window(uuid, uuid, integer, integer)
  from public, anon;
grant execute on function public.app_get_team_message_window(uuid, uuid, integer, integer)
  to authenticated;

-- =============================================================================
-- Search: plain-text projection, generated tsvector, GIN index
-- =============================================================================

-- Generated from the SAME plain-text projection previews, peeks, digests and
-- task titles already use, so an employee searches what they perceive as
-- text — "**bold**" is searchable as "bold" — never Markdown syntax. Stored
-- and indexed rather than computed at query time: to_tsvector(regconfig,
-- text) with a literal configuration name is IMMUTABLE, and
-- private.team_message_plain_text is already IMMUTABLE, so the generated
-- column is well-formed. No historical message is rewritten by adding this
-- column — Postgres backfills it once from the existing body.
alter table public.team_messages
  add column search_vector tsvector
  generated always as (
    to_tsvector('english', private.team_message_plain_text(body))
  ) stored;

create index team_messages_search_vector_idx
  on public.team_messages using gin (search_vector);

comment on column public.team_messages.search_vector is
  'Generated from private.team_message_plain_text(body). Indexed with GIN; this is what keeps conversation search an index scan instead of an unindexed ILIKE over a multi-year table.';

-- Conversation-scoped, server-side, bounded. websearch_to_tsquery tolerates
-- arbitrary employee input (quotes, "-", "OR") without raising the way
-- to_tsquery would on malformed syntax, which is what "empty/invalid query
-- handled" means here: nothing is thrown back at the caller, an unusable
-- query simply matches nothing.
--
-- Snippets never leave this function as HTML. ts_headline is asked to wrap
-- matches in a private-use sentinel pair instead of <b>/</b> — the same
-- parking-code-point trick private.team_message_plain_text already uses for
-- literal escapes — so the browser splits plain text on two characters no
-- person can type and renders <mark> nodes directly. No dangerouslySetInnerHTML
-- anywhere in this path.
create or replace function public.app_search_team_conversation_messages(
  p_conversation_id uuid,
  p_query text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
-- NOT stable: it calls private.consume_rate_limit, which writes a counter
-- row. PostgREST executes a STABLE-marked function inside a read-only
-- transaction, so marking this stable made the rate-limit INSERT fail with
-- 25006 ("cannot execute INSERT in a read-only transaction") on every real
-- HTTP call while still succeeding when invoked directly in a normal
-- read/write session (exactly how the pgTAP suite calls it) — the gap a
-- rendered QA pass against the real PostgREST path is for.
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  effective_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  trimmed_query text := btrim(coalesce(p_query, ''));
  tsquery_value tsquery;
  highlight_start text := chr(57349);
  highlight_stop text := chr(57350);
begin
  if trimmed_query = '' then
    return jsonb_build_object('results', '[]'::jsonb, 'has_more', false);
  end if;

  perform private.consume_rate_limit(
    'team.search.actor', actor_id::text, interval '1 minute', 60
  );

  begin
    tsquery_value := websearch_to_tsquery('english', trimmed_query);
  exception when others then
    return jsonb_build_object('results', '[]'::jsonb, 'has_more', false);
  end;

  if tsquery_value is null or tsquery_value = ''::tsquery then
    return jsonb_build_object('results', '[]'::jsonb, 'has_more', false);
  end if;

  return (
    with page as (
      select
        message.id,
        message.author_profile_id,
        author.display_name as author_name,
        author.avatar_url as author_avatar_url,
        message.created_at,
        ts_headline(
          'english',
          private.team_message_plain_text(message.body),
          tsquery_value,
          'StartSel=' || highlight_start || ', StopSel=' || highlight_stop ||
            ', MaxFragments=1, MaxWords=18, MinWords=6, ShortWord=3, HighlightAll=false'
        ) as snippet
      from public.team_messages as message
      join public.profiles as author on author.id = message.author_profile_id
      where message.conversation_id = p_conversation_id
        and message.message_type = 'text'
        and message.search_vector @@ tsquery_value
        and (
          p_before_created_at is null
          or (message.created_at, message.id) < (p_before_created_at, p_before_id)
        )
      order by message.created_at desc, message.id desc
      limit effective_limit + 1
    )
    select jsonb_build_object(
      'results', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', page_row.id,
          'author_profile_id', page_row.author_profile_id,
          'author_name', page_row.author_name,
          'author_avatar_url', page_row.author_avatar_url,
          'created_at', page_row.created_at,
          'snippet', page_row.snippet
        ) order by page_row.created_at desc, page_row.id desc), '[]'::jsonb)
        from (
          select * from page order by created_at desc, id desc limit effective_limit
        ) as page_row
      ),
      'has_more', (select count(*) > effective_limit from page)
    )
  );
end;
$$;

revoke all on function public.app_search_team_conversation_messages(uuid, text, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.app_search_team_conversation_messages(uuid, text, timestamptz, uuid, integer)
  to authenticated;
