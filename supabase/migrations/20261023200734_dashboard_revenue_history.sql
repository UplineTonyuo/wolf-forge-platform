create or replace function public.app_dashboard_history_start(p_currency text)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $function$
declare result timestamptz;
begin
  perform public.app_require_module_access('dashboard');
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid currency' using errcode = '22023';
  end if;
  select min(movement.at) into result from (
    select payment.invoice_id, payment.settled_at as at
    from public.invoice_payments as payment
    where payment.status = 'succeeded' and payment.currency = p_currency
    union all
    select refund.invoice_id, refund.refunded_at
    from public.invoice_refunds as refund
    where refund.status = 'succeeded' and refund.currency = p_currency
  ) as movement
  join public.invoices as invoice_row on invoice_row.id = movement.invoice_id
  where invoice_row.tenant_id = (select private.current_tenant_id())
    and (private.tenant_module_allowed(invoice_row.tenant_id, 'invoices')
      or private.invoice_record_visible(invoice_row.id));
  return result;
end;
$function$;
revoke all on function public.app_dashboard_history_start(text) from public, anon;
grant execute on function public.app_dashboard_history_start(text) to authenticated;
