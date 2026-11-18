-- Client welcome email (KI-091): sender authority, idempotent claim, link stored before the send, single-use activation link.
-- WL-2.22c: the claim and finish RPCs take the activation Tenant; this suite
-- exercises the Wolf Forge Tenant only, so every Wolf Forge behavior this
-- feature ever had stays under test while 121 covers the Tenant dimensions.
begin;

select plan(37);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('e5100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'welcome-owner@example.invalid', now(), now()),
  ('e5100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'welcome-no-gmail@example.invalid', now(), now()),
  ('e5100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'welcome-no-clients@example.invalid', now(), now()),
  ('e5100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'welcome-client@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'owner'), company_id = null
where id = 'e5100000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'admin'), company_id = null
where id in ('e5100000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000003');

-- Each admin lacks exactly one of the two authorities a send needs.
insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values
  ('e5100000-0000-4000-8000-000000000002', 'integrations.manage', false),
  ('e5100000-0000-4000-8000-000000000003', 'client_private.manage', false);

insert into public.companies (id, name, status)
values ('e5200000-0000-4000-8000-000000000001', 'Welcome Client Co', 'client');

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'e5200000-0000-4000-8000-000000000001',
    display_name = 'Welcome Client'
where id = 'e5100000-0000-4000-8000-000000000004';

select has_table('private', 'client_welcome_emails', 'welcome delivery table exists');
select ok(not has_table_privilege('authenticated', 'private.client_welcome_emails', 'SELECT'), 'browser roles cannot read welcome rows or link hashes');
select ok(not has_function_privilege('authenticated', 'public.app_server_claim_client_welcome_email(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated cannot claim a welcome send');
select ok(not has_function_privilege('anon', 'public.app_server_claim_client_activation(text,uuid,uuid)', 'EXECUTE'), 'anonymous callers cannot probe activation links');
select ok(not has_function_privilege('authenticated', 'public.app_server_finish_client_activation(uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated cannot complete an activation');
select ok(has_function_privilege('service_role', 'public.app_server_finish_client_welcome_email(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'the trusted server can record a send result');

set local role service_role;

select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'client administration without integrations.manage cannot send'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000003', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'integrations.manage without client_private.manage cannot send'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000003', 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('f', 64))$$,
  'P0002', null, 'an internal account is never a welcome recipient'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), null)$$,
  '22023', null, 'a send cannot be claimed without its link hash'
);

select results_eq(
  $$select outcome, recipient_email, recipient_name, canonical_host from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000001', repeat('a', 64))$$,
  $$values ('claimed'::text, 'welcome-client@example.invalid'::text, 'Welcome Client'::text, 'services.wolfforgedigitalagency.com'::text)$$,
  'an authorized sender claims the first send and receives the login email and the Wolf Forge canonical host'
);
select is(
  public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000001'), 'e5100000-0000-4000-8000-000000000004'::uuid,
  'the link works from the claim on, so a delivered email never depends on a later write'
);
select ok(public.app_server_finish_client_activation('e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000001', 'weak_password'),
  'a confirmed password rejection releases this claim');
select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000002', repeat('b', 64))),
  'in_progress', 'a second send is refused while the first is in flight'
);
select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000001', repeat('b', 64))),
  'in_progress', 'the same request reports its in-flight state instead of sending again'
);

select lives_ok(
  $$select public.app_server_finish_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000001', null)$$,
  'the accepted send is recorded'
);
select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000003', repeat('c', 64))),
  'recently_sent', 'a new send right after a success is refused'
);
select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000001', repeat('c', 64))),
  'sent', 'replaying the delivered request reports sent without a second email'
);
select ok(
  public.app_server_claim_client_activation(repeat('b', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()) is null
    and public.app_server_claim_client_activation(repeat('c', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()) is null
    and public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000002') = 'e5100000-0000-4000-8000-000000000004',
  'refused and replayed claims store no link and leave the live one alone'
);
select ok(public.app_server_finish_client_activation('e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000002', 'weak_password'),
  'a confirmed password rejection releases this claim');

reset role;
update private.client_welcome_emails set sent_at = now() - interval '5 minutes'
where profile_id = 'e5100000-0000-4000-8000-000000000004';
set local role service_role;

select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000004', repeat('d', 64))),
  'claimed', 'a deliberate resend is allowed after the cooldown'
);
select ok(
  public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()) is null
    and public.app_server_claim_client_activation(repeat('d', 64), 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000003') = 'e5100000-0000-4000-8000-000000000004',
  'a resend replaces the earlier link as soon as it is claimed'
);
select ok(public.app_server_finish_client_activation('e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000003', 'weak_password'),
  'a confirmed password rejection releases this claim');
select lives_ok(
  $$select public.app_server_finish_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000004', 'gmail_delivery_failed')$$,
  'a failed resend is recorded'
);
select is(
  public.app_server_claim_client_activation(repeat('d', 64), 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000004'), 'e5100000-0000-4000-8000-000000000004'::uuid,
  'a failed send keeps its link, since Gmail may still have delivered it'
);
select ok(public.app_server_finish_client_activation('e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000004', 'weak_password'),
  'a confirmed password rejection releases this claim');

reset role;
select is(
  (select status || ':' || send_count from private.client_welcome_emails where profile_id = 'e5100000-0000-4000-8000-000000000004'),
  'failed:1', 'the record shows the failure and one accepted email'
);
-- A send that never recorded its result: the lease outlives any request (Vercel maxDuration 300s).
update private.client_welcome_emails
set status = 'sending', request_id = 'e5300000-0000-4000-8000-000000000005', claimed_at = now() - interval '9 minutes'
where profile_id = 'e5100000-0000-4000-8000-000000000004';
set local role service_role;

select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000006', repeat('e', 64))),
  'in_progress', 'an unfinished send still holds its lease after 9 minutes'
);
select lives_ok(
  $$select public.app_server_finish_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000006', null)$$,
  'a finish for a claim that was refused changes nothing'
);

reset role;
select is(
  (select status || ':' || request_id from private.client_welcome_emails where profile_id = 'e5100000-0000-4000-8000-000000000004'),
  'sending:e5300000-0000-4000-8000-000000000005', 'the in-flight claim still owns the row'
);
update private.client_welcome_emails set claimed_at = now() - interval '11 minutes'
where profile_id = 'e5100000-0000-4000-8000-000000000004';
set local role service_role;

select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000007', repeat('e', 64))),
  'claimed', 'a lease older than any request can live is taken over'
);

reset role;
update private.client_welcome_emails set activation_expires_at = now() - interval '1 second'
where profile_id = 'e5100000-0000-4000-8000-000000000004';
set local role service_role;

select is(public.app_server_claim_client_activation(repeat('e', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()), null::uuid, 'an expired link resolves to nothing');

reset role;
update private.client_welcome_emails set activation_expires_at = now() + interval '1 day'
where profile_id = 'e5100000-0000-4000-8000-000000000004';
set local role service_role;

select is(public.app_server_claim_client_activation(repeat('e', 64), 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000005'),
  'e5100000-0000-4000-8000-000000000004'::uuid, 'the unexpired link can reserve activation');
select ok(public.app_server_finish_client_activation('e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000000005', 'activated'),
  'the matching claim completes activation');
select is(public.app_server_claim_client_activation(repeat('e', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()), null::uuid, 'a used link cannot be used again');
select is(
  (select outcome from public.app_server_claim_client_welcome_email('e5100000-0000-4000-8000-000000000001', 'e5100000-0000-4000-8000-000000000004', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000000008', repeat('f', 64))),
  'activated', 'no welcome email is sent once the client has set a password'
);
select is(public.app_server_claim_client_activation(repeat('f', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()), null::uuid, 'the refused claim after activation stored no link');

select * from finish();
rollback;
