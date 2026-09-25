-- Wolf Forge Platform - client welcome email (KI-091)
--
-- A client portal account can be created without a password. The client gets
-- one welcome email, sent through the connected Gmail account, carrying a
-- single-use link to set their own password. No password is ever emailed.
--
-- One row per client profile is both the delivery record and the activation
-- credential:
--   claim     one in-flight send per client (10-minute lease), a 1-minute
--             cooldown after a success, and request-id idempotency, so a retry
--             or a double click cannot send twice. The claim also stores the
--             SHA-256 of the new link, replacing any earlier link, BEFORE the
--             email is sent: once Gmail has the message, no later write has to
--             succeed for the link to work. The token itself exists only in
--             the sending server's memory until Gmail accepts it;
--   finish    records sent or failed (cooldown and bookkeeping only);
--   find /
--   complete  the link sets a password once, within 7 days.
--
-- Sending requires BOTH client_private.manage (client account administration)
-- and integrations.manage, the only authority allowed to use the Gmail
-- credential (D-121). No new credential path exists: the Gmail read RPC keeps
-- enforcing integrations.manage on its own.

create table private.client_welcome_emails (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'failed')),
  request_id uuid not null,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  send_count integer not null default 0 check (send_count >= 0),
  failure_code text check (failure_code ~ '^[a-z_]{1,64}$'),
  activation_token_hash text unique check (activation_token_hash ~ '^[0-9a-f]{64}$'),
  activation_expires_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on table private.client_welcome_emails
  from public, anon, authenticated, service_role;

create or replace function private.require_client_welcome_sender(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.integration_actor_can_manage(p_actor_id)
    or not private.profile_has_permission(p_actor_id, 'client_private.manage')
  then
    raise exception 'permission denied: client welcome email' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.app_server_claim_client_welcome_email(
  p_actor_id uuid,
  p_profile_id uuid,
  p_request_id uuid,
  p_token_hash text
)
returns table (outcome text, recipient_email text, recipient_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing private.client_welcome_emails;
  login_email text;
begin
  perform private.require_client_welcome_sender(p_actor_id);

  if p_request_id is null or p_token_hash is null then
    raise exception 'request id and token hash required' using errcode = '22023';
  end if;

  select auth_user.email into login_email
  from auth.users as auth_user
  where auth_user.id = p_profile_id
    and private.profile_account_class(p_profile_id) = 'client';

  if login_email is null then
    raise exception 'client portal login not found' using errcode = 'P0002';
  end if;

  select * into existing
  from private.client_welcome_emails as welcome
  where welcome.profile_id = p_profile_id
  for update;

  if found then
    if existing.activated_at is not null then
      return query select 'activated'::text, null::text, null::text;
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
        null::text;
      return;
    end if;

    -- Longer than any request can live (Vercel's default maxDuration is 300s),
    -- so a slow send is always dead before its lease expires and a second
    -- claim can never overlap it. Keep above maxDuration if that is raised.
    if existing.status = 'sending' and existing.claimed_at > now() - interval '10 minutes' then
      return query select 'in_progress'::text, null::text, null::text;
      return;
    end if;

    if existing.status = 'sent' and existing.sent_at > now() - interval '1 minute' then
      return query select 'recently_sent'::text, null::text, null::text;
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
    where profile_id = p_profile_id;
  else
    insert into private.client_welcome_emails (
      profile_id, status, request_id, claimed_by, activation_token_hash, activation_expires_at
    )
    values (p_profile_id, 'sending', p_request_id, p_actor_id, p_token_hash, now() + interval '7 days')
    on conflict (profile_id) do nothing;

    -- A concurrent first claim won the insert.
    if not found then
      return query select 'in_progress'::text, null::text, null::text;
      return;
    end if;
  end if;

  return query
  select 'claimed'::text, login_email, profile_row.display_name
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
    and request_id = p_request_id
    and claimed_by = p_actor_id
    and status = 'sending';
$$;

create or replace function public.app_server_find_client_activation(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select welcome.profile_id
  from private.client_welcome_emails as welcome
  where welcome.activation_token_hash = p_token_hash
    and welcome.activation_expires_at > now()
    and private.profile_account_class(welcome.profile_id) = 'client';
$$;

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

revoke all on function private.require_client_welcome_sender(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.app_server_claim_client_welcome_email(uuid, uuid, uuid, text),
  public.app_server_finish_client_welcome_email(uuid, uuid, uuid, text),
  public.app_server_find_client_activation(text),
  public.app_server_complete_client_activation(uuid, text)
  from public, anon, authenticated;

grant execute on function public.app_server_claim_client_welcome_email(uuid, uuid, uuid, text),
  public.app_server_finish_client_welcome_email(uuid, uuid, uuid, text),
  public.app_server_find_client_activation(text),
  public.app_server_complete_client_activation(uuid, text)
  to service_role;

comment on table private.client_welcome_emails is
  'One row per client portal profile: welcome email delivery state and the SHA-256 hash of its single-use set-password link. Server-only.';
