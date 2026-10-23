begin;
select plan(25);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'note-owner@example.invalid', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'note-staff@example.invalid', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'note-client@example.invalid', now(), now());

insert into public.companies (id, name, status)
values ('fa100000-0000-4000-8000-000000000001', 'Note Tombstone Co', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'QA Local'
where id = 'fa000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Other Staff'
where id = 'fa000000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'fa100000-0000-4000-8000-000000000001', display_name = 'Note Client'
where id = 'fa000000-0000-4000-8000-000000000003';

insert into public.orders (id, company_id, service_id, title) values (
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  (select id from public.services where archived_at is null and tenant_id = private.wolf_forge_tenant_id() order by id limit 1),
  'Internal note unsend order'
);
insert into public.tickets (id, company_id, client_profile_id, order_id, subject, created_by_profile_id) values (
  'fa300000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000003',
  'fa200000-0000-4000-8000-000000000001',
  'Internal note unsend',
  'fa000000-0000-4000-8000-000000000001'
);
insert into public.ticket_messages (
  id, ticket_id, author_profile_id, author_type, message_kind, visibility, body, created_at
) values
  ('fa400000-0000-4000-8000-000000000001', 'fa300000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'internal', 'internal_note', 'internal', 'Original private note', '2026-09-14 19:28:00+00'),
  ('fa400000-0000-4000-8000-000000000002', 'fa300000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'internal', 'internal_note', 'internal', 'Other staff private note', '2026-09-14 20:00:00+00'),
  ('fa400000-0000-4000-8000-000000000003', 'fa300000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000003', 'client', 'reply', 'client', 'Public client reply', '2026-09-14 20:30:00+00');

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select has_column('public', 'ticket_messages', 'unsent_at', 'Ticket notes store unsent time');
select has_column('public', 'ticket_messages', 'unsent_by_profile_id', 'Ticket notes store unsend actor');
select ok(not has_function_privilege('anon', 'public.app_unsend_ticket_internal_note(uuid)', 'execute'), 'anonymous unsend denied');
select ok(has_function_privilege('authenticated', 'public.app_unsend_ticket_internal_note(uuid)', 'execute'), 'authenticated role may enter the guarded RPC');

set local role authenticated;
select pg_temp.become('fa000000-0000-4000-8000-000000000001');
select is(
  (select (message ->> 'can_unsend')::boolean
   from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('fa300000-0000-4000-8000-000000000001')->'messages') message
   where message ->> 'id' = 'fa400000-0000-4000-8000-000000000001'),
  true,
  'author read model exposes the available action'
);
select lives_ok(
  $$select public.app_unsend_ticket_internal_note('fa400000-0000-4000-8000-000000000001')$$,
  'author unsends own accessible internal note'
);
reset role;

select is((select count(*) from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000001'), 1::bigint, 'note row remains in history');
select is((select body from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000001'), 'This note was unsent.', 'stored content is replaced by tombstone');
select is((select author_profile_id from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000001'), 'fa000000-0000-4000-8000-000000000001'::uuid, 'original author remains');
select is((select created_at from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000001'), '2026-09-14 19:28:00+00'::timestamptz, 'original timestamp remains');
select is((select unsent_by_profile_id from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000001'), 'fa000000-0000-4000-8000-000000000001'::uuid, 'real actor is stored');

set local role authenticated;
select pg_temp.become('fa000000-0000-4000-8000-000000000001');
select is(
  (select message ->> 'body'
   from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('fa300000-0000-4000-8000-000000000001')->'messages') message
   where message ->> 'id' = 'fa400000-0000-4000-8000-000000000001'),
  'This note was unsent.',
  'reload read model returns the tombstone'
);
select is(
  position('Original private note' in public.app_get_ticket_detail_with_avatars('fa300000-0000-4000-8000-000000000001')::text),
  0,
  'reload read model does not return original content'
);
select is(
  (select (message ->> 'can_unsend')::boolean
   from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('fa300000-0000-4000-8000-000000000001')->'messages') message
   where message ->> 'id' = 'fa400000-0000-4000-8000-000000000001'),
  false,
  'tombstoned note no longer offers Unsend'
);
reset role;

select is(
  (select position('Original private note' in metadata::text)
   from public.activity_events where action = 'ticket.internal_note_unsent' and entity_id = 'fa300000-0000-4000-8000-000000000001'),
  0,
  'audit metadata does not copy original content'
);

set local role authenticated;
select pg_temp.become('fa000000-0000-4000-8000-000000000001');
select lives_ok($$select public.app_unsend_ticket_internal_note('fa400000-0000-4000-8000-000000000001')$$, 'retry is idempotent');
reset role;
select is((select count(*) from public.activity_events where action = 'ticket.internal_note_unsent' and entity_id = 'fa300000-0000-4000-8000-000000000001'), 1::bigint, 'retry does not duplicate audit event');

set local role authenticated;
select pg_temp.become('fa000000-0000-4000-8000-000000000001');
select throws_ok($$select public.app_unsend_ticket_internal_note('fa400000-0000-4000-8000-000000000002')$$, '42501', null, 'owner cannot unsend another staff author note');
select pg_temp.become('fa000000-0000-4000-8000-000000000003');
select throws_ok($$select public.app_unsend_ticket_internal_note('fa400000-0000-4000-8000-000000000002')$$, '42501', null, 'client cannot unsend internal notes');
select is(
  (select count(*) from jsonb_array_elements(public.app_get_ticket_detail_with_avatars('fa300000-0000-4000-8000-000000000001')->'messages') message where message ->> 'message_kind' = 'internal_note'),
  0::bigint,
  'client cannot fetch internal notes'
);
select is(position('unsent_at' in public.app_get_ticket_detail_with_avatars('fa300000-0000-4000-8000-000000000001')::text), 0, 'client response does not expose internal unsend state');

select pg_temp.become('fa000000-0000-4000-8000-000000000001');
select throws_ok($$select public.app_unsend_ticket_internal_note('fa400000-0000-4000-8000-000000000003')$$, 'P0002', null, 'public reply cannot enter note unsend');
reset role;
select throws_ok(
  $$update public.ticket_messages set body = 'Mutated' where id = 'fa400000-0000-4000-8000-000000000002'$$,
  '55000',
  'Ticket messages are append-only',
  'ordinary message mutation remains blocked'
);
select is((select body from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000002'), 'Other staff private note', 'failed mutation leaves content unchanged');
select ok((select unsent_at is not null from public.ticket_messages where id = 'fa400000-0000-4000-8000-000000000001'), 'persisted tombstone records an unsent time');

select * from finish();
rollback;
