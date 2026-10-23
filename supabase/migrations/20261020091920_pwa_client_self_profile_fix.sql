create function private.require_self_profile_actor() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    join public.tenant_memberships m on m.profile_id = p.id
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    join public.roles r on r.id = m.role_id
    where p.id = actor_id and p.archived_at is null and m.archived_at is null
      and m.tenant_id = private.current_tenant_id()
      and ((m.account_class = 'internal' and r.name in ('owner','admin','manager','staff'))
        or (m.account_class = 'client' and r.name = 'client' and exists (
          select 1 from public.companies c where c.id = m.company_id
            and c.tenant_id = m.tenant_id and c.archived_at is null)))
  ) then raise exception 'active profile authentication is required' using errcode = '42501'; end if;
  return actor_id;
end;
$$;
revoke all on function private.require_self_profile_actor() from public, anon, authenticated, service_role;

create function private.record_self_profile_activity(
  p_entity_type text, p_entity_id uuid, p_action text, p_summary text, p_metadata jsonb default '{}'::jsonb
) returns public.activity_events language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := private.require_self_profile_actor(); event_row public.activity_events;
begin
  if p_entity_type <> 'profile' or p_entity_id is distinct from actor_id
    or p_action not in ('profile.updated','profile.avatar_updated','profile.avatar_removed') then
    raise exception 'self profile activity required' using errcode = '42501';
  end if;
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
    values(actor_id,'profile',actor_id,p_action,p_summary,p_metadata) returning * into event_row;
  return event_row;
end;
$$;
revoke all on function private.record_self_profile_activity(text,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
create or replace function public.app_claim_avatar_upload()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor_id uuid := private.require_self_profile_actor();
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

  if normalized_url is distinct from
      (regexp_replace(auth.jwt() ->> 'iss', '/auth/v1/?$', '') || '/storage/v1/object/public/profile-avatars/' || normalized_path)
    or not exists (select 1 from storage.objects where bucket_id = 'profile-avatars'
      and name = normalized_path and owner_id = actor_id::text) then
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

create or replace function public.app_clear_my_avatar()
returns table (previous_avatar_path text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  actor_id uuid := private.require_self_profile_actor();
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
    perform private.record_self_profile_activity(
      'profile', actor_id, 'profile.avatar_removed',
      'Removed their profile photo.', '{}'::jsonb
    );
  end if;

  return query select previous_path;
end;
$fn$;

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
  actor_id uuid := private.require_self_profile_actor();
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

  perform private.record_self_profile_activity(
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
revoke all on function public.app_claim_avatar_upload(), public.app_set_my_avatar(text,text),
  public.app_clear_my_avatar(), public.app_update_my_profile(text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_claim_avatar_upload(), public.app_set_my_avatar(text,text),
  public.app_clear_my_avatar(), public.app_update_my_profile(text,boolean) to authenticated;