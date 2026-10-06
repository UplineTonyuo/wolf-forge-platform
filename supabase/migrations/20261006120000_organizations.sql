-- Wolf Forge Platform
-- Company / Team entities, separate from Client records.
--
-- public.companies is the Client record: lifecycle status, wallet, invoices,
-- projects and portal profiles hang off it, and its name is the Client's
-- business name. A Company / Team is a different, explicit organization that
-- people may belong to. It lives here so that a Client's business name never
-- becomes a Company, and membership is an explicit row, never inferred from a
-- matching name.
--
-- Additive only: no existing table, row, policy or function is changed.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint organizations_name_valid
    check (btrim(name) <> '' and char_length(name) <= 200)
);

create index organizations_active_name_idx
on public.organizations (name)
where archived_at is null;

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function private.set_updated_at();

-- A person is a client_contacts row. Membership is explicit and independent of
-- the Client record that contact belongs to.
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.client_contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, contact_id)
);

create index organization_members_contact_id_idx
on public.organization_members (contact_id);

-- Reads go through RLS; writes exist only as the SECURITY DEFINER RPCs below.
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;

revoke all on table public.organizations from public, anon, authenticated, service_role;
revoke all on table public.organization_members from public, anon, authenticated, service_role;
grant select on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;

create policy organizations_internal_select
on public.organizations
for select
to authenticated
using (
  (select private.is_internal_user())
  and public.app_has_permission('clients.view')
);

-- Membership reveals which people exist, so it follows the private contact
-- boundary rather than the plain Clients read.
create policy organization_members_private_select
on public.organization_members
for select
to authenticated
using ((select private.is_client_private_admin()));

alter table public.activity_events drop constraint activity_events_entity_type_valid;
alter table public.activity_events add constraint activity_events_entity_type_valid check (
  entity_type in (
    'company', 'client_contact', 'service_folder', 'service', 'order',
    'order_task', 'profile', 'coupon', 'invoice', 'subscription',
    'form', 'form_assignment', 'form_submission', 'ticket', 'service_interest',
    'client_report', 'organization'
  )
);

create or replace function public.app_create_organization(
  p_request_id uuid,
  p_name text
)
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
    where organization.id = existing_id;
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

create or replace function public.app_update_organization(
  p_organization_id uuid,
  p_name text
)
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
    and organization.archived_at is null
  for update;

  if not found then raise no_data_found; end if;

  update public.organizations
  set name = p_name
  where id = p_organization_id
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
create or replace function public.app_add_organization_member(
  p_organization_id uuid,
  p_contact_id uuid
)
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
    and organization.archived_at is null
  for share;
  if not found then raise no_data_found; end if;

  select contact.name into contact_name
  from public.client_contacts as contact
  where contact.id = p_contact_id
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
      and member.contact_id = p_contact_id;
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

revoke all on function public.app_create_organization(uuid, text) from public, anon, service_role;
revoke all on function public.app_update_organization(uuid, text) from public, anon, service_role;
revoke all on function public.app_add_organization_member(uuid, uuid) from public, anon, service_role;
grant execute on function public.app_create_organization(uuid, text) to authenticated;
grant execute on function public.app_update_organization(uuid, text) to authenticated;
grant execute on function public.app_add_organization_member(uuid, uuid) to authenticated;
