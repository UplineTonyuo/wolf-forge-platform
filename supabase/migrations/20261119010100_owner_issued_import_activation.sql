-- Preserve who was authorized at issuance even if their role changes later.
alter table private.client_welcome_emails add column import_owner_issued boolean not null default false;

create function private.check_import_activation_issuer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.activation_token_hash is null then return new; end if;
  if exists (select 1 from private.spp_account_references r
      where r.profile_id = new.profile_id and r.tenant_id = new.tenant_id)
  then
    if not exists (select 1 from public.tenant_memberships m
        join public.permission_presets p on p.role_id = m.role_id
        where m.tenant_id = new.tenant_id and m.profile_id = new.claimed_by
          and m.archived_at is null and m.account_class = 'internal' and p.key = 'owner')
    then raise exception 'Imported client activation requires a workspace owner' using errcode = '42501';
    end if;
    new.import_owner_issued := true;
  end if;
  return new;
end;
$$;
revoke all on function private.check_import_activation_issuer() from public, anon, authenticated;
create trigger require_import_activation_owner before insert or update of activation_token_hash
on private.client_welcome_emails for each row execute function private.check_import_activation_issuer();

create or replace function private.spp_recovery_allowed(p_user uuid, p_metadata jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_metadata ? 'spp_import_claim_id', false)
      or exists (select 1 from private.spp_account_references where profile_id = p_user)
    then exists (
      select 1 from private.spp_account_references r
      join private.client_welcome_emails w on w.profile_id = r.profile_id and w.tenant_id = r.tenant_id
      where r.profile_id = p_user and r.state = 'complete' and w.import_owner_issued and w.activated_at is not null
    )
    else true
  end;
$$;
