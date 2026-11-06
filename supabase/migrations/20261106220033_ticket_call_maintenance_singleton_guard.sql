-- Preserve the production safe-update guard, function owners, and API grants.
-- Only the singleton environment row is eligible for these maintenance writes.
do $migration$
declare
 target record;
 original record;
 changed record;
 definition text;
 matches integer;
begin
 for target in select * from (values
  ('public.app_claim_manual_call_checks()',
   'update private.ticket_call_environment set manual_maintenance_at=stamp;',
   'update private.ticket_call_environment set manual_maintenance_at=stamp where singleton=true;',1),
  ('public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)',
   'update private.ticket_call_environment set enabled=false,account_exclusive=false;',
   'update private.ticket_call_environment set enabled=false,account_exclusive=false where singleton=true;',2)
 ) as edits(signature,needle,replacement,expected) loop
  select p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) as body
   into original from pg_proc p where p.oid=to_regprocedure(target.signature);
  if original.oid is null then raise exception 'Required maintenance function missing'; end if;
  matches:=(length(original.body)-length(replace(original.body,target.needle,'')))/length(target.needle);
  if matches<>target.expected then raise exception 'Maintenance source differs from reviewed update'; end if;
  definition:=replace(original.body,target.needle,target.replacement);
  execute definition;
  select p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) as body
   into changed from pg_proc p where p.oid=original.oid;
  if changed.proowner is distinct from original.proowner or changed.proacl is distinct from original.proacl
   or changed.proconfig is distinct from original.proconfig or changed.prosecdef is distinct from original.prosecdef
   or changed.body is distinct from definition then
   raise exception 'Maintenance function metadata or source changed unexpectedly';
  end if;
 end loop;
end $migration$;
