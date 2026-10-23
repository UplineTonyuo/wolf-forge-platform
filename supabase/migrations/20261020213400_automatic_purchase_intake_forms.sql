-- New settled Store purchases assign every published Intake linked to the Service.
-- Existing purchases and manual assignments are not backfilled or replaced.
create function private.assign_purchase_intake_forms(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  project_row public.orders;
  intake record;
  assignment_id uuid;
  assigned_count integer := 0;
begin
  select project.* into project_row
  from public.orders project
  join public.companies company on company.id = project.company_id
    and company.tenant_id = project.tenant_id and company.archived_at is null
  join public.tenant_memberships membership on membership.company_id = company.id
    and membership.tenant_id = project.tenant_id and membership.profile_id = actor_id
    and membership.account_class = 'client' and membership.archived_at is null
  join public.roles role on role.id = membership.role_id and role.name = 'client'
  join public.profiles profile on profile.id = actor_id and profile.archived_at is null
  where project.id = p_order_id and project.archived_at is null
    and project.tenant_id = private.current_tenant_id()
    and exists (
      select 1 from public.invoice_items item
      join public.invoices invoice on invoice.id = item.invoice_id
      where item.order_id = project.id and item.service_id = project.service_id
        and item.fulfillment_status = 'provisioned'
        and invoice.company_id = project.company_id and invoice.client_profile_id = actor_id
        and invoice.tenant_id = project.tenant_id and invoice.status = 'paid'
        and invoice.billing_reason = 'store_purchase' and invoice.archived_at is null
    );
  if project_row.id is null then
    raise exception 'Purchase intake context is unavailable' using errcode = '42501';
  end if;
  if not private.tenant_module_allowed(project_row.tenant_id, 'forms') then return 0; end if;
  perform private.require_forms_write(project_row.tenant_id);

  for intake in
    select form.id, form.published_version_id
    from public.forms form
    join public.form_versions version on version.id = form.published_version_id
      and version.form_id = form.id and version.lifecycle_state = 'published'
    where form.tenant_id = project_row.tenant_id and form.form_type = 'intake'
      and form.status = 'published' and form.archived_at is null
      and exists (
        select 1 from public.form_service_links link
        where link.form_version_id = version.id and link.form_version_field_id is null
          and link.role = 'intake_assignment' and link.service_id = project_row.service_id
      )
    order by form.id
    for share of form
  loop
    assignment_id := null;
    insert into public.form_assignments (
      form_id, form_version_id, company_id, client_profile_id, order_id,
      required, assigned_by_profile_id
    ) values (
      intake.id, intake.published_version_id, project_row.company_id, actor_id,
      project_row.id, true, actor_id
    ) on conflict (form_id, order_id) where order_id is not null and status = 'assigned'
      do nothing
    returning id into assignment_id;
    if assignment_id is not null then
      insert into public.activity_events(actor_profile_id, entity_type, entity_id, action, summary, metadata)
      values (
        actor_id, 'form_assignment', assignment_id, 'form.assigned',
        'Automatically assigned Intake Form after Service purchase.',
        jsonb_build_object('form_id', intake.id, 'form_version_id', intake.published_version_id,
          'company_id', project_row.company_id, 'order_id', project_row.id,
          'client_profile_id', actor_id, 'automatic', true)
      );
      assigned_count := assigned_count + 1;
    end if;
  end loop;
  return assigned_count;
end;
$$;
revoke all on function private.assign_purchase_intake_forms(uuid) from public, anon, authenticated, service_role;

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

  perform private.assign_purchase_intake_forms(order_row.id);

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
