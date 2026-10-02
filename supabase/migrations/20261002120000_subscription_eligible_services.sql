-- Subscription eligibility is its own concept: a Service a client can be put on
-- a recurring plan for. It is deliberately not services.recurring (which drives
-- Store checkout) and not folder membership. Controlled by data only for now.

alter table public.services
  add column subscription_eligible boolean not null default false;

comment on column public.services.subscription_eligible is
  'True when admins may start or move a Subscription onto this Service. Independent of recurring.';

-- Initial approved subscription products, by stable catalogue ID (not name).
update public.services
set subscription_eligible = true
where id in (
  '5f000000-0000-4000-8000-000000000318', -- GMB/GBP Management
  '5f000000-0000-4000-8000-000000000555', -- Bespoke SEO Success Blueprint (Unlimited Targeted Keywords)
  '5f000000-0000-4000-8000-000000000563', -- Foundational SEO (20 Targeted Keywords)
  '5f000000-0000-4000-8000-000000000123', -- Platinum SEO Success Blueprint (100 Targeted Keywords)
  '5f000000-0000-4000-8000-000000000554', -- SEO Success Blueprint
  '5f000000-0000-4000-8000-000000000124', -- SEO Success Blueprint (50 Targeted Keywords)
  '5f000000-0000-4000-8000-000000000546'  -- Starter SEO
);

-- Plan items are inserted only by private.insert_subscription_plan_items, which
-- both app_create_subscription and app_update_subscription_terms call, so one
-- trigger enforces eligibility for every RPC caller whatever the UI sent.
-- A subscription's first plan version needs an eligible, active Service. Later
-- versions may keep a Service the subscription already carries even if it is no
-- longer eligible, so existing subscriptions stay editable.
create or replace function private.enforce_subscription_service_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row public.subscriptions;
  is_first_version boolean;
begin
  select subscription.* into subscription_row
  from public.subscription_plan_versions as plan
  join public.subscriptions as subscription on subscription.id = plan.subscription_id
  where plan.id = new.plan_version_id;

  is_first_version := not exists (
    select 1 from public.subscription_plan_versions as plan
    where plan.subscription_id = subscription_row.id
      and plan.id <> new.plan_version_id
  );

  if is_first_version and not exists (
    select 1 from public.services as service
    where service.id = subscription_row.service_id
      and service.subscription_eligible and service.is_active and service.archived_at is null
  ) then
    raise exception 'Service is not eligible for Subscriptions' using errcode = '23514';
  end if;

  if new.service_id is not null
    and not exists (
      select 1 from public.services as service
      where service.id = new.service_id
        and service.subscription_eligible and service.is_active and service.archived_at is null
    )
    and (
      is_first_version
      or (
        new.service_id is distinct from subscription_row.service_id
        and not exists (
          select 1
          from public.subscription_plan_items as prior_item
          join public.subscription_plan_versions as prior_plan on prior_plan.id = prior_item.plan_version_id
          where prior_plan.subscription_id = subscription_row.id
            and prior_plan.id <> new.plan_version_id
            and prior_item.service_id = new.service_id
        )
      )
    )
  then
    raise exception 'Service is not eligible for Subscriptions' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_subscription_service_eligibility() from public, anon, authenticated, service_role;

create trigger subscription_plan_items_enforce_service_eligibility
before insert on public.subscription_plan_items
for each row execute function private.enforce_subscription_service_eligibility();
