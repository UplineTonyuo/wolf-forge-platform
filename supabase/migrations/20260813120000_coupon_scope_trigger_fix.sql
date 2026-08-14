-- Fix deferred coupon scope enforcement across its two trigger row types.
--
-- The original declaration referenced OLD.coupon_discount_rule_id while the
-- function was executing for coupon_discount_rules, whose OLD row has no such
-- field. pgTAP transactions rolled back before deferred constraints fired,
-- while real RPC transactions correctly exposed the commit-time failure.

create or replace function private.enforce_coupon_discount_rule_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_rule_id uuid;
  rule_row public.coupon_discount_rules;
begin
  if tg_table_name = 'coupon_discount_services' then
    if tg_op = 'DELETE' then
      target_rule_id := old.coupon_discount_rule_id;
    else
      target_rule_id := new.coupon_discount_rule_id;
    end if;
  elsif tg_op = 'DELETE' then
    target_rule_id := old.id;
  else
    target_rule_id := new.id;
  end if;

  select discount_rule.*
  into rule_row
  from public.coupon_discount_rules as discount_rule
  where discount_rule.id = target_rule_id;

  -- A cascaded delete has already removed the owning rule.
  if rule_row.id is null then
    return null;
  end if;

  if rule_row.applies_to_all and exists (
    select 1
    from public.coupon_discount_services as membership
    where membership.coupon_discount_rule_id = rule_row.id
  ) then
    raise exception 'all-services coupon rules cannot have service memberships'
      using errcode = '23514';
  end if;

  if not rule_row.applies_to_all and not exists (
    select 1
    from public.coupon_discount_services as membership
    join public.services as service_row
      on service_row.id = membership.service_id
     and service_row.is_active
     and service_row.archived_at is null
    where membership.coupon_discount_rule_id = rule_row.id
  ) then
    raise exception 'specific-service coupon rules require an active service'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_coupon_discount_rule_scope()
from public, anon, authenticated, service_role;
