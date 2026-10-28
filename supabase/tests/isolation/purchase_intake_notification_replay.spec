# Run only against a fresh disposable, Docker-free database with the full schema.
# PostgreSQL isolationtester input; inspect the permutation output for errors.
# Deliberately refuses shared/hosted database names and non-loopback TCP servers.
setup
{
  do $$ begin
    if left(current_database(),length('wf_notifications_isolated_')) <> 'wf_notifications_isolated_'
      or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
      raise exception 'A verified disposable loopback notification database is required';
    end if;
  end $$;
  create schema notification_race;
  create table notification_race.ids(label text primary key,id uuid not null);
  grant usage on schema notification_race to authenticated;
  grant select,insert on notification_race.ids to authenticated;
  insert into auth.users(id,aud,role,email,created_at,updated_at)
  select ('d6280000-0000-4000-8000-00000000000'||n)::uuid,
    'authenticated','authenticated','notification-race-'||n||'@example.invalid',now(),now() from generate_series(1,2)n;
  insert into public.tenants(id,slug,display_name,status)
  values('d6280000-0000-4000-8000-000000000010','notification-race','Synthetic Race','active');
  insert into public.companies(id,tenant_id,name,status)
  values('d6280000-0000-4000-8000-000000000020','d6280000-0000-4000-8000-000000000010','Synthetic Buyer','client');
  insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
  select 'd6280000-0000-4000-8000-000000000010',v.profile_id::uuid,v.account_class,r.id,v.company_id::uuid
  from (values
    ('d6280000-0000-4000-8000-000000000001','internal','owner',null),
    ('d6280000-0000-4000-8000-000000000002','client','client','d6280000-0000-4000-8000-000000000020')
  )v(profile_id,account_class,role_name,company_id) join public.roles r on r.name=v.role_name;
  insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
  values('d6280000-0000-4000-8000-000000000030','d6280000-0000-4000-8000-000000000010','Synthetic Service',10,'USD',true,true,false);
  update public.company_wallets set balance_cents=10000 where company_id='d6280000-0000-4000-8000-000000000020';
  set role authenticated;
  select set_config('request.headers',jsonb_build_object('x-wf-tenant','d6280000-0000-4000-8000-000000000010')::text,false);
  select set_config('request.jwt.claim.sub','d6280000-0000-4000-8000-000000000001',false);
  insert into notification_race.ids select 'form',(public.app_create_form(gen_random_uuid(),jsonb_build_object(
    'form_type','intake','canonical_key','notification-race','definition',jsonb_build_object(
      'name','Race Intake','title','Race Intake','visibility','assigned','type_config',jsonb_build_object(),
      'fields',jsonb_build_array(jsonb_build_object('stable_field_key','d6280000-0000-4000-8000-000000000050',
        'sort_order',0,'field_type','text','label','Brief','required',true)),
      'rules','[]'::jsonb,'service_links',jsonb_build_array(jsonb_build_object(
        'service_id','d6280000-0000-4000-8000-000000000030','role','intake_assignment','sort_order',0,'configuration',jsonb_build_object())))))).id;
  insert into notification_race.ids select 'version',(public.app_publish_form(gen_random_uuid(),id)).id
    from notification_race.ids where label='form';
  select set_config('request.jwt.claim.sub','d6280000-0000-4000-8000-000000000002',false);
  insert into notification_race.ids select 'order',order_id from public.app_purchase_service_with_balance(
    'd6280000-0000-4000-8000-000000000039','d6280000-0000-4000-8000-000000000030');
  reset role;
  insert into notification_race.ids select 'assignment',id from public.form_assignments
    where order_id=(select id from notification_race.ids where label='order');
}

session "first"
step "first_begin"
{
  begin;
  set local role authenticated;
  select set_config('request.headers',jsonb_build_object('x-wf-tenant','d6280000-0000-4000-8000-000000000010')::text,true);
  select set_config('request.jwt.claim.sub','d6280000-0000-4000-8000-000000000002',true);
}
step "first_purchase"
{
  select replayed from public.app_purchase_service_with_balance(
    'd6280000-0000-4000-8000-000000000040','d6280000-0000-4000-8000-000000000030');
}
step "first_submit"
{
  select (public.app_submit_form('d6280000-0000-4000-8000-000000000041',
    (select id from notification_race.ids where label='version'),
    jsonb_build_object('assignment_id',(select id from notification_race.ids where label='assignment')),
    jsonb_build_array(jsonb_build_object('field_key','d6280000-0000-4000-8000-000000000050','value','Synthetic brief')))).id is not null as saved;
}
step "first_commit" { commit; }

session "retry"
step "retry_begin"
{
  begin;
  set local role authenticated;
  select set_config('request.headers',jsonb_build_object('x-wf-tenant','d6280000-0000-4000-8000-000000000010')::text,true);
  select set_config('request.jwt.claim.sub','d6280000-0000-4000-8000-000000000002',true);
}
step "retry_purchase"
{
  select replayed from public.app_purchase_service_with_balance(
    'd6280000-0000-4000-8000-000000000040','d6280000-0000-4000-8000-000000000030');
}
step "retry_submit"
{
  select (public.app_submit_form('d6280000-0000-4000-8000-000000000041',
    (select id from notification_race.ids where label='version'),
    jsonb_build_object('assignment_id',(select id from notification_race.ids where label='assignment')),
    jsonb_build_array(jsonb_build_object('field_key','d6280000-0000-4000-8000-000000000050','value','Synthetic brief')))).id is not null as saved;
}
step "retry_commit" { commit; }

session "verify"
step "verify_purchase"
{
  do $$ begin
    if (select count(*) from public.orders where tenant_id='d6280000-0000-4000-8000-000000000010')<>2
      or (select count(*) from public.company_wallet_transactions where company_id='d6280000-0000-4000-8000-000000000020')<>2
      or (select balance_cents from public.company_wallets where company_id='d6280000-0000-4000-8000-000000000020')<>8000
      or (select count(*) from public.notifications where tenant_id='d6280000-0000-4000-8000-000000000010' and event_key like 'order-purchased:%')<>2
      or exists(select 1 from public.notifications where tenant_id='d6280000-0000-4000-8000-000000000010'
        and event_key like 'order-purchased:%' group by recipient_profile_id,event_key having count(*)<>1) then
      raise exception 'Concurrent purchase replay duplicated or lost durable effects';
    end if;
  end $$;
}
step "verify_submission"
{
  do $$ begin
    if (select count(*) from public.form_submissions where form_id=(select id from notification_race.ids where label='form'))<>1
      or (select count(*) from public.form_submission_values where submission_id in(
        select id from public.form_submissions where form_id=(select id from notification_race.ids where label='form')))<>1
      or (select count(*) from public.notifications where tenant_id='d6280000-0000-4000-8000-000000000010'
        and event_key like 'intake-submitted:%')<>1 then
      raise exception 'Concurrent submission replay duplicated or lost durable effects';
    end if;
  end $$;
}

permutation "first_begin" "first_purchase" "retry_begin" "retry_purchase" "first_commit" "retry_commit" "verify_purchase"
  "first_begin" "first_submit" "retry_begin" "retry_submit" "first_commit" "retry_commit" "verify_submission"
