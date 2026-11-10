-- An explicit work period. Do not backfill historical rows or infer a calendar month.
alter table public.orders add column reporting_period_month date
  check(reporting_period_month is null or (reporting_period_month between date '0001-01-01' and date '9999-12-01'
    and extract(day from reporting_period_month)=1));

create or replace function private.order_reporting_month(p_order public.orders) returns date
language sql stable set search_path='' as $$
  select p_order.reporting_period_month;
$$;

create or replace function private.guard_order_report_completion() returns trigger
language plpgsql security definer set search_path='' as $$
declare period_month date; service_name text;
begin
  if new.status<>'complete' or not coalesce(private.is_monthly_reporting_service(new.service_id),false) then return new; end if;
  if tg_op='UPDATE' and old.status='complete' and old.service_id=new.service_id
    and old.company_id=new.company_id and old.tenant_id=new.tenant_id
    and old.reporting_period_month is not distinct from new.reporting_period_month then return new; end if;

  perform private.require_order_completion_authority(new);
  period_month:=private.order_reporting_month(new);
  if period_month is not null then
    perform 1 from public.client_reports report
      where report.tenant_id=new.tenant_id and report.company_id=new.company_id and report.service_id=new.service_id
        and report.reporting_period_month=period_month and report.status='sent' and report.sent_at is not null and report.archived_at is null
      for share;
    if found then return new; end if;
    if exists(select 1 from private.order_report_exceptions exception
      where exception.order_id=new.id and exception.tenant_id=new.tenant_id and exception.company_id=new.company_id
        and exception.service_id=new.service_id and exception.reporting_period_month=period_month) then return new; end if;
  end if;

  select s.name into service_name from public.services s where s.id=new.service_id and s.tenant_id=new.tenant_id;
  raise exception 'Monthly report required' using errcode='WF431',detail=jsonb_build_object(
    'orderId',new.id,'companyId',new.company_id,'serviceId',new.service_id,'serviceName',service_name,
    'reportingPeriodMonth',period_month,'canRecordException',private.current_user_role_name() in ('owner','admin','manager')
  )::text;
end;
$$;

create function public.app_set_order_reporting_month(p_order_id uuid,p_service_id uuid,p_reporting_period_month date)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  perform private.require_internal_actor();
  select * into o from public.orders where id=p_order_id and tenant_id=private.current_tenant_id() and archived_at is null for update;
  if o.id is null then raise no_data_found; end if;
  perform private.require_order_completion_authority(o);
  if p_service_id is distinct from o.service_id or not coalesce(private.is_monthly_reporting_service(o.service_id),false)
    or p_reporting_period_month is null or p_reporting_period_month not between date '0001-01-01' and date '9999-12-01'
    or extract(day from p_reporting_period_month)<>1 then
    raise exception 'Invalid reporting month scope' using errcode='22023';
  end if;
  if o.reporting_period_month is not distinct from p_reporting_period_month then return o; end if;
  if o.status='complete' then
    raise exception 'Completed work cannot change reporting month' using errcode='23505';
  end if;
  update public.orders set reporting_period_month=p_reporting_period_month where id=o.id returning * into o;
  perform private.record_authenticated_activity('order',o.id,'order.reporting_period_changed',
    'Selected the month this work covers.',jsonb_build_object('service_id',o.service_id,'reporting_period_month',p_reporting_period_month));
  return o;
end;
$$;

-- The explicit choice is saved separately from completion. Recheck it after locking
-- so a concurrent scope change cannot complete different work on a stale screen.
create function public.app_complete_order_for_reporting_month(p_order_id uuid,p_service_id uuid,p_reporting_period_month date)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  perform private.require_internal_actor();
  select * into o from public.orders where id=p_order_id and tenant_id=private.current_tenant_id() and archived_at is null for update;
  if o.id is null then raise no_data_found; end if;
  perform private.require_order_completion_authority(o);
  if p_service_id is distinct from o.service_id or not coalesce(private.is_monthly_reporting_service(o.service_id),false)
    or p_reporting_period_month is null or o.reporting_period_month is distinct from p_reporting_period_month then
    raise exception 'Reporting month scope changed; check the order again' using errcode='22023';
  end if;
  return public.app_change_order_status(o.id,'complete');
end;
$$;

revoke all on function public.app_set_order_reporting_month(uuid,uuid,date) from public,anon,authenticated,service_role;
revoke all on function public.app_complete_order_for_reporting_month(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.app_set_order_reporting_month(uuid,uuid,date),public.app_complete_order_for_reporting_month(uuid,uuid,date) to authenticated;
