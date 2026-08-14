begin;

select plan(1);

insert into public.coupons (
  id, code, discount_type, recurring_duration, single_use_per_customer,
  new_customers_only, is_active
)
values (
  '59000000-0000-0000-0000-000000000001', 'TRIGGERFIX', 'fixed',
  'forever', false, false, true
);

insert into public.coupon_discount_rules (
  coupon_id, discount_value, applies_to_all, sort_order
)
values (
  '59000000-0000-0000-0000-000000000001', 10, true, 0
);

select lives_ok(
  $$set constraints all immediate$$,
  'coupon scope trigger resolves the correct row type at transaction commit'
);

select * from finish();
rollback;
