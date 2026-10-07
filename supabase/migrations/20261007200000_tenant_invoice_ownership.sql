-- Wolf Forge Platform
-- White Label WL-1C.5: Tenant ownership of Invoices.
--
-- public.invoices gains a NOT NULL tenant_id, and its Client and client
-- profile references become Tenant-relative composite foreign keys, so an
-- Invoice in one Tenant cannot bill a Client or person of another Tenant, even
-- through a trusted write.
--
-- Invoice children carry no tenant_id and inherit through invoice_id:
-- - invoice_items: a trigger checks the item's Order and Service against the
--   Invoice's Tenant (both domains are Tenant-owned, the item is not).
-- - invoice_payments: inherit directly.
-- - invoice_refunds: the refunded payment must belong to the same Invoice.
-- - company_wallet_transactions (Tenant via company_id): an invoice-payment
--   entry must cite an Invoice of the same Client and a payment of that
--   Invoice. The application already writes exactly that
--   (app_pay_invoice_with_wallet, app_refund_invoice); the keys make it hold for
--   trusted writes too, which keeps every ledger link inside one Tenant.
-- Later re-homing of a root's tenant_id does not revalidate existing items
-- (root-ownership policy, KI-107).
--
-- RLS, policies, grants, RPCs, notifications and invoice numbering are
-- unchanged; invoice_number stays one global collision-safe sequence and
-- Tenant-specific numbering is branding (deferred). Cross-Tenant read/write
-- isolation is WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every Client, Order and Service is Wolf Forge's and every profile has
-- a Wolf Forge membership (WL-1A mirror). New rows then default to
-- private.identity_tenant_id().
--
-- Deliberately global: the created_by / updated_by actor columns, and
-- subscription_cycles.invoice_id (Subscriptions are not Tenant-owned yet).

alter table public.invoices
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint invoices_tenant_id_fkey references public.tenants (id) on delete restrict,
  add constraint invoices_tenant_id_id_key unique (tenant_id, id),
  add constraint invoices_id_company_id_key unique (id, company_id),
  drop constraint invoices_company_id_fkey,
  add constraint invoices_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete restrict,
  -- Same-Tenant only. Whether the person is an active client of the Client
  -- stays with private.require_invoice_client_consistency().
  drop constraint invoices_client_profile_id_fkey,
  add constraint invoices_client_profile_id_fkey
    foreign key (tenant_id, client_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete set null (client_profile_id);

alter table public.invoices
  alter column tenant_id set default private.identity_tenant_id();

alter table public.invoice_payments
  add constraint invoice_payments_id_invoice_id_key unique (id, invoice_id);

alter table public.invoice_refunds
  drop constraint invoice_refunds_invoice_payment_id_fkey,
  add constraint invoice_refunds_invoice_payment_id_fkey
    foreign key (invoice_payment_id, invoice_id)
    references public.invoice_payments (id, invoice_id)
    on delete restrict;

alter table public.company_wallet_transactions
  drop constraint company_wallet_transactions_invoice_id_fkey,
  add constraint company_wallet_transactions_invoice_id_fkey
    foreign key (invoice_id, company_id)
    references public.invoices (id, company_id)
    on delete restrict,
  drop constraint company_wallet_transactions_invoice_payment_id_fkey,
  add constraint company_wallet_transactions_invoice_payment_id_fkey
    foreign key (invoice_payment_id, invoice_id)
    references public.invoice_payments (id, invoice_id)
    on delete restrict;

-- -----------------------------------------------------------------------------
-- Invoice items bill Orders and Services of the Invoice's Tenant only
-- -----------------------------------------------------------------------------

create function private.require_invoice_item_tenant_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.order_id is not null or new.service_id is not null)
    and not exists (
      select 1
      from public.invoices as invoice_row
      where invoice_row.id = new.invoice_id
        and (new.order_id is null or exists (
          select 1 from public.orders as order_row
          where order_row.id = new.order_id
            and order_row.tenant_id = invoice_row.tenant_id
        ))
        and (new.service_id is null or exists (
          select 1 from public.services as service_row
          where service_row.id = new.service_id
            and service_row.tenant_id = invoice_row.tenant_id
        ))
    )
  then
    raise exception 'invoice item must reference an order and service of the invoice''s tenant'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.require_invoice_item_tenant_references() from public, anon, authenticated, service_role;

create trigger invoice_items_require_tenant_references
before insert or update of invoice_id, order_id, service_id on public.invoice_items
for each row
execute function private.require_invoice_item_tenant_references();
