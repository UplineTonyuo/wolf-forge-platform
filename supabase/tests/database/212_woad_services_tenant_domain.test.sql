begin;

select plan(4);

-- Capture the canonical tenant before exercising the proxy's anon RPC role.
select private.wolf_forge_tenant_id()::text as wolf_forge_tenant_id \gset
set local role anon;

select is(
  public.app_resolve_tenant_host('services.wolfforgedigitalagency.com'),
  :'wolf_forge_tenant_id'::uuid,
  'WOAD services host resolves to the Wolf Forge tenant'
);
select is(
  public.app_resolve_tenant_host('wolf-forge-platform-woad.vercel.app'),
  :'wolf_forge_tenant_id'::uuid,
  'existing WOAD Vercel host still resolves to the Wolf Forge tenant'
);
select is(
  public.app_resolve_tenant_host('wolf-forge-platform-wolf-forge.vercel.app'),
  :'wolf_forge_tenant_id'::uuid,
  'existing Wolf Forge Vercel host still resolves to the Wolf Forge tenant'
);
select is(
  public.app_resolve_tenant_host('unrelated.example.invalid'),
  null::uuid,
  'an unrelated host still fails closed'
);

select * from finish();
rollback;
