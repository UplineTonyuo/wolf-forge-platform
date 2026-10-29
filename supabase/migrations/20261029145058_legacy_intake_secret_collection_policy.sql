-- Collection policy is separate from immutable definitions, assignments and signed evidence.
create table private.intake_secret_collection_policy (
  form_version_id uuid not null,
  field_key uuid not null,
  schema_hash text not null check (schema_hash ~ '^[0-9a-f]{32}$'),
  primary key (form_version_id, field_key),
  foreign key (form_version_id, field_key)
    references public.form_version_fields (form_version_id, stable_field_key)
);
alter table private.intake_secret_collection_policy enable row level security;
alter table private.intake_secret_collection_policy force row level security;
revoke all on private.intake_secret_collection_policy from public, anon, authenticated, service_role;

create function private.intake_secret_field_collection_enabled(p_version uuid, p_field uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from public.form_version_fields field
    join public.form_versions version on version.id = field.form_version_id
    join public.forms form on form.id = version.form_id
    where field.form_version_id = p_version and field.stable_field_key = p_field
      and field.field_type = 'secret'
      and form.form_type in ('intake', 'onboarding')
      and form.visibility = 'assigned' and version.visibility = 'assigned'
      and version.lifecycle_state = 'published'
      and (field.settings->>'collection_mode' = 'encrypted'
        or (field.settings->>'collection_mode' = 'disabled' and not field.required
          and (field.default_value is null or field.default_value = 'null'::jsonb)
          and exists (select 1 from private.intake_secret_collection_policy policy
            where policy.form_version_id = version.id and policy.field_key = field.stable_field_key
              and policy.schema_hash = version.schema_hash)))
  );
$$;
revoke all on function private.intake_secret_field_collection_enabled(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Fresh databases have no production business rows. Partial or changed matches fail closed.
do $manifest$
begin
  if not exists (select 1 from public.forms where id = '79332056-56c6-4bdc-ae8e-16da839acd67')
    and not exists (select 1 from public.form_versions where id in (
      '781bdb5f-fc32-41bc-ab35-1b34eae7161f', 'f48a5856-c85a-4fc4-88a6-2437c5b8bf94'))
    and not exists (select 1 from public.form_assignments where id = '1be3432a-3062-4381-aaf3-4088631740db') then
    return;
  end if;
  if not exists (
    select 1 from public.form_assignments assignment
    join public.forms form on form.id = assignment.form_id
    join public.form_versions original on original.id = assignment.form_version_id and original.form_id = form.id
    join public.form_version_fields field on field.form_version_id = original.id
      and field.stable_field_key = '06fe8b99-0ab2-53e8-adbd-1b76ff8fecb8'
    join public.form_versions latest on latest.id = form.published_version_id and latest.form_id = form.id
    join public.form_version_fields replacement on replacement.form_version_id = latest.id
      and replacement.stable_field_key = field.stable_field_key
    join private.client_order_starts gate on assignment.id = any(gate.assignment_ids)
      and gate.order_id = assignment.order_id and gate.company_id = assignment.company_id
      and gate.purchaser_id = assignment.client_profile_id and gate.tenant_id = form.tenant_id
    join public.orders project on project.id = gate.order_id and project.tenant_id = gate.tenant_id
      and project.company_id = gate.company_id
    where assignment.id = '1be3432a-3062-4381-aaf3-4088631740db'
      and assignment.status = 'assigned' and assignment.archived_at is null
      and form.id = '79332056-56c6-4bdc-ae8e-16da839acd67'
      and form.form_type = 'intake' and form.visibility = 'assigned'
      and form.status = 'published' and form.archived_at is null
      and original.id = '781bdb5f-fc32-41bc-ab35-1b34eae7161f' and original.version_number = 1
      and original.lifecycle_state = 'published' and original.visibility = 'assigned'
      and original.schema_hash = '34cd34d7725f6d2a33e1ab4703ea05eb'
      and field.field_type = 'secret' and field.label = 'WordPress Password'
      and field.settings->>'collection_mode' = 'disabled' and not field.required
      and (field.default_value is null or field.default_value = 'null'::jsonb)
      and latest.id = 'f48a5856-c85a-4fc4-88a6-2437c5b8bf94' and latest.version_number = 2
      and latest.lifecycle_state = 'published' and latest.visibility = 'assigned'
      and replacement.field_type = 'secret' and replacement.label = field.label
      and replacement.settings->>'collection_mode' = 'encrypted'
      and gate.assignment_versions->>assignment.id::text = original.id::text
      and gate.started_at is null and project.status = 'pending' and project.archived_at is null
  ) then
    raise exception 'Legacy WordPress collection manifest has drifted' using errcode = '55000';
  end if;
  insert into private.intake_secret_collection_policy(form_version_id, field_key, schema_hash)
    values ('781bdb5f-fc32-41bc-ab35-1b34eae7161f', '06fe8b99-0ab2-53e8-adbd-1b76ff8fecb8',
      '34cd34d7725f6d2a33e1ab4703ea05eb');
end;
$manifest$;

-- Keep each existing function's authorization, owner and ACL; refuse unexpected source drift.
do $replace$
declare
  change record; target oid; definition text; original_owner oid; original_acl aclitem[];
  saved_owner oid; saved_acl aclitem[]; source text; saved_source text;
begin
  for change in select * from (values
    ('private.recheck_intake_secret_capture(uuid,uuid,uuid,uuid)', 'eb02af4ba34cc47b3fdbc412dfd1da79', 'field.field_type=''secret'' and field.settings->>''collection_mode''=''encrypted''', 'field.field_type=''secret'' and private.intake_secret_field_collection_enabled(p_version,p_field)'),
    ('public.app_capture_intake_secret(uuid,uuid,uuid,text)', '62ea7367d4a93fae41e1eb74267b1bd0', 'and stable_field_key=p_field_key and field_type=''secret'' and settings->>''collection_mode''=''encrypted'';', 'and stable_field_key=p_field_key and field_type=''secret'' and private.intake_secret_field_collection_enabled(assignment.form_version_id,p_field_key);'),
    ('private.validate_form_submission_values(uuid,jsonb)', 'fa3f03abe3044cc926081c488d31d40b', 'if field_row.field_type = ''password'' or (field_row.field_type=''secret'' and field_row.settings->>''collection_mode'' is distinct from ''encrypted'') then', 'if field_row.field_type = ''password'' or (field_row.field_type=''secret'' and not private.intake_secret_field_collection_enabled(p_form_version_id,submitted_key)) then'),
    ('public.app_save_intake_draft(uuid,jsonb)', '3a257f0adf24be4ec19cbe4da918a10d', 'if secret_answer.settings->>''collection_mode'' is distinct from ''encrypted'' then', 'if not private.intake_secret_field_collection_enabled(assignment.form_version_id,secret_answer.key) then'),
    ('public.app_get_intake_draft(uuid)', 'a433aef8096536bea6511060bc175dec', 'field.settings->>''collection_mode''=''encrypted''', 'private.intake_secret_field_collection_enabled(field.form_version_id,field.stable_field_key)'),
    ('public.app_get_form_assignment_history(uuid)', '3925402eb3f62aa281b2321a536eec58', 'field.field_type=''secret'' and field.settings->>''collection_mode''=''encrypted''', 'field.field_type=''secret'' and private.intake_secret_field_collection_enabled(field.form_version_id,field.stable_field_key)'),
    ('public.app_get_assigned_form_schema(uuid)', '9b44c6dfae9981a8782a46873be44f2e', '''settings'', field.settings,', '''settings'', field.settings,
          ''encrypted_collection_allowed'', private.intake_secret_field_collection_enabled(version_row.id,field.stable_field_key),')
  ) as changes(signature, expected_source_md5, old_fragment, new_fragment)
  loop
    target := to_regprocedure(change.signature);
    if target is null then raise exception 'Missing legacy collection function: %', change.signature; end if;
    select replace(prosrc, chr(13), ''), proowner, proacl into source, original_owner, original_acl
      from pg_proc where oid = target;
    if md5(source) is distinct from change.expected_source_md5
      or (length(source) - length(replace(source, change.old_fragment, ''))) <> length(change.old_fragment) then
      raise exception 'Legacy collection function source drift: %', change.signature using errcode = '55000';
    end if;
    definition := replace(pg_get_functiondef(target), chr(13), '');
    execute replace(definition, change.old_fragment, change.new_fragment);
    select proowner, proacl, replace(prosrc, chr(13), '') into saved_owner, saved_acl, saved_source
      from pg_proc where oid = target;
    if saved_owner is distinct from original_owner or saved_acl is distinct from original_acl
      or saved_source is distinct from replace(source, change.old_fragment, change.new_fragment) then
      raise exception 'Legacy collection function authority drift: %', change.signature using errcode = '55000';
    end if;
  end loop;
end;
$replace$;
