-- Forward-only manual-end policy. Operator activation remains OFF until scheduled maintenance is verified.
alter table private.ticket_calls
 add column duration_policy text not null default 'fixed' check (duration_policy in ('fixed','manual')),
 add column caller_join_expires_at timestamptz, add column callee_join_expires_at timestamptz,
 add column presence_check_id uuid, add column presence_check_at timestamptz,
 add column peer_absent_since timestamptz,
 add column room_create_pending boolean not null default false;
alter table private.ticket_call_cleanup add column media_empty_at timestamptz;
alter table private.ticket_call_environment add column manual_end_enabled boolean not null default false,
 add column manual_maintenance_at timestamptz;
-- A month can contain at most two participants for 31 days; estimates remain finite.
alter table private.ticket_call_reservations drop constraint ticket_call_reservations_reserved_seconds_check;
alter table private.ticket_call_reservations add constraint ticket_call_reservations_reserved_seconds_check
 check (reserved_seconds>0 and reserved_seconds<=5356800);

create function private.active_ticket_call_enabled(c private.ticket_calls) returns boolean
language sql stable security definer set search_path='' as $$
 select case when c.duration_policy='manual' and c.state='active' then exists(
  select 1 from private.ticket_call_environment e join private.ticket_call_settings s on s.tenant_id=c.tenant_id
  where e.enabled and e.media_enabled and s.enabled)
 else private.ticket_call_enabled(c.tenant_id) end;
$$;

create function private.accrue_manual_call_holds() returns void
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; slice record; stamp timestamptz:=clock_timestamp();
begin
 perform private.ticket_call_lock();
 for c in select * from private.ticket_calls where duration_policy='manual' and not legacy
  and reconciled_at is null and provider_state<>'none' loop
  -- Unknown termination keeps accruing a conservative hold until a complete trusted scan.
  for slice in select * from private.ticket_call_month_slices(c.created_at,greatest(c.expires_at,stamp)) loop
   insert into private.ticket_call_reservations(call_id,month,reserved_seconds) values(c.id,slice.month,slice.seconds)
   on conflict(call_id,month) do update set reserved_seconds=greatest(private.ticket_call_reservations.reserved_seconds,excluded.reserved_seconds);
  end loop;
 end loop;
 perform private.ticket_call_record_budget_alerts(date_trunc('month',stamp at time zone 'UTC')::date);
end $$;

create function private.manual_call_budget_warning(p_tenant uuid) returns integer
language sql stable security definer set search_path='' as $$
 with usage as (select coalesce(sum(coalesce(r.settled_seconds,r.reserved_seconds)),0) total,
  coalesce(sum(coalesce(r.settled_seconds,r.reserved_seconds)) filter(where c.tenant_id=p_tenant),0) own
  from private.ticket_call_reservations r join private.ticket_calls c on c.id=r.call_id
  where r.month=date_trunc('month',clock_timestamp() at time zone 'UTC')::date),
 ratio as(select greatest(100*(usage.total+coalesce(a.unmapped_seconds,0))/(e.allocation_minutes*60),
  100*usage.own/(s.monthly_minutes*60)) pct from usage cross join private.ticket_call_environment e
  join private.ticket_call_settings s on s.tenant_id=p_tenant
  left join private.ticket_call_account_usage a on a.month=date_trunc('month',clock_timestamp() at time zone 'UTC')::date)
 select case when pct>=100 then 100 when pct>=90 then 90 when pct>=75 then 75 end from ratio;
$$;
revoke all on function private.active_ticket_call_enabled(private.ticket_calls),private.accrue_manual_call_holds(),
 private.manual_call_budget_warning(uuid) from public,anon,authenticated,service_role;

create or replace function private.ticket_call_enabled(p_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from private.ticket_call_environment env
 join private.ticket_call_settings settings on settings.tenant_id=p_tenant and settings.enabled
 join private.ticket_call_account_usage usage on usage.month=(date_trunc('month',clock_timestamp() at time zone 'UTC'))::date
 where env.enabled and env.verified_at>clock_timestamp()-interval '30 days'
  and env.account_exclusive and env.account_exclusive_verified_at>clock_timestamp()-interval '30 days'
  and (not env.manual_end_enabled or env.manual_maintenance_at>clock_timestamp()-interval '10 minutes')
  and usage.verified_at>clock_timestamp()-interval '1 hour' and env.verified_free_minutes>=6000);
$$;

create or replace function private.ticket_call_projection(c private.ticket_calls) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',c.id,'ticketId',c.ticket_id,'orderId',coalesce(c.order_id,(select order_id from public.tickets where id=c.ticket_id)),'callerId',c.initiated_by,
  'calleeId',c.callee_profile_id,'mode',c.mode,'direction',c.direction,'state',c.state,
  'requestedAt',c.created_at,'ringDeadline',c.ring_deadline,'acceptedAt',c.accepted_at,
  'answeredAt',c.answered_at,'endedAt',c.ended_at,'expiresAt',c.expires_at,
  'durationPolicy',c.duration_policy,'budgetWarning',case when c.duration_policy='manual' and exists(
    select 1 from public.tenant_memberships m where m.tenant_id=c.tenant_id and m.profile_id=auth.uid()
      and m.account_class='internal' and m.archived_at is null) then private.manual_call_budget_warning(c.tenant_id) end,
  'outcome',c.outcome,'reason',c.reason,'version',c.version,
  'connectedSeconds',c.connected_seconds,'participantSeconds',c.participant_seconds,
  'reconciled',c.reconciled_at is not null,
  'message',case when c.outcome='busy' then 'busy'
    when c.outcome='refused' then 'Please send a message instead' else null end);
$$;

create or replace function private.request_conversation_call(p_ticket_id uuid,p_order_id uuid,p_request_id uuid,p_device_id uuid,p_mode text,p_recipient_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t record; c private.ticket_calls; settings private.ticket_call_settings; env private.ticket_call_environment;
  sid uuid; callee uuid; direction_value text; stamp timestamptz; refusal text; slice record;
  used numeric; tenant_used numeric; new_id uuid:=extensions.gen_random_uuid();
begin
  sid:=private.ticket_call_session();
  perform private.consume_rate_limit('ticket-call-request',auth.uid()::text,interval '1 minute',60);
  -- Avoid shared sweeps for already exhausted fresh-record requests. No row locks here.
  if p_request_id is not null
    and exists(select 1 from private.conversation_call_target(p_ticket_id,p_order_id))
    and private.ticket_call_enabled(private.current_tenant_id())
    and exists(select 1 from private.conversation_call_target(p_ticket_id,p_order_id) target where private.conversation_call_profile_allowed(auth.uid(),target.ticket_id,target.order_id))
    and not exists(select 1 from private.ticket_calls where tenant_id=private.current_tenant_id()
      and initiated_by=auth.uid() and request_id=p_request_id)
    and not private.ticket_call_history_available(auth.uid(),clock_timestamp()) then
    raise exception 'Call history limit reached' using errcode='WF429'; end if;
  perform private.ticket_call_lock();
  perform private.process_ticket_call_deadlines(); perform private.accrue_manual_call_holds(); stamp:=clock_timestamp();
  if p_request_id is null or p_device_id is null or p_mode is null or p_mode not in ('audio','video') then
    raise exception 'Invalid call request' using errcode='22023'; end if;
  select * into t from private.conversation_call_target(p_ticket_id,p_order_id);
  if t.id is null then raise exception 'Call unavailable' using errcode='42501'; end if;
  if t.ticket_id is not null then perform 1 from public.tickets where id=t.ticket_id for share;
  else perform 1 from public.orders where id=t.order_id for share; end if;
  select * into t from private.conversation_call_target(p_ticket_id,p_order_id);
  if t.id is null or not private.conversation_call_profile_allowed(auth.uid(),t.ticket_id,t.order_id) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if not private.ticket_call_enabled(t.tenant_id) then raise exception 'Calls disabled' using errcode='42501'; end if;
  select * into c from private.ticket_calls where tenant_id=t.tenant_id and initiated_by=auth.uid() and request_id=p_request_id;
  if c.id is not null then
    if c.ticket_id is distinct from t.ticket_id or c.order_id is distinct from t.order_id or c.mode<>p_mode or c.caller_session_id<>sid or c.caller_device_id<>p_device_id or (p_recipient_id is not null and c.callee_profile_id is distinct from p_recipient_id) or (c.direction='client_to_team' and p_recipient_id is null) then
      raise exception 'Call request conflicts' using errcode='22023'; end if;
    if c.state<>'ended' and c.direction='client_to_team' and not private.conversation_call_recipient_allowed(c.callee_profile_id,t.ticket_id,t.order_id) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    return private.ticket_call_projection(c);
  end if;
  -- Exact-request replay above remains available; every new durable outcome counts.
  if not private.ticket_call_history_available(auth.uid(),stamp) then
    raise exception 'Call history limit reached' using errcode='WF429'; end if;
  perform private.consume_rate_limit('ticket-call-invite',auth.uid()::text,interval '1 minute',12);
  perform private.consume_rate_limit('ticket-call-provider-global','daily',interval '1 minute',60);
  select * into settings from private.ticket_call_settings where tenant_id=t.tenant_id;
  select * into env from private.ticket_call_environment;
  if exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=auth.uid() and account_class='client') then
    direction_value:='client_to_team'; callee:=p_recipient_id;
    if callee is null or callee=auth.uid() or not private.conversation_call_recipient_allowed(callee,t.ticket_id,t.order_id) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    if t.ticket_id is not null then
      perform 1 from private.ticket_inbox_memberships where ticket_id=t.ticket_id and profile_id=callee for share;
      if not found then raise exception 'Call unavailable' using errcode='42501'; end if;
    else
      perform 1 from public.orders where id=t.order_id for share;
      perform 1 from public.order_tasks where order_id=t.order_id and assigned_to_profile_id=callee and archived_at is null for share;
      if not private.conversation_call_recipient_allowed(callee,null,t.order_id) then
        raise exception 'Call unavailable' using errcode='42501'; end if;
    end if;
  else
    direction_value:='team_to_client'; callee:=case when t.order_id is null then t.client_profile_id else p_recipient_id end;
    if t.order_id is not null and not exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=callee and account_class='client' and company_id=t.company_id and archived_at is null) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    if p_recipient_id is not null and p_recipient_id is distinct from callee then
      raise exception 'Call unavailable' using errcode='42501'; end if;
  end if;
  if callee is null or callee=auth.uid() or not private.conversation_call_profile_allowed(callee,t.ticket_id,t.order_id)
    or (direction_value='client_to_team' and not exists(select 1 from public.tenant_memberships
      where tenant_id=t.tenant_id and profile_id=callee and account_class='internal' and archived_at is null)) then
    refusal:='refused'; callee:=null;
  elsif exists(select 1 from private.ticket_call_claims where profile_id in (auth.uid(),callee))
    or exists(select 1 from private.ticket_calls live where not live.legacy and live.state<>'ended'
      and live.ticket_id is not distinct from t.ticket_id and live.order_id is not distinct from t.order_id) then refusal:='busy';
  end if;
  if refusal is null and ((select count(*) from private.ticket_calls where not legacy and initiated_by=auth.uid()
      and created_at>=stamp-interval '1 day' and outcome is distinct from 'busy' and outcome is distinct from 'refused')>=6
    or (select count(*) from private.ticket_calls where (expires_at>stamp or (duration_policy='manual' and (state<>'ended' or (provider_state<>'none' and reconciled_at is null)))) and (legacy or outcome is null or outcome not in ('busy','refused')))>=4
    or (select count(*) from private.ticket_calls where (expires_at>(date_trunc('month',stamp at time zone 'UTC') at time zone 'UTC') or (duration_policy='manual' and (state<>'ended' or (provider_state<>'none' and reconciled_at is null))))
      and (legacy or outcome is null or outcome not in ('busy','refused')))>=200) then refusal:='refused'; end if;
  if refusal is null then
    for slice in select * from private.ticket_call_month_slices(stamp,stamp+interval '15 minutes') loop
      select coalesce(sum(coalesce(r.settled_seconds,r.reserved_seconds)),0),
        coalesce(sum(coalesce(r.settled_seconds,r.reserved_seconds)) filter(where call.tenant_id=t.tenant_id),0)
        into used,tenant_used from private.ticket_call_reservations r join private.ticket_calls call on call.id=r.call_id
        where r.month=slice.month;
      used:=used+coalesce((select unmapped_seconds from private.ticket_call_account_usage where month=slice.month),0);
      if used+slice.seconds>env.allocation_minutes*60 or tenant_used+slice.seconds>settings.monthly_minutes*60 then refusal:='refused'; exit; end if;
    end loop;
  end if;
  insert into private.ticket_calls(id,request_id,ticket_id,order_id,tenant_id,initiated_by,callee_profile_id,direction,mode,
    participants,created_at,expires_at,state,caller_session_id,caller_device_id,ring_deadline,outcome,reason,ended_at,reconciled_at,duration_policy)
  values(new_id,p_request_id,t.ticket_id,t.order_id,t.tenant_id,auth.uid(),callee,direction_value,p_mode,
    case when callee is null then array[auth.uid()] else array[auth.uid(),callee] end,
    stamp,stamp+interval '15 minutes',case when refusal is null then 'ringing' else 'ended' end,
    sid,p_device_id,stamp+interval '40 seconds',refusal,refusal,
    case when refusal is not null then stamp end,case when refusal is not null then stamp end,case when env.manual_end_enabled then 'manual' else 'fixed' end) returning * into c;
  if refusal is null then
    insert into private.ticket_call_claims(profile_id,call_id) values(auth.uid(),c.id),(callee,c.id);
    insert into private.ticket_call_reservations(call_id,month,reserved_seconds)
      select c.id,month,seconds from private.ticket_call_month_slices(stamp,c.expires_at);
  end if;
  perform private.ticket_call_record_budget_alerts((date_trunc('month',stamp at time zone 'UTC'))::date);
  insert into private.ticket_call_events(call_id,event,actor_id) values(c.id,coalesce(refusal,'requested'),auth.uid());
  return private.ticket_call_projection(c);
end $$;

create or replace function private.process_ticket_call_deadlines() returns integer
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; n integer:=0; stamp timestamptz;
begin
  perform private.ticket_call_lock(); stamp:=clock_timestamp();
  for c in select * from private.ticket_calls where not legacy and state<>'ended'
    order by created_at limit 100 for update loop
    if not private.active_ticket_call_enabled(c)
      or not private.conversation_call_profile_allowed(c.initiated_by,c.ticket_id,c.order_id)
      or not private.conversation_call_profile_allowed(c.callee_profile_id,c.ticket_id,c.order_id)
      or (c.direction='client_to_team' and not private.conversation_call_recipient_allowed(c.callee_profile_id,c.ticket_id,c.order_id))
      or not exists(select 1 from auth.sessions where id=c.caller_session_id and user_id=c.initiated_by
        and (not_after is null or not_after>stamp))
      or (c.callee_session_id is not null and not exists(select 1 from auth.sessions
        where id=c.callee_session_id and user_id=c.callee_profile_id and (not_after is null or not_after>stamp))) then
      perform private.finish_ticket_call(c.id,'expired','authority_revoked',stamp); n:=n+1;
    elsif c.state='ringing' and c.ring_deadline<=stamp then
      perform private.finish_ticket_call(c.id,'missed','ring_timeout',c.ring_deadline); n:=n+1;
    elsif c.expires_at<=stamp and not(c.duration_policy='manual' and c.state='active') then
      perform private.finish_ticket_call(c.id,'expired','room_expired',c.expires_at); n:=n+1;
    elsif c.state in ('accepted','connecting') and c.connect_deadline<=stamp then
      perform private.finish_ticket_call(c.id,'expired','connect_timeout',c.connect_deadline); n:=n+1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.app_ticket_call_command(p_action text,p_call_id uuid,p_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; sid uuid; stamp timestamptz; claim uuid; join_expiry timestamptz;
begin
  sid:=private.ticket_call_session();
  if p_action is null or p_action not in ('status','accept','decline','cancel','end','setup','join') then
    raise exception 'Invalid call operation' using errcode='22023'; end if;
  if p_action in ('end','cancel') then
    perform private.consume_rate_limit('ticket-call-end',auth.uid()::text,interval '1 minute',12);
  else
    perform private.consume_rate_limit('ticket-call-command',auth.uid()::text,interval '1 minute',120);
  end if;
  perform private.ticket_call_lock();
  select * into c from private.ticket_calls where id=p_call_id and not legacy for update;
  if c.id is null or not auth.uid()=any(c.participants) then raise exception 'Call unavailable' using errcode='42501'; end if;
  -- Cleanup intentionally precedes Tenant, Ticket, module and calling-flag gates.
  if p_action in ('cancel','end') then
    if p_action='cancel' and auth.uid()<>c.initiated_by then raise exception 'Call unavailable' using errcode='42501'; end if;
    if c.state='ringing' and c.ring_deadline<=clock_timestamp() then
      perform private.finish_ticket_call(c.id,'missed','ring_timeout',c.ring_deadline);
    else
      perform private.finish_ticket_call(c.id,'expired','participant_ended',clock_timestamp());
    end if;
    return jsonb_build_object('ended',true);
  end if;
  perform private.process_ticket_call_deadlines();
  select * into c from private.ticket_calls where id=p_call_id;
  if c.tenant_id is distinct from private.current_tenant_id() or not private.active_ticket_call_enabled(c)
    or not private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id) then raise exception 'Call unavailable' using errcode='42501'; end if;
  if p_action='status' then
    perform private.accrue_manual_call_holds();
    perform private.consume_rate_limit('ticket-call-status',auth.uid()::text,interval '1 minute',120);
    return private.ticket_call_projection(c);
  end if;
  stamp:=clock_timestamp();
  if p_action='decline' then
    if auth.uid()<>c.callee_profile_id or c.state<>'ringing' then raise exception 'Call unavailable' using errcode='42501'; end if;
    perform private.finish_ticket_call(c.id,'declined','callee_declined',stamp);
  elsif p_action='accept' then
    if p_device_id is null or auth.uid()<>c.callee_profile_id then raise exception 'Call unavailable' using errcode='42501'; end if;
    if c.state<>'ringing' then
      if c.state in ('accepted','connecting','active') and c.callee_session_id=sid and c.callee_device_id=p_device_id then
        return private.ticket_call_projection(c);
      end if;
      raise exception 'Call already taken or ended' using errcode='42501';
    end if;
    if stamp>=c.ring_deadline then raise exception 'Call expired' using errcode='42501'; end if;
    update private.ticket_calls set state='accepted',callee_session_id=sid,callee_device_id=p_device_id,
      accepted_at=stamp,connect_deadline=least(stamp+interval '45 seconds',expires_at),version=version+1 where id=c.id;
    insert into private.ticket_call_events(call_id,event,actor_id) values(c.id,'accepted',auth.uid());
  else
    if p_device_id is null or c.state not in ('accepted','connecting','active') or (c.expires_at<=stamp and not(c.duration_policy='manual' and c.state='active'))
      or not exists(select 1 from private.ticket_call_environment where enabled and media_enabled)
      or (auth.uid()=c.initiated_by and (sid<>c.caller_session_id or p_device_id<>c.caller_device_id))
      or (auth.uid()=c.callee_profile_id and (sid is distinct from c.callee_session_id or p_device_id is distinct from c.callee_device_id)) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    if p_action='setup' then
      if c.token_attempts>=8 or c.provider_state not in ('none','claimed','ready') then
        raise exception 'Call unavailable' using errcode='42501'; end if;
      -- Reject an already exhausted join window before any provider lookup claim.
      if exists(select 1 from private.rate_limit_counters where scope='ticket-call-token' and subject=auth.uid()::text
        and window_start=to_timestamp(floor(extract(epoch from stamp)/60)*60) and hits>=6) then
        raise exception 'rate limit exceeded' using errcode='WF429'; end if;
      perform private.consume_rate_limit('ticket-call-provider-actor',auth.uid()::text,interval '1 minute',12);
      if c.provider_state='none' then
        claim:=extensions.gen_random_uuid();
        update private.ticket_calls set state='connecting',provider_state='claimed',room_claim_id=claim,
          room_create_pending=duration_policy='manual',version=version+1 where id=c.id;
      end if;
      if c.duration_policy='manual' then
        join_expiry:=clock_timestamp()+interval '120 seconds';
        update private.ticket_calls set caller_join_expires_at=case when auth.uid()=initiated_by then join_expiry else caller_join_expires_at end,
          callee_join_expires_at=case when auth.uid()=callee_profile_id then join_expiry else callee_join_expires_at end where id=c.id;
      else join_expiry:=c.expires_at; end if;
      return jsonb_build_object('id',c.id,'ready',c.provider_state='ready','created',claim is not null,'claimId',coalesce(claim,c.room_claim_id),
        'roomName','wf-call-'||c.id::text,'mode',c.mode,'durationPolicy',c.duration_policy,'expiresAt',join_expiry);
    end if;
    if c.provider_state<>'ready' or c.token_attempts>=8 then raise exception 'Call unavailable' using errcode='42501'; end if;
    join_expiry:=case when c.duration_policy='manual' then case when auth.uid()=c.initiated_by then c.caller_join_expires_at else c.callee_join_expires_at end else c.expires_at end;
    if join_expiry is null or join_expiry<=clock_timestamp() then raise exception 'Call unavailable' using errcode='42501'; end if;
    perform private.consume_rate_limit('ticket-call-token',auth.uid()::text,interval '1 minute',6);
    update private.ticket_calls set token_attempts=token_attempts+1 where id=c.id;
    return jsonb_build_object('id',c.id,'participantId',auth.uid(),'roomName','wf-call-'||c.id::text,'mode',c.mode,'durationPolicy',c.duration_policy,'expiresAt',join_expiry);
  end if;
  select * into c from private.ticket_calls where id=p_call_id;
  return private.ticket_call_projection(c);
end $$;

create or replace function public.app_confirm_ticket_call_presence(p_call_id uuid,p_presence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls;
begin
 perform private.ticket_call_lock(); perform private.process_ticket_call_deadlines();
 select * into c from private.ticket_calls where id=p_call_id and not legacy for update;
 if c.id is null or c.state not in ('accepted','connecting','active') or (c.expires_at<=clock_timestamp() and not(c.duration_policy='manual' and c.state='active'))
  or not private.active_ticket_call_enabled(c)
  or not private.conversation_call_profile_allowed(c.initiated_by,c.ticket_id,c.order_id,true)
  or not private.conversation_call_profile_allowed(c.callee_profile_id,c.ticket_id,c.order_id,true)
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

create or replace function public.app_ticket_call_media_probe(p_call_id uuid,p_device_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; sid uuid;
begin
 sid:=private.ticket_call_session(); perform private.ticket_call_lock(); perform private.process_ticket_call_deadlines();
 select * into c from private.ticket_calls where id=p_call_id and not legacy;
 if c.id is null or c.tenant_id is distinct from private.current_tenant_id() or not auth.uid()=any(c.participants)
  or c.state not in ('accepted','connecting','active') or (c.expires_at<=clock_timestamp() and not(c.duration_policy='manual' and c.state='active'))
  or not private.active_ticket_call_enabled(c) or not exists(select 1 from private.ticket_call_environment where media_enabled)
  or not private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id,true)
  or (auth.uid()=c.initiated_by and (sid is distinct from c.caller_session_id or p_device_id is distinct from c.caller_device_id))
  or (auth.uid()=c.callee_profile_id and (sid is distinct from c.callee_session_id or p_device_id is distinct from c.callee_device_id))
  then raise exception 'Call unavailable' using errcode='42501'; end if;
 perform private.consume_rate_limit('ticket-call-media-probe',auth.uid()::text,interval '1 minute',30);
 return jsonb_build_object('id',c.id,'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
end $$;

create or replace function private.conversation_call_current(p_ticket_id uuid default null,p_call_id uuid default null,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target record; sid uuid; tenant uuid; account text; c private.ticket_calls; peer jsonb; allowed boolean;
begin
  sid:=private.ticket_call_session(); tenant:=private.current_tenant_id();
  if num_nonnulls(p_ticket_id,p_order_id,p_call_id)>1 then raise exception 'Invalid target' using errcode='22023'; end if;
  if p_order_id is not null then
    select * into target from private.conversation_call_target(null,p_order_id);
    if target.id is null then raise exception 'Call unavailable' using errcode='42501'; end if;
    p_ticket_id:=target.ticket_id; p_order_id:=target.order_id;
  end if;
  select m.account_class into account from public.tenant_memberships m
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    join public.tenants t on t.id=m.tenant_id and t.status='active' and t.archived_at is null
    where m.tenant_id=tenant and m.profile_id=auth.uid() and m.archived_at is null;
  if account is null or account not in ('internal','client') or (p_ticket_id is not null and p_call_id is not null) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  perform private.consume_rate_limit('ticket-call-current',auth.uid()::text,interval '1 minute',60);
  if (p_ticket_id is not null or p_order_id is not null) and not private.conversation_call_profile_allowed(auth.uid(),p_ticket_id,p_order_id,false) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if p_call_id is not null then
    select * into c from private.ticket_calls where id=p_call_id and tenant_id=tenant
      and not legacy and auth.uid()=any(participants);
  else
    select call.* into c from private.ticket_call_claims claim join private.ticket_calls call on call.id=claim.call_id
      where claim.profile_id=auth.uid() and call.tenant_id=tenant and not call.legacy
        and call.state<>'ended' and ((p_ticket_id is null and p_order_id is null) or (p_ticket_id is not null and call.ticket_id=p_ticket_id) or (p_order_id is not null and call.order_id=p_order_id));
  end if;
  if c.id is not null then
    if not private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id,false) then c:=null;
    else
      perform private.process_ticket_call_deadlines(); perform private.accrue_manual_call_holds();
      select * into c from private.ticket_calls where id=c.id;
      peer:=private.ticket_call_person(case when c.initiated_by=auth.uid() then c.callee_profile_id else c.initiated_by end,c.tenant_id);
    end if;
  end if;
  allowed:=(case when c.id is not null then private.active_ticket_call_enabled(c) else private.ticket_call_enabled(tenant) end) and
    (case when c.id is not null then private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id)
      when p_ticket_id is not null or p_order_id is not null then private.conversation_call_profile_allowed(auth.uid(),p_ticket_id,p_order_id,true) else
        private.profile_has_permission_in_tenant(auth.uid(),tenant,'tickets.reply') end);
  return jsonb_build_object('enabled',allowed,'profileId',auth.uid(),'accountClass',account,
    'call',case when c.id is null then null else private.ticket_call_projection(c) end,
    'peer',peer,'ticketId',coalesce(c.ticket_id,p_ticket_id),'orderId',coalesce(c.order_id,p_order_id,(select order_id from public.tickets where id=coalesce(c.ticket_id,p_ticket_id))));
end $$;

create or replace function public.app_complete_ticket_call_room(p_call_id uuid,p_claim_id uuid,p_room jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; props jsonb;
begin
  perform private.ticket_call_lock(); perform private.process_ticket_call_deadlines();
  select * into c from private.ticket_calls where id=p_call_id and not legacy for update;
  props:=p_room->'config';
  if c.id is null or p_claim_id is null or c.room_claim_id is distinct from p_claim_id
    or p_room->>'name' is distinct from 'wf-call-'||c.id::text
    or p_room->>'url' is distinct from 'https://wolfforge.daily.co/wf-call-'||c.id::text
    or p_room->>'privacy' is distinct from 'private'
    or (case when c.duration_policy='fixed' then
      (props->>'exp')::numeric is distinct from floor(extract(epoch from c.expires_at)) or props->>'eject_at_room_exp' is distinct from 'true'
      else (props->>'exp') is not null or props->>'eject_at_room_exp' is distinct from 'false' or props->>'eject_after_elapsed' is not null end)
    or props->>'max_participants' is distinct from '2'
    or props->>'enforce_unique_user_ids' is distinct from 'true'
    or props->>'enable_screenshare' is distinct from 'false'
    or props->'permissions'->>'canAdmin' is distinct from 'false'
    or exists(select 1 from jsonb_each(props) setting where setting.key~*'record|transcri|dialout|sip|streaming|rtmp|live_captions'
      and setting.value not in ('false'::jsonb,'null'::jsonb,'[]'::jsonb)
      and not(setting.key='enable_recording' and setting.value='""'::jsonb)) then
    raise exception 'Provider room does not match claim' using errcode='42501'; end if;
  if c.duration_policy='manual' then
    update private.ticket_calls set room_create_pending=false where id=c.id;
    if c.state='ended' then
      -- A late create must reopen cleanup, never disappear behind an earlier absence read.
      insert into private.ticket_call_cleanup(call_id) values(c.id) on conflict(call_id) do update
        set result='pending',claim_id=null,attempted_at=null,media_empty_at=null;
      return false;
    end if;
  end if;
  if c.state not in ('connecting','active')
    or (c.expires_at<=clock_timestamp() and not(c.duration_policy='manual' and c.state='active'))
    or not private.active_ticket_call_enabled(c)
    or not exists(select 1 from private.ticket_call_environment where media_enabled) then
    raise exception 'Provider room does not match claim' using errcode='42501'; end if;
  update private.ticket_calls set provider_state='ready' where id=c.id;
  return true;
end $$;

create or replace function public.app_ingest_ticket_call_evidence(p_evidence jsonb,p_complete boolean default false)
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
    or end_time<c.accepted_at or (c.duration_policy='fixed' and end_time>c.expires_at) or end_time>clock_timestamp()+interval '5 seconds' then
    raise exception 'Evidence not bound to call' using errcode='42501'; end if;
  digest_value:=encode(extensions.digest(p_evidence::text,'sha256'),'hex');
  select digest into old_digest from private.ticket_call_evidence where event_id=p_evidence->>'eventId';
  if old_digest is not null then
    if old_digest<>digest_value then raise exception 'Evidence replay conflicts' using errcode='22023'; end if;
    if not coalesce(p_complete,false) then return false; end if;
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
    if (c.duration_policy='fixed' and (c.expires_at>clock_timestamp() or end_time>c.expires_at))
      or (c.duration_policy='manual' and (c.state<>'ended' or not exists(select 1 from private.ticket_call_cleanup q where q.call_id=c.id and q.result='verified'))) then
      raise exception 'Room lifetime is not complete' using errcode='22023'; end if;
    perform private.accrue_manual_call_holds();
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

create or replace function public.app_apply_ticket_call_provider_page(p_scan_id uuid,p_after uuid,p_meetings jsonb,p_complete boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare s private.ticket_call_provider_scans; m jsonb; p jsonb; c private.ticket_calls;
 begin_at timestamptz; finish_at timestamptz; seconds numeric; intervals jsonb; end_at timestamptz;
 mapped boolean; work record; reservation private.ticket_call_reservations; actual numeric;
begin
 perform private.ticket_call_lock(); perform private.accrue_manual_call_holds();
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
    and begin_at>=c.accepted_at-interval '15 seconds' and (c.duration_policy='manual' or finish_at<=c.expires_at+interval '15 seconds') and finish_at<=s.cutoff
    and jsonb_array_length(m->'participants')>0 and (m->>'max_participants')::integer<=2;
   seconds:=0;
   for p in select value from jsonb_array_elements(m->'participants') loop
    end_at:=to_timestamp((p->>'join_time')::numeric)+make_interval(secs=>(p->>'duration')::double precision);
    seconds:=seconds+greatest(0,extract(epoch from least(end_at,(s.month+interval '1 month') at time zone 'UTC')
     -greatest(to_timestamp((p->>'join_time')::numeric),s.month::timestamp at time zone 'UTC')));
    if coalesce(p->>'user_id','')!~'^[a-f0-9-]{36}$' then mapped:=false;
    elsif c.id is not null and not (p->>'user_id')::uuid=any(c.participants) then mapped:=false; end if;
    if c.id is not null and (to_timestamp((p->>'join_time')::numeric)<c.accepted_at-interval '15 seconds' or end_at>s.cutoff or (c.duration_policy='fixed' and end_at>c.expires_at+interval '15 seconds')) then mapped:=false; end if;
    if (p->>'duration')::numeric>0 and (c.id is null or case when c.duration_policy='manual' then end_at else least(end_at,c.expires_at) end>greatest(to_timestamp((p->>'join_time')::numeric),c.accepted_at)) then
     intervals:=intervals||jsonb_build_array(jsonb_build_object('profileId',p->>'user_id','sessionId',(m->>'id')||':'||(p->>'participant_id'),
      'joinedAt',greatest(to_timestamp((p->>'join_time')::numeric),c.accepted_at),'leftAt',case when c.duration_policy='manual' then end_at else least(end_at,c.expires_at) end));
    end if;
   end loop;
   if mapped then
    perform public.app_ingest_ticket_call_evidence(jsonb_build_object('account','wolfforge','callId',c.id,
     'eventId','rest:'||(m->>'id'),'meetingId',m->>'id','endedAt',greatest(c.accepted_at,case when c.duration_policy='manual' then finish_at else least(finish_at,c.expires_at) end),'intervals',intervals),false);
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
   for work in select expired_call.id,expired_call.duration_policy from private.ticket_calls expired_call
    where ((expired_call.duration_policy='fixed' and expired_call.expires_at<s.cutoff-interval '5 minutes') or (expired_call.duration_policy='manual' and expired_call.state='ended' and expired_call.ended_at<s.cutoff-interval '5 minutes')) and expired_call.reconciled_at is null and not expired_call.legacy
     and expired_call.accepted_at is not null and expired_call.provider_state<>'none'
     and exists(select 1 from private.ticket_call_cleanup q where q.call_id=expired_call.id and q.result='verified') loop
    -- History absence cannot prove zero use. Keep the entire reservation as conservative usage.
    if work.duration_policy='manual'
      and exists(select 1 from private.ticket_call_provider_seen v where v.month=s.month and v.call_id=work.id and v.verified)
      and not exists(select 1 from private.ticket_call_provider_seen v where v.month=s.month and v.call_id=work.id and not v.verified) then
      for reservation in select * from private.ticket_call_reservations where call_id=work.id loop
        select coalesce(sum(extract(epoch from least(i.left_at,(reservation.month+interval '1 month') at time zone 'UTC')
          -greatest(i.joined_at,reservation.month::timestamp at time zone 'UTC'))),0) into actual
          from private.ticket_call_intervals i where i.call_id=work.id
            and i.joined_at<(reservation.month+interval '1 month') at time zone 'UTC'
            and i.left_at>reservation.month::timestamp at time zone 'UTC';
        update private.ticket_call_reservations set reserved_seconds=greatest(reserved_seconds,actual),settled_seconds=actual
          where call_id=work.id and month=reservation.month;
      end loop;
    else
      update private.ticket_call_reservations set settled_seconds=reserved_seconds where call_id=work.id;
    end if;
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

-- Independent backend checks: no browser liveness or provider expiry is treated as a meeting end.
create function public.app_claim_manual_call_checks() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; batch jsonb:='[]'; claim uuid; stamp timestamptz;
begin
 perform private.ticket_call_lock(); stamp:=clock_timestamp();
 perform private.process_ticket_call_deadlines(); perform private.accrue_manual_call_holds();
 update private.ticket_call_environment set manual_maintenance_at=stamp;
 for c in select * from private.ticket_calls where duration_policy='manual' and state='active'
  and (presence_check_at is null or presence_check_at<stamp-interval '1 minute') order by presence_check_at nulls first limit 2 for update loop
  claim:=extensions.gen_random_uuid();
  update private.ticket_calls set presence_check_id=claim,presence_check_at=stamp where id=c.id;
  batch:=batch||jsonb_build_array(jsonb_build_object('id',c.id,'claimId',claim,'roomName','wf-call-'||c.id::text));
 end loop;
 return batch;
end $$;

create function public.app_finish_manual_call_check(p_call_id uuid,p_claim_id uuid,p_presence jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; stamp timestamptz; total integer;
begin
 perform private.ticket_call_lock();stamp:=clock_timestamp();perform private.process_ticket_call_deadlines();
 select * into c from private.ticket_calls where id=p_call_id and duration_policy='manual' and state='active' for update;
 if c.id is null or p_claim_id is null or c.presence_check_id is distinct from p_claim_id or c.presence_check_at<stamp-interval '30 seconds' then return false; end if;
 -- Consume the exact claim even on an unknown result. Never invent a zero presence count.
 update private.ticket_calls set presence_check_id=null where id=c.id;
 if p_presence is null then return false; end if;
 if jsonb_typeof(p_presence->'data') is distinct from 'array' or jsonb_array_length(p_presence->'data')>2
  or (p_presence->>'total_count')::integer is distinct from jsonb_array_length(p_presence->'data')
  or exists(select 1 from jsonb_array_elements(p_presence->'data') p where p->>'room' is distinct from 'wf-call-'||c.id::text
   or (p->>'userId')::uuid is null or not (p->>'userId')::uuid=any(c.participants))
  or (select count(distinct p->>'userId') from jsonb_array_elements(p_presence->'data') p)<>jsonb_array_length(p_presence->'data') then
  raise exception 'Invalid call presence' using errcode='22023'; end if;
 total:=jsonb_array_length(p_presence->'data');
 if total=2 then update private.ticket_calls set peer_absent_since=null where id=c.id;
 elsif c.peer_absent_since is null then update private.ticket_calls set peer_absent_since=stamp where id=c.id;
 elsif c.peer_absent_since<=stamp-interval '90 seconds' then
  perform private.finish_ticket_call(c.id,'expired','participants_disconnected',stamp);
 end if;
 return true;
end $$;
revoke all on function public.app_claim_manual_call_checks(),public.app_finish_manual_call_check(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.app_claim_manual_call_checks(),public.app_finish_manual_call_check(uuid,uuid,jsonb) to service_role;

create or replace function public.app_claim_ticket_call_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
declare work record; batch jsonb:='[]'; claim uuid;
begin
 perform private.ticket_call_lock();
 for work in select q.*,c.duration_policy,c.room_create_pending,c.room_claim_id,
   greatest(coalesce(c.caller_join_expires_at,c.created_at),coalesce(c.callee_join_expires_at,c.created_at)) join_not_after
   from private.ticket_call_cleanup q join private.ticket_calls c on c.id=q.call_id
   where q.result<>'verified' and (q.attempted_at is null or q.attempted_at<clock_timestamp()-interval '1 minute')
   order by q.attempted_at nulls first,q.call_id limit 2 for update of q loop
  claim:=extensions.gen_random_uuid();
  update private.ticket_call_cleanup set claim_id=claim,attempted_at=clock_timestamp(),result='claimed' where call_id=work.call_id;
  batch:=batch||jsonb_build_array(jsonb_build_object('id',work.call_id,'claimId',claim,'roomName','wf-call-'||work.call_id::text,
    'reconcileOnly',work.result in ('claimed','unknown'),'durationPolicy',work.duration_policy,'setupPending',work.room_create_pending,
    'roomClaimId',work.room_claim_id,'joinNotAfter',work.join_not_after,'mediaEmptyAt',work.media_empty_at));
 end loop;
 return batch;
end $$;

create function public.app_record_manual_call_empty(p_call_id uuid,p_claim_id uuid,p_presence jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls;
begin
 perform private.ticket_call_lock();
 select * into c from private.ticket_calls where id=p_call_id and duration_policy='manual' and state='ended' for update;
 if c.id is null or p_claim_id is null or c.room_create_pending
  or greatest(coalesce(c.caller_join_expires_at,c.created_at),coalesce(c.callee_join_expires_at,c.created_at))+interval '5 seconds'>clock_timestamp()
  or p_presence->>'total_count' is distinct from '0' or p_presence->'data' is distinct from '[]'::jsonb then return false; end if;
 update private.ticket_call_cleanup set media_empty_at=clock_timestamp()
   where call_id=c.id and claim_id=p_claim_id and result='claimed';
 return found;
end $$;

create or replace function public.app_finish_ticket_call_cleanup(p_call_id uuid,p_claim_id uuid,p_verified boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; q private.ticket_call_cleanup;
begin
 perform private.ticket_call_lock();
 select * into c from private.ticket_calls where id=p_call_id;
 select * into q from private.ticket_call_cleanup where call_id=p_call_id for update;
 if c.id is null or p_claim_id is null or q.claim_id is distinct from p_claim_id or q.result<>'claimed' then return false; end if;
 if p_verified and c.duration_policy='manual' and (c.state<>'ended' or c.room_create_pending or q.media_empty_at is null
   or q.media_empty_at<greatest(coalesce(c.caller_join_expires_at,c.created_at),coalesce(c.callee_join_expires_at,c.created_at))+interval '5 seconds') then
  return false;
 end if;
 update private.ticket_call_cleanup set result=case when p_verified then 'verified' else 'unknown' end where call_id=c.id;
 return true;
end $$;
revoke all on function public.app_record_manual_call_empty(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.app_record_manual_call_empty(uuid,uuid,jsonb) to service_role;
