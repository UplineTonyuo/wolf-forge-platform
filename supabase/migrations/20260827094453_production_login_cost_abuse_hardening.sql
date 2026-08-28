-- Production login + cost-abuse hardening.
--
-- This migration deliberately reuses the one durable, concurrency-safe
-- primitive introduced by Security Batch B2. It does not add another counter
-- table and it never stores an email address or an IP address: the application
-- sends keyed SHA-256 fingerprints produced only on the trusted server.
--
-- The policy combines signals without creating a victim-lockout primitive:
--
--   * source attempt buckets bound one abusive network source;
--   * source+identity failure buckets add progressive cooldown for repeated
--     guessing of one credential pair;
--   * identity-only failure buckets are an OBSERVATION signal. They are never
--     allowed to block a correct login merely because an attacker knows the
--     target email.
--
-- All three public entry points are callable by service_role only. Browser
-- roles cannot spend counters, inspect risk state, choose a subject, or use the
-- functions as an account-existence oracle.

create or replace function private.current_rate_limit_hits(
  p_scope text,
  p_subject text,
  p_window interval
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select counter.hits
    from private.rate_limit_counters as counter
    where counter.scope = p_scope
      and counter.subject = p_subject
      and counter.window_start = to_timestamp(
        floor(
          extract(epoch from clock_timestamp()) /
          extract(epoch from greatest(coalesce(p_window, interval '1 minute'), interval '1 second'))
        ) * extract(epoch from greatest(coalesce(p_window, interval '1 minute'), interval '1 second'))
      )
  ), 0);
$$;

revoke all on function private.current_rate_limit_hits(text, text, interval)
  from public, anon, authenticated, service_role;

comment on function private.current_rate_limit_hits(text, text, interval) is
  'Reads the current epoch-aligned fixed-window counter for trusted wrapper functions. Not exposed to API roles.';

create or replace function private.require_login_fingerprint(p_value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid login protection subject' using errcode = '22023';
  end if;
  return p_value;
end;
$$;

revoke all on function private.require_login_fingerprint(text)
  from public, anon, authenticated, service_role;

create or replace function public.app_login_rate_limit_preflight(
  p_source_fingerprint text,
  p_identity_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_key text := private.require_login_fingerprint(p_source_fingerprint);
  identity_key text := private.require_login_fingerprint(p_identity_fingerprint);
  pair_key text := source_key || ':' || identity_key;
  identity_targeted boolean;
begin
  -- A source+target cooldown can inconvenience only the source that generated
  -- it. A different source holding the correct credential is never locked out.
  if private.current_rate_limit_hits(
       'auth.login.pair.failure.minute', pair_key, interval '1 minute'
     ) >= 3
     or private.current_rate_limit_hits(
       'auth.login.pair.failure.ten_minutes', pair_key, interval '10 minutes'
     ) >= 6
     or private.current_rate_limit_hits(
       'auth.login.pair.failure.hour', pair_key, interval '1 hour'
     ) >= 12
  then
    raise exception 'rate limit exceeded'
      using errcode = 'WF429',
            hint = 'Too many requests. Please wait and try again.';
  end if;

  -- BotID runs before this call. These are therefore deliberately roomy for
  -- shared offices while still bounding a human-like scripted source.
  perform private.consume_rate_limit(
    'auth.login.source.attempt.minute', source_key, interval '1 minute', 12
  );
  perform private.consume_rate_limit(
    'auth.login.source.attempt.hour', source_key, interval '1 hour', 120
  );

  -- Identity-wide pressure is visible to the application/operator, but it is
  -- not an authorization result and is NEVER a hard denial. This is what keeps
  -- knowing a victim's email from becoming a lockout capability.
  identity_targeted :=
    private.current_rate_limit_hits(
      'auth.login.identity.failure.ten_minutes', identity_key, interval '10 minutes'
    ) >= 10
    or private.current_rate_limit_hits(
      'auth.login.identity.failure.hour', identity_key, interval '1 hour'
    ) >= 30;

  return jsonb_build_object('identity_targeted', identity_targeted);
end;
$$;

revoke all on function public.app_login_rate_limit_preflight(text, text)
  from public, anon, authenticated;
grant execute on function public.app_login_rate_limit_preflight(text, text)
  to service_role;

comment on function public.app_login_rate_limit_preflight(text, text) is
  'Trusted-server login preflight. Enforces per-source attempts and source+identity cooldowns, returning only a non-blocking identity-risk signal. Inputs are keyed fingerprints, never raw IP/email.';

create or replace function public.app_record_login_failure(
  p_source_fingerprint text,
  p_identity_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_key text := private.require_login_fingerprint(p_source_fingerprint);
  identity_key text := private.require_login_fingerprint(p_identity_fingerprint);
  pair_key text := source_key || ':' || identity_key;
begin
  -- Narrowest first. A source stopped by its own pair bucket cannot advance the
  -- identity-wide observation buckets that describe distributed pressure.
  perform private.consume_rate_limit(
    'auth.login.pair.failure.minute', pair_key, interval '1 minute', 3
  );
  perform private.consume_rate_limit(
    'auth.login.pair.failure.ten_minutes', pair_key, interval '10 minutes', 6
  );
  perform private.consume_rate_limit(
    'auth.login.pair.failure.hour', pair_key, interval '1 hour', 12
  );

  -- Observation-only ceilings are intentionally high. They bound state/log
  -- churn without becoming an account lock. Preflight reads the lower risk
  -- thresholds above; it never denies on these scopes.
  perform private.consume_rate_limit(
    'auth.login.identity.failure.ten_minutes', identity_key, interval '10 minutes', 1000
  );
  perform private.consume_rate_limit(
    'auth.login.identity.failure.hour', identity_key, interval '1 hour', 5000
  );
end;
$$;

revoke all on function public.app_record_login_failure(text, text)
  from public, anon, authenticated;
grant execute on function public.app_record_login_failure(text, text)
  to service_role;

comment on function public.app_record_login_failure(text, text) is
  'Trusted-server failure recorder for progressive source+identity cooldown and non-blocking distributed identity-risk observation.';

create or replace function public.app_clear_login_pair_failures(
  p_source_fingerprint text,
  p_identity_fingerprint text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pair_key text :=
    private.require_login_fingerprint(p_source_fingerprint)
    || ':' ||
    private.require_login_fingerprint(p_identity_fingerprint);
begin
  delete from private.rate_limit_counters as counter
  where counter.subject = pair_key
    and counter.scope in (
      'auth.login.pair.failure.minute',
      'auth.login.pair.failure.ten_minutes',
      'auth.login.pair.failure.hour'
    );
end;
$$;

revoke all on function public.app_clear_login_pair_failures(text, text)
  from public, anon, authenticated;
grant execute on function public.app_clear_login_pair_failures(text, text)
  to service_role;

comment on function public.app_clear_login_pair_failures(text, text) is
  'Clears only the successful source+identity pair cooldown. Source attempt and identity-risk history remain intact.';
