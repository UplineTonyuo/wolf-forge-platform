-- Phase 2: app_get_project_conversation, the native Project conversation
-- read path (project_messages / project_message_reactions). The existing
-- Ticket-backed app_get_order_conversation is not exercised here and is not
-- touched by the migration under test.
begin;
select plan(18);

insert into auth.users (id, aud, role, email) values
('fc000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fc-owner@example.invalid'),
('fc000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'fc-client@example.invalid'),
('fc000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'fc-other-company@example.invalid'),
('fc000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'fc-unassigned-staff@example.invalid'),
('fc000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'fc-assigned-staff@example.invalid');

insert into public.companies (id, name, status) values
('fc100000-0000-0000-0000-000000000001', 'Native Read Co', 'client'),
('fc100000-0000-0000-0000-000000000002', 'Other Co', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Fixture Owner'
  where id = 'fc000000-0000-0000-0000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'fc100000-0000-0000-0000-000000000001'
  where id = 'fc000000-0000-0000-0000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'fc100000-0000-0000-0000-000000000002'
  where id = 'fc000000-0000-0000-0000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff')
  where id = 'fc000000-0000-0000-0000-000000000004';
update public.profiles set role_id = (select id from public.roles where name = 'staff')
  where id = 'fc000000-0000-0000-0000-000000000005';

insert into public.orders (id, company_id, service_id, title, assigned_to_profile_id) values
('fc200000-0000-0000-0000-000000000001', 'fc100000-0000-0000-0000-000000000001',
  (select id from public.services where archived_at is null limit 1), 'Native read Project',
  'fc000000-0000-0000-0000-000000000005');
insert into public.orders (id, company_id, service_id, title) values
('fc200000-0000-0000-0000-000000000002', 'fc100000-0000-0000-0000-000000000001',
  (select id from public.services where archived_at is null limit 1), 'Second Project, same company');

-- 1. function exists
select has_function('public', 'app_get_project_conversation', array['uuid'], 'app_get_project_conversation exists');

-- 2/3. execute posture: authenticated can, anon cannot
select ok(has_function_privilege('authenticated', 'public.app_get_project_conversation(uuid)', 'execute'), 'authenticated can execute');
select ok(not has_function_privilege('anon', 'public.app_get_project_conversation(uuid)', 'execute'), 'anonymous execute denied');

-- 4. empty Project (no project_messages rows, no tickets rows either) returns a valid empty shape
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';
select is(
  public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001'),
  '{"order_id":"fc200000-0000-0000-0000-000000000001","messages":[]}'::jsonb,
  'empty Project returns order_id with an empty messages array'
);
reset role;

-- 15. no Ticket row required for the native read to work
select is((select count(*) from public.tickets where order_id = 'fc200000-0000-0000-0000-000000000001'), 0::bigint,
  'no Ticket row exists for this Project, confirming the native path needs none');

-- Fixture messages, inserted directly (no write RPC exists yet in Phase 2).
insert into public.project_messages (id, order_id, author_profile_id, author_type, body, created_at) values
('fc300000-0000-0000-0000-000000000001', 'fc200000-0000-0000-0000-000000000001',
  'fc000000-0000-0000-0000-000000000001', 'internal', 'First native message', now() - interval '2 minutes');
insert into public.project_messages (id, order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text, created_at) values
('fc300000-0000-0000-0000-000000000002', 'fc200000-0000-0000-0000-000000000001',
  'fc000000-0000-0000-0000-000000000002', 'client', 'Client reply to the first message',
  'fc300000-0000-0000-0000-000000000001', 'First native message', now() - interval '1 minute');

-- 12. cross-Project reply cannot leak: replying "into" a sibling Project using
-- a message id from a different order must fail the composite FK.
select throws_ok(
  $$insert into public.project_messages (order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text)
    values ('fc200000-0000-0000-0000-000000000002', 'fc000000-0000-0000-0000-000000000001', 'internal', 'Cross-Project reply attempt',
      'fc300000-0000-0000-0000-000000000001', 'First native message')$$,
  '23503', null, 'reply target must belong to the same order_id'
);

-- 14. reaction vocabulary preserved: an out-of-vocabulary code is rejected
select throws_ok(
  $$insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code)
    values ('fc300000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', 'not-a-real-code')$$,
  '23514', null, 'reaction_code check constraint rejects an unknown code'
);

-- 13. reaction aggregation: two reactors, same code, on the same message
insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code) values
('fc300000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', 'like'),
('fc300000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000002', 'like');

-- 16. read causes no mutation: snapshot counts before/after, call RPC twice
select is((select count(*) from public.project_messages where order_id = 'fc200000-0000-0000-0000-000000000001'), 2::bigint,
  'two fixture messages exist before any RPC read');

set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';
select is(jsonb_array_length(public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages'), 2,
  'owner reads both native messages');
select public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001'); -- second read, discarded
reset role;

select is((select count(*) from public.project_messages where order_id = 'fc200000-0000-0000-0000-000000000001'), 2::bigint,
  'message count unchanged after two RPC reads: the read path performs no mutation');

-- 9/10/11/13. ordering, author identity, reply target, reaction shape -- all
-- asserted against a single owner read of the full conversation.
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000001';
select is(
  public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages' -> 0 ->> 'id',
  'fc300000-0000-0000-0000-000000000001',
  'messages are ordered oldest first (created_at, id)'
);
select is(
  public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages' -> 0 ->> 'author_name',
  'Fixture Owner',
  'author identity resolves the real profile display_name'
);
select is(
  public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages' -> 1 ->> 'reply_to_message_id',
  'fc300000-0000-0000-0000-000000000001',
  'reply target is exposed on the reply message'
);
select is(
  (public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages' -> 0 -> 'reactions' -> 0 ->> 'reaction_count')::int,
  2,
  'reaction aggregation counts both reactors under the shared code'
);
reset role;

-- 8. authorized client caller (same company, is a message author here too) can read
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000002';
select is(jsonb_array_length(public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages'), 2,
  'authorized client caller reads the same native conversation');
reset role;

-- 5. unauthorized: a client at a different company is rejected
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'a different company cannot read this Project conversation'
);
reset role;

-- 6/7. unassigned staff denied, assigned staff (authorized internal caller) allowed
set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000004';
select throws_ok(
  $$select public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'unassigned staff cannot read this Project conversation'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'fc000000-0000-0000-0000-000000000005';
select is(jsonb_array_length(public.app_get_project_conversation('fc200000-0000-0000-0000-000000000001') -> 'messages'), 2,
  'assigned staff (authorized internal caller) can read'
);
reset role;

select * from finish();
rollback;
