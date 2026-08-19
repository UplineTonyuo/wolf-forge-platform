-- Wolf Forge Platform - Ticket conversation avatars
--
-- Adds one nullable avatar URL to the existing profiles identity model.
-- No second user/profile system is introduced.
--
-- The new Ticket detail wrapper first calls app_get_ticket_detail(), which
-- remains the authoritative authorization/privacy boundary. Only messages
-- already present in that authorized result are enriched with the author's
-- avatar URL. This does not expose a generic profile directory to clients.

alter table public.profiles
add column if not exists avatar_url text;

alter table public.profiles
drop constraint if exists profiles_avatar_url_not_blank;

alter table public.profiles
add constraint profiles_avatar_url_not_blank
check (
  avatar_url is null
  or btrim(avatar_url) <> ''
);

create or replace function public.app_get_ticket_detail_with_avatars(
  p_ticket_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  detail jsonb;
  enriched_messages jsonb;
begin
  -- Reuse the existing Ticket boundary. This call performs the same actor,
  -- company, internal-note and attachment visibility checks as before.
  detail := public.app_get_ticket_detail(p_ticket_id);

  if detail is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      message_row.value ||
      jsonb_build_object(
        'author_avatar_url',
        (
          select profile_row.avatar_url
          from public.profiles as profile_row
          where profile_row.id =
            nullif(
              message_row.value ->> 'author_profile_id',
              ''
            )::uuid
            and profile_row.archived_at is null
        )
      )
      order by message_row.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_messages
  from jsonb_array_elements(
    coalesce(
      detail -> 'messages',
      '[]'::jsonb
    )
  )
  with ordinality as message_row(value, ordinality);

  return jsonb_set(
    detail,
    '{messages}',
    enriched_messages,
    true
  );
end;
$$;

revoke all
on function public.app_get_ticket_detail_with_avatars(uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.app_get_ticket_detail_with_avatars(uuid)
to authenticated;

comment on function public.app_get_ticket_detail_with_avatars(uuid)
is 'Returns the existing authorized Ticket detail with avatar_url added only for authors of messages already visible to the caller.';