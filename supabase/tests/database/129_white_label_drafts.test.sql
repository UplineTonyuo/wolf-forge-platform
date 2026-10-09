begin;

select plan(111);

-- WL-2.33 (KI-146 / D-298): per-Tenant White Label DRAFTS are read and
-- written only through Platform Admin RPCs, validated in the database,
-- protected by optimistic revisions, and never read by any authorization path.
-- WF = f0f0f0f0-0000-4000-8000-000000000001; fixture Tenants 3201 (active B),
-- 3202 (suspended), 3203 (archived).

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 3201 Platform Admin (WF admin).  3202 WF owner.  3203 Tenant B owner.
-- 3204 WF client.  3205 granted, then archived.  3206 granted (revoked later).
-- 3207 second Platform Admin (WF staff).
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-4000-8000-00000000' || n)::uuid, 'authenticated', 'authenticated',
  'white-label-' || n || '@example.invalid', now(), now()
from unnest(array['3201', '3202', '3203', '3204', '3205', '3206', '3207']) as n;

insert into public.tenants (id, slug, display_name, status, archived_at)
values
  ('f0f0f0f0-0000-4000-8000-000000003201', 'white-label-tenant-b', 'White Label Tenant B', 'active', null),
  ('f0f0f0f0-0000-4000-8000-000000003202', 'white-label-suspended', 'White Label Suspended', 'suspended', null),
  ('f0f0f0f0-0000-4000-8000-000000003203', 'white-label-archived', 'White Label Archived', 'archived', now());

insert into public.companies (id, tenant_id, name, status)
values ('e7000000-0000-4000-8000-000000003201', private.wolf_forge_tenant_id(), 'WL WF Client', 'client');

update public.profiles as profile
set role_id = role.id, company_id = fixture.company_id::uuid
from (values
  ('20000000-0000-4000-8000-000000003201', 'admin', null),
  ('20000000-0000-4000-8000-000000003202', 'owner', null),
  ('20000000-0000-4000-8000-000000003204', 'client', 'e7000000-0000-4000-8000-000000003201'),
  ('20000000-0000-4000-8000-000000003205', 'admin', null),
  ('20000000-0000-4000-8000-000000003206', 'admin', null),
  ('20000000-0000-4000-8000-000000003207', 'staff', null)
) as fixture(profile_id, role_name, company_id)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id)
select 'f0f0f0f0-0000-4000-8000-000000003201', '20000000-0000-4000-8000-000000003203', 'internal', role.id
from public.roles as role where role.name = 'owner';

select private.grant_platform_admin(('20000000-0000-4000-8000-00000000' || n)::uuid, 'pgTAP 129 fixture')
from unnest(array['3201', '3205', '3206', '3207']) as n;
update public.profiles set archived_at = now() where id = '20000000-0000-4000-8000-000000003205';

-- Runtime authorization state and Tenant business data the drafts must never touch.
create temp table runtime_before as
select
  (select md5(string_agg(m::text, ',' order by m.module_key)) from public.permission_modules as m) as modules,
  (select md5(string_agg(r::text, ',' order by r::text)) from public.role_permissions as r) as role_permissions,
  (select md5(string_agg(o::text, ',' order by o::text)) from public.profile_permission_overrides as o) as overrides,
  (select md5(string_agg(tm::text, ',' order by tm::text)) from public.tenant_memberships as tm) as memberships,
  (select md5(string_agg(t::text, ',' order by t.id)) from public.tenants as t) as tenants,
  (select md5(string_agg(p::text, ',' order by p.id)) from public.profiles as p) as profiles;

create function pg_temp.act(p_actor text, p_headers text default '', p_claims text default '')
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub',
    coalesce('20000000-0000-4000-8000-00000000' || p_actor, ''), true);
  select set_config('request.jwt.claims', p_claims, true);
  select set_config('request.headers', p_headers, true);
$$;

create function pg_temp.as_actor(p_actor text, p_sql text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.act(p_actor);
  execute p_sql;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: tables are unreachable; only authenticated may call the RPCs
-- -----------------------------------------------------------------------------

select ok(
  not has_table_privilege(api_role, tbl, privilege),
  api_role || ' has no ' || privilege || ' on ' || tbl
)
from unnest(array['anon', 'authenticated', 'service_role']) as api_role
cross join unnest(array['private.tenant_white_label_drafts', 'private.white_label_modules']) as tbl
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege;

select ok(
  has_function_privilege(api_role, fn, 'EXECUTE') = (api_role = 'authenticated'),
  api_role || (case when api_role = 'authenticated' then ' can' else ' cannot' end) || ' execute ' || fn
)
from unnest(array['anon', 'authenticated', 'service_role']) as api_role
cross join unnest(array[
  'public.app_list_white_label_tenants()',
  'public.app_get_white_label_draft(uuid)',
  'public.app_save_white_label_draft(uuid, integer, text, text, text, text[])'
]) as fn;

select ok(
  not has_function_privilege(api_role, 'private.tenant_white_label_drafts_validate()', 'EXECUTE'),
  api_role || ' cannot execute the draft validation trigger function'
)
from unnest(array['anon', 'authenticated', 'service_role']) as api_role;

select ok(
  (select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc
   where oid in ('public.app_list_white_label_tenants()'::regprocedure,
                 'public.app_get_white_label_draft(uuid)'::regprocedure,
                 'public.app_save_white_label_draft(uuid, integer, text, text, text, text[])'::regprocedure)),
  'every draft RPC is SECURITY DEFINER with an empty search_path');

-- 23. No-live-publication boundary: nothing but the draft RPCs and the
-- validation trigger reads the drafts, and no policy mentions them.
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc as p
   where p.prosrc ilike '%tenant_white_label_drafts%'),
  array[
    'app_get_white_label_draft(uuid)',
    'app_list_white_label_tenants()',
    'app_save_white_label_draft(uuid,integer,text,text,text,text[])'
  ],
  '23a. only the three draft RPCs read the draft table (no authorization path does)');
select is(
  (select count(*)::int from pg_policies
   where coalesce(qual, '') ilike '%white_label%' or coalesce(with_check, '') ilike '%white_label%'),
  0, '23b. no RLS policy references White Label drafts');

-- Catalog: the nine configurable modules, their dependency, never Operations.
select is(
  (select array_agg(module_key || ':' || coalesce(requires_module_key, '-') order by module_key)
   from private.white_label_modules),
  array['coupons:services', 'forms:-', 'investment_intent:services', 'invoices:-', 'projects:services',
        'reporting:-', 'services:-', 'subscriptions:services', 'tickets:-'],
  'the configurable catalog is the nine WL-2.31 modules with their Services dependency');
select throws_ok(
  $$ insert into private.white_label_modules (module_key) values ('todo') $$,
  '23514', null, '17a. Operations can never enter the configurable catalog');

-- -----------------------------------------------------------------------------
-- Platform Admin reads and writes
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('3201');

select ok(
  (select count(*) = 4 from public.app_list_white_label_tenants()
   where tenant_id in ('f0f0f0f0-0000-4000-8000-000000000001', 'f0f0f0f0-0000-4000-8000-000000003201',
                       'f0f0f0f0-0000-4000-8000-000000003202', 'f0f0f0f0-0000-4000-8000-000000003203')),
  '1a. Platform Admin lists every Tenant, whatever its status');
select is(
  (select row(display_name, primary_color, accent_color, module_keys, revision, updated_at is null)
   from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201')),
  row('White Label Tenant B'::text, '#000d51'::text, '#a8832e'::text,
      array['coupons', 'forms', 'investment_intent', 'invoices', 'projects', 'reporting', 'services', 'subscriptions', 'tickets'],
      0, true),
  '1b. without a draft, the read returns revision 0 and the documented defaults');
reset role;
select is((select count(*)::int from private.tenant_white_label_drafts where tenant_id = 'f0f0f0f0-0000-4000-8000-000000003201'), 0,
  '1c. reading never creates a draft');
set local role authenticated;
select pg_temp.act('3201');

select is(
  (select row(revision, already_applied)
   from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 0, '  Bravo Labs ', '#AA1100', '#00aa55',
     array['tickets', 'services', 'projects', 'services'])),
  row(1, false), '2. Platform Admin saves an active Tenant draft (revision 1)');
select is(
  (select row(display_name, primary_color, accent_color, module_keys, revision)
   from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201')),
  row('Bravo Labs'::text, '#aa1100'::text, '#00aa55'::text, array['projects', 'services', 'tickets'], 1),
  '3. the read returns exactly the saved values (trimmed, lower-case colors, sorted distinct modules)');

select is(
  (select revision from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000000001', 0, 'Wolf Forge Draft',
     '#101010', '#202020', array['forms'])),
  1, '4a. the Wolf Forge draft is saved independently');
select is(
  (select row(display_name, module_keys, revision) from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201')),
  row('Bravo Labs'::text, array['projects', 'services', 'tickets'], 1),
  '5. saving Wolf Forge never changes Tenant B');
select is(
  (select row(display_name, module_keys) from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000000001')),
  row('Wolf Forge Draft'::text, array['forms']),
  '4b. each Tenant reads back its own draft');
select is(
  (select draft_revision from public.app_list_white_label_tenants() where tenant_id = 'f0f0f0f0-0000-4000-8000-000000003201'),
  1, '1d. the Tenant list reports the draft revision');

-- 21 / 22. Optimistic concurrency and safe repeats.
select is(
  (select revision from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 1, 'Bravo Two',
     '#aa1100', '#00aa55', array['services'])),
  2, '21a. a save with the current revision succeeds');
select is(
  (select row(revision, already_applied) from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 1,
     'Bravo Two', '#AA1100', '#00aa55', array['services'])),
  row(2, true), '22a. replaying the same save (lost response) is already applied, not a second write');
select pg_temp.act('3207');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 1, 'Theirs', '#000000', '#ffffff', array['services']) $$,
  'WF409', null, '21b. another admin''s stale revision is an explicit conflict');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 1, 'Bravo Two', '#aa1100', '#00aa55', array['services']) $$,
  'WF409', null, '21c. an identical stale save by a different admin is still a conflict');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 0, 'New', '#000000', '#ffffff', array['services']) $$,
  'WF409', null, '21d. "first save" over an existing draft is a conflict, not an overwrite');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 7, 'Future', '#000000', '#ffffff', array['services']) $$,
  'WF409', null, '21e. a revision from the future is a conflict');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', null, 'X', '#000000', '#ffffff', array['services']) $$,
  '22023', null, '21f. a missing revision is refused');
select is(
  (select revision from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 2, 'Theirs', '#000000',
     '#ffffff', array['services'])),
  3, '21g. the second admin succeeds after loading the current revision');
reset role;
select is(
  (select count(*)::int from private.tenant_white_label_drafts where tenant_id = 'f0f0f0f0-0000-4000-8000-000000003201'),
  1, '22b. repeated saves never create a second draft for a Tenant');
select is(
  (select row(updated_by, revision) from private.tenant_white_label_drafts where tenant_id = 'f0f0f0f0-0000-4000-8000-000000003201'),
  row('20000000-0000-4000-8000-000000003207'::uuid, 3),
  'the draft records the authenticated admin who saved it');
select is(
  (select count(*)::int from public.security_audit_events
   where event_code = 'authorization.white_label.draft_saved'
     and resource_id = 'f0f0f0f0-0000-4000-8000-000000003201'
     and metadata ? 'revision' and outcome = 'succeeded'),
  3, 'each real write (not the replay) appends one audit event with actor, Tenant and revision');
select is(
  (select array_agg(key order by key) from public.security_audit_events, jsonb_object_keys(metadata) as key
   where event_code = 'authorization.white_label.draft_saved' and resource_id = 'f0f0f0f0-0000-4000-8000-000000003201'
     and metadata->>'revision' = '1'),
  array['module_count', 'previous_revision', 'revision'],
  'the audit carries only revision metadata, never draft content or credentials');
set local role authenticated;
select pg_temp.act('3201');

-- 15 / 16. Target validation and the active-Tenant write policy.
select throws_ok(
  $$ select * from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-0000000032ff') $$,
  'P0002', null, '15a. an unknown Tenant id cannot be read');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-0000000032ff', 0, 'X', '#000000', '#ffffff', array['services']) $$,
  'P0002', null, '15b. an unknown Tenant id cannot be written');
select throws_ok(
  $$ select * from public.app_save_white_label_draft(null, 0, 'X', '#000000', '#ffffff', array['services']) $$,
  'P0002', null, '15c. a missing Tenant id cannot be written (no Wolf Forge fallback)');
select is(
  (select row(tenant_status, revision) from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003202')),
  row('suspended'::text, 0), '16a. a suspended Tenant''s draft can be read');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003202', 0, 'X', '#000000', '#ffffff', array['services']) $$,
  '55000', null, '16b. a suspended Tenant''s draft is read-only');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003203', 0, 'X', '#000000', '#ffffff', array['services']) $$,
  '55000', null, '16c. an archived Tenant''s draft is read-only');

-- 17 - 20. Validation (the save RPC, and the table itself).
select throws_ok(
  format($$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 3, 'X', '#000000', '#ffffff', %L) $$, modules),
  '22023', null, label)
from (values
  (array['services', 'todo'], '17b. Operations cannot be saved'),
  (array['dashboard'], '18a. a core (non-configurable) module cannot be saved'),
  (array['nonsense'], '18b. an unknown module cannot be saved'),
  (array['services', null], '18c. a null module cannot be saved'),
  (array['projects'], '19a. Projects without Services cannot be saved'),
  (array['subscriptions', 'coupons', 'investment_intent'], '19b. Service-dependent modules without Services cannot be saved')
) as cases(modules, label);
select throws_ok(
  format($$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 3, %L, %L, %L, array['services']) $$,
    name, primary_color, accent_color),
  '23514', null, label)
from (values
  ('', '#000000', '#ffffff', '20a. an empty name is refused'),
  ('   ', '#000000', '#ffffff', '20b. a blank name is refused'),
  (repeat('x', 61), '#000000', '#ffffff', '20c. a name over 60 characters is refused'),
  ('Bad' || chr(7) || 'Name', '#000000', '#ffffff', '20d. a name with control characters is refused'),
  ('Ok', '#00f', '#ffffff', '20e. a short hex color is refused'),
  ('Ok', 'red', '#ffffff', '20f. a named color is refused'),
  ('Ok', '#000000', 'url(x)', '20g. a CSS expression is refused as a color'),
  ('Ok', '#gggggg', '#ffffff', '20h. a non-hex color is refused')
) as cases(name, primary_color, accent_color, label);
select is(
  (select revision from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 3, 'Empty modules',
     '#000000', '#ffffff', array[]::text[])),
  4, 'an empty module selection is a valid draft (core modules are always present)');
reset role;
select throws_ok(
  $$ insert into private.tenant_white_label_drafts (tenant_id, display_name, primary_color, accent_color, module_keys, revision, updated_by)
     values ('f0f0f0f0-0000-4000-8000-000000003202', 'Direct', '#000000', '#ffffff', array['todo'], 1, '20000000-0000-4000-8000-000000003201') $$,
  '22023', null, '17c. even a direct table write cannot store Operations');
select throws_ok(
  $$ insert into private.tenant_white_label_drafts (tenant_id, display_name, primary_color, accent_color, module_keys, revision, updated_by)
     values ('f0f0f0f0-0000-4000-8000-000000003201', 'Dup', '#000000', '#ffffff', array['services'], 1, '20000000-0000-4000-8000-000000003201') $$,
  '23505', null, '22c. a second draft row for a Tenant is impossible');

-- -----------------------------------------------------------------------------
-- Everyone else is refused
-- -----------------------------------------------------------------------------

set local role authenticated;
select throws_ok(format('select pg_temp.as_actor(%L, %L)', actor, 'select * from ' || call), '42501', null, who || ' cannot ' || what)
from (values ('3202', '6. Wolf Forge owner'), ('3203', '7. Tenant B owner'), ('3204', '8. client'),
             ('3205', '10. archived Platform Admin'))
  as actors(actor, who)
cross join (values
  ('public.app_list_white_label_tenants()', 'list Tenants'),
  ('public.app_get_white_label_draft(''f0f0f0f0-0000-4000-8000-000000003201'')', 'read a draft'),
  ('public.app_save_white_label_draft(''f0f0f0f0-0000-4000-8000-000000003201'', 4, ''X'', ''#000000'', ''#ffffff'', array[''services''])', 'write a draft')
) as calls(call, what);

select pg_temp.act(null);
select throws_ok(
  $$ select * from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201') $$,
  '42501', null, '9a. a session without a subject cannot read');

-- 12 / 13. Forged claims and headers.
select pg_temp.act('3202', '{"x-platform-admin":"true","x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000003201"}',
  '{"sub":"20000000-0000-4000-8000-000000003202","role":"service_role","app_metadata":{"platform_admin":true}}');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 4, 'X', '#000000', '#ffffff', array['services']) $$,
  '42501', null, '12/13. forged admin claims and headers do not grant draft writes');

-- 14. Direct table access as an API role.
select throws_ok(
  $$ insert into private.tenant_white_label_drafts (tenant_id, display_name, primary_color, accent_color, module_keys, revision, updated_by)
     values ('f0f0f0f0-0000-4000-8000-000000003202', 'Self', '#000000', '#ffffff', '{}', 1, '20000000-0000-4000-8000-000000003202') $$,
  '42501', null, '14a. authenticated cannot write the draft table directly');
select throws_ok($$ select * from private.tenant_white_label_drafts $$, '42501', null,
  '14b. authenticated cannot read the draft table directly');
select throws_ok($$ update private.tenant_white_label_drafts set revision = 1 $$, '42501', null,
  '14c. authenticated cannot rewrite revisions directly');
reset role;

set local role anon;
select pg_temp.act(null);
select throws_ok(
  $$ select * from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201') $$,
  '42501', null, '9b. anon cannot read a draft');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 4, 'X', '#000000', '#ffffff', array['services']) $$,
  '42501', null, '9c. anon cannot write a draft');
reset role;

set local role service_role;
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 4, 'X', '#000000', '#ffffff', array['services']) $$,
  '42501', null, '14d. service_role cannot call the save RPC');
select throws_ok(
  $$ insert into private.tenant_white_label_drafts (tenant_id, display_name, primary_color, accent_color, module_keys, revision, updated_by)
     values ('f0f0f0f0-0000-4000-8000-000000003202', 'Svc', '#000000', '#ffffff', '{}', 1, '20000000-0000-4000-8000-000000003201') $$,
  '42501', null, '14e. service_role cannot write the draft table');
reset role;

-- 11. Revocation takes effect on the very next call of an open session.
set local role authenticated;
select pg_temp.act('3206');
select is((select revision from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201')), 4,
  '11a. a Platform Admin reads before revocation');
reset role;
select private.revoke_platform_admin('20000000-0000-4000-8000-000000003206', 'pgTAP 129 revocation');
set local role authenticated;
select pg_temp.act('3206');
select throws_ok(
  $$ select * from public.app_get_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201') $$,
  '42501', null, '11b. after revocation the same session cannot read');
select throws_ok(
  $$ select * from public.app_save_white_label_draft('f0f0f0f0-0000-4000-8000-000000003201', 4, 'X', '#000000', '#ffffff', array['services']) $$,
  '42501', null, '11c. after revocation the same session cannot write');
reset role;

-- 23 / 24. Runtime authorization and Tenant business data are untouched.
select is(
  (select row(modules, role_permissions, overrides, memberships) from runtime_before),
  (select row(
     (select md5(string_agg(m::text, ',' order by m.module_key)) from public.permission_modules as m),
     (select md5(string_agg(r::text, ',' order by r::text)) from public.role_permissions as r),
     (select md5(string_agg(o::text, ',' order by o::text)) from public.profile_permission_overrides as o),
     (select md5(string_agg(tm::text, ',' order by tm::text)) from public.tenant_memberships as tm))),
  '23c. module registry, role permissions, overrides and memberships are unchanged');
select is(
  (select row(tenants, profiles) from runtime_before),
  (select row(
     (select md5(string_agg(t::text, ',' order by t.id)) from public.tenants as t),
     (select md5(string_agg(p::text, ',' order by p.id)) from public.profiles as p))),
  '24. Tenant records (including their real display names) and profiles are unchanged');

select * from finish();
rollback;
