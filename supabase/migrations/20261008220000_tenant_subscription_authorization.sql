-- Wolf Forge Platform
-- White Label WL-2.24: Tenant-relative subscription authorization.
--
-- Closes the WL-2.23 Group S defects. Global profile role/company authority
-- in the subscription domain is replaced with current-Tenant membership:
--
-- - private.can_read_subscription: an internal membership, or a same-company
--   client membership, of the Subscription's Tenant, with the existing
--   permission keys; the Subscription must belong to the selected Tenant
--   (D-272 pattern), so a foreign Subscription reads as missing.
-- - private.require_subscription_client_consistency: the client person must
--   hold an active client membership of the Subscription's company inside the
--   Subscription's Tenant. The (tenant_id, client_profile_id) composite key
--   stays as the backstop.
-- - private.subscription_actor_type: event actor label from the current-Tenant
--   membership account_class instead of the global role.
-- - The cycles / events / dunning SELECT policies require the parent
--   Subscription to belong to the selected Tenant. Payment methods were
--   already Tenant-scoped by 20261008060000.
-- - Every subscription mutation RPC resolves its target by id AND Tenant, so
--   a foreign Subscription or cycle is indistinguishable from a missing one.
--   That includes app_restore_subscription_cycle, the create / terms / cycle
--   request-replay branches, and the company / Service references resolved by
--   app_create_subscription.
-- - app_list_due_subscription_work reports work for the selected Tenant only.
--
-- Roles, permission presets, billing calculations, payments and the
-- Client/Company product model are unchanged.

-- -----------------------------------------------------------------------------
-- Read gate: current-Tenant membership instead of global profile role/company
-- -----------------------------------------------------------------------------

create or replace function private.can_read_subscription(p_subscription_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions as subscription_row
    join public.companies as company_row
      on company_row.id = subscription_row.company_id
     and company_row.archived_at is null
    where subscription_row.id = p_subscription_id
      and subscription_row.archived_at is null
      and subscription_row.tenant_id = (select private.current_tenant_id())
      and (
        (
          (select private.is_internal_user())
          and (
            private.current_user_has_permission('subscriptions.view')
            or private.current_user_has_permission('subscriptions.manage')
            or private.current_user_has_permission('subscriptions.billing')
          )
        )
        or (
          exists (
            select 1
            from public.tenant_memberships as client_membership
            where client_membership.tenant_id = subscription_row.tenant_id
              and client_membership.profile_id = (select auth.uid())
              and client_membership.account_class = 'client'
              and client_membership.archived_at is null
              and client_membership.company_id = subscription_row.company_id
          )
          and private.current_user_has_permission('subscriptions.view')
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Client consistency: client membership of the Subscription's Tenant
-- -----------------------------------------------------------------------------

create or replace function private.require_subscription_client_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_profile_id is not null and not exists (
    select 1
    from public.tenant_memberships as membership_row
    where membership_row.tenant_id = new.tenant_id
      and membership_row.profile_id = new.client_profile_id
      and membership_row.account_class = 'client'
      and membership_row.archived_at is null
      and membership_row.company_id = new.company_id
  ) then
    raise exception 'subscription client profile must be an active client in the subscription company'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Event actor label from current-Tenant membership
-- -----------------------------------------------------------------------------

create or replace function private.subscription_actor_type()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case membership_row.account_class when 'client' then 'client' else 'user' end
  from public.tenant_memberships as membership_row
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Child SELECT policies derive ownership from the parent Subscription
-- -----------------------------------------------------------------------------

alter policy subscription_cycles_internal_select on public.subscription_cycles
  using ((select private.is_internal_user())
    and (public.app_has_permission('subscriptions.view')
      or public.app_has_permission('subscriptions.manage')
      or public.app_has_permission('subscriptions.billing'))
    and exists (
      select 1
      from public.subscriptions as subscription_row
      where subscription_row.id = subscription_cycles.subscription_id
        and subscription_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy subscription_events_internal_select on public.subscription_events
  using ((select private.is_internal_user())
    and (public.app_has_permission('subscriptions.view')
      or public.app_has_permission('subscriptions.manage')
      or public.app_has_permission('subscriptions.billing'))
    and exists (
      select 1
      from public.subscriptions as subscription_row
      where subscription_row.id = subscription_events.subscription_id
        and subscription_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy subscription_dunning_attempts_internal_select on public.subscription_dunning_attempts
  using ((select private.is_internal_user())
    and public.app_has_permission('subscriptions.billing')
    and exists (
      select 1
      from public.subscription_cycles as cycle_row
      join public.subscriptions as subscription_row
        on subscription_row.id = cycle_row.subscription_id
      where cycle_row.id = subscription_dunning_attempts.cycle_id
        and subscription_row.tenant_id = (select private.current_tenant_id())
    ));

-- -----------------------------------------------------------------------------
-- Mutation RPCs resolve their target by id AND Tenant
-- -----------------------------------------------------------------------------

create or replace function public.app_update_subscription_terms(
  p_request_id uuid,
  p_subscription_id uuid,
  p_payload jsonb
)
returns public.subscription_plan_versions
language plpgsql
security definer
set search_path = ''
as $$
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
  if existing_id is not null then
    select plan.* into plan_row
    from public.subscription_plan_versions as plan
    join public.subscriptions as subscription on subscription.id = plan.subscription_id
    where plan.id = existing_id
      and subscription.tenant_id = (select private.current_tenant_id());
    if plan_row.id is null then raise no_data_found; end if;
    return plan_row;
  end if;

  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
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
$$;

create or replace function public.app_generate_subscription_cycle_invoice(
  p_request_id uuid,
  p_cycle_id uuid
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  request_payload jsonb := jsonb_build_object('cycle_id', p_cycle_id);
  existing_id uuid;
  cycle_row public.subscription_cycles;
  invoice_row public.invoices;
begin
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
    return invoice_row;
  end if;

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
$$;

create or replace function public.app_pause_subscription(
  p_subscription_id uuid,
  p_resumes_at date default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.pause');
  subscription_row public.subscriptions;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'paused' then return subscription_row; end if;
  if subscription_row.status not in ('active', 'past_due') then
    raise exception 'subscription cannot be paused from its current state' using errcode = '55000';
  end if;
  if p_resumes_at is not null and p_resumes_at <= current_date then
    raise exception 'subscription resume date must be in the future' using errcode = '22023';
  end if;

  update public.subscriptions
  set status = 'paused', paused_at = now(), resumes_at = p_resumes_at,
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'paused', jsonb_build_object('resumes_at', p_resumes_at)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.paused', 'Paused subscription.',
    jsonb_build_object('resumes_at', p_resumes_at)
  );
  return subscription_row;
end;
$$;

create or replace function public.app_resume_subscription(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.pause');
  subscription_row public.subscriptions;
  cycle_row public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  next_due date;
  next_end date;
  last_sequence integer;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'active' then return subscription_row; end if;
  if subscription_row.status <> 'paused' then
    raise exception 'only a paused subscription can be resumed' using errcode = '55000';
  end if;

  -- Enter active state inside this transaction so the shared next-cycle
  -- scheduler can be reused if the invoice settled while billing was paused.
  update public.subscriptions
  set status = 'active', paused_at = null, resumes_at = null,
      updated_by_profile_id = actor_id
  where id = p_subscription_id;

  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id
    and cycle.status in ('scheduled', 'invoiced', 'past_due')
  order by cycle.sequence desc
  limit 1
  for update;

  if cycle_row.id is null then
    select paid_cycle.* into cycle_row
    from public.subscription_cycles as paid_cycle
    where paid_cycle.subscription_id = p_subscription_id
      and paid_cycle.status = 'paid'
    order by paid_cycle.sequence desc
    limit 1;
    if cycle_row.id is not null then
      cycle_row := private.schedule_next_subscription_cycle(p_subscription_id, cycle_row.id);
    end if;
  end if;

  -- Wolf Forge resume policy: preserve the original calendar anchor, do not
  -- back-bill periods missed while paused, and retain every skipped cycle.
  if cycle_row.id is not null and cycle_row.status = 'scheduled'
    and cycle_row.due_on < current_date
  then
    update public.subscription_cycles
    set status = 'skipped', blocked_reason = 'skipped_while_paused'
    where id = cycle_row.id;
    last_sequence := cycle_row.sequence;
    next_due := cycle_row.period_end;

    select plan.* into plan_row
    from public.subscription_plan_versions as plan
    where plan.id = subscription_row.current_plan_version_id;

    while next_due < current_date loop
      next_due := private.subscription_add_interval(
        next_due, plan_row.interval_unit, plan_row.interval_count,
        plan_row.anchor_day, plan_row.end_of_month_policy
      );
    end loop;
    next_end := private.subscription_add_interval(
      next_due, plan_row.interval_unit, plan_row.interval_count,
      plan_row.anchor_day, plan_row.end_of_month_policy
    );
    perform private.schedule_subscription_cycle(
      p_subscription_id, plan_row.id, last_sequence + 1, next_due, next_end
    );
  end if;

  update public.subscriptions
  set status = 'active', paused_at = null, resumes_at = null,
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'resumed',
    jsonb_build_object('policy', 'preserve_anchor_skip_missed_periods')
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.resumed', 'Resumed subscription.',
    jsonb_build_object('policy', 'preserve_anchor_skip_missed_periods')
  );
  return subscription_row;
end;
$$;

create or replace function public.app_schedule_subscription_cancellation(
  p_subscription_id uuid,
  p_reason text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  effective_date date;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'subscription cancellation reason is too long' using errcode = '22023';
  end if;
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'pending_cancellation' then return subscription_row; end if;
  if subscription_row.status not in ('active', 'past_due') then
    raise exception 'subscription cancellation cannot be scheduled from its current state'
      using errcode = '55000';
  end if;

  select coalesce(
    (select max(cycle.period_end) from public.subscription_cycles as cycle
     where cycle.subscription_id = p_subscription_id and cycle.status = 'paid'),
    (select min(cycle.period_end) from public.subscription_cycles as cycle
     where cycle.subscription_id = p_subscription_id
       and cycle.status in ('scheduled', 'invoiced', 'past_due')),
    subscription_row.current_period_end
  ) into effective_date;
  if effective_date is null then
    raise exception 'subscription has no cancelable billing period' using errcode = '55000';
  end if;

  update public.subscription_cycles
  set status = 'skipped', blocked_reason = 'cancellation_scheduled'
  where subscription_id = p_subscription_id
    and status = 'scheduled'
    and due_on >= effective_date;

  update public.subscriptions
  set status = 'pending_cancellation', cancel_effective_at = effective_date,
      cancellation_reason = normalized_reason, paused_at = null, resumes_at = null,
      current_period_end = effective_date, updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'cancellation_scheduled',
    jsonb_build_object('effective_at', effective_date, 'reason', normalized_reason)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.cancellation_scheduled',
    'Scheduled subscription cancellation.',
    jsonb_build_object('effective_at', effective_date, 'reason', normalized_reason)
  );
  return subscription_row;
end;
$$;

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
    and subscription.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_cancel_subscription(
  p_subscription_id uuid,
  p_reason text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'subscription cancellation reason is too long' using errcode = '22023';
  end if;
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'canceled' then return subscription_row; end if;

  update public.subscription_cycles
  set status = 'skipped', blocked_reason = 'subscription_canceled'
  where subscription_id = p_subscription_id and status = 'scheduled';

  update public.subscriptions
  set status = 'canceled', canceled_at = now(), current_period_end = null,
      paused_at = null, resumes_at = null, cancel_effective_at = null,
      cancellation_reason = coalesce(normalized_reason, cancellation_reason),
      updated_by_profile_id = actor_id
  where id = p_subscription_id
  returning * into subscription_row;

  perform private.record_subscription_event(
    p_subscription_id, null, 'canceled',
    jsonb_build_object('mode', 'immediate', 'reason', subscription_row.cancellation_reason)
  );
  perform private.record_authenticated_activity(
    'subscription', p_subscription_id, 'subscription.canceled',
    'Canceled subscription.',
    jsonb_build_object('reason', subscription_row.cancellation_reason)
  );
  return subscription_row;
end;
$$;

create or replace function public.app_reconcile_subscription_state(p_subscription_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  subscription_row public.subscriptions;
  cycle_row public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  settled_timestamp timestamptz;
begin
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status = 'canceled' then return subscription_row; end if;

  if subscription_row.status = 'pending_cancellation'
    and subscription_row.cancel_effective_at <= current_date
  then
    update public.subscriptions
    set status = 'canceled', canceled_at = now(), current_period_end = null,
        cancel_effective_at = null, updated_by_profile_id = actor_id
    where id = p_subscription_id
    returning * into subscription_row;
    perform private.record_subscription_event(
      p_subscription_id, null, 'canceled', jsonb_build_object('mode', 'period_end')
    );
    return subscription_row;
  end if;

  if subscription_row.status = 'paused'
    and subscription_row.resumes_at is not null
    and subscription_row.resumes_at <= current_date
  then
    return public.app_resume_subscription(p_subscription_id);
  end if;

  select cycle.* into cycle_row
  from public.subscription_cycles as cycle
  where cycle.subscription_id = p_subscription_id
    and cycle.status in ('scheduled', 'invoiced', 'past_due', 'voided')
  order by cycle.sequence
  limit 1
  for update;
  if cycle_row.id is null then return subscription_row; end if;

  if cycle_row.invoice_id is not null then
    if exists (
      select 1 from public.invoices as invoice
      where invoice.id = cycle_row.invoice_id and invoice.status = 'paid'
    ) and cycle_row.status <> 'paid' then
      select max(payment.settled_at) into settled_timestamp
      from public.invoice_payments as payment
      where payment.invoice_id = cycle_row.invoice_id and payment.status = 'succeeded';
      update public.subscription_cycles
      set status = 'paid', settled_at = coalesce(settled_timestamp, now()),
          past_due_at = null, blocked_reason = null
      where id = cycle_row.id;
      if subscription_row.status = 'past_due' then
        update public.subscriptions
        set status = 'active', updated_by_profile_id = actor_id
        where id = p_subscription_id;
        perform private.record_subscription_event(
          p_subscription_id, cycle_row.id, 'recovered',
          jsonb_build_object('invoice_id', cycle_row.invoice_id)
        );
      end if;
      perform private.schedule_next_subscription_cycle(p_subscription_id, cycle_row.id);
    elsif exists (
      select 1 from public.invoices as invoice
      where invoice.id = cycle_row.invoice_id
        and (invoice.status = 'void' or invoice.archived_at is not null)
    ) and cycle_row.status <> 'voided' then
      update public.subscription_cycles
      set status = 'voided', blocked_reason = 'invoice_invalidated_requires_operator_action',
          settled_at = null
      where id = cycle_row.id;
      perform private.record_subscription_event(
        p_subscription_id, cycle_row.id, 'invoice_invalidated',
        jsonb_build_object('invoice_id', cycle_row.invoice_id)
      );
    elsif cycle_row.status in ('invoiced', 'past_due') then
      select plan.* into plan_row
      from public.subscription_plan_versions as plan where plan.id = cycle_row.plan_version_id;
      if current_date >= cycle_row.due_on + plan_row.grace_days
        and cycle_row.status <> 'past_due'
      then
        update public.subscription_cycles
        set status = 'past_due', past_due_at = now(), blocked_reason = 'unpaid_invoice'
        where id = cycle_row.id;
        if subscription_row.status = 'active' then
          update public.subscriptions
          set status = 'past_due', updated_by_profile_id = actor_id
          where id = p_subscription_id;
        end if;
        perform private.record_subscription_event(
          p_subscription_id, cycle_row.id, 'past_due',
          jsonb_build_object(
            'invoice_id', cycle_row.invoice_id,
            'due_on', cycle_row.due_on,
            'grace_days', plan_row.grace_days
          )
        );
      end if;
    end if;
  end if;

  select * into subscription_row from public.subscriptions where id = p_subscription_id;
  return subscription_row;
end;
$$;

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
  join public.subscriptions as subscription
    on subscription.id = cycle.subscription_id
   and subscription.tenant_id = (select private.current_tenant_id())
  where cycle.id = p_cycle_id
  for update;
  if cycle_row.id is null then raise no_data_found; end if;

  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = cycle_row.subscription_id
    and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_create_subscription(
  p_request_id uuid,
  p_payload jsonb
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.manage');
  existing_id uuid;
  subscription_row public.subscriptions;
  plan_row public.subscription_plan_versions;
  service_row public.services;
  interval_unit text;
  interval_count integer;
  anchor_day smallint;
  eom_policy text;
  billing_anchor date;
  period_end date;
  normalized_currency text;
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or not p_payload ?& array[
      'company_id', 'service_id', 'plan_source', 'billing_anchor',
      'interval_unit', 'interval_count', 'currency', 'recurring_action', 'items'
    ]
    or p_payload - array[
      'company_id', 'client_profile_id', 'service_id', 'plan_source',
      'billing_anchor', 'interval_unit', 'interval_count', 'end_of_month_policy',
      'currency', 'lead_days', 'grace_days', 'recurring_action',
      'request_limit_total', 'request_limit_active', 'items',
      'external_processor', 'external_processor_reference'
    ] <> '{}'::jsonb
  then
    raise exception 'invalid subscription create payload' using errcode = '22023';
  end if;

  existing_id := private.find_create_request(
    actor_id, 'subscription.create', p_request_id, p_payload
  );
  if existing_id is not null then
    select subscription.* into subscription_row
    from public.subscriptions as subscription
    where subscription.id = existing_id
      and subscription.tenant_id = (select private.current_tenant_id());
    if subscription_row.id is null then raise no_data_found; end if;
    return subscription_row;
  end if;

  if not exists (
    select 1 from public.companies as company_row
    where company_row.id = (p_payload ->> 'company_id')::uuid
      and company_row.archived_at is null
      and company_row.tenant_id = (select private.current_tenant_id())
  ) then raise no_data_found; end if;

  select service.* into service_row
  from public.services as service
  where service.id = (p_payload ->> 'service_id')::uuid
    and service.tenant_id = (select private.current_tenant_id())
    and service.is_active
    and service.archived_at is null;
  if service_row.id is null then
    raise exception 'subscription Service must be active' using errcode = '23514';
  end if;

  interval_unit := p_payload ->> 'interval_unit';
  interval_count := (p_payload ->> 'interval_count')::integer;
  eom_policy := coalesce(p_payload ->> 'end_of_month_policy', 'clamp');
  billing_anchor := (p_payload ->> 'billing_anchor')::date;
  normalized_currency := upper(p_payload ->> 'currency');
  anchor_day := case
    when interval_unit in ('month', 'year') then extract(day from billing_anchor)::smallint
    else null
  end;

  if p_payload ->> 'plan_source' not in ('admin_invoice', 'checkout', 'payment_link', 'service_purchase')
    or interval_unit not in ('day', 'week', 'month', 'year')
    or interval_count <= 0
    or eom_policy not in ('clamp', 'skip')
    or normalized_currency !~ '^[A-Z]{3}$'
    or coalesce((p_payload ->> 'lead_days')::integer, 5) not between 0 and 90
    or coalesce((p_payload ->> 'grace_days')::integer, 15) not between 0 and 365
    or p_payload ->> 'recurring_action' not in ('none', 'reopen_order', 'create_order', 'client_request')
  then
    raise exception 'invalid subscription create payload' using errcode = '22023';
  end if;

  period_end := private.subscription_add_interval(
    billing_anchor, interval_unit, interval_count, anchor_day, eom_policy
  );

  insert into public.subscriptions (
    company_id, client_profile_id, service_id, status, plan_source,
    billing_anchor, current_period_end, external_processor,
    external_processor_reference, created_by_profile_id, updated_by_profile_id
  ) values (
    (p_payload ->> 'company_id')::uuid,
    nullif(p_payload ->> 'client_profile_id', '')::uuid,
    service_row.id,
    'active',
    p_payload ->> 'plan_source',
    billing_anchor,
    period_end,
    nullif(btrim(p_payload ->> 'external_processor'), ''),
    nullif(btrim(p_payload ->> 'external_processor_reference'), ''),
    actor_id,
    actor_id
  ) returning * into subscription_row;

  insert into public.subscription_plan_versions (
    subscription_id, version, effective_from, interval_unit, interval_count,
    anchor_day, end_of_month_policy, currency, lead_days, grace_days,
    recurring_action, request_limit_total, request_limit_active,
    created_by_profile_id
  ) values (
    subscription_row.id, 1, billing_anchor, interval_unit, interval_count,
    anchor_day, eom_policy, normalized_currency,
    coalesce((p_payload ->> 'lead_days')::integer, 5),
    coalesce((p_payload ->> 'grace_days')::integer, 15),
    p_payload ->> 'recurring_action',
    (p_payload ->> 'request_limit_total')::integer,
    (p_payload ->> 'request_limit_active')::integer,
    actor_id
  ) returning * into plan_row;

  perform private.insert_subscription_plan_items(plan_row.id, p_payload -> 'items');

  update public.subscriptions
  set current_plan_version_id = plan_row.id
  where id = subscription_row.id
  returning * into subscription_row;

  perform private.schedule_subscription_cycle(
    subscription_row.id, plan_row.id, 1, billing_anchor, period_end
  );

  perform private.record_subscription_event(
    subscription_row.id, null, 'created',
    jsonb_build_object(
      'plan_version_id', plan_row.id,
      'service_id', subscription_row.service_id,
      'billing_anchor', subscription_row.billing_anchor
    )
  );
  perform private.record_authenticated_activity(
    'subscription', subscription_row.id, 'subscription.created',
    format('Created subscription %s.', subscription_row.public_ref),
    jsonb_build_object('company_id', subscription_row.company_id, 'plan_version_id', plan_row.id)
  );
  perform private.remember_create_request(
    actor_id, 'subscription.create', p_request_id, p_payload, subscription_row.id
  );

  select * into subscription_row from public.subscriptions where id = subscription_row.id;
  return subscription_row;
end;
$$;

create or replace function public.app_list_due_subscription_work(p_limit integer default 100)
returns table (
  subscription_id uuid,
  cycle_id uuid,
  work_type text,
  due_at date,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform private.require_subscription_capability('subscriptions.billing');
  return query
  select work.subscription_id, work.cycle_id, work.work_type, work.due_at, work.reason
  from (
    select
      cycle.subscription_id,
      cycle.id as cycle_id,
      'issue_invoice'::text as work_type,
      cycle.issue_on as due_at,
      'scheduled_cycle_due'::text as reason,
      1 as priority
    from public.subscription_cycles as cycle
    join public.subscriptions as subscription on subscription.id = cycle.subscription_id
    where cycle.status = 'scheduled'
      and cycle.invoice_id is null
      and cycle.issue_on <= current_date
      and subscription.status in ('active', 'pending_cancellation')
      and subscription.archived_at is null
      and subscription.tenant_id = (select private.current_tenant_id())

    union all

    select
      cycle.subscription_id,
      cycle.id,
      'reconcile'::text,
      cycle.due_on + plan.grace_days,
      'past_due_threshold'::text,
      2
    from public.subscription_cycles as cycle
    join public.subscription_plan_versions as plan on plan.id = cycle.plan_version_id
    join public.subscriptions as subscription on subscription.id = cycle.subscription_id
    where cycle.status = 'invoiced'
      and cycle.due_on + plan.grace_days <= current_date
      and subscription.archived_at is null
      and subscription.tenant_id = (select private.current_tenant_id())

    union all

    select
      cycle.subscription_id,
      cycle.id,
      'operator_action'::text,
      cycle.due_on,
      coalesce(cycle.blocked_reason, 'invalidated_invoice')::text,
      3
    from public.subscription_cycles as cycle
    join public.subscriptions as subscription on subscription.id = cycle.subscription_id
    where cycle.status = 'voided' and subscription.archived_at is null
      and subscription.tenant_id = (select private.current_tenant_id())

    union all

    select
      subscription.id,
      null::uuid,
      'reconcile'::text,
      subscription.resumes_at,
      'scheduled_resume'::text,
      1
    from public.subscriptions as subscription
    where subscription.status = 'paused'
      and subscription.resumes_at is not null
      and subscription.resumes_at <= current_date
      and subscription.archived_at is null
      and subscription.tenant_id = (select private.current_tenant_id())

    union all

    select
      subscription.id,
      null::uuid,
      'reconcile'::text,
      subscription.cancel_effective_at,
      'period_end_cancellation'::text,
      1
    from public.subscriptions as subscription
    where subscription.status = 'pending_cancellation'
      and subscription.cancel_effective_at <= current_date
      and subscription.archived_at is null
      and subscription.tenant_id = (select private.current_tenant_id())
  ) as work
  order by work.priority, work.due_at, work.subscription_id
  limit safe_limit;
end;
$$;
