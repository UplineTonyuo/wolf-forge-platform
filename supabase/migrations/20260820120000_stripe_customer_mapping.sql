-- Stripe customer mapping — Phase 1.
--
-- Establishes the one durable link between a Wolf Forge company and a Stripe
-- Customer in William's Stripe account. Nothing here moves money: there is no
-- charge, no payment method, no subscription and no webhook. This migration
-- exists so that every later billing phase has one canonical, non-forgeable
-- answer to "which Stripe customer is this client?".
--
-- Wolf Forge remains the billing source of truth. Invoices, plan versions,
-- cycles, pricing, dunning and status all stay where they are; Stripe is only
-- ever the external processor identity.
--
-- Placement note: the id lives on public.companies rather than in a mapping
-- table because the relationship is strictly one-to-one and permanent, and the
-- existing company RLS then scopes it for free — a client can already only see
-- their own company row, so no new read boundary has to be invented.

alter table public.companies
  add column stripe_customer_id text;

-- Unique, but nullable: Postgres allows many NULLs under a unique constraint,
-- which is exactly the "at most one canonical customer" rule.
alter table public.companies
  add constraint companies_stripe_customer_id_unique
    unique (stripe_customer_id);

-- Shape check only. It cannot prove the customer exists in Stripe, but it does
-- stop anything that is obviously not a Stripe customer reference from being
-- stored, including an accidentally pasted secret or price id.
alter table public.companies
  add constraint companies_stripe_customer_id_format check (
    stripe_customer_id is null
    or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  );

comment on column public.companies.stripe_customer_id is
  'Canonical Stripe Customer for this company, or null when none has been provisioned. Written only by app_link_company_stripe_customer; never replaced once set. Not a credential — possessing this identifier grants nothing without the server-side secret key.';

-- -----------------------------------------------------------------------------
-- Write boundary
--
-- public.companies grants `authenticated` SELECT only, so no session can write
-- this column directly today. The trigger is the second lock: if a future
-- migration ever grants UPDATE, the mapping still cannot be edited from an
-- ordinary session, and the only way to set it remains the audited RPC below.
--
-- Keyed on current_user, the same mechanism
-- private.normalize_authenticated_activity_event() already uses: inside a
-- SECURITY DEFINER function current_user is the definer, so the RPC passes
-- while a direct authenticated UPDATE does not.
-- -----------------------------------------------------------------------------

create function private.protect_company_stripe_customer_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
    and new.stripe_customer_id is distinct from old.stripe_customer_id
  then
    raise exception 'the Stripe customer mapping is managed by the billing boundary'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger companies_protect_stripe_customer_id
before update on public.companies
for each row
execute function private.protect_company_stripe_customer_id();

-- -----------------------------------------------------------------------------
-- Linking RPC
--
-- Compare-and-set, never replace.
--
-- The row is locked before the decision, so two concurrent provisioning calls
-- serialise here: the first writes, the second sees the winner and returns it.
-- Whichever caller loses discards its own Stripe customer rather than
-- overwriting the mapping — and because the service creates customers under a
-- company-derived Stripe idempotency key, both callers are normally handed the
-- same customer by Stripe in the first place.
--
-- A caller can therefore never repoint an existing mapping, which is what makes
-- a stray or malicious identifier harmless: the worst it can do is be ignored.
-- -----------------------------------------------------------------------------

create function public.app_link_company_stripe_customer(
  p_company_id uuid,
  p_stripe_customer_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  company_row public.companies;
  candidate text := btrim(coalesce(p_stripe_customer_id, ''));
begin
  if p_company_id is null
    or candidate = ''
    or candidate !~ '^cus_[A-Za-z0-9]+$'
  then
    raise exception 'invalid Stripe customer link input' using errcode = '22023';
  end if;

  -- Internal actor plus the existing billing capability. No client account can
  -- reach this function, and no company id supplied by a browser is trusted
  -- without that capability behind it.
  actor_id := private.require_internal_actor();
  perform private.require_permission('invoices.manage');

  select * into company_row
  from public.companies as existing
  where existing.id = p_company_id
    and existing.archived_at is null
  for update;

  if company_row.id is null then
    raise exception 'active company was not found' using errcode = '42501';
  end if;

  -- Already mapped: the stored value wins, always.
  if company_row.stripe_customer_id is not null then
    return company_row.stripe_customer_id;
  end if;

  update public.companies as target
  set stripe_customer_id = candidate
  where target.id = p_company_id
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company',
    company_row.id,
    'company.stripe_customer_linked',
    format('Linked %s to a Stripe customer.', company_row.name),
    jsonb_build_object('stripe_customer_id', candidate)
  );

  return company_row.stripe_customer_id;
end;
$$;

comment on function public.app_link_company_stripe_customer(uuid, text) is
  'Links a company to its canonical Stripe Customer exactly once. Requires an internal actor holding invoices.manage. Returns the canonical id, which is the existing one when a mapping is already present — this function never replaces a mapping.';

revoke all on function public.app_link_company_stripe_customer(uuid, text)
  from public, anon, service_role;
grant execute on function public.app_link_company_stripe_customer(uuid, text)
  to authenticated;

revoke all on function private.protect_company_stripe_customer_id()
  from public, anon, authenticated, service_role;
