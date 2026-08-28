begin;

select plan(31);

select has_function(
  'public', 'app_login_rate_limit_preflight', array['text', 'text'],
  'login preflight RPC exists'
);
select has_function(
  'public', 'app_record_login_failure', array['text', 'text'],
  'login failure recorder RPC exists'
);
select has_function(
  'public', 'app_clear_login_pair_failures', array['text', 'text'],
  'successful-pair cleanup RPC exists'
);

select ok(not has_function_privilege('anon', 'public.app_login_rate_limit_preflight(text,text)', 'execute'), 'anon cannot spend login preflight counters');
select ok(not has_function_privilege('authenticated', 'public.app_login_rate_limit_preflight(text,text)', 'execute'), 'authenticated cannot spend login preflight counters');
select ok(has_function_privilege('service_role', 'public.app_login_rate_limit_preflight(text,text)', 'execute'), 'service role can run login preflight');
select ok(not has_function_privilege('anon', 'public.app_record_login_failure(text,text)', 'execute'), 'anon cannot record failures');
select ok(not has_function_privilege('authenticated', 'public.app_record_login_failure(text,text)', 'execute'), 'authenticated cannot record failures');
select ok(has_function_privilege('service_role', 'public.app_record_login_failure(text,text)', 'execute'), 'service role can record failures');
select ok(not has_function_privilege('anon', 'public.app_clear_login_pair_failures(text,text)', 'execute'), 'anon cannot clear cooldowns');
select ok(not has_function_privilege('authenticated', 'public.app_clear_login_pair_failures(text,text)', 'execute'), 'authenticated cannot clear cooldowns');
select ok(has_function_privilege('service_role', 'public.app_clear_login_pair_failures(text,text)', 'execute'), 'service role can clear cooldowns');
select is((select relrowsecurity from pg_class where oid = 'private.rate_limit_counters'::regclass), true, 'durable counter table has RLS');
select ok(not has_table_privilege('service_role', 'private.rate_limit_counters', 'select'), 'service role cannot inspect raw counter rows');

set local role service_role;

select throws_ok(
  $$ select public.app_login_rate_limit_preflight('raw-ip', repeat('b', 64)) $$,
  '22023', null, 'raw or malformed subjects are rejected'
);

select lives_ok($$ select public.app_record_login_failure(repeat('a', 64), repeat('b', 64)) $$, 'first credential failure is recorded');
select lives_ok($$ select public.app_record_login_failure(repeat('a', 64), repeat('b', 64)) $$, 'second credential failure is recorded');
select lives_ok($$ select public.app_record_login_failure(repeat('a', 64), repeat('b', 64)) $$, 'third credential failure is recorded');
select throws_ok(
  $$ select public.app_login_rate_limit_preflight(repeat('a', 64), repeat('b', 64)) $$,
  'WF429', null, 'the same source and identity enter progressive cooldown'
);
select lives_ok(
  $$ select public.app_login_rate_limit_preflight(repeat('c', 64), repeat('b', 64)) $$,
  'a different source is not locked out solely by knowledge of the identity'
);

select lives_ok(
  $$
    do $block$
    declare i integer;
    begin
      for i in 1..12 loop
        perform public.app_login_rate_limit_preflight(
          repeat('d', 64), lpad(to_hex(i), 64, '0')
        );
      end loop;
    end
    $block$
  $$,
  'one source may use the documented minute burst'
);
select throws_ok(
  $$ select public.app_login_rate_limit_preflight(repeat('d', 64), repeat('e', 64)) $$,
  'WF429', null, 'one malicious source cannot flood Auth indefinitely'
);

select lives_ok(
  $$
    do $block$
    declare i integer;
    begin
      for i in 1..10 loop
        perform public.app_record_login_failure(
          lpad(to_hex(4096 + i), 64, '0'), repeat('f', 64)
        );
      end loop;
    end
    $block$
  $$,
  'distributed failures against one identity are observed across sources'
);
select is(
  (public.app_login_rate_limit_preflight(repeat('1', 64), repeat('f', 64)) ->> 'identity_targeted')::boolean,
  true,
  'distributed identity pressure becomes a risk signal without becoming a denial'
);

select lives_ok(
  $$ select public.app_clear_login_pair_failures(repeat('a', 64), repeat('b', 64)) $$,
  'successful proof may clear only its source and identity pair'
);

reset role;

select is(
  (select count(*) from private.rate_limit_counters where scope like 'auth.login.pair.failure.%' and subject = repeat('a', 64) || ':' || repeat('b', 64)),
  0::bigint,
  'pair cleanup removes all cooldown windows for that pair'
);
select ok(
  (select coalesce(sum(hits), 0) from private.rate_limit_counters where scope like 'auth.login.identity.failure.%' and subject = repeat('b', 64)) > 0,
  'successful-pair cleanup retains identity risk history'
);
select ok(
  not exists (
    select 1
    from private.rate_limit_counters
    where scope like 'auth.login.%'
      and subject !~ '^[0-9a-f]{64}(:[0-9a-f]{64})?$'
  ),
  'login counters contain fingerprints only, never raw IP or email values'
);

update private.rate_limit_counters
set window_start = window_start - interval '2 hours',
    expires_at = clock_timestamp() - interval '1 hour'
where scope like 'auth.login.pair.failure.%'
  and subject = repeat('c', 64) || ':' || repeat('b', 64);

set local role service_role;
select lives_ok(
  $$ select public.app_login_rate_limit_preflight(repeat('c', 64), repeat('b', 64)) $$,
  'legitimate activity resumes after the fixed cooldown window'
);
reset role;

insert into private.rate_limit_counters(scope, subject, window_start, expires_at, hits)
values ('auth.login.test.expired', repeat('9', 64), clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour', 1);

set local role service_role;
select lives_ok(
  $$ select public.app_login_rate_limit_preflight(repeat('2', 64), repeat('3', 64)) $$,
  'a fresh bucket triggers bounded expired-row cleanup'
);
reset role;
select is(
  (select count(*) from private.rate_limit_counters where scope = 'auth.login.test.expired'),
  0::bigint,
  'expired limiter state is cleaned up instead of growing without bound'
);

select * from finish();
rollback;
