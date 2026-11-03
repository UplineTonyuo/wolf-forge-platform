-- Reject exhausted setup before provider I/O; every claimed/ready retry is admitted.
create or replace function public.app_ticket_call_command(p_action text,p_call_id uuid,p_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; sid uuid; stamp timestamptz; claim uuid;
begin
  sid:=private.ticket_call_session(); perform private.ticket_call_lock();
  if p_action is null or p_action not in ('status','accept','decline','cancel','end','setup','join') then
    raise exception 'Invalid call operation' using errcode='22023'; end if;
  select * into c from private.ticket_calls where id=p_call_id and not legacy for update;
  if c.id is null or not auth.uid()=any(c.participants) then raise exception 'Call unavailable' using errcode='42501'; end if;
  -- Cleanup intentionally precedes Tenant, Ticket, module and calling-flag gates.
  if p_action in ('cancel','end') then
    if p_action='cancel' and auth.uid()<>c.initiated_by then raise exception 'Call unavailable' using errcode='42501'; end if;
    perform private.consume_rate_limit('ticket-call-end',auth.uid()::text,interval '1 minute',12);
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
    or not private.ticket_call_profile_allowed(auth.uid(),c.ticket_id) then raise exception 'Call unavailable' using errcode='42501'; end if;
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

