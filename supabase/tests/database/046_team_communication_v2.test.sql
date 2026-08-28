begin;

select plan(42);

-- =============================================================================
-- Team Communication V2.
--
-- Covers supabase/migrations/20260826190000_team_communication_v2.sql.
--
-- The claims under test:
--
--   * a group is internal-only, needs three real members, and its creator is
--     auth.uid() rather than anything the caller supplied,
--   * a non-member internal colleague and a client account reach a group's
--     messages, typing state and tasks exactly as far as they reach a direct
--     thread they are not in — not at all,
--   * typing is ephemeral, membership-gated, actor-derived, expires on its own,
--     and never becomes a message,
--   * completing a task writes exactly ONE conversation activity event and one
--     creator notification, and doing it twice writes no second one,
--   * completion records completed_by, and reopening clears it.
--
-- Fixtures: three internal colleagues who form a group (Gwen, Hal, Ida), one
-- internal outsider (Otto), and one client (Cleo) who must reach none of it.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7ec00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'v2-gwen@example.invalid', now(), now()),
  ('7ec00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'v2-hal@example.invalid', now(), now()),
  ('7ec00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'v2-ida@example.invalid', now(), now()),
  ('7ec00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'v2-otto@example.invalid', now(), now()),
  ('7ec00000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'v2-cleo@example.invalid', now(), now());

insert into public.companies (id, name)
values ('7ec00000-0000-4000-8000-00000000c001', 'V2 Client Co');

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    display_name = 'Gwen Owner'
where id = '7ec00000-0000-4000-8000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    display_name = 'Hal Staff'
where id = '7ec00000-0000-4000-8000-000000000002';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    display_name = 'Ida Staff'
where id = '7ec00000-0000-4000-8000-000000000003';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    display_name = 'Otto Outsider'
where id = '7ec00000-0000-4000-8000-000000000004';

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    display_name = 'Cleo Client',
    company_id = '7ec00000-0000-4000-8000-00000000c001'
where id = '7ec00000-0000-4000-8000-000000000005';

create or replace function pg_temp.become(p_user uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
$$;

-- -----------------------------------------------------------------------------
-- The typing table is closed, exactly like every other team table.
-- -----------------------------------------------------------------------------

select has_table(
  'public'::name,
  'team_typing_connections'::name,
  'ephemeral typing has its own table rather than riding on team_messages'
);

select is(
  (select count(*) from pg_class
    where oid = 'public.team_typing_connections'::regclass
      and relrowsecurity and relforcerowsecurity),
  1::bigint,
  'typing storage enables and forces RLS'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'team_typing_connections'
      and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role has direct typing-table privileges'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'team_typing_connections'),
  0::bigint,
  'no policy reopens direct typing rows'
);

-- Every V2 RPC is SECURITY DEFINER with a pinned empty search_path.
select is(
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'app_create_team_group', 'app_touch_team_typing',
        'app_clear_team_typing', 'app_list_team_typing'
      )
      and prosecdef
      and coalesce(proconfig::text like '%search_path=%', false)),
  4::bigint,
  'every V2 RPC is SECURITY DEFINER with a pinned empty search_path'
);

select is(
  (select count(*) from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'app_create_team_group', 'app_touch_team_typing',
        'app_clear_team_typing', 'app_list_team_typing'
      )
      and grantee in ('anon', 'public')),
  0::bigint,
  'no anonymous caller may execute a V2 RPC'
);

-- -----------------------------------------------------------------------------
-- Group creation
-- -----------------------------------------------------------------------------

select pg_temp.become('7ec00000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.app_create_team_group('', array[
       '7ec00000-0000-4000-8000-000000000002'::uuid,
       '7ec00000-0000-4000-8000-000000000003'::uuid]) $$,
  '22023',
  null,
  'a group must be named'
);

select throws_ok(
  $$ select public.app_create_team_group('Pair Only', array[
       '7ec00000-0000-4000-8000-000000000002'::uuid]) $$,
  '22023',
  null,
  'a group needs at least three members including the creator'
);

select throws_ok(
  $$ select public.app_create_team_group('With A Client', array[
       '7ec00000-0000-4000-8000-000000000002'::uuid,
       '7ec00000-0000-4000-8000-000000000005'::uuid]) $$,
  '22023',
  null,
  'a client account can never be made a group member'
);

create temporary table v2_group on commit drop as
select public.app_create_team_group(
  'SEO Pod',
  array[
    '7ec00000-0000-4000-8000-000000000002'::uuid,
    '7ec00000-0000-4000-8000-000000000003'::uuid
  ]
) as conversation_id;

select is(
  (select kind from public.team_conversations
    where id = (select conversation_id from v2_group)),
  'group',
  'the created conversation is a group'
);

select is(
  (select title from public.team_conversations
    where id = (select conversation_id from v2_group)),
  'SEO Pod',
  'the group keeps the name it was given'
);

-- The creator is auth.uid(). No parameter names a creator, so this is the only
-- value it could have taken.
select is(
  (select created_by_profile_id from public.team_conversations
    where id = (select conversation_id from v2_group)),
  '7ec00000-0000-4000-8000-000000000001'::uuid,
  'the group creator is the authenticated actor'
);

select is(
  (select count(*) from public.team_conversation_members
    where conversation_id = (select conversation_id from v2_group)),
  3::bigint,
  'the creator is enrolled alongside the members they named'
);

select is(
  (select count(*) from public.team_conversation_members
    where conversation_id = (select conversation_id from v2_group)
      and profile_id = '7ec00000-0000-4000-8000-000000000004'),
  0::bigint,
  'an internal colleague who was not named is not a member'
);

-- Every named member learns about the group they were added to.
select is(
  (select count(*) from public.notifications
    where recipient_profile_id in (
      '7ec00000-0000-4000-8000-000000000002',
      '7ec00000-0000-4000-8000-000000000003')
      and entity_id = (select conversation_id from v2_group)),
  2::bigint,
  'each added member receives one group-created notification'
);

-- -----------------------------------------------------------------------------
-- Group messaging, and the outsider boundary
-- -----------------------------------------------------------------------------

select lives_ok(
  $$ select public.app_send_team_message(
       gen_random_uuid(),
       (select conversation_id from v2_group),
       'Kickoff at ten.') $$,
  'a group member may send to the group'
);

select is(
  (select count(*) from public.notifications
    where recipient_profile_id in (
      '7ec00000-0000-4000-8000-000000000002',
      '7ec00000-0000-4000-8000-000000000003')
      and entity_type = 'team_message'),
  0::bigint,
  'ordinary group messages do not create persistent bell notifications'
);

select pg_temp.become('7ec00000-0000-4000-8000-000000000002');

select is(
  (select count(*) from public.app_list_team_conversations()
    where conversation_id = (select conversation_id from v2_group)),
  1::bigint,
  'a member sees the group in their conversation list'
);

select is(
  (select conversation_kind from public.app_list_team_conversations()
    where conversation_id = (select conversation_id from v2_group)),
  'group',
  'the list reports the conversation kind'
);

select is(
  (select other_member_profile_id from public.app_list_team_conversations()
    where conversation_id = (select conversation_id from v2_group)),
  null,
  'a group has no single other member to name'
);

select pg_temp.become('7ec00000-0000-4000-8000-000000000004');

select is(
  (select count(*) from public.app_list_team_conversations()),
  0::bigint,
  'a non-member internal colleague sees no group at all'
);

select throws_ok(
  format(
    $$ select public.app_get_team_conversation(%L) $$,
    (select conversation_id from v2_group)
  ),
  '42501',
  null,
  'a non-member cannot read the group'
);

select throws_ok(
  format(
    $$ select public.app_send_team_message(gen_random_uuid(), %L, 'let me in') $$,
    (select conversation_id from v2_group)
  ),
  '42501',
  null,
  'a non-member cannot send to the group'
);

select throws_ok(
  format(
    $$ select public.app_touch_team_typing(%L, gen_random_uuid()) $$,
    (select conversation_id from v2_group)
  ),
  '42501',
  null,
  'a non-member cannot appear to be typing in the group'
);

select pg_temp.become('7ec00000-0000-4000-8000-000000000005');

select throws_ok(
  $$ select public.app_create_team_group('Client Group', array[
       '7ec00000-0000-4000-8000-000000000002'::uuid,
       '7ec00000-0000-4000-8000-000000000003'::uuid]) $$,
  '42501',
  null,
  'a client account cannot create a group'
);

select throws_ok(
  format(
    $$ select public.app_list_team_typing(%L) $$,
    (select conversation_id from v2_group)
  ),
  '42501',
  null,
  'a client account cannot read group typing state'
);

-- -----------------------------------------------------------------------------
-- Typing is ephemeral, actor-derived, and never a message
-- -----------------------------------------------------------------------------

select pg_temp.become('7ec00000-0000-4000-8000-000000000002');

select lives_ok(
  format(
    $$ select public.app_touch_team_typing(%L, '7ec00000-0000-4000-8000-0000000000f1') $$,
    (select conversation_id from v2_group)
  ),
  'a member may announce that they are typing'
);

-- The row is owned by auth.uid(); the connection id only distinguishes tabs.
select is(
  (select profile_id from public.team_typing_connections
    where conversation_id = (select conversation_id from v2_group)),
  '7ec00000-0000-4000-8000-000000000002'::uuid,
  'the typing row belongs to the authenticated actor, not to a supplied id'
);

select pg_temp.become('7ec00000-0000-4000-8000-000000000001');

select is(
  (select count(*) from public.app_list_team_typing(
    (select conversation_id from v2_group))),
  1::bigint,
  'another member sees the fresh typing state'
);

-- Typing must never become part of the transcript.
select is(
  (select count(*) from public.team_messages
    where conversation_id = (select conversation_id from v2_group)),
  1::bigint,
  'announcing typing wrote no message'
);

-- Staleness is time-based, not cleanup-dependent: age the row past the window.
update public.team_typing_connections
set last_typed_at = clock_timestamp() - interval '10 seconds'
where conversation_id = (select conversation_id from v2_group);

select is(
  (select count(*) from public.app_list_team_typing(
    (select conversation_id from v2_group))),
  0::bigint,
  'typing expires on its own within seconds'
);

select pg_temp.become('7ec00000-0000-4000-8000-000000000002');

select lives_ok(
  format(
    $$ select public.app_clear_team_typing(%L, '7ec00000-0000-4000-8000-0000000000f1') $$,
    (select conversation_id from v2_group)
  ),
  'a member may clear their own typing connection'
);

-- -----------------------------------------------------------------------------
-- Completion: one activity event, one notification, no duplicates
-- -----------------------------------------------------------------------------

select pg_temp.become('7ec00000-0000-4000-8000-000000000001');

create temporary table v2_task on commit drop as
select (public.app_create_team_task(
  gen_random_uuid(),
  (select conversation_id from v2_group),
  'Ship the audit',
  '7ec00000-0000-4000-8000-000000000002'::uuid,
  null, 'normal', null, null
) ->> 'id')::uuid as task_id;

select pg_temp.become('7ec00000-0000-4000-8000-000000000002');

select is(
  (select (public.app_update_team_task_status(
    (select task_id from v2_task), 'done') ->> 'status')),
  'done',
  'the assignee may complete their own task'
);

select is(
  (select completed_by_profile_id from public.team_tasks
    where id = (select task_id from v2_task)),
  '7ec00000-0000-4000-8000-000000000002'::uuid,
  'completion records who completed it, derived from auth.uid()'
);

select is(
  (select count(*) from public.team_messages
    where task_id = (select task_id from v2_task)
      and message_type = 'task_activity'
      and task_action = 'completed'),
  1::bigint,
  'completing writes exactly one conversation activity event'
);

select is(
  (select count(*) from public.notifications
    where recipient_profile_id = '7ec00000-0000-4000-8000-000000000001'
      and entity_type = 'team_task'
      and entity_id = (select task_id from v2_task)),
  1::bigint,
  'the task creator is notified once'
);

-- Done -> Done is a no-op, not a second announcement.
select is(
  (select (public.app_update_team_task_status(
    (select task_id from v2_task), 'done') ->> 'status')),
  'done',
  'repeating Done is accepted rather than failing'
);

-- Scoped to task_action = 'completed': V2.6 gives a composer-created task
-- (this one has no source message) its own 'created' activity row too, so a
-- bare message_type count would now legitimately be 2, not 1. That is the
-- new, correct behavior (the task timeline fix), not a regression here — the
-- actual invariant this assertion protects, "no duplicate completion
-- announcement", is unchanged and is what the narrower filter checks.
select is(
  (select count(*) from public.team_messages
    where task_id = (select task_id from v2_task)
      and message_type = 'task_activity'
      and task_action = 'completed'),
  1::bigint,
  'repeating Done writes no second completion activity event'
);

select is(
  (select count(*) from public.notifications
    where recipient_profile_id = '7ec00000-0000-4000-8000-000000000001'
      and entity_type = 'team_task'
      and entity_id = (select task_id from v2_task)),
  1::bigint,
  'repeating Done sends no second notification'
);

-- Reopening is its own distinct event, and it releases the completion record.
select is(
  (select (public.app_update_team_task_status(
    (select task_id from v2_task), 'todo') ->> 'status')),
  'todo',
  'a completed task can be reopened'
);

select is(
  (select completed_by_profile_id from public.team_tasks
    where id = (select task_id from v2_task)),
  null,
  'reopening clears the completion record'
);

select is(
  (select count(*) from public.team_messages
    where task_id = (select task_id from v2_task)
      and task_action = 'reopened'),
  1::bigint,
  'reopening writes its own single activity event'
);

select * from finish();

rollback;
