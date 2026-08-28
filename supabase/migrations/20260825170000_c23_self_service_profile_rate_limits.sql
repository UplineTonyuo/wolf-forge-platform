-- =============================================================================
-- Security Phase C2-3 — abuse/bot/mutation protection, forward follow-up.
--
-- The C2-3 audit found ONE class of authenticated mutation surface still
-- carrying no frequency bound: self-service profile maintenance. Nothing else
-- here is new. The existing primitive is reused unchanged
-- (private.consume_rate_limit over private.rate_limit_counters, D-085), no
-- authorization fact is altered, no grant is widened, and every bucket subject
-- is the server-derived profile id from auth.uid() — never a browser value.
--
-- WHAT WAS EXPOSED, and what it actually cost:
--
-- 1. Storage write amplification. public.app_set_my_avatar persists an avatar,
--    but the 5 MB object is written to the 'profile-avatars' bucket BEFORE the
--    RPC is ever called — storage.objects carries its own owner-scoped INSERT
--    policy, so any authenticated session may write into its own folder at
--    request speed. A database throttle on the persist RPC alone would fire
--    only after the bytes had already landed. This migration therefore adds a
--    PRE-FLIGHT claim, public.app_claim_avatar_upload(), which the application
--    consumes before it uploads anything, and which enforces exactly the same
--    authorization as app_set_my_avatar. An over-limit or unauthorized caller
--    is now refused BEFORE the expensive side effect, not after it.
--
--    The claim is an application-side ordering, so it cannot be the ceiling on
--    its own: a caller speaking to PostgREST directly can skip it. The persist
--    RPC therefore keeps its own independent bucket, which is the ceiling that
--    cannot be skipped. The two use SEPARATE scopes on purpose — sharing one
--    would make the ordinary two-step flow consume two units per upload and
--    halve every honest allowance.
--
-- 2. Audit-stream flooding. app_set_my_avatar, app_clear_my_avatar and
--    app_update_my_profile each append a private.record_authenticated_activity
--    row on every successful call. public.activity_events is append-only and
--    has no browser writer (D-083), which makes it a security record; an
--    unbounded self-service writer can both grow it without limit and drown
--    genuine entries in noise. All three now share ONE per-actor bucket, so
--    rotating between them cannot multiply a single account allowance.
--
-- KEY STRATEGY. Every bucket here is keyed on the actor alone. These are
-- strictly self-scoped surfaces — the RPCs take no target id and can only ever
-- touch the caller own row and the caller own storage folder — so an actor
-- key is both the narrowest available and the only one an abuser cannot
-- rotate. No shared or global bucket is introduced, so no account can degrade
-- another ability to edit its own profile.
--
-- LIMITS. Sized far above any human cadence for "change my photo" or "save my
-- settings" and far below what a script needs to matter.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Pre-flight avatar upload claim.
--
-- Returns nothing and mutates nothing but the counter. It is deliberately NOT
-- a reservation: there is no token to redeem and no state to reconcile, so a
-- claim that is never followed by an upload simply expires with its window.
-- Authorization is private.require_internal_actor(), character for character
-- the gate app_set_my_avatar already applies, so this can never admit a caller
-- the persist step would refuse.
-- -----------------------------------------------------------------------------
create or replace function public.app_claim_avatar_upload()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.consume_rate_limit(
    'avatar.upload.claim.actor.minute', actor_id::text, interval '1 minute', 5
  );
  perform private.consume_rate_limit(
    'avatar.upload.claim.actor.hour', actor_id::text, interval '1 hour', 15
  );
  perform private.consume_rate_limit(
    'avatar.upload.claim.actor.day', actor_id::text, interval '1 day', 30
  );
end;
$fn$;

revoke all on function public.app_claim_avatar_upload()
  from public, anon, authenticated, service_role;
grant execute on function public.app_claim_avatar_upload() to authenticated;

comment on function public.app_claim_avatar_upload() is
  'Pre-flight bound on avatar object writes. Consumed by the application before it uploads to storage, so an over-limit or unauthorized caller is refused before the bytes are written. Not the ceiling: app_set_my_avatar carries its own independent bucket for callers that skip this step.';


-- -----------------------------------------------------------------------------
-- app_set_my_avatar — unchanged except for the throttle.
--
-- Reproduced from 20260818000000_profile_self_service_and_avatars.sql. The
-- authorization gate, the ownership re-derivation, the traversal rejection,
-- the update, the activity record and the returned previous path are all
-- identical in behaviour. Two consume_rate_limit blocks are added, placed
-- AFTER the cheap validation (so a malformed request costs the caller nothing
-- and cannot spin an allowance down) and BEFORE the profile write and the
-- activity append (so a throttled call leaves no partial state — the raise
-- rolls back the increment and every staged write together, D-085).
-- -----------------------------------------------------------------------------
create or replace function public.app_set_my_avatar(
  p_avatar_path text,
  p_avatar_url text
)
returns table (previous_avatar_path text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor_id uuid := private.require_internal_actor();
  normalized_path text := nullif(btrim(p_avatar_path), '');
  normalized_url text := nullif(btrim(p_avatar_url), '');
  previous_path text;
begin
  if normalized_path is null or normalized_url is null then
    raise exception 'an avatar path and url are required'
      using errcode = '22023';
  end if;

  -- Ownership is re-derived here rather than trusted. The path must live in the
  -- caller own folder, matching the storage policies on storage.objects.
  if normalized_path <> (actor_id::text || '/' ||
    regexp_replace(normalized_path, '^.*/', ''))
  then
    raise exception 'an avatar path must be owned by your own account'
      using errcode = '42501';
  end if;

  if normalized_path ~ '\.\.' then
    raise exception 'invalid avatar path'
      using errcode = '22023';
  end if;

  -- C2-3. The ceiling a caller cannot skip. app_claim_avatar_upload() bounds
  -- the storage write; this bounds the persistence itself, on its own scope, so
  -- a caller who bypasses the application and speaks to PostgREST directly is
  -- still bounded.
  perform private.consume_rate_limit(
    'avatar.persist.actor.minute', actor_id::text, interval '1 minute', 5
  );
  perform private.consume_rate_limit(
    'avatar.persist.actor.hour', actor_id::text, interval '1 hour', 15
  );
  perform private.consume_rate_limit(
    'avatar.persist.actor.day', actor_id::text, interval '1 day', 30
  );

  -- C2-3. Shared self-service ceiling: see app_update_my_profile below. Every
  -- surface in this group appends to the append-only audit stream, so the group
  -- carries one bucket and rotating between them multiplies nothing.
  perform private.consume_rate_limit(
    'profile.selfservice.actor.minute', actor_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'profile.selfservice.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'profile.selfservice.actor.day', actor_id::text, interval '1 day', 300
  );

  select target.avatar_path into previous_path
  from public.profiles as target
  where target.id = actor_id
    and target.archived_at is null;

  update public.profiles as target
  set avatar_path = normalized_path,
      avatar_url = normalized_url
  where target.id = actor_id
    and target.archived_at is null;

  if not found then
    raise exception 'your profile was not found'
      using errcode = '42501';
  end if;

  perform private.record_authenticated_activity(
    'profile', actor_id, 'profile.avatar_updated',
    'Updated their profile photo.', '{}'::jsonb
  );

  return query select
    case when previous_path = normalized_path then null else previous_path end;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- app_clear_my_avatar — unchanged except for the shared self-service throttle.
-- -----------------------------------------------------------------------------
create or replace function public.app_clear_my_avatar()
returns table (previous_avatar_path text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor_id uuid := private.require_internal_actor();
  previous_path text;
begin
  perform private.consume_rate_limit(
    'profile.selfservice.actor.minute', actor_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'profile.selfservice.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'profile.selfservice.actor.day', actor_id::text, interval '1 day', 300
  );

  select target.avatar_path into previous_path
  from public.profiles as target
  where target.id = actor_id
    and target.archived_at is null;

  update public.profiles as target
  set avatar_path = null,
      avatar_url = null
  where target.id = actor_id
    and target.archived_at is null;

  if not found then
    raise exception 'your profile was not found'
      using errcode = '42501';
  end if;

  if previous_path is not null then
    perform private.record_authenticated_activity(
      'profile', actor_id, 'profile.avatar_removed',
      'Removed their profile photo.', '{}'::jsonb
    );
  end if;

  return query select previous_path;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- app_update_my_profile — unchanged except for the shared self-service throttle.
--
-- Reproduced from 20260818000000_profile_self_service_and_avatars.sql. Still
-- takes no profile id, still derives the account from auth.uid(), still refuses
-- role, preset and email. The throttle sits after the three cheap validations
-- and before the update and the activity append.
-- -----------------------------------------------------------------------------
create or replace function public.app_update_my_profile(
  p_display_name text,
  p_notification_sound_enabled boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor_id uuid := private.require_internal_actor();
  normalized_name text := nullif(btrim(p_display_name), '');
  profile_row public.profiles;
begin
  if normalized_name is null then
    raise exception 'a display name is required'
      using errcode = '22023';
  end if;

  if char_length(normalized_name) > 120 then
    raise exception 'display name is too long'
      using errcode = '22023';
  end if;

  if p_notification_sound_enabled is null then
    raise exception 'a notification sound preference is required'
      using errcode = '22023';
  end if;

  -- C2-3. public.activity_events is append-only and has no browser writer
  -- (D-083), so an unbounded self-service writer can both grow it without limit
  -- and bury genuine audit entries. This bucket is SHARED with
  -- app_set_my_avatar and app_clear_my_avatar — the three surfaces that append
  -- on behalf of the caller own profile — so rotating between them cannot
  -- multiply one account allowance. It is keyed on the actor alone because
  -- every one of them is strictly self-scoped: there is no other account whose
  -- allowance this could consume.
  perform private.consume_rate_limit(
    'profile.selfservice.actor.minute', actor_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'profile.selfservice.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'profile.selfservice.actor.day', actor_id::text, interval '1 day', 300
  );

  update public.profiles as target
  set
    display_name = normalized_name,
    notification_sound_enabled = p_notification_sound_enabled
  where target.id = actor_id
    and target.archived_at is null
  returning target.* into profile_row;

  if profile_row.id is null then
    raise exception 'your profile was not found'
      using errcode = '42501';
  end if;

  perform private.record_authenticated_activity(
    'profile',
    actor_id,
    'profile.updated',
    'Updated their own profile.',
    jsonb_build_object(
      'notification_sound_enabled', p_notification_sound_enabled
    )
  );

  return profile_row;
end;
$fn$;


-- -----------------------------------------------------------------------------
-- Privileges are restated rather than assumed. create or replace preserves the
-- existing ACL, so these are a no-op today; they are here so the intended
-- boundary is visible in the migration that last touched each function.
-- -----------------------------------------------------------------------------
revoke all on function public.app_set_my_avatar(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_set_my_avatar(text, text) to authenticated;

revoke all on function public.app_clear_my_avatar()
  from public, anon, authenticated, service_role;
grant execute on function public.app_clear_my_avatar() to authenticated;

revoke all on function public.app_update_my_profile(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.app_update_my_profile(text, boolean) to authenticated;

comment on function public.app_set_my_avatar(text, text) is
  'Self-scoped avatar persistence. Frequency bound on its own scope so a caller that skips the pre-flight claim is still bounded, and on the shared self-service scope that bounds audit-stream growth.';
comment on function public.app_clear_my_avatar() is
  'Self-scoped avatar removal. Shares the self-service frequency bound with the other two profile writers.';
comment on function public.app_update_my_profile(text, boolean) is
  'Self-scoped profile update. Shares the self-service frequency bound with both avatar writers, so rotating between them cannot multiply one account allowance.';
