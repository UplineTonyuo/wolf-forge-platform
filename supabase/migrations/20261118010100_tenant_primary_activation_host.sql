-- Release only after the services host serves WOAD over valid HTTPS and owner login is verified.
alter table public.tenant_domains
  add column is_primary boolean not null default false;

create unique index tenant_domains_one_primary_per_tenant_idx
  on public.tenant_domains (tenant_id)
  where is_primary;

do $$
begin
  update public.tenant_domains
  set is_primary = true
  where tenant_id = private.wolf_forge_tenant_id()
    and host = 'services.wolfforgedigitalagency.com'
    and verified_at is not null
    and disabled_at is null;

  if not found then
    raise exception 'verified enabled Wolf Forge services domain required';
  end if;
end;
$$;

-- Preserve the existing RPC and ACLs. The original ordering describes the
-- fallback when no verified, enabled primary is eligible.
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
  order by domain_row.is_primary desc, domain_row.created_at, domain_row.host
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
