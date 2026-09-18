-- =============================================================================
-- Investment Intent -> Investment Conversation
--
-- An Investment Intent row (public.service_interests, one durable row per
-- company_id + service_id) can now be worked as a real conversation. The
-- conversation is an ordinary explicit Ticket that additionally names the
-- service: public.tickets.investment_service_id.
--
-- Deliberately NOT used: no source text column, no entity/reference string, no
-- order_id, and no Project relation. A conversation Ticket's order_id stays
-- null. The foreign key is the sole durable discriminator, so nothing has to be
-- parsed, matched fuzzily, or kept in sync with a parallel vocabulary.
--
-- Two indexes carry the two different questions:
--   * tickets_investment_service_idx  -- "which conversations are about this
--     service?" (ordinary lookup, non-unique)
--   * tickets_active_investment_conversation_unique -- "does this client
--     already have a LIVE conversation about this service?" (partial unique,
--     so a second active conversation is unrepresentable rather than merely
--     unlikely, while a resolved or closed one leaves room for a later one)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The durable discriminator
-- -----------------------------------------------------------------------------

alter table public.tickets
  add column if not exists investment_service_id uuid
    references public.services (id) on delete restrict;

comment on column public.tickets.investment_service_id is
  'Identifies a client-facing Investment Intent conversation: the staff-opened Ticket about one client''s recorded interest in one investment. Null for every other Ticket, including fulfillment Tickets (which carry order_id) and ordinary support Tickets. order_id stays null whenever this is set.';

-- -----------------------------------------------------------------------------
-- 2. Lookup index
-- -----------------------------------------------------------------------------

create index if not exists tickets_investment_service_idx
  on public.tickets (investment_service_id)
  where investment_service_id is not null;

-- -----------------------------------------------------------------------------
-- 3. At most one ACTIVE conversation per client + investment
--
-- Active is open / in_progress / waiting_on_client / waiting_on_team. Resolved
-- and closed are terminal: once a conversation is finished, a later one for the
-- same pair is allowed and expected. The database, not the UI, decides this --
-- two staff clicking Create at the same moment collide here, and the loser gets
-- a real conflict rather than a silently duplicated conversation.
-- -----------------------------------------------------------------------------

create unique index if not exists tickets_active_investment_conversation_unique
  on public.tickets (company_id, investment_service_id)
  where investment_service_id is not null
    and status not in ('resolved', 'closed');

-- =============================================================================
-- 4. app_create_ticket gains investment_service_id
--
-- Same signature (uuid, jsonb), same authorization, same idempotency, same
-- throttles, same activity record. The only change is one more allowed payload
-- key. Every currently-allowed key behaves exactly as before and unknown keys
-- still fail, so an existing caller cannot start sending something new by
-- accident.
-- =============================================================================

create or replace function public.app_create_ticket(p_request_id uuid, p_payload jsonb)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
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
    select * into ticket_row from public.tickets where id = existing_id;
    return ticket_row;
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
      select 1 from public.companies where id = company_id_value and archived_at is null
    ) then raise exception 'active Ticket company is required' using errcode = '23503'; end if;
    if client_profile_id_value is not null and not exists (
      select 1 from public.profiles as profile_row
      join public.roles as role_row on role_row.id = profile_row.role_id
      where profile_row.id = client_profile_id_value
        and profile_row.company_id = company_id_value
        and profile_row.archived_at is null and role_row.name = 'client'
    ) then raise exception 'Ticket client must belong to the selected company' using errcode = '23514'; end if;
  end if;

  -- An investment conversation is a normal explicit Ticket that additionally
  -- names the service the client showed interest in. It is never linked to an
  -- Order: order_id stays null on every row this branch can produce, because
  -- nothing in this function ever writes that column.
  if nullif(p_payload ->> 'investment_service_id', '') is not null then
    investment_service_id_value := (p_payload ->> 'investment_service_id')::uuid;
    if not exists (
      select 1 from public.services where id = investment_service_id_value
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
$$;


-- =============================================================================
-- 5. app_list_investment_intents reports whether a conversation is live
--
-- PostgreSQL cannot CREATE OR REPLACE a function whose RETURNS TABLE shape
-- changed, so the function is dropped and recreated. Drop loses its grants and
-- comment, so the original revoke / grant execute / security posture are
-- restored verbatim below -- the access surface is identical to before.
-- =============================================================================

drop function if exists public.app_list_investment_intents(integer);

create function public.app_list_investment_intents(
  p_limit integer default 200
)
returns table (
  intent_id uuid,
  company_id uuid,
  company_name text,
  service_id uuid,
  service_name text,
  folder_name text,
  price numeric,
  currency text,
  recurring boolean,
  recurring_price numeric,
  recurring_interval_length integer,
  recurring_interval_unit text,
  status text,
  in_cart boolean,
  add_count integer,
  first_added_at timestamptz,
  last_added_at timestamptz,
  removed_at timestamptz,
  last_activity_at timestamptz,
  contacted_at timestamptz,
  contacted_by_profile_id uuid,
  contacted_by_name text,
  updated_at timestamptz,
  -- Which staff-opened investment conversation is live for this client and
  -- this investment, if any. Advisory: the partial unique index on
  -- public.tickets is the authority that prevents a second one.
  active_ticket_id uuid,
  active_ticket_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  perform public.app_require_module_access('investment_intent');

  return query
  select
    interest.id,
    interest.company_id,
    company_row.name,
    interest.service_id,
    service_row.name,
    folder_row.name,
    service_row.price,
    service_row.currency,
    service_row.recurring,
    service_row.recurring_price,
    service_row.recurring_interval_length,
    service_row.recurring_interval_unit,
    interest.status,
    interest.in_cart,
    interest.add_count,
    interest.first_added_at,
    interest.last_added_at,
    interest.removed_at,
    interest.last_activity_at,
    interest.contacted_at,
    interest.contacted_by_profile_id,
    contacted_profile.display_name,
    interest.updated_at,
    active_ticket.id,
    active_ticket.status
  from public.service_interests as interest
  join public.companies as company_row
    on company_row.id = interest.company_id
  join public.services as service_row
    on service_row.id = interest.service_id
  left join public.service_folders as folder_row
    on folder_row.id = service_row.folder_id
  left join public.profiles as contacted_profile
    on contacted_profile.id = interest.contacted_by_profile_id
  -- tickets_active_investment_conversation_unique guarantees at most one live
  -- conversation per (company_id, investment_service_id), so this left join can
  -- never fan one interest row out into two.
  left join public.tickets as active_ticket
    on active_ticket.company_id = interest.company_id
   and active_ticket.investment_service_id = interest.service_id
   and active_ticket.status not in ('resolved', 'closed')
  order by interest.last_activity_at desc, interest.id
  limit row_limit;
end;
$$;


revoke all on function public.app_list_investment_intents(integer)
  from public, anon, service_role;

grant execute on function public.app_list_investment_intents(integer)
  to authenticated;

comment on function public.app_list_investment_intents(integer) is
  'Internal Investment Intent read model, ordered by latest client activity. Gated by the investment_intent module. Reports the live investment conversation for each interest, if one exists.';
