-- WL-2.26 (KI-135 / KI-115 / KI-111): client notifications belong to their subject's Tenant.
--
-- Before: the three client fan-outs (company, single profile, conversation)
-- picked recipients by the global profiles.role_id = 'client' and
-- profiles.company_id and checked their permission in
-- private.identity_tenant_id(), the actor's Tenant. A Tenant B client whose
-- global company is not the B Company received nothing; a trusted no-user
-- writer evaluated Wolf Forge; rows carried no tenant_id, so a person who is a
-- client in two Tenants saw both streams in each portal. The Ticket / Project
-- response triggers classified the author by global role.
--
-- After (same pattern as WL-2.25, D-289): the Tenant comes from the
-- notification subject (private.activity_event_parent_tenant_id; a 'project'
-- conversation is its Order). Recipients are active client memberships of
-- that Tenant whose Company is the notification Company (a Company of that
-- Tenant), in an active Tenant, with the permission evaluated in that Tenant.
-- The row is stamped; an unresolvable subject notifies nobody. The response
-- triggers decide "Wolf Forge replied" from the message author_type, and the
-- wallet copy classifies the actor by its membership in the Company's Tenant.
--
-- Copy / branding is unchanged (KI-136).

create or replace function private.emit_company_client_notification_for_permission(p_company_id uuid, p_required_permission_key text, p_event_key text, p_category text, p_variant text, p_title text, p_body text, p_href text, p_entity_type text, p_entity_id uuid, p_actor_profile_id uuid, p_created_at timestamp with time zone)
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
    'client',
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
    tenant_row.id
  from subject
  join public.tenants as tenant_row
    on tenant_row.id = subject.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = tenant_row.id
   and membership_row.account_class = 'client'
   and membership_row.company_id = p_company_id
   and membership_row.archived_at is null
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
   and profile_row.archived_at is null
  where private.profile_has_permission_in_tenant(
      membership_row.profile_id,
      tenant_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$function$;

create or replace function private.emit_client_profile_notification_for_permission(p_profile_id uuid, p_company_id uuid, p_required_permission_key text, p_event_key text, p_category text, p_variant text, p_title text, p_body text, p_href text, p_entity_type text, p_entity_id uuid, p_actor_profile_id uuid, p_created_at timestamp with time zone)
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
    'client',
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
    tenant_row.id
  from subject
  join public.tenants as tenant_row
    on tenant_row.id = subject.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = tenant_row.id
   and membership_row.profile_id = p_profile_id
   and membership_row.account_class = 'client'
   and membership_row.company_id = p_company_id
   and membership_row.archived_at is null
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
   and profile_row.archived_at is null
  where private.profile_has_permission_in_tenant(
      membership_row.profile_id,
      tenant_row.id,
      p_required_permission_key
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$function$;

create or replace function private.emit_client_conversation_notification(p_company_id uuid, p_required_permission_key text, p_conversation_type text, p_conversation_id uuid, p_category text, p_sender_name text, p_subject text, p_href text, p_actor_profile_id uuid, p_created_at timestamp with time zone)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  stable_event_key text :=
    'client-conversation:' || p_conversation_type || ':' || p_conversation_id::text;
  sender_name text := coalesce(nullif(btrim(p_sender_name), ''), 'Wolf Forge');
  subject_tenant_id uuid := private.activity_event_parent_tenant_id(
    case p_conversation_type when 'project' then 'order' else p_conversation_type end,
    p_conversation_id
  );
begin
  insert into public.notifications (
    recipient_profile_id, company_id, audience, category, variant,
    title, body, href, entity_type, entity_id, actor_profile_id,
    event_key, message_count, created_at, tenant_id
  )
  select
    membership_row.profile_id,
    p_company_id,
    'client',
    p_category,
    'info',
    'New message from ' || sender_name,
    coalesce(nullif(btrim(p_subject), ''), 'Wolf Forge conversation'),
    p_href,
    p_conversation_type,
    p_conversation_id,
    p_actor_profile_id,
    stable_event_key,
    1,
    coalesce(p_created_at, now()),
    tenant_row.id
  from public.tenants as tenant_row
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = tenant_row.id
   and membership_row.account_class = 'client'
   and membership_row.company_id = p_company_id
   and membership_row.archived_at is null
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
   and profile_row.archived_at is null
  where tenant_row.id = subject_tenant_id
    and tenant_row.status = 'active'
    and tenant_row.archived_at is null
    and private.profile_has_permission_in_tenant(
      membership_row.profile_id,
      tenant_row.id,
      p_required_permission_key
    )
    and not exists (
      select 1
      from private.client_conversation_presence as presence
      where presence.profile_id = membership_row.profile_id
        and presence.conversation_type = p_conversation_type
        and presence.conversation_id = p_conversation_id
        and presence.active_at >= now() - interval '45 seconds'
    )
  on conflict (recipient_profile_id, event_key) do update set
    company_id = excluded.company_id,
    category = excluded.category,
    variant = excluded.variant,
    title = case
      when notifications.read_at is null then
        (notifications.message_count + 1)::text || ' new messages from ' || sender_name
      else 'New message from ' || sender_name
    end,
    body = excluded.body,
    href = excluded.href,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    actor_profile_id = excluded.actor_profile_id,
    message_count = case
      when notifications.read_at is null then notifications.message_count + 1
      else 1
    end,
    read_at = null,
    created_at = excluded.created_at,
    tenant_id = excluded.tenant_id;
end;
$function$;

create or replace function private.notify_client_project_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  author_name text;
  project public.orders;
begin
  if new.author_type is distinct from 'internal' or new.author_profile_id is null then
    return new;
  end if;

  select profile_row.display_name
  into author_name
  from public.profiles as profile_row
  where profile_row.id = new.author_profile_id;

  select * into project from public.orders where id = new.order_id;
  if project.id is null then return new; end if;

  perform private.emit_client_conversation_notification(
    project.company_id,
    'projects.view',
    'project',
    project.id,
    'project',
    author_name,
    project.title,
    '/account/projects/' || project.id::text,
    new.author_profile_id,
    now()
  );

  return new;
end;
$function$;

create or replace function private.notify_client_ticket_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  author_name text;
  ticket_row public.tickets;
  conversation_type text;
  conversation_id uuid;
  notification_category text;
  notification_href text;
  notification_subject text;
  required_permission text;
begin
  if new.message_kind is distinct from 'reply'
     or new.visibility is distinct from 'client'
     or new.author_type is distinct from 'internal'
     or new.author_profile_id is null then
    return new;
  end if;

  select profile_row.display_name
  into author_name
  from public.profiles as profile_row
  where profile_row.id = new.author_profile_id;

  select * into ticket_row from public.tickets where id = new.ticket_id;
  if ticket_row.id is null then return new; end if;

  if ticket_row.order_id is null then
    conversation_type := 'ticket';
    conversation_id := ticket_row.id;
    notification_category := 'ticket';
    notification_href := '/account/messages/' || ticket_row.id::text;
    notification_subject := ticket_row.subject;
    required_permission := 'tickets.view';
  else
    conversation_type := 'project';
    conversation_id := ticket_row.order_id;
    notification_category := 'project';
    notification_href := '/account/projects/' || ticket_row.order_id::text;
    select orders.title into notification_subject
    from public.orders where orders.id = ticket_row.order_id;
    required_permission := 'projects.view';
  end if;

  perform private.emit_client_conversation_notification(
    ticket_row.company_id,
    required_permission,
    conversation_type,
    conversation_id,
    notification_category,
    author_name,
    notification_subject,
    notification_href,
    new.author_profile_id,
    now()
  );

  return new;
end;
$function$;

create or replace function private.notify_wallet_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb := to_jsonb(new);
  company_id uuid := nullif(payload ->> 'company_id', '')::uuid;
  actor_id uuid := nullif(payload ->> 'actor_profile_id', '')::uuid;
  amount_cents bigint := coalesce(nullif(payload ->> 'amount_cents', '')::bigint, 0);
  currency text := coalesce(nullif(payload ->> 'currency', ''), 'USD');
  reason_value text := nullif(payload ->> 'reason', '');
  actor_class text;
  company_name text;
  amount_label text;
begin
  if amount_cents <= 0 or company_id is null then
    return new;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = company_id;

  -- The actor's class in the Company's Tenant, not the global role. The
  -- payload value avoids the company_id variable / column ambiguity.
  select membership_row.account_class into actor_class
  from public.tenant_memberships as membership_row
  where membership_row.tenant_id = private.activity_event_parent_tenant_id(
      'company', (payload ->> 'company_id')::uuid
    )
    and membership_row.profile_id = actor_id
    and membership_row.archived_at is null;

  amount_label := currency || ' '
    || to_char(amount_cents::numeric / 100, 'FM999999999999990.00');

  perform private.emit_internal_notification_for_permission(
    'clients.view',
    'wallet-credit-internal:' || new.id::text,
    'wallet',
    'credit',
    case
      when actor_class = 'client' then 'Client recharged wallet'
      else 'Client wallet credited'
    end,
    coalesce(company_name, 'Client') || ' received ' || amount_label
      || case
           when reason_value is null then '.'
           else '. ' || reason_value
         end,
    '/clients/' || company_id::text,
    'company',
    company_id,
    actor_id,
    company_id,
    now()
  );

  perform private.emit_company_client_notification_for_permission(
    company_id,
    'invoices.view',
    'wallet-credit-client:' || new.id::text,
    'wallet',
    'credit',
    amount_label || ' added to your wallet',
    case
      when actor_class = 'client' then 'Your wallet recharge was recorded.'
      else 'Wolf Forge added funds to your account.'
    end,
    '/account',
    'company',
    company_id,
    actor_id,
    now()
  );

  return new;
end;
$function$;

-- Existing client rows: only from their authoritative subject (a 'project'
-- conversation is its Order). A row whose subject no longer exists stays NULL;
-- it is never defaulted to Wolf Forge.
update public.notifications as notification
set tenant_id = resolved.tenant_id
from (
  select candidate.id,
    private.activity_event_parent_tenant_id(
      case candidate.entity_type when 'project' then 'order' else candidate.entity_type end,
      candidate.entity_id
    ) as tenant_id
  from public.notifications as candidate
  where candidate.audience = 'client'
    and candidate.tenant_id is null
) as resolved
where notification.id = resolved.id
  and resolved.tenant_id is not null;
