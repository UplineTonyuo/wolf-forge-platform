-- Compose reserved Forms232 and Coupons233 without changing their accepted source.
-- Forms234/235 retain collection, history, post-wait authority and trusted bootstrap controls.
create or replace function private.published_module_set_valid(p_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    p_keys is not null
    and array_ndims(p_keys) = 1
    and cardinality(p_keys) = (select count(distinct key) from unnest(p_keys) as requested(key))
    and not exists (
      select 1 from unnest(p_keys) as requested(key)
      where key is null or not exists (
        select 1 from private.white_label_modules as catalog where catalog.module_key = key
      )
    )
    and (not ('projects' = any(p_keys)) or 'tickets' = any(p_keys))
    and (not ('subscriptions' = any(p_keys)) or 'invoices' = any(p_keys))
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key = any(p_keys)
        and catalog.requires_module_key is not null
        and not (catalog.requires_module_key = any(p_keys))
    )
    -- Services remains required; eight modules have accepted disablement policies.
    and not exists (
      select 1 from private.white_label_modules as catalog
      where catalog.module_key not in ('reporting', 'investment_intent', 'projects', 'tickets', 'subscriptions', 'invoices', 'forms', 'coupons') and not (catalog.module_key = any(p_keys))
    ), false);
$function$;

create or replace function private.profile_has_permission_in_tenant(p_profile_id uuid, p_tenant_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    (case when p_permission_key in ('reporting.view', 'reports.send', 'reports.send_anytime')
      then private.tenant_module_allowed(p_tenant_id, 'reporting')
      when p_permission_key in ('investment_intent.view', 'investment_intent.manage')
      then private.tenant_module_allowed(p_tenant_id, 'investment_intent')
      when p_permission_key in ('projects.view', 'projects.create', 'projects.edit', 'projects.assign', 'projects.archive')
      then private.tenant_module_allowed(p_tenant_id, 'projects')
      when p_permission_key in ('tickets.view', 'tickets.create', 'tickets.reply', 'tickets.edit', 'tickets.assign', 'tickets.internal_notes', 'tickets.archive')
      then private.tenant_module_allowed(p_tenant_id, 'tickets')
      when p_permission_key in ('forms.manage','forms.publish','forms.assign','forms.submissions_manage')
      then private.tenant_module_allowed(p_tenant_id,'forms')
      when p_permission_key in ('coupons.view','coupons.manage')
      then private.tenant_module_allowed(p_tenant_id,'coupons')
      else true end)
    and coalesce((
      select case when preset_row.key = 'owner' then true else coalesce(
        (select profile_override.allowed from public.profile_permission_overrides as profile_override
         where profile_override.tenant_id = membership_row.tenant_id
           and profile_override.profile_id = membership_row.profile_id
           and profile_override.permission_key = p_permission_key),
        (select preset_grant.allowed from public.role_permissions as preset_grant
         where preset_grant.role_id = membership_row.role_id
           and preset_grant.permission_key = p_permission_key), false) end
      from public.tenant_memberships as membership_row
      join public.permission_presets as preset_row on preset_row.role_id = membership_row.role_id
      where membership_row.tenant_id = p_tenant_id
        and membership_row.profile_id = p_profile_id
        and membership_row.archived_at is null
        and exists (select 1 from public.permissions as permission where permission.permission_key = p_permission_key)
    ), false);
$function$;
