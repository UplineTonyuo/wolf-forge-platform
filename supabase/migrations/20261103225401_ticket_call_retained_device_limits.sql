-- Cap retained endpoints without deleting devices or their delivery receipts.
create index ticket_call_push_profile_retained on private.ticket_call_push_devices(profile_id);
create or replace function public.app_set_my_call_push_subscription(p_endpoint text,p_origin text,p_enabled boolean) returns boolean
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
  if existing.id is null and (select count(*) from private.ticket_call_push_devices where profile_id=actor.profile_id)>=20 then
    raise exception 'Device history limit reached' using errcode='WF429'; end if;
  insert into private.ticket_call_push_devices(profile_id,tenant_id,session_id,endpoint,origin,enabled)
    values(actor.profile_id,actor.tenant_id,actor.session_id,p_endpoint,p_origin,true)
    on conflict(endpoint) do update set session_id=excluded.session_id,enabled=true,
      updated_at=now(),expires_at=now()+interval '90 days';
  return true;
end $$;
