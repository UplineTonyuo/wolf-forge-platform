begin;

select plan(38);

-- =============================================================================
-- Security Phase C2-5 — durable security audit trail.
--
-- Covers supabase/migrations/20260826120000_c25_durable_security_audit.sql:
--
--   * the seeded auditable-code vocabulary (the database half of the C2-4
--     taxonomy selection),
--   * the privilege boundary: service_role may APPEND and nothing more; no
--     browser role may do anything at all,
--   * append-only enforcement against every role including the table owner,
--   * the shape constraints that make hostile or malformed rows unpersistable,
--   * the referential SET NULL carve-out that keeps profile deletion working.
--
-- Fixtures: one throwaway internal profile whose deletion proves the FK
-- carve-out. Audit rows themselves carry no PII beyond server-derived UUIDs.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('c2500000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c25-target@example.invalid', now(), now()),
  ('c2500000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c25-actor@example.invalid', now(), now());

-- =============================================================================
-- A. Structure and the canonical auditable vocabulary
-- =============================================================================

select has_table(
  'public'::name, 'security_audit_events'::name,
  'the durable audit table exists'
);

select is(
  (select relrowsecurity from pg_class
    where oid = 'public.security_audit_events'::regclass),
  true,
  'row level security is enabled on the audit table'
);

select is(
  (select count(*) from private.security_audit_event_codes),
  9::bigint,
  'exactly nine codes are selected as auditable'
);

select is(
  (select count(*) from private.security_audit_event_codes
    where event_code in (
      'auth.password.changed',
      'auth.login.unassigned',
      'authorization.context.denied',
      'authorization.team_supervision.read',
      'authorization.white_label.draft_saved',
      'integration.gmail.connected',
      'integration.gmail.disconnected',
      'integration.gmail.reauthorization_required',
      'integration.gmail.disconnect_failed'
    )),
  9::bigint,
  'the seeded vocabulary matches SECURITY_AUDIT_EVENT_CODES exactly'
);

select is(
  (select severity from private.security_audit_event_codes
    where event_code = 'integration.gmail.disconnect_failed'),
  'error',
  'severity travels with the code, matching the C2-4 definition'
);

-- =============================================================================
-- B. Privilege boundary
--
-- The whole model: service_role appends, nobody reads back, nobody edits.
-- =============================================================================

select is(
  has_table_privilege('authenticated', 'public.security_audit_events', 'INSERT'),
  false,
  'the browser role holds no INSERT on the audit trail'
);

select is(
  has_table_privilege('authenticated', 'public.security_audit_events', 'SELECT'),
  false,
  'the browser role holds no SELECT on the audit trail'
);

select is(
  has_table_privilege('authenticated', 'public.security_audit_events', 'UPDATE'),
  false,
  'the browser role holds no UPDATE on the audit trail'
);

select is(
  has_table_privilege('authenticated', 'public.security_audit_events', 'DELETE'),
  false,
  'the browser role holds no DELETE on the audit trail'
);

select is(
  has_table_privilege('authenticated', 'public.security_audit_events', 'TRUNCATE'),
  false,
  'the browser role holds no TRUNCATE on the audit trail'
);

select is(
  has_table_privilege('anon', 'public.security_audit_events', 'INSERT'),
  false,
  'the anonymous role holds no INSERT on the audit trail'
);

select is(
  has_table_privilege('anon', 'public.security_audit_events', 'SELECT'),
  false,
  'the anonymous role holds no SELECT on the audit trail'
);

select is(
  has_table_privilege('service_role', 'public.security_audit_events', 'INSERT'),
  true,
  'the trusted server writer holds INSERT'
);

select is(
  has_table_privilege('service_role', 'public.security_audit_events', 'SELECT'),
  false,
  'even the trusted writer cannot read audit rows back through the Data API'
);

select is(
  has_table_privilege('service_role', 'public.security_audit_events', 'UPDATE'),
  false,
  'even the trusted writer holds no UPDATE'
);

select is(
  has_table_privilege('service_role', 'public.security_audit_events', 'DELETE'),
  false,
  'even the trusted writer holds no DELETE'
);

select is(
  has_table_privilege('service_role', 'public.security_audit_events', 'TRUNCATE'),
  false,
  'even the trusted writer holds no TRUNCATE'
);

-- =============================================================================
-- C. Behaviour under each role
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2500000-0000-0000-0000-000000000001';

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_profile_id, actor_class, outcome)
    values ('auth.password.changed', 'c2500000-0000-0000-0000-000000000001', 'self_service', 'succeeded')$$,
  '42501', null,
  'a browser session cannot forge a durable audit row directly'
);

select throws_ok(
  $$select count(*) from public.security_audit_events$$,
  '42501', null,
  'a browser session cannot read the audit trail at all'
);

reset role;

set local role service_role;

insert into public.security_audit_events (
  event_code, actor_profile_id, actor_class, action_slug, provider, outcome,
  correlation_id, metadata
) values (
  'integration.gmail.connected',
  null,
  'internal',
  'integration.gmail.callback',
  'google',
  'succeeded',
  repeat('a', 32),
  '{"lifecycle_step":"callback"}'::jsonb
);

reset role;

-- Counts are taken back as the operator: the writer deliberately cannot read
-- what it wrote, which the privilege assertions above already established.
select is(
  (select count(*) from public.security_audit_events where correlation_id = repeat('a', 32)),
  1::bigint,
  'the trusted writer can append'
);

select ok(
  (select occurred_at > now() - interval '5 seconds'
    from public.security_audit_events where correlation_id = repeat('a', 32)),
  'occurred_at is forced to database time regardless of caller'
);

-- The shape constraints, each proving a hostile or malformed row cannot land.

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome)
    values ('auth.login.failed', 'anonymous', 'denied')$$,
  '23503', null,
  'a LOG ONLY code is unpersistable: the vocabulary foreign key refuses it'
);

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome, metadata)
    values ('auth.password.changed', 'system', 'succeeded', '{"access_token":"ya29.nonsense"}'::jsonb)$$,
  '23514', null,
  'credential-shaped metadata keys are refused outright'
);

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome, metadata)
    values ('auth.password.changed', 'system', 'succeeded', '{"nested":{"client_secret":"x"}}'::jsonb)$$,
  '23514', null,
  'credential-shaped keys are refused at depth'
);

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome, metadata)
    values ('auth.password.changed', 'system', 'succeeded', '{"state":"oauth-state-value"}'::jsonb)$$,
  '23514', null,
  'OAuth artifacts are refused as exact-match metadata keys'
);

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome, correlation_id)
    values ('auth.password.changed', 'system', 'succeeded', 'NOT-A-CORRELATION-ID')$$,
  '23514', null,
  'a malformed correlation id cannot enter the durable trail'
);

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome)
    values ('auth.password.changed', 'superuser', 'succeeded')$$,
  '23514', null,
  'an invented actor class cannot enter the durable trail'
);

select throws_ok(
  $$insert into public.security_audit_events (event_code, actor_class, outcome)
    values ('auth.password.changed', 'system', 'partially')$$,
  '23514', null,
  'an invented outcome cannot enter the durable trail'
);

select throws_ok(
  $$insert into public.security_audit_events
    (event_code, actor_class, outcome, resource_type, resource_id)
    values ('authorization.context.denied', 'client', 'denied', 'surface', null)$$,
  '23514', null,
  'half of a resource identity cannot enter the durable trail'
);

reset role;

-- =============================================================================
-- D. Append-only, against every role including the owner
-- =============================================================================

select throws_ok(
  $$update public.security_audit_events set outcome = 'failed'$$,
  '55000', 'security audit events are append-only',
  'the table owner cannot rewrite history either'
);

select throws_ok(
  $$delete from public.security_audit_events$$,
  '55000', 'security audit events are append-only',
  'the table owner cannot delete audit rows'
);

select throws_ok(
  $$truncate table public.security_audit_events$$,
  '55000', 'security audit events are append-only',
  'truncate is guarded separately because it skips row triggers'
);

-- =============================================================================
-- E. Profile deletion still works: the FK SET NULL carve-out
--
-- Audited actors can be de-provisioned. The referential action runs nested
-- (trigger depth 2) and may clear ONLY the actor columns; the guard allows
-- exactly that and nothing else.
-- =============================================================================

set local role service_role;

insert into public.security_audit_events (
  event_code, actor_profile_id, actor_class, target_actor_id, action_slug, outcome
) values (
  'authorization.context.denied',
  'c2500000-0000-0000-0000-000000000002',
  'internal',
  'c2500000-0000-0000-0000-000000000001',
  'context.resolve',
  'denied'
);

reset role;

delete from public.profiles
where id = 'c2500000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.security_audit_events
    where event_code = 'authorization.context.denied'),
  1::bigint,
  'de-provisioning an audited account does not destroy the record of what happened'
);

select is(
  (select target_actor_id from public.security_audit_events
    where event_code = 'authorization.context.denied'),
  null,
  'only the actor reference clears, through the declared referential action'
);

select throws_ok(
  $$update public.security_audit_events set metadata = '{"forged":true}'::jsonb
    where event_code = 'authorization.context.denied'$$,
  '55000', 'security audit events are append-only',
  'and the surviving row still cannot be edited by anyone'
);

-- =============================================================================
-- F. Policy inventory
-- =============================================================================

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'security_audit_events'),
  1::bigint,
  'exactly one row level security policy exists'
);

select ok(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'security_audit_events'
      and policyname = 'security_audit_events_service_insert'
      and cmd = 'INSERT'
      and roles = '{service_role}') = 1,
  'the only policy is the trusted-writer INSERT rule'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'security_audit_events'
      and privilege_type in ('SELECT', 'UPDATE', 'DELETE', 'TRUNCATE')
      and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role holds any read, edit or wipe privilege in the ACL either'
);

select * from finish();
rollback;
