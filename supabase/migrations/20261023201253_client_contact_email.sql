create table private.client_contact_emails (
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid not null references public.profiles(id),
  contact_id uuid not null references public.client_contacts(id),
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'sending' check (status in ('sending', 'accepted', 'uncertain')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (status <> 'accepted' or provider_message_id is not null)
);
alter table private.client_contact_emails enable row level security;
revoke all on private.client_contact_emails from public, anon, authenticated, service_role;

create function public.app_server_claim_contact_email(
  p_actor_id uuid, p_tenant_id uuid, p_request_id uuid, p_contact_id uuid, p_subject text, p_body text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare existing private.client_contact_emails; recipient text;
begin
  perform private.require_client_welcome_sender(p_actor_id, p_tenant_id);
  if not exists (select 1 from public.tenants where id = p_tenant_id and status = 'active' and archived_at is null) then
    raise exception 'tenant unavailable' using errcode = '42501'; end if;
  if p_request_id is null or p_contact_id is null or length(btrim(p_subject)) not between 1 and 200
    or p_subject ~ E'[\r\n]' or p_subject is null or p_body is null or length(btrim(p_body)) not between 1 and 50000 then
    raise exception 'invalid email' using errcode = '22023'; end if;
  select contact.email into recipient from public.client_contacts as contact
  join public.companies as company on company.id = contact.company_id
  where contact.id = p_contact_id and contact.archived_at is null
    and company.tenant_id = p_tenant_id and company.archived_at is null;
  if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or recipient ~ E'[\r\n]' then
    raise exception 'contact has no valid email' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into existing from private.client_contact_emails where request_id = p_request_id;
  if found then
    if existing.actor_id <> p_actor_id or existing.tenant_id <> p_tenant_id or existing.contact_id <> p_contact_id
      or existing.subject <> p_subject or existing.body <> p_body then
      raise exception 'email request conflict' using errcode = '23505'; end if;
    return jsonb_build_object('outcome', existing.status);
  end if;
  perform private.consume_rate_limit('contact.email.actor.minute', p_actor_id::text, interval '1 minute', 10);
  perform private.consume_rate_limit('contact.email.actor.hour', p_actor_id::text, interval '1 hour', 60);
  insert into private.client_contact_emails(request_id, tenant_id, actor_id, contact_id, recipient, subject, body)
    values (p_request_id, p_tenant_id, p_actor_id, p_contact_id, recipient, p_subject, p_body);
  return jsonb_build_object('outcome', 'claimed', 'recipient', recipient);
end;
$function$;

create function public.app_server_finish_contact_email(
  p_actor_id uuid, p_tenant_id uuid, p_request_id uuid, p_provider_message_id text default null
) returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform private.require_client_welcome_sender(p_actor_id, p_tenant_id);
  if p_provider_message_id is not null and length(btrim(p_provider_message_id)) not between 1 and 512 then
    raise exception 'invalid provider result' using errcode = '22023'; end if;
  update private.client_contact_emails set status = case when p_provider_message_id is null then 'uncertain' else 'accepted' end,
    provider_message_id = p_provider_message_id, finished_at = now()
  where request_id = p_request_id and actor_id = p_actor_id and tenant_id = p_tenant_id and status = 'sending';
  if not found then raise exception 'email attempt unavailable' using errcode = '22023'; end if;
end;
$function$;
revoke all on function public.app_server_claim_contact_email(uuid, uuid, uuid, uuid, text, text),
  public.app_server_finish_contact_email(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.app_server_claim_contact_email(uuid, uuid, uuid, uuid, text, text),
  public.app_server_finish_contact_email(uuid, uuid, uuid, text) to service_role;
