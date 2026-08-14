-- Wolf Forge Platform - Coupons backend engine
--
-- Coupon administration is capability-gated and audited. Coupon calculation
-- is side-effect free so a future Store can call it with an authoritative cart.
-- Redemption writes remain private until checkout/order settlement exists.

-- -----------------------------------------------------------------------------
-- Coupon catalog
-- -----------------------------------------------------------------------------

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  discount_type text not null,
  recurring_duration text not null default 'forever',
  single_use_per_customer boolean not null default false,
  new_customers_only boolean not null default false,
  expires_at timestamptz,
  minimum_cart_amount numeric(12, 2),
  is_active boolean not null default true,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  archived_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  constraint coupons_code_not_blank check (btrim(code) <> ''),
  constraint coupons_code_length check (char_length(code) <= 128),
  constraint coupons_code_is_canonical check (code = upper(btrim(code))),
  constraint coupons_description_not_blank
    check (description is null or btrim(description) <> ''),
  constraint coupons_discount_type_valid
    check (discount_type in ('fixed', 'percentage')),
  constraint coupons_recurring_duration_valid
    check (recurring_duration in ('forever', 'first_payment')),
  constraint coupons_minimum_cart_amount_nonnegative
    check (minimum_cart_amount is null or minimum_cart_amount >= 0),
  constraint coupons_archive_consistent check (
    (archived_at is null and archived_by_profile_id is null)
    or (archived_at is not null and archived_by_profile_id is not null and not is_active)
  )
);

create unique index coupons_code_unique_idx
on public.coupons (code);

create index coupons_active_updated_at_idx
on public.coupons (updated_at desc)
where archived_at is null and is_active;

create index coupons_created_by_profile_id_idx
on public.coupons (created_by_profile_id)
where created_by_profile_id is not null;

create index coupons_updated_by_profile_id_idx
on public.coupons (updated_by_profile_id)
where updated_by_profile_id is not null;

create index coupons_archived_by_profile_id_idx
on public.coupons (archived_by_profile_id)
where archived_by_profile_id is not null;

create trigger coupons_set_updated_at
before update on public.coupons
for each row
execute function private.set_updated_at();

create table public.coupon_discount_rules (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  discount_value numeric(12, 2) not null,
  applies_to_all boolean not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coupon_discount_rules_value_nonnegative
    check (discount_value >= 0),
  constraint coupon_discount_rules_sort_order_nonnegative
    check (sort_order >= 0),
  constraint coupon_discount_rules_coupon_sort_unique
    unique (coupon_id, sort_order)
);

create index coupon_discount_rules_coupon_id_idx
on public.coupon_discount_rules (coupon_id);

create trigger coupon_discount_rules_set_updated_at
before update on public.coupon_discount_rules
for each row
execute function private.set_updated_at();

create or replace function private.validate_coupon_discount_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  coupon_discount_type text;
begin
  select coupon.discount_type
  into coupon_discount_type
  from public.coupons as coupon
  where coupon.id = new.coupon_id;

  if coupon_discount_type = 'percentage'
    and (new.discount_value <= 0 or new.discount_value > 100)
  then
    raise exception 'percentage coupon discounts must be greater than 0 and at most 100'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger coupon_discount_rules_validate_value
before insert or update of coupon_id, discount_value
on public.coupon_discount_rules
for each row
execute function private.validate_coupon_discount_value();

create table public.coupon_discount_services (
  coupon_discount_rule_id uuid not null
    references public.coupon_discount_rules (id) on delete cascade,
  service_id uuid not null
    references public.services (id) on delete restrict,
  created_at timestamptz not null default now(),

  primary key (coupon_discount_rule_id, service_id)
);

create index coupon_discount_services_service_id_idx
on public.coupon_discount_services (service_id);

-- -----------------------------------------------------------------------------
-- Redemption ledger
--
-- A company is the customer when company context exists. Otherwise the client
-- profile is the customer. customer_scope_key is populated by a trigger only
-- for single-use coupons, allowing the database to enforce one redemption for
-- that customer without restricting repeat-use coupons.
-- -----------------------------------------------------------------------------

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete restrict,
  customer_profile_id uuid references public.profiles (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  customer_scope_key text,
  request_id uuid,
  currency text not null default 'USD',
  original_cart_subtotal numeric(12, 2) not null,
  eligible_subtotal numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null,
  resulting_cart_subtotal numeric(12, 2) not null,
  redeemed_at timestamptz not null default now(),

  constraint coupon_redemptions_customer_present check (
    customer_profile_id is not null or company_id is not null
  ),
  constraint coupon_redemptions_scope_key_format check (
    customer_scope_key is null
    or customer_scope_key ~ '^(company|profile):[0-9a-f-]{36}$'
  ),
  constraint coupon_redemptions_currency_iso_code
    check (currency ~ '^[A-Z]{3}$'),
  constraint coupon_redemptions_amounts_nonnegative check (
    original_cart_subtotal >= 0
    and eligible_subtotal >= 0
    and discount_amount >= 0
    and resulting_cart_subtotal >= 0
  ),
  constraint coupon_redemptions_eligible_within_cart
    check (eligible_subtotal <= original_cart_subtotal),
  constraint coupon_redemptions_discount_within_eligible
    check (discount_amount <= eligible_subtotal),
  constraint coupon_redemptions_result_consistent check (
    resulting_cart_subtotal = original_cart_subtotal - discount_amount
  )
);

create index coupon_redemptions_coupon_redeemed_at_idx
on public.coupon_redemptions (coupon_id, redeemed_at desc);

create index coupon_redemptions_customer_profile_id_idx
on public.coupon_redemptions (customer_profile_id)
where customer_profile_id is not null;

create index coupon_redemptions_company_id_idx
on public.coupon_redemptions (company_id)
where company_id is not null;

create unique index coupon_redemptions_single_use_customer_idx
on public.coupon_redemptions (coupon_id, customer_scope_key)
where customer_scope_key is not null;

create unique index coupon_redemptions_request_id_idx
on public.coupon_redemptions (coupon_id, request_id)
where request_id is not null;

-- -----------------------------------------------------------------------------
-- Structural enforcement
-- -----------------------------------------------------------------------------

create or replace function private.normalize_coupon_code(p_code text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select upper(btrim(p_code));
$$;

create or replace function private.require_active_coupon_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.services as service_row
    where service_row.id = new.service_id
      and service_row.is_active
      and service_row.archived_at is null
  ) then
    raise exception 'coupon discount service must be active'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger coupon_discount_services_require_active
before insert or update of service_id on public.coupon_discount_services
for each row
execute function private.require_active_coupon_service();

create or replace function private.enforce_coupon_discount_rule_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_rule_id uuid := case
    when tg_op = 'DELETE' then old.coupon_discount_rule_id
    when tg_table_name = 'coupon_discount_services' then new.coupon_discount_rule_id
    else new.id
  end;
  rule_row public.coupon_discount_rules;
begin
  select discount_rule.*
  into rule_row
  from public.coupon_discount_rules as discount_rule
  where discount_rule.id = target_rule_id;

  -- A cascaded delete has already removed the owning rule.
  if rule_row.id is null then
    return null;
  end if;

  if rule_row.applies_to_all and exists (
    select 1
    from public.coupon_discount_services as membership
    where membership.coupon_discount_rule_id = rule_row.id
  ) then
    raise exception 'all-services coupon rules cannot have service memberships'
      using errcode = '23514';
  end if;

  if not rule_row.applies_to_all and not exists (
    select 1
    from public.coupon_discount_services as membership
    join public.services as service_row
      on service_row.id = membership.service_id
     and service_row.is_active
     and service_row.archived_at is null
    where membership.coupon_discount_rule_id = rule_row.id
  ) then
    raise exception 'specific-service coupon rules require an active service'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger coupon_discount_rules_enforce_scope
after insert or update of applies_to_all on public.coupon_discount_rules
deferrable initially deferred
for each row
execute function private.enforce_coupon_discount_rule_scope();

create constraint trigger coupon_discount_services_enforce_scope
after insert or update or delete on public.coupon_discount_services
deferrable initially deferred
for each row
execute function private.enforce_coupon_discount_rule_scope();

create or replace function private.prepare_coupon_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  coupon_row public.coupons;
begin
  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.id = new.coupon_id;

  if coupon_row.id is null then
    raise no_data_found;
  end if;

  if new.customer_profile_id is not null and new.company_id is not null
    and not exists (
      select 1
      from public.profiles as profile_row
      where profile_row.id = new.customer_profile_id
        and profile_row.company_id = new.company_id
    )
  then
    raise exception 'coupon redemption profile and company do not match'
      using errcode = '23514';
  end if;

  if coupon_row.single_use_per_customer then
    new.customer_scope_key := case
      when new.company_id is not null
        then 'company:' || new.company_id::text
      else 'profile:' || new.customer_profile_id::text
    end;
  else
    new.customer_scope_key := null;
  end if;

  return new;
end;
$$;

create trigger coupon_redemptions_prepare
before insert or update of coupon_id, customer_profile_id, company_id
on public.coupon_redemptions
for each row
execute function private.prepare_coupon_redemption();

create or replace function private.prevent_coupon_redemption_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Preserve only the declared FK ON DELETE SET NULL actions. Financial and
  -- eligibility facts remain immutable after redemption.
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and (to_jsonb(new) - array['customer_profile_id', 'company_id'])
      = (to_jsonb(old) - array['customer_profile_id', 'company_id'])
    and (new.customer_profile_id is null or new.customer_profile_id = old.customer_profile_id)
    and (new.company_id is null or new.company_id = old.company_id)
  then
    return new;
  end if;

  raise exception 'coupon redemptions are append-only'
    using errcode = '55000';
end;
$$;

create trigger coupon_redemptions_prevent_mutation
before update or delete on public.coupon_redemptions
for each row
execute function private.prevent_coupon_redemption_mutation();

-- -----------------------------------------------------------------------------
-- Audit integration
-- -----------------------------------------------------------------------------

alter table public.activity_events
  drop constraint activity_events_entity_type_valid;

alter table public.activity_events
  add constraint activity_events_entity_type_valid check (
    entity_type in (
      'company',
      'client_contact',
      'service_folder',
      'service',
      'order',
      'order_task',
      'profile',
      'coupon'
    )
  );

create or replace function private.coupon_snapshot(p_coupon_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', coupon.id,
    'code', coupon.code,
    'description', coupon.description,
    'discount_type', coupon.discount_type,
    'recurring_duration', coupon.recurring_duration,
    'single_use_per_customer', coupon.single_use_per_customer,
    'new_customers_only', coupon.new_customers_only,
    'expires_at', coupon.expires_at,
    'minimum_cart_amount', coupon.minimum_cart_amount,
    'is_active', coupon.is_active,
    'archived_at', coupon.archived_at,
    'rules', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', discount_rule.id,
            'sort_order', discount_rule.sort_order,
            'discount_value', discount_rule.discount_value,
            'applies_to_all', discount_rule.applies_to_all,
            'service_ids', coalesce(
              (
                select jsonb_agg(membership.service_id order by membership.service_id)
                from public.coupon_discount_services as membership
                where membership.coupon_discount_rule_id = discount_rule.id
              ),
              '[]'::jsonb
            )
          )
          order by discount_rule.sort_order, discount_rule.id
        )
        from public.coupon_discount_rules as discount_rule
        where discount_rule.coupon_id = coupon.id
      ),
      '[]'::jsonb
    )
  )
  from public.coupons as coupon
  where coupon.id = p_coupon_id;
$$;

-- -----------------------------------------------------------------------------
-- Capability guard and payload/rule helpers
-- -----------------------------------------------------------------------------

create or replace function private.require_coupon_manager()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('coupons.manage');
  return actor_id;
end;
$$;

create or replace function private.validate_coupon_payload(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  minimum_amount numeric;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array[
      'code', 'description', 'discount_type', 'recurring_duration',
      'single_use_per_customer', 'new_customers_only', 'expires_at',
      'minimum_cart_amount', 'is_active', 'rules'
    ] <> '{}'::jsonb
    or not p_payload ?& array[
      'code', 'discount_type', 'recurring_duration',
      'single_use_per_customer', 'new_customers_only', 'is_active', 'rules'
    ]
    or jsonb_typeof(p_payload -> 'code') <> 'string'
    or jsonb_typeof(p_payload -> 'discount_type') <> 'string'
    or jsonb_typeof(p_payload -> 'recurring_duration') <> 'string'
    or jsonb_typeof(p_payload -> 'single_use_per_customer') <> 'boolean'
    or jsonb_typeof(p_payload -> 'new_customers_only') <> 'boolean'
    or jsonb_typeof(p_payload -> 'is_active') <> 'boolean'
    or jsonb_typeof(p_payload -> 'rules') <> 'array'
    or jsonb_array_length(p_payload -> 'rules') = 0
    or (p_payload ? 'description' and jsonb_typeof(p_payload -> 'description') not in ('string', 'null'))
    or (p_payload ? 'expires_at' and jsonb_typeof(p_payload -> 'expires_at') not in ('string', 'null'))
    or (p_payload ? 'minimum_cart_amount' and jsonb_typeof(p_payload -> 'minimum_cart_amount') not in ('number', 'null'))
  then
    raise exception 'invalid coupon payload'
      using errcode = '22023';
  end if;

  if private.normalize_coupon_code(p_payload ->> 'code') = ''
    or char_length(private.normalize_coupon_code(p_payload ->> 'code')) > 128
    or p_payload ->> 'discount_type' not in ('fixed', 'percentage')
    or p_payload ->> 'recurring_duration' not in ('forever', 'first_payment')
    or nullif(btrim(p_payload ->> 'description'), '') is distinct from (p_payload ->> 'description')
      and p_payload ->> 'description' is not null
  then
    raise exception 'invalid coupon payload'
      using errcode = '22023';
  end if;

  begin
    if p_payload ->> 'expires_at' is not null then
      perform (p_payload ->> 'expires_at')::timestamptz;
    end if;

    if p_payload ->> 'minimum_cart_amount' is not null then
      minimum_amount := (p_payload ->> 'minimum_cart_amount')::numeric;
      if minimum_amount < 0
        or minimum_amount <> round(minimum_amount, 2)
        or minimum_amount > 9999999999.99
      then
        raise exception 'invalid coupon minimum cart amount'
          using errcode = '22023';
      end if;
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'invalid coupon payload'
        using errcode = '22023';
  end;
end;
$$;

create or replace function private.replace_coupon_discount_rules(
  p_coupon_id uuid,
  p_discount_type text,
  p_rules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule_payload jsonb;
  rule_position bigint;
  applies_to_all boolean;
  discount_value numeric;
  service_ids jsonb;
  discount_rule_id uuid;
begin
  delete from public.coupon_discount_rules
  where coupon_id = p_coupon_id;

  for rule_payload, rule_position in
    select item.value, item.ordinality
    from jsonb_array_elements(p_rules) with ordinality as item(value, ordinality)
    order by item.ordinality
  loop
    if jsonb_typeof(rule_payload) <> 'object'
      or rule_payload - array['discount_value', 'applies_to_all', 'service_ids'] <> '{}'::jsonb
      or not rule_payload ?& array['discount_value', 'applies_to_all', 'service_ids']
      or jsonb_typeof(rule_payload -> 'discount_value') <> 'number'
      or jsonb_typeof(rule_payload -> 'applies_to_all') <> 'boolean'
      or jsonb_typeof(rule_payload -> 'service_ids') <> 'array'
    then
      raise exception 'invalid coupon discount rule'
        using errcode = '22023';
    end if;

    begin
      applies_to_all := (rule_payload ->> 'applies_to_all')::boolean;
      discount_value := (rule_payload ->> 'discount_value')::numeric;
      service_ids := rule_payload -> 'service_ids';
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'invalid coupon discount rule'
          using errcode = '22023';
    end;

    if discount_value <> round(discount_value, 2)
      or discount_value > 9999999999.99
      or (p_discount_type = 'fixed' and discount_value < 0)
      or (p_discount_type = 'percentage' and (discount_value <= 0 or discount_value > 100))
      or (applies_to_all and jsonb_array_length(service_ids) <> 0)
      or (not applies_to_all and jsonb_array_length(service_ids) = 0)
      or exists (
        select 1
        from jsonb_array_elements(service_ids) as service_id(value)
        where jsonb_typeof(service_id.value) <> 'string'
      )
      or (
        select count(*) <> count(distinct service_id.value)
        from jsonb_array_elements(service_ids) as service_id(value)
      )
    then
      raise exception 'invalid coupon discount rule'
        using errcode = '22023';
    end if;

    if not applies_to_all then
      begin
        if (
          select count(*)
          from public.services as service_row
          where service_row.id in (
            select (jsonb_array_elements_text(service_ids))::uuid
          )
            and service_row.is_active
            and service_row.archived_at is null
        ) <> jsonb_array_length(service_ids)
        then
          raise exception 'specific-service coupon rules require active Wolf Forge services'
            using errcode = '23514';
        end if;
      exception
        when invalid_text_representation then
          raise exception 'coupon service identifiers must be UUIDs'
            using errcode = '22023';
      end;
    end if;

    insert into public.coupon_discount_rules (
      coupon_id,
      discount_value,
      applies_to_all,
      sort_order
    )
    values (
      p_coupon_id,
      discount_value,
      applies_to_all,
      (rule_position - 1)::integer
    )
    returning id into discount_rule_id;

    if not applies_to_all then
      insert into public.coupon_discount_services (
        coupon_discount_rule_id,
        service_id
      )
      select
        discount_rule_id,
        service_id.value::uuid
      from jsonb_array_elements_text(service_ids) as service_id(value);
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin mutation RPCs
-- -----------------------------------------------------------------------------

create or replace function public.app_create_coupon(
  p_request_id uuid,
  p_payload jsonb
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_coupon_manager();
  existing_id uuid;
  coupon_row public.coupons;
begin
  if p_request_id is null then
    raise exception 'coupon request id is required'
      using errcode = '22023';
  end if;

  perform private.validate_coupon_payload(p_payload);

  existing_id := private.find_create_request(
    actor_id,
    'coupon.create',
    p_request_id,
    p_payload
  );

  if existing_id is not null then
    select coupon.*
    into coupon_row
    from public.coupons as coupon
    where coupon.id = existing_id;

    if coupon_row.id is null then raise no_data_found; end if;
    return coupon_row;
  end if;

  insert into public.coupons (
    code,
    description,
    discount_type,
    recurring_duration,
    single_use_per_customer,
    new_customers_only,
    expires_at,
    minimum_cart_amount,
    is_active,
    created_by_profile_id,
    updated_by_profile_id
  )
  values (
    private.normalize_coupon_code(p_payload ->> 'code'),
    p_payload ->> 'description',
    p_payload ->> 'discount_type',
    p_payload ->> 'recurring_duration',
    (p_payload ->> 'single_use_per_customer')::boolean,
    (p_payload ->> 'new_customers_only')::boolean,
    (p_payload ->> 'expires_at')::timestamptz,
    (p_payload ->> 'minimum_cart_amount')::numeric,
    (p_payload ->> 'is_active')::boolean,
    actor_id,
    actor_id
  )
  returning * into coupon_row;

  perform private.replace_coupon_discount_rules(
    coupon_row.id,
    coupon_row.discount_type,
    p_payload -> 'rules'
  );

  perform private.record_authenticated_activity(
    'coupon',
    coupon_row.id,
    'coupon.created',
    format('Created coupon %s.', coupon_row.code),
    jsonb_build_object('coupon', private.coupon_snapshot(coupon_row.id))
  );

  perform private.remember_create_request(
    actor_id,
    'coupon.create',
    p_request_id,
    p_payload,
    coupon_row.id
  );

  return coupon_row;
end;
$$;

create or replace function public.app_update_coupon(
  p_coupon_id uuid,
  p_payload jsonb
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_coupon_manager();
  before_snapshot jsonb;
  coupon_row public.coupons;
begin
  perform private.validate_coupon_payload(p_payload);

  select private.coupon_snapshot(coupon.id)
  into before_snapshot
  from public.coupons as coupon
  where coupon.id = p_coupon_id
    and coupon.archived_at is null
  for update of coupon;

  if before_snapshot is null then raise no_data_found; end if;

  update public.coupons
  set
    code = private.normalize_coupon_code(p_payload ->> 'code'),
    description = p_payload ->> 'description',
    discount_type = p_payload ->> 'discount_type',
    recurring_duration = p_payload ->> 'recurring_duration',
    single_use_per_customer = (p_payload ->> 'single_use_per_customer')::boolean,
    new_customers_only = (p_payload ->> 'new_customers_only')::boolean,
    expires_at = (p_payload ->> 'expires_at')::timestamptz,
    minimum_cart_amount = (p_payload ->> 'minimum_cart_amount')::numeric,
    is_active = (p_payload ->> 'is_active')::boolean,
    updated_by_profile_id = actor_id
  where id = p_coupon_id
  returning * into coupon_row;

  perform private.replace_coupon_discount_rules(
    coupon_row.id,
    coupon_row.discount_type,
    p_payload -> 'rules'
  );

  perform private.record_authenticated_activity(
    'coupon',
    coupon_row.id,
    'coupon.updated',
    format('Updated coupon %s.', coupon_row.code),
    jsonb_build_object(
      'before', before_snapshot,
      'after', private.coupon_snapshot(coupon_row.id)
    )
  );

  return coupon_row;
end;
$$;

create or replace function public.app_archive_coupon(p_coupon_id uuid)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_coupon_manager();
  coupon_row public.coupons;
begin
  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.id = p_coupon_id
  for update;

  if coupon_row.id is null then raise no_data_found; end if;
  if coupon_row.archived_at is not null then return coupon_row; end if;

  update public.coupons
  set
    is_active = false,
    archived_at = now(),
    archived_by_profile_id = actor_id,
    updated_by_profile_id = actor_id
  where id = p_coupon_id
  returning * into coupon_row;

  perform private.record_authenticated_activity(
    'coupon',
    coupon_row.id,
    'coupon.archived',
    format('Archived coupon %s.', coupon_row.code),
    jsonb_build_object('coupon', private.coupon_snapshot(coupon_row.id))
  );

  return coupon_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Side-effect-free validation and calculation boundary
--
-- Cart items are an array of:
--   {service_id, quantity, unit_amount, billing_context?}
-- billing_context is one_time (default), initial, or renewal. The supplied
-- cart subtotal must equal the sum of quantity * unit_amount. Minimum-cart
-- eligibility is evaluated against that pre-discount subtotal.
--
-- Each line uses the first applicable rule by sort_order. Percentage values
-- round per line. A fixed value applies once per matched rule per cart. The
-- total is always clamped to the eligible subtotal.
-- -----------------------------------------------------------------------------

create or replace function private.calculate_coupon(
  p_code text,
  p_cart_items jsonb,
  p_cart_subtotal numeric,
  p_customer_profile_id uuid default null,
  p_customer_company_id uuid default null,
  p_is_new_customer boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  coupon_row public.coupons;
  cart_item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  service_id uuid;
  quantity numeric;
  unit_amount numeric;
  line_subtotal numeric;
  computed_subtotal numeric := 0;
  billing_context text;
  calculated_customer_scope_key text;
  eligible_subtotal numeric := 0;
  discount_amount numeric := 0;
begin
  if p_code is null or private.normalize_coupon_code(p_code) = '' then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CODE');
  end if;

  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.code = private.normalize_coupon_code(p_code);

  if coupon_row.id is null then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CODE');
  end if;

  if coupon_row.archived_at is not null then
    return jsonb_build_object('valid', false, 'failure_code', 'ARCHIVED');
  end if;

  if not coupon_row.is_active then
    return jsonb_build_object('valid', false, 'failure_code', 'INACTIVE');
  end if;

  if coupon_row.expires_at is not null and now() >= coupon_row.expires_at then
    return jsonb_build_object('valid', false, 'failure_code', 'EXPIRED');
  end if;

  if p_customer_profile_id is not null and not exists (
    select 1
    from public.profiles as profile_row
    where profile_row.id = p_customer_profile_id
      and profile_row.archived_at is null
  ) then
    return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_INELIGIBLE');
  end if;

  if p_customer_company_id is not null and not exists (
    select 1
    from public.companies as company_row
    where company_row.id = p_customer_company_id
      and company_row.archived_at is null
  ) then
    return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_INELIGIBLE');
  end if;

  if p_customer_profile_id is not null and p_customer_company_id is not null
    and not exists (
      select 1
      from public.profiles as profile_row
      where profile_row.id = p_customer_profile_id
        and profile_row.company_id = p_customer_company_id
    )
  then
    return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_INELIGIBLE');
  end if;

  calculated_customer_scope_key := case
    when p_customer_company_id is not null
      then 'company:' || p_customer_company_id::text
    when p_customer_profile_id is not null
      then 'profile:' || p_customer_profile_id::text
    else null
  end;

  if coupon_row.single_use_per_customer then
    if calculated_customer_scope_key is null then
      return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_CONTEXT_REQUIRED');
    end if;

    if exists (
      select 1
      from public.coupon_redemptions as redemption
      where redemption.coupon_id = coupon_row.id
        and redemption.customer_scope_key = calculated_customer_scope_key
    ) then
      return jsonb_build_object('valid', false, 'failure_code', 'ALREADY_REDEEMED');
    end if;
  end if;

  if coupon_row.new_customers_only then
    if p_is_new_customer is null then
      return jsonb_build_object(
        'valid', false,
        'failure_code', 'NEW_CUSTOMER_DETERMINATION_DEFERRED'
      );
    elsif not p_is_new_customer then
      return jsonb_build_object('valid', false, 'failure_code', 'NOT_NEW_CUSTOMER');
    end if;
  end if;

  if p_cart_items is null
    or jsonb_typeof(p_cart_items) <> 'array'
    or jsonb_array_length(p_cart_items) = 0
    or p_cart_subtotal is null
    or p_cart_subtotal < 0
    or p_cart_subtotal <> round(p_cart_subtotal, 2)
    or p_cart_subtotal > 9999999999.99
  then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
  end if;

  for cart_item in select value from jsonb_array_elements(p_cart_items)
  loop
    if jsonb_typeof(cart_item) <> 'object'
      or cart_item - array['service_id', 'quantity', 'unit_amount', 'billing_context'] <> '{}'::jsonb
      or not cart_item ?& array['service_id', 'quantity', 'unit_amount']
      or jsonb_typeof(cart_item -> 'service_id') <> 'string'
      or jsonb_typeof(cart_item -> 'quantity') <> 'number'
      or jsonb_typeof(cart_item -> 'unit_amount') <> 'number'
      or (cart_item ? 'billing_context' and jsonb_typeof(cart_item -> 'billing_context') <> 'string')
    then
      return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end if;

    begin
      service_id := (cart_item ->> 'service_id')::uuid;
      quantity := (cart_item ->> 'quantity')::numeric;
      unit_amount := (cart_item ->> 'unit_amount')::numeric;
      billing_context := coalesce(cart_item ->> 'billing_context', 'one_time');
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end;

    if quantity <= 0
      or quantity <> trunc(quantity)
      or unit_amount < 0
      or unit_amount <> round(unit_amount, 2)
      or unit_amount > 9999999999.99
      or billing_context not in ('one_time', 'initial', 'renewal')
    then
      return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end if;

    line_subtotal := round(quantity * unit_amount, 2);
    if line_subtotal > 9999999999.99 then
      return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end if;

    computed_subtotal := computed_subtotal + line_subtotal;
    normalized_items := normalized_items || jsonb_build_array(
      jsonb_build_object(
        'service_id', service_id,
        'line_subtotal', line_subtotal,
        'billing_context', billing_context
      )
    );
  end loop;

  if computed_subtotal <> p_cart_subtotal then
    return jsonb_build_object('valid', false, 'failure_code', 'CART_SUBTOTAL_MISMATCH');
  end if;

  if coupon_row.minimum_cart_amount is not null
    and p_cart_subtotal < coupon_row.minimum_cart_amount
  then
    return jsonb_build_object('valid', false, 'failure_code', 'MINIMUM_CART_NOT_MET');
  end if;

  with cart_lines as (
    select
      (item.value ->> 'service_id')::uuid as service_id,
      (item.value ->> 'line_subtotal')::numeric as line_subtotal,
      item.value ->> 'billing_context' as billing_context
    from jsonb_array_elements(normalized_items) as item(value)
  ),
  matched_lines as (
    select
      cart_line.line_subtotal,
      matched_rule.id as rule_id,
      matched_rule.discount_value
    from cart_lines as cart_line
    join public.services as service_row
      on service_row.id = cart_line.service_id
     and service_row.is_active
     and service_row.archived_at is null
    left join lateral (
      select discount_rule.id, discount_rule.discount_value
      from public.coupon_discount_rules as discount_rule
      where discount_rule.coupon_id = coupon_row.id
        and (
          discount_rule.applies_to_all
          or exists (
            select 1
            from public.coupon_discount_services as membership
            where membership.coupon_discount_rule_id = discount_rule.id
              and membership.service_id = cart_line.service_id
          )
        )
      order by discount_rule.sort_order, discount_rule.id
      limit 1
    ) as matched_rule on true
    where not (
      coupon_row.recurring_duration = 'first_payment'
      and cart_line.billing_context = 'renewal'
    )
  ),
  per_rule as (
    select
      matched_line.rule_id,
      matched_line.discount_value,
      sum(matched_line.line_subtotal) as rule_eligible_subtotal,
      sum(round(matched_line.line_subtotal * matched_line.discount_value / 100, 2))
        as percentage_discount
    from matched_lines as matched_line
    where matched_line.rule_id is not null
    group by matched_line.rule_id, matched_line.discount_value
  )
  select
    coalesce(sum(per_rule.rule_eligible_subtotal), 0),
    coalesce(sum(
      case coupon_row.discount_type
        when 'percentage' then per_rule.percentage_discount
        else least(per_rule.discount_value, per_rule.rule_eligible_subtotal)
      end
    ), 0)
  into eligible_subtotal, discount_amount
  from per_rule;

  if eligible_subtotal = 0 then
    return jsonb_build_object(
      'valid', false,
      'failure_code', 'NOT_APPLICABLE',
      'coupon_id', coupon_row.id,
      'eligible_subtotal', 0,
      'discount_amount', 0,
      'resulting_subtotal', p_cart_subtotal
    );
  end if;

  if coupon_row.discount_type = 'percentage' and exists (
    select 1
    from public.coupon_discount_rules as discount_rule
    where discount_rule.coupon_id = coupon_row.id
      and (discount_rule.discount_value <= 0 or discount_rule.discount_value > 100)
  ) then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_DISCOUNT');
  end if;

  discount_amount := least(round(discount_amount, 2), eligible_subtotal);

  return jsonb_build_object(
    'valid', true,
    'failure_code', null,
    'coupon_id', coupon_row.id,
    'discount_type', coupon_row.discount_type,
    'recurring_duration', coupon_row.recurring_duration,
    'eligible_subtotal', eligible_subtotal,
    'discount_amount', discount_amount,
    'resulting_subtotal', p_cart_subtotal - discount_amount
  );
end;
$$;

create or replace function public.app_validate_coupon(
  p_code text,
  p_cart_items jsonb,
  p_cart_subtotal numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  customer_profile_id uuid;
  customer_company_id uuid;
begin
  select profile_row.id, profile_row.company_id
  into customer_profile_id, customer_company_id
  from public.profiles as profile_row
  where profile_row.id = actor_id
    and profile_row.archived_at is null;

  if customer_profile_id is null then
    raise exception 'active authentication is required'
      using errcode = '42501';
  end if;

  -- The current operational orders table does not prove paid commerce history.
  -- Therefore no caller-supplied "new customer" assertion is accepted here.
  return private.calculate_coupon(
    p_code,
    p_cart_items,
    p_cart_subtotal,
    customer_profile_id,
    customer_company_id,
    null
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS and least privilege
-- -----------------------------------------------------------------------------

alter table public.coupons enable row level security;
alter table public.coupon_discount_rules enable row level security;
alter table public.coupon_discount_services enable row level security;
alter table public.coupon_redemptions enable row level security;

create policy coupons_authorized_internal_select
on public.coupons
for select
to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('coupons.view')
    or public.app_has_permission('coupons.manage')
  )
);

create policy coupon_discount_rules_authorized_internal_select
on public.coupon_discount_rules
for select
to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('coupons.view')
    or public.app_has_permission('coupons.manage')
  )
);

create policy coupon_discount_services_authorized_internal_select
on public.coupon_discount_services
for select
to authenticated
using (
  (select private.is_internal_user())
  and (
    public.app_has_permission('coupons.view')
    or public.app_has_permission('coupons.manage')
  )
);

create policy coupon_redemptions_authorized_internal_select
on public.coupon_redemptions
for select
to authenticated
using (
  (select private.is_internal_user())
  and public.app_has_permission('coupons.manage')
);

drop policy if exists activity_events_internal_scoped_select
on public.activity_events;

create policy activity_events_internal_scoped_select
on public.activity_events
for select
to authenticated
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
    or (
      entity_type = 'order'
      and (select private.can_access_operational_order(entity_id))
    )
    or (
      entity_type = 'order_task'
      and (select private.can_access_operational_task(entity_id))
    )
  )
);

revoke all on table
  public.coupons,
  public.coupon_discount_rules,
  public.coupon_discount_services,
  public.coupon_redemptions
from public, anon, authenticated, service_role;

grant select on table
  public.coupons,
  public.coupon_discount_rules,
  public.coupon_discount_services,
  public.coupon_redemptions
to authenticated;

revoke all on function private.normalize_coupon_code(text)
from public, anon, authenticated, service_role;
revoke all on function private.require_active_coupon_service()
from public, anon, authenticated, service_role;
revoke all on function private.validate_coupon_discount_value()
from public, anon, authenticated, service_role;
revoke all on function private.enforce_coupon_discount_rule_scope()
from public, anon, authenticated, service_role;
revoke all on function private.prepare_coupon_redemption()
from public, anon, authenticated, service_role;
revoke all on function private.prevent_coupon_redemption_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.coupon_snapshot(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.require_coupon_manager()
from public, anon, authenticated, service_role;
revoke all on function private.validate_coupon_payload(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.replace_coupon_discount_rules(uuid, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.calculate_coupon(text, jsonb, numeric, uuid, uuid, boolean)
from public, anon, authenticated, service_role;

revoke all on function public.app_create_coupon(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.app_update_coupon(uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.app_archive_coupon(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.app_validate_coupon(text, jsonb, numeric)
from public, anon, authenticated, service_role;

grant execute on function public.app_create_coupon(uuid, jsonb)
to authenticated;
grant execute on function public.app_update_coupon(uuid, jsonb)
to authenticated;
grant execute on function public.app_archive_coupon(uuid)
to authenticated;
grant execute on function public.app_validate_coupon(text, jsonb, numeric)
to authenticated;

comment on column public.coupons.code is
  'Canonical coupon code: surrounding whitespace is trimmed and letters are stored uppercase. Matching and uniqueness are case-insensitive through the same normalization.';

comment on column public.coupon_discount_rules.applies_to_all is
  'Explicit fail-closed applicability. True requires zero service memberships; false requires one or more active Wolf Forge services.';

comment on function private.calculate_coupon(text, jsonb, numeric, uuid, uuid, boolean) is
  'Side-effect-free coupon validation/calculation boundary for trusted future Store RPCs. Cart money must come from authoritative backend pricing before redemption.';

comment on function public.app_validate_coupon(text, jsonb, numeric) is
  'Authenticated preview calculator. Derives customer identity from auth.uid() and deliberately defers new-customer-only coupons until paid commerce history exists.';

comment on table public.coupon_redemptions is
  'Append-only coupon redemption source of truth. No API role may write directly; future checkout must insert through a transactional, revalidating RPC.';
