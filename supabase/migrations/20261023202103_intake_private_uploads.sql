insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('intake-files','intake-files',false,5242880,array['image/jpeg','image/png','image/webp','image/gif','application/pdf']);

create table private.intake_uploads (
  id uuid primary key,
  assignment_id uuid not null references public.form_assignments(id),
  profile_id uuid not null references public.profiles(id),
  field_key uuid not null,
  object_key text not null unique,
  original_name text not null check(length(original_name) between 1 and 255),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','image/gif','application/pdf')),
  size_bytes integer not null check(size_bytes between 1 and 5242880),
  checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
  ready boolean not null default false,
  submission_id uuid references public.form_submissions(id),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table private.intake_uploads enable row level security;
revoke all on private.intake_uploads from public,anon,authenticated,service_role;

create function public.app_prepare_intake_file(p_id uuid,p_assignment_id uuid,p_field_key uuid,p_name text,p_mime text,p_size integer,p_checksum text)
returns text language plpgsql security definer set search_path = '' as $function$
declare assignment public.form_assignments := private.require_intake_recipient(p_assignment_id); upload private.intake_uploads;
begin
  if p_id is null or p_field_key is null or p_name is null or p_mime is null or p_size is null or p_checksum is null then
    raise exception 'invalid upload' using errcode='22023'; end if;
  if not exists(select 1 from public.form_version_fields where form_version_id=assignment.form_version_id and stable_field_key=p_field_key and field_type='file') then
    raise exception 'file field unavailable' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text,1));
  select * into upload from private.intake_uploads where id=p_id;
  if found then
    if upload.assignment_id<>p_assignment_id or upload.profile_id<>auth.uid() or upload.field_key<>p_field_key
      or upload.original_name<>p_name or upload.mime_type<>p_mime or upload.size_bytes<>p_size or upload.checksum<>p_checksum
      or upload.expires_at<=now() or upload.submission_id is not null then
      raise exception 'upload request conflict' using errcode='23505'; end if;
    return upload.object_key;
  end if;
  if (select count(*) from private.intake_uploads where assignment_id=p_assignment_id and expires_at>now())>=20 then
    raise exception 'This form has reached its upload limit' using errcode='54000'; end if;
  insert into private.intake_uploads(id,assignment_id,profile_id,field_key,object_key,original_name,mime_type,size_bytes,checksum)
  values(p_id,p_assignment_id,auth.uid(),p_field_key,private.current_tenant_id()::text||'/'||p_assignment_id::text||'/'||p_id::text,p_name,p_mime,p_size,p_checksum)
  returning * into upload;
  return upload.object_key;
end;
$function$;

create function public.app_finish_intake_file(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $function$
declare upload private.intake_uploads;
begin
  select * into upload from private.intake_uploads where id=p_id and profile_id=auth.uid() for update;
  if upload.id is null or upload.expires_at<=now() or upload.submission_id is not null then raise no_data_found; end if;
  perform private.require_intake_recipient(upload.assignment_id);
  if not exists(select 1 from storage.objects where bucket_id='intake-files' and name=upload.object_key
    and (metadata->>'size')::bigint=upload.size_bytes) then
    raise exception 'Upload is incomplete' using errcode='55000'; end if;
  update private.intake_uploads set ready=true where id=p_id;
end;
$function$;

create function public.app_get_intake_file(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare upload private.intake_uploads;
begin
  select * into upload from private.intake_uploads where id=p_id and ready;
  if upload.id is null then raise no_data_found; end if;
  if upload.submission_id is null then
    if upload.profile_id is distinct from auth.uid() or upload.expires_at<=now() then raise no_data_found; end if;
    perform private.require_intake_recipient(upload.assignment_id);
  elsif not private.can_read_form_submission(upload.submission_id) then
    raise exception 'File access denied' using errcode='42501';
  end if;
  return jsonb_build_object('id',upload.id,'name',upload.original_name,'mime',upload.mime_type,'size',upload.size_bytes,'path',upload.object_key);
end;
$function$;
revoke all on function public.app_prepare_intake_file(uuid,uuid,uuid,text,text,integer,text),
  public.app_finish_intake_file(uuid), public.app_get_intake_file(uuid) from public,anon,service_role;
grant execute on function public.app_prepare_intake_file(uuid,uuid,uuid,text,text,integer,text),
  public.app_finish_intake_file(uuid), public.app_get_intake_file(uuid) to authenticated;

create function private.bind_intake_file() returns trigger language plpgsql security definer set search_path = '' as $function$
declare submission public.form_submissions; upload private.intake_uploads; file_id uuid;
begin
  if new.field_type_snapshot<>'file' then return new; end if;
  if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value)<>1 then
    raise exception 'Choose one uploaded file' using errcode='23514'; end if;
  select * into submission from public.form_submissions where id=new.submission_id;
  file_id := (new.value->>0)::uuid;
  select * into upload from private.intake_uploads where id=file_id for update;
  if upload.id is null or upload.assignment_id is distinct from submission.form_assignment_id
    or upload.field_key is distinct from new.stable_field_key or not upload.ready then
    raise exception 'File does not belong to this assignment' using errcode='42501'; end if;
  if upload.submission_id is not null then
    if not exists(select 1 from public.form_submissions original where original.id=upload.submission_id
      and original.root_submission_id=submission.root_submission_id) then
      raise exception 'File already submitted' using errcode='42501'; end if;
    return new;
  end if;
  if upload.profile_id is distinct from auth.uid() or upload.expires_at<=now() then raise no_data_found; end if;
  update private.intake_uploads set submission_id=new.submission_id where id=file_id;
  insert into public.form_files(submission_id,form_version_field_id,stable_field_key,storage_object_key,
    original_name,mime_type,size_bytes,checksum_sha256,uploaded_by_profile_id,scan_status)
  values(new.submission_id,new.form_version_field_id,new.stable_field_key,upload.object_key,
    upload.original_name,upload.mime_type,upload.size_bytes,upload.checksum,auth.uid(),'pending');
  return new;
end;
$function$;
revoke all on function private.bind_intake_file() from public,anon,authenticated,service_role;
create trigger bind_intake_file_before_insert before insert on public.form_submission_values
for each row execute function private.bind_intake_file();

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
    if field_row.field_type in ('password', 'secret') then
      raise exception 'credential-like Form values require a dedicated encrypted storage boundary' using errcode = '55000';
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
