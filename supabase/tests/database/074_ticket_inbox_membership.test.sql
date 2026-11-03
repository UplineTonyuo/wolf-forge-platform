-- Ticket -> Inbox conversation membership: the durable `tickets.inbox_added_at`
-- fact, the one RPC that sets it, and the Inbox-only list read the Inbox
-- Tickets pane uses.
--
-- The load-bearing claims here are that this feature copies nothing (one
-- timestamp write, no message or attachment rows), that it does not move any
-- other Ticket axis (status, priority, assignment, archive), and that it
-- widens no access: the same can_access_ticket boundary still decides who sees
-- which Ticket, and the client-facing detail read does not grow a staff-only
-- column.
begin;
select plan(25);

insert into auth.users (id, aud, role, email) values
('f0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'inbox-owner@example.invalid'),
('f0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'inbox-staff@example.invalid'),
('f0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'inbox-client-a@example.invalid'),
('f0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'inbox-client-b@example.invalid');

insert into public.companies (id, name, status) values
('f0100000-0000-0000-0000-000000000001', 'Inbox Co A', 'client'),
('f0100000-0000-0000-0000-000000000002', 'Inbox Co B', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Inbox Owner'
  where id = 'f0000000-0000-0000-0000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Inbox Staff'
  where id = 'f0000000-0000-0000-0000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'f0100000-0000-0000-0000-000000000001'
  where id = 'f0000000-0000-0000-0000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'f0100000-0000-0000-0000-000000000002'
  where id = 'f0000000-0000-0000-0000-000000000004';

-- -----------------------------------------------------------------------------
-- 1. The durable shape
-- -----------------------------------------------------------------------------

select is(
  (select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'tickets' and column_name = 'inbox_added_at'),
  'timestamp with time zone',
  'tickets.inbox_added_at is a timestamptz'
);
select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'tickets' and column_name = 'inbox_added_at'),
  'YES',
  'membership is nullable, so "not in the Inbox" is representable without touching status or archived_at'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'tickets' and column_name = 'inbox_added_at'),
  null,
  'a new Ticket defaults to null: it starts outside the Inbox'
);

select has_function('public', 'app_add_ticket_to_inbox', array['uuid'], 'app_add_ticket_to_inbox exists');
select ok(
  has_function_privilege('authenticated', 'public.app_add_ticket_to_inbox(uuid)', 'execute'),
  'authenticated can execute app_add_ticket_to_inbox'
);
select ok(
  not has_function_privilege('anon', 'public.app_add_ticket_to_inbox(uuid)', 'execute'),
  'anonymous callers cannot execute app_add_ticket_to_inbox'
);
select ok(
  (select procedure.prosecdef and procedure.proconfig @> array['search_path=""']::text[]
   from pg_proc as procedure
   where procedure.oid = 'public.app_add_ticket_to_inbox(uuid)'::regprocedure),
  'app_add_ticket_to_inbox is SECURITY DEFINER with an empty search_path'
);

-- -----------------------------------------------------------------------------
-- 2. Fixtures: three Tickets, none of them in the Inbox
-- -----------------------------------------------------------------------------

insert into public.tickets (id, company_id, client_profile_id, subject, status, priority, assigned_to_profile_id) values
('f0200000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000003', 'Company A support question', 'open', 'high',
  'f0000000-0000-0000-0000-000000000002'),
('f0200000-0000-0000-0000-000000000002', 'f0100000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000003', 'Company A billing question', 'waiting_on_client', 'normal', null),
('f0200000-0000-0000-0000-000000000003', 'f0100000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-000000000004', 'Company B question', 'open', 'low', null);

insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body) values
('f0300000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000003', 'client', 'initial_request', 'client', 'Can you look at this?'),
('f0300000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000001', 'internal', 'internal_note', 'internal', 'Staff-only triage note.'),
('f0300000-0000-0000-0000-000000000003', 'f0200000-0000-0000-0000-000000000003',
  'f0000000-0000-0000-0000-000000000004', 'client', 'initial_request', 'client', 'Company B asks something.');

select is(
  (select count(*) from public.tickets where id in ('f0200000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000003') and inbox_added_at is not null),
  0::bigint,
  'freshly inserted Tickets are outside the Inbox'
);

-- -----------------------------------------------------------------------------
-- 3. The list read model
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.app_list_ticket_summaries(false, true) where ticket_id in ('f0200000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000003')),
  0::bigint,
  'the Inbox-only list is empty while no Ticket has been added'
);
select is(
  (select count(*) from public.app_list_ticket_summaries(false, false) where ticket_id in ('f0200000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000003')),
  3::bigint,
  'the management list is unaffected and still shows every accessible Ticket'
);
reset role;

-- -----------------------------------------------------------------------------
-- 4. The mutation
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001';

select ok(
  (public.app_add_ticket_to_inbox('f0200000-0000-0000-0000-000000000001')).inbox_added_at is not null,
  'adding a Ticket returns the row with membership set'
);
select is(
  (select count(*) from public.app_list_ticket_summaries(false, true) where ticket_id in ('f0200000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000003')),
  1::bigint,
  'the added Ticket is the one Ticket in the Inbox-only list'
);
select is(
  (select ticket_id from public.app_list_ticket_summaries(false, true)
   where ticket_id in ('f0200000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000003')),
  'f0200000-0000-0000-0000-000000000001'::uuid,
  'and it is the right Ticket'
);
reset role;

select is(
  (select count(*) from public.activity_events
   where entity_id = 'f0200000-0000-0000-0000-000000000001' and action = 'ticket.inbox_added'),
  1::bigint,
  'adding a Ticket records exactly one activity event'
);

-- Idempotency: the column itself is the key, so a repeated call is a no-op.
-- Snapshot first: raw public.tickets is deliberately unreadable to
-- authenticated, and this comparison is about the stored value, not the call.
create temporary table inbox_membership_before as
  select added_at as inbox_added_at from private.ticket_inbox_memberships where ticket_id = 'f0200000-0000-0000-0000-000000000001' and profile_id = 'f0000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001';
select public.app_add_ticket_to_inbox('f0200000-0000-0000-0000-000000000001'); -- second call, discarded
reset role;

select is(
  (select added_at from private.ticket_inbox_memberships where ticket_id = 'f0200000-0000-0000-0000-000000000001' and profile_id = 'f0000000-0000-0000-0000-000000000001'),
  (select inbox_added_at from inbox_membership_before),
  'a second add returns the original timestamp rather than restamping it'
);

select is(
  (select count(*) from public.activity_events
   where entity_id = 'f0200000-0000-0000-0000-000000000001' and action = 'ticket.inbox_added'),
  1::bigint,
  'a second add records no second activity event'
);

-- -----------------------------------------------------------------------------
-- 5. It copies nothing and moves nothing else
-- -----------------------------------------------------------------------------

select is(
  (select count(*) from public.ticket_messages where ticket_id = 'f0200000-0000-0000-0000-000000000001'),
  2::bigint,
  'adding a Ticket writes no messages: the conversation is the same rows'
);
select is(
  (select count(*) from public.ticket_attachments where ticket_id = 'f0200000-0000-0000-0000-000000000001'),
  0::bigint,
  'adding a Ticket writes no attachments'
);
select is(
  (select status || '|' || priority || '|' || assigned_to_profile_id::text
     || '|' || coalesce(archived_at::text, '')
   from public.tickets where id = 'f0200000-0000-0000-0000-000000000001'),
  'open|high|f0000000-0000-0000-0000-000000000002|',
  'membership is orthogonal: status, priority, assignment and archive are untouched'
);

-- -----------------------------------------------------------------------------
-- 6. Authorization: the boundary does not widen
-- -----------------------------------------------------------------------------

-- A client holds no tickets.edit, so it cannot add anything to the Inbox.
set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.app_add_ticket_to_inbox('f0200000-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'a client cannot make a Ticket an Inbox conversation'
);
select is(
  (select count(*) from public.app_list_ticket_summaries(false, true) where ticket_id in ('f0200000-0000-0000-0000-000000000001', 'f0200000-0000-0000-0000-000000000002', 'f0200000-0000-0000-0000-000000000003')),
  0::bigint,
  'client accounts do not have an internal personal Inbox'
);
select is(
  (select message_count from public.app_list_ticket_summaries(false, false) where ticket_id = 'f0200000-0000-0000-0000-000000000001'),
  1::bigint,
  'the client-facing message_count still excludes internal notes'
);
select ok(
  not (public.app_get_ticket_detail('f0200000-0000-0000-0000-000000000001') -> 'ticket' ? 'inbox_added_at'),
  'the client-facing Ticket read does not expose the staff-only membership flag'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000002';
select ok(
  public.app_get_ticket_detail('f0200000-0000-0000-0000-000000000001') -> 'ticket' ? 'inbox_added_at',
  'staff still read the membership flag on the same Ticket'
);
reset role;

-- Adding a Ticket the caller cannot see must fail rather than leak whether it exists.
set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_add_ticket_to_inbox('f0200000-0000-0000-0000-0000000000ff')$$,
  'P0002',
  null,
  'adding an unknown Ticket raises no_data_found'
);
reset role;

select * from finish();
rollback;
