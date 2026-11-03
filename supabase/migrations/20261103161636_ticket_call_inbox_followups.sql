-- Personal saves govern call eligibility, independently of legacy Inbox visibility.
-- No backfill: the global timestamp cannot establish who personally saved a Ticket.
create table private.ticket_inbox_memberships (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default clock_timestamp(),
  primary key(ticket_id, profile_id)
);
create index ticket_inbox_memberships_profile on private.ticket_inbox_memberships(profile_id,ticket_id);
alter table private.ticket_inbox_memberships enable row level security;
alter table private.ticket_inbox_memberships force row level security;
revoke all on private.ticket_inbox_memberships from public,anon,authenticated,service_role;

create or replace function public.app_add_ticket_to_inbox(p_ticket_id uuid)
returns public.tickets language plpgsql security definer set search_path='' as $$
declare t public.tickets; saved_at timestamptz;
begin
  perform private.require_tickets_write(private.current_tenant_id());
  perform private.require_permission('tickets.edit');
  if not private.is_internal_user() then raise exception 'Ticket unavailable' using errcode='42501'; end if;
  select * into t from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id() for update;
  if t.id is null then raise no_data_found; end if;
  perform private.require_ticket_access(t.id);
  insert into private.ticket_inbox_memberships(ticket_id,profile_id) values(t.id,auth.uid())
    on conflict do nothing returning added_at into saved_at;
  if saved_at is not null then
    perform private.record_ticket_activity(t.id,'ticket.inbox_added','Saved this Ticket to personal Inbox.','{}'::jsonb,auth.uid());
  end if;
  select coalesce(t.inbox_added_at,added_at) into t.inbox_added_at from private.ticket_inbox_memberships where ticket_id=t.id and profile_id=auth.uid();
  return t;
end $$;

-- Keep the authorized legacy Inbox visible; only explicit saves confer call eligibility.
alter function public.app_list_ticket_summaries(boolean,boolean) set schema private;
alter function private.app_list_ticket_summaries(boolean,boolean) rename to ticket_summaries_before_personal_inbox;
revoke all on function private.ticket_summaries_before_personal_inbox(boolean,boolean) from public,anon,authenticated,service_role;
create function public.app_list_ticket_summaries(p_include_archived boolean default false,p_inbox_only boolean default false)
returns table(ticket_id uuid,public_ref text,company_id uuid,company_name text,client_profile_id uuid,client_name text,
 subject text,status text,priority text,assigned_to_profile_id uuid,assigned_to_name text,message_count bigint,
 last_message_at timestamptz,created_at timestamptz,updated_at timestamptz,archived_at timestamptz,inbox_added_at timestamptz,personal_inbox_added_at timestamptz,unanswered boolean)
language sql stable security definer set search_path='' as $$
 select s.ticket_id,s.public_ref,s.company_id,s.company_name,s.client_profile_id,s.client_name,s.subject,s.status,s.priority,
   s.assigned_to_profile_id,s.assigned_to_name,s.message_count,s.last_message_at,s.created_at,s.updated_at,s.archived_at,
   case when private.is_internal_user() then coalesce(s.inbox_added_at,saved.added_at) end,
   case when private.is_internal_user() then saved.added_at end,
   case when private.is_internal_user() then coalesce(latest.author_type='client',false) end
 from private.ticket_summaries_before_personal_inbox(p_include_archived,false) s
 left join private.ticket_inbox_memberships saved on saved.ticket_id=s.ticket_id and saved.profile_id=auth.uid()
 left join lateral (
   select m.author_type from public.ticket_messages m where m.ticket_id=s.ticket_id
     and m.visibility='client' and m.message_kind in ('initial_request','reply')
     and m.unsent_at is null and m.author_type in ('client','internal')
   order by m.created_at desc,m.id desc limit 1
 ) latest on true
 where not coalesce(p_inbox_only,false) or (private.is_internal_user() and (s.inbox_added_at is not null or saved.ticket_id is not null))
 order by s.updated_at desc,s.ticket_id;
$$;
revoke all on function public.app_list_ticket_summaries(boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.app_list_ticket_summaries(boolean,boolean) to authenticated;

alter function public.app_get_ticket_detail_with_avatars(uuid) set schema private;
alter function private.app_get_ticket_detail_with_avatars(uuid) rename to ticket_detail_before_personal_inbox;
revoke all on function private.ticket_detail_before_personal_inbox(uuid) from public,anon,authenticated,service_role;
create function public.app_get_ticket_detail_with_avatars(p_ticket_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare value jsonb; saved_at timestamptz;
begin
 value:=private.ticket_detail_before_personal_inbox(p_ticket_id);
 if private.is_internal_user() and value is not null then
   select added_at into saved_at from private.ticket_inbox_memberships where ticket_id=p_ticket_id and profile_id=auth.uid();
   value:=jsonb_set(value,'{ticket,inbox_added_at}',coalesce(nullif(value#>'{ticket,inbox_added_at}','null'::jsonb),to_jsonb(saved_at),'null'::jsonb));
   value:=jsonb_set(value,'{ticket,personal_inbox_added_at}',coalesce(to_jsonb(saved_at),'null'::jsonb));
 end if;
 return value;
end $$;
revoke all on function public.app_get_ticket_detail_with_avatars(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_ticket_detail_with_avatars(uuid) to authenticated;

create function private.ticket_call_saved_recipient_allowed(p_profile uuid,p_ticket uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.ticket_call_profile_allowed(p_profile,p_ticket,true) and exists(
   select 1 from private.ticket_inbox_memberships saved
   join public.tickets t on t.id=saved.ticket_id
   join public.tenant_memberships m on m.tenant_id=t.tenant_id and m.profile_id=saved.profile_id
   where saved.ticket_id=p_ticket and saved.profile_id=p_profile and m.account_class='internal' and m.archived_at is null
 );
$$;
revoke all on function private.ticket_call_saved_recipient_allowed(uuid,uuid) from public,anon,authenticated,service_role;

create function private.ticket_call_person(p_profile uuid,p_tenant uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',left(coalesce(nullif(p.display_name,''),'Wolf Forge participant'),200),
   'avatarUrl',p.avatar_url,'role',case when m.account_class='client' then 'Client' when r.name='owner' then 'Owner'
     when r.name='admin' then 'Administrator' when r.name='manager' then 'Manager' else coalesce(initcap(r.name),'Team member') end)
 from public.profiles p left join public.tenant_memberships m on m.profile_id=p.id and m.tenant_id=p_tenant
 left join public.roles r on r.id=m.role_id where p.id=p_profile;
$$;
revoke all on function private.ticket_call_person(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.app_ticket_call_prepare(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb; t public.tickets; candidates jsonb; peer jsonb;
begin
 value:=public.app_ticket_call_current(p_ticket_id,null);
 if value->>'enabled' is distinct from 'true' or value->'call'<>'null'::jsonb then return value; end if;
 select * into t from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id();
 if value->>'accountClass'='client' then
   select coalesce(jsonb_agg(person order by person->>'name',person->>'profileId'),'[]'::jsonb) into candidates
   from (select private.ticket_call_person(saved.profile_id,t.tenant_id)||jsonb_build_object('profileId',saved.profile_id) person
     from private.ticket_inbox_memberships saved where saved.ticket_id=t.id
       and saved.profile_id<>auth.uid() and private.ticket_call_saved_recipient_allowed(saved.profile_id,t.id)
     order by saved.profile_id limit 100) eligible;
   return value||jsonb_build_object('peer',null,'candidates',candidates);
 end if;
 if t.client_profile_id is not null and t.client_profile_id<>auth.uid()
   and private.ticket_call_profile_allowed(t.client_profile_id,t.id) then
   peer:=private.ticket_call_person(t.client_profile_id,t.tenant_id);
 end if;
 return value||jsonb_build_object('peer',peer,'enabled',peer is not null);
end $$;

-- The four-argument API must not remain an automatic-routing escape hatch.
create or replace function public.app_request_ticket_call(p_ticket_id uuid,p_request_id uuid,p_device_id uuid,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.app_request_ticket_call(p_ticket_id,p_request_id,p_device_id,p_mode,null);
end $$;

-- The following replacements retain admission, budget, session/device, expiry
-- and provider reconciliation machinery; selection is the only new authority.

create function public.app_request_ticket_call(p_ticket_id uuid,p_request_id uuid,p_device_id uuid,p_mode text,p_recipient_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets; c private.ticket_calls; settings private.ticket_call_settings; env private.ticket_call_environment;
  sid uuid; callee uuid; direction_value text; stamp timestamptz; refusal text; slice record;
  used numeric; tenant_used numeric; new_id uuid:=extensions.gen_random_uuid();
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
    if c.ticket_id<>t.id or c.mode<>p_mode or c.caller_session_id<>sid or c.caller_device_id<>p_device_id or (p_recipient_id is not null and c.callee_profile_id is distinct from p_recipient_id) or (c.direction='client_to_team' and p_recipient_id is null) then
      raise exception 'Call request conflicts' using errcode='22023'; end if;
    if c.state<>'ended' and c.direction='client_to_team' and not private.ticket_call_saved_recipient_allowed(c.callee_profile_id,t.id) then
      raise exception 'Call unavailable' using errcode='42501'; end if;
    return private.ticket_call_projection(c);
  end if;
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

create or replace function private.process_ticket_call_deadlines() returns integer
language plpgsql security definer set search_path='' as $$
declare c private.ticket_calls; n integer:=0; stamp timestamptz;
begin
  perform private.ticket_call_lock(); stamp:=clock_timestamp();
  for c in select * from private.ticket_calls where not legacy and state<>'ended'
    order by created_at limit 100 for update loop
    if not private.ticket_call_enabled(c.tenant_id)
      or not private.ticket_call_profile_allowed(c.initiated_by,c.ticket_id)
      or not private.ticket_call_profile_allowed(c.callee_profile_id,c.ticket_id)
      or (c.direction='client_to_team' and not private.ticket_call_saved_recipient_allowed(c.callee_profile_id,c.ticket_id))
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

create or replace function public.app_ticket_call_current(p_ticket_id uuid default null,p_call_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; tenant uuid; account text; c private.ticket_calls; peer jsonb; allowed boolean;
begin
  sid:=private.ticket_call_session(); tenant:=private.current_tenant_id();
  select m.account_class into account from public.tenant_memberships m
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    join public.tenants t on t.id=m.tenant_id and t.status='active' and t.archived_at is null
    where m.tenant_id=tenant and m.profile_id=auth.uid() and m.archived_at is null;
  if account is null or account not in ('internal','client') or (p_ticket_id is not null and p_call_id is not null) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  perform private.consume_rate_limit('ticket-call-current',auth.uid()::text,interval '1 minute',60);
  if p_ticket_id is not null and not private.ticket_call_profile_allowed(auth.uid(),p_ticket_id) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if p_call_id is not null then
    select * into c from private.ticket_calls where id=p_call_id and tenant_id=tenant
      and not legacy and auth.uid()=any(participants);
  else
    select call.* into c from private.ticket_call_claims claim join private.ticket_calls call on call.id=claim.call_id
      where claim.profile_id=auth.uid() and call.tenant_id=tenant and not call.legacy
        and call.state<>'ended' and (p_ticket_id is null or call.ticket_id=p_ticket_id);
  end if;
  if c.id is not null then
    if not private.ticket_call_profile_allowed(auth.uid(),c.ticket_id,false) then c:=null;
    else
      perform private.process_ticket_call_deadlines();
      select * into c from private.ticket_calls where id=c.id;
      peer:=private.ticket_call_person(case when c.initiated_by=auth.uid() then c.callee_profile_id else c.initiated_by end,c.tenant_id);
    end if;
  end if;
  allowed:=private.ticket_call_enabled(tenant) and
    (case when c.id is not null then private.ticket_call_profile_allowed(auth.uid(),c.ticket_id)
      when p_ticket_id is not null then true else
        private.profile_has_permission_in_tenant(auth.uid(),tenant,'tickets.reply') end);
  return jsonb_build_object('enabled',allowed,'profileId',auth.uid(),'accountClass',account,
    'call',case when c.id is null then null else private.ticket_call_projection(c) end,
    'peer',peer,'ticketId',coalesce(c.ticket_id,p_ticket_id));
end $$;

create or replace function public.app_ticket_call_history(p_ticket_id uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.ticket_call_session();
  if not private.ticket_call_profile_allowed(auth.uid(),p_ticket_id,false)
    or not exists(select 1 from public.tickets where id=p_ticket_id and tenant_id=private.current_tenant_id()) then
    raise exception 'Call unavailable' using errcode='42501'; end if;
  if (p_before is null)<>(p_before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  perform private.consume_rate_limit('ticket-call-history',auth.uid()::text,interval '1 minute',60);
  select coalesce(jsonb_agg(private.ticket_call_projection(c)||jsonb_build_object('caller',private.ticket_call_person(c.initiated_by,c.tenant_id),'callee',private.ticket_call_person(c.callee_profile_id,c.tenant_id)) order by c.created_at desc,c.id desc),'[]'::jsonb) into result
  from (select * from private.ticket_calls where ticket_id=p_ticket_id and not legacy and auth.uid()=any(participants)
    and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50) c;
  return result;
end $$;

-- Only the actor's own Tenant/profile topic. No table rows, tokens or names are broadcast.
create function private.ticket_call_signal_allowed(p_topic text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid; sid uuid;
begin
 if p_topic !~ '^ticket-calls:[a-f0-9-]{36}:[a-f0-9-]{36}$' or split_part(p_topic,':',3) is distinct from auth.uid()::text then return false; end if;
 tenant:=split_part(p_topic,':',2)::uuid; sid:=(auth.jwt()->>'session_id')::uuid;
 return private.ticket_call_enabled(tenant)
   and exists(select 1 from auth.sessions where id=sid and user_id=auth.uid() and (not_after is null or not_after>now()))
   and exists(select 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id and p.archived_at is null
     join public.tenants t on t.id=m.tenant_id and t.archived_at is null and t.status='active'
     where m.tenant_id=tenant and m.profile_id=auth.uid() and m.archived_at is null and m.account_class in ('internal','client'))
   and private.profile_has_permission_in_tenant(auth.uid(),tenant,'tickets.view')
   and private.profile_has_permission_in_tenant(auth.uid(),tenant,'tickets.reply')
   and exists(select 1 from private.ticket_call_environment where pilot_profile_ids is null or auth.uid()=any(pilot_profile_ids));
exception when invalid_text_representation then return false;
end $$;
revoke all on function private.ticket_call_signal_allowed(text) from public,anon,authenticated,service_role;
grant execute on function private.ticket_call_signal_allowed(text) to authenticated;

create function public.app_ticket_call_signal_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare topic text;
begin
 perform private.ticket_call_session();
 perform private.consume_rate_limit('ticket-call-events',auth.uid()::text,interval '1 minute',12);
 topic:='ticket-calls:'||private.current_tenant_id()::text||':'||auth.uid()::text;
 if not private.ticket_call_signal_allowed(topic) then return null; end if;
 return jsonb_build_object('topic',topic);
end $$;
revoke all on function public.app_ticket_call_signal_context() from public,anon,authenticated,service_role;
grant execute on function public.app_ticket_call_signal_context() to authenticated;

create policy ticket_call_signal_receive on realtime.messages for select to authenticated
 using(extension='broadcast' and topic=(select realtime.topic()) and private.ticket_call_signal_allowed(topic));
create policy ticket_call_signal_receive_guard on realtime.messages as restrictive for select to authenticated
 using(topic not like 'ticket-calls:%' or (extension='broadcast' and topic=(select realtime.topic()) and private.ticket_call_signal_allowed(topic)));
create policy ticket_call_signal_no_browser_send on realtime.messages as restrictive for insert to authenticated
 with check(topic not like 'ticket-calls:%');

create function private.ticket_call_signal() returns trigger
language plpgsql security definer set search_path='' as $$
declare participant uuid;
begin
 if not new.legacy then
   foreach participant in array new.participants loop
     perform realtime.send('{}'::jsonb,'call','ticket-calls:'||new.tenant_id::text||':'||participant::text,true);
   end loop;
 end if;
 return new;
end $$;
revoke all on function private.ticket_call_signal() from public,anon,authenticated,service_role;
create trigger ticket_call_signal after insert or update of version on private.ticket_calls
 for each row execute function private.ticket_call_signal();

-- Preserve the notification's original recipient/authority; change only its destination.
create or replace function private.ticket_call_missed_bell() returns trigger
language plpgsql security definer set search_path='' as $$
declare member_class text; company uuid;
begin
 if new.outcome='missed' and old.outcome is distinct from 'missed'
   and private.ticket_call_profile_allowed(new.callee_profile_id,new.ticket_id,false) then
   select m.account_class,t.company_id into member_class,company from public.tenant_memberships m
     join public.tickets t on t.tenant_id=m.tenant_id and t.id=new.ticket_id
     where m.profile_id=new.callee_profile_id and m.tenant_id=new.tenant_id and m.archived_at is null;
   insert into public.notifications(recipient_profile_id,tenant_id,company_id,audience,category,title,body,href,entity_type,entity_id,actor_profile_id,event_key)
   values(new.callee_profile_id,new.tenant_id,company,member_class,'ticket','Missed call','Open the Ticket conversation to follow up.',
     case when member_class='client' then '/account/messages/'||new.ticket_id::text
       else '/tickets/'||new.ticket_id::text||'?inbox=tickets&ticket='||new.ticket_id::text end,
     'ticket',new.ticket_id,new.initiated_by,'ticket-call-missed:'||new.id::text)
   on conflict(recipient_profile_id,event_key) do nothing;
 end if;
 return new;
end $$;
update public.notifications set href=case when audience='client' then '/account/messages/'||entity_id::text
 else '/tickets/'||entity_id::text||'?inbox=tickets&ticket='||entity_id::text end
 where event_key like 'ticket-call-missed:%' and category='ticket' and entity_type='ticket' and entity_id is not null;

revoke all on function public.app_request_ticket_call(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_request_ticket_call(uuid,uuid,uuid,text,uuid) to authenticated;
comment on function public.app_request_ticket_call(uuid,uuid,uuid,text,uuid) is
 'Client must select one currently eligible personal Inbox saver. Supersedes assigned/fallback routing. All original admission and media safeguards remain.';

-- Expiry-triggered hang-up cannot turn an unanswered invitation into a user cancellation.
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
    return jsonb_build_object('id',c.id,'participantId',auth.uid(),'roomName','wf-call-'||c.id::text,'mode',c.mode,'expiresAt',c.expires_at);
  end if;
  select * into c from private.ticket_calls where id=p_call_id;
  return private.ticket_call_projection(c);
end $$;

-- Endpoint ownership is symmetric across message and call enrollment.
create or replace function public.app_set_my_push_subscription(p_endpoint text,p_origin text,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor record; config private.studio_push_configuration; existing private.push_subscriptions;
begin
  select * into actor from private.require_push_actor();
  perform private.consume_rate_limit('push.subscription',actor.profile_id::text,interval '1 minute',20);
  if p_enabled is null or not coalesce(private.push_endpoint_allowed(p_endpoint),false) then
    raise exception 'invalid push subscription' using errcode='22023'; end if;
  select * into config from private.studio_push_configuration where enabled and tenant_id=actor.tenant_id and origin=p_origin;
  if not found or not exists(select 1 from public.tenant_domains d where d.tenant_id=actor.tenant_id
    and d.host=substring(p_origin from 9) and d.verified_at is not null and d.disabled_at is null) then
    raise exception 'push is unavailable' using errcode='42501'; end if;
  -- Serialize the device cap and competing claims before ownership checks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push:'||actor.profile_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_endpoint,0));
  select * into existing from private.push_subscriptions where endpoint=p_endpoint for update;
  if found and (existing.profile_id<>actor.profile_id or existing.tenant_id<>actor.tenant_id or existing.origin<>p_origin) then
    raise exception 'subscription is not available' using errcode='42501'; end if;
  if p_enabled and exists(select 1 from private.ticket_call_push_devices where endpoint=p_endpoint
    and (profile_id<>actor.profile_id or tenant_id<>actor.tenant_id or origin<>p_origin)) then
    raise exception 'subscription is not available' using errcode='42501'; end if;
  if not p_enabled then
    update private.push_subscriptions set enabled=false,updated_at=now()
      where endpoint=p_endpoint and profile_id=actor.profile_id and tenant_id=actor.tenant_id;
    return true;
  end if;
  if not exists(select 1 from private.push_subscriptions where endpoint=p_endpoint and enabled)
     and (select count(*) from private.push_subscriptions where profile_id=actor.profile_id and enabled and expires_at>now())>=10 then
    raise exception 'device limit reached' using errcode='WF429'; end if;
  insert into private.push_subscriptions(profile_id,tenant_id,session_id,endpoint,origin)
  values(actor.profile_id,actor.tenant_id,actor.session_id,p_endpoint,p_origin)
  on conflict(endpoint) do update set session_id=excluded.session_id,enabled=true,updated_at=now(),expires_at=now()+interval '90 days';
  return true;
end;
$$;

-- A settings gesture may reset this browser's stale foreign-account endpoint.
-- Never expose the previous account, Tenant or session identity.
create function public.app_browser_push_endpoint_state(p_endpoint text,p_origin text) returns text
language plpgsql security definer set search_path='' as $$
declare actor record;
begin
 select * into actor from private.require_call_push_actor();
 perform private.consume_rate_limit('push.endpoint-state',actor.profile_id::text,interval '1 minute',20);
 if not coalesce(private.push_endpoint_allowed(p_endpoint),false) then raise exception 'Invalid endpoint' using errcode='22023'; end if;
 if not exists(select 1 from private.studio_push_configuration c join public.tenant_domains d on d.tenant_id=c.tenant_id
   and d.host=substring(c.origin from 9) and d.verified_at is not null and d.disabled_at is null
   where c.enabled and c.tenant_id=actor.tenant_id and c.origin=p_origin) then
   raise exception 'Push unavailable' using errcode='42501'; end if;
 if exists(select 1 from private.push_subscriptions where endpoint=p_endpoint and
    (profile_id<>actor.profile_id or tenant_id<>actor.tenant_id or origin<>p_origin))
  or exists(select 1 from private.ticket_call_push_devices where endpoint=p_endpoint and
    (profile_id<>actor.profile_id or tenant_id<>actor.tenant_id or origin<>p_origin)) then return 'foreign'; end if;
 if exists(select 1 from private.push_subscriptions where endpoint=p_endpoint)
   or exists(select 1 from private.ticket_call_push_devices where endpoint=p_endpoint) then return 'owned'; end if;
 return 'unregistered';
end $$;
revoke all on function public.app_browser_push_endpoint_state(text,text) from public,anon,authenticated,service_role;
grant execute on function public.app_browser_push_endpoint_state(text,text) to authenticated;

-- Revoked personal saves also suppress pending push before the deadline sweep.
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
    or not private.ticket_call_profile_allowed(actor.profile_id,c.ticket_id)
    or not private.ticket_call_profile_allowed(c.initiated_by,c.ticket_id)
    or not private.ticket_call_profile_allowed(c.callee_profile_id,c.ticket_id)
    or (c.direction='client_to_team' and not private.ticket_call_saved_recipient_allowed(c.callee_profile_id,c.ticket_id))
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
    and private.ticket_call_profile_allowed(c.initiated_by,c.ticket_id)
    and private.ticket_call_profile_allowed(c.callee_profile_id,c.ticket_id)
    and (c.direction<>'client_to_team' or private.ticket_call_saved_recipient_allowed(c.callee_profile_id,c.ticket_id)));
$$;
