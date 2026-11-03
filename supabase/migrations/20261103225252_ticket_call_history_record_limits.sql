-- Bound new durable records, independently of admitted-call/media quotas.
create or replace function public.app_request_ticket_call(p_ticket_id uuid,p_request_id uuid,p_device_id uuid,p_mode text,p_recipient_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets; c private.ticket_calls; settings private.ticket_call_settings; env private.ticket_call_environment;
  sid uuid; callee uuid; direction_value text; stamp timestamptz; refusal text; slice record;
  used numeric; tenant_used numeric; new_id uuid:=extensions.gen_random_uuid();
begin
  sid:=private.ticket_call_session();
  perform private.consume_rate_limit('ticket-call-request',auth.uid()::text,interval '1 minute',60);
  perform private.ticket_call_lock();
  perform private.process_ticket_call_deadlines(); stamp:=clock_timestamp();
  if p_request_id is null or p_device_id is null or p_mode is null or p_mode not in ('audio','video') then
    raise exception 'Invalid call request' using errcode='22023'; end if;
  select * into t from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id() for share;
  if t.id is null or not private.ticket_call_profile_allowed(auth.uid(),t.id) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if not private.ticket_call_enabled(t.tenant_id) then raise exception 'Calls disabled' using errcode='42501'; end if;
  select * into c from private.ticket_calls where tenant_id=t.tenant_id and initiated_by=auth.uid() and request_id=p_request_id;
  if c.id is not null then
    if c.ticket_id<>t.id or c.mode<>p_mode or c.caller_session_id<>sid or c.caller_device_id<>p_device_id or (p_recipient_id is not null and c.callee_profile_id is distinct from p_recipient_id) or (c.direction='client_to_team' and p_recipient_id is null) then
      raise exception 'Call request conflicts' using errcode='22023'; end if;
    if c.state<>'ended' and c.direction='client_to_team' and not private.ticket_call_saved_recipient_allowed(c.callee_profile_id,t.id) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    return private.ticket_call_projection(c);
  end if;
  -- Exact-request replay above remains available; every new durable outcome counts.
  if (select count(*) filter(where initiated_by=auth.uid() and created_at>=stamp-interval '1 day')>=30
      or count(*) filter(where initiated_by=auth.uid())>=300
      or count(*) filter(where created_at>=stamp-interval '1 day')>=120
      or count(*)>=1200
    from private.ticket_calls where created_at>=stamp-interval '30 days') then
    raise exception 'Call history limit reached' using errcode='WF429'; end if;
  perform private.consume_rate_limit('ticket-call-invite',auth.uid()::text,interval '1 minute',12);
  perform private.consume_rate_limit('ticket-call-provider-global','daily',interval '1 minute',60);
  select * into settings from private.ticket_call_settings where tenant_id=t.tenant_id;
  select * into env from private.ticket_call_environment;
  if exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=auth.uid() and account_class='client') then
    direction_value:='client_to_team'; callee:=p_recipient_id;
    if callee is null or callee=auth.uid() or not private.ticket_call_saved_recipient_allowed(callee,t.id) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    perform 1 from private.ticket_inbox_memberships where ticket_id=t.id and profile_id=callee for share;
    if not found then raise exception 'Call unavailable' using errcode='42501'; end if;
  else
    direction_value:='team_to_client'; callee:=t.client_profile_id;
    if p_recipient_id is not null and p_recipient_id is distinct from callee then
      raise exception 'Call unavailable' using errcode='42501'; end if;
  end if;
  if callee is null or callee=auth.uid() or not private.ticket_call_profile_allowed(callee,t.id)
    or (direction_value='client_to_team' and not exists(select 1 from public.tenant_memberships
      where tenant_id=t.tenant_id and profile_id=callee and account_class='internal' and archived_at is null)) then
    refusal:='refused'; callee:=null;
  elsif exists(select 1 from private.ticket_call_claims where profile_id in (auth.uid(),callee)) then refusal:='busy';
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
  insert into private.ticket_calls(id,request_id,ticket_id,tenant_id,initiated_by,callee_profile_id,direction,mode,
    participants,created_at,expires_at,state,caller_session_id,caller_device_id,ring_deadline,outcome,reason,ended_at,reconciled_at)
  values(new_id,p_request_id,t.id,t.tenant_id,auth.uid(),callee,direction_value,p_mode,
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

