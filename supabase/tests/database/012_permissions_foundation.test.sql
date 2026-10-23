begin;

select plan(18);


-- ============================================================
-- STRUCTURE
-- ============================================================

select ok(
  to_regclass('public.permissions') is not null,
  'permissions table exists'
);

select ok(
  to_regclass('public.role_permissions') is not null,
  'role_permissions table exists'
);

select ok(
  to_regclass('public.profile_permission_overrides') is not null,
  'profile_permission_overrides table exists'
);

select ok(
  to_regprocedure(
    'public.app_has_permission(text)'
  ) is not null,
  'safe permission predicate exists'
);

select ok(
  to_regprocedure(
    'public.app_current_user_permissions()'
  ) is not null,
  'current-user permission list RPC exists'
);


-- ============================================================
-- FUNCTION PRIVILEGES
-- ============================================================

select ok(
  not has_function_privilege(
    'anon',
    'public.app_has_permission(text)',
    'EXECUTE'
  ),
  'anonymous callers cannot query permissions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.app_has_permission(text)',
    'EXECUTE'
  ),
  'authenticated callers can query their own permissions'
);


-- ============================================================
-- TEST ACCOUNTS
--
-- Auth trigger creates each profile initially as client.
-- We promote internal fixtures below.
-- ============================================================

insert into auth.users (
  id,
  aud,
  role,
  email,
  created_at,
  updated_at
)
values
  (
    '25000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'permission-owner@example.invalid',
    now(),
    now()
  ),
  (
    '25000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'permission-admin@example.invalid',
    now(),
    now()
  ),
  (
    '25000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'permission-manager@example.invalid',
    now(),
    now()
  ),
  (
    '25000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'permission-staff@example.invalid',
    now(),
    now()
  ),
  (
    '25000000-0000-0000-0000-000000000005',
    'authenticated',
    'authenticated',
    'permission-client@example.invalid',
    now(),
    now()
  );


update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id =
  case role.name

    when 'owner'
      then '25000000-0000-0000-0000-000000000001'::uuid

    when 'admin'
      then '25000000-0000-0000-0000-000000000002'::uuid

    when 'manager'
      then '25000000-0000-0000-0000-000000000003'::uuid

    when 'staff'
      then '25000000-0000-0000-0000-000000000004'::uuid

    else null
  end

and role.name in (
  'owner',
  'admin',
  'manager',
  'staff'
);

-- D-275: a new profile has no Tenant membership; this client is provisioned
-- into Wolf Forge explicitly (no Client link).
insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select private.wolf_forge_tenant_id(), '25000000-0000-0000-0000-000000000005', 'client', role_row.id
from public.roles as role_row
where role_row.name = 'client';


-- ============================================================
-- OWNER
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000001';

select ok(
  public.app_has_permission(
    'services.archive'
  ),
  'owner receives every registered permission'
);

reset role;


-- ============================================================
-- ADMIN
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000002';

select ok(
  public.app_has_permission(
    'users.manage_permissions'
  ),
  'admin receives permission-management access'
);

reset role;


-- ============================================================
-- MANAGER DEFAULTS
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000003';

select ok(
  public.app_has_permission(
    'clients.view'
  ),
  'manager receives client-directory view access'
);

select ok(
  not public.app_has_permission(
    'users.manage_permissions'
  ),
  'manager does not receive permission-management access'
);

reset role;


-- ============================================================
-- STAFF DEFAULTS
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000004';

select ok(
  public.app_has_permission(
    'services.view'
  ),
  'staff receives service catalog view access'
);

select ok(
  not public.app_has_permission(
    'invoices.manage'
  ),
  'staff does not receive invoice management'
);

reset role;


-- ============================================================
-- CLIENT DEFAULTS
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000005';

select ok(
  public.app_has_permission(
    'projects.view'
  ),
  'client receives project feature access'
);

select ok(
  not public.app_has_permission(
    'clients.view'
  ),
  'client does not receive the internal client directory'
);

reset role;


-- ============================================================
-- MANAGER OVERRIDES
-- ============================================================

insert into public.profile_permission_overrides (
  profile_id,
  permission_key,
  allowed
)
values
  (
    '25000000-0000-0000-0000-000000000003',
    'coupons.view',
    true
  ),
  (
    '25000000-0000-0000-0000-000000000003',
    'clients.view',
    false
  );


set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000003';

select ok(
  public.app_has_permission(
    'coupons.view'
  ),
  'positive profile override can grant a role-missing permission'
);

select ok(
  not public.app_has_permission(
    'clients.view'
  ),
  'negative profile override wins over a role default'
);

reset role;


-- ============================================================
-- UNKNOWN PERMISSIONS FAIL CLOSED
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '25000000-0000-0000-0000-000000000001';

select ok(
  not public.app_has_permission(
    'dragon.launch'
  ),
  'unknown permission keys are denied even for owner'
);

reset role;


select * from finish();

rollback;