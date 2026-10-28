-- Accepted commerce/Form activity is written after provisioning/answers/completion.
-- Keep purchase suppression on the earlier generic Order and payment triggers.
create function private.purchase_intake_notification_visible(
  p_profile_id uuid, p_event_key text, p_entity_type text, p_entity_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when split_part(p_event_key, ':', 1) not in ('order-purchased', 'intake-submitted') then true
    else exists (
      select 1
      from public.tenant_memberships membership
      join public.tenants tenant on tenant.id = membership.tenant_id
        and tenant.status = 'active' and tenant.archived_at is null
      join public.profiles profile on profile.id = membership.profile_id
        and profile.archived_at is null
      where membership.profile_id = p_profile_id
        and membership.account_class = 'internal' and membership.archived_at is null
        and membership.tenant_id = private.activity_event_parent_tenant_id(p_entity_type, p_entity_id)
        and case
          when p_entity_type = 'order' and p_event_key = 'order-purchased:' || p_entity_id::text then
            private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'projects.view')
            and exists (
              select 1 from public.orders project
              join public.companies company on company.id = project.company_id
                and company.tenant_id = project.tenant_id and company.archived_at is null
              where project.id = p_entity_id and project.archived_at is null
                and (private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'client_private.read')
                  or project.assigned_to_profile_id = p_profile_id
                  or exists (select 1 from public.order_tasks task where task.order_id = project.id
                    and task.assigned_to_profile_id = p_profile_id and task.archived_at is null))
            )
          when p_entity_type = 'form_submission' and p_event_key = 'intake-submitted:' || p_entity_id::text then
            private.tenant_module_allowed(membership.tenant_id, 'forms')
            and private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'forms.view')
            and private.profile_has_permission_in_tenant(p_profile_id, membership.tenant_id, 'forms.submissions_view')
            and exists (
              select 1 from public.form_submissions submission
              join public.forms form on form.id = submission.form_id and form.archived_at is null
              join public.form_assignments assignment on assignment.id = submission.form_assignment_id
                and assignment.form_id = form.id and assignment.archived_at is null
              join public.companies company on company.id = submission.company_id
                and company.tenant_id = form.tenant_id and company.archived_at is null
              where submission.id = p_entity_id
            )
          else false
        end
    )
  end;
$$;
revoke all on function private.purchase_intake_notification_visible(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;

create function private.notify_accepted_purchase_intake()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  project public.orders;
  submission public.form_submissions;
begin
  -- Derive identity and scope from saved rows, never event metadata or answers.
  if not exists (
    select 1 from public.tenant_memberships membership
    join public.profiles profile on profile.id = membership.profile_id and profile.archived_at is null
    where membership.tenant_id = new.tenant_id and membership.profile_id = new.actor_profile_id
      and membership.account_class = 'client' and membership.archived_at is null
  ) then return new; end if;

  if new.entity_type = 'order' and new.action = 'order.purchased' then
    select work.* into project
    from public.orders work
    where work.id = new.entity_id and work.tenant_id = new.tenant_id
      and exists (
        select 1 from public.invoice_items item
        join public.invoices invoice on invoice.id = item.invoice_id
        where item.order_id = work.id and item.service_id = work.service_id
          and item.fulfillment_status = 'provisioned'
          and invoice.tenant_id = work.tenant_id and invoice.company_id = work.company_id
          and invoice.client_profile_id = new.actor_profile_id
          and invoice.billing_reason = 'store_purchase' and invoice.status = 'paid'
          and invoice.archived_at is null
      );
    if project.id is null then return new; end if;
    perform private.emit_internal_notification_for_permission(
      'projects.view', 'order-purchased:' || project.id::text, 'project', 'info',
      'Service purchased', format('A client purchased a service. Order #%s.', project.order_number),
      '/orders/' || project.id::text, 'order', project.id, new.actor_profile_id,
      project.company_id, new.created_at
    );
  elsif new.entity_type = 'form_submission' and new.action = 'form.submitted' then
    select saved.* into submission
    from public.form_submissions saved
    join public.forms form on form.id = saved.form_id and form.form_type = 'intake'
      and form.tenant_id = new.tenant_id
    join public.form_assignments assignment on assignment.id = saved.form_assignment_id
      and assignment.form_id = saved.form_id and assignment.form_version_id = saved.form_version_id
      and assignment.order_id = saved.order_id and assignment.company_id = saved.company_id
      and assignment.client_profile_id = saved.submitted_by_profile_id
      and assignment.required and assignment.status = 'completed'
      and assignment.latest_submission_id = saved.id and assignment.completed_at is not null
    where saved.id = new.entity_id and saved.status = 'submitted'
      and saved.submitted_by_profile_id = new.actor_profile_id;
    if submission.id is null then return new; end if;
    perform private.emit_internal_notification_for_permission(
      'forms.submissions_view', 'intake-submitted:' || submission.id::text, 'form', 'info',
      'Service intake submitted', 'A client submitted the required service intake form.',
      '/forms/submissions/' || submission.id::text, 'form_submission', submission.id,
      new.actor_profile_id, submission.company_id, new.created_at
    );
  end if;
  return new;
end;
$$;
revoke all on function private.notify_accepted_purchase_intake() from public, anon, authenticated, service_role;

create trigger activity_events_notify_accepted_purchase_intake
  after insert on public.activity_events
  for each row
  when ((new.entity_type = 'order' and new.action = 'order.purchased')
    or (new.entity_type = 'form_submission' and new.action = 'form.submitted'))
  execute function private.notify_accepted_purchase_intake();

-- Reuse native Tenant/capability fanout and its unique recipient/event key.
create or replace function private.emit_internal_notification_for_permission(p_required_permission_key text, p_event_key text, p_category text, p_variant text, p_title text, p_body text, p_href text, p_entity_type text, p_entity_id uuid, p_actor_profile_id uuid, p_company_id uuid, p_created_at timestamp with time zone, p_exclude_profile_id uuid DEFAULT NULL::uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  with subject as (
    select private.activity_event_parent_tenant_id(p_entity_type, p_entity_id) as tenant_id
  )
  insert into public.notifications (
    recipient_profile_id,
    company_id,
    audience,
    category,
    variant,
    title,
    body,
    href,
    entity_type,
    entity_id,
    actor_profile_id,
    event_key,
    created_at,
    tenant_id
  )
  select
    membership_row.profile_id,
    p_company_id,
    'internal',
    p_category,
    p_variant,
    p_title,
    p_body,
    p_href,
    p_entity_type,
    p_entity_id,
    p_actor_profile_id,
    p_event_key,
    coalesce(p_created_at, now()),
    subject.tenant_id
  from subject
  join public.tenants as tenant_row
    on tenant_row.id = subject.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null
  join public.tenant_memberships as membership_row
    on membership_row.tenant_id = tenant_row.id
   and membership_row.account_class = 'internal'
   and membership_row.archived_at is null
  join public.profiles as profile_row
    on profile_row.id = membership_row.profile_id
   and profile_row.archived_at is null
  where (p_exclude_profile_id is null or membership_row.profile_id <> p_exclude_profile_id)
    and private.profile_has_permission_in_tenant(
      membership_row.profile_id,
      tenant_row.id,
      p_required_permission_key
    )
    and private.purchase_intake_notification_visible(
      membership_row.profile_id, p_event_key, p_entity_type, p_entity_id
    )
  on conflict (recipient_profile_id, event_key) do nothing;
$function$;

-- Recheck the same resource policy on every list and mark-read path.
CREATE OR REPLACE FUNCTION public.app_list_my_notifications(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, company_id uuid, audience text, category text, variant text, title text, body text, href text, entity_type text, entity_id uuid, actor_profile_id uuid, event_key text, read_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  row_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  return query
  select
    notification.id,
    notification.company_id,
    notification.audience,
    notification.category,
    notification.variant,
    notification.title,
    notification.body,
    notification.href,
    notification.entity_type,
    notification.entity_id,
    notification.actor_profile_id,
    notification.event_key,
    notification.read_at,
    notification.created_at
  from public.notifications as notification
  where notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
    and private.purchase_intake_notification_visible(
      caller_id, notification.event_key, notification.entity_type, notification.entity_id
    )
    and private.coupon_notification_visible(notification.entity_type,notification.entity_id,notification.category)
    and private.financial_notification_visible(notification.entity_type,notification.entity_id,notification.category,notification.company_id)
    and (notification.entity_type is distinct from 'subscription' or (private.activity_event_parent_tenant_id('subscription',notification.entity_id)=private.current_tenant_id() and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(notification.entity_id))))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    )
  order by notification.created_at desc, notification.id desc
  limit row_limit;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_mark_notification_read(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed boolean;
begin
  update public.notifications as notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = p_notification_id
    and notification.recipient_profile_id = caller_id
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
    and private.purchase_intake_notification_visible(
      caller_id, notification.event_key, notification.entity_type, notification.entity_id
    )
    and private.coupon_notification_visible(notification.entity_type,notification.entity_id,notification.category)
    and private.financial_notification_visible(notification.entity_type,notification.entity_id,notification.category,notification.company_id)
    and (notification.entity_type is distinct from 'subscription' or (private.activity_event_parent_tenant_id('subscription',notification.entity_id)=private.current_tenant_id() and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(notification.entity_id))))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  changed := found;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := private.require_active_notification_actor();
  changed integer;
begin
  update public.notifications as notification
  set read_at = now()
  where notification.recipient_profile_id = caller_id
    and notification.read_at is null
    and (
      notification.tenant_id is null
      or notification.tenant_id = (select private.current_tenant_id())
    )
    and (notification.entity_type is null or notification.entity_type not in ('order', 'order_task')
      or (private.profile_has_permission_in_tenant(caller_id,
        coalesce(notification.tenant_id, private.current_tenant_id()), 'projects.view')
        and coalesce(private.activity_event_parent_tenant_id(notification.entity_type, notification.entity_id),
          private.current_tenant_id()) = private.current_tenant_id()))
    and (notification.entity_type is distinct from 'ticket' or (
      private.tenant_module_allowed(coalesce(notification.tenant_id,private.current_tenant_id()),'tickets')
      and not exists (
      select 1 from public.tickets as linked_ticket
      where linked_ticket.id = notification.entity_id
        and not private.can_access_ticket(linked_ticket.id)
    )))
    and private.purchase_intake_notification_visible(
      caller_id, notification.event_key, notification.entity_type, notification.entity_id
    )
    and private.coupon_notification_visible(notification.entity_type,notification.entity_id,notification.category)
    and private.financial_notification_visible(notification.entity_type,notification.entity_id,notification.category,notification.company_id)
    and (notification.entity_type is distinct from 'subscription' or (private.activity_event_parent_tenant_id('subscription',notification.entity_id)=private.current_tenant_id() and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(notification.entity_id))))
    and notification.audience = (select private.profile_account_class(caller_id))
    and private.profile_has_permission(
      caller_id,
      private.notification_category_permission(
        notification.audience, notification.category
      )
    );

  get diagnostics changed = row_count;
  return changed;
end;
$function$;
