-- Integration reservation 20261011172234 follows Forms 232 and reserved Coupons 233.
-- Preserve the original Forms migration; compose future Coupons successors against these guards.
create function private.redact_form_submission(p_row public.form_submissions) returns public.form_submissions language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_access_operational_order(p_row.order_id) then p_row.order_id:=null; end if;
 if not private.can_access_ticket((p_row.provenance->>'ticket_id')::uuid) then p_row.provenance:=p_row.provenance-'ticket_id'; end if;
 return p_row;
end; $$;
revoke all on function private.redact_form_submission(public.form_submissions) from public,anon,authenticated,service_role;
create function private.redact_form_assignment(p_row public.form_assignments) returns public.form_assignments language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_access_operational_order(p_row.order_id) then p_row.order_id:=null; end if;
 return p_row;
end; $$;
revoke all on function private.redact_form_assignment(public.form_assignments) from public,anon,authenticated,service_role;
create function private.require_current_form_submitter(p_actor uuid,p_tenant uuid,p_class text,p_company uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null then return; end if;
 if auth.uid() is distinct from p_actor or private.current_tenant_id() is distinct from p_tenant
   or private.current_account_class() is distinct from p_class
   or not exists(select 1 from public.profiles where id=p_actor and archived_at is null) then
   raise exception 'Form submitter access is denied' using errcode='42501';
 end if;
 if p_class='client' then
   perform private.require_permission('forms.view');
   if p_company is null or private.current_user_company_id() is distinct from p_company
     or not exists(select 1 from public.companies where id=p_company and tenant_id=p_tenant and archived_at is null) then
     raise exception 'Form submitter access is denied' using errcode='42501';
   end if;
 end if;
end; $$;
revoke all on function private.require_current_form_submitter(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.app_list_form_submissions(p_form_id uuid default null,p_order_id uuid default null) returns setof public.form_submissions language plpgsql stable security definer set search_path='' as $$
declare receipt public.form_submissions;
begin
 perform public.app_require_module_access(case when private.current_account_class()='client' then 'portal_forms' else 'forms' end);
 if p_order_id is not null and not private.can_access_operational_order(p_order_id) then return; end if;
 for receipt in select s.* from public.form_submissions s where (p_form_id is null or s.form_id=p_form_id)
   and (p_order_id is null or s.order_id=p_order_id) and private.can_read_form_submission(s.id) order by s.submitted_at desc loop
   return next private.redact_form_submission(receipt);
 end loop;
end; $$;
revoke all on function public.app_list_form_submissions(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_list_form_submissions(uuid,uuid) to authenticated;
revoke select on public.form_submissions,public.form_assignments from authenticated;
grant select(id,form_id,form_version_id,form_assignment_id,company_id,client_profile_id,root_submission_id,supersedes_submission_id,revision_number,status,orchestration_type,orchestration_status,submitted_by_profile_id,submitted_at) on public.form_submissions to authenticated;
grant select(id,form_id,form_version_id,company_id,client_profile_id,status,required,due_at,assigned_by_profile_id,assigned_at,completed_at,canceled_at,archived_at,latest_submission_id) on public.form_assignments to authenticated;
do $$ declare relation_name text; begin
 foreach relation_name in array array['form_versions','form_version_fields','form_field_options','form_rules','form_service_links'] loop
 execute format('create policy forms_collection_enabled on public.%I as restrictive for select to authenticated using (private.tenant_module_allowed(private.current_tenant_id(),''forms''))',relation_name);
 end loop;
end; $$;

create or replace function public.app_create_form(p_request_id uuid, p_payload jsonb)
 RETURNS forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  existing_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  definition jsonb;
begin
  actor_id := private.require_form_capability('forms.manage');
  perform private.require_forms_write(private.current_tenant_id());
  actor_id := private.require_form_capability('forms.manage');
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['form_type', 'canonical_key', 'definition'] <> '{}'::jsonb
    or not p_payload ?& array['form_type', 'canonical_key', 'definition']
  then
    raise exception 'invalid Form create payload' using errcode = '22023';
  end if;
  definition := p_payload -> 'definition';
  existing_id := private.find_create_request(actor_id, 'form.create', p_request_id, p_payload);
  perform private.require_form_capability('forms.manage');
  if existing_id is not null then
    select * into form_row from public.forms where id = existing_id and tenant_id = (select private.current_tenant_id());
    if form_row.id is null then raise no_data_found; end if;
    return form_row;
  end if;

  insert into public.forms (
    form_type, canonical_key, name, status, visibility,
    created_by_profile_id, updated_by_profile_id
  ) values (
    p_payload ->> 'form_type',
    lower(p_payload ->> 'canonical_key'),
    definition ->> 'name',
    'draft',
    definition ->> 'visibility',
    actor_id,
    actor_id
  ) returning * into form_row;

  insert into public.form_versions (
    form_id, version_number, lifecycle_state, title, visibility,
    created_by_profile_id
  ) values (
    form_row.id, 1, 'draft', definition ->> 'title', definition ->> 'visibility', actor_id
  ) returning * into version_row;

  update public.forms set current_draft_version_id = version_row.id where id = form_row.id;
  perform private.replace_form_draft(form_row.id, version_row.id, definition, actor_id);

  perform private.record_authenticated_activity(
    'form', form_row.id, 'form.created', format('Created Form %s.', form_row.name),
    jsonb_build_object('form_type', form_row.form_type, 'canonical_key', form_row.canonical_key)
  );
  perform private.remember_create_request(actor_id, 'form.create', p_request_id, p_payload, form_row.id);
  select * into form_row from public.forms where id = form_row.id;
  return form_row;
end;
$function$
;

create or replace function public.app_archive_form(p_request_id uuid, p_form_id uuid)
 RETURNS forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  existing_id uuid;
  form_row public.forms;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id);
begin
  actor_id := private.require_form_capability('forms.manage');
  perform private.require_forms_write(private.current_tenant_id());
  actor_id := private.require_form_capability('forms.manage');
  existing_id := private.find_create_request(actor_id, 'form.archive', p_request_id, request_payload);
  perform private.require_form_capability('forms.manage');
  if existing_id is not null then
    select * into form_row from public.forms where id = existing_id and tenant_id = (select private.current_tenant_id());
    if form_row.id is null then raise no_data_found; end if;
    return form_row;
  end if;
  perform 1 from public.forms where id=p_form_id and tenant_id=private.current_tenant_id() for update;
  perform private.require_form_capability('forms.manage');
  update public.forms
  set status = 'archived', archived_at = now(), updated_by_profile_id = actor_id
  where id = p_form_id and archived_at is null and tenant_id = (select private.current_tenant_id())
  returning * into form_row;
  if form_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'form', form_row.id, 'form.archived', format('Archived Form %s.', form_row.name)
  );
  perform private.remember_create_request(actor_id, 'form.archive', p_request_id, request_payload, form_row.id);
  return form_row;
end;
$function$
;

create or replace function public.app_update_form_draft(p_request_id uuid, p_form_id uuid, p_definition jsonb)
 RETURNS form_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  existing_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id, 'definition', p_definition);
begin
  actor_id := private.require_form_capability('forms.manage');
  perform private.require_forms_write(private.current_tenant_id());
  actor_id := private.require_form_capability('forms.manage');
  existing_id := private.find_create_request(actor_id, 'form.draft.update', p_request_id, request_payload);
  perform private.require_form_capability('forms.manage');
  if existing_id is not null then
    select version.* into version_row from public.form_versions as version join public.forms as form_source on form_source.id = version.form_id where version.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if version_row.id is null then raise no_data_found; end if;
    return version_row;
  end if;
  select * into form_row from public.forms where id = p_form_id and archived_at is null and tenant_id = (select private.current_tenant_id()) for update;
  perform private.require_form_capability('forms.manage');
  if form_row.id is null then raise no_data_found; end if;
  version_row := private.replace_form_draft(
    form_row.id, form_row.current_draft_version_id, p_definition, actor_id
  );
  perform private.record_authenticated_activity(
    'form', form_row.id, 'form.updated', format('Updated draft for Form %s.', p_definition ->> 'name'),
    jsonb_build_object('draft_version', version_row.version_number)
  );
  perform private.remember_create_request(
    actor_id, 'form.draft.update', p_request_id, request_payload, version_row.id
  );
  return version_row;
end;
$function$
;

create or replace function public.app_publish_form(p_request_id uuid, p_form_id uuid)
 RETURNS form_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  existing_id uuid;
  form_row public.forms;
  published_row public.form_versions;
  next_draft public.form_versions;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id);
begin
  actor_id := private.require_form_capability('forms.publish');
  perform private.require_forms_write(private.current_tenant_id());
  actor_id := private.require_form_capability('forms.publish');
  existing_id := private.find_create_request(actor_id, 'form.publish', p_request_id, request_payload);
  perform private.require_form_capability('forms.publish');
  if existing_id is not null then
    select version.* into published_row from public.form_versions as version join public.forms as form_source on form_source.id = version.form_id where version.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if published_row.id is null then raise no_data_found; end if;
    return published_row;
  end if;

  select * into form_row from public.forms where id = p_form_id and archived_at is null and tenant_id = (select private.current_tenant_id()) for update;
  perform private.require_form_capability('forms.publish');
  if form_row.id is null then raise no_data_found; end if;
  select * into published_row
  from public.form_versions
  where id = form_row.current_draft_version_id and lifecycle_state = 'draft'
  for update;
  perform private.require_form_capability('forms.publish');
  if published_row.id is null then raise exception 'Form draft is unavailable' using errcode = '55000'; end if;
  perform private.validate_form_version(published_row.id);

  update public.form_service_links as link
  set service_name_snapshot = service.name,
      service_currency_snapshot = service.currency,
      service_price_cents_snapshot = (service.price * 100)::bigint
  from public.services as service
  where link.form_version_id = published_row.id
    and service.id = link.service_id
    and service.archived_at is null;

  update public.form_versions
  set lifecycle_state = 'published',
      schema_hash = md5(jsonb_build_object(
        'version', to_jsonb(published_row) - array['created_at', 'published_at', 'published_by_profile_id', 'schema_hash'],
        'fields', (select coalesce(jsonb_agg(to_jsonb(field) order by field.sort_order), '[]'::jsonb) from public.form_version_fields as field where field.form_version_id = published_row.id),
        'rules', (select coalesce(jsonb_agg(to_jsonb(rule) order by rule.sort_order), '[]'::jsonb) from public.form_rules as rule where rule.form_version_id = published_row.id),
        'services', (select coalesce(jsonb_agg(to_jsonb(link) order by link.sort_order), '[]'::jsonb) from public.form_service_links as link where link.form_version_id = published_row.id)
      )::text),
      published_by_profile_id = actor_id,
      published_at = now()
  where id = published_row.id
  returning * into published_row;

  update public.forms
  set status = 'published', visibility = published_row.visibility,
      published_version_id = published_row.id, updated_by_profile_id = actor_id
  where id = form_row.id;

  insert into public.form_versions (
    form_id, version_number, lifecycle_state, title, information_html,
    visibility, type_config, created_by_profile_id
  ) values (
    form_row.id, published_row.version_number + 1, 'draft', published_row.title,
    published_row.information_html, published_row.visibility,
    published_row.type_config, actor_id
  ) returning * into next_draft;

  insert into public.form_version_fields (
    form_version_id, stable_field_key, sort_order, field_type, label,
    internal_label, placeholder, help_html, default_value, required, settings
  )
  select next_draft.id, field.stable_field_key, field.sort_order, field.field_type,
    field.label, field.internal_label, field.placeholder, field.help_html,
    field.default_value, field.required, field.settings
  from public.form_version_fields as field
  where field.form_version_id = published_row.id;

  insert into public.form_field_options (
    form_version_field_id, stable_option_key, option_value, label, sort_order, metadata
  )
  select draft_field.id, option.stable_option_key, option.option_value,
    option.label, option.sort_order, option.metadata
  from public.form_field_options as option
  join public.form_version_fields as published_field on published_field.id = option.form_version_field_id
  join public.form_version_fields as draft_field
    on draft_field.form_version_id = next_draft.id
   and draft_field.stable_field_key = published_field.stable_field_key
  where published_field.form_version_id = published_row.id;

  insert into public.form_rules (
    form_version_id, rule_key, sort_order, conditions, action, target_field_keys
  )
  select next_draft.id, rule.rule_key, rule.sort_order, rule.conditions, rule.action, rule.target_field_keys
  from public.form_rules as rule where rule.form_version_id = published_row.id;

  insert into public.form_service_links (
    form_version_id, form_version_field_id, service_id, role, sort_order,
    configuration, service_name_snapshot, service_currency_snapshot,
    service_price_cents_snapshot
  )
  select next_draft.id, draft_field.id, link.service_id, link.role, link.sort_order,
    link.configuration, link.service_name_snapshot, link.service_currency_snapshot,
    link.service_price_cents_snapshot
  from public.form_service_links as link
  left join public.form_version_fields as published_field on published_field.id = link.form_version_field_id
  left join public.form_version_fields as draft_field
    on draft_field.form_version_id = next_draft.id
   and draft_field.stable_field_key = published_field.stable_field_key
  where link.form_version_id = published_row.id;

  update public.forms set current_draft_version_id = next_draft.id where id = form_row.id;
  perform private.record_authenticated_activity(
    'form', form_row.id, 'form.published', format('Published Form %s version %s.', form_row.name, published_row.version_number),
    jsonb_build_object('form_version_id', published_row.id, 'version_number', published_row.version_number, 'schema_hash', published_row.schema_hash)
  );
  perform private.remember_create_request(actor_id, 'form.publish', p_request_id, request_payload, published_row.id);
  return published_row;
end;
$function$
;

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

    if not p_context ? 'order_id' or p_context ? 'client_profile_id' then
      raise exception 'Intake assignment requires an Order' using errcode = '22023';
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

create or replace function public.app_correct_form_submission(p_request_id uuid, p_submission_id uuid, p_values jsonb)
 RETURNS form_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  original_row public.form_submissions;
  corrected_row public.form_submissions;
  field_row public.form_version_fields;
  submitted_value jsonb;
  existing_id uuid;
  next_revision integer;
  request_payload jsonb := jsonb_build_object('submission_id', p_submission_id, 'values', p_values);
begin
  actor_id := private.require_form_capability('forms.submissions_manage');
  perform private.require_forms_write(private.current_tenant_id());
  actor_id := private.require_form_capability('forms.submissions_manage');
  existing_id := private.find_form_submission_request(
    'form.submission.correct', p_request_id, actor_id, request_payload
  );
  perform private.require_form_capability('forms.submissions_manage');
  if existing_id is not null then
    select submission.* into corrected_row from public.form_submissions as submission join public.forms as form_row on form_row.id = submission.form_id where submission.id = existing_id and form_row.tenant_id = (select private.current_tenant_id()) and form_row.archived_at is null
      and (submission.company_id is null or exists(select 1 from public.companies c where c.id=submission.company_id and c.tenant_id=form_row.tenant_id and c.archived_at is null))
      and (submission.form_assignment_id is null or exists(select 1 from public.form_assignments a where a.id=submission.form_assignment_id and a.form_id=submission.form_id and a.archived_at is null));
    if corrected_row.id is null then raise no_data_found; end if;
    return private.redact_form_submission(corrected_row);
  end if;
  select submission.* into original_row from public.form_submissions as submission join public.forms as form_row on form_row.id = submission.form_id where submission.id = p_submission_id and form_row.tenant_id = (select private.current_tenant_id()) and form_row.archived_at is null
    and (submission.company_id is null or exists(select 1 from public.companies c where c.id=submission.company_id and c.tenant_id=form_row.tenant_id and c.archived_at is null))
    and (submission.form_assignment_id is null or exists(select 1 from public.form_assignments a where a.id=submission.form_assignment_id and a.form_id=submission.form_id and a.archived_at is null)) for share of submission;
  perform private.require_form_capability('forms.submissions_manage');
  if original_row.id is null then raise no_data_found; end if;
  perform private.validate_form_submission_values(original_row.form_version_id, p_values);
  select coalesce(max(revision_number), 0) + 1 into next_revision
  from public.form_submissions where root_submission_id = original_row.root_submission_id;

  insert into public.form_submissions (
    form_id, form_version_id, form_assignment_id, company_id, client_profile_id,
    order_id, root_submission_id, supersedes_submission_id, revision_number,
    orchestration_type, orchestration_status, submitted_by_profile_id, provenance
  ) values (
    original_row.form_id, original_row.form_version_id, original_row.form_assignment_id,
    original_row.company_id, original_row.client_profile_id, original_row.order_id,
    original_row.root_submission_id, original_row.id, next_revision,
    null, 'not_required', actor_id,
    original_row.provenance || jsonb_build_object('correction', true, 'corrected_by', actor_id)
  ) returning * into corrected_row;

  for submitted_value in select value from jsonb_array_elements(p_values) loop
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = original_row.form_version_id
      and field.stable_field_key = (submitted_value ->> 'field_key')::uuid;
    insert into public.form_submission_values (
      submission_id, form_version_field_id, stable_field_key,
      field_label_snapshot, field_type_snapshot, sort_order_snapshot, value
    ) values (
      corrected_row.id, field_row.id, field_row.stable_field_key,
      field_row.label, field_row.field_type, field_row.sort_order,
      submitted_value -> 'value'
    );
  end loop;

  if corrected_row.form_assignment_id is not null then
    update public.form_assignments set latest_submission_id = corrected_row.id
    where id = corrected_row.form_assignment_id;
  end if;
  perform private.record_authenticated_activity(
    'form_submission', corrected_row.id, 'form.submission_corrected',
    'Recorded an append-only Form submission correction.',
    jsonb_build_object('root_submission_id', corrected_row.root_submission_id, 'supersedes_submission_id', original_row.id, 'revision_number', next_revision)
  );
  perform private.remember_form_submission_request(
    'form.submission.correct', p_request_id, actor_id, request_payload, corrected_row.id
  );
  return private.redact_form_submission(corrected_row);
end;
$function$
;

create or replace function private.replace_form_draft(p_form_id uuid, p_form_version_id uuid, p_definition jsonb, p_actor_id uuid)
 RETURNS form_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  form_row public.forms;
  version_row public.form_versions;
  field_value jsonb;
  option_value jsonb;
  link_value jsonb;
  rule_value jsonb;
  field_row public.form_version_fields;
  service_row public.services;
  field_key uuid;
  field_type_value text;
  type_config_value jsonb;
begin
  if p_actor_id is null or p_actor_id is distinct from (select auth.uid()) then
    raise exception 'verified Form actor is required' using errcode = '42501';
  end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object'
    or p_definition - array['name', 'title', 'information_html', 'visibility', 'type_config', 'fields', 'rules', 'service_links'] <> '{}'::jsonb
    or jsonb_typeof(coalesce(p_definition -> 'fields', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_definition -> 'rules', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_definition -> 'service_links', '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid Form draft definition' using errcode = '22023';
  end if;

  select form.* into form_row
  from public.forms as form
  where form.id = p_form_id and form.archived_at is null and form.tenant_id = (select private.current_tenant_id())
  for update;
  perform private.require_form_capability('forms.manage');
  if form_row.id is null then raise no_data_found; end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.form_id = p_form_id
    and version.lifecycle_state = 'draft'
  for update;
  perform private.require_form_capability('forms.manage');
  if version_row.id is null or form_row.current_draft_version_id <> version_row.id then
    raise exception 'Form draft is unavailable' using errcode = '55000';
  end if;

  if btrim(coalesce(p_definition ->> 'name', '')) = ''
    or btrim(coalesce(p_definition ->> 'title', '')) = ''
    or coalesce(p_definition ->> 'visibility', '') not in ('public', 'authenticated', 'assigned')
    or not private.form_html_is_safe(p_definition ->> 'information_html')
  then
    raise exception 'invalid Form draft metadata' using errcode = '22023';
  end if;
  if (form_row.form_type in ('intake', 'onboarding')) <> ((p_definition ->> 'visibility') = 'assigned') then
    raise exception 'Form visibility is incompatible with its type' using errcode = '22023';
  end if;

  type_config_value := private.validate_form_type_config(form_row.form_type, p_definition -> 'type_config');

  delete from public.form_service_links where form_version_id = version_row.id;
  delete from public.form_rules where form_version_id = version_row.id;
  delete from public.form_field_options
  where form_version_field_id in (
    select field.id from public.form_version_fields as field where field.form_version_id = version_row.id
  );
  delete from public.form_version_fields where form_version_id = version_row.id;

  update public.forms
  set name = p_definition ->> 'name', updated_by_profile_id = p_actor_id
  where id = form_row.id;

  update public.form_versions
  set title = p_definition ->> 'title',
      information_html = nullif(p_definition ->> 'information_html', ''),
      visibility = p_definition ->> 'visibility',
      type_config = type_config_value
  where id = version_row.id;

  for field_value in
    select value from jsonb_array_elements(coalesce(p_definition -> 'fields', '[]'::jsonb))
  loop
    if jsonb_typeof(field_value) <> 'object'
      or field_value - array[
        'stable_field_key', 'sort_order', 'field_type', 'label', 'internal_label',
        'placeholder', 'help_html', 'default_value', 'required', 'settings',
        'options', 'service_links'
      ] <> '{}'::jsonb
      or not field_value ?& array['stable_field_key', 'sort_order', 'field_type', 'label']
      or jsonb_typeof(coalesce(field_value -> 'options', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(field_value -> 'service_links', '[]'::jsonb)) <> 'array'
    then
      raise exception 'invalid Form field definition' using errcode = '22023';
    end if;

    field_key := (field_value ->> 'stable_field_key')::uuid;
    field_type_value := field_value ->> 'field_type';
    if field_type_value in ('optgroup', 'dropdown', 'payment') and form_row.form_type <> 'order' then
      raise exception 'Order-only field type is not allowed on this Form' using errcode = '22023';
    end if;
    if field_type_value in ('fullname', 'email', 'password', 'address', 'phone', 'optin')
      and form_row.form_type not in ('order', 'contact')
    then
      raise exception 'client profile field is not allowed on this Form' using errcode = '22023';
    end if;
    if field_type_value = 'captcha' and form_row.form_type = 'onboarding' then
      raise exception 'Captcha is not available on Onboarding Forms' using errcode = '22023';
    end if;

    insert into public.form_version_fields (
      form_version_id, stable_field_key, sort_order, field_type, label,
      internal_label, placeholder, help_html, default_value, required, settings
    ) values (
      version_row.id,
      field_key,
      (field_value ->> 'sort_order')::integer,
      field_type_value,
      field_value ->> 'label',
      nullif(field_value ->> 'internal_label', ''),
      nullif(field_value ->> 'placeholder', ''),
      nullif(field_value ->> 'help_html', ''),
      field_value -> 'default_value',
      coalesce((field_value ->> 'required')::boolean, false),
      coalesce(field_value -> 'settings', '{}'::jsonb)
    ) returning * into field_row;

    for option_value in
      select value from jsonb_array_elements(coalesce(field_value -> 'options', '[]'::jsonb))
    loop
      if jsonb_typeof(option_value) <> 'object'
        or option_value - array['stable_option_key', 'option_value', 'label', 'sort_order', 'metadata'] <> '{}'::jsonb
        or not option_value ?& array['stable_option_key', 'option_value', 'label', 'sort_order']
      then
        raise exception 'invalid Form field option' using errcode = '22023';
      end if;
      insert into public.form_field_options (
        form_version_field_id, stable_option_key, option_value, label, sort_order, metadata
      ) values (
        field_row.id,
        (option_value ->> 'stable_option_key')::uuid,
        option_value ->> 'option_value',
        option_value ->> 'label',
        (option_value ->> 'sort_order')::integer,
        coalesce(option_value -> 'metadata', '{}'::jsonb)
      );
    end loop;

    for link_value in
      select value from jsonb_array_elements(coalesce(field_value -> 'service_links', '[]'::jsonb))
    loop
      if jsonb_typeof(link_value) <> 'object'
        or link_value - array['service_id', 'role', 'sort_order', 'configuration'] <> '{}'::jsonb
        or not link_value ? 'service_id'
      then
        raise exception 'invalid Form Service link' using errcode = '22023';
      end if;
      select service.* into service_row
      from public.services as service
      where service.id = (link_value ->> 'service_id')::uuid
        and service.archived_at is null
        and service.tenant_id = form_row.tenant_id;
      if service_row.id is null then raise no_data_found; end if;
      insert into public.form_service_links (
        form_version_id, form_version_field_id, service_id, role, sort_order,
        configuration, service_name_snapshot, service_currency_snapshot,
        service_price_cents_snapshot
      ) values (
        version_row.id, field_row.id, service_row.id,
        coalesce(link_value ->> 'role', 'offered_item'),
        coalesce((link_value ->> 'sort_order')::integer, 0),
        coalesce(link_value -> 'configuration', '{}'::jsonb),
        service_row.name, service_row.currency, (service_row.price * 100)::bigint
      );
    end loop;
  end loop;

  for link_value in
    select value from jsonb_array_elements(coalesce(p_definition -> 'service_links', '[]'::jsonb))
  loop
    if jsonb_typeof(link_value) <> 'object'
      or link_value - array['service_id', 'role', 'sort_order', 'configuration'] <> '{}'::jsonb
      or not link_value ? 'service_id'
    then
      raise exception 'invalid Form Service link' using errcode = '22023';
    end if;
    select service.* into service_row
    from public.services as service
    where service.id = (link_value ->> 'service_id')::uuid
      and service.archived_at is null
      and service.tenant_id = form_row.tenant_id;
    if service_row.id is null then raise no_data_found; end if;
    insert into public.form_service_links (
      form_version_id, form_version_field_id, service_id, role, sort_order,
      configuration, service_name_snapshot, service_currency_snapshot,
      service_price_cents_snapshot
    ) values (
      version_row.id, null, service_row.id,
      coalesce(link_value ->> 'role', 'intake_assignment'),
      coalesce((link_value ->> 'sort_order')::integer, 0),
      coalesce(link_value -> 'configuration', '{}'::jsonb),
      service_row.name, service_row.currency, (service_row.price * 100)::bigint
    );
  end loop;

  for rule_value in
    select value from jsonb_array_elements(coalesce(p_definition -> 'rules', '[]'::jsonb))
  loop
    if jsonb_typeof(rule_value) <> 'object'
      or rule_value - array['rule_key', 'sort_order', 'conditions', 'action', 'target_field_keys'] <> '{}'::jsonb
      or not rule_value ?& array['rule_key', 'sort_order', 'conditions', 'action', 'target_field_keys']
    then
      raise exception 'invalid Form conditional rule' using errcode = '22023';
    end if;
    insert into public.form_rules (
      form_version_id, rule_key, sort_order, conditions, action, target_field_keys
    ) values (
      version_row.id,
      (rule_value ->> 'rule_key')::uuid,
      (rule_value ->> 'sort_order')::integer,
      rule_value -> 'conditions',
      rule_value ->> 'action',
      rule_value -> 'target_field_keys'
    );
  end loop;

  perform private.validate_form_version(version_row.id);
  select * into version_row from public.form_versions where id = version_row.id;
  return version_row;
end;
$function$
;

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
    and form.published_version_id = version_row.id
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

create or replace function private.create_ticket_from_contact_submission(p_submission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  submission_row public.form_submissions;
  version_row public.form_versions;
  subject_key uuid;
  message_key uuid;
  subject_value text;
  message_value text;
  requester_name_value text;
  requester_email_value text;
  actor_class text;
  ticket_row public.tickets;
  message_row public.ticket_messages;
begin
  perform private.lock_tenant_module_lifecycle((select f.tenant_id from public.forms f join public.form_submissions s on s.form_id=f.id where s.id=p_submission_id));
  select submission.* into submission_row
  from public.form_submissions as submission
  where submission.id = p_submission_id
    and submission.orchestration_type = 'contact_ticket'
    and submission.orchestration_status = 'deferred'
    and submission.supersedes_submission_id is null
    and submission.provenance->>'tickets_enabled_at_submission'='true'
  for update;
  if submission_row.id is null then
    select id into ticket_row.id from public.tickets where source_form_submission_id = p_submission_id;
    return ticket_row.id;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = submission_row.form_version_id;
  if version_row.id is null then return null; end if;

  perform private.lock_tenant_module_lifecycle((select tenant_id from public.forms where id=submission_row.form_id));
  if not private.tenant_module_allowed((select tenant_id from public.forms where id=submission_row.form_id),'forms') or not private.tenant_module_allowed((select tenant_id from public.forms where id=submission_row.form_id),'tickets') then
    return null;
  end if;

  if not exists(select 1 from public.forms f join public.tenants t on t.id=f.tenant_id
    where f.id=submission_row.form_id and f.archived_at is null and t.status='active' and t.archived_at is null
    and (submission_row.company_id is null or exists(select 1 from public.companies c where c.id=submission_row.company_id and c.tenant_id=f.tenant_id and c.archived_at is null))
    and (submission_row.submitted_by_profile_id is null or exists(select 1 from public.profiles p
      join public.tenant_memberships m on m.profile_id=p.id and m.tenant_id=f.tenant_id
      where p.id=submission_row.submitted_by_profile_id and p.archived_at is null and m.archived_at is null
      and (m.account_class='internal' or m.company_id=submission_row.company_id)
      and private.profile_has_permission_in_tenant(p.id,f.tenant_id,case when m.account_class='client' then 'forms.view' else 'forms.submissions_manage' end)))) then
    raise exception 'Contact submission authority is unavailable' using errcode='42501';
  end if;

  subject_key := (version_row.type_config ->> 'subject_field_key')::uuid;
  message_key := (version_row.type_config ->> 'message_field_key')::uuid;
  select value #>> '{}' into subject_value
  from public.form_submission_values
  where submission_id = submission_row.id and stable_field_key = subject_key;
  select value #>> '{}' into message_value
  from public.form_submission_values
  where submission_id = submission_row.id and stable_field_key = message_key;
  if nullif(btrim(subject_value), '') is null or nullif(btrim(message_value), '') is null then
    return null;
  end if;

  select value #>> '{}' into requester_email_value
  from public.form_submission_values
  where submission_id = submission_row.id and field_type_snapshot = 'email'
  order by sort_order_snapshot limit 1;
  select coalesce(value #>> '{}', value ->> 'full') into requester_name_value
  from public.form_submission_values
  where submission_id = submission_row.id and field_type_snapshot = 'fullname'
  order by sort_order_snapshot limit 1;

  if submission_row.submitted_by_profile_id is not null then
    -- The submitter's class in the Form's Tenant, not the global role.
    select membership_row.account_class into actor_class
    from public.tenant_memberships as membership_row
    join public.forms as form_row
      on form_row.tenant_id = membership_row.tenant_id
    where form_row.id = submission_row.form_id
      and membership_row.profile_id = submission_row.submitted_by_profile_id
      and membership_row.archived_at is null;
  end if;

  insert into public.tickets (
    tenant_id,
    company_id, client_profile_id, requester_name, requester_email,
    subject, status, priority, created_by_profile_id,
    source_form_submission_id, source_form_version_id
  ) values (
    (select form_row.tenant_id from public.forms as form_row where form_row.id = submission_row.form_id),
    submission_row.company_id, submission_row.client_profile_id,
    nullif(btrim(requester_name_value), ''), nullif(btrim(requester_email_value), ''),
    btrim(subject_value), 'open', 'normal', submission_row.submitted_by_profile_id,
    submission_row.id, submission_row.form_version_id
  )
  on conflict (source_form_submission_id) do nothing
  returning * into ticket_row;

  if ticket_row.id is null then
    select * into ticket_row from public.tickets where source_form_submission_id = submission_row.id;
    return ticket_row.id;
  end if;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body
  ) values (
    ticket_row.id,
    submission_row.submitted_by_profile_id,
    case when submission_row.submitted_by_profile_id is null then 'guest'
      when actor_class = 'client' then 'client' else 'internal' end,
    'initial_request', 'client', btrim(message_value)
  ) returning * into message_row;

  update public.form_submissions
  set orchestration_status = 'completed',
      provenance = provenance || jsonb_build_object('ticket_id', ticket_row.id)
  where id = submission_row.id;

  perform private.record_ticket_activity(
    ticket_row.id, 'ticket.created', 'Created Ticket from Contact Form.',
    jsonb_build_object(
      'form_submission_id', submission_row.id,
      'form_version_id', submission_row.form_version_id,
      'initial_message_id', message_row.id
    ), submission_row.submitted_by_profile_id
  );
  return ticket_row.id;
end;
$function$;
