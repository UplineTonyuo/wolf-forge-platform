-- Local implementation only; applying this migration is a separate rollout.
create function private.is_monthly_reporting_service(p_service_id uuid) returns boolean
language sql immutable set search_path = '' as $$
  select p_service_id = any(array[
    '5f000000-0000-4000-8000-000000000318'::uuid,
    '5f000000-0000-4000-8000-000000000123'::uuid,
    '5f000000-0000-4000-8000-000000000124'::uuid,
    '5f000000-0000-4000-8000-000000000546'::uuid,
    '5f000000-0000-4000-8000-000000000554'::uuid,
    '5f000000-0000-4000-8000-000000000555'::uuid,
    '5f000000-0000-4000-8000-000000000563'::uuid
  ]);
$$;

-- Subscriptions still being delivered, authorized in-progress work, or an
-- exact paid/provisioned invoice item establish ownership. Names never do.
create function private.client_owns_reporting_service(p_company_id uuid, p_service_id uuid, p_subscription_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_monthly_reporting_service(p_service_id)
    and exists(select 1 from public.companies c where c.id=p_company_id
      and c.tenant_id=private.current_tenant_id() and c.archived_at is null)
    and exists(select 1 from public.services s where s.id=p_service_id
      and s.tenant_id=private.current_tenant_id() and s.is_active and s.archived_at is null)
    and (
      exists(select 1 from public.subscriptions sub
        where sub.company_id=p_company_id and sub.service_id=p_service_id
          and sub.tenant_id=private.current_tenant_id() and sub.archived_at is null
          and sub.status <> 'canceled'
          and (p_subscription_id is null or sub.id=p_subscription_id))
      or (p_subscription_id is null and exists(
        select 1 from public.orders o
        where o.company_id=p_company_id and o.service_id=p_service_id
          and o.tenant_id=private.current_tenant_id() and o.archived_at is null
          and o.status <> 'canceled'
          and (o.status in ('working','waiting_reply','pending_update') or exists(
            select 1 from public.invoice_items item join public.invoices invoice on invoice.id=item.invoice_id
            where item.order_id=o.id and item.service_id=o.service_id and item.fulfillment_status='provisioned'
              and invoice.company_id=o.company_id and invoice.tenant_id=o.tenant_id
              and invoice.status='paid' and invoice.archived_at is null
          ))
      ))
    );
$$;

create or replace function private.validate_report_service_selection(p_company_id uuid, p_service_id uuid, p_subscription_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_company_id is null or p_service_id is null then
    raise exception 'report company and Service are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id and c.archived_at is null and c.tenant_id=private.current_tenant_id()) then
    raise exception 'active client company is required' using errcode='23503';
  end if;
  if not exists(select 1 from public.services s where s.id=p_service_id and s.is_active and s.archived_at is null and s.tenant_id=private.current_tenant_id()) then
    raise exception 'active Reporting Service is required' using errcode='23503';
  end if;
  if p_subscription_id is not null and not exists(select 1 from public.subscriptions sub
    where sub.id=p_subscription_id and sub.company_id=p_company_id and sub.service_id=p_service_id
      and sub.tenant_id=private.current_tenant_id() and sub.archived_at is null and sub.status<>'canceled') then
    raise exception 'report subscription does not match the client and Service' using errcode='23514';
  end if;
  if not coalesce(private.client_owns_reporting_service(p_company_id,p_service_id,p_subscription_id),false) then
    raise exception 'Client does not own this Reporting Service' using errcode='42501';
  end if;
end;
$$;

create or replace function public.app_list_reporting_service_options(p_company_id uuid, p_supported_service_ids uuid[])
returns table(service_id uuid, service_name text, subscription_id uuid, subscription_status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');
  if p_supported_service_ids is null then raise exception 'Supported Services required' using errcode='22023'; end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id
    and c.tenant_id=private.current_tenant_id() and c.archived_at is null) then
    raise exception 'active client company is required' using errcode='23503';
  end if;
  return query
  select s.id,s.name,sub.id,sub.status
  from public.services s
  left join public.subscriptions sub on sub.service_id=s.id and sub.company_id=p_company_id
    and sub.tenant_id=s.tenant_id and sub.archived_at is null
    and sub.status <> 'canceled'
  where s.id=any(p_supported_service_ids)
    and private.client_owns_reporting_service(p_company_id,s.id,sub.id)
  order by s.name,sub.created_at,sub.id;
end;
$$;

revoke all on function private.is_monthly_reporting_service(uuid) from public,anon,authenticated,service_role;
revoke all on function private.client_owns_reporting_service(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Existing API roles cannot write report rows directly. Draft creation already
-- calls the validator; recheck when an old draft is first published as well.
do $publication$
declare target oid:='public.app_send_report_draft(uuid,uuid)'::regprocedure;
  original text; replacement text; needle text; owner_before oid; acl_before aclitem[];
begin
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  needle:='perform private.assert_report_send_window(report_row.reporting_period_month);';
  if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 then raise exception 'Unexpected report send baseline'; end if;
  replacement:=replace(original,needle,$body$
  if report_row.service_id is not null then
    perform private.validate_report_service_selection(report_row.company_id,report_row.service_id,report_row.subscription_id);
  end if;
  $body$||needle);
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and proowner=owner_before and proacl is not distinct from acl_before and prosrc=replacement) then
    raise exception 'Report publication preservation failed';
  end if;
end;
$publication$;

-- An order has one work period, not a recurring billing cycle. Use the same
-- business calendar as Reporting, and never derive a period from publication.
create function private.order_reporting_month(p_order public.orders) returns date
language sql stable set search_path='' as $$
  select date_trunc('month',coalesce(p_order.started_at,p_order.created_at) at time zone 'Asia/Manila')::date;
$$;

create table private.order_report_exceptions (
  order_id uuid not null references public.orders(id),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  service_id uuid not null references public.services(id),
  reporting_period_month date not null check(extract(day from reporting_period_month)=1),
  reason text not null check(reason ~ '[^[:space:]]' and char_length(reason) between 1 and 1000),
  actor_profile_id uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  primary key(order_id,service_id,reporting_period_month)
);
create index client_reports_order_completion on public.client_reports(tenant_id,company_id,service_id,reporting_period_month)
  where status='sent' and archived_at is null;
alter table private.order_report_exceptions enable row level security;
alter table private.order_report_exceptions force row level security;
revoke all on private.order_report_exceptions from public,anon,authenticated,service_role;

create function private.require_order_completion_authority(p_order public.orders) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor_id uuid;
begin
  actor_id:=private.require_internal_actor();
  perform public.app_require_module_access('projects');
  perform private.require_permission('projects.edit');
  if p_order.tenant_id is distinct from private.current_tenant_id() or p_order.archived_at is not null
    or not coalesce(private.can_access_operational_order(p_order.id),false) then
    raise exception 'Project access denied' using errcode='42501';
  end if;
  return actor_id;
end;
$$;

create function private.guard_order_report_completion() returns trigger
language plpgsql security definer set search_path='' as $$
declare period_month date; service_name text;
begin
  if new.status<>'complete' or not coalesce(private.is_monthly_reporting_service(new.service_id),false) then return new; end if;
  -- Historical completed records remain untouched; changing their scope is a new decision.
  if tg_op='UPDATE' and old.status='complete' and old.service_id=new.service_id
    and old.company_id=new.company_id and old.tenant_id=new.tenant_id
    and private.order_reporting_month(old)=private.order_reporting_month(new) then return new; end if;

  perform private.require_order_completion_authority(new);
  period_month:=private.order_reporting_month(new);
  perform 1 from public.client_reports report
    where report.tenant_id=new.tenant_id and report.company_id=new.company_id and report.service_id=new.service_id
      and report.reporting_period_month=period_month and report.status='sent' and report.sent_at is not null and report.archived_at is null
    for share;
  if found then return new; end if;
  if exists(select 1 from private.order_report_exceptions exception
    where exception.order_id=new.id and exception.tenant_id=new.tenant_id and exception.company_id=new.company_id
      and exception.service_id=new.service_id and exception.reporting_period_month=period_month) then return new; end if;

  select s.name into service_name from public.services s where s.id=new.service_id and s.tenant_id=new.tenant_id;
  raise exception 'Monthly report required' using errcode='WF431',detail=jsonb_build_object(
    'orderId',new.id,'companyId',new.company_id,'serviceId',new.service_id,'serviceName',service_name,
    'reportingPeriodMonth',period_month,'canRecordException',private.current_user_role_name() in ('owner','admin','manager')
  )::text;
end;
$$;
-- The permission trigger runs first; this guard also covers direct and multirow writes.
create trigger orders_require_monthly_report before insert or update on public.orders
  for each row execute function private.guard_order_report_completion();

create function public.app_complete_order_without_report(p_order_id uuid,p_service_id uuid,p_reporting_period_month date,p_reason text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders; actor_id uuid; reason_value text; prior private.order_report_exceptions;
begin
  perform private.require_internal_actor();
  select * into o from public.orders where id=p_order_id and tenant_id=private.current_tenant_id() and archived_at is null for update;
  if o.id is null then raise no_data_found; end if;
  actor_id:=private.require_order_completion_authority(o);
  if private.current_user_role_name() not in ('owner','admin','manager') then
    raise exception 'Report exception denied' using errcode='42501';
  end if;
  reason_value:=btrim(coalesce(p_reason,''),E' \t\n\r\f'||U&'\000B\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if reason_value='' or char_length(reason_value)>1000
    or p_service_id is distinct from o.service_id or not private.is_monthly_reporting_service(o.service_id)
    or p_reporting_period_month is distinct from private.order_reporting_month(o) then
    raise exception 'Invalid report exception scope or reason' using errcode='22023';
  end if;
  select * into prior from private.order_report_exceptions where order_id=o.id and service_id=o.service_id and reporting_period_month=p_reporting_period_month;
  if prior.order_id is not null then
    if prior.reason is distinct from reason_value or prior.tenant_id is distinct from o.tenant_id or prior.company_id is distinct from o.company_id then
      raise exception 'An exception already exists for this scope' using errcode='23505';
    end if;
    -- Recheck current authority before answering even an exact retry.
    if o.status='complete' then return o; end if;
  elsif o.status='complete' then
    raise exception 'Historical completed orders cannot acquire an exception' using errcode='22023';
  else
    insert into private.order_report_exceptions(order_id,tenant_id,company_id,service_id,reporting_period_month,reason,actor_profile_id)
    values(o.id,o.tenant_id,o.company_id,o.service_id,p_reporting_period_month,reason_value,actor_id);
    perform private.record_authenticated_activity('order',o.id,'order.report_not_required',
      'Recorded monthly report exception.',jsonb_build_object('service_id',o.service_id,'reporting_period_month',p_reporting_period_month));
  end if;
  return public.app_change_order_status(o.id,'complete');
end;
$$;

-- Preserve the existing function owner/ACL; exact retries keep time and audit stable.
do $patch$
declare target oid:='public.app_change_order_status(uuid,text)'::regprocedure;
  original text; replacement text; owner_before oid; acl_before aclitem[]; needle text;
begin
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  needle:='if previous_status is null then raise no_data_found; end if;';
  if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 then raise exception 'Unexpected order status baseline'; end if;
  replacement:=replace(original,needle,needle||$body$
  select * into order_row from public.orders where id=p_order_id;
  perform private.require_order_completion_authority(order_row);
  if previous_status=p_status then return order_row; end if;
$body$);
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and proowner=owner_before and proacl is not distinct from acl_before and prosrc=replacement) then
    raise exception 'Order status preservation failed';
  end if;
end;
$patch$;

revoke all on function private.order_reporting_month(public.orders) from public,anon,authenticated,service_role;
revoke all on function private.require_order_completion_authority(public.orders) from public,anon,authenticated,service_role;
revoke all on function private.guard_order_report_completion() from public,anon,authenticated,service_role;
revoke all on function public.app_complete_order_without_report(uuid,uuid,date,text) from public,anon,authenticated,service_role;
grant execute on function public.app_complete_order_without_report(uuid,uuid,date,text) to authenticated;
