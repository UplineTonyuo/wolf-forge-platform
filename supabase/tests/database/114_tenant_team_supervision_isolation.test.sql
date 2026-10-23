begin;

select plan(45);

-- WL-2.17 (KI-121): a supervisor reads only direct conversations whose two
-- participants are internal members of the caller's current Tenant.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001401.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- Supervisors: 1401 WF admin; 1402 B admin (B only, global role untouched);
-- 1410 B admin with an archived B membership; 1413 owner of WF and B.
-- Participants: 1403 / 1404 WF staff; 1405 / 1406 B staff (B only);
-- 1408 staff in WF (archived there) and B (active); 1411 B client; 1412
-- archived B staff (profile active).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'team-supervision-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['1401', '1402', '1403', '1404', '1405', '1406', '1408', '1410',
  '1411', '1412', '1413']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001401', 'team-supervision-tenant-b', 'Team Supervision Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values ('c0000000-0000-4000-8000-000000001401', 'f0f0f0f0-0000-4000-8000-000000001401', 'TEAM_SUPERVISION_B_CLIENT', 'client');

-- Wolf Forge memberships through the compatibility fields.
update public.profiles as profile
set role_id = role.id,
    display_name = 'TeamSup ' || right(fixture.profile_id, 4)
from (values
  ('20000000-0000-4000-8000-000000001401', 'admin'),
  ('20000000-0000-4000-8000-000000001403', 'staff'),
  ('20000000-0000-4000-8000-000000001404', 'staff'),
  ('20000000-0000-4000-8000-000000001408', 'staff'),
  ('20000000-0000-4000-8000-000000001413', 'owner')
) as fixture(profile_id, role_name)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

-- Archive 1408 in Wolf Forge only (the mirror archives the WF membership).
update public.profiles set archived_at = now() where id = '20000000-0000-4000-8000-000000001408';

update public.profiles set display_name = 'TeamSup ' || right(id::text, 4)
where id in ('20000000-0000-4000-8000-000000001402', '20000000-0000-4000-8000-000000001405',
  '20000000-0000-4000-8000-000000001406', '20000000-0000-4000-8000-000000001410',
  '20000000-0000-4000-8000-000000001411', '20000000-0000-4000-8000-000000001412');

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001401', fixture.profile_id::uuid, fixture.account_class,
  role.id, fixture.company_id::uuid, fixture.archived_at
from (values
  ('20000000-0000-4000-8000-000000001402', 'admin', 'internal', null, null::timestamptz),
  ('20000000-0000-4000-8000-000000001405', 'staff', 'internal', null, null),
  ('20000000-0000-4000-8000-000000001406', 'staff', 'internal', null, null),
  ('20000000-0000-4000-8000-000000001408', 'staff', 'internal', null, null),
  ('20000000-0000-4000-8000-000000001410', 'admin', 'internal', null, now()),
  ('20000000-0000-4000-8000-000000001411', 'client', 'client', 'c0000000-0000-4000-8000-000000001401', null),
  ('20000000-0000-4000-8000-000000001412', 'staff', 'internal', null, now()),
  ('20000000-0000-4000-8000-000000001413', 'owner', 'internal', null, null)
) as fixture(profile_id, role_name, account_class, company_id, archived_at)
join public.roles as role on role.name = fixture.role_name;

-- Direct conversations: 1451 WF (1403|1404); 1452 B (1405|1406); 1453 mixed
-- (1403|1405); 1454 B staff + B client (1405|1411); 1455 B staff + archived B
-- staff (1405|1412); 1456 WF staff + dual staff (1403|1408); 1457 B staff +
-- dual staff (1405|1408).
-- Conversation Tenant (WL-2.19): B for the B-only pairs, WF otherwise.
insert into public.team_conversations (tenant_id, id, conversation_key, created_by_profile_id, kind, last_message_at, created_at)
select case when c in ('1452', '1454', '1455', '1457')
    then 'f0f0f0f0-0000-4000-8000-000000001401'::uuid else private.wolf_forge_tenant_id() end,
  ('7f710000-0000-4000-8000-00000000' || c)::uuid,
  '20000000-0000-4000-8000-00000000' || a || '|20000000-0000-4000-8000-00000000' || b,
  ('20000000-0000-4000-8000-00000000' || a)::uuid, 'direct',
  '2026-10-08 12:00:00+00'::timestamptz - (c::integer - 1451) * interval '1 minute',
  '2026-10-01 00:00:00+00'
from (values ('1451', '1403', '1404'), ('1452', '1405', '1406'), ('1453', '1403', '1405'),
  ('1454', '1405', '1411'), ('1455', '1405', '1412'), ('1456', '1403', '1408'), ('1457', '1405', '1408')) as conv(c, a, b);

insert into public.team_conversation_members (conversation_id, profile_id)
select ('7f710000-0000-4000-8000-00000000' || c)::uuid, ('20000000-0000-4000-8000-00000000' || p)::uuid
from (values ('1451', '1403'), ('1451', '1404'), ('1452', '1405'), ('1452', '1406'),
  ('1453', '1403'), ('1453', '1405'), ('1454', '1405'), ('1454', '1411'),
  ('1455', '1405'), ('1455', '1412'), ('1456', '1403'), ('1456', '1408'),
  ('1457', '1405'), ('1457', '1408')) as member(c, p);

insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
select ('7f740000-0000-4000-8000-00000000' || c)::uuid, gen_random_uuid(),
  ('7f710000-0000-4000-8000-00000000' || c)::uuid, ('20000000-0000-4000-8000-00000000' || a)::uuid,
  body, '2026-10-08 11:00:00+00'
from (values
  ('1451', '1403', 'WOLF_FORGE_PAYROLL_SECRET quartzneedle'),
  ('1452', '1405', 'TENANT_B_LAUNCH_PLAN quartzneedle'),
  ('1453', '1403', 'MIXED_TENANT_SECRET quartzneedle'),
  ('1455', '1412', 'TENANT_B_ARCHIVED_STAFF_NOTE quartzneedle')
) as message(c, a, body);

create function pg_temp.act(p_actor text, p_selector text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-00000000' || p_actor, true);
  select set_config('request.headers', case p_selector
    when 'wf' then ''
    when 'b' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001401"}'
    when 'explicit-wf' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}'
    when 'unknown' then '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000014ff"}'
    when 'malformed' then '{"x-wf-tenant":"not-a-tenant"}'
    end, true);
$$;

-- listed(): fixture conversations in the supervision list, as 'last4' list.
create function pg_temp.listed()
returns text
language sql
as $$
  select coalesce(string_agg(right(conversation_id::text, 4), ',' order by conversation_id), '')
  from public.app_list_team_supervised_conversations(100)
  where conversation_id::text like '7f710000-0000-4000-8000-0000000014%';
$$;

create function pg_temp.conv(p_last4 text)
returns uuid
language sql
immutable
as $$ select ('7f710000-0000-4000-8000-00000000' || p_last4)::uuid $$;

-- Audit rows written by an actor for one conversation (read as postgres).
create function pg_temp.audits(p_actor text, p_last4 text)
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from public.security_audit_events
  where actor_profile_id = ('20000000-0000-4000-8000-00000000' || p_actor)::uuid
    and resource_id = ('7f710000-0000-4000-8000-00000000' || p_last4)::uuid;
$$;

grant execute on function pg_temp.act(text, text), pg_temp.listed(), pg_temp.conv(text),
  pg_temp.audits(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- List: each Tenant sees only its own internal-to-internal conversations
-- -----------------------------------------------------------------------------

select pg_temp.act('1401', 'wf');
select is(pg_temp.listed(), '1451,1456', 'WF supervisor lists only WF staff conversations');

select pg_temp.act('1402', 'b');
select is(pg_temp.listed(), '1452,1455,1457', 'B supervisor lists only B staff conversations (archived B participant kept)');
select is(
  (select count(*) from public.app_list_team_supervised_conversations(100)
   where participant_one_profile_id in ('20000000-0000-4000-8000-000000001403', '20000000-0000-4000-8000-000000001404')
      or participant_two_profile_id in ('20000000-0000-4000-8000-000000001403', '20000000-0000-4000-8000-000000001404')),
  0::bigint,
  'B supervisor list exposes no WF staff participant'
);

select pg_temp.act('1413', 'b');
select is(pg_temp.listed(), '1452,1455,1457', 'dual owner with the B selector lists only B conversations');
select pg_temp.act('1413', 'wf');
select is(pg_temp.listed(), '1451,1456', 'dual owner without a selector lists only WF conversations');
select pg_temp.act('1413', 'explicit-wf');
select is(pg_temp.listed(), '1451,1456', 'dual owner with the explicit WF selector lists only WF conversations');

-- Selector / membership failures fail closed.
select pg_temp.act('1402', 'wf');
select throws_ok($$select pg_temp.listed()$$, '42501', null, 'B-only supervisor without a selector is refused');
select pg_temp.act('1402', 'unknown');
select throws_ok($$select pg_temp.listed()$$, '42501', null, 'unknown Tenant selector is refused');
select pg_temp.act('1413', 'malformed');
select throws_ok($$select pg_temp.listed()$$, '42501', null, 'malformed Tenant selector is refused');
select pg_temp.act('1410', 'b');
select throws_ok($$select pg_temp.listed()$$, '42501', null, 'archived B supervisor membership is refused');

-- -----------------------------------------------------------------------------
-- B supervisor cannot open, page, window or search WF / mixed conversations
-- -----------------------------------------------------------------------------

select pg_temp.act('1402', 'b');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1451'))$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot open the WF conversation');
select throws_ok($$select public.app_list_team_supervised_messages_before(pg_temp.conv('1451'), now(), gen_random_uuid())$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot page the WF conversation');
select throws_ok($$select public.app_get_team_supervised_message_window(pg_temp.conv('1451'), '7f740000-0000-4000-8000-000000001451')$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot window into the WF conversation');
select throws_ok($$select public.app_search_team_supervised_conversation_messages(pg_temp.conv('1451'), 'quartzneedle')$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot search the WF message body');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1456'))$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot open a WF conversation with a dual-Tenant participant');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1453'))$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot open the mixed-Tenant conversation');
select throws_ok($$select public.app_search_team_supervised_conversation_messages(pg_temp.conv('1453'), 'quartzneedle')$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot search the mixed-Tenant conversation');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1454'))$$,
  'P0002', 'team conversation unavailable', 'B supervisor cannot open a conversation with a B client');
select is(
  public.app_get_team_supervised_message_window(pg_temp.conv('1452'), '7f740000-0000-4000-8000-000000001451')->>'found',
  'false',
  'B conversation window does not resolve a WF message id'
);

-- Selector failures on the per-conversation RPCs.
select pg_temp.act('1402', 'wf');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1452'))$$,
  '42501', null, 'B-only supervisor without a selector cannot open the B conversation');
select pg_temp.act('1413', 'malformed');
select throws_ok($$select public.app_search_team_supervised_conversation_messages(pg_temp.conv('1451'), 'quartzneedle')$$,
  '42501', null, 'malformed selector cannot search the WF conversation');
select pg_temp.act('1402', 'b');

-- Same-Tenant B supervision works.
select is(
  public.app_get_team_supervised_conversation(pg_temp.conv('1452'))->'messages'->0->>'body',
  'TENANT_B_LAUNCH_PLAN quartzneedle',
  'B supervisor opens the B conversation'
);
select is(
  jsonb_array_length(public.app_get_team_supervised_conversation(pg_temp.conv('1452'))->'participants'),
  2,
  'B conversation has both B participants'
);
select is(
  jsonb_array_length(public.app_search_team_supervised_conversation_messages(pg_temp.conv('1452'), 'quartzneedle')->'results'),
  1,
  'B supervisor searches the B conversation'
);
select is(
  public.app_get_team_supervised_message_window(pg_temp.conv('1452'), '7f740000-0000-4000-8000-000000001452')->>'found',
  'true',
  'B supervisor windows into the B conversation'
);
select is(
  public.app_list_team_supervised_messages_before(pg_temp.conv('1452'), '2026-10-09 00:00:00+00', '7f740000-0000-4000-8000-000000001452')->'messages'->0->>'body',
  'TENANT_B_LAUNCH_PLAN quartzneedle',
  'B supervisor pages the B conversation'
);
select is(
  public.app_get_team_supervised_conversation(pg_temp.conv('1455'))->'messages'->0->>'body',
  'TENANT_B_ARCHIVED_STAFF_NOTE quartzneedle',
  'B supervisor opens a conversation with an archived B participant'
);
select ok(pg_temp.audits('1402', '1452') >= 4, 'same-Tenant B reads are audited');

-- The archived flag is the current Tenant membership's, never another Tenant's.
select is(
  (select p->>'archived' from jsonb_array_elements(
     public.app_get_team_supervised_conversation(pg_temp.conv('1455'))->'participants') as p
   where p->>'profile_id' = '20000000-0000-4000-8000-000000001412'),
  'true',
  'B open shows the participant archived in B as archived'
);
select is(
  (select participant_two_archived from public.app_list_team_supervised_conversations(100)
   where conversation_id = pg_temp.conv('1455')),
  true,
  'B list shows the participant archived in B as archived'
);
select is(
  (select p->>'archived' from jsonb_array_elements(
     public.app_get_team_supervised_conversation(pg_temp.conv('1457'))->'participants') as p
   where p->>'profile_id' = '20000000-0000-4000-8000-000000001408'),
  'false',
  'B open does not reveal the dual participant''s Wolf Forge archive state'
);

-- -----------------------------------------------------------------------------
-- WF supervisor cannot reach B / mixed conversations; WF behavior unchanged
-- -----------------------------------------------------------------------------

select pg_temp.act('1401', 'wf');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1452'))$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot open the B conversation');
select throws_ok($$select public.app_search_team_supervised_conversation_messages(pg_temp.conv('1452'), 'quartzneedle')$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot search the B message body');
select throws_ok($$select public.app_list_team_supervised_messages_before(pg_temp.conv('1452'), now(), gen_random_uuid())$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot page the B conversation');
select throws_ok($$select public.app_get_team_supervised_message_window(pg_temp.conv('1452'), '7f740000-0000-4000-8000-000000001452')$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot window into the B conversation');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1453'))$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot open the mixed-Tenant conversation');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1455'))$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot open the archived-B conversation');
select is(
  public.app_get_team_supervised_conversation(pg_temp.conv('1451'))->'messages'->0->>'body',
  'WOLF_FORGE_PAYROLL_SECRET quartzneedle',
  'WF supervisor opens the WF conversation'
);
select is(
  jsonb_array_length(public.app_search_team_supervised_conversation_messages(pg_temp.conv('1451'), 'quartzneedle')->'results'),
  1,
  'WF supervisor searches the WF conversation'
);
select is(
  (select p->>'archived' from jsonb_array_elements(
     public.app_get_team_supervised_conversation(pg_temp.conv('1456'))->'participants') as p
   where p->>'profile_id' = '20000000-0000-4000-8000-000000001408'),
  'true',
  'WF supervisor opens the WF conversation; the WF-archived participant shows archived'
);
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1457'))$$,
  'P0002', 'team conversation unavailable', 'WF supervisor cannot open the B conversation with a dual participant');

-- Dual owner: the selected Tenant decides, never the other membership.
select pg_temp.act('1413', 'b');
select throws_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1451'))$$,
  'P0002', 'team conversation unavailable', 'dual owner with the B selector cannot open the WF conversation');
select lives_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1452'))$$,
  'dual owner with the B selector opens the B conversation');
select pg_temp.act('1413', 'wf');
select throws_ok($$select public.app_search_team_supervised_conversation_messages(pg_temp.conv('1452'), 'quartzneedle')$$,
  'P0002', 'team conversation unavailable', 'dual owner without a selector cannot search the B conversation');
select lives_ok($$select public.app_get_team_supervised_conversation(pg_temp.conv('1451'))$$,
  'dual owner without a selector opens the WF conversation');

select * from finish();

rollback;
