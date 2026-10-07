-- WL-2.11 (KI-111, invoice): every invoice read, state change and financial
-- read requires the invoice to belong to the caller's current Tenant.
--
-- Concrete leaks closed (HIGH, verified live by the WL-2.10 DB review):
--   - app_issue_invoice / app_void_invoice / app_update_invoice acted on any
--     invoice by id: a Tenant B internal with invoices.manage could issue
--     (making collectible), re-price, or void another Tenant's invoice.
--   - app_get_invoice_financials gated only on private.can_read_invoice,
--     which had no Tenant scope: any Tenant's internal (or a client whose
--     global profile pointed at the invoice's Client) could read another
--     Tenant's subtotal, tax, total, paid, refunded, balance and status.
--   - app_create_invoice checked only that the Client company existed, so a
--     Tenant B caller could address a Wolf Forge Client (rejected only later
--     by the composite FK) and create replay lookups could return another
--     Tenant's invoice.
--   - invoices_authorized_internal_select listed every Tenant's invoices.
--
-- Pattern (D-272): tenant_id = (select private.current_tenant_id()) on every
-- lookup of a caller-supplied id; a foreign invoice behaves exactly like a
-- missing one (no_data_found / the same 42501 as an unreadable invoice).
-- private.can_read_invoice additionally resolves the client branch from
-- private.current_user_company_id() (the current-Tenant membership), so a
-- Tenant B client reaches its own Tenant B invoices and never a Wolf Forge
-- invoice; Wolf Forge outcomes are identical (the mirror keeps membership and
-- profile in step).
--
-- Not changed here (verified, out of scope):
--   - private.require_invoice_capability keeps its signature (a capability
--     gate with no invoice id); invoice-belonging is enforced by every caller.
--   - invoice_items inherit their Tenant through invoice_id (no tenant_id
--     added); private.require_invoice_item_tenant_references already binds
--     order_id / service_id to the invoice's Tenant.
--   - private.invoice_amounts / invoice_snapshot / replace_invoice_items are
--     secondary lookups reached only after a Tenant-checked invoice.
--   - private.next_invoice_number stays a global counter (numbering is not an
--     authorization concern; redesign deferred).
--   - Subscriptions (app_generate_subscription_cycle_invoice and the
--     subscription-side billing functions) remain the later slice; the
--     cycle-to-invoice link is already Tenant-guarded by
--     private.require_subscription_cycle_tenant_invoice.
--   - Coupons, dashboard, notifications, Forms, platform billing untouched.

-- -----------------------------------------------------------------------------
-- Shared read helper
-- -----------------------------------------------------------------------------

create or replace function private.can_read_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.invoices as invoice_row
    join public.companies as company_row
      on company_row.id = invoice_row.company_id
     and company_row.archived_at is null
    where invoice_row.id = p_invoice_id
      and invoice_row.tenant_id = (select private.current_tenant_id())
      and invoice_row.archived_at is null
      and (
        (
          (select private.is_internal_user())
          and (
            private.current_user_has_permission('invoices.view')
            or private.current_user_has_permission('invoices.manage')
          )
        )
        or (
          (select private.current_user_company_id()) = invoice_row.company_id
          and private.current_user_has_permission('invoices.view')
        )
      )
  );
$function$;

-- -----------------------------------------------------------------------------
-- Invoice state changes
-- -----------------------------------------------------------------------------

create or replace function public.app_issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  invoice_row public.invoices;
begin
  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
  for update;
  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status <> 'draft' then
    raise exception 'only a draft invoice can be issued' using errcode = '55000';
  end if;
  if invoice_row.due_at is null then
    raise exception 'invoice due date is required before issuance' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice_id) then
    raise exception 'invoice requires at least one line item' using errcode = '22023';
  end if;

  update public.invoices
  set status = case when total_cents = 0 then 'paid' else 'unpaid' end,
      invoice_number = private.next_invoice_number(),
      issued_at = now(),
      updated_by_profile_id = actor_id
  where id = p_invoice_id
  returning * into invoice_row;

  if invoice_row.status = 'paid' then
    update public.invoice_items
    set fulfillment_status = 'pending'
    where invoice_id = p_invoice_id
      and service_id is not null
      and fulfillment_status = 'awaiting_payment';
  end if;

  perform private.record_authenticated_activity(
    'invoice', invoice_row.id, 'invoice.issued',
    format('Issued invoice #%s.', invoice_row.invoice_number),
    jsonb_build_object('invoice', private.invoice_snapshot(invoice_row.id))
  );
  return invoice_row;
end;
$function$;

create or replace function public.app_void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.void');
  invoice_row public.invoices;
  amounts record;
begin
  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
  for update;
  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status not in ('unpaid', 'payment_pending') then
    raise exception 'only an unsettled issued invoice can be voided' using errcode = '55000';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if amounts.gross_paid_cents > 0 or amounts.successful_refunds_cents > 0
    or exists (
      select 1 from public.invoice_payments
      where invoice_id = p_invoice_id and status = 'pending'
    )
  then
    raise exception 'invoice with settled or pending money cannot be voided; refund settled payments instead'
      using errcode = '55000';
  end if;

  update public.invoices
  set status = 'void', voided_at = now(), updated_by_profile_id = actor_id
  where id = p_invoice_id
  returning * into invoice_row;

  perform private.record_authenticated_activity(
    'invoice', invoice_row.id, 'invoice.voided', 'Voided invoice.',
    jsonb_build_object('invoice', private.invoice_snapshot(invoice_row.id))
  );
  return invoice_row;
end;
$function$;

create or replace function public.app_update_invoice(p_invoice_id uuid, p_patch jsonb)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  invoice_row public.invoices;
  before_snapshot jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array[
      'company_id', 'client_profile_id', 'currency', 'billing_reason',
      'due_at', 'tax_total_cents', 'items'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid invoice update patch' using errcode = '22023';
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
  for update;
  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status in ('paid', 'void') then
    raise exception 'paid and void invoices are immutable' using errcode = '55000';
  end if;
  if invoice_row.status <> 'draft'
    and p_patch - array['billing_reason', 'due_at'] <> '{}'::jsonb
  then
    raise exception 'issued invoice financial contents are immutable' using errcode = '55000';
  end if;

  before_snapshot := private.invoice_snapshot(p_invoice_id);

  update public.invoices
  set company_id = case when p_patch ? 'company_id' then (p_patch ->> 'company_id')::uuid else company_id end,
      client_profile_id = case when p_patch ? 'client_profile_id' then nullif(p_patch ->> 'client_profile_id', '')::uuid else client_profile_id end,
      currency = case when p_patch ? 'currency' then upper(p_patch ->> 'currency') else currency end,
      billing_reason = case when p_patch ? 'billing_reason' then nullif(p_patch ->> 'billing_reason', '') else billing_reason end,
      due_at = case when p_patch ? 'due_at' then nullif(p_patch ->> 'due_at', '')::timestamptz else due_at end,
      tax_total_cents = case when p_patch ? 'tax_total_cents' then (p_patch ->> 'tax_total_cents')::bigint else tax_total_cents end,
      total_cents = case when p_patch ? 'tax_total_cents'
        then subtotal_cents - discount_total_cents + (p_patch ->> 'tax_total_cents')::bigint
        else total_cents end,
      updated_by_profile_id = actor_id
  where id = p_invoice_id;

  if p_patch ? 'items' then
    perform private.replace_invoice_items(p_invoice_id, p_patch -> 'items');
  end if;

  select invoice.* into invoice_row from public.invoices as invoice where invoice.id = p_invoice_id;
  perform private.record_authenticated_activity(
    'invoice', invoice_row.id, 'invoice.updated', 'Updated invoice.',
    jsonb_build_object('before', before_snapshot, 'after', private.invoice_snapshot(invoice_row.id))
  );
  return invoice_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- Invoice creation
-- -----------------------------------------------------------------------------

create or replace function public.app_create_invoice(p_request_id uuid, p_payload jsonb)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  existing_id uuid;
  invoice_row public.invoices;
  normalized_currency text;
  initial_status text;
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or not p_payload ? 'company_id'
    or not p_payload ? 'items'
    or p_payload - array[
      'company_id', 'client_profile_id', 'status', 'currency', 'billing_reason',
      'due_at', 'tax_total_cents', 'items'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid invoice create payload' using errcode = '22023';
  end if;

  initial_status := coalesce(p_payload ->> 'status', 'draft');
  normalized_currency := upper(coalesce(p_payload ->> 'currency', 'USD'));

  if initial_status not in ('draft', 'payment_pending')
    or normalized_currency !~ '^[A-Z]{3}$'
    or coalesce((p_payload ->> 'tax_total_cents')::bigint, 0) < 0
  then
    raise exception 'invalid invoice create payload' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(actor_id, 'invoice.create', p_request_id, p_payload);
  if existing_id is not null then
    select invoice.* into invoice_row
    from public.invoices as invoice
    where invoice.id = existing_id
      and invoice.tenant_id = (select private.current_tenant_id());
    if invoice_row.id is null then raise no_data_found; end if;
    return invoice_row;
  end if;

  if not exists (
    select 1 from public.companies as company_row
    where company_row.id = (p_payload ->> 'company_id')::uuid
      and company_row.tenant_id = (select private.current_tenant_id())
      and company_row.archived_at is null
  ) then
    raise no_data_found;
  end if;

  insert into public.invoices (
    company_id, client_profile_id, status, currency, billing_reason, due_at,
    tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id
  ) values (
    (p_payload ->> 'company_id')::uuid,
    nullif(p_payload ->> 'client_profile_id', '')::uuid,
    'draft',
    normalized_currency,
    nullif(p_payload ->> 'billing_reason', ''),
    nullif(p_payload ->> 'due_at', '')::timestamptz,
    coalesce((p_payload ->> 'tax_total_cents')::bigint, 0),
    coalesce((p_payload ->> 'tax_total_cents')::bigint, 0),
    actor_id,
    actor_id
  ) returning * into invoice_row;

  perform private.replace_invoice_items(invoice_row.id, p_payload -> 'items');
  if initial_status = 'payment_pending' then
    update public.invoices
    set status = 'payment_pending', updated_by_profile_id = actor_id
    where id = invoice_row.id;
  end if;
  select invoice.* into invoice_row from public.invoices as invoice where invoice.id = invoice_row.id;

  perform private.record_authenticated_activity(
    'invoice', invoice_row.id, 'invoice.created', 'Created invoice.',
    jsonb_build_object('invoice', private.invoice_snapshot(invoice_row.id))
  );
  perform private.remember_create_request(
    actor_id, 'invoice.create', p_request_id, p_payload, invoice_row.id
  );
  return invoice_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- RLS: the internal invoice branch
-- -----------------------------------------------------------------------------

alter policy invoices_authorized_internal_select on public.invoices
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and (public.app_has_permission('invoices.view') or public.app_has_permission('invoices.manage')));
