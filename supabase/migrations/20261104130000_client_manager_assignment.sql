-- Account ownership metadata only: no authorization path consumes this relationship.
create table private.client_manager_assignments (
  tenant_id uuid not null,
  company_id uuid primary key,
  manager_profile_id uuid not null references public.profiles(id),
  assigned_at timestamptz not null default clock_timestamp(),
  assigned_by uuid not null references public.profiles(id),
  foreign key (tenant_id, company_id) references public.companies(tenant_id, id)
);
alter table private.client_manager_assignments enable row level security;
alter table private.client_manager_assignments force row level security;
revoke all on private.client_manager_assignments from public, anon, authenticated, service_role;

create function public.app_list_client_manager_options()
returns table(id uuid, name text) language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.edit');
  return query select p.id, p.display_name from public.tenant_memberships m
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    join public.roles r on r.id=m.role_id and r.name='manager'
    where m.tenant_id=private.current_tenant_id() and m.account_class='internal' and m.archived_at is null
    order by p.display_name,p.id limit 100;
end $$;

create function public.app_assign_client_manager(p_company_id uuid,p_manager_profile_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare tenant uuid:=private.current_tenant_id(); previous uuid; result uuid;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.edit');
  perform private.consume_rate_limit('client-manager-assignment',auth.uid()::text,interval '1 minute',100);
  perform 1 from public.companies where id=p_company_id and tenant_id=tenant and archived_at is null for update;
  if not found then raise no_data_found; end if;
  -- Lock eligibility rows until persistence; concurrent archival/role changes serialize.
  perform 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id
    join public.roles r on r.id=m.role_id
    where m.tenant_id=tenant and m.profile_id=p_manager_profile_id and m.account_class='internal'
      and m.archived_at is null and p.archived_at is null and r.name='manager' for share of m,p,r;
  if not found then raise exception 'Choose an active manager in this workspace' using errcode='22023'; end if;
  -- Actor/module/edit authority may have changed while either lock was waiting.
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.edit');
  select manager_profile_id into previous from private.client_manager_assignments where company_id=p_company_id;
  if previous is distinct from p_manager_profile_id then
    insert into private.client_manager_assignments(tenant_id,company_id,manager_profile_id,assigned_by)
      values(tenant,p_company_id,p_manager_profile_id,auth.uid())
      on conflict(company_id) do update set manager_profile_id=excluded.manager_profile_id,
        assigned_by=excluded.assigned_by,assigned_at=clock_timestamp();
    perform private.record_authenticated_activity('company',p_company_id,'company.updated','Assigned client account manager.',
      jsonb_build_object('field','manager_profile_id','from',previous,'to',p_manager_profile_id));
  end if;
  select manager_profile_id into result from private.client_manager_assignments where company_id=p_company_id and tenant_id=tenant;
  return result;
end $$;

create function public.app_list_client_manager_assignments()
returns table(company_id uuid,manager_profile_id uuid,manager_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('client_directory.read');
  return query select a.company_id,a.manager_profile_id,p.display_name from private.client_manager_assignments a
    join public.companies c on c.id=a.company_id and c.tenant_id=a.tenant_id and c.archived_at is null
    join public.profiles p on p.id=a.manager_profile_id
    where a.tenant_id=private.current_tenant_id();
end $$;
revoke all on function public.app_list_client_manager_options(),public.app_assign_client_manager(uuid,uuid),public.app_list_client_manager_assignments() from public,anon,authenticated,service_role;
grant execute on function public.app_list_client_manager_options(),public.app_assign_client_manager(uuid,uuid),public.app_list_client_manager_assignments() to authenticated;
