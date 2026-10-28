create function public.app_get_assigned_form_service_labels(p_assignment_ids uuid[])
returns table(assignment_id uuid, service_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_assignment_ids is null or cardinality(p_assignment_ids) > 100
    or coalesce(array_ndims(p_assignment_ids), 1) <> 1
    or array_position(p_assignment_ids, null) is not null then
    raise exception 'Invalid form assignment batch' using errcode = '22023';
  end if;

  return query
  select allowed.assignment_id, service.name
  from public.app_list_assigned_forms() allowed
  join public.form_assignments assignment on assignment.id = allowed.assignment_id
    and assignment.company_id = allowed.company_id
  join public.forms form on form.id = assignment.form_id
    and form.tenant_id = (select private.current_tenant_id())
  join public.orders work on work.id = assignment.order_id
    and work.tenant_id = form.tenant_id and work.company_id = assignment.company_id
  join public.services service on service.id = work.service_id
    and service.tenant_id = work.tenant_id
  where allowed.form_type = 'intake'
    and allowed.assignment_id = any(p_assignment_ids);
end;
$$;

revoke all on function public.app_get_assigned_form_service_labels(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_assigned_form_service_labels(uuid[]) to authenticated;

comment on function public.app_get_assigned_form_service_labels(uuid[]) is
  'Display labels for currently authorized intake assignments; no order pointers or form-history mutation.';
