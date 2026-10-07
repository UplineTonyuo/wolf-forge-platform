begin;

select plan(23);

-- The suite focuses on behavioral structure rather than mirroring every DDL
-- statement in the migration.
select has_table('public', 'roles', 'roles table exists');
select has_table('public', 'companies', 'companies table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'client_contacts', 'client_contacts table exists');
select has_table('public', 'services', 'services table exists');
select has_table('public', 'orders', 'orders table exists');
select has_table('public', 'order_tasks', 'order_tasks table exists');
select has_table('public', 'activity_events', 'activity_events table exists');

select is(
  (
    select count(*)
    from pg_catalog.pg_constraint
    where contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
      and conrelid = any (
        array[
          'public.roles'::regclass,
          'public.companies'::regclass,
          'public.profiles'::regclass,
          'public.client_contacts'::regclass,
          'public.services'::regclass,
          'public.orders'::regclass,
          'public.order_tasks'::regclass,
          'public.activity_events'::regclass
        ]
      )
  ),
  8::bigint,
  'all Phase 1 tables have primary keys'
);

select ok(
  array['name', 'created_at', 'updated_at']::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.roles'::regclass and attnum > 0 and not attisdropped
  ),
  'roles contains its important lookup columns'
);

select ok(
  array['role_id', 'company_id', 'display_name', 'archived_at']::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
  ),
  'profiles contains role, company, identity, and archival columns'
);

select ok(
  array['company_id', 'profile_id', 'is_primary', 'archived_at']::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.client_contacts'::regclass and attnum > 0 and not attisdropped
  ),
  'client_contacts contains company, optional profile, primary, and archival columns'
);

select ok(
  array['name', 'description', 'is_active', 'archived_at']::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.services'::regclass and attnum > 0 and not attisdropped
  ),
  'services contains catalog and active-state columns'
);

select ok(
  array[
    'order_number', 'company_id', 'service_id', 'assigned_to_profile_id',
    'status', 'priority', 'due_at', 'started_at', 'completed_at', 'archived_at'
  ]::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped
  ),
  'orders contains its required ownership, workflow, assignment, and timing columns'
);

select ok(
  array[
    'order_id', 'assigned_to_profile_id', 'status', 'due_at',
    'sort_position', 'completed_at', 'archived_at'
  ]::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.order_tasks'::regclass and attnum > 0 and not attisdropped
  ),
  'order_tasks contains its required order, workflow, assignment, and ordering columns'
);

select ok(
  array['actor_profile_id', 'entity_type', 'entity_id', 'action', 'summary', 'metadata']::text[] <@ array(
    select attname::text
    from pg_catalog.pg_attribute
    where attrelid = 'public.activity_events'::regclass and attnum > 0 and not attisdropped
  ),
  'activity_events contains actor, generic entity, action, summary, and metadata columns'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class
    where oid = any (
      array[
        'public.roles'::regclass,
        'public.companies'::regclass,
        'public.profiles'::regclass,
        'public.client_contacts'::regclass,
        'public.services'::regclass,
        'public.orders'::regclass,
        'public.order_tasks'::regclass,
        'public.activity_events'::regclass
      ]
    )
      and relrowsecurity
  ),
  8::bigint,
  'RLS is enabled on every Phase 1 application table'
);

select is(
  (
    select jsonb_object_agg(
      child_ns.nspname || '.' || child_table.relname || '.' || child_column.attname,
      parent_ns.nspname || '.' || parent_table.relname || '.' || parent_column.attname
    )
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as child_table
      on child_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as child_ns
      on child_ns.oid = child_table.relnamespace
    join pg_catalog.pg_attribute as child_column
      on child_column.attrelid = child_table.oid
      and child_column.attnum = constraint_row.conkey[1]
    join pg_catalog.pg_class as parent_table
      on parent_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace as parent_ns
      on parent_ns.oid = parent_table.relnamespace
    join pg_catalog.pg_attribute as parent_column
      on parent_column.attrelid = parent_table.oid
      and parent_column.attnum = constraint_row.confkey[1]
    -- Single-column only; Tenant composite FKs are asserted in 089, 092, 093 and 094.
    where constraint_row.contype = 'f'
      and cardinality(constraint_row.conkey) = 1
      and constraint_row.conrelid = any (
        array[
          'public.profiles'::regclass,
          'public.client_contacts'::regclass,
          'public.orders'::regclass,
          'public.order_tasks'::regclass,
          'public.activity_events'::regclass
        ]
      )
  ),
  jsonb_build_object(
    'public.profiles.id', 'auth.users.id',
    'public.profiles.role_id', 'public.roles.id',
    'public.profiles.company_id', 'public.companies.id',
    'public.client_contacts.profile_id', 'public.profiles.id',
    'public.orders.tenant_id', 'public.tenants.id',
    'public.order_tasks.order_id', 'public.orders.id',
    'public.order_tasks.assigned_to_profile_id', 'public.profiles.id',
    'public.activity_events.actor_profile_id', 'public.profiles.id'
  ),
  'important Phase 1 foreign keys point to the intended parent columns'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.roles'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (name)'
  ),
  'role names are unique'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (order_number)'
  ),
  'order sequence numbers are unique'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'client_contacts'
      and indexname = 'client_contacts_one_active_primary_per_company_key'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'only one active primary contact is permitted per company'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'client_contacts'
      and indexname = 'client_contacts_active_profile_id_key'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'an active profile can link to only one active contact'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = any (
        array[
          'profiles_role_id_idx',
          'profiles_company_id_idx',
          'client_contacts_company_id_idx',
          'orders_company_id_idx',
          'orders_service_id_idx',
          'orders_assigned_to_profile_id_idx',
          'order_tasks_order_id_idx',
          'order_tasks_assigned_to_profile_id_idx',
          'activity_events_actor_profile_id_created_at_idx',
          'activity_events_entity_created_at_idx'
        ]
      )
  ),
  10::bigint,
  'important foreign-key and activity lookup indexes exist'
);

select * from finish();
rollback;
