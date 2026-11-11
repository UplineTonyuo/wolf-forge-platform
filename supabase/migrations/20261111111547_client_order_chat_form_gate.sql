-- Completion is a property of the order, not the viewing company member.
-- Keep purchase/start/rollout state out of this read and write boundary.
create index form_assignments_order_chat_requirements on public.form_assignments(order_id) where order_id is not null;

create function private.order_conversation_forms_complete(p_order_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare project public.orders; gate private.client_order_starts;
begin
  select * into project from public.orders where id=p_order_id;
  if project.id is null then return false; end if;
  select * into gate from private.client_order_starts where order_id=project.id;
  if gate.order_id is not null and (
    gate.tenant_id is distinct from project.tenant_id or gate.company_id is distinct from project.company_id
    or gate.service_id is distinct from project.service_id or not private.order_start_forms_complete(gate)
  ) then return false; end if;
  -- Include legacy required assignments even when the Forms UI cannot list them.
  return not exists (
    select 1 from public.form_assignments a
    left join public.forms f on f.id=a.form_id
    left join public.form_versions v on v.id=a.form_version_id and v.form_id=a.form_id
    left join public.form_submissions s on s.id=a.latest_submission_id
    where a.order_id=project.id and (a.required or a.id=any(gate.assignment_ids))
      -- app_assign_form replaces recipient-less legacy intake by canceling its old row.
      and not (a.status='canceled' and a.archived_at is null and a.client_profile_id is null
        and not coalesce(a.id=any(gate.assignment_ids),false)
        and exists(select 1 from public.form_assignments successor
          where successor.order_id=a.order_id and successor.form_id=a.form_id and successor.company_id=a.company_id
            and successor.required and successor.client_profile_id is not null and successor.archived_at is null
            and successor.status in ('assigned','completed') and successor.assigned_at>=a.canceled_at))
      and (a.company_id is distinct from project.company_id or f.tenant_id is distinct from project.tenant_id
        or a.archived_at is not null or f.archived_at is not null or v.id is null or v.lifecycle_state is distinct from 'published'
        or a.status is distinct from 'completed' or s.status is distinct from 'submitted'
        or s.form_assignment_id is distinct from a.id or s.form_version_id is distinct from a.form_version_id
        or s.form_id is distinct from a.form_id or s.company_id is distinct from project.company_id
        or s.order_id is distinct from project.id or s.client_profile_id is distinct from a.client_profile_id)
  );
end;
$$;
revoke all on function private.order_conversation_forms_complete(uuid) from public,anon,authenticated,service_role;

create function public.app_my_order_chat_available(p_order_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor record; project public.orders;
begin
  select * into actor from private.current_ticket_actor();
  if actor.profile_id is null or actor.role_name is distinct from 'client' then
    raise exception 'Client account required' using errcode='42501'; end if;
  perform public.app_require_module_access('portal_projects');
  perform private.require_permission('projects.view');
  perform private.require_permission('tickets.view');
  select * into project from public.orders where id=p_order_id
    and tenant_id=private.current_tenant_id() and company_id=actor.company_id and archived_at is null;
  if project.id is null then raise exception 'Project not found' using errcode='P0002'; end if;
  return private.order_conversation_forms_complete(project.id);
end;
$$;
revoke all on function public.app_my_order_chat_available(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_my_order_chat_available(uuid) to authenticated;

-- Patch only the existing effective-client branches; retain owners and ACLs.
do $migration$
declare change record; target oid; original text; replacement text; owner_before oid; acl_before aclitem[];
begin
  for change in select * from (values
    ('private.require_order_conversation_access(uuid)',
      '  return project;',
      $patch$  if actor.role_name='client' and not private.order_conversation_forms_complete(project.id) then
    raise exception 'Complete required service forms before using chat' using errcode='42501';
  end if;
  return project;$patch$),
    ('private.enforce_ticket_module_write()',
      '  return new;',
      $patch$  if target_order is not null
    and exists(select 1 from private.current_ticket_actor() actor where actor.role_name='client')
    -- Purchase receipts are trusted inserts even inside the buyer's session.
    and not (tg_op='INSERT' and tg_table_name in ('ticket_messages','project_messages')
      and to_jsonb(new)->>'author_type'='system' and to_jsonb(new)->>'author_profile_id' is null)
    and not private.order_conversation_forms_complete(target_order) then
    raise exception 'Complete required service forms before using chat' using errcode='42501';
  end if;
  return new;$patch$),
    ('private.can_access_ticket(uuid)',
      '(actor.role_name = ''client'' and project.company_id = actor.company_id)',
      '(actor.role_name = ''client'' and project.company_id = actor.company_id and private.order_conversation_forms_complete(project.id))'),
    ('private.order_call_profile_allowed(uuid,uuid,boolean)',
      'm.account_class=''client'' and m.company_id=o.company_id',
      'm.account_class=''client'' and m.company_id=o.company_id and private.order_conversation_forms_complete(o.id)'),
    ('private.ticket_call_profile_allowed(uuid,uuid,boolean)',
      'member.account_class=''client'' and project.company_id=member.company_id',
      'member.account_class=''client'' and project.company_id=member.company_id and private.order_conversation_forms_complete(project.id)'),
    ('private.client_support_operation_allowed(text,text)',
      '''app_get_my_order_start'',',
      '''app_get_my_order_start'',''app_my_order_chat_available'','),
    ('public.app_list_my_order_response_states(uuid[])',
      'case when linked.id is not null and (',
      'case when not private.order_conversation_forms_complete(project.id) then null::boolean when linked.id is not null and ('),
    ('public.app_list_my_order_response_states(uuid[])',
      'linked.id is null and message.order_id=project.id',
      'linked.id is null and private.order_conversation_forms_complete(project.id) and message.order_id=project.id'),
    ('private.purchase_intake_notification_visible(uuid,text,text,uuid)',
      '  select case',
      $patch$  select case
    when split_part(p_event_key, ':', 1)='client-conversation' and p_entity_type='project'
      and private.profile_account_class(p_profile_id)='client'
      then private.order_conversation_forms_complete(p_entity_id)$patch$)
  ) as patches(signature,needle,addition)
  loop
    target:=change.signature::regprocedure;
    select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
    if (length(original)-length(replace(original,change.needle,'')))/length(change.needle)<>1 then
      raise exception 'Unexpected chat gate baseline: %',change.signature; end if;
    replacement:=replace(original,change.needle,change.addition);
    execute replace(pg_get_functiondef(target),original,replacement);
    if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before
      and proacl is not distinct from acl_before and 'search_path=""'=any(proconfig)) then
      raise exception 'Chat gate function preservation failed: %',change.signature; end if;
  end loop;
end;
$migration$;
