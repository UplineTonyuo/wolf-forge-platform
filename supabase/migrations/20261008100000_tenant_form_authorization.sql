-- WL-2.14 (KI-111, Forms portion): Form management is Tenant-bound.
--
-- Model (unchanged, WL-1C.2a): public.forms is the authoritative Tenant root;
-- form_versions, form_assignments and form_submissions inherit through it, and
-- no child gains a tenant_id.
--
-- Old model (verified live): every Form management RPC looked its target up by
-- id alone, so an internal user of the current Tenant could archive, update,
-- publish or re-assign another Tenant's Form; app_list_assigned_forms returned
-- every Tenant's assignments to any internal caller; app_get_assigned_form_schema,
-- app_get_form_submission, app_publish_form, app_correct_form_submission and
-- the create / update replay paths returned foreign rows (an existence
-- oracle); private.replace_form_draft accepted a foreign Service id; and the
-- forms / form_versions / form_assignments / form_submissions and child RLS
-- policies had no Tenant predicate on their internal branches.
--
-- New model (D-272): every caller-supplied Form, version, assignment,
-- submission or Service id lookup adds tenant_id = (select
-- private.current_tenant_id()) (children prove the Tenant through their parent
-- Form); a foreign row behaves like a missing one (P0002, or the existing
-- 42501 where the path already raised it). The onboarding assignment client
-- resolution moves from the global profile / company pair to a current-Tenant
-- tenant_memberships row (membership-authoritative model, D-274 / WL-2.10).
-- app_list_assigned_forms adds the Form-Tenant predicate to both branches.
-- The ten internal RLS branches gain the Tenant predicate; client branches
-- already bind through the membership-based current_user_company_id().
--
-- Two narrow review-driven bindings apply to authenticated paths only (WL-2.14
-- attack review F1 / F2): in app_submit_form's intake / onboarding assignment
-- branch a non-client submitter must be in the assignment's own Tenant; in
-- app_get_published_form_schema's 'assigned' visibility branch an internal
-- reader must be in the Form's own Tenant.
--
-- Public Form boundary preserved: the Form itself determines the Tenant;
-- anonymous submission needs no membership; a signed-in user from another
-- Tenant behaves like a public visitor when no foreign business context is
-- supplied; supplied company / profile context still fails through the
-- existing anti-spoof checks; the 'public' and 'authenticated' visibility
-- paths and all client flows are unchanged.
-- private.create_ticket_from_contact_submission is untouched (Ticket Tenant
-- already derives from the Form, WL-1C.2b / WL-2.5).
--
-- Recorded, not changed here: forms.canonical_key stays a GLOBAL unique
-- namespace because the public schema lookup addresses Forms by canonical key
-- without tenant membership; the app_create_form 23505 namespace oracle for
-- forms.manage callers is the same class as KI-116 (recorded as KI-117;
-- direction deferred). Trusted-role Form root re-homing stays the KI-107 class.
CREATE OR REPLACE FUNCTION private.replace_form_draft(p_form_id uuid, p_form_version_id uuid, p_definition jsonb, p_actor_id uuid)
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
  if form_row.id is null then raise no_data_found; end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id
    and version.form_id = p_form_id
    and version.lifecycle_state = 'draft'
  for update;
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

CREATE OR REPLACE FUNCTION public.app_archive_form(p_request_id uuid, p_form_id uuid)
 RETURNS forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_form_capability('forms.manage');
  existing_id uuid;
  form_row public.forms;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id);
begin
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

CREATE OR REPLACE FUNCTION public.app_assign_form(p_request_id uuid, p_form_id uuid, p_context jsonb)
 RETURNS form_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_form_capability('forms.assign');
  existing_id uuid;
  form_row public.forms;
  assignment_row public.form_assignments;
  order_row public.orders;
  client_row public.profiles;
  company_id_value uuid;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id, 'context', p_context);
begin
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
$function$
;

CREATE OR REPLACE FUNCTION public.app_correct_form_submission(p_request_id uuid, p_submission_id uuid, p_values jsonb)
 RETURNS form_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_form_capability('forms.submissions_manage');
  original_row public.form_submissions;
  corrected_row public.form_submissions;
  field_row public.form_version_fields;
  submitted_value jsonb;
  existing_id uuid;
  next_revision integer;
  request_payload jsonb := jsonb_build_object('submission_id', p_submission_id, 'values', p_values);
begin
  existing_id := private.find_form_submission_request(
    'form.submission.correct', p_request_id, actor_id, request_payload
  );
  if existing_id is not null then
    select submission.* into corrected_row from public.form_submissions as submission join public.forms as form_row on form_row.id = submission.form_id where submission.id = existing_id and form_row.tenant_id = (select private.current_tenant_id());
    if corrected_row.id is null then raise no_data_found; end if;
    return corrected_row;
  end if;
  select submission.* into original_row from public.form_submissions as submission join public.forms as form_row on form_row.id = submission.form_id where submission.id = p_submission_id and form_row.tenant_id = (select private.current_tenant_id()) for share of submission;
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
    original_row.orchestration_type, original_row.orchestration_status, actor_id,
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

CREATE OR REPLACE FUNCTION public.app_create_form(p_request_id uuid, p_payload jsonb)
 RETURNS forms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_form_capability('forms.manage');
  existing_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  definition jsonb;
begin
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

CREATE OR REPLACE FUNCTION public.app_get_assigned_form_schema(p_assignment_id uuid)
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

  if client_access and not (
    client_company_id = assignment.company_id
    and actor.id = assignment.client_profile_id
  ) then
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

CREATE OR REPLACE FUNCTION public.app_get_form_submission(p_submission_id uuid)
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
    perform public.app_require_module_access('portal_forms');
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

  if client_access and not (
    client_company_id = submission_row.company_id
    and actor_profile.id = submission_row.client_profile_id
  ) then
    raise exception 'Form submission access is denied' using errcode = '42501';
  end if;

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

CREATE OR REPLACE FUNCTION public.app_get_published_form_schema(p_canonical_key text)
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

CREATE OR REPLACE FUNCTION public.app_list_assigned_forms()
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
    perform public.app_require_module_access('portal_forms');
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

CREATE OR REPLACE FUNCTION public.app_publish_form(p_request_id uuid, p_form_id uuid)
 RETURNS form_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_form_capability('forms.publish');
  existing_id uuid;
  form_row public.forms;
  published_row public.form_versions;
  next_draft public.form_versions;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id);
begin
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

CREATE OR REPLACE FUNCTION public.app_submit_form(p_request_id uuid, p_form_version_id uuid, p_context jsonb, p_values jsonb, p_files jsonb DEFAULT '[]'::jsonb)
 RETURNS form_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  actor_role text;
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

  if actor_id is not null then
    select profile.* into actor_profile
    from public.profiles as profile
    where profile.id = actor_id
      and profile.archived_at is null;

    if actor_profile.id is null then
      raise exception 'active Form submitter is required' using errcode = '42501';
    end if;

    select role_row.name into actor_role
    from public.roles as role_row
    where role_row.id = actor_profile.role_id;
  end if;

  -- Every authenticated client submission reauthorizes the portal module
  -- before the idempotency lookup, so revoking Forms access is immediate.
  if actor_role = 'client' then
    perform public.app_require_module_access('portal_forms');
    perform private.require_permission('forms.view');

    actor_company_id := private.current_user_company_id();
    if actor_company_id is null then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    -- An assigned retry is allowed after completion, but only for the exact
    -- profile that owns the assignment. This check therefore intentionally
    -- does not require status = assigned.
    if p_context ? 'assignment_id' then
      select assignment.* into assignment_row
      from public.form_assignments as assignment
      where assignment.id = (p_context ->> 'assignment_id')::uuid
        and assignment.archived_at is null;

      if assignment_row.id is null
        or assignment_row.company_id <> actor_company_id
        or assignment_row.client_profile_id <> actor_id
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
    return submission_row;
  end if;

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

    if actor_role = 'client' and (
      actor_company_id <> assignment_row.company_id
      or actor_id <> assignment_row.client_profile_id
    ) then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    if actor_role <> 'client'
      and not private.current_user_has_permission('forms.submissions_manage')
    then
      raise exception 'permission denied: forms.submissions_manage'
        using errcode = '42501';
    end if;

    if actor_role <> 'client'
      and form_row.tenant_id <> (select private.current_tenant_id())
    then
      raise exception 'Form assignment access is denied' using errcode = '42501';
    end if;

    company_id_value := assignment_row.company_id;
    client_profile_id_value := assignment_row.client_profile_id;
    order_id_value := assignment_row.order_id;
  else
    if actor_role = 'client' then
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
    orchestration_type_value := 'contact_ticket';
    orchestration_status_value := 'deferred';
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
      'orchestration_deferred', orchestration_status_value = 'deferred'
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

  perform private.record_form_activity(
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
  return submission_row;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.app_update_form_draft(p_request_id uuid, p_form_id uuid, p_definition jsonb)
 RETURNS form_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := private.require_form_capability('forms.manage');
  existing_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id, 'definition', p_definition);
begin
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

alter policy forms_internal_select on public.forms
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and public.app_has_permission('forms.view'));

alter policy form_versions_internal_select on public.form_versions
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.view')
    and exists (
      select 1
      from public.forms as form_row
      where form_row.id = form_versions.form_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_version_fields_internal_select on public.form_version_fields
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.view')
    and exists (
      select 1
      from public.form_versions as version_row
      join public.forms as form_row on form_row.id = version_row.form_id
      where version_row.id = form_version_fields.form_version_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_field_options_internal_select on public.form_field_options
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.view')
    and exists (
      select 1
      from public.form_version_fields as field_row
      join public.form_versions as version_row on version_row.id = field_row.form_version_id
      join public.forms as form_row on form_row.id = version_row.form_id
      where field_row.id = form_field_options.form_version_field_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_rules_internal_select on public.form_rules
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.view')
    and exists (
      select 1
      from public.form_versions as version_row
      join public.forms as form_row on form_row.id = version_row.form_id
      where version_row.id = form_rules.form_version_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_service_links_internal_select on public.form_service_links
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.view')
    and exists (
      select 1
      from public.form_versions as version_row
      join public.forms as form_row on form_row.id = version_row.form_id
      where version_row.id = form_service_links.form_version_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_files_internal_select on public.form_files
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.submissions_view')
    and exists (
      select 1
      from public.form_submissions as submission_row
      join public.forms as form_row on form_row.id = submission_row.form_id
      where submission_row.id = form_files.submission_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_submission_values_internal_select on public.form_submission_values
  using ((select private.is_internal_user())
    and public.app_has_permission('forms.submissions_view')
    and exists (
      select 1
      from public.form_submissions as submission_row
      join public.forms as form_row on form_row.id = submission_row.form_id
      where submission_row.id = form_submission_values.submission_id
        and form_row.tenant_id = (select private.current_tenant_id())
    ));

alter policy form_submissions_authorized_select on public.form_submissions
  using (((select private.is_internal_user())
      and public.app_has_permission('forms.submissions_view')
      and exists (
        select 1
        from public.forms as form_row
        where form_row.id = form_submissions.form_id
          and form_row.tenant_id = (select private.current_tenant_id())
      ))
    or ((select private.is_client_user())
      and public.app_has_permission('forms.view')
      and company_id = (select private.current_user_company_id())
      and client_profile_id = (select auth.uid())));

alter policy form_assignments_authorized_select on public.form_assignments
  using (((select private.is_internal_user())
      and (public.app_has_permission('forms.assign') or public.app_has_permission('forms.submissions_view'))
      and exists (
        select 1
        from public.forms as form_row
        where form_row.id = form_assignments.form_id
          and form_row.tenant_id = (select private.current_tenant_id())
      ))
    or ((select private.is_client_user())
      and public.app_has_permission('forms.view')
      and company_id = (select private.current_user_company_id())
      and client_profile_id = (select auth.uid())));
