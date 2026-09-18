begin;

select plan(31);

-- =============================================================================
-- FIXTURES
--
-- Two unrelated client companies and two services, so the active-conversation
-- uniqueness can be exercised across both axes it is keyed on: a second
-- conversation for the SAME company + service must be refused, while a
-- different service (same company) and a different company (same service) must
-- both be allowed. Every write goes through app_create_ticket as a real
-- authenticated session, so this exercises the permission boundary and the
-- SECURITY DEFINER resolver rather than inserting rows directly.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('80000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'ic-owner@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('81000000-0000-4000-8000-00000000000a', 'Ironclad Dental'),
  ('81000000-0000-4000-8000-00000000000b', 'Ironclad Legal');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'IC Owner', company_id = null
from public.roles as role_row
where role_row.name = 'owner'
  and profile_row.id = '80000000-0000-4000-8000-000000000001';

insert into public.service_folders (id, name, sort_order)
values ('82000000-0000-4000-8000-000000000001', 'IC Search', 1);

insert into public.services (id, name, folder_id, price, is_active, is_public, archived_at)
values
  ('83000000-0000-4000-8000-000000000001', 'IC Local SEO',
   '82000000-0000-4000-8000-000000000001', 500, true, true, null),
  ('83000000-0000-4000-8000-000000000002', 'IC Maps Sprint',
   '82000000-0000-4000-8000-000000000001', 250, true, true, null);

-- The read model is asserted below, and only one interest row per pair is
-- legal anyway, so this is plain fixture data rather than a client write.
insert into public.service_interests (company_id, service_id)
values
  ('81000000-0000-4000-8000-00000000000a', '83000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-00000000000a', '83000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-00000000000b', '83000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-00000000000b', '83000000-0000-4000-8000-000000000002');

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- =============================================================================
-- 1. STRUCTURE
-- =============================================================================

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets'
      and column_name = 'investment_service_id' and data_type = 'uuid'
      and is_nullable = 'YES'
  ),
  'tickets.investment_service_id exists as a nullable uuid'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tickets'::regclass
      and contype = 'f'
      and confrelid = 'public.services'::regclass
      and pg_get_constraintdef(oid) like '%%investment_service_id%%'
      and pg_get_constraintdef(oid) like '%%ON DELETE RESTRICT%%'
  ),
  'investment_service_id is a real FK to services with ON DELETE RESTRICT'
);

select ok(
  exists (
    select 1 from pg_index
    where indexrelid = 'public.tickets_investment_service_idx'::regclass
      and not indisunique
      and indpred is not null
  ),
  'tickets_investment_service_idx exists as a non-unique partial lookup index'
);

select is(
  (
    select pg_get_expr(indpred, indrelid)
    from pg_index
    where indexrelid = 'public.tickets_active_investment_conversation_unique'::regclass
      and indisunique
  ),
  '((investment_service_id IS NOT NULL) AND (status <> ALL (ARRAY[''resolved''::text, ''closed''::text])))',
  'tickets_active_investment_conversation_unique is a unique index whose predicate excludes exactly resolved and closed'
);

select is(
  (
    select pg_get_expr(indpred, indrelid)
    from pg_index
    where indexrelid = 'public.tickets_investment_service_idx'::regclass
  ),
  '(investment_service_id IS NOT NULL)',
  'the lookup index covers non-null investment_service_id only'
);

-- =============================================================================
-- 2. ORDINARY SUPPORT TICKETS ARE UNCHANGED
-- =============================================================================

set local role authenticated;
select pg_temp.become('80000000-0000-4000-8000-000000000001');

select ok(
  (
    select created.investment_service_id is null and created.order_id is null
    from (
      select * from public.app_create_ticket(
        '8a000000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'company_id', '81000000-0000-4000-8000-00000000000a',
          'subject', 'Ordinary support question',
          'message', 'Nothing to do with investments.',
          'priority', 'normal'
        )
      )
    ) as created
  ),
  'an ordinary Ticket still creates with investment_service_id and order_id both null'
);

select throws_ok(
  $$select public.app_create_ticket(
      '8a000000-0000-4000-8000-000000000002',
      jsonb_build_object(
        'company_id', '81000000-0000-4000-8000-00000000000a',
        'subject', 'Smuggled key',
        'message', 'This payload carries a key the whitelist does not allow.',
        'priority', 'normal',
        'relationship_model', 'fuzzy'
      )
    )$$,
  '22023', null,
  'an unknown payload key is still rejected after the whitelist was extended'
);

select throws_ok(
  $$select public.app_create_ticket(
      '8a000000-0000-4000-8000-000000000003',
      jsonb_build_object(
        'company_id', '81000000-0000-4000-8000-00000000000a',
        'subject', 'Bad priority',
        'message', 'Priority vocabulary is unchanged.',
        'priority', 'whenever'
      )
    )$$,
  '22023', null,
  'the existing priority vocabulary still rejects an unknown value'
);

-- =============================================================================
-- 3. INVESTMENT CONVERSATIONS
--
-- The Ticket is ordinary in every way except that it names the service. The
-- assertions pin the two properties that must never drift: order_id stays null,
-- and the active-conversation rule is enforced by the index rather than by the
-- application.
-- =============================================================================

select ok(
  (
    select created.investment_service_id = '83000000-0000-4000-8000-000000000001'
      and created.order_id is null
      and created.company_id = '81000000-0000-4000-8000-00000000000a'
    from (
      select * from public.app_create_ticket(
        '8a000000-0000-4000-8000-000000000010',
        jsonb_build_object(
          'company_id', '81000000-0000-4000-8000-00000000000a',
          'investment_service_id', '83000000-0000-4000-8000-000000000001',
          'subject', 'Interested in IC Local SEO',
          'message', 'Hi there, we noticed your interest.',
          'priority', 'normal'
        )
      )
    ) as created
  ),
  'app_create_ticket accepts investment_service_id and produces a Ticket with order_id null'
);

reset role;

select is(
  (
    select count(*)::integer from public.tickets
    where company_id = '81000000-0000-4000-8000-00000000000a'
      and investment_service_id = '83000000-0000-4000-8000-000000000001'
      and order_id is null
  ),
  1,
  'the investment conversation is persisted with order_id null, so it is never a fulfillment Ticket'
);

set local role authenticated;
select pg_temp.become('80000000-0000-4000-8000-000000000001');

select throws_ok(
  $$select public.app_create_ticket(
      '8a000000-0000-4000-8000-000000000011',
      jsonb_build_object(
        'company_id', '81000000-0000-4000-8000-00000000000a',
        'investment_service_id', '83000000-0000-4000-8000-000000000001',
        'subject', 'Second attempt',
        'message', 'A second active conversation for the same pair must not exist.',
        'priority', 'normal'
      )
    )$$,
  '23505', null,
  'a second ACTIVE conversation for the same company + investment is rejected by the unique index'
);

select ok(
  (
    select created.investment_service_id = '83000000-0000-4000-8000-000000000002'
    from (
      select * from public.app_create_ticket(
        '8a000000-0000-4000-8000-000000000012',
        jsonb_build_object(
          'company_id', '81000000-0000-4000-8000-00000000000a',
          'investment_service_id', '83000000-0000-4000-8000-000000000002',
          'subject', 'Interested in IC Maps Sprint',
          'message', 'Same client, a different investment.',
          'priority', 'normal'
        )
      )
    ) as created
  ),
  'the same company can hold an active conversation about a different investment'
);

select ok(
  (
    select created.investment_service_id = '83000000-0000-4000-8000-000000000001'
    from (
      select * from public.app_create_ticket(
        '8a000000-0000-4000-8000-000000000013',
        jsonb_build_object(
          'company_id', '81000000-0000-4000-8000-00000000000b',
          'investment_service_id', '83000000-0000-4000-8000-000000000001',
          'subject', 'Interested in IC Local SEO',
          'message', 'A different client, the same investment.',
          'priority', 'normal'
        )
      )
    ) as created
  ),
  'a different company can hold its own active conversation about the same investment'
);

reset role;

select throws_ok(
  $$set local role authenticated;
    select pg_temp.become('80000000-0000-4000-8000-000000000001');
    select public.app_create_ticket(
      '8a000000-0000-4000-8000-000000000014',
      jsonb_build_object(
        'company_id', '81000000-0000-4000-8000-00000000000a',
        'investment_service_id', '83000000-0000-4000-8000-0000000000ff',
        'subject', 'Unknown investment',
        'message', 'The service id does not exist.',
        'priority', 'normal'
      )
    )$$,
  '23503', null,
  'an investment_service_id that references no real service is refused'
);

-- =============================================================================
-- 4. RESOLVED AND CLOSED ARE TERMINAL, NOT PERMANENT
--
-- Finishing a conversation is what makes the next one possible. Resolving and
-- closing are asserted separately because they are two different transitions
-- that both have to leave the pair open again.
-- =============================================================================

-- Captured here, while still the migration role, so the read-model assertions
-- further down can prove the live conversation is not this one without an
-- authenticated session needing to read public.tickets at all.
create temp table ic_prior_conversation as
select id from public.tickets
where company_id = '81000000-0000-4000-8000-00000000000a'
  and investment_service_id = '83000000-0000-4000-8000-000000000001';

grant select on ic_prior_conversation to authenticated;

update public.tickets
set status = 'resolved', resolved_at = now()
where company_id = '81000000-0000-4000-8000-00000000000a'
  and investment_service_id = '83000000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.become('80000000-0000-4000-8000-000000000001');

select ok(
  (
    select created.id is not null
    from (
      select * from public.app_create_ticket(
        '8a000000-0000-4000-8000-000000000020',
        jsonb_build_object(
          'company_id', '81000000-0000-4000-8000-00000000000a',
          'investment_service_id', '83000000-0000-4000-8000-000000000001',
          'subject', 'Interested in IC Local SEO again',
          'message', 'The previous conversation was resolved.',
          'priority', 'normal'
        )
      )
    ) as created
  ),
  'a resolved conversation no longer blocks a later one for the same company + investment'
);

reset role;

update public.tickets
set status = 'closed', closed_at = now(), resolved_at = null
where company_id = '81000000-0000-4000-8000-00000000000a'
  and investment_service_id = '83000000-0000-4000-8000-000000000001'
  and status = 'open';

set local role authenticated;
select pg_temp.become('80000000-0000-4000-8000-000000000001');

select ok(
  (
    select created.id is not null
    from (
      select * from public.app_create_ticket(
        '8a000000-0000-4000-8000-000000000021',
        jsonb_build_object(
          'company_id', '81000000-0000-4000-8000-00000000000a',
          'investment_service_id', '83000000-0000-4000-8000-000000000001',
          'subject', 'Interested in IC Local SEO once more',
          'message', 'The previous conversation was closed.',
          'priority', 'normal'
        )
      )
    ) as created
  ),
  'a closed conversation no longer blocks a later one for the same company + investment'
);

reset role;

-- =============================================================================
-- 5. READ MODEL
-- =============================================================================

select ok(
  position('active_ticket_id' in pg_get_function_result('public.app_list_investment_intents(integer)'::regprocedure)) > 0
    and position('active_ticket_status' in pg_get_function_result('public.app_list_investment_intents(integer)'::regprocedure)) > 0,
  'app_list_investment_intents reports active_ticket_id and active_ticket_status'
);

select ok(
  not has_function_privilege('anon', 'public.app_list_investment_intents(integer)', 'execute')
    and not has_function_privilege('service_role', 'public.app_list_investment_intents(integer)', 'execute')
    and has_function_privilege('authenticated', 'public.app_list_investment_intents(integer)', 'execute'),
  'the drop and recreate restored the original execute grants exactly'
);

select ok(
  (
    select prosecdef
      and provolatile = 's'
      and exists (select 1 from unnest(proconfig) as setting where setting like 'search_path=%')
    from pg_proc where oid = 'public.app_list_investment_intents(integer)'::regprocedure
  ),
  'the recreated read model is still security definer, stable, and search_path-pinned'
);

select ok(
  not has_function_privilege('anon', 'public.app_create_ticket(uuid,jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.app_create_ticket(uuid,jsonb)', 'execute'),
  'app_create_ticket execute grants are unchanged by the CREATE OR REPLACE'
);

set local role authenticated;
select pg_temp.become('80000000-0000-4000-8000-000000000001');

select is(
  (
    select row.active_ticket_status
    from public.app_list_investment_intents(500) as row
    where row.company_id = '81000000-0000-4000-8000-00000000000a'
      and row.service_id = '83000000-0000-4000-8000-000000000001'
  ),
  'open',
  'a row with a live conversation reports its status'
);

select ok(
  (
    select row.active_ticket_id is not null
    from public.app_list_investment_intents(500) as row
    where row.company_id = '81000000-0000-4000-8000-00000000000a'
      and row.service_id = '83000000-0000-4000-8000-000000000001'
  ),
  'a row with a live conversation reports the Ticket id it can open'
);

select ok(
  (
    select row.active_ticket_id is null and row.active_ticket_status is null
    from public.app_list_investment_intents(500) as row
    where row.company_id = '81000000-0000-4000-8000-00000000000b'
      and row.service_id = '83000000-0000-4000-8000-000000000002'
  ),
  'an interest with no conversation reports nulls rather than inventing one'
);

select ok(
  (
    select row.active_ticket_id is not null
      and row.active_ticket_id <> (select id from ic_prior_conversation)
    from public.app_list_investment_intents(500) as row
    where row.company_id = '81000000-0000-4000-8000-00000000000a'
      and row.service_id = '83000000-0000-4000-8000-000000000001'
  ),
  'the reported conversation is the live one, not an earlier resolved or closed Ticket'
);

reset role;

select ok(
  (
    select count(*)::integer = 1
    from public.tickets
    where company_id = '81000000-0000-4000-8000-00000000000a'
      and investment_service_id = '83000000-0000-4000-8000-000000000001'
      and status not in ('resolved', 'closed')
  ),
  'exactly one active conversation exists for the pair after resolve, close and reopen'
);

select ok(
  (
    select bool_and(order_id is null)
    from public.tickets
    where investment_service_id is not null
  ),
  'no investment conversation anywhere carries an order_id'
);

select ok(
  (
    select count(*)::integer > 1
    from public.tickets
    where company_id = '81000000-0000-4000-8000-00000000000a'
      and investment_service_id = '83000000-0000-4000-8000-000000000001'
  ),
  'the historical conversations are retained rather than replaced'
);

select is(
  (
    select count(*)::integer
    from public.service_interests
    where company_id = '81000000-0000-4000-8000-00000000000a'
      and service_id = '83000000-0000-4000-8000-000000000001'
  ),
  1,
  'Investment Intent itself is one durable row per company + investment, untouched by conversation history'
);

select ok(
  (
    select bool_and(status = 'new')
    from public.service_interests
    where company_id = '81000000-0000-4000-8000-00000000000a'
  ),
  'creating a conversation never moved the Investment Intent pipeline status'
);

select ok(
  exists (
    select 1
    from public.tickets as ticket_row
    join public.activity_events as event_row
      on event_row.entity_type = 'ticket' and event_row.entity_id = ticket_row.id
    where ticket_row.investment_service_id is not null
  ),
  'a created conversation still writes the ordinary ticket.created activity record'
);

select ok(
  (
    select bool_and(
      status in ('open', 'in_progress', 'waiting_on_client', 'waiting_on_team', 'resolved', 'closed')
        and priority = 'normal'
        and client_profile_id is null
    )
    from public.tickets
    where investment_service_id is not null
  ),
  'an investment conversation is an ordinary explicit Ticket: normal status vocabulary, normal priority, no client profile'
);

select * from finish();
rollback;
