-- Keep the original overload compatible with already-open app versions.
create function public.app_get_form_submission_pdf(p_submission_id uuid, p_include_project boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb; project_context jsonb;
begin
  receipt := public.app_get_form_submission_pdf(p_submission_id);
  if p_include_project is not true then return receipt; end if;
  select jsonb_build_object('number',o.order_number,'title',o.title)
    into project_context
    from public.form_submissions s
    join public.form_assignments a on a.id=s.form_assignment_id
      and a.form_id=s.form_id and a.form_version_id=s.form_version_id
    join public.orders o on o.id=a.order_id and o.company_id=a.company_id and o.company_id=s.company_id
    where s.id=p_submission_id and o.tenant_id=private.current_tenant_id() and o.archived_at is null
      and (
        private.can_access_operational_order(o.id)
        or (
          private.current_account_class()='client'
          and private.tenant_module_allowed(private.current_tenant_id(),'portal_projects')
          and private.current_user_has_permission('projects.view')
          and o.company_id=private.current_user_company_id()
        )
      );
  return receipt || jsonb_build_object('project',project_context);
end;
$$;
revoke all on function public.app_get_form_submission_pdf(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.app_get_form_submission_pdf(uuid,boolean) to authenticated;
