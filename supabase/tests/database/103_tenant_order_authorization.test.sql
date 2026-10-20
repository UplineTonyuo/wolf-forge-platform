begin;

select plan(51);

-- WL-2.6 (KI-111, Orders / Projects / tasks): every Order operation requires
-- the Order (for tasks, Project messages, attachments and reactions: the parent
-- Order) to belong to the caller's current Tenant. A foreign Order behaves like
-- a missing one. WF = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = f0f0f0f0-0000-4000-8000-000000001301.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1301 WF admin; 1302 B admin (WF archived); 1303 WF owner; 1304 B owner (WF
-- archived); 1305 owner of both; 1306 B admin with an archived B membership (WF
-- archived); 1307 WF client of the WF Client; 1308 B client of the B Client (WF
-- archived).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'order-authz-' || n || '@example.invalid', now(), now()
from unnest(array['1301', '1302', '1303', '1304', '1305', '1306', '1307', '1308']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001301', 'order-authz-tenant-b', 'Order Authz Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('d0000000-0000-4000-8000-000000001301', private.wolf_forge_tenant_id(), 'Order WF Client', 'client'),
  ('d0000000-0000-4000-8000-000000001302', 'f0f0f0f0-0000-4000-8000-000000001301', 'Order B Client', 'client');

insert into public.services (id, tenant_id, name)
values
  ('d1000000-0000-4000-8000-000000001301', private.wolf_forge_tenant_id(), 'Order WF Service'),
  ('d1000000-0000-4000-8000-000000001302', 'f0f0f0f0-0000-4000-8000-000000001301', 'Order B Service');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at,
    company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000001301', 'admin', null::timestamptz, null),
  ('20000000-0000-0000-0000-000000001302', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001303', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001304', 'owner', now(), null),
  ('20000000-0000-0000-0000-000000001305', 'owner', null, null),
  ('20000000-0000-0000-0000-000000001306', 'admin', now(), null),
  ('20000000-0000-0000-0000-000000001307', 'client', null, 'd0000000-0000-4000-8000-000000001301'),
  ('20000000-0000-0000-0000-000000001308', 'client', now(), null)
) as fixture(profile_id, role_name, archived_at, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001301', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001302', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-0000-0000-000000001304', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001305', 'owner', 'internal', null, null),
  ('20000000-0000-0000-0000-000000001306', 'admin', 'internal', null, now()),
  ('20000000-0000-0000-0000-000000001308', 'client', 'client', 'd0000000-0000-4000-8000-000000001302', null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- OA / OB: one native Project per Tenant with a task, a client message, a clean
-- attachment and a reaction. OL: a Tenant B Project with a linked Ticket (the
-- Order-to-Ticket side door).
insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('d3000000-0000-4000-8000-000000001301', private.wolf_forge_tenant_id(),
   'd0000000-0000-4000-8000-000000001301', 'd1000000-0000-4000-8000-000000001301', 'WF Project'),
  ('d3000000-0000-4000-8000-000000001302', 'f0f0f0f0-0000-4000-8000-000000001301',
   'd0000000-0000-4000-8000-000000001302', 'd1000000-0000-4000-8000-000000001302', 'B Project'),
  ('d3000000-0000-4000-8000-000000001303', 'f0f0f0f0-0000-4000-8000-000000001301',
   'd0000000-0000-4000-8000-000000001302', 'd1000000-0000-4000-8000-000000001302', 'B Linked Project');

insert into public.order_tasks (id, order_id, title)
values
  ('d4000000-0000-4000-8000-000000001301', 'd3000000-0000-4000-8000-000000001301', 'WF task'),
  ('d4000000-0000-4000-8000-000000001302', 'd3000000-0000-4000-8000-000000001302', 'B task');

insert into public.project_messages (id, order_id, author_profile_id, author_type, body)
values
  ('d5000000-0000-4000-8000-000000001301', 'd3000000-0000-4000-8000-000000001301',
   '20000000-0000-0000-0000-000000001307', 'client', 'WF hello'),
  ('d5000000-0000-4000-8000-000000001302', 'd3000000-0000-4000-8000-000000001302',
   '20000000-0000-0000-0000-000000001308', 'client', 'B hello');

insert into public.project_attachments (id, order_id, project_message_id, storage_object_key, original_name,
  mime_type, size_bytes, checksum_sha256, scan_status)
values
  ('d6000000-0000-4000-8000-000000001301', 'd3000000-0000-4000-8000-000000001301',
   'd5000000-0000-4000-8000-000000001301', 'order-authz/wf', 'wf.pdf', 'application/pdf', 1, repeat('a', 64), 'clean'),
  ('d6000000-0000-4000-8000-000000001302', 'd3000000-0000-4000-8000-000000001302',
   'd5000000-0000-4000-8000-000000001302', 'order-authz/b', 'b.pdf', 'application/pdf', 1, repeat('b', 64), 'clean');

insert into public.project_message_reactions (message_id, reactor_profile_id, reaction_code)
values
  ('d5000000-0000-4000-8000-000000001301', '20000000-0000-0000-0000-000000001307', 'heart'),
  ('d5000000-0000-4000-8000-000000001302', '20000000-0000-0000-0000-000000001308', 'heart');

insert into public.tickets (id, tenant_id, company_id, client_profile_id, order_id, subject)
values ('d7000000-0000-4000-8000-000000001301', 'f0f0f0f0-0000-4000-8000-000000001301',
  'd0000000-0000-4000-8000-000000001302', '20000000-0000-0000-0000-000000001308',
  'd3000000-0000-4000-8000-000000001303', 'B linked Ticket');
insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body)
values ('d8000000-0000-4000-8000-000000001301', 'd7000000-0000-4000-8000-000000001301',
  '20000000-0000-0000-0000-000000001308', 'client', 'initial_request', 'client', 'B linked hello');
insert into public.ticket_attachments (id, ticket_id, ticket_message_id, storage_object_key, original_name,
  mime_type, size_bytes, checksum_sha256, scan_status)
values ('d9000000-0000-4000-8000-000000001301', 'd7000000-0000-4000-8000-000000001301',
  'd8000000-0000-4000-8000-000000001301', 'order-authz/b-linked', 'bl.pdf', 'application/pdf', 1, repeat('c', 64), 'clean');

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

-- Every id-based Order / Project / task operation against one Order, task,
-- Project message and attachment. Archive runs last.
create function pg_temp.battery(p_order text, p_task text, p_message text, p_attachment text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    'conv:' || pg_temp.try(format('select public.app_get_order_conversation(%L)', p_order)),
    'native:' || pg_temp.try(format('select public.app_get_project_conversation(%L)', p_order)),
    'send:' || pg_temp.try(format('select public.app_send_order_message(%L, gen_random_uuid(), %L, false)', p_order, 'x')),
    'reply:' || pg_temp.try(format('select public.app_reply_to_order_message(%L, gen_random_uuid(), %L, %L, null)',
      p_order, 'x', p_message)),
    'react:' || pg_temp.try(format('select public.app_toggle_order_message_reaction(%L, %L, %L)', p_order, p_message, 'like')),
    'download:' || pg_temp.try(format('select public.app_get_ticket_attachment_download(%L)', p_attachment)),
    'prepare:' || pg_temp.try(format('select public.app_prepare_ticket_attachment(gen_random_uuid(), null, %L, null)', p_order)),
    'update:' || pg_temp.try(format('select public.app_update_order(%L, %L)', p_order, '{"title":"Changed"}')),
    'status:' || pg_temp.try(format('select public.app_change_order_status(%L, %L)', p_order, 'working')),
    'assign:' || pg_temp.try(format('select public.app_assign_order(%L, null)', p_order)),
    'newtask:' || pg_temp.try(format('select public.app_create_task(gen_random_uuid(), %L, %L, null, null, null, 0)', p_order, 'New')),
    'task:' || pg_temp.try(format('select public.app_update_task(%L, %L)', p_task, '{"title":"Changed"}')),
    'taskstatus:' || pg_temp.try(format('select public.app_change_task_status(%L, %L)', p_task, 'in_progress')),
    'taskassign:' || pg_temp.try(format('select public.app_assign_task(%L, null)', p_task)),
    'reorder:' || pg_temp.try(format('select public.app_reorder_task(%L, 5)', p_task)),
    'archive:' || pg_temp.try(format('select public.app_archive_order(%L)', p_order))
  );
end;
$$;

-- Readback of one Order and its children (security definer: callers cannot read
-- the child tables).
create function pg_temp.snap(p_order text)
returns text
language sql
security definer
as $$
  select concat_ws('/', project.title, project.status, project.archived_at is not null,
    (select string_agg(task.title || ':' || task.status || ':' || task.sort_position, ',' order by task.title)
      from public.order_tasks as task where task.order_id = project.id),
    (select count(*) from public.project_messages where order_id = project.id),
    (select count(*) from public.project_message_reactions as reaction
      join public.project_messages as message on message.id = reaction.message_id
      where message.order_id = project.id and reaction.active))
  from public.orders as project where project.id = p_order::uuid;
$$;

-- Fixture Orders / tasks visible through direct RLS reads.
create function pg_temp.visible()
returns text
language sql
as $$
  select coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.orders
      where id::text like 'd3000000-0000-4000-8000-00000000130%'), '-')
    || ' | ' || coalesce((select string_agg(right(id::text, 4), ' ' order by id) from public.order_tasks
      where id::text like 'd4000000-0000-4000-8000-00000000130%'), '-');
$$;

create function pg_temp.portal()
returns text
language sql
as $$
  select coalesce(string_agg(right(project.id::text, 4), ' ' order by project.id), '-')
  from public.app_list_my_client_projects(100) as project
  where project.id::text like 'd3000000-0000-4000-8000-00000000130%';
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.battery(text, text, text, text), pg_temp.snap(text),
  pg_temp.visible(), pg_temp.portal(), pg_temp.act(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Shared helpers (trusted call with the caller's claims)
-- -----------------------------------------------------------------------------

select pg_temp.act('1305', '');
select is(
  concat_ws(' ', private.can_access_operational_order('d3000000-0000-4000-8000-000000001301'),
    private.can_access_operational_order('d3000000-0000-4000-8000-000000001302'),
    private.can_access_operational_task('d4000000-0000-4000-8000-000000001301'),
    private.can_access_operational_task('d4000000-0000-4000-8000-000000001302')),
  't f t f', 'helpers: dual owner with the WF selector reaches only the WF Order and task');
select pg_temp.act('1305', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(
  concat_ws(' ', private.can_access_operational_order('d3000000-0000-4000-8000-000000001301'),
    private.can_access_operational_order('d3000000-0000-4000-8000-000000001302'),
    private.can_access_operational_task('d4000000-0000-4000-8000-000000001301'),
    private.can_access_operational_task('d4000000-0000-4000-8000-000000001302')),
  'f t f t', 'helpers: dual owner with the B selector reaches only the B Order and task');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Direct reads
-- -----------------------------------------------------------------------------

select pg_temp.act('1301', '');
select is(pg_temp.visible(), '1301 | 1301', 'WF admin reads only WF Orders and tasks directly');
select throws_ok($$ select count(*) from public.project_messages $$, '42501', 'permission denied for table project_messages',
  'no direct project_messages access');
select throws_ok($$ select count(*) from public.project_attachments $$, '42501', 'permission denied for table project_attachments',
  'no direct project_attachments access');
select throws_ok($$ select count(*) from public.project_message_reactions $$, '42501',
  'permission denied for table project_message_reactions', 'no direct project_message_reactions access');
select pg_temp.act('1302', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.visible(), '1302 1303 | 1302', 'B admin reads only B Orders and tasks directly');

-- -----------------------------------------------------------------------------
-- Tenant A (Wolf Forge) admin
-- -----------------------------------------------------------------------------

select pg_temp.act('1301', '');
select is(
  pg_temp.battery('d3000000-0000-4000-8000-000000001302', 'd4000000-0000-4000-8000-000000001302',
    'd5000000-0000-4000-8000-000000001302', 'd6000000-0000-4000-8000-000000001302'),
  'conv:P0002 native:P0002 send:P0002 reply:P0002 react:P0002 download:P0002 prepare:P0002 update:P0002 status:P0002 assign:P0002 newtask:P0002 task:P0002 taskstatus:P0002 taskassign:P0002 reorder:P0002 archive:P0002',
  'WF admin -> B Order: every operation fails like a missing Order'
);
select is(
  pg_temp.battery('d3000000-0000-4000-8000-0000000013ff', 'd4000000-0000-4000-8000-0000000013ff',
    'd5000000-0000-4000-8000-0000000013ff', 'd6000000-0000-4000-8000-0000000013ff'),
  'conv:P0002 native:P0002 send:P0002 reply:P0002 react:P0002 download:P0002 prepare:P0002 update:P0002 status:P0002 assign:P0002 newtask:P0002 task:P0002 taskstatus:P0002 taskassign:P0002 reorder:P0002 archive:P0002',
  'missing ids fail exactly like the foreign Order'
);
select is(pg_temp.snap('d3000000-0000-4000-8000-000000001302'), 'B Project/pending/f/B task:todo:0/1/1',
  'B Order unchanged after the WF admin attempts');

select is(
  pg_temp.battery('d3000000-0000-4000-8000-000000001301', 'd4000000-0000-4000-8000-000000001301',
    'd5000000-0000-4000-8000-000000001301', 'd6000000-0000-4000-8000-000000001301'),
  'conv:ok native:ok send:ok reply:ok react:ok download:ok prepare:ok update:ok status:ok assign:ok newtask:ok task:ok taskstatus:ok taskassign:ok reorder:ok archive:ok',
  'WF admin -> WF Order: every operation allowed'
);
select is(pg_temp.snap('d3000000-0000-4000-8000-000000001301'), 'Changed/working/t/Changed:in_progress:5,New:todo:0/3/2',
  'WF Order changed by the WF admin');

-- Restore the WF Order for the Tenant B attempts.
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.orders set archived_at = null where id = 'd3000000-0000-4000-8000-000000001301';
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Tenant B admin
-- -----------------------------------------------------------------------------

select pg_temp.act('1302', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(
  pg_temp.battery('d3000000-0000-4000-8000-000000001301', 'd4000000-0000-4000-8000-000000001301',
    'd5000000-0000-4000-8000-000000001301', 'd6000000-0000-4000-8000-000000001301'),
  'conv:P0002 native:P0002 send:P0002 reply:P0002 react:P0002 download:P0002 prepare:P0002 update:P0002 status:P0002 assign:P0002 newtask:P0002 task:P0002 taskstatus:P0002 taskassign:P0002 reorder:P0002 archive:P0002',
  'B admin -> WF Order: every operation fails like a missing Order'
);
select is(pg_temp.snap('d3000000-0000-4000-8000-000000001301'), 'Changed/working/f/Changed:in_progress:5,New:todo:0/3/2',
  'WF Order unchanged after the B admin attempts');
select is(
  pg_temp.battery('d3000000-0000-4000-8000-000000001302', 'd4000000-0000-4000-8000-000000001302',
    'd5000000-0000-4000-8000-000000001302', 'd6000000-0000-4000-8000-000000001302'),
  'conv:ok native:ok send:ok reply:ok react:ok download:ok prepare:ok update:ok status:ok assign:ok newtask:ok task:ok taskstatus:ok taskassign:ok reorder:ok archive:ok',
  'B admin -> B Order: every operation allowed'
);
select is(pg_temp.snap('d3000000-0000-4000-8000-000000001302'), 'Changed/working/t/Changed:in_progress:5,New:todo:0/3/2',
  'B Order changed by the B admin');
-- The old archive returned an already-archived Order to any Tenant's admin.
select pg_temp.act('1301', '');
select is(pg_temp.try($$ select public.app_archive_order('d3000000-0000-4000-8000-000000001302') $$), 'P0002',
  'WF admin cannot read back the archived B Order through archive');

reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.orders set archived_at = null where id = 'd3000000-0000-4000-8000-000000001302';
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Order-linked Ticket side door
-- -----------------------------------------------------------------------------

select pg_temp.act('1301', '');
select is(
  concat_ws(' ',
    pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001303') $$),
    pg_temp.try($$ select public.app_send_order_message('d3000000-0000-4000-8000-000000001303', gen_random_uuid(), 'x', false) $$),
    pg_temp.try($$ select public.app_send_order_message('d3000000-0000-4000-8000-000000001303', gen_random_uuid(), 'x', true) $$),
    pg_temp.try($$ select public.app_reply_to_order_message('d3000000-0000-4000-8000-000000001303', gen_random_uuid(), 'x',
      'd8000000-0000-4000-8000-000000001301', null) $$),
    pg_temp.try($$ select public.app_toggle_order_message_reaction('d3000000-0000-4000-8000-000000001303',
      'd8000000-0000-4000-8000-000000001301', 'like') $$),
    pg_temp.try($$ select public.app_prepare_ticket_attachment(gen_random_uuid(), null,
      'd3000000-0000-4000-8000-000000001303', 'd8000000-0000-4000-8000-000000001301') $$),
    pg_temp.try($$ select public.app_get_ticket_attachment_download('d9000000-0000-4000-8000-000000001301') $$)),
  'P0002 P0002 P0002 P0002 P0002 P0002 42501',
  'WF admin cannot reach the B linked Ticket through its Order'
);
select pg_temp.act('1302', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001303') $$), 'ok',
  'B admin reads the B linked Ticket through its Order');

-- -----------------------------------------------------------------------------
-- Owners, dual owner, archived membership, selectors
-- -----------------------------------------------------------------------------

select pg_temp.act('1303', '');
select is(pg_temp.visible(), '1301 | 1301', 'WF owner reads only WF Orders');
select is(pg_temp.try($$ select public.app_archive_order('d3000000-0000-4000-8000-000000001302') $$), 'P0002',
  'WF owner cannot archive the B Order');
select pg_temp.act('1303', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.try($$ select public.app_update_order('d3000000-0000-4000-8000-000000001302', '{"title":"x"}') $$), '42501',
  'WF owner with the B selector cannot update the B Order');
select pg_temp.act('1304', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.try($$ select public.app_assign_order('d3000000-0000-4000-8000-000000001301',
    '20000000-0000-0000-0000-000000001301') $$), 'P0002', 'B owner cannot assign the WF Order');
select is(pg_temp.try($$ select public.app_assign_task('d4000000-0000-4000-8000-000000001301', null) $$), 'P0002',
  'B owner cannot assign the WF task');
select pg_temp.act('1304', '');
select is(pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001301') $$), '42501',
  'B owner (archived in WF) with no selector cannot read the WF Project');

select pg_temp.act('1305', '');
select is(pg_temp.visible(), '1301 | 1301', 'dual owner with the WF selector reads WF Orders only');
select is(pg_temp.try($$ select public.app_change_order_status('d3000000-0000-4000-8000-000000001302', 'complete') $$), 'P0002',
  'dual owner with the WF selector cannot change the B Order');
select pg_temp.act('1305', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.visible(), '1302 1303 | 1302', 'dual owner with the B selector reads B Orders only');
select is(pg_temp.try($$ select public.app_change_task_status('d4000000-0000-4000-8000-000000001301', 'blocked') $$), 'P0002',
  'dual owner with the B selector cannot change the WF task');

select pg_temp.act('1306', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001302') $$), '42501',
  'archived B admin cannot read the B Project');
select is(pg_temp.try($$ select public.app_update_order('d3000000-0000-4000-8000-000000001302', '{"title":"x"}') $$), '42501',
  'archived B admin cannot update the B Order');

select pg_temp.act('1305', '{"x-wf-tenant":"not-a-uuid"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001301') $$),
  '- | - 42501', 'malformed selector reads nothing');
select pg_temp.act('1305', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000013ff"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001301') $$),
  '- | - 42501', 'foreign selector reads nothing');

reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000001301';
set local role authenticated;
select pg_temp.act('1304', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.visible() || ' ' || pg_temp.try($$ select public.app_update_order('d3000000-0000-4000-8000-000000001302', '{"title":"x"}') $$),
  '- | - 42501', 'suspended Tenant owner reads and changes nothing');
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.tenants set status = 'active' where id = 'f0f0f0f0-0000-4000-8000-000000001301';
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Client portal Projects
-- -----------------------------------------------------------------------------

select pg_temp.act('1307', '');
select is(pg_temp.portal(), '1301', 'WF client lists only their WF Project');
select is((select count(*) from public.app_get_my_client_project('d3000000-0000-4000-8000-000000001302')), 0::bigint,
  'WF client gets no B Project detail');
select is(pg_temp.try($$ select public.app_get_order_conversation('d3000000-0000-4000-8000-000000001302') $$), 'P0002',
  'WF client cannot read the B Project conversation');
select is(pg_temp.try($$ select public.app_send_order_message('d3000000-0000-4000-8000-000000001301', gen_random_uuid(), 'hi', false) $$),
  'ok', 'WF client writes to their WF Project');
select pg_temp.act('1308', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.portal(), '1302 1303', 'B client lists only their B Projects');
select is((select count(*) from public.app_get_my_client_project('d3000000-0000-4000-8000-000000001301')), 0::bigint,
  'B client gets no WF Project detail');
select is(pg_temp.try($$ select public.app_get_ticket_attachment_download('d6000000-0000-4000-8000-000000001301') $$), 'P0002',
  'B client cannot download the WF Project attachment');
select is(pg_temp.try($$ select public.app_set_client_conversation_presence('project', 'd3000000-0000-4000-8000-000000001301', true) $$),
  'P0002', 'B client cannot mark presence on the WF Project');

-- -----------------------------------------------------------------------------
-- Creation: Company / Service of the current Tenant; replays stay in their Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1302', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select throws_ok($$ select public.app_create_order(gen_random_uuid(), 'd0000000-0000-4000-8000-000000001301',
    'd1000000-0000-4000-8000-000000001302', 'x', null, 'normal', null, null, null) $$,
  '23503', null, 'B admin cannot open an Order for a WF Client');
select throws_ok($$ select public.app_create_order(gen_random_uuid(), 'd0000000-0000-4000-8000-000000001302',
    'd1000000-0000-4000-8000-000000001301', 'x', null, 'normal', null, null, null) $$,
  '23503', null, 'B admin cannot reference a WF Service');
select is((select tenant_id from public.app_create_order(gen_random_uuid(), 'd0000000-0000-4000-8000-000000001302',
    'd1000000-0000-4000-8000-000000001302', 'x', null, 'normal', null, null, null)),
  'f0f0f0f0-0000-4000-8000-000000001301'::uuid, 'B admin opens a B Order in Tenant B');

select pg_temp.act('1305', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select lives_ok($$ select public.app_create_order('da000000-0000-4000-8000-000000001301', 'd0000000-0000-4000-8000-000000001302',
    'd1000000-0000-4000-8000-000000001302', 'r', null, 'normal', null, null, null) $$,
  'dual owner opens a B Order with a fixed request id');
select lives_ok($$ select public.app_create_task('da000000-0000-4000-8000-000000001302', 'd3000000-0000-4000-8000-000000001302',
    'r', null, null, null, 0) $$,
  'dual owner opens a B task with a fixed request id');
select pg_temp.act('1305', '');
select is(
  pg_temp.try($$ select public.app_create_order('da000000-0000-4000-8000-000000001301', 'd0000000-0000-4000-8000-000000001302',
    'd1000000-0000-4000-8000-000000001302', 'r', null, 'normal', null, null, null) $$)
  || ' ' || pg_temp.try($$ select public.app_create_task('da000000-0000-4000-8000-000000001302', 'd3000000-0000-4000-8000-000000001302',
    'r', null, null, null, 0) $$),
  'P0002 P0002', 'replays under the WF selector do not return the B Order or task');

select pg_temp.act('1301', '');
select is((select tenant_id from public.app_create_order(gen_random_uuid(), 'd0000000-0000-4000-8000-000000001301',
    'd1000000-0000-4000-8000-000000001301', 'x', null, 'normal', null, null, null)),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid, 'WF admin opens a WF Order in Wolf Forge');

-- -----------------------------------------------------------------------------
-- Forms: an intake Form can only be attached to a current-Tenant Order
-- -----------------------------------------------------------------------------

select pg_temp.act('1301', '');
create temporary table order_authz_form on commit drop as
select (public.app_create_form('db000000-0000-4000-8000-000000001301', jsonb_build_object(
  'form_type', 'intake', 'canonical_key', 'order-authz-intake', 'definition', jsonb_build_object(
    'name', 'Order Authz Intake', 'title', 'Intake', 'visibility', 'assigned',
    'type_config', jsonb_build_object('completion_status', 'submitted'),
    'fields', jsonb_build_array(jsonb_build_object(
      'stable_field_key', 'db000000-0000-4000-8000-000000001399',
      'sort_order', 0, 'field_type', 'textarea', 'label', 'Brief', 'required', true)),
    'rules', '[]'::jsonb,
    'service_links', jsonb_build_array(jsonb_build_object(
      'service_id', 'd1000000-0000-4000-8000-000000001301', 'role', 'intake_assignment', 'sort_order', 0))
  )))).id as form_id;
select public.app_publish_form('db000000-0000-4000-8000-000000001302', (select form_id from order_authz_form));
grant select on order_authz_form to authenticated;

select pg_temp.act('1302', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001301"}');
select is(pg_temp.try($$ select public.app_assign_form(gen_random_uuid(), (select form_id from order_authz_form),
    jsonb_build_object('order_id', 'd3000000-0000-4000-8000-000000001301', 'client_profile_id', '20000000-0000-0000-0000-000000001307')) $$), 'P0002',
  'B admin cannot attach a Form to the WF Order');
select pg_temp.act('1301', '');
select is(pg_temp.try($$ select public.app_assign_form(gen_random_uuid(), (select form_id from order_authz_form),
    jsonb_build_object('order_id', 'd3000000-0000-4000-8000-000000001301', 'client_profile_id', '20000000-0000-0000-0000-000000001307')) $$), 'ok',
  'WF admin attaches the Form to the WF Order');

select * from finish();

rollback;
