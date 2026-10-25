CREATE OR REPLACE FUNCTION private.validate_form_version(p_form_version_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  version_row public.form_versions;
  form_row public.forms;
  rule_row public.form_rules;
  condition_value jsonb;
  target_value jsonb;
  condition_key uuid;
  target_key uuid;
begin
  select version.* into version_row from public.form_versions as version where version.id = p_form_version_id;
  if version_row.id is null then raise no_data_found; end if;
  select form.* into form_row from public.forms as form where form.id = version_row.form_id;

  if not exists (select 1 from public.form_version_fields where form_version_id = version_row.id) then
    raise exception 'Form must contain at least one field' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.field_type in ('data-option-group', 'data-dropdown')
      and not exists (select 1 from public.form_field_options as option where option.form_version_field_id = field.id)
  ) then
    raise exception 'choice fields require options' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.field_type in ('optgroup', 'dropdown')
      and not exists (select 1 from public.form_service_links as link where link.form_version_field_id = field.id)
  ) then
    raise exception 'Service fields require Service links' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.required
      and (field.field_type in ('password', 'secret', 'captcha', 'payment', 'hidden', 'break', 'pagebreak', 'html')
        or (field.field_type = 'file' and form_row.form_type not in ('intake','onboarding')))
  ) then
    raise exception 'deferred or structural fields cannot be required' using errcode = '22023';
  end if;

  for rule_row in select * from public.form_rules where form_version_id = version_row.id loop
    for condition_value in select value from jsonb_array_elements(rule_row.conditions) loop
      if jsonb_typeof(condition_value) <> 'object'
        or condition_value - array['field_key', 'comparator', 'value'] <> '{}'::jsonb
        or not condition_value ?& array['field_key', 'comparator']
        or condition_value ->> 'comparator' not in ('equals', 'not_equals', 'checked', 'not_checked')
      then
        raise exception 'invalid Form rule condition' using errcode = '22023';
      end if;
      condition_key := (condition_value ->> 'field_key')::uuid;
      if not exists (
        select 1 from public.form_version_fields as field
        where field.form_version_id = version_row.id and field.stable_field_key = condition_key
      ) then
        raise exception 'Form rule condition references an unknown field' using errcode = '22023';
      end if;
    end loop;
    for target_value in select value from jsonb_array_elements(rule_row.target_field_keys) loop
      target_key := trim(both '"' from target_value::text)::uuid;
      if not exists (
        select 1 from public.form_version_fields as field
        where field.form_version_id = version_row.id and field.stable_field_key = target_key
      ) then
        raise exception 'Form rule target references an unknown field' using errcode = '22023';
      end if;
    end loop;
  end loop;

  if form_row.form_type = 'intake' and not exists (
    select 1 from public.form_service_links as link
    where link.form_version_id = version_row.id
      and link.form_version_field_id is null
      and link.role = 'intake_assignment'
  ) then
    raise exception 'Intake Forms require at least one Service assignment link' using errcode = '22023';
  end if;
end;
$function$
