-- Standalone rollback-only checks; runs without Docker or a pgTAP installation.
begin;
set local statement_timeout = '30s';
set local plpgsql.check_asserts = on;

insert into auth.users (id, aud, role, email, created_at, updated_at)
select md5('top-services-qa:actor:' || n)::uuid, 'authenticated', 'authenticated',
  'top-services-qa-' || n || '@example.invalid', now(), now()
from generate_series(1, 3) n;

update public.profiles p set role_id = r.id from public.roles r
where p.id in (select md5('top-services-qa:actor:' || n)::uuid from generate_series(1, 3) n)
  and r.name = 'owner';

insert into public.tenants (id, slug, display_name, status)
select md5('top-services-qa:tenant:' || n)::uuid, 'top-services-qa-' || n, 'Top services QA ' || n, 'active'
from generate_series(1, 2) n;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, archived_at)
select md5('top-services-qa:tenant:' || case when n = 2 then 2 else 1 end)::uuid,
  md5('top-services-qa:actor:' || n)::uuid, 'internal', r.id,
  case when n = 3 then now() else null end
from generate_series(1, 3) n cross join public.roles r where r.name = 'owner';

insert into public.companies (id, tenant_id, name, status)
select md5('top-services-qa:company:' || n)::uuid, md5('top-services-qa:tenant:' || n)::uuid,
  'Top services QA company ' || n, 'client' from generate_series(1, 2) n;

insert into public.services (id, tenant_id, name, price, currency, is_active, is_public, recurring, sort_order)
select md5('top-services-qa:service:' || n)::uuid,
  md5('top-services-qa:tenant:' || case when n = 7 then 2 else 1 end)::uuid,
  'QA Service ' || n, 1, 'USD', true, true, false, n
from generate_series(1, 7) n;

insert into public.orders (id, tenant_id, company_id, service_id, title)
select md5('top-services-qa:order:' || i || ':' || j)::uuid,
  md5('top-services-qa:tenant:1')::uuid, md5('top-services-qa:company:1')::uuid,
  md5('top-services-qa:service:' || i)::uuid, 'Top services QA order'
from generate_series(1, 6) i cross join lateral generate_series(1, 7 - i) j
union all
select md5('top-services-qa:extra:' || n)::uuid,
  md5('top-services-qa:tenant:' || case when n <= 3 then 2 else 1 end)::uuid,
  md5('top-services-qa:company:' || case when n <= 3 then 2 else 1 end)::uuid,
  md5('top-services-qa:service:' || case when n <= 3 then 7 else 6 end)::uuid, 'Top services QA extra'
from generate_series(1, 6) n;

insert into public.invoices (id, tenant_id, company_id, status, currency, billing_reason,
  subtotal_cents, discount_total_cents, tax_total_cents, total_cents, created_by_profile_id, updated_by_profile_id)
select md5('top-services-qa:invoice:' || n)::uuid,
  md5('top-services-qa:tenant:' || case when n = 2 then 2 else 1 end)::uuid,
  md5('top-services-qa:company:' || case when n = 2 then 2 else 1 end)::uuid,
  'draft', 'USD', 'manual', amount, 0, 0, amount,
  md5('top-services-qa:actor:' || case when n = 2 then 2 else 1 end)::uuid,
  md5('top-services-qa:actor:' || case when n = 2 then 2 else 1 end)::uuid
from (values (1, 2100), (2, 300), (3, 0), (4, 100), (5, 100)) v(n, amount);

insert into public.invoice_items (invoice_id, service_id, order_id, position, name, quantity,
  unit_price_cents, unit_discount_cents, is_taxable, fulfillment_status)
select md5('top-services-qa:invoice:1')::uuid, md5('top-services-qa:service:' || i)::uuid,
  md5('top-services-qa:order:' || i || ':' || j)::uuid, (row_number() over (order by i, j))::int,
  'QA Service ' || i, 1, 100, 0, false, 'provisioned'
from generate_series(1, 6) i cross join lateral generate_series(1, 7 - i) j
union all
select md5('top-services-qa:invoice:' || case when n <= 3 then 2 else n - 1 end)::uuid,
  md5('top-services-qa:service:' || case when n <= 3 then 7 else 6 end)::uuid,
  md5('top-services-qa:extra:' || n)::uuid, n, 'QA extra', 1,
  case when n = 4 then 0 else 100 end, 0, false, 'provisioned'
from generate_series(1, 6) n;

update public.invoices set status = case when id = md5('top-services-qa:invoice:4')::uuid then 'unpaid' else 'paid' end,
  invoice_number = 987600 + v.n, issued_at = '2001-04-05 11:00:00+00',
  archived_at = case when v.n = 5 then now() else null end
from generate_series(1, 5) v(n) where id = md5('top-services-qa:invoice:' || v.n)::uuid;

insert into public.invoice_payments (id, invoice_id, amount_cents, currency, status, payment_method,
  settled_at, request_id, created_by_profile_id)
select md5('top-services-qa:payment:' || n)::uuid, md5('top-services-qa:invoice:' || inv)::uuid,
  amount, 'USD', 'succeeded', 'manual', settled::timestamptz,
  md5('top-services-qa:request:' || n)::uuid,
  md5('top-services-qa:actor:' || case when inv = 2 then 2 else 1 end)::uuid
from (values (1, 1, 1000, '2001-04-05 11:15:00+00'), (2, 1, 1100, '2001-04-05 11:30:00+00'),
  (3, 2, 300, '2001-04-05 11:30:00+00'), (4, 4, 50, '2001-04-05 11:30:00+00'),
  (5, 5, 100, '2001-04-05 11:30:00+00')) v(n, inv, amount, settled);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';

do $test$
declare
  ranking jsonb;
  expected jsonb;
  state text;
  invalid record;
  actor int;
begin
  perform set_config('request.jwt.claim.sub', md5('top-services-qa:actor:1')::uuid::text, true);
  perform set_config('request.headers', jsonb_build_object('x-wf-tenant', md5('top-services-qa:tenant:1')::uuid)::text, true);
  ranking := public.app_dashboard_top_services('2001-04-05 10:00Z', '2001-04-05 12:00Z');
  select jsonb_agg(jsonb_build_object('service_id', md5('top-services-qa:service:' || n)::uuid,
    'name', 'QA Service ' || n, 'paid_orders', 7 - n) order by n) into expected from generate_series(1, 5) n;
  assert ranking = expected, 'Exact top five, count descending, tie alphabetical, tenant isolation, distinct orders and split payments';
  assert public.app_dashboard_top_services('2001-04-05 11:30Z', '2001-04-05 12:00Z') = expected, 'Start is inclusive';
  assert public.app_dashboard_top_services('2001-04-05 11:29Z', '2001-04-05 11:30Z') = '[]'::jsonb, 'End is exclusive';
  assert public.app_dashboard_top_services('2001-04-05 11:14Z', '2001-04-05 11:16Z') = '[]'::jsonb, 'Latest successful settlement determines paid date';
  assert public.app_dashboard_top_services('2000-01-01Z', '2000-01-02Z') = '[]'::jsonb, 'Empty period';
  ranking := public.app_dashboard_top_services('2001-04-05 10:59Z', '2001-04-05 11:01Z');
  assert ranking = jsonb_build_array(jsonb_build_object('service_id', md5('top-services-qa:service:6')::uuid,
    'name', 'QA Service 6', 'paid_orders', 1)), 'Free paid order uses issued date without a payment';

  for invalid in select * from (values (null::timestamptz, now()), (now(), null::timestamptz),
    (now(), now()), (now(), now() - interval '1 day'), (now(), now() + interval '367 days'),
    ('-infinity'::timestamptz, now()), (now(), 'infinity'::timestamptz)) v(a, b)
  loop
    state := null;
    begin perform public.app_dashboard_top_services(invalid.a, invalid.b);
    exception when others then state := sqlstate; end;
    assert state = '22023', 'Invalid range rejected with 22023';
  end loop;

  perform set_config('request.jwt.claim.sub', md5('top-services-qa:actor:2')::uuid::text, true);
  perform set_config('request.headers', jsonb_build_object('x-wf-tenant', md5('top-services-qa:tenant:2')::uuid)::text, true);
  assert public.app_dashboard_top_services('2001-04-05 10:00Z', '2001-04-05 12:00Z') =
    jsonb_build_array(jsonb_build_object('service_id', md5('top-services-qa:service:7')::uuid,
      'name', 'QA Service 7', 'paid_orders', 3)), 'Tenant B receives only its three orders';

  for actor in 2..3 loop
    perform set_config('request.jwt.claim.sub', md5('top-services-qa:actor:' || actor)::uuid::text, true);
    perform set_config('request.headers', jsonb_build_object('x-wf-tenant', md5('top-services-qa:tenant:1')::uuid)::text, true);
    state := null;
    begin perform public.app_dashboard_top_services('2001-04-05 10:00Z', '2001-04-05 12:00Z');
    exception when others then state := sqlstate; end;
    assert state = '42501', 'Nonmember and archived member denied';
  end loop;

  perform set_config('request.jwt.claim.sub', 'e6cfa06d-666d-4629-9591-ddc6a55b5798', true);
  perform set_config('request.headers', '', true);
  state := null;
  begin perform public.app_dashboard_top_services('2001-04-05 10:00Z', '2001-04-05 12:00Z');
  exception when others then state := sqlstate; end;
  assert state = '42501', 'Studio client cannot read internal dashboard ranking';
end;
$test$;

reset role;
do $test$ begin
  assert not has_function_privilege('anon', 'public.app_dashboard_top_services(timestamptz,timestamptz)', 'execute'), 'Anonymous execute denied';
end; $test$;
rollback;
select 'All dashboard top-services assertions passed; fixture transaction rolled back.' as result;
