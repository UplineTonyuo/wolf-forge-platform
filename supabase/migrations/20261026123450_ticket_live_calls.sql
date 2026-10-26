create table private.ticket_calls (
  id uuid primary key,
  ticket_id uuid not null references public.tickets(id),
  tenant_id uuid not null references public.tenants(id),
  initiated_by uuid not null references public.profiles(id),
  mode text not null check (mode in ('audio','video')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  state text not null default 'reserved' check (state in ('reserved','ready','ended')),
  participants uuid[] not null,
  token_attempts integer not null default 0 check (token_attempts between 0 and 8),
  check (cardinality(participants) between 1 and 2),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes 1 second')
);
create index ticket_calls_ticket_expiry on private.ticket_calls(ticket_id,expires_at);
create index ticket_calls_created on private.ticket_calls(created_at);
create index ticket_calls_expiry on private.ticket_calls(expires_at);
alter table private.ticket_calls enable row level security;
alter table private.ticket_calls force row level security;
revoke all on private.ticket_calls from public, anon, authenticated, service_role;

create function public.app_ticket_call(
  p_action text, p_ticket_id uuid, p_request_id uuid default null,
  p_call_id uuid default null, p_mode text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor record; target public.tickets; session private.ticket_calls;
  stamp timestamptz := clock_timestamp(); created boolean := false; ending boolean := false; sid uuid;
begin
  if p_action not in ('status','reserve','join','end') or p_action is null then
    raise exception 'Invalid call operation' using errcode='22023';
  end if;
  select * into actor from private.current_ticket_actor();
  begin sid:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then sid:=null; end;
  if sid is null or not exists(
    select 1 from auth.sessions s join public.profiles p on p.id=s.user_id
    join public.tenant_memberships m on m.profile_id=p.id and m.tenant_id=private.current_tenant_id()
    join public.tenants t on t.id=m.tenant_id
    where s.id=sid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>stamp)
      and p.archived_at is null and m.archived_at is null and t.status='active' and t.archived_at is null
      and (m.account_class='internal' or exists(select 1 from public.companies c
        where c.id=m.company_id and c.tenant_id=t.id and c.archived_at is null))
  ) then raise exception 'Active session required' using errcode='42501'; end if;
  perform public.app_require_module_access(case when actor.role_name='client' then 'portal_tickets' else 'tickets' end);
  target := private.require_ticket_access(p_ticket_id);
  if actor.profile_id is null or target.id is null or target.archived_at is not null
     or target.status in ('closed','resolved') or not private.current_user_has_permission('tickets.reply') then
    raise exception 'Call unavailable' using errcode='42501';
  end if;
  if target.order_id is not null then perform private.require_order_conversation_access(target.order_id); end if;
  if p_action='status' then
    perform private.consume_rate_limit('ticket-call-status',actor.profile_id::text,interval '1 minute',120);
    select * into session from private.ticket_calls where ticket_id=target.id and tenant_id=target.tenant_id
      and expires_at>stamp and state<>'ended' order by created_at desc limit 1;
    if session.id is null then return null; end if;
    return jsonb_build_object('id',session.id,'mode',session.mode,'expiresAt',session.expires_at,
      'state',session.state,'isCaller',session.initiated_by=actor.profile_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ticket-live-calls',0));
  if p_action='reserve' then
    delete from private.ticket_calls where expires_at<stamp-interval '90 days';
    perform private.consume_rate_limit('ticket-call-provider-actor',actor.profile_id::text,interval '1 minute',12);
    perform private.consume_rate_limit('ticket-call-provider-global','daily',interval '1 minute',60);
    if p_request_id is null or p_mode not in ('audio','video') or p_mode is null then
      raise exception 'Invalid call request' using errcode='22023';
    end if;
    select * into session from private.ticket_calls where id=p_request_id;
    if session.id is not null and (session.ticket_id<>target.id or session.tenant_id<>target.tenant_id
       or session.initiated_by<>actor.profile_id or session.mode<>p_mode) then
      raise exception 'Call request conflicts' using errcode='22023';
    end if;
    if session.id is null then
      select * into session from private.ticket_calls where ticket_id=target.id and tenant_id=target.tenant_id
        and expires_at>stamp and state<>'ended' order by created_at desc limit 1;
    end if;
    if session.id is null then
      -- Reserve the entire possible participant duration, even if setup fails.
      if (select count(*) from private.ticket_calls where expires_at>(date_trunc('month',stamp at time zone 'UTC') at time zone 'UTC'))>=200
        or (select count(*) from private.ticket_calls where initiated_by=actor.profile_id and created_at>=stamp-interval '1 day')>=6
        or (select count(*) from private.ticket_calls where expires_at>stamp)>=4 then
        raise exception 'Call usage limit reached' using errcode='P0001';
      end if;
      insert into private.ticket_calls(id,ticket_id,tenant_id,initiated_by,mode,participants)
      values(p_request_id,target.id,target.tenant_id,actor.profile_id,p_mode,array[actor.profile_id]) returning * into session;
      created := true;
    end if;
  else
    select * into session from private.ticket_calls where id=p_call_id and ticket_id=target.id and tenant_id=target.tenant_id;
    if session.id is null then raise exception 'Call unavailable' using errcode='42501'; end if;
    if p_action='end' then
      perform private.consume_rate_limit('ticket-call-end',actor.profile_id::text,interval '1 minute',12);
      if not actor.profile_id=any(session.participants) then raise exception 'Call unavailable' using errcode='42501'; end if;
      ending := session.state<>'ended';
      update private.ticket_calls set state='ended' where id=session.id returning * into session;
    elsif p_action='join' then
      if session.state<>'ready' or session.expires_at<=stamp then raise exception 'Call unavailable' using errcode='42501'; end if;
      if not actor.profile_id=any(session.participants) and cardinality(session.participants)>=2 then
        raise exception 'This call already has two participants' using errcode='42501';
      end if;
      if session.token_attempts>=8 then raise exception 'Call connection limit reached' using errcode='P0001'; end if;
      perform private.consume_rate_limit('ticket-call-token',actor.profile_id::text,interval '1 minute',6);
      update private.ticket_calls set participants=case when actor.profile_id=any(participants) then participants else array_append(participants,actor.profile_id) end,
        token_attempts=token_attempts+1 where id=session.id returning * into session;
    end if;
  end if;
  if p_action<>'end' and (session.expires_at<=clock_timestamp() or session.state='ended') then
    raise exception 'Call expired' using errcode='42501';
  end if;
  return jsonb_build_object('id',session.id,'mode',session.mode,'expiresAt',session.expires_at,
    'state',session.state,'created',created,'endClaim',ending,'participantIds',to_jsonb(session.participants),'roomName','wf-call-'||session.id::text);
end;
$$;
revoke all on function public.app_ticket_call(text,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.app_ticket_call(text,uuid,uuid,uuid,text) to authenticated;

create function public.app_complete_ticket_call_setup(p_call_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update private.ticket_calls set state='ready' where id=p_call_id and state in ('reserved','ready') and expires_at>clock_timestamp();
  if not found then raise exception 'Call unavailable' using errcode='42501'; end if;
end;
$$;
revoke all on function public.app_complete_ticket_call_setup(uuid) from public,anon,authenticated;
grant execute on function public.app_complete_ticket_call_setup(uuid) to service_role;
