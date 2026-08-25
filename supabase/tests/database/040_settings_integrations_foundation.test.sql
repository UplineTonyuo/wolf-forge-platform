-- Settings + Integrations foundation policy contract.
begin;

select plan(17);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'settings-admin@example.invalid', now(), now()),
  ('a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'settings-staff@example.invalid', now(), now()),
  ('a1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'settings-client@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Settings Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin' and profile_row.id = 'a1000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Settings Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff' and profile_row.id = 'a1000000-0000-0000-0000-000000000002';

select has_table('public', 'integration_connections', 'connection metadata table exists');
select has_column('public', 'integration_connections', 'provider', 'provider is persisted');
select has_column('public', 'integration_connections', 'granted_scopes', 'granted scopes are persisted');
select has_column('public', 'integration_connections', 'provider_metadata', 'provider metadata is persisted');

select ok(
  not has_table_privilege('authenticated', 'public.integration_connections', 'SELECT')
  and not has_table_privilege('authenticated', 'public.integration_connections', 'INSERT')
  and not has_table_privilege('authenticated', 'public.integration_connections', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.integration_connections', 'DELETE'),
  'authenticated has no direct connection-table path'
);

select ok(
  exists (
    select 1 from public.role_permissions role_permission
    join public.roles role_row on role_row.id = role_permission.role_id
    where role_row.name = 'admin' and role_permission.permission_key = 'integrations.manage' and role_permission.allowed
  ),
  'admin receives integrations.manage'
);

select ok(
  not exists (
    select 1 from public.role_permissions role_permission
    join public.roles role_row on role_row.id = role_permission.role_id
    where role_row.name in ('staff', 'client') and role_permission.permission_key = 'integrations.manage' and role_permission.allowed
  ),
  'staff and clients do not receive integrations.manage'
);

select ok(to_regprocedure('public.app_connect_integration(text)') is null, 'no fake connect RPC exists');
select ok(to_regprocedure('public.app_list_integration_connections()') is not null, 'safe list RPC exists');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';

select is((select count(*) from public.app_list_integration_connections()), 0::bigint, 'admin reads an honest empty connection set');
select throws_ok($$ select count(*) from public.integration_connections $$, '42501', null, 'admin cannot read the raw table');

reset role;
insert into public.integration_connections (
  provider, status, connected_account_id, connected_account_display,
  connected_by_profile_id, connected_at, granted_scopes, provider_metadata
) values (
  'stripe', 'connected', 'acct_server_private', 'Wolf Forge · Merchant 4242',
  'a1000000-0000-0000-0000-000000000001', now(), array['payments:read'], '{"safe_region":"US"}'::jsonb
);

set local role authenticated;
select is((select status from public.app_list_integration_connections() where provider = 'stripe'), 'connected', 'connected state comes from persisted metadata');
select is((select connected_account_display from public.app_list_integration_connections() where provider = 'stripe'), 'Wolf Forge · Merchant 4242', 'safe display identity is projected');

reset role;
select throws_ok(
  $$ insert into public.integration_connections (provider, provider_metadata)
     values ('gmail', '{"oauth":{"refresh_token":"forbidden"}}'::jsonb) $$,
  '23514',
  null,
  'credential-shaped provider metadata is refused by the database'
);

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000001';
select lives_ok($$ select private.require_integration_admin() $$, 'admin passes the future integration mutation guard');

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000002';
select throws_ok($$ select private.require_integration_admin() $$, '42501', null, 'staff is rejected by the integration mutation guard');

set local "request.jwt.claim.sub" = 'a1000000-0000-0000-0000-000000000003';
select throws_ok($$ select private.require_integration_admin() $$, '42501', null, 'client is rejected by the integration mutation guard');

select * from finish();
rollback;
