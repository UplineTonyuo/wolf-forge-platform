-- Exercise user-visible reads and writes through their normal RPCs.
begin;
select no_plan();

-- Stable v4-shaped fixture IDs also satisfy the stage, saved reply and tag validators.
create function pg_temp.fixture(label text) returns uuid language sql immutable as $$
  select ('a2150000-0000-4000-8000-' || left(md5(label),12))::uuid
$$;
create function pg_temp.act(label text, tenant uuid default 'f0f0f0f0-0000-4000-8000-000000000001')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.fixture(label)::text,true);
  perform set_config('request.jwt.claims','',true);
  perform set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);
end $$;
create function pg_temp.entry(label text, display_name text, detail text default '') returns jsonb
language sql immutable as $$
  select jsonb_build_object('key',pg_temp.fixture(label),'name',display_name,'color','#112233','description',detail)
$$;
grant execute on function pg_temp.fixture(text),pg_temp.act(text,uuid),pg_temp.entry(text,text,text) to authenticated,service_role;

insert into auth.users(id,aud,role,email,created_at,updated_at)
select pg_temp.fixture(label),'authenticated','authenticated',label || '-215@example.invalid',now(),now()
from unnest(array['a-owner','a-admin','a-client','a-viewer','a-restricted','b-owner','b-client']) as label;

insert into public.tenants(id,slug,display_name,status)
values (pg_temp.fixture('b-tenant'),'process-215-other','Other process workspace','active');
insert into public.companies(id,tenant_id,name,status) values
  (pg_temp.fixture('a-company'),private.wolf_forge_tenant_id(),'Primary process client','client'),
  (pg_temp.fixture('b-company'),pg_temp.fixture('b-tenant'),'Other process client','client');

-- Profile roles mirror the WF membership. The B actors have active memberships only in B.
update public.profiles p set role_id=r.id,
  company_id=case when a.label='a-client' then pg_temp.fixture('a-company') end,
  archived_at=case when a.label in ('b-owner','b-client') then now() end
from (values ('a-owner','owner'),('a-admin','admin'),('a-client','client'),('a-viewer','staff'),
  ('a-restricted','staff'),('b-owner','owner'),('b-client','client')) a(label,role_name)
join public.roles r on r.name=a.role_name where p.id=pg_temp.fixture(a.label);
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select pg_temp.fixture('b-tenant'),pg_temp.fixture(a.label),a.account_class,r.id,
  case when a.label='b-client' then pg_temp.fixture('b-company') end
from (values ('b-owner','internal','owner'),('b-client','client','client')) a(label,account_class,role_name)
join public.roles r on r.name=a.role_name;

insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
select private.wolf_forge_tenant_id(),pg_temp.fixture(label),key,allowed
from (values
  ('a-restricted','settings.view',false),('a-restricted','projects.view',false),
  ('a-restricted','tickets.view',false),('a-restricted','clients.view',false),
  ('a-restricted','tickets.reply',true),
  ('a-viewer','settings.view',true),('a-viewer','projects.view',true),('a-viewer','projects.edit',false),
  ('a-viewer','tickets.view',true),('a-viewer','tickets.reply',true),('a-viewer','clients.view',true),
  ('a-admin','client_private.manage',true),('a-admin','integrations.manage',true),('a-admin','settings.view',true)
) grants(label,key,allowed);

insert into public.services(id,tenant_id,name) values
  (pg_temp.fixture('a-service'),private.wolf_forge_tenant_id(),'Ordinary process work'),
  (pg_temp.fixture('b-service'),pg_temp.fixture('b-tenant'),'Other process work');
insert into public.orders(id,company_id,service_id,title,status,assigned_to_profile_id,completed_at)
select pg_temp.fixture(label),pg_temp.fixture('a-company'),pg_temp.fixture('a-service'),label,status,
  pg_temp.fixture('a-viewer'),case when status='complete' then '2026-01-10 09:00:00.123456+00'::timestamptz end
from (values ('native','complete'),('linked','complete'),('waiting','waiting_reply'),('needs-update','pending_update')) orders(label,status);
insert into public.orders(id,tenant_id,company_id,service_id,title,status) values
  (pg_temp.fixture('b-order'),pg_temp.fixture('b-tenant'),pg_temp.fixture('b-company'),pg_temp.fixture('b-service'),'B order','working'),
  (pg_temp.fixture('monthly'),private.wolf_forge_tenant_id(),pg_temp.fixture('a-company'),
    '5f000000-0000-4000-8000-000000000318','Reporting order','working');
insert into public.tickets(id,order_id,company_id,client_profile_id,subject)
values (pg_temp.fixture('ticket'),pg_temp.fixture('linked'),pg_temp.fixture('a-company'),pg_temp.fixture('a-client'),'Linked conversation');
insert into public.tickets(id,company_id,client_profile_id,subject,status,resolved_at)
values (pg_temp.fixture('rated-ticket'),pg_temp.fixture('a-company'),pg_temp.fixture('a-client'),'Resolved case','resolved',now());
insert into public.tickets(id,tenant_id,company_id,client_profile_id,subject,status,resolved_at)
values (pg_temp.fixture('b-ticket'),pg_temp.fixture('b-tenant'),pg_temp.fixture('b-company'),pg_temp.fixture('b-client'),'B resolved case','resolved',now());

select ok(not has_table_privilege('authenticated','private.process_configuration','select')
  and not has_function_privilege('authenticated','private.process_config(uuid,text)','execute')
  and not has_function_privilege('authenticated','private.process_entries(uuid,text,text[])','execute'),
  'private definitions and projection helpers have no authenticated read grant');

set local role authenticated;
select pg_temp.act('a-admin');
select is((select tenant_id from public.app_current_tenant_membership()),'f0f0f0f0-0000-4000-8000-000000000001'::uuid,'admin is authenticated in A');
select lives_ok($$select public.app_save_process_config('orders',0,(public.app_process_config('orders')->'settings') ||
  jsonb_build_object('reopen',true,'lock',true,'ratings',true,'destination',pg_temp.fixture('a-stage'),
    'entries',(public.app_process_entries('orders') || jsonb_build_array(pg_temp.entry('a-stage','Needs Review','Review revised work')))))$$,
  'A admin configures the custom revision workflow');
select lives_ok($$select public.app_save_process_config('tags',0,jsonb_build_object('entries',jsonb_build_array(
  pg_temp.entry('shared-tag-key','A assigned'),pg_temp.entry('a-extra-tag','A unassigned'))))$$,'A defines two tags');
select lives_ok($$select public.app_save_process_config('saved-replies',0,jsonb_build_object('entries',
  jsonb_build_array(pg_temp.entry('a-reply','A response','Private A template'))))$$,'A saves its template');
select lives_ok($$select public.app_save_process_config('messaging',0,(public.app_process_config('messaging')->'settings')
  || '{"body":"A schedule text","zone":"Asia/Singapore"}')$$,'A saves its messaging policy');
select lives_ok($$select public.app_save_process_config('tickets',0,(public.app_process_config('tickets')->'settings')
  || '{"ratings":true,"reply":"in_progress"}')$$,'A configures ticket ratings and reply status');
select ok(public.app_can_issue_client_invitation(),'authorized admin may issue before the owner-only restriction');
select lives_ok($$select public.app_save_process_config('clients',0,(public.app_process_config('clients')->'settings')
  || '{"ownerOnly":true}')$$,'A enables owner-only invitations');
select is(public.app_can_issue_client_invitation(),false,'the same admin cannot issue after owner-only is enabled');
select pg_temp.act('a-owner');
select ok(public.app_can_issue_client_invitation(),'the active owner can still issue');
select lives_ok($$select public.app_tag_resource(kind,pg_temp.fixture(label),pg_temp.fixture('shared-tag-key')::text,true)
  from (values ('projects','native'),('tickets','ticket'),('clients','a-company')) resource(kind,label)$$,'owner tags three authorized resources');

select pg_temp.act('a-restricted');
select throws_ok(format('select public.app_process_config(%L)',section),'42501',null,'restricted staff cannot read full ' || section)
from unnest(array['orders','tickets','clients','messaging','saved-replies','tags']) as section;
select throws_ok(format('select public.app_process_entries(%L)',section),'42501',null,'restricted staff cannot read operational ' || section)
from unnest(array['orders','tickets','clients','saved-replies']) as section;
select throws_ok($$select public.app_save_process_config('orders',1,'{}')$$,'42501',null,'restricted staff cannot save');
select throws_ok($$select public.app_can_issue_client_invitation()$$,'42501',null,'restricted staff cannot query invitation authorization');

select pg_temp.act('a-viewer');
select throws_ok($$select public.app_process_config('messaging')$$,'42501',null,'Settings module alone does not permit management reads');
select throws_ok($$select public.app_save_process_config('messaging',1,'{}')$$,'42501',null,'Settings module alone does not permit management writes');
select is(jsonb_typeof(public.app_process_entries(section)),'array','authorized workflow returns entries only for ' || section)
from unnest(array['orders','tickets','clients']) as section;
select is(public.app_process_entries('orders')->-1,pg_temp.entry('a-stage','Needs Review','Review revised work'),'staff see ordered stage labels, colors and descriptions');
select is(public.app_process_entries('saved-replies'),jsonb_build_array(pg_temp.entry('a-reply','A response','Private A template')-'color'),'reply permission exposes just the template key, name and body');
select throws_ok(format('select public.app_process_entries(%L)',section),'22023',null,'no workflow selector exposes ' || section)
from unnest(array['messaging','tags']) as section;
select is(public.app_resource_process('projects',pg_temp.fixture('native'))->'entries',jsonb_build_array(pg_temp.entry('shared-tag-key','A assigned')),
  'read-only assigned staff see only the tags displayed on this order');
select is(public.app_get_order_conversation_page(pg_temp.fixture('native'))#>'{ticket,completed_order_locked}','true'::jsonb,'authorized native conversation returns its lock');
select is(public.app_get_ticket_detail_with_avatars(pg_temp.fixture('ticket'))#>'{ticket,completed_order_locked}','true'::jsonb,'linked ticket returns the same lock');
select pg_temp.act('a-owner');
select is(jsonb_array_length(public.app_resource_process('projects',pg_temp.fixture('native'))->'entries'),2,'editor sees assignable tags on an authorized row');

select pg_temp.act('b-owner');
select is((select tenant_id from public.app_current_tenant_membership()),null::uuid,'B owner has no active membership under the A selector');
select throws_ok($$select public.app_process_config('messaging')$$,'42501',null,'selecting A cannot expose its full messaging configuration');
select throws_ok($$select public.app_process_entries('saved-replies')$$,'42501',null,'selecting A cannot expose its saved replies');
select throws_ok($$select public.app_save_process_config('saved-replies',1,'{"entries":[]}'::jsonb)$$,'42501',null,'selecting A cannot erase its templates with a valid payload and version');
select pg_temp.act('b-owner',pg_temp.fixture('b-tenant'));
select is((select tenant_id from public.app_current_tenant_membership()),pg_temp.fixture('b-tenant'),'B owner is authenticated in the selected new tenant');
select is((public.app_process_config(section)->>'version')::integer,0,'unconfigured B starts at version zero for ' || section)
from unnest(array['orders','tickets','clients','messaging','saved-replies','tags']) as section;
select is(public.app_process_entries('saved-replies'),'[]'::jsonb,'B cannot read A templates');
select is(public.app_process_config('messaging')#>>'{settings,body}','','B cannot read A messaging body');
select is(public.app_process_config('orders')#>'{settings,reopen}','false'::jsonb,'B has the default revision policy');
select is(jsonb_array_length(public.app_process_entries('orders')),7,'B retains precisely the built-in stages');
select is((select count(*) from jsonb_array_elements(public.app_process_entries('orders')) e where e->>'key'=key),1::bigint,'system entry occurs once for ' || key)
from unnest(array['waiting_reply','pending_update']) as key;
select lives_ok($$select public.app_save_process_config('orders',0,jsonb_set(public.app_process_config('orders')->'settings','{entries}',
  public.app_process_entries('orders') || jsonb_build_array(pg_temp.entry('b-stage','B only'))) ||
  jsonb_build_object('ratings',true,'reopen',true,'destination',pg_temp.fixture('b-stage')))$$,'B owner configures its local revision and rating workflow');
select lives_ok($$select public.app_save_process_config('tickets',0,(public.app_process_config('tickets')->'settings') ||
  '{"ratings":true}')$$,'B owner enables ticket ratings');
select lives_ok($$select public.app_save_process_config('tags',0,jsonb_build_object('entries',jsonb_build_array(
  pg_temp.entry('shared-tag-key','B label'))))$$,'B defines the same tag key locally, with a different label');
select lives_ok($$select public.app_save_process_config('saved-replies',0,jsonb_build_object('entries',
  jsonb_build_array(pg_temp.entry('b-reply','B response','B template'))))$$,'B writes its own template');
select is(public.app_process_entries('saved-replies'),jsonb_build_array(pg_temp.entry('b-reply','B response','B template')-'color'),'B reads only its own template');
select lives_ok($$select public.app_assign_process_stage(pg_temp.fixture('b-order'),pg_temp.fixture('b-stage')::text)$$,'B owner can stage B work');
select throws_ok($$select public.app_assign_process_stage(pg_temp.fixture('b-order'),pg_temp.fixture('a-stage')::text)$$,'23514',null,
  'B owner cannot assign an A-only stage even to their own order');
select is((select process_stage from public.orders where id=pg_temp.fixture('b-order')),pg_temp.fixture('b-stage')::text,
  'rejected foreign stage preserves the local assignment');
select lives_ok($$select public.app_tag_resource('projects',pg_temp.fixture('b-order'),pg_temp.fixture('shared-tag-key')::text,true)$$,'B owner can tag B work');
select throws_ok($$select public.app_tag_resource('projects',pg_temp.fixture('b-order'),pg_temp.fixture('a-extra-tag')::text,true)$$,'23514',null,
  'B owner cannot attach an A-only tag even to their own order');
select is(public.app_resource_process('projects',pg_temp.fixture('b-order'))->'assigned',jsonb_build_array(pg_temp.fixture('shared-tag-key')),
  'rejected foreign tag preserves the local tag assignment');
select is(public.app_resource_process('projects',pg_temp.fixture('b-order'))->'entries',jsonb_build_array(pg_temp.entry('shared-tag-key','B label')),'B resource projects only B definitions');
select throws_ok($$select public.app_assign_process_stage(pg_temp.fixture('native'),pg_temp.fixture('b-stage')::text)$$,'42501',null,'valid B stage cannot be assigned to A work');
select throws_ok(format('select public.app_resource_process(%L,%L)',kind,pg_temp.fixture(label)),code,null,'B cannot read A ' || kind || ' tags or feedback')
from (values ('projects','native','42501'),('tickets','ticket','42501'),('clients','a-company','P0002')) resource(kind,label,code);
select throws_ok(format('select public.app_tag_resource(%L,%L,%L,false)',kind,pg_temp.fixture(label),pg_temp.fixture('shared-tag-key')::text),
  code,null,'B cannot remove a locally defined tag from A ' || kind)
from (values ('projects','native','42501'),('tickets','ticket','42501'),('clients','a-company','P0002')) resource(kind,label,code);

select lives_ok($$select public.app_change_order_status(pg_temp.fixture('b-order'),'complete')$$,'B owner completes its own order');
select pg_temp.act('b-client',pg_temp.fixture('b-tenant'));
select is((select tenant_id from public.app_current_tenant_membership()),pg_temp.fixture('b-tenant'),'B client is authenticated in the selected new tenant');
select is(public.app_client_process('orders',pg_temp.fixture('b-order'),3)->'score','3'::jsonb,'B client can rate its own completed order');
select is(public.app_client_process('tickets',pg_temp.fixture('b-ticket'),4)->'score','4'::jsonb,'B client can rate its own resolved ticket');
select is(public.app_request_order_revision(pg_temp.fixture('b-order'),'Revise B work',
  (public.app_client_process('orders',pg_temp.fixture('b-order'))->>'completed_at')::timestamptz,pg_temp.fixture('b-request'))->>'destination',
  pg_temp.fixture('b-stage')::text,'B client can revise its own order into the configured B stage');
select throws_ok($$select public.app_client_process('orders',pg_temp.fixture('native'),1)$$,'P0002',null,'B client cannot rate an A order');
select throws_ok($$select public.app_client_process('tickets',pg_temp.fixture('rated-ticket'),1)$$,'42501',null,'B client cannot rate an A ticket');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('native'),'Foreign request','2026-01-10 09:00:00.123456+00',gen_random_uuid())$$,
  'P0002',null,'B client cannot open A work for revision');

select pg_temp.act('a-owner');
select ok((select status='complete' and process_stage is null from public.orders where id=pg_temp.fixture('native')),'A order retained its original completion and stage');
select is(public.app_resource_process(kind,pg_temp.fixture(label))->'assigned',jsonb_build_array(pg_temp.fixture('shared-tag-key')),
  'A ' || kind || ' retained its tag after B removal attempt')
from (values ('projects','native'),('tickets','ticket'),('clients','a-company')) resource(kind,label);
select is(public.app_process_entries('saved-replies'),jsonb_build_array(pg_temp.entry('a-reply','A response','Private A template')-'color'),'A template survived B writes');
select is(public.app_resource_process('projects',pg_temp.fixture('native'))->'count','0'::jsonb,'foreign rating wrote no order score');
select is(public.app_resource_process('tickets',pg_temp.fixture('rated-ticket'))->'count','0'::jsonb,'foreign rating wrote no ticket score');

-- The authenticated client reads the exact completion presented before submission.
select pg_temp.act('a-client');
select throws_ok($$select public.app_process_config('orders')$$,'42501',null,'client cannot read the settings editor projection');
select throws_ok($$select public.app_process_entries('saved-replies')$$,'42501',null,'client cannot read staff templates');
select set_config('test.first_completion',public.app_client_process('orders',pg_temp.fixture('native'))->>'completed_at',true);
select is(current_setting('test.first_completion')::timestamptz,'2026-01-10 09:00:00.123456+00'::timestamptz,'client receives the exact persisted completion');
select is(public.app_client_process('orders',pg_temp.fixture('native'),4)->'score','4'::jsonb,'client rates completed work');
select is(public.app_client_process('tickets',pg_temp.fixture('rated-ticket'),5)->'score','5'::jsonb,'client rates own resolved ticket');
select throws_ok($$select public.app_client_process('tickets',pg_temp.fixture('ticket'),5)$$,'42501',null,'open ticket cannot be rated');
select throws_ok($$select public.app_send_order_message(pg_temp.fixture('native'),gen_random_uuid(),'Blocked native',false)$$,'42501',null,'completed native conversation rejects ordinary chat');
select throws_ok($$select public.app_reply_to_ticket(gen_random_uuid(),pg_temp.fixture('ticket'),'Blocked linked')$$,'42501',null,'completed linked ticket rejects ordinary chat');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('native'),'   ',current_setting('test.first_completion')::timestamptz,pg_temp.fixture('native-request'))$$,
  '22023',null,'revision requires a nonblank reason');

select set_config('test.receipt',public.app_request_order_revision(pg_temp.fixture('native'),'Please revise the layout',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('native-request'))::text,true);
select ok(current_setting('test.receipt')::jsonb->>'revision_id' is not null and
  current_setting('test.receipt')::jsonb->>'destination'=pg_temp.fixture('a-stage')::text,'client receives the persisted revision and destination');
select is(public.app_request_order_revision(pg_temp.fixture('native'),'Please revise the layout',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('native-request')),current_setting('test.receipt')::jsonb,'immediate retry returns identical receipt');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('native'),'Changed payload',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('native-request'))$$,'22023',null,'reused key with different reason conflicts');
select set_config('test.linked_receipt',public.app_request_order_revision(pg_temp.fixture('linked'),'Please revise linked work',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('linked-request'))::text,true);
select is(current_setting('test.linked_receipt')::jsonb->>'destination',pg_temp.fixture('a-stage')::text,'linked order revises independently');
select lives_ok($$select public.app_send_order_message(pg_temp.fixture('native'),gen_random_uuid(),'Native reopened',false)$$,'client can send a native message after revision');
select lives_ok($$select public.app_reply_to_ticket(gen_random_uuid(),pg_temp.fixture('ticket'),'Linked reopened')$$,'client can reply on the linked ticket after revision');
select throws_ok($$select public.app_client_process('orders',pg_temp.fixture('native'),1)$$,'42501',null,'reopened work is ineligible for a new score');

select pg_temp.act('a-viewer');
select is((select count(*) from public.orders where id in (pg_temp.fixture('native'),pg_temp.fixture('linked'))
  and status='working' and process_stage=pg_temp.fixture('a-stage')::text and completed_at is null),2::bigint,'authorized staff list reads both persisted custom assignments');
select ok((select status='working' and process_stage=pg_temp.fixture('a-stage')::text and completed_at is null
  from public.orders where id=pg_temp.fixture('native')),'staff detail reads the same reopened lifecycle and key');
select is(public.app_get_order_conversation_page(pg_temp.fixture('native'))#>'{ticket,completed_order_locked}','false'::jsonb,'native conversation unlocked after revision');
select is(public.app_get_ticket_detail_with_avatars(pg_temp.fixture('ticket'))#>'{ticket,completed_order_locked}','false'::jsonb,'linked ticket unlocked after revision');
select is(public.app_resource_process('projects',pg_temp.fixture('native'))->'average','4'::jsonb,'authorized staff see order rating');
select is(public.app_resource_process('tickets',pg_temp.fixture('rated-ticket'))->'average','5'::jsonb,'authorized staff see ticket rating');
select is(public.app_resource_process('clients',pg_temp.fixture('a-company'))-'assigned'-'entries','{"average":null,"count":0}'::jsonb,'client resource carries no ratings');

select pg_temp.act('a-admin');
select lives_ok($$select public.app_save_process_config('orders',1,jsonb_set(public.app_process_config('orders')->'settings',
  '{entries,7,name}','"Editorial review"'))$$,'rename without changing stage identity');
select pg_temp.act('a-viewer');
select is((select e->>'name' from public.orders o cross join jsonb_array_elements(public.app_process_entries('orders')) e
  where o.id=pg_temp.fixture('native') and o.process_stage=e->>'key'),'Editorial review','fresh staff read resolves the renamed destination');
select ok((select status=legacy.key and process_stage is null from public.orders where id=pg_temp.fixture(legacy.label)),
  'legacy ' || legacy.key || ' order keeps its built-in assignment')
from (values ('waiting','waiting_reply'),('needs-update','pending_update')) legacy(label,key);

select throws_ok($$select public.app_update_order(pg_temp.fixture('waiting'),'{"title":"Forbidden edit"}')$$,
  '42501',null,'taking the workspace lock does not grant order edit access');
select throws_ok($$select public.app_assign_order(pg_temp.fixture('waiting'),pg_temp.fixture('a-owner'))$$,
  '42501',null,'taking the workspace lock does not grant reassignment access');
select ok((select title='waiting' and assigned_to_profile_id=pg_temp.fixture('a-viewer') from public.orders where id=pg_temp.fixture('waiting')),
  'denied edits preserve the order and assignee');
select pg_temp.act('a-owner');
select is((public.app_update_order(pg_temp.fixture('waiting'),'{"title":"Updated title"}')).title,'Updated title','authorized edit succeeds');
select is((public.app_assign_order(pg_temp.fixture('waiting'),pg_temp.fixture('a-owner'))).assigned_to_profile_id,
  pg_temp.fixture('a-owner'),'authorized reassignment succeeds');
select lives_ok($$select public.app_change_order_status(pg_temp.fixture('linked'),'working')$$,'built-in Working can be chosen explicitly');
select is((select process_stage from public.orders where id=pg_temp.fixture('linked')),null::text,'built-in Working clears a custom assignment');
select lives_ok($$select public.app_change_order_status(pg_temp.fixture('linked'),'complete')$$,'staff complete the linked order again');
select lives_ok($$select public.app_update_ticket_status(pg_temp.fixture('ticket'),'closed')$$,'staff close its linked ticket');
select lives_ok($$select public.app_change_order_status(pg_temp.fixture('native'),'complete')$$,'ordinary project can be completed again');
select throws_ok($$select public.app_change_order_status(pg_temp.fixture('monthly'),'complete')$$,'WF431',null,'report-required work keeps its completion guard');
select is((select status from public.orders where id=pg_temp.fixture('monthly')),'working','refused report completion preserves state');

select pg_temp.act('a-client');
select set_config('test.linked_completion',public.app_client_process('orders',pg_temp.fixture('linked'))->>'completed_at',true);
select is(public.app_request_order_revision(pg_temp.fixture('linked'),'Please revise linked work',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('linked-request')),current_setting('test.linked_receipt')::jsonb,
  'closing the ticket preserves the authorized exact retry receipt');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('linked'),'Another linked revision',
  current_setting('test.linked_completion')::timestamptz,pg_temp.fixture('linked-new-request'))$$,'42501',null,'closed ticket refuses a new revision');
select is(public.app_client_process('orders',pg_temp.fixture('linked'))->>'completed_at',current_setting('test.linked_completion'),
  'the replay and the denied new request preserve the later linked completion');
select set_config('test.second_completion',public.app_client_process('orders',pg_temp.fixture('native'))->>'completed_at',true);
select isnt(current_setting('test.second_completion')::timestamptz,current_setting('test.first_completion')::timestamptz,'new completion has a different timestamp');
select is(public.app_request_order_revision(pg_temp.fixture('native'),'Please revise the layout',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('native-request')),current_setting('test.receipt')::jsonb,'delayed retry returns original receipt after re-completion');
select is((public.app_client_process('orders',pg_temp.fixture('native'))->>'completed_at')::timestamptz,
  current_setting('test.second_completion')::timestamptz,'delayed retry preserves the newer completion');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('native'),'Stale new request',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('second-request'))$$,'40001',null,'new request cannot act on an old completion');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('native'),'Please revise the layout',
  current_setting('test.second_completion')::timestamptz,pg_temp.fixture('native-request'))$$,'22023',null,'a request key is bound to its original completion');
select ok(public.app_request_order_revision(pg_temp.fixture('native'),'Second revision',
  current_setting('test.second_completion')::timestamptz,pg_temp.fixture('second-request'))->>'revision_id' <> current_setting('test.receipt')::jsonb->>'revision_id',
  'fresh request for the new completion records a different revision');

reset role;
select is((select count(*) from private.order_revisions where order_id=pg_temp.fixture('linked')),1::bigint,'closed-ticket replay added no revision');
select is((select count(*) from private.order_revisions where order_id=pg_temp.fixture('native')),2::bigint,'exactly one revision per completion');
select is((select count(*) from public.activity_events where entity_id=pg_temp.fixture('native') and action='order.status_changed'
  and metadata->>'revision_id'=current_setting('test.receipt')::jsonb->>'revision_id' and metadata->>'reason'='Please revise the layout'),1::bigint,
  'first request recorded one history event with the submitted reason');
select is((select count(*) from public.project_messages where order_id=pg_temp.fixture('native') and body='Native reopened'),1::bigint,'unlocked native message persisted in project storage');
select is((select count(*) from public.ticket_messages where ticket_id=pg_temp.fixture('ticket') and body='Linked reopened'),1::bigint,'unlocked linked reply persisted in ticket storage');
select is((select count(*) from public.project_messages where order_id=pg_temp.fixture('native') and body='Blocked native'),0::bigint,'locked native message was not stored');
select is((select count(*) from public.ticket_messages where ticket_id=pg_temp.fixture('ticket') and body='Blocked linked'),0::bigint,'locked linked message was not stored');

update public.profile_permission_overrides set allowed=false where profile_id=pg_temp.fixture('a-admin') and permission_key='settings.view';
update public.profile_permission_overrides set allowed=false where profile_id=pg_temp.fixture('a-viewer') and permission_key='tickets.reply';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
values(private.wolf_forge_tenant_id(),pg_temp.fixture('a-client'),'projects.view',false);
set local role authenticated;
select pg_temp.act('a-client');
select throws_ok($$select public.app_request_order_revision(pg_temp.fixture('linked'),'Please revise linked work',
  current_setting('test.first_completion')::timestamptz,pg_temp.fixture('linked-request'))$$,'42501',null,'revoked order access denies the exact receipt');
select pg_temp.act('a-admin');
select throws_ok($$select public.app_process_config('tickets')$$,'42501',null,'admin without Settings access cannot read the editor configuration');
select pg_temp.act('a-viewer');
select throws_ok($$select public.app_process_entries('saved-replies')$$,'42501',null,'ticket viewer without reply permission cannot read templates');
reset role;

-- Exercise token issuance itself. This RPC only claims a synthetic token.
set local role service_role;
select throws_ok($$select public.app_server_claim_client_welcome_email(pg_temp.fixture('a-admin'),pg_temp.fixture('a-client'),
  'f0f0f0f0-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64))$$,'42501',null,'owner-only rule rejects an otherwise qualified non-owner claim');
select is((select outcome from public.app_server_claim_client_welcome_email(pg_temp.fixture('a-owner'),pg_temp.fixture('a-client'),
  'f0f0f0f0-0000-4000-8000-000000000001',gen_random_uuid(),repeat('b',64))),'claimed','owner can claim a synthetic activation token');
reset role;

-- Separate-session acceptance on an authorized disposable database:
-- 1. Coordinate two READ COMMITTED sessions on the same active order. A holds
--    only the tenant lifecycle lock. Start app_update_order in B and confirm
--    it is waiting on A. Before releasing that lock, A assigns a custom stage
--    on the order. A must finish and commit while B is waiting, then B must
--    finish with both the stage and edit intact. Repeat with app_assign_order
--    in B, verifying the assignee and stage. Swap writer roles and repeat
--    with built-in status and each reporting writer on eligible orders.
--    Use bounded waits and inspect blockers during acquisition, before either
--    writer finishes. A 40P01, timeout or lost update fails the scenario.
-- 2. From a completed order, race a client revision with a staff status change
--    and repeat with the first locker reversed. Inspect the order, completion,
--    one receipt and one event for each successful revision. A revision that
--    loses its expected completion may return 40001; neither writer deadlocks.
-- 3. Submit the same observed completion/request from two client sessions.
--    Expect identical receipts and one mutation. With different request IDs
--    against one completion, expect one success and one stale refusal.
select * from finish();
rollback;

