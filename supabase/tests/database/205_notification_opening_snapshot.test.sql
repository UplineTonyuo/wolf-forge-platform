begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,event_key,created_at)
 select '20000000-0000-4000-8000-000000001701','f0f0f0f0-0000-4000-8000-000000001701','e0000000-0000-4000-8000-000000001701',
 'client','client','Synthetic snapshot','Synthetic activity','/account','opening-205:'||n,clock_timestamp()-interval '1 hour' from generate_series(1,151) n;
create function pg_temp.opening_actor(n text default '1701') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,'role','authenticated')::text,true);
 perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
select ok(not has_table_privilege('authenticated','private.notification_openings','select,insert,update,delete'),'receipts cannot be read or forged directly');
select ok(not has_function_privilege('anon','public.app_open_client_notifications(uuid,timestamptz)','execute'),'anonymous opening denied');
select pg_temp.opening_actor(); set local role authenticated;
select is((public.app_client_notification_feed()->>'unreadCount')::int,151,'badge counts unread beyond fifty-row feed');
select is(jsonb_array_length(public.app_client_notification_feed()->'notifications'),50,'visible feed stays bounded');
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002051',now())->>'readCount')::int,151,'one deliberate opening marks complete existing snapshot');
select is((public.app_client_notification_feed()->>'unreadCount')::int,0,'authoritative badge reaches zero');
reset role;
insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,event_key)
 values('20000000-0000-4000-8000-000000001701','f0f0f0f0-0000-4000-8000-000000001701','e0000000-0000-4000-8000-000000001701',
 'client','client','Synthetic later arrival','Synthetic activity','/account','opening-205:later');
set local role authenticated;
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002051',now())->>'readCount')::int,151,'replay returns original receipt without extending snapshot');
select is((public.app_client_notification_feed()->>'unreadCount')::int,1,'later arrival stays unread on retry');
select throws_ok($$select public.app_open_client_notifications('71000000-0000-4000-8000-000000002051',now()-interval '1 minute')$$,'22023',null,'replay is bound to original request timestamp');
select throws_ok($$select public.app_open_client_notifications('71000000-0000-4000-8000-000000002052',now()-interval '2 days')$$,'22023',null,'expired receipt cannot be recreated');
reset role;
select pg_temp.opening_actor('1702'); set local role authenticated;
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002051',now())->>'readCount')::int,0,'same request ID in another actor cannot mark the first actor notifications');
reset role;
select is((select count(*) from public.notifications where recipient_profile_id='20000000-0000-4000-8000-000000001701' and read_at is null),1::bigint,'other actor does not mutate later arrival');
select is((select count(*) from private.notification_openings where request_id='71000000-0000-4000-8000-000000002051'),2::bigint,'receipts are actor scoped');
-- Complete counts must follow the UI module masks, including NULL entity types.
select pg_temp.opening_actor('1703');
insert into public.services(id,tenant_id,name) values
 ('e2050000-0000-4000-8000-000000000001','f0f0f0f0-0000-4000-8000-000000001701','Synthetic notification-count service');
insert into public.orders(id,tenant_id,company_id,service_id,title,status) values
 ('e2050000-0000-4000-8000-000000000002','f0f0f0f0-0000-4000-8000-000000001701','e0000000-0000-4000-8000-000000001701',
 'e2050000-0000-4000-8000-000000000001','Synthetic notification-count order','working');
insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,event_key,entity_type,entity_id)
 select '20000000-0000-4000-8000-000000001701','f0f0f0f0-0000-4000-8000-000000001701','e0000000-0000-4000-8000-000000001701',
 'client',category,'Synthetic filtered count','Synthetic activity','/account',event_key,entity_type,entity_id from (values
 ('ticket','opening-205:ticket',null::text,null::uuid),
 ('project','opening-205:project','order','e2050000-0000-4000-8000-000000000002'::uuid),
 ('ticket','opening-205:overlap','order','e2050000-0000-4000-8000-000000000002'::uuid)
 ) v(category,event_key,entity_type,entity_id);
select pg_temp.opening_actor(); set local role authenticated;
select is((public.app_client_notification_feed()->>'unreadCount')::int,4,'complete total includes mixed authorized conversation categories');
select is((public.app_client_notification_feed()->'unreadCounts'->>'withoutTickets')::int,2,'Ticket mask excludes category and entity matches without losing NULL entities');
select is((public.app_client_notification_feed()->'unreadCounts'->>'withoutProjects')::int,2,'Projects mask excludes order entities');
select is((public.app_client_notification_feed()->'unreadCounts'->>'withoutConversations')::int,1,'both masks preserve the nonconversation unread count');
reset role;
-- Deterministic first-execution interleaving, complementary to the physical
-- three-session harness. Receipt insertion publishes via the real producer
-- AFTER membership capture. now() is the earlier transaction timestamp.
-- Refreshes here also share xmin, so the tuple version must be checked too.
create function pg_temp.publish_first_opening_notification() returns void language sql as $$
 select private.emit_client_conversation_notification(
  'e0000000-0000-4000-8000-000000001701','tickets.view','ticket','e1700000-0000-4000-8000-000000001701','ticket',
  'Synthetic producer','Synthetic first-opening publication','/account/messages/e1700000-0000-4000-8000-000000001701',
  '20000000-0000-4000-8000-000000001704',now());
$$;
create function pg_temp.prepare_first_opening(kind text) returns void language plpgsql as $$
begin
 delete from public.notifications where recipient_profile_id in
  ('20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001702');
 insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,event_key)
  select '20000000-0000-4000-8000-000000001701','f0f0f0f0-0000-4000-8000-000000001701',
   'e0000000-0000-4000-8000-000000001701','client','client','Synthetic unchanged notification','Synthetic activity',
   '/account','opening-205:first:'||n from generate_series(1,151) n;
 if kind<>'new-row' then
  perform pg_temp.publish_first_opening_notification();
  if kind='refresh-read' then
   update public.notifications set read_at=now() where recipient_profile_id='20000000-0000-4000-8000-000000001701'
    and event_key='client-conversation:ticket:e1700000-0000-4000-8000-000000001701';
  end if;
 end if;
end $$;
create function pg_temp.publish_after_first_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform pg_temp.publish_first_opening_notification(); return new; end $$;
create trigger opening_first_publication after insert on private.notification_openings for each row
 when (new.profile_id='20000000-0000-4000-8000-000000001701' and new.request_id in
  ('71000000-0000-4000-8000-000000002053','71000000-0000-4000-8000-000000002054','71000000-0000-4000-8000-000000002055'))
 execute function pg_temp.publish_after_first_receipt();

select pg_temp.prepare_first_opening('new-row');
select pg_temp.opening_actor(); set local role authenticated;
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002053',now())->>'readCount')::int,151,'FIRST opening excludes a newly published backdated row');
select is((public.app_client_notification_feed()->>'unreadCount')::int,1,'new late publication remains unread');
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002053',now())->>'readCount')::int,151,'lost-ack replay returns the first receipt');
select is((public.app_client_notification_feed()->>'unreadCount')::int,1,'replay does not extend the first snapshot');
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002061',now())->>'readCount')::int,1,'a later explicit opening can acknowledge the new row');
reset role;
select pg_temp.prepare_first_opening('refresh-unread');
select pg_temp.opening_actor(); set local role authenticated;
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002054',now())->>'readCount')::int,151,'FIRST opening excludes a refreshed unread row version with the same xmin');
select is((public.app_client_notification_feed()->>'unreadCount')::int,1,'refreshed unread conversation remains unread');
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002062',now())->>'readCount')::int,1,'a later explicit opening acknowledges the refreshed version');
reset role;
select pg_temp.prepare_first_opening('refresh-read');
select pg_temp.opening_actor(); set local role authenticated;
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002055',now())->>'readCount')::int,151,'FIRST opening excludes an existing read row refreshed to unread');
select is((public.app_client_notification_feed()->>'unreadCount')::int,1,'refreshed formerly-read conversation remains unread');
select is((public.app_open_client_notifications('71000000-0000-4000-8000-000000002063',now())->>'readCount')::int,1,'a later explicit opening acknowledges the formerly-read row');
reset role;
select * from finish();
rollback;
