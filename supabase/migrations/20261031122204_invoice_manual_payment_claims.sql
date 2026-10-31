-- Proposal for CLI-created migration. No financial state changes on a client report.
create table private.invoice_manual_payment_settings (
  tenant_id uuid primary key references public.tenants(id),
  enabled boolean not null default false,
  paypal_url text,
  instructions text not null default '' check(length(instructions)<=4000),
  updated_by_profile_id uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table private.invoice_payment_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null references public.invoices(id),
  uploader_profile_id uuid not null references public.profiles(id),
  request_id uuid not null,
  original_name text not null check(length(original_name) between 1 and 255),
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  size_bytes bigint not null check(size_bytes between 1 and 4194304),
  checksum_sha256 text not null check(checksum_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 day',
  verified_at timestamptz,
  foreign key(tenant_id,invoice_id) references public.invoices(tenant_id,id),
  unique(uploader_profile_id,request_id),
  unique(id,invoice_id,tenant_id,uploader_profile_id)
);
create table private.invoice_manual_payment_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null references public.invoices(id),
  company_id uuid not null references public.companies(id),
  client_profile_id uuid not null references public.profiles(id),
  request_id uuid not null,
  receipt_id uuid not null unique,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  method text not null check(method in ('paypal','bank_transfer','other')),
  reference text check(length(reference) between 1 and 240),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid references public.profiles(id),
  review_reason text check(length(review_reason)<=1000),
  reconciliation_reference text check(length(reconciliation_reference) between 1 and 240),
  paid_at timestamptz,
  payment_id uuid unique references public.invoice_payments(id),
  unique(client_profile_id,request_id),
  foreign key(tenant_id,invoice_id) references public.invoices(tenant_id,id),
  foreign key(invoice_id,company_id) references public.invoices(id,company_id),
  foreign key(tenant_id,client_profile_id) references public.tenant_memberships(tenant_id,profile_id),
  foreign key(payment_id,invoice_id) references public.invoice_payments(id,invoice_id),
  foreign key(receipt_id,invoice_id,tenant_id,client_profile_id)
    references private.invoice_payment_receipts(id,invoice_id,tenant_id,uploader_profile_id),
  check ((status='pending' and reviewed_at is null and reviewed_by_profile_id is null and payment_id is null and paid_at is null and reconciliation_reference is null)
    or (status='rejected' and reviewed_at is not null and reviewed_by_profile_id is not null and review_reason is not null and length(btrim(review_reason))>0 and payment_id is null and paid_at is null and reconciliation_reference is null)
    or (status='approved' and reviewed_at is not null and reviewed_by_profile_id is not null and payment_id is not null and paid_at is not null and reconciliation_reference is not null and length(btrim(reconciliation_reference))>0))
);
create unique index invoice_manual_one_pending on private.invoice_manual_payment_claims(invoice_id) where status='pending';
-- The reviewer records the actual bank/PayPal reconciliation identifier. Client input never consumes this uniqueness key.
create unique index invoice_manual_reconciliation_once on private.invoice_manual_payment_claims(tenant_id,method,lower(btrim(reconciliation_reference))) where status='approved';
create index invoice_manual_claim_history on private.invoice_manual_payment_claims(invoice_id,created_at desc,id);
create index invoice_manual_receipt_quota on private.invoice_payment_receipts(invoice_id);
create table private.invoice_manual_payment_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  claim_id uuid not null unique references private.invoice_manual_payment_claims(id),
  reviewer_profile_id uuid not null references public.profiles(id),
  request_id uuid not null,
  decision text not null check(decision in ('approve','reject')),
  paid_at timestamptz,
  reference text,
  reason text,
  created_at timestamptz not null default now(),
  unique(reviewer_profile_id,request_id)
);
create trigger invoice_manual_reviews_immutable before update or delete or truncate on private.invoice_manual_payment_reviews
for each statement execute function private.prevent_invoice_ledger_mutation();
do $$ declare relation_name text; begin
  foreach relation_name in array array['invoice_manual_payment_settings','invoice_payment_receipts','invoice_manual_payment_claims','invoice_manual_payment_reviews'] loop
    execute format('alter table private.%I enable row level security',relation_name);
    execute format('alter table private.%I force row level security',relation_name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',relation_name);
  end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('invoice-payment-receipts','invoice-payment-receipts',false,4194304,array['image/png','image/jpeg','image/webp']);
-- No Storage policies: only the trusted server may upload after validating bytes.

create function private.invoice_manual_settings_json(p_tenant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('enabled',s.enabled,'paypal_url',s.paypal_url,'instructions',s.instructions)
   from private.invoice_manual_payment_settings s where s.tenant_id=p_tenant_id),
   jsonb_build_object('enabled',false,'paypal_url',null,'instructions',''));
$$;
create function private.require_manual_invoice(p_invoice_id uuid,p_client_only boolean default false) returns public.invoices
language plpgsql stable security definer set search_path='' as $$
declare invoice public.invoices; client_company uuid;
begin
  if auth.uid() is null then raise exception 'Invoice access is unavailable' using errcode='42501'; end if;
  if private.current_account_class()='client' then
    select c.company_id into client_company from public.app_get_client_account_context() c;
    perform public.app_require_module_access('portal_invoices');
    perform private.require_permission('invoices.view');
  elsif not p_client_only and private.current_account_class()='internal' then
    perform private.require_invoice_capability('invoices.view');
  else raise exception 'Invoice access is unavailable' using errcode='42501'; end if;
  select i.* into invoice from public.invoices i
    join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id and c.archived_at is null
    join public.tenants t on t.id=i.tenant_id and t.status='active' and t.archived_at is null
    where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id() and i.archived_at is null
      and (client_company is null or i.company_id=client_company) and private.can_read_invoice(i.id);
  if invoice.id is null then raise exception 'Invoice access is unavailable' using errcode='42501'; end if;
  return invoice;
end;
$$;
create function private.invoice_manual_receipt_json(p_receipt private.invoice_payment_receipts) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p_receipt.id,'name',p_receipt.original_name,'mime',p_receipt.mime_type,'size',p_receipt.size_bytes,'path',p_receipt.object_key);
$$;
create function private.invoice_manual_claim_json(p_claim private.invoice_manual_payment_claims) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_claim.id,'invoice_id',p_claim.invoice_id,'status',p_claim.status,'amount_cents',p_claim.amount_cents,
   'currency',p_claim.currency,'method',p_claim.method,'reference',p_claim.reference,'created_at',p_claim.created_at,
   'reviewed_at',p_claim.reviewed_at,'review_reason',p_claim.review_reason,'payment_id',p_claim.payment_id,
   'receipt_id',p_claim.receipt_id,'receipt_name',r.original_name,
   'can_view_receipt',r.uploader_profile_id=auth.uid() or (private.current_account_class()='internal' and private.current_user_has_permission('invoices.mark_paid')))
 from private.invoice_payment_receipts r where r.id=p_claim.receipt_id;
$$;
create function public.app_get_invoice_manual_payment_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_invoice_capability('invoices.manage');
  return private.invoice_manual_settings_json(private.current_tenant_id());
end;
$$;
create function public.app_save_invoice_manual_payment_settings(p_enabled boolean,p_paypal_url text,p_instructions text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; url text:=nullif(btrim(p_paypal_url),''); instructions text:=btrim(coalesce(p_instructions,''));
begin
  actor:=private.require_invoice_capability('invoices.manage');
  perform private.require_invoice_write(private.current_tenant_id());
  actor:=private.require_invoice_capability('invoices.manage');
  if p_enabled is null or length(instructions)>4000 or length(url)>1000
    or (url is not null and url !~ '^https://(www\.)?(paypal\.com|paypal\.me)(/[^[:space:]#]*)?$')
    or (p_enabled and url is null and instructions='') then
    raise exception 'Invalid manual payment settings' using errcode='22023'; end if;
  insert into private.invoice_manual_payment_settings(tenant_id,enabled,paypal_url,instructions,updated_by_profile_id)
  values(private.current_tenant_id(),p_enabled,url,instructions,actor)
  on conflict(tenant_id) do update set enabled=excluded.enabled,paypal_url=excluded.paypal_url,instructions=excluded.instructions,updated_by_profile_id=excluded.updated_by_profile_id,updated_at=now();
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
  values(actor,'profile',actor,'invoice.manual_settings.updated','Updated manual invoice payment instructions.',jsonb_build_object('enabled',p_enabled));
  return private.invoice_manual_settings_json(private.current_tenant_id());
end;
$$;
create function public.app_get_invoice_manual_payment(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare invoice public.invoices:=private.require_manual_invoice(p_invoice_id); claims jsonb; report boolean; review boolean;
begin
  select coalesce(jsonb_agg(private.invoice_manual_claim_json(c) order by c.created_at desc,c.id),'[]'::jsonb)
  into claims from private.invoice_manual_payment_claims c where c.invoice_id=invoice.id and c.tenant_id=invoice.tenant_id;
  review:=private.current_account_class()='internal' and private.current_user_has_permission('invoices.mark_paid') and private.tenant_module_allowed(invoice.tenant_id,'invoices');
  report:=private.current_account_class()='client' and invoice.status='unpaid' and invoice.issued_at is not null
    and private.tenant_module_allowed(invoice.tenant_id,'invoices') and (private.invoice_manual_settings_json(invoice.tenant_id)->>'enabled')::boolean
    and (select balance_due_cents>0 from private.invoice_amounts(invoice.id))
    and jsonb_array_length(claims)<5 and not exists(select 1 from private.invoice_manual_payment_claims c where c.invoice_id=invoice.id and c.status='pending');
  return jsonb_build_object('settings',private.invoice_manual_settings_json(invoice.tenant_id),'claims',claims,'can_report',coalesce(report,false),'can_review',coalesce(review,false));
end;
$$;
create function public.app_prepare_invoice_payment_receipt(p_invoice_id uuid,p_request_id uuid,p_filename text,p_mime_type text,p_size_bytes bigint,p_checksum_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; receipt private.invoice_payment_receipts; identifier uuid;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  invoice:=private.require_manual_invoice(p_invoice_id,true);
  perform 1 from public.invoices where id=invoice.id for update;
  invoice:=private.require_manual_invoice(p_invoice_id,true);
  if p_request_id is null or p_filename is null or btrim(p_filename)='' or length(p_filename) not between 1 and 255 or p_filename ~ '[[:cntrl:]]'
    or p_mime_type is null or p_mime_type not in ('image/png','image/jpeg','image/webp')
    or p_size_bytes is null or p_size_bytes not between 1 and 4194304 or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid receipt upload' using errcode='22023'; end if;
  if invoice.status<>'unpaid' or invoice.issued_at is null or not (private.invoice_manual_settings_json(invoice.tenant_id)->>'enabled')::boolean
    or (select balance_due_cents<=0 from private.invoice_amounts(invoice.id)) then
    raise exception 'Invoice is not available for reporting' using errcode='55000'; end if;
  select * into receipt from private.invoice_payment_receipts where uploader_profile_id=auth.uid() and request_id=p_request_id;
  if found then
    if receipt.invoice_id<>invoice.id or receipt.tenant_id<>invoice.tenant_id or receipt.original_name<>p_filename or receipt.mime_type<>p_mime_type
      or receipt.size_bytes<>p_size_bytes or receipt.checksum_sha256<>p_checksum_sha256 or receipt.expires_at<=now() then
      raise exception 'Receipt request conflict' using errcode='23505'; end if;
    return private.invoice_manual_receipt_json(receipt);
  end if;
  if (select count(*) from private.invoice_payment_receipts where invoice_id=invoice.id)>=10 then
    raise exception 'Receipt reservation limit reached' using errcode='54000'; end if;
  perform private.consume_rate_limit('invoice.receipt.actor.minute',invoice.tenant_id::text||':'||auth.uid()::text,interval '1 minute',10);
  identifier:=extensions.gen_random_uuid();
  insert into private.invoice_payment_receipts(id,tenant_id,invoice_id,uploader_profile_id,request_id,original_name,mime_type,size_bytes,checksum_sha256,object_key)
  values(identifier,invoice.tenant_id,invoice.id,auth.uid(),p_request_id,p_filename,p_mime_type,p_size_bytes,p_checksum_sha256,invoice.tenant_id::text||'/'||invoice.id::text||'/'||identifier::text)
  returning * into receipt;
  return private.invoice_manual_receipt_json(receipt);
end;
$$;
create function public.app_verify_invoice_payment_receipt(p_receipt_id uuid,p_uploader_profile_id uuid,p_checksum_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt private.invoice_payment_receipts; invoice public.invoices;
begin
  select * into receipt from private.invoice_payment_receipts where id=p_receipt_id;
  if receipt.id is null then raise exception 'Receipt is unavailable' using errcode='42501'; end if;
  perform private.require_invoice_write(receipt.tenant_id);
  select i.* into invoice from public.invoices i join public.tenants t on t.id=i.tenant_id and t.status='active' and t.archived_at is null
    join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id and c.archived_at is null
    where i.id=receipt.invoice_id and i.tenant_id=receipt.tenant_id and i.archived_at is null for update of i;
  select * into receipt from private.invoice_payment_receipts where id=p_receipt_id for update;
  if invoice.id is null or invoice.status<>'unpaid' or invoice.issued_at is null or receipt.uploader_profile_id is distinct from p_uploader_profile_id
    or receipt.checksum_sha256 is distinct from p_checksum_sha256 or receipt.expires_at<=now()
    or not (private.invoice_manual_settings_json(receipt.tenant_id)->>'enabled')::boolean
    or not exists(select 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id and p.archived_at is null
      join public.roles role on role.id=m.role_id and role.name='client'
      join public.permission_modules module on module.module_key='portal_invoices' and module.account_class='client'
      where m.profile_id=receipt.uploader_profile_id and m.tenant_id=receipt.tenant_id and m.company_id=invoice.company_id and m.account_class='client' and m.archived_at is null
        and private.tenant_module_allowed(m.tenant_id,module.module_key)
        and private.profile_has_permission_in_tenant(m.profile_id,m.tenant_id,module.required_permission_key)
        and private.profile_has_permission_in_tenant(m.profile_id,m.tenant_id,'invoices.view')) then
    raise exception 'Receipt is unavailable' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='invoice-payment-receipts' and o.name=receipt.object_key
    and (o.metadata->>'size')::bigint=receipt.size_bytes and o.metadata->>'mimetype'=receipt.mime_type) then
    raise exception 'Receipt upload is incomplete' using errcode='55000'; end if;
  update private.invoice_payment_receipts set verified_at=coalesce(verified_at,now()) where id=receipt.id returning * into receipt;
  return private.invoice_manual_receipt_json(receipt);
end;
$$;
create function public.app_get_invoice_payment_receipt(p_receipt_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare receipt private.invoice_payment_receipts; invoice public.invoices; bound boolean;
begin
  select * into receipt from private.invoice_payment_receipts where id=p_receipt_id and verified_at is not null;
  if receipt.id is null then raise exception 'Receipt access is unavailable' using errcode='42501'; end if;
  invoice:=private.require_manual_invoice(receipt.invoice_id);
  if invoice.tenant_id<>receipt.tenant_id then raise exception 'Receipt access is unavailable' using errcode='42501'; end if;
  select exists(select 1 from private.invoice_manual_payment_claims where receipt_id=receipt.id) into bound;
  if private.current_account_class()='internal' then
    perform private.require_invoice_capability('invoices.mark_paid');
  elsif receipt.uploader_profile_id is distinct from auth.uid() or (not bound and receipt.expires_at<=now()) then
    raise exception 'Receipt access is unavailable' using errcode='42501'; end if;
  return private.invoice_manual_receipt_json(receipt);
end;
$$;
create function public.app_submit_invoice_manual_payment_claim(p_request_id uuid,p_invoice_id uuid,p_receipt_id uuid,p_method text,p_reference text,p_expected_balance_cents bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; receipt private.invoice_payment_receipts; claim private.invoice_manual_payment_claims; amount bigint; reference_value text:=nullif(btrim(p_reference),'');
begin
  perform private.require_invoice_write(private.current_tenant_id());
  invoice:=private.require_manual_invoice(p_invoice_id,true);
  perform 1 from public.invoices where id=invoice.id for update;
  invoice:=private.require_manual_invoice(p_invoice_id,true);
  if p_request_id is null or p_receipt_id is null or p_method is null or p_method not in ('paypal','bank_transfer','other') or length(reference_value)>240
    or p_expected_balance_cents is null or p_expected_balance_cents<=0 then
    raise exception 'Invalid payment report' using errcode='22023'; end if;
  select * into claim from private.invoice_manual_payment_claims where client_profile_id=auth.uid() and request_id=p_request_id;
  if found then
    if claim.invoice_id<>invoice.id or claim.receipt_id<>p_receipt_id or claim.method<>p_method or claim.reference is distinct from reference_value
      or claim.amount_cents<>p_expected_balance_cents then
      raise exception 'Payment report request conflict' using errcode='23505'; end if;
    return private.invoice_manual_claim_json(claim);
  end if;
  if invoice.status<>'unpaid' or invoice.issued_at is null or not (private.invoice_manual_settings_json(invoice.tenant_id)->>'enabled')::boolean then
    raise exception 'Invoice is not available for reporting' using errcode='55000'; end if;
  select balance_due_cents into amount from private.invoice_amounts(invoice.id);
  -- Optimistic UI guard only: the actual amount is always derived from the ledger above.
  if amount is distinct from p_expected_balance_cents then
    raise exception 'Invoice balance changed; refresh before reporting payment' using errcode='55000'; end if;
  if amount is null or amount<=0 or exists(select 1 from private.invoice_manual_payment_claims where invoice_id=invoice.id and status='pending') then
    raise exception 'Payment report is already pending or invoice settled' using errcode='55000'; end if;
  if (select count(*) from private.invoice_manual_payment_claims where invoice_id=invoice.id)>=5 then
    raise exception 'Payment report limit reached' using errcode='54000'; end if;
  select * into receipt from private.invoice_payment_receipts where id=p_receipt_id and invoice_id=invoice.id
    and tenant_id=invoice.tenant_id and uploader_profile_id=auth.uid() for update;
  if receipt.id is null or receipt.verified_at is null or receipt.expires_at<=now() or exists(select 1 from private.invoice_manual_payment_claims where receipt_id=receipt.id) then
    raise exception 'A verified receipt for this invoice is required' using errcode='55000'; end if;
  perform private.consume_rate_limit('invoice.claim.actor.hour',invoice.tenant_id::text||':'||auth.uid()::text,interval '1 hour',20);
  insert into private.invoice_manual_payment_claims(tenant_id,invoice_id,company_id,client_profile_id,request_id,receipt_id,amount_cents,currency,method,reference)
  values(invoice.tenant_id,invoice.id,invoice.company_id,auth.uid(),p_request_id,receipt.id,amount,invoice.currency,p_method,reference_value) returning * into claim;
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
  values(auth.uid(),'invoice',invoice.id,'invoice.manual_payment.reported','A client reported an external invoice payment.',jsonb_build_object('claim_id',claim.id,'amount_cents',amount,'currency',invoice.currency));
  perform private.emit_internal_notification_for_permission('invoices.mark_paid','invoice-manual-claim:'||claim.id::text,'payment','info',
    'Payment verification requested','A client submitted an invoice payment receipt for review.','/invoices/'||invoice.id::text,'invoice',invoice.id,auth.uid(),invoice.company_id,now());
  perform private.emit_client_profile_notification_for_permission(auth.uid(),invoice.company_id,'invoices.view','invoice-manual-reported:'||claim.id::text,'payment','info',
    'Payment reported','Your receipt is awaiting verification.','/account/invoices/'||invoice.id::text,'invoice',invoice.id,auth.uid(),now());
  return private.invoice_manual_claim_json(claim);
end;
$$;
create function public.app_review_invoice_manual_payment_claim(p_request_id uuid,p_claim_id uuid,p_decision text,p_paid_at timestamptz,p_reference text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; claim private.invoice_manual_payment_claims; invoice public.invoices; review private.invoice_manual_payment_reviews;
  payment public.invoice_payments; order_ids uuid[]; reference_value text:=nullif(btrim(p_reference),''); reason_value text:=nullif(btrim(p_reason),'');
begin
  actor:=private.require_invoice_capability('invoices.mark_paid');
  perform private.require_invoice_write(private.current_tenant_id());
  actor:=private.require_invoice_capability('invoices.mark_paid');
  if p_request_id is null or p_claim_id is null or p_decision is null or p_decision not in ('approve','reject') or length(reference_value)>240 or length(reason_value)>1000
    or (p_decision='approve' and (p_paid_at is null or not isfinite(p_paid_at) or p_paid_at>now()+interval '5 minutes' or reference_value is null))
    or (p_decision='reject' and (reason_value is null or p_paid_at is not null or reference_value is not null)) then
    raise exception 'Invalid payment review' using errcode='22023'; end if;
  select * into claim from private.invoice_manual_payment_claims where id=p_claim_id and tenant_id=private.current_tenant_id();
  if claim.id is null then raise exception 'Payment claim is unavailable' using errcode='42501'; end if;
  select i.* into invoice from public.invoices i join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id and c.archived_at is null
    where i.id=claim.invoice_id and i.tenant_id=private.current_tenant_id() and i.archived_at is null for update of i;
  select * into claim from private.invoice_manual_payment_claims where id=p_claim_id for update;
  actor:=private.require_invoice_capability('invoices.mark_paid');
  if invoice.id is null or invoice.company_id<>claim.company_id or invoice.tenant_id<>claim.tenant_id or not private.invoice_record_visible(invoice.id) then
    raise exception 'Payment claim is unavailable' using errcode='42501'; end if;
  select * into review from private.invoice_manual_payment_reviews where reviewer_profile_id=actor and request_id=p_request_id;
  if found then
    if review.claim_id<>claim.id or review.decision<>p_decision or review.paid_at is distinct from p_paid_at or review.reference is distinct from reference_value or review.reason is distinct from reason_value then
      raise exception 'Payment review request conflict' using errcode='23505'; end if;
    order_ids:=case when claim.status='approved' then private.fulfill_manual_invoice_claim(claim.id) else '{}'::uuid[] end;
    return jsonb_build_object('claim',private.invoice_manual_claim_json(claim),'order_ids',order_ids);
  end if;
  if claim.status<>'pending' then raise exception 'Payment claim was already reviewed' using errcode='55000'; end if;
  if p_decision='approve' then
    if invoice.status<>'unpaid' or invoice.currency<>claim.currency or (select balance_due_cents from private.invoice_amounts(invoice.id))<>claim.amount_cents then
      raise exception 'Invoice changed; reconcile this payment report before approval' using errcode='55000'; end if;
    if not exists(select 1 from private.invoice_payment_receipts r where r.id=claim.receipt_id and r.verified_at is not null
      and r.invoice_id=invoice.id and r.tenant_id=invoice.tenant_id and r.uploader_profile_id=claim.client_profile_id) then
      raise exception 'Verified receipt is unavailable' using errcode='55000'; end if;
    -- Unique index protects concurrent approvals on different invoices with the same actual transfer.
    if exists(select 1 from private.invoice_manual_payment_claims c where c.tenant_id=claim.tenant_id and c.method=claim.method and c.status='approved' and lower(btrim(c.reconciliation_reference))=lower(reference_value)) then
      raise exception 'External payment reference was already reconciled' using errcode='23505'; end if;
    payment:=private.settle_invoice_payment(actor,p_request_id,invoice.id,claim.amount_cents,'succeeded',case when claim.method='bank_transfer' then 'bank_transfer' else 'manual' end,'manual_invoice_claim',reference_value);
    update private.invoice_manual_payment_claims set status='approved',reviewed_at=now(),reviewed_by_profile_id=actor,review_reason=reason_value,
      reconciliation_reference=reference_value,paid_at=p_paid_at,payment_id=payment.id where id=claim.id returning * into claim;
    order_ids:=private.fulfill_manual_invoice_claim(claim.id);
  else
    update private.invoice_manual_payment_claims set status='rejected',reviewed_at=now(),reviewed_by_profile_id=actor,review_reason=reason_value where id=claim.id returning * into claim;
    order_ids:='{}'::uuid[];
  end if;
  insert into private.invoice_manual_payment_reviews(claim_id,reviewer_profile_id,request_id,decision,paid_at,reference,reason)
  values(claim.id,actor,p_request_id,p_decision,p_paid_at,reference_value,reason_value);
  insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
  values(actor,'invoice',invoice.id,'invoice.manual_payment.'||claim.status,'Reviewed a reported invoice payment.',jsonb_build_object('claim_id',claim.id,'decision',p_decision,'payment_id',claim.payment_id,'paid_at',claim.paid_at));
  perform private.emit_client_profile_notification_for_permission(claim.client_profile_id,invoice.company_id,'invoices.view','invoice-manual-reviewed:'||claim.id::text,'payment','info',
    case when claim.status='approved' then 'Payment verified' else 'Payment receipt needs attention' end,
    case when claim.status='approved' then 'Your invoice payment was verified.' else 'Open your invoice to review the team response.' end,
    '/account/invoices/'||invoice.id::text,'invoice',invoice.id,actor,now());
  return jsonb_build_object('claim',private.invoice_manual_claim_json(claim),'order_ids',order_ids);
end;
$$;

revoke all on function private.invoice_manual_settings_json(uuid),private.require_manual_invoice(uuid,boolean),private.invoice_manual_receipt_json(private.invoice_payment_receipts),private.invoice_manual_claim_json(private.invoice_manual_payment_claims) from public,anon,authenticated,service_role;
revoke all on function public.app_get_invoice_manual_payment_settings(),public.app_save_invoice_manual_payment_settings(boolean,text,text),public.app_get_invoice_manual_payment(uuid),public.app_prepare_invoice_payment_receipt(uuid,uuid,text,text,bigint,text),public.app_verify_invoice_payment_receipt(uuid,uuid,text),public.app_get_invoice_payment_receipt(uuid),public.app_submit_invoice_manual_payment_claim(uuid,uuid,uuid,text,text,bigint),public.app_review_invoice_manual_payment_claim(uuid,uuid,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.app_get_invoice_manual_payment_settings(),public.app_save_invoice_manual_payment_settings(boolean,text,text),public.app_get_invoice_manual_payment(uuid),public.app_prepare_invoice_payment_receipt(uuid,uuid,text,text,bigint,text),public.app_get_invoice_payment_receipt(uuid),public.app_submit_invoice_manual_payment_claim(uuid,uuid,uuid,text,text,bigint),public.app_review_invoice_manual_payment_claim(uuid,uuid,text,timestamptz,text,text) to authenticated;
grant execute on function public.app_verify_invoice_payment_receipt(uuid,uuid,text) to service_role;

do $migration$
declare target oid:='private.client_support_operation_allowed(text,text)'::regprocedure; original text; replacement text; owner_before oid; acl_before aclitem[];
  needle text:=$entry$'app_get_invoice_financials',$entry$;
begin
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 or position('app_get_invoice_manual_payment' in original)>0 then
    raise exception 'Unexpected support operation baseline'; end if;
  replacement:=replace(original,needle,$entry$'app_get_invoice_financials','app_get_invoice_manual_payment','app_prepare_invoice_payment_receipt','app_get_invoice_payment_receipt','app_submit_invoice_manual_payment_claim',$entry$);
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
    raise exception 'Support operation preservation failed'; end if;
end;
$migration$;

-- Charge authorized byte attempts, including replays, before trusted Storage work.
do $migration$
declare target oid:='public.app_consume_server_cost_limit(uuid,text,uuid)'::regprocedure; original text; replacement text; owner_before oid; acl_before aclitem[];
 needle text:=$entry$    when 'intake.file_upload' then$entry$;
begin
 select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
 if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 or position('invoice.receipt_upload' in original)>0 then
   raise exception 'Unexpected server cost-limit baseline'; end if;
 replacement:=replace(original,needle,$entry$    when 'invoice.receipt_upload' then
      perform private.consume_rate_limit('cost.invoice.receipt_upload.actor.minute',p_actor_id::text,interval '1 minute',20);
      perform private.consume_rate_limit('cost.invoice.receipt_upload.actor.hour',p_actor_id::text,interval '1 hour',60);
    when 'invoice.receipt_download' then
      perform private.consume_rate_limit('cost.private.file_download.actor.minute',p_actor_id::text,interval '1 minute',60);
      perform private.consume_rate_limit('cost.private.file_download.actor.hour',p_actor_id::text,interval '1 hour',300);
    when 'intake.file_upload' then$entry$);
 execute replace(pg_get_functiondef(target),original,replacement);
 if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
   raise exception 'Server cost-limit preservation failed'; end if;
end;
$migration$;
