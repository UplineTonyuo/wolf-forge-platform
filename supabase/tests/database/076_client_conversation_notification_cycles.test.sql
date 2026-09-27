begin;

select plan(17);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notify-owner@example.invalid', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'william@example.invalid', now(), now()),
  ('a2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notify-client-a@example.invalid', now(), now()),
  ('a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'notify-client-b@example.invalid', now(), now());

insert into public.companies (id, name, status)
values
  ('a3000000-0000-4000-8000-000000000001', 'Notify Company A', 'client'),
  ('a3000000-0000-4000-8000-000000000002', 'Notify Company B', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'),
  display_name = 'Notification Owner'
where id = 'a1000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'),
  display_name = 'William Jones'
where id = 'a1000000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'a3000000-0000-4000-8000-000000000001', display_name = 'Client A'
where id = 'a2000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'a3000000-0000-4000-8000-000000000002', display_name = 'Client B'
where id = 'a2000000-0000-4000-8000-000000000002';

insert into public.tickets (
  id, company_id, client_profile_id, subject, created_by_profile_id
) values
  ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001',
   'a2000000-0000-4000-8000-000000000001', 'About 3 investments', 'a1000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001',
   'a2000000-0000-4000-8000-000000000001', 'Second conversation', 'a1000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002',
   'a2000000-0000-4000-8000-000000000002', 'Client B conversation', 'a1000000-0000-4000-8000-000000000001');

delete from public.notifications where recipient_profile_id in (
  'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002'
);

select ok((select p.prosecdef and 'search_path=""' = any(p.proconfig)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'app_set_client_conversation_presence'),
  'presence is a SECURITY DEFINER boundary with an empty search path');
select ok(not has_table_privilege('authenticated', 'private.client_conversation_presence', 'SELECT'),
  'browser roles cannot read durable presence state');

insert into public.ticket_messages (
  ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
) values (
  'a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
  'internal', 'reply', 'client', 'Hey Rex', 'a5000000-0000-4000-8000-000000000001'
);

select is((select count(*)::int from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'), 1,
  'one staff reply while the client is elsewhere creates one notification');
select is((select title from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'),
  'New message from William Jones', 'single-message copy uses the real sender');
select is((select body from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'),
  'About 3 investments', 'notification secondary copy uses the conversation subject');

insert into public.ticket_messages (
  ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
) values
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'internal', 'reply', 'client', 'One more thing', 'a5000000-0000-4000-8000-000000000002'),
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'internal', 'reply', 'client', 'Let me know', 'a5000000-0000-4000-8000-000000000003');

select is((select count(*)::int from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'), 1,
  'three replies coalesce into one notification row');
select is((select message_count from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'), 3,
  'the grouped notification records three messages');
select is((select title from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'),
  '3 new messages from William Jones', 'grouped copy uses count and sender');
select is((select count(*)::int from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001' and read_at is null), 1,
  'bell unread contribution is one conversation, not three messages');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a2000000-0000-4000-8000-000000000001';
select public.app_set_client_conversation_presence('ticket', 'a4000000-0000-4000-8000-000000000001', true);
reset role;
set local "request.jwt.claim.sub" = '';

select ok((select read_at is not null from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'),
  'opening the conversation marks its grouped notification read');

insert into public.ticket_messages (
  ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
) values (
  'a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
  'internal', 'reply', 'client', 'Visible now', 'a5000000-0000-4000-8000-000000000004'
);
select ok((select read_at is not null and message_count = 3 from public.notifications
  where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'),
  'a reply in the exact active conversation creates no redundant notification');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a2000000-0000-4000-8000-000000000001';
select public.app_set_client_conversation_presence('ticket', 'a4000000-0000-4000-8000-000000000001', false);
reset role;
set local "request.jwt.claim.sub" = '';

insert into public.ticket_messages (
  ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
) values (
  'a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
  'internal', 'reply', 'client', 'New cycle', 'a5000000-0000-4000-8000-000000000005'
);
select ok((select read_at is null and message_count = 1 and title = 'New message from William Jones'
  from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001'),
  'a later reply after read begins a new notification cycle');

insert into public.ticket_messages (
  ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
) values (
  'a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002',
  'internal', 'reply', 'client', 'Separate thread', 'a5000000-0000-4000-8000-000000000006'
);
select is((select count(*)::int from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000001' and read_at is null), 2,
  'different conversations remain separate unread rows');
select is((select count(*)::int from public.notifications where recipient_profile_id = 'a2000000-0000-4000-8000-000000000002'), 0,
  'Client B receives none of Client A conversation activity');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a2000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.app_set_client_conversation_presence('ticket', 'a4000000-0000-4000-8000-000000000001', true)$$,
  '42501', 'Ticket access is denied',
  'Client B cannot mark or view Client A conversation presence');
reset role;
set local "request.jwt.claim.sub" = '';

select is((select count(*)::int from public.tickets where id = 'a4000000-0000-4000-8000-000000000003'), 1,
  'an existing historical Ticket remains untouched');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.app_create_ticket(
    'a6000000-0000-4000-8000-000000000001',
    '{"company_id":"a3000000-0000-4000-8000-000000000001","client_profile_id":"a2000000-0000-4000-8000-000000000001","subject":"Manual support","message":"Created explicitly","priority":"normal"}'::jsonb
  )$$,
  'explicit manual Ticket creation still works');
reset role;

select * from finish();
rollback;
