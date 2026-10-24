-- Outbox contract only. This never calls Gmail. All fixtures roll back.
begin;
set local plpgsql.check_asserts=on;
select set_config('request.jwt.claims','{"sub":"53fd4f26-34a0-4965-97b8-87e876a3fd1d","role":"authenticated"}',true);
select set_config('request.headers','{"x-wf-tenant":"f0f0f0f0-0000-4000-8000-000000000001"}',true);
do $test$
declare contact public.client_contacts; attempt_id uuid:=gen_random_uuid(); result jsonb;
begin
  contact:=public.app_create_contact(p_request_id=>gen_random_uuid(),p_company_id=>'469c0503-740a-44c5-90a1-fc15bb475939',p_name=>'Synthetic Email QA',p_email=>'synthetic@example.test');
  result:=public.app_server_claim_contact_email('53fd4f26-34a0-4965-97b8-87e876a3fd1d','f0f0f0f0-0000-4000-8000-000000000001',attempt_id,contact.id,'Synthetic QA','No message is sent.');
  assert result->>'outcome'='claimed';
  result:=public.app_server_claim_contact_email('53fd4f26-34a0-4965-97b8-87e876a3fd1d','f0f0f0f0-0000-4000-8000-000000000001',attempt_id,contact.id,'Synthetic QA','No message is sent.');
  assert result->>'outcome'='sending';
  perform public.app_server_finish_contact_email('53fd4f26-34a0-4965-97b8-87e876a3fd1d','f0f0f0f0-0000-4000-8000-000000000001',attempt_id,'synthetic-provider-id');
  result:=public.app_server_claim_contact_email('53fd4f26-34a0-4965-97b8-87e876a3fd1d','f0f0f0f0-0000-4000-8000-000000000001',attempt_id,contact.id,'Synthetic QA','No message is sent.');
  assert result->>'outcome'='accepted';
  begin
    perform public.app_server_claim_contact_email('53fd4f26-34a0-4965-97b8-87e876a3fd1d','f0f0f0f0-0000-4000-8000-000000000001',attempt_id,contact.id,'Changed','Different payload');
    raise exception 'request conflict accepted';
  exception when unique_violation then null; end;
  begin
    perform public.app_server_claim_contact_email('e6cfa06d-666d-4629-9591-ddc6a55b5798','f0f0f0f0-0000-4000-8000-000000000001',gen_random_uuid(),contact.id,'Bad actor','Not sent');
    raise exception 'client email privilege accepted';
  exception when insufficient_privilege then null; end;
  update private.client_contact_emails set created_at=now()-interval '91 days' where request_id=attempt_id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.app_server_intake_maintenance();
  assert (select body='' and subject='' and recipient='' and status='accepted' from private.client_contact_emails where request_id=attempt_id),'old correspondence not purged safely';
end;
$test$;
rollback;
select 'outbox claim, replay, conflict and authorization assertions passed without contacting Gmail' as result;
