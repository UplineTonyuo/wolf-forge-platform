-- Opt-in drawing preserves the signing method of existing published versions.
create function private.valid_form_signature_drawing(p_drawing jsonb) returns boolean
language plpgsql immutable set search_path = '' as $function$
declare stroke jsonb; point jsonb; points integer := 0; has_ink boolean := false;
begin
  if jsonb_typeof(p_drawing) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_drawing) not between 1 and 32 then return false; end if;
  for stroke in select value from jsonb_array_elements(p_drawing) loop
    if jsonb_typeof(stroke) is distinct from 'array' then return false; end if;
    if jsonb_array_length(stroke) not between 2 and 768 then return false; end if;
    points := points + jsonb_array_length(stroke);
    if points > 768 then return false; end if;
    for point in select value from jsonb_array_elements(stroke) loop
      if jsonb_typeof(point) is distinct from 'array' then return false; end if;
      if jsonb_array_length(point) <> 2 then return false; end if;
      if jsonb_typeof(point->0) is distinct from 'number' or jsonb_typeof(point->1) is distinct from 'number' then return false; end if;
      if (point->>0)::numeric not between 0 and 1000 or (point->>1)::numeric not between 0 and 400
        or trunc((point->>0)::numeric) <> (point->>0)::numeric or trunc((point->>1)::numeric) <> (point->>1)::numeric then return false; end if;
      if point <> stroke->0 then has_ink := true; end if;
    end loop;
  end loop;
  return has_ink;
end;
$function$;
revoke all on function private.valid_form_signature_drawing(jsonb) from public, anon, authenticated, service_role;

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
  if jsonb_typeof(new.value) is distinct from 'object'
    or jsonb_typeof(new.value->'name') is distinct from 'string' or length(btrim(new.value->>'name')) not between 1 and 200
    or new.value->'consent' is distinct from 'true'::jsonb then
    raise exception 'A signature requires your full name and consent' using errcode='23514';
  end if;
  if drawn then
    if new.value - array['name','consent','drawing'] <> '{}'::jsonb
      or private.valid_form_signature_drawing(new.value->'drawing') is not true then
      raise exception 'Draw your signature before submitting' using errcode='23514'; end if;
  elsif new.value - array['name','consent'] <> '{}'::jsonb then
    raise exception 'Invalid typed signature' using errcode='23514';
  end if;
  new.value := new.value || jsonb_build_object('signed_at', now(), 'profile_id', auth.uid(),
    'method', case when drawn then 'drawn' else 'typed_name' end,
    'statement', case when drawn then 'I agree to use this drawn signature as my electronic signature for this form.'
      else 'I agree to use my typed name as my electronic signature for this form.' end);
  return new;
end;
$function$;
revoke all on function private.attest_form_signature() from public, anon, authenticated, service_role;
