-- Defaults are inert. Backend/account verification and media enablement are
-- operator-only; a Tenant owner cannot allocate another environment's budget.
create table private.ticket_call_environment (
  singleton boolean primary key default true check (singleton),
  environment text not null default 'test' check (environment in ('test','live')),
  backend_ref text,
  provider_account text not null default 'wolfforge' check (provider_account='wolfforge'),
  enabled boolean not null default false,
  media_enabled boolean not null default false,
  verified_at timestamptz,
  verified_free_minutes integer not null default 10000 check (verified_free_minutes>=6000),
  allocation_minutes integer generated always as
    (case when environment='test' then 600 else 5400 end) stored,
  check (not enabled or (verified_at is not null and
    ((environment='test' and backend_ref in ('rsnmlcyopnxucwgfttyf','ci')) or
     (environment='live' and backend_ref='jwynqsyirgenqlmkooah'))))
);
insert into private.ticket_call_environment(singleton) values(true);

create table private.ticket_call_settings (
  tenant_id uuid primary key references public.tenants(id),
  enabled boolean not null default false,
  fallback_team_profile_id uuid references public.profiles(id),
  monthly_minutes integer not null default 600 check (monthly_minutes between 1 and 5400)
);
create table private.ticket_call_settings_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid not null references public.profiles(id),
  enabled boolean not null,
  fallback_team_profile_id uuid,
  monthly_minutes integer not null,
  changed_at timestamptz not null default clock_timestamp()
);

alter table private.ticket_calls drop constraint ticket_calls_state_check;
update private.ticket_calls set state='ended' where state in ('reserved','ready');
alter table private.ticket_calls add constraint ticket_calls_state_check
  check (state in ('ringing','accepted','connecting','active','ending','ended'));
alter table private.ticket_calls
  add column request_id uuid,
  add column callee_profile_id uuid references public.profiles(id),
  add column direction text check (direction in ('client_to_team','team_to_client')),
  add column caller_session_id uuid,
  add column caller_device_id uuid,
  add column callee_session_id uuid,
  add column callee_device_id uuid,
  add column ring_deadline timestamptz,
  add column connect_deadline timestamptz,
  add column accepted_at timestamptz,
  add column answered_at timestamptz,
  add column end_requested_at timestamptz,
  add column ended_at timestamptz,
  add column outcome text check (outcome in ('answered','declined','missed','expired','busy','refused')),
  add column reason text,
  add column version integer not null default 1,
  add column legacy boolean not null default true,
  add column room_claim_id uuid,
  add column provider_state text not null default 'none'
    check (provider_state in ('none','claimed','ready','unknown','ended')),
  add column connected_seconds numeric not null default 0 check (connected_seconds>=0),
  add column participant_seconds numeric not null default 0 check (participant_seconds>=0),
  add column reconciled_at timestamptz;
update private.ticket_calls set request_id=id, outcome='expired', reason='legacy_foundation',
  ended_at=expires_at, provider_state='unknown';
alter table private.ticket_calls alter column request_id set not null;
alter table private.ticket_calls alter column legacy set default false;
alter table private.ticket_calls alter column state set default 'ringing';
alter table private.ticket_calls add constraint ticket_call_frozen_parties check
  (legacy or (initiated_by is distinct from callee_profile_id and
    participants[1]=initiated_by and
    ((state='ended' and outcome in ('busy','refused')) or
      (callee_profile_id is not null and cardinality(participants)=2
       and participants[2]=callee_profile_id))));
create unique index ticket_call_request on private.ticket_calls(tenant_id,initiated_by,request_id);
create unique index ticket_call_one_live_ticket on private.ticket_calls(ticket_id)
  where not legacy and state<>'ended';

create table private.ticket_call_claims (
  profile_id uuid primary key references public.profiles(id),
  call_id uuid not null references private.ticket_calls(id) on delete cascade
);
create table private.ticket_call_reservations (
  call_id uuid not null references private.ticket_calls(id) on delete cascade,
  month date not null check (extract(day from month)=1),
  reserved_seconds numeric not null check (reserved_seconds>0 and reserved_seconds<=1800),
  settled_seconds numeric check (settled_seconds>=0 and settled_seconds<=reserved_seconds),
  primary key(call_id,month)
);
create table private.ticket_call_events (
  id bigint generated always as identity primary key,
  call_id uuid not null references private.ticket_calls(id) on delete cascade,
  event text not null,
  actor_id uuid references public.profiles(id),
  occurred_at timestamptz not null default clock_timestamp()
);
create table private.ticket_call_cleanup (
  call_id uuid primary key references private.ticket_calls(id) on delete cascade,
  claim_id uuid,
  attempted_at timestamptz,
  result text not null default 'pending' check (result in ('pending','claimed','unknown','verified'))
);
create table private.ticket_call_evidence (
  call_id uuid not null references private.ticket_calls(id) on delete cascade,
  event_id text not null unique check (length(event_id) between 1 and 128),
  meeting_id text not null unique check (length(meeting_id) between 1 and 128),
  digest text not null,
  received_at timestamptz not null default clock_timestamp()
);
create table private.ticket_call_intervals (
  call_id uuid not null references private.ticket_calls(id) on delete cascade,
  participant_session text not null check (length(participant_session) between 1 and 128),
  profile_id uuid not null references public.profiles(id),
  joined_at timestamptz not null,
  left_at timestamptz not null check (left_at>joined_at),
  primary key(call_id,participant_session)
);

create function private.ticket_call_lock() returns void
language plpgsql set search_path='' as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Calls require read committed isolation' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ticket-live-calls-v1',0));
end $$;

create function private.ticket_call_session() returns uuid
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then sid:=null; end;
  if auth.uid() is null or sid is null or not exists(
    select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>clock_timestamp())
  ) then raise exception 'Active session required' using errcode='42501'; end if;
  return sid;
end $$;

create function private.ticket_call_profile_allowed(p_profile uuid,p_ticket uuid,p_open boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
select exists(
  select 1 from public.tickets ticket
  join public.tenants tenant on tenant.id=ticket.tenant_id and tenant.status='active' and tenant.archived_at is null
  join public.tenant_memberships member on member.tenant_id=ticket.tenant_id and member.profile_id=p_profile
    and member.archived_at is null
  join public.profiles profile on profile.id=p_profile and profile.archived_at is null
  join public.companies company on company.id=ticket.company_id and company.tenant_id=ticket.tenant_id
    and company.archived_at is null
  where ticket.id=p_ticket and ticket.archived_at is null
    and (not p_open or ticket.status not in ('closed','resolved'))
    and private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'tickets.view')
    and (not p_open or private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'tickets.reply'))
    and ((member.account_class='client' and member.company_id=ticket.company_id and ticket.client_profile_id=p_profile)
      or member.account_class='internal')
    and (ticket.order_id is null or exists(
      select 1 from public.orders project where project.id=ticket.order_id and project.tenant_id=ticket.tenant_id
        and project.archived_at is null
        and private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'projects.view')
        and ((member.account_class='client' and project.company_id=member.company_id)
          or (member.account_class='internal' and
            (private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'client_private.read')
              or project.assigned_to_profile_id=p_profile or exists(
                select 1 from public.order_tasks task where task.order_id=project.id
                  and task.assigned_to_profile_id=p_profile and task.archived_at is null))))))
);
$$;

create function private.ticket_call_enabled(p_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from private.ticket_call_environment env
  join private.ticket_call_settings settings on settings.tenant_id=p_tenant and settings.enabled
  where env.enabled and env.verified_at>clock_timestamp()-interval '30 days'
    and env.verified_free_minutes>=6000);
$$;

create function private.ticket_call_projection(c private.ticket_calls) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',c.id,'ticketId',c.ticket_id,'callerId',c.initiated_by,
  'calleeId',c.callee_profile_id,'mode',c.mode,'direction',c.direction,'state',c.state,
  'requestedAt',c.created_at,'ringDeadline',c.ring_deadline,'acceptedAt',c.accepted_at,
  'answeredAt',c.answered_at,'endedAt',c.ended_at,'expiresAt',c.expires_at,
  'outcome',c.outcome,'reason',c.reason,'version',c.version,
  'connectedSeconds',c.connected_seconds,'participantSeconds',c.participant_seconds,
  'reconciled',c.reconciled_at is not null,
  'message',case when c.outcome='busy' then 'busy'
    when c.outcome='refused' then 'Please send a message instead' else null end);
$$;

create function private.finish_ticket_call(p_call uuid,p_outcome text,p_reason text,p_effective_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls;
begin
  select * into c from private.ticket_calls where id=p_call for update;
  if c.id is null or c.state='ended' then return; end if;
  update private.ticket_calls set state='ended',outcome=case when answered_at is not null then 'answered' else p_outcome end,
    reason=p_reason,end_requested_at=coalesce(end_requested_at,clock_timestamp()),ended_at=p_effective_at,
    version=version+1 where id=c.id;
  if c.provider_state='none' then
    delete from private.ticket_call_claims where call_id=c.id;
    update private.ticket_call_reservations set settled_seconds=0 where call_id=c.id;
    update private.ticket_calls set reconciled_at=clock_timestamp() where id=c.id;
  else
    insert into private.ticket_call_cleanup(call_id) values(c.id) on conflict do nothing;
  end if;
  insert into private.ticket_call_events(call_id,event,actor_id) values(c.id,p_reason,auth.uid());
end $$;

create function private.process_ticket_call_deadlines() returns integer
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; n integer:=0; stamp timestamptz;
begin
  perform private.ticket_call_lock(); stamp:=clock_timestamp();
  for c in select * from private.ticket_calls where not legacy and state<>'ended'
    order by created_at limit 100 for update loop
    if not private.ticket_call_enabled(c.tenant_id)
      or not private.ticket_call_profile_allowed(c.initiated_by,c.ticket_id)
      or not private.ticket_call_profile_allowed(c.callee_profile_id,c.ticket_id)
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

create function public.app_configure_ticket_call_settings(p_enabled boolean,p_fallback_profile_id uuid,p_monthly_minutes integer default 600)
returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid:=private.current_tenant_id(); env private.ticket_call_environment;
begin
  perform private.ticket_call_session(); perform private.ticket_call_lock();
  if not exists(select 1 from public.tenant_memberships m join public.roles r on r.id=m.role_id
    join public.tenants t on t.id=m.tenant_id and t.status='active' and t.archived_at is null
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    where m.tenant_id=tid and m.profile_id=auth.uid() and m.account_class='internal'
      and m.archived_at is null and r.name='owner') then
    raise exception 'Owner required' using errcode='42501'; end if;
  select * into env from private.ticket_call_environment;
  if p_enabled is null or p_monthly_minutes is null or p_monthly_minutes not between 1 and env.allocation_minutes
    or (p_fallback_profile_id is not null and not exists(select 1 from public.tenant_memberships m
      join public.profiles p on p.id=m.profile_id and p.archived_at is null
      where m.tenant_id=tid and m.profile_id=p_fallback_profile_id and m.account_class='internal' and m.archived_at is null)) then
    raise exception 'Invalid call settings' using errcode='22023'; end if;
  insert into private.ticket_call_settings(tenant_id,enabled,fallback_team_profile_id,monthly_minutes)
    values(tid,p_enabled,p_fallback_profile_id,p_monthly_minutes)
    on conflict(tenant_id) do update set enabled=excluded.enabled,
      fallback_team_profile_id=excluded.fallback_team_profile_id,monthly_minutes=excluded.monthly_minutes;
  insert into private.ticket_call_settings_audit(tenant_id,actor_id,enabled,fallback_team_profile_id,monthly_minutes)
    values(tid,auth.uid(),p_enabled,p_fallback_profile_id,p_monthly_minutes);
  perform private.process_ticket_call_deadlines();
  return true;
end $$;

create function public.app_request_ticket_call(p_ticket_id uuid,p_request_id uuid,p_device_id uuid,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets; c private.ticket_calls; settings private.ticket_call_settings; env private.ticket_call_environment;
  sid uuid; callee uuid; direction_value text; stamp timestamptz; refusal text; month_start timestamptz;
  segment_end timestamptz; seconds numeric; used numeric; tenant_used numeric; new_id uuid:=extensions.gen_random_uuid();
begin
  sid:=private.ticket_call_session(); perform private.ticket_call_lock();
  perform private.process_ticket_call_deadlines(); stamp:=clock_timestamp();
  if p_request_id is null or p_device_id is null or p_mode is null or p_mode not in ('audio','video') then
    raise exception 'Invalid call request' using errcode='22023'; end if;
  select * into t from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id() for share;
  if t.id is null or not private.ticket_call_profile_allowed(auth.uid(),t.id) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if not private.ticket_call_enabled(t.tenant_id) then raise exception 'Calls disabled' using errcode='42501'; end if;
  select * into c from private.ticket_calls where tenant_id=t.tenant_id and initiated_by=auth.uid() and request_id=p_request_id;
  if c.id is not null then
    if c.ticket_id<>t.id or c.mode<>p_mode or c.caller_session_id<>sid or c.caller_device_id<>p_device_id then
      raise exception 'Call request conflicts' using errcode='22023'; end if;
    return private.ticket_call_projection(c);
  end if;
  perform private.consume_rate_limit('ticket-call-invite',auth.uid()::text,interval '1 minute',12);
  perform private.consume_rate_limit('ticket-call-provider-global','daily',interval '1 minute',60);
  select * into settings from private.ticket_call_settings where tenant_id=t.tenant_id;
  select * into env from private.ticket_call_environment;
  if exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=auth.uid() and account_class='client') then
    direction_value:='client_to_team'; callee:=t.assigned_to_profile_id;
    if callee is null or not private.ticket_call_profile_allowed(callee,t.id)
      or not exists(select 1 from public.tenant_memberships where tenant_id=t.tenant_id and profile_id=callee and account_class='internal' and archived_at is null) then
      callee:=settings.fallback_team_profile_id;
    end if;
  else direction_value:='team_to_client'; callee:=t.client_profile_id; end if;
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
    month_start:=date_trunc('month',stamp at time zone 'UTC') at time zone 'UTC';
    while month_start<stamp+interval '15 minutes' loop
      segment_end:=least(month_start+interval '1 month',stamp+interval '15 minutes');
      seconds:=2*extract(epoch from segment_end-greatest(stamp,month_start));
      select coalesce(sum(coalesce(r.settled_seconds,r.reserved_seconds)),0),
        coalesce(sum(coalesce(r.settled_seconds,r.reserved_seconds)) filter(where call.tenant_id=t.tenant_id),0)
        into used,tenant_used from private.ticket_call_reservations r join private.ticket_calls call on call.id=r.call_id
        where r.month=(month_start at time zone 'UTC')::date;
      if used+seconds>env.allocation_minutes*60 or tenant_used+seconds>settings.monthly_minutes*60 then refusal:='refused'; exit; end if;
      month_start:=month_start+interval '1 month';
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
    month_start:=date_trunc('month',stamp at time zone 'UTC') at time zone 'UTC';
    while month_start<c.expires_at loop
      seconds:=2*extract(epoch from least(month_start+interval '1 month',c.expires_at)-greatest(stamp,month_start));
      insert into private.ticket_call_reservations values(c.id,(month_start at time zone 'UTC')::date,seconds,null);
      month_start:=month_start+interval '1 month';
    end loop;
  end if;
  insert into private.ticket_call_events(call_id,event,actor_id) values(c.id,coalesce(refusal,'requested'),auth.uid());
  return private.ticket_call_projection(c);
end $$;

create function public.app_ticket_call_command(p_action text,p_call_id uuid,p_device_id uuid default null)
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
    perform private.finish_ticket_call(c.id,'expired','participant_ended',clock_timestamp());
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
      if c.provider_state='none' then
        perform private.consume_rate_limit('ticket-call-provider-actor',auth.uid()::text,interval '1 minute',12);
        claim:=extensions.gen_random_uuid();
        update private.ticket_calls set state='connecting',provider_state='claimed',room_claim_id=claim,version=version+1 where id=c.id;
      end if;
      return jsonb_build_object('id',c.id,'created',claim is not null,'claimId',coalesce(claim,c.room_claim_id),
        'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
    end if;
    if c.provider_state<>'ready' or c.token_attempts>=8 then raise exception 'Call unavailable' using errcode='42501'; end if;
    perform private.consume_rate_limit('ticket-call-token',auth.uid()::text,interval '1 minute',6);
    update private.ticket_calls set token_attempts=token_attempts+1 where id=c.id;
    return jsonb_build_object('id',c.id,'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
  end if;
  select * into c from private.ticket_calls where id=p_call_id;
  return private.ticket_call_projection(c);
end $$;

-- The old API must not be an alternative admission authority.
create or replace function public.app_ticket_call(p_action text,p_ticket_id uuid,p_request_id uuid default null,
  p_call_id uuid default null,p_mode text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_action='end' then return public.app_ticket_call_command('end',p_call_id); end if;
  raise exception 'Use the invitation API' using errcode='42501';
end $$;
revoke all on function public.app_complete_ticket_call_setup(uuid) from public,anon,authenticated,service_role;

do $$
declare table_name text; func record;
begin
  foreach table_name in array array['ticket_call_environment','ticket_call_settings','ticket_call_settings_audit','ticket_call_claims',
    'ticket_call_reservations','ticket_call_events','ticket_call_cleanup','ticket_call_evidence','ticket_call_intervals'] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('alter table private.%I force row level security',table_name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',table_name);
  end loop;
  for func in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and (p.proname like 'ticket_call_%' or p.proname in ('finish_ticket_call','process_ticket_call_deadlines')))
      or (n.nspname='public' and p.proname in ('app_request_ticket_call','app_ticket_call_command','app_configure_ticket_call_settings')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',func.signature);
  end loop;
end $$;
grant execute on function public.app_request_ticket_call(uuid,uuid,uuid,text),
  public.app_ticket_call_command(text,uuid,uuid),public.app_configure_ticket_call_settings(boolean,uuid,integer) to authenticated;
