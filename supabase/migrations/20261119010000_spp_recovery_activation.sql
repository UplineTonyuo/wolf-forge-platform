-- Imports stamp a server-owned claim before profile provisioning completes.
-- Missing and pending references must both deny recovery for a stamped user.
create function private.spp_recovery_allowed(p_user uuid, p_metadata jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_metadata ? 'spp_import_claim_id', false)
      or exists (select 1 from private.spp_account_references where profile_id = p_user)
    then exists (
      select 1 from private.spp_account_references r
      join private.client_welcome_emails w on w.profile_id = r.profile_id and w.tenant_id = r.tenant_id
      where r.profile_id = p_user and r.state = 'complete' and w.activated_at is not null
    )
    else true
  end;
$$;
revoke all on function private.spp_recovery_allowed(uuid,jsonb) from public, anon, authenticated;

create function public.app_server_can_request_recovery(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where lower(u.email) = lower(p_email)
    and u.deleted_at is null and private.spp_recovery_allowed(u.id,u.raw_app_meta_data));
$$;
revoke all on function public.app_server_can_request_recovery(text) from public, anon, authenticated;
grant execute on function public.app_server_can_request_recovery(text) to service_role;

-- Auth writes this field when issuing or consuming a recovery token. Enforce
-- the rule in the same transaction even for requests outside the SPP form.
create function private.guard_imported_recovery_token()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.spp_recovery_allowed(new.id,new.raw_app_meta_data) then
    raise exception 'Recovery unavailable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_imported_recovery_token() from public, anon, authenticated;
create trigger spp_imported_recovery_guard before update of recovery_token on auth.users
for each row when (coalesce(new.recovery_token,'') <> coalesce(old.recovery_token,''))
execute function private.guard_imported_recovery_token();
