begin;
select plan(19);

insert into auth.users (id, aud, role, email) values
('ef000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'restoration-owner@example.invalid'),
('ef000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'restoration-client@example.invalid'),
('ef000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'restoration-other@example.invalid'),
('ef000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'restoration-staff@example.invalid');
insert into public.companies (id, name, status) values
('ef100000-0000-0000-0000-000000000001', 'Restoration A', 'client'),
('ef100000-0000-0000-0000-000000000002', 'Restoration B', 'client');
update public.profiles set role_id = (select id from public.roles where name = 'owner') where id = 'ef000000-0000-0000-0000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'ef100000-0000-0000-0000-000000000001' where id = 'ef000000-0000-0000-0000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'), company_id = 'ef100000-0000-0000-0000-000000000002' where id = 'ef000000-0000-0000-0000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff') where id = 'ef000000-0000-0000-0000-000000000004';
insert into public.orders (id, company_id, service_id, title) values
('ef200000-0000-0000-0000-000000000001', 'ef100000-0000-0000-0000-000000000001', (select id from public.services where archived_at is null limit 1), 'Restoration test');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
select is(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001'), null::jsonb, 'read returns no conversation without creating one');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000001','Staff secret',true)$$, 'first internal note creates canonical Ticket');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000001','Staff secret',true)$$, 'same request retries safely');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000001','Changed',true)$$, '23505', null, 'retry payload mismatch denied');
reset role;
select is((select count(*) from public.tickets where order_id = 'ef200000-0000-0000-0000-000000000001'), 1::bigint, 'one canonical Ticket');
select is((select count(*) from public.ticket_messages where ticket_id = (select id from public.tickets where order_id = 'ef200000-0000-0000-0000-000000000001')), 1::bigint, 'one real note, no fabricated opening message');
select throws_ok($$insert into public.tickets (company_id,order_id,subject) values ('ef100000-0000-0000-0000-000000000001','ef200000-0000-0000-0000-000000000001','Duplicate')$$, '23505', null, 'unique index prevents duplicate links');

set local role authenticated;
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000002';
select is(jsonb_array_length(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')->'messages'), 0, 'client cannot see first internal note');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000002','Forged note',true)$$, '42501', null, 'client cannot add internal note');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000003','Client reply')$$, 'client can reply to linked Order');
select is(jsonb_array_length(public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')->'messages'), 1, 'client sees only public reply');
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000003';
select throws_ok($$select public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')$$, 'P0002', null, 'other company cannot read');
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000004','Intrusion')$$, 'P0002', null, 'other company cannot send');
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000004';
select throws_ok($$select public.app_get_order_conversation('ef200000-0000-0000-0000-000000000001')$$, 'P0002', null, 'unassigned staff cannot read Order communication');
reset role;
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
update public.orders set assigned_to_profile_id = 'ef000000-0000-0000-0000-000000000004' where id = 'ef200000-0000-0000-0000-000000000001';
insert into public.profile_permission_overrides(profile_id, permission_key, allowed) values ('ef000000-0000-0000-0000-000000000004','tickets.reply',false);
set local role authenticated;
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000004';
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000005','Denied')$$, '42501', null, 'Ticket permission remains required even with Order access');
reset role;
delete from public.profile_permission_overrides where profile_id = 'ef000000-0000-0000-0000-000000000001' and permission_key = 'tickets.reply';
update public.tickets set status = 'closed', closed_at = now() where order_id = 'ef200000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000006','Closed reply')$$, '55000', null, 'closed Ticket rejects replies');
select lives_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000007','Closed internal note',true)$$, 'closed Ticket preserves canonical internal-note behavior');
reset role;
update public.tickets set archived_at = now() where order_id = 'ef200000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'ef000000-0000-0000-0000-000000000001';
select throws_ok($$select public.app_send_order_message('ef200000-0000-0000-0000-000000000001','ef300000-0000-0000-0000-000000000008','Archived note',true)$$, '55000', null, 'archived Ticket rejects notes');
reset role;
select ok(not has_function_privilege('anon','public.app_send_order_message(uuid,uuid,text,boolean)','execute'), 'anonymous writes denied');
select * from finish();
rollback;
