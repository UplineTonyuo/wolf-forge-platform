-- Intake assignments need both their Project and one explicit client recipient.
-- Retain legacy NULL recipients until staff deliberately reassigns that Project.
alter table public.form_assignments drop constraint form_assignments_context_exactly_one;
alter table public.form_assignments add constraint form_assignments_context_valid
  check (order_id is not null or client_profile_id is not null);

drop index public.form_assignments_active_client_idx;
create unique index form_assignments_active_client_idx
  on public.form_assignments (form_id, client_profile_id)
  where order_id is null and client_profile_id is not null and status = 'assigned';
create or replace function public.app_assign_form(p_request_id uuid, p_form_id uuid, p_context jsonb)
 RETURNS form_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  existing_id uuid;
  form_row public.forms;
  assignment_row public.form_assignments;
  order_row public.orders;
  client_row public.profiles;
  company_id_value uuid;
  replaced_assignment_id uuid;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id, 'context', p_context);
begin
  actor_id := private.require_form_capability('forms.assign');
  perform private.require_forms_write(private.current_tenant_id());
  actor_id := private.require_form_capability('forms.assign');
  if p_context is null or jsonb_typeof(p_context) <> 'object'
    or p_context - array['order_id', 'client_profile_id', 'required', 'due_at'] <> '{}'::jsonb
  then
    raise exception 'invalid Form assignment context' using errcode = '22023';
  end if;
  existing_id := private.find_create_request(actor_id, 'form.assign', p_request_id, request_payload);
  perform private.require_form_capability('forms.assign');
  if existing_id is not null then
    select assignment.* into assignment_row from public.form_assignments as assignment join public.forms as form_source on form_source.id = assignment.form_id where assignment.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if assignment_row.id is null then raise no_data_found; end if;
    return private.redact_form_assignment(assignment_row);
  end if;

  select * into form_row
  from public.forms
  where id = p_form_id and status = 'published' and archived_at is null and tenant_id = (select private.current_tenant_id())
  for update;
  perform private.require_form_capability('forms.assign');
  if form_row.id is null then raise no_data_found; end if;

  if form_row.form_type = 'intake' then
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = private.current_tenant_id() for update;
  perform private.require_form_capability('forms.assign');
  if not private.tenant_module_allowed(private.current_tenant_id(), 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;

    if nullif(p_context ->> 'order_id', '') is null or nullif(p_context ->> 'client_profile_id', '') is null then
      raise exception 'Intake assignment requires a Project and client recipient' using errcode = '22023';
    end if;
    select * into order_row from public.orders
    where id = (p_context ->> 'order_id')::uuid and tenant_id = (select private.current_tenant_id()) and archived_at is null
    for update;
  perform private.require_form_capability('forms.assign');
    if order_row.id is null then raise no_data_found; end if;
    if not exists (
      select 1 from public.form_service_links as link
      where link.form_version_id = form_row.published_version_id
        and link.form_version_field_id is null
        and link.service_id = order_row.service_id
        and link.role = 'intake_assignment'
    ) then
      raise exception 'Intake Form is not linked to the Order Service' using errcode = '23514';
    end if;
    company_id_value := order_row.company_id;
    select profile.* into client_row
    from public.profiles profile
    join public.tenant_memberships membership on membership.profile_id = profile.id
    join public.roles role on role.id = membership.role_id and role.name = 'client'
    join public.companies company on company.id = membership.company_id
    where profile.id = (p_context ->> 'client_profile_id')::uuid
      and profile.archived_at is null and membership.archived_at is null
      and membership.account_class = 'client'
      and membership.tenant_id = form_row.tenant_id
      and company.tenant_id = form_row.tenant_id and company.archived_at is null
      and membership.company_id = order_row.company_id;
    if client_row.id is null then
      raise exception 'Project client recipient is unavailable' using errcode = '42501';
    end if;

    -- Replace only a legacy recipient-less assignment; retain its history.
    update public.form_assignments
    set status = 'canceled', canceled_at = now()
    where form_id = form_row.id and order_id = order_row.id
      and status = 'assigned' and client_profile_id is null
    returning id into replaced_assignment_id;
    if replaced_assignment_id is not null then
      perform private.record_authenticated_activity(
        'form_assignment', replaced_assignment_id, 'form.assignment_replaced',
        'Replaced an Intake assignment that had no client recipient.'
      );
    end if;
  elsif form_row.form_type = 'onboarding' then
    if not p_context ? 'client_profile_id' or p_context ? 'order_id' then
      raise exception 'Onboarding assignment requires a client profile' using errcode = '22023';
    end if;
    select profile.* into client_row
    from public.profiles as profile
    where profile.id = (p_context ->> 'client_profile_id')::uuid
      and profile.archived_at is null;
    if client_row.id is null then raise no_data_found; end if;
    select membership_row.company_id into company_id_value
    from public.tenant_memberships as membership_row
    join public.roles as role on role.id = membership_row.role_id and role.name = 'client'
    join public.companies as company on company.id = membership_row.company_id and company.archived_at is null
    where membership_row.profile_id = client_row.id
      and membership_row.tenant_id = (select private.current_tenant_id())
      and membership_row.archived_at is null
      and membership_row.company_id is not null;
    if company_id_value is null then raise no_data_found; end if;
  else
    raise exception 'only Intake and Onboarding Forms can be assigned' using errcode = '55000';
  end if;

  insert into public.form_assignments (
    form_id, form_version_id, company_id, client_profile_id, order_id,
    required, due_at, assigned_by_profile_id
  ) values (
    form_row.id, form_row.published_version_id, company_id_value,
    client_row.id, order_row.id,
    coalesce((p_context ->> 'required')::boolean, true),
    (p_context ->> 'due_at')::timestamptz,
    actor_id
  ) returning * into assignment_row;

  perform private.record_authenticated_activity(
    'form_assignment', assignment_row.id, 'form.assigned',
    format('Assigned %s Form.', initcap(form_row.form_type)),
    jsonb_build_object('form_id', form_row.id, 'form_version_id', form_row.published_version_id, 'company_id', company_id_value, 'order_id', order_row.id, 'client_profile_id', client_row.id)
  );
  perform private.remember_create_request(actor_id, 'form.assign', p_request_id, request_payload, assignment_row.id);
  return private.redact_form_assignment(assignment_row);
end;
$function$;
revoke all on function public.app_assign_form(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_assign_form(uuid, uuid, jsonb) to authenticated;