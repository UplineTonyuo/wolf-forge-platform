begin;

select plan(56);

-- -----------------------------------------------------------------------------
-- Structure and least-privilege function surface
-- -----------------------------------------------------------------------------

select is(
  (
    select count(*)
    from public.permissions
    where permission_key in (
      'client_private.read',
      'client_private.manage',
      'client_directory.read'
    )
  ),
  3::bigint,
  'client-private and narrow-directory capabilities are registered'
);

select is(
  (
    select count(*)
    from public.role_permissions as role_permission
    join public.roles as role_row on role_row.id = role_permission.role_id
    where role_row.name = 'admin'
      and role_permission.permission_key in (
        'client_private.read',
        'client_private.manage',
        'client_directory.read'
      )
      and role_permission.allowed
  ),
  3::bigint,
  'admin receives explicit client-private and directory capabilities'
);

select is(
  (
    select count(*)
    from public.role_permissions as role_permission
    join public.roles as role_row on role_row.id = role_permission.role_id
    where role_row.name in ('manager', 'staff')
      and role_permission.permission_key = 'client_directory.read'
      and role_permission.allowed
  ),
  2::bigint,
  'normal internal member roles receive only narrow directory access'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.app_search_client_directory(text,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the directory RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.app_search_client_directory(text,integer)',
    'EXECUTE'
  ),
  'authenticated callers can reach the capability-gated directory RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.require_permission(text)',
    'EXECUTE'
  ),
  'authenticated callers cannot execute the private permission guard'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.enforce_client_contact_permission()',
    'EXECUTE'
  ),
  'authenticated callers cannot invoke the contact trigger helper'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.require_client_private_company_access(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.require_client_private_admin()',
    'EXECUTE'
  ),
  'authenticated callers cannot directly invoke private client authorization guards'
);

select ok(
  (
    select bool_and(
      procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']::text[]
    )
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'private.is_client_private_admin()'::regprocedure,
      'private.can_access_client_private_company(uuid)'::regprocedure,
      'private.can_access_operational_order(uuid)'::regprocedure,
      'private.can_access_operational_task(uuid)'::regprocedure,
      'public.app_get_company_wallet(uuid)'::regprocedure,
      'public.app_search_client_directory(text,integer)'::regprocedure
    )
  ),
  'authorization SECURITY DEFINER functions use an empty search_path'
);

select ok(
  pg_get_function_result(
    'public.app_search_client_directory(text,integer)'::regprocedure
  ) not ilike '%email%'
  and pg_get_function_result(
    'public.app_search_client_directory(text,integer)'::regprocedure
  ) not ilike '%phone%'
  and pg_get_function_result(
    'public.app_search_client_directory(text,integer)'::regprocedure
  ) not ilike '%billing%'
  and pg_get_function_result(
    'public.app_search_client_directory(text,integer)'::regprocedure
  ) not ilike '%notes%',
  'directory RPC result type excludes private contact and billing fields'
);

select is(
  pg_get_function_arguments(
    'public.app_get_company_wallet(uuid)'::regprocedure
  ),
  'p_company_id uuid',
  'client-private wallet RPC accepts no caller-supplied actor identity'
);

-- -----------------------------------------------------------------------------
-- Representative actors and tenant data
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('26000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'boundary-owner@example.invalid', now(), now()),
  ('26000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'boundary-admin@example.invalid', now(), now()),
  ('26000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'boundary-member@example.invalid', now(), now()),
  ('16000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'boundary-client-a@example.invalid', now(), now()),
  ('16000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'boundary-client-a-two@example.invalid', now(), now()),
  ('16000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'boundary-client-b@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '26000000-0000-0000-0000-000000000001' then 'Boundary Owner'
      when '26000000-0000-0000-0000-000000000002' then 'Boundary Admin'
      when '26000000-0000-0000-0000-000000000003' then 'Boundary Member'
      when '16000000-0000-0000-0000-000000000001' then 'Client Alpha One'
      when '16000000-0000-0000-0000-000000000002' then 'Client Alpha Two'
      when '16000000-0000-0000-0000-000000000003' then 'Client Beta'
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '26000000-0000-0000-0000-000000000001'::uuid
  when 'admin' then '26000000-0000-0000-0000-000000000002'::uuid
  when 'staff' then '26000000-0000-0000-0000-000000000003'::uuid
end
and role_row.name in ('owner', 'admin', 'staff');

insert into public.companies (id, name, status)
values
  ('36000000-0000-0000-0000-000000000001', 'Boundary Company Alpha', 'client'),
  ('36000000-0000-0000-0000-000000000002', 'Boundary Company Beta', 'client'),
  ('36000000-0000-0000-0000-000000000003', 'Boundary Company Without Login', 'contact');

update public.profiles
set company_id = '36000000-0000-0000-0000-000000000001'
where id in (
  '16000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0000-000000000002'
);

update public.profiles
set company_id = '36000000-0000-0000-0000-000000000002'
where id = '16000000-0000-0000-0000-000000000003';

insert into public.client_contacts (
  id,
  company_id,
  profile_id,
  name,
  email,
  phone,
  is_primary
)
values
  (
    '46000000-0000-0000-0000-000000000001',
    '36000000-0000-0000-0000-000000000001',
    '16000000-0000-0000-0000-000000000001',
    'Alpha Private Contact',
    'alpha-private@example.invalid',
    '+1-555-0101',
    true
  ),
  (
    '46000000-0000-0000-0000-000000000002',
    '36000000-0000-0000-0000-000000000002',
    '16000000-0000-0000-0000-000000000003',
    'Beta Private Contact',
    'beta-private@example.invalid',
    '+1-555-0102',
    true
  );

-- Give the first company a known balance so the two unauthorized debit probes
-- below straddle the threshold that used to leak through the RPC.
update public.company_wallets
set balance_cents = 500
where company_id = '36000000-0000-0000-0000-000000000001';

insert into public.orders (
  id,
  company_id,
  service_id,
  assigned_to_profile_id,
  title
)
values
  (
    '56000000-0000-0000-0000-000000000001',
    '36000000-0000-0000-0000-000000000001',
    (select id from public.services order by id limit 1),
    '26000000-0000-0000-0000-000000000003',
    'Assigned Alpha Private Project'
  ),
  (
    '56000000-0000-0000-0000-000000000002',
    '36000000-0000-0000-0000-000000000002',
    (select id from public.services order by id limit 1),
    null,
    'Unassigned Beta Private Project'
  );

select is(
  (select count(*) from public.companies where id = '36000000-0000-0000-0000-000000000003'),
  1::bigint,
  'a company can exist without an auth user'
);

select is(
  (select count(*) from public.profiles where company_id = '36000000-0000-0000-0000-000000000001'),
  2::bigint,
  'multiple client users can belong to the same company'
);

-- -----------------------------------------------------------------------------
-- Owner and authorized admin
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '26000000-0000-0000-0000-000000000001';

select ok(
  public.app_has_permission('client_private.read'),
  'owner receives registered client-private read capability'
);

select is(
  (public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')).company_id,
  '36000000-0000-0000-0000-000000000001'::uuid,
  'owner can read client-private company wallet data'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '26000000-0000-0000-0000-000000000002';

select ok(
  public.app_has_permission('client_private.read'),
  'authorized admin has explicit client-private read capability'
);

select is(
  (select count(*) from public.client_contacts where id in (
    '46000000-0000-0000-0000-000000000001',
    '46000000-0000-0000-0000-000000000002'
  )),
  2::bigint,
  'authorized admin can read client-private contacts'
);

select is(
  (public.app_get_company_wallet('36000000-0000-0000-0000-000000000002')).company_id,
  '36000000-0000-0000-0000-000000000002'::uuid,
  'authorized admin can read client-private wallet data'
);

select ok(
  (public.app_archive_contact('46000000-0000-0000-0000-000000000002')).archived_at is not null,
  'an authorized admin can archive a private contact'
);

select is(
  (public.app_archive_contact('46000000-0000-0000-0000-000000000002')).id,
  '46000000-0000-0000-0000-000000000002'::uuid,
  'an authorized admin receives the same contact on an idempotent archive replay'
);

select is(
  (
    select count(*)
    from public.activity_events
    where entity_type = 'client_contact'
      and entity_id = '46000000-0000-0000-0000-000000000002'
      and action = 'contact.archived'
  ),
  1::bigint,
  'an authorized contact archive replay writes no duplicate activity event'
);

reset role;

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values (
  '26000000-0000-0000-0000-000000000002',
  'client_private.read',
  false
);

set local role authenticated;
set local "request.jwt.claim.sub" = '26000000-0000-0000-0000-000000000002';

select ok(
  not public.app_has_permission('client_private.read'),
  'withholding the capability removes admin client-private authorization'
);

select is(
  (select count(*) from public.client_contacts),
  0::bigint,
  'admin without client-private capability cannot read private contacts'
);

select throws_ok(
  $$select public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')$$,
  '42501',
  'client-private company access is denied',
  'admin without client-private capability cannot use the wallet RPC'
);

reset role;

-- -----------------------------------------------------------------------------
-- Normal Wolf Forge member
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '26000000-0000-0000-0000-000000000003';

select ok(private.is_internal_user(), 'normal member remains an internal user');
select ok(public.app_has_permission('client_directory.read'), 'normal member has narrow directory capability');
select ok(not public.app_has_permission('client_private.read'), 'normal member has no automatic client-private read');
select ok(not public.app_has_permission('client_private.manage'), 'normal member has no automatic client-private management');

select is(
  (select count(*) from public.app_search_client_directory('alpha', 20)
   where company_id = '36000000-0000-0000-0000-000000000001'),
  2::bigint,
  'normal member can search only narrow Alpha identity rows'
);

select is(
  (select count(*) from public.client_contacts),
  0::bigint,
  'normal member cannot read private contact rows directly'
);

select is(
  (select count(*) from public.orders where id = '56000000-0000-0000-0000-000000000001'),
  1::bigint,
  'normal member can read an assigned project'
);

select is(
  (select count(*) from public.orders where id = '56000000-0000-0000-0000-000000000002'),
  0::bigint,
  'normal member cannot read an unassigned client-private project'
);

select throws_ok(
  $$select public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')$$,
  '42501',
  'client-private company access is denied',
  'normal member cannot read a company wallet'
);

select throws_ok(
  $$
    select public.app_create_contact(
      '86000000-0000-0000-0000-000000000001',
      '36000000-0000-0000-0000-000000000001',
      'Member Forged Contact'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'normal member cannot use a SECURITY DEFINER contact RPC to escalate'
);

select throws_ok(
  $$select public.app_archive_contact('46000000-0000-0000-0000-000000000002')$$,
  '42501',
  'permission denied: client_private.manage',
  'a member without client-private access cannot read an already archived contact'
);

select throws_ok(
  $$
    select public.app_adjust_company_balance(
      '86000000-0000-0000-0000-000000000002',
      '36000000-0000-0000-0000-000000000001',
      100,
      'forged member credit'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'normal member cannot use the wallet SECURITY DEFINER RPC to escalate'
);

select throws_ok(
  $$
    select public.app_adjust_company_balance(
      '86000000-0000-0000-0000-000000000003',
      '36000000-0000-0000-0000-000000000001',
      -100,
      'forged affordable debit'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'an unauthorized debit below the wallet balance stops at authorization'
);

select throws_ok(
  $$
    select public.app_adjust_company_balance(
      '86000000-0000-0000-0000-000000000004',
      '36000000-0000-0000-0000-000000000001',
      -1000,
      'forged excessive debit'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'an unauthorized debit above the wallet balance returns the same authorization result'
);

select throws_ok(
  $$
    select public.app_adjust_company_balance(
      '86000000-0000-0000-0000-000000000005',
      '36000000-0000-0000-0000-000000000099',
      -100,
      'forged missing-company debit'
    )
  $$,
  '42501',
  'permission denied: client_private.manage',
  'an unauthorized missing-company probe returns the same authorization result'
);

select throws_ok(
  $$select * from public.app_list_recent_company_wallet_transactions(10)$$,
  '42501',
  'permission denied: client_private.read',
  'normal member cannot use the wallet notification RPC to read private ledger data'
);

select throws_ok(
  $$
    select public.app_assign_client_profile_to_company(
      '16000000-0000-0000-0000-000000000003',
      '36000000-0000-0000-0000-000000000001',
      'Forged Reassignment'
    )
  $$,
  '42501',
  'authorized client administration is required',
  'normal member cannot use the profile membership RPC to reassign a client'
);

-- -----------------------------------------------------------------------------
-- Client A, second Company A user, and Client B
-- -----------------------------------------------------------------------------

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '16000000-0000-0000-0000-000000000001';

select is(
  (public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')).company_id,
  '36000000-0000-0000-0000-000000000001'::uuid,
  'Client A can read own-company private wallet data'
);

select throws_ok(
  $$select public.app_get_company_wallet('36000000-0000-0000-0000-000000000002')$$,
  '42501',
  'client-private company access is denied',
  'Client A cannot spoof Company B by changing the company UUID'
);

select is((select count(*) from public.app_get_my_client_project('56000000-0000-0000-0000-000000000001')), 1::bigint, 'Client A can read Company A project through the safe projection');
select is((select count(*) from public.app_get_my_client_project('56000000-0000-0000-0000-000000000002')), 0::bigint, 'Client A cannot read Company B project through the safe projection');
select is((select count(*) from public.client_contacts), 0::bigint, 'Client A is not implicitly exposed private contact rows');

select throws_ok(
  $$select * from public.app_search_client_directory('alpha', 20)$$,
  '42501',
  'verified internal authentication is required',
  'Client A cannot invoke the internal directory RPC'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '16000000-0000-0000-0000-000000000002';

select is(
  (public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')).company_id,
  '36000000-0000-0000-0000-000000000001'::uuid,
  'a second Client A user can access the shared company scope'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '16000000-0000-0000-0000-000000000003';

select is(
  (public.app_get_company_wallet('36000000-0000-0000-0000-000000000002')).company_id,
  '36000000-0000-0000-0000-000000000002'::uuid,
  'Client B can read own-company private wallet data'
);

select throws_ok(
  $$select public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')$$,
  '42501',
  'client-private company access is denied',
  'Client B cannot spoof Company A by changing the company UUID'
);

select is((select count(*) from public.app_get_my_client_project('56000000-0000-0000-0000-000000000002')), 1::bigint, 'Client B can read Company B project through the safe projection');
select is((select count(*) from public.app_get_my_client_project('56000000-0000-0000-0000-000000000001')), 0::bigint, 'Client B cannot read Company A project through the safe projection');

-- -----------------------------------------------------------------------------
-- Anonymous and catalog regression
-- -----------------------------------------------------------------------------

reset role;
set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select throws_ok(
  $$select * from public.client_contacts limit 1$$,
  '42501',
  'permission denied for table client_contacts',
  'anonymous callers cannot read client-private contacts'
);

select throws_ok(
  $$select public.app_get_company_wallet('36000000-0000-0000-0000-000000000001')$$,
  '42501',
  'permission denied for function app_get_company_wallet',
  'anonymous callers cannot execute the client-private wallet RPC'
);

reset role;

select is((select count(*) from public.services), 59::bigint, 'Services catalog still contains exactly 59 services');
select is((select count(*) from public.services where nullif(btrim(description), '') is not null), 59::bigint, 'all 59 services retain descriptions');

select * from finish();

rollback;
