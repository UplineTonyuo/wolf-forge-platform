begin;
select plan(42);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('f0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'actions-owner@example.invalid', now(), now()),
  ('f0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'actions-client@example.invalid', now(), now()),
  ('f0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'actions-other-client@example.invalid', now(), now()),
  ('f0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'actions-member@example.invalid', now(), now()),
  ('f0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'actions-group-member@example.invalid', now(), now()),
  ('f0000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'actions-outsider@example.invalid', now(), now());

insert into public.companies (id, name, status) values
  ('f0100000-0000-4000-8000-000000000001', 'Message Actions Co', 'client'),
  ('f0100000-0000-4000-8000-000000000002', 'Other Message Co', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Forwarding Owner'
where id = 'f0000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'f0100000-0000-4000-8000-000000000001', display_name = 'QA Order Client'
where id = 'f0000000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'f0100000-0000-4000-8000-000000000002', display_name = 'Other Client'
where id = 'f0000000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'William Direct'
where id = 'f0000000-0000-4000-8000-000000000004';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Group Member'
where id = 'f0000000-0000-4000-8000-000000000005';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Staff Outsider'
where id = 'f0000000-0000-4000-8000-000000000006';

insert into public.orders (id, company_id, service_id, title) values
  ('f0200000-0000-4000-8000-000000000001', 'f0100000-0000-4000-8000-000000000001', (select id from public.services where archived_at is null limit 1), 'Message action order'),
  ('f0200000-0000-4000-8000-000000000002', 'f0100000-0000-4000-8000-000000000002', (select id from public.services where archived_at is null limit 1), 'Other order');
insert into public.tickets (id, company_id, client_profile_id, order_id, subject, created_by_profile_id) values
  ('f0300000-0000-4000-8000-000000000001', 'f0100000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f0200000-0000-4000-8000-000000000001', 'Message actions', 'f0000000-0000-4000-8000-000000000001'),
  ('f0300000-0000-4000-8000-000000000002', 'f0100000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003', 'f0200000-0000-4000-8000-000000000002', 'Other message', 'f0000000-0000-4000-8000-000000000001');
insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body) values
  ('f0400000-0000-4000-8000-000000000001', 'f0300000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'client', 'reply', 'client', 'Thanks,   the postcard should arrive Thursday.'),
  ('f0400000-0000-4000-8000-000000000002', 'f0300000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'internal', 'internal_note', 'internal', 'Private production note'),
  ('f0400000-0000-4000-8000-000000000003', 'f0300000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003', 'client', 'reply', 'client', 'Other company source');

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select has_column('public', 'ticket_messages', 'reply_to_message_id', 'Ticket reply source is stored');
select has_column('public', 'ticket_messages', 'reply_quote_text', 'Ticket reply quote is stored');
select has_table('public', 'ticket_message_reactions', 'Ticket reactions have a dedicated table');
select has_column('public', 'team_messages', 'forwarded_from_ticket_message_id', 'Team forwards store Ticket provenance');
select is((select relrowsecurity from pg_class where oid = 'public.ticket_message_reactions'::regclass), true, 'reaction table has RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.ticket_message_reactions'::regclass), true, 'reaction table forces RLS');
select ok(not has_function_privilege('anon', 'public.app_reply_to_ticket_message(uuid,uuid,text,uuid)', 'execute'), 'anonymous replies denied');
select ok(not has_function_privilege('anon', 'public.app_toggle_ticket_message_reaction(uuid,text)', 'execute'), 'anonymous reactions denied');
select ok(not has_function_privilege('anon', 'public.app_forward_ticket_message_to_team(uuid,uuid,uuid,text)', 'execute'), 'anonymous forwards denied');

set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
create temp table actions_direct on commit drop as
select public.app_start_team_conversation('f0000000-0000-4000-8000-000000000004') as conversation_id;
create temp table actions_group on commit drop as
select public.app_create_team_group('Order QA', array['f0000000-0000-4000-8000-000000000004'::uuid, 'f0000000-0000-4000-8000-000000000005'::uuid]) as conversation_id;
select pg_temp.become('f0000000-0000-4000-8000-000000000004');
create temp table actions_foreign on commit drop as
select public.app_start_team_conversation('f0000000-0000-4000-8000-000000000006') as conversation_id;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');

select lives_ok($$select public.app_reply_to_ticket_message('f0500000-0000-4000-8000-000000000001','f0300000-0000-4000-8000-000000000001','It is scheduled.','f0400000-0000-4000-8000-000000000001')$$, 'authorized reply persists');
reset role;
select is((select reply_to_message_id from public.ticket_messages where request_id = 'f0500000-0000-4000-8000-000000000001'), 'f0400000-0000-4000-8000-000000000001'::uuid, 'reply targets the exact message');
select is((select reply_quote_text from public.ticket_messages where request_id = 'f0500000-0000-4000-8000-000000000001'), 'Thanks, the postcard should arrive Thursday.', 'reply quote is server-derived and normalized');
set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select is((select message ->> 'reply_source_author_name' from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('f0300000-0000-4000-8000-000000000001')->'messages') message where message ->> 'body' = 'It is scheduled.'), 'QA Order Client', 'reload read model resolves reply author');
select lives_ok($$select public.app_reply_to_ticket_message('f0500000-0000-4000-8000-000000000001','f0300000-0000-4000-8000-000000000001','It is scheduled.','f0400000-0000-4000-8000-000000000001')$$, 'reply retry is idempotent');
reset role;
select is((select count(*) from public.ticket_messages where request_id = 'f0500000-0000-4000-8000-000000000001'), 1::bigint, 'reply retry creates one message');
set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select throws_ok($$select public.app_reply_to_ticket_message(gen_random_uuid(),'f0300000-0000-4000-8000-000000000001','No','f0400000-0000-4000-8000-000000000003')$$, '42501', null, 'cross-Ticket reply source rejected');
select throws_ok($$select public.app_reply_to_ticket_message(gen_random_uuid(),'f0300000-0000-4000-8000-000000000001','No','f0400000-0000-4000-8000-000000000002')$$, '42501', null, 'internal note reply source rejected');
select pg_temp.become('f0000000-0000-4000-8000-000000000006');
select throws_ok($$select public.app_reply_to_ticket_message(gen_random_uuid(),'f0300000-0000-4000-8000-000000000001','No','f0400000-0000-4000-8000-000000000001')$$, 'P0002', null, 'unauthorized actor cannot reply to source');

select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select lives_ok($$select public.app_toggle_ticket_message_reaction('f0400000-0000-4000-8000-000000000001','heart')$$, 'owner adds reaction');
reset role;
select is((select active from public.ticket_message_reactions where message_id = 'f0400000-0000-4000-8000-000000000001' and reactor_profile_id = 'f0000000-0000-4000-8000-000000000001'), true, 'owner reaction is active');
set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000002');
select lives_ok($$select public.app_toggle_ticket_message_reaction('f0400000-0000-4000-8000-000000000001','heart')$$, 'client adds own reaction');
select is((public.app_toggle_ticket_message_reaction('f0400000-0000-4000-8000-000000000001','heart')->>'reacted_by_me')::boolean, false, 'client toggles own reaction off');
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select is((select (message->'reactions'->0->>'reaction_count')::integer from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('f0300000-0000-4000-8000-000000000001')->'messages') message where message->>'id' = 'f0400000-0000-4000-8000-000000000001'), 1, 'reaction grouping counts active actors');
select lives_ok($$select public.app_toggle_ticket_message_reaction('f0400000-0000-4000-8000-000000000001','heart')$$, 'owner removes own reaction');
select is((select jsonb_array_length(message->'reactions') from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('f0300000-0000-4000-8000-000000000001')->'messages') message where message->>'id' = 'f0400000-0000-4000-8000-000000000001'), 0, 'removed reactions disappear after reload');
select pg_temp.become('f0000000-0000-4000-8000-000000000003');
select throws_ok($$select public.app_toggle_ticket_message_reaction('f0400000-0000-4000-8000-000000000001','heart')$$, '42501', null, 'unauthorized company cannot react');
select pg_temp.become('f0000000-0000-4000-8000-000000000002');
select throws_ok($$select public.app_toggle_ticket_message_reaction('f0400000-0000-4000-8000-000000000002','heart')$$, '42501', null, 'client cannot react to internal note');

select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select lives_ok(format($$select public.app_forward_ticket_message_to_team('f0600000-0000-4000-8000-000000000001','f0400000-0000-4000-8000-000000000001',%L::uuid,'Please review.')$$, (select conversation_id from actions_direct)), 'forward sends to direct Team chat');
reset role;
select is((select count(*) from public.team_messages where request_id = 'f0600000-0000-4000-8000-000000000001'), 1::bigint, 'direct forward creates one Team message');
select matches((select body from public.team_messages where request_id = 'f0600000-0000-4000-8000-000000000001'), '^Please review\.[\s\S]*Project #[0-9]+[\s\S]*Thanks,', 'forward preserves comment, source, and content');
select is((select forwarded_from_ticket_message_id from public.team_messages where request_id = 'f0600000-0000-4000-8000-000000000001'), 'f0400000-0000-4000-8000-000000000001'::uuid, 'forward keeps Ticket provenance in its own column');
select is((select forwarded_from_author_name from public.team_messages where request_id = 'f0600000-0000-4000-8000-000000000001'), 'QA Order Client', 'forward snapshots original sender');
set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select lives_ok(format($$select public.app_forward_ticket_message_to_team('f0600000-0000-4000-8000-000000000002','f0400000-0000-4000-8000-000000000001',%L::uuid,null)$$, (select conversation_id from actions_group)), 'forward sends to group Team chat');
reset role;
select is((select count(*) from public.team_messages where request_id = 'f0600000-0000-4000-8000-000000000002'), 1::bigint, 'group forward creates one Team message');
set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select lives_ok(format($$select public.app_forward_ticket_message_to_team('f0600000-0000-4000-8000-000000000001','f0400000-0000-4000-8000-000000000001',%L::uuid,'Please review.')$$, (select conversation_id from actions_direct)), 'forward retry is idempotent');
reset role;
select is((select count(*) from public.team_messages where request_id = 'f0600000-0000-4000-8000-000000000001'), 1::bigint, 'forward retry still creates one message');
set local role authenticated;
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select throws_ok(format($$select public.app_forward_ticket_message_to_team(gen_random_uuid(),'f0400000-0000-4000-8000-000000000001',%L::uuid,null)$$, (select conversation_id from actions_foreign)), '42501', null, 'unauthorized Team destination rejected');
select pg_temp.become('f0000000-0000-4000-8000-000000000004');
select throws_ok(format($$select public.app_forward_ticket_message_to_team(gen_random_uuid(),'f0400000-0000-4000-8000-000000000001',%L::uuid,null)$$, (select conversation_id from actions_group)), 'P0002', null, 'unauthorized Ticket source rejected');
select pg_temp.become('f0000000-0000-4000-8000-000000000006');
select throws_ok(format($$select public.app_forward_ticket_message_to_team(gen_random_uuid(),'f0400000-0000-4000-8000-000000000001',%L::uuid,null)$$, (select conversation_id from actions_direct)), 'P0002', null, 'unauthorized source rejected before destination');
select pg_temp.become('f0000000-0000-4000-8000-000000000002');
select throws_ok(format($$select public.app_forward_ticket_message_to_team(gen_random_uuid(),'f0400000-0000-4000-8000-000000000001',%L::uuid,null)$$, (select conversation_id from actions_direct)), '42501', null, 'client cannot forward to Team chat');
select pg_temp.become('f0000000-0000-4000-8000-000000000001');
select throws_ok(format($$select public.app_forward_team_message(gen_random_uuid(),'f0400000-0000-4000-8000-000000000001',%L::uuid)$$, (select conversation_id from actions_direct)), 'P0002', null, 'Ticket ids cannot enter Team-message forward RPC');
select is((select message ->> 'forwarded_from_ticket_message_id' from jsonb_array_elements(public.app_get_team_conversation((select conversation_id from actions_direct))->'messages') message where message ->> 'request_id' = 'f0600000-0000-4000-8000-000000000001'), 'f0400000-0000-4000-8000-000000000001', 'Team reload read model preserves Ticket provenance');

select * from finish();
rollback;
