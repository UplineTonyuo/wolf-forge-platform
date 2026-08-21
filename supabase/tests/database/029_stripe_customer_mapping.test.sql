begin;

select plan(26);

-- =============================================================================
-- FIXTURES
--
-- One admin (holds invoices.manage), one staff (does not), and two client
-- accounts at two unrelated companies. Every assertion runs as a real
-- authenticated session so the RPC guard, the table grants and RLS are all
-- exercised rather than simulated.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('80000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'stripe-admin@example.invalid', now(), now()),
  ('80000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'stripe-staff@example.invalid', now(), now()),
  ('80000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'stripe-client-a@example.invalid', now(), now()),
  ('80000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'stripe-client-b@example.invalid', now(), now());

insert into public.companies (id, name)
values
  ('81000000-0000-0000-0000-00000000000a', 'Northgate Dental'),
  ('81000000-0000-0000-0000-00000000000b', 'Southgate Legal');

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Stripe Admin', company_id = null
from public.roles as role_row
where role_row.name = 'admin'
  and profile_row.id = '80000000-0000-0000-0000-000000000001';

update public.profiles as profile_row
set role_id = role_row.id, display_name = 'Stripe Staff', company_id = null
from public.roles as role_row
where role_row.name = 'staff'
  and profile_row.id = '80000000-0000-0000-0000-000000000002';

update public.profiles
set company_id = '81000000-0000-0000-0000-00000000000a', display_name = 'Client A'
where id = '80000000-0000-0000-0000-000000000003';

update public.profiles
set company_id = '81000000-0000-0000-0000-00000000000b', display_name = 'Client B'
where id = '80000000-0000-0000-0000-000000000004';

-- =============================================================================
-- STRUCTURE
-- =============================================================================

select has_column('public', 'companies', 'stripe_customer_id',
  'companies carries the Stripe customer mapping');

select col_is_null('public', 'companies', 'stripe_customer_id',
  'the mapping is optional, so a company without billing is still valid');

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_stripe_customer_id_unique'
      and contype = 'u'
  ),
  1::bigint,
  'at most one company can hold a given Stripe customer'
);

-- Many companies may legitimately have no mapping at all.
select lives_ok(
  $$ insert into public.companies (id, name)
     values ('81000000-0000-0000-0000-00000000000c', 'Unmapped One'),
            ('81000000-0000-0000-0000-00000000000d', 'Unmapped Two') $$,
  'several companies may sit unmapped under the unique constraint'
);

select throws_ok(
  $$ update public.companies set stripe_customer_id = 'sk_live_not_a_customer'
     where id = '81000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'a value that is not a Stripe customer reference is refused'
);

select lives_ok(
  $$ update public.companies set stripe_customer_id = 'cus_MigrationDirect'
     where id = '81000000-0000-0000-0000-00000000000a' $$,
  'the migration role may seed a mapping directly'
);

select throws_ok(
  $$ update public.companies set stripe_customer_id = 'cus_MigrationDirect'
     where id = '81000000-0000-0000-0000-00000000000b' $$,
  '23505',
  null,
  'the same Stripe customer cannot be pointed at two companies'
);

-- Reset for the session assertions below.
update public.companies set stripe_customer_id = null
where id = '81000000-0000-0000-0000-00000000000a';

-- =============================================================================
-- TABLE PRIVILEGES
--
-- The mapping is only as safe as the write grants. authenticated holds SELECT
-- and nothing else on companies, which is what makes a direct UPDATE
-- impossible before RLS or the trigger are even consulted.
-- =============================================================================

select ok(
  has_table_privilege('authenticated', 'public.companies', 'SELECT')
    and not has_table_privilege('authenticated', 'public.companies', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.companies', 'INSERT')
    and not has_table_privilege('authenticated', 'public.companies', 'DELETE'),
  'authenticated may read companies but never write them directly'
);

-- =============================================================================
-- INTERNAL: PROVISIONING THROUGH THE RPC
-- =============================================================================

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '80000000-0000-0000-0000-000000000001';

select is(
  public.app_link_company_stripe_customer(
    '81000000-0000-0000-0000-00000000000a', 'cus_AdminLinked001'),
  'cus_AdminLinked001',
  'an admin links a company to its Stripe customer'
);

-- The whole point of the phase: calling again is inert.
select is(
  public.app_link_company_stripe_customer(
    '81000000-0000-0000-0000-00000000000a', 'cus_AdminLinked001'),
  'cus_AdminLinked001',
  'linking the same customer again returns the same mapping'
);

-- A second, different identifier must not repoint an established mapping.
select is(
  public.app_link_company_stripe_customer(
    '81000000-0000-0000-0000-00000000000a', 'cus_SomeOtherCustomer'),
  'cus_AdminLinked001',
  'an established mapping is never replaced, whatever the caller passes'
);

select throws_ok(
  $$ select public.app_link_company_stripe_customer(
       '81000000-0000-0000-0000-00000000000a', 'pk_live_wrong_key_kind') $$,
  '22023',
  null,
  'a malformed Stripe identifier is refused by the RPC'
);

select throws_ok(
  $$ select public.app_link_company_stripe_customer(
       '81000000-0000-0000-0000-00000000000a', '') $$,
  '22023',
  null,
  'an empty Stripe identifier is refused'
);

select throws_ok(
  $$ select public.app_link_company_stripe_customer(
       gen_random_uuid(), 'cus_NoSuchCompany') $$,
  '42501',
  null,
  'a company that does not exist cannot be mapped'
);

-- An internal session still cannot edit the column by hand.
select throws_ok(
  $$ update public.companies set stripe_customer_id = 'cus_HandEdited'
     where id = '81000000-0000-0000-0000-00000000000b' $$,
  '42501',
  null,
  'an admin session cannot write the mapping outside the RPC'
);

-- =============================================================================
-- INTERNAL: CAPABILITY BOUNDARY
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '80000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.app_link_company_stripe_customer(
       '81000000-0000-0000-0000-00000000000b', 'cus_StaffAttempt') $$,
  '42501',
  null,
  'staff without invoices.manage cannot provision a Stripe customer'
);

-- =============================================================================
-- CLIENT BOUNDARY
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '80000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.app_link_company_stripe_customer(
       '81000000-0000-0000-0000-00000000000a', 'cus_ClientAttempt') $$,
  '42501',
  null,
  'a client cannot map even their own company'
);

select throws_ok(
  $$ select public.app_link_company_stripe_customer(
       '81000000-0000-0000-0000-00000000000b', 'cus_ClientCrossAttempt') $$,
  '42501',
  null,
  'a client certainly cannot map another company'
);

select throws_ok(
  $$ update public.companies set stripe_customer_id = 'cus_ClientDirectWrite'
     where id = '81000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'a client cannot write the mapping directly'
);

-- Reads stay scoped by the existing company policy, unchanged by this phase.
select is(
  (select count(*) from public.companies),
  1::bigint,
  'a client still sees exactly one company: their own'
);

select is(
  (select id from public.companies),
  '81000000-0000-0000-0000-00000000000a'::uuid,
  'and it is their own company, not another'
);

select is(
  (
    select count(*)
    from public.companies
    where id = '81000000-0000-0000-0000-00000000000b'
  ),
  0::bigint,
  'another company''s row, and therefore its mapping, is invisible to a client'
);

-- =============================================================================
-- AUDIT TRAIL
-- =============================================================================

reset role;
set local "request.jwt.claim.sub" = '';

select is(
  (
    select count(*)
    from public.activity_events
    where entity_type = 'company'
      and action = 'company.stripe_customer_linked'
      and entity_id = '81000000-0000-0000-0000-00000000000a'
  ),
  1::bigint,
  'linking is recorded once in the audit trail, and repeat calls add nothing'
);

select is(
  (
    select actor_profile_id
    from public.activity_events
    where action = 'company.stripe_customer_linked'
      and entity_id = '81000000-0000-0000-0000-00000000000a'
  ),
  '80000000-0000-0000-0000-000000000001'::uuid,
  'the audit trail names the admin who provisioned it'
);

select is(
  (
    select stripe_customer_id
    from public.companies
    where id = '81000000-0000-0000-0000-00000000000a'
  ),
  'cus_AdminLinked001',
  'the stored mapping is the one the first successful call established'
);

select is(
  (
    select count(*)
    from public.companies
    where id = '81000000-0000-0000-0000-00000000000b'
      and stripe_customer_id is null
  ),
  1::bigint,
  'every refused attempt left the second company unmapped'
);

select * from finish();

rollback;
