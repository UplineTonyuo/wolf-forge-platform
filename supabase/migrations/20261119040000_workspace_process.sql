-- Workspace process definitions. System keys are the existing lifecycle values.
-- Existing orders require no rewrite. Only custom assignments store a stage key.
create table private.process_defaults(section text primary key, settings jsonb not null);
insert into private.process_defaults values
  ('orders', '{"entries":[{"key":"pending","name":"Pending","color":"#435787","description":""},{"key":"submitted","name":"Submitted","color":"#435787","description":""},{"key":"working","name":"Working","color":"#435787","description":""},{"key":"waiting_reply","name":"Waiting on client","color":"#435787","description":""},{"key":"pending_update","name":"Needs update","color":"#435787","description":""},{"key":"complete","name":"Complete","color":"#435787","description":""},{"key":"canceled","name":"Canceled","color":"#435787","description":""}],"lock":false,"reopen":false,"destination":"waiting_reply","ratings":false}'),
  ('tickets', '{"entries":[{"key":"open","name":"Open","color":"#435787","description":""},{"key":"in_progress","name":"In progress","color":"#435787","description":""},{"key":"waiting_on_client","name":"Waiting on client","color":"#435787","description":""},{"key":"waiting_on_team","name":"Waiting on team","color":"#435787","description":""},{"key":"resolved","name":"Resolved","color":"#435787","description":""},{"key":"closed","name":"Closed","color":"#435787","description":""}],"reply":"unchanged","ratings":false}'),
  ('clients', '{"entries":[{"key":"contact","name":"Contact","color":"#435787","description":""},{"key":"lead","name":"Lead","color":"#435787","description":""},{"key":"client","name":"Client","color":"#435787","description":""},{"key":"client_team","name":"Client team","color":"#435787","description":""}],"ownerOnly":false}'),
  ('messaging', '{"entries":[],"automatic":false,"body":"","days":[1,2,3,4,5],"start":"09:00","end":"17:00","zone":"UTC"}'),
  ('saved-replies', '{"entries":[]}'),
  ('tags', '{"entries":[]}');
create table private.process_configuration(
  tenant_id uuid references public.tenants, section text references private.process_defaults,
  version integer not null, settings jsonb not null, primary key(tenant_id,section)
);
revoke all on private.process_defaults, private.process_configuration from public,anon,authenticated,service_role;

create function private.process_config(t uuid,s text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(c.settings,d.settings) from private.process_defaults d
  left join private.process_configuration c on c.section=d.section and c.tenant_id=t where d.section=s
$$;
create function private.require_process_manager() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('settings');
  if not exists(select 1 from public.app_current_tenant_membership() where role_name in ('owner','admin') and account_class='internal') then
    raise insufficient_privilege; end if;
end $$;

create function public.app_process_config(p_section text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=private.current_tenant_id();
begin
  perform private.require_process_manager();
  return jsonb_build_object('settings', private.process_config(t,p_section),'version',coalesce(
    (select version from private.process_configuration where tenant_id=t and section=p_section),0));
end $$;

-- Project only fields the workflow renders, even if an entry contains extra JSON.
create function private.process_entries(t uuid,s text,visible_keys text[] default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('key',entry->'key','name',entry->'name','description',entry->'description')
    || case when s='saved-replies' then '{}'::jsonb else jsonb_build_object('color',entry->'color') end
    order by position
  ),'[]'::jsonb)
  from jsonb_array_elements(private.process_config(t,s)->'entries') with ordinality as items(entry,position)
  where visible_keys is null or entry->>'key'=any(visible_keys)
$$;

create function public.app_process_entries(p_section text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_internal_actor();
  case p_section
    when 'orders' then perform public.app_require_module_access('projects');
    when 'tickets' then perform public.app_require_module_access('tickets');
    when 'clients' then perform public.app_require_module_access('clients');
    when 'saved-replies' then
      perform public.app_require_module_access('tickets');
      perform private.require_permission('tickets.reply');
    else raise invalid_parameter_value;
  end case;
  return private.process_entries(private.current_tenant_id(),p_section);
end $$;

create function public.app_save_process_config(p_section text,p_version integer,p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=private.current_tenant_id(); d jsonb; previous jsonb; e jsonb; keys text[]:='{}'; v integer;
begin
  perform private.require_process_manager();
  select settings into strict d from private.process_defaults where section=p_section;
  insert into private.process_configuration values(t,p_section,0,d) on conflict do nothing;
  select settings,version into strict previous,v from private.process_configuration
    where tenant_id=t and section=p_section for update;
  if v is distinct from p_version then raise exception 'Reload settings before saving' using errcode='40001'; end if;
  if p_settings is null or jsonb_typeof(p_settings)<>'object' or pg_column_size(p_settings)>1048576 or
    exists(select 1 from jsonb_each(d) f where jsonb_typeof(p_settings->f.key) is distinct from jsonb_typeof(f.value))
    or exists(select 1 from jsonb_object_keys(p_settings) k where not d ? k)
    or jsonb_array_length(p_settings->'entries')>150 then raise check_violation; end if;
  for e in select value from jsonb_array_elements(p_settings->'entries') loop
    if not coalesce(jsonb_typeof(e->'name')='string' and length(trim(e->>'name')) between 1 and 80
      and jsonb_typeof(e->'description')='string' and length(e->>'description')<=4000
      and e->>'color' ~ '^#[0-9a-fA-F]{6}$' and e->>'key' <> all(keys)
      and (exists(select 1 from jsonb_array_elements(d->'entries') i where i->>'key'=e->>'key')
      or (p_section in ('orders','tags','saved-replies') and e->>'key' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),false)
      or (p_section='saved-replies' and trim(e->>'description')='') then raise check_violation; end if;
    keys:=array_append(keys,e->>'key');
  end loop;
  if p_section in ('orders','tickets','clients','tags') and exists(select 1 from jsonb_array_elements(previous->'entries') i
    where not ((i->>'key')=any(keys))) then raise check_violation; end if;
  if p_section='orders' and (not ((p_settings->>'destination')=any(keys)) or p_settings->>'destination' in ('complete','canceled')) then raise check_violation; end if;
  if p_section='tickets' and p_settings->>'reply' not in ('unchanged','in_progress','waiting_on_client','waiting_on_team') then raise check_violation; end if;
  if p_section='messaging' and (p_settings->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_settings->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_settings->>'start'>=p_settings->>'end'
    or not exists(select 1 from pg_timezone_names where name=p_settings->>'zone')
    or jsonb_array_length(p_settings->'days') not between 1 and 7
    or exists(select 1 from jsonb_array_elements(p_settings->'days') day where day not in ('1','2','3','4','5','6','7'))
    or length(p_settings->>'body')>4000 or ((p_settings->>'automatic')::boolean and trim(p_settings->>'body')='')) then raise check_violation; end if;
  update private.process_configuration set version=v+1,settings=p_settings where tenant_id=t and section=p_section;
end $$;

alter table public.orders add column process_stage text;
create function private.sync_order_stage() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.status<>old.status and new.process_stage is not distinct from old.process_stage then new.process_stage:=null; end if;
  if new.process_stage is not null and (new.status<>'working' or new.process_stage !~ '^[0-9a-f-]{36}$' or not exists(
    select 1 from jsonb_array_elements(private.process_config(new.tenant_id,'orders')->'entries') e where e->>'key'=new.process_stage))
    then raise check_violation; end if;
  return new;
end $$;
create trigger sync_order_stage before insert or update on public.orders for each row execute function private.sync_order_stage();
create function public.app_assign_process_stage(p_order uuid,p_stage text) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
  perform private.require_permission('projects.edit');
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  if not private.can_access_operational_order(p_order) then raise insufficient_privilege; end if;
  if p_stage is null or p_stage !~ '^[0-9a-f-]{36}$' then raise check_violation; end if;
  select * into strict o from public.orders where id=p_order and tenant_id=private.current_tenant_id() and archived_at is null for update;
  if o.process_stage=p_stage then return; end if;
  update public.orders set status='working',completed_at=null,process_stage=p_stage
    where id=p_order and tenant_id=private.current_tenant_id() and archived_at is null returning * into strict o;
  perform private.record_authenticated_activity('order',o.id,'order.status_changed','Changed workspace stage.',jsonb_build_object('stage',p_stage));
end $$;

-- All status writers acquire the tenant before the order. The report RPCs
-- already lock the order before delegating, so they must use the same order.
create or replace function public.app_change_order_status(p_order_id uuid, p_status text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders; previous_status text;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('projects');
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  select * into strict o from public.orders
    where id=p_order_id and tenant_id=private.current_tenant_id() and archived_at is null for update;
  perform private.require_order_completion_authority(o);
  previous_status:=o.status;
  if previous_status=p_status and o.process_stage is null then return o; end if;
  update public.orders set status=p_status, process_stage=null,
    completed_at=case when p_status='complete' then clock_timestamp() end
    where id=o.id returning * into strict o;
  perform private.record_authenticated_activity('order',o.id,'order.status_changed',
    format('Changed project %s status from %s to %s.',o.order_number,previous_status,o.status),
    jsonb_build_object('from',previous_status,'to',o.status));
  return o;
end $$;

-- Ordinary edits and reassignment lock the row in their UPDATE, before the
-- permission trigger runs. Reporting writers lock it in their initial SELECT.
do $migration$
declare target regprocedure; original text; anchor text;
  report_lock constant text:='select * into o from public.orders where id=p_order_id and tenant_id=private.current_tenant_id() and archived_at is null for update;';
begin
  for target,anchor in select * from (values
    ('public.app_update_order(uuid,jsonb)'::regprocedure, 'update public.orders'),
    ('public.app_assign_order(uuid,uuid)'::regprocedure, 'update public.orders'),
    ('public.app_set_order_reporting_month(uuid,uuid,date)'::regprocedure, report_lock),
    ('public.app_complete_order_for_reporting_month(uuid,uuid,date)'::regprocedure, report_lock),
    ('public.app_complete_order_without_report(uuid,uuid,date,text)'::regprocedure, report_lock)
  ) as writers(signature,first_order_lock) loop
    original:=pg_get_functiondef(target);
    if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then
      raise exception 'Unexpected order lock in %',target;
    end if;
    execute replace(original,anchor,'perform private.lock_tenant_module_lifecycle(private.current_tenant_id());' || chr(10) || '  ' || anchor);
  end loop;
end $migration$;

-- One private authorization record binds a client revision to this exact row update.
create table private.order_revisions(
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders,
  actor uuid not null references public.profiles, destination text not null, reason text not null,
  request_id uuid not null, expected_completed_at timestamptz not null,
  transaction_id bigint not null default txid_current(), created_at timestamptz not null default now(),
  unique(order_id,actor,request_id), unique(order_id,expected_completed_at)
);
revoke all on private.order_revisions from public,anon,authenticated,service_role;
create function public.app_request_order_revision(p_order uuid,p_reason text,p_expected_completed_at timestamptz,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; c jsonb; dest text; receipt private.order_revisions;
begin
  if private.current_account_class() is distinct from 'client' then raise insufficient_privilege; end if;
  perform private.require_permission('tickets.reply');
  -- This acquires the same tenant lifecycle lock as the staff writers.
  perform private.require_tickets_write(private.current_tenant_id());
  select * into strict o from public.orders where id=p_order and tenant_id=private.current_tenant_id()
    and company_id=private.current_user_company_id() and archived_at is null for update;
  if not public.app_my_order_chat_available(p_order) then raise insufficient_privilege; end if;
  perform private.require_order_conversation_access(p_order);
  if p_request_id is null or p_expected_completed_at is null or p_reason is null or
    p_reason !~ '[^[:space:]]' or length(p_reason)>4000 then raise invalid_parameter_value; end if;
  select * into receipt from private.order_revisions where order_id=o.id and actor=auth.uid() and request_id=p_request_id;
  if found then
    if receipt.expected_completed_at<>p_expected_completed_at or receipt.reason<>p_reason then
      raise exception 'Revision request ID already used for different input' using errcode='22023';
    end if;
  else
    if exists(select 1 from public.tickets where order_id=o.id and (status='closed' or archived_at is not null)) then
      raise insufficient_privilege;
    end if;
    if o.status<>'complete' or o.completed_at is distinct from p_expected_completed_at then
      raise exception 'Order completion changed' using errcode='40001';
    end if;
    c:=private.process_config(o.tenant_id,'orders');
    if not (c->>'reopen')::boolean then raise check_violation; end if;
    dest:=c->>'destination';
    insert into private.order_revisions(order_id,actor,destination,reason,request_id,expected_completed_at)
      values(o.id,auth.uid(),dest,p_reason,p_request_id,p_expected_completed_at) returning * into receipt;
    update public.orders set status=case when length(dest)=36 then 'working' else dest end,
      process_stage=case when length(dest)=36 then dest end,completed_at=null where id=o.id;
    insert into public.activity_events(actor_profile_id,entity_type,entity_id,action,summary,metadata)
      values(auth.uid(),'order',o.id,'order.status_changed','Client requested a revision.',
        jsonb_build_object('from','complete','stage',dest,'revision_id',receipt.id,'reason',p_reason));
  end if;
  return jsonb_build_object('revision_id',receipt.id,'destination',receipt.destination);
end $$;
do $migration$
declare f text:=pg_get_functiondef('private.enforce_order_permission()'::regprocedure);
  anchor text:='if private.requested_order_start_transition(old,new) then return new; end if;';
begin
  if strpos(f,anchor)=0 then raise exception 'Unexpected order permission trigger'; end if;
  execute replace(f,anchor,anchor || $patch$
  if old.status='complete' and new.completed_at is null
    and to_jsonb(old)-array['status','completed_at','process_stage','updated_at']=to_jsonb(new)-array['status','completed_at','process_stage','updated_at']
    and exists(select 1 from private.order_revisions r where r.order_id=old.id and r.actor=auth.uid()
      and r.expected_completed_at=old.completed_at and r.transaction_id=txid_current() and r.destination=coalesce(new.process_stage,new.status)
      and new.status=case when new.process_stage is null then r.destination else 'working' end) then return new; end if;
$patch$);
end $migration$;


-- Extend the authorized ticket projection so linked-ticket composers and the order agree.
do $migration$
declare f text:=pg_get_functiondef('public.app_get_order_conversation_page(uuid,text,text,uuid[],text,uuid[])'::regprocedure);
  anchor text:='''subject'',coalesce(linked.subject,project.title)';
begin
  if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected order conversation RPC'; end if;
  execute replace(f,anchor,$patch$
    'completed_order_locked',project.status='complete' and (private.process_config(project.tenant_id,'orders')->>'lock')::boolean,
    $patch$ || anchor);
end $migration$;

do $migration$
declare f text:=pg_get_functiondef('public.app_get_ticket_detail_with_avatars(uuid)'::regprocedure);
  anchor text:='return value;';
begin
  if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected ticket detail RPC'; end if;
  execute replace(f,anchor,$patch$
    if value is not null then
      value:=jsonb_set(value,'{ticket,completed_order_locked}',to_jsonb(exists(
        select 1 from public.tickets ticket join public.orders o on o.id=ticket.order_id and o.tenant_id=ticket.tenant_id
        where ticket.id=p_ticket_id and o.status='complete' and (private.process_config(o.tenant_id,'orders')->>'lock')::boolean)));
    end if;
    return value;$patch$);
end $migration$;

-- Only the public conversation is locked. Internal notes and system receipts retain their existing paths.
create function private.process_message_lock() returns trigger language plpgsql security definer set search_path='' as $$
declare order_key uuid; o public.orders;
begin
  if new.author_type='system' then return new; end if;
  if tg_table_name='ticket_messages' then
    if new.visibility='internal' then return new; end if;
    select order_id into order_key from public.tickets where id=new.ticket_id;
  else order_key:=new.order_id; end if;
  if order_key is not null then
    select * into strict o from public.orders where id=order_key for share;
    if o.status='complete' and (private.process_config(o.tenant_id,'orders')->>'lock')::boolean then
      raise exception 'Completed order conversation is locked' using errcode='42501'; end if;
  end if;
  return new;
end $$;
create trigger process_message_lock before insert on public.project_messages for each row execute function private.process_message_lock();
create trigger process_message_lock before insert on public.ticket_messages for each row execute function private.process_message_lock();

create function private.process_message_received() returns trigger language plpgsql security definer set search_path='' as $$
declare t uuid; c jsonb; local_time timestamp; reply_status text; ticket_status text;
begin
  if new.author_type='system' then return new; end if;
  if tg_table_name='ticket_messages' then
    if new.visibility='internal' then return new; end if;
    select tenant_id,status into strict t,ticket_status from public.tickets where id=new.ticket_id for update;
    if new.author_type='internal' and new.message_kind='reply' and private.current_user_has_permission('tickets.edit') then
      reply_status:=private.process_config(t,'tickets')->>'reply';
      if reply_status<>'unchanged' and ticket_status<>reply_status and private.ticket_status_transition_valid(ticket_status,reply_status) then perform public.app_update_ticket_status(new.ticket_id,reply_status); end if;
    end if;
  else select tenant_id into strict t from public.orders where id=new.order_id; end if;
  if new.author_type not in ('client','guest') then return new; end if;
  c:=private.process_config(t,'messaging');
  if not (c->>'automatic')::boolean then return new; end if;
  local_time:=new.created_at at time zone (c->>'zone');
  if (c->'days') @> jsonb_build_array(extract(isodow from local_time)::integer)
     and local_time::time >= (c->>'start')::time and local_time::time < (c->>'end')::time then return new; end if;
  if tg_table_name='ticket_messages' then
    insert into public.ticket_messages(ticket_id,author_type,message_kind,visibility,body,created_at) values(new.ticket_id,'system','reply','client',c->>'body',greatest(clock_timestamp(),new.created_at+interval '1 microsecond'));
  else
    insert into public.project_messages(order_id,author_type,body,created_at) values(new.order_id,'system',c->>'body',greatest(clock_timestamp(),new.created_at+interval '1 microsecond'));
  end if;
  return new;
end $$;
create trigger process_message_received after insert on public.ticket_messages for each row execute function private.process_message_received();
create trigger process_message_received after insert on public.project_messages for each row execute function private.process_message_received();

create function private.process_invitation_issuer_allowed(t uuid,actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not (private.process_config(t,'clients')->>'ownerOnly')::boolean
    or exists(select 1 from public.tenant_memberships m join public.permission_presets p on p.role_id=m.role_id
      where m.tenant_id=t and m.profile_id=actor and m.archived_at is null and m.account_class='internal' and p.key='owner')
$$;

create function public.app_can_issue_client_invitation() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=private.current_tenant_id();
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('clients');
  perform private.require_client_welcome_sender(auth.uid(),t);
  return private.process_invitation_issuer_allowed(t,auth.uid());
end $$;

create function private.process_activation_issuer() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.activation_token_hash is not null and not private.process_invitation_issuer_allowed(new.tenant_id,new.claimed_by) then
    raise insufficient_privilege; end if;
  return new;
end $$;
create trigger process_activation_issuer before insert or update of activation_token_hash on private.client_welcome_emails
for each row execute function private.process_activation_issuer();

create table private.process_ratings(
  actor uuid references public.profiles, kind text check(kind in ('orders','tickets')), target uuid,
  score smallint not null check(score between 1 and 5), primary key(actor,kind,target)
);
create index process_ratings_by_resource on private.process_ratings(kind,target);
revoke all on private.process_ratings from public,anon,authenticated,service_role;
create function public.app_client_process(p_section text,p_target uuid,p_score integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; state text; score integer; completion timestamptz; t uuid:=private.current_tenant_id();
begin
  if not exists(select 1 from public.app_current_tenant_membership() where account_class='client') then raise insufficient_privilege; end if;
  if p_section='orders' then
    if not public.app_my_order_chat_available(p_target) then raise insufficient_privilege; end if;
    select status,completed_at into strict state,completion from public.orders
      where id=p_target and tenant_id=t and company_id=private.current_user_company_id() and archived_at is null for share;
  elsif p_section='tickets' then
    if not private.can_access_ticket(p_target) then raise insufficient_privilege; end if;
    select status into strict state from public.tickets where id=p_target and tenant_id=t and archived_at is null for share;
  else raise invalid_parameter_value; end if;
  c:=private.process_config(t,p_section);
  if p_score is not null then
    if not (c->>'ratings')::boolean or state not in ('complete','resolved','closed') then raise insufficient_privilege; end if;
    insert into private.process_ratings values(auth.uid(),p_section,p_target,p_score)
      on conflict(actor,kind,target) do update set score=excluded.score;
  end if;
  select r.score into score from private.process_ratings r where r.actor=auth.uid() and r.kind=p_section and r.target=p_target;
  return jsonb_build_object('ratings',(c->>'ratings')::boolean and state in ('complete','resolved','closed'),
    'score',score,'completed_at',completion,'lock',state='complete' and coalesce((c->>'lock')::boolean,false),
    'reopen',state='complete' and coalesce((c->>'reopen')::boolean,false) and private.current_user_has_permission('tickets.reply')
      and not exists(select 1 from public.tickets where order_id=p_target and (status='closed' or archived_at is not null)));
end $$;

alter table public.orders add column process_tags text[] not null default '{}';
alter table public.companies add column process_tags text[] not null default '{}';
alter table public.tickets add column process_tags text[] not null default '{}';
create function public.app_tag_resource(p_kind text,p_target uuid,p_tag text,p_add boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_internal_actor();
  if p_kind not in ('projects','tickets','clients') or p_kind is null or p_add is null then raise invalid_parameter_value; end if;
  perform public.app_require_module_access(p_kind);
  perform private.require_permission(p_kind||'.edit');
  perform private.lock_tenant_module_lifecycle(private.current_tenant_id());
  if not exists(select 1 from jsonb_array_elements(private.process_config(private.current_tenant_id(),'tags')->'entries') e where e->>'key'=p_tag)
    then raise check_violation; end if;
  case p_kind
  when 'projects' then
    if not private.can_access_operational_order(p_target) then raise insufficient_privilege; end if;
    update public.orders set process_tags=case when p_add then array_append(array_remove(process_tags,p_tag),p_tag) else array_remove(process_tags,p_tag) end
      where id=p_target and tenant_id=private.current_tenant_id() and archived_at is null;
  when 'tickets' then
    if not private.can_access_ticket(p_target) then raise insufficient_privilege; end if;
    update public.tickets set process_tags=case when p_add then array_append(array_remove(process_tags,p_tag),p_tag) else array_remove(process_tags,p_tag) end
      where id=p_target and tenant_id=private.current_tenant_id() and archived_at is null;
  when 'clients' then
    update public.companies set process_tags=case when p_add then array_append(array_remove(process_tags,p_tag),p_tag) else array_remove(process_tags,p_tag) end
      where id=p_target and tenant_id=private.current_tenant_id() and archived_at is null;
  end case;
  if not found then raise no_data_found; end if;
end $$;

create function public.app_resource_process(p_kind text,p_target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t uuid:=private.current_tenant_id(); tags text[]; scores jsonb:='{"average":null,"count":0}';
begin
  perform private.require_internal_actor();
  if p_kind not in ('projects','tickets','clients') or p_kind is null then raise invalid_parameter_value; end if;
  perform public.app_require_module_access(p_kind);
  case p_kind
  when 'projects' then
    if not private.can_access_operational_order(p_target) then raise insufficient_privilege; end if;
    select process_tags into strict tags from public.orders where tenant_id=t and id=p_target and archived_at is null;
  when 'tickets' then
    if not private.can_access_ticket(p_target) then raise insufficient_privilege; end if;
    select process_tags into strict tags from public.tickets where tenant_id=t and id=p_target and archived_at is null;
  when 'clients' then
    perform private.require_permission('clients.view');
    select process_tags into strict tags from public.companies where tenant_id=t and id=p_target and archived_at is null;
  end case;
  if p_kind in ('projects','tickets') then
    select jsonb_build_object('average',round(avg(score),1),'count',count(*)) into scores from private.process_ratings
      where target=p_target and kind=case p_kind when 'projects' then 'orders' else 'tickets' end;
  end if;
  return scores || jsonb_build_object('assigned',tags,'entries',private.process_entries(t,'tags',
    case when private.current_user_has_permission(p_kind||'.edit') then null else tags end));
end $$;
revoke all on function public.app_resource_process(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.app_resource_process(text,uuid) to authenticated;

revoke all on function private.process_config(uuid,text),private.sync_order_stage(),private.process_message_lock(),
  private.process_message_received(),private.process_activation_issuer() from public,anon,authenticated,service_role;
revoke all on function private.require_process_manager(), private.process_entries(uuid,text,text[]),
  private.process_invitation_issuer_allowed(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.app_process_entries(text), public.app_can_issue_client_invitation()
  from public,anon,authenticated,service_role;
grant execute on function public.app_process_entries(text), public.app_can_issue_client_invitation() to authenticated;
revoke all on function public.app_process_config(text),public.app_save_process_config(text,integer,jsonb),
  public.app_assign_process_stage(uuid,text),public.app_tag_resource(text,uuid,text,boolean),public.app_request_order_revision(uuid,text,timestamptz,uuid),
  public.app_client_process(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.app_process_config(text),public.app_save_process_config(text,integer,jsonb),
  public.app_assign_process_stage(uuid,text),public.app_tag_resource(text,uuid,text,boolean),public.app_request_order_revision(uuid,text,timestamptz,uuid),
  public.app_client_process(text,uuid,integer) to authenticated;

