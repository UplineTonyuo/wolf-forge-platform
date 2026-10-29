begin;

select plan(76);
create temp table form_catalog_baseline as select count(*)::bigint total from public.services where tenant_id=private.wolf_forge_tenant_id();

-- -----------------------------------------------------------------------------
-- Structure, capabilities, and protected boundaries
-- -----------------------------------------------------------------------------

select ok(
  (select count(*) from information_schema.tables
   where table_schema = 'public' and table_name in (
     'forms', 'form_versions', 'form_version_fields', 'form_field_options',
     'form_rules', 'form_service_links', 'form_assignments',
     'form_submissions', 'form_submission_values', 'form_files'
   )) = 10,
  'one reusable Forms engine owns the coherent core schema'
);
select ok(
  to_regprocedure('public.app_create_form(uuid,jsonb)') is not null
  and to_regprocedure('public.app_publish_form(uuid,uuid)') is not null
  and to_regprocedure('public.app_assign_form(uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb)') is not null
  and to_regprocedure('public.app_correct_form_submission(uuid,uuid,jsonb)') is not null,
  'transactional Forms RPC boundaries exist'
);
select is(
  (select count(*) from public.permissions where permission_key in (
    'forms.view', 'forms.manage', 'forms.publish', 'forms.assign',
    'forms.submissions_view', 'forms.submissions_manage'
  )),
  6::bigint,
  'Forms capabilities are granular and registered'
);
select ok(
  not has_table_privilege('authenticated', 'public.forms', 'INSERT')
  and not has_table_privilege('authenticated', 'public.form_versions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.form_submissions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.form_submission_values', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.form_files', 'INSERT'),
  'protected Forms tables cannot be directly mutated'
);
select ok(
  not has_function_privilege('anon', 'public.app_create_form(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_publish_form(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.app_get_published_form_schema(text)', 'EXECUTE')
  and has_function_privilege('anon', 'public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'),
  'anonymous access is limited to explicit safe public Form boundaries'
);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('2b000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'forms-owner@example.invalid', now(), now()),
  ('2b000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'forms-staff@example.invalid', now(), now()),
  ('1b000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'forms-client-a@example.invalid', now(), now()),
  ('1b000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'forms-client-b@example.invalid', now(), now()),
  ('1b000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'forms-client-a-sibling@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner'), display_name = 'Forms Owner'
where id = '2b000000-0000-0000-0000-000000000001';
update public.profiles
set role_id = (select id from public.roles where name = 'staff'), display_name = 'Forms Staff'
where id = '2b000000-0000-0000-0000-000000000002';

insert into public.companies (id, name, status)
values
  ('3b000000-0000-0000-0000-000000000001', 'Forms Client A', 'client'),
  ('3b000000-0000-0000-0000-000000000002', 'Forms Client B', 'client');

update public.profiles
set company_id = case id
  when '1b000000-0000-0000-0000-000000000001' then '3b000000-0000-0000-0000-000000000001'::uuid
  when '1b000000-0000-0000-0000-000000000003' then '3b000000-0000-0000-0000-000000000001'::uuid
  else '3b000000-0000-0000-0000-000000000002'::uuid
end
where id in (
  '1b000000-0000-0000-0000-000000000001',
  '1b000000-0000-0000-0000-000000000002',
  '1b000000-0000-0000-0000-000000000003'
);

create temporary table form_test_ids (label text primary key, id uuid not null);
grant select, insert, update on form_test_ids to authenticated, anon;
grant select on form_test_ids to service_role;

create temporary table form_test_services as
select id, name, currency, price, row_number() over (order by id) as ordinal
from public.services
where is_active and archived_at is null
order by id
limit 2;
grant select on form_test_services to authenticated, anon;

insert into public.orders (
  id, company_id, service_id, title, status, priority
) values
  ('4b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000001', (select id from form_test_services where ordinal = 1), 'Forms Intake Project A', 'pending', 'normal'),
  ('4b000000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000002', (select id from form_test_services where ordinal = 2), 'Forms Intake Project B', 'pending', 'normal');

create function pg_temp.order_definition(p_detail_label text default 'Project details')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Public Order Form',
    'title', 'Configure your request',
    'information_html', '<p>Choose a service and tell us what you need.</p>',
    'visibility', 'public',
    'type_config', jsonb_build_object(
      'coupon_enabled', true,
      'payment_methods', jsonb_build_array('manual'),
      'checkout_orchestration', 'deferred'
    ),
    'fields', jsonb_build_array(
      jsonb_build_object(
        'stable_field_key', '51000000-0000-0000-0000-000000000001',
        'sort_order', 0, 'field_type', 'email', 'label', 'Email', 'required', true
      ),
      jsonb_build_object(
        'stable_field_key', '51000000-0000-0000-0000-000000000002',
        'sort_order', 1, 'field_type', 'data-dropdown', 'label', 'Request type', 'required', true,
        'options', jsonb_build_array(
          jsonb_build_object('stable_option_key', '52000000-0000-0000-0000-000000000001', 'option_value', 'custom', 'label', 'Custom', 'sort_order', 0),
          jsonb_build_object('stable_option_key', '52000000-0000-0000-0000-000000000002', 'option_value', 'standard', 'label', 'Standard', 'sort_order', 1)
        )
      ),
      jsonb_build_object(
        'stable_field_key', '51000000-0000-0000-0000-000000000003',
        'sort_order', 2, 'field_type', 'textarea', 'label', p_detail_label, 'required', true
      ),
      jsonb_build_object(
        'stable_field_key', '51000000-0000-0000-0000-000000000004',
        'sort_order', 3, 'field_type', 'secret', 'label', 'Credential handoff',
        'required', false, 'settings', jsonb_build_object('collection_mode', 'disabled')
      ),
      jsonb_build_object(
        'stable_field_key', '51000000-0000-0000-0000-000000000005',
        'sort_order', 4, 'field_type', 'html', 'label', 'Information',
        'settings', jsonb_build_object('html', '<p>No scripts are permitted.</p>')
      ),
      jsonb_build_object(
        'stable_field_key', '51000000-0000-0000-0000-000000000006',
        'sort_order', 5, 'field_type', 'optgroup', 'label', 'Service', 'required', false,
        'service_links', jsonb_build_array(jsonb_build_object(
          'service_id', (select id from form_test_services where ordinal = 1),
          'role', 'offered_item', 'sort_order', 0
        ))
      )
    ),
    'rules', jsonb_build_array(jsonb_build_object(
      'rule_key', '53000000-0000-0000-0000-000000000001',
      'sort_order', 0,
      'conditions', jsonb_build_array(jsonb_build_object(
        'field_key', '51000000-0000-0000-0000-000000000002',
        'comparator', 'equals',
        'value', '52000000-0000-0000-0000-000000000001'
      )),
      'action', 'show',
      'target_field_keys', jsonb_build_array('51000000-0000-0000-0000-000000000003')
    )),
    'service_links', '[]'::jsonb
  );
$$;

create function pg_temp.order_values(
  p_option uuid default '52000000-0000-0000-0000-000000000001',
  p_include_detail boolean default true
)
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('field_key', '51000000-0000-0000-0000-000000000001', 'value', 'client@example.invalid'),
    jsonb_build_object('field_key', '51000000-0000-0000-0000-000000000002', 'value', p_option)
  ) || case when p_include_detail then jsonb_build_array(
    jsonb_build_object('field_key', '51000000-0000-0000-0000-000000000003', 'value', 'Need a technically precise implementation.')
  ) else '[]'::jsonb end;
$$;

create function pg_temp.intake_definition()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Service Intake', 'title', 'Project intake', 'visibility', 'assigned',
    'type_config', jsonb_build_object('completion_status', 'submitted'),
    'fields', jsonb_build_array(jsonb_build_object(
      'stable_field_key', '54000000-0000-0000-0000-000000000001',
      'sort_order', 0, 'field_type', 'textarea', 'label', 'Project brief', 'required', true
    )),
    'rules', '[]'::jsonb,
    'service_links', jsonb_build_array(jsonb_build_object(
      'service_id', (select id from form_test_services where ordinal = 1),
      'role', 'intake_assignment', 'sort_order', 0
    ))
  );
$$;

create function pg_temp.onboarding_definition()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Client Onboarding', 'title', 'Brand onboarding', 'visibility', 'assigned',
    'type_config', jsonb_build_object('reuse_policy', 'company_profile'),
    'fields', jsonb_build_array(jsonb_build_object(
      'stable_field_key', '55000000-0000-0000-0000-000000000001',
      'sort_order', 0, 'field_type', 'text', 'label', 'Brand name', 'required', true
    )),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
  );
$$;

create function pg_temp.contact_definition()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'name', 'Private Contact', 'title', 'Contact support', 'visibility', 'authenticated',
    'type_config', jsonb_build_object(
      'subject_field_key', '56000000-0000-0000-0000-000000000001',
      'message_field_key', '56000000-0000-0000-0000-000000000002',
      'ticket_orchestration', 'deferred'
    ),
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', '56000000-0000-0000-0000-000000000001', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', '56000000-0000-0000-0000-000000000002', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)
    ),
    'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
  );
$$;

grant execute on function pg_temp.order_definition(text) to authenticated;
grant execute on function pg_temp.order_values(uuid,boolean) to authenticated, anon;
grant execute on function pg_temp.intake_definition() to authenticated;
grant execute on function pg_temp.onboarding_definition() to authenticated;
grant execute on function pg_temp.contact_definition() to authenticated;

-- -----------------------------------------------------------------------------
-- Create draft, authorization, Version 1, validation, and public safety
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.app_create_form(
    '60000000-0000-0000-0000-000000000001',
    jsonb_build_object('form_type', 'order', 'canonical_key', 'staff-form', 'definition', pg_temp.order_definition())
  )$$,
  '42501', 'permission denied: forms.manage',
  'unauthorized staff cannot manage Forms'
);

set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into form_test_ids values (
    'order-form',
    (public.app_create_form(
      '60000000-0000-0000-0000-000000000002',
      jsonb_build_object('form_type', 'order', 'canonical_key', 'public-order', 'definition', pg_temp.order_definition())
    )).id
  )$$,
  'authorized owner creates one draft Form'
);
reset role;

select ok(
  (select status = 'draft' and published_version_id is null and current_draft_version_id is not null
   from public.forms where id = (select id from form_test_ids where label = 'order-form')),
  'new Form has one editable draft and no published version'
);
select is(
  (select count(*) from public.form_versions where form_id = (select id from form_test_ids where label = 'order-form') and lifecycle_state = 'draft'),
  1::bigint,
  'exactly one editable draft exists'
);
select is(
  (select actor_profile_id from public.activity_events
   where entity_type = 'form' and entity_id = (select id from form_test_ids where label = 'order-form') and action = 'form.created'),
  '2b000000-0000-0000-0000-000000000001'::uuid,
  'Form actor identity is derived from auth.uid()'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.app_publish_form('60000000-0000-0000-0000-000000000003', (select id from form_test_ids where label = 'order-form'))$$,
  '42501', 'permission denied: forms.publish',
  'unauthorized staff cannot publish Forms'
);
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into form_test_ids values (
    'order-v1',
    (public.app_publish_form(
      '60000000-0000-0000-0000-000000000004',
      (select id from form_test_ids where label = 'order-form')
    )).id
  )$$,
  'owner atomically publishes Version 1'
);
reset role;

select ok(
  (select lifecycle_state = 'published' and version_number = 1 and schema_hash is not null
   from public.form_versions where id = (select id from form_test_ids where label = 'order-v1'))
  and (select status = 'published' and published_version_id = (select id from form_test_ids where label = 'order-v1')
       from public.forms where id = (select id from form_test_ids where label = 'order-form')),
  'Version 1 is an immutable published snapshot'
);
select is(
  (select count(*) from public.form_versions where form_id = (select id from form_test_ids where label = 'order-form') and lifecycle_state = 'draft'),
  1::bigint,
  'publishing immediately creates exactly one separate editable next draft'
);
select is(
  (select service_name_snapshot from public.form_service_links
   where form_version_id = (select id from form_test_ids where label = 'order-v1')),
  (select name from form_test_services where ordinal = 1),
  'published Service link carries a historically explainable name snapshot'
);

set local role service_role;
set local "request.jwt.claim.sub" = '';
select ok(
  (public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001', 'public-order') ->> 'form_version_id')::uuid
    = (select id from form_test_ids where label = 'order-v1')
  and jsonb_array_length(public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001', 'public-order') -> 'fields') = 6,
  'trusted public Form read exposes only its safe published schema'
);
set local role anon;
select throws_ok(
  $$select public.app_submit_form(
    '61000000-0000-0000-0000-000000000001',
    (select id from form_test_ids where label = 'order-v1'),
    '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'field_key', '51000000-0000-0000-0000-000000000002',
      'value', '52000000-0000-0000-0000-000000000001'
    )),
    '[]'::jsonb
  )$$,
  '23514', 'required Form field is missing',
  'required fields are enforced server-side'
);
select throws_ok(
  $$select public.app_submit_form(
    '61000000-0000-0000-0000-000000000002',
    (select id from form_test_ids where label = 'order-v1'), '{}',
    pg_temp.order_values('52999999-0000-0000-0000-000000000099', true), '[]'
  )$$,
  '22023', 'invalid Form option ID',
  'invalid option IDs are rejected'
);
select throws_ok(
  $$select public.app_submit_form(
    '61000000-0000-0000-0000-000000000003',
    (select id from form_test_ids where label = 'order-v1'), '{}',
    pg_temp.order_values('52000000-0000-0000-0000-000000000002', true), '[]'
  )$$,
  '22023', 'hidden Form fields cannot be submitted',
  'authoritative conditional hide state rejects a hidden answer'
);
select throws_ok(
  $$select public.app_submit_form(
    '61000000-0000-0000-0000-000000000004',
    (select id from form_test_ids where label = 'order-v1'), '{}',
    pg_temp.order_values('52000000-0000-0000-0000-000000000001', false), '[]'
  )$$,
  '23514', 'required Form field is missing',
  'a conditionally shown required field is enforced'
);
select throws_ok(
  $$select public.app_submit_form(
    '61000000-0000-0000-0000-000000000005',
    (select id from form_test_ids where label = 'order-v1'), '{}',
    pg_temp.order_values() || jsonb_build_array(jsonb_build_object(
      'field_key', '51000000-0000-0000-0000-000000000004', 'value', 'do-not-store'
    )), '[]'
  )$$,
  '55000', 'credential-like Form values require a dedicated encrypted storage boundary',
  'Secret text cannot be stored without an encrypted credential boundary'
);
select throws_ok(
  $$select public.app_submit_form(
    '61000000-0000-0000-0000-000000000006',
    (select id from form_test_ids where label = 'order-v1'), '{}',
    pg_temp.order_values(), jsonb_build_array(jsonb_build_object('storage_object_key', 'spoofed'))
  )$$,
  '55000', 'Form file upload storage boundary is not available',
  'file references cannot be spoofed before a trusted Storage boundary exists'
);

select lives_ok(
  $$insert into form_test_ids values (
    'order-submission-v1',
    (public.app_submit_form(
      '61000000-0000-0000-0000-000000000007',
      (select id from form_test_ids where label = 'order-v1'), '{}',
      pg_temp.order_values(), '[]'
    )).id
  )$$,
  'valid conditional Form submission succeeds atomically'
);
select is(
  (public.app_submit_form(
    '61000000-0000-0000-0000-000000000007',
    (select id from form_test_ids where label = 'order-v1'), '{}',
    pg_temp.order_values(), '[]'
  )).id,
  (select id from form_test_ids where label = 'order-submission-v1'),
  'duplicate request ID returns the same submission'
);
reset role;

select is(
  (select count(*) from public.form_submissions where form_id = (select id from form_test_ids where label = 'order-form')),
  1::bigint,
  'idempotent retry creates exactly one submission'
);
select ok(
  (select orchestration_type = 'order_checkout' and orchestration_status = 'deferred'
   from public.form_submissions where id = (select id from form_test_ids where label = 'order-submission-v1'))
  and not exists (select 1 from public.invoices where created_at >= (select submitted_at from public.form_submissions where id = (select id from form_test_ids where label = 'order-submission-v1')))
  and not exists (select 1 from public.subscriptions where created_at >= (select submitted_at from public.form_submissions where id = (select id from form_test_ids where label = 'order-submission-v1'))),
  'Order Form submission records configuration provenance without fake Invoice or Subscription execution'
);

-- -----------------------------------------------------------------------------
-- Draft separation, Version 2, stable keys, immutable history, corrections
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.app_update_form_draft(
    '62000000-0000-0000-0000-000000000001',
    (select id from form_test_ids where label = 'order-form'),
    pg_temp.order_definition('Revised project details')
  )$$,
  'draft can change after Version 1 is published'
);
reset role;
select is(
  (select label from public.form_version_fields
   where form_version_id = (select id from form_test_ids where label = 'order-v1')
     and stable_field_key = '51000000-0000-0000-0000-000000000003'),
  'Project details',
  'draft edit leaves published Version 1 unchanged'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into form_test_ids values (
    'order-v2',
    (public.app_publish_form(
      '62000000-0000-0000-0000-000000000002',
      (select id from form_test_ids where label = 'order-form')
    )).id
  )$$,
  'owner publishes Version 2'
);
reset role;
select ok(
  (select version_number = 2 and lifecycle_state = 'published' from public.form_versions where id = (select id from form_test_ids where label = 'order-v2'))
  and (select label = 'Revised project details' from public.form_version_fields
       where form_version_id = (select id from form_test_ids where label = 'order-v2')
         and stable_field_key = '51000000-0000-0000-0000-000000000003'),
  'Version 2 contains the revised draft snapshot'
);
select is(
  (select count(distinct stable_field_key) from public.form_version_fields
   where form_version_id in ((select id from form_test_ids where label = 'order-v1'), (select id from form_test_ids where label = 'order-v2'))),
  6::bigint,
  'stable field keys survive versioning'
);
select is(
  (select form_version_id from public.form_submissions where id = (select id from form_test_ids where label = 'order-submission-v1')),
  (select id from form_test_ids where label = 'order-v1'),
  'historical submission remains bound to exact Version 1'
);
select throws_ok(
  $$update public.form_version_fields set label = 'Tampered'
    where form_version_id = (select id from form_test_ids where label = 'order-v1')
      and stable_field_key = '51000000-0000-0000-0000-000000000003'$$,
  '55000', 'published Form definition children are immutable',
  'published fields cannot be directly rewritten'
);
select throws_ok(
  $$update public.form_submission_values set value = '"tampered"'::jsonb
    where submission_id = (select id from form_test_ids where label = 'order-submission-v1')$$,
  '55000', 'Form submission history is append-only',
  'original submitted answers cannot be destructively rewritten'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into form_test_ids values (
    'order-correction',
    (public.app_correct_form_submission(
      '62000000-0000-0000-0000-000000000003',
      (select id from form_test_ids where label = 'order-submission-v1'),
      pg_temp.order_values()
    )).id
  )$$,
  'staff correction is appended as a new submission revision'
);
reset role;
select ok(
  (select revision_number = 2
     and supersedes_submission_id = (select id from form_test_ids where label = 'order-submission-v1')
   from public.form_submissions where id = (select id from form_test_ids where label = 'order-correction'))
  and (select revision_number = 1 and supersedes_submission_id is null
       from public.form_submissions where id = (select id from form_test_ids where label = 'order-submission-v1')),
  'correction preserves the recoverable original and audits revision lineage'
);

-- -----------------------------------------------------------------------------
-- Contact orchestration boundary and private/public access
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
insert into form_test_ids values (
  'contact-form',
  (public.app_create_form(
    '63000000-0000-0000-0000-000000000001',
    jsonb_build_object('form_type', 'contact', 'canonical_key', 'private-contact', 'definition', pg_temp.contact_definition())
  )).id
);
insert into form_test_ids values (
  'contact-v1',
  (public.app_publish_form('63000000-0000-0000-0000-000000000002', (select id from form_test_ids where label = 'contact-form'))).id
);
reset role;

set local role anon;
set local "request.jwt.claim.sub" = '';
select throws_ok(
  $$select public.app_get_published_form_schema('private-contact')$$,
  '42501', null,
  'anonymous cannot access a private authenticated Form'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into form_test_ids values (
    'contact-submission',
    (public.app_submit_form(
      '63000000-0000-0000-0000-000000000003',
      (select id from form_test_ids where label = 'contact-v1'),
      jsonb_build_object('company_id', '3b000000-0000-0000-0000-000000000001'),
      jsonb_build_array(
        jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000001', 'value', 'Need help'),
        jsonb_build_object('field_key', '56000000-0000-0000-0000-000000000002', 'value', 'Please review this request.')
      ), '[]'
    )).id
  )$$,
  'authenticated client submits a private Contact Form'
);
reset role;
select ok(
  (select orchestration_type = 'contact_ticket' and orchestration_status = 'completed'
   from public.form_submissions where id = (select id from form_test_ids where label = 'contact-submission')),
  'Contact submission completes through the transactional Ticket orchestration boundary'
);

-- -----------------------------------------------------------------------------
-- Intake assignment and authoritative Order/company scope
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
insert into form_test_ids values (
  'intake-form',
  (public.app_create_form(
    '64000000-0000-0000-0000-000000000001',
    jsonb_build_object('form_type', 'intake', 'canonical_key', 'service-intake', 'definition', pg_temp.intake_definition())
  )).id
);
insert into form_test_ids values (
  'intake-v1',
  (public.app_publish_form('64000000-0000-0000-0000-000000000002', (select id from form_test_ids where label = 'intake-form'))).id
);
select lives_ok(
  $$insert into form_test_ids values (
    'intake-assignment-a',
    (public.app_assign_form(
      '64000000-0000-0000-0000-000000000003',
      (select id from form_test_ids where label = 'intake-form'),
      jsonb_build_object('order_id', '4b000000-0000-0000-0000-000000000001', 'client_profile_id', '1b000000-0000-0000-0000-000000000001', 'required', true)
    )).id
  )$$,
  'Intake Form assigns to an authoritative Order with a linked Service'
);
select throws_ok(
  $$select public.app_assign_form(
    '64000000-0000-0000-0000-000000000004',
    (select id from form_test_ids where label = 'intake-form'),
    jsonb_build_object('order_id', '4b000000-0000-0000-0000-000000000002', 'client_profile_id', '1b000000-0000-0000-0000-000000000001')
  )$$,
  '23514', 'Intake Form is not linked to the Order Service',
  'Intake assignment refuses an Order whose Service is not linked'
);
reset role;

select ok(
  (select company_id = '3b000000-0000-0000-0000-000000000001'
     and order_id = '4b000000-0000-0000-0000-000000000001'
     and form_version_id = (select id from form_test_ids where label = 'intake-v1')
   from public.form_assignments where id = (select id from form_test_ids where label = 'intake-assignment-a')),
  'Intake assignment derives company and exact published version from authoritative context'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.app_submit_form(
    '64000000-0000-0000-0000-000000000005',
    (select id from form_test_ids where label = 'intake-v1'),
    jsonb_build_object('assignment_id', (select id from form_test_ids where label = 'intake-assignment-a')),
    jsonb_build_array(jsonb_build_object('field_key', '54000000-0000-0000-0000-000000000001', 'value', 'Cross-company attempt')),
    '[]'
  )$$,
  '42501', 'Form assignment access is denied',
  'Client B cannot submit Client A Intake assignment'
);

set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_submit_form(
    '64000000-0000-0000-0000-000000000006',
    (select id from form_test_ids where label = 'intake-v1'),
    jsonb_build_object(
      'assignment_id', (select id from form_test_ids where label = 'intake-assignment-a'),
      'order_id', '4b000000-0000-0000-0000-000000000002'
    ),
    jsonb_build_array(jsonb_build_object('field_key', '54000000-0000-0000-0000-000000000001', 'value', 'Spoofed context')),
    '[]'
  )$$,
  '42501', 'Form Order context cannot be spoofed',
  'an assigned client cannot spoof a different Project context'
);
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into form_test_ids values (
    'intake-submission-a',
    (public.app_submit_form(
      '64000000-0000-0000-0000-000000000007',
      (select id from form_test_ids where label = 'intake-v1'),
      jsonb_build_object('assignment_id', (select id from form_test_ids where label = 'intake-assignment-a')),
      jsonb_build_array(jsonb_build_object('field_key', '54000000-0000-0000-0000-000000000001', 'value', 'Authoritative project brief')),
      '[]'
    )).id
  )$$,
  'authorized internal owner submits assigned Intake in the correct Order scope'
);
reset role;
select ok(
  (select company_id = '3b000000-0000-0000-0000-000000000001'
     and order_id = '4b000000-0000-0000-0000-000000000001'
   from public.form_submissions where id = (select id from form_test_ids where label = 'intake-submission-a'))
  and (select status = 'completed' and latest_submission_id = (select id from form_test_ids where label = 'intake-submission-a')
       from public.form_assignments where id = (select id from form_test_ids where label = 'intake-assignment-a')),
  'Intake submission atomically preserves authoritative context and completes assignment'
);

-- -----------------------------------------------------------------------------
-- Onboarding assignment, company isolation, and safe submission reads
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
insert into form_test_ids values (
  'onboarding-form',
  (public.app_create_form(
    '65000000-0000-0000-0000-000000000001',
    jsonb_build_object('form_type', 'onboarding', 'canonical_key', 'client-onboarding', 'definition', pg_temp.onboarding_definition())
  )).id
);
insert into form_test_ids values (
  'onboarding-v1',
  (public.app_publish_form('65000000-0000-0000-0000-000000000002', (select id from form_test_ids where label = 'onboarding-form'))).id
);
insert into form_test_ids values (
  'onboarding-assignment-a',
  (public.app_assign_form(
    '65000000-0000-0000-0000-000000000003',
    (select id from form_test_ids where label = 'onboarding-form'),
    jsonb_build_object('client_profile_id', '1b000000-0000-0000-0000-000000000001', 'required', true)
  )).id
);
reset role;
select ok(
  (select client_profile_id = '1b000000-0000-0000-0000-000000000001'
     and company_id = '3b000000-0000-0000-0000-000000000001'
     and order_id is null
   from public.form_assignments where id = (select id from form_test_ids where label = 'onboarding-assignment-a')),
  'Onboarding assignment derives the authoritative client company'
);
select ok(
  (select count(*) from public.notifications
   where recipient_profile_id = '1b000000-0000-0000-0000-000000000001'
     and event_key = 'client-form-assigned:' || (select id::text from form_test_ids where label = 'onboarding-assignment-a')) = 1
  and (select count(*) from public.notifications
       where recipient_profile_id = '1b000000-0000-0000-0000-000000000003'
         and entity_id = (select id from form_test_ids where label = 'onboarding-assignment-a')) = 0,
  'Form assignment notification targets only the authorized assignee profile'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000003';
select is(
  (select count(*) from public.form_assignments),
  0::bigint,
  'same-company sibling cannot read another profile assignment through RLS'
);
select is(
  (select count(*) from public.app_list_assigned_forms()),
  0::bigint,
  'same-company sibling assignment list excludes another profile Forms'
);
select throws_ok(
  $$select public.app_get_assigned_form_schema((select id from form_test_ids where label = 'onboarding-assignment-a'))$$,
  '42501', 'Form assignment access is denied',
  'same-company sibling cannot read another profile assigned Form schema'
);
select throws_ok(
  $$select public.app_get_published_form_schema('client-onboarding')$$,
  '42501', 'Form assignment access is denied',
  'same-company sibling cannot bypass assignee isolation through canonical schema lookup'
);
select throws_ok(
  $$select public.app_submit_form(
    '65000000-0000-0000-0000-000000000050',
    (select id from form_test_ids where label = 'onboarding-v1'),
    jsonb_build_object('assignment_id', (select id from form_test_ids where label = 'onboarding-assignment-a')),
    jsonb_build_array(jsonb_build_object('field_key', '55000000-0000-0000-0000-000000000001', 'value', 'Sibling impersonation')),
    '[]'
  )$$,
  '42501', 'Form assignment access is denied',
  'same-company sibling cannot submit another profile assignment by direct RPC'
);

reset role;
insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('1b000000-0000-0000-0000-000000000003', 'forms.view', false);
set local role authenticated;
set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000003';
select throws_ok(
  $$select * from public.app_list_assigned_forms()$$,
  '42501', 'permission denied: forms.view',
  'client denied portal_forms cannot invoke the Forms list RPC directly'
);
reset role;
delete from public.profile_permission_overrides
where profile_id = '1b000000-0000-0000-0000-000000000003'
  and permission_key = 'forms.view';

set local role authenticated;
set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000002';
select is(
  (select count(*) from public.app_list_assigned_forms()),
  0::bigint,
  'Client B assignment read model excludes Client A Forms'
);
select throws_ok(
  $$select public.app_get_published_form_schema('client-onboarding')$$,
  '42501', 'Form assignment access is denied',
  'Client B cannot read Client A assigned Onboarding Form'
);

set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.app_list_assigned_forms()
   where assignment_id = (select id from form_test_ids where label = 'onboarding-assignment-a')),
  1::bigint,
  'Client A sees its own safe assigned Forms summary'
);
select is(
  public.app_get_assigned_form_schema((select id from form_test_ids where label = 'onboarding-assignment-a'))
    #>> '{schema,form_version_id}',
  (select id::text from form_test_ids where label = 'onboarding-v1'),
  'assigned Form detail is pinned to its exact immutable version'
);
select ok(
  (public.app_get_published_form_schema('client-onboarding') ->> 'form_version_id')::uuid
    = (select id from form_test_ids where label = 'onboarding-v1'),
  'Client A can read its assigned Onboarding schema'
);
select lives_ok(
  $$insert into form_test_ids values (
    'onboarding-submission-a',
    (public.app_submit_form(
      '65000000-0000-0000-0000-000000000004',
      (select id from form_test_ids where label = 'onboarding-v1'),
      jsonb_build_object('assignment_id', (select id from form_test_ids where label = 'onboarding-assignment-a')),
      jsonb_build_array(jsonb_build_object('field_key', '55000000-0000-0000-0000-000000000001', 'value', 'Wolf Forge Client A')),
      '[]'
    )).id
  )$$,
  'Client A submits assigned Onboarding Form'
);
select ok(
  jsonb_array_length(public.app_get_form_submission((select id from form_test_ids where label = 'onboarding-submission-a')) -> 'values') = 1,
  'Client A can read its safe non-secret submission projection'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000003';
select is(
  (select count(*) from public.form_submissions),
  0::bigint,
  'same-company sibling cannot read another profile completed submission through RLS'
);
select throws_ok(
  $$select public.app_get_form_submission((select id from form_test_ids where label = 'onboarding-submission-a'))$$,
  '42501', 'Form submission access is denied',
  'same-company sibling cannot read another profile completed submission'
);
select throws_ok(
  $$select public.app_submit_form(
    '65000000-0000-0000-0000-000000000051',
    (select id from form_test_ids where label = 'onboarding-v1'),
    jsonb_build_object('assignment_id', (select id from form_test_ids where label = 'onboarding-assignment-a')),
    jsonb_build_array(jsonb_build_object('field_key', '55000000-0000-0000-0000-000000000001', 'value', 'Completed sibling impersonation')),
    '[]'
  )$$,
  '42501', 'Form assignment access is denied',
  'completed assignment cannot be impersonated by a same-company sibling profile'
);

set local "request.jwt.claim.sub" = '1b000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.app_get_assigned_form_schema((select id from form_test_ids where label = 'onboarding-assignment-a'))$$,
  '42501', 'Form assignment access is denied',
  'Client B cannot read Client A exact assigned Form schema'
);
select throws_ok(
  $$select public.app_get_form_submission((select id from form_test_ids where label = 'onboarding-submission-a'))$$,
  '42501', 'Form submission access is denied',
  'Client B cannot read Client A submission'
);
select is(
  (select count(*) from public.form_submission_values),
  0::bigint,
  'clients cannot directly read protected answer rows, including secret-capable data'
);
reset role;

-- -----------------------------------------------------------------------------
-- Archive, custom HTML, and final regressions
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '2b000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_form(
    '66000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'form_type', 'order', 'canonical_key', 'unsafe-html',
      'definition', pg_temp.order_definition() || jsonb_build_object('information_html', '<script>alert(1)</script>')
    )
  )$$,
  '22023', 'invalid Form draft metadata',
  'unsafe executable custom HTML is rejected'
);
select lives_ok(
  $$select public.app_archive_form(
    '66000000-0000-0000-0000-000000000002',
    (select id from form_test_ids where label = 'order-form')
  )$$,
  'published Form archives without deleting history'
);
reset role;

select is(
  (select count(*) from public.form_versions where form_id = (select id from form_test_ids where label = 'order-form')),
  3::bigint,
  'archiving retains published and draft version history'
);
select is(
  (select count(*) from public.form_submissions where form_id = (select id from form_test_ids where label = 'order-form')),
  2::bigint,
  'archiving retains original and correction submission history'
);
set local role anon;
set local "request.jwt.claim.sub" = '';
select throws_ok(
  $$select public.app_submit_form(
    '66000000-0000-0000-0000-000000000003',
    (select id from form_test_ids where label = 'order-v2'), '{}', pg_temp.order_values(), '[]'
  )$$,
  '55000', 'Form version is unavailable for submission',
  'archived Form cannot accept new submissions'
);
reset role;

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'forms'
      and column_name in ('balance_cents', 'paid', 'invoice_status', 'ticket_status')
  ),
  'Forms engine does not duplicate Invoice, Subscription, or Ticket state'
);
select ok(
  (select count(*) >= 1 from public.activity_events where entity_type = 'form' and action = 'form.published')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'form_assignment' and action = 'form.assigned')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'form_submission' and action = 'form.submitted')
  and (select count(*) >= 1 from public.activity_events where entity_type = 'form_submission' and action = 'form.submission_corrected'),
  'meaningful Form lifecycle, assignment, submission, and correction activity is recorded'
);
select is((select count(*) from public.services where tenant_id = private.wolf_forge_tenant_id()), (select total from form_catalog_baseline), 'Forms preserves the existing Wolf Forge Service catalogue');
select ok(
  to_regclass('public.invoices') is not null
  and to_regclass('public.subscriptions') is not null
  and to_regclass('public.coupons') is not null
  and to_regclass('public.orders') is not null,
  'existing Invoice, Subscription, Coupon, and Project boundaries remain intact'
);

select * from finish();
rollback;
