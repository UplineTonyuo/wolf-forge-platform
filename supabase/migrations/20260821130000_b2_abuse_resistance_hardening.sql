-- Wolf Forge Platform
-- Pre-deploy Security Fix Batch B2 — abuse resistance and least-privilege
-- hardening.
--
-- Forward-only. Nothing here reverses a Batch A or Batch B1 control.
--
--   M-03  Anonymous public Order/Contact Form submissions gain database
--         enforced fixed-window throttling, hard payload caps and a real
--         bot-verification seam. Authorization is unchanged.
--   M-04  Ticket creation, Ticket replies, internal notes and Store interest
--         transitions gain per-actor, database enforced throttling. Store
--         interest renewal notifications are coalesced behind a cooldown so a
--         remove/re-add loop cannot manufacture staff work-queue events.
--   B1 follow-up
--         Notification listing and both read markers now re-resolve the
--         recipient's CURRENT module capability, so revoking a module hides
--         already-delivered rows immediately.
--   Invariant
--         Every audience+category combination the notifications CHECK
--         constraint permits must be explicitly mapped to a capability or
--         explicitly declared non-deliverable. Enforced by a table constraint
--         and by a gap function the pgTAP suite asserts is empty.
--   Least privilege
--         service_role loses its vestigial TRUNCATE/TRIGGER/REFERENCES grants
--         on public.notifications, and the notification trigger functions lose
--         their nominal default PUBLIC EXECUTE grants.

-- =============================================================================
-- Rate limiting primitive
--
-- Serverless processes are ephemeral, so an in-memory counter enforces nothing.
-- State lives in one private table and is consumed through one SECURITY DEFINER
-- function that no browser role may call directly.
--
-- Windows are fixed and epoch-aligned, which makes the row key deterministic
-- and bounds row count per subject by retention rather than by call volume.
--
-- The counter is incremented and inspected in the same statement, so concurrent
-- callers serialize on the bucket row rather than racing. When the limit is
-- exceeded the function raises, which rolls the increment back with the rest of
-- the caller's transaction; the bucket therefore settles exactly at the limit
-- and every further attempt in the window recomputes limit + 1 and is rejected.
-- The same rollback is what guarantees a throttled call leaves no partial
-- submission, message, activity or notification state behind.
-- =============================================================================

create table if not exists private.rate_limit_counters (
  scope text not null,
  subject text not null,
  window_start timestamptz not null,
  expires_at timestamptz not null,
  hits integer not null,
  primary key (scope, subject, window_start)
);

alter table private.rate_limit_counters enable row level security;

create index if not exists rate_limit_counters_expires_at_idx
  on private.rate_limit_counters (expires_at);

revoke all on table private.rate_limit_counters
  from public, anon, authenticated, service_role;

comment on table private.rate_limit_counters is
  'Fixed-window abuse counters. Written only by private.consume_rate_limit; no browser role holds any privilege on it.';

create or replace function private.consume_rate_limit(
  p_scope text,
  p_subject text,
  p_window interval,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_length interval := greatest(
    coalesce(p_window, interval '1 minute'),
    interval '1 second'
  );
  window_seconds double precision := extract(epoch from window_length);
  bucket_start timestamptz;
  current_hits integer;
begin
  if p_scope is null
    or btrim(p_scope) = ''
    or p_subject is null
    or btrim(p_subject) = ''
    or p_limit is null
    or p_limit < 1
  then
    raise exception 'invalid rate limit configuration' using errcode = '22023';
  end if;

  bucket_start := to_timestamp(
    floor(
      extract(epoch from clock_timestamp()) / window_seconds
    ) * window_seconds
  );

  insert into private.rate_limit_counters as counter (
    scope, subject, window_start, expires_at, hits
  )
  values (
    p_scope,
    p_subject,
    bucket_start,
    bucket_start + (window_length * 2),
    1
  )
  on conflict (scope, subject, window_start)
  do update set hits = counter.hits + 1
  returning counter.hits into current_hits;

  -- Bounded opportunistic sweep, only on the first hit of a fresh window, and
  -- only over rows nobody else is touching, so cleanup can never block a
  -- legitimate request.
  if current_hits = 1 then
    delete from private.rate_limit_counters as stale
    where (stale.scope, stale.subject, stale.window_start) in (
      select expired.scope, expired.subject, expired.window_start
      from private.rate_limit_counters as expired
      where expired.expires_at < clock_timestamp()
      limit 200
      for update skip locked
    );
  end if;

  if current_hits > p_limit then
    -- The bucket name stays out of the raised error: PostgREST forwards both
    -- DETAIL and HINT to the caller, and naming the control that stopped them
    -- tells an abuser exactly which dimension to vary next. It goes to the
    -- server log instead, where operators can still see it.
    raise log 'wolf forge rate limit exceeded: scope=% subject=%', p_scope, p_subject;
    raise exception 'rate limit exceeded'
      using errcode = 'WF429',
            hint = 'Too many requests. Please wait and try again.';
  end if;

  return current_hits;
end;
$$;

revoke all on function private.consume_rate_limit(text, text, interval, integer)
  from public, anon, authenticated, service_role;

comment on function private.consume_rate_limit(text, text, interval, integer) is
  'Concurrency-safe fixed-window throttle. Raises SQLSTATE WF429 when the subject exceeds the limit, which rolls back every write the caller had staged.';

-- =============================================================================
-- Bot verification seam
--
-- No bot-verification provider is configured in this repository, and none is
-- invented here. What exists is the boundary a real provider plugs into:
--
--   private.bot_verification_providers   one row per provider, disabled by
--                                        default, with an explicit
--                                        enforce_public_forms switch.
--   private.bot_verifications            single-use verification receipts a
--                                        TRUSTED SERVER writes after it has
--                                        called the provider's verify endpoint.
--                                        The database never makes an outbound
--                                        call.
--   private.require_bot_verification()   consumed by the submit boundary.
--
-- Behaviour is deliberate in both directions: with no provider enforcing, an
-- anonymous public submission still succeeds (fail-safe, so shipping this batch
-- cannot silently take public Forms offline); once a provider is enabled with
-- enforce_public_forms, a submission without a valid unconsumed receipt is
-- rejected (fail-closed).
-- =============================================================================

create table if not exists private.bot_verification_providers (
  provider_key text primary key,
  is_enabled boolean not null default false,
  enforce_public_forms boolean not null default false,
  verification_ttl_seconds integer not null default 300,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_verification_providers_key_format
    check (provider_key ~ '^[a-z][a-z0-9_]*$'),
  constraint bot_verification_providers_ttl_sane
    check (verification_ttl_seconds between 30 and 3600)
);

alter table private.bot_verification_providers enable row level security;

revoke all on table private.bot_verification_providers
  from public, anon, authenticated, service_role;

comment on table private.bot_verification_providers is
  'Bot-challenge provider registry. Empty by default: no provider ships configured, so nothing enforces a challenge until one is registered and enabled.';

create table if not exists private.bot_verifications (
  token_hash text primary key,
  provider_key text not null
    references private.bot_verification_providers (provider_key) on delete cascade,
  scope text not null,
  subject text not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

alter table private.bot_verifications enable row level security;

create index if not exists bot_verifications_expires_at_idx
  on private.bot_verifications (expires_at);

revoke all on table private.bot_verifications
  from public, anon, authenticated, service_role;

comment on table private.bot_verifications is
  'Single-use bot-challenge receipts written by a trusted server after it verified a token with the provider. Never written from a browser session.';

create or replace function private.record_bot_verification(
  p_provider_key text,
  p_scope text,
  p_subject text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_row private.bot_verification_providers;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'bot verification token is required' using errcode = '22023';
  end if;

  select * into provider_row
  from private.bot_verification_providers as provider
  where provider.provider_key = p_provider_key
    and provider.is_enabled;

  if provider_row.provider_key is null then
    raise exception 'bot verification provider is not enabled' using errcode = '55000';
  end if;

  delete from private.bot_verifications as stale
  where stale.expires_at < clock_timestamp();

  insert into private.bot_verifications (
    token_hash, provider_key, scope, subject, expires_at
  )
  values (
    encode(
      sha256(convert_to(p_token, 'utf8')), 'hex'
    ),
    provider_row.provider_key,
    p_scope,
    p_subject,
    clock_timestamp()
      + make_interval(secs => provider_row.verification_ttl_seconds)
  )
  on conflict (token_hash) do nothing;
end;
$$;

revoke all on function private.record_bot_verification(text, text, text, text)
  from public, anon, authenticated, service_role;

comment on function private.record_bot_verification(text, text, text, text) is
  'Trusted-server entry point for recording a verified bot-challenge receipt. Holds no browser grant; only the table owner may call it.';

create or replace function private.require_bot_verification(
  p_scope text,
  p_subject text,
  p_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  enforcing_count integer;
  token_hash_value text;
  consumed_key text;
begin
  select count(*) into enforcing_count
  from private.bot_verification_providers as provider
  where provider.is_enabled
    and provider.enforce_public_forms;

  if enforcing_count = 0 then
    -- Fail-safe: no provider is configured to enforce, so the submission is
    -- allowed and the caller is told the challenge is not in force.
    return 'not_configured';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception 'bot verification is required' using errcode = '42501';
  end if;

  token_hash_value := encode(
    sha256(convert_to(p_token, 'utf8')), 'hex'
  );

  update private.bot_verifications as verification
  set consumed_at = clock_timestamp()
  where verification.token_hash = token_hash_value
    and verification.scope = p_scope
    and verification.subject = p_subject
    and verification.consumed_at is null
    and verification.expires_at > clock_timestamp()
  returning verification.token_hash into consumed_key;

  if consumed_key is null then
    raise exception 'bot verification is required' using errcode = '42501';
  end if;

  return 'verified';
end;
$$;

revoke all on function private.require_bot_verification(text, text, text)
  from public, anon, authenticated, service_role;

comment on function private.require_bot_verification(text, text, text) is
  'Consumes a single-use bot-challenge receipt. Returns not_configured when no provider enforces, and raises 42501 when one does and no valid receipt exists.';

-- =============================================================================
-- M-03: public Form payload caps
--
-- The submit boundary validated the SHAPE of every answer but never its SIZE,
-- so a single anonymous request could store an arbitrarily large answer and a
-- burst of them could grow the database without limit. Caps live in the
-- validator, which both app_submit_form and app_correct_form_submission call,
-- so neither entry point can be fed an oversized payload.
-- =============================================================================

create or replace function private.enforce_form_payload_limits(p_values jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  max_total_bytes constant integer := 262144;   -- 256 KB of answers
  max_answer_bytes constant integer := 16384;   -- 16 KB for one answer
  max_answer_chars constant integer := 8000;    -- one long-form text answer
  max_answers constant integer := 300;
  submitted_value jsonb;
  answer jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'array' then
    raise exception 'Form values must be an array' using errcode = '22023';
  end if;

  if octet_length(p_values::text) > max_total_bytes then
    raise exception 'Form submission payload is too large' using errcode = '22023';
  end if;

  if jsonb_array_length(p_values) > max_answers then
    raise exception 'Form submission has too many answers' using errcode = '22023';
  end if;

  for submitted_value in select value from jsonb_array_elements(p_values) loop
    answer := submitted_value -> 'value';

    if octet_length(coalesce(answer, 'null'::jsonb)::text) > max_answer_bytes then
      raise exception 'Form answer is too large' using errcode = '22023';
    end if;

    if jsonb_typeof(answer) = 'string'
      and char_length(trim(both '"' from answer::text)) > max_answer_chars
    then
      raise exception 'Form answer is too long' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function private.enforce_form_payload_limits(jsonb)
  from public, anon, authenticated, service_role;

comment on function private.enforce_form_payload_limits(jsonb) is
  'Hard database caps on Form answer payload size, answer size and answer count. Applies to every submit and every correction.';

-- The validator gains the caps at its head. Everything below the first
-- statement is reproduced verbatim from the Forms core migration.
create or replace function private.validate_form_submission_values(
  p_form_version_id uuid,
  p_values jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted_value jsonb;
  field_row public.form_version_fields;
  submitted_key uuid;
  answer jsonb;
  selected_value jsonb;
begin
  perform private.enforce_form_payload_limits(p_values);

  if p_values is null or jsonb_typeof(p_values) <> 'array' then
    raise exception 'Form values must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_values) as item
    group by item ->> 'field_key'
    having count(*) > 1
  ) then
    raise exception 'duplicate Form field value' using errcode = '22023';
  end if;

  for submitted_value in select value from jsonb_array_elements(p_values) loop
    if jsonb_typeof(submitted_value) <> 'object'
      or submitted_value - array['field_key', 'value'] <> '{}'::jsonb
      or not submitted_value ?& array['field_key', 'value']
    then
      raise exception 'invalid Form field value' using errcode = '22023';
    end if;
    submitted_key := (submitted_value ->> 'field_key')::uuid;
    answer := submitted_value -> 'value';
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = p_form_version_id
      and field.stable_field_key = submitted_key;
    if field_row.id is null then raise exception 'unknown Form field' using errcode = '22023'; end if;
    if not private.form_field_is_visible(p_form_version_id, submitted_key, p_values) then
      raise exception 'hidden Form fields cannot be submitted' using errcode = '22023';
    end if;
    if field_row.field_type in ('password', 'secret') then
      raise exception 'credential-like Form values require a dedicated encrypted storage boundary' using errcode = '55000';
    end if;
    if field_row.field_type in ('file', 'captcha') then
      raise exception 'Form field integration is deferred' using errcode = '55000';
    end if;
    if field_row.field_type in ('payment', 'hidden', 'break', 'pagebreak', 'html') then
      raise exception 'non-answer Form fields cannot be submitted' using errcode = '22023';
    end if;
    if field_row.field_type in ('checkbox', 'optin') and jsonb_typeof(answer) <> 'boolean' then
      raise exception 'Form checkbox value must be boolean' using errcode = '22023';
    end if;
    if field_row.field_type = 'email'
      and (jsonb_typeof(answer) <> 'string' or trim(both '"' from answer::text) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    then
      raise exception 'invalid Form email value' using errcode = '22023';
    end if;
    if field_row.field_type = 'date'
      and (jsonb_typeof(answer) <> 'string' or trim(both '"' from answer::text) !~ '^\d{4}-\d{2}-\d{2}$')
    then
      raise exception 'invalid Form date value' using errcode = '22023';
    end if;
    if field_row.field_type in ('data-option-group', 'data-dropdown') then
      if jsonb_typeof(answer) <> 'string' or not exists (
        select 1 from public.form_field_options as option
        where option.form_version_field_id = field_row.id
          and option.stable_option_key = trim(both '"' from answer::text)::uuid
      ) then
        raise exception 'invalid Form option ID' using errcode = '22023';
      end if;
    end if;
    if field_row.field_type in ('optgroup', 'dropdown') then
      if jsonb_typeof(answer) = 'array' then
        for selected_value in select value from jsonb_array_elements(answer) loop
          if not exists (
            select 1 from public.form_service_links as link
            where link.form_version_field_id = field_row.id
              and link.service_id = trim(both '"' from selected_value::text)::uuid
          ) then raise exception 'invalid Form Service option ID' using errcode = '22023'; end if;
        end loop;
      elsif jsonb_typeof(answer) = 'string' then
        if not exists (
          select 1 from public.form_service_links as link
          where link.form_version_field_id = field_row.id
            and link.service_id = trim(both '"' from answer::text)::uuid
        ) then raise exception 'invalid Form Service option ID' using errcode = '22023'; end if;
      else
        raise exception 'invalid Form Service selection' using errcode = '22023';
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from public.form_version_fields as field
    where field.form_version_id = p_form_version_id
      and field.required
      and private.form_field_is_visible(p_form_version_id, field.stable_field_key, p_values)
      and not exists (
        select 1 from jsonb_array_elements(p_values) as submitted
        where submitted ->> 'field_key' = field.stable_field_key::text
          and private.form_value_is_present(submitted -> 'value', field.field_type)
      )
  ) then
    raise exception 'required Form field is missing' using errcode = '23514';
  end if;
end;
$$;

-- =============================================================================
-- M-03: anonymous submission throttling
--
-- An anonymous caller has no server-derived identity, so the only bucket that
-- cannot be escaped by rotating anything the caller controls is the Form itself
-- and the anonymous population as a whole. Those two are the hard ceilings.
--
-- A third, tighter bucket is derived server-side from the email and phone
-- answers the submission actually contains, after they have passed field
-- validation. That is submitted data, so it is a coalescing key and not an
-- identity: rotating it escapes only the tighter bucket and still runs into the
-- per-Form ceiling. It is checked FIRST precisely so that a single spamming
-- source is stopped before it can advance the shared per-Form and global
-- counters, which is what keeps one abuser from starving legitimate traffic.
-- =============================================================================

create or replace function private.form_submission_identity_key(
  p_form_version_id uuid,
  p_values jsonb
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    sha256(
      convert_to(
        string_agg(identities.identity_value, '|' order by identities.identity_value),
        'utf8'
      )
    ),
    'hex'
  )
  from (
    select distinct
      lower(btrim(trim(both '"' from (submitted.value -> 'value')::text)))
        as identity_value
    from jsonb_array_elements(p_values) as submitted
    join public.form_version_fields as field
      on field.form_version_id = p_form_version_id
     and field.stable_field_key = (submitted.value ->> 'field_key')::uuid
    where field.field_type in ('email', 'phone')
      and jsonb_typeof(submitted.value -> 'value') = 'string'
      and btrim(trim(both '"' from (submitted.value -> 'value')::text)) <> ''
  ) as identities;
$$;

revoke all on function private.form_submission_identity_key(uuid, jsonb)
  from public, anon, authenticated, service_role;

comment on function private.form_submission_identity_key(uuid, jsonb) is
  'Coalescing key for anonymous Form throttling, derived server-side from the submissions own validated email and phone answers. Not an identity and never used for authorization.';

create or replace function private.enforce_form_submission_rate(
  p_form_id uuid,
  p_actor_profile_id uuid,
  p_identity_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_profile_id is not null then
    -- An authenticated submitter has a server-derived profile, so the bucket is
    -- exact and no other account can consume it.
    perform private.consume_rate_limit(
      'form.submit.actor.minute', p_actor_profile_id::text, interval '1 minute', 10
    );
    perform private.consume_rate_limit(
      'form.submit.actor.hour', p_actor_profile_id::text, interval '1 hour', 100
    );
    perform private.consume_rate_limit(
      'form.submit.actor.day', p_actor_profile_id::text, interval '1 day', 300
    );
    return;
  end if;

  if p_identity_key is not null then
    perform private.consume_rate_limit(
      'form.submit.public.identity.hour',
      p_form_id::text || ':' || p_identity_key,
      interval '1 hour',
      5
    );
    perform private.consume_rate_limit(
      'form.submit.public.identity.day',
      p_form_id::text || ':' || p_identity_key,
      interval '1 day',
      10
    );
  end if;

  perform private.consume_rate_limit(
    'form.submit.public.form.minute', p_form_id::text, interval '1 minute', 10
  );
  perform private.consume_rate_limit(
    'form.submit.public.form.hour', p_form_id::text, interval '1 hour', 60
  );
  perform private.consume_rate_limit(
    'form.submit.public.form.day', p_form_id::text, interval '1 day', 300
  );

  -- Every public Form belongs to Wolf Forge itself; there is no per-client
  -- public Form, so a shared anonymous ceiling starves no other tenant.
  perform private.consume_rate_limit(
    'form.submit.public.global.minute', 'anonymous', interval '1 minute', 30
  );
  perform private.consume_rate_limit(
    'form.submit.public.global.hour', 'anonymous', interval '1 hour', 300
  );
end;
$$;

revoke all on function private.enforce_form_submission_rate(uuid, uuid, text)
  from public, anon, authenticated, service_role;

comment on function private.enforce_form_submission_rate(uuid, uuid, text) is
  'Database enforced Form submission throttle. Narrow buckets are consumed before shared ones so a single abusive source cannot advance the ceilings that protect everyone else.';

-- -----------------------------------------------------------------------------
-- The submit boundary itself.
--
-- Reproduced from the Batch A version with four additions and no removals:
--   * 'bot_token' becomes an accepted context key, and is stripped out of the
--     idempotency payload so rotating a challenge token cannot turn a legitimate
--     retry into a 23505.
--   * payload caps run before any other work.
--   * the throttle runs after the Form is resolved and after the idempotent
--     replay short-circuit, so a genuine retry is never punished as new abuse
--     and a throttled call has written nothing.
--   * the bot-verification seam runs immediately after the throttle, for public
--     Forms only.
-- -----------------------------------------------------------------------------

create or replace function public.app_submit_form(
  p_request_id uuid,
  p_form_version_id uuid,
  p_context jsonb,
  p_values jsonb,
  p_files jsonb default '[]'::jsonb
)
returns public.form_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  actor_role text;
  actor_company_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  assignment_row public.form_assignments;
  submission_row public.form_submissions;
  field_row public.form_version_fields;
  submitted_value jsonb;
  company_id_value uuid;
  client_profile_id_value uuid;
  order_id_value uuid;
  orchestration_type_value text;
  orchestration_status_value text := 'not_required';
  existing_id uuid;
  identity_key text;
  request_payload jsonb := jsonb_build_object(
    'form_version_id', p_form_version_id,
    'context', coalesce(p_context, '{}'::jsonb) - 'bot_token',
    'values', p_values,
    'files', coalesce(p_files, '[]'::jsonb)
  );
begin
  if p_context is null
    or jsonb_typeof(p_context) <> 'object'
    or p_context - array[
      'assignment_id', 'order_id', 'company_id', 'client_profile_id', 'bot_token'
    ] <> '{}'::jsonb
    or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  if p_context ? 'bot_token'
    and (jsonb_typeof(p_context -> 'bot_token') <> 'string'
      or char_length(p_context ->> 'bot_token') > 4096)
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  -- Size first: an oversized payload is rejected before it is parsed field by
  -- field, and before any lock is taken.
  perform private.enforce_form_payload_limits(p_values);

  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 0 then
    raise exception 'Form file upload storage boundary is not available'
      using errcode = '55000';
  end if;

  if actor_id is not null then
    select profile.* into actor_profile
    from public.profiles as profile
    where profile.id = actor_id
      and profile.archived_at is null;

    if actor_profile.id is null then
      raise exception 'active Form submitter is required' using errcode = '42501';
    end if;

    select role_row.name into actor_role
    from public.roles as role_row
    where role_row.id = actor_profile.role_id;
  end if;

  -- Every authenticated client submission reauthorizes the portal module
  -- before the idempotency lookup, so revoking Forms access is immediate.
  if actor_role = 'client' then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');

    actor_company_id := private.current_user_company_id();
    if actor_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    -- An assigned retry is allowed after completion, but only for the exact
    -- profile that owns the assignment. This check therefore intentionally
    -- does not require status = assigned.
    if p_context ? 'assignment_id' then
      select assignment.* into assignment_row
      from public.form_assignments as assignment
      where assignment.id = (p_context ->> 'assignment_id')::uuid
        and assignment.archived_at is null;

      if assignment_row.id is null
        or assignment_row.company_id <> actor_company_id
        or assignment_row.client_profile_id <> actor_id
      then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    end if;
  end if;

  existing_id := private.find_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload
  );
  if existing_id is not null then
    select * into submission_row
    from public.form_submissions
    where id = existing_id;
    if submission_row.id is null then raise no_data_found; end if;
    return submission_row;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.lifecycle_state = 'published'
  for share;
  if version_row.id is null then raise no_data_found; end if;

  select form.* into form_row
  from public.forms as form
  where form.id = version_row.form_id
    and form.status = 'published'
    and form.archived_at is null
    and form.published_version_id = version_row.id
  for share;
  if form_row.id is null then
    raise exception 'Form version is unavailable for submission'
      using errcode = '55000';
  end if;

  if form_row.visibility = 'public' then
    if form_row.form_type not in ('order', 'contact') then
      raise exception 'assigned Form cannot be public' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'authenticated' then
    if actor_id is null then
      raise exception 'Form authentication is required' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'assigned' then
    if actor_id is null or not p_context ? 'assignment_id' then
      raise exception 'Form assignment is required' using errcode = '42501';
    end if;
  end if;

  -- M-03. The Form is known and this is not a replay, so throttle now. Every
  -- write below this line is inside the same transaction, so a raise here
  -- leaves no submission, no values, no activity, no Ticket and no
  -- notification behind.
  identity_key := private.form_submission_identity_key(version_row.id, p_values);
  perform private.enforce_form_submission_rate(form_row.id, actor_id, identity_key);

  if form_row.visibility = 'public' then
    perform private.require_bot_verification(
      'form.submit', form_row.id::text, p_context ->> 'bot_token'
    );
  end if;

  if form_row.form_type in ('intake', 'onboarding') then
    select assignment.* into assignment_row
    from public.form_assignments as assignment
    where assignment.id = (p_context ->> 'assignment_id')::uuid
      and assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
    for update;

    if assignment_row.id is null then
      raise exception 'active Form assignment is required' using errcode = '42501';
    end if;

    if actor_role = 'client' and (
      actor_company_id <> assignment_row.company_id
      or actor_id <> assignment_row.client_profile_id
    ) then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if actor_role <> 'client'
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;

    company_id_value := assignment_row.company_id;
    client_profile_id_value := assignment_row.client_profile_id;
    order_id_value := assignment_row.order_id;
  else
    if actor_role = 'client' then
      company_id_value := actor_company_id;
      client_profile_id_value := actor_profile.id;
    elsif actor_id is not null
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;
  end if;

  if p_context ? 'company_id'
    and (p_context ->> 'company_id')::uuid is distinct from company_id_value
  then
    raise exception 'Form company context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'client_profile_id'
    and (p_context ->> 'client_profile_id')::uuid is distinct from client_profile_id_value
  then
    raise exception 'Form client context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'order_id'
    and (p_context ->> 'order_id')::uuid is distinct from order_id_value
  then
    raise exception 'Form Order context cannot be spoofed' using errcode = '42501';
  end if;

  perform private.validate_form_submission_values(version_row.id, p_values);

  if form_row.form_type = 'order' then
    orchestration_type_value := 'order_checkout';
    orchestration_status_value := 'deferred';
  elsif form_row.form_type = 'contact' then
    orchestration_type_value := 'contact_ticket';
    orchestration_status_value := 'deferred';
  end if;

  submission_row.id := gen_random_uuid();
  insert into public.form_submissions (
    id,
    form_id,
    form_version_id,
    form_assignment_id,
    company_id,
    client_profile_id,
    order_id,
    root_submission_id,
    revision_number,
    orchestration_type,
    orchestration_status,
    submitted_by_profile_id,
    provenance
  ) values (
    submission_row.id,
    form_row.id,
    version_row.id,
    assignment_row.id,
    company_id_value,
    client_profile_id_value,
    order_id_value,
    submission_row.id,
    1,
    orchestration_type_value,
    orchestration_status_value,
    actor_id,
    jsonb_build_object(
      'form_type', form_row.form_type,
      'schema_hash', version_row.schema_hash,
      'type_config', version_row.type_config,
      'orchestration_deferred', orchestration_status_value = 'deferred'
    )
  ) returning * into submission_row;

  for submitted_value in
    select value from jsonb_array_elements(p_values)
  loop
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.stable_field_key = (submitted_value ->> 'field_key')::uuid;

    insert into public.form_submission_values (
      submission_id,
      form_version_field_id,
      stable_field_key,
      field_label_snapshot,
      field_type_snapshot,
      sort_order_snapshot,
      value
    ) values (
      submission_row.id,
      field_row.id,
      field_row.stable_field_key,
      field_row.label,
      field_row.field_type,
      field_row.sort_order,
      submitted_value -> 'value'
    );
  end loop;

  if assignment_row.id is not null then
    update public.form_assignments
    set
      status = 'completed',
      completed_at = now(),
      latest_submission_id = submission_row.id
    where id = assignment_row.id;
  end if;

  perform private.record_form_activity(
    'form_submission',
    submission_row.id,
    'form.submitted',
    format('Submitted %s Form.', initcap(form_row.form_type)),
    jsonb_build_object(
      'form_id', form_row.id,
      'form_version_id', version_row.id,
      'assignment_id', assignment_row.id,
      'company_id', company_id_value,
      'order_id', order_id_value
    )
  );
  perform private.remember_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload,
    submission_row.id
  );
  return submission_row;
end;
$$;

comment on function public.app_submit_form(uuid, uuid, jsonb, jsonb, jsonb) is
  'Atomic idempotent Form submit boundary with server-side schema, rule, option, assignment and company validation, hard payload caps, database enforced throttling and a bot-verification seam.';

-- =============================================================================
-- M-04: Ticket abuse controls
--
-- Authorization, company derivation and foreign-Ticket protection are untouched.
-- Every bucket is keyed on the SERVER-DERIVED actor profile, and the
-- conversation bucket is keyed on actor + Ticket rather than Ticket alone, so
-- one participant can never exhaust another participant's allowance in a shared
-- conversation.
--
-- Each throttle is consumed after the idempotent replay short-circuit, so a
-- client retrying the same request id is answered from the request log and
-- never counted twice.
-- =============================================================================

create or replace function public.app_create_ticket(p_request_id uuid, p_payload jsonb)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor record;
  ticket_row public.tickets;
  initial_message public.ticket_messages;
  company_id_value uuid;
  client_profile_id_value uuid;
  priority_value text := coalesce(p_payload ->> 'priority', 'normal');
  existing_id uuid;
begin
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['company_id', 'client_profile_id', 'subject', 'message', 'priority'] <> '{}'::jsonb
    or nullif(btrim(p_payload ->> 'subject'), '') is null
    or nullif(btrim(p_payload ->> 'message'), '') is null
    or char_length(p_payload ->> 'subject') > 500
    or char_length(p_payload ->> 'message') > 50000
    or priority_value not in ('low', 'normal', 'high', 'urgent')
  then raise exception 'invalid Ticket creation input' using errcode = '22023'; end if;

  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then raise exception 'verified authentication is required' using errcode = '42501'; end if;
  perform private.require_permission('tickets.create');

  existing_id := private.find_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload);
  if existing_id is not null then
    select * into ticket_row from public.tickets where id = existing_id;
    return ticket_row;
  end if;

  -- M-04. A client opening conversations is the cheapest way to manufacture
  -- staff work; internal accounts open Tickets on behalf of clients and get a
  -- correspondingly higher allowance.
  if actor.role_name = 'client' then
    perform private.consume_rate_limit(
      'ticket.create.client.hour', actor.profile_id::text, interval '1 hour', 10
    );
    perform private.consume_rate_limit(
      'ticket.create.client.day', actor.profile_id::text, interval '1 day', 30
    );
  else
    perform private.consume_rate_limit(
      'ticket.create.internal.hour', actor.profile_id::text, interval '1 hour', 60
    );
    perform private.consume_rate_limit(
      'ticket.create.internal.day', actor.profile_id::text, interval '1 day', 300
    );
  end if;

  if actor.role_name = 'client' then
    company_id_value := actor.company_id;
    client_profile_id_value := actor.profile_id;
    if company_id_value is null then raise exception 'client company is required' using errcode = '42501'; end if;
    if priority_value <> 'normal' then
      raise exception 'client cannot set Ticket priority' using errcode = '42501';
    end if;
    if p_payload ? 'company_id' and (p_payload ->> 'company_id')::uuid is distinct from company_id_value then
      raise exception 'Ticket company context cannot be spoofed' using errcode = '42501';
    end if;
    if p_payload ? 'client_profile_id' and (p_payload ->> 'client_profile_id')::uuid is distinct from client_profile_id_value then
      raise exception 'Ticket client context cannot be spoofed' using errcode = '42501';
    end if;
  else
    company_id_value := (p_payload ->> 'company_id')::uuid;
    client_profile_id_value := (p_payload ->> 'client_profile_id')::uuid;
    if company_id_value is null or not exists (
      select 1 from public.companies where id = company_id_value and archived_at is null
    ) then raise exception 'active Ticket company is required' using errcode = '23503'; end if;
    if client_profile_id_value is not null and not exists (
      select 1 from public.profiles as profile_row
      join public.roles as role_row on role_row.id = profile_row.role_id
      where profile_row.id = client_profile_id_value
        and profile_row.company_id = company_id_value
        and profile_row.archived_at is null and role_row.name = 'client'
    ) then raise exception 'Ticket client must belong to the selected company' using errcode = '23514'; end if;
  end if;

  insert into public.tickets (
    company_id, client_profile_id, subject, status, priority, created_by_profile_id
  ) values (
    company_id_value, client_profile_id_value, btrim(p_payload ->> 'subject'),
    'open', priority_value, actor.profile_id
  ) returning * into ticket_row;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    ticket_row.id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'initial_request', 'client', btrim(p_payload ->> 'message'), p_request_id
  ) returning * into initial_message;

  perform private.record_ticket_activity(
    ticket_row.id, 'ticket.created', 'Created Ticket.',
    jsonb_build_object('company_id', company_id_value, 'initial_message_id', initial_message.id),
    actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.create', p_request_id, p_payload, ticket_row.id);
  return ticket_row;
end;
$$;

create or replace function public.app_reply_to_ticket(p_request_id uuid, p_ticket_id uuid, p_body text)
returns public.ticket_messages
language plpgsql
security definer
set search_path = ''
as $$
declare actor record; ticket_row public.tickets; message_row public.ticket_messages; existing_id uuid; payload jsonb;
begin
  if p_request_id is null or p_ticket_id is null or nullif(btrim(p_body), '') is null
    or char_length(p_body) > 50000
    or octet_length(p_body) > 200000
  then raise exception 'invalid Ticket reply input' using errcode = '22023'; end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null then raise exception 'verified authentication is required' using errcode = '42501'; end if;
  perform private.require_permission('tickets.reply');
  ticket_row := private.require_ticket_access(p_ticket_id);
  if ticket_row.archived_at is not null or ticket_row.status = 'closed' then
    raise exception 'Ticket is not open for replies' using errcode = '55000';
  end if;
  payload := jsonb_build_object('ticket_id', p_ticket_id, 'body', p_body);
  existing_id := private.find_create_request(actor.profile_id, 'ticket.reply', p_request_id, payload);
  if existing_id is not null then
    select * into message_row from public.ticket_messages where id = existing_id;
    return message_row;
  end if;

  -- M-04. Conversation-scoped first, so a burst against one Ticket is stopped
  -- before it consumes the actor's wider allowance. Both subjects include the
  -- server-derived profile id, so no participant shares a bucket with another.
  perform private.consume_rate_limit(
    'ticket.reply.conversation.minute',
    actor.profile_id::text || ':' || p_ticket_id::text,
    interval '1 minute',
    6
  );
  perform private.consume_rate_limit(
    'ticket.reply.conversation.day',
    actor.profile_id::text || ':' || p_ticket_id::text,
    interval '1 day',
    200
  );
  perform private.consume_rate_limit(
    'ticket.reply.actor.minute', actor.profile_id::text, interval '1 minute', 10
  );
  perform private.consume_rate_limit(
    'ticket.reply.actor.hour', actor.profile_id::text, interval '1 hour', 120
  );

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    p_ticket_id, actor.profile_id,
    case when actor.role_name = 'client' then 'client' else 'internal' end,
    'reply', 'client', btrim(p_body), p_request_id
  ) returning * into message_row;
  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.replied', 'Replied to Ticket.',
    jsonb_build_object('message_id', message_row.id, 'author_type', message_row.author_type), actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.reply', p_request_id, payload, message_row.id);
  return message_row;
end;
$$;

create or replace function public.app_add_ticket_internal_note(p_request_id uuid, p_ticket_id uuid, p_body text)
returns public.ticket_messages
language plpgsql
security definer
set search_path = ''
as $$
declare actor record; ticket_row public.tickets; message_row public.ticket_messages; existing_id uuid; payload jsonb;
begin
  if p_request_id is null or p_ticket_id is null or nullif(btrim(p_body), '') is null
    or char_length(p_body) > 50000
    or octet_length(p_body) > 200000
  then raise exception 'invalid Ticket note input' using errcode = '22023'; end if;
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name = 'client' then
    raise exception 'internal Ticket access is required' using errcode = '42501';
  end if;
  perform private.require_permission('tickets.internal_notes');
  ticket_row := private.require_ticket_access(p_ticket_id);
  if ticket_row.archived_at is not null then raise exception 'archived Ticket cannot receive notes' using errcode = '55000'; end if;
  payload := jsonb_build_object('ticket_id', p_ticket_id, 'body', p_body);
  existing_id := private.find_create_request(actor.profile_id, 'ticket.internal_note', p_request_id, payload);
  if existing_id is not null then
    select * into message_row from public.ticket_messages where id = existing_id;
    return message_row;
  end if;

  perform private.consume_rate_limit(
    'ticket.note.actor.minute', actor.profile_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'ticket.note.actor.day', actor.profile_id::text, interval '1 day', 500
  );

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body, request_id
  ) values (
    p_ticket_id, actor.profile_id, 'internal', 'internal_note', 'internal', btrim(p_body), p_request_id
  ) returning * into message_row;
  update public.tickets set updated_at = now() where id = p_ticket_id;
  perform private.record_ticket_activity(
    p_ticket_id, 'ticket.internal_note_added', 'Added an internal Ticket note.',
    jsonb_build_object('message_id', message_row.id), actor.profile_id
  );
  perform private.remember_create_request(actor.profile_id, 'ticket.internal_note', p_request_id, payload, message_row.id);
  return message_row;
end;
$$;

comment on function public.app_reply_to_ticket(uuid, uuid, text) is
  'Idempotent Ticket reply boundary. Authorization is unchanged; replies are throttled per actor and per actor-conversation, and a throttled attempt writes no message, activity or notification.';
comment on function public.app_create_ticket(uuid, jsonb) is
  'Idempotent Ticket creation boundary. Clients hold a lower creation allowance than internal accounts so downstream work-queue growth is bounded.';
comment on function public.app_add_ticket_internal_note(uuid, uuid, text) is
  'Idempotent internal Ticket note boundary, throttled per internal actor.';

-- =============================================================================
-- M-04: Store interest toggle abuse
--
-- The Investment Intent model is preserved exactly: interest is still a state
-- change and never a delete, add_count still counts genuine re-adds, status is
-- still never silently reopened, and a client can still change their mind.
--
-- What changes is the SIGNAL. A renewal used to emit a staff notification keyed
-- on add_count, so remove/add/remove/add produced one work-queue event per
-- cycle. Renewal signals are now coalesced behind a per-interest cooldown: the
-- state still updates on every genuine transition, but Wolf Forge is told once
-- per cooldown window. A real change of mind a day later still signals.
-- =============================================================================

alter table public.service_interests
  add column if not exists last_notified_at timestamptz;

comment on column public.service_interests.last_notified_at is
  'When a staff signal was last emitted for this interest row. Renewal notifications are coalesced behind a cooldown measured from here; it is not part of the interest state itself.';

-- Existing rows have already signalled at least once. Anchoring the cooldown to
-- the first add keeps history honest without suppressing a legitimate renewal.
update public.service_interests
set last_notified_at = first_added_at
where last_notified_at is null;

-- The Investment Intent emitter predates the Batch B1 capability map and
-- reimplemented the same fan-out by hand. It now delegates, so there is exactly
-- one internal fan-out implementation and one place where the capability for
-- the 'store' category is decided.
create or replace function private.emit_investment_intent_notification(
  p_event_key text,
  p_title text,
  p_body text,
  p_intent_id uuid,
  p_company_id uuid,
  p_actor_profile_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.emit_internal_notification_for_permission(
    private.notification_category_permission('internal', 'store'),
    p_event_key,
    'store',
    'info',
    p_title,
    p_body,
    '/investment-intent?intent=' || p_intent_id::text,
    'service_interest',
    p_intent_id,
    p_actor_profile_id,
    p_company_id,
    now()
  );
$$;

revoke all on function private.emit_investment_intent_notification(
  text, text, text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

comment on function private.emit_investment_intent_notification(
  text, text, text, uuid, uuid, uuid
) is 'Investment Intent fan-out. Delegates to the single capability-aware internal emitter so the store category resolves through the one authoritative map.';

create or replace function public.app_record_store_interest(
  p_service_ids uuid[],
  p_in_cart boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- One staff signal per interest row per hour. Long enough that a rapid
  -- remove/re-add loop produces nothing, short enough that a client who
  -- genuinely reconsiders later in the day is still heard.
  renewal_cooldown constant interval := interval '1 hour';
  client_actor record;
  service_row public.services;
  interest_row public.service_interests;
  prior_row public.service_interests;
  company_name text;
  distinct_ids uuid[];
  service_id_value uuid;
  written integer := 0;
begin
  if p_service_ids is null
    or p_in_cart is null
    or array_length(p_service_ids, 1) is null
    or array_length(p_service_ids, 1) > 12
    or exists (
      select 1 from unnest(p_service_ids) as candidate where candidate is null
    )
  then
    raise exception 'invalid Store interest input' using errcode = '22023';
  end if;

  select * into client_actor from private.current_store_client();

  if client_actor.profile_id is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_store');

  -- M-04. Keyed on the server-derived client profile, so one account cannot
  -- consume another account's or another company's allowance. Generous enough
  -- that ordinary cart use never reaches it: a whole cart is one call.
  perform private.consume_rate_limit(
    'store.interest.actor.minute', client_actor.profile_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'store.interest.actor.hour', client_actor.profile_id::text, interval '1 hour', 200
  );

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = client_actor.company_id;

  select array_agg(distinct entry) into distinct_ids
  from unnest(p_service_ids) as entry;

  foreach service_id_value in array distinct_ids
  loop
    -- Re-states services_authenticated_select_active, because RLS does not
    -- apply inside a SECURITY DEFINER function.
    select * into service_row
    from public.services as candidate
    where candidate.id = service_id_value
      and candidate.is_active
      and candidate.is_public
      and candidate.archived_at is null;

    if service_row.id is null then
      continue;
    end if;

    select * into prior_row
    from public.service_interests as existing
    where existing.company_id = client_actor.company_id
      and existing.service_id = service_id_value
    for update;

    if p_in_cart then
      if prior_row.id is null then
        insert into public.service_interests (
          company_id,
          service_id,
          status,
          in_cart,
          add_count,
          first_added_at,
          last_added_at,
          last_activity_at,
          last_notified_at,
          signalled_by_profile_id
        )
        values (
          client_actor.company_id,
          service_id_value,
          'new',
          true,
          1,
          now(),
          now(),
          now(),
          now(),
          client_actor.profile_id
        )
        on conflict (company_id, service_id) do nothing
        returning * into interest_row;

        -- A concurrent first add won the race and already emitted the signal.
        if interest_row.id is null then
          continue;
        end if;

        written := written + 1;

        perform private.emit_investment_intent_notification(
          'service-interest-new:' || interest_row.id::text,
          'New investment interest',
          coalesce(company_name, 'A client') || ' showed interest in ' || service_row.name || '.',
          interest_row.id,
          client_actor.company_id,
          client_actor.profile_id
        );

      elsif not prior_row.in_cart then
        -- Renewed interest. status is deliberately untouched: a client re-adding
        -- something must not silently reopen a decision William already made.
        -- The state change is always recorded; only the staff signal is
        -- coalesced, and the row itself carries the cooldown anchor so two
        -- concurrent calls cannot both emit (the row is already locked above).
        update public.service_interests as target
        set in_cart = true,
            removed_at = null,
            last_added_at = now(),
            last_activity_at = now(),
            add_count = target.add_count + 1,
            last_notified_at = case
              when target.last_notified_at is null
                or target.last_notified_at < now() - renewal_cooldown
              then now()
              else target.last_notified_at
            end
        where target.id = prior_row.id
        returning * into interest_row;

        written := written + 1;

        if prior_row.last_notified_at is null
          or prior_row.last_notified_at < now() - renewal_cooldown
        then
          perform private.emit_investment_intent_notification(
            'service-interest-renewed:' || interest_row.id::text || ':' || interest_row.add_count::text,
            'Renewed investment interest',
            coalesce(company_name, 'A client') || ' added ' || service_row.name || ' back to their cart.',
            interest_row.id,
            client_actor.company_id,
            client_actor.profile_id
          );
        end if;
      end if;

      -- Already in the cart: no write, no notification, and no reordering of
      -- the workspace from a repeated click.

    else
      if prior_row.id is not null and prior_row.in_cart then
        -- History is preserved. Removal is a state change, never a delete.
        update public.service_interests as target
        set in_cart = false,
            removed_at = now(),
            last_activity_at = now()
        where target.id = prior_row.id;

        written := written + 1;
      end if;

      -- Removing something that was never signalled creates nothing.
    end if;
  end loop;

  return written;
end;
$$;

comment on function public.app_record_store_interest(uuid[], boolean) is
  'Client Store interest write boundary. Company and profile stay server-derived; calls are throttled per client profile and renewal signals are coalesced per interest row so a remove/re-add loop cannot manufacture staff notifications.';

-- =============================================================================
-- Notification category map invariant
--
-- Batch B1 made fan-out fail closed for an unmapped audience+category. Failing
-- closed silently is still a defect: a category added later would simply never
-- be delivered and nothing would say so. Every combination the CHECK constraint
-- permits must now carry an explicit decision.
-- =============================================================================

create or replace function private.notification_category_non_deliverable(
  p_audience text,
  p_category text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Combinations that are deliberately NOT deliverable. Anything not listed
  -- here and not mapped in private.notification_category_permission is an
  -- undecided combination, which the constraint and the suite both reject.
  select (p_audience, p_category) in (
    -- A client account has no Coupons module, so no coupon metadata may ever
    -- reach one.
    ('client', 'coupon')
  );
$$;

revoke all on function private.notification_category_non_deliverable(text, text)
  from public, anon, authenticated, service_role;

comment on function private.notification_category_non_deliverable(text, text) is
  'Explicit declaration of notification audience+category combinations that must never be delivered. The counterpart to private.notification_category_permission; together they must decide every permitted combination.';

-- The permitted domain is read out of the live CHECK constraints rather than
-- restated, so adding a category to public.notifications automatically adds
-- rows here and forces a decision.
create or replace function private.notification_category_catalog()
returns table (audience text, category text)
language sql
stable
security definer
set search_path = ''
as $$
  with constraint_values as (
    select
      constraint_row.conname,
      (regexp_matches(
        pg_get_constraintdef(constraint_row.oid),
        '''([a-z_]+)''::text',
        'g'
      ))[1] as literal_value
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.notifications'::regclass
      and constraint_row.contype = 'c'
      and constraint_row.conname in (
        'notifications_audience_valid', 'notifications_category_valid'
      )
  )
  select audiences.literal_value, categories.literal_value
  from constraint_values as audiences
  cross join constraint_values as categories
  where audiences.conname = 'notifications_audience_valid'
    and categories.conname = 'notifications_category_valid';
$$;

revoke all on function private.notification_category_catalog()
  from public, anon, authenticated, service_role;

comment on function private.notification_category_catalog() is
  'Every audience+category combination the notifications CHECK constraints permit, derived from the live catalog so a new category cannot escape the invariant.';

create or replace function private.notification_category_decision_gaps()
returns table (audience text, category text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    catalog.audience,
    catalog.category,
    case
      when private.notification_category_permission(catalog.audience, catalog.category) is null
        then 'undecided: neither mapped to a capability nor declared non-deliverable'
      else 'mapped to a capability that does not exist in public.permissions'
    end
  from private.notification_category_catalog() as catalog
  where (
      private.notification_category_permission(catalog.audience, catalog.category) is null
      and not private.notification_category_non_deliverable(catalog.audience, catalog.category)
    )
    or (
      private.notification_category_permission(catalog.audience, catalog.category) is not null
      and not exists (
        select 1
        from public.permissions as permission_row
        where permission_row.permission_key
          = private.notification_category_permission(catalog.audience, catalog.category)
      )
    );
$$;

revoke all on function private.notification_category_decision_gaps()
  from public, anon, authenticated, service_role;

comment on function private.notification_category_decision_gaps() is
  'Audience+category combinations with no decision, or mapped to a capability that does not exist. Must always be empty; the pgTAP suite fails the build when it is not.';

-- The runtime half of the invariant. Both referenced functions are IMMUTABLE
-- and only the table owner can write notifications, so this costs nothing at
-- insert time and makes an undecided combination impossible to persist.
alter table public.notifications
  drop constraint if exists notifications_category_decision;

alter table public.notifications
  add constraint notifications_category_decision check (
    private.notification_category_permission(audience, category) is not null
    or private.notification_category_non_deliverable(audience, category)
  );

-- =============================================================================
-- B1 follow-up: read-time permission revocation
--
-- Batch B1 filtered DELIVERY. A notification delivered while the recipient held
-- the module stayed readable after the module was revoked. Listing, the unread
-- count derived from that listing, and both read markers now re-resolve the
-- capability through the SAME authoritative map at read time.
--
-- private.profile_has_permission(profile, null) is false, so an unmapped
-- category is invisible: the read path fails closed exactly like the write path.
-- =============================================================================

create or replace function public.app_list_my_notifications(
  p_limit integer default 50
)
returns table (
  id uuid,
  company_id uuid,
  audience text,
  category text,
  variant text,
  title text,
  body text,
  href text,
  entity_type text,
  entity_id uuid,
  actor_profile_id uuid,
  event_key text,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_notification_actor();
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return query
  select
    notification.id,
    notification.company_id,
    notification.audience,
    notification.category,
    notification.variant,
    notification.title,
    notification.body,
    notification.href,
    notification.entity_type,
    notification.entity_id,
    notification.actor_profile_id,
    notification.event_key,
    notification.read_at,
    notification.created_at
  from public.notifications as notification
  where notification.recipient_profile_id = caller_id
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    )
  order by notification.created_at desc, notification.id desc
  limit row_limit;
end;
$$;

create or replace function public.app_mark_notification_read(
  p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed boolean;
begin
  update public.notifications as notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = p_notification_id
    and notification.recipient_profile_id = caller_id
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  changed := found;
  return changed;
end;
$$;

create or replace function public.app_mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed integer;
begin
  update public.notifications as notification
  set read_at = now()
  where notification.recipient_profile_id = caller_id
    and notification.read_at is null
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  get diagnostics changed = row_count;
  return changed;
end;
$$;

comment on function public.app_list_my_notifications(integer) is
  'Exact-recipient notification list. Requires a currently active resolved profile and re-resolves the module capability at read time, so revoking a module hides already-delivered rows and the unread count derived from this list immediately.';
comment on function public.app_mark_notification_read(uuid) is
  'Exact-recipient read marker. Cannot mutate a row the caller can no longer see.';
comment on function public.app_mark_all_notifications_read() is
  'Exact-recipient bulk read marker. Cannot mutate rows the caller can no longer see.';

-- =============================================================================
-- Least privilege
-- =============================================================================

-- service_role holds no SELECT, INSERT, UPDATE or DELETE on public.notifications
-- and no server operation reads or writes it with that key: trusted writes go
-- through SECURITY DEFINER emitters owned by the table owner, and browser reads
-- go through app_list_my_notifications. TRUNCATE, TRIGGER and REFERENCES were
-- Supabase defaults that survived the unified-notifications revoke, and nothing
-- uses them. Auth Admin provisioning touches auth.users and public.profiles,
-- not this table.
revoke truncate, trigger, references on table public.notifications from service_role;

-- The notification trigger functions kept the default PUBLIC EXECUTE grant.
-- They return trigger, so they were not directly invocable, but a default grant
-- that nothing needs is a default grant that should not exist.
revoke all on function private.notify_project_created() from public, anon, authenticated, service_role;
revoke all on function private.notify_client_created() from public, anon, authenticated, service_role;
revoke all on function private.notify_form_created() from public, anon, authenticated, service_role;
revoke all on function private.notify_coupon_created() from public, anon, authenticated, service_role;
revoke all on function private.notify_client_ticket_reply() from public, anon, authenticated, service_role;
revoke all on function private.notify_client_ticket_response() from public, anon, authenticated, service_role;
revoke all on function private.notify_client_form_assigned() from public, anon, authenticated, service_role;
revoke all on function private.notify_client_invoice_issued() from public, anon, authenticated, service_role;
revoke all on function private.notify_invoice_payment() from public, anon, authenticated, service_role;
revoke all on function private.notify_wallet_credit() from public, anon, authenticated, service_role;

-- The private helpers that RLS policies evaluate keep their authenticated
-- EXECUTE grant on purpose: a policy expression runs with the querying role's
-- privileges, so revoking it would break every internal and client read path.
-- They are SECURITY DEFINER, take no caller-supplied identity, and derive the
-- actor from auth.uid(), so direct invocation reveals nothing the caller could
-- not already determine from its own RLS-filtered reads.
