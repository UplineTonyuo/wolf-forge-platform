-- Recheck the original exact authority after Tenant, request-key and parent-row waits.
-- Publication and financial replay ordering and stored economics stay unchanged.
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
  perform private.require_coupon_write(private.current_tenant_id());
  actor_id := private.require_coupon_manager();
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
  actor_id := private.require_coupon_manager();

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
  perform private.require_coupon_write(private.current_tenant_id());
  actor_id := private.require_coupon_manager();
  perform private.validate_coupon_payload(p_payload);

  select private.coupon_snapshot(coupon.id)
  into before_snapshot
  from public.coupons as coupon
  where coupon.id = p_coupon_id
    and coupon.tenant_id = (select private.current_tenant_id())
    and coupon.archived_at is null
  for update of coupon;
  actor_id := private.require_coupon_manager();

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
  perform private.require_coupon_write(private.current_tenant_id());
  actor_id := private.require_coupon_manager();
  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.id = p_coupon_id
    and coupon.tenant_id = (select private.current_tenant_id())
  for update;
  actor_id := private.require_coupon_manager();

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

CREATE OR REPLACE FUNCTION public.app_update_subscription_terms(p_request_id uuid, p_subscription_id uuid, p_payload jsonb)
 RETURNS subscription_plan_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  actor_id := private.require_subscription_capability('subscriptions.manage');
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
  actor_id := private.require_subscription_capability('subscriptions.manage');
  if existing_id is not null then
    select plan.* into plan_row
    from public.subscription_plan_versions as plan
    join public.subscriptions as subscription on subscription.id = plan.subscription_id
    where plan.id = existing_id
      and subscription.tenant_id = (select private.current_tenant_id());
    if plan_row.id is null then raise no_data_found; end if;
    if not private.can_read_subscription(plan_row.subscription_id) then raise exception 'Subscription access is denied' using errcode='42501'; end if;
    return plan_row;
  end if;
  perform private.require_subscription_write(private.current_tenant_id());


  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  actor_id := private.require_subscription_capability('subscriptions.manage');
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
$function$;

CREATE OR REPLACE FUNCTION private.validate_tenant_module_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  tenant_status text;
  last_revision integer;
begin
  if tg_op <> 'INSERT' then
    raise exception 'published module history is immutable' using errcode = '55000';
  end if;
  perform private.require_platform_admin();
  actor_id := auth.uid();
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  select status into tenant_status from public.tenants where id = new.tenant_id for update;
  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
  perform private.require_platform_admin();
  actor_id := auth.uid();
  if tenant_status <> 'active' then
    raise exception 'Tenant is not active' using errcode = '55000';
  end if;
  if not private.published_module_set_valid(new.module_keys) then
    raise exception 'invalid or unsupported published module set' using errcode = '22023';
  end if;
  perform private.require_invoice_publication_clear(new.tenant_id,new.module_keys);
  if not ('subscriptions' = any(new.module_keys)) and exists (select 1 from public.subscriptions where tenant_id=new.tenant_id and status<>'canceled') then
    raise exception 'uncanceled Subscriptions prevent disablement' using errcode='55000';
  end if;
  if not ('tickets' = any(new.module_keys)) and exists (
    select 1 from public.tickets where tenant_id=new.tenant_id
      and archived_at is null and status<>'closed'
  ) then
    raise exception 'unclosed Tickets prevent disablement' using errcode='55000';
  end if;
  if not ('projects' = any(new.module_keys)) and exists (
    select 1 from public.orders as project
    where project.tenant_id = new.tenant_id and project.archived_at is null
      and project.status not in ('complete', 'canceled')
  ) then
    raise exception 'unfinished Projects prevent disablement' using errcode = '55000';
  end if;
  select coalesce(max(revision), 0) into last_revision
  from private.tenant_module_publications where tenant_id = new.tenant_id;
  if new.revision is distinct from last_revision + 1 then
    raise exception 'published revision conflict' using errcode = 'WF409';
  end if;
  new.published_by := actor_id;
  new.published_at := now();
  new.reason := btrim(new.reason);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.publish_tenant_modules(p_tenant_id uuid, p_expected_revision integer, p_module_keys text[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  tenant_status text;
  last_revision integer;
begin
  perform private.require_platform_admin();
  actor_id := auth.uid();
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  select status into tenant_status from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
  perform private.require_platform_admin();
  actor_id := auth.uid();
  if tenant_status <> 'active' then
    raise exception 'Tenant is not active' using errcode = '55000';
  end if;
  select coalesce(max(revision), 0) into last_revision
  from private.tenant_module_publications where tenant_id = p_tenant_id;
  if p_expected_revision is null or p_expected_revision <> last_revision then
    raise exception 'published revision conflict' using errcode = 'WF409';
  end if;
  if not private.published_module_set_valid(p_module_keys) then
    raise exception 'invalid or unsupported published module set' using errcode = '22023';
  end if;
  perform private.require_invoice_publication_clear(p_tenant_id,p_module_keys);
  if not ('subscriptions' = any(p_module_keys)) and exists (select 1 from public.subscriptions where tenant_id=p_tenant_id and status<>'canceled') then
    raise exception 'uncanceled Subscriptions prevent disablement' using errcode='55000';
  end if;
  if not ('tickets' = any(p_module_keys)) and exists (
    select 1 from public.tickets where tenant_id=p_tenant_id
      and archived_at is null and status<>'closed'
  ) then
    raise exception 'unclosed Tickets prevent disablement' using errcode='55000';
  end if;
  if not ('projects' = any(p_module_keys)) and exists (
    select 1 from public.orders as project
    where project.tenant_id = p_tenant_id and project.archived_at is null
      and project.status not in ('complete', 'canceled')
  ) then
    raise exception 'unfinished Projects prevent disablement' using errcode = '55000';
  end if;
  insert into private.tenant_module_publications
    (tenant_id, revision, module_keys, published_by, reason)
  values (p_tenant_id, last_revision + 1, p_module_keys, actor_id, p_reason);
  return last_revision + 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_purchase_service_with_balance(p_request_id uuid, p_service_id uuid, p_coupon_code text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, order_number bigint, ticket_id uuid, ticket_public_ref text, invoice_id uuid, invoice_number bigint, payment_id uuid, amount_cents bigint, currency text, wallet_balance_cents bigint, service_name text, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  request_payload jsonb;
  existing_id uuid;
  service_row public.services;
  wallet_row public.company_wallets;
  invoice_row public.invoices;
  invoice_item_id uuid;
  payment_row public.invoice_payments;
  order_row public.orders;
  company_name text;
  price_cents bigint;
  coupon_application record;
  coupon_discount_cents bigint := 0;
  coupon_redemption_id uuid;
  final_price_cents bigint;
begin
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_service_id is null then
    raise exception 'WF_PURCHASE_INVALID_REQUEST' using errcode = '22023';
  end if;

  actor_company_id := (select private.current_user_company_id());

  if actor_company_id is null then
    raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform private.require_permission('invoices.view');

  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode='42501'; end if;
  request_payload := jsonb_build_object(
    'service_id', p_service_id,
    'coupon_code', nullif(btrim(p_coupon_code), '')
  );

  existing_id := private.find_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload
  );
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode='42501'; end if;

  if existing_id is not null then
    select * into order_row
    from public.orders
    where id = existing_id
      and company_id = actor_company_id
      and tenant_id = private.current_tenant_id();
    if order_row.id is null then raise no_data_found; end if;

    select item.invoice_id into invoice_id
    from public.invoice_items as item
    where item.order_id = order_row.id
    limit 1;

    select * into invoice_row from public.invoices where id = invoice_id;
    if not private.can_read_invoice(invoice_row.id) or invoice_row.company_id<>actor_company_id then raise exception 'Invoice replay is unavailable' using errcode='42501'; end if;

    select * into payment_row
    from public.invoice_payments as payment
    where payment.invoice_id = invoice_row.id
      and payment.status = 'succeeded'
    order by payment.created_at
    limit 1;

    select * into wallet_row
    from public.company_wallets as wallet
    where wallet.company_id = actor_company_id;

    select service.name into service_name
    from public.services as service
    where service.id = order_row.service_id;

    return query
    select
      case when private.invoice_project_visible(order_row.id) then order_row.id else null::uuid end,
      case when private.invoice_project_visible(order_row.id) then order_row.order_number else null::bigint end,
      null::uuid,
      null::text,
      invoice_row.id,
      invoice_row.invoice_number,
      payment_row.id,
      payment_row.amount_cents,
      invoice_row.currency,
      wallet_row.balance_cents,
      service_name,
      true;
    return;
  end if;

  if nullif(btrim(p_coupon_code),'') is not null then perform private.require_coupon_write(private.current_tenant_id()); end if;
  perform private.require_invoice_write(private.current_tenant_id());

  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = private.current_tenant_id() for update;
  if not private.tenant_module_allowed(private.current_tenant_id(), 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;
  perform private.consume_rate_limit(
    'store.purchase.client.hour', actor_id::text, interval '1 hour', 10
  );
  perform private.consume_rate_limit(
    'store.purchase.client.day', actor_id::text, interval '1 day', 40
  );

  select * into service_row
  from public.services as service
  where service.id = p_service_id
    and service.tenant_id = (select private.current_tenant_id())
    and service.archived_at is null
    and service.is_active
    and service.is_public;

  if service_row.id is null then
    raise exception 'WF_PURCHASE_SERVICE_UNAVAILABLE' using errcode = '42501';
  end if;

  if service_row.recurring then
    raise exception 'WF_PURCHASE_RECURRING_UNSUPPORTED' using errcode = 'P0001';
  end if;

  price_cents := round(service_row.price * 100)::bigint;

  if price_cents is null or price_cents <= 0 then
    raise exception 'WF_PURCHASE_SERVICE_NOT_PRICED' using errcode = 'P0001';
  end if;

  -- Coupon: re-resolved here, never trusted from the browser. A coupon that is
  -- invalid at purchase time fails the whole purchase - it is never silently
  -- dropped in favour of the full price.
  if nullif(btrim(p_coupon_code), '') is not null then
    select * into coupon_application
    from private.resolve_coupon_application(
      p_coupon_code,
      jsonb_build_array(jsonb_build_object(
        'service_id', service_row.id,
        'quantity', 1,
        'unit_amount', service_row.price,
        'billing_context', 'one_time'
      )),
      service_row.price,
      actor_id,
      actor_company_id,
      price_cents
    );

    if not coupon_application.valid then
      if coupon_application.failure_code = 'ALREADY_REDEEMED' then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
      end if;
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    coupon_discount_cents := coupon_application.discount_cents;
  end if;

  final_price_cents := price_cents - coupon_discount_cents;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode='42501'; end if;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> service_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < final_price_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  -- Redemption is written only now, after the balance check, inside the same
  -- transaction as the purchase: a failed purchase rolls it back, and a replay
  -- returns above without reaching here.
  if coupon_discount_cents > 0 then
    begin
      insert into public.coupon_redemptions (
        coupon_id, customer_profile_id, company_id, request_id, currency,
        original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal
      ) values (
        coupon_application.coupon_id, actor_id, actor_company_id, p_request_id,
        service_row.currency,
        coupon_application.original_cart_subtotal,
        coupon_application.eligible_subtotal,
        coupon_application.discount_amount,
        coupon_application.resulting_cart_subtotal
      ) returning id into coupon_redemption_id;
    exception
      when unique_violation then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
    end;
  end if;

  select company_row.name into company_name
  from public.companies as company_row
  where company_row.id = actor_company_id;

  insert into public.invoices (
    company_id, client_profile_id, status, currency,
    billing_reason, due_at,
    subtotal_cents, discount_total_cents, tax_total_cents, total_cents,
    created_by_profile_id, updated_by_profile_id
  ) values (
    actor_company_id, actor_id, 'draft', service_row.currency,
    'store_purchase', now(),
    price_cents, coupon_discount_cents, 0, final_price_cents,
    actor_id, actor_id
  ) returning * into invoice_row;

  insert into public.invoice_items (
    invoice_id, service_id, order_id, position, name, description,
    quantity, unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status
  ) values (
    invoice_row.id, service_row.id, null, 0, service_row.name, null,
    1, price_cents, coupon_discount_cents, false, 'awaiting_payment'
  ) returning id into invoice_item_id;

  perform set_config('app.wf_store_purchase_order', 'on', true);

  update public.invoices
  set status = 'unpaid',
      invoice_number = private.next_invoice_number(),
      issued_at = now(),
      updated_by_profile_id = actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    invoice_row.id,
    final_price_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  select * into invoice_row from public.invoices where id = invoice_row.id;

  if invoice_row.status <> 'paid' then
    raise exception 'WF_PURCHASE_NOT_SETTLED' using errcode = 'P0001';
  end if;

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - final_price_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents, balance_after_cents,
    currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -final_price_cents, wallet_row.balance_cents,
    wallet_row.currency, 'invoice_payment',
    left('Store purchase - ' || service_row.name, 240),
    invoice_row.id, payment_row.id
  );

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  perform set_config('app.wf_store_purchase_payment_id', payment_row.id::text, true);

  insert into public.orders (
    company_id, service_id, assigned_to_profile_id, title, status, priority, notes
  ) values (
    actor_company_id,
    service_row.id,
    null,
    left(service_row.name, 500),
    'pending',
    'normal',
    null
  ) returning * into order_row;

  perform set_config('app.wf_store_purchase_payment_id', '', true);
  perform set_config('app.wf_store_purchase_order', '', true);

  update public.invoice_items
  set order_id = order_row.id,
      fulfillment_status = 'provisioned'
  where id = invoice_item_id;

  insert into public.project_messages (
    order_id, author_profile_id, author_type, body, request_id
  ) values (
    order_row.id,
    null,
    'system',
    'New service purchase received.' || chr(10) || chr(10)
      || 'Client: ' || coalesce(nullif(company_name, ''), 'Unknown company') || chr(10)
      || 'Service: ' || service_row.name || chr(10)
      || 'Amount: ' || invoice_row.currency || ' '
        || to_char(final_price_cents::numeric / 100, 'FM999999999999990.00') || chr(10)
      || 'Payment method: Wolf Forge Balance' || chr(10)
      || 'Invoice: #WF-' || lpad(invoice_row.invoice_number::text, 4, '0') || chr(10)
      || 'Project: #' || order_row.order_number::text || ' ' || order_row.title || chr(10)
      || 'Purchased: ' || to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY')
        || ' (UTC)' || chr(10) || chr(10)
      || 'The client has successfully completed payment. This Project is ready '
      || 'for the Wolf Forge team to begin fulfillment.',
    p_request_id
  );

  update public.service_interests
  set status = 'closed',
      in_cart = false,
      removed_at = coalesce(removed_at, now()),
      last_activity_at = now()
  where company_id = actor_company_id
    and service_id = service_row.id
    and status not in ('closed', 'not_interested');

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'order',
    order_row.id,
    'order.purchased',
    format(
      'Purchased %s with Wolf Forge Balance.',
      service_row.name
    ),
    jsonb_build_object(
      'company_id', actor_company_id,
      'service_id', service_row.id,
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'amount_cents', final_price_cents,
      'currency', invoice_row.currency,
      'payment_method', 'wolf_forge_wallet',
      'coupon_redemption_id', coupon_redemption_id,
      'coupon_discount_cents', coupon_discount_cents
    )
  );

  perform private.remember_create_request(
    actor_id, 'store.purchase', p_request_id, request_payload, order_row.id
  );

  return query
  select
    order_row.id,
    order_row.order_number,
    null::uuid,
    null::text,
    invoice_row.id,
    invoice_row.invoice_number,
    payment_row.id,
    final_price_cents,
    invoice_row.currency,
    wallet_row.balance_cents,
    service_row.name,
    false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_pay_invoice_with_wallet(p_request_id uuid, p_invoice_id uuid, p_coupon_code text DEFAULT NULL::text)
 RETURNS TABLE(payment_id uuid, wallet_transaction_id uuid, wallet_balance_cents bigint, invoice_balance_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  request_payload jsonb;
  existing_id uuid;
  invoice_row public.invoices;
  wallet_row public.company_wallets;
  payment_row public.invoice_payments;
  wallet_transaction_row public.company_wallet_transactions;
  amounts record;
  debit_cents bigint;
  cart_items jsonb;
  cart_subtotal numeric;
  cap_cents bigint;
  coupon_application record;
  coupon_discount_cents bigint := 0;
  coupon_redemption_id uuid;
begin
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  if actor_id is null then
    raise exception 'WF_CARD_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_request_id is null or p_invoice_id is null then
    raise exception 'WF_CARD_INVALID_PAYMENT_REQUEST' using errcode = '22023';
  end if;

  actor_company_id := (select private.current_user_company_id());

  if actor_company_id is null then
    raise exception 'WF_CARD_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  -- Reauthorize before the idempotency lookup (H-04): a payment made while
  -- access was granted must not remain replayable after invoices.view is denied.
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');

  request_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'coupon_code', nullif(btrim(p_coupon_code), '')
  );

  existing_id := private.find_create_request(
    actor_id, 'invoice.wallet.pay', p_request_id, request_payload
  );
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode='42501'; end if;
  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment
    join public.invoices as replay_invoice
      on replay_invoice.id = payment.invoice_id
     and replay_invoice.company_id = actor_company_id
    where payment.id = existing_id;
    select transaction.* into wallet_transaction_row
    from public.company_wallet_transactions as transaction
    where transaction.invoice_payment_id = existing_id;
    select * into amounts from private.invoice_amounts(payment_row.invoice_id);

    if payment_row.id is null or wallet_transaction_row.id is null then raise no_data_found; end if;
    if not private.invoice_record_visible(payment_row.invoice_id) then raise exception 'Invoice replay is unavailable' using errcode='42501'; end if;
    return query select payment_row.id, wallet_transaction_row.id,
      wallet_transaction_row.balance_after_cents, amounts.balance_due_cents;
    return;
  end if;

  -- C2-3. Frequency-bound the money rail itself. This sits AFTER the
  -- idempotent replay short-circuit, so retrying the same request id is
  -- answered from the request log and consumes no allowance (D-085), and
  if nullif(btrim(p_coupon_code),'') is not null then perform private.require_coupon_write(private.current_tenant_id()); end if;
  perform private.require_invoice_write(private.current_tenant_id());
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode='42501'; end if;

  -- BEFORE any row lock, so a scripted burst of unique request ids cannot
  -- even reach the invoice and wallet locks. Nothing else changes: the
  -- debited amount is still derived server-side and the authorization facts
  -- above are untouched.
  perform private.consume_rate_limit(
    'invoice.pay.actor.minute', actor_id::text, interval '1 minute', 20
  );
  perform private.consume_rate_limit(
    'invoice.pay.actor.hour', actor_id::text, interval '1 hour', 100
  );

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
  for update;
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode='42501'; end if;

  if invoice_row.id is null or invoice_row.company_id <> actor_company_id then
    raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if invoice_row.status <> 'unpaid' then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  debit_cents := amounts.balance_due_cents;
  if debit_cents is null or debit_cents <= 0 then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  -- Optional coupon, resolved server-side against the invoice''s own lines.
  -- The discount folds into the issued invoice''s discount/total columns
  -- (through the protect_invoice_record exception above) before settlement, so
  -- the exact debited amount is the discounted balance due.
  if nullif(btrim(p_coupon_code), '') is not null then
    select
      jsonb_agg(jsonb_build_object(
        'service_id', item.service_id,
        'quantity', item.quantity,
        'unit_amount', (item.unit_price_cents - item.unit_discount_cents)::numeric / 100,
        'billing_context', 'one_time'
      )),
      coalesce(sum((item.unit_price_cents - item.unit_discount_cents) * item.quantity), 0)::numeric / 100
    into cart_items, cart_subtotal
    from public.invoice_items as item
    where item.invoice_id = p_invoice_id
      and item.service_id is not null;

    if cart_items is null then
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    cap_cents := least(
      debit_cents,
      invoice_row.subtotal_cents - invoice_row.discount_total_cents
    );

    select * into coupon_application
    from private.resolve_coupon_application(
      p_coupon_code,
      cart_items,
      cart_subtotal,
      actor_id,
      actor_company_id,
      cap_cents
    );

    if not coupon_application.valid then
      if coupon_application.failure_code = 'ALREADY_REDEEMED' then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
      end if;
      raise exception 'WF_COUPON_INVALID' using errcode = 'P0001';
    end if;

    coupon_discount_cents := coupon_application.discount_cents;
  end if;

  if coupon_discount_cents > 0 then
    begin
      insert into public.coupon_redemptions (
        coupon_id, customer_profile_id, company_id, request_id, currency,
        original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal
      ) values (
        coupon_application.coupon_id, actor_id, actor_company_id, p_request_id,
        invoice_row.currency,
        coupon_application.original_cart_subtotal,
        coupon_application.eligible_subtotal,
        coupon_application.discount_amount,
        coupon_application.resulting_cart_subtotal
      ) returning id into coupon_redemption_id;
    exception
      when unique_violation then
        raise exception 'WF_COUPON_ALREADY_USED' using errcode = 'P0001';
    end;

    perform set_config('app.wf_invoice_coupon_discount_id', coupon_redemption_id::text, true);
    update public.invoices
    set discount_total_cents = discount_total_cents + coupon_discount_cents,
        total_cents = total_cents - coupon_discount_cents,
        updated_by_profile_id = actor_id
    where id = p_invoice_id;
    perform set_config('app.wf_invoice_coupon_discount_id', '', true);

    -- The amount to collect is now the discounted balance due.
    select balance_due_cents into debit_cents from private.invoice_amounts(p_invoice_id);
  end if;

  select wallet.* into wallet_row
  from public.company_wallets as wallet
  where wallet.company_id = actor_company_id
  for update;
  perform public.app_require_module_access('portal_invoices');
  perform private.require_permission('invoices.view');
  if actor_company_id is distinct from private.current_user_company_id() then raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode='42501'; end if;

  if wallet_row.company_id is null then raise no_data_found; end if;
  if wallet_row.currency <> invoice_row.currency then
    raise exception 'WF_CARD_CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;
  if wallet_row.balance_cents < debit_cents then
    raise exception 'WF_CARD_INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id,
    p_request_id,
    p_invoice_id,
    debit_cents,
    'succeeded',
    'wolf_forge_wallet',
    'wolf_forge_internal',
    null
  );

  perform set_config('app.wf_wallet_invoice_payment_id', payment_row.id::text, true);

  update public.company_wallets
  set balance_cents = balance_cents - debit_cents
  where company_id = actor_company_id
  returning * into wallet_row;

  insert into public.company_wallet_transactions (
    company_id, request_id, actor_profile_id, amount_cents,
    balance_after_cents, currency, source, reason, invoice_id, invoice_payment_id
  ) values (
    actor_company_id, p_request_id, actor_id, -debit_cents,
    wallet_row.balance_cents, wallet_row.currency, 'invoice_payment',
    format('WF Card payment for invoice #%s', invoice_row.invoice_number),
    invoice_row.id, payment_row.id
  ) returning * into wallet_transaction_row;

  perform set_config('app.wf_wallet_invoice_payment_id', '', true);

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'company',
    actor_company_id,
    'company.wallet_invoice_paid',
    'Paid an invoice with the Wolf Forge Balance.',
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_payment_id', payment_row.id,
      'wallet_transaction_id', wallet_transaction_row.id,
      'amount_cents', debit_cents,
      'balance_after_cents', wallet_row.balance_cents,
      'currency', wallet_row.currency,
      'coupon_redemption_id', coupon_redemption_id,
      'coupon_discount_cents', coupon_discount_cents
    )
  );

  perform private.remember_create_request(
    actor_id, 'invoice.wallet.pay', p_request_id, request_payload, payment_row.id
  );

  select * into amounts from private.invoice_amounts(p_invoice_id);
  return query select payment_row.id, wallet_transaction_row.id,
    wallet_row.balance_cents, amounts.balance_due_cents;
end;
$function$;
