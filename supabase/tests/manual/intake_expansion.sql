-- Execute only against isolated Studio. Every fixture and notification rolls back.
begin;
set local plpgsql.check_asserts = on;
select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claims','{"sub":"53fd4f26-34a0-4965-97b8-87e876a3fd1d","role":"authenticated"}',true);
do $test$
declare
  form public.forms;
  version public.form_versions;
  assignment public.form_assignments;
  submission public.form_submissions;
  text_key uuid := gen_random_uuid();
  signature_key uuid := gen_random_uuid();
  file_key uuid := gen_random_uuid();
  upload_id uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  path text;
  answers jsonb;
  service_id uuid;
  result jsonb;
  reminder_assignment uuid;
  expired_id uuid := gen_random_uuid();
  correction public.form_submissions;
  corrected_values jsonb;
begin
  select id into service_id from public.services where tenant_id='f0f0f0f0-0000-4000-8000-000000000001' and archived_at is null and is_active order by created_at limit 1;
  assert service_id is not null,'synthetic Service fixture missing';
  form := public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding','canonical_key','qa-intake-'||gen_random_uuid()::text,
    'definition',jsonb_build_object('name','Synthetic intake expansion QA','title','Synthetic intake expansion QA','visibility','assigned','type_config',jsonb_build_object('reminder_days',3,'automation',jsonb_build_object('create_project',true,'service_id',service_id,'project_title','Synthetic intake project','task_title','Review intake','crm_status','lead','workflow_steps',jsonb_build_array('Plan work','Deliver work'))),
      'fields',jsonb_build_array(
        jsonb_build_object('stable_field_key',text_key,'sort_order',0,'field_type','text','label','Business','required',true),
        jsonb_build_object('stable_field_key',signature_key,'sort_order',1,'field_type','signature','label','Signature','required',true),
        jsonb_build_object('stable_field_key',file_key,'sort_order',2,'field_type','file','label','File','required',true)
      ),'rules','[]'::jsonb,'service_links','[]'::jsonb)));
  version := public.app_publish_form(gen_random_uuid(),form.id);
  assignment := public.app_assign_form(gen_random_uuid(),form.id,jsonb_build_object('client_profile_id','e6cfa06d-666d-4629-9591-ddc6a55b5798','required',true));
  perform set_config('request.jwt.claims','{"sub":"e6cfa06d-666d-4629-9591-ddc6a55b5798","role":"authenticated"}',true);
  answers := jsonb_build_array(jsonb_build_object('field_key',text_key,'value','Partial draft'));
  perform public.app_save_intake_draft(assignment.id,answers);
  assert public.app_get_intake_draft(assignment.id)->'values'=answers,'draft round trip';
  perform set_config('request.jwt.claims','{"sub":"53fd4f26-34a0-4965-97b8-87e876a3fd1d","role":"authenticated"}',true);
  begin
    perform public.app_get_intake_draft(assignment.id);
    raise exception 'another account read a private draft';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims','{"sub":"e6cfa06d-666d-4629-9591-ddc6a55b5798","role":"authenticated"}',true);
  path := public.app_prepare_intake_file(upload_id,assignment.id,file_key,'synthetic.pdf','application/pdf',12,repeat('a',64));
  assert path like '%/'||assignment.id::text||'/'||upload_id::text,'scoped object path';
  begin
    perform public.app_finish_intake_file(upload_id);
    raise exception 'incomplete upload accepted';
  exception when object_not_in_prerequisite_state then null; end;
  -- This metadata fixture stands in for a trusted Storage write; it stores no real object.
  insert into storage.objects(bucket_id,name,metadata) values('intake-files',path,'{"size":12}'::jsonb);
  perform public.app_finish_intake_file(upload_id);
  perform public.app_prepare_intake_file(expired_id,assignment.id,file_key,'expired.pdf','application/pdf',12,repeat('b',64));
  update private.intake_uploads set expires_at=now()-interval '1 day' where id=expired_id;
  answers := jsonb_build_array(
    jsonb_build_object('field_key',text_key,'value','Synthetic business'),
    jsonb_build_object('field_key',signature_key,'value',jsonb_build_object('name','Synthetic signer','consent',false)),
    jsonb_build_object('field_key',file_key,'value',jsonb_build_array(upload_id)));
  begin
    perform public.app_submit_form(request_id,version.id,jsonb_build_object('assignment_id',assignment.id),answers,'[]'::jsonb);
    raise exception 'unconsented signature accepted';
  exception when check_violation then null; end;
  answers := jsonb_set(answers,'{1,value,consent}','true'::jsonb);
  update private.intake_uploads set expires_at=now()+interval '1 day' where id=upload_id;
  perform public.app_save_intake_draft(assignment.id,answers);
  assert (select expires_at>now()+interval '29 days' from private.intake_uploads where id=upload_id),'saved file retention not renewed';
  update private.intake_uploads set cleanup_claimed_at=clock_timestamp() where id=upload_id;
  begin
    perform public.app_submit_form(request_id,version.id,jsonb_build_object('assignment_id',assignment.id),answers,'[]'::jsonb);
    raise exception 'cleanup-claimed file was submitted';
  exception when object_not_in_prerequisite_state then null; end;
  update private.intake_uploads set cleanup_claimed_at=null where id=upload_id;
  begin
    perform public.app_submit_form(request_id,version.id,jsonb_build_object('assignment_id',assignment.id),
      jsonb_set(answers,'{2,value}',jsonb_build_array(gen_random_uuid())),'[]'::jsonb);
    raise exception 'forged file reference accepted';
  exception when insufficient_privilege then null; end;
  submission := public.app_submit_form(request_id,version.id,jsonb_build_object('assignment_id',assignment.id),answers,'[]'::jsonb);
  assert (select count(*) from public.form_files where submission_id=submission.id)=1,'file not bound exactly once';
  assert (select value->>'profile_id' from public.form_submission_values where submission_id=submission.id and field_type_snapshot='signature')=auth.uid()::text,'signature actor';
  assert (select value ? 'signed_at' from public.form_submission_values where submission_id=submission.id and field_type_snapshot='signature'),'signature timestamp';
  assert not exists(select 1 from private.intake_drafts where assignment_id=assignment.id),'completed draft retained';
  perform public.app_submit_form(request_id,version.id,jsonb_build_object('assignment_id',assignment.id),answers,'[]'::jsonb);
  assert (select count(*) from public.form_files where submission_id=submission.id)=1,'replay duplicated file';
  assert public.app_get_intake_file(upload_id)->>'name'='synthetic.pdf','authorized file lookup';
  assert not has_function_privilege('anon','public.app_get_intake_file(uuid)','EXECUTE'),'anonymous file access';
  assert not exists(select 1 from storage.buckets where id='intake-files' and public),'public intake bucket';
  assert (select file_size_limit=4194304 from storage.buckets where id='intake-files'),'hosted upload limit';
  perform set_config('request.jwt.claims','{"sub":"53fd4f26-34a0-4965-97b8-87e876a3fd1d","role":"authenticated"}',true);
  select jsonb_agg(jsonb_build_object('field_key',stable_field_key,'value',value) order by sort_order_snapshot)
    into corrected_values from public.form_submission_values where submission_id=submission.id;
  begin
    perform public.app_correct_form_submission(gen_random_uuid(),submission.id,jsonb_set(corrected_values,'{1,value,name}','"Replacement signer"'::jsonb));
    raise exception 'staff replaced a signature';
  exception when check_violation then null; end;
  correction:=public.app_correct_form_submission(gen_random_uuid(),submission.id,jsonb_set(corrected_values,'{0,value}','"Corrected business"'::jsonb));
  assert correction.root_submission_id=submission.id,'correction lost its root';
  assert (select value from public.form_submission_values where submission_id=correction.id and field_type_snapshot='signature')=corrected_values#>'{1,value}','correction changed signature evidence';
  assert (select count(*) from private.intake_submission_jobs)=1,'correction queued duplicate actions';
  assert (select status from private.intake_submission_jobs where submission_id=submission.id)='queued','follow-up not queued';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  result:=public.app_server_run_intake_job(submission.id);
  assert result->>'status'='completed','follow-up failed: '||result::text;
  assert (select count(*) from public.order_tasks where order_id=(result#>>'{result,project_id}')::uuid)=3,'workflow task count';
  assert (select status from public.companies where id=assignment.company_id)='lead','CRM not updated';
  perform public.app_server_run_intake_job(submission.id);
  assert (select count(*) from public.orders where notes='Created automatically from intake submission '||submission.id::text)=1,'duplicate project';
  assert (select count(*) from public.order_tasks where order_id=(result#>>'{result,project_id}')::uuid)=3,'duplicate workflow';
  update private.intake_submission_jobs set status='queued',authorizer_id='e6cfa06d-666d-4629-9591-ddc6a55b5798' where submission_id=submission.id;
  result:=public.app_server_run_intake_job(submission.id);
  assert result->>'status'='blocked','unauthorized publisher accepted';
  assert (select count(*) from public.orders where notes='Created automatically from intake submission '||submission.id::text)=1,'unauthorized duplicate project';
  update private.intake_submission_jobs set status='queued',authorizer_id='53fd4f26-34a0-4965-97b8-87e876a3fd1d',
    configuration=jsonb_set(configuration,'{service_id}',to_jsonb(gen_random_uuid()::text)) where submission_id=submission.id;
  result:=public.app_server_run_intake_job(submission.id);
  assert result->>'status'='blocked','unknown or foreign Service accepted';
  assert (select count(*) from public.orders where notes='Created automatically from intake submission '||submission.id::text)=1,'foreign Service created a project';
  insert into public.form_assignments(form_id,form_version_id,company_id,client_profile_id,assigned_by_profile_id,assigned_at)
  values(form.id,version.id,assignment.company_id,assignment.client_profile_id,'53fd4f26-34a0-4965-97b8-87e876a3fd1d',now()-interval '4 days') returning id into reminder_assignment;
  perform public.app_server_intake_maintenance();
  assert (select cleanup_claimed_at is not null from private.intake_uploads where id=expired_id),'orphan not durably claimed';
  perform public.app_server_finish_expired_intake_file(expired_id);
  assert not exists(select 1 from private.intake_uploads where id=expired_id),'expired orphan not finalized';
  assert (select sent_count from private.intake_reminders where assignment_id=reminder_assignment)=1,'reminder not emitted';
  perform public.app_server_intake_maintenance();
  assert (select sent_count from private.intake_reminders where assignment_id=reminder_assignment)=1,'reminder duplicated';
  assert (select count(*) from public.notifications where event_key='intake-reminder:'||reminder_assignment::text||':1')=1,'reminder recipient';
  assert not has_function_privilege('authenticated','public.app_server_run_intake_job(uuid)','EXECUTE'),'client follow-up escalation';
end;
$test$;
rollback;
select 'intake draft, upload binding, signature, idempotency and ACL assertions passed; fixtures rolled back' as result;
