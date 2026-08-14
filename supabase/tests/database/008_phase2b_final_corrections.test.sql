begin;

select plan(44);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('23000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'final-owner@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner')
where id = '23000000-0000-0000-0000-000000000001';

select ok(
  (
    select bool_and(has_function_privilege('authenticated', function_name, 'EXECUTE'))
    from unnest(array[
      'public.app_update_company(uuid,jsonb)',
      'public.app_update_contact(uuid,jsonb)',
      'public.app_update_service(uuid,jsonb)',
      'public.app_update_order(uuid,jsonb)',
      'public.app_update_task(uuid,jsonb)',
      'public.app_reorder_task(uuid,integer)'
    ]) as functions(function_name)
  ),
  'authenticated receives the six final atomic update and reorder RPCs'
);

select ok(
  (
    select bool_and(
      has_table_privilege('authenticated', table_name, 'SELECT')
      and not has_table_privilege('authenticated', table_name, 'INSERT')
      and not has_table_privilege('authenticated', table_name, 'UPDATE')
    )
    from unnest(array[
      'public.companies', 'public.client_contacts', 'public.services',
      'public.orders', 'public.order_tasks'
    ]) as tables(table_name)
  ),
  'authenticated operational tables are read-only outside RPCs'
);

select ok(
  (
    select bool_and(
      not has_table_privilege('authenticated', table_name, 'DELETE')
      and not has_table_privilege('authenticated', table_name, 'TRUNCATE')
    )
    from unnest(array[
      'public.companies', 'public.client_contacts', 'public.services',
      'public.orders', 'public.order_tasks'
    ]) as tables(table_name)
  ),
  'no broad authenticated DELETE or TRUNCATE grants were introduced'
);

set local role anon;
select throws_ok(
  $$select public.app_create_company('83000000-0000-0000-0000-000000000001', 'Anon client')$$,
  '42501',
  'permission denied for function app_create_company',
  'anon runtime execution of mutation RPC is denied'
);

reset role;
set local role service_role;
select throws_ok(
  $$select public.app_create_company('83000000-0000-0000-0000-000000000002', 'Service role client')$$,
  '42501',
  'permission denied for function app_create_company',
  'service_role runtime execution of user mutation RPC is denied'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '23000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select private.record_authenticated_activity('company', gen_random_uuid(), 'test', 'Forbidden helper', '{}'::jsonb)$$,
  '42501',
  'permission denied for function record_authenticated_activity',
  'private activity helper runtime execution is denied'
);

reset role;
update public.profiles set archived_at = now() where id = '23000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '23000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_company('83000000-0000-0000-0000-000000000003', 'Archived actor client')$$,
  '42501',
  'verified internal authentication is required',
  'an archived internal profile cannot call mutation RPCs'
);

reset role;
update public.profiles set archived_at = null where id = '23000000-0000-0000-0000-000000000001';

create temporary table final_ids (
  company_id uuid,
  contact_id uuid,
  service_id uuid,
  order_id uuid,
  task_id uuid,
  archived_at timestamptz
) on commit drop;
insert into final_ids default values;
grant select, update on final_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '23000000-0000-0000-0000-000000000001';

update final_ids
set company_id = (public.app_create_company(
  '83000000-0000-0000-0000-000000000010', 'Correction Client'
)).id;
select is(
  (select name from public.companies where id = (select company_id from final_ids)),
  'Correction Client',
  'retry-safe client create succeeds'
);

select is(
  (public.app_create_company(
    '83000000-0000-0000-0000-000000000010', 'Correction Client'
  )).id,
  (select company_id from final_ids),
  'a repeated create request returns the original entity'
);
select is(
  (select count(*) from public.companies where id = (select company_id from final_ids)),
  1::bigint,
  'a repeated create request does not create a duplicate logical row'
);
select is(
  (select count(*) from public.activity_events where entity_id = (select company_id from final_ids) and action = 'company.created'),
  1::bigint,
  'a repeated create request does not create duplicate activity'
);
select throws_ok(
  $$select public.app_create_company('83000000-0000-0000-0000-000000000010', 'Different client')$$,
  '23505',
  'idempotency key was already used with different input',
  'an idempotency key cannot be reused with different input'
);

update final_ids set contact_id = (public.app_create_contact(
  '83000000-0000-0000-0000-000000000011',
  (select company_id from final_ids),
  'Correction Contact'
)).id;
update final_ids set service_id = (public.app_create_service(
  '83000000-0000-0000-0000-000000000012',
  '{"name":"Correction Service"}'::jsonb
)).id;
update final_ids set order_id = (public.app_create_order(
  '83000000-0000-0000-0000-000000000013',
  (select company_id from final_ids),
  (select service_id from final_ids),
  'Correction Project'
)).id;
update final_ids set task_id = (public.app_create_task(
  '83000000-0000-0000-0000-000000000014',
  (select order_id from final_ids),
  'Correction Task'
)).id;

select is(
  (public.app_update_company((select company_id from final_ids), '{"name":"Updated Client"}')).name,
  'Updated Client',
  'client update is atomic'
);
select is(
  (select summary from public.activity_events where entity_id = (select company_id from final_ids) and action = 'company.updated'),
  'Updated client Updated Client.',
  'client update activity uses locked UI terminology'
);
select is(
  (public.app_update_contact((select contact_id from final_ids), '{"phone":"+63-555-0101"}')).phone,
  '+63-555-0101',
  'contact update is atomic'
);
select is(
  (select count(*) from public.activity_events where entity_id = (select contact_id from final_ids) and action = 'contact.updated'),
  1::bigint,
  'contact update appends activity in the same transaction'
);
select is(
  (public.app_update_service((select service_id from final_ids), '{"description":"Updated"}')).description,
  'Updated',
  'service update is atomic'
);
select is(
  (select count(*) from public.activity_events where entity_id = (select service_id from final_ids) and action = 'service.updated'),
  1::bigint,
  'service update appends activity in the same transaction'
);
select is(
  (public.app_update_order((select order_id from final_ids), '{"title":"Updated Project"}')).title,
  'Updated Project',
  'project update is atomic'
);
select is(
  (select summary from public.activity_events where entity_id = (select order_id from final_ids) and action = 'order.updated'),
  format('Updated project %s.', (select order_number from public.orders where id = (select order_id from final_ids))),
  'project update activity uses locked UI terminology'
);
select is(
  (public.app_update_task((select task_id from final_ids), '{"title":"Updated Task"}')).title,
  'Updated Task',
  'task update is atomic'
);
select is(
  (select summary from public.activity_events where entity_id = (select task_id from final_ids) and action = 'task.updated'),
  'Updated project task Updated Task.',
  'task update activity uses locked UI terminology'
);
select is(
  (public.app_reorder_task((select task_id from final_ids), 7)).sort_position,
  7,
  'task reorder is atomic'
);
select is(
  (select metadata ->> 'sort_position' from public.activity_events where entity_id = (select task_id from final_ids) and summary like 'Reordered%'),
  '7',
  'task reorder appends matching activity metadata'
);

select is(
  (public.app_change_order_status((select order_id from final_ids), 'complete')).status,
  'complete',
  'project completion transition succeeds'
);
select ok(
  (select completed_at between transaction_timestamp() and clock_timestamp() from public.orders where id = (select order_id from final_ids)),
  'project completion timestamp is generated by the database'
);
select is(
  (public.app_change_task_status((select task_id from final_ids), 'complete')).status,
  'complete',
  'task completion transition succeeds'
);
select ok(
  (select completed_at between transaction_timestamp() and clock_timestamp() from public.order_tasks where id = (select task_id from final_ids)),
  'task completion timestamp is generated by the database'
);
select ok(
  not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('app_change_order_status', 'app_change_task_status')
      and coalesce(proargnames, array[]::text[]) @> array['p_completed_at']
  ),
  'completion RPCs expose no caller-supplied completion timestamp'
);

select throws_ok(
  $$insert into public.companies (name) values ('Direct bypass')$$,
  '42501',
  'permission denied for table companies',
  'authenticated direct inserts cannot bypass audited RPCs'
);
select throws_ok(
  $$update public.orders set status = 'working'$$,
  '42501',
  'permission denied for table orders',
  'authenticated direct mass updates cannot bypass audited RPCs'
);

update final_ids set archived_at = (public.app_archive_order((select order_id from final_ids))).archived_at;
select ok((select archived_at is not null from final_ids), 'project archive succeeds');
select is(
  (select count(*) from public.activity_events where entity_id = (select order_id from final_ids) and action = 'order.archived'),
  1::bigint,
  'first project archive writes one activity event'
);
select is(
  (public.app_archive_order((select order_id from final_ids))).archived_at,
  (select archived_at from final_ids),
  'second project archive returns the original archive timestamp'
);
select is(
  (select count(*) from public.activity_events where entity_id = (select order_id from final_ids) and action = 'order.archived'),
  1::bigint,
  'second project archive does not write a second activity event'
);

select throws_ok(
  $$select public.app_change_order_status((select order_id from final_ids), 'working')$$,
  'P0002', null,
  'an archived project cannot change status'
);
select throws_ok(
  $$select public.app_assign_order((select order_id from final_ids), null)$$,
  'P0002', null,
  'an archived project cannot be assigned'
);
select throws_ok(
  $$select public.app_create_task('83000000-0000-0000-0000-000000000015', (select order_id from final_ids), 'Forbidden task')$$,
  'P0002', null,
  'a task cannot be created under an archived project'
);
select throws_ok(
  $$select public.app_change_task_status((select task_id from final_ids), 'todo')$$,
  'P0002', null,
  'a task under an archived project cannot change status'
);
select throws_ok(
  $$select public.app_assign_task((select task_id from final_ids), null)$$,
  'P0002', null,
  'a task under an archived project cannot be assigned'
);
select throws_ok(
  $$select public.app_update_task((select task_id from final_ids), '{"title":"Forbidden"}')$$,
  'P0002', null,
  'a task under an archived project cannot be updated'
);
select throws_ok(
  $$select public.app_reorder_task((select task_id from final_ids), 9)$$,
  'P0002', null,
  'a task under an archived project cannot be reordered'
);
select throws_ok(
  $$select public.app_change_order_status('ffffffff-ffff-4fff-8fff-ffffffffffff', 'working')$$,
  'P0002', null,
  'missing RPC targets use the NOT FOUND SQLSTATE'
);
select ok(
  (select summary like 'Created client %' from public.activity_events where entity_id = (select company_id from final_ids) and action = 'company.created')
  and (select summary like 'Created project %' from public.activity_events where entity_id = (select order_id from final_ids) and action = 'order.created'),
  'create activity summaries use Client and Project terminology'
);

select * from finish();
rollback;
