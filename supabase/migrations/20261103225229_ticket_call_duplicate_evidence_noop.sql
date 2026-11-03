-- Digest conflicts remain errors; later complete reconciliation remains available.
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
    or end_time<c.accepted_at or end_time>c.expires_at or end_time>clock_timestamp()+interval '5 seconds' then
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

