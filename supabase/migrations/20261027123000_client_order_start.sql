-- Only new purchases with automatically assigned service intake enter this flow.
create table private.client_order_start_rollout(tenant_id uuid references public.tenants(id),service_id uuid references public.services(id),enabled boolean not null default false,primary key(tenant_id,service_id));
alter table private.client_order_start_rollout enable row level security;
alter table private.client_order_start_rollout force row level security;
revoke all on private.client_order_start_rollout from public,anon,authenticated,service_role;

create table private.client_order_starts (
  order_id uuid primary key references public.orders(id),
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  purchaser_id uuid not null references public.profiles(id),
  service_id uuid not null references public.services(id),
  assignment_ids uuid[] not null check (cardinality(assignment_ids) between 1 and 500),
  assignment_versions jsonb not null check (jsonb_typeof(assignment_versions)='object'),
  requested_at timestamptz,
  started_at timestamptz,
  last_attempt_at timestamptz,
  ready_at timestamptz,
  check (started_at is null or requested_at is not null)
);
alter table private.client_order_starts enable row level security;
alter table private.client_order_starts force row level security;
revoke all on private.client_order_starts from public,anon,authenticated,service_role;
create index client_order_starts_pending on private.client_order_starts(last_attempt_at nulls first,requested_at) where requested_at is not null and ready_at is not null and started_at is null;
create index client_order_starts_requirements on private.client_order_starts using gin(assignment_ids);

create function private.order_start_purchase_paid(g private.client_order_starts) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.invoices i join public.invoice_items item on item.invoice_id=i.id
    where item.order_id=g.order_id and item.service_id=g.service_id and item.fulfillment_status='provisioned'
      and i.tenant_id=g.tenant_id and i.company_id=g.company_id and i.client_profile_id=g.purchaser_id
      and i.billing_reason='store_purchase' and i.status='paid' and i.archived_at is null);
$$;
revoke all on function private.order_start_purchase_paid(private.client_order_starts) from public,anon,authenticated,service_role;

create function private.order_start_forms_complete(g private.client_order_starts) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists (
    select 1 from unnest(g.assignment_ids) as required(id)
    left join public.form_assignments a on a.id=required.id
    left join public.form_submissions s on s.id=a.latest_submission_id
    left join public.forms f on f.id=a.form_id
    where a.id is null or a.order_id is distinct from g.order_id
      or a.company_id is distinct from g.company_id or a.client_profile_id is distinct from g.purchaser_id
      or f.tenant_id is distinct from g.tenant_id or a.archived_at is not null
      or a.status is distinct from 'completed' or s.status is distinct from 'submitted'
      or s.form_assignment_id is distinct from a.id or s.form_version_id is distinct from a.form_version_id
      or s.form_id is distinct from a.form_id or s.company_id is distinct from g.company_id or s.order_id is distinct from g.order_id
      or g.assignment_versions->>a.id::text is distinct from a.form_version_id::text
  );
$$;

create function private.pending_order_intake_version(p_assignment_id uuid,p_version_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.client_order_starts g
    join public.form_assignments a on a.id=any(g.assignment_ids) and a.order_id=g.order_id
      and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id
    join public.orders o on o.id=g.order_id and o.tenant_id=g.tenant_id and o.company_id=g.company_id
    where a.id=p_assignment_id and a.form_version_id=p_version_id and g.assignment_versions->>a.id::text=p_version_id::text
      and a.status='assigned' and a.archived_at is null
      and g.started_at is null and o.archived_at is null and o.status='pending'
      and g.tenant_id=private.current_tenant_id()
      and ((auth.uid()=g.purchaser_id and private.current_user_company_id()=g.company_id and private.current_account_class()='client')
        or (private.current_account_class()='internal' and private.current_user_has_permission('forms.submissions_manage'))));
$$;

create function private.try_requested_order_start(p_order_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare g private.client_order_starts; o public.orders; started timestamptz; changed integer;
begin
  select * into g from private.client_order_starts where order_id=p_order_id;
  if g.order_id is null or g.requested_at is null or g.started_at is not null then return false; end if;
  -- Existing staff mutations sometimes lock order before tenant. Never wait in
  -- the opposite direction; a persisted request is retried by maintenance.
  perform 1 from public.tenants where id=g.tenant_id and status='active' and archived_at is null for update nowait;
  if not found then return false; end if;
  select * into o from public.orders where id=g.order_id for update nowait;
  select * into g from private.client_order_starts where order_id=p_order_id for update nowait;
  if not exists(select 1 from private.client_order_start_rollout where tenant_id=g.tenant_id and service_id=g.service_id and enabled) then return false; end if;
  if g.started_at is not null or g.requested_at is null or o.status<>'pending' or o.archived_at is not null
    or o.started_at is not null or o.service_id<>g.service_id or o.tenant_id<>g.tenant_id or o.company_id<>g.company_id then return false; end if;
  if not private.tenant_module_allowed(g.tenant_id,'projects') or not private.tenant_module_allowed(g.tenant_id,'forms')
    or not exists(select 1 from public.profiles p join public.tenant_memberships m on m.profile_id=p.id
      join public.roles r on r.id=m.role_id and r.name='client'
      join public.companies c on c.id=m.company_id and c.tenant_id=m.tenant_id and c.archived_at is null
      where p.id=g.purchaser_id and p.archived_at is null and m.archived_at is null and m.account_class='client'
        and m.tenant_id=g.tenant_id and m.company_id=g.company_id)
    or not private.profile_has_permission_in_tenant(g.purchaser_id,g.tenant_id,'projects.view')
    or not private.profile_has_permission_in_tenant(g.purchaser_id,g.tenant_id,'forms.view')
    or not private.order_start_forms_complete(g) then return false; end if;
  perform 1 from public.invoices i join public.invoice_items item on item.invoice_id=i.id
    where item.order_id=g.order_id and item.service_id=g.service_id and item.fulfillment_status='provisioned'
      and i.tenant_id=g.tenant_id and i.company_id=g.company_id and i.client_profile_id=g.purchaser_id
      and i.billing_reason='store_purchase' and i.status='paid' and i.archived_at is null for share of i nowait;
  if not found then return false; end if;
  started:=clock_timestamp();
  update private.client_order_starts set started_at=started where order_id=g.order_id;
  update public.orders set status='working',started_at=started
    where id=g.order_id and status='pending' and archived_at is null and started_at is null;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Order start could not be confirmed' using errcode='40001'; end if;
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
    values(g.purchaser_id,'order',g.order_id,'order.status_changed','Client started the order after completing service intake.',
      jsonb_build_object('from','pending','to','working','client_requested',true));
  return true;
exception when lock_not_available then return false;
end;
$$;

create function private.requested_order_start_transition(old_row public.orders,new_row public.orders) returns boolean
language sql stable security definer set search_path='' as $$
  select old_row.status='pending' and old_row.started_at is null and new_row.status='working'
    and (to_jsonb(new_row)-array['status','started_at','updated_at'])
      =(to_jsonb(old_row)-array['status','started_at','updated_at'])
    and exists(select 1 from private.client_order_starts g where g.order_id=old_row.id
      and g.tenant_id=new_row.tenant_id and g.company_id=new_row.company_id and g.service_id=new_row.service_id
      and g.requested_at is not null and g.started_at=new_row.started_at
      and g.purchaser_id=(select auth.uid()) and private.order_start_forms_complete(g));
$$;

create function private.guard_client_order_start() returns trigger
language plpgsql security definer set search_path='' as $$
declare g private.client_order_starts;
begin
  select * into g from private.client_order_starts where order_id=old.id;
  if g.order_id is null or g.started_at is not null then return new; end if;
  if new.status='canceled' and old.status<>'canceled' then
    update private.client_order_starts set requested_at=null where order_id=old.id;
  end if;
  if new.service_id is distinct from g.service_id or new.company_id is distinct from g.company_id or new.tenant_id is distinct from g.tenant_id then
    raise exception 'A purchased service cannot change while intake is pending' using errcode='23514'; end if;
  if new.status not in ('pending','canceled') or new.started_at is not null then
    raise exception 'The client must start the order and complete its required service forms first' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger guard_client_order_start before update on public.orders for each row execute function private.guard_client_order_start();

create function public.app_get_my_order_start(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.client_order_starts; o public.orders; requirements jsonb;
begin
  perform public.app_require_module_access('portal_projects');
  perform private.require_permission('projects.view');
  if private.current_account_class() is distinct from 'client' then raise exception 'Client account required' using errcode='42501'; end if;
  perform private.consume_rate_limit('order.start.read.minute',private.current_tenant_id()::text||':'||auth.uid()::text,interval '1 minute',120);
  select gate.* into g from private.client_order_starts gate join public.orders project on project.id=gate.order_id
    where gate.order_id=p_order_id and gate.purchaser_id=auth.uid() and gate.company_id=private.current_user_company_id()
      and gate.tenant_id=private.current_tenant_id() and project.tenant_id=gate.tenant_id and project.company_id=gate.company_id
      and project.archived_at is null;
  if g.order_id is null then return null; end if;
  perform public.app_require_module_access('portal_forms'); perform private.require_permission('forms.view');
  select * into o from public.orders where id=g.order_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',f.name,'completed',a.status='completed',
    'available',a.archived_at is null and f.archived_at is null and f.status='published') order by a.assigned_at),'[]'::jsonb)
    into requirements from public.form_assignments a join public.forms f on f.id=a.form_id and f.tenant_id=g.tenant_id
    where a.id=any(g.assignment_ids) and a.order_id=g.order_id and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id;
  return jsonb_build_object('order_id',g.order_id,'status',o.status,'requested',g.requested_at is not null,'started',g.started_at is not null,
    'available',o.status='pending' and o.archived_at is null and o.service_id=g.service_id and private.order_start_purchase_paid(g)
      and exists(select 1 from private.client_order_start_rollout where tenant_id=g.tenant_id and service_id=g.service_id and enabled),'forms',requirements);
end;
$$;

create function public.app_request_my_order_start(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;
begin
  state:=public.app_get_my_order_start(p_order_id);
  if state is null then raise exception 'Order start is unavailable' using errcode='42501'; end if;
  if (state->>'started')::boolean then return state; end if;
  if (state->>'available')::boolean is not true then raise exception 'Order start is unavailable' using errcode='23514'; end if;
  perform private.consume_rate_limit('order.start.actor.minute',private.current_tenant_id()::text||':'||auth.uid()::text,interval '1 minute',12);
  update private.client_order_starts set requested_at=clock_timestamp() where order_id=p_order_id and requested_at is null;
  -- Recheck current ownership after any wait on the request row.
  state:=public.app_get_my_order_start(p_order_id);
  if state is null then raise exception 'Order start is unavailable' using errcode='42501'; end if;
  if (state->>'available')::boolean is not true and (state->>'started')::boolean is not true then
    raise exception 'Order start is unavailable' using errcode='23514'; end if;
  perform private.try_requested_order_start(p_order_id);
  return public.app_get_my_order_start(p_order_id);
end;
$$;

create function public.app_reconcile_my_order_start(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project_id uuid; state jsonb;
begin
  select g.order_id into project_id from private.client_order_starts g join public.form_assignments a
    on a.id=any(g.assignment_ids) and a.order_id=g.order_id and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id
    where a.id=p_assignment_id and g.purchaser_id=auth.uid() and g.company_id=private.current_user_company_id() and g.tenant_id=private.current_tenant_id();
  if project_id is null then return null; end if;
  state:=public.app_get_my_order_start(project_id);
  if state is null then return null; end if;
  perform private.consume_rate_limit('order.start.reconcile.minute',private.current_tenant_id()::text||':'||auth.uid()::text,interval '1 minute',30);
  perform private.try_requested_order_start(project_id);
  return public.app_get_my_order_start(project_id);
end;
$$;

create function private.process_requested_order_starts() returns integer
language plpgsql security definer set search_path='' as $$
declare g record; processed integer:=0;
begin
  for g in select gate.order_id from private.client_order_starts gate
    where gate.requested_at is not null and gate.started_at is null and gate.ready_at is not null
      and exists(select 1 from private.client_order_start_rollout where tenant_id=gate.tenant_id and service_id=gate.service_id and enabled)
      and private.order_start_forms_complete(gate)
    order by last_attempt_at nulls first,requested_at limit 25 for update skip locked loop
    update private.client_order_starts set last_attempt_at=clock_timestamp() where order_id=g.order_id;
    if private.try_requested_order_start(g.order_id) then processed:=processed+1; end if;
  end loop;
  if exists(select 1 from pg_extension where extname='pg_cron')
    and extract(hour from now() at time zone 'UTC')=3 and extract(minute from now() at time zone 'UTC')=0 then
    delete from cron.job_run_details where end_time<now()-interval '7 days'
      and jobid in(select jobid from cron.job where jobname='wf-client-order-start-v1' and username=current_user);
  end if;
  return processed;
end;
$$;

create function public.app_server_process_order_starts() returns integer
language plpgsql security definer set search_path='' as $$
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server maintenance required' using errcode='42501'; end if;
  return private.process_requested_order_starts();
end;
$$;
revoke all on function private.process_requested_order_starts() from public,anon,authenticated,service_role;

create function private.mark_order_start_ready() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.client_order_starts g set ready_at=case when private.order_start_forms_complete(g) then clock_timestamp() else null end
    where g.assignment_ids @> array[new.id] and g.started_at is null;
  return new;
end;
$$;
revoke all on function private.mark_order_start_ready() from public,anon,authenticated,service_role;
create trigger mark_order_start_ready after update of status,latest_submission_id,archived_at on public.form_assignments
  for each row execute function private.mark_order_start_ready();

revoke all on function private.order_start_forms_complete(private.client_order_starts),
  private.pending_order_intake_version(uuid,uuid), private.try_requested_order_start(uuid),
  private.requested_order_start_transition(public.orders,public.orders),private.guard_client_order_start()
  from public,anon,authenticated,service_role;
revoke all on function public.app_get_my_order_start(uuid),public.app_request_my_order_start(uuid),public.app_reconcile_my_order_start(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.app_get_my_order_start(uuid),public.app_request_my_order_start(uuid),public.app_reconcile_my_order_start(uuid) to authenticated;
revoke all on function public.app_server_process_order_starts() from public,anon,authenticated,service_role;
grant execute on function public.app_server_process_order_starts() to service_role;

create function public.app_my_intake_version_available(p_assignment_id uuid,p_version_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.app_require_module_access('portal_forms'); perform private.require_permission('forms.view');
  if private.current_account_class() is distinct from 'client' then return false; end if;
  return exists(select 1 from public.form_assignments a join public.forms f on f.id=a.form_id
    join public.form_versions v on v.id=a.form_version_id and v.lifecycle_state='published'
    where a.id=p_assignment_id and a.form_version_id=p_version_id and a.client_profile_id=auth.uid()
      and a.company_id=private.current_user_company_id() and f.tenant_id=private.current_tenant_id()
      and a.archived_at is null and a.status='assigned' and f.archived_at is null and f.status='published'
      and (f.published_version_id=a.form_version_id or private.pending_order_intake_version(a.id,a.form_version_id)));
end;
$$;
revoke all on function public.app_my_intake_version_available(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_my_intake_version_available(uuid,uuid) to authenticated;


-- Preserve existing authorization; add only the purchased-order start boundary.
create or replace function private.assign_purchase_intake_forms(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  project_row public.orders;
  intake record;
  assignment_id uuid;
  assigned_count integer := 0;
begin
  select project.* into project_row
  from public.orders project
  join public.companies company on company.id = project.company_id
    and company.tenant_id = project.tenant_id and company.archived_at is null
  join public.tenant_memberships membership on membership.company_id = company.id
    and membership.tenant_id = project.tenant_id and membership.profile_id = actor_id
    and membership.account_class = 'client' and membership.archived_at is null
  join public.roles role on role.id = membership.role_id and role.name = 'client'
  join public.profiles profile on profile.id = actor_id and profile.archived_at is null
  where project.id = p_order_id and project.archived_at is null
    and project.tenant_id = private.current_tenant_id()
    and exists (
      select 1 from public.invoice_items item
      join public.invoices invoice on invoice.id = item.invoice_id
      where item.order_id = project.id and item.service_id = project.service_id
        and item.fulfillment_status = 'provisioned'
        and invoice.company_id = project.company_id and invoice.client_profile_id = actor_id
        and invoice.tenant_id = project.tenant_id and invoice.status = 'paid'
        and invoice.billing_reason = 'store_purchase' and invoice.archived_at is null
    );
  if project_row.id is null then
    raise exception 'Purchase intake context is unavailable' using errcode = '42501';
  end if;
  if not private.tenant_module_allowed(project_row.tenant_id, 'forms') then return 0; end if;
  perform private.require_forms_write(project_row.tenant_id);

  for intake in
    select form.id, form.published_version_id
    from public.forms form
    join public.form_versions version on version.id = form.published_version_id
      and version.form_id = form.id and version.lifecycle_state = 'published'
    where form.tenant_id = project_row.tenant_id and form.form_type = 'intake'
      and form.status = 'published' and form.archived_at is null
      and exists (
        select 1 from public.form_service_links link
        where link.form_version_id = version.id and link.form_version_field_id is null
          and link.role = 'intake_assignment' and link.service_id = project_row.service_id
      )
    order by form.id
    for share of form
  loop
    assignment_id := null;
    insert into public.form_assignments (
      form_id, form_version_id, company_id, client_profile_id, order_id,
      required, assigned_by_profile_id
    ) values (
      intake.id, intake.published_version_id, project_row.company_id, actor_id,
      project_row.id, true, actor_id
    ) on conflict (form_id, order_id) where order_id is not null and status = 'assigned'
      do nothing
    returning id into assignment_id;
    if assignment_id is not null then
      insert into public.activity_events(actor_profile_id, entity_type, entity_id, action, summary, metadata)
      values (
        actor_id, 'form_assignment', assignment_id, 'form.assigned',
        'Automatically assigned Intake Form after Service purchase.',
        jsonb_build_object('form_id', intake.id, 'form_version_id', intake.published_version_id,
          'company_id', project_row.company_id, 'order_id', project_row.id,
          'client_profile_id', actor_id, 'automatic', true)
      );
      assigned_count := assigned_count + 1;
    end if;
  end loop;
  if assigned_count>0 and exists(select 1 from private.client_order_start_rollout where tenant_id=project_row.tenant_id and service_id=project_row.service_id and enabled) then
    begin
      perform public.app_require_module_access('portal_projects'); perform private.require_permission('projects.view');
      perform public.app_require_module_access('portal_forms'); perform private.require_permission('forms.view');
    exception when insufficient_privilege then return assigned_count;
    end;
    insert into private.client_order_starts(order_id,tenant_id,company_id,purchaser_id,service_id,assignment_ids,assignment_versions)
    select project_row.id,project_row.tenant_id,project_row.company_id,actor_id,project_row.service_id,
      array_agg(a.id order by a.id),jsonb_object_agg(a.id::text,a.form_version_id::text)
    from public.form_assignments a where a.order_id=project_row.id and a.client_profile_id=actor_id
      and a.company_id=project_row.company_id and a.required and a.archived_at is null and a.status='assigned'
    having count(*)>0 on conflict(order_id) do nothing;
  end if;
  return assigned_count;
end;
$$;

CREATE OR REPLACE FUNCTION private.enforce_order_permission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  context_payment_id uuid;
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.archived_at is null
      and new.status not in ('complete', 'canceled')) then
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = new.tenant_id for update;
  if ((select auth.uid()) is not null or exists (
      select 1 from private.tenant_module_publications where tenant_id = new.tenant_id
    )) and not private.tenant_module_allowed(new.tenant_id, 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;
  end if;
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    begin
      context_payment_id := nullif(
        current_setting('app.wf_store_purchase_payment_id', true), ''
      )::uuid;
    exception when invalid_text_representation then
      context_payment_id := null;
    end;

    if context_payment_id is not null
      and new.assigned_to_profile_id is null
      and new.status = 'pending'
      and new.archived_at is null
      and exists (
        select 1
        from public.invoice_payments as payment_row
        join public.invoices as invoice_row
          on invoice_row.id = payment_row.invoice_id
        join public.invoice_items as item_row
          on item_row.invoice_id = invoice_row.id
         and item_row.service_id = new.service_id
        where payment_row.id = context_payment_id
          and payment_row.created_by_profile_id = (select auth.uid())
          and payment_row.status = 'succeeded'
          and payment_row.payment_method = 'wolf_forge_wallet'
          and (select private.current_user_company_id()) = invoice_row.company_id
          and invoice_row.billing_reason = 'store_purchase'
          and invoice_row.status = 'paid'
          and invoice_row.company_id = new.company_id
      )
    then
      return new;
    end if;

    perform private.require_permission('projects.create');

    if new.assigned_to_profile_id is distinct from (select auth.uid())
      and new.assigned_to_profile_id is not null
    then
      perform private.require_permission('projects.assign');
    end if;

    return new;
  end if;

  if private.requested_order_start_transition(old,new) then return new; end if;

  if not private.can_access_operational_order(old.id) then
    raise exception 'project access is denied'
      using errcode = '42501';
  end if;

  if new.assigned_to_profile_id is distinct from old.assigned_to_profile_id then
    perform private.require_permission('projects.assign');
  end if;

  if new.archived_at is not null and old.archived_at is null then
    perform private.require_permission('projects.archive');
  else
    perform private.require_permission('projects.edit');
  end if;

  return new;
end;
$function$;

create or replace function private.require_intake_recipient(p_assignment_id uuid)
returns public.form_assignments language plpgsql security definer set search_path = '' as $function$
declare assignment public.form_assignments; tenant uuid;
begin
  perform private.require_permission('forms.view');
  select a.* into assignment
  from public.form_assignments a join public.forms f on f.id = a.form_id
  where a.id = p_assignment_id and a.archived_at is null and a.status = 'assigned'
    and f.archived_at is null and f.status = 'published' and (f.published_version_id = a.form_version_id or private.pending_order_intake_version(a.id,a.form_version_id))
    and f.form_type in ('intake', 'onboarding') and f.tenant_id = private.current_tenant_id();
  if assignment.id is null or private.current_account_class() is distinct from 'client'
    or assignment.client_profile_id is distinct from auth.uid()
    or assignment.company_id is distinct from private.current_user_company_id() then
    raise exception 'Form assignment access is denied' using errcode = '42501'; end if;
  tenant := private.current_tenant_id();
  perform private.require_forms_write(tenant);
  return assignment;
end;
$function$;

create or replace function public.app_submit_form(p_request_id uuid, p_form_version_id uuid, p_context jsonb, p_values jsonb, p_files jsonb DEFAULT '[]'::jsonb)
 RETURNS form_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  actor_class text;
  form_tenant_id uuid;
  form_visibility text;
  actor_company_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  assignment_row public.form_assignments;
  submission_row public.form_submissions;
  field_row public.form_version_fields;
  submitted_value jsonb;
  company_id_value uuid;
  client_profile_id_value uuid;
  order_id_value uuid;
  orchestration_type_value text;
  orchestration_status_value text := 'not_required';
  existing_id uuid;
  identity_key text;
  request_payload jsonb := jsonb_build_object(
    'form_version_id', p_form_version_id,
    'context', coalesce(p_context, '{}'::jsonb) - 'bot_token',
    'values', p_values,
    'files', coalesce(p_files, '[]'::jsonb)
  );
begin
  if p_context is null
    or jsonb_typeof(p_context) <> 'object'
    or p_context - array[
      'assignment_id', 'order_id', 'company_id', 'client_profile_id', 'bot_token'
    ] <> '{}'::jsonb
    or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  if p_context ? 'bot_token'
    and (jsonb_typeof(p_context -> 'bot_token') <> 'string'
      or char_length(p_context ->> 'bot_token') > 4096)
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;

  -- Size first: an oversized payload is rejected before it is parsed field by
  -- field, and before any lock is taken.
  perform private.enforce_form_payload_limits(p_values);

  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 0 then
    raise exception 'Form file upload storage boundary is not available'
      using errcode = '55000';
  end if;

  select f.tenant_id into form_tenant_id from public.forms f join public.form_versions v on v.form_id=f.id where v.id=p_form_version_id;
  if form_tenant_id is null then raise no_data_found; end if;
  perform private.lock_tenant_module_lifecycle(form_tenant_id);

  -- The Form decides the Tenant. A signed-in caller acts through its active
  -- membership in the Form's Tenant (the selected Tenant), never its global
  -- role. Without one, a public Form takes the caller as an anonymous guest;
  -- any other Form refuses it.
  if actor_id is not null then
    select form.tenant_id, form.visibility
    into form_tenant_id, form_visibility
    from public.form_versions as version
    join public.forms as form on form.id = version.form_id
    where version.id = p_form_version_id;

    if form_tenant_id is null
      or form_tenant_id = (select private.current_tenant_id())
    then
      actor_class := (select private.current_account_class());
    end if;

    if actor_class is null
      and form_visibility = 'public'
      and exists (
        select 1 from public.profiles as profile
        where profile.id = actor_id and profile.archived_at is null
      )
    then
      actor_id := null;
    end if;
  end if;

  if actor_id is not null then
    select profile.* into actor_profile
    from public.profiles as profile
    where profile.id = actor_id
      and profile.archived_at is null;

    if actor_profile.id is null or actor_class is null then
      raise exception 'active Form submitter is required' using errcode = '42501';
    end if;
  end if;

  -- Every authenticated client submission reauthorizes the portal module
  -- before the idempotency lookup, so revoking Forms access is immediate.
  if actor_class = 'client' then
    perform private.require_permission('forms.view');

    actor_company_id := private.current_user_company_id();
    if actor_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    -- Preliminary ownership check for client submissions carrying an
    -- assignment id. It intentionally does not require status = assigned:
    -- the Intake/Onboarding path re-validates the exact Form, version and
    -- status below, and every other Form type refuses an assignment id.
    if p_context ? 'assignment_id' then
      select assignment.* into assignment_row
      from public.form_assignments as assignment
      where assignment.id = (p_context ->> 'assignment_id')::uuid
        and assignment.archived_at is null;

      if assignment_row.id is null
        or assignment_row.company_id is distinct from actor_company_id
        or assignment_row.client_profile_id is distinct from actor_id
      then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    end if;
  end if;

  existing_id := private.find_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload
  );
  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);
  if existing_id is not null then
    select * into submission_row
    from public.form_submissions
    where id = existing_id;
    if submission_row.id is null then raise no_data_found; end if;
    if actor_id is null then
      if submission_row.submitted_by_profile_id is not null or not exists(select 1 from public.forms f join public.tenants t on t.id=f.tenant_id where f.id=submission_row.form_id and f.visibility='public' and f.archived_at is null and t.status='active' and t.archived_at is null) then raise exception 'Form replay access is denied' using errcode='42501'; end if;
      submission_row:=null;
      submission_row.id:=existing_id;
    else
      if not private.can_read_form_submission(existing_id) then raise exception 'Form replay access is denied' using errcode='42501'; end if;
      if not private.can_access_operational_order(submission_row.order_id) then submission_row.order_id:=null; end if;
      if not private.can_access_ticket((submission_row.provenance->>'ticket_id')::uuid) then submission_row.provenance:=submission_row.provenance-'ticket_id'; end if;
    end if;
    return private.redact_form_submission(submission_row);
  end if;
  perform private.require_forms_write(form_tenant_id);

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.lifecycle_state = 'published'
  for share;
  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);
  if version_row.id is null then raise no_data_found; end if;

  select form.* into form_row
  from public.forms as form
  where form.id = version_row.form_id
    and form.status = 'published'
    and form.archived_at is null
    and (form.published_version_id = version_row.id or private.pending_order_intake_version((p_context->>'assignment_id')::uuid,version_row.id))
    -- KI-138: only an active owning Tenant's Form accepts submissions. Same
    -- refusal as an unavailable Form, so the Tenant status is not disclosed.
    and exists (
      select 1 from public.tenants as tenant
      where tenant.id = form.tenant_id
        and tenant.status = 'active'
        and tenant.archived_at is null
    )
  for share;
  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);
  if form_row.id is null then
    raise exception 'Form version is unavailable for submission'
      using errcode = '55000';
  end if;

  if form_row.visibility = 'public' then
    if form_row.form_type not in ('order', 'contact') then
      raise exception 'assigned Form cannot be public' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'authenticated' then
    if actor_id is null then
      raise exception 'Form authentication is required' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'assigned' then
    if actor_id is null or not p_context ? 'assignment_id' then
      raise exception 'Form assignment is required' using errcode = '42501';
    end if;
  end if;

  -- M-03. The Form is known and this is not a replay, so throttle now. Every
  -- write below this line is inside the same transaction, so a raise here
  -- leaves no submission, no values, no activity, no Ticket and no
  -- notification behind.
  identity_key := private.form_submission_identity_key(version_row.id, p_values);
  perform private.enforce_form_submission_rate(form_row.id, actor_id, identity_key);
  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);

  if form_row.visibility = 'public' then
    perform private.require_bot_verification(
      'form.submit', form_row.id::text, p_context ->> 'bot_token'
    );
  end if;


  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);
  if form_row.form_type in ('intake', 'onboarding') then
    select assignment.* into assignment_row
    from public.form_assignments as assignment
    where assignment.id = (p_context ->> 'assignment_id')::uuid
      and assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
    for update;
  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);

    if assignment_row.id is null then
      raise exception 'active Form assignment is required' using errcode = '42501';
    end if;

    if actor_class = 'client' and (
      actor_company_id is distinct from assignment_row.company_id
      or actor_id is distinct from assignment_row.client_profile_id
    ) then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if actor_class <> 'client'
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;

    if actor_class <> 'client'
      and form_row.tenant_id <> (select private.current_tenant_id())
    then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    company_id_value := assignment_row.company_id;
    client_profile_id_value := assignment_row.client_profile_id;
    order_id_value := assignment_row.order_id;
  else
    -- The assignment's stored Form relationship is authoritative. Order and
    -- Contact Forms are never legitimately submitted with an assignment id
    -- (the renderer only sends one for assigned Forms, and app_assign_form
    -- only creates assignments for Intake and Onboarding Forms), so refuse
    -- instead of completing someone's onboarding assignment with an
    -- unrelated submission.
    if p_context ? 'assignment_id' then
      raise exception 'Form assignment does not match the submitted Form'
        using errcode = '42501';
    end if;

    if actor_class = 'client' then
      company_id_value := actor_company_id;
      client_profile_id_value := actor_profile.id;
    elsif actor_id is not null
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;
  end if;

  if p_context ? 'company_id'
    and (p_context ->> 'company_id')::uuid is distinct from company_id_value
  then
    raise exception 'Form company context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'client_profile_id'
    and (p_context ->> 'client_profile_id')::uuid is distinct from client_profile_id_value
  then
    raise exception 'Form client context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'order_id'
    and (p_context ->> 'order_id')::uuid is distinct from order_id_value
  then
    raise exception 'Form Order context cannot be spoofed' using errcode = '42501';
  end if;

  perform private.validate_form_submission_values(version_row.id, p_values);

  if form_row.form_type = 'order' then
    orchestration_type_value := 'order_checkout';
    orchestration_status_value := 'deferred';
  elsif form_row.form_type = 'contact' then
    perform private.lock_tenant_module_lifecycle(form_row.tenant_id);
    if private.tenant_module_allowed(form_row.tenant_id,'tickets') then
      orchestration_type_value := 'contact_ticket';
      orchestration_status_value := 'deferred';
    end if;
  end if;

  perform private.require_current_form_submitter(actor_id,form_tenant_id,actor_class,actor_company_id);
  if actor_class='internal' then perform private.require_form_capability('forms.submissions_manage'); end if;
  submission_row.id := gen_random_uuid();
  insert into public.form_submissions (
    id,
    form_id,
    form_version_id,
    form_assignment_id,
    company_id,
    client_profile_id,
    order_id,
    root_submission_id,
    revision_number,
    orchestration_type,
    orchestration_status,
    submitted_by_profile_id,
    provenance
  ) values (
    submission_row.id,
    form_row.id,
    version_row.id,
    assignment_row.id,
    company_id_value,
    client_profile_id_value,
    order_id_value,
    submission_row.id,
    1,
    orchestration_type_value,
    orchestration_status_value,
    actor_id,
    jsonb_build_object(
      'form_type', form_row.form_type,
      'schema_hash', version_row.schema_hash,
      'type_config', version_row.type_config,
      'orchestration_deferred', orchestration_status_value = 'deferred',
      'tickets_enabled_at_submission', case when form_row.form_type='contact'
        then coalesce(orchestration_type_value='contact_ticket',false) else null end
    )
  ) returning * into submission_row;

  for submitted_value in
    select value from jsonb_array_elements(p_values)
  loop
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.stable_field_key = (submitted_value ->> 'field_key')::uuid;

    insert into public.form_submission_values (
      submission_id,
      form_version_field_id,
      stable_field_key,
      field_label_snapshot,
      field_type_snapshot,
      sort_order_snapshot,
      value
    ) values (
      submission_row.id,
      field_row.id,
      field_row.stable_field_key,
      field_row.label,
      field_row.field_type,
      field_row.sort_order,
      submitted_value -> 'value'
    );
  end loop;

  if assignment_row.id is not null then
    update public.form_assignments
    set
      status = 'completed',
      completed_at = now(),
      latest_submission_id = submission_row.id
    where id = assignment_row.id;
  end if;

  -- private.record_form_activity takes auth.uid(); a guest is recorded with
  -- no actor, like an anonymous visitor.
  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id,
    'form_submission',
    submission_row.id,
    'form.submitted',
    format('Submitted %s Form.', initcap(form_row.form_type)),
    jsonb_build_object(
      'form_id', form_row.id,
      'form_version_id', version_row.id,
      'assignment_id', assignment_row.id,
      'company_id', company_id_value,
      'order_id', order_id_value
    )
  );
  perform private.remember_form_submission_request(
    'form.submit',
    p_request_id,
    actor_id,
    request_payload,
    submission_row.id
  );
  if actor_id is null then
    existing_id:=submission_row.id;
    submission_row:=null;
    submission_row.id:=existing_id;
  end if;
  return private.redact_form_submission(submission_row);
end;
$function$;


create or replace function private.enforce_forms_module_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_form uuid; target_tenant uuid; parent public.form_submissions; assignment public.form_assignments;
begin
  if tg_op in ('UPDATE','DELETE') then
    target_form:=private.form_write_parent(tg_table_name,to_jsonb(old));
    if tg_table_name='forms' then target_tenant:=old.tenant_id;
    else select tenant_id into target_tenant from public.forms where id=target_form; end if;
    perform private.require_forms_write(target_tenant);
  end if;
  if tg_op='DELETE' then return old; end if;
  target_form:=private.form_write_parent(tg_table_name,to_jsonb(new));
  if tg_table_name='forms' then target_tenant:=new.tenant_id;
  else select tenant_id into target_tenant from public.forms where id=target_form; end if;
  perform private.require_forms_write(target_tenant);

  if tg_table_name<>'forms' and (auth.uid() is not null or exists(select 1 from private.tenant_module_publications where tenant_id=target_tenant)) then
    if not exists(select 1 from public.forms where id=target_form and archived_at is null) then
      raise exception 'Form parent is unavailable' using errcode='55000';
    end if;
    if tg_table_name in ('form_assignments','form_submissions') then
      if new.company_id is not null and not exists(select 1 from public.companies where id=new.company_id and archived_at is null) then raise exception 'Form Company is unavailable' using errcode='55000'; end if;
      if new.client_profile_id is not null and not exists(select 1 from public.profiles where id=new.client_profile_id and archived_at is null) then raise exception 'Form assignee is unavailable' using errcode='55000'; end if;
    end if;
    if tg_table_name='form_submissions' then
      if new.form_assignment_id is not null and not exists(select 1 from public.form_assignments where id=new.form_assignment_id and archived_at is null) then raise exception 'Form assignment is unavailable' using errcode='55000'; end if;
      if tg_op='INSERT' and new.root_submission_id is not distinct from new.id and new.supersedes_submission_id is null then
        if not exists(select 1 from public.forms f join public.form_versions v on v.id=new.form_version_id
          where f.id=new.form_id and f.status='published' and (f.published_version_id=v.id or private.pending_order_intake_version(new.form_assignment_id,v.id)) and v.form_id=f.id and v.lifecycle_state='published') then
          raise exception 'Form version is unavailable for submission' using errcode='55000';
        end if;
        if new.form_assignment_id is not null and not exists(select 1 from public.form_assignments where id=new.form_assignment_id and status='assigned') then
          raise exception 'Form assignment is unavailable' using errcode='55000';
        end if;
      end if;
    end if;
    if tg_table_name in ('form_submission_values','form_files') then
      select * into parent from public.form_submissions where id=new.submission_id;
      if parent.company_id is not null and not exists(select 1 from public.companies where id=parent.company_id and archived_at is null) then raise exception 'Form Company is unavailable' using errcode='55000'; end if;
      if parent.client_profile_id is not null and not exists(select 1 from public.profiles where id=parent.client_profile_id and archived_at is null) then raise exception 'Form assignee is unavailable' using errcode='55000'; end if;
      if parent.form_assignment_id is not null and not exists(select 1 from public.form_assignments where id=parent.form_assignment_id and archived_at is null) then raise exception 'Form assignment is unavailable' using errcode='55000'; end if;
    end if;
  end if;

  if tg_op='UPDATE' then
    if tg_table_name='forms' then
      if new.tenant_id is distinct from old.tenant_id then raise exception 'Form Tenant ownership is immutable' using errcode='23514'; end if;
    elsif private.form_write_parent(tg_table_name,to_jsonb(old)) is distinct from target_form then
      raise exception 'Form parent ownership is immutable' using errcode='23514';
    end if;
    if tg_table_name='form_assignments' then
      if (new.form_version_id,new.company_id,new.client_profile_id,new.order_id) is distinct from (old.form_version_id,old.company_id,old.client_profile_id,old.order_id) then
        raise exception 'Form assignment context is immutable' using errcode='23514';
      end if;
    end if;
  end if;
  if tg_table_name='form_service_links' then
    if new.form_version_field_id is not null and not exists(select 1 from public.form_version_fields f where f.id=new.form_version_field_id and f.form_version_id=new.form_version_id) then
      raise exception 'Form Service field mismatch' using errcode='23514';
    end if;
  end if;

  if tg_table_name in ('form_assignments','form_submissions') then
    if new.company_id is not null and not exists(select 1 from public.companies c where c.id=new.company_id and c.tenant_id=target_tenant) then raise exception 'Form Company mismatch' using errcode='23514'; end if;
    if new.client_profile_id is not null and not exists(select 1 from public.tenant_memberships m where m.profile_id=new.client_profile_id and m.tenant_id=target_tenant and m.company_id=new.company_id and m.account_class='client' and m.archived_at is null) then raise exception 'Form assignee mismatch' using errcode='23514'; end if;
    if new.order_id is not null and not exists(select 1 from public.orders o where o.id=new.order_id and o.tenant_id=target_tenant and o.company_id=new.company_id) then raise exception 'Form Project mismatch' using errcode='23514'; end if;
  end if;

  if tg_table_name='form_submission_values' then
    if new.field_type_snapshot='richtext' and exists(select 1 from public.form_version_fields f
      where f.id=new.form_version_field_id and f.settings->'display_only'='true'::jsonb) then
      raise exception 'Display-only content cannot collect answers' using errcode='22023';
    end if;
  end if;

  if tg_table_name='form_submissions' then
    if new.form_assignment_id is not null then
      select * into assignment from public.form_assignments where id=new.form_assignment_id;
      if assignment.id is null or assignment.form_id is distinct from new.form_id
        or assignment.form_version_id is distinct from new.form_version_id
        or assignment.company_id is distinct from new.company_id
        or assignment.client_profile_id is distinct from new.client_profile_id
        or assignment.order_id is distinct from new.order_id then
        raise exception 'Form receipt assignment mismatch' using errcode='23514';
      end if;
    end if;
    if new.root_submission_id is distinct from new.id then
      select * into parent from public.form_submissions where id=new.root_submission_id;
      if parent.id is null or parent.form_id is distinct from new.form_id
        or parent.form_version_id is distinct from new.form_version_id
        or parent.form_assignment_id is distinct from new.form_assignment_id
        or parent.company_id is distinct from new.company_id
        or parent.client_profile_id is distinct from new.client_profile_id
        or parent.order_id is distinct from new.order_id then
        raise exception 'Form receipt root mismatch' using errcode='23514';
      end if;
    end if;
    if new.supersedes_submission_id is not null then
      select * into parent from public.form_submissions where id=new.supersedes_submission_id;
      if parent.id is null or parent.root_submission_id is distinct from new.root_submission_id
        or parent.form_id is distinct from new.form_id or parent.form_version_id is distinct from new.form_version_id then
        raise exception 'Form correction predecessor mismatch' using errcode='23514';
      end if;
      new.orchestration_type:=null;
      new.orchestration_status:='not_required';
    elsif tg_op='INSERT' and exists(select 1 from public.forms where id=new.form_id and form_type='contact') then
      if not private.tenant_module_allowed(target_tenant,'tickets') then
        new.orchestration_type:=null;
        new.orchestration_status:='not_required';
        new.provenance:=new.provenance || '{"tickets_enabled_at_submission":false}'::jsonb;
      else
        new.provenance:=new.provenance || jsonb_build_object('tickets_enabled_at_submission',new.orchestration_type='contact_ticket');
      end if;
    end if;
  elsif tg_table_name in ('form_submission_values','form_files') then
    select * into parent from public.form_submissions where id=new.submission_id;
    if not exists(select 1 from public.form_version_fields f where f.id=new.form_version_field_id
      and f.form_version_id=parent.form_version_id and f.stable_field_key=new.stable_field_key) then
      raise exception 'Form answer field mismatch' using errcode='23514';
    end if;
  elsif tg_table_name='form_assignments' then
    if new.latest_submission_id is not null then
      select * into parent from public.form_submissions where id=new.latest_submission_id;
      if parent.id is null or parent.form_assignment_id is distinct from new.id
        or parent.form_id is distinct from new.form_id or parent.form_version_id is distinct from new.form_version_id
        or parent.company_id is distinct from new.company_id or parent.client_profile_id is distinct from new.client_profile_id or parent.order_id is distinct from new.order_id then
        raise exception 'Form assignment receipt mismatch' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
