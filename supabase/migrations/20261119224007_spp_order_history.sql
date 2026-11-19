-- Historical provenance is written by the offline SQL importer only. No row data
-- is part of this migration. Operational messages, submissions and payments stay immutable.
create table private.spp_message_history (
  message_id uuid primary key,
  order_id uuid not null,
  source_message_id text not null check (length(btrim(source_message_id)) between 1 and 100),
  source_created_at timestamptz not null check (isfinite(source_created_at)),
  source_time_precision text not null default 'second' check (source_time_precision in ('minute','second')),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  author_profile_id uuid not null,
  author_type text not null check (author_type in ('internal','client')),
  unique (order_id, source_message_id),
  foreign key (message_id, order_id) references public.project_messages(id, order_id) deferrable initially deferred
);
create index spp_message_history_order_time on private.spp_message_history(order_id,source_created_at,message_id);

create table private.spp_submission_history (
  submission_id uuid primary key references public.form_submissions(id),
  order_id uuid not null references public.orders(id),
  source_submitted_at timestamptz not null check (isfinite(source_submitted_at)),
  source_time_precision text not null default 'second' check (source_time_precision in ('minute','second')),
  unique (submission_id, order_id)
);

create table private.spp_signed_agreements (
  submission_id uuid primary key,
  order_id uuid not null,
  original_name text not null check (length(original_name) between 5 and 200 and original_name !~ '[[:cntrl:]/\\]' and lower(right(original_name,4))='.pdf'),
  source_signed_at timestamptz not null check (isfinite(source_signed_at)),
  source_time_precision text not null default 'minute' check (source_time_precision in ('minute','second')),
  contents bytea not null check (substring(contents from 1 for 5) = decode('255044462d','hex')),
  size_bytes integer generated always as (octet_length(contents)) stored check (size_bytes between 8 and 2097152),
  sha256_hex text not null check (sha256_hex = encode(sha256(contents),'hex')),
  foreign key (submission_id, order_id) references private.spp_submission_history(submission_id, order_id)
);
create index spp_signed_agreements_order on private.spp_signed_agreements(order_id);

create table private.spp_payment_history (
  payment_id uuid primary key,
  tenant_id uuid not null,
  invoice_id uuid not null references public.invoices(id),
  source_invoice_id text not null check (length(btrim(source_invoice_id)) between 1 and 100),
  source_provider text not null check (length(btrim(source_provider)) between 1 and 80),
  source_payment_id text not null check (length(btrim(source_payment_id)) between 1 and 200),
  created_by_profile_id uuid not null references public.profiles(id),
  request_id uuid not null,
  settled_at timestamptz not null check (isfinite(settled_at)),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unique (tenant_id,source_provider,source_payment_id),
  foreign key (tenant_id,invoice_id) references public.invoices(tenant_id,id),
  foreign key (payment_id,invoice_id) references public.invoice_payments(id,invoice_id) deferrable initially deferred
);

create table private.spp_invoice_item_orders (
  order_id uuid primary key references public.orders(id),
  invoice_item_id uuid not null references public.invoice_items(id),
  source_order_reference text not null
);
create index spp_invoice_item_orders_item on private.spp_invoice_item_orders(invoice_item_id);

alter table private.spp_message_history enable row level security;
alter table private.spp_submission_history enable row level security;
alter table private.spp_signed_agreements enable row level security;
alter table private.spp_payment_history enable row level security;
alter table private.spp_invoice_item_orders enable row level security;
revoke all on private.spp_message_history,private.spp_submission_history,private.spp_signed_agreements,
  private.spp_payment_history,private.spp_invoice_item_orders from public,anon,authenticated,service_role;

-- The order's import-only source reference is a prerequisite for historical content.
create function private.check_spp_history_parent() returns trigger
language plpgsql set search_path='' as $$
declare parent public.orders;
begin
  select * into strict parent from public.orders where id=new.order_id and spp_order_reference is not null for share;
  if tg_table_name='spp_submission_history' then
    if not exists(select 1 from public.form_submissions s join public.forms f on f.id=s.form_id
        where s.id=new.submission_id and s.order_id=parent.id and s.company_id=parent.company_id
          and f.tenant_id=parent.tenant_id and s.revision_number=1 and s.root_submission_id=s.id) then
      raise exception 'Original submission does not belong to the imported order' using errcode='23514';
    end if;
  elsif not exists(select 1 from public.tenant_memberships m where m.profile_id=new.author_profile_id
      and m.tenant_id=parent.tenant_id and m.account_class=new.author_type
      and (m.account_class='internal' or m.company_id=parent.company_id)) then
    raise exception 'Historical author does not belong to this order' using errcode='23514';
  elsif exists(select 1 from public.project_messages m where m.id=new.message_id
      and (m.order_id,m.author_profile_id,m.author_type,encode(sha256(convert_to(m.body,'UTF8')),'hex'))
        is distinct from (parent.id,new.author_profile_id,new.author_type,new.body_sha256)) then
    raise exception 'Message identity differs from its import source' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_spp_history_parent() from public,anon,authenticated,service_role;
create trigger spp_message_history_parent before insert or update on private.spp_message_history
  for each row execute function private.check_spp_history_parent();
create trigger spp_submission_history_parent before insert or update on private.spp_submission_history
  for each row execute function private.check_spp_history_parent();

-- Keep a native, terminally provisioned line. Only confirmed sibling orders
-- appear as associations; neither the line nor its amount is multiplied.
create view private.spp_valid_invoice_orders as
select l.order_id,l.invoice_item_id,l.source_order_reference,i.id as invoice_id
from private.spp_invoice_item_orders l
join public.invoice_items item on item.id=l.invoice_item_id and item.fulfillment_status='provisioned'
join public.invoices i on i.id=item.invoice_id
join public.orders primary_order on primary_order.id=item.order_id and primary_order.tenant_id=i.tenant_id
  and primary_order.company_id=i.company_id and primary_order.service_id=item.service_id and primary_order.spp_order_reference is not null
join public.orders o on o.id=l.order_id and o.tenant_id=i.tenant_id and o.company_id=i.company_id
  and o.service_id=item.service_id and o.spp_order_reference=l.source_order_reference
where not exists(select 1 from public.invoice_items other where other.order_id=l.order_id and other.id<>item.id);
revoke all on private.spp_valid_invoice_orders from public,anon,authenticated,service_role;

create function private.check_spp_invoice_order() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from private.spp_valid_invoice_orders l where l.order_id=new.order_id and l.invoice_item_id=new.invoice_item_id) then
    raise exception 'Shared invoice line does not match the imported order' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_spp_invoice_order() from public,anon,authenticated,service_role;
create trigger spp_invoice_order_scope after insert or update on private.spp_invoice_item_orders
  for each row execute function private.check_spp_invoice_order();

-- UNION ALL allows the ordinary branch to continue paging from the native
-- (order_id, created_at, id) index. Only trusted source rows move in the timeline.
create view private.spp_dated_project_messages as
select m.* from public.project_messages m
where not exists(select 1 from private.spp_message_history h where h.message_id=m.id and h.order_id=m.order_id)
union all
select m.id,m.order_id,m.author_profile_id,m.author_type,m.body,m.request_id,m.reply_to_message_id,
  m.reply_quote_text,m.reply_to_attachment_id,h.source_created_at
from private.spp_message_history h join public.project_messages m on m.id=h.message_id and m.order_id=h.order_id;
revoke all on private.spp_dated_project_messages from public,anon,authenticated,service_role;

create function private.spp_submitted_at(s public.form_submissions) returns timestamptz
language sql stable set search_path='' as $$
  select coalesce((select h.source_submitted_at from private.spp_submission_history h
    where h.submission_id=s.id and h.order_id=s.order_id),s.submitted_at);
$$;
revoke all on function private.spp_submitted_at(public.form_submissions) from public,anon,authenticated,service_role;

-- Form and order visibility are both required, including the portal module
-- and exact submitting client for a client reader. Metadata follows the same rule.
create function private.can_read_spp_agreement(p_submission_id uuid, p_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and nullif(current_setting('app.client_support_id',true),'') is null
    and private.can_read_form_submission(p_submission_id)
    and private.tenant_module_allowed(private.current_tenant_id(),case when private.current_account_class()='client' then 'portal_forms' else 'forms' end)
    and exists(select 1 from public.form_submissions s join public.orders o on o.id=s.order_id and o.company_id=s.company_id
      where s.id=p_submission_id and o.id=p_order_id and o.tenant_id=private.current_tenant_id() and o.archived_at is null
        and (private.can_access_operational_order(o.id) or (private.current_account_class()='client'
          and private.tenant_module_allowed(o.tenant_id,'portal_projects') and private.current_user_has_permission('projects.view')
          and o.company_id=private.current_user_company_id())));
$$;
revoke all on function private.can_read_spp_agreement(uuid,uuid) from public,anon,authenticated,service_role;

create function public.app_list_order_signed_agreements(p_order_id uuid)
returns table(submission_id uuid,original_name text,size_bytes integer,source_signed_at timestamptz)
language sql stable security definer set search_path='' as $$
  select a.submission_id,a.original_name,a.size_bytes,a.source_signed_at from private.spp_signed_agreements a
    where a.order_id=p_order_id and private.can_read_spp_agreement(a.submission_id,a.order_id)
    order by a.source_signed_at,a.submission_id;
$$;
revoke all on function public.app_list_order_signed_agreements(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_list_order_signed_agreements(uuid) to authenticated;

create function public.app_get_spp_signed_agreement(p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from private.spp_signed_agreements a where a.submission_id=p_submission_id
      and private.can_read_spp_agreement(a.submission_id,a.order_id)) then
    raise exception 'Agreement unavailable' using errcode='42501';
  end if;
  perform private.consume_rate_limit('forms.pdf.actor.minute',auth.uid()::text,interval '1 minute',10);
  perform private.consume_rate_limit('forms.pdf.actor.hour',auth.uid()::text,interval '1 hour',50);
  select jsonb_build_object('original_name',a.original_name,'size_bytes',a.size_bytes,
    'sha256_hex',a.sha256_hex,'contents_base64',replace(encode(a.contents,'base64'),chr(10),''))
    into strict result from private.spp_signed_agreements a where a.submission_id=p_submission_id;
  return result;
end;
$$;
revoke all on function public.app_get_spp_signed_agreement(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_spp_signed_agreement(uuid) to authenticated;

-- A pre-staged ID with mismatched facts aborts the transaction. On an ordinary
-- insert the existing notification and push pipeline runs unmodified.
create function private.spp_reserved_message(m public.project_messages) returns boolean
language plpgsql set search_path='' as $$
declare h private.spp_message_history;
begin
  select * into h from private.spp_message_history where message_id=m.id;
  if not found then return false; end if;
  if (h.order_id,h.author_profile_id,h.author_type,h.source_created_at,h.body_sha256)
      is distinct from (m.order_id,m.author_profile_id,m.author_type,m.created_at,encode(sha256(convert_to(m.body,'UTF8')),'hex')) then
    raise exception 'Historical message reservation mismatch' using errcode='23514';
  end if;
  return true;
end;
$$;
create function private.spp_payment_matches(h private.spp_payment_history,p public.invoice_payments) returns boolean
language sql immutable set search_path='' as $$
  select (h.payment_id,h.invoice_id,h.amount_cents,h.currency,h.settled_at,h.created_by_profile_id,h.request_id,h.source_payment_id,'spp_history','other','succeeded')
    is not distinct from (p.id,p.invoice_id,p.amount_cents,p.currency,p.settled_at,p.created_by_profile_id,p.request_id,p.processor_reference,p.processor,p.payment_method,p.status);
$$;
revoke all on function private.spp_payment_matches(private.spp_payment_history,public.invoice_payments) from public,anon,authenticated,service_role;

create function private.check_spp_payment_history() returns trigger language plpgsql set search_path='' as $$
declare parent public.invoices; payment public.invoice_payments;
begin
  select * into strict parent from public.invoices where id=new.invoice_id for share;
  if new.tenant_id is not null and new.tenant_id<>parent.tenant_id then
    raise exception 'Historical payment tenant mismatch' using errcode='23514';
  end if;
  new.tenant_id:=parent.tenant_id;
  if parent.currency<>new.currency or not exists(select 1 from private.spp_valid_invoice_orders l where l.invoice_id=parent.id) then
    raise exception 'Historical payment must match a confirmed imported invoice' using errcode='23514';
  end if;
  select * into payment from public.invoice_payments where id=new.payment_id;
  if found and not private.spp_payment_matches(new,payment) then
    raise exception 'Historical payment reservation mismatch' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_spp_payment_history() from public,anon,authenticated,service_role;
create trigger spp_payment_history_identity before insert or update on private.spp_payment_history
  for each row execute function private.check_spp_payment_history();

create function private.spp_reserved_payment(p public.invoice_payments) returns boolean
language plpgsql set search_path='' as $$
declare h private.spp_payment_history;
begin
  select * into h from private.spp_payment_history where payment_id=p.id;
  if not found then return false; end if;
  if not exists(select 1 from private.spp_valid_invoice_orders l where l.invoice_id=h.invoice_id) then
    raise exception 'Historical payment has no confirmed imported order' using errcode='23514';
  end if;
  if not private.spp_payment_matches(h,p) then
    raise exception 'Historical payment reservation mismatch' using errcode='23514';
  end if;
  return true;
end;
$$;
revoke all on function private.spp_reserved_message(public.project_messages), private.spp_reserved_payment(public.invoice_payments)
  from public,anon,authenticated,service_role;

-- Preserve the installed authorization, field redaction, quotas, ticket branches,
-- cursor validation, fingerprints and function ACLs. Abort on an unexpected baseline.
do $migration$
declare change record; original text; revised text; occurrences integer;
begin
  for change in select * from (values
    ('private.notify_client_project_response()'::regprocedure,1,
      'if new.author_type is distinct', 'if private.spp_reserved_message(new) then return new; end if;
  if new.author_type is distinct'),
    ('private.notify_invoice_payment()'::regprocedure,1,
      'if tg_op = ''UPDATE'' then', 'if tg_op = ''INSERT'' and private.spp_reserved_payment(new) then return new; end if;
  if tg_op = ''UPDATE'' then'),
    ('public.app_get_project_conversation(uuid)'::regprocedure,1,
      'from public.project_messages as message','from private.spp_dated_project_messages as message'),
    ('private.order_conversation_page_messages(uuid,uuid,uuid[],boolean)'::regprocedure,1,
      'from public.project_messages m','from private.spp_dated_project_messages m'),
    ('public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[])'::regprocedure,7,
      'from public.project_messages','from private.spp_dated_project_messages'),
    ('public.app_list_order_response_states(uuid[])'::regprocedure,1,
      'from public.project_messages message','from private.spp_dated_project_messages message'),
    ('public.app_list_my_order_response_states(uuid[])'::regprocedure,1,
      'from public.project_messages message','from private.spp_dated_project_messages message'),
    ('public.app_list_form_submissions(uuid,uuid)'::regprocedure,1,
      'order by s.submitted_at desc loop','order by private.spp_submitted_at(s) desc loop
   receipt.submitted_at:=private.spp_submitted_at(receipt);'),
    ('public.app_get_form_submission(uuid)'::regprocedure,1,
      'if not private.can_access_operational_order(submission_row.order_id)', 'submission_row.submitted_at:=private.spp_submitted_at(submission_row);
  if not private.can_access_operational_order(submission_row.order_id)'),
    ('public.app_get_form_submission(uuid)'::regprocedure,1,
      'return result||jsonb_build_object(''has_saved_credentials''',
      'return result||jsonb_build_object(''has_signed_agreement'',exists(select 1 from private.spp_signed_agreements a
        where a.submission_id=submission_row.id and private.can_read_spp_agreement(a.submission_id,a.order_id)))
    ||jsonb_build_object(''has_saved_credentials'''),
    ('public.app_get_form_submission_pdf(uuid)'::regprocedure,1,
      '''submitted_at'',original.submitted_at','''submitted_at'',original_detail->''submission''->''submitted_at'''),
    ('public.app_get_form_submission_pdf(uuid)'::regprocedure,1,
      '''submitted_at'',requested.submitted_at','''submitted_at'',requested_detail->''submission''->''submitted_at''')
  ) as patches(target,expected,anchor,replacement)
  loop
    select prosrc into strict original from pg_proc where oid=change.target;
    occurrences:=(length(original)-length(replace(original,change.anchor,'')))/length(change.anchor);
    if occurrences<>change.expected then raise exception 'Unexpected history projection baseline for %',change.target; end if;
    revised:=replace(original,change.anchor,change.replacement);
    execute replace(pg_get_functiondef(change.target),original,revised);
  end loop;
end;
$migration$;

create or replace function public.app_find_invoice_item_by_order_id(p_order_id uuid)
returns public.invoice_items language plpgsql stable security definer set search_path='' as $$
declare item public.invoice_items;
begin
  if not private.can_access_operational_order(p_order_id) then return null; end if;
  select * into item from public.invoice_items where order_id=p_order_id;
  if item.id is null then
    select i.* into item from private.spp_valid_invoice_orders l join public.invoice_items i on i.id=l.invoice_item_id
      where l.order_id=p_order_id;
  end if;
  if item.id is null or not private.can_read_invoice(item.invoice_id) then return null; end if;
  -- Return only the requested order identity, including for secondary source associations.
  item.order_id:=p_order_id;
  return item;
end;
$$;

create function public.app_get_invoice_order_history(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare linked_orders jsonb; shared_orders jsonb; historical_payments jsonb;
begin
  if not private.can_read_invoice(p_invoice_id) then raise exception 'Invoice access is denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(order_id order by order_id),'[]'::jsonb) into linked_orders from (
    select item.order_id from public.app_list_invoice_items(p_invoice_id) item where item.order_id is not null
    union
    select l.order_id from private.spp_valid_invoice_orders l where l.invoice_id=p_invoice_id and private.invoice_project_visible(l.order_id)
  ) visible;
  select coalesce(jsonb_agg(jsonb_build_object('order_id',l.order_id,'invoice_item_id',l.invoice_item_id,
      'source_order_reference',l.source_order_reference) order by l.source_order_reference,l.order_id),'[]'::jsonb) into shared_orders
    from private.spp_valid_invoice_orders l where l.invoice_id=p_invoice_id and private.invoice_project_visible(l.order_id);
  select coalesce(jsonb_agg(jsonb_build_object('payment_id',h.payment_id,'source_invoice_id',h.source_invoice_id,
      'source_provider',h.source_provider,'source_payment_id',h.source_payment_id) order by h.payment_id),'[]'::jsonb)
    into historical_payments from private.spp_payment_history h join public.invoice_payments p on p.id=h.payment_id and p.invoice_id=h.invoice_id
    where h.invoice_id=p_invoice_id and private.current_account_class()='internal' and private.spp_payment_matches(h,p);
  return jsonb_build_object('order_ids',linked_orders,'shared_orders',shared_orders,'payments',historical_payments);
end;
$$;
revoke all on function public.app_get_invoice_order_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_invoice_order_history(uuid) to authenticated;
