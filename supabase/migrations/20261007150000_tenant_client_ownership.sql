-- Wolf Forge Platform
-- White Label WL-1C.1: Tenant ownership of Clients, contacts and Companies.
--
-- companies, client_contacts, organizations and organization_members gain a
-- NOT NULL tenant_id. Composite (tenant_id, ...) foreign keys make a row in
-- one Tenant unable to point at a Client, contact, Company or membership of
-- another Tenant.
--
-- Ownership only. RLS, policies and grants are unchanged; cross-Tenant read
-- isolation is WL-2.
--
-- Existing rows belong to the Wolf Forge Tenant. Adding the column with the
-- IMMUTABLE private.wolf_forge_tenant_id() default fills them without an
-- UPDATE, so no row trigger fires and updated_at is untouched. The default is
-- then switched to private.identity_tenant_id() for new rows:
--   signed-in SECURITY DEFINER RPC -> the caller's current Tenant
--   invalid or foreign selector    -> NULL, the insert fails NOT NULL
--   trusted no-user execution      -> Wolf Forge (temporary KI-105 bridge)
--   service_role direct writes     -> cannot execute it; must pass tenant_id
-- The KI-105 dependency must not survive Tenant #2 in background paths.

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------

alter table public.companies
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint companies_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint companies_tenant_id_id_key unique (tenant_id, id);

alter table public.companies
  alter column tenant_id set default private.identity_tenant_id();

-- -----------------------------------------------------------------------------
-- Companies / Teams
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint organizations_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint organizations_tenant_id_id_key unique (tenant_id, id);

alter table public.organizations
  alter column tenant_id set default private.identity_tenant_id();

-- -----------------------------------------------------------------------------
-- Tenant memberships: Client link and the deferred WL-1A invariant
-- -----------------------------------------------------------------------------

-- A membership may only hold a Client of its own Tenant. SET NULL (company_id)
-- keeps today's "deleting a Client clears the membership company" behavior
-- without nulling tenant_id.
--
-- Internal memberships never hold a Client (Production pre-gate: 0 internal
-- profiles with a company_id). account_class is internal or client, so a
-- non-null company_id now implies a client membership.
alter table public.tenant_memberships
  drop constraint tenant_memberships_company_id_fkey,
  add constraint tenant_memberships_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete set null (company_id),
  add constraint tenant_memberships_internal_has_no_company
    check (account_class <> 'internal' or company_id is null),
  add constraint tenant_memberships_tenant_profile_company_key
    unique (tenant_id, profile_id, company_id);

-- -----------------------------------------------------------------------------
-- Client contacts
-- -----------------------------------------------------------------------------

alter table public.client_contacts
  add column tenant_id uuid not null default private.wolf_forge_tenant_id(),
  add constraint client_contacts_tenant_id_id_key unique (tenant_id, id),
  drop constraint client_contacts_company_id_fkey,
  add constraint client_contacts_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete restrict,
  -- A linked portal profile must be a client of this Client in this Tenant.
  -- MATCH SIMPLE: an unlinked contact (profile_id null) is not checked.
  -- Replaces the old triggers below, which read the single global
  -- profiles.company_id and would reject valid links in another Tenant.
  -- Profile changes reach it through the fail-closed WL-1A mirror.
  add constraint client_contacts_profile_membership_fkey
    foreign key (tenant_id, profile_id, company_id)
    references public.tenant_memberships (tenant_id, profile_id, company_id)
    on delete set null (profile_id);

alter table public.client_contacts
  alter column tenant_id set default private.identity_tenant_id();

-- One person may be a contact in several Tenants, once per Tenant.
drop index public.client_contacts_active_profile_id_key;

create unique index client_contacts_active_profile_id_key
on public.client_contacts (tenant_id, profile_id)
where profile_id is not null and archived_at is null;

drop trigger client_contacts_require_profile_consistency on public.client_contacts;
drop trigger profiles_protect_linked_contact_consistency on public.profiles;
drop function private.require_client_contact_profile_consistency();
drop function private.protect_linked_contact_profile_consistency();

-- -----------------------------------------------------------------------------
-- Company / Team membership
-- -----------------------------------------------------------------------------

alter table public.organization_members
  add column tenant_id uuid not null default private.wolf_forge_tenant_id(),
  drop constraint organization_members_organization_id_fkey,
  drop constraint organization_members_contact_id_fkey,
  add constraint organization_members_organization_id_fkey
    foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id)
    on delete cascade,
  add constraint organization_members_contact_id_fkey
    foreign key (tenant_id, contact_id)
    references public.client_contacts (tenant_id, id)
    on delete cascade;

alter table public.organization_members
  alter column tenant_id set default private.identity_tenant_id();
