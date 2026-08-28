begin;

select plan(121);

-- Team Communication V2.6 — conversation governance: owner model, delegated
-- admin capabilities, Slow Mode, task-creation policy authority, and the
-- task-timeline / audit-trail fix. Every browser-callable function derives
-- the actor from auth.uid(); no test passes a profile id as authority.

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7fb00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'v26-aria@example.invalid', now(), now()),
  ('7fb00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'v26-ben@example.invalid', now(), now()),
  ('7fb00000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'v26-cora@example.invalid', now(), now()),
  ('7fb00000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'v26-dane@example.invalid', now(), now()),
  ('7fb00000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'v26-client@example.invalid', now(), now());

-- Aria is the group creator/owner. Cora holds org-wide team_tasks.manage
-- (role 'admin') while sitting only as a plain conversation MEMBER, which is
-- exactly the case that proves an org-wide grant cannot bypass conversation
-- policy. Ben (role 'staff') holds team_messages.use but no team_tasks.manage
-- at all, proving 'everyone' does not need it.
update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Aria Owner'
where id = '7fb00000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Ben Member'
where id = '7fb00000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'admin'), display_name = 'Cora Orgwide'
where id = '7fb00000-0000-4000-8000-000000000003';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), display_name = 'Dane Extra'
where id = '7fb00000-0000-4000-8000-000000000004';
update public.profiles set role_id = (select id from public.roles where name = 'client'), display_name = 'Client Account'
where id = '7fb00000-0000-4000-8000-000000000005';

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
create temp table v26_direct on commit drop as
select public.app_start_team_conversation('7fb00000-0000-4000-8000-000000000003') as conversation_id;
create temp table v26_group on commit drop as
select public.app_create_team_group('V26 Pod', array[
  '7fb00000-0000-4000-8000-000000000002'::uuid,
  '7fb00000-0000-4000-8000-000000000003'::uuid
]) as conversation_id;

-- -----------------------------------------------------------------------------
-- Schema and locked-table posture
-- -----------------------------------------------------------------------------

select has_column('public', 'team_conversations', 'slow_mode_seconds', 'Slow Mode duration is stored');
select has_column('public', 'team_conversations', 'slow_mode_scope', 'Slow Mode scope is stored');
select has_column('public', 'team_conversations', 'task_creation_policy', 'task creation policy is stored');
select is((select relrowsecurity from pg_class where oid = 'public.team_conversation_admins'::regclass), true, 'admin grants table has RLS');
select is((select relforcerowsecurity from pg_class where oid = 'public.team_conversation_admins'::regclass), true, 'admin grants table forces RLS');
select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'team_conversation_admins'), 0::bigint, 'admin grants table has zero policies');
set local role authenticated;
select throws_ok($$ select * from public.team_conversation_admins $$, '42501', null, 'browser role cannot read admin grant rows');
reset role;
select function_returns('public', 'app_rename_team_conversation', array['uuid','text'], 'jsonb', 'rename RPC returns a title envelope');
select function_returns('public', 'app_set_team_conversation_slow_mode', array['uuid','integer','text'], 'jsonb', 'Slow Mode RPC returns a state envelope');
select function_returns('public', 'app_set_team_task_creation_policy', array['uuid','text'], 'jsonb', 'task policy RPC returns a policy envelope');
select function_returns('public', 'app_grant_team_conversation_admin', array['uuid','uuid','jsonb'], 'jsonb', 'admin grant RPC returns a capability envelope');

-- -----------------------------------------------------------------------------
-- Owner model and default read-model state
-- -----------------------------------------------------------------------------

select is((public.app_get_team_conversation((select conversation_id from v26_group)) -> 'my_capabilities' ->> 'is_owner')::boolean, true, 'the group creator is reported as owner');
select is((public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'task_creation_policy'), 'everyone', 'task creation defaults to everyone');
select is((public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'slow_mode_seconds'), null, 'Slow Mode defaults to off');
select is(jsonb_array_length(public.app_get_team_conversation((select conversation_id from v26_group)) -> 'admins'), 0, 'a fresh group has no delegated admins');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select is((public.app_get_team_conversation((select conversation_id from v26_group)) -> 'my_capabilities' ->> 'is_owner')::boolean, false, 'a plain member is not reported as owner');

-- -----------------------------------------------------------------------------
-- Task-timeline fix: composer-created tasks get a chronological, idempotent
-- task_activity row; anchored (source-message) tasks are unchanged.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
values ('7fb10000-0000-4000-8000-000000000001', gen_random_uuid(), (select conversation_id from v26_group), '7fb00000-0000-4000-8000-000000000001', 'Please turn this into a task', now() - interval '2 minutes');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_create_team_task('7fb20000-0000-4000-8000-000000000001'::uuid, %L::uuid, 'Composer task', '7fb00000-0000-4000-8000-000000000002'::uuid) $$, (select conversation_id from v26_group)),
  'a plain member creates a task under the default everyone policy');
create temp table v26_task1 on commit drop as
select id from public.team_tasks where request_id = '7fb20000-0000-4000-8000-000000000001';
select is((select count(*) from public.team_messages where task_id = (select id from v26_task1) and message_type = 'task_activity' and task_action = 'created'), 1::bigint, 'a composer-created task gets exactly one chronological created activity row');
select lives_ok(
  format($$ select public.app_create_team_task('7fb20000-0000-4000-8000-000000000001'::uuid, %L::uuid, 'Composer task', '7fb00000-0000-4000-8000-000000000002'::uuid) $$, (select conversation_id from v26_group)),
  'retrying the same request_id replays the original task');
select is((select count(*) from public.team_messages where task_id = (select id from v26_task1) and message_type = 'task_activity' and task_action = 'created'), 1::bigint, 'a replayed create never duplicates the created activity row');
select is((select last_message_preview from public.app_list_team_conversations() where conversation_id = (select conversation_id from v26_group)), 'Ben Member created "Composer task"', 'the conversation list preview reports created, not reopened, for a new task');

-- Task-create replay hardening: V2.6 rewrote this RPC, and the replay branch
-- previously fetched by request_id alone (Codex low-severity finding). A
-- request_id already used by a DIFFERENT actor must not be silently replayed
-- as though it were this caller's own idempotent retry.
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.app_create_team_task('7fb20000-0000-4000-8000-000000000001'::uuid, %L::uuid, 'Hijack attempt', '7fb00000-0000-4000-8000-000000000001'::uuid) $$, (select conversation_id from v26_group)),
  '23505', null, 'a request_id already used by a different actor cannot be replayed as an idempotent retry');

-- Same actor, same request_id, a DIFFERENT conversation: the replay branch
-- must reject this too, not just the different-actor case above. Ben starts
-- a fresh direct conversation with Dane and reuses his own already-consumed
-- request_id there — the stored row still points at v26_group, so this must
-- fail exactly like the hijack attempt rather than silently returning
-- Ben's original group task as though it belonged to the new conversation.
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
create temp table v26_ben_direct on commit drop as
select public.app_start_team_conversation('7fb00000-0000-4000-8000-000000000004') as conversation_id;
select throws_ok(
  format($$ select public.app_create_team_task('7fb20000-0000-4000-8000-000000000001'::uuid, %L::uuid, 'Cross-conversation replay attempt', '7fb00000-0000-4000-8000-000000000002'::uuid) $$, (select conversation_id from v26_ben_direct)),
  '23505', null, 'a request_id already used by the SAME actor in a different conversation cannot be replayed there either');

select lives_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Anchored task', '7fb00000-0000-4000-8000-000000000002'::uuid, null, 'normal', null, '7fb10000-0000-4000-8000-000000000001'::uuid) $$, (select conversation_id from v26_group)),
  'a member creates a task anchored to a source message');
create temp table v26_task2 on commit drop as
select id from public.team_tasks where source_message_id = '7fb10000-0000-4000-8000-000000000001';
select is((select count(*) from public.team_messages where task_id = (select id from v26_task2) and message_type = 'task_activity'), 0::bigint, 'an anchored task gains no separate chronological activity row');

-- -----------------------------------------------------------------------------
-- Task creation policy is authoritative over CREATE; team_tasks.manage does
-- not bypass it, and stays fully intact for every OTHER task RPC.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_set_team_task_creation_policy(%L::uuid, 'owner_only') $$, (select conversation_id from v26_group)),
  'the owner sets task creation to owner only');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Blocked', '7fb00000-0000-4000-8000-000000000002'::uuid) $$, (select conversation_id from v26_group)),
  '42501', null, 'a plain member is refused under owner-only policy');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Blocked', '7fb00000-0000-4000-8000-000000000003'::uuid) $$, (select conversation_id from v26_group)),
  '42501', null, 'org-wide team_tasks.manage does NOT bypass owner-only policy');
select lives_ok(
  format($$ select public.app_update_team_task_status(%L::uuid, 'in_progress') $$, (select id from v26_task1)),
  'team_tasks.manage still governs status updates, unchanged by the policy that now gates create');
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Owner task', '7fb00000-0000-4000-8000-000000000001'::uuid) $$, (select conversation_id from v26_group)),
  'the owner can always create regardless of policy');

select lives_ok(
  format($$ select public.app_set_team_task_creation_policy(%L::uuid, 'admins_and_owner') $$, (select conversation_id from v26_group)),
  'the owner widens the policy to admins and owner');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Blocked', '7fb00000-0000-4000-8000-000000000002'::uuid) $$, (select conversation_id from v26_group)),
  '42501', null, 'a plain member is still refused before being made an admin');

-- -----------------------------------------------------------------------------
-- Delegated admin grants, anti-escalation, and revocation.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000002'::uuid, '{"manage_admins": true, "manage_members": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'the owner grants Ben manage_admins and manage_members only');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Admin task', '7fb00000-0000-4000-8000-000000000002'::uuid) $$, (select conversation_id from v26_group)),
  'admin status alone satisfies admins-and-owner, regardless of which specific capability was granted');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_create_team_task(gen_random_uuid(), %L::uuid, 'Blocked', '7fb00000-0000-4000-8000-000000000003'::uuid) $$, (select conversation_id from v26_group)),
  '42501', null, 'a plain, non-admin member is still refused under admins-and-owner');

-- Dane joins the group as a plain member before the escalation tests below
-- target him — a delegated admin can only grant a capability to a real
-- member (see the "target must be a member" guard exercised earlier).
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'the owner adds a new teammate to the group');
select is((select count(*) from public.team_conversation_members where conversation_id = (select conversation_id from v26_group) and profile_id = '7fb00000-0000-4000-8000-000000000004'), 1::bigint, 'the added teammate is now a member');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid, '{"manage_slow_mode": true}'::jsonb) $$, (select conversation_id from v26_group)),
  '42501', null, 'a delegated admin cannot grant a capability they do not hold themselves');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid, '{"manage_members": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'a delegated admin CAN grant a capability that is a subset of their own');
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_revoke_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'the owner revokes a delegated admin');
select is((select count(*) from public.team_conversation_admins where conversation_id = (select conversation_id from v26_group) and profile_id = '7fb00000-0000-4000-8000-000000000004'), 0::bigint, 'revoked admin no longer holds a grant row');

-- Owner protections: unconditional, cannot be diluted or removed.
select throws_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000001'::uuid, '{"manage_members": true}'::jsonb) $$, (select conversation_id from v26_group)),
  '22023', null, 'the owner can never be made a mere delegated admin');
select throws_ok(
  format($$ select public.app_remove_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000001'::uuid) $$, (select conversation_id from v26_group)),
  '22023', null, 'the owner can never be removed as a member');

-- -----------------------------------------------------------------------------
-- Rename: capability-gated, group-only, and audited.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.app_rename_team_conversation(%L::uuid, 'Renamed by Ben') $$, (select conversation_id from v26_group)),
  '42501', null, 'Ben cannot rename without the rename_conversation capability');
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000002'::uuid, '{"manage_admins": true, "manage_members": true, "rename_conversation": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'the owner widens Ben''s grant to include rename_conversation');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_rename_team_conversation(%L::uuid, 'Renamed by Ben') $$, (select conversation_id from v26_group)),
  'Ben renames the group once granted the capability');
select is((select title from public.team_conversations where id = (select conversation_id from v26_group)), 'Renamed by Ben', 'the stored title reflects the rename');
select is((select count(*) from public.team_messages where conversation_id = (select conversation_id from v26_group) and message_type = 'governance_activity' and body like '%renamed%'), 1::bigint, 'the rename is recorded as a chronological governance_activity row');
select is((select last_message_at from public.team_conversations where id = (select conversation_id from v26_group)), (select max(created_at) from public.team_messages where conversation_id = (select conversation_id from v26_group)), 'last_message_at rides the same plumbing every other Team event uses');
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.app_rename_team_conversation(%L::uuid, 'Not a group') $$, (select conversation_id from v26_direct)),
  '22023', null, 'a direct conversation cannot be renamed');

-- -----------------------------------------------------------------------------
-- Member management: group-only, capability-gated, owner excluded.
-- Dane already joined the group before the escalation tests above; this
-- section covers the remaining member-management surface.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  '22023', null, 'adding an existing member a second time is refused');
select throws_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_direct)),
  '22023', null, 'members cannot be added to a direct conversation');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_remove_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'a delegated admin with manage_members removes a teammate');
select is((select count(*) from public.team_conversation_members where conversation_id = (select conversation_id from v26_group) and profile_id = '7fb00000-0000-4000-8000-000000000004'), 0::bigint, 'the removed teammate is no longer a member');
select pg_temp.become('7fb00000-0000-4000-8000-000000000005');
select throws_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  '42501', null, 'a client account cannot manage Team conversation membership');

-- -----------------------------------------------------------------------------
-- Slow Mode: race-safe cooldown, owner exemption, and scope.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'first message while off') $$, 'Slow Mode off: a member sends freely');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'second message while off') $$, 'Slow Mode off: a second immediate send also succeeds');

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_set_team_conversation_slow_mode(%L::uuid, 1, 'members_and_admins') $$, (select conversation_id from v26_group)),
  'the owner turns Slow Mode on at 1 second, members and admins');
select is((select count(*) from public.team_messages where conversation_id = (select conversation_id from v26_group) and message_type = 'governance_activity' and body like '%Slow Mode%'), 1::bigint, 'turning Slow Mode on is recorded as a governance_activity row');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'first under slow mode') $$, 'a member sends once under a fresh Slow Mode cooldown');
select throws_ok(
  $$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'too soon') $$,
  'WF430', null, 'the same member is throttled on an immediate second send');
select throws_ok(
  $$ select public.app_send_team_reply(gen_random_uuid(), (select conversation_id from v26_group), 'too soon reply', '7fb10000-0000-4000-8000-000000000001'::uuid, 'turn this into a task') $$,
  'WF430', null, 'Slow Mode also gates the reply path, not only plain sends');
-- C1 fix: forwarding is a third actor-authored send path and was the one
-- V2.6 originally left completely ungated, letting a throttled member bypass
-- Slow Mode by forwarding with fresh request ids instead of sending.
select throws_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fb10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v26_group)),
  'WF430', null, 'Slow Mode also gates the forward path, not only plain sends and replies (C1 fix)');

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'owner message one') $$, 'the owner is exempt from Slow Mode');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'owner message two') $$, 'the owner remains exempt on an immediate second send');
select lives_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fb10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v26_group)),
  'the owner remains exempt from Slow Mode when forwarding too (C1 fix)');

select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'cora first under slow mode') $$, 'a plain member (Cora) sends once under members-and-admins scope');
select throws_ok(
  $$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'cora too soon') $$,
  'WF430', null, 'members-and-admins scope also throttles a plain member');

select pg_sleep(1.1);
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'after cooldown') $$, 'the cooldown clears once the window has actually elapsed');

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_set_team_conversation_slow_mode(%L::uuid, 1, 'members_only') $$, (select conversation_id from v26_group)),
  'the owner narrows Slow Mode scope to members only');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'admin exempt one') $$, 'a delegated admin (Ben) sends once under members-only scope');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'admin exempt two') $$, 'members-only scope exempts a delegated admin on an immediate second send');
select lives_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fb10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v26_group)),
  'members-only scope exempts a delegated admin''s forward too (C1 fix)');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'cora still throttled one') $$, 'a plain, non-admin member (Cora) still gets one send');
select throws_ok(
  $$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'cora still throttled two') $$,
  'WF430', null, 'members-only scope still throttles a plain, non-admin member');
select throws_ok(
  format($$ select public.app_forward_team_message(gen_random_uuid(), '7fb10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v26_group)),
  'WF430', null, 'members-only scope still throttles a plain, non-admin member''s forward too (C1 fix)');

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_set_team_conversation_slow_mode(%L::uuid, null, 'members_and_admins') $$, (select conversation_id from v26_group)),
  'the owner turns Slow Mode back off');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'free again one') $$, 'once off, a member sends freely again');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'free again two') $$, 'and a second immediate send also succeeds once Slow Mode is off');

-- C1 fix: idempotent forward replay and the still-active anti-spam limiter,
-- both proven now that Slow Mode is off and cannot itself explain a refusal.
select lives_ok(
  format($$ select public.app_forward_team_message('7fb30000-0000-4000-8000-000000000001'::uuid, '7fb10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v26_group)),
  'forward with an explicit request_id succeeds once Slow Mode is off');
select lives_ok(
  format($$ select public.app_forward_team_message('7fb30000-0000-4000-8000-000000000001'::uuid, '7fb10000-0000-4000-8000-000000000001'::uuid, %L::uuid) $$, (select conversation_id from v26_group)),
  'retrying the same forward request_id replays idempotently rather than duplicating');
select is((select count(*) from public.team_messages where request_id = '7fb30000-0000-4000-8000-000000000001'), 1::bigint, 'the idempotent forward replay produced exactly one message row, not two');
select ok(
  pg_get_functiondef('public.app_forward_team_message(uuid, uuid, uuid)'::regprocedure) ~* 'consume_rate_limit',
  'forwarding still runs the pre-existing anti-spam limiter, separately from and in addition to the new Slow Mode gate');

-- Fix 7 (concurrency): this pgTAP suite runs sequentially inside one psql
-- session/transaction, so it cannot exercise a genuine two-actual-session
-- race the way two real Vercel invocations or two browser tabs would — that
-- limitation is documented here rather than silently implied away. What CAN
-- be verified from a single session is that the write is structurally the
-- correct atomic primitive (a single INSERT ... ON CONFLICT DO UPDATE ...
-- WHERE, not a check-then-write pair that could race), plus the rapid
-- sequential duplicate-request coverage already exercised above (every
-- "one succeeds, the immediate next throws" pair in this Slow Mode section).
select ok(
  (select def ~* 'on conflict\s*\(conversation_id,\s*profile_id\)'
       and def ~* 'do update'
       and def ~* 'where[^;]*clock_timestamp\(\)'
   from (select pg_get_functiondef('private.enforce_team_slow_mode(uuid, uuid)'::regprocedure) as def) as f),
  'Slow Mode''s cooldown write is structurally the atomic conditional-upsert primitive (INSERT ... ON CONFLICT DO UPDATE ... WHERE next_allowed_at <= clock_timestamp()), not a separate check-then-write that could race — a genuine concurrent two-session test is not exercised by this sequential suite (documented, not claimed)');

-- -----------------------------------------------------------------------------
-- Task-creation policy: capability-gated authorship, audited.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_set_team_task_creation_policy(%L::uuid, 'everyone') $$, (select conversation_id from v26_group)),
  'the owner restores task creation to everyone');
select is((select count(*) from public.team_messages where conversation_id = (select conversation_id from v26_group) and message_type = 'governance_activity' and body like '%task creation%'), 3::bigint, 'every task-policy change is recorded as its own governance_activity row');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_set_team_task_creation_policy(%L::uuid, 'owner_only') $$, (select conversation_id from v26_group)),
  '42501', null, 'a plain member without manage_task_policy cannot change the policy');

-- -----------------------------------------------------------------------------
-- C2 regression: app_team_live_sync must preserve the full V2.4 semantics a
-- Codex red-team review found the first V2.6 draft had silently regressed —
-- hidden/tombstoned filtering in unread counting, my_last_read_at and
-- destination_search_text in signals, and the
-- greatest(last_message_at, updated_at) delta watermark (a plain
-- last_message_at > since check misses a conversation whose only change
-- since the caller's cursor was a metadata-only update).
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
create temp table v26_livesync_since on commit drop as select clock_timestamp() - interval '1 hour' as since;

select ok(
  (select signal ? 'my_last_read_at' from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_livesync_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text),
  'live-sync signals still include my_last_read_at — the field the regressed draft silently dropped');
select ok(
  (select signal ? 'destination_search_text' from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_livesync_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text),
  'live-sync signals still include destination_search_text — the field the regressed draft silently dropped');

-- Hidden-for-me filtering: Cora sends, Ben hides it for himself only, and
-- Ben's own live-sync unread_count for the group must drop by exactly one.
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'Cora message Ben will hide');
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
create temp table v26_hideme on commit drop as
select id from public.team_messages
where conversation_id = (select conversation_id from v26_group) and body = 'Cora message Ben will hide'
order by created_at desc limit 1;
create temp table v26_unread_before_hide on commit drop as
select (
  select (signal ->> 'unread_count')::int from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_livesync_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text
) as unread_count;
select public.app_hide_team_message_for_me((select id from v26_hideme));
select is(
  (select (signal ->> 'unread_count')::int from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_livesync_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text),
  (select unread_count - 1 from v26_unread_before_hide),
  'hiding a message for me excludes it from MY live-sync unread_count, exactly the V2.4 filter the regressed draft dropped');

-- Tombstone filtering: a message deleted for everyone must not count as
-- unread for anyone, including someone who never read it. The baseline is
-- captured BEFORE the message is even sent, so "send then immediately
-- delete" having zero net effect on the count is exactly the proof —
-- comparing against a snapshot taken AFTER the send (already counting the
-- message once) would invert the assertion.
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
create temp table v26_unread_baseline on commit drop as
select (
  select (signal ->> 'unread_count')::int from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_livesync_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text
) as unread_count;
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'Aria message to be tombstoned');
select public.app_delete_team_message_for_everyone((
  select id from public.team_messages
  where conversation_id = (select conversation_id from v26_group) and body = 'Aria message to be tombstoned'
  order by created_at desc limit 1
));
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select is(
  (select (signal ->> 'unread_count')::int from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_livesync_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text),
  (select unread_count from v26_unread_baseline),
  'sending then immediately deleting a message for everyone leaves my live-sync unread_count unchanged from before it was sent, exactly the V2.4 filter the regressed draft dropped');

-- greatest(last_message_at, updated_at) watermark: delete-for-everyone bumps
-- ONLY updated_at (by explicit V2.4 design — chronology is not rewritten),
-- so a cursor strictly between the two must still surface the conversation.
--
-- Two parts, deliberately split, because this whole pgTAP suite runs inside
-- ONE transaction and `private.set_updated_at()` (the standing trigger on
-- every `updated_at` column in this codebase) writes `now()` — the
-- TRANSACTION-frozen timestamp, identical for every row touched anywhere in
-- this entire file — which would silently overwrite any attempt to bump
-- `updated_at` to a real, later `clock_timestamp()` value for the rest of
-- this test run. That is a property of testing inside one long transaction,
-- not of the fix: in production each request is its own transaction, so
-- `now()` there IS the real request time. Part 1 proves the RPC still
-- intends the bump (structural, sidesteps the frozen-now issue entirely).
-- Part 2 proves the live-sync WATERMARK LOGIC itself correctly surfaces a
-- conversation whose only change was `updated_at`, using the trigger
-- temporarily disabled to write a genuine later `clock_timestamp()` value —
-- exactly the shape a real, separate request would produce.
select ok(
  pg_get_functiondef('public.app_delete_team_message_for_everyone(uuid)'::regprocedure) ~* 'set updated_at = deleted_at',
  'delete-for-everyone still bumps team_conversations.updated_at (never last_message_at) on every tombstone — the metadata-only signal the live-sync watermark depends on');

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
create temp table v26_watermark_since on commit drop as select clock_timestamp() as since;
select is(
  (select count(*) from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_watermark_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text),
  0::bigint,
  'the group does not appear in signals when nothing has changed since the cursor');
alter table public.team_conversations disable trigger team_conversations_set_updated_at;
update public.team_conversations set updated_at = clock_timestamp() where id = (select conversation_id from v26_group);
alter table public.team_conversations enable trigger team_conversations_set_updated_at;
select is(
  (select count(*) from jsonb_array_elements(
    (public.app_team_live_sync(null, (select since from v26_watermark_since)) -> 'signals')
  ) as signal where signal ->> 'conversation_id' = (select conversation_id from v26_group)::text),
  1::bigint,
  'a metadata-only bump to updated_at alone (never last_message_at) still surfaces the conversation via greatest(last_message_at, updated_at) — exactly the watermark the regressed draft dropped');

-- -----------------------------------------------------------------------------
-- H1: removing a delegated admin needs manage_admins IN ADDITION TO
-- manage_members — a manage_members-only actor must not be able to eject an
-- admin (and silently delete their grant) without holding manage_admins.
--
-- Setup calls below (adding/re-adding Dane, granting his admin role, and
-- toggling Slow Mode) are deliberately split between the owner and Ben
-- (already a delegated admin with manage_members + manage_admins +
-- rename_conversation from earlier sections) rather than funneled entirely
-- through the owner: private.consume_rate_limit's 'team.governance.actor.
-- minute' bucket (20/min, shared by every governance RPC) is per-ACTOR, and
-- this file's expanded H1/H2/H3 coverage would otherwise push the owner's
-- own bucket past its pre-existing, unrelated limit purely from test setup
-- churn — spreading setup calls across actors who already legitimately hold
-- the required capability is the correct fix, not raising or bypassing the
-- limit.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000002'::uuid, '{"manage_admins": true, "manage_members": true, "rename_conversation": true, "manage_slow_mode": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'the owner further widens Ben to include manage_slow_mode, so Ben can carry some of the H1/H2 setup load');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'Dane rejoins the group as a plain member ahead of the H1/H2 scenarios');

-- H2 (part 1): while Cora is still a plain member, Slow Mode under
-- members_only scope applies to her and the read model reports it. Any
-- leftover cooldown row of Cora's from the earlier Slow Mode section is
-- cleared first so this scenario starts from a known, deterministic state
-- rather than depending on how much real time has elapsed since then.
delete from private.team_slow_mode_cooldowns
where conversation_id = (select conversation_id from v26_group) and profile_id = '7fb00000-0000-4000-8000-000000000003';
select lives_ok(
  format($$ select public.app_set_team_conversation_slow_mode(%L::uuid, 2, 'members_only') $$, (select conversation_id from v26_group)),
  'Ben (delegated admin) turns Slow Mode on (2s, members only) ahead of the H2 promotion scenario');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'cora pre-promotion send') $$, 'Cora (still a plain member) sends once and starts a cooldown');
select is(
  (public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'my_next_allowed_send_at') is not null,
  true,
  'H2: Cora sees an active Slow Mode block while she is still a plain member under members_only scope');

-- H1 grant #1: manage_members ONLY (no manage_admins) — this is also the
-- moment that incidentally makes Cora a delegated admin, which is exactly
-- what H2 needs next: members_only scope exempts ANY admin row, regardless
-- of which specific capability it carries.
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000003'::uuid, '{"manage_members": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'the owner grants Cora manage_members only');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select is(
  (public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'my_next_allowed_send_at'),
  null,
  'H2: promoting Cora to (any) delegated admin under members_only scope immediately clears her OWN displayed Slow Mode block, even though the stored cooldown row is still in the future');
select is(
  (select count(*) from private.team_slow_mode_cooldowns
    where conversation_id = (select conversation_id from v26_group)
      and profile_id = '7fb00000-0000-4000-8000-000000000003'
      and next_allowed_at > clock_timestamp()),
  1::bigint,
  'H2: the stored cooldown row itself is untouched — only the read-model PRESENTATION changed, never cooldown history');

-- H1 matrix, using Cora (manage_members only) against Dane (plain member,
-- then delegated admin).
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok(
  format($$ select public.app_remove_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'H1: a manage_members-only admin removes an ORDINARY member — allowed');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'Dane rejoins the group again (via Ben)');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid, '{"manage_slow_mode": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'Ben makes Dane a delegated admin (manage_slow_mode only)');

select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.app_remove_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  '42501', null, 'H1: a manage_members-only admin removing a DELEGATED ADMIN is denied — manage_members alone is not enough');
select is(
  (select count(*) from public.team_conversation_admins where conversation_id = (select conversation_id from v26_group) and profile_id = '7fb00000-0000-4000-8000-000000000004'),
  1::bigint,
  'H1: the denied removal attempt left Dane''s admin grant (and membership) completely intact');

select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000003'::uuid, '{"manage_members": true, "manage_admins": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'the owner widens Cora to manage_members AND manage_admins');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok(
  format($$ select public.app_remove_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'H1: with BOTH manage_members and manage_admins, removing a delegated admin (Dane) is now allowed');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_add_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'Dane rejoins the group once more (via Ben)');
select lives_ok(
  format($$ select public.app_grant_team_conversation_admin(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid, '{"manage_slow_mode": true}'::jsonb) $$, (select conversation_id from v26_group)),
  'Ben re-grants Dane a delegated admin role');
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ select public.app_remove_team_conversation_member(%L::uuid, '7fb00000-0000-4000-8000-000000000004'::uuid) $$, (select conversation_id from v26_group)),
  'H1: the owner removing a delegated admin is always allowed');

-- -----------------------------------------------------------------------------
-- H2 (remaining): Slow Mode OFF, members_and_admins scope, and the owner
-- never displaying a block. Toggled by Ben (delegated manage_slow_mode) to
-- keep this file's setup load off the owner's own rate-limit bucket.
-- -----------------------------------------------------------------------------

delete from private.team_slow_mode_cooldowns
where conversation_id = (select conversation_id from v26_group) and profile_id = '7fb00000-0000-4000-8000-000000000003';
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_set_team_conversation_slow_mode(%L::uuid, 2, 'members_and_admins') $$, (select conversation_id from v26_group)),
  'Ben turns Slow Mode on (2s, members and admins) for the remaining H2 scenarios');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok($$ select public.app_send_team_message(gen_random_uuid(), (select conversation_id from v26_group), 'cora admin under members_and_admins') $$, 'Cora (now a delegated admin) sends once and starts a cooldown');
select is(
  (public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'my_next_allowed_send_at') is not null,
  true,
  'H2: an admin still shows an active block under members_and_admins scope — only members_only exempts admins');

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select lives_ok(
  format($$ select public.app_set_team_conversation_slow_mode(%L::uuid, null, 'members_and_admins') $$, (select conversation_id from v26_group)),
  'Ben turns Slow Mode off entirely');
select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select is(
  (public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'my_next_allowed_send_at'),
  null,
  'H2: turning Slow Mode off clears the displayed block immediately, even though Cora''s stored cooldown row is still in the future');
select pg_temp.become('7fb00000-0000-4000-8000-000000000001');
select is(
  (public.app_get_team_conversation((select conversation_id from v26_group)) ->> 'my_next_allowed_send_at'),
  null,
  'H2: the owner never reports an active Slow Mode block, under any configuration');

-- -----------------------------------------------------------------------------
-- H3: governance_activity and task_activity are system audit rows, not
-- author-owned chat — the existing delete-for-everyone RPC must refuse to
-- tombstone them even though it authorizes purely by author id, which would
-- otherwise let the actor who performed a governance change (or the actor
-- credited with a task event) erase their own audit trail entry.
-- -----------------------------------------------------------------------------

select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select throws_ok(
  format(
    $$ select public.app_delete_team_message_for_everyone((
      select id from public.team_messages
      where conversation_id = %L and message_type = 'governance_activity' and author_profile_id = '7fb00000-0000-4000-8000-000000000002'
      order by created_at desc limit 1
    )) $$,
    (select conversation_id from v26_group)
  ),
  '22023', null, 'H3: the actor who authored a governance_activity row cannot delete-for-everyone their own audit entry');

-- v26_task1's 'created' activity row is authored by Ben (he created that
-- task), so the author-only gate must be satisfied by Ben before the new
-- message_type guard is even reached — otherwise this would prove nothing
-- but the pre-existing author check.
select pg_temp.become('7fb00000-0000-4000-8000-000000000002');
select throws_ok(
  format(
    $$ select public.app_delete_team_message_for_everyone((
      select id from public.team_messages
      where task_id = %L and message_type = 'task_activity' and task_action = 'created'
    )) $$,
    (select id from v26_task1)
  ),
  '22023', null, 'H3: a task_activity row is likewise protected from delete-for-everyone');

select pg_temp.become('7fb00000-0000-4000-8000-000000000003');
select lives_ok(
  format(
    $$ select public.app_delete_team_message_for_everyone((
      select id from public.team_messages
      where conversation_id = %L and body = 'free again one' and author_profile_id = '7fb00000-0000-4000-8000-000000000003'
    )) $$,
    (select conversation_id from v26_group)
  ),
  'H3: an ordinary author-owned text message keeps its exact pre-existing delete-for-everyone behavior');

select * from finish();
rollback;
