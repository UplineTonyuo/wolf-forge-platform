begin;

revoke execute on function public.app_get_published_form_schema(text) from public, anon;

create function public.app_get_public_form_schema(p_tenant_id uuid, p_canonical_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.forms as form
    join public.tenants as tenant on tenant.id = form.tenant_id
    join public.form_versions as version on version.id = form.published_version_id and version.form_id = form.id
    where form.tenant_id = p_tenant_id
      and form.canonical_key = lower(p_canonical_key)
      and form.status = 'published'
      and form.visibility = 'public'
      and form.archived_at is null
      and version.visibility = 'public'
      and version.lifecycle_state = 'published'
      and tenant.status = 'active'
      and tenant.archived_at is null
      and private.tenant_module_allowed(form.tenant_id, 'forms')
  ) then
    raise no_data_found;
  end if;

  -- Reuse the public branch's allowlisted projection; no respondent data.
  return public.app_get_published_form_schema(p_canonical_key);
end;
$function$;

revoke all on function public.app_get_public_form_schema(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_get_public_form_schema(uuid, text) to service_role;

commit;
