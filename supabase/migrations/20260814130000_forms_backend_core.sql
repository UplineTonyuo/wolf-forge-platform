-- Wolf Forge Platform - reusable Forms backend core
--
-- One versioned engine serves order, contact, intake, and onboarding forms.
-- Order checkout and Contact Ticket creation are explicit deferred orchestration
-- boundaries. No payment, invoice, subscription, ticket, or binary storage
-- implementation is duplicated here.

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values
  ('forms.publish', 'forms', 'Publish forms', 'Publish immutable Form versions.'),
  ('forms.assign', 'forms', 'Assign forms', 'Assign Intake and Onboarding Forms.'),
  ('forms.submissions_view', 'forms', 'View form submissions', 'View Form submission history.'),
  ('forms.submissions_manage', 'forms', 'Manage form submissions', 'Create audited Form submission corrections.')
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, permission_row.permission_key, true
from public.roles as role_row
cross join (
  values
    ('forms.publish'::text),
    ('forms.assign'::text),
    ('forms.submissions_view'::text),
    ('forms.submissions_manage'::text)
) as permission_row(permission_key)
where role_row.name in ('owner', 'admin')
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Shared validation helpers
-- -----------------------------------------------------------------------------

create function private.form_html_is_safe(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null or (
    p_value !~* '<\s*(script|iframe|object|embed|style|link|meta)(\s|>)'
    and p_value !~* '\son[a-z]+\s*='
    and p_value !~* '(javascript|vbscript|data)\s*:'
    and p_value !~* '<\s*/?\s*svg(\s|>)'
  );
$$;

create function private.require_form_capability(p_permission_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission(p_permission_key);
  return actor_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Core schema
-- -----------------------------------------------------------------------------

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  form_type text not null,
  canonical_key text not null,
  name text not null,
  status text not null default 'draft',
  visibility text not null default 'authenticated',
  current_draft_version_id uuid,
  published_version_id uuid,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint forms_canonical_key_unique unique (canonical_key),
  constraint forms_canonical_key_format check (canonical_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint forms_name_not_blank check (btrim(name) <> '' and char_length(name) <= 200),
  constraint forms_type_valid check (form_type in ('order', 'contact', 'intake', 'onboarding')),
  constraint forms_status_valid check (status in ('draft', 'published', 'inactive', 'archived')),
  constraint forms_visibility_valid check (visibility in ('public', 'authenticated', 'assigned')),
  constraint forms_archive_consistent check ((status = 'archived') = (archived_at is not null)),
  constraint forms_assignment_visibility_consistent check (
    (form_type in ('intake', 'onboarding') and visibility = 'assigned')
    or (form_type in ('order', 'contact') and visibility in ('public', 'authenticated'))
  )
);

create index forms_type_status_updated_idx
on public.forms (form_type, status, updated_at desc)
where archived_at is null;

create trigger forms_set_updated_at
before update on public.forms
for each row execute function private.set_updated_at();

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete restrict,
  version_number integer not null,
  lifecycle_state text not null default 'draft',
  title text not null,
  information_html text,
  visibility text not null,
  type_config jsonb not null default '{}'::jsonb,
  schema_hash text,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  published_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint form_versions_form_number_unique unique (form_id, version_number),
  constraint form_versions_id_form_unique unique (id, form_id),
  constraint form_versions_number_positive check (version_number > 0),
  constraint form_versions_state_valid check (lifecycle_state in ('draft', 'published')),
  constraint form_versions_title_not_blank check (btrim(title) <> '' and char_length(title) <= 200),
  constraint form_versions_information_safe check (private.form_html_is_safe(information_html)),
  constraint form_versions_visibility_valid check (visibility in ('public', 'authenticated', 'assigned')),
  constraint form_versions_config_object check (jsonb_typeof(type_config) = 'object'),
  constraint form_versions_publication_consistent check (
    (lifecycle_state = 'draft' and published_by_profile_id is null and published_at is null and schema_hash is null)
    or (lifecycle_state = 'published' and published_by_profile_id is not null and published_at is not null and schema_hash is not null)
  )
);

create unique index form_versions_one_draft_idx
on public.form_versions (form_id)
where lifecycle_state = 'draft';

alter table public.forms
  add constraint forms_current_draft_version_fkey
    foreign key (current_draft_version_id, id)
    references public.form_versions (id, form_id) on delete restrict
    deferrable initially deferred,
  add constraint forms_published_version_fkey
    foreign key (published_version_id, id)
    references public.form_versions (id, form_id) on delete restrict
    deferrable initially deferred;

create table public.form_version_fields (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.form_versions (id) on delete restrict,
  stable_field_key uuid not null,
  sort_order integer not null,
  field_type text not null,
  label text not null,
  internal_label text,
  placeholder text,
  help_html text,
  default_value jsonb,
  required boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint form_version_fields_id_version_unique unique (id, form_version_id),
  constraint form_version_fields_stable_key_unique unique (form_version_id, stable_field_key),
  constraint form_version_fields_sort_unique unique (form_version_id, sort_order),
  constraint form_version_fields_sort_nonnegative check (sort_order >= 0),
  constraint form_version_fields_type_valid check (field_type in (
    'optgroup', 'dropdown', 'fullname', 'email', 'password', 'address', 'phone',
    'optin', 'payment', 'text', 'textarea', 'richtext', 'date', 'checkbox',
    'data-option-group', 'data-dropdown', 'file', 'data-spreadsheet', 'secret',
    'hidden', 'signature', 'calendly', 'break', 'pagebreak', 'html', 'captcha'
  )),
  constraint form_version_fields_label_not_blank check (btrim(label) <> '' and char_length(label) <= 500),
  constraint form_version_fields_internal_label_not_blank check (internal_label is null or btrim(internal_label) <> ''),
  constraint form_version_fields_help_safe check (private.form_html_is_safe(help_html)),
  constraint form_version_fields_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint form_version_fields_secret_disabled check (
    field_type <> 'secret'
    or (not required and settings ->> 'collection_mode' = 'disabled')
  ),
  constraint form_version_fields_custom_html_safe check (
    field_type <> 'html' or private.form_html_is_safe(settings ->> 'html')
  )
);

create index form_version_fields_version_sort_idx
on public.form_version_fields (form_version_id, sort_order);

create table public.form_field_options (
  id uuid primary key default gen_random_uuid(),
  form_version_field_id uuid not null references public.form_version_fields (id) on delete restrict,
  stable_option_key uuid not null,
  option_value text not null,
  label text not null,
  sort_order integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint form_field_options_field_key_unique unique (form_version_field_id, stable_option_key),
  constraint form_field_options_field_value_unique unique (form_version_field_id, option_value),
  constraint form_field_options_field_sort_unique unique (form_version_field_id, sort_order),
  constraint form_field_options_value_not_blank check (btrim(option_value) <> ''),
  constraint form_field_options_label_not_blank check (btrim(label) <> ''),
  constraint form_field_options_sort_nonnegative check (sort_order >= 0),
  constraint form_field_options_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index form_field_options_field_sort_idx
on public.form_field_options (form_version_field_id, sort_order);

create table public.form_rules (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.form_versions (id) on delete restrict,
  rule_key uuid not null,
  sort_order integer not null,
  conditions jsonb not null,
  action text not null,
  target_field_keys jsonb not null,
  created_at timestamptz not null default now(),
  constraint form_rules_version_key_unique unique (form_version_id, rule_key),
  constraint form_rules_version_sort_unique unique (form_version_id, sort_order),
  constraint form_rules_sort_nonnegative check (sort_order >= 0),
  constraint form_rules_conditions_array check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) > 0),
  constraint form_rules_action_valid check (action in ('show', 'hide')),
  constraint form_rules_targets_array check (jsonb_typeof(target_field_keys) = 'array' and jsonb_array_length(target_field_keys) > 0)
);

create index form_rules_version_sort_idx on public.form_rules (form_version_id, sort_order);

create table public.form_service_links (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.form_versions (id) on delete restrict,
  form_version_field_id uuid,
  service_id uuid not null references public.services (id) on delete restrict,
  role text not null,
  sort_order integer not null default 0,
  configuration jsonb not null default '{}'::jsonb,
  service_name_snapshot text not null,
  service_currency_snapshot text not null,
  service_price_cents_snapshot bigint not null,
  created_at timestamptz not null default now(),
  constraint form_service_links_field_version_fkey
    foreign key (form_version_field_id, form_version_id)
    references public.form_version_fields (id, form_version_id) on delete restrict,
  constraint form_service_links_identity_unique unique (form_version_id, form_version_field_id, service_id, role),
  constraint form_service_links_role_valid check (role in ('offered_item', 'default_item', 'intake_assignment')),
  constraint form_service_links_sort_nonnegative check (sort_order >= 0),
  constraint form_service_links_configuration_object check (jsonb_typeof(configuration) = 'object'),
  constraint form_service_links_snapshot_name_not_blank check (btrim(service_name_snapshot) <> ''),
  constraint form_service_links_snapshot_currency_valid check (service_currency_snapshot ~ '^[A-Z]{3}$'),
  constraint form_service_links_snapshot_price_nonnegative check (service_price_cents_snapshot >= 0)
);

create index form_service_links_version_sort_idx on public.form_service_links (form_version_id, sort_order);
create index form_service_links_service_idx on public.form_service_links (service_id);

create table public.form_assignments (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete restrict,
  form_version_id uuid not null,
  company_id uuid not null references public.companies (id) on delete restrict,
  client_profile_id uuid references public.profiles (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  status text not null default 'assigned',
  required boolean not null default true,
  due_at timestamptz,
  assigned_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  canceled_at timestamptz,
  archived_at timestamptz,
  latest_submission_id uuid,
  constraint form_assignments_version_form_fkey
    foreign key (form_version_id, form_id)
    references public.form_versions (id, form_id) on delete restrict,
  constraint form_assignments_status_valid check (status in ('assigned', 'completed', 'canceled', 'archived')),
  constraint form_assignments_context_exactly_one check (
    (order_id is not null and client_profile_id is null)
    or (order_id is null and client_profile_id is not null)
  ),
  constraint form_assignments_lifecycle_consistent check (
    (status = 'assigned' and completed_at is null and canceled_at is null and archived_at is null)
    or (status = 'completed' and completed_at is not null and canceled_at is null and archived_at is null)
    or (status = 'canceled' and canceled_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create unique index form_assignments_active_order_idx
on public.form_assignments (form_id, order_id)
where order_id is not null and status = 'assigned';
create unique index form_assignments_active_client_idx
on public.form_assignments (form_id, client_profile_id)
where client_profile_id is not null and status = 'assigned';
create index form_assignments_company_status_idx on public.form_assignments (company_id, status, assigned_at desc);
create index form_assignments_version_idx on public.form_assignments (form_version_id);

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete restrict,
  form_version_id uuid not null,
  form_assignment_id uuid references public.form_assignments (id) on delete restrict,
  company_id uuid references public.companies (id) on delete restrict,
  client_profile_id uuid references public.profiles (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  root_submission_id uuid not null,
  supersedes_submission_id uuid references public.form_submissions (id) on delete restrict,
  revision_number integer not null default 1,
  status text not null default 'submitted',
  orchestration_type text,
  orchestration_status text not null default 'not_required',
  submitted_by_profile_id uuid references public.profiles (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  provenance jsonb not null default '{}'::jsonb,
  constraint form_submissions_version_form_fkey
    foreign key (form_version_id, form_id)
    references public.form_versions (id, form_id) on delete restrict,
  constraint form_submissions_root_fkey
    foreign key (root_submission_id)
    references public.form_submissions (id) on delete restrict
    deferrable initially deferred,
  constraint form_submissions_root_revision_unique unique (root_submission_id, revision_number),
  constraint form_submissions_supersedes_unique unique (supersedes_submission_id),
  constraint form_submissions_revision_positive check (revision_number > 0),
  constraint form_submissions_status_valid check (status in ('submitted', 'void')),
  constraint form_submissions_orchestration_type_valid check (
    orchestration_type is null or orchestration_type in ('order_checkout', 'contact_ticket')
  ),
  constraint form_submissions_orchestration_status_valid check (
    orchestration_status in ('not_required', 'deferred', 'completed', 'failed')
  ),
  constraint form_submissions_orchestration_consistent check (
    (orchestration_type is null and orchestration_status = 'not_required')
    or (orchestration_type is not null and orchestration_status <> 'not_required')
  ),
  constraint form_submissions_provenance_object check (jsonb_typeof(provenance) = 'object')
);

alter table public.form_assignments
  add constraint form_assignments_latest_submission_fkey
  foreign key (latest_submission_id) references public.form_submissions (id) on delete restrict;

create index form_submissions_form_version_idx on public.form_submissions (form_id, form_version_id, submitted_at desc);
create index form_submissions_company_idx on public.form_submissions (company_id, submitted_at desc) where company_id is not null;
create index form_submissions_assignment_idx on public.form_submissions (form_assignment_id, submitted_at desc) where form_assignment_id is not null;
create index form_submissions_order_idx on public.form_submissions (order_id, submitted_at desc) where order_id is not null;

create table public.form_submission_values (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions (id) on delete restrict,
  form_version_field_id uuid not null references public.form_version_fields (id) on delete restrict,
  stable_field_key uuid not null,
  field_label_snapshot text not null,
  field_type_snapshot text not null,
  sort_order_snapshot integer not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  constraint form_submission_values_submission_field_unique unique (submission_id, stable_field_key),
  constraint form_submission_values_label_not_blank check (btrim(field_label_snapshot) <> ''),
  constraint form_submission_values_sort_nonnegative check (sort_order_snapshot >= 0)
);

create index form_submission_values_submission_sort_idx
on public.form_submission_values (submission_id, sort_order_snapshot);
create index form_submission_values_field_idx on public.form_submission_values (form_version_field_id);

create table public.form_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions (id) on delete restrict,
  form_version_field_id uuid not null references public.form_version_fields (id) on delete restrict,
  stable_field_key uuid not null,
  storage_object_key text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum_sha256 text not null,
  scan_status text not null default 'pending',
  uploaded_by_profile_id uuid references public.profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  constraint form_files_object_key_unique unique (storage_object_key),
  constraint form_files_submission_field_object_unique unique (submission_id, stable_field_key, storage_object_key),
  constraint form_files_names_not_blank check (btrim(storage_object_key) <> '' and btrim(original_name) <> '' and btrim(mime_type) <> ''),
  constraint form_files_size_valid check (size_bytes > 0),
  constraint form_files_checksum_valid check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  constraint form_files_scan_status_valid check (scan_status in ('pending', 'clean', 'rejected'))
);

create index form_files_submission_idx on public.form_files (submission_id);
create index form_files_field_idx on public.form_files (form_version_field_id);

create table private.form_submission_requests (
  operation text not null,
  request_id uuid not null,
  actor_profile_id uuid,
  payload jsonb not null,
  submission_id uuid not null references public.form_submissions (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (operation, request_id),
  constraint form_submission_requests_operation_not_blank check (btrim(operation) <> ''),
  constraint form_submission_requests_payload_object check (jsonb_typeof(payload) = 'object')
);

revoke all on table private.form_submission_requests from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Immutability
-- -----------------------------------------------------------------------------

create function private.prevent_form_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Forms must be archived, not deleted' using errcode = '55000';
end;
$$;

create trigger forms_prevent_delete
before delete on public.forms
for each row execute function private.prevent_form_delete();

create function private.protect_published_form_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_state = 'published' then
    raise exception 'published Form versions are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger form_versions_protect_published
before update or delete on public.form_versions
for each row execute function private.protect_published_form_version();

create function private.protect_form_version_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_version_id uuid;
  new_version_id uuid;
begin
  if tg_table_name in ('form_version_fields', 'form_rules', 'form_service_links') then
    old_version_id := case when tg_op = 'INSERT' then null else old.form_version_id end;
    new_version_id := case when tg_op = 'DELETE' then null else new.form_version_id end;
  elsif tg_table_name = 'form_field_options' then
    if tg_op <> 'INSERT' then
      select field.form_version_id into old_version_id
      from public.form_version_fields as field where field.id = old.form_version_field_id;
    end if;
    if tg_op <> 'DELETE' then
      select field.form_version_id into new_version_id
      from public.form_version_fields as field where field.id = new.form_version_field_id;
    end if;
  end if;

  if exists (
    select 1 from public.form_versions as version
    where version.id in (old_version_id, new_version_id)
      and version.lifecycle_state = 'published'
  ) then
    raise exception 'published Form definition children are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger form_version_fields_protect_published
before insert or update or delete on public.form_version_fields
for each row execute function private.protect_form_version_child();
create trigger form_field_options_protect_published
before insert or update or delete on public.form_field_options
for each row execute function private.protect_form_version_child();
create trigger form_rules_protect_published
before insert or update or delete on public.form_rules
for each row execute function private.protect_form_version_child();
create trigger form_service_links_protect_published
before insert or update or delete on public.form_service_links
for each row execute function private.protect_form_version_child();

create function private.prevent_form_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Form submission history is append-only' using errcode = '55000';
end;
$$;

create trigger form_submissions_prevent_mutation
before update or delete on public.form_submissions
for each row execute function private.prevent_form_history_mutation();
create trigger form_submission_values_prevent_mutation
before update or delete on public.form_submission_values
for each row execute function private.prevent_form_history_mutation();
create trigger form_files_prevent_mutation
before update or delete on public.form_files
for each row execute function private.prevent_form_history_mutation();
create trigger form_submissions_prevent_truncate before truncate on public.form_submissions for each statement execute function private.prevent_form_history_mutation();
create trigger form_submission_values_prevent_truncate before truncate on public.form_submission_values for each statement execute function private.prevent_form_history_mutation();
create trigger form_files_prevent_truncate before truncate on public.form_files for each statement execute function private.prevent_form_history_mutation();

-- -----------------------------------------------------------------------------
-- Draft definition and publication helpers
-- -----------------------------------------------------------------------------

create function private.validate_form_type_config(
  p_form_type text,
  p_config jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized jsonb := coalesce(p_config, '{}'::jsonb);
begin
  if jsonb_typeof(normalized) <> 'object' then
    raise exception 'Form type configuration must be an object' using errcode = '22023';
  end if;

  if p_form_type = 'order' then
    if normalized - array['coupon_enabled', 'payment_methods', 'checkout_orchestration'] <> '{}'::jsonb then
      raise exception 'invalid Order Form configuration' using errcode = '22023';
    end if;
    normalized := normalized || jsonb_build_object('checkout_orchestration', 'deferred');
  elsif p_form_type = 'contact' then
    if normalized - array['subject_field_key', 'message_field_key', 'redirect_url', 'ticket_orchestration'] <> '{}'::jsonb then
      raise exception 'invalid Contact Form configuration' using errcode = '22023';
    end if;
    normalized := normalized || jsonb_build_object('ticket_orchestration', 'deferred');
  elsif p_form_type = 'intake' then
    if normalized - array['completion_status'] <> '{}'::jsonb then
      raise exception 'invalid Intake Form configuration' using errcode = '22023';
    end if;
  elsif p_form_type = 'onboarding' then
    if normalized - array['reuse_policy'] <> '{}'::jsonb then
      raise exception 'invalid Onboarding Form configuration' using errcode = '22023';
    end if;
  else
    raise exception 'invalid Form type' using errcode = '22023';
  end if;

  return normalized;
end;
$$;

create function private.replace_form_draft(
  p_form_id uuid,
  p_form_version_id uuid,
  p_definition jsonb,
  p_actor_id uuid
)
returns public.form_versions
language plpgsql
security definer
set search_path = ''
as $$
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
  where form.id = p_form_id and form.archived_at is null
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
        and service.archived_at is null;
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
      and service.archived_at is null;
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
$$;

create function private.validate_form_version(p_form_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
      and field.field_type in ('password', 'secret', 'file', 'captcha', 'payment', 'hidden', 'break', 'pagebreak', 'html')
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
$$;

-- -----------------------------------------------------------------------------
-- Administrative mutation RPCs
-- -----------------------------------------------------------------------------

create function public.app_create_form(p_request_id uuid, p_payload jsonb)
returns public.forms
language plpgsql
security definer
set search_path = ''
as $$
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
    select * into form_row from public.forms where id = existing_id;
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
$$;

create function public.app_update_form_draft(
  p_request_id uuid,
  p_form_id uuid,
  p_definition jsonb
)
returns public.form_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_form_capability('forms.manage');
  existing_id uuid;
  form_row public.forms;
  version_row public.form_versions;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id, 'definition', p_definition);
begin
  existing_id := private.find_create_request(actor_id, 'form.draft.update', p_request_id, request_payload);
  if existing_id is not null then
    select * into version_row from public.form_versions where id = existing_id;
    if version_row.id is null then raise no_data_found; end if;
    return version_row;
  end if;
  select * into form_row from public.forms where id = p_form_id and archived_at is null for update;
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
$$;

create function public.app_publish_form(p_request_id uuid, p_form_id uuid)
returns public.form_versions
language plpgsql
security definer
set search_path = ''
as $$
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
    select * into published_row from public.form_versions where id = existing_id;
    if published_row.id is null then raise no_data_found; end if;
    return published_row;
  end if;

  select * into form_row from public.forms where id = p_form_id and archived_at is null for update;
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
$$;

create function public.app_archive_form(p_request_id uuid, p_form_id uuid)
returns public.forms
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_form_capability('forms.manage');
  existing_id uuid;
  form_row public.forms;
  request_payload jsonb := jsonb_build_object('form_id', p_form_id);
begin
  existing_id := private.find_create_request(actor_id, 'form.archive', p_request_id, request_payload);
  if existing_id is not null then
    select * into form_row from public.forms where id = existing_id;
    return form_row;
  end if;
  update public.forms
  set status = 'archived', archived_at = now(), updated_by_profile_id = actor_id
  where id = p_form_id and archived_at is null
  returning * into form_row;
  if form_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'form', form_row.id, 'form.archived', format('Archived Form %s.', form_row.name)
  );
  perform private.remember_create_request(actor_id, 'form.archive', p_request_id, request_payload, form_row.id);
  return form_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assignments
-- -----------------------------------------------------------------------------

create function public.app_assign_form(
  p_request_id uuid,
  p_form_id uuid,
  p_context jsonb
)
returns public.form_assignments
language plpgsql
security definer
set search_path = ''
as $$
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
    select * into assignment_row from public.form_assignments where id = existing_id;
    if assignment_row.id is null then raise no_data_found; end if;
    return assignment_row;
  end if;

  select * into form_row
  from public.forms
  where id = p_form_id and status = 'published' and archived_at is null
  for update;
  if form_row.id is null then raise no_data_found; end if;

  if form_row.form_type = 'intake' then
    if not p_context ? 'order_id' or p_context ? 'client_profile_id' then
      raise exception 'Intake assignment requires an Order' using errcode = '22023';
    end if;
    select * into order_row from public.orders
    where id = (p_context ->> 'order_id')::uuid and archived_at is null
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
    join public.roles as role on role.id = profile.role_id and role.name = 'client'
    join public.companies as company on company.id = profile.company_id and company.archived_at is null
    where profile.id = (p_context ->> 'client_profile_id')::uuid
      and profile.archived_at is null;
    if client_row.id is null or client_row.company_id is null then raise no_data_found; end if;
    company_id_value := client_row.company_id;
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
$$;

-- -----------------------------------------------------------------------------
-- Submission validation and idempotency
-- -----------------------------------------------------------------------------

create function private.find_form_submission_request(
  p_operation text,
  p_request_id uuid,
  p_actor_profile_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_request private.form_submission_requests;
begin
  if p_request_id is null then raise exception 'Form request ID is required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation || ':' || p_request_id::text, 0)
  );
  select * into prior_request
  from private.form_submission_requests
  where operation = p_operation and request_id = p_request_id;
  if prior_request.submission_id is not null
    and (prior_request.actor_profile_id is distinct from p_actor_profile_id or prior_request.payload <> p_payload)
  then
    raise exception 'Form request ID was already used with different input' using errcode = '23505';
  end if;
  return prior_request.submission_id;
end;
$$;

create function private.remember_form_submission_request(
  p_operation text,
  p_request_id uuid,
  p_actor_profile_id uuid,
  p_payload jsonb,
  p_submission_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.form_submission_requests (
    operation, request_id, actor_profile_id, payload, submission_id
  ) values (
    p_operation, p_request_id, p_actor_profile_id, p_payload, p_submission_id
  );
$$;

create function private.form_rule_matches(p_rule_id uuid, p_values jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(
    case condition ->> 'comparator'
      when 'equals' then actual.value = condition -> 'value'
      when 'not_equals' then actual.value is distinct from condition -> 'value'
      when 'checked' then actual.value = 'true'::jsonb
      when 'not_checked' then coalesce(actual.value, 'false'::jsonb) <> 'true'::jsonb
      else false
    end
  ), false)
  from public.form_rules as rule
  cross join lateral jsonb_array_elements(rule.conditions) as condition
  left join lateral (
    select submitted -> 'value' as value
    from jsonb_array_elements(p_values) as submitted
    where submitted ->> 'field_key' = condition ->> 'field_key'
    limit 1
  ) as actual on true
  where rule.id = p_rule_id;
$$;

create function private.form_field_is_visible(
  p_form_version_id uuid,
  p_stable_field_key uuid,
  p_values jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with targeting as (
    select rule.id, rule.action, private.form_rule_matches(rule.id, p_values) as matches
    from public.form_rules as rule
    where rule.form_version_id = p_form_version_id
      and rule.target_field_keys ? p_stable_field_key::text
  )
  select
    (not exists (select 1 from targeting where action = 'show')
      or exists (select 1 from targeting where action = 'show' and matches))
    and not exists (select 1 from targeting where action = 'hide' and matches);
$$;

create function private.form_value_is_present(p_value jsonb, p_field_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then false
    when p_field_type in ('checkbox', 'optin') then p_value = 'true'::jsonb
    when jsonb_typeof(p_value) = 'string' then btrim(trim(both '"' from p_value::text)) <> ''
    when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) > 0
    when jsonb_typeof(p_value) = 'object' then p_value <> '{}'::jsonb
    else true
  end;
$$;

create function private.validate_form_submission_values(
  p_form_version_id uuid,
  p_values jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitted_value jsonb;
  field_row public.form_version_fields;
  submitted_key uuid;
  answer jsonb;
  selected_value jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'array' then
    raise exception 'Form values must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_values) as item
    group by item ->> 'field_key'
    having count(*) > 1
  ) then
    raise exception 'duplicate Form field value' using errcode = '22023';
  end if;

  for submitted_value in select value from jsonb_array_elements(p_values) loop
    if jsonb_typeof(submitted_value) <> 'object'
      or submitted_value - array['field_key', 'value'] <> '{}'::jsonb
      or not submitted_value ?& array['field_key', 'value']
    then
      raise exception 'invalid Form field value' using errcode = '22023';
    end if;
    submitted_key := (submitted_value ->> 'field_key')::uuid;
    answer := submitted_value -> 'value';
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = p_form_version_id
      and field.stable_field_key = submitted_key;
    if field_row.id is null then raise exception 'unknown Form field' using errcode = '22023'; end if;
    if not private.form_field_is_visible(p_form_version_id, submitted_key, p_values) then
      raise exception 'hidden Form fields cannot be submitted' using errcode = '22023';
    end if;
    if field_row.field_type in ('password', 'secret') then
      raise exception 'credential-like Form values require a dedicated encrypted storage boundary' using errcode = '55000';
    end if;
    if field_row.field_type in ('file', 'captcha') then
      raise exception 'Form field integration is deferred' using errcode = '55000';
    end if;
    if field_row.field_type in ('payment', 'hidden', 'break', 'pagebreak', 'html') then
      raise exception 'non-answer Form fields cannot be submitted' using errcode = '22023';
    end if;
    if field_row.field_type in ('checkbox', 'optin') and jsonb_typeof(answer) <> 'boolean' then
      raise exception 'Form checkbox value must be boolean' using errcode = '22023';
    end if;
    if field_row.field_type = 'email'
      and (jsonb_typeof(answer) <> 'string' or trim(both '"' from answer::text) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    then
      raise exception 'invalid Form email value' using errcode = '22023';
    end if;
    if field_row.field_type = 'date'
      and (jsonb_typeof(answer) <> 'string' or trim(both '"' from answer::text) !~ '^\d{4}-\d{2}-\d{2}$')
    then
      raise exception 'invalid Form date value' using errcode = '22023';
    end if;
    if field_row.field_type in ('data-option-group', 'data-dropdown') then
      if jsonb_typeof(answer) <> 'string' or not exists (
        select 1 from public.form_field_options as option
        where option.form_version_field_id = field_row.id
          and option.stable_option_key = trim(both '"' from answer::text)::uuid
      ) then
        raise exception 'invalid Form option ID' using errcode = '22023';
      end if;
    end if;
    if field_row.field_type in ('optgroup', 'dropdown') then
      if jsonb_typeof(answer) = 'array' then
        for selected_value in select value from jsonb_array_elements(answer) loop
          if not exists (
            select 1 from public.form_service_links as link
            where link.form_version_field_id = field_row.id
              and link.service_id = trim(both '"' from selected_value::text)::uuid
          ) then raise exception 'invalid Form Service option ID' using errcode = '22023'; end if;
        end loop;
      elsif jsonb_typeof(answer) = 'string' then
        if not exists (
          select 1 from public.form_service_links as link
          where link.form_version_field_id = field_row.id
            and link.service_id = trim(both '"' from answer::text)::uuid
        ) then raise exception 'invalid Form Service option ID' using errcode = '22023'; end if;
      else
        raise exception 'invalid Form Service selection' using errcode = '22023';
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from public.form_version_fields as field
    where field.form_version_id = p_form_version_id
      and field.required
      and private.form_field_is_visible(p_form_version_id, field.stable_field_key, p_values)
      and not exists (
        select 1 from jsonb_array_elements(p_values) as submitted
        where submitted ->> 'field_key' = field.stable_field_key::text
          and private.form_value_is_present(submitted -> 'value', field.field_type)
      )
  ) then
    raise exception 'required Form field is missing' using errcode = '23514';
  end if;
end;
$$;

create function private.record_form_activity(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  actor_id uuid := (select auth.uid());
begin
  insert into public.activity_events (
    actor_profile_id, entity_type, entity_id, action, summary, metadata
  ) values (
    actor_id, p_entity_type, p_entity_id, p_action, p_summary, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into event_id;
  return event_id;
end;
$$;

create function public.app_submit_form(
  p_request_id uuid,
  p_form_version_id uuid,
  p_context jsonb,
  p_values jsonb,
  p_files jsonb default '[]'::jsonb
)
returns public.form_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  actor_role text;
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
  request_payload jsonb := jsonb_build_object(
    'form_version_id', p_form_version_id,
    'context', coalesce(p_context, '{}'::jsonb),
    'values', p_values,
    'files', coalesce(p_files, '[]'::jsonb)
  );
begin
  if p_context is null or jsonb_typeof(p_context) <> 'object'
    or p_context - array['assignment_id', 'order_id', 'company_id', 'client_profile_id'] <> '{}'::jsonb
    or jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid Form submission context' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 0 then
    raise exception 'Form file upload storage boundary is not available' using errcode = '55000';
  end if;

  existing_id := private.find_form_submission_request(
    'form.submit', p_request_id, actor_id, request_payload
  );
  if existing_id is not null then
    select * into submission_row from public.form_submissions where id = existing_id;
    if submission_row.id is null then raise no_data_found; end if;
    return submission_row;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = p_form_version_id and version.lifecycle_state = 'published'
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
    raise exception 'Form version is unavailable for submission' using errcode = '55000';
  end if;

  if actor_id is not null then
    select profile.* into actor_profile
    from public.profiles as profile
    where profile.id = actor_id and profile.archived_at is null;
    if actor_profile.id is null then raise exception 'active Form submitter is required' using errcode = '42501'; end if;
    select role.name into actor_role from public.roles as role where role.id = actor_profile.role_id;
  end if;

  if form_row.visibility = 'public' then
    if form_row.form_type not in ('order', 'contact') then
      raise exception 'assigned Form cannot be public' using errcode = '42501';
    end if;
  elsif form_row.visibility = 'authenticated' then
    if actor_id is null then raise exception 'Form authentication is required' using errcode = '42501'; end if;
  elsif form_row.visibility = 'assigned' then
    if actor_id is null or not p_context ? 'assignment_id' then
      raise exception 'Form assignment is required' using errcode = '42501';
    end if;
  end if;

  if form_row.form_type in ('intake', 'onboarding') then
    select assignment.* into assignment_row
    from public.form_assignments as assignment
    where assignment.id = (p_context ->> 'assignment_id')::uuid
      and assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
    for update;
    if assignment_row.id is null then raise exception 'active Form assignment is required' using errcode = '42501'; end if;
    if actor_role = 'client' and actor_profile.company_id <> assignment_row.company_id then
      raise exception 'Form assignment company access is denied' using errcode = '42501';
    end if;
    if actor_role <> 'client' and not private.current_user_has_permission('forms.submissions_manage') then
      raise exception 'permission denied: forms.submissions_manage' using errcode = '42501';
    end if;
    company_id_value := assignment_row.company_id;
    client_profile_id_value := assignment_row.client_profile_id;
    order_id_value := assignment_row.order_id;
  else
    if actor_role = 'client' then
      company_id_value := actor_profile.company_id;
      client_profile_id_value := actor_profile.id;
    elsif actor_id is not null and not private.current_user_has_permission('forms.submissions_manage') then
      raise exception 'permission denied: forms.submissions_manage' using errcode = '42501';
    end if;
  end if;

  if p_context ? 'company_id' and (p_context ->> 'company_id')::uuid is distinct from company_id_value then
    raise exception 'Form company context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'client_profile_id' and (p_context ->> 'client_profile_id')::uuid is distinct from client_profile_id_value then
    raise exception 'Form client context cannot be spoofed' using errcode = '42501';
  end if;
  if p_context ? 'order_id' and (p_context ->> 'order_id')::uuid is distinct from order_id_value then
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
    id, form_id, form_version_id, form_assignment_id, company_id,
    client_profile_id, order_id, root_submission_id, revision_number,
    orchestration_type, orchestration_status, submitted_by_profile_id, provenance
  ) values (
    submission_row.id, form_row.id, version_row.id, assignment_row.id,
    company_id_value, client_profile_id_value, order_id_value,
    submission_row.id, 1, orchestration_type_value, orchestration_status_value,
    actor_id,
    jsonb_build_object(
      'form_type', form_row.form_type,
      'schema_hash', version_row.schema_hash,
      'type_config', version_row.type_config,
      'orchestration_deferred', orchestration_status_value = 'deferred'
    )
  ) returning * into submission_row;

  for submitted_value in select value from jsonb_array_elements(p_values) loop
    select field.* into field_row
    from public.form_version_fields as field
    where field.form_version_id = version_row.id
      and field.stable_field_key = (submitted_value ->> 'field_key')::uuid;
    insert into public.form_submission_values (
      submission_id, form_version_field_id, stable_field_key,
      field_label_snapshot, field_type_snapshot, sort_order_snapshot, value
    ) values (
      submission_row.id, field_row.id, field_row.stable_field_key,
      field_row.label, field_row.field_type, field_row.sort_order,
      submitted_value -> 'value'
    );
  end loop;

  if assignment_row.id is not null then
    update public.form_assignments
    set status = 'completed', completed_at = now(), latest_submission_id = submission_row.id
    where id = assignment_row.id;
  end if;

  perform private.record_form_activity(
    'form_submission', submission_row.id, 'form.submitted',
    format('Submitted %s Form.', initcap(form_row.form_type)),
    jsonb_build_object('form_id', form_row.id, 'form_version_id', version_row.id, 'assignment_id', assignment_row.id, 'company_id', company_id_value, 'order_id', order_id_value)
  );
  perform private.remember_form_submission_request(
    'form.submit', p_request_id, actor_id, request_payload, submission_row.id
  );
  return submission_row;
end;
$$;

create function public.app_correct_form_submission(
  p_request_id uuid,
  p_submission_id uuid,
  p_values jsonb
)
returns public.form_submissions
language plpgsql
security definer
set search_path = ''
as $$
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
    select * into corrected_row from public.form_submissions where id = existing_id;
    if corrected_row.id is null then raise no_data_found; end if;
    return corrected_row;
  end if;
  select * into original_row from public.form_submissions where id = p_submission_id for share;
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
$$;

-- -----------------------------------------------------------------------------
-- Safe read models
-- -----------------------------------------------------------------------------

create function public.app_get_published_form_schema(p_canonical_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  form_row public.forms;
  version_row public.form_versions;
  result jsonb;
begin
  select form.* into form_row
  from public.forms as form
  where form.canonical_key = lower(p_canonical_key)
    and form.status = 'published'
    and form.archived_at is null;
  if form_row.id is null then raise no_data_found; end if;
  select * into version_row from public.form_versions where id = form_row.published_version_id;

  if form_row.visibility = 'public' then
    null;
  elsif form_row.visibility = 'authenticated' then
    if actor_id is null or not exists (
      select 1 from public.profiles where id = actor_id and archived_at is null
    ) then raise exception 'Form authentication is required' using errcode = '42501'; end if;
  elsif not exists (
    select 1
    from public.form_assignments as assignment
    join public.profiles as profile on profile.id = actor_id
    where assignment.form_id = form_row.id
      and assignment.form_version_id = version_row.id
      and assignment.status = 'assigned'
      and assignment.company_id = profile.company_id
      and profile.archived_at is null
  ) and not (
    (select private.is_internal_user()) and private.current_user_has_permission('forms.view')
  ) then
    raise exception 'Form assignment access is denied' using errcode = '42501';
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
        'options', coalesce((select jsonb_agg(jsonb_build_object(
          'option_id', option.stable_option_key,
          'value', option.option_value,
          'label', option.label,
          'sort_order', option.sort_order,
          'metadata', option.metadata
        ) order by option.sort_order) from public.form_field_options as option where option.form_version_field_id = field.id), '[]'::jsonb),
        'services', coalesce((select jsonb_agg(jsonb_build_object(
          'service_id', link.service_id,
          'role', link.role,
          'sort_order', link.sort_order,
          'configuration', link.configuration,
          'name', link.service_name_snapshot,
          'currency', link.service_currency_snapshot,
          'price_cents', link.service_price_cents_snapshot
        ) order by link.sort_order) from public.form_service_links as link where link.form_version_field_id = field.id), '[]'::jsonb)
      ) order by field.sort_order)
      from public.form_version_fields as field where field.form_version_id = version_row.id
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rule_key', rule.rule_key,
        'sort_order', rule.sort_order,
        'conditions', rule.conditions,
        'action', rule.action,
        'target_field_keys', rule.target_field_keys
      ) order by rule.sort_order)
      from public.form_rules as rule where rule.form_version_id = version_row.id
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.app_get_form_submission(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  submission_row public.form_submissions;
  actor_profile public.profiles;
  result jsonb;
begin
  select * into submission_row from public.form_submissions where id = p_submission_id;
  if submission_row.id is null then raise no_data_found; end if;
  select * into actor_profile from public.profiles
  where id = (select auth.uid()) and archived_at is null;
  if actor_profile.id is null then raise exception 'Form submission access is denied' using errcode = '42501'; end if;
  if not (
    ((select private.is_internal_user()) and private.current_user_has_permission('forms.submissions_view'))
    or (actor_profile.company_id is not null and actor_profile.company_id = submission_row.company_id)
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
    ) order by value.sort_order_snapshot) filter (where value.id is not null and value.field_type_snapshot <> 'secret'), '[]'::jsonb)
  ) into result
  from public.form_submission_values as value
  where value.submission_id = submission_row.id;
  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Activity integration, RLS, and privileges
-- -----------------------------------------------------------------------------

alter table public.activity_events drop constraint activity_events_entity_type_valid;
alter table public.activity_events add constraint activity_events_entity_type_valid check (
  entity_type in (
    'company', 'client_contact', 'service_folder', 'service', 'order',
    'order_task', 'profile', 'coupon', 'invoice', 'subscription',
    'form', 'form_assignment', 'form_submission'
  )
);

alter table public.forms enable row level security;
alter table public.form_versions enable row level security;
alter table public.form_version_fields enable row level security;
alter table public.form_field_options enable row level security;
alter table public.form_rules enable row level security;
alter table public.form_service_links enable row level security;
alter table public.form_assignments enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_submission_values enable row level security;
alter table public.form_files enable row level security;

create policy forms_internal_select on public.forms for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));
create policy form_versions_internal_select on public.form_versions for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));
create policy form_version_fields_internal_select on public.form_version_fields for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));
create policy form_field_options_internal_select on public.form_field_options for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));
create policy form_rules_internal_select on public.form_rules for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));
create policy form_service_links_internal_select on public.form_service_links for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.view'));

create policy form_assignments_authorized_select on public.form_assignments for select to authenticated
using (
  ((select private.is_internal_user()) and (
    public.app_has_permission('forms.assign')
    or public.app_has_permission('forms.submissions_view')
  ))
  or (
    (select private.is_client_user())
    and company_id = (select private.current_user_company_id())
  )
);
create policy form_submissions_authorized_select on public.form_submissions for select to authenticated
using (
  ((select private.is_internal_user()) and public.app_has_permission('forms.submissions_view'))
  or (
    (select private.is_client_user())
    and company_id = (select private.current_user_company_id())
  )
);
create policy form_submission_values_internal_select on public.form_submission_values for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.submissions_view'));
create policy form_files_internal_select on public.form_files for select to authenticated
using ((select private.is_internal_user()) and public.app_has_permission('forms.submissions_view'));

revoke all on table
  public.forms, public.form_versions, public.form_version_fields,
  public.form_field_options, public.form_rules, public.form_service_links,
  public.form_assignments, public.form_submissions,
  public.form_submission_values, public.form_files
from public, anon, authenticated, service_role;

grant select on table
  public.forms, public.form_versions, public.form_version_fields,
  public.form_field_options, public.form_rules, public.form_service_links,
  public.form_assignments, public.form_submissions,
  public.form_submission_values, public.form_files
to authenticated, service_role;

revoke all on function private.form_html_is_safe(text) from public, anon, authenticated, service_role;
revoke all on function private.require_form_capability(text) from public, anon, authenticated, service_role;
revoke all on function private.prevent_form_delete() from public, anon, authenticated, service_role;
revoke all on function private.protect_published_form_version() from public, anon, authenticated, service_role;
revoke all on function private.protect_form_version_child() from public, anon, authenticated, service_role;
revoke all on function private.prevent_form_history_mutation() from public, anon, authenticated, service_role;
revoke all on function private.validate_form_type_config(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.replace_form_draft(uuid,uuid,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function private.validate_form_version(uuid) from public, anon, authenticated, service_role;
revoke all on function private.find_form_submission_request(text,uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.remember_form_submission_request(text,uuid,uuid,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function private.form_rule_matches(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.form_field_is_visible(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.form_value_is_present(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.validate_form_submission_values(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.record_form_activity(text,uuid,text,text,jsonb) from public, anon, authenticated, service_role;

revoke all on function public.app_create_form(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_update_form_draft(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_publish_form(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_archive_form(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.app_assign_form(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_correct_form_submission(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.app_get_published_form_schema(text) from public, anon, authenticated, service_role;
revoke all on function public.app_get_form_submission(uuid) from public, anon, authenticated, service_role;

grant execute on function public.app_create_form(uuid,jsonb) to authenticated;
grant execute on function public.app_update_form_draft(uuid,uuid,jsonb) to authenticated;
grant execute on function public.app_publish_form(uuid,uuid) to authenticated;
grant execute on function public.app_archive_form(uuid,uuid) to authenticated;
grant execute on function public.app_assign_form(uuid,uuid,jsonb) to authenticated;
grant execute on function public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb) to anon, authenticated;
grant execute on function public.app_correct_form_submission(uuid,uuid,jsonb) to authenticated;
grant execute on function public.app_get_published_form_schema(text) to anon, authenticated;
grant execute on function public.app_get_form_submission(uuid) to authenticated;

comment on table public.forms is 'Reusable Form identity and lifecycle shared by order, contact, intake, and onboarding types.';
comment on table public.form_versions is 'Draft and immutable published Form definition snapshots with monotonic per-Form version numbers.';
comment on table public.form_submissions is 'Append-only submissions tied to an exact immutable Form version; Invoice/payment and Ticket state are not duplicated.';
comment on table public.form_files is 'Protected file reference metadata only. Binary upload execution remains deferred until a trusted Storage boundary exists.';
comment on function public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb) is 'Atomic idempotent Form submit boundary with server-side schema, rule, option, assignment, and company validation.';
