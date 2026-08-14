-- Wolf Forge Platform - Subscriptions backend foundation
--
-- Subscriptions orchestrate the existing invoice and payment ledgers. They do
-- not own balances, payments, refunds, or a second accounting implementation.

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values
  ('subscriptions.pause', 'billing', 'Pause subscriptions', 'Pause and resume subscription billing without changing its anchor.'),
  ('subscriptions.cancel', 'billing', 'Cancel subscriptions', 'Schedule or immediately cancel subscriptions while retaining financial history.'),
  ('subscriptions.billing', 'billing', 'Operate subscription billing', 'Generate due cycle invoices and reconcile subscription lifecycle state.')
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
    ('subscriptions.pause'::text),
    ('subscriptions.cancel'::text),
    ('subscriptions.billing'::text)
) as capability(permission_key)
where role_row.name in ('owner', 'admin')
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Subscription identity and immutable/versioned commercial terms
-- -----------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  client_profile_id uuid references public.profiles (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  public_ref text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  status text not null default 'active',
  plan_source text not null,
  billing_anchor date not null,
  current_period_end date,
  current_plan_version_id uuid,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  resumes_at date,
  cancel_effective_at date,
  canceled_at timestamptz,
  cancellation_reason text,
  external_processor text,
  external_processor_reference text,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint subscriptions_public_ref_unique unique (public_ref),
  constraint subscriptions_public_ref_format check (public_ref ~ '^[A-Z0-9]{8,32}$'),
  constraint subscriptions_status_valid check (
    status in ('active', 'past_due', 'paused', 'pending_cancellation', 'canceled')
  ),
  constraint subscriptions_plan_source_valid check (
    plan_source in ('admin_invoice', 'checkout', 'payment_link', 'service_purchase')
  ),
  constraint subscriptions_processor_not_blank check (
    external_processor is null or btrim(external_processor) <> ''
  ),
  constraint subscriptions_processor_reference_not_blank check (
    external_processor_reference is null or btrim(external_processor_reference) <> ''
  ),
  constraint subscriptions_cancellation_reason_not_blank check (
    cancellation_reason is null
    or (btrim(cancellation_reason) <> '' and char_length(cancellation_reason) <= 500)
  ),
  constraint subscriptions_lifecycle_consistent check (
    (status = 'paused' and paused_at is not null and canceled_at is null)
    or (status = 'pending_cancellation' and cancel_effective_at is not null and canceled_at is null)
    or (status = 'canceled' and canceled_at is not null and current_period_end is null)
    or (status in ('active', 'past_due') and paused_at is null and cancel_effective_at is null and canceled_at is null)
  ),
  constraint subscriptions_resume_date_consistent check (
    resumes_at is null or status = 'paused'
  )
);

create index subscriptions_company_created_idx
on public.subscriptions (company_id, created_at desc)
where archived_at is null;

create index subscriptions_client_profile_idx
on public.subscriptions (client_profile_id)
where client_profile_id is not null and archived_at is null;

create index subscriptions_service_idx
on public.subscriptions (service_id)
where archived_at is null;

create index subscriptions_status_period_end_idx
on public.subscriptions (status, current_period_end)
where archived_at is null and status <> 'canceled';

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function private.set_updated_at();

create table public.subscription_plan_versions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  version integer not null,
  effective_from date not null,
  interval_unit text not null,
  interval_count integer not null default 1,
  anchor_day smallint,
  end_of_month_policy text not null default 'clamp',
  currency text not null,
  lead_days integer not null default 5,
  grace_days integer not null default 15,
  recurring_action text not null,
  request_limit_total integer,
  request_limit_active integer,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint subscription_plan_versions_subscription_version_unique
    unique (subscription_id, version),
  constraint subscription_plan_versions_id_subscription_unique
    unique (id, subscription_id),
  constraint subscription_plan_versions_version_positive check (version > 0),
  constraint subscription_plan_versions_interval_unit_valid
    check (interval_unit in ('day', 'week', 'month', 'year')),
  constraint subscription_plan_versions_interval_count_positive check (interval_count > 0),
  constraint subscription_plan_versions_anchor_day_valid
    check (anchor_day is null or anchor_day between 1 and 31),
  constraint subscription_plan_versions_anchor_consistent check (
    (interval_unit in ('month', 'year') and anchor_day is not null)
    or (interval_unit in ('day', 'week') and anchor_day is null)
  ),
  constraint subscription_plan_versions_eom_policy_valid
    check (end_of_month_policy in ('clamp', 'skip')),
  constraint subscription_plan_versions_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint subscription_plan_versions_lead_days_valid check (lead_days between 0 and 90),
  constraint subscription_plan_versions_grace_days_valid check (grace_days between 0 and 365),
  constraint subscription_plan_versions_recurring_action_valid check (
    recurring_action in ('none', 'reopen_order', 'create_order', 'client_request')
  ),
  constraint subscription_plan_versions_request_limits_valid check (
    (request_limit_total is null or request_limit_total > 0)
    and (request_limit_active is null or request_limit_active > 0)
    and (request_limit_total is null or request_limit_active is null or request_limit_active <= request_limit_total)
    and (
      recurring_action = 'client_request'
      or (request_limit_total is null and request_limit_active is null)
    )
  )
);

alter table public.subscriptions
  add constraint subscriptions_current_plan_version_fkey
  foreign key (current_plan_version_id, id)
  references public.subscription_plan_versions (id, subscription_id)
  on delete restrict
  deferrable initially deferred;

create index subscription_plan_versions_subscription_effective_idx
on public.subscription_plan_versions (subscription_id, effective_from desc, version desc);

create table public.subscription_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.subscription_plan_versions (id) on delete restrict,
  position integer not null,
  service_id uuid references public.services (id) on delete restrict,
  service_name_snapshot text not null,
  service_description_snapshot text,
  quantity integer not null,
  unit_amount_cents bigint not null,
  unit_discount_cents bigint not null default 0,
  coupon_id uuid references public.coupons (id) on delete restrict,
  coupon_recurring_duration text,
  is_taxable boolean not null default true,
  created_at timestamptz not null default now(),
  constraint subscription_plan_items_position_unique unique (plan_version_id, position),
  constraint subscription_plan_items_name_not_blank check (btrim(service_name_snapshot) <> ''),
  constraint subscription_plan_items_description_not_blank check (
    service_description_snapshot is null or btrim(service_description_snapshot) <> ''
  ),
  constraint subscription_plan_items_position_nonnegative check (position >= 0),
  constraint subscription_plan_items_quantity_positive check (quantity > 0),
  constraint subscription_plan_items_money_valid check (
    unit_amount_cents >= 0
    and unit_discount_cents >= 0
    and unit_discount_cents <= unit_amount_cents
  ),
  constraint subscription_plan_items_coupon_duration_valid check (
    coupon_recurring_duration is null
    or coupon_recurring_duration in ('forever', 'first_payment')
  ),
  constraint subscription_plan_items_coupon_consistent check (
    (coupon_id is null and coupon_recurring_duration is null)
    or (coupon_id is not null and coupon_recurring_duration is not null)
  )
);

create index subscription_plan_items_version_idx
on public.subscription_plan_items (plan_version_id, position);

create index subscription_plan_items_service_idx
on public.subscription_plan_items (service_id)
where service_id is not null;

create index subscription_plan_items_coupon_idx
on public.subscription_plan_items (coupon_id)
where coupon_id is not null;

-- -----------------------------------------------------------------------------
-- Billing cycles, event history, payment-source references, and dunning data
-- -----------------------------------------------------------------------------

create table public.subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  plan_version_id uuid not null references public.subscription_plan_versions (id) on delete restrict,
  sequence integer not null,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  issue_on date not null,
  status text not null default 'scheduled',
  invoice_id uuid references public.invoices (id) on delete restrict,
  idempotency_key text not null,
  generated_at timestamptz,
  settled_at timestamptz,
  past_due_at timestamptz,
  blocked_reason text,
  fulfillment_status text not null default 'not_ready',
  fulfillment_action text not null,
  fulfillment_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_cycles_subscription_sequence_unique unique (subscription_id, sequence),
  constraint subscription_cycles_idempotency_key_unique unique (idempotency_key),
  constraint subscription_cycles_sequence_positive check (sequence > 0),
  constraint subscription_cycles_period_valid check (
    period_start < period_end and due_on = period_start and issue_on <= due_on
  ),
  constraint subscription_cycles_status_valid check (
    status in ('scheduled', 'invoiced', 'paid', 'past_due', 'voided', 'skipped')
  ),
  constraint subscription_cycles_invoice_consistent check (
    (status = 'scheduled' and invoice_id is null and generated_at is null)
    or (status in ('invoiced', 'paid', 'past_due', 'voided') and invoice_id is not null and generated_at is not null)
    or (status = 'skipped' and invoice_id is null)
  ),
  constraint subscription_cycles_settlement_consistent check (
    (status = 'paid' and settled_at is not null)
    or (status <> 'paid' and settled_at is null)
  ),
  constraint subscription_cycles_past_due_consistent check (
    (status = 'past_due' and past_due_at is not null)
    or (status <> 'past_due')
  ),
  constraint subscription_cycles_blocked_reason_not_blank check (
    blocked_reason is null or btrim(blocked_reason) <> ''
  ),
  constraint subscription_cycles_fulfillment_status_valid check (
    fulfillment_status in ('not_ready', 'pending', 'deferred', 'completed', 'not_applicable')
  ),
  constraint subscription_cycles_fulfillment_action_valid check (
    fulfillment_action in ('none', 'reopen_order', 'create_order', 'client_request')
  ),
  constraint subscription_cycles_fulfillment_metadata_object check (
    jsonb_typeof(fulfillment_metadata) = 'object'
  )
);

create index subscription_cycles_subscription_created_idx
on public.subscription_cycles (subscription_id, sequence desc);

create index subscription_cycles_plan_version_idx
on public.subscription_cycles (plan_version_id);

create unique index subscription_cycles_invoice_unique
on public.subscription_cycles (invoice_id)
where invoice_id is not null;

create unique index subscription_cycles_one_open_idx
on public.subscription_cycles (subscription_id)
where status in ('scheduled', 'invoiced', 'past_due');

create index subscription_cycles_due_work_idx
on public.subscription_cycles (issue_on, due_on)
where status = 'scheduled' and invoice_id is null;

create index subscription_cycles_reconcile_idx
on public.subscription_cycles (due_on)
where status in ('invoiced', 'past_due');

create trigger subscription_cycles_set_updated_at
before update on public.subscription_cycles
for each row execute function private.set_updated_at();

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  cycle_id uuid references public.subscription_cycles (id) on delete restrict,
  event_type text not null,
  actor_type text not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint subscription_events_type_valid check (
    event_type in (
      'created', 'cycle_scheduled', 'invoice_generated', 'payment_settled',
      'payment_failed', 'past_due', 'recovered', 'paused', 'resumed',
      'cancellation_scheduled', 'cancellation_removed', 'canceled',
      'terms_changed', 'invoice_invalidated', 'fulfillment_pending'
    )
  ),
  constraint subscription_events_actor_type_valid check (
    actor_type in ('system', 'user', 'client', 'processor')
  ),
  constraint subscription_events_actor_consistent check (
    (actor_type in ('user', 'client') and actor_profile_id is not null)
    or (actor_type in ('system', 'processor'))
  ),
  constraint subscription_events_payload_object check (jsonb_typeof(payload) = 'object')
);

create index subscription_events_subscription_time_idx
on public.subscription_events (subscription_id, occurred_at desc);

create index subscription_events_cycle_idx
on public.subscription_events (cycle_id, occurred_at desc)
where cycle_id is not null;

create table public.subscription_payment_methods (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete restrict,
  provider text not null,
  payment_method_ref text not null,
  processor_object_ref text,
  is_fallback boolean not null default false,
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint subscription_payment_methods_provider_valid check (
    provider in ('manual', 'wallet', 'wf_card', 'stripe', 'paypal', 'other')
  ),
  constraint subscription_payment_methods_ref_not_blank check (btrim(payment_method_ref) <> ''),
  constraint subscription_payment_methods_processor_ref_not_blank check (
    processor_object_ref is null or btrim(processor_object_ref) <> ''
  ),
  constraint subscription_payment_methods_priority_nonnegative check (priority >= 0),
  constraint subscription_payment_methods_priority_unique unique (subscription_id, priority)
);

create index subscription_payment_methods_subscription_active_idx
on public.subscription_payment_methods (subscription_id, priority)
where archived_at is null;

create table public.subscription_dunning_attempts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.subscription_cycles (id) on delete restrict,
  attempt_number integer not null,
  scheduled_for timestamptz not null,
  executed_at timestamptz,
  outcome text,
  failure_code text,
  provider text,
  payment_method_ref text,
  created_at timestamptz not null default now(),
  constraint subscription_dunning_attempts_cycle_attempt_unique unique (cycle_id, attempt_number),
  constraint subscription_dunning_attempts_attempt_positive check (attempt_number > 0),
  constraint subscription_dunning_attempts_outcome_valid check (
    outcome is null or outcome in ('succeeded', 'failed', 'skipped')
  ),
  constraint subscription_dunning_attempts_execution_consistent check (
    (executed_at is null and outcome is null)
    or (executed_at is not null and outcome is not null)
  ),
  constraint subscription_dunning_attempts_failure_consistent check (
    failure_code is null or outcome = 'failed'
  ),
  constraint subscription_dunning_attempts_refs_not_blank check (
    (failure_code is null or btrim(failure_code) <> '')
    and (provider is null or btrim(provider) <> '')
    and (payment_method_ref is null or btrim(payment_method_ref) <> '')
  )
);

create index subscription_dunning_attempts_due_idx
on public.subscription_dunning_attempts (scheduled_for)
where executed_at is null;

create index subscription_dunning_attempts_cycle_idx
on public.subscription_dunning_attempts (cycle_id, attempt_number);

-- -----------------------------------------------------------------------------
-- Integrity and scheduling helpers
-- -----------------------------------------------------------------------------

create or replace function private.require_subscription_capability(p_permission_key text)
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

create or replace function private.can_read_subscription(p_subscription_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions as subscription_row
    join public.companies as company_row
      on company_row.id = subscription_row.company_id
     and company_row.archived_at is null
    join public.profiles as profile_row
      on profile_row.id = (select auth.uid())
     and profile_row.archived_at is null
    join public.roles as role_row on role_row.id = profile_row.role_id
    where subscription_row.id = p_subscription_id
      and subscription_row.archived_at is null
      and (
        (
          role_row.name in ('owner', 'admin', 'manager', 'staff')
          and (
            private.current_user_has_permission('subscriptions.view')
            or private.current_user_has_permission('subscriptions.manage')
            or private.current_user_has_permission('subscriptions.billing')
          )
        )
        or (
          role_row.name = 'client'
          and private.current_user_has_permission('subscriptions.view')
          and profile_row.company_id = subscription_row.company_id
        )
      )
  );
$$;

create or replace function private.require_subscription_client_consistency()
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
    raise exception 'subscription client profile must be an active client in the subscription company'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger subscriptions_require_client_consistency
before insert or update of company_id, client_profile_id on public.subscriptions
for each row execute function private.require_subscription_client_consistency();

create or replace function private.prevent_subscription_terms_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'subscription commercial terms are append-only' using errcode = '55000';
end;
$$;

create trigger subscription_plan_versions_prevent_mutation
before update or delete or truncate on public.subscription_plan_versions
for each statement execute function private.prevent_subscription_terms_mutation();

create trigger subscription_plan_items_prevent_mutation
before update or delete or truncate on public.subscription_plan_items
for each statement execute function private.prevent_subscription_terms_mutation();

create or replace function private.prevent_subscription_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Preserve the declared actor FK ON DELETE SET NULL action. Event identity,
  -- time, type, subscription, cycle, and payload remain immutable.
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and new.actor_profile_id is null
    and old.actor_profile_id is not null
    and (to_jsonb(new) - 'actor_profile_id') = (to_jsonb(old) - 'actor_profile_id')
  then
    return new;
  end if;
  raise exception 'subscription events are append-only' using errcode = '55000';
end;
$$;

create trigger subscription_events_prevent_mutation
before update or delete on public.subscription_events
for each row execute function private.prevent_subscription_event_mutation();

create trigger subscription_events_prevent_truncate
before truncate on public.subscription_events
for each statement execute function private.prevent_subscription_event_mutation();

create or replace function private.subscription_actor_type()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case role_row.name when 'client' then 'client' else 'user' end
  from public.profiles as profile_row
  join public.roles as role_row on role_row.id = profile_row.role_id
  where profile_row.id = (select auth.uid())
    and profile_row.archived_at is null;
$$;

create or replace function private.record_subscription_event(
  p_subscription_id uuid,
  p_cycle_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_actor_type text default null,
  p_actor_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  resolved_actor_id uuid := coalesce(p_actor_profile_id, (select auth.uid()));
  resolved_actor_type text := coalesce(
    p_actor_type,
    private.subscription_actor_type(),
    'system'
  );
begin
  insert into public.subscription_events (
    subscription_id, cycle_id, event_type, actor_type, actor_profile_id, payload
  ) values (
    p_subscription_id,
    p_cycle_id,
    p_event_type,
    resolved_actor_type,
    case when resolved_actor_type in ('user', 'client') then resolved_actor_id else p_actor_profile_id end,
    coalesce(p_payload, '{}'::jsonb)
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function private.subscription_add_interval(
  p_from date,
  p_interval_unit text,
  p_interval_count integer,
  p_anchor_day smallint,
  p_end_of_month_policy text
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  target_month date;
  target_last_day date;
  month_step integer;
  attempts integer := 0;
begin
  if p_from is null or p_interval_count is null or p_interval_count <= 0
    or p_interval_unit not in ('day', 'week', 'month', 'year')
    or p_end_of_month_policy not in ('clamp', 'skip')
  then
    raise exception 'invalid subscription interval' using errcode = '22023';
  end if;

  if p_interval_unit = 'day' then
    return p_from + p_interval_count;
  elsif p_interval_unit = 'week' then
    return p_from + (p_interval_count * 7);
  end if;

  if p_anchor_day is null or p_anchor_day not between 1 and 31 then
    raise exception 'calendar subscription interval requires an anchor day' using errcode = '22023';
  end if;

  month_step := case when p_interval_unit = 'year' then p_interval_count * 12 else p_interval_count end;
  target_month := date_trunc('month', p_from)::date + make_interval(months => month_step);

  loop
    target_last_day := (target_month + interval '1 month - 1 day')::date;
    if p_anchor_day <= extract(day from target_last_day)::integer then
      return target_month + (p_anchor_day - 1);
    end if;
    if p_end_of_month_policy = 'clamp' then
      return target_last_day;
    end if;
    target_month := target_month + make_interval(months => month_step);
    attempts := attempts + 1;
    if attempts > 480 then
      raise exception 'subscription end-of-month policy could not find a valid anchor'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function private.insert_subscription_plan_items(
  p_plan_version_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  item_value jsonb;
  selected_service_id uuid;
  selected_coupon_id uuid;
  coupon_duration text;
  item_name text;
  item_description text;
  item_quantity integer;
  item_amount bigint;
  item_discount bigint;
  item_taxable boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100
  then
    raise exception 'subscription plan requires one to one hundred line items'
      using errcode = '22023';
  end if;

  for item in
    select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    item_value := item.value;
    if jsonb_typeof(item_value) <> 'object'
      or item_value - array[
        'service_id', 'name', 'description', 'quantity',
        'unit_amount_cents', 'unit_discount_cents', 'coupon_id', 'is_taxable'
      ] <> '{}'::jsonb
      or not item_value ?& array['name', 'quantity', 'unit_amount_cents']
      or jsonb_typeof(item_value -> 'name') <> 'string'
      or jsonb_typeof(item_value -> 'quantity') <> 'number'
      or jsonb_typeof(item_value -> 'unit_amount_cents') <> 'number'
      or (item_value ->> 'quantity')::numeric <> trunc((item_value ->> 'quantity')::numeric)
      or (item_value ->> 'unit_amount_cents')::numeric <> trunc((item_value ->> 'unit_amount_cents')::numeric)
      or (
        item_value ? 'unit_discount_cents'
        and item_value -> 'unit_discount_cents' <> 'null'::jsonb
        and (
          jsonb_typeof(item_value -> 'unit_discount_cents') <> 'number'
          or (item_value ->> 'unit_discount_cents')::numeric
            <> trunc((item_value ->> 'unit_discount_cents')::numeric)
        )
      )
      or (
        item_value ? 'is_taxable'
        and item_value -> 'is_taxable' <> 'null'::jsonb
        and jsonb_typeof(item_value -> 'is_taxable') <> 'boolean'
      )
    then
      raise exception 'invalid subscription plan line item' using errcode = '22023';
    end if;

    begin
      selected_service_id := nullif(item_value ->> 'service_id', '')::uuid;
      selected_coupon_id := nullif(item_value ->> 'coupon_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'subscription plan line item identifiers must be UUIDs'
        using errcode = '22023';
    end;

    if selected_service_id is not null and not exists (
      select 1 from public.services as service_row where service_row.id = selected_service_id
    ) then
      raise exception 'subscription plan Service does not exist' using errcode = '23514';
    end if;

    coupon_duration := null;
    if selected_coupon_id is not null then
      select coupon_row.recurring_duration into coupon_duration
      from public.coupons as coupon_row
      where coupon_row.id = selected_coupon_id
        and coupon_row.is_active
        and coupon_row.archived_at is null;
      if coupon_duration is null then
        raise exception 'subscription plan Coupon must be active at snapshot time'
          using errcode = '23514';
      end if;
    end if;

    item_name := nullif(btrim(item_value ->> 'name'), '');
    item_description := nullif(btrim(item_value ->> 'description'), '');
    item_quantity := (item_value ->> 'quantity')::integer;
    item_amount := (item_value ->> 'unit_amount_cents')::bigint;
    item_discount := coalesce((item_value ->> 'unit_discount_cents')::bigint, 0);
    item_taxable := coalesce((item_value ->> 'is_taxable')::boolean, true);

    if item_name is null or item_quantity <= 0 or item_amount < 0
      or item_discount < 0 or item_discount > item_amount
    then
      raise exception 'invalid subscription plan line item' using errcode = '22023';
    end if;

    insert into public.subscription_plan_items (
      plan_version_id, position, service_id, service_name_snapshot,
      service_description_snapshot, quantity, unit_amount_cents,
      unit_discount_cents, coupon_id, coupon_recurring_duration, is_taxable
    ) values (
      p_plan_version_id, item.ordinality - 1, selected_service_id, item_name,
      item_description, item_quantity, item_amount, item_discount,
      selected_coupon_id, coupon_duration, item_taxable
    );
  end loop;
end;
$$;

create or replace function private.schedule_subscription_cycle(
  p_subscription_id uuid,
  p_plan_version_id uuid,
  p_sequence integer,
  p_due_on date,
  p_period_end date
)
returns public.subscription_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_row public.subscription_plan_versions;
  cycle_row public.subscription_cycles;
begin
  select plan.* into plan_row
  from public.subscription_plan_versions as plan
  where plan.id = p_plan_version_id
    and plan.subscription_id = p_subscription_id;
  if plan_row.id is null then raise no_data_found; end if;

  insert into public.subscription_cycles (
    subscription_id, plan_version_id, sequence, period_start, period_end,
    due_on, issue_on, idempotency_key, fulfillment_action
  ) values (
    p_subscription_id,
    p_plan_version_id,
    p_sequence,
    p_due_on,
    p_period_end,
    p_due_on,
    p_due_on - plan_row.lead_days,
    p_subscription_id::text || ':' || p_sequence::text,
    plan_row.recurring_action
  ) returning * into cycle_row;

  update public.subscriptions
  set current_period_end = p_period_end
  where id = p_subscription_id;

  perform private.record_subscription_event(
    p_subscription_id,
    cycle_row.id,
    'cycle_scheduled',
    jsonb_build_object(
      'sequence', cycle_row.sequence,
      'due_on', cycle_row.due_on,
      'issue_on', cycle_row.issue_on,
      'plan_version_id', cycle_row.plan_version_id
    )
  );
  return cycle_row;
end;
$$;

create or replace function private.schedule_next_subscription_cycle(
  p_subscription_id uuid,
  p_previous_cycle_id uuid
)
returns public.subscription_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row public.subscriptions;
  previous_cycle public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  next_end date;
  cycle_row public.subscription_cycles;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status <> 'active' then return null; end if;

  select cycle.* into previous_cycle
  from public.subscription_cycles as cycle
  where cycle.id = p_previous_cycle_id
    and cycle.subscription_id = p_subscription_id;
  if previous_cycle.id is null then raise no_data_found; end if;

  if exists (
    select 1 from public.subscription_cycles as open_cycle
    where open_cycle.subscription_id = p_subscription_id
      and open_cycle.status in ('scheduled', 'invoiced', 'past_due')
  ) then
    select * into cycle_row
    from public.subscription_cycles as open_cycle
    where open_cycle.subscription_id = p_subscription_id
      and open_cycle.status in ('scheduled', 'invoiced', 'past_due')
    order by open_cycle.sequence
    limit 1;
    return cycle_row;
  end if;

  select plan.* into plan_row
  from public.subscription_plan_versions as plan
  where plan.subscription_id = p_subscription_id
    and plan.effective_from <= previous_cycle.period_end
  order by plan.effective_from desc, plan.version desc
  limit 1;
  if plan_row.id is null then raise no_data_found; end if;

  next_end := private.subscription_add_interval(
    previous_cycle.period_end,
    plan_row.interval_unit,
    plan_row.interval_count,
    plan_row.anchor_day,
    plan_row.end_of_month_policy
  );

  return private.schedule_subscription_cycle(
    p_subscription_id,
    plan_row.id,
    previous_cycle.sequence + 1,
    previous_cycle.period_end,
    next_end
  );
end;
$$;

-- This is an invoice-domain extension: it writes ordinary invoices and
-- invoice_items under the same constraints, numbering, audit, and payment
-- ledger used by every other Wolf Forge invoice.
create or replace function private.issue_subscription_cycle_invoice(
  p_actor_id uuid,
  p_cycle_id uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.subscription_cycles;
  subscription_row public.subscriptions;
  plan_row public.subscription_plan_versions;
  invoice_row public.invoices;
  subtotal bigint;
  discount_total bigint;
begin
  if p_actor_id is null or p_actor_id is distinct from (select auth.uid()) then
    raise exception 'verified subscription billing actor is required' using errcode = '42501';
  end if;

  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.id = p_cycle_id
  for update;
  if cycle_row.id is null then raise no_data_found; end if;
  if cycle_row.status <> 'scheduled' or cycle_row.invoice_id is not null then
    raise exception 'subscription cycle is not available for invoice generation'
      using errcode = '55000';
  end if;

  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = cycle_row.subscription_id
  for update;
  if subscription_row.status not in ('active', 'pending_cancellation')
    or subscription_row.archived_at is not null
  then
    raise exception 'subscription lifecycle blocks invoice generation' using errcode = '55000';
  end if;
  if subscription_row.status = 'pending_cancellation'
    and cycle_row.due_on >= subscription_row.cancel_effective_at
  then
    raise exception 'subscription cancellation blocks this billing cycle' using errcode = '55000';
  end if;
  if cycle_row.issue_on > current_date then
    raise exception 'subscription cycle is not due for invoice generation' using errcode = '55000';
  end if;

  select plan.* into plan_row
  from public.subscription_plan_versions as plan
  where plan.id = cycle_row.plan_version_id;
  if plan_row.id is null then raise no_data_found; end if;

  insert into public.invoices (
    company_id, client_profile_id, status, currency, billing_reason, due_at,
    subtotal_cents, discount_total_cents, tax_total_cents, total_cents,
    created_by_profile_id, updated_by_profile_id
  ) values (
    subscription_row.company_id,
    subscription_row.client_profile_id,
    'draft',
    plan_row.currency,
    'subscription_cycle',
    make_timestamptz(
      extract(year from cycle_row.due_on)::integer,
      extract(month from cycle_row.due_on)::integer,
      extract(day from cycle_row.due_on)::integer,
      0, 0, 0, 'UTC'
    ),
    0, 0, 0, 0,
    p_actor_id,
    p_actor_id
  ) returning * into invoice_row;

  insert into public.invoice_items (
    invoice_id, service_id, position, name, description, quantity,
    unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status
  )
  select
    invoice_row.id,
    item.service_id,
    item.position,
    item.service_name_snapshot,
    item.service_description_snapshot,
    item.quantity,
    item.unit_amount_cents,
    case
      when item.coupon_recurring_duration = 'first_payment' and cycle_row.sequence > 1 then 0
      else item.unit_discount_cents
    end,
    item.is_taxable,
    case when item.service_id is null then 'not_applicable' else 'awaiting_payment' end
  from public.subscription_plan_items as item
  where item.plan_version_id = plan_row.id
  order by item.position;

  select
    coalesce(sum(item.unit_price_cents * item.quantity), 0)::bigint,
    coalesce(sum(item.unit_discount_cents * item.quantity), 0)::bigint
  into subtotal, discount_total
  from public.invoice_items as item
  where item.invoice_id = invoice_row.id;

  if not exists (select 1 from public.invoice_items where invoice_id = invoice_row.id) then
    raise exception 'subscription plan has no billable items' using errcode = '55000';
  end if;

  update public.invoices
  set subtotal_cents = subtotal,
      discount_total_cents = discount_total,
      total_cents = subtotal - discount_total
  where id = invoice_row.id;

  update public.subscription_cycles
  set invoice_id = invoice_row.id,
      status = 'invoiced',
      generated_at = now(),
      blocked_reason = null
  where id = cycle_row.id;

  update public.invoices
  set status = case when total_cents = 0 then 'paid' else 'unpaid' end,
      invoice_number = private.next_invoice_number(),
      issued_at = now(),
      updated_by_profile_id = p_actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  if invoice_row.status = 'paid' then
    update public.invoice_items
    set fulfillment_status = 'pending'
    where invoice_id = invoice_row.id
      and service_id is not null
      and fulfillment_status = 'awaiting_payment';
  end if;

  perform private.record_authenticated_activity(
    'invoice', invoice_row.id, 'invoice.created', 'Created subscription cycle invoice.',
    jsonb_build_object(
      'subscription_id', subscription_row.id,
      'cycle_id', cycle_row.id,
      'sequence', cycle_row.sequence
    )
  );
  perform private.record_authenticated_activity(
    'invoice', invoice_row.id, 'invoice.issued',
    format('Issued invoice #%s.', invoice_row.invoice_number),
    jsonb_build_object('invoice', private.invoice_snapshot(invoice_row.id))
  );
  perform private.record_subscription_event(
    subscription_row.id,
    cycle_row.id,
    'invoice_generated',
    jsonb_build_object('invoice_id', invoice_row.id, 'invoice_number', invoice_row.invoice_number)
  );

  return invoice_row;
end;
$$;

-- Ordinary invoice settlement and voiding drive subscription state. No paid
-- flag or balance is copied into the subscription domain.
create or replace function private.sync_subscription_cycle_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.subscription_cycles;
  subscription_row public.subscriptions;
  settled_timestamp timestamptz;
begin
  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.invoice_id = new.id
  for update;
  if cycle_row.id is null then return new; end if;

  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = cycle_row.subscription_id
  for update;

  if new.archived_at is not null and old.archived_at is null then
    update public.subscription_cycles
    set status = 'voided',
        settled_at = null,
        blocked_reason = 'invoice_archived_requires_operator_action'
    where id = cycle_row.id and status <> 'paid';
    if found then
      perform private.record_subscription_event(
        cycle_row.subscription_id, cycle_row.id, 'invoice_invalidated',
        jsonb_build_object('invoice_id', new.id, 'reason', 'archived')
      );
    end if;
    return new;
  end if;

  if new.status = 'void' and old.status is distinct from 'void' then
    update public.subscription_cycles
    set status = 'voided',
        settled_at = null,
        blocked_reason = 'invoice_voided_requires_operator_action'
    where id = cycle_row.id and status <> 'paid';
    if found then
      perform private.record_subscription_event(
        cycle_row.subscription_id, cycle_row.id, 'invoice_invalidated',
        jsonb_build_object('invoice_id', new.id, 'reason', 'voided')
      );
    end if;
    return new;
  end if;

  if new.status = 'paid' and old.status is distinct from 'paid'
    and cycle_row.status <> 'paid'
  then
    select max(payment.settled_at) into settled_timestamp
    from public.invoice_payments as payment
    where payment.invoice_id = new.id and payment.status = 'succeeded';
    settled_timestamp := coalesce(settled_timestamp, now());

    update public.subscription_cycles
    set status = 'paid',
        settled_at = settled_timestamp,
        past_due_at = null,
        blocked_reason = null,
        fulfillment_status = case
          when fulfillment_action = 'none' then 'not_applicable'
          else 'pending'
        end,
        fulfillment_metadata = case
          when fulfillment_action = 'none' then '{}'::jsonb
          else jsonb_build_object(
            'integration_status', 'deferred',
            'reason', 'project_fulfillment_boundary_not_transactionally_reusable'
          )
        end
    where id = cycle_row.id;

    perform private.record_subscription_event(
      cycle_row.subscription_id, cycle_row.id, 'payment_settled',
      jsonb_build_object('invoice_id', new.id, 'settled_at', settled_timestamp)
    );

    if cycle_row.fulfillment_action <> 'none' then
      perform private.record_subscription_event(
        cycle_row.subscription_id, cycle_row.id, 'fulfillment_pending',
        jsonb_build_object(
          'recurring_action', cycle_row.fulfillment_action,
          'integration_status', 'deferred'
        )
      );
    end if;

    if subscription_row.status = 'past_due' then
      update public.subscriptions
      set status = 'active', updated_by_profile_id = coalesce((select auth.uid()), updated_by_profile_id)
      where id = subscription_row.id;
      perform private.record_subscription_event(
        subscription_row.id, cycle_row.id, 'recovered',
        jsonb_build_object('invoice_id', new.id)
      );
      subscription_row.status := 'active';
    end if;

    if subscription_row.status = 'active' then
      perform private.schedule_next_subscription_cycle(subscription_row.id, cycle_row.id);
    end if;
  end if;

  return new;
end;
$$;

create trigger invoices_sync_subscription_cycle
after update of status, archived_at on public.invoices
for each row execute function private.sync_subscription_cycle_from_invoice();

create or replace function private.sync_subscription_payment_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.subscription_cycles;
begin
  if new.status <> 'failed' then return new; end if;
  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.invoice_id = new.invoice_id;
  if cycle_row.id is null then return new; end if;

  perform private.record_subscription_event(
    cycle_row.subscription_id,
    cycle_row.id,
    'payment_failed',
    jsonb_build_object(
      'invoice_id', new.invoice_id,
      'invoice_payment_id', new.id,
      'processor', new.processor,
      'processor_reference', new.processor_reference
    )
  );
  return new;
end;
$$;

create trigger invoice_payments_sync_subscription_attempt
after insert on public.invoice_payments
for each row execute function private.sync_subscription_payment_attempt();

-- -----------------------------------------------------------------------------
-- Controlled subscription mutations and scheduler boundary
-- -----------------------------------------------------------------------------

create or replace function public.app_create_subscription(
  p_request_id uuid,
  p_payload jsonb
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.manage');
  existing_id uuid;
  subscription_row public.subscriptions;
  plan_row public.subscription_plan_versions;
  service_row public.services;
  interval_unit text;
  interval_count integer;
  anchor_day smallint;
  eom_policy text;
  billing_anchor date;
  period_end date;
  normalized_currency text;
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or not p_payload ?& array[
      'company_id', 'service_id', 'plan_source', 'billing_anchor',
      'interval_unit', 'interval_count', 'currency', 'recurring_action', 'items'
    ]
    or p_payload - array[
      'company_id', 'client_profile_id', 'service_id', 'plan_source',
      'billing_anchor', 'interval_unit', 'interval_count', 'end_of_month_policy',
      'currency', 'lead_days', 'grace_days', 'recurring_action',
      'request_limit_total', 'request_limit_active', 'items',
      'external_processor', 'external_processor_reference'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid subscription create payload' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'subscription.create', p_request_id, p_payload
  );
  if existing_id is not null then
    select subscription.* into subscription_row
    from public.subscriptions as subscription where subscription.id = existing_id;
    if subscription_row.id is null then raise no_data_found; end if;
    return subscription_row;
  end if;

  if not exists (
    select 1 from public.companies as company_row
    where company_row.id = (p_payload ->> 'company_id')::uuid
      and company_row.archived_at is null
  ) then raise no_data_found; end if;

  select service.* into service_row
  from public.services as service
  where service.id = (p_payload ->> 'service_id')::uuid
    and service.is_active
    and service.archived_at is null;
  if service_row.id is null then
    raise exception 'subscription Service must be active' using errcode = '23514';
  end if;

  interval_unit := p_payload ->> 'interval_unit';
  interval_count := (p_payload ->> 'interval_count')::integer;
  eom_policy := coalesce(p_payload ->> 'end_of_month_policy', 'clamp');
  billing_anchor := (p_payload ->> 'billing_anchor')::date;
  normalized_currency := upper(p_payload ->> 'currency');
  anchor_day := case
    when interval_unit in ('month', 'year') then extract(day from billing_anchor)::smallint
    else null
  end;

  if p_payload ->> 'plan_source' not in ('admin_invoice', 'checkout', 'payment_link', 'service_purchase')
    or interval_unit not in ('day', 'week', 'month', 'year')
    or interval_count <= 0
    or eom_policy not in ('clamp', 'skip')
    or normalized_currency !~ '^[A-Z]{3}$'
    or coalesce((p_payload ->> 'lead_days')::integer, 5) not between 0 and 90
    or coalesce((p_payload ->> 'grace_days')::integer, 15) not between 0 and 365
    or p_payload ->> 'recurring_action' not in ('none', 'reopen_order', 'create_order', 'client_request')
  then
    raise exception 'invalid subscription create payload' using errcode = '22023';
  end if;

  period_end := private.subscription_add_interval(
    billing_anchor, interval_unit, interval_count, anchor_day, eom_policy
  );

  insert into public.subscriptions (
    company_id, client_profile_id, service_id, status, plan_source,
    billing_anchor, current_period_end, external_processor,
    external_processor_reference, created_by_profile_id, updated_by_profile_id
  ) values (
    (p_payload ->> 'company_id')::uuid,
    nullif(p_payload ->> 'client_profile_id', '')::uuid,
    service_row.id,
    'active',
    p_payload ->> 'plan_source',
    billing_anchor,
    period_end,
    nullif(btrim(p_payload ->> 'external_processor'), ''),
    nullif(btrim(p_payload ->> 'external_processor_reference'), ''),
    actor_id,
    actor_id
  ) returning * into subscription_row;

  insert into public.subscription_plan_versions (
    subscription_id, version, effective_from, interval_unit, interval_count,
    anchor_day, end_of_month_policy, currency, lead_days, grace_days,
    recurring_action, request_limit_total, request_limit_active,
    created_by_profile_id
  ) values (
    subscription_row.id, 1, billing_anchor, interval_unit, interval_count,
    anchor_day, eom_policy, normalized_currency,
    coalesce((p_payload ->> 'lead_days')::integer, 5),
    coalesce((p_payload ->> 'grace_days')::integer, 15),
    p_payload ->> 'recurring_action',
    (p_payload ->> 'request_limit_total')::integer,
    (p_payload ->> 'request_limit_active')::integer,
    actor_id
  ) returning * into plan_row;

  perform private.insert_subscription_plan_items(plan_row.id, p_payload -> 'items');

  update public.subscriptions
  set current_plan_version_id = plan_row.id
  where id = subscription_row.id
  returning * into subscription_row;

  perform private.schedule_subscription_cycle(
    subscription_row.id, plan_row.id, 1, billing_anchor, period_end
  );

  perform private.record_subscription_event(
    subscription_row.id, null, 'created',
    jsonb_build_object(
      'plan_version_id', plan_row.id,
      'service_id', subscription_row.service_id,
      'billing_anchor', subscription_row.billing_anchor
    )
  );
  perform private.record_authenticated_activity(
    'subscription', subscription_row.id, 'subscription.created',
    format('Created subscription %s.', subscription_row.public_ref),
    jsonb_build_object('company_id', subscription_row.company_id, 'plan_version_id', plan_row.id)
  );
  perform private.remember_create_request(
    actor_id, 'subscription.create', p_request_id, p_payload, subscription_row.id
  );

  select * into subscription_row from public.subscriptions where id = subscription_row.id;
  return subscription_row;
end;
$$;

create or replace function public.app_update_subscription_terms(
  p_request_id uuid,
  p_subscription_id uuid,
  p_payload jsonb
)
returns public.subscription_plan_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.manage');
  request_payload jsonb := jsonb_build_object(
    'subscription_id', p_subscription_id, 'terms', p_payload
  );
  existing_id uuid;
  subscription_row public.subscriptions;
  previous_plan public.subscription_plan_versions;
  plan_row public.subscription_plan_versions;
  effective_from date;
  next_sequence integer;
  open_due_on date;
begin
  if p_request_id is null or p_subscription_id is null
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or not p_payload ?& array[
      'interval_unit', 'interval_count', 'currency', 'recurring_action', 'items'
    ]
    or p_payload - array[
      'effective_from', 'interval_unit', 'interval_count', 'end_of_month_policy',
      'currency', 'lead_days', 'grace_days', 'recurring_action',
      'request_limit_total', 'request_limit_active', 'items'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid subscription terms payload' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'subscription.terms.change', p_request_id, request_payload
  );
  if existing_id is not null then
    select plan.* into plan_row
    from public.subscription_plan_versions as plan where plan.id = existing_id;
    if plan_row.id is null then raise no_data_found; end if;
    return plan_row;
  end if;

  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'canceled' then
    raise exception 'canceled subscription terms cannot be changed' using errcode = '55000';
  end if;

  select plan.* into previous_plan
  from public.subscription_plan_versions as plan
  where plan.id = subscription_row.current_plan_version_id;
  if previous_plan.id is null then raise no_data_found; end if;

  select max(cycle.due_on) into open_due_on
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id
    and cycle.status in ('scheduled', 'invoiced', 'past_due');
  effective_from := coalesce(
    nullif(p_payload ->> 'effective_from', '')::date,
    coalesce(open_due_on, current_date) + 1
  );
  if effective_from <= previous_plan.effective_from
    or (open_due_on is not null and effective_from <= open_due_on)
    or p_payload ->> 'interval_unit' not in ('day', 'week', 'month', 'year')
    or (p_payload ->> 'interval_count')::integer <= 0
    or coalesce(p_payload ->> 'end_of_month_policy', previous_plan.end_of_month_policy) not in ('clamp', 'skip')
    or upper(p_payload ->> 'currency') !~ '^[A-Z]{3}$'
    or coalesce((p_payload ->> 'lead_days')::integer, previous_plan.lead_days) not between 0 and 90
    or coalesce((p_payload ->> 'grace_days')::integer, previous_plan.grace_days) not between 0 and 365
    or p_payload ->> 'recurring_action' not in ('none', 'reopen_order', 'create_order', 'client_request')
  then
    raise exception 'invalid subscription terms payload' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into next_sequence
  from public.subscription_plan_versions
  where subscription_id = p_subscription_id;

  insert into public.subscription_plan_versions (
    subscription_id, version, effective_from, interval_unit, interval_count,
    anchor_day, end_of_month_policy, currency, lead_days, grace_days,
    recurring_action, request_limit_total, request_limit_active,
    created_by_profile_id
  ) values (
    p_subscription_id,
    next_sequence,
    effective_from,
    p_payload ->> 'interval_unit',
    (p_payload ->> 'interval_count')::integer,
    case when p_payload ->> 'interval_unit' in ('month', 'year')
      then extract(day from subscription_row.billing_anchor)::smallint else null end,
    coalesce(p_payload ->> 'end_of_month_policy', previous_plan.end_of_month_policy),
    upper(p_payload ->> 'currency'),
    coalesce((p_payload ->> 'lead_days')::integer, previous_plan.lead_days),
    coalesce((p_payload ->> 'grace_days')::integer, previous_plan.grace_days),
    p_payload ->> 'recurring_action',
    (p_payload ->> 'request_limit_total')::integer,
    (p_payload ->> 'request_limit_active')::integer,
    actor_id
  ) returning * into plan_row;

  perform private.insert_subscription_plan_items(plan_row.id, p_payload -> 'items');
  update public.subscriptions
  set current_plan_version_id = plan_row.id, updated_by_profile_id = actor_id
  where id = p_subscription_id;

  perform private.record_subscription_event(
    p_subscription_id, null, 'terms_changed',
    jsonb_build_object(
      'previous_plan_version_id', previous_plan.id,
      'plan_version_id', plan_row.id,
      'effective_from', plan_row.effective_from
    )
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.terms_changed',
    format('Changed subscription terms to version %s.', plan_row.version),
    jsonb_build_object('previous_plan_version_id', previous_plan.id, 'plan_version_id', plan_row.id)
  );
  perform private.remember_create_request(
    actor_id, 'subscription.terms.change', p_request_id, request_payload, plan_row.id
  );
  return plan_row;
end;
$$;

create or replace function public.app_generate_subscription_cycle_invoice(
  p_request_id uuid,
  p_cycle_id uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  request_payload jsonb := jsonb_build_object('cycle_id', p_cycle_id);
  existing_id uuid;
  cycle_row public.subscription_cycles;
  invoice_row public.invoices;
begin
  if p_request_id is null or p_cycle_id is null then
    raise exception 'subscription cycle generation request is invalid' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'subscription.cycle.generate', p_request_id, request_payload
  );
  if existing_id is not null then
    select invoice.* into invoice_row from public.invoices as invoice where invoice.id = existing_id;
    if invoice_row.id is null then raise no_data_found; end if;
    return invoice_row;
  end if;

  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.id = p_cycle_id
  for update;
  if cycle_row.id is null then raise no_data_found; end if;

  if cycle_row.invoice_id is not null then
    select invoice.* into invoice_row
    from public.invoices as invoice where invoice.id = cycle_row.invoice_id;
  else
    invoice_row := private.issue_subscription_cycle_invoice(actor_id, p_cycle_id);
  end if;

  perform private.remember_create_request(
    actor_id, 'subscription.cycle.generate', p_request_id, request_payload, invoice_row.id
  );
  return invoice_row;
end;
$$;

create or replace function public.app_pause_subscription(
  p_subscription_id uuid,
  p_resumes_at date default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.pause');
  subscription_row public.subscriptions;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'paused' then return subscription_row; end if;
  if subscription_row.status not in ('active', 'past_due') then
    raise exception 'subscription cannot be paused from its current state' using errcode = '55000';
  end if;
  if p_resumes_at is not null and p_resumes_at <= current_date then
    raise exception 'subscription resume date must be in the future' using errcode = '22023';
  end if;

  update public.subscriptions
  set status = 'paused', paused_at = now(), resumes_at = p_resumes_at,
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'paused', jsonb_build_object('resumes_at', p_resumes_at)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.paused', 'Paused subscription.',
    jsonb_build_object('resumes_at', p_resumes_at)
  );
  return subscription_row;
end;
$$;

create or replace function public.app_resume_subscription(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.pause');
  subscription_row public.subscriptions;
  cycle_row public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  next_due date;
  next_end date;
  last_sequence integer;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'active' then return subscription_row; end if;
  if subscription_row.status <> 'paused' then
    raise exception 'only a paused subscription can be resumed' using errcode = '55000';
  end if;

  -- Enter active state inside this transaction so the shared next-cycle
  -- scheduler can be reused if the invoice settled while billing was paused.
  update public.subscriptions
  set status = 'active', paused_at = null, resumes_at = null,
      updated_by_profile_id = actor_id
  where id = p_subscription_id;

  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id
    and cycle.status in ('scheduled', 'invoiced', 'past_due')
  order by cycle.sequence desc
  limit 1
  for update;

  if cycle_row.id is null then
    select paid_cycle.* into cycle_row
    from public.subscription_cycles as paid_cycle
    where paid_cycle.subscription_id = p_subscription_id
      and paid_cycle.status = 'paid'
    order by paid_cycle.sequence desc
    limit 1;
    if cycle_row.id is not null then
      cycle_row := private.schedule_next_subscription_cycle(p_subscription_id, cycle_row.id);
    end if;
  end if;

  -- Wolf Forge resume policy: preserve the original calendar anchor, do not
  -- back-bill periods missed while paused, and retain every skipped cycle.
  if cycle_row.id is not null and cycle_row.status = 'scheduled'
    and cycle_row.due_on < current_date
  then
    update public.subscription_cycles
    set status = 'skipped', blocked_reason = 'skipped_while_paused'
    where id = cycle_row.id;
    last_sequence := cycle_row.sequence;
    next_due := cycle_row.period_end;

    select plan.* into plan_row
    from public.subscription_plan_versions as plan
    where plan.id = subscription_row.current_plan_version_id;

    while next_due < current_date loop
      next_due := private.subscription_add_interval(
        next_due, plan_row.interval_unit, plan_row.interval_count,
        plan_row.anchor_day, plan_row.end_of_month_policy
      );
    end loop;
    next_end := private.subscription_add_interval(
      next_due, plan_row.interval_unit, plan_row.interval_count,
      plan_row.anchor_day, plan_row.end_of_month_policy
    );
    perform private.schedule_subscription_cycle(
      p_subscription_id, plan_row.id, last_sequence + 1, next_due, next_end
    );
  end if;

  update public.subscriptions
  set status = 'active', paused_at = null, resumes_at = null,
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'resumed',
    jsonb_build_object('policy', 'preserve_anchor_skip_missed_periods')
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.resumed', 'Resumed subscription.',
    jsonb_build_object('policy', 'preserve_anchor_skip_missed_periods')
  );
  return subscription_row;
end;
$$;

create or replace function public.app_schedule_subscription_cancellation(
  p_subscription_id uuid,
  p_reason text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  effective_date date;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'subscription cancellation reason is too long' using errcode = '22023';
  end if;
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'pending_cancellation' then return subscription_row; end if;
  if subscription_row.status not in ('active', 'past_due') then
    raise exception 'subscription cancellation cannot be scheduled from its current state'
      using errcode = '55000';
  end if;

  select coalesce(
    (select max(cycle.period_end) from public.subscription_cycles as cycle
     where cycle.subscription_id = p_subscription_id and cycle.status = 'paid'),
    (select min(cycle.period_end) from public.subscription_cycles as cycle
     where cycle.subscription_id = p_subscription_id
       and cycle.status in ('scheduled', 'invoiced', 'past_due')),
    subscription_row.current_period_end
  ) into effective_date;
  if effective_date is null then
    raise exception 'subscription has no cancelable billing period' using errcode = '55000';
  end if;

  update public.subscription_cycles
  set status = 'skipped', blocked_reason = 'cancellation_scheduled'
  where subscription_id = p_subscription_id
    and status = 'scheduled'
    and due_on >= effective_date;

  update public.subscriptions
  set status = 'pending_cancellation', cancel_effective_at = effective_date,
      cancellation_reason = normalized_reason, paused_at = null, resumes_at = null,
      current_period_end = effective_date, updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'cancellation_scheduled',
    jsonb_build_object('effective_at', effective_date, 'reason', normalized_reason)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.cancellation_scheduled',
    'Scheduled subscription cancellation.',
    jsonb_build_object('effective_at', effective_date, 'reason', normalized_reason)
  );
  return subscription_row;
end;
$$;

create or replace function public.app_remove_subscription_cancellation(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  last_cycle public.subscription_cycles;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'active' then return subscription_row; end if;
  if subscription_row.status <> 'pending_cancellation' then
    raise exception 'subscription has no scheduled cancellation' using errcode = '55000';
  end if;

  update public.subscriptions
  set status = 'active', cancel_effective_at = null, cancellation_reason = null,
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  select cycle.* into last_cycle
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id and cycle.status = 'paid'
  order by cycle.sequence desc limit 1;
  if last_cycle.id is not null then
    perform private.schedule_next_subscription_cycle(p_subscription_id, last_cycle.id);
  end if;

  perform private.record_subscription_event(
    p_subscription_id, null, 'cancellation_removed', '{}'::jsonb
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.cancellation_removed',
    'Removed scheduled subscription cancellation.'
  );
  select * into subscription_row from public.subscriptions where id = p_subscription_id;
  return subscription_row;
end;
$$;

create or replace function public.app_cancel_subscription(
  p_subscription_id uuid,
  p_reason text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'subscription cancellation reason is too long' using errcode = '22023';
  end if;
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'canceled' then return subscription_row; end if;

  update public.subscription_cycles
  set status = 'skipped', blocked_reason = 'subscription_canceled'
  where subscription_id = p_subscription_id and status = 'scheduled';

  update public.subscriptions
  set status = 'canceled', canceled_at = now(), current_period_end = null,
      paused_at = null, resumes_at = null, cancel_effective_at = null,
      cancellation_reason = coalesce(normalized_reason, cancellation_reason),
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'canceled',
    jsonb_build_object('mode', 'immediate', 'reason', subscription_row.cancellation_reason)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.canceled',
    'Canceled subscription.',
    jsonb_build_object('reason', subscription_row.cancellation_reason)
  );
  return subscription_row;
end;
$$;

create or replace function public.app_reconcile_subscription_state(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  subscription_row public.subscriptions;
  cycle_row public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  settled_timestamp timestamptz;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'canceled' then return subscription_row; end if;

  if subscription_row.status = 'pending_cancellation'
    and subscription_row.cancel_effective_at <= current_date
  then
    update public.subscriptions
    set status = 'canceled', canceled_at = now(), current_period_end = null,
        cancel_effective_at = null, updated_by_profile_id = actor_id
    where id = p_subscription_id
    returning * into subscription_row;
    perform private.record_subscription_event(
      p_subscription_id, null, 'canceled', jsonb_build_object('mode', 'period_end')
    );
    return subscription_row;
  end if;

  if subscription_row.status = 'paused'
    and subscription_row.resumes_at is not null
    and subscription_row.resumes_at <= current_date
  then
    return public.app_resume_subscription(p_subscription_id);
  end if;

  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id
    and cycle.status in ('scheduled', 'invoiced', 'past_due', 'voided')
  order by cycle.sequence
  limit 1
  for update;
  if cycle_row.id is null then return subscription_row; end if;

  if cycle_row.invoice_id is not null then
    if exists (
      select 1 from public.invoices as invoice
      where invoice.id = cycle_row.invoice_id and invoice.status = 'paid'
    ) and cycle_row.status <> 'paid' then
      select max(payment.settled_at) into settled_timestamp
      from public.invoice_payments as payment
      where payment.invoice_id = cycle_row.invoice_id and payment.status = 'succeeded';
      update public.subscription_cycles
      set status = 'paid', settled_at = coalesce(settled_timestamp, now()),
          past_due_at = null, blocked_reason = null
      where id = cycle_row.id;
      if subscription_row.status = 'past_due' then
        update public.subscriptions
        set status = 'active', updated_by_profile_id = actor_id
        where id = p_subscription_id;
        perform private.record_subscription_event(
          p_subscription_id, cycle_row.id, 'recovered',
          jsonb_build_object('invoice_id', cycle_row.invoice_id)
        );
      end if;
      perform private.schedule_next_subscription_cycle(p_subscription_id, cycle_row.id);
    elsif exists (
      select 1 from public.invoices as invoice
      where invoice.id = cycle_row.invoice_id
        and (invoice.status = 'void' or invoice.archived_at is not null)
    ) and cycle_row.status <> 'voided' then
      update public.subscription_cycles
      set status = 'voided', blocked_reason = 'invoice_invalidated_requires_operator_action',
          settled_at = null
      where id = cycle_row.id;
      perform private.record_subscription_event(
        p_subscription_id, cycle_row.id, 'invoice_invalidated',
        jsonb_build_object('invoice_id', cycle_row.invoice_id)
      );
    elsif cycle_row.status in ('invoiced', 'past_due') then
      select plan.* into plan_row
      from public.subscription_plan_versions as plan where plan.id = cycle_row.plan_version_id;
      if current_date >= cycle_row.due_on + plan_row.grace_days
        and cycle_row.status <> 'past_due'
      then
        update public.subscription_cycles
        set status = 'past_due', past_due_at = now(), blocked_reason = 'unpaid_invoice'
        where id = cycle_row.id;
        if subscription_row.status = 'active' then
          update public.subscriptions
          set status = 'past_due', updated_by_profile_id = actor_id
          where id = p_subscription_id;
        end if;
        perform private.record_subscription_event(
          p_subscription_id, cycle_row.id, 'past_due',
          jsonb_build_object(
            'invoice_id', cycle_row.invoice_id,
            'due_on', cycle_row.due_on,
            'grace_days', plan_row.grace_days
          )
        );
      end if;
    end if;
  end if;

  select * into subscription_row from public.subscriptions where id = p_subscription_id;
  return subscription_row;
end;
$$;

create or replace function public.app_list_due_subscription_work(p_limit integer default 100)
returns table (
  subscription_id uuid,
  cycle_id uuid,
  work_type text,
  due_at date,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform private.require_subscription_capability('subscriptions.billing');
  return query
  select work.subscription_id, work.cycle_id, work.work_type, work.due_at, work.reason
  from (
    select
      cycle.subscription_id,
      cycle.id as cycle_id,
      'issue_invoice'::text as work_type,
      cycle.issue_on as due_at,
      'scheduled_cycle_due'::text as reason,
      1 as priority
    from public.subscription_cycles as cycle
    join public.subscriptions as subscription on subscription.id = cycle.subscription_id
    where cycle.status = 'scheduled'
      and cycle.invoice_id is null
      and cycle.issue_on <= current_date
      and subscription.status in ('active', 'pending_cancellation')
      and subscription.archived_at is null

    union all

    select
      cycle.subscription_id,
      cycle.id,
      'reconcile'::text,
      cycle.due_on + plan.grace_days,
      'past_due_threshold'::text,
      2
    from public.subscription_cycles as cycle
    join public.subscription_plan_versions as plan on plan.id = cycle.plan_version_id
    join public.subscriptions as subscription on subscription.id = cycle.subscription_id
    where cycle.status = 'invoiced'
      and cycle.due_on + plan.grace_days <= current_date
      and subscription.archived_at is null

    union all

    select
      cycle.subscription_id,
      cycle.id,
      'operator_action'::text,
      cycle.due_on,
      coalesce(cycle.blocked_reason, 'invalidated_invoice')::text,
      3
    from public.subscription_cycles as cycle
    join public.subscriptions as subscription on subscription.id = cycle.subscription_id
    where cycle.status = 'voided' and subscription.archived_at is null

    union all

    select
      subscription.id,
      null::uuid,
      'reconcile'::text,
      subscription.resumes_at,
      'scheduled_resume'::text,
      1
    from public.subscriptions as subscription
    where subscription.status = 'paused'
      and subscription.resumes_at is not null
      and subscription.resumes_at <= current_date
      and subscription.archived_at is null

    union all

    select
      subscription.id,
      null::uuid,
      'reconcile'::text,
      subscription.cancel_effective_at,
      'period_end_cancellation'::text,
      1
    from public.subscriptions as subscription
    where subscription.status = 'pending_cancellation'
      and subscription.cancel_effective_at <= current_date
      and subscription.archived_at is null
  ) as work
  order by work.priority, work.due_at, work.subscription_id
  limit safe_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Safe read models
-- -----------------------------------------------------------------------------

create or replace function public.app_list_subscription_summaries()
returns table (
  subscription_id uuid,
  public_ref text,
  company_id uuid,
  company_name text,
  client_profile_id uuid,
  service_id uuid,
  service_name text,
  status text,
  health text,
  paid_cycle_count bigint,
  last_payment_at timestamptz,
  next_payment_on date,
  amount_cents bigint,
  currency text,
  interval_unit text,
  interval_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    subscription.id,
    subscription.public_ref,
    subscription.company_id,
    company.name,
    subscription.client_profile_id,
    subscription.service_id,
    service.name,
    subscription.status,
    case
      when exists (
        select 1 from public.subscription_cycles as invalid_cycle
        where invalid_cycle.subscription_id = subscription.id
          and invalid_cycle.status = 'voided'
      ) then 'requires_attention'
      when subscription.status = 'active'
        and subscription.current_period_end < current_date - plan.grace_days
        then 'stalled'
      else subscription.status
    end,
    (select count(*) from public.subscription_cycles as paid_cycle
     where paid_cycle.subscription_id = subscription.id and paid_cycle.status = 'paid'),
    (select max(payment.settled_at)
     from public.subscription_cycles as paid_cycle
     join public.invoice_payments as payment on payment.invoice_id = paid_cycle.invoice_id
     where paid_cycle.subscription_id = subscription.id and payment.status = 'succeeded'),
    (select open_cycle.due_on
     from public.subscription_cycles as open_cycle
     where open_cycle.subscription_id = subscription.id
       and open_cycle.status in ('scheduled', 'invoiced', 'past_due')
     order by open_cycle.sequence limit 1),
    (select coalesce(sum((item.unit_amount_cents - item.unit_discount_cents) * item.quantity), 0)::bigint
     from public.subscription_plan_items as item
     where item.plan_version_id = plan.id),
    plan.currency,
    plan.interval_unit,
    plan.interval_count
  from public.subscriptions as subscription
  join public.companies as company on company.id = subscription.company_id
  join public.services as service on service.id = subscription.service_id
  join public.subscription_plan_versions as plan on plan.id = subscription.current_plan_version_id
  where subscription.archived_at is null
    and private.can_read_subscription(subscription.id)
  order by subscription.created_at desc;
$$;

create or replace function public.app_get_subscription_detail(p_subscription_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  is_internal boolean := (select private.is_internal_user());
  result jsonb;
begin
  if not private.can_read_subscription(p_subscription_id) then
    raise exception 'subscription access is denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'subscription', case when is_internal then to_jsonb(subscription) else
      to_jsonb(subscription) - array[
        'created_by_profile_id', 'updated_by_profile_id',
        'external_processor', 'external_processor_reference', 'archived_at'
      ] end,
    'current_plan', case when is_internal then to_jsonb(plan) else
      to_jsonb(plan) - array['created_by_profile_id'] end,
    'plan_items', coalesce((
      select jsonb_agg(
        case when is_internal then to_jsonb(item)
        else to_jsonb(item) - array['coupon_id'] end
        order by item.position
      )
      from public.subscription_plan_items as item
      where item.plan_version_id = plan.id
    ), '[]'::jsonb),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cycle.id,
        'sequence', cycle.sequence,
        'period_start', cycle.period_start,
        'period_end', cycle.period_end,
        'due_on', cycle.due_on,
        'issue_on', cycle.issue_on,
        'status', cycle.status,
        'invoice_id', cycle.invoice_id,
        'generated_at', cycle.generated_at,
        'settled_at', cycle.settled_at,
        'fulfillment_status', cycle.fulfillment_status
      ) order by cycle.sequence desc)
      from public.subscription_cycles as cycle
      where cycle.subscription_id = subscription.id
    ), '[]'::jsonb),
    'events', case when is_internal then coalesce((
      select jsonb_agg(to_jsonb(event) order by event.occurred_at desc)
      from public.subscription_events as event
      where event.subscription_id = subscription.id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result
  from public.subscriptions as subscription
  join public.subscription_plan_versions as plan on plan.id = subscription.current_plan_version_id
  where subscription.id = p_subscription_id and subscription.archived_at is null;

  if result is null then raise no_data_found; end if;
  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit integration, RLS, and least privilege
-- -----------------------------------------------------------------------------

alter table public.activity_events drop constraint activity_events_entity_type_valid;
alter table public.activity_events add constraint activity_events_entity_type_valid check (
  entity_type in (
    'company', 'client_contact', 'service_folder', 'service', 'order',
    'order_task', 'profile', 'coupon', 'invoice', 'subscription'
  )
);

alter table public.subscriptions enable row level security;
alter table public.subscription_plan_versions enable row level security;
alter table public.subscription_plan_items enable row level security;
alter table public.subscription_cycles enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_payment_methods enable row level security;
alter table public.subscription_dunning_attempts enable row level security;

create policy subscriptions_authorized_select
on public.subscriptions for select to authenticated
using ((select private.can_read_subscription(id)));

create policy subscription_plan_versions_authorized_select
on public.subscription_plan_versions for select to authenticated
using ((select private.can_read_subscription(subscription_id)));

create policy subscription_plan_items_authorized_select
on public.subscription_plan_items for select to authenticated
using (exists (
  select 1 from public.subscription_plan_versions as plan
  where plan.id = plan_version_id
    and (select private.can_read_subscription(plan.subscription_id))
));

create policy subscription_cycles_internal_select
on public.subscription_cycles for select to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('subscriptions.view')
    or public.app_has_permission('subscriptions.manage')
    or public.app_has_permission('subscriptions.billing')
  )
);

create policy subscription_events_internal_select
on public.subscription_events for select to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('subscriptions.view')
    or public.app_has_permission('subscriptions.manage')
    or public.app_has_permission('subscriptions.billing')
  )
);

create policy subscription_payment_methods_internal_select
on public.subscription_payment_methods for select to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('subscriptions.manage')
    or public.app_has_permission('subscriptions.billing')
  )
);

create policy subscription_dunning_attempts_internal_select
on public.subscription_dunning_attempts for select to authenticated
using (
  (select private.is_internal_user())
  and public.app_has_permission('subscriptions.billing')
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
      and (public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage'))
    )
    or (entity_type = 'invoice' and (select private.can_read_invoice(entity_id)))
    or (entity_type = 'subscription' and (select private.can_read_subscription(entity_id)))
    or (entity_type = 'order' and (select private.can_access_operational_order(entity_id)))
    or (entity_type = 'order_task' and (select private.can_access_operational_task(entity_id)))
  )
);

revoke all on table
  public.subscriptions,
  public.subscription_plan_versions,
  public.subscription_plan_items,
  public.subscription_cycles,
  public.subscription_events,
  public.subscription_payment_methods,
  public.subscription_dunning_attempts
from public, anon, authenticated, service_role;

grant select on table
  public.subscriptions,
  public.subscription_plan_versions,
  public.subscription_plan_items,
  public.subscription_cycles,
  public.subscription_events,
  public.subscription_payment_methods,
  public.subscription_dunning_attempts
to authenticated, service_role;

revoke all on function private.require_subscription_capability(text) from public, anon, authenticated, service_role;
revoke all on function private.can_read_subscription(uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_subscription_client_consistency() from public, anon, authenticated, service_role;
revoke all on function private.prevent_subscription_terms_mutation() from public, anon, authenticated, service_role;
revoke all on function private.prevent_subscription_event_mutation() from public, anon, authenticated, service_role;
revoke all on function private.subscription_actor_type() from public, anon, authenticated, service_role;
revoke all on function private.record_subscription_event(uuid,uuid,text,jsonb,text,uuid) from public, anon, authenticated, service_role;
revoke all on function private.subscription_add_interval(date,text,integer,smallint,text) from public, anon, authenticated, service_role;
revoke all on function private.insert_subscription_plan_items(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.schedule_subscription_cycle(uuid,uuid,integer,date,date) from public, anon, authenticated, service_role;
revoke all on function private.schedule_next_subscription_cycle(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.issue_subscription_cycle_invoice(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.sync_subscription_cycle_from_invoice() from public, anon, authenticated, service_role;
revoke all on function private.sync_subscription_payment_attempt() from public, anon, authenticated, service_role;

revoke all on function public.app_create_subscription(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_update_subscription_terms(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_generate_subscription_cycle_invoice(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_pause_subscription(uuid,date) from public, anon, authenticated, service_role;
revoke all on function public.app_resume_subscription(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_schedule_subscription_cancellation(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.app_remove_subscription_cancellation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_cancel_subscription(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.app_reconcile_subscription_state(uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_list_due_subscription_work(integer) from public, anon, authenticated, service_role;
revoke all on function public.app_list_subscription_summaries() from public, anon, authenticated, service_role;
revoke all on function public.app_get_subscription_detail(uuid) from public, anon, authenticated, service_role;

grant execute on function public.app_create_subscription(uuid,jsonb) to authenticated;
grant execute on function public.app_update_subscription_terms(uuid,uuid,jsonb) to authenticated;
grant execute on function public.app_generate_subscription_cycle_invoice(uuid,uuid) to authenticated;
grant execute on function public.app_pause_subscription(uuid,date) to authenticated;
grant execute on function public.app_resume_subscription(uuid) to authenticated;
grant execute on function public.app_schedule_subscription_cancellation(uuid,text) to authenticated;
grant execute on function public.app_remove_subscription_cancellation(uuid) to authenticated;
grant execute on function public.app_cancel_subscription(uuid,text) to authenticated;
grant execute on function public.app_reconcile_subscription_state(uuid) to authenticated;
grant execute on function public.app_list_due_subscription_work(integer) to authenticated;
grant execute on function public.app_list_subscription_summaries() to authenticated;
grant execute on function public.app_get_subscription_detail(uuid) to authenticated;
grant execute on function private.can_read_subscription(uuid) to authenticated;

comment on table public.subscriptions is
  'Subscription identity and lifecycle only. Billing balances, payments, and refunds remain authoritative on ordinary invoices.';
comment on table public.subscription_plan_versions is
  'Append-only commercial term versions. Service edits never rewrite an existing subscription contract.';
comment on table public.subscription_plan_items is
  'Normalized integer-cent service, quantity, coupon trace, and discount snapshots for one immutable plan version.';
comment on table public.subscription_cycles is
  'One durable billing-period identity with an explicit ordinary invoice FK and deterministic idempotency key.';
comment on column public.subscriptions.public_ref is
  'Human-facing display reference only; never a relational key.';
comment on column public.subscription_cycles.fulfillment_metadata is
  'Safe deferred integration boundary for existing Order/Project orchestration; it is not a second fulfillment engine.';
comment on function public.app_resume_subscription(uuid) is
  'Resume preserves the original billing anchor and auditably skips, rather than back-bills, periods missed while paused.';
comment on function public.app_list_due_subscription_work(integer) is
  'Catch-up scheduler boundary: overdue scheduled work remains discoverable because selection uses <= rather than exact-date equality.';
