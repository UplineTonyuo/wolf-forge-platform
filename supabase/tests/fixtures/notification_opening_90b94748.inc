-- TEST ONLY: exact vulnerable function from90b94748, renamed into the opener session temporary schema.
-- Never a deployable migration; only the guarded disposable-runner physical regression loads it.
create function pg_temp.open_client_notifications_90(p_request_id uuid,p_requested_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=private.require_active_notification_actor(); tenant uuid:=private.current_tenant_id();
 receipt private.notification_openings; changed integer; stamp timestamptz:=clock_timestamp();
begin
 if private.profile_account_class(caller)<>'client' then raise insufficient_privilege; end if;
 if p_request_id is null or p_requested_at is null or p_requested_at<stamp-interval '1 day' or p_requested_at>stamp+interval '5 minutes' then
  raise exception 'Opening request expired or invalid' using errcode='22023'; end if;
 perform private.consume_rate_limit('notification-open',caller::text,interval '1 minute',60);
 -- Bounded receipt retention; expired request timestamps cannot recreate an opening.
 delete from private.notification_openings where profile_id=caller and requested_at<stamp-interval '1 day';
 perform pg_advisory_xact_lock(hashtextextended('notification-open:'||caller::text,0));
 select * into receipt from private.notification_openings
  where profile_id=caller and tenant_id=tenant and request_id=p_request_id for update;
 if receipt.request_id is null then
  if (select count(*) from private.notification_openings where profile_id=caller)>=300 then
   raise exception 'Opening request limit reached' using errcode='WF429'; end if;
  insert into private.notification_openings(profile_id,tenant_id,request_id,requested_at,snapshot_at)
   values(caller,tenant,p_request_id,p_requested_at,stamp) returning * into receipt;
  update public.notifications n set read_at=coalesce(n.read_at,stamp)
   where n.recipient_profile_id=caller and n.audience='client' and n.read_at is null
    and n.created_at<=receipt.snapshot_at and private.client_notification_visible(n);
  get diagnostics changed=row_count;
  update private.notification_openings set read_count=changed
   where profile_id=caller and tenant_id=tenant and request_id=p_request_id returning * into receipt;
 elsif receipt.requested_at is distinct from p_requested_at then
  raise exception 'Opening request conflicts' using errcode='22023';
 end if;
 return jsonb_build_object('requestId',receipt.request_id,'snapshotAt',receipt.snapshot_at,'readCount',receipt.read_count);
end $$;

revoke all on function pg_temp.open_client_notifications_90(uuid,timestamptz) from public,anon,service_role;
grant execute on function pg_temp.open_client_notifications_90(uuid,timestamptz) to authenticated;
