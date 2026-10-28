begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('c6280000-0000-4000-8000-00000000000'||n)::uuid,
  'authenticated','authenticated','notification-'||n||'@example.invalid',now(),now()
from generate_series(1,9) n;
insert into public.tenants(id,slug,display_name,status) values
('c6280000-0000-4000-8000-000000000010','purchase-notice-a','Notification A','active'),
('c6280000-0000-4000-8000-000000000011','purchase-notice-b','Notification B','active');
insert into public.companies(id,tenant_id,name,status) values
('c6280000-0000-4000-8000-000000000020','c6280000-0000-4000-8000-000000000010','Synthetic Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id,archived_at)
select v.tenant_id::uuid,('c6280000-0000-4000-8000-00000000000'||v.n)::uuid,
  v.account_class,r.id,v.company_id::uuid,v.archived_at
from (values
(1,'c6280000-0000-4000-8000-000000000010','internal','owner',null,null::timestamptz),
(2,'c6280000-0000-4000-8000-000000000010','client','client','c6280000-0000-4000-8000-000000000020',null),
(3,'c6280000-0000-4000-8000-000000000010','client','client','c6280000-0000-4000-8000-000000000020',null),
(4,'c6280000-0000-4000-8000-000000000010','internal','admin',null,null),
(5,'c6280000-0000-4000-8000-000000000011','internal','owner',null,null),
(6,'c6280000-0000-4000-8000-000000000010','internal','admin',null,null),
(7,'c6280000-0000-4000-8000-000000000010','internal','admin',null,null),
(8,'c6280000-0000-4000-8000-000000000010','internal','admin',null,now()),
(9,'c6280000-0000-4000-8000-000000000010','internal','admin',null,null)
) v(n,tenant_id,account_class,role_name,company_id,archived_at) join public.roles r on r.name=v.role_name;
update public.profiles set archived_at=now() where id='c6280000-0000-4000-8000-000000000009';
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
select 'c6280000-0000-4000-8000-000000000010',v.profile_id::uuid,v.permission_key,false
from (values
('c6280000-0000-4000-8000-000000000006','projects.view'),
('c6280000-0000-4000-8000-000000000006','forms.submissions_view'),
('c6280000-0000-4000-8000-000000000007','client_private.read')
) v(profile_id,permission_key);
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
values('c6280000-0000-4000-8000-000000000030','c6280000-0000-4000-8000-000000000010',
  'Synthetic Service',10,'USD',true,true,false);
update public.company_wallets set balance_cents=10000 where company_id='c6280000-0000-4000-8000-000000000020';

create function pg_temp.act(n integer, tenant text default 'c6280000-0000-4000-8000-000000000010')
returns void language sql as $$
select set_config('request.jwt.claim.sub','c6280000-0000-4000-8000-00000000000'||n,true);
select set_config('request.jwt.claims','',true);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.try(command text) returns text language plpgsql as $$
begin execute command; return 'OK'; exception when others then return sqlstate; end;
$$;
create temp table notice_ids(label text primary key,id uuid not null);
grant all on notice_ids to authenticated;
create function pg_temp.value_payload() returns jsonb language sql as $$
select jsonb_build_array(jsonb_build_object('field_key','c6280000-0000-4000-8000-000000000050','value','NEVER_IN_NOTIFICATION_ANSWERS'));
$$;
create function pg_temp.submit(request_id uuid, assignment_label text default 'assignment') returns uuid language sql as $$
select (public.app_submit_form(request_id,(select id from notice_ids where label='version'),
  jsonb_build_object('assignment_id',(select id from notice_ids where label=assignment_label)),pg_temp.value_payload())).id;
$$;
create function pg_temp.recipients(key text) returns text language sql as $$
select coalesce(string_agg(right(recipient_profile_id::text,1),',' order by recipient_profile_id),'')
from public.notifications where event_key=key;
$$;
create function pg_temp.notice_count() returns bigint language sql as $$
select count(*) from public.notifications where tenant_id='c6280000-0000-4000-8000-000000000010'
  and (event_key like 'order-purchased:%' or event_key like 'intake-submitted:%');
$$;

select ok(not has_table_privilege('authenticated','public.activity_events','INSERT'),'browser cannot forge accepted events');
select ok(not has_function_privilege('authenticated','private.notify_accepted_purchase_intake()','EXECUTE'),'trigger is not a browser RPC');
select ok(not has_function_privilege('service_role','private.purchase_intake_notification_visible(uuid,text,text,uuid)','EXECUTE'),'recipient predicate is private');

set local role authenticated;
select pg_temp.act(1);
insert into notice_ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object(
  'form_type','intake','canonical_key','purchase-intake-notice','definition',jsonb_build_object(
    'name','Synthetic Intake','title','Synthetic Intake','visibility','assigned','type_config','{}'::jsonb,
    'fields',jsonb_build_array(jsonb_build_object('stable_field_key','c6280000-0000-4000-8000-000000000050',
      'sort_order',0,'field_type','text','label','Brief','required',true,'settings','{}'::jsonb,'options','[]'::jsonb,'service_links','[]'::jsonb)),
    'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','c6280000-0000-4000-8000-000000000030',
      'role','intake_assignment','sort_order',0,'configuration','{}'::jsonb)))))).id;
insert into notice_ids select 'version',(public.app_publish_form(gen_random_uuid(),id)).id from notice_ids where label='form';
select pg_temp.act(2);
insert into notice_ids select 'order',order_id from public.app_purchase_service_with_balance(
  'c6280000-0000-4000-8000-000000000040','c6280000-0000-4000-8000-000000000030');
reset role;
insert into notice_ids select 'assignment',id from public.form_assignments where order_id=(select id from notice_ids where label='order');
select is(pg_temp.recipients('order-purchased:'||(select id from notice_ids where label='order')::text),'1,4',
  'one paid purchase notifies owner and eligible admin, excluding clients, foreign/archived/denied/unscoped staff');
select ok((select bool_and(href='/orders/'||entity_id::text and category='project' and audience='internal'
  and tenant_id='c6280000-0000-4000-8000-000000000010' and company_id='c6280000-0000-4000-8000-000000000020'
  and title='Service purchased') from public.notifications where event_key='order-purchased:'||(select id from notice_ids where label='order')::text),
  'purchase rows contain the exact authorized Order link and subject Tenant');
select is((select count(*) from public.notifications where event_key='project-created:'||(select id from notice_ids where label='order')::text),0::bigint,
  'generic creation remains suppressed');
select is((select count(*) from public.notifications where event_key like 'client-form-assigned:%'
  and recipient_profile_id='c6280000-0000-4000-8000-000000000002'),1::bigint,'existing client assignment notification survives');

set local role authenticated;
select pg_temp.act(2);
select ok((select replayed from public.app_purchase_service_with_balance('c6280000-0000-4000-8000-000000000040',
  'c6280000-0000-4000-8000-000000000030')),'same purchase request returns accepted receipt');
select public.app_save_intake_draft((select id from notice_ids where label='assignment'),pg_temp.value_payload());
reset role;
select is(pg_temp.notice_count(),2::bigint,'purchase replay and saved intake draft add no notices');
select is((select balance_cents from public.company_wallets where company_id='c6280000-0000-4000-8000-000000000020'),9000::bigint,'single debit after replay');
select is((select status from public.orders where id=(select id from notice_ids where label='order')),'pending','purchase does not implicitly Start order');

set local role authenticated;
select pg_temp.act(3);
select isnt(pg_temp.try($q$select pg_temp.submit('c6280000-0000-4000-8000-000000000041')$q$),'OK','same-company non-purchaser cannot submit');
select pg_temp.act(2);
select isnt(pg_temp.try($q$select public.app_submit_form('c6280000-0000-4000-8000-000000000041',
  (select id from notice_ids where label='version'),jsonb_build_object('assignment_id',(select id from notice_ids where label='assignment')),'[]'::jsonb)$q$),'OK',
  'invalid required answers refuse submission');
reset role;
select is(pg_temp.notice_count(),2::bigint,'denied and invalid submissions add no notices');

savepoint before_submission;
set local role authenticated;
select pg_temp.act(2);
select pg_temp.submit('c6280000-0000-4000-8000-000000000041');
reset role;
select is(pg_temp.notice_count(),5::bigint,'saved completion creates three eligible submission notices in the transaction');
rollback to before_submission;
select is(pg_temp.notice_count(),2::bigint,'transaction rollback removes submission notices');
select is((select status from public.form_assignments where id=(select id from notice_ids where label='assignment')),'assigned','rollback restores assignment');
select is((select count(*) from public.form_submission_values where submission_id in(select id from public.form_submissions where form_id=(select id from notice_ids where label='form'))),0::bigint,'rollback leaves no answers');

set local role authenticated;
select pg_temp.act(2);
insert into notice_ids select 'submission',pg_temp.submit('c6280000-0000-4000-8000-000000000041');
select is(pg_temp.submit('c6280000-0000-4000-8000-000000000041'),(select id from notice_ids where label='submission'),'same submission ID replays');
reset role;
select is(pg_temp.recipients('intake-submitted:'||(select id from notice_ids where label='submission')::text),'1,4,7',
  'intake history follows Forms view/submissions capability, independently of Order assignment');
select is(pg_temp.notice_count(),5::bigint,'submission replay does not duplicate fanout');
select ok((select bool_and(href='/forms/submissions/'||entity_id::text and title='Service intake submitted'
  and body='A client submitted the required service intake form.' and audience='internal')
  from public.notifications where event_key='intake-submitted:'||(select id from notice_ids where label='submission')::text),
  'submission payload uses only fixed copy and exact saved submission ID');
select ok(not exists(select 1 from public.notifications where tenant_id='c6280000-0000-4000-8000-000000000010'
  and concat_ws(' ',title,body,href,event_key) like '%NEVER_IN_NOTIFICATION_ANSWERS%'),'answers never reach notification payloads');
select is((select count(*) from public.form_submission_values where submission_id=(select id from notice_ids where label='submission')),1::bigint,'one immutable answer saved');

-- Replayed canonical events retain stable subject identity, not activity-row identity.
insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
select actor_profile_id,entity_type,entity_id,action,summary,metadata from public.activity_events
where entity_id in(select id from notice_ids where label in('order','submission')) and action in('order.purchased','form.submitted');
select is(pg_temp.notice_count(),5::bigint,'duplicate canonical activity events do not duplicate notifications');

set local role authenticated;
select pg_temp.act(2);
insert into notice_ids select 'order-2',order_id from public.app_purchase_service_with_balance(
  'c6280000-0000-4000-8000-000000000042','c6280000-0000-4000-8000-000000000030');
reset role;
insert into notice_ids select 'assignment-2',id from public.form_assignments where order_id=(select id from notice_ids where label='order-2');
set local role authenticated;
select pg_temp.act(2);
insert into notice_ids select 'submission-2',pg_temp.submit('c6280000-0000-4000-8000-000000000043','assignment-2');
reset role;
select is(pg_temp.notice_count(),10::bigint,'a distinct purchase and saved submission each have their own events');

savepoint before_purchase;
set local role authenticated;
select pg_temp.act(2);
select * from public.app_purchase_service_with_balance('c6280000-0000-4000-8000-000000000044','c6280000-0000-4000-8000-000000000030');
reset role;
select is(pg_temp.notice_count(),12::bigint,'accepted transaction has a purchase event');
rollback to before_purchase;
select is(pg_temp.notice_count(),10::bigint,'purchase rollback removes its notice');
select is((select count(*) from public.company_wallet_transactions where company_id='c6280000-0000-4000-8000-000000000020'),2::bigint,'rollback preserves two accepted debits');

-- Current authority controls list, individual read and mark-all, with retained rows.
insert into notice_ids select 'admin-purchase-notice',id from public.notifications where recipient_profile_id='c6280000-0000-4000-8000-000000000004'
  and event_key='order-purchased:'||(select id from notice_ids where label='order')::text;
insert into notice_ids select 'admin-submission-notice',id from public.notifications where recipient_profile_id='c6280000-0000-4000-8000-000000000004'
  and event_key='intake-submitted:'||(select id from notice_ids where label='submission')::text;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('c6280000-0000-4000-8000-000000000010','c6280000-0000-4000-8000-000000000004','client_private.read',false),
('c6280000-0000-4000-8000-000000000010','c6280000-0000-4000-8000-000000000004','forms.submissions_view',false);
set local role authenticated;
select pg_temp.act(4);
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'order-purchased:%' or event_key like 'intake-submitted:%'),0::bigint,
  'revoked Order scope and submission capability hide existing alerts');
select ok(not public.app_mark_notification_read((select id from notice_ids where label='admin-purchase-notice')),'cannot mark inaccessible Order notice');
select ok(not public.app_mark_notification_read((select id from notice_ids where label='admin-submission-notice')),'cannot mark inaccessible submission notice');
select public.app_mark_all_notifications_read();
select ok(not private.can_access_operational_order((select id from notice_ids where label='order')),'opening Order is denied after scope loss');
select ok(not private.can_read_form_submission((select id from notice_ids where label='submission')),'opening submission is denied after capability loss');
reset role;
select ok((select bool_and(read_at is null) from public.notifications where id in(select id from notice_ids where label like 'admin-%')),'mark-all leaves revoked notices unread');

update public.profile_permission_overrides set allowed=true where tenant_id='c6280000-0000-4000-8000-000000000010'
  and profile_id='c6280000-0000-4000-8000-000000000004' and permission_key in('client_private.read','forms.submissions_view');
set local role authenticated;
select pg_temp.act(4);
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'order-purchased:%' or event_key like 'intake-submitted:%'),4::bigint,'restored authority reveals retained notices');
select pg_temp.act(5,'c6280000-0000-4000-8000-000000000011');
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'order-purchased:%' or event_key like 'intake-submitted:%'),0::bigint,'foreign Tenant feed has none');
select pg_temp.act(2);
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'order-purchased:%' or event_key like 'intake-submitted:%'),0::bigint,'client feed excludes internal purchase/submission alerts');
reset role;

-- Tenant status is checked independently of module disablement.
select ok(private.purchase_intake_notification_visible('c6280000-0000-4000-8000-000000000001',
  'order-purchased:'||(select id from notice_ids where label='order')::text,'order',(select id from notice_ids where label='order')),'eligible owner has current Order access');
update public.tenants set status='suspended' where id='c6280000-0000-4000-8000-000000000010';
select ok(not private.purchase_intake_notification_visible('c6280000-0000-4000-8000-000000000001',
  'order-purchased:'||(select id from notice_ids where label='order')::text,'order',(select id from notice_ids where label='order')),'suspended Tenant recipient fails closed');
update public.tenants set status='active' where id='c6280000-0000-4000-8000-000000000010';

-- Forms OFF hides new submission alerts while preserving historical submission access.
select set_config('request.jwt.claim.sub','',true);
select private.grant_platform_admin('c6280000-0000-4000-8000-000000000001','Synthetic notification module tests');
select pg_temp.act(1);
select private.publish_tenant_modules('c6280000-0000-4000-8000-000000000010',0,
  (select array_agg(module_key order by module_key) from private.white_label_modules where module_key<>'forms'),'Synthetic Forms OFF');
select ok(not private.tenant_module_allowed('c6280000-0000-4000-8000-000000000010','forms'),'Forms OFF fixture is disabled');
set local role authenticated;
select pg_temp.act(1);
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'intake-submitted:%'),0::bigint,'Forms OFF hides intake notices');
select ok(private.can_read_form_submission((select id from notice_ids where label='submission')),'retained Forms history access is unchanged');
select pg_temp.act(2);
select isnt(pg_temp.try($q$select pg_temp.submit('c6280000-0000-4000-8000-000000000045')$q$),'OK','new submission request cannot complete when Forms are disabled');
insert into notice_ids select 'forms-off-order',order_id from public.app_purchase_service_with_balance(
  'c6280000-0000-4000-8000-000000000046','c6280000-0000-4000-8000-000000000030');
reset role;
select is(pg_temp.recipients('order-purchased:'||(select id from notice_ids where label='forms-off-order')::text),'1,4','Forms OFF does not suppress a valid paid purchase notice');
select is((select count(*) from public.form_assignments where order_id=(select id from notice_ids where label='forms-off-order')),0::bigint,'Forms OFF still skips intake assignment');

select set_config('request.jwt.claim.sub','',true);
update public.company_wallets set balance_cents=0 where company_id='c6280000-0000-4000-8000-000000000020';
set local role authenticated;
select pg_temp.act(2);
select isnt(pg_temp.try($q$select * from public.app_purchase_service_with_balance('c6280000-0000-4000-8000-000000000047',
  'c6280000-0000-4000-8000-000000000030')$q$),'OK','insufficient funds refuse');
select isnt(pg_temp.try($q$select * from public.app_purchase_service_with_balance(null,'c6280000-0000-4000-8000-000000000030')$q$),'OK','invalid purchase request refuses');
reset role;
select is(pg_temp.notice_count(),12::bigint,'failed purchases create no additional notices');
select is((select count(*) from public.orders where tenant_id='c6280000-0000-4000-8000-000000000010'),3::bigint,'only three accepted Orders remain');

-- Disable Projects through the existing publication guard after terminal completion.
insert into notice_ids select 'owner-purchase-notice',id from public.notifications
  where recipient_profile_id='c6280000-0000-4000-8000-000000000001'
    and event_key='order-purchased:'||(select id from notice_ids where label='order')::text;
select set_config('request.jwt.claim.sub','',true);
update public.orders set status='complete',completed_at=now() where tenant_id='c6280000-0000-4000-8000-000000000010';
select pg_temp.act(1);
select private.publish_tenant_modules('c6280000-0000-4000-8000-000000000010',1,
  (select array_agg(module_key order by module_key) from private.white_label_modules where module_key not in('forms','projects')),'Synthetic Projects OFF');
select ok(not private.tenant_module_allowed('c6280000-0000-4000-8000-000000000010','projects'),'Projects OFF fixture is disabled');
set local role authenticated;
select pg_temp.act(1);
select is((select count(*) from public.app_list_my_notifications(100) where event_key like 'order-purchased:%'),0::bigint,'Projects OFF hides paid purchase alerts');
select ok(not public.app_mark_notification_read((select id from notice_ids where label='owner-purchase-notice')),'Projects OFF blocks marking a paid purchase alert');
select public.app_mark_all_notifications_read();
select pg_temp.act(2);
select isnt(pg_temp.try($q$select * from public.app_purchase_service_with_balance('c6280000-0000-4000-8000-000000000048',
  'c6280000-0000-4000-8000-000000000030')$q$),'OK','Projects OFF refuses a fresh purchase');
reset role;
select ok((select read_at is null from public.notifications where id=(select id from notice_ids where label='owner-purchase-notice')),'module-off mark-all preserves inaccessible unread row');
select is(pg_temp.notice_count(),12::bigint,'module-off refusal adds no notice');

select * from finish();
rollback;
