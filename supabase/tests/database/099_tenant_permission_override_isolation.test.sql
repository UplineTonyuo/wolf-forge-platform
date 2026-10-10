begin;

select plan(49);

-- WL-2.2 (KI-110): a permission override belongs to one Tenant membership.
-- One global profile P is a member of Wolf Forge (WF) and Tenant B; a change in
-- one Tenant never reads, writes or influences P's overrides in the other.
-- WF = f0f0f0f0-0000-4000-8000-000000000001, Tenant B = ...0991.

-- -----------------------------------------------------------------------------
-- Schema and ownership
-- -----------------------------------------------------------------------------

select col_not_null('public', 'profile_permission_overrides', 'tenant_id',
  'profile_permission_overrides.tenant_id is NOT NULL');

select is(
  (select jsonb_object_agg(conname, pg_get_constraintdef(oid))
    from pg_constraint
    where conrelid = 'public.profile_permission_overrides'::regclass
      and conname in ('profile_permission_overrides_pkey', 'profile_permission_overrides_membership_fkey',
        'profile_permission_overrides_tenant_id_fkey')),
  jsonb_build_object(
    'profile_permission_overrides_pkey', 'PRIMARY KEY (tenant_id, profile_id, permission_key)',
    'profile_permission_overrides_membership_fkey',
      'FOREIGN KEY (tenant_id, profile_id) REFERENCES tenant_memberships(tenant_id, profile_id) ON DELETE CASCADE',
    'profile_permission_overrides_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT'
  ),
  'overrides are unique per Tenant and belong to a membership of that Tenant'
);

select is(
  (select column_default::text from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_permission_overrides' and column_name = 'tenant_id'),
  'private.identity_tenant_id()',
  'new overrides default to the caller''s resolved Tenant'
);

select is(
  (select count(*) from public.profile_permission_overrides as override_row
    where not exists (select 1 from public.tenant_memberships as membership
      where membership.tenant_id = override_row.tenant_id
        and membership.profile_id = override_row.profile_id)),
  0::bigint,
  'every stored override belongs to its authoritative Tenant membership'
);

select ok(
  not has_table_privilege('authenticated', 'public.profile_permission_overrides', 'select'),
  'authenticated still has no direct read on overrides'
);

-- -----------------------------------------------------------------------------
-- Fixtures (rolled back)
-- -----------------------------------------------------------------------------

-- 991 WF admin (A manager); 992 B admin (B manager, WF archived); 993 P: staff
-- in WF and in B; 994 WF owner; 995 B owner (WF archived); 996 owner of both;
-- 997 B admin with an archived B membership (WF archived); 998 Q: WF staff only.
insert into auth.users (id, aud, role, email, created_at, updated_at)
select ('20000000-0000-0000-0000-000000000' || n)::uuid, 'authenticated', 'authenticated',
  'override-' || n || '@example.invalid', now(), now()
from unnest(array['991', '992', '993', '994', '995', '996', '997', '998']) as n;

insert into public.tenants (id, slug, display_name, status)
values ('f0f0f0f0-0000-4000-8000-000000000991', 'override-tenant-b', 'Override Tenant B', 'active');

update public.profiles as profile
set role_id = role.id,
    archived_at = fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000991', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000000992', 'admin', now()),
  ('20000000-0000-0000-0000-000000000993', 'staff', null),
  ('20000000-0000-0000-0000-000000000994', 'owner', null),
  ('20000000-0000-0000-0000-000000000995', 'owner', now()),
  ('20000000-0000-0000-0000-000000000996', 'owner', null),
  ('20000000-0000-0000-0000-000000000997', 'admin', now()),
  ('20000000-0000-0000-0000-000000000998', 'staff', null)
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name
where profile.id = fixture.profile_id::uuid;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select 'f0f0f0f0-0000-4000-8000-000000000991', fixture.profile_id::uuid, 'internal', role.id, fixture.archived_at
from (values
  ('20000000-0000-0000-0000-000000000992', 'admin', null::timestamptz),
  ('20000000-0000-0000-0000-000000000993', 'staff', null),
  ('20000000-0000-0000-0000-000000000995', 'owner', null),
  ('20000000-0000-0000-0000-000000000996', 'owner', null),
  ('20000000-0000-0000-0000-000000000997', 'admin', now())
) as fixture(profile_id, role_name, archived_at)
join public.roles as role on role.name = fixture.role_name;

create function pg_temp.override(p_tenant text, p_key text)
returns boolean
language sql
-- Readback probe for the test only; callers cannot read the table.
security definer
as $$
  select allowed from public.profile_permission_overrides
  where tenant_id = case p_tenant when 'wf' then 'f0f0f0f0-0000-4000-8000-000000000001'::uuid
      else 'f0f0f0f0-0000-4000-8000-000000000991'::uuid end
    and profile_id = '20000000-0000-0000-0000-000000000993'
    and permission_key = p_key;
$$;
grant execute on function pg_temp.override(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Declarative isolation and Wolf Forge regression
-- -----------------------------------------------------------------------------

select throws_ok(
  $$insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
    values ('f0f0f0f0-0000-4000-8000-000000000991', '20000000-0000-0000-0000-000000000998', 'invoices.void', true)$$,
  '23503',
  'insert or update on table "profile_permission_overrides" violates foreign key constraint "profile_permission_overrides_membership_fkey"',
  'a Tenant cannot hold an override for a profile that is not its member'
);

select lives_ok(
  $$insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
    values (private.wolf_forge_tenant_id(), '20000000-0000-0000-0000-000000000993', 'tickets.archive', true),
           ('f0f0f0f0-0000-4000-8000-000000000991', '20000000-0000-0000-0000-000000000993', 'tickets.archive', false)$$,
  'one profile may hold opposite overrides for the same permission in two Tenants'
);

-- Wolf Forge equivalence: with only Wolf Forge rows for these profiles, the
-- Tenant-relative check equals the previous global-override formula. Profiles
-- with no Wolf Forge membership (D-275, e.g. Local QA Tenant B identities)
-- never had a Wolf Forge mirror to be equivalent to.
select is(
  (select count(*) from public.profiles as profile_row
    cross join public.permissions as permission
    where profile_row.archived_at is null
      and profile_row.id <> '20000000-0000-0000-0000-000000000993'
      and exists (
        select 1 from public.tenant_memberships as membership_row
        where membership_row.profile_id = profile_row.id
          and membership_row.tenant_id = private.wolf_forge_tenant_id()
      )
      and private.profile_has_permission(profile_row.id, permission.permission_key) is distinct from coalesce((
        select case when preset_row.key = 'owner' then true else coalesce(
          (select o.allowed from public.profile_permission_overrides as o
            where o.profile_id = profile_row.id and o.permission_key = permission.permission_key),
          (select g.allowed from public.role_permissions as g
            where g.role_id = profile_row.role_id and g.permission_key = permission.permission_key),
          false) end
        from public.permission_presets as preset_row where preset_row.role_id = profile_row.role_id
      ), false)),
  0::bigint,
  'Wolf Forge effective permissions are unchanged for every active profile and permission'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

-- -----------------------------------------------------------------------------
-- Effective permissions follow the selected Tenant's override only
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000993', true);
select set_config('request.headers', '', true);
select ok(public.app_has_permission('tickets.archive'), 'P in WF: the WF allow override applies');
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);
select ok(not public.app_has_permission('tickets.archive'), 'P in Tenant B: the B deny override applies, not the WF allow');

-- -----------------------------------------------------------------------------
-- Tenant A manager: changes only P's Wolf Forge overrides
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000991', true);
select set_config('request.headers', '', true);

select is(
  (select tenant_id from public.app_set_profile_permission_override(
    '20000000-0000-0000-0000-000000000993', 'invoices.void', true)),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'A -> A: WF manager sets P''s WF override'
);
select is(
  (select tenant_id from public.app_grant_report_send_anytime('20000000-0000-0000-0000-000000000993')),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'A -> A: WF manager grants P send-anytime in WF'
);

-- -----------------------------------------------------------------------------
-- Tenant B manager: changes only P's Tenant B overrides
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000992', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);

select is(
  (select row(tenant_id, allowed)::text from public.app_set_profile_permission_override(
    '20000000-0000-0000-0000-000000000993', 'invoices.void', false)),
  row('f0f0f0f0-0000-4000-8000-000000000991'::uuid, false)::text,
  'B -> B: B manager sets P''s B override'
);
select ok(pg_temp.override('wf', 'invoices.void'), 'B -> A: the B override left P''s WF override untouched');

select is(public.app_revoke_report_send_anytime('20000000-0000-0000-0000-000000000993'), false,
  'B -> A: B manager revoking send-anytime finds no B override to remove');
select ok(pg_temp.override('wf', 'reports.send_anytime'), 'B -> A: P keeps the WF send-anytime override');

select is(public.app_clear_profile_permission_override('20000000-0000-0000-0000-000000000993', 'tickets.archive'), true,
  'B -> B: B manager clears P''s B override');
select ok(pg_temp.override('wf', 'tickets.archive'), 'B -> A: clearing in B left P''s WF override untouched');

select throws_ok(
  $$select public.app_set_profile_permission_override('20000000-0000-0000-0000-000000000998', 'invoices.void', true)$$,
  '42501', 'target profile was not found',
  'B manager cannot target a WF-only profile'
);
select throws_ok(
  $$select public.app_grant_report_send_anytime('20000000-0000-0000-0000-000000000998')$$,
  '42501', 'target profile was not found',
  'B manager cannot grant send-anytime to a WF-only profile'
);

-- Reads in B never see P's WF overrides.
select is(
  (select row(allowed, source)::text from public.app_get_profile_effective_permissions('20000000-0000-0000-0000-000000000993')
    where permission_key = 'reports.send_anytime'),
  row(false, 'preset')::text,
  'B read: P''s WF send-anytime override neither applies nor shows as an override in B'
);
select is(
  (select row(allowed, source)::text from public.app_get_profile_effective_permissions('20000000-0000-0000-0000-000000000993')
    where permission_key = 'invoices.void'),
  row(false, 'override')::text,
  'B read: P''s effective invoices.void in B is the B deny override'
);
select is(
  (select override_count from public.app_get_profile_permission_summary('20000000-0000-0000-0000-000000000993')),
  1,
  'B read: P''s override count in B counts only B overrides'
);
select is(
  (select array_agg(profile_id order by profile_id) from public.app_list_internal_members()
    where profile_id::text like '20000000-0000-0000-0000-00000000099_'),
  array['20000000-0000-0000-0000-000000000992', '20000000-0000-0000-0000-000000000993',
    '20000000-0000-0000-0000-000000000995', '20000000-0000-0000-0000-000000000996']::uuid[],
  'B read: the member list holds only active Tenant B members, never WF-only profiles'
);
select is(
  (select row(override_count, report_send_anytime)::text from public.app_list_internal_members()
    where profile_id = '20000000-0000-0000-0000-000000000993'),
  row(1, false)::text,
  'B read: P''s member row shows B overrides and B send-anytime only'
);
select throws_ok($$select count(*) from public.profile_permission_overrides$$,
  '42501', 'permission denied for table profile_permission_overrides', 'B manager cannot read override rows directly');

-- -----------------------------------------------------------------------------
-- Tenant A manager reads and clears only Wolf Forge
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000991', true);
select set_config('request.headers', '', true);

select is(
  (select override_count from public.app_get_profile_permission_summary('20000000-0000-0000-0000-000000000993')),
  3,
  'A read: P''s override count in WF counts only WF overrides'
);
select is(
  (select row(allowed, source)::text from public.app_get_profile_effective_permissions('20000000-0000-0000-0000-000000000993')
    where permission_key = 'invoices.void'),
  row(true, 'override')::text,
  'A read: P''s effective invoices.void in WF is the WF allow override, not B''s deny'
);
select ok(
  not exists (select 1 from public.app_list_internal_members()
    where profile_id in ('20000000-0000-0000-0000-000000000992', '20000000-0000-0000-0000-000000000995')),
  'A read: the WF member list does not contain Tenant B-only members'
);
select is(public.app_clear_profile_permission_override('20000000-0000-0000-0000-000000000993', 'invoices.void'), true,
  'A -> A: WF manager clears P''s WF override');
select is(pg_temp.override('b', 'invoices.void'), false, 'A -> B: clearing in WF left P''s B deny override');

-- -----------------------------------------------------------------------------
-- Owners are owners of the CURRENT Tenant only
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000994', true);
select set_config('request.headers', '', true);
select is(public.app_clear_profile_permission_override('20000000-0000-0000-0000-000000000993', 'invoices.void'), false,
  'WF owner -> B: clearing finds no WF row and leaves the B override');
select is(pg_temp.override('b', 'invoices.void'), false, 'WF owner -> B: P''s B override still denies');
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);
select throws_ok(
  $$select public.app_set_profile_permission_override('20000000-0000-0000-0000-000000000993', 'invoices.void', true)$$,
  '42501', 'verified internal authentication is required', 'WF owner with the B selector but no B membership cannot manage B overrides');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000995', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);
select is(
  (select tenant_id from public.app_grant_report_send_anytime('20000000-0000-0000-0000-000000000993')),
  'f0f0f0f0-0000-4000-8000-000000000991'::uuid,
  'B owner -> B: grants P send-anytime in B'
);
select is(public.app_revoke_report_send_anytime('20000000-0000-0000-0000-000000000993'), true,
  'B owner -> B: revokes P''s B send-anytime');
select ok(pg_temp.override('wf', 'reports.send_anytime'), 'B owner -> A: P''s WF send-anytime survives');
select set_config('request.headers', '', true);
select throws_ok(
  $$select public.app_revoke_report_send_anytime('20000000-0000-0000-0000-000000000993')$$,
  '42501', 'verified internal authentication is required', 'B owner without a selector (archived WF membership) cannot manage WF overrides');

-- Owner of both Tenants: the selector bounds every write.
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000996', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);
select is(
  (select tenant_id from public.app_set_profile_permission_override('20000000-0000-0000-0000-000000000993', 'todo.manage', true)),
  'f0f0f0f0-0000-4000-8000-000000000991'::uuid,
  'dual owner in B: the override lands in B'
);
select is(pg_temp.override('wf', 'todo.manage'), null::boolean, 'dual owner in B: no WF override was written');
select set_config('request.headers', '', true);
select is(
  (select tenant_id from public.app_set_profile_permission_override('20000000-0000-0000-0000-000000000993', 'todo.manage', false)),
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid,
  'dual owner in WF: the override lands in WF'
);
select is(pg_temp.override('b', 'todo.manage'), true, 'dual owner in WF: the B override is unchanged');

-- -----------------------------------------------------------------------------
-- Selector and membership failures
-- -----------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000991', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);
select throws_ok(
  $$select public.app_set_profile_permission_override('20000000-0000-0000-0000-000000000993', 'invoices.void', true)$$,
  '42501', 'verified internal authentication is required', 'WF manager with a foreign selector cannot write');
select throws_ok(
  $$select * from public.app_get_profile_effective_permissions('20000000-0000-0000-0000-000000000993')$$,
  '42501', 'verified internal authentication is required', 'WF manager with a foreign selector cannot read P''s permissions');
select set_config('request.headers', '{"x-wf-tenant":"garbage"}', true);
select throws_ok(
  $$select public.app_clear_profile_permission_override('20000000-0000-0000-0000-000000000993', 'tickets.archive')$$,
  '42501', 'verified internal authentication is required', 'a malformed selector cannot clear');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000997', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000991"}', true);
select throws_ok(
  $$select public.app_grant_report_send_anytime('20000000-0000-0000-0000-000000000993')$$,
  '42501', 'verified internal authentication is required', 'an archived B membership cannot manage B overrides');

-- -----------------------------------------------------------------------------
-- Integrations keep their Wolf Forge-only meaning (D-270 is later work)
-- -----------------------------------------------------------------------------

select set_config('request.headers', '', true);
reset role;
set local "request.jwt.claim.sub" = '';

insert into public.profile_permission_overrides (tenant_id, profile_id, permission_key, allowed)
values ('f0f0f0f0-0000-4000-8000-000000000991', '20000000-0000-0000-0000-000000000993', 'integrations.manage', true);
select ok(not private.integration_actor_can_manage('20000000-0000-0000-0000-000000000993'),
  'a Tenant B integrations override does not let P manage Wolf Forge integrations');

-- -----------------------------------------------------------------------------
-- Final readback
-- -----------------------------------------------------------------------------

select is(
  (select jsonb_object_agg(permission_key, allowed order by permission_key) from public.profile_permission_overrides
    where tenant_id = private.wolf_forge_tenant_id() and profile_id = '20000000-0000-0000-0000-000000000993'),
  jsonb_build_object('reports.send_anytime', true, 'tickets.archive', true, 'todo.manage', false),
  'P''s WF overrides hold only WF-side changes'
);
select is(
  (select jsonb_object_agg(permission_key, allowed order by permission_key) from public.profile_permission_overrides
    where tenant_id = 'f0f0f0f0-0000-4000-8000-000000000991' and profile_id = '20000000-0000-0000-0000-000000000993'),
  jsonb_build_object('integrations.manage', true, 'invoices.void', false, 'todo.manage', true),
  'P''s B overrides hold only B-side changes'
);

select * from finish();
rollback;
