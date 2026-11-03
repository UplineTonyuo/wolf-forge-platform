insert into public.tenants(id,slug,display_name,status) values
('f0f0f0f0-0000-4000-8000-000000001701','calling-v1-fixture','Calling v1 synthetic fixture','active');
insert into public.companies(id,tenant_id,name,status) values
('e0000000-0000-4000-8000-000000001701','f0f0f0f0-0000-4000-8000-000000001701','Synthetic calling Company','client');
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000'||n)::uuid,'authenticated','authenticated',
  'calling-v1-'||n||'@example.invalid',now(),now() from unnest(array['1701','1702','1703','1704','1705']) n;
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000001701',('20000000-0000-4000-8000-00000000'||n)::uuid,
  'client',r.id,'e0000000-0000-4000-8000-000000001701' from unnest(array['1701','1702']) n
  cross join public.roles r where r.name='client';
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id)
select 'f0f0f0f0-0000-4000-8000-000000001701',('20000000-0000-4000-8000-00000000'||n)::uuid,
  'internal',r.id from unnest(array['1703','1704','1705']) n
  cross join public.roles r where r.name=case when n='1704' then 'admin' else 'owner' end;
insert into auth.sessions(id,user_id,aal,not_after)
select ('33000000-0000-4000-8000-00000000'||n)::uuid,('20000000-0000-4000-8000-00000000'||n)::uuid,
  'aal1',now()+interval '1 day' from unnest(array['1701','1702','1703','1704','1705']) n;
insert into public.tickets(id,tenant_id,company_id,client_profile_id,assigned_to_profile_id,subject,status)
select ('e1700000-0000-4000-8000-00000000'||n)::uuid,'f0f0f0f0-0000-4000-8000-000000001701',
  'e0000000-0000-4000-8000-000000001701',
  case when n in ('1701','1702') then '20000000-0000-4000-8000-000000001701' else '20000000-0000-4000-8000-000000001702' end::uuid,
  case when n='1704' then null when n='1702' then '20000000-0000-4000-8000-000000001705' else '20000000-0000-4000-8000-000000001704' end::uuid,
  'Synthetic calling Ticket '||n,'open' from unnest(array['1701','1702','1703','1704']) n;
-- Explicit synthetic personal saves; never infer this from assignments/global timestamps.
insert into private.ticket_inbox_memberships(ticket_id,profile_id)
select t.id,m.profile_id from public.tickets t join public.tenant_memberships m on m.tenant_id=t.tenant_id
where t.tenant_id='f0f0f0f0-0000-4000-8000-000000001701' and m.account_class='internal';
update private.ticket_call_environment set enabled=true,backend_ref='ci',environment='test',
  verified_at=clock_timestamp(),media_enabled=true,account_exclusive=true,account_exclusive_verified_at=clock_timestamp();
insert into private.ticket_call_account_usage(month,unmapped_seconds,verified_at)
  values(date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0,clock_timestamp());
insert into private.ticket_call_settings(tenant_id,enabled,fallback_team_profile_id,monthly_minutes)
  values('f0f0f0f0-0000-4000-8000-000000001701',true,'20000000-0000-4000-8000-000000001703',600);
