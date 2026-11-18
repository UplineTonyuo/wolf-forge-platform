-- Operator-controlled, like the existing profile pilot. A tenant entry removes
-- only the pilot restriction; membership, resource access and budgets still apply.
alter table private.ticket_call_environment
  add column rollout_tenant_ids uuid[] not null default '{}';

-- Amend only the existing pilot predicates, retaining any later changes to the
-- surrounding authorization functions. Abort atomically on unexpected definitions.
do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('private.ticket_call_profile_allowed(uuid,uuid,boolean)'::regprocedure,
     'env.pilot_profile_ids is null or p_profile=any(env.pilot_profile_ids)',
     'ticket.tenant_id=any(env.rollout_tenant_ids)'),
    ('private.order_call_profile_allowed(uuid,uuid,boolean)'::regprocedure,
     'e.pilot_profile_ids is null or p_profile=any(e.pilot_profile_ids)',
     'o.tenant_id=any(e.rollout_tenant_ids)'),
    ('private.ticket_call_signal_allowed(text)'::regprocedure,
     'pilot_profile_ids is null or auth.uid()=any(pilot_profile_ids)',
     'tenant=any(rollout_tenant_ids)')
  ) as edits(signature, old_predicate, tenant_predicate)
  loop
    definition := pg_get_functiondef(change.signature);
    if array_length(string_to_array(definition, change.old_predicate), 1) <> 2 then
      raise exception 'Unexpected pilot predicate in %', change.signature;
    end if;
    execute replace(definition, change.old_predicate,
      '(' || change.old_predicate || ' or ' || change.tenant_predicate || ')');
  end loop;
end
$migration$;
