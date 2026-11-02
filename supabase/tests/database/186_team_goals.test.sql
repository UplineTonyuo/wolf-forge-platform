begin;
select no_plan();
select ok(not has_table_privilege('authenticated','private.team_goals','SELECT'),'raw goal rows are private');
select ok(not has_table_privilege('authenticated','private.team_goal_milestones','UPDATE'),'raw milestones cannot bypass RPCs');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.team_goals'::regclass),'Goals force RLS');
select ok(not has_function_privilege('anon','public.app_get_team_goal(uuid)','EXECUTE'),'anonymous cannot read a goal');
select ok(not has_function_privilege('service_role','public.app_save_team_goal(uuid,jsonb,timestamptz)','EXECUTE'),'service role cannot impersonate a goal author');
select ok(not (select public from storage.buckets where id='team-goal-photos'),'goal photo bucket is private');

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000186'||n)::uuid,'authenticated','authenticated','goal-'||n||'@example.invalid',now(),now() from generate_series(1,6)n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001861','goals-a','Goals A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001862','goals-b','Goals B','active');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
select v.tenant::uuid,v.profile::uuid,v.class,r.id from(values
 ('f0f0f0f0-0000-4000-8000-000000001861','20000000-0000-4000-8000-000000001861','internal','owner'),
 ('f0f0f0f0-0000-4000-8000-000000001861','20000000-0000-4000-8000-000000001862','internal','admin'),
 ('f0f0f0f0-0000-4000-8000-000000001861','20000000-0000-4000-8000-000000001863','internal','manager'),
 ('f0f0f0f0-0000-4000-8000-000000001861','20000000-0000-4000-8000-000000001864','internal','staff'),
 ('f0f0f0f0-0000-4000-8000-000000001861','20000000-0000-4000-8000-000000001865','client','client'),
 ('f0f0f0f0-0000-4000-8000-000000001862','20000000-0000-4000-8000-000000001866','internal','owner')
)v(tenant,profile,class,role_name)join public.roles r on r.name=v.role_name;
create function pg_temp.goal_act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000001861')returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000186'||n,true);
 select set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000186'||n,'role','authenticated')::text,true);
 select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);
$$;
create temp table goal_vars(name text primary key,value jsonb);
grant select,insert,update on goal_vars to authenticated;
insert into goal_vars values('input',jsonb_build_object('title','Office','description','A shared goal','owner_profile_id','20000000-0000-4000-8000-000000001864',
 'due_date','2026-11-30','visibility','shared','milestones',jsonb_build_array(jsonb_build_object('title','Plan'),jsonb_build_object('title','Finish')),
 'request_id','30000000-0000-4000-8000-000000001861'));
select pg_temp.goal_act(1);
set local role authenticated;
insert into goal_vars values('shared',public.app_save_team_goal(null,(select value from goal_vars where name='input')));
select is((select value->>'title' from goal_vars where name='shared'),'Office'::text,'Owner creates a goal');
select ok((select value ? 'owner_avatar_url' from goal_vars where name='shared'),'goal exposes the existing owner avatar metadata');
select ok((public.app_team_goal_members()->0) ? 'avatar_url','assignment roster exposes existing avatars');
select is((select (value->>'milestone_count')::integer from goal_vars where name='shared'),2,'milestones persisted');
select is(public.app_save_team_goal(null,(select value from goal_vars where name='input'))->>'id',(select value->>'id' from goal_vars where name='shared'),'same create key is idempotent');
select throws_ok($q$select public.app_save_team_goal(null,(select value||'{"due_date":"infinity","request_id":"30000000-0000-4000-8000-000000001868"}'::jsonb from goal_vars where name='input'))$q$,'22023',null,'nonfinite dates are refused at the RPC boundary');
select throws_ok($q$select public.app_save_team_goal(null,(select value||'{"due_date":"10000-01-01","request_id":"30000000-0000-4000-8000-000000001869"}'::jsonb from goal_vars where name='input'))$q$,'22023',null,'dates outside four-digit ISO years are refused');
select throws_ok($q$select public.app_save_team_goal(null,(select value||'{"title":"Different"}'::jsonb from goal_vars where name='input'))$q$,'23505',null,'create key cannot silently change intent');
insert into goal_vars values('other',public.app_save_team_goal(null,(select value||jsonb_build_object('visibility','shared','owner_profile_id','20000000-0000-4000-8000-000000001861','request_id','30000000-0000-4000-8000-000000001862') from goal_vars where name='input')));
select is(jsonb_array_length(public.app_list_team_goals()->'items'),2,'Owner sees all team goals');
select throws_ok($q$select public.app_save_team_goal(null,(select value||'{"visibility":"leadership","request_id":"30000000-0000-4000-8000-000000001863"}'::jsonb from goal_vars where name='input'))$q$,'22023',null,'leadership-only goals cannot be created');
select pg_temp.goal_act(2);
select is(jsonb_array_length(public.app_list_team_goals()->'items'),2,'Admin sees all team goals');
select pg_temp.goal_act(3);
select is(jsonb_array_length(public.app_list_team_goals()->'items'),2,'Manager sees all team goals');
select throws_ok($q$select public.app_save_team_goal(null,(select value from goal_vars where name='input'))$q$,'42501',null,'Manager cannot create goals');
select throws_ok($q$select public.app_team_goal_members()$q$,'42501',null,'Manager cannot query assignment roster');
select is(public.app_get_team_goal((select (value->>'id')::uuid from goal_vars where name='other'))->>'visibility','shared'::text,'Manager reads another internal owner goal');
select pg_temp.goal_act(4);
select is(jsonb_array_length(public.app_list_team_goals()->'items'),2,'Staff sees all team goals');
select is(public.app_set_team_goal_milestone((select(value->>'id')::uuid from goal_vars where name='shared'),(select(value->'milestones'->0->>'id')::uuid from goal_vars where name='shared'),true)->>'completed_count','1'::text,'assigned staff completes a milestone');
select is(public.app_set_team_goal_milestone((select(value->>'id')::uuid from goal_vars where name='shared'),(select(value->'milestones'->0->>'id')::uuid from goal_vars where name='shared'),true)->>'completed_count','1'::text,'duplicate completion does not increment progress');
select throws_ok($q$select public.app_team_goal_photo_context((select(value->>'id')::uuid from goal_vars where name='shared'),true)$q$,'42501',null,'Staff cannot upload a cover');
select lives_ok($q$select public.app_team_goal_photo_context((select(value->>'id')::uuid from goal_vars where name='other'),false)$q$,'Staff can read another owner goal photo context');
select pg_temp.goal_act(3);
select throws_ok($q$select public.app_set_team_goal_milestone((select(value->>'id')::uuid from goal_vars where name='shared'),(select(value->'milestones'->1->>'id')::uuid from goal_vars where name='shared'),true)$q$,'42501',null,'unassigned Manager cannot complete milestones');
select pg_temp.goal_act(5);
select throws_ok($q$select public.app_list_team_goals()$q$,'42501',null,'client has no Goals access');
select pg_temp.goal_act(6,'f0f0f0f0-0000-4000-8000-000000001862');
select is(jsonb_array_length(public.app_list_team_goals()->'items'),0,'foreign Tenant Owner sees no goals from A');
select throws_ok($q$select public.app_get_team_goal((select(value->>'id')::uuid from goal_vars where name='shared'))$q$,'P0002',null,'foreign Tenant ID is unavailable');
select pg_temp.goal_act(1);
select throws_ok($q$select public.app_save_team_goal((select(value->>'id')::uuid from goal_vars where name='shared'),(select value from goal_vars where name='input'),(select(value->>'updated_at')::timestamptz from goal_vars where name='shared'))$q$,'23505',null,'stale edit cannot overwrite progress');
select is(public.app_get_team_goal((select(value->>'id')::uuid from goal_vars where name='shared'))->>'completed_count','1'::text,'stale edit preserved completion');
select throws_ok($q$select public.app_set_team_goal_milestone((select(value->>'id')::uuid from goal_vars where name='shared'),(select(value->'milestones'->0->>'id')::uuid from goal_vars where name='other'),true)$q$,'P0002',null,'milestone must belong to the goal');
select throws_ok($q$select public.app_set_team_goal_photo((select(value->>'id')::uuid from goal_vars where name='shared'),'other-tenant/photo.png','image/png',8,repeat('a',64),(public.app_get_team_goal((select(value->>'id')::uuid from goal_vars where name='shared'))->>'updated_at')::timestamptz)$q$,'22023',null,'photo path cannot reference another goal or Tenant');
select throws_ok('select * from private.team_goals','42501',null,'authenticated cannot read the private table directly');
-- Exercise the successful edit path with real persisted milestone IDs.
update goal_vars set value=public.app_get_team_goal((value->>'id')::uuid) where name='shared';
insert into goal_vars values('edited',public.app_save_team_goal(
 (select(value->>'id')::uuid from goal_vars where name='shared'),
 (select i.value||jsonb_build_object('title','Office refreshed','milestones',g.value->'milestones')
   from goal_vars i,goal_vars g where i.name='input' and g.name='shared'),
 (select(value->>'updated_at')::timestamptz from goal_vars where name='shared')));
select is((select value->>'title' from goal_vars where name='edited'),'Office refreshed'::text,'current revision edits persist');
select is((select value->>'completed_count' from goal_vars where name='edited'),'1'::text,'renaming a goal preserves completed milestones');
select is((select value->'milestones'->0->>'id' from goal_vars where name='edited'),(select value->'milestones'->0->>'id' from goal_vars where name='shared'),'edit preserves milestone identity');
reset role;
-- A Storage object created by the trusted transport must register with a normal filename.
insert into goal_vars values('path',to_jsonb('f0f0f0f0-0000-4000-8000-000000001861/'||(select value->>'id' from goal_vars where name='shared')||'/40000000-0000-4000-8000-000000001861.png'));
insert into storage.objects(bucket_id,name) values('team-goal-photos',(select value#>>'{}' from goal_vars where name='path'));
set local role authenticated;
insert into goal_vars values('with_photo',public.app_set_team_goal_photo(
 (select(value->>'id')::uuid from goal_vars where name='shared'),(select value#>>'{}' from goal_vars where name='path'),
 'image/png',8,repeat('a',64),(select(value->>'updated_at')::timestamptz from goal_vars where name='edited')));
select is((select value->>'photo_path' from goal_vars where name='with_photo'),(select value#>>'{}' from goal_vars where name='path'),'normal private photo path can be attached');
select throws_ok($q$select public.app_set_team_goal_photo(
 (select(value->>'id')::uuid from goal_vars where name='shared'),(select value#>>'{}' from goal_vars where name='path'),
 'image/png',8,repeat('a',64),(select(value->>'updated_at')::timestamptz from goal_vars where name='edited'))$q$,'23505',null,'stale photo replacement cannot overwrite a newer pointer');
reset role;
-- Pagination remains bounded across the shared team collection.
insert into private.team_goals(tenant_id,title,owner_profile_id,visibility,created_by,updated_by,request_id,request_hash)
select 'f0f0f0f0-0000-4000-8000-000000001861','Shared page fixture '||n,'20000000-0000-4000-8000-000000001861',
 'shared','20000000-0000-4000-8000-000000001861','20000000-0000-4000-8000-000000001861',extensions.gen_random_uuid(),'fixture' from generate_series(1,51)n;
select pg_temp.goal_act(1);
set local role authenticated;
select is(jsonb_array_length(public.app_list_team_goals(null,'leadership')->'items'),0,'legacy leadership filter has no private collection');
select is(jsonb_array_length(public.app_list_team_goals(null,'shared')->'items'),50,'filtered page stays bounded');
insert into goal_vars values('shared_page',public.app_list_team_goals(null,'shared'));
select is(jsonb_array_length(public.app_list_team_goals((select(value->>'next_before')::uuid from goal_vars where name='shared_page'),'shared')->'items'),3,'filtered cursor reaches the remaining shared goals');
select throws_ok($q$select public.app_list_team_goals(null,'invalid')$q$,'22023',null,'unknown visibility filters are refused');
select throws_ok($q$select public.app_list_team_goals((select(value->>'next_before')::uuid from goal_vars where name='shared_page'),'leadership')$q$,'22023',null,'cursor cannot silently switch visibility');
select pg_temp.goal_act(4);
select is(jsonb_array_length(public.app_list_team_goals(null,'leadership')->'items'),0,'legacy leadership filter stays empty for staff');
reset role;
update public.tenant_memberships set archived_at=now() where profile_id='20000000-0000-4000-8000-000000001864';
select pg_temp.goal_act(4);
set local role authenticated;
select throws_ok('select public.app_list_team_goals()','42501',null,'archived membership loses Goals access');
reset role;
select * from finish();
rollback;
