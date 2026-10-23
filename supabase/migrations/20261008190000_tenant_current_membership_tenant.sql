-- WL-2.22a (KI-125 prerequisite): the application learns WHICH Tenant the
-- caller's current membership belongs to.
--
-- Operations department data (Podcast SEO and the other Google Sheet
-- workflows) is a single Wolf Forge integration with a global Next.js cache.
-- Before Tenant routing sends a selector, those surfaces must refuse an
-- internal member of any other Tenant (D-285). The server can only do that
-- from the database-validated current Tenant: private.current_tenant_id()
-- already authorizes the selector against an active membership in an active
-- Tenant, so the same row now also returns its tenant_id. Caller-only, no
-- argument, unchanged otherwise. The column is appended, so existing callers
-- keep working; the return type change requires drop + create.

drop function public.app_current_tenant_membership();

create function public.app_current_tenant_membership()
returns table(account_class text, role_name text, tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select membership_row.account_class, role_row.name, membership_row.tenant_id
  from public.tenant_memberships as membership_row
  join public.roles as role_row
    on role_row.id = membership_row.role_id
  where membership_row.tenant_id = (select private.current_tenant_id())
    and membership_row.profile_id = (select auth.uid())
    and membership_row.archived_at is null;
$$;

revoke all on function public.app_current_tenant_membership() from public, anon, service_role;
grant execute on function public.app_current_tenant_membership() to authenticated;
