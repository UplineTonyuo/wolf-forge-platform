-- WL-2.27 (KI-115 D6): Form submission is Tenant-relative.
--
-- Before: public.app_submit_form classified a signed-in submitter by the
-- global profiles.role_id. Tenant B staff whose global role is 'client' were
-- refused Tenant B public Forms (portal module check), and a Tenant B client
-- whose global role is internal was refused too (forms.submissions_manage).
-- A member of another Tenant could submit a Form by version id under its own
-- selector, and as a client attached its own Company and profile to the
-- foreign Tenant's submission (order Forms; contact Forms failed on the
-- Ticket FK). private.create_ticket_from_contact_submission labelled the
-- initial message author by global role.
--
-- After: the Form decides the Tenant. A signed-in caller acts through its
-- active membership in the Form's Tenant (private.current_account_class(),
-- only when that Tenant is the selected one). Without one, a public Form takes
-- the caller as an anonymous guest (no Company, no profile, no activity actor,
-- anonymous throttles and bot check, Ticket author 'guest'); an authenticated /
-- assigned Form refuses it (42501), as does an archived profile. The Ticket author class comes from the submitter's
-- membership in the Form's Tenant.

create or replace function public.app_submit_form(p_request_id uuid, p_form_version_id uuid, p_context jsonb, p_values jsonb, p_files jsonb DEFAULT '[]'::jsonb)
returns form_submissions
language plpgsql
security definer
set search_path = ''
as $function$
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

    if actor_class = 'client' and (
      actor_company_id <> assignment_row.company_id
      or actor_id <> assignment_row.client_profile_id
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
  return submission_row;
end;
$function$;

create or replace function private.create_ticket_from_contact_submission(p_submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
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
  select submission.* into submission_row
  from public.form_submissions as submission
  where submission.id = p_submission_id
    and submission.orchestration_type = 'contact_ticket'
    and submission.orchestration_status = 'deferred'
  for update;
  if submission_row.id is null then
    select id into ticket_row.id from public.tickets where source_form_submission_id = p_submission_id;
    return ticket_row.id;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = submission_row.form_version_id;
  if version_row.id is null then return null; end if;

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
