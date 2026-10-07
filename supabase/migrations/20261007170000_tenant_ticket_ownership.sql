-- Wolf Forge Platform
-- White Label WL-1C.2b: Tenant ownership of Tickets.
--
-- public.tickets gains a NOT NULL tenant_id, and its Client, client person and
-- assignee references become Tenant-relative composite foreign keys, so a
-- Ticket in one Tenant cannot point at a Client or person of another Tenant,
-- even through a trusted write.
--
-- Tickets only. Messages, attachments and reactions inherit through
-- ticket_id. RLS, policies, grants, notifications, Storage paths and Ticket
-- numbering are unchanged; cross-Tenant read/write isolation is WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every Client is a Wolf Forge Client and every profile has a Wolf
-- Forge membership (WL-1A mirror). New rows then default to
-- private.identity_tenant_id():
--   signed-in app_create_ticket -> the caller's current Tenant
--   invalid or foreign selector -> NULL, the insert fails NOT NULL
-- A Contact Form Ticket never uses that default: its Tenant is the Form's.
--
-- Deliberately global: created_by_profile_id (the actor, who may be any
-- signed-in caller of a public Form), order_id, investment_service_id and the
-- form source columns, whose domains are not Tenant-owned yet or already
-- inherit the Form's Tenant.

alter table public.tickets
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint tickets_tenant_id_fkey references public.tenants (id) on delete restrict,
  drop constraint tickets_company_id_fkey,
  add constraint tickets_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete restrict,
  -- Membership in the Ticket's Tenant, not in a particular Client: a historical
  -- Ticket stays valid when its client later moves to another Client.
  drop constraint tickets_client_profile_id_fkey,
  add constraint tickets_client_profile_id_fkey
    foreign key (tenant_id, client_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete restrict,
  -- Same-Tenant only. Whether the assignee is internal stays with
  -- private.require_internal_assignee() and the permission layer.
  drop constraint tickets_assigned_to_profile_id_fkey,
  add constraint tickets_assigned_to_profile_id_fkey
    foreign key (tenant_id, assigned_to_profile_id)
    references public.tenant_memberships (tenant_id, profile_id)
    on delete restrict;

alter table public.tickets
  alter column tenant_id set default private.identity_tenant_id();

-- -----------------------------------------------------------------------------
-- Contact Form Tickets take the Tenant of the submitted Form
-- -----------------------------------------------------------------------------

-- Unchanged except for tenant_id. The submission is the trusted row written by
-- app_submit_form; its Form decides the Tenant. Caller identity, the selector
-- and the anonymous role play no part, and a submission whose company or
-- client person belongs to another Tenant fails the composite foreign keys,
-- rolling back the whole submission.
create or replace function private.create_ticket_from_contact_submission(p_submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row public.form_submissions;
  version_row public.form_versions;
  subject_key uuid;
  message_key uuid;
  subject_value text;
  message_value text;
  requester_name_value text;
  requester_email_value text;
  actor_role text;
  ticket_row public.tickets;
  message_row public.ticket_messages;
begin
  select submission.* into submission_row
  from public.form_submissions as submission
  where submission.id = p_submission_id
    and submission.orchestration_type = 'contact_ticket'
    and submission.orchestration_status = 'deferred'
  for update;
  if submission_row.id is null then
    select id into ticket_row.id from public.tickets where source_form_submission_id = p_submission_id;
    return ticket_row.id;
  end if;

  select version.* into version_row
  from public.form_versions as version
  where version.id = submission_row.form_version_id;
  if version_row.id is null then return null; end if;

  subject_key := (version_row.type_config ->> 'subject_field_key')::uuid;
  message_key := (version_row.type_config ->> 'message_field_key')::uuid;
  select value #>> '{}' into subject_value
  from public.form_submission_values
  where submission_id = submission_row.id and stable_field_key = subject_key;
  select value #>> '{}' into message_value
  from public.form_submission_values
  where submission_id = submission_row.id and stable_field_key = message_key;
  if nullif(btrim(subject_value), '') is null or nullif(btrim(message_value), '') is null then
    return null;
  end if;

  select value #>> '{}' into requester_email_value
  from public.form_submission_values
  where submission_id = submission_row.id and field_type_snapshot = 'email'
  order by sort_order_snapshot limit 1;
  select coalesce(value #>> '{}', value ->> 'full') into requester_name_value
  from public.form_submission_values
  where submission_id = submission_row.id and field_type_snapshot = 'fullname'
  order by sort_order_snapshot limit 1;

  if submission_row.submitted_by_profile_id is not null then
    select role_row.name into actor_role
    from public.profiles as profile_row
    join public.roles as role_row on role_row.id = profile_row.role_id
    where profile_row.id = submission_row.submitted_by_profile_id;
  end if;

  insert into public.tickets (
    tenant_id,
    company_id, client_profile_id, requester_name, requester_email,
    subject, status, priority, created_by_profile_id,
    source_form_submission_id, source_form_version_id
  ) values (
    (select form_row.tenant_id from public.forms as form_row where form_row.id = submission_row.form_id),
    submission_row.company_id, submission_row.client_profile_id,
    nullif(btrim(requester_name_value), ''), nullif(btrim(requester_email_value), ''),
    btrim(subject_value), 'open', 'normal', submission_row.submitted_by_profile_id,
    submission_row.id, submission_row.form_version_id
  )
  on conflict (source_form_submission_id) do nothing
  returning * into ticket_row;

  if ticket_row.id is null then
    select * into ticket_row from public.tickets where source_form_submission_id = submission_row.id;
    return ticket_row.id;
  end if;

  insert into public.ticket_messages (
    ticket_id, author_profile_id, author_type, message_kind, visibility, body
  ) values (
    ticket_row.id,
    submission_row.submitted_by_profile_id,
    case when submission_row.submitted_by_profile_id is null then 'guest'
      when actor_role = 'client' then 'client' else 'internal' end,
    'initial_request', 'client', btrim(message_value)
  ) returning * into message_row;

  update public.form_submissions
  set orchestration_status = 'completed',
      provenance = provenance || jsonb_build_object('ticket_id', ticket_row.id)
  where id = submission_row.id;

  perform private.record_ticket_activity(
    ticket_row.id, 'ticket.created', 'Created Ticket from Contact Form.',
    jsonb_build_object(
      'form_submission_id', submission_row.id,
      'form_version_id', submission_row.form_version_id,
      'initial_message_id', message_row.id
    ), submission_row.submitted_by_profile_id
  );
  return ticket_row.id;
end;
$$;
