alter table private.intake_uploads add column cleanup_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION private.bind_intake_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare submission public.form_submissions; upload private.intake_uploads; file_id uuid;
begin
  if new.field_type_snapshot<>'file' then return new; end if;
  if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value)<>1 then
    raise exception 'Choose one uploaded file' using errcode='23514'; end if;
  select * into submission from public.form_submissions where id=new.submission_id;
  file_id := (new.value->>0)::uuid;
  select * into upload from private.intake_uploads where id=file_id for update;
  if upload.cleanup_claimed_at is not null then raise exception 'File cleanup already claimed' using errcode='55000'; end if;
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

CREATE OR REPLACE FUNCTION public.app_get_intake_file(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare upload private.intake_uploads;
begin
  select * into upload from private.intake_uploads where id=p_id and ready and cleanup_claimed_at is null;
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

CREATE OR REPLACE FUNCTION public.app_save_intake_draft(p_assignment_id uuid, p_values jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare assignment public.form_assignments := private.require_intake_recipient(p_assignment_id); saved timestamptz; file_answer record; file_id text;
begin
  perform private.enforce_form_payload_limits(p_values);
  if exists(select 1 from jsonb_array_elements(p_values) as answer
    left join public.form_version_fields as field on field.form_version_id = assignment.form_version_id
      and field.stable_field_key::text = answer->>'field_key'
    where field.id is null or field.field_type in ('password','secret','hidden','html','captcha','payment','break','pagebreak')
      or answer - array['field_key','value'] <> '{}'::jsonb or not answer ?& array['field_key','value'])
    or exists(select 1 from jsonb_array_elements(p_values) as answer group by answer->>'field_key' having count(*) > 1) then
    raise exception 'invalid draft answers' using errcode = '22023'; end if;
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

CREATE OR REPLACE FUNCTION public.app_finish_intake_file(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare upload private.intake_uploads;
begin
  select * into upload from private.intake_uploads where id=p_id and profile_id=auth.uid() for update;
  if upload.id is null or upload.cleanup_claimed_at is not null or upload.expires_at<=now() or upload.submission_id is not null then raise no_data_found; end if;
  perform private.require_intake_recipient(upload.assignment_id);
  if not exists(select 1 from storage.objects where bucket_id='intake-files' and name=upload.object_key
    and (metadata->>'size')::bigint=upload.size_bytes) then
    raise exception 'Upload is incomplete' using errcode='55000'; end if;
  update private.intake_uploads set ready=true where id=p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_prepare_intake_file(p_id uuid, p_assignment_id uuid, p_field_key uuid, p_name text, p_mime text, p_size integer, p_checksum text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or upload.cleanup_claimed_at is not null or upload.expires_at<=now() or upload.submission_id is not null then
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

CREATE OR REPLACE FUNCTION public.app_server_intake_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare candidate record; count_sent integer:=0; sequence integer; expired integer; expired_files jsonb;
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server maintenance required' using errcode='42501'; end if;
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
