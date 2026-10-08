begin;

select plan(63);

-- WL-2.25 (KI-115 D5 / KI-111): a non-Team internal notification belongs to
-- its subject's Tenant and reaches only active internal members of that Tenant
-- with the permission in that Tenant. WF = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = f0f0f0f0-0000-4000-8000-000000002501.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 2501 WF admin. 2502 B admin only. 2503 admin in WF AND B (dual).
-- 2504 global client of the WF Client + B internal admin.
-- 2505 global WF admin + B client of the B Client.
-- 2506 WF admin + archived B admin. 2507 WF admin + B admin with a B-only
-- tickets.view = false override.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'internal-notif-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['2501', '2502', '2503', '2504', '2505', '2506', '2507']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000002501', 'internal-notif-tenant-b', 'Internal Notif Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('e5000000-0000-4000-8000-000000002501', private.wolf_forge_tenant_id(), 'NOTIF WF Client', 'client'),
  ('e5000000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501', 'NOTIF B Client', 'client');

insert into public.services (id, tenant_id, name)
values
  ('e5100000-0000-4000-8000-000000002501', private.wolf_forge_tenant_id(), 'NOTIF WF Service'),
  ('e5100000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501', 'NOTIF B Service');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000002501', 'admin', null),
  ('20000000-0000-4000-8000-000000002503', 'admin', null),
  ('20000000-0000-4000-8000-000000002504', 'client', 'e5000000-0000-4000-8000-000000002501'),
  ('20000000-0000-4000-8000-000000002505', 'admin', null),
  ('20000000-0000-4000-8000-000000002506', 'admin', null),
  ('20000000-0000-4000-8000-000000002507', 'admin', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000002501', fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-4000-8000-000000002502', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-4000-8000-000000002503', 'admin', 'internal', null, null),
  ('20000000-0000-4000-8000-000000002504', 'admin', 'internal', null, null),
  ('20000000-0000-4000-8000-000000002505', 'client', 'client', 'e5000000-0000-4000-8000-000000002502', null),
  ('20000000-0000-4000-8000-000000002506', 'admin', 'internal', null, now()),
  ('20000000-0000-4000-8000-000000002507', 'admin', 'internal', null, null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
values ('f0f0f0f0-0000-4000-8000-000000002501', '20000000-0000-4000-8000-000000002507', 'tickets.view', false);

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub',
    coalesce('20000000-0000-4000-8000-00000000' || p_actor, ''), true);
  select set_config('request.headers', case p_selector
    when 'wf' then ''
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000002501"}'
    when 'unknown' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000025ff"}'
    when 'malformed' then '{"x-wf-tenant":"not-a-tenant"}'
    else ''
    end, true);
$$;

-- Recipients of one event, as sorted fixture suffixes ('2502,2503').
create function pg_temp.recipients(p_event_key text)
returns text
language sql
as $$
  select coalesce(string_agg(right(recipient_profile_id::text, 4), ',' order by recipient_profile_id), '')
  from public.notifications
  where event_key = p_event_key
    and recipient_profile_id::text like '20000000-0000-4000-8000-0000000025%';
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

-- Distinct Tenants stamped on one event's rows.
create function pg_temp.stamp(p_event_key text)
returns text
language sql
as $$
  select coalesce(string_agg(distinct coalesce(tenant_id::text, 'null'), ','), '')
  from public.notifications
  where event_key = p_event_key;
$$;

-- Everything the caller's notification list exposes, as one searchable text.
create function pg_temp.feed()
returns text
language sql
as $$
  select coalesce(string_agg(concat_ws(' ', listed.title, listed.body, listed.event_key,
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
-- Subject Tenant resolution
-- -----------------------------------------------------------------------------

insert into public.coupons (id, tenant_id, code, discount_type, recurring_duration,
  single_use_per_customer, new_customers_only, is_active)
values
  ('e5500000-0000-4000-8000-000000002501', private.wolf_forge_tenant_id(), 'NOTIFWF25', 'fixed', 'forever', false, false, true),
  ('e5500000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501', 'NOTIFB25', 'fixed', 'forever', false, false, true);

insert into public.client_contacts (id, tenant_id, company_id, name, is_primary)
values ('e5700000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501',
  'e5000000-0000-4000-8000-000000002502', 'NOTIF B Contact', true);

insert into public.service_interests (id, tenant_id, company_id, service_id)
values ('e5800000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501',
  'e5000000-0000-4000-8000-000000002502', 'e5100000-0000-4000-8000-000000002502');

insert into public.invoices (id, tenant_id, company_id, status, subtotal_cents, total_cents,
  created_by_profile_id, updated_by_profile_id)
values ('e5900000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501',
  'e5000000-0000-4000-8000-000000002502', 'draft', 100, 100,
  '20000000-0000-4000-8000-000000002502', '20000000-0000-4000-8000-000000002502');

select is(
  (select array_agg(private.activity_event_parent_tenant_id(fixture.entity_type, fixture.entity_id::uuid) order by fixture.entity_type)
   from (values
     ('client_contact', 'e5700000-0000-4000-8000-000000002502'),
     ('company', 'e5000000-0000-4000-8000-000000002502'),
     ('coupon', 'e5500000-0000-4000-8000-000000002502'),
     ('invoice', 'e5900000-0000-4000-8000-000000002502'),
     ('service_interest', 'e5800000-0000-4000-8000-000000002502')
   ) as fixture(entity_type, entity_id)),
  array_fill('f0f0f0f0-0000-4000-8000-000000002501'::uuid, array[5]),
  'contact, company, coupon, invoice and investment-intent subjects resolve to their own Tenant'
);
select is(private.activity_event_parent_tenant_id('coupon', 'e5500000-0000-4000-8000-000000002501'),
  private.wolf_forge_tenant_id(), 'a Wolf Forge subject resolves to Wolf Forge');
select ok(private.activity_event_parent_tenant_id('team_task', 'e5500000-0000-4000-8000-000000002502') is null
  and private.activity_event_parent_tenant_id('coupon', 'e5500000-0000-4000-8000-0000000025ff') is null
  and private.activity_event_parent_tenant_id(null, null) is null,
  'an unknown entity type or a missing subject resolves to no Tenant (never Wolf Forge)');
select ok(not has_function_privilege('anon', 'private.emit_internal_notification_for_permission(text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamp with time zone, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.emit_internal_notification_for_permission(text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamp with time zone, uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.emit_internal_notification_for_permission(text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamp with time zone, uuid)', 'execute'),
  'the internal emitter is not executable by API roles');

select is(pg_temp.recipients('coupon-created:e5500000-0000-4000-8000-000000002502'), '2502,2503,2504,2507',
  'a Tenant B Coupon reaches exactly the active Tenant B internal members');
select is(pg_temp.recipients('coupon-created:e5500000-0000-4000-8000-000000002501'), '2501,2503,2505,2506,2507',
  'a Wolf Forge Coupon reaches exactly the Wolf Forge internal members');
select is(pg_temp.recipients('client-created:e5700000-0000-4000-8000-000000002502'), '2502,2503,2504,2507',
  'a Tenant B Client contact notifies Tenant B only');
select is(pg_temp.stamp('coupon-created:e5500000-0000-4000-8000-000000002502'), 'f0f0f0f0-0000-4000-8000-000000002501',
  'Tenant B rows are stamped with Tenant B');
select is(pg_temp.stamp('coupon-created:e5500000-0000-4000-8000-000000002501'), 'f0f0f0f0-0000-4000-8000-000000000001',
  'Wolf Forge rows are stamped with Wolf Forge');

-- -----------------------------------------------------------------------------
-- Trusted no-user writer (service role / job): the record decides, not WF
-- -----------------------------------------------------------------------------

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('e5200000-0000-4000-8000-000000002501', private.wolf_forge_tenant_id(),
   'e5000000-0000-4000-8000-000000002501', 'e5100000-0000-4000-8000-000000002501', 'NOTIF WF Project'),
  ('e5200000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501',
   'e5000000-0000-4000-8000-000000002502', 'e5100000-0000-4000-8000-000000002502', 'NOTIF B Project');

select is(pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002502'), '2502,2503,2504,2507',
  'a Tenant B Project written by a trusted no-user path reaches Tenant B staff, not Wolf Forge staff');
select is(pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002501'), '2501,2503,2505,2506,2507',
  'a Wolf Forge Project reaches Wolf Forge staff, not Tenant B-only staff');
select is(
  (select count(*) from public.notifications as notification
   where notification.event_key like 'project-created:e520%'
     and not exists (
       select 1 from public.tenant_memberships as membership
       where membership.profile_id = notification.recipient_profile_id
         and membership.tenant_id = notification.tenant_id
         and membership.account_class = 'internal'
         and membership.archived_at is null)),
  0::bigint, 'no Project row reaches a recipient without an active internal membership in its Tenant');
select ok(position('2506' in pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002502')) = 0,
  'an archived Tenant B membership receives nothing from Tenant B');
select ok(position('2505' in pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002502')) = 0
  and position('2504' in pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002501')) = 0,
  'a client membership never receives internal notifications, whatever the global role');

-- -----------------------------------------------------------------------------
-- Signed-in Tenant B actor: global internal + B client does not gain access
-- -----------------------------------------------------------------------------

select pg_temp.act('2502', 'b');
insert into public.tickets (id, tenant_id, company_id, client_profile_id, subject, created_by_profile_id)
values ('e5300000-0000-4000-8000-000000002502', 'f0f0f0f0-0000-4000-8000-000000002501',
  'e5000000-0000-4000-8000-000000002502', '20000000-0000-4000-8000-000000002505',
  'NOTIF B Ticket', '20000000-0000-4000-8000-000000002502');
select pg_temp.act(null, null);

select is(pg_temp.recipients('ticket-created:e5300000-0000-4000-8000-000000002502'), '2503,2504',
  'a Tenant B Ticket by a B admin reaches B staff with tickets.view in B, minus the actor');
select ok(position('2505' in pg_temp.recipients('ticket-created:e5300000-0000-4000-8000-000000002502')) = 0,
  'global internal + Tenant B client receives no Tenant B internal Ticket notification');
select ok(position('2507' in pg_temp.recipients('ticket-created:e5300000-0000-4000-8000-000000002502')) = 0,
  'a Tenant B tickets.view = false override suppresses the Tenant B Ticket');

insert into public.tickets (id, tenant_id, company_id, subject)
values ('e5300000-0000-4000-8000-000000002501', private.wolf_forge_tenant_id(),
  'e5000000-0000-4000-8000-000000002501', 'NOTIF WF Ticket');
select ok(position('2507' in pg_temp.recipients('ticket-created:e5300000-0000-4000-8000-000000002501')) > 0,
  'the same person keeps Wolf Forge Ticket notifications (permission evaluated per Tenant)');

-- Ticket replies: "client reply" comes from the message, not the global role.
insert into public.ticket_messages (id, ticket_id, author_profile_id, author_type, message_kind, visibility, body)
values
  ('e5400000-0000-4000-8000-000000002501', 'e5300000-0000-4000-8000-000000002502',
   '20000000-0000-4000-8000-000000002505', 'client', 'reply', 'client', 'B client reply'),
  ('e5400000-0000-4000-8000-000000002502', 'e5300000-0000-4000-8000-000000002502',
   '20000000-0000-4000-8000-000000002504', 'internal', 'reply', 'client', 'B staff reply');

select is(pg_temp.recipients('client-ticket-reply:e5400000-0000-4000-8000-000000002501'), '2502,2503,2504',
  'a Tenant B client reply (global admin profile) notifies Tenant B staff');
select is(pg_temp.recipients('client-ticket-reply:e5400000-0000-4000-8000-000000002502'), '',
  'a Tenant B staff reply (global client profile) is not announced as a client reply');

-- -----------------------------------------------------------------------------
-- Real RPCs: Tenant B Form creation and the anonymous public Form
-- -----------------------------------------------------------------------------

create temp table form_ids (k text primary key, v uuid);
grant all on form_ids to authenticated, anon;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
select pg_temp.act('2502', 'b');
insert into form_ids values ('b-contact', (public.app_create_form(
  '71000000-0000-4000-8000-000000002501',
  jsonb_build_object('form_type', 'contact', 'canonical_key', 'wl225-b-contact', 'definition', jsonb_build_object(
    'name', 'Notif Contact', 'title', 'Contact us', 'visibility', 'public',
    'type_config', jsonb_build_object(
      'subject_field_key', '58000000-0000-4000-8000-000000002501',
      'message_field_key', '58000000-0000-4000-8000-000000002502',
      'ticket_orchestration', 'deferred'),
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000002501', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '58000000-0000-4000-8000-000000002502', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb)))).id);
insert into form_ids values ('b-contact-v1', (public.app_publish_form(
  '71000000-0000-4000-8000-000000002502', (select v from form_ids where k = 'b-contact'))).id);
reset role;

select is(pg_temp.recipients('form-created:' || (select v::text from form_ids where k = 'b-contact')), '2502,2503,2504,2507',
  'a Tenant B Form created through the RPC reaches Tenant B staff only (actor included, as before)');

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';
set local "request.headers" = '';
select lives_ok($$select public.app_submit_form(
    '71000000-0000-4000-8000-000000002503',
    (select v from form_ids where k = 'b-contact-v1'), '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000002501', 'value', 'WL225 anon B subject'),
      jsonb_build_object('field_key', '58000000-0000-4000-8000-000000002502', 'value', 'WL225 anon B message')
    ), '[]'::jsonb)$$,
  'anonymous submits the Tenant B public Contact Form');
reset role;

insert into form_ids select 'anon-ticket', id from public.tickets where subject = 'WL225 anon B subject';
select is((select tenant_id from public.tickets where id = (select v from form_ids where k = 'anon-ticket')),
  'f0f0f0f0-0000-4000-8000-000000002501'::uuid, 'the anonymous Contact Form Ticket belongs to Tenant B');
select is(pg_temp.recipients('ticket-created:' || (select v::text from form_ids where k = 'anon-ticket')), '2502,2503,2504',
  'an anonymous Tenant B Contact Form Ticket reaches Tenant B staff (no actor Tenant needed)');

-- -----------------------------------------------------------------------------
-- Suspended Tenant
-- -----------------------------------------------------------------------------

update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000002501';
insert into public.orders (id, tenant_id, company_id, service_id, title)
values ('e5200000-0000-4000-8000-000000002503', 'f0f0f0f0-0000-4000-8000-000000002501',
  'e5000000-0000-4000-8000-000000002502', 'e5100000-0000-4000-8000-000000002502', 'NOTIF B Suspended');
select is(pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002503'), '',
  'a suspended Tenant notifies nobody');
update public.tenants set status = 'archived', archived_at = now() where id = 'f0f0f0f0-0000-4000-8000-000000002501';
insert into public.orders (id, tenant_id, company_id, service_id, title)
values ('e5200000-0000-4000-8000-000000002504', 'f0f0f0f0-0000-4000-8000-000000002501',
  'e5000000-0000-4000-8000-000000002502', 'e5100000-0000-4000-8000-000000002502', 'NOTIF B Archived');
select is(pg_temp.recipients('project-created:e5200000-0000-4000-8000-000000002504'), '',
  'an archived Tenant notifies nobody');
update public.tenants set status = 'active', archived_at = null where id = 'f0f0f0f0-0000-4000-8000-000000002501';

-- Wallet credit through the real trigger (trusted writer): the company decides.
insert into public.company_wallet_transactions (id, company_id, request_id, actor_profile_id,
  amount_cents, balance_after_cents, source)
values ('e5a00000-0000-4000-8000-000000002502', 'e5000000-0000-4000-8000-000000002502',
  'e5a10000-0000-4000-8000-000000002502', '20000000-0000-4000-8000-000000002502', 500, 500, 'manual_credit');
select is(pg_temp.recipients('wallet-credit-internal:e5a00000-0000-4000-8000-000000002502'), '2502,2503,2504,2507',
  'a Tenant B wallet credit reaches Tenant B staff with clients.view in B only');
select is(pg_temp.stamp('wallet-credit-internal:e5a00000-0000-4000-8000-000000002502'), 'f0f0f0f0-0000-4000-8000-000000002501',
  'the Tenant B wallet credit row is stamped with Tenant B');

-- Legacy rows: the migration backfill statement, replayed on synthetic NULL rows.
-- Keep in sync with the UPDATE in 20261008230000_tenant_internal_notification_isolation.sql.
insert into public.notifications (id, recipient_profile_id, audience, category, variant, title, body, href,
  entity_type, entity_id, event_key)
values
  ('e5b00000-0000-4000-8000-000000002501', '20000000-0000-4000-8000-000000002505', 'internal', 'project', 'info',
   'LEGACY B', 'LEGACY B body', '/orders/x', 'order', 'e5200000-0000-4000-8000-000000002502', 'wl225-legacy-b'),
  ('e5b00000-0000-4000-8000-000000002502', '20000000-0000-4000-8000-000000002505', 'internal', 'ticket', 'info',
   'LEGACY ORPHAN', 'LEGACY ORPHAN body', '/tickets/x', 'ticket', 'e5300000-0000-4000-8000-0000000025ff', 'wl225-legacy-orphan'),
  ('e5b00000-0000-4000-8000-000000002503', '20000000-0000-4000-8000-000000002505', 'client', 'project', 'info',
   'LEGACY CLIENT', 'LEGACY CLIENT body', '/account', 'order', 'e5200000-0000-4000-8000-000000002502', 'wl225-legacy-client');
update public.notifications as notification
set tenant_id = resolved.tenant_id
from (
  select candidate.id,
    private.activity_event_parent_tenant_id(candidate.entity_type, candidate.entity_id) as tenant_id
  from public.notifications as candidate
  where candidate.audience = 'internal'
    and candidate.category <> 'team'
    and candidate.tenant_id is null
) as resolved
where notification.id = resolved.id
  and resolved.tenant_id is not null;
select is(
  (select array_agg(coalesce(tenant_id::text, 'null') order by id) from public.notifications
   where id::text like 'e5b00000-%'),
  array['f0f0f0f0-0000-4000-8000-000000002501', 'null', 'null'],
  'backfill: a legacy internal row takes its subject Tenant; an orphan and client rows stay NULL (never Wolf Forge)');

-- -----------------------------------------------------------------------------
-- Readers: list / unread / mark for the dual-Tenant identity
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('2503', 'wf');
select ok(position('project-created:e5200000-0000-4000-8000-000000002501' in pg_temp.feed()) > 0,
  'dual identity: the Wolf Forge stream lists the Wolf Forge Project');
select ok(position('NOTIF B' in pg_temp.feed()) = 0 and position('e5200000-0000-4000-8000-000000002502' in pg_temp.feed()) = 0
  and position('WL225 anon' in pg_temp.feed()) = 0 and position('NOTIFB25' in pg_temp.feed()) = 0,
  'dual identity: no Tenant B title, body, entity id or href in the Wolf Forge stream');
reset role;
insert into fixture_snaps values ('wf-2503-unread', (select count(*)::text from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000002503' and tenant_id = private.wolf_forge_tenant_id() and read_at is null));
insert into fixture_snaps values ('b-2503-unread', (select count(*)::text from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000002503'
    and tenant_id = 'f0f0f0f0-0000-4000-8000-000000002501' and read_at is null));
set local role authenticated;
select is(pg_temp.unread(), (select v::bigint from fixture_snaps where k = 'wf-2503-unread'),
  'dual identity: the Wolf Forge badge counts only Wolf Forge rows');
reset role;
select is(
  (select count(*) from public.notifications
   where recipient_profile_id = '20000000-0000-4000-8000-000000002503'
     and tenant_id = 'f0f0f0f0-0000-4000-8000-000000002501' and read_at is null) > 0,
  true, 'the dual identity has unread Tenant B rows');
insert into fixture_snaps values ('b-2503', pg_temp.snap('20000000-0000-4000-8000-000000002503', 'f0f0f0f0-0000-4000-8000-000000002501'));
set local role authenticated;

select pg_temp.act('2503', 'b');
select ok(position('NOTIF B Project' in pg_temp.feed()) > 0 and position('WL225 anon B subject' in pg_temp.feed()) > 0,
  'dual identity: the Tenant B stream lists the Tenant B Project and Contact Form Ticket');
select ok(position('NOTIF WF' in pg_temp.feed()) = 0 and position('e5200000-0000-4000-8000-000000002501' in pg_temp.feed()) = 0
  and position('NOTIFWF25' in pg_temp.feed()) = 0,
  'dual identity: no Wolf Forge row in the Tenant B stream');
select is(pg_temp.unread(), (select v::bigint from fixture_snaps where k = 'b-2503-unread'),
  'dual identity: the Tenant B badge counts only Tenant B rows');

-- Foreign id under the Wolf Forge selector behaves like a missing id.
select pg_temp.act('2503', 'wf');
select is(public.app_mark_notification_read('e5f00000-0000-4000-8000-0000000025ff'), false,
  'a missing id marks nothing');
reset role;
insert into fixture_snaps values ('b-row', (select id::text from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000002503'
    and event_key = 'project-created:e5200000-0000-4000-8000-000000002502'));
insert into fixture_snaps values ('wf-row', (select id::text from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000002503'
    and event_key = 'project-created:e5200000-0000-4000-8000-000000002501'));
set local role authenticated;
select is(public.app_mark_notification_read((select v::uuid from fixture_snaps where k = 'b-row')), false,
  'a foreign Tenant B notification id cannot be marked from Wolf Forge');
select is(public.app_mark_notification_read((select v::uuid from fixture_snaps where k = 'wf-row')), true,
  'the own-Tenant notification is marked');
select ok(public.app_mark_all_notifications_read() >= 1, 'mark-all marks Wolf Forge rows');
reset role;
select is(pg_temp.snap('20000000-0000-4000-8000-000000002503', 'f0f0f0f0-0000-4000-8000-000000002501'),
  (select v from fixture_snaps where k = 'b-2503'),
  'Wolf Forge mark-one and mark-all left every Tenant B row byte-identical');
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000002503'
    and tenant_id = private.wolf_forge_tenant_id() and read_at is null), 0::bigint,
  'every Wolf Forge row of the dual identity is read');

set local role authenticated;
select pg_temp.act('2503', 'b');
select ok(pg_temp.unread() > 0, 'the Tenant B badge is untouched by the Wolf Forge mark-all');
select is(public.app_mark_notification_read((select v::uuid from fixture_snaps where k = 'wf-row')), false,
  'a foreign Wolf Forge id cannot be marked from Tenant B');
select ok(public.app_mark_all_notifications_read() >= 1, 'Tenant B mark-all marks Tenant B rows');
select is(pg_temp.unread(), 0::bigint, 'the Tenant B badge clears');

-- Tenant B-only staff and the global-internal / B-client identity.
select pg_temp.act('2504', 'b');
select ok(position('NOTIF B Project' in pg_temp.feed()) > 0,
  'global client + Tenant B internal lists its Tenant B internal notifications');
select pg_temp.act('2505', 'b');
select ok(position('NOTIF B' in pg_temp.feed()) = 0 and position('WL225' in pg_temp.feed()) = 0,
  'global internal + Tenant B client lists no Tenant B internal notification');
select ok(position('LEGACY B' in pg_temp.feed()) = 0 and position('LEGACY ORPHAN' in pg_temp.feed()) = 0,
  'a client session never lists an internal row, Tenant-stamped or NULL');
select is(public.app_mark_notification_read('e5b00000-0000-4000-8000-000000002501'), false,
  'a client session cannot mark an internal row');
select lives_ok('select public.app_mark_all_notifications_read()', 'a client session runs mark-all');
reset role;
select ok((select read_at is null from public.notifications where id = 'e5b00000-0000-4000-8000-000000002501'),
  'a client-session mark-all leaves the internal row unread');
set local role authenticated;
select ok(position('LEGACY CLIENT' in pg_temp.feed()) > 0,
  'a client session still lists its own client row');
select pg_temp.act('2505', 'wf');
select ok(position('LEGACY B' in pg_temp.feed()) = 0 and position('LEGACY ORPHAN' in pg_temp.feed()) > 0,
  'the same person as Wolf Forge staff lists the NULL orphan but not the Tenant B-stamped row');
select ok(position('LEGACY CLIENT' in pg_temp.feed()) = 0,
  'an internal session never lists a client row');
select is(public.app_mark_notification_read('e5b00000-0000-4000-8000-000000002503'), false,
  'an internal session cannot mark a client row');
select pg_temp.act('2502', 'b');
select ok(position('WL225 anon B subject' in pg_temp.feed()) > 0,
  'Tenant B-only staff lists its legitimate Tenant B notifications');

-- Fail closed.
select pg_temp.act('2506', 'b');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501',
  'an archived Tenant B membership cannot list in Tenant B');
select pg_temp.act('2501', 'unknown');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501',
  'an unknown selector fails closed for the list');
select is(pg_temp.try('select public.app_mark_all_notifications_read()'), '42501',
  'an unknown selector fails closed for mark-all');
select pg_temp.act('2501', 'malformed');
select is(pg_temp.try('select public.app_mark_notification_read(''e5f00000-0000-4000-8000-0000000025ff'')'), '42501',
  'a malformed selector fails closed for mark-one');
select pg_temp.act('2501', 'wf');
select ok(position('NOTIF WF Project' in pg_temp.feed()) > 0 and position('NOTIF B' in pg_temp.feed()) = 0,
  'Wolf Forge-only staff keeps its Wolf Forge stream and sees no Tenant B row');
reset role;

-- No fixture row escaped stamping.
select is((select count(*) from public.notifications
  where recipient_profile_id::text like '20000000-0000-4000-8000-0000000025%'
    and audience = 'internal' and tenant_id is null
    and id::text not like 'e5b00000-%'), 0::bigint,
  'every new internal row carries a Tenant');

select * from finish();
rollback;
