create function private.ticket_call_overlap(p_call uuid) returns tstzmultirange
language sql stable security definer set search_path='' as $$
select coalesce((select range_agg(tstzrange(i.joined_at,i.left_at,'[)')) from private.ticket_call_intervals i
  where i.call_id=c.id and i.profile_id=c.initiated_by),'{}'::tstzmultirange)
  * coalesce((select range_agg(tstzrange(i.joined_at,i.left_at,'[)')) from private.ticket_call_intervals i
    where i.call_id=c.id and i.profile_id=c.callee_profile_id),'{}'::tstzmultirange)
from private.ticket_calls c where c.id=p_call;
$$;

create function public.app_ticket_call_history(p_ticket_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.ticket_call_session();
  if not private.ticket_call_profile_allowed(auth.uid(),p_ticket_id,false)
    or not exists(select 1 from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id()) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  perform private.consume_rate_limit('ticket-call-history',auth.uid()::text,interval '1 minute',60);
  select coalesce(jsonb_agg(private.ticket_call_projection(c) order by c.created_at desc,c.id desc),'[]'::jsonb) into result
  from (select * from private.ticket_calls where ticket_id=p_ticket_id and not legacy and auth.uid()=any(participants)
    and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50) c;
  return result;
end $$;

create function public.app_ticket_call_owner_summary(p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.current_tenant_id(); start_at timestamptz; stop_at timestamptz; counts jsonb; seconds numeric;
begin
  perform private.ticket_call_session();
  if not exists(select 1 from public.tenant_memberships m join public.roles r on r.id=m.role_id
    join public.tenants t on t.id=m.tenant_id and t.status='active' and t.archived_at is null
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    where m.tenant_id=tid and m.profile_id=auth.uid() and m.account_class='internal' and m.archived_at is null and r.name='owner') then
    raise exception 'Owner required' using errcode='42501'; end if;
  if p_month is null or extract(day from p_month)<>1 then raise exception 'Invalid month' using errcode='22023'; end if;
  perform private.consume_rate_limit('ticket-call-summary',auth.uid()::text,interval '1 minute',30);
  start_at:=p_month::timestamp at time zone 'UTC'; stop_at:=(p_month+interval '1 month') at time zone 'UTC';
  select jsonb_build_object('made',count(*) filter(where outcome is null or outcome not in ('busy','refused')),
    'answered',count(*) filter(where answered_at is not null),'missed',count(*) filter(where outcome='missed')) into counts
    from private.ticket_calls where tenant_id=tid and not legacy and created_at>=start_at and created_at<stop_at;
  select coalesce(sum(extract(epoch from upper(segment)-lower(segment))),0) into seconds
    from private.ticket_calls c cross join lateral unnest(private.ticket_call_overlap(c.id)
      * tstzmultirange(tstzrange(start_at,stop_at,'[)'))) segment
    where c.tenant_id=tid and not c.legacy;
  return counts||jsonb_build_object('connectedSeconds',seconds);
end $$;

create function public.app_complete_ticket_call_room(p_call_id uuid,p_claim_id uuid,p_room jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; props jsonb;
begin
  perform private.ticket_call_lock(); perform private.process_ticket_call_deadlines();
  select * into c from private.ticket_calls where id=p_call_id and not legacy for update;
  props:=p_room->'config';
  if c.id is null or c.room_claim_id is distinct from p_claim_id or c.state not in ('connecting','active')
    or c.expires_at<=clock_timestamp() or not private.ticket_call_enabled(c.tenant_id)
    or not exists(select 1 from private.ticket_call_environment where media_enabled)
    or p_room->>'name' is distinct from 'wf-call-'||c.id::text
    or p_room->>'url' is distinct from 'https://wolfforge.daily.co/wf-call-'||c.id::text
    or p_room->>'privacy' is distinct from 'private'
    or (props->>'exp')::numeric is distinct from floor(extract(epoch from c.expires_at))
    or props->>'eject_at_room_exp' is distinct from 'true'
    or props->>'max_participants' is distinct from '2'
    or props->>'enforce_unique_user_ids' is distinct from 'true'
    or props->>'enable_screenshare' is distinct from 'false'
    or props->'permissions'->>'canAdmin' is distinct from 'false'
    or exists(select 1 from jsonb_each(props) setting where setting.key~*'record|transcri|dialout|sip|streaming|rtmp|live_captions'
      and setting.value not in ('false'::jsonb,'null'::jsonb,'[]'::jsonb)
      and not(setting.key='enable_recording' and setting.value='""'::jsonb)) then
    raise exception 'Provider room does not match claim' using errcode='42501'; end if;
  update private.ticket_calls set provider_state='ready' where id=c.id;
  return true;
end $$;

create function public.app_ingest_ticket_call_evidence(p_evidence jsonb,p_complete boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; item jsonb; total numeric; overlap tstzmultirange; end_time timestamptz;
  digest_value text; old_digest text; r private.ticket_call_reservations; actual numeric;
begin
  perform private.ticket_call_lock();
  if octet_length(p_evidence::text)>32768 or p_evidence->>'account' is distinct from 'wolfforge'
    or jsonb_typeof(p_evidence->'intervals') is distinct from 'array' or jsonb_array_length(p_evidence->'intervals')>128
    or length(coalesce(p_evidence->>'eventId','')) not between 1 and 128
    or length(coalesce(p_evidence->>'meetingId','')) not between 1 and 128 then
    raise exception 'Invalid provider evidence' using errcode='22023'; end if;
  select * into c from private.ticket_calls where id=(p_evidence->>'callId')::uuid and not legacy for update;
  end_time:=(p_evidence->>'endedAt')::timestamptz;
  if c.id is null or c.accepted_at is null or c.provider_state='none' or end_time is null
    or end_time<c.accepted_at or end_time>c.expires_at or end_time>clock_timestamp()+interval '5 seconds' then
    raise exception 'Evidence not bound to call' using errcode='42501'; end if;
  digest_value:=encode(extensions.digest(p_evidence::text,'sha256'),'hex');
  select digest into old_digest from private.ticket_call_evidence where event_id=p_evidence->>'eventId';
  if old_digest is not null then
    if old_digest<>digest_value then raise exception 'Evidence replay conflicts' using errcode='22023'; end if;
  else
    insert into private.ticket_call_evidence(call_id,event_id,meeting_id,digest)
      values(c.id,p_evidence->>'eventId',p_evidence->>'meetingId',digest_value);
    for item in select value from jsonb_array_elements(p_evidence->'intervals') loop
      if (item->>'profileId')::uuid is null or not (item->>'profileId')::uuid=any(c.participants)
        or length(coalesce(item->>'sessionId','')) not between 1 and 128
        or (item->>'joinedAt')::timestamptz is null or (item->>'leftAt')::timestamptz is null
        or (item->>'joinedAt')::timestamptz<c.accepted_at
        or (item->>'leftAt')::timestamptz>(end_time)
        or (item->>'leftAt')::timestamptz<=(item->>'joinedAt')::timestamptz then
        raise exception 'Invalid participant evidence' using errcode='22023'; end if;
      insert into private.ticket_call_intervals values(c.id,item->>'sessionId',(item->>'profileId')::uuid,
        (item->>'joinedAt')::timestamptz,(item->>'leftAt')::timestamptz);
    end loop;
  end if;
  select coalesce(sum(extract(epoch from left_at-joined_at)),0) into total from private.ticket_call_intervals where call_id=c.id;
  overlap:=private.ticket_call_overlap(c.id);
  update private.ticket_calls set participant_seconds=total,
    connected_seconds=(select coalesce(sum(extract(epoch from upper(x)-lower(x))),0) from unnest(overlap) x),
    answered_at=(select min(lower(x)) from unnest(overlap) x),
    state=case when state in ('accepted','connecting') and not isempty(overlap) then 'active' else state end,
    outcome=case when not isempty(overlap) then 'answered' else outcome end,
    version=version+1 where id=c.id;
  -- A finished meeting can be followed by another meeting in the same room.
  -- Only a complete post-expiry room reconciliation can release budget holds.
  if p_complete then
    if c.expires_at>clock_timestamp() or end_time>c.expires_at then
      raise exception 'Room lifetime is not complete' using errcode='22023'; end if;
    for r in select * from private.ticket_call_reservations where call_id=c.id loop
      select coalesce(sum(extract(epoch from least(i.left_at,(r.month+interval '1 month') at time zone 'UTC')
        -greatest(i.joined_at,r.month::timestamp at time zone 'UTC'))),0) into actual
        from private.ticket_call_intervals i where i.call_id=c.id
          and i.joined_at<(r.month+interval '1 month') at time zone 'UTC'
          and i.left_at>r.month::timestamp at time zone 'UTC';
      if actual>r.reserved_seconds then raise exception 'Provider use exceeds reservation' using errcode='22023'; end if;
      update private.ticket_call_reservations set settled_seconds=actual where call_id=c.id and month=r.month;
    end loop;
    update private.ticket_calls set reconciled_at=clock_timestamp(),provider_state='ended',state='ended',
      ended_at=greatest(coalesce(ended_at,end_time),end_time),outcome=coalesce(outcome,'expired') where id=c.id;
    delete from private.ticket_call_claims where call_id=c.id;
  end if;
  insert into private.ticket_call_events(call_id,event) values(c.id,case when p_complete then 'usage_reconciled' else 'provider_evidence' end);
  return old_digest is null;
end $$;

create function public.app_claim_ticket_call_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
declare work private.ticket_call_cleanup; batch jsonb:='[]'::jsonb; claim uuid;
begin
  perform private.ticket_call_lock();
  for work in select * from private.ticket_call_cleanup where result<>'verified'
    and (attempted_at is null or attempted_at<clock_timestamp()-interval '1 minute')
    order by call_id limit 10 for update loop
    claim:=extensions.gen_random_uuid();
    update private.ticket_call_cleanup set claim_id=claim,attempted_at=clock_timestamp(),result='claimed' where call_id=work.call_id;
    batch:=batch||jsonb_build_array(jsonb_build_object('id',work.call_id,'claimId',claim,
      'roomName','wf-call-'||work.call_id::text,'reconcileOnly',work.result in ('claimed','unknown')));
  end loop;
  return batch;
end $$;

create function public.app_finish_ticket_call_cleanup(p_call_id uuid,p_claim_id uuid,p_verified boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform private.ticket_call_lock();
  update private.ticket_call_cleanup set result=case when p_verified then 'verified' else 'unknown' end
    where call_id=p_call_id and claim_id=p_claim_id and result='claimed';
  return found;
end $$;

create function private.prune_ticket_call_history() returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.ticket_call_lock();
  delete from private.ticket_calls where id in (select c.id from private.ticket_calls c
    where c.state='ended' and c.ended_at<clock_timestamp()-interval '12 months'
      and c.reconciled_at is not null and not exists(select 1 from private.ticket_call_reservations r where r.call_id=c.id and r.settled_seconds is null)
      and not exists(select 1 from private.ticket_call_cleanup q where q.call_id=c.id and q.result<>'verified')
      and not exists(select 1 from private.ticket_call_claims x where x.call_id=c.id)
    order by c.ended_at limit 100);
  get diagnostics n=row_count;
  delete from cron.job_run_details where jobid in (select jobid from cron.job
    where jobname in ('wf-ticket-calls-deadlines-v1','wf-ticket-calls-retention-v1'))
    and end_time<clock_timestamp()-interval '7 days';
  return n;
end $$;

do $$
declare func record; job record; config record;
begin
  for func in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('ticket_call_overlap','prune_ticket_call_history'))
      or (n.nspname='public' and p.proname in ('app_ticket_call_history','app_ticket_call_owner_summary',
        'app_complete_ticket_call_room','app_ingest_ticket_call_evidence','app_claim_ticket_call_cleanup','app_finish_ticket_call_cleanup')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',func.signature);
  end loop;
  for config in select * from (values
    ('wf-ticket-calls-deadlines-v1','10 seconds','select private.process_ticket_call_deadlines()'),
    ('wf-ticket-calls-retention-v1','23 4 * * *','select private.prune_ticket_call_history()')) x(name,schedule,command) loop
    select * into job from cron.job where jobname=config.name;
    if found then
      if job.schedule<>config.schedule or job.command<>config.command then raise exception 'Call cron job conflicts'; end if;
    else perform cron.schedule(config.name,config.schedule,config.command); end if;
  end loop;
end $$;
grant execute on function public.app_ticket_call_history(uuid,timestamptz,uuid),public.app_ticket_call_owner_summary(date) to authenticated;
grant execute on function public.app_complete_ticket_call_room(uuid,uuid,jsonb),
  public.app_ingest_ticket_call_evidence(jsonb,boolean),public.app_claim_ticket_call_cleanup(),
  public.app_finish_ticket_call_cleanup(uuid,uuid,boolean) to service_role;

create function private.ticket_call_bell_visible(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from private.ticket_calls c where 'ticket-call-missed:'||c.id::text=p_key
  and c.callee_profile_id=auth.uid() and c.tenant_id=private.current_tenant_id()
  and private.ticket_call_profile_allowed(auth.uid(),c.ticket_id,false));
$$;
revoke all on function private.ticket_call_bell_visible(text) from public,anon,authenticated,service_role;
grant execute on function private.ticket_call_bell_visible(text) to authenticated;

create function private.ticket_call_missed_bell() returns trigger
language plpgsql security definer set search_path='' as $$
declare member_class text; company uuid;
begin
  if new.outcome='missed' and old.outcome is distinct from 'missed'
    and private.ticket_call_profile_allowed(new.callee_profile_id,new.ticket_id,false) then
    select m.account_class,t.company_id into member_class,company from public.tenant_memberships m
      join public.tickets t on t.tenant_id=m.tenant_id and t.id=new.ticket_id
      where m.profile_id=new.callee_profile_id and m.archived_at is null;
    insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,
      title,body,href,entity_type,entity_id,actor_profile_id,event_key)
    values(new.callee_profile_id,new.tenant_id,company,member_class,'ticket','Missed call',
      'Open the Ticket conversation to follow up.',case when member_class='client' then '/account/messages/' else '/tickets/' end||new.ticket_id::text,
      'ticket',new.ticket_id,new.initiated_by,'ticket-call-missed:'||new.id::text)
    on conflict(recipient_profile_id,event_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.ticket_call_missed_bell() from public,anon,authenticated,service_role;
create trigger ticket_calls_missed_bell after update of outcome on private.ticket_calls
  for each row execute function private.ticket_call_missed_bell();

create policy ticket_call_bells_current_authority on public.notifications as restrictive
  for select to authenticated using (split_part(event_key,':',1)<>'ticket-call-missed'
    or private.ticket_call_bell_visible(event_key));

-- Call bells remain in-app; existing message push behavior is unchanged.
create or replace function private.enqueue_studio_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if split_part(new.event_key,':',1)='ticket-call-missed'
    or new.audience<>'client' or new.read_at is not null or new.tenant_id is null then return new; end if;
  insert into private.push_deliveries(notification_id,subscription_id,notification_created_at,message_count)
  select new.id,s.id,new.created_at,new.message_count from private.push_subscriptions s
  join private.studio_push_configuration c on c.enabled and c.tenant_id=s.tenant_id and c.origin=s.origin
  where s.profile_id=new.recipient_profile_id and s.tenant_id=new.tenant_id and s.enabled and s.expires_at>now()
  on conflict do nothing;
  if found then perform private.wake_studio_push(); end if;
  return new;
exception when others then
  raise log 'Studio push enqueue unavailable';
  return new;
end;
$$;
-- Accepted commerce/Form activity is written after provisioning/answers/completion.
-- Keep purchase suppression on the earlier generic Order and payment triggers.
create or replace function private.purchase_intake_notification_visible(
  p_profile_id uuid, p_event_key text, p_entity_type text, p_entity_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when split_part(p_event_key, ':', 1)='ticket-call-missed' then private.ticket_call_bell_visible(p_event_key)
    when split_part(p_event_key, ':', 1) not in ('order-purchased', 'intake-submitted') then true
    else exists (
      select 1
      from public.tenant_memberships membership
      join public.tenants tenant on tenant.id = membership.tenant_id
        and tenant.status = 'active' and tenant.archived_at is null
      join public.profiles profile on profile.id = membership.profile_id
        and profile.archived_at is null
      where membership.profile_id = p_profile_id
        and membership.account_class = 'internal' and membership.archived_at is null
        and membership.tenant_id = private.activity_event_parent_tenant_id(p_entity_type, p_entity_id)
        and case
          when p_entity_type = 'order' and p_event_key = 'order-purchased:' || p_entity_id::text then
            private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'projects.view')
            and exists (
              select 1 from public.orders project
              join public.companies company on company.id = project.company_id
                and company.tenant_id = project.tenant_id and company.archived_at is null
              where project.id = p_entity_id and project.archived_at is null
                and (private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'client_private.read')
                  or project.assigned_to_profile_id = p_profile_id
                  or exists (select 1 from public.order_tasks task where task.order_id = project.id
                    and task.assigned_to_profile_id = p_profile_id and task.archived_at is null))
            )
          when p_entity_type = 'form_submission' and p_event_key = 'intake-submitted:' || p_entity_id::text then
            private.tenant_module_allowed(membership.tenant_id, 'forms')
            and private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'forms.view')
            and private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'forms.submissions_view')
            and exists (
              select 1 from public.form_submissions submission
              join public.forms form on form.id = submission.form_id and form.archived_at is null
              join public.form_assignments assignment on assignment.id = submission.form_assignment_id
                and assignment.form_id = form.id and assignment.archived_at is null
              join public.companies company on company.id = submission.company_id
                and company.tenant_id = form.tenant_id and company.archived_at is null
              where submission.id = p_entity_id
            )
          else false
        end
    )
  end;
$$;
