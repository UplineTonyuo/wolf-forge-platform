create function public.app_get_form_submission_pdf(p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare requested public.form_submissions; original public.form_submissions; original_detail jsonb; requested_detail jsonb;
  form_version public.form_versions; budget bigint; fields jsonb; files jsonb;
begin
  if auth.uid() is null or private.can_read_form_submission(p_submission_id) is not true then
    raise exception 'Form submission access is denied' using errcode='42501'; end if;
  perform private.consume_rate_limit('forms.pdf.actor.minute',auth.uid()::text,interval '1 minute',10);
  perform private.consume_rate_limit('forms.pdf.actor.hour',auth.uid()::text,interval '1 hour',50);
  select * into requested from public.form_submissions where id=p_submission_id;
  select * into original from public.form_submissions where id=coalesce(requested.root_submission_id,requested.id);
  if original.id is null or original.form_id is distinct from requested.form_id
    or original.form_version_id is distinct from requested.form_version_id
    or original.form_assignment_id is distinct from requested.form_assignment_id
    or original.company_id is distinct from requested.company_id or original.client_profile_id is distinct from requested.client_profile_id
    or private.can_read_form_submission(original.id) is not true then
    raise exception 'Original form submission is unavailable' using errcode='42501'; end if;
  select * into form_version from public.form_versions where id=original.form_version_id and form_id=original.form_id;
  if form_version.id is null then raise exception 'Form version unavailable' using errcode='P0002'; end if;
  select coalesce(sum(octet_length(coalesce(help_html,''))+octet_length(coalesce(settings->>'html',''))+octet_length(label)),0) into budget
    from public.form_version_fields where form_version_id=form_version.id and field_type not in ('secret','hidden','password');
  budget:=budget+octet_length(coalesce(form_version.information_html,''));
  budget:=budget+(select coalesce(sum(octet_length(o.label)+octet_length(o.option_value)),0)
    from public.form_field_options o join public.form_version_fields f on f.id=o.form_version_field_id where f.form_version_id=form_version.id);
  budget:=budget+(select coalesce(sum(octet_length(l.service_name_snapshot)),0) from public.form_service_links l where l.form_version_id=form_version.id);
  budget:=budget+(select coalesce(sum(octet_length(value::text)),0) from public.form_submission_values
    where submission_id in (original.id,requested.id) and field_type_snapshot not in ('secret','hidden','password'));
  if budget>300000 then raise exception 'This submission is too large for a PDF download' using errcode='54000'; end if;
  original_detail:=public.app_get_form_submission(original.id);
  requested_detail:=case when requested.id=original.id then null else public.app_get_form_submission(requested.id) end;
  select coalesce(jsonb_agg(jsonb_build_object('key',f.stable_field_key,'label',f.label,'type',f.field_type,'sort_order',f.sort_order,
    'help_html',f.help_html,'html',case when f.field_type='html' then f.settings->>'html' else null end,'display_only',coalesce(f.settings->'display_only'='true'::jsonb,false),
    'conditional',exists(select 1 from public.form_rules r where r.form_version_id=form_version.id and r.target_field_keys ? f.stable_field_key::text),
    'options',(select coalesce(jsonb_agg(options.option),'[]'::jsonb) from (
      select jsonb_build_object('id',o.stable_option_key::text,'value',o.option_value,'label',o.label) as option
        from public.form_field_options o where o.form_version_field_id=f.id
      union all select jsonb_build_object('id',l.service_id::text,'value',null,'label',l.service_name_snapshot)
        from public.form_service_links l where l.form_version_field_id=f.id
    ) options)) order by f.sort_order),'[]'::jsonb) into fields
    from public.form_version_fields f where f.form_version_id=form_version.id and f.field_type not in ('secret','hidden','password');
  select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.original_name)),'[]'::jsonb) into files
    from private.intake_uploads u where u.submission_id in (original.id,requested.id)
      and u.assignment_id=original.form_assignment_id and u.ready
      and exists(select 1 from public.form_submission_values v where v.submission_id in (original.id,requested.id)
        and v.field_type_snapshot='file' and v.stable_field_key=u.field_key and v.value ? u.id::text);
  return jsonb_build_object('form',jsonb_build_object('id',original.form_id,'version_id',form_version.id,'version_number',form_version.version_number,
      'schema_hash',form_version.schema_hash,'title',form_version.title,'information_html',form_version.information_html,'fields',fields),
    'original',jsonb_build_object('id',original.id,'submitted_at',original.submitted_at,'revision_number',original.revision_number,
      'values',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(original_detail->'values') v where v->>'field_type' not in ('secret','hidden','password'))),
    'correction',case when requested_detail is null then null else jsonb_build_object('id',requested.id,'submitted_at',requested.submitted_at,'revision_number',requested.revision_number,
      'values',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(requested_detail->'values') v where v->>'field_type' not in ('secret','hidden','password'))) end,
    'files',files);
end;
$$;
revoke all on function public.app_get_form_submission_pdf(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_form_submission_pdf(uuid) to authenticated;
