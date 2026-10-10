
create function private.require_subscription_write(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_tenant_module_lifecycle(p_tenant_id);
  if auth.uid() is null and not exists (select 1 from private.tenant_module_publications where tenant_id=p_tenant_id) then return; end if;
  if not private.tenant_module_allowed(p_tenant_id,'subscriptions') then
    raise exception 'Subscriptions new work is unavailable' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_subscription_write(uuid) from public,anon,authenticated,service_role;

create function private.enforce_subscription_module_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.subscriptions; cycle public.subscription_cycles; invoice public.invoices;
begin
  if tg_op='DELETE' then
    if tg_table_name='subscriptions' then parent:=old;
    elsif tg_table_name='subscription_plan_items' then select s.* into parent from public.subscription_plan_versions p join public.subscriptions s on s.id=p.subscription_id where p.id=old.plan_version_id;
    elsif tg_table_name='subscription_dunning_attempts' then select s.* into parent from public.subscription_cycles c join public.subscriptions s on s.id=c.subscription_id where c.id=old.cycle_id;
    else select * into parent from public.subscriptions where id=old.subscription_id; end if;
    perform private.require_subscription_write(parent.tenant_id);
    return old;
  end if;
  if tg_table_name='subscriptions' then parent:=new;
  elsif tg_table_name='subscription_plan_items' then
    select s.* into parent from public.subscription_plan_versions p join public.subscriptions s on s.id=p.subscription_id where p.id=new.plan_version_id;
  elsif tg_table_name='subscription_dunning_attempts' then
    select s.* into parent from public.subscription_cycles c join public.subscriptions s on s.id=c.subscription_id where c.id=new.cycle_id;
  else select * into parent from public.subscriptions where id=new.subscription_id;
  end if;
  if parent.id is null then raise exception 'Subscription parent unavailable' using errcode='23503'; end if;
  perform private.lock_tenant_module_lifecycle(parent.tenant_id);
  if auth.uid() is null and not exists (select 1 from private.tenant_module_publications where tenant_id=parent.tenant_id) then return new; end if;
  if private.tenant_module_allowed(parent.tenant_id,'subscriptions') then return new; end if;
  if tg_table_name='subscription_events' and tg_op='UPDATE' and pg_trigger_depth()>1 then
    if old.actor_profile_id is not null and new.actor_profile_id is null
      and (to_jsonb(new)-'actor_profile_id')=(to_jsonb(old)-'actor_profile_id') then return new; end if;
  end if;
  if private.is_internal_user() and parent.tenant_id=private.current_tenant_id()
    and private.current_user_has_permission('subscriptions.cancel') then
    if tg_table_name='subscription_cycles' and tg_op='UPDATE' then
      if old.status='scheduled' and new.status='skipped' and new.blocked_reason='subscription_canceled'
        and (to_jsonb(new)-array['status','blocked_reason','updated_at'])=(to_jsonb(old)-array['status','blocked_reason','updated_at']) then return new; end if;
    elsif tg_table_name='subscription_events' and tg_op='INSERT' then
      if parent.status='canceled' and new.event_type='canceled' and new.cycle_id is null
        and new.actor_profile_id=auth.uid() and new.payload=jsonb_build_object('mode','immediate','reason',parent.cancellation_reason) then return new; end if;
    end if;
  end if;
  if tg_table_name='subscriptions' and tg_op='UPDATE' then
    if new.status='canceled' and old.status<>'canceled'
      and new.tenant_id=old.tenant_id and new.company_id=old.company_id
      and (to_jsonb(new)-array['status','canceled_at','current_period_end','paused_at','resumes_at','cancel_effective_at','cancellation_reason','updated_by_profile_id','updated_at'])
        =(to_jsonb(old)-array['status','canceled_at','current_period_end','paused_at','resumes_at','cancel_effective_at','cancellation_reason','updated_by_profile_id','updated_at'])
      and parent.tenant_id=private.current_tenant_id() and private.is_internal_user()
      and private.current_user_has_permission('subscriptions.cancel') then return new; end if;
  end if;
  if parent.status='canceled' and pg_trigger_depth()>1 then
    if tg_table_name='subscription_cycles' and tg_op='UPDATE' then
      select * into invoice from public.invoices where id=old.invoice_id and tenant_id=parent.tenant_id and company_id=parent.company_id;
      if invoice.id is not null and new.invoice_id=old.invoice_id and new.subscription_id=old.subscription_id
        and (to_jsonb(new)-array['status','settled_at','past_due_at','blocked_reason','fulfillment_status','fulfillment_metadata','updated_at'])
          =(to_jsonb(old)-array['status','settled_at','past_due_at','blocked_reason','fulfillment_status','fulfillment_metadata','updated_at'])
        and ((invoice.status='paid' and new.status='paid') or ((invoice.status='void' or invoice.archived_at is not null) and new.status='voided')) then return new; end if;
    elsif tg_table_name='subscription_events' and tg_op='INSERT' then
      select * into cycle from public.subscription_cycles where id=new.cycle_id and subscription_id=parent.id;
      select * into invoice from public.invoices where id=cycle.invoice_id and tenant_id=parent.tenant_id and company_id=parent.company_id;
      if invoice.id is not null and (
        (invoice.status='paid' and cycle.status='paid' and new.event_type in ('payment_settled','fulfillment_pending'))
        or ((invoice.status='void' or invoice.archived_at is not null) and cycle.status='voided' and new.event_type='invoice_invalidated')
        or (new.event_type='payment_failed' and exists (select 1 from public.invoice_payments p where p.id=(new.payload->>'invoice_payment_id')::uuid and p.invoice_id=invoice.id and p.status='failed'))
      ) then return new; end if;
    end if;
  end if;
  raise exception 'Subscriptions new work is unavailable' using errcode='42501';
end;
$$;
revoke all on function private.enforce_subscription_module_write() from public,anon,authenticated,service_role;

create function public.app_subscriptions_work_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_account_class() is null or not (
    private.current_user_has_permission('subscriptions.view') or private.current_user_has_permission('subscriptions.manage')
    or private.current_user_has_permission('subscriptions.billing') or private.current_user_has_permission('subscriptions.pause')
    or private.current_user_has_permission('subscriptions.cancel')) then
    raise exception 'Subscription access is denied' using errcode='42501';
  end if;
  return private.tenant_module_allowed(private.current_tenant_id(),'subscriptions');
end;
$$;
revoke all on function public.app_subscriptions_work_enabled() from public,anon,authenticated,service_role;
grant execute on function public.app_subscriptions_work_enabled() to authenticated;

create function private.subscription_history_policy_allows(p_subscription_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select (
  private.tenant_module_allowed(private.current_tenant_id(),'subscriptions')
  and (private.current_user_has_permission('subscriptions.view') or private.current_user_has_permission('subscriptions.manage')
    or private.current_user_has_permission('subscriptions.billing') or private.is_client_private_admin())
) or private.can_read_subscription(p_subscription_id);
$$;
revoke all on function private.subscription_history_policy_allows(uuid) from public,anon,authenticated,service_role;
grant execute on function private.subscription_history_policy_allows(uuid) to authenticated;

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
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects', 'tickets', 'subscriptions') and not (catalog.module_key = any(p_keys))
    ), false);
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
  if tenant_status <> 'active' then
    raise exception 'Tenant is not active' using errcode = '55000';
  end if;
  if not private.published_module_set_valid(new.module_keys) then
    raise exception 'invalid or unsupported published module set' using errcode = '22023';
  end if;
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

CREATE OR REPLACE FUNCTION private.can_read_subscription(p_subscription_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.subscriptions as subscription_row
    join public.companies as company_row
      on company_row.id = subscription_row.company_id
     and company_row.archived_at is null
    where subscription_row.id = p_subscription_id
      and subscription_row.archived_at is null
      and (private.tenant_module_allowed(subscription_row.tenant_id,'subscriptions') or subscription_row.status='canceled')
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
$function$;

CREATE OR REPLACE FUNCTION public.app_create_subscription(p_request_id uuid, p_payload jsonb)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
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
    if not private.can_read_subscription(subscription_row.id) then raise exception 'Subscription access is denied' using errcode='42501'; end if;
    return subscription_row;
  end if;
  perform private.require_subscription_write(private.current_tenant_id());


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
    if not private.can_read_subscription(plan_row.subscription_id) then raise exception 'Subscription access is denied' using errcode='42501'; end if;
    return plan_row;
  end if;
  perform private.require_subscription_write(private.current_tenant_id());


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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.app_pause_subscription(p_subscription_id uuid, p_resumes_at date DEFAULT NULL::date)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.pause');
  subscription_row public.subscriptions;
begin
  perform private.require_subscription_write(private.current_tenant_id());
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
$function$;

CREATE OR REPLACE FUNCTION public.app_resume_subscription(p_subscription_id uuid)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.pause');
  subscription_row public.subscriptions;
  cycle_row public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  next_due date;
  next_end date;
  last_sequence integer;
begin
  perform private.require_subscription_write(private.current_tenant_id());
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
$function$;

CREATE OR REPLACE FUNCTION public.app_schedule_subscription_cancellation(p_subscription_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  effective_date date;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  perform private.require_subscription_write(private.current_tenant_id());
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
$function$;

CREATE OR REPLACE FUNCTION public.app_remove_subscription_cancellation(p_subscription_id uuid)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  retained_cycle public.subscription_cycles;
  last_paid_cycle public.subscription_cycles;
begin
  perform private.require_subscription_write(private.current_tenant_id());
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
$function$;

CREATE OR REPLACE FUNCTION public.app_restore_subscription_cycle(p_cycle_id uuid)
 RETURNS subscription_cycles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  cycle_row public.subscription_cycles;
  subscription_row public.subscriptions;
  invalidated_invoice public.invoices;
  invalidated_invoice_id uuid;
  original_sequence integer;
  original_idempotency_key text;
begin
  perform private.require_subscription_write(private.current_tenant_id());
  perform 1 from public.subscriptions s join public.subscription_cycles c on c.subscription_id=s.id where c.id=p_cycle_id and s.tenant_id=private.current_tenant_id() for update of s;
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
$function$;

CREATE OR REPLACE FUNCTION public.app_cancel_subscription(p_subscription_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.cancel');
  subscription_row public.subscriptions;
  normalized_reason text := nullif(btrim(p_reason), '');
begin
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'subscription cancellation reason is too long' using errcode = '22023';
  end if;
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if not private.tenant_module_allowed(subscription_row.tenant_id,'subscriptions') and not exists(select 1 from public.companies c where c.id=subscription_row.company_id and c.tenant_id=subscription_row.tenant_id and c.archived_at is null) then raise exception 'Subscription access is denied' using errcode='42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.app_reconcile_subscription_state(p_subscription_id uuid)
 RETURNS subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_subscription_capability('subscriptions.billing');
  subscription_row public.subscriptions;
  cycle_row public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  settled_timestamp timestamptz;
begin
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id and subscription.archived_at is null
    and subscription.tenant_id = (select private.current_tenant_id())
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if not private.tenant_module_allowed(subscription_row.tenant_id,'subscriptions') and not exists(select 1 from public.companies c where c.id=subscription_row.company_id and c.tenant_id=subscription_row.tenant_id and c.archived_at is null) then raise exception 'Subscription access is denied' using errcode='42501'; end if;
  if subscription_row.status = 'canceled' then return subscription_row; end if;
  perform private.require_subscription_write(private.current_tenant_id());


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
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION private.schedule_subscription_cycle(p_subscription_id uuid, p_plan_version_id uuid, p_sequence integer, p_due_on date, p_period_end date)
 RETURNS subscription_cycles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  plan_row public.subscription_plan_versions;
  cycle_row public.subscription_cycles;
begin
  perform private.require_subscription_write((select tenant_id from public.subscriptions where id=p_subscription_id));
  select plan.* into plan_row
  from public.subscription_plan_versions as plan
  where plan.id = p_plan_version_id
    and plan.subscription_id = p_subscription_id;
  if plan_row.id is null then raise no_data_found; end if;

  insert into public.subscription_cycles (
    subscription_id, plan_version_id, sequence, period_start, period_end,
    due_on, issue_on, idempotency_key, fulfillment_action
  ) values (
    p_subscription_id,
    p_plan_version_id,
    p_sequence,
    p_due_on,
    p_period_end,
    p_due_on,
    p_due_on - plan_row.lead_days,
    p_subscription_id::text || ':' || p_sequence::text,
    plan_row.recurring_action
  ) returning * into cycle_row;

  update public.subscriptions
  set current_period_end = p_period_end
  where id = p_subscription_id;

  perform private.record_subscription_event(
    p_subscription_id,
    cycle_row.id,
    'cycle_scheduled',
    jsonb_build_object(
      'sequence', cycle_row.sequence,
      'due_on', cycle_row.due_on,
      'issue_on', cycle_row.issue_on,
      'plan_version_id', cycle_row.plan_version_id
    )
  );
  return cycle_row;
end;
$function$;

CREATE OR REPLACE FUNCTION private.schedule_next_subscription_cycle(p_subscription_id uuid, p_previous_cycle_id uuid)
 RETURNS subscription_cycles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  subscription_row public.subscriptions;
  previous_cycle public.subscription_cycles;
  plan_row public.subscription_plan_versions;
  next_end date;
  cycle_row public.subscription_cycles;
begin
  perform private.lock_tenant_module_lifecycle((select tenant_id from public.subscriptions where id=p_subscription_id));
  select subscription.* into subscription_row
  from public.subscriptions as subscription
  where subscription.id = p_subscription_id
  for update;
  if subscription_row.id is null then raise no_data_found; end if;
  if subscription_row.status <> 'active' then return null; end if;
  perform private.require_subscription_write(private.current_tenant_id());


  select cycle.* into previous_cycle
  from public.subscription_cycles as cycle
  where cycle.id = p_previous_cycle_id
    and cycle.subscription_id = p_subscription_id;
  if previous_cycle.id is null then raise no_data_found; end if;

  if exists (
    select 1 from public.subscription_cycles as open_cycle
    where open_cycle.subscription_id = p_subscription_id
      and open_cycle.status in ('scheduled', 'invoiced', 'past_due')
  ) then
    select * into cycle_row
    from public.subscription_cycles as open_cycle
    where open_cycle.subscription_id = p_subscription_id
      and open_cycle.status in ('scheduled', 'invoiced', 'past_due')
    order by open_cycle.sequence
    limit 1;
    return cycle_row;
  end if;

  select plan.* into plan_row
  from public.subscription_plan_versions as plan
  where plan.subscription_id = p_subscription_id
    and plan.effective_from <= previous_cycle.period_end
  order by plan.effective_from desc, plan.version desc
  limit 1;
  if plan_row.id is null then raise no_data_found; end if;

  next_end := private.subscription_add_interval(
    previous_cycle.period_end,
    plan_row.interval_unit,
    plan_row.interval_count,
    plan_row.anchor_day,
    plan_row.end_of_month_policy
  );

  return private.schedule_subscription_cycle(
    p_subscription_id,
    plan_row.id,
    previous_cycle.sequence + 1,
    previous_cycle.period_end,
    next_end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_list_due_subscription_work(p_limit integer DEFAULT 100)
 RETURNS TABLE(subscription_id uuid, cycle_id uuid, work_type text, due_at date, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform private.require_subscription_capability('subscriptions.billing');
  if not private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') then return; end if;
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
$function$;

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
  if exists(select 1 from public.subscription_cycles c join public.invoices i on i.id=c.invoice_id where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id()) then
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  end if;
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
    return payment_row;
  end if;

  payment_row := private.settle_invoice_payment(
    actor_id, p_request_id, p_invoice_id, p_amount_cents, p_status,
    p_payment_method, p_processor, p_processor_reference
  );

  perform private.remember_create_request(
    actor_id, 'invoice.payment.record', p_request_id, request_payload, payment_row.id
  );
  return payment_row;
end;
$function$;

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
  if exists(select 1 from public.subscription_cycles c join public.invoices i on i.id=c.invoice_id where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id()) then
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  end if;
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
    return refund_row;
  end if;

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
  if exists(select 1 from public.subscription_cycles c join public.invoices i on i.id=c.invoice_id where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id()) then
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  end if;
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
    return query select payment_row.id, wallet_transaction_row.id,
      wallet_transaction_row.balance_after_cents, amounts.balance_due_cents;
    return;
  end if;

  -- C2-3. Frequency-bound the money rail itself. This sits AFTER the
  -- idempotent replay short-circuit, so retrying the same request id is
  -- answered from the request log and consumes no allowance (D-085), and
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
$function$;

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
  if exists(select 1 from public.subscription_cycles c join public.invoices i on i.id=c.invoice_id where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id()) then
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  end if;
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
$function$;

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
  if exists(select 1 from public.subscription_cycles c join public.invoices i on i.id=c.invoice_id where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id()) then
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  end if;
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
$function$;

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
  if exists(select 1 from public.subscription_cycles c join public.invoices i on i.id=c.invoice_id where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id()) then
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  end if;
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
$function$;

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
$function$;

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
$function$;

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
$function$;

create policy subscription_cycles_published_history on public.subscription_cycles as restrictive for select to authenticated using (private.subscription_history_policy_allows(subscription_id));

create policy subscription_events_published_history on public.subscription_events as restrictive for select to authenticated using (private.subscription_history_policy_allows(subscription_id));

create policy subscription_payment_methods_published_history on public.subscription_payment_methods as restrictive for select to authenticated using (private.subscription_history_policy_allows(subscription_id));
create policy subscription_dunning_published_history on public.subscription_dunning_attempts as restrictive for select to authenticated using (exists(select 1 from public.subscription_cycles c where c.id=cycle_id and private.subscription_history_policy_allows(c.subscription_id)));
create policy activity_events_published_subscriptions on public.activity_events as restrictive for select to authenticated using(entity_type<>'subscription' or private.subscription_history_policy_allows(entity_id));
create trigger subscriptions_published_write before insert or update or delete on public.subscriptions for each row execute function private.enforce_subscription_module_write();
create trigger subscription_plan_versions_published_write before insert or update or delete on public.subscription_plan_versions for each row execute function private.enforce_subscription_module_write();
create trigger subscription_plan_items_published_write before insert or update or delete on public.subscription_plan_items for each row execute function private.enforce_subscription_module_write();
create trigger subscription_cycles_published_write before insert or update or delete on public.subscription_cycles for each row execute function private.enforce_subscription_module_write();
create trigger subscription_events_published_write before insert or update or delete on public.subscription_events for each row execute function private.enforce_subscription_module_write();
create trigger subscription_payment_methods_published_write before insert or update or delete on public.subscription_payment_methods for each row execute function private.enforce_subscription_module_write();
create trigger subscription_dunning_attempts_published_write before insert or update or delete on public.subscription_dunning_attempts for each row execute function private.enforce_subscription_module_write();
