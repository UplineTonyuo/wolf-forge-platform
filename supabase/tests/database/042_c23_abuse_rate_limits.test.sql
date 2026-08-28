begin;

select plan(58);

-- =============================================================================
-- Security Phase C2-3 — abuse / bot / mutation protection.
--
-- Covers the controls C2-3 owns, across BOTH of its migrations:
--
--   20260824090000_c23_abuse_rate_limits.sql
--     the coupon-probing bound shared by the three coupon oracles, and the
--     wallet invoice-payment rail bound.
--
--   20260825170000_c23_self_service_profile_rate_limits.sql
--     the pre-flight avatar upload claim, the independent persist ceiling, and
--     the shared self-service audit-stream bound.
--
-- Fixtures: two internal owners (so per-actor isolation is provable rather than
-- asserted), one archived internal account, and one client account at a real
-- company (so the coupon oracles are reachable).
--
-- Every burst assertion pre-seeds the exact bucket through the primitive and
-- then makes the real call, so a fixed window cannot roll over mid-assertion
-- and make the suite flaky.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('e1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c23-owner-a@example.invalid', now(), now()),
  ('e1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c23-owner-b@example.invalid', now(), now()),
  ('e1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'c23-archived@example.invalid', now(), now()),
  ('e2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c23-client@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner'), display_name = 'C23 Owner A'
where id = 'e1000000-0000-0000-0000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'owner'), display_name = 'C23 Owner B'
where id = 'e1000000-0000-0000-0000-000000000002';

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    display_name = 'C23 Archived',
    archived_at = now()
where id = 'e1000000-0000-0000-0000-000000000003';

insert into public.companies (id, name, status)
values ('e3000000-0000-0000-0000-00000000000a', 'C23 Client Co', 'client');

update public.profiles
set company_id = 'e3000000-0000-0000-0000-00000000000a',
    display_name = 'C23 Client'
where id = 'e2000000-0000-0000-0000-000000000001';


-- =============================================================================
-- 1. The primitive itself, and the state a browser must never reach.
-- =============================================================================

select has_table('private', 'rate_limit_counters', 'the abuse counter table exists');

select is(
  (select relrowsecurity from pg_class
    where oid = 'private.rate_limit_counters'::regclass),
  true,
  'the abuse counter table has row level security enabled'
);

select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'private'
     and table_name = 'rate_limit_counters'
     and grantee in ('public', 'anon', 'authenticated', 'service_role')),
  0,
  'no browser or server role holds ANY privilege on the abuse counter table'
);

select is(
  (select count(*)::int
   from information_schema.role_routine_grants
   where routine_schema = 'private'
     and routine_name = 'consume_rate_limit'
     and grantee in ('public', 'anon', 'authenticated', 'service_role')),
  0,
  'no browser or server role may EXECUTE the throttle primitive directly'
);

select is(
  (select array_to_string(proconfig, ',') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'consume_rate_limit'),
  'search_path=""',
  'the throttle primitive pins an empty search_path'
);

-- The denial must not name the control that stopped the caller.
do $$
begin
  perform private.consume_rate_limit('c23.probe.leak', 'subject-x', interval '1 hour', 1);
end $$;

select throws_ok(
  $$select private.consume_rate_limit('c23.probe.leak', 'subject-x', interval '1 hour', 1)$$,
  'WF429', 'rate limit exceeded',
  'exceeding a bucket raises WF429 with a message that names no bucket'
);

-- The bucket settles exactly AT the limit. The denied attempt incremented the
-- counter to 2 and then raised, and the raise rolled that increment back with
-- everything else the caller had staged — which is what makes "a throttled
-- request leaves no partial state" true by construction rather than by careful
-- ordering (D-085).
select is(
  (select hits from private.rate_limit_counters
    where scope = 'c23.probe.leak' and subject = 'subject-x'),
  1,
  'the denied attempt rolled its own increment back, leaving the bucket exactly at the limit'
);

-- Independent subjects are independent buckets.
do $$
begin
  perform private.consume_rate_limit('c23.probe.iso', 'subject-a', interval '1 hour', 1);
  perform private.consume_rate_limit('c23.probe.iso', 'subject-b', interval '1 hour', 1);
end $$;

select is(
  (select count(*)::int from private.rate_limit_counters where scope = 'c23.probe.iso'),
  2,
  'two subjects on one scope occupy two independent buckets'
);

-- Independent scopes are independent buckets for the same subject.
do $$
begin
  perform private.consume_rate_limit('c23.probe.scope.one', 'subject-a', interval '1 hour', 1);
  perform private.consume_rate_limit('c23.probe.scope.two', 'subject-a', interval '1 hour', 1);
end $$;

select is(
  (select count(*)::int from private.rate_limit_counters
    where scope in ('c23.probe.scope.one', 'c23.probe.scope.two')
      and subject = 'subject-a'),
  2,
  'one subject on two scopes occupies two independent buckets'
);

-- A misconfigured bucket fails closed rather than silently permitting.
select throws_ok(
  $$select private.consume_rate_limit('c23.probe.bad', '', interval '1 hour', 5)$$,
  '22023', 'invalid rate limit configuration',
  'an empty subject is rejected rather than collapsing every caller into one bucket'
);

select throws_ok(
  $$select private.consume_rate_limit('c23.probe.bad', 'subject-a', interval '1 hour', 0)$$,
  '22023', 'invalid rate limit configuration',
  'a zero limit is rejected rather than treated as unlimited'
);


-- =============================================================================
-- 2. C2-3 recovered migration — the coupon oracles share ONE actor bucket.
--
-- The three coupon surfaces answer whether an admin-created code exists and
-- what it discounts. Rotating between them must not multiply one account's
-- allowance, which is why they name the same scope.
-- =============================================================================

select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_validate_coupon', 'app_quote_store_coupon', 'app_quote_invoice_coupon')
     and p.prosrc like '%coupon.attempt.actor.minute%'),
  3,
  'all three coupon oracles consume the SAME shared per-actor scope'
);

select is(
  (select count(distinct p.prosrc like '%coupon.attempt.actor.day%')::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_validate_coupon', 'app_quote_store_coupon', 'app_quote_invoice_coupon')),
  1,
  'no coupon oracle is missing the day-window ceiling'
);

select is(
  (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_validate_coupon'),
  'v'::"char",
  'app_validate_coupon is VOLATILE, as a function that records counters must be'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_validate_coupon', 'app_quote_store_coupon',
                       'app_quote_invoice_coupon', 'app_pay_invoice_with_wallet')
     and p.prosecdef
     and array_to_string(p.proconfig, ',') = 'search_path=""'),
  4,
  'every C2-3 money/coupon RPC is SECURITY DEFINER with an empty search_path'
);

-- The bound is real, not decorative: an authenticated actor at the ceiling is
-- refused, and refused WITHOUT being told which control stopped them.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.app_validate_coupon('C23-NO-SUCH-CODE', '[]'::jsonb, 0)$$,
  'a coupon probe under the limit is answered normally'
);

reset role;

do $$
declare
  spent integer;
  i integer;
begin
  select coalesce(max(hits), 0) into spent
  from private.rate_limit_counters
  where scope = 'coupon.attempt.actor.minute'
    and subject = 'e2000000-0000-0000-0000-000000000001';

  for i in (spent + 1)..15 loop
    perform private.consume_rate_limit(
      'coupon.attempt.actor.minute', 'e2000000-0000-0000-0000-000000000001',
      interval '1 minute', 15
    );
  end loop;
end $$;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_validate_coupon('C23-NO-SUCH-CODE', '[]'::jsonb, 0)$$,
  'WF429', 'rate limit exceeded',
  'automated coupon-code enumeration is stopped at the ceiling'
);

-- Rotating to a DIFFERENT coupon surface must not buy a fresh allowance.
select throws_ok(
  $$select public.app_quote_store_coupon(
      'e4000000-0000-0000-0000-0000000000ff', 'C23-NO-SUCH-CODE')$$,
  'WF429', 'rate limit exceeded',
  'rotating between coupon surfaces does not multiply one account allowance'
);

reset role;

-- A DIFFERENT actor is untouched by the first actor's exhausted bucket. This is
-- the shared-bucket denial-of-service check: because the subject is the actor
-- id, one account burning its allowance cannot deny the surface to anyone else.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.app_validate_coupon('C23-NO-SUCH-CODE', '[]'::jsonb, 0)$$,
  'a second actor is served normally while the first actor bucket is exhausted'
);

reset role;

select is(
  (select hits from private.rate_limit_counters
    where scope = 'coupon.attempt.actor.minute'
      and subject = 'e1000000-0000-0000-0000-000000000001'),
  1,
  'the second actor spent one unit of its OWN allowance, not a shared one'
);

select is(
  (select hits from private.rate_limit_counters
    where scope = 'coupon.attempt.actor.minute'
      and subject = 'e2000000-0000-0000-0000-000000000001'),
  15,
  'the exhausted account bucket stayed exactly at its limit; the denied calls added nothing'
);


-- =============================================================================
-- 3. C2-3 recovered migration — the wallet payment rail.
--
-- The bound sits AFTER the idempotent replay short-circuit and BEFORE any row
-- lock, so a genuine retry is never punished and a scripted burst of unique
-- request ids never reaches the invoice and wallet locks.
-- =============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_pay_invoice_with_wallet'
     and p.prosrc like '%invoice.pay.actor.minute%'
     and p.prosrc like '%invoice.pay.actor.hour%'),
  1,
  'the wallet payment rail carries both of its frequency bounds'
);

select ok(
  (select position('find_create_request' in prosrc) < position('invoice.pay.actor.minute' in prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_pay_invoice_with_wallet'),
  'the throttle is consumed AFTER the idempotent replay short-circuit, so a retry is never counted'
);

select ok(
  (select position('invoice.pay.actor.minute' in prosrc) < position('for update' in prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_pay_invoice_with_wallet'),
  'the throttle is consumed BEFORE any FOR UPDATE lock is taken'
);

select ok(
  (select position('app_require_module_access' in prosrc) < position('find_create_request' in prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_pay_invoice_with_wallet'),
  'reauthorization still runs before the idempotency lookup, so a replay cannot outlive revoked access'
);

-- Economic truth stays server-derived: neither money rail accepts an amount.
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_pay_invoice_with_wallet'),
  'p_request_id uuid, p_invoice_id uuid, p_coupon_code text DEFAULT NULL::text',
  'the wallet payment rail accepts no browser-supplied amount, discount or total'
);

select ok(
  (select pg_get_function_arguments(p.oid) !~ '(amount|price|discount|total|balance)'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_purchase_service_with_balance'),
  'the Store purchase rail accepts no browser-supplied price, discount or balance'
);

select ok(
  (select prosrc like '%coupon_redemptions%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_purchase_service_with_balance'),
  'the Store purchase rail writes a coupon redemption, so a coupon cannot be replayed for a second discount'
);


-- =============================================================================
-- 4. C2-3 forward migration — self-service profile surface.
-- =============================================================================

select has_function('public', 'app_claim_avatar_upload', 'the pre-flight avatar claim exists');

select is(
  (select count(*)::int from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name = 'app_claim_avatar_upload'
     and grantee = 'authenticated'
     and privilege_type = 'EXECUTE'),
  1,
  'the avatar claim is executable by authenticated sessions'
);

select is(
  (select count(*)::int from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name = 'app_claim_avatar_upload'
     and grantee in ('public', 'anon', 'service_role')),
  0,
  'the avatar claim is not reachable anonymously and needs no server-key path'
);

select is(
  (select array_to_string(proconfig, ',') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_claim_avatar_upload'),
  'search_path=""',
  'the avatar claim pins an empty search_path'
);

-- The claim and the persist ceiling are SEPARATE scopes on purpose: sharing one
-- would make the ordinary two-step flow spend two units per upload.
select ok(
  (select prosrc like '%avatar.upload.claim.actor%' and prosrc not like '%avatar.persist.actor%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_claim_avatar_upload'),
  'the claim consumes only the claim scope'
);

select ok(
  (select prosrc like '%avatar.persist.actor%' and prosrc not like '%avatar.upload.claim.actor%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_set_my_avatar'),
  'the persist RPC consumes only its own independent scope, so skipping the claim is still bounded'
);

-- Unauthorized callers are refused BEFORE any allowance is spent, which is what
-- makes "refused before the expensive side effect" true rather than hopeful.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_claim_avatar_upload()$$,
  '42501', 'verified internal authentication is required',
  'a client-portal account is refused by the claim, before any 5 MB object is written'
);

reset role;

select is(
  (select count(*)::int from private.rate_limit_counters
    where scope like 'avatar.%'
      and subject = 'e2000000-0000-0000-0000-000000000001'),
  0,
  'the refused caller consumed no avatar allowance'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000003';

select throws_ok(
  $$select public.app_claim_avatar_upload()$$,
  '42501', 'verified internal authentication is required',
  'an archived internal account is refused by the claim'
);

reset role;

-- Under the limit, an internal account is served.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.app_claim_avatar_upload()$$,
  'an internal account under the limit may claim an upload'
);

reset role;

select is(
  (select hits from private.rate_limit_counters
    where scope = 'avatar.upload.claim.actor.minute'
      and subject = 'e1000000-0000-0000-0000-000000000001'),
  1,
  'one claim spends exactly one unit'
);

-- Over the limit.
do $$
declare
  spent integer;
  i integer;
begin
  select coalesce(max(hits), 0) into spent
  from private.rate_limit_counters
  where scope = 'avatar.upload.claim.actor.minute'
    and subject = 'e1000000-0000-0000-0000-000000000001';

  for i in (spent + 1)..5 loop
    perform private.consume_rate_limit(
      'avatar.upload.claim.actor.minute', 'e1000000-0000-0000-0000-000000000001',
      interval '1 minute', 5
    );
  end loop;
end $$;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_claim_avatar_upload()$$,
  'WF429', 'rate limit exceeded',
  'storage write amplification is bounded before the bytes are written'
);

reset role;

-- A second internal actor is entirely unaffected: no shared bucket exists here.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.app_claim_avatar_upload()$$,
  'one exhausted account cannot deny avatar uploads to another account'
);

reset role;


-- =============================================================================
-- 5. The shared self-service bound, and the audit stream it protects.
-- =============================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_set_my_avatar', 'app_clear_my_avatar', 'app_update_my_profile')
     and p.prosrc like '%profile.selfservice.actor.minute%'),
  3,
  'all three self-service profile writers share ONE audit-stream bucket'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.app_update_my_profile('C23 Owner B Renamed', true)$$,
  'a self-service profile save under the limit succeeds'
);

reset role;

select is(
  (select count(*)::int from public.activity_events
    where actor_profile_id = 'e1000000-0000-0000-0000-000000000002'
      and action = 'profile.updated'),
  1,
  'the successful save appended exactly one audit row'
);

do $$
declare
  spent integer;
  i integer;
begin
  select coalesce(max(hits), 0) into spent
  from private.rate_limit_counters
  where scope = 'profile.selfservice.actor.minute'
    and subject = 'e1000000-0000-0000-0000-000000000002';

  for i in (spent + 1)..20 loop
    perform private.consume_rate_limit(
      'profile.selfservice.actor.minute', 'e1000000-0000-0000-0000-000000000002',
      interval '1 minute', 20
    );
  end loop;
end $$;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$select public.app_update_my_profile('C23 Flooded', true)$$,
  'WF429', 'rate limit exceeded',
  'audit-stream flooding through the self-service profile writer is bounded'
);

-- Rotating to the sibling writers must not buy a fresh allowance.
select throws_ok(
  $$select public.app_clear_my_avatar()$$,
  'WF429', 'rate limit exceeded',
  'rotating to the avatar clear surface does not multiply the self-service allowance'
);

select throws_ok(
  $$select public.app_set_my_avatar(
      'e1000000-0000-0000-0000-000000000002/photo.webp',
      'http://127.0.0.1:54321/storage/v1/object/public/profile-avatars/x.webp')$$,
  'WF429', 'rate limit exceeded',
  'rotating to the avatar persist surface does not multiply the self-service allowance'
);

reset role;

-- A throttled call leaves no partial state: no audit row, no profile change.
select is(
  (select count(*)::int from public.activity_events
    where actor_profile_id = 'e1000000-0000-0000-0000-000000000002'
      and action = 'profile.updated'),
  1,
  'the throttled save appended no second audit row'
);

select is(
  (select display_name from public.profiles
    where id = 'e1000000-0000-0000-0000-000000000002'),
  'C23 Owner B Renamed',
  'the throttled save did not change the profile'
);

select is(
  (select count(*)::int from public.profiles
    where id = 'e1000000-0000-0000-0000-000000000002'
      and avatar_path is not null),
  0,
  'the throttled avatar persist wrote no avatar pointer'
);


-- =============================================================================
-- 6. Authorization is still the first gate — the throttle never replaces it.
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_set_my_avatar(
      'e1000000-0000-0000-0000-000000000001/stolen.webp',
      'http://127.0.0.1:54321/storage/v1/object/public/profile-avatars/stolen.webp')$$,
  '42501', 'verified internal authentication is required',
  'a client account cannot persist an avatar, and is refused on authorization not on rate'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'e1000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_set_my_avatar(
      'e1000000-0000-0000-0000-000000000002/stolen.webp',
      'http://127.0.0.1:54321/storage/v1/object/public/profile-avatars/stolen.webp')$$,
  '42501', 'an avatar path must be owned by your own account',
  'an internal account cannot aim its avatar at another account folder'
);

select throws_ok(
  $$select public.app_set_my_avatar(
      'e1000000-0000-0000-0000-000000000001/../escape.webp',
      'http://127.0.0.1:54321/storage/v1/object/public/profile-avatars/escape.webp')$$,
  '42501', 'an avatar path must be owned by your own account',
  'a traversal attempt in the avatar path is rejected'
);

reset role;

select is(
  (select coalesce(max(hits), 0)::int from private.rate_limit_counters
    where scope = 'avatar.persist.actor.minute'
      and subject = 'e1000000-0000-0000-0000-000000000001'),
  0,
  'rejected avatar paths spend no allowance, so malformed input cannot drain an honest account'
);

select is(
  (select count(*)::int from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in ('app_set_my_avatar', 'app_clear_my_avatar',
                          'app_update_my_profile', 'app_claim_avatar_upload')
     and grantee in ('anon', 'public')),
  0,
  'no self-service profile RPC is reachable anonymously'
);


-- =============================================================================
-- 7. Anonymous public Form ceilings are still in place and still ordered
--    narrowest-first, so one abusive source cannot starve legitimate traffic.
-- =============================================================================

select ok(
  (select position('form.submit.public.identity.hour' in prosrc)
        < position('form.submit.public.form.minute' in prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_form_submission_rate'),
  'the tight identity bucket is consumed BEFORE the shared per-Form ceiling'
);

select ok(
  (select position('form.submit.public.form.day' in prosrc)
        < position('form.submit.public.global.minute' in prosrc)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_form_submission_rate'),
  'the per-Form ceiling is consumed BEFORE the global anonymous ceiling'
);

-- The authenticated branch returns before the shared anonymous ceilings are
-- reached, so a signed-in submitter can never advance a bucket that anonymous
-- visitors depend on.
select ok(
  (select substr(prosrc, 1, position('return;' in prosrc)) not like '%global%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_form_submission_rate'),
  'the authenticated branch returns before it can touch the shared anonymous ceilings'
);

select * from finish();
rollback;
