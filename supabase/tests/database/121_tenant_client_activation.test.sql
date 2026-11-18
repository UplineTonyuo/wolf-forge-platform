-- WL-2.22c (KI-105 activation slice): the welcome-email record is
-- Tenant-owned, sender authority and recipient class are evaluated in the
-- activation Tenant, the link's host is that Tenant's verified canonical
-- host, and a link only spends on its own Tenant.
--
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...0000000121b1,
-- Tenant C = ...0000000121c1 (has host rows but none verified).
--
-- 2801 B owner only; 2802 B client; 2803 WF owner + B client (dual);
-- 2804 archived B client; 2805 WF client + B client (dual client);
-- 2806 WF client; 2807 C owner only; 2808 C client.
begin;

select plan(49);

insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'tenant-activation-' || n || '@example.invalid', now(), now()
from unnest(array['2801', '2802', '2803', '2804', '2805', '2806', '2807', '2808']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-0000000121b1', 'tenant-activation-b', 'Tenant Activation B', 'active'),
  ('f0f0f0f0-0000-4000-8000-0000000121c1', 'tenant-activation-c', 'Tenant Activation C', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000002801', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'ACTIVATION_B_CLIENT', 'client'),
  ('c0000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121c1', 'ACTIVATION_C_CLIENT', 'client');

insert into public.companies (id, name, status)
values ('c0000000-0000-4000-8000-000000002803', 'ACTIVATION_WF_CLIENT', 'client');

-- Mirror memberships: 2803 becomes a WF owner, 2805 and 2806 WF clients.
update public.profiles set role_id = (select id from public.roles where name = 'owner')
where id = '20000000-0000-4000-8000-000000002803';
update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'c0000000-0000-4000-8000-000000002803',
    display_name = 'Dual Client'
where id = '20000000-0000-4000-8000-000000002805';
update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    company_id = 'c0000000-0000-4000-8000-000000002803',
    display_name = 'WF Client'
where id = '20000000-0000-4000-8000-000000002806';

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class, role.id,
  fixture.company_id::uuid, fixture.archived_at::timestamptz
from (values
  ('f0f0f0f0-0000-4000-8000-0000000121b1', '20000000-0000-4000-8000-000000002801', 'internal', 'owner', null, null),
  ('f0f0f0f0-0000-4000-8000-0000000121b1', '20000000-0000-4000-8000-000000002802', 'client', 'client', 'c0000000-0000-4000-8000-000000002801', null),
  ('f0f0f0f0-0000-4000-8000-0000000121b1', '20000000-0000-4000-8000-000000002803', 'client', 'client', 'c0000000-0000-4000-8000-000000002801', null),
  ('f0f0f0f0-0000-4000-8000-0000000121b1', '20000000-0000-4000-8000-000000002804', 'client', 'client', 'c0000000-0000-4000-8000-000000002801', '2026-10-01'),
  ('f0f0f0f0-0000-4000-8000-0000000121b1', '20000000-0000-4000-8000-000000002805', 'client', 'client', 'c0000000-0000-4000-8000-000000002801', null),
  ('f0f0f0f0-0000-4000-8000-0000000121c1', '20000000-0000-4000-8000-000000002807', 'internal', 'owner', null, null),
  ('f0f0f0f0-0000-4000-8000-0000000121c1', '20000000-0000-4000-8000-000000002808', 'client', 'client', 'c0000000-0000-4000-8000-000000002802', null)
) as fixture(tenant_id, profile_id, account_class, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.tenant_domains (host, tenant_id, verified_at, disabled_at)
values
  ('activation-b.test', 'f0f0f0f0-0000-4000-8000-0000000121b1', now(), null),
  ('unverified-b.test', 'f0f0f0f0-0000-4000-8000-0000000121b1', null, null),
  ('disabled-b.test', 'f0f0f0f0-0000-4000-8000-0000000121b1', now(), now()),
  ('unverified-c.test', 'f0f0f0f0-0000-4000-8000-0000000121c1', null, null),
  ('disabled-c.test', 'f0f0f0f0-0000-4000-8000-0000000121c1', now(), now());

-- Shape and lock-down.
select col_is_pk('private', 'client_welcome_emails', array['profile_id', 'tenant_id'],
  'the welcome record is one row per profile per Tenant');
select fk_ok('private', 'client_welcome_emails', 'tenant_id', 'public', 'tenants', 'id');
select col_not_null('private', 'client_welcome_emails', 'tenant_id', 'tenant_id is required');
select ok(not has_function_privilege('service_role', 'private.profile_has_permission_in_tenant(uuid,uuid,text)', 'EXECUTE'),
  'the parameterized permission check is not directly callable');
select ok(not has_function_privilege('service_role', 'private.require_client_welcome_sender(uuid,uuid)', 'EXECUTE'),
  'the sender check is not directly callable');
select ok(
  not exists (
    select 1 from pg_proc as proc join pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'private' and proc.proname = 'require_client_welcome_sender'
      and pg_get_function_identity_arguments(proc.oid) = 'uuid'
  ),
  'the old Wolf-Forge-only sender check does not linger'
);

-- The existing permission evaluation wrapper keeps its identity_tenant_id()
-- context: as the postgres test role that is the Wolf Forge mirror.
select is(private.profile_has_permission('20000000-0000-4000-8000-000000002803', 'client_private.manage'), true,
  'profile_has_permission still resolves the Wolf Forge context');
select is(private.profile_has_permission('20000000-0000-4000-8000-000000002801', 'client_private.manage'), false,
  'a Tenant-B-only member has no permission in the Wolf Forge context');

set local role service_role;

select results_eq(
  $$select outcome, recipient_email, recipient_name, canonical_host from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5300000-0000-4000-8000-000000002801', repeat('a', 64))$$,
  $$values ('claimed'::text, 'tenant-activation-2802@example.invalid'::text, null::text, 'activation-b.test'::text)$$,
  'a Tenant B owner claims in Tenant B and gets Tenant B''s verified canonical host'
);
select is(public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002811'),
  '20000000-0000-4000-8000-000000002802'::uuid, 'the Tenant B link resolves in Tenant B');
select ok(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002811', 'weak_password'),
  'a confirmed password rejection releases this claim');

select results_eq(
  $$select outcome, recipient_email, canonical_host from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002803', '20000000-0000-4000-8000-000000002806', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000002802', repeat('b', 64))$$,
  $$values ('claimed'::text, 'tenant-activation-2806@example.invalid'::text, 'services.wolfforgedigitalagency.com'::text)$$,
  'a Wolf Forge owner claims in Wolf Forge and gets the Wolf Forge canonical host'
);
select is(public.app_server_claim_client_activation(repeat('b', 64), 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000002812'),
  '20000000-0000-4000-8000-000000002806'::uuid, 'the Wolf Forge link resolves in Wolf Forge');
select ok(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002806', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000002812', 'weak_password'),
  'a confirmed password rejection releases this claim');

select ok(
  public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()) is null
    and public.app_server_claim_client_activation(repeat('b', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid()) is null,
  'a Tenant B link never resolves in Wolf Forge, nor a Wolf Forge link in Tenant B'
);

-- A dual-Tenant identity owns one record per Tenant, each with its own link.
select is(
  (select outcome from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002803', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5300000-0000-4000-8000-000000002803', repeat('c', 64))),
  'claimed', 'the dual identity claims its Tenant B link independently'
);
reset role;
select is(
  (select count(*) from private.client_welcome_emails where profile_id = '20000000-0000-4000-8000-000000002803'),
  1::bigint, 'the dual identity''s Tenant B record stays separate from any other Tenant'
);
set local role service_role;
select is(public.app_server_claim_client_activation(repeat('c', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()), null::uuid,
  'the dual identity''s Tenant B link does not resolve in Wolf Forge');

-- A client in BOTH Tenants still owns two links, and each spends only on its
-- own Tenant's host, even though the membership check alone would pass.
select is(
  (select outcome from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002805', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5300000-0000-4000-8000-000000002805', repeat('e', 64))),
  'claimed', 'a dual client claims its Tenant B link independently'
);
select is(public.app_server_claim_client_activation(repeat('e', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002813'),
  '20000000-0000-4000-8000-000000002805'::uuid, 'the dual client''s Tenant B link resolves in Tenant B');
select ok(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002805', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002813', 'weak_password'),
  'a confirmed password rejection releases this claim');
select is(public.app_server_claim_client_activation(repeat('e', 64), 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid()), null::uuid,
  'the dual client''s Tenant B link does not resolve in Wolf Forge even though the client exists there too');

-- A membership archived after the send kills the link too: find re-checks it.
reset role;
update public.tenant_memberships set archived_at = now()
where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000121b1'
  and profile_id = '20000000-0000-4000-8000-000000002805';
set local role service_role;
select is(public.app_server_claim_client_activation(repeat('e', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid()), null::uuid,
  'a link stops resolving when the client membership is archived after the send');

select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'a Tenant-B-only sender cannot claim in Wolf Forge'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002803', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-000000000001', gen_random_uuid(), repeat('f', 64))$$,
  'P0002', null, 'a Wolf Forge sender cannot welcome a Tenant-B-only client in Wolf Forge'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002808', 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid(), repeat('f', 64))$$,
  'P0002', null, 'a Tenant B sender cannot welcome a Tenant-C-only client in Tenant B'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002804', 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid(), repeat('f', 64))$$,
  'P0002', null, 'an archived membership is never a welcome recipient'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', null::uuid, gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'an absent Tenant fails closed'
);
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-000000009999', gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'an unknown Tenant fails closed'
);

-- No verified host: the send is refused and nothing is written.
select is(
  (select outcome from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002807', '20000000-0000-4000-8000-000000002808', 'f0f0f0f0-0000-4000-8000-0000000121c1', 'e5300000-0000-4000-8000-000000002804', repeat('d', 64))),
  'no_verified_host', 'a Tenant whose hosts are unverified or disabled sends nothing'
);
reset role;
select is(
  (select count(*) from private.client_welcome_emails where profile_id = '20000000-0000-4000-8000-000000002808'),
  0::bigint, 'the refused claim wrote no record and no link'
);

update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-0000000121c1';
set local role service_role;

select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002807', '20000000-0000-4000-8000-000000002808', 'f0f0f0f0-0000-4000-8000-0000000121c1', gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'a suspended Tenant refuses the claim'
);

-- The finish is bound to the claimed Tenant.
select lives_ok(
  $$select public.app_server_finish_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5300000-0000-4000-8000-000000002801', null)$$,
  'a finish under the wrong Tenant changes nothing'
);
reset role;
select is(
  (select status from private.client_welcome_emails where profile_id = '20000000-0000-4000-8000-000000002802' and tenant_id = 'f0f0f0f0-0000-4000-8000-0000000121b1'),
  'sending', 'the Tenant B record is untouched by a Wolf Forge finish'
);
set local role service_role;
select lives_ok(
  $$select public.app_server_finish_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5300000-0000-4000-8000-000000002801', null)$$,
  'the finish under the claimed Tenant records the send'
);

-- Expiry and replay stay enforced per Tenant.
reset role;
update private.client_welcome_emails set activation_expires_at = now() - interval '1 second'
where profile_id = '20000000-0000-4000-8000-000000002802';
set local role service_role;
select is(public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid()), null::uuid,
  'an expired Tenant B link resolves to nothing');
reset role;
update private.client_welcome_emails
set activation_expires_at = now() + interval '1 day', sent_at = now() - interval '5 minutes'
where profile_id = '20000000-0000-4000-8000-000000002802';
set local role service_role;
select is(public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002814'),
  '20000000-0000-4000-8000-000000002802'::uuid, 'the unexpired link can reserve activation');
select is(public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid()),
  null::uuid, 'a reserved link cannot be claimed again before completion');
select is(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid(), 'activated'),
  false, 'an unrelated claim cannot complete activation');
select is(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-000000000001', 'e5400000-0000-4000-8000-000000002814', 'weak_password'),
  false, 'a different Tenant cannot release the reservation');
select is(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002814', 'unknown'),
  false, 'an uncertain Auth result cannot release the reservation');
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid(), repeat('f', 64))$$,
  '55000', null, 'a resend cannot replace a reserved link'
);
select ok(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002814', 'activated'),
  'the matching claim completes activation');
select ok(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002814', 'activated'),
  'completion for the same claim confirms the committed result');
select is(public.app_server_finish_client_activation('20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', 'e5400000-0000-4000-8000-000000002814', 'weak_password'),
  false, 'a confirmed activation cannot be released');
select is(public.app_server_claim_client_activation(repeat('a', 64), 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid()), null::uuid,
  'a spent Tenant B link cannot be used again');

reset role;
select is(to_regprocedure('public.app_server_find_client_activation(text,uuid)'), null::regprocedure,
  'the earlier lookup RPC cannot authorize an unclaimed password write');
select is(to_regprocedure('public.app_server_complete_client_activation(uuid,text)'), null::regprocedure,
  'the earlier completion RPC cannot spend a claim');
update public.tenants set status = 'archived', archived_at = now()
where id = 'f0f0f0f0-0000-4000-8000-0000000121b1';
set local role service_role;
select throws_ok(
  $$select * from public.app_server_claim_client_welcome_email('20000000-0000-4000-8000-000000002801', '20000000-0000-4000-8000-000000002802', 'f0f0f0f0-0000-4000-8000-0000000121b1', gen_random_uuid(), repeat('f', 64))$$,
  '42501', null, 'an archived Tenant refuses the claim'
);

select * from finish();
rollback;
