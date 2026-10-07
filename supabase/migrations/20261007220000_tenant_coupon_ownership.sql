-- Wolf Forge Platform
-- White Label WL-1C.7: Tenant ownership of Coupons.
--
-- public.coupons gains a NOT NULL tenant_id. Coupon redemptions carry their own
-- tenant_id, and their coupon, Client and customer references become
-- Tenant-relative composite foreign keys, so a redemption in one Tenant cannot
-- spend another Tenant's coupon or be booked against another Tenant's Client or
-- person, even through a trusted write.
--
-- Discount rules and their service lists carry no tenant_id and inherit
-- through coupon_id. A rule's services reference another Tenant-owned root,
-- so a trigger checks each against the coupon's Tenant. Subscription plan items
-- now also check their coupon against the Subscription's Tenant (WL-1C.6
-- deferred this). Rules are replaced by delete + insert
-- (private.replace_coupon_discount_rules) and no API role can update them, so
-- re-pointing a rule to another coupon is not revalidated, like later
-- re-homing of any root's tenant_id (root-ownership policy, KI-107).
--
-- RLS, policies, grants, RPCs, notifications and coupon lookup are unchanged.
-- coupons.code stays globally unique and private.calculate_coupon still looks
-- codes up globally: a Tenant B checkout that names a Wolf Forge code now fails
-- closed at the redemption key. Per-Tenant codes and lookup isolation are
-- WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every coupon, Client and Service is Wolf Forge's and every profile has
-- a Wolf Forge membership (WL-1A mirror). New rows then default to
-- private.identity_tenant_id().
--
-- Deliberately global: the created_by / updated_by / archived_by actor
-- columns.

alter table public.coupons
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint coupons_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint coupons_tenant_id_id_key unique (tenant_id, id);

alter table public.coupons
  alter column tenant_id set default private.identity_tenant_id();

-- Redemptions are append-only; only the column-list SET NULL actions below may
-- touch an existing row (private.prevent_coupon_redemption_mutation).
alter table public.coupon_redemptions
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint coupon_redemptions_tenant_id_fkey references public.tenants (id) on delete restrict,
  drop constraint coupon_redemptions_coupon_id_fkey,
  add constraint coupon_redemptions_coupon_id_fkey
    foreign key (tenant_id, coupon_id)
    references public.coupons (tenant_id, id)
    on delete restrict,
  drop constraint coupon_redemptions_company_id_fkey,
  add constraint coupon_redemptions_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete set null (company_id),
  -- Same-Tenant only. Whether the person belongs to the Client stays with
  -- private.prepare_coupon_redemption().
  drop constraint coupon_redemptions_customer_profile_id_fkey,
  add constraint coupon_redemptions_customer_profile_id_fkey
    foreign key (tenant_id, customer_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete set null (customer_profile_id);

alter table public.coupon_redemptions
  alter column tenant_id set default private.identity_tenant_id();

-- -----------------------------------------------------------------------------
-- Discount rule services and plan item coupons belong to the owning Tenant
-- -----------------------------------------------------------------------------

create function private.require_coupon_discount_service_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.coupon_discount_rules as rule_row
    join public.coupons as coupon_row
      on coupon_row.id = rule_row.coupon_id
    join public.services as service_row
      on service_row.tenant_id = coupon_row.tenant_id
    where rule_row.id = new.coupon_discount_rule_id
      and service_row.id = new.service_id
  )
  then
    raise exception 'coupon discount service must be a service of the coupon''s tenant'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.require_coupon_discount_service_tenant() from public, anon, authenticated, service_role;

create trigger coupon_discount_services_require_tenant_service
before insert or update of coupon_discount_rule_id, service_id on public.coupon_discount_services
for each row
execute function private.require_coupon_discount_service_tenant();

-- Kept under its WL-1C.6 name; it now checks the plan item coupon too.
create or replace function private.require_subscription_plan_item_tenant_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_id is not null
    and not exists (
      select 1
      from public.subscription_plan_versions as plan_row
      join public.subscriptions as subscription_row
        on subscription_row.id = plan_row.subscription_id
      join public.services as service_row
        on service_row.tenant_id = subscription_row.tenant_id
      where plan_row.id = new.plan_version_id
        and service_row.id = new.service_id
    )
  then
    raise exception 'subscription plan item must reference a service of the subscription''s tenant'
      using errcode = '23514';
  end if;

  if new.coupon_id is not null
    and not exists (
      select 1
      from public.subscription_plan_versions as plan_row
      join public.subscriptions as subscription_row
        on subscription_row.id = plan_row.subscription_id
      join public.coupons as coupon_row
        on coupon_row.tenant_id = subscription_row.tenant_id
      where plan_row.id = new.plan_version_id
        and coupon_row.id = new.coupon_id
    )
  then
    raise exception 'subscription plan item must reference a coupon of the subscription''s tenant'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
