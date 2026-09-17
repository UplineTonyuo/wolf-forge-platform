begin;
select plan(29);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('fe000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'proj-internal@example.invalid', now(), now()),
  ('fe000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'proj-client@example.invalid', now(), now()),
  ('fe000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'proj-reactor-only@example.invalid', now(), now());

insert into public.companies (id, name, status) values
  ('fe100000-0000-4000-8000-000000000001', 'Project Foundation Co', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Proj Internal'
where id = 'fe000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'fe100000-0000-4000-8000-000000000001', display_name = 'Proj Client'
where id = 'fe000000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'fe100000-0000-4000-8000-000000000001', display_name = 'Reactor Only'
where id = 'fe000000-0000-4000-8000-000000000003';

insert into public.orders (id, company_id, service_id, title) values
  ('fe200000-0000-4000-8000-000000000001', 'fe100000-0000-4000-8000-000000000001',
   (select id from public.services where archived_at is null limit 1), 'Project A'),
  ('fe200000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001',
   (select id from public.services where archived_at is null limit 1), 'Project B');

-- -----------------------------------------------------------------------------
-- Security surface: no browser-reachable role can touch these tables
-- directly yet (Phase 1 ships no read/write RPC suite).
-- -----------------------------------------------------------------------------

select ok(
  to_regclass('public.project_messages') is not null
  and to_regclass('public.project_attachments') is not null
  and to_regclass('public.project_message_reactions') is not null,
  'all three Project-native conversation tables exist'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.project_messages'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.project_attachments'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.project_message_reactions'::regclass),
  'row level security is enabled on all three tables'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.project_message_reactions'::regclass),
  'row level security is forced on project_message_reactions, matching ticket_message_reactions'
);

select ok(not has_table_privilege('authenticated', 'public.project_messages', 'SELECT'),
  'authenticated cannot select project_messages directly');
select ok(not has_table_privilege('authenticated', 'public.project_messages', 'INSERT'),
  'authenticated cannot insert project_messages directly');
select ok(not has_table_privilege('authenticated', 'public.project_attachments', 'SELECT'),
  'authenticated cannot select project_attachments directly');
select ok(not has_table_privilege('authenticated', 'public.project_attachments', 'INSERT'),
  'authenticated cannot insert project_attachments directly');
select ok(not has_table_privilege('authenticated', 'public.project_message_reactions', 'SELECT'),
  'authenticated cannot select project_message_reactions directly');
select ok(not has_table_privilege('authenticated', 'public.project_message_reactions', 'INSERT'),
  'authenticated cannot insert project_message_reactions directly');

select ok(
  has_table_privilege('service_role', 'public.project_messages', 'SELECT')
  and has_table_privilege('service_role', 'public.project_messages', 'INSERT'),
  'service_role retains select/insert on project_messages, matching ticket_messages'
);
select ok(
  has_table_privilege('service_role', 'public.project_attachments', 'SELECT')
  and has_table_privilege('service_role', 'public.project_attachments', 'INSERT'),
  'service_role retains select/insert on project_attachments, matching ticket_attachments'
);
select ok(
  not has_table_privilege('service_role', 'public.project_message_reactions', 'SELECT')
  and not has_table_privilege('service_role', 'public.project_message_reactions', 'INSERT'),
  'project_message_reactions is fully locked even for service_role, matching ticket_message_reactions'
);

-- -----------------------------------------------------------------------------
-- project_messages: valid inserts, idempotency, reply/ownership constraints
-- -----------------------------------------------------------------------------

insert into public.project_messages (id, order_id, author_profile_id, author_type, body, request_id) values
  ('ff000000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000001', 'internal', 'Kickoff message', 'ab000000-0000-4000-8000-000000000001');
select is(
  (select body from public.project_messages where id = 'ff000000-0000-4000-8000-000000000001'),
  'Kickoff message',
  'a valid Project message insert succeeds'
);

insert into public.project_messages (id, order_id, author_profile_id, author_type, body, request_id) values
  ('ff000000-0000-4000-8000-000000000002', 'fe200000-0000-4000-8000-000000000002',
   'fe000000-0000-4000-8000-000000000001', 'internal', 'Other Project message', 'ab000000-0000-4000-8000-000000000002');

select throws_ok(
  $$insert into public.project_messages (id, order_id, author_profile_id, author_type, body, request_id) values
    ('ff000000-0000-4000-8000-000000000009', 'fe200000-0000-4000-8000-000000000001',
     'fe000000-0000-4000-8000-000000000001', 'internal', 'Duplicate request id', 'ab000000-0000-4000-8000-000000000001')$$,
  '23505', null,
  'request_id/idempotency uniqueness is enforced per Project'
);

select throws_ok(
  $$insert into public.project_messages (id, order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text) values
    ('ff000000-0000-4000-8000-000000000010', 'fe200000-0000-4000-8000-000000000001',
     'fe000000-0000-4000-8000-000000000001', 'internal', 'Cross-Project reply attempt',
     'ff000000-0000-4000-8000-000000000002', 'Other Project message')$$,
  '23503', null,
  'a reply cannot target a message from another Project'
);

insert into public.project_messages (id, order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text) values
  ('ff000000-0000-4000-8000-000000000003', 'fe200000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000001', 'internal', 'Same-Project reply',
   'ff000000-0000-4000-8000-000000000001', 'Kickoff message');
select is(
  (select reply_to_message_id from public.project_messages where id = 'ff000000-0000-4000-8000-000000000003'),
  'ff000000-0000-4000-8000-000000000001'::uuid,
  'a same-Project reply succeeds and persists its source'
);

select throws_ok(
  $$insert into public.project_messages (id, order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text) values
    ('ff000000-0000-4000-8000-000000000011', 'fe200000-0000-4000-8000-000000000001',
     'fe000000-0000-4000-8000-000000000001', 'internal', 'Blank quote reply',
     'ff000000-0000-4000-8000-000000000001', '')$$,
  '23514', null,
  'a reply with a blank quote violates the reply shape constraint'
);

select throws_ok(
  $$insert into public.project_messages (id, order_id, author_profile_id, author_type, body) values
    ('ff000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000099',
     'fe000000-0000-4000-8000-000000000001', 'internal', 'Orphan Project message')$$,
  '23503', null,
  'a Project message cannot be inserted against a nonexistent Order'
);

-- -----------------------------------------------------------------------------
-- project_attachments: correct linkage, cross-Project rejection, uniqueness
-- -----------------------------------------------------------------------------

insert into public.project_attachments (
  id, order_id, project_message_id, storage_object_key, original_name, mime_type, size_bytes, checksum_sha256, uploaded_by_profile_id
) values (
  'ff100000-0000-4000-8000-000000000001', 'fe200000-0000-4000-8000-000000000001',
  'ff000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001/brief.pdf',
  'brief.pdf', 'application/pdf', 1024, repeat('a1', 32), 'fe000000-0000-4000-8000-000000000001'
);
select is(
  (select original_name from public.project_attachments where id = 'ff100000-0000-4000-8000-000000000001'),
  'brief.pdf',
  'an attachment belonging to the correct Project/message inserts cleanly'
);

select throws_ok(
  format(
    $fmt$insert into public.project_attachments (
      id, order_id, project_message_id, storage_object_key, original_name, mime_type, size_bytes, checksum_sha256
    ) values (
      'ff100000-0000-4000-8000-000000000009', 'fe200000-0000-4000-8000-000000000001',
      %L, 'fe000000-0000-4000-8000-000000000001/cross.pdf', 'cross.pdf', 'application/pdf', 1024, repeat('a1', 32)
    )$fmt$,
    'ff000000-0000-4000-8000-000000000002'
  ),
  '23503', null,
  'cross-Project attachment/message linkage is rejected: the message belongs to a different Order'
);

insert into public.project_attachments (
  id, order_id, project_message_id, storage_object_key, original_name, mime_type, size_bytes, checksum_sha256
) values (
  'ff100000-0000-4000-8000-000000000002', 'fe200000-0000-4000-8000-000000000001',
  'ff000000-0000-4000-8000-000000000003', 'fe000000-0000-4000-8000-000000000001/other.pdf',
  'other.pdf', 'application/pdf', 2048, repeat('b2', 32)
);

select throws_ok(
  $$insert into public.project_messages (id, order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text, reply_to_attachment_id) values
    ('ff000000-0000-4000-8000-000000000013', 'fe200000-0000-4000-8000-000000000001',
     'fe000000-0000-4000-8000-000000000001', 'internal', 'Wrong attachment target',
     'ff000000-0000-4000-8000-000000000001', 'Kickoff message', 'ff100000-0000-4000-8000-000000000002')$$,
  '23503', null,
  'a reply cannot target an attachment that belongs to a different parent message'
);

insert into public.project_messages (id, order_id, author_profile_id, author_type, body, reply_to_message_id, reply_quote_text, reply_to_attachment_id) values
  ('ff000000-0000-4000-8000-000000000004', 'fe200000-0000-4000-8000-000000000001',
   'fe000000-0000-4000-8000-000000000001', 'internal', 'Correct attachment target',
   'ff000000-0000-4000-8000-000000000001', 'Kickoff message', 'ff100000-0000-4000-8000-000000000001');
select is(
  (select reply_to_attachment_id from public.project_messages where id = 'ff000000-0000-4000-8000-000000000004'),
  'ff100000-0000-4000-8000-000000000001'::uuid,
  'a reply targeting the exact attachment on its parent message succeeds'
);

select throws_ok(
  $$insert into public.project_attachments (
    id, order_id, project_message_id, storage_object_key, original_name, mime_type, size_bytes, checksum_sha256
  ) values (
    'ff100000-0000-4000-8000-000000000010', 'fe200000-0000-4000-8000-000000000001',
    'ff000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000001/brief.pdf',
    'duplicate.pdf', 'application/pdf', 1024, repeat('a1', 32)
  )$$,
  '23505', null,
  'storage object key uniqueness is enforced'
);

-- -----------------------------------------------------------------------------
-- Append-only integrity, comparable to Ticket messages
-- -----------------------------------------------------------------------------

select throws_ok(
  $$update public.project_messages set body = 'hacked' where id = 'ff000000-0000-4000-8000-000000000001'$$,
  '55000', null,
  'Project messages cannot be updated'
);
select throws_ok(
  $$delete from public.project_messages where id = 'ff000000-0000-4000-8000-000000000001'$$,
  '55000', null,
  'Project messages cannot be deleted'
);

-- -----------------------------------------------------------------------------
-- project_message_reactions: uniqueness, ownership, cascade
-- -----------------------------------------------------------------------------

insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code) values
  ('ff000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002', 'like');
select is(
  (select count(*) from public.project_message_reactions
   where message_id = 'ff000000-0000-4000-8000-000000000001' and reactor_profile_id = 'fe000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a valid reaction succeeds'
);

select throws_ok(
  $$insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code) values
    ('ff000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000002', 'like')$$,
  '23505', null,
  'a duplicate reactor/message/reaction combination is rejected'
);

select throws_ok(
  $$insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code) values
    ('aa000000-0000-4000-8000-000000000099', 'fe000000-0000-4000-8000-000000000002', 'heart')$$,
  '23503', null,
  'a reaction against a nonexistent message is rejected'
);

insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code) values
  ('ff000000-0000-4000-8000-000000000001', 'fe000000-0000-4000-8000-000000000003', 'heart');
delete from public.profiles where id = 'fe000000-0000-4000-8000-000000000003';
select is(
  (select count(*) from public.project_message_reactions where reactor_profile_id = 'fe000000-0000-4000-8000-000000000003'),
  0::bigint,
  'deleting the reactor profile cascades its reactions away'
);

select * from finish();
rollback;
