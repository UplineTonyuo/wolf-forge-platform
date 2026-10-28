begin;
select no_plan();
select ok(not has_function_privilege('anon','public.app_ticket_call(text,uuid,uuid,uuid,text)','execute'),'legacy API has no anonymous access');
select ok(not has_function_privilege('authenticated','public.app_complete_ticket_call_setup(uuid)','execute'),'client cannot assert provider setup');
select ok(not has_function_privilege('service_role','public.app_complete_ticket_call_setup(uuid)','execute'),'obsolete setup cannot bypass new lifecycle');
set local role authenticated;
select throws_ok('select * from private.ticket_calls','42501',null,'no direct call table access');
select throws_ok($q$select public.app_ticket_call('reserve',gen_random_uuid(),gen_random_uuid(),null,'audio')$q$,
  '42501','Use the invitation API','legacy reserve cannot bypass selected callee');
select throws_ok($q$select public.app_ticket_call('join',gen_random_uuid(),null,gen_random_uuid(),null)$q$,
  '42501','Use the invitation API','legacy join cannot take vacant slot');
select throws_ok($q$select public.app_ticket_call('status',gen_random_uuid())$q$,
  '42501','Use the invitation API','legacy status cannot discover calls');
reset role;
select * from finish();
rollback;