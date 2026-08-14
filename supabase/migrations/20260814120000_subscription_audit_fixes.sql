-- Wolf Forge Platform - targeted Subscription audit fixes
--
-- Invoice remains the financial authority. These changes repair lifecycle
-- transitions, add an operator-safe void recovery path, and preserve every
-- historical cycle and invoice.

-- An active subscription may not contradict its authoritative open past-due
-- cycle and invoice. Keeping this at the row boundary protects every lifecycle
-- caller without copying invoice balances or payment state into subscriptions.
create or replace function private.enforce_subscription_past_due_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and exists (
    select 1
    from public.subscription_cycles as cycle
    join public.invoices as invoice on invoice.id = cycle.invoice_id
    where cycle.subscription_id = new.id
      and cycle.status = 'past_due'
      and invoice.status in ('unpaid', 'payment_pending')
      and invoice.archived_at is null
  ) then
    new.status := 'past_due';
  end if;

  return new;
end;
$$;

create trigger subscriptions_enforce_past_due_invariant
before update of status on public.subscriptions
for each row execute function private.enforce_subscription_past_due_invariant();

-- Cancellation scheduling retains the next historical cycle as skipped. Undo
-- that transition in place so sequence and idempotency identities are reused,
-- rather than attempting to insert the same sequence a second time.
create or replace function public.app_remove_subscription_cancellation(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  retained_cycle public.subscription_cycles;
  last_paid_cycle public.subscription_cycles;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'active' then return subscription_row; end if;
  if subscription_row.status <> 'pending_cancellation' then
    raise exception 'subscription has no scheduled cancellation' using errcode = '55000';
  end if;

  select cycle.* into retained_cycle
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id
    and cycle.status = 'skipped'
    and cycle.blocked_reason = 'cancellation_scheduled'
  order by cycle.sequence desc
  limit 1
  for update;

  if retained_cycle.id is not null then
    update public.subscription_cycles
    set status = 'scheduled', blocked_reason = null
    where id = retained_cycle.id
    returning * into retained_cycle;
  end if;

  update public.subscriptions
  set status = 'active',
      cancel_effective_at = null,
      cancellation_reason = null,
      current_period_end = coalesce(retained_cycle.period_end, current_period_end),
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  if retained_cycle.id is null then
    select cycle.* into last_paid_cycle
    from public.subscription_cycles as cycle
    where cycle.subscription_id = p_subscription_id and cycle.status = 'paid'
    order by cycle.sequence desc
    limit 1;

    if last_paid_cycle.id is not null then
      perform private.schedule_next_subscription_cycle(p_subscription_id, last_paid_cycle.id);
    end if;
  end if;

  perform private.record_subscription_event(
    p_subscription_id,
    retained_cycle.id,
    'cancellation_removed',
    jsonb_build_object('retained_cycle_restored', retained_cycle.id is not null)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.cancellation_removed',
    'Removed scheduled subscription cancellation.'
  );

  select * into subscription_row
  from public.subscriptions
  where id = p_subscription_id;
  return subscription_row;
end;
$$;

-- A voided invoice cannot be made collectible again. An authorized operator
-- may instead restore the same durable cycle identity to scheduled state. The
-- void invoice remains immutable history and is linked by both invalidation and
-- restoration events; a replacement invoice can then be generated exactly once.
alter table public.subscription_events
  drop constraint subscription_events_type_valid;
alter table public.subscription_events
  add constraint subscription_events_type_valid check (
    event_type in (
      'created', 'cycle_scheduled', 'invoice_generated', 'payment_settled',
      'payment_failed', 'past_due', 'recovered', 'paused', 'resumed',
      'cancellation_scheduled', 'cancellation_removed', 'canceled',
      'terms_changed', 'invoice_invalidated', 'cycle_restored',
      'fulfillment_pending'
    )
  );

create or replace function public.app_restore_subscription_cycle(p_cycle_id uuid)
returns public.subscription_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  cycle_row public.subscription_cycles;
  subscription_row public.subscriptions;
  invalidated_invoice public.invoices;
  invalidated_invoice_id uuid;
  original_sequence integer;
  original_idempotency_key text;
begin
  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.id = p_cycle_id
  for update;
  if cycle_row.id is null then raise no_data_found; end if;

  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = cycle_row.subscription_id
    and subscription.archived_at is null
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if cycle_row.status <> 'voided' then
    raise exception 'only a voided subscription cycle can be restored'
      using errcode = '55000';
  end if;
  if subscription_row.status not in ('active', 'past_due') then
    raise exception 'subscription lifecycle blocks cycle restoration'
      using errcode = '55000';
  end if;

  select invoice.* into invalidated_invoice
  from public.invoices as invoice
  where invoice.id = cycle_row.invoice_id;
  if invalidated_invoice.id is null then raise no_data_found; end if;
  if invalidated_invoice.status <> 'void' and invalidated_invoice.archived_at is null then
    raise exception 'subscription cycle invoice is not invalidated'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.subscription_cycles as open_cycle
    where open_cycle.subscription_id = cycle_row.subscription_id
      and open_cycle.id <> cycle_row.id
      and open_cycle.status in ('scheduled', 'invoiced', 'past_due')
  ) then
    raise exception 'subscription already has an open billing cycle'
      using errcode = '55000';
  end if;

  invalidated_invoice_id := cycle_row.invoice_id;
  original_sequence := cycle_row.sequence;
  original_idempotency_key := cycle_row.idempotency_key;

  update public.subscription_cycles
  set status = 'scheduled',
      invoice_id = null,
      generated_at = null,
      settled_at = null,
      past_due_at = null,
      blocked_reason = null,
      fulfillment_status = 'not_ready',
      fulfillment_metadata = '{}'::jsonb
  where id = cycle_row.id
  returning * into cycle_row;

  if cycle_row.sequence <> original_sequence
    or cycle_row.idempotency_key <> original_idempotency_key
  then
    raise exception 'subscription cycle identity changed during restoration'
      using errcode = '55000';
  end if;

  update public.subscriptions
  set status = 'active',
      current_period_end = cycle_row.period_end,
      updated_by_profile_id = actor_id
  where id = subscription_row.id;

  perform private.record_subscription_event(
    subscription_row.id,
    cycle_row.id,
    'cycle_restored',
    jsonb_build_object(
      'invalidated_invoice_id', invalidated_invoice_id,
      'sequence', cycle_row.sequence,
      'idempotency_key', cycle_row.idempotency_key
    )
  );
  perform private.record_authenticated_activity(
    'subscription', subscription_row.id, 'subscription.cycle_restored',
    'Restored a voided subscription billing cycle for safe invoice replacement.',
    jsonb_build_object(
      'cycle_id', cycle_row.id,
      'invalidated_invoice_id', invalidated_invoice_id
    )
  );

  return cycle_row;
end;
$$;

revoke all on function private.enforce_subscription_past_due_invariant()
from public, anon, authenticated, service_role;
revoke all on function public.app_restore_subscription_cycle(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.app_restore_subscription_cycle(uuid) to authenticated;

comment on function public.app_restore_subscription_cycle(uuid) is
  'Operator-safe recovery for a voided cycle: preserves its sequence and idempotency identity while retaining the invalidated invoice as history.';
