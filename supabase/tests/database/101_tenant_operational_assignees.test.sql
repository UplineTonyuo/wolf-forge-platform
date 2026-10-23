begin;

select plan(28);

-- WL-2.4 (KI-113): an operational assignee is an active internal member of the
-- row's Tenant, and the assignee list shows the caller's current Tenant only.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...000000001101,
-- suspended Tenant S = ...000000001199.

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 1101 WF staff, no B membership; 1102 WF staff, B client; 1103 WF client,
-- B staff; 1104 staff in both; 1105 WF archived, B staff; 1106 WF staff, B staff
-- archived; 1107 WF owner; 1108 B owner (WF archived); 1109 owner of both (also
-- owner of suspended S); 1110 B admin with an archived B membership (WF archived).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'assignee-' || n || '@example.invalid', now(), now()
from unnest(array['1101', '1102', '1103', '1104', '1105', '1106', '1107', '1108', '1109', '1110']) as n;

insert into public.tenants (id, slug, display_name, status)
values
  ('f0f0f0f0-0000-4000-8000-000000001101', 'assignee-tenant-b', 'Assignee Tenant B', 'active'),
  ('f0f0f0f0-0000-4000-8000-000000001199', 'assignee-tenant-s', 'Assignee Tenant S', 'suspended');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000001101', 'staff', null::timestamptz),
  ('20000000-0000-0000-0000-000000001102', 'staff', null),
  ('20000000-0000-0000-0000-000000001103', 'client', null),
  ('20000000-0000-0000-0000-000000001104', 'staff', null),
  ('20000000-0000-0000-0000-000000001105', 'staff', now()),
  ('20000000-0000-0000-0000-000000001106', 'staff', null),
  ('20000000-0000-0000-0000-000000001107', 'owner', null),
  ('20000000-0000-0000-0000-000000001108', 'owner', now()),
  ('20000000-0000-0000-0000-000000001109', 'owner', null),
  ('20000000-0000-0000-0000-000000001110', 'admin', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select fixture.tenant_id::uuid, fixture.profile_id::uuid, fixture.account_class, role.id, fixture.archived_at
from (values
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001102', 'client', 'client', null::timestamptz),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001103', 'staff', 'internal', null),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001104', 'staff', 'internal', null),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001105', 'staff', 'internal', null),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001106', 'staff', 'internal', now()),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001108', 'owner', 'internal', null),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001109', 'owner', 'internal', null),
  ('f0f0f0f0-0000-4000-8000-000000001101', '20000000-0000-0000-0000-000000001110', 'admin', 'internal', now()),
  ('f0f0f0f0-0000-4000-8000-000000001199', '20000000-0000-0000-0000-000000001109', 'owner', 'internal', null)
) as fixture(tenant_id, profile_id, role_name, account_class, archived_at)
join public.roles as role on role.name = fixture.role_name;

insert into public.companies (id, tenant_id, name, status)
values
  ('c0000000-0000-4000-8000-000000001101', private.wolf_forge_tenant_id(), 'Assignee WF Client', 'client'),
  ('c0000000-0000-4000-8000-000000001102', 'f0f0f0f0-0000-4000-8000-000000001101', 'Assignee B Client', 'client');

insert into public.services (id, tenant_id, name)
values
  ('c1000000-0000-4000-8000-000000001101', private.wolf_forge_tenant_id(), 'Assignee WF Service'),
  ('c1000000-0000-4000-8000-000000001102', 'f0f0f0f0-0000-4000-8000-000000001101', 'Assignee B Service');

insert into public.orders (id, tenant_id, company_id, service_id, title)
values
  ('c2000000-0000-4000-8000-000000001101', private.wolf_forge_tenant_id(),
   'c0000000-0000-4000-8000-000000001101', 'c1000000-0000-4000-8000-000000001101', 'Assignee WF Order'),
  ('c2000000-0000-4000-8000-000000001102', 'f0f0f0f0-0000-4000-8000-000000001101',
   'c0000000-0000-4000-8000-000000001102', 'c1000000-0000-4000-8000-000000001102', 'Assignee B Order');

insert into public.tickets (id, tenant_id, company_id, subject)
values
  ('c3000000-0000-4000-8000-000000001101', private.wolf_forge_tenant_id(),
   'c0000000-0000-4000-8000-000000001101', 'Assignee WF Ticket'),
  ('c3000000-0000-4000-8000-000000001102', 'f0f0f0f0-0000-4000-8000-000000001101',
   'c0000000-0000-4000-8000-000000001102', 'Assignee B Ticket');

-- Trusted direct write of one row per candidate assignee (1101-1106, then
-- null); returns each outcome as "suffix:ok" or "suffix:SQLSTATE".
create function pg_temp.matrix(p_root text, p_tenant text)
returns text
language plpgsql
as $$
declare
  is_wf boolean := p_tenant = 'wf';
  row_tenant uuid := case when is_wf then 'f0f0f0f0-0000-4000-8000-000000000001'
    else 'f0f0f0f0-0000-4000-8000-000000001101' end;
  suffix text;
  assignee uuid;
  result text := '';
begin
  foreach suffix in array array['01', '02', '03', '04', '05', '06', '--'] loop
    assignee := case when suffix = '--' then null
      else ('20000000-0000-0000-0000-0000000011' || suffix)::uuid end;
    begin
      if p_root = 'tickets' then
        insert into public.tickets (tenant_id, company_id, assigned_to_profile_id, subject)
        values (row_tenant, case when is_wf then 'c0000000-0000-4000-8000-000000001101'
          else 'c0000000-0000-4000-8000-000000001102' end::uuid, assignee, 'x');
      elsif p_root = 'orders' then
        insert into public.orders (tenant_id, company_id, service_id, assigned_to_profile_id, title)
        values (row_tenant,
          case when is_wf then 'c0000000-0000-4000-8000-000000001101'
            else 'c0000000-0000-4000-8000-000000001102' end::uuid,
          case when is_wf then 'c1000000-0000-4000-8000-000000001101'
            else 'c1000000-0000-4000-8000-000000001102' end::uuid,
          assignee, 'x');
      elsif p_root = 'services' then
        insert into public.services (tenant_id, name, assigned_to_profile_id)
        values (row_tenant, 'Matrix ' || p_tenant || suffix, assignee);
      else
        insert into public.order_tasks (order_id, assigned_to_profile_id, title)
        values (case when is_wf then 'c2000000-0000-4000-8000-000000001101'
          else 'c2000000-0000-4000-8000-000000001102' end::uuid, assignee, 'x');
      end if;
      result := result || suffix || ':ok ';
    exception when others then
      result := result || suffix || ':' || sqlstate || ' ';
    end;
  end loop;

  return rtrim(result);
end;
$$;

create function pg_temp.list()
returns text
language sql
as $$
  select string_agg(right(assignee.profile_id::text, 2), ' ' order by assignee.profile_id)
  from public.app_list_operational_assignees() as assignee
  where assignee.profile_id::text like '20000000-0000-0000-0000-0000000011%';
$$;

create function pg_temp.act(p_actor text, p_header text)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-00000000' || p_actor, true);
  select set_config('request.headers', p_header, true);
$$;

grant execute on function pg_temp.list(), pg_temp.act(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Root assignment integrity (trusted direct writes)
-- -----------------------------------------------------------------------------

select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
    where tgrelid = 'public.order_tasks'::regclass and not tgisinternal and tgname like '%assignee%'),
  array['order_tasks_require_tenant_assignee'],
  'order_tasks keeps only its Tenant-relative assignee trigger'
);

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_trigger as tr
    join pg_class as c on c.oid = tr.tgrelid
    where tr.tgname like '%require_internal_assignee'
      and pg_get_triggerdef(tr.oid) like '%UPDATE OF assigned_to_profile_id, tenant_id ON%'),
  array['orders', 'services', 'tickets'],
  'root assignee triggers re-validate on a Tenant change'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.tickets'::regclass and conname = 'tickets_assigned_to_profile_id_fkey'),
  'FOREIGN KEY (tenant_id, assigned_to_profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE RESTRICT',
  'Ticket assignee still references a membership of the Ticket''s Tenant'
);

select is(pg_temp.matrix('tickets', 'wf'), '01:ok 02:ok 03:23514 04:ok 05:23514 06:ok --:ok',
  'WF Ticket: assignable = active WF internal members only');
select is(pg_temp.matrix('tickets', 'b'), '01:23514 02:23514 03:ok 04:ok 05:ok 06:23514 --:ok',
  'B Ticket: assignable = active B internal members only');
select is(pg_temp.matrix('orders', 'wf'), '01:ok 02:ok 03:23514 04:ok 05:23514 06:ok --:ok',
  'WF Order: assignable = active WF internal members only');
select is(pg_temp.matrix('orders', 'b'), '01:23514 02:23514 03:ok 04:ok 05:ok 06:23514 --:ok',
  'B Order: assignable = active B internal members only');
select is(pg_temp.matrix('services', 'wf'), '01:ok 02:ok 03:23514 04:ok 05:23514 06:ok --:ok',
  'WF Service: assignable = active WF internal members only');
select is(pg_temp.matrix('services', 'b'), '01:23514 02:23514 03:ok 04:ok 05:ok 06:23514 --:ok',
  'B Service: assignable = active B internal members only');
select is(pg_temp.matrix('order_tasks', 'wf'), '01:ok 02:ok 03:23514 04:ok 05:23514 06:ok --:ok',
  'WF Order task: assignable = active WF internal members only');
select is(pg_temp.matrix('order_tasks', 'b'), '01:23514 02:23514 03:ok 04:ok 05:ok 06:23514 --:ok',
  'B Order task: assignable = active B internal members only');

-- Moving a row to another Tenant re-validates its assignee: 1102 is WF staff but
-- only a client in B.
insert into public.services (id, tenant_id, name, assigned_to_profile_id)
values ('c1000000-0000-4000-8000-000000001103', private.wolf_forge_tenant_id(), 'Assignee Move Service',
  '20000000-0000-0000-0000-000000001102');
select throws_ok(
  $$update public.services set tenant_id = 'f0f0f0f0-0000-4000-8000-000000001101'
    where id = 'c1000000-0000-4000-8000-000000001103'$$,
  '23514', 'assignee must be an active internal profile',
  'a Service moved to B cannot keep an assignee who is only a B client'
);

-- -----------------------------------------------------------------------------
-- Wolf Forge regression: the list equals the previous global-role formula
-- -----------------------------------------------------------------------------

select pg_temp.act('1107', '');
select is(
  (select count(*) from (
    (select profile_row.id
      from public.profiles as profile_row
      join public.permission_presets as preset_row on preset_row.role_id = profile_row.role_id
      where profile_row.archived_at is null and preset_row.account_class = 'internal'
     except
     select assignee.profile_id from public.app_list_operational_assignees() as assignee)
    union all
    (select assignee.profile_id from public.app_list_operational_assignees() as assignee
     except
     select profile_row.id
      from public.profiles as profile_row
      join public.permission_presets as preset_row on preset_row.role_id = profile_row.role_id
      where profile_row.archived_at is null and preset_row.account_class = 'internal')
  ) as difference),
  0::bigint,
  'WF assignee list is identical to the previous global-role list'
);

-- -----------------------------------------------------------------------------
-- Assignee list isolation
-- -----------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.act('1107', '');
select is(pg_temp.list(), '01 02 04 06 07 09', 'WF owner sees only active WF internal members');
select pg_temp.act('1108', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001101"}');
select is(pg_temp.list(), '03 04 05 08 09', 'B owner sees only active B internal members');
select pg_temp.act('1109', '');
select is(pg_temp.list(), '01 02 04 06 07 09', 'dual owner with the WF selector sees the WF list');
select pg_temp.act('1109', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001101"}');
select is(pg_temp.list(), '03 04 05 08 09', 'dual owner with the B selector sees the B list');

select pg_temp.act('1107', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001101"}');
select throws_ok($$ select pg_temp.list() $$, '42501', 'verified internal authentication is required',
  'WF owner with the B selector gets no B list');
select pg_temp.act('1109', '{"x-wf-tenant":"not-a-uuid"}');
select throws_ok($$ select pg_temp.list() $$, '42501', 'verified internal authentication is required',
  'malformed selector gets no list');
select pg_temp.act('1109', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-0000000011ff"}');
select throws_ok($$ select pg_temp.list() $$, '42501', 'verified internal authentication is required',
  'foreign selector gets no list');
select pg_temp.act('1109', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001199"}');
select throws_ok($$ select pg_temp.list() $$, '42501', 'verified internal authentication is required',
  'suspended Tenant selector gets no list');
select pg_temp.act('1110', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001101"}');
select throws_ok($$ select pg_temp.list() $$, '42501', 'verified internal authentication is required',
  'archived B membership gets no list');

-- -----------------------------------------------------------------------------
-- app_assign_ticket follows the Ticket's Tenant
-- -----------------------------------------------------------------------------

select pg_temp.act('1107', '');
select lives_ok($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001101',
    '20000000-0000-0000-0000-000000001102') $$,
  'WF owner assigns the WF Ticket to WF staff who is a B client');
select throws_ok($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001101',
    '20000000-0000-0000-0000-000000001103') $$,
  '23514', 'assignee must be an active internal profile', 'WF owner cannot assign a WF client who is B staff');

select pg_temp.act('1108', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000001101"}');
select lives_ok($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001102',
    '20000000-0000-0000-0000-000000001103') $$,
  'B owner assigns the B Ticket to B staff who is a WF client');
select throws_ok($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001102',
    '20000000-0000-0000-0000-000000001102') $$,
  '23514', 'assignee must be an active internal profile', 'B owner cannot assign a B client who is WF staff');
select throws_ok($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001102',
    '20000000-0000-0000-0000-000000001101') $$,
  '23514', 'assignee must be an active internal profile', 'B owner cannot assign WF-only staff');
select lives_ok($$ select public.app_assign_ticket('c3000000-0000-4000-8000-000000001102', null) $$,
  'B owner clears the B Ticket assignee');

select * from finish();

rollback;
