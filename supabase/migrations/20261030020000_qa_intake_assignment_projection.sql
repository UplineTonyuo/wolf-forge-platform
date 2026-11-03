-- Repair intake navigation and fail-closed gate reads/creation; retain frozen assignments and start proof.
do $migration$
declare
  target oid;
  original text;
  replacement text;
  definition text;
  owner_before oid;
  acl_before aclitem[];
  needle text := 'private.can_access_operational_order(work.id)';
begin
  target := 'public.app_list_assigned_forms()'::regprocedure;
  select prosrc, proowner, proacl into original, owner_before, acl_before from pg_proc where oid=target;
  if (length(original)-length(replace(original,needle,'')))/length(needle) <> 3 then
    raise exception 'Unexpected assigned-form Project projection';
  end if;
  replacement := replace(original, needle, $predicate$(
    private.can_access_operational_order(work.id)
    or (client_access and work.company_id=client_company_id
      and work.tenant_id=private.current_tenant_id() and work.archived_at is null
      and private.tenant_module_allowed(work.tenant_id,'projects')
      and private.current_user_has_permission('projects.view'))
  )$predicate$);
  definition := pg_get_functiondef(target);
  execute replace(definition,original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
    raise exception 'Assigned-form function preservation failed';
  end if;

  target := 'public.app_get_my_order_start(uuid)'::regprocedure;
  select prosrc, proowner, proacl into original, owner_before, acl_before from pg_proc where oid=target;
  needle := $old$  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',f.name,'completed',a.status='completed',
    'available',a.archived_at is null and f.archived_at is null and f.status='published') order by a.assigned_at),'[]'::jsonb)
    into requirements from public.form_assignments a join public.forms f on f.id=a.form_id and f.tenant_id=g.tenant_id
    where a.id=any(g.assignment_ids) and a.order_id=g.order_id and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id;$old$;
  if position(needle in original)=0 then needle:=replace(needle,E'\n',E'\r\n'); end if;
  if position(needle in original)=0 then raise exception 'Unexpected order start requirements projection'; end if;
  replacement := replace(original,needle,$new$  select jsonb_agg(jsonb_build_object(
    'id',required.id,'title',coalesce(f.name,'Required service form'),
    'completed',coalesce(a.status='completed' and a.archived_at is null
      and a.order_id=g.order_id and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id
      and f.tenant_id=g.tenant_id and g.assignment_versions->>a.id::text=a.form_version_id::text
      and s.status='submitted' and s.form_assignment_id=a.id and s.form_version_id=a.form_version_id
      and s.form_id=a.form_id and s.company_id=g.company_id and s.order_id=g.order_id,false),
    'available',coalesce(a.status='assigned' and a.archived_at is null
      and a.order_id=g.order_id and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id
      and f.tenant_id=g.tenant_id and f.archived_at is null and f.status='published'
      and v.form_id=f.id and v.lifecycle_state='published'
      and g.assignment_versions->>a.id::text=a.form_version_id::text,false)
    ) order by required.ordinal)
    into requirements from unnest(g.assignment_ids) with ordinality as required(id,ordinal)
    left join public.form_assignments a on a.id=required.id and a.order_id=g.order_id
      and a.company_id=g.company_id and a.client_profile_id=g.purchaser_id
    left join public.forms f on f.id=a.form_id and f.tenant_id=g.tenant_id
    left join public.form_versions v on v.id=a.form_version_id
    left join public.form_submissions s on s.id=a.latest_submission_id;$new$);
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
    raise exception 'Order start function preservation failed';
  end if;

  -- A purchaser's missing UI grant must not turn a required purchase into an ungated order.
  target := 'private.assign_purchase_intake_forms(uuid)'::regprocedure;
  select prosrc, proowner, proacl into original, owner_before, acl_before from pg_proc where oid=target;
  needle := $old$    begin
      perform public.app_require_module_access('portal_projects'); perform private.require_permission('projects.view');
      perform public.app_require_module_access('portal_forms'); perform private.require_permission('forms.view');
    exception when insufficient_privilege then return assigned_count;
    end;
$old$;
  if position(needle in original)=0 then needle:=replace(needle,E'\n',E'\r\n'); end if;
  if position(needle in original)=0 then raise exception 'Unexpected purchase intake gate creation'; end if;
  replacement := replace(original,needle,'');
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
    raise exception 'Purchase intake function preservation failed';
  end if;
end;
$migration$;
