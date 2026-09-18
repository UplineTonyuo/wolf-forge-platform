-- Keep the canonical operational-assignee picker projection and add its
-- existing profile avatar. The internal-actor authorization boundary is
-- unchanged.
drop function if exists public.app_list_operational_assignees();

create function public.app_list_operational_assignees()
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();

  return query
  select profile_row.id, profile_row.display_name, profile_row.avatar_url
  from public.profiles as profile_row
  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  where profile_row.archived_at is null
    and preset_row.account_class = 'internal'
  order by
    coalesce(nullif(btrim(profile_row.display_name), ''), '~'),
    profile_row.id;
end;
$$;

revoke all on function public.app_list_operational_assignees()
from public, anon, authenticated, service_role;
grant execute on function public.app_list_operational_assignees()
to authenticated;

comment on function public.app_list_operational_assignees() is
  'Narrow active-internal assignee projection for operational pickers. Derives the caller from auth.uid() and exposes profile ID, display name, and avatar URL.';
