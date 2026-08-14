begin;

select plan(76);

-- -----------------------------------------------------------------------------
-- Structure and least privilege
-- -----------------------------------------------------------------------------

select ok(to_regclass('public.invoices') is not null, 'invoices table exists');
select ok(to_regclass('public.invoice_items') is not null, 'invoice items table exists');
select ok(to_regclass('public.invoice_payments') is not null, 'invoice payments table exists');
select ok(to_regclass('public.invoice_refunds') is not null, 'invoice refunds table exists');
select ok(to_regclass('public.invoice_number_counters') is not null, 'transactional invoice numbering counter exists');

select ok(to_regprocedure('public.app_create_invoice(uuid,jsonb)') is not null, 'invoice create RPC exists');
select ok(to_regprocedure('public.app_update_invoice(uuid,jsonb)') is not null, 'invoice update RPC exists');
select ok(to_regprocedure('public.app_issue_invoice(uuid)') is not null, 'invoice issue RPC exists');
select ok(to_regprocedure('public.app_record_invoice_payment(uuid,uuid,bigint,text,text,text,text)') is not null, 'payment RPC exists');
select ok(to_regprocedure('public.app_void_invoice(uuid)') is not null, 'void RPC exists');
select ok(to_regprocedure('public.app_refund_invoice(uuid,uuid,bigint,text,uuid,text,text,text)') is not null, 'refund RPC exists');
select ok(to_regprocedure('public.app_get_invoice_financials(uuid)') is not null, 'derived financial state RPC exists');

select ok(
  not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invoices'::regclass
      and pg_get_constraintdef(oid) ilike '%overdue%'
  )
  and not exists (select 1 from public.invoices where status in ('overdue', 'refunded')),
  'overdue and refunded are not persisted invoice statuses'
);

select ok(
  not has_table_privilege('authenticated', 'public.invoices', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invoice_payments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invoice_refunds', 'INSERT'),
  'authenticated callers have no direct financial mutation grants'
);

select ok(
  not has_function_privilege('anon', 'public.app_create_invoice(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_record_invoice_payment(uuid,uuid,bigint,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_refund_invoice(uuid,uuid,bigint,text,uuid,text,text,text)', 'EXECUTE'),
  'anonymous callers cannot execute financial mutations'
);

select ok(
  (
    select bool_and(procedure.prosecdef and procedure.proconfig @> array['search_path=""']::text[])
    from pg_catalog.pg_proc as procedure
    where procedure.oid in (
      'public.app_create_invoice(uuid,jsonb)'::regprocedure,
      'public.app_update_invoice(uuid,jsonb)'::regprocedure,
      'public.app_issue_invoice(uuid)'::regprocedure,
      'public.app_record_invoice_payment(uuid,uuid,bigint,text,text,text,text)'::regprocedure,
      'public.app_void_invoice(uuid)'::regprocedure,
      'public.app_refund_invoice(uuid,uuid,bigint,text,uuid,text,text,text)'::regprocedure
    )
  ),
  'financial RPCs are SECURITY DEFINER with an empty search_path'
);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('28000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'invoice-admin@example.invalid', now(), now()),
  ('28000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'invoice-member@example.invalid', now(), now()),
  ('18000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'invoice-client-a@example.invalid', now(), now()),
  ('18000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'invoice-client-b@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id,
    display_name = case profile_row.id
      when '28000000-0000-0000-0000-000000000001' then 'Invoice Admin'
      when '28000000-0000-0000-0000-000000000002' then 'Invoice Member'
      when '18000000-0000-0000-0000-000000000001' then 'Invoice Client A'
      else 'Invoice Client B'
    end
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'admin' then '28000000-0000-0000-0000-000000000001'::uuid
  when 'staff' then '28000000-0000-0000-0000-000000000002'::uuid
end
and role_row.name in ('admin', 'staff');

insert into public.companies (id, name, status)
values
  ('38000000-0000-0000-0000-000000000001', 'Invoice Company A', 'client'),
  ('38000000-0000-0000-0000-000000000002', 'Invoice Company B', 'client');

update public.profiles
set company_id = case id
  when '18000000-0000-0000-0000-000000000001' then '38000000-0000-0000-0000-000000000001'::uuid
  else '38000000-0000-0000-0000-000000000002'::uuid
end
where id in (
  '18000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0000-000000000002'
);

create temporary table invoice_test_services as
select id, name, price, currency, row_number() over (order by id) as ordinal
from public.services
where is_active and archived_at is null
order by id
limit 2;
grant select on invoice_test_services to authenticated;

create temporary table invoice_test_ids (label text primary key, id uuid not null);
grant select, insert, update, delete on invoice_test_ids to authenticated;

create function pg_temp.invoice_payload(
  p_company_id uuid,
  p_amount_cents bigint,
  p_service_backed boolean default false,
  p_status text default 'draft',
  p_due_at timestamptz default null,
  p_client_profile_id uuid default null,
  p_add_custom_item boolean default false
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'company_id', p_company_id,
    'client_profile_id', p_client_profile_id,
    'status', p_status,
    'currency', 'USD',
    'billing_reason', 'manual',
    'due_at', coalesce(p_due_at, now() + interval '7 days'),
    'items',
      case when p_service_backed then
        jsonb_build_array(jsonb_build_object(
          'service_id', (select id from invoice_test_services where ordinal = 1),
          'name', 'Service price snapshot',
          'description', 'Historical service description',
          'quantity', 1,
          'unit_price_cents', p_amount_cents,
          'unit_discount_cents', 0,
          'is_taxable', true
        ))
      else
        jsonb_build_array(jsonb_build_object(
          'name', 'Custom billing item',
          'description', 'Custom work',
          'quantity', 1,
          'unit_price_cents', p_amount_cents,
          'unit_discount_cents', 0,
          'is_taxable', false
        ))
      end
      || case when p_add_custom_item then
        jsonb_build_array(jsonb_build_object(
          'name', 'Additional custom item',
          'quantity', 2,
          'unit_price_cents', 2500,
          'unit_discount_cents', 500,
          'is_taxable', false
        ))
      else '[]'::jsonb end
  );
$$;

-- -----------------------------------------------------------------------------
-- Creation, authorization, snapshots, update, idempotency
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into invoice_test_ids values (
    'main-a',
    (public.app_create_invoice(
      '48000000-0000-0000-0000-000000000001',
      pg_temp.invoice_payload(
        '38000000-0000-0000-0000-000000000001', 12345, true, 'draft',
        now() - interval '1 day', '18000000-0000-0000-0000-000000000001', true
      )
    )).id
  )$$,
  'authorized invoice manager can create a draft invoice'
);

reset role;

select is(
  (select created_by_profile_id from public.invoices where id = (select id from invoice_test_ids where label = 'main-a')),
  '28000000-0000-0000-0000-000000000001'::uuid,
  'invoice actor is derived from auth.uid()'
);
select is((select count(*) from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-a')), 2::bigint, 'multiple invoice items are created atomically');
select ok((select service_id is not null and unit_price_cents = 12345 from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-a') and position = 0), 'Service-backed item retains service_id and editable price snapshot');
select ok((select service_id is null and line_subtotal_cents = 4000 from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-a') and position = 1), 'custom item uses null service_id and defined discount arithmetic');
select is((select total_cents from public.invoices where id = (select id from invoice_test_ids where label = 'main-a')), 16345::bigint, 'invoice totals are authoritative cents derived from all lines');

update public.services set price = price + 1 where id = (select service_id from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-a') and position = 0);
select is((select unit_price_cents from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-a') and position = 0), 12345::bigint, 'later Service price changes do not rewrite invoice snapshots');

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_update_invoice((select id from invoice_test_ids where label = 'main-a'), '{"billing_reason":"subscription_update"}'::jsonb)$$,
  'authorized invoice manager can update a draft'
);
reset role;
select is((select billing_reason from public.invoices where id = (select id from invoice_test_ids where label = 'main-a')), 'subscription_update', 'draft update persists');

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_create_invoice(
    '48000000-0000-0000-0000-000000000001',
    pg_temp.invoice_payload(
      '38000000-0000-0000-0000-000000000001', 12345, true, 'draft',
      now() - interval '1 day', '18000000-0000-0000-0000-000000000001', true
    )
  )$$,
  'same invoice request can be retried safely'
);
reset role;
select is((select count(*) from public.invoices where company_id = '38000000-0000-0000-0000-000000000001' and created_by_profile_id = '28000000-0000-0000-0000-000000000001'), 1::bigint, 'idempotent invoice create does not duplicate the invoice');

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.app_create_invoice('48000000-0000-0000-0000-000000000002', pg_temp.invoice_payload('38000000-0000-0000-0000-000000000001', 10000))$$,
  '42501', 'permission denied: invoices.manage',
  'ordinary member without capability cannot create an invoice'
);

set local "request.jwt.claim.sub" = '18000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_invoice('48000000-0000-0000-0000-000000000003', pg_temp.invoice_payload('38000000-0000-0000-0000-000000000001', 10000))$$,
  '42501', 'verified internal authentication is required',
  'client cannot create an administrative invoice'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.app_create_invoice('48000000-0000-0000-0000-000000000004', '{}'::jsonb)$$,
  '42501', 'permission denied for function app_create_invoice',
  'anonymous caller cannot create an invoice'
);
reset role;

-- -----------------------------------------------------------------------------
-- Company isolation, nullable numbering, issuance, and derived overdue
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
insert into invoice_test_ids values (
  'main-b',
  (public.app_create_invoice(
    '48000000-0000-0000-0000-000000000005',
    pg_temp.invoice_payload(
      '38000000-0000-0000-0000-000000000002', 20000, false, 'draft',
      now() + interval '2 days', '18000000-0000-0000-0000-000000000002'
    )
  )).id
);
insert into invoice_test_ids values (
  'pending-number',
  (public.app_create_invoice(
    '48000000-0000-0000-0000-000000000006',
    pg_temp.invoice_payload('38000000-0000-0000-0000-000000000001', 5000, false, 'payment_pending')
  )).id
);
reset role;

select ok((select invoice_number is null and issued_at is null and status = 'payment_pending' from public.invoices where id = (select id from invoice_test_ids where label = 'pending-number')), 'payment-pending invoice may exist without a final number');

set local role authenticated;
set local "request.jwt.claim.sub" = '18000000-0000-0000-0000-000000000001';
select is((select count(*) from public.invoices where company_id = '38000000-0000-0000-0000-000000000001'), 2::bigint, 'Client A can read own-company invoices');
select is((select count(*) from public.invoices where company_id = '38000000-0000-0000-0000-000000000002'), 0::bigint, 'Client A cannot read Company B invoices');
select is((select count(*) from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-b')), 0::bigint, 'Client A cannot read Company B invoice items');

set local "request.jwt.claim.sub" = '18000000-0000-0000-0000-000000000002';
select is((select count(*) from public.invoices where company_id = '38000000-0000-0000-0000-000000000002'), 1::bigint, 'Client B can read own-company invoices');
select is((select count(*) from public.invoices where company_id = '38000000-0000-0000-0000-000000000001'), 0::bigint, 'Client B cannot read Company A invoices');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.invoices$$, '42501', 'permission denied for table invoices', 'anonymous private invoice reads are blocked');
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select lives_ok($$select public.app_issue_invoice((select id from invoice_test_ids where label = 'main-a'))$$, 'authorized manager can issue Invoice A');
select lives_ok($$select public.app_issue_invoice((select id from invoice_test_ids where label = 'main-b'))$$, 'authorized manager can issue Invoice B');
reset role;

select ok((select invoice_number is not null and status = 'unpaid' from public.invoices where id = (select id from invoice_test_ids where label = 'main-a')), 'issuance assigns a number and unpaid status');
select isnt(
  (select invoice_number from public.invoices where id = (select id from invoice_test_ids where label = 'main-a')),
  (select invoice_number from public.invoices where id = (select id from invoice_test_ids where label = 'main-b')),
  'sequential issuance produces unique invoice numbers'
);
select is(
  (select invoice_number from public.invoices where id = (select id from invoice_test_ids where label = 'main-b'))
    - (select invoice_number from public.invoices where id = (select id from invoice_test_ids where label = 'main-a')),
  1::bigint,
  'transactional counter assigns deterministic sequential numbers'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select ok(
  (select is_overdue and presentation_state = 'overdue' from public.app_get_invoice_financials((select id from invoice_test_ids where label = 'main-a'))),
  'overdue is derived from payable status, positive balance, and past due date'
);
select throws_ok(
  $$select public.app_update_invoice((select id from invoice_test_ids where label = 'main-a'), '{"items":[{"name":"rewrite","quantity":1,"unit_price_cents":1}]}'::jsonb)$$,
  '55000', 'issued invoice financial contents are immutable',
  'issued line items cannot be rewritten'
);
reset role;

-- -----------------------------------------------------------------------------
-- Payments and balance arithmetic
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';

insert into invoice_test_ids values (
  'full-payment',
  (public.app_create_invoice('48000000-0000-0000-0000-000000000010', pg_temp.invoice_payload('38000000-0000-0000-0000-000000000001', 99700, true))).id
);
select public.app_issue_invoice((select id from invoice_test_ids where label = 'full-payment'));
select lives_ok(
  $$select public.app_record_invoice_payment('58000000-0000-0000-0000-000000000001', (select id from invoice_test_ids where label = 'full-payment'), 99700)$$,
  'authorized manual full payment succeeds'
);
select lives_ok(
  $$select public.app_record_invoice_payment('58000000-0000-0000-0000-000000000001', (select id from invoice_test_ids where label = 'full-payment'), 99700)$$,
  'same payment request can be retried safely'
);
reset role;

select is((select count(*) from public.invoice_payments where invoice_id = (select id from invoice_test_ids where label = 'full-payment')), 1::bigint, 'idempotent payment creates one ledger row');
select ok((select status = 'paid' from public.invoices where id = (select id from invoice_test_ids where label = 'full-payment')), 'full successful payment persists paid lifecycle state');
select is((select balance_due_cents from private.invoice_amounts((select id from invoice_test_ids where label = 'full-payment'))), 0::bigint, 'full payment produces zero balance due');
select ok((select fulfillment_status = 'pending' and order_id is null from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'full-payment')), 'full settlement creates one safe pending fulfillment hook without inventing an Order');

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
insert into invoice_test_ids values (
  'multi-payment',
  (public.app_create_invoice('48000000-0000-0000-0000-000000000011', pg_temp.invoice_payload('38000000-0000-0000-0000-000000000001', 10000))).id
);
select public.app_issue_invoice((select id from invoice_test_ids where label = 'multi-payment'));
select public.app_record_invoice_payment('58000000-0000-0000-0000-000000000002', (select id from invoice_test_ids where label = 'multi-payment'), 3000);
select is((select balance_due_cents from public.app_get_invoice_financials((select id from invoice_test_ids where label = 'multi-payment'))), 7000::bigint, 'partial payment produces correct remaining balance');
select public.app_record_invoice_payment('58000000-0000-0000-0000-000000000003', (select id from invoice_test_ids where label = 'multi-payment'), 7000);
select is((select gross_paid_cents from public.app_get_invoice_financials((select id from invoice_test_ids where label = 'multi-payment'))), 10000::bigint, 'multiple successful payments sum correctly');

insert into invoice_test_ids values (
  'attempts',
  (public.app_create_invoice('48000000-0000-0000-0000-000000000012', pg_temp.invoice_payload('38000000-0000-0000-0000-000000000001', 10000))).id
);
select public.app_issue_invoice((select id from invoice_test_ids where label = 'attempts'));
select public.app_record_invoice_payment('58000000-0000-0000-0000-000000000004', (select id from invoice_test_ids where label = 'attempts'), 4000, 'pending');
select public.app_record_invoice_payment('58000000-0000-0000-0000-000000000005', (select id from invoice_test_ids where label = 'attempts'), 4000, 'failed');
select is((select gross_paid_cents from public.app_get_invoice_financials((select id from invoice_test_ids where label = 'attempts'))), 0::bigint, 'pending and failed payment attempts do not count as settled');
select ok((select status = 'payment_pending' from public.invoices where id = (select id from invoice_test_ids where label = 'attempts')), 'pending payment is represented without being treated as paid');
reset role;

select ok(
  (select amount_cents = 99700 and payment_method = 'manual' and created_by_profile_id = '28000000-0000-0000-0000-000000000001'
   from public.invoice_payments where invoice_id = (select id from invoice_test_ids where label = 'full-payment')),
  'manual mark-paid creates attributable payment history rather than only flipping status'
);

-- -----------------------------------------------------------------------------
-- Refunds, void, immutable history, audit, and regressions
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_refund_invoice(
    '68000000-0000-0000-0000-000000000001',
    (select id from invoice_test_ids where label = 'full-payment'),
    30000,
    'Partial scope reduction'
  )$$,
  'authorized partial refund succeeds'
);
reset role;

select is(
  (select created_by_profile_id from public.invoice_refunds where request_id = '68000000-0000-0000-0000-000000000001'),
  '28000000-0000-0000-0000-000000000001'::uuid,
  'refund actor is derived from auth.uid()'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select ok(
  (select successful_refunds_cents = 30000 and net_paid_cents = 69700
     and balance_due_cents = 0 and presentation_state = 'partially_refunded'
   from public.app_get_invoice_financials((select id from invoice_test_ids where label = 'full-payment'))),
  'partial refund preserves settlement without reopening a paid invoice balance'
);
select lives_ok(
  $$select public.app_refund_invoice(
    '68000000-0000-0000-0000-000000000001',
    (select id from invoice_test_ids where label = 'full-payment'),
    30000,
    'Partial scope reduction'
  )$$,
  'same refund request can be retried safely'
);
reset role;
select is((select count(*) from public.invoice_refunds where request_id = '68000000-0000-0000-0000-000000000001'), 1::bigint, 'idempotent refund creates one ledger row');

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_refund_invoice(
    '68000000-0000-0000-0000-000000000002',
    (select id from invoice_test_ids where label = 'full-payment'),
    69700,
    'Complete refund'
  )$$,
  'remaining refundable amount can be fully refunded'
);
select ok(
  (select successful_refunds_cents = 99700 and net_paid_cents = 0
     and balance_due_cents = 0 and presentation_state = 'refunded'
   from public.app_get_invoice_financials((select id from invoice_test_ids where label = 'full-payment'))),
  'full 997 dollar refund is derived and remains non-collectible while paid history is preserved'
);
select throws_ok(
  $$select public.app_refund_invoice(
    '68000000-0000-0000-0000-000000000003',
    (select id from invoice_test_ids where label = 'full-payment'),
    1,
    'Excess refund'
  )$$,
  '22023', 'invoice refund exceeds refundable settled amount',
  'cumulative successful refunds cannot exceed settled refundable money'
);
reset role;

select throws_ok(
  $$update public.invoice_payments set amount_cents = amount_cents - 1 where request_id = '58000000-0000-0000-0000-000000000001'$$,
  '55000', 'invoice financial ledgers are append-only',
  'payment history is append-only'
);
select throws_ok(
  $$delete from public.invoice_refunds where request_id = '68000000-0000-0000-0000-000000000001'$$,
  '55000', 'invoice financial ledgers are append-only',
  'refund history is append-only'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_void_invoice((select id from invoice_test_ids where label = 'main-b'))$$,
  'authorized invoice void succeeds for an unsettled invoice'
);
reset role;
select ok(
  (select status = 'void' and voided_at is not null from public.invoices where id = (select id from invoice_test_ids where label = 'main-b'))
  and (select count(*) = 1 from public.invoice_items where invoice_id = (select id from invoice_test_ids where label = 'main-b')),
  'void preserves invoice and line-item history'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '28000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_record_invoice_payment(
    '58000000-0000-0000-0000-000000000006',
    (select id from invoice_test_ids where label = 'main-b'),
    20000
  )$$,
  '55000', 'invoice is not open for payment',
  'void invoice rejects future ordinary settlement'
);
select throws_ok(
  $$select public.app_void_invoice((select id from invoice_test_ids where label = 'full-payment'))$$,
  '55000', 'only an unsettled issued invoice can be voided',
  'paid invoice must be refunded rather than voided'
);
reset role;

select ok(
  (select count(*) from public.activity_events
   where entity_type = 'invoice'
     and action in (
       'invoice.created', 'invoice.updated', 'invoice.issued',
       'invoice.payment_recorded', 'invoice.voided', 'invoice.refunded'
     )) >= 6,
  'invoice lifecycle mutations write attributable audit events'
);

select ok(
  pg_get_function_arguments('public.app_create_invoice(uuid,jsonb)'::regprocedure) not ilike '%actor%'
  and pg_get_function_arguments('public.app_record_invoice_payment(uuid,uuid,bigint,text,text,text,text)'::regprocedure) not ilike '%actor%'
  and pg_get_function_arguments('public.app_refund_invoice(uuid,uuid,bigint,text,uuid,text,text,text)'::regprocedure) not ilike '%actor%',
  'financial RPCs expose no caller-supplied actor identity'
);

select is((select count(*) from public.services), 59::bigint, 'Services remain exactly 59');
select is((select count(*) from public.services where description is not null and btrim(description) <> ''), 59::bigint, 'Service descriptions remain 59 of 59');
select ok(
  to_regclass('public.coupons') is not null
  and to_regclass('public.coupon_redemptions') is not null
  and to_regprocedure('public.app_validate_coupon(text,jsonb,numeric)') is not null,
  'Coupons backend architecture remains intact'
);
select is(
  (select count(*) from public.permissions where permission_key in (
    'invoices.view', 'invoices.manage', 'invoices.mark_paid', 'invoices.void', 'invoices.refund'
  )),
  5::bigint,
  'fine-grained invoice capability catalog is complete'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '18000000-0000-0000-0000-000000000001';
select is((select count(*) from public.invoice_payments), 0::bigint, 'clients cannot read raw payment administration records');
reset role;

select * from finish();
rollback;
