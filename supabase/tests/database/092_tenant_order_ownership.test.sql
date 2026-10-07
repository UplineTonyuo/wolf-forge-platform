begin;

select plan(39);

-- WL-1C.3: every Order (client-facing: Project) is owned by exactly one Tenant,
-- and its Client, assignee, linked Tickets and task assignees belong to that
-- Tenant. Wolf Forge (WF) = f0f0f0f0-0000-4000-8000-000000000001,
-- Tenant B = ...09e1, Tenant C = ...09e2.
--
-- Every profile has a Wolf Forge membership (WL-1A mirror), so "a person outside
-- Tenant A" can only be built with A <> Wolf Forge; Tenant C plays that role.

-- -----------------------------------------------------------------------------
-- Schema and backfill
-- -----------------------------------------------------------------------------

select has_column('public', 'orders', 'tenant_id', 'orders.tenant_id exists');
select col_not_null('public', 'orders', 'tenant_id', 'orders.tenant_id is NOT NULL');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_tenant_id_fkey'),
  'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
  'orders.tenant_id references tenants(id) ON DELETE RESTRICT'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_tenant_id_id_key'),
  'UNIQUE (tenant_id, id)',
  'orders has a UNIQUE (tenant_id, id) key for Tenant-safe references'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_company_id_fkey'),
  'FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE RESTRICT',
  'the Order Client reference is Tenant-relative'
);

-- SET NULL on the assignee column only: tenant_id must survive a profile delete.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_assigned_to_profile_id_fkey'),
  'FOREIGN KEY (tenant_id, assigned_to_profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE SET NULL (assigned_to_profile_id)',
  'the Order assignee reference is Tenant-membership-relative and unassigns on delete'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.tickets'::regclass and conname = 'tickets_order_id_fkey'),
  'FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id) ON DELETE RESTRICT',
  'the Ticket Order reference is Tenant-relative'
);

select is(
  (select count(*) from public.orders where tenant_id <> private.wolf_forge_tenant_id()),
  0::bigint,
  'every pre-existing Order was backfilled to the Wolf Forge Tenant'
);

select hasnt_column('public', 'order_tasks', 'tenant_id', 'order_tasks inherits its Tenant through order_id');
select hasnt_column('public', 'project_messages', 'tenant_id', 'project_messages inherits its Tenant through order_id');
select hasnt_column('public', 'project_attachments', 'tenant_id', 'project_attachments inherits its Tenant through order_id');
select hasnt_column('public', 'project_message_reactions', 'tenant_id', 'project_message_reactions inherits its Tenant through its message');

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 921 = owner U (internal in WF and B), 922 = owner V (internal in WF and C),
-- 923 = staff W (internal in WF only), 924 = staff X (client in B),
-- 925 = staff Y (archived internal in B), 926 = staff Z (archived profile).
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000921', 'authenticated', 'authenticated', 'ord-owner-b@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000922', 'authenticated', 'authenticated', 'ord-owner-c@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000923', 'authenticated', 'authenticated', 'ord-wf-staff@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000924', 'authenticated', 'authenticated', 'ord-b-client@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000925', 'authenticated', 'authenticated', 'ord-b-archived@example.invalid', now(), now()),
  ('20000000-0000-0000-0000-000000000926', 'authenticated', 'authenticated', 'ord-wf-archived@example.invalid', now(), now());

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-0000000009e1', 'ord-tenant-b', 'Order Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-0000000009e2', 'ord-tenant-c', 'Order Tenant C', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('30000000-0000-0000-0000-000000000921', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Order Client', 'client'),
  ('30000000-0000-0000-0000-000000000922', 'f0f0f0f0-0000-4000-8000-0000000009e1', 'B Order Client', 'client'),
  ('30000000-0000-0000-0000-000000000923', 'f0f0f0f0-0000-4000-8000-0000000009e2', 'C Order Client', 'client');

insert into public.services (id, tenant_id, name)
values
  ('59500000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001', 'WF Order Tenancy Service'),
  ('59500000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009e1', 'B Order Tenancy Service'),
  ('59500000-0000-0000-0000-000000000003', 'f0f0f0f0-0000-4000-8000-0000000009e2', 'C Order Tenancy Service');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000921', 'owner', null::timestamptz),
  ('20000000-0000-0000-0000-000000000922', 'owner', null),
  ('20000000-0000-0000-0000-000000000923', 'staff', null),
  ('20000000-0000-0000-0000-000000000924', 'staff', null),
  ('20000000-0000-0000-0000-000000000925', 'staff', null),
  ('20000000-0000-0000-0000-000000000926', 'staff', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-0000000009e1', '20000000-0000-0000-0000-000000000921', 'internal', 'owner',  null, null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-0000000009e2', '20000000-0000-0000-0000-000000000922', 'internal', 'owner',  null, null),
  ('f0f0f0f0-0000-4000-8000-0000000009e1', '20000000-0000-0000-0000-000000000924', 'client',   'client', '30000000-0000-0000-0000-000000000922', null),
  ('f0f0f0f0-0000-4000-8000-0000000009e1', '20000000-0000-0000-0000-000000000925', 'internal', 'staff',  null, now())
) as fixture(tenant_id, profile_id, account_class, role_name, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('59600000-0000-0000-0000-000000000001', 'f0f0f0f0-0000-4000-8000-000000000001',
   '30000000-0000-0000-0000-000000000921', '59500000-0000-0000-0000-000000000001', 'WF Order'),
  ('59600000-0000-0000-0000-000000000002', 'f0f0f0f0-0000-4000-8000-0000000009e1',
   '30000000-0000-0000-0000-000000000922', '59500000-0000-0000-0000-000000000002', 'B Order');

-- -----------------------------------------------------------------------------
-- Normal Order creation takes the caller's Tenant
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000921';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_order(gen_random_uuid(),
    '30000000-0000-0000-0000-000000000921', '59500000-0000-0000-0000-000000000001', 'WF created')),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in Order creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009e1"}', true);
select is(
  (select tenant_id from public.app_create_order(gen_random_uuid(),
    '30000000-0000-0000-0000-000000000922', '59500000-0000-0000-0000-000000000002', 'B created')),
  'f0f0f0f0-0000-4000-8000-0000000009e1'::uuid,
  'a signed-in Order creation with the Tenant B selector lands in Tenant B'
);

select throws_ok(
  $$select public.app_create_order(gen_random_uuid(),
    '30000000-0000-0000-0000-000000000921', '59500000-0000-0000-0000-000000000002', 'B created for WF Client')$$,
  '23503',
  'insert or update on table "orders" violates foreign key constraint "orders_company_id_fkey"',
  'a Tenant B Order created through app_create_order cannot name a Wolf Forge Client'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_order(gen_random_uuid(),
    '30000000-0000-0000-0000-000000000921', '59500000-0000-0000-0000-000000000001', 'Garbage selector')$$,
  '42501',
  null,
  'app_create_order with an invalid selector creates nothing'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009e2"}', true);
select throws_ok(
  $$select public.app_create_order(gen_random_uuid(),
    '30000000-0000-0000-0000-000000000923', '59500000-0000-0000-0000-000000000001', 'Foreign selector')$$,
  '42501',
  null,
  'app_create_order with a Tenant the caller does not belong to creates nothing'
);

select set_config('request.headers', '', true);
reset role;
-- Trusted writes below run without a signed-in user.
set local "request.jwt.claim.sub" = '';

-- New Orders take private.identity_tenant_id(), which yields NULL (never Wolf
-- Forge) for an unresolvable selector (088, 091). A signed-in direct insert is
-- stopped earlier by orders_enforce_permission, so assert the default itself.
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'tenant_id'),
  'private.identity_tenant_id()',
  'new Orders default to the caller''s resolved Tenant, not a fixed Wolf Forge default'
);

select is(
  (select count(*) from public.orders
    where title in ('B created for WF Client', 'Garbage selector', 'Foreign selector')),
  0::bigint,
  'no Order was created by a failed selector or a cross-Tenant Client'
);

-- -----------------------------------------------------------------------------
-- Cross-Tenant Order references are rejected even for trusted writes
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, title)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000922',
      '59500000-0000-0000-0000-000000000001', 'x')$$,
  '23503',
  'insert or update on table "orders" violates foreign key constraint "orders_company_id_fkey"',
  'a Wolf Forge Order cannot belong to a Tenant B Client'
);

select throws_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, title)
    values ('f0f0f0f0-0000-4000-8000-0000000009e1', '30000000-0000-0000-0000-000000000921',
      '59500000-0000-0000-0000-000000000002', 'x')$$,
  '23503',
  'insert or update on table "orders" violates foreign key constraint "orders_company_id_fkey"',
  'a Tenant B Order cannot belong to a Wolf Forge Client'
);

select throws_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, assigned_to_profile_id, title)
    values ('f0f0f0f0-0000-4000-8000-0000000009e2', '30000000-0000-0000-0000-000000000923',
      '59500000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000921', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant C Order cannot be assigned to a Tenant B-only staff member'
);

select throws_ok(
  $$insert into public.orders (tenant_id, company_id, service_id, assigned_to_profile_id, title)
    values ('f0f0f0f0-0000-4000-8000-0000000009e1', '30000000-0000-0000-0000-000000000922',
      '59500000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000922', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B Order cannot be assigned to a Tenant C-only staff member'
);

select lives_ok(
  $$update public.orders set assigned_to_profile_id = '20000000-0000-0000-0000-000000000921'
    where id = '59600000-0000-0000-0000-000000000002'$$,
  'a Tenant B Order can be assigned to a Tenant B internal member'
);

-- Both the Client and the Service key reject the move (093), so no message.
select throws_ok(
  $$update public.orders set tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009e1'
    where id = '59600000-0000-0000-0000-000000000001'$$,
  '23503',
  null,
  'an Order cannot be moved to another Tenant while it references a Wolf Forge Client'
);

-- -----------------------------------------------------------------------------
-- Tickets reference Orders of their own Tenant only
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, order_id, subject)
    values ('f0f0f0f0-0000-4000-8000-000000000001', '30000000-0000-0000-0000-000000000921',
      '59600000-0000-0000-0000-000000000002', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_order_id_fkey"',
  'a Wolf Forge Ticket cannot reference a Tenant B Order'
);

select throws_ok(
  $$insert into public.tickets (tenant_id, company_id, order_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009e1', '30000000-0000-0000-0000-000000000922',
      '59600000-0000-0000-0000-000000000001', 'x')$$,
  '23503',
  'insert or update on table "tickets" violates foreign key constraint "tickets_order_id_fkey"',
  'a Tenant B Ticket cannot reference a Wolf Forge Order'
);

select lives_ok(
  $$insert into public.tickets (tenant_id, company_id, order_id, subject)
    values ('f0f0f0f0-0000-4000-8000-0000000009e1', '30000000-0000-0000-0000-000000000922',
      '59600000-0000-0000-0000-000000000002', 'B fulfillment')$$,
  'a Tenant B Ticket can reference a Tenant B Order'
);

-- -----------------------------------------------------------------------------
-- Order task assignees are internal members of the Order's Tenant
-- -----------------------------------------------------------------------------

select lives_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000923', 'WF task')$$,
  'a Wolf Forge task can be assigned to Wolf Forge internal staff'
);

select throws_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000923', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B task cannot be assigned to Wolf Forge-only staff'
);

select lives_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000921', 'B task')$$,
  'a Tenant B task can be assigned to a Tenant B internal member'
);

select throws_ok(
  $$update public.order_tasks set assigned_to_profile_id = '20000000-0000-0000-0000-000000000922'
    where title = 'B task'$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B task cannot be reassigned to a Tenant C-only staff member'
);

-- 922-925 are active, globally internal profiles, so the global check passes
-- and only the Tenant check rejects them on Tenant B. Controls for 924 and 925:
select lives_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000924', 'WF task X'),
           ('59600000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000925', 'WF task Y')$$,
  'the same profiles are valid assignees on a Wolf Forge task'
);

select throws_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000924', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B task cannot be assigned to a Tenant B client membership'
);

select throws_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000925', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Tenant B task cannot be assigned to an archived Tenant B membership'
);

select lives_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000002', null, 'B unassigned task')$$,
  'a task may stay unassigned'
);

select throws_ok(
  $$insert into public.order_tasks (order_id, assigned_to_profile_id, title)
    values ('59600000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000926', 'x')$$,
  '23514',
  'assignee must be an active internal profile',
  'a Wolf Forge task still cannot be assigned to an archived profile'
);

-- A trusted re-parenting keeps the assignee, so the Tenant check runs on order_id.
set local role service_role;
select throws_ok(
  $$update public.order_tasks set order_id = '59600000-0000-0000-0000-000000000002'
    where title = 'WF task'$$,
  '23514',
  'assignee must be an active internal profile',
  'service_role cannot move a task under another Tenant''s Order with an incompatible assignee'
);
reset role;

select is(
  (select order_id from public.order_tasks where title = 'WF task'),
  '59600000-0000-0000-0000-000000000001'::uuid,
  'the rejected re-parenting left the task on its Wolf Forge Order'
);

select * from finish();
rollback;
