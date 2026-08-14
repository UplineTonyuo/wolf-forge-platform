begin;

select plan(81);

-- =============================================================================
-- STRUCTURE
-- =============================================================================

select ok(
  to_regclass('public.permission_presets') is not null,
  'permission_presets table exists'
);

select ok(
  to_regclass('public.permission_preset_grants') is not null,
  'permission_preset_grants projection exists'
);

select ok(
  to_regclass('public.permission_modules') is not null,
  'permission_modules table exists'
);

select is(
  (
    select count(*)
    from public.permission_presets
    where key in ('owner', 'admin', 'manager', 'staff', 'client')
      and system_managed
  ),
  5::bigint,
  'the five system presets are seeded and system-managed'
);

select is(
  (
    select count(*)
    from public.permission_presets
    where account_class = 'client'
  ),
  1::bigint,
  'exactly one client-class preset exists'
);

select is(
  (
    select count(*)
    from public.profiles as profile_row
    join public.permission_presets as preset_row
      on preset_row.role_id = profile_row.role_id
  ),
  (select count(*) from public.profiles),
  'every profile resolves to exactly one permission preset'
);

select throws_ok(
  $$ delete from public.permission_presets where key = 'owner' $$,
  '42501',
  null,
  'system presets cannot be deleted'
);

select throws_ok(
  $$ update public.permission_presets set account_class = 'client' where key = 'admin' $$,
  '42501',
  null,
  'system preset account class cannot be redefined'
);

-- =============================================================================
-- FIXTURES
--
-- The auth trigger creates every profile as an unclaimed client account.
-- Internal fixtures are promoted below.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'preset-owner@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'preset-admin@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'preset-manager@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'preset-staff@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'preset-client-a@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated',
   'preset-client-b@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated',
   'preset-new-member@example.invalid', now(), now()),
  ('30000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated',
   'preset-new-client@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('31000000-0000-0000-0000-000000000001', 'Preset Company A'),
  ('31000000-0000-0000-0000-000000000002', 'Preset Company B'),
  ('31000000-0000-0000-0000-000000000003', 'Preset Company C');

update public.profiles as profile_row
set role_id = role_row.id
from public.roles as role_row
where role_row.name = 'owner'
  and profile_row.id = '30000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id
from public.roles as role_row
where role_row.name = 'admin'
  and profile_row.id = '30000000-0000-0000-0000-000000000002';

update public.profiles as profile_row
set role_id = role_row.id
from public.roles as role_row
where role_row.name = 'manager'
  and profile_row.id = '30000000-0000-0000-0000-000000000003';

update public.profiles as profile_row
set role_id = role_row.id
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '30000000-0000-0000-0000-000000000004';

update public.profiles
set company_id = '31000000-0000-0000-0000-000000000001'
where id = '30000000-0000-0000-0000-000000000005';

update public.profiles
set company_id = '31000000-0000-0000-0000-000000000002'
where id = '30000000-0000-0000-0000-000000000006';

-- =============================================================================
-- PRESET DEFAULTS
-- =============================================================================

select is(
  private.profile_permission_preset_key('30000000-0000-0000-0000-000000000001'),
  'owner',
  'owner fixture resolves to the owner preset'
);

select ok(
  private.profile_has_permission(
    '30000000-0000-0000-0000-000000000001', 'services.archive'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000001', 'users.manage_permissions'
  ),
  'owner preset resolves every registered capability'
);

select ok(
  private.profile_has_permission(
    '30000000-0000-0000-0000-000000000002', 'users.manage_permissions'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000002', 'client_private.read'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000002', 'invoices.refund'
  ),
  'admin preset keeps its current administrative defaults'
);

select ok(
  private.profile_has_permission(
    '30000000-0000-0000-0000-000000000003', 'clients.view'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000003', 'client_directory.read'
  )
  and not private.profile_has_permission(
    '30000000-0000-0000-0000-000000000003', 'users.manage_permissions'
  )
  and not private.profile_has_permission(
    '30000000-0000-0000-0000-000000000003', 'subscriptions.manage'
  ),
  'manager preset keeps its current defaults'
);

select ok(
  private.profile_has_permission(
    '30000000-0000-0000-0000-000000000004', 'services.view'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000004', 'forms.view'
  )
  and not private.profile_has_permission(
    '30000000-0000-0000-0000-000000000004', 'invoices.manage'
  )
  and not private.profile_has_permission(
    '30000000-0000-0000-0000-000000000004', 'clients.view'
  ),
  'staff preset keeps its current defaults'
);

-- Regular staff must not gain client-private access from directory access.
select ok(
  not private.profile_has_permission(
    '30000000-0000-0000-0000-000000000003', 'client_private.read'
  )
  and not private.profile_has_permission(
    '30000000-0000-0000-0000-000000000004', 'client_private.read'
  ),
  'client-private read stays restricted to explicitly authorized administrators'
);

select ok(
  private.profile_has_permission(
    '30000000-0000-0000-0000-000000000005', 'projects.view'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000005', 'tickets.reply'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000005', 'forms.view'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000005', 'invoices.view'
  )
  and private.profile_has_permission(
    '30000000-0000-0000-0000-000000000005', 'subscriptions.view'
  ),
  'client preset covers the existing client portal modules'
);

select is(
  (
    select count(*)
    from unnest(array[
      'clients.view',
      'client_private.read',
      'client_private.manage',
      'client_directory.read',
      'services.create',
      'coupons.manage',
      'settings.view',
      'users.view',
      'users.create',
      'users.manage_permissions',
      'tickets.internal_notes',
      'forms.manage'
    ]::text[]) as internal_permission
    where private.profile_has_permission(
      '30000000-0000-0000-0000-000000000005', internal_permission
    )
  ),
  0::bigint,
  'client preset contains no internal administrative capability'
);

-- =============================================================================
-- MODULE BOUNDARIES DERIVED FROM REAL CAPABILITIES
-- =============================================================================

select is(
  (
    select count(*)
    from public.permission_modules as module_row
    where not exists (
      select 1
      from public.permissions as permission_row
      where permission_row.permission_key = module_row.required_permission_key
    )
  ),
  0::bigint,
  'every module boundary maps to a registered capability'
);

select is(
  (
    select count(*)
    from public.permission_modules
    where account_class = 'client'
  ),
  6::bigint,
  'the client portal exposes exactly the existing portal modules'
);

-- =============================================================================
-- PRESET + OVERRIDE RESOLUTION
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000003';

select ok(
  not public.app_has_permission('coupons.view'),
  'with no override the manager preset value is used'
);

select ok(
  public.app_require_module_access('clients'),
  'an internal member holding clients.view can reach the Clients module'
);

select is(
  (
    select count(*)
    from public.app_search_client_directory('preset', 20)
  ),
  3::bigint,
  'an internal member holding client_directory.read can read the client backend'
);

select throws_ok(
  $$ select public.app_set_profile_permission_preset(
       '30000000-0000-0000-0000-000000000003',
       'admin'
     ) $$,
  '42501',
  null,
  'a member cannot change its own preset'
);

select throws_ok(
  $$ select public.app_set_profile_permission_preset(
       '30000000-0000-0000-0000-000000000004',
       'admin'
     ) $$,
  '42501',
  null,
  'a member without permission management cannot change another preset'
);

select throws_ok(
  $$ select public.app_set_profile_permission_override(
       '30000000-0000-0000-0000-000000000004',
       'clients.view',
       true
     ) $$,
  '42501',
  null,
  'a member without permission management cannot set overrides'
);

select throws_ok(
  $$ select * from public.app_get_profile_effective_permissions(
       '30000000-0000-0000-0000-000000000004'
     ) $$,
  '42501',
  null,
  'a member without permission management cannot inspect another profile'
);

select is(
  (
    select count(*)
    from public.app_get_profile_effective_permissions()
    where allowed
  ),
  (
    select count(*)
    from public.app_current_user_permissions()
  ),
  'a member can always resolve its own effective permissions'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- STAFF SELF-PROTECTION
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000004';

select throws_ok(
  $$ select public.app_set_profile_permission_preset(
       '30000000-0000-0000-0000-000000000004',
       'owner'
     ) $$,
  '42501',
  null,
  'staff cannot promote itself'
);

select throws_ok(
  $$ select public.app_set_profile_permission_override(
       '30000000-0000-0000-0000-000000000004',
       'client_private.read',
       true
     ) $$,
  '42501',
  null,
  'staff cannot grant itself client-private access'
);

select throws_ok(
  $$ select * from public.app_list_permission_presets() $$,
  '42501',
  null,
  'staff cannot enumerate permission configuration'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- CLIENT SELF-PROTECTION AND ISOLATION
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select public.app_set_profile_permission_override(
       '30000000-0000-0000-0000-000000000005',
       'clients.view',
       true
     ) $$,
  '42501',
  null,
  'a client cannot grant itself a permission'
);

select throws_ok(
  $$ select public.app_set_profile_permission_preset(
       '30000000-0000-0000-0000-000000000005',
       'admin'
     ) $$,
  '42501',
  null,
  'a client cannot change its own preset'
);

select throws_ok(
  $$ select * from public.app_get_profile_effective_permissions(
       '30000000-0000-0000-0000-000000000006'
     ) $$,
  '42501',
  null,
  'a client cannot inspect another company client permission data'
);

select throws_ok(
  $$ select public.app_require_module_access('clients') $$,
  '42501',
  null,
  'a client cannot reach an internal module boundary'
);

select is(
  (
    select count(*)
    from public.app_current_user_modules()
    where account_class <> 'client'
  ),
  0::bigint,
  'a client can only see client portal module boundaries'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- ADMINISTERED OVERRIDES
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000002';

select ok(
  (
    public.app_set_profile_permission_override(
      '30000000-0000-0000-0000-000000000003',
      'coupons.view',
      true
    )
  ).allowed,
  'an authorized administrator can set an ALLOW override'
);

select ok(
  (
    select allowed
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000003'
    )
    where permission_key = 'coupons.view'
  ),
  'an ALLOW override grants a capability the preset does not include'
);

select is(
  (
    select source
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000003'
    )
    where permission_key = 'coupons.view'
  ),
  'override',
  'the effective permission read reports the override as its source'
);

select ok(
  not (
    public.app_set_profile_permission_override(
      '30000000-0000-0000-0000-000000000003',
      'clients.view',
      false
    )
  ).allowed,
  'an authorized administrator can set a DENY override'
);

select ok(
  not (
    select allowed
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000003'
    )
    where permission_key = 'clients.view'
  ),
  'a DENY override removes a preset capability'
);

select ok(
  public.app_clear_profile_permission_override(
    '30000000-0000-0000-0000-000000000003',
    'clients.view'
  ),
  'an authorized administrator can clear an override'
);

select ok(
  (
    select allowed
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000003'
    )
    where permission_key = 'clients.view'
  ),
  'clearing an override restores preset inheritance'
);

select is(
  (
    select source
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000003'
    )
    where permission_key = 'clients.view'
  ),
  'preset',
  'a cleared override reverts the effective permission source to the preset'
);

-- Internal Clients denial must hold at every backend entry point.
select ok(
  not (
    public.app_set_profile_permission_override(
      '30000000-0000-0000-0000-000000000003',
      'client_directory.read',
      false
    )
  ).allowed,
  'Clients backend access can be denied for a single internal member'
);

select ok(
  not (
    public.app_set_profile_permission_override(
      '30000000-0000-0000-0000-000000000003',
      'clients.view',
      false
    )
  ).allowed,
  'the Clients module capability can be denied for a single internal member'
);

-- Client portal denial is per-client and never leaks across companies.
select ok(
  not (
    public.app_set_profile_permission_override(
      '30000000-0000-0000-0000-000000000005',
      'subscriptions.view',
      false
    )
  ).allowed,
  'a client portal module can be denied for one client'
);

select throws_ok(
  $$ select public.app_set_profile_permission_override(
       '30000000-0000-0000-0000-000000000005',
       'client_private.read',
       true
     ) $$,
  '42501',
  null,
  'an internal capability cannot be granted to a client through an override'
);

select throws_ok(
  $$ select public.app_set_profile_permission_preset(
       '30000000-0000-0000-0000-000000000005',
       'manager'
     ) $$,
  '42501',
  null,
  'an internal preset cannot be assigned to a client account'
);

select throws_ok(
  $$ select public.app_set_profile_permission_preset(
       '30000000-0000-0000-0000-000000000004',
       'client'
     ) $$,
  '42501',
  null,
  'a client preset cannot be assigned to an internal member'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- DENIAL CANNOT BE BYPASSED AT THE RPC BOUNDARY
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.app_require_module_access('clients') $$,
  '42501',
  null,
  'a denied internal member is rejected server-side at the Clients module'
);

select throws_ok(
  $$ select * from public.app_search_client_directory('preset', 20) $$,
  '42501',
  null,
  'a denied internal member cannot bypass the denial through the client RPC'
);

select is(
  (
    select granted
    from public.app_current_user_modules()
    where module_key = 'clients'
  ),
  false,
  'module visibility is derived from the real effective capability'
);

reset role;
set local "request.jwt.claim.sub" = '';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select public.app_require_module_access('portal_subscriptions') $$,
  '42501',
  null,
  'the denied client portal module is rejected server-side'
);

select ok(
  public.app_require_module_access('portal_invoices'),
  'other portal modules for the same client remain available'
);

reset role;
set local "request.jwt.claim.sub" = '';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000006';

select ok(
  public.app_require_module_access('portal_subscriptions'),
  'a client override never affects another client'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- PROVISIONING
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000002';

select is(
  (
    public.app_provision_internal_member_profile(
      '30000000-0000-0000-0000-000000000007',
      'manager',
      'Provisioned Member',
      '[{"permission_key": "clients.view", "allowed": false}]'::jsonb
    )
  ).display_name,
  'Provisioned Member',
  'provisioning a Wolf Forge member updates the profile identity'
);

select is(
  (
    select preset_key
    from public.app_get_profile_permission_summary(
      '30000000-0000-0000-0000-000000000007'
    )
  ),
  'manager',
  'a provisioned Wolf Forge member receives the requested internal preset'
);

select ok(
  (
    select allowed
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000007'
    )
    where permission_key = 'projects.view'
  )
  and not (
    select allowed
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000007'
    )
    where permission_key = 'clients.view'
  ),
  'provisioning overrides are applied with the preset'
);

select throws_ok(
  $$ select public.app_provision_internal_member_profile(
       '30000000-0000-0000-0000-000000000008',
       'client'
     ) $$,
  '42501',
  null,
  'a Wolf Forge member cannot be provisioned onto a client preset'
);

select is(
  (
    public.app_provision_client_account_profile(
      '30000000-0000-0000-0000-000000000008',
      '31000000-0000-0000-0000-000000000003',
      'Provisioned Client',
      '[{"permission_key": "subscriptions.view", "allowed": false}]'::jsonb
    )
  ).company_id,
  '31000000-0000-0000-0000-000000000003'::uuid,
  'provisioning a client links the real company'
);

select is(
  (
    select preset_key
    from public.app_get_profile_permission_summary(
      '30000000-0000-0000-0000-000000000008'
    )
  ),
  'client',
  'a provisioned client receives the client preset'
);

select is(
  (
    select count(*)
    from public.app_get_profile_effective_permissions(
      '30000000-0000-0000-0000-000000000008'
    )
    where allowed
      and permission_key in (
        'clients.view',
        'client_private.read',
        'users.create',
        'settings.view',
        'tickets.internal_notes'
      )
  ),
  0::bigint,
  'client provisioning grants no internal capability'
);

-- Retrying the same provisioning request must not duplicate anything.
select is(
  (
    public.app_provision_internal_member_profile(
      '30000000-0000-0000-0000-000000000007',
      'manager',
      'Provisioned Member',
      '[{"permission_key": "clients.view", "allowed": false}]'::jsonb
    )
  ).id,
  '30000000-0000-0000-0000-000000000007'::uuid,
  'repeating a member provisioning request is retry-safe'
);

select is(
  (
    public.app_provision_client_account_profile(
      '30000000-0000-0000-0000-000000000008',
      '31000000-0000-0000-0000-000000000003',
      'Provisioned Client',
      '[{"permission_key": "subscriptions.view", "allowed": false}]'::jsonb
    )
  ).id,
  '30000000-0000-0000-0000-000000000008'::uuid,
  'repeating a client provisioning request is retry-safe'
);

-- Company creation stays a separate path with no account side effects.
select is(
  (
    public.app_create_company(
      '32000000-0000-0000-0000-000000000001',
      'Independent Company'
    )
  ).name,
  'Independent Company',
  'company creation remains an independent backend path'
);

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (
    select count(*)
    from public.profiles as profile_row
    join public.companies as company_row
      on company_row.id = profile_row.company_id
    where company_row.name = 'Independent Company'
  ),
  0::bigint,
  'company creation provisions no account'
);

select is(
  (
    select count(*)
    from public.activity_events
    where entity_id = '30000000-0000-0000-0000-000000000007'
      and action = 'account.member_created'
  ),
  1::bigint,
  'member provisioning is audited exactly once across retries'
);

select is(
  (
    select count(*)
    from public.activity_events
    where entity_id = '30000000-0000-0000-0000-000000000008'
      and action = 'account.client_created'
  ),
  1::bigint,
  'client provisioning is audited exactly once across retries'
);

-- =============================================================================
-- AUDIT
-- =============================================================================

select is(
  (
    select count(*)
    from public.activity_events
    where entity_id = '30000000-0000-0000-0000-000000000003'
      and action = 'permission.override_set'
  ),
  4::bigint,
  'each permission override change is audited'
);

select is(
  (
    select count(*)
    from public.activity_events
    where entity_id = '30000000-0000-0000-0000-000000000003'
      and action = 'permission.override_cleared'
  ),
  1::bigint,
  'clearing an override is audited'
);

-- Actor identity is derived from auth.uid(), never from a payload argument.
select is(
  (
    select count(distinct actor_profile_id)
    from public.activity_events
    where entity_id = '30000000-0000-0000-0000-000000000003'
      and action in ('permission.override_set', 'permission.override_cleared')
  ),
  1::bigint,
  'permission audit records exactly one session-derived actor'
);

select is(
  (
    select actor_profile_id
    from public.activity_events
    where entity_id = '30000000-0000-0000-0000-000000000007'
      and action = 'account.member_created'
  ),
  '30000000-0000-0000-0000-000000000002'::uuid,
  'provisioning audit records the authenticated actor, not a supplied identity'
);

-- =============================================================================
-- DIRECT ACCESS PROTECTION
-- =============================================================================

select ok(
  not has_table_privilege('authenticated', 'public.permission_presets', 'SELECT')
  and not has_table_privilege('authenticated', 'public.permission_modules', 'SELECT')
  and not has_table_privilege('authenticated', 'public.permission_preset_grants', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profile_permission_overrides', 'SELECT'),
  'permission configuration is not directly readable by authenticated callers'
);

select ok(
  not has_table_privilege('authenticated', 'public.profile_permission_overrides', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profile_permission_overrides', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.profile_permission_overrides', 'DELETE')
  and not has_table_privilege('authenticated', 'public.permission_presets', 'UPDATE')
  and not has_table_privilege('service_role', 'public.permission_presets', 'UPDATE')
  and not has_table_privilege('service_role', 'public.profile_permission_overrides', 'INSERT'),
  'permission configuration is not directly mutable outside the RPC boundary'
);

select ok(
  not has_function_privilege('anon', 'public.app_set_profile_permission_preset(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_set_profile_permission_override(uuid,text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_provision_internal_member_profile(uuid,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_provision_client_account_profile(uuid,uuid,text,jsonb)', 'EXECUTE'),
  'anonymous callers cannot reach account or permission administration'
);

select ok(
  not has_function_privilege('service_role', 'public.app_set_profile_permission_preset(uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.app_provision_internal_member_profile(uuid,text,text,jsonb)', 'EXECUTE'),
  'the trusted server key cannot execute permission or member administration'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '30000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
     values ('30000000-0000-0000-0000-000000000004', 'client_private.read', true) $$,
  '42501',
  null,
  'even an administrator cannot mutate overrides directly'
);

select throws_ok(
  $$ select * from public.permission_preset_grants $$,
  '42501',
  null,
  'preset grants cannot be enumerated directly'
);

reset role;
set local "request.jwt.claim.sub" = '';

-- =============================================================================
-- EXISTING MODULE REGRESSIONS
-- =============================================================================

select ok(
  private.profile_has_permission('30000000-0000-0000-0000-000000000004', 'forms.view')
  and not private.profile_has_permission('30000000-0000-0000-0000-000000000004', 'forms.publish')
  and private.profile_has_permission('30000000-0000-0000-0000-000000000002', 'forms.publish'),
  'Forms capability boundaries are unchanged'
);

select ok(
  private.profile_has_permission('30000000-0000-0000-0000-000000000004', 'tickets.internal_notes')
  and private.profile_has_permission('30000000-0000-0000-0000-000000000006', 'tickets.reply')
  and not private.profile_has_permission('30000000-0000-0000-0000-000000000006', 'tickets.internal_notes'),
  'Tickets capability boundaries are unchanged'
);

select ok(
  private.profile_has_permission('30000000-0000-0000-0000-000000000002', 'invoices.refund')
  and not private.profile_has_permission('30000000-0000-0000-0000-000000000003', 'invoices.manage')
  and private.profile_has_permission('30000000-0000-0000-0000-000000000006', 'invoices.view'),
  'Invoices capability boundaries are unchanged'
);

select ok(
  private.profile_has_permission('30000000-0000-0000-0000-000000000002', 'subscriptions.billing')
  and not private.profile_has_permission('30000000-0000-0000-0000-000000000004', 'subscriptions.view')
  and private.profile_has_permission('30000000-0000-0000-0000-000000000006', 'subscriptions.view'),
  'Subscriptions capability boundaries are unchanged'
);

select * from finish();

rollback;
