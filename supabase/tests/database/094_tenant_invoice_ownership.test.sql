begin;

select plan(39);

-- WL-1C.5: every Invoice is owned by exactly one Tenant; its Client, client
-- person, billed Orders and Services, refunded payments and wallet ledger
-- links stay inside that Tenant. Wolf Forge (WF) =
-- f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...09d1.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select has_column('public', 'invoices', 'tenant_id', 'invoices.tenant_id exists');
select col_not_null('public', 'invoices', 'tenant_id', 'invoices.tenant_id is NOT NULL');
select hasnt_column('public', 'invoice_items', 'tenant_id', 'invoice_items inherits its Tenant through invoice_id');
select hasnt_column('public', 'invoice_payments', 'tenant_id', 'invoice_payments inherits its Tenant through invoice_id');
select hasnt_column('public', 'invoice_refunds', 'tenant_id', 'invoice_refunds inherits its Tenant through invoice_id');
select hasnt_column('public', 'company_wallet_transactions', 'tenant_id', 'wallet transactions inherit their Tenant through company_id');

select is(
  (select jsonb_object_agg(conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conname in (
      'invoices_tenant_id_fkey', 'invoices_tenant_id_id_key', 'invoices_id_company_id_key',
      'invoices_company_id_fkey', 'invoices_client_profile_id_fkey',
      'invoice_payments_id_invoice_id_key', 'invoice_refunds_invoice_payment_id_fkey',
      'company_wallet_transactions_invoice_id_fkey',
      'company_wallet_transactions_invoice_payment_id_fkey'
    )),
  jsonb_build_object(
    'invoices.invoices_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
    'invoices.invoices_tenant_id_id_key', 'UNIQUE (tenant_id, id)',
    'invoices.invoices_id_company_id_key', 'UNIQUE (id, company_id)',
    'invoices.invoices_company_id_fkey', 'FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE RESTRICT',
    'invoices.invoices_client_profile_id_fkey', 'FOREIGN KEY (tenant_id, client_profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE SET NULL (client_profile_id)',
    'invoice_payments.invoice_payments_id_invoice_id_key', 'UNIQUE (id, invoice_id)',
    'invoice_refunds.invoice_refunds_invoice_payment_id_fkey', 'FOREIGN KEY (invoice_payment_id, invoice_id) REFERENCES invoice_payments(id, invoice_id) ON DELETE RESTRICT',
    'company_wallet_transactions.company_wallet_transactions_invoice_id_fkey', 'FOREIGN KEY (invoice_id, company_id) REFERENCES invoices(id, company_id) ON DELETE RESTRICT',
    'company_wallet_transactions.company_wallet_transactions_invoice_payment_id_fkey', 'FOREIGN KEY (invoice_payment_id, invoice_id) REFERENCES invoice_payments(id, invoice_id) ON DELETE RESTRICT'
  ),
  'Invoices are Tenant-owned and their Client, person, refund and ledger links are pinned'
);

select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'tenant_id'),
  'private.identity_tenant_id()',
  'new Invoices default to the caller''s resolved Tenant, not a fixed Wolf Forge default'
);

select is(
  (select count(*) from public.invoices invoice join public.companies company on company.id = invoice.company_id
   where company.tenant_id = private.wolf_forge_tenant_id() and invoice.tenant_id <> company.tenant_id),
  0::bigint,
  'Invoices for Wolf Forge Companies retain Wolf Forge Tenant ownership'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 941 = owner U (internal in WF and B), 943 = WF client person of Client 941.
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000941', 'authenticated', 'authenticated', 'inv-owner-b@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000943', 'authenticated', 'authenticated', 'inv-wf-client@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009d1', 'inv-tenant-b', 'Invoice Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000941', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Invoice Client', 'client'),
  ('30000000-0000-0000-0000-000000000942', 'f0f0f0f0-0000-4000-8000-0000000009d1', 'B Invoice Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000941', 'owner', null),
  ('20000000-0000-0000-0000-000000000943', 'client', '30000000-0000-0000-0000-000000000941')
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-0000000009d1', '20000000-0000-0000-0000-000000000941', 'internal', role.id
from public.roles as role where role.name = 'owner';

insert into public.services (id, tenant_id, name)
values
  ('59b00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Invoice Service'),
  ('59b00000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009d1', 'B Invoice Service');

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('59b10000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001',
   '30000000-0000-0000-0000-000000000941', '59b00000-0000-0000-0000-000000000001', 'WF Invoice Order'),
  ('59b10000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009d1',
   '30000000-0000-0000-0000-000000000942', '59b00000-0000-0000-0000-000000000002', 'B Invoice Order');

insert into public.invoices (id, tenant_id, company_id, created_by_profile_id, updated_by_profile_id)
values
  ('59a00000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000941',
   '20000000-0000-0000-0000-000000000941', '20000000-0000-0000-0000-000000000941'),
  ('59a00000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009d1', '30000000-0000-0000-0000-000000000942',
   '20000000-0000-0000-0000-000000000941', '20000000-0000-0000-0000-000000000941');

insert into public.invoice_payments (id, invoice_id, amount_cents, currency, status, payment_method,
  request_id, created_by_profile_id)
values
  ('59a10000-0000-0000-0000-000000000001', '59a00000-0000-0000-0000-000000000001', 100, 'USD',
   'pending', 'manual', gen_random_uuid(), '20000000-0000-0000-0000-000000000941'),
  ('59a10000-0000-0000-0000-000000000002', '59a00000-0000-0000-0000-000000000002', 100, 'USD',
   'pending', 'manual', gen_random_uuid(), '20000000-0000-0000-0000-000000000941'),
  ('59a10000-0000-0000-0000-000000000003', '59a00000-0000-0000-0000-000000000002', 100, 'USD',
   'pending', 'manual', gen_random_uuid(), '20000000-0000-0000-0000-000000000941');

-- -----------------------------------------------------------------------------
-- Normal Invoice creation takes the caller's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000941';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_invoice(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000941',
    'items', jsonb_build_array(jsonb_build_object('service_id', '59b00000-0000-0000-0000-000000000001', 'quantity', 1))))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in Invoice creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009d1"}', true);
select is(
  (select tenant_id from public.app_create_invoice(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000942',
    'items', jsonb_build_array(jsonb_build_object('service_id', '59b00000-0000-0000-0000-000000000002', 'quantity', 1))))),
  'f0f0f0f0-0000-4000-8000-0000000009d1'::uuid,
  'a signed-in Invoice creation with the Tenant B selector lands in Tenant B'
);

select throws_ok(
  $$select public.app_create_invoice(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000942',
    'items', jsonb_build_array(jsonb_build_object('service_id', '59b00000-0000-0000-0000-000000000001', 'quantity', 1))))$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Tenant B Invoice created through app_create_invoice cannot bill a Wolf Forge Service'
);

select throws_ok(
  $$select public.app_create_invoice(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000941', 'items', '[]'::jsonb))$$,
  'P0002',
  null,
  'a Tenant B Invoice creation cannot bill a Wolf Forge Client (foreign company behaves as missing; the composite FK stays covered by the trusted-write tests)'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_invoice(gen_random_uuid(), jsonb_build_object(
    'company_id', '30000000-0000-0000-0000-000000000942', 'items', '[]'::jsonb))$$,
  '42501',
  null,
  'app_create_invoice with an invalid selector creates nothing'
);

select set_config('request.headers', '', true);
reset role;
-- Trusted writes below run without a signed-in user.
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.invoices
    where tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009d1'
      and id <> '59a00000-0000-0000-0000-000000000002'),
  1::bigint,
  'only the valid Tenant B Invoice was created; failed attempts left nothing behind'
);

-- -----------------------------------------------------------------------------
-- Cross-Tenant Invoice references are rejected even for trusted writes
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.invoices (tenant_id, company_id, created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000942',
      '20000000-0000-0000-0000-000000000941', '20000000-0000-0000-0000-000000000941')$$,
  '23503',
  'insert or update on table "invoices" violates foreign key constraint "invoices_company_id_fkey"',
  'a Wolf Forge Invoice cannot bill a Tenant B Client'
);

select throws_ok(
  $$insert into public.invoices (tenant_id, company_id, created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-0000000009d1', '30000000-0000-0000-0000-000000000941',
      '20000000-0000-0000-0000-000000000941', '20000000-0000-0000-0000-000000000941')$$,
  '23503',
  'insert or update on table "invoices" violates foreign key constraint "invoices_company_id_fkey"',
  'a Tenant B Invoice cannot bill a Wolf Forge Client'
);

select lives_ok(
  $$update public.invoices set client_profile_id = '20000000-0000-0000-0000-000000000943'
    where id = '59a00000-0000-0000-0000-000000000001'$$,
  'a Wolf Forge Invoice can name a Wolf Forge client person'
);

-- The client-consistency trigger runs before the composite key, so a person of
-- another Tenant is stopped there; the key (asserted above) is the backstop.
select throws_ok(
  $$update public.invoices set client_profile_id = '20000000-0000-0000-0000-000000000943'
    where id = '59a00000-0000-0000-0000-000000000002'$$,
  '23514',
  'invoice client profile must be an active client in the invoice company',
  'a Tenant B Invoice cannot name a Wolf Forge client person'
);

-- Two keys reject the move (Client and client person), so no message.
select throws_ok(
  $$update public.invoices set tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009d1'
    where id = '59a00000-0000-0000-0000-000000000001'$$,
  '23503',
  null,
  'an Invoice cannot be moved to another Tenant while it bills a Wolf Forge Client'
);

-- -----------------------------------------------------------------------------
-- Invoice items bill Orders and Services of the Invoice's Tenant only
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.invoice_items (invoice_id, service_id, position, name, quantity, unit_price_cents, fulfillment_status)
    values ('59a00000-0000-0000-0000-000000000002', '59b00000-0000-0000-0000-000000000001', 10, 'x', 1, 0, 'awaiting_payment')$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Tenant B Invoice item cannot bill a Wolf Forge Service'
);

select throws_ok(
  $$insert into public.invoice_items (invoice_id, service_id, position, name, quantity, unit_price_cents, fulfillment_status)
    values ('59a00000-0000-0000-0000-000000000001', '59b00000-0000-0000-0000-000000000002', 10, 'x', 1, 0, 'awaiting_payment')$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Wolf Forge Invoice item cannot bill a Tenant B Service'
);

select throws_ok(
  $$insert into public.invoice_items (invoice_id, service_id, order_id, position, name, quantity, unit_price_cents, fulfillment_status)
    values ('59a00000-0000-0000-0000-000000000002', '59b00000-0000-0000-0000-000000000002',
      '59b10000-0000-0000-0000-000000000001', 10, 'x', 1, 0, 'provisioned')$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Tenant B Invoice item cannot be provisioned by a Wolf Forge Order'
);

select throws_ok(
  $$insert into public.invoice_items (invoice_id, service_id, order_id, position, name, quantity, unit_price_cents, fulfillment_status)
    values ('59a00000-0000-0000-0000-000000000001', '59b00000-0000-0000-0000-000000000001',
      '59b10000-0000-0000-0000-000000000002', 10, 'x', 1, 0, 'provisioned')$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Wolf Forge Invoice item cannot be provisioned by a Tenant B Order'
);

select lives_ok(
  $$insert into public.invoice_items (invoice_id, service_id, position, name, quantity, unit_price_cents, fulfillment_status)
    values ('59a00000-0000-0000-0000-000000000002', '59b00000-0000-0000-0000-000000000002', 10, 'B item', 1, 0, 'awaiting_payment')$$,
  'a Tenant B Invoice item can bill a Tenant B Service'
);

select throws_ok(
  $$update public.invoice_items
    set order_id = '59b10000-0000-0000-0000-000000000001', fulfillment_status = 'provisioned'
    where name = 'B item'$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Tenant B Invoice item cannot later be provisioned by a Wolf Forge Order'
);

select lives_ok(
  $$update public.invoice_items
    set order_id = '59b10000-0000-0000-0000-000000000002', fulfillment_status = 'provisioned'
    where name = 'B item'$$,
  'a Tenant B Invoice item can be provisioned by a Tenant B Order'
);

select throws_ok(
  $$update public.invoice_items set invoice_id = '59a00000-0000-0000-0000-000000000001'
    where name = 'B item'$$,
  '23514',
  'invoice item must reference an order and service of the invoice''s tenant',
  'a Tenant B Invoice item cannot be moved onto a Wolf Forge Invoice'
);

select lives_ok(
  $$insert into public.invoice_items (invoice_id, position, name, quantity, unit_price_cents, fulfillment_status)
    values ('59a00000-0000-0000-0000-000000000002', 11, 'B free text', 1, 0, 'not_applicable')$$,
  'a free-text item without Order or Service is unaffected'
);

-- -----------------------------------------------------------------------------
-- Refunds and wallet ledger links stay on their own Invoice
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.invoice_refunds (invoice_id, invoice_payment_id, amount_cents, currency, reason,
      status, request_id, created_by_profile_id)
    values ('59a00000-0000-0000-0000-000000000002', '59a10000-0000-0000-0000-000000000001', 10, 'USD', 'x',
      'pending', gen_random_uuid(), '20000000-0000-0000-0000-000000000941')$$,
  '23503',
  'insert or update on table "invoice_refunds" violates foreign key constraint "invoice_refunds_invoice_payment_id_fkey"',
  'a Tenant B refund cannot cite a Wolf Forge payment'
);

select throws_ok(
  $$insert into public.invoice_refunds (invoice_id, invoice_payment_id, amount_cents, currency, reason,
      status, request_id, created_by_profile_id)
    values ('59a00000-0000-0000-0000-000000000001', '59a10000-0000-0000-0000-000000000002', 10, 'USD', 'x',
      'pending', gen_random_uuid(), '20000000-0000-0000-0000-000000000941')$$,
  '23503',
  'insert or update on table "invoice_refunds" violates foreign key constraint "invoice_refunds_invoice_payment_id_fkey"',
  'a Wolf Forge refund cannot cite a Tenant B payment'
);

select lives_ok(
  $$insert into public.invoice_refunds (invoice_id, invoice_payment_id, amount_cents, currency, reason,
      status, request_id, created_by_profile_id)
    values ('59a00000-0000-0000-0000-000000000002', '59a10000-0000-0000-0000-000000000002', 10, 'USD', 'B refund',
      'pending', gen_random_uuid(), '20000000-0000-0000-0000-000000000941')$$,
  'a Tenant B refund can cite its own Invoice''s payment'
);

select throws_ok(
  $$insert into public.company_wallet_transactions (company_id, request_id, actor_profile_id, amount_cents,
      balance_after_cents, source, invoice_id, invoice_payment_id)
    values ('30000000-0000-0000-0000-000000000942', gen_random_uuid(), '20000000-0000-0000-0000-000000000941',
      -100, 0, 'invoice_payment', '59a00000-0000-0000-0000-000000000001', '59a10000-0000-0000-0000-000000000001')$$,
  '23503',
  'insert or update on table "company_wallet_transactions" violates foreign key constraint "company_wallet_transactions_invoice_id_fkey"',
  'a Tenant B Client wallet entry cannot pay a Wolf Forge Invoice'
);

select throws_ok(
  $$insert into public.company_wallet_transactions (company_id, request_id, actor_profile_id, amount_cents,
      balance_after_cents, source, invoice_id, invoice_payment_id)
    values ('30000000-0000-0000-0000-000000000942', gen_random_uuid(), '20000000-0000-0000-0000-000000000941',
      -100, 0, 'invoice_payment', '59a00000-0000-0000-0000-000000000002', '59a10000-0000-0000-0000-000000000001')$$,
  '23503',
  'insert or update on table "company_wallet_transactions" violates foreign key constraint "company_wallet_transactions_invoice_payment_id_fkey"',
  'a Tenant B wallet entry cannot cite a Wolf Forge payment for its own Invoice'
);

select throws_ok(
  $$insert into public.company_wallet_transactions (company_id, request_id, actor_profile_id, amount_cents,
      balance_after_cents, source, invoice_id, invoice_payment_id)
    values ('30000000-0000-0000-0000-000000000941', gen_random_uuid(), '20000000-0000-0000-0000-000000000941',
      -100, 0, 'invoice_payment', '59a00000-0000-0000-0000-000000000001', '59a10000-0000-0000-0000-000000000003')$$,
  '23503',
  'insert or update on table "company_wallet_transactions" violates foreign key constraint "company_wallet_transactions_invoice_payment_id_fkey"',
  'a Wolf Forge wallet entry cannot cite a Tenant B payment for its own Invoice'
);

select throws_ok(
  $$insert into public.company_wallet_transactions (company_id, request_id, actor_profile_id, amount_cents,
      balance_after_cents, source, invoice_id, invoice_payment_id)
    values ('30000000-0000-0000-0000-000000000941', gen_random_uuid(), '20000000-0000-0000-0000-000000000941',
      -100, 0, 'invoice_payment', '59a00000-0000-0000-0000-000000000002', '59a10000-0000-0000-0000-000000000002')$$,
  '23503',
  'insert or update on table "company_wallet_transactions" violates foreign key constraint "company_wallet_transactions_invoice_id_fkey"',
  'a Wolf Forge Client wallet entry cannot pay a Tenant B Invoice'
);

select lives_ok(
  $$insert into public.company_wallet_transactions (company_id, request_id, actor_profile_id, amount_cents,
      balance_after_cents, source, invoice_id, invoice_payment_id)
    values ('30000000-0000-0000-0000-000000000942', gen_random_uuid(), '20000000-0000-0000-0000-000000000941',
      -100, 0, 'invoice_payment', '59a00000-0000-0000-0000-000000000002', '59a10000-0000-0000-0000-000000000002')$$,
  'a Tenant B Client wallet entry can pay its own Invoice'
);

-- -----------------------------------------------------------------------------
-- Deletion semantics keep ownership
-- -----------------------------------------------------------------------------

select throws_ok(
  $$delete from public.services where id = '59b00000-0000-0000-0000-000000000002'$$,
  '23503',
  null,
  'a Service billed on an Invoice of its Tenant cannot be deleted'
);

select is(
  (select tenant_id from public.invoices where id = '59a00000-0000-0000-0000-000000000002'),
  'f0f0f0f0-0000-4000-8000-0000000009d1'::uuid,
  'the Tenant B Invoice still belongs to Tenant B after the rejected writes'
);

select * from finish();
rollback;
