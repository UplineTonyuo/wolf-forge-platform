-- Drawn ink and consent are the signature. Existing named and typed evidence is retained.
create or replace function private.attest_form_signature() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare prior jsonb; drawn boolean;
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
  select coalesce(field.settings->>'signature_mode' = 'drawn', false) into drawn
    from public.form_version_fields as field where field.id = new.form_version_field_id;
  if jsonb_typeof(new.value) is distinct from 'object' or new.value->'consent' is distinct from 'true'::jsonb then
    raise exception 'A signature requires your explicit consent' using errcode='23514';
  end if;
  if drawn then
    if new.value - array['name','consent','drawing'] <> '{}'::jsonb
      or private.valid_form_signature_drawing(new.value->'drawing') is not true then
      raise exception 'Draw your signature before submitting' using errcode='23514'; end if;
    if new.value ? 'name' and (jsonb_typeof(new.value->'name') is distinct from 'string'
      or length(btrim(new.value->>'name')) not between 1 and 200) then
      raise exception 'Invalid signature name' using errcode='23514'; end if;
  elsif new.value - array['name','consent'] <> '{}'::jsonb
    or jsonb_typeof(new.value->'name') is distinct from 'string' or length(btrim(new.value->>'name')) not between 1 and 200 then
    raise exception 'A typed signature requires your full name and consent' using errcode='23514';
  end if;
  new.value := new.value || jsonb_build_object('signed_at', now(), 'profile_id', auth.uid(),
    'method', case when drawn then 'drawn' else 'typed_name' end,
    'statement', case when drawn then 'I agree to use this drawn signature as my electronic signature for this form.'
      else 'I agree to use my typed name as my electronic signature for this form.' end);
  return new;
end;
$function$;
revoke all on function private.attest_form_signature() from public, anon, authenticated, service_role;
