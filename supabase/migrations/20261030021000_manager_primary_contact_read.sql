-- A four-field read projection; no raw contact RLS, private-management or support-session grants.
insert into public.permissions(permission_key,category,label,description)
values ('clients.contact_read','clients','Read primary contact','Read primary contact name, email, phone and job title in the current workspace.');
insert into public.role_permissions(role_id,permission_key,allowed)
select id,'clients.contact_read',name in ('owner','admin','manager') from public.roles
on conflict(role_id,permission_key) do nothing;

create function public.app_get_primary_contact_summary(p_company_id uuid)
returns table(name text,email text,phone text,job_title text)
language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid := private.require_internal_actor();
begin
  if not exists(select 1 from public.profiles p where p.id=actor_id and p.archived_at is null) then
    raise exception 'Primary contact access is denied' using errcode='42501';
  end if;
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.view');
  perform private.require_permission('clients.contact_read');
  if (private.current_user_role_name() in ('owner','admin','manager')) is not true then
    raise exception 'Primary contact access is denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id
    and c.tenant_id=private.current_tenant_id() and c.archived_at is null) then
    raise no_data_found;
  end if;
  return query select nullif(btrim(c.name),''),nullif(btrim(c.email),''),nullif(btrim(c.phone),''),nullif(btrim(c.job_title),'')
    from public.client_contacts c where c.company_id=p_company_id
      and c.tenant_id=private.current_tenant_id() and c.archived_at is null
    order by c.is_primary desc,c.name,c.id limit 1;
end;
$$;
revoke all on function public.app_get_primary_contact_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_primary_contact_summary(uuid) to authenticated;
