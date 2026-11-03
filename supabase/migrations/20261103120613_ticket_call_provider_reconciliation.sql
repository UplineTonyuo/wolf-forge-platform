-- Trusted provider scans: no scheduler is enabled by this migration.
alter table private.ticket_call_environment add column account_exclusive boolean not null default false,
 add column account_exclusive_verified_at timestamptz;
create or replace function private.ticket_call_enabled(p_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from private.ticket_call_environment env
 join private.ticket_call_settings settings on settings.tenant_id=p_tenant and settings.enabled
 join private.ticket_call_account_usage usage on usage.month=(date_trunc('month',clock_timestamp() at time zone 'UTC'))::date
 where env.enabled and env.verified_at>clock_timestamp()-interval '30 days'
  and env.account_exclusive and env.account_exclusive_verified_at>clock_timestamp()-interval '30 days'
  and usage.verified_at>clock_timestamp()-interval '1 hour' and env.verified_free_minutes>=6000);
$$;
create table private.ticket_call_provider_scans (
 month date primary key, id uuid not null default extensions.gen_random_uuid(),
 cutoff timestamptz not null default clock_timestamp(), cursor uuid,
 lease_until timestamptz not null default '-infinity', completed_at timestamptz,
 unmapped_seconds numeric not null default 0, ongoing boolean not null default false
);
create table private.ticket_call_provider_seen (
 month date not null references private.ticket_call_provider_scans(month) on delete cascade,
 meeting_id uuid not null, call_id uuid, ended_at timestamptz, verified boolean not null,
 primary key(month,meeting_id)
);
alter table private.ticket_call_provider_scans enable row level security;
alter table private.ticket_call_provider_scans force row level security;
alter table private.ticket_call_provider_seen enable row level security;
alter table private.ticket_call_provider_seen force row level security;
revoke all on private.ticket_call_provider_scans,private.ticket_call_provider_seen from public,anon,authenticated,service_role;

create function public.app_claim_ticket_call_provider_scan() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.ticket_call_provider_scans; m date:=(date_trunc('month',clock_timestamp() at time zone 'UTC'))::date;
begin
 perform private.ticket_call_lock();
 -- No periodic provider reads before an operator verifies the calling environment.
 if not exists(select 1 from private.ticket_call_environment where enabled and media_enabled and account_exclusive
  and account_exclusive_verified_at>clock_timestamp()-interval '30 days') then return null; end if;
 insert into private.ticket_call_provider_scans(month) values(m) on conflict do nothing;
 select * into s from private.ticket_call_provider_scans where month=m for update;
 if s.lease_until>clock_timestamp() or s.completed_at>clock_timestamp()-interval '30 minutes' then return null; end if;
 if s.completed_at is not null then
  delete from private.ticket_call_provider_seen where month=m;
  update private.ticket_call_provider_scans set cutoff=clock_timestamp(),cursor=null,completed_at=null,unmapped_seconds=0,ongoing=false where month=m;
 end if;
 update private.ticket_call_provider_scans set id=extensions.gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where month=m returning * into s;
 return jsonb_build_object('id',s.id,'month',s.month,'cutoff',floor(extract(epoch from s.cutoff)),'cursor',s.cursor);
end $$;

create function public.app_apply_ticket_call_provider_page(p_scan_id uuid,p_after uuid,p_meetings jsonb,p_complete boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare s private.ticket_call_provider_scans; m jsonb; p jsonb; c private.ticket_calls;
 begin_at timestamptz; finish_at timestamptz; seconds numeric; intervals jsonb; end_at timestamptz;
 mapped boolean; work record;
begin
 perform private.ticket_call_lock();
 select * into s from private.ticket_call_provider_scans where id=p_scan_id for update;
 if s.id is null or s.lease_until<=clock_timestamp() or s.cursor is distinct from p_after or s.completed_at is not null
  or jsonb_typeof(p_meetings) is distinct from 'array' or jsonb_array_length(p_meetings)>10
  or octet_length(p_meetings::text)>32768 or p_complete is distinct from (jsonb_array_length(p_meetings)<10) then
  raise exception 'Invalid provider page' using errcode='22023'; end if;
 for m in select value from jsonb_array_elements(p_meetings) loop
  if exists(select 1 from private.ticket_call_provider_seen where month=s.month and meeting_id=(m->>'id')::uuid)
   then raise exception 'Repeated provider page' using errcode='22023'; end if;
  c:=null; mapped:=false; intervals:='[]'::jsonb;
  begin_at:=to_timestamp((m->>'start_time')::numeric); finish_at:=begin_at+make_interval(secs=>(m->>'duration')::double precision);
  if (m->>'room')~'^wf-call-[a-f0-9-]{36}$' then
   select * into c from private.ticket_calls where id=substring(m->>'room' from 9)::uuid and not legacy;
  end if;
  if (m->>'ongoing')::boolean then
   update private.ticket_call_provider_scans set ongoing=true where month=s.month;
   if c.id is null then update private.ticket_call_environment set enabled=false,account_exclusive=false; end if;
  else
   mapped:=c.id is not null and c.accepted_at is not null and c.provider_state<>'none'
    and begin_at>=c.accepted_at-interval '15 seconds' and finish_at<=c.expires_at+interval '15 seconds' and finish_at<=s.cutoff
    and jsonb_array_length(m->'participants')>0 and (m->>'max_participants')::integer<=2;
   seconds:=0;
   for p in select value from jsonb_array_elements(m->'participants') loop
    end_at:=to_timestamp((p->>'join_time')::numeric)+make_interval(secs=>(p->>'duration')::double precision);
    seconds:=seconds+greatest(0,extract(epoch from least(end_at,(s.month+interval '1 month') at time zone 'UTC')
     -greatest(to_timestamp((p->>'join_time')::numeric),s.month::timestamp at time zone 'UTC')));
    if coalesce(p->>'user_id','')!~'^[a-f0-9-]{36}$' then mapped:=false;
    elsif c.id is not null and not (p->>'user_id')::uuid=any(c.participants) then mapped:=false; end if;
    if c.id is not null and (to_timestamp((p->>'join_time')::numeric)<c.accepted_at-interval '15 seconds' or end_at>c.expires_at+interval '15 seconds') then mapped:=false; end if;
    if (p->>'duration')::numeric>0 and (c.id is null or least(end_at,c.expires_at)>greatest(to_timestamp((p->>'join_time')::numeric),c.accepted_at)) then
     intervals:=intervals||jsonb_build_array(jsonb_build_object('profileId',p->>'user_id','sessionId',(m->>'id')||':'||(p->>'participant_id'),
      'joinedAt',greatest(to_timestamp((p->>'join_time')::numeric),c.accepted_at),'leftAt',least(end_at,c.expires_at)));
    end if;
   end loop;
   if mapped then
    perform public.app_ingest_ticket_call_evidence(jsonb_build_object('account','wolfforge','callId',c.id,
     'eventId','rest:'||(m->>'id'),'meetingId',m->>'id','endedAt',greatest(c.accepted_at,least(finish_at,c.expires_at)),'intervals',intervals),false);
    -- Coarse history may omit a short participant; it cannot erase stronger live presence evidence.
    if c.answered_at is not null then update private.ticket_calls set answered_at=coalesce(answered_at,c.answered_at) where id=c.id; end if;
   else
    -- Daily history is rounded and can omit short joins. Bound unknown room usage conservatively.
    seconds:=greatest(seconds,greatest(0,extract(epoch from least(finish_at+interval '15 seconds',(s.month+interval '1 month') at time zone 'UTC')
     -greatest(begin_at-interval '15 seconds',s.month::timestamp at time zone 'UTC')))*(m->>'max_participants')::numeric);
    update private.ticket_call_provider_scans set unmapped_seconds=unmapped_seconds+seconds where month=s.month;
    if c.id is null and seconds>0 then
     -- Unattributed current-month usage invalidates the operator's exclusive-account proof.
     update private.ticket_call_environment set enabled=false,account_exclusive=false;
    end if;
   end if;
  end if;
  insert into private.ticket_call_provider_seen values(s.month,(m->>'id')::uuid,c.id,finish_at,mapped);
  update private.ticket_call_provider_scans set cursor=(m->>'id')::uuid where month=s.month;
 end loop;
 if p_complete then
  select * into s from private.ticket_call_provider_scans where month=s.month;
  -- A complete account scan with any ongoing meeting is conservative: do not certify freshness or release holds.
  if not s.ongoing then
   for work in select expired_call.id from private.ticket_calls expired_call
    where expired_call.expires_at<s.cutoff-interval '5 minutes' and expired_call.reconciled_at is null and not expired_call.legacy
     and expired_call.accepted_at is not null and expired_call.provider_state<>'none'
     and exists(select 1 from private.ticket_call_cleanup q where q.call_id=expired_call.id and q.result='verified') loop
    -- History absence cannot prove zero use. Keep the entire reservation as conservative usage.
    update private.ticket_call_reservations set settled_seconds=reserved_seconds where call_id=work.id;
    update private.ticket_calls set state='ended',provider_state='ended',reconciled_at=clock_timestamp(),
     ended_at=coalesce(ended_at,expires_at),outcome=coalesce(outcome,'expired') where id=work.id;
    delete from private.ticket_call_claims where call_id=work.id;
    insert into private.ticket_call_events(call_id,event) values(work.id,'conservative_usage_settled');
   end loop;
   perform public.app_reconcile_ticket_call_account('wolfforge',s.month,s.unmapped_seconds,s.cutoff);
  end if;
  update private.ticket_call_provider_scans set completed_at=clock_timestamp() where month=s.month;
 end if;
 update private.ticket_call_provider_scans set lease_until='-infinity' where month=s.month;
 delete from private.ticket_call_provider_scans where month<s.month-interval '2 months';
 return true;
end $$;
revoke all on function public.app_claim_ticket_call_provider_scan(),public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.app_claim_ticket_call_provider_scan(),public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean) to service_role;

create function public.app_confirm_ticket_call_presence(p_call_id uuid,p_presence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls;
begin
 perform private.ticket_call_lock(); perform private.process_ticket_call_deadlines();
 select * into c from private.ticket_calls where id=p_call_id and not legacy for update;
 if c.id is null or c.state not in ('accepted','connecting','active') or c.expires_at<=clock_timestamp()
  or not private.ticket_call_enabled(c.tenant_id)
  or not private.ticket_call_profile_allowed(c.initiated_by,c.ticket_id,true)
  or not private.ticket_call_profile_allowed(c.callee_profile_id,c.ticket_id,true)
  or not exists(select 1 from auth.sessions where id=c.caller_session_id and user_id=c.initiated_by and (not_after is null or not_after>clock_timestamp()))
  or not exists(select 1 from auth.sessions where id=c.callee_session_id and user_id=c.callee_profile_id and (not_after is null or not_after>clock_timestamp()))
  or p_presence->>'total_count' is distinct from '2' or jsonb_array_length(p_presence->'data')<>2
  or (select count(distinct v->>'id') from jsonb_array_elements(p_presence->'data') v)<>2
  or exists(select 1 from jsonb_array_elements(p_presence->'data') v where v->>'room' is distinct from 'wf-call-'||c.id::text
   or (v->>'userId')::uuid is null or not (v->>'userId')::uuid=any(c.participants))
  or (select count(distinct v->>'userId') from jsonb_array_elements(p_presence->'data') v)<>2
  then raise exception 'Call presence unavailable' using errcode='42501'; end if;
 if c.state<>'active' then
  update private.ticket_calls set state='active',answered_at=coalesce(answered_at,clock_timestamp()),outcome='answered',version=version+1 where id=c.id returning * into c;
 end if;
 return private.ticket_call_projection(c);
end $$;
revoke all on function public.app_confirm_ticket_call_presence(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.app_confirm_ticket_call_presence(uuid,jsonb) to service_role;

create function public.app_ticket_call_media_probe(p_call_id uuid,p_device_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; sid uuid;
begin
 sid:=private.ticket_call_session(); perform private.ticket_call_lock(); perform private.process_ticket_call_deadlines();
 select * into c from private.ticket_calls where id=p_call_id and not legacy;
 if c.id is null or c.tenant_id is distinct from private.current_tenant_id() or not auth.uid()=any(c.participants)
  or c.state not in ('accepted','connecting','active') or c.expires_at<=clock_timestamp()
  or not private.ticket_call_enabled(c.tenant_id) or not exists(select 1 from private.ticket_call_environment where media_enabled)
  or not private.ticket_call_profile_allowed(auth.uid(),c.ticket_id,true)
  or (auth.uid()=c.initiated_by and (sid is distinct from c.caller_session_id or p_device_id is distinct from c.caller_device_id))
  or (auth.uid()=c.callee_profile_id and (sid is distinct from c.callee_session_id or p_device_id is distinct from c.callee_device_id))
  then raise exception 'Call unavailable' using errcode='42501'; end if;
 perform private.consume_rate_limit('ticket-call-media-probe',auth.uid()::text,interval '1 minute',30);
 return jsonb_build_object('id',c.id,'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
end $$;
revoke all on function public.app_ticket_call_media_probe(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_ticket_call_media_probe(uuid,uuid) to authenticated;

-- Two serial cleanup items, each at most five3-second provider operations, leave time for the scan.
create function public.app_ticket_call_prepare(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb; t public.tickets; callee uuid; peer jsonb;
begin
 value:=public.app_ticket_call_current(p_ticket_id,null);
 if value->>'enabled' is distinct from 'true' or value->'call'<>'null'::jsonb then return value; end if;
 select * into t from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id();
 if value->>'accountClass'='client' then
  callee:=t.assigned_to_profile_id;
  if callee is null or not private.ticket_call_profile_allowed(callee,t.id)
   or not exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=callee and account_class='internal' and archived_at is null) then
   select fallback_team_profile_id into callee from private.ticket_call_settings where tenant_id=t.tenant_id;
  end if;
 else callee:=t.client_profile_id; end if;
 if callee is null or callee=auth.uid() or not private.ticket_call_profile_allowed(callee,t.id)
  or (value->>'accountClass'='client' and not exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=callee and account_class='internal' and archived_at is null)) then
  return value||jsonb_build_object('enabled',false);
 end if;
 select jsonb_build_object('name',left(coalesce(nullif(display_name,''),'Wolf Forge participant'),200),'avatarUrl',avatar_url) into peer from public.profiles where id=callee and archived_at is null;
 return value||jsonb_build_object('peer',peer);
end $$;
revoke all on function public.app_ticket_call_prepare(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_ticket_call_prepare(uuid) to authenticated;

create or replace function public.app_claim_ticket_call_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
declare work private.ticket_call_cleanup; batch jsonb:='[]'::jsonb; claim uuid;
begin
 perform private.ticket_call_lock();
 for work in select * from private.ticket_call_cleanup where result<>'verified'
  and (attempted_at is null or attempted_at<clock_timestamp()-interval '1 minute') order by call_id limit 2 for update loop
  claim:=extensions.gen_random_uuid();
  update private.ticket_call_cleanup set claim_id=claim,attempted_at=clock_timestamp(),result='claimed' where call_id=work.call_id;
  batch:=batch||jsonb_build_array(jsonb_build_object('id',work.call_id,'claimId',claim,'roomName','wf-call-'||work.call_id::text,'reconcileOnly',work.result in ('claimed','unknown')));
 end loop;
 return batch;
end $$;
