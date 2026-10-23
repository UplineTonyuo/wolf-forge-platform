-- Studio opt-in only. Private subscriptions and generic, payload-free Web Push.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table private.studio_push_configuration (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  project_url text not null,
  origin text not null,
  tenant_id uuid not null references public.tenants(id),
  public_key text not null,
  vapid_secret_id uuid not null,
  api_key_secret_id uuid not null
);
create table private.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null,
  endpoint text not null unique check (length(endpoint) between 1 and 2048),
  origin text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index push_subscriptions_recipient on private.push_subscriptions(tenant_id,profile_id) where enabled;
create table private.push_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
  notification_created_at timestamptz not null,
  message_count integer not null,
  state text not null default 'pending' check (state in ('pending','sending','accepted','rejected','unknown','suppressed','expired')),
  attempt_id uuid unique,
  attempted_at timestamptz,
  finished_at timestamptz,
  http_status integer,
  created_at timestamptz not null default now(),
  unique(notification_id,subscription_id,notification_created_at,message_count),
  check ((state in ('pending','suppressed','expired') and attempt_id is null and attempted_at is null)
    or (state in ('sending','accepted','rejected','unknown') and attempt_id is not null and attempted_at is not null))
);
create index push_deliveries_pending on private.push_deliveries(created_at) where state='pending';
alter table private.studio_push_configuration enable row level security;
alter table private.push_subscriptions enable row level security;
alter table private.push_deliveries enable row level security;
revoke all on private.studio_push_configuration,private.push_subscriptions,private.push_deliveries from public,anon,authenticated;

create function private.push_endpoint_allowed(p_endpoint text) returns boolean
language sql immutable set search_path='' as $$
select length(p_endpoint) between 1 and 2048 and p_endpoint ~
  '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^[:space:]#]+$';
$$;

create function private.require_push_actor()
returns table(profile_id uuid,tenant_id uuid,session_id uuid)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=private.current_tenant_id(); sid uuid;
begin
  begin sid:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then sid:=null; end;
  if actor is null or tenant is null or sid is null or not exists(
    select 1 from auth.sessions s join public.profiles p on p.id=s.user_id
    join public.tenant_memberships m on m.profile_id=p.id and m.tenant_id=tenant
    join public.tenants t on t.id=m.tenant_id
    join public.companies c on c.id=m.company_id and c.tenant_id=t.id
    where s.id=sid and s.user_id=actor and (s.not_after is null or s.not_after>now())
      and p.archived_at is null and m.archived_at is null and m.account_class='client'
      and t.status='active' and t.archived_at is null and c.archived_at is null
  ) then raise exception 'active client session required' using errcode='42501'; end if;
  return query select actor,tenant,sid;
end;
$$;

create function public.app_get_my_push_configuration() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor record; config private.studio_push_configuration;
begin
  select * into actor from private.require_push_actor();
  select * into config from private.studio_push_configuration where enabled and tenant_id=actor.tenant_id;
  if not found then return null; end if;
  return jsonb_build_object('publicKey',config.public_key,'origin',config.origin);
end;
$$;

create function public.app_set_my_push_subscription(p_endpoint text,p_origin text,p_enabled boolean) returns boolean
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

create function public.app_my_push_subscription_active(p_endpoint text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor record;
begin
  select * into actor from private.require_push_actor();
  return exists(select 1 from private.push_subscriptions s join private.studio_push_configuration c
    on c.enabled and c.tenant_id=s.tenant_id and c.origin=s.origin
    where s.endpoint=p_endpoint and s.profile_id=actor.profile_id and s.tenant_id=actor.tenant_id
      and s.session_id=actor.session_id and s.enabled and s.expires_at>now());
end;
$$;

create function public.app_disable_my_push_session() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  update private.push_subscriptions set enabled=false,updated_at=now()
    where profile_id=auth.uid() and session_id::text=auth.jwt()->>'session_id' and enabled;
end;
$$;

create function private.push_delivery_visible(p_delivery_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare sub private.push_subscriptions; notice public.notifications; delivery private.push_deliveries;
  claims text:=current_setting('request.jwt.claims',true); headers text:=current_setting('request.headers',true);
  subject text:=current_setting('request.jwt.claim.sub',true); jwt_role text:=current_setting('request.jwt.claim.role',true);
  visible boolean:=false;
begin
  select * into delivery from private.push_deliveries where id=p_delivery_id;
  if not found then return false; end if;
  select * into sub from private.push_subscriptions where id=delivery.subscription_id and enabled and expires_at>now();
  if not found then return false; end if;
  select * into notice from public.notifications where id=delivery.notification_id and recipient_profile_id=sub.profile_id
    and tenant_id=sub.tenant_id and audience='client' and read_at is null
    and created_at=delivery.notification_created_at and message_count=delivery.message_count
    and created_at>now()-interval '5 minutes';
  if not found or not exists(select 1 from auth.sessions where id=sub.session_id and user_id=sub.profile_id
    and (not_after is null or not_after>now()))
    or not exists(select 1 from private.studio_push_configuration where enabled and tenant_id=sub.tenant_id and origin=sub.origin) then return false; end if;
  -- The service-only worker reuses the canonical recipient reader, never an invented permission shortcut.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',sub.profile_id,'role','authenticated','session_id',sub.session_id)::text,true);
  perform set_config('request.jwt.claim.sub',sub.profile_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.headers',jsonb_build_object('x-wf-tenant',sub.tenant_id)::text,true);
  begin
    perform private.require_push_actor();
    select exists(select 1 from public.app_list_my_notifications(100) n where n.id=notice.id) into visible;
  exception when others then visible:=false; end;
  perform set_config('request.jwt.claims',coalesce(claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(subject,''),true);
  perform set_config('request.jwt.claim.role',coalesce(jwt_role,''),true);
  perform set_config('request.headers',coalesce(headers,''),true);
  return visible;
end;
$$;

create function private.wake_studio_push() returns void
language plpgsql security definer set search_path='' as $$
declare config private.studio_push_configuration; api_key text;
begin
  update private.push_deliveries set state='unknown',finished_at=now()
    where state='sending' and attempted_at<now()-interval '2 minutes';
  update private.push_deliveries set state='expired',finished_at=now()
    where state='pending' and created_at<now()-interval '5 minutes';
  delete from private.push_deliveries where created_at<now()-interval '30 days';
  delete from private.push_subscriptions where expires_at<now()-interval '30 days'
    or (not enabled and updated_at<now()-interval '30 days');
  select * into config from private.studio_push_configuration where enabled;
  if not found or not exists(select 1 from private.push_deliveries where state='pending') then return; end if;
  select decrypted_secret into api_key from vault.decrypted_secrets where id=config.api_key_secret_id;
  if api_key is null then return; end if;
  perform net.http_post(url:=config.project_url||'/functions/v1/studio-web-push',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',api_key),body:='{}'::jsonb,timeout_milliseconds:=30000);
exception when others then
  raise log 'Studio push wake unavailable';
end;
$$;

create function private.enqueue_studio_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.audience<>'client' or new.read_at is not null or new.tenant_id is null then return new; end if;
  insert into private.push_deliveries(notification_id,subscription_id,notification_created_at,message_count)
  select new.id,s.id,new.created_at,new.message_count from private.push_subscriptions s
  join private.studio_push_configuration c on c.enabled and c.tenant_id=s.tenant_id and c.origin=s.origin
  where s.profile_id=new.recipient_profile_id and s.tenant_id=new.tenant_id and s.enabled and s.expires_at>now()
  on conflict do nothing;
  if found then perform private.wake_studio_push(); end if;
  return new;
exception when others then
  -- Push availability must not prevent the original message or in-app notification from saving.
  raise log 'Studio push enqueue unavailable';
  return new;
end;
$$;
create trigger notifications_enqueue_studio_push after insert or update of created_at,message_count
on public.notifications for each row execute function private.enqueue_studio_push();

create function public.app_claim_studio_push_deliveries() returns jsonb
language plpgsql security definer set search_path='' as $$
declare delivery private.push_deliveries; claimed jsonb:='[]'; token uuid;
begin
  for delivery in select * from private.push_deliveries where state='pending' order by created_at limit 10 for update skip locked loop
    if not private.push_delivery_visible(delivery.id) then
      update private.push_deliveries set state='suppressed',finished_at=now() where id=delivery.id;
      continue;
    end if;
    token:=extensions.gen_random_uuid();
    update private.push_deliveries set state='sending',attempt_id=token,attempted_at=now() where id=delivery.id;
    claimed:=claimed||jsonb_build_array(jsonb_build_object('id',delivery.id,'attemptId',token,
      'endpoint',(select endpoint from private.push_subscriptions where id=delivery.subscription_id)));
  end loop;
  return claimed;
end;
$$;

create function public.app_finish_studio_push_delivery(p_delivery_id uuid,p_attempt_id uuid,p_outcome text,p_http_status integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare matched private.push_deliveries;
begin
  if p_outcome is null or p_outcome not in ('accepted','rejected','unknown')
    or (p_http_status is not null and p_http_status not between 100 and 599)
    or (p_outcome='accepted' and (p_http_status is null or p_http_status not between 200 and 299)) then
    raise exception 'invalid delivery outcome' using errcode='22023'; end if;
  update private.push_deliveries set state=p_outcome,http_status=p_http_status,finished_at=now()
    where id=p_delivery_id and attempt_id=p_attempt_id and state='sending' returning * into matched;
  if not found then return false; end if;
  if p_http_status in (404,410) then update private.push_subscriptions set enabled=false,updated_at=now() where id=matched.subscription_id; end if;
  return true;
end;
$$;

create function public.app_get_studio_push_dispatch_settings() returns jsonb
language sql security definer set search_path='' as $$
select jsonb_build_object('origin',c.origin,'projectUrl',c.project_url,'publicKey',c.public_key,
  'privateKey',v.decrypted_secret) from private.studio_push_configuration c
  join vault.decrypted_secrets v on v.id=c.vapid_secret_id where c.enabled;
$$;

create function public.app_configure_studio_push(p_project_url text,p_origin text,p_public_key text,p_private_key text,p_api_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare config private.studio_push_configuration; tenant uuid; vapid_id uuid; api_id uuid;
begin
  -- This release cannot activate push on a live or unrelated backend.
  if p_project_url is null or p_origin is null or p_public_key is null or p_private_key is null or p_api_key is null
    or p_project_url<>'https://rsnmlcyopnxucwgfttyf.supabase.co'
    or p_origin !~ '^https://wolf-forge-platform-[a-z0-9]+-wolf-forge[.]vercel[.]app$'
    or p_public_key !~ '^[A-Za-z0-9_-]{87}$' or p_private_key !~ '^[A-Za-z0-9_-]{43}$'
    or length(p_api_key) not between 30 and 4096 then raise exception 'invalid Studio push configuration' using errcode='22023'; end if;
  select tenant_id into tenant from public.tenant_domains where host=substring(p_origin from 9) and verified_at is not null and disabled_at is null;
  if tenant is null then raise exception 'verified Studio host required' using errcode='42501'; end if;
  select * into config from private.studio_push_configuration where singleton for update;
  if found then
    if config.public_key<>p_public_key then raise exception 'push key rotation requires a separate migration' using errcode='22023'; end if;
    perform vault.update_secret(config.vapid_secret_id,p_private_key);
    perform vault.update_secret(config.api_key_secret_id,p_api_key);
    update private.studio_push_configuration set enabled=true,origin=p_origin,tenant_id=tenant where singleton;
  else
    select vault.create_secret(p_private_key,'studio_push_vapid_private') into vapid_id;
    select vault.create_secret(p_api_key,'studio_push_dispatch_api_key') into api_id;
    insert into private.studio_push_configuration(singleton,enabled,project_url,origin,tenant_id,public_key,vapid_secret_id,api_key_secret_id)
    values(true,true,p_project_url,p_origin,tenant,p_public_key,vapid_id,api_id);
  end if;
  update private.push_subscriptions set enabled=false,updated_at=now() where origin<>p_origin and enabled;
  if not exists(select 1 from cron.job where jobname='studio-web-push-wake') then
    perform cron.schedule('studio-web-push-wake','* * * * *','select private.wake_studio_push()');
  end if;
  return true;
end;
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p where
    (p.pronamespace='private'::regnamespace and (p.proname like 'push_%' or p.proname in ('require_push_actor','wake_studio_push','enqueue_studio_push')))
    or (p.pronamespace='public'::regnamespace and p.proname in ('app_get_my_push_configuration','app_set_my_push_subscription',
      'app_my_push_subscription_active','app_disable_my_push_session','app_claim_studio_push_deliveries',
      'app_finish_studio_push_delivery','app_get_studio_push_dispatch_settings','app_configure_studio_push')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
grant execute on function public.app_get_my_push_configuration(),public.app_set_my_push_subscription(text,text,boolean),
  public.app_my_push_subscription_active(text),public.app_disable_my_push_session() to authenticated;
grant execute on function public.app_claim_studio_push_deliveries(),public.app_finish_studio_push_delivery(uuid,uuid,text,integer),
  public.app_get_studio_push_dispatch_settings(),public.app_configure_studio_push(text,text,text,text,text) to service_role;
