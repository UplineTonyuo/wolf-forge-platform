-- Preserve existing RPC names for installed Studio clients and the dispatch job.
create or replace function public.app_configure_studio_push(
  p_project_url text,p_origin text,p_public_key text,p_private_key text,p_api_key text
) returns boolean
language plpgsql security definer set search_path='' as $$
declare config private.studio_push_configuration; tenant uuid; vapid_id uuid; api_id uuid;
begin
  if p_project_url is null or p_origin is null or p_public_key is null or p_private_key is null or p_api_key is null
    or not (
      (p_project_url='https://rsnmlcyopnxucwgfttyf.supabase.co'
        and p_origin ~ '^https://wolf-forge-platform-[a-z0-9]+-wolf-forge[.]vercel[.]app$')
      or (p_project_url='https://jwynqsyirgenqlmkooah.supabase.co'
        and p_origin='https://wolf-forge-platform-woad.vercel.app')
    )
    or p_public_key !~ '^[A-Za-z0-9_-]{87}$' or p_private_key !~ '^[A-Za-z0-9_-]{43}$'
    or length(p_api_key) not between 30 and 4096 then
    raise exception 'invalid push configuration' using errcode='22023';
  end if;
  select d.tenant_id into tenant
  from public.tenant_domains d join public.tenants t on t.id=d.tenant_id
  where d.host=substring(p_origin from 9) and d.verified_at is not null and d.disabled_at is null
    and t.status='active' and t.archived_at is null
    and (p_project_url<>'https://jwynqsyirgenqlmkooah.supabase.co'
      or d.tenant_id=private.wolf_forge_tenant_id());
  if tenant is null then raise exception 'verified push host required' using errcode='42501'; end if;
  select * into config from private.studio_push_configuration where singleton for update;
  if found then
    if config.project_url<>p_project_url then
      raise exception 'push backend cannot change' using errcode='22023';
    end if;
    if config.public_key<>p_public_key then
      raise exception 'push key rotation requires a separate migration' using errcode='22023';
    end if;
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

revoke all on function public.app_configure_studio_push(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.app_configure_studio_push(text,text,text,text,text) to service_role;
