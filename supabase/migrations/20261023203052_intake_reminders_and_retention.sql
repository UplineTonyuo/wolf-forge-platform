create table private.intake_reminders (
  assignment_id uuid primary key references public.form_assignments(id),
  sent_count integer not null check(sent_count between 1 and 3),
  last_sent_at timestamptz not null
);
alter table private.intake_reminders enable row level security;
revoke all on private.intake_reminders from public,anon,authenticated,service_role;

create function public.app_server_intake_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare candidate record; count_sent integer:=0; sequence integer; expired integer;
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
  delete from private.intake_drafts where assignment_id in (select assignment_id from private.intake_drafts where expires_at<=now() limit 100);
  get diagnostics expired = row_count;
  return jsonb_build_object('reminders',count_sent,'expired_drafts',expired,
    'queued',(select coalesce(jsonb_agg(submission_id),'[]'::jsonb) from (select submission_id from private.intake_submission_jobs where status='queued' order by created_at limit 25) jobs),
    'expired_files',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_key)),'[]'::jsonb)
      from (select id,object_key from private.intake_uploads where submission_id is null and expires_at<=now() limit 25) files));
end;
$function$;

create function public.app_server_finish_expired_intake_file(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $function$
begin
  if auth.role() is distinct from 'service_role' or auth.uid() is not null then raise exception 'Server maintenance required' using errcode='42501'; end if;
  if exists(select 1 from storage.objects o join private.intake_uploads u on u.object_key=o.name
    where u.id=p_id and o.bucket_id='intake-files') then raise exception 'Storage removal not confirmed' using errcode='55000'; end if;
  delete from private.intake_uploads where id=p_id and submission_id is null and expires_at<=now();
end;
$function$;
revoke all on function public.app_server_intake_maintenance(),public.app_server_finish_expired_intake_file(uuid) from public,anon,authenticated;
grant execute on function public.app_server_intake_maintenance(),public.app_server_finish_expired_intake_file(uuid) to service_role;
