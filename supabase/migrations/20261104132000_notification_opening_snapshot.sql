-- A deliberate opening owns one immutable server snapshot, independent of the 50-row feed.
create table private.notification_openings (
  profile_id uuid not null references public.profiles(id),
  tenant_id uuid not null references public.tenants(id),
  request_id uuid not null,
  requested_at timestamptz not null,
  snapshot_at timestamptz not null default clock_timestamp(),
  read_count integer,
  primary key(profile_id,tenant_id,request_id)
);
create index notification_openings_expiry on private.notification_openings(profile_id,requested_at);
alter table private.notification_openings enable row level security;
alter table private.notification_openings force row level security;
revoke all on private.notification_openings from public,anon,authenticated,service_role;

-- Same visibility predicates as the canonical feed; no caller-chosen actor or Tenant.
create function private.client_notification_visible(n public.notifications) returns boolean
language sql stable security definer set search_path='' as $$
select n.recipient_profile_id=auth.uid() and n.audience='client'
 and private.profile_account_class(auth.uid())='client'
 and (n.tenant_id is null or n.tenant_id=private.current_tenant_id())
 and (n.entity_type is null or n.entity_type not in ('order','order_task') or
   (private.profile_has_permission_in_tenant(auth.uid(),coalesce(n.tenant_id,private.current_tenant_id()),'projects.view')
    and coalesce(private.activity_event_parent_tenant_id(n.entity_type,n.entity_id),private.current_tenant_id())=private.current_tenant_id()))
 and (n.entity_type is distinct from 'ticket' or
   (private.tenant_module_allowed(coalesce(n.tenant_id,private.current_tenant_id()),'tickets')
    and not exists(select 1 from public.tickets t where t.id=n.entity_id and not private.can_access_ticket(t.id))))
 and private.purchase_intake_notification_visible(auth.uid(),n.event_key,n.entity_type,n.entity_id)
 and private.coupon_notification_visible(n.entity_type,n.entity_id,n.category)
 and private.financial_notification_visible(n.entity_type,n.entity_id,n.category,n.company_id)
 and (n.entity_type is distinct from 'subscription' or
   (private.activity_event_parent_tenant_id('subscription',n.entity_id)=private.current_tenant_id()
    and (private.tenant_module_allowed(private.current_tenant_id(),'subscriptions') or private.can_read_subscription(n.entity_id))))
 and private.profile_has_permission(auth.uid(),private.notification_category_permission(n.audience,n.category));
$$;
revoke all on function private.client_notification_visible(public.notifications) from public,anon,authenticated,service_role;

create function public.app_client_notification_feed() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=private.require_active_notification_actor(); items jsonb; unread bigint;
begin
 if private.profile_account_class(caller)<>'client' then raise insufficient_privilege; end if;
 select count(*) into unread from public.notifications n
  where n.recipient_profile_id=caller and n.audience='client' and n.read_at is null and private.client_notification_visible(n);
 select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into items from public.app_list_my_notifications(50) n;
 return jsonb_build_object('notifications',items,'unreadCount',unread);
end $$;

create function public.app_open_client_notifications(p_request_id uuid,p_requested_at timestamptz) returns jsonb
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
revoke all on function public.app_client_notification_feed(),public.app_open_client_notifications(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.app_client_notification_feed(),public.app_open_client_notifications(uuid,timestamptz) to authenticated;
