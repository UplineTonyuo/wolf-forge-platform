-- Coupons OFF preserves recorded money; only new Coupon effects use this guard.
create function private.require_coupon_write(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_tenant_id is null then raise exception 'Coupon access is denied' using errcode='42501'; end if;
  perform private.lock_tenant_module_lifecycle(p_tenant_id);
  if not private.tenant_module_allowed(p_tenant_id,'coupons') then
    raise exception 'WF_COUPONS_DISABLED' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_coupon_write(uuid) from public,anon,authenticated,service_role;

create function private.enforce_coupon_module_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; tenant_id uuid; old_tenant uuid;
begin
  if tg_op='DELETE' then row_data:=to_jsonb(old); else row_data:=to_jsonb(new); end if;
  if tg_table_name in ('coupons','coupon_redemptions') then
    tenant_id:=(row_data->>'tenant_id')::uuid;
  elsif tg_table_name='coupon_discount_rules' then
    select c.tenant_id into tenant_id from public.coupons c where c.id=(row_data->>'coupon_id')::uuid;
  else
    select c.tenant_id into tenant_id from public.coupon_discount_rules r join public.coupons c on c.id=r.coupon_id
      where r.id=(row_data->>'coupon_discount_rule_id')::uuid;
  end if;
  if tg_op='UPDATE' then
    if tg_table_name='coupons' then old_tenant:=old.tenant_id;
    elsif tg_table_name='coupon_discount_rules' then select c.tenant_id into old_tenant from public.coupons c where c.id=old.coupon_id;
    else select c.tenant_id into old_tenant from public.coupon_discount_rules r join public.coupons c on c.id=r.coupon_id where r.id=old.coupon_discount_rule_id;
    end if;
    perform private.require_coupon_write(old_tenant);
  end if;
  if tenant_id is null and tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if tenant_id is null then raise exception 'Coupon parent unavailable' using errcode='23503'; end if;
  perform private.require_coupon_write(tenant_id);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.enforce_coupon_module_write() from public,anon,authenticated,service_role;
create trigger coupons_published_write before insert or update or delete on public.coupons for each row execute function private.enforce_coupon_module_write();
create trigger coupon_rules_published_write before insert or update or delete on public.coupon_discount_rules for each row execute function private.enforce_coupon_module_write();
create trigger coupon_services_published_write before insert or update or delete on public.coupon_discount_services for each row execute function private.enforce_coupon_module_write();
create trigger coupon_redemptions_published_write before insert on public.coupon_redemptions for each row execute function private.enforce_coupon_module_write();

create function private.coupon_snapshot_preserved(p_item public.subscription_plan_items)
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.subscription_plan_versions next_plan
  join public.subscriptions s on s.id=next_plan.subscription_id
  join public.subscription_plan_versions prior on prior.id=s.current_plan_version_id and prior.subscription_id=s.id
  join public.subscription_plan_items i on i.plan_version_id=prior.id and i.position=p_item.position
  where next_plan.id=p_item.plan_version_id and next_plan.version=prior.version+1
    and next_plan.currency=prior.currency and next_plan.effective_from>prior.effective_from
    and i.coupon_id is not null
    and row(i.service_id,i.quantity,i.unit_amount_cents,i.unit_discount_cents,i.coupon_id,i.coupon_recurring_duration,i.is_taxable)
      is not distinct from row(p_item.service_id,p_item.quantity,p_item.unit_amount_cents,p_item.unit_discount_cents,p_item.coupon_id,p_item.coupon_recurring_duration,p_item.is_taxable));
$$;
revoke all on function private.coupon_snapshot_preserved(public.subscription_plan_items) from public,anon,authenticated,service_role;

create function private.enforce_coupon_plan_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
declare tenant_id uuid;
begin
  select s.tenant_id into tenant_id from public.subscription_plan_versions p join public.subscriptions s on s.id=p.subscription_id where p.id=new.plan_version_id;
  perform private.lock_tenant_module_lifecycle(tenant_id);
  if not private.tenant_module_allowed(tenant_id,'coupons') and new.coupon_id is not null
    and not private.coupon_snapshot_preserved(new) then
    raise exception 'WF_COUPONS_DISABLED' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_coupon_plan_snapshot() from public,anon,authenticated,service_role;
create trigger subscription_items_coupon_snapshot before insert on public.subscription_plan_items for each row execute function private.enforce_coupon_plan_snapshot();

-- Validate the complete transition: per-item guards cannot detect omitted benefits.
create function private.enforce_coupon_plan_transition()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.subscription_plan_versions; next_plan public.subscription_plan_versions;
begin
  perform private.lock_tenant_module_lifecycle(old.tenant_id);
  if new.current_plan_version_id is not distinct from old.current_plan_version_id then return new; end if;
  if private.tenant_module_allowed(old.tenant_id,'coupons') then return new; end if;
  if not exists(select 1 from public.subscription_plan_items where plan_version_id in (old.current_plan_version_id,new.current_plan_version_id) and coupon_id is not null) then return new; end if;
  select * into prior from public.subscription_plan_versions where id=old.current_plan_version_id;
  select * into next_plan from public.subscription_plan_versions where id=new.current_plan_version_id;
  if next_plan.subscription_id is distinct from old.id or next_plan.version is distinct from prior.version+1
    or next_plan.currency is distinct from prior.currency or next_plan.effective_from<=prior.effective_from
    or exists(select 1 from public.subscription_plan_items n where n.plan_version_id=next_plan.id and n.coupon_id is not null and not private.coupon_snapshot_preserved(n))
    or exists(select 1 from public.subscription_plan_items i where i.plan_version_id=prior.id and i.coupon_id is not null
      and not exists(select 1 from public.subscription_plan_items n where n.plan_version_id=next_plan.id and n.position=i.position
        and private.coupon_snapshot_preserved(n))) then
    raise exception 'Historic Coupon terms must be preserved exactly' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_coupon_plan_transition() from public,anon,authenticated,service_role;
create trigger subscriptions_coupon_transition before update of current_plan_version_id on public.subscriptions for each row execute function private.enforce_coupon_plan_transition();

create function private.enforce_invoice_new_coupon_discount()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if nullif(current_setting('app.wf_invoice_coupon_discount_id',true),'') is not null
    and (new.discount_total_cents is distinct from old.discount_total_cents or new.total_cents is distinct from old.total_cents) then
    perform private.require_coupon_write(old.tenant_id);
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_invoice_new_coupon_discount() from public,anon,authenticated,service_role;
create trigger invoices_new_coupon_discount before update on public.invoices for each row execute function private.enforce_invoice_new_coupon_discount();

create policy coupons_published_visibility on public.coupons as restrictive for select to authenticated
using(public.app_has_permission('coupons.view') or public.app_has_permission('coupons.manage'));
create policy coupon_redemptions_published_visibility on public.coupon_redemptions as restrictive for select to authenticated
using(public.app_has_permission('coupons.manage'));
create policy coupon_rules_published_visibility on public.coupon_discount_rules as restrictive for select to authenticated
using(exists(select 1 from public.coupons c where c.id=coupon_id));
create policy coupon_services_published_visibility on public.coupon_discount_services as restrictive for select to authenticated
using(exists(select 1 from public.coupon_discount_rules r where r.id=coupon_discount_rule_id));
create policy activity_events_published_coupons on public.activity_events as restrictive for select to authenticated
using(entity_type is distinct from 'coupon' or public.app_has_permission('coupons.manage'));

create function private.coupon_notification_visible(p_entity_type text,p_entity_id uuid,p_category text)
returns boolean language sql stable security definer set search_path='' as $$
select case when p_entity_type='coupon' or p_category in ('coupon','coupons') then exists(
  select 1 from public.coupons c where c.id=p_entity_id and c.tenant_id=private.current_tenant_id()
    and private.current_account_class()='internal' and private.current_user_has_permission('coupons.view')
    and private.tenant_module_allowed(c.tenant_id,'coupons')) else true end;
$$;
revoke all on function private.coupon_notification_visible(text,uuid,text) from public,anon,authenticated,service_role;

create function private.enforce_coupon_cycle_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_id uuid; plan_id uuid; tenant_id uuid; has_coupon boolean;
begin
  if tg_op='DELETE' then parent_id:=old.subscription_id; plan_id:=old.plan_version_id;
  else parent_id:=new.subscription_id; plan_id:=new.plan_version_id; end if;
  select s.tenant_id into tenant_id from public.subscriptions s where s.id=parent_id;
  perform private.lock_tenant_module_lifecycle(tenant_id);
  has_coupon:=exists(select 1 from public.subscription_plan_items i join public.subscription_plan_versions p on p.id=i.plan_version_id
    where (p.subscription_id=parent_id or p.id=plan_id) and i.coupon_id is not null);
  if tg_op in ('UPDATE','DELETE') then
    has_coupon:=has_coupon or exists(select 1 from public.subscription_plan_items i join public.subscription_plan_versions p on p.id=i.plan_version_id
      where (p.subscription_id=old.subscription_id or p.id=old.plan_version_id) and i.coupon_id is not null);
  end if;
  if has_coupon then
    if tg_op='DELETE' then raise exception 'Coupon cycle identity is immutable' using errcode='55000'; end if;
    if not exists(select 1 from public.subscription_plan_versions where id=plan_id and subscription_id=parent_id) then
      raise exception 'Coupon cycle plan must belong to its Subscription' using errcode='23514';
    end if;
    if tg_op='UPDATE' and row(new.subscription_id,new.plan_version_id,new.sequence,new.period_start,new.period_end,new.due_on,new.issue_on)
      is distinct from row(old.subscription_id,old.plan_version_id,old.sequence,old.period_start,old.period_end,old.due_on,old.issue_on) then
      raise exception 'Coupon cycle identity is immutable' using errcode='55000';
    end if;
    if tg_op='INSERT' and new.sequence<>(select coalesce(max(sequence),0)+1 from public.subscription_cycles where subscription_id=parent_id) then
      raise exception 'Coupon cycle sequence must continue its Subscription' using errcode='23514';
    end if;
    if tg_op='INSERT' and new.period_start<(select period_end from public.subscription_cycles where subscription_id=parent_id order by sequence desc limit 1) then
      raise exception 'Coupon billing periods must move forward' using errcode='23514';
    end if;
    if tg_op='INSERT' and not private.tenant_module_allowed(tenant_id,'coupons') and not exists(
      select 1 from public.subscriptions s join public.subscription_plan_versions current_plan on current_plan.id=s.current_plan_version_id
      join public.subscription_plan_versions proposed on proposed.id=plan_id and proposed.subscription_id=s.id
      where s.id=parent_id and proposed.id=(select eligible.id from public.subscription_plan_versions eligible
        where eligible.subscription_id=s.id and eligible.version<=current_plan.version and eligible.effective_from<=new.due_on
        order by eligible.effective_from desc,eligible.version desc limit 1)) then
      raise exception 'WF_COUPONS_DISABLED' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.enforce_coupon_cycle_identity() from public,anon,authenticated,service_role;
create trigger subscription_cycles_coupon_identity before insert or update or delete on public.subscription_cycles for each row execute function private.enforce_coupon_cycle_identity();

create function private.prevent_coupon_truncate()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Coupon history cannot be truncated' using errcode='55000';
end;
$$;
revoke all on function private.prevent_coupon_truncate() from public,anon,authenticated,service_role;
create trigger coupons_no_truncate before truncate on public.coupons for each statement execute function private.prevent_coupon_truncate();
create trigger coupon_rules_no_truncate before truncate on public.coupon_discount_rules for each statement execute function private.prevent_coupon_truncate();
create trigger coupon_services_no_truncate before truncate on public.coupon_discount_services for each statement execute function private.prevent_coupon_truncate();
create trigger coupon_redemptions_no_truncate before truncate on public.coupon_redemptions for each statement execute function private.prevent_coupon_truncate();
create trigger subscription_cycles_no_truncate before truncate on public.subscription_cycles for each statement execute function private.prevent_coupon_truncate();

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
    -- Only Services and Forms remain mandatory in this isolated predecessor.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects', 'tickets', 'subscriptions', 'invoices', 'coupons') and not (catalog.module_key = any(p_keys))
    ), false);
$function$;

CREATE OR REPLACE FUNCTION private.profile_has_permission_in_tenant(p_profile_id uuid, p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (case when p_permission_key in ('reporting.view', 'reports.send', 'reports.send_anytime')
      then private.tenant_module_allowed(p_tenant_id, 'reporting')
      when p_permission_key in ('investment_intent.view', 'investment_intent.manage')
      then private.tenant_module_allowed(p_tenant_id, 'investment_intent')
      when p_permission_key in ('projects.view', 'projects.create', 'projects.edit', 'projects.assign', 'projects.archive')
      then private.tenant_module_allowed(p_tenant_id, 'projects')
      when p_permission_key in ('tickets.view', 'tickets.create', 'tickets.reply', 'tickets.edit', 'tickets.assign', 'tickets.internal_notes', 'tickets.archive')
      then private.tenant_module_allowed(p_tenant_id, 'tickets')
      when p_permission_key in ('coupons.view', 'coupons.manage')
      then private.tenant_module_allowed(p_tenant_id, 'coupons')
      else true end)
    and coalesce((
      select case when preset_row.key = 'owner' then true else coalesce(
        (select profile_override.allowed from public.profile_permission_overrides as profile_override
         where profile_override.tenant_id = membership_row.tenant_id
           and profile_override.profile_id = membership_row.profile_id
           and profile_override.permission_key = p_permission_key),
        (select preset_grant.allowed from public.role_permissions as preset_grant
         where preset_grant.role_id = membership_row.role_id
           and preset_grant.permission_key = p_permission_key), false) end
      from public.tenant_memberships as membership_row
      join public.permission_presets as preset_row on preset_row.role_id = membership_row.role_id
      where membership_row.tenant_id = p_tenant_id
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null
        and exists (select 1 from public.permissions as permission where permission.permission_key = p_permission_key)
    ), false);
$function$;

create or replace function public.app_create_coupon(p_request_id uuid, p_payload jsonb)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_coupon_manager();
  existing_id uuid;
  coupon_row public.coupons;
begin
  perform private.require_coupon_write(private.current_tenant_id());
  actor_id := private.require_coupon_manager();
  if p_request_id is null then
    raise exception 'coupon request id is required'
      using errcode = '22023';
  end if;

  perform private.validate_coupon_payload(p_payload);

  existing_id := private.find_create_request(
    actor_id,
    'coupon.create',
    p_request_id,
    p_payload
  );

  if existing_id is not null then
    select coupon.*
    into coupon_row
    from public.coupons as coupon
    where coupon.id = existing_id
      and coupon.tenant_id = (select private.current_tenant_id());

    if coupon_row.id is null then raise no_data_found; end if;
    return coupon_row;
  end if;

  insert into public.coupons (
    code,
    description,
    discount_type,
    recurring_duration,
    single_use_per_customer,
    new_customers_only,
    expires_at,
    minimum_cart_amount,
    is_active,
    created_by_profile_id,
    updated_by_profile_id
  )
  values (
    private.normalize_coupon_code(p_payload ->> 'code'),
    p_payload ->> 'description',
    p_payload ->> 'discount_type',
    p_payload ->> 'recurring_duration',
    (p_payload ->> 'single_use_per_customer')::boolean,
    (p_payload ->> 'new_customers_only')::boolean,
    (p_payload ->> 'expires_at')::timestamptz,
    (p_payload ->> 'minimum_cart_amount')::numeric,
    (p_payload ->> 'is_active')::boolean,
    actor_id,
    actor_id
  )
  returning * into coupon_row;

  perform private.replace_coupon_discount_rules(
    coupon_row.id,
    coupon_row.discount_type,
    p_payload -> 'rules'
  );

  perform private.record_authenticated_activity(
    'coupon',
    coupon_row.id,
    'coupon.created',
    format('Created coupon %s.', coupon_row.code),
    jsonb_build_object('coupon', private.coupon_snapshot(coupon_row.id))
  );

  perform private.remember_create_request(
    actor_id,
    'coupon.create',
    p_request_id,
    p_payload,
    coupon_row.id
  );

  return coupon_row;
end;
$function$;

create or replace function public.app_update_coupon(p_coupon_id uuid, p_payload jsonb)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_coupon_manager();
  before_snapshot jsonb;
  coupon_row public.coupons;
begin
  perform private.require_coupon_write(private.current_tenant_id());
  actor_id := private.require_coupon_manager();
  perform private.validate_coupon_payload(p_payload);

  select private.coupon_snapshot(coupon.id)
  into before_snapshot
  from public.coupons as coupon
  where coupon.id = p_coupon_id
    and coupon.tenant_id = (select private.current_tenant_id())
    and coupon.archived_at is null
  for update of coupon;

  if before_snapshot is null then raise no_data_found; end if;

  update public.coupons
  set
    code = private.normalize_coupon_code(p_payload ->> 'code'),
    description = p_payload ->> 'description',
    discount_type = p_payload ->> 'discount_type',
    recurring_duration = p_payload ->> 'recurring_duration',
    single_use_per_customer = (p_payload ->> 'single_use_per_customer')::boolean,
    new_customers_only = (p_payload ->> 'new_customers_only')::boolean,
    expires_at = (p_payload ->> 'expires_at')::timestamptz,
    minimum_cart_amount = (p_payload ->> 'minimum_cart_amount')::numeric,
    is_active = (p_payload ->> 'is_active')::boolean,
    updated_by_profile_id = actor_id
  where id = p_coupon_id
    and tenant_id = (select private.current_tenant_id())
  returning * into coupon_row;

  perform private.replace_coupon_discount_rules(
    coupon_row.id,
    coupon_row.discount_type,
    p_payload -> 'rules'
  );

  perform private.record_authenticated_activity(
    'coupon',
    coupon_row.id,
    'coupon.updated',
    format('Updated coupon %s.', coupon_row.code),
    jsonb_build_object(
      'before', before_snapshot,
      'after', private.coupon_snapshot(coupon_row.id)
    )
  );

  return coupon_row;
end;
$function$;

create or replace function public.app_archive_coupon(p_coupon_id uuid)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_coupon_manager();
  coupon_row public.coupons;
begin
  perform private.require_coupon_write(private.current_tenant_id());
  actor_id := private.require_coupon_manager();
  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.id = p_coupon_id
    and coupon.tenant_id = (select private.current_tenant_id())
  for update;

  if coupon_row.id is null then raise no_data_found; end if;
  if coupon_row.archived_at is not null then return coupon_row; end if;

  update public.coupons
  set
    is_active = false,
    archived_at = now(),
    archived_by_profile_id = actor_id,
    updated_by_profile_id = actor_id
  where id = p_coupon_id
    and tenant_id = (select private.current_tenant_id())
  returning * into coupon_row;

  perform private.record_authenticated_activity(
    'coupon',
    coupon_row.id,
    'coupon.archived',
    format('Archived coupon %s.', coupon_row.code),
    jsonb_build_object('coupon', private.coupon_snapshot(coupon_row.id))
  );

  return coupon_row;
end;
$function$;

create or replace function public.app_validate_coupon(p_code text, p_cart_items jsonb, p_cart_subtotal numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$

declare
  actor_id uuid := (select auth.uid());
  customer_profile_id uuid;
  customer_company_id uuid;
begin
  perform private.require_coupon_write(private.current_tenant_id());
  if private.current_account_class() is null then raise exception 'authentication is required' using errcode='42501'; end if;
  select profile_row.id
  into customer_profile_id
  from public.profiles as profile_row
  where profile_row.id = actor_id
    and profile_row.archived_at is null;

  if customer_profile_id is null then
    raise exception 'active authentication is required'
      using errcode = '42501';
  end if;

  customer_company_id := (select private.current_user_company_id());

  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

  -- The current operational orders table does not prove paid commerce history.
  -- Therefore no caller-supplied "new customer" assertion is accepted here.
  return private.calculate_coupon(
    p_code,
    p_cart_items,
    p_cart_subtotal,
    customer_profile_id,
    customer_company_id,
    null
  );
end;
$function$;

create or replace function public.app_quote_invoice_coupon(p_invoice_id uuid, p_coupon_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$

declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  invoice_row public.invoices;
  amounts record;
  cart_items jsonb;
  cart_subtotal numeric;
  cap_cents bigint;
  application record;
begin
  perform private.require_coupon_write(private.current_tenant_id());
  if actor_id is null then
    raise exception 'WF_CARD_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  actor_company_id := (select private.current_user_company_id());

  if actor_company_id is null then
    raise exception 'WF_CARD_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_invoices');
  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

  perform private.require_permission('invoices.view');

  select * into invoice_row
  from public.invoices as invoice
  where invoice.id = p_invoice_id
    and invoice.tenant_id = (select private.current_tenant_id())
    and invoice.archived_at is null;

  if invoice_row.id is null or invoice_row.company_id <> actor_company_id then
    raise exception 'WF_CARD_INVOICE_ACCESS_DENIED' using errcode = '42501';
  end if;
  if invoice_row.status <> 'unpaid' then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

  select * into amounts from private.invoice_amounts(p_invoice_id);
  if amounts.balance_due_cents is null or amounts.balance_due_cents <= 0 then
    raise exception 'WF_CARD_INVOICE_NOT_COLLECTIBLE' using errcode = 'P0001';
  end if;

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
    -- An invoice with no service lines has nothing an eligible coupon can touch.
    return jsonb_build_object('valid', false, 'failure_code', 'NOT_APPLICABLE');
  end if;

  cap_cents := least(
    amounts.balance_due_cents,
    invoice_row.subtotal_cents - invoice_row.discount_total_cents
  );

  select * into application
  from private.resolve_coupon_application(
    p_coupon_code,
    cart_items,
    cart_subtotal,
    actor_id,
    actor_company_id,
    cap_cents
  );

  if not application.valid then
    return jsonb_build_object('valid', false, 'failure_code', application.failure_code);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', application.coupon_id,
    'discount_cents', application.discount_cents,
    'original_subtotal_cents', amounts.balance_due_cents,
    'eligible_subtotal_cents', round(application.eligible_subtotal * 100)::bigint,
    'resulting_subtotal_cents', amounts.balance_due_cents - application.discount_cents
  );
end;
$$;

create or replace function public.app_quote_store_coupon(p_service_id uuid, p_coupon_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$

declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  service_row public.services;
  price_cents bigint;
  application record;
begin
  perform private.require_coupon_write(private.current_tenant_id());
  if actor_id is null then
    raise exception 'WF_PURCHASE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  actor_company_id := (select private.current_user_company_id());

  if actor_company_id is null then
    raise exception 'WF_PURCHASE_CLIENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;

  -- Same module boundary as the purchase itself: quoting is a Store AND a
  -- billing action.
  perform public.app_require_module_access('portal_store');
  perform private.require_permission('store.view');
  perform public.app_require_module_access('portal_invoices');
  -- C2-3. A coupon check is an authenticated code-probing oracle: every call
  -- reveals whether an admin-created code exists and what it discounts. These
  -- fixed-window buckets bound automated code enumeration while sitting far
  -- above any human "type a code and Apply" cadence. The scopes are SHARED by
  -- all three coupon surfaces (validate, Store quote, invoice quote), so
  -- rotating between endpoints cannot multiply one account's allowance, and
  -- the subject is always the server-derived profile id.
  perform private.consume_rate_limit(
    'coupon.attempt.actor.minute', actor_id::text, interval '1 minute', 15
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.hour', actor_id::text, interval '1 hour', 100
  );
  perform private.consume_rate_limit(
    'coupon.attempt.actor.day', actor_id::text, interval '1 day', 300
  );

  perform private.require_permission('invoices.view');

  select * into service_row
  from public.services as service
  where service.id = p_service_id
    and service.archived_at is null
    and service.is_active
    and service.is_public
    and service.tenant_id = (select private.current_tenant_id());

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

  select * into application
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

  if not application.valid then
    return jsonb_build_object('valid', false, 'failure_code', application.failure_code);
  end if;

  return jsonb_build_object(
    'valid', true,
    'coupon_id', application.coupon_id,
    'discount_cents', application.discount_cents,
    'original_subtotal_cents', price_cents,
    'eligible_subtotal_cents', round(application.eligible_subtotal * 100)::bigint,
    'resulting_subtotal_cents', round(application.resulting_cart_subtotal * 100)::bigint
  );
end;
$$;

create or replace function private.calculate_coupon(p_code text, p_cart_items jsonb, p_cart_subtotal numeric, p_customer_profile_id uuid default null::uuid, p_customer_company_id uuid default null::uuid, p_is_new_customer boolean default null::boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  coupon_row public.coupons;
  cart_item jsonb;
  normalized_items jsonb := '[]'::jsonb;
  service_id uuid;
  quantity numeric;
  unit_amount numeric;
  line_subtotal numeric;
  computed_subtotal numeric := 0;
  billing_context text;
  calculated_customer_scope_key text;
  eligible_subtotal numeric := 0;
  discount_amount numeric := 0;
begin
  if not private.tenant_module_allowed(private.current_tenant_id(),'coupons') then raise exception 'WF_COUPONS_DISABLED' using errcode='42501'; end if;
  if p_code is null or private.normalize_coupon_code(p_code) = '' then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CODE');
  end if;

  select coupon.*
  into coupon_row
  from public.coupons as coupon
  where coupon.code = private.normalize_coupon_code(p_code)
    and coupon.tenant_id = (select private.current_tenant_id());

  if coupon_row.id is null then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CODE');
  end if;

  if coupon_row.archived_at is not null then
    return jsonb_build_object('valid', false, 'failure_code', 'ARCHIVED');
  end if;

  if not coupon_row.is_active then
    return jsonb_build_object('valid', false, 'failure_code', 'INACTIVE');
  end if;

  if coupon_row.expires_at is not null and now() >= coupon_row.expires_at then
    return jsonb_build_object('valid', false, 'failure_code', 'EXPIRED');
  end if;

  if p_customer_profile_id is not null and not exists (
    select 1
    from public.profiles as profile_row
    where profile_row.id = p_customer_profile_id
      and profile_row.archived_at is null
  ) then
    return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_INELIGIBLE');
  end if;

  if p_customer_company_id is not null and not exists (
    select 1
    from public.companies as company_row
    where company_row.id = p_customer_company_id
      and company_row.archived_at is null
  ) then
    return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_INELIGIBLE');
  end if;

  if p_customer_profile_id is not null and p_customer_company_id is not null
    and not exists (
      select 1
      from public.tenant_memberships as membership_row
      where membership_row.tenant_id = (select private.current_tenant_id())
        and membership_row.profile_id = p_customer_profile_id
        and membership_row.company_id = p_customer_company_id
        and membership_row.archived_at is null
    )
  then
    return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_INELIGIBLE');
  end if;

  calculated_customer_scope_key := case
    when p_customer_company_id is not null
      then 'company:' || p_customer_company_id::text
    when p_customer_profile_id is not null
      then 'profile:' || p_customer_profile_id::text
    else null
  end;

  if coupon_row.single_use_per_customer then
    if calculated_customer_scope_key is null then
      return jsonb_build_object('valid', false, 'failure_code', 'CUSTOMER_CONTEXT_REQUIRED');
    end if;

    if exists (
      select 1
      from public.coupon_redemptions as redemption
      where redemption.coupon_id = coupon_row.id
        and redemption.customer_scope_key = calculated_customer_scope_key
    ) then
      return jsonb_build_object('valid', false, 'failure_code', 'ALREADY_REDEEMED');
    end if;
  end if;

  if coupon_row.new_customers_only then
    if p_is_new_customer is null then
      return jsonb_build_object(
        'valid', false,
        'failure_code', 'NEW_CUSTOMER_DETERMINATION_DEFERRED'
      );
    elsif not p_is_new_customer then
      return jsonb_build_object('valid', false, 'failure_code', 'NOT_NEW_CUSTOMER');
    end if;
  end if;

  if p_cart_items is null
    or jsonb_typeof(p_cart_items) <> 'array'
    or jsonb_array_length(p_cart_items) = 0
    or p_cart_subtotal is null
    or p_cart_subtotal < 0
    or p_cart_subtotal <> round(p_cart_subtotal, 2)
    or p_cart_subtotal > 9999999999.99
  then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
  end if;

  for cart_item in select value from jsonb_array_elements(p_cart_items)
  loop
    if jsonb_typeof(cart_item) <> 'object'
      or cart_item - array['service_id', 'quantity', 'unit_amount', 'billing_context'] <> '{}'::jsonb
      or not cart_item ?& array['service_id', 'quantity', 'unit_amount']
      or jsonb_typeof(cart_item -> 'service_id') <> 'string'
      or jsonb_typeof(cart_item -> 'quantity') <> 'number'
      or jsonb_typeof(cart_item -> 'unit_amount') <> 'number'
      or (cart_item ? 'billing_context' and jsonb_typeof(cart_item -> 'billing_context') <> 'string')
    then
      return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end if;

    begin
      service_id := (cart_item ->> 'service_id')::uuid;
      quantity := (cart_item ->> 'quantity')::numeric;
      unit_amount := (cart_item ->> 'unit_amount')::numeric;
      billing_context := coalesce(cart_item ->> 'billing_context', 'one_time');
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end;

    if quantity <= 0
      or quantity <> trunc(quantity)
      or unit_amount < 0
      or unit_amount <> round(unit_amount, 2)
      or unit_amount > 9999999999.99
      or billing_context not in ('one_time', 'initial', 'renewal')
    then
      return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end if;

    line_subtotal := round(quantity * unit_amount, 2);
    if line_subtotal > 9999999999.99 then
      return jsonb_build_object('valid', false, 'failure_code', 'INVALID_CART');
    end if;

    computed_subtotal := computed_subtotal + line_subtotal;
    normalized_items := normalized_items || jsonb_build_array(
      jsonb_build_object(
        'service_id', service_id,
        'line_subtotal', line_subtotal,
        'billing_context', billing_context
      )
    );
  end loop;

  if computed_subtotal <> p_cart_subtotal then
    return jsonb_build_object('valid', false, 'failure_code', 'CART_SUBTOTAL_MISMATCH');
  end if;

  if coupon_row.minimum_cart_amount is not null
    and p_cart_subtotal < coupon_row.minimum_cart_amount
  then
    return jsonb_build_object('valid', false, 'failure_code', 'MINIMUM_CART_NOT_MET');
  end if;

  with cart_lines as (
    select
      (item.value ->> 'service_id')::uuid as service_id,
      (item.value ->> 'line_subtotal')::numeric as line_subtotal,
      item.value ->> 'billing_context' as billing_context
    from jsonb_array_elements(normalized_items) as item(value)
  ),
  matched_lines as (
    select
      cart_line.line_subtotal,
      matched_rule.id as rule_id,
      matched_rule.discount_value
    from cart_lines as cart_line
    join public.services as service_row
      on service_row.id = cart_line.service_id
     and service_row.is_active
     and service_row.archived_at is null
    left join lateral (
      select discount_rule.id, discount_rule.discount_value
      from public.coupon_discount_rules as discount_rule
      where discount_rule.coupon_id = coupon_row.id
        and (
          discount_rule.applies_to_all
          or exists (
            select 1
            from public.coupon_discount_services as membership
            where membership.coupon_discount_rule_id = discount_rule.id
              and membership.service_id = cart_line.service_id
          )
        )
      order by discount_rule.sort_order, discount_rule.id
      limit 1
    ) as matched_rule on true
    where not (
      coupon_row.recurring_duration = 'first_payment'
      and cart_line.billing_context = 'renewal'
    )
  ),
  per_rule as (
    select
      matched_line.rule_id,
      matched_line.discount_value,
      sum(matched_line.line_subtotal) as rule_eligible_subtotal,
      sum(round(matched_line.line_subtotal * matched_line.discount_value / 100, 2))
        as percentage_discount
    from matched_lines as matched_line
    where matched_line.rule_id is not null
    group by matched_line.rule_id, matched_line.discount_value
  )
  select
    coalesce(sum(per_rule.rule_eligible_subtotal), 0),
    coalesce(sum(
      case coupon_row.discount_type
        when 'percentage' then per_rule.percentage_discount
        else least(per_rule.discount_value, per_rule.rule_eligible_subtotal)
      end
    ), 0)
  into eligible_subtotal, discount_amount
  from per_rule;

  if eligible_subtotal = 0 then
    return jsonb_build_object(
      'valid', false,
      'failure_code', 'NOT_APPLICABLE',
      'coupon_id', coupon_row.id,
      'eligible_subtotal', 0,
      'discount_amount', 0,
      'resulting_subtotal', p_cart_subtotal
    );
  end if;

  if coupon_row.discount_type = 'percentage' and exists (
    select 1
    from public.coupon_discount_rules as discount_rule
    where discount_rule.coupon_id = coupon_row.id
      and (discount_rule.discount_value <= 0 or discount_rule.discount_value > 100)
  ) then
    return jsonb_build_object('valid', false, 'failure_code', 'INVALID_DISCOUNT');
  end if;

  discount_amount := least(round(discount_amount, 2), eligible_subtotal);

  return jsonb_build_object(
    'valid', true,
    'failure_code', null,
    'coupon_id', coupon_row.id,
    'discount_type', coupon_row.discount_type,
    'recurring_duration', coupon_row.recurring_duration,
    'eligible_subtotal', eligible_subtotal,
    'discount_amount', discount_amount,
    'resulting_subtotal', p_cart_subtotal - discount_amount
  );
end;
$function$;

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
  if nullif(btrim(p_coupon_code),'') is not null then perform private.require_coupon_write(private.current_tenant_id()); end if;
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
    and private.coupon_notification_visible(notification.entity_type,notification.entity_id,notification.category)
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
    and private.coupon_notification_visible(notification.entity_type,notification.entity_id,notification.category)
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
    and private.coupon_notification_visible(notification.entity_type,notification.entity_id,notification.category)
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
$function$;

create or replace function private.insert_subscription_plan_items(
  p_plan_version_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  item_value jsonb;
  selected_service_id uuid;
  selected_coupon_id uuid;
  coupon_duration text;
  item_name text;
  item_description text;
  item_quantity integer;
  item_amount bigint;
  item_discount bigint;
  item_taxable boolean;
  plan_row public.subscription_plan_versions;
  parent public.subscriptions;
  prior public.subscription_plan_versions;
  historic public.subscription_plan_items;
  carry boolean;
  coupons_enabled boolean;
begin
  select * into plan_row from public.subscription_plan_versions where id=p_plan_version_id;
  select * into parent from public.subscriptions where id=plan_row.subscription_id;
  perform private.lock_tenant_module_lifecycle(parent.tenant_id);
  select * into parent from public.subscriptions where id=plan_row.subscription_id for update;
  select * into prior from public.subscription_plan_versions where id=parent.current_plan_version_id;
  coupons_enabled := private.tenant_module_allowed(parent.tenant_id,'coupons');
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100
  then
    raise exception 'subscription plan requires one to one hundred line items'
      using errcode = '22023';
  end if;

  for item in
    select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    item_value := item.value;
    if jsonb_typeof(item_value) <> 'object'
      or item_value - array[
        'service_id', 'name', 'description', 'quantity',
        'unit_amount_cents', 'unit_discount_cents', 'coupon_id', 'is_taxable'
      ] <> '{}'::jsonb
      or not item_value ?& array['name', 'quantity', 'unit_amount_cents']
      or jsonb_typeof(item_value -> 'name') <> 'string'
      or jsonb_typeof(item_value -> 'quantity') <> 'number'
      or jsonb_typeof(item_value -> 'unit_amount_cents') <> 'number'
      or (item_value ->> 'quantity')::numeric <> trunc((item_value ->> 'quantity')::numeric)
      or (item_value ->> 'unit_amount_cents')::numeric <> trunc((item_value ->> 'unit_amount_cents')::numeric)
      or (
        item_value ? 'unit_discount_cents'
        and item_value -> 'unit_discount_cents' <> 'null'::jsonb
        and (
          jsonb_typeof(item_value -> 'unit_discount_cents') <> 'number'
          or (item_value ->> 'unit_discount_cents')::numeric
            <> trunc((item_value ->> 'unit_discount_cents')::numeric)
        )
      )
      or (
        item_value ? 'is_taxable'
        and item_value -> 'is_taxable' <> 'null'::jsonb
        and jsonb_typeof(item_value -> 'is_taxable') <> 'boolean'
      )
    then
      raise exception 'invalid subscription plan line item' using errcode = '22023';
    end if;

    begin
      selected_service_id := nullif(item_value ->> 'service_id', '')::uuid;
      selected_coupon_id := nullif(item_value ->> 'coupon_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'subscription plan line item identifiers must be UUIDs'
        using errcode = '22023';
    end;

    if selected_service_id is not null and not exists (
      select 1 from public.services as service_row where service_row.id = selected_service_id
    ) then
      raise exception 'subscription plan Service does not exist' using errcode = '23514';
    end if;

    item_name := nullif(btrim(item_value ->> 'name'), '');
    item_description := nullif(btrim(item_value ->> 'description'), '');
    item_quantity := (item_value ->> 'quantity')::integer;
    item_amount := (item_value ->> 'unit_amount_cents')::bigint;
    item_discount := coalesce((item_value ->> 'unit_discount_cents')::bigint, 0);
    item_taxable := coalesce((item_value ->> 'is_taxable')::boolean, true);
    if item_name is null or item_quantity<=0 or item_amount<0 or item_discount<0 or item_discount>item_amount then
      raise exception 'invalid subscription plan line item' using errcode='22023';
    end if;
    select * into historic from public.subscription_plan_items where plan_version_id=prior.id and position=item.ordinality-1;
    carry := historic.coupon_id is not null and plan_row.version=prior.version+1 and plan_row.currency=prior.currency
      and plan_row.effective_from>prior.effective_from
      and row(historic.service_id,historic.quantity,historic.unit_amount_cents,historic.unit_discount_cents,historic.is_taxable)
        is not distinct from row(selected_service_id,item_quantity,item_amount,item_discount,item_taxable)
      and (selected_coupon_id=historic.coupon_id or (not coupons_enabled and selected_coupon_id is null));
    coupon_duration := null;
    if carry then
      selected_coupon_id := historic.coupon_id;
      coupon_duration := historic.coupon_recurring_duration;
    elsif selected_coupon_id is not null then
      perform private.require_coupon_write(parent.tenant_id);
      select recurring_duration into coupon_duration from public.coupons where id=selected_coupon_id
        and tenant_id=parent.tenant_id and is_active and archived_at is null;
      if coupon_duration is null then raise exception 'subscription plan Coupon must be active at snapshot time' using errcode='23514'; end if;
    elsif not coupons_enabled and historic.coupon_id is not null then
      raise exception 'Historic Coupon terms must be preserved exactly' using errcode='42501';
    end if;

    insert into public.subscription_plan_items (
      plan_version_id, position, service_id, service_name_snapshot,
      service_description_snapshot, quantity, unit_amount_cents,
      unit_discount_cents, coupon_id, coupon_recurring_duration, is_taxable
    ) values (
      p_plan_version_id, item.ordinality - 1, selected_service_id, item_name,
      item_description, item_quantity, item_amount, item_discount,
      selected_coupon_id, coupon_duration, item_taxable
    );
  end loop;
end;
$$;
