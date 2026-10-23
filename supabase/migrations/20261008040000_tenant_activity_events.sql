-- WL-2.8 (KI-111, activity): activity_events belongs to a Tenant.
--
-- Concrete leak closed: activity_events had no Tenant, and its SELECT policy
-- (activity_events_internal_scoped_select) granted every Service / folder
-- event to any internal user with services.view, every coupon event to
-- coupons.view, and every event to a client_private admin, in any Tenant.
-- A Tenant B admin read Wolf Forge summaries such as "Created service X" with
-- their actor, entity id, timestamps and metadata. app_dashboard_overview
-- also counted every Tenant's Company status transitions.
--
-- Model (no new event architecture): activity_events.tenant_id, stamped by a
-- BEFORE INSERT trigger that ignores any supplied value. A Tenant-owned entity
-- gives its own row's tenant_id (order_task through its Order,
-- form_assignment / form_submission through their Form), so trusted /
-- background writers never depend on the KI-105 fallback. Profile events
-- (self-service, provisioning, permission administration) have no Tenant-owned
-- parent; they belong to the caller's validated current Tenant. An event whose
-- Tenant cannot be derived is refused. Every reader (the SELECT policy, the
-- dashboard Company status transitions) requires the current Tenant.
--
-- Backfill: each existing row takes its parent's Tenant. Rows without a
-- derivable parent (profile events, hard-deleted parents) predate any second
-- Tenant; they take Wolf Forge only while Wolf Forge is the only Tenant, and
-- the migration fails otherwise (hosted precheck: run before Tenant #2).
--
-- Not changed: notifications (KI-115), Companies RLS, coupons, the rest of
-- the dashboard aggregates.

create function private.activity_event_parent_tenant_id(p_entity_type text, p_entity_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select case p_entity_type
    when 'company' then (select tenant_id from public.companies where id = p_entity_id)
    when 'client_contact' then (select tenant_id from public.client_contacts where id = p_entity_id)
    when 'organization' then (select tenant_id from public.organizations where id = p_entity_id)
    when 'service_folder' then (select tenant_id from public.service_folders where id = p_entity_id)
    when 'service' then (select tenant_id from public.services where id = p_entity_id)
    when 'service_interest' then (select tenant_id from public.service_interests where id = p_entity_id)
    when 'order' then (select tenant_id from public.orders where id = p_entity_id)
    when 'order_task' then (select project.tenant_id from public.order_tasks as task
      join public.orders as project on project.id = task.order_id where task.id = p_entity_id)
    when 'coupon' then (select tenant_id from public.coupons where id = p_entity_id)
    when 'invoice' then (select tenant_id from public.invoices where id = p_entity_id)
    when 'subscription' then (select tenant_id from public.subscriptions where id = p_entity_id)
    when 'form' then (select tenant_id from public.forms where id = p_entity_id)
    when 'form_assignment' then (select form.tenant_id from public.form_assignments as assignment
      join public.forms as form on form.id = assignment.form_id where assignment.id = p_entity_id)
    when 'form_submission' then (select form.tenant_id from public.form_submissions as submission
      join public.forms as form on form.id = submission.form_id where submission.id = p_entity_id)
    when 'ticket' then (select tenant_id from public.tickets where id = p_entity_id)
    when 'client_report' then (select tenant_id from public.client_reports where id = p_entity_id)
  end;
$$;

revoke all on function private.activity_event_parent_tenant_id(text, uuid) from public, anon, authenticated;

create function private.stamp_activity_event_tenant()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.tenant_id := case
    when new.entity_type = 'profile' then private.current_tenant_id()
    else private.activity_event_parent_tenant_id(new.entity_type, new.entity_id)
  end;

  if new.tenant_id is null then
    raise exception 'activity event Tenant cannot be derived'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.stamp_activity_event_tenant() from public, anon, authenticated;

alter table public.activity_events
  add column tenant_id uuid
    constraint activity_events_tenant_id_fkey references public.tenants (id) on delete restrict;

-- The append-only guard blocks UPDATE; the backfill is the one sanctioned write.
alter table public.activity_events disable trigger activity_events_prevent_mutation;

update public.activity_events
set tenant_id = private.activity_event_parent_tenant_id(entity_type, entity_id)
where entity_type <> 'profile';

do $$
begin
  if exists (select 1 from public.activity_events where tenant_id is null)
    and exists (select 1 from public.tenants where id <> private.wolf_forge_tenant_id())
  then
    raise exception 'activity_events rows without a derivable Tenant exist alongside a second Tenant; review them before this migration';
  end if;
end;
$$;

update public.activity_events
set tenant_id = private.wolf_forge_tenant_id()
where tenant_id is null;

alter table public.activity_events enable trigger activity_events_prevent_mutation;

alter table public.activity_events alter column tenant_id set not null;

create index activity_events_tenant_created_at_idx
  on public.activity_events (tenant_id, created_at desc);

create trigger activity_events_stamp_tenant
  before insert on public.activity_events
  for each row execute function private.stamp_activity_event_tenant();

alter policy activity_events_internal_scoped_select on public.activity_events
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and ((select private.is_client_private_admin())
      or (entity_type = any (array['service', 'service_folder']) and public.app_has_permission('services.view'))
      or (entity_type = 'coupon' and (public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage')))
      or (entity_type = 'invoice' and (select private.can_read_invoice(activity_events.entity_id)))
      or (entity_type = 'subscription' and (select private.can_read_subscription(activity_events.entity_id)))
      or (entity_type = 'order' and (select private.can_access_operational_order(activity_events.entity_id)))
      or (entity_type = 'order_task' and (select private.can_access_operational_task(activity_events.entity_id)))));

-- Dashboard: Company status transitions of the current Tenant only.
create or replace function public.app_dashboard_overview(p_start timestamp with time zone, p_end timestamp with time zone, p_previous_start timestamp with time zone, p_previous_end timestamp with time zone, p_bucket text, p_time_zone text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
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
