begin;

select plan(59);

-- WL-2.20 (KI-126): a Team notification belongs to its Team conversation's
-- Tenant. WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B =
-- ...000000001701, Tenant C = ...000000001702 (no fixture membership).

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back). Message bodies avoid underscores: Team previews
-- strip Markdown emphasis.
-- -----------------------------------------------------------------------------

-- 1701 Alice, 1702 Bob: staff in WF AND B (Bob is the dual-Tenant recipient).
-- 1703 Carol: WF admin. 1704 Dave: B admin (B only).
-- 1705 Eve: WF staff and B staff; her B membership is archived mid-run.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'team-notif-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['1701', '1702', '1703', '1704', '1705']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001701', 'team-notif-tenant-b', 'Team Notif Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001702', 'team-notif-tenant-c', 'Team Notif Tenant C', 'active');

update public.profiles as profile
set role_id = role.id, display_name = 'TeamNotif ' || right(fixture.profile_id, 4)
from (values
  ('20000000-0000-4000-8000-000000001701', 'staff'),
  ('20000000-0000-4000-8000-000000001702', 'staff'),
  ('20000000-0000-4000-8000-000000001703', 'admin'),
  ('20000000-0000-4000-8000-000000001705', 'staff')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

update public.profiles set display_name = 'TeamNotif 1704'
where id = '20000000-0000-4000-8000-000000001704';

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-000000001701', fixture.profile_id::uuid, 'internal', role.id
from (values
  ('20000000-0000-4000-8000-000000001701', 'staff'),
  ('20000000-0000-4000-8000-000000001702', 'staff'),
  ('20000000-0000-4000-8000-000000001704', 'admin'),
  ('20000000-0000-4000-8000-000000001705', 'staff')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name;

create temp table fixture_ids (k text primary key, v uuid);
create temp table fixture_snaps (k text primary key, v text);
grant all on fixture_ids, fixture_snaps to authenticated;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_selector
    when 'wf' then ''
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001701"}'
    when 'c' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001702"}'
    when 'unknown' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000017ff"}'
    when 'malformed' then '{"x-wf-tenant":"not-a-tenant"}'
    end, true);
$$;

create function pg_temp.id(p_key text)
returns uuid
language sql
as $$ select v from fixture_ids where k = p_key $$;

create function pg_temp.keep(p_key text, p_value uuid)
returns uuid
language sql
as $$ insert into fixture_ids values (p_key, p_value) returning v $$;

create function pg_temp.try(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Everything the caller's notification list exposes, as one searchable text.
create function pg_temp.feed()
returns text
language sql
as $$
  select coalesce(string_agg(concat_ws(' ', listed.title, listed.body, listed.event_key,
    listed.entity_id, listed.href), E'\n'), '')
  from public.app_list_my_notifications(100) as listed;
$$;

-- Client badge = unread rows of the list.
create function pg_temp.unread()
returns bigint
language sql
as $$ select count(*) from public.app_list_my_notifications(100) where read_at is null $$;

grant execute on function pg_temp.act(text, text), pg_temp.id(text), pg_temp.keep(text, uuid),
  pg_temp.try(text), pg_temp.feed(), pg_temp.unread() to authenticated;

-- Byte-level snapshot of one Tenant's fixture notification rows (postgres).
create function pg_temp.snap(p_tenant uuid)
returns text
language sql
as $$
  select md5(coalesce(string_agg(notification::text, '|' order by notification.id), ''))
  from public.notifications as notification
  where notification.recipient_profile_id::text like '20000000-0000-4000-8000-0000000017%'
    and notification.tenant_id = p_tenant;
$$;

-- -----------------------------------------------------------------------------
-- Schema: root ownership, required for Team rows only
-- -----------------------------------------------------------------------------

select has_column('public', 'notifications', 'tenant_id', 'notifications.tenant_id exists');
select col_hasnt_default('public', 'notifications', 'tenant_id', 'tenant_id has no default (no identity_tenant_id bridge)');
select fk_ok('public', 'notifications', 'tenant_id', 'public', 'tenants', 'id');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_team_tenant_required'),
  'CHECK (((category <> ''team''::text) OR (tenant_id IS NOT NULL)))',
  'Team notifications must carry a Tenant'
);
select is(
  pg_temp.try($$insert into public.notifications (recipient_profile_id, audience, category, variant,
    title, body, href, event_key) values ('20000000-0000-4000-8000-000000001702', 'internal', 'team',
    'info', 'x', 'x', '/dashboard', 'wl220-null-team')$$),
  '23514', 'a Team notification without a Tenant is rejected'
);

-- -----------------------------------------------------------------------------
-- Generate WF and B Team notifications for the same recipient (Bob)
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('1701', 'wf');
select pg_temp.keep('wf_group', public.app_create_team_group('WF_SECRET_GROUP_ALPHA',
  array['20000000-0000-4000-8000-000000001702', '20000000-0000-4000-8000-000000001705']::uuid[]));
select pg_temp.keep('wf_dm', public.app_start_team_conversation('20000000-0000-4000-8000-000000001702'));
select pg_temp.keep('wf_task', (public.app_create_team_task(gen_random_uuid(), pg_temp.id('wf_dm'),
  'WF_SECRET_TASK_ALPHA', '20000000-0000-4000-8000-000000001702') ->> 'id')::uuid);
select public.app_send_team_message(gen_random_uuid(), pg_temp.id('wf_dm'), 'WFSECRETPREVIEWALPHA');

select pg_temp.act('1701', 'b');
select pg_temp.keep('b_group', public.app_create_team_group('B_SECRET_GROUP_BRAVO',
  array['20000000-0000-4000-8000-000000001702', '20000000-0000-4000-8000-000000001704',
        '20000000-0000-4000-8000-000000001705']::uuid[]));
select pg_temp.keep('b_dm', public.app_start_team_conversation('20000000-0000-4000-8000-000000001702'));
select pg_temp.keep('b_task', (public.app_create_team_task(gen_random_uuid(), pg_temp.id('b_dm'),
  'B_SECRET_TASK_BRAVO', '20000000-0000-4000-8000-000000001702') ->> 'id')::uuid);
select public.app_send_team_message(gen_random_uuid(), pg_temp.id('b_dm'), 'BSECRETPREVIEWBRAVO');

reset role;
update public.team_message_deliveries set eligible_at = now() - interval '1 minute'
where recipient_profile_id = '20000000-0000-4000-8000-000000001702';
set local role authenticated;

select pg_temp.act('1702', 'wf');
select is(public.app_materialize_team_message_digests(), 1, 'WF digest run materializes one WF digest');
select pg_temp.act('1702', 'b');
select is(public.app_materialize_team_message_digests(), 1, 'B digest run materializes one B digest');

-- -----------------------------------------------------------------------------
-- Creation: every Team row is stamped from its Team subject's conversation
-- -----------------------------------------------------------------------------

reset role;
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001702' and category = 'team'
    and tenant_id = private.wolf_forge_tenant_id()), 3::bigint,
  'Bob has 3 WF Team notifications (group, task, digest)');
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001702' and category = 'team'
    and tenant_id = 'f0f0f0f0-0000-4000-8000-000000001701'), 3::bigint,
  'Bob has 3 B Team notifications (group, task, digest)');
select is((select tenant_id from public.notifications
  where entity_type = 'team_task' and entity_id = pg_temp.id('b_task')),
  'f0f0f0f0-0000-4000-8000-000000001701'::uuid, 'task notification: task -> conversation -> Tenant B');
select is((select tenant_id from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001702'
    and entity_type = 'team_conversation' and entity_id = pg_temp.id('b_group')),
  'f0f0f0f0-0000-4000-8000-000000001701'::uuid, 'group notification: conversation -> Tenant B');
select is((select tenant_id from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001702'
    and event_key like 'team-message-digest:' || pg_temp.id('b_dm') || ':%'),
  'f0f0f0f0-0000-4000-8000-000000001701'::uuid, 'digest notification: conversation -> Tenant B');
select is((select count(*) from public.notifications as notification
  join public.team_conversations as conversation_row
    on conversation_row.id = coalesce(
      (select task_row.conversation_id from public.team_tasks as task_row where task_row.id = notification.entity_id),
      notification.entity_id)
  where notification.recipient_profile_id::text like '20000000-0000-4000-8000-0000000017%'
    and notification.category = 'team'
    and notification.tenant_id is distinct from conversation_row.tenant_id), 0::bigint,
  'no fixture Team notification disagrees with its conversation Tenant');

-- Eve's B access ends; her B group notification stays B-owned.
update public.tenant_memberships set archived_at = now()
where tenant_id = 'f0f0f0f0-0000-4000-8000-000000001701'
  and profile_id = '20000000-0000-4000-8000-000000001705';

-- A legacy non-Team row keeps today's behavior (NULL Tenant, not stamped).
insert into public.notifications (recipient_profile_id, audience, category, variant,
  title, body, href, event_key)
values ('20000000-0000-4000-8000-000000001703', 'internal', 'client', 'info',
  'WL220_LEGACY_CLIENT', 'legacy', '/dashboard', 'wl220-legacy-client');

insert into fixture_ids
select 'bob_b_' || row_number() over (order by id), id from public.notifications
where recipient_profile_id = '20000000-0000-4000-8000-000000001702'
  and tenant_id = 'f0f0f0f0-0000-4000-8000-000000001701';
insert into fixture_ids
select 'bob_wf_' || row_number() over (order by id), id from public.notifications
where recipient_profile_id = '20000000-0000-4000-8000-000000001702'
  and tenant_id = private.wolf_forge_tenant_id();
insert into fixture_ids
select 'eve_b', id from public.notifications
where recipient_profile_id = '20000000-0000-4000-8000-000000001705'
  and tenant_id = 'f0f0f0f0-0000-4000-8000-000000001701';
insert into fixture_snaps values ('b0', pg_temp.snap('f0f0f0f0-0000-4000-8000-000000001701'));

set local role authenticated;

-- -----------------------------------------------------------------------------
-- TENANT A -> A and A -> B: Bob under Wolf Forge
-- -----------------------------------------------------------------------------

select pg_temp.act('1702', 'wf');
select ok(pg_temp.feed() ~ 'WF_SECRET_GROUP_ALPHA', 'WF list: WF group notification');
select ok(pg_temp.feed() ~ 'WF_SECRET_TASK_ALPHA', 'WF list: WF task notification');
select ok(pg_temp.feed() ~ 'WFSECRETPREVIEWALPHA', 'WF list: WF digest preview');
select ok(pg_temp.feed() !~ 'B_?SECRET', 'WF list: no B group title, task title or digest preview');
select is((select count(*) from public.app_list_my_notifications(100) as listed
  join fixture_ids as ids on ids.v = listed.id where ids.k like 'bob_b_%'), 0::bigint,
  'WF list: no B notification id');
select ok(pg_temp.feed() !~ (pg_temp.id('b_group')::text || '|' || pg_temp.id('b_dm')::text || '|' || pg_temp.id('b_task')::text),
  'WF list: no B conversation or task id in entity / href / event key');
select is(pg_temp.unread(), 3::bigint, 'WF unread count = 3 (WF rows only)');

select is(public.app_mark_notification_read(pg_temp.id('bob_b_1')), false, 'WF -> B: mark one B notification read refused');
select is(public.app_mark_notification_read(pg_temp.id('bob_b_2')), false, 'WF -> B: second B id refused');
select is(pg_temp.try(format('select public.app_mark_team_conversation_read(%L)', pg_temp.id('b_dm'))),
  '42501', 'WF -> B: marking the B conversation read is refused');
select is(public.app_mark_all_notifications_read(), 3, 'WF mark-all touches exactly the 3 WF rows');
select is(pg_temp.unread(), 0::bigint, 'WF unread count = 0 after mark-all');
select is(public.app_mark_notification_read(pg_temp.id('bob_wf_1')), true, 'same-Tenant mark-read still works');

reset role;
select is(pg_temp.snap('f0f0f0f0-0000-4000-8000-000000001701'), (select v from fixture_snaps where k = 'b0'),
  'B rows byte-identical after the WF session');
insert into fixture_snaps values ('wf1', pg_temp.snap(private.wolf_forge_tenant_id()));
set local role authenticated;

-- -----------------------------------------------------------------------------
-- TENANT B -> B and B -> A: Bob under Tenant B
-- -----------------------------------------------------------------------------

select pg_temp.act('1702', 'b');
select ok(pg_temp.feed() ~ 'B_SECRET_GROUP_BRAVO', 'B list: B group notification');
select ok(pg_temp.feed() ~ 'B_SECRET_TASK_BRAVO', 'B list: B task notification');
select ok(pg_temp.feed() ~ 'BSECRETPREVIEWBRAVO', 'B list: B digest preview');
select ok(pg_temp.feed() !~ 'WF_?SECRET', 'B list: no WF group title, task title or digest preview');
select is((select count(*) from public.app_list_my_notifications(100) as listed
  join fixture_ids as ids on ids.v = listed.id where ids.k like 'bob_wf_%'), 0::bigint,
  'B list: no WF notification id');
select is(pg_temp.unread(), 3::bigint, 'B unread count = 3: WF mark-all did not touch B');
select is(public.app_mark_notification_read(pg_temp.id('bob_wf_2')), false, 'B -> WF: mark WF notification read refused');

reset role;
select is(pg_temp.snap(private.wolf_forge_tenant_id()), (select v from fixture_snaps where k = 'wf1'),
  'WF rows byte-identical after the B session');
set local role authenticated;

select pg_temp.act('1702', 'b');
select is(public.app_mark_notification_read(pg_temp.id('bob_b_1')), true, 'B -> B: mark-read works');
select is(public.app_mark_all_notifications_read(), 2, 'B mark-all touches the 2 remaining B rows');
select is(pg_temp.unread(), 0::bigint, 'B unread count = 0 after mark-all');

-- -----------------------------------------------------------------------------
-- B-only, archived and selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1704', 'b');
select ok(pg_temp.feed() ~ 'B_SECRET_GROUP_BRAVO', 'Dave (B only) sees his B group notification under B');
select pg_temp.act('1704', 'wf');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501',
  'Dave (no WF membership) cannot list under WF');

select pg_temp.act('1705', 'b');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501',
  'Eve (archived B) cannot list under B');
select is(pg_temp.try(format('select public.app_mark_notification_read(%L)', pg_temp.id('eve_b'))), '42501',
  'Eve (archived B) cannot mark her B notification under B');
select pg_temp.act('1705', 'wf');
select ok(pg_temp.feed() ~ 'WF_SECRET_GROUP_ALPHA', 'Eve sees her WF group notification under WF');
select ok(pg_temp.feed() !~ 'B_?SECRET', 'Eve under WF: no B group notification');
select is(public.app_mark_notification_read(pg_temp.id('eve_b')), false, 'Eve under WF cannot mark her B notification');
select is(public.app_mark_all_notifications_read(), 1, 'Eve WF mark-all touches only the WF row');

select pg_temp.act('1702', 'c');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501', 'selector C: list refused');
select is(pg_temp.try(format('select public.app_mark_notification_read(%L)', pg_temp.id('bob_b_2'))), '42501',
  'selector C: mark-read refused');
select is(pg_temp.try('select public.app_mark_all_notifications_read()'), '42501', 'selector C: mark-all refused');
select pg_temp.act('1702', 'unknown');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501', 'unknown selector: list refused');
select pg_temp.act('1702', 'malformed');
select is(pg_temp.try('select public.app_list_my_notifications(100)'), '42501', 'malformed selector: list refused');
select is(pg_temp.try('select public.app_mark_all_notifications_read()'), '42501', 'malformed selector: mark-all refused');

-- -----------------------------------------------------------------------------
-- Legacy non-Team rows unchanged; zero residue
-- -----------------------------------------------------------------------------

select pg_temp.act('1703', 'wf');
select ok(pg_temp.feed() ~ 'WL220_LEGACY_CLIENT', 'legacy non-Team row (NULL Tenant) still listed');
select ok(pg_temp.feed() !~ 'B_?SECRET', 'Carol (WF only) sees no B Team text');

reset role;
select is((select read_at from public.notifications where id = pg_temp.id('eve_b')), null,
  'Eve''s B notification still unread after every refused attempt');
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001702'), 6::bigint,
  'Bob: no extra rows created by refused attempts');
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001702' and read_at is null), 0::bigint,
  'Bob: only his own-Tenant mark-read calls changed read state');
select is((select count(*) from public.notifications
  where recipient_profile_id::text like '20000000-0000-4000-8000-0000000017%'
    and category = 'team' and tenant_id is null), 0::bigint, 'no Tenant-less Team notification');
select is((select count(*) from public.notifications
  where recipient_profile_id::text like '20000000-0000-4000-8000-0000000017%'
    and category <> 'team' and tenant_id is not null), 0::bigint, 'non-Team rows are not stamped');

select * from finish();
rollback;
