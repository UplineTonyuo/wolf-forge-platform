-- Team presence: one short-lived row per live browser tab/device connection.
--
-- This deliberately does NOT add profiles.online. A profile is online while at
-- least one independently heartbeating connection remains fresh, so closing
-- one of several tabs cannot overwrite the others.

create table public.team_presence_connections (
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  connection_id uuid not null,
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key (profile_id, connection_id)
);

create index team_presence_connections_last_seen_idx
  on public.team_presence_connections (last_seen_at);

alter table public.team_presence_connections enable row level security;
alter table public.team_presence_connections force row level security;

revoke all on table public.team_presence_connections
  from public, anon, authenticated, service_role;

comment on table public.team_presence_connections is
  'Ephemeral internal browser connections. Online is derived from fresh rows; never a profile flag.';

-- Heartbeat one server-derived actor connection and return only the safe
-- presence projection required by the UI: active internal profile ids.
create or replace function public.app_touch_team_presence(
  p_connection_id uuid
)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  observed_at timestamptz := clock_timestamp();
  online_profile_ids uuid[];
begin
  if p_connection_id is null then
    raise exception 'connection id is required'
      using errcode = '22023';
  end if;

  -- Browser crashes cannot send a disconnect. Freshness, not deletion, is the
  -- authority; opportunistic pruning keeps the ephemeral table bounded.
  delete from public.team_presence_connections as connection_row
  where connection_row.last_seen_at < observed_at - interval '90 seconds';

  insert into public.team_presence_connections (
    profile_id,
    connection_id,
    last_seen_at
  )
  values (actor_id, p_connection_id, observed_at)
  on conflict (profile_id, connection_id)
  do update set last_seen_at = excluded.last_seen_at;

  select coalesce(
    array_agg(active.profile_id order by active.profile_id),
    '{}'::uuid[]
  )
  into online_profile_ids
  from (
    select distinct connection_row.profile_id
    from public.team_presence_connections as connection_row
    join public.profiles as profile_row
      on profile_row.id = connection_row.profile_id
    where connection_row.last_seen_at >= observed_at - interval '90 seconds'
      and profile_row.archived_at is null
      and private.profile_has_permission(
        connection_row.profile_id,
        'team_messages.use'
      )
  ) as active;

  return online_profile_ids;
end;
$$;

revoke all on function public.app_touch_team_presence(uuid)
  from public, anon;

grant execute on function public.app_touch_team_presence(uuid)
  to authenticated;

-- Best-effort page-exit cleanup. The profile is always auth.uid()-derived, so
-- a browser can remove only its own matching connection row.
create or replace function public.app_disconnect_team_presence(
  p_connection_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
begin
  if p_connection_id is null then
    raise exception 'connection id is required'
      using errcode = '22023';
  end if;

  delete from public.team_presence_connections as connection_row
  where connection_row.profile_id = actor_id
    and connection_row.connection_id = p_connection_id;
end;
$$;

revoke all on function public.app_disconnect_team_presence(uuid)
  from public, anon;

grant execute on function public.app_disconnect_team_presence(uuid)
  to authenticated;
