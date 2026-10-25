-- Outbox contract only. This never calls Gmail. All fixtures roll back.
begin;
select plan(1);
set local plpgsql.check_asserts=on;
insert into auth.users(id,aud,role,email,created_at,updated_at)
values
 ('20000000-0000-4000-8000-000000008901','authenticated','authenticated','contact-email-owner@example.invalid',now(),now()),
 ('20000000-0000-4000-8000-000000008902','authenticated','authenticated','contact-email-client@example.invalid',now(),now());
insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000008901','contact-email-rollback-fixture','Contact email fixture','active');
insert into public.companies(id,tenant_id,name,status)
values('e7360000-0000-4000-8000-000000008901','f0f0f0f0-0000-4000-8000-000000008901','Synthetic email client','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000008901',v.id::uuid,v.account_class,r.id,v.company_id::uuid
from (values
 ('20000000-0000-4000-8000-000000008901','internal','owner',null),
 ('20000000-0000-4000-8000-000000008902','client','client','e7360000-0000-4000-8000-000000008901')
) v(id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000008901","role":"authenticated"}',true);
select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000008901"}',true);
do $test$
declare contact public.client_contacts; attempt_id uuid:=gen_random_uuid(); result jsonb;
begin
  contact:=public.app_create_contact(p_request_id=>gen_random_uuid(),p_company_id=>'e7360000-0000-4000-8000-000000008901',p_name=>'Synthetic Email QA',p_email=>'synthetic@example.test');
  result:=public.app_server_claim_contact_email('20000000-0000-4000-8000-000000008901','f0f0f0f0-0000-4000-8000-000000008901',attempt_id,contact.id,'Synthetic QA','No message is sent.');
  assert result->>'outcome'='claimed';
  result:=public.app_server_claim_contact_email('20000000-0000-4000-8000-000000008901','f0f0f0f0-0000-4000-8000-000000008901',attempt_id,contact.id,'Synthetic QA','No message is sent.');
  assert result->>'outcome'='sending';
  perform public.app_server_finish_contact_email('20000000-0000-4000-8000-000000008901','f0f0f0f0-0000-4000-8000-000000008901',attempt_id,'synthetic-provider-id');
  result:=public.app_server_claim_contact_email('20000000-0000-4000-8000-000000008901','f0f0f0f0-0000-4000-8000-000000008901',attempt_id,contact.id,'Synthetic QA','No message is sent.');
  assert result->>'outcome'='accepted';
  begin
    perform public.app_server_claim_contact_email('20000000-0000-4000-8000-000000008901','f0f0f0f0-0000-4000-8000-000000008901',attempt_id,contact.id,'Changed','Different payload');
    raise exception 'request conflict accepted';
  exception when unique_violation then null; end;
  begin
    perform public.app_server_claim_contact_email('20000000-0000-4000-8000-000000008902','f0f0f0f0-0000-4000-8000-000000008901',gen_random_uuid(),contact.id,'Bad actor','Not sent');
    raise exception 'client email privilege accepted';
  exception when insufficient_privilege then null; end;
  update private.client_contact_emails set created_at=now()-interval '91 days' where request_id=attempt_id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.app_server_intake_maintenance();
  assert (select body='' and subject='' and recipient='' and status='accepted' from private.client_contact_emails where request_id=attempt_id),'old correspondence not purged safely';
end;
$test$;
select pass('Outbox claim, replay, conflict, authorization and retention assertions passed without contacting Gmail');
select * from finish();
rollback;
