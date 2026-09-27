begin;
select plan(20);

insert into auth.users (id, aud, role, email) values
('ef000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'restoration-owner@example.invalid'),
('ef000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'restoration-client@example.invalid'),
('ef000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'restoration-other@example.invalid'),
('ef000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'restoration-staff@example.invalid');
insert into public.companies (id, name, status) values
('ef100000-0000-0000-0000-000000000001', 'Restoration A', 'client'),
('ef100000-0000-0000-0000-000000000002', 'Restoration B', 'client');
update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Owner'
where id = 'ef000000-0000-0000-0000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'ef100000-0000-0000-0000-000000000001'
where id = 'ef000000-0000-0000-0000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'ef100000-0000-0000-0000-000000000002'
where id = 'ef000000-0000-0000-0000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Staff'
where id = 'ef000000-0000-0000-0000-000000000004';

insert into public.orders (id, company_id, service_id, title) values
('ef200000-0000-0000-0000-000000000001', 'ef100000-0000-0000-0000-000000000001', (select id from public.services where archived_at is null limit 1), 'Native Project'),
('ef200000-0000-0000-0000-000000000002', 'ef100000-0000-0000-0000-000000000001', (select id from public.services where archived_at is null limit 1), 'Historical Project');
insert into public.tickets (id, company_id, client_profile_id, subject, created_by_profile_id, order_id)
values ('ef400000-0000-0000-0000-000000000001', 'ef100000-0000-0000-0000-000000000001',
  'ef000000-0000-0000-0000-000000000002', 'Historical Project Ticket',
  'ef000000-0000-0000-0000-000000000001', 'ef200000-0000-0000-0000-000000000002');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
select is(jsonb_array_length(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')->'messages'), 0,
  'a new Project exposes its empty native conversation without creating a Ticket');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000001','Staff secret',true)$$,
  '0A000', null, 'native Project conversations do not manufacture a Ticket for an internal note');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000002','Public update',false)$$,
  'staff can send a native Project message');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000002','Public update',false)$$,
  'same native message request retries safely');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000002','Changed',false)$$,
  '23505', null, 'native message retry payload mismatch is denied');
reset role;

select is((select count(*) from public.tickets where order_id = 'ef200000-0000-0000-0000-000000000001'), 0::bigint,
  'native Project messaging creates no Ticket');
select is((select count(*) from public.project_messages where order_id = 'ef200000-0000-0000-0000-000000000001'), 1::bigint,
  'native Project retry leaves one message');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000002';
select is(jsonb_array_length(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')->'messages'), 1,
  'owning client reads the native Project conversation');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000003','Forged note',true)$$,
  '42501', null, 'client cannot add an internal note');
select lives_ok($$select public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')$$,
  'client can reopen the native Project conversation');
select is(jsonb_array_length(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')->'messages'), 1,
  'reopening does not duplicate native Project messages');
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000003';
select throws_ok($$select public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'other company cannot read');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000005','Intrusion')$$,
  'P0002', null, 'other company cannot send');
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000004';
select throws_ok($$select public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'unassigned staff cannot read Project communication');
reset role;

set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
update public.orders set assigned_to_profile_id = 'ef000000-0000-0000-0000-000000000004'
where id = 'ef200000-0000-0000-0000-000000000001';
insert into public.profile_permission_overrides(profile_id, permission_key, allowed)
values ('ef000000-0000-0000-0000-000000000004','tickets.reply',false);
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000004';
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000006','Denied')$$,
  '42501', null, 'Ticket reply permission remains required for native Project messages');
reset role;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
select is(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000002')->'ticket'->>'id',
  'ef400000-0000-0000-0000-000000000001', 'historical linked Project still reads through its Ticket');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000002','ef300000-0000-0000-0000-000000000007','Legacy reply')$$,
  'historical linked Project still writes through its Ticket');
reset role;
select is((select count(*) from public.tickets where id = 'ef400000-0000-0000-0000-000000000001'), 1::bigint,
  'historical Ticket remains untouched');
select is((select count(*) from public.ticket_messages where ticket_id = 'ef400000-0000-0000-0000-000000000001'), 1::bigint,
  'historical Ticket receives its explicit legacy reply');
select ok(not has_function_privilege('anon','public.app_send_order_message(uuid,uuid,text,boolean)','execute'),
  'anonymous writes are denied');

select * from finish();
rollback;
