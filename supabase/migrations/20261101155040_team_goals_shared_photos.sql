-- User-approved policy: every active internal team member in a Tenant can view all Goals.
-- Preserve IDs, photos, milestones and author attribution. Bump revision only for
-- formerly leadership-only rows so an older edit cannot silently overwrite them.
update private.team_goals set visibility='shared',updated_at=clock_timestamp() where visibility='leadership';
alter table private.team_goals add constraint team_goals_shared_only check(visibility='shared');

-- Existing current-membership checks, force-RLS, private Storage, write permissions,
-- rate limits and function EXECUTE grants remain intact. CREATE OR REPLACE retains ACLs.
create or replace function private.team_goal_json(g private.team_goals,p_detail boolean default true) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'title',g.title,'description',g.description,
  'owner_profile_id',g.owner_profile_id,'owner_name',coalesce(nullif(p.display_name,''),'Team member'),
  'owner_avatar_url',p.avatar_url,
  'due_date',g.due_date,'visibility',g.visibility,'created_at',g.created_at,'updated_at',g.updated_at,
  'photo_path',g.photo_path,'photo_mime',g.photo_mime,'photo_size',g.photo_size,'photo_checksum',g.photo_checksum,
  'milestone_count',(select count(*) from private.team_goal_milestones m where m.goal_id=g.id),
  'completed_count',(select count(*) from private.team_goal_milestones m where m.goal_id=g.id and m.completed_at is not null),
  'milestones',case when p_detail then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'completed_at',m.completed_at)
    order by m.position,m.id) from private.team_goal_milestones m where m.goal_id=g.id),'[]'::jsonb) else '[]'::jsonb end)
 from public.profiles p where p.id=g.owner_profile_id;
$$;

create or replace function public.app_team_goal_members() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.goal_actor_role() not in ('owner','admin') then raise exception 'Goal management is unavailable' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',coalesce(nullif(p.display_name,''),'Team member'),'role',r.name,'avatar_url',p.avatar_url)
    order by p.display_name,p.id),'[]'::jsonb) from public.tenant_memberships m
    join public.profiles p on p.id=m.profile_id and p.archived_at is null join public.roles r on r.id=m.role_id
    where m.tenant_id=private.current_tenant_id() and m.archived_at is null and m.account_class='internal'
      and r.name in ('owner','admin','manager','staff'));
end $$;

create or replace function public.app_save_team_goal(p_goal_id uuid,p_input jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor_role text:=private.goal_actor_role(); goal private.team_goals; existing private.team_goals;
  owner_role text; owner_id uuid; milestone jsonb; milestone_id uuid; milestone_position integer:=0; ids uuid[]:='{}';
  fingerprint text:=encode(extensions.digest(p_input::text,'sha256'),'hex');
begin
  if actor_role not in ('owner','admin') then raise exception 'Goal management is unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or length(btrim(coalesce(p_input->>'title',''))) not between 1 and 160
    or length(coalesce(p_input->>'description',''))>4000 or (p_input->>'visibility') is distinct from 'shared'
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
  if owner_role is null then
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
