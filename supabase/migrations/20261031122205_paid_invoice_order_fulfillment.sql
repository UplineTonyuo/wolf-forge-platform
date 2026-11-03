-- New manual approvals only. Private provenance grants no general Project creation.
create table private.invoice_manual_order_fulfillments (
  invoice_item_id uuid primary key references public.invoice_items(id),
  claim_id uuid not null references private.invoice_manual_payment_claims(id),
  order_id uuid not null unique references public.orders(id) deferrable initially deferred,
  tenant_id uuid not null references public.tenants(id),
  company_id uuid not null references public.companies(id),
  service_id uuid not null references public.services(id),
  client_profile_id uuid not null references public.profiles(id),
  created_by_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table private.invoice_manual_order_fulfillments enable row level security;
alter table private.invoice_manual_order_fulfillments force row level security;
revoke all on private.invoice_manual_order_fulfillments from public,anon,authenticated,service_role;
create index invoice_manual_order_fulfillments_claim on private.invoice_manual_order_fulfillments(claim_id);

create function private.manual_invoice_order_insert_allowed(p_order public.orders) returns boolean
language sql stable security definer set search_path='' as $$
 select private.current_account_class()='internal'
  and private.current_user_has_permission('invoices.mark_paid')
  and p_order.tenant_id=private.current_tenant_id()
  and p_order.status='pending' and p_order.priority='normal'
  and p_order.assigned_to_profile_id is null and p_order.started_at is null
  and p_order.completed_at is null and p_order.archived_at is null
  and p_order.due_at is null and p_order.notes is null
  and exists(
   select 1 from private.invoice_manual_order_fulfillments origin
   join private.invoice_manual_payment_claims claim on claim.id=origin.claim_id
   join public.invoices invoice on invoice.id=claim.invoice_id
   join public.invoice_payments payment on payment.id=claim.payment_id and payment.invoice_id=invoice.id
   join public.invoice_items item on item.id=origin.invoice_item_id and item.invoice_id=invoice.id
   where origin.order_id=p_order.id and origin.created_by_profile_id=auth.uid()
    and origin.tenant_id=p_order.tenant_id and origin.company_id=p_order.company_id
    and origin.service_id=p_order.service_id and p_order.title=item.name
    and item.service_id=p_order.service_id and item.order_id is null and item.fulfillment_status='pending'
    and claim.status='approved' and claim.reviewed_by_profile_id=auth.uid()
    and claim.tenant_id=invoice.tenant_id and claim.company_id=invoice.company_id
    and invoice.tenant_id=p_order.tenant_id and invoice.company_id=p_order.company_id
    and invoice.status='paid' and invoice.archived_at is null
    and payment.status='succeeded' and payment.created_by_profile_id=auth.uid()
    and payment.amount_cents=claim.amount_cents and payment.currency=claim.currency
    and origin.client_profile_id=coalesce(invoice.client_profile_id,claim.client_profile_id)
  );
$$;

create function private.manual_invoice_order_paid(p_order_id uuid,p_tenant_id uuid,p_company_id uuid,p_client_id uuid,p_service_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from private.invoice_manual_order_fulfillments origin
  join private.invoice_manual_payment_claims claim on claim.id=origin.claim_id
  join public.invoices invoice on invoice.id=claim.invoice_id
  join public.invoice_items item on item.id=origin.invoice_item_id and item.invoice_id=invoice.id
  join public.invoice_payments payment on payment.id=claim.payment_id and payment.invoice_id=invoice.id
  where origin.order_id=p_order_id and item.order_id=origin.order_id
   and origin.tenant_id=p_tenant_id and origin.company_id=p_company_id
   and origin.client_profile_id=p_client_id and origin.service_id=p_service_id
   and item.service_id=p_service_id and item.fulfillment_status='provisioned'
   and claim.status='approved' and claim.tenant_id=p_tenant_id and claim.company_id=p_company_id
   and invoice.tenant_id=p_tenant_id and invoice.company_id=p_company_id
   and invoice.status='paid' and invoice.archived_at is null and payment.status='succeeded'
   and payment.amount_cents=claim.amount_cents and payment.currency=claim.currency
 );
$$;

create function private.order_start_enabled(g private.client_order_starts) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.client_order_start_rollout where tenant_id=g.tenant_id and service_id=g.service_id and enabled)
  or private.manual_invoice_order_paid(g.order_id,g.tenant_id,g.company_id,g.purchaser_id,g.service_id);
$$;

create function private.assign_manual_invoice_intake(p_order_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare origin private.invoice_manual_order_fulfillments; intake record; assignment_id uuid; assigned_count integer:=0;
begin
 select * into origin from private.invoice_manual_order_fulfillments where order_id=p_order_id;
 if origin.order_id is null or not private.manual_invoice_order_paid(origin.order_id,origin.tenant_id,origin.company_id,origin.client_profile_id,origin.service_id) then
  raise exception 'Manual invoice fulfillment is unavailable' using errcode='42501';
 end if;
 perform private.require_forms_write(origin.tenant_id);
 for intake in
  select form.id,form.published_version_id from public.forms form
  join public.form_versions version on version.id=form.published_version_id and version.form_id=form.id and version.lifecycle_state='published'
  where form.tenant_id=origin.tenant_id and form.form_type='intake' and form.status='published' and form.archived_at is null
   and exists(select 1 from public.form_service_links link where link.form_version_id=version.id and link.form_version_field_id is null
    and link.role='intake_assignment' and link.service_id=origin.service_id)
  order by form.id for share of form
 loop
  insert into public.form_assignments(form_id,form_version_id,company_id,client_profile_id,order_id,required,assigned_by_profile_id)
  values(intake.id,intake.published_version_id,origin.company_id,origin.client_profile_id,origin.order_id,true,auth.uid())
  returning id into assignment_id;
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
  values(auth.uid(),'form_assignment',assignment_id,'form.assigned','Automatically assigned Intake Form after manual Invoice payment.',
   jsonb_build_object('form_id',intake.id,'form_version_id',intake.published_version_id,'company_id',origin.company_id,
    'order_id',origin.order_id,'client_profile_id',origin.client_profile_id,'manual_payment_claim_id',origin.claim_id,'automatic',true));
  assigned_count:=assigned_count+1;
 end loop;
 if assigned_count>0 then
  insert into private.client_order_starts(order_id,tenant_id,company_id,purchaser_id,service_id,assignment_ids,assignment_versions)
  select origin.order_id,origin.tenant_id,origin.company_id,origin.client_profile_id,origin.service_id,
   array_agg(a.id order by a.id),jsonb_object_agg(a.id::text,a.form_version_id::text)
  from public.form_assignments a where a.order_id=origin.order_id and a.client_profile_id=origin.client_profile_id
   and a.company_id=origin.company_id and a.required and a.archived_at is null and a.status='assigned'
  having count(*)>0;
 end if;
 return assigned_count;
end;
$$;

create function private.fulfill_manual_invoice_claim(p_claim_id uuid) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare actor_id uuid; claim private.invoice_manual_payment_claims; invoice public.invoices; payment public.invoice_payments;
 item public.invoice_items; recipient_id uuid; new_order_id uuid; order_ids uuid[]:='{}'::uuid[];
begin
 actor_id:=private.require_invoice_capability('invoices.mark_paid');
 perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
 actor_id:=private.require_invoice_capability('invoices.mark_paid');
 select * into claim from private.invoice_manual_payment_claims where id=p_claim_id and tenant_id=private.current_tenant_id() for update;
 if claim.id is null or claim.status<>'approved' or claim.reviewed_by_profile_id is distinct from actor_id or claim.payment_id is null then
  raise exception 'Approved manual payment is unavailable' using errcode='42501';
 end if;
 select * into invoice from public.invoices where id=claim.invoice_id and tenant_id=claim.tenant_id and company_id=claim.company_id for update;
 if invoice.id is null or invoice.status<>'paid' or invoice.archived_at is not null or not private.invoice_record_visible(invoice.id) then
  raise exception 'Paid Invoice is unavailable' using errcode='42501';
 end if;
 perform private.require_invoice_write(invoice.tenant_id);
 if exists(select 1 from public.invoice_items where invoice_id=invoice.id and service_id is not null and order_id is null)
  and not private.tenant_module_allowed(invoice.tenant_id,'projects') then raise exception 'WF_PROJECTS_DISABLED' using errcode='42501'; end if;
 select * into payment from public.invoice_payments where id=claim.payment_id and invoice_id=invoice.id for share;
 if payment.id is null or payment.status<>'succeeded' or payment.created_by_profile_id is distinct from actor_id
  or payment.amount_cents<>claim.amount_cents or payment.currency<>claim.currency or claim.currency<>invoice.currency
  or payment.payment_method='wolf_forge_wallet' then
  raise exception 'Manual payment settlement is unavailable' using errcode='23514';
 end if;
 recipient_id:=coalesce(invoice.client_profile_id,claim.client_profile_id);
 perform 1 from public.profiles p join public.tenant_memberships m on m.profile_id=p.id
  join public.roles r on r.id=m.role_id and r.name='client'
  join public.companies c on c.id=m.company_id and c.tenant_id=m.tenant_id
  where p.id=recipient_id and p.archived_at is null and m.tenant_id=invoice.tenant_id and m.company_id=invoice.company_id
   and m.account_class='client' and m.archived_at is null and c.archived_at is null
  for share of p,m,c;
 if not found then raise exception 'Invoice client is unavailable' using errcode='42501'; end if;
 actor_id:=private.require_invoice_capability('invoices.mark_paid');
 -- The Invoice lock serializes every line. A replay never assigns newly published forms.
 for item in select * from public.invoice_items where invoice_id=invoice.id order by position,id for update loop
  if item.service_id is null then continue; end if;
  if item.order_id is not null then
   perform 1 from public.orders o where o.id=item.order_id and o.tenant_id=invoice.tenant_id and o.company_id=invoice.company_id
    and o.service_id=item.service_id and o.archived_at is null for share;
   if not found then raise exception 'Linked Invoice Order is unavailable' using errcode='23514'; end if;
   order_ids:=array_append(order_ids,item.order_id); continue;
  end if;
  if item.fulfillment_status<>'pending' then raise exception 'Invoice line is not ready for fulfillment' using errcode='23514'; end if;
  perform 1 from public.services s where s.id=item.service_id and s.tenant_id=invoice.tenant_id and s.archived_at is null for share;
  if not found then raise exception 'Invoice service is unavailable' using errcode='23514'; end if;
  actor_id:=private.require_invoice_capability('invoices.mark_paid');
  new_order_id:=gen_random_uuid();
  insert into private.invoice_manual_order_fulfillments(invoice_item_id,claim_id,order_id,tenant_id,company_id,service_id,client_profile_id,created_by_profile_id)
  values(item.id,claim.id,new_order_id,invoice.tenant_id,invoice.company_id,item.service_id,recipient_id,actor_id);
  insert into public.orders(id,tenant_id,company_id,service_id,title,status,priority)
  values(new_order_id,invoice.tenant_id,invoice.company_id,item.service_id,item.name,'pending','normal');
  update public.invoice_items set order_id=new_order_id,fulfillment_status='provisioned' where id=item.id and order_id is null;
  perform private.assign_manual_invoice_intake(new_order_id);
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
  values(actor_id,'order',new_order_id,'order.created','Created Order from approved manual Invoice payment.',
   jsonb_build_object('invoice_id',invoice.id,'invoice_item_id',item.id,'manual_payment_claim_id',claim.id,'client_profile_id',recipient_id));
  order_ids:=array_append(order_ids,new_order_id);
 end loop;
 perform private.require_invoice_capability('invoices.mark_paid');
 return order_ids;
end;
$$;

revoke all on function private.manual_invoice_order_insert_allowed(public.orders),
 private.manual_invoice_order_paid(uuid,uuid,uuid,uuid,uuid),private.order_start_enabled(private.client_order_starts),
 private.assign_manual_invoice_intake(uuid),private.fulfill_manual_invoice_claim(uuid)
 from public,anon,authenticated,service_role;


-- Guarded patches preserve exact latest bodies, owner and ACL.

do $manual_origin_0$
declare
 target oid:='private.enforce_order_permission()'::regprocedure; original text; replacement text; needle text; value text;
 owner_before oid; acl_before aclitem[];
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if md5(replace(original,E'\r\n',E'\n'))<>'1953b2e7cab8f0af8c72123d61e6c415' then
  raise exception 'Unexpected current body for private.enforce_order_permission()';
 end if;
 replacement:=original;
 needle:=$old$if tg_op = 'INSERT' then$old$; value:=$new$if tg_op = 'INSERT' then
    if private.manual_invoice_order_insert_allowed(new) then return new; end if;$new$;
 if position(needle in replacement)=0 then needle:=replace(needle,E'\n',E'\r\n'); value:=replace(value,E'\n',E'\r\n'); end if;
 if (length(replacement)-length(replace(replacement,needle,'')))/length(needle)<>1 then raise exception 'Unexpected manual-origin patch anchor'; end if;
 replacement:=replace(replacement,needle,value);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
  raise exception 'Manual-origin body/owner/ACL preservation failed';
 end if;
end;
$manual_origin_0$;

do $manual_origin_1$
declare
 target oid:='private.order_start_purchase_paid(private.client_order_starts)'::regprocedure; original text; replacement text; needle text; value text;
 owner_before oid; acl_before aclitem[];
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if md5(replace(original,E'\r\n',E'\n'))<>'288bce5d90a429ab4ee1835f5c888b2a' then
  raise exception 'Unexpected current body for private.order_start_purchase_paid(private.client_order_starts)';
 end if;
 replacement:=original;
 needle:=$old$and i.billing_reason='store_purchase' and i.status='paid' and i.archived_at is null);$old$; value:=$new$and i.billing_reason='store_purchase' and i.status='paid' and i.archived_at is null)
    or private.manual_invoice_order_paid(g.order_id,g.tenant_id,g.company_id,g.purchaser_id,g.service_id);$new$;
 if position(needle in replacement)=0 then needle:=replace(needle,E'\n',E'\r\n'); value:=replace(value,E'\n',E'\r\n'); end if;
 if (length(replacement)-length(replace(replacement,needle,'')))/length(needle)<>1 then raise exception 'Unexpected manual-origin patch anchor'; end if;
 replacement:=replace(replacement,needle,value);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
  raise exception 'Manual-origin body/owner/ACL preservation failed';
 end if;
end;
$manual_origin_1$;

do $manual_origin_2$
declare
 target oid:='private.try_requested_order_start(uuid)'::regprocedure; original text; replacement text; needle text; value text;
 owner_before oid; acl_before aclitem[];
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if md5(replace(original,E'\r\n',E'\n'))<>'acef8e1722b5d024cebf70f482f5a14a' then
  raise exception 'Unexpected current body for private.try_requested_order_start(uuid)';
 end if;
 replacement:=original;
 needle:=$old$if not exists(select 1 from private.client_order_start_rollout where tenant_id=g.tenant_id and service_id=g.service_id and enabled) then return false; end if;$old$; value:=$new$if not private.order_start_enabled(g) then return false; end if;$new$;
 if position(needle in replacement)=0 then needle:=replace(needle,E'\n',E'\r\n'); value:=replace(value,E'\n',E'\r\n'); end if;
 if (length(replacement)-length(replace(replacement,needle,'')))/length(needle)<>1 then raise exception 'Unexpected manual-origin patch anchor'; end if;
 replacement:=replace(replacement,needle,value);
 needle:=$old$and i.tenant_id=g.tenant_id and i.company_id=g.company_id and i.client_profile_id=g.purchaser_id
      and i.billing_reason='store_purchase' and i.status='paid' and i.archived_at is null for share of i nowait;$old$; value:=$new$and i.tenant_id=g.tenant_id and i.company_id=g.company_id and i.status='paid' and i.archived_at is null
      and ((i.client_profile_id=g.purchaser_id and i.billing_reason='store_purchase')
        or private.manual_invoice_order_paid(g.order_id,g.tenant_id,g.company_id,g.purchaser_id,g.service_id)) for share of i nowait;$new$;
 if position(needle in replacement)=0 then needle:=replace(needle,E'\n',E'\r\n'); value:=replace(value,E'\n',E'\r\n'); end if;
 if (length(replacement)-length(replace(replacement,needle,'')))/length(needle)<>1 then raise exception 'Unexpected manual-origin patch anchor'; end if;
 replacement:=replace(replacement,needle,value);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
  raise exception 'Manual-origin body/owner/ACL preservation failed';
 end if;
end;
$manual_origin_2$;

do $manual_origin_3$
declare
 target oid:='public.app_get_my_order_start(uuid)'::regprocedure; original text; replacement text; needle text; value text;
 owner_before oid; acl_before aclitem[];
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if md5(replace(original,E'\r\n',E'\n'))<>'675b8e46cb25fa3c9978f1848ddfb9aa' then
  raise exception 'Unexpected current body for public.app_get_my_order_start(uuid)';
 end if;
 replacement:=original;
 needle:=$old$exists(select 1 from private.client_order_start_rollout where tenant_id=g.tenant_id and service_id=g.service_id and enabled)$old$; value:=$new$private.order_start_enabled(g)$new$;
 if position(needle in replacement)=0 then needle:=replace(needle,E'\n',E'\r\n'); value:=replace(value,E'\n',E'\r\n'); end if;
 if (length(replacement)-length(replace(replacement,needle,'')))/length(needle)<>1 then raise exception 'Unexpected manual-origin patch anchor'; end if;
 replacement:=replace(replacement,needle,value);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
  raise exception 'Manual-origin body/owner/ACL preservation failed';
 end if;
end;
$manual_origin_3$;

do $manual_origin_4$
declare
 target oid:='private.process_requested_order_starts()'::regprocedure; original text; replacement text; needle text; value text;
 owner_before oid; acl_before aclitem[];
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if md5(replace(original,E'\r\n',E'\n'))<>'7177296f4578e957f642b548bdb4bcf1' then
  raise exception 'Unexpected current body for private.process_requested_order_starts()';
 end if;
 replacement:=original;
 needle:=$old$exists(select 1 from private.client_order_start_rollout where tenant_id=gate.tenant_id and service_id=gate.service_id and enabled)$old$; value:=$new$private.order_start_enabled(gate)$new$;
 if position(needle in replacement)=0 then needle:=replace(needle,E'\n',E'\r\n'); value:=replace(value,E'\n',E'\r\n'); end if;
 if (length(replacement)-length(replace(replacement,needle,'')))/length(needle)<>1 then raise exception 'Unexpected manual-origin patch anchor'; end if;
 replacement:=replace(replacement,needle,value);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
  raise exception 'Manual-origin body/owner/ACL preservation failed';
 end if;
end;
$manual_origin_4$;
