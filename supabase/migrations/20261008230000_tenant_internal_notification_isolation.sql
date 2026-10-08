-- WL-2.25 (KI-115 D5 / KI-111): internal notifications belong to their subject's Tenant.
--
-- Before: private.emit_internal_notification_for_permission, the fan-out
-- behind every non-Team internal notification (Client, Project, Coupon, Form,
-- Ticket, Ticket reply, Invoice payment, Wallet credit, investment intent),
-- picked recipients by the global profiles.role_id and checked their
-- permission in private.identity_tenant_id(), the actor's Tenant. So:
--   - a Tenant B record written by a trusted no-user path (service role, job,
--     webhook) was evaluated in Wolf Forge and reached Wolf Forge staff;
--   - a global internal profile with a Tenant B client membership received
--     Tenant B internal notifications; a Tenant B-only internal member whose
--     global role is 'client' received none;
--   - an anonymous public Contact Form Ticket reached nobody (anon has no
--     Tenant);
--   - rows carried no tenant_id, so they showed in every Tenant's stream.
--
-- After: the Tenant comes from the notification subject (entity_type /
-- entity_id -> the Tenant-owned source row, through the WL-2.8 resolver
-- private.activity_event_parent_tenant_id), as Team rows already do (D-283).
-- Recipients are active internal memberships of that Tenant, in an active
-- Tenant, with the permission evaluated in that Tenant, and the row is
-- stamped with it. An unresolvable subject inserts nothing. Never the
-- recipient, actor, profile fields, identity_tenant_id() or a Tenant
-- parameter. The Ticket-reply trigger decides "client reply" from the
-- message's author_type instead of the author's global role.
--
-- Readers (list, mark one, mark all) also require the row's audience to be
-- the caller's account class in the current Tenant, so an internal row never
-- reaches a client session (and the reverse), whatever the permission keys.
--
-- Client-facing emitters and their rows are unchanged (deferred).

create or replace function private.emit_internal_notification_for_permission(p_required_permission_key text, p_event_key text, p_category text, p_variant text, p_title text, p_body text, p_href text, p_entity_type text, p_entity_id uuid, p_actor_profile_id uuid, p_company_id uuid, p_created_at timestamp with time zone, p_exclude_profile_id uuid DEFAULT NULL::uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  with subject as (
    select private.activity_event_parent_tenant_id(p_entity_type, p_entity_id) as tenant_id
  )
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key,
    created_at,
    tenant_id
  )
  select
    membership_row.profile_id,
    p_company_id,
    'internal',
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key,
    coalesce(p_created_at, now()),
    subject.tenant_id
  from subject
  join public.tenants as tenant_row
    on tenant_row.id = subject.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = tenant_row.id
   and membership_row.account_class = 'internal'
   and membership_row.archived_at is null
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
   and profile_row.archived_at is null
  where (p_exclude_profile_id is null or membership_row.profile_id <> p_exclude_profile_id)
    and private.profile_has_permission_in_tenant(
      membership_row.profile_id,
      tenant_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$function$;

comment on function private.emit_internal_notification_for_permission(text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamp with time zone, uuid) is
  'Internal notification fan-out to the active internal members of the notification subject''s Tenant that hold the module capability in that Tenant; the row is stamped with that Tenant and an unresolvable subject notifies nobody. p_exclude_profile_id optionally drops the actor so a staff member does not notify themselves.';

create or replace function private.notify_client_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb := to_jsonb(new);
  ticket_id uuid := nullif(payload ->> 'ticket_id', '')::uuid;
  author_id uuid := nullif(payload ->> 'author_profile_id', '')::uuid;
  message_kind text := payload ->> 'message_kind';
  author_name text;
  ticket_ref text;
  ticket_subject text;
  company_id uuid;
begin
  if message_kind is distinct from 'reply'
     or payload ->> 'author_type' is distinct from 'client'
     or author_id is null
     or ticket_id is null then
    return new;
  end if;

  select profile_row.display_name
  into author_name
  from public.profiles as profile_row
  where profile_row.id = author_id;

  select ticket_row.public_ref, ticket_row.subject, ticket_row.company_id
  into ticket_ref, ticket_subject, company_id
  from public.tickets as ticket_row
  where ticket_row.id = ticket_id;

  perform private.emit_internal_notification_for_permission(
    'tickets.view',
    'client-ticket-reply:' || new.id::text,
    'ticket',
    'info',
    'Client replied to ' || coalesce(ticket_ref, 'a Ticket'),
    coalesce(nullif(author_name, ''), 'A client')
      || case
           when ticket_subject is null then ' sent a reply.'
           else ' replied to "' || ticket_subject || '".'
         end,
    '/tickets/' || ticket_id::text,
    'ticket',
    ticket_id,
    author_id,
    company_id,
    now()
  );

  return new;
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
    and notification.audience = (select private.profile_account_class(caller_id))
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
    and notification.audience = (select private.profile_account_class(caller_id))
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
    and notification.audience = (select private.profile_account_class(caller_id))
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

-- Existing internal rows (Team excluded, already stamped): only from their
-- authoritative subject. A row whose subject no longer exists stays NULL and
-- keeps its pre-WL-2.25 visibility; it is never defaulted to Wolf Forge.
update public.notifications as notification
set tenant_id = resolved.tenant_id
from (
  select candidate.id,
    private.activity_event_parent_tenant_id(candidate.entity_type, candidate.entity_id) as tenant_id
  from public.notifications as candidate
  where candidate.audience = 'internal'
    and candidate.category <> 'team'
    and candidate.tenant_id is null
) as resolved
where notification.id = resolved.id
  and resolved.tenant_id is not null;
