-- Explicit native-order targets share the existing call ledger and all budgets.
-- No Tickets, provider rooms, pilot entries or workspace settings are created.
alter table private.ticket_calls alter column ticket_id drop not null;
alter table private.ticket_calls add column order_id uuid;
alter table private.ticket_calls add constraint ticket_calls_one_conversation check (num_nonnulls(ticket_id,order_id)=1);
alter table private.ticket_calls add constraint ticket_calls_order_tenant_fkey
  foreign key (tenant_id,order_id) references public.orders(tenant_id,id);
create index ticket_calls_order_history on private.ticket_calls(order_id,created_at desc,id desc) where order_id is not null;
create unique index ticket_call_one_live_order on private.ticket_calls(order_id) where not legacy and state<>'ended';

create function private.order_call_profile_allowed(p_profile uuid,p_order uuid,p_open boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.orders o
  join public.tenants tenant on tenant.id=o.tenant_id and tenant.status='active' and tenant.archived_at is null
  join public.companies company on company.id=o.company_id and company.tenant_id=o.tenant_id and company.archived_at is null
  join public.tenant_memberships m on m.tenant_id=o.tenant_id and m.profile_id=p_profile and m.archived_at is null
  join public.profiles p on p.id=m.profile_id and p.archived_at is null
  where o.id=p_order and o.archived_at is null and (not p_open or o.status not in ('complete','canceled'))
    and exists(select 1 from private.ticket_call_environment e where e.pilot_profile_ids is null or p_profile=any(e.pilot_profile_ids))
    and private.profile_has_permission_in_tenant(p_profile,o.tenant_id,'projects.view')
    and private.profile_has_permission_in_tenant(p_profile,o.tenant_id,'tickets.view')
    and (not p_open or private.profile_has_permission_in_tenant(p_profile,o.tenant_id,'tickets.reply'))
    and ((m.account_class='client' and m.company_id=o.company_id) or (m.account_class='internal' and
      (private.profile_has_permission_in_tenant(p_profile,o.tenant_id,'client_private.read')
       or o.assigned_to_profile_id=p_profile or exists(select 1 from public.order_tasks task
          where task.order_id=o.id and task.assigned_to_profile_id=p_profile and task.archived_at is null)))))
$$;

create function private.conversation_call_profile_allowed(p_profile uuid,p_ticket uuid,p_order uuid,p_open boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
select case when p_ticket is not null and p_order is null then private.ticket_call_profile_allowed(p_profile,p_ticket,p_open)
  when p_ticket is null and p_order is not null then private.order_call_profile_allowed(p_profile,p_order,p_open) else false end;
$$;

create function private.conversation_call_recipient_allowed(p_profile uuid,p_ticket uuid,p_order uuid)
returns boolean language sql stable security definer set search_path='' as $$
select case when p_ticket is not null and p_order is null then private.ticket_call_saved_recipient_allowed(p_profile,p_ticket)
 when p_ticket is null and p_order is not null then private.order_call_profile_allowed(p_profile,p_order,true)
  and exists(select 1 from public.orders o join public.tenant_memberships m on m.tenant_id=o.tenant_id
    and m.profile_id=p_profile and m.account_class='internal' and m.archived_at is null
    where o.id=p_order and (o.assigned_to_profile_id=p_profile or exists(select 1 from public.order_tasks task
      where task.order_id=o.id and task.assigned_to_profile_id=p_profile and task.archived_at is null))) else false end;
$$;

-- A read projection only; id is a conversation key, never a fabricated Ticket.
create function private.conversation_call_target(p_ticket uuid,p_order uuid)
returns table(id uuid,ticket_id uuid,order_id uuid,tenant_id uuid,company_id uuid,client_profile_id uuid)
language sql stable security definer set search_path='' as $$
 select t.id,t.id,null::uuid,t.tenant_id,t.company_id,t.client_profile_id from public.tickets t
   where p_order is null and t.id=p_ticket and t.tenant_id=private.current_tenant_id()
 union all
 select coalesce(t.id,o.id),t.id,case when t.id is null then o.id end,o.tenant_id,o.company_id,t.client_profile_id
   from public.orders o left join public.tickets t on t.order_id=o.id and t.tenant_id=o.tenant_id
   where p_ticket is null and o.id=p_order and o.tenant_id=private.current_tenant_id() and o.archived_at is null;
$$;
revoke all on function private.order_call_profile_allowed(uuid,uuid,boolean),
 private.conversation_call_profile_allowed(uuid,uuid,uuid,boolean),private.conversation_call_recipient_allowed(uuid,uuid,uuid),
 private.conversation_call_target(uuid,uuid) from public,anon,authenticated,service_role;

-- Existing lifecycle bodies retain their admission, replay and cost controls.
create or replace function private.ticket_call_projection(c private.ticket_calls) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',c.id,'ticketId',c.ticket_id,'orderId',coalesce(c.order_id,(select order_id from public.tickets where id=c.ticket_id)),'callerId',c.initiated_by,
  'calleeId',c.callee_profile_id,'mode',c.mode,'direction',c.direction,'state',c.state,
  'requestedAt',c.created_at,'ringDeadline',c.ring_deadline,'acceptedAt',c.accepted_at,
  'answeredAt',c.answered_at,'endedAt',c.ended_at,'expiresAt',c.expires_at,
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
  perform private.process_ticket_call_deadlines(); stamp:=clock_timestamp();
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
    or (select count(*) from private.ticket_calls where expires_at>stamp and (legacy or outcome is null or outcome not in ('busy','refused')))>=4
    or (select count(*) from private.ticket_calls where expires_at>(date_trunc('month',stamp at time zone 'UTC') at time zone 'UTC')
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
    participants,created_at,expires_at,state,caller_session_id,caller_device_id,ring_deadline,outcome,reason,ended_at,reconciled_at)
  values(new_id,p_request_id,t.ticket_id,t.order_id,t.tenant_id,auth.uid(),callee,direction_value,p_mode,
    case when callee is null then array[auth.uid()] else array[auth.uid(),callee] end,
    stamp,stamp+interval '15 minutes',case when refusal is null then 'ringing' else 'ended' end,
    sid,p_device_id,stamp+interval '40 seconds',refusal,refusal,
    case when refusal is not null then stamp end,case when refusal is not null then stamp end) returning * into c;
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
    if not private.ticket_call_enabled(c.tenant_id)
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
    elsif c.expires_at<=stamp then
      perform private.finish_ticket_call(c.id,'expired','room_expired',c.expires_at); n:=n+1;
    elsif c.state in ('accepted','connecting') and c.connect_deadline<=stamp then
      perform private.finish_ticket_call(c.id,'expired','connect_timeout',c.connect_deadline); n:=n+1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.app_ticket_call_command(p_action text,p_call_id uuid,p_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; sid uuid; stamp timestamptz; claim uuid;
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
  if c.tenant_id is distinct from private.current_tenant_id() or not private.ticket_call_enabled(c.tenant_id)
    or not private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id) then raise exception 'Call unavailable' using errcode='42501'; end if;
  if p_action='status' then
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
    if p_device_id is null or c.state not in ('accepted','connecting','active') or c.expires_at<=stamp
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
        update private.ticket_calls set state='connecting',provider_state='claimed',room_claim_id=claim,version=version+1 where id=c.id;
      end if;
      return jsonb_build_object('id',c.id,'ready',c.provider_state='ready','created',claim is not null,'claimId',coalesce(claim,c.room_claim_id),
        'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
    end if;
    if c.provider_state<>'ready' or c.token_attempts>=8 then raise exception 'Call unavailable' using errcode='42501'; end if;
    perform private.consume_rate_limit('ticket-call-token',auth.uid()::text,interval '1 minute',6);
    update private.ticket_calls set token_attempts=token_attempts+1 where id=c.id;
    return jsonb_build_object('id',c.id,'participantId',auth.uid(),'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
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
 if c.id is null or c.state not in ('accepted','connecting','active') or c.expires_at<=clock_timestamp()
  or not private.ticket_call_enabled(c.tenant_id)
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
  or c.state not in ('accepted','connecting','active') or c.expires_at<=clock_timestamp()
  or not private.ticket_call_enabled(c.tenant_id) or not exists(select 1 from private.ticket_call_environment where media_enabled)
  or not private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id,true)
  or (auth.uid()=c.initiated_by and (sid is distinct from c.caller_session_id or p_device_id is distinct from c.caller_device_id))
  or (auth.uid()=c.callee_profile_id and (sid is distinct from c.callee_session_id or p_device_id is distinct from c.callee_device_id))
  then raise exception 'Call unavailable' using errcode='42501'; end if;
 perform private.consume_rate_limit('ticket-call-media-probe',auth.uid()::text,interval '1 minute',30);
 return jsonb_build_object('id',c.id,'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
end $$;

create or replace function public.app_my_call_push_status(p_endpoint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor record; c private.ticket_calls;
begin
  select * into actor from private.require_call_push_actor();
  perform private.consume_rate_limit('call-push.status',actor.profile_id::text,interval '1 minute',90);
  if not coalesce(private.push_endpoint_allowed(p_endpoint),false) or not exists(
    select 1 from private.ticket_call_push_devices s join private.studio_push_configuration cfg
      on cfg.enabled and cfg.tenant_id=s.tenant_id and cfg.origin=s.origin
    where s.endpoint=p_endpoint and s.profile_id=actor.profile_id and s.tenant_id=actor.tenant_id
      and s.session_id=actor.session_id and s.enabled and s.expires_at>now()) then
    return jsonb_build_object('active',false,'call',null); end if;
  select call.* into c from private.ticket_call_claims claim join private.ticket_calls call on call.id=claim.call_id
    where claim.profile_id=actor.profile_id and call.tenant_id=actor.tenant_id and not call.legacy
      and call.state='ringing' and call.callee_profile_id=actor.profile_id;
  if c.id is not null and (not private.ticket_call_enabled(c.tenant_id)
    or not private.conversation_call_profile_allowed(actor.profile_id,c.ticket_id,c.order_id)
    or not private.conversation_call_profile_allowed(c.initiated_by,c.ticket_id,c.order_id)
    or not private.conversation_call_profile_allowed(c.callee_profile_id,c.ticket_id,c.order_id)
    or (c.direction='client_to_team' and not private.conversation_call_recipient_allowed(c.callee_profile_id,c.ticket_id,c.order_id))
    or c.expires_at<=clock_timestamp()
    or (c.state='ringing' and c.ring_deadline<=clock_timestamp())) then c:=null; end if;
  return jsonb_build_object('active',true,'call',case when c.id is null then null else
    jsonb_build_object('id',c.id,'version',c.version) end);
end $$;

create or replace function private.call_push_delivery_visible(p_delivery uuid) returns boolean
language sql security definer set search_path='' as $$
select exists(select 1 from private.ticket_call_push_deliveries d
  join private.ticket_call_push_devices device on device.id=d.device_id and device.enabled and device.expires_at>clock_timestamp()
  join private.ticket_calls c on c.id=d.call_id and c.callee_profile_id=device.profile_id
    and c.tenant_id=device.tenant_id and c.state='ringing' and not c.legacy
    and c.ring_deadline>clock_timestamp() and c.expires_at>clock_timestamp()
  join auth.sessions session on session.id=device.session_id and session.user_id=device.profile_id
    and (session.not_after is null or session.not_after>clock_timestamp())
  join auth.sessions caller_session on caller_session.id=c.caller_session_id and caller_session.user_id=c.initiated_by
    and (caller_session.not_after is null or caller_session.not_after>clock_timestamp())
  join private.studio_push_configuration cfg on cfg.enabled and cfg.tenant_id=device.tenant_id and cfg.origin=device.origin
  join public.tenant_domains domain on domain.tenant_id=device.tenant_id and domain.host=substring(device.origin from 9)
    and domain.verified_at is not null and domain.disabled_at is null
  where d.id=p_delivery and d.expires_at>clock_timestamp() and private.ticket_call_enabled(c.tenant_id)
    and private.conversation_call_profile_allowed(c.initiated_by,c.ticket_id,c.order_id)
    and private.conversation_call_profile_allowed(c.callee_profile_id,c.ticket_id,c.order_id)
    and (c.direction<>'client_to_team' or private.conversation_call_recipient_allowed(c.callee_profile_id,c.ticket_id,c.order_id)));
$$;

create or replace function private.ticket_call_bell_visible(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from private.ticket_calls c where 'ticket-call-missed:'||c.id::text=p_key
  and c.callee_profile_id=auth.uid() and c.tenant_id=private.current_tenant_id()
  and private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id,false));
$$;

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
      perform private.process_ticket_call_deadlines();
      select * into c from private.ticket_calls where id=c.id;
      peer:=private.ticket_call_person(case when c.initiated_by=auth.uid() then c.callee_profile_id else c.initiated_by end,c.tenant_id);
    end if;
  end if;
  allowed:=private.ticket_call_enabled(tenant) and
    (case when c.id is not null then private.conversation_call_profile_allowed(auth.uid(),c.ticket_id,c.order_id)
      when p_ticket_id is not null or p_order_id is not null then private.conversation_call_profile_allowed(auth.uid(),p_ticket_id,p_order_id,true) else
        private.profile_has_permission_in_tenant(auth.uid(),tenant,'tickets.reply') end);
  return jsonb_build_object('enabled',allowed,'profileId',auth.uid(),'accountClass',account,
    'call',case when c.id is null then null else private.ticket_call_projection(c) end,
    'peer',peer,'ticketId',coalesce(c.ticket_id,p_ticket_id),'orderId',coalesce(c.order_id,p_order_id,(select order_id from public.tickets where id=coalesce(c.ticket_id,p_ticket_id))));
end $$;

create or replace function private.conversation_call_history(p_ticket_id uuid,p_order_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; target record;
begin
  perform private.ticket_call_session();
  select * into target from private.conversation_call_target(p_ticket_id,p_order_id);
  if target.id is null or not private.conversation_call_profile_allowed(auth.uid(),target.ticket_id,target.order_id,false) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  perform private.consume_rate_limit('ticket-call-history',auth.uid()::text,interval '1 minute',60);
  select coalesce(jsonb_agg(private.ticket_call_projection(c)||jsonb_build_object('caller',private.ticket_call_person(c.initiated_by,c.tenant_id),'callee',private.ticket_call_person(c.callee_profile_id,c.tenant_id)) order by c.created_at desc,c.id desc),'[]'::jsonb) into result
  from (select * from private.ticket_calls where ticket_id is not distinct from target.ticket_id and order_id is not distinct from target.order_id and not legacy and auth.uid()=any(participants)
    and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50) c;
  return result;
end $$;

create or replace function public.app_ticket_call_current(p_ticket_id uuid default null,p_call_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
select private.conversation_call_current(p_ticket_id,p_call_id,null)-'orderId';
$$;
create function public.app_order_call_current(p_order_id uuid)
returns jsonb language sql security definer set search_path='' as $$
select private.conversation_call_current(null,null,p_order_id);
$$;
create or replace function public.app_request_ticket_call(p_ticket_id uuid,p_request_id uuid,p_device_id uuid,p_mode text,p_recipient_id uuid)
returns jsonb language sql security definer set search_path='' as $$
select private.request_conversation_call(p_ticket_id,null,p_request_id,p_device_id,p_mode,p_recipient_id);
$$;
create function public.app_request_order_call(p_order_id uuid,p_request_id uuid,p_device_id uuid,p_mode text,p_recipient_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
select private.request_conversation_call(null,p_order_id,p_request_id,p_device_id,p_mode,p_recipient_id);
$$;
create or replace function public.app_ticket_call_history(p_ticket_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
select private.conversation_call_history(p_ticket_id,null,p_before,p_before_id);
$$;
create function public.app_order_call_history(p_order_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security definer set search_path='' as $$
select private.conversation_call_history(null,p_order_id,p_before,p_before_id);
$$;

create function public.app_order_call_prepare(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare value jsonb; target record; candidates jsonb;
begin
  select * into target from private.conversation_call_target(null,p_order_id);
  if target.id is null then raise exception 'Call unavailable' using errcode='42501'; end if;
  if target.ticket_id is not null then return public.app_ticket_call_prepare(target.ticket_id)||jsonb_build_object('orderId',p_order_id); end if;
  value:=public.app_order_call_current(p_order_id);
  if value->>'enabled' is distinct from 'true' or value->'call'<>'null'::jsonb then return value; end if;
  select coalesce(jsonb_agg(person order by person->>'name',person->>'profileId'),'[]'::jsonb) into candidates
    from (select private.ticket_call_person(m.profile_id,target.tenant_id)||jsonb_build_object('profileId',m.profile_id) person
      from public.tenant_memberships m
      where m.tenant_id=target.tenant_id and m.archived_at is null and m.profile_id<>auth.uid()
        and case when value->>'accountClass'='client' then
          m.account_class='internal' and private.conversation_call_recipient_allowed(m.profile_id,null,target.order_id)
        else m.account_class='client' and m.company_id=target.company_id
          and private.order_call_profile_allowed(m.profile_id,target.order_id) end
      order by m.profile_id limit 100) eligible;
  return value||jsonb_build_object('peer',null,'candidates',candidates,'enabled',jsonb_array_length(candidates)>0);
end $$;

create or replace function private.ticket_call_missed_bell() returns trigger
language plpgsql security definer set search_path='' as $$
declare member_class text; company uuid; project uuid;
begin
  if new.outcome='missed' and old.outcome is distinct from 'missed' and new.callee_profile_id is not null
    and private.conversation_call_profile_allowed(new.callee_profile_id,new.ticket_id,new.order_id,false) then
    select account_class into member_class from public.tenant_memberships
      where tenant_id=new.tenant_id and profile_id=new.callee_profile_id and archived_at is null;
    project:=coalesce(new.order_id,(select order_id from public.tickets where id=new.ticket_id));
    if project is not null then select company_id into company from public.orders where id=project and tenant_id=new.tenant_id;
    else select company_id into company from public.tickets where id=new.ticket_id and tenant_id=new.tenant_id; end if;
    insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,entity_type,entity_id,actor_profile_id,event_key)
      values(new.callee_profile_id,new.tenant_id,company,member_class,case when project is null then 'ticket' else 'project' end,
        'Missed call','Open the conversation to follow up.',
        case when project is not null then case when member_class='client' then '/account/projects/' else '/orders/' end||project::text||'?call='||new.id::text
          when member_class='client' then '/account/messages/'||new.ticket_id::text||'?call='||new.id::text
          else '/tickets/'||new.ticket_id::text||'?inbox=tickets&ticket='||new.ticket_id::text||'&call='||new.id::text end,
        case when project is null then 'ticket' else 'order' end,coalesce(project,new.ticket_id),new.initiated_by,'ticket-call-missed:'||new.id::text)
      on conflict(recipient_profile_id,event_key) do nothing;
  end if;
  return new;
end $$;

revoke all on function private.request_conversation_call(uuid,uuid,uuid,uuid,text,uuid),
 private.conversation_call_current(uuid,uuid,uuid),private.conversation_call_history(uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.app_order_call_current(uuid),public.app_order_call_prepare(uuid),
 public.app_order_call_history(uuid,timestamptz,uuid),public.app_request_order_call(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_order_call_current(uuid),public.app_order_call_prepare(uuid),
 public.app_order_call_history(uuid,timestamptz,uuid),public.app_request_order_call(uuid,uuid,uuid,text,uuid) to authenticated;
