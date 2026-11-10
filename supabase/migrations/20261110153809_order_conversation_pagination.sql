-- New bounded readers; existing full-detail RPCs remain compatible.
-- Both source indexes already cover (parent_id, created_at, id).
create function private.order_conversation_page_messages(
  p_order_id uuid, p_ticket_id uuid, p_ids uuid[], p_notes boolean default false
) returns jsonb language sql stable security definer set search_path = '' as $$
  with messages as (
    select m.id, m.order_id as parent_id, m.author_profile_id, m.author_type,
      case when m.author_type='system' then 'initial_request' else 'reply' end as message_kind,
      'client'::text as visibility, m.body, m.created_at, m.request_id,
      m.reply_to_message_id,m.reply_to_attachment_id,m.reply_quote_text,null::timestamptz as unsent_at
    from public.project_messages m
    where p_ticket_id is null and not p_notes and m.order_id=p_order_id and m.id=any(p_ids)
    union all
    select m.id,m.ticket_id,m.author_profile_id,m.author_type,m.message_kind,m.visibility,
      case when m.unsent_at is null then m.body else 'This note was unsent.' end,
      m.created_at,m.request_id,m.reply_to_message_id,m.reply_to_attachment_id,m.reply_quote_text,m.unsent_at
    from public.ticket_messages m
    where p_ticket_id is not null and m.ticket_id=p_ticket_id and m.id=any(p_ids)
      and case when p_notes then m.message_kind='internal_note'
        else m.visibility='client' and m.message_kind<>'internal_note' end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'ticket_id',m.parent_id,
    'author_profile_id',case when p_ticket_id is not null and (select role_name='client' from private.current_ticket_actor()) then null else m.author_profile_id end,
    'author_name',author.display_name,'author_avatar_url',case when author.archived_at is null then author.avatar_url end,
    'author_type',m.author_type,'message_kind',m.message_kind,'visibility',m.visibility,
    'body',m.body,'created_at',m.created_at,
    'requestId',case when m.author_profile_id=(select auth.uid()) then m.request_id end,
    'reply_to_message_id',m.reply_to_message_id,'reply_to_attachment_id',m.reply_to_attachment_id,
    'reply_quote_text',case when source.id is not null then m.reply_quote_text end,
    'reply_source_author_name',source_author.display_name,'reply_source_available',source.id is not null,
    'reply_source_attachment',case when source_attachment.id is not null then jsonb_build_object(
      'id',source_attachment.id,'is_image',source_attachment.mime_type like 'image/%','original_name',source_attachment.original_name) end,
    'unsent_at',m.unsent_at,'can_unsend',p_notes and m.unsent_at is null and m.author_profile_id=(select auth.uid()),
    'attachments',case when m.unsent_at is not null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'original_name',a.original_name,'mime_type',a.mime_type,
        'size_bytes',a.size_bytes,'scan_status',a.scan_status,'created_at',a.created_at) order by a.created_at,a.id)
      from (
        select a.id,a.original_name,a.mime_type,a.size_bytes,a.scan_status,a.created_at from public.project_attachments a
        where p_ticket_id is null and a.project_message_id=m.id
        union all
        select a.id,a.original_name,a.mime_type,a.size_bytes,a.scan_status,a.created_at from public.ticket_attachments a
        where p_ticket_id is not null and a.ticket_message_id=m.id
      ) a
    ),'[]'::jsonb) end,
    'reactions',case when p_ticket_id is null then private.project_message_reactions_json(m.id,(select auth.uid()))
      else private.ticket_message_reactions_json(m.id,(select auth.uid())) end
  ) order by m.created_at,m.id),'[]'::jsonb)
  from messages m
  left join public.profiles author on author.id=m.author_profile_id
  left join lateral (
    select s.id,s.author_profile_id from public.project_messages s
      where p_ticket_id is null and s.order_id=p_order_id and s.id=m.reply_to_message_id
    union all
    select s.id,s.author_profile_id from public.ticket_messages s
      where p_ticket_id is not null and s.ticket_id=p_ticket_id and s.id=m.reply_to_message_id
        and s.visibility='client' and s.message_kind<>'internal_note' and s.unsent_at is null
  ) source on true
  left join public.profiles source_author on source_author.id=source.author_profile_id
  left join lateral (
    select a.id,a.mime_type,a.original_name from public.project_attachments a
      where p_ticket_id is null and a.project_message_id=source.id and a.id=m.reply_to_attachment_id
    union all
    select a.id,a.mime_type,a.original_name from public.ticket_attachments a
      where p_ticket_id is not null and a.ticket_message_id=source.id and a.id=m.reply_to_attachment_id
  ) source_attachment on true;
$$;
revoke all on function private.order_conversation_page_messages(uuid,uuid,uuid[],boolean) from public,anon,authenticated,service_role;

create function public.app_get_order_conversation_page(
  p_order_id uuid, p_direction text default 'latest', p_cursor text default null,
  p_retained_ids uuid[] default '{}', p_fingerprint text default null, p_request_ids uuid[] default '{}'
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  project public.orders; linked public.tickets; actor record;
  source text; boundary jsonb; boundary_at timestamptz; boundary_id uuid;
  ids uuid[]; candidate_ids uuid[];
  first_at timestamptz; first_id uuid; last_at timestamptz; last_id uuid;
  before_cursor text; after_cursor text; has_older boolean; has_newer boolean;
  messages jsonb; updates jsonb; page jsonb; fingerprint text; detail jsonb; confirmed jsonb;
begin
  -- Reauthorize BEFORE looking up any caller-controlled cursor or retained ID.
  project:=private.require_order_conversation_access(p_order_id);
  select * into actor from private.current_ticket_actor();
  select * into linked from public.tickets where order_id=project.id;
  if linked.id is not null then
    if linked.company_id is distinct from project.company_id then raise exception 'Conversation unavailable' using errcode='42501'; end if;
    perform private.require_ticket_access(linked.id);
  end if;
  source:=case when linked.id is null then 'project:'||project.id else 'ticket:'||linked.id end;
  if p_direction is null or p_direction not in ('latest','before','after','refresh')
    or p_retained_ids is null or cardinality(p_retained_ids)>100 or array_position(p_retained_ids,null) is not null
    or p_request_ids is null or cardinality(p_request_ids)>100 or array_position(p_request_ids,null) is not null
    or length(p_fingerprint)>128 or length(p_cursor)>1000
    or ((p_direction in ('before','after')) <> (p_cursor is not null))
    or (p_direction<>'refresh' and (cardinality(p_retained_ids)>0 or cardinality(p_request_ids)>0 or p_fingerprint is not null)) then
    raise exception 'Invalid conversation page' using errcode='22023';
  end if;
  if p_cursor is not null then
    begin
      boundary:=p_cursor::jsonb;
      if jsonb_typeof(boundary)<>'object' or not (boundary ?& array['order','source','direction','at','id'])
        or boundary-array['order','source','direction','at','id']<>'{}'::jsonb
        or boundary->>'order' is distinct from project.id::text
        or boundary->>'source' is distinct from source or boundary->>'direction' is distinct from p_direction then
        raise exception 'Invalid conversation cursor';
      end if;
      boundary_at:=(boundary->>'at')::timestamptz; boundary_id:=(boundary->>'id')::uuid;
      if boundary_at is null or boundary_id is null or not isfinite(boundary_at) then raise exception 'Invalid conversation cursor'; end if;
      if linked.id is null then
        if not exists(select 1 from public.project_messages where order_id=project.id and id=boundary_id and created_at=boundary_at) then raise exception 'Invalid conversation cursor'; end if;
      elsif not exists(select 1 from public.ticket_messages where ticket_id=linked.id and id=boundary_id and created_at=boundary_at
        and visibility='client' and message_kind<>'internal_note') then raise exception 'Invalid conversation cursor'; end if;
    exception when others then raise exception 'Invalid conversation cursor' using errcode='22023'; end;
  end if;
  if linked.id is null then
    if exists(select 1 from unnest(p_retained_ids) as requested(id) where not exists(select 1 from public.project_messages m where m.id=requested.id and m.order_id=project.id)) then
      raise exception 'Invalid retained messages' using errcode='22023'; end if;
    if p_direction='after' then
      candidate_ids:=array(select id from public.project_messages where order_id=project.id
        and (created_at,id)>(boundary_at,boundary_id) order by created_at,id limit 11);
    else
      candidate_ids:=array(select id from public.project_messages where order_id=project.id
        and (created_at,id)<(coalesce(boundary_at,'infinity'::timestamptz),coalesce(boundary_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
        order by created_at desc,id desc limit 11);
    end if;
  else
    if exists(select 1 from unnest(p_retained_ids) as requested(id) where not exists(select 1 from public.ticket_messages m where m.id=requested.id and m.ticket_id=linked.id and m.visibility='client' and m.message_kind<>'internal_note')) then
      raise exception 'Invalid retained messages' using errcode='22023'; end if;
    if p_direction='after' then
      candidate_ids:=array(select id from public.ticket_messages where ticket_id=linked.id and visibility='client' and message_kind<>'internal_note'
        and (created_at,id)>(boundary_at,boundary_id) order by created_at,id limit 11);
    else
      candidate_ids:=array(select id from public.ticket_messages where ticket_id=linked.id and visibility='client' and message_kind<>'internal_note'
        and (created_at,id)<(coalesce(boundary_at,'infinity'::timestamptz),coalesce(boundary_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
        order by created_at desc,id desc limit 11);
    end if;
  end if;
  ids:=coalesce(candidate_ids[1:10],'{}'::uuid[]);
  messages:=private.order_conversation_page_messages(project.id,linked.id,ids);
  -- Cursor timestamps are serialized by PostgreSQL, retaining all six fractional digits.
  if jsonb_array_length(messages)>0 then
    first_at:=(messages->0->>'created_at')::timestamptz; first_id:=(messages->0->>'id')::uuid;
    last_at:=(messages->-1->>'created_at')::timestamptz; last_id:=(messages->-1->>'id')::uuid;
    before_cursor:=jsonb_build_object('order',project.id,'source',source,'direction','before','at',first_at,'id',first_id)::text;
    after_cursor:=jsonb_build_object('order',project.id,'source',source,'direction','after','at',last_at,'id',last_id)::text;
    if linked.id is null then
      select exists(select 1 from public.project_messages where order_id=project.id and (created_at,id)<(first_at,first_id)),
        exists(select 1 from public.project_messages where order_id=project.id and (created_at,id)>(last_at,last_id)) into has_older,has_newer;
    else
      select exists(select 1 from public.ticket_messages where ticket_id=linked.id and visibility='client' and message_kind<>'internal_note' and (created_at,id)<(first_at,first_id)),
        exists(select 1 from public.ticket_messages where ticket_id=linked.id and visibility='client' and message_kind<>'internal_note' and (created_at,id)>(last_at,last_id)) into has_older,has_newer;
    end if;
  end if;
  page:=jsonb_build_object('before',before_cursor,'after',after_cursor,'hasOlder',coalesce(has_older,false),'hasNewer',coalesce(has_newer,false),'source',source);
  updates:=case when p_direction='refresh' then private.order_conversation_page_messages(project.id,linked.id,p_retained_ids) else '[]'::jsonb end;
  if linked.id is null then
    select coalesce(jsonb_agg(request_id order by request_id),'[]'::jsonb) into confirmed from public.project_messages
      where order_id=project.id and author_profile_id=(select auth.uid()) and request_id=any(p_request_ids);
  else
    select coalesce(jsonb_agg(request_id order by request_id),'[]'::jsonb) into confirmed from public.ticket_messages
      where ticket_id=linked.id and author_profile_id=(select auth.uid()) and request_id=any(p_request_ids)
        and visibility='client' and message_kind<>'internal_note';
  end if;
  fingerprint:=md5(messages::text||updates::text||page::text||confirmed::text);
  detail:=jsonb_build_object('ticket',jsonb_build_object(
    'id',coalesce(linked.id,project.id),'public_ref',coalesce(linked.public_ref,'PROJECT-'||project.order_number::text),
    'subject',coalesce(linked.subject,project.title),'status',coalesce(linked.status,'open'),
    'priority',coalesce(linked.priority,project.priority),'requester_name',linked.requester_name,
    'created_at',coalesce(linked.created_at,project.created_at),'updated_at',coalesce(linked.updated_at,project.updated_at),
    'resolved_at',linked.resolved_at,'closed_at',linked.closed_at,'archived_at',coalesce(linked.archived_at,project.archived_at)),
    'company_name',(select name from public.companies where id=project.company_id),'client_name',null,'assigned_to_name',null);
  return detail||jsonb_build_object('messages',case when fingerprint=p_fingerprint then '[]'::jsonb else messages end,
    'updates',case when fingerprint=p_fingerprint then null else updates end,
    'page',page,'fingerprint',fingerprint,'changed',fingerprint is distinct from p_fingerprint,'confirmedRequestIds',confirmed);
end;
$$;
revoke all on function public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[]) to authenticated;

create function public.app_get_order_conversation_notes(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare project public.orders; linked public.tickets; ids uuid[];
begin
  project:=private.require_order_conversation_access(p_order_id);
  perform private.require_internal_actor();
  perform private.require_permission('tickets.internal_notes');
  select * into linked from public.tickets where order_id=project.id;
  if linked.id is null then return '[]'::jsonb; end if;
  if linked.company_id is distinct from project.company_id then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  perform private.require_ticket_access(linked.id);
  select array_agg(id order by created_at,id) into ids from public.ticket_messages where ticket_id=linked.id and message_kind='internal_note';
  return private.order_conversation_page_messages(project.id,linked.id,coalesce(ids,'{}'),true);
end;
$$;
revoke all on function public.app_get_order_conversation_notes(uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_get_order_conversation_notes(uuid) to authenticated;

-- Add only the reviewed public-page reader to delegated client operations. Notes remain excluded.
do $migration$
declare target oid:='private.client_support_operation_allowed(text,text)'::regprocedure;
  original text; replacement text; owner_before oid; acl_before aclitem[];
  needle text:=$entry$'app_get_order_conversation',$entry$;
begin
  select prosrc,proowner,proacl into original,owner_before,acl_before from pg_proc where oid=target;
  if (length(original)-length(replace(original,needle,'')))/length(needle)<>1 or position('app_get_order_conversation_page' in original)>0 then
    raise exception 'Unexpected support operation baseline'; end if;
  replacement:=replace(original,needle,$entry$'app_get_order_conversation','app_get_order_conversation_page',$entry$);
  execute replace(pg_get_functiondef(target),original,replacement);
  if not exists(select 1 from pg_proc where oid=target and prosrc=replacement and proowner=owner_before and proacl is not distinct from acl_before) then
    raise exception 'Support operation preservation failed'; end if;
end;
$migration$;
