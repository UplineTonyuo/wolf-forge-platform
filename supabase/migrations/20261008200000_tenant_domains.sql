-- WL-2.22b (KI-125): verified request host -> Tenant.
--
-- The host map is a SELECTOR source only. The proxy sends the resolved Tenant
-- as `x-wf-tenant`, and private.current_tenant_id() still authorizes it
-- against the caller's active membership in an active Tenant (D-261). A row
-- here grants nobody anything.
--
-- A stored hostname is not proof that the Tenant controls the domain. A row
-- only resolves once `verified_at` is set by an operator after the domain is
-- independently verified on the hosting edge. There is no client-writable
-- path: no grants to any API role and no write RPC.

create table public.tenant_domains (
  host text primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_domains_host_canonical check (
    char_length(host) <= 253
    and host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);

create index tenant_domains_tenant_id_idx on public.tenant_domains (tenant_id);

alter table public.tenant_domains enable row level security;
alter table public.tenant_domains force row level security;
revoke all on table public.tenant_domains from public, anon, authenticated, service_role;

create function public.app_resolve_tenant_host(p_host text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select domain_row.tenant_id
  from public.tenant_domains as domain_row
  join public.tenants as tenant_row
    on tenant_row.id = domain_row.tenant_id
   and tenant_row.status = 'active'
   and tenant_row.archived_at is null
  where domain_row.host = p_host
    and domain_row.verified_at is not null
    and domain_row.disabled_at is null;
$$;

revoke all on function public.app_resolve_tenant_host(text) from public, authenticated, service_role;
grant execute on function public.app_resolve_tenant_host(text) to anon;

comment on function public.app_resolve_tenant_host(text)
is 'WL-2.22b: the Tenant for an exact canonical request host, only when the mapping is verified, not disabled, and the Tenant is active. A selector source, never authorization.';

-- Wolf Forge production aliases, confirmed on the live production deployment
-- of the wolf-forge-platform Vercel project (2026-10-08). Branch aliases,
-- per-deployment URLs and Preview hosts are deliberately absent: they fail
-- closed until registered and verified.
insert into public.tenant_domains (host, tenant_id, verified_at)
values
  ('wolf-forge-platform-woad.vercel.app', private.wolf_forge_tenant_id(), now()),
  ('wolf-forge-platform-wolf-forge.vercel.app', private.wolf_forge_tenant_id(), now());
