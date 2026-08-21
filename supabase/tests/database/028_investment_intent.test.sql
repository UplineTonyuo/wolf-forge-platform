begin;

select plan(62);

-- =============================================================================
-- FIXTURES
--
-- Two unrelated client companies plus one account per internal role. Every
-- client assertion below runs as a real authenticated session, so it exercises
-- RLS and the SECURITY DEFINER resolvers rather than application filtering.
--
-- Discipline in this file: a client session only ever CALLS the write RPC. Rows
-- are inspected after returning to the migration role, because a client session
-- can read no interest row at all -- which is itself asserted below.
--
-- The auth trigger creates every profile as an unclaimed client account, so the
-- client fixtures only need their company attached and the internal fixtures
-- need their role swapped.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('70000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'intent-client-a@example.invalid', now(), now()),
  ('70000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'intent-client-b@example.invalid', now(), now()),
  ('70000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'intent-staff@example.invalid', now(), now()),
  ('70000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'intent-admin@example.invalid', now(), now()),
  ('70000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'intent-owner@example.invalid', now(), now()),
  ('70000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated',
   'intent-manager@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('71000000-0000-0000-0000-00000000000a', 'Northgate Dental'),
  ('71000000-0000-0000-0000-00000000000b', 'Southgate Legal');

update public.profiles
set company_id = '71000000-0000-0000-0000-00000000000a', display_name = 'Client A'
where id = '70000000-0000-0000-0000-000000000001';

update public.profiles
set company_id = '71000000-0000-0000-0000-00000000000b', display_name = 'Client B'
where id = '70000000-0000-0000-0000-000000000002';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Intent Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '70000000-0000-0000-0000-000000000003';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Intent Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin'
  and profile_row.id = '70000000-0000-0000-0000-000000000004';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Intent Owner', company_id = null
from public.roles as role_row
where role_row.name = 'owner'
  and profile_row.id = '70000000-0000-0000-0000-000000000005';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Intent Manager', company_id = null
from public.roles as role_row
where role_row.name = 'manager'
  and profile_row.id = '70000000-0000-0000-0000-000000000006';

insert into public.service_folders (id, name, sort_order)
values ('72000000-0000-0000-0000-000000000001', 'Search', 1);

insert into public.services (id, name, folder_id, price, is_active, is_public, archived_at)
values
  ('73000000-0000-0000-0000-000000000001', 'Local SEO',
   '72000000-0000-0000-0000-000000000001', 500, true, true, null),
  ('73000000-0000-0000-0000-000000000002', 'Private Service',
   '72000000-0000-0000-0000-000000000001', 100, true, false, null),
  ('73000000-0000-0000-0000-000000000003', 'Inactive Service',
   '72000000-0000-0000-0000-000000000001', 100, false, true, null),
  ('73000000-0000-0000-0000-000000000004', 'Archived Service',
   '72000000-0000-0000-0000-000000000001', 100, true, true, now());

-- =============================================================================
-- ISOLATION
--
-- These assertions count rows rather than name fixture ids, which was only ever
-- correct while the table was empty. A local database accumulates real interest
-- rows as the app is used, so the counts drift and the file starts failing for
-- reasons that have nothing to do with the code under test.
--
-- Clearing inside the transaction makes the file deterministic wherever it
-- runs. The enclosing rollback means no real row is ever actually removed.
-- =============================================================================

delete from public.activity_events where entity_type = 'service_interest';
delete from public.notifications where entity_type = 'service_interest';
delete from public.service_interests;

-- =============================================================================
-- STRUCTURE AND WIRING
-- =============================================================================

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.service_interests'::regclass
  ),
  'row level security is enabled and forced on service_interests'
);

select ok(
  not has_table_privilege('authenticated', 'public.service_interests', 'select')
    and not has_table_privilege('authenticated', 'public.service_interests', 'insert')
    and not has_table_privilege('authenticated', 'public.service_interests', 'update')
    and not has_table_privilege('authenticated', 'public.service_interests', 'delete'),
  'the authenticated role holds no direct privilege on service_interests'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.service_interests'::regclass
      and conname = 'service_interests_company_service_unique'
      and contype = 'u'
  ),
  1::bigint,
  'one interest per company and service is enforced by a unique constraint'
);

select throws_ok(
  $$ insert into public.service_interests (company_id, service_id, in_cart, removed_at)
     values ('71000000-0000-0000-0000-00000000000a',
             '73000000-0000-0000-0000-000000000001', true, now()) $$,
  '23514',
  null,
  'in_cart and removed_at cannot disagree'
);

select is(
  (
    select account_class || '|' || required_permission_key
    from public.permission_modules
    where module_key = 'investment_intent'
  ),
  'internal|investment_intent.view',
  'investment_intent is an internal module backed by investment_intent.view'
);

select is(
  (
    select count(*)
    from public.role_permissions as grant_row
    join public.roles as role_row on role_row.id = grant_row.role_id
    where role_row.name in ('owner', 'admin')
      and grant_row.permission_key in ('investment_intent.view', 'investment_intent.manage')
      and grant_row.allowed
  ),
  4::bigint,
  'owner and admin hold both investment intent capabilities'
);

select is(
  (
    select count(*)
    from public.role_permissions as grant_row
    join public.roles as role_row on role_row.id = grant_row.role_id
    where role_row.name in ('manager', 'staff', 'client')
      and grant_row.permission_key in ('investment_intent.view', 'investment_intent.manage')
  ),
  0::bigint,
  'manager, staff and client presets hold neither investment intent capability'
);

select ok(
  not private.is_client_eligible_permission('investment_intent.view')
    and not private.is_client_eligible_permission('investment_intent.manage'),
  'neither investment intent capability can be granted to a client account'
);

-- =============================================================================
-- CLIENT A: FIRST ADD
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], true),
  1,
  'a first add records one interest'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.service_interests),
  1::bigint,
  'exactly one interest row exists after the first add'
);

-- The client supplied a service id and nothing else. The company can only have
-- come from the authenticated session.
select is(
  (
    select company_id::text || '|' || status || '|' || in_cart::text || '|' || add_count::text
    from public.service_interests
  ),
  '71000000-0000-0000-0000-00000000000a|new|true|1',
  'the interest is recorded for the caller''s own company as a new, in-cart signal'
);

select is(
  (select signalled_by_profile_id from public.service_interests),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'the signalling client profile is recorded from the session'
);

-- =============================================================================
-- CLIENT A: A REPEATED ADD IS A NO-OP
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], true),
  0,
  'adding something already in the cart writes nothing'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select add_count from public.service_interests),
  1,
  'a repeated add does not inflate the activity count'
);

-- A repeated add must not reorder the workspace, so activity may not move. The
-- insert set every timestamp in one statement, so they are still equal.
select ok(
  (select last_activity_at = first_added_at from public.service_interests),
  'a repeated add does not advance the latest activity timestamp'
);

-- =============================================================================
-- CLIENT A: INELIGIBLE INVESTMENTS
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(
    array[
      '73000000-0000-0000-0000-000000000002',
      '73000000-0000-0000-0000-000000000003',
      '73000000-0000-0000-0000-000000000004'
    ]::uuid[],
    true
  ),
  0,
  'private, inactive and archived services record no interest'
);

select throws_ok(
  $$ select public.app_record_store_interest(
       (select array_agg(gen_random_uuid()) from generate_series(1, 13)), true) $$,
  '22023',
  null,
  'more ids than the cart can hold is rejected'
);

select throws_ok(
  $$ select public.app_record_store_interest(array[]::uuid[], true) $$,
  '22023',
  null,
  'an empty id list is rejected'
);

-- =============================================================================
-- CLIENT A: READ AND WRITE BOUNDARY
-- =============================================================================

-- Privileges are checked before row security, so a client session is refused
-- outright rather than being handed an empty result. Both layers say no; this
-- is the one that answers first.
select throws_ok(
  $$ select count(*) from public.service_interests $$,
  '42501',
  null,
  'a client session cannot read the interest table at all, not even its own company''s rows'
);

select throws_ok(
  $$ select public.app_list_investment_intents() $$,
  '42501',
  null,
  'a client session cannot read the internal Investment Intent list'
);

select throws_ok(
  $$ select public.app_set_investment_intent_status(gen_random_uuid(), 'qualified') $$,
  '42501',
  null,
  'a client session cannot move an intent through the internal workflow'
);

select throws_ok(
  $$ insert into public.service_interests (company_id, service_id)
     values ('71000000-0000-0000-0000-00000000000b',
             '73000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a client session cannot write an interest row directly'
);

select throws_ok(
  $$ insert into public.notifications (
       recipient_profile_id, audience, category, title, body, href, event_key
     ) values (
       '70000000-0000-0000-0000-000000000005', 'internal', 'store',
       'Forged', 'Forged', '/investment-intent', 'forged-key'
     ) $$,
  '42501',
  null,
  'a client session cannot insert an internal notification directly'
);

-- =============================================================================
-- NOTIFICATIONS: FIRST ADD
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';

-- Recipient assertions are scoped to the fixture accounts. The local database
-- carries real internal profiles, and every one of them holding the capability
-- is notified too -- which is the intended behaviour, not a leak.
select is(
  (
    select count(*)
    from public.notifications
    where entity_type = 'service_interest'
      and recipient_profile_id in (
        '70000000-0000-0000-0000-000000000004',
        '70000000-0000-0000-0000-000000000005'
      )
  ),
  2::bigint,
  'a first add notifies both fixture capability holders'
);

select is(
  (
    select count(*)
    from public.notifications
    where entity_type = 'service_interest'
      and recipient_profile_id in (
        '70000000-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-000000000002',
        '70000000-0000-0000-0000-000000000003',
        '70000000-0000-0000-0000-000000000006'
      )
  ),
  0::bigint,
  'clients, staff and managers are not notified about investment intent'
);

select is(
  (
    select string_agg(role_row.name, ',' order by role_row.name)
    from public.notifications as notification
    join public.profiles as profile_row
      on profile_row.id = notification.recipient_profile_id
    join public.roles as role_row on role_row.id = profile_row.role_id
    where notification.entity_type = 'service_interest'
      and notification.recipient_profile_id in (
        '70000000-0000-0000-0000-000000000004',
        '70000000-0000-0000-0000-000000000005'
      )
  ),
  'admin,owner',
  'only owner and admin receive investment intent notifications'
);

select is(
  (
    select distinct category || '|' || audience || '|' || left(href, 18)
    from public.notifications
    where entity_type = 'service_interest'
  ),
  'store|internal|/investment-intent',
  'the notification is an internal store notification linking to the workspace'
);

select is(
  (
    select distinct body
    from public.notifications
    where entity_type = 'service_interest'
  ),
  'Northgate Dental showed interest in Local SEO.',
  'the notification names the company and the investment'
);

-- =============================================================================
-- CLIENT A: REMOVAL PRESERVES HISTORY
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], false),
  1,
  'removing an investment from the cart records the removal'
);

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], false),
  0,
  'removing something already removed writes nothing'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.service_interests),
  1::bigint,
  'a removal never deletes the interest record'
);

select ok(
  (
    select not in_cart and removed_at is not null and add_count = 1
    from public.service_interests
  ),
  'the removed interest keeps its history and reports itself out of cart'
);

select is(
  (
    select count(*)
    from public.notifications
    where entity_type = 'service_interest'
      and recipient_profile_id in (
        '70000000-0000-0000-0000-000000000004',
        '70000000-0000-0000-0000-000000000005'
      )
  ),
  2::bigint,
  'a removal notifies nobody'
);

-- =============================================================================
-- CLIENT A: RE-ADD IS A RENEWED SIGNAL
-- =============================================================================

-- now() is transaction time, so nothing inside this test would otherwise appear
-- to age. Backdating the fixture lets the re-add prove it genuinely advances the
-- activity timestamp instead of merely rewriting the same value.
--
-- last_notified_at ages with the rest of the row. Batch B2 coalesces renewal
-- signals behind a one-hour cooldown measured from it, so a row that genuinely
-- aged two hours is one whose next re-add is a real change of mind and must be
-- signalled. The suppressed case -- a rapid remove/re-add loop inside the
-- cooldown -- is covered in 036_b2_abuse_resistance.
update public.service_interests
set first_added_at = now() - interval '2 hours',
    last_added_at = now() - interval '1 hour',
    removed_at = now() - interval '1 hour',
    last_activity_at = now() - interval '1 hour',
    last_notified_at = now() - interval '2 hours';

create temporary table intent_probe as
select id, first_added_at, last_activity_at from public.service_interests;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], true),
  1,
  're-adding a removed investment records renewed interest'
);

reset role;
set local "request.jwt.claim.sub" = '';

select ok(
  (
    select interest.in_cart
      and interest.removed_at is null
      and interest.add_count = 2
      and interest.first_added_at = probe.first_added_at
      and interest.last_activity_at > probe.last_activity_at
    from public.service_interests as interest
    join intent_probe as probe on probe.id = interest.id
  ),
  're-adding restores the active signal, increments the count and keeps the original first_added_at'
);

select is(
  (
    select count(*)
    from public.notifications
    where event_key like 'service-interest-renewed:%'
      and recipient_profile_id in (
        '70000000-0000-0000-0000-000000000004',
        '70000000-0000-0000-0000-000000000005'
      )
  ),
  2::bigint,
  'a re-add notifies both capability holders that interest was renewed'
);

select is(
  (
    select distinct body
    from public.notifications
    where event_key like 'service-interest-renewed:%'
  ),
  'Northgate Dental added Local SEO back to their cart.',
  'the renewed notification reads as renewed interest rather than a new signal'
);

-- =============================================================================
-- COMPANY ISOLATION
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000002';

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], true),
  1,
  'a second company records its own interest in the same investment'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.service_interests),
  2::bigint,
  'the same investment carries one independent interest row per company'
);

select is(
  (
    select company_id
    from public.service_interests
    where signalled_by_profile_id = '70000000-0000-0000-0000-000000000002'
  ),
  '71000000-0000-0000-0000-00000000000b'::uuid,
  'the second company''s interest is attributed to that company alone'
);

-- Both companies acted at the same transaction timestamp, so the older signal is
-- aged deliberately to give the ordering assertion something real to sort.
update public.service_interests
set last_activity_at = now() - interval '30 minutes'
where company_id = '71000000-0000-0000-0000-00000000000a';

-- Captured before any internal triage, to prove triage does not disturb it.
create temporary table activity_probe as
select id, last_activity_at
from public.service_interests
where company_id = '71000000-0000-0000-0000-00000000000a';

-- =============================================================================
-- INTERNAL: READ BOUNDARY
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.app_list_investment_intents() $$,
  '42501',
  null,
  'a staff session is refused the Investment Intent workspace'
);

select throws_ok(
  $$ select public.app_record_store_interest(
       array['73000000-0000-0000-0000-000000000001']::uuid[], true) $$,
  '42501',
  null,
  'an internal session cannot record interest on a client''s behalf'
);

select throws_ok(
  $$ select count(*) from public.service_interests $$,
  '42501',
  null,
  'a staff session cannot read the interest table directly either'
);

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000006';

select throws_ok(
  $$ select public.app_list_investment_intents() $$,
  '42501',
  null,
  'a manager session is refused the Investment Intent workspace'
);

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000004';

select is(
  (select count(*) from public.app_list_investment_intents()),
  2::bigint,
  'an admin session reads every recorded interest'
);

select is(
  (
    select company_name || '|' || service_name || '|' || status || '|' || in_cart::text
    from public.app_list_investment_intents()
    limit 1
  ),
  'Southgate Legal|Local SEO|new|true',
  'the workspace leads with the most recent client activity'
);

select is(
  (
    select price::text || '|' || currency || '|' || recurring::text || '|' || folder_name
    from public.app_list_investment_intents()
    where company_name = 'Northgate Dental'
  ),
  '500.00|USD|false|Search',
  'the read model carries the investment price, cadence inputs and category'
);

-- =============================================================================
-- INTERNAL: WORKFLOW STATUS
-- =============================================================================

select throws_ok(
  $$ select public.app_set_investment_intent_status(
       (select intent_id from public.app_list_investment_intents()
        where company_name = 'Northgate Dental'), 'nurturing') $$,
  '22023',
  null,
  'an unknown workflow status is rejected'
);

select is(
  (
    select status
    from public.app_set_investment_intent_status(
      (select intent_id from public.app_list_investment_intents()
       where company_name = 'Northgate Dental'),
      'reviewing')
  ),
  'reviewing',
  'an admin session moves an intent into reviewing'
);

select ok(
  (
    select contacted_at is not null
      and contacted_by_profile_id = '70000000-0000-0000-0000-000000000004'
    from public.app_set_investment_intent_status(
      (select intent_id from public.app_list_investment_intents()
       where company_name = 'Northgate Dental'),
      'contacted')
  ),
  'marking an intent contacted stamps who made contact and when'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- Triage is not buying interest. If a status change moved this timestamp the
-- workspace would reorder itself every time someone did their job.
select ok(
  (
    select interest.last_activity_at = probe.last_activity_at
    from public.service_interests as interest
    join activity_probe as probe on probe.id = interest.id
    where interest.status = 'contacted'
  ),
  'a status change leaves the client activity timestamp alone'
);

select is(
  (
    select count(*)
    from public.activity_events
    where entity_type = 'service_interest'
      and action = 'service_interest.status_changed'
  ),
  2::bigint,
  'each internal status change is written to the audit trail'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.app_set_investment_intent_status(gen_random_uuid(), 'qualified') $$,
  '42501',
  null,
  'a staff session cannot move an intent through the workflow'
);

-- =============================================================================
-- A CLIENT CANNOT UNDO AN INTERNAL DECISION
--
-- Renewed interest is an activity signal, never a workflow reset.
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000005';

select is(
  (
    select status
    from public.app_set_investment_intent_status(
      (select intent_id from public.app_list_investment_intents()
       where company_name = 'Northgate Dental'),
      'closed')
  ),
  'closed',
  'an owner session closes an intent'
);

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], false),
  1,
  'the client removes the closed investment'
);

select is(
  public.app_record_store_interest(array['73000000-0000-0000-0000-000000000001']::uuid[], true),
  1,
  'the client re-adds the closed investment'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (
    select status || '|' || add_count::text
    from public.service_interests
    where company_id = '71000000-0000-0000-0000-00000000000a'
  ),
  'closed|3',
  'a re-add raises the renewed-interest count without reopening a closed intent'
);

-- This remove/re-add happened immediately after the previous renewal, inside
-- the Batch B2 cooldown. The intent state still advanced (add_count is 3
-- above), but Wolf Forge is not told a second time: coalescing protects the
-- work queue without falsifying the interest record.
select is(
  (
    select count(*)
    from public.notifications
    where entity_type = 'service_interest'
      and company_id = '71000000-0000-0000-0000-00000000000a'
  ),
  4::bigint,
  'a re-add inside the cooldown advances the intent without manufacturing a second signal'
);

-- =============================================================================
-- THE STORE ITSELF IS UNCHANGED
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '70000000-0000-0000-0000-000000000001';

select is(
  (
    select count(*)
    from public.services
    where id in (
      '73000000-0000-0000-0000-000000000001',
      '73000000-0000-0000-0000-000000000002',
      '73000000-0000-0000-0000-000000000003',
      '73000000-0000-0000-0000-000000000004'
    )
  ),
  1::bigint,
  'the client still reads only the public, active, non-archived investment'
);

select lives_ok(
  $$ select public.app_require_module_access('portal_store') $$,
  'the client still passes the Store gate'
);

select throws_ok(
  $$ select public.app_require_module_access('investment_intent') $$,
  '42501',
  null,
  'a client session is refused the internal Investment Intent module'
);

select is(
  (
    select count(*)
    from public.app_current_user_modules()
    where module_key = 'investment_intent'
  ),
  0::bigint,
  'the internal Investment Intent module is not even visible to a client'
);

reset role;
set local "request.jwt.claim.sub" = '';

select * from finish();

rollback;
