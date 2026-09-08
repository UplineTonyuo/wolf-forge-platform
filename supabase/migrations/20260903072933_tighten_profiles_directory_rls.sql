-- Wolf Forge Platform
-- Phase 2 profiles directory RLS hardening.

drop policy if exists profiles_internal_select on public.profiles;

create policy profiles_internal_select
on public.profiles
for select
to authenticated
using (
  archived_at is null
  and (select private.is_internal_user())
  and (
    id = (select auth.uid())
    or (select public.app_has_permission('users.view'))
  )
);

comment on policy profiles_internal_select on public.profiles is
  'Active internal callers may read their own profile; users.view is required to read other active profiles. Client self-access remains in profiles_client_select_own.';
