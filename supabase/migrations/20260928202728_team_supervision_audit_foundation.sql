-- Team supervision privileged-read audit foundation only.
-- No supervisory conversation read path is added by this migration.

insert into private.security_audit_event_codes (event_code, category, severity)
values ('authorization.team_supervision.read', 'authorization', 'info')
on conflict (event_code) do update
set category = excluded.category,
    severity = excluded.severity;

create or replace function private.write_team_supervision_audit(
  p_action_slug text,
  p_conversation_id uuid,
  p_result_count integer,
  p_correlation_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_supervisor();
  conversation_kind text;
  read_kind text;
begin
  read_kind := case p_action_slug
    when 'team.supervision.open' then 'open'
    when 'team.supervision.page' then 'page'
    when 'team.supervision.search' then 'search'
    else null
  end;

  if read_kind is null then
    raise exception 'invalid team supervision audit action' using errcode = '22023';
  end if;

  if p_conversation_id is null then
    raise exception 'team conversation id is required' using errcode = '22023';
  end if;

  if p_result_count is null or p_result_count < 0 or p_result_count > 1000 then
    raise exception 'team supervision audit result count must be between 0 and 1000'
      using errcode = '22023';
  end if;

  if p_correlation_id is not null
    and p_correlation_id !~ '^[0-9a-f]{32}$'
  then
    raise exception 'invalid correlation id' using errcode = '22023';
  end if;

  select conversation_row.kind
  into conversation_kind
  from public.team_conversations as conversation_row
  where conversation_row.id = p_conversation_id;

  if conversation_kind is null then
    raise exception 'team conversation not found' using errcode = 'P0002';
  end if;

  insert into public.security_audit_events (
    event_code,
    actor_profile_id,
    actor_class,
    action_slug,
    resource_type,
    resource_id,
    outcome,
    correlation_id,
    metadata
  )
  values (
    'authorization.team_supervision.read',
    actor_id,
    'internal',
    p_action_slug,
    'team_conversation',
    p_conversation_id,
    'succeeded',
    p_correlation_id,
    pg_catalog.jsonb_build_object(
      'read_kind', read_kind,
      'conversation_kind', conversation_kind,
      'result_count', p_result_count
    )
  );
end;
$$;

revoke all on function private.write_team_supervision_audit(text, uuid, integer, text)
from public, anon, authenticated, service_role;

comment on function private.write_team_supervision_audit(text, uuid, integer, text)
is 'Appends one successful, capability-checked Team supervision read audit event. Intended only for postgres-owned supervisory SECURITY DEFINER RPCs; accepts no actor or arbitrary metadata.';
