-- Wolf Forge Platform — Settings + Integrations foundation
--
-- This migration persists connection METADATA only. Provider access tokens,
-- refresh tokens, client secrets, webhook secrets, private keys and any other
-- credentials are deliberately absent. Future provider implementations must
-- store credentials behind the server-only IntegrationCredentialStore port.

-- -----------------------------------------------------------------------------
-- Capability: viewing Settings is not authority to mutate external connections.
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values (
  'integrations.manage',
  'settings',
  'Manage integrations',
  'Connect, reauthorize, configure, and disconnect external providers.'
)
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'integrations.manage', true
from public.roles as role_row
where role_row.name in ('owner', 'admin')
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Safe provider connection metadata.
--
-- One row represents the platform-level connection for one provider. Feature
-- enablement (for example, Store versus Invoice payments) is intentionally not
-- stored here; connection and product behavior remain separate concepts.
-- -----------------------------------------------------------------------------

create or replace function private.integration_metadata_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  metadata_key text;
  metadata_value jsonb;
  normalized_key text;
begin
  if p_value is null then
    return true;
  end if;

  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    for metadata_key, metadata_value in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(p_value) as entry(key, value)
    loop
      normalized_key := pg_catalog.regexp_replace(
        pg_catalog.lower(metadata_key),
        '[^a-z0-9]+',
        '',
        'g'
      );

      if normalized_key ~ '(token|secret|credential|password|privatekey|apikey|signingkey)' then
        return false;
      end if;

      if not private.integration_metadata_is_safe(metadata_value) then
        return false;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    for metadata_value in
      select entry.value
      from pg_catalog.jsonb_array_elements(p_value) as entry(value)
    loop
      if not private.integration_metadata_is_safe(metadata_value) then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

revoke all on function private.integration_metadata_is_safe(jsonb)
  from public, anon, authenticated, service_role;

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null default 'disconnected',
  connected_account_id text,
  connected_account_display text,
  connected_by_profile_id uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  expires_at timestamptz,
  granted_scopes text[] not null default '{}'::text[],
  provider_metadata jsonb not null default '{}'::jsonb,
  constraint integration_connections_provider_check
    check (provider in ('gmail', 'stripe', 'paypal')),
  constraint integration_connections_provider_unique unique (provider),
  constraint integration_connections_status_check
    check (status in ('connected', 'disconnected', 'error', 'expired')),
  constraint integration_connections_connected_shape_check
    check (
      status <> 'connected'
      or (connected_by_profile_id is not null and connected_at is not null)
    ),
  constraint integration_connections_scopes_clean_check
    check (array_position(granted_scopes, null) is null),
  constraint integration_connections_provider_metadata_object_check
    check (jsonb_typeof(provider_metadata) = 'object'),
  constraint integration_connections_provider_metadata_safe_check
    check (private.integration_metadata_is_safe(provider_metadata))
);

comment on table public.integration_connections is
  'Safe, browser-displayable provider connection metadata only. Secrets and tokens are forbidden and belong behind the server-only credential-store abstraction.';

comment on column public.integration_connections.provider_metadata is
  'Non-secret provider metadata for trusted server-side use. It is intentionally omitted from the client read RPC; never store credentials, tokens, secrets, keys, or webhook signing material here.';

comment on column public.integration_connections.granted_scopes is
  'Provider permission names only. OAuth tokens and consent artifacts never belong in this table.';

create index integration_connections_status_idx
  on public.integration_connections(status);

create trigger integration_connections_set_updated_at
before update on public.integration_connections
for each row execute function private.set_updated_at();

alter table public.integration_connections enable row level security;

-- No direct Data API table path is needed. RLS remains enabled as defense in
-- depth if a future grant is added accidentally; the projection RPC below is
-- the only authenticated read path and independently re-authorizes the caller.
revoke all on table public.integration_connections
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Client-safe projection. Raw provider_metadata is deliberately not returned.
-- -----------------------------------------------------------------------------

create or replace function public.app_list_integration_connections()
returns table (
  id uuid,
  provider text,
  status text,
  connected_account_id text,
  connected_account_display text,
  connected_by_profile_id uuid,
  connected_at timestamptz,
  updated_at timestamptz,
  last_synced_at timestamptz,
  expires_at timestamptz,
  granted_scopes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();
  perform private.require_permission('settings.view');

  return query
  select
    connection_row.id,
    connection_row.provider,
    connection_row.status,
    connection_row.connected_account_id,
    connection_row.connected_account_display,
    connection_row.connected_by_profile_id,
    connection_row.connected_at,
    connection_row.updated_at,
    connection_row.last_synced_at,
    connection_row.expires_at,
    connection_row.granted_scopes
  from public.integration_connections as connection_row
  order by connection_row.provider;
end;
$$;

revoke all on function public.app_list_integration_connections()
  from public, anon;

grant execute on function public.app_list_integration_connections()
  to authenticated;

comment on function public.app_list_integration_connections() is
  'Returns only client-safe integration connection metadata to an internal caller with settings.view. Provider metadata and all credential material are excluded.';

-- A reusable private guard for future provider-specific write RPCs. It is not
-- exposed through the Data API and grants no write operation by itself.
create or replace function private.require_integration_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  actor_id := private.require_internal_actor();
  perform private.require_permission('integrations.manage');
  return actor_id;
end;
$$;

revoke all on function private.require_integration_admin()
  from public, anon, authenticated, service_role;

comment on function private.require_integration_admin() is
  'Backend authorization guard for future provider connection mutations. Requires an internal actor with integrations.manage.';
