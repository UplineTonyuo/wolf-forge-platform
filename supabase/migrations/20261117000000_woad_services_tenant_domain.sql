-- Register the WOAD services host as a verified Wolf Forge tenant selector.
-- Existing aliases, grants, functions and tenant authorization are unchanged.
insert into public.tenant_domains (host, tenant_id, verified_at)
values
  ('services.wolfforgedigitalagency.com', private.wolf_forge_tenant_id(), now())
on conflict (host) do nothing;
