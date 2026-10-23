-- Preserve existing internal avatar behavior; validate the newly admitted client surface.
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
  actor_id uuid := private.require_self_profile_actor();
  normalized_path text := nullif(btrim(p_avatar_path), '');
  normalized_url text := nullif(btrim(p_avatar_url), '');
  previous_path text;
begin
  if normalized_path is null or normalized_url is null then
    raise exception 'an avatar path and url are required'
      using errcode = '22023';
  end if;

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

  if private.current_account_class() = 'client' and (normalized_url is distinct from
      (regexp_replace(auth.jwt() ->> 'iss', '/auth/v1/?$', '') || '/storage/v1/object/public/profile-avatars/' || normalized_path)
    or not exists (select 1 from storage.objects where bucket_id = 'profile-avatars'
      and name = normalized_path and owner_id = actor_id::text)) then
    raise exception 'your uploaded avatar was not found' using errcode = '42501';
  end if;
  perform private.consume_rate_limit(
    'avatar.persist.actor.minute', actor_id::text, interval '1 minute', 5
  );
  perform private.consume_rate_limit(
    'avatar.persist.actor.hour', actor_id::text, interval '1 hour', 15
  );
  perform private.consume_rate_limit(
    'avatar.persist.actor.day', actor_id::text, interval '1 day', 30
  );

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

  perform private.record_self_profile_activity(
    'profile', actor_id, 'profile.avatar_updated',
    'Updated their profile photo.', '{}'::jsonb
  );

  return query select
    case when previous_path = normalized_path then null else previous_path end;
end;
$fn$;