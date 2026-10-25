create function public.app_get_intake_follow_up(p_submission_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $function$
declare result text;
begin
  if private.can_read_form_submission(p_submission_id) is not true then raise exception 'Form response access denied' using errcode='42501'; end if;
  select status into result from private.intake_submission_jobs where submission_id=p_submission_id;
  return coalesce(result,'not_required');
end;
$function$;
revoke all on function public.app_get_intake_follow_up(uuid) from public,anon,service_role;
grant execute on function public.app_get_intake_follow_up(uuid) to authenticated;

create or replace function private.attest_form_signature() returns trigger language plpgsql security definer set search_path = '' as $function$
declare prior jsonb;
begin
  if new.field_type_snapshot <> 'signature' then return new; end if;
  select original.value into prior from public.form_submissions as current_revision
    join public.form_submission_values as original on original.submission_id = current_revision.supersedes_submission_id
      and original.stable_field_key = new.stable_field_key
    where current_revision.id = new.submission_id;
  if found then
    if prior is distinct from new.value then raise exception 'An existing signature cannot be replaced by a correction' using errcode='23514'; end if;
    return new;
  end if;
  if jsonb_typeof(new.value) <> 'object' or new.value - array['name','consent'] <> '{}'::jsonb
    or jsonb_typeof(new.value->'name') is distinct from 'string' or length(btrim(new.value->>'name')) not between 1 and 200
    or new.value->'consent' is distinct from 'true'::jsonb then
    raise exception 'A signature requires your full name and consent' using errcode='23514'; end if;
  new.value := new.value || jsonb_build_object('signed_at', now(), 'profile_id', auth.uid(), 'method','typed_name',
    'statement','I agree to use my typed name as my electronic signature for this form.');
  return new;
end;
$function$;
