-- integration_connections is operated through hardened SECURITY DEFINER RPCs.
-- Preserve its existing service-role privileges while removing only the
-- unintended destructive capability inherited when the table was created.
revoke truncate on table public.integration_connections from service_role;

-- team_pair_key is an implementation detail of the postgres-owned
-- app_start_team_conversation RPC. The RPC executes this helper as its owner,
-- so no API role requires direct EXECUTE on the private helper.
revoke execute on function private.team_pair_key(uuid, uuid)
  from public, anon, authenticated, service_role;
