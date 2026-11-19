begin;

select plan(54);

-- WL-2.5 (KI-111, Tickets): every Ticket operation requires the Ticket to belong
-- to the caller's current Tenant. A foreign Ticket behaves like a missing one.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001201.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1201 WF admin; 1202 B admin (WF archived); 1203 WF owner; 1204 B owner (WF
-- archived); 1205 owner of both; 1206 B admin with an archived B membership (WF
-- archived); 1207 WF client of the WF Client; 1208 B client of the B Client (WF
-- archived); 1209 WF staff only.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'ticket-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1201', '1202', '1203', '1204', '1205', '1206', '1207', '1208', '1209']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001201', 'ticket-authz-tenant-b', 'Ticket Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000001201', private.wolf_forge_tenant_id(), 'Ticket WF Client', 'client'),
  ('c0000000-0000-4000-8000-000000001202', 'f0f0f0f0-0000-4000-8000-000000001201', 'Ticket B Client', 'client');

insert into public.services (id, tenant_id, name)
values ('c1000000-0000-4000-8000-000000001201', private.wolf_forge_tenant_id(), 'Ticket WF Service');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001201', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001202', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001203', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001204', 'owner', now(), null),
  ('20000000-0000-0000-0000-000000001205', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001206', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001207', 'client', null, 'c0000000-0000-4000-8000-000000001201'),
  ('20000000-0000-0000-0000-000000001208', 'client', now(), null),
  ('20000000-0000-0000-0000-000000001209', 'staff', null, null)
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001201', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001202', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001204', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001205', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001206', 'admin', 'internal', null, now()),
  ('20000000-0000-0000-0000-000000001208', 'client', 'client', 'c0000000-0000-4000-8000-000000001202', null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- TA / TB: one Ticket per Tenant, each with a client-visible message and a clean
-- attachment.
insert into public.tickets (id, tenant_id, company_id, client_profile_id, subject)
values
  ('c3000000-0000-4000-8000-000000001201', private.wolf_forge_tenant_id(),
   'c0000000-0000-4000-8000-000000001201', '20000000-0000-0000-0000-000000001207', 'WF Ticket'),
  ('c3000000-0000-4000-8000-000000001202', 'f0f0f0f0-0000-4000-8000-000000001201',
   'c0000000-0000-4000-8000-000000001202', '20000000-0000-0000-0000-000000001208', 'B Ticket');

insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body)
values
  ('c4000000-0000-4000-8000-000000001201', 'c3000000-0000-4000-8000-000000001201',
   '20000000-0000-0000-0000-000000001207', 'client', 'initial_request', 'client', 'WF hello'),
  ('c4000000-0000-4000-8000-000000001202', 'c3000000-0000-4000-8000-000000001202',
   '20000000-0000-0000-0000-000000001208', 'client', 'initial_request', 'client', 'B hello');

insert into public.ticket_attachments (id, ticket_id, ticket_message_id, storage_object_key, original_name,
  mime_type, size_bytes, checksum_sha256, scan_status)
values
  ('c5000000-0000-4000-8000-000000001201', 'c3000000-0000-4000-8000-000000001201',
   'c4000000-0000-4000-8000-000000001201', 'ticket-authz/wf', 'wf.pdf', 'application/pdf', 1, repeat('a', 64), 'clean'),
  ('c5000000-0000-4000-8000-000000001202', 'c3000000-0000-4000-8000-000000001202',
   'c4000000-0000-4000-8000-000000001202', 'ticket-authz/b', 'b.pdf', 'application/pdf', 1, repeat('b', 64), 'clean');

-- A Team conversation between the dual owner and WF-only staff (Team has no
-- Tenant yet).
insert into public.team_conversations (tenant_id, id, conversation_key, created_by_profile_id, kind)
values (private.wolf_forge_tenant_id(), 'c7000000-0000-4000-8000-000000001201',
  '20000000-0000-0000-0000-000000001205|20000000-0000-0000-0000-000000001209',
  '20000000-0000-0000-0000-000000001205', 'direct');
insert into public.team_conversation_members (conversation_id, profile_id)
values
  ('c7000000-0000-4000-8000-000000001201', '20000000-0000-0000-0000-000000001205'),
  ('c7000000-0000-4000-8000-000000001201', '20000000-0000-0000-0000-000000001209');

-- Runs one statement and returns 'ok' or its SQLSTATE.
create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Every id-based Ticket operation against one Ticket / message / attachment.
-- Mutations that succeed are kept, so the denial cases use the foreign Ticket.
create function pg_temp.battery(p_ticket text, p_message text, p_attachment text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'detail:' || pg_temp.try(format('select public.app_get_ticket_detail_with_avatars(%L)', p_ticket)),
    'reply:' || pg_temp.try(format('select public.app_reply_to_ticket(gen_random_uuid(), %L, %L)', p_ticket, 'x')),
    'quote:' || pg_temp.try(format('select public.app_reply_to_ticket_message(gen_random_uuid(), %L, %L, %L, null)',
      p_ticket, 'x', p_message)),
    'note:' || pg_temp.try(format('select public.app_add_ticket_internal_note(gen_random_uuid(), %L, %L)', p_ticket, 'x')),
    'status:' || pg_temp.try(format('select public.app_update_ticket_status(%L, %L)', p_ticket, 'in_progress')),
    'priority:' || pg_temp.try(format('select public.app_update_ticket_priority(%L, %L)', p_ticket, 'high')),
    'assign:' || pg_temp.try(format('select public.app_assign_ticket(%L, null)', p_ticket)),
    'inbox:' || pg_temp.try(format('select public.app_add_ticket_to_inbox(%L)', p_ticket)),
    'react:' || pg_temp.try(format('select public.app_toggle_ticket_message_reaction(%L, %L)', p_message, 'like')),
    'download:' || pg_temp.try(format('select public.app_get_ticket_attachment_download(%L)', p_attachment)),
    'archive:' || pg_temp.try(format('select public.app_archive_ticket(%L)', p_ticket))
  );
end;
$$;

-- Readback of one Ticket and its children (callers cannot read the tables).
create function pg_temp.snap(p_ticket text)
returns text
language sql
security definer
as $$
  select concat_ws('/', ticket.status, ticket.priority, ticket.archived_at is not null, ticket.inbox_added_at is not null,
    (select count(*) from public.ticket_messages where ticket_id = ticket.id),
    (select count(*) from public.ticket_message_reactions as reaction
      join public.ticket_messages as message on message.id = reaction.message_id
      where message.ticket_id = ticket.id))
  from public.tickets as ticket where ticket.id = p_ticket::uuid;
$$;

create function pg_temp.listed()
returns text
language sql
as $$
  select coalesce(string_agg(right(summary.ticket_id::text, 4), ' ' order by summary.ticket_id), '-')
  from public.app_list_ticket_summaries(true, false) as summary
  where summary.ticket_id::text like 'c3000000-0000-4000-8000-00000000120%';
$$;

-- Saving is personal; it must neither change the legacy global timestamp nor
-- grant a saver in a different Tenant. Inspect persisted fixture rows as owner.
create function pg_temp.savers(p_ticket text)
returns text language sql security definer as $$
  select coalesce(string_agg(profile_id::text, ',' order by profile_id), '')
  from private.ticket_inbox_memberships where ticket_id=p_ticket::uuid;
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.battery(text, text, text), pg_temp.snap(text),
  pg_temp.listed(), pg_temp.savers(text), pg_temp.act(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Shared helper (trusted call with the caller's claims)
-- -----------------------------------------------------------------------------

select pg_temp.act('1205', '');
select is(
  private.can_access_ticket('c3000000-0000-4000-8000-000000001201')::text || ' '
    || private.can_access_ticket('c3000000-0000-4000-8000-000000001202')::text,
  'true false', 'helper: dual owner with the WF selector reaches only the WF Ticket');
select pg_temp.act('1205', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(
  private.can_access_ticket('c3000000-0000-4000-8000-000000001201')::text || ' '
    || private.can_access_ticket('c3000000-0000-4000-8000-000000001202')::text,
  'false true', 'helper: dual owner with the B selector reaches only the B Ticket');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads: no direct table access at all
-- -----------------------------------------------------------------------------

select pg_temp.act('1201', '');
select throws_ok($$ select count(*) from public.tickets $$, '42501', 'permission denied for table tickets',
  'internal caller cannot read tickets directly');
select throws_ok($$ select count(*) from public.ticket_messages $$, '42501', 'permission denied for table ticket_messages',
  'internal caller cannot read ticket_messages directly');
select throws_ok($$ select count(*) from public.ticket_attachments $$, '42501', 'permission denied for table ticket_attachments',
  'internal caller cannot read ticket_attachments directly');

-- -----------------------------------------------------------------------------
-- Tenant A (Wolf Forge) admin
-- -----------------------------------------------------------------------------

select is(pg_temp.listed(), '1201', 'WF admin lists only the WF Ticket');
select is(
  pg_temp.battery('c3000000-0000-4000-8000-000000001202', 'c4000000-0000-4000-8000-000000001202',
    'c5000000-0000-4000-8000-000000001202'),
  'detail:42501 reply:42501 quote:42501 note:42501 status:P0002 priority:P0002 assign:P0002 inbox:P0002 react:42501 download:42501 archive:P0002',
  'WF admin -> B Ticket: every operation denied'
);
select is(
  pg_temp.battery('c3000000-0000-4000-8000-0000000012ff', 'c4000000-0000-4000-8000-0000000012ff',
    'c5000000-0000-4000-8000-0000000012ff'),
  'detail:42501 reply:42501 quote:42501 note:42501 status:P0002 priority:P0002 assign:P0002 inbox:P0002 react:P0002 download:P0002 archive:P0002',
  'missing ids: Ticket-id operations fail exactly like the foreign Ticket'
);
select is(pg_temp.snap('c3000000-0000-4000-8000-000000001202'), 'open/normal/f/f/1/0',
  'B Ticket unchanged after the WF admin attempts');

select is(
  pg_temp.battery('c3000000-0000-4000-8000-000000001201', 'c4000000-0000-4000-8000-000000001201',
    'c5000000-0000-4000-8000-000000001201'),
  'detail:ok reply:ok quote:ok note:ok status:ok priority:ok assign:ok inbox:ok react:ok download:ok archive:ok',
  'WF admin -> WF Ticket: every operation allowed'
);
select is(pg_temp.snap('c3000000-0000-4000-8000-000000001201'), 'in_progress/high/t/f/4/1',
  'WF Ticket changed by the WF admin');
select is(pg_temp.savers('c3000000-0000-4000-8000-000000001201'), '20000000-0000-0000-0000-000000001201',
  'WF admin saved only their own personal Inbox membership');

-- -----------------------------------------------------------------------------
-- Tenant B admin (WF Ticket now archived: restore it for the B attempts)
-- -----------------------------------------------------------------------------

reset role;
update public.tickets set archived_at = null where id = 'c3000000-0000-4000-8000-000000001201';
set local role authenticated;

select pg_temp.act('1202', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.listed(), '1202', 'B admin lists only the B Ticket');
select is(
  pg_temp.battery('c3000000-0000-4000-8000-000000001201', 'c4000000-0000-4000-8000-000000001201',
    'c5000000-0000-4000-8000-000000001201'),
  'detail:42501 reply:42501 quote:42501 note:42501 status:P0002 priority:P0002 assign:P0002 inbox:P0002 react:42501 download:42501 archive:P0002',
  'B admin -> WF Ticket: every operation denied'
);
select is(pg_temp.snap('c3000000-0000-4000-8000-000000001201'), 'in_progress/high/f/f/4/1',
  'WF Ticket unchanged after the B admin attempts');
select is(pg_temp.savers('c3000000-0000-4000-8000-000000001201'), '20000000-0000-0000-0000-000000001201',
  'Foreign admin attempts did not add or alter the WF personal save');
select is(
  pg_temp.battery('c3000000-0000-4000-8000-000000001202', 'c4000000-0000-4000-8000-000000001202',
    'c5000000-0000-4000-8000-000000001202'),
  'detail:ok reply:ok quote:ok note:ok status:ok priority:ok assign:ok inbox:ok react:ok download:ok archive:ok',
  'B admin -> B Ticket: every operation allowed'
);
select is(pg_temp.snap('c3000000-0000-4000-8000-000000001202'), 'in_progress/high/t/f/4/1',
  'B Ticket changed by the B admin');
select is(pg_temp.savers('c3000000-0000-4000-8000-000000001202'), '20000000-0000-0000-0000-000000001202',
  'B admin saved only their own personal Inbox membership');

reset role;
update public.tickets set archived_at = null where id = 'c3000000-0000-4000-8000-000000001202';
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Owners, dual owner, archived membership, selectors
-- -----------------------------------------------------------------------------

select pg_temp.act('1203', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001202') $$), '42501',
  'WF owner with the B selector cannot read the B Ticket');
select is(pg_temp.try($$ select public.app_update_ticket_status('c3000000-0000-4000-8000-000000001202', 'resolved') $$), '42501',
  'WF owner with the B selector cannot change the B Ticket');
select pg_temp.act('1203', '');
select is(pg_temp.try($$ select public.app_archive_ticket('c3000000-0000-4000-8000-000000001202') $$), 'P0002',
  'WF owner cannot archive the B Ticket by id');
select pg_temp.act('1204', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.try($$ select public.app_archive_ticket('c3000000-0000-4000-8000-000000001201') $$), 'P0002',
  'B owner cannot archive the WF Ticket by id');
select is(pg_temp.try($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001201',
    '20000000-0000-0000-0000-000000001201') $$), 'P0002',
  'B owner cannot assign the WF Ticket by id');
select pg_temp.act('1204', '');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001201') $$), '42501',
  'B owner (archived in WF) with no selector cannot read the WF Ticket');

select pg_temp.act('1205', '');
select is(pg_temp.listed(), '1201', 'dual owner with the WF selector lists the WF Ticket only');
select is(pg_temp.try($$ select public.app_update_ticket_priority('c3000000-0000-4000-8000-000000001202', 'low') $$), 'P0002',
  'dual owner with the WF selector cannot change the B Ticket');
select pg_temp.act('1205', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.listed(), '1202', 'dual owner with the B selector lists the B Ticket only');
select is(pg_temp.try($$ select public.app_update_ticket_priority('c3000000-0000-4000-8000-000000001201', 'low') $$), 'P0002',
  'dual owner with the B selector cannot change the WF Ticket');

select pg_temp.act('1206', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001202') $$), '42501',
  'archived B admin cannot read the B Ticket');
select is(pg_temp.try($$ select public.app_archive_ticket('c3000000-0000-4000-8000-000000001202') $$), '42501',
  'archived B admin cannot archive the B Ticket');

select pg_temp.act('1205', '{"x-wf-tenant":"not-a-uuid"}');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001201') $$), '42501',
  'malformed selector reads nothing');
select pg_temp.act('1205', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000012ff"}');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001201') $$), '42501',
  'foreign selector reads nothing');
select pg_temp.act('1209', '');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001201') $$), 'ok',
  'no selector keeps Wolf Forge compatibility for a WF member');

-- Forward to Team: a Tenant B Ticket message never reaches the Tenant-less Team.
select pg_temp.act('1205', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.try($$ select public.app_forward_ticket_message_to_team(gen_random_uuid(),
    'c4000000-0000-4000-8000-000000001202', 'c7000000-0000-4000-8000-000000001201', null) $$), '42501',
  'dual owner cannot forward a B Ticket message into a Team conversation');
select pg_temp.act('1205', '');
select is(pg_temp.try($$ select public.app_forward_ticket_message_to_team(gen_random_uuid(),
    'c4000000-0000-4000-8000-000000001201', 'c7000000-0000-4000-8000-000000001201', null) $$), 'ok',
  'dual owner still forwards a WF Ticket message into Team');

-- -----------------------------------------------------------------------------
-- Client portal
-- -----------------------------------------------------------------------------

select pg_temp.act('1207', '');
select is(pg_temp.listed(), '1201', 'WF client lists only their WF Ticket');
select is(pg_temp.try($$ select public.app_reply_to_ticket(gen_random_uuid(), 'c3000000-0000-4000-8000-000000001201', 'hi') $$),
  'ok', 'WF client replies to their WF Ticket');
select is(pg_temp.try($$ select public.app_get_ticket_detail('c3000000-0000-4000-8000-000000001202') $$), '42501',
  'WF client cannot read the B Ticket');
select pg_temp.act('1208', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is(pg_temp.listed(), '1202', 'B client lists only their B Ticket');
select is(pg_temp.try($$ select public.app_get_ticket_attachment_download('c5000000-0000-4000-8000-000000001201') $$), '42501',
  'B client cannot download the WF attachment');

-- -----------------------------------------------------------------------------
-- Ticket creation: Company, client and investment Service of the current Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1202', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select throws_ok($$ select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001201', 'subject', 's', 'message', 'm')) $$,
  '23503', 'active Ticket company is required', 'B admin cannot open a Ticket for a WF Client');
select lives_ok($$ select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001202', 'client_profile_id', '20000000-0000-0000-0000-000000001208',
    'subject', 's', 'message', 'm')) $$,
  'B admin opens a Ticket for the B client (membership-based client check)');
select throws_ok($$ select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001202', 'client_profile_id', '20000000-0000-0000-0000-000000001207',
    'subject', 's', 'message', 'm')) $$,
  '23514', 'Ticket client must belong to the selected company', 'B admin cannot name a WF client on a B Ticket');
select throws_ok($$ select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001202', 'subject', 's', 'message', 'm',
    'investment_service_id', 'c1000000-0000-4000-8000-000000001201')) $$,
  '23503', 'investment conversation service does not exist', 'B admin cannot reference a WF Service');
-- Replaying a B request id under the WF selector does not return the B Ticket.
select pg_temp.act('1205', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select lives_ok($$ select public.app_create_ticket('c6000000-0000-4000-8000-000000001201', jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001202', 'subject', 's', 'message', 'm')) $$,
  'dual owner opens a B Ticket with a fixed request id');
select pg_temp.act('1205', '');
select throws_ok($$ select public.app_create_ticket('c6000000-0000-4000-8000-000000001201', jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001202', 'subject', 's', 'message', 'm')) $$,
  'P0002', null, 'replay under the WF selector does not return the B Ticket');
select pg_temp.act('1201', '');
select lives_ok($$ select public.app_create_ticket(gen_random_uuid(), jsonb_build_object(
    'company_id', 'c0000000-0000-4000-8000-000000001201', 'client_profile_id', '20000000-0000-0000-0000-000000001207',
    'subject', 's', 'message', 'm', 'investment_service_id', 'c1000000-0000-4000-8000-000000001201')) $$,
  'WF admin opens a WF Ticket for the WF client and WF Service');

-- 900 personal saves with identical timestamps make the ID tie-breaker observable.
reset role;
insert into public.tickets (id, tenant_id, company_id, subject, updated_at)
select ('c9000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  private.wolf_forge_tenant_id(), 'c0000000-0000-4000-8000-000000001201',
  'Pagination fixture ' || n, '2026-11-01 00:00:00+00'
from generate_series(1, 900) n;
insert into private.ticket_inbox_memberships (ticket_id, profile_id)
select id, '20000000-0000-0000-0000-000000001205'
from public.tickets where subject like 'Pagination fixture %';

set local role authenticated;
select pg_temp.act('1205', '');
select is((select count(*) from public.app_list_ticket_summaries(false, true)
  where subject like 'Pagination fixture %'), 900::bigint, 'owner sees all 900 personal saves');
select results_eq($$select subject from public.app_list_ticket_summaries(false, true)
  where subject like 'Pagination fixture %' order by updated_at desc, ticket_id limit 10$$,
  $$select 'Pagination fixture ' || n from generate_series(1, 10) n$$, 'first ten tied rows in ID order');
select results_eq($$select subject from public.app_list_ticket_summaries(false, true)
  where subject like 'Pagination fixture %' order by updated_at desc, ticket_id limit 10 offset 890$$,
  $$select 'Pagination fixture ' || n from generate_series(891, 900) n$$, 'last ten tied rows in ID order');
select is((select subject from public.app_list_ticket_summaries(false, true)
  where subject ~* '***=fixture 899' order by updated_at desc, ticket_id limit 10),
  'Pagination fixture 899', 'literal search finds a last-page subject');
select pg_temp.act('1201', '');
select is((select count(*) from public.app_list_ticket_summaries(false, true)
  where subject like 'Pagination fixture %'), 0::bigint, 'another internal user cannot find the personal saves');
select pg_temp.act('1205', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001201"}');
select is((select count(*) from public.app_list_ticket_summaries(false, true)
  where subject like 'Pagination fixture %'), 0::bigint, 'even the saving owner cannot find these in another tenant');

select * from finish();

rollback;
