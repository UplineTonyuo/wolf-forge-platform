-- Team supervision authorization foundation only. No conversation read path.

insert into public.permissions (permission_key, category, label, description)
values (
  'team_messages.supervise',
  'team_messages',
  'Supervise team messages',
  'Use read-only supervisory Team conversation APIs when those APIs are available.'
)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key, allowed)
select
  role_row.id,
  'team_messages.supervise',
  role_row.name in ('owner', 'admin')
from public.roles as role_row
where role_row.name in ('owner', 'admin', 'manager', 'staff', 'client')
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

insert into public.permission_modules (
  module_key,
  label,
  account_class,
  required_permission_key,
  sort_order
)
values (
  'team_supervision',
  'Team supervision',
  'internal',
  'team_messages.supervise',
  115
)
on conflict (module_key) do update
set label = excluded.label,
    account_class = excluded.account_class,
    required_permission_key = excluded.required_permission_key,
    sort_order = excluded.sort_order,
    updated_at = now();

create or replace function private.require_team_supervisor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('team_messages.supervise');
  return actor_id;
end;
$$;

revoke all on function private.require_team_supervisor()
from public, anon, authenticated, service_role;

comment on function private.require_team_supervisor()
is 'Returns the active internal auth.uid() actor only when team_messages.supervise is effective. It grants no conversation access by itself.';
