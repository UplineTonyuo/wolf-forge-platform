-- WL-2.34 Phase 2: Investment Intent. No draft publication or effective policy seed.
-- Existing role, membership, purchase/cleanup and ordinary Ticket authority remain intact.

CREATE OR REPLACE FUNCTION private.published_module_set_valid(p_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    p_keys is not null
    and array_ndims(p_keys) = 1
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as requested(key))
    and not exists (
      select 1 from unnest(p_keys) as requested(key)
      where key is null or not exists (
        select 1 from private.white_label_modules as catalog where catalog.module_key = key
      )
    )
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key = any(p_keys)
        and catalog.requires_module_key is not null
        and not (catalog.requires_module_key = any(p_keys))
    )
    -- Only Reporting and Investment Intent have audited disablement coverage.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent') and not (catalog.module_key = any(p_keys))
    ), false);
$function$;

CREATE OR REPLACE FUNCTION private.profile_has_permission_in_tenant(p_profile_id uuid, p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (case when p_permission_key in ('reporting.view', 'reports.send', 'reports.send_anytime')
      then private.tenant_module_allowed(p_tenant_id, 'reporting')
      when p_permission_key in ('investment_intent.view', 'investment_intent.manage')
      then private.tenant_module_allowed(p_tenant_id, 'investment_intent')
      else true end)
    and coalesce((
      select case when preset_row.key = 'owner' then true else coalesce(
        (select profile_override.allowed from public.profile_permission_overrides as profile_override
         where profile_override.tenant_id = membership_row.tenant_id
           and profile_override.profile_id = membership_row.profile_id
           and profile_override.permission_key = p_permission_key),
        (select preset_grant.allowed from public.role_permissions as preset_grant
         where preset_grant.role_id = membership_row.role_id
           and preset_grant.permission_key = p_permission_key), false) end
      from public.tenant_memberships as membership_row
      join public.permission_presets as preset_row on preset_row.role_id = membership_row.role_id
      where membership_row.tenant_id = p_tenant_id
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null
        and exists (select 1 from public.permissions as permission where permission.permission_key = p_permission_key)
    ), false);
$function$;

CREATE OR REPLACE FUNCTION public.app_record_store_interest(p_service_ids uuid[], p_in_cart boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- One staff signal per interest row per hour. Long enough that a rapid
  -- remove/re-add loop produces nothing, short enough that a client who
  -- genuinely reconsiders later in the day is still heard.
  renewal_cooldown constant interval := interval '1 hour';
  client_actor record;
  service_row public.services;
  interest_row public.service_interests;
  prior_row public.service_interests;
  company_name text;
  distinct_ids uuid[];
  service_id_value uuid;
  written integer := 0;
begin
  if p_service_ids is null
    or p_in_cart is null
    or array_length(p_service_ids, 1) is null
    or array_length(p_service_ids, 1) > 12
    or exists (
      select 1 from unnest(p_service_ids) as candidate where candidate is null
    )
  then
    raise exception 'invalid Store interest input' using errcode = '22023';
  end if;

  select * into client_actor from private.current_store_client();

  if client_actor.profile_id is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_store');
  if not private.tenant_module_allowed(private.current_tenant_id(), 'investment_intent') then
    raise exception 'Investment Intent access is denied' using errcode = '42501';
  end if;

  -- M-04. Keyed on the server-derived client profile, so one account cannot
  -- consume another account's or another company's allowance. Generous enough
  -- that ordinary cart use never reaches it: a whole cart is one call.
  perform private.consume_rate_limit(
    'store.interest.actor.minute', client_actor.profile_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'store.interest.actor.hour', client_actor.profile_id::text, interval '1 hour', 200
  );

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = client_actor.company_id;

  select array_agg(distinct entry) into distinct_ids
  from unnest(p_service_ids) as entry;

  foreach service_id_value in array distinct_ids
  loop
    -- Re-states services_authenticated_select_active, because RLS does not
    -- apply inside a SECURITY DEFINER function.
    select * into service_row
    from public.services as candidate
    where candidate.id = service_id_value
      and candidate.is_active
      and candidate.is_public
      and candidate.tenant_id = (select private.current_tenant_id())
      and candidate.archived_at is null;

    if service_row.id is null then
      continue;
    end if;

    select * into prior_row
    from public.service_interests as existing
    where existing.company_id = client_actor.company_id
      and existing.service_id = service_id_value
    for update;

    if p_in_cart then
      if prior_row.id is null then
        insert into public.service_interests (
          company_id,
          service_id,
          status,
          in_cart,
          add_count,
          first_added_at,
          last_added_at,
          last_activity_at,
          last_notified_at,
          signalled_by_profile_id
        )
        values (
          client_actor.company_id,
          service_id_value,
          'new',
          true,
          1,
          now(),
          now(),
          now(),
          now(),
          client_actor.profile_id
        )
        on conflict (company_id, service_id) do nothing
        returning * into interest_row;

        -- A concurrent first add won the race and already emitted the signal.
        if interest_row.id is null then
          continue;
        end if;

        written := written + 1;

        perform private.emit_investment_intent_notification(
          'service-interest-new:' || interest_row.id::text,
          'New investment interest',
          coalesce(company_name, 'A client') || ' showed interest in ' || service_row.name || '.',
          interest_row.id,
          client_actor.company_id,
          client_actor.profile_id
        );

      elsif not prior_row.in_cart then
        -- Renewed interest. status is deliberately untouched: a client re-adding
        -- something must not silently reopen a decision William already made.
        -- The state change is always recorded; only the staff signal is
        -- coalesced, and the row itself carries the cooldown anchor so two
        -- concurrent calls cannot both emit (the row is already locked above).
        update public.service_interests as target
        set in_cart = true,
            removed_at = null,
            last_added_at = now(),
            last_activity_at = now(),
            add_count = target.add_count + 1,
            last_notified_at = case
              when target.last_notified_at is null
                or target.last_notified_at < now() - renewal_cooldown
              then now()
              else target.last_notified_at
            end
        where target.id = prior_row.id
        returning * into interest_row;

        written := written + 1;

        if prior_row.last_notified_at is null
          or prior_row.last_notified_at < now() - renewal_cooldown
        then
          perform private.emit_investment_intent_notification(
            'service-interest-renewed:' || interest_row.id::text || ':' || interest_row.add_count::text,
            'Renewed investment interest',
            coalesce(company_name, 'A client') || ' added ' || service_row.name || ' back to their cart.',
            interest_row.id,
            client_actor.company_id,
            client_actor.profile_id
          );
        end if;
      end if;

      -- Already in the cart: no write, no notification, and no reordering of
      -- the workspace from a repeated click.

    else
      if prior_row.id is not null and prior_row.in_cart then
        -- History is preserved. Removal is a state change, never a delete.
        update public.service_interests as target
        set in_cart = false,
            removed_at = now(),
            last_activity_at = now()
        where target.id = prior_row.id;

        written := written + 1;
      end if;

      -- Removing something that was never signalled creates nothing.
    end if;
  end loop;

  return written;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_create_ticket(p_request_id uuid, p_payload jsonb)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor record;
  ticket_row public.tickets;
  initial_message public.ticket_messages;
  company_id_value uuid;
  client_profile_id_value uuid;
  priority_value text := coalesce(p_payload ->> 'priority', 'normal');
  investment_service_id_value uuid;
  existing_id uuid;
begin
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['company_id', 'client_profile_id', 'subject', 'message', 'priority',
      'investment_service_id'] <> '{}'::jsonb
    or nullif(btrim(p_payload ->> 'subject'), '') is null
    or nullif(btrim(p_payload ->> 'message'), '') is null
    or char_length(p_payload ->> 'subject') > 500
    or char_length(p_payload ->> 'message') > 50000
    or priority_value not in ('low', 'normal', 'high', 'urgent')
  then raise exception 'invalid Ticket creation input' using errcode = '22023'; end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then raise exception 'verified authentication is required' using errcode = '42501'; end if;
  perform private.require_permission('tickets.create');

  existing_id := private.find_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload);
  if existing_id is not null then
    -- A replay only returns a Ticket of the current Tenant.
    select * into ticket_row from public.tickets
    where id = existing_id and tenant_id = (select private.current_tenant_id());
    if not found then raise no_data_found; end if;
    return ticket_row;
  end if;

  -- New investment conversations name a Tenant-validated Service FK below.
  -- Accepted request replays remain ordinary authorized Ticket reads.
  if nullif(p_payload ->> 'investment_service_id', '') is not null then
    if not private.tenant_module_allowed(private.current_tenant_id(), 'investment_intent')
      or not private.tenant_module_allowed(private.current_tenant_id(), 'tickets') then
      raise exception 'Investment Ticket access is denied' using errcode = '42501';
    end if;
  end if;

  -- M-04. A client opening conversations is the cheapest way to manufacture
  -- staff work; internal accounts open Tickets on behalf of clients and get a
  -- correspondingly higher allowance.
  if actor.role_name = 'client' then
    perform private.consume_rate_limit(
      'ticket.create.client.hour', actor.profile_id::text, interval '1 hour', 10
    );
    perform private.consume_rate_limit(
      'ticket.create.client.day', actor.profile_id::text, interval '1 day', 30
    );
  else
    perform private.consume_rate_limit(
      'ticket.create.internal.hour', actor.profile_id::text, interval '1 hour', 60
    );
    perform private.consume_rate_limit(
      'ticket.create.internal.day', actor.profile_id::text, interval '1 day', 300
    );
  end if;

  if actor.role_name = 'client' then
    company_id_value := actor.company_id;
    client_profile_id_value := actor.profile_id;
    if company_id_value is null then raise exception 'client company is required' using errcode = '42501'; end if;
    if priority_value <> 'normal' then
      raise exception 'client cannot set Ticket priority' using errcode = '42501';
    end if;
    if p_payload ? 'company_id' and (p_payload ->> 'company_id')::uuid is distinct from company_id_value then
      raise exception 'Ticket company context cannot be spoofed' using errcode = '42501';
    end if;
    if p_payload ? 'client_profile_id' and (p_payload ->> 'client_profile_id')::uuid is distinct from client_profile_id_value then
      raise exception 'Ticket client context cannot be spoofed' using errcode = '42501';
    end if;
  else
    company_id_value := (p_payload ->> 'company_id')::uuid;
    client_profile_id_value := (p_payload ->> 'client_profile_id')::uuid;
    if company_id_value is null or not exists (
      select 1 from public.companies where id = company_id_value and tenant_id = (select private.current_tenant_id()) and archived_at is null
    ) then raise exception 'active Ticket company is required' using errcode = '23503'; end if;
    if client_profile_id_value is not null and not exists (
      select 1 from public.tenant_memberships as membership_row
      join public.roles as role_row on role_row.id = membership_row.role_id
      where membership_row.tenant_id = (select private.current_tenant_id())
        and membership_row.profile_id = client_profile_id_value
        and membership_row.company_id = company_id_value
        and membership_row.archived_at is null and role_row.name = 'client'
    ) then raise exception 'Ticket client must belong to the selected company' using errcode = '23514'; end if;
  end if;

  -- An investment conversation is a normal explicit Ticket that additionally
  -- names the service the client showed interest in. It is never linked to an
  -- Order: order_id stays null on every row this branch can produce, because
  -- nothing in this function ever writes that column.
  if nullif(p_payload ->> 'investment_service_id', '') is not null then
    investment_service_id_value := (p_payload ->> 'investment_service_id')::uuid;
    if not exists (
      select 1 from public.services where id = investment_service_id_value and tenant_id = (select private.current_tenant_id())
    ) then
      raise exception 'investment conversation service does not exist' using errcode = '23503';
    end if;
  end if;

  insert into public.tickets (
    company_id, client_profile_id, subject, status, priority, created_by_profile_id,
    investment_service_id
  ) values (
    company_id_value, client_profile_id_value, btrim(p_payload ->> 'subject'),
    'open', priority_value, actor.profile_id,
    investment_service_id_value
  ) returning * into ticket_row;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    ticket_row.id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'initial_request', 'client', btrim(p_payload ->> 'message'), p_request_id
  ) returning * into initial_message;

  perform private.record_ticket_activity(
    ticket_row.id, 'ticket.created', 'Created Ticket.',
    jsonb_build_object('company_id', company_id_value, 'initial_message_id', initial_message.id),
    actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload, ticket_row.id);
  return ticket_row;
end;
$function$;

-- The existing admin branch may read historical activity; published policy still narrows it.
create policy activity_events_published_investment_intent on public.activity_events
as restrictive for select to authenticated
using (entity_type <> 'service_interest'
  or public.app_has_permission('investment_intent.view'));
