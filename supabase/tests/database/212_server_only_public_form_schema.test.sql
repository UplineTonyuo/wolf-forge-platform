begin;
select no_plan();

select ok(has_function_privilege('anon', 'public.app_get_published_form_schema(text)', 'EXECUTE'), 'legacy anonymous schema RPC remains available during application rollout');
select ok(has_function_privilege('authenticated', 'public.app_get_published_form_schema(text)', 'EXECUTE'), 'authenticated schema RPC execution is preserved');
select ok(not has_function_privilege('anon', 'public.app_get_public_form_schema(uuid,text)', 'EXECUTE'), 'anon cannot execute the trusted public read');
select ok(not has_function_privilege('authenticated', 'public.app_get_public_form_schema(uuid,text)', 'EXECUTE'), 'authenticated cannot execute the trusted public read');
select ok(has_function_privilege('service_role', 'public.app_get_public_form_schema(uuid,text)', 'EXECUTE'), 'only the trusted server API role can execute the public read');
select ok(has_function_privilege('anon', 'public.app_submit_form(uuid,uuid,jsonb,jsonb,jsonb)', 'EXECUTE'), 'anonymous submissions retain the existing guarded RPC');

insert into auth.users (id, aud, role, email, created_at, updated_at)
values ('f2120000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'public-read-212@example.invalid', now(), now());
update public.profiles set role_id = (select id from public.roles where name = 'owner')
where id = 'f2120000-0000-4000-8000-000000000001';

create temp table public212_ids (label text primary key, id uuid);
grant select, insert on public212_ids to authenticated, service_role;

create function pg_temp.public212_definition(p_visibility text default 'public') returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Public read boundary', 'title', 'Published public read', 'visibility', p_visibility,
    'type_config', jsonb_build_object('subject_field_key', 'f2120000-0000-4000-8000-000000000002', 'message_field_key', 'f2120000-0000-4000-8000-000000000003', 'ticket_orchestration', 'deferred'),
    'fields', jsonb_build_array(
      jsonb_build_object('stable_field_key', 'f2120000-0000-4000-8000-000000000002', 'sort_order', 0, 'field_type', 'text', 'label', 'Subject', 'required', true),
      jsonb_build_object('stable_field_key', 'f2120000-0000-4000-8000-000000000003', 'sort_order', 1, 'field_type', 'textarea', 'label', 'Message', 'required', true)
    ), 'rules', '[]'::jsonb, 'service_links', '[]'::jsonb
  );
$$;
grant execute on function pg_temp.public212_definition(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f2120000-0000-4000-8000-000000000001', true);
select set_config('request.headers', '{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}', true);
insert into public212_ids values ('published', (public.app_create_form(gen_random_uuid(), jsonb_build_object('form_type','contact','canonical_key','public212-published','definition',pg_temp.public212_definition()))).id);
insert into public212_ids values ('version', (public.app_publish_form(gen_random_uuid(), (select id from public212_ids where label='published'))).id);
insert into public212_ids values ('draft', (public.app_create_form(gen_random_uuid(), jsonb_build_object('form_type','contact','canonical_key','public212-draft','definition',pg_temp.public212_definition()))).id);
insert into public212_ids values ('private', (public.app_create_form(gen_random_uuid(), jsonb_build_object('form_type','contact','canonical_key','public212-private','definition',pg_temp.public212_definition('authenticated')))).id);
select public.app_publish_form(gen_random_uuid(), (select id from public212_ids where label='private'));
select is(public.app_get_published_form_schema('public212-private')->>'visibility', 'authenticated', 'existing authenticated non-public caller keeps working');
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')$$, '42501', null, 'authenticated direct trusted-read call is denied');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select is(public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')->>'form_version_id', (select id::text from public212_ids where label='version'), 'trusted read returns the exact published version');
select is(jsonb_array_length(public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')->'fields'), 2, 'safe projection contains published fields');
select ok(not (public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published') ?| array['submissions','values','created_by_profile_id','tenant_id']), 'safe projection excludes respondent and actor records');
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000002','public212-published')$$, 'P0002', null, 'foreign tenant key is not found');
select throws_ok($$select public.app_get_public_form_schema(null,'public212-published')$$, 'P0002', null, 'missing tenant has no fallback');
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-draft')$$, 'P0002', null, 'unpublished form is not found');
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-private')$$, 'P0002', null, 'non-public form is not found');

reset role;
update public.tenants set status = 'suspended' where id = 'f0f0f0f0-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')$$, 'P0002', null, 'suspended tenant is not found');
reset role;
update public.tenants set status = 'archived', archived_at = now() where id = 'f0f0f0f0-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')$$, 'P0002', null, 'archived tenant is not found');
reset role;
update public.tenants set status = 'active', archived_at = null where id = 'f0f0f0f0-0000-4000-8000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', 'f2120000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.app_archive_form(gen_random_uuid(), (select id from public212_ids where label='published'));
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')$$, 'P0002', null, 'archived published form is not found');
set local role anon;
select throws_ok($$select public.app_get_published_form_schema('public212-published')$$, 'P0002', null, 'legacy anonymous reader still rejects archived forms');
select throws_ok($$select public.app_get_public_form_schema('f0f0f0f0-0000-4000-8000-000000000001','public212-published')$$, '42501', null, 'anonymous new direct read is denied');

reset role;
select * from finish();
rollback;
