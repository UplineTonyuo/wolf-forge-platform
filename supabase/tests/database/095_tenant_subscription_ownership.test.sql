begin;

select plan(35);

-- WL-1C.6: every Subscription is owned by exactly one Tenant; its Client,
-- client person, Service, plan item Services and cycle Invoices stay inside
-- that Tenant. Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = ...09c1.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select has_column('public', 'subscriptions', 'tenant_id', 'subscriptions.tenant_id exists');
select col_not_null('public', 'subscriptions', 'tenant_id', 'subscriptions.tenant_id is NOT NULL');

select is(
  (select array_agg(table_name::text order by table_name)
    from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
      and table_name in ('subscription_plan_versions', 'subscription_plan_items', 'subscription_cycles',
        'subscription_events', 'subscription_dunning_attempts', 'subscription_payment_methods')),
  null::text[],
  'Subscription children have no tenant_id and inherit through the Subscription'
);

select is(
  (select jsonb_object_agg(conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname in (
        'subscriptions_tenant_id_fkey', 'subscriptions_tenant_id_id_key',
        'subscriptions_company_id_fkey', 'subscriptions_client_profile_id_fkey',
        'subscriptions_service_id_fkey'
      )),
  jsonb_build_object(
    'subscriptions_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'subscriptions_tenant_id_id_key', 'UNIQUE (tenant_id, id)',
    'subscriptions_company_id_fkey', 'FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE RESTRICT',
    'subscriptions_client_profile_id_fkey', 'FOREIGN KEY (tenant_id, client_profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE RESTRICT',
    'subscriptions_service_id_fkey', 'FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE RESTRICT'
  ),
  'Subscriptions are Tenant-owned and their Client, person and Service references are Tenant-relative'
);

select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'tenant_id'),
  'private.identity_tenant_id()',
  'new Subscriptions default to the caller''s resolved Tenant, not a fixed Wolf Forge default'
);

select is(
  (select count(*) from public.subscriptions where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing Subscription was backfilled to the Wolf Forge Tenant'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 951 = owner U (internal in WF and B), 953 = WF client person of Client 951.
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000951', 'authenticated', 'authenticated', 'sub-owner-b@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000953', 'authenticated', 'authenticated', 'sub-wf-client@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009c1', 'sub-tenant-b', 'Subscription Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000951', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Subscription Client', 'client'),
  ('30000000-0000-0000-0000-000000000952', 'f0f0f0f0-0000-4000-8000-0000000009c1', 'B Subscription Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000951', 'owner', null),
  ('20000000-0000-0000-0000-000000000953', 'client', '30000000-0000-0000-0000-000000000951')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-0000000009c1', '20000000-0000-0000-0000-000000000951', 'internal', role.id
from public.roles as role where role.name = 'owner';

insert into public.services (id, tenant_id, name, subscription_eligible)
values
  ('59c00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Subscription Service', true),
  ('59c00000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009c1', 'B Subscription Service', true);

insert into public.invoices (id, tenant_id, company_id, created_by_profile_id, updated_by_profile_id)
values
  ('59c20000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000951',
   '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951'),
  ('59c20000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009c1', '30000000-0000-0000-0000-000000000952',
   '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951');

-- -----------------------------------------------------------------------------
-- Normal Subscription creation takes the caller's Tenant
-- -----------------------------------------------------------------------------

create temporary table subscription_payload (tenant text, payload jsonb) on commit drop;
grant select on subscription_payload to authenticated;
insert into subscription_payload
select tenant, jsonb_build_object(
  'company_id', company_id, 'service_id', service_id, 'plan_source', 'admin_invoice',
  'billing_anchor', current_date, 'interval_unit', 'month', 'interval_count', 1,
  'currency', 'USD', 'recurring_action', 'none',
  'items', jsonb_build_array(jsonb_build_object(
    'service_id', item_service_id, 'name', 'Plan item', 'quantity', 1, 'unit_amount_cents', 100)))
from (values
  ('wf', '30000000-0000-0000-0000-000000000951', '59c00000-0000-0000-0000-000000000001', '59c00000-0000-0000-0000-000000000001'),
  ('b', '30000000-0000-0000-0000-000000000952', '59c00000-0000-0000-0000-000000000002', '59c00000-0000-0000-0000-000000000002'),
  ('b-wf-client', '30000000-0000-0000-0000-000000000951', '59c00000-0000-0000-0000-000000000002', '59c00000-0000-0000-0000-000000000002'),
  ('b-wf-item', '30000000-0000-0000-0000-000000000952', '59c00000-0000-0000-0000-000000000002', '59c00000-0000-0000-0000-000000000001')
) as fixture(tenant, company_id, service_id, item_service_id);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000951';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_subscription(gen_random_uuid(),
    (select payload from subscription_payload where tenant = 'wf'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in Subscription creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
select is(
  (select tenant_id from public.app_create_subscription(gen_random_uuid(),
    (select payload from subscription_payload where tenant = 'b'))),
  'f0f0f0f0-0000-4000-8000-0000000009c1'::uuid,
  'a signed-in Subscription creation with the Tenant B selector lands in Tenant B'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(),
    (select payload from subscription_payload where tenant = 'b-wf-client'))$$,
  '23503',
  'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_company_id_fkey"',
  'a Tenant B Subscription created through app_create_subscription cannot bill a Wolf Forge Client'
);

select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(),
    (select payload from subscription_payload where tenant = 'b-wf-item'))$$,
  '23514',
  'subscription plan item must reference a service of the subscription''s tenant',
  'a Tenant B Subscription plan cannot carry a Wolf Forge Service item'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_subscription(gen_random_uuid(),
    (select payload from subscription_payload where tenant = 'b'))$$,
  '42501',
  null,
  'app_create_subscription with an invalid selector creates nothing'
);

select set_config('request.headers', '', true);
reset role;
-- Trusted writes below run without a signed-in user.
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.subscriptions where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009c1'),
  1::bigint,
  'only the valid Tenant B Subscription was created; failed attempts left nothing behind'
);

create temporary table fixture_subscription on commit drop as
select
  max(id::text) filter (where tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001')::uuid as wf_id,
  max(id::text) filter (where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009c1')::uuid as b_id
from public.subscriptions
where company_id in ('30000000-0000-0000-0000-000000000951', '30000000-0000-0000-0000-000000000952');

create temporary table fixture_plan on commit drop as
select
  (select current_plan_version_id from public.subscriptions where id = (select wf_id from fixture_subscription)) as wf_plan,
  (select current_plan_version_id from public.subscriptions where id = (select b_id from fixture_subscription)) as b_plan;

-- -----------------------------------------------------------------------------
-- Cross-Tenant Subscription references are rejected even for trusted writes
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.subscriptions (tenant_id, company_id, service_id, plan_source, billing_anchor,
      created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000952',
      '59c00000-0000-0000-0000-000000000001', 'admin_invoice', current_date,
      '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951')$$,
  '23503',
  'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_company_id_fkey"',
  'a Wolf Forge Subscription cannot bill a Tenant B Client'
);

select throws_ok(
  $$insert into public.subscriptions (tenant_id, company_id, service_id, plan_source, billing_anchor,
      created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-0000000009c1', '30000000-0000-0000-0000-000000000951',
      '59c00000-0000-0000-0000-000000000002', 'admin_invoice', current_date,
      '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951')$$,
  '23503',
  'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_company_id_fkey"',
  'a Tenant B Subscription cannot bill a Wolf Forge Client'
);

select throws_ok(
  $$insert into public.subscriptions (tenant_id, company_id, service_id, plan_source, billing_anchor,
      created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000951',
      '59c00000-0000-0000-0000-000000000002', 'admin_invoice', current_date,
      '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951')$$,
  '23503',
  'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_service_id_fkey"',
  'a Wolf Forge Subscription cannot be for a Tenant B Service'
);

select throws_ok(
  $$insert into public.subscriptions (tenant_id, company_id, service_id, plan_source, billing_anchor,
      created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-0000000009c1', '30000000-0000-0000-0000-000000000952',
      '59c00000-0000-0000-0000-000000000001', 'admin_invoice', current_date,
      '20000000-0000-0000-0000-000000000951', '20000000-0000-0000-0000-000000000951')$$,
  '23503',
  'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_service_id_fkey"',
  'a Tenant B Subscription cannot be for a Wolf Forge Service'
);

select lives_ok(
  format($$update public.subscriptions set client_profile_id = '20000000-0000-0000-0000-000000000953'
    where id = %L$$, (select wf_id from fixture_subscription)),
  'a Wolf Forge Subscription can name a Wolf Forge client person'
);

-- The client-consistency trigger runs before the composite key, so a person of
-- another Tenant is stopped there; the key (asserted above) is the backstop.
select throws_ok(
  format($$update public.subscriptions set client_profile_id = '20000000-0000-0000-0000-000000000953'
    where id = %L$$, (select b_id from fixture_subscription)),
  '23514',
  'subscription client profile must be an active client in the subscription company',
  'a Tenant B Subscription cannot name a Wolf Forge client person'
);

-- With that trigger suspended (rolled back with the test), the composite key
-- alone still rejects the person: 953 has no Tenant B membership. The reverse
-- case cannot be built because every profile is mirrored into Wolf Forge.
-- Flush the deferred plan-version key so the table can be altered.
set constraints all immediate;
alter table public.subscriptions disable trigger subscriptions_require_client_consistency;
select throws_ok(
  format($$update public.subscriptions set client_profile_id = '20000000-0000-0000-0000-000000000953'
    where id = %L$$, (select b_id from fixture_subscription)),
  '23503',
  'insert or update on table "subscriptions" violates foreign key constraint "subscriptions_client_profile_id_fkey"',
  'the Tenant-relative key alone rejects a Wolf Forge-only person on a Tenant B Subscription'
);
alter table public.subscriptions enable trigger subscriptions_require_client_consistency;

select throws_ok(
  format($$update public.subscriptions set tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001'
    where id = %L$$, (select b_id from fixture_subscription)),
  '23503',
  null,
  'a Subscription cannot be moved to another Tenant while it bills a Tenant B Client and Service'
);

-- -----------------------------------------------------------------------------
-- Plan items carry Services of the Subscription's Tenant only
-- -----------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.subscription_plan_items (plan_version_id, position, service_id,
      service_name_snapshot, quantity, unit_amount_cents)
    values (%L, 5, '59c00000-0000-0000-0000-000000000001', 'x', 1, 0)$$, (select b_plan from fixture_plan)),
  '23514',
  'subscription plan item must reference a service of the subscription''s tenant',
  'a Tenant B plan item cannot carry a Wolf Forge Service'
);

select throws_ok(
  format($$insert into public.subscription_plan_items (plan_version_id, position, service_id,
      service_name_snapshot, quantity, unit_amount_cents)
    values (%L, 5, '59c00000-0000-0000-0000-000000000002', 'x', 1, 0)$$, (select wf_plan from fixture_plan)),
  '23514',
  'subscription plan item must reference a service of the subscription''s tenant',
  'a Wolf Forge plan item cannot carry a Tenant B Service'
);

select lives_ok(
  format($$insert into public.subscription_plan_items (plan_version_id, position, service_id,
      service_name_snapshot, quantity, unit_amount_cents)
    values (%L, 5, '59c00000-0000-0000-0000-000000000002', 'B extra', 1, 0)$$, (select b_plan from fixture_plan)),
  'a Tenant B plan item can carry a Tenant B Service'
);

select lives_ok(
  format($$insert into public.subscription_plan_items (plan_version_id, position,
      service_name_snapshot, quantity, unit_amount_cents)
    values (%L, 6, 'B free text', 1, 0)$$, (select b_plan from fixture_plan)),
  'a free-text plan item without a Service is unaffected'
);

-- -----------------------------------------------------------------------------
-- Cycles reference Invoices of the Subscription's Tenant only
-- -----------------------------------------------------------------------------

-- The control cycle is voided so it does not compete with the open cycle the
-- RPC scheduled (subscription_cycles_one_open_idx).

select throws_ok(
  format($$insert into public.subscription_cycles (subscription_id, plan_version_id, sequence,
      period_start, period_end, due_on, issue_on, idempotency_key, fulfillment_action,
      status, invoice_id, generated_at)
    values (%L, %L, 50, date '2030-01-01', date '2030-02-01', date '2030-01-01', date '2030-01-01',
      'b-cross-cycle', 'none', 'invoiced', '59c20000-0000-0000-0000-000000000001', now())$$,
    (select b_id from fixture_subscription), (select b_plan from fixture_plan)),
  '23514',
  'subscription cycle must reference an invoice of the subscription''s tenant',
  'a Tenant B cycle cannot be invoiced on a Wolf Forge Invoice'
);

select throws_ok(
  format($$insert into public.subscription_cycles (subscription_id, plan_version_id, sequence,
      period_start, period_end, due_on, issue_on, idempotency_key, fulfillment_action,
      status, invoice_id, generated_at)
    values (%L, %L, 50, date '2030-01-01', date '2030-02-01', date '2030-01-01', date '2030-01-01',
      'wf-cross-cycle', 'none', 'invoiced', '59c20000-0000-0000-0000-000000000002', now())$$,
    (select wf_id from fixture_subscription), (select wf_plan from fixture_plan)),
  '23514',
  'subscription cycle must reference an invoice of the subscription''s tenant',
  'a Wolf Forge cycle cannot be invoiced on a Tenant B Invoice'
);

select lives_ok(
  format($$insert into public.subscription_cycles (subscription_id, plan_version_id, sequence,
      period_start, period_end, due_on, issue_on, idempotency_key, fulfillment_action,
      status, invoice_id, generated_at)
    values (%L, %L, 50, date '2030-01-01', date '2030-02-01', date '2030-01-01', date '2030-01-01',
      'b-own-cycle', 'none', 'voided', '59c20000-0000-0000-0000-000000000002', now())$$,
    (select b_id from fixture_subscription), (select b_plan from fixture_plan)),
  'a Tenant B cycle can reference a Tenant B Invoice'
);

select throws_ok(
  $$update public.subscription_cycles set invoice_id = '59c20000-0000-0000-0000-000000000001'
    where idempotency_key = 'b-own-cycle'$$,
  '23514',
  'subscription cycle must reference an invoice of the subscription''s tenant',
  'a Tenant B cycle cannot later be re-pointed at a Wolf Forge Invoice'
);

select throws_ok(
  format($$update public.subscription_cycles set subscription_id = %L
    where idempotency_key = 'b-own-cycle'$$, (select wf_id from fixture_subscription)),
  '23514',
  'subscription cycle must reference an invoice of the subscription''s tenant',
  'a Tenant B cycle with a Tenant B Invoice cannot be moved under a Wolf Forge Subscription'
);

-- Cycles bill their own Subscription's plan; events cite their own cycles.
select is(
  (select jsonb_object_agg(conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conname in ('subscription_cycles_plan_version_id_fkey', 'subscription_events_cycle_id_fkey')),
  jsonb_build_object(
    'subscription_cycles_plan_version_id_fkey', 'FOREIGN KEY (plan_version_id, subscription_id) REFERENCES subscription_plan_versions(id, subscription_id) ON DELETE RESTRICT',
    'subscription_events_cycle_id_fkey', 'FOREIGN KEY (cycle_id, subscription_id) REFERENCES subscription_cycles(id, subscription_id) ON DELETE RESTRICT'
  ),
  'cycle plan versions and event cycles are pinned to their own Subscription'
);

select throws_ok(
  format($q$insert into public.subscription_cycles (subscription_id, plan_version_id, sequence,
      period_start, period_end, due_on, issue_on, idempotency_key, fulfillment_action, status)
    values (%L, %L, 60, date '2031-01-01', date '2031-02-01', date '2031-01-01', date '2031-01-01',
      'b-borrowed-plan', 'none', 'skipped')$q$,
    (select b_id from fixture_subscription), (select wf_plan from fixture_plan)),
  '23503',
  'insert or update on table "subscription_cycles" violates foreign key constraint "subscription_cycles_plan_version_id_fkey"',
  'a Tenant B cycle cannot bill a Wolf Forge plan version'
);

select throws_ok(
  format($q$insert into public.subscription_cycles (subscription_id, plan_version_id, sequence,
      period_start, period_end, due_on, issue_on, idempotency_key, fulfillment_action, status)
    values (%L, %L, 60, date '2031-01-01', date '2031-02-01', date '2031-01-01', date '2031-01-01',
      'wf-borrowed-plan', 'none', 'skipped')$q$,
    (select wf_id from fixture_subscription), (select b_plan from fixture_plan)),
  '23503',
  'insert or update on table "subscription_cycles" violates foreign key constraint "subscription_cycles_plan_version_id_fkey"',
  'a Wolf Forge cycle cannot bill a Tenant B plan version'
);

select throws_ok(
  format($q$insert into public.subscription_events (subscription_id, cycle_id, event_type, actor_type, payload)
    values (%L, (select id from public.subscription_cycles where subscription_id = %L and sequence = 1),
      'cycle_scheduled', 'system', '{}'::jsonb)$q$,
    (select b_id from fixture_subscription), (select wf_id from fixture_subscription)),
  '23503',
  'insert or update on table "subscription_events" violates foreign key constraint "subscription_events_cycle_id_fkey"',
  'a Tenant B event cannot cite a Wolf Forge cycle'
);

select throws_ok(
  format($q$insert into public.subscription_events (subscription_id, cycle_id, event_type, actor_type, payload)
    values (%L, (select id from public.subscription_cycles where subscription_id = %L and sequence = 1),
      'cycle_scheduled', 'system', '{}'::jsonb)$q$,
    (select wf_id from fixture_subscription), (select b_id from fixture_subscription)),
  '23503',
  'insert or update on table "subscription_events" violates foreign key constraint "subscription_events_cycle_id_fkey"',
  'a Wolf Forge event cannot cite a Tenant B cycle'
);

select is(
  (select subscription_id from public.subscription_cycles where idempotency_key = 'b-own-cycle'),
  (select b_id from fixture_subscription),
  'the rejected writes left the Tenant B cycle on its Tenant B Subscription'
);

select * from finish();
rollback;
