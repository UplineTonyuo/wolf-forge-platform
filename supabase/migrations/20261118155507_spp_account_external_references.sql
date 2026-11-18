-- Additive SPP source references and their narrow provisioning boundary only.
-- No existing auth, RLS, tenant or notification object is modified.
create table private.spp_account_references (
  spp_account_id text primary key check (spp_account_id ~ '^[1-9][0-9]{0,63}$'),
  tenant_id uuid not null default private.wolf_forge_tenant_id()
    references public.tenants(id),
  email_hash text not null unique check (email_hash ~ '^[a-f0-9]{64}$'),
  claimed_by uuid not null references public.profiles(id),
  auth_claim_id uuid not null unique default extensions.gen_random_uuid(),
  state text not null default 'pending' check (state in ('pending','complete')),
  profile_id uuid references public.profiles(id),
  company_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint spp_reference_wolf_only check (tenant_id = private.wolf_forge_tenant_id()),
  constraint spp_reference_company_tenant foreign key (tenant_id, company_id)
    references public.companies(tenant_id,id),
  constraint spp_reference_complete_shape check (
    (state = 'pending' and profile_id is null and company_id is null and completed_at is null)
    or (state = 'complete' and profile_id is not null and company_id is not null and completed_at is not null)
  )
);
alter table private.spp_account_references enable row level security;
revoke all on private.spp_account_references from public, anon, authenticated, service_role;

create function public.app_spp_account_import(
  p_operation text,
  p_spp_id text default null,
  p_email_hash text default null,
  p_auth_id uuid default null,
  p_fields jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  tenant uuid := private.identity_tenant_id();
  actor uuid;
  reference_row private.spp_account_references;
  company_row public.companies;
  contact_row public.client_contacts;
  expected_email text;
  inserted boolean;
begin
  perform private.require_client_private_admin();
  actor := private.require_internal_actor();
  if tenant is distinct from private.wolf_forge_tenant_id()
    or private.profile_permission_preset_key(actor) is distinct from 'owner' then
    raise exception 'SPP import requires the Wolf Forge owner' using errcode = '42501';
  end if;
  if p_operation = 'inspect' then
    return jsonb_build_object('tenant_id', tenant, 'state', 'ready');
  end if;
  if p_spp_id is null or p_spp_id !~ '^[1-9][0-9]{0,63}$' then
    raise exception 'invalid source reference' using errcode = '22023';
  end if;
  if p_operation = 'claim' then
    if p_email_hash is null or p_email_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid source email hash' using errcode = '22023';
    end if;
    insert into private.spp_account_references(spp_account_id,email_hash,claimed_by)
    select p_spp_id,p_email_hash,actor
    where not exists (
      select 1 from auth.users u where encode(extensions.digest(lower(u.email),'sha256'),'hex')=p_email_hash
    )
    on conflict do nothing returning * into reference_row;
    inserted := found;
    if inserted then
      return jsonb_build_object('tenant_id',tenant,'state','claimed','auth_claim_id',reference_row.auth_claim_id);
    end if;
    -- An ID/email disagreement is not an already-imported identity.
    if exists(select 1 from private.spp_account_references r
      where r.spp_account_id=p_spp_id and r.email_hash<>p_email_hash) then
      return jsonb_build_object('tenant_id',tenant,'state','conflict');
    end if;
    select * into reference_row from private.spp_account_references r
    where r.spp_account_id=p_spp_id or r.email_hash=p_email_hash
    for update;
    return jsonb_build_object('tenant_id',tenant,'state',coalesce(reference_row.state,'conflict'));
  end if;
  if p_operation is distinct from 'complete' and p_operation is distinct from 'verify' then raise exception 'invalid import operation' using errcode='22023'; end if;
  select * into reference_row from private.spp_account_references r where r.spp_account_id=p_spp_id for update;
  if reference_row.spp_account_id is null or reference_row.claimed_by<>actor then
    raise exception 'source reference unavailable' using errcode='42501';
  end if;
  if p_operation='verify' then
    if reference_row.state<>'complete' or not exists(
      select 1 from public.companies c
      join public.tenant_memberships m on m.company_id=c.id and m.tenant_id=c.tenant_id
      join public.client_contacts contact on contact.company_id=c.id and contact.profile_id=m.profile_id and contact.tenant_id=c.tenant_id
      join auth.users u on u.id=m.profile_id
      where c.id=reference_row.company_id and c.tenant_id=tenant and c.archived_at is null
        and m.profile_id=reference_row.profile_id and m.account_class='client' and m.archived_at is null
        and contact.is_primary and contact.archived_at is null
        and u.raw_app_meta_data->>'spp_import_claim_id'=reference_row.auth_claim_id::text
        and not exists(select 1 from auth.sessions s where s.user_id=u.id)
        and encode(extensions.digest(lower(u.email),'sha256'),'hex')=reference_row.email_hash
    ) then raise exception 'import readback refused' using errcode='42501'; end if;
    return jsonb_build_object('tenant_id',tenant,'state','complete');
  end if;
  if reference_row.state='complete' then return jsonb_build_object('tenant_id',tenant,'state','complete'); end if;
  if p_fields is null or jsonb_typeof(p_fields)<>'object'
    or p_fields - array['email','display_name','company_name','phone','stripe_customer_id'] <> '{}'::jsonb
    or coalesce(length(btrim(p_fields->>'company_name')),0) not between 1 and 200
    or coalesce(length(btrim(p_fields->>'display_name')),0) not between 1 and 200
    or coalesce(length(p_fields->>'phone'),0)>50 then
    raise exception 'invalid import fields' using errcode='22023';
  end if;
  expected_email := lower(btrim(p_fields->>'email'));
  if expected_email is null or encode(extensions.digest(expected_email,'sha256'),'hex')<>reference_row.email_hash
    or not exists(select 1 from auth.users u where u.id=p_auth_id
      and lower(u.email)=expected_email and u.email_confirmed_at is not null and u.deleted_at is null
      and u.raw_app_meta_data->>'spp_import_claim_id'=reference_row.auth_claim_id::text
      and u.created_at>=reference_row.created_at
      and not exists(select 1 from auth.sessions s where s.user_id=u.id))
    or exists(select 1 from public.tenant_memberships m where m.profile_id=p_auth_id) then
    raise exception 'fresh claimed identity required' using errcode='42501';
  end if;
  company_row := public.app_create_company(extensions.gen_random_uuid(),p_fields->>'company_name');
  perform public.app_provision_client_account_profile(p_auth_id,company_row.id,p_fields->>'display_name');
  -- The existing INSERT notification guard returns before emission for an
  -- unlinked secondary contact. Linking is audited, atomic, and has no INSERT.
  contact_row := public.app_create_contact(extensions.gen_random_uuid(),company_row.id,
    p_fields->>'display_name',null,expected_email,p_fields->>'phone',null,false);
  contact_row := public.app_update_contact(contact_row.id,jsonb_build_object('profile_id',p_auth_id,'is_primary',true));
  if p_fields->>'stripe_customer_id' is not null then
    perform public.app_link_company_stripe_customer(company_row.id,p_fields->>'stripe_customer_id');
  end if;
  if company_row.tenant_id<>tenant or contact_row.tenant_id<>tenant
    or not exists(select 1 from public.tenant_memberships m
      where m.profile_id=p_auth_id and m.tenant_id=tenant and m.company_id=company_row.id and m.account_class='client') then
    raise exception 'import ownership refused' using errcode='42501';
  end if;
  update private.spp_account_references set state='complete',profile_id=p_auth_id,
    company_id=company_row.id,completed_at=now() where spp_account_id=p_spp_id;
  return jsonb_build_object('tenant_id',tenant,'state','complete');
end;
$$;
revoke all on function public.app_spp_account_import(text,text,text,uuid,jsonb) from public, anon, service_role;
grant execute on function public.app_spp_account_import(text,text,text,uuid,jsonb) to authenticated;
comment on table private.spp_account_references is
  'SPP Accounts import claims. Pending records require manual reconciliation; never delete/retry an uncertain Auth attempt automatically. Duplicate emails retain the first canonical SPP ID.';