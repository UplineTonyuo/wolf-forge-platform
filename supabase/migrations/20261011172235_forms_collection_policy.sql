-- Integration-only successor: narrow RLS execution and preserve accepted trusted bootstrap.
create function private.forms_collection_policy_allows() returns boolean language sql stable security definer set search_path='' as $$
 select private.tenant_module_allowed(private.current_tenant_id(),'forms');
$$;
revoke all on function private.forms_collection_policy_allows() from public,anon,authenticated,service_role;
grant execute on function private.forms_collection_policy_allows() to authenticated;
do $$ declare relation_name text; begin
 foreach relation_name in array array['form_versions','form_version_fields','form_field_options','form_rules','form_service_links'] loop
 execute format('alter policy forms_collection_enabled on public.%I using (private.forms_collection_policy_allows())',relation_name);
 end loop;
end; $$;

create or replace function private.create_ticket_from_contact_submission(p_submission_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.lock_tenant_module_lifecycle((select f.tenant_id from public.forms f join public.form_submissions s on s.form_id=f.id where s.id=p_submission_id));
  select submission.* into submission_row
  from public.form_submissions as submission
  where submission.id = p_submission_id
    and submission.orchestration_type = 'contact_ticket'
    and submission.orchestration_status = 'deferred'
    and submission.supersedes_submission_id is null
    and submission.provenance->>'tickets_enabled_at_submission'='true'
  for update;
  if submission_row.id is null then
    select id into ticket_row.id from public.tickets where source_form_submission_id = p_submission_id;
    return ticket_row.id;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = submission_row.form_version_id;
  if version_row.id is null then return null; end if;

  perform private.lock_tenant_module_lifecycle((select tenant_id from public.forms where id=submission_row.form_id));
  if not private.tenant_module_allowed((select tenant_id from public.forms where id=submission_row.form_id),'forms') or not private.tenant_module_allowed((select tenant_id from public.forms where id=submission_row.form_id),'tickets') then
    return null;
  end if;

  if (auth.uid() is not null or exists(select 1 from private.tenant_module_publications p join public.forms f on f.tenant_id=p.tenant_id where f.id=submission_row.form_id)) and not exists(select 1 from public.forms f join public.tenants t on t.id=f.tenant_id
    where f.id=submission_row.form_id and f.archived_at is null and t.status='active' and t.archived_at is null
    and (submission_row.company_id is null or exists(select 1 from public.companies c where c.id=submission_row.company_id and c.tenant_id=f.tenant_id and c.archived_at is null))
    and (submission_row.submitted_by_profile_id is null or exists(select 1 from public.profiles p
      join public.tenant_memberships m on m.profile_id=p.id and m.tenant_id=f.tenant_id
      where p.id=submission_row.submitted_by_profile_id and p.archived_at is null and m.archived_at is null
      and (m.account_class='internal' or m.company_id=submission_row.company_id)
      and private.profile_has_permission_in_tenant(p.id,f.tenant_id,case when m.account_class='client' then 'forms.view' else 'forms.submissions_manage' end)))) then
    raise exception 'Contact submission authority is unavailable' using errcode='42501';
  end if;

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
