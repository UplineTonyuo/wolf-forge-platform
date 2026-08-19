-- Wolf Forge executive dashboard.
-- Owner/Admin-only aggregate read model over money, clients and subscriptions.
--
-- No new table, no new column, no backfill. Every figure is derived from data
-- the application already persists. The only mutation to existing data is the
-- single permission_modules UPDATE below.

-- =============================================================================
-- Capability
--
-- dashboard.view already exists and is granted to manager, staff AND client.
-- It is also the required capability for BOTH the internal 'dashboard' module
-- and the client portal's 'portal_dashboard' module, and its description is
-- deliberately generic: "View the dashboard available to the current account."
--
-- Reusing it would either leak executive metrics to manager/staff or break the
-- client portal. The executive dashboard therefore gets its own capability.
-- =============================================================================

insert into public.permissions (permission_key, category, label, description)
values (
  'dashboard.executive_view',
  'dashboard',
  'View executive dashboard',
  'View company-wide revenue, client and subscription metrics.'
)
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

-- Owner needs no grant: private.profile_has_permission short-circuits the owner
-- preset to true for every registered permission. Admin does need one — the
-- owner/admin cross join in the roles foundation ran once, at that migration's
-- point in time, so every capability added since has had to grant explicitly.
insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'dashboard.executive_view', true
from public.roles as role_row
where role_row.name = 'admin'
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- Repoint the internal module only. The 'portal_dashboard' row keeps
-- dashboard.view, so the client portal is untouched. Manager and staff lose a
-- module flag that no route has ever consumed.
update public.permission_modules
set required_permission_key = 'dashboard.executive_view',
    updated_at = now()
where module_key = 'dashboard'
  and account_class = 'internal';

-- =============================================================================
-- Indexes
--
-- Every existing index on these two tables leads with invoice_id, so a scan by
-- settlement time — the dashboard's single most common access pattern — has no
-- usable index at all. Partial, because unsettled rows are never aggregated.
--
-- Deliberately NOT added: companies(created_at), subscriptions(started_at), and
-- any JSONB path index on activity_events. Those tables are small and
-- activity_events_created_at_idx already covers the range scan.
-- =============================================================================

create index if not exists invoice_payments_settled_at_idx
on public.invoice_payments (settled_at)
where status = 'succeeded';

create index if not exists invoice_refunds_refunded_at_idx
on public.invoice_refunds (refunded_at)
where status = 'succeeded';

-- =============================================================================
-- Aggregate read model
--
-- One function, one round trip, one MVCC snapshot. Separate queries could let a
-- payment land mid-load and leave revenue disagreeing with paid orders.
-- =============================================================================

create or replace function public.app_dashboard_overview(
  p_start          timestamptz,
  p_end            timestamptz,
  p_previous_start timestamptz,
  p_previous_end   timestamptz,
  p_bucket         text,
  p_time_zone      text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    union all
    select 'current', refund.currency, 0::bigint, refund.amount_cents::bigint
    from public.invoice_refunds as refund
    where refund.status = 'succeeded'
      and refund.refunded_at >= p_start
      and refund.refunded_at < p_end
    union all
    select 'previous', payment.currency, payment.amount_cents::bigint, 0::bigint
    from public.invoice_payments as payment
    where payment.status = 'succeeded'
      and payment.settled_at >= p_previous_start
      and payment.settled_at < p_previous_end
    union all
    select 'previous', refund.currency, 0::bigint, refund.amount_cents::bigint
    from public.invoice_refunds as refund
    where refund.status = 'succeeded'
      and refund.refunded_at >= p_previous_start
      and refund.refunded_at < p_previous_end
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
    union all
    select
      refund.currency,
      date_trunc(p_bucket, refund.refunded_at at time zone p_time_zone),
      -refund.amount_cents::bigint
    from public.invoice_refunds as refund
    where refund.status = 'succeeded'
      and refund.refunded_at >= p_start
      and refund.refunded_at < p_end
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
$$;

comment on function public.app_dashboard_overview(
  timestamptz, timestamptz, timestamptz, timestamptz, text, text
) is
  'Owner/Admin executive metrics for a half-open [start, end) window. Revenue is cash collected net of refunds, grouped by currency and never summed across them; paid orders counts orders on fully paid invoices only, so the two figures answer different questions and do not reconcile 1:1.';

revoke all on function public.app_dashboard_overview(
  timestamptz, timestamptz, timestamptz, timestamptz, text, text
) from public, anon, service_role;

grant execute on function public.app_dashboard_overview(
  timestamptz, timestamptz, timestamptz, timestamptz, text, text
) to authenticated;
