create table private.client_support_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  administrator_id uuid not null references public.profiles(id),
  administrator_auth_session_id uuid not null,
  client_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  capability_hash text not null unique check(capability_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default(clock_timestamp()+interval '15 minutes'),
  ended_at timestamptz,
  check(administrator_id<>client_id),
  check(expires_at>created_at and expires_at<=created_at+interval '15 minutes 1 second')
);
create unique index client_support_one_live_administrator_session
  on private.client_support_sessions(administrator_auth_session_id) where ended_at is null;
alter table private.client_support_sessions enable row level security;
alter table private.client_support_sessions force row level security;
revoke all on private.client_support_sessions from public,anon,authenticated,service_role;

insert into private.security_audit_event_codes(event_code,category,severity) values
  ('authorization.client_support.started','authorization','info'),
  ('authorization.client_support.action','authorization','info'),
  ('authorization.client_support.ended','authorization','info');

create function private.require_client_support_authority(p_administrator uuid,p_auth_session uuid,p_tenant uuid,p_client uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare company uuid;
begin
  if not exists(
    select 1 from auth.sessions s
    join public.profiles p on p.id=s.user_id and p.archived_at is null
    join public.tenant_memberships m on m.profile_id=p.id and m.tenant_id=p_tenant
      and m.account_class='internal' and m.archived_at is null
    join public.roles r on r.id=m.role_id and r.name in ('owner','admin')
    join public.tenants t on t.id=m.tenant_id and t.status='active' and t.archived_at is null
    where s.id=p_auth_session and s.user_id=p_administrator
      and (s.not_after is null or s.not_after>clock_timestamp())
      and private.profile_has_permission_in_tenant(p_administrator,p_tenant,'clients.view')
      and private.profile_has_permission_in_tenant(p_administrator,p_tenant,'client_private.manage')
  ) then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  select m.company_id into company from public.tenant_memberships m
  join public.profiles p on p.id=m.profile_id and p.archived_at is null
  join public.companies c on c.id=m.company_id and c.tenant_id=m.tenant_id and c.archived_at is null
  where m.profile_id=p_client and m.tenant_id=p_tenant and m.account_class='client' and m.archived_at is null;
  if company is null then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  return company;
end;
$$;
revoke all on function private.require_client_support_authority(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.audit_client_support(p_support private.client_support_sessions,p_event text,p_action text,p_metadata jsonb default '{}')
returns void language sql security definer set search_path='' as $$
  insert into public.security_audit_events(event_code,actor_profile_id,actor_class,action_slug,resource_type,resource_id,target_actor_id,outcome,metadata)
  values(p_event,p_support.administrator_id,'internal',p_action,'client_support',p_support.id,p_support.client_id,'succeeded',p_metadata);
$$;
revoke all on function private.audit_client_support(private.client_support_sessions,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.app_begin_client_support(p_client_id uuid,p_capability_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sid uuid; tenant uuid:=private.current_tenant_id(); company uuid; support private.client_support_sessions;
begin
  if nullif(current_setting('app.client_support_id',true),'') is not null then
    raise exception 'Exit the current client session first' using errcode='42501';
  end if;
  begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid:=null; end;
  company:=private.require_client_support_authority(actor,sid,tenant,p_client_id);
  if p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid support request' using errcode='22023';
  end if;
  perform private.consume_rate_limit('client-support-start',actor::text,interval '1 minute',6);
  perform pg_advisory_xact_lock(hashtextextended('client-support:'||sid::text,0));
  for support in select * from private.client_support_sessions where administrator_auth_session_id=sid and ended_at is null and expires_at<=clock_timestamp() for update loop
    update private.client_support_sessions set ended_at=clock_timestamp() where id=support.id;
    perform private.audit_client_support(support,'authorization.client_support.ended','client_support.expired');
  end loop;
  if exists(select 1 from private.client_support_sessions where administrator_auth_session_id=sid and ended_at is null) then
    raise exception 'Exit the current client session first' using errcode='42501';
  end if;
  insert into private.client_support_sessions(tenant_id,administrator_id,administrator_auth_session_id,client_id,company_id,capability_hash)
  values(tenant,actor,sid,p_client_id,company,p_capability_hash) returning * into support;
  perform private.audit_client_support(support,'authorization.client_support.started','client_support.begin');
  return jsonb_build_object('id',support.id,'expiresAt',support.expires_at);
end;
$$;
revoke all on function public.app_begin_client_support(uuid,text) from public,anon,service_role;
grant execute on function public.app_begin_client_support(uuid,text) to authenticated;

create function private.apply_client_support_context()
returns void language plpgsql security definer set search_path='' as $$
declare
  request_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
  claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
  capability text; actor uuid; sid uuid; tenant uuid; support private.client_support_sessions;
  operation text:=coalesce(current_setting('request.path',true),'');
  method text:=coalesce(current_setting('request.method',true),'');
  target_email text;
begin
  perform set_config('app.client_support_id','',true);
  perform set_config('app.client_support_administrator','',true);
  capability:=request_headers->>'x-wf-client-support';
  if capability is null then return; end if;
  if capability !~ '^[a-f0-9-]{36}\.[a-f0-9]{64}$' or claims->>'role' is distinct from 'authenticated' then
    raise exception 'Client support access is unavailable' using errcode='42501';
  end if;
  begin
    actor:=(claims->>'sub')::uuid; sid:=(claims->>'session_id')::uuid; tenant:=(request_headers->>'x-wf-tenant')::uuid;
    select * into support from private.client_support_sessions where id=split_part(capability,'.',1)::uuid
      and capability_hash=encode(extensions.digest(split_part(capability,'.',2),'sha256'),'hex')
      and administrator_id=actor and administrator_auth_session_id=sid and tenant_id=tenant
      and ended_at is null and expires_at>clock_timestamp();
  exception when invalid_text_representation then
    raise exception 'Client support access is unavailable' using errcode='42501';
  end;
  if support.id is null or private.require_client_support_authority(actor,sid,tenant,support.client_id) is distinct from support.company_id then
    raise exception 'Client support access is unavailable' using errcode='42501';
  end if;
  if not private.client_support_operation_allowed(operation,method) then
    raise exception 'This operation is unavailable during client support' using errcode='42501';
  end if;
  if current_setting('transaction_read_only')='off' and method not in ('GET','HEAD','OPTIONS') and
    operation !~ '(^|/)rpc/app_(get_client_support_context|end_client_support)($|/)' then
    perform private.audit_client_support(support,'authorization.client_support.action','client_support.action',
      jsonb_build_object('method',method,'operation',left(operation,180)));
  end if;
  select email into target_email from auth.users where id=support.client_id;
  perform set_config('app.client_support_id',support.id::text,true);
  perform set_config('app.client_support_administrator',actor::text,true);
  perform set_config('request.jwt.claims',((claims-'app_metadata'-'user_metadata')||jsonb_build_object('sub',support.client_id,'email',target_email,'role','authenticated'))::text,true);
  perform set_config('request.jwt.claim.sub',support.client_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
end;
$$;
revoke all on function private.apply_client_support_context() from public,anon,authenticated,service_role;

create function public.app_apply_client_support_context()
returns void language sql security definer set search_path='' as $$ select private.apply_client_support_context(); $$;
revoke all on function public.app_apply_client_support_context() from public;
grant execute on function public.app_apply_client_support_context() to anon,authenticated,service_role;

create function public.app_get_client_support_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare support private.client_support_sessions; identifier uuid;
begin
  begin identifier:=nullif(current_setting('app.client_support_id',true),'')::uuid; exception when invalid_text_representation then identifier:=null; end;
  select * into support from private.client_support_sessions where id=identifier and client_id=auth.uid()
    and administrator_id::text=nullif(current_setting('app.client_support_administrator',true),'')
    and ended_at is null and expires_at>clock_timestamp();
  if support.id is null or private.require_client_support_authority(support.administrator_id,support.administrator_auth_session_id,support.tenant_id,support.client_id) is distinct from support.company_id then
    raise exception 'Client support access is unavailable' using errcode='42501';
  end if;
  return (select jsonb_build_object('id',support.id,'administratorId',support.administrator_id,'clientId',support.client_id,
    'tenantId',support.tenant_id,'companyId',support.company_id,'email',u.email,'displayName',p.display_name,'companyName',c.name,'expiresAt',support.expires_at)
    from public.profiles p join auth.users u on u.id=p.id join public.companies c on c.id=support.company_id where p.id=support.client_id);
end;
$$;
revoke all on function public.app_get_client_support_context() from public,anon,service_role;
grant execute on function public.app_get_client_support_context() to authenticated;

create function public.app_end_client_support(p_support_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare support private.client_support_sessions; actor uuid; sid uuid;
begin
  actor:=coalesce(nullif(current_setting('app.client_support_administrator',true),'')::uuid,auth.uid());
  begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid:=null; end;
  select * into support from private.client_support_sessions where id=p_support_id
    and administrator_id=actor and administrator_auth_session_id=sid for update;
  if support.id is null then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  if support.ended_at is null then
    update private.client_support_sessions set ended_at=clock_timestamp() where id=support.id;
    perform private.audit_client_support(support,'authorization.client_support.ended','client_support.end');
  end if;
end;
$$;
revoke all on function public.app_end_client_support(uuid) from public,anon,service_role;
grant execute on function public.app_end_client_support(uuid) to authenticated;

-- Refuse to replace an existing platform request hook. Rollout must also verify
-- the effective API configuration; the proof RPC fails closed if this hook is absent.
do $$
declare existing text;
begin
  for existing in select split_part(setting,'=',2) from pg_db_role_setting s
    cross join lateral unnest(s.setconfig) setting
    where s.setrole in (0,(select oid from pg_roles where rolname='authenticator'))
      and s.setdatabase in (0,(select oid from pg_database where datname=current_database()))
      and setting like 'pgrst.db_pre_request=%' loop
    if existing not in ('','public.app_apply_client_support_context') then
      raise exception 'An existing Data API request hook requires integration review';
    end if;
  end loop;
  existing:=current_setting('pgrst.db_pre_request',true);
  if nullif(existing,'') is not null and existing<>'public.app_apply_client_support_context' then
    raise exception 'An existing Data API request hook requires integration review';
  end if;
  alter role authenticator set pgrst.db_pre_request='public.app_apply_client_support_context';
end $$;
notify pgrst,'reload config';

create function private.stamp_client_support_signature()
returns trigger language plpgsql security definer set search_path='' as $$
declare support private.client_support_sessions; identifier uuid;
begin
  if new.field_type_snapshot<>'signature' or exists(select 1 from public.form_submissions where id=new.submission_id and supersedes_submission_id is not null) then return new; end if;
  identifier:=nullif(current_setting('app.client_support_id',true),'')::uuid;
  if identifier is null then return new; end if;
  select * into support from private.client_support_sessions where id=identifier and client_id=auth.uid()
    and administrator_id::text=nullif(current_setting('app.client_support_administrator',true),'')
    and ended_at is null and expires_at>clock_timestamp();
  if support.id is null or private.require_client_support_authority(support.administrator_id,support.administrator_auth_session_id,support.tenant_id,support.client_id) is distinct from support.company_id then
    raise exception 'Client support access is unavailable' using errcode='42501';
  end if;
  new.value:=new.value||jsonb_build_object('support_administrator_id',support.administrator_id,'support_session_id',support.id);
  return new;
end;
$$;
revoke all on function private.stamp_client_support_signature() from public,anon,authenticated,service_role;
-- The standard attestation validates input first; corrections retain its exact prior bytes.
create trigger zz_stamp_client_support_signature_before_insert before insert on public.form_submission_values
  for each row execute function private.stamp_client_support_signature();

create function public.app_get_own_client_support_state(p_support_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare support private.client_support_sessions; sid uuid;
begin
  begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid:=null; end;
  if auth.uid() is null or sid is null or nullif(current_setting('app.client_support_id',true),'') is not null then
    raise exception 'Use your own session to exit client support' using errcode='42501';
  end if;
  select * into support from private.client_support_sessions where (p_support_id is null or id=p_support_id)
    and administrator_id=auth.uid() and administrator_auth_session_id=sid order by created_at desc limit 1;
  if support.id is null then return null; end if;
  return jsonb_build_object('id',support.id,'active',support.ended_at is null and support.expires_at>clock_timestamp());
end;
$$;
revoke all on function public.app_get_own_client_support_state(uuid) from public,anon,service_role;
grant execute on function public.app_get_own_client_support_state(uuid) to authenticated;

create function private.client_support_request_valid()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  request_headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
  capability text:=request_headers->>'x-wf-client-support';
  support private.client_support_sessions; sid uuid; tenant uuid;
begin
  if capability is null then return true; end if;
  if capability !~ '^[a-f0-9-]{36}\.[a-f0-9]{64}$' then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  begin
    sid:=(auth.jwt()->>'session_id')::uuid;
    tenant:=(request_headers->>'x-wf-tenant')::uuid;
    select * into support from private.client_support_sessions where id=split_part(capability,'.',1)::uuid
      and id::text=nullif(current_setting('app.client_support_id',true),'')
      and administrator_id::text=nullif(current_setting('app.client_support_administrator',true),'')
      and capability_hash=encode(extensions.digest(split_part(capability,'.',2),'sha256'),'hex')
      and administrator_auth_session_id=sid and client_id=auth.uid() and tenant_id=tenant
      and ended_at is null and expires_at>clock_timestamp();
  exception when invalid_text_representation then raise exception 'Client support access is unavailable' using errcode='42501'; end;
  if support.id is null then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  if private.require_client_support_authority(support.administrator_id,sid,tenant,support.client_id) is distinct from support.company_id then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function private.client_support_request_valid() from public,anon,authenticated,service_role;

create function public.app_client_support_request_valid()
returns boolean language sql stable security definer set search_path='' as $$ select private.client_support_request_valid(); $$;
revoke all on function public.app_client_support_request_valid() from public,anon,service_role;
grant execute on function public.app_client_support_request_valid() to authenticated;

create or replace function private.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.client_support_request_valid();
  return (
  with selector as (
    select nullif(current_setting('request.headers', true), '')::jsonb -> 'x-wf-tenant' as raw
  ),
  requested as (
    select
      case
        when selector.raw is null
          then private.wolf_forge_tenant_id()
        when jsonb_typeof(selector.raw) = 'string'
          and (selector.raw #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (selector.raw #>> '{}')::uuid
      end as tenant_id
    from selector
  )
  select membership_row.tenant_id
  from requested
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = requested.tenant_id
   and membership_row.profile_id = (select auth.uid())
   and membership_row.archived_at is null
  join public.tenants as tenant_row
    on tenant_row.id = membership_row.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null
   );
end;
$$;

create or replace function public.app_get_my_profile()
returns table (
  profile_id uuid,
  display_name text,
  email text,
  role_name text,
  preset_key text,
  preset_name text,
  avatar_path text,
  avatar_url text,
  notification_sound_enabled boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile_row.id,
    profile_row.display_name,
    auth_user.email::text,
    role_row.name,
    preset_row.key,
    preset_row.name,
    profile_row.avatar_path,
    profile_row.avatar_url,
    profile_row.notification_sound_enabled,
    profile_row.created_at
  from public.profiles as profile_row
  join public.roles as role_row
    on role_row.id = profile_row.role_id
  left join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id
  left join auth.users as auth_user
    on auth_user.id = profile_row.id
  where profile_row.id = (select auth.uid())
    and profile_row.archived_at is null
    and private.client_support_request_valid();
$$;

create function private.client_support_operation_allowed(p_path text,p_method text)
returns boolean language sql immutable set search_path='' as $$
  select case when regexp_replace(p_path,'^(/rest/v1)?/','') like 'rpc/%'
    then substring(regexp_replace(p_path,'^(/rest/v1)?/','') from 5)=any(array['app_get_client_support_context','app_current_tenant_membership','app_current_user_permissions','app_current_user_modules','app_require_module_access','app_get_client_account_context','app_get_my_profile','app_get_runtime_white_label_configuration','app_list_my_client_projects','app_get_my_client_project','app_get_my_order_start','app_request_my_order_start','app_reconcile_my_order_start','app_my_intake_version_available','app_get_project_conversation','app_get_published_form_schema','app_list_assigned_forms','app_forms_work_enabled','app_get_form_assignment_history','app_get_assigned_form_schema','app_get_assigned_form_service_labels','app_submit_form','app_get_intake_follow_up','app_get_intake_draft','app_save_intake_draft','app_prepare_intake_file','app_finish_intake_file','app_get_intake_file','app_get_form_submission_pdf','app_get_form_submission','app_list_ticket_summaries','app_get_ticket_detail_with_avatars','app_get_order_conversation','app_send_order_message','app_reply_to_order_message','app_toggle_order_message_reaction','app_reply_to_ticket','app_reply_to_ticket_message','app_toggle_ticket_message_reaction','app_create_ticket','app_prepare_ticket_attachment','app_send_ticket_message_with_attachment','app_get_ticket_attachment_download','app_set_client_conversation_presence','app_list_my_notifications','app_mark_notification_read','app_mark_all_notifications_read','app_list_my_client_reports','app_get_my_client_report','app_mark_client_report_read','app_count_my_unread_reports','app_invoices_work_enabled','app_get_invoice_financials','app_list_invoice_items','app_get_wf_card_settings','app_store_purchase_projects_enabled','app_pay_invoice_with_wallet','app_purchase_service_with_balance','app_get_company_wallet','app_list_my_wallet_history','app_subscriptions_work_enabled','app_list_subscription_summaries','app_get_subscription_detail','app_record_store_interest']::text[])
    else p_method in ('GET','HEAD') and regexp_replace(p_path,'^(/rest/v1)?/','')=any(array['profiles','services','service_folders','invoices','companies','wf_card_memberships']) end;
$$;
revoke all on function private.client_support_operation_allowed(text,text) from public,anon,authenticated,service_role;

create policy client_support_guard on public.services as restrictive for select to authenticated using((select public.app_client_support_request_valid()));
create policy client_support_guard on public.service_folders as restrictive for select to authenticated using((select public.app_client_support_request_valid()));
create policy client_support_guard on public.invoices as restrictive for select to authenticated using((select public.app_client_support_request_valid()));
create policy client_support_guard on public.companies as restrictive for select to authenticated using((select public.app_client_support_request_valid()));
create policy client_support_guard on public.wf_card_memberships as restrictive for select to authenticated using((select public.app_client_support_request_valid()));

create policy client_support_guard on public.profiles as restrictive for select to authenticated using((select public.app_client_support_request_valid()));

create or replace function public.app_get_wf_card_settings()
returns table (membership_price_cents bigint, membership_currency text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.client_support_request_valid() then raise exception 'Client support access is unavailable' using errcode='42501'; end if;
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles as profile_row
    where profile_row.id = (select auth.uid()) and profile_row.archived_at is null
  ) then
    raise exception 'authenticated account is required' using errcode = '42501';
  end if;

  return query
  select settings.membership_price_cents, settings.membership_currency
  from public.wf_card_settings as settings
  where settings.singleton;
end;
$$;
