-- Execution pending: requires the complete migrated Supabase schema and pgTAP.
-- Every application operation uses the real RPCs, identity helpers and RLS.
-- Synthetic fixture rows, quota buckets and permission changes roll back together.
begin;
select no_plan();

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b6280000-0000-4000-8000-00000000000'||n)::uuid,'authenticated','authenticated',
  'pdf-receipt-'||n||'@example.invalid',now(),now() from generate_series(1,5)n;
insert into public.tenants(id,slug,display_name,status) values
('b6280000-0000-4000-8000-000000000010','pdf-receipt-fixture','PDF Receipt Fixture','active'),
('b6280000-0000-4000-8000-000000000011','pdf-receipt-foreign','Foreign PDF Fixture','active');
insert into public.companies(id,tenant_id,name,status) values
('b6280000-0000-4000-8000-000000000020','b6280000-0000-4000-8000-000000000010','PDF Buyer','client'),
('b6280000-0000-4000-8000-000000000021','b6280000-0000-4000-8000-000000000010','Unrelated PDF Buyer','client'),
('b6280000-0000-4000-8000-000000000022','b6280000-0000-4000-8000-000000000011','Foreign PDF Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant_id::uuid,v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid from (values
('b6280000-0000-4000-8000-000000000010','b6280000-0000-4000-8000-000000000001','internal','owner',null),
('b6280000-0000-4000-8000-000000000010','b6280000-0000-4000-8000-000000000002','client','client','b6280000-0000-4000-8000-000000000020'),
('b6280000-0000-4000-8000-000000000010','b6280000-0000-4000-8000-000000000003','client','client','b6280000-0000-4000-8000-000000000020'),
('b6280000-0000-4000-8000-000000000010','b6280000-0000-4000-8000-000000000004','client','client','b6280000-0000-4000-8000-000000000021'),
('b6280000-0000-4000-8000-000000000011','b6280000-0000-4000-8000-000000000005','client','client','b6280000-0000-4000-8000-000000000022')
)v(tenant_id,profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring) values
('b6280000-0000-4000-8000-000000000030','b6280000-0000-4000-8000-000000000010','PDF Fixture Service',10,'USD',true,true,false);
update public.company_wallets set balance_cents=10000 where company_id='b6280000-0000-4000-8000-000000000020';
insert into private.client_order_start_rollout(tenant_id,service_id,enabled) values
('b6280000-0000-4000-8000-000000000010','b6280000-0000-4000-8000-000000000030',true);

create temp table pdf_ids(label text primary key,id uuid not null);
create temp table pdf_data(label text primary key,value jsonb not null);
grant all on pdf_ids,pdf_data to authenticated;
grant select on pdf_ids to anon,service_role;

create function pg_temp.pdf_act(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub','b6280000-0000-4000-8000-00000000000'||n,true);
  select set_config('request.jwt.claims',jsonb_build_object('sub','b6280000-0000-4000-8000-00000000000'||n,'role','authenticated')::text,true);
  select set_config('request.headers',jsonb_build_object('x-wf-tenant',case when n=5
    then 'b6280000-0000-4000-8000-000000000011' else 'b6280000-0000-4000-8000-000000000010' end)::text,true);
$$;
create function pg_temp.pdf_definition(revised boolean default false) returns jsonb language sql as $$
select jsonb_build_object('name','PDF Receipt Intake','title',case when revised then 'Revised PDF Intake' else 'Original PDF Intake' end,
  'information_html',case when revised then '<p>Revised instructions.</p>' else '<p>Original synthetic instructions.</p>' end,
  'visibility','assigned','type_config','{}'::jsonb,'fields',jsonb_build_array(
    jsonb_build_object('stable_field_key','b6280000-0000-4000-8000-000000000050','sort_order',0,'field_type','text','label','Business','required',true),
    jsonb_build_object('stable_field_key','b6280000-0000-4000-8000-000000000051','sort_order',1,'field_type','richtext','label','Terms',
      'required',false,'settings',jsonb_build_object('display_only',true),'help_html','<p>Read these synthetic service terms.</p>'),
    jsonb_build_object('stable_field_key','b6280000-0000-4000-8000-000000000052','sort_order',2,'field_type','signature','label','Signature','required',true,
      'settings',jsonb_build_object('signature_mode','drawn'),'help_html',case when revised then '<p>Replacement agreement for future purchases.</p>'
        else '<p>Original synthetic agreement. Fee: USD 10. Consent applies to this version.</p>' end),
    jsonb_build_object('stable_field_key','b6280000-0000-4000-8000-000000000053','sort_order',3,'field_type','text','label','Optional note','required',false),
    jsonb_build_object('stable_field_key','b6280000-0000-4000-8000-000000000054','sort_order',4,'field_type','secret','label','PDF_NEVER_EXPORT_SECRET',
      'required',false,'settings',jsonb_build_object('collection_mode','disabled'))
  ),'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object('service_id','b6280000-0000-4000-8000-000000000030',
    'role','intake_assignment','sort_order',0,'configuration','{}'::jsonb)));
$$;
create function pg_temp.pdf_values(signature jsonb) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('field_key','b6280000-0000-4000-8000-000000000050','value','Original synthetic business'),
    jsonb_build_object('field_key','b6280000-0000-4000-8000-000000000052','value',signature));
$$;
create function pg_temp.pdf_submit(signature jsonb) returns uuid language sql as $$
  select (public.app_submit_form(gen_random_uuid(),(select id from pdf_ids where label='version'),
    jsonb_build_object('assignment_id',(select id from pdf_ids where label='assignment')),pg_temp.pdf_values(signature),'[]'::jsonb)).id;
$$;

set local role authenticated;
select pg_temp.pdf_act(1);
insert into pdf_ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake',
  'canonical_key','pdf-receipt-fixture','definition',pg_temp.pdf_definition()))).id;
insert into pdf_ids select 'version',(public.app_publish_form(gen_random_uuid(),id)).id from pdf_ids where label='form';
select pg_temp.pdf_act(2);
insert into pdf_ids select 'order',order_id from public.app_purchase_service_with_balance(gen_random_uuid(),'b6280000-0000-4000-8000-000000000030');
-- Client read models may redact order_id; resolve the generated fixture ID as
-- the harness owner, then exercise client access through the assigned-schema RPC.
reset role;
insert into pdf_ids select 'assignment',a.id from public.form_assignments a
  where a.order_id=(select id from pdf_ids where label='order') and a.form_id=(select id from pdf_ids where label='form');
select is((select count(*)::integer from pdf_ids where label='assignment'),1,'paid purchase assigned exactly one service intake');
set local role authenticated;
select pg_temp.pdf_act(2);
select is((public.app_get_assigned_form_schema(id)->'schema'->>'form_version_id')::uuid,
  (select id from pdf_ids where label='version'),'buyer can read the assigned purchased form') from pdf_ids where label='assignment';

select throws_ok($$select pg_temp.pdf_submit('{"name":"Synthetic signer","consent":true}')$$,'23514',null,'drawn signature refuses missing ink');
select throws_ok($$select pg_temp.pdf_submit('{"name":"Synthetic signer","consent":true,"drawing":[[[10,20],[1001,20]]]}')$$,
  '23514',null,'drawn signature refuses out-of-range ink');
select throws_ok($$select pg_temp.pdf_submit('{"name":"Synthetic signer","consent":true,"drawing":[[[10,20],[10,20]]]}')$$,
  '23514',null,'drawn signature refuses a stationary tap');
select throws_ok($$select pg_temp.pdf_submit('{"name":"Synthetic signer","consent":false,"drawing":[[[10,20],[90,60]]]}')$$,
  '23514',null,'drawn signature requires explicit consent');
select throws_ok($$select pg_temp.pdf_submit('{"name":"Synthetic signer","consent":true,"drawing":[[[10,20],[90,60]]],"signed_at":"2000-01-01T00:00:00Z"}')$$,
  '23514',null,'client cannot supply signature attestation time');
reset role;
select is((select count(*)::integer from public.form_submissions where form_assignment_id=(select id from pdf_ids where label='assignment')),0,
  'refused signatures leave no submitted receipts');
select is((select status from public.form_assignments where id=(select id from pdf_ids where label='assignment')),'assigned',
  'refused signatures do not complete the assignment');

set local role authenticated;
select pg_temp.pdf_act(1);
select public.app_update_form_draft(gen_random_uuid(),id,pg_temp.pdf_definition(true)) from pdf_ids where label='form';
insert into pdf_ids select 'republished-version',(public.app_publish_form(gen_random_uuid(),id)).id from pdf_ids where label='form';
select isnt((select id from pdf_ids where label='version'),(select id from pdf_ids where label='republished-version'),
  'republication produced a distinct version');
select pg_temp.pdf_act(2);
insert into pdf_ids select 'submission',pg_temp.pdf_submit('{"name":"Synthetic signer","consent":true,"drawing":[[[10,20],[90,60]]]}');
insert into pdf_data select 'original-pdf',public.app_get_form_submission_pdf(id) from pdf_ids where label='submission';
select is((select value->'form'->>'version_id' from pdf_data where label='original-pdf'),
  (select id::text from pdf_ids where label='version'),'PDF pins the purchased version after republication');
select is((select value->'form'->>'title' from pdf_data where label='original-pdf'),'Original PDF Intake','PDF retains the original title');
select is((select value->'form'->>'information_html' from pdf_data where label='original-pdf'),'<p>Original synthetic instructions.</p>',
  'PDF retains the original instructions');
select is((select field->>'help_html' from pdf_data d cross join lateral jsonb_array_elements(d.value->'form'->'fields') field
  where d.label='original-pdf' and field->>'type'='signature'),
  '<p>Original synthetic agreement. Fee: USD 10. Consent applies to this version.</p>','PDF preserves the complete original signature agreement');
select ok((select value->'correction'='null'::jsonb from pdf_data where label='original-pdf'),'original PDF has no invented correction');
select ok((select exists(select 1 from jsonb_array_elements(value->'form'->'fields') field where field->>'label'='Optional note')
  from pdf_data where label='original-pdf'),'PDF includes optional unanswered fields as version reference');
select ok((select position('PDF_NEVER_EXPORT_SECRET' in value::text)=0 from pdf_data where label='original-pdf'),
  'PDF excludes credential-like field metadata');
select is((select (answer->'value'->>'signed_at')::timestamptz from pdf_data d
  cross join lateral jsonb_array_elements(d.value->'original'->'values') answer where d.label='original-pdf' and answer->>'field_type'='signature'),
  transaction_timestamp(),'signature time is generated by the database');
select is((select answer->'value'->>'profile_id' from pdf_data d cross join lateral jsonb_array_elements(d.value->'original'->'values') answer
  where d.label='original-pdf' and answer->>'field_type'='signature'),'b6280000-0000-4000-8000-000000000002','PDF identifies the actual signer');
select is((select answer->'value'->>'method' from pdf_data d cross join lateral jsonb_array_elements(d.value->'original'->'values') answer
  where d.label='original-pdf' and answer->>'field_type'='signature'),'drawn','PDF includes the attested drawn signing method');
select is((select answer->'value'->'drawing' from pdf_data d cross join lateral jsonb_array_elements(d.value->'original'->'values') answer
  where d.label='original-pdf' and answer->>'field_type'='signature'),'[[[10,20],[90,60]]]'::jsonb,'PDF retains numeric ink');

reset role;
insert into pdf_data select 'correction-values',jsonb_agg(jsonb_build_object('field_key',stable_field_key,'value',value) order by sort_order_snapshot)
  from public.form_submission_values where submission_id=(select id from pdf_ids where label='submission');
set local role authenticated;
select pg_temp.pdf_act(1);
select throws_ok($$select public.app_correct_form_submission(gen_random_uuid(),(select id from pdf_ids where label='submission'),
  jsonb_set((select value from pdf_data where label='correction-values'),'{1,value,name}','"Replacement signer"'))$$,
  '23514',null,'staff correction cannot replace original signature evidence');
insert into pdf_ids select 'correction',(public.app_correct_form_submission(gen_random_uuid(),(select id from pdf_ids where label='submission'),
  jsonb_set((select value from pdf_data where label='correction-values'),'{0,value}','"Corrected synthetic business"'))).id;
select pg_temp.pdf_act(2);
insert into pdf_data select 'corrected-pdf',public.app_get_form_submission_pdf(id) from pdf_ids where label='correction';
select is((select value->'original' from pdf_data where label='corrected-pdf'),(select value->'original' from pdf_data where label='original-pdf'),
  'corrected PDF retains the complete original receipt and attestation');
select is((select value->'form' from pdf_data where label='corrected-pdf'),(select value->'form' from pdf_data where label='original-pdf'),
  'correction cannot substitute republished terms');
select is((select value->'correction'->>'id' from pdf_data where label='corrected-pdf'),(select id::text from pdf_ids where label='correction'),
  'corrected PDF identifies its separate revision');
select is((select answer->>'value' from pdf_data d cross join lateral jsonb_array_elements(d.value->'correction'->'values') answer
  where d.label='corrected-pdf' and answer->>'field_type'='text'),'Corrected synthetic business','corrected answer is exported separately');

select pg_temp.pdf_act(3);
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'42501',null,
  'another client in the same company cannot export a private receipt');
select pg_temp.pdf_act(4);
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'42501',null,
  'unrelated company client cannot export a private receipt');
select pg_temp.pdf_act(5);
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'42501',null,
  'foreign tenant client cannot export a known receipt');
reset role;
select is((select count(*)::integer from private.rate_limit_counters where scope like 'forms.pdf.actor.%'
  and subject in ('b6280000-0000-4000-8000-000000000003','b6280000-0000-4000-8000-000000000004','b6280000-0000-4000-8000-000000000005')),0,
  'authorization refusals do not consume PDF quota');
select ok(has_function_privilege('authenticated','public.app_get_form_submission_pdf(uuid)','EXECUTE'),'authenticated receipt RPC is available');
select ok(not has_function_privilege('anon','public.app_get_form_submission_pdf(uuid)','EXECUTE'),'anonymous role has no receipt RPC grant');
select ok(not has_function_privilege('service_role','public.app_get_form_submission_pdf(uuid)','EXECUTE'),'service role has no export bypass grant');
select ok(not has_table_privilege('authenticated','private.rate_limit_counters','UPDATE'),'client cannot reset PDF quota counters');
select ok(not has_function_privilege('authenticated','private.consume_rate_limit(text,text,interval,integer)','EXECUTE'),
  'client cannot call the quota primitive directly');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'42501',null,
  'anonymous execution is refused');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'42501',null,
  'trusted server role cannot bypass private export authorization');
reset role;

-- Saturate only this fixture actor's current/next buckets; seeding both sides
-- avoids a clock-boundary race while the real RPC enforces each quota.
insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
select 'forms.pdf.actor.minute','b6280000-0000-4000-8000-000000000002',bucket,bucket+interval '2 minutes',9
from (select to_timestamp(floor(extract(epoch from clock_timestamp())/60)*60)+n*interval '1 minute' bucket from generate_series(0,1)n) buckets
on conflict(scope,subject,window_start) do update set hits=excluded.hits,expires_at=excluded.expires_at;
set local role authenticated;
select pg_temp.pdf_act(2);
select lives_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,
  'tenth PDF download in the minute is allowed');
reset role;
insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
select 'forms.pdf.actor.minute','b6280000-0000-4000-8000-000000000002',bucket,bucket+interval '2 minutes',10
from (select to_timestamp(floor(extract(epoch from clock_timestamp())/60)*60)+n*interval '1 minute' bucket from generate_series(0,1)n) buckets
on conflict(scope,subject,window_start) do update set hits=excluded.hits,expires_at=excluded.expires_at;
set local role authenticated;
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'WF429',null,
  'real PDF RPC enforces the ten-download minute quota');
reset role;
select ok(not exists(select 1 from private.rate_limit_counters where scope='forms.pdf.actor.minute'
  and subject='b6280000-0000-4000-8000-000000000002' and hits>10),'rejected export rolls back the excess counter increment');
delete from private.rate_limit_counters where scope='forms.pdf.actor.minute' and subject='b6280000-0000-4000-8000-000000000002';
insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
select 'forms.pdf.actor.hour','b6280000-0000-4000-8000-000000000002',bucket,bucket+interval '2 hours',49
from (select to_timestamp(floor(extract(epoch from clock_timestamp())/3600)*3600)+n*interval '1 hour' bucket from generate_series(0,1)n) buckets
on conflict(scope,subject,window_start) do update set hits=excluded.hits,expires_at=excluded.expires_at;
set local role authenticated;
select pg_temp.pdf_act(2);
select lives_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,
  'fiftieth PDF download in the hour is allowed');
reset role;
insert into private.rate_limit_counters(scope,subject,window_start,expires_at,hits)
select 'forms.pdf.actor.hour','b6280000-0000-4000-8000-000000000002',bucket,bucket+interval '2 hours',50
from (select to_timestamp(floor(extract(epoch from clock_timestamp())/3600)*3600)+n*interval '1 hour' bucket from generate_series(0,1)n) buckets
on conflict(scope,subject,window_start) do update set hits=excluded.hits,expires_at=excluded.expires_at;
set local role authenticated;
select throws_ok($$select public.app_get_form_submission_pdf((select id from pdf_ids where label='submission'))$$,'WF429',null,
  'real PDF RPC enforces the fifty-download hour quota');
reset role;
select is((select sum(hits)::integer from private.rate_limit_counters where scope='forms.pdf.actor.minute'
  and subject='b6280000-0000-4000-8000-000000000002'),1,'hour rejection also rolls back its preceding minute charge');
select ok(not exists(select 1 from private.rate_limit_counters where scope='forms.pdf.actor.hour'
  and subject='b6280000-0000-4000-8000-000000000002' and hits>50),'hour quota never persists an over-limit increment');

select * from finish();
rollback;
