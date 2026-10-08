begin;

select plan(59);

-- WL-2.26 (KI-135 / KI-115 / KI-111): a client notification belongs to its
-- subject's Tenant and reaches only active client memberships of that Tenant
-- whose Company is the notification Company, with the permission in that
-- Tenant. WF = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = f0f0f0f0-0000-4000-8000-000000002601.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 2601 global client of the WF Client + B client of the B Client (dual).
-- 2602 B-only client (global default client role, no global company).
-- 2603 global WF admin + B client of the B Client.
-- 2604 global client of the WF Client + B internal admin.
-- 2605 archived B client. 2606 B client with a B-only invoices.view = false.
-- 2607 B internal admin only. 2608 WF admin.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'client-notif-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['2601', '2602', '2603', '2604', '2605', '2606', '2607', '2608']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002601', 'client-notif-tenant-b', 'Client Notif Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e6000000-0000-4000-8000-000000002601', private.wolf_forge_tenant_id(), 'CNOTIF WF Client', 'client'),
  ('e6000000-0000-4000-8000-000000002602', 'f0f0f0f0-0000-4000-8000-000000002601', 'CNOTIF B Client', 'client');

insert into public.services (id, tenant_id, name)
values
  ('e6100000-0000-4000-8000-000000002601', private.wolf_forge_tenant_id(), 'CNOTIF WF Service'),
  ('e6100000-0000-4000-8000-000000002602', 'f0f0f0f0-0000-4000-8000-000000002601', 'CNOTIF B Service');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002601', 'client', 'e6000000-0000-4000-8000-000000002601'),
  ('20000000-0000-4000-8000-000000002603', 'admin', null),
  ('20000000-0000-4000-8000-000000002604', 'client', 'e6000000-0000-4000-8000-000000002601'),
  ('20000000-0000-4000-8000-000000002608', 'admin', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000002601', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-4000-8000-000000002601', 'client', 'client', 'e6000000-0000-4000-8000-000000002602', null::timestamptz),
  ('20000000-0000-4000-8000-000000002602', 'client', 'client', 'e6000000-0000-4000-8000-000000002602', null),
  ('20000000-0000-4000-8000-000000002603', 'client', 'client', 'e6000000-0000-4000-8000-000000002602', null),
  ('20000000-0000-4000-8000-000000002604', 'admin', 'internal', null, null),
  ('20000000-0000-4000-8000-000000002605', 'client', 'client', 'e6000000-0000-4000-8000-000000002602', now()),
  ('20000000-0000-4000-8000-000000002606', 'client', 'client', 'e6000000-0000-4000-8000-000000002602', null),
  ('20000000-0000-4000-8000-000000002607', 'admin', 'internal', null, null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
values ('f0f0f0f0-0000-4000-8000-000000002601', '20000000-0000-4000-8000-000000002606', 'invoices.view', false);

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub',
    coalesce('20000000-0000-4000-8000-00000000' || p_actor, ''), true);
  select set_config('request.headers', case p_selector
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002601"}'
    else ''
    end, true);
$$;

-- Recipients of one event, as sorted fixture suffixes ('2601,2602').
create function pg_temp.recipients(p_event_key text)
returns text
language sql
as $$
  select coalesce(string_agg(right(recipient_profile_id::text, 4), ',' order by recipient_profile_id), '')
  from public.notifications
  where event_key = p_event_key
    and recipient_profile_id::text like '20000000-0000-4000-8000-0000000026%';
$$;

create function pg_temp.stamp(p_event_key text)
returns text
language sql
as $$
  select coalesce(string_agg(distinct coalesce(tenant_id::text, 'null'), ','), '')
  from public.notifications
  where event_key = p_event_key;
$$;

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

create function pg_temp.feed()
returns text
language sql
as $$
  select coalesce(string_agg(concat_ws(' ', listed.audience, listed.title, listed.body, listed.event_key,
    listed.entity_id, listed.href), E'\n'), '')
  from public.app_list_my_notifications(100) as listed;
$$;

create function pg_temp.unread()
returns bigint
language sql
as $$ select count(*) from public.app_list_my_notifications(100) where read_at is null $$;

create function pg_temp.snap(p_profile uuid, p_tenant uuid)
returns text
language sql
as $$
  select md5(coalesce(string_agg(notification::text, '|' order by notification.id), ''))
  from public.notifications as notification
  where notification.recipient_profile_id = p_profile
    and notification.tenant_id = p_tenant;
$$;

create temp table fixture_snaps (k text primary key, v text);
grant all on fixture_snaps to authenticated;
grant execute on function pg_temp.act(text, text), pg_temp.feed(), pg_temp.unread(), pg_temp.try(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Emitters are not API surface
-- -----------------------------------------------------------------------------

select ok(not exists (
    select 1
    from unnest(array[
      'private.emit_company_client_notification_for_permission(uuid, text, text, text, text, text, text, text, text, uuid, uuid, timestamp with time zone)',
      'private.emit_client_profile_notification_for_permission(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid, timestamp with time zone)',
      'private.emit_client_conversation_notification(uuid, text, text, uuid, text, text, text, text, uuid, timestamp with time zone)'
    ]) as fn
    cross join unnest(array['anon', 'authenticated', 'service_role']) as api_role
    where has_function_privilege(api_role, fn, 'execute')),
  'the three client emitters are not executable by API roles');

-- -----------------------------------------------------------------------------
-- Invoice issued (trusted no-user writer): the Invoice decides the Tenant
-- -----------------------------------------------------------------------------

insert into public.invoices (id, tenant_id, company_id, status, subtotal_cents, total_cents,
  created_by_profile_id, updated_by_profile_id)
values
  ('e6900000-0000-4000-8000-000000002601', private.wolf_forge_tenant_id(),
   'e6000000-0000-4000-8000-000000002601', 'draft', 100, 100,
   '20000000-0000-4000-8000-000000002608', '20000000-0000-4000-8000-000000002608'),
  ('e6900000-0000-4000-8000-000000002602', 'f0f0f0f0-0000-4000-8000-000000002601',
   'e6000000-0000-4000-8000-000000002602', 'draft', 200, 200,
   '20000000-0000-4000-8000-000000002607', '20000000-0000-4000-8000-000000002607');
update public.invoices set status = 'unpaid', invoice_number = 992600 + right(id::text, 1)::int, issued_at = now()
where id in ('e6900000-0000-4000-8000-000000002601', 'e6900000-0000-4000-8000-000000002602');

select is(pg_temp.recipients('client-invoice-issued:e6900000-0000-4000-8000-000000002602'), '2601,2602,2603',
  'a Tenant B Invoice reaches exactly the active B clients of the B Client with invoices.view in B');
select is(pg_temp.stamp('client-invoice-issued:e6900000-0000-4000-8000-000000002602'), 'f0f0f0f0-0000-4000-8000-000000002601',
  'the Tenant B Invoice rows are stamped with Tenant B');
select is(pg_temp.recipients('client-invoice-issued:e6900000-0000-4000-8000-000000002601'), '2601,2604',
  'a Wolf Forge Invoice reaches exactly the Wolf Forge clients of the WF Client');
select is(pg_temp.stamp('client-invoice-issued:e6900000-0000-4000-8000-000000002601'), 'f0f0f0f0-0000-4000-8000-000000000001',
  'the Wolf Forge Invoice rows are stamped with Wolf Forge');
select ok(position('2602' in pg_temp.recipients('client-invoice-issued:e6900000-0000-4000-8000-000000002602')) > 0,
  'a B-only client (no global company) receives its Tenant B notification');
select ok(position('2604' in pg_temp.recipients('client-invoice-issued:e6900000-0000-4000-8000-000000002602')) = 0,
  'global client + Tenant B internal receives no Tenant B client notification');
select ok(position('2605' in pg_temp.recipients('client-invoice-issued:e6900000-0000-4000-8000-000000002602')) = 0,
  'an archived Tenant B client membership receives nothing');
select ok(position('2606' in pg_temp.recipients('client-invoice-issued:e6900000-0000-4000-8000-000000002602')) = 0,
  'a Tenant B invoices.view = false override suppresses the Tenant B Invoice');
select is(
  (select count(*) from public.notifications as notification
   where notification.recipient_profile_id::text like '20000000-0000-4000-8000-0000000026%'
     and notification.audience = 'client'
     and not exists (
       select 1 from public.tenant_memberships as membership
       where membership.profile_id = notification.recipient_profile_id
         and membership.tenant_id = notification.tenant_id
         and membership.company_id = notification.company_id
         and membership.account_class = 'client'
         and membership.archived_at is null)),
  0::bigint, 'no client row reaches a recipient without an active client membership of its Company in its Tenant');

-- -----------------------------------------------------------------------------
-- Wallet credit: client half, and the copy classifies the actor in the Tenant
-- -----------------------------------------------------------------------------

insert into public.company_wallet_transactions (id, company_id, request_id, actor_profile_id,
  amount_cents, balance_after_cents, source)
values
  ('e6a00000-0000-4000-8000-000000002601', 'e6000000-0000-4000-8000-000000002602',
   'e6a10000-0000-4000-8000-000000002601', '20000000-0000-4000-8000-000000002607', 500, 500, 'manual_credit'),
  ('e6a00000-0000-4000-8000-000000002602', 'e6000000-0000-4000-8000-000000002602',
   'e6a10000-0000-4000-8000-000000002602', '20000000-0000-4000-8000-000000002603', 300, 800, 'manual_credit');

select is(pg_temp.recipients('wallet-credit-client:e6a00000-0000-4000-8000-000000002601'), '2601,2602,2603',
  'a Tenant B wallet credit reaches the B clients of the B Client');
select is(pg_temp.stamp('wallet-credit-client:e6a00000-0000-4000-8000-000000002601'), 'f0f0f0f0-0000-4000-8000-000000002601',
  'the Tenant B wallet client rows are stamped with Tenant B');
select is((select distinct body from public.notifications where event_key = 'wallet-credit-client:e6a00000-0000-4000-8000-000000002601'),
  'Wolf Forge added funds to your account.', 'a Tenant B staff credit reads as a staff credit');
select is((select distinct body from public.notifications where event_key = 'wallet-credit-client:e6a00000-0000-4000-8000-000000002602'),
  'Your wallet recharge was recorded.', 'a global admin acting as a Tenant B client reads as a client recharge');
select is((select distinct title from public.notifications where event_key = 'wallet-credit-internal:e6a00000-0000-4000-8000-000000002602'),
  'Client recharged wallet', 'the internal copy classifies the actor by its Tenant B membership, not its global role');

-- -----------------------------------------------------------------------------
-- Conversations: Ticket, Project, order-linked Ticket
-- -----------------------------------------------------------------------------

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('e6200000-0000-4000-8000-000000002601', private.wolf_forge_tenant_id(),
   'e6000000-0000-4000-8000-000000002601', 'e6100000-0000-4000-8000-000000002601', 'CNOTIF WF Project'),
  ('e6200000-0000-4000-8000-000000002602', 'f0f0f0f0-0000-4000-8000-000000002601',
   'e6000000-0000-4000-8000-000000002602', 'e6100000-0000-4000-8000-000000002602', 'CNOTIF B Project');

insert into public.tickets (id, tenant_id, company_id, subject, order_id)
values
  ('e6300000-0000-4000-8000-000000002602', 'f0f0f0f0-0000-4000-8000-000000002601',
   'e6000000-0000-4000-8000-000000002602', 'CNOTIF B Ticket', null),
  ('e6300000-0000-4000-8000-000000002603', 'f0f0f0f0-0000-4000-8000-000000002601',
   'e6000000-0000-4000-8000-000000002602', 'CNOTIF B Ticket by global client staff', null),
  ('e6300000-0000-4000-8000-000000002604', 'f0f0f0f0-0000-4000-8000-000000002601',
   'e6000000-0000-4000-8000-000000002602', 'CNOTIF B order Ticket', 'e6200000-0000-4000-8000-000000002602');

-- A pre-WL-2.26 conversation row (NULL Tenant) is re-stamped by the next reply.
insert into public.notifications (recipient_profile_id, company_id, audience, category, variant, title, body, href,
  entity_type, entity_id, event_key, message_count, read_at)
values ('20000000-0000-4000-8000-000000002602', 'e6000000-0000-4000-8000-000000002602', 'client', 'ticket', 'info',
  'New message from Wolf Forge', 'CNOTIF B Ticket', '/account/messages/e6300000-0000-4000-8000-000000002602',
  'ticket', 'e6300000-0000-4000-8000-000000002602',
  'client-conversation:ticket:e6300000-0000-4000-8000-000000002602', 1, now());

insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body)
values
  ('e6400000-0000-4000-8000-000000002601', 'e6300000-0000-4000-8000-000000002602',
   '20000000-0000-4000-8000-000000002607', 'internal', 'reply', 'client', 'B staff reply'),
  ('e6400000-0000-4000-8000-000000002602', 'e6300000-0000-4000-8000-000000002603',
   '20000000-0000-4000-8000-000000002604', 'internal', 'reply', 'client', 'B staff reply, global client profile'),
  ('e6400000-0000-4000-8000-000000002603', 'e6300000-0000-4000-8000-000000002602',
   '20000000-0000-4000-8000-000000002603', 'client', 'reply', 'client', 'B client reply, global admin profile'),
  ('e6400000-0000-4000-8000-000000002604', 'e6300000-0000-4000-8000-000000002604',
   '20000000-0000-4000-8000-000000002607', 'internal', 'reply', 'client', 'B staff reply on an order Ticket');

select is(pg_temp.recipients('client-conversation:ticket:e6300000-0000-4000-8000-000000002602'), '2601,2602,2603,2606',
  'a Tenant B Ticket reply reaches the B clients of the B Client with tickets.view in B');
select is(pg_temp.stamp('client-conversation:ticket:e6300000-0000-4000-8000-000000002602'), 'f0f0f0f0-0000-4000-8000-000000002601',
  'the Tenant B Ticket conversation rows are stamped with Tenant B, a legacy NULL row included');
select is((select max(message_count) from public.notifications where event_key = 'client-conversation:ticket:e6300000-0000-4000-8000-000000002602'),
  1, 'a client reply by a global admin profile is not announced to the clients as Wolf Forge');
select is(pg_temp.recipients('client-conversation:ticket:e6300000-0000-4000-8000-000000002603'), '2601,2602,2603,2606',
  'a Tenant B staff reply by a global client profile still notifies the clients');
select is(pg_temp.stamp('client-conversation:project:e6200000-0000-4000-8000-000000002602'), 'f0f0f0f0-0000-4000-8000-000000002601',
  'an order-linked Tenant B Ticket reply is a Project conversation stamped with Tenant B');

insert into public.project_messages (id, order_id, author_profile_id, author_type, body)
values
  ('e6600000-0000-4000-8000-000000002601', 'e6200000-0000-4000-8000-000000002601',
   '20000000-0000-4000-8000-000000002608', 'internal', 'WF staff project reply'),
  ('e6600000-0000-4000-8000-000000002602', 'e6200000-0000-4000-8000-000000002602',
   '20000000-0000-4000-8000-000000002604', 'internal', 'B staff project reply, global client profile'),
  ('e6600000-0000-4000-8000-000000002603', 'e6200000-0000-4000-8000-000000002601',
   '20000000-0000-4000-8000-000000002601', 'client', 'WF client project reply');

select is(pg_temp.recipients('client-conversation:project:e6200000-0000-4000-8000-000000002601'), '2601,2604',
  'a Wolf Forge Project reply reaches the Wolf Forge clients of the WF Client');
select is(pg_temp.stamp('client-conversation:project:e6200000-0000-4000-8000-000000002601'), 'f0f0f0f0-0000-4000-8000-000000000001',
  'the Wolf Forge Project conversation rows are stamped with Wolf Forge');
select is((select max(message_count) from public.notifications where event_key = 'client-conversation:project:e6200000-0000-4000-8000-000000002601'),
  1, 'a client Project message never notifies the clients');
select is(pg_temp.recipients('client-conversation:project:e6200000-0000-4000-8000-000000002602'), '2601,2602,2603,2606',
  'a Tenant B Project reply by a global client staff profile reaches the B clients');
select is((select max(message_count) from public.notifications where event_key = 'client-conversation:project:e6200000-0000-4000-8000-000000002602'),
  2, 'the order-linked Ticket reply and the Project reply share one Tenant B conversation row');

-- -----------------------------------------------------------------------------
-- Form assigned and Report send (direct emitter entry points)
-- -----------------------------------------------------------------------------

select private.emit_client_profile_notification_for_permission(
  '20000000-0000-4000-8000-000000002601', 'e6000000-0000-4000-8000-000000002602', 'forms.view',
  'wl226-form-b', 'form', 'info', 'CNOTIF B Form', 'B form body', '/account/forms',
  'company', 'e6000000-0000-4000-8000-000000002602', null, now());
select private.emit_client_profile_notification_for_permission(
  '20000000-0000-4000-8000-000000002604', 'e6000000-0000-4000-8000-000000002602', 'forms.view',
  'wl226-form-b-staff', 'form', 'info', 'CNOTIF B Form staff', 'B form body', '/account/forms',
  'company', 'e6000000-0000-4000-8000-000000002602', null, now());
select private.emit_client_profile_notification_for_permission(
  '20000000-0000-4000-8000-000000002601', 'e6000000-0000-4000-8000-000000002601', 'forms.view',
  'wl226-form-mixed', 'form', 'info', 'CNOTIF mixed Form', 'mixed body', '/account/forms',
  'company', 'e6000000-0000-4000-8000-000000002602', null, now());

select is(pg_temp.recipients('wl226-form-b'), '2601', 'a Tenant B Form assignment reaches its B client');
select is(pg_temp.stamp('wl226-form-b'), 'f0f0f0f0-0000-4000-8000-000000002601', 'the Form assignment row is stamped with Tenant B');
select is(pg_temp.recipients('wl226-form-b-staff'), '',
  'a Form assignment to a profile without a B client relationship notifies nobody');
select is(pg_temp.recipients('wl226-form-mixed'), '',
  'a Company outside the subject''s Tenant notifies nobody');

select private.emit_company_client_notification(
  'e6000000-0000-4000-8000-000000002602', 'wl226-report-b', 'report', 'info', 'CNOTIF B Report',
  'B report body', '/account/reports', 'company', 'e6000000-0000-4000-8000-000000002602', null, now());
select is(pg_temp.stamp('wl226-report-b'), 'f0f0f0f0-0000-4000-8000-000000002601',
  'a Tenant B Report send is stamped with Tenant B');
select ok(pg_temp.recipients('wl226-report-b') <> '' and position('2604' in pg_temp.recipients('wl226-report-b')) = 0,
  'a Tenant B Report send reaches B clients only');

select private.emit_company_client_notification(
  'e6000000-0000-4000-8000-000000002602', 'wl226-report-missing', 'report', 'info', 'CNOTIF missing',
  'missing body', '/account/reports', 'company', 'e6000000-0000-4000-8000-0000000026ff', null, now());
select is(pg_temp.recipients('wl226-report-missing'), '',
  'an unresolvable subject notifies nobody (never defaulted to Wolf Forge)');

update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000002601';
select private.emit_company_client_notification(
  'e6000000-0000-4000-8000-000000002602', 'wl226-report-suspended', 'report', 'info', 'CNOTIF suspended',
  'suspended body', '/account/reports', 'company', 'e6000000-0000-4000-8000-000000002602', null, now());
select is(pg_temp.recipients('wl226-report-suspended'), '', 'a suspended Tenant notifies nobody');
update public.tenants set status = 'active' where id = 'f0f0f0f0-0000-4000-8000-000000002601';

-- -----------------------------------------------------------------------------
-- Legacy client rows: the migration backfill, replayed on synthetic NULL rows.
-- Keep in sync with the UPDATE in 20261009010000_tenant_client_notification_isolation.sql.
-- -----------------------------------------------------------------------------

insert into public.notifications (id, recipient_profile_id, company_id, audience, category, variant, title, body, href,
  entity_type, entity_id, event_key)
values
  ('e6b00000-0000-4000-8000-000000002601', '20000000-0000-4000-8000-000000002601', 'e6000000-0000-4000-8000-000000002602',
   'client', 'project', 'info', 'CLEGACY B', 'CLEGACY B body', '/account', 'project',
   'e6200000-0000-4000-8000-000000002602', 'wl226-legacy-b'),
  ('e6b00000-0000-4000-8000-000000002602', '20000000-0000-4000-8000-000000002601', 'e6000000-0000-4000-8000-000000002602',
   'client', 'payment', 'info', 'CLEGACY ORPHAN', 'CLEGACY ORPHAN body', '/account', 'invoice',
   'e6900000-0000-4000-8000-0000000026ff', 'wl226-legacy-orphan'),
  ('e6b00000-0000-4000-8000-000000002603', '20000000-0000-4000-8000-000000002603', 'e6000000-0000-4000-8000-000000002602',
   'client', 'payment', 'info', 'CLEGACY STAFF ORPHAN', 'CLEGACY STAFF ORPHAN body', '/account', 'invoice',
   'e6900000-0000-4000-8000-0000000026fe', 'wl226-legacy-staff-orphan');
update public.notifications as notification
set tenant_id = resolved.tenant_id
from (
  select candidate.id,
    private.activity_event_parent_tenant_id(
      case candidate.entity_type when 'project' then 'order' else candidate.entity_type end,
      candidate.entity_id
    ) as tenant_id
  from public.notifications as candidate
  where candidate.audience = 'client'
    and candidate.tenant_id is null
) as resolved
where notification.id = resolved.id
  and resolved.tenant_id is not null;

select is((select tenant_id from public.notifications where id = 'e6b00000-0000-4000-8000-000000002601'),
  'f0f0f0f0-0000-4000-8000-000000002601'::uuid, 'the backfill stamps a legacy client row from its Project subject');
select ok((select tenant_id is null from public.notifications where id = 'e6b00000-0000-4000-8000-000000002602'),
  'the backfill leaves an orphan client row NULL (never Wolf Forge)');

-- -----------------------------------------------------------------------------
-- Readers: dual-Tenant client streams, foreign ids, mark-all
-- -----------------------------------------------------------------------------

insert into fixture_snaps values
  ('b-row', (select id::text from public.notifications
    where recipient_profile_id = '20000000-0000-4000-8000-000000002601'
      and event_key = 'client-invoice-issued:e6900000-0000-4000-8000-000000002602')),
  ('wf-row', (select id::text from public.notifications
    where recipient_profile_id = '20000000-0000-4000-8000-000000002601'
      and event_key = 'client-invoice-issued:e6900000-0000-4000-8000-000000002601')),
  ('b-2601', pg_temp.snap('20000000-0000-4000-8000-000000002601', 'f0f0f0f0-0000-4000-8000-000000002601'));

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2601', 'wf');
select ok(position('CNOTIF WF Project' in pg_temp.feed()) > 0
  and position('e6900000-0000-4000-8000-000000002601' in pg_temp.feed()) > 0,
  'the dual client lists its Wolf Forge client notifications in Wolf Forge');
select ok(position('CNOTIF B' in pg_temp.feed()) = 0
  and position('e6900000-0000-4000-8000-000000002602' in pg_temp.feed()) = 0
  and position('CLEGACY B' in pg_temp.feed()) = 0,
  'the dual client lists no Tenant B client notification in Wolf Forge');
select is(public.app_mark_notification_read((select v::uuid from fixture_snaps where k = 'b-row')), false,
  'a foreign Tenant B id cannot be marked from Wolf Forge');
select is(public.app_mark_notification_read('e6b00000-0000-4000-8000-0000000026ff'), false,
  'a missing id answers exactly like the foreign id');
select ok(public.app_mark_all_notifications_read() >= 2, 'Wolf Forge mark-all marks the Wolf Forge rows');
reset role;
select is(pg_temp.snap('20000000-0000-4000-8000-000000002601', 'f0f0f0f0-0000-4000-8000-000000002601'),
  (select v from fixture_snaps where k = 'b-2601'),
  'Wolf Forge mark-one and mark-all left every Tenant B row byte-identical');
select ok((select read_at is not null from public.notifications where id = 'e6b00000-0000-4000-8000-000000002602'),
  'KI-136: the NULL orphan client row was listed and marked from Wolf Forge');

set local role authenticated;
select pg_temp.act('2601', 'b');
select ok(position('CNOTIF B Project' in pg_temp.feed()) > 0
  and position('e6900000-0000-4000-8000-000000002602' in pg_temp.feed()) > 0
  and position('CLEGACY B' in pg_temp.feed()) > 0,
  'the dual client lists its Tenant B client notifications in Tenant B');
select ok(position('CNOTIF WF' in pg_temp.feed()) = 0
  and position('e6900000-0000-4000-8000-000000002601' in pg_temp.feed()) = 0,
  'the dual client lists no Wolf Forge client notification in Tenant B');
select ok(position('CLEGACY ORPHAN' in pg_temp.feed()) > 0,
  'KI-136: the NULL orphan client row is also listed in Tenant B (documented residual)');
select ok(pg_temp.unread() > 0, 'the Tenant B badge is untouched by the Wolf Forge mark-all');
select is(public.app_mark_notification_read((select v::uuid from fixture_snaps where k = 'wf-row')), false,
  'a foreign Wolf Forge id cannot be marked from Tenant B');
select ok(public.app_mark_all_notifications_read() >= 1, 'Tenant B mark-all marks the Tenant B rows');
select is(pg_temp.unread(), 0::bigint, 'the Tenant B badge clears');

select pg_temp.act('2602', 'b');
select ok(position('e6900000-0000-4000-8000-000000002602' in pg_temp.feed()) > 0,
  'the B-only client lists its Tenant B notifications');
select pg_temp.act('2602', 'wf');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501',
  'the B-only client has no Wolf Forge notification access (missing membership)');

select pg_temp.act('2603', 'b');
select ok(position('client-invoice-issued:e6900000-0000-4000-8000-000000002602' in pg_temp.feed()) > 0,
  'global internal + Tenant B client lists its Tenant B client notifications');
select pg_temp.act('2603', 'wf');
select is((select count(*) from public.app_list_my_notifications(100) where audience = 'client'), 0::bigint,
  'the same person as Wolf Forge staff lists no client notification, its NULL client orphan included');
select pg_temp.act('2603', 'b');
select ok(position('CLEGACY STAFF ORPHAN' in pg_temp.feed()) > 0,
  'KI-136: that NULL client orphan stays visible to its recipient in a client session');

select pg_temp.act('2604', 'b');
select is((select count(*) from public.app_list_my_notifications(100) where audience = 'client'), 0::bigint,
  'global client + Tenant B internal lists no client notification in Tenant B');
select pg_temp.act('2604', 'wf');
select ok(position('CNOTIF WF Project' in pg_temp.feed()) > 0,
  'the same person keeps its Wolf Forge client experience');

select pg_temp.act('2605', 'b');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501',
  'an archived Tenant B client membership has no Tenant B notification access');
select is(pg_temp.try('select public.app_mark_all_notifications_read()'), '42501',
  'an archived Tenant B client membership cannot mark-all');
reset role;

select is(
  (select count(*) from public.notifications
   where recipient_profile_id = '20000000-0000-4000-8000-000000002601'
     and tenant_id = private.wolf_forge_tenant_id() and read_at is null),
  0::bigint, 'every Wolf Forge row of the dual client is read');

select * from finish();

rollback;
