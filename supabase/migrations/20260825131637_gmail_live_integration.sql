-- Wolf Forge Platform — Gmail live provider
--
-- Gmail credentials are encrypted by Supabase Vault and referenced only from
-- the private schema. The browser-readable integration_connections table
-- continues to contain safe display metadata only.

create extension if not exists supabase_vault with schema vault;

revoke all on schema vault from public, anon, authenticated;
revoke all on table vault.secrets, vault.decrypted_secrets
  from public, anon, authenticated, service_role;
revoke all on function vault.create_secret(text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function vault.update_secret(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;

create table private.integration_credential_references (
  provider text primary key,
  vault_secret_id uuid not null references vault.secrets(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_credential_references_provider_check check (provider = 'gmail')
);

revoke all on table private.integration_credential_references
  from public, anon, authenticated, service_role;

create or replace function private.integration_actor_can_manage(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when role_row.name = 'owner' then true
      else coalesce(
        (select override_row.allowed
         from public.profile_permission_overrides as override_row
         where override_row.profile_id = profile_row.id
           and override_row.permission_key = 'integrations.manage'),
        (select role_permission.allowed
         from public.role_permissions as role_permission
         where role_permission.role_id = profile_row.role_id
           and role_permission.permission_key = 'integrations.manage'),
        false
      )
    end
    from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = p_actor_id
      and profile_row.archived_at is null
      and role_row.name in ('owner', 'admin', 'manager', 'staff')
  ), false);
$$;

create or replace function private.require_integration_admin_actor(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.integration_actor_can_manage(p_actor_id) then
    raise exception 'permission denied: integrations.manage' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.gmail_scopes_are_exact(p_scopes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_scopes is not null
    and cardinality(p_scopes) = 4
    and p_scopes @> array[
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.send'
    ]::text[]
    and p_scopes <@ array[
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.send'
    ]::text[];
$$;

create or replace function private.gmail_credentials_are_valid(p_credentials jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_credentials->>'provider' = 'gmail'
    and p_credentials->>'version' = '1'
    and length(coalesce(p_credentials#>>'{payload,accessToken}', '')) > 0
    and length(coalesce(p_credentials#>>'{payload,refreshToken}', '')) > 0
    and length(coalesce(p_credentials#>>'{payload,accessTokenExpiresAt}', '')) > 0
    and length(coalesce(p_credentials#>>'{payload,account,id}', '')) > 0
    and length(coalesce(p_credentials#>>'{payload,account,email}', '')) > 0
    and private.gmail_scopes_are_exact(
      array(select jsonb_array_elements_text(p_credentials#>'{payload,scopes}'))
    );
$$;

revoke all on function private.integration_actor_can_manage(uuid),
  private.require_integration_admin_actor(uuid),
  private.gmail_scopes_are_exact(text[]),
  private.gmail_credentials_are_valid(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.app_server_store_gmail_connection(
  p_actor_id uuid,
  p_credentials jsonb,
  p_account_id text,
  p_account_display text,
  p_granted_scopes text[],
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_secret_id uuid;
  old_secret_id uuid;
begin
  perform private.require_integration_admin_actor(p_actor_id);
  if not private.gmail_credentials_are_valid(p_credentials)
    or not private.gmail_scopes_are_exact(p_granted_scopes)
    or p_credentials#>'{payload,scopes}' <> to_jsonb(p_granted_scopes)
    or nullif(btrim(p_account_id), '') is null
    or nullif(btrim(p_account_display), '') is null
    or p_expires_at is null then
    raise exception 'invalid Gmail connection payload' using errcode = '22023';
  end if;

  select reference_row.vault_secret_id into old_secret_id
  from private.integration_credential_references as reference_row
  where reference_row.provider = 'gmail'
  for update;

  new_secret_id := vault.create_secret(
    p_credentials::text,
    'wolf-forge:gmail:' || gen_random_uuid()::text,
    'Wolf Forge Gmail OAuth credential',
    null
  );

  insert into private.integration_credential_references(provider, vault_secret_id)
  values ('gmail', new_secret_id)
  on conflict (provider) do update
  set vault_secret_id = excluded.vault_secret_id,
      updated_at = now();

  insert into public.integration_connections (
    provider, status, connected_account_id, connected_account_display,
    connected_by_profile_id, connected_at, updated_at, last_synced_at,
    expires_at, granted_scopes, provider_metadata
  ) values (
    'gmail', 'connected', btrim(p_account_id), btrim(p_account_display),
    p_actor_id, now(), now(), now(), p_expires_at, p_granted_scopes,
    jsonb_build_object('authorization_model', 'oauth2_pkce', 'mail_access', 'send_only')
  )
  on conflict (provider) do update
  set status = 'connected',
      connected_account_id = excluded.connected_account_id,
      connected_account_display = excluded.connected_account_display,
      connected_by_profile_id = excluded.connected_by_profile_id,
      connected_at = excluded.connected_at,
      updated_at = now(),
      last_synced_at = excluded.last_synced_at,
      expires_at = excluded.expires_at,
      granted_scopes = excluded.granted_scopes,
      provider_metadata = excluded.provider_metadata;

  if old_secret_id is not null and old_secret_id <> new_secret_id then
    delete from vault.secrets where id = old_secret_id;
  end if;
  return new_secret_id;
end;
$$;

create or replace function public.app_server_read_gmail_credentials(p_actor_id uuid)
returns table (credential_reference uuid, credentials jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration_admin_actor(p_actor_id);
  return query
  select reference_row.vault_secret_id, decrypted.decrypted_secret::jsonb
  from private.integration_credential_references as reference_row
  join vault.decrypted_secrets as decrypted on decrypted.id = reference_row.vault_secret_id
  join public.integration_connections as connection_row on connection_row.provider = reference_row.provider
  where reference_row.provider = 'gmail'
    and connection_row.status = 'connected';
end;
$$;

create or replace function public.app_server_read_gmail_credentials_for_administration(p_actor_id uuid)
returns table (credential_reference uuid, credentials jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration_admin_actor(p_actor_id);
  return query
  select reference_row.vault_secret_id, decrypted.decrypted_secret::jsonb
  from private.integration_credential_references as reference_row
  join vault.decrypted_secrets as decrypted on decrypted.id = reference_row.vault_secret_id
  where reference_row.provider = 'gmail';
end;
$$;

create or replace function public.app_server_update_gmail_credentials(
  p_actor_id uuid,
  p_credentials jsonb,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_secret_id uuid;
  new_secret_id uuid;
begin
  perform private.require_integration_admin_actor(p_actor_id);
  if not private.gmail_credentials_are_valid(p_credentials) or p_expires_at is null then
    raise exception 'invalid Gmail credential payload' using errcode = '22023';
  end if;
  select vault_secret_id into old_secret_id
  from private.integration_credential_references
  where provider = 'gmail'
  for update;
  if old_secret_id is null then
    raise exception 'Gmail credential is not connected' using errcode = 'P0002';
  end if;
  new_secret_id := vault.create_secret(
    p_credentials::text,
    'wolf-forge:gmail:' || gen_random_uuid()::text,
    'Wolf Forge Gmail OAuth credential',
    null
  );
  update private.integration_credential_references
  set vault_secret_id = new_secret_id, updated_at = now()
  where provider = 'gmail';
  update public.integration_connections
  set expires_at = p_expires_at,
      granted_scopes = array(select jsonb_array_elements_text(p_credentials#>'{payload,scopes}')),
      updated_at = now()
  where provider = 'gmail' and status = 'connected';
  delete from vault.secrets where id = old_secret_id;
end;
$$;

create or replace function public.app_server_verify_gmail_connection(p_actor_id uuid, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_integration_admin_actor(p_actor_id);
  update public.integration_connections
  set last_synced_at = now(), expires_at = p_expires_at, updated_at = now()
  where provider = 'gmail' and status = 'connected';
  if not found then raise exception 'Gmail connection is not connected' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.app_server_set_gmail_status(p_actor_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_integration_admin_actor(p_actor_id);
  if p_status not in ('expired', 'error') then raise exception 'invalid Gmail status' using errcode = '22023'; end if;
  update public.integration_connections set status = p_status, updated_at = now()
  where provider = 'gmail';
end;
$$;

create or replace function public.app_server_disconnect_gmail(p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_secret_id uuid;
begin
  perform private.require_integration_admin_actor(p_actor_id);
  select vault_secret_id into old_secret_id
  from private.integration_credential_references
  where provider = 'gmail'
  for update;
  delete from private.integration_credential_references where provider = 'gmail';
  if old_secret_id is not null then delete from vault.secrets where id = old_secret_id; end if;
  update public.integration_connections
  set status = 'disconnected', connected_account_id = null,
      connected_account_display = null, connected_by_profile_id = null,
      connected_at = null, updated_at = now(), last_synced_at = null,
      expires_at = null, granted_scopes = '{}'::text[], provider_metadata = '{}'::jsonb
  where provider = 'gmail';
end;
$$;

revoke all on function public.app_server_store_gmail_connection(uuid, jsonb, text, text, text[], timestamptz),
  public.app_server_read_gmail_credentials(uuid),
  public.app_server_read_gmail_credentials_for_administration(uuid),
  public.app_server_update_gmail_credentials(uuid, jsonb, timestamptz),
  public.app_server_verify_gmail_connection(uuid, timestamptz),
  public.app_server_set_gmail_status(uuid, text),
  public.app_server_disconnect_gmail(uuid)
  from public, anon, authenticated;

grant execute on function public.app_server_store_gmail_connection(uuid, jsonb, text, text, text[], timestamptz),
  public.app_server_read_gmail_credentials(uuid),
  public.app_server_read_gmail_credentials_for_administration(uuid),
  public.app_server_update_gmail_credentials(uuid, jsonb, timestamptz),
  public.app_server_verify_gmail_connection(uuid, timestamptz),
  public.app_server_set_gmail_status(uuid, text),
  public.app_server_disconnect_gmail(uuid)
  to service_role;

comment on table private.integration_credential_references is
  'Server-only references to encrypted provider material in Supabase Vault. No credential plaintext is stored in integration_connections.';
