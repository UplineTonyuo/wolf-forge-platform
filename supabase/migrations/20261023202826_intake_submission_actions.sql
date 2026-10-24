alter function private.validate_form_type_config(text,jsonb) rename to validate_form_type_config_before_intake_actions;
revoke all on function private.validate_form_type_config_before_intake_actions(text,jsonb) from public,anon,authenticated,service_role;
create function private.validate_form_type_config(p_form_type text,p_config jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $function$
declare result jsonb; actions jsonb; days integer;
begin
  if p_form_type not in ('intake','onboarding') then return private.validate_form_type_config_before_intake_actions(p_form_type,p_config); end if;
  result := private.validate_form_type_config_before_intake_actions(p_form_type,coalesce(p_config,'{}'::jsonb)-array['automation','reminder_days']);
  days := coalesce((p_config->>'reminder_days')::integer,0);
  if days not between 0 and 30 then raise exception 'Reminder interval must be 0 to 30 days' using errcode='22023'; end if;
  actions := coalesce(p_config->'automation','{}'::jsonb);
  if jsonb_typeof(actions) is distinct from 'object' or actions-array['create_project','service_id','project_title','task_title','crm_status','workflow_steps']<>'{}'::jsonb
    or (actions ? 'create_project' and jsonb_typeof(actions->'create_project')<>'boolean')
    or (actions ? 'workflow_steps' and jsonb_typeof(actions->'workflow_steps')<>'array') then
    raise exception 'Invalid submission actions' using errcode='22023'; end if;
  if (actions->>'service_id' is not null and jsonb_typeof(actions->'service_id')<>'string')
    or (actions->>'project_title' is not null and jsonb_typeof(actions->'project_title')<>'string')
    or (actions->>'task_title' is not null and jsonb_typeof(actions->'task_title')<>'string')
    or (actions->>'crm_status' is not null and jsonb_typeof(actions->'crm_status')<>'string') then
    raise exception 'Invalid submission action values' using errcode='22023'; end if;
  if coalesce((actions->>'create_project')::boolean,false) and (
    actions->>'service_id' is null or (actions->>'service_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or length(btrim(coalesce(actions->>'project_title',''))) not between 1 and 200) then
    raise exception 'Choose a Service and project title for project creation' using errcode='22023'; end if;
  if actions->>'task_title' is not null and length(btrim(actions->>'task_title')) not between 1 and 200 then
    raise exception 'Invalid task title' using errcode='22023'; end if;
  if actions->>'crm_status' is not null and actions->>'crm_status' not in ('contact','lead','client','client_team') then
    raise exception 'Invalid CRM status' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(actions->'workflow_steps','[]'::jsonb))>20 or exists(
    select 1 from jsonb_array_elements(coalesce(actions->'workflow_steps','[]'::jsonb)) step
    where jsonb_typeof(step)<>'string' or length(btrim(step#>>'{}')) not between 1 and 200) then
    raise exception 'Use up to 20 workflow tasks, each up to 200 characters' using errcode='22023'; end if;
  if p_form_type='onboarding' and not coalesce((actions->>'create_project')::boolean,false)
    and (actions->>'task_title' is not null or jsonb_array_length(coalesce(actions->'workflow_steps','[]'::jsonb))>0) then
    raise exception 'This form needs project creation before it can create tasks' using errcode='22023'; end if;
  return result||jsonb_build_object('automation',actions,'reminder_days',days);
end;
$function$;
revoke all on function private.validate_form_type_config(text,jsonb) from public,anon,authenticated,service_role;

create table private.intake_submission_jobs (
  submission_id uuid primary key references public.form_submissions(id),
  tenant_id uuid not null references public.tenants(id),
  authorizer_id uuid not null references public.profiles(id),
  configuration jsonb not null,
  status text not null default 'queued' check(status in ('queued','completed','blocked')),
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table private.intake_submission_jobs enable row level security;
revoke all on private.intake_submission_jobs from public,anon,authenticated,service_role;

create function private.queue_intake_submission_actions() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare version public.form_versions; tenant uuid; actions jsonb;
begin
  if new.status<>'completed' or old.status<>'assigned' or new.latest_submission_id is null then return new; end if;
  select * into version from public.form_versions where id=new.form_version_id;
  actions:=coalesce(version.type_config->'automation','{}'::jsonb);
  if not coalesce((actions->>'create_project')::boolean,false) and actions->>'task_title' is null
    and actions->>'crm_status' is null and jsonb_array_length(coalesce(actions->'workflow_steps','[]'::jsonb))=0 then return new; end if;
  select tenant_id into tenant from public.forms where id=new.form_id;
  insert into private.intake_submission_jobs(submission_id,tenant_id,authorizer_id,configuration)
  values(new.latest_submission_id,tenant,version.published_by_profile_id,actions) on conflict do nothing;
  return new;
end;
$function$;
revoke all on function private.queue_intake_submission_actions() from public,anon,authenticated,service_role;
create trigger queue_intake_submission_actions after update of status on public.form_assignments
for each row execute function private.queue_intake_submission_actions();

create function public.app_server_run_intake_job(p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare job private.intake_submission_jobs; submission public.form_submissions; actions jsonb;
  company public.companies; project_id uuid; service_id uuid; task_id uuid; step text; position integer:=0; tasks jsonb:='[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server job access required' using errcode='42501'; end if;
  select * into job from private.intake_submission_jobs where submission_id=p_submission_id for update;
  if not found then return jsonb_build_object('status','not_required'); end if;
  if job.status<>'queued' then return jsonb_build_object('status',job.status,'result',job.result); end if;
  begin
    perform private.lock_tenant_module_lifecycle(job.tenant_id);
    perform private.require_forms_write(job.tenant_id);
    if not exists(select 1 from public.tenants where id=job.tenant_id and status='active' and archived_at is null) then
      raise exception 'Tenant unavailable' using errcode='42501'; end if;
    if not exists(select 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id
      where m.tenant_id=job.tenant_id and m.profile_id=job.authorizer_id and m.account_class='internal'
        and m.archived_at is null and p.archived_at is null)
      or not private.profile_has_permission_in_tenant(job.authorizer_id,job.tenant_id,'forms.publish') then
      raise exception 'Form publisher no longer authorized' using errcode='42501'; end if;
    select * into submission from public.form_submissions where id=job.submission_id and status='submitted' and supersedes_submission_id is null;
    select * into company from public.companies where id=submission.company_id and tenant_id=job.tenant_id and archived_at is null for update;
    if company.id is null then raise exception 'Client unavailable' using errcode='42501'; end if;
    actions:=job.configuration;
    project_id:=submission.order_id;
    if coalesce((actions->>'create_project')::boolean,false) then
      if not private.profile_has_permission_in_tenant(job.authorizer_id,job.tenant_id,'projects.create')
        or not private.tenant_module_allowed(job.tenant_id,'projects') then raise exception 'Project creation denied' using errcode='42501'; end if;
      service_id:=(actions->>'service_id')::uuid;
      if not exists(select 1 from public.services where id=service_id and tenant_id=job.tenant_id and archived_at is null and is_active) then
        raise exception 'Service unavailable' using errcode='42501'; end if;
      insert into public.orders(tenant_id,company_id,service_id,title,notes)
      values(job.tenant_id,company.id,service_id,actions->>'project_title','Created automatically from intake submission '||submission.id::text)
      returning id into project_id;
      insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
      values(job.authorizer_id,'order',project_id,'order.created','Created project from submitted intake form.',
        jsonb_build_object('automatic',true,'submission_id',submission.id,'submitted_by',submission.submitted_by_profile_id));
    end if;
    if actions->>'task_title' is not null or jsonb_array_length(coalesce(actions->'workflow_steps','[]'::jsonb))>0 then
      if not private.profile_has_permission_in_tenant(job.authorizer_id,job.tenant_id,'projects.edit')
        or not private.tenant_module_allowed(job.tenant_id,'projects')
        or not exists(select 1 from public.orders where id=project_id and company_id=company.id and tenant_id=job.tenant_id and archived_at is null and status not in ('complete','canceled')) then
        raise exception 'Task creation denied' using errcode='42501'; end if;
      for step in select title from (
        select actions->>'task_title' title, 0 ordinal where actions->>'task_title' is not null
        union all select value#>>'{}',ordinality::integer from jsonb_array_elements(coalesce(actions->'workflow_steps','[]'::jsonb)) with ordinality
      ) titles order by ordinal loop
        insert into public.order_tasks(order_id,title,sort_position) values(project_id,step,position) returning id into task_id;
        tasks:=tasks||jsonb_build_array(task_id); position:=position+1;
        insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
        values(job.authorizer_id,'order_task',task_id,'task.created','Created task from submitted intake form.',jsonb_build_object('automatic',true,'submission_id',submission.id));
      end loop;
    end if;
    if actions->>'crm_status' is not null then
      if not private.profile_has_permission_in_tenant(job.authorizer_id,job.tenant_id,'clients.edit') then raise exception 'CRM update denied' using errcode='42501'; end if;
      update public.companies set status=actions->>'crm_status' where id=company.id;
      if company.status is distinct from actions->>'crm_status' then
        insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
        values(job.authorizer_id,'company',company.id,'company.updated','Updated client status from submitted intake form.',
          jsonb_build_object('field','status','from',company.status,'to',actions->>'crm_status','automatic',true,'submission_id',submission.id));
      end if;
    end if;
    update private.intake_submission_jobs set status='completed',finished_at=now(),result=jsonb_build_object('project_id',project_id,'task_ids',tasks,
      'workflow_started',jsonb_array_length(coalesce(actions->'workflow_steps','[]'::jsonb))>0,'crm_status',actions->>'crm_status') where submission_id=job.submission_id;
  exception when others then
    update private.intake_submission_jobs set status='blocked',finished_at=now(),result=jsonb_build_object('failure_code',SQLSTATE) where submission_id=job.submission_id;
  end;
  select * into job from private.intake_submission_jobs where submission_id=p_submission_id;
  return jsonb_build_object('status',job.status,'result',job.result);
end;
$function$;
revoke all on function public.app_server_run_intake_job(uuid) from public,anon,authenticated;
grant execute on function public.app_server_run_intake_job(uuid) to service_role;
