-- Team Communication V2.7: private voice recordings and auditable text pins.
-- All application access remains behind SECURITY DEFINER RPCs. The browser
-- receives only one-object signed Storage capabilities; it never receives a
-- Supabase authenticated JWT or direct table access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-voice-messages',
  'team-voice-messages',
  false,
  5242880,
  array[
    'audio/webm', 'audio/webm;codecs=opus',
    'audio/ogg', 'audio/ogg;codecs=opus',
    'audio/mp4'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.team_messages
  add column voice_storage_path text,
  add column voice_duration_ms integer,
  add column voice_size_bytes integer,
  add column voice_mime_type text,
  add column voice_expires_at timestamptz,
  add column voice_expired_at timestamptz;

alter table public.team_messages
  drop constraint team_messages_type_valid,
  drop constraint team_messages_activity_shape_valid;

alter table public.team_messages
  add constraint team_messages_type_valid
    check (message_type in ('text', 'voice', 'task_activity', 'governance_activity')),
  add constraint team_messages_activity_shape_valid
    check (
      (message_type = 'text' and task_id is null and task_action is null)
      or (message_type = 'voice' and task_id is null and task_action is null)
      or (message_type = 'task_activity' and task_id is not null
        and task_action in ('completed', 'reopened', 'created'))
      or (message_type = 'governance_activity' and task_id is null and task_action is null)
    ),
  add constraint team_messages_voice_shape_valid
    check (
      (
        message_type = 'voice'
        and voice_duration_ms between 1 and 300000
        and voice_size_bytes between 1 and 5242880
        and voice_mime_type in ('audio/webm', 'audio/ogg', 'audio/mp4')
        and voice_expires_at is not null
        and (
          (voice_expired_at is null and voice_storage_path is not null)
          or (voice_expired_at is not null and voice_storage_path is null)
        )
      )
      or (
        message_type <> 'voice'
        and voice_storage_path is null
        and voice_duration_ms is null
        and voice_size_bytes is null
        and voice_mime_type is null
        and voice_expires_at is null
        and voice_expired_at is null
      )
    );

create index team_messages_voice_retention_idx
  on public.team_messages (voice_expires_at, id)
  where message_type = 'voice' and voice_expired_at is null;

create table private.team_voice_uploads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  storage_path text not null unique,
  declared_mime_type text not null
    check (declared_mime_type in ('audio/webm', 'audio/ogg', 'audio/mp4')),
  status text not null default 'pending'
    check (status in ('pending', 'finalized', 'abandoned')),
  message_id uuid unique references public.team_messages (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_voice_uploads_state_valid check (
    (status = 'pending' and message_id is null and finalized_at is null)
    or (status = 'finalized' and message_id is not null and finalized_at is not null)
    or (status = 'abandoned' and message_id is null and finalized_at is null)
  )
);

alter table private.team_voice_uploads enable row level security;
alter table private.team_voice_uploads force row level security;
revoke all on table private.team_voice_uploads from public, anon, authenticated, service_role;

create index team_voice_uploads_cleanup_idx
  on private.team_voice_uploads (expires_at, id)
  where status = 'pending';

alter table public.team_messages
  add constraint team_messages_id_conversation_unique unique (id, conversation_id);

create table public.team_message_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.team_conversations (id) on delete cascade,
  message_id uuid not null,
  pinned_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  pinned_at timestamptz not null default now(),
  unpinned_by_profile_id uuid references public.profiles (id) on delete restrict,
  unpinned_at timestamptz,
  constraint team_message_pins_message_conversation_fk
    foreign key (message_id, conversation_id)
    references public.team_messages (id, conversation_id) on delete cascade,
  constraint team_message_pins_unpin_state_valid check (
    (unpinned_at is null and unpinned_by_profile_id is null)
    or (unpinned_at is not null and unpinned_by_profile_id is not null and unpinned_at >= pinned_at)
  )
);

alter table public.team_message_pins enable row level security;
alter table public.team_message_pins force row level security;
revoke all on table public.team_message_pins from public, anon, authenticated, service_role;

create unique index team_message_pins_one_active_idx
  on public.team_message_pins (conversation_id, message_id)
  where unpinned_at is null;
create index team_message_pins_current_idx
  on public.team_message_pins (conversation_id, pinned_at desc, id desc)
  where unpinned_at is null;
create index team_message_pins_history_idx
  on public.team_message_pins (conversation_id, unpinned_at desc, id desc)
  where unpinned_at is not null;

create or replace function private.team_conversation_is_admin_or_owner(
  p_conversation_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.team_conversation_is_owner(p_conversation_id, p_profile_id)
    or exists (
      select 1 from public.team_conversation_admins as admin_row
      where admin_row.conversation_id = p_conversation_id
        and admin_row.profile_id = p_profile_id
    );
$$;
revoke all on function private.team_conversation_is_admin_or_owner(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.require_team_conversation_admin_or_owner(
  p_conversation_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
begin
  if not private.team_conversation_is_admin_or_owner(p_conversation_id, actor_id) then
    raise exception 'owner or conversation admin required' using errcode = '42501';
  end if;
  return actor_id;
end;
$$;
revoke all on function private.require_team_conversation_admin_or_owner(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.team_message_json(p_message_id uuid, p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', message.id,
    'request_id', message.request_id,
    'conversation_id', message.conversation_id,
    'author_profile_id', message.author_profile_id,
    'author_name', author.display_name,
    'author_avatar_url', author.avatar_url,
    'body', case when message.deleted_for_everyone_at is null then message.body else '' end,
    'message_type', message.message_type,
    'task_id', message.task_id,
    'task_action', message.task_action,
    'created_at', message.created_at,
    'reply_to_message_id', message.reply_to_message_id,
    'reply_quote_text', case when reply_source.deleted_for_everyone_at is null
      then message.reply_quote_text else null end,
    'reply_source_author_name', reply_author.display_name,
    'reply_source_deleted', coalesce(reply_source.deleted_for_everyone_at is not null, false),
    'forwarded_from_message_id', message.forwarded_from_message_id,
    'forwarded_from_author_name', message.forwarded_from_author_name,
    'deleted_for_everyone', message.deleted_for_everyone_at is not null,
    'voice_storage_path', case when message.voice_expired_at is null then message.voice_storage_path else null end,
    'voice_duration_ms', message.voice_duration_ms,
    'voice_size_bytes', message.voice_size_bytes,
    'voice_mime_type', message.voice_mime_type,
    'voice_expires_at', message.voice_expires_at,
    'voice_expired_at', message.voice_expired_at,
    'reactions', private.team_message_reactions_json(message.id, p_actor_id)
  )
  from public.team_messages as message
  join public.profiles as author on author.id = message.author_profile_id
  left join public.team_messages as reply_source on reply_source.id = message.reply_to_message_id
  left join public.profiles as reply_author on reply_author.id = reply_source.author_profile_id
  where message.id = p_message_id;
$$;
revoke all on function private.team_message_json(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.team_message_pins_json(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pin.id,
    'conversation_id', pin.conversation_id,
    'message_id', pin.message_id,
    'author_profile_id', message.author_profile_id,
    'author_name', author.display_name,
    'text_preview', case when message.deleted_for_everyone_at is null
      then left(regexp_replace(private.team_message_plain_text(message.body), '[[:space:]]+', ' ', 'g'), 240)
      else '' end,
    'message_created_at', message.created_at,
    'message_deleted', message.deleted_for_everyone_at is not null,
    'pinned_by_profile_id', pin.pinned_by_profile_id,
    'pinned_by_name', pinner.display_name,
    'pinned_at', pin.pinned_at,
    'unpinned_by_profile_id', pin.unpinned_by_profile_id,
    'unpinned_by_name', unpinner.display_name,
    'unpinned_at', pin.unpinned_at
  ) order by (pin.unpinned_at is null) desc, pin.pinned_at desc, pin.id desc), '[]'::jsonb)
  from public.team_message_pins as pin
  join public.team_messages as message on message.id = pin.message_id
  join public.profiles as author on author.id = message.author_profile_id
  join public.profiles as pinner on pinner.id = pin.pinned_by_profile_id
  left join public.profiles as unpinner on unpinner.id = pin.unpinned_by_profile_id
  where pin.conversation_id = p_conversation_id;
$$;
revoke all on function private.team_message_pins_json(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the established conversation projection and decorate it locally.
alter function public.app_get_team_conversation(uuid)
  rename to app_get_team_conversation_v26_base;
alter function public.app_get_team_conversation_v26_base(uuid) set schema private;
revoke all on function private.app_get_team_conversation_v26_base(uuid)
  from public, anon, authenticated, service_role;

create function public.app_get_team_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_member(p_conversation_id);
  base jsonb := private.app_get_team_conversation_v26_base(p_conversation_id);
begin
  return jsonb_set(
    base,
    '{my_capabilities}',
    coalesce(base -> 'my_capabilities', '{}'::jsonb) || jsonb_build_object(
      'can_send_voice', private.team_conversation_is_admin_or_owner(p_conversation_id, actor_id),
      'can_manage_pins', private.team_conversation_is_admin_or_owner(p_conversation_id, actor_id)
    ),
    true
  ) || jsonb_build_object('pins', private.team_message_pins_json(p_conversation_id));
end;
$$;
revoke all on function public.app_get_team_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_team_conversation(uuid) to authenticated;

create or replace function public.app_prepare_team_voice_upload(
  p_conversation_id uuid,
  p_mime_type text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_conversation_admin_or_owner(p_conversation_id);
  upload_id uuid := gen_random_uuid();
  canonical_mime text := lower(split_part(coalesce(p_mime_type, ''), ';', 1));
  extension text;
  created private.team_voice_uploads%rowtype;
begin
  if canonical_mime not in ('audio/webm', 'audio/ogg', 'audio/mp4') then
    raise exception 'unsupported audio format' using errcode = '22023';
  end if;
  extension := case canonical_mime when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' else 'mp4' end;
  perform private.consume_rate_limit('team.voice.upload.actor.minute', actor_id::text, interval '1 minute', 12);
  insert into private.team_voice_uploads (
    id, conversation_id, created_by_profile_id, storage_path, declared_mime_type
  ) values (
    upload_id, p_conversation_id, actor_id,
    p_conversation_id::text || '/' || upload_id::text || '/audio.' || extension,
    canonical_mime
  ) returning * into created;
  return jsonb_build_object(
    'upload_id', created.id,
    'conversation_id', created.conversation_id,
    'storage_path', created.storage_path,
    'declared_mime_type', created.declared_mime_type,
    'expires_at', created.expires_at
  );
end;
$$;
revoke all on function public.app_prepare_team_voice_upload(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_prepare_team_voice_upload(uuid, text) to authenticated;

create or replace function public.app_get_team_voice_upload_context(p_upload_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  upload private.team_voice_uploads%rowtype;
begin
  select * into upload from private.team_voice_uploads where id = p_upload_id;
  if upload is null then raise exception 'voice upload not found' using errcode = 'P0002'; end if;
  perform private.require_team_conversation_admin_or_owner(upload.conversation_id);
  if upload.created_by_profile_id <> actor_id then
    raise exception 'voice upload belongs to another actor' using errcode = '42501';
  end if;
  return to_jsonb(upload);
end;
$$;
revoke all on function public.app_get_team_voice_upload_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_team_voice_upload_context(uuid) to authenticated;

create or replace function public.app_finalize_team_voice_upload(
  p_upload_id uuid,
  p_duration_ms integer,
  p_size_bytes integer,
  p_mime_type text,
  p_retention_days integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_team_actor();
  upload private.team_voice_uploads%rowtype;
  sent public.team_messages%rowtype;
begin
  select * into upload from private.team_voice_uploads where id = p_upload_id for update;
  if upload is null then raise exception 'voice upload not found' using errcode = 'P0002'; end if;
  perform private.require_team_conversation_admin_or_owner(upload.conversation_id);
  if upload.created_by_profile_id <> actor_id then
    raise exception 'voice upload belongs to another actor' using errcode = '42501';
  end if;
  if upload.status = 'finalized' then
    select * into sent from public.team_messages where id = upload.message_id;
    return jsonb_build_object('id', sent.id, 'request_id', sent.request_id,
      'conversation_id', sent.conversation_id, 'author_profile_id', sent.author_profile_id,
      'body', sent.body, 'created_at', sent.created_at);
  end if;
  if upload.status <> 'pending' or upload.expires_at <= clock_timestamp() then
    raise exception 'voice upload expired' using errcode = '22023';
  end if;
  if p_duration_ms not between 1 and 300000 or p_size_bytes not between 1 and 5242880
     or p_mime_type not in ('audio/webm', 'audio/ogg', 'audio/mp4')
     or p_mime_type <> upload.declared_mime_type
     or p_retention_days not between 30 and 365 then
    raise exception 'invalid canonical voice metadata' using errcode = '22023';
  end if;

  perform private.enforce_team_slow_mode(upload.conversation_id, actor_id);
  perform private.consume_rate_limit('team.message.actor.minute', actor_id::text, interval '1 minute', 30);
  perform private.consume_rate_limit('team.message.actor.hour', actor_id::text, interval '1 hour', 200);

  insert into public.team_messages (
    request_id, conversation_id, author_profile_id, body, message_type,
    voice_storage_path, voice_duration_ms, voice_size_bytes, voice_mime_type, voice_expires_at
  ) values (
    upload.id, upload.conversation_id, actor_id, 'Voice message', 'voice',
    upload.storage_path, p_duration_ms, p_size_bytes, p_mime_type,
    clock_timestamp() + make_interval(days => p_retention_days)
  ) returning * into sent;

  update private.team_voice_uploads
  set status = 'finalized', message_id = sent.id, finalized_at = clock_timestamp()
  where id = upload.id;
  update public.team_conversations set last_message_at = sent.created_at
  where id = upload.conversation_id;
  perform private.record_team_message_delivery(sent.id, upload.conversation_id, actor_id, sent.created_at);

  return jsonb_build_object('id', sent.id, 'request_id', sent.request_id,
    'conversation_id', sent.conversation_id, 'author_profile_id', sent.author_profile_id,
    'body', sent.body, 'created_at', sent.created_at);
end;
$$;
revoke all on function public.app_finalize_team_voice_upload(uuid, integer, integer, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.app_finalize_team_voice_upload(uuid, integer, integer, text, integer)
  to authenticated;

create or replace function public.app_get_team_voice_playback(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  message public.team_messages%rowtype;
begin
  select * into message from public.team_messages where id = p_message_id;
  if message is null or message.message_type <> 'voice' then
    raise exception 'voice message not found' using errcode = 'P0002';
  end if;
  perform private.require_team_conversation_member(message.conversation_id);
  return jsonb_build_object(
    'message_id', message.id, 'conversation_id', message.conversation_id,
    'storage_path', message.voice_storage_path, 'mime_type', message.voice_mime_type,
    'duration_ms', message.voice_duration_ms, 'expired_at', message.voice_expired_at
  );
end;
$$;
revoke all on function public.app_get_team_voice_playback(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_team_voice_playback(uuid) to authenticated;

create or replace function public.app_pin_team_message(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  message public.team_messages%rowtype;
  actor_id uuid;
  pin public.team_message_pins%rowtype;
begin
  select * into message from public.team_messages where id = p_message_id;
  if message is null then raise exception 'message not found' using errcode = 'P0002'; end if;
  actor_id := private.require_team_conversation_admin_or_owner(message.conversation_id);
  if message.message_type <> 'text' or message.deleted_for_everyone_at is not null then
    raise exception 'only available text messages can be pinned' using errcode = '22023';
  end if;
  select * into pin from public.team_message_pins
  where conversation_id = message.conversation_id and message_id = message.id and unpinned_at is null;
  if pin is null then
    perform private.consume_rate_limit('team.pin.actor.minute', actor_id::text, interval '1 minute', 60);
    insert into public.team_message_pins (conversation_id, message_id, pinned_by_profile_id)
    values (message.conversation_id, message.id, actor_id) returning * into pin;
    update public.team_conversations set updated_at = clock_timestamp() where id = message.conversation_id;
  end if;
  return (
    select item from jsonb_array_elements(private.team_message_pins_json(pin.conversation_id)) as item
    where item ->> 'id' = pin.id::text
  );
end;
$$;
revoke all on function public.app_pin_team_message(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_pin_team_message(uuid) to authenticated;

create or replace function public.app_unpin_team_message(p_pin_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pin public.team_message_pins%rowtype;
  actor_id uuid;
  changed_at timestamptz := clock_timestamp();
begin
  select * into pin from public.team_message_pins where id = p_pin_id for update;
  if pin is null then raise exception 'pin not found' using errcode = 'P0002'; end if;
  actor_id := private.require_team_conversation_admin_or_owner(pin.conversation_id);
  if pin.unpinned_at is null then
    perform private.consume_rate_limit('team.unpin.actor.minute', actor_id::text, interval '1 minute', 60);
    update public.team_message_pins set unpinned_by_profile_id = actor_id, unpinned_at = changed_at
    where id = pin.id returning * into pin;
    update public.team_conversations set updated_at = changed_at where id = pin.conversation_id;
  end if;
  return (
    select item from jsonb_array_elements(private.team_message_pins_json(pin.conversation_id)) as item
    where item ->> 'id' = pin.id::text
  );
end;
$$;
revoke all on function public.app_unpin_team_message(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_unpin_team_message(uuid) to authenticated;

create or replace function private.team_unpin_deleted_message()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.deleted_for_everyone_at is null and new.deleted_for_everyone_at is not null then
    update public.team_message_pins
    set unpinned_by_profile_id = new.deleted_for_everyone_by,
        unpinned_at = new.deleted_for_everyone_at
    where message_id = new.id and unpinned_at is null;
  end if;
  return new;
end;
$$;
revoke all on function private.team_unpin_deleted_message()
  from public, anon, authenticated, service_role;
create trigger team_messages_unpin_on_delete
after update of deleted_for_everyone_at on public.team_messages
for each row execute function private.team_unpin_deleted_message();

create or replace function public.app_list_team_voice_cleanup_batch(p_limit integer default 100)
returns table (object_kind text, record_id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  select candidate.object_kind, candidate.record_id, candidate.storage_path
  from (
    select 'message'::text, message.id, message.voice_storage_path, message.voice_expires_at as due_at
    from public.team_messages as message
    where message.message_type = 'voice' and message.voice_expired_at is null
      and message.voice_storage_path is not null and message.voice_expires_at <= clock_timestamp()
    union all
    select 'upload'::text, upload.id, upload.storage_path, upload.expires_at
    from private.team_voice_uploads as upload
    where upload.status = 'pending' and upload.expires_at <= clock_timestamp()
  ) as candidate(object_kind, record_id, storage_path, due_at)
  order by candidate.due_at, candidate.record_id
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;
revoke all on function public.app_list_team_voice_cleanup_batch(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.app_list_team_voice_cleanup_batch(integer) to service_role;

create or replace function public.app_complete_team_voice_cleanup(
  p_object_kind text,
  p_record_id uuid,
  p_expected_path text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed_conversation_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_object_kind = 'message' then
    update public.team_messages
    set voice_storage_path = null, voice_expired_at = coalesce(voice_expired_at, clock_timestamp())
    where id = p_record_id and message_type = 'voice'
      and voice_storage_path = p_expected_path and voice_expires_at <= clock_timestamp()
    returning conversation_id into changed_conversation_id;
    if changed_conversation_id is not null then
      update public.team_conversations set updated_at = clock_timestamp()
      where id = changed_conversation_id;
    end if;
  elsif p_object_kind = 'upload' then
    update private.team_voice_uploads set status = 'abandoned'
    where id = p_record_id and status = 'pending'
      and storage_path = p_expected_path and expires_at <= clock_timestamp();
  else
    raise exception 'invalid cleanup object kind' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.app_complete_team_voice_cleanup(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.app_complete_team_voice_cleanup(text, uuid, text) to service_role;

comment on table public.team_message_pins is
  'Append-only pin history. A partial unique index allows one active pin per message; unpinning timestamps the existing row.';
comment on table private.team_voice_uploads is
  'Short-lived server-issued claims tying one private Storage path to one privileged Team actor and conversation.';
