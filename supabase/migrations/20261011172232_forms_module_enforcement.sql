-- Forms lifecycle: new collection/management stops; retained history grants nothing new.
-- No publication, fixture or historical business row is changed by this migration.
create function private.require_forms_write(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_tenant_id is null then raise exception 'Form Tenant is required' using errcode='23502'; end if;
  perform private.lock_tenant_module_lifecycle(p_tenant_id);
  if auth.uid() is null and not exists(select 1 from private.tenant_module_publications where tenant_id=p_tenant_id) then return; end if;
  if exists(select 1 from public.tenants where id=p_tenant_id and (status<>'active' or archived_at is not null)) then raise exception 'Form version is unavailable for submission' using errcode='55000'; end if;
  if not private.tenant_module_allowed(p_tenant_id,'forms') or not exists (
    select 1 from public.tenants where id=p_tenant_id and status='active' and archived_at is null
  ) then raise exception 'WF_FORMS_DISABLED' using errcode='42501'; end if;
end;
$$;
revoke all on function private.require_forms_write(uuid) from public,anon,authenticated,service_role;

create function public.app_forms_work_enabled()
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_account_class() is null or not (
    private.current_user_has_permission('forms.view') or private.current_user_has_permission('forms.submissions_view')
  ) then raise exception 'Form access is denied' using errcode='42501'; end if;
  return private.tenant_module_allowed(private.current_tenant_id(),'forms');
end;
$$;
revoke all on function public.app_forms_work_enabled() from public,anon,authenticated,service_role;
grant execute on function public.app_forms_work_enabled() to authenticated;

create function private.can_read_form_submission(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.form_submissions s join public.forms f on f.id=s.form_id
  where s.id=p_id and f.tenant_id=private.current_tenant_id() and f.archived_at is null
  and (s.company_id is null or exists(select 1 from public.companies c where c.id=s.company_id and c.tenant_id=f.tenant_id and c.archived_at is null))
  and (s.form_assignment_id is null or exists(select 1 from public.form_assignments a where a.id=s.form_assignment_id and a.form_id=s.form_id and a.archived_at is null))
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.archived_at is null)
  and ((private.current_account_class()='internal' and private.current_user_has_permission('forms.submissions_view'))
    or (private.current_account_class()='client' and private.current_user_has_permission('forms.view')
      and s.company_id=private.current_user_company_id() and s.client_profile_id=auth.uid())));
$$;
revoke all on function private.can_read_form_submission(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_form_submission(uuid) to authenticated;


-- Accepted predecessor: 20261010222032_invoices_module_enforcement.sql
create or replace function private.published_module_set_valid(p_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    p_keys is not null
    and array_ndims(p_keys) = 1
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as requested(key))
    and not exists (
      select 1 from unnest(p_keys) as requested(key)
      where key is null or not exists (
        select 1 from private.white_label_modules as catalog where catalog.module_key = key
      )
    )
    and (not ('projects' = any(p_keys)) or 'tickets' = any(p_keys))
    and (not ('subscriptions' = any(p_keys)) or 'invoices' = any(p_keys))
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key = any(p_keys)
        and catalog.requires_module_key is not null
        and not (catalog.requires_module_key = any(p_keys))
    )
    -- Five modules have audited disablement coverage.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects', 'tickets', 'subscriptions', 'invoices', 'forms') and not (catalog.module_key = any(p_keys))
    ), false);
$function$
;

-- Accepted predecessor: 20261010140000_tickets_module_enforcement.sql
create or replace function private.profile_has_permission_in_tenant(p_profile_id uuid, p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (case when p_permission_key in ('reporting.view', 'reports.send', 'reports.send_anytime')
      then private.tenant_module_allowed(p_tenant_id, 'reporting')
      when p_permission_key in ('investment_intent.view', 'investment_intent.manage')
      then private.tenant_module_allowed(p_tenant_id, 'investment_intent')
      when p_permission_key in ('projects.view', 'projects.create', 'projects.edit', 'projects.assign', 'projects.archive')
      then private.tenant_module_allowed(p_tenant_id, 'projects')
      when p_permission_key in ('tickets.view', 'tickets.create', 'tickets.reply', 'tickets.edit', 'tickets.assign', 'tickets.internal_notes', 'tickets.archive')
      then private.tenant_module_allowed(p_tenant_id, 'tickets')
      when p_permission_key in ('forms.manage','forms.publish','forms.assign','forms.submissions_manage')
      then private.tenant_module_allowed(p_tenant_id,'forms')
      else true end)
    and coalesce((
      select case when preset_row.key = 'owner' then true else coalesce(
        (select profile_override.allowed from public.profile_permission_overrides as profile_override
         where profile_override.tenant_id = membership_row.tenant_id
           and profile_override.profile_id = membership_row.profile_id
           and profile_override.permission_key = p_permission_key),
        (select preset_grant.allowed from public.role_permissions as preset_grant
         where preset_grant.role_id = membership_row.role_id
           and preset_grant.permission_key = p_permission_key), false) end
      from public.tenant_memberships as membership_row
      join public.permission_presets as preset_row on preset_row.role_id = membership_row.role_id
      where membership_row.tenant_id = p_tenant_id
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null
        and exists (select 1 from public.permissions as permission where permission.permission_key = p_permission_key)
    ), false);
$function$;

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
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

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
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
  if existing_id is not null then
    select * into form_row from public.forms where id = existing_id and tenant_id = (select private.current_tenant_id());
    if form_row.id is null then raise no_data_found; end if;
    return form_row;
  end if;
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

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
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
  if existing_id is not null then
    select version.* into version_row from public.form_versions as version join public.forms as form_source on form_source.id = version.form_id where version.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if version_row.id is null then raise no_data_found; end if;
    return version_row;
  end if;
  select * into form_row from public.forms where id = p_form_id and archived_at is null and tenant_id = (select private.current_tenant_id()) for update;
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

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
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
  if existing_id is not null then
    select version.* into published_row from public.form_versions as version join public.forms as form_source on form_source.id = version.form_id where version.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if published_row.id is null then raise no_data_found; end if;
    return published_row;
  end if;

  select * into form_row from public.forms where id = p_form_id and archived_at is null and tenant_id = (select private.current_tenant_id()) for update;
  if form_row.id is null then raise no_data_found; end if;
  select * into published_row
  from public.form_versions
  where id = form_row.current_draft_version_id and lifecycle_state = 'draft'
  for update;
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

-- Accepted predecessor: 20261010130000_projects_module_enforcement.sql
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
  if existing_id is not null then
    select assignment.* into assignment_row from public.form_assignments as assignment join public.forms as form_source on form_source.id = assignment.form_id where assignment.id = existing_id and form_source.tenant_id = (select private.current_tenant_id());
    if assignment_row.id is null then raise no_data_found; end if;
    return assignment_row;
  end if;

  select * into form_row
  from public.forms
  where id = p_form_id and status = 'published' and archived_at is null and tenant_id = (select private.current_tenant_id())
  for update;
  if form_row.id is null then raise no_data_found; end if;

  if form_row.form_type = 'intake' then
  -- Fresh snapshots after the shared Tenant lock are required for lifecycle writes.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Projects lifecycle requires READ COMMITTED' using errcode = '55000';
  end if;
  perform 1 from public.tenants where id = private.current_tenant_id() for update;
  if not private.tenant_module_allowed(private.current_tenant_id(), 'projects') then
    raise exception 'WF_PROJECTS_DISABLED' using errcode = '42501';
  end if;

    if not p_context ? 'order_id' or p_context ? 'client_profile_id' then
      raise exception 'Intake assignment requires an Order' using errcode = '22023';
    end if;
    select * into order_row from public.orders
    where id = (p_context ->> 'order_id')::uuid and tenant_id = (select private.current_tenant_id()) and archived_at is null
    for update;
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
  return assignment_row;
end;
$function$;

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
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
  if existing_id is not null then
    select submission.* into corrected_row from public.form_submissions as submission join public.forms as form_row on form_row.id = submission.form_id where submission.id = existing_id and form_row.tenant_id = (select private.current_tenant_id()) and form_row.archived_at is null
      and (submission.company_id is null or exists(select 1 from public.companies c where c.id=submission.company_id and c.tenant_id=form_row.tenant_id and c.archived_at is null))
      and (submission.form_assignment_id is null or exists(select 1 from public.form_assignments a where a.id=submission.form_assignment_id and a.form_id=submission.form_id and a.archived_at is null));
    if corrected_row.id is null then raise no_data_found; end if;
    return corrected_row;
  end if;
  select submission.* into original_row from public.form_submissions as submission join public.forms as form_row on form_row.id = submission.form_id where submission.id = p_submission_id and form_row.tenant_id = (select private.current_tenant_id()) and form_row.archived_at is null
    and (submission.company_id is null or exists(select 1 from public.companies c where c.id=submission.company_id and c.tenant_id=form_row.tenant_id and c.archived_at is null))
    and (submission.form_assignment_id is null or exists(select 1 from public.form_assignments a where a.id=submission.form_assignment_id and a.form_id=submission.form_id and a.archived_at is null)) for share of submission;
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
  return corrected_row;
end;
$function$
;

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
create or replace function public.app_get_assigned_form_schema(p_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  assignment public.form_assignments;
  form_row public.forms;
  version_row public.form_versions;
  internal_access boolean;
  client_access boolean;
  client_company_id uuid;
begin
  if not private.tenant_module_allowed(private.current_tenant_id(),'forms') then raise exception 'WF_FORMS_DISABLED' using errcode='42501'; end if;
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and archived_at is null;
  if actor.id is null then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  internal_access := (select private.is_internal_user()) and (
    private.current_user_has_permission('forms.assign')
    or private.current_user_has_permission('forms.submissions_view')
  );
  client_access := (select private.is_client_user());

  if client_access then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');
    client_company_id := private.current_user_company_id();
    if client_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;
  elsif not internal_access then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  select assignment_row.* into assignment
  from public.form_assignments as assignment_row
  join public.forms as form_source on form_source.id = assignment_row.form_id
  where assignment_row.id = p_assignment_id
    and assignment_row.archived_at is null
    and form_source.tenant_id = (select private.current_tenant_id());
  if assignment.id is null then raise no_data_found; end if;

  if client_access and (client_company_id is distinct from assignment.company_id
    or actor.id is distinct from assignment.client_profile_id) then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  select * into form_row
  from public.forms
  where id = assignment.form_id;
  select * into version_row
  from public.form_versions
  where id = assignment.form_version_id;

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
      'order_id', case when private.can_access_operational_order(assignment.order_id) then assignment.order_id end,
      'order_number', (select order_number from public.orders where id = assignment.order_id and private.can_access_operational_order(id)),
      'order_title', (select title from public.orders where id = assignment.order_id and private.can_access_operational_order(id)),
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
          'options', coalesce((
            select jsonb_agg(jsonb_build_object(
              'option_id', option.stable_option_key,
              'value', option.option_value,
              'label', option.label,
              'sort_order', option.sort_order,
              'metadata', option.metadata
            ) order by option.sort_order)
            from public.form_field_options as option
            where option.form_version_field_id = field.id
          ), '[]'::jsonb),
          'services', coalesce((
            select jsonb_agg(jsonb_build_object(
              'service_id', link.service_id,
              'role', link.role,
              'sort_order', link.sort_order,
              'configuration', link.configuration,
              'name', link.service_name_snapshot,
              'currency', link.service_currency_snapshot,
              'price_cents', link.service_price_cents_snapshot
            ) order by link.sort_order)
            from public.form_service_links as link
            where link.form_version_field_id = field.id
          ), '[]'::jsonb)
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
$function$
;

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
create or replace function public.app_get_form_submission(p_submission_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  submission_row public.form_submissions;
  actor_profile public.profiles;
  internal_access boolean;
  client_access boolean;
  client_company_id uuid;
  result jsonb;
begin
  select * into actor_profile
  from public.profiles
  where id = (select auth.uid())
    and archived_at is null;
  if actor_profile.id is null then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

  internal_access := (select private.is_internal_user())
    and private.current_user_has_permission('forms.submissions_view');
  client_access := (select private.is_client_user());

  if client_access then
    perform private.require_permission('forms.view');
    client_company_id := private.current_user_company_id();
    if client_company_id is null then
      raise exception 'Form submission access is denied' using errcode = '42501';
    end if;
  elsif not internal_access then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

  select submission.* into submission_row
  from public.form_submissions as submission
  join public.forms as form_row on form_row.id = submission.form_id
  where submission.id = p_submission_id
    and form_row.tenant_id = (select private.current_tenant_id());
  if submission_row.id is null then raise no_data_found; end if;

  if client_access and (client_company_id is distinct from submission_row.company_id
    or actor_profile.id is distinct from submission_row.client_profile_id) then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

  if not private.can_read_form_submission(submission_row.id) then raise exception 'Form submission access is denied' using errcode='42501'; end if;
  if not private.can_access_operational_order(submission_row.order_id) then submission_row.order_id:=null; end if;
  if not private.can_access_ticket((submission_row.provenance->>'ticket_id')::uuid) then submission_row.provenance:=submission_row.provenance-'ticket_id'; end if;
  select jsonb_build_object(
    'submission', to_jsonb(submission_row),
    'values', coalesce(jsonb_agg(jsonb_build_object(
      'stable_field_key', value.stable_field_key,
      'label', value.field_label_snapshot,
      'field_type', value.field_type_snapshot,
      'sort_order', value.sort_order_snapshot,
      'value', value.value
    ) order by value.sort_order_snapshot)
      filter (
        where value.id is not null
          and value.field_type_snapshot <> 'secret'
      ), '[]'::jsonb)
  ) into result
  from public.form_submission_values as value
  where value.submission_id = submission_row.id;

  return result;
end;
$function$
;

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
create or replace function public.app_get_published_form_schema(p_canonical_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_company_id uuid;
  active_actor boolean := false;
  client_access boolean := false;
  internal_access boolean := false;
  form_row public.forms;
  version_row public.form_versions;
  result jsonb;
begin
  select exists (
    select 1
    from public.profiles as profile_row
    where profile_row.id = actor_id
      and profile_row.archived_at is null
  ) into active_actor;

  client_access := (select private.is_client_user());
  internal_access := (select private.is_internal_user());

  select form.* into form_row
  from public.forms as form
  where form.canonical_key = lower(p_canonical_key)
    and form.status = 'published'
    and form.archived_at is null;
  if form_row.id is null then raise no_data_found; end if;
  if not private.tenant_module_allowed(form_row.tenant_id,'forms') or not exists(select 1 from public.tenants where id=form_row.tenant_id and status='active' and archived_at is null) then raise no_data_found; end if;
  if form_row.visibility <> 'public' and actor_id is not null and (form_row.tenant_id is distinct from private.current_tenant_id() or not private.current_user_has_permission('forms.view')) then raise exception 'Form access is denied' using errcode='42501'; end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = form_row.published_version_id;

  if form_row.visibility = 'public' then
    null;
  else
    if not active_actor then
      raise exception 'Form authentication is required' using errcode = '42501';
    end if;

    if client_access then
      perform public.app_require_module_access('portal_forms');
      perform private.require_permission('forms.view');
      actor_company_id := private.current_user_company_id();
      if actor_company_id is null then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    elsif not internal_access then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if form_row.visibility = 'assigned' then
      if client_access and not exists (
        select 1
        from public.form_assignments as assignment
        where assignment.form_id = form_row.id
          and assignment.form_version_id = version_row.id
          and assignment.status = 'assigned'
          and assignment.company_id = actor_company_id
          and assignment.client_profile_id = actor_id
          and assignment.archived_at is null
      ) then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      elsif internal_access
        and (not private.current_user_has_permission('forms.view')
          or form_row.tenant_id <> (select private.current_tenant_id()))
      then
        raise exception 'Form assignment access is denied' using errcode = '42501';
      end if;
    end if;
  end if;

  select jsonb_build_object(
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
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'option_id', option.stable_option_key,
            'value', option.option_value,
            'label', option.label,
            'sort_order', option.sort_order,
            'metadata', option.metadata
          ) order by option.sort_order)
          from public.form_field_options as option
          where option.form_version_field_id = field.id
        ), '[]'::jsonb),
        'services', coalesce((
          select jsonb_agg(jsonb_build_object(
            'service_id', link.service_id,
            'role', link.role,
            'sort_order', link.sort_order,
            'configuration', link.configuration,
            'name', link.service_name_snapshot,
            'currency', link.service_currency_snapshot,
            'price_cents', link.service_price_cents_snapshot
          ) order by link.sort_order)
          from public.form_service_links as link
          where link.form_version_field_id = field.id
        ), '[]'::jsonb)
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
  ) into result;

  return result;
end;
$function$

;

-- Accepted predecessor: 20261008100000_tenant_form_authorization.sql
create or replace function public.app_list_assigned_forms()
 RETURNS TABLE(assignment_id uuid, form_id uuid, form_type text, form_version_id uuid, version_number integer, title text, status text, required boolean, due_at timestamp with time zone, assigned_at timestamp with time zone, completed_at timestamp with time zone, company_id uuid, company_name text, client_profile_id uuid, client_name text, order_id uuid, order_number bigint, order_title text, latest_submission_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  internal_access boolean;
  client_access boolean;
  client_company_id uuid;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and archived_at is null;

  if actor.id is null then
    raise exception 'Form assignment access is denied' using errcode = '42501';
  end if;

  internal_access := (select private.is_internal_user()) and (
    private.current_user_has_permission('forms.assign')
    or private.current_user_has_permission('forms.submissions_view')
  );
  client_access := (select private.is_client_user());

  if client_access then
    perform private.require_permission('forms.view');
    client_company_id := private.current_user_company_id();
    if client_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;
  elsif not internal_access then
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
    case when private.can_access_operational_order(work.id) then work.id end,
    case when private.can_access_operational_order(work.id) then work.order_number end,
    case when private.can_access_operational_order(work.id) then work.title end,
    assignment.latest_submission_id
  from public.form_assignments as assignment
  join public.forms as form on form.id = assignment.form_id
  join public.form_versions as version on version.id = assignment.form_version_id
  join public.companies as company on company.id = assignment.company_id
  left join public.profiles as client on client.id = assignment.client_profile_id
  left join public.orders as work on work.id = assignment.order_id
  where assignment.archived_at is null
    and form.archived_at is null and company.archived_at is null
    and form.tenant_id = (select private.current_tenant_id())
    and (
      internal_access
      or (
        assignment.company_id = client_company_id
        and assignment.client_profile_id = actor.id
      )
    )
  order by
    (assignment.status = 'assigned') desc,
    assignment.due_at nulls last,
    assignment.assigned_at desc;
end;
$function$
;

-- Accepted predecessor: 20261010140000_tickets_module_enforcement.sql
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
    return submission_row;
  end if;
  perform private.require_forms_write(form_tenant_id);

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.lifecycle_state = 'published'
  for share;
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

  if form_row.visibility = 'public' then
    perform private.require_bot_verification(
      'form.submit', form_row.id::text, p_context ->> 'bot_token'
    );
  end if;

  if form_row.form_type in ('intake', 'onboarding') then
    select assignment.* into assignment_row
    from public.form_assignments as assignment
    where assignment.id = (p_context ->> 'assignment_id')::uuid
      and assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
    for update;

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
  return submission_row;
end;
$function$;

-- Accepted predecessor: 20261010140000_tickets_module_enforcement.sql
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

create function private.form_write_parent(p_table text, p_row jsonb)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
  case p_table
    when 'forms' then return (p_row->>'id')::uuid;
    when 'form_versions','form_assignments','form_submissions' then return (p_row->>'form_id')::uuid;
    when 'form_version_fields','form_rules','form_service_links' then
      select form_id into result from public.form_versions where id=(p_row->>'form_version_id')::uuid;
    when 'form_field_options' then
      select v.form_id into result from public.form_version_fields f join public.form_versions v on v.id=f.form_version_id where f.id=(p_row->>'form_version_field_id')::uuid;
    when 'form_submission_values','form_files' then
      select form_id into result from public.form_submissions where id=(p_row->>'submission_id')::uuid;
    else raise exception 'Unsupported Form child' using errcode='55000';
  end case;
  if result is null then raise exception 'Form parent unavailable' using errcode='23503'; end if;
  return result;
end;
$$;
revoke all on function private.form_write_parent(text,jsonb) from public,anon,authenticated,service_role;

create function private.enforce_forms_module_write()
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
          where f.id=new.form_id and f.status='published' and f.published_version_id=v.id and v.form_id=f.id and v.lifecycle_state='published') then
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
revoke all on function private.enforce_forms_module_write() from public,anon,authenticated,service_role;

do $$
declare relation_name text;
begin
  foreach relation_name in array array['forms','form_versions','form_version_fields','form_field_options',
    'form_rules','form_service_links','form_assignments','form_submissions','form_submission_values','form_files'] loop
    execute format('create trigger forms_module_write before insert or update or delete on public.%I for each row execute function private.enforce_forms_module_write()',relation_name);
  end loop;
end;
$$;

alter policy form_submissions_authorized_select on public.form_submissions
using (private.can_read_form_submission(id));

create function private.can_read_form_assignment(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.form_assignments a join public.forms f on f.id=a.form_id
  join public.companies c on c.id=a.company_id and c.tenant_id=f.tenant_id
  where a.id=p_id and f.tenant_id=private.current_tenant_id() and f.archived_at is null and a.archived_at is null and c.archived_at is null
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.archived_at is null)
  and ((private.current_account_class()='internal' and (private.current_user_has_permission('forms.assign') or private.current_user_has_permission('forms.submissions_view')))
    or (private.current_account_class()='client' and private.current_user_has_permission('forms.view') and a.company_id=private.current_user_company_id() and a.client_profile_id=auth.uid())));
$$;
revoke all on function private.can_read_form_assignment(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_form_assignment(uuid) to authenticated;
create policy form_assignments_parent_scope on public.form_assignments as restrictive for select to authenticated
using (private.can_read_form_assignment(id));

-- Module entry permits existing scoped history; each new writer checks lifecycle.
CREATE OR REPLACE FUNCTION public.app_require_module_access(p_module_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
declare caller_class text := private.current_account_class(); module_row public.permission_modules;
begin
  if caller_class is null then raise exception 'authentication is required' using errcode='42501'; end if;
  select * into module_row from public.permission_modules where module_key=p_module_key;
  if module_row.module_key is null or module_row.account_class<>caller_class
    or (p_module_key not in ('invoices','portal_invoices','forms','portal_forms')
      and not private.tenant_module_allowed(private.current_tenant_id(),p_module_key)) then
    raise exception 'module access is denied: %',p_module_key using errcode='42501';
  end if;
  if p_module_key='forms' and caller_class='internal' then
    if not (private.current_user_has_permission('forms.view') or private.current_user_has_permission('forms.submissions_view')) then raise exception 'Form history access is denied' using errcode='42501'; end if;
  else
    perform private.require_permission(module_row.required_permission_key);
  end if;
  return true;
end;
$$;

create function public.app_get_form_assignment_history(p_assignment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare assignment jsonb;
begin
  select to_jsonb(a) into assignment from public.app_list_assigned_forms() a where a.assignment_id=p_assignment_id;
  if assignment is null or not exists(select 1 from public.form_assignments a join public.forms f on f.id=a.form_id
    join public.companies c on c.id=a.company_id and c.tenant_id=f.tenant_id
    where a.id=p_assignment_id and a.archived_at is null and f.archived_at is null and c.archived_at is null) then raise no_data_found; end if;
  if not private.can_access_operational_order((assignment->>'order_id')::uuid) then
    assignment:=assignment || '{"order_id":null,"order_number":null,"order_title":null}'::jsonb;
  end if;
  return assignment;
end;
$$;
revoke all on function public.app_get_form_assignment_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_form_assignment_history(uuid) to authenticated;

-- All notification list/count/mark paths already use this parent predicate.
create or replace function private.financial_notification_visible(p_entity_type text,p_entity_id uuid,p_category text,p_company_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
select case when p_entity_type='invoice' then private.can_read_invoice(p_entity_id)
  when p_entity_type='form_submission' then private.can_read_form_submission(p_entity_id)
  when p_entity_type='form_assignment' then private.can_read_form_assignment(p_entity_id)
    and private.tenant_module_allowed(private.current_tenant_id(),'forms')
  when p_entity_type='form' then exists(select 1 from public.forms f where f.id=p_entity_id
    and f.tenant_id=private.current_tenant_id() and f.archived_at is null and private.current_user_has_permission('forms.view'))
  when p_category='wallet' then exists(select 1 from public.companies c where c.id=coalesce(p_company_id,p_entity_id)
    and c.tenant_id=private.current_tenant_id() and c.archived_at is null and private.can_access_client_private_company(c.id))
  else true end;
$$;

-- Preserve module ordering and all non-Forms permission requirements.
create or replace function public.app_current_user_modules()
returns table(module_key text,label text,account_class text,required_permission_key text,granted boolean)
language plpgsql stable security definer set search_path='' as $$
declare caller_class text:=private.current_account_class();
begin
  if caller_class is null then raise exception 'authentication is required' using errcode='42501'; end if;
  return query select m.module_key,m.label,m.account_class,m.required_permission_key,
    private.current_user_has_permission(m.required_permission_key)
      or (m.module_key='forms' and caller_class='internal' and private.current_user_has_permission('forms.submissions_view'))
  from public.permission_modules m where m.account_class=caller_class order by m.sort_order,m.module_key;
end;
$$;
