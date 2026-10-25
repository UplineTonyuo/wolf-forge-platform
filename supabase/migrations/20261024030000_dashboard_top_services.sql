-- Read-only ranking using the executive dashboard's paid-invoice definition.
create or replace function public.app_dashboard_top_services(p_start timestamptz, p_end timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform public.app_require_module_access('dashboard');
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end <= p_start or p_end - p_start > interval '366 days' then
    raise exception 'invalid dashboard range' using errcode = '22023';
  end if;

  with invoice_paid as (
    select invoice_row.id,
      case when invoice_row.total_cents = 0 then invoice_row.issued_at
        else settled.last_settled_at end as paid_at
    from public.invoices as invoice_row
    left join lateral (
      select max(payment.settled_at) as last_settled_at
      from public.invoice_payments as payment
      where payment.invoice_id = invoice_row.id and payment.status = 'succeeded'
    ) as settled on true
    where invoice_row.archived_at is null and invoice_row.status = 'paid'
      and invoice_row.tenant_id = (select private.current_tenant_id())
      and (private.tenant_module_allowed(invoice_row.tenant_id, 'invoices')
        or private.invoice_record_visible(invoice_row.id))
  ), ranked as (
    select item.service_id,
      coalesce(service.name, max(item.name)) as name,
      count(distinct item.order_id) as paid_orders
    from public.invoice_items as item
    join invoice_paid as paid on paid.id = item.invoice_id
    left join public.services as service on service.id = item.service_id
      and service.tenant_id = (select private.current_tenant_id())
    where item.order_id is not null
      and (item.service_id is null or service.id is not null)
      and paid.paid_at >= p_start and paid.paid_at < p_end
    group by item.service_id, service.name, case when item.service_id is null then item.name end
    order by paid_orders desc, name, item.service_id
    limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'service_id', service_id, 'name', name, 'paid_orders', paid_orders
  ) order by paid_orders desc, name, service_id), '[]'::jsonb)
  into result from ranked;
  return result;
end;
$function$;

revoke all on function public.app_dashboard_top_services(timestamptz, timestamptz) from public, anon;
grant execute on function public.app_dashboard_top_services(timestamptz, timestamptz) to authenticated;
