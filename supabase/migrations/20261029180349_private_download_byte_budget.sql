-- F6: aggregate private file transfer, shared by intake and Ticket/Project
-- downloads. Exact trailing 24h accounting, not calendar-day/fixed windows.
-- Server constants below use decimal MB/GB. Tune only through a migration.
create table private.private_download_byte_counters (
  scope text not null check (scope in ('actor', 'tenant')),
  subject uuid not null,
  consumed_at timestamptz not null,
  bytes bigint not null check (bytes > 0),
  primary key (scope, subject, consumed_at)
);

alter table private.private_download_byte_counters enable row level security;
alter table private.private_download_byte_counters force row level security;
revoke all on table private.private_download_byte_counters from public, anon, authenticated, service_role;

comment on table private.private_download_byte_counters is
  'Durable rolling-24h byte reservations. Only the trusted download budget RPC writes these counters; expired rows are pruned on the next use of that subject.';

create function public.app_consume_private_download_byte_budget(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_bytes bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_budget constant bigint := 500000000; -- 500 MB per account, across Tenants.
  tenant_budget constant bigint := 10000000000; -- 10 GB across accounts.
  consumed_time timestamptz;
  actor_bytes bigint;
  tenant_bytes bigint;
begin
  if p_actor_id is null or p_tenant_id is null or p_bytes is null or p_bytes <= 0 then
    raise exception 'authorized download metadata required' using errcode = '22023';
  end if;

  -- Consistent lock order serializes both existing and first-use subjects.
  -- Hash collisions only serialize unrelated reservations; they cannot bypass a cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('download.tenant:' || p_tenant_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('download.actor:' || p_actor_id::text, 0));
  consumed_time := clock_timestamp();

  delete from private.private_download_byte_counters
  where ((scope = 'actor' and subject = p_actor_id) or (scope = 'tenant' and subject = p_tenant_id))
    and consumed_at <= consumed_time - interval '24 hours';

  select coalesce(sum(bytes), 0) into actor_bytes
  from private.private_download_byte_counters
  where scope = 'actor' and subject = p_actor_id;
  select coalesce(sum(bytes), 0) into tenant_bytes
  from private.private_download_byte_counters
  where scope = 'tenant' and subject = p_tenant_id;

  -- Subtraction avoids overflowing bigint for an oversized attempted reservation.
  -- Raising rolls back both dimensions and cleanup; denied requests consume neither.
  if p_bytes > actor_budget - actor_bytes or p_bytes > tenant_budget - tenant_bytes then
    raise exception 'rate limit exceeded'
      using errcode = 'WF429', hint = 'Too many requests. Please wait and try again.';
  end if;

  insert into private.private_download_byte_counters as counter (scope, subject, consumed_at, bytes)
  values ('actor', p_actor_id, consumed_time, p_bytes), ('tenant', p_tenant_id, consumed_time, p_bytes)
  on conflict (scope, subject, consumed_at) do update set bytes = counter.bytes + excluded.bytes;
end;
$$;

revoke all on function public.app_consume_private_download_byte_budget(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.app_consume_private_download_byte_budget(uuid, uuid, bigint) to service_role;
comment on function public.app_consume_private_download_byte_budget(uuid, uuid, bigint) is
  'Service-role-only atomic reservation of authorized file size before Storage: 500 MB/account, 10 GB/Tenant over a rolling 24h, shared across intake and Ticket/Project routes. WF429 maps to RATE_LIMITED. No refund after provider failures. Existing count limits remain separate.';

-- Add accounting metadata only after the existing authorization succeeds.
-- Preserve the current Ticket and native Project dispatch and all access checks.
create or replace function public.app_get_ticket_attachment_download(p_attachment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ticket_attachment public.ticket_attachments; ticket_row public.tickets;
  ticket_message public.ticket_messages; project_attachment public.project_attachments; actor record;
begin
  select * into ticket_attachment from public.ticket_attachments where id = p_attachment_id;
  if ticket_attachment.id is not null then
    if ticket_attachment.scan_status <> 'clean' then raise exception 'Ticket attachment not found' using errcode = 'P0002'; end if;
    ticket_row := private.require_ticket_access(ticket_attachment.ticket_id);
    if ticket_row.order_id is not null then perform private.require_order_conversation_access(ticket_row.order_id); end if;
    select * into actor from private.current_ticket_actor();
    select * into ticket_message from public.ticket_messages where id = ticket_attachment.ticket_message_id;
    if actor.role_name = 'client' and (ticket_message.visibility <> 'client' or ticket_message.message_kind = 'internal_note') then
      raise exception 'Ticket attachment not found' using errcode = 'P0002';
    end if;
    return jsonb_build_object('storage_object_key', ticket_attachment.storage_object_key,
      'mime_type', ticket_attachment.mime_type, 'original_name', ticket_attachment.original_name,
      'size_bytes', ticket_attachment.size_bytes, 'tenant_id', ticket_row.tenant_id);
  end if;
  select * into project_attachment from public.project_attachments where id = p_attachment_id;
  if project_attachment.id is null or project_attachment.scan_status <> 'clean' then
    raise exception 'Ticket attachment not found' using errcode = 'P0002';
  end if;
  perform private.require_order_conversation_access(project_attachment.order_id);
  return jsonb_build_object('storage_object_key', project_attachment.storage_object_key,
    'mime_type', project_attachment.mime_type, 'original_name', project_attachment.original_name,
    'size_bytes', project_attachment.size_bytes,
    'tenant_id', (select tenant_id from public.orders where id = project_attachment.order_id));
end;
$$;

create or replace function public.app_get_intake_file(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare upload private.intake_uploads;
begin
  select * into upload from private.intake_uploads where id=p_id and ready and cleanup_claimed_at is null;
  if upload.id is null then raise no_data_found; end if;
  if upload.submission_id is null then
    if upload.profile_id is distinct from auth.uid() or upload.expires_at<=now() then raise no_data_found; end if;
    perform private.require_intake_recipient(upload.assignment_id);
  elsif not private.can_read_form_submission(upload.submission_id) then
    raise exception 'File access denied' using errcode='42501';
  end if;
  return jsonb_build_object('id',upload.id,'name',upload.original_name,'mime',upload.mime_type,'size',upload.size_bytes,'path',upload.object_key,
    'tenant_id',(select f.tenant_id from public.forms f join public.form_assignments a on a.form_id=f.id where a.id=upload.assignment_id));
end;
$function$;
