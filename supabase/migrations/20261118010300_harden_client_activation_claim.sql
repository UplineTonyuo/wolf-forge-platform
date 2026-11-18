-- Reserve the invite before the external Auth password write. Only a confirmed
-- rejection may release it. An uncertain write leaves the invite reserved.
alter table private.client_welcome_emails
  add column activation_claim_id uuid;

create function public.app_server_claim_client_activation(
  p_token_hash text,
  p_tenant_id uuid,
  p_claim_id uuid
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  update private.client_welcome_emails as welcome
  set activation_claim_id = p_claim_id, updated_at = now()
  where p_claim_id is not null
    and welcome.activation_token_hash = p_token_hash
    and welcome.tenant_id = p_tenant_id
    and welcome.activation_expires_at > now()
    and welcome.activated_at is null
    and welcome.activation_claim_id is null
    and exists (
      select 1
      from public.tenant_memberships as membership
      join public.tenants as tenant on tenant.id = membership.tenant_id
        and tenant.status = 'active'
        and tenant.archived_at is null
      where membership.profile_id = welcome.profile_id
        and membership.tenant_id = welcome.tenant_id
        and membership.archived_at is null
        and membership.account_class = 'client'
    )
  returning welcome.profile_id;
$$;

create function public.app_server_finish_client_activation(
  p_profile_id uuid,
  p_tenant_id uuid,
  p_claim_id uuid,
  p_result text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_result = 'weak_password' then
    update private.client_welcome_emails
    set activation_claim_id = null, updated_at = now()
    where profile_id = p_profile_id and tenant_id = p_tenant_id
      and activation_claim_id = p_claim_id and activated_at is null;
    return found;
  end if;

  if p_result is distinct from 'activated' then
    return false;
  end if;

  update private.client_welcome_emails
  set activated_at = now(), activation_token_hash = null,
      activation_expires_at = null, updated_at = now()
  where profile_id = p_profile_id and tenant_id = p_tenant_id
    and activation_claim_id = p_claim_id and activated_at is null;
  if found then
    return true;
  end if;

  -- A repeated completion for the same claim can confirm the committed result.
  return exists (
    select 1 from private.client_welcome_emails
    where profile_id = p_profile_id and tenant_id = p_tenant_id
      and activation_claim_id = p_claim_id and activated_at is not null
  );
end;
$$;

create function private.protect_client_activation_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id is distinct from old.request_id
    or (
      new.activated_at is null
      and (
        new.activation_token_hash is distinct from old.activation_token_hash
        or new.activation_expires_at is distinct from old.activation_expires_at
      )
    )
  then
    raise exception 'Client activation must be reconciled before issuing another link'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

-- A welcome resend must never replace a link while its Auth write is unresolved.
create trigger protect_client_activation_claim
before update of request_id, activation_token_hash, activation_expires_at
on private.client_welcome_emails
for each row
when (old.activation_claim_id is not null and old.activated_at is null)
execute function private.protect_client_activation_claim();

revoke all on function private.protect_client_activation_claim()
  from public, anon, authenticated, service_role;
revoke all on function public.app_server_claim_client_activation(text, uuid, uuid),
  public.app_server_finish_client_activation(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_server_claim_client_activation(text, uuid, uuid),
  public.app_server_finish_client_activation(uuid, uuid, uuid, text)
  to service_role;

-- An older deployed server must fail closed instead of writing an unclaimed password.
drop function public.app_server_find_client_activation(text, uuid);
drop function public.app_server_complete_client_activation(uuid, text);
