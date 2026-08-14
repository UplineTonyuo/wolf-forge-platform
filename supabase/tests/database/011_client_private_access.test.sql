begin;

select plan(24);

-- ============================================================
-- TEST USERS
--
-- The auth.users trigger automatically creates each profile
-- with the database-controlled client role. Internal test
-- accounts are promoted below before authenticated testing.
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
    '24000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'client-private-owner@example.invalid',
    now(),
    now()
  ),
  (
    '24000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'client-private-admin@example.invalid',
    now(),
    now()
  ),
  (
    '24000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'client-private-manager@example.invalid',
    now(),
    now()
  ),
  (
    '24000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'client-private-staff@example.invalid',
    now(),
    now()
  ),
  (
    '14000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'client-private-a@example.invalid',
    now(),
    now()
  ),
  (
    '14000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'client-private-b@example.invalid',
    now(),
    now()
  );


-- ============================================================
-- INTERNAL ROLE ASSIGNMENTS
-- ============================================================

update public.profiles as profile
set role_id = role.id
from public.roles as role
where profile.id = case role.name

  when 'owner'
    then '24000000-0000-0000-0000-000000000001'::uuid

  when 'admin'
    then '24000000-0000-0000-0000-000000000002'::uuid

  when 'manager'
    then '24000000-0000-0000-0000-000000000003'::uuid

  when 'staff'
    then '24000000-0000-0000-0000-000000000004'::uuid

end

and role.name in (
  'owner',
  'admin',
  'manager',
  'staff'
);


-- ============================================================
-- CLIENT COMPANIES
-- ============================================================

insert into public.companies (
  id,
  name
)
values
  (
    '34000000-0000-0000-0000-000000000001',
    'Private Client Alpha'
  ),
  (
    '34000000-0000-0000-0000-000000000002',
    'Private Client Beta'
  );


-- Client A belongs only to Alpha.

update public.profiles
set company_id =
  '34000000-0000-0000-0000-000000000001'
where id =
  '14000000-0000-0000-0000-000000000001';


-- Client B belongs only to Beta.

update public.profiles
set company_id =
  '34000000-0000-0000-0000-000000000002'
where id =
  '14000000-0000-0000-0000-000000000002';


-- ============================================================
-- FUNCTION PRIVILEGE BOUNDARY
-- ============================================================

select ok(
  not has_function_privilege(
    'anon',
    'private.is_client_private_admin()',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the client-private admin predicate'
);

select ok(
  not has_function_privilege(
    'service_role',
    'private.is_client_private_admin()',
    'EXECUTE'
  ),
  'service_role does not inherit authenticated client-private access'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.is_client_private_admin()',
    'EXECUTE'
  )
  and
  has_function_privilege(
    'authenticated',
    'private.can_access_client_private_company(uuid)',
    'EXECUTE'
  ),
  'authenticated users receive only the two client-private predicate helpers'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.current_user_role_name()',
    'EXECUTE'
  ),
  'authenticated users cannot directly execute the private role resolver'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.require_client_private_admin()',
    'EXECUTE'
  ),
  'authenticated users cannot directly execute the privileged admin guard'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.require_client_private_company_access(uuid)',
    'EXECUTE'
  ),
  'authenticated users cannot directly execute the privileged company guard'
);


-- ============================================================
-- OWNER
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '24000000-0000-0000-0000-000000000001';

select ok(
  private.is_client_private_admin(),
  'owner is authorized for client-private administration'
);

select ok(
  private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000001'
  ),
  'owner can access Client Alpha private data'
);

select ok(
  private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000002'
  ),
  'owner can access Client Beta private data'
);

reset role;


-- ============================================================
-- ADMIN
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '24000000-0000-0000-0000-000000000002';

select ok(
  private.is_client_private_admin(),
  'admin is authorized for client-private administration'
);

select ok(
  private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000001'
  ),
  'admin can access Client Alpha private data'
);

select ok(
  private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000002'
  ),
  'admin can access Client Beta private data'
);

reset role;


-- ============================================================
-- MANAGER
--
-- Manager stays an internal operational role but receives
-- NO client-private access.
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '24000000-0000-0000-0000-000000000003';

select ok(
  not private.is_client_private_admin(),
  'manager is not a client-private administrator'
);

select ok(
  not private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000001'
  ),
  'manager cannot access Client Alpha private data'
);

select ok(
  not private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000002'
  ),
  'manager cannot access Client Beta private data'
);

reset role;


-- ============================================================
-- STAFF
--
-- Staff also retains normal operational permissions while
-- remaining outside the client-private boundary.
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '24000000-0000-0000-0000-000000000004';

select ok(
  not private.is_client_private_admin(),
  'staff is not a client-private administrator'
);

select ok(
  not private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000001'
  ),
  'staff cannot access Client Alpha private data'
);

select ok(
  not private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000002'
  ),
  'staff cannot access Client Beta private data'
);

reset role;


-- ============================================================
-- CLIENT A
--
-- Client A may access only its own company.
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '14000000-0000-0000-0000-000000000001';

select ok(
  not private.is_client_private_admin(),
  'Client A is not a client-private administrator'
);

select ok(
  private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000001'
  ),
  'Client A can access its own company private data'
);

select ok(
  not private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000002'
  ),
  'Client A cannot access another company private data'
);

reset role;


-- ============================================================
-- CLIENT B
--
-- Symmetric test prevents company access from accidentally
-- becoming hardcoded to one fixture.
-- ============================================================

set local role authenticated;

set local "request.jwt.claim.role" =
  'authenticated';

set local "request.jwt.claim.sub" =
  '14000000-0000-0000-0000-000000000002';

select ok(
  not private.is_client_private_admin(),
  'Client B is not a client-private administrator'
);

select ok(
  private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000002'
  ),
  'Client B can access its own company private data'
);

select ok(
  not private.can_access_client_private_company(
    '34000000-0000-0000-0000-000000000001'
  ),
  'Client B cannot access another company private data'
);

reset role;


select * from finish();

rollback;