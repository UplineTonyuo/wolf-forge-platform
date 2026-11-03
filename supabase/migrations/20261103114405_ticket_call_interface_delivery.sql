-- Separate call opt-in must not enable/disable existing message notifications.
create table private.ticket_call_push_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 1 and 2048),
  origin text not null, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '90 days'
);
alter table private.ticket_call_push_devices enable row level security;
alter table private.ticket_call_push_devices force row level security;
revoke all on private.ticket_call_push_devices from public,anon,authenticated,service_role;
create index ticket_call_push_recipient on private.ticket_call_push_devices(tenant_id,profile_id) where enabled;

create function public.app_ticket_call_current(p_ticket_id uuid default null,p_call_id uuid default null)
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
      select jsonb_build_object('name',left(coalesce(nullif(display_name,''),'Wolf Forge participant'),200),
        'avatarUrl',avatar_url) into peer from public.profiles
        where id=case when c.initiated_by=auth.uid() then c.callee_profile_id else c.initiated_by end
          and archived_at is null;
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

create function private.require_call_push_actor()
returns table(profile_id uuid,tenant_id uuid,session_id uuid)
language plpgsql security definer set search_path='' as $$
declare tenant uuid; sid uuid;
begin
  sid:=private.ticket_call_session(); tenant:=private.current_tenant_id();
  if not exists(select 1 from public.tenant_memberships m
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    join public.tenants t on t.id=m.tenant_id and t.archived_at is null and t.status='active'
    where m.profile_id=auth.uid() and m.tenant_id=tenant and m.archived_at is null
      and m.account_class in ('internal','client')) then
    raise exception 'Call notifications unavailable' using errcode='42501'; end if;
  return query select auth.uid(),tenant,sid;
end $$;

create function public.app_get_my_call_push_configuration() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor record; config private.studio_push_configuration;
begin
  select * into actor from private.require_call_push_actor();
  if not private.ticket_call_enabled(actor.tenant_id) or
    not private.profile_has_permission_in_tenant(actor.profile_id,actor.tenant_id,'tickets.reply') then return null; end if;
  select * into config from private.studio_push_configuration where enabled and tenant_id=actor.tenant_id;
  if not found then return null; end if;
  return jsonb_build_object('publicKey',config.public_key,'origin',config.origin);
end $$;

create function public.app_set_my_call_push_subscription(p_endpoint text,p_origin text,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor record; existing private.ticket_call_push_devices;
begin
  select * into actor from private.require_call_push_actor();
  perform private.consume_rate_limit('call-push.subscription',actor.profile_id::text,interval '1 minute',20);
  if p_enabled is null or not coalesce(private.push_endpoint_allowed(p_endpoint),false) then
    raise exception 'Invalid push subscription' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push:'||actor.profile_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  select * into existing from private.ticket_call_push_devices where endpoint=p_endpoint for update;
  if found and (existing.profile_id<>actor.profile_id or existing.tenant_id<>actor.tenant_id or existing.origin<>p_origin) then
    raise exception 'Subscription unavailable' using errcode='42501'; end if;
  if not p_enabled then
    update private.ticket_call_push_devices set enabled=false,updated_at=now()
      where endpoint=p_endpoint and profile_id=actor.profile_id and tenant_id=actor.tenant_id and session_id=actor.session_id;
    return true;
  end if;
  if public.app_get_my_call_push_configuration() is null or not exists(
    select 1 from private.studio_push_configuration c join public.tenant_domains d on d.tenant_id=c.tenant_id
      and d.host=substring(c.origin from 9) and d.verified_at is not null and d.disabled_at is null
    where c.enabled and c.tenant_id=actor.tenant_id and c.origin=p_origin) then
    raise exception 'Call notifications unavailable' using errcode='42501'; end if;
  if exists(select 1 from private.push_subscriptions where endpoint=p_endpoint and
    (profile_id<>actor.profile_id or tenant_id<>actor.tenant_id or origin<>p_origin)) then
    raise exception 'Subscription unavailable' using errcode='42501'; end if;
  if not exists(select 1 from private.ticket_call_push_devices where endpoint=p_endpoint and enabled and expires_at>now())
    and (select count(*) from private.ticket_call_push_devices where profile_id=actor.profile_id and enabled and expires_at>now())>=10 then
    raise exception 'Device limit reached' using errcode='WF429'; end if;
  insert into private.ticket_call_push_devices(profile_id,tenant_id,session_id,endpoint,origin,enabled)
    values(actor.profile_id,actor.tenant_id,actor.session_id,p_endpoint,p_origin,true)
    on conflict(endpoint) do update set session_id=excluded.session_id,enabled=true,
      updated_at=now(),expires_at=now()+interval '90 days';
  return true;
end $$;

create function public.app_my_call_push_status(p_endpoint text) returns jsonb
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
    or c.expires_at<=clock_timestamp()
    or (c.state='ringing' and c.ring_deadline<=clock_timestamp())) then c:=null; end if;
  return jsonb_build_object('active',true,'call',case when c.id is null then null else
    jsonb_build_object('id',c.id,'version',c.version) end);
end $$;

revoke all on function public.app_ticket_call_current(uuid,uuid),private.require_call_push_actor(),
  public.app_get_my_call_push_configuration(),public.app_set_my_call_push_subscription(text,text,boolean),
  public.app_my_call_push_status(text) from public,anon,authenticated,service_role;
grant execute on function public.app_ticket_call_current(uuid,uuid),public.app_get_my_call_push_configuration(),
  public.app_set_my_call_push_subscription(text,text,boolean),public.app_my_call_push_status(text) to authenticated;

create table private.ticket_call_push_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  call_id uuid not null references private.ticket_calls(id) on delete cascade,
  device_id uuid not null references private.ticket_call_push_devices(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
  state text not null default 'pending' check(state in ('pending','sending','accepted','rejected','unknown','suppressed')),
  attempt_id uuid, attempted_at timestamptz, finished_at timestamptz, http_status integer,
  unique(call_id,device_id)
);
alter table private.ticket_call_push_deliveries enable row level security;
alter table private.ticket_call_push_deliveries force row level security;
revoke all on private.ticket_call_push_deliveries from public,anon,authenticated,service_role;
create index ticket_call_push_pending on private.ticket_call_push_deliveries(created_at) where state='pending';

create function private.call_push_delivery_visible(p_delivery uuid) returns boolean
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
    and private.ticket_call_profile_allowed(c.callee_profile_id,c.ticket_id));
$$;

create function private.wake_ticket_call_push() returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.studio_push_configuration; key text;
begin
  update private.ticket_call_push_deliveries set state='unknown',finished_at=clock_timestamp()
    where state='sending' and attempted_at<clock_timestamp()-interval '1 minute';
  update private.ticket_call_push_deliveries set state='suppressed',finished_at=clock_timestamp()
    where state='pending' and expires_at<=clock_timestamp();
  delete from private.ticket_call_push_deliveries where created_at<clock_timestamp()-interval '30 days';
  delete from private.ticket_call_push_devices where expires_at<clock_timestamp()-interval '30 days'
    or (not enabled and updated_at<clock_timestamp()-interval '30 days');
  if not exists(select 1 from private.ticket_call_push_deliveries where state='pending') then return; end if;
  select * into cfg from private.studio_push_configuration where enabled;
  if not found then return; end if;
  select decrypted_secret into key from vault.decrypted_secrets where id=cfg.api_key_secret_id;
  if key is null then return; end if;
  perform net.http_post(url:=cfg.project_url||'/functions/v1/studio-web-push',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',key),body:='{}'::jsonb,timeout_milliseconds:=8000);
exception when others then raise log 'Call push wake unavailable';
end $$;

create function private.enqueue_ticket_call_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.legacy or new.state<>'ringing' or new.callee_profile_id is null then return new; end if;
  insert into private.ticket_call_push_deliveries(call_id,device_id,expires_at)
    select new.id,d.id,new.ring_deadline from private.ticket_call_push_devices d
    join private.studio_push_configuration cfg on cfg.enabled and cfg.tenant_id=d.tenant_id and cfg.origin=d.origin
    where d.profile_id=new.callee_profile_id and d.tenant_id=new.tenant_id and d.enabled and d.expires_at>clock_timestamp()
    on conflict do nothing;
  if found then perform private.wake_ticket_call_push(); end if;
  return new;
exception when others then raise log 'Call push enqueue unavailable'; return new;
end $$;
create trigger ticket_call_push_enqueue after insert on private.ticket_calls
  for each row execute function private.enqueue_ticket_call_push();

create function public.app_claim_ticket_call_push_deliveries() returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.ticket_call_push_deliveries; claim uuid; claimed jsonb:='[]';
begin
  for d in select * from private.ticket_call_push_deliveries where state='pending'
    order by created_at limit 10 for update skip locked loop
    if not private.call_push_delivery_visible(d.id) then
      update private.ticket_call_push_deliveries set state='suppressed',finished_at=clock_timestamp() where id=d.id;
      continue;
    end if;
    claim:=extensions.gen_random_uuid();
    update private.ticket_call_push_deliveries set state='sending',attempt_id=claim,attempted_at=clock_timestamp() where id=d.id;
    claimed:=claimed||jsonb_build_array(jsonb_build_object('id',d.id,'attemptId',claim,
      'endpoint',(select endpoint from private.ticket_call_push_devices where id=d.device_id),
      'ttl',greatest(1,least(40,floor(extract(epoch from d.expires_at-clock_timestamp()))::integer))));
  end loop;
  return claimed;
end $$;

create function public.app_finish_ticket_call_push_delivery(p_delivery_id uuid,p_attempt_id uuid,p_outcome text,p_http_status integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare matched private.ticket_call_push_deliveries;
begin
  if p_outcome is null or p_outcome not in ('accepted','rejected','unknown')
    or (p_http_status is not null and p_http_status not between 100 and 599)
    or (p_outcome='accepted' and (p_http_status is null or p_http_status not between 200 and 299)) then
    raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  update private.ticket_call_push_deliveries set state=p_outcome,http_status=p_http_status,finished_at=clock_timestamp()
    where id=p_delivery_id and attempt_id=p_attempt_id and state='sending' returning * into matched;
  if not found then return false; end if;
  if p_http_status in (404,410) then update private.ticket_call_push_devices set enabled=false,updated_at=now() where id=matched.device_id; end if;
  return true;
end $$;

do $$
begin
  if exists(select 1 from cron.job where jobname='wf-ticket-calls-push-recovery-v1' and
    (schedule<>'10 seconds' or command<>'select private.wake_ticket_call_push()')) then
    raise exception 'Call push recovery job conflict'; end if;
  if not exists(select 1 from cron.job where jobname='wf-ticket-calls-push-recovery-v1') then
    perform cron.schedule('wf-ticket-calls-push-recovery-v1','10 seconds','select private.wake_ticket_call_push()');
  end if;
end $$;
revoke all on function private.call_push_delivery_visible(uuid),private.wake_ticket_call_push(),private.enqueue_ticket_call_push(),
  public.app_claim_ticket_call_push_deliveries(),public.app_finish_ticket_call_push_delivery(uuid,uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.app_claim_ticket_call_push_deliveries(),
  public.app_finish_ticket_call_push_delivery(uuid,uuid,text,integer) to service_role;
