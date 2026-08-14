-- Exact-version, company-scoped Forms read models required by the admin and
-- client interfaces. These do not widen mutation authority.

create function public.app_list_assigned_forms()
returns table (
  assignment_id uuid,
  form_id uuid,
  form_type text,
  form_version_id uuid,
  version_number integer,
  title text,
  status text,
  required boolean,
  due_at timestamptz,
  assigned_at timestamptz,
  completed_at timestamptz,
  company_id uuid,
  company_name text,
  client_profile_id uuid,
  client_name text,
  order_id uuid,
  order_number bigint,
  order_title text,
  latest_submission_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  internal_access boolean;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and archived_at is null;
  if actor.id is null then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;
  internal_access := (select private.is_internal_user()) and (
    private.current_user_has_permission('forms.assign')
    or private.current_user_has_permission('forms.submissions_view')
  );
  if not internal_access and not (select private.is_client_user()) then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  return query
  select
    assignment.id,
    form.id,
    form.form_type,
    version.id,
    version.version_number,
    version.title,
    assignment.status,
    assignment.required,
    assignment.due_at,
    assignment.assigned_at,
    assignment.completed_at,
    company.id,
    company.name,
    client.id,
    client.display_name,
    work.id,
    work.order_number,
    work.title,
    assignment.latest_submission_id
  from public.form_assignments as assignment
  join public.forms as form on form.id = assignment.form_id
  join public.form_versions as version on version.id = assignment.form_version_id
  join public.companies as company on company.id = assignment.company_id
  left join public.profiles as client on client.id = assignment.client_profile_id
  left join public.orders as work on work.id = assignment.order_id
  where assignment.archived_at is null
    and (internal_access or assignment.company_id = actor.company_id)
  order by
    (assignment.status = 'assigned') desc,
    assignment.due_at nulls last,
    assignment.assigned_at desc;
end;
$$;

create function public.app_get_assigned_form_schema(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  assignment public.form_assignments;
  form_row public.forms;
  version_row public.form_versions;
  internal_access boolean;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and archived_at is null;
  if actor.id is null then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;
  internal_access := (select private.is_internal_user()) and (
    private.current_user_has_permission('forms.assign')
    or private.current_user_has_permission('forms.submissions_view')
  );
  select * into assignment
  from public.form_assignments
  where id = p_assignment_id and archived_at is null;
  if assignment.id is null then raise no_data_found; end if;
  if not internal_access and not (
    (select private.is_client_user()) and actor.company_id = assignment.company_id
  ) then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;
  select * into form_row from public.forms where id = assignment.form_id;
  select * into version_row from public.form_versions where id = assignment.form_version_id;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'assignment_id', assignment.id,
      'form_id', assignment.form_id,
      'form_type', form_row.form_type,
      'form_version_id', assignment.form_version_id,
      'version_number', version_row.version_number,
      'title', version_row.title,
      'status', assignment.status,
      'required', assignment.required,
      'due_at', assignment.due_at,
      'assigned_at', assignment.assigned_at,
      'completed_at', assignment.completed_at,
      'company_id', assignment.company_id,
      'company_name', (select name from public.companies where id = assignment.company_id),
      'client_profile_id', assignment.client_profile_id,
      'client_name', (select display_name from public.profiles where id = assignment.client_profile_id),
      'order_id', assignment.order_id,
      'order_number', (select order_number from public.orders where id = assignment.order_id),
      'order_title', (select title from public.orders where id = assignment.order_id),
      'latest_submission_id', assignment.latest_submission_id
    ),
    'schema', jsonb_build_object(
      'form_id', form_row.id,
      'form_type', form_row.form_type,
      'canonical_key', form_row.canonical_key,
      'form_version_id', version_row.id,
      'version_number', version_row.version_number,
      'schema_hash', version_row.schema_hash,
      'title', version_row.title,
      'information_html', version_row.information_html,
      'visibility', version_row.visibility,
      'type_config', version_row.type_config,
      'fields', coalesce((
        select jsonb_agg(jsonb_build_object(
          'stable_field_key', field.stable_field_key,
          'sort_order', field.sort_order,
          'field_type', field.field_type,
          'label', field.label,
          'placeholder', field.placeholder,
          'help_html', field.help_html,
          'default_value', field.default_value,
          'required', field.required,
          'settings', field.settings,
          'options', coalesce((select jsonb_agg(jsonb_build_object(
            'option_id', option.stable_option_key,
            'value', option.option_value,
            'label', option.label,
            'sort_order', option.sort_order,
            'metadata', option.metadata
          ) order by option.sort_order)
          from public.form_field_options as option
          where option.form_version_field_id = field.id), '[]'::jsonb),
          'services', coalesce((select jsonb_agg(jsonb_build_object(
            'service_id', link.service_id,
            'role', link.role,
            'sort_order', link.sort_order,
            'configuration', link.configuration,
            'name', link.service_name_snapshot,
            'currency', link.service_currency_snapshot,
            'price_cents', link.service_price_cents_snapshot
          ) order by link.sort_order)
          from public.form_service_links as link
          where link.form_version_field_id = field.id), '[]'::jsonb)
        ) order by field.sort_order)
        from public.form_version_fields as field
        where field.form_version_id = version_row.id
      ), '[]'::jsonb),
      'rules', coalesce((
        select jsonb_agg(jsonb_build_object(
          'rule_key', rule.rule_key,
          'sort_order', rule.sort_order,
          'conditions', rule.conditions,
          'action', rule.action,
          'target_field_keys', rule.target_field_keys
        ) order by rule.sort_order)
        from public.form_rules as rule
        where rule.form_version_id = version_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.app_list_assigned_forms() from public, anon, authenticated, service_role;
revoke all on function public.app_get_assigned_form_schema(uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_list_assigned_forms() to authenticated;
grant execute on function public.app_get_assigned_form_schema(uuid) to authenticated;

comment on function public.app_get_assigned_form_schema(uuid) is
  'Returns the exact immutable Form version pinned to a company-scoped assignment.';
