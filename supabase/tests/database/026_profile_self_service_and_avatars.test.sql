begin;

select plan(30);

-- =============================================================================
-- STRUCTURE
-- =============================================================================

select has_column('public', 'profiles', 'avatar_path', 'profiles.avatar_path exists');
select has_column('public', 'profiles', 'notification_sound_enabled', 'profiles.notification_sound_enabled exists');

select is(
  (select count(*) from storage.buckets where id = 'profile-avatars'),
  1::bigint,
  'the profile-avatars bucket exists'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'profile-avatars'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'the bucket allows only JPEG, PNG and WebP'
);

select is(
  (select file_size_limit from storage.buckets where id = 'profile-avatars'),
  5242880::bigint,
  'the bucket enforces a 5 MB ceiling'
);

select is(
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'profile_avatars_%'),
  4::bigint,
  'the avatar bucket has explicit select/insert/update/delete policies'
);

-- Settings must never become a direct table write path.
select is(
  (
    select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'NONE')
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'
  ),
  'SELECT',
  'authenticated still holds only SELECT on public.profiles'
);


-- =============================================================================
-- FIXTURES
--
-- The auth trigger creates each profile as an unclaimed client-class row; the
-- update below promotes two of them to internal staff.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('2f000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'profile-staff-a@example.invalid', now(), now()),
  ('2f000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'profile-staff-b@example.invalid', now(), now()),
  ('1f000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'profile-client@example.invalid', now(), now());

update public.profiles as profile_row set
  role_id = (
    select role_row.id from public.roles as role_row
    where role_row.name = case
      when profile_row.id in (
        '2f000000-0000-0000-0000-000000000001'::uuid,
        '2f000000-0000-0000-0000-000000000002'::uuid
      ) then 'staff'
      else 'client' end
  ),
  display_name = case profile_row.id
    when '2f000000-0000-0000-0000-000000000001'::uuid then 'Profile Staff A'
    when '2f000000-0000-0000-0000-000000000002'::uuid then 'Profile Staff B'
    else 'Profile Client' end
where profile_row.id in (
  '2f000000-0000-0000-0000-000000000001',
  '2f000000-0000-0000-0000-000000000002',
  '1f000000-0000-0000-0000-000000000001'
);

insert into public.companies (id, name, status)
values ('3f000000-0000-0000-0000-000000000001', 'Profile Test Company', 'client');

update public.profiles
set company_id = '3f000000-0000-0000-0000-000000000001'
where id = '1f000000-0000-0000-0000-000000000001';


-- =============================================================================
-- UNAUTHENTICATED
-- =============================================================================

set local role anon;
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = 'anon';

select throws_ok(
  $$select * from public.app_update_my_profile('Anonymous Rename', true)$$,
  '42501',
  null,
  'an unauthenticated caller cannot update a profile'
);

select throws_ok(
  $$select * from public.app_get_my_profile()$$,
  '42501',
  null,
  'an unauthenticated caller cannot read a profile through the self RPC'
);


-- =============================================================================
-- ACTIVE CLIENT ACCOUNTS CAN UPDATE ONLY THEIR OWN PROFILE
-- =============================================================================

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '1f000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select lives_ok(
  $$select * from public.app_update_my_profile('Client Rename', true)$$,
  'an active client can update its own profile through the self-service RPC'
);


-- =============================================================================
-- OWN PROFILE UPDATE SUCCEEDS
-- =============================================================================

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '2f000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select lives_ok(
  $$select * from public.app_update_my_profile('Renamed Staff A', false)$$,
  'a staff account can update its own profile'
);

select is(
  (select display_name from public.profiles where id = '2f000000-0000-0000-0000-000000000001'),
  'Renamed Staff A',
  'the new display name persisted'
);

select is(
  (select notification_sound_enabled from public.profiles where id = '2f000000-0000-0000-0000-000000000001'),
  false,
  'the notification preference persisted'
);

select is(
  (
    select role_row.name from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = '2f000000-0000-0000-0000-000000000001'
  ),
  'staff',
  'the profile update did not change the role'
);

-- Nobody else was touched.
select is(
  (select display_name from public.profiles where id = '2f000000-0000-0000-0000-000000000002'),
  'Profile Staff B',
  'updating one profile left the other untouched'
);

-- app_get_my_profile is self-scoped by construction.
select is(
  (select count(*) from public.app_get_my_profile()),
  1::bigint,
  'app_get_my_profile returns exactly one row'
);

select is(
  (select profile_id from public.app_get_my_profile()),
  '2f000000-0000-0000-0000-000000000001'::uuid,
  'app_get_my_profile returns the caller own profile'
);

select throws_ok(
  $$select * from public.app_update_my_profile('   ', true)$$,
  '22023',
  null,
  'a blank display name is rejected'
);


-- =============================================================================
-- AVATAR PATH OWNERSHIP
-- =============================================================================

select throws_ok(
  $$select * from public.app_set_my_avatar(
      '2f000000-0000-0000-0000-000000000002/stolen.webp',
      'http://localhost/stolen.webp')$$,
  '42501',
  null,
  'an avatar path inside another account folder is rejected'
);

select throws_ok(
  $$select * from public.app_set_my_avatar(
      '2f000000-0000-0000-0000-000000000001/../2f000000-0000-0000-0000-000000000002/x.webp',
      'http://localhost/x.webp')$$,
  '42501',
  null,
  'a traversal avatar path is rejected'
);

select lives_ok(
  $$select * from public.app_set_my_avatar(
      '2f000000-0000-0000-0000-000000000001/photo.webp',
      'http://localhost/photo.webp')$$,
  'an avatar inside the caller own folder is accepted'
);

select is(
  (select avatar_path from public.profiles where id = '2f000000-0000-0000-0000-000000000001'),
  '2f000000-0000-0000-0000-000000000001/photo.webp',
  'the avatar path persisted'
);

-- Replacing returns the superseded path so the caller can clean it up after commit.
select is(
  (
    select previous_avatar_path from public.app_set_my_avatar(
      '2f000000-0000-0000-0000-000000000001/second.webp',
      'http://localhost/second.webp')
  ),
  '2f000000-0000-0000-0000-000000000001/photo.webp',
  'replacing an avatar reports the previous object for cleanup'
);

select is(
  (select previous_avatar_path from public.app_clear_my_avatar()),
  '2f000000-0000-0000-0000-000000000001/second.webp',
  'clearing an avatar reports the removed object for cleanup'
);

select is(
  (
    select coalesce(avatar_path, '') || '/' || coalesce(avatar_url, '')
    from public.profiles where id = '2f000000-0000-0000-0000-000000000001'
  ),
  '/',
  'clearing an avatar nulls both the path and the rendered url'
);


-- =============================================================================
-- STORAGE OBJECT OWNERSHIP
-- =============================================================================

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('profile-avatars',
            '2f000000-0000-0000-0000-000000000001/own.webp',
            '2f000000-0000-0000-0000-000000000001')$$,
  'an account can write an object inside its own avatar folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('profile-avatars',
            '2f000000-0000-0000-0000-000000000002/hostile.webp',
            '2f000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'an account cannot write an object into another account avatar folder'
);

-- Staff B's own object, created from Staff B's identity.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '2f000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';

insert into storage.objects (bucket_id, name, owner)
values ('profile-avatars',
        '2f000000-0000-0000-0000-000000000002/theirs.webp',
        '2f000000-0000-0000-0000-000000000002');

-- Back to Staff A, who must not be able to remove it.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '2f000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

-- Deletion cannot be exercised through SQL at all: Supabase installs a trigger
-- on storage.objects that rejects direct deletes and forces callers through the
-- Storage API, which then evaluates the delete policy. That is a second layer
-- in front of the policy, so both are asserted rather than assumed.
select throws_ok(
  $$delete from storage.objects
    where bucket_id = 'profile-avatars'
      and name = '2f000000-0000-0000-0000-000000000002/theirs.webp'$$,
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'direct SQL deletion of a storage object is blocked outright'
);

select is(
  (
    select count(*) from storage.objects
    where bucket_id = 'profile-avatars'
      and name = '2f000000-0000-0000-0000-000000000002/theirs.webp'
  ),
  1::bigint,
  'the other account avatar object is still present'
);

-- The delete policy the Storage API evaluates is scoped to the caller folder.
select is(
  (
    select count(*) from pg_policies
    where schemaname = 'storage'
      and policyname = 'profile_avatars_owner_delete'
      and cmd = 'DELETE'
      and qual like '%foldername%'
      and qual like '%auth.uid()%'
  ),
  1::bigint,
  'the avatar delete policy is scoped to the caller own folder'
);

select * from finish();

rollback;
