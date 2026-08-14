-- A refund reverses settled money; it does not reopen a paid invoice for collection.
-- Keep gross/refund/net ledger values intact while reporting no balance due for the
-- paid lifecycle, including partially and fully refunded presentation states.
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
    case
      when invoice_row.status = 'paid' then 0::bigint
      else greatest(
        invoice_row.total_cents
          - greatest(payment_totals.gross_paid_cents - refund_totals.successful_refunds_cents, 0::bigint),
        0::bigint
      )
    end
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

comment on function public.app_get_invoice_financials(uuid) is
  'gross paid = successful payments; refunds = successful refunds; net paid = max(gross-refunds,0); paid invoices remain non-collectible after refunds and report zero balance due.';
