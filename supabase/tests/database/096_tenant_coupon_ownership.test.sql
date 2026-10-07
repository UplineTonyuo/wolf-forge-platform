begin;

select plan(28);

-- WL-1C.7: every coupon is owned by exactly one Tenant; its discount Services,
-- redemptions and Subscription plan item uses stay inside that Tenant.
-- Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...09b1.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select has_column('public', 'coupons', 'tenant_id', 'coupons.tenant_id exists');
select col_not_null('public', 'coupons', 'tenant_id', 'coupons.tenant_id is NOT NULL');
select col_not_null('public', 'coupon_redemptions', 'tenant_id', 'coupon_redemptions.tenant_id is NOT NULL');

select is(
  (select array_agg(table_name::text order by table_name)
    from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
      and table_name in ('coupon_discount_rules', 'coupon_discount_services')),
  null::text[],
  'discount rules and their Services have no tenant_id and inherit through the coupon'
);

select is(
  (select jsonb_object_agg(conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conname in (
        'coupons_tenant_id_fkey', 'coupons_tenant_id_id_key',
        'coupon_redemptions_tenant_id_fkey', 'coupon_redemptions_coupon_id_fkey',
        'coupon_redemptions_company_id_fkey', 'coupon_redemptions_customer_profile_id_fkey'
      )),
  jsonb_build_object(
    'coupons_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'coupons_tenant_id_id_key', 'UNIQUE (tenant_id, id)',
    'coupon_redemptions_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'coupon_redemptions_coupon_id_fkey', 'FOREIGN KEY (tenant_id, coupon_id) REFERENCES coupons(tenant_id, id) ON DELETE RESTRICT',
    'coupon_redemptions_company_id_fkey', 'FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE SET NULL (company_id)',
    'coupon_redemptions_customer_profile_id_fkey', 'FOREIGN KEY (tenant_id, customer_profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE SET NULL (customer_profile_id)'
  ),
  'coupons are Tenant-owned and redemption coupon, Client and person references are Tenant-relative'
);

select is(
  (select array_agg(distinct column_default::text)
    from information_schema.columns
    where table_schema = 'public' and table_name in ('coupons', 'coupon_redemptions')
      and column_name = 'tenant_id'),
  array['private.identity_tenant_id()'],
  'new coupons and redemptions default to the caller''s resolved Tenant'
);

select is(
  (select count(*) from public.coupons where tenant_id <> private.wolf_forge_tenant_id())
    + (select count(*) from public.coupon_redemptions where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing coupon and redemption was backfilled to the Wolf Forge Tenant'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 961 = owner U (internal in WF and B), 963 = WF client person of Client 961.
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000961', 'authenticated', 'authenticated', 'coupon-owner-b@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000963', 'authenticated', 'authenticated', 'coupon-wf-client@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009b1', 'coupon-tenant-b', 'Coupon Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000961', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Coupon Client', 'client'),
  ('30000000-0000-0000-0000-000000000962', 'f0f0f0f0-0000-4000-8000-0000000009b1', 'B Coupon Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000961', 'owner', null),
  ('20000000-0000-0000-0000-000000000963', 'client', '30000000-0000-0000-0000-000000000961')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-0000000009b1', '20000000-0000-0000-0000-000000000961', 'internal', role.id
from public.roles as role where role.name = 'owner';

insert into public.services (id, tenant_id, name, subscription_eligible)
values
  ('59b00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Coupon Service', true),
  ('59b00000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009b1', 'B Coupon Service', true);

create temporary table coupon_payload (tenant text, payload jsonb) on commit drop;
grant select on coupon_payload to authenticated;
insert into coupon_payload
select tenant, jsonb_build_object(
  'code', code, 'description', null, 'discount_type', 'fixed', 'recurring_duration', 'forever',
  'single_use_per_customer', false, 'new_customers_only', false, 'expires_at', null,
  'minimum_cart_amount', null, 'is_active', true,
  'rules', jsonb_build_array(jsonb_build_object(
    'discount_value', 10, 'applies_to_all', false, 'service_ids', jsonb_build_array(service_id))))
from (values
  ('wf', 'WL1C7WF', '59b00000-0000-0000-0000-000000000001'),
  ('b', 'WL1C7B', '59b00000-0000-0000-0000-000000000002'),
  ('b-wf-service', 'WL1C7BX', '59b00000-0000-0000-0000-000000000001')
) as fixture(tenant, code, service_id);

-- -----------------------------------------------------------------------------
-- Normal coupon creation takes the caller's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000961';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_coupon(gen_random_uuid(),
    (select payload from coupon_payload where tenant = 'wf'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in coupon creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);
select is(
  (select tenant_id from public.app_create_coupon(gen_random_uuid(),
    (select payload from coupon_payload where tenant = 'b'))),
  'f0f0f0f0-0000-4000-8000-0000000009b1'::uuid,
  'a signed-in coupon creation with the Tenant B selector lands in Tenant B'
);

select throws_ok(
  $$select public.app_create_coupon(gen_random_uuid(),
    (select payload from coupon_payload where tenant = 'b-wf-service'))$$,
  '23514',
  'coupon discount service must be a service of the coupon''s tenant',
  'a Tenant B coupon created through app_create_coupon cannot discount a Wolf Forge Service'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_coupon(gen_random_uuid(),
    (select payload from coupon_payload where tenant = 'b'))$$,
  '42501',
  null,
  'app_create_coupon with an invalid selector creates nothing'
);

select set_config('request.headers', '', true);
reset role;
-- Trusted writes below run without a signed-in user.
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.coupons where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009b1'),
  1::bigint,
  'only the valid Tenant B coupon was created; failed attempts left nothing behind'
);

create temporary table fixture_coupon on commit drop as
select
  (select id from public.coupons where code = 'WL1C7WF') as wf_id,
  (select id from public.coupons where code = 'WL1C7B') as b_id,
  (select rule.id from public.coupon_discount_rules as rule
    join public.coupons as coupon on coupon.id = rule.coupon_id where coupon.code = 'WL1C7WF') as wf_rule,
  (select rule.id from public.coupon_discount_rules as rule
    join public.coupons as coupon on coupon.id = rule.coupon_id where coupon.code = 'WL1C7B') as b_rule;

-- -----------------------------------------------------------------------------
-- Discount rule Services belong to the coupon's Tenant, even for trusted writes
-- -----------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.coupon_discount_services (coupon_discount_rule_id, service_id)
    values (%L, '59b00000-0000-0000-0000-000000000001')$$, (select b_rule from fixture_coupon)),
  '23514',
  'coupon discount service must be a service of the coupon''s tenant',
  'a Tenant B coupon rule cannot list a Wolf Forge Service'
);

select throws_ok(
  format($$insert into public.coupon_discount_services (coupon_discount_rule_id, service_id)
    values (%L, '59b00000-0000-0000-0000-000000000002')$$, (select wf_rule from fixture_coupon)),
  '23514',
  'coupon discount service must be a service of the coupon''s tenant',
  'a Wolf Forge coupon rule cannot list a Tenant B Service'
);

select throws_ok(
  format($$update public.coupon_discount_services set service_id = '59b00000-0000-0000-0000-000000000001'
    where coupon_discount_rule_id = %L$$, (select b_rule from fixture_coupon)),
  '23514',
  'coupon discount service must be a service of the coupon''s tenant',
  'a Tenant B rule Service cannot later be re-pointed at a Wolf Forge Service'
);

select throws_ok(
  format($$update public.coupon_discount_services set coupon_discount_rule_id = %L
    where coupon_discount_rule_id = %L$$, (select wf_rule from fixture_coupon), (select b_rule from fixture_coupon)),
  '23514',
  'coupon discount service must be a service of the coupon''s tenant',
  'a Tenant B rule Service cannot be moved under a Wolf Forge coupon rule'
);

-- -----------------------------------------------------------------------------
-- Redemptions stay inside the coupon's Tenant, even for trusted writes
-- -----------------------------------------------------------------------------

create temporary table redemption_attempt (label text, tenant_id uuid, coupon_id uuid,
  company_id uuid, customer_profile_id uuid) on commit drop;
insert into redemption_attempt values
  ('b-wf-coupon', 'f0f0f0f0-0000-4000-8000-0000000009b1', (select wf_id from fixture_coupon),
    '30000000-0000-0000-0000-000000000962', null),
  ('wf-b-coupon', 'f0f0f0f0-0000-4000-8000-000000000001', (select b_id from fixture_coupon),
    '30000000-0000-0000-0000-000000000961', null),
  ('b-wf-client', 'f0f0f0f0-0000-4000-8000-0000000009b1', (select b_id from fixture_coupon),
    '30000000-0000-0000-0000-000000000961', null),
  ('wf-b-client', 'f0f0f0f0-0000-4000-8000-000000000001', (select wf_id from fixture_coupon),
    '30000000-0000-0000-0000-000000000962', null),
  ('b-wf-person', 'f0f0f0f0-0000-4000-8000-0000000009b1', (select b_id from fixture_coupon),
    null, '20000000-0000-0000-0000-000000000963'),
  ('b-own-person', 'f0f0f0f0-0000-4000-8000-0000000009b1', (select b_id from fixture_coupon),
    null, '20000000-0000-0000-0000-000000000961'),
  ('b-own', 'f0f0f0f0-0000-4000-8000-0000000009b1', (select b_id from fixture_coupon),
    '30000000-0000-0000-0000-000000000962', null);

create function pg_temp.redeem(p_label text)
returns void
language sql
as $$
  insert into public.coupon_redemptions (tenant_id, coupon_id, company_id, customer_profile_id, currency,
    original_cart_subtotal, eligible_subtotal, discount_amount, resulting_cart_subtotal)
  select tenant_id, coupon_id, company_id, customer_profile_id, 'USD', 100, 100, 10, 90
  from redemption_attempt where label = p_label;
$$;

select throws_ok(
  $$select pg_temp.redeem('b-wf-coupon')$$,
  '23503',
  'insert or update on table "coupon_redemptions" violates foreign key constraint "coupon_redemptions_coupon_id_fkey"',
  'a Tenant B redemption cannot spend a Wolf Forge coupon'
);

select throws_ok(
  $$select pg_temp.redeem('wf-b-coupon')$$,
  '23503',
  'insert or update on table "coupon_redemptions" violates foreign key constraint "coupon_redemptions_coupon_id_fkey"',
  'a Wolf Forge redemption cannot spend a Tenant B coupon'
);

select throws_ok(
  $$select pg_temp.redeem('b-wf-client')$$,
  '23503',
  'insert or update on table "coupon_redemptions" violates foreign key constraint "coupon_redemptions_company_id_fkey"',
  'a Tenant B redemption cannot be booked against a Wolf Forge Client'
);

select throws_ok(
  $$select pg_temp.redeem('wf-b-client')$$,
  '23503',
  'insert or update on table "coupon_redemptions" violates foreign key constraint "coupon_redemptions_company_id_fkey"',
  'a Wolf Forge redemption cannot be booked against a Tenant B Client'
);

-- The reverse person case cannot be built: every profile is mirrored into
-- Wolf Forge.
select throws_ok(
  $$select pg_temp.redeem('b-wf-person')$$,
  '23503',
  'insert or update on table "coupon_redemptions" violates foreign key constraint "coupon_redemptions_customer_profile_id_fkey"',
  'a Tenant B redemption cannot be attributed to a Wolf Forge-only person'
);

select lives_ok(
  $$select pg_temp.redeem('b-own')$$,
  'a Tenant B redemption of a Tenant B coupon by a Tenant B Client is accepted'
);

select lives_ok(
  $$select pg_temp.redeem('b-own-person')$$,
  'a Tenant B redemption of a Tenant B coupon by a Tenant B member is accepted'
);

select is(
  (select tenant_id from public.coupon_redemptions where company_id = '30000000-0000-0000-0000-000000000962'),
  'f0f0f0f0-0000-4000-8000-0000000009b1'::uuid,
  'the accepted redemption is owned by Tenant B'
);

select throws_ok(
  format($$update public.coupons set tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001' where id = %L$$,
    (select b_id from fixture_coupon)),
  '23503',
  'update or delete on table "coupons" violates foreign key constraint "coupon_redemptions_coupon_id_fkey" on table "coupon_redemptions"',
  'a redeemed Tenant B coupon cannot be moved to another Tenant'
);

-- -----------------------------------------------------------------------------
-- Subscription plan items carry coupons of the Subscription's Tenant only
-- -----------------------------------------------------------------------------

create temporary table subscription_payload (tenant text, payload jsonb) on commit drop;
grant select on subscription_payload to authenticated;
insert into subscription_payload
select tenant, jsonb_build_object(
  'company_id', company_id, 'service_id', service_id, 'plan_source', 'admin_invoice',
  'billing_anchor', current_date, 'interval_unit', 'month', 'interval_count', 1,
  'currency', 'USD', 'recurring_action', 'none',
  'items', jsonb_build_array(jsonb_build_object(
    'service_id', service_id, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100)))
from (values
  ('wf', '30000000-0000-0000-0000-000000000961', '59b00000-0000-0000-0000-000000000001'),
  ('b', '30000000-0000-0000-0000-000000000962', '59b00000-0000-0000-0000-000000000002')
) as fixture(tenant, company_id, service_id);

create temporary table fixture_plan (wf_plan uuid, b_plan uuid) on commit drop;
grant insert, update, select on fixture_plan to authenticated;
insert into fixture_plan values (null, null);

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000961';
update fixture_plan set wf_plan = (select current_plan_version_id from public.app_create_subscription(
  gen_random_uuid(), (select payload from subscription_payload where tenant = 'wf')));
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009b1"}', true);
update fixture_plan set b_plan = (select current_plan_version_id from public.app_create_subscription(
  gen_random_uuid(), (select payload from subscription_payload where tenant = 'b')));
select set_config('request.headers', '', true);
reset role;
set local "request.jwt.claim.sub" = '';

create function pg_temp.plan_item(p_plan uuid, p_coupon uuid)
returns void
language sql
as $$
  insert into public.subscription_plan_items (plan_version_id, position, service_name_snapshot,
    quantity, unit_amount_cents, coupon_id, coupon_recurring_duration)
  values (p_plan, 7, 'Coupon item', 1, 0, p_coupon, 'forever');
$$;

select throws_ok(
  format($$select pg_temp.plan_item(%L, %L)$$, (select b_plan from fixture_plan), (select wf_id from fixture_coupon)),
  '23514',
  'subscription plan item must reference a coupon of the subscription''s tenant',
  'a Tenant B plan item cannot carry a Wolf Forge coupon'
);

select throws_ok(
  format($$select pg_temp.plan_item(%L, %L)$$, (select wf_plan from fixture_plan), (select b_id from fixture_coupon)),
  '23514',
  'subscription plan item must reference a coupon of the subscription''s tenant',
  'a Wolf Forge plan item cannot carry a Tenant B coupon'
);

select lives_ok(
  format($$select pg_temp.plan_item(%L, %L)$$, (select b_plan from fixture_plan), (select b_id from fixture_coupon)),
  'a Tenant B plan item can carry a Tenant B coupon'
);

select * from finish();
rollback;
