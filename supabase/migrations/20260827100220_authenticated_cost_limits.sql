-- Trusted-server throttle for authenticated actions whose application path can
-- fan out to several database reads, an external provider, Auth Admin, or a
-- notification-heavy mutation. The browser cannot select a subject or consume
-- this function directly; the server passes its already-verified actor and,
-- where relevant, organization id.

create or replace function public.app_consume_server_cost_limit(
  p_actor_id uuid,
  p_action text,
  p_organization_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null then
    raise exception 'verified actor required' using errcode = '22023';
  end if;

  case p_action
    when 'search.global' then
      perform private.consume_rate_limit(
        'cost.search.global.actor.minute', p_actor_id::text, interval '1 minute', 60
      );

    when 'search.client' then
      if p_organization_id is null then
        raise exception 'organization required' using errcode = '22023';
      end if;
      perform private.consume_rate_limit(
        'cost.search.client.actor.minute', p_actor_id::text, interval '1 minute', 30
      );
      perform private.consume_rate_limit(
        'cost.search.client.organization.minute', p_organization_id::text, interval '1 minute', 120
      );

    when 'report.send' then
      perform private.consume_rate_limit(
        'cost.report.send.actor.hour', p_actor_id::text, interval '1 hour', 20
      );
      if p_organization_id is not null then
        perform private.consume_rate_limit(
          'cost.report.send.organization.hour', p_organization_id::text, interval '1 hour', 30
        );
      end if;

    when 'integration.gmail.verify' then
      perform private.consume_rate_limit(
        'cost.integration.gmail.verify.actor.minute', p_actor_id::text, interval '1 minute', 5
      );
      perform private.consume_rate_limit(
        'cost.integration.gmail.verify.actor.hour', p_actor_id::text, interval '1 hour', 20
      );

    when 'account.provision' then
      perform private.consume_rate_limit(
        'cost.account.provision.actor.hour', p_actor_id::text, interval '1 hour', 10
      );

    when 'billing.stripe_customer' then
      perform private.consume_rate_limit(
        'cost.billing.stripe_customer.actor.hour', p_actor_id::text, interval '1 hour', 30
      );
      if p_organization_id is not null then
        perform private.consume_rate_limit(
          'cost.billing.stripe_customer.organization.hour', p_organization_id::text, interval '1 hour', 10
        );
      end if;

    else
      raise exception 'unsupported cost-limit action' using errcode = '22023';
  end case;
end;
$$;

revoke all on function public.app_consume_server_cost_limit(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.app_consume_server_cost_limit(uuid, text, uuid)
  to service_role;

comment on function public.app_consume_server_cost_limit(uuid, text, uuid) is
  'Service-role-only durable throttle for selected authenticated high-fan-out or provider-backed application actions.';
