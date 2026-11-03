-- Operator-only pilot scope; ordinary Ticket, session and provider gates still apply.
-- NULL preserves ordinary eligibility; an empty array stops every participant.
alter table private.ticket_call_environment add column pilot_profile_ids uuid[];

create or replace function private.ticket_call_profile_allowed(p_profile uuid,p_ticket uuid,p_open boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
select exists(
  select 1 from public.tickets ticket
  join public.tenants tenant on tenant.id=ticket.tenant_id and tenant.status='active' and tenant.archived_at is null
  join public.tenant_memberships member on member.tenant_id=ticket.tenant_id and member.profile_id=p_profile
    and member.archived_at is null
  join public.profiles profile on profile.id=p_profile and profile.archived_at is null
  join public.companies company on company.id=ticket.company_id and company.tenant_id=ticket.tenant_id
    and company.archived_at is null
  where ticket.id=p_ticket and ticket.archived_at is null
    and exists(select 1 from private.ticket_call_environment env
      where env.pilot_profile_ids is null or p_profile=any(env.pilot_profile_ids))
    and (not p_open or ticket.status not in ('closed','resolved'))
    and private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'tickets.view')
    and (not p_open or private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'tickets.reply'))
    and ((member.account_class='client' and member.company_id=ticket.company_id and ticket.client_profile_id=p_profile)
      or member.account_class='internal')
    and (ticket.order_id is null or exists(
      select 1 from public.orders project where project.id=ticket.order_id and project.tenant_id=ticket.tenant_id
        and project.archived_at is null
        and private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'projects.view')
        and ((member.account_class='client' and project.company_id=member.company_id)
          or (member.account_class='internal' and
            (private.profile_has_permission_in_tenant(p_profile,ticket.tenant_id,'client_private.read')
              or project.assigned_to_profile_id=p_profile or exists(
                select 1 from public.order_tasks task where task.order_id=project.id
                  and task.assigned_to_profile_id=p_profile and task.archived_at is null))))))
);
$$;
