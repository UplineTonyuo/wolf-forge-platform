-- Wolf Forge Platform
-- White Label WL-1C.4: Tenant ownership of the Services catalog.
--
-- public.service_folders and public.services gain a NOT NULL tenant_id, so each
-- Tenant owns its own catalog. Folder nesting, a Service's folder and assignee,
-- and the Service referenced by an Order, an investment Ticket, a store
-- interest or a Form version become Tenant-relative, so one Tenant's catalog
-- cannot be wired into another Tenant's records, even through a trusted write.
--
-- service_interests links a Client to a Service, two Tenant-owned roots, so it
-- carries the shared tenant_id that both composite keys require. Form service
-- links have no tenant_id (Forms keep no composite keys, D-264); a trigger
-- checks the Service against the Form version's Form Tenant instead.
-- Later re-homing of a root's tenant_id does not revalidate existing links
-- (root-ownership policy, KI-107).
--
-- RLS, policies, grants, RPCs, notifications, Storage paths and Wayfront import
-- mappings are unchanged; cross-Tenant read/write isolation is WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every Client, Order, Ticket and Form is Wolf Forge's and every profile
-- has a Wolf Forge membership (WL-1A mirror). New rows then default to
-- private.identity_tenant_id().
--
-- Deliberately global until their domains are Tenant-owned: the Service
-- references from invoice_items, subscriptions, subscription_plan_items,
-- coupon_discount_services, client_reports and
-- private.reported_one_time_deliverables, and the service_interests actor
-- columns.

alter table public.service_folders
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint service_folders_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint service_folders_tenant_id_id_key unique (tenant_id, id),
  drop constraint service_folders_parent_id_fkey,
  add constraint service_folders_parent_id_fkey
    foreign key (tenant_id, parent_id)
    references public.service_folders (tenant_id, id)
    on delete restrict;

alter table public.service_folders
  alter column tenant_id set default private.identity_tenant_id();

alter table public.services
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint services_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint services_tenant_id_id_key unique (tenant_id, id),
  drop constraint services_folder_id_fkey,
  add constraint services_folder_id_fkey
    foreign key (tenant_id, folder_id)
    references public.service_folders (tenant_id, id)
    on delete set null (folder_id),
  -- Same-Tenant only, as for Orders. Whether the assignee is internal stays
  -- with private.require_internal_assignee().
  drop constraint services_assigned_to_profile_id_fkey,
  add constraint services_assigned_to_profile_id_fkey
    foreign key (tenant_id, assigned_to_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete set null (assigned_to_profile_id);

alter table public.services
  alter column tenant_id set default private.identity_tenant_id();

alter table public.orders
  drop constraint orders_service_id_fkey,
  add constraint orders_service_id_fkey
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id)
    on delete restrict;

alter table public.tickets
  drop constraint tickets_investment_service_id_fkey,
  add constraint tickets_investment_service_id_fkey
    foreign key (tenant_id, investment_service_id)
    references public.services (tenant_id, id)
    on delete restrict;

alter table public.service_interests
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint service_interests_tenant_id_fkey references public.tenants (id) on delete restrict,
  drop constraint service_interests_company_id_fkey,
  add constraint service_interests_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete cascade,
  drop constraint service_interests_service_id_fkey,
  add constraint service_interests_service_id_fkey
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id)
    on delete cascade;

alter table public.service_interests
  alter column tenant_id set default private.identity_tenant_id();

-- -----------------------------------------------------------------------------
-- A Form version offers Services of its own Form's Tenant only
-- -----------------------------------------------------------------------------

create function private.require_form_service_link_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.form_versions as version_row
    join public.forms as form_row
      on form_row.id = version_row.form_id
    join public.services as service_row
      on service_row.tenant_id = form_row.tenant_id
    where version_row.id = new.form_version_id
      and service_row.id = new.service_id
  )
  then
    raise exception 'form service link must reference a service of the form''s tenant'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.require_form_service_link_tenant() from public, anon, authenticated, service_role;

create trigger form_service_links_require_tenant_service
before insert or update of service_id, form_version_id on public.form_service_links
for each row
execute function private.require_form_service_link_tenant();
