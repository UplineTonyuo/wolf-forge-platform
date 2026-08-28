-- =============================================================================
-- Security Phase C2-5 — durable security audit trail.
--
-- C2-4 gave every security signal one structured, correlated LOG line and no
-- durable storage. This migration adds the deliberately small durable layer:
-- public.security_audit_events, an append-only table holding ONLY the signals
-- that change authority, access, external credential state or money
-- capability, plus authenticated cross-surface attempts.
--
-- WHY public AND NOT private FOR THE EVENTS TABLE: the platform keeps API
-- roles out of the private schema entirely (no USAGE for service_role; Gmail
-- RPCs are SECURITY DEFINER precisely so service_role never resolves private
-- objects). The trusted writer holds SUPABASE_SECRET_KEY and inserts through
-- PostgREST, so the events table must live where that role already has USAGE.
-- Placement therefore carries no access meaning here — every object below is
-- fully revoked and the boundary is stated purely through grants, RLS,
-- triggers and constraints. Only the two support objects stay private: the
-- code vocabulary (FK target, never referenced by writers) and the metadata
-- safety checker (one narrow EXECUTE grant, the same pattern as
-- private.is_internal_user() in the initial schema).
--
-- WHY A SECOND TABLE AND NOT public.activity_events (asked and answered):
--
-- public.activity_events is the OPERATIONAL activity stream. It is readable by
-- every internal user through scoped RLS, it renders in product timelines, its
-- rows require human prose (`summary`), and its entity/action vocabulary is
-- operational (company.*, order.*, invoice.*, ...). C2-5 audited it thoroughly
-- rather than assuming: its append-only invariants are strong (D-083 — no
-- browser INSERT since B1; mutation-blocking triggers; grant matrix), and this
-- migration copies those invariants rather than weakening them.
--
-- The audit trail has different requirements that activity_events cannot meet
-- without a breaking reshape of every existing consumer:
--
--   1. READ BOUNDARY. Security rows name who was denied, whose credentials
--      changed, which account was de-provisioned. That is more sensitive than
--      "Updated their profile photo." This table starts with NO read path for
--      any API role at all; investigations query it as an operator, and any
--      future product surface must earn its own gated RPC.
--   2. SHAPE. Audit needs typed event_code / outcome / actor_class /
--      correlation_id columns for investigation queries, not jsonb convention.
--   3. VOCABULARY. Codes come from src/domain/security/event-codes.ts via the
--      seeded lookup below — there is no second taxonomy, and nothing can be
--      persisted under a code that was not deliberately selected as auditable.
--
-- Nothing operational moves. No existing writer, reader, policy or grant on
-- public.activity_events is touched.
--
-- WHAT IS DELIBERATELY NOT HERE:
--
--   * Hash chaining / cryptographic tamper evidence. The threat model is
--     application-level editing by ordinary roles, and strict privileges plus
--     statement triggers close that completely. Chaining would add key
--     management and rewrite semantics for an attacker that would need
--     superuser first — at which point the database is already lost.
--   * Retention/deletion jobs. Volume is tiny (see comments at the end); a
--     retention period is a product/legal decision, not something to invent in
--     a migration. No existing data is deleted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The canonical codes eligible for persistence.
--
-- Mirrors SECURITY_AUDIT_EVENT_CODES in src/domain/security/audit.ts. The FK on
-- the events table makes "durable rows use canonical C2-4 codes" a DATABASE
-- invariant: a typo, a drift or a bypassed writer cannot insert an unknown or
-- not-selected code. Adding an auditable code later is a deliberate act in BOTH
-- places, enforced by tests on each side.
-- -----------------------------------------------------------------------------

create table private.security_audit_event_codes (
  event_code text primary key,
  category text not null,
  severity text not null check (severity in ('info', 'warn', 'error'))
);

insert into private.security_audit_event_codes (event_code, category, severity) values
  ('auth.password.changed',                      'authentication', 'info'),
  ('auth.login.unassigned',                      'authentication', 'warn'),
  ('authorization.context.denied',               'authorization',  'warn'),
  ('integration.gmail.connected',                'integration',    'info'),
  ('integration.gmail.disconnected',             'integration',    'info'),
  ('integration.gmail.reauthorization_required', 'integration',    'warn'),
  ('integration.gmail.disconnect_failed',        'integration',    'error');

revoke all on table private.security_audit_event_codes
  from public, anon, authenticated, service_role;

comment on table private.security_audit_event_codes is
  'The security event codes selected for durable audit (Security C2-5). Mirrors SECURITY_AUDIT_EVENT_CODES in src/domain/security/audit.ts; the foreign key on security_audit_events makes non-canonical or log-only codes unpersistable.';

-- -----------------------------------------------------------------------------
-- 2. Metadata safety — the database backstop behind the TypeScript sanitizer.
--
-- buildSecurityAuditRow() already drops secret-shaped keys and scrubs values.
-- This checker is the independent second control for a writer that bypassed
-- the builder: any metadata carrying a credential-shaped KEY NAME is refused
-- outright, mirroring SENSITIVE_KEY_FRAGMENTS in src/domain/security/redaction.ts.
-- Values are never inspected — like the redactor, the key name alone decides.
-- -----------------------------------------------------------------------------

create or replace function private.security_audit_metadata_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
-- SECURITY DEFINER because the CHECK constraint invokes this under the
-- INSERTING role: an invoker-rights body could not resolve its own recursive
-- call without granting that role blanket access to the private schema. The
-- definer body traverses jsonb only — no SQL is composed from its input —
-- so running as the owner widens nothing.
declare
  metadata_key text;
  metadata_value jsonb;
begin
  if p_value is null then
    return true;
  end if;

  if pg_catalog.jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;

  for metadata_key, metadata_value in
    select entry.key, entry.value
    from pg_catalog.jsonb_each(p_value) as entry(key, value)
  loop
    if metadata_key ~* '(password|passphrase|secret|token|jwt|authorization|auth_?header|cookie|credential|api_?key|private_?key|signature|bearer|session|verifier|challenge|nonce|otp|salt|service_?role|anon_?key|publishable)' then
      return false;
    end if;

    if metadata_key in ('code', 'state', 'key', 'pin', 'hash', 'body', 'payload', 'headers', 'raw') then
      return false;
    end if;

    if pg_catalog.jsonb_typeof(metadata_value) = 'object'
      and not private.security_audit_metadata_is_safe(metadata_value)
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.security_audit_metadata_is_safe(jsonb)
  from public, anon, authenticated, service_role;

-- The events table's CHECK constraint invokes this helper under the INSERTING
-- role, so the one trusted writer needs EXECUTE for its own insert to pass.
-- It answers a single boolean about key names and exposes nothing else.
grant execute on function private.security_audit_metadata_is_safe(jsonb)
  to service_role;

comment on function private.security_audit_metadata_is_safe(jsonb) is
  'Database-side defence against credential material in permanent audit rows. Refuses any object whose keys carry a secret-shaped name at any depth. The application sanitizer is the primary control; this one catches writers that bypass it.';

-- -----------------------------------------------------------------------------
-- 3. The audit stream itself.
-- -----------------------------------------------------------------------------

create table public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_code text not null references private.security_audit_event_codes (event_code),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_class text not null,
  action_slug text,
  resource_type text,
  resource_id uuid,
  target_actor_id uuid references public.profiles (id) on delete set null,
  provider text,
  outcome text not null,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,

  constraint security_audit_events_actor_class_valid check (
    actor_class in ('internal', 'client', 'self_service', 'system', 'anonymous')
  ),
  constraint security_audit_events_outcome_valid check (
    outcome in ('succeeded', 'denied', 'failed')
  ),
  constraint security_audit_events_action_slug_shape check (
    action_slug is null or action_slug ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  constraint security_audit_events_resource_type_shape check (
    resource_type is null or resource_type ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  constraint security_audit_events_provider_shape check (
    provider is null or provider ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  constraint security_audit_events_correlation_shape check (
    correlation_id is null or correlation_id ~ '^[0-9a-f]{32}$'
  ),
  constraint security_audit_events_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint security_audit_events_metadata_is_safe
    check (private.security_audit_metadata_is_safe(metadata)),
  -- A resource is named by both halves or neither; half an identity investigates nothing.
  constraint security_audit_events_resource_pair_complete check (
    (resource_type is null) = (resource_id is null)
  )
);

comment on table public.security_audit_events is
  'Durable, append-only security audit trail (Security C2-5). Rows answer WHO did WHAT to WHICH RESOURCE WHEN through WHICH ACTION with WHAT OUTCOME. Written only by trusted server code over INSERT-only service-role privileges; no API role holds SELECT, UPDATE, DELETE or TRUNCATE. Codes are restricted to the seeded auditable subset of the C2-4 taxonomy. Retention is indefinite pending an explicit product/legal decision; volume is bounded by design because only state-changing signals qualify.';

comment on column public.security_audit_events.occurred_at is
  'Database clock only. A trigger forces now() on every insert regardless of caller, so event time is never caller-supplied.';

comment on column public.security_audit_events.actor_profile_id is
  'Server-derived verified actor; never accepted from a browser. NULL for genuinely anonymous rows. ON DELETE SET NULL matches the platform-wide profile-deletion tradeoff already accepted on public.activity_events.';

comment on column public.security_audit_events.target_actor_id is
  'For privileged changes, WHO the change was done to. Server-derived like every identity here.';

comment on column public.security_audit_events.correlation_id is
  'The proxy-minted x-wolf-forge-request-id for the request that produced the row; joins durable rows to C2-4 structured logs. Shape-enforced; client-supplied values were never adopted anywhere upstream.';

alter table public.security_audit_events enable row level security;

-- Exactly ONE row-level rule exists: the trusted writer may append. There is no
-- SELECT, UPDATE or DELETE policy for ANY role, so no API role can read a row
-- back or alter one even if a privilege were ever re-granted by mistake. Stated
-- explicitly rather than relying on service_role's platform BYPASSRLS attribute,
-- so the boundary holds under either configuration.
create policy security_audit_events_service_insert
on public.security_audit_events
for insert
to service_role
with check (true);

-- -----------------------------------------------------------------------------
-- 4. Append-only enforcement.
--
-- The same three-layer pattern proven on public.activity_events:
--   a. grants — only service_role INSERT exists; UPDATE/DELETE/TRUNCATE are
--      granted to nobody, including service_role;
--   b. row trigger — UPDATE/DELETE raise even for the table owner, excepting
--      only the nested referential action that implements ON DELETE SET NULL;
--   c. statement trigger — TRUNCATE skips row triggers, so it gets its own guard.
-- -----------------------------------------------------------------------------

create or replace function private.force_security_audit_occurred_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.occurred_at = now();
  return new;
end;
$$;

create or replace function private.prevent_security_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Preserve the actor FKs' declared ON DELETE SET NULL behaviour: a direct
  -- update has trigger depth 1; the referential action invokes this trigger
  -- nested and may change ONLY the actor columns to null.
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and (to_jsonb(new) - array['actor_profile_id', 'target_actor_id'])
      = (to_jsonb(old) - array['actor_profile_id', 'target_actor_id'])
    and (
      (old.actor_profile_id is not null and new.actor_profile_id is null)
      or (old.target_actor_id is not null and new.target_actor_id is null)
    )
  then
    return new;
  end if;

  raise exception 'security audit events are append-only'
    using errcode = '55000';
end;
$$;

revoke all on function private.force_security_audit_occurred_at()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_security_audit_mutation()
  from public, anon, authenticated, service_role;

create trigger security_audit_events_force_time
before insert on public.security_audit_events
for each row
execute function private.force_security_audit_occurred_at();

create trigger security_audit_events_prevent_mutation
before update or delete on public.security_audit_events
for each row
execute function private.prevent_security_audit_mutation();

create trigger security_audit_events_prevent_truncate
before truncate on public.security_audit_events
for each statement
execute function private.prevent_security_audit_mutation();

-- -----------------------------------------------------------------------------
-- 5. Privileges.
--
-- The whole boundary in four lines: service_role (the trusted server writer)
-- may append and nothing more; no browser role may do anything at all.
-- -----------------------------------------------------------------------------

revoke all on table public.security_audit_events
  from public, anon, authenticated, service_role;

grant insert on table public.security_audit_events to service_role;

-- -----------------------------------------------------------------------------
-- 6. Investigation indexes (O).
--
-- Each index answers a real question from the phase brief; nothing speculative:
--   * actor timeline          — what privileged actions did actor X perform?
--   * target timeline         — who changed access FOR member Y?
--   * code timeline           — when was Gmail disconnected/reconnected? bursts?
--   * resource timeline       — what denials targeted this resource?
--   * correlation lookup      — what happened around request Z?
-- -----------------------------------------------------------------------------


create index security_audit_events_actor_time_idx
  on public.security_audit_events (actor_profile_id, occurred_at desc)
  where actor_profile_id is not null;

create index security_audit_events_target_time_idx
  on public.security_audit_events (target_actor_id, occurred_at desc)
  where target_actor_id is not null;

create index security_audit_events_code_time_idx
  on public.security_audit_events (event_code, occurred_at desc);

create index security_audit_events_resource_time_idx
  on public.security_audit_events (resource_type, resource_id, occurred_at desc);

create index security_audit_events_correlation_idx
  on public.security_audit_events (correlation_id)
  where correlation_id is not null;

-- -----------------------------------------------------------------------------
-- VOLUME NOTE. Only seven codes qualify, and every wired site is rare by
-- nature: password changes, unassigned-account sign-ins, cross-surface denials
-- and Gmail connection lifecycle. Expected steady state is tens of rows per
-- day platform-wide, dominated by context.denied probes. This is why no
-- retention job ships here: there is nothing to bound yet, and a retention
-- period is a product/legal decision recorded for that discussion, not one
-- invented silently.
-- =============================================================================
