-- WL-2.12 (KI-111 coupon portion + KI-109 coupon remainder): coupon
-- administration, code lookup, quoting and redemption are Tenant-bound.
--
-- Concrete leaks closed (verified live by the WL-2.9 / WL-2.10 / WL-2.11
-- reviews and re-probed here):
--   - app_archive_coupon (HIGH) archived any Tenant's coupon by id, writing
--     the activity event into the victim Tenant; app_update_coupon rewrote
--     any coupon by id; app_create_coupon replay lookups could return
--     another Tenant's coupon.
--   - private.calculate_coupon looked codes up globally, so any caller could
--     probe whether another Tenant's code exists and what it discounts
--     (validate, store quote, invoice quote and the purchase/payment coupon
--     paths all funnel through it).
--   - Coupon and redemption RLS (and the discount rule / service child
--     tables) listed every Tenant's rows to an internal with coupons.view /
--     coupons.manage.
--   - KI-109 coupon remainder: the profile/company consistency checks in
--     calculate_coupon and prepare_coupon_redemption compared the global
--     profiles.company_id, so a Tenant B client's redemption could never
--     match; tenant_memberships now decides.
--
-- Pattern (D-272): tenant_id = (select private.current_tenant_id()) on every
-- lookup of a caller-supplied id, and the code lookup constrains the current
-- Tenant, so a foreign code behaves exactly like a nonexistent one
-- (INVALID_CODE, identical jsonb). The redemption triggers compare the
-- redemption's own tenant_id (the caller's resolved Tenant at trigger time;
-- the WL-1C.7 composite FK that pins it to the coupon is enforced after the
-- trigger, and a mismatch aborts with 23503) against tenant_memberships.
--
-- Not changed (verified, out of scope):
--   - Coupon code uniqueness stays GLOBAL: the live unique index
--     coupons_code_unique_idx (20260813110000) makes codes unique across all
--     Tenants. Changing it to (tenant_id, code) is a product decision (the
--     WL-2.12 mission defers it explicitly), so this migration leaves it in
--     place. Residual, recorded as KI-116: app_create_coupon /
--     app_update_coupon raise 23505 when a code exists in ANOTHER Tenant,
--     which lets a coupons.manage caller infer a foreign code's existence.
--     The quote / validate / redemption paths are fully Tenant-bound and
--     leak nothing.
--   - coupon_redemptions already carries full composite Tenant integrity
--     (coupon, company, customer membership); no constraint duplicated.
--   - replace_coupon_discount_rules / require_coupon_discount_service_tenant
--     already bind rule services to the coupon's Tenant; validate/counting
--     semantics untouched.
--   - Wallet / invoice authorization (WL-2.10 / WL-2.11) untouched; the
--     redemption limits stay Tenant-relative (per-coupon, per-company
--     scope keys) because coupons are Tenant-owned rows.
--   - Dashboard, subscriptions, notifications, forms untouched.

-- -----------------------------------------------------------------------------
-- Coupon administration
-- -----------------------------------------------------------------------------

create or replace function public.app_archive_coupon(p_coupon_id uuid)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_coupon_manager();
  coupon_row public.coupons;
begin
  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.id = p_coupon_id
    and coupon.tenant_id = (select private.current_tenant_id())
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
    and tenant_id = (select private.current_tenant_id())
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
$function$;

create or replace function public.app_update_coupon(p_coupon_id uuid, p_payload jsonb)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
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
    and coupon.tenant_id = (select private.current_tenant_id())
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
    and tenant_id = (select private.current_tenant_id())
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
$function$;

create or replace function public.app_create_coupon(p_request_id uuid, p_payload jsonb)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
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
    where coupon.id = existing_id
      and coupon.tenant_id = (select private.current_tenant_id());

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
$function$;

-- -----------------------------------------------------------------------------
-- Code lookup: the current Tenant decides which codes exist
-- -----------------------------------------------------------------------------

create or replace function private.calculate_coupon(p_code text, p_cart_items jsonb, p_cart_subtotal numeric, p_customer_profile_id uuid default null::uuid, p_customer_company_id uuid default null::uuid, p_is_new_customer boolean default null::boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
  where coupon.code = private.normalize_coupon_code(p_code)
    and coupon.tenant_id = (select private.current_tenant_id());

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
      from public.tenant_memberships as membership_row
      where membership_row.tenant_id = (select private.current_tenant_id())
        and membership_row.profile_id = p_customer_profile_id
        and membership_row.company_id = p_customer_company_id
        and membership_row.archived_at is null
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
$function$;

-- -----------------------------------------------------------------------------
-- Validation entry point: the customer company comes from the current-Tenant
-- membership, and the code lookup above is Tenant-bound.
-- -----------------------------------------------------------------------------

create or replace function public.app_validate_coupon(p_code text, p_cart_items jsonb, p_cart_subtotal numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$

declare
  actor_id uuid := (select auth.uid());
  customer_profile_id uuid;
  customer_company_id uuid;
begin
  select profile_row.id
  into customer_profile_id
  from public.profiles as profile_row
  where profile_row.id = actor_id
    and profile_row.archived_at is null;

  if customer_profile_id is null then
    raise exception 'active authentication is required'
      using errcode = '42501';
  end if;

  customer_company_id := (select private.current_user_company_id());

  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

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
$function$;

-- -----------------------------------------------------------------------------
-- Redemption consistency: the customer pair must be a membership of the
-- redemption's own Tenant (pinned to the coupon by the composite FK).
-- -----------------------------------------------------------------------------

create or replace function private.prepare_coupon_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
      from public.tenant_memberships as membership_row
      where membership_row.tenant_id = new.tenant_id
        and membership_row.profile_id = new.customer_profile_id
        and membership_row.company_id = new.company_id
        and membership_row.archived_at is null
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
$function$;

-- -----------------------------------------------------------------------------
-- RLS: coupon administration, redemption history and the discount children
-- -----------------------------------------------------------------------------

alter policy coupons_authorized_internal_select on public.coupons
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and (public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage')));

alter policy coupon_redemptions_authorized_internal_select on public.coupon_redemptions
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and public.app_has_permission('coupons.manage'));

alter policy coupon_discount_rules_authorized_internal_select on public.coupon_discount_rules
  using ((select private.is_internal_user())
    and (public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage'))
    and exists (
      select 1
      from public.coupons as coupon_row
      where coupon_row.id = coupon_discount_rules.coupon_id
        and coupon_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy coupon_discount_services_authorized_internal_select on public.coupon_discount_services
  using ((select private.is_internal_user())
    and (public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage'))
    and exists (
      select 1
      from public.coupon_discount_rules as rule_row
      join public.coupons as coupon_row
        on coupon_row.id = rule_row.coupon_id
      where rule_row.id = coupon_discount_services.coupon_discount_rule_id
        and coupon_row.tenant_id = (select private.current_tenant_id())
    ));
