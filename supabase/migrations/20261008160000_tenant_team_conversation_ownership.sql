-- WL-2.19 (KI-122, D-269): a Team Chat conversation belongs to exactly one Tenant.
--
-- Before: team_conversations had no Tenant. A direct conversation was unique
-- per pair platform-wide (UNIQUE conversation_key), so two people internal in
-- Wolf Forge AND Tenant B shared one DM in both Tenants; participant RPCs
-- checked membership rows only, so a dual-Tenant member read, wrote and
-- forwarded across the boundary; WL-2.17 supervision inferred the Tenant from
-- the participants (KI-122).
--
-- After: team_conversations.tenant_id (NOT NULL, no default) is the
-- authoritative owner. Children (members, admins, messages, reactions, hidden
-- rows, pins, deliveries, typing, tasks, voice uploads, slow-mode cooldowns)
-- inherit through the conversation; none gets its own tenant_id.
--   - Creation (app_start_team_conversation, app_create_team_group) writes the
--     caller's authorized current Tenant explicitly. Never a parameter, never
--     a profile field, never private.identity_tenant_id() (KI-105).
--   - A DM is unique per (tenant_id, conversation_key): the same pair has one
--     conversation per Tenant.
--   - private.team_is_conversation_member requires conversation.tenant_id =
--     current Tenant. Every conversation- and message-id RPC routes through it
--     (require_team_conversation_member / _capability / _admin_or_owner), so a
--     foreign conversation reads exactly like one the caller is not in, and a
--     forward needs source and destination in the current Tenant.
--   - The enumerating RPCs (inbox, unread, live sync, digests, tasks) and both
--     supervision readers filter by the conversation Tenant. Supervision keeps
--     the WL-2.17 rule that both participants are internal members of the
--     current Tenant.
-- current_tenant_id() is NULL on any selector failure, which matches nothing.

alter table public.team_conversations
  add column tenant_id uuid references public.tenants(id) on delete restrict;

-- Existing rows: only the historical Wolf Forge-only state is attributable.
do $$
begin
  if exists (select 1 from public.team_conversations)
     and exists (select 1 from public.tenants where id <> private.wolf_forge_tenant_id()) then
    raise exception 'team_conversations ownership is ambiguous: a non-Wolf Forge Tenant exists; map existing conversations manually';
  end if;

  update public.team_conversations
  set tenant_id = private.wolf_forge_tenant_id();
end;
$$;

alter table public.team_conversations
  alter column tenant_id set not null;

alter table public.team_conversations
  drop constraint team_conversations_conversation_key_key;

alter table public.team_conversations
  add constraint team_conversations_tenant_conversation_key_key unique (tenant_id, conversation_key);

create or replace function private.team_is_conversation_member(p_conversation_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.team_conversation_members as member_row
    join public.profiles as profile_row
      on profile_row.id = member_row.profile_id
    join public.team_conversations as conversation_row
      on conversation_row.id = member_row.conversation_id
     and conversation_row.tenant_id = (select private.current_tenant_id())
    where member_row.conversation_id = p_conversation_id
      and member_row.profile_id = p_profile_id
      and profile_row.archived_at is null
  );
$function$;

create or replace function public.app_start_team_conversation(p_other_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_team_actor();
  v_key text := private.team_pair_key(actor_id, p_other_profile_id);
  v_conversation_id uuid;
  v_tenant_id uuid := (select private.current_tenant_id());
begin
  if v_tenant_id is null then
    raise exception 'verified internal authentication is required' using errcode = '42501';
  end if;

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
  where conversation_row.tenant_id = v_tenant_id
    and conversation_row.conversation_key = v_key;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  begin
    insert into public.team_conversations (tenant_id, conversation_key, created_by_profile_id)
    values (v_tenant_id, v_key, actor_id)
    returning id into v_conversation_id;

    insert into public.team_conversation_members (conversation_id, profile_id)
    values (v_conversation_id, actor_id), (v_conversation_id, p_other_profile_id);

    return v_conversation_id;
  exception
    when unique_violation then
      -- A concurrent tab created the same pair first: adopt theirs.
      select conversation_row.id into v_conversation_id
      from public.team_conversations as conversation_row
      where conversation_row.tenant_id = v_tenant_id
        and conversation_row.conversation_key = v_key;

      if v_conversation_id is null then
        raise;
      end if;

      return v_conversation_id;
  end;
end;
$function$;

create or replace function public.app_create_team_group(p_title text, p_member_profile_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_team_actor();
  clean_title text := btrim(coalesce(p_title, ''));
  requested_ids uuid[];
  conversation_id uuid := gen_random_uuid();
  member_id uuid;
  actor_name text;
  conversation_tenant_id uuid := (select private.current_tenant_id());
begin
  if conversation_tenant_id is null then
    raise exception 'verified internal authentication is required' using errcode = '42501';
  end if;

  if clean_title = '' then
    raise exception 'group name is required' using errcode = '22023';
  end if;
  if char_length(clean_title) > 80 then
    raise exception 'group name is too long' using errcode = '22001';
  end if;

  select coalesce(array_agg(distinct candidate), '{}'::uuid[])
  into requested_ids
  from unnest(coalesce(p_member_profile_ids, '{}'::uuid[])) as candidate
  where candidate <> actor_id;

  if cardinality(requested_ids) < 2 then
    raise exception 'a group needs at least three members including you'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(requested_ids) as requested(profile_id)
    left join public.profiles as profile_row on profile_row.id = requested.profile_id
    where profile_row.id is null
       or profile_row.archived_at is not null
       or private.profile_account_class(requested.profile_id) is distinct from 'internal'
       or not private.profile_has_permission(requested.profile_id, 'team_messages.use')
  ) then
    raise exception 'every group member must be an active internal teammate'
      using errcode = '22023';
  end if;

  perform private.consume_rate_limit(
    'team.group.create.actor.minute', actor_id::text, interval '1 minute', 10
  );

  insert into public.team_conversations (
    id, tenant_id, conversation_key, kind, title, created_by_profile_id
  ) values (
    conversation_id, conversation_tenant_id, 'group:' || conversation_id::text, 'group', clean_title, actor_id
  );

  insert into public.team_conversation_members (conversation_id, profile_id)
  select conversation_id, profile_id
  from unnest(array_append(requested_ids, actor_id)) as profile_id;

  actor_name := coalesce(
    (select display_name from public.profiles where id = actor_id),
    'A colleague'
  );

  foreach member_id in array requested_ids loop
    perform private.emit_team_notification(
      member_id,
      'team-group-created:' || conversation_id::text || ':' || member_id::text,
      actor_name || ' added you to ' || clean_title,
      clean_title,
      '/dashboard?team-messages=' || conversation_id::text,
      'team_conversation',
      conversation_id,
      actor_id
    );
  end loop;

  return conversation_id;
end;
$function$;

create or replace function public.app_list_team_conversations()
returns table(conversation_id uuid, conversation_kind text, conversation_title text, member_count integer, other_member_profile_id uuid, other_member_name text, other_member_avatar_url text, last_message_id uuid, last_message_type text, last_message_author_profile_id uuid, last_message_author_name text, last_message_author_avatar_url text, last_message_preview text, last_message_at timestamp with time zone, unread_count integer, my_last_read_at timestamp with time zone, destination_search_text text)
language sql
stable
security definer
set search_path = ''
as $function$
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
    and conversation_row.tenant_id = (select private.current_tenant_id())
  order by latest.created_at desc nulls last, conversation_row.created_at desc;
$function$;

create or replace function public.app_team_unread_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(sum((
    select count(*)
    from public.team_messages as unread_message
    join public.team_conversation_members as my_member
      on my_member.conversation_id = unread_message.conversation_id
     and my_member.profile_id = actor.actor_id
    join public.team_conversations as conversation_row
      on conversation_row.id = my_member.conversation_id
     and conversation_row.tenant_id = (select private.current_tenant_id())
    where unread_message.author_profile_id <> actor.actor_id
      and unread_message.created_at > coalesce(my_member.last_read_at, '-infinity'::timestamptz)
      and unread_message.deleted_for_everyone_at is null
      and not exists (
        select 1 from public.team_message_hidden_for_profiles as hidden
        where hidden.message_id = unread_message.id
          and hidden.profile_id = actor.actor_id
      )
  ))::integer, 0)
  from (select private.require_team_actor() as actor_id) as actor;
$function$;

create or replace function public.app_team_live_sync(p_conversation_id uuid DEFAULT NULL::uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
      join public.team_conversations as conversation_row
        on conversation_row.id = my_member.conversation_id
       and conversation_row.tenant_id = (select private.current_tenant_id())
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
          and conversation_row.tenant_id = (select private.current_tenant_id())
          and greatest(
            coalesce(conversation_row.last_message_at, '-infinity'::timestamptz),
            conversation_row.updated_at
          ) > since
      ) as signal
    )
  );
end;
$function$;

create or replace function public.app_materialize_team_message_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_team_actor();
  digest record;
  materialized_count integer := 0;
  digest_title text;
  digest_event_key text;
begin
  update public.team_message_deliveries as delivery
  set resolved_at = clock_timestamp()
  from public.team_messages as message,
       public.team_conversation_members as member
  where delivery.recipient_profile_id = actor_id
    and delivery.resolved_at is null
    and message.id = delivery.message_id
    and member.conversation_id = delivery.conversation_id
    and member.profile_id = actor_id
    and message.created_at <= coalesce(member.last_read_at, '-infinity'::timestamptz);

  for digest in
    with eligible_conversations as (
      select distinct delivery.conversation_id
      from public.team_message_deliveries as delivery
      join public.team_conversations as conversation_row
        on conversation_row.id = delivery.conversation_id
       and conversation_row.tenant_id = (select private.current_tenant_id())
      where delivery.recipient_profile_id = actor_id
        and delivery.resolved_at is null
        and delivery.eligible_at <= clock_timestamp()
    ), unread as (
      select
        message.conversation_id,
        message.id,
        message.author_profile_id,
        author.display_name as author_name,
        message.body,
        message.created_at,
        row_number() over (
          partition by message.conversation_id
          order by message.created_at desc, message.id desc
        ) as preview_rank
      from public.team_messages as message
      join eligible_conversations as eligible
        on eligible.conversation_id = message.conversation_id
      join public.team_conversation_members as member
        on member.conversation_id = message.conversation_id
       and member.profile_id = actor_id
      join public.profiles as author on author.id = message.author_profile_id
      where message.author_profile_id <> actor_id
        and message.message_type = 'text'
        and message.created_at > coalesce(member.last_read_at, '-infinity'::timestamptz)
    )
    select
      conversation.id as conversation_id,
      conversation.kind as conversation_kind,
      conversation.title as conversation_title,
      member.last_read_at,
      count(unread.id)::integer as message_count,
      (array_agg(unread.author_profile_id order by unread.created_at desc, unread.id desc))[1]
        as latest_author_profile_id,
      (array_agg(coalesce(unread.author_name, 'A colleague') order by unread.created_at desc, unread.id desc))[1]
        as latest_author_name,
      string_agg(
        case when unread.preview_rank <= 2
          then left(private.team_message_plain_text(unread.body), 120)
        end,
        E'\n' order by unread.created_at asc, unread.id asc
      ) filter (where unread.preview_rank <= 2) as previews
    from unread
    join public.team_conversations as conversation on conversation.id = unread.conversation_id
    join public.team_conversation_members as member
      on member.conversation_id = unread.conversation_id
     and member.profile_id = actor_id
    group by conversation.id, conversation.kind, conversation.title, member.last_read_at
  loop
    if digest.message_count = 1 then
      digest_title := digest.latest_author_name ||
        case when digest.conversation_kind = 'group'
          then ' sent a message in ' || coalesce(digest.conversation_title, 'your group')
          else ' sent you a message'
        end;
    elsif digest.conversation_kind = 'group' then
      digest_title := digest.message_count::text || ' new messages in ' ||
        coalesce(digest.conversation_title, 'your group');
    else
      digest_title := digest.latest_author_name || ' sent you ' ||
        digest.message_count::text || ' messages';
    end if;

    digest_event_key := 'team-message-digest:' || digest.conversation_id::text || ':' ||
      coalesce(to_char(digest.last_read_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), 'never');

    insert into public.notifications (
      recipient_profile_id, company_id, audience, category, variant,
      title, body, href, entity_type, entity_id, actor_profile_id, event_key
    ) values (
      actor_id, null, 'internal', 'team', 'info',
      digest_title, coalesce(nullif(digest.previews, ''), 'Unread Team messages'),
      '/dashboard?team-messages=' || digest.conversation_id::text,
      'team_conversation', digest.conversation_id,
      digest.latest_author_profile_id, digest_event_key
    )
    on conflict (recipient_profile_id, event_key) do update
      set title = excluded.title,
          body = excluded.body,
          actor_profile_id = excluded.actor_profile_id
    where notifications.read_at is null;

    update public.team_message_deliveries as delivery
    set materialized_at = coalesce(delivery.materialized_at, clock_timestamp())
    where delivery.recipient_profile_id = actor_id
      and delivery.conversation_id = digest.conversation_id
      and delivery.resolved_at is null
      and delivery.eligible_at <= clock_timestamp();

    materialized_count := materialized_count + 1;
  end loop;

  return materialized_count;
end;
$function$;

create or replace function public.app_list_my_team_tasks(p_include_team boolean DEFAULT false)
returns table(id uuid, conversation_id uuid, source_message_id uuid, title text, description text, status text, priority text, due_at timestamp with time zone, completed_at timestamp with time zone, completed_by_profile_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, assigned_to_profile_id uuid, assigned_to_name text, created_by_profile_id uuid, created_by_name text, conversation_kind text, conversation_name text, other_member_name text, is_mine boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  with scope as (
    select private.require_team_actor() as actor_id
  ),
  my_conversations as (
    select member.conversation_id
    from public.team_conversation_members as member
    join scope on true
    join public.team_conversations as conversation_row
      on conversation_row.id = member.conversation_id
     and conversation_row.tenant_id = (select private.current_tenant_id())
    where member.profile_id = scope.actor_id
  )
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
    assignee.display_name,
    task.created_by_profile_id,
    creator.display_name,
    conversation.kind,
    case when conversation.kind = 'group' then conversation.title else (
      select other.display_name
      from public.team_conversation_members as other_member
      join public.profiles as other on other.id = other_member.profile_id
      where other_member.conversation_id = task.conversation_id
        and other_member.profile_id <> scope.actor_id
      limit 1
    ) end,
    case when conversation.kind = 'direct' then (
      select other.display_name
      from public.team_conversation_members as other_member
      join public.profiles as other on other.id = other_member.profile_id
      where other_member.conversation_id = task.conversation_id
        and other_member.profile_id <> scope.actor_id
      limit 1
    ) end,
    task.assigned_to_profile_id = scope.actor_id
  from public.team_tasks as task
  join scope on true
  join my_conversations on my_conversations.conversation_id = task.conversation_id
  join public.team_conversations as conversation on conversation.id = task.conversation_id
  join public.profiles as assignee on assignee.id = task.assigned_to_profile_id
  join public.profiles as creator on creator.id = task.created_by_profile_id
  where task.assigned_to_profile_id = scope.actor_id
     or (p_include_team and private.current_user_has_permission('team_tasks.manage'))
  order by
    case when task.status = 'done' then 1 else 0 end,
    coalesce(task.due_at, 'infinity'::timestamptz),
    task.created_at desc;
$function$;

create or replace function private.team_supervision_direct_conversation(p_conversation_id uuid)
returns table(conversation_id uuid, conversation_kind text, created_at timestamp with time zone, last_message_at timestamp with time zone, participants jsonb)
language sql
stable
security definer
set search_path = ''
as $function$
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
    and conversation_row.tenant_id = (select private.current_tenant_id())
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
$function$;

create or replace function public.app_list_team_supervised_conversations(p_limit integer DEFAULT 50, p_before_last_message_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_conversation_id uuid DEFAULT NULL::uuid)
returns table(conversation_id uuid, conversation_kind text, created_at timestamp with time zone, last_message_at timestamp with time zone, participant_one_profile_id uuid, participant_one_name text, participant_one_avatar_url text, participant_one_archived boolean, participant_two_profile_id uuid, participant_two_name text, participant_two_avatar_url text, participant_two_archived boolean)
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
      and conversation_row.tenant_id = (select private.current_tenant_id())
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
$function$;
