begin;

select plan(30);

-- WL-2.8 (KI-111, activity): every activity event belongs to the Tenant of its
-- parent row (profile events: the caller's current Tenant), whatever the
-- writer supplies, and every activity reader is limited to the current Tenant.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001501.

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

select col_not_null('public', 'activity_events', 'tenant_id', 'activity_events.tenant_id is mandatory');
select fk_ok('public', 'activity_events', 'tenant_id', 'public', 'tenants', 'id',
  'activity_events.tenant_id references tenants');
select is((select count(*) from public.activity_events as event
    where event.tenant_id is distinct from coalesce(
      private.activity_event_parent_tenant_id(event.entity_type, event.entity_id), private.wolf_forge_tenant_id())),
  0::bigint, 'every existing event carries its parent Tenant (profile and orphan events: Wolf Forge)');

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1501 WF admin; 1502 B admin (WF archived); 1503 WF owner; 1504 B owner (WF
-- archived); 1505 owner of both; 1506 B admin with an archived B membership
-- (WF archived).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'activity-tenant-' || n || '@example.invalid', now(), now()
from unnest(array['1501', '1502', '1503', '1504', '1505', '1506']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000001501', 'activity-tenant-b', 'Activity Tenant B', 'active');

insert into public.companies (id, tenant_id, name, status)
values
  ('f5000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(), 'Activity WF Company', 'lead'),
  ('f5000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501', 'Activity B Company', 'lead');

insert into public.services (id, tenant_id, name, price)
values
  ('f6000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(), 'Activity WF Service', 10),
  ('f6000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501', 'Activity B Service', 20);

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('f7000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(),
   'f5000000-0000-4000-8000-000000001501', 'f6000000-0000-4000-8000-000000001501', 'Activity WF Project'),
  ('f7000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501',
   'f5000000-0000-4000-8000-000000001502', 'f6000000-0000-4000-8000-000000001502', 'Activity B Project');

insert into public.tickets (id, tenant_id, company_id, subject)
values
  ('f8000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(),
   'f5000000-0000-4000-8000-000000001501', 'Activity WF Ticket'),
  ('f8000000-0000-4000-8000-000000001502', 'f0f0f0f0-0000-4000-8000-000000001501',
   'f5000000-0000-4000-8000-000000001502', 'Activity B Ticket');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001501', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000001502', 'admin', now()),
  ('20000000-0000-0000-0000-000000001503', 'owner', null),
  ('20000000-0000-0000-0000-000000001504', 'owner', now()),
  ('20000000-0000-0000-0000-000000001505', 'owner', null),
  ('20000000-0000-0000-0000-000000001506', 'admin', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000001501', fixture.profile_id::uuid, 'internal', role.id, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001502', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000001504', 'owner', null),
  ('20000000-0000-0000-0000-000000001505', 'owner', null),
  ('20000000-0000-0000-0000-000000001506', 'admin', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name;

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

-- The real product writers, one per Tenant-owned root, plus a profile event.
create function pg_temp.write_all(p_suffix text)
returns text
language plpgsql
as $$
begin
  return concat_ws(' ',
    pg_temp.try(format('select public.app_update_service(%L, %L)',
      'f6000000-0000-4000-8000-00000000' || p_suffix, '{"name":"Activity Service renamed"}')),
    pg_temp.try(format('select public.app_update_order(%L, %L)',
      'f7000000-0000-4000-8000-00000000' || p_suffix, '{"title":"Activity Project renamed"}')),
    pg_temp.try(format('select public.app_update_ticket_priority(%L, %L)',
      'f8000000-0000-4000-8000-00000000' || p_suffix, 'high')),
    pg_temp.try(format('select public.app_update_company(%L, %L)',
      'f5000000-0000-4000-8000-00000000' || p_suffix, '{"status":"client"}')),
    pg_temp.try($q$ select public.app_update_my_profile('Activity person', true) $q$));
end;
$$;

-- Fixture events as the caller sees them through RLS: entity_type:last4.
create function pg_temp.feed()
returns text
language sql
as $$
  select coalesce(string_agg(event.entity_type || ':' || right(event.entity_id::text, 4), ' '
      order by event.entity_type, event.entity_id), '-')
  from (select distinct entity_type, entity_id from public.activity_events
    where entity_id::text ~ '^(f[5-8]000000-0000-4000-8000|20000000-0000-0000-0000)-0000000015') as event;
$$;

-- Readback of the stamped Tenant of every fixture event (security definer).
create function pg_temp.stamped()
returns text
language sql
security definer
as $$
  select coalesce(string_agg(distinct event.entity_type || ':' || right(event.entity_id::text, 4) || '='
      || case event.tenant_id when private.wolf_forge_tenant_id() then 'WF'
              when 'f0f0f0f0-0000-4000-8000-000000001501' then 'B' else 'other' end, ' '), '-')
  from public.activity_events as event
  where event.entity_id::text ~ '^(f[5-8]000000-0000-4000-8000|20000000-0000-0000-0000)-0000000015';
$$;

-- Clients converted in the current dashboard window.
create function pg_temp.converted()
returns text
language sql
as $$
  select public.app_dashboard_overview(now() - interval '1 day', now() + interval '1 day',
    now() - interval '3 days', now() - interval '2 days', 'day', 'UTC') #>> '{clients,converted,current}';
$$;

-- Trusted count of Wolf Forge Company status transitions to client in the window.
create function pg_temp.wf_converted()
returns text
language sql
security definer
as $$
  select count(distinct entity_id)::text from public.activity_events
  where tenant_id = private.wolf_forge_tenant_id() and entity_type = 'company'
    and metadata ->> 'field' = 'status' and metadata ->> 'to' = 'client'
    and created_at >= now() - interval '1 day' and created_at < now() + interval '1 day';
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.try(text), pg_temp.write_all(text), pg_temp.feed(), pg_temp.stamped(),
  pg_temp.converted(), pg_temp.wf_converted(), pg_temp.act(text, text) to authenticated;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Writes: each real writer stamps its parent's Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1501', '');
select is(pg_temp.write_all('1501'), 'ok ok ok ok ok', 'WF admin writes WF Service, Project, Ticket, Company and profile activity');
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.write_all('1502'), 'ok ok ok ok ok', 'dual owner (B selector) writes B Service, Project, Ticket, Company and profile activity');
select is(pg_temp.stamped(),
  'company:1501=WF company:1502=B order:1501=WF order:1502=B profile:1501=WF profile:1505=B service:1501=WF service:1502=B ticket:1501=WF ticket:1502=B',
  'every event carries its parent Tenant; profile events carry the caller''s current Tenant');

-- -----------------------------------------------------------------------------
-- Reads: activity feed / entity timelines (direct RLS) and the dashboard
-- -----------------------------------------------------------------------------

select pg_temp.act('1501', '');
select is(pg_temp.feed(), 'company:1501 order:1501 profile:1501 service:1501 ticket:1501',
  'WF admin sees only Wolf Forge activity');
select is((select count(*) from public.activity_events where entity_id in (
    'f6000000-0000-4000-8000-000000001502', 'f7000000-0000-4000-8000-000000001502',
    'f5000000-0000-4000-8000-000000001502', '20000000-0000-0000-0000-000000001502')),
  0::bigint, 'WF admin reads no B event by entity id (Service summary, Project, Company, profile)');
select is(pg_temp.converted(), pg_temp.wf_converted(), 'WF dashboard counts only Wolf Forge Client conversions');

select pg_temp.act('1502', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.feed(), 'company:1502 order:1502 profile:1505 service:1502 ticket:1502',
  'B admin sees only Tenant B activity');
select is((select count(*) from public.activity_events where tenant_id <> 'f0f0f0f0-0000-4000-8000-000000001501'),
  0::bigint, 'B admin reads no Wolf Forge event at all (no foreign summary, actor, id, time or metadata)');
select is(pg_temp.converted(), '1', 'B dashboard counts only the Tenant B Client conversion');

-- -----------------------------------------------------------------------------
-- Owners, dual owner, archived membership, selectors
-- -----------------------------------------------------------------------------

select pg_temp.act('1503', '');
select is(pg_temp.feed(), 'company:1501 order:1501 profile:1501 service:1501 ticket:1501', 'WF owner sees only Wolf Forge activity');
select pg_temp.act('1503', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.feed(), '-', 'WF owner with the B selector sees nothing');
select pg_temp.act('1504', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.feed(), 'company:1502 order:1502 profile:1505 service:1502 ticket:1502', 'B owner sees only Tenant B activity');
select pg_temp.act('1504', '');
select is(pg_temp.feed(), '-', 'B owner (archived in WF) with no selector sees nothing');

select pg_temp.act('1505', '');
select is(pg_temp.feed(), 'company:1501 order:1501 profile:1501 service:1501 ticket:1501', 'dual owner with the WF selector sees WF activity only');
select is(pg_temp.try($$ select public.app_update_my_profile('Dual person', true) $$), 'ok', 'dual owner records a profile event under WF');
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.feed(), 'company:1502 order:1502 profile:1505 service:1502 ticket:1502', 'dual owner with the B selector sees B activity only');
select is((select string_agg(case tenant_id when 'f0f0f0f0-0000-4000-8000-000000001501' then 'B' else 'WF' end, ' ' order by created_at, tenant_id)
    from public.activity_events where entity_id = '20000000-0000-0000-0000-000000001505'), 'B',
  'with the B selector the dual owner sees only their B profile event');
select pg_temp.act('1505', '');
select is((select string_agg(case tenant_id when 'f0f0f0f0-0000-4000-8000-000000001501' then 'B' else 'WF' end, ' ')
    from public.activity_events where entity_id = '20000000-0000-0000-0000-000000001505'), 'WF',
  'with the WF selector the dual owner sees only their WF profile event');

select pg_temp.act('1506', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.feed() || ' ' || pg_temp.try($$ select public.app_update_my_profile('Archived person', true) $$),
  '- 42501', 'archived B admin sees nothing and records nothing');
select pg_temp.act('1505', '{"x-wf-tenant":"not-a-uuid"}');
select is(pg_temp.feed(), '-', 'malformed selector sees nothing');
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000015ff"}');
select is(pg_temp.feed(), '-', 'foreign selector sees nothing');

reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000001501';
set local role authenticated;
select pg_temp.act('1505', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001501"}');
select is(pg_temp.feed() || ' ' || pg_temp.try($$ select public.app_update_my_profile('Suspended person', true) $$),
  '- 42501', 'suspended Tenant owner sees nothing and records nothing');

-- -----------------------------------------------------------------------------
-- Spoofing and trusted / background writers
-- -----------------------------------------------------------------------------

select pg_temp.act('1501', '');
select throws_ok($$ insert into public.activity_events (tenant_id, entity_type, entity_id, action, summary)
    values ('f0f0f0f0-0000-4000-8000-000000001501', 'service', 'f6000000-0000-4000-8000-000000001501', 'x', 'spoof') $$,
  '42501', 'permission denied for table activity_events', 'a signed-in user cannot write an event at all');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '', true);
insert into public.activity_events (id, tenant_id, entity_type, entity_id, action, summary)
values ('f9000000-0000-4000-8000-000000001501', private.wolf_forge_tenant_id(), 'order',
  'f7000000-0000-4000-8000-000000001502', 'order.background', 'Background B event with a spoofed Tenant');
select is((select tenant_id from public.activity_events where id = 'f9000000-0000-4000-8000-000000001501'),
  'f0f0f0f0-0000-4000-8000-000000001501'::uuid,
  'a trusted / background write takes the parent''s Tenant, not the supplied one or the Wolf Forge fallback');
insert into public.order_tasks (id, order_id, title)
values ('fa000000-0000-4000-8000-000000001502', 'f7000000-0000-4000-8000-000000001502', 'Activity B task');
insert into public.activity_events (id, entity_type, entity_id, action, summary)
values ('f9000000-0000-4000-8000-000000001502', 'order_task', 'fa000000-0000-4000-8000-000000001502',
  'task.background', 'Background B task event');
select is((select tenant_id from public.activity_events where id = 'f9000000-0000-4000-8000-000000001502'),
  'f0f0f0f0-0000-4000-8000-000000001501'::uuid, 'an order_task event takes the Tenant of the task''s Order');
select throws_ok($$ insert into public.activity_events (entity_type, entity_id, action, summary)
    values ('service', 'f6000000-0000-4000-8000-0000000015ff', 'x', 'missing parent') $$,
  '42501', 'activity event Tenant cannot be derived', 'an event whose parent does not exist is refused');
select throws_ok($$ insert into public.activity_events (entity_type, entity_id, action, summary)
    values ('profile', '20000000-0000-0000-0000-000000001501', 'x', 'no caller') $$,
  '42501', 'activity event Tenant cannot be derived',
  'a trusted profile event without a caller''s Tenant is refused (no Wolf Forge default)');

select * from finish();

rollback;
