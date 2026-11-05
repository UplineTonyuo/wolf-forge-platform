-- A deliberate opening freezes eligible row versions before its serialization wait.
-- Timestamp alone cannot exclude a later commit from an older producer transaction.
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
 without_tickets bigint; without_projects bigint; without_conversations bigint;
begin
 if private.profile_account_class(caller)<>'client' then raise insufficient_privilege; end if;
 select count(*),
  count(*) filter(where n.category is distinct from 'ticket' and n.entity_type is distinct from 'ticket'),
  count(*) filter(where n.entity_type is distinct from 'order' and n.entity_type is distinct from 'order_task'),
  count(*) filter(where n.category is distinct from 'ticket' and n.entity_type is distinct from 'ticket'
   and n.entity_type is distinct from 'order' and n.entity_type is distinct from 'order_task')
  into unread,without_tickets,without_projects,without_conversations from public.notifications n
  where n.recipient_profile_id=caller and n.audience='client' and n.read_at is null and private.client_notification_visible(n);
 select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) into items from public.app_list_my_notifications(50) n;
 return jsonb_build_object('notifications',items,'unreadCount',unread,'unreadCounts',
  jsonb_build_object('withoutTickets',without_tickets,'withoutProjects',without_projects,'withoutConversations',without_conversations));
end $$;

create function public.app_open_client_notifications(p_request_id uuid,p_requested_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid:=private.require_active_notification_actor(); tenant uuid:=private.current_tenant_id();
 receipt private.notification_openings; changed integer; stamp timestamptz:=clock_timestamp(); candidates jsonb;
begin
 if private.profile_account_class(caller)<>'client' then raise insufficient_privilege; end if;
 if p_request_id is null or p_requested_at is null or p_requested_at<stamp-interval '1 day' or p_requested_at>stamp+interval '5 minutes' then
  raise exception 'Opening request expired or invalid' using errcode='22023'; end if;
 -- ONE statement owns the pre-wait MVCC snapshot even if rate admission waits.
 -- CASE admits first: a refused request never scans/collects the unread rows.
 -- Keep only IDs/system versions in memory; no feed limit, new durable rows or producer changes.
 -- xmin alone is insufficient for multiple versions written by the same transaction.
 select case when private.consume_rate_limit('notification-open',caller::text,interval '1 minute',60)>0 then
  (select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'row_xmin',n.xmin::text,'row_ctid',n.ctid::text)),'[]'::jsonb)
   from public.notifications n
   where n.recipient_profile_id=caller and n.audience='client' and n.read_at is null
    and n.created_at<=stamp and private.client_notification_visible(n))
  else '[]'::jsonb end into candidates;
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
   from jsonb_to_recordset(candidates) as seen(id uuid,row_xmin text,row_ctid text)
   where n.id=seen.id and n.xmin::text=seen.row_xmin and n.ctid::text=seen.row_ctid
    and n.recipient_profile_id=caller and n.audience='client' and n.read_at is null
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

-- Preserve selected-client support notification access through the existing capability boundary.
do $migration$
declare target oid:='private.client_support_operation_allowed(text,text)'::regprocedure;
 original text; replacement text; owner_before oid; acl_before aclitem[];
 needle text:=$entry$'app_list_my_notifications',$entry$;
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if (length(original)-length(replace(original,needle,'')))/length(needle)<>1
  or position('app_client_notification_feed' in original)>0 or position('app_open_client_notifications' in original)>0 then
  raise exception 'Unexpected support operation baseline'; end if;
 replacement:=replace(original,needle,$entry$'app_list_my_notifications','app_client_notification_feed','app_open_client_notifications',$entry$);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
  raise exception 'Support operation preservation failed'; end if;
end;
$migration$;
