-- Public invoice links are limited read capabilities, never client sessions or payment authority.
create table private.invoice_share_links (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  token_sha256 text not null unique check(length(token_sha256)=64 and token_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  revoked_at timestamptz,
  revoked_by_profile_id uuid references public.profiles(id) on delete restrict,
  foreign key(tenant_id,invoice_id) references public.invoices(tenant_id,id),
  unique(tenant_id,created_by_profile_id,request_id),
  check(expires_at>created_at and expires_at<=created_at+interval '30 days'),
  check((revoked_at is null)=(revoked_by_profile_id is null))
);
create index invoice_share_links_invoice_created_idx on private.invoice_share_links(invoice_id,created_at desc,id desc);
alter table private.invoice_share_links enable row level security;
revoke all on private.invoice_share_links from public,anon,authenticated,service_role;

create function private.enforce_invoice_share_link_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Invoice share history is immutable' using errcode='55000'; end if;
  if row(new.id,new.tenant_id,new.invoice_id,new.created_by_profile_id,new.request_id,new.token_sha256,new.created_at,new.expires_at)
    is distinct from row(old.id,old.tenant_id,old.invoice_id,old.created_by_profile_id,old.request_id,old.token_sha256,old.created_at,old.expires_at)
    or old.revoked_at is not null or new.revoked_at is null or new.revoked_by_profile_id is distinct from auth.uid()
  then raise exception 'Invoice share history is immutable' using errcode='55000'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_invoice_share_link_history() from public,anon,authenticated,service_role;
create trigger invoice_share_links_history before update or delete on private.invoice_share_links
for each row execute function private.enforce_invoice_share_link_history();

create function public.app_list_invoice_share_links(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=private.require_invoice_capability('invoices.manage'); parent public.invoices; result jsonb;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  -- Module lifecycle acquisition can wait; privileges may change while waiting.
  actor_id:=private.require_invoice_capability('invoices.manage');
  select i.* into parent from public.invoices i
  where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id() and private.can_read_invoice(i.id);
  if parent.id is null then raise exception 'Invoice sharing access is denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'created_at',l.created_at,'expires_at',l.expires_at,'revoked_at',l.revoked_at)
    order by l.active desc,l.created_at desc,l.id desc),'[]'::jsonb) into result
  from (select link.*,link.revoked_at is null and link.expires_at>clock_timestamp() as active
    from private.invoice_share_links link where link.invoice_id=parent.id and link.tenant_id=parent.tenant_id
    order by (link.revoked_at is null and link.expires_at>clock_timestamp()) desc,link.created_at desc,link.id desc limit 100) l;
  return result;
end;
$$;

create function public.app_create_invoice_share_link(p_request_id uuid,p_invoice_id uuid,p_token_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid:=private.require_invoice_capability('invoices.manage');
  parent public.invoices;
  link private.invoice_share_links;
  issued_at_value timestamptz;
begin
  if p_request_id is null or p_invoice_id is null or p_token_sha256 is null or length(p_token_sha256)<>64 or p_token_sha256 !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid invoice share request' using errcode='22023'; end if;
  perform private.require_invoice_write(private.current_tenant_id());
  -- The invoice lock serializes distinct creators as well as retries before the active-link count.
  select i.* into parent from public.invoices i join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id and c.archived_at is null
  where i.id=p_invoice_id and i.tenant_id=private.current_tenant_id() and i.archived_at is null for update of i;
  actor_id:=private.require_invoice_capability('invoices.manage');
  if parent.id is null or not private.can_read_invoice(parent.id) or parent.status in ('draft','void')
    or parent.issued_at is null or parent.invoice_number is null
  then raise exception 'Invoice sharing access is denied' using errcode='42501'; end if;
  select * into link from private.invoice_share_links where tenant_id=parent.tenant_id and created_by_profile_id=actor_id and request_id=p_request_id;
  if found then
    if link.invoice_id is distinct from parent.id or link.token_sha256 is distinct from p_token_sha256
    then raise exception 'Share request was already used with different details' using errcode='22023'; end if;
    return jsonb_build_object('id',link.id,'created_at',link.created_at,'expires_at',link.expires_at,'revoked_at',link.revoked_at);
  end if;
  if (select count(*) from private.invoice_share_links where invoice_id=parent.id and tenant_id=parent.tenant_id and revoked_at is null and expires_at>clock_timestamp())>=3
  then raise exception 'WF_INVOICE_SHARE_LIMIT' using errcode='22023'; end if;
  perform private.consume_rate_limit('invoice.share.create.day',parent.id::text,interval '1 day',20);
  issued_at_value:=clock_timestamp();
  begin
    insert into private.invoice_share_links(tenant_id,invoice_id,created_by_profile_id,request_id,token_sha256,created_at,expires_at)
    values(parent.tenant_id,parent.id,actor_id,p_request_id,p_token_sha256,issued_at_value,issued_at_value+interval '30 days') returning * into link;
  exception when unique_violation then
    raise exception 'Invoice share request conflicts with an existing link' using errcode='23505';
  end;
  perform private.record_authenticated_activity('invoice',parent.id,'invoice.share_link_created','Created an invoice sharing link.',
    jsonb_build_object('share_link_id',link.id,'expires_at',link.expires_at));
  return jsonb_build_object('id',link.id,'created_at',link.created_at,'expires_at',link.expires_at,'revoked_at',link.revoked_at);
end;
$$;

create function public.app_revoke_invoice_share_link(p_link_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=private.require_invoice_capability('invoices.manage'); parent public.invoices; parent_id uuid; link private.invoice_share_links;
begin
  perform private.require_invoice_write(private.current_tenant_id());
  select invoice_id into parent_id from private.invoice_share_links where id=p_link_id and tenant_id=private.current_tenant_id();
  select i.* into parent from public.invoices i where i.id=parent_id and i.tenant_id=private.current_tenant_id() for update;
  actor_id:=private.require_invoice_capability('invoices.manage');
  if parent.id is null or not private.can_read_invoice(parent.id)
  then raise exception 'Invoice sharing access is denied' using errcode='42501'; end if;
  select * into link from private.invoice_share_links where id=p_link_id and tenant_id=parent.tenant_id and invoice_id=parent.id for update;
  if link.id is null then raise exception 'Invoice sharing access is denied' using errcode='42501'; end if;
  if link.revoked_at is null then
    update private.invoice_share_links set revoked_at=clock_timestamp(),revoked_by_profile_id=actor_id where id=link.id returning * into link;
    perform private.record_authenticated_activity('invoice',parent.id,'invoice.share_link_revoked','Revoked an invoice sharing link.',jsonb_build_object('share_link_id',link.id));
  end if;
  return jsonb_build_object('id',link.id,'created_at',link.created_at,'expires_at',link.expires_at,'revoked_at',link.revoked_at);
end;
$$;

-- Deliberately VOLATILE: a valid read consumes the existing private cost budget.
create function public.app_get_public_invoice_share(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link private.invoice_share_links; result jsonb;
begin
  if p_token is null or length(p_token)<>64 or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invoice not found' using errcode='P0002'; end if;
  select l.* into link from private.invoice_share_links l
    join public.invoices i on i.id=l.invoice_id and i.tenant_id=l.tenant_id
    join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id and c.archived_at is null
    join public.tenants t on t.id=i.tenant_id and t.status='active' and t.archived_at is null
  where l.token_sha256=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null and l.expires_at>clock_timestamp()
    and i.archived_at is null and i.status not in ('draft','void') and i.issued_at is not null and i.invoice_number is not null
    and private.tenant_module_allowed(i.tenant_id,'invoices');
  if link.id is null then raise exception 'Invoice not found' using errcode='P0002'; end if;
  perform private.consume_rate_limit('invoice.share.read.link',link.id::text,interval '10 minutes',20);
  perform private.consume_rate_limit('invoice.share.read.tenant',link.tenant_id::text,interval '1 hour',400);
  select jsonb_build_object('invoice',jsonb_build_object(
      'id',i.id,'tenant_id',i.tenant_id,
      'number','WF-'||lpad(i.invoice_number::text,greatest(4,length(i.invoice_number::text)),'0'),
      'company_name',c.name,'status',i.status,'currency',i.currency,
      'subtotal_cents',i.subtotal_cents,'discount_total_cents',i.discount_total_cents,'tax_total_cents',i.tax_total_cents,
      'total_cents',i.total_cents,'balance_due_cents',amounts.balance_due_cents,'successful_paid_cents',amounts.gross_paid_cents,
      'issued_at',i.issued_at,'due_at',i.due_at,
      'payment_reported',exists(select 1 from private.invoice_manual_payment_claims claim where claim.invoice_id=i.id and claim.tenant_id=i.tenant_id and claim.status='pending'),
      'items',coalesce((select jsonb_agg(jsonb_build_object('name',item.name,'description',item.description,'quantity',item.quantity,
        'unit_price_cents',item.unit_price_cents,'total_cents',item.line_subtotal_cents) order by item.position,item.id)
        from public.invoice_items item where item.invoice_id=i.id),'[]'::jsonb)),
    'settings',case when settings.enabled then jsonb_build_object('enabled',true,'paypal_url',settings.paypal_url,'instructions',settings.instructions)
      else jsonb_build_object('enabled',false,'paypal_url',null,'instructions','') end) into result
  from private.invoice_share_links current_link
    join public.invoices i on i.id=current_link.invoice_id and i.tenant_id=current_link.tenant_id
    join public.companies c on c.id=i.company_id and c.tenant_id=i.tenant_id and c.archived_at is null
    join public.tenants t on t.id=i.tenant_id and t.status='active' and t.archived_at is null
    cross join lateral private.invoice_amounts(i.id) amounts
    left join private.invoice_manual_payment_settings settings on settings.tenant_id=i.tenant_id
  where current_link.id=link.id and current_link.revoked_at is null and current_link.expires_at>clock_timestamp()
    and i.archived_at is null and i.status not in ('draft','void') and i.issued_at is not null and i.invoice_number is not null
    and private.tenant_module_allowed(i.tenant_id,'invoices');
  if result is null then raise exception 'Invoice not found' using errcode='P0002'; end if;
  return result;
end;
$$;

revoke all on function public.app_list_invoice_share_links(uuid) from public,anon,authenticated,service_role;
revoke all on function public.app_create_invoice_share_link(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.app_revoke_invoice_share_link(uuid) from public,anon,authenticated,service_role;
revoke all on function public.app_get_public_invoice_share(text) from public,anon,authenticated,service_role;
grant execute on function public.app_list_invoice_share_links(uuid) to authenticated;
grant execute on function public.app_create_invoice_share_link(uuid,uuid,text) to authenticated;
grant execute on function public.app_revoke_invoice_share_link(uuid) to authenticated;
grant execute on function public.app_get_public_invoice_share(text) to anon,authenticated;
comment on function public.app_get_public_invoice_share(text) is
 'Explicit limited public invoice capability. Token possession gives invoice/payment-instruction read only; no identity, receipt, wallet or mutation authority. Revocation,30-day expiry, parent Tenant/module state and existing bounded cost counters are checked per call.';
