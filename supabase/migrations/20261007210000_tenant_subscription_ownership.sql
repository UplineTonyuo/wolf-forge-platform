-- Wolf Forge Platform
-- White Label WL-1C.6: Tenant ownership of Subscriptions.
--
-- public.subscriptions gains a NOT NULL tenant_id, and its Client, client
-- person and Service references become Tenant-relative composite foreign keys,
-- so a Subscription in one Tenant cannot bill a Client, person or Service of
-- another Tenant, even through a trusted write.
--
-- Subscription children carry no tenant_id and inherit through
-- subscription_id: plan versions, plan items, cycles, events, dunning attempts
-- and payment methods. Cycles and events are pinned to their own Subscription
-- (plan version, cycle). Two children reference other Tenant-owned roots, so a
-- trigger checks each against the Subscription's Tenant:
-- - subscription_plan_items.service_id (Services are Tenant-owned);
-- - subscription_cycles.invoice_id (Invoices are Tenant-owned).
-- Later re-homing of a root's tenant_id does not revalidate existing children
-- (root-ownership policy, KI-107).
--
-- RLS, policies, grants, RPCs, notifications and public_ref are unchanged;
-- public_ref stays globally unique and collision-safe. Cross-Tenant read/write
-- isolation is WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every Client, Service and Invoice is Wolf Forge's and every profile
-- has a Wolf Forge membership (WL-1A mirror). New rows then default to
-- private.identity_tenant_id().
--
-- Deliberately global: subscription_plan_items.coupon_id (Coupons are not
-- Tenant-owned yet) and the created_by / updated_by / actor columns.

alter table public.subscriptions
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint subscriptions_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint subscriptions_tenant_id_id_key unique (tenant_id, id),
  drop constraint subscriptions_company_id_fkey,
  add constraint subscriptions_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete restrict,
  -- Same-Tenant only. Whether the person is an active client of the Client
  -- stays with private.require_subscription_client_consistency().
  drop constraint subscriptions_client_profile_id_fkey,
  add constraint subscriptions_client_profile_id_fkey
    foreign key (tenant_id, client_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete restrict,
  drop constraint subscriptions_service_id_fkey,
  add constraint subscriptions_service_id_fkey
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id)
    on delete restrict;

alter table public.subscriptions
  alter column tenant_id set default private.identity_tenant_id();

-- A cycle bills its own Subscription's plan, and an event cites a cycle of its
-- own Subscription, so neither can borrow another Tenant's terms or history.
-- The schedulers and event writers already pass matching pairs.
alter table public.subscription_cycles
  add constraint subscription_cycles_id_subscription_id_key unique (id, subscription_id),
  drop constraint subscription_cycles_plan_version_id_fkey,
  add constraint subscription_cycles_plan_version_id_fkey
    foreign key (plan_version_id, subscription_id)
    references public.subscription_plan_versions (id, subscription_id)
    on delete restrict;

alter table public.subscription_events
  drop constraint subscription_events_cycle_id_fkey,
  add constraint subscription_events_cycle_id_fkey
    foreign key (cycle_id, subscription_id)
    references public.subscription_cycles (id, subscription_id)
    on delete restrict;

-- -----------------------------------------------------------------------------
-- Plan items and cycles reference Services and Invoices of the Subscription's
-- Tenant only
-- -----------------------------------------------------------------------------

create function private.require_subscription_plan_item_tenant_service()
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

  return new;
end;
$$;

revoke all on function private.require_subscription_plan_item_tenant_service() from public, anon, authenticated, service_role;

-- Plan items are insert-only (subscription_plan_items_prevent_mutation).
create trigger subscription_plan_items_require_tenant_service
before insert on public.subscription_plan_items
for each row
execute function private.require_subscription_plan_item_tenant_service();

create function private.require_subscription_cycle_tenant_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invoice_id is not null
    and not exists (
      select 1
      from public.subscriptions as subscription_row
      join public.invoices as invoice_row
        on invoice_row.tenant_id = subscription_row.tenant_id
      where subscription_row.id = new.subscription_id
        and invoice_row.id = new.invoice_id
    )
  then
    raise exception 'subscription cycle must reference an invoice of the subscription''s tenant'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.require_subscription_cycle_tenant_invoice() from public, anon, authenticated, service_role;

create trigger subscription_cycles_require_tenant_invoice
before insert or update of invoice_id, subscription_id on public.subscription_cycles
for each row
execute function private.require_subscription_cycle_tenant_invoice();
