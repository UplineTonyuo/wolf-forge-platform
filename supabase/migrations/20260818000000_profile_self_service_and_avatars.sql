-- Wolf Forge Platform
-- Profile self-service and avatar storage.
--
-- Adds the first storage boundary in the product. Three rules shape it:
--
--   1. An account may only ever mutate its OWN profile row and its OWN avatar
--      object. There is no profile_id parameter anywhere in this file; identity
--      is always derived from auth.uid().
--   2. Role and account class are never writable here. Settings must not become
--      a path around the Team & Roles privilege boundary.
--   3. public.profiles keeps no write grant for `authenticated`; every mutation
--      below is a SECURITY DEFINER function with an explicit column list.


-- ============================================================
-- Profile columns
-- ============================================================

-- Canonical storage location of the avatar object, always '<profile_id>/<file>'.
-- public.profiles.avatar_url continues to hold the rendered (public, non
-- expiring) URL so the existing Ticket read model keeps working unchanged.
-- Both are written together by app_set_my_avatar / app_clear_my_avatar, so
-- there is exactly one writer and the two can never drift.
alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  add column if not exists notification_sound_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_avatar_pair_consistent'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_pair_consistent
      check (
        (avatar_path is null and avatar_url is null)
        or (avatar_path is not null and avatar_url is not null)
      );
  end if;
end;
$$;

comment on column public.profiles.avatar_path is
  'Storage object path for the avatar, always <profile_id>/<generated-file>. Canonical for ownership and cleanup.';

comment on column public.profiles.notification_sound_enabled is
  'Personal preference: play the notification chime when a new notification arrives.';


-- ============================================================
-- Self-scoped read
-- ============================================================

create or replace function public.app_get_my_profile()
returns table (
  profile_id uuid,
  display_name text,
  email text,
  role_name text,
  preset_key text,
  preset_name text,
  avatar_path text,
  avatar_url text,
  notification_sound_enabled boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile_row.id,
    profile_row.display_name,
    auth_user.email::text,
    role_row.name,
    preset_row.key,
    preset_row.name,
    profile_row.avatar_path,
    profile_row.avatar_url,
    profile_row.notification_sound_enabled,
    profile_row.created_at
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  left join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  left join auth.users as auth_user
    on auth_user.id = profile_row.id
  where profile_row.id = (select auth.uid())
    and profile_row.archived_at is null;
$$;


-- ============================================================
-- Self-scoped profile update
-- ============================================================

-- Only display_name and the notification preference are writable. role_id,
-- company_id, archived_at, avatar columns and every identity field are absent
-- from the UPDATE list on purpose.
create or replace function public.app_update_my_profile(
  p_display_name text,
  p_notification_sound_enabled boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
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
$$;


-- ============================================================
-- Self-scoped avatar persistence
-- ============================================================

-- Returns the object path that was replaced, so the caller can clean it up
-- AFTER the new object and this row are both committed. Never deletes anything
-- itself: a failed cleanup must not roll back a successful profile update.
create or replace function public.app_set_my_avatar(
  p_avatar_path text,
  p_avatar_url text
)
returns table (previous_avatar_path text)
language plpgsql
security definer
set search_path = ''
as $$
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
  -- caller's own folder, matching the storage policies on storage.objects.
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
$$;


create or replace function public.app_clear_my_avatar()
returns table (previous_avatar_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  previous_path text;
begin
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
$$;


-- ============================================================
-- Team directory now carries the avatar
-- ============================================================

-- Return type changes, so the old signature is dropped first. Behaviour and
-- authorization are otherwise identical to the previous definition.
drop function if exists public.app_list_internal_members();

create function public.app_list_internal_members()
returns table (
  profile_id uuid,
  display_name text,
  email text,
  preset_key text,
  preset_name text,
  sort_order integer,
  override_count integer,
  is_self boolean,
  created_at timestamptz,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('users.view');

  return query
  select
    profile_row.id,
    profile_row.display_name,
    auth_user.email::text,
    preset_row.key,
    preset_row.name,
    preset_row.sort_order,
    (
      select count(*)::integer
      from public.profile_permission_overrides as override_row
      where override_row.profile_id = profile_row.id
    ),
    profile_row.id = actor_id,
    profile_row.created_at,
    profile_row.avatar_url

  from public.profiles as profile_row

  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id

  left join auth.users as auth_user
    on auth_user.id = profile_row.id

  where profile_row.archived_at is null
    and preset_row.account_class = 'internal'

  order by
    preset_row.sort_order,
    coalesce(profile_row.display_name, auth_user.email::text),
    profile_row.id;
end;
$$;


-- ============================================================
-- Avatar storage bucket
-- ============================================================

-- Public READ, strictly owner-scoped WRITE.
--
-- Rationale for public read: avatars are already deliberately cross-tenant
-- (app_get_ticket_detail_with_avatars exposes staff avatars to client accounts),
-- and the internal shell renders one on every page. A private bucket would add
-- a Storage round-trip per page render for content that is not confidential.
-- Write, update and delete remain restricted to the owning account's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


drop policy if exists profile_avatars_public_read on storage.objects;
drop policy if exists profile_avatars_owner_insert on storage.objects;
drop policy if exists profile_avatars_owner_update on storage.objects;
drop policy if exists profile_avatars_owner_delete on storage.objects;

-- Anyone may read an avatar; the bucket carries no other object type.
create policy profile_avatars_public_read
on storage.objects
for select
to public
using (bucket_id = 'profile-avatars');

-- An authenticated account may only write inside a folder named after its own
-- uid. This is what makes '<profile_id>/<generated-file>' a real boundary
-- rather than a naming convention.
create policy profile_avatars_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy profile_avatars_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy profile_avatars_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);


-- ============================================================
-- Function privileges
-- ============================================================

revoke all on function public.app_get_my_profile() from public, anon, authenticated, service_role;
grant execute on function public.app_get_my_profile() to authenticated;

revoke all on function public.app_update_my_profile(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_update_my_profile(text, boolean) to authenticated;

revoke all on function public.app_set_my_avatar(text, text) from public, anon, authenticated, service_role;
grant execute on function public.app_set_my_avatar(text, text) to authenticated;

revoke all on function public.app_clear_my_avatar() from public, anon, authenticated, service_role;
grant execute on function public.app_clear_my_avatar() to authenticated;

revoke all on function public.app_list_internal_members() from public, anon, authenticated, service_role;
grant execute on function public.app_list_internal_members() to authenticated;


comment on function public.app_get_my_profile() is
  'Own profile identity for Settings. Derives the account from auth.uid(); takes no profile parameter.';
comment on function public.app_update_my_profile(text, boolean) is
  'Self-service profile update limited to display_name and the notification preference. Role and account class are not writable.';
comment on function public.app_set_my_avatar(text, text) is
  'Persists an avatar owned by the calling account and returns the replaced object path for post-commit cleanup.';
comment on function public.app_clear_my_avatar() is
  'Clears the calling account avatar and returns the removed object path for post-commit cleanup.';
