begin;

select plan(78);

-- WL-2.19 (KI-122, D-269): a Team Chat conversation is owned by one Tenant.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001601,
-- Tenant C = ...000000001602 (no fixture membership).

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1601 Alice, 1602 Bob: staff in WF AND B (the dual-Tenant pair).
-- 1603 Carol: WF admin (WF supervisor). 1604 Dave: B admin (B supervisor, B only).
-- 1605 Eve: WF staff with an archived B staff membership.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'team-tenant-owner-' || n || '@example.invalid', now(), now()
from unnest(array['1601', '1602', '1603', '1604', '1605']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001601', 'team-owner-tenant-b', 'Team Owner Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001602', 'team-owner-tenant-c', 'Team Owner Tenant C', 'active');

update public.profiles as profile
set role_id = role.id, display_name = 'TeamOwner ' || right(fixture.profile_id, 4)
from (values
  ('20000000-0000-4000-8000-000000001601', 'staff'),
  ('20000000-0000-4000-8000-000000001602', 'staff'),
  ('20000000-0000-4000-8000-000000001603', 'admin'),
  ('20000000-0000-4000-8000-000000001605', 'staff')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

update public.profiles set display_name = 'TeamOwner 1604'
where id = '20000000-0000-4000-8000-000000001604';

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001601', fixture.profile_id::uuid, 'internal', role.id, fixture.archived_at
from (values
  ('20000000-0000-4000-8000-000000001601', 'staff', null::timestamptz),
  ('20000000-0000-4000-8000-000000001602', 'staff', null),
  ('20000000-0000-4000-8000-000000001604', 'admin', null),
  ('20000000-0000-4000-8000-000000001605', 'staff', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- Ids captured during the run.
create temp table fixture_ids (k text primary key, v uuid);
grant all on fixture_ids to authenticated;

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_selector
    when 'wf' then ''
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001601"}'
    when 'c' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001602"}'
    when 'unknown' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000016ff"}'
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

-- Runs one statement and returns 'ok' or its SQLSTATE.
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

-- Fixture conversation ids visible in the caller's inbox, as key list.
create function pg_temp.inbox()
returns text
language sql
as $$
  select coalesce(string_agg(ids.k, ',' order by ids.k), '')
  from public.app_list_team_conversations() as listed
  join fixture_ids as ids on ids.v = listed.conversation_id;
$$;

create function pg_temp.supervised()
returns text
language sql
as $$
  select coalesce(string_agg(ids.k, ',' order by ids.k), '')
  from public.app_list_team_supervised_conversations(100) as listed
  join fixture_ids as ids on ids.v = listed.conversation_id;
$$;

grant execute on function pg_temp.act(text, text), pg_temp.id(text), pg_temp.keep(text, uuid),
  pg_temp.try(text), pg_temp.inbox(), pg_temp.supervised() to authenticated;

-- -----------------------------------------------------------------------------
-- Schema: root ownership, Tenant-relative uniqueness, no child sprawl
-- -----------------------------------------------------------------------------

select col_not_null('public', 'team_conversations', 'tenant_id', 'team_conversations.tenant_id is NOT NULL');
select col_hasnt_default('public', 'team_conversations', 'tenant_id', 'tenant_id has no default (no identity_tenant_id bridge)');
select fk_ok('public', 'team_conversations', 'tenant_id', 'public', 'tenants', 'id');
select hasnt_index('public', 'team_conversations', 'team_conversations_conversation_key_key', 'global conversation_key uniqueness is gone');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'team_conversations_tenant_conversation_key_key'),
  'UNIQUE (tenant_id, conversation_key)',
  'conversation_key is unique per Tenant'
);
select is(
  (select count(*) from information_schema.columns
   where column_name = 'tenant_id'
     and table_schema in ('public', 'private')
     and table_name in ('team_conversation_members', 'team_conversation_admins', 'team_messages',
       'team_message_reactions', 'team_message_hidden_for_profiles', 'team_message_pins',
       'team_message_deliveries', 'team_typing_connections', 'team_tasks', 'team_voice_uploads',
       'team_slow_mode_cooldowns')),
  0::bigint,
  'children inherit through the conversation (no child tenant_id)'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Same pair, two Tenants -> two conversations; find is idempotent per Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', 'wf');
select pg_temp.keep('wf_dm', public.app_start_team_conversation('20000000-0000-4000-8000-000000001602'));
select pg_temp.act('1601', 'b');
select pg_temp.keep('b_dm', public.app_start_team_conversation('20000000-0000-4000-8000-000000001602'));

select isnt(pg_temp.id('wf_dm'), pg_temp.id('b_dm'), 'same pair: WF and B DMs are different conversations');

select pg_temp.act('1601', 'wf');
select is(public.app_start_team_conversation('20000000-0000-4000-8000-000000001602'), pg_temp.id('wf_dm'),
  'replay under WF returns the WF DM');
select pg_temp.act('1602', 'wf');
select is(public.app_start_team_conversation('20000000-0000-4000-8000-000000001601'), pg_temp.id('wf_dm'),
  'Bob under WF finds the same WF DM');
select pg_temp.act('1602', 'b');
select is(public.app_start_team_conversation('20000000-0000-4000-8000-000000001601'), pg_temp.id('b_dm'),
  'Bob under B finds the B DM, never the WF one');

reset role;
select is((select tenant_id from public.team_conversations where id = pg_temp.id('wf_dm')),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid, 'WF DM is owned by Wolf Forge');
select is((select tenant_id from public.team_conversations where id = pg_temp.id('b_dm')),
  'f0f0f0f0-0000-4000-8000-000000001601'::uuid, 'B DM is owned by Tenant B');
select is((select count(*) from public.team_conversations
  where conversation_key = '20000000-0000-4000-8000-000000001601|20000000-0000-4000-8000-000000001602'),
  2::bigint, 'exactly one DM per Tenant for the pair');
set local role authenticated;

-- A group is owned by the creator's current Tenant.
select pg_temp.act('1601', 'b');
select pg_temp.keep('b_group', public.app_create_team_group('B Group',
  array['20000000-0000-4000-8000-000000001602', '20000000-0000-4000-8000-000000001604']::uuid[]));
reset role;
select is((select tenant_id from public.team_conversations where id = pg_temp.id('b_group')),
  'f0f0f0f0-0000-4000-8000-000000001601'::uuid, 'group created under B is owned by Tenant B');
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Messages
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', 'wf');
select pg_temp.keep('wf_msg', (public.app_send_team_message(gen_random_uuid(), pg_temp.id('wf_dm'),
  'WOLF_FORGE_ALPHA quartzowl') ->> 'id')::uuid);
select pg_temp.act('1601', 'b');
select pg_temp.keep('b_msg', (public.app_send_team_message(gen_random_uuid(), pg_temp.id('b_dm'),
  'TENANT_B_BRAVO quartzowl') ->> 'id')::uuid);
select pg_temp.keep('b_msg2', (public.app_send_team_message(gen_random_uuid(), pg_temp.id('b_dm'),
  'TENANT_B_CHARLIE quartzowl') ->> 'id')::uuid);

-- -----------------------------------------------------------------------------
-- List / unread / live sync (enumerating paths)
-- -----------------------------------------------------------------------------

select pg_temp.act('1602', 'wf');
select is(pg_temp.inbox(), 'wf_dm', 'WF inbox lists only the WF DM');
select is(public.app_team_unread_count(), 1, 'WF unread counts only WF messages');
select is(
  (select jsonb_agg(signal ->> 'conversation_id' order by signal ->> 'conversation_id')
   from jsonb_array_elements(public.app_team_live_sync(null, '-infinity') -> 'signals') as signal
   where (signal ->> 'conversation_id')::uuid in (pg_temp.id('wf_dm'), pg_temp.id('b_dm'), pg_temp.id('b_group'))),
  jsonb_build_array(pg_temp.id('wf_dm')::text),
  'WF live sync signals only the WF DM'
);
select is((public.app_team_live_sync(null, '-infinity') ->> 'unread_total')::integer, 1,
  'WF live sync unread total counts only WF');

select pg_temp.act('1602', 'b');
select is(pg_temp.inbox(), 'b_dm,b_group', 'B inbox lists the B DM and B group only');
select is(public.app_team_unread_count(), 2, 'B unread counts only B messages');
select is((public.app_team_live_sync(null, '-infinity') ->> 'unread_total')::integer, 2,
  'B live sync unread total counts only B');

-- -----------------------------------------------------------------------------
-- Tenant A -> B by real id (shared gate): open, page, search, send, reply,
-- forward, reaction, read, typing, voice, task, live-sync detail
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', 'wf');
select is(pg_temp.try(format('select public.app_get_team_conversation(%L)', pg_temp.id('b_dm'))), '42501',
  'WF -> B: open refused');
select is(pg_temp.try(format('select public.app_get_team_conversation(%L)', gen_random_uuid())), '42501',
  'missing conversation refused identically');
select is(pg_temp.try(format('select public.app_list_team_messages_before(%L, %L, %L, 50)',
  pg_temp.id('b_dm'), 'infinity', 'ffffffff-ffff-4fff-8fff-ffffffffffff')), '42501', 'WF -> B: page refused');
select is(pg_temp.try(format('select public.app_get_team_message_window(%L, %L, 5, 5)',
  pg_temp.id('b_dm'), pg_temp.id('b_msg'))), '42501', 'WF -> B: message window refused');
select is(pg_temp.try(format('select public.app_search_team_conversation_messages(%L, %L)',
  pg_temp.id('b_dm'), 'BRAVO')), '42501', 'WF -> B: search refused');
select is(pg_temp.try(format('select public.app_send_team_message(%L, %L, %L)',
  gen_random_uuid(), pg_temp.id('b_dm'), 'INTRUDER_WRITE')), '42501', 'WF -> B: send refused');
select is(pg_temp.try(format('select public.app_send_team_reply(%L, %L, %L, %L, %L)',
  gen_random_uuid(), pg_temp.id('b_dm'), 'INTRUDER_REPLY', pg_temp.id('b_msg'), 'TENANT_B_BRAVO')), '42501',
  'WF -> B: reply into B refused');
select is(pg_temp.try(format('select public.app_send_team_reply(%L, %L, %L, %L, %L)',
  gen_random_uuid(), pg_temp.id('wf_dm'), 'INTRUDER_REPLY', pg_temp.id('b_msg'), 'TENANT_B_BRAVO')), '22023',
  'WF reply quoting a B message is refused as unavailable');
select is(pg_temp.try(format('select public.app_forward_team_message(%L, %L, %L)',
  gen_random_uuid(), pg_temp.id('b_msg'), pg_temp.id('wf_dm'))), '42501',
  'cross-Tenant forward B -> WF refused');
select is(pg_temp.try(format('select public.app_toggle_team_message_reaction(%L, %L)',
  pg_temp.id('b_msg'), 'like')), '42501', 'WF -> B: reaction refused');
select is(pg_temp.try(format('select public.app_hide_team_message_for_me(%L)', pg_temp.id('b_msg'))), '42501',
  'WF -> B: hide refused');
select is(pg_temp.try(format('select public.app_mark_team_conversation_read(%L)', pg_temp.id('b_dm'))), '42501',
  'WF -> B: mark read refused');
select is(pg_temp.try(format('select public.app_touch_team_typing(%L, %L)', pg_temp.id('b_dm'), gen_random_uuid())),
  '42501', 'WF -> B: typing refused');
select is(pg_temp.try(format('select public.app_list_team_typing(%L)', pg_temp.id('b_dm'))), '42501',
  'WF -> B: typing list refused');
select is(pg_temp.try(format('select public.app_prepare_team_voice_upload(%L, %L)', pg_temp.id('b_dm'), 'audio/webm')),
  '42501', 'WF -> B: voice upload refused');
select is(pg_temp.try(format('select public.app_create_team_task(%L, %L, %L, %L)',
  gen_random_uuid(), pg_temp.id('b_dm'), 'INTRUDER_TASK', '20000000-0000-4000-8000-000000001602')), '42501',
  'WF -> B: task creation refused');
select is(pg_temp.try(format('select public.app_team_live_sync(%L, null)', pg_temp.id('b_dm'))), '42501',
  'WF -> B: live sync detail refused');
select is(pg_temp.try(format('select public.app_rename_team_conversation(%L, %L)', pg_temp.id('b_group'), 'Renamed')),
  '42501', 'WF -> B: group rename refused');

-- Tenant B -> WF by real id.
select pg_temp.act('1601', 'b');
select is(pg_temp.try(format('select public.app_get_team_conversation(%L)', pg_temp.id('wf_dm'))), '42501',
  'B -> WF: open refused');
select is(pg_temp.try(format('select public.app_search_team_conversation_messages(%L, %L)',
  pg_temp.id('wf_dm'), 'ALPHA')), '42501', 'B -> WF: search refused');
select is(pg_temp.try(format('select public.app_forward_team_message(%L, %L, %L)',
  gen_random_uuid(), pg_temp.id('wf_msg'), pg_temp.id('b_dm'))), '42501',
  'cross-Tenant forward WF -> B refused');

-- Same-Tenant reads still work, and search stays inside its conversation.
select is(
  (select count(*) from jsonb_array_elements(
    public.app_search_team_conversation_messages(pg_temp.id('b_dm'), 'quartzowl') -> 'results')),
  2::bigint, 'B search finds only the two B bodies'
);
select ok(
  (public.app_get_team_conversation(pg_temp.id('b_dm')))::text not like '%WOLF_FORGE_ALPHA%',
  'B conversation detail never contains the WF body'
);
select pg_temp.act('1601', 'wf');
select is(
  (select count(*) from jsonb_array_elements(
    public.app_search_team_conversation_messages(pg_temp.id('wf_dm'), 'quartzowl') -> 'results')),
  1::bigint, 'WF search finds only the WF body'
);
select ok(
  (public.app_list_team_messages_before(pg_temp.id('wf_dm'), 'infinity', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 50))::text
    not like '%TENANT_B_%',
  'WF page never contains a B body'
);

-- Same-Tenant forward is preserved.
select is(pg_temp.try(format('select public.app_forward_team_message(%L, %L, %L)',
  gen_random_uuid(), pg_temp.id('wf_msg'), pg_temp.id('wf_dm'))), 'ok', 'same-Tenant forward still works');
select is(pg_temp.try(format('select public.app_toggle_team_message_reaction(%L, %L)',
  pg_temp.id('wf_msg'), 'like')), 'ok', 'same-Tenant reaction still works');

-- -----------------------------------------------------------------------------
-- Tasks: listed only in the conversation's Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1601', 'b');
select pg_temp.keep('b_task', (public.app_create_team_task(gen_random_uuid(), pg_temp.id('b_dm'),
  'TENANT_B_TASK', '20000000-0000-4000-8000-000000001602') ->> 'id')::uuid);
select pg_temp.act('1602', 'b');
select is((select count(*) from public.app_list_my_team_tasks() where id = pg_temp.id('b_task')), 1::bigint,
  'B task listed under B');
select pg_temp.act('1602', 'wf');
select is((select count(*) from public.app_list_my_team_tasks() where id = pg_temp.id('b_task')), 0::bigint,
  'B task not listed under WF');
select is(pg_temp.try(format('select public.app_update_team_task_status(%L, %L)', pg_temp.id('b_task'), 'done')),
  '42501', 'WF -> B: task status change refused');

-- -----------------------------------------------------------------------------
-- Digests: only the current Tenant's conversations become notifications
-- -----------------------------------------------------------------------------

reset role;
update public.team_message_deliveries set eligible_at = now() - interval '1 minute'
where recipient_profile_id = '20000000-0000-4000-8000-000000001602';
set local role authenticated;

select pg_temp.act('1602', 'wf');
select public.app_materialize_team_message_digests();
reset role;
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001602' and entity_id = pg_temp.id('b_dm')),
  0::bigint, 'WF digest run does not materialize the B conversation');
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001602' and entity_id = pg_temp.id('wf_dm')),
  1::bigint, 'WF digest run materializes the WF conversation');
set local role authenticated;
select pg_temp.act('1602', 'b');
select public.app_materialize_team_message_digests();
reset role;
select is((select count(*) from public.notifications
  where recipient_profile_id = '20000000-0000-4000-8000-000000001602' and entity_id = pg_temp.id('b_dm')),
  1::bigint, 'B digest run materializes the B conversation');
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Supervision (KI-121 / KI-122): both participants are internal in WF AND B,
-- so only the conversation Tenant separates them.
-- -----------------------------------------------------------------------------

select pg_temp.act('1603', 'wf');
select is(pg_temp.supervised(), 'wf_dm', 'WF supervisor lists only the WF DM');
select is(pg_temp.try(format('select public.app_get_team_supervised_conversation(%L, 50, null)', pg_temp.id('b_dm'))),
  'P0002', 'WF supervisor cannot open the B DM');
select is(pg_temp.try(format('select public.app_search_team_supervised_conversation_messages(%L, %L, null, null, 20, null)',
  pg_temp.id('b_dm'), 'BRAVO')), 'P0002', 'WF supervisor cannot search the B DM');
select is(pg_temp.try(format('select public.app_list_team_supervised_messages_before(%L, %L, %L, 50, null)',
  pg_temp.id('b_dm'), 'infinity', 'ffffffff-ffff-4fff-8fff-ffffffffffff')), 'P0002',
  'WF supervisor cannot page the B DM');
select is(pg_temp.try(format('select public.app_get_team_supervised_message_window(%L, %L, 5, 5, null)',
  pg_temp.id('b_dm'), pg_temp.id('b_msg'))), 'P0002', 'WF supervisor cannot window into the B DM');
select ok(
  (public.app_get_team_supervised_conversation(pg_temp.id('wf_dm'), 50, null))::text not like '%TENANT_B_%',
  'WF supervised transcript holds no B body'
);

select pg_temp.act('1604', 'b');
select is(pg_temp.supervised(), 'b_dm', 'B supervisor lists only the B DM');
select is(pg_temp.try(format('select public.app_get_team_supervised_conversation(%L, 50, null)', pg_temp.id('wf_dm'))),
  'P0002', 'B supervisor cannot open the WF DM');
select is(pg_temp.try(format('select public.app_get_team_supervised_conversation(%L, 50, null)', pg_temp.id('b_dm'))),
  'ok', 'B supervisor opens the B DM');

-- -----------------------------------------------------------------------------
-- Archived membership and selector attacks
-- -----------------------------------------------------------------------------

select pg_temp.act('1605', 'b');
select is(pg_temp.try(format('select public.app_start_team_conversation(%L)', '20000000-0000-4000-8000-000000001601')),
  '42501', 'archived B membership cannot start a B DM');
select pg_temp.act('1601', 'b');
select is(pg_temp.try(format('select public.app_start_team_conversation(%L)', '20000000-0000-4000-8000-000000001605')),
  '22023', 'a teammate archived in B cannot be messaged in B');

select pg_temp.act('1601', 'c');
select is(pg_temp.try(format('select public.app_start_team_conversation(%L)', '20000000-0000-4000-8000-000000001602')),
  '42501', 'Tenant C selector without membership: start refused');
select pg_temp.act('1601', 'unknown');
select is(pg_temp.try('select public.app_list_team_conversations()'), '42501', 'unknown selector: list refused');
select pg_temp.act('1601', 'malformed');
select is(pg_temp.try(format('select public.app_get_team_conversation(%L)', pg_temp.id('wf_dm'))), '42501',
  'malformed selector: never falls back to the WF DM');
select is(pg_temp.try(format('select public.app_create_team_group(%L, %L)', 'Bad Group',
  array['20000000-0000-4000-8000-000000001602', '20000000-0000-4000-8000-000000001603']::uuid[]::text)), '42501',
  'malformed selector: group creation refused');

-- -----------------------------------------------------------------------------
-- Zero residue from every blocked attack
-- -----------------------------------------------------------------------------

reset role;
select is((select count(*) from public.team_messages where conversation_id = pg_temp.id('b_dm') and message_type = 'text'),
  2::bigint, 'B DM still holds exactly its two text messages');
select is((select count(*) from public.team_messages where body like 'INTRUDER%'), 0::bigint,
  'no intruder message anywhere');
select is((select count(*) from public.team_message_reactions where message_id in (pg_temp.id('b_msg'), pg_temp.id('b_msg2'))),
  0::bigint, 'no reaction on B messages');
select is((select count(*) from public.team_message_hidden_for_profiles where message_id = pg_temp.id('b_msg')),
  0::bigint, 'no hide row on the B message');
select is((select count(*) from public.team_tasks where title = 'INTRUDER_TASK'), 0::bigint, 'no intruder task');
select is((select status from public.team_tasks where id = pg_temp.id('b_task')), 'todo', 'B task status unchanged');
select is((select count(*) from public.team_typing_connections where conversation_id = pg_temp.id('b_dm')), 0::bigint,
  'no typing row in the B DM');
select is((select title from public.team_conversations where id = pg_temp.id('b_group')), 'B Group',
  'B group name unchanged');
select is((select count(*) from public.team_conversations
  where created_by_profile_id in ('20000000-0000-4000-8000-000000001601', '20000000-0000-4000-8000-000000001605')),
  3::bigint, 'blocked attempts created no conversation');

select * from finish();

rollback;
