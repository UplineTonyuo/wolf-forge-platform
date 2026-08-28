begin;

select plan(27);

select has_function(
  'public', 'app_consume_server_cost_limit', array['uuid', 'text', 'uuid'],
  'authenticated application cost limiter exists'
);
select ok(not has_function_privilege('anon', 'public.app_consume_server_cost_limit(uuid,text,uuid)', 'execute'), 'anon cannot select cost-limit subjects');
select ok(not has_function_privilege('authenticated', 'public.app_consume_server_cost_limit(uuid,text,uuid)', 'execute'), 'browser-authenticated role cannot select cost-limit subjects');
select ok(has_function_privilege('service_role', 'public.app_consume_server_cost_limit(uuid,text,uuid)', 'execute'), 'trusted server can enforce cost limits');

set local role service_role;
select throws_ok(
  $$ select public.app_consume_server_cost_limit(null, 'search.global', null) $$,
  '22023', null, 'verified actor is mandatory'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000001', 'attacker.chosen', null) $$,
  '22023', null, 'action names are allowlisted instead of caller-defined scopes'
);

select lives_ok(
  $$
    do $block$ begin
      for i in 1..60 loop
        perform public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000002', 'search.global', null);
      end loop;
    end $block$
  $$,
  'global search allows its documented actor burst'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000002', 'search.global', null) $$,
  'WF429', null, 'global search burst is constrained'
);
select lives_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000003', 'search.global', null) $$,
  'one abusive authenticated user does not consume another user allowance'
);

select lives_ok(
  $$
    do $block$ begin
      for i in 1..30 loop
        perform public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000004', 'search.client', '70000000-0000-4000-8000-000000000001');
      end loop;
    end $block$
  $$,
  'client search allows its documented actor burst'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000004', 'search.client', '70000000-0000-4000-8000-000000000001') $$,
  'WF429', null, 'client search is constrained per authenticated actor'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000005', 'search.client', null) $$,
  '22023', null, 'client search cannot omit organization scope'
);
select lives_ok(
  $$
    do $block$ begin
      for i in 1..120 loop
        perform public.app_consume_server_cost_limit(
          format('61000000-0000-4000-8000-%s', lpad(to_hex(i), 12, '0'))::uuid,
          'search.client',
          '70000000-0000-4000-8000-000000000002'
        );
      end loop;
    end $block$
  $$,
  'client organization allows legitimate multi-user search activity'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000006', 'search.client', '70000000-0000-4000-8000-000000000002') $$,
  'WF429', null, 'client organization aggregate burst is constrained'
);

select lives_ok(
  $$
    do $block$ begin
      for i in 1..20 loop
        perform public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000007', 'report.send', null);
      end loop;
    end $block$
  $$,
  'report sends allow normal staff volume'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000007', 'report.send', null) $$,
  'WF429', null, 'report sends are constrained per staff actor'
);
select lives_ok(
  $$
    do $block$ begin
      for i in 1..30 loop
        perform public.app_consume_server_cost_limit(
          format('62000000-0000-4000-8000-%s', lpad(to_hex(i), 12, '0'))::uuid,
          'report.send',
          '70000000-0000-4000-8000-000000000003'
        );
      end loop;
    end $block$
  $$,
  'report recipient organization allows normal aggregate sends'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000008', 'report.send', '70000000-0000-4000-8000-000000000003') $$,
  'WF429', null, 'report recipient organization cannot receive unbounded fan-out'
);

select lives_ok(
  $$
    do $block$ begin
      for i in 1..5 loop
        perform public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000009', 'integration.gmail.verify', null);
      end loop;
    end $block$
  $$,
  'Gmail verification allows a bounded retry burst'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000009', 'integration.gmail.verify', null) $$,
  'WF429', null, 'Gmail external verification is constrained'
);

select lives_ok(
  $$
    do $block$ begin
      for i in 1..10 loop
        perform public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000010', 'account.provision', null);
      end loop;
    end $block$
  $$,
  'account provisioning allows normal administrator volume'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000010', 'account.provision', null) $$,
  'WF429', null, 'Auth Admin provisioning is constrained'
);

select lives_ok(
  $$
    do $block$ begin
      for i in 1..30 loop
        perform public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000011', 'billing.stripe_customer', format('71000000-0000-4000-8000-%s', lpad(to_hex(i), 12, '0'))::uuid);
      end loop;
    end $block$
  $$,
  'Stripe identity provisioning allows normal administrator volume'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000011', 'billing.stripe_customer', '71000000-0000-4000-8000-000000000099') $$,
  'WF429', null, 'Stripe identity provisioning is constrained per actor'
);
select lives_ok(
  $$
    do $block$ begin
      for i in 1..10 loop
        perform public.app_consume_server_cost_limit(
          format('63000000-0000-4000-8000-%s', lpad(to_hex(i), 12, '0'))::uuid,
          'billing.stripe_customer',
          '70000000-0000-4000-8000-000000000004'
        );
      end loop;
    end $block$
  $$,
  'one company allows bounded Stripe retries across administrators'
);
select throws_ok(
  $$ select public.app_consume_server_cost_limit('60000000-0000-4000-8000-000000000012', 'billing.stripe_customer', '70000000-0000-4000-8000-000000000004') $$,
  'WF429', null, 'one company cannot trigger unbounded Stripe customer calls'
);

reset role;
select ok(
  not exists (
    select 1 from private.rate_limit_counters
    where scope like 'cost.%'
      and subject !~ '^[0-9a-f-]{36}$'
  ),
  'cost counters retain only server-derived UUID subjects'
);

select * from finish();
rollback;
