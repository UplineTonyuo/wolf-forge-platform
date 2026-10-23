-- WL-2.38: published Invoice policy; no publication or business rows are seeded.
create function private.require_invoice_write(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_tenant_module_lifecycle(p_tenant_id);
  if auth.uid() is null and not exists(select 1 from private.tenant_module_publications where tenant_id=p_tenant_id) then return; end if;
  if not private.tenant_module_allowed(p_tenant_id,'invoices') then
    raise exception 'WF_INVOICES_DISABLED' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_invoice_write(uuid) from public,anon,authenticated,service_role;

create function private.require_invoice_publication_clear(p_tenant_id uuid,p_keys text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if 'invoices'=any(p_keys) then return; end if;
  if exists(select 1 from public.invoices i cross join lateral private.invoice_amounts(i.id) a
    where i.tenant_id=p_tenant_id and (i.status in ('unpaid','payment_pending')
      or (i.status not in ('draft','paid','void') and a.balance_due_cents>0))) then
    raise exception 'Outstanding Invoice obligations prevent disablement' using errcode='55000';
  end if;
  if exists(select 1 from public.invoice_payments p join public.invoices i on i.id=p.invoice_id
    where i.tenant_id=p_tenant_id and p.status='pending') then
    raise exception 'Pending Invoice payments prevent disablement; no automatic resolution is authorized' using errcode='55000';
  end if;
  if exists(select 1 from public.invoice_refunds r join public.invoices i on i.id=r.invoice_id
    where i.tenant_id=p_tenant_id and r.status='pending') then
    raise exception 'Pending Invoice refunds prevent disablement; no automatic resolution is authorized' using errcode='55000';
  end if;
end;
$$;
revoke all on function private.require_invoice_publication_clear(uuid,text[]) from public,anon,authenticated,service_role;

create function private.invoice_record_visible(p_invoice_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.invoices i join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id
  where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id() and i.archived_at is null and c.archived_at is null
    and (private.tenant_module_allowed(i.tenant_id,'invoices') or (i.status<>'draft' and i.issued_at is not null)));
$$;
revoke all on function private.invoice_record_visible(uuid) from public,anon,authenticated,service_role;

create function private.enforce_invoice_module_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.invoices;
begin
  if tg_op='UPDATE' then
    if tg_table_name='invoices' then
      perform private.require_invoice_write(old.tenant_id);
    else
      perform private.require_invoice_write((select tenant_id from public.invoices where id=old.invoice_id));
    end if;
  end if;
  if tg_table_name='invoices' then
    if tg_op='DELETE' then parent:=old; else parent:=new; end if;
  else
    if tg_op='DELETE' then select * into parent from public.invoices where id=old.invoice_id;
    else select * into parent from public.invoices where id=new.invoice_id; end if;
  end if;
  if parent.id is null then raise exception 'Invoice parent unavailable' using errcode='23503'; end if;
  perform private.require_invoice_write(parent.tenant_id);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.enforce_invoice_module_write() from public,anon,authenticated,service_role;

create function public.app_invoices_work_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_account_class() is null or not (
    private.current_user_has_permission('invoices.view') or private.current_user_has_permission('invoices.manage')
    or private.current_user_has_permission('invoices.mark_paid') or private.current_user_has_permission('invoices.refund')
    or private.current_user_has_permission('invoices.void') or private.current_user_has_permission('store.view')) then
    raise exception 'Invoice access is denied' using errcode='42501';
  end if;
  return private.tenant_module_allowed(private.current_tenant_id(),'invoices');
end;
$$;
revoke all on function public.app_invoices_work_enabled() from public,anon,authenticated,service_role;
grant execute on function public.app_invoices_work_enabled() to authenticated;

create function private.invoice_project_visible(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select private.can_access_operational_order(p_order_id) or (
  private.current_account_class()='client' and private.current_user_has_permission('projects.view')
  and private.tenant_module_allowed(private.current_tenant_id(),'projects')
  and exists(select 1 from public.orders o where o.id=p_order_id and o.tenant_id=private.current_tenant_id()
    and o.company_id=private.current_user_company_id() and o.archived_at is null));
$$;
revoke all on function private.invoice_project_visible(uuid) from public,anon,authenticated,service_role;

create function public.app_list_invoice_items(p_invoice_id uuid)
returns setof public.invoice_items language plpgsql stable security definer set search_path='' as $$
declare item public.invoice_items;
begin
  if not private.can_read_invoice(p_invoice_id) then raise exception 'Invoice access is denied' using errcode='42501'; end if;
  for item in select * from public.invoice_items where invoice_id=p_invoice_id order by position loop
    if item.order_id is not null and not private.invoice_project_visible(item.order_id) then item.order_id:=null; end if;
    return next item;
  end loop;
end;
$$;
revoke all on function public.app_list_invoice_items(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_list_invoice_items(uuid) to authenticated;

create function public.app_find_invoice_item_by_order_id(p_order_id uuid)
returns public.invoice_items language plpgsql stable security definer set search_path='' as $$
declare item public.invoice_items;
begin
  if not private.can_access_operational_order(p_order_id) then return null; end if;
  select * into item from public.invoice_items where order_id=p_order_id;
  if item.id is null or not private.can_read_invoice(item.invoice_id) then return null; end if;
  return item;
end;
$$;
revoke all on function public.app_find_invoice_item_by_order_id(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_find_invoice_item_by_order_id(uuid) to authenticated;

create function public.app_list_my_wallet_history(p_limit integer default 50)
returns table(id uuid,amount_cents bigint,balance_after_cents bigint,currency text,source text,reason text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare actor_company_id uuid:=private.current_user_company_id();
begin
  if private.current_account_class()<>'client' or actor_company_id is null then raise exception 'Client wallet access is denied' using errcode='42501'; end if;
  perform private.require_permission('invoices.view');
  perform private.require_client_private_company_access(actor_company_id);
  return query select t.id,t.amount_cents,t.balance_after_cents,t.currency,t.source,t.reason,t.created_at
    from public.company_wallet_transactions t join public.companies c on c.id=t.company_id
    where t.company_id=actor_company_id and c.tenant_id=private.current_tenant_id() and c.archived_at is null
    order by t.created_at desc,t.id desc limit least(greatest(coalesce(p_limit,50),1),100);
end;
$$;
revoke all on function public.app_list_my_wallet_history(integer) from public,anon,authenticated,service_role;
grant execute on function public.app_list_my_wallet_history(integer) to authenticated;

create function private.financial_notification_visible(p_entity_type text,p_entity_id uuid,p_category text,p_company_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select case when p_entity_type='invoice' then private.can_read_invoice(p_entity_id)
  when p_category='wallet' then exists(select 1 from public.companies c where c.id=coalesce(p_company_id,p_entity_id)
    and c.tenant_id=private.current_tenant_id() and c.archived_at is null and private.can_access_client_private_company(c.id))
  else true end;
$$;
revoke all on function private.financial_notification_visible(text,uuid,text,uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION private.published_module_set_valid(p_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    p_keys is not null
    and array_ndims(p_keys) = 1
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as requested(key))
    and not exists (
      select 1 from unnest(p_keys) as requested(key)
      where key is null or not exists (
        select 1 from private.white_label_modules as catalog where catalog.module_key = key
      )
    )
    and (not ('projects' = any(p_keys)) or 'tickets' = any(p_keys))
    and (not ('subscriptions' = any(p_keys)) or 'invoices' = any(p_keys))
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key = any(p_keys)
        and catalog.requires_module_key is not null
        and not (catalog.requires_module_key = any(p_keys))
    )
    -- Five modules have audited disablement coverage.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects', 'tickets', 'subscriptions', 'invoices') and not (catalog.module_key = any(p_keys))
    ), false);
$function$
;

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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION private.can_read_invoice(p_invoice_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.invoices as invoice_row
    join public.companies as company_row
      on company_row.id = invoice_row.company_id
     and company_row.archived_at is null
    where invoice_row.id = p_invoice_id
      and invoice_row.tenant_id = (select private.current_tenant_id())
      and invoice_row.archived_at is null
      and private.invoice_record_visible(invoice_row.id)
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
$function$
;

CREATE OR REPLACE FUNCTION public.app_require_module_access(p_module_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_class text := private.current_account_class();
  module_row public.permission_modules;
begin
  if caller_class is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  select * into module_row from public.permission_modules where module_key = p_module_key;
  if module_row.module_key is null or module_row.account_class <> caller_class
    or (p_module_key not in ('invoices','portal_invoices') and not private.tenant_module_allowed(private.current_tenant_id(), p_module_key)) then
    raise exception 'module access is denied: %', p_module_key using errcode = '42501';
  end if;
  perform private.require_permission(module_row.required_permission_key);
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_get_company_wallet(p_company_id uuid)
 RETURNS company_wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  wallet_row public.company_wallets;
begin
  if private.current_account_class() = 'client' then
    perform private.require_permission('invoices.view');
  end if;

  perform private.require_client_private_company_access(p_company_id);

  select wallet.*
  into wallet_row
  from public.company_wallets as wallet
  join public.companies as company_row
    on company_row.id = wallet.company_id
  where wallet.company_id = p_company_id
    and company_row.archived_at is null;

  if wallet_row.company_id is null then
    raise no_data_found;
  end if;

  return wallet_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_create_invoice(p_request_id uuid, p_payload jsonb)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  existing_id uuid;
  invoice_row public.invoices;
  normalized_currency text;
  initial_status text;
begin
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  actor_id := private.require_invoice_capability('invoices.manage');
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
    if not private.invoice_record_visible(invoice_row.id) then raise exception 'Invoice replay is unavailable' using errcode='42501'; end if;
    return invoice_row;
  end if;

  perform private.require_invoice_write(private.current_tenant_id());

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
$function$
;

CREATE OR REPLACE FUNCTION public.app_record_invoice_payment(p_request_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_status text DEFAULT 'succeeded'::text, p_payment_method text DEFAULT 'manual'::text, p_processor text DEFAULT NULL::text, p_processor_reference text DEFAULT NULL::text)
 RETURNS invoice_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  payment_row public.invoice_payments;
begin
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  actor_id := private.require_invoice_capability('invoices.mark_paid');
  existing_id := private.find_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload
  );

  if existing_id is not null then
    select payment.* into payment_row
    from public.invoice_payments as payment
    join public.invoices as invoice_row
      on invoice_row.id = payment.invoice_id
     and invoice_row.tenant_id = (select private.current_tenant_id())
    where payment.id = existing_id;
    if payment_row.id is null then raise no_data_found; end if;
    if not private.invoice_record_visible(payment_row.invoice_id) then raise exception 'Invoice replay is unavailable' using errcode='42501'; end if;
    return payment_row;
  end if;

  perform private.require_invoice_write(private.current_tenant_id());

  payment_row := private.settle_invoice_payment(
    actor_id, p_request_id, p_invoice_id, p_amount_cents, p_status,
    p_payment_method, p_processor, p_processor_reference
  );

  perform private.remember_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload, payment_row.id
  );
  return payment_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_refund_invoice(p_request_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_reason text, p_invoice_payment_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'succeeded'::text, p_processor text DEFAULT NULL::text, p_processor_reference text DEFAULT NULL::text)
 RETURNS invoice_refunds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  actor_id := private.require_invoice_capability('invoices.refund');
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
    from public.invoice_refunds as refund
    join public.invoices as replay_invoice
      on replay_invoice.id = refund.invoice_id
     and replay_invoice.tenant_id = (select private.current_tenant_id())
    where refund.id = existing_id;
    if refund_row.id is null then raise no_data_found; end if;
    if not private.invoice_record_visible(refund_row.invoice_id) then raise exception 'Invoice replay is unavailable' using errcode='42501'; end if;
    return refund_row;
  end if;

  perform private.require_invoice_write(private.current_tenant_id());

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
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
$function$
;

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
  perform private.require_invoice_write(private.current_tenant_id());

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
$function$
;

CREATE OR REPLACE FUNCTION public.app_update_invoice(p_invoice_id uuid, p_patch jsonb)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  invoice_row public.invoices;
  before_snapshot jsonb;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  actor_id := private.require_invoice_capability('invoices.manage');
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
$function$
;

CREATE OR REPLACE FUNCTION public.app_issue_invoice(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.manage');
  invoice_row public.invoices;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  actor_id := private.require_invoice_capability('invoices.manage');
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
$function$
;

CREATE OR REPLACE FUNCTION public.app_void_invoice(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_invoice_capability('invoices.void');
  invoice_row public.invoices;
  amounts record;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  actor_id := private.require_invoice_capability('invoices.void');
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
$function$
;

CREATE OR REPLACE FUNCTION private.settle_invoice_payment(p_actor_id uuid, p_request_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_status text, p_payment_method text, p_processor text DEFAULT NULL::text, p_processor_reference text DEFAULT NULL::text)
 RETURNS invoice_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  invoice_row public.invoices;
  payment_row public.invoice_payments;
  amounts record;
  remaining_balance bigint;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  if p_actor_id is null or p_actor_id is distinct from (select auth.uid())
    or not exists (
      select 1 from public.profiles as profile_row
      where profile_row.id = p_actor_id and profile_row.archived_at is null
    )
  then
    raise exception 'verified payment actor is required' using errcode = '42501';
  end if;

  if p_request_id is null or p_amount_cents is null or p_amount_cents <= 0
    or p_status not in ('pending', 'succeeded', 'failed', 'cancelled')
    or p_payment_method not in (
      'manual', 'card', 'bank_transfer', 'wallet', 'wolf_forge_wallet', 'other'
    )
  then
    raise exception 'invalid invoice payment' using errcode = '22023';
  end if;

  select invoice.* into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null
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
    p_request_id, p_actor_id
  ) returning * into payment_row;

  if p_status = 'pending' and invoice_row.status = 'unpaid' then
    update public.invoices
    set status = 'payment_pending', updated_by_profile_id = p_actor_id
    where id = p_invoice_id;
  elsif p_status = 'succeeded' then
    select balance_due_cents into remaining_balance
    from private.invoice_amounts(p_invoice_id);

    update public.invoices
    set status = case when remaining_balance = 0 then 'paid' else 'unpaid' end,
        invoice_number = coalesce(invoice_number, private.next_invoice_number()),
        issued_at = coalesce(issued_at, now()),
        updated_by_profile_id = p_actor_id
    where id = p_invoice_id;

    if remaining_balance = 0 then
      update public.invoice_items
      set fulfillment_status = 'pending'
      where invoice_id = p_invoice_id
        and service_id is not null
        and fulfillment_status = 'awaiting_payment';
    end if;
  end if;

  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    p_actor_id,
    'invoice',
    p_invoice_id,
    'invoice.payment_recorded',
    'Recorded invoice payment.',
    jsonb_build_object(
      'payment_id', payment_row.id,
      'amount_cents', payment_row.amount_cents,
      'currency', payment_row.currency,
      'status', payment_row.status,
      'payment_method', payment_row.payment_method
    )
  );

  return payment_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.issue_subscription_cycle_invoice(p_actor_id uuid, p_cycle_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cycle_row public.subscription_cycles;
  subscription_row public.subscriptions;
  plan_row public.subscription_plan_versions;
  invoice_row public.invoices;
  subtotal bigint;
  discount_total bigint;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  if p_actor_id is null or p_actor_id is distinct from (select auth.uid()) then
    raise exception 'verified subscription billing actor is required' using errcode = '42501';
  end if;

  perform private.require_subscription_capability('subscriptions.billing');
  if not exists(select 1 from public.subscriptions s join public.subscription_cycles c on c.subscription_id=s.id where c.id=p_cycle_id and s.tenant_id=private.current_tenant_id()) then raise no_data_found; end if;
  perform private.require_subscription_write(private.current_tenant_id());
  perform 1 from public.subscriptions s join public.subscription_cycles c on c.subscription_id=s.id where c.id=p_cycle_id for update of s;
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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.app_list_my_notifications(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, company_id uuid, audience text, category text, variant text, title text, body text, href text, entity_type text, entity_id uuid, actor_profile_id uuid, event_key text, read_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return query
  select
    notification.id,
    notification.company_id,
    notification.audience,
    notification.category,
    notification.variant,
    notification.title,
    notification.body,
    notification.href,
    notification.entity_type,
    notification.entity_id,
    notification.actor_profile_id,
    notification.event_key,
    notification.read_at,
    notification.created_at
  from public.notifications as notification
  where notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
    and private.financial_notification_visible(notification.entity_type,notification.entity_id,notification.category,notification.company_id)
    and (notification.entity_type is distinct from 'subscription' or (private.activity_event_parent_tenant_id('subscription',notification.entity_id)=private.current_tenant_id() and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(notification.entity_id))))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    )
  order by notification.created_at desc, notification.id desc
  limit row_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_mark_notification_read(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed boolean;
begin
  update public.notifications as notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = p_notification_id
    and notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
    and private.financial_notification_visible(notification.entity_type,notification.entity_id,notification.category,notification.company_id)
    and (notification.entity_type is distinct from 'subscription' or (private.activity_event_parent_tenant_id('subscription',notification.entity_id)=private.current_tenant_id() and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(notification.entity_id))))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  changed := found;
  return changed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed integer;
begin
  update public.notifications as notification
  set read_at = now()
  where notification.recipient_profile_id = caller_id
    and notification.read_at is null
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
    and private.financial_notification_visible(notification.entity_type,notification.entity_id,notification.category,notification.company_id)
    and (notification.entity_type is distinct from 'subscription' or (private.activity_event_parent_tenant_id('subscription',notification.entity_id)=private.current_tenant_id() and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(notification.entity_id))))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  get diagnostics changed = row_count;
  return changed;
end;
$function$
;


create policy invoices_published_history on public.invoices as restrictive for select to authenticated using(private.can_read_invoice(id));
create policy invoice_items_published_history on public.invoice_items as restrictive for select to authenticated using(private.can_read_invoice(invoice_id));
create policy invoice_payments_published_history on public.invoice_payments as restrictive for select to authenticated using(private.can_read_invoice(invoice_id));
create policy invoice_refunds_published_history on public.invoice_refunds as restrictive for select to authenticated using(private.can_read_invoice(invoice_id));
create policy activity_events_published_invoices on public.activity_events as restrictive for select to authenticated using(entity_type<>'invoice' or private.can_read_invoice(entity_id));
revoke select on public.invoice_items from authenticated;
grant select(id,invoice_id,service_id,position,name,description,quantity,unit_price_cents,unit_discount_cents,line_subtotal_cents,is_taxable,fulfillment_status,created_at,updated_at) on public.invoice_items to authenticated;
create trigger invoices_published_write before insert or update or delete on public.invoices for each row execute function private.enforce_invoice_module_write();
create trigger invoice_items_published_write before insert or update or delete on public.invoice_items for each row execute function private.enforce_invoice_module_write();
create trigger invoice_payments_published_write before insert or update or delete on public.invoice_payments for each row execute function private.enforce_invoice_module_write();
create trigger invoice_refunds_published_write before insert or update or delete on public.invoice_refunds for each row execute function private.enforce_invoice_module_write();

CREATE OR REPLACE FUNCTION public.app_dashboard_overview(p_start timestamp with time zone, p_end timestamp with time zone, p_previous_start timestamp with time zone, p_previous_end timestamp with time zone, p_bucket text, p_time_zone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bucket_interval interval;
  result jsonb;
begin
  -- The boundary. A typed URL, a forged client and a direct PostgREST call all
  -- arrive here. app_require_module_access also verifies the caller's account
  -- class, so a client account is rejected regardless of its grants.
  perform public.app_require_module_access('dashboard');

  if p_start is null or p_end is null
    or p_previous_start is null or p_previous_end is null
  then
    raise exception 'dashboard range is required' using errcode = '22023';
  end if;

  if p_end <= p_start or p_previous_end <= p_previous_start then
    raise exception 'dashboard range must end after it starts' using errcode = '22023';
  end if;

  if p_end - p_start > interval '366 days' then
    raise exception 'dashboard range cannot span more than 366 days' using errcode = '22023';
  end if;

  if p_bucket not in ('hour', 'day', 'week') then
    raise exception 'invalid dashboard bucket' using errcode = '22023';
  end if;

  -- Rejects an unknown zone before it reaches date_trunc.
  begin
    perform now() at time zone p_time_zone;
  exception when others then
    raise exception 'invalid dashboard time zone' using errcode = '22023';
  end;

  bucket_interval := ('1 ' || p_bucket)::interval;

  with
  /*
   * Shared derivation: when an invoice actually became paid.
   *
   * public.invoices has no paid_at column, so the moment is the last succeeded
   * payment's settled_at. The total_cents = 0 branch matters because
   * app_issue_invoice moves a zero-total invoice straight to 'paid' with no
   * payment row at all; without it those orders would vanish from the count.
   */
  invoice_paid as (
    select
      invoice_row.id,
      invoice_row.currency,
      case
        when invoice_row.total_cents = 0 then invoice_row.issued_at
        else settled.last_settled_at
      end as paid_at
    from public.invoices as invoice_row
    left join lateral (
      select max(payment.settled_at) as last_settled_at
      from public.invoice_payments as payment
      where payment.invoice_id = invoice_row.id
        and payment.status = 'succeeded'
    ) as settled on true
    where invoice_row.archived_at is null
      and invoice_row.status = 'paid'
      and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
  ),

  /*
   * Revenue: cash collected, net of refunds, never summed across currencies.
   *
   * Reads the payment and refund ledgers directly with no join to invoices, so
   * each row is counted exactly once and no join can fan out. Draft invoices
   * cannot hold payments (app_record_invoice_payment rejects them) and an
   * invoice carrying settled or pending money cannot be voided, so both states
   * are excluded structurally rather than by filter.
   *
   * A refund is attributed to the period it was issued in, not the period of
   * the original sale, so a closed period's number never changes in hindsight.
   *
   * Both ledgers carry no tenant_id; the invoice parent decides the Tenant.
   */
  revenue_movements as (
    select
      'current'::text as window_key,
      payment.currency,
      payment.amount_cents::bigint as gross_cents,
      0::bigint as refunds_cents
    from public.invoice_payments as payment
    where payment.status = 'succeeded'
      and payment.settled_at >= p_start
      and payment.settled_at < p_end
      and exists (
        select 1
        from public.invoices as invoice_row
        where invoice_row.id = payment.invoice_id
          and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
      )
    union all
    select 'current', refund.currency, 0::bigint, refund.amount_cents::bigint
    from public.invoice_refunds as refund
    where refund.status = 'succeeded'
      and refund.refunded_at >= p_start
      and refund.refunded_at < p_end
      and exists (
        select 1
        from public.invoices as invoice_row
        where invoice_row.id = refund.invoice_id
          and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
      )
    union all
    select 'previous', payment.currency, payment.amount_cents::bigint, 0::bigint
    from public.invoice_payments as payment
    where payment.status = 'succeeded'
      and payment.settled_at >= p_previous_start
      and payment.settled_at < p_previous_end
      and exists (
        select 1
        from public.invoices as invoice_row
        where invoice_row.id = payment.invoice_id
          and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
      )
    union all
    select 'previous', refund.currency, 0::bigint, refund.amount_cents::bigint
    from public.invoice_refunds as refund
    where refund.status = 'succeeded'
      and refund.refunded_at >= p_previous_start
      and refund.refunded_at < p_previous_end
      and exists (
        select 1
        from public.invoices as invoice_row
        where invoice_row.id = refund.invoice_id
          and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
      )
  ),
  revenue as (
    select
      window_key,
      currency,
      sum(gross_cents)::bigint as gross_cents,
      sum(refunds_cents)::bigint as refunds_cents,
      (sum(gross_cents) - sum(refunds_cents))::bigint as net_cents
    from revenue_movements
    group by window_key, currency
  ),

  /*
   * Paid orders. invoice_items_order_unique is a GLOBAL partial unique index on
   * order_id, so an order can appear on at most one invoice item ever and
   * count(*) is already distinct by order. Restricting to fully paid invoices
   * means a partially collected invoice does not yet count its orders as sold.
   * The Tenant is inherited from invoice_paid.
   */
  paid_orders as (
    select
      count(*) filter (
        where paid.paid_at >= p_start and paid.paid_at < p_end
      )::bigint as current_count,
      count(*) filter (
        where paid.paid_at >= p_previous_start and paid.paid_at < p_previous_end
      )::bigint as previous_count
    from public.invoice_items as item
    join invoice_paid as paid on paid.id = item.invoice_id
    where item.order_id is not null
  ),

  /*
   * Client lifecycle. app_update_company is the only writer of companies.status
   * and logs every transition to activity_events, so conversions are real
   * persisted history rather than a snapshot inference.
   *
   * count(distinct entity_id) collapses a company that bounced client -> lead
   * -> client inside one window.
   */
  client_status_events as (
    select
      event.entity_id,
      event.created_at,
      event.metadata ->> 'to' as to_status
    from public.activity_events as event
    where event.entity_type = 'company'
      and event.tenant_id = (select private.current_tenant_id())
      and event.metadata ->> 'field' = 'status'
  ),
  clients_converted as (
    select
      count(distinct entity_id) filter (
        where created_at >= p_start and created_at < p_end and to_status = 'client'
      )::bigint as current_count,
      count(distinct entity_id) filter (
        where created_at >= p_previous_start and created_at < p_previous_end
          and to_status = 'client'
      )::bigint as previous_count
    from client_status_events
  ),
  /*
   * Companies created. Every company is created at status 'contact'
   * (app_create_company takes only a name), so this is genuinely "new contacts
   * added" and cannot stand in for new clients won.
   *
   * Archived companies are still counted: a closed period's total must not
   * shrink because a record was archived months later.
   */
  companies_created as (
    select
      count(*) filter (
        where company.created_at >= p_start and company.created_at < p_end
      )::bigint as current_count,
      count(*) filter (
        where company.created_at >= p_previous_start
          and company.created_at < p_previous_end
      )::bigint as previous_count
    from public.companies as company
    where company.tenant_id = (select private.current_tenant_id())
  ),

  new_subscriptions as (
    select
      count(*) filter (
        where subscription.started_at >= p_start and subscription.started_at < p_end
      )::bigint as current_count,
      count(*) filter (
        where subscription.started_at >= p_previous_start
          and subscription.started_at < p_previous_end
      )::bigint as previous_count
    from public.subscriptions as subscription
    where subscription.archived_at is null
      and subscription.tenant_id = (select private.current_tenant_id())
  ),

  /*
   * Active subscriptions: a snapshot at query time, deliberately NOT filtered
   * by the selected period.
   *
   * past_due is still a live agreement the dunning engine is working, and
   * pending_cancellation still bills until cancel_effective_at. paused is
   * excluded from the billable figure because it is not billing, but is
   * returned in the breakdown so the UI can show it.
   */
  subscription_snapshot as (
    select subscription.status, count(*)::bigint as status_count
    from public.subscriptions as subscription
    where subscription.archived_at is null
      and subscription.status <> 'canceled'
      and subscription.tenant_id = (select private.current_tenant_id())
    group by subscription.status
  ),

  /*
   * Sales trend. generate_series guarantees empty buckets are present with a
   * zero, so a chart shows a real gap instead of interpolating across one.
   * Bucketing happens in business-local time, so a "day" is the business day.
   */
  bucket_series as (
    select generate_series(
      date_trunc(p_bucket, p_start at time zone p_time_zone),
      date_trunc(p_bucket, (p_end - interval '1 microsecond') at time zone p_time_zone),
      bucket_interval
    ) as bucket_start
  ),
  trend_currencies as (
    select distinct currency from revenue where window_key = 'current'
  ),
  trend_movements as (
    select
      payment.currency,
      date_trunc(p_bucket, payment.settled_at at time zone p_time_zone) as bucket_start,
      payment.amount_cents::bigint as net_cents
    from public.invoice_payments as payment
    where payment.status = 'succeeded'
      and payment.settled_at >= p_start
      and payment.settled_at < p_end
      and exists (
        select 1
        from public.invoices as invoice_row
        where invoice_row.id = payment.invoice_id
          and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
      )
    union all
    select
      refund.currency,
      date_trunc(p_bucket, refund.refunded_at at time zone p_time_zone),
      -refund.amount_cents::bigint
    from public.invoice_refunds as refund
    where refund.status = 'succeeded'
      and refund.refunded_at >= p_start
      and refund.refunded_at < p_end
      and exists (
        select 1
        from public.invoices as invoice_row
        where invoice_row.id = refund.invoice_id
          and invoice_row.tenant_id = (select private.current_tenant_id())
          and (private.tenant_module_allowed(invoice_row.tenant_id,'invoices') or private.invoice_record_visible(invoice_row.id))
      )
  ),
  trend as (
    select
      currency_row.currency,
      jsonb_agg(
        jsonb_build_object(
          'bucket_start',
          (series.bucket_start at time zone p_time_zone),
          'net_cents',
          coalesce(bucket_total.net_cents, 0)
        )
        order by series.bucket_start
      ) as points
    from trend_currencies as currency_row
    cross join bucket_series as series
    left join lateral (
      select sum(movement.net_cents)::bigint as net_cents
      from trend_movements as movement
      where movement.currency = currency_row.currency
        and movement.bucket_start = series.bucket_start
    ) as bucket_total on true
    group by currency_row.currency
  ),

  /*
   * Client growth.
   *
   * The initial 'contact' assignment is a column default at insert, not an
   * event, so to_contact counts only explicit moves back to contact — never
   * first creation. tracking_since lets the UI say how far back the record
   * actually goes instead of implying the chart covers all time.
   */
  growth as (
    select
      date_trunc(p_bucket, event.created_at at time zone p_time_zone) as bucket_start,
      count(distinct event.entity_id) filter (where event.to_status = 'contact')::bigint as to_contact,
      count(distinct event.entity_id) filter (where event.to_status = 'lead')::bigint as to_lead,
      count(distinct event.entity_id) filter (where event.to_status = 'client')::bigint as to_client,
      count(distinct event.entity_id) filter (where event.to_status = 'client_team')::bigint as to_client_team
    from client_status_events as event
    where event.created_at >= p_start
      and event.created_at < p_end
    group by 1
  ),
  growth_tracking as (
    select min(created_at) as tracking_since from client_status_events
  )

  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'headline_currency', 'USD',
      'current', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'currency', revenue_row.currency,
            'gross_cents', revenue_row.gross_cents,
            'refunds_cents', revenue_row.refunds_cents,
            'net_cents', revenue_row.net_cents
          ) order by revenue_row.currency
        )
        from revenue as revenue_row where revenue_row.window_key = 'current'
      ), '[]'::jsonb),
      'previous', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'currency', revenue_row.currency,
            'gross_cents', revenue_row.gross_cents,
            'refunds_cents', revenue_row.refunds_cents,
            'net_cents', revenue_row.net_cents
          ) order by revenue_row.currency
        )
        from revenue as revenue_row where revenue_row.window_key = 'previous'
      ), '[]'::jsonb)
    ),
    'paid_orders', (
      select jsonb_build_object('current', current_count, 'previous', previous_count)
      from paid_orders
    ),
    'clients', jsonb_build_object(
      'converted', (
        select jsonb_build_object('current', current_count, 'previous', previous_count)
        from clients_converted
      ),
      'created', (
        select jsonb_build_object('current', current_count, 'previous', previous_count)
        from companies_created
      )
    ),
    'new_subscriptions', (
      select jsonb_build_object('current', current_count, 'previous', previous_count)
      from new_subscriptions
    ),
    'active_subscriptions', jsonb_build_object(
      'billable', coalesce((
        select sum(status_count)::bigint from subscription_snapshot
        where status in ('active', 'past_due', 'pending_cancellation')
      ), 0),
      'by_status', coalesce((
        select jsonb_agg(
          jsonb_build_object('status', status, 'count', status_count)
          order by status
        )
        from subscription_snapshot
      ), '[]'::jsonb)
    ),
    'sales_trend', coalesce((
      select jsonb_agg(
        jsonb_build_object('currency', trend.currency, 'points', trend.points)
        order by trend.currency
      )
      from trend
    ), '[]'::jsonb),
    'client_growth', jsonb_build_object(
      'supported', (select tracking_since is not null from growth_tracking),
      'tracking_since', (select tracking_since from growth_tracking),
      'points', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'bucket_start', (growth.bucket_start at time zone p_time_zone),
            'to_contact', growth.to_contact,
            'to_lead', growth.to_lead,
            'to_client', growth.to_client,
            'to_client_team', growth.to_client_team
          ) order by growth.bucket_start
        )
        from growth
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_generate_subscription_cycle_invoice(p_request_id uuid, p_cycle_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  request_payload jsonb := jsonb_build_object('cycle_id', p_cycle_id);
  existing_id uuid;
  cycle_row public.subscription_cycles;
  invoice_row public.invoices;
begin
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  actor_id := private.require_subscription_capability('subscriptions.billing');
  if p_request_id is null or p_cycle_id is null then
    raise exception 'subscription cycle generation request is invalid' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'subscription.cycle.generate', p_request_id, request_payload
  );
  if existing_id is not null then
    select invoice.* into invoice_row
    from public.invoices as invoice
    where invoice.id = existing_id
      and invoice.tenant_id = (select private.current_tenant_id());
    if invoice_row.id is null then raise no_data_found; end if;
    if not private.can_read_subscription((select c.subscription_id from public.subscription_cycles c where c.invoice_id=invoice_row.id)) then raise exception 'Subscription access is denied' using errcode='42501'; end if;
    if not exists(select 1 from public.invoices i join public.companies c on c.id=i.company_id and c.archived_at is null where i.id=invoice_row.id and i.archived_at is null and i.tenant_id=private.current_tenant_id()) then raise exception 'Subscription invoice unavailable' using errcode='42501'; end if;
    return invoice_row;
  end if;
  perform private.require_subscription_write(private.current_tenant_id());


  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  join public.subscriptions as subscription
    on subscription.id = cycle.subscription_id
   and subscription.tenant_id = (select private.current_tenant_id())
  where cycle.id = p_cycle_id
  for update of cycle;
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
$function$
;
