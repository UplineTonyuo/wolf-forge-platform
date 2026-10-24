create table private.intake_drafts (
  assignment_id uuid primary key references public.form_assignments(id),
  profile_id uuid not null references public.profiles(id),
  form_version_id uuid not null references public.form_versions(id),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table private.intake_drafts enable row level security;
revoke all on private.intake_drafts from public, anon, authenticated, service_role;

create function private.require_intake_recipient(p_assignment_id uuid)
returns public.form_assignments language plpgsql security definer set search_path = '' as $function$
declare assignment public.form_assignments; tenant uuid;
begin
  perform private.require_permission('forms.view');
  select a.* into assignment
  from public.form_assignments a join public.forms f on f.id = a.form_id
  where a.id = p_assignment_id and a.archived_at is null and a.status = 'assigned'
    and f.archived_at is null and f.status = 'published' and f.published_version_id = a.form_version_id
    and f.form_type in ('intake', 'onboarding') and f.tenant_id = private.current_tenant_id();
  if assignment.id is null or private.current_account_class() is distinct from 'client'
    or assignment.client_profile_id is distinct from auth.uid()
    or assignment.company_id is distinct from private.current_user_company_id() then
    raise exception 'Form assignment access is denied' using errcode = '42501'; end if;
  tenant := private.current_tenant_id();
  perform private.require_forms_write(tenant);
  return assignment;
end;
$function$;
revoke all on function private.require_intake_recipient(uuid) from public, anon, authenticated, service_role;

create function public.app_save_intake_draft(p_assignment_id uuid, p_values jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $function$
declare assignment public.form_assignments := private.require_intake_recipient(p_assignment_id); saved timestamptz;
begin
  perform private.enforce_form_payload_limits(p_values);
  if exists(select 1 from jsonb_array_elements(p_values) as answer
    left join public.form_version_fields as field on field.form_version_id = assignment.form_version_id
      and field.stable_field_key::text = answer->>'field_key'
    where field.id is null or field.field_type in ('password','secret','hidden','html','captcha','payment','break','pagebreak')
      or answer - array['field_key','value'] <> '{}'::jsonb or not answer ?& array['field_key','value'])
    or exists(select 1 from jsonb_array_elements(p_values) as answer group by answer->>'field_key' having count(*) > 1) then
    raise exception 'invalid draft answers' using errcode = '22023'; end if;
  insert into private.intake_drafts(assignment_id, profile_id, form_version_id, answers)
    values(p_assignment_id, auth.uid(), assignment.form_version_id, p_values)
  on conflict (assignment_id) do update set answers = excluded.answers, updated_at = now(), expires_at = now() + interval '30 days'
  returning updated_at into saved;
  return saved;
end;
$function$;

create function public.app_get_intake_draft(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare assignment public.form_assignments := private.require_intake_recipient(p_assignment_id); result jsonb;
begin
  select jsonb_build_object('values', answers, 'updated_at', updated_at, 'expires_at', expires_at) into result
  from private.intake_drafts where assignment_id = assignment.id and profile_id = auth.uid()
    and form_version_id = assignment.form_version_id and expires_at > now();
  return result;
end;
$function$;
revoke all on function public.app_save_intake_draft(uuid,jsonb), public.app_get_intake_draft(uuid) from public, anon, service_role;
grant execute on function public.app_save_intake_draft(uuid,jsonb), public.app_get_intake_draft(uuid) to authenticated;

create function private.finish_intake_draft() returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status <> 'assigned' then delete from private.intake_drafts where assignment_id = new.id; end if;
  return new;
end;
$function$;
revoke all on function private.finish_intake_draft() from public,anon,authenticated,service_role;
create trigger intake_draft_after_completion after update of status on public.form_assignments
for each row execute function private.finish_intake_draft();

create function private.attest_form_signature() returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.field_type_snapshot <> 'signature' then return new; end if;
  if exists (select 1 from public.form_submissions as current_revision
    join public.form_submission_values as original on original.submission_id = current_revision.supersedes_submission_id
      and original.stable_field_key = new.stable_field_key
    where current_revision.id = new.submission_id and original.value = new.value) then return new; end if;
  if jsonb_typeof(new.value) <> 'object' or new.value - array['name','consent'] <> '{}'::jsonb
    or jsonb_typeof(new.value->'name') is distinct from 'string' or length(btrim(new.value->>'name')) not between 1 and 200
    or new.value->'consent' is distinct from 'true'::jsonb then
    raise exception 'A signature requires your full name and consent' using errcode='23514'; end if;
  new.value := new.value || jsonb_build_object('signed_at', now(), 'profile_id', auth.uid());
  return new;
end;
$function$;
revoke all on function private.attest_form_signature() from public,anon,authenticated,service_role;
create trigger attest_form_signature_before_insert before insert on public.form_submission_values
for each row execute function private.attest_form_signature();
