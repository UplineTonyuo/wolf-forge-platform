create or replace function private.notify_team_message_mentions()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  target text;
  targets uuid[] := '{}';
  mention_all boolean := false;
  recipient uuid;
  tenant uuid;
  group_title text;
begin
  if new.message_type <> 'text' or new.deleted_for_everyone_at is not null
    or new.forwarded_from_message_id is not null or new.forwarded_from_ticket_message_id is not null then return new; end if;
  mention_all := new.body ~ '(^|[[:space:]])@everyone([[:space:].,!?;:]|$)';
  for target in select (match)[1] from regexp_matches(new.body, '\]\(mention:([^)]*)\)', 'gi') as match loop
    if lower(target) = 'everyone' then mention_all := true;
    elsif target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      targets := array_append(targets, target::uuid);
    else raise exception 'invalid mention' using errcode = '22023'; end if;
  end loop;
  if not mention_all and cardinality(targets) = 0 then return new; end if;
  if private.require_team_conversation_member(new.conversation_id) <> new.author_profile_id then
    raise exception 'mention author mismatch' using errcode = '42501';
  end if;
  select tenant_id, coalesce(title, 'Group conversation') into tenant, group_title
  from public.team_conversations where id = new.conversation_id and kind = 'group';
  if tenant is null then raise exception 'mentions require a group conversation' using errcode = '22023'; end if;
  if exists (
    select 1 from unnest(targets) as requested(id) where not exists (
      select 1 from public.team_conversation_members as member
      join public.profiles as profile on profile.id = member.profile_id
      where member.conversation_id = new.conversation_id and member.profile_id = requested.id
        and profile.archived_at is null
        and private.profile_has_permission_in_tenant(member.profile_id, tenant, 'team_messages.use')
    )
  ) then raise exception 'mentions must be active group members' using errcode = '22023'; end if;
  for recipient in
    select member.profile_id from public.team_conversation_members as member
    join public.profiles as profile on profile.id = member.profile_id
    where member.conversation_id = new.conversation_id and member.profile_id <> new.author_profile_id
      and (mention_all or member.profile_id = any(targets))
      and profile.archived_at is null
      and private.profile_account_class(member.profile_id) = 'internal'
      and private.profile_has_permission_in_tenant(member.profile_id, tenant, 'team_messages.use')
  loop
    perform private.emit_team_notification(recipient, 'team-mention:' || new.id::text,
      'You were mentioned in ' || left(group_title, 120),
      left(private.team_message_plain_text(new.body), 240),
      '/dashboard?team-messages=' || new.conversation_id::text || '&team-message=' || new.id::text,
      'team_conversation', new.conversation_id, new.author_profile_id);
  end loop;
  return new;
end;
$function$;
revoke all on function private.notify_team_message_mentions() from public, anon, authenticated, service_role;
create trigger team_message_mentions_after_write after insert or update of body
on public.team_messages for each row execute function private.notify_team_message_mentions();
