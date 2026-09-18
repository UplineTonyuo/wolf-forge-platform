-- Project/Order conversation independence, Phase 2: native READ path only.
-- Adds a reaction aggregator for project_message_reactions (twin of
-- private.ticket_message_reactions_json) and a single read RPC,
-- app_get_project_conversation, that returns project_messages content
-- shaped like the existing Ticket-backed read model. Nothing here writes to
-- project_messages/project_attachments/project_message_reactions, nothing
-- here is called by any page or component yet, and the existing
-- Ticket-backed Order conversation (tickets.order_id / app_get_order_conversation
-- / app_send_order_message) is untouched and remains the live production path.

create function private.project_message_reactions_json(
  p_message_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(reaction_row order by reaction_row.reaction_code), '[]'::jsonb)
  from (
    select
      reaction.reaction_code,
      count(*)::integer as reaction_count,
      bool_or(reaction.reactor_profile_id = p_actor_id) as reacted_by_me,
      jsonb_agg(reactor.display_name order by reactor.display_name, reactor.id) as reactor_names
    from public.project_message_reactions as reaction
    join public.profiles as reactor on reactor.id = reaction.reactor_profile_id
    where reaction.message_id = p_message_id and reaction.active
    group by reaction.reaction_code
  ) as reaction_row;
$$;

revoke all on function private.project_message_reactions_json(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Reuses the same authorization boundary the live Ticket-backed Order
-- conversation already calls (private.require_order_conversation_access):
-- same module-access split (portal_projects vs projects), same
-- projects.view/tickets.view permission checks, same company/assignment
-- scoping. No second permission model is introduced.
create function public.app_get_project_conversation(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare project public.orders; messages_json jsonb;
begin
  project := private.require_order_conversation_access(p_order_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', message.id,
    'order_id', message.order_id,
    'author_profile_id', message.author_profile_id,
    'author_name', author_profile.display_name,
    'author_avatar_url', author_profile.avatar_url,
    'author_type', message.author_type,
    'body', message.body,
    'created_at', message.created_at,
    'reply_to_message_id', message.reply_to_message_id,
    'reply_quote_text', message.reply_quote_text,
    'reply_to_attachment_id', message.reply_to_attachment_id,
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attachment.id,
        'original_name', attachment.original_name,
        'mime_type', attachment.mime_type,
        'size_bytes', attachment.size_bytes,
        'scan_status', attachment.scan_status,
        'created_at', attachment.created_at
      ) order by attachment.created_at)
      from public.project_attachments as attachment
      where attachment.project_message_id = message.id
    ), '[]'::jsonb),
    'reactions', private.project_message_reactions_json(message.id, (select auth.uid()))
  ) order by message.created_at, message.id), '[]'::jsonb)
  into messages_json
  from public.project_messages as message
  left join public.profiles as author_profile
    on author_profile.id = message.author_profile_id
  where message.order_id = project.id;

  return jsonb_build_object('order_id', project.id, 'messages', messages_json);
end;
$$;

revoke all on function public.app_get_project_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.app_get_project_conversation(uuid) to authenticated;

comment on function public.app_get_project_conversation(uuid) is
  'Phase 2 native Project conversation read model (project_messages / project_message_reactions). Not yet called by any UI or write path; the Ticket-backed app_get_order_conversation remains the live production read.';
