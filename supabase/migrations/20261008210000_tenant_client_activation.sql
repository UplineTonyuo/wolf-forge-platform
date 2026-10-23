-- WL-2.22c (KI-105 activation slice): the client welcome-email / activation
-- record is Tenant-owned, and its set-password link carries that Tenant's
-- verified canonical host.
--
-- Before: the four RPCs run as service_role with no auth.uid(), so
-- private.identity_tenant_id() resolves the Wolf Forge mirror: sender
-- authority and the recipient's account class were evaluated in Wolf Forge,
-- and the email origin came from the deployment's Gmail OAuth redirect URI.
-- A Tenant B activation was impossible (sender refused or recipient "not a
-- client" in Wolf Forge) and any link it produced would point at the Wolf
-- Forge host.
--
-- After: the claim / finish / find RPCs take an explicit Tenant id. Sender
-- authority, recipient class and membership are evaluated in that Tenant
-- (the same override / preset evaluation private.profile_has_permission
-- already does, parameterized), and the claim resolves the Tenant's verified,
-- enabled canonical host from public.tenant_domains (D-287) and returns it
-- for the link. No verified host -> 'no_verified_host' outcome and no write
-- (fail closed, never the Wolf Forge host). Activation lookup requires the
-- record's Tenant, so a link can only be spent on its own Tenant's host.
--
-- Legitimate Wolf Forge activation is unchanged: the WF selector (loopback
-- dev or a verified WF host) passes the Wolf Forge Tenant, whose seeded
-- tenant_domains rows exist. Local dev links therefore carry the seeded
-- production host; the token only exists in the local database.
-- Public Form submissions are untouched.
--
-- Hosted precheck before apply (the same gate as 20261008040000):
--   select count(*) from public.tenants where id <> 'f0f0f0f0-0000-4000-8000-000000000001';
-- must be 0, otherwise map any existing client_welcome_emails rows to their
-- profile's membership Tenant first; this migration refuses to guess.

alter table private.client_welcome_emails
  add column tenant_id uuid;

do $$
begin
  if exists (select 1 from public.tenants where id <> private.wolf_forge_tenant_id())
     and exists (select 1 from private.client_welcome_emails) then
    raise exception 'welcome rows exist with a non-Wolf-Forge Tenant present; map each row to its profile membership Tenant first';
  end if;
end;
$$;

update private.client_welcome_emails
set tenant_id = private.wolf_forge_tenant_id()
where tenant_id is null;

alter table private.client_welcome_emails
  alter column tenant_id set not null,
  drop constraint client_welcome_emails_pkey,
  add constraint client_welcome_emails_pkey
    primary key (profile_id, tenant_id),
  add constraint client_welcome_emails_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete restrict;

-- The existing permission evaluation, parameterized so trusted service-role
-- code can evaluate a membership's permissions in an explicit Tenant instead
-- of the identity_tenant_id() context (the Wolf Forge mirror with no user).
create or replace function private.profile_has_permission_in_tenant(
  p_profile_id uuid,
  p_tenant_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select
        case
          when preset_row.key = 'owner'
            then true

          else coalesce(
            (
              select profile_override.allowed
              from public.profile_permission_overrides as profile_override
              where profile_override.tenant_id = membership_row.tenant_id
                and profile_override.profile_id = membership_row.profile_id
                and profile_override.permission_key = p_permission_key
            ),
            (
              select preset_grant.allowed
              from public.role_permissions as preset_grant
              where preset_grant.role_id = membership_row.role_id
                and preset_grant.permission_key = p_permission_key
            ),
            false
          )
        end

      from public.tenant_memberships as membership_row

      join public.permission_presets as preset_row
        on preset_row.role_id = membership_row.role_id

      where membership_row.tenant_id = p_tenant_id
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null

        and exists (
          select 1
          from public.permissions as permission
          where permission.permission_key = p_permission_key
        )
    ),
    false
  );
$$;

create or replace function private.profile_has_permission(p_profile_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_has_permission_in_tenant(
    p_profile_id,
    (select private.identity_tenant_id()),
    p_permission_key
  );
$$;

revoke all on function private.profile_has_permission_in_tenant(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Sending still requires BOTH client_private.manage and integrations.manage
-- (D-121), evaluated in the activation Tenant's membership, and the sender
-- must hold an internal-class membership there — the same hard gate the old
-- Wolf-Forge-only integration_actor_can_manage enforced through its role
-- whitelist, now per Tenant. The Wolf-Forge-only
-- private.integration_actor_can_manage stays untouched (KI-115, D-270).
-- The original single-argument sender check must not linger either: its
-- body still evaluates authority in the Wolf Forge mirror only.
drop function if exists private.require_client_welcome_sender(uuid);

create or replace function private.require_client_welcome_sender(p_actor_id uuid, p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.tenant_memberships as membership_row
    where membership_row.tenant_id = p_tenant_id
      and membership_row.profile_id = p_actor_id
      and membership_row.archived_at is null
      and membership_row.account_class = 'internal'
  )
    or not private.profile_has_permission_in_tenant(p_actor_id, p_tenant_id, 'integrations.manage')
    or not private.profile_has_permission_in_tenant(p_actor_id, p_tenant_id, 'client_private.manage')
  then
    raise exception 'permission denied: client welcome email' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_client_welcome_sender(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The Tenant-aware signatures replace the originals; the old argument lists
-- must not linger (their bodies reference the old primary key).
drop function if exists public.app_server_claim_client_welcome_email(uuid, uuid, uuid, text);
drop function if exists public.app_server_finish_client_welcome_email(uuid, uuid, uuid, text);
drop function if exists public.app_server_find_client_activation(text);

create or replace function public.app_server_claim_client_welcome_email(
  p_actor_id uuid,
  p_profile_id uuid,
  p_tenant_id uuid,
  p_request_id uuid,
  p_token_hash text
)
returns table (outcome text, recipient_email text, recipient_name text, canonical_host text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing private.client_welcome_emails;
  login_email text;
  resolved_host text;
begin
  perform private.require_client_welcome_sender(p_actor_id, p_tenant_id);

  if p_request_id is null or p_token_hash is null then
    raise exception 'request id and token hash required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenants as tenant_row
    where tenant_row.id = p_tenant_id
      and tenant_row.status = 'active'
      and tenant_row.archived_at is null
  ) then
    raise exception 'tenant unavailable' using errcode = '42501';
  end if;

  -- The link's host is this Tenant's verified, enabled canonical host only;
  -- the earliest-created verified host wins, so a lapsed domain must be
  -- disabled or removed by an operator.
  select domain_row.host into resolved_host
  from public.tenant_domains as domain_row
  where domain_row.tenant_id = p_tenant_id
    and domain_row.verified_at is not null
    and domain_row.disabled_at is null
  order by domain_row.created_at, domain_row.host
  limit 1;

  if resolved_host is null then
    return query select 'no_verified_host'::text, null::text, null::text, null::text;
    return;
  end if;

  select auth_user.email into login_email
  from auth.users as auth_user
  join public.tenant_memberships as membership_row
    on membership_row.profile_id = auth_user.id
   and membership_row.tenant_id = p_tenant_id
   and membership_row.archived_at is null
   and membership_row.account_class = 'client'
  where auth_user.id = p_profile_id;

  if login_email is null then
    raise exception 'client portal login not found' using errcode = 'P0002';
  end if;

  select * into existing
  from private.client_welcome_emails as welcome
  where welcome.profile_id = p_profile_id
    and welcome.tenant_id = p_tenant_id
  for update;

  if found then
    if existing.activated_at is not null then
      return query select 'activated'::text, null::text, null::text, null::text;
      return;
    end if;

    -- The same request again reports what that request already did.
    -- ponytail: only the latest request id is kept; a late replay of an older
    -- one falls through to the lease and cooldown below. Add a request log if
    -- replays ever arrive later than the cooldown.
    if existing.request_id = p_request_id then
      return query select
        case existing.status when 'sending' then 'in_progress' else existing.status end,
        null::text,
        null::text,
        null::text;
      return;
    end if;

    -- Longer than any request can live (Vercel's default maxDuration is 300s),
    -- so a slow send is always dead before its lease expires and a second
    -- claim can never overlap it. Keep above maxDuration if that is raised.
    if existing.status = 'sending' and existing.claimed_at > now() - interval '10 minutes' then
      return query select 'in_progress'::text, null::text, null::text, null::text;
      return;
    end if;

    if existing.status = 'sent' and existing.sent_at > now() - interval '1 minute' then
      return query select 'recently_sent'::text, null::text, null::text, null::text;
      return;
    end if;

    update private.client_welcome_emails
    set status = 'sending',
        request_id = p_request_id,
        claimed_by = p_actor_id,
        claimed_at = now(),
        failure_code = null,
        activation_token_hash = p_token_hash,
        -- Keep in step with ACTIVATION_LINK_DAYS in src/lib/email/client-welcome-email.ts.
        activation_expires_at = now() + interval '7 days',
        updated_at = now()
    where profile_id = p_profile_id
      and tenant_id = p_tenant_id;
  else
    insert into private.client_welcome_emails (
      profile_id, tenant_id, status, request_id, claimed_by, activation_token_hash, activation_expires_at
    )
    values (p_profile_id, p_tenant_id, 'sending', p_request_id, p_actor_id, p_token_hash, now() + interval '7 days')
    on conflict (profile_id, tenant_id) do nothing;

    -- A concurrent first claim won the insert.
    if not found then
      return query select 'in_progress'::text, null::text, null::text, null::text;
      return;
    end if;
  end if;

  return query
  select 'claimed'::text, login_email, profile_row.display_name, resolved_host
  from public.profiles as profile_row
  where profile_row.id = p_profile_id;
end;
$$;

-- A null failure code records a send Gmail accepted. The link is untouched
-- either way: after a failure it stays live, since Gmail may still have sent
-- the message, and its token was never known outside the sending server.
create or replace function public.app_server_finish_client_welcome_email(
  p_actor_id uuid,
  p_profile_id uuid,
  p_tenant_id uuid,
  p_request_id uuid,
  p_failure_code text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  -- Bound to the claim this server holds; the claim already authorized the actor.
  update private.client_welcome_emails
  set status = case when p_failure_code is null then 'sent' else 'failed' end,
      sent_at = case when p_failure_code is null then now() else sent_at end,
      send_count = send_count + case when p_failure_code is null then 1 else 0 end,
      failure_code = p_failure_code,
      updated_at = now()
  where profile_id = p_profile_id
    and tenant_id = p_tenant_id
    and request_id = p_request_id
    and claimed_by = p_actor_id
    and status = 'sending';
$$;

create or replace function public.app_server_find_client_activation(
  p_token_hash text,
  p_tenant_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select welcome.profile_id
  from private.client_welcome_emails as welcome
  where welcome.activation_token_hash = p_token_hash
    and welcome.tenant_id = p_tenant_id
    and welcome.activation_expires_at > now()
    and exists (
      select 1
      from public.tenant_memberships as membership_row
      join public.tenants as tenant_row
        on tenant_row.id = membership_row.tenant_id
       and tenant_row.status = 'active'
       and tenant_row.archived_at is null
      where membership_row.profile_id = welcome.profile_id
        and membership_row.tenant_id = p_tenant_id
        and membership_row.archived_at is null
        and membership_row.account_class = 'client'
    );
$$;

-- Unchanged: spends the exact (profile, token hash) the find resolved; the
-- hash is globally unique, so no Tenant argument can cross this spend.
create or replace function public.app_server_complete_client_activation(
  p_profile_id uuid,
  p_token_hash text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update private.client_welcome_emails
  set activated_at = now(),
      activation_token_hash = null,
      activation_expires_at = null,
      updated_at = now()
  where profile_id = p_profile_id
    and activation_token_hash = p_token_hash;
$$;

revoke all on function public.app_server_claim_client_welcome_email(uuid, uuid, uuid, uuid, text),
  public.app_server_finish_client_welcome_email(uuid, uuid, uuid, uuid, text),
  public.app_server_find_client_activation(text, uuid),
  public.app_server_complete_client_activation(uuid, text)
  from public, anon, authenticated;

grant execute on function public.app_server_claim_client_welcome_email(uuid, uuid, uuid, uuid, text),
  public.app_server_finish_client_welcome_email(uuid, uuid, uuid, uuid, text),
  public.app_server_find_client_activation(text, uuid),
  public.app_server_complete_client_activation(uuid, text)
  to service_role;

comment on table private.client_welcome_emails is
  'One row per client profile per Tenant: welcome email delivery state and the SHA-256 hash of its single-use set-password link. Server-only.';
