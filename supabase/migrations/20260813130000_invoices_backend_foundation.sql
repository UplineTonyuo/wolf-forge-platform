-- Wolf Forge Platform - Invoices backend foundation
--
-- Persisted lifecycle: draft, unpaid, payment_pending, paid, void.
-- Derived presentation states: overdue, partially_refunded, refunded.
-- Money is stored as integer cents, matching the company wallet ledger.

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values
  ('invoices.mark_paid', 'billing', 'Record invoice payments', 'Record authorized manual or externally confirmed invoice payment attempts.'),
  ('invoices.void', 'billing', 'Void invoices', 'Void unsettled invoices while preserving their accounting history.'),
  ('invoices.refund', 'billing', 'Refund invoices', 'Record authorized partial or full invoice refunds.')
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, capability.permission_key, true
from public.roles as role_row
cross join (
  values
    ('invoices.mark_paid'::text),
    ('invoices.void'::text),
    ('invoices.refund'::text)
) as capability(permission_key)
where role_row.name = 'admin'
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.invoice_number_counters (
  counter_key text primary key,
  next_number bigint not null,
  updated_at timestamptz not null default now(),
  constraint invoice_number_counters_key_not_blank check (btrim(counter_key) <> ''),
  constraint invoice_number_counters_next_positive check (next_number > 0)
);

insert into public.invoice_number_counters (counter_key, next_number)
values ('global', 1);

create trigger invoice_number_counters_set_updated_at
before update on public.invoice_number_counters
for each row execute function private.set_updated_at();

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  client_profile_id uuid references public.profiles (id) on delete set null,
  status text not null default 'draft',
  currency text not null default 'USD',
  invoice_number bigint unique,
  billing_reason text,
  issued_at timestamptz,
  due_at timestamptz,
  subtotal_cents bigint not null default 0,
  discount_total_cents bigint not null default 0,
  tax_total_cents bigint not null default 0,
  total_cents bigint not null default 0,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  archived_at timestamptz,
  constraint invoices_status_valid check (status in ('draft', 'unpaid', 'payment_pending', 'paid', 'void')),
  constraint invoices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_billing_reason_valid check (
    billing_reason is null or billing_reason in (
      'manual', 'subscription_create', 'subscription_cycle',
      'subscription_update', 'subscription_threshold'
    )
  ),
  constraint invoices_amounts_nonnegative check (
    subtotal_cents >= 0 and discount_total_cents >= 0
    and tax_total_cents >= 0 and total_cents >= 0
  ),
  constraint invoices_discount_not_excessive check (discount_total_cents <= subtotal_cents),
  constraint invoices_total_consistent check (
    total_cents = subtotal_cents - discount_total_cents + tax_total_cents
  ),
  constraint invoices_number_issue_consistent check ((invoice_number is null) = (issued_at is null)),
  constraint invoices_issued_status_consistent check (
    status not in ('unpaid', 'paid') or invoice_number is not null
  ),
  constraint invoices_draft_unissued check (
    status <> 'draft' or (invoice_number is null and issued_at is null)
  ),
  constraint invoices_void_timestamp_consistent check ((status = 'void') = (voided_at is not null))
);

create index invoices_company_created_idx on public.invoices (company_id, created_at desc);
create index invoices_client_profile_idx on public.invoices (client_profile_id) where client_profile_id is not null;
create index invoices_payable_due_idx on public.invoices (due_at) where status in ('unpaid', 'payment_pending');
create index invoices_active_created_idx on public.invoices (created_at desc) where archived_at is null;

create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function private.set_updated_at();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  service_id uuid references public.services (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  position integer not null,
  name text not null,
  description text,
  quantity integer not null,
  unit_price_cents bigint not null,
  unit_discount_cents bigint not null default 0,
  line_subtotal_cents bigint generated always as ((unit_price_cents - unit_discount_cents) * quantity) stored,
  is_taxable boolean not null default true,
  fulfillment_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_items_invoice_position_unique unique (invoice_id, position),
  constraint invoice_items_name_not_blank check (btrim(name) <> ''),
  constraint invoice_items_description_not_blank check (description is null or btrim(description) <> ''),
  constraint invoice_items_position_nonnegative check (position >= 0),
  constraint invoice_items_quantity_positive check (quantity > 0),
  constraint invoice_items_prices_valid check (
    unit_price_cents >= 0 and unit_discount_cents >= 0 and unit_discount_cents <= unit_price_cents
  ),
  constraint invoice_items_fulfillment_status_valid check (
    fulfillment_status in ('not_applicable', 'awaiting_payment', 'pending', 'provisioned')
  ),
  constraint invoice_items_fulfillment_consistent check (
    (service_id is null and order_id is null and fulfillment_status = 'not_applicable')
    or
    (service_id is not null and (
      (order_id is null and fulfillment_status in ('awaiting_payment', 'pending'))
      or (order_id is not null and fulfillment_status = 'provisioned')
    ))
  )
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);
create index invoice_items_service_idx on public.invoice_items (service_id) where service_id is not null;
create unique index invoice_items_order_unique on public.invoice_items (order_id) where order_id is not null;

create trigger invoice_items_set_updated_at
before update on public.invoice_items
for each row execute function private.set_updated_at();

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount_cents bigint not null,
  currency text not null,
  status text not null,
  payment_method text not null,
  processor text,
  processor_reference text,
  settled_at timestamptz,
  request_id uuid not null,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint invoice_payments_amount_positive check (amount_cents > 0),
  constraint invoice_payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint invoice_payments_status_valid check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  constraint invoice_payments_method_valid check (payment_method in ('manual', 'card', 'bank_transfer', 'wallet', 'other')),
  constraint invoice_payments_processor_not_blank check (processor is null or btrim(processor) <> ''),
  constraint invoice_payments_reference_not_blank check (processor_reference is null or btrim(processor_reference) <> ''),
  constraint invoice_payments_settlement_consistent check ((status = 'succeeded') = (settled_at is not null)),
  constraint invoice_payments_request_unique unique (created_by_profile_id, request_id)
);

create index invoice_payments_invoice_created_idx on public.invoice_payments (invoice_id, created_at desc);
create index invoice_payments_invoice_succeeded_idx on public.invoice_payments (invoice_id) where status = 'succeeded';

create table public.invoice_refunds (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  invoice_payment_id uuid references public.invoice_payments (id) on delete restrict,
  amount_cents bigint not null,
  currency text not null,
  reason text not null,
  status text not null,
  processor text,
  processor_reference text,
  refunded_at timestamptz,
  request_id uuid not null,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint invoice_refunds_amount_positive check (amount_cents > 0),
  constraint invoice_refunds_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint invoice_refunds_reason_not_blank check (btrim(reason) <> '' and char_length(reason) <= 500),
  constraint invoice_refunds_status_valid check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  constraint invoice_refunds_processor_not_blank check (processor is null or btrim(processor) <> ''),
  constraint invoice_refunds_reference_not_blank check (processor_reference is null or btrim(processor_reference) <> ''),
  constraint invoice_refunds_settlement_consistent check ((status = 'succeeded') = (refunded_at is not null)),
  constraint invoice_refunds_request_unique unique (created_by_profile_id, request_id)
);

create index invoice_refunds_invoice_created_idx on public.invoice_refunds (invoice_id, created_at desc);
create index invoice_refunds_payment_idx on public.invoice_refunds (invoice_payment_id) where invoice_payment_id is not null;
create index invoice_refunds_invoice_succeeded_idx on public.invoice_refunds (invoice_id) where status = 'succeeded';

-- -----------------------------------------------------------------------------
-- Security and integrity helpers
-- -----------------------------------------------------------------------------

create or replace function private.require_invoice_capability(p_permission_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission(p_permission_key);
  return actor_id;
end;
$$;

create or replace function private.can_read_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices as invoice_row
    join public.companies as company_row
      on company_row.id = invoice_row.company_id
     and company_row.archived_at is null
    join public.profiles as profile_row
      on profile_row.id = (select auth.uid())
     and profile_row.archived_at is null
    join public.roles as role_row
      on role_row.id = profile_row.role_id
    where invoice_row.id = p_invoice_id
      and invoice_row.archived_at is null
      and (
        (
          role_row.name in ('owner', 'admin', 'manager', 'staff')
          and (
            private.current_user_has_permission('invoices.view')
            or private.current_user_has_permission('invoices.manage')
          )
        )
        or (
          role_row.name = 'client'
          and private.current_user_has_permission('invoices.view')
          and profile_row.company_id = invoice_row.company_id
        )
      )
  );
$$;

create or replace function private.require_invoice_client_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_profile_id is not null and not exists (
    select 1
    from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = new.client_profile_id
      and profile_row.company_id = new.company_id
      and profile_row.archived_at is null
      and role_row.name = 'client'
  ) then
    raise exception 'invoice client profile must be an active client in the invoice company'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invoices_require_client_consistency
before insert or update of company_id, client_profile_id on public.invoices
for each row execute function private.require_invoice_client_consistency();

create or replace function private.protect_invoice_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued invoice history cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  if new.id <> old.id
    or new.created_at <> old.created_at
    or new.created_by_profile_id <> old.created_by_profile_id
  then
    raise exception 'invoice identity and creation history are immutable' using errcode = '55000';
  end if;

  if old.invoice_number is not null and new.invoice_number is distinct from old.invoice_number then
    raise exception 'issued invoice number is immutable' using errcode = '55000';
  end if;

  if old.status <> 'draft' and (
    new.company_id is distinct from old.company_id
    or new.client_profile_id is distinct from old.client_profile_id
    or new.currency is distinct from old.currency
    or new.subtotal_cents is distinct from old.subtotal_cents
    or new.discount_total_cents is distinct from old.discount_total_cents
    or new.tax_total_cents is distinct from old.tax_total_cents
    or new.total_cents is distinct from old.total_cents
  ) then
    raise exception 'issued invoice financial contents are immutable' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger invoices_protect_history
before update or delete on public.invoices
for each row execute function private.protect_invoice_record();

create or replace function private.protect_invoice_item_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status text;
begin
  select invoice_row.status into parent_status
  from public.invoices as invoice_row
  where invoice_row.id = coalesce(new.invoice_id, old.invoice_id);

  if tg_op = 'UPDATE'
    and parent_status <> 'draft'
    and (
      new.fulfillment_status is distinct from old.fulfillment_status
      or new.order_id is distinct from old.order_id
    )
    and new.id = old.id
    and new.invoice_id = old.invoice_id
    and new.service_id is not distinct from old.service_id
    and new.position = old.position
    and new.name = old.name
    and new.description is not distinct from old.description
    and new.quantity = old.quantity
    and new.unit_price_cents = old.unit_price_cents
    and new.unit_discount_cents = old.unit_discount_cents
    and new.is_taxable = old.is_taxable
    and new.created_at = old.created_at
  then
    return new;
  end if;

  if parent_status <> 'draft' then
    raise exception 'issued invoice items are immutable' using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger invoice_items_protect_history
before insert or update or delete on public.invoice_items
for each row execute function private.protect_invoice_item_history();

create or replace function private.prevent_invoice_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'invoice financial ledgers are append-only' using errcode = '55000';
end;
$$;

create trigger invoice_payments_prevent_mutation
before update or delete or truncate on public.invoice_payments
for each statement execute function private.prevent_invoice_ledger_mutation();

create trigger invoice_refunds_prevent_mutation
before update or delete or truncate on public.invoice_refunds
for each statement execute function private.prevent_invoice_ledger_mutation();

create or replace function private.next_invoice_number()
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  update public.invoice_number_counters
  set next_number = next_number + 1
  where counter_key = 'global'
  returning next_number - 1;
$$;

create or replace function private.invoice_amounts(p_invoice_id uuid)
returns table (
  gross_paid_cents bigint,
  successful_refunds_cents bigint,
  net_paid_cents bigint,
  balance_due_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    payment_totals.gross_paid_cents,
    refund_totals.successful_refunds_cents,
    greatest(payment_totals.gross_paid_cents - refund_totals.successful_refunds_cents, 0::bigint),
    greatest(
      invoice_row.total_cents
        - greatest(payment_totals.gross_paid_cents - refund_totals.successful_refunds_cents, 0::bigint),
      0::bigint
    )
  from public.invoices as invoice_row
  cross join lateral (
    select coalesce(sum(payment.amount_cents), 0)::bigint as gross_paid_cents
    from public.invoice_payments as payment
    where payment.invoice_id = invoice_row.id and payment.status = 'succeeded'
  ) as payment_totals
  cross join lateral (
    select coalesce(sum(refund.amount_cents), 0)::bigint as successful_refunds_cents
    from public.invoice_refunds as refund
    where refund.invoice_id = invoice_row.id and refund.status = 'succeeded'
  ) as refund_totals
  where invoice_row.id = p_invoice_id;
$$;

create or replace function private.invoice_snapshot(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', invoice_row.id,
    'company_id', invoice_row.company_id,
    'client_profile_id', invoice_row.client_profile_id,
    'status', invoice_row.status,
    'currency', invoice_row.currency,
    'invoice_number', invoice_row.invoice_number,
    'billing_reason', invoice_row.billing_reason,
    'issued_at', invoice_row.issued_at,
    'due_at', invoice_row.due_at,
    'subtotal_cents', invoice_row.subtotal_cents,
    'discount_total_cents', invoice_row.discount_total_cents,
    'tax_total_cents', invoice_row.tax_total_cents,
    'total_cents', invoice_row.total_cents,
    'voided_at', invoice_row.voided_at
  )
  from public.invoices as invoice_row
  where invoice_row.id = p_invoice_id;
$$;

create or replace function private.replace_invoice_items(p_invoice_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  item_entry record;
  item_value jsonb;
  selected_service_id uuid;
  service_row public.services;
  item_name text;
  item_description text;
  item_quantity integer;
  item_unit_price_cents bigint;
  item_unit_discount_cents bigint;
  item_taxable boolean;
  new_subtotal bigint;
  new_discount bigint;
begin
  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
  for update;

  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status <> 'draft' then
    raise exception 'only draft invoice items can be replaced' using errcode = '55000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invoice requires at least one line item' using errcode = '22023';
  end if;

  delete from public.invoice_items where invoice_id = p_invoice_id;

  for item_entry in
    select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    item_value := item_entry.value;
    if jsonb_typeof(item_value) <> 'object'
      or item_value - array[
        'service_id', 'name', 'description', 'quantity',
        'unit_price_cents', 'unit_discount_cents', 'is_taxable'
      ] <> '{}'::jsonb
      or not item_value ? 'quantity'
      or jsonb_typeof(item_value -> 'quantity') <> 'number'
      or (item_value ->> 'quantity')::numeric <> trunc((item_value ->> 'quantity')::numeric)
    then
      raise exception 'invalid invoice line item' using errcode = '22023';
    end if;

    selected_service_id := nullif(item_value ->> 'service_id', '')::uuid;
    service_row := null;

    if selected_service_id is not null then
      select service.* into service_row
      from public.services as service
      where service.id = selected_service_id
        and service.is_active
        and service.archived_at is null;
      if service_row.id is null then
        raise exception 'invoice service must be active' using errcode = '23514';
      end if;
    end if;

    item_name := nullif(btrim(coalesce(item_value ->> 'name', service_row.name)), '');
    item_description := nullif(btrim(coalesce(item_value ->> 'description', service_row.description)), '');
    item_quantity := (item_value ->> 'quantity')::integer;

    if item_value ? 'unit_price_cents' and item_value -> 'unit_price_cents' <> 'null'::jsonb then
      if jsonb_typeof(item_value -> 'unit_price_cents') <> 'number'
        or (item_value ->> 'unit_price_cents')::numeric <> trunc((item_value ->> 'unit_price_cents')::numeric)
      then
        raise exception 'invoice unit price must be integer cents' using errcode = '22023';
      end if;
      item_unit_price_cents := (item_value ->> 'unit_price_cents')::bigint;
    elsif service_row.id is not null then
      if service_row.currency <> invoice_row.currency then
        raise exception 'service currency differs from invoice currency; an explicit snapshot price is required'
          using errcode = '22023';
      end if;
      item_unit_price_cents := (service_row.price * 100)::bigint;
    else
      raise exception 'custom invoice item requires a unit price' using errcode = '22023';
    end if;

    if item_value ? 'unit_discount_cents' and item_value -> 'unit_discount_cents' <> 'null'::jsonb then
      if jsonb_typeof(item_value -> 'unit_discount_cents') <> 'number'
        or (item_value ->> 'unit_discount_cents')::numeric <> trunc((item_value ->> 'unit_discount_cents')::numeric)
      then
        raise exception 'invoice unit discount must be integer cents' using errcode = '22023';
      end if;
      item_unit_discount_cents := (item_value ->> 'unit_discount_cents')::bigint;
    else
      item_unit_discount_cents := 0;
    end if;

    if item_value ? 'is_taxable' and item_value -> 'is_taxable' <> 'null'::jsonb then
      if jsonb_typeof(item_value -> 'is_taxable') <> 'boolean' then
        raise exception 'invoice taxable flag must be boolean' using errcode = '22023';
      end if;
      item_taxable := (item_value ->> 'is_taxable')::boolean;
    else
      item_taxable := true;
    end if;

    if item_name is null or item_quantity <= 0 or item_unit_price_cents < 0
      or item_unit_discount_cents < 0 or item_unit_discount_cents > item_unit_price_cents
    then
      raise exception 'invalid invoice line item' using errcode = '22023';
    end if;

    insert into public.invoice_items (
      invoice_id, service_id, position, name, description, quantity,
      unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status
    ) values (
      p_invoice_id,
      selected_service_id,
      item_entry.ordinality - 1,
      item_name,
      item_description,
      item_quantity,
      item_unit_price_cents,
      item_unit_discount_cents,
      item_taxable,
      case when selected_service_id is null then 'not_applicable' else 'awaiting_payment' end
    );
  end loop;

  select
    coalesce(sum(unit_price_cents * quantity), 0)::bigint,
    coalesce(sum(unit_discount_cents * quantity), 0)::bigint
  into new_subtotal, new_discount
  from public.invoice_items
  where invoice_id = p_invoice_id;

  update public.invoices
  set subtotal_cents = new_subtotal,
      discount_total_cents = new_discount,
      total_cents = new_subtotal - new_discount + tax_total_cents
  where id = p_invoice_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Controlled invoice mutations
-- -----------------------------------------------------------------------------

create or replace function public.app_create_invoice(p_request_id uuid, p_payload jsonb)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
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
    select invoice.* into invoice_row from public.invoices as invoice where invoice.id = existing_id;
    if invoice_row.id is null then raise no_data_found; end if;
    return invoice_row;
  end if;

  if not exists (
    select 1 from public.companies as company_row
    where company_row.id = (p_payload ->> 'company_id')::uuid
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
$$;

create or replace function public.app_update_invoice(p_invoice_id uuid, p_patch jsonb)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
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
  where invoice.id = p_invoice_id and invoice.archived_at is null
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
$$;

create or replace function public.app_issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  invoice_row public.invoices;
begin
  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
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
$$;

create or replace function public.app_record_invoice_payment(
  p_request_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_status text default 'succeeded',
  p_payment_method text default 'manual',
  p_processor text default null,
  p_processor_reference text default null
)
returns public.invoice_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.mark_paid');
  request_payload jsonb := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'amount_cents', p_amount_cents,
    'status', p_status,
    'payment_method', p_payment_method,
    'processor', nullif(btrim(p_processor), ''),
    'processor_reference', nullif(btrim(p_processor_reference), '')
  );
  existing_id uuid;
  invoice_row public.invoices;
  payment_row public.invoice_payments;
  amounts record;
  remaining_balance bigint;
begin
  if p_request_id is null or p_amount_cents is null or p_amount_cents <= 0
    or p_status not in ('pending', 'succeeded', 'failed', 'cancelled')
    or p_payment_method not in ('manual', 'card', 'bank_transfer', 'wallet', 'other')
  then
    raise exception 'invalid invoice payment' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload
  );
  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment where payment.id = existing_id;
    if payment_row.id is null then raise no_data_found; end if;
    return payment_row;
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
  for update;
  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status not in ('unpaid', 'payment_pending') then
    raise exception 'invoice is not open for payment' using errcode = '55000';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if p_status in ('pending', 'succeeded') and p_amount_cents > amounts.balance_due_cents then
    raise exception 'invoice payment exceeds balance due' using errcode = '22023';
  end if;

  insert into public.invoice_payments (
    invoice_id, amount_cents, currency, status, payment_method, processor,
    processor_reference, settled_at, request_id, created_by_profile_id
  ) values (
    p_invoice_id, p_amount_cents, invoice_row.currency, p_status, p_payment_method,
    nullif(btrim(p_processor), ''), nullif(btrim(p_processor_reference), ''),
    case when p_status = 'succeeded' then now() else null end,
    p_request_id, actor_id
  ) returning * into payment_row;

  if p_status = 'pending' and invoice_row.status = 'unpaid' then
    update public.invoices
    set status = 'payment_pending', updated_by_profile_id = actor_id
    where id = p_invoice_id;
  elsif p_status = 'succeeded' then
    select balance_due_cents into remaining_balance
    from private.invoice_amounts(p_invoice_id);

    update public.invoices
    set status = case when remaining_balance = 0 then 'paid' else 'unpaid' end,
        invoice_number = coalesce(invoice_number, private.next_invoice_number()),
        issued_at = coalesce(issued_at, now()),
        updated_by_profile_id = actor_id
    where id = p_invoice_id;

    if remaining_balance = 0 then
      update public.invoice_items
      set fulfillment_status = 'pending'
      where invoice_id = p_invoice_id
        and service_id is not null
        and fulfillment_status = 'awaiting_payment';
    end if;
  end if;

  perform private.record_authenticated_activity(
    'invoice', p_invoice_id, 'invoice.payment_recorded', 'Recorded invoice payment.',
    jsonb_build_object(
      'payment_id', payment_row.id,
      'amount_cents', payment_row.amount_cents,
      'currency', payment_row.currency,
      'status', payment_row.status,
      'payment_method', payment_row.payment_method
    )
  );
  perform private.remember_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload, payment_row.id
  );
  return payment_row;
end;
$$;

create or replace function public.app_void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.void');
  invoice_row public.invoices;
  amounts record;
begin
  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
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
$$;

create or replace function public.app_refund_invoice(
  p_request_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_reason text,
  p_invoice_payment_id uuid default null,
  p_status text default 'succeeded',
  p_processor text default null,
  p_processor_reference text default null
)
returns public.invoice_refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_invoice_capability('invoices.refund');
  normalized_reason text := nullif(btrim(p_reason), '');
  request_payload jsonb := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_payment_id', p_invoice_payment_id,
    'amount_cents', p_amount_cents,
    'reason', normalized_reason,
    'status', p_status,
    'processor', nullif(btrim(p_processor), ''),
    'processor_reference', nullif(btrim(p_processor_reference), '')
  );
  existing_id uuid;
  invoice_row public.invoices;
  payment_row public.invoice_payments;
  refund_row public.invoice_refunds;
  amounts record;
  payment_refunded bigint;
begin
  if p_request_id is null or p_amount_cents is null or p_amount_cents <= 0
    or normalized_reason is null or char_length(normalized_reason) > 500
    or p_status not in ('pending', 'succeeded', 'failed', 'cancelled')
  then
    raise exception 'invalid invoice refund' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'invoice.refund', p_request_id, request_payload
  );
  if existing_id is not null then
    select refund.* into refund_row
    from public.invoice_refunds as refund where refund.id = existing_id;
    if refund_row.id is null then raise no_data_found; end if;
    return refund_row;
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id and invoice.archived_at is null
  for update;
  if invoice_row.id is null then raise no_data_found; end if;
  if invoice_row.status <> 'paid' then
    raise exception 'only a paid invoice can be refunded' using errcode = '55000';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if p_status in ('pending', 'succeeded')
    and p_amount_cents > amounts.gross_paid_cents - amounts.successful_refunds_cents
  then
    raise exception 'invoice refund exceeds refundable settled amount' using errcode = '22023';
  end if;

  if p_invoice_payment_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment
    where payment.id = p_invoice_payment_id
      and payment.invoice_id = p_invoice_id
      and payment.status = 'succeeded';
    if payment_row.id is null then
      raise exception 'refund payment must be a successful payment for this invoice'
        using errcode = '23514';
    end if;

    select coalesce(sum(refund.amount_cents), 0)::bigint
    into payment_refunded
    from public.invoice_refunds as refund
    where refund.invoice_payment_id = p_invoice_payment_id
      and refund.status = 'succeeded';

    if p_status in ('pending', 'succeeded')
      and p_amount_cents > payment_row.amount_cents - payment_refunded
    then
      raise exception 'refund exceeds the selected payment refundable amount'
        using errcode = '22023';
    end if;
  end if;

  insert into public.invoice_refunds (
    invoice_id, invoice_payment_id, amount_cents, currency, reason, status,
    processor, processor_reference, refunded_at, request_id, created_by_profile_id
  ) values (
    p_invoice_id, p_invoice_payment_id, p_amount_cents, invoice_row.currency,
    normalized_reason, p_status, nullif(btrim(p_processor), ''),
    nullif(btrim(p_processor_reference), ''),
    case when p_status = 'succeeded' then now() else null end,
    p_request_id, actor_id
  ) returning * into refund_row;

  perform private.record_authenticated_activity(
    'invoice', p_invoice_id, 'invoice.refunded', 'Recorded invoice refund.',
    jsonb_build_object(
      'refund_id', refund_row.id,
      'invoice_payment_id', refund_row.invoice_payment_id,
      'amount_cents', refund_row.amount_cents,
      'currency', refund_row.currency,
      'reason', refund_row.reason,
      'status', refund_row.status
    )
  );
  perform private.remember_create_request(
    actor_id, 'invoice.refund', p_request_id, request_payload, refund_row.id
  );
  return refund_row;
end;
$$;

create or replace function public.app_get_invoice_financials(p_invoice_id uuid)
returns table (
  invoice_id uuid,
  persisted_status text,
  presentation_state text,
  gross_paid_cents bigint,
  successful_refunds_cents bigint,
  net_paid_cents bigint,
  balance_due_cents bigint,
  is_overdue boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_invoice(p_invoice_id) then
    raise exception 'invoice access is denied' using errcode = '42501';
  end if;

  return query
  select
    invoice_row.id,
    invoice_row.status,
    case
      when invoice_row.status = 'void' then 'void'
      when invoice_row.status = 'draft' then 'draft'
      when amounts.successful_refunds_cents > 0
        and amounts.successful_refunds_cents >= amounts.gross_paid_cents then 'refunded'
      when amounts.successful_refunds_cents > 0 then 'partially_refunded'
      when invoice_row.status = 'payment_pending' then 'payment_pending'
      when invoice_row.status = 'paid' then 'paid'
      when invoice_row.status in ('unpaid', 'payment_pending')
        and amounts.balance_due_cents > 0
        and invoice_row.due_at < now() then 'overdue'
      else invoice_row.status
    end,
    amounts.gross_paid_cents,
    amounts.successful_refunds_cents,
    amounts.net_paid_cents,
    amounts.balance_due_cents,
    invoice_row.status in ('unpaid', 'payment_pending')
      and amounts.balance_due_cents > 0
      and invoice_row.due_at < now()
  from public.invoices as invoice_row
  cross join lateral private.invoice_amounts(invoice_row.id) as amounts
  where invoice_row.id = p_invoice_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit integration and RLS
-- -----------------------------------------------------------------------------

alter table public.activity_events drop constraint activity_events_entity_type_valid;
alter table public.activity_events add constraint activity_events_entity_type_valid check (
  entity_type in (
    'company', 'client_contact', 'service_folder', 'service', 'order',
    'order_task', 'profile', 'coupon', 'invoice'
  )
);

alter table public.invoice_number_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_refunds enable row level security;

create policy invoices_authorized_internal_select
on public.invoices for select to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('invoices.view')
    or public.app_has_permission('invoices.manage')
  )
);

create policy invoices_client_select_own_company
on public.invoices for select to authenticated
using (
  (select private.is_client_user())
  and public.app_has_permission('invoices.view')
  and company_id = (select private.current_user_company_id())
  and archived_at is null
);

create policy invoice_items_authorized_select
on public.invoice_items for select to authenticated
using ((select private.can_read_invoice(invoice_id)));

create policy invoice_payments_authorized_internal_select
on public.invoice_payments for select to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('invoices.view')
    or public.app_has_permission('invoices.manage')
  )
);

create policy invoice_refunds_authorized_internal_select
on public.invoice_refunds for select to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('invoices.view')
    or public.app_has_permission('invoices.manage')
  )
);

drop policy if exists activity_events_internal_scoped_select on public.activity_events;
create policy activity_events_internal_scoped_select
on public.activity_events for select to authenticated
using (
  (select private.is_internal_user())
  and (
    (select private.is_client_private_admin())
    or entity_type in ('service', 'service_folder')
    or (
      entity_type = 'coupon'
      and (
        public.app_has_permission('coupons.view')
        or public.app_has_permission('coupons.manage')
      )
    )
    or (entity_type = 'invoice' and (select private.can_read_invoice(entity_id)))
    or (entity_type = 'order' and (select private.can_access_operational_order(entity_id)))
    or (entity_type = 'order_task' and (select private.can_access_operational_task(entity_id)))
  )
);

-- -----------------------------------------------------------------------------
-- Least privilege
-- -----------------------------------------------------------------------------

revoke all on table
  public.invoice_number_counters,
  public.invoices,
  public.invoice_items,
  public.invoice_payments,
  public.invoice_refunds
from public, anon, authenticated, service_role;

grant select on table
  public.invoices,
  public.invoice_items,
  public.invoice_payments,
  public.invoice_refunds
to authenticated;

grant select on table
  public.invoices,
  public.invoice_items,
  public.invoice_payments,
  public.invoice_refunds
to service_role;

revoke all on function private.require_invoice_capability(text)
from public, anon, authenticated, service_role;
revoke all on function private.can_read_invoice(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.require_invoice_client_consistency()
from public, anon, authenticated, service_role;
revoke all on function private.protect_invoice_record()
from public, anon, authenticated, service_role;
revoke all on function private.protect_invoice_item_history()
from public, anon, authenticated, service_role;
revoke all on function private.prevent_invoice_ledger_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.next_invoice_number()
from public, anon, authenticated, service_role;
revoke all on function private.invoice_amounts(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.invoice_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.replace_invoice_items(uuid, jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.app_create_invoice(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.app_update_invoice(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.app_issue_invoice(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.app_record_invoice_payment(uuid, uuid, bigint, text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.app_void_invoice(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.app_refund_invoice(uuid, uuid, bigint, text, uuid, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.app_get_invoice_financials(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.app_create_invoice(uuid, jsonb) to authenticated;
grant execute on function public.app_update_invoice(uuid, jsonb) to authenticated;
grant execute on function public.app_issue_invoice(uuid) to authenticated;
grant execute on function public.app_record_invoice_payment(uuid, uuid, bigint, text, text, text, text) to authenticated;
grant execute on function public.app_void_invoice(uuid) to authenticated;
grant execute on function public.app_refund_invoice(uuid, uuid, bigint, text, uuid, text, text, text) to authenticated;
grant execute on function public.app_get_invoice_financials(uuid) to authenticated;
grant execute on function private.can_read_invoice(uuid) to authenticated;

comment on table public.invoices is
  'Persisted lifecycle only: draft, unpaid, payment_pending, paid, void. Overdue and refund presentation states are derived.';
comment on function public.app_get_invoice_financials(uuid) is
  'gross paid = successful payments; refunds = successful refunds; net paid = max(gross-refunds,0); balance due = max(total-net,0).';
comment on column public.invoice_items.fulfillment_status is
  'Service lines move to pending after full settlement. Order provisioning remains deferred until a reusable fulfillment boundary exists.';
