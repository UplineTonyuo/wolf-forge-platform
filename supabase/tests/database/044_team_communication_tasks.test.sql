begin;

select plan(60);

-- =============================================================================
-- Team Communication + Tasks.
--
-- Covers supabase/migrations/20260826170000_team_communication_tasks.sql.
--
-- The claim under test is that internal staff communication is a SEPARATE
-- SECURITY DOMAIN from the client Ticket system, enforced by the database
-- rather than by the browser:
--
--   * a client account holds no capability that reaches any table or RPC here,
--   * an internal colleague who is not a member of a conversation cannot read
--     it, write to it, or move its tasks,
--   * authorship and task creation are derived from auth.uid(), so there is no
--     parameter through which a sender could be spoofed,
--   * the four tables have no direct API-role surface at all,
--   * task management is capability-gated while status movement is not, and
--   * the notification catalog treats ('client', 'team') as a decided refusal.
--
-- Fixtures: two internal members who converse (owner Wanda, staff Ari), one
-- internal outsider (staff Oona) who is party to nothing, and one client
-- account (Cara) who must reach none of it.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7ea00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'team-wanda@example.invalid', now(), now()),
  ('7ea00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'team-ari@example.invalid', now(), now()),
  ('7ea00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'team-oona@example.invalid', now(), now()),
  ('7ea00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'team-cara@example.invalid', now(), now());

insert into public.companies (id, name)
values ('7ea00000-0000-4000-8000-00000000c001', 'Team Test Client Co');

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    display_name = 'Wanda Owner'
where id = '7ea00000-0000-4000-8000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    display_name = 'Ari Staff'
where id = '7ea00000-0000-4000-8000-000000000002';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'),
    display_name = 'Oona Outsider'
where id = '7ea00000-0000-4000-8000-000000000003';

update public.profiles
set role_id = (select id from public.roles where name = 'client'),
    display_name = 'Cara Client',
    company_id = '7ea00000-0000-4000-8000-00000000c001'
where id = '7ea00000-0000-4000-8000-000000000004';

-- Acting as somebody: every RPC reads the subject from auth.uid().
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

-- =============================================================================
-- A. Structure and the absent API surface
-- =============================================================================

select has_table('public'::name, 'team_conversations'::name, 'team_conversations exists');
select has_table('public'::name, 'team_conversation_members'::name, 'team_conversation_members exists');
select has_table('public'::name, 'team_messages'::name, 'team_messages exists');
select has_table('public'::name, 'team_tasks'::name, 'team_tasks exists');

select is(
  (select count(*) from pg_class
    where oid in (
      'public.team_conversations'::regclass,
      'public.team_conversation_members'::regclass,
      'public.team_messages'::regclass,
      'public.team_tasks'::regclass
    )
    and relrowsecurity and relforcerowsecurity),
  4::bigint,
  'row level security is enabled AND forced on all four tables'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'team_conversations', 'team_conversation_members', 'team_messages', 'team_tasks'
      )
      and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no API role holds any privilege on any team table: there is no direct surface'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in (
        'team_conversations', 'team_conversation_members', 'team_messages', 'team_tasks'
      )),
  0::bigint,
  'and no policy re-opens one, so forced RLS denies everything by default'
);

-- Every SECURITY DEFINER function in this domain must pin its search path, or
-- a hostile schema on the caller's path could redirect an unqualified lookup.
select is(
  (select count(*) from pg_proc
    where proname like '%team%'
      and prosecdef
      and pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and not coalesce(proconfig::text like '%search_path=%', false)),
  0::bigint,
  'every team SECURITY DEFINER function pins search_path'
);

select is(
  (select count(*) from information_schema.role_routine_grants
    where routine_schema = 'private'
      and routine_name like '%team%'
      and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'no browser role may execute a private team helper directly'
);

-- =============================================================================
-- B. Capability wiring
-- =============================================================================

select is(
  (select count(*) from public.permissions
    where permission_key in ('team_messages.use', 'team_tasks.manage')),
  2::bigint,
  'both team capabilities are registered'
);

select is(
  (select count(*) from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where rp.permission_key = 'team_messages.use' and rp.allowed
      and r.name in ('owner', 'admin', 'manager', 'staff')),
  4::bigint,
  'every internal role can converse'
);

select is(
  (select count(*) from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where rp.permission_key = 'team_tasks.manage' and rp.allowed
      and r.name in ('owner', 'admin')),
  2::bigint,
  'only owner and admin manage accountable work'
);

select is(
  (select count(*) from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where r.name = 'client'
      and rp.permission_key in ('team_messages.use', 'team_tasks.manage')
      and rp.allowed),
  0::bigint,
  'the client role is explicitly refused both keys, not merely ungranted'
);

-- =============================================================================
-- C. Conversation identity
-- =============================================================================

select pg_temp.become('7ea00000-0000-4000-8000-000000000001');

select isnt(
  public.app_start_team_conversation('7ea00000-0000-4000-8000-000000000002'),
  null,
  'an internal member can open a conversation with a colleague'
);

-- Stash the conversation for the rest of the file.
create temp table team_fx as
select public.app_start_team_conversation('7ea00000-0000-4000-8000-000000000002') as conversation_id;

select is(
  (select count(distinct member.conversation_id)
    from public.team_conversation_members as member
    where member.profile_id = '7ea00000-0000-4000-8000-000000000001'),
  1::bigint,
  'get-or-create is deterministic: asking twice produced one conversation'
);

select is(
  (select count(*) from public.team_conversation_members
    where conversation_id = (select conversation_id from team_fx)),
  2::bigint,
  'both sides became members atomically'
);

select throws_ok(
  $$ select public.app_start_team_conversation('7ea00000-0000-4000-8000-000000000001') $$,
  '22023',
  null,
  'a conversation with yourself is refused'
);

select throws_ok(
  $$ select public.app_start_team_conversation('7ea00000-0000-4000-8000-000000000004') $$,
  '22023',
  null,
  'a conversation with a CLIENT account is refused: this domain is internal only'
);

-- =============================================================================
-- D. Messages: derived authorship and idempotent send
-- =============================================================================

create temp table team_msg as
select public.app_send_team_message(
  'b0000000-0000-4000-8000-000000000001',
  (select conversation_id from team_fx),
  'The subscription page is fixed.'
) as sent;

select is(
  (select (sent ->> 'author_profile_id')::uuid from team_msg),
  '7ea00000-0000-4000-8000-000000000001'::uuid,
  'authorship is derived from auth.uid(): there is no sender parameter to forge'
);

select is(
  (select sent ->> 'body' from team_msg),
  'The subscription page is fixed.',
  'the body round-trips intact'
);

-- Replay: same request id, same draft.
select is(
  (select (public.app_send_team_message(
    'b0000000-0000-4000-8000-000000000001',
    (select conversation_id from team_fx),
    'The subscription page is fixed.'
  ) ->> 'id')::uuid),
  (select (sent ->> 'id')::uuid from team_msg),
  'a retried send replays the original row rather than sending twice'
);

select is(
  (select count(*) from public.team_messages
    where request_id = 'b0000000-0000-4000-8000-000000000001'),
  1::bigint,
  'and exactly one message row exists for that request id'
);

select throws_ok(
  $$ select public.app_send_team_message(
       gen_random_uuid(),
       (select conversation_id from team_fx),
       '   '
     ) $$,
  '22023',
  null,
  'a blank message is refused'
);

-- Messages are immutable, and no table here has an API-role surface at all.
set local role authenticated;

select throws_ok(
  $$ update public.team_messages set body = 'rewritten' $$,
  '42501',
  null,
  'an authenticated session cannot rewrite a message'
);

select throws_ok(
  $$ select * from public.team_messages $$,
  '42501',
  null,
  'nor read the table directly: reads go through the RPCs'
);

reset role;

-- =============================================================================
-- E. Unread accounting, per member
-- =============================================================================

select pg_temp.become('7ea00000-0000-4000-8000-000000000002');

select is(
  public.app_team_unread_count(),
  1,
  'the recipient has one unread message'
);

select is(
  (select unread_count from public.app_list_team_conversations()
    where conversation_id = (select conversation_id from team_fx)),
  1,
  'and the conversation row agrees'
);

select lives_ok(
  $$ select public.app_mark_team_conversation_read((select conversation_id from team_fx)) $$,
  'the recipient can move their own read marker'
);

select is(
  public.app_team_unread_count(),
  0,
  'after which they have nothing unread'
);

select pg_temp.become('7ea00000-0000-4000-8000-000000000001');

select is(
  public.app_team_unread_count(),
  0,
  'the author never has their own message counted as unread'
);

-- =============================================================================
-- F. Tasks: real entities, capability-gated creation
-- =============================================================================

create temp table team_task as
select public.app_create_team_task(
  'c0000000-0000-4000-8000-000000000001',
  (select conversation_id from team_fx),
  'Fix the subscription mobile layout',
  '7ea00000-0000-4000-8000-000000000002',
  'Cards overlap under 380px.',
  'high',
  now() + interval '2 days',
  (select (sent ->> 'id')::uuid from team_msg)
) as task;

select is(
  (select task ->> 'status' from team_task),
  'todo',
  'a new task starts in To Do'
);

select is(
  (select task ->> 'priority' from team_task),
  'high',
  'the requested priority is stored'
);

select is(
  (select (task ->> 'source_message_id')::uuid from team_task),
  (select (sent ->> 'id')::uuid from team_msg),
  'the task keeps a link to the message it was raised from'
);

select is(
  (select (task ->> 'created_by_profile_id')::uuid from team_task),
  '7ea00000-0000-4000-8000-000000000001'::uuid,
  'the creator is derived from auth.uid(), not supplied by the caller'
);

select throws_ok(
  $$ select public.app_create_team_task(
       gen_random_uuid(),
       (select conversation_id from team_fx),
       'Task for an outsider',
       '7ea00000-0000-4000-8000-000000000003'
     ) $$,
  '22023',
  null,
  'a task cannot be assigned to somebody outside the conversation'
);

-- A source message from a different conversation cannot be attached.
select throws_ok(
  $$ select public.app_create_team_task(
       gen_random_uuid(),
       (select conversation_id from team_fx),
       'Task with a foreign source',
       '7ea00000-0000-4000-8000-000000000002',
       null, 'normal', null,
       gen_random_uuid()
     ) $$,
  '22023',
  null,
  'a source message that does not belong to this conversation is refused'
);

select throws_ok(
  $$ select public.app_create_team_task(
       gen_random_uuid(),
       (select conversation_id from team_fx),
       '   ',
       '7ea00000-0000-4000-8000-000000000002'
     ) $$,
  '22023',
  null,
  'a blank task title is refused'
);

-- =============================================================================
-- G. Status movement vs. detail management
-- =============================================================================

select pg_temp.become('7ea00000-0000-4000-8000-000000000002');

select is(
  (select public.app_update_team_task_status(
    (select (task ->> 'id')::uuid from team_task), 'in_progress') ->> 'status'),
  'in_progress',
  'the ASSIGNEE may move status without holding team_tasks.manage'
);

select isnt(
  (select (public.app_update_team_task_status(
    (select (task ->> 'id')::uuid from team_task), 'done') ->> 'completed_at')),
  null,
  'moving to Done stamps completed_at'
);

select is(
  (select (public.app_update_team_task_status(
    (select (task ->> 'id')::uuid from team_task), 'todo') ->> 'completed_at')),
  null,
  'and moving back out of Done clears it again'
);

select throws_ok(
  $$ select public.app_update_team_task_details(
       (select (task ->> 'id')::uuid from team_task),
       '{"priority":"low"}'::jsonb
     ) $$,
  '42501',
  null,
  'but a staff assignee may NOT edit priority: that needs team_tasks.manage'
);

select throws_ok(
  $$ select public.app_update_team_task_status(
       (select (task ->> 'id')::uuid from team_task), 'archived') $$,
  '22023',
  null,
  'an unknown status is refused'
);

select pg_temp.become('7ea00000-0000-4000-8000-000000000001');

select is(
  (select public.app_update_team_task_details(
    (select (task ->> 'id')::uuid from team_task),
    '{"priority":"urgent"}'::jsonb) ->> 'priority'),
  'urgent',
  'a manage holder may change priority'
);

select is(
  (select public.app_update_team_task_details(
    (select (task ->> 'id')::uuid from team_task),
    '{"priority":"urgent"}'::jsonb) ->> 'title'),
  'Fix the subscription mobile layout',
  'and a sparse patch leaves untouched fields alone'
);

select throws_ok(
  $$ select public.app_update_team_task_details(
       (select (task ->> 'id')::uuid from team_task),
       '{"assigned_to_profile_id":"7ea00000-0000-4000-8000-000000000003"}'::jsonb
     ) $$,
  '22023',
  null,
  'reassignment to a non-member is refused: assignment never widens thread access'
);

-- =============================================================================
-- H. The outsider: an internal colleague party to nothing
-- =============================================================================

select pg_temp.become('7ea00000-0000-4000-8000-000000000003');

select throws_ok(
  $$ select public.app_get_team_conversation((select conversation_id from team_fx)) $$,
  '42501',
  null,
  'an uninvolved employee cannot read somebody else private thread'
);

select throws_ok(
  $$ select public.app_send_team_message(
       gen_random_uuid(), (select conversation_id from team_fx), 'butting in') $$,
  '42501',
  null,
  'nor write into it'
);

select throws_ok(
  $$ select public.app_update_team_task_status(
       (select (task ->> 'id')::uuid from team_task), 'done') $$,
  '42501',
  null,
  'nor move a task inside it'
);

select is(
  (select count(*) from public.app_list_team_conversations()),
  0::bigint,
  'and their own conversation list is empty rather than leaky'
);

select is(
  (select count(*) from public.app_list_my_team_tasks(true)),
  0::bigint,
  'asking for Team Tasks without the capability returns nothing, not everything'
);

-- =============================================================================
-- I. Client isolation — the boundary this whole domain exists to hold
-- =============================================================================

select pg_temp.become('7ea00000-0000-4000-8000-000000000004');

select throws_ok(
  $$ select public.app_list_team_members() $$,
  '42501',
  null,
  'a client account cannot even list internal staff through this domain'
);

select throws_ok(
  $$ select public.app_list_team_conversations() $$,
  '42501',
  null,
  'nor list internal conversations'
);

select throws_ok(
  $$ select public.app_get_team_conversation((select conversation_id from team_fx)) $$,
  '42501',
  null,
  'nor open one by id'
);

select throws_ok(
  $$ select public.app_send_team_message(
       gen_random_uuid(), (select conversation_id from team_fx), 'hello staff') $$,
  '42501',
  null,
  'nor send into one'
);

select throws_ok(
  $$ select public.app_list_my_team_tasks(false) $$,
  '42501',
  null,
  'nor read internal team tasks'
);

-- =============================================================================
-- J. Notification catalog: team is internal by definition
-- =============================================================================

select is(
  private.notification_category_permission('internal', 'team'),
  'team_messages.use',
  'an internal team notification requires the messaging capability'
);

select ok(
  private.notification_category_non_deliverable('client', 'team'),
  'and (client, team) is a DECIDED refusal, not an undecided gap'
);

select ok(
  not private.profile_has_permission(
    '7ea00000-0000-4000-8000-000000000004', 'team_messages.use'),
  'a client account does not hold team_messages.use at delivery time'
);

-- The emitter is the gate: it inserts only where the recipient still holds the
-- capability, so a client recipient produces no row rather than a filtered one.
select lives_ok(
  $$ select private.emit_team_notification(
       '7ea00000-0000-4000-8000-000000000004',
       'team-leak-attempt',
       'leak', 'leak', '/', 'team_message',
       gen_random_uuid(),
       '7ea00000-0000-4000-8000-000000000001') $$,
  'emitting a team notification at a client account does not error'
);

select is(
  (select count(*) from public.notifications where event_key = 'team-leak-attempt'),
  0::bigint,
  'but writes nothing: internal conversation never reaches a client inbox'
);

select * from finish();
rollback;
