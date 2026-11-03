-- Isolated synthetic Supabase acceptance only. No hosted target or real accounts.
begin;
select no_plan();
\ir ../fixtures/ticket_calls.inc
create function pg_temp.actor(n text default '1701') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||n,
   'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||n)::text,true);
 perform set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}',true);
end $$;
create function pg_temp.invite(n text,recipient text default '1704') returns jsonb language sql as $$
 select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701',
  ('71000000-0000-4000-8000-00000000'||n)::uuid,'72000000-0000-4000-8000-000000001981','audio',
  ('20000000-0000-4000-8000-00000000'||recipient)::uuid);
$$;
create function pg_temp.call_id(n text) returns uuid language sql security definer as $$
 select id from private.ticket_calls where request_id=('71000000-0000-4000-8000-00000000'||n)::uuid;
$$;
select ok(not has_table_privilege('authenticated','private.ticket_inbox_memberships','select'),'personal bookmarks cannot be enumerated');
select ok(not has_function_privilege('anon','public.app_ticket_call_signal_context()','execute'),'anonymous event subscription denied');
delete from private.ticket_inbox_memberships where ticket_id='e1700000-0000-4000-8000-000000001701';
update public.tickets set inbox_added_at=now() where id='e1700000-0000-4000-8000-000000001701';
insert into public.ticket_messages(ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at) values
 ('e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001701','client','initial_request','client','Existing synthetic client message',now()-interval '1 hour'),
 ('e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704','internal','internal_note','internal','Existing synthetic internal note',now()-interval '30 minutes');
create temporary table legacy_inbox_before as select to_jsonb(t) as ticket,
  (select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.ticket_messages m where m.ticket_id=t.id) as messages
  from public.tickets t where t.id='e1700000-0000-4000-8000-000000001701';
-- A foreign Ticket remains invisible even if an unrelated private save exists.
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001981','calling-inbox-foreign-fixture','Foreign synthetic Inbox','active');
insert into public.companies(id,tenant_id,name,status) values
 ('e0000000-0000-4000-8000-000000001981','f0f0f0f0-0000-4000-8000-000000001981','Foreign synthetic company','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
 select 'f0f0f0f0-0000-4000-8000-000000001981','20000000-0000-4000-8000-000000001702','client',id,
 'e0000000-0000-4000-8000-000000001981' from public.roles where name='client';
insert into public.tickets(id,tenant_id,company_id,client_profile_id,subject,status,inbox_added_at) values
 ('e1700000-0000-4000-8000-000000001981','f0f0f0f0-0000-4000-8000-000000001981',
 'e0000000-0000-4000-8000-000000001981','20000000-0000-4000-8000-000000001702','Foreign synthetic Ticket','open',now());
insert into private.ticket_inbox_memberships(ticket_id,profile_id) values
 ('e1700000-0000-4000-8000-000000001981','20000000-0000-4000-8000-000000001704');
select pg_temp.actor('1704'); set local role authenticated;
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),1::bigint,'legacy Inbox remains visible before any personal save');
select ok((select inbox_added_at is not null and personal_inbox_added_at is null from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),'visible and personally saved are separate summary facts');
select ok(public.app_get_ticket_detail_with_avatars('e1700000-0000-4000-8000-000000001701')#>>'{ticket,inbox_added_at}' is not null
 and public.app_get_ticket_detail_with_avatars('e1700000-0000-4000-8000-000000001701')#>>'{ticket,personal_inbox_added_at}' is null,'detail preserves legacy visibility without fabricating a personal save');
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001981'),0::bigint,'foreign shared timestamp and private save cannot widen workspace visibility');
select throws_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001981')$q$,'P0002',null,'cross-workspace personal save is rejected');
reset role;
select pg_temp.actor('1703'); set local role authenticated;
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701' and personal_inbox_added_at is null),1::bigint,'other authorized legacy viewers retain their Inbox without becoming savers');
reset role;
select pg_temp.actor(); set local role authenticated;
select ok(not (public.app_get_ticket_detail_with_avatars('e1700000-0000-4000-8000-000000001701')->'ticket' ?| array['inbox_added_at','personal_inbox_added_at']),'new client detail wrapper exposes neither internal Inbox fact');
select ok((select inbox_added_at is null and personal_inbox_added_at is null from public.app_list_ticket_summaries(false,false) where ticket_id='e1700000-0000-4000-8000-000000001701'),'client summary exposes no internal visibility or personal-save timestamp');
select is(jsonb_array_length(public.app_ticket_call_prepare('e1700000-0000-4000-8000-000000001701')->'candidates'),0,'legacy global flag creates no personal candidates');
select throws_ok($q$select public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701','71000000-0000-4000-8000-000000001980','72000000-0000-4000-8000-000000001981','audio')$q$,'42501','Call unavailable','legacy request cannot restore automatic assignment/fallback routing');
select throws_ok($q$select pg_temp.invite('1981')$q$,'42501','Call unavailable','unsaved recipient rejected on server');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select lives_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001701')$q$,'eligible internal person explicitly saves Ticket');
select lives_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001701')$q$,'personal save is idempotent');
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),1::bigint,'saved Ticket appears in own Inbox');
select ok((select personal_inbox_added_at is not null from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),'explicit save is distinguishable on the legacy-visible summary');
select ok(public.app_get_ticket_detail_with_avatars('e1700000-0000-4000-8000-000000001701')#>>'{ticket,personal_inbox_added_at}' is not null,'detail reports this viewer personal save');
reset role;
select is((select count(*) from private.ticket_inbox_memberships where ticket_id='e1700000-0000-4000-8000-000000001701'),1::bigint,'one personal membership after replay');
select is((select to_jsonb(t) from public.tickets t where id='e1700000-0000-4000-8000-000000001701'),(select ticket from legacy_inbox_before),'personal save and duplicate leave the complete Ticket row unchanged');
select is((select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.ticket_messages m where ticket_id='e1700000-0000-4000-8000-000000001701'),(select messages from legacy_inbox_before),'personal save and duplicate leave all messages unchanged');
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000001705' and tenant_id='f0f0f0f0-0000-4000-8000-000000001701';
select pg_temp.actor('1705'); set local role authenticated;
select throws_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001701')$q$,'P0002','Tenant not found','revoked workspace access cannot personally save a legacy Ticket');
select is((select count(*) from public.app_list_ticket_summaries(false,true)),0::bigint,'revoked workspace access cannot retain legacy Inbox visibility');
reset role;
update public.tenant_memberships set archived_at=null where profile_id='20000000-0000-4000-8000-000000001705' and tenant_id='f0f0f0f0-0000-4000-8000-000000001701';
-- Personal saves on a new Ticket are not silently turned into new global saves.
delete from private.ticket_inbox_memberships where ticket_id='e1700000-0000-4000-8000-000000001702';
select pg_temp.actor('1704'); set local role authenticated;
select lives_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001702')$q$,'viewer can personally save a previously non-Inbox Ticket');
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001702' and personal_inbox_added_at is not null),1::bigint,'personal-only Ticket is visible to its saver');
reset role;
select ok((select inbox_added_at is null from public.tickets where id='e1700000-0000-4000-8000-000000001702'),'personal save does not invent shared visibility');
select pg_temp.actor('1703'); set local role authenticated;
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001702'),0::bigint,'another authorized teammate does not inherit the personal-only save');
select is((select count(*) from public.app_list_ticket_summaries(false,false) where ticket_id='e1700000-0000-4000-8000-000000001702'),1::bigint,'same teammate retains ordinary Ticket access without personal Inbox visibility');
reset role;
select pg_temp.actor(); set local role authenticated;
select is(jsonb_array_length(public.app_ticket_call_prepare('e1700000-0000-4000-8000-000000001701')->'candidates'),1,'one candidate');
select is(public.app_ticket_call_prepare('e1700000-0000-4000-8000-000000001701')->'candidates'->0->>'role','Administrator','current membership role is projected');
select throws_ok($q$select pg_temp.invite('1981','1702')$q$,'42501','Call unavailable','forged same-company client recipient rejected');
reset role;
select pg_temp.actor('1703'); set local role authenticated;
select lives_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001701')$q$,'second viewer deliberately saves the same legacy Ticket');
select is((select count(*) from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),1::bigint,'each saver has independent Inbox membership');
reset role;
select pg_temp.actor('1705'); set local role authenticated;
select lives_ok($q$select public.app_add_ticket_to_inbox('e1700000-0000-4000-8000-000000001701')$q$,'third viewer deliberately saves independently');
reset role;
select pg_temp.actor(); set local role authenticated;
select is(jsonb_array_length(public.app_ticket_call_prepare('e1700000-0000-4000-8000-000000001701')->'candidates'),3,'three independent candidates');
savepoint call_authority_scenarios;
select is(pg_temp.invite('1981','1703')->>'calleeId','20000000-0000-4000-8000-000000001703','client explicitly selects a non-assignee');
select is(pg_temp.invite('1981','1703')->>'state','ringing','selected-recipient replay is idempotent');
select throws_ok($q$select pg_temp.invite('1981','1704')$q$,'22023','Call request conflicts','same request cannot redirect a call to another person');
reset role;
select is((select cardinality(participants) from private.ticket_calls where id=pg_temp.call_id('1981')),2,'only caller and one selected callee are frozen');
select is((select count(*) from private.ticket_call_claims where call_id=pg_temp.call_id('1981')),2::bigint,'no fan-out busy claims');
select pg_temp.actor(); set local role authenticated;
select public.app_ticket_call_command('cancel',pg_temp.call_id('1981'));
reset role;
update private.ticket_call_environment set pilot_profile_ids=array['20000000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704']::uuid[];
set local role authenticated;
select is(jsonb_array_length(public.app_ticket_call_prepare('e1700000-0000-4000-8000-000000001701')->'candidates'),1,'pilot restriction still narrows saved candidates');
select throws_ok($q$select pg_temp.invite('1982','1703')$q$,'42501','Call unavailable','forged out-of-pilot Owner denied');
select is(pg_temp.invite('1982')->>'state','ringing','selected pilot recipient admitted');
reset role;
delete from private.ticket_inbox_memberships where ticket_id='e1700000-0000-4000-8000-000000001701' and profile_id='20000000-0000-4000-8000-000000001704';
select is(private.process_ticket_call_deadlines(),1,'removed save revokes existing call lifecycle');
select is((select reason from private.ticket_calls where id=pg_temp.call_id('1982')),'authority_revoked','revocation is authoritative');
select pg_temp.actor('1704'); set local role authenticated;
select throws_ok($q$select public.app_ticket_call_command('accept',pg_temp.call_id('1982'),'72000000-0000-4000-8000-000000001984')$q$,'42501','Call already taken or ended','removed saver cannot accept');
reset role;
insert into private.ticket_inbox_memberships(ticket_id,profile_id) values('e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704');
select pg_temp.actor(); set local role authenticated;
select is(pg_temp.invite('1983')->>'state','ringing','new independently authorized request admitted');
reset role;
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000001704' and tenant_id='f0f0f0f0-0000-4000-8000-000000001701';
select is(private.process_ticket_call_deadlines(),1,'workspace access removal revokes invitation');
select pg_temp.actor(); set local role authenticated;
select throws_ok($q$select pg_temp.invite('1984')$q$,'42501','Call unavailable','revoked selected recipient cannot create another invitation');
reset role;
update public.tenant_memberships set archived_at=null where profile_id='20000000-0000-4000-8000-000000001704' and tenant_id='f0f0f0f0-0000-4000-8000-000000001701';
select pg_temp.actor(); set local role authenticated;
select is(pg_temp.invite('1984')->>'state','ringing','request after restored synthetic access');
reset role;
update private.ticket_calls set ring_deadline=clock_timestamp()-interval '1 second' where id=pg_temp.call_id('1984');
select is(private.process_ticket_call_deadlines(),1,'unanswered invitation becomes missed');
select is(private.process_ticket_call_deadlines(),0,'deadline processing remains idempotent');
select is((select href from public.notifications where event_key='ticket-call-missed:'||pg_temp.call_id('1984')::text),'/tickets/e1700000-0000-4000-8000-000000001701?inbox=tickets&ticket=e1700000-0000-4000-8000-000000001701','missed team notification opens actual Inbox conversation');
-- Independent fixtures: ended invitations retain their immutable budget holds.
-- Restore setup rather than weakening limits or editing their deadlines.
rollback to savepoint call_authority_scenarios;
release savepoint call_authority_scenarios;
reset role;
select pg_temp.actor(); set local role authenticated;
select is(pg_temp.invite('1987')->>'state','ringing','media revocation fixture is admitted');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select is(public.app_ticket_call_command('accept',pg_temp.call_id('1987'),'72000000-0000-4000-8000-000000001984')->>'state','accepted','selected recipient accepts before removal');
reset role;
delete from private.ticket_inbox_memberships where ticket_id='e1700000-0000-4000-8000-000000001701' and profile_id='20000000-0000-4000-8000-000000001704';
select is(private.process_ticket_call_deadlines(),1,'membership withdrawal after acceptance terminates media authority');
set local role authenticated;
select throws_ok($q$select public.app_ticket_call_command('setup',pg_temp.call_id('1987'),'72000000-0000-4000-8000-000000001984')$q$,'42501','Call unavailable','removed recipient cannot obtain a media setup lease');
reset role;
insert into private.ticket_inbox_memberships(ticket_id,profile_id) values('e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704');
set local role authenticated;
select is(public.app_request_ticket_call('e1700000-0000-4000-8000-000000001701','71000000-0000-4000-8000-000000001988','72000000-0000-4000-8000-000000001984','audio')->>'direction','team_to_client','internal calls still target the owning client');
reset role;
update private.ticket_calls set ring_deadline=clock_timestamp()-interval '1 second' where id=pg_temp.call_id('1988');
set local role authenticated;
select public.app_ticket_call_command('cancel',pg_temp.call_id('1988'));
reset role;
select is((select outcome from private.ticket_calls where id=pg_temp.call_id('1988')),'missed','deadline-triggered cancel is missed, not a user cancellation');
select is((select href from public.notifications where event_key='ticket-call-missed:'||pg_temp.call_id('1988')::text),'/account/messages/e1700000-0000-4000-8000-000000001701','missed client notification opens actual conversation');
select pg_temp.actor(); set local role authenticated;
select ok((public.app_ticket_call_history('e1700000-0000-4000-8000-000000001701')->0) ?& array['caller','callee','outcome','reason','mode','requestedAt'],'client history contains authoritative named call records');
reset role;
select pg_temp.actor('1704'); set local role authenticated;
select ok(jsonb_array_length(public.app_ticket_call_history('e1700000-0000-4000-8000-000000001701'))>0,'selected internal participant sees history too');
select ok(private.ticket_call_signal_allowed('ticket-calls:f0f0f0f0-0000-4000-8000-000000001701:20000000-0000-4000-8000-000000001704'),'own authorized signal topic');
select ok(not private.ticket_call_signal_allowed('ticket-calls:f0f0f0f0-0000-4000-8000-000000001701:20000000-0000-4000-8000-000000001701'),'cannot subscribe to another participant topic');
reset role;
-- Match Orders: reads, notes, system events, reactions and call rows do not reply.
insert into public.ticket_messages(id,ticket_id,author_profile_id,author_type,message_kind,visibility,body,created_at) values
 ('78000000-0000-4000-8000-000000001981','e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001701','client','reply','client','Synthetic public question',now()-interval '2 minutes'),
 ('78000000-0000-4000-8000-000000001982','e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704','internal','internal_note','internal','Synthetic note',now()-interval '1 minute');
select pg_temp.actor('1704'); set local role authenticated;
select is((select unanswered from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),true,'client public message awaits team reply despite newer note and call events');
select public.app_get_ticket_detail_with_avatars('e1700000-0000-4000-8000-000000001701');
select is((select unanswered from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),true,'opening conversation does not clear Unanswered');
select public.app_toggle_ticket_message_reaction('78000000-0000-4000-8000-000000001981','heart');
select is((select unanswered from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),true,'a team reaction is not a public reply');
reset role;
insert into public.ticket_messages(ticket_id,author_profile_id,author_type,message_kind,visibility,body) values
 ('e1700000-0000-4000-8000-000000001701','20000000-0000-4000-8000-000000001704','internal','reply','client','Synthetic public answer');
select pg_temp.actor('1704'); set local role authenticated;
select is((select unanswered from public.app_list_ticket_summaries(false,true) where ticket_id='e1700000-0000-4000-8000-000000001701'),false,'public team reply clears Unanswered');
reset role;
select * from finish();
rollback;
