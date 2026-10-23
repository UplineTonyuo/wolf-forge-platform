begin;

select plan(11);

-- WL-1C.2a: every Form is owned by exactly one Tenant. Wolf Forge (WF) =
-- f0f0f0f0-0000-4000-8000-000000000001, Tenant B = f0f0f0f0-0000-4000-8000-0000000009c1.

select col_not_null('public', 'forms', 'tenant_id', 'forms.tenant_id is NOT NULL');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.forms'::regclass and conname = 'forms_tenant_id_fkey'),
  'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
  'forms.tenant_id references tenants(id) ON DELETE RESTRICT'
);

select is(
  (select column_default from information_schema.columns
   where table_schema='public' and table_name='forms' and column_name='tenant_id'),
  'private.identity_tenant_id()',
  'new Forms derive ownership from the trusted Tenant identity default'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 901 = owner U (internal in Wolf Forge and Tenant B).
insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000901', 'authenticated', 'authenticated', 'form-owner@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner')
where id = '20000000-0000-0000-0000-000000000901';

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-0000000009c1', 'form-tenant-b', 'Form Tenant B', 'active');

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
values ('f0f0f0f0-0000-4000-8000-0000000009c1', '20000000-0000-0000-0000-000000000901', 'internal',
  (select id from public.roles where name = 'owner'));

create function pg_temp.form_payload(p_key text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'form_type', 'contact',
    'canonical_key', p_key,
    'definition', jsonb_build_object(
      'name', 'Tenant Contact', 'title', 'Contact us', 'visibility', 'public',
      'type_config', jsonb_build_object(
        'subject_field_key', '59000000-0000-0000-0000-000000000001',
        'message_field_key', '59000000-0000-0000-0000-000000000002',
        'ticket_orchestration', 'deferred'
      ),
      'fields', jsonb_build_array(
        jsonb_build_object('stable_field_key', '59000000-0000-0000-0000-000000000001', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
        jsonb_build_object('stable_field_key', '59000000-0000-0000-0000-000000000002', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)
      ),
      'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
    )
  );
$$;
grant execute on function pg_temp.form_payload(text) to authenticated;

-- -----------------------------------------------------------------------------
-- tenant_id default through app_create_form
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000901';

select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_create_form(gen_random_uuid(), pg_temp.form_payload('tenant-form-wf'))),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'a signed-in Form creation without a selector lands in Wolf Forge'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009c1"}', true);
select is(
  (select tenant_id from public.app_create_form(gen_random_uuid(), pg_temp.form_payload('tenant-form-b'))),
  'f0f0f0f0-0000-4000-8000-0000000009c1'::uuid,
  'a signed-in Form creation with the Tenant B selector lands in Tenant B'
);

select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_create_form(gen_random_uuid(), pg_temp.form_payload('tenant-form-garbage'))$$,
  '42501',
  null,
  'app_create_form with an invalid selector creates nothing'
);

select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009ff"}', true);
select throws_ok(
  $$select public.app_create_form(gen_random_uuid(), pg_temp.form_payload('tenant-form-foreign'))$$,
  '42501',
  null,
  'app_create_form with a Tenant the caller does not belong to creates nothing'
);

select set_config('request.headers', '', true);
reset role;

-- The column default itself fails closed for a signed-in caller whose selector
-- resolves to no Tenant: it yields NULL, never Wolf Forge.
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000009ff"}', true);
select throws_ok(
  $$insert into public.forms (form_type, canonical_key, name, visibility, created_by_profile_id, updated_by_profile_id)
    values ('contact', 'tenant-form-default', 'Default', 'public',
      '20000000-0000-0000-0000-000000000901', '20000000-0000-0000-0000-000000000901')$$,
  '23502',
  null,
  'the tenant_id default yields NULL for an unresolvable selector instead of Wolf Forge'
);
select set_config('request.headers', '', true);
set local "request.jwt.claim.sub" = '';

select is(
  (select count(*) from public.forms where canonical_key in
    ('tenant-form-garbage', 'tenant-form-foreign', 'tenant-form-default')),
  0::bigint,
  'no Form was created by a failed selector'
);

-- service_role keeps its existing SELECT-only grant on forms.
set local role service_role;
select throws_ok(
  $$insert into public.forms (tenant_id, form_type, canonical_key, name, visibility, created_by_profile_id, updated_by_profile_id)
    values ('f0f0f0f0-0000-4000-8000-000000000001', 'contact', 'tenant-form-service', 'Service', 'public',
      '20000000-0000-0000-0000-000000000901', '20000000-0000-0000-0000-000000000901')$$,
  '42501',
  'permission denied for table forms',
  'service_role still cannot insert Forms directly'
);
reset role;

select ok(
  exists (select 1 from public.forms where canonical_key = 'tenant-form-b'
    and tenant_id = 'f0f0f0f0-0000-4000-8000-0000000009c1'),
  'the Tenant B Form exists inside this transaction'
);

select * from finish();
rollback;
