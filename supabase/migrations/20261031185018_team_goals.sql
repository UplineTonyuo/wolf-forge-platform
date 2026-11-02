-- Internal Goals are independent of Team member/permission administration.
create table private.team_goals (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  title text not null check(length(btrim(title)) between 1 and 160),
  description text not null default '' check(length(description)<=4000),
  owner_profile_id uuid not null,
  due_date date check(due_date is null or (isfinite(due_date) and due_date between date '0001-01-01' and date '9999-12-31')),
  visibility text not null check(visibility in ('shared','leadership')),
  photo_path text unique,
  photo_mime text check(photo_mime in ('image/jpeg','image/png','image/webp')),
  photo_size integer check(photo_size between 1 and 2097152),
  photo_checksum text check(photo_checksum ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  request_id uuid not null,
  request_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,id),
  unique(tenant_id,created_by,request_id),
  foreign key(tenant_id,owner_profile_id) references public.tenant_memberships(tenant_id,profile_id),
  check((photo_path is null and photo_mime is null and photo_size is null and photo_checksum is null)
    or (photo_path is not null and photo_mime is not null and photo_size is not null and photo_checksum is not null))
);
create index team_goals_tenant_created on private.team_goals(tenant_id,created_at desc,id desc);
create table private.team_goal_milestones (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null,
  goal_id uuid not null,
  title text not null check(length(btrim(title)) between 1 and 200),
  position integer not null check(position between 0 and 49),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  foreign key(tenant_id,goal_id) references private.team_goals(tenant_id,id) on delete cascade,
  check((completed_at is null)=(completed_by is null))
);
create index team_goal_milestones_goal on private.team_goal_milestones(goal_id,position,id);
alter table private.team_goals enable row level security;
alter table private.team_goals force row level security;
alter table private.team_goal_milestones enable row level security;
alter table private.team_goal_milestones force row level security;
revoke all on private.team_goals,private.team_goal_milestones from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-goal-photos','team-goal-photos',false,2097152,array['image/jpeg','image/png','image/webp']);
-- No direct Storage policies. The existing trusted server transport authorizes first.

create function private.goal_actor_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare actor_role text;
begin
  perform private.require_internal_actor();
  select r.name into actor_role from public.tenant_memberships m
  join public.roles r on r.id=m.role_id
  join public.profiles p on p.id=m.profile_id and p.archived_at is null
  where m.tenant_id=private.current_tenant_id() and m.profile_id=auth.uid()
    and m.archived_at is null and m.account_class='internal' and r.name in ('owner','admin','manager','staff');
  if actor_role is null then raise exception 'Goal access is unavailable' using errcode='42501'; end if;
  return actor_role;
end $$;
create function private.require_goal(p_id uuid,p_manage boolean default false) returns private.team_goals
language plpgsql stable security definer set search_path='' as $$
declare actor_role text:=private.goal_actor_role(); goal private.team_goals;
begin
  select * into goal from private.team_goals g where g.id=p_id and g.tenant_id=private.current_tenant_id()
    and (g.visibility='shared' or actor_role in ('owner','admin'));
  if goal.id is null then raise exception 'Goal is unavailable' using errcode='P0002'; end if;
  if p_manage and actor_role not in ('owner','admin') then raise exception 'Goal management is unavailable' using errcode='42501'; end if;
  return goal;
end $$;
create function private.team_goal_json(g private.team_goals,p_detail boolean default true) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'title',g.title,'description',g.description,
  'owner_profile_id',g.owner_profile_id,'owner_name',coalesce(nullif(p.display_name,''),'Team member'),
  'due_date',g.due_date,'visibility',g.visibility,'created_at',g.created_at,'updated_at',g.updated_at,
  'photo_path',g.photo_path,'photo_mime',g.photo_mime,'photo_size',g.photo_size,'photo_checksum',g.photo_checksum,
  'milestone_count',(select count(*) from private.team_goal_milestones m where m.goal_id=g.id),
  'completed_count',(select count(*) from private.team_goal_milestones m where m.goal_id=g.id and m.completed_at is not null),
  'milestones',case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'completed_at',m.completed_at)
    order by m.position,m.id) from private.team_goal_milestones m where m.goal_id=g.id),'[]'::jsonb) else '[]'::jsonb end)
 from public.profiles p where p.id=g.owner_profile_id;
$$;
create function public.app_list_team_goals(p_before uuid default null,p_visibility text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor_role text:=private.goal_actor_role(); items jsonb; cursor_goal private.team_goals; more boolean;
begin
  if p_visibility is not null and p_visibility not in ('shared','leadership') then
    raise exception 'Invalid goal visibility' using errcode='22023'; end if;
  if p_before is not null then cursor_goal:=private.require_goal(p_before); end if;
  if p_before is not null and p_visibility is not null and cursor_goal.visibility<>p_visibility then
    raise exception 'Cursor does not match goal visibility' using errcode='22023'; end if;
  select coalesce(jsonb_agg(private.team_goal_json(g,false) order by g.created_at desc,g.id desc),'[]'::jsonb)
    into items from (select * from private.team_goals t where t.tenant_id=private.current_tenant_id()
      and (t.visibility='shared' or actor_role in ('owner','admin'))
      and (p_visibility is null or t.visibility=p_visibility)
      and (p_before is null or (t.created_at,t.id)<(cursor_goal.created_at,cursor_goal.id))
      order by t.created_at desc,t.id desc limit 51) g;
  more:=jsonb_array_length(items)>50;
  if more then items:=items-50; end if;
  return jsonb_build_object('items',items,'next_before',case when more then items->49->>'id' else null end);
end $$;
create function public.app_get_team_goal(p_goal_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$ select private.team_goal_json(private.require_goal(p_goal_id)); $$;
create function public.app_team_goal_members() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.goal_actor_role() not in ('owner','admin') then raise exception 'Goal management is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',coalesce(nullif(p.display_name,''),'Team member'),'role',r.name)
    order by p.display_name,p.id),'[]'::jsonb) from public.tenant_memberships m
    join public.profiles p on p.id=m.profile_id and p.archived_at is null join public.roles r on r.id=m.role_id
    where m.tenant_id=private.current_tenant_id() and m.archived_at is null and m.account_class='internal'
      and r.name in ('owner','admin','manager','staff'));
end $$;

create function public.app_save_team_goal(p_goal_id uuid,p_input jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor_role text:=private.goal_actor_role(); goal private.team_goals; existing private.team_goals;
  owner_role text; owner_id uuid; milestone jsonb; milestone_id uuid; milestone_position integer:=0; ids uuid[]:='{}';
  fingerprint text:=encode(extensions.digest(p_input::text,'sha256'),'hex');
begin
  if actor_role not in ('owner','admin') then raise exception 'Goal management is unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or length(btrim(coalesce(p_input->>'title',''))) not between 1 and 160
    or length(coalesce(p_input->>'description',''))>4000 or (p_input->>'visibility') not in ('shared','leadership')
    or jsonb_typeof(p_input->'milestones') is distinct from 'array' or jsonb_array_length(p_input->'milestones')>50
    or nullif(p_input->>'request_id','') is null
    or (nullif(p_input->>'due_date','') is not null and (p_input->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    then raise exception 'Invalid goal' using errcode='22023'; end if;
  owner_id:=(p_input->>'owner_profile_id')::uuid;
  perform private.consume_rate_limit('goals.write.actor.minute',auth.uid()::text,interval '1 minute',30);
  if p_goal_id is null then
    -- Serialize the create key before checking it, so retry/concurrency cannot duplicate a goal.
    perform pg_advisory_xact_lock(hashtextextended(private.current_tenant_id()::text||auth.uid()::text||(p_input->>'request_id'),0));
  else
    perform private.require_goal(p_goal_id,true);
    select * into goal from private.team_goals where id=p_goal_id for update;
    perform private.require_goal(p_goal_id,true);
    if p_expected_updated_at is null or goal.updated_at<>p_expected_updated_at then raise exception 'Goal changed; reload before saving' using errcode='23505'; end if;
  end if;
  -- Both actor and assignee must still be eligible after potentially waiting.
  actor_role:=private.goal_actor_role();
  if actor_role not in ('owner','admin') then raise exception 'Goal management is unavailable' using errcode='42501'; end if;
  select r.name into owner_role from public.tenant_memberships m join public.roles r on r.id=m.role_id
    join public.profiles p on p.id=m.profile_id and p.archived_at is null
    where m.tenant_id=private.current_tenant_id() and m.profile_id=owner_id and m.archived_at is null
      and m.account_class='internal' and r.name in ('owner','admin','manager','staff');
  if owner_role is null or ((p_input->>'visibility')='leadership' and owner_role not in ('owner','admin')) then
    raise exception 'Choose an eligible goal owner' using errcode='22023'; end if;
  if p_goal_id is null then
    select * into existing from private.team_goals g where g.tenant_id=private.current_tenant_id()
      and g.created_by=auth.uid() and g.request_id=(p_input->>'request_id')::uuid;
    if existing.id is not null then
      if existing.request_hash<>fingerprint then raise exception 'Goal request changed' using errcode='23505'; end if;
      return private.team_goal_json(existing);
    end if;
    insert into private.team_goals(tenant_id,title,description,owner_profile_id,due_date,visibility,created_by,updated_by,request_id,request_hash)
      values(private.current_tenant_id(),btrim(p_input->>'title'),coalesce(p_input->>'description',''),owner_id,
      nullif(p_input->>'due_date','')::date,p_input->>'visibility',auth.uid(),auth.uid(),(p_input->>'request_id')::uuid,fingerprint) returning * into goal;
  else
    update private.team_goals set title=btrim(p_input->>'title'),description=coalesce(p_input->>'description',''),
      owner_profile_id=owner_id,due_date=nullif(p_input->>'due_date','')::date,visibility=p_input->>'visibility',
      updated_at=clock_timestamp(),updated_by=auth.uid() where id=goal.id returning * into goal;
  end if;
  for milestone in select value from jsonb_array_elements(p_input->'milestones') loop
    if jsonb_typeof(milestone) is distinct from 'object' or length(btrim(coalesce(milestone->>'title',''))) not between 1 and 200 then
      raise exception 'Invalid milestone' using errcode='22023'; end if;
    milestone_id:=nullif(milestone->>'id','')::uuid;
    if milestone_id is null then
      insert into private.team_goal_milestones(tenant_id,goal_id,title,position) values(goal.tenant_id,goal.id,btrim(milestone->>'title'),milestone_position) returning id into milestone_id;
    else
      if milestone_id=any(ids) then raise exception 'Duplicate milestone' using errcode='22023'; end if;
      update private.team_goal_milestones set title=btrim(milestone->>'title'),position=milestone_position
        where id=milestone_id and goal_id=goal.id;
      if not found then raise exception 'Milestone is unavailable' using errcode='22023'; end if;
    end if;
    ids:=array_append(ids,milestone_id); milestone_position:=milestone_position+1;
  end loop;
  delete from private.team_goal_milestones where goal_id=goal.id and not(id=any(ids));
  return private.team_goal_json(goal);
end $$;
create function public.app_set_team_goal_milestone(p_goal_id uuid,p_milestone_id uuid,p_completed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare goal private.team_goals; actor_role text:=private.goal_actor_role();
begin
  perform private.require_goal(p_goal_id);
  perform private.consume_rate_limit('goals.progress.actor.minute',auth.uid()::text,interval '1 minute',60);
  select * into goal from private.team_goals where id=p_goal_id for update;
  -- Recheck membership, role, Tenant and visibility after obtaining the lock.
  perform private.require_goal(p_goal_id);
  actor_role:=private.goal_actor_role();
  if actor_role not in ('owner','admin') and (goal.visibility<>'shared' or goal.owner_profile_id<>auth.uid()) then
    raise exception 'Milestone updates are unavailable' using errcode='42501'; end if;
  if p_completed is null then raise exception 'Choose a milestone state' using errcode='22023'; end if;
  update private.team_goal_milestones set completed_at=case when p_completed then coalesce(completed_at,clock_timestamp()) else null end,
    completed_by=case when p_completed then coalesce(completed_by,auth.uid()) else null end
    where id=p_milestone_id and goal_id=goal.id;
  if not found then raise exception 'Milestone is unavailable' using errcode='P0002'; end if;
  update private.team_goals set updated_at=clock_timestamp(),updated_by=auth.uid() where id=goal.id returning * into goal;
  return private.team_goal_json(goal);
end $$;
create function public.app_team_goal_photo_context(p_goal_id uuid,p_write boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare goal private.team_goals:=private.require_goal(p_goal_id,p_write);
begin
  if p_write then
    perform private.consume_rate_limit('goals.photo.actor.minute',auth.uid()::text,interval '1 minute',5);
    perform private.consume_rate_limit('goals.photo.tenant.day',goal.tenant_id::text,interval '1 day',100);
  else
    perform private.consume_rate_limit('goals.photo.read.actor.minute',auth.uid()::text,interval '1 minute',120);
  end if;
  goal:=private.require_goal(p_goal_id,p_write);
  return jsonb_build_object('tenant_id',goal.tenant_id,'updated_at',goal.updated_at,'photo_path',goal.photo_path,
    'photo_mime',goal.photo_mime,'photo_size',goal.photo_size,'photo_checksum',goal.photo_checksum);
end $$;
create function public.app_set_team_goal_photo(p_goal_id uuid,p_path text,p_mime text,p_size integer,p_checksum text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare goal private.team_goals;
begin
  perform private.require_goal(p_goal_id,true);
  select * into goal from private.team_goals where id=p_goal_id for update;
  perform private.require_goal(p_goal_id,true);
  if goal.updated_at is distinct from p_expected_updated_at then raise exception 'Goal changed; reload before saving' using errcode='23505'; end if;
  if p_path is null or p_path !~ ('^'||goal.tenant_id::text||'/'||goal.id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
    or p_mime not in ('image/jpeg','image/png','image/webp') or p_size not between 1 and 2097152
    or p_checksum !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from storage.objects o where o.bucket_id='team-goal-photos' and o.name=p_path) then
    raise exception 'Photo is unavailable' using errcode='22023'; end if;
  update private.team_goals set photo_path=p_path,photo_mime=p_mime,photo_size=p_size,photo_checksum=p_checksum,
    updated_at=clock_timestamp(),updated_by=auth.uid() where id=goal.id returning * into goal;
  return private.team_goal_json(goal);
end $$;

revoke all on function private.goal_actor_role(),private.require_goal(uuid,boolean),private.team_goal_json(private.team_goals,boolean) from public,anon,authenticated,service_role;
revoke all on function public.app_list_team_goals(uuid,text),public.app_get_team_goal(uuid),public.app_team_goal_members(),
  public.app_save_team_goal(uuid,jsonb,timestamptz),public.app_set_team_goal_milestone(uuid,uuid,boolean),
  public.app_team_goal_photo_context(uuid,boolean),public.app_set_team_goal_photo(uuid,text,text,integer,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.app_list_team_goals(uuid,text),public.app_get_team_goal(uuid),public.app_team_goal_members(),
  public.app_save_team_goal(uuid,jsonb,timestamptz),public.app_set_team_goal_milestone(uuid,uuid,boolean),
  public.app_team_goal_photo_context(uuid,boolean),public.app_set_team_goal_photo(uuid,text,text,integer,text,timestamptz) to authenticated;
