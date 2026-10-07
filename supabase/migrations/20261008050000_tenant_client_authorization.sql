-- WL-2.9 (KI-111, Clients / Contacts / Companies): every Client, contact and
-- Company operation requires the row to belong to the caller's current Tenant.
--
-- Product model is unchanged and stays three separate things:
--   public.companies            Client / business-lifecycle record
--   public.client_contacts      person / contact
--   public.organizations        explicit Company / Team
--   public.organization_members explicit Company membership
-- Tenant != Company. Nothing here collapses those concepts.
--
-- Concrete leak closed (HIGH, verified by the WL-2.8 attack review):
-- app_update_company, app_archive_company, app_update_contact,
-- app_archive_contact, app_update_organization and app_add_organization_member
-- acted on any row by id, so an internal user of one Tenant could rename,
-- re-status or archive another Tenant's Clients, contacts and Companies, or
-- add a foreign person to a Company; activity was stamped with the victim
-- row's Tenant, so the foreign actor even appeared in the victim Tenant's
-- feed.
--
-- Pattern (D-272): every lookup of a caller-supplied id gains
--   tenant_id = (select private.current_tenant_id())
-- Foreign and missing rows behave identically (no_data_found). Bodies are the
-- live pre-fix definitions with that predicate only; signatures, ACLs,
-- owners and search_path are unchanged. The caller-supplied tenant is never
-- trusted; create rows keep taking their Tenant from identity_tenant_id().
--
-- RLS: companies_internal_select, client_contacts_authorized_private_select,
-- organizations_internal_select and organization_members_private_select gain
-- the same predicate, because all four tables grant direct SELECT to
-- authenticated (PostgREST would otherwise bypass the SECURITY DEFINER
-- hardening). companies_client_select_own is already Tenant-relative through
-- private.current_user_company_id(). No grant is widened.
--
-- Directory / search: app_list_client_company_directory and
-- app_search_client_directory (the Client / Company / contact search source)
-- add the same predicate, so names, ids and metadata of another Tenant never
-- appear in pickers or global search results.
--
-- Not changed here (out of slice, tracked elsewhere):
--   - Wallet / WF Card functions (app_get_company_wallet and friends) and
--     private.can_access_client_private_company: D-271, its only caller is the
--     wallet RPC.
--   - Billing: app_link_company_stripe_customer (Stripe boundary).
--   - Notifications: emit_company_client_notification* (KI-115).
--   - KI-109 portal money flows and profiles.company_id reads.
--   - KI-107 (trusted roles can re-home a row's tenant_id) unchanged.
--   - Organizations keep no archive RPC; nothing to bind there.

-- -----------------------------------------------------------------------------
-- Clients (public.companies)
-- -----------------------------------------------------------------------------

create or replace function public.app_update_company(p_company_id uuid, p_patch jsonb)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_row public.companies;
  previous_status text;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.edit');

  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array['name', 'status'] <> '{}'::jsonb
  then
    raise exception 'invalid client update patch'
      using errcode = '22023';
  end if;

  if p_patch ? 'status' then
    if jsonb_typeof(p_patch -> 'status') <> 'string'
      or (p_patch ->> 'status') not in (
        'contact',
        'lead',
        'client',
        'client_team'
      )
    then
      raise exception 'invalid client status'
        using errcode = '22023';
    end if;
  end if;

  select company.status
  into previous_status
  from public.companies as company
  where company.id = p_company_id
    and company.tenant_id = (select private.current_tenant_id())
    and company.archived_at is null;

  if not found then raise no_data_found; end if;

  update public.companies
  set
    name = case
      when p_patch ? 'name' then p_patch ->> 'name'
      else name
    end,
    status = case
      when p_patch ? 'status' then p_patch ->> 'status'
      else status
    end
  where id = p_company_id
    and tenant_id = (select private.current_tenant_id())
    and archived_at is null
  returning * into company_row;

  if p_patch ? 'status'
    and previous_status is distinct from company_row.status
  then
    perform private.record_authenticated_activity(
      'company',
      company_row.id,
      'company.updated',
      format(
        'Changed client status from %s to %s.',
        initcap(replace(previous_status, '_', ' ')),
        initcap(replace(company_row.status, '_', ' '))
      ),
      jsonb_build_object(
        'field', 'status',
        'from', previous_status,
        'to', company_row.status
      )
    );
  else
    perform private.record_authenticated_activity(
      'company',
      company_row.id,
      'company.updated',
      format('Updated client %s.', company_row.name)
    );
  end if;

  return company_row;
end;
$$;

create or replace function public.app_archive_company(p_company_id uuid)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_row public.companies;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.archive');

  select company.* into company_row
  from public.companies as company
  where company.id = p_company_id
    and company.tenant_id = (select private.current_tenant_id())
  for update;

  if company_row.id is null then raise no_data_found; end if;
  if company_row.archived_at is not null then return company_row; end if;

  update public.companies
  set archived_at = now()
  where id = p_company_id
    and tenant_id = (select private.current_tenant_id())
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company',
    company_row.id,
    'company.archived',
    format('Archived client %s.', company_row.name)
  );
  return company_row;
end;
$$;

create or replace function public.app_create_company(p_request_id uuid, p_name text)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object('name', p_name);
  existing_id uuid;
  company_row public.companies;
begin
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.create');

  existing_id := private.find_create_request(
    actor_id,
    'company.create',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select company.* into company_row
    from public.companies as company
    where company.id = existing_id
      and company.tenant_id = (select private.current_tenant_id());
    if company_row.id is null then raise no_data_found; end if;
    return company_row;
  end if;

  insert into public.companies (name)
  values (p_name)
  returning * into company_row;

  perform private.record_authenticated_activity(
    'company',
    company_row.id,
    'company.created',
    format('Created client %s.', company_row.name)
  );
  perform private.remember_create_request(
    actor_id,
    'company.create',
    p_request_id,
    request_payload,
    company_row.id
  );
  return company_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Contacts (public.client_contacts)
-- -----------------------------------------------------------------------------

create or replace function public.app_update_contact(p_contact_id uuid, p_patch jsonb)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or p_patch - array['profile_id', 'name', 'email', 'phone', 'job_title', 'is_primary'] <> '{}'::jsonb
  then raise exception 'invalid client contact update patch' using errcode = '22023'; end if;

  update public.client_contacts
  set profile_id = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else profile_id end,
      name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
      email = case when p_patch ? 'email' then p_patch ->> 'email' else email end,
      phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else phone end,
      job_title = case when p_patch ? 'job_title' then p_patch ->> 'job_title' else job_title end,
      is_primary = case when p_patch ? 'is_primary' then (p_patch ->> 'is_primary')::boolean else is_primary end
  where id = p_contact_id
    and tenant_id = (select private.current_tenant_id())
    and archived_at is null
  returning * into contact_row;
  if contact_row.id is null then raise no_data_found; end if;
  perform private.record_authenticated_activity(
    'client_contact', contact_row.id, 'contact.updated',
    format('Updated client contact %s.', contact_row.name)
  );
  return contact_row;
end;
$$;

create or replace function public.app_archive_contact(p_contact_id uuid)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_row public.client_contacts;
begin
  perform private.require_internal_actor();
  perform private.require_permission('client_private.manage');
  perform private.require_permission('clients.archive');

  select contact.*
  into contact_row
  from public.client_contacts as contact
  where contact.id = p_contact_id
    and contact.tenant_id = (select private.current_tenant_id())
  for update;

  if contact_row.id is null then
    raise no_data_found;
  end if;

  if contact_row.archived_at is not null then
    return contact_row;
  end if;

  update public.client_contacts
  set archived_at = now(),
      is_primary = false
  where id = p_contact_id
    and tenant_id = (select private.current_tenant_id())
  returning * into contact_row;

  perform private.record_authenticated_activity(
    'client_contact',
    contact_row.id,
    'contact.archived',
    format('Archived client contact %s.', contact_row.name)
  );

  return contact_row;
end;
$$;

create or replace function public.app_create_contact(p_request_id uuid, p_company_id uuid, p_name text, p_profile_id uuid default null::uuid, p_email text default null::text, p_phone text default null::text, p_job_title text default null::text, p_is_primary boolean default false)
returns public.client_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object(
    'company_id', p_company_id, 'name', p_name, 'profile_id', p_profile_id,
    'email', p_email, 'phone', p_phone, 'job_title', p_job_title,
    'is_primary', p_is_primary
  );
  existing_id uuid;
  contact_row public.client_contacts;
begin
  existing_id := private.find_create_request(actor_id, 'contact.create', p_request_id, request_payload);
  if existing_id is not null then
    select contact.* into contact_row from public.client_contacts as contact
    where contact.id = existing_id
      and contact.tenant_id = (select private.current_tenant_id());
    if contact_row.id is null then raise no_data_found; end if;
    return contact_row;
  end if;

  insert into public.client_contacts (
    company_id, profile_id, name, email, phone, job_title, is_primary
  ) values (
    p_company_id, p_profile_id, p_name, p_email, p_phone, p_job_title, p_is_primary
  ) returning * into contact_row;
  perform private.record_authenticated_activity(
    'client_contact', contact_row.id, 'contact.created',
    format('Created client contact %s.', contact_row.name),
    jsonb_build_object('company_id', contact_row.company_id)
  );
  perform private.remember_create_request(actor_id, 'contact.create', p_request_id, request_payload, contact_row.id);
  return contact_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Companies / Teams (public.organizations) and memberships
-- -----------------------------------------------------------------------------

create or replace function public.app_create_organization(p_request_id uuid, p_name text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
  request_payload jsonb := jsonb_build_object('name', p_name);
  existing_id uuid;
  organization_row public.organizations;
begin
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.create');

  existing_id := private.find_create_request(
    actor_id,
    'organization.create',
    p_request_id,
    request_payload
  );
  if existing_id is not null then
    select organization.* into organization_row
    from public.organizations as organization
    where organization.id = existing_id
      and organization.tenant_id = (select private.current_tenant_id());
    if organization_row.id is null then raise no_data_found; end if;
    return organization_row;
  end if;

  insert into public.organizations (name)
  values (p_name)
  returning * into organization_row;

  perform private.record_authenticated_activity(
    'organization',
    organization_row.id,
    'organization.created',
    format('Created company %s.', organization_row.name)
  );
  perform private.remember_create_request(
    actor_id,
    'organization.create',
    p_request_id,
    request_payload,
    organization_row.id
  );
  return organization_row;
end;
$$;

create or replace function public.app_update_organization(p_organization_id uuid, p_name text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_name text;
  organization_row public.organizations;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.edit');

  select organization.name into previous_name
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.tenant_id = (select private.current_tenant_id())
    and organization.archived_at is null
  for update;

  if not found then raise no_data_found; end if;

  update public.organizations
  set name = p_name
  where id = p_organization_id
    and tenant_id = (select private.current_tenant_id())
  returning * into organization_row;

  if previous_name is distinct from organization_row.name then
    perform private.record_authenticated_activity(
      'organization',
      organization_row.id,
      'organization.updated',
      format('Renamed company from %s to %s.', previous_name, organization_row.name),
      jsonb_build_object('field', 'name', 'from', previous_name, 'to', organization_row.name)
    );
  end if;

  return organization_row;
end;
$$;

-- Idempotent: adding an existing member is a no-op that returns the same row.
create or replace function public.app_add_organization_member(p_organization_id uuid, p_contact_id uuid)
returns public.organization_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_row public.organization_members;
  contact_name text;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_permission('clients.create');
  perform private.require_permission('client_private.manage');

  perform 1
  from public.organizations as organization
  where organization.id = p_organization_id
    and organization.tenant_id = (select private.current_tenant_id())
    and organization.archived_at is null
  for share;
  if not found then raise no_data_found; end if;

  select contact.name into contact_name
  from public.client_contacts as contact
  where contact.id = p_contact_id
    and contact.tenant_id = (select private.current_tenant_id())
    and contact.archived_at is null;
  if not found then raise no_data_found; end if;

  insert into public.organization_members (organization_id, contact_id)
  values (p_organization_id, p_contact_id)
  on conflict do nothing
  returning * into member_row;

  if member_row.organization_id is null then
    select member.* into member_row
    from public.organization_members as member
    where member.organization_id = p_organization_id
      and member.contact_id = p_contact_id
      and member.tenant_id = (select private.current_tenant_id());
    return member_row;
  end if;

  perform private.record_authenticated_activity(
    'organization',
    p_organization_id,
    'organization.member_added',
    format('Added %s to the company.', contact_name),
    jsonb_build_object('contact_id', p_contact_id)
  );
  return member_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Directory and search sources
-- -----------------------------------------------------------------------------

create or replace function public.app_list_client_company_directory()
returns table(id uuid, name text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, archived_at timestamp with time zone)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  perform private.require_internal_actor();
  perform private.require_permission('client_directory.read');

  return query
  select
    company_row.id,
    company_row.name,
    company_row.status,
    company_row.created_at,
    company_row.updated_at,
    company_row.archived_at
  from public.companies as company_row
  where company_row.archived_at is null
    and company_row.tenant_id = (select private.current_tenant_id())
  order by company_row.name, company_row.id;
end;
$$;

create or replace function public.app_search_client_directory(p_query text, p_limit integer default 20)
returns table(client_contact_id uuid, client_profile_id uuid, display_name text, company_id uuid, company_name text)
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  perform private.require_internal_actor();
  perform private.require_permission('client_directory.read');

  if char_length(normalized_query) < 2 then
    raise exception 'client directory query must contain at least 2 characters'
      using errcode = '22023';
  end if;

  return query
  with directory_rows as (
    select
      contact_row.id as client_contact_id,
      contact_row.profile_id as client_profile_id,
      contact_row.name as display_name,
      company_row.id as company_id,
      company_row.name as company_name
    from public.client_contacts as contact_row
    join public.companies as company_row
      on company_row.id = contact_row.company_id
     and company_row.archived_at is null
    where contact_row.archived_at is null
      and contact_row.tenant_id = (select private.current_tenant_id())

    union all

    select
      null::uuid,
      profile_row.id,
      coalesce(profile_row.display_name, company_row.name),
      company_row.id,
      company_row.name
    from public.profiles as profile_row
    join public.roles as role_row
      on role_row.id = profile_row.role_id
     and role_row.name = 'client'
    join public.companies as company_row
      on company_row.id = profile_row.company_id
     and company_row.archived_at is null
    where profile_row.archived_at is null
      and company_row.tenant_id = (select private.current_tenant_id())
      and not exists (
        select 1
        from public.client_contacts as linked_contact
        where linked_contact.profile_id = profile_row.id
          and linked_contact.tenant_id = (select private.current_tenant_id())
          and linked_contact.archived_at is null
      )

    union all

    select
      null::uuid,
      null::uuid,
      company_row.name,
      company_row.id,
      company_row.name
    from public.companies as company_row
    where company_row.archived_at is null
      and company_row.tenant_id = (select private.current_tenant_id())
      and not exists (
        select 1
        from public.client_contacts as company_contact
        where company_contact.company_id = company_row.id
          and company_contact.archived_at is null
      )
      and not exists (
        select 1
        from public.profiles as company_profile
        join public.roles as company_profile_role
          on company_profile_role.id = company_profile.role_id
         and company_profile_role.name = 'client'
        where company_profile.company_id = company_row.id
          and company_profile.archived_at is null
      )
  )
  select
    directory_row.client_contact_id,
    directory_row.client_profile_id,
    directory_row.display_name,
    directory_row.company_id,
    directory_row.company_name
  from directory_rows as directory_row
  where position(normalized_query in lower(directory_row.display_name)) > 0
     or position(normalized_query in lower(directory_row.company_name)) > 0
  order by
    directory_row.company_name,
    directory_row.display_name,
    directory_row.client_profile_id nulls last
  limit safe_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: the four tables grant direct SELECT to authenticated
-- -----------------------------------------------------------------------------

alter policy companies_internal_select on public.companies
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and public.app_has_permission('clients.view'));

alter policy client_contacts_authorized_private_select on public.client_contacts
  using ((select private.is_client_private_admin())
    and tenant_id = (select private.current_tenant_id())
    and archived_at is null);

alter policy organizations_internal_select on public.organizations
  using ((select private.is_internal_user())
    and tenant_id = (select private.current_tenant_id())
    and public.app_has_permission('clients.view'));

alter policy organization_members_private_select on public.organization_members
  using ((select private.is_client_private_admin())
    and tenant_id = (select private.current_tenant_id()));
