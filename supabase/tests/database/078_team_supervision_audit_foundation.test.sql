begin;

select plan(32);

create temp table supervision_audit_before on commit drop as
select id from public.security_audit_events;

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('7f200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'audit-owner@example.invalid', now(), now()),
  ('7f200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'audit-admin@example.invalid', now(), now()),
  ('7f200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'audit-staff@example.invalid', now(), now()),
  ('7f200000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'audit-client@example.invalid', now(), now());

update public.profiles as profile_row
set role_id = role_row.id
from public.roles as role_row
where profile_row.id = case role_row.name
  when 'owner' then '7f200000-0000-4000-8000-000000000001'::uuid
  when 'admin' then '7f200000-0000-4000-8000-000000000002'::uuid
  when 'staff' then '7f200000-0000-4000-8000-000000000003'::uuid
  when 'client' then '7f200000-0000-4000-8000-000000000004'::uuid
end;

insert into public.team_conversations (tenant_id, id, conversation_key, created_by_profile_id, kind)
values (
  private.wolf_forge_tenant_id(),
  '7f210000-0000-4000-8000-000000000001',
  '7f200000-0000-4000-8000-000000000001|7f200000-0000-4000-8000-000000000002',
  '7f200000-0000-4000-8000-000000000001',
  'direct'
);

insert into public.team_conversation_members (conversation_id, profile_id)
values
  ('7f210000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000001'),
  ('7f210000-0000-4000-8000-000000000001', '7f200000-0000-4000-8000-000000000002');

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

select is(
  (select count(*) from private.security_audit_event_codes
   where event_code = 'authorization.team_supervision.read'
     and category = 'authorization'
     and severity = 'info'),
  1::bigint,
  'the canonical Team supervision read event exists exactly once'
);

select has_function(
  'private',
  'write_team_supervision_audit',
  array['text', 'uuid', 'integer', 'text'],
  'the dedicated private audit writer exists'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'private.write_team_supervision_audit(text,uuid,integer,text)'::regprocedure),
  'the writer is SECURITY DEFINER'
);

select is(
  (select provolatile from pg_proc
   where oid = 'private.write_team_supervision_audit(text,uuid,integer,text)'::regprocedure),
  'v'::"char",
  'the audit-writing helper is VOLATILE'
);

select ok(
  'search_path=""' = any (
    select unnest(proconfig) from pg_proc
    where oid = 'private.write_team_supervision_audit(text,uuid,integer,text)'::regprocedure
  ),
  'the writer fixes an empty search_path'
);

select is(
  (select proargnames from pg_proc
   where oid = 'private.write_team_supervision_audit(text,uuid,integer,text)'::regprocedure),
  array['p_action_slug', 'p_conversation_id', 'p_result_count', 'p_correlation_id'],
  'the typed contract accepts no actor, event code, metadata, body, or query argument'
);

select is(
  (select count(*) from pg_proc as function_row,
    lateral aclexplode(function_row.proacl) as acl
   where function_row.oid = 'private.write_team_supervision_audit(text,uuid,integer,text)'::regprocedure
     and acl.grantee = 0
     and acl.privilege_type = 'EXECUTE'),
  0::bigint,
  'PUBLIC has no EXECUTE grant on the private writer'
);

select ok(
  not has_function_privilege('anon', 'private.write_team_supervision_audit(text,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.write_team_supervision_audit(text,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.write_team_supervision_audit(text,uuid,integer,text)', 'EXECUTE'),
  'anon, authenticated, and service_role have no direct EXECUTE grant'
);

set local role authenticated;
select pg_temp.become('7f200000-0000-4000-8000-000000000002');
select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', '7f210000-0000-4000-8000-000000000001', 1, null)$$,
  '42501', null,
  'a browser session cannot call the private writer, even as Admin'
);
reset role;

set local role service_role;
select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', '7f210000-0000-4000-8000-000000000001', 1, null)$$,
  '42501', null,
  'service_role cannot call the private writer through the Data API'
);
reset role;

select pg_temp.become('7f200000-0000-4000-8000-000000000003');
select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', '7f210000-0000-4000-8000-000000000001', 1, null)$$,
  '42501', null,
  'a trusted invocation still rejects Staff through require_team_supervisor'
);

select pg_temp.become('7f200000-0000-4000-8000-000000000004');
select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', '7f210000-0000-4000-8000-000000000001', 1, null)$$,
  '42501', null,
  'a trusted invocation still rejects Client through require_team_supervisor'
);

select pg_temp.become('7f200000-0000-4000-8000-000000000001');
select lives_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', '7f210000-0000-4000-8000-000000000001', 1, repeat('a', 32))$$,
  'Owner can append an open audit event through the trusted boundary'
);
select lives_ok(
  $$select private.write_team_supervision_audit('team.supervision.page', '7f210000-0000-4000-8000-000000000001', 25, null)$$,
  'page is an allowed action'
);

select pg_temp.become('7f200000-0000-4000-8000-000000000002');
select lives_ok(
  $$select private.write_team_supervision_audit('team.supervision.search', '7f210000-0000-4000-8000-000000000001', 3, repeat('b', 32))$$,
  'Admin can append the allowed search action'
);

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'),
  3::bigint,
  'the three allowed actions each produced one event'
);

select is(
  (select actor_profile_id from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and action_slug = 'team.supervision.search'),
  '7f200000-0000-4000-8000-000000000002'::uuid,
  'the event actor comes from the authenticated supervisor, not an argument'
);

select ok(
  exists (
    select 1 from public.security_audit_events
    where id not in (select id from supervision_audit_before)
      and action_slug = 'team.supervision.open'
      and event_code = 'authorization.team_supervision.read'
      and actor_class = 'internal'
      and resource_type = 'team_conversation'
      and resource_id = '7f210000-0000-4000-8000-000000000001'
      and outcome = 'succeeded'
      and correlation_id = repeat('a', 32)
      and occurred_at > now() - interval '5 seconds'
  ),
  'the event has the fixed code, resource, outcome, correlation, and database timestamp'
);

select is(
  (select metadata from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and action_slug = 'team.supervision.search'),
  '{"read_kind":"search","conversation_kind":"direct","result_count":3}'::jsonb,
  'metadata contains only bounded non-content fields derived by the writer'
);

select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.export', '7f210000-0000-4000-8000-000000000001', 1, null)$$,
  '22023', null,
  'an arbitrary action is rejected'
);

select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', null, 1, null)$$,
  '22023', null,
  'a missing conversation resource is rejected'
);

select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.open', '7f210000-0000-4000-8000-000000000099', 1, null)$$,
  'P0002', null,
  'a nonexistent conversation resource is rejected'
);

select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.page', '7f210000-0000-4000-8000-000000000001', -1, null)$$,
  '22023', null,
  'a negative result count is rejected'
);

select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.page', '7f210000-0000-4000-8000-000000000001', 1001, null)$$,
  '22023', null,
  'an unbounded result count is rejected'
);

select throws_ok(
  $$select private.write_team_supervision_audit('team.supervision.search', '7f210000-0000-4000-8000-000000000001', 1, 'employee search words')$$,
  '22023', null,
  'search text cannot be smuggled through the bounded correlation field'
);

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'),
  3::bigint,
  'rejected inputs persisted no audit rows'
);

select throws_ok(
  $$update public.security_audit_events set outcome = 'failed'
    where id not in (select id from supervision_audit_before)
      and event_code = 'authorization.team_supervision.read'$$,
  '55000', 'security audit events are append-only',
  'supervision audit rows cannot be modified'
);

select throws_ok(
  $$delete from public.security_audit_events
    where id not in (select id from supervision_audit_before)
      and event_code = 'authorization.team_supervision.read'$$,
  '55000', 'security audit events are append-only',
  'supervision audit rows cannot be deleted'
);

select pg_temp.become('7f200000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.app_get_team_conversation('7f210000-0000-4000-8000-000000000001')$$,
  'an ordinary participant conversation read still works'
);
reset role;

select is(
  (select count(*) from public.security_audit_events
   where id not in (select id from supervision_audit_before)
     and event_code = 'authorization.team_supervision.read'),
  3::bigint,
  'ordinary participant reads emit no supervision audit event'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name like 'team_%'
     and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint,
  'the checkpoint adds no direct Team table grant'
);

select is(
  (select count(*) from pg_proc as function_row
   join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
   where schema_row.nspname = 'public'
     and function_row.proname like 'app_search_team_supervised%'
     and function_row.proname <> 'app_search_team_supervised_conversation_messages'),
  0::bigint,
  'no additional or global supervisory search RPC exists'
);

select * from finish();
rollback;
