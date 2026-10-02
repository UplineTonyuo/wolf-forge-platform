begin;

select plan(124);

-- -----------------------------------------------------------------------------
-- Structure, capabilities, and least privilege
-- -----------------------------------------------------------------------------

select ok(to_regclass('public.subscriptions') is not null, 'subscriptions table exists');
select ok(to_regclass('public.subscription_plan_versions') is not null, 'versioned plan table exists');
select ok(to_regclass('public.subscription_plan_items') is not null, 'normalized plan item snapshots exist');
select ok(to_regclass('public.subscription_cycles') is not null, 'billing cycle table exists');
select ok(to_regclass('public.subscription_events') is not null, 'durable subscription event table exists');
select ok(to_regclass('public.subscription_payment_methods') is not null, 'provider-neutral payment references exist');
select ok(to_regclass('public.subscription_dunning_attempts') is not null, 'dunning attempt data boundary exists');

select ok(to_regprocedure('public.app_create_subscription(uuid,jsonb)') is not null, 'subscription create RPC exists');
select ok(to_regprocedure('public.app_update_subscription_terms(uuid,uuid,jsonb)') is not null, 'versioned terms RPC exists');
select ok(to_regprocedure('public.app_generate_subscription_cycle_invoice(uuid,uuid)') is not null, 'cycle generation RPC exists');
select ok(to_regprocedure('public.app_reconcile_subscription_state(uuid)') is not null, 'state reconciliation RPC exists');
select ok(to_regprocedure('public.app_list_due_subscription_work(integer)') is not null, 'catch-up scheduler read boundary exists');
select ok(to_regprocedure('public.app_restore_subscription_cycle(uuid)') is not null, 'voided cycle recovery RPC exists');

select is(
  (select count(*) from public.permissions where permission_key in (
    'subscriptions.view', 'subscriptions.manage', 'subscriptions.pause',
    'subscriptions.cancel', 'subscriptions.billing'
  )),
  5::bigint,
  'granular subscription capabilities are registered'
);

select ok(
  not has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.subscription_cycles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.subscription_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.subscription_dunning_attempts', 'INSERT'),
  'authenticated callers cannot directly mutate subscription orchestration data'
);

select ok(
  not has_function_privilege('anon', 'public.app_create_subscription(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_generate_subscription_cycle_invoice(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_restore_subscription_cycle(uuid)', 'EXECUTE'),
  'anonymous callers cannot execute subscription mutations'
);

select ok(
  (
    select bool_and(procedure.prosecdef and procedure.proconfig @> array['search_path=""']::text[])
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.app_create_subscription(uuid,jsonb)'::regprocedure,
      'public.app_update_subscription_terms(uuid,uuid,jsonb)'::regprocedure,
      'public.app_generate_subscription_cycle_invoice(uuid,uuid)'::regprocedure,
      'public.app_pause_subscription(uuid,date)'::regprocedure,
      'public.app_resume_subscription(uuid)'::regprocedure,
      'public.app_cancel_subscription(uuid,text)'::regprocedure,
      'public.app_restore_subscription_cycle(uuid)'::regprocedure,
      'public.app_reconcile_subscription_state(uuid)'::regprocedure
    )
  ),
  'subscription mutations are SECURITY DEFINER with empty search paths'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscription_cycles'::regclass
      and conname = 'subscription_cycles_subscription_sequence_unique'
  )
  and exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'subscription_cycles_one_open_idx'
  ),
  'sequence and one-open-cycle protection are structural'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscription_cycles'::regclass
      and conname = 'subscription_cycles_invoice_id_fkey'
      and pg_get_constraintdef(oid) ilike '%invoices%on delete restrict%'
  ),
  'every cycle invoice link is an explicit restrictive FK'
);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('2a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'subscription-owner@example.invalid', now(), now()),
  ('2a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'subscription-staff@example.invalid', now(), now()),
  ('1a000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'subscription-client-a@example.invalid', now(), now()),
  ('1a000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'subscription-client-b@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '2a000000-0000-0000-0000-000000000001' then 'Subscription Owner'
      else 'Subscription Staff'
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '2a000000-0000-0000-0000-000000000001'::uuid
  when 'staff' then '2a000000-0000-0000-0000-000000000002'::uuid
end
and role_row.name in ('owner', 'staff');

insert into public.companies (id, name, status)
values
  ('3a000000-0000-0000-0000-000000000001', 'Subscription Company A', 'client'),
  ('3a000000-0000-0000-0000-000000000002', 'Subscription Company B', 'client');

update public.profiles
set company_id = case id
  when '1a000000-0000-0000-0000-000000000001' then '3a000000-0000-0000-0000-000000000001'::uuid
  else '3a000000-0000-0000-0000-000000000002'::uuid
end
where id in (
  '1a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000002'
);

create temporary table subscription_test_services as
select id, name, row_number() over (order by id) as ordinal
from public.services
where is_active and archived_at is null and subscription_eligible
order by id
limit 2;
grant select on subscription_test_services to authenticated;

create temporary table subscription_test_ids (label text primary key, id uuid not null);
grant select, insert, update on subscription_test_ids to authenticated;

create function pg_temp.subscription_payload(
  p_company_id uuid,
  p_client_profile_id uuid,
  p_anchor date,
  p_amount_cents bigint default 18400,
  p_interval_unit text default 'month',
  p_recurring_action text default 'none'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'company_id', p_company_id,
    'client_profile_id', p_client_profile_id,
    'service_id', (select id from subscription_test_services where ordinal = 1),
    'plan_source', 'admin_invoice',
    'billing_anchor', p_anchor,
    'interval_unit', p_interval_unit,
    'interval_count', 1,
    'end_of_month_policy', 'clamp',
    'currency', 'USD',
    'lead_days', 5,
    'grace_days', 15,
    'recurring_action', p_recurring_action,
    'items', jsonb_build_array(jsonb_build_object(
      'service_id', (select id from subscription_test_services where ordinal = 1),
      'name', 'Foundational SEO snapshot',
      'description', 'Immutable recurring commercial terms',
      'quantity', 3,
      'unit_amount_cents', p_amount_cents,
      'unit_discount_cents', 1000,
      'is_taxable', true
    ))
  );
$$;

-- -----------------------------------------------------------------------------
-- Create, snapshots, actor derivation, and authorization
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into subscription_test_ids values (
    'main',
    (public.app_create_subscription(
      '4a000000-0000-0000-0000-000000000001',
      pg_temp.subscription_payload(
        '3a000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000001',
        current_date - 40
      )
    )).id
  )$$,
  'authorized owner can create a subscription'
);

select lives_ok(
  $$select public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000001',
    pg_temp.subscription_payload(
      '3a000000-0000-0000-0000-000000000001',
      '1a000000-0000-0000-0000-000000000001',
      current_date - 40
    )
  )$$,
  'same subscription request retries safely'
);
reset role;

select is((select count(*) from public.subscriptions where company_id = '3a000000-0000-0000-0000-000000000001'), 1::bigint, 'create retry does not duplicate the subscription');
select is((select created_by_profile_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main')), '2a000000-0000-0000-0000-000000000001'::uuid, 'subscription actor is derived from auth.uid()');
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'main')), 'active', 'new administrative subscription is active');
select is((select count(*) from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main')), 1::bigint, 'initial terms version is created once');
select is((select unit_amount_cents from public.subscription_plan_items where plan_version_id = (select current_plan_version_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main'))), 18400::bigint, 'price is snapshotted as integer cents');
select is((select quantity from public.subscription_plan_items where plan_version_id = (select current_plan_version_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main'))), 3, 'quantity is snapshotted');
select is((select count(*) from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main')), 1::bigint, 'creation schedules exactly one deterministic cycle');
select is((select lead_days from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main')), 5, 'lead time defaults are explicit on terms');
select is((select grace_days from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main')), 15, 'past-due grace is explicit on terms');
select is(
  private.subscription_add_interval('2027-01-31'::date, 'month', 1, 31::smallint, 'clamp'),
  '2027-02-28'::date,
  'Wolf Forge clamp policy makes end-of-month behavior explicit'
);

update public.services set price = price + 100
where id = (select service_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main'));
select is((select unit_amount_cents from public.subscription_plan_items where plan_version_id = (select current_plan_version_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main'))), 18400::bigint, 'later Service price changes do not rewrite subscription terms');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000002',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', current_date)
  )$$,
  '42501', 'permission denied: subscriptions.manage',
  'staff without manage capability cannot create a subscription'
);

set local "request.jwt.claim.sub" = '1a000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000003',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', current_date)
  )$$,
  '42501', 'verified internal authentication is required',
  'client cannot invoke administrative subscription creation'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.app_create_subscription('4a000000-0000-0000-0000-000000000004', '{}'::jsonb)$$,
  '42501', 'permission denied for function app_create_subscription',
  'anonymous subscription creation is rejected'
);
reset role;

-- -----------------------------------------------------------------------------
-- Invoice generation, explicit linkage, duplicate protection, and settlement
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
insert into subscription_test_ids values (
  'main-cycle',
  (select id from public.subscription_cycles
   where subscription_id = (select id from subscription_test_ids where label = 'main'))
);
select lives_ok(
  $$select public.app_generate_subscription_cycle_invoice(
    '5a000000-0000-0000-0000-000000000001',
    (select id from subscription_test_ids where label = 'main-cycle')
  )$$,
  'due subscription cycle generates an ordinary invoice'
);
select lives_ok(
  $$select public.app_generate_subscription_cycle_invoice(
    '5a000000-0000-0000-0000-000000000001',
    (select id from subscription_test_ids where label = 'main-cycle')
  )$$,
  'same generation request retries safely'
);
select lives_ok(
  $$select public.app_generate_subscription_cycle_invoice(
    '5a000000-0000-0000-0000-000000000002',
    (select id from subscription_test_ids where label = 'main-cycle')
  )$$,
  'different request identity still reconciles to the cycle invoice'
);
reset role;

select ok((select invoice_id is not null from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle')), 'cycle carries an explicit invoice FK');
select is((select count(*) from public.invoices where id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle'))), 1::bigint, 'one cycle creates exactly one invoice');
select is((select billing_reason from public.invoices where id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle'))), 'subscription_cycle', 'generated invoice uses the ordinary invoice classifier');
select is((select unit_price_cents from public.invoice_items where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle'))), 18400::bigint, 'invoice uses the plan price snapshot');
select is((select quantity from public.invoice_items where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle'))), 3, 'invoice uses the plan quantity snapshot');
select is((select count(*) from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status in ('scheduled', 'invoiced', 'past_due')), 1::bigint, 'unresolved invoice blocks another open cycle');

select ok(
  pg_get_functiondef('public.app_generate_subscription_cycle_invoice(uuid,uuid)'::regprocedure) ilike '%for update%'
  and exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscription_cycles'::regclass
      and conname = 'subscription_cycles_idempotency_key_unique'
  ),
  'concurrent generation serializes and has deterministic database uniqueness'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_record_invoice_payment(
    '6a000000-0000-0000-0000-000000000001',
    (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle')),
    52200,
    'succeeded',
    'manual'
  )$$,
  'ordinary invoice payment settles a subscription cycle'
);
reset role;

select is((select status from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle')), 'paid', 'cycle settlement follows invoice paid status');
select is((select count(*) from public.invoice_payments where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle'))), 1::bigint, 'settlement remains in the invoice payment ledger only');
select is((select count(*) from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status = 'scheduled'), 1::bigint, 'settlement schedules exactly one next cycle');
select is(
  (select due_on from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status = 'scheduled'),
  (select period_end from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle')),
  'late payment preserves the original billing anchor'
);

-- -----------------------------------------------------------------------------
-- Append-only terms and versioned changes
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_update_subscription_terms(
    '7a000000-0000-0000-0000-000000000001',
    (select id from subscription_test_ids where label = 'main'),
    jsonb_build_object(
      'effective_from', (select due_on + 1 from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status = 'scheduled'),
      'interval_unit', 'month',
      'interval_count', 1,
      'end_of_month_policy', 'clamp',
      'currency', 'USD',
      'lead_days', 5,
      'grace_days', 15,
      'recurring_action', 'none',
      'items', jsonb_build_array(jsonb_build_object(
        'service_id', (select service_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main')),
        'name', 'Changed future terms',
        'quantity', 1,
        'unit_amount_cents', 25000,
        'unit_discount_cents', 0,
        'is_taxable', true
      ))
    )
  )$$,
  'plan change appends a future terms version'
);
select lives_ok(
  $$select public.app_update_subscription_terms(
    '7a000000-0000-0000-0000-000000000001',
    (select id from subscription_test_ids where label = 'main'),
    jsonb_build_object(
      'effective_from', (select due_on + 1 from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status = 'scheduled'),
      'interval_unit', 'month', 'interval_count', 1, 'end_of_month_policy', 'clamp',
      'currency', 'USD', 'lead_days', 5, 'grace_days', 15, 'recurring_action', 'none',
      'items', jsonb_build_array(jsonb_build_object(
        'service_id', (select service_id from public.subscriptions where id = (select id from subscription_test_ids where label = 'main')),
        'name', 'Changed future terms', 'quantity', 1, 'unit_amount_cents', 25000,
        'unit_discount_cents', 0, 'is_taxable', true
      ))
    )
  )$$,
  'same terms request retries safely'
);
reset role;

select is((select count(*) from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main')), 2::bigint, 'terms retry creates one new version');
select is((select unit_amount_cents from public.subscription_plan_items where plan_version_id = (select id from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main') and version = 1)), 18400::bigint, 'old plan price remains historical');
select is((select unit_amount_cents from public.subscription_plan_items where plan_version_id = (select id from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main') and version = 2)), 25000::bigint, 'new plan price is separately snapshotted');
select throws_ok(
  $$update public.subscription_plan_versions set grace_days = 1 where subscription_id = (select id from subscription_test_ids where label = 'main') and version = 1$$,
  '55000', 'subscription commercial terms are append-only',
  'used plan versions cannot be rewritten'
);
select throws_ok(
  $$delete from public.subscription_plan_items where plan_version_id = (select id from public.subscription_plan_versions where subscription_id = (select id from subscription_test_ids where label = 'main') and version = 1)$$,
  '55000', 'subscription commercial terms are append-only',
  'historical plan items cannot be deleted'
);

-- -----------------------------------------------------------------------------
-- Past due grace, pause/resume, cancellation, and invalidated invoice safety
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
insert into subscription_test_ids values (
  'grace',
  (public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000010',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', current_date - 14, 10000)
  )).id
);
insert into subscription_test_ids values (
  'grace-cycle',
  (select id from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'grace'))
);
select public.app_generate_subscription_cycle_invoice('5a000000-0000-0000-0000-000000000010', (select id from subscription_test_ids where label = 'grace-cycle'));
select public.app_reconcile_subscription_state((select id from subscription_test_ids where label = 'grace'));
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')), 'active', 'before due plus grace the subscription remains active');

update public.subscription_cycles
set period_start = period_start - 1, period_end = period_end - 1,
    due_on = due_on - 1, issue_on = issue_on - 1
where id = (select id from subscription_test_ids where label = 'grace-cycle');
set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select public.app_reconcile_subscription_state((select id from subscription_test_ids where label = 'grace'));
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')), 'past_due', 'at due plus grace the subscription becomes past due');
select is((select blocked_reason from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')), 'unpaid_invoice', 'past-due cycle records why generation is blocked');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select public.app_pause_subscription((select id from subscription_test_ids where label = 'grace'), null);
select lives_ok(
  $$select public.app_resume_subscription((select id from subscription_test_ids where label = 'grace'))$$,
  'a paused past-due subscription can resume without hiding invoice state'
);
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')), 'past_due', 'past_due to pause to resume remains past due while the invoice is open');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select public.app_schedule_subscription_cancellation((select id from subscription_test_ids where label = 'grace'), 'Awaiting payment');
select lives_ok(
  $$select public.app_remove_subscription_cancellation((select id from subscription_test_ids where label = 'grace'))$$,
  'scheduled cancellation can be removed from a past-due subscription'
);
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')), 'past_due', 'past_due to pending cancellation to removal remains past due while the invoice is open');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select public.app_record_invoice_payment(
  '6a000000-0000-0000-0000-000000000010',
  (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')),
  1000, 'failed', 'manual'
);
reset role;
select is((select count(*) from public.subscription_events where cycle_id = (select id from subscription_test_ids where label = 'grace-cycle') and event_type = 'payment_failed'), 1::bigint, 'ordinary failed invoice attempt is reflected in subscription history');
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')), 'past_due', 'failed payment does not recover a past-due subscription');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select public.app_record_invoice_payment(
  '6a000000-0000-0000-0000-000000000011',
  (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')),
  1000, 'succeeded', 'manual'
);
reset role;
select ok(
  (select status = 'unpaid' from public.invoices where id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')))
  and (select balance_due_cents = 26000 from private.invoice_amounts((select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')))),
  'partial payment leaves the authoritative invoice open with the exact integer-cent balance'
);
select ok(
  (select status = 'past_due' from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle'))
  and (select status = 'past_due' from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')),
  'partial payment does not recover the cycle or subscription'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select public.app_record_invoice_payment(
  '6a000000-0000-0000-0000-000000000012',
  (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')),
  26000, 'succeeded', 'manual'
);
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'grace')), 'active', 'settling the authoritative invoice explicitly recovers a past-due subscription');
select is((select status from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'grace-cycle')), 'paid', 'full payment recovers the authoritative past-due cycle');
select is((select count(*) from public.subscription_events where subscription_id = (select id from subscription_test_ids where label = 'grace') and event_type = 'recovered'), 1::bigint, 'past-due recovery is durably audited');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
insert into subscription_test_ids values (
  'pause',
  (public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000011',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', current_date - 70, 10000)
  )).id
);
select public.app_pause_subscription((select id from subscription_test_ids where label = 'pause'), null);
select lives_ok(
  $$select public.app_resume_subscription((select id from subscription_test_ids where label = 'pause'))$$,
  'paused subscription can resume under the explicit Wolf Forge policy'
);
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'pause')), 'active', 'resume returns subscription to active');
select is((select count(*) from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'pause') and status = 'skipped'), 1::bigint, 'resume retains an auditable skipped paused cycle');
select ok((select due_on >= current_date from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'pause') and status = 'scheduled'), 'resume schedules a non-back-billed anchored cycle');
set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_resume_subscription((select id from subscription_test_ids where label = 'pause'))$$,
  'repeated resume is idempotent'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_schedule_subscription_cancellation((select id from subscription_test_ids where label = 'main'), 'End of engagement')$$,
  'end-of-period cancellation can be scheduled'
);
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'main')), 'pending_cancellation', 'scheduled cancellation is a real persisted state');
select is((select count(*) from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status = 'scheduled'), 0::bigint, 'scheduled cancellation suppresses the future uninvoiced cycle');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_remove_subscription_cancellation((select id from subscription_test_ids where label = 'main'))$$,
  'scheduled cancellation removal reuses the retained cycle without a sequence collision'
);
select ok(
  (select count(*) = 1 from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and sequence = 2)
  and (select status = 'scheduled' and blocked_reason is null from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and sequence = 2),
  'cancellation removal restores the consumed sequence in place without renumbering or deleting history'
);
select public.app_schedule_subscription_cancellation((select id from subscription_test_ids where label = 'main'), 'End of engagement');
select public.app_cancel_subscription((select id from subscription_test_ids where label = 'main'), 'Immediate operator decision');
reset role;
select is((select status from public.subscriptions where id = (select id from subscription_test_ids where label = 'main')), 'canceled', 'immediate cancellation is terminal');
select is((select count(*) from public.invoices where id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'main-cycle'))), 1::bigint, 'cancellation preserves historical invoices');
select is((select count(*) from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'main') and status = 'scheduled'), 0::bigint, 'canceled subscription retains no cycle eligible for generation');

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_pause_subscription((select id from subscription_test_ids where label = 'main'), null)$$,
  '55000', 'subscription cannot be paused from its current state',
  'invalid pause transition is rejected'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_generate_subscription_cycle_invoice('5a000000-0000-0000-0000-000000000099', (select id from subscription_test_ids where label = 'main-cycle'))$$,
  'historical cycle retry after cancellation reconciles to its existing invoice'
);

insert into subscription_test_ids values (
  'void-safe',
  (public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000012',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', current_date, 10000)
  )).id
);
insert into subscription_test_ids values (
  'void-safe-cycle',
  (select id from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'void-safe'))
);
select public.app_generate_subscription_cycle_invoice('5a000000-0000-0000-0000-000000000012', (select id from subscription_test_ids where label = 'void-safe-cycle'));
insert into subscription_test_ids values (
  'void-safe-invoice',
  (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'void-safe-cycle'))
);
select public.app_void_invoice((select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'void-safe-cycle')));
reset role;
select ok((select status = 'voided' and blocked_reason = 'invoice_voided_requires_operator_action' from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'void-safe-cycle')), 'voided invoice creates explicit recoverable operator state');
set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select ok((select health = 'requires_attention' from public.app_list_subscription_summaries() where subscription_id = (select id from subscription_test_ids where label = 'void-safe')), 'invalidated invoice is surfaced by the derived health signal');
select lives_ok(
  $$select public.app_restore_subscription_cycle((select id from subscription_test_ids where label = 'void-safe-cycle'))$$,
  'billing operator can restore the same voided cycle identity'
);
select ok(
  (select status = 'scheduled' and invoice_id is null and sequence = 1
     and idempotency_key = subscription_id::text || ':1'
   from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'void-safe-cycle')),
  'void recovery preserves cycle sequence and idempotency identity without retaining a collectible invoice link'
);
select ok(
  (select status = 'void' from public.invoices where id = (select id from subscription_test_ids where label = 'void-safe-invoice')),
  'void recovery preserves the invalidated invoice as financial history'
);
select is(
  (select health from public.app_list_subscription_summaries() where subscription_id = (select id from subscription_test_ids where label = 'void-safe')),
  'active',
  'successful operator recovery clears requires-attention health'
);
select ok(
  (select count(*) = 1 from public.app_list_due_subscription_work(100)
   where work_type = 'issue_invoice' and cycle_id = (select id from subscription_test_ids where label = 'void-safe-cycle'))
  and (select count(*) = 0 from public.app_list_due_subscription_work(100)
       where work_type = 'operator_action' and cycle_id = (select id from subscription_test_ids where label = 'void-safe-cycle')),
  'restored cycle returns to billable work instead of freezing in operator attention'
);
select lives_ok(
  $$select public.app_generate_subscription_cycle_invoice(
    '5a000000-0000-0000-0000-000000000013',
    (select id from subscription_test_ids where label = 'void-safe-cycle')
  )$$,
  'restored cycle generates one replacement invoice'
);
select ok(
  (select invoice_id <> (select id from subscription_test_ids where label = 'void-safe-invoice')
   from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'void-safe-cycle'))
  and (select status = 'void' from public.invoices where id = (select id from subscription_test_ids where label = 'void-safe-invoice')),
  'replacement invoice is distinct while the original remains void'
);
select lives_ok(
  $$select public.app_generate_subscription_cycle_invoice(
    '5a000000-0000-0000-0000-000000000014',
    (select id from subscription_test_ids where label = 'void-safe-cycle')
  )$$,
  'replacement generation retries without duplicating the invoice'
);
select is(
  (select count(*) from public.invoices
   where company_id = '3a000000-0000-0000-0000-000000000001'
     and billing_reason = 'subscription_cycle'
     and due_at::date = current_date),
  2::bigint,
  'void recovery retains one void invoice and creates exactly one collectible replacement'
);
select is(
  (select count(*) from public.subscription_events where cycle_id = (select id from subscription_test_ids where label = 'void-safe-cycle') and event_type = 'cycle_restored'),
  1::bigint,
  'void recovery is durably linked in subscription history'
);
reset role;
select throws_ok(
  $$delete from public.invoices where id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'void-safe-cycle'))$$,
  '55000', 'issued invoice history cannot be deleted',
  'referenced invoice deletion cannot silently orphan the subscription'
);

-- -----------------------------------------------------------------------------
-- Subscription invoice settlement through the existing WF Card wallet flow
-- -----------------------------------------------------------------------------

update public.company_wallets
set balance_cents = 100000, currency = 'USD'
where company_id = '3a000000-0000-0000-0000-000000000001';

insert into public.wf_card_memberships (
  company_id, status, activated_at, purchase_price_cents, purchase_currency, purchase_reference
) values (
  '3a000000-0000-0000-0000-000000000001', 'active', now(), 25900, 'USD', 'subscription-wallet-test'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
insert into subscription_test_ids values (
  'wallet',
  (public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000014',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', current_date, 10000)
  )).id
);
insert into subscription_test_ids values (
  'wallet-cycle',
  (select id from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'wallet'))
);
select public.app_generate_subscription_cycle_invoice('5a000000-0000-0000-0000-000000000015', (select id from subscription_test_ids where label = 'wallet-cycle'));
insert into subscription_test_ids values (
  'wallet-invoice',
  (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle'))
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '1a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select * from public.app_pay_invoice_with_wallet(
    '8a000000-0000-0000-0000-000000000001',
    (select id from subscription_test_ids where label = 'wallet-invoice')
  )$$,
  'WF Card settles a Subscription-generated invoice through the existing wallet flow'
);
select lives_ok(
  $$select * from public.app_pay_invoice_with_wallet(
    '8a000000-0000-0000-0000-000000000001',
    (select id from subscription_test_ids where label = 'wallet-invoice')
  )$$,
  'retrying the same Subscription wallet payment is idempotent'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_reconcile_subscription_state((select id from subscription_test_ids where label = 'wallet'))$$,
  'wallet-settled Subscription reconciles cleanly'
);
select lives_ok(
  $$select public.app_reconcile_subscription_state((select id from subscription_test_ids where label = 'wallet'))$$,
  'repeated wallet-settled Subscription reconciliation is idempotent'
);
reset role;

select is(
  (select status from public.invoices where id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle'))),
  'paid',
  'WF Card payment settles the ordinary Invoice financial truth'
);
select is((select status from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle')), 'paid', 'wallet settlement reconciles the Subscription cycle to paid');
select ok(
  (select status = 'active' from public.subscriptions where id = (select id from subscription_test_ids where label = 'wallet'))
  and (select count(*) = 1 from public.subscription_cycles where subscription_id = (select id from subscription_test_ids where label = 'wallet') and status = 'scheduled'),
  'wallet settlement leaves the Subscription active with exactly one next cycle'
);
select ok(
  (select count(*) = 1 from public.invoice_payments where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle')))
  and (select amount_cents = 27000 and payment_method = 'wolf_forge_wallet' and status = 'succeeded'
       from public.invoice_payments where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle'))),
  'wallet settlement records one exact succeeded Invoice payment'
);
select ok(
  (select count(*) = 1 from public.company_wallet_transactions where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle')))
  and (select amount_cents = -27000 from public.company_wallet_transactions where invoice_id = (select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle')))
  and (select balance_cents = 73000 from public.company_wallets where company_id = '3a000000-0000-0000-0000-000000000001'),
  'wallet debit ledger and wallet balance reconcile exactly once'
);
select is(
  (select balance_due_cents from private.invoice_amounts((select invoice_id from public.subscription_cycles where id = (select id from subscription_test_ids where label = 'wallet-cycle')))),
  0::bigint,
  'wallet-settled Subscription Invoice has zero remaining balance'
);
select is(
  (select count(*) from public.subscription_events where cycle_id = (select id from subscription_test_ids where label = 'wallet-cycle') and event_type = 'payment_settled'),
  1::bigint,
  'wallet settlement produces one idempotent Subscription settlement event'
);

-- -----------------------------------------------------------------------------
-- Company isolation, read models, audit retention, and financial regression
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
insert into subscription_test_ids values (
  'company-b',
  (public.app_create_subscription(
    '4a000000-0000-0000-0000-000000000013',
    pg_temp.subscription_payload('3a000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000002', current_date + 10, 10000)
  )).id
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '1a000000-0000-0000-0000-000000000001';
select ok((select count(*) > 0 from public.app_list_subscription_summaries() where company_id = '3a000000-0000-0000-0000-000000000001'), 'Client A can read own-company subscription summaries');
select is((select count(*) from public.app_list_subscription_summaries() where company_id = '3a000000-0000-0000-0000-000000000002'), 0::bigint, 'Client A cannot read Client B subscription summaries');
select throws_ok(
  $$select public.app_get_subscription_detail((select id from subscription_test_ids where label = 'company-b'))$$,
  '42501', 'subscription access is denied',
  'Client A cannot access Client B subscription detail'
);
select throws_ok(
  $$select public.app_pause_subscription((select id from subscription_test_ids where label = 'company-b'), null)$$,
  '42501', 'verified internal authentication is required',
  'Client A cannot mutate Client B subscription'
);
select is((select count(*) from public.subscription_cycles), 0::bigint, 'clients cannot directly read raw billing cycles');
reset role;

select throws_ok(
  $$update public.subscription_events set payload = '{"tampered":true}'::jsonb where subscription_id = (select id from subscription_test_ids where label = 'main')$$,
  '55000', 'subscription events are append-only',
  'subscription lifecycle history cannot be rewritten'
);
select ok((select count(*) >= 1 from public.subscription_events where subscription_id = (select id from subscription_test_ids where label = 'main') and event_type = 'payment_settled'), 'settlement is durably recorded as history');
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'subscriptions'
    and column_name in ('balance_cents', 'paid', 'refund_cents', 'amount_cents')
), 'subscription identity contains no second balance, paid flag, refund, or amount ledger');
select ok(
  pg_get_function_arguments('public.app_create_subscription(uuid,jsonb)'::regprocedure) not ilike '%actor%'
  and pg_get_function_arguments('public.app_create_subscription(uuid,jsonb)'::regprocedure) not ilike '%created_by%',
  'subscription callers cannot spoof actor identity'
);
set local role authenticated;
set local "request.jwt.claim.sub" = '2a000000-0000-0000-0000-000000000001';
select ok((select count(*) = 0 from public.app_list_due_subscription_work(100) where work_type = 'operator_action' and subscription_id = (select id from subscription_test_ids where label = 'void-safe')), 'recovered invalidated cycle does not remain poison operator work');
reset role;
select ok((select count(*) >= 1 from public.activity_events where entity_type = 'subscription' and entity_id = (select id from subscription_test_ids where label = 'main')), 'subscription mutations also participate in the shared activity architecture');
select is((select count(*) from public.services), 59::bigint, 'Services remain exactly 59');
select ok(to_regclass('public.coupons') is not null and to_regprocedure('public.app_validate_coupon(text,jsonb,numeric)') is not null, 'Coupons architecture remains intact');
select ok(to_regclass('public.wf_card_memberships') is not null and to_regprocedure('public.app_pay_invoice_with_wallet(uuid,uuid,text)') is not null, 'WF Card invoice settlement architecture remains intact');

select * from finish();
rollback;
