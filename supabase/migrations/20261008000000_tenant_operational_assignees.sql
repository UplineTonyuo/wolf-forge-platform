-- WL-2.4 (KI-113): operational assignees are Tenant-relative.
--
-- Concrete defect closed: private.require_internal_assignee (orders, tickets,
-- services, order_tasks), the inline check in app_assign_ticket and
-- app_list_operational_assignees decided "internal staff" from the global
-- profiles.role_id, which is the Wolf Forge compatibility role. A person who is
-- Wolf Forge staff but only a client in Tenant B passed the role check for a
-- Tenant B row, and a Tenant B staff member who is a Wolf Forge client was
-- rejected and missing from the Tenant B list; the list also showed every
-- Tenant's internal staff to every Tenant.
--
-- Model: an assignee is an active internal member of the row's Tenant
-- (tenant_memberships: tenant_id = row tenant, account_class = 'internal',
-- archived_at is null) -- the rule private.require_order_task_tenant_assignee
-- already applies to Order tasks (WL-1C.3). Orders, tickets and services carry
-- tenant_id with a (tenant_id, assigned_to_profile_id) foreign key to
-- tenant_memberships, so the trigger reads new.tenant_id. Who may assign stays
-- with the existing permission checks.
--
-- order_tasks has no tenant_id; its Tenant-relative trigger (which also fires
-- on order_id) is equivalent or stronger, so the global-role trigger is dropped there instead of making the
-- shared helper generic. app_assign_ticket's inline global check is removed:
-- the trigger validates the same assignee against the Ticket's own Tenant with
-- the same error. The list reads the caller's resolved Tenant
-- (private.identity_tenant_id()); for Wolf Forge it returns the same people,
-- because the WL-1A mirror keeps the Wolf Forge membership equal to the profile.

create or replace function private.require_internal_assignee()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
begin
  if new.assigned_to_profile_id is not null
    and not exists (
      select 1
      from public.tenant_memberships as membership
      where membership.tenant_id = new.tenant_id
        and membership.profile_id = new.assigned_to_profile_id
        and membership.account_class = 'internal'
        and membership.archived_at is null
    )
  then
    raise exception 'assignee must be an active internal profile'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- The rule now depends on the row's Tenant, so a Tenant change re-validates the
-- assignee (the composite foreign key alone accepts any membership).
drop trigger orders_require_internal_assignee on public.orders;
create trigger orders_require_internal_assignee
  before insert or update of assigned_to_profile_id, tenant_id on public.orders
  for each row execute function private.require_internal_assignee();

drop trigger services_require_internal_assignee on public.services;
create trigger services_require_internal_assignee
  before insert or update of assigned_to_profile_id, tenant_id on public.services
  for each row execute function private.require_internal_assignee();

drop trigger tickets_require_internal_assignee on public.tickets;
create trigger tickets_require_internal_assignee
  before insert or update of assigned_to_profile_id, tenant_id on public.tickets
  for each row execute function private.require_internal_assignee();

drop trigger order_tasks_require_internal_assignee on public.order_tasks;

create or replace function public.app_list_operational_assignees()
 returns table(profile_id uuid, display_name text, avatar_url text)
 language plpgsql
 stable security definer
 set search_path to ''
as $$
begin
  perform private.require_internal_actor();

  return query
  select profile_row.id, profile_row.display_name, profile_row.avatar_url
  from public.tenant_memberships as membership_row
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
  where membership_row.tenant_id = (select private.identity_tenant_id())
    and membership_row.account_class = 'internal'
    and membership_row.archived_at is null
  order by
    coalesce(nullif(btrim(profile_row.display_name), ''), '~'),
    profile_row.id;
end;
$$;

create or replace function public.app_assign_ticket(p_ticket_id uuid, p_assigned_to_profile_id uuid default null::uuid)
 returns public.tickets
 language plpgsql
 security definer
 set search_path to ''
as $$
declare actor_id uuid := (select auth.uid()); old_assignee uuid; ticket_row public.tickets;
begin
  perform private.require_permission('tickets.assign');
  if not (select private.is_internal_user()) then raise exception 'internal Ticket access is required' using errcode = '42501'; end if;
  -- The assignee is validated against the Ticket's own Tenant by
  -- tickets_require_internal_assignee.
  select assigned_to_profile_id into old_assignee
  from public.tickets where id = p_ticket_id and archived_at is null for update;
  if not found then raise no_data_found; end if;
  update public.tickets set assigned_to_profile_id = p_assigned_to_profile_id
  where id = p_ticket_id returning * into ticket_row;
  if old_assignee is distinct from p_assigned_to_profile_id then
    perform private.record_ticket_activity(
      p_ticket_id, 'ticket.assigned', 'Changed Ticket assignment.',
      jsonb_build_object('from_profile_id', old_assignee, 'to_profile_id', p_assigned_to_profile_id), actor_id
    );
  end if;
  return ticket_row;
end;
$$;
