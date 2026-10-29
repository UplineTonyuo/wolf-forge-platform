-- Synthetic assigned credentials only; Vault rows, business fixtures and audit rows roll back.
begin;
select no_plan();
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('b1760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','intake-secret-'||n||'@example.invalid',now(),now()
from generate_series(1,7)n;
insert into public.tenants(id,slug,display_name,status) values
('b1760000-0000-4000-8000-000000000010','intake-secret-a','Intake Secret A','active'),
('b1760000-0000-4000-8000-000000000011','intake-secret-b','Intake Secret B','active');
insert into public.companies(id,tenant_id,name,status) values
('b1760000-0000-4000-8000-000000000020','b1760000-0000-4000-8000-000000000010','Credential Buyer','client'),
('b1760000-0000-4000-8000-000000000021','b1760000-0000-4000-8000-000000000010','Other Credential Buyer','client'),
('b1760000-0000-4000-8000-000000000022','b1760000-0000-4000-8000-000000000011','Foreign Credential Buyer','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,('b1760000-0000-4000-8000-'||lpad(v.n::text,12,'0'))::uuid,v.kind,r.id,v.company::uuid from (values
('b1760000-0000-4000-8000-000000000010',1,'internal','owner',null),
('b1760000-0000-4000-8000-000000000010',2,'client','client','b1760000-0000-4000-8000-000000000020'),
('b1760000-0000-4000-8000-000000000010',3,'client','client','b1760000-0000-4000-8000-000000000020'),
('b1760000-0000-4000-8000-000000000010',4,'client','client','b1760000-0000-4000-8000-000000000021'),
('b1760000-0000-4000-8000-000000000011',5,'client','client','b1760000-0000-4000-8000-000000000022'),
('b1760000-0000-4000-8000-000000000010',6,'internal','admin',null),
('b1760000-0000-4000-8000-000000000011',7,'internal','owner',null)
)v(tenant,n,kind,role_name,company) join public.roles r on r.name=v.role_name;
insert into auth.sessions(id,user_id,aal,not_after)
select ('c1760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b1760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal1',now()+interval '1 day'
from generate_series(1,7)n;
insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
values('b1760000-0000-4000-8000-000000000030','b1760000-0000-4000-8000-000000000010','Credential intake service',10,'USD',true,false,false);
create temp table secrets176_ids(label text primary key,id uuid not null);
grant all on secrets176_ids to authenticated;
create temp table secret176_boundary(mode text);
grant all on secret176_boundary to authenticated;
create function pg_temp.secret176_revoke_during_boundary() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text:=(select b.mode from pg_temp.secret176_boundary b limit 1); revoke_now boolean:=false;
begin
  if tg_table_name='rate_limit_counters' then
    revoke_now:=(mode='capture' and new.scope='intake-secret-capture-minute') or (mode='reveal' and new.scope='intake-secret-reveal');
  elsif tg_table_name='security_audit_events' then
    revoke_now:=mode='audit-reveal' and new.event_code='integration.intake_secret.revealed';
  end if;
  if revoke_now then update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=(auth.jwt()->>'session_id')::uuid; end if;
  return new;
end;
$$;
create trigger secret176_rate_boundary after insert or update on private.rate_limit_counters
for each row execute function pg_temp.secret176_revoke_during_boundary();
create trigger secret176_audit_boundary after insert on public.security_audit_events
for each row execute function pg_temp.secret176_revoke_during_boundary();
create function pg_temp.secret176_key(n integer) returns uuid language sql immutable as $$
select ('b1760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.secret176_value() returns text language sql immutable as $$ select '  synthetic WordPress credential QA 176  '; $$;
create function pg_temp.secret176_act(n integer,tenant text default 'b1760000-0000-4000-8000-000000000010') returns void language sql as $$
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.secret176_key(n),'role','authenticated',
  'session_id',('c1760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid)::text,true);
select set_config('request.headers',jsonb_build_object('x-wf-tenant',tenant)::text,true);
select set_config('app.client_support_id','',true);
select set_config('app.client_support_administrator','',true);
$$;
create function pg_temp.secret176_definition() returns jsonb language sql as $$
select jsonb_build_object('name','Encrypted WordPress Fixture','title','Encrypted WordPress Fixture','visibility','assigned',
  'type_config','{}'::jsonb,'rules','[]'::jsonb,'service_links','[]'::jsonb,'fields',
  (select jsonb_agg(jsonb_build_object('stable_field_key',pg_temp.secret176_key(n),'sort_order',n-50,'field_type','secret',
    'label',case when n=50 then 'WordPress password' else 'Optional encrypted credential '||n end,
    'required',n=50,'settings',jsonb_build_object('collection_mode','encrypted')) order by n) from generate_series(50,74)n)
  ||jsonb_build_array(jsonb_build_object('stable_field_key',pg_temp.secret176_key(80),'sort_order',25,'field_type','secret',
      'label','Legacy disabled secret','required',false,'settings',jsonb_build_object('collection_mode','disabled')),
    jsonb_build_object('stable_field_key',pg_temp.secret176_key(81),'sort_order',26,'field_type','text','label','Business name','required',true)));
$$;
create function pg_temp.secret176_values(reference uuid,extra jsonb default '[]'::jsonb) returns jsonb language sql as $$
select jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(50),'value',jsonb_build_object('credential_id',reference)),
  jsonb_build_object('field_key',pg_temp.secret176_key(81),'value','Synthetic business 176'))||extra;
$$;
create function pg_temp.secret176_capture(n integer,field integer,request_id uuid default gen_random_uuid()) returns uuid language sql as $$
select (public.app_capture_intake_secret(request_id,(select id from secrets176_ids where label='assignment-'||n),
  pg_temp.secret176_key(field),pg_temp.secret176_value())->>'credential_id')::uuid;
$$;
create function pg_temp.secret176_submit(n integer,reference uuid,extra jsonb default '[]'::jsonb,request_id uuid default gen_random_uuid()) returns uuid language sql as $$
select (public.app_submit_form(request_id,(select id from secrets176_ids where label=case when n=5 then 'version-b' else 'version-a' end),
  jsonb_build_object('assignment_id',(select id from secrets176_ids where label='assignment-'||n)),pg_temp.secret176_values(reference,extra),'[]'::jsonb)).id;
$$;
create function pg_temp.secret176_support_request(operation text) returns void language sql as $$
select pg_temp.secret176_act(1);
select set_config('request.headers',jsonb_build_object('x-wf-tenant','b1760000-0000-4000-8000-000000000010',
  'x-wf-client-support',(select id::text from secrets176_ids where label='support')||'.'||repeat('a',64))::text,true);
select set_config('request.path','/rpc/'||operation,true);
select set_config('request.method','POST',true);
$$;

select ok(not has_function_privilege('anon','public.app_capture_intake_secret(uuid,uuid,uuid,text)','execute'),'anonymous capture is denied');
select ok(not has_function_privilege('service_role','public.app_capture_intake_secret(uuid,uuid,uuid,text)','execute'),'capture has no service-role bypass');
select ok(not has_function_privilege('anon','public.app_reveal_intake_secret(uuid)','execute'),'anonymous reveal is denied');
select ok(not has_function_privilege('service_role','public.app_reveal_intake_secret(uuid)','execute'),'reveal has no service-role bypass');
select ok(not has_table_privilege('authenticated','private.intake_secret_references','select'),'reference ledger is private');
select ok(not has_table_privilege('authenticated','vault.decrypted_secrets','select'),'decrypted Vault view is not exposed');
select ok(not has_function_privilege('authenticated','private.require_intake_secret_reference(uuid,uuid,jsonb)','execute'),'reference authority helper is private');
set local role authenticated;
select pg_temp.secret176_act(1);
insert into secrets176_ids select 'form-a',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding',
  'canonical_key','encrypted-secret-176-a','definition',pg_temp.secret176_definition()))).id;
insert into secrets176_ids select 'version-a',(public.app_publish_form(gen_random_uuid(),id)).id from secrets176_ids where label='form-a';
select ok(exists(select 1 from secrets176_ids where label='version-a'),'required encrypted onboarding field publishes');
select throws_ok($q$select public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding',
  'canonical_key','secret176-disabled-required','definition',jsonb_set(pg_temp.secret176_definition(),'{fields,0,settings}',
    '{"collection_mode":"disabled"}'::jsonb)))$q$,'23514',null,'disabled secret cannot become required');
select throws_ok($q$select public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding',
  'canonical_key','secret176-default-refused','definition',jsonb_set(pg_temp.secret176_definition(),'{fields,0,default_value}',
    to_jsonb(pg_temp.secret176_value()))))$q$,'23514',null,'credential defaults cannot enter published schemas or definition ledgers');
select throws_ok($q$select public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding',
  'canonical_key','secret176-unknown-mode','definition',jsonb_set(pg_temp.secret176_definition(),'{fields,0,settings}','{}'::jsonb)))$q$,
  '23514',null,'unknown credential collection mode is refused for new definitions');
select throws_ok($q$select public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','contact','canonical_key','secret176-public-refused',
  'definition',jsonb_build_object('name','Public capture refused','title','Public capture refused','visibility','public','type_config','{}'::jsonb,
    'rules','[]'::jsonb,'service_links','[]'::jsonb,'fields',jsonb_build_array(jsonb_build_object('stable_field_key',pg_temp.secret176_key(50),
      'sort_order',0,'field_type','secret','label','Password','required',false,'settings',jsonb_build_object('collection_mode','encrypted'))))))$q$,
  '23514',null,'public Contact form cannot enable encrypted credential collection');
insert into secrets176_ids select 'intake-form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','intake',
  'canonical_key','secret176-required-intake','definition',jsonb_set(pg_temp.secret176_definition(),'{service_links}',jsonb_build_array(
    jsonb_build_object('service_id','b1760000-0000-4000-8000-000000000030','role','intake_assignment','sort_order',0)))))).id;
insert into secrets176_ids select 'intake-version',(public.app_publish_form(gen_random_uuid(),id)).id from secrets176_ids where label='intake-form';
select ok(exists(select 1 from secrets176_ids where label='intake-version'),'required encrypted intake field publishes with its Service link');
insert into secrets176_ids select 'typed-password-form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','contact',
  'canonical_key','secret176-required-typed-password','definition',jsonb_build_object('name','Typed password deferred','title','Typed password deferred',
    'visibility','public','type_config','{}'::jsonb,'rules','[]'::jsonb,'service_links','[]'::jsonb,'fields',jsonb_build_array(jsonb_build_object(
      'stable_field_key',pg_temp.secret176_key(90),'sort_order',0,'field_type','password','label','Typed password','required',true)))))).id;
select throws_ok($q$select public.app_publish_form(gen_random_uuid(),(select id from secrets176_ids where label='typed-password-form'))$q$,
  '22023',null,'raw typed password integration still cannot be required');
insert into secrets176_ids select 'plain-form',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding',
  'canonical_key','secret176-no-capture','definition',jsonb_set(pg_temp.secret176_definition(),'{fields,0,required}','false'::jsonb)))).id;
insert into secrets176_ids select 'plain-version',(public.app_publish_form(gen_random_uuid(),id)).id from secrets176_ids where label='plain-form';
insert into secrets176_ids select 'plain-assignment',(public.app_assign_form(gen_random_uuid(),id,jsonb_build_object('client_profile_id',pg_temp.secret176_key(4)))).id
from secrets176_ids where label='plain-form';
select pg_temp.secret176_act(4);
insert into secrets176_ids select 'plain-submission',(public.app_submit_form(gen_random_uuid(),(select id from secrets176_ids where label='plain-version'),
  jsonb_build_object('assignment_id',(select id from secrets176_ids where label='plain-assignment')),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(81),'value','No credential provided')),'[]'::jsonb)).id;
select is((public.app_get_form_submission((select id from secrets176_ids where label='plain-submission'))->>'has_saved_credentials')::boolean,false,
  'generic presence flag stays false when no credential was provided');
select pg_temp.secret176_act(1);
insert into secrets176_ids select 'assignment-'||n,(public.app_assign_form(gen_random_uuid(),(select id from secrets176_ids where label='form-a'),
  jsonb_build_object('client_profile_id',pg_temp.secret176_key(n)))).id from generate_series(2,4)n;
select pg_temp.secret176_act(7,'b1760000-0000-4000-8000-000000000011');
insert into secrets176_ids select 'form-b',(public.app_create_form(gen_random_uuid(),jsonb_build_object('form_type','onboarding',
  'canonical_key','encrypted-secret-176-b','definition',pg_temp.secret176_definition()))).id;
insert into secrets176_ids select 'version-b',(public.app_publish_form(gen_random_uuid(),id)).id from secrets176_ids where label='form-b';
insert into secrets176_ids select 'assignment-5',(public.app_assign_form(gen_random_uuid(),id,jsonb_build_object('client_profile_id',pg_temp.secret176_key(5)))).id
from secrets176_ids where label='form-b';
insert into secrets176_ids values('capture-request',gen_random_uuid()),('capture-second-request',gen_random_uuid()),('submit-request',gen_random_uuid());
select pg_temp.secret176_act(2);
select throws_ok($q$select public.app_capture_intake_secret(gen_random_uuid(),(select id from secrets176_ids where label='assignment-2'),pg_temp.secret176_key(50),'')$q$,'22023',null,'empty secret is refused');
select throws_ok($q$select public.app_capture_intake_secret(gen_random_uuid(),(select id from secrets176_ids where label='assignment-2'),pg_temp.secret176_key(50),repeat('x',4097))$q$,'22023',null,'capture input is bounded');
select throws_ok($q$select pg_temp.secret176_capture(2,80)$q$,'42501',null,'legacy disabled secret field stays disabled');
insert into secrets176_ids select 'credential',pg_temp.secret176_capture(2,50,(select id from secrets176_ids where label='capture-request'));
select is(pg_temp.secret176_capture(2,50,(select id from secrets176_ids where label='capture-request')),
  (select id from secrets176_ids where label='credential'),'exact private capture replay returns the same reference');
select throws_ok($q$select public.app_capture_intake_secret((select id from secrets176_ids where label='capture-request'),
  (select id from secrets176_ids where label='assignment-2'),pg_temp.secret176_key(50),'different synthetic value')$q$,'23505',null,'changed capture payload cannot reuse request ID');
insert into secrets176_ids select 'credential-second',pg_temp.secret176_capture(2,51,(select id from secrets176_ids where label='capture-second-request'));
select throws_ok($q$select public.app_save_intake_draft((select id from secrets176_ids where label='assignment-2'),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(50),'value',pg_temp.secret176_value())))$q$,'23514',null,'raw password cannot enter the generic draft');
select throws_ok($q$select public.app_submit_form(gen_random_uuid(),(select id from secrets176_ids where label='version-a'),
  jsonb_build_object('assignment_id',(select id from secrets176_ids where label='assignment-2')),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(50),'value',pg_temp.secret176_value()),
    jsonb_build_object('field_key',pg_temp.secret176_key(81),'value','Synthetic business 176')),'[]'::jsonb)$q$,
  '23514',null,'raw password cannot enter the generic submission');
select throws_ok($q$select public.app_save_intake_draft((select id from secrets176_ids where label='assignment-2'),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(51),'value',jsonb_build_object('credential_id',(select id from secrets176_ids where label='credential')))))$q$,
  '42501',null,'credential cannot move to a different field');
select lives_ok($q$select public.app_save_intake_draft((select id from secrets176_ids where label='assignment-2'),
  pg_temp.secret176_values((select id from secrets176_ids where label='credential'),jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(51),'value',
    jsonb_build_object('credential_id',(select id from secrets176_ids where label='credential-second'))))))$q$,'draft saves only encrypted references');
select is(jsonb_array_length(public.app_get_form_assignment_history((select id from secrets176_ids where label='assignment-2'))->'secret_fields'),26,
  'history-safe classification names encrypted and disabled fields without collecting values');
select is((public.app_get_intake_draft((select id from secrets176_ids where label='assignment-2'))->'values'->0->'value'->>'credential_id')::uuid,
  (select id from secrets176_ids where label='credential'),'restored draft contains opaque reference only');
reset role;
select ok((select v.secret<>pg_temp.secret176_value() from private.intake_secret_references r join vault.secrets v on v.id=r.vault_secret_id
  where r.id=(select id from secrets176_ids where label='credential')),'Vault stored value is ciphertext');
select is((select decrypted_secret from vault.decrypted_secrets v join private.intake_secret_references r on r.vault_secret_id=v.id
  where r.id=(select id from secrets176_ids where label='credential')),pg_temp.secret176_value(),'capture preserves exact whitespace without exposing it to ordinary reads');
select is((select count(*) from public.security_audit_events where event_code='integration.intake_secret.captured'
  and resource_id=(select id from secrets176_ids where label='credential')),1::bigint,'idempotent capture adds one audit');
update private.intake_secret_references set created_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 day'
where id=(select id from secrets176_ids where label='credential-second');
set local role authenticated;
select pg_temp.secret176_act(2);
select throws_ok($q$select pg_temp.secret176_capture(2,51,(select id from secrets176_ids where label='capture-second-request'))$q$,'23505',null,'expired request tombstone cannot recapture a new value');
select is(jsonb_array_length(public.app_get_intake_draft((select id from secrets176_ids where label='assignment-2'))->'values'),2,'expired secret is omitted while other draft answers remain');
select throws_ok($q$select pg_temp.secret176_submit(2,(select id from secrets176_ids where label='credential'),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(51),'value',jsonb_build_object('credential_id',(select id from secrets176_ids where label='credential-second')))))$q$,
  '42501',null,'expired reference prevents submission');
reset role;
select ok((select submission_id is null from private.intake_secret_references where id=(select id from secrets176_ids where label='credential')),
  'failed submission leaves the saved credential unbound for retry');
insert into secrets176_ids select 'expired-vault',vault_secret_id from private.intake_secret_references where id=(select id from secrets176_ids where label='credential-second');
select is(private.expire_intake_secret_values(25),1,'bounded maintenance removes expired unsubmitted value');
select ok(not exists(select 1 from vault.secrets where id=(select id from secrets176_ids where label='expired-vault')),'expired plaintext cannot be recovered from Vault');
select ok(exists(select 1 from private.intake_secret_references where id=(select id from secrets176_ids where label='credential-second') and vault_secret_id is null),
  'expiry retains the request tombstone without encrypted content');
set local role authenticated;
select pg_temp.secret176_act(3);
select throws_ok($q$select public.app_save_intake_draft((select id from secrets176_ids where label='assignment-3'),
  pg_temp.secret176_values((select id from secrets176_ids where label='credential')))$q$,'42501',null,'same-company different client cannot use reference');
select pg_temp.secret176_act(4);
select throws_ok($q$select public.app_save_intake_draft((select id from secrets176_ids where label='assignment-4'),
  pg_temp.secret176_values((select id from secrets176_ids where label='credential')))$q$,'42501',null,'different company cannot use reference');
select pg_temp.secret176_act(5,'b1760000-0000-4000-8000-000000000011');
select throws_ok($q$select public.app_save_intake_draft((select id from secrets176_ids where label='assignment-5'),
  pg_temp.secret176_values((select id from secrets176_ids where label='credential')))$q$,'42501',null,'different Tenant/version cannot use reference');
select pg_temp.secret176_act(2);
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,'unsubmitted credential has no reveal path');
insert into secrets176_ids select 'submission',pg_temp.secret176_submit(2,(select id from secrets176_ids where label='credential'),'[]'::jsonb,
  (select id from secrets176_ids where label='submit-request'));
select is(pg_temp.secret176_submit(2,(select id from secrets176_ids where label='credential'),'[]'::jsonb,(select id from secrets176_ids where label='submit-request')),
  (select id from secrets176_ids where label='submission'),'accepted form replay returns its immutable submission');
select is((public.app_get_form_submission((select id from secrets176_ids where label='submission'))->>'has_saved_credentials')::boolean,true,
  'generic detail exposes only a presence flag for the submitted credential');
select ok(position((select id::text from secrets176_ids where label='credential') in public.app_get_form_submission((select id from secrets176_ids where label='submission'))::text)=0,
  'generic client response still excludes secret reference fields');
select ok(position((select id::text from secrets176_ids where label='credential') in public.app_get_form_submission_pdf((select id from secrets176_ids where label='submission'))::text)=0,
  'PDF record excludes secret values and references');
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,'ordinary client cannot reveal stored credentials');
select pg_temp.secret176_act(1);
select is(jsonb_array_length(public.app_list_intake_secret_references((select id from secrets176_ids where label='submission'))),1,
  'authorized internal view receives one masked metadata reference');
select is(public.app_reveal_intake_secret((select id from secrets176_ids where label='credential')),pg_temp.secret176_value(),'owner explicitly reveals exact submitted value');
insert into secrets176_ids select 'correction',(public.app_correct_form_submission(gen_random_uuid(),(select id from secrets176_ids where label='submission'),
  jsonb_build_array(jsonb_build_object('field_key',pg_temp.secret176_key(81),'value','Corrected business 176')))).id;
select throws_ok($q$select public.app_correct_form_submission(gen_random_uuid(),(select id from secrets176_ids where label='correction'),
  pg_temp.secret176_values((select id from secrets176_ids where label='credential-second')))$q$,'23514',null,'correction cannot replace immutable credential evidence');
reset role;
select is((select value from public.form_submission_values where submission_id=(select id from secrets176_ids where label='correction') and field_type_snapshot='secret'),
  (select value from public.form_submission_values where submission_id=(select id from secrets176_ids where label='submission') and field_type_snapshot='secret'),
  'non-secret correction retains exact previous secret reference without generic disclosure');
select ok(not exists(select 1 from private.form_submission_requests where actor_profile_id in (pg_temp.secret176_key(1),pg_temp.secret176_key(2))
    and position(pg_temp.secret176_value() in payload::text)>0)
  and not exists(select 1 from private.app_create_requests where actor_profile_id in (pg_temp.secret176_key(1),pg_temp.secret176_key(2)) and position(pg_temp.secret176_value() in payload::text)>0)
  and not exists(select 1 from private.intake_drafts where profile_id=pg_temp.secret176_key(2) and position(pg_temp.secret176_value() in answers::text)>0)
  and not exists(select 1 from public.security_audit_events where target_actor_id=pg_temp.secret176_key(2) and position(pg_temp.secret176_value() in to_jsonb(security_audit_events)::text)>0),
  'no plaintext survives in generic ledgers, drafts or audits');
update private.intake_secret_references set created_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 day'
where id=(select id from secrets176_ids where label='credential');
set local role authenticated;
select pg_temp.secret176_act(6);
select is(public.app_reveal_intake_secret((select id from secrets176_ids where label='credential')),pg_temp.secret176_value(),'submitted credential follows parent retention rather than draft expiry');
reset role;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
('b1760000-0000-4000-8000-000000000010',pg_temp.secret176_key(6),'client_private.manage',false);
set local role authenticated;
select pg_temp.secret176_act(6);
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,'revoked administrator private-client access takes effect immediately');
reset role;
update public.companies set archived_at=clock_timestamp() where id='b1760000-0000-4000-8000-000000000020';
set local role authenticated;
select pg_temp.secret176_act(1);
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,'archived parent company prevents reveal');
reset role;
update public.companies set archived_at=null where id='b1760000-0000-4000-8000-000000000020';
set local role authenticated;
select pg_temp.secret176_act(7,'b1760000-0000-4000-8000-000000000011');
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,'foreign Tenant owner cannot reveal value');
select pg_temp.secret176_act(1);
-- Deterministic late-authority regression: the real limiter/audit operation changes
-- the synthetic session before the RPC can proceed. These are not timing/load tests.
insert into secret176_boundary values('capture');
select pg_temp.secret176_act(4);
select throws_ok($q$select pg_temp.secret176_capture(4,51)$q$,'42501',null,'capture reauthorizes after its rate operation before persisting Vault data');
reset role;
select is((select count(*) from private.intake_secret_references where profile_id=pg_temp.secret176_key(4)),0::bigint,
  'late capture denial leaves no credential reference');
update auth.sessions set not_after=clock_timestamp()+interval '1 day' where id='c1760000-0000-4000-8000-000000000004';
update secret176_boundary set mode='reveal';
set local role authenticated;
select pg_temp.secret176_act(1);
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,
  'reveal reauthorizes after its rate operation before returning plaintext');
reset role;
update auth.sessions set not_after=clock_timestamp()+interval '1 day' where id='c1760000-0000-4000-8000-000000000001';
update secret176_boundary set mode='audit-reveal';
set local role authenticated;
select pg_temp.secret176_act(1);
select throws_ok($q$select public.app_reveal_intake_secret((select id from secrets176_ids where label='credential'))$q$,'42501',null,
  'reveal reauthorizes after its audit operation before returning plaintext');
reset role;
update auth.sessions set not_after=clock_timestamp()+interval '1 day' where id='c1760000-0000-4000-8000-000000000001';
select is((select count(*) from public.security_audit_events where event_code='integration.intake_secret.revealed'
  and resource_id=(select id from secrets176_ids where label='credential')),2::bigint,'late reveal denials do not persist successful-reveal audits');
drop trigger secret176_rate_boundary on private.rate_limit_counters;
drop trigger secret176_audit_boundary on public.security_audit_events;
set local role authenticated;
select pg_temp.secret176_act(1);
insert into secrets176_ids select 'support',(public.app_begin_client_support(pg_temp.secret176_key(4),encode(extensions.digest(repeat('a',64),'sha256'),'hex'))->>'id')::uuid;
select pg_temp.secret176_support_request('app_capture_intake_secret');
select throws_ok($q$select pg_temp.secret176_capture(4,50)$q$,'42501',null,'missing hook cannot capture using the original administrator identity');
select public.app_apply_client_support_context();
insert into secrets176_ids select 'support-credential',pg_temp.secret176_capture(4,50);
select pg_temp.secret176_support_request('app_reveal_intake_secret');
select throws_ok($q$select public.app_apply_client_support_context()$q$,'42501',null,'delegation allowlist never enables reveal');
reset role;
select is((select actor_profile_id from public.security_audit_events where event_code='integration.intake_secret.captured' and resource_id=(select id from secrets176_ids where label='support-credential')),
  pg_temp.secret176_key(1),'support capture audit names the actual administrator');
select is((select target_actor_id from public.security_audit_events where event_code='integration.intake_secret.captured' and resource_id=(select id from secrets176_ids where label='support-credential')),
  pg_temp.secret176_key(4),'support capture audit names the selected client');
-- Each operation below still enters the real capture RPC; only the test clock bucket resets.
do $$ declare n integer; begin
  perform pg_temp.secret176_act(3);
  for n in 50..69 loop
    update private.rate_limit_counters set hits=0 where scope='intake-secret-capture-minute' and subject=pg_temp.secret176_key(3)::text;
    perform pg_temp.secret176_capture(3,n);
  end loop;
end $$;
set local role authenticated;
select pg_temp.secret176_act(3);
select throws_ok($q$select pg_temp.secret176_capture(3,70)$q$,'54000',null,'assignment capture quota is enforced');
reset role;
select pg_temp.secret176_act(4);
update private.rate_limit_counters set hits=0 where scope='intake-secret-capture-minute' and subject=pg_temp.secret176_key(4)::text;
select pg_temp.secret176_capture(4,50) from generate_series(1,4);
set local role authenticated;
select throws_ok($q$select pg_temp.secret176_capture(4,50)$q$,'54000',null,'field capture quota is enforced');
reset role;
update private.rate_limit_counters set hits=6 where scope='intake-secret-capture-minute' and subject=pg_temp.secret176_key(4)::text;
set local role authenticated;
select pg_temp.secret176_act(4);
select throws_ok($q$select pg_temp.secret176_capture(4,51)$q$,'WF429',null,'per-profile capture minute limit is enforced');
reset role;
update private.rate_limit_counters set hits=0 where scope='intake-secret-capture-minute' and subject=pg_temp.secret176_key(4)::text;
update private.rate_limit_counters set hits=40 where scope='intake-secret-capture-day' and subject=pg_temp.secret176_key(4)::text;
set local role authenticated;
select throws_ok($q$select pg_temp.secret176_capture(4,51)$q$,'WF429',null,'per-profile daily capture limit is enforced');
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='c1760000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.secret176_act(3);
select throws_ok($q$select pg_temp.secret176_capture(3,70)$q$,'42501',null,'revoked current Auth session denies capture before quota or Vault access');
reset role;
update auth.sessions set not_after=clock_timestamp()+interval '1 day' where id='c1760000-0000-4000-8000-000000000003';
update public.profiles set archived_at=clock_timestamp() where id=pg_temp.secret176_key(3);
set local role authenticated;
select pg_temp.secret176_act(3);
select throws_ok($q$select pg_temp.secret176_capture(3,70)$q$,'42501',null,
  'globally archived client with active nondefault-Tenant membership and live Auth session cannot capture');
reset role;
update public.profiles set archived_at=null where id=pg_temp.secret176_key(3);
insert into secrets176_ids select 'cleanup-vault',vault_secret_id from private.intake_secret_references where id=(select id from secrets176_ids where label='support-credential');
delete from private.intake_secret_references where id=(select id from secrets176_ids where label='support-credential');
select ok(not exists(select 1 from vault.secrets where id=(select id from secrets176_ids where label='cleanup-vault')),'reference deletion cleans only its dedicated Vault value');
select ok(exists(select 1 from vault.secrets v join private.intake_secret_references r on r.vault_secret_id=v.id where r.id=(select id from secrets176_ids where label='credential')),
  'cleanup does not remove another submitted credential');
select * from finish();
rollback;
