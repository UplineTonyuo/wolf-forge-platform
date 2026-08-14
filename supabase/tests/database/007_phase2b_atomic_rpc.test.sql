begin;

select plan(36);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('22000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase2b-owner@example.invalid', now(), now()),
  ('12000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase2b-client@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner')
where id = '22000000-0000-0000-0000-000000000001';

select ok(
  not has_function_privilege('anon', 'public.app_create_company(uuid,text)', 'EXECUTE'),
  'anonymous callers cannot execute atomic mutation RPCs'
);
select ok(
  not has_function_privilege('service_role', 'public.app_create_company(uuid,text)', 'EXECUTE'),
  'service_role is not granted authenticated user mutation RPCs'
);
select ok(
  (
    select bool_and(has_function_privilege('authenticated', function_name, 'EXECUTE'))
    from unnest(array[
      'public.app_create_company(uuid,text)',
      'public.app_archive_company(uuid)',
      'public.app_create_contact(uuid,uuid,text,uuid,text,text,text,boolean)',
      'public.app_archive_contact(uuid)',
      'public.app_create_service(uuid,jsonb)',
      'public.app_archive_service(uuid)',
      'public.app_create_order(uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text)',
      'public.app_change_order_status(uuid,text)',
      'public.app_assign_order(uuid,uuid)',
      'public.app_archive_order(uuid)',
      'public.app_create_task(uuid,uuid,text,uuid,text,timestamptz,integer)',
      'public.app_change_task_status(uuid,text)',
      'public.app_assign_task(uuid,uuid)'
    ]) as functions(function_name)
  ),
  'authenticated receives only the explicit atomic RPC surface'
);
select ok(
  not has_function_privilege('authenticated', 'private.require_internal_actor()', 'EXECUTE')
  and not has_function_privilege(
    'authenticated',
    'private.record_authenticated_activity(text,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'private actor and activity helpers are not callable by authenticated users'
);
select ok(
  (
    select bool_and(prosecdef)
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname like 'app_%'
  ),
  'all mutation RPCs are security definer functions'
);
select ok(
  (
    select bool_and(proconfig @> array['search_path=""'])
    from pg_proc
    where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and (proname like 'app_%' or proname in ('require_internal_actor', 'record_authenticated_activity'))
  ),
  'all Phase 2B functions pin an empty search path'
);
select ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname like 'app_%'
      and exists (
        select 1
        from generate_subscripts(proargnames, 1) as argument_index
        where proargnames[argument_index] in (
          'actor_id',
          'actor_profile_id',
          'p_actor_id',
          'p_actor_profile_id'
        )
          and coalesce(proargmodes[argument_index], 'i'::"char")
            in ('i'::"char", 'b'::"char", 'v'::"char")
      )
  ),
  'no authenticated mutation RPC accepts a caller-supplied actor identity'
);

create temporary table phase2b_ids (
  company_id uuid,
  contact_id uuid,
  service_id uuid,
  order_id uuid,
  task_id uuid
) on commit drop;
insert into phase2b_ids default values;
grant select, update on phase2b_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = '22000000-0000-0000-0000-000000000001';

select ok(private.is_internal_user(), 'the verified test owner is internal');

update phase2b_ids set company_id = (public.app_create_company('82000000-0000-0000-0000-000000000001', 'Phase 2B Company')).id;
select is((select name from public.companies where id = (select company_id from phase2b_ids)), 'Phase 2B Company', 'company create RPC returns and commits its mutation');
select is((select actor_profile_id from public.activity_events where entity_id = (select company_id from phase2b_ids) and action = 'company.created'), '22000000-0000-0000-0000-000000000001'::uuid, 'company create event derives its actor from auth.uid()');

update phase2b_ids set contact_id = (public.app_create_contact('82000000-0000-0000-0000-000000000002', (select company_id from phase2b_ids), 'Phase 2B Contact')).id;
select is((select count(*) from public.activity_events where entity_id = (select contact_id from phase2b_ids) and action = 'contact.created'), 1::bigint, 'contact create and activity commit together');

update phase2b_ids set service_id = (public.app_create_service(
  '82000000-0000-0000-0000-000000000003',
  '{"name":"Phase 2B Service"}'::jsonb
)).id;
select is((select count(*) from public.activity_events where entity_id = (select service_id from phase2b_ids) and action = 'service.created'), 1::bigint, 'service create and activity commit together');

update phase2b_ids set order_id = (public.app_create_order(
  '82000000-0000-0000-0000-000000000004',
  (select company_id from phase2b_ids),
  (select service_id from phase2b_ids),
  'Phase 2B Order',
  '22000000-0000-0000-0000-000000000001'
)).id;
select is((select count(*) from public.activity_events where entity_id = (select order_id from phase2b_ids) and action = 'order.created'), 1::bigint, 'order create and activity commit together');

update phase2b_ids set task_id = (public.app_create_task(
  '82000000-0000-0000-0000-000000000005',
  (select order_id from phase2b_ids),
  'Phase 2B Task',
  '22000000-0000-0000-0000-000000000001'
)).id;
select is((select count(*) from public.activity_events where entity_id = (select task_id from phase2b_ids) and action = 'task.created'), 1::bigint, 'task create and activity commit together');

select is((public.app_assign_order((select order_id from phase2b_ids), null)).assigned_to_profile_id, null::uuid, 'order assignment RPC mutates assignment atomically');
select is((select count(*) from public.activity_events where entity_id = (select order_id from phase2b_ids) and action = 'order.assigned'), 1::bigint, 'order assignment appends its activity');
select is((public.app_assign_task((select task_id from phase2b_ids), null)).assigned_to_profile_id, null::uuid, 'task assignment RPC mutates assignment atomically');
select is((select count(*) from public.activity_events where entity_id = (select task_id from phase2b_ids) and action = 'task.assigned'), 1::bigint, 'task assignment appends its activity');

select is((public.app_change_order_status((select order_id from phase2b_ids), 'working')).status, 'working', 'order status RPC changes status');
select is((select metadata ->> 'to' from public.activity_events where entity_id = (select order_id from phase2b_ids) and action = 'order.status_changed'), 'working', 'order status event commits with matching metadata');
select is((public.app_change_task_status((select task_id from phase2b_ids), 'complete')).status, 'complete', 'task status RPC changes status');
select ok((select completed_at is not null from public.order_tasks where id = (select task_id from phase2b_ids)), 'task completion timestamp is set in the same status operation');
select is((select metadata ->> 'to' from public.activity_events where entity_id = (select task_id from phase2b_ids) and action = 'task.status_changed'), 'complete', 'task status event commits with matching metadata');

select throws_ok(
  $$select public.app_assign_order((select order_id from phase2b_ids), '12000000-0000-0000-0000-000000000001')$$,
  '23514',
  'assignee must be an active internal profile',
  'a mutation failure aborts an invalid assignment RPC'
);
select is((select assigned_to_profile_id from public.orders where id = (select order_id from phase2b_ids)), null::uuid, 'failed assignment leaves the order unchanged');
select is((select count(*) from public.activity_events where entity_id = (select order_id from phase2b_ids) and action = 'order.assigned'), 1::bigint, 'failed assignment does not append partial activity');

reset role;
create function private.phase2b_reject_test_activity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.action = 'company.created' and new.summary like '%Rollback Sentinel%' then
    raise exception 'synthetic activity failure' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger phase2b_reject_test_activity
before insert on public.activity_events
for each row execute function private.phase2b_reject_test_activity();

set local role authenticated;
set local "request.jwt.claim.sub" = '22000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_company('82000000-0000-0000-0000-000000000006', 'Rollback Sentinel')$$,
  '23514',
  'synthetic activity failure',
  'activity failure aborts the entire mutation RPC'
);
select is((select count(*) from public.companies where name = 'Rollback Sentinel'), 0::bigint, 'activity failure rolls back the company mutation');
select is((select count(*) from public.activity_events where summary like '%Rollback Sentinel%'), 0::bigint, 'activity failure leaves no partial event');

select ok((public.app_archive_order((select order_id from phase2b_ids))).archived_at is not null, 'order archive RPC archives the order');
select is((select count(*) from public.activity_events where entity_id = (select order_id from phase2b_ids) and action = 'order.archived'), 1::bigint, 'order archive appends its activity atomically');
select ok((public.app_archive_contact((select contact_id from phase2b_ids))).archived_at is not null, 'contact archive and activity commit atomically');
select ok((public.app_archive_service((select service_id from phase2b_ids))).archived_at is not null, 'service archive and activity commit atomically');
select ok((public.app_archive_company((select company_id from phase2b_ids))).archived_at is not null, 'company archive and activity commit atomically');

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '12000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.app_create_company('82000000-0000-0000-0000-000000000007', 'Forbidden Client Company')$$,
  '42501',
  'verified internal authentication is required',
  'a real client profile cannot use operational mutation RPCs'
);
select is((select count(*) from public.companies where name = 'Forbidden Client Company'), 0::bigint, 'client RPC denial leaves no mutation');

select * from finish();
rollback;
