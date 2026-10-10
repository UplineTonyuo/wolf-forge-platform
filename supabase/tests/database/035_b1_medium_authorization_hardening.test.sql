begin;

select plan(41);

-- =============================================================================
-- Security Fix Batch B1 adversarial fixtures.
--
-- Internal: one owner (everything), one manager (holds services.view but not
-- client_private.read, so the Services branch of the activity policy is what is
-- actually being tested), three staff each denied exactly one module, and one
-- archived owner standing in for a stale but still-signed JWT.
--
-- Client: four profiles at one company differing only in capability, plus one
-- profile at an unrelated company.
-- =============================================================================

-- Before any fixture exists: every notification row the migration left behind
-- is capability-appropriate for the profile holding it. This is the retrospective
-- half of M-01 -- rows delivered by the old blind fan-out were removed, including
-- the unconditional legacy wallet backfill.
select is(
  (
    select count(*)
    from public.notifications as notification_row
    where private.notification_category_permission(
            notification_row.audience, notification_row.category
          ) is null
       or not private.profile_has_permission_in_tenant(
            notification_row.recipient_profile_id,
            coalesce(notification_row.tenant_id, private.wolf_forge_tenant_id()),
            private.notification_category_permission(
              notification_row.audience, notification_row.category
            )
          )
  ),
  0::bigint,
  'no already-delivered notification sits with a recipient that lacks its module'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('b1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b1-owner@example.invalid', now(), now()),
  ('b1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b1-services-denied@example.invalid', now(), now()),
  ('b1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'b1-projects-denied@example.invalid', now(), now()),
  ('b1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'b1-tickets-denied@example.invalid', now(), now()),
  ('b1000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'b1-archived@example.invalid', now(), now()),
  ('b1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'b1-manager@example.invalid', now(), now()),
  ('b2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b1-client-full@example.invalid', now(), now()),
  ('b2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b1-client-forms-denied@example.invalid', now(), now()),
  ('b2000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'b1-client-invoices-denied@example.invalid', now(), now()),
  ('b2000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'b1-client-reporting-denied@example.invalid', now(), now()),
  ('b2000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'b1-client-foreign@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner'), display_name = 'B1 Owner'
where id = 'b1000000-0000-0000-0000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'), display_name = 'B1 Services Denied'
where id in (
  'b1000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000003',
  'b1000000-0000-0000-0000-000000000004'
);

update public.profiles
set role_id = (select id from public.roles where name = 'manager'), display_name = 'B1 Manager'
where id = 'b1000000-0000-0000-0000-000000000006';

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    display_name = 'B1 Archived',
    archived_at = now()
where id = 'b1000000-0000-0000-0000-000000000005';

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values
  ('b1000000-0000-0000-0000-000000000002', 'services.view', false),
  ('b1000000-0000-0000-0000-000000000003', 'projects.view', false),
  ('b1000000-0000-0000-0000-000000000004', 'tickets.view', false);

insert into public.companies (id, name, status)
values
  ('b3000000-0000-0000-0000-00000000000a', 'B1 Client A', 'client'),
  ('b3000000-0000-0000-0000-00000000000b', 'B1 Client B', 'client');

update public.profiles
set company_id = 'b3000000-0000-0000-0000-00000000000a'
where id in (
  'b2000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000003',
  'b2000000-0000-0000-0000-000000000004'
);

update public.profiles
set company_id = 'b3000000-0000-0000-0000-00000000000b'
where id = 'b2000000-0000-0000-0000-000000000005';

-- D-275: the Client links above provision these clients into Wolf Forge, so
-- their overrides follow them.
insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values
  ('b2000000-0000-0000-0000-000000000002', 'forms.view', false),
  ('b2000000-0000-0000-0000-000000000003', 'invoices.view', false),
  ('b2000000-0000-0000-0000-000000000004', 'reporting.view', false);

-- Catalogue fixtures. One private/inactive Service that must never reach a
-- Services-denied actor, one active public Service that is the Store floor,
-- one archived folder and one live folder.
insert into public.service_folders (id, name, archived_at)
values
  ('b5000000-0000-0000-0000-000000000001', 'B1 ARCHIVED FOLDER', now()),
  ('b5000000-0000-0000-0000-000000000002', 'B1 Live Folder', null);

insert into public.services (id, name, description, is_active, is_public, folder_id)
values
  ('b4000000-0000-0000-0000-000000000001', 'B1 Private Service',
   'B1-PRIVATE-DESCRIPTION', false, false, null),
  ('b4000000-0000-0000-0000-000000000002', 'B1 Store Service',
   'B1 public catalogue copy', true, true, 'b5000000-0000-0000-0000-000000000002');

insert into public.activity_events (entity_type, entity_id, action, summary, metadata)
values (
  'service', 'b4000000-0000-0000-0000-000000000001',
  'service.updated', 'B1-SERVICE-ACTIVITY', '{}'::jsonb
);

create temporary table b1_ids (label text primary key, id uuid not null) on commit drop;
grant select, insert, update on b1_ids to authenticated;

-- =============================================================================
-- N-01 — Services read authorization
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000006';

select is(
  (select count(*) from public.services where id = 'b4000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized Services viewer still reads a private, inactive Service'
);

select is(
  (select count(*) from public.service_folders where id = 'b5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized Services viewer still reads an archived folder'
);

select is(
  (select count(*) from public.activity_events
    where entity_id = 'b4000000-0000-0000-0000-000000000001' and entity_type = 'service'),
  1::bigint,
  'an authorized Services viewer still reads Service activity history'
);

set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.services where id = 'b4000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a services.view-denied internal actor cannot retrieve a private, inactive Service'
);

select is(
  (select count(*) from public.services
    where description = 'B1-PRIVATE-DESCRIPTION'),
  0::bigint,
  'the denied actor cannot reach private Service copy through any predicate'
);

select is(
  (select count(*) from public.service_folders where id = 'b5000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a services.view-denied internal actor cannot retrieve archived folder metadata'
);

select is(
  (select count(*) from public.activity_events
    where entity_id = 'b4000000-0000-0000-0000-000000000001' and entity_type = 'service'),
  0::bigint,
  'a services.view-denied internal actor reads no Service activity rows'
);

select is(
  (select count(*) from public.services where id = 'b4000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the active public catalogue floor survives for a services.view-denied actor'
);

select throws_ok(
  $$select public.app_create_service('b7000000-0000-0000-0000-000000000001', '{"name":"B1 denied"}'::jsonb)$$,
  '42501', 'permission denied: services.view',
  'H-02 Service mutation authority is unchanged by the read-policy fix'
);

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.services
    where is_public and is_active and archived_at is null
      and id = 'b4000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the client Store still reads the public active catalogue'
);

select is(
  (select count(*) from public.service_folders where id = 'b5000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the client Store still reads live folders for category navigation'
);

-- =============================================================================
-- M-02 — activity event forgery
-- =============================================================================

reset role;

select is(
  has_table_privilege('authenticated', 'public.activity_events', 'INSERT'),
  false,
  'the authenticated browser role holds no INSERT privilege on activity_events'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'activity_events'
      and policyname = 'activity_events_internal_insert'),
  0::bigint,
  'the permissive internal INSERT policy no longer exists'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000003';

select throws_ok(
  $$insert into public.activity_events (entity_type, entity_id, action, summary, metadata)
    values ('company', 'b3000000-0000-0000-0000-00000000000a', 'company.status_changed',
            'B1-FORGED-CONVERSION', '{"status":"client"}'::jsonb)$$,
  '42501', null,
  'a low-privilege internal actor cannot insert an activity event directly'
);

reset role;

select is(
  (select count(*) from public.activity_events where summary = 'B1-FORGED-CONVERSION'),
  0::bigint,
  'no forged client conversion history was persisted'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into b1_ids values ('company', (public.app_create_company('b7000000-0000-0000-0000-000000000002', 'B1 Legitimate Company')).id)$$,
  'the trusted company RPC still records legitimate activity'
);

reset role;

select is(
  (select activity_row.actor_profile_id
     from public.activity_events as activity_row
     where activity_row.entity_type = 'company'
       and activity_row.action = 'company.created'
       and activity_row.entity_id = (select id from b1_ids where label = 'company')),
  'b1000000-0000-0000-0000-000000000001'::uuid,
  'the surviving audit row is attributed to the real server-derived actor'
);

-- =============================================================================
-- M-01 — capability-aware notification fan-out
-- =============================================================================

-- Project creation, through the real trigger.
insert into public.orders (id, company_id, service_id, title, status, priority)
values (
  'b6000000-0000-0000-0000-000000000001',
  'b3000000-0000-0000-0000-00000000000a',
  'b4000000-0000-0000-0000-000000000002',
  'B1 Notification Project', 'pending', 'normal'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'project-created:b6000000-0000-0000-0000-000000000001'
      and recipient_profile_id = 'b1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized internal recipient still receives the Project notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'project-created:b6000000-0000-0000-0000-000000000001'
      and recipient_profile_id = 'b1000000-0000-0000-0000-000000000003'),
  0::bigint,
  'Projects-denied staff receives no Project notification'
);

-- Client Ticket reply, through the real trigger.
insert into public.tickets (id, company_id, client_profile_id, subject, created_by_profile_id)
values (
  'b6000000-0000-0000-0000-000000000002',
  'b3000000-0000-0000-0000-00000000000a',
  'b2000000-0000-0000-0000-000000000001',
  'B1 Confidential Ticket Subject',
  'b2000000-0000-0000-0000-000000000001'
);

insert into public.ticket_messages (
  id, ticket_id, author_profile_id, author_type, message_kind, visibility, body
)
values (
  'b6000000-0000-0000-0000-000000000003',
  'b6000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000001',
  'client', 'reply', 'client', 'B1 client reply body'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'client-ticket-reply:b6000000-0000-0000-0000-000000000003'
      and recipient_profile_id = 'b1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized internal recipient still receives the Ticket notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'client-ticket-reply:b6000000-0000-0000-0000-000000000003'
      and recipient_profile_id = 'b1000000-0000-0000-0000-000000000004'),
  0::bigint,
  'Tickets-denied staff receives no Ticket metadata'
);

-- Invoice issue, through the real draft -> unpaid trigger.
insert into public.invoices (
  id, company_id, status, subtotal_cents, total_cents,
  created_by_profile_id, updated_by_profile_id
)
values (
  'b6000000-0000-0000-0000-000000000004',
  'b3000000-0000-0000-0000-00000000000a',
  'draft', 25000, 25000,
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001'
);

update public.invoices
set status = 'unpaid', invoice_number = 990001, issued_at = now()
where id = 'b6000000-0000-0000-0000-000000000004';

select is(
  (select count(*) from public.notifications
    where event_key = 'client-invoice-issued:b6000000-0000-0000-0000-000000000004'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized client still receives the Invoice notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'client-invoice-issued:b6000000-0000-0000-0000-000000000004'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000003'),
  0::bigint,
  'an invoices.view-denied client receives no Invoice notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'client-invoice-issued:b6000000-0000-0000-0000-000000000004'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000005'),
  0::bigint,
  'a foreign-company client receives no Invoice notification'
);

-- The remaining domains go through the two legacy emitters on purpose: those
-- are the entry points the Reporting send RPCs and any future emitter still
-- use, so proving the capability derivation there proves the whole class.
-- Since WL-2.26 a client row needs a real subject to resolve its Tenant, so
-- these synthetic events use the fixture Company as their subject.
do $$
begin
  perform private.emit_internal_notification(
    'b1-wallet-internal', 'wallet', 'credit',
    'Client wallet credited', 'B1 wallet body', '/clients/b3000000-0000-0000-0000-00000000000a',
    'company', 'b3000000-0000-0000-0000-00000000000a',
    null, 'b3000000-0000-0000-0000-00000000000a', now()
  );

  perform private.emit_company_client_notification(
    'b3000000-0000-0000-0000-00000000000a',
    'b1-wallet-client', 'wallet', 'credit',
    'Wallet credited', 'B1 wallet client body', '/account',
    'company', 'b3000000-0000-0000-0000-00000000000a', null, now()
  );

  perform private.emit_company_client_notification(
    'b3000000-0000-0000-0000-00000000000a',
    'b1-form-client', 'form', 'info',
    'New onboarding item', 'B1 form client body', '/account/onboarding',
    'company', 'b3000000-0000-0000-0000-00000000000a', null, now()
  );

  perform private.emit_company_client_notification(
    'b3000000-0000-0000-0000-00000000000a',
    'b1-report-client', 'report', 'info',
    'New SEO report from Wolf Forge', 'B1 report client body', '/account/reporting',
    'company', 'b3000000-0000-0000-0000-00000000000a', null, now()
  );

  perform private.emit_company_client_notification(
    'b3000000-0000-0000-0000-00000000000a',
    'b1-coupon-client', 'coupon', 'info',
    'B1 unmapped category', 'B1 coupon client body', '/account',
    'company', 'b3000000-0000-0000-0000-00000000000a', null, now()
  );
end;
$$;

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-wallet-internal'
      and recipient_profile_id = 'b1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a clients.view holder still receives the internal wallet notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-wallet-internal'
      and recipient_profile_id = 'b1000000-0000-0000-0000-000000000002'),
  0::bigint,
  'staff without clients.view receives no client wallet metadata'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-wallet-client'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000003'),
  0::bigint,
  'an invoices.view-denied client receives no wallet notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-form-client'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized client still receives the Form notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-form-client'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a forms.view-denied client receives no Form notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-report-client'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000001'),
  1::bigint,
  'an authorized client still receives the Reporting notification'
);

select is(
  (select count(*) from public.notifications
    where event_key = 'b1-report-client'
      and recipient_profile_id = 'b2000000-0000-0000-0000-000000000004'),
  0::bigint,
  'a reporting.view-denied client receives no Reporting notification'
);

select is(
  (select count(*) from public.notifications where event_key = 'b1-coupon-client'),
  0::bigint,
  'a client-audience category with no portal module reaches nobody at all'
);

select ok(
  (select bool_and(private.notification_category_permission('internal', category_key) is not null)
     from unnest(array[
       'project', 'client', 'form', 'coupon', 'ticket',
       'payment', 'wallet', 'store', 'report'
     ]) as category_key),
  'every allowed notification category resolves to an internal capability'
);

-- ---------------------------------------------------------------------------
-- Stale-session and cross-recipient isolation on the read/mark RPCs
-- ---------------------------------------------------------------------------

insert into b1_ids
select 'foreign-notification', notification_row.id
from public.notifications as notification_row
where notification_row.event_key = 'b1-form-client'
  and notification_row.recipient_profile_id = 'b2000000-0000-0000-0000-000000000001';

-- An archived profile that still holds a signed JWT.
insert into public.notifications (
  recipient_profile_id, audience, category, variant, title, body, href, event_key
)
values (
  'b1000000-0000-0000-0000-000000000005', 'internal', 'project', 'info',
  'B1 stale session row', 'B1 stale session body', '/orders', 'b1-archived-row'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'b1000000-0000-0000-0000-000000000005';

select throws_ok(
  $$select * from public.app_list_my_notifications()$$,
  '42501', 'active authenticated notification access required',
  'an archived profile cannot list notifications with a stale JWT'
);

select throws_ok(
  $$select public.app_mark_notification_read('b6000000-0000-0000-0000-000000000009')$$,
  '42501', 'active authenticated notification access required',
  'an archived profile cannot mark a notification read with a stale JWT'
);

select throws_ok(
  $$select public.app_mark_all_notifications_read()$$,
  '42501', 'active authenticated notification access required',
  'an archived profile cannot mark all notifications read with a stale JWT'
);

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.app_list_my_notifications(100)
    where event_key = 'b1-form-client'),
  1::bigint,
  'an active recipient still lists its own notifications'
);

set local "request.jwt.claim.sub" = 'b2000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.app_list_my_notifications(100)
    where event_key = 'b1-form-client'),
  0::bigint,
  'one recipient can never read another recipient''s notification'
);

select is(
  public.app_mark_notification_read((select id from b1_ids where label = 'foreign-notification')),
  false,
  'one recipient can never mark another recipient''s notification read'
);

reset role;

select is(
  (select notification_row.read_at
     from public.notifications as notification_row
     where notification_row.id = (select id from b1_ids where label = 'foreign-notification')),
  null::timestamptz,
  'the targeted notification is still unread after the cross-recipient attempt'
);

select * from finish();
rollback;
