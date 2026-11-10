-- Preserve the installed owner, grants, security settings, and singleton-safe updates.
-- Only change the evidence envelope and isolate the two expected ingest rejections.
do $migration$
declare
 original record;
 changed record;
 definition text;
 needle text;
 replacement text;
 line_break text;
 matches integer;
begin
 select p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) as body
  into original from pg_proc p
  where p.oid=to_regprocedure('public.app_apply_ticket_call_provider_page(uuid,uuid,jsonb,boolean)');
 if original.oid is null then raise exception 'Required provider page function missing'; end if;
 line_break:=case when strpos(original.body,E'\r\n')>0 then E'\r\n' else E'\n' end;
 needle:=$before$
   if mapped then
    perform public.app_ingest_ticket_call_evidence(jsonb_build_object('account','wolfforge','callId',c.id,
     'eventId','rest:'||(m->>'id'),'meetingId',m->>'id','endedAt',greatest(c.accepted_at,case when c.duration_policy='manual' then finish_at else least(finish_at,c.expires_at) end),'intervals',intervals),false);
    -- Coarse history may omit a short participant; it cannot erase stronger live presence evidence.
    if c.answered_at is not null then update private.ticket_calls set answered_at=coalesce(answered_at,c.answered_at) where id=c.id; end if;
   else
$before$;
 replacement:=$after$
   if mapped then
    begin
     -- Daily rounds meeting and participant durations independently.
     perform public.app_ingest_ticket_call_evidence(jsonb_build_object('account','wolfforge','callId',c.id,
      'eventId','rest:'||(m->>'id'),'meetingId',m->>'id','endedAt',greatest(c.accepted_at,case when c.duration_policy='manual' then finish_at else least(finish_at,c.expires_at) end,
       (select max((item->>'leftAt')::timestamptz) from jsonb_array_elements(intervals) item)),'intervals',intervals),false);
    exception when sqlstate '22023' or sqlstate '42501' then
     -- Roll back this meeting's entire ingest before charging the conservative bound.
     mapped:=false;
    end;
    -- Coarse history may omit a short participant; it cannot erase stronger live presence evidence.
    if mapped and c.answered_at is not null then update private.ticket_calls set answered_at=coalesce(answered_at,c.answered_at) where id=c.id; end if;
   end if;
   if not mapped then
$after$;
 -- Match the installed body without rewriting unrelated line endings.
 needle:=replace(replace(needle,E'\r\n',E'\n'),E'\n',line_break);
 replacement:=replace(replace(replacement,E'\r\n',E'\n'),E'\n',line_break);
 matches:=(length(original.body)-length(replace(original.body,needle,'')))/length(needle);
 if matches<>1 then raise exception 'Provider page source differs from reviewed evidence update'; end if;
 definition:=replace(original.body,needle,replacement);
 execute definition;
 select p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) as body
  into changed from pg_proc p where p.oid=original.oid;
 if changed.proowner is distinct from original.proowner or changed.proacl is distinct from original.proacl
  or changed.proconfig is distinct from original.proconfig or changed.prosecdef is distinct from original.prosecdef
  or changed.body is distinct from definition then
  raise exception 'Provider page metadata or source changed unexpectedly';
 end if;
end $migration$;
