-- SPP references are business identifiers. Existing order URLs and joins still
-- use the order UUID, and native orders still use their generated numbers.
alter table public.orders
  add column spp_order_reference text,
  add constraint orders_spp_order_reference_format
    check (spp_order_reference ~ '^[0-9A-F]{8}(_[0-9]{1,16})?$');

create unique index orders_tenant_spp_order_reference_idx
  on public.orders (tenant_id, spp_order_reference)
  where spp_order_reference is not null;

-- The verified historical import recorded these references in title suffixes.
-- Only recover markers on orders predating their completed SPP account claim.
with imported as (
  select o.id,
    substring(o.title from ' \[SPP #([0-9A-F]{8}(_[0-9]{1,16})?)\]$') as reference
  from public.orders o
  where o.tenant_id = private.wolf_forge_tenant_id()
    and o.title ~ ' \[SPP #[0-9A-F]{8}(_[0-9]{1,16})?\]$'
    and exists (
      select 1 from private.spp_account_references a
      where a.tenant_id = o.tenant_id and a.company_id = o.company_id
        and a.state = 'complete' and o.created_at < a.created_at
    )
)
update public.orders o
set spp_order_reference = imported.reference
from imported
where o.id = imported.id;

-- Trusted loaders can write the Orders CSV "id" directly. The existing history
-- loader's title marker can also populate it, including when added after insert.
create function private.guard_spp_order_reference()
returns trigger language plpgsql set search_path = '' as $$
declare
  tagged_reference text;
begin
  if (select auth.uid()) is not null then
    if (tg_op = 'INSERT' and new.spp_order_reference is not null)
      or (tg_op = 'UPDATE' and new.spp_order_reference is distinct from old.spp_order_reference)
    then
      raise exception 'Only an import can change an SPP order reference' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Only the historical SQL loader (postgres) needs the private account lookup.
  if new.spp_order_reference is not null or current_user <> 'postgres' then
    return new;
  end if;

  tagged_reference := substring(new.title from ' \[SPP #([0-9A-F]{8}(_[0-9]{1,16})?)\]$');
  if tagged_reference is not null and new.tenant_id = private.wolf_forge_tenant_id() and exists (
    select 1 from private.spp_account_references a
    where a.tenant_id = new.tenant_id and a.company_id = new.company_id
      and a.state = 'complete' and new.created_at < a.created_at
  ) then
    new.spp_order_reference := tagged_reference;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_spp_order_reference() from public, anon, authenticated, service_role;

create trigger orders_guard_spp_order_reference
  before insert or update of title, spp_order_reference on public.orders
  for each row execute function private.guard_spp_order_reference();

comment on column public.orders.spp_order_reference is
  'Exact SPP Orders CSV id, including its optional underscore suffix. Set only by trusted imports.';
