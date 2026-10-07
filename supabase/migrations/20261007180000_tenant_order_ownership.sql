-- Wolf Forge Platform
-- White Label WL-1C.3: Tenant ownership of Orders (client-facing: Projects).
--
-- public.orders gains a NOT NULL tenant_id, and its Client and assignee
-- references become Tenant-relative composite foreign keys, so an Order in one
-- Tenant cannot point at a Client or staff member of another Tenant, even
-- through a trusted write. Tickets that reference an Order must share its
-- Tenant, and a task write is checked against an active internal membership
-- in its Order's Tenant. Later re-homing of orders.tenant_id or membership
-- changes do not revalidate existing tasks (root-ownership policy, KI-107).
--
-- Orders only. order_tasks and the project conversation tables inherit
-- through order_id. RLS, policies, grants, RPCs, notifications, Storage paths
-- and Order numbering are unchanged; cross-Tenant read/write isolation is
-- WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every Client is a Wolf Forge Client and every profile has a Wolf
-- Forge membership (WL-1A mirror). New rows then default to
-- private.identity_tenant_id().
--
-- Deliberately global: service_id (the Services catalog is not Tenant-owned
-- yet) and the invoice_items / form_assignments / form_submissions order_id
-- references, whose domains are not Tenant-owned yet.

alter table public.orders
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint orders_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint orders_tenant_id_id_key unique (tenant_id, id),
  drop constraint orders_company_id_fkey,
  add constraint orders_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete restrict,
  -- Same-Tenant only. Whether the assignee is internal stays with
  -- private.require_internal_assignee() and the permission layer. Deleting a
  -- profile cascades to its memberships and still unassigns the Order.
  drop constraint orders_assigned_to_profile_id_fkey,
  add constraint orders_assigned_to_profile_id_fkey
    foreign key (tenant_id, assigned_to_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete set null (assigned_to_profile_id);

alter table public.orders
  alter column tenant_id set default private.identity_tenant_id();

alter table public.tickets
  drop constraint tickets_order_id_fkey,
  add constraint tickets_order_id_fkey
    foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id)
    on delete restrict;

-- -----------------------------------------------------------------------------
-- Order task assignee belongs to the Order's Tenant
-- -----------------------------------------------------------------------------

-- order_tasks has no tenant_id, so the Tenant comes from the parent Order.
-- Runs beside the shared global private.require_internal_assignee(), which is
-- unchanged, and also on order_id so a task cannot be moved under another
-- Tenant's Order with its assignee. Same error contract as the global check.
create function private.require_order_task_tenant_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to_profile_id is not null
    and not exists (
      select 1
      from public.orders as order_row
      join public.tenant_memberships as membership
        on membership.tenant_id = order_row.tenant_id
      where order_row.id = new.order_id
        and membership.profile_id = new.assigned_to_profile_id
        and membership.account_class = 'internal'
        and membership.archived_at is null
    )
  then
    raise exception 'assignee must be an active internal profile'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.require_order_task_tenant_assignee() from public, anon, authenticated, service_role;

create trigger order_tasks_require_tenant_assignee
before insert or update of assigned_to_profile_id, order_id on public.order_tasks
for each row
execute function private.require_order_task_tenant_assignee();
