-- WL-2.20 (KI-126): a Team notification belongs to its Team conversation's Tenant.
--
-- Before: public.notifications had no Tenant. Team notifications (group added
-- / removed, admin granted, task created / reassigned / completed, unread
-- digests) were keyed by recipient only, so a person who is a member of
-- Wolf Forge and Tenant B listed, counted and marked Tenant B Team titles,
-- task titles and message previews from a Wolf Forge session.
--
-- After: notifications.tenant_id is the owning Tenant of a Tenant-owned row.
--   - Team rows (category 'team') must carry it (CHECK). Writers stamp it from
--     the Team subject: team_conversation -> the conversation; team_task ->
--     task -> conversation. The conversation Tenant (WL-2.19, D-269 / D-282) is
--     authoritative; never the recipient, actor, profile fields or
--     private.identity_tenant_id().
--   - List and mark-read (single / all) show and touch a Tenant-owned row only
--     when it matches the current Tenant. A foreign id reads like a missing one
--     (false / no row). The client unread badge derives from the list.
--   - Other categories share the table but are not stamped here: their rows
--     stay NULL and behave exactly as before (KI-111 domain, recorded).
-- current_tenant_id() is NULL on any selector failure, which matches no
-- Tenant-owned row.

alter table public.notifications
  add column tenant_id uuid references public.tenants(id) on delete restrict;

-- Existing Team rows: only from their authoritative Team subject.
update public.notifications as notification
set tenant_id = conversation_row.tenant_id
from public.team_conversations as conversation_row
where notification.category = 'team'
  and conversation_row.id = case notification.entity_type
      when 'team_conversation' then notification.entity_id
      when 'team_task' then (
        select task_row.conversation_id
        from public.team_tasks as task_row
        where task_row.id = notification.entity_id
      )
    end;

do $$
begin
  if exists (
    select 1 from public.notifications
    where category = 'team' and tenant_id is null
  ) then
    raise exception 'team notification ownership is ambiguous: a Team notification has no resolvable Team conversation; map it manually';
  end if;
end;
$$;

alter table public.notifications
  add constraint notifications_team_tenant_required
  check (category <> 'team' or tenant_id is not null);

create or replace function private.emit_team_notification(p_recipient_profile_id uuid, p_event_key text, p_title text, p_body text, p_href text, p_entity_type text, p_entity_id uuid, p_actor_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into public.notifications (
    recipient_profile_id, company_id, audience, category, variant,
    title, body, href, entity_type, entity_id, actor_profile_id, event_key,
    tenant_id
  )
  select
    p_recipient_profile_id, null, 'internal', 'team', 'info',
    p_title, p_body, p_href, p_entity_type, p_entity_id,
    p_actor_profile_id, p_event_key,
    conversation_row.tenant_id
  from public.team_conversations as conversation_row
  where conversation_row.id = case p_entity_type
      when 'team_conversation' then p_entity_id
      when 'team_task' then (
        select task_row.conversation_id
        from public.team_tasks as task_row
        where task_row.id = p_entity_id
      )
    end
    and private.profile_has_permission(p_recipient_profile_id, 'team_messages.use')
  on conflict (recipient_profile_id, event_key) do nothing;
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
      conversation.tenant_id as conversation_tenant_id,
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
    group by conversation.id, conversation.tenant_id, conversation.kind, conversation.title, member.last_read_at
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
      title, body, href, entity_type, entity_id, actor_profile_id, event_key,
      tenant_id
    ) values (
      actor_id, null, 'internal', 'team', 'info',
      digest_title, coalesce(nullif(digest.previews, ''), 'Unread Team messages'),
      '/dashboard?team-messages=' || digest.conversation_id::text,
      'team_conversation', digest.conversation_id,
      digest.latest_author_profile_id, digest_event_key,
      digest.conversation_tenant_id
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

create or replace function public.app_list_my_notifications(p_limit integer DEFAULT 50)
returns TABLE(id uuid, company_id uuid, audience text, category text, variant text, title text, body text, href text, entity_type text, entity_id uuid, actor_profile_id uuid, event_key text, read_at timestamp with time zone, created_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return query
  select
    notification.id,
    notification.company_id,
    notification.audience,
    notification.category,
    notification.variant,
    notification.title,
    notification.body,
    notification.href,
    notification.entity_type,
    notification.entity_id,
    notification.actor_profile_id,
    notification.event_key,
    notification.read_at,
    notification.created_at
  from public.notifications as notification
  where notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    )
  order by notification.created_at desc, notification.id desc
  limit row_limit;
end;
$function$;

create or replace function public.app_mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed boolean;
begin
  update public.notifications as notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = p_notification_id
    and notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  changed := found;
  return changed;
end;
$function$;

create or replace function public.app_mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed integer;
begin
  update public.notifications as notification
  set read_at = now()
  where notification.recipient_profile_id = caller_id
    and notification.read_at is null
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  get diagnostics changed = row_count;
  return changed;
end;
$function$;
