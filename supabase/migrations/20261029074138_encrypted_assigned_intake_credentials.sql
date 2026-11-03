-- Assigned intake credentials use Vault; generic form values carry only an opaque reference.
create table private.intake_secret_references (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  assignment_id uuid not null references public.form_assignments(id) on delete cascade,
  form_version_id uuid not null references public.form_versions(id),
  field_key uuid not null,
  profile_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  request_id uuid not null,
  vault_secret_id uuid unique references vault.secrets(id) on delete restrict,
  submission_id uuid references public.form_submissions(id) on delete cascade,
  captured_by_administrator_id uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '30 days'),
  unique(profile_id,request_id),
  check(expires_at>created_at)
);
create index intake_secret_assignment_field on private.intake_secret_references(assignment_id,field_key);
create index intake_secret_submission on private.intake_secret_references(submission_id) where submission_id is not null;
alter table private.intake_secret_references enable row level security;
alter table private.intake_secret_references force row level security;
revoke all on private.intake_secret_references from public,anon,authenticated,service_role;

insert into private.security_audit_event_codes(event_code,category,severity) values
('integration.intake_secret.captured','integration','info'),
('integration.intake_secret.revealed','integration','info');

alter table public.form_version_fields drop constraint form_version_fields_secret_disabled;
alter table public.form_version_fields add constraint form_version_fields_secret_disabled check (
  field_type<>'secret' or (not required and settings->>'collection_mode'='disabled')
    or (settings->>'collection_mode'='encrypted' and (default_value is null or default_value='null'::jsonb))
);
create function private.enforce_intake_secret_definition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.field_type='secret' and (new.settings->>'collection_mode' is null or new.settings->>'collection_mode' not in ('disabled','encrypted')
    or (new.default_value is not null and new.default_value<>'null'::jsonb)) then
    raise exception 'Credential fields cannot have defaults or an unknown collection mode' using errcode='23514';
  end if;
  if new.field_type='secret' and new.settings->>'collection_mode'='encrypted' and not exists(
    select 1 from public.form_versions v join public.forms f on f.id=v.form_id
    where v.id=new.form_version_id and f.form_type in ('intake','onboarding') and f.visibility='assigned' and v.visibility='assigned'
  ) then raise exception 'Encrypted credentials require an assigned intake form' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_intake_secret_definition() from public,anon,authenticated,service_role;
create trigger intake_secret_definition before insert or update on public.form_version_fields
for each row execute function private.enforce_intake_secret_definition();

create function private.require_intake_secret_session() returns void
language plpgsql stable security definer set search_path='' as $$
declare sid uuid;
begin
  perform private.client_support_request_valid();
  if nullif(current_setting('app.client_support_id',true),'') is not null then return; end if;
  begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid:=null; end;
  if auth.uid() is null or not exists(select 1 from auth.sessions s join public.profiles p on p.id=s.user_id and p.archived_at is null where s.id=sid and s.user_id=auth.uid()
    and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'A current sign-in is required' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_intake_secret_session() from public,anon,authenticated,service_role;

create function private.audit_intake_secret(p_reference private.intake_secret_references,p_event text,p_action text)
returns void language sql security definer set search_path='' as $$
insert into public.security_audit_events(event_code,actor_profile_id,actor_class,action_slug,resource_type,resource_id,target_actor_id,outcome)
values(p_event,coalesce(nullif(current_setting('app.client_support_administrator',true),'')::uuid,auth.uid()),
  case when nullif(current_setting('app.client_support_administrator',true),'') is not null or private.current_account_class()='internal' then 'internal' else 'client' end,
  p_action,'intake_secret',p_reference.id,p_reference.profile_id,'succeeded');
$$;
revoke all on function private.audit_intake_secret(private.intake_secret_references,text,text) from public,anon,authenticated,service_role;

create function private.remove_intake_secret_vault_value() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.vault_secret_id is not null then delete from vault.secrets where id=old.vault_secret_id; end if;
  return old;
end;
$$;
revoke all on function private.remove_intake_secret_vault_value() from public,anon,authenticated,service_role;
create trigger intake_secret_delete_vault after delete on private.intake_secret_references
for each row execute function private.remove_intake_secret_vault_value();

create function private.expire_intake_secret_values(p_limit integer default 25) returns integer
language plpgsql security definer set search_path='' as $$
declare stale private.intake_secret_references; affected integer:=0;
begin
  for stale in select * from private.intake_secret_references where submission_id is null and vault_secret_id is not null
    and expires_at<=clock_timestamp() order by expires_at limit least(greatest(p_limit,0),100) for update skip locked loop
    update private.intake_secret_references set vault_secret_id=null where id=stale.id;
    delete from vault.secrets where id=stale.vault_secret_id;
    affected:=affected+1;
  end loop;
  return affected;
end;
$$;
revoke all on function private.expire_intake_secret_values(integer) from public,anon,authenticated,service_role;

create function private.recheck_intake_secret_capture(p_assignment uuid,p_field uuid,p_version uuid,p_company uuid) returns void
language plpgsql security definer set search_path='' as $$
declare current_assignment public.form_assignments;
begin
  perform private.require_intake_secret_session();
  current_assignment:=private.require_intake_recipient(p_assignment);
  if current_assignment.form_version_id is distinct from p_version or current_assignment.company_id is distinct from p_company
    or not exists(select 1 from public.form_version_fields field join public.form_versions v on v.id=field.form_version_id
      join public.forms f on f.id=v.form_id join public.companies c on c.id=current_assignment.company_id and c.tenant_id=f.tenant_id and c.archived_at is null
      where field.form_version_id=p_version and field.stable_field_key=p_field and field.field_type='secret' and field.settings->>'collection_mode'='encrypted'
        and f.form_type in ('intake','onboarding') and f.visibility='assigned' and v.visibility='assigned' and v.lifecycle_state='published'
        and f.tenant_id=private.current_tenant_id()) then
    raise exception 'Credential assignment is no longer available' using errcode='42501'; end if;
end;
$$;
revoke all on function private.recheck_intake_secret_capture(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.app_capture_intake_secret(p_request_id uuid,p_assignment_id uuid,p_field_key uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment public.form_assignments; reference private.intake_secret_references; field public.form_version_fields; secret_id uuid; same_value boolean;
begin
  perform private.require_intake_secret_session();
  assignment:=private.require_intake_recipient(p_assignment_id);
  if p_request_id is null or p_field_key is null or p_secret is null or char_length(p_secret) not between 1 and 4096 or octet_length(p_secret)>16384 then
    raise exception 'Invalid credential capture' using errcode='22023'; end if;
  select * into field from public.form_version_fields where form_version_id=assignment.form_version_id
    and stable_field_key=p_field_key and field_type='secret' and settings->>'collection_mode'='encrypted';
  if field.id is null then raise exception 'Credential field is unavailable' using errcode='42501'; end if;
  perform private.consume_rate_limit('intake-secret-capture-minute',auth.uid()::text,interval '1 minute',6);
  perform private.consume_rate_limit('intake-secret-capture-day',auth.uid()::text,interval '1 day',40);
  perform pg_advisory_xact_lock(hashtextextended('intake-secret-request:'||auth.uid()::text||':'||p_request_id::text,0));
  select * into reference from private.intake_secret_references where profile_id=auth.uid() and request_id=p_request_id for update;
  perform private.recheck_intake_secret_capture(assignment.id,p_field_key,assignment.form_version_id,assignment.company_id);
  if reference.id is not null then
    if reference.assignment_id is distinct from assignment.id or reference.field_key is distinct from p_field_key
      or reference.form_version_id is distinct from assignment.form_version_id or reference.tenant_id is distinct from private.current_tenant_id()
      or reference.company_id is distinct from assignment.company_id or reference.submission_id is not null
      or reference.expires_at<=clock_timestamp() or reference.vault_secret_id is null then
      raise exception 'Credential capture request cannot be reused' using errcode='23505'; end if;
    begin select decrypted_secret=p_secret into same_value from vault.decrypted_secrets where id=reference.vault_secret_id;
    exception when others then raise exception 'Credential capture is unavailable' using errcode='55000'; end;
    if same_value is distinct from true then raise exception 'Credential capture request cannot be reused' using errcode='23505'; end if;
    perform private.recheck_intake_secret_capture(assignment.id,p_field_key,assignment.form_version_id,assignment.company_id);
    return jsonb_build_object('credential_id',reference.id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intake-secret-assignment:'||assignment.id::text,0));
  if (select count(*) from private.intake_secret_references where assignment_id=assignment.id and submission_id is null and expires_at>clock_timestamp())>=20
    or (select count(*) from private.intake_secret_references where assignment_id=assignment.id and field_key=p_field_key and submission_id is null and expires_at>clock_timestamp())>=5 then
    raise exception 'Credential capture limit reached' using errcode='54000'; end if;
  perform private.recheck_intake_secret_capture(assignment.id,p_field_key,assignment.form_version_id,assignment.company_id);
  begin secret_id:=vault.create_secret(p_secret,null,'Assigned intake credential');
  exception when others then raise exception 'Credential capture is unavailable' using errcode='55000'; end;
  perform private.recheck_intake_secret_capture(assignment.id,p_field_key,assignment.form_version_id,assignment.company_id);
  insert into private.intake_secret_references(tenant_id,assignment_id,form_version_id,field_key,profile_id,company_id,request_id,vault_secret_id,captured_by_administrator_id)
  values(private.current_tenant_id(),assignment.id,assignment.form_version_id,p_field_key,auth.uid(),assignment.company_id,p_request_id,secret_id,
    nullif(current_setting('app.client_support_administrator',true),'')::uuid) returning * into reference;
  perform private.audit_intake_secret(reference,'integration.intake_secret.captured','intake_secret.capture');
  perform private.recheck_intake_secret_capture(assignment.id,p_field_key,assignment.form_version_id,assignment.company_id);
  return jsonb_build_object('credential_id',reference.id);
end;
$$;
revoke all on function public.app_capture_intake_secret(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.app_capture_intake_secret(uuid,uuid,uuid,text) to authenticated;

create function private.require_intake_secret_reference(p_version uuid,p_field uuid,p_value jsonb)
returns private.intake_secret_references language plpgsql security definer set search_path='' as $$
declare identifier uuid; reference private.intake_secret_references;
begin
  perform private.require_intake_secret_session();
  if jsonb_typeof(p_value) is distinct from 'object' or p_value-array['credential_id']<>'{}'::jsonb
    or not (p_value ? 'credential_id') or jsonb_typeof(p_value->'credential_id') is distinct from 'string' then
    raise exception 'Use a saved encrypted credential reference' using errcode='23514'; end if;
  begin identifier:=(p_value->>'credential_id')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid encrypted credential reference' using errcode='23514'; end;
  select r.* into reference from private.intake_secret_references r join public.companies c
    on c.id=r.company_id and c.tenant_id=r.tenant_id and c.archived_at is null
    where r.id=identifier and r.form_version_id=p_version and r.field_key=p_field
      and r.tenant_id=private.current_tenant_id() and r.vault_secret_id is not null;
  if reference.id is null then raise exception 'Encrypted credential is unavailable' using errcode='42501'; end if;
  if private.current_account_class()='client' then
    if reference.profile_id is distinct from auth.uid() or reference.company_id is distinct from private.current_user_company_id()
      or reference.submission_id is not null or reference.expires_at<=clock_timestamp() then
      raise exception 'Encrypted credential is unavailable' using errcode='42501'; end if;
    perform private.require_intake_recipient(reference.assignment_id);
  elsif private.current_account_class()='internal' then
    if reference.submission_id is null or not private.can_read_form_submission(reference.submission_id)
      or not private.current_user_has_permission('forms.submissions_manage') then
      raise exception 'Stored credentials cannot be changed through corrections' using errcode='42501'; end if;
  else raise exception 'Encrypted credential is unavailable' using errcode='42501'; end if;
  return reference;
end;
$$;
revoke all on function private.require_intake_secret_reference(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.bind_intake_secret_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare submission public.form_submissions; reference private.intake_secret_references; prior jsonb;
begin
  if new.field_type_snapshot<>'secret' then return new; end if;
  select * into submission from public.form_submissions where id=new.submission_id;
  reference:=private.require_intake_secret_reference(submission.form_version_id,new.stable_field_key,new.value);
  if submission.supersedes_submission_id is not null then
    select value into prior from public.form_submission_values where submission_id=submission.supersedes_submission_id and stable_field_key=new.stable_field_key;
    if new.value is distinct from prior then raise exception 'Stored credentials cannot be changed through corrections' using errcode='23514'; end if;
    return new;
  end if;
  if reference.assignment_id is distinct from submission.form_assignment_id or reference.profile_id is distinct from submission.client_profile_id
    or reference.company_id is distinct from submission.company_id or reference.submission_id is not null then
    raise exception 'Encrypted credential assignment does not match this submission' using errcode='42501'; end if;
  update private.intake_secret_references set submission_id=submission.id where id=reference.id and submission_id is null
    and expires_at>clock_timestamp();
  if not found then raise exception 'Encrypted credential is unavailable' using errcode='42501'; end if;
  perform private.require_intake_secret_session();
  perform private.require_intake_recipient(submission.form_assignment_id);
  return new;
end;
$$;
revoke all on function private.bind_intake_secret_reference() from public,anon,authenticated,service_role;
create trigger bind_intake_secret_before_insert before insert on public.form_submission_values
for each row execute function private.bind_intake_secret_reference();

create function private.require_intake_secret_reader(p_submission_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=private.current_tenant_id();
begin
  perform private.require_intake_secret_session();
  if nullif(current_setting('app.client_support_id',true),'') is not null or not exists(
    select 1 from public.tenant_memberships m join public.roles r on r.id=m.role_id and r.name in ('owner','admin')
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    where m.profile_id=auth.uid() and m.tenant_id=tenant and m.account_class='internal' and m.archived_at is null
  ) or not private.current_user_has_permission('client_private.manage') or not private.current_user_has_permission('forms.submissions_view')
    or not private.can_read_form_submission(p_submission_id) then
    raise exception 'Credential access is denied' using errcode='42501'; end if;
  if not exists(select 1 from public.form_submissions s join public.tenant_memberships m
    on m.profile_id=s.client_profile_id and m.company_id=s.company_id and m.tenant_id=tenant and m.account_class='client' and m.archived_at is null
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    join public.companies c on c.id=m.company_id and c.tenant_id=m.tenant_id and c.archived_at is null
    where s.id=p_submission_id) then raise exception 'Credential access is denied' using errcode='42501'; end if;
end;
$$;
revoke all on function private.require_intake_secret_reader(uuid) from public,anon,authenticated,service_role;

create function public.app_list_intake_secret_references(p_submission_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_intake_secret_reader(p_submission_id);
  select coalesce(jsonb_agg(jsonb_build_object('credential_id',r.id,'field_key',r.field_key,'label',v.field_label_snapshot) order by v.sort_order_snapshot),'[]'::jsonb)
    into result from public.form_submission_values v join private.intake_secret_references r
      on r.id::text=v.value->>'credential_id' and r.field_key=v.stable_field_key
    where v.submission_id=p_submission_id and v.field_type_snapshot='secret' and r.submission_id is not null
      and r.tenant_id=private.current_tenant_id() and r.vault_secret_id is not null;
  return result;
end;
$$;
revoke all on function public.app_list_intake_secret_references(uuid) from public,anon,service_role;
grant execute on function public.app_list_intake_secret_references(uuid) to authenticated;

create function public.app_reveal_intake_secret(p_credential_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare reference private.intake_secret_references; clear_value text;
begin
  select * into reference from private.intake_secret_references where id=p_credential_id and tenant_id=private.current_tenant_id()
    and submission_id is not null and vault_secret_id is not null;
  if reference.id is null then raise exception 'Credential access is denied' using errcode='42501'; end if;
  perform private.require_intake_secret_reader(reference.submission_id);

  perform private.consume_rate_limit('intake-secret-reveal',auth.uid()::text,interval '1 minute',20);
  perform private.require_intake_secret_reader(reference.submission_id);
  begin select decrypted_secret into clear_value from vault.decrypted_secrets where id=reference.vault_secret_id;
  exception when others then raise exception 'Credential reveal is unavailable' using errcode='55000'; end;
  if clear_value is null then raise exception 'Credential reveal is unavailable' using errcode='55000'; end if;
  perform private.audit_intake_secret(reference,'integration.intake_secret.revealed','intake_secret.reveal');
  perform private.require_intake_secret_reader(reference.submission_id);
  return clear_value;
end;
$$;
revoke all on function public.app_reveal_intake_secret(uuid) from public,anon,service_role;
grant execute on function public.app_reveal_intake_secret(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.validate_form_submission_values(p_form_version_id uuid, p_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  submitted_value jsonb;
  field_row public.form_version_fields;
  submitted_key uuid;
  answer jsonb;
  selected_value jsonb;
begin
  perform private.enforce_form_payload_limits(p_values);

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
    if field_row.field_type = 'password' or (field_row.field_type='secret' and field_row.settings->>'collection_mode' is distinct from 'encrypted') then
      raise exception 'credential-like Form values require a dedicated encrypted storage boundary' using errcode = '55000';
    end if;
    if field_row.field_type='secret' then
      perform private.require_intake_secret_reference(p_form_version_id,submitted_key,answer);
    end if;
    if field_row.field_type = 'captcha' then
      raise exception 'Form field integration is deferred' using errcode = '55000';
    end if;
    if field_row.field_type = 'file' and (jsonb_typeof(answer) is distinct from 'array' or jsonb_array_length(answer) <> 1) then
      raise exception 'Choose one uploaded file' using errcode = '23514';
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
$function$
;

CREATE OR REPLACE FUNCTION public.app_save_intake_draft(p_assignment_id uuid, p_values jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare assignment public.form_assignments := private.require_intake_recipient(p_assignment_id); saved timestamptz; file_answer record; file_id text; secret_answer record; reference private.intake_secret_references;
begin
  perform private.enforce_form_payload_limits(p_values);
  if exists(select 1 from jsonb_array_elements(p_values) as answer
    left join public.form_version_fields as field on field.form_version_id = assignment.form_version_id
      and field.stable_field_key::text = answer->>'field_key'
    where field.id is null or field.field_type in ('password','hidden','html','captcha','payment','break','pagebreak')
      or answer - array['field_key','value'] <> '{}'::jsonb or not answer ?& array['field_key','value'])
    or exists(select 1 from jsonb_array_elements(p_values) as answer group by answer->>'field_key' having count(*) > 1) then
    raise exception 'invalid draft answers' using errcode = '22023'; end if;
  for secret_answer in
    select answer->'value' as value,field.stable_field_key as key,field.settings
    from jsonb_array_elements(p_values) answer join public.form_version_fields field
      on field.form_version_id=assignment.form_version_id and field.stable_field_key::text=answer->>'field_key'
    where field.field_type='secret'
  loop
    if secret_answer.settings->>'collection_mode' is distinct from 'encrypted' then raise exception 'invalid draft answers' using errcode='22023'; end if;
    reference:=private.require_intake_secret_reference(assignment.form_version_id,secret_answer.key,secret_answer.value);
    if reference.assignment_id is distinct from assignment.id then raise exception 'Encrypted credential assignment mismatch' using errcode='42501'; end if;
  end loop;
  for file_answer in
    select answer->'value' as value, field.stable_field_key as key
    from jsonb_array_elements(p_values) answer join public.form_version_fields field
      on field.form_version_id=assignment.form_version_id and field.stable_field_key::text=answer->>'field_key'
    where field.field_type='file'
  loop
    if jsonb_typeof(file_answer.value) is distinct from 'array' or jsonb_array_length(file_answer.value)>1 then
      raise exception 'Invalid saved file' using errcode='22023'; end if;
    for file_id in select jsonb_array_elements_text(file_answer.value) loop
      update private.intake_uploads set expires_at=now()+interval '30 days'
      where id=file_id::uuid and assignment_id=p_assignment_id and profile_id=auth.uid()
        and field_key=file_answer.key and ready and submission_id is null and expires_at>now() and cleanup_claimed_at is null;
      if not found then raise exception 'Saved file unavailable' using errcode='42501'; end if;
    end loop;
  end loop;
  insert into private.intake_drafts(assignment_id, profile_id, form_version_id, answers)
    values(p_assignment_id, auth.uid(), assignment.form_version_id, p_values)
  on conflict (assignment_id) do update set answers = excluded.answers, updated_at = now(), expires_at = now() + interval '30 days'
  returning updated_at into saved;
  return saved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_server_intake_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare candidate record; count_sent integer:=0; sequence integer; expired integer; expired_files jsonb;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server maintenance required' using errcode='42501'; end if;
  perform private.expire_intake_secret_values(25);
  for candidate in
    select a.*,f.tenant_id,v.title,coalesce((v.type_config->>'reminder_days')::integer,0) days
    from public.form_assignments a join public.forms f on f.id=a.form_id
    join public.form_versions v on v.id=a.form_version_id
    join public.tenants t on t.id=f.tenant_id and t.status='active' and t.archived_at is null
    join public.tenant_memberships m on m.profile_id=a.client_profile_id and m.tenant_id=f.tenant_id
      and m.company_id=a.company_id and m.account_class='client' and m.archived_at is null
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    left join private.intake_reminders r on r.assignment_id=a.id
    where a.status='assigned' and a.archived_at is null and f.status='published' and f.archived_at is null
      and f.published_version_id=v.id and f.form_type in ('intake','onboarding')
      and coalesce((v.type_config->>'reminder_days')::integer,0)>0 and coalesce(r.sent_count,0)<3
      and coalesce(r.last_sent_at,a.assigned_at)+make_interval(days=>(v.type_config->>'reminder_days')::integer)<=now()
      and private.tenant_module_allowed(f.tenant_id,'forms')
      and private.profile_has_permission_in_tenant(a.client_profile_id,f.tenant_id,'forms.view')
      and private.profile_has_permission_in_tenant(v.published_by_profile_id,f.tenant_id,'forms.assign')
    order by a.assigned_at limit 100 for update of a skip locked
  loop
    insert into private.intake_reminders(assignment_id,sent_count,last_sent_at) values(candidate.id,1,now())
    on conflict(assignment_id) do update set sent_count=private.intake_reminders.sent_count+1,last_sent_at=now()
    returning sent_count into sequence;
    insert into public.notifications(recipient_profile_id,company_id,tenant_id,audience,category,variant,title,body,href,entity_type,entity_id,event_key)
    values(candidate.client_profile_id,candidate.company_id,candidate.tenant_id,'client','form','info',
      'Your form is waiting','Please complete '||left(candidate.title,200)||' when you are ready.',
      '/account/onboarding/'||candidate.id::text,'form_assignment',candidate.id,'intake-reminder:'||candidate.id::text||':'||sequence::text)
    on conflict(recipient_profile_id,event_key) do nothing;
    count_sent:=count_sent+1;
  end loop;
  -- Retain the request tombstone, while removing old correspondence content.
  update private.client_contact_emails set recipient='',subject='',body='',
    status=case when status='sending' then 'uncertain' else status end,
    finished_at=coalesce(finished_at,now())
  where created_at<now()-interval '90 days' and body<>'';
  delete from private.intake_drafts where assignment_id in (select assignment_id from private.intake_drafts where expires_at<=now() limit 100);
  get diagnostics expired = row_count;
  with claimed as (
    update private.intake_uploads u set cleanup_claimed_at=coalesce(u.cleanup_claimed_at,clock_timestamp())
    where u.id in (select id from private.intake_uploads where submission_id is null and expires_at<=clock_timestamp()
      order by expires_at limit 25 for update skip locked)
      and u.submission_id is null and u.expires_at<=clock_timestamp()
    returning u.id,u.object_key
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_key)),'[]'::jsonb) into expired_files from claimed;
  return jsonb_build_object('reminders',count_sent,'expired_drafts',expired,
    'queued',(select coalesce(jsonb_agg(submission_id),'[]'::jsonb) from (select submission_id from private.intake_submission_jobs where status='queued' order by created_at limit 25) jobs),
    'expired_files',expired_files);
end;
$function$;

create or replace function private.client_support_operation_allowed(p_path text,p_method text)
returns boolean language sql immutable set search_path='' as $$
  select case when regexp_replace(p_path,'^(/rest/v1)?/','') like 'rpc/%'
    then substring(regexp_replace(p_path,'^(/rest/v1)?/','') from 5)=any(array['app_get_client_support_context','app_current_tenant_membership','app_current_user_permissions','app_current_user_modules','app_require_module_access','app_get_client_account_context','app_get_my_profile','app_get_runtime_white_label_configuration','app_list_my_client_projects','app_get_my_client_project','app_get_my_order_start','app_request_my_order_start','app_reconcile_my_order_start','app_my_intake_version_available','app_get_project_conversation','app_get_published_form_schema','app_list_assigned_forms','app_list_form_submissions','app_forms_work_enabled','app_get_form_assignment_history','app_get_assigned_form_schema','app_get_assigned_form_service_labels','app_submit_form','app_capture_intake_secret','app_get_intake_follow_up','app_get_intake_draft','app_save_intake_draft','app_prepare_intake_file','app_finish_intake_file','app_get_intake_file','app_get_form_submission_pdf','app_get_form_submission','app_list_ticket_summaries','app_get_ticket_detail_with_avatars','app_get_order_conversation','app_send_order_message','app_reply_to_order_message','app_toggle_order_message_reaction','app_reply_to_ticket','app_reply_to_ticket_message','app_toggle_ticket_message_reaction','app_create_ticket','app_prepare_ticket_attachment','app_send_ticket_message_with_attachment','app_get_ticket_attachment_download','app_set_client_conversation_presence','app_list_my_notifications','app_mark_notification_read','app_mark_all_notifications_read','app_list_my_client_reports','app_get_my_client_report','app_mark_client_report_read','app_count_my_unread_reports','app_invoices_work_enabled','app_get_invoice_financials','app_list_invoice_items','app_get_wf_card_settings','app_store_purchase_projects_enabled','app_pay_invoice_with_wallet','app_purchase_service_with_balance','app_get_company_wallet','app_list_my_wallet_history','app_subscriptions_work_enabled','app_list_subscription_summaries','app_get_subscription_detail','app_record_store_interest']::text[])
    else p_method in ('GET','HEAD') and regexp_replace(p_path,'^(/rest/v1)?/','')=any(array['profiles','services','service_folders','invoices','companies','wf_card_memberships']) end;
$$;

create or replace function public.app_get_intake_draft(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare assignment public.form_assignments:=private.require_intake_recipient(p_assignment_id); result jsonb;
begin
  select jsonb_build_object('values',coalesce((select jsonb_agg(answer order by saved.position) from jsonb_array_elements(d.answers) with ordinality saved(answer,position)
    join public.form_version_fields field on field.form_version_id=d.form_version_id and field.stable_field_key::text=answer->>'field_key'
    where field.field_type<>'secret' or (field.settings->>'collection_mode'='encrypted' and exists(
      select 1 from private.intake_secret_references r where r.id::text=answer->'value'->>'credential_id'
        and (answer->'value')-array['credential_id']='{}'::jsonb and r.assignment_id=assignment.id
        and r.profile_id=auth.uid() and r.form_version_id=assignment.form_version_id and r.field_key=field.stable_field_key
        and r.company_id=assignment.company_id and r.tenant_id=private.current_tenant_id()
        and r.submission_id is null and r.vault_secret_id is not null and r.expires_at>clock_timestamp()
    ))),'[]'::jsonb),'updated_at',d.updated_at,'expires_at',d.expires_at) into result
  from private.intake_drafts d where d.assignment_id=assignment.id and d.profile_id=auth.uid()
    and d.form_version_id=assignment.form_version_id and d.expires_at>now();
  return result;
end;
$$;

create or replace function public.app_get_form_assignment_history(p_assignment_id uuid)
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
  return assignment || jsonb_build_object('secret_fields',(select coalesce(jsonb_agg(jsonb_build_object(
    'field_key',field.stable_field_key,'collection_mode',case when field.field_type='secret' and field.settings->>'collection_mode'='encrypted' then 'encrypted' else 'disabled' end)
    order by field.sort_order),'[]'::jsonb) from public.form_version_fields field
    where field.form_version_id=(assignment->>'form_version_id')::uuid and field.field_type in ('secret','password')));
end;
$$;

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
  if exists(select 1 from jsonb_array_elements(p_values) submitted join public.form_version_fields field
    on field.form_version_id=original_row.form_version_id and field.stable_field_key::text=submitted->>'field_key' and field.field_type='secret'
    left join public.form_submission_values prior on prior.submission_id=original_row.id and prior.stable_field_key=field.stable_field_key
    where submitted->'value' is distinct from prior.value) then
    raise exception 'Stored credentials cannot be changed through corrections' using errcode='23514';
  end if;
  p_values:=p_values||(select coalesce(jsonb_agg(jsonb_build_object('field_key',prior.stable_field_key,'value',prior.value)),'[]'::jsonb)
    from public.form_submission_values prior where prior.submission_id=original_row.id and prior.field_type_snapshot='secret'
      and not exists(select 1 from jsonb_array_elements(p_values) submitted where submitted->>'field_key'=prior.stable_field_key::text));
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
      and (field.field_type in ('password', 'captcha', 'payment', 'hidden', 'break', 'pagebreak', 'html')
        or (field.field_type='secret' and (field.settings->>'collection_mode' is distinct from 'encrypted'
          or form_row.form_type not in ('intake','onboarding') or version_row.visibility is distinct from 'assigned'))
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
$function$;

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

  return result||jsonb_build_object('has_saved_credentials',exists(select 1 from public.form_submission_values value_row
    join private.intake_secret_references r on r.id::text=value_row.value->>'credential_id'
    join public.form_submissions bound on bound.id=r.submission_id and bound.root_submission_id=submission_row.root_submission_id
    where value_row.submission_id=submission_row.id and value_row.field_type_snapshot='secret' and r.vault_secret_id is not null
      and r.assignment_id=submission_row.form_assignment_id and r.profile_id=submission_row.client_profile_id
      and r.company_id=submission_row.company_id and r.form_version_id=submission_row.form_version_id
      and r.field_key=value_row.stable_field_key and r.tenant_id=private.current_tenant_id()));
end;
$function$
;
