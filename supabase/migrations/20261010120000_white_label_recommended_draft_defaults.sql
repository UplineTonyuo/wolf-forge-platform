-- Revision-zero draft preferences only; saved drafts and published authorization are unchanged.
CREATE OR REPLACE FUNCTION public.app_get_white_label_draft(p_tenant_id uuid)
 RETURNS TABLE(tenant_id uuid, tenant_status text, display_name text, primary_color text, accent_color text, module_keys text[], revision integer, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_platform_admin();

  return query
  select
    tenant_row.id,
    tenant_row.status,
    coalesce(draft_row.display_name, btrim(left(tenant_row.display_name, 60))),
    coalesce(draft_row.primary_color, '#000d51'),
    coalesce(draft_row.accent_color, '#a8832e'),
    coalesce(
      draft_row.module_keys,
      (select array_agg(catalog.module_key order by catalog.module_key) from private.white_label_modules as catalog
       where catalog.module_key in ('services', 'projects', 'tickets', 'reporting', 'invoices', 'forms'))
    ),
    coalesce(draft_row.revision, 0),
    draft_row.updated_at
  from public.tenants as tenant_row
  left join private.tenant_white_label_drafts as draft_row on draft_row.tenant_id = tenant_row.id
  where tenant_row.id = p_tenant_id;

  if not found then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
end;
$function$;
