-- Shared across server instances, tabs, sessions and Tenant selections.
create table private.ticket_call_signal_leases (
 id uuid primary key default extensions.gen_random_uuid(),
 profile_id uuid not null references public.profiles(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 expires_at timestamptz not null,
 max_expires_at timestamptz not null,
 check (expires_at<=max_expires_at)
);
alter table private.ticket_call_signal_leases enable row level security;
alter table private.ticket_call_signal_leases force row level security;
revoke all on private.ticket_call_signal_leases from public,anon,authenticated,service_role;
create index ticket_call_signal_leases_profile on private.ticket_call_signal_leases(profile_id,session_id,expires_at);

create or replace function public.app_ticket_call_signal_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare topic text; sid uuid; stamp timestamptz; lease private.ticket_call_signal_leases;
begin
 sid:=private.ticket_call_session();
 perform private.consume_rate_limit('ticket-call-events',auth.uid()::text,interval '1 minute',12);
 topic:='ticket-calls:'||private.current_tenant_id()::text||':'||auth.uid()::text;
 if not private.ticket_call_signal_allowed(topic) then return null; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Calls require read committed isolation' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ticket-call-signals:'||auth.uid()::text,0));
 if not private.ticket_call_signal_allowed(topic) then return null; end if;
 stamp:=clock_timestamp();
 delete from private.ticket_call_signal_leases where profile_id=auth.uid() and expires_at<=stamp;
 if (select count(*)>=6 or count(*) filter(where session_id=sid)>=3
  from private.ticket_call_signal_leases where profile_id=auth.uid()) then
  raise exception 'Call stream limit reached' using errcode='WF429'; end if;
 insert into private.ticket_call_signal_leases(profile_id,session_id,tenant_id,expires_at,max_expires_at)
 values(auth.uid(),sid,private.current_tenant_id(),stamp+interval '90 seconds',stamp+interval '4 minutes') returning * into lease;
 return jsonb_build_object('topic',topic,'leaseId',lease.id,'expiresAt',lease.expires_at);
end $$;

create function public.app_ticket_call_signal_lease(p_action text,p_lease_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; stamp timestamptz; lease private.ticket_call_signal_leases; topic text;
begin
 if p_action is null or p_action not in ('renew','release') or p_lease_id is null then
  raise exception 'Invalid stream operation' using errcode='22023'; end if;
 -- Release only needs the signed identity binding, even after access/session revocation.
 begin sid:=(auth.jwt()->>'session_id')::uuid;
 exception when invalid_text_representation then return null; end;
 if p_action='release' then
  delete from private.ticket_call_signal_leases where id=p_lease_id and profile_id=auth.uid() and session_id=sid;
  return 'true'::jsonb;
 end if;
 sid:=private.ticket_call_session();
 perform private.consume_rate_limit('ticket-call-events-renew',auth.uid()::text,interval '1 minute',24);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ticket-call-signals:'||auth.uid()::text,0));
 stamp:=clock_timestamp();
 select * into lease from private.ticket_call_signal_leases where id=p_lease_id and profile_id=auth.uid()
  and session_id=sid and tenant_id=private.current_tenant_id() and expires_at>stamp and max_expires_at>stamp for update;
 if lease.id is null then return null; end if;
 topic:='ticket-calls:'||lease.tenant_id::text||':'||auth.uid()::text;
 if not private.ticket_call_signal_allowed(topic) then return null; end if;
 update private.ticket_call_signal_leases set expires_at=least(stamp+interval '90 seconds',max_expires_at)
  where id=lease.id returning * into lease;
 return jsonb_build_object('expiresAt',lease.expires_at);
end $$;
revoke all on function public.app_ticket_call_signal_context(),public.app_ticket_call_signal_lease(text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.app_ticket_call_signal_context(),public.app_ticket_call_signal_lease(text,uuid) to authenticated;
